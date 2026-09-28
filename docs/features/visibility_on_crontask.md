# Visibilité des jobs Cron APScheduler dans `/admin/cron`

> **Statut au 28 septembre 2026 : remplacé par la table `PipelineJob`.** Le
> registre en mémoire décrit ici (`_pipeline_jobs`, `register_cron_job`,
> `complete_cron_job`) a été supprimé par la migration
> `20260902100000_pipeline_job_state` : il était perdu à chaque redémarrage et
> laissait une école verrouillée par un job fantôme. Les jobs cron sont désormais
> des lignes `PipelineJob` (`source = "cron"`), ouvertes par `_start_cron_job` et
> closes par `_finish_cron_job` dans `scheduler/jobs.py`. Référence :
> `architecture/architecture.md` §3.5 bis.
>
> **Toujours vrai :** `/admin/cron` n'affiche ni `scheduler.last_runs`, ni
> `has_failure`, ni `research_cron` (pourquoi les jobs Research sont inscrits ou
> non). Un cron en échec — ou un cron désactivé hors production — reste
> invisible à l'écran.

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

---

## Implémenté, puis complété le 1er septembre 2026

Le plan ci-dessus est en place : `register_cron_job()` et `complete_cron_job()`
existent, `phase1_scanner` et `phase2_enricher` les appellent par école, et
`/internal/pipeline-status` sépare `pipeline_jobs` de `cron_jobs`.

**Mais il manquait l'essentiel : la visibilité d'un job qui échoue avant même de
traiter une école.**

### Le cas qui échappait au dispositif

`phase1_scanner` lisait la liste des écoles avec `ORDER BY s."createdAt"` — **une
colonne qui n'existe pas** sur `School`, ni au schéma Prisma ni dans les
migrations (seules `User` et `ContributionInbox` en possèdent une).

Chaîne d'échec :

```
psycopg2 lève UndefinedColumn
  → le except Exception l'intercepte
  → une ligne de log est écrite
  → return
```

Du point de vue d'APScheduler, le job se terminait **normalement**. Aucun
`register_cron_job()` n'avait encore été appelé, donc rien n'apparaissait dans
`cron_jobs`. **Aucune école n'a jamais été cartographiée automatiquement**, et le
panneau admin n'affichait aucune anomalie.

*Reproduit puis vérifié contre la base réelle : l'ancienne requête renvoie
`column s.createdAt does not exist`, la nouvelle passe.*

### Ce qui a été ajouté

**1. Un registre du dernier passage de chaque job** — `_last_job_runs` dans
`jobs.py`, alimenté par `_record_job_run(job_id, status, detail)` : sur échec de
lecture BDD, sur « rien à traiter », et en fin de passage.

**2. `get_scheduler_status()` sorti du code mort.** La fonction existait et
n'était **jamais appelée**. Elle expose désormais `last_run` par job, `last_runs`
global, et un drapeau `has_failure`.

**3. `/internal/pipeline-status` remonte le tout :**

```json
{
  "status": "degraded",
  "database": "connected",
  "scheduler": { "running": true, "jobs": [...], "last_runs": {...}, "has_failure": true },
  "cron_jobs": [...]
}
```

**Un cron en échec fait passer `status` à `degraded`**, même quand la base répond.

**4. `database` dit enfin la vérité.** `db_ok` était codé en dur à `True`, avec le
commentaire « en production la BDD est toujours accessible ».
`check_db_connection()` existait dans `db.py` — un `SELECT 1` — et n'était jamais
appelé. Il l'est désormais, dans un `try` pour que l'endpoint de supervision ne
tombe pas à cause de ce qu'il est censé superviser.

**5. Premier déclenchement après démarrage.** *(Depuis le 28 septembre 2026, ce
passage n'a lieu qu'en production : voir `research_cron_enabled()`.)* Le trigger était réglé à 168 h
**sans `next_run_time`** : le premier passage n'avait lieu qu'une semaine après
chaque redémarrage — donc jamais, sur une instance qui redémarre régulièrement.
Une `start_date` à +5 min est posée, réglable par
`CRON_PHASE1_INITIAL_DELAY_MINUTES`.

> **Attention au coût** : chaque redémarrage déclenche désormais une cartographie
> 5 minutes plus tard, avec la consommation Tavily correspondante.

**6. Libellé aligné sur la réalité.** Le job crowdsourcing annonçait « toutes les
5 m » dans son nom et dans le log de démarrage, alors que son déclencheur était
réglé sur **1 minute**. C'est l'intervalle réel qui a été conservé, et les
libellés lisent maintenant la constante `CROWDSOURCING_INTERVAL_MINUTES`.

### Reste à faire côté frontend

`/admin/cron` ne consomme pas encore `scheduler.last_runs` ni `has_failure`. Le
signal existe côté API, il n'est pas affiché : **un cron en échec reste invisible
pour l'opérateur tant que cette section n'est pas ajoutée.**
