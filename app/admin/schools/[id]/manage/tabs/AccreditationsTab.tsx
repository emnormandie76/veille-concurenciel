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
import { TEXT_LINK } from "@/components/ui/text-link";
import { sourceHref } from "@/lib/provenance";
import LastEdit from "../../LastEdit";
import { accreditationTypeLabel, accreditationTypeTone } from "../accreditation-type";

/**
 * L'onglet « Accréditations » de la gestion d'une école. Dans la charte
 * depuis l'étape 9 (lot 2) : une carte par accréditation, les fenêtres en
 * dialogues natifs ; le statut se coche (D64) ; l'erreur d'une fenêtre
 * s'affiche dans la fenêtre (D67). Depuis l'étape 10, le type s'affiche en
 * français sur la carte (« État », et non `state`).
 */

interface Accreditation {
  id: string;
  schoolId: string;
  accreditation_name: string;
  accreditation_type: "international" | "state" | "label";
  // null = année inconnue (les accréditations issues du pipeline peuvent
  // arriver sans année publiée).
  year_obtained: number | null;
  is_active: boolean;
  // Le lien source de l'accréditation (étape 5, D12).
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
}

export default function AccreditationsTab({ schoolId }: { schoolId: string }) {
  const [accreditations, setAccreditations] = useState<Accreditation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Accreditation | null>(null);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState<"international" | "state" | "label">("international");
  const [formYear, setFormYear] = useState(new Date().getFullYear());
  const [formIsActive, setFormIsActive] = useState(true);
  const [formSourceUrl, setFormSourceUrl] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [deleteRecord, setDeleteRecord] = useState<Accreditation | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchAccreditations();
  }, [schoolId]);

  const fetchAccreditations = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/accreditations`);
      if (!res.ok) throw new Error("Erreur lors de la récupération des accréditations");
      const json = await res.json();
      setAccreditations(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingRecord(null);
    setFormName("");
    setFormType("international");
    setFormYear(new Date().getFullYear());
    setFormIsActive(true);
    setFormSourceUrl("");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rec: Accreditation) => {
    setEditingRecord(rec);
    setFormName(rec.accreditation_name);
    setFormType(rec.accreditation_type);
    setFormYear(rec.year_obtained ?? new Date().getFullYear());
    setFormIsActive(rec.is_active);
    setFormSourceUrl(rec.source_url || "");
    setModalError(null);
    setIsModalOpen(true);
  };

  const openDeleteModal = (rec: Accreditation) => {
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
    setActionLoading(true);
    setModalError(null);

    const body = {
      accreditation_name: formName.trim(),
      accreditation_type: formType,
      year_obtained: formYear,
      is_active: formIsActive,
      // Vide : pas de lien. Le serveur refuse ce qui n'est pas une adresse web (D27).
      source_url: formSourceUrl.trim(),
    };

    try {
      const url = editingRecord
        ? `/api/admin/accreditations/${editingRecord.id}`
        : `/api/admin/schools/${schoolId}/accreditations`;
      const method = editingRecord ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Une erreur est survenue");

      setIsModalOpen(false);
      fetchAccreditations();
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
      const res = await fetch(`/api/admin/accreditations/${deleteRecord.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur lors de la suppression");

      setDeleteRecord(null);
      fetchAccreditations();
    } catch (err: any) {
      // D67 : dans la fenêtre restée ouverte, où elle est lue.
      setDeleteError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg leading-snug font-semibold text-ink">Accréditations et Labels</h2>
        <Button variant="primary" size="sm" onClick={openAddModal}>
          Ajouter une accréditation
        </Button>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des accréditations...</p>
      ) : accreditations.length === 0 ? (
        <Card className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-ink-2">Aucune accréditation enregistrée pour cette école.</p>
          <Button variant="primary" size="sm" onClick={openAddModal}>
            Ajouter une première accréditation
          </Button>
        </Card>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {accreditations.map((acc) => (
            <li key={acc.id}>
              <Card aria-labelledby={`acc-${acc.id}-title`} className="flex h-full flex-col gap-3">
                {/* D73 : un titre long garde la largeur, les boutons passent dessous. */}
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                  <h3 id={`acc-${acc.id}-title`} className="min-w-0 font-medium break-words text-ink">
                    {acc.accreditation_name}
                  </h3>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" onClick={() => openEditModal(acc)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(acc)}>
                      Supprimer
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-ink-2">
                  <Badge tone={accreditationTypeTone(acc.accreditation_type)}>{accreditationTypeLabel(acc.accreditation_type)}</Badge>
                  <Badge tone={acc.is_active ? "success" : "neutral"}>{acc.is_active ? "Actif" : "Inactif"}</Badge>
                  <span>
                    {acc.year_obtained != null
                      ? `Obtenue en ${acc.year_obtained}`
                      : "Année d'obtention inconnue"}
                  </span>
                  {sourceHref(acc.source_url) && (
                    <a
                      href={sourceHref(acc.source_url)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cx(TEXT_LINK, "inline-flex items-center gap-1")}
                    >
                      Source
                      <ExternalIcon />
                    </a>
                  )}
                </div>
                <LastEdit text={acc.last_edit} />
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Ajout et modification */}
      {isModalOpen && (
        <Dialog
          titleId="acc-dialog-title"
          onClose={closeModal}
          title={editingRecord ? "Modifier l'accréditation" : "Ajouter une accréditation"}
        >
          {modalError && <Alert tone="danger">{modalError}</Alert>}

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
            <Field id="acc-name" label="Nom de l'accréditation *">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="ex: EQUIS, AACSB, CTI..."
                  required
                  data-autofocus
                />
              )}
            </Field>

            <Field id="acc-type" label="Type d'accréditation *">
              {(control) => (
                <Select {...control} value={formType} onChange={(e) => setFormType(e.target.value as any)}>
                  <option value="international">International (ex: EQUIS, AACSB, AMBA)</option>
                  <option value="state">État (ex: Visa, Grade de Master, CTI)</option>
                  <option value="label">Label (ex: Bienvenue en France, EESPIG)</option>
                </Select>
              )}
            </Field>

            <Field id="acc-year" label="Année d'obtention *">
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

            <Field id="acc-source-url" label="URL de la source">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={formSourceUrl}
                  onChange={(e) => setFormSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/accreditations"
                />
              )}
            </Field>

            {/* D64 : une case native, au clavier comme à la souris. */}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-ink">Statut de l&apos;accréditation</legend>
              <div className="flex items-center gap-2">
                <input
                  id="acc-active"
                  type="checkbox"
                  className="size-4 cursor-pointer accent-accent"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                />
                <label htmlFor="acc-active" className="cursor-pointer text-sm text-ink">
                  Accréditation encore active
                </label>
              </div>
            </fieldset>

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

      {/* Confirmation de la suppression */}
      {deleteRecord && (
        <Dialog titleId="acc-delete-title" onClose={closeDeleteModal} title="Confirmer la suppression">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer l&apos;accréditation{" "}
            <strong className="font-medium text-ink">{deleteRecord.accreditation_name}</strong> ?
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
