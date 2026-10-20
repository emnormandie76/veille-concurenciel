import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteShell } from "@/components/layout/SiteShell";
import { TEXT_LINK } from "@/components/ui/text-link";
import { requirePage } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasAccess } from "@/lib/roles";
import ReportForm from "./ReportForm";

export const metadata: Metadata = { title: "Signaler une information" };

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * /schools/[id]/report — Signaler une information (plan gestion-contenu, étape 6)
 *
 * Le formulaire de signalement d'une école, ouvert à toute session, USER
 * compris (G4 : « consulte et signale ») ; dans la charte (D33), alors que les
 * fiches, qui y mènent par un lien, gardent l'ancien style jusqu'à l'étape 9.
 * La page lit la session (`requirePage`, D1) : elle n'est pas en cache, à la
 * différence des fiches.
 *
 * Une école active seulement, comme sa fiche. La cible se choisit parmi
 * l'école, ses campus et ses programmes ; `?program=` (lien de la fiche
 * programme) la choisit d'avance, s'il est bien à cette école. L'envoi passe
 * par POST /api/admin/reports, qui revérifie tout et prend l'auteur dans la
 * session.
 */
export default async function ReportPage({ params, searchParams }: Props) {
  const { user } = await requirePage("signedIn");
  const { id } = await params;
  const { program } = await searchParams;

  const school = await prisma.school.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      campuses: { select: { id: true, name: true, city: true }, orderBy: { name: "asc" } },
      programs: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  if (!school || school.status !== "ACTIVE") notFound();

  const initialTarget =
    typeof program === "string" && school.programs.some((p) => p.id === program) ? `program:${program}` : "school";

  return (
    <SiteShell current="schools" showBackOffice={hasAccess(user.role, "manager")} width="narrow">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Link href={`/schools/${school.id}`} className={`${TEXT_LINK} self-start text-sm`}>
            Retour à la fiche {school.name}
          </Link>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink">Signaler une information</h1>
          <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">
            Une donnée de la fiche {school.name} vous semble fausse ou dépassée ? Dites-le aux gestionnaires : ils la
            vérifient et la corrigent. Vous suivrez la suite sur «&nbsp;Mon compte&nbsp;».
          </p>
        </div>

        <ReportForm schoolId={school.id} campuses={school.campuses} programs={school.programs} initialTarget={initialTarget} />
      </div>
    </SiteShell>
  );
}
