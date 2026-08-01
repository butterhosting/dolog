import { Env } from "@/Env";
import { DockerError } from "@/errors/DockerError";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";

/**
 * Transport for the Docker Engine API over its unix socket. Knows about HTTP, JSON and Docker's
 * stream framing; knows nothing about throttling, retries or what any of it means.
 *
 * Bun's `fetch` speaks unix sockets natively, so no docker client library is involved.
 */
export class DockerSocket {
  public constructor(private readonly env: Env.Private) {}

  public async listRunningContainers(): Promise<Container[]> {
    const response = await this.request("/containers/json");
    return DockerSocket.Summaries.parse(await response.json()).map((summary) =>
      Container.parse({
        id: summary.Id,
        object: "container",
        name: DockerSocket.readName(summary.Names.at(0) ?? summary.Id),
        group: DockerSocket.readGroup(summary.Labels),
      }),
    );
  }

  /**
   * Containers started with a TTY emit a raw byte stream; all others emit Docker's multiplexed
   * framing. There is no way to tell from the log stream itself, so it has to be asked up front.
   */
  public async hasTty(id: string): Promise<boolean> {
    const response = await this.request(`/containers/${id}/json`);
    return DockerSocket.Inspection.parse(await response.json()).Config.Tty;
  }

  public async *streamLifecycle(signal: AbortSignal): AsyncGenerator<DockerSocket.Lifecycle> {
    const filters = JSON.stringify({ type: ["container"], event: ["start", "die"] });
    const response = await this.request(`/events?filters=${encodeURIComponent(filters)}`, signal);
    for await (const line of DockerSocket.readLines(DockerSocket.readBody(response, "/events"))) {
      const event = DockerSocket.Lifecycle.parse(JSON.parse(line));
      yield {
        status: (event.Action ?? event.status)!,
        timestamp: Temporal.Instant.fromEpochMilliseconds(event.time * 1000),
        container: Container.parse({
          id: event.Actor.ID,
          object: "container",
          name: DockerSocket.readName(event.Actor.Attributes.name),
          group: DockerSocket.readGroup(event.Actor.Attributes),
        }),
      };
    }
  }

  /**
   * Follows a container's logs from now on. The stream ends by itself when the container dies.
   */
  public async *streamLogs(id: string, tty: boolean, signal: AbortSignal): AsyncGenerator<DockerSocket.LogLine> {
    const path = `/containers/${id}/logs?follow=1&stdout=1&stderr=1&timestamps=1&tail=0`;
    const response = await this.request(path, signal);
    const body = DockerSocket.readBody(response, path);
    const payloads = tty ? DockerSocket.readTtyPayloads(body) : DockerSocket.readMultiplexedPayloads(body);
    for await (const { stream, text } of payloads) {
      for (const line of text.split("\n")) {
        if (line.length > 0) {
          yield DockerSocket.readLogLine(stream, line);
        }
      }
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
}

export namespace DockerSocket {
  export type LogLine = {
    stream: ContainerEvent.Stream;
    timestamp: Temporal.Instant;
    message: string;
  };

  export type Lifecycle = {
    status: "start" | "die";
    timestamp: Temporal.Instant;
    container: Container;
  };

  const LABEL_COMPOSE_PROJECT = "com.docker.compose.project";
  const LABEL_SWARM_STACK = "com.docker.stack.namespace";
  const FRAME_HEADER_BYTES = 8;

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
  export const Lifecycle = z
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

  export function readName(name: string): string {
    return name.startsWith("/") ? name.slice(1) : name;
  }

  export function readGroup(labels: Record<string, string> | null | undefined): string | undefined {
    return labels?.[LABEL_SWARM_STACK] ?? labels?.[LABEL_COMPOSE_PROJECT];
  }

  export function readBody(response: Response, path: string): ReadableStream<Uint8Array> {
    if (!response.body) {
      throw DockerError.empty_response_body({ path });
    }
    return response.body;
  }

  /**
   * Docker's `timestamps=1` prefixes every line with an RFC3339Nano instant and a single space.
   * A line without one is still worth keeping, so it falls back to arrival time.
   */
  export function readLogLine(stream: ContainerEvent.Stream, line: string): LogLine {
    const separator = line.indexOf(" ");
    if (separator > 0) {
      try {
        return {
          stream,
          timestamp: Temporal.Instant.from(line.slice(0, separator)),
          message: line.slice(separator + 1),
        };
      } catch {
        // not a timestamp after all
      }
    }
    return { stream, timestamp: Temporal.Now.instant(), message: line };
  }

  export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    let pending = "";
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      pending += decoder.decode(chunk, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim().length > 0) {
          yield line;
        }
      }
    }
  }

  export async function* readTtyPayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<{ stream: ContainerEvent.Stream; text: string }> {
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      yield { stream: ContainerEvent.Stream.stdout, text: decoder.decode(chunk, { stream: true }) };
    }
  }

  /**
   * Non-TTY containers interleave stdout and stderr on one connection, each chunk prefixed by an
   * 8-byte header: a stream descriptor, three padding bytes, then a big-endian payload length.
   */
  export async function* readMultiplexedPayloads(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<{ stream: ContainerEvent.Stream; text: string }> {
    const decoder = new TextDecoder();
    let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
    for await (const chunk of body) {
      /**
       * Walked with an offset rather than re-slicing per frame: a chatty container packs thousands
       * of tiny frames into one chunk, and copying the remainder each time makes a single chunk
       * quadratic -- enough to wedge the process outright.
       */
      let offset = 0;
      buffer = buffer.length === 0 ? chunk : concat(buffer, chunk);
      while (buffer.length - offset >= FRAME_HEADER_BYTES) {
        const header = new DataView(buffer.buffer, buffer.byteOffset + offset, FRAME_HEADER_BYTES);
        const size = header.getUint32(4, false);
        if (buffer.length - offset < FRAME_HEADER_BYTES + size) {
          break;
        }
        const stream = buffer[offset] === 2 ? ContainerEvent.Stream.stderr : ContainerEvent.Stream.stdout;
        const start = offset + FRAME_HEADER_BYTES;
        yield {
          stream,
          text: decoder.decode(buffer.subarray(start, start + size)),
        };
        offset = start + size;
      }
      buffer = offset === 0 ? buffer : buffer.slice(offset);
    }
  }

  function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
    const result = new Uint8Array(left.length + right.length);
    result.set(left);
    result.set(right, left.length);
    return result;
  }
}
