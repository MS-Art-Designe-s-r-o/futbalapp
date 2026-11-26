---
name: fkknv-kalendar-udalosti
description: Kalendár portálu FKKNV — udalosti (tréning, zápas, turnaj, rodičovské), hracie plochy a obsadenosť, tréning pre viac družstiev, e-mail pri zmene termínu, adresa a mapa. Použi pri úpravách kalendára, plôch alebo e-mailov k udalostiam.
---

# Kalendár a udalosti

Kód: `apps/api/src/events/events.service.ts` (+controller), `apps/api/src/pitches/*`, web `apps/web/src/app/portal/udalosti/page.tsx`, `apps/web/src/components/event-admin-actions.tsx` (úprava/zmazanie), `MapEmbed`/`AddressLink`.

## Hracie plochy
- Model `Pitch` (názov, povrch PT/UT/VT/MT/MI, adresa), správa v Nastaveniach (ADMIN/MANAGER). `Event.pitchId` je voliteľné; pri zadanej ploche sa `location`/`surface`/`address` kopírujú z nej a pri úprave plochy sa propagujú do udalostí.
- Voľba „Iné (napísať)" = `pitchId` prázdne + ručné miesto a povrch. Pri domácom zápase a tréningu sa ponúka zoznam plôch, pri zápase vonku len text.
- Obsadenosť: `GET /pitches/occupancy?from&to` (všetky družstvá). `assertPitchFree` odmietne prekryv na rovnakej ploche (bez konca = 90 min); pri zadanej ploche je koniec povinný.
- Kalendár (mesiac): filter „Obsadenosť plochy"; klik na deň otvorí `DayModal` (obsadenosť plôch + „+ Tréning/+ Zápas" s predvyplneným dátumom).

## Tréning pre viac družstiev
`teamIds` v `createEventSchema` / `createRecurringTrainingSchema` (`teamId` = prvé). Pre každé družstvo vznikne vlastná udalosť (vlastná dochádzka, séria `recurrenceGroupId`, e-maily). Kontrola plochy prebehne raz → družstvá sa môžu deliť o plochu v rovnakom čase. Tréner smie len svoje družstvá.

## E-mail pri zmene termínu
`EventsService.update` → `notifyRescheduled` pri zmene `startAt`/`endAt` budúcej udalosti: tréning → hráči družstva + rodičia + tréneri; zápas/turnaj → nominovaní (bez REMOVED) + rodičia + tréneri; rodičovské združenie → hráči cieľových družstiev (prázdny cieľ = celý klub) + rodičia + tréneri. Chyba odoslania neblokuje uloženie. Zmena termínu zápasu zo synchronizácie z futbalnetu e-mail NEposiela.

## Poznámky
- Detail zápasu má zvýraznenú adresu a mapu predvolene otvorenú (`MapEmbed defaultOpen`); inde sa mapa načíta po kliknutí.
- Pri novej funkcii nezabudni na verejný web (`isPublic`, zápasy sa zverejňujú vždy) — viď `fkknv-verejny-web`.

## Jednorazové priradenie plôch k starým udalostiam
`apps/api/prisma/assign-pitches.ts` (+ čistý plán `src/pitches/pitch-assign.plan.ts`, test): tréningy a domáce zápasy bez `pitchId` s textovým miestom spáruje s `Pitch` (ručné `--map` → presný názov → jediná čiastočná zhoda). Predvolene DRY-RUN a len budúce udalosti; `--apply` zapisuje, `--include-past` berie aj minulé. Čiastočné prekryvy = konflikt (preskočí sa), rovnaký čas je povolený. Spúšťa sa v kontajneri `api`.
