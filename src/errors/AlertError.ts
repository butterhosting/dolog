import { Yexception } from "yexception";

export class AlertError {
  public static readonly NAME = "AlertError";

  public static readonly unknown_webhook = Yexception.field<{ webhookRef: string }>();
  public static readonly webhook_unreachable = Yexception.field<{ url: string; reason: string }>();
  public static readonly webhook_refused = Yexception.field<{ url: string; status: number }>();

  static {
    Yexception.initialize(this);
  }
}
