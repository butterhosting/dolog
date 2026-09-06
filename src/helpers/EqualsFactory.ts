export namespace EqualsFactory {
  type ComparatorObject<T> = {
    [K in keyof T]: (a: T[K], b: T[K]) => boolean;
  };

  export function createEquals<T>(obj: ComparatorObject<T>) {
    const equals = (x: T | undefined, y: T | undefined): boolean => {
      if (x === undefined) {
        return y === undefined;
      }
      if (y === undefined) {
        return x === undefined;
      }
      const xCopy: T = x;
      const yCopy: T = y;
      for (const entry of Object.entries(obj)) {
        const key = entry[0] as keyof T;
        const fn = entry[1] as ComparatorObject<T>[keyof T];
        const same = fn(xCopy[key], yCopy[key]);
        if (!same) {
          return false;
        }
      }
      return true;
    };
    equals.COMPARISON_OBJECT = obj;
    return equals;
  }
}
