#!/usr/bin/env bash
# Vymaže VŠETKY údaje v sekcii Platby: predpisy a ich priradenia, povinnosti (dlžníci),
# bankové pohyby z výpisov, párovania, naučené účty platiteľov, upomienky a výdavky.
# Pred mazaním urobí zálohu databázy a vypýta potvrdenie. Členovia a ostatné dáta sa nemenia.
#
# Použitie (na VPS):  cd /opt/fkknv/app/infra && ./clear-payments.sh
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/fkknv/app/infra}"
ENV_ARG=()
[ -f "$COMPOSE_DIR/.env" ] && ENV_ARG=(--env-file "$COMPOSE_DIR/.env")
compose() { docker compose "${ENV_ARG[@]}" -f "$COMPOSE_DIR/docker-compose.yml" "$@"; }
psql_run() { compose exec -T postgres psql -U fkknv -d fkknv -v ON_ERROR_STOP=1 "$@"; }

echo "Aktuálny stav (počet riadkov):"
psql_run -c "SELECT 'FeePlan' AS tabulka, count(*) FROM \"FeePlan\"
UNION ALL SELECT 'FeeAssignment', count(*) FROM \"FeeAssignment\"
UNION ALL SELECT 'PaymentObligation', count(*) FROM \"PaymentObligation\"
UNION ALL SELECT 'PaymentMatch', count(*) FROM \"PaymentMatch\"
UNION ALL SELECT 'BankTransaction', count(*) FROM \"BankTransaction\"
UNION ALL SELECT 'BankPayerLink', count(*) FROM \"BankPayerLink\"
UNION ALL SELECT 'DunningNotice', count(*) FROM \"DunningNotice\"
UNION ALL SELECT 'Expense', count(*) FROM \"Expense\";"

echo
echo "Toto NEVRATNE vymaže všetky údaje v sekcii Platby (vrátane predpisov)."
read -r -p "Na potvrdenie napíšte VYMAZAT: " answer
[ "$answer" = "VYMAZAT" ] || { echo "Zrušené, nič sa nezmenilo."; exit 1; }

echo "Zálohujem databázu…"
COMPOSE_DIR="$COMPOSE_DIR" "$COMPOSE_DIR/backup.sh" daily

echo "Mažem…"
psql_run <<'SQL'
BEGIN;
DELETE FROM "PaymentMatch";
DELETE FROM "DunningNotice";
DELETE FROM "Expense";
DELETE FROM "BankPayerLink";
DELETE FROM "BankTransaction";
DELETE FROM "PaymentObligation";
DELETE FROM "FeeAssignment";
DELETE FROM "FeePlan";
COMMIT;
SQL

echo "Hotovo. Sekcia Platby je prázdna, môžete nahrať nové údaje."
