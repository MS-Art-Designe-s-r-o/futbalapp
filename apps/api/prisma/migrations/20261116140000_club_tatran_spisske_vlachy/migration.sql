-- Súper „FK Tatran Spišské Vlachy“ v registri klubov s logom (apps/web/public/teams/tatran-spisske-vlachy.jpg).
INSERT INTO "Club" ("id", "name", "logoUrl")
VALUES ('c' || md5('FK Tatran Spišské Vlachy'), 'FK Tatran Spišské Vlachy', 'https://fkknv.sk/teams/tatran-spisske-vlachy.jpg')
ON CONFLICT ("name") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl";
