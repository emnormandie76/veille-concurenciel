import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardAuth } from "@/lib/auth";

/**
 * GET /api/admin/schools-with-programs
 * 
 * Retourne la liste des écoles ACTIVE avec leurs campus et programmes imbriqués.
 * Utilisé par le sélecteur en cascade du formulaire de recherche manuelle (admin/cron).
 */
export async function GET() {
  const { error } = await guardAuth();
  if (error) return error;

  try {
    const schools = await prisma.school.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        official_domain: true,
        campuses: {
          orderBy: { name: "asc" },
          select: {
            id: true,
            name: true,
            programs: {
              orderBy: { name: "asc" },
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return NextResponse.json(schools);
  } catch (err: any) {
    console.error("Erreur schools-with-programs:", err);
    return NextResponse.json(
      { error: "Erreur de base de données" },
      { status: 500 }
    );
  }
}
