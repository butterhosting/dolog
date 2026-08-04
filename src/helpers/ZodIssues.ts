import z from "zod/v4";

export namespace ZodProblem {
  export function issuesSummary(e: z.core.$ZodCatchCtx): { issues: { field: string; description: string }[] } {
    return {
      issues: e.issues
        .filter((issue) => Boolean(issue.path))
        .map((issue) => {
          return {
            field: issue.path!.map((propertyKey) => propertyKey.toString()).join("."),
            description: issue.code,
          };
        }),
    };
  }
}
