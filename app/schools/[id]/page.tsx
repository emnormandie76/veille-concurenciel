/**
 * app/schools/[id]/page.tsx — Fiche école publique
 *
 * - Infos école, campus, programmes, stats, accréditations
 * - Navigation par onglets (Campus/Programmes, Stats, Accréditations)
 * - Rendue à chaque visite : plus de cache d'une heure depuis la CSP à nonce
 *   (étape 15, D123 ; app/layout.tsx)
 * - Filtre école ACTIVE obligatoire
 * - Plan gestion-contenu, étape 5 : l'école, ses chiffres clés et ses
 *   accréditations portent leur lien source et « Modifié par … le … »,
 *   préparés ici (`forDisplay`) : le navigateur reçoit le texte et le lien
 *   vérifié, jamais l'identifiant ni la relation de l'auteur (D25). Campus et
 *   programmes sont lus champ par champ, pour la même raison.
 * - Étape 9 (lot 1) : la fiche passe à la charte dans SchoolDetailClient,
 *   qui pose le gabarit du site ; cette page ne lit toujours pas la session.
 * - Référence : architecture/gestion-contenu.md §3.1
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import SchoolDetailClient from "./SchoolDetailClient";
import { AUTHOR_SELECT, forDisplay } from "@/lib/provenance";

interface Props {
  params: Promise<{ id: string }>;
}

async function getSchool(id: string) {
  // Rendu serveur : on appelle directement Prisma (pas de fetch HTTP local)
  // On importe dynamiquement pour rester compatible avec le runtime Node.js
  const { prisma } = await import("@/lib/prisma");

  const school = await prisma.school.findUnique({
    where: { id },
    include: {
      updatedBy: AUTHOR_SELECT,
      campuses: {
        select: { id: true, name: true, city: true },
        orderBy: { name: "asc" },
      },
      programs: {
        select: {
          id: true,
          name: true,
          admission_exam: true,
          is_alternance_possible: true,
          is_expatriation_mandatory: true,
          campuses: {
            select: {
              id: true,
              campus: {
                select: {
                  id: true,
                  name: true,
                  city: true,
                },
              },
            },
          },
          pricingRecords: {
            select: { id: true, academic_year: true, year_1_fee: true, total_fee: true, currency: true },
            orderBy: { academic_year: "desc" },
            take: 3,
          },
        },
        orderBy: { name: "asc" },
      },
      statsRecords: {
        orderBy: { academic_year: "desc" },
        take: 3,
        include: { updatedBy: AUTHOR_SELECT },
      },
      accreditations: {
        orderBy: { year_obtained: "desc" },
        include: { updatedBy: AUTHOR_SELECT },
      },
    },
  });

  if (!school) return null;
  return {
    ...forDisplay(school),
    statsRecords: school.statsRecords.map(forDisplay),
    accreditations: school.accreditations.map(forDisplay),
  };
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const school = await getSchool(id);
  if (!school) return { title: "École introuvable" };
  return {
    // « — » et le nom de l'application viennent du modèle de titre d'app/layout.tsx.
    title: school.name,
    description: `Programmes, tarifs, classements et accréditations de ${school.name}`,
  };
}

export default async function SchoolDetailPage({ params }: Props) {
  const { id } = await params;
  const school = await getSchool(id);

  if (!school || school.status !== "ACTIVE") {
    notFound();
  }

  return <SchoolDetailClient school={school} />;
}
