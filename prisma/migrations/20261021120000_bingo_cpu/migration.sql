-- Bingo com CPU: cartelas extras jogadas pelo servidor (partida sem ranking).
ALTER TABLE "Room" ADD COLUMN "cpuPlayers" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Room" ADD CONSTRAINT "Room_cpuPlayers_range" CHECK ("cpuPlayers" BETWEEN 0 AND 3);
