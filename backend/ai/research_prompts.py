"""
backend/ai/research_prompts.py — Builders de prompts dynamiques pour Tavily Research (Étape R2)

Ce module fournit les constructeurs de requêtes dynamiques pour chaque type de recherche
menée par l'agent Tavily Research.
"""

def build_phase1_research_input(school_name: str, domain: str) -> str:
    """
    Construit le prompt de recherche pour la Phase 1 (Program Discovery).
    """
    return f"""Effectue une recherche exhaustive sur l'établissement d'enseignement supérieur français "{school_name}" (site officiel : https://{domain}).

OBJECTIF : Identifier TOUS les campus et programmes/formations proposés par cette école.

INFORMATIONS RECHERCHÉES PAR CAMPUS :
1. Nom exact du campus (tel qu'écrit sur le site officiel de l'école)
2. Ville du campus

INFORMATIONS RECHERCHÉES PAR PROGRAMME/FORMATION :
1. Nom exact du programme (tel qu'affiché sur le site officiel)
2. Concours d'admission requis (ex: "Concours Sésame", "Concours Accès", "Parcoursup") — ou null si non trouvé
3. L'alternance est-elle possible ? (true/false/null si inconnu)
4. Un séjour à l'étranger est-il obligatoire ? (true/false/null si inconnu)

RÈGLES STRICTES :
- Ne lister que les formations diplômantes principales (Bachelor, Master, PGE, MBA, MSc, BBA, IBBA, etc.)
- NE PAS lister les formations continues, les DU, les certificats courts ou les modules individuels
- Utiliser les NOMS EXACTS tels qu'écrits sur le site officiel (pas de traduction, pas de simplification)
- Si un campus n'a pas de nom distinct, utiliser "Campus [Ville]"
- Si l'information n'est pas trouvable, mettre null plutôt qu'inventer
- Privilégier les informations du site officiel https://{domain}"""


def build_pricing_research_input(
    school_name: str, program_name: str,
    academic_year_str: str, domain: str
) -> str:
    """
    Construit le prompt de recherche pour la Phase 2 - Pricing.
    Le tarif est identique quel que soit le campus (niveau programme-école).
    """
    return f"""Recherche les frais de scolarité du programme "{program_name}" de l'école "{school_name}" pour l'année scolaire {academic_year_str}.

INFORMATIONS RECHERCHÉES :
1. Frais de scolarité par année d'études :
   - Année 1 (year_1_fee) en euros
   - Année 2 (year_2_fee) en euros
   - Année 3 (year_3_fee) en euros
   - Année 4 (year_4_fee) en euros (si applicable)
   - Année 5 (year_5_fee) en euros (si applicable)
2. Frais total du cursus complet (total_fee) si disponible
3. Tarifs pour étudiants internationaux (Non-UE) si différents :
   - intl_year_1_fee, intl_total_fee, intl_currency
4. Devise (EUR par défaut)
5. Frais annexes éventuels : frais de dossier, CVEC, cotisation association étudiante, frais de concours (additional_fees_notes)
6. L'URL exacte de la page source contenant ces informations

RÈGLES STRICTES :
- Rapporter les prix EXACTS trouvés, NE JAMAIS calculer de moyenne ou de lissage
- Si le prix est par année, remplir year_X_fee. Si le prix est global pour tout le cursus, remplir total_fee
- Si l'année {academic_year_str} n'est pas encore publiée, prendre la dernière année disponible et le signaler
- Extraire séparément les tarifs UE et Non-UE si présents sur la même page
- Si des frais cachés ou annexes sont mentionnés (même en petit), les rapporter dans additional_fees_notes
- Privilégier le site officiel https://{domain} comme source principale"""


def build_ranking_research_input(
    school_name: str, program_name: str, academic_year_str: str, domain: str
) -> str:
    """
    Construit le prompt de recherche pour la Phase 2 - Ranking.
    """
    return f"""Recherche les classements du programme "{program_name}" de l'école "{school_name}" pour l'année {academic_year_str} dans les classements français et internationaux.

CLASSEMENTS À RECHERCHER (par ordre de priorité) :
- Le Figaro Étudiant (classement des écoles de commerce / ingénieurs)
- L'Étudiant (palmarès des grandes écoles)
- Le Parisien Étudiant
- SIGEM (classement basé sur les choix des étudiants)
- Financial Times (si applicable pour les Masters/MBA)
- QS World Rankings (si applicable)
- Le Point

INFORMATIONS RECHERCHÉES PAR CLASSEMENT TROUVÉ :
1. Nom exact du média/classement (ranking_name)
2. Rang / position (rank) — un nombre entier
3. Année du classement (academic_year)
4. URL source exacte (source_url)

RÈGLES STRICTES :
- Chaque classement trouvé doit être rapporté séparément
- Si plusieurs classements de sources différentes existent, les rapporter TOUS
- Si les sources se contredisent, rapporter les deux et le signaler
- NE PAS confondre le classement d'un programme spécifique avec le classement global de l'école
- Prendre le classement le plus récent disponible"""


def build_capacity_research_input(
    school_name: str, campus_name: str, program_name: str,
    academic_year_str: str, domain: str
) -> str:
    """
    Construit le prompt de recherche pour la Phase 2 - Capacity.
    """
    return f"""Recherche le nombre de places disponibles pour le programme "{program_name}" au campus "{campus_name}" de l'école "{school_name}" pour l'année scolaire {academic_year_str}.

INFORMATIONS RECHERCHÉES :
1. Nombre de places disponibles (spots_available) — un nombre entier
2. Année scolaire de référence (academic_year)
3. URL source exacte

SOURCES POSSIBLES :
- Site officiel de l'école : https://{domain}
- Concours-sesame.net (pour les écoles post-bac)
- Concours-acces.com
- Parcoursup (données publiques)
- Sites des concours d'admission

RÈGLES :
- Rapporter le chiffre EXACT trouvé
- Si l'information n'est pas disponible publiquement, le signaler clairement
- Distinguer "places ouvertes au concours" de "places totales du programme" si possible"""


def build_school_stats_research_input(
    school_name: str, academic_year_str: str, domain: str
) -> str:
    """
    Construit le prompt de recherche pour la Phase 2 - SchoolStats.
    """
    return f"""Recherche les chiffres clés et statistiques de l'école "{school_name}" pour l'année {academic_year_str} ou la plus récente disponible.

INFORMATIONS RECHERCHÉES :
1. Nombre total d'étudiants (total_students)
2. Nombre d'alumni / diplômés (total_alumni)
3. Nombre d'entreprises partenaires (partner_companies)
4. Nombre d'offres de stage annuelles (annual_internship_offers)
5. Nombre de campus à l'étranger (abroad_campuses)
6. Nombre d'universités partenaires (partner_universities)
7. Nombre de professeurs permanents (permanent_professors)
8. Pourcentage de professeurs internationaux (international_professors_pct) — entier entre 0 et 100 (ex: 46 pour 46%)
9. Pourcentage d'intervenants extérieurs (external_speakers_pct) — entier entre 0 et 100 (ex: 46 pour 46%)

SOURCE PRINCIPALE : https://{domain} (pages "chiffres clés", "en bref", "key figures", "about")

RÈGLES :
- Rapporter les chiffres EXACTS trouvés
- Si un chiffre n'est pas disponible, mettre null
- Privilégier les chiffres les plus récents
- Les pourcentages doivent être représentés sous forme d'entiers entre 0 et 100 (ex: 35% → 35)"""


def build_accreditation_research_input(
    school_name: str, domain: str
) -> str:
    """
    Construit le prompt de recherche pour la Phase 2 - Accreditation.
    ⚠️ Retourne une LISTE de toutes les accréditations avec classification par type.
    """
    return f"""Recherche TOUTES les accréditations et labels de qualité de l'école "{school_name}".

ACCRÉDITATIONS À RECHERCHER (liste non exhaustive) :
- EQUIS (EFMD Quality Improvement System)
- AACSB (Association to Advance Collegiate Schools of Business)
- AMBA (Association of MBAs)
- EPAS (EFMD Programme Accreditation System)
- BSIS (Business School Impact System)
- CGE (Conférence des Grandes Écoles)
- CTI (Commission des Titres d'Ingénieur)
- EESPIG (Établissement d'Enseignement Supérieur Privé d'Intérêt Général)
- Grade de Licence / Grade de Master (visas d'État)
- Qualiopi, DD&RS, SD/RS, "Bienvenue en France", CEFDG, et tout autre label visible

INFORMATIONS RECHERCHÉES POUR CHAQUE ACCRÉDITATION :
1. Nom exact de l'accréditation (accreditation_name)
2. Type (accreditation_type) — CLASSIFICATION OBLIGATOIRE :
   - "international" : EQUIS, AACSB, AMBA, EPAS, BSIS, ABET (organismes internationaux)
   - "state"         : Grade de Licence, Grade de Master, CTI, CEFDG (labels d'État français)
   - "label"         : CGE, EESPIG, Qualiopi, DD&RS, SD/RS, "Bienvenue en France", "Happy at School", et tous les autres
3. Année d'obtention ou de renouvellement (year_obtained) — omettre le champ si inconnue
4. Statut actif ou non (is_active) — true par défaut sauf mention contraire
5. URL de la page source (source_url)

SOURCE PRINCIPALE : https://{domain} (pages "accréditations", "labels", "reconnaissances", "accreditations")

RÈGLES ABSOLUES :
- Retourner TOUTES les accréditations trouvées dans la liste, même si elles sont nombreuses
- NE JAMAIS retourner une seule accréditation si plusieurs sont présentes sur la page
- Chaque accréditation doit être un élément distinct dans le tableau "accreditations"
- accreditation_type est OBLIGATOIRE pour chaque entrée
- is_active = true sauf si explicitement mentionné comme expiré/perdu/révoqué
- Si l'année d'obtention n'est pas trouvée, omettre le champ year_obtained
  (surtout pas 0 : l'année 0 se retrouvait écrite en production comme une
  donnée réelle)"""
