# Visibilité des jobs Cron APScheduler dans `/admin/cron`

Les jobs déclenchés par APScheduler (`phase1_scanner`, `phase2_enricher`, `crowdsourcing_processor`) sont actuellement invisibles dans le dashboard admin. Seuls les jobs lancés manuellement via les endpoints `trigger-*` s'affichent dans la section "Tâches en cours". L'objectif est d'enregistrer les jobs Cron dans le même `_pipeline_jobs` que les jobs manuels, avec un champ `source` pour les distinguer, et d'ajouter une section séparée dans le frontend.

## Proposed Changes

### Backend — Enregistrement des jobs Cron

#### [MODIFY] [internal.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/routers/internal.py)

- Ajouter une fonction publique `register_cron_job(job_id, school_id, phase, source="cron")` qui insère dans `_pipeline_jobs` avec `source: "cron"`
- Ajouter une fonction publique `complete_cron_job(job_key, success, result=None, error=None)` qui met à jour le statut d'un job cron (completed/failed)
- Modifier `pipeline_status` pour inclure le champ `source` dans la réponse, et séparer les jobs en deux listes : `pipeline_jobs` (manuels, comme avant) et `cron_jobs` (automatiques)

---

#### [MODIFY] [jobs.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/scheduler/jobs.py)

- Dans `phase1_scanner()` : 
  - Au démarrage du scan, appeler `register_cron_job()` pour enregistrer un job avec `phase="Phase 1 — Cartographie (Auto)"`, `source="cron"`
  - Pour chaque école traitée, enregistrer un sous-job dans `_pipeline_jobs`
  - À la fin (succès ou erreur), appeler `complete_cron_job()` pour mettre à jour le statut

- Dans `phase2_enricher()` :
  - Même logique que Phase 1 mais avec `phase="Phase 2 — Enrichissement (Auto)"`

- Dans `process_pending_submissions` (via wrapper) :
  - Même pattern, avec `phase="Crowdsourcing (Auto)"`

> **Note :** `jobs.py` tourne dans un thread APScheduler (pas dans la boucle async). L'accès à `_pipeline_jobs` (dict Python) est thread-safe pour les opérations simples d'assignation/lecture (GIL Python), donc pas besoin de `threading.Lock` pour ce cas d'usage.

---

### Frontend — Section Cron séparée

#### [MODIFY] [page.tsx](file:///c:/Users/aparede/Desktop/dev/appVC/app/admin/cron/page.tsx)

- Mettre à jour l'interface `PipelineStatus` pour inclure `cron_jobs: PipelineJob[]`
- Ajouter un champ `source?: string` dans l'interface `PipelineJob`
- Ajouter une nouvelle section **"🔄 Tâches automatiques (Cron)"** au-dessus ou en dessous de la section "⚡ Tâches en cours" existante
- Cette section affiche les jobs Cron avec les infos de base uniquement : phase, école, statut (running/queued), timer écoulé
- La section existante "⚡ Tâches en cours" ne montre que les jobs manuels (pas de changement de comportement)
- Style : reprendre le design des task-cards existantes mais avec un accent visuel différent (ex: bordure verte au lieu de bleu/violet) pour bien distinguer

---

### Frontend — Proxy API (aucun changement)

#### [NO CHANGE] [route.ts](file:///c:/Users/aparede/Desktop/dev/appVC/app/api/admin/pipeline-status/route.ts)

Le proxy Next.js transmet déjà la réponse complète du backend. Les nouveaux champs `cron_jobs` passeront automatiquement.

---

## Verification Plan

### Manual Verification
1. Lancer le backend (`uvicorn`) et le frontend (`npm run dev`)
2. Déclencher manuellement un scan Phase 1 depuis `/admin/cron` → vérifier qu'il apparaît dans "⚡ Tâches en cours" (section manuelle) comme avant
3. Attendre qu'un job Cron se déclenche (ou forcer un trigger en réduisant temporairement l'intervalle) → vérifier qu'il apparaît dans "🔄 Tâches automatiques (Cron)" avec les infos de base
4. Vérifier que les deux sections sont bien séparées visuellement
5. Vérifier que le polling 5s rafraîchit bien les deux sections
