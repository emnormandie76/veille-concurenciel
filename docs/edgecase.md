# Cas limites et parades

Les scénarios extrêmes du site et leurs parades : l'inbox, le back-office,
l'API v1, le signalement. Les numéros sont ceux de la liste d'origine, qui
compte aussi les cas de l'IA ; ceux-là, dont le code vit sur la branche
`local`, sont dans le `docs/edgecase.md` de cette branche. Les décisions citées
(G4, D13…) sont celles du plan
[`features/gestion-contenu.md`](features/gestion-contenu.md).

## L'inbox

### Edge Case 17 : Timeout de la transaction de validation
- **Contexte :** Validation d'une découverte volumineuse (ex. EDHEC : 9 campus, 30+ programmes).
- **Solution actuelle :** transaction de 60 s, et upserts **sérialisés** : `tx` ne dispose que d'une connexion, un `Promise.all` n'y gagne aucun parallélisme et dépasse le délai sous charge.

### Edge Case 19 : Accumulation des tickets traités (quota Neon 500 MB)
- **Solution actuelle :** bouton « Purger » de l'inbox (`DELETE /api/admin/inbox/purge`, ADMIN), qui supprime les tickets `Validated` et/ou `Rejected` après confirmation dans un dialogue. Les jobs `PipelineJob` terminés, eux, sont purgés au démarrage du backend (branche `local`), au-delà de 7 jours.

### Edge Case 37 : Des corrections illisibles prises pour « pas de corrections »
- **Contexte :** Validation d'un ticket (`validate`, `attachments`) : l'admin peut envoyer ses corrections dans le corps.
- **Problème :** un corps lu dans un `catch {}` muet ferait passer un JSON mal formé pour « pas de corps », et la route écrirait le JSON brut de l'IA à la place des corrections, avec un 200.
- **Solution actuelle :** `readOptionalJsonObject` (`lib/request-body.ts`) : corps absent ou `{}` → le ticket tel quel ; JSON mal formé, ou valeur qui n'est pas un objet → 400, rien d'écrit, avant toute lecture en base.

### Edge Case 41 : Des sources invérifiables
- **Contexte :** Bloc « Sources » d'un ticket du pipeline (`Automated_AI`) dans l'inbox : la colonne `urls`.
- **Problème :** elle portait toutes les pages lues par Tavily Research (jusqu'à 28 liens), sans dire laquelle prouvait la donnée : trop de liens pour être vérifiés.
- **Solution actuelle (décisions du propriétaire du 15 octobre 2026) :** trois liens au plus, sans doublon (un `www.` de tête ne distingue pas deux URL) : les URL citées par les données extraites, puis le domaine officiel de l'école, puis l'ordre de Tavily ; en Phase 1, la première page catalogue tient la première place. Le backend de `local` coupe à l'écriture ; l'inbox plafonne à l'écran les tickets écrits avant (`lib/ticket-sources.ts`). Les contributions ne sont pas touchées.
- **Risque accepté :** une donnée peut ne plus être vérifiable depuis le bloc « Sources » quand sa page n'est pas parmi les trois. Restent pour l'admin : le lien par ligne (`source_url` d'un tarif, d'un classement, d'une accréditation, d'une ligne de rattachement, d'une voie de capacité), le rapport Research joint au ticket (`raw_report`, en base, aucun écran ne l'affiche) et, pour un ticket écrit avant la coupe, la colonne `urls` entière. Une URL citée qui n'est pas une adresse `http(s)` (« Le Figaro Étudiant ») est écartée.

## Le back-office et l'API v1

### Edge Case 36 : Une faute de frappe qui efface une valeur
- **Contexte :** Formulaires admin des tarifs, des statistiques et des durées d'un programme.
- **Problème :** `parseInt("abc")` rend `NaN`, que Prisma écrit en `NULL` (`SET "total_fee" = $1` avec `null`) : une faute de frappe effacerait la valeur existante, avec un 200.
- **Solution actuelle :** `readOptionalNumbers` (`lib/request-body.ts`) : une valeur fournie mais illisible donne 400 en nommant le champ, avant toute écriture ; vide ou absente, elle vaut `null`.

### Edge Case 38 : Une relation disparue derrière un filtre `any`
- **Contexte :** `GET /api/v1/schools/[id]/pricing` et `GET /api/v1/rankings`.
- **Problème :** un filtre par `program.campus`, relation disparue quand un programme a cessé d'appartenir à un campus, fait refuser chaque requête par Prisma ; `tsc` ne le voit pas, le filtre étant typé `any`. De même, `?page=abc` donnerait `NaN` dans la pagination, et un 500.
- **Solution actuelle :** filtre par l'école du programme, campus exposés en liste ; une pagination illisible reprend sa valeur par défaut. Les tests relisent chaque requête du faux Prisma contre le schéma réel (`test/helpers/prisma-schema.ts`, piège 8).

## Le signalement

### Edge Case 42 : L'abus du formulaire de signalement
- **Contexte :** « Signaler une information » est ouvert à toute session, `USER` compris (G4) : un formulaire sur chaque fiche école et programme (`/schools/[id]/report`), qui écrit par `POST /api/admin/reports` dans la table `ContentReport`. Les gestionnaires les lisent sur `/admin/reports`.
- **Problème :** un compte (ou un script avec sa session) envoie des centaines de signalements : la vue des gestionnaires est noyée et la base grossit. Autres abus : un texte piégé (balises, lien `javascript:`, « instructions » destinées à une IA), un signalement qui vise le campus d'une autre école, un corps de requête qui se donne un autre auteur, un état déjà « traité » ou un faux nom de cible.
- **Solution actuelle :**
  - **plafond par compte** (D35) : 10 envois par heure, par `lib/rate-limit.ts` (Upstash en ligne), compté une fois le corps lu et avant toute lecture en base ; au-delà, 429 avec `Retry-After`. Par compte et non par adresse IP : l'équipe sort par la même IP de l'école, un plafond par IP bloquerait tout le monde après un seul abus ;
  - **seuls les collègues inscrits** ont une session (liste blanche, G5) ; l'auteur est le compte de la session, jamais une valeur du corps ; l'état, le traitant et le nom de la cible ne se lisent pas dans le corps (le nom est lu en base) ; un campus ou un programme doit appartenir à l'école, une école doit être active ;
  - **bornes**, dans le code et en base (contraintes `CHECK`) : message de 10 à 2 000 caractères, comptés comme Postgres (un émoji vaut un caractère) ; réponse du gestionnaire de 1 000 au plus ; neuf catégories (D52) ; lien facultatif selon la règle D27 (`http(s)`, 2 048 caractères, D34) ;
  - **aucune IA, aucun appel réseau** (D13, piège 6) : le texte ne va à aucun modèle, aucun serveur n'ouvre le lien, rien n'entre dans `ContributionInbox` ; le texte est rendu par React (échappé) et le lien n'est cliquable qu'en `http(s)` (`sourceHref`), en nouvel onglet (`noopener noreferrer`) ;
  - la vue montre tous les signalements en attente, les plus anciens d'abord, et les 100 derniers fermés.
- **Reste connu :** 10 par heure, c'est jusqu'à 240 par jour et par compte ; aucun plafond sur le nombre de signalements en attente ; pas de rejet groupé. Un compte abusif se désactive (D21) ; ses signalements restent (clé `RESTRICT`, D38) et se rejettent un à un. Sans Upstash (sur le poste), le plafond est propre à chaque processus.
