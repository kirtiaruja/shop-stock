-- =====================================================================
-- StockPilot – 002: credit (udhaar) + payments ledger + suppliers
-- Run AFTER schema.sql, in Supabase → SQL Editor. Safe to run again.
--
-- Every rupee that comes in or goes out is a row in `payments`, linked to
-- a bill number (sale) or purchase number:
--   direction 'in'  = money received from a customer against a sale bill
--   direction 'out' = money paid to a supplier against a purchase
-- Each bill's paid_amount is kept in sync from its payments automatically;
-- due_amount = total - paid_amount.
-- =====================================================================

-- ---------- Suppliers (name + contact, like customers) ----------------
create table if not exists public.suppliers (
  id          bigint generated always as identity primary key,
  name        text not null,
  contact     text,
  created_by  uuid references auth.users default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.suppliers enable row level security;
drop policy if exists "suppliers manager read" on public.suppliers;
create policy "suppliers manager read"   on public.suppliers for select using (public.is_manager());
drop policy if exists "suppliers manager insert" on public.suppliers;
create policy "suppliers manager insert" on public.suppliers for insert with check (public.is_manager());
drop policy if exists "suppliers manager update" on public.suppliers;
create policy "suppliers manager update" on public.suppliers for update using (public.is_manager());
drop policy if exists "suppliers admin delete" on public.suppliers;
create policy "suppliers admin delete"   on public.suppliers for delete using (public.is_admin());

-- ---------- Paid / due on bills ---------------------------------------
alter table public.sales add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.sales add column if not exists due_amount numeric(12,2)
  generated always as (total - paid_amount) stored;

alter table public.purchases add column if not exists supplier_id bigint references public.suppliers on delete set null;
alter table public.purchases add column if not exists payment_mode text not null default 'Cash';
alter table public.purchases add column if not exists paid_amount numeric(12,2) not null default 0;
alter table public.purchases add column if not exists due_amount numeric(12,2)
  generated always as (total - paid_amount) stored;

create index if not exists sales_due_idx on public.sales (customer_id) where due_amount > 0;
create index if not exists purchases_due_idx on public.purchases (supplier_id) where due_amount > 0;

-- ---------- Payments ledger -------------------------------------------
create table if not exists public.payments (
  id           bigint generated always as identity primary key,
  direction    text not null check (direction in ('in', 'out')),
  sale_id      bigint references public.sales on delete cascade,
  purchase_id  bigint references public.purchases on delete cascade,
  customer_id  bigint references public.customers on delete set null,
  supplier_id  bigint references public.suppliers on delete set null,
  party_name   text,
  amount       numeric(12,2) not null check (amount > 0),
  mode         text not null default 'Cash',
  note         text,
  created_by   uuid references auth.users default auth.uid(),
  created_by_name text,
  created_at   timestamptz not null default now(),
  constraint payment_has_one_bill check (
    (direction = 'in'  and sale_id is not null and purchase_id is null) or
    (direction = 'out' and purchase_id is not null and sale_id is null))
);
create index if not exists payments_created_idx on public.payments (created_at desc);
create index if not exists payments_sale_idx on public.payments (sale_id);
create index if not exists payments_purchase_idx on public.payments (purchase_id);

alter table public.payments enable row level security;
-- Managers see the whole ledger; salesmen see payments they collected.
drop policy if exists "payments read" on public.payments;
create policy "payments read" on public.payments for select
  using (public.is_manager() or (public.is_staff() and direction = 'in' and created_by = auth.uid()));
-- No insert/update/delete policies: payments are only written by the functions below.

-- Keep bills' paid_amount equal to the sum of their payments.
create or replace function public.sync_paid_amount() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select * from (values (coalesce(new.sale_id, old.sale_id)), (old.sale_id)) v(id) where id is not null loop
    update sales set paid_amount = coalesce((select sum(amount) from payments where sale_id = r.id), 0) where id = r.id;
  end loop;
  for r in select * from (values (coalesce(new.purchase_id, old.purchase_id)), (old.purchase_id)) v(id) where id is not null loop
    update purchases set paid_amount = coalesce((select sum(amount) from payments where purchase_id = r.id), 0) where id = r.id;
  end loop;
  return null;
end $$;

drop trigger if exists payments_sync on public.payments;
create trigger payments_sync after insert or update or delete on public.payments
  for each row execute function public.sync_paid_amount();

-- Bills made before this migration were fully paid unless marked Credit.
do $$ begin
  if not exists (select 1 from public.payments) then
    insert into public.payments (direction, sale_id, customer_id, party_name, amount, mode, created_by, created_by_name, created_at, note)
      select 'in', id, customer_id, customer_name, total, payment_mode, created_by, created_by_name, created_at, 'Opening entry'
      from public.sales where total > 0 and payment_mode <> 'Credit';
    insert into public.payments (direction, purchase_id, party_name, amount, mode, created_by, created_by_name, created_at, note)
      select 'out', id, supplier, total, 'Cash', created_by, created_by_name, created_at, 'Opening entry'
      from public.purchases where total > 0;
  end if;
end $$;

-- ---------- Sale with credit ------------------------------------------
-- p: {customer_id, customer_name, discount, payment_mode, paid_amount, note,
--     items:[{product_id, qty, price}]}
-- paid_amount omitted = fully paid. Anything less than the total needs a customer.
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

-- ---------- Purchase with credit --------------------------------------
-- p: {supplier_id, supplier, invoice_no, note, update_cost, payment_mode, paid_amount,
--     items:[{product_id, qty, cost}]}
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

-- ---------- Record a payment later ------------------------------------
-- p: {kind:'sale'|'purchase', bill_id?, party_id?, amount, mode, note}
-- With bill_id the whole amount goes to that bill.
-- With only party_id (customer / supplier) it is spread over their unpaid bills, oldest first.
-- Returns [{bill_id, amount, payment_id}] — one payment row per bill touched.
create or replace function public.record_payment(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p->>'kind';
  v_amount numeric := (p->>'amount')::numeric;
  v_left numeric; v_bill bigint := nullif(p->>'bill_id', '')::bigint;
  v_party bigint := nullif(p->>'party_id', '')::bigint;
  v_mode text := coalesce(nullif(p->>'mode', ''), 'Cash');
  v_note text := nullif(p->>'note', '');
  v_me text := (select full_name from profiles where id = auth.uid());
  b record; v_take numeric; v_pid bigint; v_out jsonb := '[]'; v_due numeric;
begin
  if v_kind not in ('sale', 'purchase') then raise exception 'kind must be sale or purchase'; end if;
  if v_kind = 'sale' and not public.is_staff() then raise exception 'Not allowed'; end if;
  if v_kind = 'purchase' and not public.is_manager() then raise exception 'Only Admin / Co-admin can pay suppliers'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Amount must be more than 0'; end if;
  if v_mode = 'Credit' then raise exception 'Choose how the money was paid (Cash, UPI…)'; end if;
  if v_bill is null and v_party is null then raise exception 'Choose a bill or a customer / supplier'; end if;

  if v_kind = 'sale' then
    select coalesce(sum(due_amount), 0) into v_due from sales
      where due_amount > 0 and (id = v_bill or (v_bill is null and customer_id = v_party));
  else
    select coalesce(sum(due_amount), 0) into v_due from purchases
      where due_amount > 0 and (id = v_bill or (v_bill is null and supplier_id = v_party));
  end if;
  if v_due = 0 then raise exception 'Nothing is due'; end if;
  if v_amount > v_due then raise exception 'Amount is more than the balance due (₹%)', v_due; end if;

  v_left := v_amount;
  if v_kind = 'sale' then
    for b in select id, customer_id, customer_name as pname, due_amount from sales
             where due_amount > 0 and (id = v_bill or (v_bill is null and customer_id = v_party))
             order by created_at, id for update loop
      exit when v_left <= 0;
      v_take := least(v_left, b.due_amount);
      insert into payments (direction, sale_id, customer_id, party_name, amount, mode, note, created_by, created_by_name)
      values ('in', b.id, b.customer_id, b.pname, v_take, v_mode, v_note, auth.uid(), v_me) returning id into v_pid;
      v_out := v_out || jsonb_build_object('bill_id', b.id, 'amount', v_take, 'payment_id', v_pid);
      v_left := v_left - v_take;
    end loop;
  else
    for b in select id, supplier_id, supplier as pname, due_amount from purchases
             where due_amount > 0 and (id = v_bill or (v_bill is null and supplier_id = v_party))
             order by created_at, id for update loop
      exit when v_left <= 0;
      v_take := least(v_left, b.due_amount);
      insert into payments (direction, purchase_id, supplier_id, party_name, amount, mode, note, created_by, created_by_name)
      values ('out', b.id, b.supplier_id, b.pname, v_take, v_mode, v_note, auth.uid(), v_me) returning id into v_pid;
      v_out := v_out || jsonb_build_object('bill_id', b.id, 'amount', v_take, 'payment_id', v_pid);
      v_left := v_left - v_take;
    end loop;
  end if;
  return v_out;
end $$;

-- Admin only: remove a wrong payment entry (the bill's due goes back up).
create or replace function public.delete_payment(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only Admin can delete payments'; end if;
  delete from payments where id = p_id;
end $$;

-- ---------- Balances ---------------------------------------------------
-- Outstanding per customer ('sale') or supplier ('purchase'). Salesmen may see customer dues.
create or replace function public.party_balances(p_kind text)
returns table (party_id bigint, name text, contact text, bills bigint, total numeric, paid numeric, due numeric, oldest timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind = 'sale' then
    if not public.is_staff() then raise exception 'Not allowed'; end if;
    return query
      select c.id, c.name, c.contact, count(s.id), sum(s.total), sum(s.paid_amount), sum(s.due_amount), min(s.created_at)
      from sales s join customers c on c.id = s.customer_id
      where s.due_amount > 0 group by c.id order by sum(s.due_amount) desc;
  elsif p_kind = 'purchase' then
    if not public.is_manager() then raise exception 'Not allowed'; end if;
    return query
      select x.id, x.name, x.contact, count(pu.id), sum(pu.total), sum(pu.paid_amount), sum(pu.due_amount), min(pu.created_at)
      from purchases pu join suppliers x on x.id = pu.supplier_id
      where pu.due_amount > 0 group by x.id order by sum(pu.due_amount) desc;
  else
    raise exception 'kind must be sale or purchase';
  end if;
end $$;

-- Unpaid bills of one customer / supplier.
create or replace function public.open_bills(p_kind text, p_party bigint)
returns table (bill_id bigint, created_at timestamptz, total numeric, paid numeric, due numeric, ref text)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind = 'sale' then
    if not public.is_staff() then raise exception 'Not allowed'; end if;
    return query select s.id, s.created_at, s.total, s.paid_amount, s.due_amount, null::text
      from sales s where s.customer_id = p_party and s.due_amount > 0 order by s.created_at;
  else
    if not public.is_manager() then raise exception 'Not allowed'; end if;
    return query select pu.id, pu.created_at, pu.total, pu.paid_amount, pu.due_amount, pu.invoice_no
      from purchases pu where pu.supplier_id = p_party and pu.due_amount > 0 order by pu.created_at;
  end if;
end $$;

-- Payments of one bill — callable by anyone who can see that bill.
create or replace function public.bill_payments(p_kind text, p_bill bigint)
returns setof public.payments
language plpgsql stable security definer set search_path = public as $$
begin
  if p_kind = 'sale' then
    if not exists (select 1 from sales where id = p_bill and (public.is_manager() or (public.is_staff() and created_by = auth.uid()))) then
      raise exception 'Not allowed';
    end if;
    return query select * from payments where sale_id = p_bill order by created_at;
  else
    if not public.is_manager() then raise exception 'Not allowed'; end if;
    return query select * from payments where purchase_id = p_bill order by created_at;
  end if;
end $$;

-- ---------- Dashboard (adds dues and today's money in / out) -----------
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
    'products', (select count(*) from products),
    'low_stock', (select count(*) from products where is_low),
    'receivable', (select coalesce(sum(due_amount), 0) from sales where due_amount > 0),
    'month_purchase', case when mgr then (select coalesce(sum(total), 0) from purchases where created_at >= m0) end,
    'payable', case when mgr then (select coalesce(sum(due_amount), 0) from purchases where due_amount > 0) end,
    'today_in', case when mgr then (select coalesce(sum(amount), 0) from payments where direction = 'in' and created_at >= d0) end,
    'today_out', case when mgr then (select coalesce(sum(amount), 0) from payments where direction = 'out' and created_at >= d0) end
  );
  return res;
end $$;

revoke execute on function public.record_payment(jsonb), public.delete_payment(bigint),
  public.party_balances(text), public.open_bills(text, bigint), public.bill_payments(text, bigint) from anon, public;
grant execute on function public.record_payment(jsonb), public.delete_payment(bigint),
  public.party_balances(text), public.open_bills(text, bigint), public.bill_payments(text, bigint) to authenticated;

grant select, insert, update, delete on public.suppliers, public.payments to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.suppliers, public.payments from anon;
