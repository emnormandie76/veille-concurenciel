import type { Metadata } from "next";
import Link from "next/link";
import { requirePage } from "@/lib/auth";
import { ROLE_LABELS, hasAccess } from "@/lib/roles";
import SignOutButton from "../SignOutButton";
import AccountClient from "./AccountClient";

export const metadata: Metadata = { title: "Mon compte" };

/**
 * /account — « Mon compte » (plan gestion-contenu, étape 2)
 *
 * Ouverte à toute session, USER compris : chacun y change son nom affiché (D6)
 * et son mot de passe. Hors du back-office, qu'un USER ne voit pas. Les
 * données viennent de la session, relue en base (`requirePage`, D1 et D20) ;
 * les écritures passent par /api/admin/account et /api/admin/account/password
 * (`guardSignedIn`), qui ne visent que le compte de la session.
 */
export default async function AccountPage() {
  const { user } = await requirePage("signedIn");

  return (
    <>
      <nav className="public-nav" id="main-nav">
        <Link href="/" className="public-nav-logo">
          <span className="public-nav-logo-icon">🎓</span>
          EduData France
        </Link>
        <div className="public-nav-links">
          <Link href="/" className="public-nav-link">Écoles</Link>
          <Link href="/api-docs" className="public-nav-link">API</Link>
          {hasAccess(user.role, "manager") && (
            <Link href="/admin/schools" className="public-nav-link">Back-office</Link>
          )}
          <Link href="/account" className="public-nav-link active" aria-current="page">Mon compte</Link>
          <SignOutButton className="public-nav-cta" />
        </div>
      </nav>

      <main className="public-container" style={{ maxWidth: 720, paddingTop: 40 }}>
        <h1>Mon compte</h1>
        <p className="page-title-desc" style={{ marginBottom: 24 }}>
          Votre nom affiché signe vos modifications ; changez-le, ainsi que votre mot de passe, quand vous le souhaitez.
        </p>

        <dl className="account-facts">
          <dt>Adresse e-mail</dt>
          <dd>{user.email ?? "Aucune adresse pour l'instant : un administrateur la renseignera."}</dd>
          <dt>Rôle</dt>
          <dd>{ROLE_LABELS[user.role]}</dd>
        </dl>

        <AccountClient initialName={user.name} />
      </main>
    </>
  );
}
