"""
Calcul dynamique de l'année scolaire cible N+1.

En France, l'année scolaire va de septembre à juillet.
On cherche toujours les données de l'année N+1 (la prochaine rentrée).

Exemples :
  - Mai 2026   → cible "2026-2027" (year_int = 2026)
  - Octobre 2026 → cible "2027-2028" (year_int = 2027)
  - Août 2027  → cible "2027-2028" (year_int = 2027)
  - Septembre 2027 → cible "2028-2029" (year_int = 2028)
"""

from datetime import date

ACADEMIC_YEAR_PIVOT_MONTH = 9  # Septembre

def get_target_academic_year_int() -> int:
    """
    Retourne l'année de DÉBUT de l'année scolaire cible N+1.
    
    Logique :
      - Avant septembre (janv-août) : année_courante
        → On est dans l'année scolaire courante, on cherche la suivante
        → Ex: Mai 2026 → on est en 2025-2026 → on cible 2026-2027 → retourne 2026
      - À partir de septembre (sept-déc) : année_courante + 1
        → On est déjà dans la nouvelle année scolaire, on cible la suivante
        → Ex: Oct 2026 → on est en 2026-2027 → on cible 2027-2028 → retourne 2027
    """
    today = date.today()
    if today.month >= ACADEMIC_YEAR_PIVOT_MONTH:
        return today.year + 1
    return today.year


def get_target_academic_year_str() -> str:
    """
    Retourne l'année scolaire cible au format "YYYY-YYYY+1".
    Ex: "2026-2027"
    """
    year = get_target_academic_year_int()
    return f"{year}-{year + 1}"


def get_current_academic_year_int() -> int:
    """
    Retourne l'année de DÉBUT de l'année scolaire en cours.
    Utile pour la comparaison / validation.
    """
    today = date.today()
    if today.month >= ACADEMIC_YEAR_PIVOT_MONTH:
        return today.year
    return today.year - 1
