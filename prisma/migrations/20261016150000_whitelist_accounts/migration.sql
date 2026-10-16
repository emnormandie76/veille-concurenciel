-- Liste blanche, premiere connexion (plan gestion-contenu, etape 2).
--
-- Decision G5 du 16 octobre 2026 : l'admin ajoute l'adresse de travail d'un
-- collegue, sans envoi d'e-mail ; a sa premiere connexion, la personne choisit
-- son mot de passe. Decisions du meme jour :
--   * D3  les comptes existants gardent leur identifiant (username) tant
--         qu'ils n'ont pas d'adresse : la colonne devient facultative, un
--         compte cree ensuite n'en a pas ;
--   * D4  "remettre en premiere connexion" efface le mot de passe : il devient
--         facultatif, et "session_version" coupe les sessions ouvertes (D20) ;
--   * D5  le domaine est impose par le code (lib/accounts.ts), pas ici ;
--   * D6  le nom affiche ("display_name") ;
--   * D21 trois etats : INVITED (sur la liste, pas de mot de passe), ACTIVE,
--         DISABLED (le compte reste, pour l'historique des modifications).
--
-- Additive : rien n'est supprime ni renomme. Les comptes existants (releve du
-- 16 octobre 2026 : 2 sur dev, 2 sur main, tous avec identifiant et mot de
-- passe) deviennent ACTIVE ; tout compte cree ensuite est INVITED par defaut.
-- Les contraintes sont donc tenues par les lignes existantes : elles sont
-- posees validees.
--
-- Liste de reference des etats : ACCOUNT_STATUSES dans lib/accounts.ts
-- (test/accounts-migration.test.ts). Le backend Python ne lit ni n'ecrit
-- "User" : il n'est pas concerne.

-- 1. L'identifiant et le mot de passe deviennent facultatifs
ALTER TABLE "User" ALTER COLUMN "username" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "password_hash" DROP NOT NULL;

-- 2. Les nouvelles colonnes ; les comptes existants sont actifs
ALTER TABLE "User"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "display_name" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "first_login_at" TIMESTAMP(3),
  ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

-- 3. Un compte cree sans etat explicite est un invite
ALTER TABLE "User"
  ALTER COLUMN "status" SET DEFAULT 'INVITED';

-- 4. Une adresse ne sert qu'a un compte
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- 5. Les etats
ALTER TABLE "User"
  ADD CONSTRAINT "User_status_check"
  CHECK (status IN ('INVITED', 'ACTIVE', 'DISABLED'));

-- 6. Les invariants dont depend le code
--    a. un compte actif a un mot de passe, et lui seul ;
ALTER TABLE "User"
  ADD CONSTRAINT "User_password_status_check"
  CHECK ((status = 'ACTIVE') = (password_hash IS NOT NULL));
--    b. un invite a une adresse : sans elle, pas de premiere connexion ;
ALTER TABLE "User"
  ADD CONSTRAINT "User_invited_email_check"
  CHECK (status <> 'INVITED' OR email IS NOT NULL);
--    c. tout compte a de quoi se connecter : une adresse ou l'ancien identifiant ;
ALTER TABLE "User"
  ADD CONSTRAINT "User_identity_check"
  CHECK (email IS NOT NULL OR username IS NOT NULL);
--    d. l'unicite ne vaut que sur une forme unique : les minuscules.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_lower_check"
  CHECK (email = lower(email));
