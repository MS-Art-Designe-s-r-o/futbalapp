# 08 — Roly, oprávnenia a štruktúra (rozhodnutia)

Tento dokument zhŕňa dohodnuté rozhodnutia o rolách, viditeľnosti a štruktúre klubu a ako sú premietnuté v aplikácii.

## 1. Roly (5)

| Rola | Kód | Rozsah |
|---|---|---|
| Predseda / správca | `ADMIN` | Všetko vrátane technických nastavení a rolí |
| Vedúci klubu | `MANAGER` | Celý klub — financie, členovia, registrácie, reporty; bez technických nastavení |
| Tréner | `COACH` | Len **svoje družstvá** (scope cez `teamId`) — tréningy, dochádzka, nominácie, zápasy, komunikácia |
| Hráč | `PLAYER` | Vlastný profil, kalendár, nominácie, dochádzka, chat svojho družstva |
| Rodič | `PARENT` | **Svoje deti** — platby, dochádzka, kalendár, chat družstva dieťaťa, podklad pre príspevok |

Jeden účet môže mať viac rolí (tréner je zároveň rodič atď.). Vedúci družstva sme **nezaviedli** ako samostatnú rolu — v malom klube ju pokryje `COACH` priradený na dané družstvo.

## 2. Družstvá pod kategóriami

- Každá veková kategória (U8 … Muži) má **aspoň jedno družstvo**; možno pridať ďalšie (napr. `U10 B`) v *Nastaveniach*.
- Hráč patrí do jedného družstva v sezóne (`TeamMembership`). Automatické zaradenie podľa ročníka ho dá do **predvoleného družstva** kategórie; presun do B je manuálna výnimka, ktorú ďalší prepočet nezmení.
- Tréner sa priraďuje na **družstvo**, nie na celú kategóriu.

## 3. Registrácia

- **Kto registruje:** hybrid — verejný formulár na webe (rodič) **aj** admin/vedúci môže pridať hráča priamo (*Členovia → Nový člen*).
- **Schvaľovanie:** admin alebo vedúci klubu (*Registrácie*). Po schválení vznikne člen, rodičovský účet, väzba a zaradenie do družstva.
- **Zaradenie do kategórie:** hybrid — systém navrhne podľa dátumu narodenia, vedenie potvrdí alebo ručne prepíše.

## 4. Platby — kto zadáva a kto vidí

| | Zadáva | Vidí |
|---|---|---|
| Predpisy, generovanie, banka, upomienky | Admin, Vedúci | Admin, Vedúci |
| Stav platieb družstva (kto zaplatil/dlhuje) | — | Tréner (svoje družstvo) |
| Vlastné platby | — | Hráč (svoje), Rodič (svojich detí) |

Rodič aj hráč teda **vidia svoje platby** na prehľade a stiahnu si podklad pre športový príspevok; sumy a predpisy nastavuje len vedenie.

## 5. Prehľad (dashboard) podľa roly

- **Rodič:** stav platieb detí + najbližšie udalosti.
- **Hráč:** vlastné platby + najbližšie udalosti/nominácie.
- **Tréner:** jeho družstvá, najbližšie tréningy/zápasy (odkaz na dochádzku a zápis).
- **Admin/Vedúci:** klubové čísla (počet členov, dlžníci, registrácie) + udalosti.

## 6. Komunikácia — podkanály

Každé družstvo má **tri podkanály**:

| Podkanál | Píše | Číta |
|---|---|---|
| **Oznamy** | Tréner, vedenie | Všetci členovia družstva |
| **Tréningy** | Všetci členovia družstva | Všetci členovia družstva |
| **Všeobecné** | Všetci členovia družstva | Všetci členovia družstva |

Navyše **Oznamy klubu** (celoklubové, píše len vedenie) a interné kanály *Tréneri* / *Vedenie*. Členstvo v tímových kanáloch sa napĺňa zo súpisiek (rodičia + hráči s účtom + tréneri ako moderátori) cez *Nastavenia → Prepočítať členstvo kanálov*.

## 7. Zápasy — kto čo robí

- **Pridáva zápas/turnaj:** tréner (svoje družstvo), vedúci, admin.
- **Nominuje hráčov:** tréner, vedúci, admin — pridávať/odoberať možno aj počas zápasu.
- **Zapisuje štatistiky:** tréner, vedúci, admin (naživo z mobilu aj webu, offline tolerantné).
- **Evidované udalosti:** gól, asistencia, premenená/nepremenená penalta, žltá/červená karta, faul, strela, roh, inkasovaný gól, striedania, poznámka. Skóre sa dopočítava z gólov a premenených penált.

## 8. Prehľad oprávnení (matica)

| Oblasť | Admin | Vedúci | Tréner | Hráč | Rodič |
|---|:--:|:--:|:--:|:--:|:--:|
| Členovia — editácia | ✅ | ✅ | svoje družstvo | vlastný profil | svoje deti |
| Schvaľovanie registrácií | ✅ | ✅ | — | — | — |
| Poplatky + banka | ✅ | ✅ | — | — | — |
| Platby — zobrazenie | celý klub | celý klub | stav družstva | vlastné | svoje deti |
| Tréningy/udalosti — tvorba | ✅ | ✅ | svoje družstvo | — | — |
| Dochádzka — zápis | ✅ | ✅ | svoje družstvo | — | — |
| Zápasy + nominácie + štatistiky | ✅ | ✅ | svoje družstvo | — | — |
| Komunikácia — oznamy (písať) | ✅ | ✅ | svoje družstvo | — | — |
| Nastavenia (družstvá, futbalnet, exporty) | ✅ | ✅ | — | — | — |

> Poznámka k nasadeniu: táto zmena upravila databázovú schému (družstvá, podkanály).
> Na skúšobnom prostredí spustite `./quickstart.sh reset && PUBLIC_HOST=<IP> ./quickstart.sh`,
> aby sa vytvorila nová schéma a seed (družstvá + podkanály).

## Skupiny Brankári a Tréner brankárov

- Ku každému družstvu s aspoň jedným brankárom (člen so zaškrtnutým „Brankár“ alebo postavením GK) vznikne automatická skupina „<družstvo> Brankári“ a spoločná „Brankári (všetci)“. Sú to bežné `Team` záznamy s `isGoalkeeperGroup = true`; členov dopĺňa `GoalkeepersService` (pri zmene člena, presune, importe a v noci), ručne sa nemenia a nezobrazujú sa na verejnom webe, v tabuľke ani pri zápasoch.
- Rola `GK_COACH` (Tréner brankárov) sa prideľuje vo formulári člena. Služba jej automaticky pridelí trénerský scope (`COACH` + `teamId`) len na neprázdne skupiny Brankári, takže tréner vidí iba tieto skupiny, ich členov, kalendár, dochádzku a komunikáciu. Tréningy môže vytvárať pre jednu skupinu alebo spoločne pre viac skupín.
- Automatické `COACH` roly na skupinách Brankári sa vo formulári člena neukazujú.
