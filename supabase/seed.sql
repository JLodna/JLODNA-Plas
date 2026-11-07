-- JLODNA Plas — données de démonstration (OPTIONNEL). Tout est repérable : sku 'DEMO-%' / slug 'demo-%'.
-- Supprimer la démo :  delete from public.products where sku like 'DEMO-%';  delete from public.categories where slug like 'demo-%';
-- (la suppression d'un produit supprime ses variantes ; refusée si des commandes en cours réservent du stock)
insert into public.categories(name, slug, sort_order) values
 ('Électronique','demo-electronique',1),('Maison','demo-maison',2),('Mode','demo-mode',3),('Beauté','demo-beaute',4)
on conflict (slug) do nothing;

with c as (select id, slug from public.categories where slug like 'demo-%')
insert into public.products(name, slug, description, price, sale_price, category_id, sku, status, is_featured, is_on_sale)
select v.name, v.slug, v.descr, v.price, v.sale, (select id from c where c.slug = v.cat), v.sku, 'published', v.feat, v.sale is not null
from (values
 ('Écouteurs sans fil','demo-ecouteurs','Écouteurs Bluetooth avec boîtier de charge.',2500,1990,'demo-electronique','DEMO-001',true),
 ('Lampe LED rechargeable','demo-lampe-led','Lampe LED rechargeable USB, idéale pendant les coupures de courant.',1200,null,'demo-maison','DEMO-002',true),
 ('T-shirt coton','demo-tshirt','T-shirt 100 % coton, coupe classique.',900,750,'demo-mode','DEMO-003',false),
 ('Crème hydratante','demo-creme','Crème hydratante visage et corps, 200 ml.',650,null,'demo-beaute','DEMO-004',false)
) as v(name, slug, descr, price, sale, cat, sku, feat)
on conflict (slug) do nothing;

insert into public.product_variants(product_id, sku, name, attributes, stock_quantity, low_stock_threshold, sort_order)
select p.id, v.sku, v.name, v.attrs::jsonb, v.stock, 5, v.ord
from (values
 ('demo-ecouteurs','DEMO-001-NOIR','Noir','{"Couleur":"Noir"}',12,1),
 ('demo-ecouteurs','DEMO-001-BLANC','Blanc','{"Couleur":"Blanc"}',8,2),
 ('demo-lampe-led','DEMO-002-STD','Standard','{}',20,1),
 ('demo-tshirt','DEMO-003-S','S','{"Taille":"S"}',10,1),
 ('demo-tshirt','DEMO-003-M','M','{"Taille":"M"}',15,2),
 ('demo-tshirt','DEMO-003-L','L','{"Taille":"L"}',6,3),
 ('demo-tshirt','DEMO-003-XL','XL','{"Taille":"XL"}',0,4),
 ('demo-creme','DEMO-004-STD','Standard','{}',20,1)
) as v(slug, sku, name, attrs, stock, ord)
join public.products p on p.slug = v.slug
on conflict do nothing;
