with ranked as (
  select
    id,
    row_number() over (
      partition by lower(name)
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as row_number
  from public.products
  where is_archived = false
)
update public.products p
set
  is_archived = true,
  store_visible = false,
  updated_at = now()
from ranked r
where p.id = r.id
  and r.row_number > 1;

update public.products
set print_options = '[
  {"name":"DTF Front","type":"dtf","price":120,"locations":["Front"]},
  {"name":"DTF Back","type":"dtf","price":140,"locations":["Back"]},
  {"name":"Vinyl Print","type":"vinyl","price":110,"locations":["Front","Back","Sleeve"]},
  {"name":"Embroidery","type":"embroidery","price":150,"locations":["Left Chest","Right Chest"]},
  {"name":"Neck Label Print","type":"label","price":20,"locations":["Neck Tag"]}
]'::jsonb
where is_archived = false
  and (print_options is null or jsonb_array_length(print_options) = 0);

update public.products
set addons = '[
  {"name":"Neck label","price":20},
  {"name":"Swing tag","price":15},
  {"name":"Individual packaging","price":10}
]'::jsonb
where is_archived = false
  and (addons is null or jsonb_array_length(addons) = 0);

insert into public.products (
  name,
  description,
  category,
  price,
  image_url,
  status,
  store_visible,
  display_order,
  addons,
  print_options
)
select
  'Custom Labels',
  'Printed neck labels, woven labels, swing tags, and packaging add-ons.',
  'labels',
  20,
  'https://images.unsplash.com/photo-1607344645866-009c320b63e0?w=800',
  'active',
  true,
  500,
  '[
    {"name":"Neck label","price":20},
    {"name":"Swing tag","price":15},
    {"name":"Woven label","price":35},
    {"name":"Individual packaging","price":10}
  ]'::jsonb,
  '[
    {"name":"Label print setup","type":"label","price":20,"locations":["Neck Tag","Hem","Packaging"]},
    {"name":"Woven label application","type":"label","price":35,"locations":["Neck Tag","Hem"]}
  ]'::jsonb
where not exists (
  select 1 from public.products where lower(name) = 'custom labels' and is_archived = false
);
