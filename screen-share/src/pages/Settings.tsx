import { SettingsPanel } from "../components/settings/SettingsPanel";

export function Settings({ onEditProfile }: { onEditProfile: () => void }) {
  return (
    <div className="settings-stage">
      <SettingsPanel onEditProfile={onEditProfile} />
    </div>
  );
}
