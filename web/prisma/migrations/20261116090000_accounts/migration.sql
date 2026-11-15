-- Passage aux comptes email + mot de passe. Les anciens comptes, identifiés seulement par leur clé Claude,
-- n'ont pas d'email et ne pourraient plus se connecter : ils sont supprimés avec leurs données.
DELETE FROM "User";

-- DropIndex
DROP INDEX "User_keyHash_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "keyHash",
DROP COLUMN "recoveryEmail",
ADD COLUMN     "email" TEXT NOT NULL,
ADD COLUMN     "passwordHash" TEXT NOT NULL,
ALTER COLUMN "keyEncrypted" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

