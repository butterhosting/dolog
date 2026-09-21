import { Initialize } from "@/Initialize";
import { TestEnvironment } from "@/testing/TestEnvironment.test";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { rm } from "fs/promises";
import { BasicAuthMiddleware } from "./BasicAuthMiddleware";

describe(BasicAuthMiddleware.name, () => {
  let context: TestEnvironment.Context;

  beforeEach(async () => {
    context = await TestEnvironment.initialize();
    await rm(context.env.DOLOG_HTPASSWD, { force: true });
  });

  const next = () => mock(async () => new Response("let through"));

  const basic = (username: string, password: string) => ({
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  });

  const request = (pathname: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${pathname}`, { headers });

  async function middlewareWith(users: Record<string, string> | undefined): Promise<BasicAuthMiddleware> {
    if (users) {
      const lines = await Promise.all(
        // the cheapest bcrypt there is; the cost is not what is under test
        Object.entries(users).map(async ([username, password]) => `${username}:${await Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 })}`),
      );
      await Bun.write(context.env.DOLOG_HTPASSWD, lines.join("\n") + "\n");
    }
    const middleware = new BasicAuthMiddleware(context.env);
    await Initialize.runAll(middleware);
    return middleware;
  }

  it("should let everything through when there is no .htpasswd", async () => {
    // given
    const middleware = await middlewareWith(undefined);
    const handler = next();

    // when
    const response = await middleware.apply(request("/internal-api/svcs"), handler);

    // then
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  describe("with an .htpasswd", () => {
    type TestCase = {
      name: string;
      pathname: string;
      headers: Record<string, string>;
      expectation: {
        status: number;
      };
    };
    const testCases: TestCase[] = [
      { name: "no credentials", pathname: "/internal-api/svcs", headers: {}, expectation: { status: 401 } },
      { name: "a wrong password", pathname: "/internal-api/svcs", headers: basic("kim", "impossible"), expectation: { status: 401 } },
      { name: "an unknown user", pathname: "/internal-api/svcs", headers: basic("ron", "possible"), expectation: { status: 401 } },
      { name: "something that is not basic auth", pathname: "/internal-api/svcs", headers: { Authorization: "Bearer possible" }, expectation: { status: 401 } },
      { name: "the right credentials", pathname: "/internal-api/svcs", headers: basic("kim", "possible"), expectation: { status: 200 } },
      { name: "the right credentials, on the websocket", pathname: "/socket", headers: basic("kim", "possible"), expectation: { status: 200 } },
      { name: "no credentials, on the websocket", pathname: "/socket", headers: {}, expectation: { status: 401 } },
      { name: "a password with colons in it", pathname: "/internal-api/svcs", headers: basic("shego", "a:b:c"), expectation: { status: 200 } },
      { name: "no credentials, on the healthcheck", pathname: "/health", headers: {}, expectation: { status: 200 } },
    ];
    for (const { name, pathname, headers, expectation } of testCases) {
      it(`should answer ${expectation.status} to ${name}`, async () => {
        // given
        const middleware = await middlewareWith({ kim: "possible", shego: "a:b:c" });
        const handler = next();

        // when
        const response = await middleware.apply(request(pathname, headers), handler);

        // then
        expect(response.status).toBe(expectation.status);
        expect(handler).toHaveBeenCalledTimes(expectation.status === 200 ? 1 : 0);
        if (expectation.status === 401) {
          expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
        }
      });
    }

    it("should refuse, rather than fail, when a hash is in a format bun cannot verify", async () => {
      // given (apache's own md5, which is what `htpasswd` writes without -B)
      await Bun.write(context.env.DOLOG_HTPASSWD, "kim:$apr1$lZL6V/ci$eIMz/iKDkbtys/uU7LEK00\n");
      const middleware = new BasicAuthMiddleware(context.env);
      await Initialize.runAll(middleware);
      const handler = next();

      // when
      const response = await middleware.apply(request("/internal-api/svcs", basic("kim", "possible")), handler);

      // then
      expect(response.status).toBe(401);
      expect(handler).toHaveBeenCalledTimes(0);
    });
  });
});
