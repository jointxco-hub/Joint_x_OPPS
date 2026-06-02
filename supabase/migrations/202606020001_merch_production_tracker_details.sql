-- Merch production tracker detail fields.
-- Keeps orders.status broad while giving the team a specific production stage.

alter table public.orders
  add column if not exists production_method text,
  add column if not exists production_detail_stage text,
  add column if not exists production_client_update text,
  add column if not exists production_internal_note text,
  add column if not exists production_hold_reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_production_method_check'
  ) then
    alter table public.orders add constraint orders_production_method_check
      check (
        production_method is null or production_method in (
          'dtf', 'vinyl', 'screen', 'embroidery', 'pressing',
          'tailoring', 'cropping', 'labeling', 'mixed', 'custom'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_production_detail_stage_check'
  ) then
    alter table public.orders add constraint orders_production_detail_stage_check
      check (
        production_detail_stage is null or production_detail_stage in (
          'waiting_design_assets',
          'artwork_check',
          'artwork_setup',
          'awaiting_client_approval',
          'print_setup',
          'queued_pressing',
          'pressing',
          'queued_embroidery',
          'embroidering',
          'queued_tailor',
          'at_tailor',
          'cropping_alterations',
          'finishing',
          'quality_check',
          'rework',
          'waiting_stock',
          'packing',
          'custom'
        )
      );
  end if;
end $$;

insert into public.order_stages (key, display_name, sequence, is_exception, color, sla_hours, legacy_status) values
  ('waiting_design_assets',    'Waiting for design assets', 4,  false, '#F59E0B', null, 'in_production'),
  ('artwork_check',            'Artwork check',             4,  false, '#A855F7', 24,   'in_production'),
  ('artwork_setup',            'Artwork setup',             4,  false, '#A855F7', 48,   'in_production'),
  ('awaiting_client_approval', 'Awaiting client approval',  5,  false, '#EAB308', 72,   'in_production'),
  ('print_setup',              'Print setup',               7,  false, '#3B82F6', 12,   'in_production'),
  ('queued_pressing',          'Queued for pressing',       8,  false, '#3B82F6', 24,   'in_production'),
  ('pressing',                 'Pressing',                  8,  false, '#3B82F6', 24,   'in_production'),
  ('queued_embroidery',        'Queued for embroidery',     8,  false, '#3B82F6', 48,   'in_production'),
  ('embroidering',             'Embroidering',              8,  false, '#3B82F6', 48,   'in_production'),
  ('queued_tailor',            'Queued for tailor',         8,  false, '#3B82F6', 72,   'in_production'),
  ('at_tailor',                'At tailor',                 8,  false, '#3B82F6', 72,   'in_production'),
  ('cropping_alterations',     'Cropping / alterations',    8,  false, '#3B82F6', 72,   'in_production'),
  ('finishing',                'Finishing',                 9,  false, '#3B82F6', 24,   'in_production'),
  ('packing',                  'Packing',                   10, false, '#10B981', 12,   'ready'),
  ('waiting_stock',            'Waiting on stock / blanks', 99, true,  '#EF4444', null, 'in_production'),
  ('rework',                   'Rework / correction',       99, true,  '#EF4444', null, 'in_production')
on conflict (key) do update set
  display_name = excluded.display_name,
  sequence = excluded.sequence,
  is_exception = excluded.is_exception,
  color = excluded.color,
  sla_hours = excluded.sla_hours,
  legacy_status = excluded.legacy_status;

comment on column public.orders.production_method is
  'Merch method for tracker detail, e.g. DTF, embroidery, pressing, tailoring.';
comment on column public.orders.production_detail_stage is
  'Specific merch production stage shown internally and optionally on client trackers.';
comment on column public.orders.production_client_update is
  'Custom client-facing production update for tracker pages.';
comment on column public.orders.production_internal_note is
  'Internal-only hold-up or production context.';
comment on column public.orders.production_hold_reason is
  'Internal hold-up summary kept for compatibility with tracker/reporting surfaces.';
