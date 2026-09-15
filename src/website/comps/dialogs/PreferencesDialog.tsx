import { usePreferences } from "@/website/hooks/usePreferences";
import { Button } from "../basics/Button";
import { Dialog } from "../basics/Dialog";

type Props = {
  close: () => void;
};
export function PreferencesDialog({ close }: Props) {
  const { hideStoppedSvcs, modify } = usePreferences();
  return (
    <Dialog isOpen issueCloseRequestWhenClickingBackdrop issueCloseRequestWhenPressingEscape onCloseRequest={close} className="p-6">
      <div className="flex flex-col gap-5">
        <h2 className="text-lg font-bold">Preferences</h2>

        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={hideStoppedSvcs}
            onChange={(event) => modify({ hideStoppedSvcs: event.target.checked })}
            className="size-4 accent-c-accent"
          />
          <span className="text-sm">Hide stopped services from the overview page(s)</span>
        </label>

        <div className="flex justify-end">
          <Button variant="filled" theme="neutral" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
