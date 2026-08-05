import { Yexception } from "yexception";

export class ServerError {
  public static readonly NAME = "ServerError";

  public static readonly unknown = Yexception.field();
  public static readonly socket_upgrade_failed = Yexception.field();
  public static readonly route_not_found = Yexception.field();
  public static readonly malformed_uuid = Yexception.field();
  public static readonly invalid_request_query = Yexception.field();
  public static readonly conflicting_log_position = Yexception.field();
  public static readonly invalid_search_pattern = Yexception.field();

  static {
    Yexception.initialize(this);
  }
}
