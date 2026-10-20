/**
 * /api/admin/reports — Envoyer un signalement, lire les signalements
 *
 * Plan gestion-contenu, étape 6 (G8 : un formulaire de signalement, sans IA) :
 *
 * - POST, toute session (`guardSignedIn`, G4 : un USER « consulte et
 *   signale ») : le formulaire des fiches (`/schools/[id]/report`). L'auteur
 *   est le compte de la session, jamais une valeur du corps ; le nom de la
 *   cible est lu en base. Une école active seulement, et un campus ou un
 *   programme qui lui appartient (une clé étrangère ne prouve pas
 *   l'appartenance, bdd.md §6). Plafond : 10 envois par heure et par compte
 *   (D35), comptés une fois le corps lu, avant toute lecture en base. Aucune
 *   écriture dans `ContributionInbox` (D13, piège 6).
 * - GET, gestionnaires (`guardManager`) : la vue `/admin/reports` (D31) ; les
 *   signalements en attente, des plus anciens aux plus récents, puis les 100
 *   derniers fermés. L'auteur n'est lu que par son nom affiché (D39).
 *
 * Gardes : test/helpers/access-policy.ts (`POST reports` en SIGNED_IN).
 */

import { NextResponse } from "next/server";
import { guardManager, guardSignedIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { invalidBody } from "@/lib/account-admin";
import { readJsonObject } from "@/lib/request-body";
import {
  MANAGER_REPORT_SELECT,
  REPORT_RATE_LIMIT,
  REPORT_RATE_WINDOW_MS,
  forReportManager,
  readReport,
  reportRateKey,
  type TargetType,
} from "@/lib/content-reports";

/** Les signalements fermés que montre la vue ; les plus anciens restent en base. */
const CLOSED_SHOWN = 100;

export async function POST(request: Request) {
  const { session, error } = await guardSignedIn();
  if (error) return error;

  const body = await readJsonObject(request);
  if (!body) return invalidBody();

  const read = readReport(body);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: 400 });
  const input = read.value;

  if (!(await checkRateLimit(reportRateKey(session.user.id), REPORT_RATE_LIMIT, REPORT_RATE_WINDOW_MS))) {
    console.warn(`[signalement] plafond atteint pour le compte ${session.user.id}`);
    return NextResponse.json(
      { error: "Vous avez envoyé 10 signalements dans l'heure. Réessayez dans une heure ; rien n'a été envoyé." },
      { status: 429, headers: { "Retry-After": String(REPORT_RATE_WINDOW_MS / 1000) } }
    );
  }

  try {
    const school = await prisma.school.findUnique({
      where: { id: input.schoolId },
      select: { id: true, name: true, status: true },
    });
    // Comme sa fiche : une école inactive n'a pas de formulaire.
    if (!school || school.status !== "ACTIVE") {
      return NextResponse.json({ error: "École introuvable." }, { status: 404 });
    }

    let target: { type: TargetType; label: string } = { type: "SCHOOL", label: school.name };
    if (input.campusId) {
      const campus = await prisma.campus.findFirst({
        where: { id: input.campusId, schoolId: school.id },
        select: { name: true },
      });
      if (!campus) {
        return NextResponse.json({ error: "Ce campus n'appartient pas à cette école. Rien n'a été envoyé." }, { status: 400 });
      }
      target = { type: "CAMPUS", label: campus.name };
    } else if (input.programId) {
      const program = await prisma.program.findFirst({
        where: { id: input.programId, schoolId: school.id },
        select: { name: true },
      });
      if (!program) {
        return NextResponse.json({ error: "Ce programme n'appartient pas à cette école. Rien n'a été envoyé." }, { status: 400 });
      }
      target = { type: "PROGRAM", label: program.name };
    }

    const report = await prisma.contentReport.create({
      data: {
        author_id: session.user.id,
        schoolId: school.id,
        campusId: input.campusId,
        programId: input.programId,
        target_type: target.type,
        target_label: target.label,
        category: input.category,
        message: input.message,
        source_url: input.source_url,
      },
      select: { id: true },
    });

    return NextResponse.json(
      {
        id: report.id,
        // Espaces insécables dans les guillemets : « » » ne passe pas seul à la ligne.
        message: "Merci : votre signalement est transmis aux gestionnaires. Vous en suivrez la suite sur « Mon compte ».",
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/admin/reports error:", err);
    return NextResponse.json({ error: "Erreur serveur : le signalement n'a pas été envoyé." }, { status: 500 });
  }
}

export async function GET() {
  const { error } = await guardManager();
  if (error) return error;

  try {
    const [open, closed] = await Promise.all([
      prisma.contentReport.findMany({
        where: { status: "OPEN" },
        orderBy: { created_at: "asc" },
        select: MANAGER_REPORT_SELECT,
      }),
      prisma.contentReport.findMany({
        where: { status: { not: "OPEN" } },
        orderBy: { handled_at: "desc" },
        take: CLOSED_SHOWN,
        select: MANAGER_REPORT_SELECT,
      }),
    ]);

    return NextResponse.json({ open: open.map(forReportManager), closed: closed.map(forReportManager) });
  } catch (err) {
    console.error("GET /api/admin/reports error:", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
