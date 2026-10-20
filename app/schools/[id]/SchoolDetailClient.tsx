/**
 * app/schools/[id]/SchoolDetailClient.tsx — Composant client fiche école (Étape 8.1)
 *
 * - Affichage avec onglets : Programmes, Statistiques, Accréditations
 * - Étape 9 (lot 1) : dans la charte (onglets `Tabs`, badges, liste des
 *   programmes, chiffres clés en grille) ; émojis retirés (D56). Textes,
 *   identifiants de champ et filtres inchangés.
 * - Plan gestion-contenu, étape 5 : l'école, ses chiffres clés et ses
 *   accréditations montrent leur lien source et « Modifié par … le … »,
 *   préparés par la page serveur (`provenance`, `source_href`)
 * - Étape 6 : un lien « Signaler une information » vers le formulaire
 * - Référence : task.md §8.1
 */

"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { SiteShell } from "@/components/layout/SiteShell";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Select } from "@/components/ui/Field";
import { TabPanel, Tabs } from "@/components/ui/Tabs";
import { TEXT_LINK } from "@/components/ui/text-link";
import SourceLine from "../SourceLine";
import { ExternalIcon, PinIcon } from "../icons";

/** Un lien du fil d'Ariane : discret, souligné au survol. */
const CRUMB_LINK = "hover:text-ink hover:underline underline-offset-2";

interface PricingRecord {
  id: string;
  academic_year: number;
  year_1_fee: number | null;
  total_fee: number | null;
  currency: string;
}

interface CampusInfo {
  id: string;
  name: string;
  city: string | null;
}

interface ProgramCampus {
  id: string;
  campus: CampusInfo;
}

interface Program {
  id: string;
  name: string;
  admission_exam: string | null;
  is_alternance_possible: boolean;
  is_expatriation_mandatory: boolean;
  pricingRecords: PricingRecord[];
  campuses: ProgramCampus[]; // campus associations via ProgramCampus
}

interface Campus {
  id: string;
  name: string;
  city: string | null;
}

interface StatsRecord {
  id: string;
  academic_year: number;
  total_students: number | null;
  total_alumni: number | null;
  partner_companies: number | null;
  annual_internship_offers: number | null;
  abroad_campuses: number | null;
  partner_universities: number | null;
  permanent_professors: number | null;
  international_professors_pct: number | null;
  external_speakers_pct: number | null;
  /** « Modifié par … le … » et le lien vérifié, préparés par la page (étape 5). */
  provenance: string | null;
  source_href: string | null;
}

interface AccreditationRecord {
  id: string;
  accreditation_name: string;
  accreditation_type?: string;
  year_obtained: number | null;
  is_active: boolean;
  provenance: string | null;
  source_href: string | null;
}

interface School {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  provenance: string | null;
  campuses: Campus[];
  programs: Program[]; // programmes au niveau école (pas par campus)
  statsRecords: StatsRecord[];
  accreditations: AccreditationRecord[];
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || name.slice(0, 2).toUpperCase();
}

function formatPrice(record: PricingRecord): string {
  const fee = record.year_1_fee ?? record.total_fee;
  if (!fee) return "";
  return `${fee.toLocaleString("fr-FR")} ${record.currency}/an`;
}

function formatPct(val: number | null): string {
  if (val === null) return "—";
  const num = val <= 1 ? val * 100 : val;
  return `${Math.round(num)}%`;
}

function formatNum(val: number | null): string {
  if (val === null) return "—";
  return val.toLocaleString("fr-FR");
}

function inferProgramType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("pge") || n.includes("grande école")) return "PGE";
  if (n.includes("bachelor") || n.includes("bba")) return "Bachelor";
  if (n.includes("msc") || n.includes("science") || n.includes("spécialisé")) return "MSc";
  if (n.includes("master") || n.includes("mastère") || n.includes("mba")) return "Master";
  if (n.includes("doctorat") || n.includes("phd")) return "Doctorat";
  return "Autre";
}

function inferProgramLevel(name: string): string {
  const type = inferProgramType(name);
  if (type === "Bachelor") return "Bac+3";
  if (type === "PGE" || type === "Master") return "Bac+5";
  if (type === "MSc") return "Bac+6";
  if (type === "Doctorat") return "Bac+8";
  return "Bac+5"; // Valeur par défaut
}

type Tab = "programs" | "stats" | "accreditations";

/** Un bouton de filtre (Diplôme, Niveau) : enfoncé quand il est choisi. */
const FILTER_BUTTON =
  "inline-flex h-8 items-center rounded-full border border-line-strong bg-surface px-3 text-compact text-ink-2 " +
  "hover:text-ink aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** Le titre d'un groupe de filtres ou de données. */
const GROUP_LABEL = "text-xs font-semibold tracking-wider text-ink-2 uppercase";

/** Une boîte qui dit qu'il n'y a rien à montrer. */
const NO_DATA = "rounded-card border border-line bg-surface p-5 text-sm leading-relaxed text-ink-2";

export default function SchoolDetailClient({ school }: { school: School }) {
  const [activeTab, setActiveTab] = useState<Tab>("programs");
  const [activeType, setActiveType] = useState<string>("all");
  const [activeLevel, setActiveLevel] = useState<string>("all");
  const [activeCampus, setActiveCampus] = useState<string>("all");

  const totalPrograms = school.programs.length;
  const latestStats = school.statsRecords[0] ?? null;

  const filteredPrograms = school.programs.filter((prog) => {
    const type = inferProgramType(prog.name);
    const level = inferProgramLevel(prog.name);
    const typeMatch = activeType === "all" || type === activeType;
    const levelMatch = activeLevel === "all" || level === activeLevel;
    const campusMatch = activeCampus === "all" || prog.campuses.some((pc) => pc.campus.id === activeCampus);
    return typeMatch && levelMatch && campusMatch;
  });

  // Les chiffres clés de la dernière année : libellé, valeur, identifiant gardé.
  const rawStats: Array<{ label: string; raw: number | null; id?: string; pct?: boolean }> = latestStats
    ? [
        { label: "Étudiants", raw: latestStats.total_students, id: "stat-students" },
        { label: "Alumni", raw: latestStats.total_alumni },
        { label: "Entreprises partenaires", raw: latestStats.partner_companies },
        { label: "Offres de stage/an", raw: latestStats.annual_internship_offers },
        { label: "Campus à l'étranger", raw: latestStats.abroad_campuses },
        { label: "Universités partenaires", raw: latestStats.partner_universities },
        { label: "Professeurs permanents", raw: latestStats.permanent_professors },
        { label: "Profs internationaux", raw: latestStats.international_professors_pct, pct: true },
        { label: "Intervenants extérieurs", raw: latestStats.external_speakers_pct, pct: true },
      ]
    : [];
  const statItems = rawStats
    .filter((item) => item.raw !== null)
    .map((item) => ({ label: item.label, id: item.id, value: item.pct ? formatPct(item.raw) : formatNum(item.raw) }));

  const internationals = school.accreditations.filter((acc) => !acc.accreditation_type || acc.accreditation_type === "international");
  const states = school.accreditations.filter((acc) => acc.accreditation_type === "state");
  const labels = school.accreditations.filter((acc) => acc.accreditation_type === "label");

  const renderBadge = (acc: AccreditationRecord) => (
    <li
      key={acc.id}
      className="flex flex-col gap-1 rounded-control border border-line bg-surface px-3 py-2"
      id={`accreditation-${acc.id}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
        <span aria-hidden="true" className={cx("size-2 shrink-0 rounded-full", acc.is_active ? "bg-success" : "bg-ink-3")} />
        {acc.accreditation_name}
        {acc.year_obtained != null && <span className="text-xs text-ink-2">depuis {acc.year_obtained}</span>}
        {!acc.is_active && <span className="text-xs text-ink-2">(expirée)</span>}
      </div>
      <SourceLine href={acc.source_href} provenance={acc.provenance} />
    </li>
  );

  const accreditationGroups = [
    { id: "international", title: "Accréditations Internationales", items: internationals },
    { id: "state", title: "Reconnaissances de l'État français", items: states },
    { id: "label", title: "Labels & Certifications", items: labels },
  ].filter((group) => group.items.length > 0);

  // Le gabarit du site, sans « Back-office » (D57) : la fiche ne lit pas la
  // session, et garde son cache d'une heure.
  return (
    <SiteShell showBackOffice={false}>
      <div className="flex flex-col gap-6">
        {/* En-tête de l'école */}
        <div className="flex flex-col gap-4" id="school-hero">
          <nav aria-label="Fil d'Ariane" className="text-xs text-ink-2">
            <ol className="flex flex-wrap items-center gap-1.5">
              <li>
                <Link href="/" className={CRUMB_LINK}>
                  Accueil
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li>
                <Link href="/" className={CRUMB_LINK}>
                  Écoles
                </Link>
              </li>
              <li aria-hidden="true">›</li>
              <li aria-current="page" className="text-ink">
                {school.name}
              </li>
            </ol>
          </nav>

          <div className="flex flex-wrap items-start gap-4">
            <div
              aria-hidden="true"
              className="grid size-14 shrink-0 place-items-center rounded-card bg-accent font-display text-xl font-semibold text-accent-ink"
            >
              {getInitials(school.name)}
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-ink">{school.name}</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
                <a
                  href={`https://${school.official_domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cx(TEXT_LINK, "inline-flex items-center gap-1")}
                >
                  {school.official_domain}
                  <ExternalIcon />
                </a>
                <span aria-hidden="true">·</span>
                <span>{school.campuses.length} campus</span>
                <span aria-hidden="true">·</span>
                <span>
                  {totalPrograms} programme{totalPrograms > 1 ? "s" : ""}
                </span>
              </div>
              <SourceLine href={null} provenance={school.provenance} />
              {/* Étape 6 (D33) : le formulaire de signalement ; un bouton
                  secondaire de la charte depuis l'étape 9. */}
              <div className="pt-1">
                <Link href={`/schools/${school.id}/report`} className={buttonClasses({ variant: "secondary" })}>
                  Signaler une information
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Onglets : le modèle ARIA de la charte (Tabs) */}
        <div>
          <Tabs
            label="Sections de la fiche"
            idPrefix="school"
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as Tab)}
            items={[
              { value: "programs", label: "Programmes", count: totalPrograms },
              { value: "stats", label: "Statistiques" },
              { value: "accreditations", label: "Accréditations", count: school.accreditations.length },
            ]}
          />

          {/* Onglet : Programmes */}
          <TabPanel idPrefix="school" value="programs" selected={activeTab === "programs"} className="flex flex-col gap-4">
            {school.programs.length === 0 ? (
              <p className={NO_DATA}>Aucun programme validé pour cette école. Les données sont en cours d&apos;enrichissement.</p>
            ) : (
              <>
                {/* FILTRES CLIENT-SIDE */}
                <div
                  className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 lg:flex-row lg:items-end lg:gap-8"
                  id="programs-filter-panel"
                >
                  <div role="group" aria-labelledby="filter-type-label" className="flex flex-col gap-2">
                    <span id="filter-type-label" className={GROUP_LABEL}>
                      Diplôme
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {["all", "PGE", "Bachelor", "Master", "MSc"].map((t) => (
                        <button
                          key={t}
                          type="button"
                          aria-pressed={activeType === t}
                          className={FILTER_BUTTON}
                          onClick={() => {
                            setActiveType(t);
                          }}
                        >
                          {t === "all" ? "Tous" : t === "MSc" ? "MSc / MS" : t}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div role="group" aria-labelledby="filter-level-label" className="flex flex-col gap-2">
                    <span id="filter-level-label" className={GROUP_LABEL}>
                      Niveau
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {["all", "Bac+3", "Bac+5", "Bac+6"].map((l) => (
                        <button
                          key={l}
                          type="button"
                          aria-pressed={activeLevel === l}
                          className={FILTER_BUTTON}
                          onClick={() => {
                            setActiveLevel(l);
                          }}
                        >
                          {l === "all" ? "Tous" : l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 lg:ml-auto lg:w-72">
                    <label htmlFor="select-campus" className={GROUP_LABEL}>
                      Campus
                    </label>
                    <Select id="select-campus" value={activeCampus} onChange={(e) => setActiveCampus(e.target.value)}>
                      <option value="all">Tous les campus ({school.campuses.length})</option>
                      {school.campuses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.city ? `${c.name} (${c.city})` : c.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* LISTE PLATE DE PROGRAMMES */}
                {filteredPrograms.length === 0 ? (
                  <p className={NO_DATA} id="programs-list">
                    Aucun programme ne correspond aux filtres sélectionnés.
                  </p>
                ) : (
                  <ul className="overflow-hidden rounded-card border border-line bg-surface" id="programs-list">
                    {filteredPrograms.map((prog) => {
                      const latestPrice = prog.pricingRecords[0] ?? null;
                      const type = inferProgramType(prog.name);
                      const level = inferProgramLevel(prog.name);

                      return (
                        <li key={prog.id} className="border-b border-line last:border-b-0">
                          <Link
                            href={`/schools/${school.id}/programs/${prog.id}`}
                            className="group flex flex-col gap-3 px-5 py-3.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:flex-row sm:items-center sm:gap-6"
                            id={`program-card-${prog.id}`}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                              <span className="text-sm leading-snug font-semibold text-ink group-hover:text-accent-strong">{prog.name}</span>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge tone="accent">{type}</Badge>
                                <Badge>{level}</Badge>
                                {prog.admission_exam && <Badge wrap>{prog.admission_exam}</Badge>}
                                {prog.is_alternance_possible && <Badge tone="success">Alternance</Badge>}
                                {prog.is_expatriation_mandatory && <Badge>Expatriation</Badge>}
                                {/* Campus disponibles */}
                                {prog.campuses.length > 0 && (
                                  <span className="ml-1 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
                                    <PinIcon />
                                    {prog.campuses.map((pc, index) => (
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
                              </div>
                            </div>
                            {latestPrice && (
                              <div className="shrink-0 sm:text-right">
                                <div className="font-mono text-sm font-medium text-ink tabular-nums">
                                  {(latestPrice.year_1_fee ?? latestPrice.total_fee)?.toLocaleString("fr-FR")} {latestPrice.currency}
                                </div>
                                <div className="text-xs text-ink-2">
                                  {latestPrice.year_1_fee ? "/an (1ère année)" : "total cursus"}
                                </div>
                              </div>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </TabPanel>

          {/* Onglet : Stats */}
          <TabPanel idPrefix="school" value="stats" selected={activeTab === "stats"} className="flex flex-col gap-3">
            {!latestStats ? (
              <p className={NO_DATA}>Aucune statistique disponible pour cette école.</p>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-ink-2">Données année {latestStats.academic_year}</p>
                  <SourceLine href={latestStats.source_href} provenance={latestStats.provenance} />
                </div>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {statItems.map((item) => (
                    <div key={item.label} className="flex flex-col-reverse gap-1 rounded-card border border-line bg-surface p-5">
                      <dt className="text-sm text-ink-2">{item.label}</dt>
                      <dd className="font-mono text-2xl font-medium text-ink tabular-nums" id={item.id}>
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {school.statsRecords.length > 1 && (
                  <p className="text-xs text-ink-2">
                    Données historiques disponibles : {school.statsRecords.map((r) => r.academic_year).join(", ")}
                  </p>
                )}
              </>
            )}
          </TabPanel>

          {/* Onglet : Accréditations */}
          <TabPanel idPrefix="school" value="accreditations" selected={activeTab === "accreditations"} className="flex flex-col gap-6">
            {school.accreditations.length === 0 ? (
              <p className={NO_DATA}>Aucune accréditation enregistrée pour cette école.</p>
            ) : (
              accreditationGroups.map((group) => (
                <section key={group.id} aria-labelledby={`accreditations-${group.id}`} className="flex flex-col gap-3">
                  <h2 id={`accreditations-${group.id}`} className="text-sm font-semibold text-ink">
                    {group.title}
                  </h2>
                  <ul className="flex flex-wrap items-start gap-2">{group.items.map(renderBadge)}</ul>
                </section>
              ))
            )}
          </TabPanel>
        </div>
      </div>
    </SiteShell>
  );
}
