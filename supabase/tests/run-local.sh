#!/usr/bin/env bash
# Exécute les 5 fichiers SQL + les tests sur un PostgreSQL LOCAL (psql requis).
# Usage : DATABASE_URL="postgresql://postgres:motdepasse@localhost:5432/postgres" ./supabase/tests/run-local.sh
set -euo pipefail
: "${DATABASE_URL:?Définissez DATABASE_URL (base locale de test, JAMAIS la production)}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${DATABASE_URL%/*}"; DB="jlodna_test"
psql "$BASE/postgres" -q -c "drop database if exists $DB" -c "create database $DB"
T="$BASE/$DB"
psql "$T" -q -v ON_ERROR_STOP=1 -f "$HERE/tests/stub-supabase.sql"
for f in schema functions triggers policies seed modules/10_bio_b2b modules/20_jlodni modules/30_payments modules/40_sellers modules/50_security_mobile; do echo "→ $f.sql"; psql "$T" -q -v ON_ERROR_STOP=1 -f "$HERE/$f.sql" 2>&1 | grep -v NOTICE || true; done
echo "→ tests (noyau)"; psql "$T" -f "$HERE/tests/tests.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //' | tee /tmp/jlodna_tests.txt
echo "→ tests (modules BIO / B2B / confidentialité)"; psql "$T" -f "$HERE/tests/tests_modules.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //' | tee -a /tmp/jlodna_tests.txt
echo "→ tests (paiements + vendeurs)"; psql "$T" -f "$HERE/tests/tests_payments_sellers.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //' | tee -a /tmp/jlodna_tests.txt
echo "→ tests (sécurité + mobile)"; psql "$T" -f "$HERE/tests/tests_security_mobile.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" | sed 's/^psql:[^ ]* NOTICE:  //' | tee -a /tmp/jlodna_tests.txt
echo; echo "PASS: $(grep -c 'PASS -' /tmp/jlodna_tests.txt)  FAIL: $(grep -c 'FAIL -' /tmp/jlodna_tests.txt)"
! grep -q 'FAIL -' /tmp/jlodna_tests.txt
