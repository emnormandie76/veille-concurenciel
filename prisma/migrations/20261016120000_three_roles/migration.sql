-- Trois roles : USER, GESTIONNAIRE, ADMIN (plan gestion-contenu, etape 1).
--
-- Decision G4 du 16 octobre 2026 :
--   * USER          toute personne connectee ; consulte ;
--   * GESTIONNAIRE  les anciens MODERATOR ; ajoute, modifie, supprime le contenu ;
--   * ADMIN         gere les comptes ; seul a utiliser l'IA.
--
-- La contrainte "User_role_check" (migration 20260902120000) refuse tout role
-- hors ADMIN et MODERATOR. Cette migration la remplace, sans toucher
-- l'ancienne migration (son empreinte est enregistree en base) :
--
--   1. retirer l'ancienne contrainte, qui refuserait GESTIONNAIRE ;
--   2. convertir les comptes MODERATOR en GESTIONNAIRE ;
--   3. poser la nouvelle contrainte, sur les trois roles ;
--   4. passer le defaut de MODERATOR a USER.
--
-- La contrainte est posee NOT VALID, comme les autres gardes d'enumeration
-- (20260902120000) : une migration ne doit pas pouvoir echouer sur des donnees
-- historiques. Releve du 16 octobre 2026 sur les branches Neon dev et main :
-- un ADMIN et un MODERATOR, donc toutes les lignes sont conformes apres
-- l'etape 2. Pour la valider apres verification :
--   ALTER TABLE "User" VALIDATE CONSTRAINT "User_role_check";
--
-- Liste de reference : USER_ROLES dans lib/roles.ts (test/roles-migration.test.ts).
-- Le backend Python ne lit ni n'ecrit "User" : il n'est pas concerne.

-- 1. L'ancienne contrainte
ALTER TABLE "User"
  DROP CONSTRAINT "User_role_check";

-- 2. Les anciens moderateurs deviennent gestionnaires
UPDATE "User"
  SET role = 'GESTIONNAIRE'
  WHERE role = 'MODERATOR';

-- 3. La nouvelle contrainte
ALTER TABLE "User"
  ADD CONSTRAINT "User_role_check"
  CHECK (role IN ('USER', 'GESTIONNAIRE', 'ADMIN'))
  NOT VALID;

-- 4. Le defaut : un compte cree sans role explicite est un USER
ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER';
