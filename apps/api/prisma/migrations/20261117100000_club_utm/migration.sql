-- Súper „Útvar talentovanej mládeže“ v registri klubov s logom (apps/web/public/teams/utm-vsfz.jpg).
INSERT INTO "Club" ("id", "name", "logoUrl")
VALUES ('c' || md5('Útvar talentovanej mládeže'), 'Útvar talentovanej mládeže', 'https://fkknv.sk/teams/utm-vsfz.jpg')
ON CONFLICT ("name") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl";
