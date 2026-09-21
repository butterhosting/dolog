import { FullConfig, request } from "@playwright/test";
import { AppBoundary } from "./boundaries/AppBoundary";

/**
 * Once per run rather than before each test: what these tests read is a live stream, and after a purge it
 * takes trickle ~40 seconds to have two pages of history again (see `LogsFlow.open`).
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const context = await request.newContext({ baseURL: config.projects[0]!.use.baseURL });
  await AppBoundary.purge(context);
  await context.dispose();
}
