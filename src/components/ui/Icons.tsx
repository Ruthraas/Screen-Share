export { IconHome, IconUsers, IconSettings, IconScreenShare as IconShare, IconPlus, IconSearch, IconLogout, IconChevronRight, IconEye, IconMinimize, IconUser, IconEyeOff } from "@tabler/icons-react";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "brand-mark brand-mark--small" : "brand-mark"} aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}
