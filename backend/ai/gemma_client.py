"""
backend/ai/gemma_client.py — Module Gemma (Étape 4.4)

Implémentation production conforme au guide gemma-python-guide.md :
  - call_gemma() avec retry backoff exponentiel (429 / RESOURCE_EXHAUSTED)
  - clean_gemma_json() : nettoyage balises Markdown
  - validate_json_structure() : vérification clés obligatoires
  - is_content_relevant() : tri rapide Gemma 26B (Phase 2, Edge Case 11)
  - fact_check() : fact-checking Gemma 26B (Workflow A)

RÈGLES ABSOLUES (Règle 3) :
  - Pydantic est INTERDIT avec Gemma → prompting JSON uniquement
  - system_instruction séparé de contents
  - Délimiteurs <TEXTE_SOURCE>...</TEXTE_SOURCE> pour le contenu scrapé
  - temperature = 0.1 sur tous les appels d'extraction

Référence : task.md §4.4, gemma-python-guide.md §3
"""

import os
import re
import json
import time
import logging
from google import genai
from google.genai import types

logger = logging.getLogger("pipeline.gemma")

# ── Client API (singleton) ────────────────────────────────────────

_client: genai.Client | None = None


def get_client() -> genai.Client:
    """Retourne le client Google GenAI (lazy init, singleton)."""
    global _client
    if _client is None:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError("GEMINI_API_KEY non définie dans les variables d'environnement")
        _client = genai.Client(api_key=api_key)
        logger.info("✅ Client Google GenAI initialisé")
    return _client


# ── Nettoyage JSON (Règle 3) ──────────────────────────────────────

def clean_gemma_json(raw_text: str) -> str:
    """
    Nettoie les balises Markdown que Gemma rajoute autour du JSON.

    Gère les cas :
    - ```json\\n{...}\\n```
    - ```\\n{...}\\n```
    - Texte avant/après le JSON
    - Multiples blocs de code

    Référence : gemma-python-guide.md §3 (clean_gemma_json)
    """
    text = raw_text.strip()

    # Cas 1 : Bloc de code Markdown ```json ... ```
    match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', text)
    if match:
        text = match.group(1).strip()

    # Cas 2 : Texte autour du JSON — trouver les délimiteurs { } ou [ ]
    if not text.startswith('{') and not text.startswith('['):
        start_obj = text.find('{')
        start_arr = text.find('[')
        if start_obj == -1:
            start = start_arr
        elif start_arr == -1:
            start = start_obj
        else:
            start = min(start_obj, start_arr)

        if start != -1:
            end = text.rfind('}') if text[start] == '{' else text.rfind(']')
            if end != -1:
                text = text[start:end + 1]

    return text.strip()


def validate_json_structure(data: dict, required_keys: list[str]) -> list[str]:
    """
    Vérifie que le JSON contient les clés obligatoires.
    Retourne la liste des clés manquantes (vide = OK).

    Référence : gemma-python-guide.md §3 (validate_json_structure)
    """
    return [key for key in required_keys if key not in data]


# ── Appel Gemma avec retry (template production) ──────────────────

def call_gemma(
    model: str,
    system_prompt: str,
    user_content: str,
    required_keys: list[str],
    max_retries: int = 3,
    base_delay: float = 2.0,
    temperature: float = 0.1,
) -> dict | None:
    """
    Appelle un modèle Gemma avec retry, nettoyage JSON et validation structurelle.

    Args:
        model: Identifiant du modèle ('models/gemma-4-31b-it' ou 'models/gemma-4-26b-a4b-it').
        system_prompt: Instructions système (rôle, règles, structure JSON attendue).
        user_content: Contenu à analyser, encadré par <TEXTE_SOURCE>...</TEXTE_SOURCE>.
        required_keys: Clés JSON obligatoires dans la réponse.
        max_retries: Nombre max de tentatives (défaut: 3).
        base_delay: Délai initial avant retry en secondes (défaut: 2s).
        temperature: Température du modèle (défaut: 0.1 pour la précision d'extraction).

    Returns:
        Le dictionnaire JSON extrait, ou None en cas d'échec après max_retries.

    Référence : gemma-python-guide.md §3 (call_gemma_with_retry)
    """
    client = get_client()
    raw_text = ""

    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"[Tentative {attempt}/{max_retries}] Appel {model}")

            # ── Appel API avec system_instruction séparé ──────────
            # RÈGLE : Ne JAMAIS concaténer system + user dans contents
            response = client.models.generate_content(
                model=model,
                contents=user_content,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=temperature,
                )
            )

            # ── Vérification finish_reason ────────────────────────
            if response.candidates and response.candidates[0].finish_reason:
                finish_reason = response.candidates[0].finish_reason.name
                if finish_reason != "STOP":
                    logger.warning(
                        f"Réponse tronquée (finish_reason={finish_reason}) — "
                        f"JSON probablement incomplet."
                    )
                    if attempt < max_retries:
                        time.sleep(base_delay)
                        continue
                    return None

            # ── Extraction et nettoyage ───────────────────────────
            raw_text = response.text
            if not raw_text or len(raw_text.strip()) < 5:
                logger.warning(f"Réponse vide ou trop courte ({len(raw_text)} chars)")
                if attempt < max_retries:
                    time.sleep(base_delay)
                    continue
                return None

            logger.debug(f"Réponse brute ({len(raw_text)} chars): {raw_text[:200]}...")

            clean_text = clean_gemma_json(raw_text)
            parsed_data = json.loads(clean_text)

            # ── Validation structurelle ───────────────────────────
            missing = validate_json_structure(parsed_data, required_keys)
            if missing:
                logger.warning(
                    f"Clés manquantes: {missing}. "
                    f"Reçu: {list(parsed_data.keys())}"
                )
                if attempt < max_retries:
                    time.sleep(base_delay)
                    continue
                # Dernier essai : retourner quand même (l'appelant décide)
                return parsed_data

            logger.info("✅ Extraction réussie et validée.")
            return parsed_data

        except json.JSONDecodeError as e:
            logger.error(
                f"❌ JSON invalide (tentative {attempt}): {e}. "
                f"Brut: {raw_text[:300]}"
            )
            if attempt < max_retries:
                time.sleep(base_delay)

        except Exception as e:
            error_str = str(e)
            # ── Rate limit HTTP 429 → backoff exponentiel ─────────
            # Référence : gemma-python-guide.md §3, Règle 4 (retry 429)
            if "429" in error_str or "RESOURCE_EXHAUSTED" in error_str:
                delay = base_delay * (2 ** (attempt - 1))
                logger.warning(f"⏳ Rate limit détecté. Retry dans {delay:.1f}s...")
                time.sleep(delay)
            else:
                logger.error(f"❌ Erreur API inattendue (tentative {attempt}): {e}")
                if attempt < max_retries:
                    time.sleep(base_delay)
                else:
                    return None

    logger.error(f"❌ Échec après {max_retries} tentatives. Abandon.")
    return None


# ── Tri rapide Gemma 26B ──────────────────────────────────────────

def is_content_relevant(raw_content: str, category: str) -> bool:
    """
    Tri rapide via Gemma 26B : le contenu est-il pertinent pour la catégorie ?

    Détecte : paywalls, pages cookies/RGPD, contenus hors-sujet (Edge Case 11).

    Returns:
        True si le contenu est pertinent.
        False si non-pertinent ou si l'appel échoue (skip prudent).

    Référence : task.md §6.3, architecture.md §5.3, gemma-python-guide.md §3
    """
    system_prompt = (
        f'Tu es un filtre de pertinence. Analyse le texte et réponds '
        f'UNIQUEMENT avec un JSON valide : {{"relevant": true/false, "reason": "explication courte"}}.\n\n'
        f'Critères de NON-pertinence :\n'
        f'- Page de cookies/RGPD/consentement\n'
        f'- Paywall ou page de connexion requise\n'
        f'- Contenu sans rapport avec la catégorie "{category}"\n'
        f'- Page d\'erreur 404/500'
    )

    user_content = f"<TEXTE_SOURCE>\n{raw_content[:3000]}\n</TEXTE_SOURCE>"

    result = call_gemma(
        model="models/gemma-4-26b-a4b-it",
        system_prompt=system_prompt,
        user_content=user_content,
        required_keys=["relevant"],
        max_retries=2,
        temperature=0.1,
    )

    if result is None:
        return False  # En cas de doute → skip (comportement sûr)

    return bool(result.get("relevant", False))


# ── Fact-checking Gemma 26B (Workflow A) ──────────────────────────

def fact_check(user_claim: str, source_content: str) -> dict | None:
    """
    Vérifie qu'un texte source confirme la revendication de l'utilisateur.
    Utilisé dans le Workflow A (Crowdsourcing) après Tavily extract.

    Returns:
        Dict avec: confirmed (bool), confidence (str), extracted_value (str|None), explanation (str)
        Ou None si l'appel échoue.

    Référence : task.md §7.3, gemma-python-guide.md §4
    """
    system_prompt = (
        'Tu es un vérificateur de faits. Compare la REVENDICATION de l\'utilisateur '
        'avec le TEXTE SOURCE.\n\n'
        'Réponds UNIQUEMENT avec un JSON valide :\n'
        '{\n'
        '  "confirmed": true/false,\n'
        '  "confidence": "high"/"medium"/"low",\n'
        '  "extracted_value": "la valeur exacte trouvée dans le texte ou null",\n'
        '  "explanation": "Pourquoi tu confirmes ou infirmes"\n'
        '}'
    )

    user_content = (
        f"REVENDICATION : {user_claim}\n\n"
        f"<TEXTE_SOURCE>\n{source_content[:4000]}\n</TEXTE_SOURCE>"
    )

    return call_gemma(
        model="models/gemma-4-26b-a4b-it",
        system_prompt=system_prompt,
        user_content=user_content,
        required_keys=["confirmed", "confidence"],
        temperature=0.1,
    )
