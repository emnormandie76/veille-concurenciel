# Spécification Technique — Affichage Accordéon & Filtres Programmes

> **Date :** 1er juillet 2026  
> **Statut :** Approuvé par l'utilisateur  
> **Fichier :** `docs/superpowers/specs/2026-07-01-collapsible-campuses-design.md`  

---

## 1. Objectif du Changement
La page de détail d'une école (vue publique) peut devenir extrêmement longue et difficile à lire lorsqu'une école possède de nombreux campus et programmes.
L'objectif est d'alléger cette vue :
1. En regroupant les programmes par **Campus sous forme d'accordéons** rétractables (fermés par défaut).
2. En ajoutant un **panneau de filtres** interactifs par type de diplôme (PGE, Bachelor, Master, MSc) et niveau d'études (Bac+3, Bac+5, Bac+6) pour cibler directement les formations recherchées.

---

## 2. Architecture & Modélisation
Aucune modification n'est requise sur le schéma de la base de données. L'ensemble de la logique de filtrage et de classification se fera **côté client** (front-end) dans le composant Next.js existant [SchoolDetailClient.tsx](file:///c:/Users/aparede/Desktop/dev/appVC/app/schools/[id]/SchoolDetailClient.tsx) :

```
[Filtre Diplôme : PGE | Bachelor | Master | MSc | Tous]
[Filtre Niveau  : Bac+3 | Bac+5 | Bac+6 | Tous]

┌────────────────────────────────────────────────────────┐
│ 🏛️ Campus Paris La Défense (2 programmes)            ▼ │  <-- Clic pour Déplier / Replier
├────────────────────────────────────────────────────────┤
│  - Programme Grande École (Bac+5, PGE)                 │
│  - Bachelor Technology & Management (Bac+3, Bachelor)  │
└────────────────────────────────────────────────────────┘
```

---

## 3. Détails d'Implémentation

### 3.1. Classification Dynamique des Programmes (Filtre par Mots-Clés)
Chaque programme sera classé dynamiquement en fonction de son nom (`program.name`) :

| Type de diplôme | Expression Régulière / Mots-clés | Niveau d'études |
| :--- | :--- | :--- |
| **PGE** | `pge`, `grande école` | **Bac+5** |
| **Bachelor** | `bachelor`, `bba`, `bac+3` | **Bac+3** |
| **Master** | `master`, `mastère`, `mba` (excluant `spécialisé`) | **Bac+5** |
| **MSc** | `msc`, `science`, `spécialisé`, `bac+6` | **Bac+6** |
| **Doctorat** | `doctorat`, `phd`, `bac+8` | **Bac+8** |

### 3.2. États du Composant Client
Trois nouveaux états React seront ajoutés dans [SchoolDetailClient.tsx](file:///c:/Users/aparede/Desktop/dev/appVC/app/schools/[id]/SchoolDetailClient.tsx) :
* `openCampuses`: Dictionnaire `Record<string, boolean>` mémorisant si chaque campus est ouvert ou fermé (fermé par défaut).
* `activeType`: Filtre par type sélectionné (`"all" | "PGE" | "Bachelor" | "Master" | "MSc"`).
* `activeLevel`: Filtre par niveau sélectionné (`"all" | "Bac+3" | "Bac+5" | "Bac+6"`).

### 3.3. Styles CSS
Les nouveaux styles pour le panneau de filtres, les accordéons, les transitions et les boutons actifs seront ajoutés à la fin de [globals.css](file:///c:/Users/aparede/Desktop/dev/appVC/app/globals.css) en réutilisant le design system existant :
* Accordéon : background `var(--bg-secondary)`, bordure `var(--border-color)`, chevrons animés.
* Boutons actifs : background `var(--accent)`, couleur `#fff`, lueur `var(--accent-glow)`.

---

## 4. Plan de Vérification
* **TypeScript** : Validation sans erreur via `npx tsc --noEmit`.
* **Fonctionnel** :
  1. Vérifier que les campus sont repliés par défaut au chargement.
  2. Cliquer sur un campus pour vérifier le dépliement fluide.
  3. Cliquer sur les filtres de diplôme (Bachelor, PGE...) et vérifier que seuls les programmes correspondants s'affichent, et que le compteur sur le header du campus s'actualise correctement.
  4. Réinitialiser les filtres pour retrouver l'affichage de base.
