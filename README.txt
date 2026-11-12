GRIND v0.2 — Multiplayer Meme Currency Market
=============================================

Det här är en komplett version redo för GitHub Pages + Supabase.

VAD SOM ÄR NYTT
- Multiplayer via Supabase (alla ser samma coins och priser)
- Alltid startar på $1. Infinite supply (ingen starting value/supply)
- Roligare pris-impact: mer rörelse när priset är lågt
- Chart med bubblor: PFP dyker upp på tidslinjen vid varje köp/sälj
- Premium-system: Normal = max 1 coin, Premium = max 3
- Bara kontot med användarnamnet "Dompinator" ser Notiser och kan godkänna/neka premium-requests

SÅ HÄR SÄTTER DU UPP DET

1. Skapa tabellerna i Supabase
   Gå till https://supabase.com → ditt projekt (zcrkywpyjrofphxnxtlc) → SQL Editor → New query
   Klistra in och kör det här:

-- Profiles
create table if not exists profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  avatar_url text,
  cash numeric default 15,
  is_premium boolean default false,
  created_at timestamptz default now()
);

-- Coins
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

-- Trades
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

-- Holdings
create table if not exists holdings (
  user_id uuid references profiles(id),
  coin_id uuid references coins(id),
  shares numeric default 0,
  primary key (user_id, coin_id)
);

-- Premium requests
create table if not exists premium_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  reason text,
  status text default 'pending' check (status in ('pending','approved','denied')),
  created_at timestamptz default now()
);

-- Enkla policies (gör det öppet för demo – skärp gärna senare)
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

-- Aktivera Realtime (viktigt för live!)
-- Gå till Database → Replication och aktivera för coins och trades, eller kör:
-- alter publication supabase_realtime add table coins;
-- alter publication supabase_realtime add table trades;

2. Auth-inställningar
   I Supabase → Authentication → Providers → Email: se till att Email är på.
   (Användare loggar in med användarnamn, systemet gör username@grind.app som email internt.)

3. Ladda upp till GitHub Pages
   - Skapa ett nytt repo (eller använd befintligt)
   - Ladda upp filerna: index.html, app.js, styles.css
   - Gå till Settings → Pages → Deploy from branch (main / root)
   - Klart! Sidan är live.

VIKTIGT
- Skapa ett konto med användarnamnet exakt "Dompinator" för att få admin/notiser.
- Bilder sparas som data-URL i databasen (håll under ~400 KB).
- Om något inte funkar: kolla browser console (F12) för felmeddelanden.
- Realtime måste vara aktiverat på tabellerna coins och trades för att alla ska se uppdateringar direkt.

Lycka till med GRIND!
