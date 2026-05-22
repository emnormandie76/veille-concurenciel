# 🚀 Guide de Simulation du Pipeline & Crowdsourcing (Étape par Étape)

Ce guide explique comment lancer localement et configurer pas à pas les scripts de simulation pour tester les trois flux majeurs du pipeline de veille concurrentielle :
1. **Phase 1** : Cartographie (Program Discovery)
2. **Phase 2** : Enrichissement (Pricing, Ranking, Capacity, SchoolStats)
3. **Workflow A** : Crowdsourcing Utilisateur (Soumission + Extraction + Validation IA)

---

## 📋 Prérequis Communs

Avant de lancer les scripts, assurez-vous d'avoir configuré l'environnement de développement :

### 1. Variables d'environnement
Le dossier `backend/` doit contenir un fichier `.env` configuré avec les accès aux API externes et à la base de données :
```ini
# Connexion base de données (Neon Cloud PostgreSQL)
DATABASE_URL="postgresql://user:password@endpoint/dbname?sslmode=require"

# API Google GenAI (Gemma 4)
GEMINI_API_KEY="AIzaSy..."

# API Tavily (Recherche & Scraping)
TAVILY_API_KEY="tvly-..."
```

### 2. Activer l'environnement virtuel Python
Ouvrez votre terminal et activez l'environnement virtuel :

* **Sur Windows (PowerShell)** :
  ```powershell
  $env:PYTHONUTF8=1
  .\backend\.venv\Scripts\Activate.ps1
  ```
* **Sur macOS / Linux** :
  ```bash
  export PYTHONUTF8=1
  source backend/.venv/bin/activate
  ```

---

## 🗺️ Étape 1 : Simulation de la Phase 1 (Program Discovery)

La **Phase 1** cherche à cartographier une école en découvrant ses campus et ses programmes d'études via son domaine officiel.

* **Script concerné** : [simulate_run.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/simulate_run.py)
* **Comportement** :
  1. Il insère ou récupère l'école cible (par défaut `Em Normandie` avec le domaine `www.em-normandie.com`) en base de données.
  2. Il exécute Tavily en mode `crawl` sur ce domaine.
  3. Il envoie le texte extrait au modèle **Gemma 31B** pour extraire la liste structurée des campus et programmes.
  4. Il insère un ticket de type `Program_Discovery` dans `ContributionInbox` au statut `Pending_Admin`.

### Lancement
Exécutez la commande suivante à la racine du projet :
```powershell
backend\.venv\Scripts\python backend\simulate_run.py
```

### Personnalisation
Pour tester une autre école, modifiez les variables suivantes au début de la fonction `simulate()` dans le fichier :
```python
school_name = "Votre Ecole"
school_domain = "www.votre-domaine.com"
```

---

## 🔍 Étape 2 : Simulation de la Phase 2 (Enrichissement Chirurgical)

La **Phase 2** prend un programme déjà validé en base de données et recherche activement sur le web des informations spécifiques sur les tarifs, les places disponibles ou les classements.

* **Script concerné** : [simulate_run_phase2.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/simulate_run_phase2.py)
* **Comportement** :
  1. Il sélectionne automatiquement une école active disposant de programmes en base de données (ou utilise l'école passée en paramètre).
  2. Il initie des requêtes ciblées sur Tavily Search (ex: *"tarifs scolarité frais PGE EMLV 2025"*).
  3. Il transmet le texte brut des résultats de recherche à **Gemma 31B** pour structurer les données.
  4. Si des données valides sont trouvées, il insère des tickets spécifiques (`Pricing`, `Ranking`, `Capacity`, `SchoolStats`) dans `ContributionInbox` en statut `Pending_Admin`.

### Lancement
Exécutez la commande suivante à la racine du projet :
```powershell
backend\.venv\Scripts\python backend/simulate_run_phase2.py
```

### Personnalisation
Pour forcer le script à enrichir une école spécifique (qui possède déjà un programme validé dans votre DB) :
```python
# Modifiez l'appel dans la section __main__ de simulate_run_phase2.py :
run_phase2(school_name="EMLV")  # Remplacer par le nom exact de l'école
```

---

## 👥 Étape 3 : Simulation du Crowdsourcing (Workflow A)

Ce flux traite la soumission d'un utilisateur externe qui propose une URL source pour une catégorie précise (ex: l'utilisateur a soumis le lien des tarifs EMLV).

* **Script concerné** : [simulate_crowdsourcing.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/simulate_crowdsourcing.py)
* **Comportement** :
  1. Il crée un ticket de test `Pending_AI` dans la table `ContributionInbox` lié à une URL soumise par l'utilisateur.
  2. Il extrait le texte de l'URL via Tavily Extract.
  3. **Vérification de compatibilité (Gemma 26B)** : Il analyse si la page est valide et parle bien de l'école et de la catégorie demandée (sur un texte maximum de 80 000 caractères).
  4. **Extraction structurée (Gemma 31B)** : Si compatible, il extrait les données au format JSON.
  5. **Validation des contraintes strictes** :
     * Rejette les tickets `Pricing`, `Ranking` ou `Capacity` s'ils ne sont pas rattachés à un programme précis (`programId`).
     * Rejette le ticket si les champs obligatoires sont extraits à `null` (ex: `spots_available` pour une capacité).
  6. Met à jour le ticket en BDD en statut `Pending_Admin` (Succès) ou `Rejected` (Données absentes ou invalides).

### Lancement
Exécutez la commande suivante à la racine du projet :
```powershell
backend\.venv\Scripts\python backend/simulate_crowdsourcing.py
```

### Personnalisation
Pour tester un autre lien de crowdsourcing, vous pouvez modifier les lignes suivantes à la fin de la fonction `main()` :
```python
# Exemple de configuration pour tester une capacité
test_url = "https://www.letudiant.fr/fiches/etudes/fiche/votre-page-test.html"
# Remplacez la catégorie et le type de ticket inséré :
# Categorie: Capacity
# (Assurez-vous que la catégorie correspond bien à votre test)
```

---

## 🛠️ Dépannage & Erreurs Courantes

### 1. UnicodeEncodeError sur la console Windows
Si vous voyez des erreurs d'affichage ou des crashs liés à l'affichage des émoticônes (`✅`, `❌`, `🛑`) :
* Assurez-vous d'avoir configuré la variable système `$env:PYTHONUTF8=1` avant de lancer le script.
* Les scripts de simulation incluent un reconfigurateur de flux `sys.stdout.reconfigure(encoding='utf-8')` pour forcer l'encodage.

### 2. Le ticket de crowdsourcing se fait rejeter pour incompatibilité
* **Cause** : Le texte utile est trop loin dans le document Markdown généré par Tavily (après un très long menu de navigation ou des bandeaux publicitaires).
* **Vérification** : La limite de troncature dans [processor.py](file:///c:/Users/aparede/Desktop/dev/appVC/backend/crowdsourcing/processor.py) pour le check Gemma 26B doit être réglée à `[:80000]` pour que le modèle ait accès à l'intégralité du texte utile.

### 3. Too Many Requests (HTTP 429) sur Tavily
* **Cause** : La clé API Tavily active a épuisé ses quotas mensuels de requêtes.
* **Résolution** : Le pipeline utilise un gestionnaire de rotation (`TavilyKeyManager`). Si vous disposez de clés secondaires, ajoutez-les dans `backend/.env` séparées par des virgules pour permettre la rotation automatique.
