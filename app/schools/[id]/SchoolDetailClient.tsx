/**
 * app/schools/[id]/SchoolDetailClient.tsx — Composant client fiche école (Étape 8.1)
 *
 * - Affichage avec onglets : Programmes, Statistiques, Accréditations
 * - Micro-animations, design premium dark
 * - Référence : task.md §8.1
 */

"use client";

import { useState } from "react";
import Link from "next/link";

interface PricingRecord {
  id: string;
  academic_year: number;
  year_1_fee: number | null;
  total_fee: number | null;
  currency: string;
}

interface Program {
  id: string;
  name: string;
  admission_exam: string | null;
  is_alternance_possible: boolean;
  is_expatriation_mandatory: boolean;
  pricingRecords: PricingRecord[];
}

interface Campus {
  id: string;
  name: string;
  city: string | null;
  programs: Program[];
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
}

interface AccreditationRecord {
  id: string;
  accreditation_name: string;
  year_obtained: number;
  is_active: boolean;
}

interface School {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  campuses: Campus[];
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
  return `${Math.round(val * 100)}%`;
}

function formatNum(val: number | null): string {
  if (val === null) return "—";
  return val.toLocaleString("fr-FR");
}

type Tab = "programs" | "stats" | "accreditations";

export default function SchoolDetailClient({ school }: { school: School }) {
  const [activeTab, setActiveTab] = useState<Tab>("programs");

  const totalPrograms = school.campuses.reduce((a, c) => a + c.programs.length, 0);
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
          <Link href="/contribute" className="public-nav-cta">Contribuer</Link>
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
          {school.campuses.length === 0 ? (
            <div className="no-data">
              Aucun campus ni programme validé pour cette école. Les données sont en cours d&apos;enrichissement.
            </div>
          ) : (
            school.campuses.map((campus) => (
              <div key={campus.id} className="campus-section" id={`campus-${campus.id}`}>
                <div className="campus-title">
                  <span>🏛️</span>
                  {campus.name}
                  {campus.city && <span style={{ fontWeight: 400, color: "#64748b" }}>— {campus.city}</span>}
                </div>
                {campus.programs.length === 0 ? (
                  <div className="no-data">Aucun programme sur ce campus.</div>
                ) : (
                  <div className="programs-list">
                    {campus.programs.map((prog) => {
                      const latestPrice = prog.pricingRecords[0] ?? null;
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
                  </div>
                )}
              </div>
            ))
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
      {activeTab === "accreditations" && (
        <div className="tab-content" id="tab-content-accreditations">
          {school.accreditations.length === 0 ? (
            <div className="no-data">Aucune accréditation enregistrée pour cette école.</div>
          ) : (
            <div className="accreditations-list">
              {school.accreditations.map((acc) => (
                <div
                  key={acc.id}
                  className={`accreditation-badge${acc.is_active ? " active" : ""}`}
                  id={`accreditation-${acc.id}`}
                >
                  <span className="accreditation-dot" style={{ background: acc.is_active ? "#34d399" : "#6b7280" }} />
                  {acc.accreditation_name}
                  <span style={{ fontSize: "0.78rem", fontWeight: 400, color: "var(--text-secondary)", marginLeft: 4 }}>
                    depuis {acc.year_obtained}
                  </span>
                  {!acc.is_active && (
                    <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>(expirée)</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
