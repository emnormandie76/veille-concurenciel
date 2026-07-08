/**
 * app/schools/[id]/page.tsx — Fiche école publique (Étape 8.1)
 *
 * - Infos école, campus, programmes, stats, accréditations
 * - Navigation par onglets (Campus/Programmes, Stats, Accréditations)
 * - ISR 1h (revalidate)
 * - Filtre école ACTIVE obligatoire
 * - Référence : task.md §8.1, architecture.md §7.1
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import SchoolDetailClient from "./SchoolDetailClient";

export const revalidate = 3600; // ISR 1h — Étape 8.3

interface Props {
  params: Promise<{ id: string }>;
}

async function getSchool(id: string) {
  // En SSR/ISR, on appelle directement Prisma (pas de fetch HTTP local)
  // On importe dynamiquement pour rester compatible avec le runtime Node.js
  const { prisma } = await import("@/lib/prisma");

  const school = await prisma.school.findUnique({
    where: { id },
    include: {
      campuses: {
        orderBy: { name: "asc" },
      },
      programs: {
        include: {
          campuses: {
            include: {
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
            orderBy: { academic_year: "desc" },
            take: 3,
          },
        },
        orderBy: { name: "asc" },
      },
      statsRecords: {
        orderBy: { academic_year: "desc" },
        take: 3,
      },
      accreditations: {
        orderBy: { year_obtained: "desc" },
      },
    },
  });

  return school;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const school = await getSchool(id);
  if (!school) return { title: "École introuvable" };
  return {
    title: `${school.name} — EduData France`,
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
