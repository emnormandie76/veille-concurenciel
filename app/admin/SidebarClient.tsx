"use client";

import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface SidebarClientProps {
  user: {
    name?: string | null;
    role: "ADMIN" | "MODERATOR";
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
          <span className={`badge ${user.role === "ADMIN" ? "badge-admin" : "badge-moderator"}`}>
            {user.role}
          </span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <Link
          href="/admin/inbox"
          className={`nav-link ${pathname.startsWith("/admin/inbox") ? "active" : ""}`}
        >
          <span>📬</span> Validation Inbox
        </Link>

        <Link
          href="/admin/schools"
          className={`nav-link ${pathname.startsWith("/admin/schools") ? "active" : ""}`}
        >
          <span>🏫</span> Écoles & Campus
        </Link>

        <Link
          href="/admin/cron"
          className={`nav-link ${pathname.startsWith("/admin/cron") ? "active" : ""}`}
        >
          <span>⚙️</span> Monitoring & Cron
        </Link>

        {user.role === "ADMIN" && (
          <Link
            href="/admin/users"
            className={`nav-link ${pathname === "/admin/users" ? "active" : ""}`}
          >
            <span>👥</span> Modérateurs
          </Link>
        )}
      </nav>

      <div className="sidebar-footer">
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

        .nav-link {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: var(--radius-md);
          color: var(--text-secondary);
          text-decoration: none;
          font-size: 0.925rem;
          font-weight: 500;
          transition: var(--transition-fast);
        }

        .nav-link:hover {
          background-color: var(--bg-tertiary);
          color: #ffffff;
        }

        .nav-link.active {
          background-color: var(--accent-glow);
          color: var(--accent);
          border-left: 3px solid var(--accent);
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
