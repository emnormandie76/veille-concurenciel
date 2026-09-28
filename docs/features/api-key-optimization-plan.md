# Optimisation de la Rotation des Clés API Tavily

> **Statut au 28 septembre 2026 : implémenté.** Référence à jour :
> `architecture/architecture.md` §4.2. Depuis ce plan, deux appelants se sont
> ajoutés avec le même seuil léger de 5 crédits : l'ancrage catalogue
> (`CATALOG_REQUIRED_CREDITS`) et `/map` (`MAP_REQUIRED_CREDITS`). `/map` essaie
> jusqu'à trois clés, parce que le compteur local n'étant pas en temps réel, seule
> la réponse de l'API dit qu'une clé est refusée.

Ce plan implémente une rotation intelligente des clés API (Stratégie "Greedy") pour le client Tavily. L'objectif est d'utiliser au maximum chaque crédit disponible sur chaque clé, en empêchant les requêtes lourdes (mode "pro") d'échouer sur des clés avec peu de crédits, tout en permettant aux requêtes légères (mode "mini" ou requêtes standards de crawl/search) de consommer ces derniers crédits.

## Modifications Prévues

### 1. TavilyKeyManager (Logique de rotation)
**Fichier** : `backend/tavily_service/key_manager.py`

- **Signature `get_active_key`** : Modifier la fonction en `def get_active_key(self, required_credits: int = 50) -> str:`.
- **Logique de sélection (Greedy Search)** : 
  - Au lieu de s'appuyer strictement sur `_current_index`, on parcourt les clés et on calcule les crédits restants `remaining = ks.credits_limit - ks.credits_used`.
  - Si `not ks.exhausted` et `remaining >= required_credits`, on retourne cette clé.
- **Logique `exhausted`** :
  - On ne marque plus une clé comme `exhausted = True` via un seuil artificiel de 100. Une clé ne devient `exhausted` que si elle a moins de `10` crédits restants (hard limit) ou si l'API Tavily retourne un statut de limite atteinte.
- **Logique `record_usage`** :
  - Mettre à jour l'enregistrement pour ne marquer la clé comme `exhausted` que sous les 10 crédits restants.

### 2. Tavily Clients (Appels au Key Manager)
**Fichier** : `backend/tavily_service/research_client.py`
- Déclarer des constantes : `REQUIRED_CREDITS_PRO = 250` et `REQUIRED_CREDITS_MINI = 50`.
- Modifier la récupération de la clé :
  ```python
  req_credits = REQUIRED_CREDITS_PRO if model == "pro" else REQUIRED_CREDITS_MINI
  api_key = key_manager.get_active_key(required_credits=req_credits)
  ```

**Fichier** : `backend/tavily_service/client.py`
- Pour les fonctions de `crawl`, `search` et `extract`, modifier les appels à `get_active_key()` pour passer un `required_credits=5`.

---

## Plan de Tests (Validation)

Afin de garantir que l'algorithme réagit correctement sans dépendre de véritables appels API coûteux, nous créerons un script de test dédié.

**Fichier** : `backend/test_tavily_key_rotation.py`

Ce script simulera le gestionnaire de clés avec de fausses clés et des quotas prédéfinis pour valider plusieurs scénarios :
1. **Test Mode Pro (250 crédits requis)** : Vérifier que si la Clé 1 a seulement 150 crédits restants, elle est ignorée au profit de la Clé 2 qui est pleine.
2. **Test Mode Mini (50 crédits requis)** : Vérifier que suite au Test 1, si une requête "mini" est lancée, l'algorithme retourne bien vers la Clé 1 pour utiliser ses 150 crédits restants.
3. **Test d'épuisement (Exhaustion)** : Simuler l'utilisation des clés jusqu'à épuisement total pour s'assurer que l'exception `QuotaExhaustedError` est levée correctement.

---

## Correctifs apportés le 1er septembre 2026

La rotation « greedy » décrite ci-dessus est en place. Trois défauts la rendaient
pourtant inopérante en conditions réelles.

### 1. La synchronisation de quota réhabilitait les clés épuisées

`_fetch_quota_in_background()` écrasait `credits_used` avec la valeur distante et
comportait une branche `else: key_state.exhausted = False`.

Le piège est **circulaire** : `mark_exhausted()` déclenche lui-même une synchro.
Celle-ci récupérait une valeur distante encore en retard, concluait « il reste des
crédits » et rouvrait la clé — que l'API venait pourtant de refuser. Boucle de
sollicitation garantie.

**Corrigé** : `credits_used = max(local, distant)`, et **aucune branche ne remet
`exhausted` à `False`**. Seul le passage au mois suivant (`_reset_if_new_month`)
lève le drapeau.

### 2. `client.py` ne marquait jamais une clé refusée

Les phrases de détection étaient déclarées **localement dans une fonction** de
`research_client.py`. `client.py` ne les connaissait pas : sur un 402/429, ses
trois fonctions retournaient `""` sans appeler `mark_exhausted()`. La clé morte
restait sélectionnée et était réinterrogée en boucle ; l'appelant ne distinguait
pas non plus une panne d'une page vide.

**Corrigé** : `QUOTA_ERROR_PHRASES` et `is_quota_error()` sont remontées dans
`key_manager.py`. `crawl_school_website`, `search_web` et `extract_from_urls`
appellent `mark_exhausted()` avant de retourner.

### 3. Deux gestionnaires de clés coexistaient

`process_crowdsourcing_ticket()` lisait un global et, s'il était vide,
**instanciait un second `TavilyKeyManager`**. L'état des crédits ne vivant qu'en
mémoire par instance, chacun croyait disposer du quota complet : le seuil de
rotation n'était jamais franchi et le panneau admin affichait une consommation
minorée.

**Corrigé** : le gestionnaire est **injecté explicitement** depuis
`app.state.tavily_manager`. La fonction lève une `ValueError` s'il est absent, au
lieu d'en fabriquer un second. Le global a disparu.

### Écarts restants, non traités

- **Réservation et consommation divergentes** : `research_client.py` réserve
  250 crédits pour un appel « pro » (`REQUIRED_CREDITS_PRO`) mais n'en enregistre
  que 25 (`ESTIMATED_CREDITS`). Facteur dix entre le contrôle d'éligibilité et la
  comptabilité.
- ~~**Timeouts déclarés et jamais appliqués**~~ — **corrigé** : search, extract
  et map passent chacun leur délai (`TAVILY_*_TIMEOUT_SECONDS` : 60, 30 et
  120 s). `crawl_school_website`, qui n'était plus appelée, a été retirée le
  28 septembre 2026.
- ~~**`_current_index`**, vestige de la rotation circulaire~~ — **retiré** ;
  `get_active_key` applique un premier-disponible, et le dit.
- **L'état des quotas ne vit qu'en mémoire.** Un redémarrage le perd. Le persister
  hors du processus reste à faire.
