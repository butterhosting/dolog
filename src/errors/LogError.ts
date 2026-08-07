import { Yexception } from "yexception";

export class LogError {
  public static readonly NAME = "LogError";

  public static readonly conflicting_position = Yexception.field<{
    at: string;
    before: string | null;
    after: string | null;
    from: string | null;
  }>();
  public static readonly invalid_search_pattern = Yexception.field<{ pattern: string; reason: string }>();

  static {
    Yexception.initialize(this);
  }
}
