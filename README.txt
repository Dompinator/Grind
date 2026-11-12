GRIND v0.3 — Multiplayer Meme Currency Market (Premium + English)
================================================================

Complete version for GitHub Pages + Supabase.

NEW IN v0.3
- Full English UI with premium design (gradients, shadows, better polish)
- Global page with Top 100 leaderboards:
  - Net Worth
  - Time Played (automatically tracked while logged in)
- Fixed auth tabs & button text
- Net worth is updated after every trade

SETUP

1. Run this SQL in Supabase SQL Editor (add the new columns if you already have the old tables):

-- Add columns if missing
alter table profiles add column if not exists net_worth numeric default 15;
alter table profiles add column if not exists time_played integer default 0;

-- Full schema (safe to run if tables already exist with IF NOT EXISTS)
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  avatar_url text,
  cash numeric default 15,
  is_premium boolean default false,
  net_worth numeric default 15,
  time_played integer default 0,
  created_at timestamptz default now()
);

create table if not exists coins (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references profiles(id),
  name text not null,
  ticker text unique not null,
  description text,
  image_url text,
  price numeric default 1,
  change_pct numeric default 0,
  created_at timestamptz default now()
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  coin_id uuid references coins(id) on delete cascade,
  user_id uuid references profiles(id),
  type text check (type in ('buy','sell')),
  amount_usd numeric,
  shares numeric,
  price_after numeric,
  created_at timestamptz default now()
);

create table if not exists holdings (
  user_id uuid references profiles(id),
  coin_id uuid references coins(id),
  shares numeric default 0,
  primary key (user_id, coin_id)
);

create table if not exists premium_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  reason text,
  status text default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz default now()
);

-- Policies (demo – tighten later)
alter table profiles enable row level security;
alter table coins enable row level security;
alter table trades enable row level security;
alter table holdings enable row level security;
alter table premium_requests enable row level security;

create policy "Public read coins" on coins for select using (true);
create policy "Auth insert coins" on coins for insert with check (auth.uid() = creator_id);
create policy "Auth update coins" on coins for update using (true);

create policy "Public read trades" on trades for select using (true);
create policy "Auth insert trades" on trades for insert with check (auth.uid() = user_id);

create policy "Own holdings" on holdings for all using (auth.uid() = user_id);
create policy "Own profile" on profiles for all using (auth.uid() = id);
create policy "Public read profiles" on profiles for select using (true);

create policy "Own requests" on premium_requests for all using (auth.uid() = user_id);
create policy "Admin read requests" on premium_requests for select using (true);
create policy "Admin update requests" on premium_requests for update using (true);

2. Enable Realtime on coins and trades tables.

3. In Authentication → Providers → Email:
   - Turn OFF "Confirm email" for easier testing (otherwise users must confirm email).

4. Upload index.html, app.js, styles.css to GitHub Pages.

IMPORTANT
- Create an account named exactly "Dompinator" to access the Notifications / admin page.
- If login/signup fails, replace the SUPABASE_ANON_KEY in app.js with your real anon public key from Project Settings → API.
- Images are stored as data URLs (keep under ~400 KB).

Enjoy GRIND!
