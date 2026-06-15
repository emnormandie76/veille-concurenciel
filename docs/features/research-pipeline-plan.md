# 📋 Plan d'Implémentation — Refactorisation Pipelines via Tavily Research

> **Version :** 1.0 — 29 mai 2026  
> **Branche :** `devresearch` (créée depuis `dev` @ commit `fc25ead`)  
> **Branche de fallback :** `dev` — Pipelines actuels intacts (crawl+search+Gemma)  
> **Objectif :** Remplacer la chaîne `crawl/search → Gemma 26B (tri) → Gemma 31B (extraction)` par l'endpoint **Tavily Research** qui effectue recherche multi-sources + synthèse en un seul appel.

---

## Table des Matières

1. [Contexte et Motivation](#1-contexte-et-motivation)
2. [Décisions Validées](#2-décisions-validées)
3. [Comprendre Tavily Research](#3-comprendre-tavily-research)
4. [Architecture Comparée (Ancien vs Nouveau)](#4-architecture-comparée)
5. [Fichiers Créés / Modifiés / Intacts](#5-fichiers-créés--modifiés--intacts)
6. [Spécification Détaillée par Module](#6-spécification-détaillée-par-module)
7. [Prompts Dynamiques Complets](#7-prompts-dynamiques-complets)
8. [Schemas JSON (output_schema)](#8-schemas-json-output_schema)
9. [Calcul de l'Année Scolaire Dynamique](#9-calcul-de-lannée-scolaire-dynamique)
10. [Gestion du Coût en Crédits](#10-gestion-du-coût-en-crédits)
11. [Mode Dry Run](#11-mode-dry-run)
12. [Gestion des Erreurs et Edge Cases](#12-gestion-des-erreurs-et-edge-cases)
13. [Plan d'Exécution Séquentiel](#13-plan-dexécution-séquentiel)
14. [Plan de Vérification](#14-plan-de-vérification)
15. [Rollback Strategy](#15-rollback-strategy)

---

## 1. Contexte et Motivation

### Pourquoi changer ?

Les pipelines actuels (Phase 1 et Phase 2) fonctionnent mais souffrent d'**imprécisions structurelles** :

| Problème | Impact |
|---|---|
| **Crawl aveugle** (Phase 1) | `select_paths` statiques (`/formations/.*`) ratent les écoles avec une arborescence non standard |
| **Chaîne de 3 appels** (Phase 2) | Tavily search → Gemma 26B (tri) → Gemma 31B (extraction) : chaque étape peut perdre de l'information |
| **Markdown cassé** (Edge Case 9) | Les tableaux HTML deviennent illisibles en Markdown, Gemma croise les prix |
| **Paywalls non détectés** (Edge Case 11) | Tavily search retourne du contenu bloqué, Gemma tente de l'exploiter |
| **Prompts statiques** | Les requêtes Tavily search sont des templates fixes, pas contextualisés |

### Pourquoi Tavily Research ?

L'endpoint **Research** de Tavily est un agent de recherche autonome qui :
1. **Décompose** automatiquement la question en sous-requêtes
2. **Recherche** sur plusieurs sources en parallèle
3. **Analyse** et croise les sources
4. **Synthétise** un rapport structuré avec citations
5. **Peut forcer un schéma JSON** via `output_schema`

C'est exactement ce qu'on fait manuellement en 3 étapes (search + tri + extraction), mais en mieux et en un seul appel.

---

## 2. Décisions Validées

| Décision | Choix | Raison |
|---|---|---|
| **Modèle Research** | `pro` (15+ crédits/requête) | Meilleure précision, le coût est compensé par la rotation de clés |
| **Workflow asynchrone** | Polling (POST → GET loop) | Simple, compatible APScheduler séquentiel |
| **Année scolaire** | Dynamique basée sur la date système | Toujours cibler N+1 (septembre = pivot) |
| **`output_schema`** | Tester les deux approches | Schema JSON direct si ça marche, fallback Gemma 26B sinon |
| **`include_domains`** | Domaine officiel de l'école uniquement | Soft preference — Tavily trouvera d'autres sources si besoin |
| **Mode dry run** | Oui | Permet de tester sans écrire en BDD |
| **Anciens pipelines** | Conservés intacts | Fallback via `USE_RESEARCH_PIPELINE=false` |
| **`diff.py`** | Réutilisé tel quel | La comparaison vs production reste identique |

---

## 3. Comprendre Tavily Research

### 3.1. Comment ça marche

```
POST https://api.tavily.com/research
{
  "query": "Quels sont les frais de scolarité du PGE à l'EMLV pour 2026-2027 ?",
  "include_domains": ["emlv.fr"],
  "max_results": 10,
  "output_schema": { ... },   ← Optionnel : force le format de sortie JSON
  "model": "pro"               ← "mini" (4-15 crédits) ou "pro" (15+ crédits)
}

→ Réponse immédiate :
{
  "request_id": "abc-123",
  "status": "pending"
}
```

```
GET https://api.tavily.com/research/abc-123

→ Pendant l'exécution :
{ "status": "in_progress" }

→ Une fois terminé (30-120 secondes) :
{
  "status": "completed",
  "report": "..." ou { structured JSON },
  "sources": [
    { "title": "Frais de scolarité - EMLV", "url": "https://emlv.fr/tarifs" },
    ...
  ]
}
```

### 3.2. Paramètres clés

| Paramètre | Type | Description |
|---|---|---|
| `input` | `str` (requis) | La question de recherche / le sujet |
| `include_domains` | `list[str]` (optionnel) | Domaines prioritaires (soft preference, pas filtre strict) |
| `output_schema` | `dict` (optionnel) | JSON Schema pour forcer la structure du rapport |
| `model` | `str` | `"mini"` (4-15 crédits) ou `"pro"` (15+ crédits) |
| `citation_format` | `str` | `"numbered"`, `"mla"`, `"apa"`, `"chicago"` |

### 3.3. Coûts

| Modèle | Crédits par requête | Avec Free Tier (1000/clé/mois) |
|---|---|---|
| `mini` | 4 – 15 | ~66 à 250 recherches/clé |
| **`pro`** (choisi) | **15+** (typiquement 15-50) | **~20 à 66 recherches/clé** |

### 3.4. Différence avec `search`

| Aspect | `search` (actuel) | `research` (nouveau) |
|---|---|---|
| Temps de réponse | ~1-3s | 30-120s |
| Intelligence | Recherche simple | Agent multi-requêtes |
| Sources | Résultats bruts | Synthèse croisée |
| Crédits | 1-2 | 15+ (pro) |
| Output structuré | Non | Oui (via `output_schema`) |
| Sous-requêtes | Manuel | Automatique |

---

## 4. Architecture Comparée

### 4.1. Phase 1 — Discovery

#### Ancien Pipeline (branche `dev`)
```
crawl_school_website(domain)           → Tavily crawl
    │                                    select_paths statiques
    │                                    instructions figées
    ▼
Contenu Markdown brut (souvent cassé)
    │
    ▼
extract_programs(raw_content)          → Gemma 31B
    │                                    prompt PHASE1_SYSTEM_PROMPT
    │                                    required_keys: [discovered_campuses]
    ▼
JSON {discovered_campuses: [...]}
    │
    ▼
INSERT ContributionInbox               → status = Pending_Admin
```

**Points faibles :**
- `select_paths` ratent les écoles avec des URLs non standard
- Le crawl retourne du Markdown avec des tableaux cassés
- Gemma doit parser un contenu brut massif (~80K chars)
- 2 étapes = 2 points de failure

#### Nouveau Pipeline (branche `devresearch`)
```
build_phase1_research_input(           → Prompt dynamique et contextualisé
    school_name, domain
)
    │
    ▼
Tavily Research(                       → Agent de recherche autonome
    input=prompt_dynamique,              fait N sous-recherches
    include_domains=[domain],            croise les sources
    output_schema=PHASE1_SCHEMA,         synthétise un rapport
    model="pro"
)
    │
    ├─── Si output_schema a marché ──→ JSON structuré direct
    │
    └─── Sinon (rapport texte) ──→ Gemma 26B ──→ JSON structuré
    │
    ▼
Validation (discovered_campuses non vide, noms non null)
    │
    ▼
INSERT ContributionInbox               → status = Pending_Admin
```

**Avantages :**
- Tavily navigue intelligemment dans le site (pas de `select_paths`)
- L'agent fait plusieurs recherches et croise les infos
- `output_schema` peut donner du JSON directement
- 1 seule étape principale au lieu de 2

---

### 4.2. Phase 2 — Enrichissement

#### Ancien Pipeline (branche `dev`)
```
Pour chaque (Programme, Catégorie) :

  PIPELINE_STRATEGIES[catégorie]       → Config statique
      │
      ▼
  search_web(query_template)           → Tavily search (1-2 crédits)
      │
      ▼
  is_content_relevant()                → Gemma 26B (tri rapide)
      │                                  Edge Case 11 : paywalls
      ├── NON pertinent → skip
      │
      ▼
  call_gemma(extraction)               → Gemma 31B (extraction JSON)
      │                                  prompt catégoriel
      ▼
  has_data_changed()                   → Diff vs production
      │
      ├── Pas de changement → skip (Edge Case 10)
      │
      ▼
  INSERT ContributionInbox             → Pending_Admin
```

**Points faibles :**
- 3 appels API par (Programme, Catégorie) : Tavily + Gemma 26B + Gemma 31B
- Le tri Gemma 26B est souvent un goulot inutile
- Requêtes Tavily search trop génériques
- Pas de croisement de sources

#### Nouveau Pipeline (branche `devresearch`)
```
Pour chaque (Programme/École, Catégorie) :

  build_{category}_research_input(     → Prompt dynamique
      school, campus, program,           année scolaire N+1
      academic_year                      contexte précis
  )
      │
      ▼
  Tavily Research(                     → Agent autonome (15+ crédits pro)
      input=prompt_dynamique,            recherche multi-sources
      include_domains=[official_domain], synthèse intelligente
      output_schema=CATEGORY_SCHEMA,     format JSON forcé (si possible)
      model="pro"
  )
      │
      ├─── output_schema OK ──→ JSON direct
      └─── Sinon ──→ Gemma 26B ──→ JSON
      │
      ▼
  has_data_changed()                   → Diff vs production (CONSERVÉ)
      │
      ├── Pas de changement → skip
      │
      ▼
  INSERT ContributionInbox             → Pending_Admin
```

**Avantages :**
- 1 appel Tavily remplace search + Gemma 26B + Gemma 31B
- L'agent Research détecte lui-même les paywalls et navigue autour
- Prompts hyper-contextualisés avec année scolaire dynamique
- Croisement automatique des sources (Edge Case 5)

---

## 5. Fichiers Créés / Modifiés / Intacts

### Fichiers à CRÉER

| Fichier | Description |
|---|---|
| `backend/utils/__init__.py` | Package utils |
| `backend/utils/academic_year.py` | Calcul dynamique de l'année scolaire N+1 |
| `backend/tavily_service/research_client.py` | Client Tavily Research (create task + polling) |
| `backend/ai/research_prompts.py` | Builders de prompts dynamiques pour Research |
| `backend/ai/research_schemas.py` | JSON Schemas pour `output_schema` |
| `backend/pipeline/phase1_research.py` | Orchestrateur Phase 1 via Research |
| `backend/pipeline/phase2_research.py` | Orchestrateur Phase 2 via Research |
| `backend/simulate_phase1_research.py` | Script de test E2E Phase 1 Research |
| `backend/simulate_phase2_research.py` | Script de test E2E Phase 2 Research |

### Fichiers à MODIFIER

| Fichier | Modification |
|---|---|
| `backend/scheduler/jobs.py` | Ajout du switch `USE_RESEARCH_PIPELINE` |
| `backend/routers/internal.py` | Routes adaptées + endpoint dry-run |
| `backend/main.py` | Import du nouveau pipeline si activé |

### Fichiers INTACTS (ne PAS toucher)

| Fichier | Raison |
|---|---|
| `backend/pipeline/phase1.py` | Ancien Phase 1 — fallback |
| `backend/pipeline/phase2.py` | Ancien Phase 2 — fallback |
| `backend/pipeline/diff.py` | Réutilisé tel quel |
| `backend/tavily_service/client.py` | Conservé (crawl/search/extract pour crowdsourcing) |
| `backend/tavily_service/strategies.py` | Référence domaines/clés JSON |
| `backend/tavily_service/key_manager.py` | Rotation de clés — réutilisé |
| `backend/ai/gemma_client.py` | Réutilisé (Gemma 26B fallback) |
| `backend/ai/prompts.py` | Anciens prompts — conservés |
| `backend/crowdsourcing/processor.py` | Crowdsourcing inchangé |

---

## 6. Spécification Détaillée par Module

### 6.1. `backend/utils/academic_year.py`

```python
"""
Calcul dynamique de l'année scolaire cible N+1.

En France, l'année scolaire va de septembre à juillet.
On cherche toujours les données de l'année N+1 (la prochaine rentrée).

Exemples :
  - Mai 2026   → cible "2026-2027" (year_int = 2026)
  - Octobre 2026 → cible "2027-2028" (year_int = 2027)
  - Août 2027  → cible "2027-2028" (year_int = 2027)
  - Septembre 2027 → cible "2028-2029" (year_int = 2028)
"""

from datetime import date

ACADEMIC_YEAR_PIVOT_MONTH = 9  # Septembre

def get_target_academic_year_int() -> int:
    """
    Retourne l'année de DÉBUT de l'année scolaire cible N+1.
    
    Logique :
      - Avant septembre (janv-août) : année_courante
        → On est dans l'année scolaire courante, on cherche la suivante
        → Ex: Mai 2026 → on est en 2025-2026 → on cible 2026-2027 → retourne 2026
      - À partir de septembre (sept-déc) : année_courante + 1
        → On est déjà dans la nouvelle année scolaire, on cible la suivante
        → Ex: Oct 2026 → on est en 2026-2027 → on cible 2027-2028 → retourne 2027
    """
    today = date.today()
    if today.month >= ACADEMIC_YEAR_PIVOT_MONTH:
        return today.year + 1
    return today.year


def get_target_academic_year_str() -> str:
    """
    Retourne l'année scolaire cible au format "YYYY-YYYY+1".
    Ex: "2026-2027"
    """
    year = get_target_academic_year_int()
    return f"{year}-{year + 1}"


def get_current_academic_year_int() -> int:
    """
    Retourne l'année de DÉBUT de l'année scolaire en cours.
    Utile pour la comparaison / validation.
    """
    today = date.today()
    if today.month >= ACADEMIC_YEAR_PIVOT_MONTH:
        return today.year
    return today.year - 1
```

---

### 6.2. `backend/tavily_service/research_client.py`

```python
"""
Client Tavily Research — Appels asynchrones avec polling.

Workflow :
  1. POST /research → obtenir request_id
  2. Boucle GET /research/{request_id} → attendre "completed"
  3. Retourner le rapport + sources

Gestion des erreurs :
  - Timeout global (max_wait_seconds)
  - Task failed (status = "failed")
  - QuotaExhaustedError (propagée depuis key_manager)
"""

import time
import json
import logging
from typing import Optional, Any
from tavily import TavilyClient
from backend.tavily_service.key_manager import QuotaExhaustedError

logger = logging.getLogger("pipeline.research_client")

# Crédits estimés par modèle (pour le tracking key_manager)
ESTIMATED_CREDITS = {
    "mini": 10,   # Moyenne estimée 4-15
    "pro": 25,    # Moyenne estimée 15-50
}


class ResearchTimeoutError(Exception):
    """Levée quand le polling dépasse max_wait_seconds."""
    pass


class ResearchTaskFailedError(Exception):
    """Levée quand Tavily rapporte un échec de la tâche."""
    pass


def create_research_task(
    query: str,
    key_manager: Any,
    include_domains: Optional[list[str]] = None,
    output_schema: Optional[dict] = None,
    model: str = "pro",
    max_wait_seconds: int = 180,
    poll_interval: float = 5.0,
    dry_run: bool = False,
) -> dict:
    """
    Lance une tâche Tavily Research et attend le résultat (polling).

    Args:
        query: Question de recherche (prompt dynamique)
        key_manager: Instance de TavilyKeyManager
        include_domains: Domaines prioritaires (soft preference)
        output_schema: JSON Schema pour forcer le format de sortie
        model: "mini" (4-15 crédits) ou "pro" (15+ crédits)
        max_wait_seconds: Timeout global du polling (défaut: 180s = 3min)
        poll_interval: Intervalle entre les GET de polling (défaut: 5s)
        dry_run: Si True, log le prompt mais ne lance pas l'appel

    Returns:
        {
            "report": str | dict,     # Rapport textuel ou JSON (si output_schema)
            "sources": list[dict],    # [{"title": ..., "url": ...}]
            "credits_used": int,      # Estimation des crédits consommés
            "status": "completed",
            "request_id": str
        }

    Raises:
        ResearchTimeoutError: Si le polling dépasse max_wait_seconds
        ResearchTaskFailedError: Si la tâche échoue côté Tavily
        QuotaExhaustedError: Si toutes les clés Tavily sont épuisées
    """
    if dry_run:
        logger.info(f"🧪 [DRY RUN] Research query:\n{query[:500]}")
        logger.info(f"🧪 [DRY RUN] include_domains={include_domains}")
        logger.info(f"🧪 [DRY RUN] output_schema={'YES' if output_schema else 'NO'}")
        return {
            "report": "[DRY RUN — aucun appel effectué]",
            "sources": [],
            "credits_used": 0,
            "status": "dry_run",
            "request_id": "dry-run-000"
        }

    # Obtenir une clé active via le key_manager
    api_key = key_manager.get_active_key()
    client = TavilyClient(api_key=api_key)

    logger.info(f"🔬 Tavily Research ({model}) : '{query[:100]}...'")

    # ── 1. Lancer la tâche ─────────────────────────────────────
    research_params = {
        "query": query,
        "model": model,
    }
    if include_domains:
        research_params["include_domains"] = include_domains
    if output_schema:
        research_params["output_schema"] = output_schema

    response = client.research(**research_params)
    # Note : la méthode SDK peut varier selon la version. 
    # Alternative : client.create_research_task(input=query, ...)

    request_id = response.get("request_id") or response.get("id")
    if not request_id:
        raise ResearchTaskFailedError(f"Pas de request_id dans la réponse: {response}")

    logger.info(f"📋 Research task créée: {request_id}")

    # ── 2. Polling ─────────────────────────────────────────────
    result = _poll_research_task(
        client=client,
        request_id=request_id,
        max_wait_seconds=max_wait_seconds,
        poll_interval=poll_interval,
    )

    # ── 3. Enregistrer l'utilisation ───────────────────────────
    credits_used = ESTIMATED_CREDITS.get(model, 25)
    key_manager.record_usage(api_key, credits=credits_used)

    logger.info(
        f"✅ Research terminée ({request_id}): "
        f"{len(result.get('sources', []))} sources, ~{credits_used} crédits"
    )

    return {
        "report": result.get("report", ""),
        "sources": result.get("sources", []),
        "credits_used": credits_used,
        "status": "completed",
        "request_id": request_id,
    }


def _poll_research_task(
    client: TavilyClient,
    request_id: str,
    max_wait_seconds: int,
    poll_interval: float,
) -> dict:
    """
    Boucle de polling jusqu'à completion ou timeout.

    Statuts possibles :
      - "pending" : en attente
      - "in_progress" : recherche en cours
      - "completed" : terminé avec succès
      - "failed" : échec

    Returns:
        Le résultat complet de la tâche (report + sources).

    Raises:
        ResearchTimeoutError: timeout dépassé
        ResearchTaskFailedError: tâche échouée
    """
    start_time = time.time()
    attempt = 0

    while True:
        elapsed = time.time() - start_time
        if elapsed >= max_wait_seconds:
            raise ResearchTimeoutError(
                f"Research task {request_id} : timeout après {max_wait_seconds}s"
            )

        attempt += 1
        time.sleep(poll_interval)

        # Note: la méthode SDK peut être get_research_task(request_id)
        # ou client.research.get(request_id)
        result = client.get_research_task(request_id=request_id)
        status = result.get("status", "unknown")

        if status == "completed":
            return result
        elif status == "failed":
            error_msg = result.get("error", "Raison inconnue")
            raise ResearchTaskFailedError(
                f"Research task {request_id} échouée: {error_msg}"
            )
        else:
            # pending ou in_progress
            if attempt % 6 == 0:  # Log toutes les ~30s
                logger.info(
                    f"⏳ Research {request_id} en cours... "
                    f"({elapsed:.0f}s / {max_wait_seconds}s)"
                )
```

> **Note importante :** Les noms de méthodes SDK Tavily (`client.research()`, `client.get_research_task()`) devront être vérifiés contre la version installée de `tavily-python`. Si l'API REST brute est nécessaire, on utilisera `requests` directement.

---

### 6.3. `backend/pipeline/phase1_research.py`

**Orchestrateur Phase 1 via Research :**

```python
"""
Séquence :
  1. Lire l'école en BDD (official_domain, status)
  2. Vérifier CronTarget (blacklist check) — identique à phase1.py
  3. Construire le prompt dynamique (research_prompts.build_phase1_research_input)
  4. Tavily Research (model="pro", include_domains=[official_domain])
     4a. Si output_schema fonctionne → JSON direct
     4b. Sinon → récupérer le rapport texte
  5. Si le résultat est du texte → Gemma 26B pour convertir en JSON structuré
  6. Validation du JSON (discovered_campuses non vide, chaque campus a un name)
  7. INSERT ContributionInbox (status=Pending_Admin, source_type=Automated_AI)
  8. En cas d'échec → _record_failure (CronTarget, 3 strikes → blacklist)
"""

# Flux décisionnel output_schema vs Gemma 26B :
#
# Research(output_schema=PHASE1_SCHEMA)
#     │
#     ├── Le rapport est un dict valide avec "discovered_campuses"
#     │   → Utiliser directement
#     │
#     └── Le rapport est un str (output_schema ignoré ou échoué)
#         │
#         └── Gemma 26B(
#               system="Convertis ce rapport en JSON...",
#               user=rapport_texte,
#               required_keys=["discovered_campuses"]
#             )
#             │
#             ├── JSON valide → utiliser
#             └── Échec → _record_failure
```

**Différences clés avec `phase1.py` :**
- Pas d'appel `crawl_school_website()` → remplacé par `create_research_task()`
- Pas d'appel direct Gemma 31B → Research fait la synthèse
- Gemma 26B utilisé uniquement en fallback pour le formatage JSON
- Le prompt est hyper-contextualisé (nom de l'école, domaine)

---

### 6.4. `backend/pipeline/phase2_research.py`

**Orchestrateur Phase 2 via Research :**

```python
"""
Parcours des catégories pour une école :

A) Catégories de niveau ÉCOLE (SchoolStats, Accreditation) :
   → 1 Research task par catégorie
   → include_domains = [official_domain]

B) Catégories de niveau PROGRAMME (Pricing, Ranking, Capacity) :
   → 1 Research task par (Programme, Catégorie)
   → include_domains adapté à la catégorie :
     - Pricing : [official_domain]
     - Ranking : [official_domain] (Tavily trouvera lefigaro, letudiant, etc.)
     - Capacity : [official_domain]

Pour chaque tâche :
  1. Vérifier CronTarget (blacklist)
  2. Construire le prompt dynamique avec année scolaire N+1
  3. Tavily Research (model="pro")
  4. Parser le résultat (output_schema ou Gemma 26B fallback)
  5. has_data_changed() vs production (diff.py CONSERVÉ)
  6. Si données nouvelles → INSERT ContributionInbox
  7. Gestion des échecs → CronTarget
"""

# La variable PHASE2_MAX_PROGRAMS est CONSERVÉE pour les tests
# (permet de limiter le nombre de programmes traités)
```

**Point clé — `include_domains` simplifié :**

L'ancien `PIPELINE_STRATEGIES` définissait des domaines stricts par catégorie (ex: Ranking → `["lefigaro.fr", "letudiant.fr", "sigem.org"]`). Avec Research en mode `pro`, Tavily est assez intelligent pour trouver les bonnes sources tout seul. On ne met que le domaine officiel de l'école comme préférence douce, et on laisse Tavily chercher où il faut.

---

### 6.5. Modifications du Scheduler (`jobs.py`)

```python
# Nouvelle variable d'env à ajouter dans backend/.env :
# USE_RESEARCH_PIPELINE=true

import os

USE_RESEARCH_PIPELINE = os.environ.get("USE_RESEARCH_PIPELINE", "true").lower() == "true"

def _get_phase1_runner():
    """Retourne la fonction run_phase1 selon le mode configuré."""
    if USE_RESEARCH_PIPELINE:
        from backend.pipeline.phase1_research import run_phase1_research
        return run_phase1_research
    else:
        from backend.pipeline.phase1 import run_phase1
        return run_phase1

def _get_phase2_runner():
    """Retourne la fonction run_phase2 selon le mode configuré."""
    if USE_RESEARCH_PIPELINE:
        from backend.pipeline.phase2_research import run_phase2_research
        return run_phase2_research
    else:
        from backend.pipeline.phase2 import run_phase2
        return run_phase2
```

---

### 6.6. Modifications des Routes Internes (`internal.py`)

Ajout d'un endpoint de dry-run :

```python
@router.post("/internal/research-test/{school_id}")
async def research_test(school_id: str):
    """
    Test dry-run du pipeline Research pour une école.
    
    Retourne le rapport Research SANS écrire en BDD.
    Utile pour comparer la qualité vs l'ancien pipeline.
    
    Paramètres query :
      - phase: "1" ou "2" (défaut: "1")
      - category: "Pricing" | "Ranking" | ... (requis si phase=2)
      - program_id: UUID du programme (requis pour Pricing/Ranking/Capacity)
    """
```

---

## 7. Prompts Dynamiques Complets

### 7.1. Phase 1 — Program Discovery

```python
def build_phase1_research_input(school_name: str, domain: str) -> str:
    return f"""Effectue une recherche exhaustive sur l'établissement d'enseignement supérieur français "{school_name}" (site officiel : https://{domain}).

OBJECTIF : Identifier TOUS les campus et programmes/formations proposés par cette école.

INFORMATIONS RECHERCHÉES PAR CAMPUS :
1. Nom exact du campus (tel qu'écrit sur le site officiel de l'école)
2. Ville du campus

INFORMATIONS RECHERCHÉES PAR PROGRAMME/FORMATION :
1. Nom exact du programme (tel qu'affiché sur le site officiel)
2. Concours d'admission requis (ex: "Concours Sésame", "Concours Accès", "Parcoursup") — ou null si non trouvé
3. L'alternance est-elle possible ? (true/false/null si inconnu)
4. Un séjour à l'étranger est-il obligatoire ? (true/false/null si inconnu)

RÈGLES STRICTES :
- Ne lister que les formations diplômantes principales (Bachelor, Master, PGE, MBA, MSc, BBA, IBBA, etc.)
- NE PAS lister les formations continues, les DU, les certificats courts ou les modules individuels
- Utiliser les NOMS EXACTS tels qu'écrits sur le site officiel (pas de traduction, pas de simplification)
- Si un campus n'a pas de nom distinct, utiliser "Campus [Ville]"
- Si l'information n'est pas trouvable, mettre null plutôt qu'inventer
- Privilégier les informations du site officiel https://{domain}"""
```

### 7.2. Phase 2 — Pricing

```python
def build_pricing_research_input(
    school_name: str, campus_name: str, program_name: str, 
    academic_year_str: str, domain: str
) -> str:
    return f"""Recherche les frais de scolarité du programme "{program_name}" au campus "{campus_name}" de l'école "{school_name}" pour l'année scolaire {academic_year_str}.

INFORMATIONS RECHERCHÉES :
1. Frais de scolarité par année d'études :
   - Année 1 (year_1_fee) en euros
   - Année 2 (year_2_fee) en euros
   - Année 3 (year_3_fee) en euros
   - Année 4 (year_4_fee) en euros (si applicable)
   - Année 5 (year_5_fee) en euros (si applicable)
2. Frais total du cursus complet (total_fee) si disponible
3. Tarifs pour étudiants internationaux (Non-UE) si différents :
   - intl_year_1_fee, intl_total_fee, intl_currency
4. Devise (EUR par défaut)
5. Frais annexes éventuels : frais de dossier, CVEC, cotisation association étudiante, frais de concours (additional_fees_notes)
6. L'URL exacte de la page source contenant ces informations

RÈGLES STRICTES :
- Rapporter les prix EXACTS trouvés, NE JAMAIS calculer de moyenne ou de lissage
- Si le prix est par année, remplir year_X_fee. Si le prix est global pour tout le cursus, remplir total_fee
- Si l'année {academic_year_str} n'est pas encore publiée, prendre la dernière année disponible et le signaler
- Extraire séparément les tarifs UE et Non-UE si présents sur la même page
- Si des frais cachés ou annexes sont mentionnés (même en petit), les rapporter dans additional_fees_notes
- Privilégier le site officiel https://{domain} comme source principale"""
```

### 7.3. Phase 2 — Ranking

```python
def build_ranking_research_input(
    school_name: str, program_name: str, academic_year_str: str, domain: str
) -> str:
    return f"""Recherche les classements du programme "{program_name}" de l'école "{school_name}" pour l'année {academic_year_str} dans les classements français et internationaux.

CLASSEMENTS À RECHERCHER (par ordre de priorité) :
- Le Figaro Étudiant (classement des écoles de commerce / ingénieurs)
- L'Étudiant (palmarès des grandes écoles)
- Le Parisien Étudiant
- SIGEM (classement basé sur les choix des étudiants)
- Financial Times (si applicable pour les Masters/MBA)
- QS World Rankings (si applicable)
- Le Point

INFORMATIONS RECHERCHÉES PAR CLASSEMENT TROUVÉ :
1. Nom exact du média/classement (ranking_name)
2. Rang / position (rank) — un nombre entier
3. Année du classement (academic_year)
4. URL source exacte (source_url)

RÈGLES STRICTES :
- Chaque classement trouvé doit être rapporté séparément
- Si plusieurs classements de sources différentes existent, les rapporter TOUS
- Si les sources se contredisent, rapporter les deux et le signaler
- NE PAS confondre le classement d'un programme spécifique avec le classement global de l'école
- Prendre le classement le plus récent disponible"""
```

### 7.4. Phase 2 — Capacity

```python
def build_capacity_research_input(
    school_name: str, campus_name: str, program_name: str,
    academic_year_str: str, domain: str
) -> str:
    return f"""Recherche le nombre de places disponibles pour le programme "{program_name}" au campus "{campus_name}" de l'école "{school_name}" pour l'année scolaire {academic_year_str}.

INFORMATIONS RECHERCHÉES :
1. Nombre de places disponibles (spots_available) — un nombre entier
2. Année scolaire de référence (academic_year)
3. URL source exacte

SOURCES POSSIBLES :
- Site officiel de l'école : https://{domain}
- Concours-sesame.net (pour les écoles post-bac)
- Concours-acces.com
- Parcoursup (données publiques)
- Sites des concours d'admission

RÈGLES :
- Rapporter le chiffre EXACT trouvé
- Si l'information n'est pas disponible publiquement, le signaler clairement
- Distinguer "places ouvertes au concours" de "places totales du programme" si possible"""
```

### 7.5. Phase 2 — SchoolStats

```python
def build_school_stats_research_input(
    school_name: str, academic_year_str: str, domain: str
) -> str:
    return f"""Recherche les chiffres clés et statistiques de l'école "{school_name}" pour l'année {academic_year_str} ou la plus récente disponible.

INFORMATIONS RECHERCHÉES :
1. Nombre total d'étudiants (total_students)
2. Nombre d'alumni / diplômés (total_alumni)
3. Nombre d'entreprises partenaires (partner_companies)
4. Nombre d'offres de stage annuelles (annual_internship_offers)
5. Nombre de campus à l'étranger (abroad_campuses)
6. Nombre d'universités partenaires (partner_universities)
7. Nombre de professeurs permanents (permanent_professors)
8. Pourcentage de professeurs internationaux (international_professors_pct) — entre 0 et 1
9. Pourcentage d'intervenants extérieurs (external_speakers_pct) — entre 0 et 1

SOURCE PRINCIPALE : https://{domain} (pages "chiffres clés", "en bref", "key figures", "about")

RÈGLES :
- Rapporter les chiffres EXACTS trouvés
- Si un chiffre n'est pas disponible, mettre null
- Privilégier les chiffres les plus récents
- Les pourcentages doivent être entre 0 et 1 (ex: 35% → 0.35)"""
```

### 7.6. Phase 2 — Accreditation

```python
def build_accreditation_research_input(
    school_name: str, domain: str
) -> str:
    return f"""Recherche les accréditations et labels de qualité de l'école "{school_name}".

ACCRÉDITATIONS À RECHERCHER :
- EQUIS (EFMD Quality Improvement System)
- AACSB (Association to Advance Collegiate Schools of Business)
- AMBA (Association of MBAs)
- EPAS (EFMD Programme Accreditation System)
- CGE (Conférence des Grandes Écoles)
- CTI (Commission des Titres d'Ingénieur)
- Grade de Licence / Grade de Master (visas d'État)
- Tout autre label ou accréditation officielle

INFORMATIONS RECHERCHÉES PAR ACCRÉDITATION :
1. Nom exact de l'accréditation (accreditation_name)
2. Année d'obtention ou de renouvellement (year_obtained)
3. Statut actif ou non (is_active) — true/false

SOURCE PRINCIPALE : https://{domain} (pages "accréditations", "labels", "reconnaissances")

RÈGLES :
- Chaque accréditation doit être rapportée séparément
- Si l'année d'obtention n'est pas trouvée, estimer avec l'année la plus probable ou mettre 0
- is_active = true sauf si explicitement mentionné comme expiré/perdu"""
```

---

## 8. Schemas JSON (output_schema)

Les JSON Schemas sont passés à Tavily Research pour forcer un format de sortie structuré. Si ça fonctionne, on obtient du JSON directement sans passer par Gemma.

### 8.1. Phase 1 — Discovery Schema

```json
{
  "type": "object",
  "properties": {
    "discovered_campuses": {
      "type": "array",
      "description": "Liste de tous les campus de l'école",
      "items": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "Nom exact du campus"
          },
          "city": {
            "type": ["string", "null"],
            "description": "Ville du campus"
          },
          "programs": {
            "type": "array",
            "description": "Programmes proposés sur ce campus",
            "items": {
              "type": "object",
              "properties": {
                "name": {
                  "type": "string",
                  "description": "Nom exact du programme/formation"
                },
                "admission_exam": {
                  "type": ["string", "null"],
                  "description": "Concours d'admission requis ou null"
                },
                "is_alternance_possible": {
                  "type": ["boolean", "null"],
                  "description": "L'alternance est-elle possible ?"
                },
                "is_expatriation_mandatory": {
                  "type": ["boolean", "null"],
                  "description": "Le séjour à l'étranger est-il obligatoire ?"
                }
              },
              "required": ["name"]
            }
          }
        },
        "required": ["name", "programs"]
      }
    },
    "source_urls": {
      "type": "array",
      "items": {"type": "string"},
      "description": "URLs des pages sources analysées"
    },
    "confidence_notes": {
      "type": ["string", "null"],
      "description": "Notes sur les incertitudes éventuelles"
    }
  },
  "required": ["discovered_campuses"]
}
```

### 8.2. Phase 2 — Pricing Schema

```json
{
  "type": "object",
  "properties": {
    "academic_year": {"type": ["integer", "null"], "description": "Année de début (ex: 2026)"},
    "currency": {"type": "string", "description": "Devise (EUR par défaut)"},
    "year_1_fee": {"type": ["integer", "null"], "description": "Frais année 1 en euros"},
    "year_2_fee": {"type": ["integer", "null"]},
    "year_3_fee": {"type": ["integer", "null"]},
    "year_4_fee": {"type": ["integer", "null"]},
    "year_5_fee": {"type": ["integer", "null"]},
    "total_fee": {"type": ["integer", "null"], "description": "Frais total du cursus"},
    "intl_year_1_fee": {"type": ["integer", "null"]},
    "intl_total_fee": {"type": ["integer", "null"]},
    "intl_currency": {"type": ["string", "null"]},
    "additional_fees_notes": {"type": ["string", "null"], "description": "Frais annexes"},
    "source_url": {"type": ["string", "null"]},
    "year_assumed": {"type": "boolean", "description": "true si l'année n'était pas mentionnée"},
    "data_conflict_warning": {"type": "boolean", "description": "true si sources contradictoires"}
  },
  "required": ["academic_year", "currency"]
}
```

### 8.3. Autres Schemas (Ranking, Capacity, SchoolStats, Accreditation)

Même principe — chaque schema correspond exactement aux champs attendus dans les tables `_Record` de la BDD Prisma. Voir `bdd.md` pour la référence.

### 8.4. Stratégie de test output_schema

```
Étape 1 : Essayer AVEC output_schema
  │
  ├── Le rapport est un dict JSON valide
  │   ├── Les required_keys sont présentes → ✅ Utiliser directement
  │   └── Des clés manquent → ⚠️ Log warning, utiliser quand même
  │
  └── Le rapport est un str (output_schema ignoré)
      │
      ▼
Étape 2 : Fallback Gemma 26B
  Gemma 26B reçoit le rapport texte + prompt de conversion JSON
  │
  ├── JSON valide → ✅ Utiliser
  └── Échec → ❌ _record_failure
```

---

## 9. Calcul de l'Année Scolaire Dynamique

### Logique

```
Mois actuel        Année scolaire en cours    Année cible (N+1)    year_int
──────────────     ──────────────────────     ─────────────────    ────────
Janvier 2026       2025-2026                  2026-2027            2026
Mai 2026           2025-2026                  2026-2027            2026
Août 2026          2025-2026                  2026-2027            2026
Septembre 2026     2026-2027                  2027-2028            2027
Décembre 2026      2026-2027                  2027-2028            2027
```

### Usage dans les prompts

```python
from backend.utils.academic_year import get_target_academic_year_str, get_target_academic_year_int

academic_year_str = get_target_academic_year_str()  # "2026-2027"
academic_year_int = get_target_academic_year_int()  # 2026

prompt = f"Trouve les frais de scolarité pour l'année scolaire {academic_year_str}..."
```

### Stockage en BDD

Le champ `academic_year` dans les tables `_Record` stocke l'année de début (type `Int`).
Pour 2026-2027 → `academic_year = 2026`.

---

## 10. Gestion du Coût en Crédits

### Budget par école (estimation avec `pro`)

| Phase | Opérations | Crédits estimés |
|---|---|---|
| Phase 1 Research | 1 × Research pro | ~25 |
| Phase 2 — SchoolStats | 1 × Research pro | ~25 |
| Phase 2 — Accreditation | 1 × Research pro | ~25 |
| Phase 2 — Pricing (par programme) | 1 × Research pro | ~25 |
| Phase 2 — Ranking (par programme) | 1 × Research pro | ~25 |
| Phase 2 — Capacity (par programme) | 1 × Research pro | ~25 |

**Pour une école avec 5 programmes :**
- Phase 1 : ~25 crédits
- Phase 2 école : 2 × ~25 = ~50 crédits
- Phase 2 programmes : 5 × 3 × ~25 = ~375 crédits
- **Total : ~450 crédits par école**

### Capacité avec rotation de clés

| Nombre de clés | Crédits totaux/mois | Écoles traitables |
|---|---|---|
| 1 | 1 000 | ~2 |
| 3 | 3 000 | ~6 |
| 5 | 5 000 | ~11 |
| 10 | 10 000 | ~22 |

### Optimisations possibles (à explorer après le MVP)

1. **Batching Phase 2** : Regrouper Pricing + Capacity en une seule Research task par programme
2. **Cache des résultats** : Si un programme a déjà été enrichi récemment et que le diff montre 0 changement, skip
3. **Priorisation** : Traiter d'abord les écoles sans aucune donnée, puis celles avec données anciennes
4. **Mode `mini` pour les données simples** : Utiliser `mini` pour Capacity (un seul chiffre) et `pro` pour Pricing/Ranking (plus complexe)

---

## 11. Mode Dry Run

### Fonctionnement

Le mode dry run permet de :
1. Construire les prompts dynamiques
2. Logger exactement ce qui serait envoyé à Tavily Research
3. **NE PAS faire l'appel API** (0 crédit consommé)
4. **NE PAS écrire en BDD**

### Activation

```python
# Via variable d'env
DRY_RUN=true python backend/simulate_phase1_research.py

# Via endpoint API
POST /internal/research-test/{school_id}?phase=1&dry_run=true
```

### Sortie

```
🧪 [DRY RUN] Phase 1 Research pour "EMLV" (emlv.fr)
🧪 [DRY RUN] Prompt Research:
   Effectue une recherche exhaustive sur l'établissement "EMLV" (site: https://emlv.fr)
   ...
🧪 [DRY RUN] include_domains: ["emlv.fr"]
🧪 [DRY RUN] output_schema: PHASE1_OUTPUT_SCHEMA (discovery)
🧪 [DRY RUN] model: pro (~25 crédits estimés)
🧪 [DRY RUN] Aucun appel API effectué. Aucune écriture BDD.
```

---

## 12. Gestion des Erreurs et Edge Cases

### Erreurs spécifiques à Research

| Erreur | Cause | Action |
|---|---|---|
| `ResearchTimeoutError` | Polling > 180s | `_record_failure()` + log warning |
| `ResearchTaskFailedError` | Tavily rapporte un échec | `_record_failure()` + log error |
| `QuotaExhaustedError` | Toutes les clés épuisées | Arrêt du pipeline, log critical |
| Rapport vide / trop court | Research n'a rien trouvé | `_record_failure()` |
| `output_schema` ignoré | Tavily retourne du texte au lieu de JSON | Fallback Gemma 26B |
| Gemma 26B fallback échoue | JSON invalide après conversion | `_record_failure()` |

### Edge Cases existants — Impact du changement

| Edge Case | Ancien pipeline | Nouveau pipeline (Research) |
|---|---|---|
| **EC1 — DDoS Tavily** | Rate limit IP | Inchangé (Research = même quota) |
| **EC2 — Données archivées** | Prompt Gemma pour filtrer | Le prompt Research demande explicitement N+1 |
| **EC3 — Lissage prix** | Prompt Gemma strict | Prompt Research encore plus explicite |
| **EC4 — Boucle infinie** | CronTarget blacklist | **Conservé identique** |
| **EC5 — Sources contradictoires** | Flag `data_conflict_warning` | Research croise mieux les sources automatiquement |
| **EC9 — Markdown cassé** | Gemma parse du Markdown cassé | **Résolu** — Research synthétise au lieu de retourner du Markdown brut |
| **EC10 — Inbox inondée** | `diff.py` compare vs production | **Conservé identique** |
| **EC11 — Paywalls** | Gemma 26B détecte | **Amélioré** — Research navigue autour des paywalls |
| **EC13 — Prompt injection** | `<TEXTE_SOURCE>` délimiteurs | **Amélioré** — le contenu est traité par Tavily, pas directement par notre LLM |
| **EC14 — Timeout Tavily** | 15s timeout | `max_wait_seconds=180` pour Research (plus long mais attendu) |

---

## 13. Plan d'Exécution Séquentiel

> **Règle : ne pas passer à l'étape suivante tant que la précédente n'est pas validée.**

### Étape R1 — Infrastructure de base
- [ ] Créer `backend/utils/__init__.py`
- [ ] Créer `backend/utils/academic_year.py` avec les 3 fonctions
- [ ] Vérifier que `tavily-python` est à jour (version avec Research endpoint)
- [ ] Créer `backend/tavily_service/research_client.py` (client + polling)
- **Test R1 :** Appel Research simple en mode dry_run → vérifier que les logs sont corrects

### Étape R2 — Prompts et Schemas
- [ ] Créer `backend/ai/research_prompts.py` (6 builders de prompts)
- [ ] Créer `backend/ai/research_schemas.py` (6 JSON Schemas)
- [ ] Créer un prompt Gemma 26B de fallback pour la conversion texte → JSON
- **Test R2 :** Vérifier que les schemas sont des JSON Schemas valides (parsing json.loads)
- **Test R2 :** Vérifier que les prompts sont bien formatés pour 2-3 écoles test

### Étape R3 — Phase 1 Research (Discovery)
- [ ] Créer `backend/pipeline/phase1_research.py`
- [ ] Implémenter la séquence : BDD → CronTarget → Research → parse → Inbox
- [ ] Gérer le fallback output_schema → Gemma 26B
- [ ] Gérer les erreurs et `_record_failure`
- [ ] Créer `backend/simulate_phase1_research.py` (script de test E2E)
- **Test R3a :** Dry run Phase 1 pour EMLV → vérifier le prompt
- **Test R3b :** Appel réel Phase 1 pour EMLV → ticket créé dans ContributionInbox
- **Test R3c :** Comparer le résultat avec l'ancien Phase 1 (même école)
- **Test R3d :** École blacklistée → skip confirmé

### Étape R4 — Phase 2 Research (Enrichissement)
- [ ] Créer `backend/pipeline/phase2_research.py`
- [ ] Implémenter le parcours des catégories (école + programmes)
- [ ] Intégrer `diff.py` (has_data_changed)
- [ ] Gérer le fallback output_schema → Gemma 26B par catégorie
- [ ] Créer `backend/simulate_phase2_research.py` (script de test E2E)
- **Test R4a :** Dry run Phase 2 pour EMLV → vérifier les prompts par catégorie
- **Test R4b :** Appel réel Phase 2 pour EMLV (1 programme max) → tickets créés
- **Test R4c :** Comparer la qualité Pricing vs ancien pipeline
- **Test R4d :** Données identiques → aucun ticket (diff fonctionne)

### Étape R5 — Intégration Scheduler + Routes
- [ ] Modifier `backend/scheduler/jobs.py` → switch `USE_RESEARCH_PIPELINE`
- [ ] Modifier `backend/routers/internal.py` → trigger avec le bon pipeline
- [ ] Ajouter endpoint `/internal/research-test/{school_id}`
- [ ] Ajouter `USE_RESEARCH_PIPELINE=true` dans `backend/.env`
- **Test R5a :** `POST /internal/trigger-scan/{school_id}` → Phase 1 Research lancée
- **Test R5b :** `POST /internal/trigger-enrichment/{school_id}` → Phase 2 Research lancée
- **Test R5c :** `USE_RESEARCH_PIPELINE=false` → anciens pipelines utilisés
- **Test R5d :** `/internal/research-test/{school_id}?dry_run=true` → rapport sans BDD

### Étape R6 — Tests de qualité et ajustements
- [ ] Lancer Phase 1 Research sur 3 écoles (EMLV, EDHEC, ESSEC ou similaires)
- [ ] Lancer Phase 2 Research sur 2 écoles avec programmes existants
- [ ] Documenter les résultats côte à côte (ancien vs nouveau)
- [ ] Ajuster les prompts si nécessaire
- [ ] Vérifier que les tickets dans l'Inbox Admin sont exploitables
- [ ] Mesurer les crédits réellement consommés vs estimation

---

## 14. Plan de Vérification

### Tests automatisés

```bash
# Activer l'environnement virtuel
.\backend\.venv\Scripts\Activate.ps1
$env:PYTHONUTF8=1

# Test unitaire : calcul d'année scolaire
python -c "from backend.utils.academic_year import *; print(get_target_academic_year_str())"

# Test dry run : Phase 1
python backend/simulate_phase1_research.py --dry-run --school-name "EMLV"

# Test réel : Phase 1
python backend/simulate_phase1_research.py --school-id "<UUID_EMLV>"

# Test réel : Phase 2 (1 programme)
python backend/simulate_phase2_research.py --school-id "<UUID>" --max-programs 1

# Test API interne
curl -X POST http://localhost:8000/internal/research-test/<school_id>?phase=1&dry_run=true \
  -H "Authorization: Bearer <INTERNAL_TOKEN>"
```

### Vérification manuelle

1. **Inbox Admin** : Ouvrir `/admin/inbox` → vérifier que les tickets Research sont bien formés
2. **Super Ticket Phase 1** : Les campus/programmes découverts sont-ils plus complets ?
3. **Pricing** : Les prix sont-ils plus précis ? Y a-t-il moins de `null` ?
4. **Ranking** : Plus de classements trouvés ?
5. **Sources** : Les URLs sources sont-elles présentes et pertinentes ?
6. **Crédits** : Vérifier le compteur `key_manager` après les tests

### Critères de succès

| Critère | Seuil |
|---|---|
| Phase 1 trouve au moins autant de campus/programmes que l'ancien pipeline | ≥ 100% |
| Les prix Phase 2 ont moins de champs `null` | Amélioration visible |
| Les tickets sont correctement formatés pour la validation Admin | 100% |
| Le fallback vers l'ancien pipeline fonctionne | `USE_RESEARCH_PIPELINE=false` OK |
| Le mode dry run ne consomme aucun crédit | 0 crédit |

---

## 15. Rollback Strategy

Si le nouveau pipeline Research ne donne pas satisfaction :

1. **Immédiat :** Mettre `USE_RESEARCH_PIPELINE=false` dans `backend/.env` → les anciens pipelines reprennent
2. **Définitif :** Retourner sur la branche `dev` qui contient les pipelines intacts
3. **Partiel :** Garder Research uniquement pour Phase 1 (Discovery est le cas d'usage le plus fort) et revenir à l'ancien pour Phase 2

```bash
# Rollback immédiat (sans changer de branche)
# Dans backend/.env :
USE_RESEARCH_PIPELINE=false

# Rollback définitif (changer de branche)
git checkout dev
```

---

> **Ce document est la source de vérité pour le travail sur la branche `devresearch`.
> Tout changement d'approche doit être documenté ici avant implémentation.**
