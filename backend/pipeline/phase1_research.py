"""
backend/pipeline/phase1_research.py — Phase 1 : Cartographie via Tavily Research

Séquence :
  1. Lire l'école en BDD (official_domain, status)
  2. Passe catalogue — localiser puis lire la page des formations de l'école
  3. Tavily Research, SANS output_schema, avec le prompt et include_domains du dépôt
  4. Extraction Gemini du rapport, ancrée sur le catalogue quand il existe
  5. Contrôles, puis insertion dans ContributionInbox (Pending_Admin)

## Ce qui a changé, et ce qui n'a surtout PAS changé

La Phase 1 souffrait de la même cause que la Phase 2 — `output_schema` — mais
d'une manière différente, et c'est le principal piège de ce chantier. Ici le
schéma ne réduisait pas le NOMBRE de campus trouvés : il en vidait le contenu.
Sur douze programmes découverts, **zéro champ qualitatif rempli** — aucun
concours d'admission, aucune alternance, aucune expatriation. L'agent remplissait
le `name` exigé par `required`, le contrat était honoré, il passait au campus
suivant. Sans le schéma, le même prompt en remplit neuf sur dix-sept.

**Une seule ligne a été supprimée de l'appel.** Tout le reste est conservé, et
ce n'est pas de la prudence, c'est mesuré :

  - `build_phase1_research_input` reste tel quel. Comparé à un brief en langage
    naturel sur la même école, le prompt du dépôt sort des intitulés plus
    propres ; le brief naturel produit trois entrées pour un même programme.
  - `include_domains` reste posé — l'inverse exact de la Phase 2. Avec le
    filtre, la variante saine atteint 7 domaines dont 4 tiers (Campus France,
    concours-sesame.net) ; sans lui, elle retombe à 3 domaines maison et perd la
    TOTALITÉ des `admission_exam`. Pour cartographier une école, le filtre
    oriente vers le bon endroit.

## L'ancrage catalogue

Aucune variante Research n'atteint les 16 formations du catalogue d'EM
Normandie ; la meilleure en rend 10. Ce plafond n'est pas un problème de schéma
ni de modèle, c'est un problème d'outil : la liste des formations d'une école
tient sur une page, et un agent qui la reconstitue par synthèse fera toujours
moins bien que la page elle-même.

D'où une passe /search + /extract en amont (backend/tavily_service/catalog_client.py),
dont les intitulés deviennent la liste de référence du prompt d'extraction.
Research ne sert plus alors qu'à ce que le catalogue tait : sur quels campus
chaque formation est enseignée, par quel concours on y entre, alternance et
expatriation.

**L'ancrage est un bonus, jamais une dépendance dure.** Localiser
automatiquement la page catalogue n'est pas un problème résolu, et c'est le seul
point du dossier mesuré sur une seule école. Pas de catalogue trouvé, pas
d'ancrage : on garde le rapport seul, qui reste très supérieur à l'existant.

## Les garde-fous ajoutés

Sous `output_schema`, deux dégâts passaient la validation :
  - des libellés de rubrique — « Bachelor's programmes », « MBA programmes » —
    partaient en lignes `Program` permanentes via l'upsert de la route de
    validation, et rien ne venait les nettoyer ;
  - Dubaï et Ho Chi Minh City sortaient avec `programs: []`, ce qui satisfaisait
    `required: ["name", "programs"]` et franchissait un contrôle qui ne
    vérifiait que la présence de `discovered_campuses`.
Les deux sont désormais refusés ici, après extraction.

**Ne juge pas cette phase au nombre de campus.** Le pipeline cassé en trouve 7,
autant que les variantes saines — et il en invente un. Le nombre ne mesure rien.
Ce qui compte : les champs qualitatifs remplis et la conformité des intitulés au
catalogue.

## Le rattachement campus, après la découverte

Le rapport Research ne dit pas quelle formation est enseignée sur quel campus :
cette donnée vit dans l'encart des fiches du site. `run_phase1_research()` peut
donc lancer, après la découverte et quel qu'en soit le sort, la collecte de
`backend/pipeline/campus_attachment_collector.py` : /map enraciné sur la page
catalogue trouvée plus haut, /extract des fiches, extraction Gemini, lignes
confrontées aux `Program`, `Campus` et arêtes RÉELS de l'école.

**Par défaut, elle ne tourne pas.** Elle coûte 15 à 17 crédits Tavily et
9 appels Gemini par école, y compris là où elle ne produit rien (Em Lyon ne
publie aucune ligne-année, EM Strasbourg aucun lieu). L'admin l'active pour une
passe précise, sur une école précise, par la case de l'écran qui déclenche la
Phase 1 : `collect_campus_attachments` descend de la requête jusqu'ici. Le cron
`phase1_scanner` et `trigger-scan` ne l'activent jamais. Désactivée, elle
n'émet aucun appel et le résultat le dit : `campus_attachments` vaut
`{"status": "disabled"}`.

Elle produit au plus un ticket `Program_Discovery` portant `campus_attachments`,
en `Pending_Admin` : rien n'est écrit sans validation admin. Et ce ticket n'est
déposé que si le plan de la route a quelque chose à créer ou à mettre à jour —
une école déjà à jour ne remplit pas l'Inbox à chaque passe. Elle ne dépense
rien quand l'école n'a aucun `Program` en base (EMLV, Essec), aucun `Campus`,
ou aucune page catalogue. Son échec ne fait jamais échouer la Phase 1 : il
remonte dans `campus_attachments` du résultat.

Référence : dossier « Le rapport avant le schéma », sections 03, 04 et 11.
"""

import logging
import re
import unicodedata
import uuid
import json
from datetime import datetime, timezone
from typing import Callable

import psycopg2
import psycopg2.extras

from backend.ai.gemini_client import ExtractionUnavailable, GeminiError, extract_structured
from backend.ai.extraction_prompts import (
    CATALOG_EXTRACTION_PROMPT,
    get_extraction_prompt,
    with_catalog_anchor,
)
from backend.ai.extraction_schemas import (
    CATALOG_EXTRACTION_SCHEMA,
    get_extraction_schema,
    get_min_tier,
)
from backend.ai.research_prompts import build_phase1_research_input
from backend.tavily_service.catalog_client import fetch_catalog
from backend.tavily_service.research_client import create_research_task

logger = logging.getLogger("pipeline.phase1_research")

CATEGORY = "Program_Discovery"

# Libellés de rubrique observés en sortie sous output_schema. Ce ne sont pas des
# formations, ce sont des entrées de menu — et la route de validation les
# `upsert` sur schoolId_name, ce qui les installe définitivement dans la table
# Program. Le prompt d'extraction les interdit déjà ; ce filtre est la seconde
# ligne de défense, celle qui ne dépend pas du bon vouloir d'un modèle.
_GENERIC_LABEL_PATTERNS = (
    # Le `(\s*s)?` couvre « Bachelor's programmes » comme « Bachelors
    # programmes » : _normalize() a déjà remplacé l'apostrophe par une espace,
    # et un motif écrit en `('s)?` ne reconnaissait plus le libellé exact
    # observé en production.
    re.compile(r"^(nos|our|les|the)?\s*(bachelor|master|mba|msc|ms|mastere|mastère|licence|doctorat|phd)(\s*s)?\s*(programmes?|programs?|degrees?|formations?|cursus)$"),
    re.compile(r"^(toutes?\s+)?(nos|les)\s+(formations?|programmes?|cursus|diplomes?|diplômes?)$"),
    re.compile(r"^(all\s+)?(our\s+)?(programmes?|programs?|courses?|formations?|degrees?)$"),
    re.compile(r"^(executive\s+education|formation\s+continue|vie\s+etudiante|vie\s+étudiante)$"),
    re.compile(r"^(par|by)\s+(niveau|level|domaine|discipline)$"),
)


def _normalize(text: str | None) -> str:
    """Minuscules sans accents ni ponctuation — pour comparer des intitulés."""
    stripped = unicodedata.normalize("NFD", text or "")
    stripped = "".join(c for c in stripped if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", stripped.lower()).strip()


def _is_generic_label(name: str) -> bool:
    """Vrai si l'intitulé est une rubrique de menu et non une formation."""
    normalized = _normalize(name)
    if not normalized or len(normalized) < 3:
        return True
    return any(pattern.match(normalized) for pattern in _GENERIC_LABEL_PATTERNS)


def _clean_extracted(extracted: dict) -> tuple[dict, dict]:
    """
    Applique les deux garde-fous après extraction.

    Retourne (données nettoyées, compteurs de rejets). Les compteurs remontent
    dans le résultat de la phase : un rejet silencieux serait pire que le bug
    qu'il corrige.
    """
    campuses = extracted.get("discovered_campuses") or []
    kept_campuses: list[dict] = []
    rejected_labels: list[str] = []
    empty_campuses: list[str] = []

    for campus in campuses:
        if not isinstance(campus, dict) or not campus.get("name"):
            continue

        programs = [
            program
            for program in (campus.get("programs") or [])
            if isinstance(program, dict) and program.get("name")
        ]

        kept_programs = []
        for program in programs:
            if _is_generic_label(program["name"]):
                rejected_labels.append(program["name"])
                continue
            kept_programs.append(program)

        if not kept_programs:
            # `required: ["name", "programs"]` était satisfait par un tableau
            # vide : Dubaï et Ho Chi Minh City passaient la validation sans une
            # seule formation. Un campus sans programme n'est pas un résultat.
            empty_campuses.append(campus["name"])
            continue

        cleaned = dict(campus)
        cleaned["programs"] = kept_programs
        kept_campuses.append(cleaned)

    result = dict(extracted)
    result["discovered_campuses"] = kept_campuses

    counters = {
        # `campuses_seen` compte ce que le modèle a RENDU, avant filtrage. Sans
        # lui, un échec total est indiagnosticable : on ne sait pas distinguer
        # « le rapport ne nommait aucun campus » de « tous les campus ont été
        # écartés faute de formations », qui appellent des corrections opposées.
        "campuses_seen": len(campuses),
        "rejected_generic_labels": rejected_labels,
        "rejected_empty_campuses": empty_campuses,
    }
    if rejected_labels:
        logger.warning(
            "🚮 %d libellé(s) de rubrique écarté(s) : %s",
            len(rejected_labels), rejected_labels,
        )
    if empty_campuses:
        logger.warning(
            "🚮 %d campus sans programme écarté(s) : %s",
            len(empty_campuses), empty_campuses,
        )
    return result, counters


def _extract_catalog_titles(catalog_content: str, school_name: str) -> list[str]:
    """
    Tire les intitulés exacts de la page catalogue.

    Extraction au palier bas : lire une liste publiée ne demande aucun
    arbitrage, et le budget des modèles de tête (20 requêtes par jour) doit
    rester pour le rapport lui-même. Un échec ici n'est pas bloquant — on
    repart sans ancrage.
    """
    try:
        parsed = extract_structured(
            system_prompt=CATALOG_EXTRACTION_PROMPT,
            source_text=catalog_content,
            json_schema=CATALOG_EXTRACTION_SCHEMA,
            min_tier="low",
        )
    except GeminiError as e:
        logger.warning("⚠️ Lecture du catalogue de %s abandonnée : %s", school_name, e)
        return []

    if not isinstance(parsed, dict):
        return []

    titles: list[str] = []
    seen: set[str] = set()
    for program in parsed.get("programs") or []:
        if not isinstance(program, dict):
            continue
        name = (program.get("name") or "").strip()
        if not name or _is_generic_label(name):
            continue
        key = _normalize(name)
        if key in seen:
            continue
        seen.add(key)
        titles.append(name)

    logger.info("📚 Catalogue de %s : %d formation(s) de référence", school_name, len(titles))
    return titles


def run_phase1_research(
    school_id: str,
    key_manager,
    dry_run: bool = False,
    progress_callback: Callable[[dict], None] | None = None,
    collect_campus_attachments: bool = False,
) -> dict:
    """
    Orchestrateur complet de la Phase 1 via Tavily Research pour une école.

    La découverte d'abord, inchangée ; puis le rattachement campus, seulement
    si `collect_campus_attachments` est vrai. Son résumé part dans
    `campus_attachments`, qui vaut `{"status": "disabled"}` quand l'admin ne
    l'a pas demandé : une collecte absente doit se voir dans le résultat du
    job. Le second pas n'est jamais lancé en `dry_run` : il consommerait des
    crédits réels.
    """
    context: dict = {}
    result = _run_program_discovery(school_id, key_manager, dry_run, progress_callback, context)
    if dry_run or "school" not in context:
        return result
    if not collect_campus_attachments:
        result["campus_attachments"] = {"status": "disabled"}
        return result
    result["campus_attachments"] = _run_campus_attachment_step(
        school_id, key_manager, context, progress_callback
    )
    return result


def _run_campus_attachment_step(
    school_id: str,
    key_manager,
    context: dict,
    progress_callback: Callable[[dict], None] | None,
) -> dict:
    """
    Le rattachement campus d'une école : au plus un ticket, jamais d'exception.

    L'état de la base est relu ici, après la découverte : la liste des campus
    passée au collecteur est celle de la table `Campus`, et le plan qui décide
    du dépôt compare aux lignes-années déjà écrites.
    """
    from backend.db import get_db_connection
    from backend.pipeline.campus_attachment_collector import (
        LiveCollectorIO,
        insert_attachment_ticket,
        read_school_snapshot,
        run_campus_attachment_step,
    )

    school_name = context["school"]["name"]

    def progress(action: str) -> None:
        if progress_callback:
            progress_callback({"current_action": action, "school": school_name, "category": CATEGORY})

    def emit(payload: dict, urls: list[str]) -> str:
        with get_db_connection() as conn:
            return insert_attachment_ticket(conn, school_id, payload, urls)

    try:
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                snapshot = read_school_snapshot(cur, school_id)
        if snapshot is None:
            return {"status": "skipped", "reason": "school_not_found", "ticket_id": None}
        return run_campus_attachment_step(
            snapshot,
            LiveCollectorIO(key_manager),
            context.get("catalog_urls") or [],
            emit,
            progress=progress,
        )
    except Exception as e:
        # La découverte a déjà rendu son résultat : ce pas ne doit pas le faire
        # échouer après coup. L'échec est rendu, pas avalé.
        logger.error("❌ Rattachement campus abandonné pour %s : %s", school_name, e)
        return {"status": "failed", "error": str(e)[:400], "ticket_id": None}


def _run_program_discovery(
    school_id: str,
    key_manager,
    dry_run: bool,
    progress_callback: Callable[[dict], None] | None,
    context: dict,
) -> dict:
    """
    La découverte des campus et programmes — la Phase 1 telle qu'elle était.

    `context` reçoit l'école lue en base et les pages catalogue trouvées : le
    rattachement campus en a besoin, et les relire coûterait un /search.
    """
    from backend.db import get_db_connection

    logger.info(f"🚀 [Research] Phase 1 démarrée pour school_id={school_id} (dry_run={dry_run})")

    if progress_callback:
        progress_callback({"current_action": "Lecture de l'école en BDD", "school": school_id, "category": CATEGORY})

    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:

            # ── 1. Lire l'école ───────────────────────────────────
            cur.execute(
                'SELECT id, name, official_domain, status FROM "School" WHERE id = %s',
                (school_id,)
            )
            school = cur.fetchone()

            if not school:
                logger.error(f"❌ École non trouvée: {school_id}")
                return {"success": False, "message": "École non trouvée"}

            if school["status"] != "ACTIVE":
                logger.info(f"⏭️ École non ACTIVE ({school['status']}), skip")
                return {"success": False, "message": f"École non ACTIVE: {school['status']}"}

            school_name = school["name"]
            official_domain = school["official_domain"]
            logger.info(f"📚 École: {school_name} ({official_domain})")
            context["school"] = dict(school)

    # ── 2. Passe catalogue (facultative) ────────────────────────────
    catalog_titles: list[str] = []
    catalog_urls: list[str] = []
    if not dry_run:
        if progress_callback:
            progress_callback({
                "current_action": "Lecture du catalogue des formations",
                "school": school_name,
                "category": CATEGORY,
            })
        catalog = fetch_catalog(school_name, official_domain, key_manager)
        if catalog and catalog.has_content:
            catalog_urls = catalog.urls
            context["catalog_urls"] = list(catalog.urls)
            catalog_titles = _extract_catalog_titles(catalog.content, school_name)
        else:
            logger.info(
                "📭 Pas de catalogue exploitable pour %s — le rapport Research fera seul",
                official_domain,
            )

    # ── 3. Tavily Research ──────────────────────────────────────────
    if progress_callback:
        progress_callback({"current_action": "Recherche Tavily Research en cours...", "school": school_name, "category": CATEGORY})

    query = build_phase1_research_input(school_name, official_domain)

    try:
        # Pas d'output_schema : c'est LA ligne supprimée de ce fichier. Le
        # prompt et include_domains restent — tous deux mesurés bénéfiques.
        research_result = create_research_task(
            query=query,
            key_manager=key_manager,
            include_domains=[official_domain],
            model="pro",
            dry_run=dry_run
        )
    except Exception as e:
        logger.error(f"❌ Échec appel Tavily Research pour {official_domain}: {e}")
        return {"success": False, "message": f"Erreur Tavily Research: {e}"}

    if dry_run:
        return {
            "success": True,
            "message": "[DRY RUN] Tâche simulée avec succès",
            "report": research_result["report"],
            "sources": research_result["sources"]
        }

    # ── 4. Extraction Gemini ────────────────────────────────────────
    if progress_callback:
        progress_callback({"current_action": "Analyse et structuration du résultat", "school": school_name, "category": CATEGORY})

    report_content = research_result.get("report")
    if isinstance(report_content, dict):
        # Ne devrait plus survenir sans output_schema, toléré par prudence.
        report_content = json.dumps(report_content, ensure_ascii=False)
    report_content = report_content or ""

    if not report_content.strip():
        logger.error(f"❌ Rapport Research vide pour {school_name}")
        return {"success": False, "message": "Rapport Tavily Research vide"}

    sources = research_result.get("sources", [])
    source_urls = [s.get("url") for s in sources if s.get("url")]
    logger.info(
        "📄 Rapport Phase 1 : %d caractères, %d sources", len(report_content), len(source_urls)
    )

    try:
        extracted = extract_structured(
            system_prompt=with_catalog_anchor(
                get_extraction_prompt(CATEGORY), catalog_titles
            ),
            source_text=report_content,
            json_schema=get_extraction_schema(CATEGORY),
            min_tier=get_min_tier(CATEGORY),
        )
    except ExtractionUnavailable as e:
        logger.error(f"❌ Extraction indisponible pour {school_name}: {e}")
        return {"success": False, "message": f"Extraction Gemini indisponible: {e}"}
    except GeminiError as e:
        logger.error(f"❌ Extraction échouée pour {school_name}: {e}")
        return {"success": False, "message": f"Extraction Gemini échouée: {e}"}

    if not isinstance(extracted, dict):
        logger.error(f"❌ Extraction Phase 1 : objet attendu, {type(extracted).__name__} reçu")
        return {"success": False, "message": "Extraction Phase 1 de forme inattendue"}

    # ── 5. Garde-fous ───────────────────────────────────────────────
    extracted, rejects = _clean_extracted(extracted)

    if not extracted["discovered_campuses"]:
        # Deux causes très différentes se cachent derrière le même symptôme, et
        # le message doit dire laquelle : soit le rapport ne nommait aucun
        # campus, soit il en nommait sans jamais dire ce qu'on y enseigne — cas
        # observé sur Em Normandie, où l'agent n'avait consulté que les pages de
        # description de campus et le signalait lui-même dans ses evidence gaps.
        if rejects["campuses_seen"]:
            detail = (
                f"{rejects['campuses_seen']} campus trouvés, aucun avec de formation "
                f"rattachée : {rejects['rejected_empty_campuses']}"
            )
        else:
            detail = "le rapport ne nomme aucun campus"
        logger.error("❌ Aucun campus exploitable pour %s — %s", school_name, detail)
        return {
            "success": False,
            "message": f"Aucun campus avec au moins une formation valide — {detail}",
            **rejects,
        }

    # ── 6. INSERT dans ContributionInbox ────────────────────────────
    if progress_callback:
        progress_callback({"current_action": "Insertion dans ContributionInbox", "school": school_name, "category": CATEGORY})

    campuses_count = len(extracted["discovered_campuses"])
    programs_count = sum(
        len(c.get("programs", []))
        for c in extracted["discovered_campuses"]
    )
    # Les champs qualitatifs sont la mesure qui compte : ils sortaient à 0/12
    # sous output_schema, et le nombre de campus ne dit rien de la qualité.
    qualified_programs = sum(
        1
        for campus in extracted["discovered_campuses"]
        for program in campus.get("programs", [])
        if program.get("admission_exam") is not None
        or program.get("is_alternance_possible") is not None
        or program.get("is_expatriation_mandatory") is not None
    )

    inbox_id = str(uuid.uuid4())
    ticket_urls = source_urls or extracted.get("source_urls") or [f"https://{official_domain}"]
    if catalog_urls:
        ticket_urls = list(dict.fromkeys(catalog_urls + list(ticket_urls)))

    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO "ContributionInbox"
                    (id, source_type, "schoolId", ai_category, ai_extracted_json,
                     status, urls, "createdAt", raw_report)
                VALUES (%s, 'Automated_AI', %s, %s, %s,
                        'Pending_Admin', %s, %s, %s)
                """,
                (
                    inbox_id,
                    school_id,
                    CATEGORY,
                    json.dumps(extracted),
                    ticket_urls,
                    datetime.now(timezone.utc),
                    report_content,
                )
            )

    logger.info(
        f"✅ Phase 1 via Research terminée pour {school_name}: "
        f"{campuses_count} campus, {programs_count} programmes "
        f"({qualified_programs} avec au moins un champ qualitatif) → Inbox #{inbox_id[:8]}"
    )

    return {
        "success": True,
        "message": "Ticket Program_Discovery créé via Research (Pending_Admin)",
        "inbox_id": inbox_id,
        "school_name": school_name,
        "campuses_count": campuses_count,
        "programs_count": programs_count,
        "qualified_programs_count": qualified_programs,
        "catalog_titles_count": len(catalog_titles),
        **rejects,
    }
