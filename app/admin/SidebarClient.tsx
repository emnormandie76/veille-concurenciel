"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ROLE_LABELS, type UserRole } from "@/lib/roles";
import { navFor } from "./nav";

interface SidebarClientProps {
  user: {
    name?: string | null;
    role: UserRole;
  };
}

export default function SidebarClient({ user }: SidebarClientProps) {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <h2>School Data Pipeline</h2>
      </div>

      <div className="sidebar-user">
        <div className="user-avatar">
          {user.name?.substring(0, 2).toUpperCase() || "AD"}
        </div>
        <div className="user-info">
          <div className="user-name">{user.name}</div>
          <span className={`badge ${user.role === "GESTIONNAIRE" ? "badge-moderator" : "badge-admin"}`}>
            {ROLE_LABELS[user.role]}
          </span>
        </div>
      </div>

      {/* Le menu ne montre que ce que le rôle permet ; le contrôle réel est
          côté serveur (requirePage) et dans les API (app/admin/nav.ts). */}
      <nav className="sidebar-nav">
        {navFor(user.role).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}
          >
            <span>{item.icon}</span> {item.label}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        {/* Hors du menu par rôle : « Mon compte » est une page du site, ouverte à toute session. */}
        <Link href="/account" className={`nav-link ${pathname.startsWith("/account") ? "active" : ""}`}>
          <span>👤</span> Mon compte
        </Link>
        <button onClick={() => signOut({ callbackUrl: "/admin/login" })} className="btn btn-secondary logout-btn">
          <span>🚪</span> Déconnexion
        </button>
      </div>

      <style jsx>{`
        .sidebar {
          width: var(--sidebar-width);
          background-color: var(--bg-secondary);
          border-right: 1px solid var(--border-color);
          display: flex;
          flex-direction: column;
          height: 100vh;
          position: fixed;
          left: 0;
          top: 0;
          z-index: 100;
        }

        .sidebar-brand {
          padding: 24px;
          border-bottom: 1px solid var(--border-color);
        }

        .sidebar-brand h2 {
          font-size: 1.15rem;
          font-weight: 700;
          background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .sidebar-user {
          padding: 20px 24px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid var(--border-color);
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background-color: var(--bg-tertiary);
          border: 1px solid var(--border-color);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--accent);
        }

        .user-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .user-name {
          font-size: 0.9rem;
          font-weight: 600;
          color: #ffffff;
        }

        .sidebar-nav {
          padding: 24px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          flex: 1;
        }

        :global(.nav-link),
        :global(.nav-link:visited) {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          color: var(--text-secondary) !important;
          text-decoration: none;
          font-size: 0.925rem;
          font-weight: 500;
          transition: all var(--transition-fast) !important;
        }

        :global(.nav-link:hover),
        :global(.nav-link:hover:visited) {
          background-color: var(--bg-tertiary) !important;
          color: rgba(255, 255, 255, 0.8) !important;
          transform: translateX(4px) !important;
        }

        :global(.nav-link.active),
        :global(.nav-link.active:visited) {
          background-color: var(--accent-glow) !important;
          color: var(--accent) !important;
          border-left: 3px solid var(--accent) !important;
        }

        .sidebar-footer {
          padding: 20px;
          border-top: 1px solid var(--border-color);
        }

        .logout-btn {
          width: 100%;
          justify-content: center;
          font-size: 0.85rem;
        }
      `}</style>
    </aside>
  );
}
