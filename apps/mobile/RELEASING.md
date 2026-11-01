# Vydávanie mobilnej aplikácie (FK KNV)

Všetky príkazy spúšťaj **na svojom počítači** (nie na VPS), v priečinku `apps/mobile`,
s prihláseným EAS účtom (`eas whoami` → petobejo / petobejos-team).

## Konfigurácia (už nastavené)
- `expo-updates` + `updates.url` na EAS projekt → OTA aktualizácie
- `runtimeVersion: "1.0.0"` (pevná) — builds a updates s rovnakou hodnotou sú kompatibilné
- kanály v `eas.json`: `preview` (interné testovanie, APK) a `production` (obchody)

## Kedy stačí OTA update a kedy treba nový build
| Zmena | Ako vydať |
| --- | --- |
| JS/TS (obrazovky, texty, logika, oprava chýb) | `eas update` (OTA) |
| pridaná natívna knižnica / zmena app.json plugins / zmena `runtimeVersion` | nový `eas build` |

> Ak zmeníš `runtimeVersion`, staršie nainštalované buildy prestanú dostávať updaty,
> kým si nenainštalujú nový build. Preto ho meň len pri natívnych zmenách.

## Prvý raz (aby appka vedela prijímať OTA)
```bash
cd apps/mobile
pnpm install
eas build --profile preview --platform android   # alebo: pnpm build:preview
```
Nainštaluj výsledný APK do telefónu (z odkazu/QR, ktorý EAS vypíše).

## Ďalšie JS zmeny — bez rebuildu
```bash
cd apps/mobile
pnpm update:preview "popis zmeny"     # OTA do kanála preview
```
Appka si update stiahne pri ďalšom otvorení (aplikuje sa po reštarte appky).

## Produkčné vydanie (do obchodov)
```bash
eas build --profile production --platform all       # alebo: pnpm build:production
# JS opravy medzi buildmi:
pnpm update:production "popis"
```

## Trvalý odkaz na Android APK (web fkknv.sk)
Odkaz `https://fkknv.sk/stiahnut/fkknv.apk` je fixný. Po novom builde stiahni APK z EAS
a prepíš súbor na serveri:
```bash
scp fkknv.apk root@45.43.166.60:/opt/fkknv/app/infra/downloads/fkknv.apk
```
