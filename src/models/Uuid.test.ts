import { ServerError } from "@/errors/ServerError";
import { describe, expect, it } from "bun:test";
import { Uuid } from "./Uuid";

describe("Uuid", () => {
  it("should round-trip a uuid through its bytes", () => {
    // given
    const uuid = Bun.randomUUIDv7();
    // when
    const bytes = Uuid.toBytes(uuid);
    // then
    expect(bytes).toHaveLength(16);
    expect(Uuid.fromBytes(bytes)).toEqual(uuid);
  });

  it("should sort as bytes in the same order as it sorts as text", () => {
    // given (generated in order, so text order is creation order)
    const uuids = Array.from({ length: 500 }, () => Bun.randomUUIDv7());
    const shuffled = uuids.toSorted(() => Math.random() - 0.5);

    // when
    const byText = shuffled.toSorted((a, b) => a.localeCompare(b));
    const byBytes = shuffled
      .map((uuid) => Uuid.toBytes(uuid))
      .toSorted(Buffer.compare)
      .map((bytes) => Uuid.fromBytes(bytes));

    // then (both agree, and both recover the order they were minted in)
    expect(byBytes).toEqual(byText);
    expect(byBytes).toEqual(uuids);
  });

  it("should refuse anything that is not a uuid, rather than truncating it", () => {
    // `Buffer.from("zz", "hex")` quietly returns nothing at all, which would sort before every real id
    expect(() => Uuid.toBytes("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz")).toThrow(ServerError.NAME);
    expect(() => Uuid.toBytes("019fc7bf-828c-7fff")).toThrow(ServerError.NAME);
    expect(() => Uuid.toBytes("")).toThrow(ServerError.NAME);
  });
});
