"""
backend/ai/gemma_client.py — Module Gemma (Étape 4.4)

Implémentation production conforme au guide gemma-python-guide.md :
  - call_gemma() avec retry backoff exponentiel (429 / RESOURCE_EXHAUSTED)
  - clean_gemma_json() : nettoyage balises Markdown
  - validate_json_structure() : vérification clés obligatoires

is_content_relevant() et fact_check() ont été retirées : elles n'étaient appelées
nulle part. fact_check() prenait une revendication utilisateur en entrée ; la
laisser appelable sans usage, c'était garder ouverte une porte d'injection de
prompt pour un service que personne ne rendait. Leur code reste dans l'historique
Git (et le modèle d'appel dans docs/architecture/gemma-python-guide.md) si le
besoin revient.

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


# ── Délimitation du contenu non fiable ────────────────────────────
#
# Le contenu scrapé est interpolé dans un gabarit qui se termine par
# </TEXTE_SOURCE>. Une page qui contient elle-même cette balise fermante sort du
# bloc : tout ce qui suit est alors lu par le modèle comme une consigne et non
# plus comme de la matière à analyser. Ces deux fonctions sont le seul chemin
# autorisé pour injecter du contenu externe dans un prompt.

_DELIMITER_RE = re.compile(r"</?\s*(TEXTE_SOURCE|REVENDICATION)\s*>", re.IGNORECASE)


def sanitize_source(text: str | None) -> str:
    """Neutralise les balises de délimitation présentes dans un contenu externe."""
    return _DELIMITER_RE.sub("[balise neutralisée]", text or "")


def wrap_source(text: str | None, limit: int | None = None) -> str:
    """Tronque, neutralise puis encadre un contenu externe dans <TEXTE_SOURCE>."""
    content = text or ""
    if limit is not None:
        content = content[:limit]
    return f"<TEXTE_SOURCE>\n{sanitize_source(content)}\n</TEXTE_SOURCE>"


# ── Custom Exceptions ─────────────────────────────────────────────

class GemmaError(Exception):
    """Base exception for Gemma-related errors."""
    pass


class GemmaAPIError(GemmaError):
    """Raised when the Google GenAI API returns an error or fails to connect."""
    pass


class GemmaParsingError(GemmaError):
    """Raised when the response cannot be parsed or lacks required fields."""
    pass


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
    - ```json\n{...}\n```
    - ```\n{...}\n```
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


# ── Erreurs définitives ──────────────────────────────────
#
# La boucle de réessai repartait sur toute exception, y compris une clé invalide
# ou une requête malformée : trois tentatives et cinq secondes d'attente pour une
# erreur qui ne se résoudra jamais. Le coût est double — le temps d'attente, et
# le thread APScheduler immobilisé pendant ce temps.
#
# 408 (timeout) et 429 (quota) restent rejoués : ce sont les seules 4xx qui
# peuvent se résoudre d'elles-mêmes.
_RETRYABLE_CLIENT_CODES = (408, 429)


def _permanent_api_error_code(error: Exception) -> int | None:
    """
    Retourne le code HTTP de l'erreur si elle est définitive, None sinon.

    google.genai.errors.ClientError porte le code dans `.code` ; on accepte
    aussi `.status_code`, present sur d'autres clients HTTP.
    """
    code = getattr(error, "code", None)
    if not isinstance(code, int):
        code = getattr(error, "status_code", None)
    if isinstance(code, int) and 400 <= code < 500 and code not in _RETRYABLE_CLIENT_CODES:
        return code
    return None


# ── Appel Gemma avec retry (template production) ──────────────────

def call_gemma(
    model: str,
    system_prompt: str,
    user_content: str,
    required_keys: list[str],
    max_retries: int = 3,
    base_delay: float = 2.0,
    temperature: float = 0.1,
) -> dict:
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
        Le dictionnaire JSON extrait.

    Raises:
        GemmaAPIError: Si l'API ou le réseau échoue de manière persistante.
        GemmaParsingError: Si le format JSON ou les clés obligatoires sont incorrects.

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
                    raise GemmaParsingError(f"Réponse tronquée avec finish_reason={finish_reason}")

            # ── Extraction et nettoyage ───────────────────────────
            # `response.text` vaut None quand Gemma ne renvoie aucune part
            # textuelle (filtre de securite, finish_reason inattendu). Sans ce
            # `or ""`, la garde ci-dessous entrait bien dans sa branche mais
            # plantait dessus : len(None) leve un TypeError, et le bloc except
            # plus bas fait raw_text[:300], qui leve le meme. La garde censee
            # absorber une reponse vide etait donc precisement ce qui cassait,
            # en emportant le retry prevu juste en dessous.
            raw_text = response.text or ""
            if not raw_text or len(raw_text.strip()) < 5:
                logger.warning(f"Réponse vide ou trop courte ({len(raw_text)} chars)")
                if attempt < max_retries:
                    time.sleep(base_delay)
                    continue
                raise GemmaParsingError("Réponse de Gemma vide ou trop courte")

            logger.debug(f"Réponse brute ({len(raw_text)} chars): {raw_text[:200]}...")

            clean_text = clean_gemma_json(raw_text)
            parsed_data = json.loads(clean_text)

            # --- Robustesse au format Liste JSON ---
            if isinstance(parsed_data, list):
                if len(parsed_data) > 0 and isinstance(parsed_data[0], dict):
                    logger.warning("⚠️ Le modèle a renvoyé une liste. Extraction du premier dictionnaire.")
                    parsed_data = parsed_data[0]
                else:
                    raise GemmaParsingError("Le JSON extrait est une liste vide ou ne contient pas de dictionnaire.")
            elif not isinstance(parsed_data, dict):
                raise GemmaParsingError(f"Le JSON extrait n'est pas un dictionnaire. Type: {type(parsed_data)}")

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
                raise GemmaParsingError(f"Clés JSON obligatoires manquantes après {max_retries} tentatives: {missing}")

            logger.info("✅ Extraction réussie et validée.")
            return parsed_data

        except (json.JSONDecodeError, GemmaParsingError) as e:
            logger.error(
                f"❌ JSON/Parsing invalide (tentative {attempt}/{max_retries}): {e}. "
                f"Brut: {raw_text[:300]}"
            )
            if attempt >= max_retries:
                raise GemmaParsingError(f"Échec de parsing JSON après {max_retries} tentatives: {str(e)}")
            time.sleep(base_delay)

        except Exception as e:
            permanent_code = _permanent_api_error_code(e)
            if permanent_code is not None:
                logger.error(
                    f"⛔ Erreur API définitive ({permanent_code}) — aucun réessai : {e}"
                )
                raise GemmaAPIError(
                    f"Erreur API Gemma définitive ({permanent_code}) : {e}"
                ) from e

            # Backoff exponentiel sur erreur d'API ou de réseau (ex: 500, 503, ConnectionError)
            delay = base_delay * (1.5 ** (attempt - 1))
            logger.error(f"❌ Erreur API inattendue (tentative {attempt}/{max_retries}): {e}")
            if attempt >= max_retries:
                raise GemmaAPIError(f"Erreur API Gemma persistante après {max_retries} tentatives: {str(e)}")
            time.sleep(delay)

    raise GemmaError(f"Échec de call_gemma après {max_retries} tentatives.")
