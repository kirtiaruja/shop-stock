-- =====================================================================
-- StockPilot – 012: edit saved sale bills and purchases
-- Run AFTER 011. Safe to run again.
--
-- update_sale(p_id, p) / update_purchase(p_id, p) keep the same bill number:
--   1. the old items' stock is put back (sale: + qty, purchase: − qty)
--   2. the old items are replaced by the new ones and stock is changed again
--   3. totals are worked out again; payments already made stay on the bill
--   4. p.paid_amount = any extra amount paid now (optional)
--   5. if the new total is less than what was paid (items returned), the difference is
--      given back: the latest payments on the bill are reduced by that amount.
-- Who can edit: Admin and Co-admin.
-- =====================================================================

alter table public.sales     add column if not exists edited_at timestamptz;
alter table public.sales     add column if not exists edited_by_name text;
alter table public.purchases add column if not exists edited_at timestamptz;
alter table public.purchases add column if not exists edited_by_name text;

-- ---------------------------------------------------------------------
-- Shared: add the items of a sale bill, take them out of stock, return the subtotal
-- ---------------------------------------------------------------------
create or replace function public._sale_fill(v_sale bigint, p jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare it jsonb; pr record; v_qty numeric; v_price numeric; v_sub numeric := 0;
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Bill has no items'; end if;
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
  return v_sub;
end $$;

-- ---------------------------------------------------------------------
-- Shared: add the items of a purchase, add them to stock, work out all totals
-- (item discount + item GST, bill discount, GST on bill, purchase prices).
-- ---------------------------------------------------------------------
create or replace function public._purchase_fill(v_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; pr record;
  v_qty numeric; v_cost numeric; v_gross numeric; v_dval numeric; v_dtype text; v_disc numeric;
  v_rate numeric; v_after numeric; v_taxable numeric; v_tax numeric; v_line numeric;
  v_sub numeric := 0; v_dtot numeric := 0; v_ttot numeric := 0; v_total numeric := 0;
  v_items numeric; v_bval numeric; v_btype text; v_bdisc numeric; v_f numeric;
  v_brate numeric; v_btax numeric;
  v_upd boolean := coalesce((p->>'update_cost')::boolean, true);
  v_incl boolean := coalesce((p->>'tax_inclusive')::boolean, false);
begin
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Purchase has no items'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty  := (it->>'qty')::numeric;
    v_cost := (it->>'cost')::numeric;
    v_dval := coalesce(nullif(it->>'discount', '')::numeric, 0);
    v_dtype := case when it->>'discount_type' in ('₹', 'Rs', 'amount') then '₹' else '%' end;
    v_rate := coalesce(nullif(it->>'tax_rate', '')::numeric, 0);
    if v_qty is null or v_qty <= 0 then raise exception 'Quantity must be more than 0'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Cost cannot be negative'; end if;
    if v_dval < 0 then raise exception 'Discount cannot be negative'; end if;
    if v_rate < 0 or v_rate > 100 then raise exception 'GST rate must be between 0 and 100%%'; end if;

    select id, name, item_code into pr from products where id = (it->>'product_id')::bigint for update;
    if not found then raise exception 'Product % not found', it->>'product_id'; end if;

    v_gross := round(v_qty * v_cost, 2);
    v_disc  := case when v_dtype = '%' then round(v_gross * v_dval / 100, 2) else round(v_dval, 2) end;
    if v_disc > v_gross then raise exception 'Discount on % is more than its amount', pr.name; end if;
    v_after := v_gross - v_disc;
    if v_incl then
      v_line := v_after; v_taxable := round(v_after / (1 + v_rate / 100), 2); v_tax := v_line - v_taxable;
    else
      v_taxable := v_after; v_tax := round(v_after * v_rate / 100, 2); v_line := v_taxable + v_tax;
    end if;

    insert into purchase_items (purchase_id, product_id, product_name, item_code, qty, cost, line_total,
                                discount_type, discount, discount_amount, taxable, tax_rate, tax_amount)
    values (v_id, pr.id, pr.name, pr.item_code, v_qty, v_cost, v_line,
            v_dtype, v_dval, v_disc, v_taxable, v_rate, v_tax);
    update products set stock = stock + v_qty, updated_at = now() where id = pr.id;
    v_sub := v_sub + v_gross; v_dtot := v_dtot + v_disc; v_ttot := v_ttot + v_tax; v_total := v_total + v_line;
  end loop;

  -- discount on the whole bill (after item discounts and GST)
  v_items := v_total;
  v_bval  := coalesce(nullif(p->>'bill_discount', '')::numeric, 0);
  v_btype := case when p->>'bill_discount_type' in ('₹', 'Rs', 'amount') then '₹' else '%' end;
  if v_bval < 0 then raise exception 'Bill discount cannot be negative'; end if;
  v_bdisc := case when v_btype = '%' then round(v_items * v_bval / 100, 2) else round(v_bval, 2) end;
  if v_bdisc > v_items then raise exception 'Bill discount is more than the bill amount'; end if;
  v_total := v_items - v_bdisc;

  -- GST on the bill amount (after the bill discount), added on top
  v_brate := coalesce(nullif(p->>'bill_tax_rate', '')::numeric, 0);
  if v_brate < 0 or v_brate > 100 then raise exception 'GST on bill must be between 0 and 100%%'; end if;
  v_btax  := round(v_total * v_brate / 100, 2);
  v_total := v_total + v_btax;

  -- purchase price = cost per piece after item discount and its share of the bill discount, without GST
  if v_upd then
    v_f := case when v_items > 0 then 1 - v_bdisc / v_items else 1 end;
    update products pr2 set purchase_price = round(pi.taxable * v_f / pi.qty, 2), updated_at = now()
    from purchase_items pi where pi.purchase_id = v_id and pi.product_id = pr2.id;
  end if;

  update purchases set subtotal = v_sub, discount_total = v_dtot, tax_total = v_ttot, total = v_total,
    items_total = v_items, bill_discount_type = v_btype, bill_discount = v_bval, bill_discount_amount = v_bdisc,
    bill_tax_rate = v_brate, bill_tax_amount = v_btax, tax_inclusive = v_incl
  where id = v_id;
  return jsonb_build_object('total', v_total);
end $$;

-- ---------------------------------------------------------------------
-- Shared: a bill now costs less than what was paid → give back the difference
-- by reducing the latest payments on that bill (a payment brought to 0 is removed).
-- ---------------------------------------------------------------------
create or replace function public._give_back(p_col text, p_id bigint, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare pay record; v_left numeric := p_amount; v_take numeric;
begin
  for pay in execute format('select id, amount from payments where %I = $1 order by created_at desc, id desc for update', p_col)
             using p_id loop
    exit when v_left <= 0;
    v_take := least(pay.amount, v_left);
    if v_take = pay.amount then
      delete from payments where id = pay.id;
    else
      update payments set amount = amount - v_take,
        note = left(coalesce(note || ' · ', '') || '₹' || v_take || ' given back when bill was edited', 200)
      where id = pay.id;
    end if;
    v_left := v_left - v_take;
  end loop;
end $$;
revoke all on function public._give_back(text, bigint, numeric) from public, anon, authenticated;

-- the shared parts can only be used by the functions below, not called from the app
revoke all on function public._sale_fill(bigint, jsonb) from public, anon, authenticated;
revoke all on function public._purchase_fill(bigint, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- New sale (same as before, now using _sale_fill)
-- ---------------------------------------------------------------------
create or replace function public.create_sale(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_sale bigint; v_sub numeric; v_disc numeric := coalesce((p->>'discount')::numeric, 0);
  v_total numeric; v_paid numeric;
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_cust bigint := nullif(p->>'customer_id', '')::bigint;
  v_cname text := nullif(p->>'customer_name', '');
  v_me text := (select full_name from profiles where id = auth.uid());
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_staff() then raise exception 'Not allowed'; end if;
  if v_cust is not null then select name into v_cname from customers where id = v_cust; end if;

  insert into sales (customer_id, customer_name, discount, payment_mode, note, created_by, created_by_name)
  values (v_cust, v_cname, v_disc, v_mode, nullif(p->>'note', ''), auth.uid(), v_me)
  returning id into v_sale;

  v_sub := public._sale_fill(v_sale, p);
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

-- ---------------------------------------------------------------------
-- Edit a sale bill
-- ---------------------------------------------------------------------
create or replace function public.update_sale(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  s record; v_sub numeric; v_disc numeric := coalesce((p->>'discount')::numeric, 0);
  v_total numeric; v_paid_before numeric; v_extra numeric;
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_cust bigint := nullif(p->>'customer_id', '')::bigint;
  v_cname text := nullif(p->>'customer_name', '');
  v_me text := (select full_name from profiles where id = auth.uid());
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can edit bills'; end if;
  select * into s from sales where id = p_id for update;
  if not found then raise exception 'Bill #% not found', p_id; end if;
  if v_cust is not null then select name into v_cname from customers where id = v_cust; end if;

  -- put the old items back in stock, then replace them
  update products pr set stock = pr.stock + si.qty, updated_at = now()
    from sale_items si where si.sale_id = p_id and si.product_id = pr.id;
  delete from sale_items where sale_id = p_id;
  v_sub := public._sale_fill(p_id, p);

  if v_disc < 0 or v_disc > v_sub then raise exception 'Discount must be between 0 and the bill amount'; end if;
  v_total := v_sub - v_disc;
  v_paid_before := coalesce((select sum(amount) from payments where sale_id = p_id), 0);
  -- new total is less than what was paid (items returned): the difference is given back —
  -- the latest payments on this bill are reduced (or removed) by that amount
  if v_total < v_paid_before then
    perform public._give_back('sale_id', p_id, v_paid_before - v_total);
    v_paid_before := v_total;
  end if;
  v_extra := coalesce((nullif(p->>'paid_amount', ''))::numeric, 0);
  if v_extra < 0 or v_paid_before + v_extra > v_total then raise exception 'Amount paid now is more than the balance'; end if;
  if v_paid_before + v_extra < v_total and v_cust is null then
    raise exception 'Select a customer — this bill now has a balance due';
  end if;

  -- payments already on the bill follow the new customer
  update payments set customer_id = v_cust, party_name = v_cname where sale_id = p_id;
  if v_extra > 0 then
    insert into payments (direction, sale_id, customer_id, party_name, amount, mode, note, created_by, created_by_name)
    values ('in', p_id, v_cust, v_cname, v_extra, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid when bill was edited', auth.uid(), v_me);
  end if;

  update sales set customer_id = v_cust, customer_name = v_cname, discount = v_disc, note = nullif(p->>'note', ''),
    subtotal = v_sub, total = v_total,
    payment_mode = case when v_paid_before + v_extra < v_total then 'Credit'
                        when s.payment_mode = 'Credit' or v_extra > 0 then v_mode else s.payment_mode end,
    edited_at = now(), edited_by_name = v_me
  where id = p_id;
  return p_id;
end $$;

-- ---------------------------------------------------------------------
-- New purchase (same as 011, now using _purchase_fill)
-- ---------------------------------------------------------------------
create or replace function public.create_purchase(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; v_total numeric; v_paid numeric;
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_sup bigint := nullif(p->>'supplier_id', '')::bigint;
  v_sname text := nullif(p->>'supplier', '');
  v_me text := (select full_name from profiles where id = auth.uid());
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date := coalesce(nullif(p->>'bill_date', '')::date, v_today);
  v_at timestamptz;
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can add purchases'; end if;
  if v_date > v_today then raise exception 'The bill date can''t be in the future'; end if;
  if v_date < v_today - 3650 then raise exception 'Check the bill date'; end if;
  if v_sup is not null then select name into v_sname from suppliers where id = v_sup; end if;

  -- the purchase is dated on the bill date (time of day = now, so the order of entries is kept)
  v_at := case when v_date = v_today then now()
               else (v_date + (now() at time zone 'Asia/Kolkata')::time) at time zone 'Asia/Kolkata' end;

  insert into purchases (supplier_id, supplier, invoice_no, note, payment_mode, created_by, created_by_name,
                         bill_date, created_at, entered_at)
  values (v_sup, v_sname, nullif(p->>'invoice_no', ''), nullif(p->>'note', ''), v_mode, auth.uid(), v_me,
          v_date, v_at, now())
  returning id into v_id;

  v_total := (public._purchase_fill(v_id, p)->>'total')::numeric;

  v_paid := coalesce((nullif(p->>'paid_amount', ''))::numeric, v_total);
  if v_paid < 0 or v_paid > v_total then raise exception 'Amount paid must be between 0 and the purchase total'; end if;
  if v_paid < v_total and v_sup is null then raise exception 'Select a supplier for a credit purchase'; end if;
  update purchases set payment_mode = case when v_paid < v_total then 'Credit' else v_mode end where id = v_id;

  if v_paid > 0 then
    insert into payments (direction, purchase_id, supplier_id, party_name, amount, mode, note, created_by, created_by_name, created_at)
    values ('out', v_id, v_sup, v_sname, v_paid, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid at purchase', auth.uid(), v_me, v_at);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Edit a purchase
-- ---------------------------------------------------------------------
create or replace function public.update_purchase(p_id bigint, p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  o record; v_total numeric; v_paid_before numeric; v_extra numeric;
  v_mode text := coalesce(nullif(p->>'payment_mode', ''), 'Cash');
  v_sup bigint := nullif(p->>'supplier_id', '')::bigint;
  v_sname text := nullif(p->>'supplier', '');
  v_me text := (select full_name from profiles where id = auth.uid());
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_date date;
  v_at timestamptz;
begin
  perform set_config('stockpilot.src', 'bill', true);
  if not public.is_manager() then raise exception 'Only Admin / Co-admin can edit purchases'; end if;
  select * into o from purchases where id = p_id for update;
  if not found then raise exception 'Purchase #% not found', p_id; end if;
  v_date := coalesce(nullif(p->>'bill_date', '')::date, o.bill_date, (o.created_at at time zone 'Asia/Kolkata')::date);
  if v_date > v_today then raise exception 'The bill date can''t be in the future'; end if;
  if v_date < v_today - 3650 then raise exception 'Check the bill date'; end if;
  if v_sup is not null then select name into v_sname from suppliers where id = v_sup; end if;
  -- keep the original time of day, move it to the (new) bill date
  v_at := (v_date + (o.created_at at time zone 'Asia/Kolkata')::time) at time zone 'Asia/Kolkata';

  -- take the old items back out of stock, then replace them
  update products pr set stock = pr.stock - pi.qty, updated_at = now()
    from purchase_items pi where pi.purchase_id = p_id and pi.product_id = pr.id;
  delete from purchase_items where purchase_id = p_id;

  update purchases set supplier_id = v_sup, supplier = v_sname, invoice_no = nullif(p->>'invoice_no', ''),
    note = nullif(p->>'note', ''), bill_date = v_date, created_at = v_at,
    edited_at = now(), edited_by_name = v_me
  where id = p_id;

  v_total := (public._purchase_fill(p_id, p)->>'total')::numeric;

  v_paid_before := coalesce((select sum(amount) from payments where purchase_id = p_id), 0);
  -- new total is less than what was paid (items returned): the difference is given back —
  -- the latest payments on this purchase are reduced (or removed) by that amount
  if v_total < v_paid_before then
    perform public._give_back('purchase_id', p_id, v_paid_before - v_total);
    v_paid_before := v_total;
  end if;
  v_extra := coalesce((nullif(p->>'paid_amount', ''))::numeric, 0);
  if v_extra < 0 or v_paid_before + v_extra > v_total then raise exception 'Amount paid now is more than the balance'; end if;
  if v_paid_before + v_extra < v_total and v_sup is null then
    raise exception 'Select a supplier — this purchase now has a balance due';
  end if;

  update payments set supplier_id = v_sup, party_name = v_sname where purchase_id = p_id;
  if v_extra > 0 then
    insert into payments (direction, purchase_id, supplier_id, party_name, amount, mode, note, created_by, created_by_name)
    values ('out', p_id, v_sup, v_sname, v_extra, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid when purchase was edited', auth.uid(), v_me);
  end if;

  update purchases set payment_mode = case when v_paid_before + v_extra < v_total then 'Credit'
                                           when o.payment_mode = 'Credit' or v_extra > 0 then v_mode else o.payment_mode end
  where id = p_id;
  return p_id;
end $$;

grant execute on function public.update_sale(bigint, jsonb) to authenticated;
grant execute on function public.update_purchase(bigint, jsonb) to authenticated;
