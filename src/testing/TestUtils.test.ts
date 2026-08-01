export namespace TestUtils {
  export async function waitUntil<T>(
    fn: () => T | Promise<T>,
    condition: (result: T) => boolean,
    { timeout = 5000, interval = 25 }: { timeout?: number; interval?: number } = {},
  ): Promise<T> {
    const startTime = Date.now();
    while (true) {
      const result = await fn();
      if (condition(result)) {
        return result;
      }
      if (Date.now() - startTime >= timeout) {
        throw new Error(`waitUntil timeout after ${timeout}ms`);
      }
      await sleep(interval);
    }
  }

  export function sleep(milliseconds: number) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
