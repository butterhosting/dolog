import { Env } from "@/Env";
import { AlertError } from "@/errors/AlertError";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Alert } from "@/models/Alert";
import { Container } from "@/models/Container";
import { ContainerEvent } from "@/models/ContainerEvent";
import { ContainerLabelConfig } from "@/models/ContainerLabelConfig";
import { Svc } from "@/models/Svc";
import { Throughput } from "@/models/Throughput";
import { Temporal } from "@js-temporal/polyfill";
import { catchError, debounce, defer, EMPTY, from, groupBy, merge, mergeMap, Observable, of, pipe, throttle, timer } from "rxjs";
import { WebhookSender } from "./alerting/WebhookSender";
import { Fountain } from "./streaming/Fountain";
import { ThrottleService } from "./streaming/ThrottleService";
import { Webhook } from "@/models/Webhook";

export class AlertingService {
  private readonly log = new Logger(__filename);
  private readonly events: Observable<ContainerEvent>;
  private readonly throughputs: Observable<Throughput[]>;

  public constructor(
    fountain: Fountain,
    throttleService: ThrottleService,
    private readonly env: Env.Private,
    private readonly webhookSender: WebhookSender,
  ) {
    this.events = fountain.streamEvents();
    this.throughputs = throttleService.streamThroughputs();
  }

  @Initialize
  public notifyWebhooksOfAlerts() {
    merge(this.events.pipe(this.detectTextAlerts()), this.throughputs.pipe(this.detectThroughputAlerts()))
      .pipe(
        this.coolDownPerSvc(),
        mergeMap((candidate) =>
          defer(() => this.deliver(candidate)).pipe(
            catchError((error) => {
              this.log.warn(`Could not deliver a ${candidate.alert.type} alert for ${candidate.alert.svc.dname}`, error);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe({
        error: (error) => this.log.error("Stopped alerting", error),
      });
  }

  private detectTextAlerts() {
    return pipe(
      mergeMap((event: ContainerEvent): Observable<AlertingService.Candidate> => {
        if (event.type !== ContainerEvent.Type.log) {
          return EMPTY;
        }
        const { alertingWebhookRef, alertingTextPattern, alertingCooldownWindow } = this.getConfig(event.container);
        if (!alertingWebhookRef || !alertingTextPattern?.test(event.line)) {
          return EMPTY;
        }
        return of<AlertingService.Candidate>({
          webhookRef: alertingWebhookRef,
          cooldown: alertingCooldownWindow,
          alert: {
            ...this.commonAlertProps(event.container),
            type: Alert.Type.text,
            containerEventId: event.id,
            match: {
              pattern: alertingTextPattern.source,
              line: event.line,
            },
          },
        });
      }),
    );
  }

  private detectThroughputAlerts() {
    return pipe(
      mergeMap((throughputs: Throughput[]) => from(throughputs)),
      mergeMap(({ container, logsPerSecond }): Observable<AlertingService.Candidate> => {
        const { alertingWebhookRef, alertingThroughputThreshold, alertingCooldownWindow } = this.getConfig(container);
        if (!alertingWebhookRef || alertingThroughputThreshold === undefined || logsPerSecond <= alertingThroughputThreshold) {
          return EMPTY;
        }
        return of<AlertingService.Candidate>({
          webhookRef: alertingWebhookRef,
          cooldown: alertingCooldownWindow,
          alert: {
            ...this.commonAlertProps(container),
            type: Alert.Type.throughput,
            breach: {
              threshold: alertingThroughputThreshold,
              logsPerSecond,
            },
          },
        });
      }),
    );
  }

  private coolDownPerSvc() {
    const createCooldownTimer = (candidate: AlertingService.Candidate) => timer(candidate.cooldown.total("milliseconds"));
    return pipe(
      groupBy(({ alert }: AlertingService.Candidate) => `${alert.type}:${alert.svc.id}`, {
        // a group may only go once it has been quiet for a whole cooldown, or its successor would alert early
        duration: (group) => group.pipe(debounce(createCooldownTimer)),
      }),
      mergeMap((group) => group.pipe(throttle(createCooldownTimer))),
    );
  }

  private async deliver({ webhookRef, alert }: AlertingService.Candidate): Promise<void> {
    const webhook: Webhook | undefined = this.env.DOLOG_WEBHOOKS[webhookRef];
    if (!webhook) {
      throw AlertError.unknown_webhook({ webhookRef });
    }
    await this.webhookSender.post(webhook, alert);
    this.log.info(`Sent a ${alert.type} alert for ${alert.svc.dname} to ${webhookRef}`);
  }

  private commonAlertProps({ dname, dgroup }: Container) {
    return {
      id: Bun.randomUUIDv7(),
      object: "alert" as const,
      timestamp: Temporal.Now.instant(),
      svc: { id: Svc.encodeId({ dname, dgroup }), dname, dgroup },
    };
  }

  private getConfig(container: Container): ContainerLabelConfig {
    return ContainerLabelConfig.resolve(this.env, container.dlabels).config;
  }
}

export namespace AlertingService {
  export type Candidate = {
    webhookRef: string;
    cooldown: Temporal.Duration;
    alert: Alert;
  };
}
