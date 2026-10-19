import type { Metadata } from "next";
import { SiteShell } from "@/components/layout/SiteShell";
import { Card } from "@/components/ui/Card";
import { requirePage } from "@/lib/auth";
import { ROLE_LABELS, hasAccess } from "@/lib/roles";
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
    <SiteShell current="account" showBackOffice={hasAccess(user.role, "manager")} width="narrow">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Mon compte</h1>
          <p className="text-sm leading-relaxed text-ink-2">
            Votre nom affiché signe vos modifications ; changez-le, ainsi que votre mot de passe, quand vous le souhaitez.
          </p>
        </div>

        <Card>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-ink-2">Adresse e-mail</dt>
            <dd className="font-medium break-words text-ink">
              {user.email ?? "Aucune adresse pour l'instant : un administrateur la renseignera."}
            </dd>
            <dt className="text-ink-2">Rôle</dt>
            <dd className="font-medium text-ink">{ROLE_LABELS[user.role]}</dd>
          </dl>
        </Card>

        <AccountClient initialName={user.name} />
      </div>
    </SiteShell>
  );
}
