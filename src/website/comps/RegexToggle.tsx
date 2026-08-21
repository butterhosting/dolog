import { Toggle } from "./basics/Toggle";

type Props = {
  active: boolean;
  onClick: () => void;
};
export function RegexToggle({ active, onClick }: Props) {
  return (
    <Toggle active={active} tone="shell" onClick={onClick} title="read this as a regular expression">
      R
    </Toggle>
  );
}
