# 09 — Nasadenie na jeden VPS (web + API + databáza)

Návod na nasadenie celého portálu na **jeden VPS** (Lumadock / Contabo / Hetzner…),
kde na tom istom serveri bežia databáza, API aj web. Caddy automaticky vybaví HTTPS.
Toto je jednoduchšia alternatíva k rozdeleniu web-na-Vercel + API-na-VPS (`docs/07`).

Cieľový stav:

```
fkknv.sk      → Caddy → web (Next.js)     ┐
www.fkknv.sk  → redirect na fkknv.sk      │  jeden VPS, jeden docker compose
api.fkknv.sk  → Caddy → API (NestJS)      ┘  + PostgreSQL, HTTPS automaticky
```

Minimálny VPS: **2 vCPU / 4 GB RAM / 40 GB disk**, OS **Ubuntu 22.04/24.04** (Linux).

---

## Krok 1 — DNS (doména fkknv.sk)

U registrátora domény (Websupport) nastavte **tri A záznamy** na IP VPS:

| Typ | Meno | Hodnota |
|---|---|---|
| A | `@` | IP adresa VPS |
| A | `www` | IP adresa VPS |
| A | `api` | IP adresa VPS |

Overenie (propagácia je minúty až hodiny):

```bash
dig fkknv.sk +short        # musí vrátiť IP VPS
dig api.fkknv.sk +short    # musí vrátiť IP VPS
```

> Caddy vydá certifikáty až keď DNS smeruje na server — DNS nastavte ako prvé.

---

## Krok 2 — Príprava VPS

```bash
ssh root@<IP-VPS>

# aktualizácia + Docker
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh

# firewall — len SSH, HTTP, HTTPS
apt install -y ufw
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable

mkdir -p /opt/fkknv/app /opt/fkknv/backups
```

---

## Krok 3 — Kód a premenné

```bash
cd /opt/fkknv/app
git clone https://github.com/peterbejcek/futbalapp.git .

cd infra
cp .env.example .env
nano .env            # vyplňte POSTGRES_PASSWORD a JWT_SECRET
chmod 600 .env
```

`JWT_SECRET` vygenerujete napr.: `openssl rand -base64 48`.
`RESEND_API_KEY` sa dá doplniť neskôr (bez neho appka funguje, e-maily sa len logujú).
Účet klubu v e-mailoch s predpismi poplatkov (VÚB, 62639-512/0200, IBAN SK77 0200 0000 0000 6263 9512) je predvolený v `infra/docker-compose.yml`; prepísať ho možno v `infra/.env` cez `CLUB_IBAN`, `CLUB_ACCOUNT_NUMBER`, `CLUB_BANK_NAME`, `CLUB_ACCOUNT_NAME`. Ak je `CLUB_IBAN` prázdny, e-mail napíše „Číslo účtu vám oznámi klub“.

---

## Krok 4 — Štart

```bash
cd /opt/fkknv/app/infra
docker compose --env-file .env up -d --build     # prvý build ~5–10 min

docker compose ps
docker compose logs -f api                        # migrácie prebehnú automaticky
```

Caddy si po nabehnutí sám vybaví TLS certifikáty pre všetky tri domény.

**Overenie:**

```bash
curl https://api.fkknv.sk/api/v1/health          # → {"status":"ok"}
```

Web otvorte v prehliadači: `https://fkknv.sk`.

---

## Krok 5 — Seed (kategórie, sezóna, admin účet)

Jednorazovo naplní číselníky a vytvorí admina:

```bash
cd /opt/fkknv/app/infra
docker compose exec \
  -e SEED_ADMIN_EMAIL=predseda@fkknv.sk \
  -e SEED_ADMIN_PASSWORD='<jednorazové-heslo>' \
  api npx ts-node prisma/seed.ts
```

Prihláste sa na `https://fkknv.sk` a **heslo admina hneď zmeňte** (Nastavenia).

---

## Krok 6 — Zálohy

Denné, týždenné a mesačné zálohy (každá vrstva vlastný priečinok + retencia):

```bash
chmod +x /opt/fkknv/app/infra/backup.sh /opt/fkknv/app/infra/restore.sh
crontab -e
# denne 3:30, týždenne v nedeľu 3:40, mesačne 1. v mesiaci 3:50
30 3 * * *   /opt/fkknv/app/infra/backup.sh daily   >> /var/log/fkknv-backup.log 2>&1
40 3 * * 0   /opt/fkknv/app/infra/backup.sh weekly  >> /var/log/fkknv-backup.log 2>&1
50 3 1 * *   /opt/fkknv/app/infra/backup.sh monthly >> /var/log/fkknv-backup.log 2>&1
```

Zálohy sú v `/opt/fkknv/backups/{daily,weekly,monthly}`. Prvú spusti ručne:
`/opt/fkknv/app/infra/backup.sh daily`. Obnova: `infra/restore.sh <dump>`.
Zálohy odporúčam kopírovať aj mimo VPS (rclone na S3 / Storage Box).
Aspoň raz otestujte obnovu: `pg_restore -U fkknv -d fkknv --clean <dump>`.

---

## Krok 7 — Demo konto pre app-store review

Pre schvaľovanie aplikácie v Google Play / App Store treba prihlasovacie konto s
ukážkovými dátami, ktoré **nevidí žiadne ostré dáta** klubu (a ostatní členovia
nevidia jeho testovacie dáta). Vytvorí ho idempotentný skript:

```bash
cd /opt/fkknv/app/infra
docker compose exec api npx ts-node prisma/seed-demo.ts
# voliteľne vlastné heslo:
# docker compose exec -e REVIEW_PASSWORD='...' api npx ts-node prisma/seed-demo.ts
```

Skript vytvorí konto **`review@fkknv.sk`** (tréner „Demo tímu") a testovacie dáta:
hráči s registračnými preukazmi, tréningy, zápas s nomináciou, komunikáciu a úlohu.
Na konci vypíše **e-mail a heslo** — tie uveď recenzentom (viď `docs/10-publikovanie-do-obchodov.md`).
Izolácia demo dát je zabezpečená na serveri (príznak `isDemo`), platí pre web aj mobil.

---

## Krok 8 — Aktualizácia na novú verziu

```bash
ssh root@<IP-VPS>
cd /opt/fkknv/app
git pull
cd infra && docker compose --env-file .env up -d --build
docker compose logs -f api        # migrácie prebehnú automaticky
```

---

## Kontrolný zoznam pred spustením

- [ ] `dig fkknv.sk` aj `dig api.fkknv.sk` vracajú IP VPS
- [ ] `https://api.fkknv.sk/api/v1/health` vracia `ok`, certifikát platný
- [ ] `https://fkknv.sk` — registrácia, login, chat (WebSocket), PDF príspevok fungujú
- [ ] Admin heslo zmenené zo seed hodnoty; `infra/.env` má práva 600
- [ ] Prvá záloha DB existuje a obnova otestovaná
- [ ] (voliteľné) Resend doména overená, `RESEND_API_KEY` doplnený, upomienka otestovaná
