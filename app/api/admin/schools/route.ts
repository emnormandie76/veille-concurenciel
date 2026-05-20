import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const schools = await prisma.school.findMany({
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { campuses: true }
        }
      }
    });
    return NextResponse.json(schools);
  } catch (error) {
    console.error("GET /api/admin/schools error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, official_domain } = body;

    if (!name || !official_domain) {
      return NextResponse.json({ error: "Le nom et le domaine officiel sont requis" }, { status: 400 });
    }

    const cleanDomain = official_domain.trim().toLowerCase();
    const cleanName = name.trim();

    // Vérifier l'existence d'une école avec le même nom ou domaine
    const existing = await prisma.school.findFirst({
      where: {
        OR: [
          { name: cleanName },
          { official_domain: cleanDomain }
        ]
      }
    });

    if (existing) {
      return NextResponse.json(
        { error: "Une école avec ce nom ou ce domaine officiel existe déjà." },
        { status: 400 }
      );
    }

    const school = await prisma.school.create({
      data: {
        name: cleanName,
        official_domain: cleanDomain,
        status: "ACTIVE"
      }
    });

    return NextResponse.json(school, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/schools error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la création" }, { status: 500 });
  }
}
