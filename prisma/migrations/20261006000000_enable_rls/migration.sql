-- RLS ligada e SEM policies: PostgREST (anon/authenticated) não enxerga nada.
-- O Prisma conecta como dono/postgres e ignora RLS. Ver constituição, Princípio IV.
ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RoomMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Game" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Draw" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Card" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
