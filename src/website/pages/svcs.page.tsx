import { SvcCard } from "../comps/SvcCard";
import { Frame } from "../comps/basics/Frame";
import { Paper } from "../comps/basics/Paper";
import { Spinner } from "../comps/basics/Spinner";
import { useDocumentTitle } from "../hooks/basics/useDocumentTitle";
import { useSvcs } from "../hooks/useSvcs";

export function svcsPage() {
  useDocumentTitle("Services | Dolog");
  const svcs = useSvcs();

  if (!svcs) {
    return (
      <Frame>
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      </Frame>
    );
  }
  return (
    <Frame>
      {svcs.length === 0 && (
        <Paper className="px-6 py-12 text-center">
          <span className="text-sm tracking-wide text-c-rule">NO SERVICES</span>
        </Paper>
      )}
      <div className="grid grid-cols-3 lg:grid-cols-2 sm:grid-cols-1 gap-4">
        {svcs.map((svc) => (
          <SvcCard key={svc.id} svc={svc} />
        ))}
      </div>
    </Frame>
  );
}
