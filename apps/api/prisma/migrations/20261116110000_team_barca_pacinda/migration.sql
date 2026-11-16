-- Družstvo „FK Barca Pačinda Academy“ (s logom) v kategóriách U9, U10, U11, U13 — idempotentne.
INSERT INTO "Team" ("id", "teamCategoryId", "name", "sortOrder", "logoUrl")
SELECT 'c' || md5(random()::text || c."id"), c."id", 'FK Barca Pačinda Academy',
       (SELECT COUNT(*) FROM "Team" t WHERE t."teamCategoryId" = c."id"), '/teams/pacinda-academy.jpg'
FROM "TeamCategory" c
WHERE c."code" IN ('U9', 'U10', 'U11', 'U13')
  AND NOT EXISTS (SELECT 1 FROM "Team" t WHERE t."teamCategoryId" = c."id" AND t."name" = 'FK Barca Pačinda Academy');

-- logo aj pre už existujúce družstvá s týmto názvom
UPDATE "Team" SET "logoUrl" = '/teams/pacinda-academy.jpg' WHERE "name" = 'FK Barca Pačinda Academy';

-- komunikačné kanály nových družstiev (ako pri vytvorení družstva v Nastaveniach)
INSERT INTO "Channel" ("id", "kind", "teamId", "name")
SELECT 'c' || md5(random()::text || t."id" || k.suffix), k.kind::"ChannelKind", t."id", t."name" || k.suffix
FROM "Team" t
CROSS JOIN (VALUES
  ('TEAM_ANNOUNCEMENTS', ' · Oznamy'),
  ('TEAM_TRAINING', ' · Tréningy'),
  ('TEAM_GENERAL', ' · Všeobecné'),
  ('TEAM_EMAIL', ' · Hromadný email')
) AS k(kind, suffix)
WHERE t."name" = 'FK Barca Pačinda Academy'
  AND NOT EXISTS (SELECT 1 FROM "Channel" ch WHERE ch."teamId" = t."id" AND ch."kind"::text = k.kind);
