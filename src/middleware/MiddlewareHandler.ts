export interface MiddlewareHandler {
  apply(request: Request, next: () => Promise<Response>): Promise<Response>;
}
