import { Env } from "@/Env";
import { DockerError } from "@/errors/DockerError";
import { Container } from "@/models/Container";
import { StreamVariant } from "@/models/StreamVariant";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";

/**
 * Transport for the Docker Engine API over its unix socket. Knows about HTTP, JSON and Docker's
 * stream framing; knows nothing about throttling, retries or what any of it means.
 *
 * Bun's `fetch` speaks unix sockets natively, so no docker client library is involved.
 */
export class DockerSocket {
  private static readonly LABEL_COMPOSE_PROJECT = "com.docker.compose.project";
  private static readonly LABEL_SWARM_STACK = "com.docker.stack.namespace";

  public constructor(private readonly env: Env.Private) {}

  public async listRunningContainers(): Promise<Container[]> {
    const response = await this.request("/containers/json");
    return Internal.Summaries.parse(await response.json()).map((summary) =>
      Container.parse({
        id: summary.Id,
        object: "container",
        name: this.readName(summary.Names.at(0) ?? summary.Id),
        group: this.readGroup(summary.Labels),
      }),
    );
  }

  public async *streamLifecycles(signal: AbortSignal): AsyncGenerator<DockerSocket.Lifecycle> {
    const filters = JSON.stringify({
      type: ["container"],
      event: ["start", "die"],
    });
    const response = await this.request(`/events?filters=${encodeURIComponent(filters)}`, signal);
    for await (const line of this.readLines(this.readBody(response, "/events"))) {
      const lifecycleEvent = Internal.LifecycleEvent.parse(JSON.parse(line));
      yield {
        status: (lifecycleEvent.Action ?? lifecycleEvent.status)!,
        timestamp: Temporal.Instant.fromEpochMilliseconds(lifecycleEvent.time * 1000),
        container: Container.parse({
          id: lifecycleEvent.Actor.ID,
          object: "container",
          name: this.readName(lifecycleEvent.Actor.Attributes.name),
          group: this.readGroup(lifecycleEvent.Actor.Attributes),
        }),
      };
    }
  }

  public async *streamLogs(id: string, signal: AbortSignal): AsyncGenerator<DockerSocket.LogLine> {
    // Containers started with a TTY emit a raw byte stream; all others emit Docker's multiplexed
    // framing. There is no way to tell from the log stream itself, so it has to be asked up front.
    //
    // Containers are usually started without an interactive shell, so non-TTY is the overwhelmingly "normal" case
    const tty = await this.hasTty(id, signal);

    // For the log stream of TTY containers, timestamp placement cannot be unambiguously separated from log bytes
    // so it's better not to request them, and rely on arrival time for TTY containers
    const path = `/containers/${id}/logs?follow=1&stdout=1&stderr=1&timestamps=${tty ? 0 : 1}&tail=0`;
    const response = await this.request(path, signal);
    const body = this.readBody(response, path);
    const frames = tty ? this.streamTtyContainerLogs(body) : this.streamInterleavedNonTtyContainerLogs(body);

    const leftoversMap = new Map<StreamVariant, string>();
    for await (const { streamVariant, data } of frames) {
      const leftovers = leftoversMap.get(streamVariant) ?? "";
      
      /**
       * A frame resuming an unfinished line repeats that line's timestamp, which would otherwise be
       * spliced into the middle of the message. The carried half already holds the real one.
       */
      const continuation = !tty && leftovers.length > 0;
      const lines = (leftovers + (continuation ? this.splitTimestamp(data).rest : data)).split("\n");
      leftoversMap.set(streamVariant, lines.pop() ?? "");
      for (const line of lines) {
        if (line.length > 0) {
          yield this.readLogLine(streamVariant, line, tty);
        }
      }
    }
    /**
     * Unlike a truncated JSON object, a trailing line with no final newline is still a whole line:
     * the container simply exited without one.
     */
    for (const [streamVariant, rest] of leftoversMap) {
      if (rest.length > 0) {
        yield this.readLogLine(streamVariant, rest, tty);
      }
    }
  }

  private async hasTty(id: string, signal: AbortSignal): Promise<boolean> {
    const response = await this.request(`/containers/${id}/json`, signal);
    return Internal.Inspection.parse(await response.json()).Config.Tty;
  }

  private async *streamTtyContainerLogs(body: ReadableStream<Uint8Array>): AsyncGenerator<Internal.Frame> {
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      yield {
        streamVariant: StreamVariant.stdout,
        data: decoder.decode(chunk, { stream: true }),
      };
    }
  }

  /**
   * Non-TTY containers interleave stdout and stderr on one connection, each payload prefixed by an
   * 8-byte header, consisting of std-stream type (out/err), three padding bytes, and a big-endian payload length
   *
   * byte#   0       1  2  3        4  5  6  7          8              8+size-1
   *       ┌─↓─────┬─↓────────────┬─↓─────────────────┬─↓──────────────↓─────────┐
   *       │ 02    │ 00 00 00     │ 00 00 00 06       │ 6f 68 20 6e 6f 0a        │
   *       └───────┴──────────────┴───────────────────┴──────────────────────────┘
   *          │          │                │                       │
   *       stream     padding        size (big-endian)       payload (6 bytes)
   *     1=stdout     (unused)           = 6                    = "oh no\n"
   *     2=stderr
   *
   * These frames (like the one above) are interleaved for stdout/stderr, and so you must actually calculate
   * where the payload of the current frame ends: anything after that will be part of the next frame
   *
   *     0                        8           8+6                       8+6+8       8+6+8+14
   *   ┌─↓──────────────────────┬─↓─────────┬─↓───────────────────────┬─↓─────────┬─↓──
   *   │ STDOUT; payload_size=6 │ <payload> │ STDERR; payload_size=14 │ <payload> │ ~~~~~~
   *   └────────────────────────┴───────────┴─────────────────────────┴───────────┴──────────
   *
   * So the determination of frame boundaries is fully arithmetic.
   * Plus, top of that, HTTP chunk boundaries occur at random positions...
   */
  private async *streamInterleavedNonTtyContainerLogs(body: ReadableStream<Uint8Array>): AsyncGenerator<Internal.Frame> {
    const FRAME_HEADER_BYTES = 8;
    const decoder = new TextDecoder();

    // Remember: our `buffer: Uint8Array` is a window into an underlying `ArrayBufferLike` memory pool of unspecified dimension
    // - as long as we only work via our given `buffer` window, everything is fine
    // - but if we want to construct a secondary view, mapped onto the same underlying memory pool,
    //   then we should take the `byteOffset` into account, that we were handed alongside with our original window
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    for await (const chunk of body) {
      buffer = buffer.length === 0 ? chunk : this.concat(buffer, chunk);

      // The implementation below is important for performance:
      // - a chunk is likely to contain many many payloads
      // - the while loop below parses all of them, before loading the next chunk
      let offset = 0;
      while (buffer.length - offset >= FRAME_HEADER_BYTES) {
        const header = new DataView(
          buffer.buffer, // References to that memory pool of unspecified dimension
          buffer.byteOffset + offset, // at which index to start reading from that pool
          FRAME_HEADER_BYTES, // how many bytes to read
        );
        const headerStreamVariant = buffer[offset] === 2 ? StreamVariant.stderr : StreamVariant.stdout;
        const headerPayloadSize = header.getUint32(4, false); // unsigned int32 (bits) = 4 bytes = exactly our 4 bytes wide big-endian size field

        if (buffer.length - offset < FRAME_HEADER_BYTES + headerPayloadSize) {
          break;
        }

        const payloadStart = offset + FRAME_HEADER_BYTES;
        const payloadEnd = payloadStart + headerPayloadSize;
        yield {
          streamVariant: headerStreamVariant,
          data: decoder.decode(buffer.subarray(payloadStart, payloadEnd)),
        };
        offset = payloadEnd;
      }

      // What's left in the buffer is unusable at this point, because bytes are missing
      // So we put these leftovers into position for the upcoming chunk
      buffer = offset === 0 ? buffer : buffer.slice(offset);
    }
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    const socket = this.env.X_DOLOG_DOCKER_SOCKET;
    const response = await fetch(`http://docker${path}`, { unix: socket, signal }).catch((cause) => {
      throw DockerError.socket_unreachable({ socket, reason: `${cause}` });
    });
    if (!response.ok) {
      throw DockerError.unexpected_response({ path, status: response.status });
    }
    return response;
  }

  private readName(name: string): string {
    return name.startsWith("/") ? name.slice(1) : name;
  }

  private readGroup(labels: Record<string, string> | null | undefined): string | undefined {
    return labels?.[DockerSocket.LABEL_SWARM_STACK] ?? labels?.[DockerSocket.LABEL_COMPOSE_PROJECT];
  }

  private readBody(response: Response, path: string): ReadableStream<Uint8Array> {
    if (!response.body) {
      throw DockerError.empty_response_body({ path });
    }
    return response.body;
  }

  /**
   * Only a framed stream was asked for timestamps, so only there is a leading instant docker's
   * rather than the container's own output. A line that should carry one but doesn't is still worth
   * keeping, so it falls back to arrival time too.
   */
  private readLogLine(streamVariant: StreamVariant, line: string, tty: boolean): DockerSocket.LogLine {
    if (tty) {
      return { streamVariant, timestamp: Temporal.Now.instant(), message: this.dropCarriageReturn(line) };
    }
    const { timestamp, rest } = this.splitTimestamp(line);
    return { streamVariant, timestamp: timestamp ?? Temporal.Now.instant(), message: this.dropCarriageReturn(rest) };
  }

  /**
   * A pty translates every newline into a carriage return plus a newline, so a tty container's
   * lines arrive with a trailing `\r` that the container never wrote.
   */
  private dropCarriageReturn(line: string): string {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }

  /**
   * Docker's `timestamps=1` prefixes an RFC3339Nano instant and a single space onto every payload
   * it emits.
   */
  private splitTimestamp(text: string): { timestamp?: Temporal.Instant; rest: string } {
    const separator = text.indexOf(" ");
    if (separator > 0) {
      try {
        return { timestamp: Temporal.Instant.from(text.slice(0, separator)), rest: text.slice(separator + 1) };
      } catch {
        // not a timestamp after all
      }
    }
    return { rest: text };
  }

  private async *readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    let leftovers = "";
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      leftovers += decoder.decode(chunk, { stream: true });

      // jsonl, so each line is 1 json object
      const lines = leftovers.split("\n");
      // the fully formed lines are ready to be processed upstream
      // any leftovers belong to the upcoming chunk
      leftovers = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim().length > 0) {
          yield line;
        }
      }
    }
  }

  private concat(left: Uint8Array, right: Uint8Array): Uint8Array {
    const result = new Uint8Array(left.length + right.length);
    result.set(left);
    result.set(right, left.length);
    return result;
  }
}

export namespace DockerSocket {
  export type LogLine = {
    streamVariant: StreamVariant;
    timestamp: Temporal.Instant;
    message: string;
  };

  export type Lifecycle = {
    status: "start" | "die";
    timestamp: Temporal.Instant;
    container: Container;
  };
}

/**
 * Docker's wire formats: the shapes coming off the socket, and the schemas that validate them.
 * None of it escapes this module.
 */
namespace Internal {
  export type Frame = {
    streamVariant: StreamVariant;
    data: string;
  };

  export const Summaries = z.array(
    z.object({
      Id: z.string(),
      Names: z.array(z.string()),
      Labels: z.record(z.string(), z.string()).nullish(),
    }),
  );

  export const Inspection = z.object({
    Config: z.object({ Tty: z.boolean() }),
  });

  /**
   * Recent API versions dropped the legacy `status` field in favour of `Action`; older daemons
   * only send `status`. The request is filtered down to start/die, so whichever arrives is one
   * of the two.
   */
  export const LifecycleEvent = z
    .object({
      Action: z.enum(["start", "die"]).optional(),
      status: z.enum(["start", "die"]).optional(),
      time: z.number(),
      Actor: z.object({
        ID: z.string(),
        Attributes: z.record(z.string(), z.string()),
      }),
    })
    .refine((event) => Boolean(event.Action ?? event.status), { error: "missing_action" });
}
