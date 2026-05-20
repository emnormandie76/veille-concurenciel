"""
backend/pipeline/diff.py — Module de Diff (Étape 6.2)

Compare les données extraites par l'IA avec les données existantes en base de production 
afin de ne pas inonder l'Inbox de l'Admin si la donnée n'a pas changé.

Référence : task.md §6.2, Edge Case 10
"""

def has_data_changed(new_data: dict, existing_record: dict | None) -> bool:
    """
    Compare le JSON extrait (new_data) avec les données en BDD (existing_record).
    Retourne True s'il y a un changement, False sinon.
    Si existing_record est None, cela signifie qu'il n'y a pas de donnée existante, donc ça a changé.
    Gère les valeurs de nouvelles données manquantes.
    """
    if existing_record is None:
        return True

    # Parcourir uniquement les clés présentes dans new_data (hors clés techniques ou null non significatifs)
    for key, new_value in new_data.items():
        if key in ("source_url", "year_assumed", "data_conflict_warning"):
            continue
            
        old_value = existing_record.get(key)
        
        # S'assurer de comparer sur le même type si possible (ex: float vs int)
        if new_value is not None and old_value is not None:
            if isinstance(new_value, (int, float)) and isinstance(old_value, (int, float)):
                if float(new_value) != float(old_value):
                    return True
            elif str(new_value).strip().lower() != str(old_value).strip().lower():
                return True
        elif new_value != old_value:
            # Soit l'un est None, soit string vide différent de None
            if new_value == "" and old_value is None:
                continue
            return True
            
    return False
