-- FK Barca Pačinda Academy je súper (register klubov), nie naše družstvo.
-- Odstráni omylom založené družstvá (len prázdne — bez členov, udalostí a rolí) a ich kanály.
DELETE FROM "Channel" ch
USING "Team" t
WHERE ch."teamId" = t."id"
  AND t."name" = 'FK Barca Pačinda Academy'
  AND NOT EXISTS (SELECT 1 FROM "TeamMembership" m WHERE m."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "UserRole" r WHERE r."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "Message" msg WHERE msg."channelId" = ch."id");

DELETE FROM "Team" t
WHERE t."name" = 'FK Barca Pačinda Academy'
  AND NOT EXISTS (SELECT 1 FROM "TeamMembership" m WHERE m."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "Event" e WHERE e."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "UserRole" r WHERE r."teamId" = t."id")
  AND NOT EXISTS (SELECT 1 FROM "Channel" c WHERE c."teamId" = t."id");

-- do registra klubov (zoznam súperov) s logom
INSERT INTO "Club" ("id", "name", "logoUrl")
VALUES ('c' || md5('FK Barca Pačinda Academy'), 'FK Barca Pačinda Academy', 'https://fkknv.sk/teams/pacinda-academy.jpg')
ON CONFLICT ("name") DO UPDATE SET "logoUrl" = EXCLUDED."logoUrl";
