# Conception : Amélioration de la Gestion des Erreurs et Robustesse de l'API Gemma

Ce document détaille la refonte de la gestion des erreurs dans les appels aux modèles Gemma pour le pipeline de crowdsourcing et d'enrichissement.

## Objectifs
1. **Distinguer proprement les types d'erreurs** : Différencier les pannes temporaires de l'API/Réseau (HTTP 500, 429, timeouts) des erreurs permanentes de format/parsing (JSON invalide, clés manquantes).
2. **Éviter le rejet abusif des tickets** : Si l'API renvoie une erreur 500 ou réseau, le ticket doit rester en `Pending_AI` pour être réessayé plus tard au lieu d'être marqué comme `Rejected`.
3. **Résoudre les bugs de parsing structurels** : Gérer de manière robuste le cas où Gemma retourne une liste JSON de dictionnaires `[ { ... } ]` au lieu d'un dictionnaire `{ ... }` directement.
4. **Optimiser la résilience** : Augmenter le nombre de tentatives (retries) à 4 et appliquer un backoff exponentiel à toutes les requêtes en erreur API.
5. **Rapport final précis** : Afficher un résumé synthétique de l'issue de tous les tickets traités à la fin de la routine de crowdsourcing.

---

## 1. Hiérarchie des Exceptions (`backend/ai/gemma_client.py`)

Nous introduisons les exceptions suivantes :
- `GemmaError(Exception)` : Exception de base pour tout problème lié à Gemma.
- `GemmaAPIError(GemmaError)` : Erreurs d'API temporaires (HTTP 500, 429 persistants, Timeout, Erreurs réseau).
- `GemmaParsingError(GemmaError)` : Erreurs structurelles (JSON invalide, clés manquantes, réponse vide).

---

## 2. Modifications dans `backend/ai/gemma_client.py`

### Robustesse au format Liste JSON
Dans la fonction `call_gemma`, après parsing du JSON :
```python
parsed_data = json.loads(clean_text)
if isinstance(parsed_data, list):
    if len(parsed_data) > 0 and isinstance(parsed_data[0], dict):
        logger.warning("⚠️ Le modèle a renvoyé une liste. Extraction du premier dictionnaire.")
        parsed_data = parsed_data[0]
    else:
        raise GemmaParsingError("Le JSON extrait est une liste vide ou ne contient pas de dictionnaire.")
```

### Gestion des retries et levée d'exceptions
Nous modifions la boucle de retry de `call_gemma` :
- `max_retries` par défaut passe à 4.
- Le délai de retry applique un backoff exponentiel pour les erreurs 429 ET les erreurs 500 (avec un facteur multiplicateur).
- En cas d'échec définitif après les retries :
  - Si l'erreur provient de l'API (HTTP 500, etc.), lever `GemmaAPIError`.
  - Si l'erreur provient du parsing/format (JSONDecodeError, clés manquantes), lever `GemmaParsingError`.

---

## 3. Modifications dans `backend/crowdsourcing/processor.py`

### Traitement individuel des tickets
La fonction `process_crowdsourcing_ticket(ticket_id)` est modifiée pour :
- Augmenter les tentatives de Gemma 26B et 31B à 4 retries.
- Capturer spécifiquement les exceptions :
  - `GemmaAPIError` : Lever l'erreur pour la remonter au gestionnaire global sans toucher au statut du ticket en BDD (qui reste ainsi en `Pending_AI`).
  - `GemmaParsingError` ou `TavilyExtractionError` : Mettre à jour le ticket à `Rejected` et enregistrer `{"parsing_error": str(e)}` dans `ai_extracted_json`.

### Résumé et rapport dans `process_pending_submissions`
La routine globale maintient des compteurs par ticket traité :
- `processed_successfully` : Liste des UUIDs validés (`Pending_Admin`).
- `api_errors` : Liste des UUIDs ayant échoué à cause d'erreurs d'API temporaires (restés en `Pending_AI`).
- `rejected` : Liste des UUIDs rejetés pour cause de parsing ou non-compatibilité.

Un log structuré est affiché à la fin du traitement :
```text
=== 📊 RAPPORT DE CROWDSOURCING ===
✅ Validés (Pending_Admin)  : 2 ticket(s) -> [uuid1, uuid2]
⏳ Erreurs API (Pending_AI) : 1 ticket(s) -> [uuid3]
❌ Rejetés (Rejected)       : 1 ticket(s) -> [uuid4]
==================================
```

---

## 4. Plan de Validation

### Tests Unitaires (`test/test_crowdsourcing_processor.py`)
- Mettre à jour les tests existants pour valider que :
  1. Une exception `GemmaAPIError` ne modifie pas le statut du ticket (il reste `Pending_AI`).
  2. Une exception `GemmaParsingError` marque bien le ticket comme `Rejected`.
  3. Le comportement de fallback sur le premier dictionnaire d'une liste JSON fonctionne sans erreur.
