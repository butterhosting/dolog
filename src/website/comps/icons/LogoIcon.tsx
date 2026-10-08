type Props = {
  className?: string;
};
/** A pulse ending in a live dot. Each shape sits on a darker copy of itself. */
export function LogoIcon({ className }: Props) {
  return (
    <svg viewBox="2 7 61 56" className={className} fill="none" aria-hidden>
      <g transform={`translate(0 ${Internal.DEPTH})`}>
        <Internal.Pulse color="#8f821c" />
        <Internal.Dot color="#8c8c8c" />
      </g>
      <Internal.Pulse color="#feea3a" />
      <Internal.Dot color="#ffffff" />
    </svg>
  );
}

namespace Internal {
  export const DEPTH = 4;

  type ShapeProps = {
    color: string;
  };

  export function Pulse({ color }: ShapeProps) {
    return <path d="M2 40 H18 L26 12 L36 54 L41 40 H46" stroke={color} strokeWidth="9" strokeLinejoin="round" />;
  }

  export function Dot({ color }: ShapeProps) {
    return <circle cx="56" cy="40" r="6.5" fill={color} />;
  }
}
