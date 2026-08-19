import { Yexception } from "yexception";

export class LogError {
  public static readonly NAME = "LogError";

  public static readonly conflicting_position = Yexception.field<{
    at?: string;
    cursor?: {
      before?: string;
      after?: string;
      afterInclusive?: string;
    };
  }>();
  public static readonly conflicting_search_anchor = Yexception.field<{ anchorInclusive: string; anchorExclusive: string }>();
  public static readonly invalid_regex_pattern = Yexception.field<{ pattern: string; reason: string }>();

  static {
    Yexception.initialize(this);
  }
}
