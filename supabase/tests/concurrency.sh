#!/usr/bin/env bash
# Test de concurrence : deux clients commandent en même temps la DERNIÈRE unité. Attendu : une commande, un OUT_OF_STOCK.
# À lancer sur une base de TEST déjà initialisée (schema → … → seed), avec 2 utilisateurs factices créés par ce script.
# Usage : DATABASE_URL="postgresql://…/jlodna_test" ./supabase/tests/concurrency.sh
set -euo pipefail
: "${DATABASE_URL:?Définissez DATABASE_URL (base de TEST)}"
P="psql $DATABASE_URL -q -At"
$P <<'SQL' >/dev/null
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000c1','cc1@test.com',now()),('00000000-0000-0000-0000-0000000000c2','cc2@test.com',now()) on conflict do nothing;
update product_variants set stock_quantity = 1, reserved_quantity = 0 where sku = 'DEMO-002-STD';
SQL
SHIP='{"full_name":"Test Test","phone":"50900000","email":"t@t.com","address":"Rue 1","city":"PAP","department":"Ouest"}'
mk() { cat <<SQL
begin; set local role authenticated; select set_config('request.jwt.claim.sub','$1',true) \g /dev/null
select 'RESULT $2: ' || ((public.create_order(jsonb_build_array(jsonb_build_object('variant_id',(select id from product_variants where sku='DEMO-002-STD'),'quantity',1)),'$SHIP'::jsonb,null,'cod'))->>'order_number');
$3
commit;
SQL
}
mk 00000000-0000-0000-0000-0000000000c1 A "select pg_sleep(3);" > /tmp/conc_a.sql; mk 00000000-0000-0000-0000-0000000000c2 B "" > /tmp/conc_b.sql
( $P -f /tmp/conc_a.sql > /tmp/conc_a.out 2>&1 & ); sleep 1
$P -f /tmp/conc_b.sql > /tmp/conc_b.out 2>&1 || true; sleep 3
echo "Client A : $(cat /tmp/conc_a.out)"; echo "Client B : $(grep -m1 -E 'ERROR|RESULT' /tmp/conc_b.out)"
$P -c "select 'état final → stock='||stock_quantity||' réservé='||reserved_quantity||' disponible='||available_quantity from product_variants where sku='DEMO-002-STD'"
grep -q "OUT_OF_STOCK" /tmp/conc_b.out && echo "OK : une seule commande a réservé la dernière unité." || { echo "ÉCHEC : survente possible"; exit 1; }
