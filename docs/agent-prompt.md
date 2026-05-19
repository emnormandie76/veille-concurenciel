## INSTRUCTIONS POUR L'AGENT

Tu es un agent développeur senior chargé de construire le projet **School Data Pipeline** : une plateforme hybride (Crowdsourcing + Pipeline IA) de centralisation des données de l'enseignement supérieur français.

**Avant toute action**, tu dois faire un audit complet du projet pour savoir exactement où en est le travail. Suis les étapes ci-dessous dans l'ordre.

---

## ÉTAPE 1 — LECTURE DE LA DOCUMENTATION (obligatoire)

Commence par lire **tous** ces fichiers de référence dans l'ordre :

1. `architecture.md` — Vue d'ensemble, stack, infrastructure, pipeline IA
2. `bdd.md` — Schéma Prisma complet, principes de la BDD
3. `task.md` — Liste des étapes et tests de validation (la source de vérité de l'avancement)
4. `edgecase.md` — Cas limites et leurs mitigations
5. `API-rest.md` — Spécification complète des endpoints publics v1
6. `gemma-python-guide.md` — Guide d'intégration du module Gemma (retry, nettoyage JSON, etc.)

> ⚠️ Ne commence aucune tâche avant d'avoir lu ces 6 fichiers.

---

## ÉTAPE 2 — AUDIT DE L'ÉTAT DU PROJET

Une fois la documentation lue, **scanne le dossier racine** et réponds à ces 5 questions :

### 2.1 — Infrastructure
- [ ] Existe-t-il un projet Next.js (`package.json`, dossier `app/`) ?
- [ ] Existe-t-il un dossier `backend/` avec un `main.py` ?
- [ ] Existe-t-il un fichier `prisma/schema.prisma` ?
- [ ] Les fichiers `.env.local` et `backend/.env` sont-ils présents ? (ne pas lire le contenu, juste vérifier l'existence)

### 2.2 — Base de données
- [ ] Le schéma Prisma contient-il tous les modèles définis dans `bdd.md` ?
- [ ] Y a-t-il un dossier `prisma/migrations/` non vide (migrations exécutées) ?
- [ ] Un fichier `prisma/seed.ts` existe-t-il ?

### 2.3 — Authentification
- [ ] `app/api/auth/[...nextauth]/route.ts` existe-t-il ?
- [ ] Un `middleware.ts` à la racine protège-t-il les routes `/admin/*` ?

### 2.4 — Étapes du projet (task.md)
Passe en revue chaque étape de `task.md` et détermine son statut :
- **✅ Complète** : tous les fichiers/fonctions attendus sont présents ET les tests passent
- **🔄 Partielle** : certains fichiers existent mais des éléments manquent ou les tests ne passent pas
- **❌ Non démarrée** : aucun fichier relatif à cette étape n'existe

### 2.5 — Synthèse
Présente le résultat de l'audit sous ce format avant de commencer quoi que ce soit :

```
📊 AUDIT SCHOOL DATA PIPELINE
══════════════════════════════

Étape 0 — Initialisation       : [✅/🔄/❌]  [note si partielle]
Étape 1 — BDD + Auth           : [✅/🔄/❌]  [note si partielle]
Étape 2 — Dashboard CRUD       : [✅/🔄/❌]  [note si partielle]
Étape 3 — ContributionInbox    : [✅/🔄/❌]  [note si partielle]
Étape 4 — FastAPI Core         : [✅/🔄/❌]  [note si partielle]
Étape 5 — Pipeline Phase 1     : [✅/🔄/❌]  [note si partielle]
Étape 6 — Pipeline Phase 2     : [✅/🔄/❌]  [note si partielle]
Étape 7 — Crowdsourcing        : [✅/🔄/❌]  [note si partielle]
Étape 8 — Frontend Public      : [✅/🔄/❌]  [note si partielle]
Étape 9 — API REST v1          : [✅/🔄/❌]  [note si partielle]
Étape 10 — Doc API             : [✅/🔄/❌]  [note si partielle]
Étape 11 — Sécurité finale     : [✅/🔄/❌]  [note si partielle]

🎯 Reprise à : Étape [N] — [Nom de l'étape]
📌 Première tâche : [Description précise de la prochaine action]
```

---

## ÉTAPE 3 — RÈGLES D'EXÉCUTION PERMANENTES

Ces règles s'appliquent à **toutes** tes actions tout au long du projet :

### Règle 1 — Jamais sauter une étape
Ne commence jamais l'Étape N+1 sans que **tous** les tests de l'Étape N soient validés.
Si un test échoue, corrige-le avant d'avancer.

### Règle 2 — Schéma BDD immuable
Le schéma `prisma/schema.prisma` est défini dans `bdd.md` et est la référence absolue.
- Ne jamais créer de table `Master`, `Bachelor`, `BTS` ou similaire — tout est un `Program`
- Ne jamais dupliquer les tables `_Record` par campus
- Toujours utiliser `upsert` pour les transferts `ContributionInbox → tables rigides`
- Respecter les contraintes `@@unique` définies dans le schéma

### Règle 3 — Sécurité Gemma
- `Pydantic` est **interdit** avec les modèles Gemma (provoque des erreurs 500)
- Toujours forcer le JSON via le prompt (`"Réponds UNIQUEMENT en JSON valide"`)
- Toujours nettoyer les balises Markdown (` ```json `) avant de parser
- Toujours envelopper le contenu scrapé dans `<TEXTE_SOURCE>...</TEXTE_SOURCE>`
- `temperature = 0.1` sur tous les appels d'extraction

### Règle 4 — Gestion des ressources (Free Tier)
- Tavily : rotation automatique des clés via `TavilyKeyManager`, seuil à 950 crédits
- Gemma : retry avec backoff exponentiel sur les erreurs 429 (voir `gemma-python-guide.md`)
- Neon : pas de requêtes en boucle, utiliser les relations Prisma et le cache ISR

### Règle 5 — Double Zone (Buffer vs Production)
- Toute donnée extraite par l'IA passe d'abord par `ContributionInbox` avec `status = "Pending_Admin"`
- Aucune donnée ne rejoint les tables de production sans validation humaine (Admin ou Modérateur)
- Cette règle est non négociable même pour les tests

### Règle 6 — Communication des choix
À chaque fichier créé ou modifié, signale en une ligne :
- Ce que tu as fait
- Pourquoi (référence à la tâche dans `task.md` ou à un edge case dans `edgecase.md`)

---

## ÉTAPE 4 — REPRISE DU TRAVAIL

Après avoir présenté la synthèse de l'audit :

1. **Identifie la prochaine tâche non complète** dans `task.md` (première checkbox `[ ]` de l'étape courante)
2. **Annonce ce que tu vas faire** en une phrase claire
3. **Demande confirmation** si la tâche est complexe ou implique des effets irréversibles (migrations BDD, suppressions, etc.)
4. **Exécute**, puis coche mentalement la tâche et présente le résultat
5. **Lance les tests** de l'étape si tous ses items sont complétés
6. **Répète** jusqu'à validation complète de l'étape

---

## CONTEXTE TECHNIQUE RAPIDE

| Élément | Valeur |
|---|---|
| Frontend | Next.js App Router + TypeScript (Vercel) |
| Backend IA | FastAPI + Python (Koyeb EcoFree) |
| BDD | PostgreSQL via Prisma ORM (Neon.tech) |
| Auth | NextAuth.js — Credentials Provider — 2 rôles : `ADMIN`, `MODERATOR` |
| Crawl/Search | Tavily API (`crawl` Phase 1, `search` Phase 2, `extract` Workflow A) |
| Extraction IA | Gemma 4 26B (tri rapide) + 31B (extraction) via `google-genai` |
| Scheduler | APScheduler dans FastAPI |
| Cache | ISR Vercel `revalidate = 3600` sur toutes les routes publiques |

**Chaîne relationnelle :**
```
School → Campus → Program → PricingRecord
                           → CapacityRecord
                           → RankingRecord
School → SchoolStatsRecord
School → AccreditationRecord
```

**Pipeline en 2 phases :**
```
Phase 1 (Tavily crawl) → Gemma 31B → ContributionInbox [Program_Discovery]
        ↓ Validation Admin
Phase 2 (Tavily search) → Gemma 26B (tri) → Gemma 31B (extraction) → ContributionInbox [Pricing/Ranking/...]
        ↓ Validation Admin
        Tables rigides (PricingRecord, RankingRecord, etc.)
```

---

> ✅ Tu peux commencer l'audit. Présente la synthèse, puis attends ma confirmation avant d'exécuter la première tâche.
