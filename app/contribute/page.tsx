/**
 * app/contribute/page.tsx — Page de contribution publique (Étape 7.1)
 *
 * CORRECTIF : classes Tailwind remplacées par les classes du design system CSS vanilla.
 * - Dropdown École avec autocomplete (depuis GET /api/schools)
 * - Dropdown Campus (chargé dynamiquement)
 * - Dropdown Programme (chargé dynamiquement)
 * - Multi-select catégories
 * - Champ texte libre + URL source
 * - Validation : école requise, URL https://, au moins 1 catégorie
 * - Référence : task.md §7.1, architecture.md §6.1
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface School {
  id: string;
  name: string;
  official_domain?: string;
}

interface Campus {
  id: string;
  name: string;
  city: string | null;
  programs: Program[];
}

interface Program {
  id: string;
  name: string;
}

interface SchoolDetail {
  campuses: Campus[];
}

const CATEGORY_OPTIONS = [
  { id: "Pricing",       label: "💰 Tarifs de scolarité",   description: "Frais annuels, total cursus" },
  { id: "Ranking",       label: "🏆 Classement",            description: "Figaro, L'Étudiant, FT…" },
  { id: "Capacity",      label: "👥 Capacité (Places)",     description: "Nombre d'admis par promo" },
  { id: "SchoolStats",   label: "📊 Statistiques école",    description: "Étudiants, alumni, partenaires" },
  { id: "Accreditation", label: "🎓 Accréditation",         description: "EQUIS, AACSB, AMBA…" },
];

const smoothScrollToTop = (duration: number = 500) => {
  if (typeof window === "undefined") return;
  const start = window.scrollY;
  const startTime = performance.now();

  const easeInOutCubic = (t: number) => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };

  const animation = (currentTime: number) => {
    const timeElapsed = currentTime - startTime;
    const progress = Math.min(timeElapsed / duration, 1);
    const ease = easeInOutCubic(progress);

    window.scrollTo(0, start * (1 - ease));

    if (timeElapsed < duration) {
      requestAnimationFrame(animation);
    }
  };

  requestAnimationFrame(animation);
};

export default function ContributePage() {
  const [schools, setSchools]                 = useState<School[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [schoolDetail, setSchoolDetail]       = useState<SchoolDetail | null>(null);
  const [selectedCampusId, setSelectedCampusId] = useState("");
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [categories, setCategories]           = useState<string[]>([]);
  const [userText, setUserText]               = useState("");
  const [urlInput, setUrlInput]               = useState("");
  const [submitting, setSubmitting]           = useState(false);
  const [success, setSuccess]                 = useState("");
  const [error, setError]                     = useState("");

  // Charger la liste des écoles ACTIVE
  useEffect(() => {
    fetch("/api/schools?limit=200")
      .then((r) => r.json())
      .then((d) => setSchools(Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : []))
      .catch(() => setError("Impossible de charger la liste des écoles."));
  }, []);

  // Charger les campus dynamiquement quand une école est sélectionnée
  useEffect(() => {
    if (!selectedSchoolId) {
      setSchoolDetail(null);
      setSelectedCampusId("");
      setSelectedProgramId("");
      return;
    }
    fetch(`/api/schools/${selectedSchoolId}`)
      .then((r) => r.json())
      .then((d) => setSchoolDetail(d))
      .catch(() => setError("Impossible de charger les campus."));
  }, [selectedSchoolId]);

  // Réinitialiser le programme quand le campus change
  useEffect(() => {
    setSelectedProgramId("");
  }, [selectedCampusId]);

  const toggleCategory = (id: string) => {
    setCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!selectedSchoolId) {
      setError("Veuillez sélectionner une école.");
      smoothScrollToTop(500);
      return;
    }
    if (categories.length === 0) {
      setError("Sélectionnez au moins une catégorie.");
      smoothScrollToTop(500);
      return;
    }
    if (!urlInput.startsWith("https://")) {
      setError("L'URL doit commencer par https://");
      smoothScrollToTop(500);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/contribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          campusId: selectedCampusId || null,
          programId: selectedProgramId || null,
          categories,
          userText,
          urls: [urlInput],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`✅ Merci ! ${data.ticketsCreated} soumission(s) enregistrée(s). Notre équipe vérifiera les données.`);
        setCategories([]);
        setUserText("");
        setUrlInput("");
        setSelectedSchoolId("");
      } else {
        setError(data.error || "Une erreur est survenue.");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur de connexion.");
    } finally {
      setSubmitting(false);
      smoothScrollToTop(500);
    }
  };

  const campuses  = schoolDetail?.campuses ?? [];
  const programs  = campuses.find((c) => c.id === selectedCampusId)?.programs ?? [];
  const isReady   = !submitting;

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
          <Link href="/contribute" className="public-nav-cta">Contribuer</Link>
        </div>
      </nav>

      {/* Page */}
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div className="hero-badge" style={{ marginBottom: 16, display: "inline-flex" }}>
            ✦ Crowdsourcing
          </div>
          <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2.2rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 12 }}>
            Soumettre une information
          </h1>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, fontSize: "0.95rem", maxWidth: 560 }}>
            Vous avez connaissance de données manquantes ou incorrectes ? Soumettez une source officielle — notre équipe vérifiera et intégrera l&apos;information.
          </p>
        </div>

        {/* Alerts */}
        {error   && <div className="alert alert-danger" id="contribute-error" role="alert">⚠️ {error}</div>}
        {success && <div className="alert alert-success" id="contribute-success" role="alert">{success}</div>}

        <form onSubmit={handleSubmit} id="contribute-form" noValidate>

          {/* Bloc 1 — École */}
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            marginBottom: 20,
          }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 16, color: "#fff" }}>
              1 — Sélectionner l&apos;établissement
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="school-select">
                École <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <select
                id="school-select"
                className="form-control"
                value={selectedSchoolId}
                onChange={(e) => setSelectedSchoolId(e.target.value)}
                required
              >
                <option value="">— Sélectionnez une école —</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            {campuses.length > 0 && (
              <div className="form-group">
                <label className="form-label" htmlFor="campus-select">
                  Campus <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 400 }}>(optionnel)</span>
                </label>
                <select
                  id="campus-select"
                  className="form-control"
                  value={selectedCampusId}
                  onChange={(e) => setSelectedCampusId(e.target.value)}
                >
                  <option value="">Tous les campus / Non spécifié</option>
                  {campuses.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.city ? ` — ${c.city}` : ""}</option>
                  ))}
                </select>
              </div>
            )}

            {selectedCampusId && programs.length > 0 && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="program-select">
                  Programme <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 400 }}>(optionnel)</span>
                </label>
                <select
                  id="program-select"
                  className="form-control"
                  value={selectedProgramId}
                  onChange={(e) => setSelectedProgramId(e.target.value)}
                >
                  <option value="">Tous les programmes / Non spécifié</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Bloc 2 — Catégories */}
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            marginBottom: 20,
          }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 16, color: "#fff" }}>
              2 — Type d&apos;information <span style={{ color: "var(--danger)" }}>*</span>
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {CATEGORY_OPTIONS.map((cat) => {
                const checked = categories.includes(cat.id);
                return (
                  <label
                    key={cat.id}
                    htmlFor={`cat-${cat.id}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "14px 16px",
                      background: checked ? "rgba(59,130,246,0.08)" : "var(--bg-primary)",
                      border: `1px solid ${checked ? "rgba(59,130,246,0.4)" : "var(--border-color)"}`,
                      borderRadius: "var(--radius-md)",
                      cursor: "pointer",
                      transition: "var(--transition-fast)",
                    }}
                  >
                    <input
                      type="checkbox"
                      id={`cat-${cat.id}`}
                      checked={checked}
                      onChange={() => toggleCategory(cat.id)}
                      style={{ marginTop: 2, accentColor: "var(--accent)", width: 16, height: 16, flexShrink: 0 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{cat.label}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: 2 }}>{cat.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Bloc 3 — Détails */}
          <div style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-lg)",
            padding: 24,
            marginBottom: 28,
          }}>
            <h2 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: 16, color: "#fff" }}>
              3 — Source et détails
            </h2>

            <div className="form-group">
              <label className="form-label" htmlFor="url-input">
                URL de la source officielle <span style={{ color: "var(--danger)" }}>*</span>
              </label>
              <input
                id="url-input"
                type="url"
                className="form-control"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://www.emlv.fr/frais-de-scolarite/"
                required
              />
              <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 4 }}>
                Doit commencer par https:// — page officielle de l&apos;école ou d&apos;un organisme de classement.
              </span>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="user-text">
                Description <span style={{ fontSize: "0.78rem", color: "var(--text-secondary)", fontWeight: 400 }}>(optionnel)</span>
              </label>
              <textarea
                id="user-text"
                className="form-control"
                rows={3}
                value={userText}
                onChange={(e) => setUserText(e.target.value)}
                placeholder="Ex: Les frais 2025 ont augmenté, ils sont de 8 500 €/an pour la 1ère année…"
                style={{ resize: "vertical" }}
              />
            </div>
          </div>

          {/* Submit */}
          <button
            id="submit-btn"
            type="submit"
            className="btn btn-primary"
            disabled={!isReady}
            style={{ width: "100%", padding: "16px", fontSize: "1rem", fontWeight: 600 }}
          >
            {submitting ? "⏳ Envoi en cours…" : "✉️ Soumettre la contribution"}
          </button>

          <p style={{ textAlign: "center", marginTop: 16, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
            Données vérifiées par notre équipe avant publication · Pas de compte requis
          </p>
        </form>
      </div>
    </>
  );
}