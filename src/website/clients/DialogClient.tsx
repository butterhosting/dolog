import { Range } from "@/website/hooks/objects/Range";
import { Temporal } from "@js-temporal/polyfill";
import { DialogManager } from "../comps/basics/DialogManager";
import { NavigateDialog } from "../comps/dialogs/NavigateDialog";
import { PreferencesDialog } from "../comps/dialogs/PreferencesDialog";
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

  // Nothing comes back: the dialog writes each preference as it gets flipped
  public openPreferencesDialog(): Promise<void> {
    const { promise, resolve: internalResolve } = Promise.withResolvers<void>();
    const resolve = () => {
      internalResolve();
      this.manager.remove({ token });
    };
    const { token } = this.manager.insert(<PreferencesDialog close={resolve} />);
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
