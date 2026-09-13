import z from "zod/v4";

export type LocalStorageStore<T> = {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
  modify(patch: Partial<T>): void;
};

export namespace LocalStorageStore {
  const INSTANCES = new Map<string, unknown>();

  export function sharedModuleInstance<S extends z.ZodObject>({
    key,
    schema,
    defaults,
  }: {
    key: string;
    schema: S;
    defaults: z.output<S>;
  }): LocalStorageStore<z.output<S>> {
    type Value = z.output<S>;

    const existing = INSTANCES.get(key) as LocalStorageStore<Value> | undefined;
    if (existing) {
      return existing;
    }

    // make each field fall back on its own default
    const fallbacks = defaults as Record<string, unknown>;
    const shape = z
      .object(Object.fromEntries(Object.entries(schema.shape).map(([name, field]) => [name, field.catch(fallbacks[name])])))
      .catch(defaults);

    function load(): Value {
      try {
        return shape.parse(JSON.parse(localStorage.getItem(key) ?? "{}")) as Value;
      } catch {
        return defaults;
      }
    }

    const snapshot = {
      value: load(),
    };

    function getSnapshot() {
      return snapshot.value;
    }

    const listeners = new Set<() => void>();

    function notify() {
      listeners.forEach((listener) => listener());
    }

    function subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key === key) {
          snapshot.value = load();
          notify();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    }

    function modify(patch: Partial<Value>) {
      snapshot.value = { ...snapshot.value, ...patch }; // new object, since react only re-renders when the snapshot's identity changes
      localStorage.setItem(key, JSON.stringify(snapshot.value));
      notify(); // browser only invokes the `onStorage` callback for _other_ tabs when there's been a write
    }

    const store: LocalStorageStore<Value> = {
      getSnapshot,
      subscribe,
      modify,
    };
    INSTANCES.set(key, store);
    return store;
  }
}
