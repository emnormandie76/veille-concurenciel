/**
 * app/schools/[id]/SchoolDetailClient.tsx — Composant client fiche école (Étape 8.1)
 *
 * - Affichage avec onglets : Programmes, Statistiques, Accréditations
 * - Micro-animations, design premium dark
 * - Plan gestion-contenu, étape 5 : l'école, ses chiffres clés et ses
 *   accréditations montrent leur lien source et « Modifié par … le … »,
 *   préparés par la page serveur (`provenance`, `source_href`)
 * - Étape 6 : un lien « Signaler une information » vers le formulaire
 * - Référence : task.md §8.1
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import SignOutButton from "../../SignOutButton";
import SourceLine from "../SourceLine";

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

export default function SchoolDetailClient({ school }: { school: School }) {
  const [activeTab, setActiveTab] = useState<Tab>("programs");
  const [activeType, setActiveType] = useState<string>("all");
  const [activeLevel, setActiveLevel] = useState<string>("all");
  const [activeCampus, setActiveCampus] = useState<string>("all");

  const totalPrograms = school.programs.length;
  const latestStats = school.statsRecords[0] ?? null;

  return (
    <>
      {/* Navbar */}
      <nav className="public-nav" id="main-nav">
        <Link href="/" className="public-nav-logo">
          <span className="public-nav-logo-icon">🎓</span>
          EduData France
        </Link>
        <div className="public-nav-links">
          <Link href="/" className="public-nav-link">Écoles</Link>
          <Link href="/api-docs" className="public-nav-link">API</Link>
          <Link href="/account" className="public-nav-link">Mon compte</Link>
          <SignOutButton className="public-nav-cta" />
        </div>
      </nav>

      {/* Hero école */}
      <div className="school-detail-hero" id="school-hero">
        {/* Breadcrumb */}
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <Link href="/">Accueil</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href="/">Écoles</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{school.name}</span>
        </nav>

        <div className="school-detail-header">
          <div className="school-detail-avatar">
            {getInitials(school.name)}
          </div>
          <div className="school-detail-info">
            <h1>{school.name}</h1>
            <div className="school-detail-domain">
              <span>🌐</span>
              <a
                href={`https://${school.official_domain}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {school.official_domain}
              </a>
              <span style={{ marginLeft: 12, color: "var(--text-secondary)" }}>
                • {school.campuses.length} campus • {totalPrograms} programme{totalPrograms > 1 ? "s" : ""}
              </span>
            </div>
            <SourceLine href={null} provenance={school.provenance} />
            {/* Étape 6 (D33) : le formulaire de signalement est une page de la
                charte ; le lien garde l'ancien style de la fiche. */}
            <Link href={`/schools/${school.id}/report`} className="btn btn-secondary" style={{ marginTop: 12 }}>
              Signaler une information
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-nav" id="tabs-nav">
        <button
          id="tab-programs"
          className={`tab-btn${activeTab === "programs" ? " active" : ""}`}
          onClick={() => setActiveTab("programs")}
        >
          📚 Programmes ({totalPrograms})
        </button>
        <button
          id="tab-stats"
          className={`tab-btn${activeTab === "stats" ? " active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          📊 Statistiques
        </button>
        <button
          id="tab-accreditations"
          className={`tab-btn${activeTab === "accreditations" ? " active" : ""}`}
          onClick={() => setActiveTab("accreditations")}
        >
          🏆 Accréditations ({school.accreditations.length})
        </button>
      </div>

      {/* Tab : Programmes */}
      {activeTab === "programs" && (
        <div className="tab-content" id="tab-content-programs">
          {school.programs.length === 0 ? (
            <div className="no-data">
              Aucun programme validé pour cette école. Les données sont en cours d&apos;enrichissement.
            </div>
          ) : (
            <>
              {/* FILTRES CLIENT-SIDE */}
              <div className="filter-panel" id="programs-filter-panel">
                <div className="filter-section">
                  <span className="filter-label">Diplôme</span>
                  <div className="filter-options">
                    {["all", "PGE", "Bachelor", "Master", "MSc"].map((t) => (
                      <button
                        key={t}
                        className={`filter-btn${activeType === t ? " active" : ""}`}
                        onClick={() => { setActiveType(t); }}
                      >
                        {t === "all" ? "Tous" : t === "MSc" ? "MSc / MS" : t}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="filter-section">
                  <span className="filter-label">Niveau</span>
                  <div className="filter-options">
                    {["all", "Bac+3", "Bac+5", "Bac+6"].map((l) => (
                      <button
                        key={l}
                        className={`filter-btn${activeLevel === l ? " active" : ""}`}
                        onClick={() => { setActiveLevel(l); }}
                      >
                        {l === "all" ? "Tous" : l}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="filter-section">
                  <span className="filter-label">Campus</span>
                  <div className="filter-options" style={{ width: "100%", maxWidth: "340px" }}>
                    <select
                      id="select-campus"
                      className="filter-btn"
                      value={activeCampus}
                      onChange={(e) => setActiveCampus(e.target.value)}
                      style={{
                        background: "var(--bg-tertiary)",
                        border: "1px solid var(--border-color)",
                        color: "var(--text-primary)",
                        padding: "8px 12px",
                        borderRadius: "var(--radius-sm)",
                        width: "100%",
                        cursor: "pointer",
                        outline: "none"
                      }}
                    >
                      <option value="all">Tous les campus ({school.campuses.length})</option>
                      {school.campuses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.city ? `${c.name} (${c.city})` : c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* LISTE PLATE DE PROGRAMMES */}
              <div className="programs-list" id="programs-list">
                {school.programs
                  .filter((prog) => {
                    const type = inferProgramType(prog.name);
                    const level = inferProgramLevel(prog.name);
                    const typeMatch = activeType === "all" || type === activeType;
                    const levelMatch = activeLevel === "all" || level === activeLevel;
                    const campusMatch = activeCampus === "all" || prog.campuses.some((pc) => pc.campus.id === activeCampus);
                    return typeMatch && levelMatch && campusMatch;
                  })
                  .map((prog) => {
                    const latestPrice = prog.pricingRecords[0] ?? null;
                    const type = inferProgramType(prog.name);
                    const level = inferProgramLevel(prog.name);

                    return (
                      <Link
                        key={prog.id}
                        href={`/schools/${school.id}/programs/${prog.id}`}
                        className="program-card"
                        id={`program-card-${prog.id}`}
                      >
                        <div className="program-card-left">
                          <div className="program-card-name">{prog.name}</div>
                          <div className="program-card-tags">
                            <span className="program-tag tag-type">{type}</span>
                            <span className="program-tag tag-level">{level}</span>
                            {prog.admission_exam && (
                              <span className="program-tag tag-exam">🎯 {prog.admission_exam}</span>
                            )}
                            {prog.is_alternance_possible && (
                              <span className="program-tag tag-alternance">🔄 Alternance</span>
                            )}
                            {prog.is_expatriation_mandatory && (
                              <span className="program-tag tag-expat">✈️ Expatriation</span>
                            )}
                          </div>
                          {/* Badges campus disponibles */}
                          {prog.campuses.length > 0 && (
                            <div className="program-campus-badges">
                              <span className="campus-badge-icon">📍</span>
                              {prog.campuses.map((pc) => (
                                <span key={pc.id} className="campus-badge">
                                  {pc.campus.city ?? pc.campus.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {latestPrice && (
                          <div className="program-card-price">
                            {(latestPrice.year_1_fee ?? latestPrice.total_fee)?.toLocaleString("fr-FR")} {latestPrice.currency}
                            <div className="program-price-year">
                              {latestPrice.year_1_fee ? "/an (1ère année)" : "total cursus"}
                            </div>
                          </div>
                        )}
                      </Link>
                    );
                  })}
                {school.programs.filter((prog) => {
                  const type = inferProgramType(prog.name);
                  const level = inferProgramLevel(prog.name);
                  const campusMatch = activeCampus === "all" || prog.campuses.some((pc) => pc.campus.id === activeCampus);
                  return (activeType === "all" || type === activeType) && 
                         (activeLevel === "all" || level === activeLevel) &&
                         campusMatch;
                }).length === 0 && (
                  <div className="no-data">
                    Aucun programme ne correspond aux filtres sélectionnés.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab : Stats */}
      {activeTab === "stats" && (
        <div className="tab-content" id="tab-content-stats">
          {!latestStats ? (
            <div className="no-data">Aucune statistique disponible pour cette école.</div>
          ) : (
            <>
              <div style={{ marginBottom: 24, color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Données année {latestStats.academic_year}
                <SourceLine href={latestStats.source_href} provenance={latestStats.provenance} />
              </div>
              <div className="stats-grid">
                {latestStats.total_students !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value" id="stat-students">{formatNum(latestStats.total_students)}</div>
                    <div className="stat-card-label">Étudiants</div>
                  </div>
                )}
                {latestStats.total_alumni !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.total_alumni)}</div>
                    <div className="stat-card-label">Alumni</div>
                  </div>
                )}
                {latestStats.partner_companies !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.partner_companies)}</div>
                    <div className="stat-card-label">Entreprises partenaires</div>
                  </div>
                )}
                {latestStats.annual_internship_offers !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.annual_internship_offers)}</div>
                    <div className="stat-card-label">Offres de stage/an</div>
                  </div>
                )}
                {latestStats.abroad_campuses !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.abroad_campuses)}</div>
                    <div className="stat-card-label">Campus à l&apos;étranger</div>
                  </div>
                )}
                {latestStats.partner_universities !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.partner_universities)}</div>
                    <div className="stat-card-label">Universités partenaires</div>
                  </div>
                )}
                {latestStats.permanent_professors !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatNum(latestStats.permanent_professors)}</div>
                    <div className="stat-card-label">Professeurs permanents</div>
                  </div>
                )}
                {latestStats.international_professors_pct !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatPct(latestStats.international_professors_pct)}</div>
                    <div className="stat-card-label">Profs internationaux</div>
                  </div>
                )}
                {latestStats.external_speakers_pct !== null && (
                  <div className="stat-card">
                    <div className="stat-card-value">{formatPct(latestStats.external_speakers_pct)}</div>
                    <div className="stat-card-label">Intervenants extérieurs</div>
                  </div>
                )}
              </div>
              {school.statsRecords.length > 1 && (
                <p style={{ fontSize: "0.82rem", color: "var(--text-secondary)", marginTop: 8 }}>
                  Données historiques disponibles : {school.statsRecords.map((r) => r.academic_year).join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab : Accréditations */}
      {activeTab === "accreditations" && (() => {
        const internationals = school.accreditations.filter(acc => !acc.accreditation_type || acc.accreditation_type === "international");
        const states = school.accreditations.filter(acc => acc.accreditation_type === "state");
        const labels = school.accreditations.filter(acc => acc.accreditation_type === "label");

        const renderBadge = (acc: AccreditationRecord) => (
          <div
            key={acc.id}
            className={`accreditation-badge${acc.is_active ? " active" : ""}`}
            id={`accreditation-${acc.id}`}
          >
            <span className="accreditation-dot" style={{ background: acc.is_active ? "#34d399" : "#6b7280" }} />
            {acc.accreditation_name}
            {acc.year_obtained != null && (
              <span style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--text-secondary)", marginLeft: 4 }}>
                depuis {acc.year_obtained}
              </span>
            )}
            {!acc.is_active && (
              <span style={{ fontSize: "0.72rem", color: "#6b7280", marginLeft: 4 }}>(expirée)</span>
            )}
            <SourceLine href={acc.source_href} provenance={acc.provenance} />
          </div>
        );

        return (
          <div className="tab-content" id="tab-content-accreditations">
            {school.accreditations.length === 0 ? (
              <div className="no-data">Aucune accréditation enregistrée pour cette école.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                {internationals.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                      🌍 Accréditations Internationales
                    </h3>
                    <div className="accreditations-list">
                      {internationals.map(renderBadge)}
                    </div>
                  </div>
                )}

                {states.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                      🇫🇷 Reconnaissances de l&apos;État français
                    </h3>
                    <div className="accreditations-list">
                      {states.map(renderBadge)}
                    </div>
                  </div>
                )}

                {labels.length > 0 && (
                  <div>
                    <h3 style={{ fontSize: "1rem", fontWeight: 700, color: "#fff", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                      🏷️ Labels & Certifications
                    </h3>
                    <div className="accreditations-list">
                      {labels.map(renderBadge)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
}
