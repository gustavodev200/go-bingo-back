-- Bonecos jogadores de futebol: os personagens antigos (c01..c17) deixaram de existir.
-- Perfil com código antigo volta ao boneco padrão (derivado do id) até escolher um novo.
UPDATE "Profile" SET "character" = NULL WHERE "character" ~ '^c[0-9]{2}$';
