# ⚙️ Fiche de Test Manuel : Dashboard Admin & Monitoring Cron

Ce guide détaille les étapes nécessaires pour tester localement le tableau de bord de monitoring des tâches cron (`/admin/cron`), le serveur backend (FastAPI), et le mécanisme de déblocage des cibles blacklistées.

---

## 🗄️ Étape 1 : Préparation de la Base de Données

La base de données est hébergée sur **Neon (PostgreSQL cloud)**. Il n'est pas nécessaire de lancer de serveur de base de données localement.

### 1.1 Configurer les variables d'environnement
Assurez-vous que vos fichiers de variables d'environnement contiennent bien la chaîne de connexion :
* Dans `.env.local` (à la racine) : `DATABASE_URL="..."` et `DIRECT_URL="..."`
* Dans `backend/.env` (dossier backend) : `DATABASE_URL="..."` (identique à `.env.local`) et `INTERNAL_TOKEN="..."`

### 1.2 Initialiser le compte administrateur (si nécessaire)
Si vous n'avez pas encore de compte admin configuré, exécutez la commande suivante à la racine :
```bash
npx prisma db seed
```
* **Identifiant par défaut** : `admin`
* **Mot de passe par défaut** : `admin1234`

### 1.3 Générer les données de test pour le Cron
Nous avons créé un script spécifique pour générer des cibles de scan (`CronTarget`) dans différents états (actif, en alerte, et bloqué/blacklisté) :
```bash
npx tsx prisma/seed_test_cron.ts
```
*Ce script va insérer en base de données des écoles de test (HEC Paris, ESSEC) et 4 cibles cron de test.*

---

## 🐍 Étape 2 : Lancer le Serveur Backend (FastAPI)

Le backend FastAPI gère la logique d'APScheduler, la rotation des clés Tavily et les appels aux modèles Gemma.

### 2.1 Activer l'environnement virtuel Python
Ouvrez un terminal et placez-vous à la racine du projet, puis lancez :
```powershell
# Sur Windows (PowerShell) :
.\backend\.venv\Scripts\Activate.ps1
```

### 2.2 Démarrer le backend avec Uvicorn
Lancez ensuite la commande suivante :
```bash
python -m uvicorn backend.main:app --port 8000 --reload
```
*Note : Le script `backend/main.py` intègre un chargeur automatique de variables d'environnement qui va lire directement `backend/.env` au démarrage.*

### 2.3 Vérifier le bon démarrage
Ouvrez votre navigateur ou utilisez curl sur :
* `http://127.0.0.1:8000/health` (doit renvoyer `{"status":"ok","version":"0.4.0"}`)

---

## 💻 Étape 3 : Lancer le Serveur Frontend (Next.js)

Le frontend Next.js héberge le dashboard d'administration et sert de proxy sécurisé pour communiquer avec le backend.

### 3.1 Démarrer Next.js
Dans un **nouveau terminal** à la racine du projet, exécutez :
```bash
npm run dev
```
*Le serveur se lancera par défaut sur `http://localhost:3000` (ou `http://localhost:3001` si le port 3000 est déjà occupé).*

---

## 🧪 Étape 4 : Scénario de Test Manuel

### 4.1 Connexion à l'interface
1. Ouvrez votre navigateur sur `http://localhost:3000/admin/cron`.
2. Vous serez redirigé vers la page de connexion admin (`/admin/login`).
3. Connectez-vous avec :
   * **Identifiant** : `admin`
   * **Mot de passe** : `admin1234`

### 4.2 Vérification des composants du tableau de bord
Une fois sur la page `/admin/cron` :
1. **Statut Backend** : Vous devez voir une pastille verte indiquant **Opérationnel**. (Si le backend était arrêté, un bandeau jaune indiquant un "démarrage à froid" avec compte à rebours s'afficherait).
2. **Modèle IA Principal** : Doit afficher `models/gemma-4-31b-it`.
3. **Quotas Tavily** : La jauge doit afficher les crédits restants de la clé Tavily active (`950 / 950 crédits restants`).
4. **Cibles de Scan (Cron)** : Vous devez voir la liste des 4 cibles générées par notre script de test :
   * **HEC Paris - Grande École - Pricing** : Statut **Actif** (Vert, 0/3 échecs).
   * **ESSEC Business School - Grande École - Pricing** : Statut **En échec** (Orange, 2/3 échecs).
   * **HEC Paris - Grande École - Ranking** : Statut **⚠️ Bloqué** (Rouge, 3/3 échecs) avec un bouton **Débloquer**.
   * **ESSEC Business School - Niveau École - Program_Discovery** : Statut **⚠️ Bloqué** (Rouge, 4/3 échecs) avec un bouton **Débloquer**.

### 4.3 Tester l'action de Déblocage ("Unblock")
1. Repérez la ligne de la cible **HEC Paris (Ranking)** ou **ESSEC (Program_Discovery)** qui est bloquée (Statut rouge).
2. Cliquez sur le bouton **Débloquer** à droite de la ligne.
3. Le bouton passera temporairement en état de chargement ("Déblocage...").
4. **Résultat attendu** : La requête API transite par Next.js, appelle le backend FastAPI pour nettoyer le flag de blacklist en base de données PostgreSQL, puis rafraîchit la table. La cible doit instantanément passer au statut **Actif** (Vert, 0/3 échecs) et le bouton disparaît.

---

## 🛠️ Dépannage en cas de 500 ou d'erreur de connexion

* **"Database connection error" ou 500 au chargement des cibles** : Assurez-vous que l'adresse IP de votre connexion actuelle est autorisée dans les paramètres de sécurité de votre projet Neon.tech (ou que le mode de connexion autorise les connexions IP dynamiques).
* **Le statut du backend reste à "Indisponible"** : Vérifiez dans la console du terminal FastAPI s'il y a des erreurs d'import ou si le port `8000` est déjà utilisé par un autre processus.
