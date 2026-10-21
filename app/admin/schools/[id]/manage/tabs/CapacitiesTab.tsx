"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalIcon } from "@/app/schools/icons";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { TEXT_LINK } from "@/components/ui/text-link";
import { sourceHref } from "@/lib/provenance";
import YearSelector from "../components/YearSelector";
import LastEdit from "../../LastEdit";

/**
 * L'onglet « Capacités » de la gestion d'une école. Dans la charte depuis
 * l'étape 9 (lot 3) : un tableau, les fenêtres en dialogues natifs ; le lien
 * « Source » en http(s) seulement (D72, D27) ; l'erreur d'une fenêtre
 * s'affiche dans la fenêtre (D67).
 *
 * D71 : la modification rapide des places se fait au clavier comme à la
 * souris : un bouton « N places » ouvre un champ nommé « Places disponibles »,
 * « Enregistrer » et « Annuler » sont des boutons d'icône nommés, le focus
 * revient au bouton à la fermeture, et une erreur s'affiche sous le champ (les
 * deux `alert()` du navigateur, mêmes textes).
 */

interface ProgramWithCampuses {
  id: string;
  name: string;
  associatedCampuses: {
    programCampusId: string;
    campusId: string;
    campusName: string;
    campusCity: string | null;
  }[];
}

interface CapacityRecord {
  id: string;
  programCampusId: string;
  spots_available: number;
  academic_year: number;
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  programCampus: {
    id: string;
    program: { id: string; name: string };
    campus: { id: string; name: string; city: string | null };
  };
}

export default function CapacitiesTab({ schoolId }: { schoolId: string }) {
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [capacityRecords, setCapacityRecords] = useState<CapacityRecord[]>([]);
  const [programsWithCampuses, setProgramsWithCampuses] = useState<ProgramWithCampuses[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit inline state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSpots, setEditingSpots] = useState<string>("");
  const [inlineError, setInlineError] = useState<string | null>(null);
  // D71 : le bouton « N places » de chaque ligne, et celui qui reprend le focus.
  const spotsButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const [focusSpotsOf, setFocusSpotsOf] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formProgramCampusId, setFormProgramCampusId] = useState("");
  const [formSpots, setFormSpots] = useState<string>("100");
  const [formYear, setFormYear] = useState<number>(new Date().getFullYear());
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<CapacityRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, [schoolId]);

  const fetchInitialData = async (year?: number) => {
    setLoading(true);
    setError(null);
    try {
      const resProgs = await fetch(`/api/admin/schools/${schoolId}/programs`);
      if (!resProgs.ok) throw new Error("Erreur de chargement des programmes");
      const progsJson = await resProgs.json();
      setProgramsWithCampuses(progsJson);

      const yearQuery = year ? `?year=${year}` : "";
      const resCap = await fetch(`/api/admin/schools/${schoolId}/capacities${yearQuery}`);
      if (!resCap.ok) throw new Error("Erreur de chargement des capacités");
      const capJson = await resCap.json();

      setAvailableYears(capJson.availableYears || []);
      const activeYear = year || (capJson.availableYears && capJson.availableYears.length > 0 ? capJson.availableYears[0] : new Date().getFullYear());
      setSelectedYear(activeYear);
      setCapacityRecords(capJson.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchCapacitiesForYear = async (year: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/capacities?year=${year}`);
      if (!res.ok) throw new Error("Erreur de chargement des capacités");
      const json = await res.json();
      setCapacityRecords(json.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchCapacitiesForYear(year);
  };

  // D71 : le focus revient au bouton « N places » quand la ligne est de nouveau
  // affichée (après Annuler, Échap, ou le rechargement qui suit l'enregistrement).
  useEffect(() => {
    if (!focusSpotsOf || editingId) return;
    const button = spotsButtons.current[focusSpotsOf];
    if (!button) return;
    button.focus();
    setFocusSpotsOf(null);
  }, [focusSpotsOf, editingId, loading, capacityRecords]);

  const startInlineEdit = (c: CapacityRecord) => {
    setInlineError(null);
    setEditingId(c.id);
    setEditingSpots(String(c.spots_available));
  };

  const cancelInlineEdit = (recordId: string) => {
    setInlineError(null);
    setEditingId(null);
    setFocusSpotsOf(recordId);
  };

  const handleInlineSave = async (recordId: string) => {
    const spotsNum = parseInt(editingSpots);
    if (isNaN(spotsNum) || spotsNum < 0) {
      setInlineError("Le nombre de places doit être un nombre ≥ 0");
      return;
    }

    try {
      const res = await fetch(`/api/admin/capacities/${recordId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spots_available: spotsNum }),
      });
      if (!res.ok) throw new Error("Erreur de mise à jour");

      setInlineError(null);
      setEditingId(null);
      setFocusSpotsOf(recordId);
      if (selectedYear) fetchCapacitiesForYear(selectedYear);
    } catch (err: any) {
      setInlineError(err.message);
    }
  };

  const openAddModal = () => {
    let defaultPCId = "";
    for (const p of programsWithCampuses) {
      if (p.associatedCampuses.length > 0) {
        defaultPCId = p.associatedCampuses[0].programCampusId;
        break;
      }
    }

    setFormProgramCampusId(defaultPCId);
    setFormSpots("100");
    setFormYear(selectedYear || new Date().getFullYear());
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openDeleteModal = (rec: CapacityRecord) => {
    setDeleteError(null);
    setDeleteRecord(rec);
  };

  // Une fenêtre ne se ferme pas pendant l'enregistrement.
  const closeModal = () => {
    if (!actionLoading) setIsModalOpen(false);
  };
  const closeDeleteModal = () => {
    if (!actionLoading) setDeleteRecord(null);
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formProgramCampusId) {
      setModalError("Veuillez sélectionner un programme et un campus.");
      return;
    }

    const spotsNum = parseInt(formSpots);
    if (isNaN(spotsNum) || spotsNum < 0) {
      setModalError("Le nombre de places doit être un entier ≥ 0.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      spots_available: spotsNum,
      academic_year: formYear,
      source_url: formSourceUrl.trim() || null,
    };

    try {
      const res = await fetch(`/api/admin/program-campuses/${formProgramCampusId}/capacity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur de création");

      setIsModalOpen(false);
      fetchCapacitiesForYear(formYear);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteRecord) return;
    setActionLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/capacities/${deleteRecord.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur de suppression");

      setDeleteRecord(null);
      if (selectedYear) fetchCapacitiesForYear(selectedYear);
    } catch (err: any) {
      // D67 : dans la fenêtre restée ouverte, où elle est lue.
      setDeleteError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const hasAnyProgramCampus = programsWithCampuses.some((p) => p.associatedCampuses.length > 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <YearSelector
          availableYears={availableYears}
          selectedYear={selectedYear}
          onYearChange={handleYearChange}
          loading={loading || actionLoading}
        />

        <Button variant="primary" size="sm" onClick={openAddModal} disabled={!hasAnyProgramCampus}>
          Ajouter une capacité
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des capacités d&apos;accueil...</p>
      ) : !hasAnyProgramCampus ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">
            Aucun programme associé à un campus. Associez d&apos;abord des programmes à des campus dans l&apos;onglet Campus & Programmes.
          </p>
        </Card>
      ) : capacityRecords.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-ink-2">Aucune capacité d&apos;accueil enregistrée pour l&apos;année {selectedYear}.</p>
          <Button variant="primary" size="sm" onClick={openAddModal}>
            Ajouter une première capacité
          </Button>
        </Card>
      ) : (
        <Table caption="Capacités">
          <THead>
            <Tr>
              <Th>Programme</Th>
              <Th>Campus</Th>
              <Th>Places disponibles</Th>
              <Th>Source</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {capacityRecords.map((c) => (
              <Tr key={c.id}>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{c.programCampus?.program?.name || "—"}</span>
                    <LastEdit text={c.last_edit} />
                  </div>
                </Td>
                <Td>
                  {c.programCampus?.campus?.name}{" "}
                  {c.programCampus?.campus?.city && (
                    <span className="text-xs text-ink-2">({c.programCampus.campus.city})</span>
                  )}
                </Td>
                <Td>
                  {editingId === c.id ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <div className="w-24">
                          <Input
                            type="number"
                            aria-label="Places disponibles"
                            aria-invalid={inlineError ? true : undefined}
                            aria-describedby={inlineError ? `capacity-${c.id}-error` : undefined}
                            className="font-mono tabular-nums"
                            value={editingSpots}
                            onChange={(e) => setEditingSpots(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleInlineSave(c.id);
                              if (e.key === "Escape") cancelInlineEdit(c.id);
                            }}
                            autoFocus
                          />
                        </div>
                        <Button variant="primary" size="icon" aria-label="Enregistrer" onClick={() => handleInlineSave(c.id)}>
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                            <path d="M4.5 10.5l3.5 3.5 7.5-8" />
                          </svg>
                        </Button>
                        <Button size="icon" aria-label="Annuler" onClick={() => cancelInlineEdit(c.id)}>
                          <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                            <path d="M5 5l10 10M15 5L5 15" />
                          </svg>
                        </Button>
                      </div>
                      {inlineError && (
                        <p id={`capacity-${c.id}-error`} role="alert" className="text-xs font-medium text-danger">
                          {inlineError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      ref={(element) => {
                        spotsButtons.current[c.id] = element;
                      }}
                      onClick={() => startInlineEdit(c)}
                      title="Cliquer pour modifier rapidement"
                      className={cx(TEXT_LINK, "rounded-control font-mono tabular-nums decoration-dashed")}
                    >
                      {c.spots_available} places
                    </button>
                  )}
                </Td>
                <Td>
                  {sourceHref(c.source_url) ? (
                    <a
                      href={sourceHref(c.source_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cx(TEXT_LINK, "inline-flex items-center gap-1")}
                    >
                      Source
                      <ExternalIcon />
                    </a>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
                <Td align="right">
                  <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(c)}>
                    Supprimer
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {/* Modal Ajout */}
      {isModalOpen && (
        <Dialog titleId="capacity-dialog-title" onClose={closeModal} title="Ajouter une capacité d'accueil">
          {modalError && <Alert tone="danger">{modalError}</Alert>}

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            <Field id="capacity-program-campus" label="Programme & Campus *">
              {(control) => (
                <Select
                  {...control}
                  value={formProgramCampusId}
                  onChange={(e) => setFormProgramCampusId(e.target.value)}
                  required
                  data-autofocus
                >
                  <option value="" disabled>
                    Sélectionner la combinaison Programme — Campus
                  </option>
                  {programsWithCampuses.map((prog) => (
                    <optgroup key={prog.id} label={prog.name}>
                      {prog.associatedCampuses.map((ac) => (
                        <option key={ac.programCampusId} value={ac.programCampusId}>
                          {prog.name} — {ac.campusName} {ac.campusCity ? `(${ac.campusCity})` : ""}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="capacity-spots" label="Nombre de places *">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    className="font-mono tabular-nums"
                    value={formSpots}
                    onChange={(e) => setFormSpots(e.target.value)}
                    min={0}
                    required
                  />
                )}
              </Field>
              <Field id="capacity-year" label="Année académique *">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    className="font-mono tabular-nums"
                    value={formYear}
                    onChange={(e) => setFormYear(Number(e.target.value))}
                    min={2000}
                    max={new Date().getFullYear() + 2}
                    required
                  />
                )}
              </Field>
            </div>

            <Field id="capacity-source-url" label="URL de la source">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://parcoursup.fr/..."
                />
              )}
            </Field>

            <DialogFooter>
              <Button onClick={closeModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* Confirmation Suppression */}
      {deleteRecord && (
        <Dialog titleId="capacity-delete-title" onClose={closeDeleteModal} title="Supprimer la capacité">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer la capacité de{" "}
            <strong className="font-medium text-ink">{deleteRecord.spots_available} places</strong>{" "}
            pour {deleteRecord.programCampus?.program?.name} ({deleteRecord.programCampus?.campus?.name}) — {deleteRecord.academic_year} ?
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
