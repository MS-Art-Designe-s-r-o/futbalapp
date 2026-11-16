-- Premenovanie súpera „FK Tatran Spišské Vlachy“ na „ŠK TATRAN Spišské Vlachy“ (aj v už založených zápasoch).
UPDATE "Match" SET "opponent" = 'ŠK TATRAN Spišské Vlachy' WHERE "opponent" = 'FK Tatran Spišské Vlachy';

DELETE FROM "Club" WHERE "name" = 'FK Tatran Spišské Vlachy'
  AND EXISTS (SELECT 1 FROM "Club" WHERE "name" = 'ŠK TATRAN Spišské Vlachy');
UPDATE "Club" SET "name" = 'ŠK TATRAN Spišské Vlachy' WHERE "name" = 'FK Tatran Spišské Vlachy';

INSERT INTO "Club" ("id", "name", "logoUrl")
VALUES ('c' || md5('ŠK TATRAN Spišské Vlachy'), 'ŠK TATRAN Spišské Vlachy', 'https://fkknv.sk/teams/tatran-spisske-vlachy.jpg')
ON CONFLICT ("name") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl";

UPDATE "Match" SET "opponentLogo" = 'https://fkknv.sk/teams/tatran-spisske-vlachy.jpg' WHERE "opponent" = 'ŠK TATRAN Spišské Vlachy';
