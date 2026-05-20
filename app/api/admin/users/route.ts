import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await getServerSession(authOptions);
  
  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Seul le rôle ADMIN a le droit de gérer les modérateurs
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès interdit : Rôle ADMIN requis" }, { status: 403 });
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });
    return NextResponse.json(users);
  } catch (error) {
    console.error("GET /api/admin/users error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération des utilisateurs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Accès interdit : Rôle ADMIN requis" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: "Nom d'utilisateur et mot de passe requis" }, { status: 400 });
    }

    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

    if (cleanUsername.length < 3) {
      return NextResponse.json({ error: "Le nom d'utilisateur doit faire au moins 3 caractères" }, { status: 400 });
    }

    if (cleanPassword.length < 6) {
      return NextResponse.json({ error: "Le mot de passe doit faire au moins 6 caractères" }, { status: 400 });
    }

    // Vérifier l'existence
    const existing = await prisma.user.findUnique({
      where: { username: cleanUsername },
    });

    if (existing) {
      return NextResponse.json({ error: "Ce nom d'utilisateur est déjà utilisé" }, { status: 400 });
    }

    // Hasher avec bcryptjs (12 rounds)
    const password_hash = await bcrypt.hash(cleanPassword, 12);

    const newUser = await prisma.user.create({
      data: {
        username: cleanUsername,
        password_hash,
        role: "MODERATOR",
      },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
      },
    });

    return NextResponse.json(newUser, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/users error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la création de l'utilisateur" }, { status: 500 });
  }
}
