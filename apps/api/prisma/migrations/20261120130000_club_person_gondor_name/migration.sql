-- Dušan Göndör: maďarské meno s dvoma „ö" (e-mail gondor@fkknv.sk ostáva).
UPDATE "ClubPerson" SET "name" = 'Dušan Göndör', "updatedAt" = now()
WHERE translate(lower("name"), 'áäčďéíľĺňóôöŕšťúüýž', 'aacdeillnooorstuuyz') LIKE '%gondor%';
