import type { Metadata } from "next";
import { SiteShell } from "@/components/layout/SiteShell";
import { Card } from "@/components/ui/Card";
import { TEXT_LINK } from "@/components/ui/text-link";
import { requirePage } from "@/lib/auth";
import { ROLE_LABELS, hasAccess } from "@/lib/roles";
import { guideFor } from "./guides";

export const metadata: Metadata = { title: "Aide" };

/**
 * /help — l'aide (plan gestion-contenu, étape 14)
 *
 * Ouverte à toute session, USER compris, sur le gabarit du site (D108) :
 * chacun y lit le guide de son rôle, et lui seul (`guideFor`). Le rôle vient
 * de la session relue en base (`requirePage`, D1 et D20), jamais du jeton :
 * la page n'est pas en cache, comme « Mon compte ». Un sommaire renvoie à
 * chaque section du guide.
 */
export default async function HelpPage() {
  const { user } = await requirePage("signedIn");
  const guide = guideFor(user.role);

  return (
    <SiteShell current="help" showBackOffice={hasAccess(user.role, "manager")} width="narrow">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Aide</h1>
          <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">
            Le guide de votre rôle : <strong className="font-medium text-ink">{ROLE_LABELS[user.role]}</strong>.
          </p>
        </div>

        <Card>
          <nav aria-label="Sommaire de l'aide" className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wider text-ink-2 uppercase">Sommaire</p>
            <ol className="flex flex-col gap-1">
              {guide.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${guide.id}-${section.id}`} className={`${TEXT_LINK} text-sm`}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </Card>

        <section
          id={`guide-${guide.id}`}
          aria-labelledby={`guide-${guide.id}-title`}
          className="flex flex-col gap-6 border-t border-line pt-6"
        >
          <div className="flex flex-col gap-1">
            <h2 id={`guide-${guide.id}-title`} className="font-display text-lg font-semibold text-balance text-ink">
              {guide.title}
            </h2>
            <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">{guide.summary}</p>
          </div>
          {guide.sections.map((section) => (
            <section
              key={section.id}
              id={`${guide.id}-${section.id}`}
              aria-labelledby={`${guide.id}-${section.id}-title`}
              className="flex flex-col gap-3"
            >
              <h3 id={`${guide.id}-${section.id}-title`} className="text-sm font-semibold text-ink">
                {section.title}
              </h3>
              {section.body}
            </section>
          ))}
        </section>
      </div>
    </SiteShell>
  );
}
