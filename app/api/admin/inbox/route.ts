/**
 * app/api/admin/inbox/route.ts — GET /api/admin/inbox (Étape 3.1)
 *
 * Liste paginée des tickets ContributionInbox.
 * Filtres : status, ai_category, schoolId
 * Pagination : page, limit
 *
 * Règle 5 : Aucune donnée ContributionInbox n'est exposée publiquement.
 * Référence : task.md §3.1, architecture.md §3.4
 */

import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const ai_category = searchParams.get("ai_category") ?? undefined;
  const schoolId = searchParams.get("schoolId") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const skip = (page - 1) * limit;

  // Construire le filtre dynamiquement
  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (ai_category) where.ai_category = ai_category;
  if (schoolId) where.schoolId = schoolId;

  try {
    const [tickets, total] = await Promise.all([
      prisma.contributionInbox.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.contributionInbox.count({ where }),
    ]);

    // Extraire les identifiants uniques non nuls pour faire un batch select
    const schoolIds = Array.from(new Set(tickets.map((t) => t.schoolId).filter(Boolean))) as string[];
    const campusIds = Array.from(new Set(tickets.map((t) => t.campusId).filter(Boolean))) as string[];
    const programIds = Array.from(new Set(tickets.map((t) => t.programId).filter(Boolean))) as string[];

    // Charger les noms correspondants en parallèle
    const [schools, campuses, programs] = await Promise.all([
      schoolIds.length > 0
        ? prisma.school.findMany({
            where: { id: { in: schoolIds } },
            select: { id: true, name: true },
          })
        : [],
      campusIds.length > 0
        ? prisma.campus.findMany({
            where: { id: { in: campusIds } },
            select: { id: true, name: true },
          })
        : [],
      programIds.length > 0
        ? prisma.program.findMany({
            where: { id: { in: programIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);

    // Créer des maps indexées par ID pour récupération en O(1)
    const schoolMap = new Map(schools.map((s) => [s.id, s.name]));
    const campusMap = new Map(campuses.map((c) => [c.id, c.name]));
    const programMap = new Map(programs.map((p) => [p.id, p.name]));

    // Associer les noms correspondants aux tickets
    const enrichedTickets = tickets.map((t) => ({
      ...t,
      schoolName: t.schoolId ? (schoolMap.get(t.schoolId) ?? null) : null,
      campusName: t.campusId ? (campusMap.get(t.campusId) ?? null) : null,
      programName: t.programId ? (programMap.get(t.programId) ?? null) : null,
    }));

    return NextResponse.json({
      data: enrichedTickets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("GET /api/admin/inbox error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
