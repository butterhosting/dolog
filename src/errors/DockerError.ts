import { Yexception } from "yexception";

export class DockerError {
  public static readonly NAME = "DockerError";

  public static readonly socket_unreachable = Yexception.field<{ socket: string; reason?: string }>();
  public static readonly unexpected_response = Yexception.field<{ path: string; status: number }>();
  public static readonly empty_response_body = Yexception.field<{ path: string }>();
  public static readonly unknown_container = Yexception.field<{ id: string }>();

  static {
    Yexception.initialize(this);
  }
}
