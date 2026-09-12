export { IconHome, IconUsers, IconSettings, IconScreenShare as IconShare, IconPlus, IconSearch, IconCopy, IconLogout, IconDots, IconChevronRight, IconEye, IconMinimize, IconUser, IconLock, IconMail, IconEyeOff } from "@tabler/icons-react";

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
