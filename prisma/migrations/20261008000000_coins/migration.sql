-- CreateEnum
CREATE TYPE "CoinReason" AS ENUM ('WELCOME', 'DAILY', 'CARD', 'WIN', 'LOSS');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "coins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastDailyBonusOn" DATE;

-- AlterTable
ALTER TABLE "Room" ALTER COLUMN "drawIntervalMs" SET DEFAULT 8000;

-- CreateTable
CREATE TABLE "CoinTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "CoinReason" NOT NULL,
    "gameId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoinTransaction_userId_createdAt_idx" ON "CoinTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Saldo nunca negativo: garantia no banco além da regra no serviço.
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_coins_nonnegative" CHECK ("coins" >= 0);

-- Jogadores que já existiam recebem as boas-vindas (perfis novos recebem no serviço).
UPDATE "Profile" SET "coins" = 100;
INSERT INTO "CoinTransaction" ("id", "userId", "amount", "reason")
SELECT gen_random_uuid(), "id", 100, 'WELCOME' FROM "Profile";

-- Mesma regra das demais tabelas (Princípio IV): RLS ligada e sem policies.
ALTER TABLE "CoinTransaction" ENABLE ROW LEVEL SECURITY;
