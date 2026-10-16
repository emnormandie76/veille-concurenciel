/**
 * /api/admin/users — La liste blanche (plan gestion-contenu, étape 2)
 *
 * - GET : tous les comptes, invités compris (adresse, nom affiché, rôle, état,
 *   date de première connexion) ; jamais l'empreinte du mot de passe ;
 * - POST : ajoute une adresse de travail à la liste (G5). Le compte naît
 *   invité, `USER`, sans mot de passe : la personne le choisira à sa première
 *   connexion (app/api/first-login). **Aucun e-mail n'est envoyé** ; l'admin
 *   prévient le collègue lui-même. Seul le domaine imposé est accepté (D5).
 *
 * Garde : `guardAdmin` (test/helpers/access-policy.ts).
 */

import { NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateWorkEmail } from "@/lib/accounts";
import { ACCOUNT_SELECT, invalidBody, prismaCode } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";

const ALREADY_LISTED = "Cette adresse est déjà sur la liste.";

export async function GET() {
  const { error } = await guardAdmin();
  if (error) return error;

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: ACCOUNT_SELECT,
    });
    return NextResponse.json(users);
  } catch (err) {
    console.error("GET /api/admin/users error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération des comptes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { session, error } = await guardAdmin();
  if (error) return error;

  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const checked = validateWorkEmail(body.email);
  if (checked.error !== null) {
    return NextResponse.json({ error: checked.error }, { status: 400 });
  }
  const email = checked.email;

  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return NextResponse.json({ error: ALREADY_LISTED }, { status: 409 });

    // G5 : un invité USER. Rôle et état écrits ici : les défauts de la base
    // (USER, INVITED) ne décident pas à la place de la route.
    const account = await prisma.user.create({
      data: { email, role: "USER", status: "INVITED" },
      select: ACCOUNT_SELECT,
    });

    console.log(`[audit] adresse ajoutée à la liste : user=${account.id} par=${session.user.id}`);
    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    // Deux ajouts de la même adresse au même moment : l'index unique tranche.
    if (prismaCode(err) === "P2002") return NextResponse.json({ error: ALREADY_LISTED }, { status: 409 });
    console.error("POST /api/admin/users error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de l'ajout de l'adresse." }, { status: 500 });
  }
}
