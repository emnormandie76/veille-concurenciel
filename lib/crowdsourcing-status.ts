/**
 * lib/crowdsourcing-status.ts — Le traitement des contributions, prêt à afficher
 *
 * `GET /internal/pipeline-status` porte, sous `scheduler.crowdsourcing`, deux
 * registres du traitement des contributions publiques
 * (`get_scheduler_status()` dans backend/scheduler/jobs.py) :
 *
 *  - `last_run` : le dernier passage, quel qu'il soit. Le job tourne chaque
 *    minute : c'est presque toujours « aucune contribution en attente » ;
 *  - `last_processed` : le dernier passage qui a traité au moins un ticket, avec
 *    ses comptes. Il survit aux passages vides : sans lui, une contribution
 *    supprimée ne laissait aucune trace hors de la fenêtre du backend (C2).
 *
 * Les décisions d'affichage vivent ici, sans React ni réseau, pour être testées
 * sans serveur, comme lib/rotation-status.ts.
 */

/** Les comptes d'un passage (`process_pending_submissions`). */
export interface CrowdsourcingCounts {
  tickets: number;
  /** Passés en `Pending_Admin`. */
  validated: number;
  /** Passés en `Rejected` : page incompatible, catégorie inconnue. */
  rejected: number;
  /** Retirés de l'inbox : erreur permanente (réponse illisible, page vide). */
  deleted: number;
  /** Erreur inattendue : une tentative comptée. */
  failed: number;
  /** Aucun modèle disponible : le ticket attend, sans tentative consommée. */
  deferred: number;
  /** Le lot s'est arrêté sur le quota Tavily. */
  quota_exhausted: boolean;
}

export interface CrowdsourcingRun {
  status: "success" | "failed";
  detail: string | null;
  finished_at: string;
}

export interface CrowdsourcingLastProcessed extends CrowdsourcingRun {
  counts: CrowdsourcingCounts;
}

export interface CrowdsourcingBlock {
  last_run: CrowdsourcingRun | null;
  last_processed: CrowdsourcingLastProcessed | null;
}

export type CrowdsourcingTone = "ok" | "warning" | "error" | "muted";

export interface CrowdsourcingView {
  tone: CrowdsourcingTone;
  headline: string;
  lines: string[];
}

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/** Ce que dit un passage, issue par issue ; une issue à zéro n'est pas dite. */
export function describeCrowdsourcingCounts(counts: CrowdsourcingCounts): string[] {
  const parts: string[] = [];
  if (counts.validated > 0) parts.push(`${counts.validated} en attente de l'admin`);
  if (counts.rejected > 0) {
    parts.push(`${counts.rejected} ${plural(counts.rejected, "rejetée", "rejetées")} (page incompatible)`);
  }
  if (counts.deleted > 0) {
    parts.push(`${counts.deleted} ${plural(counts.deleted, "supprimée", "supprimées")} (erreur permanente)`);
  }
  if (counts.failed > 0) parts.push(`${counts.failed} en échec (tentative comptée)`);
  if (counts.deferred > 0) {
    parts.push(`${counts.deferred} ${plural(counts.deferred, "différée", "différées")} (aucun modèle disponible)`);
  }
  if (counts.quota_exhausted) parts.push("traitement interrompu : quota Tavily épuisé");
  return parts;
}

function toneOf(counts: CrowdsourcingCounts): CrowdsourcingTone {
  if (counts.quota_exhausted) return "error";
  // Un rejet seul n'inquiète pas : la page était incompatible. Une suppression,
  // un échec ou une attente demandent un coup d'œil.
  if (counts.deleted > 0 || counts.failed > 0 || counts.deferred > 0) return "warning";
  return "ok";
}

/**
 * Le bloc `scheduler.crowdsourcing`, prêt à afficher. `undefined` : un backend
 * qui ne le remonte pas.
 */
export function describeCrowdsourcing(block: CrowdsourcingBlock | undefined): CrowdsourcingView {
  if (!block) {
    return {
      tone: "muted",
      headline: "Le backend ne remonte pas l'état du traitement des contributions.",
      lines: [],
    };
  }

  const { last_run: lastRun, last_processed: processed } = block;
  const lines: string[] = [];
  let tone: CrowdsourcingTone = "muted";
  let headline: string;

  if (processed) {
    const n = processed.counts.tickets;
    headline = `Dernier passage utile : ${formatDateTime(processed.finished_at)} — ${n} ${plural(
      n,
      "contribution traitée",
      "contributions traitées",
    )}`;
    lines.push(...describeCrowdsourcingCounts(processed.counts));
    tone = toneOf(processed.counts);
  } else {
    headline = "Aucune contribution traitée depuis le démarrage du backend.";
  }

  // Le dernier passage, s'il n'est pas déjà celui-là : le plus souvent un passage vide.
  if (lastRun && lastRun.finished_at !== processed?.finished_at) {
    if (lastRun.status === "failed") {
      tone = "error";
      lines.push(`Dernier passage en échec : ${lastRun.detail ?? "cause inconnue"}`);
    } else {
      lines.push(`Dernier passage ${formatDateTime(lastRun.finished_at)} : ${lastRun.detail ?? "—"}`);
    }
  }

  return { tone, headline, lines };
}
