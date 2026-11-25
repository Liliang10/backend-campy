-- ==============================================================================
-- CAMPY APP - SUPABASE DATABASE SCHEMA & INITIALIZATION
-- File: backend/supabase/schema.sql
-- Role-based Multi-Table Architecture:
--   - Role 'user'    -> tabel `public.users`
--   - Role 'admin'   -> tabel `public.admin`
--   - Role 'petugas' -> tabel `public.petugas`
-- Idempotent: Aman dijalankan berkali-kali di SQL Editor Supabase
-- ==============================================================================

-- 1. EXTENSIONS
create extension if not exists "pgcrypto";

-- ==============================================================================
-- 2. TABEL-TABEL ROLE SESUAI PERMINTAAN USER
-- ==============================================================================

-- Drop tabel role kosong jika sebelumnya sudah ada tanpa kolom id
drop table if exists public.users cascade;
drop table if exists public.admin cascade;
drop table if exists public.petugas cascade;

-- 2.1 TABEL USERS (Untuk role 'user')
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  full_name text,
  phone text,
  address text,
  avatar_url text,
  role text not null default 'user',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2.2 TABEL ADMIN (Untuk role 'admin')
create table public.admin (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text,
  name text,
  phone text,
  detail text,
  location text,
  role text not null default 'admin',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2.3 TABEL PETUGAS (Untuk role 'petugas')
create table public.petugas (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  username text,
  phone text,
  detail text,
  location text,
  role text not null default 'petugas',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ==============================================================================
-- 3. TABEL-TABEL DATA APLIKASI
-- ==============================================================================

-- 3.1 PRODUCTS
create table if not exists public.products (
  id text primary key,
  name text not null,
  sub text,
  category text,
  category_slug text,
  price int not null,
  is_special_offer bool default false,
  icon text default 'inventory_2',
  asset text,
  image_url text,
  stock int default 0,
  description text,
  created_at timestamptz default now()
);

alter table public.products add column if not exists image_url text;
alter table public.products add column if not exists is_special_offer bool default false;
alter table public.products add column if not exists stock int default 0;

-- 3.2 ORDERS
create table if not exists public.orders (
  id text primary key, -- Format: #ORD-xxxxxxxx
  user_id uuid references auth.users(id) on delete set null,
  product_name text,
  product_sub text,
  qty int default 1,
  unit_price int default 0,
  subtotal int default 0,
  delivery_method text check (delivery_method in ('pickup', 'delivery')),
  delivery_fee int default 0,
  total int default 0,
  date text,
  status text default 'active' check (status in ('active', 'completed', 'cancelled')),
  location text,
  payment_method text,
  rental_duration_days int not null default 1,
  return_deadline date,
  return_photo_url text,
  return_status text not null default 'not_submitted'
    check (return_status in ('not_submitted', 'pending_review', 'approved', 'rejected')),
  created_at timestamptz default now()
);

alter table public.orders add column if not exists product_name text;
alter table public.orders add column if not exists product_sub text;
alter table public.orders add column if not exists qty int default 1;
alter table public.orders add column if not exists unit_price int default 0;
alter table public.orders add column if not exists subtotal int default 0;
alter table public.orders add column if not exists delivery_fee int default 0;
alter table public.orders add column if not exists rental_duration_days int not null default 1;
alter table public.orders add column if not exists return_deadline date;
alter table public.orders add column if not exists return_photo_url text;
alter table public.orders add column if not exists return_status text not null default 'not_submitted';

update public.orders
   set return_deadline = (created_at at time zone 'Asia/Jakarta')::date + rental_duration_days
 where return_deadline is null
   and created_at is not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'orders_return_status_check'
       and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_return_status_check
      check (return_status in ('not_submitted', 'pending_review', 'approved', 'rejected'));
  end if;
end;
$$;

-- 3.3 ORDER_ITEMS
create table if not exists public.order_items (
  id bigint generated always as identity primary key,
  order_id text references public.orders(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  product_name text not null,
  product_sub text,
  qty int not null check (qty > 0),
  unit_price int not null check (unit_price >= 0)
);

-- 3.4 TRANSACTIONS
create table if not exists public.transactions (
  id text primary key, -- Format: TRX-xxxxxxxx
  user_id uuid references auth.users(id) on delete set null,
  order_id text references public.orders(id) on delete set null,
  amount int not null,
  date text,
  time text,
  status text check (status in ('success', 'failed')),
  payment_method text,
  recipient text,
  created_at timestamptz default now()
);

-- 3.5 WISHLISTS
create table if not exists public.wishlists (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  product_id text references public.products(id) on delete cascade,
  created_at timestamptz default now(),
  constraint wishlists_user_product_unique unique(user_id, product_id)
);

-- ==============================================================================
-- 4. INDEXES
-- ==============================================================================
create index if not exists idx_orders_user_id on public.orders(user_id);
create index if not exists idx_transactions_user_id on public.transactions(user_id);
create index if not exists idx_wishlists_user_id on public.wishlists(user_id);
create index if not exists idx_order_items_order_id on public.order_items(order_id);

-- ==============================================================================
-- 5. FUNGSI & TRIGGER ROLE OTOMATIS
-- ==============================================================================

-- 5.1 FUNGSI CURRENT USER ROLE (Memeriksa tabel admin, petugas, lalu users)
create or replace function public.current_user_role()
returns text as $$
declare
  v_role text;
begin
  select role into v_role from public.admin where id = auth.uid();
  if v_role is not null then
    return v_role;
  elsif exists (select 1 from public.petugas where id = auth.uid()) then
    return 'petugas';
  else
    return 'user';
  end if;
end;
$$ language plpgsql security definer stable;

-- 5.2 TRIGGER: Insert otomatis ke tabel role masing-masing saat register di auth.users
create or replace function public.handle_new_user()
returns trigger as $$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'user');
  v_name text := coalesce(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', '');
  v_phone text := coalesce(new.raw_user_meta_data->>'phone', '');
begin
  if v_role in ('admin', 'super_admin', 'superadmin') then
    insert into public.admin (id, email, username, name, phone, role, updated_at)
    values (new.id, new.email, v_name, v_name, v_phone, v_role, now())
    on conflict (id) do update set
      email = excluded.email,
      username = case when excluded.username <> '' then excluded.username else admin.username end,
      role = excluded.role,
      updated_at = now();
  elsif v_role = 'petugas' then
    insert into public.petugas (id, email, name, username, phone, role, updated_at)
    values (new.id, new.email, v_name, v_name, v_phone, 'petugas', now())
    on conflict (id) do update set
      email = excluded.email,
      name = case when excluded.name <> '' then excluded.name else petugas.name end,
      updated_at = now();
  else
    insert into public.users (id, email, name, full_name, phone, role, updated_at)
    values (new.id, new.email, v_name, v_name, v_phone, 'user', now())
    on conflict (id) do update set
      email = excluded.email,
      name = case when excluded.name <> '' then excluded.name else users.name end,
      full_name = case when excluded.full_name <> '' then excluded.full_name else users.full_name end,
      phone = case when excluded.phone <> '' then excluded.phone else users.phone end,
      updated_at = now();
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5.3 RPC ATOMIK: create_order
drop function if exists public.create_order(jsonb, text, text, text, text, text);

create or replace function public.create_order(
  p_items jsonb,
  p_delivery_method text default 'pickup',
  p_payment_method text default 'BCA',
  p_delivery_address text default null,
  p_order_id text default null,
  p_date text default null,
  p_rental_duration_days int default 1
)
returns jsonb as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id text;
  v_subtotal int := 0;
  v_delivery_fee int := 0;
  v_total int := 0;
  v_order_date text;
  v_return_deadline date;
  v_location text;
  v_item jsonb;
  v_prod_id text;
  v_qty int;
  v_prod record;
  v_created_items jsonb := '[]'::jsonb;
  v_res_order record;
  v_first_prod_name text := '';
  v_first_prod_sub text := '';
  v_first_unit_price int := 0;
begin
  if v_user_id is null then
    raise exception 'Akses ditolak: pengguna belum login.';
  end if;

  if p_delivery_method not in ('pickup', 'delivery') then
    raise exception 'Metode pengiriman tidak valid (harus pickup atau delivery).';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Pesanan harus memiliki minimal 1 item.';
  end if;

  if p_rental_duration_days is null or p_rental_duration_days < 1 or p_rental_duration_days > 365 then
    raise exception 'Durasi sewa harus antara 1 sampai 365 hari.';
  end if;

  v_return_deadline := (now() at time zone 'Asia/Jakarta')::date + p_rental_duration_days;

  -- Ongkos kirim
  if p_delivery_method = 'delivery' then
    v_delivery_fee := 20000;
    v_location := coalesce(p_delivery_address, 'Jl. Campy No. 1, Jakarta Selatan');
  else
    v_delivery_fee := 0;
    v_location := 'Campy Store (Jl. Campy No. 1, Jakarta)';
  end if;

  -- Generate order ID
  if p_order_id is not null and p_order_id <> '' then
    v_order_id := p_order_id;
  else
    v_order_id := '#ORD-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  -- Format tanggal
  if p_date is not null and p_date <> '' then
    v_order_date := p_date;
  else
    v_order_date := to_char((now() at time zone 'Asia/Jakarta')::date, 'DD/MM/YYYY') || ' – ' || to_char(v_return_deadline, 'DD/MM/YYYY');
  end if;

  -- Loop item: lock stok, validasi, kurangi stok, hitung harga dari DB
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 1);

    if v_qty <= 0 then
      raise exception 'Kuantitas produk tidak valid: %', v_qty;
    end if;

    select id, name, sub, price, stock
      into v_prod
      from public.products
     where id = v_prod_id
       for update;

    if not found then
      raise exception 'Produk dengan ID "%" tidak ditemukan.', v_prod_id;
    end if;

    if v_prod.stock < v_qty then
      raise exception 'Stok tidak mencukupi untuk % (stok tersedia: %, diminta: %).', v_prod.name, v_prod.stock, v_qty;
    end if;

    update public.products
       set stock = stock - v_qty
     where id = v_prod_id;

    if v_first_prod_name = '' then
      v_first_prod_name := v_prod.name;
      v_first_prod_sub := v_prod.sub;
      v_first_unit_price := v_prod.price;
    end if;

    v_subtotal := v_subtotal + (v_prod.price * v_qty);
  end loop;

  v_total := v_subtotal + v_delivery_fee;

  -- Insert order
  insert into public.orders (
    id,
    user_id,
    product_name,
    product_sub,
    qty,
    unit_price,
    subtotal,
    delivery_method,
    delivery_fee,
    total,
    date,
    status,
    location,
    payment_method,
    rental_duration_days,
    return_deadline,
    created_at
  ) values (
    v_order_id,
    v_user_id,
    v_first_prod_name,
    v_first_prod_sub,
    jsonb_array_length(p_items),
    v_first_unit_price,
    v_subtotal,
    p_delivery_method,
    v_delivery_fee,
    v_total,
    v_order_date,
    'active',
    v_location,
    p_payment_method,
    p_rental_duration_days,
    v_return_deadline,
    now()
  )
  returning * into v_res_order;

  -- Insert order items
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_prod_id := v_item->>'product_id';
    v_qty := coalesce((v_item->>'qty')::int, 1);

    select id, name, sub, price into v_prod from public.products where id = v_prod_id;

    insert into public.order_items (
      order_id,
      product_id,
      product_name,
      product_sub,
      qty,
      unit_price
    ) values (
      v_order_id,
      v_prod.id,
      v_prod.name,
      v_prod.sub,
      v_qty,
      v_prod.price
    );

    v_created_items := v_created_items || jsonb_build_object(
      'product_id', v_prod.id,
      'product_name', v_prod.name,
      'product_sub', v_prod.sub,
      'qty', v_qty,
      'unit_price', v_prod.price
    );
  end loop;

  return jsonb_build_object(
    'id', v_res_order.id,
    'user_id', v_res_order.user_id,
    'product_name', v_res_order.product_name,
    'subtotal', v_res_order.subtotal,
    'delivery_method', v_res_order.delivery_method,
    'delivery_fee', v_res_order.delivery_fee,
    'total', v_res_order.total,
    'date', v_res_order.date,
    'status', v_res_order.status,
    'location', v_res_order.location,
    'payment_method', v_res_order.payment_method,
    'rental_duration_days', v_res_order.rental_duration_days,
    'return_deadline', v_res_order.return_deadline,
    'return_photo_url', v_res_order.return_photo_url,
    'return_status', v_res_order.return_status,
    'created_at', v_res_order.created_at,
    'items', v_created_items
  );
end;
$$ language plpgsql security definer;

create or replace function public.submit_order_return(
  p_order_id text,
  p_photo_url text
)
returns jsonb as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'Akses ditolak: pengguna belum login.';
  end if;
  if p_photo_url is null or btrim(p_photo_url) = '' then
    raise exception 'Foto pengembalian wajib diunggah.';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
     and user_id = auth.uid()
   for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan atau bukan milik Anda.';
  end if;
  if v_order.status <> 'active' then
    raise exception 'Pengembalian hanya dapat diajukan untuk pesanan aktif.';
  end if;
  if v_order.return_status = 'pending_review' or v_order.return_status = 'approved' then
    raise exception 'Foto pengembalian sudah diajukan atau telah dikonfirmasi.';
  end if;

  update public.orders
     set return_photo_url = p_photo_url,
         return_status = 'pending_review'
   where id = p_order_id
   returning * into v_order;

  return to_jsonb(v_order);
end;
$$ language plpgsql security definer set search_path = public, auth;

create or replace function public.review_order_return(
  p_order_id text,
  p_decision text
)
returns jsonb as $$
declare
  v_order public.orders;
begin
  if public.current_user_role() not in ('admin', 'super_admin', 'superadmin', 'petugas') then
    raise exception 'Hanya petugas yang dapat mengonfirmasi pengembalian.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Keputusan harus approved atau rejected.';
  end if;

  select * into v_order
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    raise exception 'Pesanan tidak ditemukan.';
  end if;
  if v_order.return_status <> 'pending_review' or v_order.return_photo_url is null then
    raise exception 'Pesanan tidak memiliki pengajuan pengembalian yang menunggu konfirmasi.';
  end if;

  update public.orders
     set return_status = p_decision,
         status = case when p_decision = 'approved' then 'completed' else 'active' end
   where id = p_order_id
   returning * into v_order;

  return to_jsonb(v_order);
end;
$$ language plpgsql security definer set search_path = public, auth;

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ==============================================================================

alter table public.users enable row level security;
alter table public.admin enable row level security;
alter table public.petugas enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.transactions enable row level security;
alter table public.wishlists enable row level security;

-- 6.1 USERS TABLE POLICIES
drop policy if exists "users_select_own_or_admin" on public.users;
create policy "users_select_own_or_admin"
  on public.users for select
  using (auth.uid() = id or public.current_user_role() in ('admin', 'super_admin', 'superadmin'));

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users for update
  using (auth.uid() = id or public.current_user_role() in ('admin', 'super_admin', 'superadmin'))
  with check (auth.uid() = id or public.current_user_role() in ('admin', 'super_admin', 'superadmin'));

drop policy if exists "users_insert_own_or_admin" on public.users;
create policy "users_insert_own_or_admin"
  on public.users for insert
  with check (auth.uid() = id or public.current_user_role() in ('admin', 'super_admin', 'superadmin'));

-- 6.2 ADMIN TABLE POLICIES
drop policy if exists "admin_all_admin" on public.admin;
create policy "admin_all_admin"
  on public.admin for all
  using (public.current_user_role() in ('admin', 'super_admin', 'superadmin') or auth.uid() = id)
  with check (public.current_user_role() in ('admin', 'super_admin', 'superadmin') or auth.uid() = id);

-- 6.3 PETUGAS TABLE POLICIES
drop policy if exists "petugas_all_staff" on public.petugas;
create policy "petugas_all_staff"
  on public.petugas for all
  using (public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas') or auth.uid() = id)
  with check (public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas') or auth.uid() = id);

-- 6.4 PRODUCTS POLICIES
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  using (true);

drop policy if exists "products_all_staff" on public.products;
create policy "products_all_staff"
  on public.products for all
  using (public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'))
  with check (public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'));

-- 6.5 ORDERS POLICIES
drop policy if exists "orders_select_own_or_staff" on public.orders;
create policy "orders_select_own_or_staff"
  on public.orders for select
  using (auth.uid() = user_id or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'));

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
  on public.orders for insert
  with check (auth.uid() = user_id or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'));

drop policy if exists "orders_update_status" on public.orders;
create policy "orders_update_status"
  on public.orders for update
  using (
    public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas')
    or (auth.uid() = user_id and status = 'cancelled')
  );

-- 6.6 ORDER_ITEMS POLICIES
drop policy if exists "order_items_select" on public.order_items;
create policy "order_items_select"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (o.user_id = auth.uid() or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'))
    )
  );

drop policy if exists "order_items_insert" on public.order_items;
create policy "order_items_insert"
  on public.order_items for insert
  with check (
    exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (o.user_id = auth.uid() or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'))
    )
  );

-- 6.7 TRANSACTIONS POLICIES
drop policy if exists "transactions_select_own_or_staff" on public.transactions;
create policy "transactions_select_own_or_staff"
  on public.transactions for select
  using (auth.uid() = user_id or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'));

drop policy if exists "transactions_insert_own" on public.transactions;
create policy "transactions_insert_own"
  on public.transactions for insert
  with check (auth.uid() = user_id or public.current_user_role() in ('admin', 'super_admin', 'superadmin', 'petugas'));

-- 6.8 WISHLISTS POLICIES
drop policy if exists "wishlists_all_own" on public.wishlists;
create policy "wishlists_all_own"
  on public.wishlists for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ==============================================================================
-- 7. SEED DATA (9 PRODUK KATALOG LENGKAP CAMPY)
-- ==============================================================================

insert into public.products (
  id,
  name,
  sub,
  category,
  category_slug,
  price,
  is_special_offer,
  icon,
  asset,
  image_url,
  stock,
  description
) values
  ('prod-1', 'Camping Tent', '2 Person Tent', 'Shelter & Sleeping', 'shelter', 150000, true, 'cabin', null, null, 12, 'Tenda camping 2 orang tahan air (3000mm) yang ringan dan mudah didirikan.'),
  ('prod-2', 'Family Tent', '4 Person Tent', 'Shelter & Sleeping', 'shelter', 250000, false, 'house', null, null, 8, 'Tenda keluarga 4 orang dengan ruang tidur luas dan teras depan untuk perlengkapan.'),
  ('prod-3', 'Sleeping Bag', 'Outdoor Sleeping', 'Shelter & Sleeping', 'shelter', 75000, true, 'bed', null, null, 20, 'Sleeping bag thermal hangat hingga suhu 5°C, nyaman dan mudah dipadatkan.'),
  ('prod-4', 'Portable Stove', 'Camping Stove', 'Camp Kitchen & Cooking', 'kitchen', 50000, false, 'local_fire_department', null, null, 15, 'Kompor gas portable dengan pelindung angin dan pemantik otomatis.'),
  ('prod-5', 'Cooking Set', 'Outdoor Cooking', 'Camp Kitchen & Cooking', 'kitchen', 65000, false, 'soup_kitchen', null, null, 14, 'Satu set nesting peralatan masak aluminium lengkap untuk outdoor.'),
  ('prod-6', 'Camping Lantern', 'LED Lantern', 'Lighting & Power', 'lighting', 35000, false, 'lightbulb', null, null, 25, 'Lampu camping LED 360 derajat rechargeable dengan fungsi powerbank darurat.'),
  ('prod-7', 'Flashlight', 'Portable Light', 'Lighting & Power', 'lighting', 20000, false, 'flashlight_on', null, null, 30, 'Senter taktikal LED fokus zoom dengan bodi aluminium tahan air.'),
  ('prod-8', 'Hiking Backpack', 'Outdoor Backpack', 'Apparel & Personal Gear', 'apparel', 80000, false, 'backpack', null, null, 10, 'Tas gunung carrier kapasitas 50L ergonomis dilengkapi rain cover.'),
  ('prod-9', 'Hiking Jacket', 'Outdoor Apparel', 'Apparel & Personal Gear', 'apparel', 60000, false, 'checkroom', null, null, 16, 'Jaket gunung windproof & water-resistant cocok untuk pendakian dingin.')
on conflict (id) do update set
  name = excluded.name,
  sub = excluded.sub,
  category = excluded.category,
  category_slug = excluded.category_slug,
  price = excluded.price,
  is_special_offer = excluded.is_special_offer,
  icon = excluded.icon,
  stock = excluded.stock,
  description = excluded.description;

-- ==============================================================================
-- 8. STORAGE BUCKET: product-images
-- ==============================================================================

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

drop policy if exists "product_images_staff_insert" on storage.objects;
create policy "product_images_staff_insert"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and public.current_user_role() in ('admin', 'petugas')
  );

drop policy if exists "product_images_staff_update" on storage.objects;
create policy "product_images_staff_update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and public.current_user_role() in ('admin', 'petugas')
  );

drop policy if exists "product_images_staff_delete" on storage.objects;
create policy "product_images_staff_delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and public.current_user_role() in ('admin', 'petugas')
  );
