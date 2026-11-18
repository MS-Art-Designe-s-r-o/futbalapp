-- Ing. Michal Krcho: odstránenie textu o neoverených údajoch a odkazu na pôvodný web (údaje sa nemenili, klub ich potvrdil).
UPDATE "ClubPerson"
SET "sourceNote" = NULL, "sourceUrl" = NULL, "status" = 'PUBLISHED', "confirmedAt" = now(), "updatedAt" = now()
WHERE translate(lower("name"), 'áäčďéíľĺňóôöŕšťúüýž', 'aacdeillnooorstuuyz') LIKE '%krcho%';

-- Peter Dziak: odstránený úplne.
DELETE FROM "ClubPerson"
WHERE translate(lower("name"), 'áäčďéíľĺňóôöŕšťúüýž', 'aacdeillnooorstuuyz') LIKE '%dziak%';
