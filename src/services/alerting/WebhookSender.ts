import { AlertError } from "@/errors/AlertError";
import { Alert } from "@/models/Alert";
import { Webhook } from "@/models/Webhook";
import { Temporal } from "@js-temporal/polyfill";

export class WebhookSender {
  public async post({ url, auth }: Webhook, alert: Alert): Promise<void> {
    const TIMEOUT = Temporal.Duration.from({ seconds: 10 });

    const headers = new Headers({ "Content-Type": "application/json" });
    if (auth) {
      headers.set("Authorization", `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString("base64")}`);
    }
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(TIMEOUT.total("milliseconds")),
    }).catch((cause) => {
      throw AlertError.webhook_unreachable({ url, reason: `${cause}` });
    });
    if (!response.ok) {
      throw AlertError.webhook_refused({ url, status: response.status });
    }
  }
}
