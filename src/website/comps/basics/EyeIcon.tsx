type Props = {
  crossed: boolean;
};
export function EyeIcon({ crossed }: Props) {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M2 12 C6 5 18 5 22 12 C18 19 6 19 2 12 Z" />
      <circle cx="12" cy="12" r="3" className="fill-current" />
      {crossed && <path d="M4 20 L20 4" />}
    </svg>
  );
}
