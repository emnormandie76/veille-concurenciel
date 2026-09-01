/**
 * POST /api/contribute — Soumission publique (crowdsourcing)
 *
 * Surface ouverte, non authentifiée, et à coût réel : chaque ticket créé
 * déclenche une extraction Tavily facturée. Le corps de requête est donc
 * intégralement borné et typé avant la moindre écriture.
 *
 * La limitation de débit est appliquée en amont par `proxy.ts` (matcher
 * `/api/contribute`), sur l'IP fournie par la plateforme et via le magasin
 * partagé de `lib/rate-limit.ts`. Elle n'est volontairement pas dupliquée ici :
 * la compter deux fois diviserait le quota réel par deux.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidHttpsUrl, isPrivateHost, urlBelongsToDomain } from "@/lib/utils";

// ──────────────────────────────────────────────
// Bornes
// ──────────────────────────────────────────────

/** Doit rester aligné sur SUPPORTED_CROWDSOURCING_CATEGORIES (processor.py). */
const ALLOWED_CATEGORIES = [
  "Pricing",
  "Ranking",
  "Capacity",
  "SchoolStats",
  "Accreditation",
] as const;

const MAX_USER_TEXT = 2000;
const MAX_URLS = 5;
const MAX_URL_LENGTH = 2048;
const MAX_ID_LENGTH = 64;

/**
 * Domaines acceptés en plus de celui de l'école ciblée : classements,
 * organismes d'accréditation… Renseigner `CONTRIBUTION_ALLOWED_DOMAINS` avec
 * une liste séparée par des virgules (ex. « ft.com,cti-commission.fr »).
 * Vide par défaut : seul le domaine officiel de l'école est accepté.
 */
function extraAllowedDomains(): string[] {
  return (process.env.CONTRIBUTION_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Identifiant optionnel : absent, ou chaîne non vide de longueur raisonnable. */
function optionalId(value: unknown, field: string): string | null | { error: string } {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return { error: `${field} doit être une chaîne` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_ID_LENGTH) return { error: `${field} est trop long` };
  return trimmed;
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return bad("Corps de requête JSON invalide");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return bad("Corps de requête invalide");
    }

    const {
      schoolId: rawSchoolId,
      campusId: rawCampusId,
      programId: rawProgramId,
      programCampusId: rawProgramCampusId,
      categories: rawCategories,
      userText: rawUserText,
      urls: rawUrls,
    } = body as Record<string, unknown>;

    // ── schoolId ────────────────────────────────
    if (typeof rawSchoolId !== "string" || rawSchoolId.trim().length === 0) {
      return bad("schoolId est requis");
    }
    const schoolId = rawSchoolId.trim();
    if (schoolId.length > MAX_ID_LENGTH) return bad("schoolId est trop long");

    // ── categories ──────────────────────────────
    // Array.isArray était absent : une chaîne passait le contrôle de longueur
    // puis faisait échouer le .map en 500.
    if (!Array.isArray(rawCategories) || rawCategories.length === 0) {
      return bad("categories doit être un tableau non vide");
    }
    if (rawCategories.length > ALLOWED_CATEGORIES.length) {
      return bad("Trop de catégories soumises");
    }
    const categories = [...new Set(rawCategories)];
    for (const cat of categories) {
      if (typeof cat !== "string" || !ALLOWED_CATEGORIES.includes(cat as never)) {
        return bad(
          `Catégorie inconnue. Valeurs acceptées : ${ALLOWED_CATEGORIES.join(", ")}`
        );
      }
    }

    // ── urls ────────────────────────────────────
    if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
      return bad("urls doit être un tableau non vide");
    }
    if (rawUrls.length > MAX_URLS) {
      return bad(`Maximum ${MAX_URLS} URL(s) par soumission`);
    }
    const urls: string[] = [];
    for (const url of rawUrls) {
      if (typeof url !== "string" || url.length > MAX_URL_LENGTH) {
        return bad("URL invalide ou trop longue");
      }
      if (!isValidHttpsUrl(url)) {
        return bad("URL doit commencer par https://");
      }
      let hostname: string;
      try {
        hostname = new URL(url).hostname;
      } catch {
        return bad("URL invalide");
      }
      if (isPrivateHost(hostname)) {
        return bad("URL non autorisée : adresse interne");
      }
      urls.push(url);
    }

    // ── userText ────────────────────────────────
    if (rawUserText != null && typeof rawUserText !== "string") {
      return bad("userText doit être une chaîne");
    }
    const userText = (rawUserText as string | undefined)?.trim() ?? "";
    if (userText.length > MAX_USER_TEXT) {
      return bad(`Le commentaire ne peut pas dépasser ${MAX_USER_TEXT} caractères`);
    }

    // ── identifiants optionnels ─────────────────
    const campusId = optionalId(rawCampusId, "campusId");
    if (campusId && typeof campusId !== "string") return bad(campusId.error);
    const programId = optionalId(rawProgramId, "programId");
    if (programId && typeof programId !== "string") return bad(programId.error);
    const programCampusId = optionalId(rawProgramCampusId, "programCampusId");
    if (programCampusId && typeof programCampusId !== "string") {
      return bad(programCampusId.error);
    }

    // ── L'école existe ──────────────────────────
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, status: true, official_domain: true },
    });
    if (!school || school.status !== "ACTIVE") {
      return bad("École invalide");
    }

    // ── Les URLs pointent vers un domaine autorisé ──
    // Sans ce contrôle, le pipeline dépensait des crédits Tavily sur des cibles
    // arbitraires choisies par l'utilisateur.
    const allowedDomains = [school.official_domain, ...extraAllowedDomains()];
    for (const url of urls) {
      if (!allowedDomains.some((domain) => urlBelongsToDomain(url, domain))) {
        return bad(
          `URL refusée : elle doit pointer vers le domaine officiel de l'école (${school.official_domain})`
        );
      }
    }

    // ── Les identifiants appartiennent bien à cette école ──
    // ContributionInbox n'a aucune clé étrangère : rien ne rattrape une
    // incohérence en base, le contrôle doit être fait ici.
    if (campusId) {
      const campus = await prisma.campus.findUnique({
        where: { id: campusId as string },
        select: { schoolId: true },
      });
      if (!campus || campus.schoolId !== schoolId) {
        return bad("campusId ne correspond pas à cette école");
      }
    }
    if (programId) {
      const program = await prisma.program.findUnique({
        where: { id: programId as string },
        select: { schoolId: true },
      });
      if (!program || program.schoolId !== schoolId) {
        return bad("programId ne correspond pas à cette école");
      }
    }
    if (programCampusId) {
      const pc = await prisma.programCampus.findUnique({
        where: { id: programCampusId as string },
        select: {
          programId: true,
          campusId: true,
          program: { select: { schoolId: true } },
        },
      });
      if (!pc || pc.program.schoolId !== schoolId) {
        return bad("programCampusId ne correspond pas à cette école");
      }
      if (programId && pc.programId !== programId) {
        return bad("programCampusId ne correspond pas au programId fourni");
      }
      if (campusId && pc.campusId !== campusId) {
        return bad("programCampusId ne correspond pas au campusId fourni");
      }
    }

    // ── Écriture : un ticket par catégorie ──────
    const writes = await prisma.$transaction(
      categories.map((cat) =>
        prisma.contributionInbox.create({
          data: {
            source_type: "User_Submission",
            schoolId,
            campusId: (campusId as string | null) ?? null,
            programId: (programId as string | null) ?? null,
            programCampusId: (programCampusId as string | null) ?? null,
            user_text: userText,
            urls,
            ai_category: cat as string,
            status: "Pending_AI",
          },
        })
      )
    );

    return NextResponse.json({ success: true, ticketsCreated: writes.length });
  } catch (error) {
    console.error("POST /api/contribute error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
