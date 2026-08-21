import clsx from "clsx";

type Props = {
  active: boolean;
  onClick: () => void;
};
export function RegexToggle({ active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      title="read this as a regular expression"
      className={clsx(
        "rounded border px-1.5 py-0.5 font-mono text-[11px] cursor-pointer transition-colors",
        active
          ? "border-c-accent bg-c-accent text-white"
          : "border-c-dark-half/40 text-c-dark-half hover:border-c-dark-full hover:text-c-dark-full",
      )}
    >
      R
    </button>
  );
}
