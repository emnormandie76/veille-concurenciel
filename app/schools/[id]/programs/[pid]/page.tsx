/**
 * app/schools/[id]/programs/[pid]/page.tsx — Détail programme public (Étape 8.1)
 *
 * - Tarifs par année + total, classements, capacité par campus
 * - ISR 1h
 * - Vérification école ACTIVE + appartenance programme (schoolId)
 * - Plan gestion-contenu, étape 5 : sous chaque donnée (le programme, chaque
 *   tarif, classement et capacité), son lien source et « Modifié par … le … »
 *   (SourceLine). L'auteur n'est lu que par son nom (AUTHOR_SELECT, D25).
 *   Le cache d'une heure est levé à chaque écriture (lib/content-cache.ts).
 * - Étape 6 : un lien « Signaler une information » vers le formulaire, le
 *   programme choisi d'avance.
 * - Étape 8 (D16, D51) : une section « Admissions », une ligne par entrée
 *   (« Entrée en 1re année avec le Bac, par Parcoursup », lib/program-entries.ts),
 *   avec sa note, son lien source et « Modifié par … le … », à l'ancien style.
 * - Étape 9 (lot 1) : dans la charte (gabarit `SiteShell` sans « Back-office »,
 *   D57 ; tableau des tarifs `Table`, badges, listes) ; émojis retirés (D56).
 *   Textes, identifiants et données inchangés.
 * - D74 (contrôle du 21 octobre) : la note d'un tarif quitte sa colonne, où une
 *   note longue faisait une ligne de plus de 1 000 px et poussait le tableau
 *   hors de son cadre ; elle s'affiche sous les montants de son année, sur
 *   toute la largeur. Chaque année est un groupe de lignes (`TBody`).
 * - Référence : task.md §8.1, architecture.md §7.1
 */

import { Fragment } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import SourceLine from "../../../SourceLine";
import { PinIcon } from "../../../icons";
import { ENTRY_ORDER_BY, describeEntry } from "@/lib/program-entries";
import { AUTHOR_SELECT, describeProvenance, sourceHref } from "@/lib/provenance";

export const revalidate = 3600; // ISR 1h — Étape 8.3

interface Props {
  params: Promise<{ id: string; pid: string }>;
}

async function getProgram(schoolId: string, programId: string) {
  const { prisma } = await import("@/lib/prisma");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      school: true,
      updatedBy: AUTHOR_SELECT,
      campuses: {
        include: {
          campus: {
            select: { id: true, name: true, city: true },
          },
          capacityRecords: {
            orderBy: { academic_year: "desc" },
            include: { updatedBy: AUTHOR_SELECT },
          },
        },
        orderBy: { campus: { name: "asc" } },
      },
      pricingRecords: {
        orderBy: { academic_year: "desc" },
        include: { updatedBy: AUTHOR_SELECT },
      },
      rankingRecords: {
        orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
        include: { updatedBy: AUTHOR_SELECT },
      },
      entries: {
        orderBy: ENTRY_ORDER_BY,
        include: { updatedBy: AUTHOR_SELECT },
      },
    },
  });

  if (!program) return null;
  if (program.schoolId !== schoolId) return null;
  if (program.school.status !== "ACTIVE") return null;

  return program;
}

export async function generateMetadata({ params }: Props) {
  const { id, pid } = await params;
  const program = await getProgram(id, pid);
  if (!program) return { title: "Programme introuvable" };
  return {
    // « — EduData France » vient du modèle de titre d'app/layout.tsx.
    title: `${program.name} — ${program.school.name}`,
    description: `Tarifs, classements et capacité du programme ${program.name} à ${program.school.name}`,
  };
}

function formatFee(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

/** Un montant de la grille : chiffres alignés, « — » discret s'il manque. */
function Fee({ amount, currency }: { amount: number | null; currency: string }) {
  return (
    <Td numeric className={cx("whitespace-nowrap", amount === null ? "text-ink-3" : "text-ink")}>
      {formatFee(amount, currency)}
    </Td>
  );
}

/** Un lien du fil d'Ariane : discret, souligné au survol. */
const CRUMB_LINK = "hover:text-ink hover:underline underline-offset-2";
/** Le titre d'une section de la fiche. */
const SECTION_TITLE = "font-display text-lg font-semibold text-ink";
/** Une boîte qui dit qu'il n'y a rien à montrer. */
const NO_DATA = "rounded-card border border-line bg-surface p-5 text-sm leading-relaxed text-ink-2";
/** Une liste de lignes dans un cadre (admissions, classements). */
const LIST = "overflow-hidden rounded-card border border-line bg-surface";
const LIST_ITEM = "flex flex-col gap-1 border-b border-line px-5 py-3 last:border-b-0";

export default async function ProgramDetailPage({ params }: Props) {
  const { id, pid } = await params;
  const program = await getProgram(id, pid);

  if (!program) notFound();

  const school = program.school;

  // Collecte de toutes les données de capacité (groupées par campus)
  const campusesWithCapacity = program.campuses.filter(
    (pc) => pc.capacityRecords.length > 0
  );

  return (
    <SiteShell showBackOffice={false}>
      <div className="flex flex-col gap-10">
        {/* En-tête du programme */}
        <div className="flex flex-col gap-3" id="program-hero">
          <nav aria-label="Fil d'Ariane" className="text-xs text-ink-2">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className={CRUMB_LINK}>
                  Accueil
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li>
                <Link href={`/schools/${school.id}`} className={CRUMB_LINK}>
                  {school.name}
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-ink">
                {program.name}
              </li>
            </ol>
          </nav>

          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink" id="program-title">
            {program.name}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-2">
            <span>{school.name}</span>
            {/* Campus disponibles */}
            {program.campuses.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
                <PinIcon />
                {program.campuses.map((pc, index) => (
                  <Fragment key={pc.id}>
                    {index > 0 && (
                      <span aria-hidden="true" className="text-ink-3">
                        ·
                      </span>
                    )}
                    <span>{pc.campus.city ?? pc.campus.name}</span>
                  </Fragment>
                ))}
              </span>
            )}
            {(program.admission_exam || program.is_alternance_possible || program.is_expatriation_mandatory) && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {program.admission_exam && <Badge wrap>{program.admission_exam}</Badge>}
                {program.is_alternance_possible && <Badge tone="success">Alternance possible</Badge>}
                {program.is_expatriation_mandatory && <Badge>Expatriation obligatoire</Badge>}
              </span>
            )}
          </div>
          <SourceLine href={sourceHref(program.source_url)} provenance={describeProvenance(program)} />
          {/* Étape 6 (D33) : le formulaire, le programme choisi d'avance ; un
              bouton secondaire de la charte depuis l'étape 9. */}
          <div className="pt-1">
            <Link href={`/schools/${school.id}/report?program=${program.id}`} className={buttonClasses({ variant: "secondary" })}>
              Signaler une information
            </Link>
          </div>
        </div>

        {/* Section Admissions — étape 8 (D16, D51) */}
        <section id="section-admissions" aria-labelledby="section-admissions-title" className="flex flex-col gap-3">
          <h2 id="section-admissions-title" className={SECTION_TITLE}>
            Admissions
          </h2>

          {program.entries.length === 0 ? (
            <p className={NO_DATA} id="no-admissions-data">
              Aucune donnée d&apos;admission disponible.
            </p>
          ) : (
            <ul className={LIST} id="admissions-list">
              {program.entries.map((entry) => (
                <li key={entry.id} className={LIST_ITEM} id={`admission-${entry.id}`}>
                  <span className="text-sm font-medium text-ink">{describeEntry(entry)}</span>
                  {entry.note && <p className="text-sm leading-relaxed text-ink-2">{entry.note}</p>}
                  {/* Le lien n'est cliquable qu'en http(s) (D27). */}
                  <SourceLine href={sourceHref(entry.source_url)} provenance={describeProvenance(entry)} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Section Tarifs */}
        <section id="section-pricing" aria-labelledby="section-pricing-title" className="flex flex-col gap-3">
          <h2 id="section-pricing-title" className={SECTION_TITLE}>
            Tarifs de scolarité
          </h2>

          {program.pricingRecords.length === 0 ? (
            <p className={NO_DATA} id="no-pricing-data">
              Aucune donnée tarifaire disponible.
            </p>
          ) : (
            <Table id="pricing-table">
              <THead>
                <Tr>
                  <Th>Année académique</Th>
                  <Th align="right">Année 1</Th>
                  <Th align="right">Année 2</Th>
                  <Th align="right">Année 3</Th>
                  <Th align="right">Année 4</Th>
                  <Th align="right">Année 5</Th>
                  <Th align="right">Total cursus</Th>
                  <Th align="right">Tarif intl.</Th>
                  <Th>Source</Th>
                </Tr>
              </THead>
              {/* D74 : un groupe de lignes par année, ses montants puis sa note ;
                  le filet sépare les années, pas une année de sa note. */}
              {program.pricingRecords.map((pr) => (
                <TBody key={pr.id} className="border-b border-line last:border-b-0">
                  <tr id={`pricing-row-${pr.id}`}>
                    <Td numeric align="left" className="font-medium text-ink">
                      {pr.academic_year}
                    </Td>
                    <Fee amount={pr.year_1_fee} currency={pr.currency} />
                    <Fee amount={pr.year_2_fee ?? null} currency={pr.currency} />
                    <Fee amount={pr.year_3_fee ?? null} currency={pr.currency} />
                    <Fee amount={pr.year_4_fee ?? null} currency={pr.currency} />
                    <Fee amount={pr.year_5_fee ?? null} currency={pr.currency} />
                    <Fee amount={pr.total_fee} currency={pr.currency} />
                    <Fee
                      amount={pr.intl_year_1_fee ?? pr.intl_total_fee ?? null}
                      currency={pr.intl_currency ?? pr.currency}
                    />
                    <Td className="max-w-56 min-w-36">
                      {sourceHref(pr.source_url) || describeProvenance(pr) ? (
                        <SourceLine href={sourceHref(pr.source_url)} provenance={describeProvenance(pr)} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                  </tr>
                  {pr.additional_fees_notes && (
                    <tr id={`pricing-notes-${pr.id}`}>
                      <Td colSpan={9} className="pt-0 pb-3 text-xs leading-relaxed text-ink-2">
                        <span className="font-medium text-ink">Notes :</span> {pr.additional_fees_notes}
                      </Td>
                    </tr>
                  )}
                </TBody>
              ))}
            </Table>
          )}
        </section>

        {/* Section Classements */}
        <section id="section-rankings" aria-labelledby="section-rankings-title" className="flex flex-col gap-3">
          <h2 id="section-rankings-title" className={SECTION_TITLE}>
            Classements
          </h2>

          {program.rankingRecords.length === 0 ? (
            <p className={NO_DATA} id="no-rankings-data">
              Aucune donnée de classement disponible.
            </p>
          ) : (
            <ul className={LIST} id="rankings-list">
              {program.rankingRecords.map((rk) => (
                <li key={rk.id} className="flex items-start gap-4 border-b border-line px-5 py-3 last:border-b-0" id={`ranking-${rk.id}`}>
                  <span className="w-12 shrink-0 font-mono text-lg font-medium text-accent-strong tabular-nums">#{rk.rank}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-sm font-medium text-ink">{rk.ranking_name}</span>
                    {/* Le lien n'est cliquable qu'en http(s) (D27). */}
                    <SourceLine href={sourceHref(rk.source_url)} provenance={describeProvenance(rk)} />
                  </div>
                  <span className="shrink-0 font-mono text-xs text-ink-2 tabular-nums">{rk.academic_year}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Section Capacité — par campus */}
        <section id="section-capacity" aria-labelledby="section-capacity-title" className="flex flex-col gap-3">
          <h2 id="section-capacity-title" className={SECTION_TITLE}>
            Places disponibles
          </h2>

          {campusesWithCapacity.length === 0 ? (
            <p className={NO_DATA} id="no-capacity-data">
              Aucune donnée de capacité disponible.
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {campusesWithCapacity.map((pc) => (
                <div key={pc.id} className="flex flex-col gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink-2">
                    <PinIcon />
                    {pc.campus.name}
                    {pc.campus.city && <span className="font-normal">— {pc.campus.city}</span>}
                  </h3>
                  <ul className="grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
                    {pc.capacityRecords.map((cap) => (
                      <li key={cap.id} className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4" id={`capacity-${cap.id}`}>
                        <span className="font-mono text-2xl font-medium text-ink tabular-nums">{cap.spots_available.toLocaleString("fr-FR")}</span>
                        <span className="text-sm text-ink-2">Places — {cap.academic_year}</span>
                        <SourceLine href={sourceHref(cap.source_url)} provenance={describeProvenance(cap)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </SiteShell>
  );
}
