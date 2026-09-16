import { BrandMark } from "../ui/Icons";

export function SplashScreen({ leaving }: { leaving: boolean }) {
  return (
    <div className={`splash-screen ${leaving ? "is-leaving" : ""}`} role="status" aria-label="abrindo ScreenShare">
      <div className="splash-brand">
        <BrandMark />
        <span className="splash-word">
          <span>screen</span>
          <strong>share</strong>
        </span>
      </div>
    </div>
  );
}
