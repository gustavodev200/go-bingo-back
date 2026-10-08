-- Personagem escolhido no seletor; null = boneco derivado do id.
-- IF NOT EXISTS: pode ter sido aplicada à mão (SQL editor do Supabase) antes do migrate deploy.
ALTER TABLE "Profile" ADD COLUMN IF NOT EXISTS "character" VARCHAR(8);
