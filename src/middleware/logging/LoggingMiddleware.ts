import { Logger } from "@/Logger";
import { MiddlewareHandler } from "../MiddlewareHandler";

export class LoggingMiddleware implements MiddlewareHandler {
  private readonly log = new Logger(__filename);

  public async apply(request: Request, next: () => Promise<Response>): Promise<Response> {
    this.log.debug(request.url);
    return await next();
  }
}
