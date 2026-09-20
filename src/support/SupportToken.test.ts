import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { Temporal } from "@js-temporal/polyfill";
import { beforeAll, describe, expect, it } from "bun:test";
import crypto from "crypto";
import { SupportToken } from "./SupportToken";

describe("SupportToken", async () => {
  const Key = {
    private: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIHJKi9pEnwwX/RLR3EPWc7ln2SWAZj6o3Q1YkbyrWdf5\n-----END PRIVATE KEY-----",
    public: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAalpLQu9Fkn/R3WylORAad6UB0XAOowFIjF2/FwAyjpc=\n-----END PUBLIC KEY-----",
  };

  beforeAll(async () => {
    await TestEnvironment.initialize();
  });

  it("successfully validates a correct token", () => {
    // given
    const token = sign("v=1;t=1773490583;app=dolog;amt=1000;cur=usd");
    // when
    const supportToken = SupportToken.verify({ hexToken: encode(token), publicKey: Key.public });
    // then
    expect(supportToken).toBeDefined();
    expect(supportToken).toEqual({
      app: "dolog",
      amount: 1000,
      currency: "usd",
      timestamp: Temporal.Instant.fromEpochMilliseconds(1773490583 * 1000),
    });
  });

  it("returns undefined for an invalid signature", () => {
    const token = "v=1;t=1773490583;app=dolog;amt=1000;cur=usd;s=aW52YWxpZA==";
    expect(SupportToken.verify({ hexToken: encode(token), publicKey: Key.public })).toBeUndefined();
  });

  it("returns undefined for a tampered payload", () => {
    const token = sign("v=1;t=1773490583;app=dolog;amt=1000;cur=usd");
    const tampered = token.replace("amt=1000", "amt=9999");
    expect(SupportToken.verify({ hexToken: encode(tampered), publicKey: Key.public })).toBeUndefined();
  });

  it("returns undefined for a malformed token", () => {
    expect(SupportToken.verify({ hexToken: encode("garbage"), publicKey: Key.public })).toBeUndefined();
  });

  function sign(payload: string): string {
    const key = crypto.createPrivateKey(Key.private);
    const signature = crypto.sign(null, Buffer.from(payload), key);
    return `${payload};s=${signature.toString("base64")}`;
  }

  function encode(token: string): string {
    return Buffer.from(token, "utf-8").toString("hex");
  }
});
