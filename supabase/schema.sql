-- JLODNA Plas — schéma PostgreSQL (Supabase).
-- ORDRE D'EXÉCUTION : schema.sql → functions.sql → triggers.sql → policies.sql → seed.sql (optionnel)
create extension if not exists "pgcrypto";

-- ========== Tables ==========
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text, last_name text, email text, phone text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.admin_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN','ADMIN','MANAGER','EDITOR','SUPPORT')),
  created_at timestamptz not null default now()
);
create table if not exists public.admin_permissions (
  role text not null check (role in ('SUPER_ADMIN','ADMIN','MANAGER','EDITOR','SUPPORT')),
  permission text not null,
  primary key (role, permission)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  image_url text, parent_id uuid references public.categories(id) on delete set null,
  is_active boolean not null default true, sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 200),
  slug text not null unique,
  description text,
  price numeric(12,2) not null check (price >= 0),
  sale_price numeric(12,2) check (sale_price is null or (sale_price >= 0 and sale_price < price)),
  category_id uuid references public.categories(id) on delete set null,
  sku text unique,
  weight_grams int check (weight_grams is null or weight_grams >= 0),
  status text not null default 'draft' check (status in ('draft','published','disabled')),
  is_featured boolean not null default false,
  is_on_sale boolean not null default false,
  sold_count int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists products_status_idx on public.products(status);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists products_name_idx on public.products using gin (to_tsvector('simple', name));

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  url text not null, alt text, sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_images_product_idx on public.product_images(product_id);

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

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  type text not null check (type in ('initial','adjust','reserve','release','sale','restock')),
  stock_delta int not null default 0, reserved_delta int not null default 0,
  stock_after int not null, reserved_after int not null,
  reason text not null, order_id uuid, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inv_mov_product_idx on public.inventory_movements(product_id, created_at desc);
create index if not exists inv_mov_variant_idx on public.inventory_movements(variant_id, created_at desc);

create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text, full_name text not null, phone text not null,
  address text not null, city text not null, department text not null, notes text,
  is_default boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, type text not null check (type in ('percent','fixed')),
  value numeric(12,2) not null check (value > 0),
  min_subtotal numeric(12,2) not null default 0, max_uses int, used_count int not null default 0,
  expires_at timestamptz, is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence if not exists public.order_number_seq start 1;
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'new' check (status in ('new','confirmed','preparing','shipped','out_for_delivery','delivered','cancelled')),
  payment_method text not null default 'cod',
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','failed','refunded')),
  subtotal numeric(12,2) not null, shipping_fee numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0, total numeric(12,2) not null,
  coupon_code text, currency text not null default 'HTG',
  full_name text not null, phone text not null, email text not null,
  address text not null, city text not null, department text not null, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on public.orders(user_id, created_at desc);
create index if not exists orders_status_idx on public.orders(status);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  variant_id uuid references public.product_variants(id) on delete set null,
  name text not null, variant_name text, sku text, image_url text, variant jsonb, -- variant = attributs figés à la commande
  unit_price numeric(12,2) not null, quantity int not null check (quantity > 0)
);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_variant_idx on public.order_items(variant_id);

-- Paiements : une ligne par tentative/mode de paiement d'une commande (aucun paiement simulé : 'pending' tant qu'aucune passerelle ne confirme).
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method text not null, amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  provider_ref text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments(order_id);

-- Historique d'utilisation des coupons.
create table if not exists public.coupon_usages (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  discount numeric(12,2) not null, created_at timestamptz not null default now(),
  unique (order_id)
);

create table if not exists public.cart_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity int not null check (quantity > 0 and quantity <= 99),
  updated_at timestamptz not null default now(),
  primary key (user_id, variant_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  audience text not null default 'customer' check (audience in ('customer','admin')),
  type text not null, title text not null, body text, link text,
  is_read boolean not null default false, created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null, rating int not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 1000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')), created_at timestamptz not null default now(),
  unique (product_id, user_id)
);

create index if not exists reviews_product_status_idx on public.reviews(product_id, status);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  subject text, body text not null check (char_length(body) between 5 and 4000),
  is_read boolean not null default false, created_at timestamptz not null default now()
);

create table if not exists public.newsletter (
  email text primary key check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'), created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid, user_email text, action text not null, entity text, entity_id text,
  details jsonb, created_at timestamptz not null default now()
);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);

create table if not exists public.settings (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);














-- ========== Données de base (pas de démo) ==========
insert into public.admin_permissions(role, permission) values
 ('ADMIN','products.write'),('ADMIN','categories.write'),('ADMIN','orders.write'),('ADMIN','inventory.write'),('ADMIN','coupons.write'),('ADMIN','customers.read'),('ADMIN','messages.write'),('ADMIN','settings.write'),('ADMIN','audit.read'),
 ('MANAGER','products.write'),('MANAGER','categories.write'),('MANAGER','orders.write'),('MANAGER','inventory.write'),('MANAGER','coupons.write'),('MANAGER','customers.read'),('MANAGER','messages.write'),
 ('EDITOR','products.write'),('EDITOR','categories.write'),
 ('ADMIN','reviews.moderate'),('MANAGER','reviews.moderate'),('SUPPORT','reviews.moderate'),
 ('SUPPORT','orders.write'),('SUPPORT','customers.read'),('SUPPORT','messages.write')
on conflict do nothing;

insert into public.settings(key, value) values
 ('bootstrap_admin_email', '"jlodnaplas@gmail.com"'),
 ('store', '{"name":"JLODNA Plas","tagline":"Magazin global en Haïti","email":"jloodna@gmail.com","phone":"","currency":"HTG"}'),
 ('shipping', '{"flat_fee":250,"free_over":5000}'),
 ('payment_methods', '{"cod":{"enabled":true,"label":"Paiement à la livraison"},"moncash":{"enabled":false,"label":"MonCash"},"natcash":{"enabled":false,"label":"NatCash"},"card":{"enabled":false,"label":"Carte bancaire"},"paypal":{"enabled":false,"label":"PayPal"}}')
on conflict (key) do nothing;

-- ========== Realtime ==========
do $$ begin
  begin alter publication supabase_realtime add table public.notifications; exception when others then null; end;
  begin alter publication supabase_realtime add table public.orders; exception when others then null; end;
  begin alter publication supabase_realtime add table public.products; exception when others then null; end;
  begin alter publication supabase_realtime add table public.product_variants; exception when others then null; end;
  begin alter publication supabase_realtime add table public.messages; exception when others then null; end;
end $$;
