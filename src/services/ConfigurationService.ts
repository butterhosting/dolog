import { Env } from "@/Env";
import { Initialize } from "@/Initialize";
import { Logger } from "@/Logger";
import { Configuration } from "@/models/Configuration";
import { ContainerLabelConfig } from "@/models/ContainerLabelConfig";
import { Svc } from "@/models/Svc";
import { distinctUntilChanged, filter, firstValueFrom, map, Observable, ReplaySubject, share } from "rxjs";
import { SocketService } from "./SocketService";
import { SvcService } from "./SvcService";

export class ConfigurationService {
  private readonly log = new Logger(__filename);
  private readonly configuration: Observable<Configuration>;

  public constructor(
    private readonly env: Env.Private,
    svcService: SvcService,
    private readonly socketService: SocketService,
  ) {
    this.configuration = svcService.streamSvcs().pipe(
      map((svcs) => this.snapshot(svcs)),
      distinctUntilChanged((a, b) => Bun.deepEquals(a, b)),
      share({
        connector: () => new ReplaySubject(1),
        resetOnRefCountZero: false,
      }),
    );
  }

  @Initialize
  public broadcastConfigurationStream() {
    this.configuration.pipe(filter(() => this.socketService.hasConnections())).subscribe({
      next: (configuration) => this.socketService.broadcastConfigurationStream(configuration),
      error: (error) => this.log.error("Stopped pushing configuration updates", error),
    });
  }

  public async get(): Promise<Configuration> {
    return firstValueFrom(this.configuration);
  }

  public snapshot(svcs: Svc[]): Configuration {
    const INSTANCE_WIDE = ["DOLOG_TIMEZONE", "DOLOG_LOGGING", "DOLOG_WEBHOOKS"] satisfies Configuration.EnvVar[];
    const prefix = this.env.DOLOG_CONTAINER_LABEL_PREFIX;

    const instanceWide = INSTANCE_WIDE.map((key) => this.setting(key));
    const perContainer = Object.values(ContainerLabelConfig.Settings).map(({ name, envKey }) => ({
      ...this.setting(envKey),
      containerLabel: {
        name: `${prefix}${name}`,
        overrides: svcs
          .filter(({ mostRecentContainer }) => mostRecentContainer.dlabels[name] !== undefined)
          .map(({ dname, dgroup, mostRecentContainer: { dlabels, liveStats } }) => ({
            dname,
            dgroup,
            value: dlabels[name]!,
            valid: !ContainerLabelConfig.resolve(this.env, dlabels).issues.some((issue) => issue.label === `${prefix}${name}`),
            stopped: !liveStats,
          })),
      },
    }));
    return { settings: [...instanceWide, ...perContainer] };
  }

  private setting(key: Configuration.EnvVar): Configuration.Setting {
    return {
      envVar: key,
      envValue: (() => {
        switch (key) {
          case "DOLOG_WEBHOOKS": {
            const entries = Object.entries(this.env.DOLOG_WEBHOOKS);
            return entries.length > 0 ? entries.map(([name, webhook]) => `${name} = ${webhook.url}`).join("\n") : undefined;
          }
          default: {
            return this.env.DOLOG_PROVIDED[key];
          }
        }
      })(),
      defaultValue: Env.Defaults[key],
    };
  }
}
