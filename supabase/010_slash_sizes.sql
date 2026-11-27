-- =====================================================================
-- StockPilot – 010: sizes written as two sizes, e.g. S/80CM, 2XL/100CM, 100/2XL
-- Run after 004. Safe to run again.
-- Before this, "J&H DERBY BLACK S/80CM" was not read as style DERBY BLACK + size S/80CM,
-- so every renamed product showed up in the barcode wizard as its own style.
-- =====================================================================

create or replace view public.barcode_options as
  with base as (
    select p.id, p.name as item_name, p.item_code as barcode_number,
           upper(regexp_replace(trim(p.name), '\s+', ' ', 'g')) as nm
    from public.products p
    where p.item_code is not null
  ), coded as (
    select base.*,
           substring(nm, '.*(?:^| |-)([A-KZ][0-9]{2,3})(?:[-/][0-9])?(?=$| |-)') as price_code,
           regexp_replace(regexp_replace(nm, '^(.*)(?:^| |-)[A-KZ][0-9]{2,3}(?:[-/][0-9])?(?=$| |-)', '\1 '), '[ -]+$', '') as rest
    from base
  ), sized as (
    select coded.*,
           replace(substring(rest, '(?:^| |-)((?:[0-9]?X{0,4}L|XS|S|M|[0-9]{2,3} ?CM|[0-9]{2,3})(?: ?/ ?(?:[0-9]?X{0,4}L|XS|S|M|[0-9]{2,3} ?CM|[0-9]{2,3}))?)$'), ' ', '') as size,
           trim(regexp_replace(regexp_replace(rest, '(?:^| |-)((?:[0-9]?X{0,4}L|XS|S|M|[0-9]{2,3} ?CM|[0-9]{2,3})(?: ?/ ?(?:[0-9]?X{0,4}L|XS|S|M|[0-9]{2,3} ?CM|[0-9]{2,3}))?)$', ''), '[ -]+$', '')) as product
    from coded
  )
  select s.id, s.item_name, s.barcode_number, s.product, s.size, s.price_code, pc.price,
         coalesce(r.category,
                  case when substring(s.size, '([0-9]{2,3})') is not null and s.size ~ '^[0-9]{2,3}$|[0-9]{2,3}CM|/' and substring(s.size, '([0-9]{2,3})')::int between 60 and 120 then 'Innerwear' end,
                  'Other') as category
  from sized s
  left join public.price_codes pc on pc.code = s.price_code
  left join lateral (
    select cr.category from public.category_rules cr
    where s.nm ~ cr.pattern order by cr.priority, cr.id limit 1
  ) r on true;

-- sizes in order: S/80CM, M/85CM, L/90CM, XL/95CM, 2XL/100CM (letter first, then the number)
create or replace function public.wizard_sort_sizes(p_sizes text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(s order by
           coalesce(array_position(array['XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL']::text[], split_part(s, '/', 1)),
                    array_position(array['XS','S','M','L','XL','XXL','2XL','3XL','4XL','5XL']::text[], split_part(s, '/', 2))),
           nullif(substring(s, '([0-9]{2,3})'), '')::int, s), '{}')
  from (select distinct s from unnest(p_sizes) s where s is not null) x
$$;
