import { Env } from "@/Env";
import { DockerError } from "@/errors/DockerError";
import { Container } from "@/models/Container";
import { Host } from "@/models/Host";
import { StreamVariant } from "@/models/StreamVariant";
import { Temporal } from "@js-temporal/polyfill";
import z from "zod/v4";
import { Source } from "../contracts/Source";

/**
 * Interacts with the Docker Engine API, directly via the unix socket
 */
export class DockerSocket implements Source {
  private static readonly LABEL_COMPOSE_PROJECT = "com.docker.compose.project";
  private static readonly LABEL_SWARM_STACK = "com.docker.stack.namespace";
  public static readonly MAX_LINE_LENGTH = 64 * 1024;

  public constructor(private readonly env: Env.Private) {}

  public async listRunningContainers(): Promise<Container[]> {
    const response = await this.request("/containers/json");
    return Internal.Summaries.parse(await response.json()).map<Container>((summary) => ({
      object: "container",
      did: summary.Id,
      dname: this.readName(summary.Names.at(0) ?? summary.Id),
      dgroup: this.readGroup(summary.Labels),
      dimage: this.readImage(summary.Image),
      dlabels: this.readLabels(summary.Labels),
    }));
  }

  public async inspectHost(): Promise<Host.Identity> {
    const response = await this.request("/info");
    const { Name, ServerVersion, NCPU, MemTotal } = Internal.Info.parse(await response.json());
    return { hostname: Name, dockerVersion: ServerVersion, cpuTotal: NCPU, memoryTotal: MemTotal };
  }

  public async *streamLifecycles(signal: AbortSignal): AsyncGenerator<Source.Lifecycle> {
    const filters = JSON.stringify({
      type: ["container"],
      event: ["start", "die"],
    });
    const response = await this.request(`/events?filters=${encodeURIComponent(filters)}`, signal);
    for await (const line of this.readLines(this.readBody(response, "/events"))) {
      const lifecycleEvent = Internal.LifecycleEvent.parse(JSON.parse(line));
      const status = (lifecycleEvent.Action ?? lifecycleEvent.status)!;
      yield {
        status,
        timestamp: Temporal.Instant.fromEpochMilliseconds(lifecycleEvent.time * 1000),
        container: {
          object: "container",
          did: lifecycleEvent.Actor.ID,
          dname: this.readName(lifecycleEvent.Actor.Attributes.name),
          dgroup: this.readGroup(lifecycleEvent.Actor.Attributes),
          dimage: this.readImage(lifecycleEvent.Actor.Attributes.image),
          dlabels: this.readLabels(lifecycleEvent.Actor.Attributes),
        },
      };
    }
  }

  public async *streamLogLines(id: string, signal: AbortSignal): AsyncGenerator<Source.LogLine> {
    // Containers started with a TTY emit a raw byte stream for their logs; all others emit Docker's
    // multiplexed framing. There is no way to tell from the log stream itself, so it has to be asked up front.
    // Containers are usually started without an interactive shell, so non-TTY is the overwhelmingly "normal" case.
    const tty = await this.hasTty(id, signal);

    // Timestamps are only requested for the (non-TTY) framed stream.
    // That's because Docker cuts a log message once it passes 16KB, and stamps every piece it cuts:
    //  - The framed Non-TTY stream says where each piece begins, so those repeated stamps can be dropped again.
    //  - TTY containers (with their "simple" stream), on the other hand, leave timestamps stranded mid-message,
    //    indistinguishable from what the container itself wrote.
    const path = `/containers/${id}/logs?follow=1&stdout=1&stderr=1&timestamps=${tty ? 0 : 1}&tail=0`;
    const response = await this.request(path, signal);
    const body = this.readBody(response, path);
    const frames = tty ? this.streamTtyContainerLogs(body) : this.streamInterleavedNonTtyContainerLogs(body);

    const leftoversMap = new Map<StreamVariant, string>();
    for await (let { streamVariant, data } of frames) {
      const leftovers = leftoversMap.get(streamVariant) ?? "";

      // Timestamps were only requested for the framed stream; TTY falls back to arrival time
      let timestamp = Temporal.Now.instant();
      if (!tty) {
        const split = this.splitTimestamp(data);
        data = split.actualData;
        timestamp = split.timestamp ?? timestamp;
      }

      const lines: string[] = [];

      // If a container never writes a newline, this application slowly grinds to a halt
      // because the "leftovers" map grows unbounded
      let carried = leftovers;
      let offset = 0;
      for (let newline = data.indexOf("\n"); newline !== -1; newline = data.indexOf("\n", offset)) {
        lines.push(carried + data.slice(offset, newline));
        carried = "";
        offset = newline + 1;
      }
      carried += data.slice(offset);

      // A line that never ends (a `\r` progress bar, a binary dump) is cut, the way docker itself cuts at 16KB
      for (offset = 0; carried.length - offset > DockerSocket.MAX_LINE_LENGTH; offset += DockerSocket.MAX_LINE_LENGTH) {
        lines.push(carried.slice(offset, offset + DockerSocket.MAX_LINE_LENGTH));
      }
      leftoversMap.set(streamVariant, carried.slice(offset));

      for (const line of lines) {
        if (line.length > 0) {
          yield {
            streamVariant,
            timestamp,
            line: this.dropCarriageReturn(line),
          };
        }
      }
    }
    // Unlike a truncated JSON object, a trailing line with no final newline is still a whole line:
    // the container simply exited without one.
    for (const [streamVariant, rest] of leftoversMap) {
      if (rest.length > 0) {
        yield {
          streamVariant,
          timestamp: Temporal.Now.instant(),
          line: this.dropCarriageReturn(rest),
        };
      }
    }
  }

  /**
   * Docker samples a running container about once a second; the maths below is the docker CLI's.
   */
  public async *streamStats(id: string, signal: AbortSignal): AsyncGenerator<Source.Stats> {
    const cpuLimit = this.readCpuLimit(await this.inspect(id, signal));

    const path = `/containers/${id}/stats?stream=1`;
    const response = await this.request(path, signal);
    for await (const line of this.readLines(this.readBody(response, path))) {
      const { cpu_stats, precpu_stats, memory_stats } = Internal.Stats.parse(JSON.parse(line));

      // CPU is the container's share of the host's cpu time since the previous sample. The very
      // first sample has no previous one (docker sends zeros), so it cannot say anything about CPU yet.
      if (!precpu_stats.system_cpu_usage || !cpu_stats.system_cpu_usage) {
        continue;
      }
      if (memory_stats.usage === undefined || memory_stats.limit === undefined) {
        continue;
      }
      const cpuDelta = cpu_stats.cpu_usage.total_usage - (precpu_stats.cpu_usage?.total_usage ?? 0);
      const systemDelta = Math.max(1, cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage);
      const onlineCpus = cpu_stats.online_cpus ?? cpu_stats.cpu_usage.percpu_usage?.length ?? 1;

      // Docker counts the page cache as usage, which is really the kernel's memory, not the container's.
      // cgroup v1 reports it as `total_inactive_file`, v2 as `inactive_file`.
      const cache = memory_stats.stats?.total_inactive_file ?? memory_stats.stats?.inactive_file ?? 0;

      yield {
        cpuUsage: Math.max(0, cpuDelta / systemDelta) * onlineCpus,
        cpuTotal: cpuLimit ?? onlineCpus,
        memoryUsage: cache < memory_stats.usage ? memory_stats.usage - cache : memory_stats.usage,
        memoryTotal: memory_stats.limit,
      };
    }
  }

  private async hasTty(id: string, signal: AbortSignal): Promise<boolean> {
    return (await this.inspect(id, signal)).Config.Tty;
  }

  /** `--cpus` lands as NanoCpus; the older `--cpu-quota` and `--cpu-period` pair says the same thing as a ratio. */
  private readCpuLimit({ HostConfig }: Internal.Inspection): number | undefined {
    if (HostConfig.NanoCpus) {
      return HostConfig.NanoCpus / 1e9;
    }
    if (HostConfig.CpuQuota && HostConfig.CpuPeriod) {
      return HostConfig.CpuQuota / HostConfig.CpuPeriod;
    }
    return undefined;
  }

  private async inspect(id: string, signal: AbortSignal): Promise<Internal.Inspection> {
    const response = await this.request(`/containers/${id}/json`, signal);
    return Internal.Inspection.parse(await response.json());
  }

  /**
   * TTY containers yield a simple continuous log stream for stdout only
   */
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
        const payload = decoder.decode(buffer.subarray(payloadStart, payloadEnd));
        yield {
          streamVariant: headerStreamVariant,
          data: payload,
        };
        offset = payloadEnd;
      }

      // What's left in the buffer is unusable at this point, because bytes are missing
      // So we put these leftovers into position for the upcoming chunk
      buffer = offset === 0 ? buffer : buffer.slice(offset);
    }
  }

  private async request(path: string, signal?: AbortSignal): Promise<Response> {
    const socket = this.env.DOLOG_DOCKER_SOCKET;
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

  /**
   * Docker resolves a reference without a tag or digest to `:latest`, but reports it as written.
   * Only the last path segment is inspected, since a registry host may carry a port
   */
  private readImage(reference: string): string {
    const name = reference.slice(reference.lastIndexOf("/") + 1);
    return name.includes(":") || name.includes("@") ? reference : `${reference}:latest`;
  }

  private readLabels(labels: Record<string, string> | null | undefined): Record<string, string> {
    const prefix = this.env.DOLOG_CONTAINER_LABEL_PREFIX;
    return Object.fromEntries(
      Object.entries(labels ?? {})
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => [key.slice(prefix.length), value]),
    );
  }

  private readBody(response: Response, path: string): ReadableStream<Uint8Array> {
    if (!response.body) {
      throw DockerError.empty_response_body({ path });
    }
    return response.body;
  }

  private dropCarriageReturn(line: string): string {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  }

  /**
   * Docker's `timestamps=1` prefixes an RFC3339Nano instant and a single space onto every payload
   * it emits.
   */
  private splitTimestamp(data: string): { timestamp?: Temporal.Instant; actualData: string } {
    const separator = data.indexOf(" ");
    if (separator > 0) {
      try {
        return { timestamp: Temporal.Instant.from(data.slice(0, separator)), actualData: data.slice(separator + 1) };
      } catch {
        // not a timestamp after all
      }
    }
    return { actualData: data };
  }

  private async *readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    let leftovers = "";
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      leftovers += decoder.decode(chunk, { stream: true });

      // the fully formed lines are ready to be processed upstream
      // any leftovers belong to the upcoming chunk
      const lines = leftovers.split("\n");
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

/**
 * Docker's wire formats: the shapes coming off the socket, and the schemas that validate them
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
      Image: z.string(),
      Labels: z.record(z.string(), z.string()).nullish(),
    }),
  );

  export type Inspection = z.output<typeof Inspection>;
  export const Inspection = z.object({
    Config: z.object({ Tty: z.boolean() }),
    // docker writes zeros for a limit that was never set
    HostConfig: z.object({
      NanoCpus: z.number().optional(),
      CpuQuota: z.number().optional(),
      CpuPeriod: z.number().optional(),
    }),
  });

  export const Info = z.object({
    Name: z.string(),
    ServerVersion: z.string(),
    NCPU: z.number(),
    MemTotal: z.number(),
  });

  /**
   * Mostly optional, because the first sample of a stream carries no `precpu_stats` to speak of,
   * and a container that is not running answers with empty objects.
   */
  export const Stats = z.object({
    cpu_stats: z.object({
      cpu_usage: z.object({
        total_usage: z.number(),
        percpu_usage: z.array(z.number()).nullish(),
      }),
      system_cpu_usage: z.number().optional(),
      online_cpus: z.number().optional(),
    }),
    precpu_stats: z.object({
      cpu_usage: z.object({ total_usage: z.number().optional() }).optional(),
      system_cpu_usage: z.number().optional(),
    }),
    memory_stats: z.object({
      usage: z.number().optional(),
      limit: z.number().optional(),
      stats: z.record(z.string(), z.number()).optional(),
    }),
  });

  export const LifecycleEvent = z
    .object({
      Action: z.enum(["start", "die"]).optional(),
      status: z.enum(["start", "die"]).optional(), // legacy; replaced by Action
      time: z.number(),
      Actor: z.object({
        ID: z.string(),
        // the container's labels, plus docker's own `name` and `image`
        Attributes: z.record(z.string(), z.string()).and(z.object({ name: z.string(), image: z.string() })),
      }),
    })
    .refine((event) => Boolean(event.Action ?? event.status), {
      error: "missing_action",
    });
}
