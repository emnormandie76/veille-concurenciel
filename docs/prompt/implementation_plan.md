# 🧹 Plan de Nettoyage Exhaustif — School Data Pipeline

> **Version :** 1.0 — 1er juillet 2026  
> **Objectif :** Nettoyer le projet en supprimant deux features obsolètes et en promouvant le pipeline Research comme pipeline de base unique  
> **Destinataire :** Agent IA développeur (Claude Sonnet) pour exécution

---

## Table des Matières

1. [Résumé des Changements](#1-résumé-des-changements)
2. [AXE 1 — Suppression de l'Ancien Pipeline (crawl+search+Gemma)](#2-axe-1--suppression-de-lancien-pipeline)
3. [AXE 2 — Suppression de la Feature CronTarget](#3-axe-2--suppression-de-la-feature-crontarget)
4. [Fichiers à Supprimer (Liste Complète)](#4-fichiers-à-supprimer)
5. [Fichiers à Modifier (Détail Précis)](#5-fichiers-à-modifier)
6. [Migration Prisma](#6-migration-prisma)
7. [Documentation à Mettre à Jour](#7-documentation-à-mettre-à-jour)
8. [Plan de Vérification](#8-plan-de-vérification)
9. [Ordre d'Exécution Recommandé](#9-ordre-dexécution-recommandé)

---

## 1. Résumé des Changements

### AXE 1 — Ancien Pipeline → Pipeline Research comme base

L'ancien pipeline fonctionnait ainsi :
- **Phase 1** : Tavily `crawl` → Gemma 31B (extraction) → ContributionInbox
- **Phase 2** : Tavily `search` → Gemma 26B (tri) → Gemma 31B (extraction) → diff → ContributionInbox

Le **nouveau pipeline Research** (déjà implémenté et testé sur la branche `devresearch`) remplace tout cela par :
- **Phase 1** : Tavily Research API (agent autonome) → JSON direct ou Gemma 26B fallback → ContributionInbox
- **Phase 2** : Tavily Research API par catégorie → JSON direct ou Gemma 26B fallback → diff → ContributionInbox

**Action :** Supprimer les fichiers de l'ancien pipeline, supprimer le switch `USE_RESEARCH_PIPELINE`, et renommer les fonctions Research pour qu'elles deviennent les fonctions de base.

### AXE 2 — Suppression de CronTarget

Le modèle `CronTarget` servait à tracker les cibles de scan du cron (échecs, blacklist). Cette feature est jugée inutile et polluait la page admin/cron.

**Action :** Supprimer le modèle Prisma, les API routes associées, et retirer la section "Cibles de Scan" de la page admin/cron.

---

## 2. AXE 1 — Suppression de l'Ancien Pipeline

### 2.1. Fichiers de l'ancien pipeline à SUPPRIMER

| Fichier | Raison de suppression |
|---|---|
| `backend/pipeline/phase1.py` | Ancien Phase 1 (crawl + Gemma 31B). Remplacé par `phase1_research.py` |
| `backend/pipeline/phase2.py` | Ancien Phase 2 (search + Gemma 26B tri + Gemma 31B). Remplacé par `phase2_research.py` |
| `backend/ai/prompts.py` | Anciens prompts système pour Gemma (Phase 1 + Phase 2 de l'ancien pipeline). Les nouveaux prompts sont dans `research_prompts.py` |
| `backend/tavily_service/strategies.py` | `PIPELINE_STRATEGIES` dict utilisé uniquement par l'ancien Phase 2. Les nouvelles stratégies sont gérées via les prompts dynamiques dans `research_prompts.py` |
| `backend/simulate_run.py` | Script de simulation Phase 1 ancienne. Remplacé par `simulate_phase1_research.py` |
| `backend/simulate_run_phase2.py` | Script de simulation Phase 2 ancienne. Remplacé par `simulate_phase2_research.py` |
| `backend/em_normandie_phase1_results.json` | Résultats de test de l'ancien pipeline — obsolète |
| `backend/em_normandie_phase2_results.json` | Résultats de test de l'ancien pipeline — obsolète |

### 2.2. Fichiers du pipeline Research à RENOMMER

> [!IMPORTANT]
> Le renommage est optionnel mais recommandé pour la clarté. Les fichiers `*_research.py` deviendraient les fichiers de base car il n'y a plus d'alternative.

| Fichier actuel | Nouveau nom (optionnel) | Raison |
|---|---|---|
| `backend/pipeline/phase1_research.py` | `backend/pipeline/phase1.py` | Devient le seul Phase 1 |
| `backend/pipeline/phase2_research.py` | `backend/pipeline/phase2.py` | Devient le seul Phase 2 |
| `backend/simulate_phase1_research.py` | `backend/simulate_phase1.py` | Plus besoin du suffixe `_research` |
| `backend/simulate_phase2_research.py` | `backend/simulate_phase2.py` | Plus besoin du suffixe `_research` |

> [!WARNING]
> Si le renommage est fait, il faut mettre à jour **tous les imports** dans les fichiers qui référencent ces modules (voir section 5).

### 2.3. Fichiers de l'ancien pipeline qui RESTENT (utilisés par le crowdsourcing)

| Fichier | Raison de conservation |
|---|---|
| `backend/tavily_service/client.py` | Utilisé pour `crawl`, `search`, `extract` dans le **Crowdsourcing** (Workflow A). Le crowdsourcing n'utilise PAS le pipeline Research |
| `backend/tavily_service/key_manager.py` | Rotation de clés — utilisé par TOUT (Research inclus) |
| `backend/tavily_service/research_client.py` | Client Research — conservé, c'est le nouveau pipeline |
| `backend/ai/gemma_client.py` | Utilisé en fallback par le pipeline Research (Gemma 26B) ET par le crowdsourcing |
| `backend/ai/research_prompts.py` | Prompts dynamiques du pipeline Research — conservé |
| `backend/ai/research_schemas.py` | JSON Schemas pour `output_schema` — conservé |
| `backend/pipeline/diff.py` | Comparaison vs production — utilisé par le pipeline Research Phase 2 |
| `backend/crowdsourcing/processor.py` | Workflow A (crowdsourcing) — totalement indépendant |

---

## 3. AXE 2 — Suppression de la Feature CronTarget

### 3.1. Ce qui est supprimé

| Élément | Fichier(s) concerné(s) | Description |
|---|---|---|
| **Modèle Prisma `CronTarget`** | `prisma/schema.prisma` | Table BDD de suivi des cibles de scan |
| **API GET cron-targets** | `app/api/admin/cron-targets/route.ts` | Liste des CronTargets |
| **API PUT unblock** | `app/api/admin/cron-targets/[id]/unblock/route.ts` | Déblocage d'un CronTarget blacklisté |
| **Section UI "Cibles de Scan"** | `app/admin/cron/page.tsx` | Section entière dans la page admin/cron |
| **Seed de test** | `prisma/seed_test_cron.ts` | Script de seed pour les CronTargets de test |
| **Logique backend `_record_failure`** | `backend/pipeline/phase1_research.py`, `phase2_research.py` | Fonctions `_record_failure()` et `_check_blacklist()` qui géraient le CronTarget |
| **Relations Prisma** | `prisma/schema.prisma` | `cronTargets` sur `School` et `Program` |

### 3.2. Impact sur la logique métier

La suppression de CronTarget signifie :
- **Plus de blacklist après 3 échecs** — Si un scan échoue, il sera simplement retenté au prochain passage du cron
- **Plus de suivi des échecs** — Les erreurs sont uniquement loguées dans la console
- **L'Admin ne voit plus la section "Cibles de Scan"** sur la page cron — La page devient plus propre avec uniquement le statut du pipeline, les quotas Tavily, et la recherche manuelle

> [!NOTE]
> La page `/admin/cron` conservera : le statut du backend, les tâches en cours (avec progression), les quotas Tavily, et le formulaire de recherche manuelle.

---

## 4. Fichiers à Supprimer (Liste Complète)

### 4.1. Fichiers backend (ancien pipeline)

```
SUPPRIMER :
  backend/pipeline/phase1.py                          # Ancien Phase 1 (crawl+Gemma)
  backend/pipeline/phase2.py                          # Ancien Phase 2 (search+Gemma tri+extraction)
  backend/ai/prompts.py                               # Anciens prompts Gemma (Phase 1+2)
  backend/tavily_service/strategies.py                # PIPELINE_STRATEGIES (ancien Phase 2)
  backend/simulate_run.py                             # Simulation ancien Phase 1
  backend/simulate_run_phase2.py                      # Simulation ancien Phase 2
  backend/em_normandie_phase1_results.json            # Résultats de test obsolètes
  backend/em_normandie_phase2_results.json            # Résultats de test obsolètes
```

### 4.2. Fichiers frontend (CronTarget)

```
SUPPRIMER :
  app/api/admin/cron-targets/route.ts                  # GET liste CronTargets
  app/api/admin/cron-targets/[id]/unblock/route.ts     # PUT débloquer un CronTarget
```

> [!TIP]
> Supprimer aussi les dossiers vides résultant (`app/api/admin/cron-targets/` et ses sous-dossiers).

### 4.3. Fichiers Prisma (CronTarget)

```
SUPPRIMER :
  prisma/seed_test_cron.ts                             # Seed de test pour CronTargets
```

---

## 5. Fichiers à Modifier (Détail Précis)

### 5.1. `prisma/schema.prisma`

**Changement 1 — Supprimer le modèle CronTarget :**

```diff
-model CronTarget {
-  id                    String    @id @default(uuid())
-  schoolId              String
-  programId             String?
-  data_category         String
-  last_failed_attempt   DateTime?
-  failed_attempts_count Int       @default(0)
-  is_blacklisted        Boolean   @default(false)
-
-  school  School   @relation(fields: [schoolId], references: [id], onDelete: Cascade)
-  program Program? @relation(fields: [programId], references: [id], onDelete: Cascade)
-
-  @@unique([schoolId, programId, data_category])
-}
```

**Changement 2 — Retirer la relation `cronTargets` du modèle `School` :**

```diff
 model School {
   id              String   @id @default(uuid())
   name            String   @unique
   official_domain String   @unique
   status          String   @default("ACTIVE")
   campuses        Campus[]
   statsRecords    SchoolStatsRecord[]
   accreditations  AccreditationRecord[]
-  cronTargets     CronTarget[]
 }
```

**Changement 3 — Retirer la relation `cronTargets` du modèle `Program` :**

```diff
 model Program {
   ...
   pricingRecords  PricingRecord[]
   capacityRecords CapacityRecord[]
   rankingRecords  RankingRecord[]
-  cronTargets     CronTarget[]
   @@unique([campusId, name])
 }
```

> [!IMPORTANT]
> Après ces modifications, exécuter : `npx prisma migrate dev --name remove-cron-target` pour générer et appliquer la migration.

---

### 5.2. `backend/scheduler/jobs.py`

**Changement : Supprimer le switch `USE_RESEARCH_PIPELINE` et importer directement les fonctions Research :**

```diff
-USE_RESEARCH_PIPELINE = os.environ.get("USE_RESEARCH_PIPELINE", "true").lower() == "true"
```

**Dans `phase1_scanner()` :**
```diff
-    if USE_RESEARCH_PIPELINE:
-        from backend.pipeline.phase1_research import run_phase1_research as run_phase1
-    else:
-        from backend.pipeline.phase1 import run_phase1
+    from backend.pipeline.phase1_research import run_phase1_research as run_phase1
```

> [!NOTE]
> Si le renommage des fichiers est effectué (section 2.2), l'import sera simplement `from backend.pipeline.phase1 import run_phase1`.

**Dans `phase2_enricher()` :**
```diff
-    if USE_RESEARCH_PIPELINE:
-        from backend.pipeline.phase2_research import run_phase2_research as run_phase2
-    else:
-        from backend.pipeline.phase2 import run_phase2
+    from backend.pipeline.phase2_research import run_phase2_research as run_phase2
```

---

### 5.3. `backend/routers/internal.py`

**Changement 1 — `_run_scan()` : Supprimer le switch :**

```diff
 async def _run_scan(school_id: str, job_id: str):
-    from backend.scheduler.jobs import USE_RESEARCH_PIPELINE
-    if USE_RESEARCH_PIPELINE:
-        from backend.pipeline.phase1_research import run_phase1_research as run_phase1
-    else:
-        from backend.pipeline.phase1 import run_phase1
+    from backend.pipeline.phase1_research import run_phase1_research as run_phase1
```

**Changement 2 — `_run_enrichment()` : Supprimer le switch :**

```diff
 async def _run_enrichment(school_id: str, job_id: str, categories: list[str]):
-    from backend.scheduler.jobs import USE_RESEARCH_PIPELINE
-    if USE_RESEARCH_PIPELINE:
-        from backend.pipeline.phase2_research import run_phase2_research as run_phase2
-    else:
-        from backend.pipeline.phase2 import run_phase2
+    from backend.pipeline.phase2_research import run_phase2_research as run_phase2
```

---

### 5.4. `backend/pipeline/phase1_research.py`

**Changement : Retirer toute la logique CronTarget :**

Chercher et supprimer :
1. La fonction `_record_failure(school_id, category, conn)` — Suppression complète
2. La fonction `_check_blacklist(school_id, category, conn)` — Suppression complète (ou son équivalent)
3. Toute requête SQL contenant `"CronTarget"` — Supprimer les blocs `SELECT`/`UPDATE`/`INSERT`/`UPSERT` sur la table `CronTarget`
4. Les appels à `_record_failure()` dans le corps de `run_phase1_research()` — Remplacer par un simple `logger.warning(...)` ou supprimer
5. Les vérifications `is_blacklisted` — Supprimer (on ne vérifie plus la blacklist)

> [!IMPORTANT]
> En supprimant la blacklist, la logique de retry devient infinie. Les échecs seront uniquement logués. C'est le choix voulu par l'utilisateur.

---

### 5.5. `backend/pipeline/phase2_research.py`

**Même logique que phase1_research.py :**

Chercher et supprimer :
1. La fonction `_record_failure()` — Suppression complète
2. La fonction `_check_blacklist()` — Suppression complète  
3. Toute requête SQL contenant `"CronTarget"` — Supprimer les blocs  
4. Les appels à `_record_failure()` — Remplacer par `logger.warning(...)`
5. Les vérifications `is_blacklisted` — Supprimer

---

### 5.6. `backend/simulate_phase1_research.py`

**Changement : Retirer les références CronTarget si présentes :**

Chercher et supprimer toute création/lecture de `CronTarget` dans ce script de simulation.

---

### 5.7. `backend/ai/__init__.py`

**Changement : Vérifier que l'import de `prompts` (fichier supprimé) n'est pas présent :**

Si `__init__.py` fait un `from .prompts import ...`, supprimer cette ligne.

---

### 5.8. `backend/tavily_service/__init__.py`

**Changement : Vérifier que l'import de `strategies` (fichier supprimé) n'est pas présent :**

Si `__init__.py` fait un `from .strategies import ...`, supprimer cette ligne.

---

### 5.9. `backend/pipeline/__init__.py`

**Changement : Vérifier que les imports de `phase1` et `phase2` (fichiers supprimés) ne sont pas présents :**

Si `__init__.py` fait un `from .phase1 import ...` ou `from .phase2 import ...`, supprimer ces lignes.

---

### 5.10. `backend/.env`

**Changement : Supprimer la variable `USE_RESEARCH_PIPELINE` :**

```diff
-USE_RESEARCH_PIPELINE=true
```

---

### 5.11. `app/admin/cron/page.tsx`

**Changement : Supprimer la section "Cibles de Scan (Cron Targets)" :**

Cette page fait ~770 lignes. Les modifications sont :

1. **Supprimer les interfaces TypeScript liées aux CronTargets :**
   - `interface CronTarget { ... }` (ou similaire)

2. **Supprimer les states React liés aux CronTargets :**
   - `const [cronTargets, setCronTargets] = useState<...>([]);`
   - `const [loadingTargets, setLoadingTargets] = useState(false);`
   - Tout state lié au déblocage (`unblockingId`, etc.)

3. **Supprimer la fonction `fetchCronTargets()` :**
   - La fonction qui appelle `GET /api/admin/cron-targets`

4. **Supprimer la fonction `handleUnblock()` :**
   - La fonction qui appelle `PUT /api/admin/cron-targets/[id]/unblock`

5. **Supprimer le `useEffect` ou l'appel dans le polling qui charge les CronTargets**

6. **Supprimer le JSX de la section "Cibles de Scan" :**
   - Le bloc complet qui affiche la grille/tableau des cibles avec statuts (Actif/En échec/Bloqué) et boutons "Débloquer"

7. **Ajuster le layout grid :**
   - Ancien layout :
     ```
     [Tâches en cours (full width)]
     [Pipeline & Tavily (4fr)] [Recherche Manuelle (6fr)]
     [Cron Targets (full width)]
     ```
   - Nouveau layout (sans CronTargets) :
     ```
     [Tâches en cours (full width)]
     [Pipeline & Tavily (4fr)] [Recherche Manuelle (6fr)]
     ```

---

### 5.12. `backend/main.py`

**Vérification :** Ce fichier inclut le router `internal.py` et initialise le scheduler. 

Pas de modification directe attendue, SAUF si `main.py` importe ou référence directement les anciens fichiers pipeline (`phase1.py`, `phase2.py`) ou `strategies.py`. Vérifier les imports.

---

## 6. Migration Prisma

Après modification du `schema.prisma` (suppression de `CronTarget` et des relations) :

```bash
# 1. Générer la migration
npx prisma migrate dev --name remove-cron-target

# 2. Vérifier que la migration SQL contient :
#    - DROP TABLE "CronTarget"
#    - Pas d'impact sur les autres tables (seulement suppression de FK)

# 3. Regénérer le client Prisma
npx prisma generate
```

> [!CAUTION]
> Cette migration est **destructive** : toutes les données de la table `CronTarget` seront perdues. C'est voulu — la feature est supprimée.

---

## 7. Documentation à Mettre à Jour

> [!NOTE]
> Les fichiers markdown suivants dans `docs/` devront être mis à jour pour refléter les changements. Ceci est fait séparément dans la même session.

| Fichier | Type de modification |
|---|---|
| `docs/architecture/architecture.md` | Très impacté — Supprimer les refs à l'ancien pipeline, CronTarget, `USE_RESEARCH_PIPELINE`, `PIPELINE_STRATEGIES`, et promouvoir le pipeline Research comme pipeline de base |
| `docs/architecture/bdd.md` | Supprimer le modèle `CronTarget`, supprimer les relations `cronTargets` des modèles `School` et `Program`, mettre à jour la section "Directives" |
| `docs/architecture/task.md` | Supprimer les références aux anciens fichiers (phase1.py, phase2.py, prompts.py, strategies.py) et CronTarget |
| `docs/architecture/gemma-python-guide.md` | Peu impacté — reste pertinent pour le fallback Gemma 26B et le crowdsourcing |
| `docs/cahier-des-charges-school-pipeline.md` | Mettre à jour la Stack IA (plus de Gemma 31B dans le pipeline principal), supprimer CronTarget |
| `docs/agent-prompt.md` | Mettre à jour le contexte technique, les règles, et le pipeline en 2 phases |
| `docs/edgecase.md` | Mettre à jour les edge cases impactés (EC4 blacklist supprimé, EC9/EC11 améliorés par Research) |
| `docs/features/research-pipeline-plan.md` | Marquer comme "implémenté et promu" — supprimer la notion de fallback vers l'ancien |
| `docs/features/admin-cron-manual-research.md` | Supprimer les refs aux anciens pipelines fallback et CronTargets |
| `docs/testing/manual_testing_cron.md` | Supprimer les sections CronTarget (seed, vérification, déblocage) |
| `docs/testing/pipeline_simulation.md` | Supprimer les sections sur les anciens scripts de simulation |

---

## 8. Plan de Vérification

### 8.1. Vérifications structurelles

```bash
# 1. Vérifier que tous les fichiers supprimés sont bien retirés
# Les fichiers suivants ne doivent PLUS exister :
ls backend/pipeline/phase1.py          # Ne doit pas exister
ls backend/pipeline/phase2.py          # Ne doit pas exister
ls backend/ai/prompts.py               # Ne doit pas exister
ls backend/tavily_service/strategies.py # Ne doit pas exister
ls backend/simulate_run.py             # Ne doit pas exister
ls backend/simulate_run_phase2.py      # Ne doit pas exister
ls app/api/admin/cron-targets/          # Dossier ne doit pas exister
ls prisma/seed_test_cron.ts             # Ne doit pas exister

# 2. Vérifier qu'aucun import ne référence les fichiers supprimés
grep -r "from backend.pipeline.phase1 import" backend/    # Doit retourner 0 résultats (ou seulement phase1_research)
grep -r "from backend.pipeline.phase2 import" backend/    # Doit retourner 0 résultats (ou seulement phase2_research)
grep -r "from backend.ai.prompts import" backend/         # Doit retourner 0 résultats
grep -r "from backend.tavily_service.strategies" backend/  # Doit retourner 0 résultats
grep -r "USE_RESEARCH_PIPELINE" backend/                   # Doit retourner 0 résultats
grep -r "CronTarget" prisma/schema.prisma                  # Doit retourner 0 résultats
grep -r "cronTargets" prisma/schema.prisma                 # Doit retourner 0 résultats
grep -r "cron-targets" app/                                # Doit retourner 0 résultats
```

### 8.2. Vérifications de compilation

```bash
# TypeScript (Next.js)
npx tsc --noEmit

# Python (compilation syntaxique de chaque fichier modifié)
python -c "import py_compile; py_compile.compile('backend/scheduler/jobs.py')"
python -c "import py_compile; py_compile.compile('backend/routers/internal.py')"
python -c "import py_compile; py_compile.compile('backend/pipeline/phase1_research.py')"
python -c "import py_compile; py_compile.compile('backend/pipeline/phase2_research.py')"
```

### 8.3. Vérifications de démarrage

```bash
# Backend FastAPI
python -m uvicorn backend.main:app --port 8000 --reload
# → Doit démarrer sans erreur d'import

# Frontend Next.js
npm run dev
# → Doit démarrer sans erreur de compilation

# Migration Prisma
npx prisma migrate dev --name remove-cron-target
npx prisma generate
# → Doit s'exécuter sans erreur
```

### 8.4. Vérifications fonctionnelles

```bash
# Healthcheck backend
curl http://localhost:8000/health
# → {"status":"ok","version":"0.4.0"}

# Pipeline status (doit fonctionner sans CronTargets)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/internal/pipeline-status
# → Ne doit pas mentionner CronTarget

# Page admin/cron (Next.js)
# → Ouvrir http://localhost:3000/admin/cron
# → La section "Cibles de Scan" ne doit PAS apparaître
# → Le formulaire "Recherche Manuelle" doit toujours fonctionner
# → Le statut du pipeline et les quotas Tavily doivent toujours s'afficher
```

---

## 9. Ordre d'Exécution Recommandé

> [!IMPORTANT]
> Suivre cet ordre pour éviter les erreurs d'import en cascade.

### Phase A — Préparation (pas de casse possible)

1. **Supprimer les fichiers obsolètes de l'ancien pipeline** (section 4.1)
   - `backend/pipeline/phase1.py`
   - `backend/pipeline/phase2.py`
   - `backend/ai/prompts.py`
   - `backend/tavily_service/strategies.py`
   - `backend/simulate_run.py`
   - `backend/simulate_run_phase2.py`
   - `backend/em_normandie_phase1_results.json`
   - `backend/em_normandie_phase2_results.json`

2. **Supprimer les fichiers CronTarget frontend** (section 4.2)
   - `app/api/admin/cron-targets/route.ts`
   - `app/api/admin/cron-targets/[id]/unblock/route.ts`
   - Le dossier `app/api/admin/cron-targets/` complet

3. **Supprimer le seed de test** (section 4.3)
   - `prisma/seed_test_cron.ts`

### Phase B — Modifications backend (ordre important)

4. **Modifier `backend/ai/__init__.py`** — Retirer import `prompts` si présent
5. **Modifier `backend/tavily_service/__init__.py`** — Retirer import `strategies` si présent
6. **Modifier `backend/pipeline/__init__.py`** — Retirer imports `phase1`/`phase2` si présents
7. **Modifier `backend/scheduler/jobs.py`** — Supprimer `USE_RESEARCH_PIPELINE` et les branches conditionnelles (section 5.2)
8. **Modifier `backend/routers/internal.py`** — Supprimer les imports conditionnels (section 5.3)
9. **Modifier `backend/pipeline/phase1_research.py`** — Retirer logique CronTarget (section 5.4)
10. **Modifier `backend/pipeline/phase2_research.py`** — Retirer logique CronTarget (section 5.5)
11. **Modifier `backend/simulate_phase1_research.py`** — Retirer refs CronTarget (section 5.6)
12. **Modifier `backend/.env`** — Retirer `USE_RESEARCH_PIPELINE` (section 5.10)

### Phase C — Modifications Prisma & Frontend

13. **Modifier `prisma/schema.prisma`** — Supprimer `CronTarget` et relations (section 5.1)
14. **Exécuter la migration Prisma** (section 6)
15. **Modifier `app/admin/cron/page.tsx`** — Supprimer section CronTargets (section 5.11)

### Phase D — Vérification

16. **Exécuter les vérifications structurelles** (section 8.1)
17. **Exécuter les vérifications de compilation** (section 8.2)
18. **Exécuter les vérifications de démarrage** (section 8.3)
19. **Exécuter les vérifications fonctionnelles** (section 8.4)

---

> **Ce document est la source de vérité pour le nettoyage du projet.**
> **Tout changement doit d'abord être documenté ici avant exécution.**
