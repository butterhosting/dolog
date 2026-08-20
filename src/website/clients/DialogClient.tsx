import { Range } from "@/website/hooks/objects/Range";
import { Temporal } from "@js-temporal/polyfill";
import { DialogManager } from "../comps/basics/DialogManager";
import { NavigateDialog } from "../comps/dialogs/NavigateDialog";
import { RangeDialog } from "../comps/dialogs/RangeDialog";

export class DialogClient {
  private _manager: DialogManager.Api | null = null;

  private get manager() {
    if (!this._manager) throw new Error(`Must initialize the ${DialogClient.name} before use`);
    return this._manager;
  }

  public initialize(manager: DialogManager.Api | null) {
    this._manager = manager;
  }

  public promptTimestampNavigationDialog(current?: Temporal.Instant): Promise<"cancel" | Temporal.Instant> {
    type Result = Awaited<ReturnType<typeof this.promptTimestampNavigationDialog>>;
    const { promise, resolve: internalResolve } = Promise.withResolvers<Result>();
    const resolve = (result: Result) => {
      internalResolve(result);
      this.manager.remove({ token });
    };
    const { token } = this.manager.insert(
      <NavigateDialog current={current} close={() => resolve("cancel")} done={(instant) => resolve(instant)} />,
    );
    return promise;
  }

  public promptRangeDialog(current: Range): Promise<"cancel" | Range> {
    type Result = Awaited<ReturnType<typeof this.promptRangeDialog>>;
    const { promise, resolve: internalResolve } = Promise.withResolvers<Result>();
    const resolve = (result: Result) => {
      internalResolve(result);
      this.manager.remove({ token });
    };
    const { token } = this.manager.insert(
      <RangeDialog current={current} close={() => resolve("cancel")} done={(value) => resolve(value)} />,
    );
    return promise;
  }
}
