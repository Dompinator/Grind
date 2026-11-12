// ============================================================
// GRIND v0.2 — Multiplayer via Supabase
// ============================================================
const SUPABASE_URL = 'https://zcrkywpyjrofphxnxtlc.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PKSD898kwnfs6msIDiW9_g_yeoTBduD';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let currentUser = null; // { id, username, avatar_url, cash, is_premium }
let coins = [];
let selectedCoin = null;
let selectedAmount = 5;
let feedMode = 'new';
let pendingCoinImage = null;
let pendingProfileImage = null;
let realtimeChannel = null;

// ---------- Helpers ----------
function money(n) { return '$' + Number(n || 0).toFixed(2); }
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c]));
}
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2400);
}
function isDompinator() {
  return currentUser && currentUser.username.toLowerCase() === 'dompinator';
}

// ---------- Auth ----------
function setAuthMode(mode) {
  $$('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === mode));
  $('#authSubmit').textContent = mode === 'signup' ? 'Skapa konto' : 'Logga in';
  $('#authMessage').textContent = '';
}
$$('.auth-tab').forEach(b => b.addEventListener('click', () => setAuthMode(b.dataset.auth)));

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#authUsername').value.trim();
  const password = $('#authPassword').value;
  const mode = $$('.auth-tab.active')[0].dataset.auth;
  if (username.length < 3) return authMsg('Användarnamn minst 3 tecken.');
  const email = username.toLowerCase() + '@grind.app';

  if (mode === 'signup') {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return authMsg(error.message);
    // Create profile
    const { error: pErr } = await supabase.from('profiles').insert({
      id: data.user.id,
      username: username,
      cash: 15,
      is_premium: false
    });
    if (pErr) return authMsg('Profil kunde inte skapas: ' + pErr.message);
    toast('Konto skapat! Logga in.');
    setAuthMode('login');
  } else {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return authMsg(error.message);
    await loadProfile();
    enterApp();
  }
});

function authMsg(s) { $('#authMessage').textContent = s; }

async function loadProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error || !data) {
    // fallback create
    await supabase.from('profiles').insert({ id: user.id, username: user.email.split('@')[0], cash: 15 });
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
  // Notifications nav
  $('#navNotifications').classList.toggle('hidden', !isDompinator());
  updatePremiumSection();
}

function enterApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  showPage('feed');
  startRealtime();
  loadCoins();
}

$('#logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  currentUser = null;
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);
  $('#appView').classList.add('hidden');
  $('#authView').classList.remove('hidden');
  setAuthMode('login');
});

// ---------- Navigation ----------
function showPage(page) {
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#page-' + page).classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = { feed: 'Discover currencies', create: 'Skapa currency', money: 'Dina pengar', account: 'Konto', notifications: 'Notiser', coin: 'Currency' };
  $('#pageTitle').textContent = titles[page] || 'GRIND';
  if (page === 'feed') renderFeed();
  if (page === 'money') renderMoney();
  if (page === 'account') updatePremiumSection();
  if (page === 'notifications' && isDompinator()) loadRequests();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
$$('[data-goto]').forEach(b => b.addEventListener('click', () => showPage(b.dataset.goto)));
$$('.feed-tab').forEach(b => b.addEventListener('click', () => {
  feedMode = b.dataset.feed;
  $$('.feed-tab').forEach(x => x.classList.toggle('active', x === b));
  renderFeed();
}));

// ---------- Coins & Feed ----------
async function loadCoins() {
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
      <div class="coin-change ${c.change_pct >= 0 ? 'up' : 'down'}">${c.change_pct >= 0 ? '↗ +' : '↘ '}${Number(c.change_pct || 0).toFixed(2)}% idag</div>
      <p class="coin-desc">${escapeHtml(c.description || 'Community currency.')}</p>
    </article>
  `).join('');
  $('#emptyFeed').classList.toggle('hidden', list.length > 0);
  $('#feedGrid').classList.toggle('hidden', list.length === 0);
  $$('.coin-card').forEach(card => card.addEventListener('click', () => openCoin(card.dataset.coin)));
}

$('#coinImage').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  if (file.size > 400 * 1024) return toast('Bild max 400 KB');
  const r = new FileReader();
  r.onload = () => {
    pendingCoinImage = r.result;
    $('#coinPreview').innerHTML = `<img src="${r.result}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
  };
  r.readAsDataURL(file);
});

$('#createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  // Check coin limit
  const { count } = await supabase.from('coins').select('*', { count: 'exact', head: true }).eq('creator_id', currentUser.id);
  const max = currentUser.is_premium ? 3 : 1;
  if (count >= max) return $('#createMessage').textContent = `Max ${max} coin${max > 1 ? 's' : ''} för ditt konto.`;

  const name = $('#coinName').value.trim();
  const ticker = $('#coinTicker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!ticker) return $('#createMessage').textContent = 'Ogiltig ticker.';
  const description = $('#coinDescription').value.trim();

  const { data, error } = await supabase.from('coins').insert({
    creator_id: currentUser.id,
    name,
    ticker,
    description,
    image_url: pendingCoinImage,
    price: 1,
    change_pct: 0
  }).select().single();

  if (error) return $('#createMessage').textContent = error.message;
  pendingCoinImage = null;
  $('#createForm').reset();
  $('#coinPreview').textContent = '＋';
  $('#createMessage').textContent = 'Currency skapad!';
  toast('Din coin är live!');
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
  if (!selectedCoin) return;
  const c = selectedCoin;
  // Get my shares
  const { data: hold } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', c.id).maybeSingle();
  const shares = hold?.shares || 0;

  // Get recent trades for chart + bubbles
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
        <p class="muted tiny">Skapad av community</p>
      </div>
    </div>
    <div class="detail-price">${money(c.price)}</div>
    <div class="coin-change ${c.change_pct >= 0 ? 'up' : 'down'}">${c.change_pct >= 0 ? '↗ +' : '↘ '}${Number(c.change_pct || 0).toFixed(2)}%</div>
    <div class="chart-wrap">
      <div class="chart-head"><strong>Prishistorik + trades</strong><span class="muted tiny">Bubblor = köp/sälj</span></div>
      <canvas id="priceChart" width="900" height="250"></canvas>
    </div>
    <div class="trade-panel">
      <h3>Handla $${escapeHtml(c.ticker)}</h3>
      <div class="trade-buttons">
        ${[1, 5, 10, 25, 50].map(n => `<button class="amount-btn ${n === selectedAmount ? 'active' : ''}" data-buy="${n}">$${n}</button>`).join('')}
      </div>
      <div class="trade-actions">
        <button class="buy-btn" id="buyBtn">Köp ${money(selectedAmount)}</button>
        <button class="sell-btn" id="sellBtn">Sälj 25%</button>
      </div>
      <p class="muted tiny" style="margin-top:10px">Du äger: ${shares.toFixed(4)} shares · Värde ${money(shares * c.price)} · Cash ${money(currentUser.cash)}</p>
      <p class="form-message" id="tradeMessage"></p>
    </div>
  `;

  $$('[data-buy]').forEach(b => b.addEventListener('click', () => {
    selectedAmount = Number(b.dataset.buy);
    $$('[data-buy]').forEach(x => x.classList.toggle('active', x === b));
    $('#buyBtn').textContent = `Köp ${money(selectedAmount)}`;
  }));
  $('#buyBtn').addEventListener('click', () => buy(c, selectedAmount));
  $('#sellBtn').addEventListener('click', () => sell(c, shares * 0.25));

  drawChartWithBubbles(c, trades || []);
}

function calculateImpact(amount, price) {
  // Mer impact när priset är lågt
  const priceFactor = Math.max(0.35, 1 / Math.sqrt(Math.max(0.2, price)));
  const dollarFactor = amount / 25;
  let impact = dollarFactor * priceFactor * 0.07;
  return Math.min(0.12, Math.max(0.004, impact));
}

async function buy(coin, amount) {
  if (currentUser.cash < amount) return $('#tradeMessage').textContent = 'Inte tillräckligt med cash.';
  const impact = calculateImpact(amount, coin.price);
  const newPrice = coin.price * (1 + impact);
  const shares = amount / coin.price;

  // Update cash
  const newCash = currentUser.cash - amount;
  const { error: cashErr } = await supabase.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  if (cashErr) return $('#tradeMessage').textContent = 'Cash-fel: ' + cashErr.message;

  // Update coin price + change
  const change = ((newPrice - 1) / 1) * 100; // simple from start, or accumulate
  await supabase.from('coins').update({ price: newPrice, change_pct: coin.change_pct + impact * 100 }).eq('id', coin.id);

  // Upsert holdings
  const { data: existing } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const newShares = (existing?.shares || 0) + shares;
  await supabase.from('holdings').upsert({ user_id: currentUser.id, coin_id: coin.id, shares: newShares });

  // Insert trade
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
  toast(`Köpte för ${money(amount)}!`);
  await loadCoins();
  selectedCoin = coins.find(x => x.id === coin.id) || coin;
  renderCoinDetail();
}

async function sell(coin, sharesToSell) {
  if (sharesToSell <= 0) return $('#tradeMessage').textContent = 'Inga shares att sälja.';
  const { data: hold } = await supabase.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const owned = hold?.shares || 0;
  const sellShares = Math.min(sharesToSell, owned);
  if (sellShares <= 0) return;
  const proceeds = sellShares * coin.price;
  const impact = calculateImpact(proceeds, coin.price) * 0.6;
  const newPrice = coin.price * (1 - impact);

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
  toast(`Sålde för ${money(proceeds)}`);
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

  // Build price history from trades (start at 1)
  const points = [{ price: 1, time: 0 }];
  trades.forEach(t => points.push({ price: t.price_after, time: new Date(t.created_at).getTime() }));
  if (points.length === 1) points.push({ price: coin.price, time: Date.now() });

  const min = Math.min(...points.map(p => p.price)) * 0.92;
  const max = Math.max(...points.map(p => p.price)) * 1.08;
  const range = max - min || 1;
  const minTime = points[0].time || Date.now() - 3600000;
  const maxTime = points[points.length - 1].time || Date.now();
  const timeRange = maxTime - minTime || 1;

  // Grid
  ctx.strokeStyle = 'rgba(190,165,225,.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(0, h * i / 5); ctx.lineTo(w, h * i / 5); ctx.stroke();
  }

  // Line
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = ((p.time - minTime) / timeRange) * w;
    const y = h - ((p.price - min) / range) * (h - 30) - 15;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#b38aff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Bubbles for trades
  const wrap = canvas.parentElement;
  wrap.querySelectorAll('.bubble').forEach(b => b.remove());
  trades.forEach(t => {
    const x = ((new Date(t.created_at).getTime() - minTime) / timeRange) * w;
    const y = h - ((t.price_after - min) / range) * (h - 30) - 15;
    if (x < 0 || x > w) return;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.style.left = (x - 14) + 'px';
    bubble.style.top = (y - 40) + 'px';
    const avatar = t.profiles?.avatar_url;
    bubble.innerHTML = avatar ? `<img src="${avatar}">` : `<span style="font-size:11px;color:white">${(t.profiles?.username || '?')[0].toUpperCase()}</span>`;
    bubble.title = `${t.profiles?.username || 'Någon'} ${t.type === 'buy' ? 'köpte' : 'sålde'} för $${t.amount_usd}`;
    wrap.appendChild(bubble);
  });
}

// ---------- Money / Portfolio ----------
async function renderMoney() {
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

// ---------- Profile image ----------
$('#profileImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || file.size > 400 * 1024) return toast('Bild max 400 KB');
  const r = new FileReader();
  r.onload = async () => {
    const dataUrl = r.result;
    const { error } = await supabase.from('profiles').update({ avatar_url: dataUrl }).eq('id', currentUser.id);
    if (!error) {
      currentUser.avatar_url = dataUrl;
      updateUIProfile();
      toast('Profilbild uppdaterad!');
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
    statusEl.textContent = 'Du har Premium! Du kan skapa upp till 3 coins.';
    form.classList.add('hidden');
  } else {
    statusEl.textContent = 'Normal account: max 1 coin. Skicka request för Premium (max 3).';
    form.classList.remove('hidden');
  }
}

$('#sendRequestBtn')?.addEventListener('click', async () => {
  const reason = $('#premiumReason').value.trim();
  if (!reason) return toast('Skriv en anledning.');
  const { error } = await supabase.from('premium_requests').insert({
    user_id: currentUser.id,
    reason,
    status: 'pending'
  });
  if (error) return toast(error.message);
  toast('Request skickad till Dompinator!');
  $('#premiumReason').value = '';
});

async function loadRequests() {
  const { data } = await supabase.from('premium_requests')
    .select('*, profiles(username)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  const list = data || [];
  $('#requestsList').innerHTML = list.map(r => `
    <div class="request-card">
      <h4>${escapeHtml(r.profiles?.username || 'Okänd')}</h4>
      <p>${escapeHtml(r.reason)}</p>
      <div class="request-actions">
        <button class="approve-btn" data-id="${r.id}" data-user="${r.user_id}">Godkänn</button>
        <button class="deny-btn" data-id="${r.id}">Neka</button>
      </div>
    </div>
  `).join('');
  $('#emptyRequests').classList.toggle('hidden', list.length > 0);
  $$('.approve-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, b.dataset.user, 'approved')));
  $$('.deny-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, null, 'denied')));
}

async function handleRequest(reqId, userId, status) {
  await supabase.from('premium_requests').update({ status }).eq('id', reqId);
  if (status === 'approved' && userId) {
    await supabase.from('profiles').update({ is_premium: true }).eq('id', userId);
  }
  toast(status === 'approved' ? 'Godkänd!' : 'Nekad');
  loadRequests();
}

// ---------- Realtime ----------
function startRealtime() {
  realtimeChannel = supabase.channel('grind-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => loadCoins())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      if (selectedCoin) renderCoinDetail();
    })
    .subscribe();
}

$('#backToFeed').addEventListener('click', () => showPage('feed'));

// ---------- Init ----------
(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    await loadProfile();
    enterApp();
  } else {
    setAuthMode('login');
  }
})();