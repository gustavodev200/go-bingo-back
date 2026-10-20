-- Mesas com aposta e diamantes (moeda premium).

-- AlterEnum
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'EXCHANGE';

-- CreateEnum
CREATE TYPE "DiamondReason" AS ENUM ('DAILY', 'STREAK', 'EXCHANGE', 'SEASON');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "diamonds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "diamondStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastDiamondOn" DATE;

ALTER TABLE "Room" ADD COLUMN "stake" INTEGER NOT NULL DEFAULT 20;

ALTER TABLE "SeasonPayout" ADD COLUMN "diamonds" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DiamondTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" "DiamondReason" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiamondTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiamondTransaction_userId_createdAt_idx" ON "DiamondTransaction"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "DiamondTransaction" ADD CONSTRAINT "DiamondTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Saldo de diamantes nunca negativo; aposta sempre positiva.
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_diamonds_nonnegative" CHECK ("diamonds" >= 0);
ALTER TABLE "Room" ADD CONSTRAINT "Room_stake_positive" CHECK ("stake" > 0);

-- Mesma regra das demais tabelas (Princípio IV): RLS ligada e sem policies.
ALTER TABLE "DiamondTransaction" ENABLE ROW LEVEL SECURITY;
