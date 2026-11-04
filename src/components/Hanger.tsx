type HangerProps = {
  x: number;
  className?: string;
};

// Hook sits at the origin so the hanger can be placed on a rail at y = 0.
export function Hanger({ x, className }: HangerProps) {
  return (
    <g transform={`translate(${x} 0)`}>
      <g className={className}>
        <path d="M0 15v-3.5a4.6 4.6 0 1 0-4.6-4.6" />
        <path d="M0 15-18.6 28.4c-1.3.9-.7 2.6.9 2.6h35.4c1.6 0 2.2-1.7.9-2.6Z" />
      </g>
    </g>
  );
}
