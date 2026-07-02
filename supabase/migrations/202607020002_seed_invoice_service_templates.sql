-- Default reusable invoice service items.
-- These seed the picker from DB-managed saved items instead of frontend-only shortcuts.

insert into public.opps_invoice_item_templates (
  tenant_id,
  name,
  description,
  item_type,
  unit,
  rate,
  tax_name,
  tax_percentage,
  account_name,
  category,
  metadata,
  is_active
)
select
  tenants.id,
  seed.name,
  seed.description,
  'services',
  seed.unit,
  seed.rate,
  '',
  0,
  '',
  seed.category,
  jsonb_build_object(
    'source', 'seed',
    'service_group', seed.category,
    'department', seed.department,
    'seed_key', seed.seed_key
  ),
  true
from public.tenants
cross join (
  values
    ('dtf-printing', 'DTF Printing', 'Print department / DTF transfer production', 'Printing', 'Print department', 'job', 149::numeric),
    ('vinyl-printing', 'Vinyl Printing', 'Print department / vinyl application', 'Printing', 'Print department', 'job', 110::numeric),
    ('screen-printing', 'Screen Printing', 'Print department / screen print job', 'Printing', 'Print department', 'job', 0::numeric),
    ('embroidery', 'Embroidery', 'Embroidery department', 'Printing', 'Embroidery department', 'job', 0::numeric),
    ('labeling', 'Labeling', 'Packaging department / neck labels, tags, or relabeling', 'Packaging & tagging', 'Packaging department', 'job', 0::numeric),
    ('packing', 'Packing', 'Packing department / fold, bag, pack, and dispatch prep', 'Packaging & tagging', 'Packaging department', 'job', 0::numeric),
    ('artwork-design', 'Artwork Design', 'Content studio / layout, artwork, or file setup', 'XLAB content studio', 'Content studio', 'job', 99::numeric),
    ('product-photography', 'Product Photography', 'Content studio / product photo capture', 'XLAB content studio', 'Content studio', 'job', 0::numeric)
) as seed(seed_key, name, description, category, department, unit, rate)
where not exists (
  select 1
  from public.opps_invoice_item_templates existing
  where existing.tenant_id = tenants.id
    and lower(existing.name) = lower(seed.name)
    and coalesce(existing.category, '') = seed.category
);
