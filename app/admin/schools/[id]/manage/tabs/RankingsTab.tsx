"use client";

import { useEffect, useState } from "react";
import { ExternalIcon } from "@/app/schools/icons";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cx } from "@/components/ui/cx";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import { TEXT_LINK } from "@/components/ui/text-link";
import { sourceHref } from "@/lib/provenance";
import YearSelector from "../components/YearSelector";
import ProgramSelector from "../components/ProgramSelector";
import { rankLabel, rankTone } from "../ranking-badge";
import LastEdit from "../../LastEdit";

/**
 * L'onglet « Classements » de la gestion d'une école. Dans la charte depuis
 * l'étape 9 (lot 3) : un tableau, les fenêtres en dialogues natifs ; le rang
 * en badge d'un ton par palier, sans médaille (D68, ../ranking-badge.ts) ; le
 * lien « Source » en http(s) seulement (D72, D27) ; l'erreur d'une fenêtre
 * s'affiche dans la fenêtre (D67).
 */

interface ProgramOption {
  id: string;
  name: string;
}

interface RankingRecord {
  id: string;
  programId: string;
  ranking_name: string;
  rank: number;
  academic_year: number;
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  program: {
    id: string;
    name: string;
  };
}

export default function RankingsTab({ schoolId }: { schoolId: string }) {
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);
  const [rankingRecords, setRankingRecords] = useState<RankingRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RankingRecord | null>(null);
  const [formProgramId, setFormProgramId] = useState("");
  const [formRankingName, setFormRankingName] = useState("");
  const [formRank, setFormRank] = useState<number>(1);
  const [formYear, setFormYear] = useState<number>(new Date().getFullYear());
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<RankingRecord | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgramsAndRankings();
  }, [schoolId]);

  const fetchProgramsAndRankings = async (year?: number, programId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const resProg = await fetch(`/api/admin/schools/${schoolId}/programs`);
      if (!resProg.ok) throw new Error("Erreur de chargement des programmes");
      const progsJson = await resProg.json();
      setPrograms(progsJson);

      const queryParams = [];
      if (year) queryParams.push(`year=${year}`);
      if (programId) queryParams.push(`programId=${programId}`);
      const queryString = queryParams.length > 0 ? `?${queryParams.join("&")}` : "";

      const resRank = await fetch(`/api/admin/schools/${schoolId}/rankings${queryString}`);
      if (!resRank.ok) throw new Error("Erreur de chargement des classements");
      const rankJson = await resRank.json();

      setAvailableYears(rankJson.availableYears || []);
      if (!year && rankJson.availableYears && rankJson.availableYears.length > 0) {
        setSelectedYear(rankJson.availableYears[0]);
      }
      setRankingRecords(rankJson.records || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    fetchProgramsAndRankings(year, selectedProgramId);
  };

  const handleProgramChange = (progId: string | null) => {
    setSelectedProgramId(progId);
    fetchProgramsAndRankings(selectedYear || undefined, progId);
  };

  const openAddModal = () => {
    setEditingRecord(null);
    setFormProgramId(selectedProgramId || (programs.length > 0 ? programs[0].id : ""));
    setFormRankingName("");
    setFormRank(1);
    setFormYear(selectedYear || new Date().getFullYear());
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rec: RankingRecord) => {
    setEditingRecord(rec);
    setFormProgramId(rec.programId);
    setFormRankingName(rec.ranking_name);
    setFormRank(rec.rank);
    setFormYear(rec.academic_year);
    setFormSourceUrl(rec.source_url || "");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openDeleteModal = (rec: RankingRecord) => {
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
    if (!formProgramId) {
      setModalError("Veuillez sélectionner un programme.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      ranking_name: formRankingName.trim(),
      rank: formRank,
      academic_year: formYear,
      source_url: formSourceUrl.trim() || null,
    };

    try {
      const url = editingRecord
        ? `/api/admin/rankings/${editingRecord.id}`
        : `/api/admin/programs/${formProgramId}/rankings`;
      const method = editingRecord ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Une erreur est survenue");

      setIsModalOpen(false);
      fetchProgramsAndRankings(selectedYear || undefined, selectedProgramId);
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
      const res = await fetch(`/api/admin/rankings/${deleteRecord.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Erreur de suppression");

      setDeleteRecord(null);
      fetchProgramsAndRankings(selectedYear || undefined, selectedProgramId);
    } catch (err: any) {
      // D67 : dans la fenêtre restée ouverte, où elle est lue.
      setDeleteError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <YearSelector
            availableYears={availableYears}
            selectedYear={selectedYear}
            onYearChange={handleYearChange}
            loading={loading || actionLoading}
          />
          <ProgramSelector
            programs={programs}
            selectedProgramId={selectedProgramId}
            onProgramChange={handleProgramChange}
            showAllOption={true}
            loading={loading || actionLoading}
          />
        </div>

        <Button variant="primary" size="sm" onClick={openAddModal} disabled={programs.length === 0}>
          Ajouter un classement
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des classements...</p>
      ) : programs.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">
            Aucun programme enregistré. Créez des programmes dans l&apos;onglet Campus & Programmes avant d&apos;ajouter des classements.
          </p>
        </Card>
      ) : rankingRecords.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-ink-2">Aucun classement enregistré pour les critères sélectionnés.</p>
          <Button variant="primary" size="sm" onClick={openAddModal}>
            Ajouter un premier classement
          </Button>
        </Card>
      ) : (
        <Table caption="Classements">
          <THead>
            <Tr>
              <Th>Programme</Th>
              <Th>Nom du classement</Th>
              <Th>Rang</Th>
              <Th>Année</Th>
              <Th>Source</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {rankingRecords.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{r.program?.name || "—"}</span>
                    <LastEdit text={r.last_edit} />
                  </div>
                </Td>
                <Td>{r.ranking_name}</Td>
                <Td>
                  <Badge tone={rankTone(r.rank)}>{rankLabel(r.rank)}</Badge>
                </Td>
                <Td className="font-mono tabular-nums">{r.academic_year}</Td>
                <Td>
                  {sourceHref(r.source_url) ? (
                    <a
                      href={sourceHref(r.source_url)!}
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
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => openEditModal(r)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(r)}>
                      Supprimer
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {/* Modal Formulaire */}
      {isModalOpen && (
        <Dialog
          titleId="ranking-dialog-title"
          onClose={closeModal}
          title={editingRecord ? "Modifier le classement" : "Ajouter un classement"}
        >
          {modalError && <Alert tone="danger">{modalError}</Alert>}

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            <Field id="ranking-program" label="Programme *">
              {(control) => (
                <Select
                  {...control}
                  value={formProgramId}
                  onChange={(e) => setFormProgramId(e.target.value)}
                  disabled={Boolean(editingRecord)}
                  required
                  data-autofocus={editingRecord ? undefined : true}
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

            <Field id="ranking-name" label="Nom du classement (Média / Organisme) *">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formRankingName}
                  onChange={(e) => setFormRankingName(e.target.value)}
                  placeholder="ex: Le Figaro, SIGEM, L'Étudiant, FT..."
                  required
                  data-autofocus={editingRecord ? true : undefined}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ranking-rank" label="Rang / Position *">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    className="font-mono tabular-nums"
                    value={formRank}
                    onChange={(e) => setFormRank(Number(e.target.value))}
                    min={1}
                    required
                  />
                )}
              </Field>
              <Field id="ranking-year" label="Année académique *">
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

            <Field id="ranking-source-url" label="URL de la source">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://etudiant.lefigaro.fr/..."
                />
              )}
            </Field>

            <DialogFooter>
              <Button onClick={closeModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : editingRecord ? "Modifier" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* Confirmation Suppression */}
      {deleteRecord && (
        <Dialog titleId="ranking-delete-title" onClose={closeDeleteModal} title="Supprimer le classement">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer le classement{" "}
            <strong className="font-medium text-ink">
              {deleteRecord.ranking_name + " (#" + deleteRecord.rank + ")"}
            </strong>{" "}
            pour le programme {deleteRecord.program?.name} ({deleteRecord.academic_year}) ?
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
