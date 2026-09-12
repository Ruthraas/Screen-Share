import { useEffect, useId, useState } from "react";

interface Sparkle {
  x: number;
  y: number;
  size: number;
  opacity: number;
  delay: number;
  duration: number;
  drift: number;
}

export function PixelWave() {
  const id = useId().replace(/:/g, "");
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const generateSparkles = () => {
      const newSparkles: Sparkle[] = Array.from({ length: 50 }, () => ({
        x: Math.random() * 100,
        y: 55 + Math.random() * 5,
        size: 2 + Math.random() * 3,
        opacity: 0.3 + Math.random() * 0.5,
        delay: Math.random() * 5,
        duration: 4 + Math.random() * 5,
        drift: (Math.random() - 0.5) * 1.2,
      }));
      setSparkles(newSparkles);
    };
    generateSparkles();
    const interval = setInterval(generateSparkles, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <svg
      className="pixel-wave"
      width="100%"
      height="60"
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ overflow: "visible", display: "block" }}
    >
      <defs>
        <radialGradient id={`${id}-sparkle-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="1" />
          <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {sparkles.map((s, i) => (
        <circle
          key={i}
          cx={`${s.x}%`}
          cy={`${s.y}%`}
          r={s.size}
          fill={`url(#${id}-sparkle-glow)`}
          opacity={hovered ? Math.min(s.opacity * 2, 1) : s.opacity}
          style={{
            animation: `sparkle-${i} ${s.duration}s ease-in-out ${s.delay}s infinite`,
            transformOrigin: `${s.x}% ${s.y}%`,
            filter: hovered ? "drop-shadow(0 0 6px var(--accent))" : "none",
          } as any}
        />
      ))}
      <style>{`
        ${sparkles.map((s, i) => `
          @keyframes sparkle-${i} {
            0%, 100% {
              opacity: 0;
              transform: translate(0, 0) scale(0.2);
            }
            10% {
              opacity: ${hovered ? Math.min(s.opacity * 2, 1) : s.opacity};
              transform: translate(${s.drift * 20}px, -8px) scale(1);
            }
            35% {
              opacity: ${hovered ? Math.min(s.opacity * 1.5, 1) : s.opacity * 0.9};
              transform: translate(${s.drift * 40}px, -22px) scale(1.5);
            }
            65% {
              opacity: ${hovered ? s.opacity * 0.7 : s.opacity * 0.4};
              transform: translate(${s.drift * 25}px, -10px) scale(0.8);
            }
          }
        `).join('')}
      `}</style>
    </svg>
  );
}
