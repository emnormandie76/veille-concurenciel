"use client";

import { useEffect, useState } from "react";
import { PinIcon } from "@/app/schools/icons";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/Table";
import LastEdit from "../../LastEdit";

/**
 * L'onglet « Campus & Programmes » de la gestion d'une école. Dans la charte
 * depuis l'étape 9 (lot 3) : une carte par campus, un tableau des programmes,
 * les fenêtres en dialogues natifs ; l'alternance et l'expatriation se cochent
 * (D69, comme D64), les campus d'un programme aussi ; l'erreur d'une fenêtre
 * s'affiche dans la fenêtre (D67).
 */

interface Campus {
  id: string;
  schoolId: string;
  name: string;
  city: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
}

interface AssociatedCampus {
  programCampusId: string;
  campusId: string;
  campusName: string;
  campusCity: string | null;
}

interface Program {
  id: string;
  schoolId: string;
  name: string;
  admission_exam: string | null;
  is_alternance_possible: boolean;
  is_expatriation_mandatory: boolean;
  min_expatriation_months: number | null;
  max_internship_months: number | null;
  // Le lien source de la fiche (étape 5, D12).
  source_url: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
  associatedCampuses: AssociatedCampus[];
}

const SECTION_TITLE = "font-display text-lg leading-snug font-semibold text-ink";

export default function CampusProgramsTab({ schoolId }: { schoolId: string }) {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states for Campus
  const [isCampusModalOpen, setIsCampusModalOpen] = useState(false);
  const [editingCampus, setEditingCampus] = useState<Campus | null>(null);
  const [campusName, setCampusName] = useState("");
  const [campusCity, setCampusCity] = useState("");
  const [deleteCampus, setDeleteCampus] = useState<Campus | null>(null);

  // Modal states for Program
  const [isProgramModalOpen, setIsProgramModalOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | null>(null);
  const [progName, setProgName] = useState("");
  const [progExam, setProgExam] = useState("");
  const [progAlternance, setProgAlternance] = useState(false);
  const [progExpatriation, setProgExpatriation] = useState(false);
  const [progMinExpat, setProgMinExpat] = useState("");
  const [progMaxInternship, setProgMaxInternship] = useState("");
  const [progSourceUrl, setProgSourceUrl] = useState("");
  const [progCampusIds, setProgCampusIds] = useState<string[]>([]);
  const [deleteProgram, setDeleteProgram] = useState<Program | null>(null);

  const [actionLoading, setActionLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
  }, [schoolId]);

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [resCampuses, resPrograms] = await Promise.all([
        fetch(`/api/admin/schools/${schoolId}/campuses`),
        fetch(`/api/admin/schools/${schoolId}/programs`),
      ]);

      if (!resCampuses.ok || !resPrograms.ok) {
        throw new Error("Erreur de chargement des campus et programmes");
      }

      const jsonCampuses = await resCampuses.json();
      const jsonPrograms = await resPrograms.json();

      setCampuses(jsonCampuses);
      setPrograms(jsonPrograms);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Une fenêtre ne se ferme pas pendant l'enregistrement.
  const closeCampusModal = () => {
    if (!actionLoading) setIsCampusModalOpen(false);
  };
  const closeProgramModal = () => {
    if (!actionLoading) setIsProgramModalOpen(false);
  };
  const closeDeleteCampus = () => {
    if (!actionLoading) setDeleteCampus(null);
  };
  const closeDeleteProgram = () => {
    if (!actionLoading) setDeleteProgram(null);
  };

  // --- CAMPUS HANDLERS ---
  const openAddCampusModal = () => {
    setEditingCampus(null);
    setCampusName("");
    setCampusCity("");
    setModalError(null);
    setIsCampusModalOpen(true);
  };

  const openEditCampusModal = (c: Campus) => {
    setEditingCampus(c);
    setCampusName(c.name);
    setCampusCity(c.city || "");
    setModalError(null);
    setIsCampusModalOpen(true);
  };

  const openDeleteCampus = (c: Campus) => {
    setDeleteError(null);
    setDeleteCampus(c);
  };

  const handleCampusSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setModalError(null);

    const body = { name: campusName.trim(), city: campusCity.trim() || null };

    try {
      const url = editingCampus
        ? `/api/admin/campuses/${editingCampus.id}`
        : `/api/admin/schools/${schoolId}/campuses`;
      const method = editingCampus ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur campus");

      setIsCampusModalOpen(false);
      fetchAll();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCampus = async () => {
    if (!deleteCampus) return;
    setActionLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/campuses/${deleteCampus.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Erreur de suppression");
      }
      setDeleteCampus(null);
      fetchAll();
    } catch (err: any) {
      // D67 : dans la fenêtre restée ouverte, où elle est lue.
      setDeleteError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // --- PROGRAM HANDLERS ---
  const openAddProgramModal = () => {
    setEditingProgram(null);
    setProgName("");
    setProgExam("");
    setProgAlternance(false);
    setProgExpatriation(false);
    setProgMinExpat("");
    setProgMaxInternship("");
    setProgSourceUrl("");
    setProgCampusIds(campuses.map((c) => c.id)); // Cocher tout par défaut
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const openEditProgramModal = (p: Program) => {
    setEditingProgram(p);
    setProgName(p.name);
    setProgExam(p.admission_exam || "");
    setProgAlternance(p.is_alternance_possible);
    setProgExpatriation(p.is_expatriation_mandatory);
    setProgMinExpat(p.min_expatriation_months !== null ? String(p.min_expatriation_months) : "");
    setProgMaxInternship(p.max_internship_months !== null ? String(p.max_internship_months) : "");
    setProgSourceUrl(p.source_url || "");
    setProgCampusIds(p.associatedCampuses.map((ac) => ac.campusId));
    setModalError(null);
    setIsProgramModalOpen(true);
  };

  const openDeleteProgram = (p: Program) => {
    setDeleteError(null);
    setDeleteProgram(p);
  };

  const handleProgramSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (progCampusIds.length === 0) {
      setModalError("Au moins un campus doit être sélectionné.");
      return;
    }

    setActionLoading(true);
    setModalError(null);

    const body = {
      name: progName.trim(),
      admission_exam: progExam.trim() || null,
      is_alternance_possible: progAlternance,
      is_expatriation_mandatory: progExpatriation,
      min_expatriation_months: progMinExpat ? parseInt(progMinExpat) : null,
      max_internship_months: progMaxInternship ? parseInt(progMaxInternship) : null,
      // Vide : pas de lien. Le serveur refuse ce qui n'est pas une adresse web (D27).
      source_url: progSourceUrl.trim(),
      campusIds: progCampusIds,
    };

    try {
      const url = editingProgram
        ? `/api/admin/programs/${editingProgram.id}`
        : `/api/admin/schools/${schoolId}/programs`;
      const method = editingProgram ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Erreur programme");

      setIsProgramModalOpen(false);
      fetchAll();
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleProgramCampus = async (program: Program, campusId: string) => {
    const currentCampusIds = program.associatedCampuses.map((ac) => ac.campusId);
    let nextCampusIds: string[];
    if (currentCampusIds.includes(campusId)) {
      if (currentCampusIds.length <= 1) {
        alert("Un programme doit être associé à au moins un campus.");
        return;
      }
      nextCampusIds = currentCampusIds.filter((id) => id !== campusId);
    } else {
      nextCampusIds = [...currentCampusIds, campusId];
    }

    try {
      const res = await fetch(`/api/admin/programs/${program.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campusIds: nextCampusIds }),
      });
      if (!res.ok) throw new Error("Erreur de mise à jour de l'association");
      fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteProgram = async () => {
    if (!deleteProgram) return;
    setActionLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/admin/programs/${deleteProgram.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Erreur de suppression");
      }
      setDeleteProgram(null);
      fetchAll();
    } catch (err: any) {
      // D67 : dans la fenêtre restée ouverte, où elle est lue.
      setDeleteError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* ZONE CAMPUS */}
      <section aria-labelledby="campus-section-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="campus-section-title" className={SECTION_TITLE}>
            Campus ({campuses.length})
          </h2>
          <Button variant="primary" size="sm" onClick={openAddCampusModal}>
            Ajouter un campus
          </Button>
        </div>

        {loading ? (
          <p className="py-5 text-center text-sm text-ink-2">Chargement des campus...</p>
        ) : campuses.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="text-sm text-ink-2">Aucun campus enregistré pour cette école.</p>
          </Card>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
            {campuses.map((c) => (
              <li key={c.id}>
                <Card aria-labelledby={`campus-${c.id}-title`} className="flex h-full flex-col gap-3">
                  {/* D73 : un titre long garde la largeur, les boutons passent dessous. */}
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <h3 id={`campus-${c.id}-title`} className="min-w-0 font-medium break-words text-ink">
                      {c.name}
                    </h3>
                    <div className="flex shrink-0 gap-1.5">
                      <Button size="sm" onClick={() => openEditCampusModal(c)}>
                        Modifier
                      </Button>
                      <Button size="sm" variant="danger-soft" onClick={() => openDeleteCampus(c)}>
                        Supprimer
                      </Button>
                    </div>
                  </div>
                  <p className="flex items-center gap-1.5 text-xs text-ink-2">
                    <PinIcon />
                    Ville : {c.city || "Non précisée"}
                  </p>
                  <LastEdit text={c.last_edit} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ZONE PROGRAMMES */}
      <section aria-labelledby="program-section-title" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="program-section-title" className={SECTION_TITLE}>
            Programmes ({programs.length})
          </h2>
          <Button
            variant="primary"
            size="sm"
            onClick={openAddProgramModal}
            disabled={campuses.length === 0}
            title={campuses.length === 0 ? "Veuillez d'abord créer au moins un campus" : ""}
          >
            Ajouter un programme
          </Button>
        </div>

        {loading ? (
          <p className="py-5 text-center text-sm text-ink-2">Chargement des programmes...</p>
        ) : programs.length === 0 ? (
          <Card className="py-8 text-center">
            <p className="text-sm text-ink-2">Aucun programme enregistré pour cette école.</p>
          </Card>
        ) : (
          <Table caption="Programmes">
            <THead>
              <Tr>
                <Th>Nom du programme</Th>
                <Th>Concours / Admission</Th>
                <Th>Alternance</Th>
                <Th>Expatriation</Th>
                <Th>Campus associés</Th>
                <Th align="right">Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {programs.map((prog) => (
                <Tr key={prog.id}>
                  <Td>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{prog.name}</span>
                      <LastEdit text={prog.last_edit} />
                    </div>
                  </Td>
                  <Td>{prog.admission_exam || <span className="text-ink-3">—</span>}</Td>
                  <Td>
                    <Badge tone={prog.is_alternance_possible ? "success" : "neutral"}>
                      {prog.is_alternance_possible ? "Oui" : "Non"}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={prog.is_expatriation_mandatory ? "success" : "neutral"}>
                        {prog.is_expatriation_mandatory ? "Oui" : "Non"}
                      </Badge>
                      {prog.min_expatriation_months && (
                        <span className="text-xs whitespace-nowrap text-ink-2">
                          ({prog.min_expatriation_months} mois min)
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {prog.associatedCampuses.length > 0 ? (
                        prog.associatedCampuses.map((ac) => (
                          <Badge key={ac.programCampusId} tone="accent">
                            <PinIcon />
                            {ac.campusName}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" onClick={() => openEditProgramModal(prog)}>
                        Modifier
                      </Button>
                      <Button size="sm" variant="danger-soft" onClick={() => openDeleteProgram(prog)}>
                        Supprimer
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      {/* MODAL CAMPUS */}
      {isCampusModalOpen && (
        <Dialog
          titleId="campus-dialog-title"
          onClose={closeCampusModal}
          title={editingCampus ? "Modifier le campus" : "Ajouter un campus"}
        >
          {modalError && <Alert tone="danger">{modalError}</Alert>}
          <form onSubmit={handleCampusSubmit} className="flex flex-col gap-4">
            <Field id="campus-name" label="Nom du campus *">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  placeholder="ex: Campus Paris La Défense"
                  required
                  data-autofocus
                />
              )}
            </Field>
            <Field id="campus-city" label="Ville">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={campusCity}
                  onChange={(e) => setCampusCity(e.target.value)}
                  placeholder="ex: Courbevoie"
                />
              )}
            </Field>
            <DialogFooter>
              <Button onClick={closeCampusModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : editingCampus ? "Modifier" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* MODAL PROGRAMME */}
      {isProgramModalOpen && (
        <Dialog
          titleId="program-dialog-title"
          onClose={closeProgramModal}
          title={editingProgram ? "Modifier le programme" : "Ajouter un programme"}
        >
          {modalError && <Alert tone="danger">{modalError}</Alert>}
          <form onSubmit={handleProgramSubmit} className="flex flex-col gap-4">
            <Field id="prog-name" label="Nom du programme *">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={progName}
                  onChange={(e) => setProgName(e.target.value)}
                  placeholder="ex: Programme Grande École, Bachelor..."
                  required
                  data-autofocus
                />
              )}
            </Field>

            <Field id="prog-exam" label="Concours / Examen d'entrée">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={progExam}
                  onChange={(e) => setProgExam(e.target.value)}
                  placeholder="ex: Concours Sésame, Accès..."
                />
              )}
            </Field>

            {/* D69 : deux cases natives, au clavier comme à la souris (D64). */}
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium text-ink">Possibilité d&apos;alternance</legend>
                <div className="flex items-center gap-2">
                  <input
                    id="prog-alternance"
                    type="checkbox"
                    className="size-4 cursor-pointer accent-accent"
                    checked={progAlternance}
                    onChange={(e) => setProgAlternance(e.target.checked)}
                  />
                  <label htmlFor="prog-alternance" className="cursor-pointer text-sm text-ink">
                    Alternance possible
                  </label>
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-sm font-medium text-ink">Expatriation obligatoire</legend>
                <div className="flex items-center gap-2">
                  <input
                    id="prog-expatriation"
                    type="checkbox"
                    className="size-4 cursor-pointer accent-accent"
                    checked={progExpatriation}
                    onChange={(e) => setProgExpatriation(e.target.checked)}
                  />
                  <label htmlFor="prog-expatriation" className="cursor-pointer text-sm text-ink">
                    Obligatoire
                  </label>
                </div>
              </fieldset>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="prog-min-expat" label="Durée min. expatriation (mois)">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    className="font-mono tabular-nums"
                    value={progMinExpat}
                    onChange={(e) => setProgMinExpat(e.target.value)}
                    placeholder="ex: 6"
                  />
                )}
              </Field>
              <Field id="prog-max-internship" label="Durée max. stage (mois)">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    className="font-mono tabular-nums"
                    value={progMaxInternship}
                    onChange={(e) => setProgMaxInternship(e.target.value)}
                    placeholder="ex: 12"
                  />
                )}
              </Field>
            </div>

            <Field id="prog-source-url" label="URL de la source du programme">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={progSourceUrl}
                  onChange={(e) => setProgSourceUrl(e.target.value)}
                  placeholder="https://ecole.fr/programme-grande-ecole"
                />
              )}
            </Field>

            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-sm font-medium text-ink">Campus dispensant ce programme *</legend>
              <div className="flex flex-wrap gap-2">
                {campuses.map((c) => {
                  const isChecked = progCampusIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-1 text-sm text-ink has-checked:border-accent has-checked:bg-accent-soft"
                    >
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-accent"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setProgCampusIds([...progCampusIds, c.id]);
                          } else {
                            setProgCampusIds(progCampusIds.filter((id) => id !== c.id));
                          }
                        }}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <DialogFooter>
              <Button onClick={closeProgramModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : editingProgram ? "Modifier" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* CONFIRMATION SUPPRESSION CAMPUS */}
      {deleteCampus && (
        <Dialog titleId="campus-delete-title" onClose={closeDeleteCampus} title="Supprimer le campus">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer le campus{" "}
            <strong className="font-medium text-ink">{deleteCampus.name}</strong> ?
          </p>
          <Alert tone="danger">
            Attention : Cela supprimera également toutes les associations aux programmes et les capacités rattachées à ce campus.
          </Alert>
          <DialogFooter>
            <Button onClick={closeDeleteCampus} disabled={actionLoading}>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDeleteCampus} disabled={actionLoading}>
              {actionLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}

      {/* CONFIRMATION SUPPRESSION PROGRAMME */}
      {deleteProgram && (
        <Dialog titleId="program-delete-title" onClose={closeDeleteProgram} title="Supprimer le programme">
          {deleteError && <Alert tone="danger">{deleteError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer le programme{" "}
            <strong className="font-medium text-ink">{deleteProgram.name}</strong> ?
          </p>
          <Alert tone="danger">
            Attention : Cela supprimera également tous les tarifs, classements et capacités rattachés à ce programme.
          </Alert>
          <DialogFooter>
            <Button onClick={closeDeleteProgram} disabled={actionLoading}>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDeleteProgram} disabled={actionLoading}>
              {actionLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}
