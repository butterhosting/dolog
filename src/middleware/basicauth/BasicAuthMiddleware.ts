import { Env } from "@/Env";
import { ServerError } from "@/errors/ServerError";
import { AuthHelper } from "@/helpers/AuthHelper";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Credentials } from "@/models/Credentials";
import { ServerEndpoint } from "@/ServerEndpoint";
import { MiddlewareHandler } from "../MiddlewareHandler";

type HashedCredentials = {
  username: string;
  passwordHash: string;
};

export class BasicAuthMiddleware implements MiddlewareHandler {
  private readonly log = new Logger(__filename);

  private enabled?: boolean;
  private hashedCredentials?: HashedCredentials[];

  public constructor(private readonly env: Env.Private) {}

  @Initialize
  public async initializeFromDisk() {
    const htpasswd = Bun.file(this.env.DOLOG_HTPASSWD);
    if (await htpasswd.exists()) {
      const content = await htpasswd.text();
      this.enabled = true;
      this.hashedCredentials = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.includes(":"))
        .map((line) => ({ username: line.slice(0, line.indexOf(":")), passwordHash: line.slice(line.indexOf(":") + 1) }));
      this.log.info(`Basic auth is on, for the ${this.hashedCredentials.length} user(s) in ${this.env.DOLOG_HTPASSWD}`);
    } else {
      this.enabled = false;
    }
  }

  public async apply(request: Request, next: () => Promise<Response>): Promise<Response> {
    if (typeof this.enabled !== "boolean") {
      throw new Error(`Please call \`${"initializeFromDisk" satisfies keyof typeof this}\` first`);
    }
    const { pathname } = new URL(request.url);
    if (this.enabled && !Object.values<string>(ServerEndpoint.Public).includes(pathname)) {
      const { accessGranted } = await this.authenticate(request.headers);
      if (!accessGranted) {
        return Response.json(ServerError.unauthorized().problemDetails(), {
          status: 401,
          headers: { "WWW-Authenticate": "Basic" },
        });
      }
    }
    return await next();
  }

  private async authenticate(headers: Headers): Promise<{ accessGranted: boolean }> {
    const credentials = AuthHelper.extractBasicAuth(headers.get("Authorization"));
    if (!credentials) {
      return { accessGranted: false };
    }
    const validCredentials = await this.validateCredentials(credentials);
    if (!validCredentials) {
      return { accessGranted: false };
    }
    return { accessGranted: true };
  }

  private async validateCredentials(credentials: Credentials): Promise<boolean> {
    if (!this.hashedCredentials) {
      throw new Error(`Please call \`${"initializeFromDisk" satisfies keyof typeof this}\` first`);
    }
    for (const { username, passwordHash } of this.hashedCredentials) {
      if (credentials.username === username) {
        // bun verifies bcrypt and argon2, and throws on anything else (apache's own md5, say)
        const verified = await Bun.password.verify(credentials.password, passwordHash).catch((error) => {
          this.log.warn(`The password hash of ${username} could not be read; use bcrypt (htpasswd -B)`, error);
          return false;
        });
        if (verified) {
          return true;
        }
      }
    }
    return false;
  }
}
