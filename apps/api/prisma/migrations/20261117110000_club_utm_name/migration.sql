-- Názov súpera „UTM Útvar talentovanej mládeže“ (vyhľadateľný aj podľa skratky UTM), aj v už založených zápasoch.
UPDATE "Match" SET "opponent" = 'UTM Útvar talentovanej mládeže' WHERE "opponent" = 'Útvar talentovanej mládeže';
DELETE FROM "Club" WHERE "name" = 'Útvar talentovanej mládeže'
  AND EXISTS (SELECT 1 FROM "Club" WHERE "name" = 'UTM Útvar talentovanej mládeže');
UPDATE "Club" SET "name" = 'UTM Útvar talentovanej mládeže' WHERE "name" = 'Útvar talentovanej mládeže';
INSERT INTO "Club" ("id", "name", "logoUrl")
VALUES ('c' || md5('UTM Útvar talentovanej mládeže'), 'UTM Útvar talentovanej mládeže', 'https://fkknv.sk/teams/utm-vsfz.jpg')
ON CONFLICT ("name") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl";
