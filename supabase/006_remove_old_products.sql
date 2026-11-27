-- =====================================================================
-- StockPilot – 006: remove (hide) old-style products once their stock is 0
-- Run AFTER 004_barcode_wizard.sql. Safe to run again.
--
-- Old-style = a product whose name is not in the simple format: not one of your clothing
-- styles (generic_items, e.g. "JEANS 32 A300") and not starting with an innerwear brand
-- (e.g. "LEHAR LONG 90"). Example of old-style: "MIDAS BERMUDA XL B50".
-- Removing only HIDES a product (archived): it leaves product lists, billing and the
-- dashboard, but its sales / purchase history stays and it can be restored.
-- =====================================================================

alter table public.products add column if not exists archived boolean not null default false;
alter table public.products add column if not exists archived_at timestamptz;
create index if not exists products_archived_idx on public.products (archived);

-- salesmen's product list: hide removed products
create or replace view public.product_catalog as
  select id, name, item_code, category, mrp, sale_price, discount_type,
         sale_discount, stock, min_stock, is_low, tax_rate, base_unit
  from public.products
  where public.is_staff() and not archived;
grant select on public.product_catalog to authenticated;

-- old-style products with no stock left (stock 0 or below), not yet removed
create or replace function public.old_style_products()
returns table (id bigint, name text, item_code text, stock numeric, sale_price numeric, last_sold timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'Not allowed'; end if;
  return query
    select p.id, p.name, p.item_code, p.stock, p.sale_price,
           (select max(s.created_at) from sale_items si join sales s on s.id = si.sale_id where si.product_id = p.id)
    from products p
    where not p.archived
      and p.stock <= 0
      -- simple format: read by the wizard as one of your clothing styles …
      and not exists (select 1 from generic_options g where g.id = p.id)
      and not exists (select 1 from innerwear_options i where i.id = p.id)
      -- … or starts with a clothing style name even without a barcode (e.g. "JEANS 32 A300")
      and not exists (select 1 from generic_items g where upper(trim(p.name)) like g.label_prefix || ' %')
      and not exists (select 1 from generic_aliases a where upper(trim(p.name)) like a.alias_prefix || ' %')
      -- … innerwear always keeps its brand, so anything starting with an innerwear brand is kept
      and upper(split_part(trim(p.name), ' ', 1)) not in (select brand from innerwear_brands union select alias from brand_aliases)
    order by p.name;
end $$;

-- Admin: remove (hide) products — only those with no stock
create or replace function public.archive_products(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only Admin can remove products'; end if;
  update products set archived = true, archived_at = now(), updated_at = now()
  where id = any(p_ids) and not archived and stock <= 0;
  get diagnostics n = row_count;
  return n;
end $$;

-- Admin: bring removed products back
create or replace function public.restore_products(p_ids bigint[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Only Admin can restore products'; end if;
  update products set archived = false, archived_at = null, updated_at = now()
  where id = any(p_ids) and archived;
  get diagnostics n = row_count;
  return n;
end $$;

-- a purchase of a removed product brings it back automatically
create or replace function public.unarchive_on_stock() returns trigger
language plpgsql as $$
begin
  if new.archived and new.stock > 0 then
    new.archived := false;
    new.archived_at := null;
  end if;
  return new;
end $$;
drop trigger if exists products_unarchive_on_stock on public.products;
create trigger products_unarchive_on_stock before update of stock on public.products
  for each row execute function public.unarchive_on_stock();

-- dashboard: don't count removed products
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  mgr boolean := public.is_manager(); res jsonb;
  d0 timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  m0 timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'today_total', coalesce(sum(total) filter (where created_at >= d0), 0),
    'today_bills', count(*) filter (where created_at >= d0),
    'month_total', coalesce(sum(total) filter (where created_at >= m0), 0)
  ) into res
  from sales where mgr or created_by = auth.uid();

  res := res || jsonb_build_object(
    'products', (select count(*) from products where not archived),
    'low_stock', (select count(*) from products where is_low and not archived),
    'receivable', (select coalesce(sum(due_amount), 0) from sales where due_amount > 0),
    'month_purchase', case when mgr then (select coalesce(sum(total), 0) from purchases where created_at >= m0) end,
    'payable', case when mgr then (select coalesce(sum(due_amount), 0) from purchases where due_amount > 0) end,
    'today_in', case when mgr then (select coalesce(sum(amount), 0) from payments where direction = 'in' and created_at >= d0) end,
    'today_out', case when mgr then (select coalesce(sum(amount), 0) from payments where direction = 'out' and created_at >= d0) end
  );
  return res;
end $$;

revoke execute on function public.old_style_products(), public.archive_products(bigint[]), public.restore_products(bigint[]) from anon, public;
grant execute on function public.old_style_products(), public.archive_products(bigint[]), public.restore_products(bigint[]) to authenticated;
