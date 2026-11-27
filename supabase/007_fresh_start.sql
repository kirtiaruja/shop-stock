-- =====================================================================
-- StockPilot – 007: FRESH START for go-live day
--
-- DELETES: all products (with their extra barcodes and stock history),
--          all sales bills, purchases, payments and dues.
-- KEEPS:   customers, suppliers, staff users / roles,
--          the barcode wizard's categories / styles / brands.
-- Bill and purchase numbers start again from 1.
--
-- There is NO undo. Before running:
--   1. In StockPilot: Products → Export, and Sales / Purchases / Payments → Excel (a backup).
--   2. Finish the day in Vyapar and export its items list (with current stock).
--
-- To run: change  confirm text := 'no'  below to  'yes', then click Run.
-- Afterwards:
--   3. In StockPilot: Products → Import Excel → the Vyapar file ("Set stock from the file" ticked).
--   4. Run 005_barcode_cleanup.sql again (old labels like 121 scan again).
-- =====================================================================

do $$
declare
  confirm text := 'no';   -- ← change to 'yes' to really delete
begin
  if confirm <> 'yes' then
    raise exception 'Nothing deleted. To start fresh, change confirm to ''yes'' at the top of this script and run it again.';
  end if;

  -- transactions first, then products; identities restart so bill no. 1 is next
  truncate table
    public.payments,
    public.sale_items, public.sales,
    public.purchase_items, public.purchases,
    public.stock_adjustments,
    public.product_barcodes,
    public.products
  restart identity;

  raise notice 'Fresh start done: products, bills, purchases and payments deleted. Now import your Vyapar Excel.';
end $$;

-- what is left
select
  (select count(*) from public.products)   as products,
  (select count(*) from public.sales)      as bills,
  (select count(*) from public.purchases)  as purchases,
  (select count(*) from public.payments)   as payments,
  (select count(*) from public.customers)  as customers_kept,
  (select count(*) from public.suppliers)  as suppliers_kept,
  (select count(*) from public.profiles)   as users_kept,
  (select count(*) from public.generic_items) as wizard_styles_kept;
