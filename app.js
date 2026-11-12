// ============================================================
// GRIND v0.3 — Multiplayer · Premium · English
// ============================================================
const SUPABASE_URL = 'https://zcrkywpyjrofphxnxtlc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PKSD898kwnfs6msIDiW9_g_yeoTBduD';

let supabase;
try {
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
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
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;'
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

// ---------- Auth ----------
function setAuthMode(mode) {
  $$('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === mode));
  const btn = $('#authSubmit');
  if (btn) btn.textContent = mode === 'signup' ? 'Create account' : 'Log in';
  const msg = $('#authMessage');
  if (msg) msg.textContent = '';
}
$$('.auth-tab').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));

$('#authForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!supabase) return authMsg('Supabase not ready. Check your API key.');
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const mode = $$('.auth-tab.active')[0]?.dataset.auth || 'login';
  if (username.length < 3) return authMsg('Username must be at least 3 characters.');
  const email = username.toLowerCase() + '@grind.app';

  if (mode === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return authMsg(error.message);
    if (!data.user) return authMsg('Signup failed. Check email confirmation settings in Supabase.');
    const { error: pErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      username: username,
      cash: 15,
      is_premium: false,
      net_worth: 15,
      time_played: 0
    });
    if (pErr) return authMsg('Profile error: ' + pErr.message);
    toast('Account created! You can now log in.');
    setAuthMode('login');
  } else {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return authMsg(error.message);
    await loadProfile();
    enterApp();
  }
});

function authMsg(s) {
  const el = $('#authMessage');
  if (el) el.textContent = s;
}

async function loadProfile() {
  if (!supabase) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error || !data) {
    await supabase.from('profiles').insert({
      id: user.id,
      username: user.email.split('@')[0],
      cash: 15,
      net_worth: 15,
      time_played: 0
    });
    return loadProfile();
  }
  currentUser = data;
  updateUIProfile();
}

function updateUIProfile() {
  if (!currentUser) return;
  $('#sideName').textContent = currentUser.username;
  $('#sidePremium').textContent = currentUser.is_premium ? 'Premium' : 'Member';
  const av = currentUser.avatar_url ? `<img src="${currentUser.avatar_url}">` : escapeHtml(currentUser.username[0].toUpperCase());
  $('#sideAvatar').innerHTML = av;
  $('#topAvatar').innerHTML = av;
  $('#topCash').textContent = money(currentUser.cash);
  $('#moneyCash').textContent = money(currentUser.cash);
  $('#profileInitial').textContent = currentUser.username[0].toUpperCase();
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
    if (!currentUser || !supabase) return;
    const add = 30; // seconds
    const newTime = (currentUser.time_played || 0) + add;
    currentUser.time_played = newTime;
    await supabase.from('profiles').update({ time_played: newTime }).eq('id', currentUser.id);
  }, 30000);
  window.addEventListener('beforeunload', saveTimeOnExit);
}

async function saveTimeOnExit() {
  if (!currentUser || !sessionStart || !supabase) return;
  const extra = Math.floor((Date.now() - sessionStart) / 1000);
  if (extra > 5) {
    await supabase.from('profiles').update({ time_played: (currentUser.time_played || 0) + extra }).eq('id', currentUser.id);
  }
}

$('#logoutBtn')?.addEventListener('click', async () => {
  await saveTimeOnExit();
  if (timeInterval) clearInterval(timeInterval);
  if (supabase) await supabase.auth.signOut();
  currentUser = null;
  if (realtimeChannel && supabase) supabase.removeChannel(realtimeChannel);
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
  if (!supabase) return;
  const { data, error } = await supabase.from('coins').select('*').order('created_at', { ascending: false });
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
        <div class="coin-logo">${c.image_url ? `<img src="${c.image_url}">` : escapeHtml(c.ticker[0])}</div>
        <div>
          <div class="coin-name">${escapeHtml(c.name)}</div>
          <div class="coin-ticker">$${escapeHtml(c.ticker)}</div>
        </div>
      </div>
      <div class="coin-price">${money(c.price)}</div>
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
  if (!currentUser || !supabase) return;
  const { count } = await supabase.from('coins').select('*', { count: 'exact', head: true }).eq('creator_id', currentUser.id);
  const max = currentUser.is_premium ? 3 : 1;
  if (count >= max) return $('#createMessage').textContent = `Max ${max} coin${max > 1 ? 's' : ''} for your account.`;

  const name = $('#coinName').value.trim();
  const ticker = $('#coinTicker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ticker) return $('#createMessage').textContent = 'Invalid ticker.';
  const description = $('#coinDescription').value.trim();

  const { error } = await supabase.from('coins').insert({
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
  if (!selectedCoin || !currentUser || !supabase) return;
  const c = selectedCoin;
  const { data: hold } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', c.id).maybeSingle();
  const shares = hold?.shares || 0;

  const { data: trades } = await supabase.from('trades')
    .select('*, profiles(username, avatar_url)')
    .eq('coin_id', c.id)
    .order('created_at', { ascending: true })
    .limit(80);

  $('#coinDetail').innerHTML = `
    <div class="coin-detail-hero">
      <div class="coin-logo">${c.image_url ? `<img src="${c.image_url}">` : escapeHtml(c.ticker[0])}</div>
      <div>
        <h3>${escapeHtml(c.name)} <span class="muted">$${escapeHtml(c.ticker)}</span></h3>
        <p>${escapeHtml(c.description || '')}</p>
        <p class="muted tiny">Community created</p>
      </div>
    </div>
    <div class="detail-price">${money(c.price)}</div>
    <div class="coin-change ${(c.change_pct || 0) >= 0 ? 'up' : 'down'}">${(c.change_pct || 0) >= 0 ? '↗ +' : '↘ '}${Number(c.change_pct || 0).toFixed(2)}%</div>
    <div class="chart-wrap">
      <div class="chart-head"><strong>Price history + trades</strong><span class="muted tiny">Bubbles = buys/sells</span></div>
      <canvas id="priceChart" width="900" height="250"></canvas>
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

  drawChartWithBubbles(c, trades || []);
}

function calculateImpact(amount, price) {
  const priceFactor = Math.max(0.35, 1 / Math.sqrt(Math.max(0.2, price)));
  const dollarFactor = amount / 25;
  let impact = dollarFactor * priceFactor * 0.07;
  return Math.min(0.12, Math.max(0.004, impact));
}

async function updateNetWorth() {
  if (!currentUser || !supabase) return;
  const { data: holds } = await supabase.from('holdings').select('shares, coins(price)').eq('user_id', currentUser.id);
  const portValue = (holds || []).reduce((s, h) => s + (h.shares || 0) * (h.coins?.price || 0), 0);
  const nw = currentUser.cash + portValue;
  currentUser.net_worth = nw;
  await supabase.from('profiles').update({ net_worth: nw }).eq('id', currentUser.id);
  $('#totalValue').textContent = money(nw);
}

async function buy(coin, amount) {
  if (!currentUser || currentUser.cash < amount) return $('#tradeMessage').textContent = 'Not enough cash.';
  const impact = calculateImpact(amount, coin.price);
  const newPrice = coin.price * (1 + impact);
  const shares = amount / coin.price;
  const newCash = currentUser.cash - amount;

  const { error: cashErr } = await supabase.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  if (cashErr) return $('#tradeMessage').textContent = 'Cash error: ' + cashErr.message;

  await supabase.from('coins').update({ price: newPrice, change_pct: (coin.change_pct || 0) + impact * 100 }).eq('id', coin.id);

  const { data: existing } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const newShares = (existing?.shares || 0) + shares;
  await supabase.from('holdings').upsert({ user_id: currentUser.id, coin_id: coin.id, shares: newShares });

  await supabase.from('trades').insert({
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'buy',
    amount_usd: amount,
    shares,
    price_after: newPrice
  });

  currentUser.cash = newCash;
  coin.price = newPrice;
  coin.change_pct = (coin.change_pct || 0) + impact * 100;
  updateUIProfile();
  await updateNetWorth();
  toast(`Bought for ${money(amount)}!`);
  await loadCoins();
  selectedCoin = coins.find(x => x.id === coin.id) || coin;
  renderCoinDetail();
}

async function sell(coin, sharesToSell) {
  if (!currentUser || sharesToSell <= 0) return $('#tradeMessage').textContent = 'No shares to sell.';
  const { data: hold } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const owned = hold?.shares || 0;
  const sellShares = Math.min(sharesToSell, owned);
  if (sellShares <= 0) return;
  const proceeds = sellShares * coin.price;
  const impact = calculateImpact(proceeds, coin.price) * 0.6;
  const newPrice = Math.max(0.01, coin.price * (1 - impact));
  const newCash = currentUser.cash + proceeds;

  await supabase.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  await supabase.from('coins').update({ price: newPrice, change_pct: (coin.change_pct || 0) - impact * 100 }).eq('id', coin.id);
  await supabase.from('holdings').update({ shares: owned - sellShares }).eq('user_id', currentUser.id).eq('coin_id', coin.id);
  await supabase.from('trades').insert({
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
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const points = [{ price: 1, time: 0 }];
  trades.forEach(t => points.push({ price: t.price_after, time: new Date(t.created_at).getTime() }));
  if (points.length === 1) points.push({ price: coin.price, time: Date.now() });

  const min = Math.min(...points.map(p => p.price)) * 0.92;
  const max = Math.max(...points.map(p => p.price)) * 1.08;
  const range = max - min || 1;
  const minTime = points[0].time || Date.now() - 3600000;
  const maxTime = points[points.length - 1].time || Date.now();
  const timeRange = maxTime - minTime || 1;

  ctx.strokeStyle = 'rgba(190,165,225,.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(0, h * i / 5); ctx.lineTo(w, h * i / 5); ctx.stroke();
  }

  ctx.beginPath();
  points.forEach((p, i) => {
    const x = ((p.time - minTime) / timeRange) * w;
    const y = h - ((p.price - min) / range) * (h - 30) - 15;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#c084fc';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const wrap = canvas.parentElement;
  wrap.querySelectorAll('.bubble').forEach(b => b.remove());
  trades.forEach(t => {
    const x = ((new Date(t.created_at).getTime() - minTime) / timeRange) * w;
    const y = h - ((t.price_after - min) / range) * (h - 30) - 15;
    if (x < 0 || x > w) return;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.left = (x - 15) + 'px';
    bubble.style.top = (y - 42) + 'px';
    const avatar = t.profiles?.avatar_url;
    bubble.innerHTML = avatar ? `<img src="${avatar}">` : `<span>${(t.profiles?.username || '?')[0].toUpperCase()}</span>`;
    bubble.title = `${t.profiles?.username || 'Someone'} ${t.type === 'buy' ? 'bought' : 'sold'} for $${t.amount_usd}`;
    wrap.appendChild(bubble);
  });
}

// ---------- Money / Portfolio ----------
async function renderMoney() {
  if (!currentUser || !supabase) return;
  const { data: holds } = await supabase.from('holdings').select('*, coins(name, ticker, price, image_url)').eq('user_id', currentUser.id).gt('shares', 0);
  const list = holds || [];
  const value = list.reduce((s, h) => s + h.shares * (h.coins?.price || 0), 0);
  $('#portfolioValue').textContent = money(value);
  $('#totalValue').textContent = money(value + currentUser.cash);
  $('#holdingsList').innerHTML = list.map(h => `
    <div class="holding" data-coin="${h.coin_id}">
      <div class="holding-left">
        <div class="coin-logo">${h.coins?.image_url ? `<img src="${h.coins.image_url}">` : (h.coins?.ticker || '?')[0]}</div>
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
  if (!supabase) return;
  let query = supabase.from('profiles').select('username, avatar_url, net_worth, time_played, is_premium');
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
      <div class="avatar">${p.avatar_url ? `<img src="${p.avatar_url}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div class="lb-info">
        <strong>${escapeHtml(p.username || 'Unknown')} ${p.is_premium ? '★' : ''}</strong>
        <div class="muted tiny">${lbMode === 'networth' ? 'Net worth' : 'Time played'}</div>
      </div>
      <div class="lb-value">${lbMode === 'networth' ? money(p.net_worth || 0) : formatTime(p.time_played || 0)}</div>
    </div>
  `).join('');
  $('#emptyLeaderboard').classList.toggle('hidden', list.length > 0);
}

// ---------- Profile image ----------
$('#profileImage')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || file.size > 400 * 1024) return toast('Image must be under 400 KB');
  const r = new FileReader();
  r.onload = async () => {
    const dataUrl = r.result;
    const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', currentUser.id);
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
  const { error } = await supabase.from('premium_requests').insert({
    user_id: currentUser.id,
    reason,
    status: 'pending'
  });
  if (error) return toast(error.message);
  toast('Request sent to Dompinator!');
  $('#premiumReason').value = '';
});

async function loadRequests() {
  if (!supabase) return;
  const { data } = await supabase.from('premium_requests')
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
  if (!supabase) return;
  await supabase.from('premium_requests').update({ status }).eq('id', reqId);
  if (status === 'approved' && userId) {
    await supabase.from('profiles').update({ is_premium: true }).eq('id', userId);
  }
  toast(status === 'approved' ? 'Approved!' : 'Denied');
  loadRequests();
}

// ---------- Realtime ----------
function startRealtime() {
  if (!supabase) return;
  realtimeChannel = supabase.channel('grind-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => loadCoins())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      if (selectedCoin) renderCoinDetail();
    })
    .subscribe();
}

$('#backToFeed')?.addEventListener('click', () => showPage('feed'));

// ---------- Init ----------
(async () => {
  if (!supabase) {
    authMsg('Failed to connect to Supabase. Replace the API key in app.js with your real anon key.');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadProfile();
    enterApp();
  } else {
    setAuthMode('login');
  }
})();