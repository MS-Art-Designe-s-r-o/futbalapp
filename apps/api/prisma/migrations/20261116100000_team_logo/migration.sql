ALTER TABLE "Team" ADD COLUMN "logoUrl" TEXT;

-- Logo družstva Pačinda Academy (súbor apps/web/public/teams/pacinda-academy.jpg)
UPDATE "Team" SET "logoUrl" = '/teams/pacinda-academy.jpg'
WHERE translate(lower("name"), 'áčďéíľĺňóôŕšťúýž', 'acdeillnoorstuyz') LIKE '%pacinda%';
