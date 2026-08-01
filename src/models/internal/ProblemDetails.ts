export type ProblemDetails = {
  problem: string;
  details?: Record<string, any>;
};

export namespace ProblemDetails {
  export function isInstance(value: any): value is ProblemDetails {
    return typeof value?.problem === "string";
  }
}
