import { Demo } from "@/models/copy/Demo";
import { useRegistry } from "../hooks/basics/useRegistry";

export function DemoBanner() {
  const { DOLOG_DEMO } = useRegistry("env");
  if (!DOLOG_DEMO) {
    return null;
  }
  return (
    <div className="py-2 flex flex-col items-center gap-2 bg-c-accent px-4 text-sm text-c-shell">
      <span className="font-bold">{Demo.description}</span>
    </div>
  );
}
