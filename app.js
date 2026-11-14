// ============================================================
// GRIND v0.5 — Multiplayer · Premium · English
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
let tradeInFlight = false;
let featuredCoinIdsCache = [];
let passTickerInterval = null;
let lastPassRemoteSyncAt = 0;
let passState = { season: 1, seconds: 0, claimedTiers: new Set(), livePostUsed: false };
let grindBotHistory = [];
let grindBotSending = false;

const PASS_STEP_SECONDS = 300; // 5 minutes between every reward
const PASS_REWARDS = [
  { tier: 1, minutes: 5, type: 'cash', amount: 5, title: '$5', desc: 'Instant $5.00 cash bonus' },
  { tier: 2, minutes: 10, type: 'cash', amount: 7, title: '$7', desc: 'Instant $7.00 cash bonus' },
  { tier: 3, minutes: 15, type: 'cash', amount: 10, title: '$10', desc: 'Instant $10.00 cash bonus' },
  { tier: 4, minutes: 20, type: 'cash', amount: 12, title: '$12', desc: 'Instant $12.00 cash bonus' },
  { tier: 5, minutes: 25, type: 'cash', amount: 15, title: '$15', desc: 'Instant $15.00 cash bonus' },
  { tier: 6, minutes: 30, type: 'cash', amount: 20, title: '$20', desc: 'Instant $20.00 cash bonus' },
  { tier: 7, minutes: 35, type: 'cash', amount: 25, title: '$25', desc: 'Instant $25.00 cash bonus' },
  { tier: 8, minutes: 40, type: 'cash', amount: 30, title: '$30', desc: 'Instant $30.00 cash bonus' },
  { tier: 9, minutes: 45, type: 'cash', amount: 35, title: '$35', desc: 'Instant $35.00 cash bonus' },
  { tier: 10, minutes: 50, type: 'coin_live_post', title: 'Coin Live Post', desc: 'Pick any coin & post a custom shoutout for everyone in LIVE' },
  { tier: 11, minutes: 55, type: 'cash', amount: 40, title: '$40', desc: 'Instant $40.00 cash bonus' },
  { tier: 12, minutes: 60, type: 'cash', amount: 45, title: '$45', desc: 'Instant $45.00 cash bonus' },
  { tier: 13, minutes: 65, type: 'cash', amount: 50, title: '$50', desc: 'Instant $50.00 cash bonus' },
  { tier: 14, minutes: 70, type: 'cash', amount: 50, title: '$50', desc: 'Instant $50.00 cash bonus' },
  { tier: 15, minutes: 75, type: 'cash', amount: 50, title: '$50', desc: 'Instant $50.00 cash bonus' },
  { tier: 16, minutes: 80, type: 'cash', amount: 50, title: '$50', desc: 'Instant $50.00 cash bonus' },
  { tier: 17, minutes: 85, type: 'cash', amount: 50, title: '$50', desc: 'Instant $50.00 cash bonus' },
  { tier: 18, minutes: 90, type: 'cash', amount: 55, title: '$55', desc: 'Instant $55.00 cash bonus' },
  { tier: 19, minutes: 95, type: 'cash', amount: 60, title: '$60', desc: 'Instant $60.00 cash bonus' },
  { tier: 20, minutes: 100, type: 'pro', title: 'Free PRO upgrade', desc: 'Unlock Gold Crown PRO tier, 2 coins max, 2X daily & GRIND-BOT' }
];

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
function isEffectivePremium(p) {
  if (!p) return false;
  const id = String(p.id || p.user_id || '');
  const ov = id ? adminModStateCache.premiumOverrides?.get(id) : null;
  if (ov?.removed) return false;
  if (ov?.granted) return true;
  return Boolean(p.is_premium);
}
function getUserTier(p) {
  if (!p) return 'member';
  if (isEffectivePremium(p)) return 'premium';
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
  try {
    if (user?.id) localStorage.setItem('grind_tos_pending_' + user.id, '1');
  } catch (e) {}
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
    try {
      localStorage.setItem('grind_tos_pending_' + data.user.id, '1');
    } catch (e) {}

    // Log in (needed before we may create the profile row)
    const { error: loginErr } = await sb.auth.signInWithPassword({ email, password });
    if (loginErr) {
      authMsg('Account created! Check your email to confirm, then log in.');
      setAuthMode('login');
      return;
    }
    await loadProfile();   // creates the profile with an auto username if missing
    if (!currentUser?.is_banned) {
      enterApp();
      toast('Welcome to GRIND! Set your username under Account.');
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return authMsg('Wrong email or password.');
    await loadProfile();
    if (!currentUser?.is_banned) enterApp();
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
  await fetchAdminModerationState();
  if (adminModStateCache.deletedUserIds?.has(user.id)) {
    try { await sb.auth.signOut(); } catch (e) {}
    currentUser = null;
    $('#appView')?.classList.add('hidden');
    $('#bannedView')?.classList.add('hidden');
    $('#authView')?.classList.remove('hidden');
    authMsg('This account has been permanently deleted.');
    return;
  }
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
  currentUser.auth_created_at = user.created_at || data.created_at || null;

  // Auto-sync approved premium & PRO status
  await loadProUserIds();
  currentUser.is_pro = Boolean(
    currentUser.is_pro ||
    proUserIds.has(user.id) ||
    localStorage.getItem('grind_pro_' + user.id) === '1'
  );
  if (currentUser.is_pro) proUserIds.add(user.id);

  const premOv = adminModStateCache.premiumOverrides?.get(user.id);
  if (premOv?.removed) {
    currentUser.is_premium = false;
    try { await sb.from('profiles').update({ is_premium: false }).eq('id', user.id); } catch (e) {}
  } else if (premOv?.granted) {
    currentUser.is_premium = true;
    try { await sb.from('profiles').update({ is_premium: true }).eq('id', user.id); } catch (e) {}
  } else if (!currentUser.is_premium) {
    try {
      let reqQuery = sb.from('premium_requests')
        .select('id, reason, created_at')
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .neq('reason', '__PRO_TIER__')
        .limit(1);
      if (adminModStateCache.serverResetTs > 0) {
        reqQuery = reqQuery.gt('created_at', new Date(adminModStateCache.serverResetTs).toISOString());
      }
      const { data: approvedReq } = await reqQuery.maybeSingle();

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
  await applyAdminActionsForCurrentUser();
  if (!currentUser?.is_banned) {
    updateUIProfile();
  }
}

let adminModStateCache = { bans: new Map(), resets: new Map(), warnings: new Map(), serverResetTs: 0, resetDoneMap: new Map(), deletedCoinIds: new Set(), deletedUserIds: new Set(), premiumOverrides: new Map() };
let pendingWarnAckTs = 0;

async function fetchAdminModerationState() {
  const bans = new Map();
  const resets = new Map();
  const warnings = new Map();
  const resetDoneMap = new Map();
  const deletedCoinIds = new Set();
  const deletedUserIds = new Set();
  const premiumOverrides = new Map();
  let serverResetTs = 0;
  if (!sb) return { bans, resets, warnings, serverResetTs, resetDoneMap, deletedCoinIds, deletedUserIds, premiumOverrides };
  try {
    const [{ data }, { data: srvRows }, { data: doneRows }, { data: delCoinRows }, { data: selfDelRows }] = await Promise.all([
      sb.from('premium_requests')
        .select('reason, created_at, profiles(username)')
        .like('reason', '__ADMIN_CMD__:%')
        .order('created_at', { ascending: true })
        .limit(1000),
      sb.from('premium_requests')
        .select('reason, created_at, profiles(username)')
        .like('reason', '__SERVER_RESET__:%')
        .order('created_at', { ascending: false })
        .limit(20),
      sb.from('premium_requests')
        .select('user_id, reason')
        .like('reason', '__RESET_DONE__:%')
        .limit(1000),
      sb.from('premium_requests')
        .select('reason, profiles(username)')
        .like('reason', '__COIN_DEL__:%')
        .limit(500),
      sb.from('premium_requests')
        .select('user_id')
        .eq('reason', '__ACCOUNT_DELETED__')
        .limit(500)
    ]);
    (selfDelRows || []).forEach(row => {
      if (row.user_id) deletedUserIds.add(String(row.user_id));
    });
    (delCoinRows || []).forEach(row => {
      if ((row.profiles?.username || '').toLowerCase() !== 'dompinator') return;
      const cid = String(row.reason || '').slice('__COIN_DEL__:'.length).trim();
      if (cid) deletedCoinIds.add(cid);
    });
    (srvRows || []).forEach(row => {
      if ((row.profiles?.username || '').toLowerCase() !== 'dompinator') return;
      try {
        const parsed = JSON.parse(String(row.reason).slice('__SERVER_RESET__:'.length));
        const ts = Number(parsed?.ts) || (row.created_at ? new Date(row.created_at).getTime() : 0);
        if (ts > serverResetTs) serverResetTs = ts;
      } catch (e) {}
    });
    (doneRows || []).forEach(row => {
      if (!row.user_id) return;
      const ts = Number(String(row.reason || '').slice('__RESET_DONE__:'.length)) || 0;
      if (ts > (resetDoneMap.get(row.user_id) || 0)) {
        resetDoneMap.set(row.user_id, ts);
      }
    });
    (data || []).forEach(row => {
      if ((row.profiles?.username || '').toLowerCase() !== 'dompinator') return;
      try {
        const cmd = JSON.parse(String(row.reason).slice('__ADMIN_CMD__:'.length));
        if (!cmd || !cmd.target || !cmd.action) return;
        const tid = String(cmd.target);
        const ts = Number(cmd.ts) || (row.created_at ? new Date(row.created_at).getTime() : 0);
        if (cmd.action === 'ban') {
          bans.set(tid, { banned: true, reason: cmd.msg || 'Banned by an administrator.', ts });
        } else if (cmd.action === 'unban') {
          bans.set(tid, { banned: false, reason: '', ts });
        } else if (cmd.action === 'delete') {
          deletedUserIds.add(tid);
        } else if (cmd.action === 'reset') {
          const prev = resets.get(tid) || 0;
          if (ts > prev) resets.set(tid, ts);
          const curOv = premiumOverrides.get(tid);
          if (curOv && ts > curOv.ts) premiumOverrides.delete(tid);
        } else if (cmd.action === 'warn') {
          const arr = warnings.get(tid) || [];
          arr.push({ ts, msg: cmd.msg || 'Please follow the rules.' });
          warnings.set(tid, arr);
        } else if (cmd.action === 'remove_premium') {
          if (!serverResetTs || ts > serverResetTs) {
            premiumOverrides.set(tid, { removed: true, granted: false, ts });
          }
        } else if (cmd.action === 'grant_premium') {
          if (!serverResetTs || ts > serverResetTs) {
            premiumOverrides.set(tid, { removed: false, granted: true, ts });
          }
        }
      } catch (e) {}
    });
  } catch (e) {}
  adminModStateCache = { bans, resets, warnings, serverResetTs, resetDoneMap, deletedCoinIds, deletedUserIds, premiumOverrides };
  return adminModStateCache;
}

function showBannedScreen(reason) {
  if (timeInterval) clearInterval(timeInterval);
  $('#authView')?.classList.add('hidden');
  $('#appView')?.classList.add('hidden');
  $('#dailyModal')?.classList.add('hidden');
  $('#profileModal')?.classList.add('hidden');
  $('#warnModal')?.classList.add('hidden');
  const txt = $('#bannedReasonText');
  if (txt) txt.textContent = reason || 'Your account has been banned by an administrator.';
  $('#bannedView')?.classList.remove('hidden');
}

function clearLocalUserState(uid) {
  if (!uid) return;
  [
    'grind_pro_', 'grind_daily_', 'grind_watchlist_', 'grind_watchlist_ts_',
    'grind_reset_done_', 'grind_warn_ack_', 'grind_upd_ack_',
    'grind_tos_pending_', 'grind_tos_ack_'
  ].forEach(prefix => {
    try { localStorage.removeItem(prefix + uid); } catch (e) {}
  });
}

async function applyAdminActionsForCurrentUser() {
  if (!currentUser || !sb) return;
  const { bans, resets, warnings, serverResetTs, deletedUserIds } = await fetchAdminModerationState();
  const uid = currentUser.id;

  // 0. Check Permanent Account Deletion
  if (deletedUserIds?.has(uid)) {
    try { await sb.from('holdings').delete().eq('user_id', uid); } catch (e) {}
    try { await sb.from('trades').delete().eq('user_id', uid); } catch (e) {}
    try { await sb.from('coins').delete().eq('creator_id', uid); } catch (e) {}
    try { await sb.from('profiles').delete().eq('id', uid); } catch (e) {}
    clearLocalUserState(uid);
    if (timeInterval) clearInterval(timeInterval);
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    try { await sb.auth.signOut(); } catch (e) {}
    currentUser = null;
    $('#appView')?.classList.add('hidden');
    $('#bannedView')?.classList.add('hidden');
    $('#dailyModal')?.classList.add('hidden');
    $('#profileModal')?.classList.add('hidden');
    $('#warnModal')?.classList.add('hidden');
    $('#updateModal')?.classList.add('hidden');
    $('#tosModal')?.classList.add('hidden');
    $('#authView')?.classList.remove('hidden');
    setAuthMode('login');
    authMsg('This account has been permanently deleted.');
    return;
  }

  // 1. Check Ban
  const banInfo = bans.get(uid);
  if (banInfo?.banned) {
    currentUser.is_banned = true;
    currentUser.ban_reason = banInfo.reason;
    showBannedScreen(banInfo.reason);
    return;
  }
  currentUser.is_banned = false;
  $('#bannedView')?.classList.add('hidden');

  // 2. Check Account Reset or Global Server Reset
  const userResetTs = resets.get(uid) || 0;
  const userCreatedMs = currentUser.auth_created_at ? new Date(currentUser.auth_created_at).getTime() : 0;
  const appliesServerReset = serverResetTs > 0 && (!userCreatedMs || userCreatedMs <= serverResetTs);
  const latestResetTs = Math.max(userResetTs, appliesServerReset ? serverResetTs : 0);

  if (serverResetTs > 0 && userCreatedMs > serverResetTs) {
    const acked = Number(localStorage.getItem('grind_reset_done_' + uid) || 0);
    if (acked < serverResetTs) {
      localStorage.setItem('grind_reset_done_' + uid, String(serverResetTs));
      try {
        await sb.from('premium_requests').insert({
          user_id: uid,
          reason: '__RESET_DONE__:' + serverResetTs,
          status: 'denied'
        });
      } catch (e) {}
    }
  }

  if (latestResetTs > 0) {
    let appliedResetTs = Number(localStorage.getItem('grind_reset_done_' + uid) || 0);
    try {
      const { data: ackRows } = await sb
        .from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', '__RESET_DONE__:%')
        .order('created_at', { ascending: false })
        .limit(1);
      if (ackRows?.[0]?.reason) {
        appliedResetTs = Math.max(appliedResetTs, Number(ackRows[0].reason.slice('__RESET_DONE__:'.length)) || 0);
      }
    } catch (e) {}

    if (latestResetTs > appliedResetTs) {
      const keepAdminPremium = isDompinator();
      try {
        await sb.from('holdings').delete().eq('user_id', uid);
      } catch (e) {}
      try {
        await sb.from('profiles').update({
          cash: 15,
          net_worth: 15,
          is_premium: keepAdminPremium,
          time_played: 0
        }).eq('id', uid);
      } catch (e) {}

      currentUser.cash = 15;
      currentUser.net_worth = 15;
      currentUser.is_premium = keepAdminPremium;
      currentUser.is_pro = false;
      currentUser.time_played = 0;
      proUserIds.delete(uid);
      watchlistIds = new Set();

      localStorage.removeItem('grind_pro_' + uid);
      localStorage.removeItem('grind_daily_' + uid);
      localStorage.removeItem('grind_watchlist_' + uid);
      localStorage.removeItem('grind_watchlist_ts_' + uid);
      localStorage.setItem('grind_reset_done_' + uid, String(latestResetTs));

      try {
        await sb.from('premium_requests').insert({
          user_id: uid,
          reason: '__RESET_DONE__:' + latestResetTs,
          status: 'denied'
        });
      } catch (e) {}

      updateUIProfile();
      if (currentPage === 'money') renderMoney();
      if (currentPage === 'coin') renderCoinDetail();
      if (currentPage === 'feed') renderFeed();
      toast(appliesServerReset && latestResetTs === serverResetTs
        ? 'Servers were reset by an administrator. All coins cleared & accounts reset to $15.'
        : 'Your account was reset by an administrator.');
    }
  }

  // 3. Check Warnings
  const userWarns = warnings.get(uid) || [];
  if (userWarns.length > 0) {
    let ackTs = Number(localStorage.getItem('grind_warn_ack_' + uid) || 0);
    try {
      const { data: ackRows } = await sb
        .from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', '__WARN_ACK__:%')
        .order('created_at', { ascending: false })
        .limit(1);
      if (ackRows?.[0]?.reason) {
        ackTs = Math.max(ackTs, Number(ackRows[0].reason.slice('__WARN_ACK__:'.length)) || 0);
      }
    } catch (e) {}

    const unread = userWarns.filter(w => w.ts > ackTs);
    if (unread.length > 0) {
      pendingWarnAckTs = unread[unread.length - 1].ts;
      const box = $('#warnModalBody');
      if (box) {
        box.innerHTML = unread.map(w => `<div style="margin-bottom:6px;">• ${escapeHtml(w.msg)}</div>`).join('');
      }
      $('#warnModal')?.classList.remove('hidden');
    }
  }

  // 4. Check Active Update Notifications
  await checkPendingUpdateNotifications();
}

let activeUpdateQueue = [];
let currentUpdateModalItem = null;
let isPreviewUpdateModal = false;
let cachedTosText = null;

const FALLBACK_TOS_TEXT = `GRIND — TERMS OF SERVICE
Last Updated: November 13, 2026

Welcome to GRIND ("Grind your way through the market"). By creating an account or accessing GRIND, you agree to be bound by these Terms of Service. If you do not agree to these rules, you may not use the service.

1. ONE ACCOUNT PER PERSON
- You may only create and operate ONE (1) account per person.
- Creating alternative accounts ("alts"), multi-accounting, transferring value between accounts owned by the same person, or creating a new account to bypass a warning, reset, or ban (ban evasion) is strictly prohibited.
- Account sharing, selling, or trading accounts is not allowed.

2. NO EXPLOITING & FAIR PLAY
- You must play fairly and use GRIND only as intended.
- You may NOT exploit bugs, glitches, calculation errors, race conditions, or unintended mechanics to gain unfair cash, coins, tier upgrades, or leaderboard advantage.
- Automation, bots, auto-clickers, modified clients, network tampering, or bypassing timers (such as ad cooldowns or daily reward limits) is strictly forbidden.

3. MANDATORY EXPLOIT & BUG REPORTING
- If you discover a bug, glitch, security issue, or exploit, you MUST immediately stop triggering or benefiting from it.
- You are required to report any discovered exploit or vulnerability to an administrator (Dompinator) as soon as possible, along with clear details on how to reproduce it.
- Continuing to use an exploit or sharing an exploit publicly/with other players instead of reporting it will result in immediate enforcement action.

4. VIRTUAL CURRENCY DISCLAIMER
- All currencies, balances, coins, net worth values, tiers, and rewards in GRIND are 100% virtual and exist solely for entertainment within the platform.
- Virtual cash and coins have no real-world monetary value and cannot be exchanged, redeemed, or traded for real money, goods, or services.

5. USER CONTENT & CONDUCT
- Usernames, profile pictures, coin names, tickers, descriptions, and uploaded logos must not contain hate speech, harassment, illegal material, explicit/NSFW imagery, spam, or impersonation of administrators or other users.
- Do not attempt to harass, scam, or disrupt other players.

6. MODERATION & ENFORCEMENT
- Administrators (including Dompinator) reserve the right to monitor activity and take moderation action at their sole discretion to protect the market and community.
- Violations of these Terms may result in:
  * Official account warnings
  * Removal of unfairly gained cash, coins, or coins created by the user
  * Full account reset
  * Temporary or permanent account ban

7. SERVICE CHANGES & AVAILABILITY
- GRIND is provided "as is" without warranties of any kind. Features, pricing formulas, rewards, and data may be updated, balanced, reset, or discontinued at any time.
- We may update these Terms of Service at any time. Continued use of GRIND after changes or an in-app update notice constitutes acceptance of the updated Terms.`;

function formatUpdateTextWithTos(text, preserveNewlines = false) {
  let html = escapeHtml(text || '');
  if (preserveNewlines) html = html.replace(/\n/g, '<br>');
  return html.replace(/\b(TOS)\b/gi, '<a href="#tos" class="tos-inline-link" data-open-tos="1">$1</a>');
}

async function loadTosText() {
  if (cachedTosText) return cachedTosText;
  try {
    const res = await fetch('TERMS_OF_SERVICE.txt', { cache: 'no-store' });
    if (res.ok) {
      const txt = (await res.text()).trim();
      if (txt) cachedTosText = txt;
    }
  } catch (e) {}
  if (!cachedTosText) cachedTosText = FALLBACK_TOS_TEXT;
  return cachedTosText;
}

async function openTosModal() {
  const modal = $('#tosModal');
  const body = $('#tosModalBody');
  if (!modal || !body) return;
  modal.classList.remove('hidden');
  if (cachedTosText) {
    body.textContent = cachedTosText;
    return;
  }
  body.textContent = 'Loading Terms of Service...';
  body.textContent = await loadTosText();
}

function closeTosModal() {
  $('#tosModal')?.classList.add('hidden');
}

$('#closeTosBtn')?.addEventListener('click', closeTosModal);
$('#tosModal')?.addEventListener('click', e => {
  if (e.target === $('#tosModal')) closeTosModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#tosModal')?.classList.contains('hidden')) {
    closeTosModal();
  }
});
document.addEventListener('click', e => {
  const tosBtn = e.target.closest?.('[data-open-tos="1"]');
  if (!tosBtn) return;
  e.preventDefault();
  e.stopPropagation();
  openTosModal();
}, true);

async function fetchActiveUpdates() {
  if (!sb) return [];
  const deletedIds = new Set();
  const posts = [];
  try {
    const [{ data: postRows }, { data: delRows }] = await Promise.all([
      sb.from('premium_requests')
        .select('reason, created_at, profiles(username)')
        .like('reason', '__UPDATE_POST__:%')
        .order('created_at', { ascending: true })
        .limit(200),
      sb.from('premium_requests')
        .select('reason, profiles(username)')
        .like('reason', '__UPDATE_DEL__:%')
        .limit(200)
    ]);
    (delRows || []).forEach(r => {
      if ((r.profiles?.username || '').toLowerCase() !== 'dompinator') return;
      deletedIds.add(String(r.reason).slice('__UPDATE_DEL__:'.length));
    });
    (postRows || []).forEach(r => {
      if ((r.profiles?.username || '').toLowerCase() !== 'dompinator') return;
      try {
        const upd = JSON.parse(String(r.reason).slice('__UPDATE_POST__:'.length));
        if (upd && upd.id && !deletedIds.has(upd.id)) {
          posts.push(upd);
        }
      } catch (e) {}
    });
  } catch (e) {}
  return posts;
}

const TOS_SIGNUP_ENFORCE_SINCE_MS = Date.UTC(2026, 10, 13, 13, 4, 0);

async function checkPendingUpdateNotifications() {
  if (!currentUser || currentUser.is_banned || !sb) return;
  const uid = currentUser.id;
  const posts = await fetchActiveUpdates();

  let ackIds = [];
  try {
    ackIds = JSON.parse(localStorage.getItem('grind_upd_ack_' + uid) || '[]');
    if (!Array.isArray(ackIds)) ackIds = [];
  } catch (e) { ackIds = []; }
  const ackSet = new Set(ackIds.map(String));

  try {
    const { data: ackRows } = await sb
      .from('premium_requests')
      .select('reason')
      .eq('user_id', uid)
      .like('reason', '__UPD_ACK__:%')
      .limit(200);
    (ackRows || []).forEach(r => {
      const id = String(r.reason || '').slice('__UPD_ACK__:'.length);
      if (id) ackSet.add(id);
    });
  } catch (e) {}

  const queue = [];
  const createdMs = currentUser.auth_created_at ? new Date(currentUser.auth_created_at).getTime() : 0;
  const isPendingNewSignup = localStorage.getItem('grind_tos_pending_' + uid) === '1'
    || (createdMs >= TOS_SIGNUP_ENFORCE_SINCE_MS);
  const hasAcceptedTos = ackSet.has('tos_signup_v1') || localStorage.getItem('grind_tos_ack_' + uid) === '1';

  if (isPendingNewSignup && !hasAcceptedTos) {
    const tosText = await loadTosText();
    queue.push({
      id: 'tos_signup_v1',
      isTosSignup: true,
      eyebrow: 'TERMS OF SERVICE',
      title: 'Terms of Service',
      body: tosText,
      boxes: [
        { text: 'I have read and accept the terms of service', required: true }
      ]
    });
  }

  posts.filter(u => !ackSet.has(String(u.id))).forEach(u => queue.push(u));
  activeUpdateQueue = queue;

  if (activeUpdateQueue.length > 0) {
    showNextUpdateModal();
  } else {
    $('#updateModal')?.classList.add('hidden');
  }
}

function renderUpdateModalContent(upd, isPreview = false) {
  const eyebrowEl = $('#updateModalEyebrow');
  const closeBtn = $('#closeUpdatePreviewBtn');
  const titleEl = $('#updateModalTitle');
  const bodyEl = $('#updateModalBody');
  const boxesEl = $('#updateModalBoxes');
  const hintEl = $('#updateModalHint');
  const btn = $('#updateContinueBtn');

  if (eyebrowEl) {
    eyebrowEl.textContent = isPreview
      ? 'PREVIEW · UPDATE NOTIFICATION'
      : (upd.eyebrow || 'UPDATE NOTIFICATION');
    eyebrowEl.style.color = upd.isTosSignup ? '#38bdf8' : '#fbbf24';
  }
  if (closeBtn) closeBtn.classList.toggle('hidden', !isPreview);
  if (titleEl) {
    titleEl.innerHTML = upd.isTosSignup
      ? escapeHtml(upd.title || 'Terms of Service')
      : formatUpdateTextWithTos(upd.title || 'Important Update', false);
  }
  if (bodyEl) {
    bodyEl.classList.toggle('tos-signup-body', Boolean(upd.isTosSignup));
    if (upd.isTosSignup) {
      bodyEl.textContent = upd.body || FALLBACK_TOS_TEXT;
    } else {
      const safeBody = formatUpdateTextWithTos(upd.body || '', true);
      bodyEl.innerHTML = safeBody || '<span class="muted">Please review the items below.</span>';
    }
  }

  const boxes = Array.isArray(upd.boxes) ? upd.boxes : [];
  if (boxesEl) {
    boxesEl.innerHTML = boxes.map((b, i) => `
      <label class="update-check-item">
        <input type="checkbox" class="update-box-input" data-idx="${i}" data-req="${b.required ? '1' : '0'}">
        <span class="update-check-text">${upd.isTosSignup ? escapeHtml(b.text || '') : formatUpdateTextWithTos(b.text || '', false)}</span>
        <span class="check-tag ${b.required ? 'req' : 'opt'}">${b.required ? 'Required' : 'Optional'}</span>
      </label>
    `).join('');
  }

  const hasReq = boxes.some(b => b.required);
  const syncBtn = () => {
    const reqInputs = $$('#updateModalBoxes .update-box-input[data-req="1"]');
    const allReqChecked = reqInputs.every(inp => inp.checked);
    if (btn) btn.disabled = !allReqChecked;
    if (hintEl) {
      hintEl.textContent = hasReq && !allReqChecked
        ? 'Check all required boxes above to continue using GRIND.'
        : '';
    }
  };
  $$('#updateModalBoxes .update-box-input').forEach(inp => inp.addEventListener('change', syncBtn));
  syncBtn();

  $('#updateModal')?.classList.remove('hidden');
}

function showNextUpdateModal() {
  if (!activeUpdateQueue.length) {
    currentUpdateModalItem = null;
    isPreviewUpdateModal = false;
    $('#updateModal')?.classList.add('hidden');
    return;
  }
  isPreviewUpdateModal = false;
  const upd = activeUpdateQueue[0];
  currentUpdateModalItem = upd;
  renderUpdateModalContent(upd, false);
}

$('#closeUpdatePreviewBtn')?.addEventListener('click', () => {
  if (!isPreviewUpdateModal) return;
  isPreviewUpdateModal = false;
  $('#updateModal')?.classList.add('hidden');
  if (activeUpdateQueue.length > 0) showNextUpdateModal();
});

$('#updateContinueBtn')?.addEventListener('click', async () => {
  const btn = $('#updateContinueBtn');
  if (!btn || btn.disabled) return;
  if (isPreviewUpdateModal) {
    isPreviewUpdateModal = false;
    $('#updateModal')?.classList.add('hidden');
    toast('Preview passed!');
    if (activeUpdateQueue.length > 0) showNextUpdateModal();
    return;
  }
  if (!currentUpdateModalItem || !currentUser) return;
  const updId = String(currentUpdateModalItem.id);
  const isTosSignup = Boolean(currentUpdateModalItem.isTosSignup);
  const uid = currentUser.id;

  if (isTosSignup) {
    try {
      localStorage.removeItem('grind_tos_pending_' + uid);
      localStorage.setItem('grind_tos_ack_' + uid, '1');
    } catch (e) {}
  }

  let ackIds = [];
  try {
    ackIds = JSON.parse(localStorage.getItem('grind_upd_ack_' + uid) || '[]');
    if (!Array.isArray(ackIds)) ackIds = [];
  } catch (e) { ackIds = []; }
  if (!ackIds.includes(updId)) ackIds.push(updId);
  localStorage.setItem('grind_upd_ack_' + uid, JSON.stringify(ackIds));

  activeUpdateQueue.shift();
  showNextUpdateModal();

  if (sb) {
    try {
      await sb.from('premium_requests').insert({
        user_id: uid,
        reason: '__UPD_ACK__:' + updId,
        status: 'denied'
      });
    } catch (e) {}
  }
});

$('#ackWarnBtn')?.addEventListener('click', async () => {
  $('#warnModal')?.classList.add('hidden');
  if (!currentUser || !pendingWarnAckTs) return;
  const ts = pendingWarnAckTs;
  pendingWarnAckTs = 0;
  localStorage.setItem('grind_warn_ack_' + currentUser.id, String(ts));
  if (sb) {
    try {
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__WARN_ACK__:' + ts,
        status: 'denied'
      });
    } catch (e) {}
  }
});

$('#bannedLogoutBtn')?.addEventListener('click', () => {
  $('#bannedView')?.classList.add('hidden');
  $('#logoutBtn')?.click();
});

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
  $('#navNotifications')?.classList.remove('hidden');
  $('#navAdmin')?.classList.toggle('hidden', !isDompinator());
  $('#deleteOwnAccountSection')?.classList.toggle('hidden', isDompinator());
  const gbTag = $('#navGrindBotTag');
  if (gbTag) {
    const hasPro = getUserTier(currentUser) === 'pro' || getUserTier(currentUser) === 'premium';
    gbTag.textContent = hasPro ? 'READY' : 'PRO+';
    gbTag.classList.toggle('unlocked', hasPro);
  }
  updatePremiumSection();
  updateNotificationsBadge();
  updatePassNavBadge();
  if (currentPage === 'grindbot') renderGrindBotPage();
}

function enterApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  loadPassState().then(() => {
    if (currentPage === 'pass') renderPassPage();
  });
  showPage('feed');
  startRealtime();
  loadCoins();
  startTimeTracking();
  checkDailyLogin();
}

function startTimeTracking() {
  sessionStart = Date.now();
  lastPassRemoteSyncAt = Date.now();
  if (timeInterval) clearInterval(timeInterval);
  if (passTickerInterval) clearInterval(passTickerInterval);
  timeInterval = setInterval(async () => {
    if (!currentUser || !sb) return;
    const add = 30; // seconds
    const newTime = (currentUser.time_played || 0) + add;
    currentUser.time_played = newTime;
    await sb.from('profiles').update({ time_played: newTime }).eq('id', currentUser.id);
    incrementPassTime(add);
  }, 30000);
  passTickerInterval = setInterval(() => {
    if (!currentUser || currentUser.is_banned) return;
    if (currentPage === 'pass') updatePassLiveClock();
  }, 1000);
  window.addEventListener('beforeunload', saveTimeOnExit);
}

async function saveTimeOnExit() {
  if (!currentUser || !sessionStart || !sb) return;
  const now = Date.now();
  const extra = Math.floor((now - sessionStart) / 1000);
  if (extra > 5) {
    await sb.from('profiles').update({ time_played: (currentUser.time_played || 0) + extra }).eq('id', currentUser.id);
    await incrementPassTime(extra, true);
    sessionStart = now;
  } else {
    await syncPassTimeToRemote(true);
  }
}

$('#logoutBtn')?.addEventListener('click', async () => {
  await saveTimeOnExit();
  if (timeInterval) clearInterval(timeInterval);
  if (passTickerInterval) clearInterval(passTickerInterval);
  if (sb) await sb.auth.signOut();
  currentUser = null;
  grindBotHistory = [];
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  $('#appView').classList.add('hidden');
  $('#tosModal')?.classList.add('hidden');
  $('#updateModal')?.classList.add('hidden');
  $('#warnModal')?.classList.add('hidden');
  $('#dailyModal')?.classList.add('hidden');
  $('#profileModal')?.classList.add('hidden');
  $('#featuredEditModal')?.classList.add('hidden');
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
    live: 'Live market',
    create: 'Create currency',
    money: 'Your money',
    global: 'Global leaderboards',
    ads: 'Ads',
    grindbot: 'GRIND-BOT',
    pass: `Season ${passState.season || 1} Pass`,
    account: 'Account settings',
    report: 'Report player or bug',
    notifications: 'Notifications',
    admin: 'Admin',
    coin: 'Currency'
  };
  $('#pageTitle').textContent = titles[page] || 'GRIND';
  if (page === 'feed') renderFeed();
  if (page === 'live') loadLiveFeed();
  if (page === 'money') renderMoney();
  if (page === 'global') renderLeaderboard();
  if (page === 'ads' && !(wasAds && adLocked)) startAdsPage();
  if (page === 'grindbot') renderGrindBotPage();
  if (page === 'pass') loadPassState().then(() => renderPassPage());
  if (page === 'account') updatePremiumSection();
  if (page === 'report') loadReportPage();
  if (page === 'notifications') loadRequests();
  if (page === 'admin' && isDompinator()) loadAdminPage();
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
  if (b.dataset.live) {
    b.addEventListener('click', () => {
      liveMode = b.dataset.live;
      $$('.feed-tab[data-live]').forEach(x => x.classList.toggle('active', x === b));
      renderLiveFeed();
    });
  }
  if (b.dataset.reportType) {
    b.addEventListener('click', () => {
      setReportType(b.dataset.reportType);
    });
  }
  if (b.dataset.repfilter) {
    b.addEventListener('click', () => {
      notifReportFilter = b.dataset.repfilter;
      $$('.feed-tab[data-repfilter]').forEach(x => x.classList.toggle('active', x === b));
      renderReportsList();
    });
  }
  if (b.dataset.unotif) {
    b.addEventListener('click', () => {
      userNotifFilter = b.dataset.unotif;
      $$('.feed-tab[data-unotif]').forEach(x => x.classList.toggle('active', x === b));
      renderUserNotifsList();
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
    let q = sb
      .from('premium_requests')
      .select('user_id, created_at')
      .eq('status', 'approved')
      .eq('reason', '__PRO_TIER__');
    if (adminModStateCache.serverResetTs > 0) {
      q = q.gt('created_at', new Date(adminModStateCache.serverResetTs).toISOString());
    }
    const { data } = await q;
    proUserIds = new Set((data || []).map(r => r.user_id).filter(Boolean));
    if (currentUser && localStorage.getItem('grind_pro_' + currentUser.id) === '1') {
      proUserIds.add(currentUser.id);
    }
  } catch (e) {}
}

// ---------- Coins & Feed ----------
async function fetchFeaturedCoins() {
  if (!sb) return [];
  try {
    const srvResetTs = adminModStateCache.serverResetTs || 0;
    let q = sb.from('premium_requests')
      .select('reason, created_at, profiles(username)')
      .like('reason', '__FEATURED_COINS__:%')
      .order('created_at', { ascending: false })
      .limit(20);
    if (srvResetTs > 0) {
      q = q.gt('created_at', new Date(srvResetTs).toISOString());
    }
    const { data } = await q;
    const latest = (data || []).find(r => (r.profiles?.username || '').toLowerCase() === 'dompinator');
    if (latest?.reason) {
      const parsed = JSON.parse(String(latest.reason).slice('__FEATURED_COINS__:'.length));
      if (Array.isArray(parsed?.coinIds)) {
        featuredCoinIdsCache = parsed.coinIds.map(x => (x ? String(x) : '')).slice(0, 3);
        return featuredCoinIdsCache;
      }
    }
    featuredCoinIdsCache = [];
  } catch (e) {}
  return featuredCoinIdsCache;
}

function renderFeaturedSection() {
  const sec = $('#featuredSection');
  const grid = $('#featuredGrid');
  const editBtn = $('#editFeaturedBtn');
  if (!sec || !grid) return;

  const isAdmin = isDompinator();
  if (editBtn) editBtn.classList.toggle('hidden', !isAdmin);

  const coinMap = new Map(coins.map(c => [String(c.id), c]));
  const slots = [0, 1, 2].map(idx => {
    const cid = featuredCoinIdsCache[idx] ? String(featuredCoinIdsCache[idx]) : '';
    return cid ? (coinMap.get(cid) || null) : null;
  });
  const activeFeatured = slots.filter(Boolean);

  if (!isAdmin && activeFeatured.length === 0) {
    sec.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  sec.classList.remove('hidden');
  grid.innerHTML = slots.map((c, idx) => {
    if (!c) {
      return isAdmin
        ? `<div class="featured-empty-slot">Slot ${idx + 1} empty — Click Edit Featured</div>`
        : '';
    }
    const creator = c.profiles;
    const creatorName = creator?.username || 'Community';
    const creatorObj = creator ? { ...creator, id: c.creator_id } : { id: c.creator_id };
    const chg = formatChangePct(c.change_pct);
    return `
      <article class="featured-card" data-feat-coin="${escapeHtml(c.id)}">
        <div class="featured-slot-badge">★ Featured #${idx + 1}</div>
        <div class="coin-top" style="margin-bottom:8px;">
          <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml((c.ticker || '?')[0])}</div>
          <div style="flex:1;min-width:0;">
            <div class="coin-name">${escapeHtml(c.name)}</div>
            <div class="coin-ticker">$${escapeHtml(c.ticker)}</div>
          </div>
        </div>
        <div class="coin-price" style="font-size:21px;">${priceFmt(c.price)}</div>
        <div class="coin-change ${chg.cls}">${chg.text}</div>
        ${c.creator_id ? `
          <button type="button" class="creator-chip" data-feat-profile="${escapeHtml(c.creator_id)}">
            <span class="creator-mini-av">${creator?.avatar_url ? `<img src="${escapeHtml(creator.avatar_url)}">` : escapeHtml(creatorName[0].toUpperCase())}</span>
            <span>${escapeHtml(creatorName)}${tierBadgeHtml(creatorObj)}</span>
          </button>
        ` : ''}
      </article>
    `;
  }).join('');

  $$('#featuredGrid [data-feat-coin]').forEach(el => {
    el.addEventListener('click', () => openCoin(el.dataset.featCoin));
  });
  $$('#featuredGrid [data-feat-profile]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openProfileModal(btn.dataset.featProfile);
    });
  });
}

function openFeaturedEditModal() {
  if (!isDompinator()) return;
  const msgEl = $('#featuredEditMessage');
  if (msgEl) msgEl.textContent = '';

  const opts = ['<option value="">— None (Empty slot) —</option>']
    .concat(coins.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} ($${escapeHtml(c.ticker)}) — ${priceFmt(c.price)}</option>`))
    .join('');

  [1, 2, 3].forEach((n, idx) => {
    const sel = $(`#featuredSlot${n}`);
    if (!sel) return;
    sel.innerHTML = opts;
    const curVal = featuredCoinIdsCache[idx] ? String(featuredCoinIdsCache[idx]) : '';
    if (curVal && coins.some(c => String(c.id) === curVal)) {
      sel.value = curVal;
    } else {
      sel.value = '';
    }
  });
  $('#featuredEditModal')?.classList.remove('hidden');
}

function closeFeaturedEditModal() {
  $('#featuredEditModal')?.classList.add('hidden');
}

$('#editFeaturedBtn')?.addEventListener('click', openFeaturedEditModal);
$('#closeFeaturedEditBtn')?.addEventListener('click', closeFeaturedEditModal);
$('#cancelFeaturedEditBtn')?.addEventListener('click', closeFeaturedEditModal);
$('#featuredEditModal')?.addEventListener('click', e => {
  if (e.target === $('#featuredEditModal')) closeFeaturedEditModal();
});

$('#saveFeaturedBtn')?.addEventListener('click', async () => {
  if (!isDompinator() || !sb || !currentUser) return;
  const btn = $('#saveFeaturedBtn');
  const msgEl = $('#featuredEditMessage');
  if (msgEl) msgEl.textContent = '';
  const coinIds = [
    $('#featuredSlot1')?.value || '',
    $('#featuredSlot2')?.value || '',
    $('#featuredSlot3')?.value || ''
  ];
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__FEATURED_COINS__:' + JSON.stringify({ coinIds, ts: Date.now() }),
    status: 'denied'
  });
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Save Featured';
  }
  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }
  featuredCoinIdsCache = coinIds;
  closeFeaturedEditModal();
  renderFeaturedSection();
  toast('Featured coins updated for everyone!');
});

async function loadCoins() {
  if (!sb) return;
  await Promise.all([loadProUserIds(), fetchAdminModerationState()]);
  await fetchFeaturedCoins();
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  let res = await sb
    .from('coins')
    .select('*, profiles!coins_creator_id_fkey(id, username, avatar_url, is_premium)')
    .order('created_at', { ascending: false });
  if (res.error) {
    res = await sb.from('coins').select('*').order('created_at', { ascending: false });
  }
  if (!res.error) {
    const delCoins = adminModStateCache.deletedCoinIds || new Set();
    const delUsers = adminModStateCache.deletedUserIds || new Set();
    const list = (res.data || []).filter(c => {
      if (delCoins.has(String(c.id))) return false;
      if (c.creator_id && delUsers.has(String(c.creator_id))) return false;
      if (!srvResetTs) return true;
      const cts = c.created_at ? new Date(c.created_at).getTime() : 0;
      return cts > srvResetTs;
    });
    const stats = new Map();
    const openPriceMap = new Map();
    const tradedTodaySet = new Set();
    const startOfTodayIso = getStartOfTodayDate().toISOString();
    lastCoinsDateKey = getLocalDateKey(0);
    try {
      let buyQ = sb.from('trades')
        .select('coin_id, amount_usd, created_at')
        .eq('type', 'buy')
        .order('created_at', { ascending: false })
        .limit(1000);
      let todayQ = sb.from('trades')
        .select('coin_id, created_at')
        .gte('created_at', startOfTodayIso)
        .limit(1000);
      if (srvResetTs > 0) {
        const srvIso = new Date(srvResetTs).toISOString();
        buyQ = buyQ.gt('created_at', srvIso);
        todayQ = todayQ.gt('created_at', srvIso);
      }
      const [{ data: buyRows }, { data: todayRows }] = await Promise.all([buyQ, todayQ]);
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
  renderFeaturedSection();
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
        let countQ = sb.from('coins').select('id, created_at').eq('creator_id', currentUser.id);
        if (adminModStateCache.serverResetTs > 0) {
          countQ = countQ.gt('created_at', new Date(adminModStateCache.serverResetTs).toISOString());
        }
        const { data: ownCoins, error: countErr } = await countQ;
        const delCoins = adminModStateCache.deletedCoinIds || new Set();
        const activeOwnCount = (ownCoins || []).filter(x => !delCoins.has(String(x.id))).length;
        const max = currentUser.is_premium ? 3 : (currentUser.is_pro ? 2 : 1);
        if (!countErr && activeOwnCount >= max) {
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

  const isCoinCreator = currentUser && c.creator_id === currentUser.id;
  $('#coinDetail').innerHTML = `
    <div class="coin-detail-hero">
      <div class="coin-logo">${c.image_url ? `<img src="${escapeHtml(c.image_url)}">` : escapeHtml(c.ticker[0])}</div>
      <div style="flex:1;">
        <h3>${escapeHtml(c.name)} <span class="muted">$${escapeHtml(c.ticker)}</span></h3>
        <p>${escapeHtml(c.description || '')}</p>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
          ${c.creator_id ? `
            <button type="button" class="creator-chip" style="margin-top:0;" data-profile="${escapeHtml(c.creator_id)}">
              <span class="creator-mini-av">${creator?.avatar_url ? `<img src="${escapeHtml(creator.avatar_url)}">` : escapeHtml(creatorName[0].toUpperCase())}</span>
              <span>Created by ${escapeHtml(creatorName)}${tierBadgeHtml(creatorObj)}</span>
            </button>
          ` : `<p class="muted tiny" style="margin:0;">Community created</p>`}
          ${isCoinCreator ? `<button type="button" class="edit-coin-btn" id="openEditCoinBtn">✎ Edit description &amp; logo</button>` : ''}
        </div>
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
        <p class="muted tiny" style="margin-top:10px">You own: ${shares.toFixed(4)} shares · Sell value ${money(calcHoldingsValue(c.price, shares))} · Cash ${money(currentUser.cash)}</p>
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

    <div class="coin-comments-card" id="coinCommentsCard">
      <div class="coin-comments-head">
        <div>
          <div class="eyebrow purple-text">COMMUNITY</div>
          <h4 id="coinCommentsCount">Comments</h4>
        </div>
      </div>
      <div class="comment-composer">
        <div class="avatar">${currentUser.avatar_url ? `<img src="${escapeHtml(currentUser.avatar_url)}">` : escapeHtml((currentUser.username || 'G')[0].toUpperCase())}</div>
        <div class="comment-composer-body">
          <textarea id="commentInput" rows="2" maxlength="500" placeholder="Add a comment on $${escapeHtml(c.ticker)}..."></textarea>
          <div class="comment-composer-actions">
            <button type="button" class="primary-btn" id="postCommentBtn" style="padding:9px 18px;font-size:13px;">Comment</button>
          </div>
        </div>
      </div>
      <div id="coinCommentsList" class="comments-list">
        <p class="muted tiny">Loading comments...</p>
      </div>
    </div>
  `;

  $$('#coinDetail [data-fav]').forEach(btn => btn.addEventListener('click', () => toggleWatchlist(btn.dataset.fav)));
  $$('#coinDetail [data-profile]').forEach(btn => btn.addEventListener('click', () => openProfileModal(btn.dataset.profile)));
  $('#openEditCoinBtn')?.addEventListener('click', () => openEditCoinModal(c));
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

  // Dompinator Delete Handler (inline 2-click confirm + RLS-safe tombstone)
  if (isDompinator()) {
    $('#deleteCoinBtn')?.addEventListener('click', async () => {
      const btn = $('#deleteCoinBtn');
      if (!btn) return;
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = `Click again to permanently delete $${c.ticker}`;
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            btn.dataset.armed = '0';
            btn.textContent = '🗑 Delete currency (Dompinator admin)';
          }
        }, 4000);
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      // Always write an authoritative tombstone so RLS cannot keep the coin visible
      const { error: tombErr } = await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__COIN_DEL__:' + c.id,
        status: 'denied'
      });
      if (tombErr) {
        btn.disabled = false;
        btn.dataset.armed = '0';
        btn.textContent = '🗑 Delete currency (Dompinator admin)';
        toast('Delete failed: ' + tombErr.message);
        return;
      }

      adminModStateCache.deletedCoinIds?.add(String(c.id));

      try {
        await sb.from('holdings').delete().eq('coin_id', c.id);
        await sb.from('trades').delete().eq('coin_id', c.id);
        await sb.from('coins').delete().eq('id', c.id);
      } catch (err) {
        console.warn('Direct SQL delete note:', err);
      }

      coins = coins.filter(x => String(x.id) !== String(c.id));
      selectedCoin = null;
      toast(`Deleted currency $${c.ticker}`);
      await loadCoins();
      showPage('feed');
    });
  }

  $('#postCommentBtn')?.addEventListener('click', () => postCoinComment(c));
  $('#commentInput')?.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      postCoinComment(c);
    }
  });

  drawChartWithBubbles(c, trades.slice().reverse());
  getCoinSpendLeaderboard(c.id).then(rows => {
    const el = $('#coinLeaderboardList');
    if (el && selectedCoin && selectedCoin.id === c.id) {
      el.innerHTML = renderSpendRows(rows, 'No one has bought this currency yet.');
      $$('#coinLeaderboardList [data-profile]').forEach(btn => btn.addEventListener('click', () => openProfileModal(btn.dataset.profile)));
    }
  });
  loadCoinComments(c);
}

const THUMB_UP_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`;
const THUMB_DOWN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`;
const PIN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>`;

function formatRelativeTime(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - Number(ts || 0)) / 1000));
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(ts).toLocaleDateString();
}

let editingCoinTarget = null;
let editingCoinLogoData = null;

function renderEditCoinPreview() {
  const prev = $('#editCoinPreview');
  if (!prev || !editingCoinTarget) return;
  if (editingCoinLogoData) {
    prev.innerHTML = `<img src="${escapeHtml(editingCoinLogoData)}" alt="">`;
  } else {
    prev.textContent = (editingCoinTarget.ticker || '?')[0].toUpperCase();
  }
}

function openEditCoinModal(coin) {
  if (!coin || !currentUser || coin.creator_id !== currentUser.id) return;
  editingCoinTarget = coin;
  editingCoinLogoData = coin.image_url || null;
  if ($('#editCoinEyebrow')) $('#editCoinEyebrow').textContent = `EDIT CURRENCY · $${coin.ticker}`;
  if ($('#editCoinTitle')) $('#editCoinTitle').textContent = coin.name || 'Edit Currency';
  if ($('#editCoinDescription')) $('#editCoinDescription').value = coin.description || '';
  if ($('#editCoinImage')) $('#editCoinImage').value = '';
  if ($('#editCoinMessage')) $('#editCoinMessage').textContent = '';
  renderEditCoinPreview();
  $('#editCoinModal')?.classList.remove('hidden');
}

function closeEditCoinModal() {
  editingCoinTarget = null;
  editingCoinLogoData = null;
  $('#editCoinModal')?.classList.add('hidden');
}

$('#closeEditCoinBtn')?.addEventListener('click', closeEditCoinModal);
$('#cancelEditCoinBtn')?.addEventListener('click', closeEditCoinModal);
$('#editCoinModal')?.addEventListener('click', e => {
  if (e.target === $('#editCoinModal')) closeEditCoinModal();
});
$('#editCoinPreview')?.addEventListener('click', () => $('#editCoinImage')?.click());
$('#editCoinImage')?.addEventListener('change', e => {
  const f = e.target.files?.[0];
  if (!f) return;
  compressImg(f, data => {
    editingCoinLogoData = data;
    renderEditCoinPreview();
  });
});
$('#removeEditCoinLogoBtn')?.addEventListener('click', () => {
  editingCoinLogoData = null;
  if ($('#editCoinImage')) $('#editCoinImage').value = '';
  renderEditCoinPreview();
});
$('#saveEditCoinBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser || !editingCoinTarget) return;
  const msgEl = $('#editCoinMessage');
  const btn = $('#saveEditCoinBtn');
  if (msgEl) msgEl.textContent = '';
  const newDesc = ($('#editCoinDescription')?.value || '').trim();
  const newLogo = editingCoinLogoData || null;
  const targetCoin = editingCoinTarget;

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }
  const { error } = await sb
    .from('coins')
    .update({ description: newDesc, image_url: newLogo })
    .eq('id', targetCoin.id)
    .eq('creator_id', currentUser.id);
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  targetCoin.description = newDesc;
  targetCoin.image_url = newLogo;
  if (selectedCoin && String(selectedCoin.id) === String(targetCoin.id)) {
    selectedCoin.description = newDesc;
    selectedCoin.image_url = newLogo;
  }
  coins = coins.map(c => String(c.id) === String(targetCoin.id)
    ? { ...c, description: newDesc, image_url: newLogo }
    : c
  );

  closeEditCoinModal();
  toast('Currency updated!');
  if (selectedCoin && currentPage === 'coin') renderCoinDetail();
  loadCoins();
});

const expandedCommentReplies = new Set();
let activeReplyTarget = null; // { parentId, replyToUserId, replyToUsername }

async function postCoinComment(coin, replyTarget = null) {
  if (!sb || !currentUser || !coin) return;
  const isReply = Boolean(replyTarget && replyTarget.parentId);
  const input = isReply
    ? $(`#replyInput-${replyTarget.parentId}`)
    : $('#commentInput');
  const btn = isReply
    ? $(`#sendReplyBtn-${replyTarget.parentId}`)
    : $('#postCommentBtn');
  const text = (input?.value || '').trim();
  if (!text) return toast(isReply ? 'Write a reply first.' : 'Write a comment first.');
  if (btn) btn.disabled = true;

  const payload = {
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    coin_id: String(coin.id),
    text,
    ts: Date.now()
  };
  if (isReply) {
    payload.parent_id = String(replyTarget.parentId);
    if (replyTarget.replyToUserId) payload.reply_to_user_id = String(replyTarget.replyToUserId);
    if (replyTarget.replyToUsername) payload.reply_to_username = String(replyTarget.replyToUsername);
  }

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__CMT_ADD__:' + JSON.stringify(payload),
    status: 'denied'
  });

  if (btn) btn.disabled = false;
  if (error) {
    toast('Comment error: ' + error.message);
    return;
  }
  if (isReply) {
    expandedCommentReplies.add(String(replyTarget.parentId));
    activeReplyTarget = null;
    toast('Reply posted!');
  } else {
    if (input) input.value = '';
    toast('Comment posted!');
  }
  loadCoinComments(coin);
}

async function voteCoinComment(coin, commentId, currentVote, clickedType) {
  if (!sb || !currentUser || !coin || !commentId) return;
  const nextVote = currentVote === clickedType ? 'none' : clickedType;
  const payload = {
    coin_id: String(coin.id),
    comment_id: String(commentId),
    vote: nextVote,
    ts: Date.now()
  };
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__CMT_VOTE__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (error) {
    toast('Vote error: ' + error.message);
    return;
  }
  loadCoinComments(coin);
}

async function togglePinCoinComment(coin, commentId, currentlyPinned) {
  if (!sb || !currentUser || !coin) return;
  if (currentUser.id !== coin.creator_id) {
    toast('Only the creator of this currency can pin comments.');
    return;
  }
  const payload = {
    coin_id: String(coin.id),
    comment_id: currentlyPinned ? null : String(commentId),
    ts: Date.now()
  };
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__CMT_PIN__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (error) {
    toast('Pin error: ' + error.message);
    return;
  }
  toast(currentlyPinned ? 'Comment unpinned' : 'Comment pinned!');
  loadCoinComments(coin);
}

async function deleteCoinComment(coin, commentId) {
  if (!sb || !currentUser || !coin || !commentId) return;
  const payload = {
    coin_id: String(coin.id),
    comment_id: String(commentId),
    ts: Date.now()
  };
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__CMT_DEL__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (error) {
    toast('Delete error: ' + error.message);
    return;
  }
  toast('Comment removed');
  loadCoinComments(coin);
}

async function loadCoinComments(coin) {
  const listEl = $('#coinCommentsList');
  const countEl = $('#coinCommentsCount');
  if (!listEl || !sb || !coin) return;
  const coinId = String(coin.id);
  const srvResetTs = adminModStateCache.serverResetTs || 0;

  let rows = [];
  try {
    const { data } = await sb
      .from('premium_requests')
      .select('user_id, reason, created_at, profiles(id, username, avatar_url, is_premium)')
      .like('reason', '__CMT_%')
      .order('created_at', { ascending: true })
      .limit(1000);
    rows = data || [];
  } catch (e) {}

  if (!selectedCoin || String(selectedCoin.id) !== coinId) return;

  const commentsMap = new Map();
  const votesByComment = new Map();
  const deletedIds = new Set();
  let pinnedCommentId = null;

  rows.forEach(r => {
    const reason = String(r.reason || '');
    const rowTs = r.created_at ? new Date(r.created_at).getTime() : 0;
    if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;

    if (reason.startsWith('__CMT_ADD__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_ADD__:'.length));
        if (!p || String(p.coin_id) !== coinId || !p.id || !p.text) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        commentsMap.set(String(p.id), {
          id: String(p.id),
          user_id: r.user_id,
          parent_id: p.parent_id ? String(p.parent_id) : null,
          reply_to_user_id: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
          reply_to_username: p.reply_to_username ? String(p.reply_to_username) : null,
          text: String(p.text),
          ts,
          profile: r.profiles || { id: r.user_id, username: 'Trader' }
        });
      } catch (e) {}
    } else if (reason.startsWith('__CMT_VOTE__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_VOTE__:'.length));
        if (!p || String(p.coin_id) !== coinId || !p.comment_id || !r.user_id) return;
        let vMap = votesByComment.get(String(p.comment_id));
        if (!vMap) {
          vMap = new Map();
          votesByComment.set(String(p.comment_id), vMap);
        }
        vMap.set(r.user_id, p.vote === 'like' || p.vote === 'dislike' ? p.vote : 'none');
      } catch (e) {}
    } else if (reason.startsWith('__CMT_PIN__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_PIN__:'.length));
        if (!p || String(p.coin_id) !== coinId) return;
        if (r.user_id !== coin.creator_id) return;
        pinnedCommentId = p.comment_id ? String(p.comment_id) : null;
      } catch (e) {}
    } else if (reason.startsWith('__CMT_DEL__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_DEL__:'.length));
        if (!p || String(p.coin_id) !== coinId || !p.comment_id) return;
        const targetCm = commentsMap.get(String(p.comment_id));
        const isAuthor = targetCm && r.user_id === targetCm.user_id;
        const isCoinCreator = r.user_id === coin.creator_id;
        const isAdmin = (r.profiles?.username || '').toLowerCase() === 'dompinator';
        if (isAuthor || isCoinCreator || isAdmin) {
          deletedIds.add(String(p.comment_id));
        }
      } catch (e) {}
    }
  });

  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const topComments = [];
  const repliesByParent = new Map();

  Array.from(commentsMap.values()).forEach(cm => {
    if (deletedIds.has(cm.id) || delUsers.has(String(cm.user_id))) return;
    if (!cm.parent_id) {
      topComments.push(cm);
    }
  });

  const activeTopIds = new Set(topComments.map(c => c.id));
  let totalVisibleCount = topComments.length;

  Array.from(commentsMap.values()).forEach(cm => {
    if (!cm.parent_id) return;
    if (deletedIds.has(cm.id) || delUsers.has(String(cm.user_id))) return;
    if (!activeTopIds.has(cm.parent_id)) return;
    const arr = repliesByParent.get(cm.parent_id) || [];
    arr.push(cm);
    repliesByParent.set(cm.parent_id, arr);
    totalVisibleCount += 1;
  });

  if (pinnedCommentId && !activeTopIds.has(pinnedCommentId)) {
    pinnedCommentId = null;
  }

  topComments.sort((a, b) => {
    if (a.id === pinnedCommentId) return -1;
    if (b.id === pinnedCommentId) return 1;
    return b.ts - a.ts;
  });

  repliesByParent.forEach(arr => arr.sort((a, b) => a.ts - b.ts));

  if (countEl) {
    countEl.textContent = `Comments (${totalVisibleCount})`;
  }

  if (!topComments.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px 12px;"><p>No comments yet. Be the first to comment!</p></div>';
    return;
  }

  const creatorUsername = coin.profiles?.username || 'Creator';
  const isViewerCoinCreator = currentUser && currentUser.id === coin.creator_id;
  const myAv = currentUser?.avatar_url
    ? `<img src="${escapeHtml(currentUser.avatar_url)}">`
    : escapeHtml((currentUser?.username || 'G')[0].toUpperCase());

  const renderVoteBtns = (cm) => {
    const vMap = votesByComment.get(cm.id) || new Map();
    let likes = 0;
    let dislikes = 0;
    vMap.forEach(v => {
      if (v === 'like') likes += 1;
      else if (v === 'dislike') dislikes += 1;
    });
    const myVote = currentUser ? (vMap.get(currentUser.id) || 'none') : 'none';
    return `
      <button type="button" class="cmt-action-btn ${myVote === 'like' ? 'liked' : ''}" data-cmt-vote="like" data-cid="${escapeHtml(cm.id)}" data-cur="${escapeHtml(myVote)}" title="Like">
        ${THUMB_UP_SVG}<span>${likes}</span>
      </button>
      <button type="button" class="cmt-action-btn ${myVote === 'dislike' ? 'disliked' : ''}" data-cmt-vote="dislike" data-cid="${escapeHtml(cm.id)}" data-cur="${escapeHtml(myVote)}" title="Dislike">
        ${THUMB_DOWN_SVG}<span>${dislikes}</span>
      </button>
    `;
  };

  listEl.innerHTML = topComments.map(cm => {
    const isPinned = cm.id === pinnedCommentId;
    const isCommenterCreator = cm.user_id === coin.creator_id;
    const canDelete = currentUser && (currentUser.id === cm.user_id || isViewerCoinCreator || isDompinator());
    const uname = cm.profile?.username || 'Trader';
    const avatar = cm.profile?.avatar_url || null;
    const profObj = { ...cm.profile, id: cm.user_id };
    const replies = repliesByParent.get(cm.id) || [];
    const isExpanded = expandedCommentReplies.has(cm.id);
    const isReplyingHere = activeReplyTarget && activeReplyTarget.parentId === cm.id;

    const repliesHtml = replies.map(rp => {
      const rUname = rp.profile?.username || 'Trader';
      const rAv = rp.profile?.avatar_url || null;
      const rProf = { ...rp.profile, id: rp.user_id };
      const rIsCreator = rp.user_id === coin.creator_id;
      const rCanDel = currentUser && (currentUser.id === rp.user_id || isViewerCoinCreator || isDompinator());
      const mentionHtml = rp.reply_to_username && rp.reply_to_user_id !== cm.user_id
        ? `<span class="cmt-reply-mention">@${escapeHtml(rp.reply_to_username)}</span>`
        : '';
      return `
        <div class="comment-item reply-item" data-cmt-id="${escapeHtml(rp.id)}">
          <div class="avatar">${rAv ? `<img src="${escapeHtml(rAv)}">` : escapeHtml(rUname[0].toUpperCase())}</div>
          <div class="comment-main">
            <div class="comment-meta">
              <strong class="profile-link" data-profile="${escapeHtml(rp.user_id)}">${escapeHtml(rUname)}${tierBadgeHtml(rProf)}</strong>
              ${rIsCreator ? '<span class="comment-creator-tag">Creator</span>' : ''}
              <span class="comment-time">${escapeHtml(formatRelativeTime(rp.ts))}</span>
            </div>
            <div class="comment-text">${mentionHtml}${escapeHtml(rp.text).replace(/\n/g, '<br>')}</div>
            <div class="comment-actions">
              ${renderVoteBtns(rp)}
              <button type="button" class="cmt-action-btn" data-cmt-reply="${escapeHtml(cm.id)}" data-reply-uid="${escapeHtml(rp.user_id)}" data-reply-name="${escapeHtml(rUname)}">Reply</button>
              ${rCanDel ? `<button type="button" class="cmt-action-btn del-btn" data-cmt-del="${escapeHtml(rp.id)}">Delete</button>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return `
    <div class="comment-item ${isPinned ? 'pinned' : ''}" data-cmt-id="${escapeHtml(cm.id)}">
      <div class="avatar">${avatar ? `<img src="${escapeHtml(avatar)}">` : escapeHtml(uname[0].toUpperCase())}</div>
      <div class="comment-main">
        ${isPinned ? `<div class="comment-pinned-badge">${PIN_SVG} Pinned by ${escapeHtml(creatorUsername)}</div>` : ''}
        <div class="comment-meta">
          <strong class="profile-link" data-profile="${escapeHtml(cm.user_id)}">${escapeHtml(uname)}${tierBadgeHtml(profObj)}</strong>
          ${isCommenterCreator ? '<span class="comment-creator-tag">Creator</span>' : ''}
          <span class="comment-time">${escapeHtml(formatRelativeTime(cm.ts))}</span>
        </div>
        <div class="comment-text">${escapeHtml(cm.text).replace(/\n/g, '<br>')}</div>
        <div class="comment-actions">
          ${renderVoteBtns(cm)}
          <button type="button" class="cmt-action-btn" data-cmt-reply="${escapeHtml(cm.id)}" data-reply-uid="${escapeHtml(cm.user_id)}" data-reply-name="${escapeHtml(uname)}">Reply</button>
          ${isViewerCoinCreator ? `
            <button type="button" class="cmt-action-btn ${isPinned ? 'pinned-btn' : ''}" data-cmt-pin="${escapeHtml(cm.id)}" data-pinned="${isPinned ? '1' : '0'}">
              ${PIN_SVG}<span>${isPinned ? 'Unpin' : 'Pin'}</span>
            </button>
          ` : ''}
          ${canDelete ? `
            <button type="button" class="cmt-action-btn del-btn" data-cmt-del="${escapeHtml(cm.id)}">Delete</button>
          ` : ''}
        </div>
        ${isReplyingHere ? `
          <div class="cmt-reply-box">
            <div class="avatar">${myAv}</div>
            <div class="cmt-reply-body">
              <textarea id="replyInput-${escapeHtml(cm.id)}" rows="2" maxlength="500" placeholder="Replying to @${escapeHtml(activeReplyTarget.replyToUsername || uname)}..."></textarea>
              <div class="cmt-reply-actions">
                <button type="button" class="zoom-btn" data-reply-cancel="${escapeHtml(cm.id)}">Cancel</button>
                <button type="button" class="primary-btn" id="sendReplyBtn-${escapeHtml(cm.id)}" data-reply-send="${escapeHtml(cm.id)}" style="padding:7px 14px;font-size:12px;">Reply</button>
              </div>
            </div>
          </div>
        ` : ''}
        ${replies.length ? `
          <button type="button" class="cmt-replies-toggle" data-toggle-replies="${escapeHtml(cm.id)}">
            ${isExpanded ? `▴ Hide ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : `▾ ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
          </button>
          ${isExpanded ? `<div class="cmt-replies-list">${repliesHtml}</div>` : ''}
        ` : ''}
      </div>
    </div>`;
  }).join('');

  $$('#coinCommentsList [data-profile]').forEach(el => {
    el.addEventListener('click', () => openProfileModal(el.dataset.profile));
  });
  $$('#coinCommentsList [data-cmt-vote]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      voteCoinComment(coin, btn.dataset.cid, btn.dataset.cur, btn.dataset.cmtVote);
    });
  });
  $$('#coinCommentsList [data-cmt-pin]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      togglePinCoinComment(coin, btn.dataset.cmtPin, btn.dataset.pinned === '1');
    });
  });
  $$('#coinCommentsList [data-cmt-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      deleteCoinComment(coin, btn.dataset.cmtDel);
    });
  });
  $$('#coinCommentsList [data-cmt-reply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parentId = btn.dataset.cmtReply;
      activeReplyTarget = {
        parentId,
        replyToUserId: btn.dataset.replyUid || null,
        replyToUsername: btn.dataset.replyName || 'Trader'
      };
      expandedCommentReplies.add(parentId);
      loadCoinComments(coin).then(() => {
        $(`#replyInput-${parentId}`)?.focus();
      });
    });
  });
  $$('#coinCommentsList [data-reply-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      activeReplyTarget = null;
      loadCoinComments(coin);
    });
  });
  $$('#coinCommentsList [data-reply-send]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (activeReplyTarget && activeReplyTarget.parentId === btn.dataset.replySend) {
        postCoinComment(coin, activeReplyTarget);
      }
    });
  });
  $$('#coinCommentsList [data-toggle-replies]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.toggleReplies;
      if (expandedCommentReplies.has(pid)) expandedCommentReplies.delete(pid);
      else expandedCommentReplies.add(pid);
      loadCoinComments(coin);
    });
  });
}

// Path-independent exponential bonding curve:
// Total reserve in curve down to $0 is P / CURVE_K.
// Buying `amount` USD raises price by CURVE_K * amount and mints exact integral shares:
//   shares = ln(newPrice / oldPrice) / CURVE_K
// Selling `shares` reverses along the exact same curve so you can never extract
// more USD than you put in unless someone else buys in first.
const CURVE_K = 0.30;

function calcCurveBuy(price, amount) {
  const p = Math.max(Number(price) || 1, 0.01);
  const amt = Math.max(Number(amount) || 0, 0);
  const newPrice = p + CURVE_K * amt;
  const shares = Math.log(newPrice / p) / CURVE_K;
  return { newPrice, shares };
}

function calcCurveSell(price, sharesToSell) {
  const p = Math.max(Number(price) || 1, 0.01);
  const s = Math.max(Number(sharesToSell) || 0, 0);
  if (s <= 0) return { newPrice: p, proceeds: 0 };
  const newPrice = Math.max(0.01, p * Math.exp(-CURVE_K * s));
  const rawProceeds = Math.max(0, (p - newPrice) / CURVE_K);
  const proceeds = Math.floor((rawProceeds + 1e-9) * 100) / 100;
  return { newPrice, proceeds };
}

function calcHoldingsValue(price, shares) {
  return calcCurveSell(price, shares).proceeds;
}

async function updateNetWorth() {
  if (!currentUser || !sb) return;
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const delCoins = adminModStateCache.deletedCoinIds || new Set();
  let holdsQ = sb.from('holdings').select('coin_id, shares, coins(price, created_at)').eq('user_id', currentUser.id);
  let coinsQ = sb.from('coins').select('id, price, created_at').eq('creator_id', currentUser.id);
  if (srvResetTs > 0) {
    coinsQ = coinsQ.gt('created_at', new Date(srvResetTs).toISOString());
  }
  const [{ data: holds }, { data: myCoins }] = await Promise.all([holdsQ, coinsQ]);
  const validHolds = (holds || []).filter(h => !delCoins.has(String(h.coin_id)) && (!srvResetTs || (h.coins?.created_at && new Date(h.coins.created_at).getTime() > srvResetTs)));
  const validCoins = (myCoins || []).filter(c => !delCoins.has(String(c.id)));
  const holdingsValue = validHolds.reduce((s, h) => s + calcHoldingsValue(h.coins?.price, h.shares), 0);
  const createdValue = validCoins.reduce((s, c) => s + Number(c.price || 0), 0);
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
  if (tradeInFlight) return;
  amount = Math.round(Number(amount || 0) * 100) / 100;
  if (!currentUser || amount < 0.01) return $('#tradeMessage').textContent = 'Minimum buy is $0.01.';
  if (currentUser.cash < amount) return $('#tradeMessage').textContent = 'Not enough cash.';

  tradeInFlight = true;
  try {
    const prevOpenToday = Number(coin.today_open_price) || Number(coin.price) || 1;
    coin = await freshCoin(coin);   // use the live price, not a stale one
    const oldPrice = Math.max(Number(coin.price) || 1, 0.01);
    const { newPrice, shares } = calcCurveBuy(oldPrice, amount);
    const impact = (newPrice - oldPrice) / oldPrice;
    const todayPct = prevOpenToday > 0 ? ((newPrice - prevOpenToday) / prevOpenToday) * 100 : 0;
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
  } finally {
    tradeInFlight = false;
  }
}

async function sell(coin, sharesToSell) {
  if (tradeInFlight) return;
  if (!currentUser || sharesToSell <= 0) return $('#tradeMessage').textContent = 'No shares to sell.';

  tradeInFlight = true;
  try {
    const prevOpenToday = Number(coin.today_open_price) || Number(coin.price) || 1;
    coin = await freshCoin(coin);
    const { data: hold } = await sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', coin.id).maybeSingle();
    const owned = hold?.shares || 0;
    const sellShares = Math.min(sharesToSell, owned);
    if (sellShares <= 0) return;

    const { newPrice, proceeds } = calcCurveSell(coin.price, sellShares);
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
  } finally {
    tradeInFlight = false;
  }
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
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const delCoins = adminModStateCache.deletedCoinIds || new Set();
  let holdsQ = sb.from('holdings').select('*, coins(name, ticker, price, image_url, created_at)').eq('user_id', currentUser.id).gt('shares', 0);
  let coinsQ = sb.from('coins').select('*').eq('creator_id', currentUser.id).order('created_at', { ascending: false });
  let tradesQ = sb.from('trades').select('coin_id, type, amount_usd, created_at').eq('user_id', currentUser.id);
  if (srvResetTs > 0) {
    const srvIso = new Date(srvResetTs).toISOString();
    coinsQ = coinsQ.gt('created_at', srvIso);
    tradesQ = tradesQ.gt('created_at', srvIso);
  }
  const [{ data: holds }, { data: myCoins }, { data: myTrades }] = await Promise.all([holdsQ, coinsQ, tradesQ]);
  const list = (holds || []).filter(h => !delCoins.has(String(h.coin_id)) && (!srvResetTs || (h.coins?.created_at && new Date(h.coins.created_at).getTime() > srvResetTs)));
  const created = (myCoins || []).filter(c => !delCoins.has(String(c.id)));
  const holdingsValue = list.reduce((s, h) => s + calcHoldingsValue(h.coins?.price, h.shares), 0);
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
    const curVal = calcHoldingsValue(h.coins?.price, h.shares);
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

function getEffectiveProfileStats(p) {
  const premOv = p?.id ? adminModStateCache.premiumOverrides?.get(String(p.id)) : null;
  let effectivePrem = Boolean(p?.is_premium);
  if (premOv?.removed) effectivePrem = false;
  else if (premOv?.granted) effectivePrem = true;

  const srvTs = adminModStateCache.serverResetTs || 0;
  if (!srvTs) {
    return effectivePrem === Boolean(p?.is_premium) ? p : { ...p, is_premium: effectivePrem };
  }
  const isAdm = (p.username || '').toLowerCase() === 'dompinator';
  const ackTs = adminModStateCache.resetDoneMap?.get(p.id) || 0;
  if (ackTs >= srvTs) {
    return effectivePrem === Boolean(p?.is_premium) ? p : { ...p, is_premium: effectivePrem };
  }
  return {
    ...p,
    cash: 15,
    net_worth: 15,
    time_played: 0,
    is_premium: isAdm ? effectivePrem : false
  };
}

async function renderLeaderboard() {
  if (!sb) return;
  await Promise.all([loadProUserIds(), fetchAdminModerationState()]);
  if (currentUser) await updateNetWorth();
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  let query = sb.from('profiles').select('id, username, avatar_url, cash, net_worth, time_played, is_premium');
  const { data } = await query.limit(200);
  let list = (data || [])
    .filter(p => !delUsers.has(String(p.id)))
    .map(getEffectiveProfileStats);
  if (lbMode === 'networth') {
    list.sort((a, b) => Number(b.net_worth || 0) - Number(a.net_worth || 0));
  } else {
    list.sort((a, b) => Number(b.time_played || 0) - Number(a.time_played || 0));
  }
  list = list.slice(0, 100);
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

// ---------- Profile Preview Modal (Public stats + Dompinator Admin Controls) ----------
async function sendAdminCommand(action, targetUserId, msg = '') {
  if (!isDompinator() || !currentUser || !sb || !targetUserId) return false;
  if (targetUserId === currentUser.id) {
    toast('You cannot moderate your own admin account.');
    return false;
  }
  const ts = Date.now();
  const payload = { action, target: targetUserId, ts, msg: String(msg || '').trim() };
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__ADMIN_CMD__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (error) {
    toast('Admin action error: ' + error.message);
    return false;
  }

  if (action === 'reset') {
    try {
      await sb.from('premium_requests')
        .update({ status: 'denied' })
        .eq('user_id', targetUserId)
        .eq('status', 'approved');
      await sb.from('profiles')
        .update({ cash: 15, net_worth: 15, is_premium: false, time_played: 0 })
        .eq('id', targetUserId);
    } catch (e) {}
  }
  return true;
}

async function openProfileModal(userId) {
  if (!sb || !userId) return;
  const modal = $('#profileModal');
  const body = $('#profileModalBody');
  if (!modal || !body) return;
  body.innerHTML = '<p class="muted tiny">Loading profile...</p>';
  modal.classList.remove('hidden');

  await loadProUserIds();
  await fetchAdminModerationState();
  const { data: p } = await sb
    .from('profiles')
    .select('id, username, avatar_url, net_worth, time_played, is_premium')
    .eq('id', userId)
    .maybeSingle();

  if (!p || adminModStateCache.deletedUserIds?.has(String(p.id))) {
    body.innerHTML = '<p class="muted">This account was permanently deleted or does not exist.</p>';
    return;
  }

  const userCoins = coins.filter(c => c.creator_id === p.id);
  const isTargetBanned = Boolean(adminModStateCache.bans.get(p.id)?.banned);
  const isTargetPremium = isEffectivePremium(p);
  const canModerate = isDompinator() && currentUser && p.id !== currentUser.id;

  body.innerHTML = `
    <div class="profile-modal-hero">
      <div class="avatar" style="width:58px;height:58px;font-size:22px;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div>
        <h3 style="margin:0;">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}${isTargetBanned ? '<span class="banned-tag">BANNED</span>' : ''}</h3>
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
    ${canModerate ? `
      <div class="admin-mod-box">
        <div class="eyebrow purple-text" style="margin-bottom:8px;">DOMPINATOR ADMIN CONTROLS</div>
        <input id="adminModReason" class="admin-mod-input" type="text" maxlength="200" placeholder="Warning or ban reason...">
        <div class="admin-mod-actions">
          <button type="button" class="warn-btn" id="adminWarnBtn">Warn</button>
          ${isTargetPremium ? `<button type="button" class="remove-prem-btn" id="adminRemovePremBtn">Remove Premium</button>` : ''}
          <button type="button" class="reset-btn" id="adminResetBtn">Reset Account</button>
          <button type="button" class="reset-btn hidden" id="adminResetConfirmBtn">Confirm Reset</button>
          <button type="button" class="zoom-btn hidden" id="adminResetCancelBtn">Cancel</button>
          <button type="button" class="${isTargetBanned ? 'unban-btn' : 'ban-btn'}" id="adminBanBtn">${isTargetBanned ? 'Unban Account' : 'Ban Account'}</button>
          <button type="button" class="delete-acc-btn" id="adminDeleteAccBtn">Delete Account</button>
        </div>
        <p id="adminModMessage" class="form-message"></p>
      </div>
    ` : ''}
  `;

  $$('[data-modal-coin]').forEach(el => el.addEventListener('click', () => {
    modal.classList.add('hidden');
    openCoin(el.dataset.modalCoin);
  }));

  if (canModerate) {
    const msgEl = $('#adminModMessage');
    const reasonEl = $('#adminModReason');

    $('#adminWarnBtn')?.addEventListener('click', async () => {
      const text = reasonEl?.value.trim() || '';
      if (!text) {
        if (msgEl) msgEl.textContent = 'Write a warning message first.';
        reasonEl?.focus();
        return;
      }
      if (msgEl) msgEl.textContent = '';
      const ok = await sendAdminCommand('warn', p.id, text);
      if (ok) {
        toast(`Warning sent to ${p.username}`);
        if (reasonEl) reasonEl.value = '';
      }
    });

    $('#adminRemovePremBtn')?.addEventListener('click', async () => {
      const ok = await removePremiumFromUser(p.id, p.username || 'user');
      if (ok) {
        openProfileModal(p.id);
      }
    });

    $('#adminResetBtn')?.addEventListener('click', () => {
      $('#adminResetBtn')?.classList.add('hidden');
      $('#adminResetConfirmBtn')?.classList.remove('hidden');
      $('#adminResetCancelBtn')?.classList.remove('hidden');
    });
    $('#adminResetCancelBtn')?.addEventListener('click', () => {
      $('#adminResetBtn')?.classList.remove('hidden');
      $('#adminResetConfirmBtn')?.classList.add('hidden');
      $('#adminResetCancelBtn')?.classList.add('hidden');
    });
    $('#adminResetConfirmBtn')?.addEventListener('click', async () => {
      const ok = await sendAdminCommand('reset', p.id, 'Reset by administrator');
      if (ok) {
        toast(`Account reset for ${p.username}`);
        openProfileModal(p.id);
        if (currentPage === 'admin') loadAdminAccounts();
        if (currentPage === 'global') renderLeaderboard();
      }
    });

    $('#adminBanBtn')?.addEventListener('click', async () => {
      const action = isTargetBanned ? 'unban' : 'ban';
      const reason = reasonEl?.value.trim() || 'Banned by an administrator.';
      const ok = await sendAdminCommand(action, p.id, action === 'ban' ? reason : '');
      if (ok) {
        toast(action === 'ban' ? `Banned ${p.username}` : `Unbanned ${p.username}`);
        openProfileModal(p.id);
        if (currentPage === 'admin') loadAdminAccounts();
      }
    });

    $('#adminDeleteAccBtn')?.addEventListener('click', () => {
      openDeleteAccountModal(p.id, p.username || 'user', false);
    });
  }
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

let adminAccountsCache = [];
let adminAccountQuery = '';

// ---------- LIVE FEED ----------
let liveMode = 'all';
let liveEventsCache = [];

async function loadLiveFeed() {
  if (!sb) return;
  await Promise.all([loadProUserIds(), fetchAdminModerationState()]);
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const delCoins = adminModStateCache.deletedCoinIds || new Set();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  let tradesQ = sb
    .from('trades')
    .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, image_url, creator_id), profiles(id, username, avatar_url, is_premium)')
    .order('created_at', { ascending: false })
    .limit(60);
  let coinsQ = sb
    .from('coins')
    .select('id, name, ticker, price, image_url, creator_id, created_at, profiles!coins_creator_id_fkey(id, username, avatar_url, is_premium)')
    .order('created_at', { ascending: false })
    .limit(40);
  let myTradesQ = currentUser
    ? sb.from('trades')
        .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, image_url, creator_id), profiles(id, username, avatar_url, is_premium)')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(60)
    : Promise.resolve({ data: [] });
  const myCoinIds = coins.filter(c => currentUser && c.creator_id === currentUser.id).map(c => c.id);
  let myCoinTradesQ = (currentUser && myCoinIds.length)
    ? sb.from('trades')
        .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, image_url, creator_id), profiles(id, username, avatar_url, is_premium)')
        .in('coin_id', myCoinIds)
        .order('created_at', { ascending: false })
        .limit(60)
    : Promise.resolve({ data: [] });

  if (srvResetTs > 0) {
    const srvIso = new Date(srvResetTs).toISOString();
    tradesQ = tradesQ.gt('created_at', srvIso);
    coinsQ = coinsQ.gt('created_at', srvIso);
    if (currentUser) myTradesQ = myTradesQ.gt('created_at', srvIso);
    if (currentUser && myCoinIds.length) myCoinTradesQ = myCoinTradesQ.gt('created_at', srvIso);
  }

  let [tRes, cRes, pRes, mtRes, mctRes] = await Promise.all([
    tradesQ,
    coinsQ,
    sb.from('profiles').select('id, username, avatar_url, is_premium').limit(500),
    myTradesQ,
    myCoinTradesQ
  ]);

  if (tRes.error) {
    let fallbackT = sb.from('trades').select('id, coin_id, user_id, type, amount_usd, price_after, created_at').order('created_at', { ascending: false }).limit(60);
    if (srvResetTs > 0) fallbackT = fallbackT.gt('created_at', new Date(srvResetTs).toISOString());
    tRes = await fallbackT;
  }
  if (cRes.error) {
    let fallbackC = sb.from('coins').select('id, name, ticker, price, image_url, creator_id, created_at').order('created_at', { ascending: false }).limit(40);
    if (srvResetTs > 0) fallbackC = fallbackC.gt('created_at', new Date(srvResetTs).toISOString());
    cRes = await fallbackC;
  }

  const profMap = new Map();
  (pRes?.data || []).forEach(p => {
    if (p?.id) profMap.set(String(p.id), p);
  });
  const coinMap = new Map();
  coins.forEach(c => coinMap.set(String(c.id), c));
  (cRes?.data || []).forEach(c => {
    if (c?.id && !coinMap.has(String(c.id))) coinMap.set(String(c.id), c);
  });

  const seenKeys = new Set();
  const events = [];
  const pushTradeEvent = (t) => {
    const tidKey = 'trade_' + (t.id || `${t.coin_id}_${t.user_id}_${t.created_at}`);
    if (seenKeys.has(tidKey)) return;
    const cid = String(t.coin_id || '');
    const uid = String(t.user_id || '');
    if (!cid || delCoins.has(cid) || (uid && delUsers.has(uid))) return;
    const cObj = t.coins || coinMap.get(cid);
    if (!cObj) return;
    const pObj = t.profiles || profMap.get(uid) || { id: uid, username: 'Trader' };
    const ts = t.created_at ? new Date(t.created_at).getTime() : Date.now();
    if (srvResetTs && ts <= srvResetTs) return;
    seenKeys.add(tidKey);
    const isSelf = currentUser && uid === String(currentUser.id);
    const isMyCoin = currentUser && String(cObj.creator_id || '') === String(currentUser.id);
    events.push({
      kind: 'trade',
      tradeType: t.type === 'sell' ? 'sell' : 'buy',
      ts,
      userId: uid,
      profile: pObj,
      coin: cObj,
      amountUsd: Number(t.amount_usd || 0),
      price: Number(t.price_after ?? cObj.price ?? 1),
      isPersonal: Boolean(isSelf || isMyCoin),
      isSelf: Boolean(isSelf),
      isMyCoin: Boolean(isMyCoin)
    });
  };

  (tRes?.data || []).forEach(pushTradeEvent);
  (mtRes?.data || []).forEach(pushTradeEvent);
  (mctRes?.data || []).forEach(pushTradeEvent);

  (cRes?.data || []).forEach(c => {
    const cid = String(c.id || '');
    const uid = String(c.creator_id || '');
    if (!cid || delCoins.has(cid) || (uid && delUsers.has(uid))) return;
    const cKey = 'coin_' + cid;
    if (seenKeys.has(cKey)) return;
    seenKeys.add(cKey);
    const pObj = c.profiles || profMap.get(uid) || { id: uid, username: 'Trader' };
    const ts = c.created_at ? new Date(c.created_at).getTime() : Date.now();
    if (srvResetTs && ts <= srvResetTs) return;
    const isSelf = currentUser && uid === String(currentUser.id);
    events.push({
      kind: 'coin',
      ts,
      userId: uid,
      profile: pObj,
      coin: c,
      price: Number(c.price || 1),
      isPersonal: Boolean(isSelf),
      isSelf: Boolean(isSelf),
      isMyCoin: Boolean(isSelf)
    });
  });

  let postRows = [];
  try {
    let lpQ = sb.from('premium_requests')
      .select('id, user_id, reason, created_at, profiles(id, username, avatar_url, is_premium)')
      .like('reason', '__LIVE_POST__:%')
      .order('created_at', { ascending: false })
      .limit(40);
    if (srvResetTs > 0) {
      lpQ = lpQ.gt('created_at', new Date(srvResetTs).toISOString());
    }
    const { data: lpData } = await lpQ;
    postRows = lpData || [];
  } catch (e) {}

  postRows.forEach(r => {
    try {
      const parsed = JSON.parse(String(r.reason || '').slice('__LIVE_POST__:'.length));
      if (!parsed || !parsed.coin_id || !parsed.message) return;
      const cid = String(parsed.coin_id);
      const uid = String(r.user_id || '');
      if (delCoins.has(cid) || (uid && delUsers.has(uid))) return;
      const ts = Number(parsed.ts) || (r.created_at ? new Date(r.created_at).getTime() : Date.now());
      if (srvResetTs > 0 && ts <= srvResetTs) return;
      const pKey = 'livepost_' + (parsed.id || r.id || ts);
      if (seenKeys.has(pKey)) return;
      seenKeys.add(pKey);
      const cObj = coinMap.get(cid) || {
        id: cid,
        name: parsed.coin_name || 'Coin',
        ticker: parsed.coin_ticker || 'COIN',
        image_url: parsed.coin_image || null,
        price: 1
      };
      const pObj = r.profiles || profMap.get(uid) || { id: uid, username: 'Trader' };
      const isSelf = currentUser && uid === String(currentUser.id);
      const isMyCoin = currentUser && String(cObj.creator_id || '') === String(currentUser.id);
      events.push({
        kind: 'livepost',
        ts,
        userId: uid,
        profile: pObj,
        coin: cObj,
        message: String(parsed.message),
        season: Number(parsed.season || 1),
        price: Number(cObj.price || 1),
        isPersonal: Boolean(isSelf || isMyCoin),
        isSelf: Boolean(isSelf),
        isMyCoin: Boolean(isMyCoin)
      });
    } catch (e) {}
  });

  events.sort((a, b) => b.ts - a.ts);
  liveEventsCache = events;
  if (currentPage === 'live') renderLiveFeed();
}

function formatLiveTime(ts) {
  const numTs = Number(ts || 0);
  const diff = Math.max(0, Math.floor((Date.now() - numTs) / 1000));
  if (diff > 48 * 3600) {
    return new Date(numTs).toLocaleDateString();
  }
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function renderLiveFeed() {
  const listEl = $('#liveFeedList');
  const emptyEl = $('#emptyLiveFeed');
  if (!listEl || !emptyEl) return;

  const filtered = liveEventsCache.filter(ev => {
    if (liveMode === 'personal') return ev.isPersonal;
    if (liveMode === 'trades') return ev.kind === 'trade';
    if (liveMode === 'coins') return ev.kind === 'coin';
    return true;
  });

  emptyEl.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 80).map(ev => {
    const uname = ev.profile?.username || 'Trader';
    const av = ev.profile?.avatar_url
      ? `<img src="${escapeHtml(ev.profile.avatar_url)}" alt="">`
      : escapeHtml(uname[0].toUpperCase());
    const profObj = { id: ev.userId, ...ev.profile };
    const coinImg = ev.coin?.image_url
      ? `<img src="${escapeHtml(ev.coin.image_url)}" alt="">`
      : escapeHtml((ev.coin?.ticker || '?')[0]);
    const coinTag = `
      <span class="live-coin-chip" data-live-coin="${escapeHtml(ev.coin.id)}">
        <span class="live-coin-mini">${coinImg}</span>
        <span>${escapeHtml(ev.coin.name)} ($${escapeHtml(ev.coin.ticker)})</span>
      </span>
    `;
    let badgeHtml = '';
    let actionHtml = '';
    let rightLabel = '';
    let extraMsgHtml = '';
    if (ev.kind === 'livepost') {
      badgeHtml = `<span class="live-badge livepost">COIN LIVE POST</span>`;
      actionHtml = `shouted out ${coinTag}`;
      rightLabel = `Now ${priceFmt(ev.price || 1)}`;
      extraMsgHtml = `<div class="live-post-msg">${escapeHtml(ev.message)}</div>`;
    } else if (ev.kind === 'coin') {
      badgeHtml = `<span class="live-badge coin">NEW COIN</span>`;
      actionHtml = `launched ${coinTag}`;
      rightLabel = `Start ${priceFmt(ev.price || 1)}`;
    } else if (ev.tradeType === 'sell') {
      badgeHtml = `<span class="live-badge sell">SELL</span>`;
      actionHtml = `sold <strong>${money(ev.amountUsd)}</strong> of ${coinTag}`;
      rightLabel = `@ ${priceFmt(ev.price)}`;
    } else {
      badgeHtml = `<span class="live-badge buy">BUY</span>`;
      actionHtml = `bought <strong>${money(ev.amountUsd)}</strong> of ${coinTag}`;
      rightLabel = `@ ${priceFmt(ev.price)}`;
    }
    const personalTag = liveMode === 'personal'
      ? (ev.isSelf ? `<span class="live-personal-tag">YOU</span>` : (ev.isMyCoin ? `<span class="live-personal-tag">YOUR COIN</span>` : ''))
      : '';
    return `
      <div class="live-row ${ev.kind === 'livepost' ? 'live-post-highlight' : ''}">
        <div class="live-row-left">
          <div class="avatar profile-link" data-profile="${escapeHtml(ev.userId)}" style="cursor:pointer;">${av}</div>
          <div class="live-row-main">
            <div class="live-row-line">
              ${badgeHtml}
              ${personalTag}
              <strong class="profile-link" data-profile="${escapeHtml(ev.userId)}">${escapeHtml(uname)}${tierBadgeHtml(profObj)}</strong>
              <span class="muted">${actionHtml}</span>
            </div>
            ${extraMsgHtml}
          </div>
        </div>
        <div class="live-row-right">
          <span class="live-row-price">${escapeHtml(rightLabel)}</span>
          <span class="muted tiny" title="${escapeHtml(new Date(ev.ts).toLocaleString())}">${escapeHtml(formatLiveTime(ev.ts))}</span>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('[data-profile]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.profile) openProfileModal(el.dataset.profile);
    });
  });
  listEl.querySelectorAll('[data-live-coin]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.liveCoin) openCoin(el.dataset.liveCoin);
    });
  });
}

// ---------- REPORT PLAYER OR BUG ----------
let reportType = 'player';
let reportPlayersCache = [];

function setReportType(type) {
  reportType = type === 'bug' ? 'bug' : 'player';
  $$('.feed-tab[data-report-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.reportType === reportType);
  });
  $('#reportPlayerWrap')?.classList.toggle('hidden', reportType !== 'player');
  $('#reportBugWrap')?.classList.toggle('hidden', reportType !== 'bug');
  const msg = $('#reportMessage');
  if (msg) {
    msg.textContent = '';
    msg.style.color = '';
  }
}

async function loadReportPage() {
  if (!sb) return;
  await fetchAdminModerationState();
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const sel = $('#reportPlayerSelect');
  if (!sel) return;

  const { data } = await sb
    .from('profiles')
    .select('id, username')
    .order('username', { ascending: true })
    .limit(500);

  const list = (data || []).filter(p =>
    p.id && p.username && !delUsers.has(String(p.id)) && (!currentUser || p.id !== currentUser.id)
  );
  reportPlayersCache = list;

  const prev = sel.value;
  sel.innerHTML = `<option value="">Select a player...</option>` + list.map(p =>
    `<option value="${escapeHtml(p.id)}">${escapeHtml(p.username)}</option>`
  ).join('');
  if (prev && list.some(p => String(p.id) === String(prev))) sel.value = prev;
}

$('#submitReportBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser) return;
  const msgEl = $('#reportMessage');
  const details = ($('#reportDetails')?.value || '').trim();
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.color = '#fca5a5';
  }

  let targetId = null;
  let targetName = null;
  let bugTitle = null;

  if (reportType === 'player') {
    const selId = $('#reportPlayerSelect')?.value || '';
    const manual = ($('#reportPlayerManual')?.value || '').trim();
    if (!selId && !manual) {
      if (msgEl) msgEl.textContent = 'Select a player or enter their username.';
      return;
    }
    if (selId) {
      targetId = selId;
      const found = reportPlayersCache.find(p => String(p.id) === String(selId));
      targetName = found?.username || manual || 'Unknown player';
    } else {
      targetName = manual;
      const found = reportPlayersCache.find(p => p.username.toLowerCase() === manual.toLowerCase());
      if (found) {
        targetId = found.id;
        targetName = found.username;
      }
    }
  } else {
    bugTitle = ($('#reportBugTitle')?.value || '').trim();
    if (!bugTitle) {
      if (msgEl) msgEl.textContent = 'Enter a short bug or exploit title.';
      $('#reportBugTitle')?.focus();
      return;
    }
  }

  if (!details) {
    if (msgEl) msgEl.textContent = 'Please describe the issue in Details.';
    $('#reportDetails')?.focus();
    return;
  }

  const btn = $('#submitReportBtn');
  if (btn) btn.disabled = true;

  const payload = {
    id: 'rep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    type: reportType,
    target_id: targetId,
    target_name: targetName,
    title: bugTitle,
    details,
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__REPORT__:' + JSON.stringify(payload),
    status: 'denied'
  });

  if (btn) btn.disabled = false;
  if (error) {
    if (msgEl) msgEl.textContent = error.message;
    return;
  }

  if ($('#reportPlayerSelect')) $('#reportPlayerSelect').value = '';
  if ($('#reportPlayerManual')) $('#reportPlayerManual').value = '';
  if ($('#reportBugTitle')) $('#reportBugTitle').value = '';
  if ($('#reportDetails')) $('#reportDetails').value = '';
  if (msgEl) {
    msgEl.style.color = '#34d399';
    msgEl.textContent = 'Report sent to Dompinator notifications!';
  }
  toast('Report sent to Dompinator!');
});

// ---------- NOTIFICATIONS (ALL USERS + DOMPINATOR INBOX) ----------
let notifReportsCache = [];
let notifReportFilter = 'all';
let userNotifsCache = [];
let userNotifFilter = 'all';

function getUserNotifSeenTs() {
  if (!currentUser) return 0;
  return Number(localStorage.getItem('grind_notif_seen_' + currentUser.id) || 0);
}

function markAllUserNotifsRead(latestTs = Date.now()) {
  if (!currentUser) return;
  const val = Math.max(Date.now(), Number(latestTs || 0));
  localStorage.setItem('grind_notif_seen_' + currentUser.id, String(val));
  renderUserNotifsList();
  updateNotificationsBadge();
}

$('#markNotifsReadBtn')?.addEventListener('click', () => {
  markAllUserNotifsRead(Date.now());
  toast('Notifications marked as read');
});

function setNotificationsBadgeCount(total) {
  const badge = $('#navNotificationsBadge');
  if (!badge) return;
  if (currentUser && total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function fetchUserNotifications() {
  if (!sb || !currentUser) return [];
  const uid = String(currentUser.id);
  await fetchAdminModerationState();
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const delCoins = adminModStateCache.deletedCoinIds || new Set();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  const [updatesList, coinsRes, cmtRes] = await Promise.all([
    fetchActiveUpdates(),
    sb.from('coins').select('id, name, ticker, creator_id, created_at').limit(500),
    sb.from('premium_requests')
      .select('user_id, reason, created_at, profiles(id, username, avatar_url, is_premium)')
      .like('reason', '__CMT_%')
      .order('created_at', { ascending: true })
      .limit(1000)
  ]);

  const items = [];

  // 1. Update notifications (including checkboxes from Dompinator updates!)
  (updatesList || []).forEach(u => {
    const ts = Number(u.ts || 0);
    items.push({
      id: 'upd_' + u.id,
      category: 'update',
      ts,
      title: u.title || 'Update Notification',
      body: u.body || '',
      boxes: Array.isArray(u.boxes) ? u.boxes : [],
      isUpdate: true
    });
  });

  // 2. Warnings to current user
  const myWarns = adminModStateCache.warnings?.get(uid) || [];
  myWarns.forEach((w, idx) => {
    items.push({
      id: 'warn_' + w.ts + '_' + idx,
      category: 'warning',
      ts: Number(w.ts || 0),
      title: 'Warning from Admin',
      body: w.msg || 'Please follow the rules.'
    });
  });

  // 3 & 4. Comments on user's coins + Replies to user's comments
  const activeCoinsMap = new Map();
  (coinsRes?.data || []).forEach(c => {
    const cid = String(c.id);
    if (delCoins.has(cid) || (c.creator_id && delUsers.has(String(c.creator_id)))) return;
    const cts = c.created_at ? new Date(c.created_at).getTime() : 0;
    if (srvResetTs > 0 && cts > 0 && cts <= srvResetTs) return;
    activeCoinsMap.set(cid, c);
  });

  const allComments = new Map();
  const deletedCmtIds = new Set();
  (cmtRes?.data || []).forEach(r => {
    const reason = String(r.reason || '');
    const rowTs = r.created_at ? new Date(r.created_at).getTime() : 0;
    if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
    if (reason.startsWith('__CMT_ADD__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_ADD__:'.length));
        if (!p || !p.id || !p.coin_id || !p.text) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        allComments.set(String(p.id), {
          id: String(p.id),
          coinId: String(p.coin_id),
          userId: String(r.user_id),
          parentId: p.parent_id ? String(p.parent_id) : null,
          replyToUserId: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
          text: String(p.text),
          ts,
          profile: r.profiles || { id: r.user_id, username: 'Trader' }
        });
      } catch (e) {}
    } else if (reason.startsWith('__CMT_DEL__:')) {
      try {
        const p = JSON.parse(reason.slice('__CMT_DEL__:'.length));
        if (p?.comment_id) deletedCmtIds.add(String(p.comment_id));
      } catch (e) {}
    }
  });

  allComments.forEach(cm => {
    if (deletedCmtIds.has(cm.id) || delUsers.has(cm.userId)) return;
    if (cm.userId === uid) return;
    const coinObj = activeCoinsMap.get(cm.coinId);
    if (!coinObj) return;

    const parentCm = cm.parentId ? allComments.get(cm.parentId) : null;
    if (cm.parentId && (!parentCm || deletedCmtIds.has(parentCm.id))) return;

    const isReplyToMe = Boolean(
      cm.parentId && (parentCm?.userId === uid || cm.replyToUserId === uid)
    );
    const isCommentOnMyCoin = String(coinObj.creator_id || '') === uid;

    if (isReplyToMe) {
      items.push({
        id: 'rep_' + cm.id,
        category: 'reply',
        ts: cm.ts,
        coin: coinObj,
        authorId: cm.userId,
        authorProfile: { id: cm.userId, ...cm.profile },
        authorName: cm.profile?.username || 'Trader',
        body: cm.text,
        parentSnippet: parentCm?.text || ''
      });
    } else if (isCommentOnMyCoin && !cm.parentId) {
      items.push({
        id: 'cmt_' + cm.id,
        category: 'comment',
        ts: cm.ts,
        coin: coinObj,
        authorId: cm.userId,
        authorProfile: { id: cm.userId, ...cm.profile },
        authorName: cm.profile?.username || 'Trader',
        body: cm.text
      });
    }
  });

  items.sort((a, b) => b.ts - a.ts);
  return items;
}

async function fetchReportsAndPending() {
  if (!sb || !isDompinator()) return { reports: [], pendingRequests: [] };
  await fetchAdminModerationState();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  const [{ data: pendingRaw }, { data: reportRaw }, { data: doneRaw }] = await Promise.all([
    sb.from('premium_requests')
      .select('*, profiles(username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    sb.from('premium_requests')
      .select('id, user_id, reason, created_at, profiles(username, avatar_url, is_premium)')
      .like('reason', '__REPORT__:%')
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('premium_requests')
      .select('reason, profiles(username)')
      .like('reason', '__REPORT_DONE__:%')
      .limit(500)
  ]);

  const doneIds = new Set();
  (doneRaw || []).forEach(r => {
    if ((r.profiles?.username || '').toLowerCase() !== 'dompinator') return;
    const rid = String(r.reason || '').slice('__REPORT_DONE__:'.length).trim();
    if (rid) doneIds.add(rid);
  });

  const pendingRequests = (pendingRaw || []).filter(r =>
    !String(r.reason || '').startsWith('__') && !delUsers.has(String(r.user_id))
  );

  const reports = [];
  (reportRaw || []).forEach(r => {
    try {
      const parsed = JSON.parse(String(r.reason || '').slice('__REPORT__:'.length));
      if (!parsed || !parsed.id || doneIds.has(String(parsed.id))) return;
      reports.push({
        rowId: r.id,
        id: String(parsed.id),
        type: parsed.type === 'bug' ? 'bug' : 'player',
        targetId: parsed.target_id || null,
        targetName: parsed.target_name || null,
        title: parsed.title || null,
        details: parsed.details || '',
        ts: Number(parsed.ts) || (r.created_at ? new Date(r.created_at).getTime() : Date.now()),
        reporterId: r.user_id,
        reporterName: r.profiles?.username || 'Unknown',
        reporterProfile: { id: r.user_id, ...(r.profiles || {}) }
      });
    } catch (e) {}
  });

  reports.sort((a, b) => b.ts - a.ts);
  return { reports, pendingRequests };
}

async function updateNotificationsBadge() {
  if (!sb || !currentUser) return;
  try {
    const seenTs = getUserNotifSeenTs();
    const userItems = await fetchUserNotifications();
    const unreadUserCount = userItems.filter(it => Number(it.ts || 0) > seenTs).length;
    if (isDompinator()) {
      const { reports, pendingRequests } = await fetchReportsAndPending();
      setNotificationsBadgeCount(unreadUserCount + reports.length + pendingRequests.length);
    } else {
      setNotificationsBadgeCount(unreadUserCount);
    }
  } catch (e) {}
}

async function resolveReport(reportId) {
  if (!sb || !currentUser || !isDompinator() || !reportId) return;
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__REPORT_DONE__:' + reportId,
    status: 'denied'
  });
  if (error) {
    toast('Failed to resolve report: ' + error.message);
    return;
  }
  toast('Report marked as resolved');
  await loadRequests();
}

function renderUserNotifsList() {
  const listEl = $('#userNotifsList');
  const emptyEl = $('#emptyUserNotifs');
  if (!listEl || !emptyEl) return;

  const seenTs = getUserNotifSeenTs();
  const filtered = userNotifsCache.filter(it => {
    if (userNotifFilter === 'update') return it.category === 'update';
    if (userNotifFilter === 'warning') return it.category === 'warning';
    if (userNotifFilter === 'social') return it.category === 'comment' || it.category === 'reply';
    return true;
  });

  emptyEl.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 80).map(it => {
    const isUnread = Number(it.ts || 0) > seenTs;
    let tagCls = 'update';
    let tagText = 'Update';
    let headHtml = '';
    let bodyHtml = '';
    let actionHtml = '';

    if (it.category === 'update') {
      tagCls = 'update';
      tagText = 'Update';
      headHtml = `<strong>${formatUpdateTextWithTos(it.title, false)}</strong>`;
      const boxes = Array.isArray(it.boxes) ? it.boxes : [];
      const boxesHtml = boxes.length
        ? `<div class="notif-update-boxes">${boxes.map(b => `
            <div class="notif-update-box-row">
              <div class="notif-update-box-left">
                <span class="notif-update-box-check">☑</span>
                <span>${formatUpdateTextWithTos(b.text || '', false)}</span>
              </div>
              <span class="check-tag ${b.required ? 'req' : 'opt'}">${b.required ? 'Required' : 'Optional'}</span>
            </div>
          `).join('')}</div>`
        : '';
      bodyHtml = `
        ${it.body ? `<div class="report-details-box">${formatUpdateTextWithTos(it.body, true)}</div>` : ''}
        ${boxesHtml}
      `;
    } else if (it.category === 'warning') {
      tagCls = 'warning';
      tagText = 'Warning';
      headHtml = `<strong style="color:#fbbf24;">Official Account Warning</strong>`;
      bodyHtml = `<div class="warn-message-box">${escapeHtml(it.body).replace(/\n/g, '<br>')}</div>`;
    } else if (it.category === 'comment') {
      tagCls = 'comment';
      tagText = 'Coin Comment';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">commented on your coin</span> <span class="live-coin-chip" data-notif-coin="${escapeHtml(it.coin.id)}">${escapeHtml(it.coin.name)} ($${escapeHtml(it.coin.ticker)})</span>`;
      bodyHtml = `<div class="report-details-box">${escapeHtml(it.body).replace(/\n/g, '<br>')}</div>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-coin="${escapeHtml(it.coin.id)}">Open currency</button></div>`;
    } else if (it.category === 'reply') {
      tagCls = 'reply';
      tagText = 'Reply';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">replied to your comment on</span> <span class="live-coin-chip" data-notif-coin="${escapeHtml(it.coin.id)}">${escapeHtml(it.coin.name)} ($${escapeHtml(it.coin.ticker)})</span>`;
      bodyHtml = `<div class="report-details-box">${escapeHtml(it.body).replace(/\n/g, '<br>')}</div>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-coin="${escapeHtml(it.coin.id)}">View reply</button></div>`;
    }

    return `
      <div class="user-notif-card ${isUnread ? 'unread' : ''}">
        <div class="report-card-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${isUnread ? '<span class="unread-dot" title="Unread"></span>' : ''}
            <span class="notif-tag ${tagCls}">${tagText}</span>
          </div>
          <span class="muted tiny">${escapeHtml(formatRelativeTime(it.ts))}</span>
        </div>
        <div class="report-target-line">${headHtml}</div>
        ${bodyHtml}
        ${actionHtml}
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('[data-profile]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.profile) openProfileModal(el.dataset.profile);
    });
  });
  listEl.querySelectorAll('[data-notif-coin]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.notifCoin) openCoin(el.dataset.notifCoin);
    });
  });
}

function renderReportsList() {
  const listEl = $('#reportsList');
  const emptyEl = $('#emptyReports');
  if (!listEl || !emptyEl) return;

  const filtered = notifReportsCache.filter(r => {
    if (notifReportFilter === 'player') return r.type === 'player';
    if (notifReportFilter === 'bug') return r.type === 'bug';
    return true;
  });

  emptyEl.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = filtered.map(r => {
    const isPlayer = r.type === 'player';
    const subjectLine = isPlayer
      ? `Reported player: <strong${r.targetId ? ` class="profile-link" data-profile="${escapeHtml(r.targetId)}"` : ''}>${escapeHtml(r.targetName || 'Unknown')}</strong>`
      : `Bug / Exploit: <strong>${escapeHtml(r.title || 'Bug Report')}</strong>`;
    return `
      <div class="report-card">
        <div class="report-card-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="report-tag ${isPlayer ? 'player' : 'bug'}">${isPlayer ? 'Player Report' : 'Bug / Exploit'}</span>
            <span class="muted tiny">from <strong class="profile-link" data-profile="${escapeHtml(r.reporterId)}">${escapeHtml(r.reporterName)}${tierBadgeHtml(r.reporterProfile)}</strong></span>
          </div>
          <span class="muted tiny">${escapeHtml(formatRelativeTime(r.ts))}</span>
        </div>
        <div class="report-target-line">${subjectLine}</div>
        <div class="report-details-box">${escapeHtml(r.details).replace(/\n/g, '<br>')}</div>
        <div class="request-actions">
          ${isPlayer && r.targetId ? `<button type="button" class="warn-btn" data-inspect-user="${escapeHtml(r.targetId)}">Moderate / View Profile</button>` : ''}
          <button type="button" class="resolve-btn" data-resolve-report="${escapeHtml(r.id)}">Resolve</button>
        </div>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('[data-profile]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.profile) openProfileModal(el.dataset.profile);
    });
  });
  listEl.querySelectorAll('[data-inspect-user]').forEach(btn => {
    btn.addEventListener('click', () => openProfileModal(btn.dataset.inspectUser));
  });
  listEl.querySelectorAll('[data-resolve-report]').forEach(btn => {
    btn.addEventListener('click', () => resolveReport(btn.dataset.resolveReport));
  });
}

async function loadRequests() {
  if (!sb || !currentUser) return;
  const adminWrap = $('#dompinatorNotifsSection');
  const eyebrow = $('#notificationsEyebrow');
  const sub = $('#notificationsSubtitle');
  if (isDompinator()) {
    adminWrap?.classList.remove('hidden');
    if (eyebrow) eyebrow.textContent = 'INBOX & ADMIN';
    if (sub) sub.textContent = 'Updates, warnings, coin comments, replies, player/bug reports, and premium requests.';
  } else {
    adminWrap?.classList.add('hidden');
    if (eyebrow) eyebrow.textContent = 'INBOX';
    if (sub) sub.textContent = 'Updates, warnings, comments on your coins, and replies to your comments.';
  }

  userNotifsCache = await fetchUserNotifications();
  renderUserNotifsList();

  if (isDompinator()) {
    const { reports, pendingRequests } = await fetchReportsAndPending();
    notifReportsCache = reports;
    renderReportsList();

    $('#requestsList').innerHTML = pendingRequests.map(r => `
      <div class="request-card">
        <h4 class="profile-link" data-profile="${escapeHtml(r.user_id)}">${escapeHtml(r.profiles?.username || 'Unknown')}</h4>
        <p>${escapeHtml(r.reason)}</p>
        <div class="request-actions">
          <button class="approve-btn" data-id="${r.id}" data-user="${r.user_id}">Approve</button>
          <button class="deny-btn" data-id="${r.id}">Deny</button>
        </div>
      </div>
    `).join('');
    $('#emptyRequests').classList.toggle('hidden', pendingRequests.length > 0);
    $('#requestsList').querySelectorAll('[data-profile]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.profile) openProfileModal(el.dataset.profile);
      });
    });
    $$('.approve-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, b.dataset.user, 'approved')));
    $$('.deny-btn').forEach(b => b.addEventListener('click', () => handleRequest(b.dataset.id, null, 'denied')));
  }

  updateNotificationsBadge();
}

let draftUpdateBoxes = [];

function getDraftUpdateData() {
  const title = $('#updateTitleInput')?.value.trim() || '';
  const body = $('#updateBodyInput')?.value.trim() || '';
  const boxes = draftUpdateBoxes
    .map(b => ({ text: (b.text || '').trim(), required: Boolean(b.required) }))
    .filter(b => b.text.length > 0);
  return { title, body, boxes };
}

function renderUpdateLivePreview() {
  const titleEl = $('#updatePreviewTitle');
  const bodyEl = $('#updatePreviewBody');
  const boxesEl = $('#updatePreviewBoxes');
  const hintEl = $('#updatePreviewHint');
  const btn = $('#updatePreviewContinueBtn');
  if (!titleEl || !bodyEl || !boxesEl) return;

  const title = $('#updateTitleInput')?.value.trim() || '';
  const body = $('#updateBodyInput')?.value.trim() || '';
  const draftBoxes = draftUpdateBoxes.map((b, i) => ({
    text: (b.text || '').trim() || `Checkbox ${i + 1}`,
    required: Boolean(b.required)
  }));

  titleEl.innerHTML = formatUpdateTextWithTos(title || 'Update Notification', false);
  bodyEl.innerHTML = body
    ? formatUpdateTextWithTos(body, true)
    : '<span class="muted">Your update message will appear here as you type...</span>';

  const prevChecked = new Map();
  $$('#updatePreviewBoxes .update-preview-box-input').forEach(inp => {
    prevChecked.set(inp.dataset.idx, inp.checked);
  });

  if (draftBoxes.length) {
    boxesEl.innerHTML = draftBoxes.map((b, i) => `
      <label class="update-check-item">
        <input type="checkbox" class="update-preview-box-input" data-idx="${i}" data-req="${b.required ? '1' : '0'}" ${prevChecked.get(String(i)) ? 'checked' : ''}>
        <span class="update-check-text">${formatUpdateTextWithTos(b.text, false)}</span>
        <span class="check-tag ${b.required ? 'req' : 'opt'}">${b.required ? 'Required' : 'Optional'}</span>
      </label>
    `).join('');
  } else {
    boxesEl.innerHTML = '<p class="muted tiny" style="margin:0;">Checkboxes you add will appear here.</p>';
  }

  const hasReq = draftBoxes.some(b => b.required);
  const syncPreviewBtn = () => {
    const reqInputs = $$('#updatePreviewBoxes .update-preview-box-input[data-req="1"]');
    const allReqChecked = reqInputs.every(inp => inp.checked);
    if (btn) btn.disabled = !allReqChecked;
    if (hintEl) {
      hintEl.textContent = hasReq && !allReqChecked
        ? 'Check all required boxes above to continue using GRIND.'
        : '';
    }
  };
  $$('#updatePreviewBoxes .update-preview-box-input').forEach(inp => inp.addEventListener('change', syncPreviewBtn));
  syncPreviewBtn();
}

$('#updateTitleInput')?.addEventListener('input', renderUpdateLivePreview);
$('#updateBodyInput')?.addEventListener('input', renderUpdateLivePreview);
$('#updatePreviewContinueBtn')?.addEventListener('click', () => {
  if ($('#updatePreviewContinueBtn')?.disabled) return;
  toast('Preview: user can continue!');
});

$('#testUpdatePopupBtn')?.addEventListener('click', () => {
  if (!isDompinator()) return;
  const { title, body, boxes } = getDraftUpdateData();
  isPreviewUpdateModal = true;
  renderUpdateModalContent({
    id: 'preview',
    title: title || 'Update Notification',
    body: body || 'Preview message...',
    boxes
  }, true);
});

function renderUpdateCheckboxesBuilder() {
  const wrap = $('#updateCheckboxesBuilder');
  if (!wrap) return;
  if (!draftUpdateBoxes.length) {
    wrap.innerHTML = '<p class="muted tiny" style="margin:0;">No checkboxes added yet. Click "+ Add checkbox" to add optional or required checkboxes.</p>';
    renderUpdateLivePreview();
    return;
  }
  wrap.innerHTML = draftUpdateBoxes.map((b, i) => `
    <div class="update-builder-row" data-box-idx="${i}">
      <input type="text" class="box-text-input" data-idx="${i}" maxlength="160" placeholder="Checkbox text..." value="${escapeHtml(b.text)}">
      <label class="req-toggle">
        <input type="checkbox" class="box-req-input" data-idx="${i}" ${b.required ? 'checked' : ''}>
        <span>${b.required ? 'Required' : 'Optional'}</span>
      </label>
      <button type="button" class="zoom-btn box-remove-btn" data-idx="${i}" title="Remove checkbox">✕</button>
    </div>
  `).join('');

  $$('#updateCheckboxesBuilder .box-text-input').forEach(inp => {
    inp.addEventListener('input', e => {
      const idx = Number(inp.dataset.idx);
      if (draftUpdateBoxes[idx]) draftUpdateBoxes[idx].text = e.target.value;
      renderUpdateLivePreview();
    });
  });
  $$('#updateCheckboxesBuilder .box-req-input').forEach(chk => {
    chk.addEventListener('change', () => {
      const idx = Number(chk.dataset.idx);
      if (draftUpdateBoxes[idx]) {
        draftUpdateBoxes[idx].required = chk.checked;
        const lbl = chk.parentElement?.querySelector('span');
        if (lbl) lbl.textContent = chk.checked ? 'Required' : 'Optional';
      }
      renderUpdateLivePreview();
    });
  });
  $$('#updateCheckboxesBuilder .box-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      draftUpdateBoxes.splice(idx, 1);
      renderUpdateCheckboxesBuilder();
    });
  });
  renderUpdateLivePreview();
}

$('#addUpdateCheckboxBtn')?.addEventListener('click', () => {
  draftUpdateBoxes.push({ text: '', required: false });
  renderUpdateCheckboxesBuilder();
  const inputs = $$('#updateCheckboxesBuilder .box-text-input');
  inputs[inputs.length - 1]?.focus();
});

$('#publishUpdateBtn')?.addEventListener('click', async () => {
  if (!isDompinator() || !currentUser || !sb) return;
  const title = $('#updateTitleInput')?.value.trim() || '';
  const body = $('#updateBodyInput')?.value.trim() || '';
  const boxes = draftUpdateBoxes
    .map(b => ({ text: (b.text || '').trim(), required: Boolean(b.required) }))
    .filter(b => b.text.length > 0);
  const msgEl = $('#updatePostMessage');

  if (!title && !body && !boxes.length) {
    if (msgEl) msgEl.textContent = 'Add a title, message, or at least one checkbox.';
    return;
  }
  if (msgEl) msgEl.textContent = '';

  const btn = $('#publishUpdateBtn');
  if (btn) btn.disabled = true;

  const upd = {
    id: 'upd_' + Date.now(),
    ts: Date.now(),
    title: title || 'Update Notification',
    body,
    boxes
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__UPDATE_POST__:' + JSON.stringify(upd),
    status: 'denied'
  });

  if (btn) btn.disabled = false;
  if (error) {
    if (msgEl) msgEl.textContent = 'Error posting update: ' + error.message;
    return;
  }

  if ($('#updateTitleInput')) $('#updateTitleInput').value = '';
  if ($('#updateBodyInput')) $('#updateBodyInput').value = '';
  draftUpdateBoxes = [];
  renderUpdateCheckboxesBuilder();
  toast('Update notification published!');
  loadAdminUpdatesList();
  checkPendingUpdateNotifications();
});

async function loadAdminUpdatesList() {
  const listEl = $('#adminUpdatesList');
  if (!listEl || !isDompinator()) return;
  const posts = (await fetchActiveUpdates()).slice().reverse();
  if (!posts.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No active update notifications.</p></div>';
    return;
  }
  listEl.innerHTML = posts.map(u => {
    const boxes = Array.isArray(u.boxes) ? u.boxes : [];
    return `
    <div class="request-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
        <div>
          <h4 style="margin:0 0 4px;">${formatUpdateTextWithTos(u.title || 'Update', false)}</h4>
          <div class="muted tiny">${u.ts ? new Date(u.ts).toLocaleString() : ''}</div>
        </div>
        <button type="button" class="ban-btn" data-del-upd="${escapeHtml(u.id)}">Remove</button>
      </div>
      ${u.body ? `<p style="margin:10px 0 8px;">${formatUpdateTextWithTos(u.body, true)}</p>` : ''}
      ${boxes.length ? `
        <div class="update-check-list" style="margin-top:8px;">
          ${boxes.map(b => `
            <div class="update-check-item" style="cursor:default;">
              <span class="update-check-text">☐ ${formatUpdateTextWithTos(b.text, false)}</span>
              <span class="check-tag ${b.required ? 'req' : 'opt'}">${b.required ? 'Required' : 'Optional'}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
  }).join('');

  $$('#adminUpdatesList [data-del-upd]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!isDompinator() || !currentUser || !sb) return;
      const updId = btn.dataset.delUpd;
      btn.disabled = true;
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__UPDATE_DEL__:' + updId,
        status: 'denied'
      });
      toast('Update notification removed');
      loadAdminUpdatesList();
      checkPendingUpdateNotifications();
    });
  });
}

function openServerResetModal() {
  if (!isDompinator()) return;
  $('#serverResetModal')?.classList.remove('hidden');
}
function closeServerResetModal() {
  $('#serverResetModal')?.classList.add('hidden');
}
$('#openServerResetBtn')?.addEventListener('click', openServerResetModal);
$('#closeServerResetBtn')?.addEventListener('click', closeServerResetModal);
$('#cancelServerResetBtn')?.addEventListener('click', closeServerResetModal);
$('#serverResetModal')?.addEventListener('click', e => {
  if (e.target === $('#serverResetModal')) closeServerResetModal();
});

$('#confirmServerResetBtn')?.addEventListener('click', async () => {
  if (!isDompinator() || !currentUser || !sb) return;
  const btn = $('#confirmServerResetBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Resetting...';
  }

  const ts = Date.now();
  const { error: cmdErr } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__SERVER_RESET__:' + JSON.stringify({ ts }),
    status: 'denied'
  });
  if (cmdErr) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Yes, Reset Servers';
    }
    toast('Server reset failed: ' + cmdErr.message);
    return;
  }

  // Attempt full DB cleanup (RLS-permitting; self-reset & filters backstop any RLS-protected rows)
  try {
    const { data: allCoins } = await sb.from('coins').select('id');
    const coinIds = (allCoins || []).map(c => c.id).filter(Boolean);
    await sb.from('holdings').delete().not('user_id', 'is', null);
    await sb.from('trades').delete().not('coin_id', 'is', null);
    if (coinIds.length) {
      await sb.from('coins').delete().in('id', coinIds);
    }
  } catch (e) {}

  try {
    await sb.from('premium_requests').update({ status: 'denied' }).eq('status', 'approved');
    await sb.from('profiles').update({ cash: 15, net_worth: 15, is_premium: false, time_played: 0 }).neq('id', currentUser.id);
    await sb.from('profiles').update({ cash: 15, net_worth: 15, time_played: 0 }).eq('id', currentUser.id);
  } catch (e) {}

  const uid = currentUser.id;
  currentUser.cash = 15;
  currentUser.net_worth = 15;
  currentUser.is_pro = false;
  currentUser.time_played = 0;
  coins = [];
  selectedCoin = null;
  proUserIds = new Set();
  watchlistIds = new Set();
  localStorage.removeItem('grind_pro_' + uid);
  localStorage.removeItem('grind_daily_' + uid);
  localStorage.removeItem('grind_watchlist_' + uid);
  localStorage.removeItem('grind_watchlist_ts_' + uid);
  localStorage.setItem('grind_reset_done_' + uid, String(ts));

  try {
    await sb.from('premium_requests').insert({
      user_id: uid,
      reason: '__RESET_DONE__:' + ts,
      status: 'denied'
    });
  } catch (e) {}

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Yes, Reset Servers';
  }
  closeServerResetModal();
  updateUIProfile();
  await loadCoins();
  renderFeed();
  loadAdminAccounts();
  toast('Servers reset! All coins cleared & all accounts reset to $15.00.');
});

function loadAdminPage() {
  if ($('#adminCurrentSeasonNum')) {
    $('#adminCurrentSeasonNum').textContent = String(passState.season || 1);
  }
  renderUpdateCheckboxesBuilder();
  loadAdminUpdatesList();
  loadAdminAccounts();
}

$('#adminNextSeasonBtn')?.addEventListener('click', async () => {
  if (!isDompinator() || !currentUser || !sb) return;
  const btn = $('#adminNextSeasonBtn');
  if (!btn) return;
  const nextSeason = Number(passState.season || 1) + 1;
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = `Confirm Season ${nextSeason}?`;
    setTimeout(() => {
      if (btn.isConnected && btn.dataset.armed === '1') {
        btn.dataset.armed = '0';
        btn.textContent = 'Start Next Season';
      }
    }, 3500);
    return;
  }
  btn.dataset.armed = '0';
  btn.disabled = true;
  btn.textContent = 'Starting...';
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PASS_SEASON__:' + JSON.stringify({ season: nextSeason, ts: Date.now() }),
    status: 'denied'
  });
  btn.disabled = false;
  btn.textContent = 'Start Next Season';
  if (error) {
    toast('Error starting next season: ' + error.message);
    return;
  }
  await loadPassState();
  if ($('#adminCurrentSeasonNum')) $('#adminCurrentSeasonNum').textContent = String(passState.season);
  toast(`Season ${passState.season} started! Pass Play Time reset (Leaderboard untouched).`);
});

async function loadAdminAccounts() {
  if (!sb || !isDompinator()) return;
  await Promise.all([loadProUserIds(), fetchAdminModerationState()]);
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const { data } = await sb
    .from('profiles')
    .select('id, username, avatar_url, cash, net_worth, is_premium, time_played')
    .order('net_worth', { ascending: false })
    .limit(200);
  adminAccountsCache = (data || [])
    .filter(p => !delUsers.has(String(p.id)))
    .map(getEffectiveProfileStats)
    .sort((a, b) => Number(b.net_worth || 0) - Number(a.net_worth || 0));
  renderAdminAccounts();
}

async function removePremiumFromUser(userId, username = 'user') {
  if (!sb || !isDompinator() || !userId) return false;
  await loadProUserIds();
  const ok = await sendAdminCommand('remove_premium', userId, 'Premium removed by Dompinator');
  if (!ok) return false;

  try {
    await sb.from('premium_requests')
      .update({ status: 'denied' })
      .eq('user_id', userId)
      .eq('status', 'approved')
      .neq('reason', '__PRO_TIER__');
  } catch (e) {}
  try {
    await sb.from('profiles').update({ is_premium: false }).eq('id', userId);
  } catch (e) {}

  adminModStateCache.premiumOverrides?.set(String(userId), { removed: true, granted: false, ts: Date.now() });
  const fallbackTier = proUserIds.has(String(userId)) ? 'PRO' : 'Member';
  toast(`Removed Premium from ${username} — reverted to ${fallbackTier}`);

  if (currentPage === 'admin') await loadAdminAccounts();
  if (currentPage === 'global') renderLeaderboard();
  if (currentPage === 'feed') renderFeed();
  if (selectedCoin && currentPage === 'coin') renderCoinDetail();
  return true;
}

function renderAdminAccounts() {
  const listEl = $('#adminAccountsList');
  if (!listEl) return;
  const q = adminAccountQuery.trim().toLowerCase();
  const filtered = adminAccountsCache.filter(p =>
    p.id !== currentUser?.id &&
    (!q || (p.username || '').toLowerCase().includes(q))
  );
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:20px;"><p>No matching accounts.</p></div>';
    return;
  }
  listEl.innerHTML = filtered.map(p => {
    const isBanned = Boolean(adminModStateCache.bans.get(p.id)?.banned);
    const isPrem = isEffectivePremium(p);
    return `
    <div class="lb-row admin-acc-row">
      <div class="avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div class="lb-info">
        <strong class="profile-link" data-profile="${escapeHtml(p.id)}">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}${isBanned ? '<span class="banned-tag">BANNED</span>' : ''}</strong>
        <div class="muted tiny">Tier: ${escapeHtml(tierLabel(p))} · Cash ${money(p.cash || 0)} · Net Worth ${money(p.net_worth || 0)}</div>
      </div>
      <div class="admin-acc-actions">
        <button type="button" class="warn-btn" data-acc-manage="${escapeHtml(p.id)}">Warn</button>
        ${isPrem ? `<button type="button" class="remove-prem-btn" data-acc-remprem="${escapeHtml(p.id)}" data-acc-name="${escapeHtml(p.username || 'user')}">Remove Premium</button>` : ''}
        <button type="button" class="reset-btn" data-acc-reset="${escapeHtml(p.id)}" data-acc-name="${escapeHtml(p.username || 'user')}">Reset</button>
        <button type="button" class="${isBanned ? 'unban-btn' : 'ban-btn'}" data-acc-ban="${escapeHtml(p.id)}" data-acc-banned="${isBanned ? '1' : '0'}" data-acc-name="${escapeHtml(p.username || 'user')}">${isBanned ? 'Unban' : 'Ban'}</button>
        <button type="button" class="delete-acc-btn" data-acc-del="${escapeHtml(p.id)}" data-acc-name="${escapeHtml(p.username || 'user')}">Delete</button>
      </div>
    </div>`;
  }).join('');

  $$('#adminAccountsList [data-profile], #adminAccountsList [data-acc-manage]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.profile || el.dataset.accManage;
      openProfileModal(id);
    });
  });

  $$('#adminAccountsList [data-acc-remprem]').forEach(btn => {
    btn.addEventListener('click', () => {
      removePremiumFromUser(btn.dataset.accRemprem, btn.dataset.accName || 'user');
    });
  });

  $$('#adminAccountsList [data-acc-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = 'Confirm?';
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            btn.dataset.armed = '0';
            btn.textContent = 'Reset';
          }
        }, 3500);
        return;
      }
      const ok = await sendAdminCommand('reset', btn.dataset.accReset, 'Reset by administrator');
      if (ok) {
        toast(`Account reset for ${btn.dataset.accName}`);
        loadAdminAccounts();
      }
    });
  });

  $$('#adminAccountsList [data-acc-ban]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const currentlyBanned = btn.dataset.accBanned === '1';
      if (!currentlyBanned) {
        openProfileModal(btn.dataset.accBan);
        return;
      }
      const ok = await sendAdminCommand('unban', btn.dataset.accBan, '');
      if (ok) {
        toast(`Unbanned ${btn.dataset.accName}`);
        loadAdminAccounts();
      }
    });
  });

  $$('#adminAccountsList [data-acc-del]').forEach(btn => {
    btn.addEventListener('click', () => {
      openDeleteAccountModal(btn.dataset.accDel, btn.dataset.accName || 'user', false);
    });
  });
}

let pendingDeleteAccountTarget = null;

function openDeleteAccountModal(userId, username, isSelf = false) {
  if (!userId) return;
  if (isSelf && isDompinator()) {
    toast('Admin account cannot self-delete.');
    return;
  }
  pendingDeleteAccountTarget = { userId: String(userId), username: String(username || 'user'), isSelf: Boolean(isSelf) };
  const msgEl = $('#deleteAccountMessage');
  if (msgEl) {
    msgEl.innerHTML = isSelf
      ? `Are you sure you want to <strong>permanently delete your own account</strong> (<strong>${escapeHtml(username)}</strong>)? Your profile, holdings, coins, and comments will be permanently removed and cannot be recovered.`
      : `Are you sure you want to <strong>permanently delete ${escapeHtml(username)}</strong>? Their profile, holdings, coins, and comments will be permanently deleted and they will be blocked from signing back in.`;
  }
  $('#deleteAccountModal')?.classList.remove('hidden');
}

function closeDeleteAccountModal() {
  pendingDeleteAccountTarget = null;
  $('#deleteAccountModal')?.classList.add('hidden');
}

$('#closeDeleteAccountBtn')?.addEventListener('click', closeDeleteAccountModal);
$('#cancelDeleteAccountBtn')?.addEventListener('click', closeDeleteAccountModal);
$('#deleteAccountModal')?.addEventListener('click', e => {
  if (e.target === $('#deleteAccountModal')) closeDeleteAccountModal();
});
$('#deleteOwnAccountBtn')?.addEventListener('click', () => {
  if (!currentUser) return;
  openDeleteAccountModal(currentUser.id, currentUser.username || 'your account', true);
});

$('#confirmDeleteAccountBtn')?.addEventListener('click', async () => {
  if (!pendingDeleteAccountTarget || !currentUser || !sb) return;
  const { userId, username, isSelf } = pendingDeleteAccountTarget;
  const btn = $('#confirmDeleteAccountBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting...';
  }

  if (isSelf) {
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__ACCOUNT_DELETED__',
      status: 'denied'
    });
    try { await sb.from('holdings').delete().eq('user_id', currentUser.id); } catch (e) {}
    try { await sb.from('trades').delete().eq('user_id', currentUser.id); } catch (e) {}
    try { await sb.from('coins').delete().eq('creator_id', currentUser.id); } catch (e) {}
    try { await sb.from('profiles').delete().eq('id', currentUser.id); } catch (e) {}
    clearLocalUserState(currentUser.id);
    if (timeInterval) clearInterval(timeInterval);
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    try { await sb.auth.signOut(); } catch (e) {}
    currentUser = null;
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Yes, Permanently Delete';
    }
    closeDeleteAccountModal();
    $('#appView')?.classList.add('hidden');
    $('#authView')?.classList.remove('hidden');
    setAuthMode('login');
    authMsg('Your account has been permanently deleted.');
    return;
  }

  if (!isDompinator()) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Yes, Permanently Delete';
    }
    closeDeleteAccountModal();
    return;
  }

  const ok = await sendAdminCommand('delete', userId, 'Permanently deleted by administrator');
  if (!ok) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Yes, Permanently Delete';
    }
    return;
  }

  adminModStateCache.deletedUserIds?.add(String(userId));

  // Best-effort full SQL removal of coins, holdings, trades, requests, and profile
  try {
    const { data: userCoins } = await sb.from('coins').select('id').eq('creator_id', userId);
    for (const uc of (userCoins || [])) {
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__COIN_DEL__:' + uc.id,
        status: 'denied'
      });
      adminModStateCache.deletedCoinIds?.add(String(uc.id));
      await sb.from('holdings').delete().eq('coin_id', uc.id);
      await sb.from('trades').delete().eq('coin_id', uc.id);
      await sb.from('coins').delete().eq('id', uc.id);
    }
    await sb.from('holdings').delete().eq('user_id', userId);
    await sb.from('trades').delete().eq('user_id', userId);
    await sb.from('premium_requests').delete().eq('user_id', userId);
    await sb.from('profiles').delete().eq('id', userId);
  } catch (e) {
    console.warn('Direct account delete cleanup note:', e);
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Yes, Permanently Delete';
  }
  closeDeleteAccountModal();
  $('#profileModal')?.classList.add('hidden');
  toast(`Permanently deleted account: ${username}`);
  await loadCoins();
  if (currentPage === 'admin') loadAdminAccounts();
  if (currentPage === 'global') renderLeaderboard();
  if (currentPage === 'feed') renderFeed();
});

$('#adminAccountSearch')?.addEventListener('input', e => {
  adminAccountQuery = e.target.value || '';
  renderAdminAccounts();
});

async function handleRequest(reqId, userId, status) {
  if (!sb) return;
  const { error: rErr } = await sb.from('premium_requests').update({ status }).eq('id', reqId);
  if (rErr) {
    toast('Request update error: ' + rErr.message);
    return;
  }
  if (status === 'approved' && userId) {
    await sendAdminCommand('grant_premium', userId, 'Approved Premium');
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
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => {
      loadCoins();
      if (currentPage === 'live') loadLiveFeed();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      loadCoins();
      if (selectedCoin && currentPage === 'coin') renderCoinDetail();
      if (currentPage === 'live') loadLiveFeed();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'premium_requests' }, () => {
      if (currentUser) loadProfile();
      if (selectedCoin && currentPage === 'coin') loadCoinComments(selectedCoin);
      if (currentPage === 'feed') fetchFeaturedCoins().then(() => renderFeaturedSection());
      if (currentPage === 'live') loadLiveFeed();
      if (currentPage === 'pass') loadPassState().then(() => renderPassPage());
      if (currentPage === 'notifications') loadRequests();
      else if (currentUser) updateNotificationsBadge();
      if (isDompinator() && currentPage === 'admin') loadAdminPage();
    })
    .subscribe();
}

$('#backToFeed')?.addEventListener('click', () => showPage('feed'));

// ============================================================
// ---------- BATTLE PASS (SEASON 1 · 20 LEVELS · 5m STEP) ----
// ============================================================
async function fetchActivePassSeason() {
  if (!sb) return 1;
  try {
    const { data } = await sb.from('premium_requests')
      .select('reason, created_at, profiles(username)')
      .like('reason', '__PASS_SEASON__:%')
      .order('created_at', { ascending: false })
      .limit(20);
    const valid = (data || []).find(r => (r.profiles?.username || '').toLowerCase() === 'dompinator');
    if (valid?.reason) {
      const parsed = JSON.parse(String(valid.reason).slice('__PASS_SEASON__:'.length));
      const num = Number(parsed?.season || 1);
      if (num >= 1) return num;
    }
  } catch (e) {}
  return 1;
}

function getEffectivePassSeconds() {
  const base = Number(passState.seconds || 0);
  const unsynced = sessionStart ? Math.max(0, Math.floor((Date.now() - lastPassRemoteSyncAt) / 1000)) : 0;
  return base + Math.min(unsynced, 35);
}

function formatPassClock(totalSecs) {
  const s = Math.max(0, Math.floor(totalSecs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${m}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

function updatePassNavBadge() {
  const badge = $('#navPassBadge');
  if (!badge) return;
  if (!currentUser) {
    badge.classList.add('hidden');
    return;
  }
  const secs = getEffectivePassSeconds();
  const unclaimed = PASS_REWARDS.filter(r =>
    secs >= r.tier * PASS_STEP_SECONDS && !passState.claimedTiers.has(r.tier)
  ).length;
  if (unclaimed > 0) {
    badge.textContent = String(unclaimed);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

async function syncPassTimeToRemote(force = false) {
  if (!sb || !currentUser) return;
  const season = passState.season || 1;
  const key = `grind_pass_sec_s${season}_${currentUser.id}`;
  try { localStorage.setItem(key, String(passState.seconds)); } catch (e) {}
  const now = Date.now();
  if (!force && now - lastPassRemoteSyncAt < 55000) return;
  lastPassRemoteSyncAt = now;
  try {
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: `__PASS_TIME__:${season}:${passState.seconds}:${now}`,
      status: 'denied'
    });
  } catch (e) {}
}

async function incrementPassTime(addSecs, forceSync = false) {
  if (!currentUser || addSecs <= 0) return;
  passState.seconds = Math.max(0, Number(passState.seconds || 0) + Number(addSecs));
  lastPassRemoteSyncAt = Date.now();
  const key = `grind_pass_sec_s${passState.season || 1}_${currentUser.id}`;
  try { localStorage.setItem(key, String(passState.seconds)); } catch (e) {}
  await syncPassTimeToRemote(forceSync);
  updatePassNavBadge();
  if (currentPage === 'pass') renderPassPage();
}

async function loadPassState() {
  if (!currentUser || !sb) return;
  const uid = currentUser.id;
  const season = await fetchActivePassSeason();
  const localKeySec = `grind_pass_sec_s${season}_${uid}`;
  const localKeyClaims = `grind_pass_claims_s${season}_${uid}`;

  let maxSecs = Number(localStorage.getItem(localKeySec) || 0) || 0;
  const claimed = new Set();
  try {
    const arr = JSON.parse(localStorage.getItem(localKeyClaims) || '[]');
    if (Array.isArray(arr)) arr.forEach(t => claimed.add(Number(t)));
  } catch (e) {}
  let livePostUsed = localStorage.getItem(`grind_pass_livepost_s${season}_${uid}`) === '1';

  try {
    const [{ data: timeRows }, { data: claimRows }, { data: postRows }] = await Promise.all([
      sb.from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', `__PASS_TIME__:${season}:%`)
        .order('created_at', { ascending: false })
        .limit(5),
      sb.from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', `__PASS_CLAIM__:${season}:%`)
        .limit(40),
      sb.from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', '__LIVE_POST__:%')
        .limit(30)
    ]);

    (timeRows || []).forEach(r => {
      const parts = String(r.reason || '').split(':');
      const sVal = Number(parts[2] || 0);
      if (sVal > maxSecs) maxSecs = sVal;
    });
    (claimRows || []).forEach(r => {
      const parts = String(r.reason || '').split(':');
      const tVal = Number(parts[2] || 0);
      if (tVal >= 1 && tVal <= 20) claimed.add(tVal);
    });
    (postRows || []).forEach(r => {
      try {
        const parsed = JSON.parse(String(r.reason).slice('__LIVE_POST__:'.length));
        if (Number(parsed?.season || 1) === season) livePostUsed = true;
      } catch (e) {}
    });
  } catch (e) {}

  passState = { season, seconds: maxSecs, claimedTiers: claimed, livePostUsed };
  try {
    localStorage.setItem(localKeySec, String(maxSecs));
    localStorage.setItem(localKeyClaims, JSON.stringify([...claimed]));
    if (livePostUsed) localStorage.setItem(`grind_pass_livepost_s${season}_${uid}`, '1');
  } catch (e) {}
  updatePassNavBadge();
}

function updatePassLiveClock() {
  if (!currentUser) return;
  const secs = getEffectivePassSeconds();
  const clockEl = $('#passPlayTimeValue');
  if (clockEl) clockEl.textContent = formatPassClock(secs);
  const maxSecs = PASS_REWARDS.length * PASS_STEP_SECONDS;
  const unlockedLv = Math.min(PASS_REWARDS.length, Math.floor(secs / PASS_STEP_SECONDS));
  const nextEl = $('#passNextLevelText');
  const lvlEl = $('#passLevelText');
  const fillEl = $('#passProgressFill');
  if (lvlEl) lvlEl.textContent = `Level ${unlockedLv} / ${PASS_REWARDS.length}`;
  if (fillEl) fillEl.style.width = `${Math.min(100, (secs / maxSecs) * 100).toFixed(1)}%`;
  if (nextEl) {
    if (unlockedLv >= PASS_REWARDS.length) {
      nextEl.textContent = `Season ${passState.season} complete!`;
    } else {
      const nextTierSecs = (unlockedLv + 1) * PASS_STEP_SECONDS;
      const remain = Math.max(0, nextTierSecs - secs);
      const rm = Math.floor(remain / 60);
      const rs = remain % 60;
      nextEl.textContent = `Level ${unlockedLv + 1} unlocks in ${rm}m ${String(rs).padStart(2, '0')}s`;
    }
  }
}

function renderPassPage() {
  if (!currentUser) return;
  const season = passState.season || 1;
  if ($('#passSeasonEyebrow')) $('#passSeasonEyebrow').textContent = `SEASON ${season} BATTLE PASS`;
  if ($('#passSeasonTitleNum')) $('#passSeasonTitleNum').textContent = String(season);
  if ($('#pageTitle') && currentPage === 'pass') $('#pageTitle').textContent = `Season ${season} Pass`;

  updatePassLiveClock();
  const secs = getEffectivePassSeconds();

  // Tier 10 Coin Live Post Composer
  const livePostCard = $('#passLivePostCard');
  if (livePostCard) {
    const hasTier10Claimed = passState.claimedTiers.has(10);
    livePostCard.classList.toggle('hidden', !hasTier10Claimed);
    if (hasTier10Claimed) {
      const sel = $('#passLivePostCoin');
      const sendBtn = $('#sendPassLivePostBtn');
      const statusEl = $('#passLivePostStatus');
      const subEl = $('#passLivePostSubtitle');
      if (sel) {
        const prev = sel.value;
        sel.innerHTML = `<option value="">Select a coin...</option>` + coins.map(c =>
          `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} ($${escapeHtml(c.ticker)}) — ${priceFmt(c.price)}</option>`
        ).join('');
        if (prev && coins.some(c => String(c.id) === String(prev))) sel.value = prev;
      }
      if (passState.livePostUsed) {
        if (sendBtn) sendBtn.disabled = true;
        if (sendBtn) sendBtn.textContent = 'Posted to LIVE ✓';
        if (statusEl) statusEl.textContent = `Season ${season} Coin Live Post used`;
        if (subEl) subEl.textContent = `You already broadcast your Season ${season} Coin Live Post in LIVE.`;
      } else {
        if (sendBtn) sendBtn.disabled = false;
        if (sendBtn) sendBtn.textContent = 'Post Coin to LIVE';
        if (statusEl) statusEl.textContent = '1 Coin Live Post available';
        if (subEl) subEl.textContent = 'Pick a coin and write a message for everyone to see in the LIVE Activity feed.';
      }
    }
  }

  const grid = $('#passTiersGrid');
  if (!grid) return;
  grid.innerHTML = PASS_REWARDS.map(r => {
    const reqSecs = r.tier * PASS_STEP_SECONDS;
    const isUnlocked = secs >= reqSecs;
    const isClaimed = passState.claimedTiers.has(r.tier);
    const isSpecial = r.type !== 'cash';
    const cardCls = [
      'pass-tier-card',
      isClaimed ? 'claimed' : (isUnlocked ? 'unlocked' : ''),
      isSpecial ? 'special' : ''
    ].filter(Boolean).join(' ');

    let btnText = `Locked (${r.minutes}m)`;
    let btnCls = 'pass-claim-btn';
    let disabledAttr = 'disabled';
    if (isClaimed) {
      btnText = 'Claimed ✓';
      btnCls = 'pass-claim-btn claimed';
    } else if (isUnlocked) {
      btnText = r.type === 'pro' ? 'Claim Free PRO' : (r.type === 'coin_live_post' ? 'Unlock Live Post' : `Claim ${r.title}`);
      btnCls = 'pass-claim-btn ready';
      disabledAttr = '';
    }

    return `
      <div class="${cardCls}">
        <div>
          <div class="pass-tier-top">
            <span class="pass-tier-num">Level ${r.tier}</span>
            <span class="pass-tier-req">${r.minutes}m</span>
          </div>
          <div class="pass-tier-reward">${escapeHtml(r.title)}</div>
          <div class="pass-tier-desc">${escapeHtml(r.desc)}</div>
        </div>
        <button type="button" class="${btnCls}" data-pass-claim="${r.tier}" ${disabledAttr}>${escapeHtml(btnText)}</button>
      </div>
    `;
  }).join('');

  $$('#passTiersGrid [data-pass-claim]').forEach(btn => {
    btn.addEventListener('click', () => claimPassReward(Number(btn.dataset.passClaim)));
  });
}

async function claimPassReward(tier) {
  if (!currentUser || !sb) return;
  const reward = PASS_REWARDS.find(r => r.tier === tier);
  if (!reward) return;
  const secs = getEffectivePassSeconds();
  if (secs < reward.tier * PASS_STEP_SECONDS || passState.claimedTiers.has(tier)) return;

  const btn = $(`#passTiersGrid [data-pass-claim="${tier}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claiming...';
  }

  const season = passState.season || 1;
  if (reward.type === 'cash') {
    const newCash = Number(currentUser.cash || 0) + Number(reward.amount);
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
    if (error) {
      toast('Pass reward error: ' + error.message);
      renderPassPage();
      return;
    }
    currentUser.cash = newCash;
    await updateNetWorth();
    toast(`Pass Level ${tier} claimed: +${money(reward.amount)}!`);
  } else if (reward.type === 'pro') {
    if (!currentUser.is_pro) {
      const { error } = await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__PRO_TIER__',
        status: 'approved'
      });
      if (error) {
        toast('Error unlocking PRO: ' + error.message);
        renderPassPage();
        return;
      }
    }
    localStorage.setItem('grind_pro_' + currentUser.id, '1');
    currentUser.is_pro = true;
    proUserIds.add(currentUser.id);
    toast('Pass Level 20 claimed! Free PRO tier unlocked!');
  } else if (reward.type === 'coin_live_post') {
    toast('Level 10 Coin Live Post unlocked! Choose your coin & message above.');
  }

  passState.claimedTiers.add(tier);
  try {
    localStorage.setItem(`grind_pass_claims_s${season}_${currentUser.id}`, JSON.stringify([...passState.claimedTiers]));
  } catch (e) {}

  await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: `__PASS_CLAIM__:${season}:${tier}`,
    status: 'denied'
  });

  await syncPassTimeToRemote(true);
  updateUIProfile();
  renderPassPage();
}

$('#sendPassLivePostBtn')?.addEventListener('click', async () => {
  if (!currentUser || !sb || !passState.claimedTiers.has(10) || passState.livePostUsed) return;
  const coinId = $('#passLivePostCoin')?.value || '';
  const message = ($('#passLivePostMsg')?.value || '').trim();
  if (!coinId) return toast('Choose a coin first.');
  if (!message) return toast('Write a message to show in LIVE.');

  const coinObj = coins.find(c => String(c.id) === String(coinId));
  if (!coinObj) return toast('Selected coin not found.');

  const btn = $('#sendPassLivePostBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Posting...';
  }

  const season = passState.season || 1;
  const payload = {
    id: 'lp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    season,
    coin_id: String(coinObj.id),
    coin_name: coinObj.name,
    coin_ticker: coinObj.ticker,
    coin_image: coinObj.image_url || null,
    message,
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__LIVE_POST__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Post Coin to LIVE';
    }
    toast('Error posting to LIVE: ' + error.message);
    return;
  }

  passState.livePostUsed = true;
  try { localStorage.setItem(`grind_pass_livepost_s${season}_${currentUser.id}`, '1'); } catch (e) {}
  if ($('#passLivePostMsg')) $('#passLivePostMsg').value = '';
  toast('Coin Live Post is now live for everyone!');
  renderPassPage();
});

// ============================================================
// ---------- GRIND-BOT (PRO+ AI STOCK TACTICS) ---------------
// ============================================================
function formatBotMessageHtml(rawText) {
  let html = escapeHtml(rawText || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

function buildGrindBotMarketContext() {
  const tier = tierLabel(currentUser);
  const cashStr = money(currentUser?.cash || 0);
  const nwStr = money(currentUser?.net_worth || currentUser?.cash || 0);
  const trending = [...coins]
    .sort((a, b) => (b.recent_buys_24h || 0) - (a.recent_buys_24h || 0))
    .slice(0, 5)
    .map(c => `${c.name} ($${c.ticker}): price=${priceFmt(c.price)}, today=${Number(c.change_pct || 0).toFixed(2)}%, 24h_buys=${c.recent_buys_24h || 0}`)
    .join('; ');
  const cheapest = [...coins]
    .sort((a, b) => Number(a.price) - Number(b.price))
    .slice(0, 4)
    .map(c => `$${c.ticker}@${priceFmt(c.price)}`)
    .join(', ');
  return `Trader: ${currentUser?.username || 'Trader'} | Tier: ${tier} | Cash: ${cashStr} | Net Worth: ${nwStr} | Active Coins: ${coins.length} | Top Trending: ${trending || 'none yet'} | Cheapest: ${cheapest || 'none yet'}`;
}

function renderGrindBotMessages() {
  const listEl = $('#grindBotMessages');
  if (!listEl) return;
  if (!grindBotHistory.length) {
    grindBotHistory = [
      {
        role: 'model',
        text: `Welcome to **GRIND-BOT**! I specialize strictly in **GRIND stock & market tactics** — curve sizing, spotting momentum, partial selling (1/4, 1/2, 3/4, All), and growing your Net Worth.\n\nAsk me anything about trading strategy inside GRIND!`
      }
    ];
  }
  listEl.innerHTML = grindBotHistory.map(m => `
    <div class="grindbot-msg ${m.role === 'user' ? 'user' : 'bot'}">
      <div class="grindbot-msg-label">${m.role === 'user' ? escapeHtml(currentUser?.username || 'You') : '⌘ GRIND-BOT'}</div>
      <div>${m.role === 'user' ? escapeHtml(m.text).replace(/\n/g, '<br>') : formatBotMessageHtml(m.text)}</div>
    </div>
  `).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function renderGrindBotPage() {
  if (!currentUser) return;
  const hasPro = getUserTier(currentUser) === 'pro' || getUserTier(currentUser) === 'premium';
  $('#grindBotLocked')?.classList.toggle('hidden', hasPro);
  $('#grindBotApp')?.classList.toggle('hidden', !hasPro);
  if (hasPro) renderGrindBotMessages();
}

async function sendGrindBotPrompt(text) {
  if (!currentUser || grindBotSending) return;
  const hasPro = getUserTier(currentUser) === 'pro' || getUserTier(currentUser) === 'premium';
  if (!hasPro) {
    toast('GRIND-BOT requires PRO or Premium tier.');
    return;
  }
  const clean = String(text || '').trim();
  if (!clean) return;

  const historyToSend = grindBotHistory.slice(-10);
  grindBotHistory.push({ role: 'user', text: clean });
  grindBotHistory.push({ role: 'model', text: 'Analyzing GRIND market tactics...' });
  grindBotSending = true;
  if ($('#grindBotInput')) $('#grindBotInput').value = '';
  if ($('#grindBotSendBtn')) $('#grindBotSendBtn').disabled = true;
  renderGrindBotMessages();

  try {
    const res = await fetch('/api/grind-bot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: clean,
        history: historyToSend,
        marketContext: buildGrindBotMarketContext(),
        isProOrHigher: true
      })
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('GRIND-BOT backend endpoint is unavailable on static hosting.');
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to reach GRIND-BOT.');
    }
    grindBotHistory[grindBotHistory.length - 1] = {
      role: 'model',
      text: data.reply || 'Ask me about GRIND trading tactics!'
    };
  } catch (err) {
    grindBotHistory[grindBotHistory.length - 1] = {
      role: 'model',
      text: `Unable to reach GRIND-BOT right now: ${err?.message || 'Connection error'}.`
    };
  } finally {
    grindBotSending = false;
    if ($('#grindBotSendBtn')) $('#grindBotSendBtn').disabled = false;
    renderGrindBotMessages();
  }
}

$('#grindBotForm')?.addEventListener('submit', e => {
  e.preventDefault();
  sendGrindBotPrompt($('#grindBotInput')?.value || '');
});

$$('#grindBotQuickPrompts [data-gb-prompt]').forEach(btn => {
  btn.addEventListener('click', () => {
    sendGrindBotPrompt(btn.dataset.gbPrompt || '');
  });
});

$('#grindBotClearBtn')?.addEventListener('click', () => {
  grindBotHistory = [];
  renderGrindBotMessages();
});

$('#grindBotOpenDailyBtn')?.addEventListener('click', () => checkDailyLogin(true));

// ---------- Init ----------
(async () => {
  if (!sb) {
    authMsg('Failed to connect to Supabase. Replace the API key in app.js with your real anon key.');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await loadProfile();
    if (!currentUser?.is_banned) enterApp();
  } else {
    setAuthMode('login');
  }
})();
