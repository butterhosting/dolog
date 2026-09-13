type Props = {
  className?: string;
};
/** Three sliders, each track broken around its knob so the knob reads on any background. */
export function SlidersIcon({ className }: Props) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      {Internal.SLIDERS.map(([y, knob]) => (
        <g key={y}>
          <line x1="3" y1={y} x2={knob - 4.5} y2={y} />
          <circle cx={knob} cy={y} r="2.5" />
          <line x1={knob + 4.5} y1={y} x2="21" y2={y} />
        </g>
      ))}
    </svg>
  );
}

namespace Internal {
  /** [track y, knob x] */
  export const SLIDERS: [number, number][] = [
    [4, 15],
    [12, 8.5],
    [20, 16.5],
  ];
}
