# Diagnostic & Stratégie : Gestion des Connexions BDD (Close Gate Connexion)

> **Statut au 28 septembre 2026 : implémenté**, y compris le verrou du pool
> signalé plus bas comme « non traité ». La règle s'applique aussi au code écrit
> depuis : la Phase 1 lit l'école puis referme avant Research, et la collecte du
> rattachement campus prend un instantané de la base avant tout appel payant.
> Référence : `architecture/architecture.md` §10.8.

## 1. Contexte & Symptôme Observé

Pendant l'exécution d'une recherche ciblée en Phase 2 (Tarifs / Pricing), l'erreur suivante est survenue dans les logs du terminal :

```text
88b-4e6a-4c66-9cdb-7813d3aea44e (tentative 68) — statut: completed
2026-07-27 14:03:56,450 [INFO] pipeline.phase2_research: 🔬 [PRO] Pricing pour Master in Management – Grande École (MiM)
2026-07-27 14:03:56,451 [INFO] pipeline.phase2_research: 🎉 JSON direct reçu de Tavily Research pour Pricing
2026-07-27 14:03:56,498 [ERROR] pipeline.internal: [job=f5d4bd65] Recherche ciblée erreur: connection already closed
```

## 2. Analyse de la Cause Racine (Root Cause)

### Le Problème du "Long-Held Connection"
1. **Durée d'exécution de Tavily Research** : L'API Tavily Research effectue une recherche approfondie multi-sources et peut boucler pendant plusieurs minutes (comme l'indique `tentative 68`).
2. **Connexion BDD Inactive (Idle)** : Le code ouvrait la connexion PostgreSQL via `with get_db_connection() as conn:` **avant** le lancement des appels Tavily et la laissait ouverte pendant toute la durée des requêtes HTTP.
3. **Fermeture unilatérale par le serveur** : Les serveurs PostgreSQL cloud (Neon serverless) ou les pare-feu réseau coupent automatiquement toute connexion inactive (`idle timeout`) après un certain délai (souvent 1 à 5 minutes).
4. **Échec à la sauvegarde** : Dès que Tavily Research se terminait, le script tentait d'écrire en BDD via cette même connexion. Trouvant un socket réseau déjà fermé, `psycopg2` levait `connection already closed`.

### Risques Supplémentaires
* **Saturation du Pool (5 connexions max)** : Maintenir des connexions ouvertes sans les utiliser bloque les slots du pool (`maxconn=5`), risquant de paralyser l'API pour les utilisateurs.
* **Perte de données** : Le résultat de l'IA est perdu si la sauvegarde échoue à la toute fin.

---

## 3. Cartographie du Codebase

### 🛑 Emplacements Vulnérables à Corriger

#### A. `backend/pipeline/phase2_research.py` (Ligne 269)
* **Impact** : Recherches manuelles ciblées Admin & Cron Phase 2.
* **Problème** : Un seul bloc `with get_db_connection() as conn:` englobe toute la fonction (L269-L583), maintenant la BDD ouverte pendant tous les appels `create_research_task(...)` (L374, L451, L521).

#### B. `backend/crowdsourcing/processor.py` (Ligne 393)
* **Impact** : Traitement par batch des soumissions utilisateurs (Cron toutes les 5m).
* **Problème** : `process_pending_submissions` conserve `conn` ouverte pendant qu'elle boucle sur 20 tickets en effectuant l'extraction Tavily (`extract_from_urls`) et les appels IA Gemma.

---

### 🟢 Emplacements Conformes (Exemples à Suivre)

#### A. `backend/pipeline/phase1_research.py` (Ligne 70 et 177)
* **Fonctionnement** : 
  1. Ouvre une connexion éphémère pour lire l'école (L70-L91), puis la **ferme**.
  2. Exécute Tavily Research (L99) **hors connexion BDD**.
  3. Ouvre une nouvelle connexion éphémère (L177) pour insérer le résultat dans `ContributionInbox`.

#### B. `backend/scheduler/jobs.py` (Lignes 70 et 163)
* **Fonctionnement** : Récupère uniquement la liste des écoles en BDD, ferme la connexion, puis délègue le traitement.

---

## 4. Recommandations et Pattern de Refactorisation

### Règle d'Or : "Ephemeral DB Connections"
> **Ne JAMAIS maintenir une connexion PostgreSQL ouverte lors d'un appel réseau externe (API Tavily, Gemini/Gemma, HTTP scraping).**

### Pattern Cible à Appliquer

```python
# 1. Connexion courte : Lecture des métadonnées
with get_db_connection() as conn:
    school_data = fetch_school_data(conn)

# 2. Exécution longue : Hors connexion BDD
research_result = call_tavily_research(...)

# 3. Connexion courte : Écriture des résultats
with get_db_connection() as conn:
    save_contribution_ticket(conn, research_result)
```

---

## État au 1er septembre 2026

### Ce qui a été corrigé

**`backend/crowdsourcing/processor.py`** — le point B de la cartographie
ci-dessus est **résolu**. `process_pending_submissions()` applique le pattern
cible :

1. connexion courte pour lire la liste des tickets, puis fermeture explicite
   (commentaire `── Connexion BDD FERMÉE ici ───` dans le code) ;
2. boucle de traitement **hors connexion**, Tavily et Gemma compris ;
3. connexions courtes à la volée pour chaque écriture.

### La règle, étendue

> **Ne JAMAIS maintenir une connexion PostgreSQL ouverte pendant un appel réseau
> externe** (Tavily, Gemini/Gemma, scraping HTTP).

Elle vaut aussi pour les **transactions Prisma** côté Next.js : le client
transactionnel ne dispose que d'une connexion, et `validate/route.ts` émet des
`Promise.all` dessus (l. 266, 358). Sous charge, risque de blocage ou de
dépassement du délai de 60 s. *Non corrigé.*

### Une limite proche — corrigée depuis

> **Corrigé.** `get_pool()` fait désormais une double vérification autour d'un
> `threading.Lock` (`_pool_lock`). Le constat d'origine :

`get_pool()` dans `backend/db.py` initialisait le pool **sans verrou**, alors que
les appels arrivent depuis `run_in_executor` et les threads APScheduler. Deux
pools concurrents créés à froid ouvriraient jusqu'à **10 connexions** sur un
palier Neon qui en autorise **5** — exactement le risque de saturation décrit
plus haut, par une autre voie.

Correctif attendu : protéger `get_pool()` par un `threading.Lock` en double
vérification.

### Effet de bord positif de la rétention des tickets

Le statut `Failed` avec rejeu différé (voir
[`decision-retention-tickets.md`](../memory/decision-retention-tickets.md))
réduit la portée de l'incident d'origine : une contribution perdue sur
`connection already closed` n'est plus détruite, elle est retentée une heure plus
tard.
