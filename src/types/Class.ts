export type Class<T = any> = Function & {
  new (...args: any[]): T;
};
