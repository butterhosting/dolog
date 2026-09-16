export type ExtractBetter<T, U extends T> = T extends U ? T : never;
