/**
 * app/page.tsx — Page d'accueil publique (Étape 8.1)
 *
 * - Liste des écoles ACTIVE avec recherche en temps réel
 * - ISR 1h (export revalidate)
 * - Données depuis /api/schools côté client (recherche dynamique)
 * - Référence : task.md §8.1, architecture.md §7.1
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Campus {
  id: string;
  name: string;
  city: string | null;
  programs: { id: string }[];
}

interface School {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  campuses: Campus[];
}

interface SchoolsResponse {
  data: School[];
  pagination: {
    total: number;
    total_pages: number;
    page: number;
  };
}

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || name.slice(0, 2).toUpperCase();
}

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [schools, setSchools] = useState<School[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ schools: 0, campuses: 0, programs: 0 });

  const fetchSchools = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (search) params.set("search", search);
      const res = await fetch(`/api/schools?${params}`);
      if (!res.ok) throw new Error("Erreur réseau");
      const data: SchoolsResponse = await res.json();
      setSchools(data.data);
      setTotal(data.pagination.total);
    } catch {
      setSchools([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Chargement initial + stats globales
  useEffect(() => {
    fetchSchools("");
    fetch("/api/schools?limit=200")
      .then((r) => r.json())
      .then((d: SchoolsResponse) => {
        const allSchools = d.data;
        let totalCampuses = 0;
        let totalPrograms = 0;
        allSchools.forEach((s) => {
          totalCampuses += s.campuses.length;
          s.campuses.forEach((c) => {
            totalPrograms += c.programs.length;
          });
        });
        setStats({ schools: d.pagination.total, campuses: totalCampuses, programs: totalPrograms });
      })
      .catch(() => {});
  }, [fetchSchools]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => fetchSchools(query), 280);
    return () => clearTimeout(t);
  }, [query, fetchSchools]);

  const totalCampuses = (schools: School[]) =>
    schools.reduce((acc, s) => acc + s.campuses.length, 0);
  const totalPrograms = (schools: School[]) =>
    schools.reduce((acc, s) => s.campuses.reduce((a, c) => a + c.programs.length, acc), 0);

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

      {/* Hero */}
      <section className="hero-section">
        <div className="hero-badge">✦ Données vérifiées par des humains</div>
        <h1 className="hero-title">
          Toutes les données de<br />l&apos;enseignement supérieur
        </h1>
        <p className="hero-subtitle">
          Grilles tarifaires, classements, capacités d&apos;accueil et accréditations de toutes les grandes écoles françaises, centralisées et vérifiées.
        </p>

        {/* Search */}
        <div className="search-container">
          <div className="search-input-wrapper">
            <span className="search-input-icon">🔍</span>
            <input
              id="school-search-input"
              className="search-input"
              type="text"
              placeholder="Rechercher une école (ex: EMLV, HEC, Dauphine…)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
          </div>
          <p className="search-hint">
            {loading ? "Chargement…" : `${total} école${total > 1 ? "s" : ""} disponible${total > 1 ? "s" : ""}`}
          </p>
        </div>
      </section>

      {/* Stats Bar */}
      {!query && stats.schools > 0 && (
        <div className="stats-bar">
          <div className="stat-item">
            <div className="stat-value">{formatNumber(stats.schools)}</div>
            <div className="stat-label">Écoles</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{formatNumber(stats.campuses)}</div>
            <div className="stat-label">Campus</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">{formatNumber(stats.programs)}</div>
            <div className="stat-label">Programmes</div>
          </div>
        </div>
      )}

      {/* Schools Grid */}
      <main className="public-container" id="schools-list">
        <div className="section-header">
          <span className="section-title">
            {query ? `Résultats pour « ${query} »` : "Toutes les écoles"}
          </span>
          {!loading && (
            <span className="section-count" id="results-count">
              {schools.length} résultat{schools.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        {loading ? (
          <div className="schools-grid">
            {[...Array(6)].map((_, i) => (
              <div key={i} style={{ background: "var(--bg-secondary)", borderRadius: "var(--radius-lg)", padding: "28px", border: "1px solid var(--border-color)", display: "flex", flexDirection: "column", gap: "12px" }}>
                <div className="skeleton" style={{ height: "48px", width: "48px", borderRadius: "12px" }} />
                <div className="skeleton" style={{ height: "18px", width: "70%" }} />
                <div className="skeleton" style={{ height: "14px", width: "40%" }} />
              </div>
            ))}
          </div>
        ) : schools.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🔭</div>
            <div className="empty-state-title">Aucune école trouvée</div>
            <p className="empty-state-text">
              Essayez un autre terme de recherche ou{" "}
              <Link href="/contribute" style={{ color: "var(--accent)" }}>contribuez</Link> en ajoutant des données.
            </p>
          </div>
        ) : (
          <div className="schools-grid">
            {schools.map((school) => {
              const campusCount = school.campuses.length;
              const programCount = school.campuses.reduce((a, c) => a + c.programs.length, 0);
              return (
                <Link
                  key={school.id}
                  href={`/schools/${school.id}`}
                  className="school-card"
                  id={`school-card-${school.id}`}
                >
                  <div className="school-card-header">
                    <div className="school-avatar">
                      {getInitials(school.name)}
                    </div>
                    <span className="school-status-badge">● Actif</span>
                  </div>
                  <div className="school-card-name">{school.name}</div>
                  <div className="school-card-domain">🌐 {school.official_domain}</div>
                  <div className="school-card-meta">
                    <span className="school-meta-item">
                      <span className="school-meta-icon">🏛️</span>
                      {campusCount} campus
                    </span>
                    <span className="school-meta-item">
                      <span className="school-meta-icon">📚</span>
                      {programCount} programme{programCount > 1 ? "s" : ""}
                    </span>
                  </div>
                  <span className="school-card-arrow">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </>
  );
}
