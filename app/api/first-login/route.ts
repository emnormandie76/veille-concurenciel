/**
 * POST /api/first-login — La première connexion (plan gestion-contenu, étape 2, G5)
 *
 * L'admin a ajouté l'adresse de travail d'un collègue à la liste blanche, sans
 * envoi d'e-mail. À sa première connexion, la personne saisit cette adresse,
 * choisit son mot de passe (lib/password.ts) et son nom affiché (D6) : son
 * compte devient actif, avec le rôle que l'admin lui a donné (`USER` par
 * défaut). La page `/admin/first-login` la connecte ensuite par NextAuth.
 *
 * - Une adresse hors liste ne crée rien : la route ne fait qu'une mise à jour,
 *   jamais de création.
 * - Seul un invité passe : l'écriture vise l'adresse **dans l'état invité**.
 *   Un compte actif ou désactivé reçoit le même refus qu'une adresse inconnue,
 *   et deux premières connexions concurrentes ne peuvent pas l'emporter toutes
 *   les deux.
 * - Ouverte sans session (proxy.ts), hors de /api/auth/* exprès ; le proxy la
 *   plafonne avec la connexion, tentatives confondues (5 / 15 min / IP).
 *
 * Risque résiduel accepté (G5) : sans preuve de possession de l'adresse,
 * quelqu'un qui connaît l'adresse d'un invité peut choisir le mot de passe
 * avant lui.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { validateDisplayName, validateWorkEmail } from "@/lib/accounts";
import { validatePassword } from "@/lib/password";
import { invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";

/** Un seul refus, que l'adresse soit inconnue, déjà active ou désactivée. */
const NO_INVITATION_MESSAGE =
  "Aucune invitation en attente pour cette adresse. Si vous avez déjà choisi votre mot de passe, connectez-vous ; sinon, adressez-vous à un administrateur.";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const email = validateWorkEmail(body.email);
  if (email.error !== null) return NextResponse.json({ error: email.error }, { status: 400 });

  const passwordError = validatePassword(body.password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const name = validateDisplayName(body.displayName);
  if (name.error !== null) return NextResponse.json({ error: name.error }, { status: 400 });

  try {
    // Haché avant toute lecture : la réponse prend le même temps, invitation ou non.
    const password_hash = await bcrypt.hash(body.password as string, 12);

    const { count } = await prisma.user.updateMany({
      where: { email: email.email, status: "INVITED" },
      data: {
        password_hash,
        display_name: name.name,
        status: "ACTIVE",
        first_login_at: new Date(),
      },
    });
    if (count === 0) {
      return NextResponse.json({ error: NO_INVITATION_MESSAGE }, { status: 403 });
    }

    console.log("[audit] première connexion : un invité a choisi son mot de passe");
    return NextResponse.json({ message: "Votre mot de passe est enregistré. Vous pouvez vous connecter." });
  } catch (err) {
    console.error("POST /api/first-login error:", err);
    return NextResponse.json({ error: "Erreur serveur lors de la première connexion." }, { status: 500 });
  }
}
