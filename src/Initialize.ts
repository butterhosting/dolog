const INITIALIZERS = Symbol("initializers");

/**
 * Marks a method to be run once at start-up.
 *
 * {@link ServerRegistry} runs every marked method on every registered instance, in registration
 * order -- which is already dependency order, because a dependency has to exist as a variable
 * before it can be passed to whatever needs it. So nothing has to be listed anywhere, and nothing
 * can be started before what it depends on.
 *
 * The mark lands on the prototype, which is why instances read it back for free -- so it goes on a
 * method and not on a field holding an arrow function, which would never reach the prototype.
 *
 * Marked methods are public. The registry calls them from outside, so `private` would be a claim the
 * code does not honour, and `noUnusedLocals` rejects it anyway: nothing in the file calls them.
 */
export function Initialize(target: object, propertyKey: string): void {
  const holder = target as { [INITIALIZERS]?: string[] };
  // copied rather than appended to, so a subclass never pushes into a list its parent shares
  if (!Object.hasOwn(holder, INITIALIZERS)) {
    holder[INITIALIZERS] = [...(holder[INITIALIZERS] ?? [])];
  }
  holder[INITIALIZERS]!.push(propertyKey);
}

export namespace Initialize {
  /** Runs everything marked on one instance -- for the registry, and for tests standing in for it. */
  export function runAll(instance: object): void {
    const marked = (instance as { [INITIALIZERS]?: string[] })[INITIALIZERS] ?? [];
    marked.forEach((method) => (instance as Record<string, () => void>)[method]!());
  }
}
