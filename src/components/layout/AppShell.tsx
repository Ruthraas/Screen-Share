import type { ReactNode } from "react";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "./AccountProvider";
import { Avatar } from "../ui/Avatar";
import { BrandMark, IconHome, IconSettings, IconUsers, IconLogout, IconUser } from "../ui/Icons";
import { PixelWave } from "./PixelWave";

type Route = "login" | "empty" | "home" | "share" | "multi" | "settings" | "profile";

export function AppShell({
  route,
  navigate,
  children,
  title,
  eyebrow,
  actions,
}: {
  route: Route;
  navigate: (route: Route) => void;
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  const { user: currentUser, logout, selected } = useAccount();
  const [profileOpen, setProfileOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const profileMenu = profileOpen ? (
    <div className="profile-menu" role="menu" ref={dropdownRef}>
      <div className="profile-menu-header">
        <Avatar user={currentUser} size="md" />
        <div>
          <strong>{currentUser.name}</strong>
          <span>{currentUser.email}</span>
        </div>
      </div>
      <button className="profile-menu-item" role="menuitem" onClick={() => { navigate("profile"); setProfileOpen(false); }}>
        <IconUser />
        <span>perfil</span>
      </button>
      <button className="profile-menu-item profile-menu-item--danger" role="menuitem" onClick={() => { void logout(); setProfileOpen(false); }}>
        <IconLogout />
        <span>sair da conta</span>
      </button>
    </div>
  ) : null;

  return (
    <div className="app-window app-window--wide">
      <aside className="sidebar">
        <div className="nav-stack">
          <button className={`nav-button ${route === "home" || route === "share" ? "is-active" : ""}`} onClick={() => navigate("home")} title="inicio">
            <IconHome />
          </button>
          <button className={`nav-button ${(route === "empty" || route === "multi") ? "is-active" : ""}`} onClick={() => navigate("multi")} title="grupos">
            <IconUsers />
          </button>
          <button className={`nav-button ${route === "settings" || route === "profile" ? "is-active" : ""}`} onClick={() => navigate("settings")} title="configuracoes">
            <IconSettings />
          </button>
        </div>
        <button className="avatar-button" onClick={() => setProfileOpen(!profileOpen)} title="perfil" aria-expanded={profileOpen} aria-haspopup="true">
          <Avatar user={currentUser} />
        </button>
      </aside>
      <main className="workspace">
        {title ? (
          <header className="topbar">
            <div className="group-title">
              <BrandMark small />
              <div>
                <span>{eyebrow ?? "grupo"}</span>
                <strong>{title}</strong>
              </div>
            </div>
            <div className="topbar-actions">
              <div className="avatar-pair">
                {(selected?.members ?? []).slice(0, 2).map((member) => <Avatar key={member.id} user={member} size="sm" />)}
              </div>
              {actions}
            </div>
          </header>
        ) : <header className="topbar"><span className="muted">{route === "profile" ? "perfil" : route === "settings" ? "configuracoes" : "sem grupo selecionado"}</span></header>}
        {children}
      </main>
      <PixelWave />
      {profileMenu && createPortal(profileMenu, document.body)}
    </div>
  );
}
