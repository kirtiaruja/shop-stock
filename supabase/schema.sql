-- =====================================================================
-- StockPilot – Supabase schema
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query → Run.
-- The FIRST person who signs up becomes Admin automatically.
-- Everyone after that signs up as an inactive Salesman until the Admin
-- activates them (and optionally promotes them) on the Users page.
-- =====================================================================

-- ---------- Roles & profiles ----------------------------------------
do $$ begin
  create type public.app_role as enum ('admin', 'co_admin', 'salesman');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users on delete cascade,
  full_name   text,
  email       text,
  role        public.app_role not null default 'salesman',
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() is not null
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'co_admin'), false)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- New auth user → profile row. First user ever = active admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case when first_user then 'admin'::public.app_role else 'salesman'::public.app_role end,
    first_user
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------- Products (columns follow your Excel export) -------------
create table if not exists public.products (
  id               bigint generated always as identity primary key,
  name             text not null unique,          -- Item name*
  item_code        text unique,                   -- Item code (barcode)
  category         text,                          -- Category
  hsn              text,                          -- HSN
  mrp              numeric(12,2),                 -- Default Mrp
  sale_price       numeric(12,2) not null default 0,  -- Sale price
  purchase_price   numeric(12,2) not null default 0,  -- Purchase price
  online_price     numeric(12,2) not null default 0,  -- Online Store Price
  discount_type    text not null default 'Discount %',-- Discount Type
  sale_discount    numeric(12,2) not null default 0,  -- Sale Discount
  stock            numeric(12,3) not null default 0,  -- Current stock quantity
  min_stock        numeric(12,3) not null default 0,  -- Minimum stock quantity
  location         text,                          -- Item Location
  tax_rate         text,                          -- Tax Rate (e.g. GST@5%)
  inclusive_of_tax boolean not null default false,-- Inclusive Of Tax (Y/N)
  base_unit        text,                          -- Base Unit (x)
  secondary_unit   text,                          -- Secondary Unit (y)
  conversion_rate  numeric(12,3),                 -- Conversion Rate (n)
  is_low           boolean generated always as (stock <= min_stock) stored,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists products_name_idx on public.products (lower(name));

alter table public.products enable row level security;
drop policy if exists "products manager read" on public.products;
create policy "products manager read"   on public.products for select using (public.is_manager());
drop policy if exists "products manager insert" on public.products;
create policy "products manager insert" on public.products for insert with check (public.is_manager());
drop policy if exists "products manager update" on public.products;
create policy "products manager update" on public.products for update using (public.is_manager());
drop policy if exists "products admin delete" on public.products;
create policy "products admin delete"   on public.products for delete using (public.is_admin());

-- Salesmen see products through this view, which hides the purchase price.
create or replace view public.product_catalog as
  select id, name, item_code, category, mrp, sale_price, discount_type,
         sale_discount, stock, min_stock, is_low, tax_rate, base_unit
  from public.products
  where public.is_staff();
grant select on public.product_catalog to authenticated;

-- ---------- Customers ------------------------------------------------
create table if not exists public.customers (
  id          bigint generated always as identity primary key,
  name        text not null,
  contact     text,
  created_by  uuid references auth.users default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.customers enable row level security;
drop policy if exists "customers staff read" on public.customers;
create policy "customers staff read"   on public.customers for select using (public.is_staff());
drop policy if exists "customers staff insert" on public.customers;
create policy "customers staff insert" on public.customers for insert with check (public.is_staff());
drop policy if exists "customers staff update" on public.customers;
create policy "customers staff update" on public.customers for update using (public.is_staff());
drop policy if exists "customers admin delete" on public.customers;
create policy "customers admin delete" on public.customers for delete using (public.is_admin());

-- ---------- Sales ----------------------------------------------------
create table if not exists public.sales (
  id             bigint generated always as identity primary key,  -- bill number
  customer_id    bigint references public.customers on delete set null,
  customer_name  text,
  subtotal       numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  payment_mode   text not null default 'Cash',
  note           text,
  created_by     uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at     timestamptz not null default now()
);
create table if not exists public.sale_items (
  id           bigint generated always as identity primary key,
  sale_id      bigint not null references public.sales on delete cascade,
  product_id   bigint references public.products on delete set null,
  product_name text not null,
  item_code    text,
  qty          numeric(12,3) not null,
  price        numeric(12,2) not null,
  line_total   numeric(12,2) not null
);
create index if not exists sales_created_idx on public.sales (created_at desc);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
-- Managers see all sales, salesmen see the bills they made.
drop policy if exists "sales read" on public.sales;
create policy "sales read" on public.sales for select
  using (public.is_manager() or (public.is_staff() and created_by = auth.uid()));
drop policy if exists "sale items read" on public.sale_items;
create policy "sale items read" on public.sale_items for select
  using (exists (select 1 from public.sales s where s.id = sale_id
                 and (public.is_manager() or (public.is_staff() and s.created_by = auth.uid()))));

-- ---------- Purchases -------------------------------------------------
create table if not exists public.purchases (
  id           bigint generated always as identity primary key,
  supplier     text,
  invoice_no   text,
  total        numeric(12,2) not null default 0,
  note         text,
  created_by   uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at   timestamptz not null default now()
);
create table if not exists public.purchase_items (
  id           bigint generated always as identity primary key,
  purchase_id  bigint not null references public.purchases on delete cascade,
  product_id   bigint references public.products on delete set null,
  product_name text not null,
  item_code    text,
  qty          numeric(12,3) not null,
  cost         numeric(12,2) not null,
  line_total   numeric(12,2) not null
);
create index if not exists purchases_created_idx on public.purchases (created_at desc);
create index if not exists purchase_items_p_idx on public.purchase_items (purchase_id);

alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
drop policy if exists "purchases manager read" on public.purchases;
create policy "purchases manager read" on public.purchases for select using (public.is_manager());
drop policy if exists "purchase items manager read" on public.purchase_items;
create policy "purchase items manager read" on public.purchase_items for select using (public.is_manager());

-- ---------- Business functions (atomic stock updates) -----------------
-- create_sale({customer_id, customer_name, discount, payment_mode, note,
--              items:[{product_id, qty, price}]}) → bill number
create or replace function public.create_sale(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_sale bigint; v_sub numeric := 0; v_disc numeric := coalesce((p->>'discount')::numeric, 0);
  it jsonb; pr record; v_qty numeric; v_price numeric;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Bill has no items'; end if;

  insert into sales (customer_id, customer_name, discount, payment_mode, note, created_by, created_by_name)
  values (nullif(p->>'customer_id', '')::bigint, nullif(p->>'customer_name', ''), v_disc,
          coalesce(nullif(p->>'payment_mode', ''), 'Cash'), nullif(p->>'note', ''), auth.uid(),
          (select full_name from profiles where id = auth.uid()))
  returning id into v_sale;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := (it->>'qty')::numeric; v_price := (it->>'price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if v_price is null or v_price < 0 then raise exception 'Price cannot be negative'; end if;
    select id, name, item_code into pr from products where id = (it->>'product_id')::bigint for update;
    if not found then raise exception 'Product % not found', it->>'product_id'; end if;
    insert into sale_items (sale_id, product_id, product_name, item_code, qty, price, line_total)
    values (v_sale, pr.id, pr.name, pr.item_code, v_qty, v_price, round(v_qty * v_price, 2));
    update products set stock = stock - v_qty, updated_at = now() where id = pr.id;
    v_sub := v_sub + round(v_qty * v_price, 2);
  end loop;

  if v_disc < 0 or v_disc > v_sub then raise exception 'Discount must be between 0 and the bill amount'; end if;
  update sales set subtotal = v_sub, total = v_sub - v_disc where id = v_sale;
  return v_sale;
end $$;

-- create_purchase({supplier, invoice_no, note, update_cost,
--                  items:[{product_id, qty, cost}]}) → purchase id
create or replace function public.create_purchase(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_total numeric := 0; it jsonb; pr record; v_qty numeric; v_cost numeric;
  v_upd boolean := coalesce((p->>'update_cost')::boolean, true);
begin
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can add purchases'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Purchase has no items'; end if;

  insert into purchases (supplier, invoice_no, note, created_by, created_by_name)
  values (nullif(p->>'supplier', ''), nullif(p->>'invoice_no', ''), nullif(p->>'note', ''), auth.uid(),
          (select full_name from profiles where id = auth.uid()))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := (it->>'qty')::numeric; v_cost := (it->>'cost')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Cost cannot be negative'; end if;
    select id, name, item_code into pr from products where id = (it->>'product_id')::bigint for update;
    if not found then raise exception 'Product % not found', it->>'product_id'; end if;
    insert into purchase_items (purchase_id, product_id, product_name, item_code, qty, cost, line_total)
    values (v_id, pr.id, pr.name, pr.item_code, v_qty, v_cost, round(v_qty * v_cost, 2));
    update products set stock = stock + v_qty,
      purchase_price = case when v_upd then v_cost else purchase_price end,
      updated_at = now()
    where id = pr.id;
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;

  update purchases set total = v_total where id = v_id;
  return v_id;
end $$;

-- Admin only: delete a bill and put the stock back.
create or replace function public.delete_sale(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Admin can delete bills'; end if;
  update products pr set stock = pr.stock + si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_id and si.product_id = pr.id;
  delete from sales where id = p_id;
end $$;

-- Admin only: delete a purchase and take the stock back out.
create or replace function public.delete_purchase(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Admin can delete purchases'; end if;
  update products pr set stock = pr.stock - pi.qty, updated_at = now()
    from purchase_items pi where pi.purchase_id = p_id and pi.product_id = pr.id;
  delete from purchases where id = p_id;
end $$;

-- Excel import: match by Item code first, then by Item name; update or insert.
-- rows: [{name, item_code, category, ..., stock}] ; p_update_stock=false keeps current stock of existing items
create or replace function public.import_products(rows jsonb, p_update_stock boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id bigint; ins int := 0; upd int := 0; v_code text; v_name text;
begin
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can import products'; end if;
  for r in select * from jsonb_array_elements(rows) loop
    v_name := trim(r->>'name'); v_code := nullif(trim(coalesce(r->>'item_code', '')), '');
    if v_name is null or v_name = '' then continue; end if;
    v_id := null;
    if v_code is not null then select id into v_id from products where item_code = v_code; end if;
    if v_id is null then select id into v_id from products where lower(name) = lower(v_name); end if;

    if v_id is null then
      insert into products (name, item_code, category, hsn, mrp, sale_price, purchase_price, online_price,
        discount_type, sale_discount, stock, min_stock, location, tax_rate, inclusive_of_tax,
        base_unit, secondary_unit, conversion_rate)
      values (v_name, v_code, nullif(r->>'category', ''), nullif(r->>'hsn', ''),
        (nullif(r->>'mrp', ''))::numeric, coalesce((nullif(r->>'sale_price', ''))::numeric, 0),
        coalesce((nullif(r->>'purchase_price', ''))::numeric, 0), coalesce((nullif(r->>'online_price', ''))::numeric, 0),
        coalesce(nullif(r->>'discount_type', ''), 'Discount %'), coalesce((nullif(r->>'sale_discount', ''))::numeric, 0),
        coalesce((nullif(r->>'stock', ''))::numeric, 0), coalesce((nullif(r->>'min_stock', ''))::numeric, 0),
        nullif(r->>'location', ''), nullif(r->>'tax_rate', ''), coalesce((r->>'inclusive_of_tax')::boolean, false),
        nullif(r->>'base_unit', ''), nullif(r->>'secondary_unit', ''), (nullif(r->>'conversion_rate', ''))::numeric);
      ins := ins + 1;
    else
      update products set
        name = v_name, item_code = coalesce(v_code, item_code),
        category = nullif(r->>'category', ''), hsn = nullif(r->>'hsn', ''),
        mrp = (nullif(r->>'mrp', ''))::numeric,
        sale_price = coalesce((nullif(r->>'sale_price', ''))::numeric, 0),
        purchase_price = coalesce((nullif(r->>'purchase_price', ''))::numeric, 0),
        online_price = coalesce((nullif(r->>'online_price', ''))::numeric, 0),
        discount_type = coalesce(nullif(r->>'discount_type', ''), 'Discount %'),
        sale_discount = coalesce((nullif(r->>'sale_discount', ''))::numeric, 0),
        stock = case when p_update_stock then coalesce((nullif(r->>'stock', ''))::numeric, 0) else stock end,
        min_stock = coalesce((nullif(r->>'min_stock', ''))::numeric, 0),
        location = nullif(r->>'location', ''), tax_rate = nullif(r->>'tax_rate', ''),
        inclusive_of_tax = coalesce((r->>'inclusive_of_tax')::boolean, false),
        base_unit = nullif(r->>'base_unit', ''), secondary_unit = nullif(r->>'secondary_unit', ''),
        conversion_rate = (nullif(r->>'conversion_rate', ''))::numeric,
        updated_at = now()
      where id = v_id;
      upd := upd + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd);
end $$;

-- Dashboard numbers. Salesmen get their own sales only.
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare mgr boolean := public.is_manager(); res jsonb;
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  select jsonb_build_object(
    'today_total', coalesce(sum(total) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0),
    'today_bills', count(*) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'),
    'month_total', coalesce(sum(total) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'), 0)
  ) into res
  from sales where mgr or created_by = auth.uid();

  res := res || jsonb_build_object(
    'products', (select count(*) from products),
    'low_stock', (select count(*) from products where is_low),
    'month_purchase', case when mgr then (select coalesce(sum(total), 0) from purchases
        where created_at >= date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') else null end
  );
  return res;
end $$;

revoke execute on function public.create_sale(jsonb), public.create_purchase(jsonb),
  public.delete_sale(bigint), public.delete_purchase(bigint),
  public.import_products(jsonb, boolean), public.dashboard_stats() from anon, public;
grant execute on function public.create_sale(jsonb), public.create_purchase(jsonb),
  public.delete_sale(bigint), public.delete_purchase(bigint),
  public.import_products(jsonb, boolean), public.dashboard_stats() to authenticated;

-- ---------- API access (row-level security above still decides what each user sees)
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- Tiny function the keep-alive job calls so a free project is not paused in a quiet week.
create or replace function public.ping() returns int language sql stable as $$ select 1 $$;
grant execute on function public.ping() to anon, authenticated;
