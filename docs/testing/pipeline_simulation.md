# 🚀 Guide de Simulation du Pipeline & Crowdsourcing (Étape par Étape)

Ce guide explique comment lancer localement les scripts de simulation de `backend/scripts/`, pour tester les flux du pipeline sans passer par le dashboard :
1. **Phase 1** : Cartographie (Program Discovery)
2. **Phase 2** : Enrichissement (Pricing, Ranking, Capacity, SchoolStats, Accreditation)
3. **Workflow A** : Crowdsourcing utilisateur
4. **Rattachement campus** : collecte, appariement et rejeu — **sans crédit** sur cache

> **Revu le 28 septembre 2026.** Les scripts vivent dans `backend/scripts/` et se
> lancent en module depuis la racine du dépôt (`python -m backend.scripts.…`).

---

## 📋 Prérequis Communs

### 1. Variables d'environnement
`backend/.env` (liste complète : [`.env.example`](../../.env.example)) :
```ini
# Connexion base de données (Neon, pooler)
DATABASE_URL="postgresql://user:password@endpoint/dbname?sslmode=require"

# API Google GenAI — cascade Gemini (pipeline) et Gemma 4 (crowdsourcing)
GEMINI_API_KEY="AIzaSy..."

# API Tavily — une ou plusieurs clés, rotation automatique
TAVILY_API_KEYS="tvly-...,tvly-..."
# ou TAVILY_API_KEY_1 … TAVILY_API_KEY_10, ou TAVILY_API_KEY pour une seule clé
```

### 2. Activer l'environnement virtuel Python
* **Windows (PowerShell)** :
  ```powershell
  $env:PYTHONUTF8=1
  .\backend\.venv\Scripts\Activate.ps1
  ```
* **macOS / Linux** :
  ```bash
  export PYTHONUTF8=1
  source backend/.venv/bin/activate
  ```

> **Réseau.** Les scripts se connectent en psycopg2 sur le port 5432. Sur un
> réseau qui coupe le protocole Postgres (`P1001`), ils échouent alors que
> l'application Next.js fonctionne. Voir `manual_testing_cron.md`, *Dépannage*.

---

## 🗺️ Étape 1 : Simulation de la Phase 1 (Program Discovery)

* **Script** : `backend/scripts/simulate_phase1_research.py`
* **Comportement** — celui de `run_phase1_research()` :
  1. lit la page catalogue de l'école (`/search` + `/extract`), dont les intitulés ancrent l'extraction ;
  2. reprend un rapport Research rangé de moins de 7 jours s'il en existe un, sinon lance **Tavily Research** (`pro`, sans `output_schema`) ;
  3. convertit le rapport en JSON par la **cascade Gemini** (plancher `mid`) ;
  4. écarte les libellés de rubrique et les campus sans formation ;
  5. insère un ticket `Program_Discovery` en `Pending_Admin`, avec le rapport dans `raw_report`. Si l'extraction échoue, le rapport est rangé dans un ticket `Failed`.

```powershell
python -m backend.scripts.simulate_phase1_research --school-name "EDHEC Business School" --domain edhec.edu
python -m backend.scripts.simulate_phase1_research --dry-run      # sans écriture ni crédit réel
```
Coût réel : ~28-30 crédits Tavily (Research pro estimé à 25).

---

## 🔍 Étape 2 : Simulation de la Phase 2 (Enrichissement)

* **Script** : `backend/scripts/simulate_phase2_research.py`
* **Comportement** — celui de `run_phase2_research()` :
  1. charge l'école, ses programmes et ses arêtes programme × campus ;
  2. un appel Research par catégorie **au niveau où la donnée existe** : école (SchoolStats, Accreditation, Ranking), programme (Pricing), programme × campus (Capacity) — `pro` pour Pricing et Ranking, `mini` pour les autres ;
  3. extraction Gemini au plancher de la catégorie ;
  4. diff contre la production (`has_data_changed()`) : rien de nouveau, pas de ticket ;
  5. un ticket `Pending_Admin` par entrée pour les catégories à liste (Ranking, Capacity), reliés par `submission_group_id`.

```powershell
python -m backend.scripts.simulate_phase2_research --school-name "EDHEC Business School" --domain edhec.edu --max-programs 2
python -m backend.scripts.simulate_phase2_research --dry-run
```

---

## 👥 Étape 3 : Simulation du Crowdsourcing (Workflow A)

* **Script** : `backend/scripts/simulate_crowdsourcing.py`
* **Comportement** — celui de `process_crowdsourcing_ticket()` :
  1. crée un ticket `Pending_AI` lié à une URL ;
  2. extrait la page par Tavily Extract — contenu vide ou de moins de 50 caractères : **ticket supprimé** ;
  3. **compatibilité (Gemma 26B)**, sur les 25 000 premiers caractères — incompatible : `Rejected` ;
  4. **extraction (Gemma 31B)** : 80 000 caractères en mono-programme ; **sans `programId`**, mode multi-programme (25 000 caractères), chaque nom apparié aux programmes de l'école par clauses fermées (`program_identity.match_program`) — un nom ambigu ou inconnu part en `unmatched_programs` ;
  5. champs obligatoires à `null` : `GemmaParsingError`, **ticket supprimé** ;
  6. succès : `Pending_Admin`. Erreur API temporaire : reste `Pending_AI`. Erreur inattendue : `Failed`, rejoué après 60 min, supprimé après 3 tentatives.

Le texte libre du contributeur (`user_text`) n'est **jamais** transmis à un modèle.

```powershell
python -m backend.scripts.simulate_crowdsourcing
```
Pour tester un autre lien, modifiez `test_url` et la catégorie à la fin de `main()`.

---

## 🏫 Étape 4 : Rattachement campus — collecte, appariement, rejeu

Ces trois scripts servent à mettre au point la collecte du rattachement campus
(`architecture.md` §5.4). Avec `--cache-only`, ils rejouent les réponses Tavily et
Gemini déjà en cache et **ne dépensent aucun crédit** — une réponse absente du
cache lève `CacheMiss` au lieu d'être payée.

```powershell
# 1. Dump en lecture seule de la base (écoles, campus, programmes, arêtes, lignes-années)
npx tsx scripts/dump-program-identity.ts tmp/db.json

# 2. Collecte en sortie sèche (JSON, aucune écriture en base) — liste des campus lue dans le dump
python -m backend.scripts.simulate_campus_attachment `
  --school-name "Em Lyon" --domain em-lyon.com --catalog-url "https://em-lyon.com/fr/nos-programmes" `
  --db-dump tmp/db.json --limit 24 --batch-size 3 --cache-dir tmp/dry-cache --cache-only --out tmp/after

# 3. Appariement fiches → Program, et lignes réellement écrivables
python -m backend.scripts.resolve_program_identity --db-dump tmp/db.json `
  --school "Em Lyon" --dry tmp/after/em-lyon.json --out tmp/resolve

# 4. Le pas de Phase 1, rejoué sur cache pour toutes les écoles du dump
python -m backend.scripts.replay_phase1_campus_attachment --db-dump tmp/db.json --cache-dir tmp/dry-cache `
  --catalog "Em Lyon=https://em-lyon.com/fr/nos-programmes" --state as-dumped --out tmp/phase1-replay
```

`--campus` (liste de campus saisie à la main) n'est accepté qu'avec `--cache-only`.
`--no-page-guards` rejoue la sortie d'avant les gardes de page, pour mesurer leur
effet sur le même cache. `tmp/` est ignoré par git.

---

## 🛠️ Dépannage & Erreurs Courantes

### 1. UnicodeEncodeError sur la console Windows
* Posez `$env:PYTHONUTF8=1` avant de lancer le script ; les scripts forcent aussi `sys.stdout.reconfigure(encoding='utf-8')`.

### 2. Le ticket de crowdsourcing se fait rejeter pour incompatibilité
* **Cause probable** : le texte utile arrive après un très long menu, au-delà des 25 000 caractères envoyés au contrôle de compatibilité.
* **Attention avant de toucher la limite** : les trois plafonds de `processor.py` (80 000 / 25 000 / 25 000) sont délibérés et fixent le coût de chaque ticket. L'ancien conseil de ce guide (« régler le check à `[:80000]` ») ne correspond plus au code.

### 3. Too Many Requests (HTTP 429) sur Tavily
* **Cause** : la clé active a épuisé son quota ; `TavilyKeyManager` la marque épuisée et passe à la suivante.
* **Résolution** : ajoutez des clés — `TAVILY_API_KEYS="cle1,cle2"` ou `TAVILY_API_KEY_1` … `TAVILY_API_KEY_10`. Une clé refusée par l'API (« exceeds your plan's set usage limit ») est retentée une fois à chaque redémarrage, l'état des quotas ne vivant qu'en mémoire.

### 4. `ExtractionUnavailable` ou 503 Gemini
* **Cause** : tous les modèles au-dessus du plancher de la catégorie sont saturés ou épuisés pour la journée (quotas remis à zéro à minuit Pacifique).
* **Effet** : en Phase 1, le rapport Research est rangé — relancez plus tard la même école, sans repayer Research.
