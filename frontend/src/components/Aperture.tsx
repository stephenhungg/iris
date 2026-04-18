import "./aperture.css";

/**
 * six-blade iris aperture rendered in chrome. the blades are brushed metal
 * wedges with a dark lens pit at the center. CSS drives the open/close.
 */
export function Aperture({ size = 440 }: { size?: number }) {
  const blades = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div className="aperture" style={{ width: size, height: size }}>
      <svg viewBox="-100 -100 200 200" className="aperture__svg">
        <defs>
          {/* a single blade — chrome wedge */}
          <linearGradient id="bladeFill" x1="0" y1="-1" x2="0" y2="1">
            <stop offset="0%"   stopColor="#f6f6f6" />
            <stop offset="48%"  stopColor="#d0d0d0" />
            <stop offset="52%"  stopColor="#8a8a8a" />
            <stop offset="100%" stopColor="#bcbcbc" />
          </linearGradient>
          <polygon id="blade" points="0,-92 68,-60 68,60 0,40" fill="url(#bladeFill)" />

          {/* lens pit at the center */}
          <radialGradient id="pit" cx="50%" cy="50%">
            <stop offset="0%"   stopColor="#0a0a0a" stopOpacity="1" />
            <stop offset="70%"  stopColor="#1a1a1a" stopOpacity="1" />
            <stop offset="100%" stopColor="#2a2a2a" stopOpacity="0.8" />
          </radialGradient>

          {/* outer barrel ring */}
          <linearGradient id="ring" x1="0" y1="-1" x2="0" y2="1">
            <stop offset="0%"   stopColor="#e0e0e0" />
            <stop offset="45%"  stopColor="#9e9e9e" />
            <stop offset="55%"  stopColor="#5a5a5a" />
            <stop offset="100%" stopColor="#b6b6b6" />
          </linearGradient>
        </defs>

        {/* dark center */}
        <circle cx="0" cy="0" r="96" fill="url(#pit)" />

        {/* outer chrome ring */}
        <circle cx="0" cy="0" r="96" fill="none" stroke="url(#ring)" strokeWidth="2.5" />
        <circle cx="0" cy="0" r="91" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.6" />

        {/* blades */}
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

        {/* engraved marks — f-stops on a barrel */}
        {blades.map((i) => (
          <line
            key={i}
            x1="0"
            y1="-98"
            x2="0"
            y2="-94"
            stroke="#c8c8c8"
            strokeWidth="0.6"
            style={{ transform: `rotate(${i * 60}deg)` }}
          />
        ))}
      </svg>
    </div>
  );
}
