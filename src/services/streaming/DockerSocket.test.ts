import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { Yexception } from "yexception";
import { DockerSocket } from "./DockerSocket";
import { StreamVariant } from "@/models/StreamVariant";

const TIMESTAMP = "2026-08-01T10:11:12.130000000Z";

/**
 * Driven through the public methods against a stubbed socket, so the wire formats stay covered
 * without reaching into the module's internals.
 */
describe(DockerSocket.name, () => {
  let context: TestEnvironment.Context;
  let socket: DockerSocket;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    socket = new DockerSocket(context.env);
  });

  describe("streamLogs", () => {
    it("should split stdout and stderr apart and lift docker's timestamp prefix out", async () => {
      // given
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} GET / 200\n`), frame(2, `${TIMESTAMP} boom\n`)));
      // when
      const lines = await readLogs();
      // then
      expect(lines).toEqual([
        { streamVariant: StreamVariant.stdout, timestamp: "2026-08-01T10:11:12.13Z", line: "GET / 200" },
        { streamVariant: StreamVariant.stderr, timestamp: "2026-08-01T10:11:12.13Z", line: "boom" },
      ]);
    });

    it("should reassemble a frame that arrives across several chunks", async () => {
      // given
      const whole = frame(1, `${TIMESTAMP} hello world\n`);
      respondWithLogs(streamOf(whole.subarray(0, 3), whole.subarray(3, 20), whole.subarray(20)));
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ line }) => line)).toEqual(["hello world"]);
    });

    it("should hold back a frame whose payload never completes", async () => {
      // given (the header promises more bytes than ever arrive)
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} hello\n`).subarray(0, 12)));
      // when
      const lines = await readLogs();
      // then
      expect(lines).toEqual([]);
    });

    it("should read a tty container's stream as raw stdout, keeping the text verbatim", async () => {
      // given (the container reports a tty, so its stream carries no frame headers -- and no
      // timestamps were requested for it, so nothing may be stripped off the front)
      respondWithLogs(streamOf(encode(`first\nsecond\n`)), { tty: true });
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ streamVariant, line }) => ({ streamVariant, line }))).toEqual([
        { streamVariant: StreamVariant.stdout, line: "first" },
        { streamVariant: StreamVariant.stdout, line: "second" },
      ]);
    });

    it("should drop the carriage return a pty adds to every line", async () => {
      // given (a pty translates \n into \r\n on its way out)
      respondWithLogs(streamOf(encode(`first\r\nsecond\r\n`)), { tty: true });
      // when
      const lines = await readLogs();
      // then (the \r was the terminal's, not the container's)
      expect(lines.map(({ line }) => line)).toEqual(["first", "second"]);
    });

    it("should not mistake a tty container's own output for a docker timestamp", async () => {
      // given (a container logging its own timestamps -- none of it is docker's to remove)
      respondWithLogs(streamOf(encode(`${TIMESTAMP} my own timestamp\n`)), { tty: true });
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ line }) => line)).toEqual([`${TIMESTAMP} my own timestamp`]);
    });

    it("should reassemble a line split across chunks of a tty stream", async () => {
      // given (a tty stream has no framing at all, so a chunk can end anywhere)
      respondWithLogs(streamOf(encode(`hello `), encode(`world\n`)), { tty: true });
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ line }) => line)).toEqual(["hello world"]);
    });

    it("should reassemble a line split across two frames", async () => {
      // given (docker splits a long line once it outgrows its 16KB read buffer, and stamps BOTH
      // halves with the timestamp of the line they belong to)
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} hello `), frame(1, `${TIMESTAMP} world\n`)));
      // when
      const lines = await readLogs();
      // then (the repeated timestamp is dropped rather than spliced into the message)
      expect(lines).toEqual([{ streamVariant: StreamVariant.stdout, timestamp: "2026-08-01T10:11:12.13Z", line: "hello world" }]);
    });

    it("should not request timestamps for a tty container, since they cannot be removed again", async () => {
      // given
      const requested: string[] = [];
      respondWithLogs(streamOf(encode(`hi\n`)), { tty: true, record: requested });
      // when
      await readLogs();
      // then
      expect(requested.find((url) => url.includes("/logs"))).toContain("timestamps=0");
    });

    it("should request timestamps for a framed container, where they can be removed again", async () => {
      // given
      const requested: string[] = [];
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} hi\n`)), { record: requested });
      // when
      await readLogs();
      // then
      expect(requested.find((url) => url.includes("/logs"))).toContain("timestamps=1");
    });

    it("should give each line its own timestamp, since docker emits one frame per line", async () => {
      // given (even a single write of "one\ntwo\n" comes back as two separately stamped frames)
      const other = "2026-08-01T22:33:44.000000000Z";
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} one\n`), frame(1, `${other} two\n`)));
      // when
      const lines = await readLogs();
      // then
      expect(lines).toEqual([
        { streamVariant: StreamVariant.stdout, timestamp: "2026-08-01T10:11:12.13Z", line: "one" },
        { streamVariant: StreamVariant.stdout, timestamp: "2026-08-01T22:33:44Z", line: "two" },
      ]);
    });

    it("should not splice stdout and stderr into each other while both are mid-line", async () => {
      // given (a half-written stdout line, a whole stderr line, then the rest of the stdout line --
      // every frame carries a timestamp, continuations repeating the one of the line they finish)
      respondWithLogs(
        streamOf(frame(1, `${TIMESTAMP} out-start `), frame(2, `${TIMESTAMP} err whole\n`), frame(1, `${TIMESTAMP} out-end\n`)),
      );
      // when
      const lines = await readLogs();
      // then (stderr came through untouched, and stdout rejoined its own halves)
      expect(lines).toEqual([
        { streamVariant: StreamVariant.stderr, timestamp: "2026-08-01T10:11:12.13Z", line: "err whole" },
        { streamVariant: StreamVariant.stdout, timestamp: "2026-08-01T10:11:12.13Z", line: "out-start out-end" },
      ]);
    });

    it("should still emit a trailing line that never got its newline", async () => {
      // given (the container exited without a final newline)
      respondWithLogs(streamOf(frame(1, `${TIMESTAMP} no trailing newline`)));
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ line }) => line)).toEqual(["no trailing newline"]);
    });

    it("should keep a line that has no parsable timestamp", async () => {
      // given
      respondWithLogs(streamOf(frame(1, "no timestamp here\n")));
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ line }) => line)).toEqual(["no timestamp here"]);
      expect(lines.at(0)?.timestamp).toBeTruthy();
    });
  });

  describe("listRunningContainers", () => {
    it("should strip the leading slash and prefer the swarm stack over the compose project", async () => {
      // given
      respondWith(
        Response.json([
          {
            Id: "abc",
            Names: ["/web"],
            Labels: { "com.docker.stack.namespace": "stack", "com.docker.compose.project": "project" },
          },
        ]),
      );
      // when
      const containers = await socket.listRunningContainers();
      // then
      expect(containers).toEqual([{ did: "abc", object: "container", dname: "web", dgroup: "stack" }]);
    });

    it("should fall back to the compose project, and leave an unlabelled container ungrouped", async () => {
      // given
      respondWith(
        Response.json([
          { Id: "a", Names: ["/one"], Labels: { "com.docker.compose.project": "shop" } },
          { Id: "b", Names: ["/two"], Labels: null },
        ]),
      );
      // when
      const containers = await socket.listRunningContainers();
      // then
      expect(containers.map(({ dname: name, dgroup: group }) => ({ name, group }))).toEqual([
        { name: "one", group: "shop" },
        { name: "two", group: undefined },
      ]);
    });
  });

  describe("streamLifecycle", () => {
    it("should read the modern `Action` field", async () => {
      // given
      respondWith(streamOf(encode(`${lifecycle({ Action: "start" })}\n${lifecycle({ Action: "die" })}\n`)));
      // when
      const events = await collect(socket.streamLifecycles(new AbortController().signal));
      // then
      expect(events.map(({ status }) => status)).toEqual(["start", "die"]);
      expect(events.at(0)?.container).toEqual({ did: "abc", object: "container", dname: "web", dgroup: "shop" });
    });

    it("should still read a legacy daemon's `status` field", async () => {
      // given
      respondWith(streamOf(encode(`${lifecycle({ status: "die" })}\n`)));
      // when
      const events = await collect(socket.streamLifecycles(new AbortController().signal));
      // then
      expect(events.map(({ status }) => status)).toEqual(["die"]);
    });
  });

  describe("inspectHost", () => {
    it("should read the host's name, docker version and size off docker's info", async () => {
      // given (docker says a great deal more about itself than is wanted)
      respondWith(Response.json({ Name: "tnlap", ServerVersion: "29.4.0", NCPU: 10, MemTotal: 16_819_609_600, Containers: 5 }));
      // when
      const identity = await socket.inspectHost();
      // then
      expect(identity).toEqual({ hostname: "tnlap", dockerVersion: "29.4.0", cpuTotal: 10, memoryTotal: 16_819_609_600 });
    });
  });

  describe("streamStats", () => {
    it("should skip the first sample, and read cores and bytes off the second the way the docker cli does", async () => {
      // given (a container using half of one core, and 1000 bytes of which 200 is page cache)
      const first = stats({ precpu_stats: { cpu_usage: { total_usage: 0 } } });
      const second = stats({});
      respondWithStats(streamOf(encode(`${first}\n${second}\n`)));
      // when
      const samples = await collect(socket.streamStats("abc", new AbortController().signal));
      // then
      expect(samples).toEqual([{ cpuUsage: 0.5, cpuTotal: 4, memoryUsage: 800, memoryTotal: 8_000 }]);
    });

    it("should make a cpu quota the total, the way a memory limit already is, without touching the usage", async () => {
      // given (the same half a core, in a container allowed a quarter of one)
      respondWithStats(streamOf(encode(`${stats({})}\n`)), { NanoCpus: 250_000_000 });
      // when
      const samples = await collect(socket.streamStats("abc", new AbortController().signal));
      // then
      expect(samples).toEqual([{ cpuUsage: 0.5, cpuTotal: 0.25, memoryUsage: 800, memoryTotal: 8_000 }]);
    });

    it("should read the older quota and period pair as the same ratio", async () => {
      // given
      respondWithStats(streamOf(encode(`${stats({})}\n`)), { CpuQuota: 25_000, CpuPeriod: 100_000 });
      // when
      const samples = await collect(socket.streamStats("abc", new AbortController().signal));
      // then
      expect(samples.map(({ cpuTotal }) => cpuTotal)).toEqual([0.25]);
    });

    it("should say nothing for a container that is not running", async () => {
      // given (docker answers with empty objects for a stopped container)
      respondWithStats(streamOf(encode(`${stats({ memory_stats: {} })}\n`)));
      // when
      const samples = await collect(socket.streamStats("abc", new AbortController().signal));
      // then
      expect(samples).toEqual([]);
    });
  });

  describe("request", () => {
    it("should turn a non-ok response into a domain error", async () => {
      // given
      respondWith(new Response("nope", { status: 500 }));
      // then
      expect(socket.listRunningContainers()).rejects.toEqual(
        expect.objectContaining({
          problem: "DockerError::unexpected_response",
          details: { path: "/containers/json", status: 500 },
        } satisfies Partial<Yexception>),
      );
    });

    it("should turn an unreachable socket into a domain error", async () => {
      // given
      spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      // then
      expect(socket.listRunningContainers()).rejects.toEqual(
        expect.objectContaining({ problem: "DockerError::socket_unreachable" } satisfies Partial<Yexception>),
      );
    });
  });

  async function readLogs() {
    const lines = await collect(socket.streamLogLines("abc", new AbortController().signal));
    return lines.map(({ streamVariant, timestamp, line }) => ({ streamVariant, timestamp: timestamp.toString(), line }));
  }
});

function respondWith(body: ReadableStream<Uint8Array> | Response) {
  const response = body instanceof Response ? body : new Response(body, { status: 200 });
  spyOn(globalThis, "fetch").mockResolvedValue(response);
}

/**
 * `streamLogs` inspects the container for its tty flag before opening the log stream, so these two
 * calls have to be answered separately.
 */
function respondWithLogs(body: ReadableStream<Uint8Array>, { tty = false, record }: { tty?: boolean; record?: string[] } = {}) {
  const handler = async (input: URL | RequestInfo) => {
    record?.push(`${input}`);
    return `${input}`.includes("/logs") ? new Response(body, { status: 200 }) : Response.json({ Config: { Tty: tty }, HostConfig: {} });
  };
  spyOn(globalThis, "fetch").mockImplementation(handler as typeof fetch);
}

/**
 * `streamStats` inspects the container for its cpu limit before opening the stream, so these two
 * calls have to be answered separately as well.
 */
function respondWithStats(body: ReadableStream<Uint8Array>, hostConfig: Record<string, number> = {}) {
  const handler = async (input: URL | RequestInfo) => {
    return `${input}`.includes("/stats") ? new Response(body, { status: 200 }) : Response.json({ Config: { Tty: false }, HostConfig: hostConfig });
  };
  spyOn(globalThis, "fetch").mockImplementation(handler as typeof fetch);
}

function lifecycle(overrides: Record<string, string>): string {
  return JSON.stringify({
    Type: "container",
    time: 1785592390,
    Actor: { ID: "abc", Attributes: { name: "/web", "com.docker.compose.project": "shop" } },
    ...overrides,
  });
}

/**
 * Docker's cpu counters are cumulative nanoseconds: between these two samples the container burned
 * 200 of the 1600 the whole system did, on a host with 4 cores, which is half a core
 */
function stats(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    cpu_stats: { cpu_usage: { total_usage: 1_200 }, system_cpu_usage: 11_600, online_cpus: 4 },
    precpu_stats: { cpu_usage: { total_usage: 1_000 }, system_cpu_usage: 10_000 },
    memory_stats: { usage: 1_000, limit: 8_000, stats: { inactive_file: 200 } },
    ...overrides,
  });
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function frame(streamVariant: 1 | 2, text: string): Uint8Array {
  const payload = encode(text);
  const buffer = new Uint8Array(8 + payload.length);
  buffer[0] = streamVariant;
  new DataView(buffer.buffer).setUint32(4, payload.length, false);
  buffer.set(payload, 8);
  return buffer;
}

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
}

async function collect<T>(generator: AsyncGenerator<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of generator) {
    collected.push(value);
  }
  return collected;
}
