"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import LastEdit from "../LastEdit";

/**
 * Les campus d'une école : création, modification, suppression, et qui a
 * modifié chacun (D29).
 *
 * Dans la charte depuis l'étape 9 (lot 2) : gabarit `AdminPage`, tableau,
 * dialogues natifs ; l'erreur d'une fenêtre s'affiche dans la fenêtre (D67).
 */

interface Campus {
  id: string;
  schoolId: string;
  name: string;
  city: string | null;
  // « Modifié par … le … » (étape 5, D29).
  last_edit: string | null;
}

interface School {
  id: string;
  name: string;
  official_domain: string;
}

export default function CampusesPage() {
  const { id: schoolId } = useParams() as { id: string };

  const [school, setSchool] = useState<School | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // D67 : l'erreur d'une fenêtre, affichée dans la fenêtre.
  const [dialogError, setDialogError] = useState<string | null>(null);

  // États des modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Champs de formulaires
  const [campusName, setCampusName] = useState("");
  const [campusCity, setCampusCity] = useState("");
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);

  useEffect(() => {
    if (schoolId) {
      fetchSchoolAndCampuses();
    }
  }, [schoolId]);

  const fetchSchoolAndCampuses = async () => {
    setLoading(true);
    setError(null);
    try {
      // Charger l'école
      const schoolRes = await fetch(`/api/admin/schools/${schoolId}`);
      if (!schoolRes.ok) {
        throw new Error("Impossible de charger les détails de l'école");
      }
      const schoolData = await schoolRes.json();
      setSchool(schoolData);

      // Charger les campus
      const campusesRes = await fetch(`/api/admin/schools/${schoolId}/campuses`);
      if (!campusesRes.ok) {
        throw new Error("Impossible de charger les campus");
      }
      const campusesData = await campusesRes.json();
      setCampuses(campusesData);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleAddCampus = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch(`/api/admin/schools/${schoolId}/campuses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campusName, city: campusCity }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la création du campus");
      }

      setCampusName("");
      setCampusCity("");
      setIsAddModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditCampus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampus) return;
    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: campusName, city: campusCity }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la modification du campus");
      }

      setCampusName("");
      setCampusCity("");
      setSelectedCampus(null);
      setIsEditModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteCampus = async () => {
    if (!selectedCampus) return;
    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la suppression du campus");
      }

      setSelectedCampus(null);
      setIsDeleteModalOpen(false);
      fetchSchoolAndCampuses();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openAddModal = () => {
    setCampusName("");
    setCampusCity("");
    setError(null);
    setDialogError(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setCampusName(campus.name);
    setCampusCity(campus.city || "");
    setDialogError(null);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setDialogError(null);
    setIsDeleteModalOpen(true);
  };

  // Une fenêtre ne se ferme pas pendant l'enregistrement.
  const closeAddModal = () => {
    if (!actionLoading) setIsAddModalOpen(false);
  };
  const closeEditModal = () => {
    if (actionLoading) return;
    setSelectedCampus(null);
    setIsEditModalOpen(false);
  };
  const closeDeleteModal = () => {
    if (actionLoading) return;
    setSelectedCampus(null);
    setIsDeleteModalOpen(false);
  };

  return (
    <AdminPage
      back={{ href: "/admin/schools", label: "← Retour aux écoles" }}
      title={`Campus de ${school ? school.name : "..."}`}
      description="Gérez les différents sites géographiques de l'école."
      actions={
        <Button variant="primary" onClick={openAddModal}>
          Ajouter un campus
        </Button>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des campus...</p>
      ) : campuses.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">Aucun campus enregistré pour cette école.</p>
        </Card>
      ) : (
        <Table caption={`Les campus de ${school ? school.name : "l'école"}`}>
          <THead>
            <Tr>
              <Th>Nom du Campus</Th>
              <Th>Ville</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {campuses.map((campus) => (
              <Tr key={campus.id}>
                <Td>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-ink">{campus.name}</span>
                    <LastEdit text={campus.last_edit} />
                  </div>
                </Td>
                <Td>
                  {campus.city ? (
                    <Badge>{campus.city}</Badge>
                  ) : (
                    <span className="text-ink-3 italic">Non spécifiée</span>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button size="sm" onClick={() => openEditModal(campus)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(campus)}>
                      Supprimer
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      )}

      {/* Ajout */}
      {isAddModalOpen && (
        <Dialog titleId="campuses-add-title" onClose={closeAddModal} title="Ajouter un campus">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={handleAddCampus} className="flex flex-col gap-4">
            <Field id="add-campus-name" label="Nom du campus">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  placeholder="ex: Paris La Défense"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  required
                  data-autofocus
                />
              )}
            </Field>
            <Field id="add-campus-city" label="Ville">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  placeholder="ex: Puteaux"
                  value={campusCity}
                  onChange={(e) => setCampusCity(e.target.value)}
                />
              )}
            </Field>
            <DialogFooter>
              <Button onClick={closeAddModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Création..." : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* Modification */}
      {isEditModalOpen && (
        <Dialog titleId="campuses-edit-title" onClose={closeEditModal} title="Modifier le campus">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={handleEditCampus} className="flex flex-col gap-4">
            <Field id="edit-campus-name" label="Nom du campus">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={campusName}
                  onChange={(e) => setCampusName(e.target.value)}
                  required
                  data-autofocus
                />
              )}
            </Field>
            <Field id="edit-campus-city" label="Ville">
              {(control) => (
                <Input {...control} type="text" value={campusCity} onChange={(e) => setCampusCity(e.target.value)} />
              )}
            </Field>
            <DialogFooter>
              <Button onClick={closeEditModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button type="submit" variant="primary" disabled={actionLoading}>
                {actionLoading ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}

      {/* Suppression */}
      {isDeleteModalOpen && selectedCampus && (
        <Dialog titleId="campuses-delete-title" onClose={closeDeleteModal} title="Confirmer la suppression">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <p className="text-sm leading-relaxed text-ink-2">
            Êtes-vous sûr de vouloir supprimer définitivement le campus{" "}
            <strong className="font-medium text-ink">{selectedCampus.name}</strong> ? Tous les programmes liés à ce
            campus seront également supprimés en cascade.
          </p>
          <DialogFooter>
            <Button onClick={closeDeleteModal} disabled={actionLoading}>
              Annuler
            </Button>
            <Button variant="danger" onClick={handleDeleteCampus} disabled={actionLoading}>
              {actionLoading ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </AdminPage>
  );
}
