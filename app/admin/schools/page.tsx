"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AdminPage } from "@/components/layout/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogFooter } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { TBody, THead, Table, Td, Th, Tr } from "@/components/ui/Table";
import { TEXT_LINK } from "@/components/ui/text-link";
import { schoolStatusTone } from "./school-status";

/**
 * La liste des écoles du back-office : recherche, création, modification,
 * suppression (confirmée par la saisie du nom, D19), et l'accès à la gestion
 * du contenu et aux campus de chacune.
 *
 * Dans la charte depuis l'étape 9 (lot 2) : gabarit `AdminPage`, tableau,
 * dialogues natifs ; la recherche a un libellé visible (D65) ; le badge de
 * statut suit le statut (D66) ; l'erreur d'une fenêtre s'affiche dans la
 * fenêtre (D67).
 */

interface School {
  id: string;
  name: string;
  official_domain: string;
  status: string;
  _count?: {
    campuses: number;
  };
}

export default function SchoolsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  // États des modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Champs de formulaires
  const [schoolName, setSchoolName] = useState("");
  const [schoolDomain, setSchoolDomain] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  // D67 : l'erreur d'une fenêtre, affichée dans la fenêtre.
  const [dialogError, setDialogError] = useState<string | null>(null);

  useEffect(() => {
    fetchSchools();
  }, []);

  const fetchSchools = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/schools");
      if (!res.ok) {
        throw new Error("Impossible de charger les écoles");
      }
      const data = await res.json();
      setSchools(data);
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const handleAddSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch("/api/admin/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schoolName, official_domain: schoolDomain }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la création");
      }

      setSchoolName("");
      setSchoolDomain("");
      setIsAddModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleEditSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchool) return;
    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch(`/api/admin/schools/${selectedSchool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: schoolName, official_domain: schoolDomain }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la modification");
      }

      setSchoolName("");
      setSchoolDomain("");
      setSelectedSchool(null);
      setIsEditModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchool) return;

    if (deleteConfirmText.trim() !== selectedSchool.name) {
      setDialogError(`Veuillez saisir exactement "${selectedSchool.name}" pour confirmer.`);
      return;
    }

    setActionLoading(true);
    setDialogError(null);

    try {
      const res = await fetch(`/api/admin/schools/${selectedSchool.id}?confirmName=${encodeURIComponent(deleteConfirmText)}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Erreur lors de la suppression");
      }

      setDeleteConfirmText("");
      setSelectedSchool(null);
      setIsDeleteModalOpen(false);
      fetchSchools();
    } catch (err: any) {
      setDialogError(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const openAddModal = () => {
    setSchoolName("");
    setSchoolDomain("");
    setError(null);
    setDialogError(null);
    setIsAddModalOpen(true);
  };

  const openEditModal = (school: School) => {
    setSelectedSchool(school);
    setSchoolName(school.name);
    setSchoolDomain(school.official_domain);
    setDialogError(null);
    setIsEditModalOpen(true);
  };

  const openDeleteModal = (school: School) => {
    setSelectedSchool(school);
    setDeleteConfirmText("");
    setDialogError(null);
    setIsDeleteModalOpen(true);
  };

  // Une fenêtre ne se ferme pas pendant l'enregistrement.
  const closeAddModal = () => {
    if (!actionLoading) setIsAddModalOpen(false);
  };
  const closeEditModal = () => {
    if (actionLoading) return;
    setSelectedSchool(null);
    setIsEditModalOpen(false);
  };
  const closeDeleteModal = () => {
    if (actionLoading) return;
    setSelectedSchool(null);
    setIsDeleteModalOpen(false);
  };

  // Filtrage des écoles
  const filteredSchools = schools.filter((school) =>
    school.name.toLowerCase().includes(search.toLowerCase()) ||
    school.official_domain.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AdminPage
      title="Gestion des Écoles"
      description="Ajoutez, modifiez ou gérez les écoles de l'enseignement supérieur."
      actions={
        <Button variant="primary" onClick={openAddModal}>
          Ajouter une école
        </Button>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}

      {/* D65 : un libellé visible ; le texte indicatif reste. */}
      <Field id="schools-search" label="Rechercher une école" className="max-w-md">
        {(control) => (
          <Input
            {...control}
            type="text"
            placeholder="Rechercher par nom ou domaine officiel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        )}
      </Field>

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-2">Chargement des données...</p>
      ) : filteredSchools.length === 0 ? (
        <Card className="py-10 text-center">
          <p className="text-sm text-ink-2">Aucune école trouvée.</p>
        </Card>
      ) : (
        <Table caption="Les écoles">
          <THead>
            <Tr>
              <Th>Nom</Th>
              <Th>Domaine Officiel</Th>
              <Th>Campus</Th>
              <Th>Statut</Th>
              <Th align="right">Actions</Th>
            </Tr>
          </THead>
          <TBody>
            {filteredSchools.map((school) => (
              <Tr key={school.id}>
                <Td className="font-medium text-ink">{school.name}</Td>
                <Td>
                  <code className="font-mono text-ink-2">{school.official_domain}</code>
                </Td>
                <Td>
                  <Link href={`/admin/schools/${school.id}/campuses`} className={TEXT_LINK}>
                    {school._count?.campuses || 0} campus
                  </Link>
                </Td>
                <Td>
                  <Badge tone={schoolStatusTone(school.status)}>{school.status}</Badge>
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Link
                      href={`/admin/schools/${school.id}/manage`}
                      className={buttonClasses({ variant: "primary", size: "sm" })}
                    >
                      Gérer le contenu
                    </Link>
                    <Button size="sm" onClick={() => openEditModal(school)}>
                      Modifier
                    </Button>
                    <Button size="sm" variant="danger-soft" onClick={() => openDeleteModal(school)}>
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
        <Dialog titleId="schools-add-title" onClose={closeAddModal} title="Ajouter une école">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={handleAddSchool} className="flex flex-col gap-4">
            <Field id="add-name" label="Nom de l'école">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  placeholder="ex: EMLV"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  data-autofocus
                />
              )}
            </Field>
            <Field id="add-domain" label="Domaine internet officiel">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  className="font-mono"
                  placeholder="ex: emlv.fr"
                  value={schoolDomain}
                  onChange={(e) => setSchoolDomain(e.target.value)}
                  required
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
        <Dialog titleId="schools-edit-title" onClose={closeEditModal} title="Modifier l'école">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={handleEditSchool} className="flex flex-col gap-4">
            <Field id="edit-name" label="Nom de l'école">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  required
                  data-autofocus
                />
              )}
            </Field>
            <Field id="edit-domain" label="Domaine internet officiel">
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  className="font-mono"
                  value={schoolDomain}
                  onChange={(e) => setSchoolDomain(e.target.value)}
                  required
                />
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

      {/* Suppression : le nom de l'école à saisir (D19) */}
      {isDeleteModalOpen && selectedSchool && (
        <Dialog titleId="schools-delete-title" onClose={closeDeleteModal} title="Double Confirmation Requise">
          {dialogError && <Alert tone="danger">{dialogError}</Alert>}
          <form onSubmit={handleDeleteSchool} className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-ink-2">
              Vous êtes sur le point de supprimer définitivement l&apos;école{" "}
              <strong className="font-medium text-ink">{selectedSchool.name}</strong> ainsi que tous ses campus et
              programmes associés. Cette action est irréversible.
            </p>
            <Field
              id="delete-confirm"
              label={
                <>
                  Saisissez le nom de l&apos;école (<strong className="font-semibold">{selectedSchool.name}</strong>) pour
                  confirmer :
                </>
              }
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  placeholder={selectedSchool.name}
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  required
                  data-autofocus
                />
              )}
            </Field>
            <DialogFooter>
              <Button onClick={closeDeleteModal} disabled={actionLoading}>
                Annuler
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={actionLoading || deleteConfirmText !== selectedSchool.name}
              >
                {actionLoading ? "Suppression..." : "Supprimer définitivement"}
              </Button>
            </DialogFooter>
          </form>
        </Dialog>
      )}
    </AdminPage>
  );
}
