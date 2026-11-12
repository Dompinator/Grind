GRIND v0.3.5 — Multiplayer Meme Currency Market (GitHub Pages + Supabase)
========================================================================

Complete version ready for GitHub Pages & Supabase.

NEW IN THIS VERSION:
- Currency Creation Bug Fix:
  - Fixed coin creation errors and added automatic image compression.
  - Clicking either the big preview box or the upload link opens the file chooser.
  - Automatically downsamples high-resolution photos to lightweight WebP/JPEG data URLs
    so any phone/desktop picture works without failing database limits.
- Account Settings (Username & PFP):
  - In the Account menu, enter your desired username and click "Save username" (or hit Enter).
  - Upload your custom Profile Picture (PFP). It automatically resizes and updates across the UI.
- Dynamic Price Sensitivity (Bonding Curve):
  - When current price is low (e.g. around $1.00), buying shares makes a HUGE difference
    (e.g. +$2.20 / +220% jump on a $10 buy).
  - When current price is high (e.g. around $50.00), the exact same buy makes a tiny difference
    (e.g. +$0.016 / +0.03% jump).
  - High price creates liquidity resistance just like real memecoin bonding curves!
- Timeline Trade Bubbles on Every Currency:
  - Interactive price graph with horizontal scroll for every currency.
  - Each trade plots a bubble on the timeline containing your PFP and the dollar amount (+/$).
  - Hovering/clicking the bubble shows full trade info (trader, amount, shares, price after trade).
  - Works on all community coins!

------------------------------------------------------------------------
SUPABASE SETUP & SQL PERMISSIONS
------------------------------------------------------------------------

Run this complete SQL in your Supabase SQL Editor:

-- 1. Table definitions
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  email text,
  avatar_url text,
  cash numeric default 50,
  is_premium boolean default false,
  net_worth numeric default 50,
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

-- 2. IMPORTANT: Role Grants (Fixes Postgres Error 42501 "permission denied for table")
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

-- 3. Row Level Security Policies
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

------------------------------------------------------------------------
GITHUB PAGES DEPLOYMENT
------------------------------------------------------------------------
Push these 4 files to your GitHub repository:
- index.html
- styles.css
- app.js
- README.txt

In GitHub repo Settings -> Pages -> Source: select Deploy from branch (main / root).
Your app is live on GitHub!
