# 🗑️ Plan d'Implémentation — Purge Inbox + Fix Contributions Invalides

> **📁 Document historique — ne pas exécuter.** Consigne donnée à un agent le 1er juillet 2026,
> conservée pour la trace des décisions. Le code a évolué depuis ; la référence
> actuelle est [`docs/architecture/architecture.md`](../architecture/architecture.md)
> (revue le 28 septembre 2026).
> Implémenté : `DELETE /api/admin/inbox/purge` (ADMIN) et suppression des
> tickets à URL invalide (`TavilyExtractionError`).

> **Version :** 1.0 — 1er juillet 2026  
> **Objectif :** Ajouter un bouton de purge des tickets traités dans admin/inbox + supprimer automatiquement les tickets de contributions dont l'URL est invalide  
> **Destinataire :** Agent IA développeur pour exécution  
> **Priorité :** Haute — la BDD Neon est limitée à 500 Mo

---

## Table des Matières

1. [Résumé des Changements](#1-résumé-des-changements)
2. [AXE 1 — Bouton de Purge des Tickets Traités](#2-axe-1--bouton-de-purge-des-tickets-traités)
3. [AXE 2 — Suppression Automatique des Contributions Invalides](#3-axe-2--suppression-automatique-des-contributions-invalides)
4. [AXE 3 — Correction des Imports Cassés dans processor.py](#4-axe-3--correction-des-imports-cassés-dans-processorpy)
5. [Fichiers à Créer](#5-fichiers-à-créer)
6. [Fichiers à Modifier (Détail Précis)](#6-fichiers-à-modifier)
7. [Plan de Vérification](#7-plan-de-vérification)
8. [Ordre d'Exécution Recommandé](#8-ordre-dexécution-recommandé)

---

## 1. Résumé des Changements

### AXE 1 — Bouton de purge dans admin/inbox

La BDD Neon.tech est limitée à 500 Mo. Les tickets `Validated` et `Rejected` dans `ContributionInbox` occupent de l'espace inutilement une fois traités. Un bouton de purge dans la page admin/inbox permettra à l'Admin ou au Modérateur de supprimer ces tickets en masse.

**Règles définies :**

| Règle | Valeur |
|---|---|
| Statuts supprimables | `Validated` ET/OU `Rejected` (au choix de l'utilisateur) |
| Statuts JAMAIS supprimables | `Pending_AI`, `Pending_Admin` |
| UX | Bouton "🗑️ Purger" avec dropdown de filtre (Validés, Rejetés, ou les deux) |
| Sécurité | Modal de double confirmation avec compteur de tickets à supprimer |
| Rôle requis | Admin ou Moderator (même niveau que l'accès inbox actuel) |

### AXE 2 — Suppression automatique des contributions invalides

Quand un utilisateur soumet un faux lien (ex: `http://localhost`, `https://fake.xyz`) via la page `/contribute`, le ticket est actuellement créé en BDD avec `status = "Pending_AI"`, puis le scheduler tente l'extraction Tavily qui échoue → le ticket est marqué `Rejected` avec `parsing_error`. Ce ticket inutile occupe de l'espace.

**Décision :** Au lieu de marquer le ticket comme `Rejected` lors d'une erreur permanente (`TavilyExtractionError` ou `GemmaParsingError`), **supprimer directement le ticket de la BDD**.

### AXE 3 — Correction d'imports cassés dans processor.py

Le fichier `backend/crowdsourcing/processor.py` importe deux modules qui ont été supprimés lors du nettoyage précédent :
- `from backend.tavily_service.strategies import PIPELINE_STRATEGIES` → fichier supprimé
- `import backend.ai.prompts as prompts` → fichier supprimé

Ces imports cassent le crowdsourcing processor. Il faut les corriger en intégrant les constantes nécessaires directement dans le fichier.

---

## 2. AXE 1 — Bouton de Purge des Tickets Traités

### 2.1. Architecture de la solution

```
[Page admin/inbox]
    │
    ├── Bouton "🗑️ Purger les tickets traités"
    │     │
    │     └── Ouvre un Modal de confirmation
    │           │
    │           ├── Dropdown : "Validés", "Rejetés", "Validés + Rejetés"
    │           ├── Compteur dynamique : "X ticket(s) seront supprimés"
    │           │     └── Appel GET /api/admin/inbox?status=Validated (count only)
    │           ├── Bouton "Confirmer la suppression" (style danger)
    │           └── Bouton "Annuler"
    │
    └── Appel DELETE /api/admin/inbox/purge
          │
          └── prisma.contributionInbox.deleteMany({ where: { status: { in: [...] } } })
```

### 2.2. Endpoint API — `DELETE /api/admin/inbox/purge`

**Fichier :** `app/api/admin/inbox/purge/route.ts` (NOUVEAU)

**Spécification :**

```typescript
// DELETE /api/admin/inbox/purge
// Body : { "statuses": ["Validated", "Rejected"] }
// Réponse : { "deleted": 42 }
// Erreurs : 400 si statuts invalides, 401 si non authentifié
```

**Règles de validation :**
1. Protégé par session NextAuth (comme tous les endpoints `/api/admin/*`)
2. Le body doit contenir un tableau `statuses` non vide
3. Seuls les statuts `"Validated"` et `"Rejected"` sont acceptés — rejeter avec `400 Bad Request` si `"Pending_AI"` ou `"Pending_Admin"` sont passés
4. Exécuter `prisma.contributionInbox.deleteMany({ where: { status: { in: statuses } } })`
5. Retourner `{ deleted: result.count }`

**Code attendu :**

```typescript
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const ALLOWED_PURGE_STATUSES = ["Validated", "Rejected"];

export async function DELETE(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session) {
        return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { statuses } = body;

        if (!statuses || !Array.isArray(statuses) || statuses.length === 0) {
            return NextResponse.json(
                { error: "Le champ 'statuses' est requis (tableau non vide)" },
                { status: 400 }
            );
        }

        // Vérifier que tous les statuts sont autorisés
        const invalidStatuses = statuses.filter(
            (s: string) => !ALLOWED_PURGE_STATUSES.includes(s)
        );
        if (invalidStatuses.length > 0) {
            return NextResponse.json(
                { error: `Statuts non autorisés pour la purge : ${invalidStatuses.join(", ")}. Seuls Validated et Rejected sont supprimables.` },
                { status: 400 }
            );
        }

        const result = await prisma.contributionInbox.deleteMany({
            where: { status: { in: statuses } },
        });

        return NextResponse.json({ deleted: result.count });
    } catch (error) {
        console.error("DELETE /api/admin/inbox/purge error:", error);
        return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
    }
}
```

### 2.3. Frontend — Modal de purge dans `app/admin/inbox/page.tsx`

**Modifications à apporter :**

#### A) Nouveaux states React à ajouter (dans le composant `InboxPage`) :

```typescript
const [purgeModalOpen, setPurgeModalOpen] = useState(false);
const [purgeStatuses, setPurgeStatuses] = useState<string[]>(["Validated", "Rejected"]);
const [purgeCount, setPurgeCount] = useState<number | null>(null);
const [purgeLoading, setPurgeLoading] = useState(false);
```

#### B) Fonction pour récupérer le compteur de tickets à purger :

```typescript
const fetchPurgeCount = async (statuses: string[]) => {
    try {
        // Utiliser l'endpoint GET existant pour chaque statut et additionner
        let totalCount = 0;
        for (const status of statuses) {
            const res = await fetch(`/api/admin/inbox?status=${status}&limit=1`);
            if (res.ok) {
                const data = await res.json();
                totalCount += data.pagination.total;
            }
        }
        setPurgeCount(totalCount);
    } catch {
        setPurgeCount(null);
    }
};
```

#### C) Fonction de purge :

```typescript
const handlePurge = async () => {
    setPurgeLoading(true);
    try {
        const res = await fetch("/api/admin/inbox/purge", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ statuses: purgeStatuses }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Erreur lors de la purge");
        setPurgeModalOpen(false);
        fetchTickets(); // Rafraîchir la liste
    } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
        setPurgeLoading(false);
    }
};
```

#### D) Bouton dans le header (à côté du compteur de tickets, ligne ~187-191) :

Ajouter le bouton dans le `<div>` en haut à droite qui contient déjà le compteur :

```tsx
<button
    id="btn-open-purge"
    className="btn btn-danger btn-sm"
    onClick={() => {
        setPurgeModalOpen(true);
        fetchPurgeCount(purgeStatuses);
    }}
>
    🗑️ Purger
</button>
```

#### E) Modal de confirmation (à ajouter juste avant la balise `</div>` de fermeture du composant, avant le `<style>`) :

```tsx
{purgeModalOpen && (
    <div className="panel-overlay" onClick={() => setPurgeModalOpen(false)}>
        <div
            className="purge-modal"
            onClick={(e) => e.stopPropagation()}
        >
            <h3 style={{ margin: "0 0 16px", fontSize: "1.1rem" }}>
                🗑️ Purger les tickets traités
            </h3>

            <div className="form-group" style={{ marginBottom: "16px" }}>
                <label className="form-label">Statuts à supprimer</label>
                <select
                    id="purge-status-filter"
                    className="form-control"
                    value={purgeStatuses.join(",")}
                    onChange={(e) => {
                        const val = e.target.value;
                        const newStatuses = val.split(",");
                        setPurgeStatuses(newStatuses);
                        fetchPurgeCount(newStatuses);
                    }}
                >
                    <option value="Validated,Rejected">Validés + Rejetés</option>
                    <option value="Validated">Validés uniquement</option>
                    <option value="Rejected">Rejetés uniquement</option>
                </select>
            </div>

            {purgeCount !== null && (
                <div style={{
                    padding: "12px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    borderRadius: "var(--radius)",
                    marginBottom: "16px",
                    fontSize: "0.9rem",
                    textAlign: "center",
                }}>
                    ⚠️ <strong>{purgeCount}</strong> ticket{purgeCount !== 1 ? "s" : ""} seront supprimés définitivement
                </div>
            )}

            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                    className="btn btn-secondary"
                    onClick={() => setPurgeModalOpen(false)}
                >
                    Annuler
                </button>
                <button
                    id="btn-confirm-purge"
                    className="btn btn-danger"
                    onClick={handlePurge}
                    disabled={purgeLoading || purgeCount === 0}
                >
                    {purgeLoading ? "Suppression..." : "Confirmer la suppression"}
                </button>
            </div>
        </div>
    </div>
)}
```

#### F) CSS à ajouter dans le bloc `<style>` existant :

```css
.purge-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 28px;
    min-width: 400px;
    max-width: 90vw;
    z-index: 1001;
    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
```

> **Note :** Le modal réutilise l'overlay `.panel-overlay` déjà défini dans la page.

---

## 3. AXE 2 — Suppression Automatique des Contributions Invalides

### 3.1. Problème actuel

Séquence actuelle quand un utilisateur soumet un faux lien :

```
1. POST /api/contribute → ticket créé en BDD (status: "Pending_AI") ✅
2. Scheduler (toutes les 1 min) → process_crowdsourcing_ticket()
3. extract_from_urls() → Tavily échoue ou retourne contenu < 50 chars
4. TavilyExtractionError levée
5. catch (GemmaParsingError, TavilyExtractionError) :
   → _update_ticket_status(conn, ticket_id, "Rejected", {"parsing_error": str(e)})
   → Le ticket RESTE en BDD avec status "Rejected" ← PROBLÈME
```

### 3.2. Solution : Supprimer au lieu de rejeter

Séquence corrigée :

```
1. POST /api/contribute → ticket créé en BDD (status: "Pending_AI") ✅
2. Scheduler → process_crowdsourcing_ticket()
3. extract_from_urls() → Tavily échoue
4. TavilyExtractionError levée
5. catch (GemmaParsingError, TavilyExtractionError) :
   → _delete_ticket(conn, ticket_id)  ← SUPPRESSION DIRECTE
   → Le ticket est SUPPRIMÉ de la BDD
```

### 3.3. Modifications dans `backend/crowdsourcing/processor.py`

**Changement 1 — Ajouter la fonction `_delete_ticket()` :**

À la fin du fichier, après la fonction `_update_ticket_status()` existante (ligne ~277), ajouter :

```python
def _delete_ticket(conn, ticket_id):
    """Supprime un ticket de l'Inbox (erreurs permanentes — URL invalide, parsing échoué)."""
    with conn.cursor() as cur:
        cur.execute('DELETE FROM "ContributionInbox" WHERE id = %s', (ticket_id,))
    conn.commit()
```

**Changement 2 — Remplacer le rejet par une suppression dans `process_crowdsourcing_ticket()` :**

Remplacer le bloc `except (GemmaParsingError, TavilyExtractionError)` (lignes ~203-207) :

```python
# AVANT (actuel) :
except (GemmaParsingError, TavilyExtractionError) as e:
    logger.error(f"❌ [Crowdsourcing] Erreur permanente de parsing/données. Ticket {ticket_id} rejeté. Détails: {e}")
    with get_db_connection() as conn:
        _update_ticket_status(conn, ticket_id, "Rejected", {"parsing_error": str(e)})
    raise

# APRÈS (corrigé) :
except (GemmaParsingError, TavilyExtractionError) as e:
    logger.error(f"❌ [Crowdsourcing] Erreur permanente. Ticket {ticket_id} SUPPRIMÉ de l'Inbox. Détails: {e}")
    with get_db_connection() as conn:
        _delete_ticket(conn, ticket_id)
    raise
```

**Changement 3 — Remplacer aussi le `except Exception` générique (lignes ~208-212) :**

```python
# AVANT (actuel) :
except Exception as e:
    logger.error(f"❌ [Crowdsourcing] Erreur inattendue. Ticket {ticket_id} rejeté. Détails: {e}")
    with get_db_connection() as conn:
        _update_ticket_status(conn, ticket_id, "Rejected", {"error": f"Exception inattendue: {str(e)}"})
    raise

# APRÈS (corrigé) :
except Exception as e:
    logger.error(f"❌ [Crowdsourcing] Erreur inattendue. Ticket {ticket_id} SUPPRIMÉ de l'Inbox. Détails: {e}")
    with get_db_connection() as conn:
        _delete_ticket(conn, ticket_id)
    raise
```

> **Important :** Le `except QuotaExhaustedError: raise` (ligne ~198) et le `except GemmaAPIError` (lignes ~200-202) ne sont PAS modifiés. Ces erreurs sont temporaires et le ticket doit rester en `Pending_AI` pour être retenté.

---

## 4. AXE 3 — Correction des Imports Cassés dans processor.py

### 4.1. Problème

Le fichier `backend/crowdsourcing/processor.py` contient deux imports de modules qui ont été supprimés lors d'un nettoyage précédent :

```python
# Ligne 19 — CASSÉ : le fichier strategies.py a été supprimé
from backend.tavily_service.strategies import PIPELINE_STRATEGIES

# Ligne 21 — CASSÉ : le fichier prompts.py a été supprimé
import backend.ai.prompts as prompts
```

Ces imports provoquent une `ImportError` au démarrage du crowdsourcing processor, ce qui empêche le traitement de TOUTES les soumissions utilisateur.

### 4.2. Analyse de l'utilisation

Le processor utilise ces imports aux endroits suivants :

**`PIPELINE_STRATEGIES` (ligne ~127-130) :**
```python
strategy = PIPELINE_STRATEGIES.get(category)
system_prompt = getattr(prompts, f"{category.upper()}_SYSTEM_PROMPT", "")
req_keys = strategy["required_json_keys"] if strategy else prompts.PHASE1_REQUIRED_KEYS
gemma_model = strategy["gemma_model"] if strategy else "models/gemma-4-31b-it"
```

Ce bloc sert à obtenir :
1. Le `system_prompt` spécifique à la catégorie (Pricing, Ranking, etc.)
2. Les clés JSON requises pour validation de la réponse Gemma
3. Le modèle Gemma à utiliser

**`prompts.CROWDSOURCING_COMPATIBILITY_CHECK` (ligne ~103) :**
```python
compatibility_prompt = prompts.CROWDSOURCING_COMPATIBILITY_CHECK.format(
    categories=category,
    school_name=school_name,
    page_content=raw_content[:80000]
)
```

### 4.3. Solution : Intégrer les constantes directement dans processor.py

**Changement 1 — Supprimer les imports cassés (lignes 19 et 21) :**

```diff
-from backend.tavily_service.strategies import PIPELINE_STRATEGIES
 from backend.tavily_service.key_manager import QuotaExhaustedError
-import backend.ai.prompts as prompts
```

**Changement 2 — Ajouter les constantes nécessaires en haut du fichier (après les imports, avant `SUPPORTED_CROWDSOURCING_CATEGORIES`) :**

> **Important :** L'agent doit d'abord vérifier si les fichiers `backend/tavily_service/strategies.py` et `backend/ai/prompts.py` existent encore. Si oui, ne pas faire cet AXE 3. S'ils ont été supprimés (ce qui est le cas au moment de la rédaction de ce plan), alors intégrer les constantes comme suit.

L'agent doit retrouver le contenu des constantes `PIPELINE_STRATEGIES`, `CROWDSOURCING_COMPATIBILITY_CHECK`, et les system prompts par catégorie. Pour cela :

1. Chercher dans l'historique git : `git log --all --oneline -- backend/ai/prompts.py` puis `git show <commit>:backend/ai/prompts.py`
2. Chercher dans l'historique git : `git log --all --oneline -- backend/tavily_service/strategies.py` puis `git show <commit>:backend/tavily_service/strategies.py`
3. Intégrer les constantes suivantes directement dans `processor.py` :
   - `CROWDSOURCING_COMPATIBILITY_CHECK` — le prompt de vérification de compatibilité
   - `PIPELINE_STRATEGIES` — le dictionnaire de stratégies par catégorie (ou sa version simplifiée)
   - Les system prompts par catégorie (`PRICING_SYSTEM_PROMPT`, `RANKING_SYSTEM_PROMPT`, etc.)

**Alternative simplifiée :** Si l'agent ne peut pas retrouver les constantes, il doit :
1. Réécrire le `CROWDSOURCING_COMPATIBILITY_CHECK` basé sur sa description dans `architecture.md` §6.2 étape 3
2. Réécrire les `PIPELINE_STRATEGIES` basé sur les catégories supportées (`Pricing`, `Ranking`, `Capacity`, `SchoolStats`, `Accreditation`) avec les clés JSON requises décrites dans `bdd.md`
3. Réécrire les system prompts par catégorie en suivant les principes de `gemma-python-guide.md`

---

## 5. Fichiers à Créer

| Fichier | Description |
|---|---|
| `app/api/admin/inbox/purge/route.ts` | Endpoint DELETE pour la purge des tickets traités |

---

## 6. Fichiers à Modifier

### 6.1. `app/admin/inbox/page.tsx`

| Modification | Lignes approximatives | Description |
|---|---|---|
| Nouveaux states React | Après ligne ~93 | `purgeModalOpen`, `purgeStatuses`, `purgeCount`, `purgeLoading` |
| Fonction `fetchPurgeCount()` | Après `handleReject()` (~173) | Compte les tickets par statut avant purge |
| Fonction `handlePurge()` | Après `fetchPurgeCount()` | Appelle DELETE /api/admin/inbox/purge |
| Bouton "🗑️ Purger" | Dans le header, ligne ~187-191 | Bouton qui ouvre le modal |
| Modal de confirmation | Avant le `<style>`, ligne ~486 | Modal avec dropdown + compteur + boutons |
| CSS `.purge-modal` | Dans le bloc `<style>`, ligne ~487 | Style du modal centré |

### 6.2. `backend/crowdsourcing/processor.py`

| Modification | Lignes | Description |
|---|---|---|
| Supprimer import `PIPELINE_STRATEGIES` | Ligne 19 | Import cassé (fichier supprimé) |
| Supprimer import `prompts` | Ligne 21 | Import cassé (fichier supprimé) |
| Ajouter constantes | Après les imports | `CROWDSOURCING_COMPATIBILITY_CHECK`, `PIPELINE_STRATEGIES`, system prompts |
| Remplacer `_update_ticket_status` par `_delete_ticket` | Lignes 203-212 | Supprimer les tickets au lieu de les rejeter |
| Ajouter fonction `_delete_ticket()` | Après `_update_ticket_status()` (ligne ~283) | Nouvelle fonction de suppression |

---

## 7. Plan de Vérification

### 7.1. Vérifications structurelles

```bash
# Le nouveau fichier API doit exister
ls app/api/admin/inbox/purge/route.ts  # Doit exister

# Aucun import cassé dans processor.py
python -c "import py_compile; py_compile.compile('backend/crowdsourcing/processor.py')"
# → Doit compiler sans erreur
```

### 7.2. Vérifications de compilation

```bash
# TypeScript (Next.js)
npx tsc --noEmit
# → Doit compiler sans erreur

# Backend FastAPI
python -m uvicorn backend.main:app --port 8000 --reload
# → Doit démarrer sans erreur d'import
```

### 7.3. Vérifications fonctionnelles — Purge

```
1. Aller sur http://localhost:3000/admin/inbox
2. Vérifier que le bouton "🗑️ Purger" apparaît dans le header
3. Cliquer sur le bouton → le modal s'ouvre
4. Vérifier que le dropdown propose 3 options (Validés+Rejetés, Validés, Rejetés)
5. Vérifier que le compteur affiche le nombre correct
6. Changer le filtre → le compteur se met à jour
7. Cliquer "Confirmer la suppression" → les tickets sont supprimés
8. Vérifier que la liste se rafraîchit automatiquement
9. Vérifier que les tickets Pending_AI et Pending_Admin ne sont PAS touchés
```

### 7.4. Vérifications fonctionnelles — Fix contributions

```
1. Aller sur http://localhost:3000/contribute
2. Soumettre une contribution avec un faux lien (ex: https://localhost:3000 ou https://fake-test-xyz.com)
3. Attendre ~1 minute (le scheduler traite les tickets toutes les minutes)
4. Aller sur http://localhost:3000/admin/inbox et filtrer par "Pending_AI"
5. Le ticket doit avoir DISPARU de l'inbox (supprimé, pas rejeté)
6. Vérifier dans les logs backend : le message doit contenir "SUPPRIMÉ de l'Inbox"
```

### 7.5. Vérifications de non-régression

```
1. Soumettre une contribution avec un VRAI lien (ex: https://www.emlv.fr/formations/)
2. Attendre le traitement par le scheduler
3. Le ticket doit passer en "Pending_Admin" (pas supprimé)
4. Vérifier que les erreurs API temporaires (GemmaAPIError) conservent le ticket en "Pending_AI"
5. Vérifier que les erreurs de quota (QuotaExhaustedError) arrêtent le traitement sans supprimer
```

---

## 8. Ordre d'Exécution Recommandé

### Phase A — Correction des imports cassés (AXE 3)

> Faire cela EN PREMIER car le processor est actuellement cassé.

1. Retrouver le contenu des fichiers supprimés via `git log` + `git show`
2. Modifier `backend/crowdsourcing/processor.py` :
   - Supprimer les imports cassés (lignes 19 et 21)
   - Intégrer les constantes nécessaires
3. Vérifier la compilation Python

### Phase B — Fix contributions invalides (AXE 2)

4. Modifier `backend/crowdsourcing/processor.py` :
   - Ajouter la fonction `_delete_ticket()`
   - Remplacer les appels `_update_ticket_status(..., "Rejected", ...)` par `_delete_ticket(...)` dans les blocs `except`
5. Vérifier la compilation Python
6. Tester avec un faux lien

### Phase C — Bouton de purge (AXE 1)

7. Créer `app/api/admin/inbox/purge/route.ts`
8. Vérifier la compilation TypeScript
9. Modifier `app/admin/inbox/page.tsx` :
   - Ajouter les states, fonctions, bouton et modal
   - Ajouter le CSS du modal
10. Vérifier la compilation TypeScript
11. Tester le bouton de purge

### Phase D — Vérification finale

12. Exécuter les vérifications structurelles (section 7.1)
13. Exécuter les vérifications de compilation (section 7.2)
14. Exécuter les vérifications fonctionnelles (sections 7.3, 7.4, 7.5)

---

> **Ce document est la source de vérité pour cette implémentation.**
> **L'agent doit lire `architecture.md`, `bdd.md` et `edgecase.md` avant de commencer.**
