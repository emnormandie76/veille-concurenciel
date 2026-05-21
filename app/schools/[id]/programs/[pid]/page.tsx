/**
 * app/schools/[id]/programs/[pid]/page.tsx — Détail programme public (Étape 8.1)
 *
 * - Tarifs par année + total, classements, capacité
 * - ISR 1h
 * - Vérification école ACTIVE + appartenance programme
 * - Référence : task.md §8.1, architecture.md §7.1
 */

import { notFound } from "next/navigation";
import Link from "next/link";

export const revalidate = 3600; // ISR 1h — Étape 8.3

interface Props {
  params: Promise<{ id: string; pid: string }>;
}

async function getProgram(schoolId: string, programId: string) {
  const { prisma } = await import("@/lib/prisma");

  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      campus: {
        include: {
          school: true,
        },
      },
      pricingRecords: {
        orderBy: { academic_year: "desc" },
      },
      rankingRecords: {
        orderBy: [{ academic_year: "desc" }, { ranking_name: "asc" }],
      },
      capacityRecords: {
        orderBy: { academic_year: "desc" },
      },
    },
  });

  if (!program) return null;
  if (program.campus.schoolId !== schoolId) return null;
  if (program.campus.school.status !== "ACTIVE") return null;

  return program;
}

export async function generateMetadata({ params }: Props) {
  const { id, pid } = await params;
  const program = await getProgram(id, pid);
  if (!program) return { title: "Programme introuvable" };
  return {
    title: `${program.name} — ${program.campus.school.name} — EduData France`,
    description: `Tarifs, classements et capacité du programme ${program.name} à ${program.campus.school.name}`,
  };
}

function formatFee(amount: number | null, currency: string): string {
  if (amount === null) return "—";
  return `${amount.toLocaleString("fr-FR")} ${currency}`;
}

export default async function ProgramDetailPage({ params }: Props) {
  const { id, pid } = await params;
  const program = await getProgram(id, pid);

  if (!program) notFound();

  const school = program.campus.school;
  const latestPricing = program.pricingRecords[0] ?? null;

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

      {/* Hero programme */}
      <div className="program-detail-hero" id="program-hero">
        {/* Breadcrumb */}
        <nav className="breadcrumb" aria-label="Fil d'Ariane">
          <Link href="/">Accueil</Link>
          <span className="breadcrumb-sep">›</span>
          <Link href={`/schools/${school.id}`}>{school.name}</Link>
          <span className="breadcrumb-sep">›</span>
          <span>{program.name}</span>
        </nav>

        <h1 className="program-detail-title" id="program-title">{program.name}</h1>

        <div className="program-detail-meta">
          <span className="school-meta-item">
            <span className="school-meta-icon">🏛️</span>
            {school.name} — {program.campus.name}
            {program.campus.city && `, ${program.campus.city}`}
          </span>
          {program.admission_exam && (
            <span className="program-tag tag-exam">🎯 {program.admission_exam}</span>
          )}
          {program.is_alternance_possible && (
            <span className="program-tag tag-alternance">🔄 Alternance possible</span>
          )}
          {program.is_expatriation_mandatory && (
            <span className="program-tag tag-expat">✈️ Expatriation obligatoire</span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="tab-content" style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* Section Tarifs */}
        <section id="section-pricing" style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 20, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            💰 Tarifs de scolarité
          </h2>

          {program.pricingRecords.length === 0 ? (
            <div className="no-data" id="no-pricing-data">
              Aucune donnée tarifaire disponible.{" "}
              <Link href="/contribute" style={{ color: "var(--accent)" }}>Contribuer des données</Link>
            </div>
          ) : (
            <div className="pricing-table-wrapper">
              <table className="pricing-table" id="pricing-table">
                <thead>
                  <tr>
                    <th>Année académique</th>
                    <th>Année 1</th>
                    <th>Année 2</th>
                    <th>Année 3</th>
                    <th>Année 4</th>
                    <th>Année 5</th>
                    <th>Total cursus</th>
                    <th>Tarif intl.</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {program.pricingRecords.map((pr) => (
                    <tr key={pr.id} id={`pricing-row-${pr.id}`}>
                      <td><strong>{pr.academic_year}</strong></td>
                      <td className={pr.year_1_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.year_1_fee, pr.currency)}</td>
                      <td className={pr.year_2_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.year_2_fee ?? null, pr.currency)}</td>
                      <td className={pr.year_3_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.year_3_fee ?? null, pr.currency)}</td>
                      <td className={pr.year_4_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.year_4_fee ?? null, pr.currency)}</td>
                      <td className={pr.year_5_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.year_5_fee ?? null, pr.currency)}</td>
                      <td className={pr.total_fee !== null ? "price-val" : "price-null"}>{formatFee(pr.total_fee, pr.currency)}</td>
                      <td className={pr.intl_year_1_fee !== null || pr.intl_total_fee !== null ? "price-val" : "price-null"}>
                        {pr.intl_year_1_fee !== null
                          ? formatFee(pr.intl_year_1_fee, pr.intl_currency ?? pr.currency)
                          : pr.intl_total_fee !== null
                          ? formatFee(pr.intl_total_fee, pr.intl_currency ?? pr.currency)
                          : "—"}
                      </td>
                      <td style={{ fontSize: "0.8rem", color: "var(--text-secondary)", maxWidth: 200 }}>
                        {pr.additional_fees_notes ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Section Classements */}
        <section id="section-rankings" style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 20, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            🏆 Classements
          </h2>

          {program.rankingRecords.length === 0 ? (
            <div className="no-data" id="no-rankings-data">
              Aucune donnée de classement disponible.{" "}
              <Link href="/contribute" style={{ color: "var(--accent)" }}>Contribuer des données</Link>
            </div>
          ) : (
            <div className="rankings-list" id="rankings-list">
              {program.rankingRecords.map((rk) => (
                <div key={rk.id} className="ranking-item" id={`ranking-${rk.id}`}>
                  <div className="ranking-position">#{rk.rank}</div>
                  <div>
                    <div className="ranking-name">{rk.ranking_name}</div>
                    {rk.source_url && (
                      <a
                        href={rk.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "0.75rem", color: "var(--accent)" }}
                      >
                        Source ↗
                      </a>
                    )}
                  </div>
                  <div className="ranking-year">{rk.academic_year}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Section Capacité */}
        <section id="section-capacity" style={{ marginBottom: 48 }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: 20, color: "#fff", display: "flex", alignItems: "center", gap: 8 }}>
            👥 Places disponibles
          </h2>

          {program.capacityRecords.length === 0 ? (
            <div className="no-data" id="no-capacity-data">
              Aucune donnée de capacité disponible.{" "}
              <Link href="/contribute" style={{ color: "var(--accent)" }}>Contribuer des données</Link>
            </div>
          ) : (
            <div className="stats-grid" id="capacity-grid" style={{ maxWidth: 600 }}>
              {program.capacityRecords.map((cap) => (
                <div key={cap.id} className="stat-card" id={`capacity-${cap.id}`}>
                  <div className="stat-card-value">{cap.spots_available.toLocaleString("fr-FR")}</div>
                  <div className="stat-card-label">Places — {cap.academic_year}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Contribuer */}
        <div
          style={{
            padding: "24px",
            background: "var(--bg-secondary)",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Une donnée est incorrecte ou manquante ?</div>
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Contribuez en soumettant une URL source — notre équipe vérifiera et intégrera l&apos;information.
            </div>
          </div>
          <Link href="/contribute" className="btn btn-primary" id="contribute-cta">
            ✏️ Contribuer
          </Link>
        </div>
      </div>
    </>
  );
}
