type Props = {
  className?: string;
  withLove?: boolean;
};
/** A pulse ending in a live dot, which becomes a heart for supporters. Each shape sits on a darker copy of itself. */
export function LogoIcon({ className, withLove = false }: Props) {
  const tail = withLove ? Internal.HEART : Internal.DOT;
  return (
    <svg viewBox={withLove ? "2 7 79 56" : "2 7 61 56"} className={className} fill="none" aria-hidden>
      <g transform={`translate(0 ${Internal.DEPTH})`}>
        <Internal.Pulse color="#8f821c" />
        <tail.Shape color={tail.shade} />
      </g>
      <Internal.Pulse color="#feea3a" />
      <tail.Shape color={tail.color} />
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

  export const DOT = {
    color: "#ffffff",
    shade: "#8c8c8c",
    Shape: ({ color }: ShapeProps) => <circle cx="56" cy="40" r="6.5" fill={color} />,
  };

  export const HEART = {
    color: "#ff4d4d",
    shade: "#a33030",
    Shape: ({ color }: ShapeProps) => (
      <path
        transform="translate(65 38) scale(1.6)"
        d="M0 8 C-10 0,-9 -8,-4 -8 C-1.5 -8,0 -6,0 -4 C0 -6,1.5 -8,4 -8 C9 -8,10 0,0 8 Z"
        fill={color}
      />
    ),
  };
}
