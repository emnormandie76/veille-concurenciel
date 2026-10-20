"use client";

/**
 * L'onglet « Admissions » de la gestion d'une école (plan gestion-contenu,
 * étape 8) : pour chaque programme, en quelle année on entre, avec quel niveau
 * et par quelle voie.
 *
 * - D16, D48 : une carte par entrée ; l'année, le niveau et la voie se
 *   choisissent dans les listes de lib/program-entries.ts, que la base tient
 *   aussi ; le nom du concours va dans la note ;
 * - D50 : au motif des classements, la lecture par l'école
 *   (`schools/[id]/entries`, filtre par programme), la création par le
 *   programme, la modification et la suppression par l'entrée ;
 * - D49 : un lien source (contrôlé par le serveur, D27 ; cliquable en http(s)
 *   seulement) et « Modifié par … le … » sous chaque entrée (D29) ;
 * - D51 : l'ancien style de l'écran (cartes et fenêtre de l'onglet
 *   Accréditations), sans règle ajoutée à globals.css ; l'étape 9 le reprendra.
 *
 * Les règles sont tenues par les routes ; cet écran ne fait que les montrer.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ENTRY_ROUTES,
  ENTRY_YEAR_MAX,
  ENTRY_YEAR_MIN,
  NOTE_MAX_LENGTH,
  REQUIRED_LEVEL_MAX,
  REQUIRED_LEVEL_MIN,
  ROUTE_LABELS,
  describeEntry,
  entryYearLabel,
  levelLabel,
  routeLabel,
} from "@/lib/program-entries";
import { sourceHref } from "@/lib/provenance";
import ProgramSelector from "../components/ProgramSelector";
import LastEdit from "../../LastEdit";

interface ProgramOption {
  id: string;
  name: string;
}

interface ProgramEntry {
  id: string;
  programId: string;
  entry_year: number;
  required_level: number;
  route: string;
  note: string | null;
  source_url: string | null;
  // « Modifié par … le … » (étape 8, D49).
  last_edit: string | null;
  program: ProgramOption;
}

const YEARS = Array.from({ length: ENTRY_YEAR_MAX - ENTRY_YEAR_MIN + 1 }, (_, i) => ENTRY_YEAR_MIN + i);
const LEVELS = Array.from({ length: REQUIRED_LEVEL_MAX - REQUIRED_LEVEL_MIN + 1 }, (_, i) => REQUIRED_LEVEL_MIN + i);

type Loaded = { ok: true; programs: ProgramOption[]; entries: ProgramEntry[] } | { ok: false; error: string };

async function messageOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

/** Lit les programmes et les entrées, sans toucher à l'état de l'écran (l'appelant applique le résultat). */
async function loadAdmissions(schoolId: string, programId: string | null): Promise<Loaded> {
  try {
    const resPrograms = await fetch(`/api/admin/schools/${schoolId}/programs`);
    if (!resPrograms.ok) return { ok: false, error: "Erreur de chargement des programmes" };
    const programs = (await resPrograms.json()) as ProgramOption[];

    const query = programId ? `?programId=${encodeURIComponent(programId)}` : "";
    const resEntries = await fetch(`/api/admin/schools/${schoolId}/entries${query}`);
    if (!resEntries.ok) return { ok: false, error: await messageOf(resEntries, "Erreur de chargement des admissions") };
    const entries = (await resEntries.json()) as ProgramEntry[];

    return { ok: true, programs: programs.map((p) => ({ id: p.id, name: p.name })), entries };
  } catch {
    return { ok: false, error: "Une erreur réseau est survenue. Rechargez la page." };
  }
}

export default function AdmissionsTab({ schoolId }: { schoolId: string }) {
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [entries, setEntries] = useState<ProgramEntry[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<ProgramEntry | null>(null);
  const [formProgramId, setFormProgramId] = useState("");
  const [formYear, setFormYear] = useState(ENTRY_YEAR_MIN);
  const [formLevel, setFormLevel] = useState(REQUIRED_LEVEL_MIN);
  const [formRoute, setFormRoute] = useState<string>("UNSPECIFIED");
  const [formNote, setFormNote] = useState("");
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteEntry, setDeleteEntry] = useState<ProgramEntry | null>(null);

  const apply = useCallback((loaded: Loaded) => {
    if (loaded.ok) {
      setPrograms(loaded.programs);
      setEntries(loaded.entries);
      setError(null);
    } else {
      setError(loaded.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAdmissions(schoolId, null).then(apply);
  }, [schoolId, apply]);

  const reload = async (programId: string | null = selectedProgramId) => {
    setLoading(true);
    apply(await loadAdmissions(schoolId, programId));
  };

  const handleProgramChange = (programId: string | null) => {
    setSelectedProgramId(programId);
    void reload(programId);
  };

  const openAddModal = () => {
    setEditingEntry(null);
    setFormProgramId(selectedProgramId || (programs.length > 0 ? programs[0].id : ""));
    setFormYear(ENTRY_YEAR_MIN);
    setFormLevel(REQUIRED_LEVEL_MIN);
    setFormRoute("UNSPECIFIED");
    setFormNote("");
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (entry: ProgramEntry) => {
    setEditingEntry(entry);
    setFormProgramId(entry.programId);
    setFormYear(entry.entry_year);
    setFormLevel(entry.required_level);
    setFormRoute(entry.route);
    setFormNote(entry.note || "");
    setFormSourceUrl(entry.source_url || "");
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProgramId) {
      setModalError("Veuillez sélectionner un programme.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      entry_year: formYear,
      required_level: formLevel,
      route: formRoute,
      note: formNote.trim(),
      // Vide : pas de lien. Le serveur refuse ce qui n'est pas une adresse web (D27).
      source_url: formSourceUrl.trim(),
    };

    try {
      const url = editingEntry
        ? `/api/admin/program-entries/${editingEntry.id}`
        : `/api/admin/programs/${formProgramId}/entries`;
      const res = await fetch(url, {
        method: editingEntry ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setModalError(await messageOf(res, "Une erreur est survenue"));
        return;
      }
      setIsModalOpen(false);
      await reload();
    } catch {
      setModalError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteEntry) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/program-entries/${deleteEntry.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(await messageOf(res, "Erreur lors de la suppression"));
        return;
      }
      setDeleteEntry(null);
      await reload();
    } catch {
      setError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      <div className="tab-section-header">
        <h2 className="tab-section-title">Admissions</h2>
        <button className="btn btn-primary btn-sm" onClick={openAddModal} disabled={programs.length === 0}>
          ➕ Ajouter une entrée
        </button>
      </div>

      <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem", marginBottom: "16px" }}>
        En quelle année du programme on entre, avec quel niveau et par quelle voie. Le nom du concours va dans la note.
      </p>

      <div style={{ marginBottom: "20px" }}>
        <ProgramSelector
          programs={programs}
          selectedProgramId={selectedProgramId}
          onProgramChange={handleProgramChange}
          showAllOption={true}
          loading={loading || actionLoading}
        />
      </div>

      {error && <div className="alert alert-danger" style={{ marginBottom: "20px" }}>{error}</div>}

      {loading ? (
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-secondary)" }}>
          Chargement des admissions...
        </div>
      ) : programs.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)" }}>
            Aucun programme enregistré. Créez des programmes dans l&apos;onglet Campus & Programmes avant d&apos;ajouter des admissions.
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="inline-form" style={{ textAlign: "center", padding: "40px" }}>
          <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
            Aucune entrée enregistrée pour les critères sélectionnés.
          </p>
          <button className="btn btn-primary btn-sm" onClick={openAddModal}>
            ➕ Ajouter une première entrée
          </button>
        </div>
      ) : (
        <div className="cards-grid">
          {entries.map((entry) => (
            <div key={entry.id} className="data-card">
              <div className="data-card-header">
                <span className="data-card-title">{describeEntry(entry)}</span>
                <div className="data-card-actions">
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditModal(entry)}
                    style={{ padding: "4px 8px" }}
                  >
                    Modifier
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => setDeleteEntry(entry)}
                    style={{ padding: "4px 8px" }}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
              <div className="data-card-meta">
                <span style={{ fontWeight: 600 }}>{entry.program.name}</span>
                <span className="badge badge-admin">{levelLabel(entry.required_level)}</span>
                <span>{routeLabel(entry.route)}</span>
                {sourceHref(entry.source_url) && (
                  <a
                    href={sourceHref(entry.source_url)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent)", textDecoration: "none", fontSize: "0.85rem" }}
                  >
                    Source 🔗
                  </a>
                )}
              </div>
              {entry.note && (
                <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginTop: "8px" }}>{entry.note}</p>
              )}
              <LastEdit text={entry.last_edit} />
            </div>
          ))}
        </div>
      )}

      {/* Fenêtre d'ajout et de modification */}
      {isModalOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">{editingEntry ? "Modifier l'entrée" : "Ajouter une entrée"}</h3>
              <button className="modal-close" onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>

            {modalError && <div className="alert alert-danger" style={{ marginBottom: "16px" }}>{modalError}</div>}

            <form onSubmit={handleFormSubmit}>
              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="entry-program">
                  Programme *
                </label>
                <select
                  id="entry-program"
                  className="form-control"
                  value={formProgramId}
                  onChange={(e) => setFormProgramId(e.target.value)}
                  disabled={Boolean(editingEntry)}
                  required
                >
                  <option value="" disabled>
                    Choisir un programme
                  </option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="inline-form-grid" style={{ marginBottom: "16px", gridTemplateColumns: "1fr 1fr" }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="entry-year">
                    Année d&apos;entrée *
                  </label>
                  <select
                    id="entry-year"
                    className="form-control"
                    value={formYear}
                    onChange={(e) => setFormYear(Number(e.target.value))}
                  >
                    {YEARS.map((year) => (
                      <option key={year} value={year}>
                        {entryYearLabel(year)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="entry-level">
                    Niveau requis *
                  </label>
                  <select
                    id="entry-level"
                    className="form-control"
                    value={formLevel}
                    onChange={(e) => setFormLevel(Number(e.target.value))}
                  >
                    {LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {levelLabel(level)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="entry-route">
                  Voie *
                </label>
                <select
                  id="entry-route"
                  className="form-control"
                  value={formRoute}
                  onChange={(e) => setFormRoute(e.target.value)}
                >
                  {ENTRY_ROUTES.map((route) => (
                    <option key={route} value={route}>
                      {ROUTE_LABELS[route]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label" htmlFor="entry-note">
                  Note
                </label>
                <input
                  id="entry-note"
                  type="text"
                  className="form-control"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder="ex: Concours BCE, Passerelle 1, BTS ou BUT validé..."
                />
              </div>

              <div className="form-group" style={{ marginBottom: "24px" }}>
                <label className="form-label" htmlFor="entry-source-url">
                  URL de la source
                </label>
                <input
                  id="entry-source-url"
                  type="text"
                  className="form-control"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/programme/admissions"
                />
              </div>

              <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={actionLoading}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? "Enregistrement..." : editingEntry ? "Modifier" : "Ajouter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation de la suppression */}
      {deleteEntry && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3 className="modal-title">Supprimer l&apos;entrée</h3>
              <button className="modal-close" onClick={() => setDeleteEntry(null)}>
                ✕
              </button>
            </div>
            <p style={{ marginBottom: "24px", color: "var(--text-secondary)" }}>
              Êtes-vous sûr de vouloir supprimer cette entrée de {deleteEntry.program.name}{" "}
              : <strong style={{ color: "#ffffff" }}>{describeEntry(deleteEntry)}</strong> ?
            </p>
            <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "12px" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteEntry(null)}
                disabled={actionLoading}
              >
                Annuler
              </button>
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={actionLoading}>
                {actionLoading ? "Suppression..." : "Supprimer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
