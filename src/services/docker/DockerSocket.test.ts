import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import { DockerSocket } from "./DockerSocket";
import { StdStream } from "@/models/StdStream";

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
      respondWith(streamOf(frame(1, `${TIMESTAMP} GET / 200\n`), frame(2, `${TIMESTAMP} boom\n`)));
      // when
      const lines = await readLogs();
      // then
      expect(lines).toEqual([
        { stdStream: StdStream.out, timestamp: "2026-08-01T10:11:12.13Z", message: "GET / 200" },
        { stdStream: StdStream.err, timestamp: "2026-08-01T10:11:12.13Z", message: "boom" },
      ]);
    });

    it("should reassemble a frame that arrives across several chunks", async () => {
      // given
      const whole = frame(1, `${TIMESTAMP} hello world\n`);
      respondWith(streamOf(whole.subarray(0, 3), whole.subarray(3, 20), whole.subarray(20)));
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ message }) => message)).toEqual(["hello world"]);
    });

    it("should hold back a frame whose payload never completes", async () => {
      // given (the header promises more bytes than ever arrive)
      respondWith(streamOf(frame(1, `${TIMESTAMP} hello\n`).subarray(0, 12)));
      // when
      const lines = await readLogs();
      // then
      expect(lines).toEqual([]);
    });

    it("should read a tty container's stream as raw stdout", async () => {
      // given (no frame headers at all)
      respondWith(streamOf(encode(`${TIMESTAMP} first\n${TIMESTAMP} second\n`)));
      // when
      const lines = await readLogs({ tty: true });
      // then
      expect(lines).toEqual([
        { stdStream: StdStream.out, timestamp: "2026-08-01T10:11:12.13Z", message: "first" },
        { stdStream: StdStream.out, timestamp: "2026-08-01T10:11:12.13Z", message: "second" },
      ]);
    });

    it("should keep a line that has no parsable timestamp", async () => {
      // given
      respondWith(streamOf(frame(1, "no timestamp here\n")));
      // when
      const lines = await readLogs();
      // then
      expect(lines.map(({ message }) => message)).toEqual(["no timestamp here"]);
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
      expect(containers).toEqual([{ id: "abc", object: "container", name: "web", group: "stack" }]);
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
      expect(containers.map(({ name, group }) => ({ name, group }))).toEqual([
        { name: "one", group: "shop" },
        { name: "two", group: undefined },
      ]);
    });
  });

  describe("hasTty", () => {
    it("should read the tty flag off the container's config", async () => {
      // given
      respondWith(Response.json({ Config: { Tty: true } }));
      // then
      expect(await socket.hasTty("abc")).toBe(true);
    });
  });

  describe("streamLifecycle", () => {
    it("should read the modern `Action` field", async () => {
      // given
      respondWith(streamOf(encode(`${lifecycle({ Action: "start" })}\n${lifecycle({ Action: "die" })}\n`)));
      // when
      const events = await collect(socket.streamLifecycle(new AbortController().signal));
      // then
      expect(events.map(({ status }) => status)).toEqual(["start", "die"]);
      expect(events.at(0)?.container).toEqual({ id: "abc", object: "container", name: "web", group: "shop" });
    });

    it("should still read a legacy daemon's `status` field", async () => {
      // given
      respondWith(streamOf(encode(`${lifecycle({ status: "die" })}\n`)));
      // when
      const events = await collect(socket.streamLifecycle(new AbortController().signal));
      // then
      expect(events.map(({ status }) => status)).toEqual(["die"]);
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
        }),
      );
    });

    it("should turn an unreachable socket into a domain error", async () => {
      // given
      spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
      // then
      expect(socket.listRunningContainers()).rejects.toEqual(expect.objectContaining({ problem: "DockerError::socket_unreachable" }));
    });
  });

  async function readLogs({ tty = false }: { tty?: boolean } = {}) {
    const lines = await collect(socket.streamLogs("abc", tty, new AbortController().signal));
    return lines.map(({ stdStream, timestamp, message }) => ({ stdStream, timestamp: timestamp.toString(), message }));
  }
});

function respondWith(body: ReadableStream<Uint8Array> | Response) {
  const response = body instanceof Response ? body : new Response(body, { status: 200 });
  spyOn(globalThis, "fetch").mockResolvedValue(response);
}

function lifecycle(overrides: Record<string, string>): string {
  return JSON.stringify({
    Type: "container",
    time: 1785592390,
    Actor: { ID: "abc", Attributes: { name: "/web", "com.docker.compose.project": "shop" } },
    ...overrides,
  });
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function frame(stdStream: 1 | 2, text: string): Uint8Array {
  const payload = encode(text);
  const buffer = new Uint8Array(8 + payload.length);
  buffer[0] = stdStream;
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
