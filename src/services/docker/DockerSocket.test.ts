import { ContainerEvent } from "@/models/ContainerEvent";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it } from "bun:test";
import { DockerSocket } from "./DockerSocket";

describe(DockerSocket.name, () => {
  beforeEach(async () => {
    await TestEnvironment.initialize();
  });

  describe("readMultiplexedPayloads", () => {
    it("should split stdout and stderr apart", async () => {
      // given
      const body = streamOf(frame(1, "out\n"), frame(2, "err\n"));
      // when
      const payloads = await collect(DockerSocket.readMultiplexedPayloads(body));
      // then
      expect(payloads).toEqual([
        { stream: ContainerEvent.Stream.stdout, text: "out\n" },
        { stream: ContainerEvent.Stream.stderr, text: "err\n" },
      ]);
    });

    it("should reassemble a frame that arrives across several chunks", async () => {
      // given
      const whole = frame(1, "hello world\n");
      const body = streamOf(whole.subarray(0, 3), whole.subarray(3, 10), whole.subarray(10));
      // when
      const payloads = await collect(DockerSocket.readMultiplexedPayloads(body));
      // then
      expect(payloads).toEqual([{ stream: ContainerEvent.Stream.stdout, text: "hello world\n" }]);
    });

    it("should hold back a frame until its payload is complete", async () => {
      // given (the header promises more bytes than ever arrive)
      const truncated = frame(1, "hello").subarray(0, 10);
      const body = streamOf(truncated);
      // when
      const payloads = await collect(DockerSocket.readMultiplexedPayloads(body));
      // then
      expect(payloads).toEqual([]);
    });
  });

  describe("readLogLine", () => {
    it("should lift docker's timestamp prefix out of the message", () => {
      // when
      const line = DockerSocket.readLogLine(ContainerEvent.Stream.stdout, "2026-08-01T10:11:12.130000000Z GET / 200");
      // then
      expect(line.timestamp.toString()).toEqual("2026-08-01T10:11:12.13Z");
      expect(line.message).toEqual("GET / 200");
    });

    it("should keep a line that has no parsable timestamp", () => {
      // when
      const line = DockerSocket.readLogLine(ContainerEvent.Stream.stderr, "no timestamp here");
      // then
      expect(line.message).toEqual("no timestamp here");
      expect(line.timestamp).toBeDefined();
    });
  });

  describe("readGroup", () => {
    it("should prefer the swarm stack over the compose project", () => {
      // then
      expect(DockerSocket.readGroup({ "com.docker.stack.namespace": "stack", "com.docker.compose.project": "project" })).toEqual("stack");
      expect(DockerSocket.readGroup({ "com.docker.compose.project": "project" })).toEqual("project");
      expect(DockerSocket.readGroup(null)).toBeUndefined();
    });
  });
});

function frame(stream: 1 | 2, text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const buffer = new Uint8Array(8 + payload.length);
  buffer[0] = stream;
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
