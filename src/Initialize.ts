const INITIALIZERS = Symbol("initializers");

export function Initialize(target: object, propertyKey: string): void {
  const holder = target as { [INITIALIZERS]?: string[] };
  if (!Object.hasOwn(holder, INITIALIZERS)) {
    holder[INITIALIZERS] = [...(holder[INITIALIZERS] ?? [])];
  }
  holder[INITIALIZERS]!.push(propertyKey);
}

export namespace Initialize {
  export async function runAll(instance: object): Promise<void> {
    const marked = (instance as { [INITIALIZERS]?: string[] })[INITIALIZERS] ?? [];
    for (const method of marked) {
      await (instance as Record<string, () => unknown>)[method]!();
    }
  }
}
