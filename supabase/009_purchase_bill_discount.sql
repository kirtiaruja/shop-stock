-- =====================================================================
-- StockPilot – 009: discount on the whole purchase bill
-- Run AFTER 008. Safe to run again.
--
-- Bill:  items total (after item discounts + GST)  −  bill discount (% or ₹)  =  total
-- The bill discount is shared over the items by amount, so each product's purchase
-- price also drops by its share (still saved without GST).
-- =====================================================================

alter table public.purchases add column if not exists items_total          numeric(12,2);
alter table public.purchases add column if not exists bill_discount_type   text not null default '%';
alter table public.purchases add column if not exists bill_discount        numeric(12,2) not null default 0;  -- as entered (% or ₹)
alter table public.purchases add column if not exists bill_discount_amount numeric(12,2) not null default 0;  -- in ₹
update public.purchases set items_total = total where items_total is null;

-- p: same as 008, plus bill_discount (number) and bill_discount_type ('%'|'₹')
create or replace function public.create_purchase(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint; it jsonb; pr record;
  v_qty numeric; v_cost numeric; v_gross numeric; v_dval numeric; v_dtype text; v_disc numeric;
  v_rate numeric; v_after numeric; v_taxable numeric; v_tax numeric; v_line numeric;
  v_sub numeric := 0; v_dtot numeric := 0; v_ttot numeric := 0; v_total numeric := 0; v_paid numeric;
  v_items numeric; v_bval numeric; v_btype text; v_bdisc numeric; v_f numeric;
  v_upd boolean := coalesce((p->>'update_cost')::boolean, true);
  v_incl boolean := coalesce((p->>'tax_inclusive')::boolean, false);
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
  if jsonb_array_length(coalesce(p->'items', '[]')) = 0 then raise exception 'Purchase has no items'; end if;
  if v_date > v_today then raise exception 'The bill date can''t be in the future'; end if;
  if v_date < v_today - 3650 then raise exception 'Check the bill date'; end if;
  if v_sup is not null then select name into v_sname from suppliers where id = v_sup; end if;

  -- the purchase is dated on the bill date (time of day = now, so the order of entries is kept)
  v_at := case when v_date = v_today then now()
               else (v_date + (now() at time zone 'Asia/Kolkata')::time) at time zone 'Asia/Kolkata' end;

  insert into purchases (supplier_id, supplier, invoice_no, note, payment_mode, created_by, created_by_name,
                         bill_date, tax_inclusive, created_at, entered_at)
  values (v_sup, v_sname, nullif(p->>'invoice_no', ''), nullif(p->>'note', ''), v_mode, auth.uid(), v_me,
          v_date, v_incl, v_at, now())
  returning id into v_id;

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
      v_line := v_after;
      v_taxable := round(v_after / (1 + v_rate / 100), 2);
      v_tax := v_line - v_taxable;
    else
      v_taxable := v_after;
      v_tax := round(v_after * v_rate / 100, 2);
      v_line := v_taxable + v_tax;
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

  -- purchase price = cost per piece after item discount and its share of the bill discount, without GST
  if v_upd then
    v_f := case when v_items > 0 then 1 - v_bdisc / v_items else 1 end;
    update products pr2 set purchase_price = round(pi.taxable * v_f / pi.qty, 2), updated_at = now()
    from purchase_items pi where pi.purchase_id = v_id and pi.product_id = pr2.id;
  end if;

  v_paid := coalesce((nullif(p->>'paid_amount', ''))::numeric, v_total);
  if v_paid < 0 or v_paid > v_total then raise exception 'Amount paid must be between 0 and the purchase total'; end if;
  if v_paid < v_total and v_sup is null then raise exception 'Select a supplier for a credit purchase'; end if;

  update purchases set subtotal = v_sub, discount_total = v_dtot, tax_total = v_ttot, total = v_total,
    items_total = v_items, bill_discount_type = v_btype, bill_discount = v_bval, bill_discount_amount = v_bdisc,
    payment_mode = case when v_paid < v_total then 'Credit' else v_mode end
  where id = v_id;

  if v_paid > 0 then
    insert into payments (direction, purchase_id, supplier_id, party_name, amount, mode, note, created_by, created_by_name, created_at)
    values ('out', v_id, v_sup, v_sname, v_paid, case when v_mode = 'Credit' then 'Cash' else v_mode end,
            'Paid at purchase', auth.uid(), v_me, v_at);
  end if;
  return v_id;
end $$;
