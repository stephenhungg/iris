import "./aperture.css";

/**
 * six-blade iris aperture. blades rotate + translate inward to close,
 * outward to open. the CSS handles the motion; the SVG just defines geometry.
 */
export function Aperture({ size = 440 }: { size?: number }) {
  // 6 blades equally spaced around the optical axis
  const blades = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div className="aperture" style={{ width: size, height: size }}>
      <svg viewBox="-100 -100 200 200" className="aperture__svg">
        <defs>
          {/* the shape of a single blade — a crescent-like wedge */}
          <polygon
            id="blade"
            points="0,-92 68,-60 68,60 0,40"
            fill="var(--paper)"
          />
          <radialGradient id="irisGlow">
            <stop offset="0%" stopColor="var(--safelight)" stopOpacity="0.9" />
            <stop offset="60%" stopColor="var(--safelight)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--safelight)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* warm glow bleeding through the center */}
        <circle cx="0" cy="0" r="96" fill="url(#irisGlow)" />

        {/* outer brass ring */}
        <circle
          cx="0"
          cy="0"
          r="96"
          fill="none"
          stroke="var(--brass)"
          strokeWidth="1.2"
          opacity="0.7"
        />
        <circle
          cx="0"
          cy="0"
          r="90"
          fill="none"
          stroke="var(--rule)"
          strokeWidth="0.5"
        />

        {/* the 6 blades — each rotated to its position, grouped so CSS can animate
            them together */}
        <g className="aperture__blades">
          {blades.map((i) => (
            <use
              key={i}
              href="#blade"
              style={{ transform: `rotate(${i * 60}deg)` }}
              className="aperture__blade"
            />
          ))}
        </g>

        {/* engraved marks around the ring — like f-stops on a lens barrel */}
        {blades.map((i) => (
          <line
            key={i}
            x1="0"
            y1="-98"
            x2="0"
            y2="-94"
            stroke="var(--brass)"
            strokeWidth="0.6"
            style={{ transform: `rotate(${i * 60}deg)` }}
          />
        ))}
      </svg>
    </div>
  );
}
