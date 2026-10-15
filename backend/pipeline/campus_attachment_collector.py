"""
backend/pipeline/campus_attachment_collector.py — La collecte « ou se deroule ce programme », branchee

Ce module enchaine ce que `campus_attachment.py` et `attachment_plan.py`
decident sans rien appeler : lire les pages d'une ecole, en tirer les lignes,
les confronter a la base, et — seulement s'il y a quelque chose a ecrire —
deposer UN ticket `Program_Discovery` portant `campus_attachments` dans la zone
tampon, en `Pending_Admin`. Rien n'est ecrit dans les tables de production :
c'est `PUT /api/admin/inbox/[id]/attachments`, derriere la validation admin,
qui ecrit.

Deux appelants, un seul chemin :

  * `backend/scripts/simulate_campus_attachment.py` — la sortie seche, qui
    ecrit un JSON ;
  * `phase1_research.run_phase1_research()` — la Phase 1, par
    `run_campus_attachment_step()`.

## Les appels reseau sont injectes

`CollectorIO` est tout ce que la chaine sait du reseau : trouver la page
catalogue, cartographier, lire des pages, extraire. `LiveCollectorIO` parle a
Tavily et a Gemini. `CachedCollectorIO` rejoue les reponses deja obtenues avec
les MEMES cles de cache que la sortie seche du 4 septembre — et, en mode
`cache_only`, leve `CacheMiss` plutot que de payer un appel. C'est ce qui rend
la Phase 1 prouvable sur le cache, et non seulement la sortie seche.

## La liste des campus vient de la table `Campus`

`SchoolSnapshot` porte les campus, programmes, aretes, lignes-annees et notes
d'une ecole, lus en base (`read_school_snapshot`, psycopg2) ou dans le dump
lecture seule de `scripts/dump-program-identity.ts` (`snapshot_from_dump`).
La liste passee a `build_rows()` en sort, nom pour nom.

## Les trois refus avant toute depense

`run_campus_attachment_step()` ne consomme ni credit Tavily ni appel Gemini
quand l'ecole n'a aucun `Program` en base (EMLV, Essec : l'appariement n'a rien
sur quoi s'appuyer), aucun `Campus`, ou aucune page catalogue. Et une collecte
qui ne rend aucune ligne, ou dont le plan n'a rien a creer ni a mettre a jour,
n'emet AUCUN ticket : c'est la garde contre l'inondation de l'Inbox.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Protocol
from urllib.parse import urlparse

from backend.pipeline.attachment_plan import (
    build_attachment_claims,
    build_policy_note_claims,
    plan_ticket_writes,
)
from backend.pipeline.campus_attachment import build_rows
from backend.pipeline.ticket_sources import select_ticket_sources

logger = logging.getLogger("pipeline.campus_attachment_collector")

CATEGORY = "Campus_Attachment"
TICKET_CATEGORY = "Program_Discovery"

# Reglages de la collecte du 4 septembre, que le cache reproduit : 24 fiches
# au plus, trois par appel Gemini, pages tronquees a 60 000 caracteres.
DEFAULT_FICHE_LIMIT = 24
DEFAULT_BATCH_SIZE = 3
DEFAULT_PAGE_CHARS = 60000

# Consigne de cartographie. Sans elle, /map suit surtout la navigation : la
# campagne du 3 septembre a obtenu 48 URL avec, et 2 sans, sur la meme racine.
MAP_INSTRUCTIONS = (
    "Find every individual degree programme page (fiche formation): bachelor, "
    "BBA, master, MSc, MS, MBA, PGE, doctorate. Follow the programme catalogue "
    "listing pages."
)

# Segments qui trahissent une page qui n'est pas une fiche formation. La
# formation continue est le gros du bruit : 19 des 28 URL de la facette Le
# Havre sont des sessions datees, sans encart Niveau/Campus/Rythme.
_NON_PROGRAM_PATTERNS = (
    re.compile(r"/(actualites?|news|news-entreprise|blog|events?|agenda|presse|press)(/|$)"),
    re.compile(r"/(mentions-legales|cookies|plan-du-site|contact|rgpd)(/|$)"),
    re.compile(r"/(admissions?|candidater|financement|logement|vie-etudiante)(/|$)"),
    re.compile(r"/(formation-continue|executive-education|entreprises)(/|$)"),
    # Em Lyon publie sous /guides/ des pages de conseil (« Quelle difference
    # entre bachelor et licence ? ») qui portent le vocabulaire des diplomes
    # sans en etre.
    re.compile(r"/guides?(/|$)"),
    re.compile(r"/(classement|accreditation|annuaire)[^/]*(/|$)"),
    re.compile(r"\.(pdf|jpe?g|png|gif|svg|zip|docx?)(/|$)"),
)

# Tavily rend au plus 5 URL par /extract (backend/tavily_service/client.py).
EXTRACT_BATCH = 5


# ── Les appels reseau ─────────────────────────────────────────────


class CacheMiss(Exception):
    """
    Une reponse absente du cache, en mode `cache_only`.

    Volontairement PAS une RuntimeError : `run_extraction` avale les erreurs
    d'extraction pour continuer le lot suivant, et un rejeu sur cache ne doit
    jamais se terminer « avec succes » sur une reponse qu'il n'a pas.
    """

    def __init__(self, kind: str, key: str):
        super().__init__(f"absent du cache : {kind} ({key[:120]})")
        self.kind = kind
        self.key = key


class CollectorIO(Protocol):
    """Tout ce que la collecte sait du reseau."""

    def find_catalog_pages(self, school_name: str, domain: str) -> tuple[list[str], int]: ...

    def map_pages(self, root_url: str) -> tuple[list[str], int]: ...

    def extract(self, urls: list[str]) -> str: ...

    def extract_statements(self, urls: list[str], source_text: str) -> dict: ...


class LiveCollectorIO:
    """Tavily et Gemini, pour de vrai. Chaque appel coute."""

    def __init__(self, key_manager):
        self.key_manager = key_manager

    def find_catalog_pages(self, school_name: str, domain: str) -> tuple[list[str], int]:
        from backend.tavily_service.catalog_client import find_catalog_pages

        return find_catalog_pages(school_name, domain, self.key_manager)

    def map_pages(self, root_url: str) -> tuple[list[str], int]:
        from backend.tavily_service.client import map_program_pages

        return map_program_pages(root_url, self.key_manager, instructions=MAP_INSTRUCTIONS)

    def extract(self, urls: list[str]) -> str:
        from backend.tavily_service.client import TavilyRequestError, extract_from_urls

        # extract_from_urls leve sur une panne depuis le 14 octobre 2026 (elle
        # rendait ""). La collecte garde sa tolerance : un lot en panne vaut un
        # lot vide, la passe continue ; seul un quota epuise l'arrete.
        try:
            return extract_from_urls(urls, self.key_manager)
        except TavilyRequestError as exc:
            logger.warning("⚠️ Lot de fiches non lu (%d URL) : %s", len(urls), exc)
            return ""

    def extract_statements(self, urls: list[str], source_text: str) -> dict:
        from backend.ai.extraction_prompts import get_extraction_prompt
        from backend.ai.extraction_schemas import get_extraction_schema, get_min_tier
        from backend.ai.gemini_client import extract_structured

        return extract_structured(
            system_prompt=get_extraction_prompt(CATEGORY),
            source_text=source_text,
            json_schema=get_extraction_schema(CATEGORY),
            min_tier=get_min_tier(CATEGORY),
        )


def _cache_path(cache_dir: str, kind: str, key: str) -> str:
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(cache_dir, f"{kind}-{digest}.json")


def _is_worth_caching(kind: str, value: Any) -> bool:
    """
    Une reponse VIDE ne se met pas en cache.

    Mesure du 4 septembre : un /map sur une cle presque epuisee est revenu avec
    0 URL et 0 credit, sans lever. Mis en cache, ce vide devient permanent et
    tous les passages suivants repartent de rien — une panne d'un instant se
    transforme en resultat stable et faux. Seul le succes est memorise.
    """
    if kind in ("map", "search"):
        return bool(value) and bool(value[0])
    if kind == "extract":
        return bool(value and str(value).strip())
    if kind == "gemini":
        return bool(isinstance(value, dict) and value.get("statements"))
    return True


@dataclass
class CachedCollectorIO:
    """
    Rejoue une reponse deja obtenue plutot que de la repayer.

    Les cles sont celles de la sortie seche du 4 septembre — `catalog::`,
    `map::`, `extract::`, `gemini::` suivis des URL — et les valeurs sont
    stockees sous la meme forme. `tmp/dry-cache/` est donc lu tel quel.

    `inner` absent ou `cache_only` : un appel absent du cache leve `CacheMiss`.
    """

    cache_dir: str
    inner: Optional[CollectorIO] = None
    cache_only: bool = False
    calls: dict[str, dict[str, int]] = field(default_factory=dict)

    def _count(self, kind: str, origin: str, credits: int = 0) -> None:
        entry = self.calls.setdefault(kind, {"cached": 0, "live": 0})
        entry[origin] += 1
        if credits:
            # Le cout d'origine d'une reponse rejouee reste consigne ici : c'est
            # la mesure qui sert a estimer une vraie passe.
            entry[f"{origin}_credits"] = entry.get(f"{origin}_credits", 0) + credits

    def _cached(self, kind: str, key: str, producer: Callable[[CollectorIO], Any]) -> tuple[Any, bool]:
        path = _cache_path(self.cache_dir, kind, key)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                logger.info("♻️ Cache: %s (%s)", kind, key[:90])
                return json.load(handle), True
        if self.cache_only or self.inner is None:
            raise CacheMiss(kind, key)
        value = producer(self.inner)
        os.makedirs(self.cache_dir, exist_ok=True)
        if _is_worth_caching(kind, value):
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
        else:
            logger.warning("⚠️ Reponse vide non mise en cache : %s (%s)", kind, key[:90])
        return value, False

    def _credited(self, kind: str, key: str, producer: Callable[[CollectorIO], Any]) -> tuple[list[str], int]:
        """
        /search et /map rendent `(URL, credits)`. Une reponse rejouee coute ZERO
        a ce passage : `tavily_credits_this_run` compte ce qui a ete depense,
        comme avant l'extraction de ce module.
        """
        value, from_cache = self._cached(kind, key, producer)
        urls, credits = list(value[0]), int(value[1])
        self._count(kind, "cached" if from_cache else "live", credits)
        return urls, 0 if from_cache else credits

    def find_catalog_pages(self, school_name: str, domain: str) -> tuple[list[str], int]:
        return self._credited(
            "search",
            f"catalog::{domain}",
            lambda io: list(io.find_catalog_pages(school_name, domain)),
        )

    def map_pages(self, root_url: str) -> tuple[list[str], int]:
        return self._credited("map", f"map::{root_url}", lambda io: list(io.map_pages(root_url)))

    def extract(self, urls: list[str]) -> str:
        value, from_cache = self._cached("extract", "extract::" + "|".join(urls), lambda io: io.extract(urls))
        self._count("extract", "cached" if from_cache else "live")
        return value

    def extract_statements(self, urls: list[str], source_text: str) -> dict:
        value, from_cache = self._cached(
            "gemini",
            "gemini::" + "|".join(urls),
            lambda io: io.extract_statements(urls, source_text),
        )
        self._count("gemini", "cached" if from_cache else "live")
        return value


# ── La collecte ───────────────────────────────────────────────────


def looks_like_program_page(
    url: str, catalog_path: str, path_prefix: Optional[str] = None
) -> bool:
    """
    Vrai si l'URL ressemble a une fiche formation.

    Le filtre est volontairement grossier : ecarter une vraie fiche coute une
    ligne manquante et se voit, garder une page de rubrique coute une ligne
    fausse et ne se voit pas.

    Il ne peut PAS exiger que l'URL descende de la page catalogue. EM Normandie
    range ses fiches sous sa page d'index (/programmes → /programmes/...), mais
    Em Lyon range son index en /fr/nos-programmes et ses fiches ailleurs, en
    /fr/etudiant/mastere-specialise/... Exiger le prefixe rejetterait la
    totalite d'une ecole sur deux. C'est /map, enracine sur le catalogue, qui
    borne la recolte ; ce filtre ne fait qu'oter le bruit connu. `path_prefix`
    reste disponible quand l'operateur veut resserrer.
    """
    parsed = urlparse(url)
    path = (parsed.path or "").lower().rstrip("/")
    if not path:
        return False
    if any(pattern.search(path + "/") for pattern in _NON_PROGRAM_PATTERNS):
        return False
    if path_prefix and not path.startswith(path_prefix.lower().rstrip("/")):
        return False
    # La page d'index elle-meme n'est pas une fiche ; elle est lue a part.
    return path != (catalog_path or "").lower().rstrip("/")


def discover_urls(
    io: CollectorIO,
    school_name: str,
    domain: str,
    catalog_url: Optional[str] = None,
    path_prefix: Optional[str] = None,
) -> tuple[list[str], list[str], int]:
    """Rend (pages d'index, fiches candidates, credits de /search et /map)."""
    credits = 0
    if catalog_url:
        index_pages = [catalog_url]
    else:
        index_pages, search_credits = io.find_catalog_pages(school_name, domain)
        credits += search_credits

    if not index_pages:
        logger.error("❌ Aucune page catalogue pour %s — rien a cartographier", domain)
        return [], [], credits

    catalog_path = urlparse(index_pages[0]).path or "/"
    mapped: list[str] = []
    for page in index_pages:
        urls, map_credits = io.map_pages(page)
        credits += map_credits
        mapped.extend(urls)

    fiches = sorted({u for u in mapped if looks_like_program_page(u, catalog_path, path_prefix)})
    logger.info("🗺️ %d URL cartographiees, %d retenues comme fiches", len(mapped), len(fiches))
    return list(index_pages), fiches, credits


def extract_pages(io: CollectorIO, urls: list[str]) -> dict[str, str]:
    """Lit les pages par lots de 5 et rend {url: markdown}."""
    pages: dict[str, str] = {}
    for start in range(0, len(urls), EXTRACT_BATCH):
        batch = urls[start : start + EXTRACT_BATCH]
        content = io.extract(batch)
        if not content:
            logger.warning("⚠️ Lot vide : %s", batch)
            continue
        # extract_from_urls consolide avec « ## Source: <url> ». On redecoupe
        # pour garder l'appariement page <-> contenu, que le modele doit voir.
        for chunk in content.split("\n\n---\n\n"):
            head, _, body = chunk.partition("\n\n")
            url = head.replace("## Source:", "").strip()
            if url and body.strip():
                pages[url] = body
    return pages


def run_extraction(
    io: CollectorIO,
    pages: dict[str, str],
    batch_size: int,
    page_chars: int,
) -> tuple[dict, list[dict]]:
    """
    Groupe les fiches et les passe a Gemini.

    Le groupage n'est pas une optimisation de confort : le portillon global de
    gemini_client espace les appels de 12 s (5 RPM sur la cle). Cinquante
    fiches une par une, c'est dix minutes d'attente pure.
    """
    from backend.ai.gemini_client import GeminiError

    merged: dict = {"statements": [], "policies": []}
    failures: list[dict] = []
    urls = sorted(pages)
    batches = (len(urls) + batch_size - 1) // batch_size

    for start in range(0, len(urls), batch_size):
        batch = urls[start : start + batch_size]
        source = "\n\n---\n\n".join(
            f"## Source: {url}\n\n{pages[url][:page_chars]}" for url in batch
        )
        logger.info(
            "🧠 Lot %d/%d — %d fiche(s), %d caracteres",
            start // batch_size + 1, batches, len(batch), len(source),
        )
        try:
            payload = io.extract_statements(batch, source)
        except (GeminiError, RuntimeError, ValueError, OSError) as exc:
            logger.error("❌ Extraction ratee sur %s : %s", batch, exc)
            failures.append({"urls": batch, "error": str(exc)[:400]})
            continue

        if isinstance(payload, dict):
            merged["statements"].extend(payload.get("statements") or [])
            merged["policies"].extend(payload.get("policies") or [])

    return merged, failures


def collect_campus_rows(
    io: CollectorIO,
    *,
    school_name: str,
    domain: str,
    campuses: list[str],
    catalog_url: Optional[str] = None,
    include_urls: tuple[str, ...] | list[str] = (),
    path_prefix: Optional[str] = None,
    limit: int = DEFAULT_FICHE_LIMIT,
    batch_size: int = DEFAULT_BATCH_SIZE,
    page_chars: int = DEFAULT_PAGE_CHARS,
    read_index: bool = True,
    page_guards: bool = True,
) -> dict:
    """
    Pages lues -> lignes des trois tables, pour une ecole. N'ecrit rien.

    `campuses` : les noms de la table `Campus`, tels quels.
    """
    index_pages, fiches, credits = discover_urls(io, school_name, domain, catalog_url, path_prefix)

    forced = [u for u in include_urls if u not in fiches]
    selected = forced + [u for u in fiches if u not in include_urls]
    selected = selected[:limit]

    to_read = list(selected)
    if read_index:
        to_read = index_pages + to_read

    logger.info("📥 Lecture de %d page(s) (%d index)", len(to_read), len(index_pages) if read_index else 0)
    pages = extract_pages(io, to_read)
    logger.info("📄 %d page(s) rendues", len(pages))

    raw, failures = run_extraction(io, pages, batch_size, page_chars)
    rows = build_rows(raw, campuses, pages=pages if page_guards else None)

    rows["run"] = {
        "school": school_name,
        "domain": domain,
        "campuses_argument": list(campuses),
        "index_pages": index_pages,
        "pages_read": sorted(pages),
        "pages_requested": to_read,
        "tavily_credits_this_run": credits,
        "page_guards": page_guards,
        "extraction_failures": failures,
        "wrote_to_database": False,
    }
    return rows


# ── L'etat de la base, pour une ecole ─────────────────────────────


@dataclass
class SchoolSnapshot:
    """
    Ce que la base porte pour une ecole, et seulement ce que la collecte lit.

    `programs` : dicts `{id, name, campus_policy_note}`
    `campuses` : dicts `{id, name}`
    `edges`    : dicts `{id, programId, campusId}` — les `ProgramCampus`
    `attachments` : dicts `{id, programCampusId, study_year, regime, languages,
                    note, source_url}` — les `ProgramCampusAttachment`
    """

    school_id: str
    name: str
    official_domain: str
    campuses: list[dict] = field(default_factory=list)
    programs: list[dict] = field(default_factory=list)
    edges: list[dict] = field(default_factory=list)
    attachments: list[dict] = field(default_factory=list)

    @property
    def campus_names(self) -> list[str]:
        return [c["name"] for c in self.campuses]


def snapshot_from_dump(dump: list[dict], school_name: str) -> SchoolSnapshot:
    """
    Instantane tire du JSON de `scripts/dump-program-identity.ts`.

    C'est « la base » vue depuis un poste ou le port 5432 est coupe : le dump
    est lu en WebSocket par Prisma, en lecture seule.
    """
    for school in dump:
        if school.get("name") == school_name:
            return SchoolSnapshot(
                school_id=school["id"],
                name=school["name"],
                official_domain=school.get("official_domain") or "",
                campuses=[{"id": c["id"], "name": c["name"]} for c in school.get("campuses") or []],
                programs=[
                    {"id": p["id"], "name": p["name"], "campus_policy_note": p.get("campus_policy_note")}
                    for p in school.get("programs") or []
                ],
                edges=list(school.get("edges") or []),
                attachments=list(school.get("attachments") or []),
            )
    known = ", ".join(sorted(s.get("name", "?") for s in dump))
    raise KeyError(f"Ecole absente du dump : {school_name!r}. Presentes : {known}")


def read_school_snapshot(cur, school_id: str) -> Optional[SchoolSnapshot]:
    """
    Instantane lu en base, curseur psycopg2 `RealDictCursor`. LECTURE SEULE.

    Cinq SELECT ; les aretes et les lignes-annees sont bornees a l'ecole par
    leur programme.
    """
    cur.execute('SELECT id, name, official_domain FROM "School" WHERE id = %s', (school_id,))
    school = cur.fetchone()
    if not school:
        return None
    cur.execute('SELECT id, name FROM "Campus" WHERE "schoolId" = %s ORDER BY name', (school_id,))
    campuses = [dict(r) for r in cur.fetchall()]
    cur.execute(
        'SELECT id, name, campus_policy_note FROM "Program" WHERE "schoolId" = %s ORDER BY name',
        (school_id,),
    )
    programs = [dict(r) for r in cur.fetchall()]
    cur.execute(
        'SELECT pc.id, pc."programId", pc."campusId" FROM "ProgramCampus" pc '
        'JOIN "Program" p ON p.id = pc."programId" WHERE p."schoolId" = %s',
        (school_id,),
    )
    edges = [dict(r) for r in cur.fetchall()]
    cur.execute(
        'SELECT a.id, a."programCampusId", a.study_year, a.regime, a.languages, a.note, a.source_url '
        'FROM "ProgramCampusAttachment" a '
        'JOIN "ProgramCampus" pc ON pc.id = a."programCampusId" '
        'JOIN "Program" p ON p.id = pc."programId" WHERE p."schoolId" = %s',
        (school_id,),
    )
    attachments = [dict(r) for r in cur.fetchall()]
    return SchoolSnapshot(
        school_id=school["id"],
        name=school["name"],
        official_domain=school["official_domain"] or "",
        campuses=campuses,
        programs=programs,
        edges=edges,
        attachments=attachments,
    )


def insert_attachment_ticket(conn, school_id: str, payload: dict, urls: list[str]) -> str:
    """
    Depose le ticket dans la zone tampon, en `Pending_Admin`. Rien d'autre.

    Meme forme que le ticket de decouverte de la Phase 1 : c'est sa CHARGE qui
    l'oriente — `campus_attachments` va a la route voisine, jamais a la
    validation `Program_Discovery`, qui la refuse.
    """
    from backend.constants import SOURCE_AUTOMATED_AI, STATUS_PENDING_ADMIN

    inbox_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "ContributionInbox"
                (id, source_type, "schoolId", ai_category, ai_extracted_json,
                 status, urls, "createdAt")
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                inbox_id,
                SOURCE_AUTOMATED_AI,
                school_id,
                TICKET_CATEGORY,
                json.dumps(payload, ensure_ascii=False),
                STATUS_PENDING_ADMIN,
                urls,
                datetime.now(timezone.utc),
            ),
        )
    return inbox_id


# ── Le pas de Phase 1 ─────────────────────────────────────────────


def run_campus_attachment_step(
    snapshot: SchoolSnapshot,
    io: CollectorIO,
    index_pages: list[str],
    emit_ticket: Callable[[dict, list[str]], str],
    progress: Optional[Callable[[str], None]] = None,
    limit: int = DEFAULT_FICHE_LIMIT,
    batch_size: int = DEFAULT_BATCH_SIZE,
    page_chars: int = DEFAULT_PAGE_CHARS,
    include_urls: tuple[str, ...] | list[str] = (),
) -> dict:
    """
    Collecte, confronte a la base, et depose au plus UN ticket.

    `include_urls` : fiches lues meme absentes de /map. La Phase 1 n'en passe
    aucune ; le rejeu sur cache s'en sert pour reproduire les lots exacts d'une
    collecte qui en avait force une.

    Rend un resume, jamais une exception de sa propre logique : l'appelant
    (la Phase 1) ne doit pas echouer sur ce pas. `status` vaut :

      * `skipped`        — aucune depense : pas de Program, pas de Campus, ou
                           pas de page catalogue (`reason` dit laquelle) ;
      * `no_rows`        — la collecte n'a rendu aucune ligne ecrivable ;
      * `no_change`      — des lignes, mais le plan n'a rien a creer ni a
                           mettre a jour : aucun ticket ;
      * `ticket_emitted` — `ticket_id` est le ticket depose.

    La garde contre l'inondation est le plan lui-meme : `create + update > 0`,
    sur les lignes-annees ET sur les notes que ce ticket ecrirait.
    """
    base = {"ticket_id": None, "school": snapshot.name}

    # Les trois refus avant toute depense, dans cet ordre.
    if not snapshot.programs:
        return {**base, "status": "skipped", "reason": "no_program_in_db"}
    if not snapshot.campuses:
        return {**base, "status": "skipped", "reason": "no_campus_in_db"}
    if not index_pages:
        return {**base, "status": "skipped", "reason": "no_catalog_page"}

    if progress:
        progress("Rattachement campus : lecture des fiches")
    rows = collect_campus_rows(
        io,
        school_name=snapshot.name,
        domain=snapshot.official_domain,
        campuses=snapshot.campus_names,
        # La page catalogue la mieux classee, seule : /map enracine sur une
        # page est la seule configuration mesuree, et chaque racine de plus
        # coute une cartographie de plus.
        catalog_url=index_pages[0],
        include_urls=include_urls,
        limit=limit,
        batch_size=batch_size,
        page_chars=page_chars,
    )

    fiches = rows.get("programs") or []
    claims, unresolved = build_attachment_claims(fiches, snapshot)
    notes, unresolved_notes = build_policy_note_claims(fiches, snapshot)
    plan = plan_ticket_writes(
        {"campus_attachments": claims, "campus_policy_notes": notes}, snapshot
    )

    summary = {
        **base,
        "totals": rows.get("totals"),
        "claims": len(claims),
        "policy_notes": len(notes),
        "unresolved_claims": len(unresolved),
        "plan": plan["counts"],
        "extraction_failures": len(rows["run"]["extraction_failures"]),
        "pages_read": len(rows["run"]["pages_read"]),
        "tavily_credits_search_map": rows["run"]["tavily_credits_this_run"],
    }

    if not claims and not notes:
        return {**summary, "status": "no_rows"}
    if plan["writes"] == 0:
        return {**summary, "status": "no_change"}

    if progress:
        progress("Rattachement campus : depot du ticket")
    fiche_urls = sorted(
        {c["source_url"] for c in claims if c.get("source_url")}
    ) or list(index_pages)
    payload = {
        "campus_attachments": claims,
        "campus_policy_notes": notes,
        "collector": {
            "school": snapshot.name,
            "index_pages": rows["run"]["index_pages"],
            "pages_read": len(rows["run"]["pages_read"]),
            "totals": rows.get("totals"),
            "plan_at_collection": plan["counts"],
            "unresolved_claims": unresolved,
            "unresolved_policy_notes": unresolved_notes,
            "campus_key_collisions": rows.get("campus_key_collisions") or {},
            # ProgramPlacement n'a pas de chemin d'ecriture : ses lignes sont
            # comptees pour l'admin, pas proposees.
            "placements_not_written": (rows.get("totals") or {}).get("program_placement", 0),
            "extraction_failures": rows["run"]["extraction_failures"],
        },
    }
    # Trois liens au plus (ticket_sources.py) : les fiches citees par les
    # lignes, dans l'ordre des lignes, puis le domaine officiel. Pas de place
    # reservee a la page catalogue ici (decision du proprietaire du 15 octobre
    # 2026) ; chaque ligne garde son `source_url` dans la charge.
    urls = select_ticket_sources(fiche_urls, payload, official_domain=snapshot.official_domain)
    ticket_id = emit_ticket(payload, urls)
    logger.info(
        "🧭 Rattachement campus de %s : ticket %s (%s)",
        snapshot.name, ticket_id, plan["counts"],
    )
    return {**summary, "status": "ticket_emitted", "ticket_id": ticket_id}
