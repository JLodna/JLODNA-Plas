-- JLODNA Plas — MIGRATION 001 : variantes en table, stock réservé/disponible, avis modérés.
-- À utiliser UNIQUEMENT si votre base a été créée avec la version précédente (variantes en JSON, table inventory).
-- Base neuve : ignorez ce fichier et suivez le README (schema → functions → triggers → policies → seed).
--
-- PROCÉDURE (sur une base existante) :
--   1. Faire une sauvegarde (Supabase → Database → Backups) ou tester d'abord sur une copie.
--   2. Exécuter CE fichier en entier.
--   3. Exécuter ensuite, dans l'ordre : functions.sql → triggers.sql → policies.sql.
--   4. Vérifier : Admin → Stock (répartir le stock des produits à variantes, voir la note ci-dessous).
--
-- Ce que fait la migration :
--   • chaque produit reçoit au moins une variante ; les options JSON deviennent des variantes (toutes les combinaisons) ;
--   • le stock du produit est mis sur la 1re variante (les autres à 0) : AUCUN risque de survente, mais il faut répartir le stock réel
--     entre les variantes dans l'admin ; les commandes en cours (ni livrées ni annulées) deviennent des réservations ;
--   • order_items est rattaché à sa variante (par attributs, sinon 1re variante) ; avis : visibles → approved, masqués → rejected ;
--   • les paniers enregistrés en base sont vidés (ils sont recréés par variante) ; les anciens paniers navigateur sont ignorés.
begin;

-- 0) anciennes politiques RLS (policies.sql les recrée)
do $$ declare r record; begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop; end $$;

-- 1) table des variantes (identique à schema.sql)
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text unique,
  name text not null check (char_length(name) between 1 and 200),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  price numeric(12,2) check (price is null or price >= 0),            -- null = prix du produit
  sale_price numeric(12,2) check (sale_price is null or sale_price >= 0),
  stock_quantity int not null default 0 check (stock_quantity >= 0),     -- stock physique
  reserved_quantity int not null default 0 check (reserved_quantity >= 0), -- réservé par les commandes en cours
  available_quantity int generated always as (stock_quantity - reserved_quantity) stored,
  low_stock_threshold int not null default 5 check (low_stock_threshold >= 0),
  status text not null default 'active' check (status in ('active','disabled')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint variant_reserved_le_stock check (reserved_quantity <= stock_quantity),
  constraint variant_sale_lt_price check (sale_price is null or price is null or sale_price < price)
);
create index if not exists variants_product_idx on public.product_variants(product_id);
create unique index if not exists variants_unique_attrs on public.product_variants(product_id, attributes);

-- 2) variantes à partir du JSON + stock de l'ancienne table inventory
do $$
declare r record; g jsonb; c jsonb; nc jsonb; combos jsonb; opt text; n int;
begin
  for r in select p.id, p.variants, i.quantity, i.low_stock_threshold from public.products p left join public.inventory i on i.product_id = p.id loop
    combos := '[{}]'::jsonb;
    for g in select * from jsonb_array_elements(coalesce(r.variants, '[]'::jsonb)) loop
      if coalesce(g->>'name', '') = '' or jsonb_array_length(coalesce(g->'options', '[]'::jsonb)) = 0 then continue; end if;
      nc := '[]'::jsonb;
      for c in select * from jsonb_array_elements(combos) loop
        for opt in select jsonb_array_elements_text(g->'options') loop
          nc := nc || jsonb_build_array(c || jsonb_build_object(g->>'name', opt));
        end loop;
      end loop;
      combos := nc;
    end loop;
    n := 0;
    for c in select * from jsonb_array_elements(combos) loop
      n := n + 1;
      insert into public.product_variants(product_id, name, attributes, stock_quantity, low_stock_threshold, sort_order)
      values (r.id, case when c = '{}'::jsonb then 'Standard' else (select string_agg(value, ' / ') from jsonb_each_text(c)) end, c,
              case when n = 1 then coalesce(r.quantity, 0) else 0 end, coalesce(r.low_stock_threshold, 5), n)
      on conflict do nothing;
    end loop;
  end loop;
end $$;

-- 3) mouvements de stock
alter table public.inventory_movements rename column delta to stock_delta;
alter table public.inventory_movements rename column quantity_after to stock_after;
alter table public.inventory_movements
  add column variant_id uuid references public.product_variants(id) on delete set null,
  add column type text not null default 'adjust' check (type in ('initial','adjust','reserve','release','sale','restock')),
  add column reserved_delta int not null default 0,
  add column reserved_after int not null default 0;
alter table public.inventory_movements alter column stock_delta set default 0;
update public.inventory_movements m set variant_id = (select v.id from public.product_variants v where v.product_id = m.product_id order by v.sort_order, v.created_at limit 1);
update public.inventory_movements set type = case when reason like 'Commande %' then 'sale' when reason like 'Annulation %' then 'restock' when reason = 'Stock initial' then 'initial' else 'adjust' end;
create index if not exists inv_mov_variant_idx on public.inventory_movements(variant_id, created_at desc);

-- 4) order_items : variante identifiable
alter table public.order_items
  add column variant_id uuid references public.product_variants(id) on delete set null,
  add column variant_name text;
create index if not exists order_items_variant_idx on public.order_items(variant_id);
update public.order_items oi set variant_id = coalesce(
  (select v.id from public.product_variants v where v.product_id = oi.product_id and v.attributes = coalesce(oi.variant, '{}'::jsonb) limit 1),
  (select v.id from public.product_variants v where v.product_id = oi.product_id order by v.sort_order limit 1))
 where oi.product_id is not null;
update public.order_items oi set variant_name = (select v.name from public.product_variants v where v.id = oi.variant_id) where oi.variant_id is not null;

-- 5) commandes en cours : l'ancien modèle avait déjà retiré le stock à la création → on le remet en stock PHYSIQUE et en RÉSERVÉ
update public.product_variants v set
  stock_quantity = v.stock_quantity + x.q, reserved_quantity = v.reserved_quantity + x.q
  from (select oi.variant_id, sum(oi.quantity)::int q from public.order_items oi join public.orders o on o.id = oi.order_id
         where o.status not in ('delivered','cancelled') and oi.variant_id is not null group by oi.variant_id) x
 where v.id = x.variant_id;

-- 6) paniers par variante (données transitoires : recréées)
drop table public.cart_items;
create table if not exists public.cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null check (quantity > 0 and quantity <= 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);

-- 7) avis modérés
alter table public.reviews add column status text not null default 'pending' check (status in ('pending','approved','rejected'));
update public.reviews set status = case when is_visible then 'approved' else 'rejected' end;
alter table public.reviews drop column is_visible;
create index if not exists reviews_product_status_idx on public.reviews(product_id, status);

-- 8) nettoyage de l'ancien modèle
alter table public.products drop column variants;
drop table public.inventory cascade;
drop function if exists public.admin_set_stock(uuid, int, text, int);

-- 9) permissions et realtime
insert into public.admin_permissions(role, permission) values ('ADMIN','reviews.moderate'),('MANAGER','reviews.moderate'),('SUPPORT','reviews.moderate') on conflict do nothing;
do $$ begin begin alter publication supabase_realtime add table public.product_variants; exception when others then null; end; end $$;

commit;
