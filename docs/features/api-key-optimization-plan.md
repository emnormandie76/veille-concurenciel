# Optimisation de la Rotation des Clés API Tavily

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
