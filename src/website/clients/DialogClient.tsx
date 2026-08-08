import { Temporal } from "@js-temporal/polyfill";
import { DialogManager } from "../comps/DialogManager";
import { JumpModal } from "../comps/JumpModal";
import { RangeModal } from "../comps/RangeModal";
import { LogRange } from "../models/LogRange";

export class DialogClient {
  private _manager: DialogManager.Api | null = null;

  private get manager() {
    if (!this._manager) throw new Error(`Must initialize the ${DialogClient.name} before use`);
    return this._manager;
  }

  public initialize(manager: DialogManager.Api | null) {
    this._manager = manager;
  }

  public jumpTo(current?: Temporal.Instant): Promise<"cancel" | Temporal.Instant> {
    type Result = Awaited<ReturnType<typeof this.jumpTo>>;
    const { promise, resolve: internalResolve } = Promise.withResolvers<Result>();
    const resolve = (result: Result) => {
      internalResolve(result);
      this.manager.remove({ token });
    };
    const { token } = this.manager.insert(
      <JumpModal current={current} close={() => resolve("cancel")} done={(instant) => resolve(instant)} />,
    );
    return promise;
  }

  public pickRange(current: LogRange.Value): Promise<"cancel" | LogRange.Value> {
    type Result = Awaited<ReturnType<typeof this.pickRange>>;
    const { promise, resolve: internalResolve } = Promise.withResolvers<Result>();
    const resolve = (result: Result) => {
      internalResolve(result);
      this.manager.remove({ token });
    };
    const { token } = this.manager.insert(
      <RangeModal current={current} close={() => resolve("cancel")} done={(value) => resolve(value)} />,
    );
    return promise;
  }
}
