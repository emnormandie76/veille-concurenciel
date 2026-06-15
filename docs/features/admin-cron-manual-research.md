# Feature — Monitoring Temps Réel + Recherche Manuelle depuis Admin/Cron

> **Version :** 1.0 — 12 juin 2026  
> **Branche :** `devresearch`  
> **Pipeline concerné :** Research uniquement (`USE_RESEARCH_PIPELINE=true`)  
> **Prérequis :** Le plan `research-pipeline-plan.md` doit être implémenté et fonctionnel

---

## Table des Matières

1. [Objectif et Contexte](#1-objectif-et-contexte)
2. [Fichiers Créés / Modifiés / Intacts](#2-fichiers-créés--modifiés--intacts)
3. [Backend — Modifications Détaillées](#3-backend--modifications-détaillées)
4. [Frontend — Modifications Détaillées](#4-frontend--modifications-détaillées)
5. [Nouveaux Endpoints](#5-nouveaux-endpoints)
6. [Interfaces et Types](#6-interfaces-et-types)
7. [Flux de Données Complet](#7-flux-de-données-complet)
8. [Backward Compatibility](#8-backward-compatibility)
9. [Tests et Vérification](#9-tests-et-vérification)

---

## 1. Objectif et Contexte

### Problème

La page `/admin/cron` existante avait deux limitations majeures :

1. **Monitoring opaque** — Les tâches en cours n'affichaient qu'un `job_id`, un `school_id` brut (UUID) et un statut basique (`running`/`queued`). Aucun détail sur l'action en cours (quelle catégorie, quel programme, quelle étape).

2. **Pas de lancement manuel ciblé** — Pour lancer une Phase 1 ou 2, il fallait passer par `curl` ou attendre le Cron. Impossible de cibler un programme ou une catégorie spécifique.

### Solution

Deux features ajoutées à la page `/admin/cron` :

| Feature | Description |
|---|---|
| **Monitoring détaillé** | Les jobs affichent l'action courante (ex: "Recherche Ranking sur Programme Grande École"), une barre de progression (`5/12 catégories`), et un timer (`⏱ 2m 34s`) |
| **Recherche manuelle** | Formulaire avec sélecteur en cascade : Phase → École → Programme → Catégories. Permet de lancer une recherche ciblée directement depuis le panneau admin |

### Décisions Techniques

| Décision | Choix | Raison |
|---|---|---|
| Progression | Dict `_pipeline_progress` en mémoire + polling 5s | Simple, pas besoin de SSE ou WebSocket pour du local. Le polling existant suffit |
| Endpoint ciblé | Nouveau `trigger-targeted-research` séparé | Évite de casser `trigger-scan`/`trigger-enrichment` existants |
| Filtrage Phase 2 | Params optionnels sur `run_phase2_research()` | Backward-compatible — les appels existants (scheduler) ne changent pas |
| Données sélecteur | Nouvel endpoint `schools-with-programs` | Évite de surcharger l'endpoint `schools` existant avec des includes |
| Pas de nouveau modèle Prisma | Tout en mémoire côté backend | Le progress tracking n'a pas besoin de persistance |

---

## 2. Fichiers Créés / Modifiés / Intacts

### Fichiers MODIFIÉS

| Fichier | Lignes modifiées | Description |
|---|---|---|
| `backend/routers/internal.py` | ~539 lignes (réécriture) | Progress tracking, nouvel endpoint, nouvelle fonction async |
| `backend/pipeline/phase2_research.py` | ~340 lignes (réécriture) | 3 nouveaux params, filtrage ciblé, callback progression |
| `backend/pipeline/phase1_research.py` | ~7 blocs ajoutés | Param `progress_callback` + appels aux étapes clés |
| `app/admin/cron/page.tsx` | ~770 lignes (réécriture) | Monitoring enrichi + formulaire recherche manuelle |

### Fichiers CRÉÉS

| Fichier | Lignes | Description |
|---|---|---|
| `app/api/admin/trigger-research/route.ts` | ~82 lignes | Proxy Next.js → FastAPI pour lancement ciblé |
| `app/api/admin/schools-with-programs/route.ts` | ~48 lignes | Données pour sélecteur en cascade (écoles + campus + programmes) |

### Fichiers INTACTS (ne PAS toucher)

| Fichier | Raison |
|---|---|
| `backend/scheduler/jobs.py` | Les jobs APScheduler appellent les fonctions avec les params par défaut → aucun impact |
| `backend/pipeline/phase1.py` | Ancien pipeline Phase 1 — fallback |
| `backend/pipeline/phase2.py` | Ancien pipeline Phase 2 — fallback |
| `backend/pipeline/diff.py` | Réutilisé tel quel |
| `backend/tavily_service/*` | Inchangé |
| `backend/ai/*` | Inchangé |
| `backend/main.py` | Le router internal est déjà inclus, pas de changement nécessaire |
| `prisma/schema.prisma` | Pas de nouveaux modèles |

---

## 3. Backend — Modifications Détaillées

### 3.1. `backend/routers/internal.py`

#### 3.1.1. Nouveau : Progress Tracking en Mémoire

Ajout d'un dict `_pipeline_progress` et de deux fonctions utilitaires :

```python
# Dict parallèle à _pipeline_jobs pour le tracking granulaire
_pipeline_progress: dict[str, dict] = {}

def update_progress(job_id: str, details: dict):
    """Met à jour les détails de progression d'un job en cours."""
    import time
    _pipeline_progress[job_id] = {
        **details,
        "updated_at": time.time(),
    }

def _cleanup_progress(job_id: str):
    """Supprime les données de progression quand un job est terminé."""
    _pipeline_progress.pop(job_id, None)
```

Le `updated_at` permet au frontend de détecter si les données sont fraîches.

#### 3.1.2. Nouveau : Modèle de requête `TargetedResearchRequest`

```python
class TargetedResearchRequest(BaseModel):
    """Requête de recherche ciblée depuis le panneau admin."""
    phase: str = "1"            # "1" ou "2"
    program_id: str | None = None    # UUID du programme cible (Phase 2 uniquement)
    categories: list[str] | None = None  # ["Pricing", "Ranking"] etc. (Phase 2 uniquement)
```

#### 3.1.3. Nouveau : Endpoint `POST /internal/trigger-targeted-research/{school_id}`

**Route :** `POST /internal/trigger-targeted-research/{school_id}`  
**Auth :** Bearer token interne (même que les autres endpoints)  
**Body :** `TargetedResearchRequest`

Comportement :
1. Vérifie qu'aucun job n'est déjà en cours pour cette école (parcourt **tous** les jobs, pas juste la clé)
2. Valide la phase ("1" ou "2")
3. Valide que les catégories sont présentes si un programme est spécifié en Phase 2
4. Crée un job dans `_pipeline_jobs` avec la clé `{school_id}:targeted:{job_id}` (évite les collisions avec les clés existantes `{school_id}` et `{school_id}:enrichment`)
5. Lance `_run_targeted_research()` en arrière-plan via `asyncio.create_task()`

Réponse en cas de job déjà en cours :
```json
{
  "message": "Une tâche est déjà en cours pour cette école",
  "job_id": "a1b2c3d4",
  "status": "running",
  "phase": "Phase 2 — Enrichissement ciblé",
  "already_running": true
}
```

Réponse succès :
```json
{
  "message": "Recherche ciblée déclenchée",
  "job_id": "e5f6g7h8",
  "school_id": "uuid-ecole",
  "phase": "Phase 2 — Enrichissement ciblé",
  "program_id": "uuid-programme",
  "categories": ["Ranking"],
  "status": "queued"
}
```

#### 3.1.4. Nouveau : Fonction `_run_targeted_research()`

Fonction async qui :
- Utilise **toujours** le pipeline Research (pas de check `USE_RESEARCH_PIPELINE`)
- Appelle `run_phase1_research()` ou `run_phase2_research()` avec les bons filtres
- Passe un `progress_cb` qui appelle `update_progress(job_id, details)`
- Nettoie la progression dans le `finally` block

```python
async def _run_targeted_research(
    school_id: str,
    job_id: str,
    job_key: str,
    phase: str,
    program_id: str | None,
    categories: list[str] | None,
):
```

#### 3.1.5. Modification : `pipeline-status` enrichi

Le endpoint `GET /internal/pipeline-status` a été modifié pour :
1. Copier les jobs actifs (`{**job}` au lieu de référence directe) pour éviter les mutations
2. Enrichir chaque job avec ses `progress_details` depuis `_pipeline_progress`

```python
active_jobs = [
    {**job} for job in _pipeline_jobs.values()
    if job.get("status") in ("running", "queued")
]

# Enrichir chaque job actif avec ses progress_details
for job in active_jobs:
    job_id = job.get("job_id")
    if job_id and job_id in _pipeline_progress:
        job["progress_details"] = _pipeline_progress[job_id]
```

#### 3.1.6. Modification : `_run_scan()` et `_run_enrichment()`

Les deux fonctions existantes ont été modifiées pour :
1. Appeler `update_progress()` au démarrage
2. Passer un `progress_cb` lambda au pipeline
3. Utiliser `lambda` au lieu d'args positionnels dans `run_in_executor` (pour passer le `progress_callback` comme kwarg)
4. Nettoyer la progression dans le `finally` block

Avant :
```python
result = await loop.run_in_executor(None, run_phase1, school_id, key_manager)
```

Après :
```python
def progress_cb(details):
    update_progress(job_id, details)

result = await loop.run_in_executor(
    None,
    lambda: run_phase1(school_id, key_manager, progress_callback=progress_cb),
)
```

#### 3.1.7. Modification : Labels de phase améliorés

Les `phase` dans `_pipeline_jobs` sont passés de chaînes courtes à des labels descriptifs :

| Avant | Après |
|---|---|
| `"scan"` | `"Phase 1 — Cartographie"` |
| `"enrichment"` | `"Phase 2 — Enrichissement"` |
| (nouveau) | `"Phase 2 — Enrichissement ciblé"` |

#### 3.1.8. Modification : `created_at` avec `time.time()`

Le champ `created_at` utilise désormais `time_module.time()` (import `import time as time_module`) au lieu de `asyncio.get_event_loop().time()`. Cela donne un timestamp UNIX absolu que le frontend peut comparer avec `Date.now() / 1000`.

---

### 3.2. `backend/pipeline/phase2_research.py`

#### 3.2.1. Nouvelle signature

Avant :
```python
def run_phase2_research(school_id: str, key_manager, dry_run: bool = False) -> dict:
```

Après :
```python
def run_phase2_research(
    school_id: str,
    key_manager,
    dry_run: bool = False,
    target_program_id: str | None = None,
    target_categories: list[str] | None = None,
    progress_callback: Callable[[dict], None] | None = None,
) -> dict:
```

Les 3 nouveaux params ont des valeurs par défaut `None` → **backward-compatible**.

#### 3.2.2. Filtrage par `target_program_id`

Si `target_program_id` est défini, la requête SQL est modifiée pour ne charger qu'un seul programme :

```python
if target_program_id:
    cur.execute("""
        SELECT p.id, p.name, p."campusId", c.name as campus_name 
        FROM "Program" p 
        JOIN "Campus" c ON p."campusId" = c.id 
        WHERE c."schoolId" = %s AND p.id = %s
        ORDER BY p.name ASC
    """, (school_id, target_program_id))
else:
    # Requête originale : tous les programmes de l'école
```

Le `PHASE2_MAX_PROGRAMS` env var est ignoré si `target_program_id` est défini (pas besoin de limiter si on cible déjà un programme).

#### 3.2.3. Filtrage par `target_categories`

Deux points de filtrage :

1. **Catégories niveau école** (`SchoolStats`, `Accreditation`) :
```python
for category in SCHOOL_LEVEL_CATEGORIES:
    if target_categories and category not in target_categories:
        continue
```

2. **Catégories niveau programme** (`Pricing`, `Ranking`, `Capacity`) :
```python
for category in PROGRAM_LEVEL_CATEGORIES:
    if target_categories and category not in target_categories:
        continue
```

#### 3.2.4. Compteur `total_to_scan`

Un compteur est calculé en début de fonction pour permettre l'affichage de la barre de progression :

```python
school_cats = [c for c in SCHOOL_LEVEL_CATEGORIES if not target_categories or c in target_categories]
prog_cats = [c for c in PROGRAM_LEVEL_CATEGORIES if not target_categories or c in target_categories]
total_to_scan = len(school_cats) + (len(programs) * len(prog_cats))
```

Les constantes extraites en haut du fichier :
```python
SCHOOL_LEVEL_CATEGORIES = ["SchoolStats", "Accreditation"]
PROGRAM_LEVEL_CATEGORIES = ["Pricing", "Ranking", "Capacity"]
```

#### 3.2.5. Appels `progress_callback()`

Avant chaque appel Tavily Research :

```python
if progress_callback:
    progress_callback({
        "current_action": f"Recherche {category}",
        "school": school_name,
        "program": program["name"],  # ou None pour les catégories école
        "category": category,
        "progress": f"{categories_scanned}/{total_to_scan}",
    })
```

Et à la fin :
```python
if progress_callback:
    progress_callback({
        "current_action": "Terminé",
        "school": school_name,
        "progress": f"{categories_scanned}/{total_to_scan}",
        "tickets_created": tickets_created,
    })
```

#### 3.2.6. Message de retour enrichi

Le dict retourné inclut désormais un `message` explicite :

```python
return {
    "success": True,
    "tickets_created": tickets_created,
    "message": f"{tickets_created} ticket(s) créé(s) sur {categories_scanned} scans"
}
```

---

### 3.3. `backend/pipeline/phase1_research.py`

#### 3.3.1. Nouvelle signature

```python
def run_phase1_research(
    school_id: str, key_manager, dry_run: bool = False,
    progress_callback: Callable[[dict], None] | None = None
) -> dict:
```

#### 3.3.2. Points d'émission de progression

5 appels `progress_callback()` aux étapes clés :

| Étape | `current_action` |
|---|---|
| Avant lecture BDD | `"Lecture de l'école en BDD"` |
| Avant CronTarget check | `"Vérification CronTarget"` |
| Avant Tavily Research | `"Recherche Tavily Research en cours..."` |
| Avant parsing résultat | `"Analyse et structuration du résultat"` |
| Avant INSERT Inbox | `"Insertion dans ContributionInbox"` |

Chaque appel inclut `school` (nom de l'école une fois connu, ou `school_id` avant) et `category: "Program_Discovery"`.

---

## 4. Frontend — Modifications Détaillées

### 4.1. `app/api/admin/trigger-research/route.ts` (NOUVEAU)

Route proxy protégée par `guardAuth()` (session NextAuth).

**Méthode :** `POST`  
**Body attendu :**
```json
{
  "school_id": "uuid",
  "phase": "1" | "2",
  "program_id": "uuid (optionnel)",
  "categories": ["Pricing", "Ranking"] // optionnel
}
```

**Comportement :**
- Valide `school_id` (requis) et `phase` (doit être "1" ou "2")
- Forward vers `POST http://localhost:8000/internal/trigger-targeted-research/{school_id}`
- Timeout de 10 secondes (plus long que les 4s du pipeline-status car le backend peut mettre un moment à répondre)
- Retourne 503 si le backend est down, 504 si timeout

### 4.2. `app/api/admin/schools-with-programs/route.ts` (NOUVEAU)

**Méthode :** `GET`  
**Auth :** `guardAuth()`  
**Requête Prisma :**

```typescript
prisma.school.findMany({
  where: { status: "ACTIVE" },
  orderBy: { name: "asc" },
  select: {
    id: true,
    name: true,
    official_domain: true,
    campuses: {
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        programs: {
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        },
      },
    },
  },
})
```

**Réponse :**
```json
[
  {
    "id": "uuid-ecole",
    "name": "EMLV",
    "official_domain": "emlv.fr",
    "campuses": [
      {
        "id": "uuid-campus",
        "name": "Campus Paris La Défense",
        "programs": [
          { "id": "uuid-pgm", "name": "Programme Grande École" },
          { "id": "uuid-pgm2", "name": "Bachelor Digital & IA" }
        ]
      }
    ]
  }
]
```

### 4.3. `app/admin/cron/page.tsx`

#### 4.3.1. Nouvelles interfaces TypeScript

```typescript
interface ProgressDetails {
  current_action: string;
  school?: string;
  program?: string;
  category?: string;
  progress?: string;       // ex: "5/12"
  tickets_created?: number;
  updated_at?: number;
}

interface PipelineJob {
  // ... champs existants ...
  progress_details?: ProgressDetails;
  created_at?: number;      // timestamp UNIX (time.time())
}

interface ProgramInfo { id: string; name: string; }
interface CampusInfo { id: string; name: string; programs: ProgramInfo[]; }
interface SchoolWithPrograms {
  id: string;
  name: string;
  official_domain: string;
  campuses: CampusInfo[];
}
```

#### 4.3.2. Nouveaux states React

```typescript
// Formulaire de recherche manuelle
const [schools, setSchools] = useState<SchoolWithPrograms[]>([]);
const [loadingSchools, setLoadingSchools] = useState(false);
const [selectedPhase, setSelectedPhase] = useState<"1" | "2">("1");
const [selectedSchoolId, setSelectedSchoolId] = useState<string>("");
const [selectedProgramId, setSelectedProgramId] = useState<string>("");
const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
const [launchingResearch, setLaunchingResearch] = useState(false);
const [launchMessage, setLaunchMessage] = useState<{type: "success" | "error", text: string} | null>(null);

// Timer pour le calcul du temps écoulé (tick chaque seconde)
const [tick, setTick] = useState(0);
```

#### 4.3.3. Helpers utilitaires

```typescript
// Formate un nombre de secondes en "Xm Ys"
function formatElapsed(seconds: number): string

// Parse "5/12" en { done: 5, total: 12 }
function parseProgress(progress?: string): { done: number; total: number } | null
```

#### 4.3.4. Derived state (useMemo)

```typescript
// École sélectionnée avec ses campus/programmes
const selectedSchool = useMemo(...)

// Liste aplatie de tous les programmes de l'école sélectionnée
const allPrograms = useMemo(...)

// Détection d'un job actif pour l'école sélectionnée
const schoolHasActiveJob = useMemo(...)

// Catégories disponibles selon la sélection (programme ou école)
const availableCategories = useMemo(...)

// Bouton "Lancer" activable ?
const canLaunch = useMemo(...)
```

#### 4.3.5. Section "Tâches en cours" enrichie

Structure de rendu d'une tâche :

```
┌─────────────────────────────────────────────────────────────────┐
│ ● Phase 2 — Enrichissement ciblé — EMLV             ⏱ 2m 34s  │
│ ─────────────────────────────────────────────────────────────── │
│ 🔍 Recherche Ranking sur "Programme Grande École"               │
│                                                                 │
│ ████████████░░░░░░░░░░░░  5/12 catégories                      │
│                                                                 │
│ [En cours]                                     Job #a1b2c3d4   │
└─────────────────────────────────────────────────────────────────┘
```

- **Barre de progression** animée (gradient accent → violet, transition 0.6s)
- **Dot animé** : vert pulsant pour `running`, orange pour `queued`
- **Timer** : recalculé chaque seconde via le `tick` state
- **Shimmer** : bordure supérieure animée pour les tâches actives

#### 4.3.6. Section "Lancer une Recherche Manuelle"

Formulaire intégré dans la page (colonne droite du dashboard grid) :

1. **Toggle Phase 1/2** : Deux boutons radio stylisés avec indicateur actif (box-shadow inset)
2. **Dropdown École** : Chargé depuis `/api/admin/schools-with-programs` au mount
3. **Dropdown Programme** (Phase 2 uniquement) : `<optgroup>` par campus, option "Tous les programmes"
4. **Checkboxes Catégories** (Phase 2 uniquement) :
   - Si un programme est sélectionné : Pricing, Ranking, Capacity
   - Si aucun programme : SchoolStats, Accreditation, Pricing, Ranking, Capacity
5. **Bouton "Lancer"** : Gradient accent, désactivé si job actif ou champs manquants
6. **Message feedback** : Toast animé (fadeIn) succès/erreur après lancement

#### 4.3.7. Labels catégories en français

```typescript
const CATEGORY_LABELS: Record<string, string> = {
  Pricing: "💰 Tarifs",
  Ranking: "🏆 Classements",
  Capacity: "🎓 Places",
  SchoolStats: "📊 Statistiques école",
  Accreditation: "🏅 Accréditations",
};
```

#### 4.3.8. Layout restructuré

Ancien layout :
```
[Pipeline & Tavily (4fr)] [Cron Targets (6fr)]
```

Nouveau layout :
```
[Tâches en cours (full width)]
[Pipeline & Tavily (4fr)] [Recherche Manuelle (6fr)]
[Cron Targets (full width)]
```

---

## 5. Nouveaux Endpoints

### 5.1. Backend FastAPI

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/internal/trigger-targeted-research/{school_id}` | Bearer token | Lance une recherche ciblée (Phase 1 ou Phase 2 avec filtres) |

### 5.2. Frontend Next.js (proxy)

| Méthode | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/admin/trigger-research` | Session NextAuth | Proxy → FastAPI `trigger-targeted-research` |
| `GET` | `/api/admin/schools-with-programs` | Session NextAuth | Liste des écoles ACTIVE avec campus + programmes |

### 5.3. Endpoints INCHANGÉS

| Route | Note |
|---|---|
| `POST /internal/trigger-scan/{school_id}` | Toujours fonctionnel, utilise maintenant `update_progress()` |
| `POST /internal/trigger-enrichment/{school_id}` | Idem |
| `GET /internal/pipeline-status` | Enrichi avec `progress_details` dans chaque job |
| `POST /internal/research-test/{school_id}` | Inchangé |

---

## 6. Interfaces et Types

### 6.1. Format `progress_details` dans `pipeline-status`

```json
{
  "current_action": "Recherche Ranking",
  "school": "EMLV",
  "program": "Programme Grande École",
  "category": "Ranking",
  "progress": "5/12",
  "updated_at": 1718182800.123
}
```

| Champ | Type | Description |
|---|---|---|
| `current_action` | `string` | Action humainement lisible en cours |
| `school` | `string?` | Nom de l'école (ou school_id si pas encore chargé) |
| `program` | `string?` | Nom du programme cible (null pour catégories école) |
| `category` | `string?` | Catégorie en cours (`Pricing`, `Ranking`, etc.) |
| `progress` | `string?` | Fraction "done/total" (ex: `"5/12"`) |
| `tickets_created` | `int?` | Nombre de tickets créés (seulement à la fin) |
| `updated_at` | `float` | Timestamp UNIX de la dernière mise à jour |

### 6.2. Format `TargetedResearchRequest`

```json
{
  "phase": "2",
  "program_id": "uuid-programme-optionnel",
  "categories": ["Ranking", "Pricing"]
}
```

---

## 7. Flux de Données Complet

### 7.1. Lancement d'une recherche ciblée

```
Frontend (page.tsx)
  │
  ├── POST /api/admin/trigger-research
  │     Body: { school_id, phase: "2", program_id: "uuid", categories: ["Ranking"] }
  │     │
  │     └── [guardAuth() vérifie session NextAuth]
  │         │
  │         └── POST /internal/trigger-targeted-research/{school_id}
  │               Body: { phase: "2", program_id: "uuid", categories: ["Ranking"] }
  │               │
  │               ├── Vérif: aucun job actif pour cette école
  │               ├── Crée entrée dans _pipeline_jobs
  │               ├── asyncio.create_task(_run_targeted_research(...))
  │               └── Retourne { job_id, status: "queued" }
  │
  └── [Réponse affichée en toast succès/erreur]
```

### 7.2. Exécution et progression

```
_run_targeted_research()
  │
  ├── _pipeline_jobs[key]["status"] = "running"
  ├── update_progress(job_id, { current_action: "Démarrage Phase 2" })
  │
  ├── run_phase2_research(
  │     school_id, key_manager,
  │     target_program_id="uuid",
  │     target_categories=["Ranking"],
  │     progress_callback=progress_cb
  │   )
  │   │
  │   ├── [SQL: charge seulement le programme ciblé]
  │   ├── [Boucle: uniquement catégorie "Ranking"]
  │   ├── progress_cb({ action: "Recherche Ranking", program: "PGE", progress: "1/1" })
  │   ├── create_research_task(query, ..., model="pro")
  │   ├── [Polling Tavily Research 30-120s]
  │   ├── [Parse résultat → JSON]
  │   ├── [has_data_changed() vs production]
  │   ├── [INSERT ContributionInbox si changement]
  │   └── return { success: True, tickets_created: 1 }
  │
  ├── _pipeline_jobs[key]["status"] = "completed"
  └── _cleanup_progress(job_id)
```

### 7.3. Polling frontend (toutes les 5s)

```
setInterval(fetchPipelineStatus, 5000)
  │
  └── GET /api/admin/pipeline-status
        │
        └── GET /internal/pipeline-status
              │
              ├── Collecte active_jobs depuis _pipeline_jobs
              ├── Enrichit chaque job avec _pipeline_progress[job_id]
              └── Retourne { pipeline_jobs: [{ ..., progress_details: {...} }] }
```

---

## 8. Backward Compatibility

### 8.1. `run_phase2_research()`

Les 3 nouveaux params sont optionnels avec valeur `None` par défaut :

```python
# Appel existant (scheduler) — INCHANGÉ :
run_phase2(school_id, key_manager)

# Appel existant (_run_enrichment) — INCHANGÉ via lambda :
lambda: run_phase2(school_id, key_manager, progress_callback=progress_cb)

# Nouvel appel ciblé :
run_phase2_research(school_id, key_manager,
    target_program_id="uuid", target_categories=["Ranking"],
    progress_callback=cb)
```

### 8.2. `run_phase1_research()`

Le nouveau param est optionnel :

```python
# Appel existant — INCHANGÉ :
run_phase1_research(school_id, key_manager)

# Avec progression :
run_phase1_research(school_id, key_manager, progress_callback=cb)
```

### 8.3. `_run_scan()` et `_run_enrichment()`

Changement interne : utilisent désormais `lambda` au lieu d'args positionnels dans `run_in_executor` pour passer `progress_callback` comme kwarg. Les fonctions appelées restent les mêmes.

---

## 9. Tests et Vérification

### 9.1. Tests effectués

| Test | Commande / Méthode | Résultat |
|---|---|---|
| Compilation TypeScript | `npx tsc --noEmit` | ✅ Aucune erreur |
| Compilation Python | `py_compile.compile()` sur les 3 fichiers | ✅ OK |
| Backend `/health` | `GET http://localhost:8000/health` | ✅ 200 OK |
| Pipeline status | `GET /internal/pipeline-status` (avec token) | ✅ Retourne les jobs avec `progress_details` |
| Targeted research | `POST /internal/trigger-targeted-research/test-id` | ✅ Crée un job visible dans `pipeline-status` |
| Schools with programs | `GET /api/admin/schools-with-programs` | ✅ 401 (auth protégée → route compilée) |

### 9.2. Tests manuels recommandés

1. **Progression Phase 1** : Ouvrir `/admin/cron` → Sélectionner Phase 1 + une école → Lancer → Observer la progression en temps réel
2. **Recherche ciblée Phase 2** : Sélectionner Phase 2 + une école + un programme + cocher "Ranking" → Vérifier qu'un seul appel Research est effectué
3. **Sélecteur en cascade** : Vérifier que changer d'école recharge les programmes groupés par campus
4. **Protection doublon** : Lancer un job → tenter d'en relancer un → vérifier le message de blocage
5. **Backward compat scheduler** : Vérifier que les jobs APScheduler (`phase1_scanner`, `phase2_enricher`) tournent toujours normalement
