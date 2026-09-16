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
    const INSTANCE_WIDE = ["O_DOLOG_TIMEZONE", "X_DOLOG_LOGGING", "X_DOLOG_DOCKER_SOCKET"] satisfies Env.Defaultable[];
    const prefix = this.env.X_DOLOG_CONTAINER_LABEL_PREFIX;

    const instanceWide = INSTANCE_WIDE.map((key) => this.setting(key));
    const perContainer = Object.values(ContainerLabelConfig.Settings).map(({ name, envKey }) => ({
      ...this.setting(envKey),
      containerLabel: {
        name: `${prefix}${name}`,
        overrides: svcs
          .filter(({ dlabels }) => dlabels[name] !== undefined)
          .map((svc) => ({
            dname: svc.dname,
            dgroup: svc.dgroup,
            value: svc.dlabels[name]!,
            valid: !ContainerLabelConfig.resolve(this.env, svc.dlabels).issues.some((issue) => issue.label === `${prefix}${name}`),
            stopped: !svc.liveStats,
          })),
      },
    }));
    return { settings: [...instanceWide, ...perContainer] };
  }

  private setting(key: Env.Defaultable): Configuration.Setting {
    return {
      envVar: Env.realEnvName(key),
      envValue: this.env.X_DOLOG_PROVIDED[key],
      defaultValue: Env.Defaults[key],
    };
  }
}
