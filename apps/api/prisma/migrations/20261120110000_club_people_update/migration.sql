-- Aktualizácia funkcionárov a trénerov (verejná stránka /klub/funkcionari).
-- Osoby sa hľadajú podľa mena bez diakritiky; ak neexistujú, vytvoria sa. Zmenené a nové záznamy
-- sú zverejnené (PUBLISHED) a potvrdené, takže ich import z pôvodného webu neprepíše.
-- Ing. Michal Krcho a Peter Dziak ostávajú bez zmeny.

-- pomocná funkcia (len pre túto migráciu)
CREATE OR REPLACE FUNCTION pg_temp.norm(t text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT translate(lower(t), 'áäčďéíľĺňóôöŕšťúüýž', 'aacdeillnooorstuuyz') $$;

-- (hľadaný kus mena, nové meno, rola, skupina, družstvo/poznámka, telefón, e-mail, poradie)
CREATE TEMP TABLE _people (match text, name text, role text, grp "ClubPersonGroup", team_note text, phone text, email text, keep_phone boolean, ord int) ;
INSERT INTO _people VALUES
  ('lesnak',   'Ing. Milan Lesňák',   'Predseda FK',  'MANAGEMENT', NULL, NULL, 'lesnak@fkknv.sk',  true,  0),
  ('eperjesi', 'Dušan Gondor',        'Manažér FK',   'MANAGEMENT', NULL, NULL, 'gondor@fkknv.sk',  false, 1),
  ('horizral', 'Ing. Eduard Olekšák', 'člen výboru',  'MANAGEMENT', NULL, NULL, 'oleksak@fkknv.sk', false, 2),
  ('farkas',   'Gejza FARKAŠ',        'Tréner',       'COACH', 'Dorast U17',                NULL, NULL, false, 10),
  ('urban',    'Vladimír URBAN',      'Tréner',       'COACH', 'Žiaci U15',                 NULL, NULL, true,  12),
  ('keda',     'Ing. Marián KÉDA',    'Tréner',       'COACH', 'Žiaci U13',                 NULL, NULL, true,  13),
  ('lellak',   'Stanislav LELLÁK',    'Tréner',       'COACH', 'Prípravka U10',             NULL, NULL, false, 14),
  ('varga',    'Teodor Varga',        'Tréner',       'COACH', 'Prípravka U11',             NULL, NULL, false, 15),
  ('masrna',   'Patrik Masrna',       'Tréner',       'COACH', 'Dorast U17',                NULL, NULL, false, 16),
  ('jurko',    'Roman Jurko',         'Tréner',       'COACH', 'Prípravka U11, Žiaci U13',  NULL, NULL, false, 17);

-- úprava existujúcich (e-mail sa mení len ak je zadaný; telefón ostáva len pri keep_phone)
UPDATE "ClubPerson" c SET
  "name" = p.name, "role" = p.role, "group" = p.grp, "teamNote" = p.team_note,
  "phone" = CASE WHEN p.keep_phone THEN c."phone" ELSE p.phone END,
  "email" = COALESCE(p.email, c."email"),
  "status" = 'PUBLISHED', "sourceUrl" = NULL, "sourceNote" = NULL,
  "confirmedAt" = now(), "sortOrder" = p.ord, "updatedAt" = now()
FROM _people p
WHERE pg_temp.norm(c."name") LIKE '%' || p.match || '%';

-- doplnenie nových (kto ešte neexistuje)
INSERT INTO "ClubPerson" ("id", "name", "role", "group", "teamNote", "phone", "email", "status", "confirmedAt", "sortOrder", "updatedAt")
SELECT 'c' || md5(p.name), p.name, p.role, p.grp, p.team_note, p.phone, p.email, 'PUBLISHED', now(), p.ord, now()
FROM _people p
WHERE NOT EXISTS (SELECT 1 FROM "ClubPerson" c WHERE pg_temp.norm(c."name") LIKE '%' || p.match || '%' OR c."name" = p.name);
