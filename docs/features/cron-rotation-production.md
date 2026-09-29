# Feature — Recherches automatiques en production : rotation semestrielle

> **Statut :** plan validé par le propriétaire le 29 septembre 2026. Rien n'est codé.
> **Branche de départ :** `newresearch`.
> **Lire avant de coder :** ce document en entier, puis
> [`architecture.md`](../architecture/architecture.md) §3.5 bis, §5.1, §5.3,
> et `AGENTS.md` à la racine (Next.js 16 : lire `node_modules/next/dist/docs/`
> avant de toucher au front).

---

## 0. Mode d'emploi pour un agent

- Les étapes se font **dans l'ordre** : chacune s'appuie sur la précédente.
- Une case ne se coche `[x]` que lorsque le code est écrit **et** que ses tests
  passent (`npm test`, et `npm run test:ts` si du TypeScript a bougé).
- À la fin de chaque session de travail, ajouter une ligne au
  [journal de progression](#9-journal-de-progression) : ce qui est fait, ce
  qui reste, ce qui a surpris.
- Si une étape semble exiger une **migration Prisma**, s'arrêter et demander au
  propriétaire : le plan est conçu pour s'en passer. Ne jamais lancer
  `prisma db push`, `migrate dev` ni `migrate reset` (voir `architecture.md`
  §10 bis).
- Ne commiter que si le propriétaire le demande ; dans ce cas, un commit par
  étape, message en français au format du dépôt (`feat(scheduler): …`).
- Toute décision prise en cours de route qui s'écarte de ce plan est notée au
  journal, avec sa raison.

---

## 1. Pourquoi le cron actuel ne peut pas partir en production

Constats faits sur le code le 29 septembre 2026.

**1.1. La Phase 2 recherche tout, tous les jours.** `phase2_enricher`
(`backend/scheduler/jobs.py`) passe toutes les 24 h sur chaque école ayant un
campus, et `run_phase2_research` relance à chaque fois toutes les catégories,
tous les programmes et tous les couples programme × campus. Coût d'une passe
par école : `45 + 25 × programmes + 10 × couples ProgramCampus` crédits
(SchoolStats 10 + Accreditation 10 + Ranking 25, Pricing 25 par programme,
Capacity 10 par couple — `ESTIMATED_CREDITS` de `research_client.py`).
Sur la base réelle (EM Strasbourg 7 programmes / 7 couples, Em Lyon 24 / 14,
Em Normandie 15 / 30) : ~1 800 crédits par jour, **~54 000 par mois pour
trois écoles**.

**1.2. Un ticket en attente n'arrête pas la recherche.** `has_data_changed`
(`backend/pipeline/diff.py`) ne compare qu'à la **production**.
`_insert_ticket` (`phase2_research.py`) n'interroge pas l'Inbox. Un ticket que
l'admin n'a pas encore validé est donc repayé et recréé à chaque passe. La
Phase 1 fait de même : `phase1_scanner` retient les écoles **sans campus**, y
compris celles dont la découverte attend la validation (EMLV, Essec).

**1.3. Les déclencheurs sont des intervalles comptés depuis le démarrage.**
APScheduler 3.11 : sans `start_date`, un `IntervalTrigger` part à
`maintenant + intervalle` (vérifié dans
`backend/.venv/Lib/site-packages/apscheduler/triggers/interval.py`). Sur Koyeb,
qui redémarre :
- `phase1_scanner` a un `start_date` à +5 min : il part **à chaque
  redémarrage** ;
- `phase2_enricher` n'en a pas : si l'instance redémarre au moins une fois par
  24 h, il ne part **jamais**.

**1.4. Les jobs cron n'ont pas de battement de cœur.** `phase1_scanner` et
`phase2_enricher` n'envoient pas de `progress_callback`, donc `updated_at`
ne bouge pas pendant la passe. `reap_stale_jobs()` — appelé par
`get_active_job()` et `list_active_jobs()`, donc à chaque rafraîchissement de
`/admin/cron` — clôt en `failed` tout job actif muet depuis
`PIPELINE_JOB_STALE_SECONDS` (1 800 s). Une passe de Phase 2 dure plus d'une
heure : elle serait déclarée morte en cours de route, et l'école paraîtrait
libre pour un lancement manuel concurrent.

**1.5. La Phase 1 ne compare rien à la base.** `_run_program_discovery`
(`phase1_research.py`) ne lit ni `Campus` ni `Program`. Relancée sur une école
déjà cartographiée, elle rend un ticket avec **tous** les programmes. Et
`validateProgramDiscovery` (`app/api/admin/inbox/[id]/validate/route.ts`) fait
un `upsert` sur `(schoolId, name)` **exact** : « Programme Grande Ecole » au
lieu de « Programme Grande École » crée un second `Program`, que la Phase 2
cherchera et paiera ensuite.

---

## 2. Décisions du propriétaire (29 septembre 2026)

| Sujet | Décision |
|---|---|
| Nombre d'écoles | ~30 à terme |
| Budget Tavily | ~10 000 crédits par mois |
| Rythme | **Phase 1 et Phase 2 : deux fois par an par école**, soit un intervalle de 6 mois ; Phase 2 sur chaque programme |
| Journal par donnée | **Non.** Une passe par école et par semestre suffit ; on ne mémorise pas « cherché, rien trouvé » donnée par donnée |
| Ticket en attente | **Si un ticket de la même cible est encore `Pending_Admin` pour l'année cible, on ne relance pas la recherche** |
| Validation | L'admin prévoit de valider 10 à 20 tickets par mois (voir l'alerte du §3) |

Décisions d'application prises dans ce plan, réversibles :

- La garde « ticket en attente » ne concerne que les **passes automatiques**.
  Une recherche lancée à la main depuis `/admin/cron` reste libre : l'admin a
  choisi de payer.
- Elle ne compte que les tickets `source_type = 'Automated_AI'`. Un ticket de
  crowdsourcing en attente ne bloque pas le pipeline.
- La Phase 1 qui ne propose que du nouveau (étape 2) s'applique **à toutes les
  passes**, manuelles comprises : elle ne retire rien d'utile.

---

## 3. Chiffrage

Taille moyenne mesurée en base : ~15 programmes et ~17 couples programme-campus
par école.

| | Par école et par passe | 30 écoles × 2 passes par an | Par mois |
|---|---|---|---|
| Phase 1 (catalogue ~5 + Research pro 25) | ~30 | ~1 800 | ~150 |
| Phase 2 (45 + 25 × 15 + 10 × 17) | ~600 | ~36 000 | ~3 000 |
| **Total** | | | **~3 150 sur 10 000** |

**Étalement obligatoire.** Les 30 écoles le même jour coûteraient ~19 000
crédits : au-delà du budget mensuel, les clés s'épuiseraient à mi-parcours.
D'où : **au plus une passe par nuit**, et un **plafond mensuel pour le cron**
(7 000 par défaut, qui laisse ~3 000 aux recherches manuelles et au
crowdsourcing). Au démarrage, les 30 écoles sont toutes « jamais passées » :
le plafond les répartit sur 2 à 3 mois, puis chacune revient 6 mois après son
dernier passage.

> ⚠️ **Le volume de tickets dépassera la capacité de validation prévue.**
> Au premier passage d'une école, presque tout est nouveau : jusqu'à 30 à
> 40 tickets. Pendant la montée en charge (~10 écoles par mois), plusieurs
> centaines par mois. En régime établi, ~30 à 40 par école et par an, soit
> ~80 à 100 par mois pour 30 écoles — 5 à 10 fois les 10 à 20 prévus. La garde
> « en attente » empêche de repayer, pas l'accumulation. Ce point est hors
> périmètre (§7) mais doit être mesuré dès les premiers mois.

---

## 4. La cible en un coup d'œil

```
Chaque nuit à 03:00 (Europe/Paris) — job APScheduler « research_rotation »
(inscrit seulement si research_cron_enabled(), règle inchangée)
 │
 ├─ Lire l'état : écoles ACTIVE, nb de Program et de ProgramCampus,
 │  dernier passage Phase 1 et Phase 2 de chaque école (table PipelineJob),
 │  tickets Program_Discovery en attente
 │
 ├─ Planifier (fonction pure) : candidats dus, dans l'ordre de priorité,
 │  chacun avec son coût estimé
 │
 ├─ Crédits consommés ce mois (TavilyKeyManager) + estimation ≤ plafond ?
 │     NON pour tous → rien ce soir, journalisé
 │     OUI           → lancer le PREMIER candidat qui tient sous le plafond
 │
 └─ Exécuter la passe comme un PipelineJob (source = "cron"), avec
    battement de cœur ; Phase 2 avec skip_pending=True
```

Rien d'autre ne déclenche de recherche automatiquement. `phase1_scanner` et
`phase2_enricher` disparaissent. Le traitement du crowdsourcing (toutes les
minutes) ne change pas.

---

## 5. Étapes

### Étape 0 — Prérequis

- [x] Le travail non commité sur le rattachement des classements
  (`extraction_prompts.py`, `extraction_schemas.py`, `processor.py`,
  `phase2_research.py`, `architecture.md`, `test/test_ranking_program_match.py`)
  est commité à part : `0bcfda1`, le 29 septembre 2026.
- [x] `npm test` passe sur la branche de départ : 228 tests (+25 sous-tests) au
  29 septembre 2026.

### Étape 1 — Ne pas relancer ce qui attend déjà l'admin

**Objectif :** en passe automatique, aucune recherche n'est payée pour une
cible dont un ticket du pipeline attend encore la validation.

**Définition de la période cible.** Ajouter dans `backend/utils/academic_year.py` :

```python
def get_target_period_start() -> date:
    """1er septembre ouvrant la période dont l'année cible est get_target_academic_year_int()."""
    return date(get_target_academic_year_int() - 1, 9, 1)
```

Au 29 septembre 2026, l'année cible est 2027 et la période commence le
1er septembre 2026. Un ticket créé avant cette date concerne l'année cible
précédente et **ne bloque pas**.

**Les cibles, catégorie par catégorie :**

| Catégorie | Une recherche vise… | Bloquée si un ticket `Pending_Admin`, `Automated_AI`, créé depuis le début de la période, porte… |
|---|---|---|
| `SchoolStats` | l'école | `schoolId` + `ai_category` |
| `Accreditation` | l'école | `schoolId` + `ai_category` |
| `Ranking` | l'école (un seul appel) | `schoolId` + `ai_category` — un seul ticket Ranking en attente suffit à sauter la recherche |
| `Pricing` | un programme | `programId` + `ai_category` |
| `Capacity` | un couple programme × campus | `programCampusId` + `ai_category` |
| `Program_Discovery` | l'école (Phase 1) | `schoolId` + charge `discovered_campuses` — **sans filtre de période** : une découverte n'est pas liée à une année. Les tickets `campus_attachments` et les rapports rangés (`Failed`) ne comptent pas |

**Fichiers :**
- `backend/utils/academic_year.py` — `get_target_period_start()`.
- nouveau `backend/pipeline/pending_guard.py` :
  - `read_pending_targets(cur, school_id, period_start) -> PendingTargets`, une
    seule requête sur `ContributionInbox` (`status = 'Pending_Admin'`,
    `source_type = 'Automated_AI'`, `"schoolId" = %s`), qui rend
    `school_categories: set[str]` (tickets depuis `period_start`),
    `pricing_program_ids: set[str]`, `capacity_program_campus_ids: set[str]`
    et `discovery_pending: bool` (toutes dates,
    `ai_extracted_json ? 'discovered_campuses'`) ;
  - les constantes de statut viennent de `backend/constants.py`, pas de
    littéraux.
- `backend/pipeline/phase2_research.py` — `run_phase2_research(..., skip_pending: bool = False)` :
  - lire les cibles en attente **dans la connexion courte déjà ouverte**, après
    le chargement des programmes (règle « Close Gate Connexion », §10.8) ;
  - filtrer `school_cats`, les programmes de la boucle Pricing, et
    `program_campuses` ;
  - calculer `total_to_scan` **après** filtrage ;
  - ajouter au résultat `skipped_pending: {"school_categories": [...],
    "pricing": n, "capacity": n}` et une ligne de journal.

> ⚠️ **Piège :** la variable `programs` sert à trois choses dans
> `run_phase2_research` : la boucle Pricing, la liste passée au brief et au
> schéma Ranking (`ranking_extraction_schema`), et `_write_ranking_tickets`.
> Filtrer `programs` elle-même retirerait des programmes du rattachement des
> classements. Filtrer une **copie** dédiée à la boucle Pricing.

- La garde Phase 1 vit dans le **planificateur** (étape 3), pas dans
  `run_phase1_research` : une école dont la découverte est en attente n'est
  simplement pas candidate.

**Tests** — nouveau `test/test_pending_guard.py`, sur le modèle de
`test/test_phase1_parked_report.py` (connexion mockée) :
- [ ] `get_target_period_start()` : 29/09/2026 → 01/09/2026 ; 15/05/2026 → 01/09/2025 ; 31/08/2026 → 01/09/2025.
- [ ] la requête filtre bien `Pending_Admin`, `Automated_AI` et l'école ; la
  période ne s'applique pas à la découverte.
- [ ] `run_phase2_research(skip_pending=True)` ne lance **aucun** appel
  Research pour une catégorie école, un programme ou un couple bloqués, et
  lance les autres.
- [ ] Ranking reçoit toujours la liste **complète** des programmes, même quand
  des programmes sont bloqués en Pricing.
- [ ] `skip_pending=False` (défaut, chemin manuel) : comportement inchangé.

**Fait quand :** les cases ci-dessus sont cochées et `npm test` passe.

- [ ] Étape 1 terminée

### Étape 2 — Phase 1 : ne proposer que ce qui est nouveau

**Objectif :** relancée sur une école déjà cartographiée, la Phase 1 ne dépose
un ticket que pour les campus, programmes ou couples programme × campus
**absents** de la base. Rien de nouveau → aucun ticket. Première découverte
d'une école vide : comportement inchangé.

**Fichiers :**
- nouveau `backend/pipeline/discovery_diff.py`, **pur** (aucun appel réseau ni
  base) :

  ```python
  def filter_new_discoveries(
      discovered_campuses: list[dict],   # sortie de _clean_extracted
      campuses: list[dict],              # {"id", "name"} de la table Campus
      programs: list[dict],              # {"id", "name"} de la table Program
      edges: set[tuple[str, str]],       # (programId, campusId) existants
  ) -> tuple[list[dict], dict]:          # (campus filtrés, résumé)
  ```

- `backend/pipeline/phase1_research.py`, dans `_run_program_discovery`, entre
  l'étape 5 (garde-fous) et l'étape 6 (INSERT) : une connexion courte lit
  `Campus`, `Program` et `ProgramCampus` de l'école, puis appelle
  `filter_new_discoveries`.

**Règles d'appariement** (réutiliser l'existant, ne rien réinventer) :
- **Campus :** `fold_campus_name()` (`campus_attachment.py`) des deux côtés.
  Une seule correspondance → le nom est **réécrit à l'orthographe de la base**.
  Aucune → campus nouveau. Plusieurs campus de la base sur la même clé → pas de
  réécriture, campus signalé dans `ambiguous_campuses`.
- **Programme :** `match_program(nom, programs)` (`program_identity.py`).
  Clause `A1`, `A2` ou `B` avec un seul résultat → nom **réécrit à
  l'orthographe de la base**. `ABSENT` → nouveau. Clause préfixée `AMBIGU/` →
  gardé tel quel et signalé dans `ambiguous_programs` : jamais d'appariement
  deviné (règle du projet).
- **La réécriture est ce qui empêche les doublons** : `validateProgramDiscovery`
  fait un `upsert` sur le nom exact, il retombe donc sur la ligne existante.

**Ce qui reste dans le ticket :** un couple (campus, programme) est gardé si le
campus est nouveau, **ou** le programme est nouveau ou ambigu, **ou** le couple
`(programId, campusId)` n'existe pas encore. Deux programmes découverts qui
retombent sur le même `Program` d'un même campus (deux voies d'accès du PGE)
sont fusionnés. Un campus sans programme restant est retiré.

**Résultat :**
- quelque chose de nouveau → ticket comme aujourd'hui, avec en plus dans
  `ai_extracted_json` un bloc
  `diff_against_base: {"campuses_known": n, "programs_known": n,
  "pairs_already_in_base": n, "ambiguous_programs": [...],
  "ambiguous_campuses": [...]}` ;
- rien de nouveau → **pas de ticket**, résultat
  `{"success": True, "no_new_discoveries": True, "message": "Aucune nouveauté
  par rapport à la base", ...}`. Si un rapport rangé a été repris, il est
  supprimé (il a été consommé), comme dans la branche INSERT.

**Hors périmètre de cette étape :** les changements d'attributs d'un programme
existant (`admission_exam`, alternance…) et les programmes que le site ne
publie plus. On ne les détecte pas.

**Tests** — nouveau `test/test_discovery_diff.py`, avec les noms réels
d'Em Normandie :
- [ ] base vide → sortie identique à l'entrée.
- [ ] tout est déjà en base → liste vide.
- [ ] « Programme Grande Ecole » face à « Programme Grande École » en base →
  réécrit, et retiré si le couple existe déjà.
- [ ] programme connu sur un campus où il n'est pas encore → gardé, nom réécrit.
- [ ] programme nouveau sur un campus connu → gardé ; campus réécrit.
- [ ] programme ambigu → gardé tel quel et signalé.
- [ ] deux voies du même programme sur un même campus → une seule entrée.
- [ ] `_run_program_discovery` sans nouveauté : aucun INSERT, rapport rangé
  repris supprimé, `success` vrai.

- [ ] Étape 2 terminée

### Étape 3 — Mémoire du dernier passage et planificateur

**Objectif :** savoir, sans nouvelle table, quand chaque école est passée pour
la dernière fois en Phase 1 et en Phase 2, et en déduire la liste ordonnée des
passes dues.

**3.1. Garder le dernier passage dans `PipelineJob`.** Aujourd'hui
`purge_finished_jobs()` supprime tout job terminé depuis plus de 7 jours
(`PIPELINE_JOB_RETENTION_DAYS`). Modifier la purge pour que les jobs **de
rotation** soient gardés `PIPELINE_JOB_ROTATION_RETENTION_DAYS` jours (défaut
400) ; les autres gardent 7 jours.

Les libellés qui comptent comme un passage complet (constantes à créer dans
`backend/pipeline_jobs.py`, pas de littéraux ailleurs) :

| Phase | Libellés (`PipelineJob.phase`) | Origine |
|---|---|---|
| Phase 1 | `Phase 1 — Cartographie`, `Phase 1 — Cartographie (Auto)` | `trigger-scan`, recherche ciblée Phase 1, cron |
| Phase 2 | `Phase 2 — Enrichissement`, `Phase 2 — Enrichissement (Auto)` | `trigger-enrichment`, cron |

`Phase 2 — Enrichissement ciblé` (un programme, des catégories choisies)
**ne compte pas** : ce n'est pas une passe complète.

**3.2. Règle « due ».** Pour une école et une phase, on lit le **dernier** job
terminé (`completed` ou `failed`) portant un de ces libellés :

| Dernier passage | Due ? |
|---|---|
| aucun | oui |
| `completed`, terminé il y a plus de `CRON_RESEARCH_INTERVAL_DAYS` (défaut 182) | oui |
| `failed`, terminé il y a plus de `CRON_RESEARCH_RETRY_FAILED_DAYS` (défaut 14) | oui |
| sinon, ou job actif sur l'école | non |

Conditions supplémentaires :
- **Phase 1** : pas due si `discovery_pending` (étape 1).
- **Phase 2** : pas due si l'école n'a aucun `Program`.
- Seules les écoles `ACTIVE` sont candidates.

Le délai court après un échec évite de repayer chaque nuit une école dont la
découverte échoue (« le rapport ne nomme aucun campus »), sans attendre 6 mois
après une simple coupure. Un redémarrage pendant une passe la clôt en `failed`
(`reap_orphaned_jobs`) : elle sera reprise 14 jours plus tard, et la garde de
l'étape 1 évite de recréer les tickets déjà déposés.

**3.3. Ordre de priorité** des candidats dus :
1. Phase 1 des écoles **sans aucun `Program`** (écoles nouvelles : tout le
   reste en dépend) ;
2. Phase 2 **jamais passée** (école dont la découverte vient d'être validée) ;
3. tous les autres, du passage le plus ancien au plus récent ;
4. à égalité, nom d'école croissant (ordre déterministe, donc testable).

**3.4. Coût estimé** d'une passe, à partir de `ESTIMATED_CREDITS`
(`research_client.py`), sans rien soustraire (estimation prudente) :
- Phase 1 : 30 ;
- Phase 2 : `10 + 10 + 25 + 25 × nb Program + 10 × nb ProgramCampus`.

**Fichiers :**
- `backend/pipeline_jobs.py` — constantes de libellés, purge modifiée, et
  `read_last_passes(cur, school_ids) -> dict[(school_id, phase), LastPass]`.
- nouveau `backend/scheduler/rotation.py` :
  - `plan_rotation(schools, last_passes, discovery_pending, now, config) -> list[Candidate]`,
    **pure** ;
  - `Candidate` : `school_id`, `school_name`, `phase` (`"1"` ou `"2"`),
    `reason` (`never`, `interval`, `retry_after_failure`), `last_pass_at`,
    `estimated_credits` ;
  - `load_rotation_state(cur)` : la lecture en base qui alimente
    `plan_rotation` (écoles, comptages, derniers passages, découvertes en
    attente), en une connexion courte.

**Tests** — nouveau `test/test_rotation_plan.py` :
- [ ] école sans passage → due, raison `never`.
- [ ] `completed` à 181 jours → pas due ; à 183 jours → due.
- [ ] `failed` à 13 jours → pas due ; à 15 jours → due.
- [ ] découverte en attente → Phase 1 pas due ; Phase 2 non affectée.
- [ ] école sans `Program` → Phase 2 jamais candidate.
- [ ] `Phase 2 — Enrichissement ciblé` ne compte pas comme passage.
- [ ] ordre de priorité du §3.3 respecté, égalités départagées par le nom.
- [ ] coût Phase 2 : 15 programmes et 30 couples → 720.
- [ ] purge : un job de rotation de 30 jours est gardé, un job ciblé de 30 jours
  est supprimé (vérifier la requête et ses paramètres).

- [ ] Étape 3 terminée

### Étape 4 — Le job nocturne de rotation

**Objectif :** remplacer `phase1_scanner` et `phase2_enricher` par un seul job
à heure fixe, qui lance au plus une passe par nuit sous plafond mensuel.

**4.1. Crédits du mois.** Ajouter à `TavilyKeyManager`
(`key_manager.py`) une méthode `credits_used_this_month() -> int` qui, **sous
le verrou**, applique `_reset_if_new_month` à chaque clé puis additionne
`credits_used`.

> ⚠️ `get_status()` n'appelle pas `_reset_if_new_month` : le 1er du mois, il
> rend encore la consommation du mois précédent tant qu'aucune clé n'a été
> demandée. Ne pas s'en servir pour le plafond.

Ces chiffres sont des **estimations** (Research ne déclare pas son coût) et le
mois est le mois calendaire UTC, pas forcément le cycle de facturation Tavily.
C'est la raison du plafond inférieur au budget.

**4.2. Le job `research_rotation`** (`backend/scheduler/jobs.py`) :
- déclencheur `CronTrigger(hour=CRON_RESEARCH_HOUR, minute=0,
  timezone="Europe/Paris")` (défaut 3 h), `misfire_grace_time=3600`,
  `coalesce=True`, `max_instances=1` ;
- inscrit **seulement si** `research_cron_enabled()` : cette règle et son test
  ne changent pas ;
- déroulé : `load_rotation_state` → `plan_rotation` →
  `used = key_manager.credits_used_this_month()` → lancer le **premier**
  candidat dont `used + estimated_credits ≤ CRON_MONTHLY_CREDIT_CEILING`
  (défaut 7 000), et au plus `CRON_ROTATION_PASSES_PER_NIGHT` passes (défaut 1) ;
- aucun candidat ne tient → aucune passe, `_record_job_run("research_rotation",
  "success", "plafond mensuel atteint : …")` ;
- `CRON_MONTHLY_CREDIT_CEILING=0` doit donc planifier, journaliser et ne rien
  dépenser : c'est le mode de vérification de l'étape 7.

**4.3. Exécuter une passe.** Pour le candidat retenu :
- `_school_is_busy` d'abord (inchangé) ;
- `create_job(school_id, "Phase 1 — Cartographie (Auto)" | "Phase 2 — Enrichissement (Auto)", source="cron")`,
  puis `mark_running` ;
- **battement de cœur obligatoire** : passer
  `progress_callback=lambda d: pipeline_jobs.update_progress(job_id, d)` à
  `run_phase1_research` / `run_phase2_research` (§1.4) ;
- Phase 1 : `collect_campus_attachments` reste **faux** (règle §5.4 de
  l'architecture : le cron ne l'active jamais) ;
- Phase 2 : `skip_pending=True` ;
- clôture `completed` si `result["success"]`, sinon `failed` ;
  `QuotaExhaustedError` → `failed` et fin de la nuit ;
- `_record_job_run("research_rotation", ...)` avec l'école, la phase et le coût
  estimé.

**4.4. Retraits.** Supprimer `phase1_scanner`, `phase2_enricher`,
`PHASE1_INTERVAL_HOURS`, `PHASE2_INTERVAL_HOURS`,
`PHASE1_INITIAL_DELAY_MINUTES` et `PAUSE_BETWEEN_SCHOOLS` s'il n'a plus
d'usage. Vérifier par `grep` qu'aucun autre module ne les importe.

**Nouvelles variables** (toutes avec défaut, toutes lues une fois au
démarrage) :

| Variable | Défaut | Rôle |
|---|---|---|
| `CRON_RESEARCH_HOUR` | `3` | heure de la passe, Europe/Paris |
| `CRON_RESEARCH_INTERVAL_DAYS` | `182` | écart entre deux passages réussis |
| `CRON_RESEARCH_RETRY_FAILED_DAYS` | `14` | écart après un passage en échec |
| `CRON_MONTHLY_CREDIT_CEILING` | `7000` | plafond du cron ; `0` = ne rien dépenser |
| `CRON_ROTATION_PASSES_PER_NIGHT` | `1` | passes par nuit |
| `PIPELINE_JOB_ROTATION_RETENTION_DAYS` | `400` | rétention des jobs de rotation |

Une valeur non entière doit retomber sur le défaut **avec un avertissement**,
pas faire tomber le démarrage.

**Tests :**
- [ ] `test/test_scheduler_research_gate.py` mis à jour : hors production,
  `research_rotation` n'est pas inscrit ; en production, il l'est avec un
  `CronTrigger` à l'heure configurée ; `crowdsourcing_processor` toujours inscrit.
- [ ] plafond : consommation 6 900 + candidat à 720 → sauté, candidat suivant à
  30 → lancé ; plafond 0 → rien lancé.
- [ ] le `progress_callback` passé à la phase met bien à jour le job.
- [ ] Phase 2 appelée avec `skip_pending=True` ; Phase 1 avec
  `collect_campus_attachments=False`.
- [ ] `QuotaExhaustedError` → job `failed`, aucune autre passe cette nuit.
- [ ] `credits_used_this_month()` remet à zéro une clé du mois précédent
  (`test/test_tavily_key_rotation.py`).

- [ ] Étape 4 terminée

### Étape 5 — Visibilité dans `/admin/cron`

**Objectif :** l'admin voit ce que la rotation va faire et ce qu'elle a coûté,
sans lire les journaux.

**Backend :** `get_scheduler_status()` (`jobs.py`), remonté par
`GET /internal/pipeline-status`, gagne un bloc :

```json
"rotation": {
  "enabled": true,
  "hour": 3,
  "interval_days": 182,
  "monthly_ceiling": 7000,
  "month_credits_used": 1240,
  "next": [
    {"school_name": "Essec", "phase": "1", "reason": "never",
     "last_pass_at": null, "estimated_credits": 30}
  ],
  "last_night": {"status": "success", "detail": "Em Lyon, Phase 2, ~785 crédits", "finished_at": "…"}
}
```

`next` : les 5 premiers candidats de `plan_rotation`. Lecture en base courte ;
une erreur de lecture donne `"rotation": {"error": "…"}` sans faire échouer
`pipeline-status`.

**Front :** `app/admin/cron/page.tsx` affiche un panneau « Rotation
automatique » : état (active ou non, et pourquoi, via `research_cron`
existant), crédits du mois sur le plafond, prochaines passes, dernière nuit.
Lire `node_modules/next/dist/docs/` avant d'écrire (AGENTS.md). Suivre le style
des panneaux existants du fichier (`QuotaTavilyPanel.tsx`).

**Tests :**
- [ ] le bloc `rotation` est présent et bien formé (test Python sur
  `get_scheduler_status`, scheduler mocké).
- [ ] une erreur de lecture ne casse pas `pipeline-status`.
- [ ] `npm run typecheck` et `npm run lint` sans nouvelle erreur.
- [ ] contrôle visuel de `/admin/cron` avec `npm run dev`, backend local
  lancé avec `CRON_RESEARCH_ENABLED=true` **et** `CRON_MONTHLY_CREDIT_CEILING=0`.

- [ ] Étape 5 terminée

### Étape 6 — Documentation et configuration

- [ ] `.env.example` : retirer `CRON_PHASE1_INTERVAL_HOURS`,
  `CRON_PHASE2_INTERVAL_HOURS` et `CRON_PHASE1_INITIAL_DELAY_MINUTES` ; ajouter
  les six variables de l'étape 4, commentées.
- [ ] `architecture.md` : §2.3 (`pipeline-status`), §3.5 bis (rétention des
  jobs de rotation), §5.1 et §5.3 (déclencheurs, garde « en attente », Phase 1
  différentielle), §9 (nouveaux cas limites : ticket en attente repayé,
  redémarrage Koyeb et intervalles), §11 (glossaire des décisions), en-tête de
  version.
- [ ] `README.md` si une commande ou une variable citée a changé.
- [ ] `docs/testing/manual_testing_cron.md` : procédure de vérification avec
  `CRON_MONTHLY_CREDIT_CEILING=0`.

- [ ] Étape 6 terminée

### Étape 7 — Vérification avant la mise en ligne

- [ ] **Passe à blanc** : backend local, `CRON_RESEARCH_ENABLED=true`,
  `CRON_MONTHLY_CREDIT_CEILING=0`, `CRON_RESEARCH_HOUR` réglé sur l'heure
  suivante. Attendu : une ligne de journal avec le plan, aucune recherche,
  aucun crédit consommé, le plan visible dans `/admin/cron`.
- [ ] **Première passe réelle surveillée**, sur une seule école choisie par le
  propriétaire, plafond réglé juste au-dessus de son estimation. Relever le
  coût réel dans le tableau de bord Tavily et le comparer à l'estimation ;
  noter l'écart au journal.
- [ ] **Relance immédiate** sur la même école (forcer en effaçant la date due
  ou en passant par `trigger-enrichment`) : en passe automatique, les cibles
  dont le ticket attend ne doivent rien coûter.
- [ ] Variables de production posées sur Koyeb, `ENVIRONMENT=production`.

- [ ] Étape 7 terminée — la rotation peut partir en production

---

## 6. Pièges connus

| Piège | Conséquence si on l'ignore |
|---|---|
| `programs` a trois usages dans `run_phase2_research` | le filtrage Pricing retire des programmes au rattachement des classements |
| Pas de `progress_callback` sur une passe cron | job déclaré mort après 30 min, école vue comme libre, lancement concurrent possible |
| `get_status()` ne remet pas le mois à zéro | plafond calculé sur le mois précédent le 1er du mois |
| `complete_job` écrase le statut sans condition | un job réputé mort puis terminé repasse en `completed` : ne pas s'appuyer sur un `failed` intermédiaire |
| Coûts Research estimés, pas lus | le plafond n'est qu'une approximation ; garder la marge entre plafond et budget |
| `reap_orphaned_jobs` suppose un seul processus backend | ne pas passer à plusieurs instances Koyeb sans revoir `pipeline_jobs.py` |
| Neon se joint mal depuis le poste de développement (P1001 sur 5432) | un test contre la vraie base peut échouer pour une raison réseau ; les tests unitaires mockent la base |
| Collecte du rattachement campus | ne jamais l'activer depuis le cron (~15 à 17 crédits par école, souvent pour rien) |

---

## 7. Hors périmètre et questions ouvertes

Notées pour ne pas être « redécouvertes ». Aucune n'est à traiter dans ce chantier.

- **Capacité de validation.** Le volume de tickets du §3 dépasse ce que
  l'admin prévoit de valider. Pistes : validation en lot d'un groupe
  (`submission_group_id`), ou ne plus chercher Capacity par campus.
- **Capacity par programme plutôt que par couple.** Les places sont souvent
  publiées par concours ou par programme. Chercher par programme diviserait ce
  poste par deux ou trois, mais `CapacityRecord` est rattaché au couple.
- **Ne plus chercher une donnée déjà en production pour l'année cible**
  (surtout Pricing, le poste le plus cher). Économie nette, sans journal. Écarté
  pour l'instant : le propriétaire a retenu deux passes par an sur chaque
  programme.
- **Phase 1 différentielle incomplète** : ni changement d'attribut d'un
  programme existant, ni programme retiré du site.
- **Journal par donnée** : écarté par le propriétaire (§2).
- **`ProgramPlacement`** : pas de chemin d'écriture, par décision du 29
  septembre 2026. Ne pas l'ajouter ici.

---

## 8. Récapitulatif des fichiers

| Fichier | Étape | Nature |
|---|---|---|
| `backend/utils/academic_year.py` | 1 | ajout `get_target_period_start()` |
| `backend/pipeline/pending_guard.py` | 1 | **nouveau** |
| `backend/pipeline/phase2_research.py` | 1 | `skip_pending` |
| `backend/pipeline/discovery_diff.py` | 2 | **nouveau**, pur |
| `backend/pipeline/phase1_research.py` | 2 | appel du diff avant l'INSERT |
| `backend/pipeline_jobs.py` | 3 | libellés, purge, `read_last_passes` |
| `backend/scheduler/rotation.py` | 3 | **nouveau** : planificateur pur + lecture |
| `backend/tavily_service/key_manager.py` | 4 | `credits_used_this_month()` |
| `backend/scheduler/jobs.py` | 4, 5 | job `research_rotation`, retraits, bloc `rotation` |
| `app/admin/cron/page.tsx` | 5 | panneau « Rotation automatique » |
| `test/test_pending_guard.py`, `test/test_discovery_diff.py`, `test/test_rotation_plan.py` | 1-3 | **nouveaux** |
| `test/test_scheduler_research_gate.py`, `test/test_tavily_key_rotation.py` | 4 | mis à jour |
| `.env.example`, `architecture.md`, `README.md`, `docs/testing/manual_testing_cron.md` | 6 | documentation |

Aucune migration Prisma. Aucune route Next.js nouvelle :
`/api/admin/pipeline-status` relaie déjà la réponse de FastAPI.

---

## 9. Journal de progression

Une ligne par session de travail, la plus récente en bas.

| Date | Agent | Étape | Fait | Reste / remarques |
|---|---|---|---|---|
| 2026-09-29 | Claude (Opus 5.5) | — | Plan rédigé et validé par le propriétaire | — |
| 2026-09-29 | Claude (Opus 5.5) | 0 | Travail sur les classements commité à part (`0bcfda1`) ; 228 tests verts | Prochaine : étape 1 |
