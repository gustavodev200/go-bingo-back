-- Arena: economia e ranking únicos para todos os jogos.

-- AlterEnum
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'STAKE';
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'PRIZE';
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'BONUS';
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'PENALTY';
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'TIER';
ALTER TYPE "CoinReason" ADD VALUE IF NOT EXISTS 'SEASON';

-- CreateEnum
CREATE TYPE "ArenaGame" AS ENUM ('BINGO', 'UNO', 'TRUCO', 'DOMINO', 'SNAKE', 'BOMBER');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN "lastWinBonusOn" DATE,
ADD COLUMN "streak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bestStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "ratedMatches" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "bestTier" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MatchResult" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "game" "ArenaGame" NOT NULL,
    "placement" INTEGER NOT NULL,
    "players" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "abandoned" BOOLEAN NOT NULL DEFAULT false,
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "pointsDelta" INTEGER NOT NULL DEFAULT 0,
    "coinsDelta" INTEGER NOT NULL DEFAULT 0,
    "staked" INTEGER NOT NULL DEFAULT 0,
    "prize" INTEGER NOT NULL DEFAULT 0,
    "bonuses" JSONB NOT NULL DEFAULT '[]',
    "streak" INTEGER NOT NULL DEFAULT 0,
    "pointsAfter" INTEGER NOT NULL DEFAULT 0,
    "tierUp" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPayout" (
    "id" UUID NOT NULL,
    "weekStart" DATE NOT NULL,
    "rank" INTEGER NOT NULL,
    "userId" UUID NOT NULL,
    "coins" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchResult_matchId_userId_key" ON "MatchResult"("matchId", "userId");
CREATE INDEX "MatchResult_userId_createdAt_idx" ON "MatchResult"("userId", "createdAt");
CREATE INDEX "MatchResult_createdAt_userId_idx" ON "MatchResult"("createdAt", "userId");
CREATE UNIQUE INDEX "SeasonPayout_weekStart_rank_key" ON "SeasonPayout"("weekStart", "rank");

-- AddForeignKey
ALTER TABLE "MatchResult" ADD CONSTRAINT "MatchResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pontos nunca negativos (o serviço já faz o piso em 0).
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_points_nonnegative" CHECK ("points" >= 0);

-- Quem já estava em uma liga não recebe o bônus de subida retroativamente.
UPDATE "Profile" SET "bestTier" = CASE
  WHEN "points" >= 3000 THEN 5 WHEN "points" >= 1500 THEN 4 WHEN "points" >= 800 THEN 3
  WHEN "points" >= 400 THEN 2 WHEN "points" >= 150 THEN 1 ELSE 0 END;

-- Mesma regra das demais tabelas (Princípio IV): RLS ligada e sem policies.
ALTER TABLE "MatchResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeasonPayout" ENABLE ROW LEVEL SECURITY;
