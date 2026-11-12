// ============================================================
// GRIND v0.3.5 — Multiplayer · Premium · English
// ============================================================
const SUPABASE_URL = 'https://zcrkywpyjrofphxnxtlc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PKSD898kwnfs6msIDiW9_g_yeoTBduD';

let sb;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error('Supabase init failed:', e);
}

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let currentUser = null;
let coins = [];
let selectedCoin = null;
let selectedAmount = 5;
let feedMode = 'new';
let lbMode = 'networth';
let pendingCoinImage = null;
let realtimeChannel = null;
let sessionStart = null;
let timeInterval = null;

// ---------- Helpers ----------
function money(n) { return '$' + Number(n || 0).toFixed(2); }
function priceFmt(n) {
  n = Number(n || 0);
  return '$' + n.toFixed(n < 1 ? 4 : 2);
}
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}
function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}
function isDompinator() {
  return currentUser && currentUser.username.toLowerCase() === 'dompinator';
}
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------- Auth (robust) ----------
function setAuthMode(mode) {
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === mode));
  const btn = document.getElementById('authSubmit');
  if (btn) btn.textContent = mode === 'signup' ? 'Create account' : 'Log in';
  const pw = document.getElementById('authPassword');
  if (pw) pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  const msg = document.getElementById('authMessage');
  if (msg) msg.textContent = '';
}
window.setAuthMode = setAuthMode;

function attachAuthListeners() {
  document.querySelectorAll('.auth-tab').forEach(b => {
    b.onclick = () => setAuthMode(b.dataset.auth);
  });
}
attachAuthListeners();
document.addEventListener('DOMContentLoaded', attachAuthListeners);

// Build a unique default username from the email (user can change it in Account)
async function makeUniqueUsername(email) {
  let base = (email.split('@')[0] || 'player').replace(/[^A-Za-z0-9_]/g, '').slice(0, 14);
  if (base.length < 3) base = (base + 'user').slice(0, 14);
  let name = base;
  for (let i = 0; i < 6; i++) {
    const { data } = await sb.from('profiles').select('id').ilike('username', name).maybeSingle();
    if (!data) return name;
    name = base + Math.floor(1000 + Math.random() * 9000);
  }
  return base + Date.now().toString().slice(-5);
}

async function createProfile(user) {
  const username = await makeUniqueUsername(user.email);
  return sb.from('profiles').insert({
    id: user.id,
    username,
    email: user.email,
    cash: 15,
    is_premium: false,
    net_worth: 15,
    time_played: 0
  });
}

$('#authForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb) return authMsg('Supabase not ready. Check your API key in app.js.');
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const mode = document.querySelector('.auth-tab.active')?.dataset.auth || 'login';
  if (!email || !email.includes('@')) return authMsg('Please enter a valid email.');

  if (mode === 'signup') {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return authMsg(error.message);
    if (!data.user) return authMsg('Signup failed. Try again.');

    // Log in (needed before we may create the profile row)
    const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
    if (loginErr) {
      authMsg('Account created! Check your email to confirm, then log in.');
      setAuthMode('login');
      return;
    }
    await loadProfile();   // creates the profile with an auto username if missing
    enterApp();
    toast('Welcome to GRIND! Set your username under Account.');
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return authMsg('Wrong email or password.');
    await loadProfile();
    enterApp();
  }
});

function authMsg(s) {
  const el = $('#authMessage');
  if (el) el.textContent = s;
}

async function loadProfile() {
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data, error } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (error || !data) {
    const { error: cErr } = await createProfile(user);
    if (cErr) { authMsg('Profile error: ' + cErr.message); return; }
    return loadProfile();
  }
  currentUser = data;
  updateUIProfile();
}

function updateUIProfile() {
  if (!currentUser) return;
  $('#sideName').textContent = currentUser.username;
  $('#sidePremium').textContent = currentUser.is_premium ? 'Premium' : 'Member';
  const av = currentUser.avatar_url ? `<img src="${escapeHtml(currentUser.avatar_url)}">` : escapeHtml(currentUser.username[0].toUpperCase());
  $('#sideAvatar').innerHTML = av;
  $('#topAvatar').innerHTML = av;
  $('#topCash').textContent = money(currentUser.cash);
  $('#moneyCash').textContent = money(currentUser.cash);
  $('#profileInitial').textContent = currentUser.username[0].toUpperCase();
  const un = $('#accountUsername');
  if (un && document.activeElement !== un) un.value = currentUser.username;
  if (currentUser.avatar_url) {
    $('#profilePreview').src = currentUser.avatar_url;
    $('#profilePreview').classList.remove('hidden');
    $('#profileInitial').classList.add('hidden');
  }
  $('#navNotifications').classList.toggle('hidden', !isDompinator());
  updatePremiumSection();
}

function enterApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  showPage('feed');
  startRealtime();
  loadCoins();
  startTimeTracking();
}

function startTimeTracking() {
  sessionStart = Date.now();
  if (timeInterval) clearInterval(timeInterval);
  timeInterval = setInterval(async () => {
    if (!currentUser || !sb) return;
    const add = 30; // seconds
    const newTime = (currentUser.time_played || 0) + add;
    currentUser.time_played = newTime;
    await sb.from('profiles').update({ time_played: newTime }).eq('id', currentUser.id);
  }, 30000);
  window.addEventListener('beforeunload', saveTimeOnExit);
}

async function saveTimeOnExit() {
  if (!currentUser || !sessionStart || !sb) return;
  const extra = Math.floor((Date.now() - sessionStart) / 1000);
  if (extra > 5) {
    await sb.from('profiles').update({ time_played: (currentUser.time_played || 0) + extra }).eq('id', currentUser.id);
  }
}

$('#logoutBtn')?.addEventListener('click', async () => {
  await saveTimeOnExit();
  if (timeInterval) clearInterval(timeInterval);
  if (sb) await sb.auth.signOut();
  currentUser = null;
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  setAuthMode('login');
});

// ---------- Navigation ----------
function showPage(page) {
  $$('.page').forEach(p => p.classList.add('hidden'));
  const target = $('#page-' + page);
  if (target) target.classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = {
    feed: 'Discover currencies',
    create: 'Create currency',
    money: 'Your money',
    global: 'Global leaderboards',
    account: 'Account settings',
    notifications: 'Notifications',
    coin: 'Currency'
  };
  $('#pageTitle').textContent = titles[page] || 'GRIND';
  if (page === 'feed') renderFeed();
  if (page === 'money') renderMoney();
  if (page === 'global') renderLeaderboard();
  if (page === 'account') updatePremiumSection();
  if (page === 'notifications' && isDompinator()) loadRequests();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.goto)));
$$('.feed-tab').forEach(b => {
  if (b.dataset.feed) {
    b.addEventListener('click', () => {
      feedMode = b.dataset.feed;
      $$('.feed-tab[data-feed]').forEach(x => x.classList.toggle('active', x === b));
      renderFeed();
    });
  }
  if (b.dataset.lb) {
    b.addEventListener('click', () => {
      lbMode = b.dataset.lb;
      $$('.feed-tab[data-lb]').forEach(x => x.classList.toggle('active', x === b));
      renderLeaderboard();
    });
  }
});

// ---------- Coins & Feed ----------
async function loadCoins() {
  if (!sb) return;
  const { data, error } = await sb.from('coins').select('*').order('created_at', { ascending: false });
  if (!error) coins = data || [];
  renderFeed();
}

function renderFeed() {
  let list = [...coins];
  if (feedMode === 'new') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (feedMode === 'popular') list.sort((a, b) => (b.trade_count || 0) - (a.trade_count || 0));
  if (feedMode === 'cheap') list.sort((a, b) => a.price - b.price);
  $('#feedGrid').innerHTML = list.map(c => `
    <article class="coin-card" data-coin="${c.id}">
      <div class="coin-top">
        <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml(c.ticker[0])}</div>
        <div>
          <div class="coin-name">${escapeHtml(c.name)}</div>
          <div class="coin-ticker">$${escapeHtml(c.ticker)}</div>
        </div>
      </div>
      <div class="coin-price">${priceFmt(c.price)}</div>
      <div class="coin-change ${(c.change_pct || 0) >= 0 ? 'up' : 'down'}">${(c.change_pct || 0) >= 0 ? '↗ +' : '↘ '}${Number(c.change_pct || 0).toFixed(2)}% today</div>
      <p class="coin-desc">${escapeHtml(c.description || 'Community currency.')}</p>
    </article>
  `).join('');
  $('#emptyFeed').classList.toggle('hidden', list.length > 0);
  $('#feedGrid').classList.toggle('hidden', list.length === 0);
  $$('.coin-card').forEach(card => card.addEventListener('click', () => openCoin(card.dataset.coin)));
}

$('#coinImage')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 400 * 1024) return toast('Image must be under 400 KB');
  const r = new FileReader();
  r.onload = () => {
    pendingCoinImage = r.result;
    $('#coinPreview').innerHTML = `<img src="${r.result}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`;
  };
  r.readAsDataURL(file);
});

$('#createForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser || !sb) return;
  const { count } = await sb.from('coins').select('*', { count: 'exact', head: true }).eq('creator_id', currentUser.id);
  const max = currentUser.is_premium ? 3 : 1;
  if (count >= max) return $('#createMessage').textContent = `Max ${max} coin${max > 1 ? 's' : ''} for your account.`;

  const name = $('#coinName').value.trim();
  const ticker = $('#coinTicker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ticker) return $('#createMessage').textContent = 'Invalid ticker.';
  const description = $('#coinDescription').value.trim();

  const { error } = await sb.from('coins').insert({
    creator_id: currentUser.id,
    name,
    ticker,
    description,
    image_url: pendingCoinImage,
    price: 1,
    change_pct: 0
  });

  if (error) return $('#createMessage').textContent = error.message;
  pendingCoinImage = null;
  $('#createForm').reset();
  $('#coinPreview').textContent = '＋';
  $('#createMessage').textContent = 'Currency created!';
  toast('Your coin is live!');
  await loadCoins();
  showPage('feed');
});

// ---------- Coin detail + trading ----------
async function openCoin(id) {
  selectedCoin = coins.find(c => c.id === id);
  if (!selectedCoin) return;
  showPage('coin');
  await renderCoinDetail();
}

async function renderCoinDetail() {
  if (!selectedCoin || !currentUser || !sb) return;
  const c = selectedCoin;
  const { data: hold } = await sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', c.id).maybeSingle();
  const shares = hold?.shares || 0;

  const { data: trades } = await sb.from('trades')
    .select('*, profiles(username, avatar_url)')
    .eq('coin_id', c.id)
    .order('created_at', { ascending: false })
    .limit(100);

  $('#coinDetail').innerHTML = `
    <div class="coin-detail-hero">
      <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml(c.ticker[0])}</div>
      <div>
        <h3>${escapeHtml(c.name)} <span class="muted">$${escapeHtml(c.ticker)}</span></h3>
        <p>${escapeHtml(c.description || '')}</p>
        <p class="muted tiny">Community created</p>
      </div>
    </div>
    <div class="detail-price">${priceFmt(c.price)}</div>
    <div class="coin-change ${(c.change_pct || 0) >= 0 ? 'up' : 'down'}">${(c.change_pct || 0) >= 0 ? '↗ +' : '↘ '}${Number(c.change_pct || 0).toFixed(2)}%</div>
    <div class="chart-wrap">
      <div class="chart-head"><strong>Price history + trades</strong><span class="muted tiny">Bubbles = who bought / sold &amp; for how much</span></div>
      <div class="chart-scroll" id="chartScroll"><div class="chart-inner" id="chartInner"><canvas id="priceChart"></canvas></div></div>
    </div>
    <div class="trade-panel">
      <h3>Trade $${escapeHtml(c.ticker)}</h3>
      <div class="trade-buttons">
        ${[1, 5, 10, 25, 50].map(n => `<button class="amount-btn ${n === selectedAmount ? 'active' : ''}" data-buy="${n}">$${n}</button>`).join('')}
      </div>
      <div class="trade-actions">
        <button class="buy-btn" id="buyBtn">Buy ${money(selectedAmount)}</button>
        <button class="sell-btn" id="sellBtn">Sell 25%</button>
      </div>
      <p class="muted tiny" style="margin-top:10px">You own: ${shares.toFixed(4)} shares · Worth ${money(shares * c.price)} · Cash ${money(currentUser.cash)}</p>
      <p class="form-message" id="tradeMessage"></p>
    </div>
  `;

  $$('[data-buy]').forEach(b => b.addEventListener('click', () => {
    selectedAmount = Number(b.dataset.buy);
    $$('[data-buy]').forEach(x => x.classList.toggle('active', x === b));
    $('#buyBtn').textContent = `Buy ${money(selectedAmount)}`;
  }));
  $('#buyBtn')?.addEventListener('click', () => buy(c, selectedAmount));
  $('#sellBtn')?.addEventListener('click', () => sell(c, shares * 0.25));

  drawChartWithBubbles(c, (trades || []).slice().reverse());
}

// Market impact: every dollar moves the price by a fixed amount (1/LIQUIDITY),
// so the RELATIVE change = amount / (price * LIQUIDITY).
//   $10 buy at $1   -> +$0.67  = +67%   (huge)
//   $5  buy at $50  -> +$0.33  = +0.67% (tiny)
const LIQUIDITY = 15;
function calculateImpact(amount, price) {
  return amount / (Math.max(price, 0.0001) * LIQUIDITY);   // fraction, e.g. 0.67 = +67%
}

async function updateNetWorth() {
  if (!currentUser || !sb) return;
  const { data: holds } = await sb.from('holdings').select('shares, coins(price)').eq('user_id', currentUser.id);
  const portValue = (holds || []).reduce((s, h) => s + (h.shares || 0) * (h.coins?.price || 0), 0);
  const nw = currentUser.cash + portValue;
  currentUser.net_worth = nw;
  await sb.from('profiles').update({ net_worth: nw }).eq('id', currentUser.id);
  $('#totalValue').textContent = money(nw);
}

async function freshCoin(coin) {
  const { data } = await sb.from('coins').select('*').eq('id', coin.id).single();
  return data || coin;
}

async function buy(coin, amount) {
  if (!currentUser || currentUser.cash < amount) return $('#tradeMessage').textContent = 'Not enough cash.';
  coin = await freshCoin(coin);   // use the live price, not a stale one
  const impact = calculateImpact(amount, coin.price);
  const newPrice = coin.price * (1 + impact);
  const shares = amount / coin.price;
  const newCash = currentUser.cash - amount;

  const { error: cashErr } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  if (cashErr) return $('#tradeMessage').textContent = 'Cash error: ' + cashErr.message;

  await sb.from('coins').update({ price: newPrice, change_pct: (coin.change_pct || 0) + impact * 100 }).eq('id', coin.id);

  const { data: existing } = await sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const newShares = (existing?.shares || 0) + shares;
  await sb.from('holdings').upsert({ user_id: currentUser.id, coin_id: coin.id, shares: newShares });

  const { error: tErr } = await sb.from('trades').insert({
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'buy',
    amount_usd: amount,
    shares,
    price_after: newPrice
  });
  if (tErr) toast('Trade log error: ' + tErr.message);

  currentUser.cash = newCash;
  coin.price = newPrice;
  coin.change_pct = (coin.change_pct || 0) + impact * 100;
  updateUIProfile();
  await updateNetWorth();
  toast(`Bought for ${money(amount)}! Price ${priceFmt(coin.price)} (+${(impact * 100).toFixed(impact < 0.1 ? 2 : 0)}%)`);
  await loadCoins();
  selectedCoin = coins.find(x => x.id === coin.id) || coin;
  renderCoinDetail();
}

async function sell(coin, sharesToSell) {
  if (!currentUser || sharesToSell <= 0) return $('#tradeMessage').textContent = 'No shares to sell.';
  coin = await freshCoin(coin);
  const { data: hold } = await sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const owned = hold?.shares || 0;
  const sellShares = Math.min(sharesToSell, owned);
  if (sellShares <= 0) return;
  const proceeds = sellShares * coin.price;
  const impact = calculateImpact(proceeds, coin.price) * 0.6;
  const newPrice = Math.max(0.01, coin.price / (1 + impact));   // never drops below 0 / over 100%
  const newCash = currentUser.cash + proceeds;

  await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  await sb.from('coins').update({ price: newPrice, change_pct: (coin.change_pct || 0) - (1 - newPrice / coin.price) * 100 }).eq('id', coin.id);
  await sb.from('holdings').update({ shares: owned - sellShares }).eq('user_id', currentUser.id).eq('coin_id', coin.id);
  await sb.from('trades').insert({
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'sell',
    amount_usd: proceeds,
    shares: sellShares,
    price_after: newPrice
  });

  currentUser.cash = newCash;
  coin.price = newPrice;
  updateUIProfile();
  await updateNetWorth();
  toast(`Sold for ${money(proceeds)}`);
  await loadCoins();
  selectedCoin = coins.find(x => x.id === coin.id) || coin;
  renderCoinDetail();
}

function drawChartWithBubbles(coin, trades) {
  const canvas = $('#priceChart');
  const inner = $('#chartInner');
  const scroll = $('#chartScroll');
  if (!canvas || !inner || !scroll) return;

  const STEP = 78;                     // px per trade -> bubbles never overlap
  const PAD_X = 46, PAD_TOP = 64, PAD_BOT = 24;
  const H = 300;
  const W = Math.max(scroll.clientWidth, PAD_X * 2 + Math.max(trades.length, 1) * STEP);
  inner.style.width = W + 'px';
  inner.style.height = H + 'px';

  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // Points: start at $1 (creation), then one point per trade (works for every coin)
  const points = [{ price: 1, trade: null }];
  trades.forEach(t => points.push({ price: Number(t.price_after) || coin.price, trade: t }));
  if (!trades.length) points.push({ price: Number(coin.price), trade: null });

  const prices = points.map(p => p.price);
  let min = Math.min(...prices), max = Math.max(...prices);
  if (max === min) { min *= 0.9; max *= 1.1; }
  const padv = (max - min) * 0.08;
  min -= padv; max += padv;
  const plotH = H - PAD_TOP - PAD_BOT;
  const xAt = i => points.length === 1 ? W / 2 : PAD_X + (i * (W - PAD_X * 2)) / (points.length - 1);
  const yAt = p => PAD_TOP + plotH - ((p - min) / (max - min)) * plotH;

  // grid + price labels
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(190,165,225,.55)';
  ctx.strokeStyle = 'rgba(190,165,225,.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD_TOP + (plotH * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    const val = max - ((max - min) * i) / 4;
    ctx.fillText('$' + val.toFixed(val < 1 ? 3 : 2), 4, y - 3);
  }

  // line
  ctx.beginPath();
  points.forEach((p, i) => { const x = xAt(i), y = yAt(p.price); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // dots
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xAt(i), yAt(p.price), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = p.trade?.type === 'sell' ? '#f87171' : '#34d399';
    ctx.fill();
  });

  // bubbles: profile picture + amount
  inner.querySelectorAll('.bubble').forEach(b => b.remove());
  points.forEach((p, i) => {
    const t = p.trade;
    if (!t) return;
    const isBuy = t.type !== 'sell';
    const name = t.profiles?.username || 'Someone';
    const avatar = t.profiles?.avatar_url;
    const amt = Number(t.amount_usd || 0);
    const b = document.createElement('div');
    b.className = 'bubble ' + (isBuy ? 'buy' : 'sell');
    b.style.left = xAt(i) + 'px';
    b.style.top = (yAt(p.price) - 8) + 'px';
    b.innerHTML = `
      <div class="bubble-pfp">${avatar ? `<img src="${escapeHtml(avatar)}" alt="">` : `<span>${escapeHtml(name[0].toUpperCase())}</span>`}</div>
      <div class="bubble-amt">${isBuy ? '' : '−'}${money(amt)}</div>`;
    b.title = `${name} ${isBuy ? 'bought' : 'sold'} ${money(amt)} · price after ${priceFmt(t.price_after)}`;
    inner.appendChild(b);
  });

  scroll.scrollLeft = scroll.scrollWidth;   // show the latest trades
}

// ---------- Money / Portfolio ----------
async function renderMoney() {
  if (!currentUser || !sb) return;
  const { data: holds } = await sb.from('holdings').select('*, coins(name, ticker, price, image_url)').eq('user_id', currentUser.id).gt('shares', 0);
  const list = holds || [];
  const value = list.reduce((s, h) => s + h.shares * (h.coins?.price || 0), 0);
  $('#portfolioValue').textContent = money(value);
  $('#totalValue').textContent = money(value + currentUser.cash);
  $('#holdingsList').innerHTML = list.map(h => `
    <div class="holding" data-coin="${h.coin_id}">
      <div class="holding-left">
        <div class="coin-logo">${h.coins?.image_url ? `<img src="${escapeHtml(h.coins.image_url)}">` : (h.coins?.ticker || '?')[0]}</div>
        <div>
          <strong>${escapeHtml(h.coins?.name || '')}</strong>
          <div class="muted tiny">${h.shares.toFixed(4)} $${escapeHtml(h.coins?.ticker || '')}</div>
        </div>
      </div>
      <div class="holding-right">
        <strong>${money(h.shares * (h.coins?.price || 0))}</strong>
      </div>
    </div>
  `).join('');
  $('#emptyHoldings').classList.toggle('hidden', list.length > 0);
  $$('.holding').forEach(el => el.addEventListener('click', () => openCoin(el.dataset.coin)));
}

// ---------- Global Leaderboards ----------
async function renderLeaderboard() {
  if (!sb) return;
  let query = sb.from('profiles').select('username, avatar_url, net_worth, time_played, is_premium');
  if (lbMode === 'networth') {
    query = query.order('net_worth', { ascending: false }).limit(100);
  } else {
    query = query.order('time_played', { ascending: false }).limit(100);
  }
  const { data, error } = await query;
  const list = data || [];
  $('#leaderboardList').innerHTML = list.map((p, i) => `
    <div class="lb-row">
      <div class="lb-rank ${i < 3 ? 'top3' : ''}">#${i + 1}</div>
      <div class="avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div class="lb-info">
        <strong>${escapeHtml(p.username || 'Unknown')} ${p.is_premium ? '★' : ''}</strong>
        <div class="muted tiny">${lbMode === 'networth' ? 'Net worth' : 'Time played'}</div>
      </div>
      <div class="lb-value">${lbMode === 'networth' ? money(p.net_worth || 0) : formatTime(p.time_played || 0)}</div>
    </div>
  `).join('');
  $('#emptyLeaderboard').classList.toggle('hidden', list.length > 0);
}

// ---------- Username (Account menu) ----------
$('#saveUsernameBtn')?.addEventListener('click', async () => {
  if (!currentUser || !sb) return;
  const msg = $('#accountMessage');
  const name = $('#accountUsername').value.trim();
  if (!/^[A-Za-z0-9_]{3,20}$/.test(name)) { msg.textContent = 'Username: 3–20 characters, letters/numbers/underscore only.'; return; }
  if (name === currentUser.username) { msg.textContent = ''; return toast('That is already your username.'); }
  const { data: taken } = await sb.from('profiles').select('id').ilike('username', name).neq('id', currentUser.id).maybeSingle();
  if (taken) { msg.textContent = 'That username is taken.'; return; }
  const { error } = await sb.from('profiles').update({ username: name }).eq('id', currentUser.id);
  if (error) { msg.textContent = error.code === '23505' ? 'That username is taken.' : error.message; return; }
  currentUser.username = name;
  msg.textContent = '';
  updateUIProfile();
  toast('Username saved!');
});

// ---------- Profile image ----------
$('#profileImage')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || file.size > 400 * 1024) return toast('Image must be under 400 KB');
  const r = new FileReader();
  r.onload = async () => {
    const dataUrl = r.result;
    const { error } = await sb.from('profiles').update({ avatar_url: dataUrl }).eq('id', currentUser.id);
    if (!error) {
      currentUser.avatar_url = dataUrl;
      updateUIProfile();
      toast('Profile picture updated!');
    }
  };
  r.readAsDataURL(file);
});

// ---------- Premium requests ----------
function updatePremiumSection() {
  if (!currentUser) return;
  const statusEl = $('#premiumStatus');
  const form = $('#requestForm');
  if (currentUser.is_premium) {
    statusEl.textContent = 'You have Premium! You can create up to 3 coins.';
    form.classList.add('hidden');
  } else {
    statusEl.textContent = 'Normal account: max 1 coin. Request Premium for up to 3.';
    form.classList.remove('hidden');
  }
}

$('#sendRequestBtn')?.addEventListener('click', async () => {
  const reason = $('#premiumReason').value.trim();
  if (!reason) return toast('Write a reason.');
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason,
    status: 'pending'
  });
  if (error) return toast(error.message);
  toast('Request sent to Dompinator!');
  $('#premiumReason').value = '';
});

async function loadRequests() {
  if (!sb) return;
  const { data } = await sb.from('premium_requests')
    .select('*, profiles(username)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  const list = data || [];
  $('#requestsList').innerHTML = list.map(r => `
    <div class="request-card">
      <h4>${escapeHtml(r.profiles?.username || 'Unknown')}</h4>
      <p>${escapeHtml(r.reason)}</p>
      <div class="request-actions">
        <button class="approve-btn" data-id="${r.id}" data-user="${r.user_id}">Approve</button>
        <button class="deny-btn" data-id="${r.id}">Deny</button>
      </div>
    </div>
  `).join('');
  $('#emptyRequests').classList.toggle('hidden', list.length > 0);
  $$('.approve-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, b.dataset.user, 'approved')));
  $$('.deny-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, null, 'denied')));
}

async function handleRequest(reqId, userId, status) {
  if (!sb) return;
  await sb.from('premium_requests').update({ status }).eq('id', reqId);
  if (status === 'approved' && userId) {
    await sb.from('profiles').update({ is_premium: true }).eq('id', userId);
  }
  toast(status === 'approved' ? 'Approved!' : 'Denied');
  loadRequests();
}

// ---------- Realtime ----------
function startRealtime() {
  if (!sb) return;
  realtimeChannel = sb.channel('grind-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => loadCoins())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      if (selectedCoin) renderCoinDetail();
    })
    .subscribe();
}

$('#backToFeed')?.addEventListener('click', () => showPage('feed'));

// ---------- Init ----------
(async () => {
  if (!sb) {
    authMsg('Failed to connect to Supabase. Replace the API key in app.js with your real anon key.');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadProfile();
    enterApp();
  } else {
    setAuthMode('login');
  }
})();