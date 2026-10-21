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
 *   Accréditations) jusqu'à l'étape 9 ; dans la charte depuis le lot 2
 *   (cartes, dialogues natifs ; l'erreur d'une fenêtre dans la fenêtre, D67).
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
import { ExternalIcon } from "@/app/schools/icons";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { TEXT_LINK } from "@/components/ui/text-link";
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
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const openDeleteModal = (entry: ProgramEntry) => {
    setDeleteError(null);
    setDeleteEntry(entry);
  };

  // Une fenêtre ne se ferme pas pendant l'enregistrement.
  const closeModal = () => {
    if (!actionLoading) setIsModalOpen(false);
  };
  const closeDeleteModal = () => {
    if (!actionLoading) setDeleteEntry(null);
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
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/program-entries/${deleteEntry.id}`, { method: "DELETE" });
      if (!res.ok) {
        // D67 : dans la fenêtre restée ouverte, où elle est lue.
        setDeleteError(await messageOf(res, "Erreur lors de la suppression"));
        return;
      }
      setDeleteEntry(null);
      await reload();
    } catch {
      setDeleteError("Une erreur réseau est survenue. Veuillez réessayer.");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg leading-snug font-semibold text-ink">Admissions</h2>
          <Button variant="primary" size="sm" onClick={openAddModal} disabled={programs.length === 0}>
            Ajouter une entrée
          </Button>
        </div>
        <p className="max-w-[70ch] text-sm leading-relaxed text-ink-2">
          En quelle année du programme on entre, avec quel niveau et par quelle voie. Le nom du concours va dans la note.
        </p>
      </div>

      <ProgramSelector
        programs={programs}
        selectedProgramId={selectedProgramId}
        onProgramChange={handleProgramChange}
        showAllOption={true}
        loading={loading || actionLoading}
      />

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des admissions...</p>
      ) : programs.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">
            Aucun programme enregistré. Créez des programmes dans l&apos;onglet Campus & Programmes avant d&apos;ajouter des admissions.
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-ink-2">Aucune entrée enregistrée pour les critères sélectionnés.</p>
          <Button variant="primary" size="sm" onClick={openAddModal}>
            Ajouter une première entrée
          </Button>
        </Card>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card aria-labelledby={`entry-${entry.id}-title`} className="flex h-full flex-col gap-3">
                {/* D73 : un titre long garde la largeur, les boutons passent dessous. */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <h3 id={`entry-${entry.id}-title`} className="min-w-0 font-medium break-words text-ink">
                    {describeEntry(entry)}
                  </h3>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => openEditModal(entry)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(entry)}>
                      Supprimer
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-2">
                  <span className="font-semibold text-ink">{entry.program.name}</span>
                  <Badge>{levelLabel(entry.required_level)}</Badge>
                  <span>{routeLabel(entry.route)}</span>
                  {sourceHref(entry.source_url) && (
                    <a
                      href={sourceHref(entry.source_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cx(TEXT_LINK, "inline-flex items-center gap-1")}
                    >
                      Source
                      <ExternalIcon />
                    </a>
                  )}
                </div>
                {entry.note && <p className="text-sm leading-relaxed text-ink-2">{entry.note}</p>}
                <LastEdit text={entry.last_edit} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Fenêtre d'ajout et de modification */}
      {isModalOpen && (
        <Dialog
          titleId="entry-dialog-title"
          onClose={closeModal}
          title={editingEntry ? "Modifier l'entrée" : "Ajouter une entrée"}
        >
          {modalError && <Alert tone="danger">{modalError}</Alert>}

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            <Field id="entry-program" label="Programme *">
              {(control) => (
                <Select
                  {...control}
                  value={formProgramId}
                  onChange={(e) => setFormProgramId(e.target.value)}
                  disabled={Boolean(editingEntry)}
                  required
                  data-autofocus={editingEntry ? undefined : true}
                >
                  <option value="" disabled>
                    Choisir un programme
                  </option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="entry-year" label="Année d'entrée *">
                {(control) => (
                  <Select
                    {...control}
                    value={formYear}
                    onChange={(e) => setFormYear(Number(e.target.value))}
                    // Le programme ne change pas une fois l'entrée créée : le focus va à l'année.
                    data-autofocus={editingEntry ? true : undefined}
                  >
                    {YEARS.map((year) => (
                      <option key={year} value={year}>
                        {entryYearLabel(year)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="entry-level" label="Niveau requis *">
                {(control) => (
                  <Select {...control} value={formLevel} onChange={(e) => setFormLevel(Number(e.target.value))}>
                    {LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {levelLabel(level)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <Field id="entry-route" label="Voie *">
              {(control) => (
                <Select {...control} value={formRoute} onChange={(e) => setFormRoute(e.target.value)}>
                  {ENTRY_ROUTES.map((route) => (
                    <option key={route} value={route}>
                      {ROUTE_LABELS[route]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field id="entry-note" label="Note">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  maxLength={NOTE_MAX_LENGTH}
                  placeholder="ex: Concours BCE, Passerelle 1, BTS ou BUT validé..."
                />
              )}
            </Field>

            <Field id="entry-source-url" label="URL de la source">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/programme/admissions"
                />
              )}
            </Field>

            <DialogFooter>
              <Button onClick={closeModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : editingEntry ? "Modifier" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* Confirmation de la suppression */}
      {deleteEntry && (
        <Dialog titleId="entry-delete-title" onClose={closeDeleteModal} title="Supprimer l'entrée">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer cette entrée de {deleteEntry.program.name}{" "}
            : <strong className="font-medium text-ink">{describeEntry(deleteEntry)}</strong> ?
          </p>
          <DialogFooter>
            <Button onClick={closeDeleteModal} disabled={actionLoading}>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={actionLoading}>
              {actionLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
