/**
 * lib/research-launch-log.ts — Le journal des lancements de l'IA, en base
 *
 * Plan gestion-contenu, étape 7. Les règles (issues, fenêtres) sont dans
 * lib/research-launches.ts ; ici, ce qui lit et écrit `ResearchLaunch`.
 *
 * - `tracedLaunch` (D41, la trace d'abord) : le lancement s'écrit **avant**
 *   l'appel au backend, au nom de la session ; si cette écriture échoue, rien
 *   ne part (500). Après la réponse, son issue s'y ajoute ; si ce second temps
 *   échoue, la demande est partie : la réponse du backend revient telle
 *   quelle, l'erreur est journalisée, et le lancement reste « en attente »,
 *   sans job relié. `launched_at` est l'heure de la base (D40).
 * - `readLaunchers` : le nom affiché de qui a lancé chaque job de l'historique
 *   (D25 : le nom seul), ou rien (D44 : « non suivi »).
 *
 * `PipelineJob`, la table du backend gelé, n'est jamais écrite (D14).
 */

import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { backendResultResponse, type BackendResult } from "@/lib/internal-api";
import { prisma } from "@/lib/prisma";
import { AUTHOR_SELECT, UNNAMED_AUTHOR, authorName } from "@/lib/provenance";
import {
  JOB_SOURCE_MANUAL,
  JOB_SOURCE_ROTATION,
  attributeDuePasses,
  launchOutcome,
  type LaunchKind,
} from "@/lib/research-launches";

export interface Launch {
  /** Le compte de la session, que la garde a relu en base : jamais le corps. */
  userId: string;
  kind: LaunchKind;
  /** Ce qui part au backend, et l'école d'une recherche ciblée. */
  request: Prisma.InputJsonObject;
  /** Passes dues : le nombre demandé, borne de la fenêtre (D40). */
  maxPasses: number | null;
  /** L'appel au backend, fait seulement si le lancement a pu s'écrire. */
  call: () => Promise<BackendResult>;
}

/** Lance une recherche IA, avec sa trace au journal (D41). */
export async function tracedLaunch({ userId, kind, request, maxPasses, call }: Launch): Promise<NextResponse> {
  let launchId: string;
  try {
    ({ id: launchId } = await prisma.researchLaunch.create({
      data: { kind, triggered_by_id: userId, max_passes: maxPasses, request },
      select: { id: true },
    }));
  } catch (err) {
    console.error(`[research-launch] Lancement ${kind} non enregistré : rien n'est parti.`, err);
    return NextResponse.json(
      { error: "Le lancement n'a pas pu être noté au journal : rien n'est parti. Réessayez." },
      { status: 500 }
    );
  }

  const result = await call();
  const outcome = launchOutcome(kind, result);
  try {
    await prisma.researchLaunch.update({ where: { id: launchId }, data: outcome });
    console.log(`[audit] lancement IA ${kind} ${launchId} par=${userId} : ${outcome.status}`);
  } catch (err) {
    console.error(
      `[research-launch] Issue du lancement ${launchId} non enregistrée (${outcome.status}) : il reste « en attente », sans job relié.`,
      err
    );
  }
  return backendResultResponse(result);
}

interface HistoryJob {
  id: string;
  source: string;
  started_at: Date;
}

/** Les lanceurs des recherches ciblées : par l'id du job que le backend a rendu. */
async function targetedLaunchers(jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const launches = await prisma.researchLaunch.findMany({
    where: { kind: "TARGETED", status: "STARTED", job_id: { in: jobIds } },
    select: { job_id: true, triggeredBy: AUTHOR_SELECT },
  });
  const owners = new Map<string, string>();
  for (const launch of launches) {
    const name = authorName(launch.triggeredBy);
    if (launch.job_id && name) owners.set(launch.job_id, name);
  }
  return owners;
}

/**
 * Les lanceurs des passes dues (D40) : les lancements qui ont pu partir,
 * depuis le dernier d'avant le plus ancien job affiché, et tous les jobs
 * `rotation` de leurs fenêtres jusqu'au plus récent affiché. La borne N se
 * compte sur toute la fenêtre, pas sur la seule page.
 */
async function duePassLaunchers(jobs: HistoryJob[]): Promise<Map<string, string>> {
  if (jobs.length === 0) return new Map();
  const times = jobs.map((job) => job.started_at.getTime());
  const earliest = new Date(Math.min(...times));
  const latest = new Date(Math.max(...times));
  const mayHaveStarted = { kind: "DUE_PASSES", status: { not: "NOT_STARTED" } };

  const before = await prisma.researchLaunch.findFirst({
    where: { ...mayHaveStarted, launched_at: { lte: earliest } },
    orderBy: { launched_at: "desc" },
    select: { launched_at: true },
  });
  const launches = await prisma.researchLaunch.findMany({
    where: { ...mayHaveStarted, launched_at: { gte: before?.launched_at ?? earliest } },
    orderBy: { launched_at: "asc" },
    select: { launched_at: true, max_passes: true, triggeredBy: AUTHOR_SELECT },
  });
  if (launches.length === 0) return new Map();

  const rotation = await prisma.pipelineJob.findMany({
    where: { source: JOB_SOURCE_ROTATION, started_at: { gte: launches[0].launched_at, lte: latest } },
    orderBy: [{ started_at: "asc" }, { id: "asc" }],
    select: { id: true, started_at: true },
  });
  return attributeDuePasses(
    rotation,
    launches.map((launch) => ({
      launched_at: launch.launched_at,
      // La contrainte en base l'exige pour des passes dues ; 1 par prudence.
      max_passes: launch.max_passes ?? 1,
      launcher: authorName(launch.triggeredBy) ?? UNNAMED_AUTHOR,
    }))
  );
}

/** Le lanceur de chaque job de l'historique, par son id ; un job sans lanceur connu n'a pas d'entrée. */
export async function readLaunchers(jobs: HistoryJob[]): Promise<Map<string, string>> {
  const [targeted, duePasses] = await Promise.all([
    targetedLaunchers(jobs.filter((job) => job.source === JOB_SOURCE_MANUAL).map((job) => job.id)),
    duePassLaunchers(jobs.filter((job) => job.source === JOB_SOURCE_ROTATION)),
  ]);
  return new Map([...targeted, ...duePasses]);
}
