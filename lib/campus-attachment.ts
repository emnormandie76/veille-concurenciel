/**
 * lib/campus-attachment.ts — Les règles d'écriture de `ProgramCampusAttachment`
 *
 * Ce fichier prend des affirmations « (programme, campus, année, régime) = ces
 * langues », les confronte entre elles puis à ce que la base porte déjà, et il
 * rend un PLAN : ce qu'il faut créer, ce qu'il faut mettre à jour, ce qui ne
 * bouge pas, ce qu'il refuse d'écrire, et ce qu'il laisse en place sans le
 * réaffirmer. `app/api/admin/inbox/[id]/attachments/route.ts` est son seul
 * appelant applicatif.
 *
 * Il n'importe ni Prisma, ni Next, ni rien qui parle au réseau. Les deux
 * fonctions qui touchent la base reçoivent leur client transactionnel en
 * paramètre, typé structurellement par `AttachmentTx` : un vrai `tx` Prisma le
 * satisfait, un double d'essai aussi. Ce n'est pas une coquetterie de test,
 * c'est le seul moyen de prouver le module aujourd'hui — la migration
 * `20260904120000_program_campus_attachment` n'étant PAS appliquée,
 * `ProgramCampusAttachment` n'existe pas en base et tout appel qui la vise
 * échoue. La coupure passe donc exactement là où passe la frontière du
 * prouvable :
 *
 *   - `resolveAttachmentEdges()` ne lit que `ProgramCampus`, qui existe depuis
 *     `20260901120000_program_campus_refactor` : prouvable contre la vraie base,
 *     et prouvé, dans une transaction volontairement annulée ;
 *   - `applyAttachmentPlan()` vise la table absente : prouvé en test, contre un
 *     double qui enregistre les appels.
 *
 * ## La règle qui commande tout le reste
 *
 * Une ligne n'est écrite que si l'arête `ProgramCampus` existe déjà. Ce module
 * ne crée AUCUN couple `(programId, campusId)`. C'est ce qui garantit qu'il
 * n'ajoute aucune tâche de Phase 2, aucune option en double dans les menus de
 * capacité, et qu'il reste hors d'atteinte du `deleteMany` de
 * `PUT /api/admin/programs/[id]`, qui cascade sur `CapacityRecord`. La
 * résolution de l'arête est faite par la route, par `findUnique` sur
 * `programId_campusId` ; ici on ne voit que son résultat, et une arête absente
 * sort en conflit `edge_missing`.
 *
 * ## Les trois règles déjà tranchées, reportées telles quelles
 *
 * **1. Fusion des affirmations identiques (`merged_tracks`).** Le site découpe
 * par voie d'accès, la base par diplôme : les deux fiches du Programme Grande
 * École publient toutes deux la 3e année sur Caen, Dubaï, Dublin, Oxford et
 * Paris. Les cinq clés portent exactement les mêmes langues et la même note.
 * Ce ne sont pas des conflits, ce sont des répétitions — une seule ligne est
 * écrite, et le conflit `merged_tracks` nomme les fiches d'origine.
 * `source_url` ne compte pas dans la comparaison : il dit QUI l'a publié, pas
 * ce qui est affirmé.
 *
 * **2. Refus en cas de désaccord (`track_disagreement`).** Deux fiches qui
 * revendiquent la même clé avec des langues ou une note différentes n'écrivent
 * RIEN. `@@unique([programCampusId, study_year, regime])` ne peut pas porter
 * deux versions, et rien ne dit laquelle vaut. Sur le corpus du 4 septembre
 * cette garde ne sert jamais — 0 désaccord sur 5 collisions. Elle est donc
 * vérifiée par les tests, pas par les données.
 *
 * **3. Absorption `ANY` / régime nommé.** `(pc, 1, ANY)` et `(pc, 1, INITIAL)`
 * peuvent coexister dans le schéma et se contredisent : le premier dit « cette
 * année, tous régimes », le second nomme un régime. L'invariant est tenu à
 * l'écriture parce qu'il n'est pas exprimable en Prisma — il faudrait une
 * contrainte d'exclusion `btree_gist`, qui reviendrait en dérive de schéma à
 * chaque `migrate diff`. La ligne `ANY` est absorbée : elle disparaît et ses
 * langues sont versées dans chaque ligne spécifique.
 *
 * `backend/pipeline/campus_attachment.py` applique déjà cette règle fiche par
 * fiche. Ici elle est rejouée sur TOUT le lot, et confrontée à ce que la table
 * porte déjà : l'invariant est une propriété de la table, pas du lot. Quand la
 * production porte déjà le genre opposé pour la même `(arête, année)`, rien
 * n'est écrit et le cas sort en `regime_conflict` — parce que la seule autre
 * façon de tenir l'invariant serait de supprimer, et ce module ne supprime pas.
 *
 * ## La deuxième passe
 *
 * Le collecteur est fait pour tourner plusieurs fois. Trois cas, trois
 * réponses, et une seule est discutable :
 *
 *   - la ligne existe à l'identique  -> `unchanged`, aucune écriture émise ;
 *   - la ligne existe et a bougé     -> `update`, avec l'avant dans le rapport ;
 *   - la page ne la publie plus      -> `stale`. Elle SURVIT.
 *
 * Une suppression n'est jamais légitime par ce chemin, et la raison est
 * mesurée, pas prudentielle : le silence du collecteur n'est pas le silence de
 * la page. Le relevé du 4 septembre compte 11 lignes que la page affirme et que
 * la collecte ne rend pas — un `--limit` qui coupe la fiche, une garde de page
 * qui rejette une carte sans bords, une lecture tronquée (la facette Oxford
 * rend 1 853 caractères, de façon déterministe). Supprimer sur absence
 * convertit chacune de ces lectures manquées en perte de donnée. S'y ajoute que
 * le lot d'un ticket ne définit aucun périmètre clos : il porte les lignes de
 * quelques fiches, pas l'état complet d'une école.
 *
 * Ce qu'on perd en ne supprimant pas est réel et il faut le dire : une ligne
 * devenue fausse — l'école a fermé sa 2e année à Dublin — reste en base. La
 * réponse est qu'elle est NOMMÉE : toute ligne de production portée par une
 * arête que cette passe touche et que cette passe ne réaffirme pas ressort en
 * `stale`. L'admin la voit et la supprime à la main s'il en juge ainsi.
 */

/** Régimes admis. Miroir de `VALID_REGIMES` dans `backend/pipeline/campus_attachment.py`. */
export const ATTACHMENT_REGIMES = ["ANY", "INITIAL", "ALTERNANCE"] as const;
export type AttachmentRegime = (typeof ATTACHMENT_REGIMES)[number];

/** Une affirmation du lot, telle que le ticket la porte. */
export interface AttachmentClaim {
  /** Résolus en amont par `backend/pipeline/program_identity.py`. Jamais devinés ici. */
  programId: string;
  campusId: string;
  study_year: number;
  regime: AttachmentRegime;
  languages: string[];
  note: string | null;
  source_url: string | null;
  /** Libellés d'affichage pour le rapport d'admin. Ne servent jamais à résoudre. */
  program: string | null;
  campus: string | null;
  fiche: string | null;
}

/** Une affirmation dont l'arête a été trouvée en base. */
export interface ResolvedClaim extends AttachmentClaim {
  programCampusId: string;
}

/** Une ligne déjà en base, telle que la route la relit. */
export interface ExistingAttachment {
  id: string;
  programCampusId: string;
  study_year: number;
  regime: string;
  languages: string[];
  note: string | null;
  source_url: string | null;
}

/** Tout ce qui n'est pas écrit, ou écrit autrement qu'affirmé, est nommé ici. */
export interface AttachmentConflict {
  type:
    | "malformed_row"
    | "unresolved_reference"
    | "edge_missing"
    | "absorbed_any"
    | "merged_tracks"
    | "track_disagreement"
    | "regime_conflict";
  effect: string;
  program?: string | null;
  campus?: string | null;
  fiche?: string | null;
  fiches?: string[];
  study_year?: number;
  regime?: string;
  programId?: string;
  campusId?: string;
  detail?: string;
  versions?: Array<{ fiche: string | null; languages: string[]; note: string | null }>;
}

/** Une ligne à écrire, et — pour une mise à jour — ce qu'elle remplace. */
export interface PlannedWrite {
  programCampusId: string;
  study_year: number;
  regime: AttachmentRegime;
  languages: string[];
  note: string | null;
  source_url: string | null;
  program: string | null;
  campus: string | null;
  fiches: string[];
  before?: { languages: string[]; note: string | null; source_url: string | null };
}

/** Une ligne de production que cette passe ne réaffirme pas. Elle survit. */
export interface StaleAttachment {
  id: string;
  programCampusId: string;
  study_year: number;
  regime: string;
  languages: string[];
  program: string | null;
  campus: string | null;
  effect: string;
}

export interface AttachmentPlan {
  create: PlannedWrite[];
  update: PlannedWrite[];
  unchanged: PlannedWrite[];
  stale: StaleAttachment[];
  conflicts: AttachmentConflict[];
}

/** Langues en codes courts majuscules, dédoublonnées et triées. */
export function normalizeLanguages(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim().toUpperCase();
    if (trimmed) seen.add(trimmed);
  }
  return [...seen].sort();
}

function isRegime(value: unknown): value is AttachmentRegime {
  return typeof value === "string" && (ATTACHMENT_REGIMES as readonly string[]).includes(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Ce qu'une ligne AFFIRME. `source_url` en est exclu : il dit qui l'a publié. */
function payloadOf(row: { languages: string[]; note: string | null }): string {
  return JSON.stringify([row.languages, row.note]);
}

function labelOf(claim: AttachmentClaim): Pick<AttachmentConflict, "program" | "campus" | "fiche"> {
  return { program: claim.program, campus: claim.campus, fiche: claim.fiche };
}

/**
 * Lit le bloc `campus_attachments` d'un ticket.
 *
 * Aucun appariement de nom n'est refait ici : `programId` et `campusId` sont
 * exigés. Les rapprocher par leur libellé demanderait de reporter en
 * TypeScript les quatre règles de `backend/pipeline/program_identity.py` — une
 * seconde implémentation de l'appariement, dans le langage qui écrit. Une
 * entrée sans identifiant est refusée, pas devinée.
 */
export function parseAttachmentClaims(raw: unknown): {
  claims: AttachmentClaim[];
  conflicts: AttachmentConflict[];
} {
  const conflicts: AttachmentConflict[] = [];
  const claims: AttachmentClaim[] = [];

  const container = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(container.campus_attachments) ? container.campus_attachments : [];

  for (const [index, entry] of rows.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      conflicts.push({
        type: "malformed_row",
        detail: `entrée ${index} : objet attendu`,
        effect: "aucune ligne écrite ; l'entrée n'est pas lisible",
      });
      continue;
    }
    const row = entry as Record<string, unknown>;
    const programId = cleanText(row.programId);
    const campusId = cleanText(row.campusId);
    const program = cleanText(row.program);
    const campus = cleanText(row.campus);
    const fiche = cleanText(row.fiche);

    if (!programId || !campusId) {
      conflicts.push({
        type: "unresolved_reference",
        program,
        campus,
        fiche,
        detail: `entrée ${index} : programId et campusId sont requis`,
        effect:
          "aucune ligne écrite ; ce module ne rapproche pas les noms, il n'écrit que sur des identifiants résolus",
      });
      continue;
    }

    const studyYear = row.study_year;
    if (typeof studyYear !== "number" || !Number.isInteger(studyYear) || studyYear < 1) {
      conflicts.push({
        type: "malformed_row",
        program,
        campus,
        fiche,
        programId,
        campusId,
        detail: `entrée ${index} : study_year doit être un entier supérieur ou égal à 1`,
        effect:
          "aucune ligne écrite ; l'année 0 est la sentinelle de ProgramPlacement, pas une année d'études",
      });
      continue;
    }

    const regime = row.regime ?? "ANY";
    if (!isRegime(regime)) {
      conflicts.push({
        type: "malformed_row",
        program,
        campus,
        fiche,
        study_year: studyYear,
        detail: `entrée ${index} : régime « ${String(regime)} » hors de ANY | INITIAL | ALTERNANCE`,
        effect: "aucune ligne écrite ; le régime n'est pas une valeur admise",
      });
      continue;
    }

    claims.push({
      programId,
      campusId,
      study_year: studyYear,
      regime,
      languages: normalizeLanguages(row.languages),
      note: cleanText(row.note),
      source_url: cleanText(row.source_url),
      program,
      campus,
      fiche,
    });
  }

  return { claims, conflicts };
}

/**
 * Règle 3 — pour une même `(programme, campus, année)`, `ANY` et un régime
 * nommé ne coexistent pas. La ligne `ANY` disparaît, ses langues sont versées
 * dans chaque ligne spécifique.
 */
export function absorbAnyRegime(claims: AttachmentClaim[]): {
  claims: AttachmentClaim[];
  conflicts: AttachmentConflict[];
} {
  const buckets = new Map<string, AttachmentClaim[]>();
  for (const claim of claims) {
    const key = `${claim.programId} ${claim.campusId} ${claim.study_year}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(claim);
    else buckets.set(key, [claim]);
  }

  const kept: AttachmentClaim[] = [];
  const conflicts: AttachmentConflict[] = [];

  for (const bucket of buckets.values()) {
    const anyRows = bucket.filter((c) => c.regime === "ANY");
    const specific = bucket.filter((c) => c.regime !== "ANY");

    if (anyRows.length === 0 || specific.length === 0) {
      kept.push(...bucket);
      continue;
    }

    const poured = normalizeLanguages(anyRows.flatMap((c) => c.languages));
    for (const row of specific) {
      kept.push({ ...row, languages: normalizeLanguages([...row.languages, ...poured]) });
    }
    conflicts.push({
      type: "absorbed_any",
      ...labelOf(anyRows[0]),
      study_year: anyRows[0].study_year,
      regime: "ANY",
      detail: `langues versées dans ${specific.map((c) => c.regime).join(", ")}`,
      effect:
        "la ligne ANY n'est pas écrite ; la fiche nomme un régime, garder ANY à côté affirmerait un régime qu'elle ne propose pas",
    });
  }

  return { claims: kept, conflicts };
}

/**
 * Règles 1 et 2 — deux affirmations qui concordent en font une, deux qui
 * divergent n'en font aucune.
 */
export function foldTracks(claims: AttachmentClaim[]): {
  claims: AttachmentClaim[];
  conflicts: AttachmentConflict[];
} {
  const buckets = new Map<string, AttachmentClaim[]>();
  for (const claim of claims) {
    const key = `${claim.programId} ${claim.campusId} ${claim.study_year} ${claim.regime}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(claim);
    else buckets.set(key, [claim]);
  }

  const kept: AttachmentClaim[] = [];
  const conflicts: AttachmentConflict[] = [];

  for (const bucket of buckets.values()) {
    const first = bucket[0];
    if (bucket.length === 1) {
      kept.push(first);
      continue;
    }

    const payloads = new Set(bucket.map(payloadOf));
    const fiches = [...new Set(bucket.map((c) => c.fiche).filter((f): f is string => !!f))].sort();

    if (payloads.size > 1) {
      conflicts.push({
        type: "track_disagreement",
        program: first.program,
        campus: first.campus,
        fiches,
        study_year: first.study_year,
        regime: first.regime,
        versions: bucket.map((c) => ({ fiche: c.fiche, languages: c.languages, note: c.note })),
        effect:
          "aucune ligne écrite ; la clé unique ne peut pas porter deux versions et rien ne dit laquelle vaut",
      });
      continue;
    }

    // Déterministe : la même sortie quel que soit l'ordre de lecture du lot.
    const sourceUrls = [
      ...new Set(bucket.map((c) => c.source_url).filter((u): u is string => !!u)),
    ].sort();
    kept.push({ ...first, source_url: sourceUrls[0] ?? null });
    conflicts.push({
      type: "merged_tracks",
      program: first.program,
      campus: first.campus,
      fiches,
      study_year: first.study_year,
      regime: first.regime,
      effect:
        "une seule ligne écrite ; les fiches affirment la même chose et la clé unique n'a pas de place pour la voie d'accès",
    });
  }

  return { claims: kept, conflicts };
}

/**
 * Confronte les affirmations résolues à ce que la table porte déjà.
 *
 * C'est ici que se joue la deuxième passe. Rien n'est supprimé : voir l'en-tête
 * du fichier pour ce que ce choix coûte et comment il est compensé.
 */
export function planAttachmentWrites(
  resolved: ResolvedClaim[],
  existing: ExistingAttachment[]
): AttachmentPlan {
  const plan: AttachmentPlan = { create: [], update: [], unchanged: [], stale: [], conflicts: [] };

  const existingByKey = new Map<string, ExistingAttachment>();
  for (const row of existing) {
    existingByKey.set(`${row.programCampusId} ${row.study_year} ${row.regime}`, row);
  }

  // Genre de régime déjà en base, par (arête, année) : l'invariant d'absorption
  // porte sur la TABLE, pas sur le lot.
  const existingKindByYear = new Map<string, Set<string>>();
  for (const row of existing) {
    const key = `${row.programCampusId} ${row.study_year}`;
    const kinds = existingKindByYear.get(key) ?? new Set<string>();
    kinds.add(row.regime === "ANY" ? "ANY" : "SPECIFIC");
    existingKindByYear.set(key, kinds);
  }

  const affirmed = new Set<string>();
  const touchedEdges = new Set<string>();

  for (const claim of resolved) {
    touchedEdges.add(claim.programCampusId);
    const yearKey = `${claim.programCampusId} ${claim.study_year}`;
    const rowKey = `${yearKey} ${claim.regime}`;
    const previous = existingByKey.get(rowKey);

    // La ligne remplace la sienne : elle ne peut pas contredire son propre genre.
    const otherKinds = new Set(existingKindByYear.get(yearKey) ?? []);
    if (previous) otherKinds.delete(previous.regime === "ANY" ? "ANY" : "SPECIFIC");
    const incomingKind = claim.regime === "ANY" ? "ANY" : "SPECIFIC";
    const opposite = incomingKind === "ANY" ? "SPECIFIC" : "ANY";

    if (otherKinds.has(opposite)) {
      plan.conflicts.push({
        type: "regime_conflict",
        program: claim.program,
        campus: claim.campus,
        fiche: claim.fiche,
        study_year: claim.study_year,
        regime: claim.regime,
        detail:
          incomingKind === "ANY"
            ? "la base porte déjà un régime nommé sur cette année"
            : "la base porte déjà une ligne ANY sur cette année",
        effect:
          "aucune ligne écrite ; tenir l'invariant demanderait de supprimer la ligne opposée, et ce chemin ne supprime pas",
      });
      continue;
    }

    affirmed.add(rowKey);
    const write: PlannedWrite = {
      programCampusId: claim.programCampusId,
      study_year: claim.study_year,
      regime: claim.regime,
      languages: claim.languages,
      note: claim.note,
      source_url: claim.source_url,
      program: claim.program,
      campus: claim.campus,
      fiches: claim.fiche ? [claim.fiche] : [],
    };

    if (!previous) {
      plan.create.push(write);
      continue;
    }

    const samePayload =
      payloadOf({ languages: normalizeLanguages(previous.languages), note: previous.note }) ===
      payloadOf(write);
    if (samePayload && (previous.source_url ?? null) === write.source_url) {
      plan.unchanged.push(write);
      continue;
    }

    plan.update.push({
      ...write,
      before: {
        languages: normalizeLanguages(previous.languages),
        note: previous.note,
        source_url: previous.source_url ?? null,
      },
    });
  }

  // Ce que la base porte sur une arête touchée et que cette passe ne redit pas.
  const labels = new Map<string, { program: string | null; campus: string | null }>();
  for (const claim of resolved) {
    labels.set(claim.programCampusId, { program: claim.program, campus: claim.campus });
  }
  for (const row of existing) {
    if (!touchedEdges.has(row.programCampusId)) continue;
    const rowKey = `${row.programCampusId} ${row.study_year} ${row.regime}`;
    if (affirmed.has(rowKey)) continue;
    const label = labels.get(row.programCampusId) ?? { program: null, campus: null };
    plan.stale.push({
      id: row.id,
      programCampusId: row.programCampusId,
      study_year: row.study_year,
      regime: row.regime,
      languages: normalizeLanguages(row.languages),
      program: label.program,
      campus: label.campus,
      effect:
        "ligne conservée ; cette passe ne la réaffirme pas, mais l'absence dans un lot n'est pas une absence sur la page",
    });
  }

  return plan;
}

/**
 * Les trois règles enchaînées, sans base : lecture, absorption, fusion.
 * La route y ajoute la résolution des arêtes, puis `planAttachmentWrites`.
 */
export function foldAttachmentClaims(raw: unknown): {
  claims: AttachmentClaim[];
  conflicts: AttachmentConflict[];
} {
  const parsed = parseAttachmentClaims(raw);
  const absorbed = absorbAnyRegime(parsed.claims);
  const folded = foldTracks(absorbed.claims);
  return {
    claims: folded.claims,
    conflicts: [...parsed.conflicts, ...absorbed.conflicts, ...folded.conflicts],
  };
}

// ──────────────────────────────────────────────
// Les deux seules fonctions qui touchent la base
//
// Elles ne connaissent du client transactionnel que les trois appels ci-dessous.
// Aucune méthode d'écriture de `programCampus` n'y figure : `create`, `upsert`
// et `deleteMany` ne sont pas dans le type, donc ce module ne peut pas créer
// d'arête même par accident.
// ──────────────────────────────────────────────

export interface AttachmentTx {
  programCampus: {
    findUnique(args: {
      where: { programId_campusId: { programId: string; campusId: string } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  programCampusAttachment: {
    findMany(args: {
      where: { programCampusId: { in: string[] } };
    }): Promise<ExistingAttachment[]>;
    upsert(args: {
      where: {
        programCampusId_study_year_regime: {
          programCampusId: string;
          study_year: number;
          regime: string;
        };
      };
      create: {
        programCampusId: string;
        study_year: number;
        regime: string;
        languages: string[];
        note: string | null;
        source_url: string | null;
      };
      update: { languages: string[]; note: string | null; source_url: string | null };
    }): Promise<{ id: string }>;
  };
}

/**
 * LA règle, et le seul endroit où elle s'applique.
 *
 * Chaque couple `(programId, campusId)` distinct est résolu par un `findUnique`
 * sur `programId_campusId`. Si l'arête n'existe pas, la ligne n'est PAS écrite :
 * elle part en conflit `edge_missing`, visible par l'admin. Créer l'arête
 * ouvrirait une option dans deux écrans, une destination de capacité et une
 * tâche de Phase 2 — cela passe par `validateProgramDiscovery`, derrière
 * l'arbitrage humain, jamais par ici.
 *
 * Le `findUnique` sert aussi de contrôle d'appartenance : un `programId` d'une
 * autre école n'a aucune arête vers un campus de celle-ci, donc il ne résout
 * pas. Aucun contrôle de périmètre supplémentaire n'est nécessaire.
 */
export async function resolveAttachmentEdges(
  tx: AttachmentTx,
  claims: AttachmentClaim[]
): Promise<{ resolved: ResolvedClaim[]; conflicts: AttachmentConflict[] }> {
  const resolved: ResolvedClaim[] = [];
  const conflicts: AttachmentConflict[] = [];
  // Un appel par couple distinct, et non par ligne : les 26 lignes du corpus
  // portent sur 12 arêtes.
  const edgeCache = new Map<string, string | null>();

  for (const claim of claims) {
    const pairKey = `${claim.programId} ${claim.campusId}`;
    let edgeId = edgeCache.get(pairKey);
    if (edgeId === undefined) {
      const edge = await tx.programCampus.findUnique({
        where: {
          programId_campusId: { programId: claim.programId, campusId: claim.campusId },
        },
        select: { id: true },
      });
      edgeId = edge?.id ?? null;
      edgeCache.set(pairKey, edgeId);
    }

    if (edgeId === null) {
      conflicts.push({
        type: "edge_missing",
        program: claim.program,
        campus: claim.campus,
        fiche: claim.fiche,
        programId: claim.programId,
        campusId: claim.campusId,
        study_year: claim.study_year,
        regime: claim.regime,
        effect:
          "aucune ligne écrite ; l'arête ProgramCampus n'existe pas et ce chemin n'en crée aucune",
      });
      continue;
    }

    resolved.push({ ...claim, programCampusId: edgeId });
  }

  return { resolved, conflicts };
}

/** Les lignes déjà en base sur les arêtes que cette passe touche. */
export async function readExistingAttachments(
  tx: AttachmentTx,
  resolved: ResolvedClaim[]
): Promise<ExistingAttachment[]> {
  const edgeIds = [...new Set(resolved.map((c) => c.programCampusId))];
  if (edgeIds.length === 0) return [];
  return tx.programCampusAttachment.findMany({ where: { programCampusId: { in: edgeIds } } });
}

/**
 * Exécute le plan. Un `upsert` par ligne à créer ou à mettre à jour, aucun
 * `delete`, rien pour les lignes inchangées et rien pour les `stale`.
 *
 * `upsert` et non `create` alors que le plan sait déjà lesquelles sont neuves :
 * entre la lecture et l'écriture, la ligne a pu naître ailleurs. C'est la
 * Règle 2 du dépôt, et elle rend le chemin rejouable tel quel.
 *
 * Les appels sont sérialisés, et non groupés dans un `Promise.all` : `tx` ne
 * dispose que d'une connexion — le commentaire de `validateProgramDiscovery`
 * dit pourquoi.
 */
export async function applyAttachmentPlan(
  tx: AttachmentTx,
  plan: AttachmentPlan
): Promise<{ created: number; updated: number; unchanged: number }> {
  for (const write of [...plan.create, ...plan.update]) {
    await tx.programCampusAttachment.upsert({
      where: {
        programCampusId_study_year_regime: {
          programCampusId: write.programCampusId,
          study_year: write.study_year,
          regime: write.regime,
        },
      },
      create: {
        programCampusId: write.programCampusId,
        study_year: write.study_year,
        regime: write.regime,
        languages: write.languages,
        note: write.note,
        source_url: write.source_url,
      },
      update: {
        languages: write.languages,
        note: write.note,
        source_url: write.source_url,
      },
    });
  }
  return {
    created: plan.create.length,
    updated: plan.update.length,
    unchanged: plan.unchanged.length,
  };
}
