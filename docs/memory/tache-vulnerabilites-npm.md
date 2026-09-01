# Tâche — Traiter les 16 vulnérabilités npm et rendre la CI verte

> **Rédigé le** : 1er septembre 2026
> **Destinataire** : agent vierge, sans le contexte de la session précédente.
> **Branche** : `devresearch` · **Repo** : https://github.com/Anton1P/veille-concurenciel
> **Statut** : à faire. Rien n'a été tenté.
>
> Ce document absorbe une tâche antérieure de vérification de la CI : les deux
> sujets n'en font qu'un, puisque la CI ne peut pas passer au vert tant que la
> vulnérabilité critique n'est pas traitée.

---

## 1. Pourquoi cette tâche existe

Un audit technique complet a été mené sur ce projet, puis ses six étapes de
remédiation ont été appliquées. **Les vulnérabilités de dépendances n'en
faisaient pas partie** : l'audit indiquait explicitement ne pas les avoir
vérifiées, faute de pouvoir exécuter `npm audit` contre les bases CVE.

Elles ont été relevées au passage, sans être corrigées, parce que toucher à 477
paquets débordait du périmètre des six étapes. C'est l'objet de cette tâche.

**Deux raisons de la traiter en priorité :**

1. **Une vulnérabilité critique sur `next-auth`** — c'est le module qui porte
   toute l'authentification du back-office.
2. **Une vulnérabilité haute sur `next` décrite comme un « Middleware / Proxy
   bypass in App Router applications »**. Or toute la protection de session et
   toute la limitation de débit du projet vivent dans le middleware
   (`proxy.ts`). Si ce contournement est exploitable ici, il annule les gardes
   posés à l'étape 1 de la remédiation.

---

## 2. État des lieux au 1er septembre 2026

`npm audit` → **16 vulnérabilités : 1 critique, 10 hautes, 4 modérées, 1 basse.**

| Sévérité | Paquet | Type | Correctif annoncé |
|----------|--------|------|-------------------|
| **CRITIQUE** | `next-auth` | directe | `npm audit fix` |
| HAUTE | `next` | directe | `npm audit fix` |
| HAUTE | `prisma` | directe | `npm audit fix` |
| HAUTE | `ws` | directe | `npm audit fix` |
| HAUTE | `@prisma/config` | transitive | `npm audit fix` |
| HAUTE | `deepmerge-ts` | transitive | `npm audit fix` |
| HAUTE | `fast-uri` | transitive | `npm audit fix` |
| HAUTE | `hono` | transitive | `npm audit fix` |
| HAUTE | `nanoid` | transitive | `npm audit fix` |
| HAUTE | `postcss` | transitive | `npm audit fix` |
| HAUTE | `sharp` | transitive | `npm audit fix` |
| MODÉRÉE | `@hono/node-server`, `@prisma/dev`, `uuid`, `valibot` | transitives | `npm audit fix` |
| BASSE | `esbuild` | transitive | `npm audit fix` |

**Point important, vérifié** : `npm audit fix --dry-run` ne signale **aucun**
paquet nécessitant une montée de version majeure. `npm audit fix` **sans
`--force`** prétend tout traiter. Ne pas utiliser `--force` sans une raison
explicite : c'est lui qui casse les contrats de version.

> Une note antérieure affirmait que ces correctifs imposaient des montées
> majeures. **C'est faux**, et cette correction est la raison d'être du présent
> document.

### Détail des trois plus sérieuses

| Paquet | Contenu de l'avis |
|--------|-------------------|
| `next-auth` | normaliseur d'e-mail validant l'adresse **avant** normalisation Unicode → contournement par homoglyphe `@` ; `getToken()` lève une exception non rattrapée sur un en-tête `Bearer` malformé ; cookies `state` / `nonce` / PKCE non liés au provider qui les a émis |
| `next` | **bypass de middleware / proxy en App Router** (Turbopack, locale unique) ; DoS via Server Actions ; SSRF dans les rewrites ; divulgation d'endpoints internes de Server Functions ; confusion de cache sur les réponses à corps |
| `ws` | épuisement mémoire (DoS) par fragments et morceaux de données minuscules |

Versions actuellement installées : `next@16.2.6`, `next-auth@4.24.14`,
`ws@8.20.1`, `prisma@7.8.0`.

---

## 3. Ce que tu dois faire

### Étape 1 — Point de départ propre

```bash
git status              # doit être propre, ou committer avant de commencer
git checkout -b fix/npm-audit
```

**Ne pas travailler directement sur `devresearch`.** Une montée de dépendances
doit pouvoir être abandonnée d'un `git checkout`.

### Étape 2 — Relever l'état exact

```bash
npm audit
npm audit fix --dry-run
npm ls next next-auth ws prisma
```

Les chiffres ci-dessus datent du 1er septembre 2026 ; ils auront bougé.

### Étape 3 — Appliquer

```bash
npm audit fix          # SANS --force
npm audit              # que reste-t-il ?
git diff package.json package-lock.json
```

Si des vulnérabilités subsistent, ne pas enchaîner sur `--force` par réflexe :
identifier le paquet, lire l'avis, et juger si la montée majeure est
acceptable. Les paquets **directs** (`next`, `next-auth`, `prisma`, `ws`) sont
ceux qui méritent une attention particulière.

### Étape 4 — Vérifier que rien n'est cassé

Dans cet ordre, tout doit passer :

```bash
npm run typecheck                 # tsc --noEmit
npm run lint                      # 0 erreur ; les avertissements sont une dette connue
npx prisma generate
npx prisma validate
npm run build                     # prisma generate && next build
```

Puis les tests Python (le venv doit être actif) :

```bash
python -m pytest -q               # 11 tests attendus
```

### Étape 5 — Vérifier à l'exécution, pas seulement à la compilation

C'est l'étape que l'on saute et qu'on regrette. `next-auth` et `next` portent
l'authentification et le middleware : une montée de version peut passer `tsc`
et casser la connexion.

Démarrer le serveur (`npm run dev`) puis contrôler :

| # | Contrôle | Attendu |
|---|----------|---------|
| 1 | `GET /admin/inbox` sans session | redirection **307** vers `/admin/login` |
| 2 | Connexion réelle sur `/admin/login` avec un compte valide | la session s'ouvre, `/admin` est accessible |
| 3 | 6 × `POST /api/auth/callback/credentials` d'affilée | les 5 premiers passent, le **6ᵉ renvoie 429** |
| 4 | `PATCH /api/admin/users/<id>/password` sans session | **401** |
| 5 | `curl -I http://localhost:3000/admin/login` | les 6 en-têtes de sécurité présents (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Strict-Transport-Security) |
| 6 | ~65 appels rapides sur `/api/v1/schools?limit=1` | **429** au-delà de 60 par minute |
| 7 | Console du navigateur sur `/admin` | aucune violation `Content-Security-Policy` |

**Le contrôle n°3 est le plus important** : il vérifie que la limitation de débit
traverse toujours le middleware. Voir §4 pour ce qu'il faut savoir avant de le
lancer.

### Étape 6 — Committer et pousser

```bash
git add package.json package-lock.json
git commit -m "fix(deps): resoudre les 16 vulnerabilites npm (dont 1 critique next-auth)"
git push -u origin fix/npm-audit
```

### Étape 7 — Vérifier la CI sur GitHub

C'est la partie qu'aucun agent local n'a pu faire jusqu'ici : `gh` n'est pas
installé sur la machine de l'opérateur et aucun accès réseau vers GitHub n'est
disponible depuis l'environnement d'exécution.

Le workflow `.github/workflows/ci.yml` comporte **deux jobs** :

| Job | Étapes |
|-----|--------|
| `validate` | tsc · ESLint · prisma generate · prisma validate · prisma migrate status · garde-fou « pas de `prisma db push` » · `npm audit --audit-level=critical` |
| `python-tests` | setup Python 3.12 · `pip install -r backend/requirements-dev.txt` · `python -m pytest -q` |

**L'étape `npm audit --audit-level=critical` sort actuellement en 1** et fait
échouer la CI. C'est le seul obstacle connu : toutes les autres étapes passent
en local. Une fois la critique traitée, la CI devrait être verte — à confirmer
sur GitHub, ce qui n'a jamais pu être fait.

---

## 4. Pièges à connaître avant de toucher au code

### `withAuth` de next-auth court-circuite `/api/auth/*`

`node_modules/next-auth/next/middleware.js`, fonction `handleMiddleware` :

```js
const authPath = parseUrl(process.env.NEXTAUTH_URL).path;   // → "/api/auth"
if (`${basePath}${pathname}`.startsWith(authPath) || ...) {
  return;      // sort AVANT d'appeler le middleware interne
}
```

Conséquence : **toute logique placée dans le callback interne de `withAuth` ne
s'exécute jamais pour un chemin commençant par `/api/auth`.** C'est pourquoi
`proxy.ts` applique la limitation de débit **en amont** et ne délègue à
`withAuth` que les chemins ayant besoin d'une session.

**Si la montée de `next-auth` modifie ce comportement, `proxy.ts` doit être
relu.** Le contrôle n°3 de l'étape 5 est là pour le détecter.

### La limitation de débit retombe en mémoire

`lib/rate-limit.ts` utilise Upstash Redis si `UPSTASH_REDIS_REST_URL` et
`UPSTASH_REDIS_REST_TOKEN` sont définies, un compteur mémoire sinon. En
développement local, c'est le repli mémoire qui s'applique — les contrôles
n°3 et n°6 fonctionnent quand même, sur une seule instance.

### Ne pas toucher au déploiement

Le projet n'est **pas** déployé sur Vercel à ce jour. Voir
[`memory-deploiement-vercel.md`](memory-deploiement-vercel.md). Rien dans cette
tâche ne doit configurer un déploiement.

### Ne pas utiliser `prisma db push`

C'est son usage qui avait désynchronisé le schéma de ses migrations au point de
rendre la base non reconstructible. Un garde-fou de CI le vérifie. Utiliser
`prisma migrate deploy` ou `prisma migrate resolve --applied`.

---

## 5. En cas de casse

```bash
git checkout package.json package-lock.json
npm ci
```

Si `npm audit fix` a introduit une régression que tu n'arrives pas à isoler,
**ne pas s'acharner** : traiter d'abord `next-auth` seul, puisque c'est la
critique et l'obstacle à la CI.

```bash
npm install next-auth@latest
npm run typecheck && npm run build && python -m pytest -q
```

Puis reprendre les autres paquets par lots.

---

## 6. À faire en fin de tâche

Remplacer les sections 2 et 3 de ce fichier par un compte-rendu :

- date, versions avant/après pour `next`, `next-auth`, `ws`, `prisma` ;
- vulnérabilités restantes le cas échéant, et pourquoi elles n'ont pas été
  traitées ;
- résultat des sept contrôles de l'étape 5 ;
- SHA du premier run CI vert.

**Si tout est traité et la CI verte, ce fichier peut être supprimé** — c'est une
tâche, pas une documentation d'architecture.
