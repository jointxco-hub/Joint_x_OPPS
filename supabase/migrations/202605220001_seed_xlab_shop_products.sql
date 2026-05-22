insert into public.products (name, category, price, description, image_url, status, display_order)
select *
from (
  values
    ('JV1 T-Shirt', 'tshirts', 95, '180gsm - 100% Cotton', 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400', 'active', 10),
    ('JET T-Shirt', 'tshirts', 155, '220gsm - 100% Combed Cotton', 'https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?w=400', 'active', 20),
    ('JHG T-Shirt', 'tshirts', 229, '300gsm - 100% Carded Cotton', 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400', 'active', 30),
    ('Hoodie 260gsm', 'hoodies', 240, '260gsm - Cotton Blend', 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400', 'active', 40),
    ('Hoodie 360gsm', 'hoodies', 320, '360gsm - Brushed Fleece', 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=400', 'active', 50),
    ('Hoodie 430gsm', 'hoodies', 400, '430gsm - 100% Cotton Fleece', 'https://images.unsplash.com/photo-1578768079052-aa76e52ff62e?w=400', 'active', 60),
    ('Sweater 260gsm', 'sweaters', 220, '260gsm - Cotton Blend', 'https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=400', 'active', 70),
    ('Sweater 360gsm', 'sweaters', 300, '360gsm - Brushed Fleece', 'https://images.unsplash.com/photo-1578587018452-892bacefd3f2?w=400', 'active', 80),
    ('Sweater 430gsm', 'sweaters', 380, '430gsm - 100% Cotton Fleece', 'https://images.unsplash.com/photo-1572495532056-8583af1cbae0?w=400', 'active', 90),
    ('5-Panel Cap', 'hats', 75, 'Cotton Twill', 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400', 'active', 100),
    ('Bucket Hat', 'hats', 120, 'Poly-Cotton', 'https://images.unsplash.com/photo-1572460556623-78f47de5d81c?w=400', 'active', 110),
    ('Trucker Cap', 'hats', 75, 'Cotton/Mesh', 'https://images.unsplash.com/photo-1534215754734-18e55d13e346?w=400', 'active', 120),
    ('Trackpants', 'bottoms', 260, '280g Brushed Fleece', 'https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=400', 'active', 130),
    ('Shorts', 'bottoms', 180, 'Cotton Jersey', 'https://images.unsplash.com/photo-1591195853828-11db59a44f6b?w=400', 'active', 140)
) as seed(name, category, price, description, image_url, status, display_order)
where not exists (
  select 1
  from public.products p
  where lower(p.name) = lower(seed.name)
);
