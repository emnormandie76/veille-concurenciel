"""
backend/ai/research_schemas.py — JSON Schemas pour Tavily Research (Étape R2)

Ce module fournit les schémas JSON requis par l'endpoint Tavily Research (paramètre output_schema)
afin de forcer un format structuré à la sortie. Les schémas sont calqués sur les types
définis dans schema.prisma.
"""

# Schema pour la Phase 1 : Cartographie et découverte de campus/programmes
PHASE1_OUTPUT_SCHEMA = {
    "properties": {
        "discovered_campuses": {
            "type": "array",
            "description": "Liste de tous les campus trouvés pour l'école",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Nom exact du campus (ex: 'Campus Paris La Défense', 'Campus Montpellier')"
                    },
                    "city": {
                        "type": "string",
                        "description": "Ville où se situe le campus"
                    },
                    "programs": {
                        "type": "array",
                        "description": "Liste des programmes et formations proposés sur ce campus",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Nom exact de la formation (ex: 'Programme Grande École', 'Bachelor', 'IBBA')"
                                },
                                "admission_exam": {
                                    "type": "string",
                                    "description": "Nom du concours d'entrée si applicable (ex: 'Concours Sésame', 'Concours Accès', 'Sur dossier') ou null"
                                },
                                "is_alternance_possible": {
                                    "type": "boolean",
                                    "description": "L'alternance (apprentissage/professionnalisation) est-elle possible ?"
                                },
                                "is_expatriation_mandatory": {
                                    "type": "boolean",
                                    "description": "Le séjour ou l'expatriation à l'étranger est-il obligatoire pour valider le diplôme ?"
                                }
                            },
                            "required": ["name"]
                        }
                    }
                },
                "required": ["name", "programs"]
            }
        },
        "source_urls": {
            "type": "array",
            "description": "URLs des pages sources analysées sur le site de l'école",
            "items": {"type": "string"}
        },
        "confidence_notes": {
            "type": "string",
            "description": "Notes sur les incertitudes éventuelles (ex: programmes incertains)"
        }
    },
    "required": ["discovered_campuses"]
}

# Schema pour la Phase 2 : Pricing (Frais de scolarité)
PRICING_OUTPUT_SCHEMA = {
    "properties": {
        "academic_year": {
            "type": "integer",
            "description": "Année académique cible (année de début, ex: 2026 pour 2026-2027)"
        },
        "currency": {
            "type": "string",
            "description": "Devise des frais de scolarité (EUR par défaut)"
        },
        "year_1_fee": {"type": "integer", "description": "Frais de scolarité de l'année 1 en euros (ou devise locale)"},
        "year_2_fee": {"type": "integer", "description": "Frais de scolarité de l'année 2 en euros (ou devise locale)"},
        "year_3_fee": {"type": "integer", "description": "Frais de scolarité de l'année 3 en euros (ou devise locale)"},
        "year_4_fee": {"type": "integer", "description": "Frais de scolarité de l'année 4 en euros (ou devise locale)"},
        "year_5_fee": {"type": "integer", "description": "Frais de scolarité de l'année 5 en euros (ou devise locale)"},
        "total_fee": {"type": "integer", "description": "Frais totaux cumulés pour l'ensemble du cursus"},
        "intl_year_1_fee": {"type": "integer", "description": "Frais de scolarité de l'année 1 pour les étudiants internationaux non-UE"},
        "intl_total_fee": {"type": "integer", "description": "Frais totaux cumulés pour les étudiants internationaux non-UE"},
        "intl_currency": {"type": "string", "description": "Devise des frais internationaux"},
        "additional_fees_notes": {"type": "string", "description": "Notes libres sur d'autres frais (sécurité sociale, association, inscription...)"},
        "source_url": {"type": "string", "description": "URL de la page source où les prix ont été trouvés"},
        "year_assumed": {
            "type": "boolean",
            "description": "true si l'année académique n'était pas mentionnée explicitement et a été supposée (ex: par défaut l'année en cours)"
        },
        "data_conflict_warning": {
            "type": "boolean",
            "description": "true si plusieurs sources donnaient des tarifs contradictoires"
        }
    },
    "required": ["academic_year", "currency"]
}

# Schema pour la Phase 2 : Capacity (Nombre de places disponibles)
CAPACITY_OUTPUT_SCHEMA = {
    "properties": {
        "academic_year": {
            "type": "integer",
            "description": "Année académique cible (ex: 2026)"
        },
        "spots_available": {
            "type": "integer",
            "description": "Nombre total de places disponibles pour les admissions (toutes voies confondues)"
        },
        "source_url": {"type": "string", "description": "URL de la page source"},
        "year_assumed": {
            "type": "boolean",
            "description": "true si l'année n'était pas spécifiée explicitement"
        }
    },
    "required": ["spots_available", "academic_year"]
}

# Schema pour la Phase 2 : Ranking (Classements)
RANKING_OUTPUT_SCHEMA = {
    "properties": {
        "ranking_name": {
            "type": "string",
            "description": "Nom officiel du classement (ex: 'Le Figaro', 'L\\'Étudiant', 'SIGEM', 'FT')"
        },
        "rank": {
            "type": "integer",
            "description": "Rang obtenu par l'école / le programme dans ce classement (entier)"
        },
        "academic_year": {
            "type": "integer",
            "description": "Année du classement (ex: 2025 ou 2026)"
        },
        "source_url": {"type": "string", "description": "URL de la page source"},
        "data_conflict_warning": {
            "type": "boolean",
            "description": "true si des sources affichent des classements différents pour la même année"
        }
    },
    "required": ["ranking_name", "rank", "academic_year"]
}

# Schema pour la Phase 2 : SchoolStats (Chiffres clés et stats)
SCHOOL_STATS_OUTPUT_SCHEMA = {
    "properties": {
        "academic_year": {
            "type": "integer",
            "description": "Année académique cible (ex: 2026)"
        },
        "total_students": {
            "type": "integer",
            "description": "Nombre total d'étudiants inscrits dans l'école"
        },
        "total_alumni": {
            "type": "integer",
            "description": "Nombre total de diplômés (alumni)"
        },
        "partner_companies": {
            "type": "integer",
            "description": "Nombre d'entreprises partenaires"
        },
        "annual_internship_offers": {
            "type": "integer",
            "description": "Nombre d'offres de stage reçues annuellement par l'école"
        },
        "abroad_campuses": {
            "type": "integer",
            "description": "Nombre de campus à l'étranger"
        },
        "partner_universities": {
            "type": "integer",
            "description": "Nombre d'universités partenaires internationales"
        },
        "permanent_professors": {
            "type": "integer",
            "description": "Nombre d'enseignants-chercheurs permanents"
        },
        "international_professors_pct": {
            "type": "number",
            "description": "Pourcentage de professeurs internationaux (entier entre 0 et 100, ex: 46 pour 46%)"
        },
        "external_speakers_pct": {
            "type": "number",
            "description": "Pourcentage de conférenciers/intervenants externes (entier entre 0 et 100, ex: 46 pour 46%)"
        },
        "source_url": {"type": "string", "description": "URL de la page source"}
    },
    "required": ["academic_year"]
}

# Schema pour la Phase 2 : Accreditation (Accréditations académiques)
ACCREDITATION_OUTPUT_SCHEMA = {
    "properties": {
        "accreditation_name": {
            "type": "string",
            "description": "Nom exact de l'accréditation (ex: 'EQUIS', 'AACSB', 'AMBA')"
        },
        "year_obtained": {
            "type": "integer",
            "description": "Année d'obtention ou de renouvellement de l'accréditation"
        },
        "is_active": {
            "type": "boolean",
            "description": "L'accréditation est-elle actuellement active ?"
        },
        "source_url": {"type": "string", "description": "URL de la page source"}
    },
    "required": ["accreditation_name", "year_obtained", "is_active"]
}
