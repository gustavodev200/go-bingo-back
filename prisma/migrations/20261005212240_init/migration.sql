-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'IN_GAME', 'CLOSED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('IN_PROGRESS', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WinPattern" AS ENUM ('FULL_CARD');

-- CreateTable
CREATE TABLE "Profile" (
    "id" UUID NOT NULL,
    "nickname" VARCHAR(16),
    "isGuest" BOOLEAN NOT NULL DEFAULT true,
    "points" INTEGER NOT NULL DEFAULT 0,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "code" CHAR(6) NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "hostId" UUID NOT NULL,
    "maxPlayers" INTEGER NOT NULL,
    "isPublic" BOOLEAN NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
    "drawIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "winPattern" "WinPattern" NOT NULL DEFAULT 'FULL_CARD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "cardRegens" INTEGER NOT NULL DEFAULT 0,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "status" "GameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "drawnCount" INTEGER NOT NULL DEFAULT 0,
    "winnerId" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draw" (
    "gameId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "drawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Draw_pkey" PRIMARY KEY ("gameId","seq")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" UUID,
    "grid" INTEGER[],
    "marked" INTEGER[] DEFAULT ARRAY[]::INTEGER[],

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Profile_points_idx" ON "Profile"("points" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE INDEX "Room_isPublic_status_idx" ON "Room"("isPublic", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_roomId_slot_key" ON "RoomMember"("roomId", "slot");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE INDEX "Game_roomId_status_idx" ON "Game"("roomId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Draw_gameId_number_key" ON "Draw"("gameId", "number");

-- CreateIndex
CREATE INDEX "Card_roomId_userId_idx" ON "Card"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_gameId_userId_key" ON "Card"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draw" ADD CONSTRAINT "Draw_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma cartela de lobby por jogador por sala (Prisma não modela índice parcial).
CREATE UNIQUE INDEX "Card_lobby_room_user_key" ON "Card"("roomId", "userId") WHERE "gameId" IS NULL;
