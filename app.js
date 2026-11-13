// ============================================================
// GRIND v0.4.5 — Multiplayer · Premium · English
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
let customBuyActive = false;
let customBuyValue = '';
let feedMode = 'new';
let lbMode = 'networth';
let pendingCoinImage = null;
let realtimeChannel = null;
let sessionStart = null;
let timeInterval = null;
let chartZoom = 1.0;
let currentPage = 'feed';
let adsCache = null;
let adsCacheTime = 0;
let adTimerInterval = null;
let activeAdToken = 0;
let lastAdName = null;
let adLocked = false;
let adClaimed = false;
let feedSearchQuery = '';
let proUserIds = new Set();
let watchlistIds = new Set();
let dailyStateCache = null;
let lastCoinsDateKey = '';

const DAILY_REWARDS = [5, 5, 10, 12, 13, 15, 'PRO'];
const GOLD_CROWN_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 18h18v2H3v-2zm0-2L1 6l5.5 4.5L12 4l5.5 6.5L23 6l-2 10H3z"/></svg>`;
const BLUE_STAR_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 7.1-1.01L12 2z"/></svg>`;

// ---------- Helpers ----------
function money(n) { return '$' + Number(n || 0).toFixed(2); }
function priceFmt(n) {
  n = Number(n || 0);
  return '$' + n.toFixed(n < 1 ? 4 : 2);
}
function getStartOfTodayDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
function formatChangePct(rawPct) {
  const val = Number(rawPct || 0);
  const pct = Math.abs(val) < 0.005 ? 0 : val;
  if (pct === 0) {
    return {
      cls: 'flat',
      text: '0.00% today'
    };
  }
  const isUp = pct > 0;
  return {
    cls: isUp ? 'up' : 'down',
    text: `${isUp ? '↗ +' : '↘ '}${pct.toFixed(2)}% today`
  };
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
  return currentUser && currentUser.username && currentUser.username.toLowerCase() === 'dompinator';
}
function getUserTier(p) {
  if (!p) return 'member';
  if (p.is_premium) return 'premium';
  if (p.is_pro || (p.id && proUserIds.has(p.id)) || (p.user_id && proUserIds.has(p.user_id))) return 'pro';
  return 'member';
}
function tierLabel(p) {
  const t = getUserTier(p);
  if (t === 'premium') return 'Premium';
  if (t === 'pro') return 'PRO';
  return 'Member';
}
function tierBadgeHtml(p) {
  const t = getUserTier(p);
  if (t === 'premium') return `<span class="tier-icon tier-premium" title="Premium">${BLUE_STAR_SVG}</span>`;
  if (t === 'pro') return `<span class="tier-icon tier-pro" title="PRO">${GOLD_CROWN_SVG}</span>`;
  return '';
}
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Compress uploaded images using canvas so any image works regardless of file size
function compressImg(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 256;
      let w = img.width, h = img.height;
      if (w > h) {
        if (w > max) { h = Math.round(h * max / w); w = max; }
      } else {
        if (h > max) { w = Math.round(w * max / h); h = max; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      cb(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
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
    is_premium: username.toLowerCase() === 'dompinator',
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
    if (cErr) {
      console.warn('Profile create error in Supabase:', cErr);
      // Fallback so currentUser is always defined and app/coin creation is never silently blocked
      currentUser = {
        id: user.id,
        username: (user.email || 'trader').split('@')[0],
        email: user.email,
        cash: 15,
        is_premium: (user.email || '').toLowerCase().includes('dompinator'),
        net_worth: 15,
        time_played: 0
      };
      updateUIProfile();
      return;
    }
    return loadProfile();
  }
  currentUser = data;

  // Auto-sync approved premium & PRO status
  await loadProUserIds();
  currentUser.is_pro = Boolean(
    currentUser.is_pro ||
    proUserIds.has(user.id) ||
    localStorage.getItem('grind_pro_' + user.id) === '1'
  );
  if (currentUser.is_pro) proUserIds.add(user.id);

  if (!currentUser.is_premium) {
    try {
      const { data: approvedReq } = await sb.from('premium_requests')
        .select('id, reason')
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .neq('reason', '__PRO_TIER__')
        .limit(1)
        .maybeSingle();

      if (approvedReq) {
        currentUser.is_premium = true;
        // User updating their OWN profile is always permitted by RLS ("Own profile")
        await sb.from('profiles').update({ is_premium: true }).eq('id', user.id);
      }
    } catch (e) {
      console.warn('Premium check note:', e);
    }
  }

  await loadWatchlist();
  updateUIProfile();
}

async function loadWatchlist() {
  if (!currentUser) return;
  let localIds = [];
  let localTs = 0;
  try {
    localIds = JSON.parse(localStorage.getItem('grind_watchlist_' + currentUser.id) || '[]');
    localTs = Number(localStorage.getItem('grind_watchlist_ts_' + currentUser.id) || 0);
  } catch (e) {}

  let chosen = Array.isArray(localIds) ? localIds : [];
  if (sb) {
    try {
      const { data } = await sb
        .from('premium_requests')
        .select('reason, created_at')
        .eq('user_id', currentUser.id)
        .like('reason', '__WATCHLIST__:%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.reason) {
        const remoteIds = JSON.parse(data.reason.slice('__WATCHLIST__:'.length));
        const remoteTs = data.created_at ? new Date(data.created_at).getTime() : 0;
        if (Array.isArray(remoteIds) && remoteTs >= localTs) {
          chosen = remoteIds;
          localStorage.setItem('grind_watchlist_' + currentUser.id, JSON.stringify(chosen));
          localStorage.setItem('grind_watchlist_ts_' + currentUser.id, String(remoteTs));
        }
      }
    } catch (e) {}
  }
  watchlistIds = new Set(chosen.map(String));
}

async function toggleWatchlist(coinId) {
  if (!currentUser || !coinId) return;
  const id = String(coinId);
  const adding = !watchlistIds.has(id);
  if (adding) watchlistIds.add(id);
  else watchlistIds.delete(id);

  const list = [...watchlistIds];
  localStorage.setItem('grind_watchlist_' + currentUser.id, JSON.stringify(list));
  localStorage.setItem('grind_watchlist_ts_' + currentUser.id, String(Date.now()));

  $$(`.fav-btn[data-fav="${id}"]`).forEach(btn => {
    btn.classList.toggle('active', adding);
    btn.textContent = adding ? '★' : '☆';
    btn.title = adding ? 'Remove from watchlist' : 'Add to watchlist';
  });

  if (currentPage === 'feed' && feedMode === 'watchlist') {
    renderFeed();
  }
  toast(adding ? 'Added to watchlist ★' : 'Removed from watchlist');

  if (sb) {
    try {
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__WATCHLIST__:' + JSON.stringify(list),
        status: 'denied'
      });
    } catch (e) {}
  }
}

function updateUIProfile() {
  if (!currentUser) return;
  $('#sideName').innerHTML = `${escapeHtml(currentUser.username)}${tierBadgeHtml(currentUser)}`;
  $('#sidePremium').textContent = tierLabel(currentUser);
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
  } else {
    $('#profilePreview').classList.add('hidden');
    $('#profileInitial').classList.remove('hidden');
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
  checkDailyLogin();
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
  const wasAds = currentPage === 'ads';
  if (wasAds && page !== 'ads') cleanupAds();
  currentPage = page;
  $('#appView')?.classList.toggle('ads-fullscreen', page === 'ads');
  $$('.page').forEach(p => p.classList.add('hidden'));
  const target = $('#page-' + page);
  if (target) target.classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const titles = {
    feed: 'Discover currencies',
    create: 'Create currency',
    money: 'Your money',
    global: 'Global leaderboards',
    ads: 'Ads',
    account: 'Account settings',
    notifications: 'Notifications',
    coin: 'Currency'
  };
  $('#pageTitle').textContent = titles[page] || 'GRIND';
  if (page === 'feed') renderFeed();
  if (page === 'money') renderMoney();
  if (page === 'global') renderLeaderboard();
  if (page === 'ads' && !(wasAds && adLocked)) startAdsPage();
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
      if (feedMode === 'trending') loadCoins();
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

$('#feedSearch')?.addEventListener('input', e => {
  feedSearchQuery = (e.target.value || '').trim().toLowerCase();
  renderFeed();
});

async function loadProUserIds() {
  if (!sb) return;
  try {
    const { data } = await sb
      .from('premium_requests')
      .select('user_id')
      .eq('status', 'approved')
      .eq('reason', '__PRO_TIER__');
    proUserIds = new Set((data || []).map(r => r.user_id).filter(Boolean));
    if (currentUser && localStorage.getItem('grind_pro_' + currentUser.id) === '1') {
      proUserIds.add(currentUser.id);
    }
  } catch (e) {}
}

// ---------- Coins & Feed ----------
async function loadCoins() {
  if (!sb) return;
  await loadProUserIds();
  let res = await sb
    .from('coins')
    .select('*, profiles!coins_creator_id_fkey(id, username, avatar_url, is_premium)')
    .order('created_at', { ascending: false });
  if (res.error) {
    res = await sb.from('coins').select('*').order('created_at', { ascending: false });
  }
  if (!res.error) {
    const list = res.data || [];
    const stats = new Map();
    const openPriceMap = new Map();
    const tradedTodaySet = new Set();
    const startOfTodayIso = getStartOfTodayDate().toISOString();
    lastCoinsDateKey = getLocalDateKey(0);
    try {
      const [{ data: buyRows }, { data: todayRows }] = await Promise.all([
        sb.from('trades')
          .select('coin_id, amount_usd, created_at')
          .eq('type', 'buy')
          .order('created_at', { ascending: false })
          .limit(1000),
        sb.from('trades')
          .select('coin_id')
          .gte('created_at', startOfTodayIso)
          .limit(1000)
      ]);
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      (buyRows || []).forEach(t => {
        if (!t.coin_id) return;
        const ts = t.created_at ? new Date(t.created_at).getTime() : 0;
        const s = stats.get(t.coin_id) || { total: 0, recent: 0, volume: 0, lastBuy: 0 };
        s.total += 1;
        s.volume += Number(t.amount_usd || 0);
        if (ts >= dayAgo) s.recent += 1;
        if (ts > s.lastBuy) s.lastBuy = ts;
        stats.set(t.coin_id, s);
      });
      const tradedTodayIds = [...new Set((todayRows || []).map(t => t.coin_id).filter(Boolean))];
      tradedTodayIds.forEach(id => tradedTodaySet.add(id));
      if (tradedTodayIds.length > 0) {
        const prevResults = await Promise.all(
          tradedTodayIds.map(id =>
            sb.from('trades')
              .select('price_after')
              .eq('coin_id', id)
              .lt('created_at', startOfTodayIso)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
          )
        );
        prevResults.forEach((r, idx) => {
          const cid = tradedTodayIds[idx];
          openPriceMap.set(cid, r.data && r.data.price_after != null ? Number(r.data.price_after) : 1);
        });
      }
    } catch (e) {}
    coins = list.map(c => {
      const st = stats.get(c.id) || { total: 0, recent: 0, volume: 0, lastBuy: 0 };
      const currentPrice = Number(c.price) || 1;
      const tradedToday = tradedTodaySet.has(c.id);
      const openToday = tradedToday ? (openPriceMap.get(c.id) || 1) : currentPrice;
      const rawTodayPct = tradedToday && openToday > 0
        ? ((currentPrice - openToday) / openToday) * 100
        : 0;
      const todayPct = Math.abs(rawTodayPct) < 0.005 ? 0 : rawTodayPct;
      return {
        ...c,
        today_open_price: openToday,
        change_pct: todayPct,
        recent_buys_24h: st.recent,
        total_buys: st.total,
        buy_volume: st.volume,
        last_buy_at: st.lastBuy
      };
    });
  }
  renderFeed();
  if (currentUser) updateNetWorth();
}

function renderFeed() {
  if (lastCoinsDateKey && lastCoinsDateKey !== getLocalDateKey(0)) {
    loadCoins();
    return;
  }
  let list = [...coins];
  if (feedMode === 'watchlist') {
    list = list.filter(c => watchlistIds.has(String(c.id)));
  }
  if (feedSearchQuery) {
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(feedSearchQuery) ||
      (c.ticker || '').toLowerCase().includes(feedSearchQuery)
    );
  }
  if (feedMode === 'cheap') list.sort((a, b) => Number(a.price) - Number(b.price));
  if (feedMode === 'new' || feedMode === 'watchlist') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (feedMode === 'trending') {
    list.sort((a, b) => {
      if ((b.recent_buys_24h || 0) !== (a.recent_buys_24h || 0)) {
        return (b.recent_buys_24h || 0) - (a.recent_buys_24h || 0);
      }
      if ((b.total_buys || 0) !== (a.total_buys || 0)) {
        return (b.total_buys || 0) - (a.total_buys || 0);
      }
      if ((b.last_buy_at || 0) !== (a.last_buy_at || 0)) {
        return (b.last_buy_at || 0) - (a.last_buy_at || 0);
      }
      return (b.buy_volume || 0) - (a.buy_volume || 0);
    });
  }
  if (feedMode === 'expensive') list.sort((a, b) => Number(b.price) - Number(a.price));
  $('#feedGrid').innerHTML = list.map(c => {
    const creator = c.profiles;
    const creatorName = creator?.username || 'Community';
    const creatorObj = creator ? { ...creator, id: c.creator_id } : { id: c.creator_id };
    const chg = formatChangePct(c.change_pct);
    const isFav = watchlistIds.has(String(c.id));
    return `
    <article class="coin-card" data-coin="${c.id}">
      <div class="coin-top">
        <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml(c.ticker[0])}</div>
        <div style="flex:1;min-width:0;">
          <div class="coin-name">${escapeHtml(c.name)}</div>
          <div class="coin-ticker">$${escapeHtml(c.ticker)}</div>
        </div>
        <button type="button" class="fav-btn ${isFav ? 'active' : ''}" data-fav="${escapeHtml(c.id)}" title="${isFav ? 'Remove from watchlist' : 'Add to watchlist'}" aria-label="Toggle watchlist">${isFav ? '★' : '☆'}</button>
      </div>
      <div class="coin-price">${priceFmt(c.price)}</div>
      <div class="coin-change ${chg.cls}">${chg.text}</div>
      <p class="coin-desc">${escapeHtml(c.description || 'Community currency.')}</p>
      ${c.creator_id ? `
        <button type="button" class="creator-chip" data-profile="${escapeHtml(c.creator_id)}">
          <span class="creator-mini-av">${creator?.avatar_url ? `<img src="${escapeHtml(creator.avatar_url)}">` : escapeHtml(creatorName[0].toUpperCase())}</span>
          <span>${escapeHtml(creatorName)}${tierBadgeHtml(creatorObj)}</span>
        </button>
      ` : ''}
    </article>`;
  }).join('');
  const emptyEl = $('#emptyFeed');
  if (emptyEl) {
    const h3 = emptyEl.querySelector('h3');
    const p = emptyEl.querySelector('p');
    const btn = emptyEl.querySelector('.primary-btn');
    if (feedMode === 'watchlist') {
      if (h3) h3.textContent = feedSearchQuery ? 'No matching watchlist coins' : 'Your watchlist is empty';
      if (p) p.textContent = feedSearchQuery ? 'Try another search term.' : 'Click the ☆ star on any coin to save it here.';
      if (btn) btn.classList.add('hidden');
    } else {
      if (h3) h3.textContent = 'No currencies yet';
      if (p) p.textContent = 'Be the first to create one!';
      if (btn) btn.classList.remove('hidden');
    }
    emptyEl.classList.toggle('hidden', list.length > 0);
  }
  $('#feedGrid').classList.toggle('hidden', list.length === 0);
  $$('.coin-card').forEach(card => card.addEventListener('click', () => openCoin(card.dataset.coin)));
  $$('#feedGrid [data-fav]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    toggleWatchlist(btn.dataset.fav);
  }));
  $$('#feedGrid [data-profile]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openProfileModal(btn.dataset.profile);
  }));
}

// Make preview box clickable to choose picture
$('#coinPreview')?.addEventListener('click', () => {
  $('#coinImage')?.click();
});

$('#coinImage')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  compressImg(file, dataUrl => {
    pendingCoinImage = dataUrl;
    $('#coinPreview').innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:14px">`;
  });
});

$('#createForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#createForm button[type="submit"]');
  const msgEl = $('#createMessage');
  if (msgEl) msgEl.textContent = 'Creating currency...';
  if (btn) btn.disabled = true;

  try {
    if (!currentUser) {
      if (msgEl) msgEl.textContent = 'You must be logged in to create a currency.';
      toast('Please log in first.');
      if (btn) btn.disabled = false;
      return;
    }
    if (!sb) {
      if (msgEl) msgEl.textContent = 'Supabase connection is not ready.';
      toast('Supabase error');
      if (btn) btn.disabled = false;
      return;
    }

    const name = $('#coinName').value.trim();
    const ticker = $('#coinTicker').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!name) {
      if (msgEl) msgEl.textContent = 'Please enter a name.';
      if (btn) btn.disabled = false;
      return;
    }
    if (!ticker) {
      if (msgEl) msgEl.textContent = 'Invalid ticker (letters and numbers only).';
      if (btn) btn.disabled = false;
      return;
    }
    const description = $('#coinDescription').value.trim();

    if (!isDompinator()) {
      try {
        const { count, error: countErr } = await sb.from('coins').select('*', { count: 'exact', head: true }).eq('creator_id', currentUser.id);
        const max = currentUser.is_premium ? 3 : (currentUser.is_pro ? 2 : 1);
        if (!countErr && count !== null && count >= max) {
          if (msgEl) msgEl.textContent = `Max ${max} coin${max > 1 ? 's' : ''} for your ${tierLabel(currentUser)} account.`;
          toast(`Max ${max} coin${max > 1 ? 's' : ''} for your ${tierLabel(currentUser)} account.`);
          if (btn) btn.disabled = false;
          return;
        }
      } catch (err) {}
    }

    const { data, error } = await sb.from('coins').insert({
      creator_id: currentUser.id,
      name,
      ticker,
      description,
      image_url: pendingCoinImage,
      price: 1,
      change_pct: 0
    }).select().maybeSingle();

    if (error) {
      console.error('Coin creation error:', error);
      if (msgEl) msgEl.textContent = error.message;
      toast('Error: ' + error.message);
      if (btn) btn.disabled = false;
      return;
    }

    pendingCoinImage = null;
    $('#createForm').reset();
    $('#coinPreview').textContent = '＋';
    if (msgEl) msgEl.textContent = 'Currency created!';
    toast('Your coin is live!');
    await loadCoins();
    await updateNetWorth();
    if (data && data.id) {
      openCoin(data.id);
    } else {
      showPage('feed');
    }
  } catch (err) {
    console.error('Submit catch:', err);
    if (msgEl) msgEl.textContent = 'Error: ' + err.message;
    toast('Error: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
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

  const { data: dbTrades } = await sb.from('trades')
    .select('*, profiles(username, avatar_url)')
    .eq('coin_id', c.id)
    .order('created_at', { ascending: false })
    .limit(100);

  // Combine with any local session trades
  const tradeMap = new Map();
  (dbTrades || []).forEach(t => tradeMap.set(t.id || (t.created_at + t.shares), t));
  (c.localTrades || []).forEach(t => tradeMap.set(t.id || (t.created_at + t.shares), t));
  const trades = Array.from(tradeMap.values());
  trades.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  const startOfTodayMs = getStartOfTodayDate().getTime();
  const todayTrades = trades.filter(t => new Date(t.created_at || 0).getTime() >= startOfTodayMs);
  const preTodayTrade = trades.find(t => new Date(t.created_at || 0).getTime() < startOfTodayMs);
  let detailTodayPct = Number(c.change_pct || 0);
  if (todayTrades.length === 0) {
    detailTodayPct = 0;
  } else if (preTodayTrade && preTodayTrade.price_after != null) {
    const openP = Number(preTodayTrade.price_after) || 1;
    detailTodayPct = ((Number(c.price) - openP) / openP) * 100;
  } else if ((dbTrades || []).length < 100) {
    detailTodayPct = ((Number(c.price) - 1) / 1) * 100;
  }
  const detailChg = formatChangePct(detailTodayPct);

  const creator = c.profiles;
  const creatorName = creator?.username || 'Community';
  const creatorObj = creator ? { ...creator, id: c.creator_id } : { id: c.creator_id };
  const isFav = watchlistIds.has(String(c.id));
  const buyBtnLabel = selectedAmount > 0 ? `Buy ${money(selectedAmount)}` : 'Enter amount';

  $('#coinDetail').innerHTML = `
    <div class="coin-detail-hero">
      <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml(c.ticker[0])}</div>
      <div style="flex:1;">
        <h3>${escapeHtml(c.name)} <span class="muted">$${escapeHtml(c.ticker)}</span></h3>
        <p>${escapeHtml(c.description || '')}</p>
        ${c.creator_id ? `
          <button type="button" class="creator-chip" data-profile="${escapeHtml(c.creator_id)}">
            <span class="creator-mini-av">${creator?.avatar_url ? `<img src="${escapeHtml(creator.avatar_url)}">` : escapeHtml(creatorName[0].toUpperCase())}</span>
            <span>Created by ${escapeHtml(creatorName)}${tierBadgeHtml(creatorObj)}</span>
          </button>
        ` : `<p class="muted tiny">Community created</p>`}
      </div>
      <button type="button" class="fav-btn ${isFav ? 'active' : ''}" data-fav="${escapeHtml(c.id)}" title="${isFav ? 'Remove from watchlist' : 'Add to watchlist'}" aria-label="Toggle watchlist">${isFav ? '★' : '☆'}</button>
    </div>
    <div class="detail-price">${priceFmt(c.price)}</div>
    <div class="coin-change ${detailChg.cls}">${detailChg.text}</div>
    <div class="chart-wrap">
      <div class="chart-head">
        <div>
          <strong>Price history + trades</strong>
          <span class="muted tiny">Scroll wheel or zoom buttons to view whole timeline</span>
        </div>
        <div class="chart-controls">
          <button class="zoom-btn" id="zoomOutBtn" title="Zoom out / See whole timeline">− Zoom Out</button>
          <span class="zoom-level-text" id="zoomLevelText">${chartZoom <= 1.0 ? 'Fit' : Math.round(chartZoom * 100) + '%'}</span>
          <button class="zoom-btn" id="zoomInBtn" title="Zoom in / Closer detail">+ Zoom In</button>
          <button class="zoom-btn" id="zoomFitBtn" title="Fit whole timeline on screen">Fit all</button>
        </div>
      </div>
      <div class="chart-scroll" id="chartScroll"><div class="chart-inner" id="chartInner"><canvas id="priceChart"></canvas></div></div>
    </div>
    <div class="coin-bottom-grid">
      <div class="trade-panel">
        <h3>Trade $${escapeHtml(c.ticker)}</h3>
        <div class="trade-buttons">
          ${[1, 5, 10, 25].map(n => `<button class="amount-btn ${!customBuyActive && n === selectedAmount ? 'active' : ''}" data-buy="${n}">$${n}</button>`).join('')}
          <div class="amount-btn amount-custom ${customBuyActive ? 'active' : ''}" id="customBuyWrap" title="Enter custom buy amount">
            <span class="pen-icon" aria-hidden="true">✎</span>
            <input id="customBuyInput" type="number" min="0.01" step="any" placeholder="Custom" value="${escapeHtml(customBuyValue)}">
          </div>
        </div>
        <div class="trade-actions">
          <button class="buy-btn" id="buyBtn">${buyBtnLabel}</button>
          <div class="sell-group">
            <button class="sell-btn" data-sell="0.25">Sell 25%</button>
            <button class="sell-btn" data-sell="0.5">Sell 50%</button>
            <button class="sell-btn" data-sell="1">Sell 100%</button>
          </div>
        </div>
        <p class="muted tiny" style="margin-top:10px">You own: ${shares.toFixed(4)} shares · Worth ${money(shares * c.price)} · Cash ${money(currentUser.cash)}</p>
        <p class="form-message" id="tradeMessage"></p>
        ${isDompinator() ? `
          <button class="delete-coin-btn" id="deleteCoinBtn">🗑 Delete currency (Dompinator admin)</button>
        ` : ''}
      </div>
      <div class="coin-leaderboard">
        <div class="eyebrow purple-text" style="margin-bottom:4px;">CURRENCY LEADERBOARD</div>
        <h4>Most spent on $${escapeHtml(c.ticker)}</h4>
        <div id="coinLeaderboardList" class="leaderboard-list">
          <p class="muted tiny">Loading leaderboard...</p>
        </div>
      </div>
    </div>
  `;

  $$('#coinDetail [data-fav]').forEach(btn => btn.addEventListener('click', () => toggleWatchlist(btn.dataset.fav)));
  $$('#coinDetail [data-profile]').forEach(btn => btn.addEventListener('click', () => openProfileModal(btn.dataset.profile)));
  $$('[data-buy]').forEach(b => b.addEventListener('click', () => {
    customBuyActive = false;
    selectedAmount = Number(b.dataset.buy);
    $$('[data-buy]').forEach(x => x.classList.toggle('active', x === b));
    $('#customBuyWrap')?.classList.remove('active');
    $('#buyBtn').textContent = `Buy ${money(selectedAmount)}`;
  }));

  const customWrap = $('#customBuyWrap');
  const customInput = $('#customBuyInput');
  const activateCustomBuy = () => {
    customBuyActive = true;
    $$('[data-buy]').forEach(x => x.classList.remove('active'));
    customWrap?.classList.add('active');
    customBuyValue = customInput?.value ?? '';
    const val = Number(customBuyValue);
    selectedAmount = Number.isFinite(val) && val > 0 ? val : 0;
    const buyBtn = $('#buyBtn');
    if (buyBtn) buyBtn.textContent = selectedAmount > 0 ? `Buy ${money(selectedAmount)}` : 'Enter amount';
  };
  customWrap?.addEventListener('click', () => {
    customInput?.focus();
    activateCustomBuy();
  });
  customInput?.addEventListener('focus', activateCustomBuy);
  customInput?.addEventListener('input', activateCustomBuy);
  customInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#buyBtn')?.click();
    }
  });

  $('#buyBtn')?.addEventListener('click', () => {
    if (!selectedAmount || selectedAmount <= 0) {
      const msg = $('#tradeMessage');
      if (msg) msg.textContent = 'Enter a valid amount to buy.';
      return;
    }
    buy(c, selectedAmount);
  });
  $$('[data-sell]').forEach(b => b.addEventListener('click', () => sell(c, shares * Number(b.dataset.sell))));

  // Zoom Button Controls
  const updateChart = () => drawChartWithBubbles(c, trades.slice().reverse());

  $('#zoomOutBtn')?.addEventListener('click', () => {
    chartZoom = Math.max(1.0, +(chartZoom - 0.35).toFixed(2));
    updateChart();
  });
  $('#zoomInBtn')?.addEventListener('click', () => {
    chartZoom = Math.min(4.0, +(chartZoom + 0.35).toFixed(2));
    updateChart();
  });
  $('#zoomFitBtn')?.addEventListener('click', () => {
    chartZoom = 1.0;
    updateChart();
  });

  // Mouse wheel zoom on chart: scroll out to see whole timeline, scroll in to see closer & scrollbar
  const chartScrollEl = $('#chartScroll');
  chartScrollEl?.addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      if (e.deltaY < 0) {
        chartZoom = Math.min(4.0, +(chartZoom + 0.2).toFixed(2));
      } else {
        chartZoom = Math.max(1.0, +(chartZoom - 0.2).toFixed(2));
      }
      updateChart();
    }
  }, { passive: false });

  // Dompinator Delete Handler
  if (isDompinator()) {
    $('#deleteCoinBtn')?.addEventListener('click', async () => {
      if (!confirm(`Are you sure you want to delete ${c.name} ($${c.ticker})? This action is permanent.`)) return;
      try {
        await sb.from('holdings').delete().eq('coin_id', c.id);
        await sb.from('trades').delete().eq('coin_id', c.id);
        const { error } = await sb.from('coins').delete().eq('id', c.id);
        if (error) {
          toast('Delete failed: ' + error.message);
          return;
        }
      } catch (err) {
        console.error('Delete error:', err);
      }
      coins = coins.filter(x => x.id !== c.id);
      toast(`Deleted currency $${c.ticker}`);
      await loadCoins();
      showPage('feed');
    });
  }

  drawChartWithBubbles(c, trades.slice().reverse());
  getCoinSpendLeaderboard(c.id).then(rows => {
    const el = $('#coinLeaderboardList');
    if (el && selectedCoin && selectedCoin.id === c.id) {
      el.innerHTML = renderSpendRows(rows, 'No one has bought this currency yet.');
      $$('#coinLeaderboardList [data-profile]').forEach(btn => btn.addEventListener('click', () => openProfileModal(btn.dataset.profile)));
    }
  });
}

// Market impact:
// If price is low (e.g. 1), moves price by a HUGE difference!
// If price is high (e.g. 50), moves price much less.
function calculateImpact(amount, price) {
  const p = Math.max(Number(price) || 1, 0.2);
  return (amount * 0.3) / Math.pow(p, 2.2);
}

async function updateNetWorth() {
  if (!currentUser || !sb) return;
  const [{ data: holds }, { data: myCoins }] = await Promise.all([
    sb.from('holdings').select('shares, coins(price)').eq('user_id', currentUser.id),
    sb.from('coins').select('price').eq('creator_id', currentUser.id)
  ]);
  const holdingsValue = (holds || []).reduce((s, h) => s + Number(h.shares || 0) * Number(h.coins?.price || 0), 0);
  const createdValue = (myCoins || []).reduce((s, c) => s + Number(c.price || 0), 0);
  const portValue = holdingsValue + createdValue;
  const nw = Number(currentUser.cash || 0) + portValue;
  currentUser.net_worth = nw;
  await sb.from('profiles').update({ net_worth: nw }).eq('id', currentUser.id);
  const portEl = $('#portfolioValue');
  if (portEl) portEl.textContent = money(portValue);
  const totalEl = $('#totalValue');
  if (totalEl) totalEl.textContent = money(nw);
}

async function freshCoin(coin) {
  const { data } = await sb.from('coins').select('*').eq('id', coin.id).single();
  return data || coin;
}

async function buy(coin, amount) {
  if (!currentUser || currentUser.cash < amount) return $('#tradeMessage').textContent = 'Not enough cash.';
  const prevOpenToday = Number(coin.today_open_price) || Number(coin.price) || 1;
  coin = await freshCoin(coin);   // use the live price, not a stale one
  const impact = calculateImpact(amount, coin.price);
  const newPrice = coin.price * (1 + impact);
  const todayPct = prevOpenToday > 0 ? ((newPrice - prevOpenToday) / prevOpenToday) * 100 : 0;
  const shares = amount / coin.price;
  const newCash = currentUser.cash - amount;

  const { error: cashErr } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  if (cashErr) return $('#tradeMessage').textContent = 'Cash error: ' + cashErr.message;

  await sb.from('coins').update({ price: newPrice, change_pct: todayPct }).eq('id', coin.id);

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

  // Store local trade for immediate timeline bubble rendering
  coin.localTrades = coin.localTrades || [];
  coin.localTrades.unshift({
    id: 'trd_' + Date.now(),
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'buy',
    amount_usd: amount,
    shares,
    price_after: newPrice,
    created_at: new Date().toISOString(),
    profiles: {
      username: currentUser.username,
      avatar_url: currentUser.avatar_url
    }
  });

  currentUser.cash = newCash;
  coin.price = newPrice;
  coin.today_open_price = prevOpenToday;
  coin.change_pct = todayPct;
  updateUIProfile();
  await updateNetWorth();
  toast(`Bought for ${money(amount)}! Price ${priceFmt(coin.price)} (+${(impact * 100).toFixed(impact < 0.1 ? 2 : 0)}%)`);
  await loadCoins();
  selectedCoin = coins.find(x => x.id === coin.id) || coin;
  renderCoinDetail();
}

async function sell(coin, sharesToSell) {
  if (!currentUser || sharesToSell <= 0) return $('#tradeMessage').textContent = 'No shares to sell.';
  const prevOpenToday = Number(coin.today_open_price) || Number(coin.price) || 1;
  coin = await freshCoin(coin);
  const { data: hold } = await sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
  const owned = hold?.shares || 0;
  const sellShares = Math.min(sharesToSell, owned);
  if (sellShares <= 0) return;
  const proceeds = sellShares * coin.price;
  const impact = calculateImpact(proceeds, coin.price) * 0.6;
  const newPrice = Math.max(0.01, coin.price / (1 + impact));   // never drops below 0 / over 100%
  const todayPct = prevOpenToday > 0 ? ((newPrice - prevOpenToday) / prevOpenToday) * 100 : 0;
  const newCash = currentUser.cash + proceeds;

  const remainingShares = owned - sellShares < 1e-8 ? 0 : owned - sellShares;
  await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  await sb.from('coins').update({ price: newPrice, change_pct: todayPct }).eq('id', coin.id);
  await sb.from('holdings').update({ shares: remainingShares }).eq('user_id', currentUser.id).eq('coin_id', coin.id);
  await sb.from('trades').insert({
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'sell',
    amount_usd: proceeds,
    shares: sellShares,
    price_after: newPrice
  });

  coin.localTrades = coin.localTrades || [];
  coin.localTrades.unshift({
    id: 'trd_' + Date.now(),
    coin_id: coin.id,
    user_id: currentUser.id,
    type: 'sell',
    amount_usd: proceeds,
    shares: sellShares,
    price_after: newPrice,
    created_at: new Date().toISOString(),
    profiles: {
      username: currentUser.username,
      avatar_url: currentUser.avatar_url
    }
  });

  currentUser.cash = newCash;
  coin.price = newPrice;
  coin.today_open_price = prevOpenToday;
  coin.change_pct = todayPct;
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

  const zoomText = $('#zoomLevelText');
  if (zoomText) {
    zoomText.textContent = chartZoom <= 1.0 ? 'Fit' : Math.round(chartZoom * 100) + '%';
  }

  const baseW = Math.max(scroll.clientWidth || 600, 320);
  const PAD_X = 46, PAD_TOP = 64, PAD_BOT = 24;
  const H = 300;

  // Points: start at $1 (creation), then one point per trade (works for every coin)
  const points = [{ price: 1, trade: null }];
  trades.forEach(t => points.push({ price: Number(t.price_after) || coin.price, trade: t }));
  if (!trades.length) points.push({ price: Number(coin.price), trade: null });

  // Width calculation:
  // When chartZoom <= 1.0: W = baseW (no scrollbar! Whole timeline fits on screen)
  // When chartZoom > 1.0: W expands proportionally so you can scroll close up!
  let W;
  if (chartZoom <= 1.0) {
    W = baseW;
    scroll.style.overflowX = 'hidden';
  } else {
    const numPoints = Math.max(points.length - 1, 1);
    const fitStep = (baseW - PAD_X * 2) / numPoints;
    const step = Math.max(fitStep * chartZoom, 40 * chartZoom);
    W = Math.max(baseW, PAD_X * 2 + numPoints * step);
    scroll.style.overflowX = 'auto';
  }

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
    const name = t.profiles?.username || (t.user_id === currentUser?.id ? currentUser.username : 'Someone');
    const avatar = t.profiles?.avatar_url || (t.user_id === currentUser?.id ? currentUser.avatar_url : null);
    const amt = Number(t.amount_usd || 0);
    const b = document.createElement('div');
    b.className = 'bubble ' + (isBuy ? 'buy' : 'sell');
    b.style.left = xAt(i) + 'px';
    b.style.top = (yAt(p.price) - 8) + 'px';
    b.innerHTML = `
      <div class="bubble-pfp">${avatar ? `<img src="${escapeHtml(avatar)}">` : `<span>${escapeHtml(name[0].toUpperCase())}</span>`}</div>
      <div class="bubble-amt">${isBuy ? '' : '−'}${money(amt)}</div>`;
    b.title = `${name} ${isBuy ? 'bought' : 'sold'} ${money(amt)} · price after ${priceFmt(t.price_after)}`;
    inner.appendChild(b);
  });

  if (chartZoom > 1.0) {
    scroll.scrollLeft = scroll.scrollWidth;
  }
}

// ---------- Money / Portfolio (Personal P&L is strictly private to currentUser) ----------
async function renderMoney() {
  if (!currentUser || !sb) return;
  const [{ data: holds }, { data: myCoins }, { data: myTrades }] = await Promise.all([
    sb.from('holdings').select('*, coins(name, ticker, price, image_url)').eq('user_id', currentUser.id).gt('shares', 0),
    sb.from('coins').select('*').eq('creator_id', currentUser.id).order('created_at', { ascending: false }),
    sb.from('trades').select('coin_id, type, amount_usd').eq('user_id', currentUser.id)
  ]);
  const list = holds || [];
  const created = myCoins || [];
  const holdingsValue = list.reduce((s, h) => s + Number(h.shares || 0) * Number(h.coins?.price || 0), 0);
  const createdValue = created.reduce((s, c) => s + Number(c.price || 0), 0);
  const value = holdingsValue + createdValue;
  const nw = Number(currentUser.cash || 0) + value;
  currentUser.net_worth = nw;
  await sb.from('profiles').update({ net_worth: nw }).eq('id', currentUser.id);
  $('#portfolioValue').textContent = money(value);
  $('#totalValue').textContent = money(nw);

  // Personal private spend / return / P&L per coin (never visible to anyone else)
  const personalStats = new Map();
  let totalSpent = 0;
  let totalReturned = 0;
  (myTrades || []).forEach(t => {
    const amt = Number(t.amount_usd || 0);
    const s = personalStats.get(t.coin_id) || { spent: 0, sold: 0 };
    if (t.type === 'sell') {
      s.sold += amt;
      totalReturned += amt;
    } else {
      s.spent += amt;
      totalSpent += amt;
    }
    personalStats.set(t.coin_id, s);
  });

  const pnlSummaryEl = $('#personalPnlSummary');
  if (pnlSummaryEl) {
    if (totalSpent > 0 || totalReturned > 0) {
      const totalPnl = (holdingsValue + totalReturned) - totalSpent;
      const cls = totalPnl >= 0 ? 'pnl-up' : 'pnl-down';
      const sign = totalPnl >= 0 ? '+' : '−';
      pnlSummaryEl.innerHTML = `
        <span><strong>Personal Stats (Private):</strong> Spent ${money(totalSpent)} · Returned ${money(totalReturned)}</span>
        <span class="${cls}">Net P&amp;L: ${sign}${money(Math.abs(totalPnl))}</span>`;
      pnlSummaryEl.classList.remove('hidden');
    } else {
      pnlSummaryEl.classList.add('hidden');
    }
  }

  const createdHtml = created.map(c => `
    <div class="holding" data-coin="${c.id}">
      <div class="holding-left">
        <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml((c.ticker || '?')[0])}</div>
        <div>
          <strong>${escapeHtml(c.name || '')}</strong>
          <div class="muted tiny">Your created currency · $${escapeHtml(c.ticker || '')}</div>
        </div>
      </div>
      <div class="holding-right">
        <strong>${money(c.price || 0)}</strong>
      </div>
    </div>
  `).join('');

  const holdsHtml = list.map(h => {
    const curVal = Number(h.shares || 0) * Number(h.coins?.price || 0);
    const st = personalStats.get(h.coin_id);
    let pnlLine = '';
    if (st && (st.spent > 0 || st.sold > 0)) {
      const pnl = (curVal + st.sold) - st.spent;
      const cls = pnl >= 0 ? 'pnl-up' : 'pnl-down';
      const sign = pnl >= 0 ? '+' : '−';
      pnlLine = `<div class="tiny"><span class="muted">Spent ${money(st.spent)} · Sold ${money(st.sold)} · </span><span class="${cls}">${sign}${money(Math.abs(pnl))}</span></div>`;
    }
    return `
    <div class="holding" data-coin="${h.coin_id}">
      <div class="holding-left">
        <div class="coin-logo">${h.coins?.image_url ? `<img src="${escapeHtml(h.coins.image_url)}">` : (h.coins?.ticker || '?')[0]}</div>
        <div>
          <strong>${escapeHtml(h.coins?.name || '')}</strong>
          <div class="muted tiny">${Number(h.shares || 0).toFixed(4)} $${escapeHtml(h.coins?.ticker || '')}</div>
          ${pnlLine}
        </div>
      </div>
      <div class="holding-right">
        <strong>${money(curVal)}</strong>
      </div>
    </div>`;
  }).join('');

  $('#holdingsList').innerHTML = createdHtml + holdsHtml;
  $('#emptyHoldings').classList.toggle('hidden', created.length > 0 || list.length > 0);
  $$('.holding').forEach(el => el.addEventListener('click', () => openCoin(el.dataset.coin)));
}

// ---------- Currency & Global Leaderboards ----------
async function getCoinSpendLeaderboard(coinId) {
  if (!sb || !coinId) return [];
  const { data, error } = await sb
    .from('trades')
    .select('user_id, amount_usd, profiles(username, avatar_url, is_premium)')
    .eq('coin_id', coinId)
    .eq('type', 'buy');
  if (error || !data) return [];

  const totals = new Map();
  for (const t of data) {
    if (!t.user_id) continue;
    const prev = totals.get(t.user_id) || {
      id: t.user_id,
      user_id: t.user_id,
      username: t.profiles?.username || 'Unknown',
      avatar_url: t.profiles?.avatar_url || null,
      is_premium: Boolean(t.profiles?.is_premium),
      spent: 0,
      buys: 0
    };
    prev.spent += Number(t.amount_usd || 0);
    prev.buys += 1;
    totals.set(t.user_id, prev);
  }
  return Array.from(totals.values()).sort((a, b) => b.spent - a.spent);
}

function renderSpendRows(rows, emptyText = 'No buyers yet.') {
  if (!rows.length) {
    return `<div class="empty-state" style="padding:24px 12px;"><p>${escapeHtml(emptyText)}</p></div>`;
  }
  return rows.map((p, i) => `
    <div class="lb-row">
      <div class="lb-rank ${i < 3 ? 'top3' : ''}">#${i + 1}</div>
      <div class="avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div class="lb-info">
        <strong class="profile-link" data-profile="${escapeHtml(p.user_id)}">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}</strong>
        <div class="muted tiny">${p.buys} buy${p.buys === 1 ? '' : 's'}</div>
      </div>
      <div class="lb-value">${money(p.spent)} spent</div>
    </div>
  `).join('');
}

async function renderLeaderboard() {
  if (!sb) return;
  await loadProUserIds();
  if (currentUser) await updateNetWorth();
  let query = sb.from('profiles').select('id, username, avatar_url, net_worth, time_played, is_premium');
  if (lbMode === 'networth') {
    query = query.order('net_worth', { ascending: false }).limit(100);
  } else {
    query = query.order('time_played', { ascending: false }).limit(100);
  }
  const { data } = await query;
  const list = data || [];
  $('#leaderboardList').innerHTML = list.map((p, i) => `
    <div class="lb-row">
      <div class="lb-rank ${i < 3 ? 'top3' : ''}">#${i + 1}</div>
      <div class="avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div class="lb-info">
        <strong class="profile-link" data-profile="${escapeHtml(p.id)}">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}</strong>
        <div class="muted tiny">${lbMode === 'networth' ? 'Net worth' : 'Time played'}</div>
      </div>
      <div class="lb-value">${lbMode === 'networth' ? money(p.net_worth || 0) : formatTime(p.time_played || 0)}</div>
    </div>
  `).join('');
  $('#emptyLeaderboard').classList.toggle('hidden', list.length > 0);
  $$('#leaderboardList [data-profile]').forEach(el => el.addEventListener('click', () => openProfileModal(el.dataset.profile)));
}

// ---------- Profile Preview Modal (Public stats only) ----------
async function openProfileModal(userId) {
  if (!sb || !userId) return;
  const modal = $('#profileModal');
  const body = $('#profileModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<p class="muted tiny">Loading profile...</p>';
  modal.classList.remove('hidden');

  await loadProUserIds();
  const { data: p } = await sb
    .from('profiles')
    .select('id, username, avatar_url, net_worth, time_played, is_premium')
    .eq('id', userId)
    .maybeSingle();

  if (!p) {
    body.innerHTML = '<p class="muted">Trader not found.</p>';
    return;
  }

  const userCoins = coins.filter(c => c.creator_id === p.id);
  body.innerHTML = `
    <div class="profile-modal-hero">
      <div class="avatar" style="width:58px;height:58px;font-size:22px;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div>
        <h3 style="margin:0;">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}</h3>
        <div class="muted tiny">${tierLabel(p)}</div>
      </div>
    </div>
    <div class="profile-modal-stats">
      <div><span class="muted tiny">NET WORTH</span><strong>${money(p.net_worth || 0)}</strong></div>
      <div><span class="muted tiny">TIME PLAYED</span><strong>${formatTime(p.time_played || 0)}</strong></div>
    </div>
    <div>
      <div class="eyebrow purple-text" style="margin-bottom:8px;">CREATED CURRENCIES (${userCoins.length})</div>
      ${userCoins.length ? `
        <div class="profile-coins-list">
          ${userCoins.map(c => `
            <div class="holding" data-modal-coin="${escapeHtml(c.id)}">
              <div class="holding-left">
                <div class="coin-logo" style="width:38px;height:38px;">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml((c.ticker || '?')[0])}</div>
                <div>
                  <strong>${escapeHtml(c.name)}</strong>
                  <div class="muted tiny">$${escapeHtml(c.ticker)}</div>
                </div>
              </div>
              <div class="holding-right"><strong>${priceFmt(c.price)}</strong></div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="muted tiny">No created currencies yet.</p>'}
    </div>
  `;

  $$('[data-modal-coin]').forEach(el => el.addEventListener('click', () => {
    modal.classList.add('hidden');
    openCoin(el.dataset.modalCoin);
  }));
}

$('#closeProfileBtn')?.addEventListener('click', () => $('#profileModal')?.classList.add('hidden'));
$('#profileModal')?.addEventListener('click', e => {
  if (e.target === $('#profileModal')) $('#profileModal').classList.add('hidden');
});

// ---------- Daily Login Rewards ----------
function getLocalDateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getDailyState() {
  if (!currentUser) return { lastDate: null, streak: 0 };
  let local = { lastDate: null, streak: 0 };
  try {
    const raw = localStorage.getItem('grind_daily_' + currentUser.id);
    if (raw) local = JSON.parse(raw);
  } catch (e) {}

  let remote = { lastDate: null, streak: 0 };
  if (sb) {
    try {
      const { data } = await sb
        .from('premium_requests')
        .select('reason')
        .eq('user_id', currentUser.id)
        .like('reason', '__DAILY__:%')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.reason) {
        const parts = data.reason.split(':');
        if (parts.length >= 3) {
          remote = { lastDate: parts[1], streak: Number(parts[2]) || 0 };
        }
      }
    } catch (e) {}
  }

  if (remote.lastDate && (!local.lastDate || remote.lastDate >= local.lastDate)) {
    return remote;
  }
  return local;
}

async function checkDailyLogin(forceOpen = false) {
  if (!currentUser) return;
  const state = await getDailyState();
  dailyStateCache = state;
  const today = getLocalDateKey(0);
  const yesterday = getLocalDateKey(-1);
  const claimedToday = state.lastDate === today;

  if (claimedToday && !forceOpen) return;

  let activeDay;
  if (claimedToday) {
    activeDay = state.streak || 1;
  } else if (state.lastDate === yesterday && state.streak >= 1 && state.streak <= 7) {
    activeDay = state.streak === 7 ? 1 : state.streak + 1;
  } else {
    activeDay = 1;
  }

  renderDailyModal(activeDay, claimedToday, state.streak || 0);
  $('#dailyModal')?.classList.remove('hidden');
}

function renderDailyModal(activeDay, claimedToday, currentStreak) {
  const mult = (currentUser?.is_pro || currentUser?.is_premium) ? 2 : 1;
  const sub = $('#dailySubtitle');
  if (sub) {
    sub.textContent = mult === 2
      ? `${tierLabel(currentUser)} perk active: 2X daily cash rewards!`
      : 'Come back every day for bigger rewards and a free PRO upgrade on Day 7!';
  }

  const grid = $('#dailyGrid');
  if (grid) {
    grid.innerHTML = DAILY_REWARDS.map((r, idx) => {
      const day = idx + 1;
      const isClaimed = claimedToday ? day <= currentStreak : day < activeDay;
      const isCurrent = !claimedToday && day === activeDay;
      const hasProOrBetter = Boolean(currentUser?.is_pro || currentUser?.is_premium);
      const rewardText = r === 'PRO'
        ? (hasProOrBetter ? '$30' : 'Free PRO Tier Upgrade')
        : money(r * mult);
      const subText = day === 7
        ? (hasProOrBetter ? 'Bonus Cash' : '')
        : (mult === 2 ? '2X Active' : 'Cash');
      return `
        <div class="daily-day ${day === 7 ? 'day-7' : ''} ${isClaimed ? 'claimed' : ''} ${isCurrent ? 'current' : ''}">
          <span class="muted tiny">DAY ${day}</span>
          <strong>${rewardText}</strong>
          ${subText ? `<span class="tiny">${subText}</span>` : ''}
        </div>`;
    }).join('');
  }

  const claimBtn = $('#claimDailyBtn');
  const statusEl = $('#dailyStatusText');
  if (claimBtn) {
    claimBtn.dataset.day = String(activeDay);
    if (claimedToday) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'Claimed today ✓';
      if (statusEl) statusEl.textContent = 'Come back tomorrow for your next reward!';
    } else {
      claimBtn.disabled = false;
      const r = DAILY_REWARDS[activeDay - 1];
      const label = r === 'PRO'
        ? ((currentUser?.is_pro || currentUser?.is_premium) ? 'Claim $30.00' : 'Claim Free PRO Tier Upgrade')
        : `Claim ${money(r * mult)}`;
      claimBtn.textContent = label;
      if (statusEl) statusEl.textContent = `Day ${activeDay} of 7 ready to claim!`;
    }
  }
}

$('#openDailyBtn')?.addEventListener('click', () => checkDailyLogin(true));
$('#closeDailyBtn')?.addEventListener('click', () => $('#dailyModal')?.classList.add('hidden'));
$('#dailyModal')?.addEventListener('click', e => {
  if (e.target === $('#dailyModal')) $('#dailyModal').classList.add('hidden');
});

$('#claimDailyBtn')?.addEventListener('click', async () => {
  const btn = $('#claimDailyBtn');
  if (!btn || btn.disabled || !currentUser || !sb) return;
  const day = Number(btn.dataset.day || 1);
  const today = getLocalDateKey(0);
  if (dailyStateCache?.lastDate === today) return;

  btn.disabled = true;
  btn.textContent = 'Claiming...';

  const mult = (currentUser.is_pro || currentUser.is_premium) ? 2 : 1;
  const r = DAILY_REWARDS[day - 1];

  if (r === 'PRO' && !currentUser.is_pro && !currentUser.is_premium) {
    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__PRO_TIER__',
      status: 'approved'
    });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Claim Free PRO Tier Upgrade';
      toast('Error unlocking PRO: ' + error.message);
      return;
    }
    localStorage.setItem('grind_pro_' + currentUser.id, '1');
    currentUser.is_pro = true;
    proUserIds.add(currentUser.id);
    toast('Day 7 claimed! You unlocked PRO tier!');
  } else {
    const cashGain = r === 'PRO' ? 30 : r * mult;
    const newCash = Number(currentUser.cash || 0) + cashGain;
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Claim reward';
      toast('Error claiming reward: ' + error.message);
      return;
    }
    currentUser.cash = newCash;
    await updateNetWorth();
    toast(`Day ${day} reward claimed: +${money(cashGain)}!`);
  }

  const newState = { lastDate: today, streak: day };
  dailyStateCache = newState;
  try {
    localStorage.setItem('grind_daily_' + currentUser.id, JSON.stringify(newState));
  } catch (e) {}
  await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: `__DAILY__:${today}:${day}`,
    status: 'denied'
  });

  updateUIProfile();
  renderFeed();
  $('#dailyModal')?.classList.add('hidden');
});

// ---------- Ads ----------
const AD_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'];
const AD_VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];

function getAdType(filename) {
  const lower = String(filename || '').toLowerCase();
  if (AD_VIDEO_EXTS.some(ext => lower.endsWith(ext))) return 'video';
  if (AD_IMAGE_EXTS.some(ext => lower.endsWith(ext))) return 'image';
  return null;
}

function detectGitHubRepo() {
  const host = window.location.hostname || '';
  const parts = (window.location.pathname || '').split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const repo = parts[0] || 'Grind';
    return `${owner}/${repo}`;
  }
  return 'Dompinator/Grind';
}

async function loadAdsList(force = false) {
  if (!force && adsCache && Date.now() - adsCacheTime < 60000) return adsCache;
  let items = [];
  const repo = detectGitHubRepo();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/ads`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        items = data
          .filter(f => f.type === 'file' && getAdType(f.name))
          .map(f => ({
            name: f.name,
            type: getAdType(f.name),
            url: 'ads/' + encodeURIComponent(f.name),
            fallbackUrl: f.download_url || null
          }));
      }
    }
  } catch (e) {}

  if (!items.length) {
    try {
      const res = await fetch('ads/manifest.json');
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          items = list
            .filter(name => getAdType(name))
            .map(name => ({
              name,
              type: getAdType(name),
              url: 'ads/' + encodeURIComponent(name),
              fallbackUrl: null
            }));
        }
      }
    } catch (e) {}
  }

  adsCache = items;
  adsCacheTime = Date.now();
  return items;
}

function cleanupAds() {
  activeAdToken += 1;
  adLocked = false;
  if (adTimerInterval) {
    clearInterval(adTimerInterval);
    adTimerInterval = null;
  }
  const vid = $('#adVideo');
  if (vid) {
    try { vid.pause(); } catch (e) {}
  }
}

async function startAdsPage() {
  cleanupAds();
  const stage = $('#adStage');
  const statusEl = $('#adStatusText');
  const playBtn = $('#adPlayBtn');
  const muteBtn = $('#adMuteBtn');
  const skipBtn = $('#adSkipBtn');
  const claimBtn = $('#adClaimBtn');
  const backBtn = $('#adBackBtn');
  if (!stage) return;

  playBtn?.classList.add('hidden');
  muteBtn?.classList.add('hidden');
  skipBtn?.classList.add('hidden');
  claimBtn?.classList.add('hidden');
  backBtn?.classList.add('hidden');
  if (statusEl) statusEl.textContent = 'Finding an ad...';
  stage.innerHTML = '<p class="muted">Loading random ad...</p>';

  const list = await loadAdsList(true);
  loadRandomAd(list);
}

function loadRandomAd(preloadedList) {
  cleanupAds();
  const token = activeAdToken;
  const list = preloadedList || adsCache || [];
  const stage = $('#adStage');
  const statusEl = $('#adStatusText');
  const playBtn = $('#adPlayBtn');
  const muteBtn = $('#adMuteBtn');
  const skipBtn = $('#adSkipBtn');
  const claimBtn = $('#adClaimBtn');
  const backBtn = $('#adBackBtn');
  if (!stage) return;

  playBtn?.classList.add('hidden');
  muteBtn?.classList.add('hidden');
  skipBtn?.classList.add('hidden');
  claimBtn?.classList.add('hidden');
  backBtn?.classList.add('hidden');

  if (!list.length) {
    stage.innerHTML = `
      <div>
        <div class="empty-icon">▶</div>
        <h3>No ads in the ads/ folder yet</h3>
        <p class="muted">Add .mp4 or image files into the <code>ads/</code> folder on GitHub to display ads here.</p>
      </div>`;
    if (statusEl) statusEl.textContent = '';
    backBtn?.classList.remove('hidden');
    return;
  }

  let pool = list;
  if (list.length > 1 && lastAdName) {
    pool = list.filter(a => a.name !== lastAdName);
  }
  const ad = pool[Math.floor(Math.random() * pool.length)];
  lastAdName = ad.name;

  if (ad.type === 'image') {
    adLocked = true;
    let remaining = 60;
    stage.innerHTML = `<img id="adImageEl" src="${escapeHtml(ad.url)}" alt="Ad">`;
    const imgEl = $('#adImageEl');
    if (imgEl && ad.fallbackUrl) {
      imgEl.onerror = () => {
        if (imgEl.dataset.fallbackTried) return;
        imgEl.dataset.fallbackTried = '1';
        imgEl.src = ad.fallbackUrl;
      };
    }

    if (skipBtn) {
      skipBtn.classList.remove('hidden');
      skipBtn.disabled = true;
      skipBtn.textContent = `Skip in ${remaining}s`;
    }
    if (statusEl) statusEl.textContent = `Watch this image ad for ${remaining} seconds before leaving.`;

    adTimerInterval = setInterval(() => {
      if (token !== activeAdToken || currentPage !== 'ads') {
        clearInterval(adTimerInterval);
        adTimerInterval = null;
        return;
      }
      if (document.hidden) return;
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(adTimerInterval);
        adTimerInterval = null;
        adLocked = false;
        if (skipBtn) {
          skipBtn.disabled = false;
          skipBtn.textContent = 'Skip Ad → Feed';
        }
        if (statusEl) statusEl.textContent = 'Time is up! You can return to Feed now.';
      } else {
        if (skipBtn) skipBtn.textContent = `Skip in ${remaining}s`;
        if (statusEl) statusEl.textContent = `Watch this image ad for ${remaining} seconds before leaving.`;
      }
    }, 1000);
  } else {
    adLocked = true;
    adClaimed = false;
    let maxWatchedTime = 0;

    stage.innerHTML = `<video id="adVideo" src="${escapeHtml(ad.url)}" playsinline autoplay disablePictureInPicture controlsList="nodownload noplaybackrate"></video>`;
    const video = $('#adVideo');
    if (video) {
      video.defaultPlaybackRate = 1;
      video.playbackRate = 1;
      video.addEventListener('contextmenu', e => e.preventDefault());
      video.addEventListener('ratechange', () => {
        if (video.playbackRate !== 1) video.playbackRate = 1;
      });
      video.onerror = () => {
        if (ad.fallbackUrl && !video.dataset.fallbackTried) {
          video.dataset.fallbackTried = '1';
          video.src = ad.fallbackUrl;
          video.play().catch(() => {});
          return;
        }
        adLocked = false;
        playBtn?.classList.add('hidden');
        muteBtn?.classList.add('hidden');
        if (statusEl) statusEl.textContent = `Could not play "${ad.name}". Make sure it is a valid video file.`;
        claimBtn?.classList.add('hidden');
        backBtn?.classList.remove('hidden');
      };
    }

    if (claimBtn) {
      claimBtn.classList.remove('hidden');
      claimBtn.disabled = true;
      claimBtn.dataset.ready = '0';
      claimBtn.textContent = 'Wait until video ends ($1.00)';
    }
    if (statusEl) statusEl.textContent = 'Watch the full video to claim your $1.00 reward.';

    if (video) {
      const syncVideoBtns = () => {
        if (playBtn) playBtn.textContent = video.paused ? 'Play' : 'Pause';
        if (muteBtn) muteBtn.textContent = video.muted ? 'Unmute' : 'Mute';
      };
      if (playBtn) {
        playBtn.classList.remove('hidden');
        playBtn.onclick = () => {
          if (video.paused) video.play().catch(() => {});
          else video.pause();
        };
      }
      if (muteBtn) {
        muteBtn.classList.remove('hidden');
        muteBtn.onclick = () => {
          video.muted = !video.muted;
          syncVideoBtns();
        };
      }
      video.addEventListener('play', syncVideoBtns);
      video.addEventListener('pause', syncVideoBtns);
      video.addEventListener('volumechange', syncVideoBtns);

      video.play().then(syncVideoBtns).catch(() => {
        video.muted = true;
        syncVideoBtns();
        video.play().then(syncVideoBtns).catch(() => syncVideoBtns());
      });

      video.addEventListener('timeupdate', () => {
        if (token !== activeAdToken) return;
        if (video.playbackRate !== 1) video.playbackRate = 1;
        if (!video.seeking && video.currentTime > maxWatchedTime) {
          maxWatchedTime = video.currentTime;
        }
        if (video.duration && adLocked) {
          const left = Math.max(0, Math.ceil(video.duration - video.currentTime));
          if (statusEl) statusEl.textContent = `Watch until the end to claim $1.00 (${left}s left)`;
        }
      });

      video.addEventListener('seeking', () => {
        if (video.currentTime > maxWatchedTime + 1.0) {
          video.currentTime = maxWatchedTime;
        }
      });

      video.addEventListener('ended', () => {
        if (token !== activeAdToken) return;
        adLocked = false;
        syncVideoBtns();
        if (claimBtn) {
          claimBtn.disabled = false;
          claimBtn.textContent = 'Claim $1.00 Reward';
          claimBtn.dataset.ready = '1';
        }
        if (statusEl) statusEl.textContent = 'Video finished! Claim your $1.00 reward to return to Feed.';
      });
    }
  }
}

$('#adSkipBtn')?.addEventListener('click', () => {
  if ($('#adSkipBtn').disabled) return;
  showPage('feed');
});

$('#adBackBtn')?.addEventListener('click', () => {
  showPage('feed');
});

$('#adClaimBtn')?.addEventListener('click', async () => {
  const btn = $('#adClaimBtn');
  if (!btn || btn.disabled || btn.dataset.ready !== '1' || adClaimed || !currentUser || !sb) return;
  adClaimed = true;
  btn.disabled = true;
  btn.textContent = 'Claiming...';

  const newCash = Number(currentUser.cash || 0) + 1;
  const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
  if (error) {
    adClaimed = false;
    btn.disabled = false;
    btn.textContent = 'Claim $1.00 Reward';
    toast('Error claiming reward: ' + error.message);
    return;
  }

  currentUser.cash = newCash;
  updateUIProfile();
  await updateNetWorth();
  toast('Claimed $1.00 reward!');
  showPage('feed');
});

// ---------- Username (Account menu) ----------
$('#accountUsername')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#saveUsernameBtn')?.click();
  }
});

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
  if (!file) return;
  compressImg(file, async (dataUrl) => {
    const { error } = await sb.from('profiles').update({ avatar_url: dataUrl }).eq('id', currentUser.id);
    if (!error) {
      currentUser.avatar_url = dataUrl;
      updateUIProfile();
      toast('Profile picture updated!');
    } else {
      toast('Error saving picture: ' + error.message);
    }
  });
});

// ---------- Premium requests ----------
function updatePremiumSection() {
  if (!currentUser) return;
  const statusEl = $('#premiumStatus');
  const form = $('#requestForm');
  if (currentUser.is_premium) {
    statusEl.textContent = 'You have Premium! Max 3 coins, Blue Star icon, and 2X daily rewards.';
    form.classList.add('hidden');
  } else if (currentUser.is_pro) {
    statusEl.textContent = 'You have PRO! Max 2 coins, Gold Crown icon, and 2X daily rewards. Request Premium for 3 coins and Blue Star.';
    form.classList.remove('hidden');
  } else {
    statusEl.textContent = 'Member account: max 1 coin. Unlock PRO on Daily Login Day 7 or request Premium for up to 3.';
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
  const { error: rErr } = await sb.from('premium_requests').update({ status }).eq('id', reqId);
  if (rErr) {
    toast('Request update error: ' + rErr.message);
    return;
  }
  if (status === 'approved' && userId) {
    const { error: pErr } = await sb.from('profiles').update({ is_premium: true }).eq('id', userId);
    if (pErr) console.warn('Note: profiles update blocked by RLS until admin policy is added:', pErr);
  }
  toast(status === 'approved' ? 'Approved Premium!' : 'Denied request');
  loadRequests();
}

// ---------- Realtime ----------
function startRealtime() {
  if (!sb) return;
  realtimeChannel = sb.channel('grind-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => loadCoins())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      loadCoins();
      if (selectedCoin && currentPage === 'coin') renderCoinDetail();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'premium_requests' }, () => {
      if (currentUser) loadProfile();
      if (isDompinator()) loadRequests();
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
