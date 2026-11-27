-- =====================================================================
-- StockPilot – 003: product history + stock change log
-- Run AFTER schema.sql and 002_credit_payments.sql. Safe to run again.
--
-- Every stock change is now explainable:
--   sales / purchases       → from sale_items / purchase_items (already stored)
--   manual edits, Excel imports, opening stock → logged in stock_adjustments
-- product_history(id) returns all of them for one product, newest first.
-- =====================================================================

create table if not exists public.stock_adjustments (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references public.products on delete cascade,
  old_stock    numeric(12,3) not null,
  new_stock    numeric(12,3) not null,
  change       numeric(12,3) generated always as (new_stock - old_stock) stored,
  reason       text not null,
  created_by   uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at   timestamptz not null default now()
);
create index if not exists stock_adj_product_idx on public.stock_adjustments (product_id, created_at desc);

alter table public.stock_adjustments enable row level security;
drop policy if exists "stock adj manager read" on public.stock_adjustments;
create policy "stock adj manager read" on public.stock_adjustments for select using (public.is_manager());
-- written only by the trigger below

-- Log any stock change that does not come from a bill.
-- Sale / purchase functions set stockpilot.src = 'bill' (those are already in sale_items / purchase_items);
-- the Excel import sets 'import'; anything else is a manual edit.
create or replace function public.log_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare src text := coalesce(nullif(current_setting('stockpilot.src', true), ''), 'manual');
begin
  if src = 'bill' then return null; end if;
  if tg_op = 'INSERT' then
    if new.stock <> 0 then
      insert into stock_adjustments (product_id, old_stock, new_stock, reason, created_by, created_by_name)
      values (new.id, 0, new.stock,
              case when src = 'import' then 'Opening stock (Excel import)' else 'Opening stock' end,
              auth.uid(), (select full_name from profiles where id = auth.uid()));
    end if;
  elsif new.stock is distinct from old.stock then
    insert into stock_adjustments (product_id, old_stock, new_stock, reason, created_by, created_by_name)
    values (new.id, old.stock, new.stock,
            case when src = 'import' then 'Excel import' else 'Manual stock edit' end,
            auth.uid(), (select full_name from profiles where id = auth.uid()));
  end if;
  return null;
end $$;

drop trigger if exists products_stock_log on public.products;
create trigger products_stock_log after insert or update of stock on public.products
  for each row execute function public.log_stock_change();

-- ---------- Same functions as before, now marking their stock changes ----------
create or replace function public.create_sale(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_sale bigint; v_sub numeric := 0; v_disc numeric := coalesce((p->>'discount')::numeric, 0);
  it jsonb; pr record; v_qty numeric; v_price numeric; v_total numeric; v_paid numeric;
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_cust bigint := nullif(p->>'customer_id', '')::bigint;
  v_cname text := nullif(p->>'customer_name', '');
  v_me text := (select full_name from profiles where id = auth.uid());
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Bill has no items'; end if;
  if v_cust is not null then select name into v_cname from customers where id = v_cust; end if;

  insert into sales (customer_id, customer_name, discount, payment_mode, note, created_by, created_by_name)
  values (v_cust, v_cname, v_disc, v_mode, nullif(p->>'note', ''), auth.uid(), v_me)
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
  v_total := v_sub - v_disc;
  v_paid := coalesce((nullif(p->>'paid_amount', ''))::numeric, v_total);
  if v_paid < 0 or v_paid > v_total then raise exception 'Amount paid must be between 0 and the bill total'; end if;
  if v_paid < v_total and v_cust is null then raise exception 'Select a customer for a credit (udhaar) bill'; end if;

  update sales set subtotal = v_sub, total = v_total,
    payment_mode = case when v_paid < v_total then 'Credit' else v_mode end
  where id = v_sale;

  if v_paid > 0 then
    insert into payments (direction, sale_id, customer_id, party_name, amount, mode, note, created_by, created_by_name)
    values ('in', v_sale, v_cust, v_cname, v_paid, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid at billing', auth.uid(), v_me);
  end if;
  return v_sale;
end $$;

create or replace function public.create_purchase(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_total numeric := 0; it jsonb; pr record; v_qty numeric; v_cost numeric; v_paid numeric;
  v_upd boolean := coalesce((p->>'update_cost')::boolean, true);
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_sup bigint := nullif(p->>'supplier_id', '')::bigint;
  v_sname text := nullif(p->>'supplier', '');
  v_me text := (select full_name from profiles where id = auth.uid());
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can add purchases'; end if;
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Purchase has no items'; end if;
  if v_sup is not null then select name into v_sname from suppliers where id = v_sup; end if;

  insert into purchases (supplier_id, supplier, invoice_no, note, payment_mode, created_by, created_by_name)
  values (v_sup, v_sname, nullif(p->>'invoice_no', ''), nullif(p->>'note', ''), v_mode, auth.uid(), v_me)
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

  v_paid := coalesce((nullif(p->>'paid_amount', ''))::numeric, v_total);
  if v_paid < 0 or v_paid > v_total then raise exception 'Amount paid must be between 0 and the purchase total'; end if;
  if v_paid < v_total and v_sup is null then raise exception 'Select a supplier for a credit purchase'; end if;

  update purchases set total = v_total,
    payment_mode = case when v_paid < v_total then 'Credit' else v_mode end
  where id = v_id;

  if v_paid > 0 then
    insert into payments (direction, purchase_id, supplier_id, party_name, amount, mode, note, created_by, created_by_name)
    values ('out', v_id, v_sup, v_sname, v_paid, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid at purchase', auth.uid(), v_me);
  end if;
  return v_id;
end $$;

create or replace function public.delete_sale(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_admin() then raise exception 'Only Admin can delete bills'; end if;
  update products pr set stock = pr.stock + si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_id and si.product_id = pr.id;
  delete from sales where id = p_id;
end $$;

create or replace function public.delete_purchase(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_admin() then raise exception 'Only Admin can delete purchases'; end if;
  update products pr set stock = pr.stock - pi.qty, updated_at = now()
    from purchase_items pi where pi.purchase_id = p_id and pi.product_id = pr.id;
  delete from purchases where id = p_id;
end $$;

create or replace function public.import_products(rows jsonb, p_update_stock boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id bigint; ins int := 0; upd int := 0; v_code text; v_name text;
begin
  perform set_config('stockpilot.src', 'import', true);
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

-- ---------- Product history ----------------------------------------------
-- kind: 'sale' (qty negative), 'purchase' (qty positive), 'adjust' (qty = change)
-- Admin / Co-admin see everything. Salesmen see only the bills they made.
create or replace function public.product_history(p_id bigint, p_limit int default 500)
returns table (at timestamptz, kind text, ref_id bigint, party text, qty numeric, rate numeric, amount numeric, note text, by_name text)
language plpgsql stable security definer set search_path = public as $$
declare mgr boolean := public.is_manager();
begin
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  return query
  select * from (
    select s.created_at, 'sale'::text, s.id, coalesce(s.customer_name, 'Walk-in'), -si.qty, si.price, si.line_total,
           case when s.due_amount > 0 then 'Due ₹' || s.due_amount::text else null end, s.created_by_name
      from sale_items si join sales s on s.id = si.sale_id
      where si.product_id = p_id and (mgr or s.created_by = auth.uid())
    union all
    select pu.created_at, 'purchase', pu.id, coalesce(pu.supplier, 'No supplier'), pi.qty, pi.cost, pi.line_total,
           case when pu.invoice_no is not null then 'Inv ' || pu.invoice_no else null end, pu.created_by_name
      from purchase_items pi join purchases pu on pu.id = pi.purchase_id
      where pi.product_id = p_id and mgr
    union all
    select a.created_at, 'adjust', a.id, null, a.change, null, null,
           a.reason || ' (' || trim(to_char(a.old_stock, 'FM999999990.###')) || ' → ' || trim(to_char(a.new_stock, 'FM999999990.###')) || ')',
           a.created_by_name
      from stock_adjustments a
      where a.product_id = p_id and mgr
  ) h
  order by 1 desc
  limit p_limit;
end $$;

revoke execute on function public.product_history(bigint, int) from anon, public;
grant execute on function public.product_history(bigint, int) to authenticated;
grant select on public.stock_adjustments to authenticated;
revoke all on public.stock_adjustments from anon;
