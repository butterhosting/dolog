import { Env } from "@/Env";
import { DockerError } from "@/errors/DockerError";
import { Container } from "@/models/Container";
import { StdStream } from "@/models/StdStream";
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
  private static readonly FRAME_HEADER_BYTES = 8;

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

  public async *streamLifecycle(signal: AbortSignal): AsyncGenerator<DockerSocket.Lifecycle> {
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
    const tty = await this.hasTty(id, signal);
    const path = `/containers/${id}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=0`;
    const response = await this.request(path, signal);
    const body = this.readBody(response, path);
    const payloads = tty ? this.readTtyChunks(body) : this.readMultiplexedPayloads(body);
    /**
     * Payload boundaries have nothing to do with line boundaries, so a line can arrive in pieces --
     * on a tty stream there is no framing at all. Each stream buffers separately, since stdout and
     * stderr interleave and would otherwise splice their partial lines into each other.
     */
    const leftovers = new Map<StdStream, string>();
    for await (const { stdStream, text } of payloads) {
      const lines = ((leftovers.get(stdStream) ?? "") + text).split("\n");
      leftovers.set(stdStream, lines.pop() ?? "");
      for (const line of lines) {
        if (line.length > 0) {
          yield this.readLogLine(stdStream, line);
        }
      }
    }
    /**
     * Unlike a truncated JSON object, a trailing line with no final newline is still a whole line:
     * the container simply exited without one.
     */
    for (const [stdStream, rest] of leftovers) {
      if (rest.length > 0) {
        yield this.readLogLine(stdStream, rest);
      }
    }
  }

  /**
   * Containers started with a TTY emit a raw byte stream; all others emit Docker's multiplexed
   * framing. There is no way to tell from the log stream itself, so it has to be asked up front.
   */
  private async hasTty(id: string, signal: AbortSignal): Promise<boolean> {
    const response = await this.request(`/containers/${id}/json`, signal);
    return Internal.Inspection.parse(await response.json()).Config.Tty;
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
   * Docker's `timestamps=1` prefixes every line with an RFC3339Nano instant and a single space.
   * A line without one is still worth keeping, so it falls back to arrival time.
   */
  private readLogLine(stdStream: StdStream, line: string): DockerSocket.LogLine {
    const separator = line.indexOf(" ");
    if (separator > 0) {
      try {
        return {
          stdStream,
          timestamp: Temporal.Instant.from(line.slice(0, separator)),
          message: line.slice(separator + 1),
        };
      } catch {
        // not a timestamp after all
      }
    }
    return { stdStream, timestamp: Temporal.Now.instant(), message: line };
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

  private async *readTtyChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Internal.Payload> {
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      yield {
        stdStream: StdStream.out,
        text: decoder.decode(chunk, { stream: true }),
      };
    }
  }

  /**
   * Non-TTY containers interleave stdout and stderr on one connection, each payload prefixed by an
   * 8-byte header, consisting of std-stream type (out/err), three padding bytes, and a big-endian payload length
   *
   * byte#   0       1  2  3        4  5  6  7          8 ─────────► 8+size
   *       ┌───────┬──────────────┬───────────────────┬──────────────────────────┐
   *       │ 02    │ 00 00 00     │ 00 00 00 06       │ 6f 68 20 6e 6f 0a        │
   *       └───────┴──────────────┴───────────────────┴──────────────────────────┘
   *          │          │                │                       │
   *       stream     padding        size (big-endian)       payload (6 bytes)
   *     1=stdout     (unused)           = 6                    = "oh no\n"
   *     2=stderr
   *
   * Obviously, HTTP chunk boundaries occur at random positions, so ???
   */
  private async *readMultiplexedPayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<Internal.Payload> {
    const headerBytes = DockerSocket.FRAME_HEADER_BYTES;
    const decoder = new TextDecoder();
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    for await (const chunk of body) {
      /**
       * Walked with an offset rather than re-slicing per frame: a chatty container packs thousands
       * of tiny frames into one chunk, and copying the remainder each time makes a single chunk
       * quadratic -- enough to wedge the process outright.
       */
      let offset = 0;
      buffer = buffer.length === 0 ? chunk : this.concat(buffer, chunk);
      while (buffer.length - offset >= headerBytes) {
        const header = new DataView(buffer.buffer, buffer.byteOffset + offset, headerBytes);
        const size = header.getUint32(4, false);
        if (buffer.length - offset < headerBytes + size) {
          break;
        }
        const stdStream = buffer[offset] === 2 ? StdStream.err : StdStream.out;
        const start = offset + headerBytes;
        yield {
          stdStream,
          text: decoder.decode(buffer.subarray(start, start + size)),
        };
        offset = start + size;
      }
      buffer = offset === 0 ? buffer : buffer.slice(offset);
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
    stdStream: StdStream;
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
  export type Payload = {
    stdStream: StdStream;
    text: string;
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
