# Décision — Rétention des tickets de contribution en échec

> **Date** : 1er septembre 2026
> **Statut** : tranché par l'opérateur, implémenté et vérifié.
> **Ferme** : la question du triage des erreurs de traitement, laissée ouverte
> pendant la remédiation de l'audit.
> Contexte : [`architecture.md`](../architecture/architecture.md) §3.4 et §6.2.

---

## 1. La question

L'audit avait relevé (constat majeur M-4) qu'un `except Exception` terminal
appelait `_delete_ticket()` : **toute** erreur inattendue détruisait
définitivement la contribution, y compris une simple coupure réseau au réveil
d'une base serverless.

L'étape 3 a remplacé cette suppression par un statut `Failed` avec compteur de
tentatives. Restait à décider quoi faire des tickets qui échouent *encore et
encore* : les garder pour arbitrage humain, ou les supprimer.

Trois tests du dépôt documentaient par ailleurs une intention d'origine
divergente — passer les tickets en `Rejected` plutôt que les supprimer.

## 2. La décision de l'opérateur

> « Je n'ai pas envie de les garder si c'est toujours la même erreur, qu'elle
> arrive très régulièrement, et qu'elle n'est pas utile pour l'utilisateur
> admin / modérateur. »

Le critère est net : **un ticket n'a de valeur que si quelqu'un peut en faire
quelque chose.** Un échec répétitif et non actionnable encombre la file sans
rien apporter.

## 3. La politique retenue

Trois cas, désormais distincts :

| Nature de l'erreur | Traitement | Justification |
|--------------------|------------|---------------|
| **Erreur API temporaire** (`GemmaAPIError` — réseau, Google indisponible) | ticket **conservé en `Pending_AI`**, rejoué au passage suivant | inchangé ; c'est déjà le bon comportement |
| **Erreur permanente avérée** (`GemmaParsingError`, `TavilyExtractionError`) | **suppression immédiate** | la page ne sera jamais exploitable ; l'admin ne peut rien en faire |
| **Erreur inattendue** (coupure Neon, timeout, bug interne) | `Failed` + compteur, **rejoué après délai**, puis **supprimé au bout de N tentatives** | la contribution est probablement valide : on lui laisse sa chance. Si elle échoue toujours, elle devient un échec non actionnable et rejoint le cas précédent |

C'est le point d'équilibre entre « ne rien détruire » — qui laissait des tickets
morts s'accumuler — et « supprimer tout de suite » — qui détruisait des
contributions valides sur un incident passager.

## 4. Implémentation

### 4.1 Deux réglages

`backend/crowdsourcing/processor.py`, en tête de module :

```python
MAX_PROCESSING_ATTEMPTS = int(os.environ.get("CROWDSOURCING_MAX_ATTEMPTS", 3))

FAILED_RETRY_DELAY_SECONDS = int(
    os.environ.get("CROWDSOURCING_RETRY_DELAY_MINUTES", 60)
) * 60
```

**Le délai n'est pas un détail.** Le job crowdsourcing tourne **toutes les
minutes** : sans lui, une panne passagère de la base consommerait les trois
tentatives en trois minutes et supprimerait un ticket parfaitement valide. Une
heure d'attente laisse le temps à un incident d'infrastructure de se résoudre.

**Coût à garder en tête** : chaque nouvelle tentative relance une extraction
Tavily facturée. Trois tentatives = jusqu'à trois fois le coût d'un ticket. Le
commentaire du code le rappelle. Baisser `CROWDSOURCING_MAX_ATTEMPTS` à 2 est un
arbitrage légitime si le budget serre.

### 4.2 La file d'attente reprend les tickets rejouables

Avant, la requête ne lisait que `status = 'Pending_AI'` : **un ticket `Failed`
n'était jamais relu**, et le compteur de tentatives ne pouvait donc jamais
dépasser 1. Le mécanisme posé à l'étape 3 était en réalité inerte.

```sql
WHERE ti.source_type = 'User_Submission'
  AND (
        ti.status = 'Pending_AI'
        OR (
            ti.status = 'Failed'
            AND COALESCE((ti.ai_extracted_json->>'processing_attempts')::int, 0) < %s
            AND COALESCE((ti.ai_extracted_json->>'failed_at_epoch')::double precision, 0)
                < EXTRACT(EPOCH FROM now()) - %s
        )
      )
ORDER BY ti."createdAt" ASC
LIMIT 20
```

Le `COALESCE` sur `failed_at_epoch` traite le cas des tickets `Failed` écrits
avant ce changement, qui n'ont pas le champ : ils sont rejoués une fois, ce qui
est le comportement souhaitable.

### 4.3 Pourquoi un `failed_at_epoch` en plus de `failed_at`

`_mark_ticket_failed()` écrit désormais les deux :

```python
"failed_at": now.isoformat(),        # lisible par un humain, pour le back-office
"failed_at_epoch": now.timestamp(),  # comparé en SQL par la requête ci-dessus
```

Comparer la chaîne ISO en SQL aurait imposé un `::timestamptz` sur une valeur
issue d'un JSON — un cast qui **lève une erreur** si la valeur est malformée, et
ferait tomber toute la boucle de traitement. Un nombre est comparé sans risque.

### 4.4 La suppression au plafond

```python
next_attempt = attempts + 1

if next_attempt >= MAX_PROCESSING_ATTEMPTS:
    logger.error(
        f"🗑️ Ticket {ticket_id} supprime apres {next_attempt} tentatives "
        f"infructueuses. Derniere erreur: {message[:200]}"
    )
    cur.execute('DELETE FROM "ContributionInbox" WHERE id = %s', (ticket_id,))
    return
```

La suppression est **journalisée en `ERROR` avec la dernière erreur** : si un
motif se répète, il apparaît dans les logs et devient un signal de bug, pas une
disparition silencieuse. C'était précisément le reproche de l'audit à l'ancienne
version — supprimer sans laisser de trace exploitable.

### 4.5 Un index, parce que la requête s'est alourdie

La nouvelle requête filtre sur `status` et trie sur `createdAt`, toutes les
minutes. **Aucun index ne couvrait ces colonnes** — seul `submission_group_id`
en avait un, un constat de cohérence de l'audit resté ouvert.

- `prisma/schema.prisma` : `@@index([status, createdAt])` sur `ContributionInbox`
- Migration `20260901160000_inbox_status_index` créée

## 5. Vérifications

| Vérification | Résultat |
|--------------|----------|
| `py_compile` sur `processor.py` | OK |
| Suite de tests | **11 passés** (3 nouveaux, voir ci-dessous) |
| Les 5 migrations sur une base vierge | appliquées ; diff avec le schéma **vide** |
| La requête de file contre PostgreSQL réel | conforme, détail ci-dessous |
| `npm run build` (production) | OK |

### Test de la requête sur six tickets réels

| Ticket | État | Sélectionné ? |
|--------|------|---------------|
| `a-pending` | `Pending_AI` | ✅ oui |
| `b-failed-recent` | `Failed`, 1 tentative, échec il y a quelques secondes | ❌ non — délai non écoulé |
| `c-failed-old` | `Failed`, 1 tentative, échec ancien | ✅ oui — rejouable |
| `d-failed-maxed` | `Failed`, 3 tentatives | ❌ non — plafond atteint |
| `e-failed-legacy` | `Failed`, ancien format sans `failed_at_epoch` | ✅ oui — le `COALESCE` fait son office, **aucune erreur de cast** |
| `f-validated` | `Validated` | ❌ non |

### Trois tests ajoutés

- `test_failed_ticket_is_kept_below_the_attempt_cap` — sous le plafond : `UPDATE`,
  pas de `DELETE`, compteur incrémenté, les deux horodatages écrits.
- `test_failed_ticket_is_deleted_at_the_attempt_cap` — au plafond : `DELETE`,
  pas d'`UPDATE`.
- `test_missing_ticket_does_not_crash` — ticket disparu entre-temps : ni l'un ni
  l'autre, aucune exception.

## 6. Conséquence sur les tests hérités

Trois tests de `test_crowdsourcing_processor.py` attendaient un passage en
`Rejected` là où le code supprime le ticket. Ils **sont désormais conformes à la
décision** : ils assertent `_delete_ticket`, et c'est bien le comportement voulu.
La divergence est close, elle n'est plus « à arbitrer ».

*(Ces tests étaient restés en l'état parce que rien ne lançait la suite — voir
[`architecture.md`](../architecture/architecture.md) §10 bis, « Tests ».)*

## 7. Nouvelles variables d'environnement

À ajouter au `.env.example` du backend :

| Variable | Défaut | Effet |
|----------|--------|-------|
| `CROWDSOURCING_MAX_ATTEMPTS` | `3` | tentatives avant suppression définitive |
| `CROWDSOURCING_RETRY_DELAY_MINUTES` | `60` | délai avant qu'un `Failed` redevienne éligible |

## 8. Ce qu'il reste à surveiller

1. **Aucun écran du back-office n'affiche les tickets `Failed`.** Ils existent en
   base entre deux tentatives, mais l'interface d'inbox ne les distingue pas.
   Tant que ce n'est pas fait, la fenêtre d'arbitrage humain reste théorique —
   la politique fonctionne, mais personne ne la voit fonctionner.
2. **Surveiller les logs `🗑️ Ticket … supprime apres N tentatives`** après mise
   en service. Si un même message d'erreur revient souvent, ce n'est plus une
   contribution invalide : c'est un bug à corriger.
