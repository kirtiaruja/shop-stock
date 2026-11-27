-- =====================================================================
-- StockPilot – 005: one-time clean-up of labels from the old Barcode Wizard
-- Run ONCE, after 004_barcode_wizard.sql and after your products are imported.
-- Safe to run again (nothing is added twice).
--
-- 64 labels were printed by the old tool but are not in StockPilot:
--   • same name as an existing product without a barcode → the label number becomes its barcode
--   • same name as an existing product (it got a second barcode, or "121" vs "000121")
--       → the number is saved as an EXTRA barcode of that product, so the old label scans
--   • otherwise → added as a new product (stock 0, selling price from the price code)
-- At the end it lists products whose name was changed after the label was printed.
-- The wizard can't recognise those; rename them back to the label name if you want.
-- =====================================================================
begin;

create temp table old_labels (barcode text, item_name text, mrp numeric) on commit drop;
insert into old_labels values
  ('166021', 'ESSA MR.FIT BRIEF PRINT 90CM', null),
  ('0140', 'LEHAR MEGA COL 100CM', null),
  ('974320', 'MIDAS BERMUDA 3XL C00', null),
  ('755107', 'NEW EDGE OVERSIZED T-L', null),
  ('536731', 'NEW EDGE OVERSIZED T-M', null),
  ('206107', 'NEW EDGE OVERSIZED T-XL', null),
  ('907922', 'ONN LONG L 285', null),
  ('000151', 'BIGBOSS WH RN 95', null),
  ('461297', 'NOCHO PRINT LONG 100', null),
  ('000101', 'NENO 80', null),
  ('121', 'LEHAR RN COL 85CM', null),
  ('122', 'LEHAR RN COL 90CM', null),
  ('150', 'BIGGBOSS RN WH 90CM', null),
  ('000000', 'OPEX FEMINA 90', null),
  ('610395', 'COLLAR HAF XL B50', null),
  ('718185', 'NIK CREATION HALF PANT XL', null),
  ('427606', 'LYCRA PRINT SANDOW S', null),
  ('727282', 'KILLWILL DRYFIT 3001 - XXL', null),
  ('942762', 'ESSDEE POLO GYM 95', null),
  ('249765', 'ACTIVGEAR 601 TIGHTY XL', null),
  ('920134', 'ACTIVGEAR 601 TIGHTY XXL', null),
  ('998828', 'HIFI WH F/S SHIRT C50 M', null),
  ('998063', 'HIFI WH F/S SHIRT C50 L', null),
  ('646785', 'HIFI WH F/S SHIRT C50 XL', null),
  ('240525', 'HIFI WH F/S SHIRT C50 XXL', null),
  ('834442', 'SOCKS 50', null),
  ('660695', 'Baloon Jeans 28 G00', null),
  ('968823', 'Baloon Jeans 30 G00', null),
  ('389707', 'Baloon Jeans 32 G00', null),
  ('982813', 'APPL F/S M D00', null),
  ('746158', 'APPL F/S L H00', null),
  ('210228', 'APPL F/S XL H00', null),
  ('332061', 'SHORT H/S XXL F00', null),
  ('544962', 'ARMANI 34 C50', null),
  ('664212', 'LEHAR MINI 85', null),
  ('322843', 'LEHAR MINI 90', null),
  ('102671', 'CRAZE GYM VEST 90', null),
  ('966905', 'CRAZE GYM VEST 85', null),
  ('510632', 'LUX COZY LONG 85', null),
  ('416028', 'LUX COZY LONG 95', null),
  ('358925', 'COZY WH RN 90', null),
  ('544765', 'SHORT F/S XL E50', null),
  ('675325', 'JOCKEY LM08 M', null),
  ('156118', 'JOCKEY LM08 L', null),
  ('734361', 'WEWOK COMFEX NP - M', null),
  ('819279', 'COTTON P 36 H50', null),
  ('627104', 'COLLAR HAF XXL F50', 650),
  ('148318', 'JOGGERS 34 A200', 1500.12),
  ('286297', 'LUX COZY LONG 90', null),
  ('497662', 'COTTON P 28 D50', 560.45),
  ('939565', 'COTTON P 30 D50', 560.45),
  ('115830', 'COTTON P 32 D50', 560.45),
  ('683672', 'COTTON P 34 D50', 560.45),
  ('786550', 'APPL F/S S B50', 310.25),
  ('819532', 'JEANS 30 A300', 1650.13),
  ('845087', 'JEANS 32 A300', 1650.13),
  ('154470', 'JEANS 34 A300', 1650.13),
  ('154600', 'JEANS 36 A300', 1650.13),
  ('262362', 'APPL F/S XL E000', 2300.5),
  ('608978', 'JACKET 4XL H50', 1100.85),
  ('882895', 'JACKET 3XL H00', 999.8),
  ('959657', 'JACKET L F50', 800.65),
  ('735270', 'JACKET XL F50', 800.65),
  ('199408', 'LEHAR LONG 80 Z80', 80);

-- 1a) same name as a product that has NO barcode yet → the label number becomes its barcode
update public.products p set item_code = l.barcode, updated_at = now()
from (select distinct on (lower(item_name)) * from old_labels order by lower(item_name), barcode) l
where p.item_code is null
  and lower(trim(p.name)) = lower(l.item_name)
  and not exists (select 1 from public.products x where x.item_code = l.barcode);

-- 1b) same name as a product that already has a barcode → extra barcode
insert into public.product_barcodes (barcode_number, product_id, note)
select l.barcode, p.id, 'old label: ' || l.item_name
from old_labels l
join lateral (select id from public.products where lower(trim(name)) = lower(l.item_name) order by id limit 1) p on true
where not exists (select 1 from public.products x where x.item_code = l.barcode)
on conflict do nothing;

-- 2) the rest → new products
insert into public.products (name, item_code, category, mrp, sale_price, online_price, base_unit)
select l.item_name, l.barcode,
       coalesce(nullif(o.category, 'Other'), null),
       l.mrp,
       coalesce(public.code_to_price(o.price_code), public.actual_from_mrp(l.mrp), 0),
       coalesce(public.code_to_price(o.price_code), public.actual_from_mrp(l.mrp), 0),
       'PIECES'
from old_labels l
cross join lateral (
  -- read the name the same way the wizard does
  select substring(upper(l.item_name), '.*(?:^| |-)([A-KZ][0-9]{2,3})(?:[-/][0-9])?(?=$| |-)') as price_code,
         (select cr.category from public.category_rules cr where upper(l.item_name) ~ cr.pattern order by cr.priority, cr.id limit 1) as category
) o
where not exists (select 1 from public.products x where x.item_code = l.barcode)
  and not exists (select 1 from public.product_barcodes x where x.barcode_number = l.barcode)
  and not exists (select 1 from public.products x where lower(trim(x.name)) = lower(l.item_name))
on conflict do nothing;

commit;

-- ---------- report ----------
select
  (select count(*) from public.product_barcodes) as extra_barcodes,
  (select count(*) from public.products where item_code is not null) as products_with_barcode;

-- products renamed after their label was printed (the wizard won't recognise these)
select v.barcode, v.label_name as name_on_label, p.name as name_in_stockpilot
from (values
  ('200895', 'HALF PANT L', 'HALF PANT L B50'),
  ('872473', 'HALF PANT XL', 'HALF PANT XL B50'),
  ('152856', 'HALF PANT XXL', 'HALF PANT XXL B50'),
  ('948731', 'HOSIERY BERMUDA XXL B50', 'MIDAS BERMUDA XXL'),
  ('947383', 'LUX NITRO SEMI LONG 100', 'NITRO SEMI LONG 100'),
  ('000211', 'OPEX WOW LONG - 90', 'Opex WOW - 90'),
  ('000235', 'OPEX CRUZE 90CM', 'Opex Cruze - 90'),
  ('000121', 'LEHAR COL RN 85', 'LEHAR RN COL 85CM'),
  ('000122', 'LEHAR RN COL 90', 'LEHAR RN COL 90CM'),
  ('000150', 'BIG BOSS WH RN 90', 'BIGGBOSS RN WH 90CM'),
  ('450603', 'GURU KURTA PAYJAMA H50', 'GURU KURTA PAYJAMA L H50'),
  ('505669', 'GURU KURTA PAYJAMA L G0', 'GURU KURTA PAYJAMA L G00'),
  ('758048', 'OPEX WOW LONG 80', 'opex wow 80'),
  ('104415', 'TECNO SPORT SENDOW M', 'TECHNOSPORT P893 M'),
  ('619717', 'TECNO SPORT SNEDOW  L', 'TECHNOSPORT P893  L'),
  ('901757', 'TECNO SPORT SEDOW XL', 'TECHNOSPORT P893 XL'),
  ('321615', 'TECNO SPORT SENDOW XXL', 'TECHNOSPORT P893 XXL'),
  ('994031', 'TECNO SPORT CREW NECK M', 'TECHNOSPORT OR47 F/S M'),
  ('413772', 'TECNO SPORT CREW NECK L', 'TECHNOSPORT OR47 F/S L'),
  ('264018', 'TECNO SPORT CREW NECK  XL', 'TECHNOSPORT OR47 F/S XL'),
  ('457611', 'TECNO SPORT CREW NECK XXL', 'TECHNOSPORT OR47 F/S XXL'),
  ('747747', 'TECNO SPORT TRACK PENT L', 'TECHNOSPORT OR99/27 TRACK P L'),
  ('102393', 'TECNO SPORT TRACK PENT XL', 'TECHNOSPORT OR99/27 TRACK P XL'),
  ('832562', 'TECNO SPORT TRACK PENT XXL', 'TECHNOSPORT OR99/27 TRACK P XXL'),
  ('402525', 'ZERO COAT F/S 1670  40', 'ZERO COAT F/S 1670 40'),
  ('769768', 'LB SHORT F/S F50 - XL', 'LB SHORT F/S F50. - XL'),
  ('335083', 'LB SHORT F/S F50 - XXL', 'LB SHORT F/S F50. - XXL'),
  ('595416', 'LB SHORT F/S E00 - L', 'LB SHORT F/S E00. - L'),
  ('955475', 'LB SHORT F/S E00 - XL', 'LB SHORT F/S E00. - XL'),
  ('747389', 'LB SHORT F/S E00 - XXL', 'LB SHORT F/S E00. - XXL'),
  ('715192', 'LB SHORT F/S E50 - L', 'LB SHORT F/S E50. - L'),
  ('347483', 'LB SHORT F/S E50 - XL', 'LB SHORT F/S E50. - XL'),
  ('695178', 'LB SHORT F/S E50 - XXL', 'LB SHORT F/S E50. - XXL'),
  ('260383', 'BIGGBOSS RNS WH 100', 'Biggboss wh RNS 100'),
  ('908309', 'HOSIERY BERMUDA XL B50', 'MIDAS BERMUDA XL B50'),
  ('143770', 'LUX NITRO SEMI LONG 85', 'NITRO SEMI LONG 85'),
  ('598242', 'LUX NITRO SEMI LONG 90', 'NITRO SEMI LONG 90'),
  ('138892', 'LUX NITRO SEMI LONG 95', 'NITRO SEMI LONG 95')
) v(barcode, label_name, old_sp_name)
join public.products p on p.item_code = v.barcode
where upper(trim(p.name)) <> upper(v.label_name)
order by 2;
