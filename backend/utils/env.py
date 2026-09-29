"""
Lecture des variables d'environnement numériques.

Un `int(os.environ.get(...))` au niveau d'un module fait tomber le démarrage
sur une faute de frappe. Pour les réglages de la rotation des recherches, une
valeur illisible retombe sur le défaut, et le dit.
"""

import logging
import os

logger = logging.getLogger("pipeline.config")


def env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    """
    Entier lu dans `name`, ou `default` si la variable est absente, vide, non
    entière ou sous `minimum` — avec un avertissement dans ces deux derniers cas.
    """
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("⚠️ %s=%r n'est pas un entier : défaut %d retenu", name, raw, default)
        return default
    if minimum is not None and value < minimum:
        logger.warning("⚠️ %s=%d est sous le minimum %d : défaut %d retenu", name, value, minimum, default)
        return default
    return value
