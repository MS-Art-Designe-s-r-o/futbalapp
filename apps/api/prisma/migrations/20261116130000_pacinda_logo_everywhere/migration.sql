-- Logo Pačinda Academy pre všetky kluby a zápasy so súperom „Pačinda“ (bez ohľadu na diakritiku a veľkosť písmen).
UPDATE "Club" SET "logoUrl" = 'https://fkknv.sk/teams/pacinda-academy.jpg'
WHERE translate(lower("name"), 'áčďéíľĺňóôŕšťúýž', 'acdeillnoorstuyz') LIKE '%pacinda%';

UPDATE "Match" SET "opponentLogo" = 'https://fkknv.sk/teams/pacinda-academy.jpg'
WHERE translate(lower("opponent"), 'áčďéíľĺňóôŕšťúýž', 'acdeillnoorstuyz') LIKE '%pacinda%';
