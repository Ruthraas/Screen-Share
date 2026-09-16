export function PixelWave() {
  return (
    <svg className="pixel-wave" width="100%" height="28" viewBox="0 0 640 28" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="wave-back" width="40" height="28" patternUnits="userSpaceOnUse">
          <rect x="0" y="16" width="8" height="12" rx="1" fill="var(--wave-back)" />
          <rect x="14" y="10" width="8" height="18" rx="1" fill="var(--wave-back)" />
          <rect x="28" y="18" width="8" height="10" rx="1" fill="var(--wave-back)" />
        </pattern>
        <pattern id="wave-mid" width="40" height="28" patternUnits="userSpaceOnUse">
          <rect x="6" y="20" width="8" height="8" rx="1" fill="var(--wave-mid)" />
          <rect x="20" y="14" width="8" height="14" rx="1" fill="var(--wave-mid)" />
          <rect x="34" y="19" width="8" height="9" rx="1" fill="var(--wave-mid)" />
        </pattern>
        <pattern id="wave-front" width="40" height="28" patternUnits="userSpaceOnUse">
          <rect x="12" y="21" width="8" height="7" rx="1" fill="var(--wave-front)" />
          <rect x="26" y="16" width="8" height="12" rx="1" fill="var(--wave-front)" />
        </pattern>
      </defs>
      <rect width="100%" height="28" fill="url(#wave-back)" />
      <rect width="100%" height="28" fill="url(#wave-mid)" />
      <rect width="100%" height="28" fill="url(#wave-front)" />
    </svg>
  );
}
