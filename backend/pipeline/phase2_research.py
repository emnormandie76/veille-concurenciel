"""
backend/pipeline/phase2_research.py — Phase 2 : Enrichissement via Tavily Research

Séquence, pour une école :
  1. Lire l'école, ses programmes et ses couples programme-campus — et, en
     passe automatique (`skip_pending`), les cibles dont un ticket attend
     encore l'admin, qui ne sont pas recherchées (pending_guard.py)
  2. Pour chaque catégorie :
     - construire un BRIEF de recherche (plan de rapport imposé)
     - lancer Tavily Research SANS output_schema — l'agent rédige
     - extraire le JSON du rapport via Gemini (response_json_schema)
     - comparer à la production (has_data_changed)
     - écrire un ticket ContributionInbox par enregistrement futur

## Ce qui a changé, et pourquoi

**output_schema est parti.** Il n'écourtait pas seulement la mise en forme, il
écourtait la RECHERCHE : l'agent cessait de chercher dès qu'il pouvait remplir
les champs `required`. Mesuré sur EM Normandie : 1 classement issu d'une source
avec le schéma, 10 classements issus de 14 sources sans lui. Le rapport est
désormais rédigé, puis structuré par backend/ai/gemini_client.py.

**Le fallback Gemma a disparu.** Il n'était jamais atteint : quand
output_schema était fourni, Tavily renvoyait un dict et `_parse_research_report`
le retournait tel quel. C'était du code mort en régime nominal. Gemma reste en
place pour le crowdsourcing, qui l'appelle vraiment.

**Ranking passe au niveau école.** Un appel `pro` par programme, alors qu'un
seul rapport couvre tout le paysage médiatique de l'établissement — et ramène
les classements de programme ET d'école dans la même réponse. Pour une école à
dix programmes : 20 → 11 appels `pro`. L'extraction ventile ensuite par
programme via `program_hint`.

**include_domains n'est plus uniforme.** Conservé pour Pricing, SchoolStats et
Accreditation, où le site officiel est la source de vérité. Retiré pour Ranking
et Capacity : les classements vivent chez Le Figaro et Challenges, les places
chez les concours et Parcoursup. Une école ne publie chez elle que le palmarès
qui l'arrange.

**Un ticket par enregistrement futur.** Une extraction Ranking qui rend dix
classements produit dix tickets, pas un ticket portant un tableau : l'admin
valide, corrige ou rejette classement par classement. Ils sont reliés par
`submission_group_id`, colonne existante et déjà indexée.

**Le rapport brut est joint au ticket** (`raw_report`). L'admin arbitre sur
pièces, et la donnée reste ré-extractible si le schéma évolue, sans repayer
Tavily.

**Une passe dit ce qui a échoué.** Une recherche ou une extraction ratée
rendait `None`, la boucle passait à la suite, et la passe se disait réussie :
une école dont toutes les cibles avaient échoué n'était pas reprise avant
182 jours. Chaque cible rend désormais un motif ; une seule cible en échec
fait échouer la passe (décision D2 de docs/features/backend-local.md).

**Trois sources par ticket.** `urls`, le bloc « Sources » de l'inbox, portait
toutes les pages lues par Research. `_insert_ticket` n'en garde que trois
(ticket_sources.py, décisions du propriétaire du 15 octobre 2026) : les URL
citées par la charge, puis le domaine officiel, puis l'ordre de Tavily. Le
`source_url` de chaque entrée reste dans la charge.

Référence : dossier « Le rapport avant le schéma », sections 04, 05 et 11.
"""

import logging
import os
import re
import unicodedata
import uuid
import json
from typing import Any, Callable, NamedTuple, Optional

import psycopg2
import psycopg2.extras

from backend.ai.gemini_client import ExtractionUnavailable, GeminiError, extract_structured
from backend.ai.extraction_prompts import get_extraction_prompt, ranking_extraction_prompt
from backend.ai.extraction_schemas import (
    NO_PROGRAM_HINT,
    get_extraction_schema,
    get_min_tier,
    ranking_extraction_schema,
)
from backend.pipeline.diff import has_data_changed
from backend.pipeline.pending_guard import read_pending_targets
from backend.pipeline.program_identity import MATCH_AMBIGUOUS, match_program
from backend.pipeline.ticket_sources import select_ticket_sources
from backend.ai.research_prompts import (
    build_pricing_research_input,
    build_ranking_research_input,
    build_capacity_research_input,
    build_school_stats_research_input,
    build_accreditation_research_input,
)
from backend.tavily_service.research_client import create_research_task
from backend.utils.academic_year import get_target_academic_year_str, get_target_period_start

logger = logging.getLogger("pipeline.phase2_research")


# ── Découpage des catégories ──────────────────────────────────────

# Catégories utilisant le modèle Tavily "mini" (4-15 crédits) : données simples.
MINI_MODEL_CATEGORIES = {"SchoolStats", "Accreditation", "Capacity"}

# Niveau école : un appel par école. Ranking a rejoint ce groupe — voir la
# docstring du module.
SCHOOL_LEVEL_CATEGORIES = ["SchoolStats", "Accreditation", "Ranking"]
# Niveau programme : un appel par programme.
PROGRAM_LEVEL_CATEGORIES = ["Pricing"]
# Niveau programme-campus : la capacité varie d'un campus à l'autre.
PROGRAM_CAMPUS_LEVEL_CATEGORIES = ["Capacity"]

# Catégories pour lesquelles include_domains est posé sur l'appel Research.
# Le paramètre est une préférence molle, pas un filtre : il ne bloque rien mais
# pousse fortement vers les pages de l'école. Souhaitable quand l'école est la
# source de vérité, contre-productif quand la donnée vit chez des tiers.
DOMAIN_PREFERRED_CATEGORIES = {"Pricing", "SchoolStats", "Accreditation"}

# Colonnes réellement écrites en base, par catégorie. Sert au module de diff :
# comparer sur les champs d'extraction qui n'ont pas de colonne (scope,
# program_hint, ranking_label…) conclurait « changé » à chaque passage du cron.
DB_FIELDS_BY_CATEGORY: dict[str, list[str]] = {
    "Pricing": [
        "academic_year", "currency",
        "year_1_fee", "year_2_fee", "year_3_fee", "year_4_fee", "year_5_fee",
        "total_fee", "intl_year_1_fee", "intl_total_fee", "intl_currency",
        "additional_fees_notes",
    ],
    "Ranking": ["academic_year", "ranking_name", "rank"],
    "Capacity": ["academic_year", "spots_available"],
    "SchoolStats": [
        "academic_year", "total_students", "total_alumni", "partner_companies",
        "annual_internship_offers", "abroad_campuses", "partner_universities",
        "permanent_professors", "international_professors_pct",
        "external_speakers_pct",
    ],
}


def _get_research_model(category: str) -> str:
    """Modèle Tavily Research adapté à la catégorie."""
    return "mini" if category in MINI_MODEL_CATEGORIES else "pro"


def _include_domains_for(category: str, official_domain: str) -> list[str] | None:
    """include_domains à passer à Research, ou None quand il nuit."""
    return [official_domain] if category in DOMAIN_PREFERRED_CATEGORIES else None


# ── Rattachement d'un classement à un programme ───────────────────

def _normalize_name(name: str | None) -> str:
    """Minuscules, sans accents ni ponctuation — pour comparer des intitulés."""
    text = unicodedata.normalize("NFD", name or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _match_program(hint: str | None, programs: list[dict]) -> dict | None:
    """
    Retrouve le programme visé par `program_hint`.

    Ranking tourne au niveau école : le rapport parle de « Programme Grande
    École » ou de « Master in Management », pas d'un identifiant. Le
    rattachement est délibérément prudent — mieux vaut écarter un classement
    que l'attribuer au mauvais programme, où il deviendrait une ligne fausse et
    permanente.

    L'extraction choisit `program_hint` dans la liste des programmes de l'école
    (`ranking_extraction_schema`) : le cas normal est l'égalité exacte. À
    défaut, les clauses fermées de `program_identity.match_program`, et
    uniquement si un seul programme répond. L'ancienne inclusion de sous-chaîne
    rattachait « Bachelor Management, Data et IA Responsables » au « Bachelor
    Management », et perdait « Bachelor en Management ».
    """
    if not hint or hint == NO_PROGRAM_HINT:
        return None
    target = _normalize_name(hint)
    if not target:
        return None

    for program in programs:
        if _normalize_name(program["name"]) == target:
            return program

    clause, hits = match_program(hint, programs)
    if clause.startswith(MATCH_AMBIGUOUS):
        logger.info(
            "↔️ '%s' correspond à %d programmes — classement écarté (ambigu)",
            hint,
            len(hits),
        )
        return None
    return hits[0] if hits else None


# ── Lecture de la production ──────────────────────────────────────

def _get_existing_record(category: str, school_id: str, program_id: str | None) -> dict | None:
    from backend.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if category == "Pricing" and program_id:
                cur.execute('SELECT * FROM "PricingRecord" WHERE "programId" = %s ORDER BY "academic_year" DESC LIMIT 1', (program_id,))
                return cur.fetchone()
            if category == "SchoolStats":
                cur.execute('SELECT * FROM "SchoolStatsRecord" WHERE "schoolId" = %s ORDER BY "academic_year" DESC LIMIT 1', (school_id,))
                return cur.fetchone()
            if category == "Accreditation":
                return None
            return None


def _get_existing_rankings(program_ids: list[str]) -> dict[tuple[str, int, str], dict]:
    """
    Tous les RankingRecord des programmes d'une école, indexés sur leur clé
    d'unicité (programId, academic_year, ranking_name).

    L'ancienne lecture ne prenait que le classement le plus récent d'un
    programme : avec dix classements par programme, elle comparait chaque
    nouveauté au même unique enregistrement et recréait un ticket à chaque
    passage. Le diff se fait maintenant entrée par entrée, sur la clé que la
    base utilise vraiment.
    """
    from backend.db import get_db_connection
    if not program_ids:
        return {}
    placeholders = ",".join(["%s"] * len(program_ids))
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f'SELECT * FROM "RankingRecord" WHERE "programId" IN ({placeholders})',
                program_ids,
            )
            rows = cur.fetchall()
    return {
        (row["programId"], row["academic_year"], row["ranking_name"]): dict(row)
        for row in rows
    }


def _get_existing_capacity_record(program_campus_id: str) -> dict | None:
    """Dernier CapacityRecord d'un ProgramCampus."""
    from backend.db import get_db_connection
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                'SELECT * FROM "CapacityRecord" WHERE "programCampusId" = %s ORDER BY "academic_year" DESC LIMIT 1',
                (program_campus_id,)
            )
            return cur.fetchone()


# ── Écriture d'un ticket ──────────────────────────────────────────

def _insert_ticket(
    *,
    category: str,
    school_id: str,
    payload: dict,
    source_urls: list[str],
    raw_report: str | None,
    official_domain: str | None,
    program_id: str | None = None,
    campus_id: str | None = None,
    program_campus_id: str | None = None,
    submission_group_id: str | None = None,
) -> str:
    """
    Écrit un ticket ContributionInbox et retourne son id.

    `raw_report` porte le rapport Tavily intégral : l'admin arbitre sur pièces,
    et la donnée reste ré-extractible si le schéma évolue — sans repayer un
    appel `pro`.

    `urls`, le bloc « Sources » de l'inbox, ne garde que trois liens de
    `source_urls` (ticket_sources.py) : les URL citées par `payload`, puis le
    domaine officiel, puis l'ordre de Tavily. `official_domain` est obligatoire
    pour qu'un oubli ne fasse pas disparaître ce groupe en silence. Seul point
    d'écriture de la Phase 2 : tous ses tickets passent par cette coupe.
    """
    from backend.db import get_db_connection

    ticket_id = str(uuid.uuid4())
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "ContributionInbox"
                    (id, source_type, "schoolId", "campusId", "programId", "programCampusId",
                     ai_category, ai_extracted_json, status, year_assumed,
                     data_conflict_warning, urls, submission_group_id, raw_report)
                VALUES (%s, 'Automated_AI', %s, %s, %s, %s, %s, %s, 'Pending_Admin', %s, %s, %s, %s, %s)
                """,
                (
                    ticket_id,
                    school_id,
                    campus_id,
                    program_id,
                    program_campus_id,
                    category,
                    json.dumps(payload),
                    bool(payload.get("year_assumed", False)),
                    bool(payload.get("data_conflict_warning", False)),
                    select_ticket_sources(source_urls, payload, official_domain=official_domain),
                    submission_group_id,
                    raw_report,
                ),
            )
    return ticket_id


# ── Recherche puis extraction ─────────────────────────────────────

# Motif d'une cible, rendu par `_run_research_and_extract`.
OUTCOME_OK = "ok"
OUTCOME_DRY_RUN = "dry_run"
OUTCOME_RESEARCH_FAILED = "research_failed"
OUTCOME_EMPTY_REPORT = "empty_report"
OUTCOME_EXTRACTION_UNAVAILABLE = "extraction_unavailable"
OUTCOME_EXTRACTION_FAILED = "extraction_failed"
OUTCOME_BAD_SHAPE = "bad_shape"

# Les motifs d'échec, et leur libellé dans le message de la passe. Une seule
# cible sur l'un d'eux fait échouer la passe (D2) : l'école repasse après
# CRON_RESEARCH_RETRY_FAILED_DAYS (14 jours) au lieu de 182.
FAILURE_LABELS = {
    OUTCOME_RESEARCH_FAILED: "recherche en échec",
    OUTCOME_EMPTY_REPORT: "rapport vide",
    OUTCOME_EXTRACTION_UNAVAILABLE: "extraction indisponible",
    OUTCOME_EXTRACTION_FAILED: "extraction en échec",
    OUTCOME_BAD_SHAPE: "extraction mal formée",
}

# Cibles en échec nommées dans le message ; au-delà, un compte. Le message part
# dans PipelineJob.error et dans le rapport des passes dues.
MAX_FAILED_TARGETS_IN_MESSAGE = 5


class ResearchOutcome(NamedTuple):
    """Une cible : données extraites (ou None), rapport brut, URLs sources, motif."""
    extracted: Optional[dict]
    report: str
    source_urls: list[str]
    reason: str


def _report_text(research_result: dict) -> str:
    """
    Texte du rapport Research.

    La réponse /research a exactement six clés : content, sources, status,
    created_at, response_time, request_id. Le champ `report` de la
    documentation interne n'existe pas ; le client lit correctement `content`
    et l'expose sous la clé "report". Sans output_schema, c'est toujours une
    chaîne — le `dict` reste toléré par prudence, il ne devrait plus survenir.
    """
    content = research_result.get("report")
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    return ""


def _run_research_and_extract(
    *,
    category: str,
    query: str,
    key_manager,
    official_domain: str,
    dry_run: bool,
    label: str = "",
    extraction_prompt: Optional[str] = None,
    extraction_schema: Optional[dict] = None,
) -> ResearchOutcome:
    """
    Un appel Research puis une extraction Gemini.

    Retourne (données extraites, rapport brut, URLs sources, motif). Les données
    valent None quand la recherche ou l'extraction a échoué, et en `dry_run` :
    l'appelant passe alors à la suite sans écrire de ticket. Le motif dit
    pourquoi (`FAILURE_LABELS` pour les échecs) ; l'appelant le compte.
    Un quota Tavily épuisé est un `research_failed` comme un autre : en
    rotation, `_QuotaWatch` (backend/scheduler/jobs.py) le repère à part.

    `extraction_prompt` et `extraction_schema` remplacent ceux de la catégorie
    quand l'extraction dépend de l'école — Ranking reçoit la liste de ses
    programmes.

    Les extractions sont sérialisées par le portillon RPM de gemini_client :
    lancées en parallèle, elles saturaient les 5 requêtes/minute de la clé.
    """
    research_model = _get_research_model(category)
    try:
        research_result = create_research_task(
            query=query,
            key_manager=key_manager,
            include_domains=_include_domains_for(category, official_domain),
            model=research_model,
            dry_run=dry_run,
        )
        logger.info("🔬 [%s] %s %s", research_model.upper(), category, label)
    except Exception as e:
        logger.error("❌ Échec Research %s %s: %s", category, label, e)
        return ResearchOutcome(None, "", [], OUTCOME_RESEARCH_FAILED)

    report = _report_text(research_result)
    sources = research_result.get("sources", [])
    source_urls = [s.get("url") for s in sources if s.get("url")]

    if dry_run:
        logger.info("🧪 [DRY RUN] %s %s — %d caractères", category, label, len(report))
        return ResearchOutcome(None, report, source_urls, OUTCOME_DRY_RUN)

    if not report.strip():
        logger.error("❌ Rapport vide pour %s %s — extraction annulée", category, label)
        return ResearchOutcome(None, "", source_urls, OUTCOME_EMPTY_REPORT)

    logger.info(
        "📄 Rapport %s %s : %d caractères, %d sources",
        category, label, len(report), len(source_urls),
    )

    try:
        extracted = extract_structured(
            system_prompt=extraction_prompt or get_extraction_prompt(category),
            source_text=report,
            json_schema=extraction_schema or get_extraction_schema(category),
            min_tier=get_min_tier(category),
        )
    except ExtractionUnavailable as e:
        # Échec explicite plutôt qu'un ticket bas de gamme : le prochain cycle
        # réessaiera, avec des compteurs journaliers remis à zéro.
        logger.error("❌ Extraction indisponible pour %s %s: %s", category, label, e)
        return ResearchOutcome(None, report, source_urls, OUTCOME_EXTRACTION_UNAVAILABLE)
    except GeminiError as e:
        logger.error("❌ Extraction échouée pour %s %s: %s", category, label, e)
        return ResearchOutcome(None, report, source_urls, OUTCOME_EXTRACTION_FAILED)

    if not isinstance(extracted, dict):
        logger.error(
            "❌ Extraction %s %s : objet attendu, %s reçu",
            category, label, type(extracted).__name__,
        )
        return ResearchOutcome(None, report, source_urls, OUTCOME_BAD_SHAPE)

    return ResearchOutcome(extracted, report, source_urls, OUTCOME_OK)


class _PassTally:
    """
    Le bilan d'une passe : les motifs par catégorie, les enregistrements
    identiques à la production à part, et les cibles en échec dans l'ordre.

    `outcomes` compte des cibles (une par appel Research) ; `unchanged` compte
    des enregistrements : un rapport Ranking en porte plusieurs.
    """

    def __init__(self) -> None:
        self.outcomes: dict[str, dict[str, int]] = {}
        self.unchanged: dict[str, int] = {}
        self.failed_targets: list[dict] = []

    def record(self, category: str, label: str, reason: str) -> None:
        counts = self.outcomes.setdefault(category, {})
        counts[reason] = counts.get(reason, 0) + 1
        if reason in FAILURE_LABELS:
            self.failed_targets.append({"category": category, "label": label, "reason": reason})

    def add_unchanged(self, category: str, count: int) -> None:
        if count:
            self.unchanged[category] = self.unchanged.get(category, 0) + count

    def message(self, tickets_created: int, categories_scanned: int) -> str:
        message = f"{tickets_created} ticket(s) créé(s) sur {categories_scanned} scans"
        if not self.failed_targets:
            return message
        named = ", ".join(
            f"{t['category']} « {t['label']} » ({FAILURE_LABELS[t['reason']]})"
            for t in self.failed_targets[:MAX_FAILED_TARGETS_IN_MESSAGE]
        )
        rest = len(self.failed_targets) - MAX_FAILED_TARGETS_IN_MESSAGE
        if rest > 0:
            named += f" (+{rest})"
        return f"{message} ; {len(self.failed_targets)} cible(s) en échec : {named}"


# ── Orchestrateur ─────────────────────────────────────────────────

def run_phase2_research(
    school_id: str,
    key_manager,
    dry_run: bool = False,
    target_program_id: str | None = None,
    target_categories: list[str] | None = None,
    progress_callback: Callable[[dict], None] | None = None,
    skip_pending: bool = False,
) -> dict:
    """
    Orchestrateur de la Phase 2 via Tavily Research pour une école.

    Args:
        school_id: UUID de l'école cible
        key_manager: TavilyKeyManager pour la rotation de clés
        dry_run: Si True, ne fait pas d'appels API ni d'écriture BDD
        target_program_id: Si défini, ne traiter que ce programme (UUID)
        target_categories: Si défini, ne traiter que ces catégories
        progress_callback: Callback de progression (monitoring admin)
        skip_pending: Si True, sauter les cibles dont un ticket du pipeline
            attend la validation (pending_guard). Passes automatiques seulement :
            une recherche lancée à la main reste libre.

    Returns:
        `success` (faux dès qu'une cible a échoué en recherche ou en
        extraction, D2), `tickets_created`, `message` (qui nomme les cibles en
        échec), `outcomes` (`{catégorie: {motif: nb de cibles}}`), `unchanged`
        (`{catégorie: nb d'enregistrements identiques à la production}`),
        `failed_targets` (`[{category, label, reason}]`) et, en passe
        automatique, `skipped_pending`.
    """
    from backend.db import get_db_connection

    logger.info(f"🚀 [Research] Phase 2 démarrée pour school_id={school_id} (dry_run={dry_run})")
    if target_program_id:
        logger.info(f"🎯 [Research] Ciblage programme: {target_program_id}")
    if target_categories:
        logger.info(f"🎯 [Research] Ciblage catégories: {target_categories}")

    academic_year_str = get_target_academic_year_str()

    tickets_created = 0
    categories_scanned = 0
    tally = _PassTally()

    # ── PHASE 1 : Lecture courte — connexion fermée après ──────────────
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute('SELECT id, name, official_domain, status FROM "School" WHERE id = %s', (school_id,))
            school = cur.fetchone()
            if not school or school["status"] != "ACTIVE":
                return {"success": False, "message": "École non trouvée ou inactive"}

            school_name = school["name"]
            official_domain = school["official_domain"]

            if progress_callback:
                progress_callback({
                    "current_action": "Chargement de l'école et des programmes",
                    "school": school_name,
                })

            # ── Programmes de l'école ─────────────────────────────
            if target_program_id:
                cur.execute(
                    """
                    SELECT p.id, p.name, p."schoolId"
                    FROM "Program" p
                    WHERE p."schoolId" = %s AND p.id = %s
                    ORDER BY p.name ASC
                    """,
                    (school_id, target_program_id)
                )
            else:
                cur.execute(
                    """
                    SELECT p.id, p.name, p."schoolId"
                    FROM "Program" p
                    WHERE p."schoolId" = %s
                    ORDER BY p.name ASC
                    """,
                    (school_id,)
                )
            programs = [dict(row) for row in cur.fetchall()]

            # Limitation facultative pour tests
            max_programs = os.environ.get("PHASE2_MAX_PROGRAMS")
            if max_programs and not target_program_id:
                try:
                    max_programs_int = int(max_programs)
                    if max_programs_int > 0:
                        programs = programs[:max_programs_int]
                        logger.info(f"🧪 PHASE2_MAX_PROGRAMS actif: {max_programs_int} programme(s) max")
                except ValueError:
                    pass

            # ── Associations ProgramCampus (pour Capacity) ────────
            prog_ids = [p["id"] for p in programs]
            program_campuses = []
            if prog_ids and (not target_categories or "Capacity" in target_categories):
                placeholders = ",".join(["%s"] * len(prog_ids))
                cur.execute(
                    f"""
                    SELECT pc.id as program_campus_id, pc."programId" as program_id,
                           pc."campusId" as campus_id,
                           p.name as program_name, c.name as campus_name
                    FROM "ProgramCampus" pc
                    JOIN "Program" p ON p.id = pc."programId"
                    JOIN "Campus" c ON c.id = pc."campusId"
                    WHERE pc."programId" IN ({placeholders})
                    ORDER BY p.name ASC, c.name ASC
                    """,
                    prog_ids
                )
                program_campuses = [dict(row) for row in cur.fetchall()]

            # ── Cibles dont un ticket attend l'admin (passe automatique) ──
            pending = read_pending_targets(cur, school_id, get_target_period_start()) if skip_pending else None
    # ── Connexion BDD FERMÉE ici — les appels API commencent maintenant ──

    school_cats = [c for c in SCHOOL_LEVEL_CATEGORIES if not target_categories or c in target_categories]
    prog_cats = [c for c in PROGRAM_LEVEL_CATEGORIES if not target_categories or c in target_categories]
    prog_campus_cats = [c for c in PROGRAM_CAMPUS_LEVEL_CATEGORIES if not target_categories or c in target_categories]

    # `programs` sert aussi au brief et au schéma Ranking, et à
    # _write_ranking_tickets : la garde ne filtre qu'une copie dédiée à Pricing,
    # sans quoi un programme en attente de tarif sortirait du rattachement des
    # classements.
    pricing_programs = programs
    skipped_pending = None
    if pending is not None:
        skipped_school_cats = [c for c in school_cats if c in pending.school_categories]
        school_cats = [c for c in school_cats if c not in pending.school_categories]
        if prog_cats:
            pricing_programs = [p for p in programs if p["id"] not in pending.pricing_program_ids]
        before_capacity = len(program_campuses)
        program_campuses = [
            pc for pc in program_campuses
            if pc["program_campus_id"] not in pending.capacity_program_campus_ids
        ]
        skipped_pending = {
            "school_categories": skipped_school_cats,
            "pricing": len(programs) - len(pricing_programs),
            "capacity": before_capacity - len(program_campuses),
        }
        logger.info(
            "⏸️ [Research] Cibles en attente de validation, sautées : "
            "école %s, Pricing ×%d, Capacity ×%d",
            skipped_school_cats or "—", skipped_pending["pricing"], skipped_pending["capacity"],
        )

    total_to_scan = len(school_cats) + (len(pricing_programs) * len(prog_cats)) + (len(program_campuses) * len(prog_campus_cats))
    logger.info(
        f"📊 [Research] Total tâches à scanner: {total_to_scan} "
        f"({len(school_cats)} école + {len(pricing_programs)}×{len(prog_cats)} prog "
        f"+ {len(program_campuses)}×{len(prog_campus_cats)} prog-campus)"
    )

    # ── 3. Catégories niveau École ─────────────────────────
    for category in school_cats:
        categories_scanned += 1

        if progress_callback:
            progress_callback({
                "current_action": f"Recherche {category}",
                "school": school_name,
                "category": category,
                "progress": f"{categories_scanned}/{total_to_scan}",
            })

        extraction_prompt = extraction_schema = None
        if category == "SchoolStats":
            prompt = build_school_stats_research_input(school_name, academic_year_str, official_domain)
        elif category == "Ranking":
            program_names = [p["name"] for p in programs]
            prompt = build_ranking_research_input(
                school_name, program_names, academic_year_str, official_domain
            )
            extraction_prompt = ranking_extraction_prompt(program_names)
            extraction_schema = ranking_extraction_schema(program_names)
        else:  # Accreditation
            prompt = build_accreditation_research_input(school_name, official_domain)

        extracted, report, source_urls, reason = _run_research_and_extract(
            category=category,
            query=prompt,
            key_manager=key_manager,
            official_domain=official_domain,
            dry_run=dry_run,
            label=f"pour {school_name}",
            extraction_prompt=extraction_prompt,
            extraction_schema=extraction_schema,
        )
        tally.record(category, school_name, reason)
        if extracted is None:
            continue

        if category == "Ranking":
            created, unchanged = _write_ranking_tickets(
                extracted=extracted,
                school_id=school_id,
                programs=programs,
                source_urls=source_urls,
                raw_report=report,
                official_domain=official_domain,
            )
            tickets_created += created
            tally.add_unchanged(category, unchanged)
            continue

        existing = _get_existing_record(category, school_id, None)
        if has_data_changed(extracted, existing, DB_FIELDS_BY_CATEGORY.get(category)):
            _insert_ticket(
                category=category,
                school_id=school_id,
                payload=extracted,
                source_urls=source_urls,
                raw_report=report,
                official_domain=official_domain,
            )
            tickets_created += 1
        else:
            tally.add_unchanged(category, 1)

    # ── 4. Catégories niveau Programme (Pricing) ───────────
    for program in pricing_programs:
        for category in prog_cats:
            categories_scanned += 1

            if progress_callback:
                progress_callback({
                    "current_action": f"Recherche {category}",
                    "school": school_name,
                    "program": program["name"],
                    "category": category,
                    "progress": f"{categories_scanned}/{total_to_scan}",
                })

            prompt = build_pricing_research_input(
                school_name, program["name"], academic_year_str, official_domain
            )

            extracted, report, source_urls, reason = _run_research_and_extract(
                category=category,
                query=prompt,
                key_manager=key_manager,
                official_domain=official_domain,
                dry_run=dry_run,
                label=f"pour {program['name']}",
            )
            tally.record(category, program["name"], reason)
            if extracted is None:
                continue

            existing = _get_existing_record(category, school_id, program["id"])
            if has_data_changed(extracted, existing, DB_FIELDS_BY_CATEGORY.get(category)):
                _insert_ticket(
                    category=category,
                    school_id=school_id,
                    program_id=program["id"],
                    payload=extracted,
                    source_urls=source_urls,
                    raw_report=report,
                    official_domain=official_domain,
                )
                tickets_created += 1
            else:
                tally.add_unchanged(category, 1)

    # ── 5. Catégories niveau ProgramCampus (Capacity) ──────
    for pc in program_campuses:
        for category in prog_campus_cats:
            categories_scanned += 1

            if progress_callback:
                progress_callback({
                    "current_action": f"Recherche {category}",
                    "school": school_name,
                    "program": f"{pc['program_name']} @ {pc['campus_name']}",
                    "category": category,
                    "progress": f"{categories_scanned}/{total_to_scan}",
                })

            prompt = build_capacity_research_input(
                school_name, pc["campus_name"], pc["program_name"],
                academic_year_str, official_domain
            )

            target = f"{pc['program_name']} @ {pc['campus_name']}"
            extracted, report, source_urls, reason = _run_research_and_extract(
                category=category,
                query=prompt,
                key_manager=key_manager,
                official_domain=official_domain,
                dry_run=dry_run,
                label=f"pour {target}",
            )
            tally.record(category, target, reason)
            if extracted is None:
                continue

            created, unchanged = _write_capacity_ticket(
                extracted=extracted,
                school_id=school_id,
                program_campus=pc,
                source_urls=source_urls,
                raw_report=report,
                official_domain=official_domain,
            )
            tickets_created += created
            tally.add_unchanged(category, unchanged)

    if progress_callback:
        progress_callback({
            "current_action": "Terminé",
            "school": school_name,
            "progress": f"{categories_scanned}/{total_to_scan}",
            "tickets_created": tickets_created,
        })

    message = tally.message(tickets_created, categories_scanned)
    if tally.failed_targets:
        logger.warning(f"⚠️ [Research] Phase 2 terminée en échec : {message}")
    else:
        logger.info(f"✅ [Research] Phase 2 terminée : {categories_scanned} scans, {tickets_created} tickets créés")
    result = {
        # D2 : une seule cible en échec fait échouer la passe, qui sera reprise
        # après le délai d'échec. La garde « en attente » (skip_pending) évite
        # de repayer ce qui a été déposé.
        "success": not tally.failed_targets,
        "tickets_created": tickets_created,
        "message": message,
        "outcomes": tally.outcomes,
        "unchanged": tally.unchanged,
        "failed_targets": tally.failed_targets,
    }
    if skipped_pending is not None:
        result["skipped_pending"] = skipped_pending
    return result


# ── Écriture des tickets Ranking ──────────────────────────────────

def _write_ranking_tickets(
    *,
    extracted: dict,
    school_id: str,
    programs: list[dict],
    source_urls: list[str],
    raw_report: str,
    official_domain: str | None,
) -> tuple[int, int]:
    """
    Un ticket par classement extrait, relié aux autres par submission_group_id.
    Rend (tickets créés, classements identiques à la production).

    L'admin valide, corrige ou rejette classement par classement, et
    `validateRanking` écrit une ligne à la fois : un ticket portant un tableau
    l'obligerait à tout accepter en bloc.

    Deux catégories d'entrées sont écartées, et c'est délibéré :
      - `scope: "school"` — RankingRecord exige un programId, et attribuer un
        classement d'établissement à un programme au hasard produirait une ligne
        fausse et permanente ;
      - `program_hint` sans correspondance (ou ambigu) — même raison.
    Elles restent lisibles dans `raw_report`, joint à chacun des tickets du
    groupe.
    """
    rankings = extracted.get("rankings")
    if not isinstance(rankings, list) or not rankings:
        logger.warning("⚠️ Extraction Ranking vide pour school_id=%s", school_id)
        return 0, 0

    existing = _get_existing_rankings([p["id"] for p in programs])
    group_id = str(uuid.uuid4())
    emitted_keys: set[tuple] = set()
    created = 0
    skipped_school_scope = 0
    skipped_unmatched = 0
    skipped_duplicate_key = 0
    unchanged = 0

    for entry in rankings:
        if not isinstance(entry, dict):
            continue
        if entry.get("scope") == "school":
            skipped_school_scope += 1
            continue

        program = _match_program(entry.get("program_hint"), programs)
        if program is None:
            skipped_unmatched += 1
            continue

        key = (program["id"], entry.get("academic_year"), entry.get("ranking_name"))

        # Deux entrées d'une même extraction peuvent viser la MÊME ligne future :
        # RankingRecord est unique sur (programId, academic_year, ranking_name),
        # et l'enum rabat tous les palmarès hors liste sur « Autre ». Observé sur
        # un rapport réel : trois « Autre » 2025 pour le même programme.
        # Émettre trois tickets pour une seule ligne ferait valider l'admin trois
        # fois, chaque validation écrasant la précédente. Le premier gagne ; les
        # suivants restent lisibles dans raw_report, joint à chaque ticket.
        if key in emitted_keys:
            skipped_duplicate_key += 1
            continue
        emitted_keys.add(key)

        if not has_data_changed(entry, existing.get(key), DB_FIELDS_BY_CATEGORY["Ranking"]):
            unchanged += 1
            continue

        # Un classement qui porte sa propre URL ne garde qu'elle : la coupe
        # choisit dans cette liste, elle n'y ajoute rien.
        entry_urls = [entry["source_url"]] if entry.get("source_url") else source_urls
        _insert_ticket(
            category="Ranking",
            school_id=school_id,
            program_id=program["id"],
            payload=entry,
            source_urls=entry_urls,
            raw_report=raw_report,
            official_domain=official_domain,
            submission_group_id=group_id,
        )
        created += 1

    logger.info(
        "🏆 Ranking : %d classements extraits → %d tickets "
        "(%d inchangés, %d au niveau école, %d non rattachés, %d doublons de clé)",
        len(rankings), created, unchanged, skipped_school_scope,
        skipped_unmatched, skipped_duplicate_key,
    )
    return created, unchanged


# ── Écriture du ticket Capacity ───────────────────────────────────

def _write_capacity_ticket(
    *,
    extracted: dict,
    school_id: str,
    program_campus: dict,
    source_urls: list[str],
    raw_report: str,
    official_domain: str | None,
) -> tuple[int, int]:
    """
    Un seul ticket portant le tableau des voies d'admission. Rend (tickets
    créés, enregistrements identiques à la production) : (1, 0), (0, 1), ou
    (0, 0) pour une extraction vide.

    Contrairement à Ranking, Capacity ne se découpe pas : CapacityRecord est
    unique sur (programCampusId, academic_year), et les entrées d'une même année
    visent donc toutes la même ligne. Le total ne se recompose qu'à la
    validation, sous l'œil de l'admin — c'est `validateCapacity` qui arbitre
    entre un total publié et une somme de voies.
    """
    capacities = extracted.get("capacities")
    if not isinstance(capacities, list) or not capacities:
        logger.warning(
            "⚠️ Extraction Capacity vide pour %s @ %s",
            program_campus["program_name"], program_campus["campus_name"],
        )
        return 0, 0

    existing = _get_existing_capacity_record(program_campus["program_campus_id"])
    # Comparaison sur l'entrée la plus récente : le diff protège d'un ticket
    # inutile quand rien n'a bougé, l'admin arbitre le détail.
    latest = max(
        (c for c in capacities if isinstance(c, dict)),
        key=lambda c: c.get("academic_year") or 0,
        default=None,
    )
    if latest is None:
        return 0, 0
    if not has_data_changed(latest, existing, DB_FIELDS_BY_CATEGORY["Capacity"]):
        logger.info(
            "➖ Capacity inchangée pour %s @ %s",
            program_campus["program_name"], program_campus["campus_name"],
        )
        return 0, 1

    payload: dict[str, Any] = dict(extracted)
    payload["year_assumed"] = any(
        bool(c.get("year_assumed")) for c in capacities if isinstance(c, dict)
    )

    _insert_ticket(
        category="Capacity",
        school_id=school_id,
        campus_id=program_campus["campus_id"],
        program_id=program_campus["program_id"],
        program_campus_id=program_campus["program_campus_id"],
        payload=payload,
        source_urls=source_urls,
        raw_report=raw_report,
        official_domain=official_domain,
    )
    logger.info(
        "🎟️ Capacity : %d voie(s) d'admission → 1 ticket pour %s @ %s",
        len(capacities), program_campus["program_name"], program_campus["campus_name"],
    )
    return 1, 0
