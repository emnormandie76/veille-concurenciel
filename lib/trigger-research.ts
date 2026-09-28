/**
 * lib/trigger-research.ts — Le corps d'un déclenchement de recherche ciblée
 *
 * L'écran `app/admin/cron/page.tsx` construit le corps avec `buildLaunchBody()`,
 * et `app/api/admin/trigger-research/route.ts` le relit avec
 * `parseTriggerResearchBody()` avant de le transmettre à
 * `POST /internal/trigger-targeted-research/{school_id}`. Les deux vivent ici,
 * sans import de Next ni du réseau, pour être testés sans serveur.
 *
 * ## L'interrupteur de la collecte du rattachement campus
 *
 * `collect_campus_attachments` descend jusqu'à `run_phase1_research()`. La
 * collecte coûte 15 à 17 crédits Tavily et 9 appels Gemini par école, même là
 * où elle ne produit rien : elle ne tourne que si l'admin coche la case, pour
 * cette passe et cette école. L'absence du champ vaut `false`, et seul le
 * booléen `true` l'active. Toute autre valeur est refusée plutôt que lue comme
 * un non : un « true » en chaîne ne doit ni activer la collecte ni se taire. Le
 * champ est aussi refusé en Phase 2, où il ne voudrait rien dire.
 */

export type ResearchPhase = "1" | "2";

/** Le corps transmis à FastAPI, champ pour champ. */
export interface TargetedResearchForward {
  phase: ResearchPhase;
  program_id: string | null;
  categories: string[] | null;
  collect_campus_attachments: boolean;
}

export type ParsedTriggerResearch =
  | { ok: true; schoolId: string; forward: TargetedResearchForward }
  | { ok: false; error: string };

/** Relit le corps reçu par la route ; une erreur part en 400. */
export function parseTriggerResearchBody(body: unknown): ParsedTriggerResearch {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const { school_id, phase, program_id, categories, collect_campus_attachments } = input;

  if (!school_id) {
    return { ok: false, error: "school_id est requis" };
  }
  if (phase !== "1" && phase !== "2") {
    return { ok: false, error: "phase doit être '1' ou '2'" };
  }
  if (collect_campus_attachments !== undefined && typeof collect_campus_attachments !== "boolean") {
    return { ok: false, error: "collect_campus_attachments doit être un booléen" };
  }
  if (collect_campus_attachments === true && phase !== "1") {
    return { ok: false, error: "La collecte du rattachement campus ne concerne que la Phase 1" };
  }

  return {
    ok: true,
    schoolId: String(school_id),
    forward: {
      phase,
      program_id: (program_id as string) || null,
      categories: (categories as string[]) || null,
      collect_campus_attachments: collect_campus_attachments === true,
    },
  };
}

/** Ce que l'écran admin a sélectionné au moment du clic. */
export interface LaunchSelection {
  schoolId: string;
  phase: ResearchPhase;
  programId: string;
  categories: string[];
  collectCampusAttachments: boolean;
}

/** Le corps envoyé par l'écran admin à `POST /api/admin/trigger-research`. */
export function buildLaunchBody(selection: LaunchSelection): Record<string, unknown> {
  const body: Record<string, unknown> = {
    school_id: selection.schoolId,
    phase: selection.phase,
  };
  if (selection.phase === "1") {
    // Toujours explicite, même décochée : le backend répète la valeur reçue,
    // et l'écran affiche cette réponse.
    body.collect_campus_attachments = selection.collectCampusAttachments;
  } else {
    if (selection.programId) body.program_id = selection.programId;
    if (selection.categories.length > 0) body.categories = selection.categories;
  }
  return body;
}

/**
 * Ce que l'écran affiche après le lancement d'une Phase 1, d'après la réponse
 * du backend. Un backend antérieur à l'interrupteur ne répète pas le champ : il
 * l'ignore, et lance la collecte à chaque passe. Ce cas doit se voir.
 */
export function describeCampusCollection(echoed: unknown): string {
  if (echoed === true) return "rattachement campus : collecte activée";
  if (echoed === false) return "rattachement campus : collecte désactivée";
  return (
    "⚠️ rattachement campus : le backend n'a pas confirmé l'interrupteur. " +
    "Une version antérieure lance la collecte à chaque passe."
  );
}
