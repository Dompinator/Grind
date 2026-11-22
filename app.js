// ============================================================
// GRIND v0.7 — Multiplayer · Premium · English
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
let lbWeeklySort = 'up';
let pendingCoinImage = null;
let realtimeChannel = null;
let sessionStart = null;
let timeInterval = null;
let chartZoom = 1.0;
let currentPage = 'feed';
let adsCache = null;
let adsCacheTime = 0;
let musicCache = null;
let musicCacheTime = 0;
let lastAdName = null;
let feedSearchQuery = '';
let proUserIds = new Set();
let watchlistIds = new Set();
let dailyStateCache = null;
let lastCoinsDateKey = '';
let tradeInFlight = false;
let featuredCoinIdsCache = [];
let passTickerInterval = null;
let lastPassRemoteSyncAt = 0;
let passState = { season: 1, seconds: 0, claimedTiers: new Set(), claimedProTiers: new Set(), livePostsUsed: 0 };
let passScrollInitDone = false;
let grindBotHistory = [];
let grindBotSending = false;

// ---------- Egress Reduction: Shared Profile & Coin Image Caches ----------
const PROFILES_CACHE_LS_KEY = 'grind_profiles_cache_v1';
const COIN_IMAGES_CACHE_LS_KEY = 'grind_coin_imgs_v1';
const PLAY_CACHE_LS_KEY = 'grind_play_cache_v2';
const SHARED_PROFILE_TTL_MS = 10 * 60 * 1000;
const sharedProfilesCache = new Map();
const sharedCoinImagesCache = new Map();
let sharedProfilesLastBulkFetchAt = 0;
let sharedProfilesBulkPromise = null;
let sharedProfilesPersistTimer = null;
let sharedCoinImagesPersistTimer = null;
let proUserIdsFetchedAt = 0;
let proUserIdsPromise = null;
let featuredCoinsFetchedAt = 0;
let featuredCoinsPromise = null;
let coinsTradeStatsCache = null;
let coinsTradeStatsFetchedAt = 0;
let coinsTradeStatsDirty = true;

(function hydrateSharedCachesFromStorage() {
  try {
    const rawProf = localStorage.getItem(PROFILES_CACHE_LS_KEY);
    if (rawProf) {
      const parsed = JSON.parse(rawProf);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.bulkAt === 'number') sharedProfilesLastBulkFetchAt = parsed.bulkAt;
        if (Array.isArray(parsed.entries)) {
          parsed.entries.forEach(p => {
            if (p && p.id) sharedProfilesCache.set(String(p.id), p);
          });
        }
      }
    }
  } catch (e) {}
  try {
    const rawImgs = localStorage.getItem(COIN_IMAGES_CACHE_LS_KEY);
    if (rawImgs) {
      const parsed = JSON.parse(rawImgs);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([cid, url]) => {
          sharedCoinImagesCache.set(String(cid), url || null);
        });
      }
    }
  } catch (e) {}
})();

function schedulePersistSharedProfiles() {
  if (sharedProfilesPersistTimer) return;
  sharedProfilesPersistTimer = setTimeout(() => {
    sharedProfilesPersistTimer = null;
    try {
      const entries = Array.from(sharedProfilesCache.values())
        .sort((a, b) => (b._cachedAt || 0) - (a._cachedAt || 0))
        .slice(0, 120);
      localStorage.setItem(PROFILES_CACHE_LS_KEY, JSON.stringify({
        bulkAt: sharedProfilesLastBulkFetchAt,
        entries
      }));
    } catch (e) {}
  }, 500);
}

function schedulePersistCoinImages() {
  if (sharedCoinImagesPersistTimer) return;
  sharedCoinImagesPersistTimer = setTimeout(() => {
    sharedCoinImagesPersistTimer = null;
    try {
      const obj = {};
      const entries = Array.from(sharedCoinImagesCache.entries()).slice(-120);
      entries.forEach(([k, v]) => { obj[k] = v || null; });
      localStorage.setItem(COIN_IMAGES_CACHE_LS_KEY, JSON.stringify(obj));
    } catch (e) {}
  }, 500);
}

function saveSharedProfileToCache(p) {
  if (!p || !p.id) return;
  const pid = String(p.id);
  const prev = sharedProfilesCache.get(pid) || {};
  const next = {
    id: pid,
    username: p.username || prev.username || 'Trader',
    avatar_url: p.avatar_url !== undefined ? p.avatar_url : (prev.avatar_url ?? null),
    is_premium: p.is_premium !== undefined ? Boolean(p.is_premium) : Boolean(prev.is_premium),
    _cachedAt: Date.now()
  };
  sharedProfilesCache.set(pid, next);
  schedulePersistSharedProfiles();
}

function saveSharedCoinImageToCache(coinId, imageUrl) {
  if (!coinId) return;
  sharedCoinImagesCache.set(String(coinId), imageUrl || null);
  schedulePersistCoinImages();
}

function getCachedProfile(userId, fallback = null) {
  const uid = String(userId || fallback?.id || '');
  if (!uid) return fallback || { id: '', username: 'Trader', avatar_url: null, is_premium: false };
  if (currentUser && String(currentUser.id) === uid) {
    return currentUser;
  }
  const cached = sharedProfilesCache.get(uid);
  if (!cached && !fallback) return { id: uid, username: 'Trader', avatar_url: null, is_premium: false };
  if (!cached) return { id: uid, username: 'Trader', avatar_url: null, ...fallback };
  if (!fallback) return cached;
  return {
    ...cached,
    ...fallback,
    id: uid,
    username: fallback.username || cached.username || 'Trader',
    avatar_url: fallback.avatar_url !== undefined ? fallback.avatar_url : (cached.avatar_url ?? null),
    is_premium: fallback.is_premium !== undefined ? fallback.is_premium : cached.is_premium
  };
}

async function ensureProfilesCached(userIds = [], forceBulk = false) {
  if (!sb) return;
  const now = Date.now();
  const ids = Array.isArray(userIds) ? [...new Set(userIds.map(x => String(x || '')).filter(Boolean))] : [];

  if (ids.length > 0) {
    const missing = ids.filter(uid => {
      if (currentUser && String(currentUser.id) === uid) return false;
      const c = sharedProfilesCache.get(uid);
      return !c || !c._cachedAt || (now - c._cachedAt > SHARED_PROFILE_TTL_MS);
    });
    if (!missing.length) return;
    for (let i = 0; i < missing.length; i += 60) {
      const batch = missing.slice(i, i + 60);
      try {
        const { data } = await sb
          .from('profiles')
          .select('id, username, avatar_url, is_premium')
          .in('id', batch);
        (data || []).forEach(saveSharedProfileToCache);
      } catch (e) {}
    }
    return;
  }

  if (sharedProfilesBulkPromise) return sharedProfilesBulkPromise;
  if (!forceBulk && sharedProfilesCache.size > 0 && (now - sharedProfilesLastBulkFetchAt) < 180000) {
    return;
  }
  sharedProfilesBulkPromise = (async () => {
    try {
      const { data } = await sb
        .from('profiles')
        .select('id, username, avatar_url, is_premium')
        .order('username', { ascending: true })
        .limit(250);
      (data || []).forEach(saveSharedProfileToCache);
      sharedProfilesLastBulkFetchAt = Date.now();
      schedulePersistSharedProfiles();
    } catch (e) {}
  })().finally(() => { sharedProfilesBulkPromise = null; });
  return sharedProfilesBulkPromise;
}

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
function getTierRank(tier) {
  if (tier === 'premium') return 2;
  if (tier === 'pro') return 1;
  return 0;
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

// Compress uploaded images tightly (128x128 @ 0.72 JPEG) to keep Supabase egress low
function compressImg(file, cb) {
  const r = new FileReader();
  r.onload = () => {
    const img = new Image();
    img.onload = () => {
      const max = 128;
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
      cb(canvas.toDataURL('image/jpeg', 0.72));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

// ---------- Auth (robust with Signup Email Code Verification) ----------
let pendingSignup = null;
let resendOtpInterval = null;

function setSignupVerifyUI(active, email = '') {
  const tabs = document.querySelector('.auth-tabs');
  const form = $('#authForm');
  const box = $('#signupVerifyBox');
  if (tabs) tabs.classList.toggle('hidden', active);
  if (form) form.classList.toggle('hidden', active);
  if (box) box.classList.toggle('hidden', !active);
  const disp = $('#verifyEmailDisplay');
  if (disp) disp.textContent = email || '';
  if (active) {
    const inp = $('#signupOtpCode');
    if (inp) {
      inp.value = '';
      setTimeout(() => inp.focus(), 50);
    }
  }
}

function startResendCooldown(seconds = 60) {
  if (resendOtpInterval) {
    clearInterval(resendOtpInterval);
    resendOtpInterval = null;
  }
  const btn = $('#resendOtpBtn');
  if (!btn) return;
  const targetTs = Date.now() + seconds * 1000;
  const tick = () => {
    const rem = Math.max(0, Math.ceil((targetTs - Date.now()) / 1000));
    if (rem > 0) {
      btn.disabled = true;
      btn.textContent = `Resend (${rem}s)`;
    } else {
      btn.disabled = false;
      btn.textContent = 'Resend code';
      if (resendOtpInterval) {
        clearInterval(resendOtpInterval);
        resendOtpInterval = null;
      }
    }
  };
  tick();
  resendOtpInterval = setInterval(tick, 1000);
}

function setAuthMode(mode) {
  pendingSignup = null;
  if (resendOtpInterval) {
    clearInterval(resendOtpInterval);
    resendOtpInterval = null;
  }
  setSignupVerifyUI(false);
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === mode));
  const btn = document.getElementById('authSubmit');
  if (btn) btn.textContent = mode === 'signup' ? 'Create account' : 'Log in';
  const pw = document.getElementById('authPassword');
  if (pw) pw.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  const msg = document.getElementById('authMessage');
  if (msg) {
    msg.textContent = '';
    msg.style.color = '';
  }
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

  const submitBtn = $('#authSubmit');
  if (mode === 'signup') {
    if (!password || password.length < 6) return authMsg('Password must be at least 6 characters.');
    const requiresEmailOtp = /\d/.test(email);
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = requiresEmailOtp ? 'Sending code...' : 'Creating account...';
    }
    try {
      // Prevent duplicate/OTP overwrite on emails that already have a GRIND account
      const { data: existingProf } = await sb.from('profiles').select('id').ilike('email', email).maybeSingle();
      if (existingProf) {
        authMsg('An account with this email already exists. Please log in instead.');
        return;
      }

      if (!requiresEmailOtp) {
        // Emails with no numbers skip email code confirmation and create directly
        const { data: suData, error: suErr } = await sb.auth.signUp({ email, password });
        if (suErr) {
          authMsg(/already registered/i.test(suErr.message || '')
            ? 'An account with this email already exists. Please log in instead.'
            : (suErr.message || 'Could not create account.'));
          return;
        }
        if (!suData?.session) {
          const { error: siErr } = await sb.auth.signInWithPassword({ email, password });
          if (siErr) {
            authMsg(siErr.message || 'Could not sign in after signup.');
            return;
          }
        }
        try {
          if (suData?.user?.id) localStorage.setItem('grind_tos_pending_' + suData.user.id, '1');
        } catch (err) {}
        authMsg('');
        await loadProfile();
        if (!currentUser?.is_banned) enterApp();
        return;
      }

      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      });
      if (error) {
        const emsg = /rate limit/i.test(error.message || '')
          ? 'Too many verification emails sent right now. Please wait a minute and try again.'
          : error.message;
        authMsg(emsg || 'Could not send verification email.');
        return;
      }

      pendingSignup = { email, password };
      try { sessionStorage.setItem('grind_pending_pw', JSON.stringify({ email, password })); } catch (err) {}
      setSignupVerifyUI(true, email);
      startResendCooldown(60);
      authMsg('Verification code sent! Check your email inbox (and spam).', '#34d399');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create account';
      }
    }
  } else {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return authMsg('Wrong email or password.');
    await loadProfile();
    if (!currentUser?.is_banned) enterApp();
  }
});

$('#signupVerifyForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!sb || !pendingSignup) return;
  const token = ($('#signupOtpCode')?.value || '').trim().replace(/[\s-]+/g, '');
  if (!token || token.length < 6) {
    return authMsg('Enter the verification code sent to your email.');
  }

  const btn = $('#verifyOtpBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Verifying...';
  }

  try {
    let { data: vData, error: vErr } = await sb.auth.verifyOtp({
      email: pendingSignup.email,
      token,
      type: 'email'
    });
    if (vErr) {
      const retry = await sb.auth.verifyOtp({
        email: pendingSignup.email,
        token,
        type: 'signup'
      });
      if (!retry.error) {
        vData = retry.data;
        vErr = null;
      }
    }
    if (vErr || !vData?.user) {
      authMsg(vErr?.message || 'Invalid or expired verification code. Try again or resend.');
      return;
    }

    const { error: pwErr } = await sb.auth.updateUser({ password: pendingSignup.password });
    if (pwErr) {
      console.warn('Password set note after OTP verify:', pwErr.message);
    }

    const uid = vData.user.id;
    try {
      localStorage.setItem('grind_tos_pending_' + uid, '1');
      sessionStorage.removeItem('grind_pending_pw');
    } catch (err) {}

    pendingSignup = null;
    if (resendOtpInterval) {
      clearInterval(resendOtpInterval);
      resendOtpInterval = null;
    }
    setSignupVerifyUI(false);
    authMsg('');

    await loadProfile();
    if (!currentUser?.is_banned) {
      enterApp();
      toast('Email verified! Welcome to GRIND.');
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Verify & Create Account';
    }
  }
});

$('#resendOtpBtn')?.addEventListener('click', async () => {
  if (!sb || !pendingSignup) return;
  const btn = $('#resendOtpBtn');
  if (btn && btn.disabled) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending...';
  }
  const { error } = await sb.auth.signInWithOtp({
    email: pendingSignup.email,
    options: { shouldCreateUser: true }
  });
  if (error) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Resend code';
    }
    authMsg(error.message || 'Could not resend code.');
    return;
  }
  startResendCooldown(60);
  authMsg('New verification code sent to ' + pendingSignup.email, '#34d399');
});

$('#cancelVerifyBtn')?.addEventListener('click', () => {
  try { sessionStorage.removeItem('grind_pending_pw'); } catch (e) {}
  setAuthMode('signup');
});

function authMsg(s, color = '') {
  const el = $('#authMessage');
  if (el) {
    el.style.color = color || '';
    el.textContent = s;
  }
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
  const prevMemTier = currentUser && currentUser.id === user.id ? getUserTier(currentUser) : null;
  currentUser = data;
  currentUser.auth_created_at = user.created_at || data.created_at || null;
  saveSharedProfileToCache(currentUser);

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
    detectAndTriggerTierPromotion(prevMemTier);
  }
}

let adminModStateCache = { bans: new Map(), resets: new Map(), warnings: new Map(), serverResetTs: 0, resetDoneMap: new Map(), deletedCoinIds: new Set(), deletedUserIds: new Set(), premiumOverrides: new Map(), selfSoldCoins: new Map() };
let pendingWarnAckTs = 0;
let adminModStateFetchedAt = 0;
let adminModStatePromise = null;
const ADMIN_MOD_STATE_TTL_MS = 120000;

async function _fetchAdminModerationStateFresh() {
  const bans = new Map();
  const resets = new Map();
  const warnings = new Map();
  const resetDoneMap = new Map();
  const deletedCoinIds = new Set();
  const deletedUserIds = new Set();
  const premiumOverrides = new Map();
  const selfSoldCoins = new Map();
  let serverResetTs = 0;
  if (!sb) return { bans, resets, warnings, serverResetTs, resetDoneMap, deletedCoinIds, deletedUserIds, premiumOverrides, selfSoldCoins };
  try {
    const [{ data }, { data: srvRows }, { data: doneRows }, { data: delCoinRows }, { data: selfDelRows }, { data: selfSoldRows }] = await Promise.all([
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
        .limit(500),
      sb.from('premium_requests')
        .select('user_id, reason, created_at')
        .like('reason', '__COIN_SELF_SELL__:%')
        .order('created_at', { ascending: true })
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
    (selfSoldRows || []).forEach(row => {
      try {
        const payload = JSON.parse(String(row.reason || '').slice('__COIN_SELF_SELL__:'.length));
        const coinId = String(payload?.coinId || '').trim();
        const creatorId = String(payload?.creatorId || '').trim();
        const ts = Number(payload?.ts) || (row.created_at ? new Date(row.created_at).getTime() : 0);
        if (!coinId || !creatorId || creatorId !== String(row.user_id)) return;
        if (serverResetTs > 0 && ts <= serverResetTs) return;
        deletedCoinIds.add(coinId);
        selfSoldCoins.set(coinId, {
          coinId,
          creatorId,
          coinName: String(payload?.coinName || ''),
          ticker: String(payload?.ticker || 'COIN'),
          priceAtDelete: Math.max(0.01, Number(payload?.priceAtDelete) || 1),
          ts
        });
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
  adminModStateCache = { bans, resets, warnings, serverResetTs, resetDoneMap, deletedCoinIds, deletedUserIds, premiumOverrides, selfSoldCoins };
  return adminModStateCache;
}

async function fetchAdminModerationState(force = false) {
  if (!sb) return adminModStateCache;
  if (adminModStatePromise) return adminModStatePromise;
  if (!force && adminModStateFetchedAt && Date.now() - adminModStateFetchedAt < ADMIN_MOD_STATE_TTL_MS) {
    return adminModStateCache;
  }
  adminModStatePromise = _fetchAdminModerationStateFresh()
    .then(result => {
      adminModStateFetchedAt = Date.now();
      return result;
    })
    .finally(() => { adminModStatePromise = null; });
  return adminModStatePromise;
}

function invalidateAdminModerationStateCache() {
  adminModStateFetchedAt = 0;
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
    'grind_tos_pending_', 'grind_tos_ack_',
    'grind_titles_owned_', 'grind_title_equipped_'
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

  // 4. Auto-sell 100% of any holdings on coins deleted by their creator
  await processSelfSoldCoinRefunds();

  // 5. Check Active Update Notifications
  await checkPendingUpdateNotifications();
}

let selfCoinRefundInFlight = false;
async function processSelfSoldCoinRefunds() {
  if (!sb || !currentUser?.id || selfCoinRefundInFlight) return;
  const selfSold = adminModStateCache.selfSoldCoins;
  if (!selfSold || selfSold.size === 0) return;

  selfCoinRefundInFlight = true;
  try {
    const uid = String(currentUser.id);
    const pendingEntries = [];
    for (const [coinId, info] of selfSold.entries()) {
      const localDone = localStorage.getItem(`grind_coin_refund_${coinId}_${uid}`) === '1';
      if (!localDone) pendingEntries.push(info);
    }
    if (!pendingEntries.length) return;

    const pendingIds = pendingEntries.map(e => String(e.coinId));
    const [{ data: doneRows }, { data: holds }, { data: coinOwners }] = await Promise.all([
      sb.from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', '__COIN_REFUND_DONE__:%')
        .limit(500),
      sb.from('holdings')
        .select('coin_id, shares')
        .eq('user_id', uid)
        .gt('shares', 0),
      sb.from('coins')
        .select('id, creator_id')
        .in('id', pendingIds)
    ]);

    const realCreatorMap = new Map();
    (coinOwners || []).forEach(co => realCreatorMap.set(String(co.id), String(co.creator_id || '')));

    const doneRemote = new Set(
      (doneRows || []).map(r => String(r.reason || '').slice('__COIN_REFUND_DONE__:'.length).trim()).filter(Boolean)
    );
    const holdMap = new Map();
    (holds || []).forEach(h => holdMap.set(String(h.coin_id), Number(h.shares || 0)));

    let totalRefunded = 0;
    const refundedTickers = [];

    for (const info of pendingEntries) {
      const cid = String(info.coinId);
      const realCreator = realCreatorMap.get(cid);
      if (realCreator && realCreator !== String(info.creatorId)) continue;
      if (doneRemote.has(cid)) {
        try { localStorage.setItem(`grind_coin_refund_${cid}_${uid}`, '1'); } catch (e) {}
        continue;
      }

      const shares = holdMap.get(cid) || 0;
      if (shares > 1e-8) {
        const proceeds = calcHoldingsValue(info.priceAtDelete, shares);
        totalRefunded += proceeds;
        refundedTickers.push(`$${info.ticker} (+${money(proceeds)})`);
        try {
          await sb.from('holdings').update({ shares: 0 }).eq('user_id', uid).eq('coin_id', cid);
          await sb.from('holdings').delete().eq('user_id', uid).eq('coin_id', cid);
        } catch (e) {}
        try {
          await sb.from('trades').insert({
            coin_id: cid,
            user_id: uid,
            type: 'sell',
            amount_usd: proceeds,
            shares,
            price_after: info.priceAtDelete
          });
        } catch (e) {}
        try {
          await sb.from('premium_requests').insert({
            user_id: uid,
            reason: '__COIN_REFUND_DONE__:' + cid,
            status: 'denied'
          });
        } catch (e) {}
      }
      try { localStorage.setItem(`grind_coin_refund_${cid}_${uid}`, '1'); } catch (e) {}
    }

    if (totalRefunded > 0) {
      const newCash = Math.round((Number(currentUser.cash || 0) + totalRefunded) * 100) / 100;
      currentUser.cash = newCash;
      try {
        await sb.from('profiles').update({ cash: newCash }).eq('id', uid);
      } catch (e) {}
      updateUIProfile();
      await updateNetWorth();
      playSound('sell');
      toast(`Creator deleted coin — auto-sold 100%: ${refundedTickers.join(', ')}`);
      if (selectedCoin && selfSold.has(String(selectedCoin.id)) && currentPage === 'coin') {
        selectedCoin = null;
        await loadCoins();
        showPage('feed');
      } else {
        await loadCoins();
        if (currentPage === 'money') renderMoney();
        if (currentPage === 'feed') renderFeed();
      }
    }
  } finally {
    selfCoinRefundInFlight = false;
  }
}

let activeUpdateQueue = [];
let currentUpdateModalItem = null;
let isPreviewUpdateModal = false;
let cachedTosText = null;

const FALLBACK_TOS_TEXT = `GRIND — TERMS OF SERVICE
Last Updated: November 17, 2026

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
- Usernames, profile pictures, coin names, tickers, descriptions, comments, and uploaded logos must not contain hate speech, harassment, illegal material, explicit/NSFW imagery, spam, or impersonation of administrators or other users.
- Do not attempt to harass, scam, or disrupt other players.

6. PLAY FEATURE & STRICT COPYRIGHT POLICY
- GRIND strictly does NOT allow copyrighted content to be uploaded, recorded, or shared on the PLAY feature.
- You may NOT upload copyrighted videos, movies, TV clips, copyrighted songs/audio tracks, copyrighted images, or any third-party intellectual property unless you own the rights or have explicit legal permission to upload it.
- Any Play Short, uploaded video, image, or voiceover/audio found to infringe copyright will be removed immediately, and the uploader may lose Play earnings and receive a warning, account reset, or permanent ban.

7. MODERATION & ENFORCEMENT
- Administrators (including Dompinator) reserve the right to monitor activity and take moderation action at their sole discretion to protect the market and community.
- Violations of these Terms may result in:
  * Official account warnings
  * Removal of unfairly gained cash, coins, Play videos, or coins created by the user
  * Full account reset
  * Temporary or permanent account ban

8. SERVICE CHANGES & AVAILABILITY
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
  applyUserTheme();
  renderThemeSettings();
  renderMusicSettings();
  if (typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
  if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
  if (currentPage === 'marketplace' && typeof renderMarketplacePage === 'function') renderMarketplacePage();
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
  if (typeof loadTitleSystemState === 'function') {
    loadTitleSystemState(true).then(() => {
      if (typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
      if (currentPage === 'marketplace' && typeof renderMarketplacePage === 'function') renderMarketplacePage();
      if (currentPage === 'global') renderLeaderboard();
    });
  }
  if (typeof loadPlayData === 'function') {
    loadPlayData(true).then(() => {
      if (typeof syncAllPlayEarnings === 'function') syncAllPlayEarnings();
      if (typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
      if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
    });
  }
  showPage('feed');
  startRealtime();
  loadCoins();
  if (notificationPollInterval) clearInterval(notificationPollInterval);
  updateNotificationsBadge();
  notificationPollInterval = setInterval(() => {
    if (currentUser && !document.hidden) updateNotificationsBadge();
  }, NOTIFICATION_SCAN_TTL_MS);
  startTimeTracking();
  checkDailyLogin();
  flushPendingTierPromo();
  if (typeof refreshDirectMessages === 'function') refreshDirectMessages(false);
  if (typeof loadTraderBattles === 'function') {
    loadTraderBattles(true).then(() => {
      if (typeof evaluateTraderBattles === 'function') evaluateTraderBattles();
    });
  }
}

function startTimeTracking() {
  sessionStart = Date.now();
  lastPassRemoteSyncAt = Date.now();
  if (timeInterval) clearInterval(timeInterval);
  if (passTickerInterval) clearInterval(passTickerInterval);
  timeInterval = setInterval(async () => {
    if (!currentUser || !sb || document.hidden) return;
    const add = 120; // seconds (2-min cadence cuts DB writes & broadcasts by 75%)
    const newTime = (currentUser.time_played || 0) + add;
    currentUser.time_played = newTime;
    await sb.from('profiles').update({ time_played: newTime }).eq('id', currentUser.id);
    incrementPassTime(add);
  }, 120000);
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
  if (notificationPollInterval) clearInterval(notificationPollInterval);
  notificationPollInterval = null;
  userNotificationsFetchedAt = 0;
  adminNotificationsFetchedAt = 0;
  userNotifsCache = [];
  adminNotificationsCache = { reports: [], pendingRequests: [] };
  grindBotHistory = [];
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  $('#appView').classList.add('hidden');
  delete document.body.dataset.theme;
  if (typeof stopPremiumAmbientMusic === 'function') stopPremiumAmbientMusic(true);
  $('#tosModal')?.classList.add('hidden');
  $('#updateModal')?.classList.add('hidden');
  $('#warnModal')?.classList.add('hidden');
  $('#dailyModal')?.classList.add('hidden');
  $('#profileModal')?.classList.add('hidden');
  $('#featuredEditModal')?.classList.add('hidden');
  $('#dmModal')?.classList.add('hidden');
  $('#playUploadChoiceModal')?.classList.add('hidden');
  $('#playCreatorModal')?.classList.add('hidden');
  $('#playVideoFileModal')?.classList.add('hidden');
  if (typeof cleanupPlay === 'function') cleanupPlay();
  if (typeof closeCoinWatchModal === 'function') closeCoinWatchModal(true);
  if (typeof resetDmStateOnLogout === 'function') resetDmStateOnLogout();
  if (typeof resetTraderBattleStateOnLogout === 'function') resetTraderBattleStateOnLogout();
  closeTierPromoOverlay(true);
  pendingTierPromo = null;
  $('#authView').classList.remove('hidden');
  setAuthMode('login');
});

// ---------- Navigation ----------
function showPage(page) {
  if (page === 'grindbot' && currentUser && getUserTier(currentUser) === 'member') {
    openProUpgradeModal();
    return;
  }
  const wasPlay = currentPage === 'play';
  if (wasPlay && page !== 'play' && typeof cleanupPlay === 'function') cleanupPlay();
  currentPage = page;
  $('#appView')?.classList.toggle('play-fullscreen', page === 'play');
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
    play: 'Play',
    grindbot: 'GRIND-BOT',
    pass: `Season ${passState.season || 1} Pass`,
    marketplace: 'Marketplace',
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
  if (page === 'play' && !wasPlay && typeof startPlayPage === 'function') startPlayPage();
  if (page === 'grindbot') renderGrindBotPage();
  if (page === 'marketplace' && typeof renderMarketplacePage === 'function') {
    loadTitleSystemState().then(() => renderMarketplacePage());
  }
  if (page === 'pass') {
    passScrollInitDone = false;
    loadPassState().then(() => renderPassPage(true));
  }
  if (page === 'account') {
    updatePremiumSection();
    renderThemeSettings();
    renderMusicSettings();
    if (typeof loadTitleSystemState === 'function') {
      loadTitleSystemState().then(() => {
        if (typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
      });
    }
    if (typeof loadPlayData === 'function') {
      loadPlayData().then(() => {
        if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
      });
    }
  }
  if (page === 'report') loadReportPage();
  if (page === 'notifications') loadRequests();
  if (page === 'admin' && isDompinator()) loadAdminPage();
  if (typeof syncPremiumAmbientMusic === 'function') syncPremiumAmbientMusic();
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
}
$$('.nav-btn').forEach(b => b.addEventListener('click', () => {
  if (!b.dataset.page) return;
  showPage(b.dataset.page);
}));
$('#navUploadBtn')?.addEventListener('click', () => {
  if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  openPlayUploadChoiceModal();
});
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
  if (b.dataset.lbWeekly) {
    b.addEventListener('click', () => {
      lbWeeklySort = b.dataset.lbWeekly === 'down' ? 'down' : 'up';
      $$('.feed-tab[data-lb-weekly]').forEach(x => x.classList.toggle('active', x === b));
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

async function loadProUserIds(force = false) {
  if (!sb) return;
  if (proUserIdsPromise) return proUserIdsPromise;
  if (!force && proUserIdsFetchedAt && (Date.now() - proUserIdsFetchedAt) < 60000) return;
  proUserIdsPromise = (async () => {
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
      proUserIdsFetchedAt = Date.now();
    } catch (e) {}
  })().finally(() => { proUserIdsPromise = null; });
  return proUserIdsPromise;
}

// ---------- Coins & Feed ----------
async function fetchFeaturedCoins(force = false) {
  if (!sb) return [];
  if (featuredCoinsPromise) return featuredCoinsPromise;
  if (!force && featuredCoinsFetchedAt && (Date.now() - featuredCoinsFetchedAt) < 60000) {
    return featuredCoinIdsCache;
  }
  featuredCoinsPromise = (async () => {
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
          featuredCoinsFetchedAt = Date.now();
          return featuredCoinIdsCache;
        }
      }
      featuredCoinIdsCache = [];
      featuredCoinsFetchedAt = Date.now();
    } catch (e) {}
    return featuredCoinIdsCache;
  })().finally(() => { featuredCoinsPromise = null; });
  return featuredCoinsPromise;
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
  featuredCoinsFetchedAt = Date.now();
  closeFeaturedEditModal();
  renderFeaturedSection();
  toast('Featured coins updated for everyone!');
});

let loadCoinsPromise = null;
let loadCoinsQueued = false;

async function loadCoins() {
  if (!sb) return;
  if (loadCoinsPromise) {
    loadCoinsQueued = true;
    return loadCoinsPromise;
  }
  loadCoinsPromise = (async () => {
    loadCoinsQueued = false;
    await _loadCoinsFresh();
    // At most one follow-up fetch for a burst of realtime events.
    if (loadCoinsQueued) {
      loadCoinsQueued = false;
      await _loadCoinsFresh();
    }
  })();
  try {
    await loadCoinsPromise;
  } finally {
    loadCoinsPromise = null;
  }
}

async function _loadCoinsFresh() {
  if (!sb) return;
  await Promise.all([loadProUserIds(), fetchAdminModerationState()]);
  await fetchFeaturedCoins();
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  let res = await sb
    .from('coins')
    .select('id, name, ticker, description, creator_id, price, change_pct, created_at')
    .order('created_at', { ascending: false });
  if (res.error) {
    res = await sb.from('coins').select('*').order('created_at', { ascending: false });
  }
  if (!res.error) {
    const delCoins = adminModStateCache.deletedCoinIds || new Set();
    const delUsers = adminModStateCache.deletedUserIds || new Set();
    const selfSoldCoins = adminModStateCache.selfSoldCoins || new Map();
    const list = (res.data || []).filter(c => {
      const selfSold = selfSoldCoins.get(String(c.id));
      if (selfSold && String(selfSold.creatorId) !== String(c.creator_id)) {
        // Ignore invalid tombstone not authored by coin creator
      } else if (delCoins.has(String(c.id))) {
        return false;
      }
      if (c.creator_id && delUsers.has(String(c.creator_id))) return false;
      if (!srvResetTs) return true;
      const cts = c.created_at ? new Date(c.created_at).getTime() : 0;
      return cts > srvResetTs;
    });

    // Seed image cache if fallback '*' query returned image_url, otherwise only fetch missing logos once
    const missingImgIds = [];
    list.forEach(c => {
      const cid = String(c.id);
      if (c.image_url !== undefined) {
        saveSharedCoinImageToCache(cid, c.image_url);
      } else if (!sharedCoinImagesCache.has(cid)) {
        missingImgIds.push(c.id);
      }
    });
    const creatorIds = list.map(c => c.creator_id).filter(Boolean);

    const fetchMissingImgsPromise = missingImgIds.length
      ? (async () => {
          for (let i = 0; i < missingImgIds.length; i += 40) {
            const batch = missingImgIds.slice(i, i + 40);
            try {
              const { data: imgRows } = await sb.from('coins').select('id, image_url').in('id', batch);
              (imgRows || []).forEach(r => saveSharedCoinImageToCache(r.id, r.image_url));
            } catch (e) {}
          }
        })()
      : Promise.resolve();

    let stats = coinsTradeStatsCache?.stats || new Map();
    let openPriceMap = coinsTradeStatsCache?.openPriceMap || new Map();
    let tradedTodaySet = coinsTradeStatsCache?.tradedTodaySet || new Set();
    const startOfTodayIso = getStartOfTodayDate().toISOString();
    const currentDateKey = getLocalDateKey(0);
    const needStatsRefresh =
      coinsTradeStatsDirty ||
      !coinsTradeStatsCache ||
      lastCoinsDateKey !== currentDateKey ||
      (Date.now() - coinsTradeStatsFetchedAt) > 12000;
    lastCoinsDateKey = currentDateKey;

    const fetchStatsPromise = needStatsRefresh
      ? (async () => {
          const nextStats = new Map();
          const nextOpenPriceMap = new Map();
          const nextTradedTodaySet = new Set();
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
            let previousPriceQ = sb.from('trades')
              .select('coin_id, price_after, created_at')
              .lt('created_at', startOfTodayIso)
              .order('created_at', { ascending: false })
              .limit(1000);
            if (srvResetTs > 0) {
              const srvIso = new Date(srvResetTs).toISOString();
              buyQ = buyQ.gt('created_at', srvIso);
              todayQ = todayQ.gt('created_at', srvIso);
              previousPriceQ = previousPriceQ.gt('created_at', srvIso);
            }
            const [{ data: buyRows }, { data: todayRows }, { data: previousPriceRows }] = await Promise.all([buyQ, todayQ, previousPriceQ]);
            const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
            (buyRows || []).forEach(t => {
              if (!t.coin_id) return;
              const ts = t.created_at ? new Date(t.created_at).getTime() : 0;
              const s = nextStats.get(t.coin_id) || { total: 0, recent: 0, volume: 0, lastBuy: 0 };
              s.total += 1;
              s.volume += Number(t.amount_usd || 0);
              if (ts >= dayAgo) s.recent += 1;
              if (ts > s.lastBuy) s.lastBuy = ts;
              nextStats.set(t.coin_id, s);
            });
            const tradedTodayIds = [...new Set((todayRows || []).map(t => t.coin_id).filter(Boolean))];
            tradedTodayIds.forEach(id => nextTradedTodaySet.add(id));
            (previousPriceRows || []).forEach(row => {
              if (!row.coin_id || nextOpenPriceMap.has(row.coin_id)) return;
              nextOpenPriceMap.set(row.coin_id, row.price_after != null ? Number(row.price_after) : 1);
            });
            const missingOpenPriceIds = tradedTodayIds.filter(id => !nextOpenPriceMap.has(id));
            if (missingOpenPriceIds.length) {
              const fallbackPrices = await Promise.all(missingOpenPriceIds.map(id =>
                sb.from('trades')
                  .select('price_after')
                  .eq('coin_id', id)
                  .lt('created_at', startOfTodayIso)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle()
              ));
              fallbackPrices.forEach((result, index) => {
                const id = missingOpenPriceIds[index];
                nextOpenPriceMap.set(id, result.data?.price_after != null ? Number(result.data.price_after) : 1);
              });
            }
            stats = nextStats;
            openPriceMap = nextOpenPriceMap;
            tradedTodaySet = nextTradedTodaySet;
            coinsTradeStatsCache = { stats, openPriceMap, tradedTodaySet };
            coinsTradeStatsFetchedAt = Date.now();
            coinsTradeStatsDirty = false;
          } catch (e) {}
        })()
      : Promise.resolve();

    await Promise.all([
      ensureProfilesCached(creatorIds),
      fetchMissingImgsPromise,
      fetchStatsPromise
    ]);

    coins = list.map(c => {
      const st = stats.get(c.id) || { total: 0, recent: 0, volume: 0, lastBuy: 0 };
      const currentPrice = Number(c.price) || 1;
      const tradedToday = tradedTodaySet.has(c.id);
      const openToday = tradedToday ? (openPriceMap.get(c.id) || 1) : currentPrice;
      const rawTodayPct = tradedToday && openToday > 0
        ? ((currentPrice - openToday) / openToday) * 100
        : 0;
      const todayPct = Math.abs(rawTodayPct) < 0.005 ? 0 : rawTodayPct;
      const cachedImg = sharedCoinImagesCache.has(String(c.id))
        ? sharedCoinImagesCache.get(String(c.id))
        : (c.image_url || null);
      return {
        ...c,
        image_url: cachedImg,
        profiles: c.creator_id ? getCachedProfile(c.creator_id, c.profiles) : null,
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
      const pctA = Number(a.change_pct || 0);
      const pctB = Number(b.change_pct || 0);
      if (Math.abs(pctB - pctA) > 1e-6) {
        return pctB - pctA;
      }
      if ((b.recent_buys_24h || 0) !== (a.recent_buys_24h || 0)) {
        return (b.recent_buys_24h || 0) - (a.recent_buys_24h || 0);
      }
      if ((b.total_buys || 0) !== (a.total_buys || 0)) {
        return (b.total_buys || 0) - (a.total_buys || 0);
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

    if (data?.id) saveSharedCoinImageToCache(data.id, pendingCoinImage);
    pendingCoinImage = null;
    $('#createForm').reset();
    $('#coinPreview').textContent = '＋';
    if (msgEl) msgEl.textContent = 'Currency created!';
    playSound('upload');
    toast('Your coin is live!');
    coinsTradeStatsDirty = true;
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
  pendingCommentGif = null;
  commentGifPickerOpen = false;
  commentGifSearchQuery = '';
  showPage('coin');
  await renderCoinDetail();
}

function calcRemainingPutIn(userTrades, currentShares) {
  if (!currentShares || currentShares <= 1e-8) return 0;
  let trackedShares = 0;
  let putIn = 0;
  for (const t of userTrades) {
    const amt = Math.max(0, Number(t.amount_usd) || 0);
    const tShares = Math.max(0, Number(t.shares) || 0);
    if (t.type === 'sell') {
      if (trackedShares > 1e-8 && tShares > 0) {
        const frac = Math.min(1, tShares / trackedShares);
        if (frac >= 0.9999) {
          trackedShares = 0;
          putIn = 0;
        } else {
          putIn = Math.max(0, putIn * (1 - frac));
          trackedShares = Math.max(0, trackedShares - tShares);
          if (trackedShares <= 1e-6) {
            trackedShares = 0;
            putIn = 0;
          }
        }
      } else {
        putIn = Math.max(0, putIn - amt);
      }
    } else {
      trackedShares += tShares;
      putIn += amt;
    }
  }
  return putIn;
}

async function renderCoinDetail() {
  if (!selectedCoin || !currentUser || !sb) return;
  const c = selectedCoin;
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const [{ data: hold }, { data: dbTrades }, { data: myCoinTradesDb }] = await Promise.all([
    sb.from('holdings').select('shares').eq('user_id', currentUser.id).eq('coin_id', c.id).maybeSingle(),
    sb.from('trades')
      .select('id, coin_id, user_id, type, amount_usd, shares, price_after, created_at, profiles(username, is_premium)')
      .eq('coin_id', c.id)
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('trades')
      .select('id, user_id, type, amount_usd, shares, price_after, created_at')
      .eq('coin_id', c.id)
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true })
      .limit(1000)
  ]);
  const shares = hold?.shares || 0;
  await ensureProfilesCached((dbTrades || []).map(t => t.user_id).filter(Boolean));

  // Combine with any local session trades
  const tradeMap = new Map();
  (dbTrades || []).forEach(t => {
    tradeMap.set(t.id || (t.created_at + t.shares), {
      ...t,
      profiles: t.user_id ? getCachedProfile(t.user_id, t.profiles) : t.profiles
    });
  });
  (c.localTrades || []).forEach(t => tradeMap.set(t.id || (t.created_at + t.shares), t));
  const trades = Array.from(tradeMap.values());
  trades.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  // Build deduplicated chronological trade list for currentUser on this coin since last sells/reset
  const myChronoTrades = (myCoinTradesDb || [])
    .filter(t => !srvResetTs || new Date(t.created_at || 0).getTime() > srvResetTs)
    .slice();
  (c.localTrades || []).forEach(lt => {
    if (lt.user_id !== currentUser.id) return;
    const ltTs = new Date(lt.created_at || 0).getTime();
    if (srvResetTs > 0 && ltTs <= srvResetTs) return;
    const alreadyInDb = myChronoTrades.some(dt =>
      dt.id === lt.id || (
        dt.type === lt.type &&
        Math.abs(new Date(dt.created_at || 0).getTime() - ltTs) < 15000 &&
        Math.abs(Number(dt.amount_usd || 0) - Number(lt.amount_usd || 0)) < 0.02
      )
    );
    if (!alreadyInDb) myChronoTrades.push(lt);
  });
  myChronoTrades.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const sellAllProceeds = calcHoldingsValue(c.price, shares);
  const putInSinceSell = calcRemainingPutIn(myChronoTrades, shares);
  const sellAllDiff = sellAllProceeds - putInSinceSell;
  let sellAllPreviewHtml = '';
  if (shares > 1e-8) {
    const absDiff = Math.abs(sellAllDiff);
    const isFlat = absDiff < 0.005;
    const isGain = sellAllDiff >= 0.005;
    const previewCls = isFlat ? 'flat' : isGain ? 'gain' : 'loss';
    const headline = isFlat
      ? `You will break even (<strong>$0.00</strong>) when selling 100%`
      : isGain
        ? `You will gain <strong>+${money(absDiff)}</strong> when you sell 100%`
        : `You will lose <strong>−${money(absDiff)}</strong> when you sell 100%`;
    sellAllPreviewHtml = `
      <div class="sell-all-preview ${previewCls}" id="sellAllPreview">
        <span class="sell-all-main">${headline}</span>
        <span class="sell-all-sub muted">Get ${money(sellAllProceeds)} vs ${money(putInSinceSell)} put in</span>
      </div>`;
  }

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
          <button class="zoom-btn watch-timeline-btn" id="watchTimelineBtn" title="Watch the entire timeline & price history as a short cutscene">▶ Watch</button>
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
        <p class="muted tiny" style="margin-top:10px">You own: ${shares.toFixed(4)} shares · Sell value ${money(sellAllProceeds)} · Cash ${money(currentUser.cash)}</p>
        ${sellAllPreviewHtml}
        <p class="form-message" id="tradeMessage"></p>
        ${isCoinCreator ? `
          <div class="creator-sell-coin-wrap">
            ${Number(c.price || 0) < 5 ? `
              <button type="button" class="creator-sell-coin-btn" id="sellOwnCoinBtn">💰 Sell &amp; Delete My Coin (${money(c.price)})</button>
              <span class="muted tiny">Worth under $5.00 · Auto-sells 100% of everyone's shares on delete</span>
            ` : `
              <button type="button" class="creator-sell-coin-btn locked" disabled title="Only coins worth under $5.00 can be sold by their creator">🔒 Sell Own Coin locked (${money(c.price)} · must be under $5.00)</button>
            `}
          </div>
        ` : ''}
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
          <div id="commentGifPreview" class="comment-gif-preview hidden"></div>
          <div id="commentGifPicker" class="comment-gif-picker hidden" role="region" aria-label="Choose a GIF">
            <div class="comment-gif-picker-head">
              <div>
                <strong>Choose a GIF</strong>
                <span class="muted tiny">Powered by GIPHY</span>
              </div>
              <button type="button" id="closeCommentGifPickerBtn" class="zoom-btn" aria-label="Close GIF picker">✕</button>
            </div>
            <input id="commentGifSearchInput" class="feed-search dm-coin-search" type="search" maxlength="120" placeholder="Search GIPHY GIFs or paste a giphy.com link...">
            <div id="commentGifStatus" class="dm-gif-status hidden"></div>
            <div id="commentGifGrid" class="dm-gif-grid"></div>
          </div>
          <div class="comment-composer-actions">
            <button type="button" class="comment-plus-btn" id="commentGifBtn" title="Add a GIF" aria-label="Add a GIF" aria-expanded="false"><span>＋</span><small>GIF</small></button>
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

  // Zoom & Watch Cutscene Controls
  const updateChart = () => drawChartWithBubbles(c, trades.slice().reverse());

  $('#watchTimelineBtn')?.addEventListener('click', () => {
    if (typeof openCoinWatchModal === 'function') openCoinWatchModal(c);
  });
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

  // Creator Sell & Delete Own Coin Handler (only when worth < $5.00)
  if (isCoinCreator) {
    $('#sellOwnCoinBtn')?.addEventListener('click', async () => {
      const btn = $('#sellOwnCoinBtn');
      if (!btn || btn.disabled) return;
      const shownWorth = Number(c.price || 0);
      if (shownWorth >= 5) {
        toast(`Cannot sell $${c.ticker}: worth ${money(shownWorth)} (must be under $5.00).`);
        return;
      }
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.classList.add('armed');
        btn.textContent = `Click again to sell $${c.ticker} (${money(shownWorth)}) & delete`;
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            btn.dataset.armed = '0';
            btn.classList.remove('armed');
            btn.textContent = `💰 Sell & Delete My Coin (${money(c.price)})`;
          }
        }, 4000);
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Selling coin...';

      const live = await freshCoin(c);
      const livePrice = Number(live?.price || c.price || 0);
      if (!live || String(live.creator_id) !== String(currentUser.id)) {
        toast('Only the coin creator can sell this coin.');
        renderCoinDetail();
        return;
      }
      if (livePrice >= 5) {
        btn.disabled = false;
        btn.dataset.armed = '0';
        btn.classList.remove('armed');
        toast(`$${c.ticker} rose to ${money(livePrice)} ($5.00+ cannot be self-sold).`);
        selectedCoin = live;
        renderCoinDetail();
        return;
      }

      const { data: holdRow } = await sb
        .from('holdings')
        .select('shares')
        .eq('user_id', currentUser.id)
        .eq('coin_id', c.id)
        .maybeSingle();
      const ownShares = Number(holdRow?.shares || 0);
      const ownShareProceeds = ownShares > 0 ? calcHoldingsValue(livePrice, ownShares) : 0;
      const totalPayout = Math.round((livePrice + ownShareProceeds) * 100) / 100;
      const nowTs = Date.now();

      const selfSellPayload = {
        coinId: String(c.id),
        creatorId: String(currentUser.id),
        coinName: String(live.name || c.name || ''),
        ticker: String(live.ticker || c.ticker || 'COIN'),
        priceAtDelete: livePrice,
        ts: nowTs
      };

      const { error: tombErr } = await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__COIN_SELF_SELL__:' + JSON.stringify(selfSellPayload),
        status: 'denied'
      });
      if (tombErr) {
        btn.disabled = false;
        btn.dataset.armed = '0';
        btn.classList.remove('armed');
        btn.textContent = `💰 Sell & Delete My Coin (${money(livePrice)})`;
        toast('Sell failed: ' + tombErr.message);
        return;
      }

      try {
        localStorage.setItem(`grind_coin_refund_${c.id}_${currentUser.id}`, '1');
        await sb.from('premium_requests').insert({
          user_id: currentUser.id,
          reason: '__COIN_REFUND_DONE__:' + c.id,
          status: 'denied'
        });
      } catch (e) {}

      if (ownShares > 0) {
        try {
          await sb.from('holdings').update({ shares: 0 }).eq('user_id', currentUser.id).eq('coin_id', c.id);
          await sb.from('holdings').delete().eq('user_id', currentUser.id).eq('coin_id', c.id);
        } catch (e) {}
      }

      const newCash = Math.round((Number(currentUser.cash || 0) + totalPayout) * 100) / 100;
      await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
      currentUser.cash = newCash;

      adminModStateCache.deletedCoinIds?.add(String(c.id));
      adminModStateCache.selfSoldCoins?.set(String(c.id), selfSellPayload);
      coins = coins.filter(x => String(x.id) !== String(c.id));
      selectedCoin = null;

      updateUIProfile();
      await updateNetWorth();
      playSound('sell');
      toast(`Sold $${live.ticker || c.ticker} for +${money(totalPayout)}! All holders auto-sold 100%.`);
      await loadCoins();
      showPage('feed');
    });
  }

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

  $('#commentGifBtn')?.addEventListener('click', () => {
    setCommentGifPickerOpen(!commentGifPickerOpen);
  });
  $('#closeCommentGifPickerBtn')?.addEventListener('click', () => {
    setCommentGifPickerOpen(false);
  });
  let commentGifSearchTimer = null;
  $('#commentGifSearchInput')?.addEventListener('input', e => {
    commentGifSearchQuery = e.target.value || '';
    clearTimeout(commentGifSearchTimer);
    const delay = extractDirectGiphyUrl(commentGifSearchQuery) ? 0 : 280;
    commentGifSearchTimer = setTimeout(() => {
      if (commentGifPickerOpen) loadCommentGifPicker();
    }, delay);
  });
  renderCommentGifPreview();
  if (commentGifPickerOpen) setCommentGifPickerOpen(true);

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
  saveSharedCoinImageToCache(targetCoin.id, newLogo);
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

const GRIND_GIPHY_REMOTE_URL = 'https://ais-pre-6t6kqxwlmllmygnc6gzkjm-935946932105.europe-west2.run.app/api/giphy';
const giphyQueryCache = new Map();
const giphyRequestTokens = new WeakMap();
let pendingCommentGif = null; // { id, gifUrl, previewUrl, title }
let commentGifPickerOpen = false;
let commentGifSearchQuery = '';

function sanitizeGifUrl(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    if (!/(^|\.)giphy\.com$/i.test(u.hostname)) return '';
    return u.toString();
  } catch (e) {
    return '';
  }
}

function extractDirectGiphyUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let id = '';
  const mediaMatch = s.match(/https?:\/\/(?:media\d*\.)?giphy\.com\/media\/(?:v1\.[^/]+\/)?([A-Za-z0-9]+)/i);
  const imgMatch = s.match(/https?:\/\/i\.giphy\.com\/(?:media\/)?([A-Za-z0-9]+)(?:\.(?:gif|webp|mp4))?/i);
  const pageMatch = s.match(/https?:\/\/(?:www\.)?giphy\.com\/gifs\/(?:[^/?#]*-)?([A-Za-z0-9]+)(?:[/?#]|$)/i);
  if (mediaMatch) id = mediaMatch[1];
  else if (imgMatch) id = imgMatch[1];
  else if (pageMatch) id = pageMatch[1];
  if (!id) return null;
  return {
    id,
    title: 'GIPHY GIF',
    previewUrl: `https://media.giphy.com/media/${id}/200w.gif`,
    gifUrl: `https://media.giphy.com/media/${id}/giphy.gif`,
    width: 200,
    height: 150
  };
}

async function tryGiphyEndpoint(baseUrl, query, limit = 24, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}limit=${encodeURIComponent(String(limit))}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.gifs)) return null;
    return {
      configured: data.configured !== false,
      gifs: data.gifs
        .map(g => ({
          id: String(g.id || ''),
          title: String(g.title || 'GIF'),
          previewUrl: sanitizeGifUrl(g.previewUrl) || sanitizeGifUrl(g.gifUrl),
          gifUrl: sanitizeGifUrl(g.gifUrl) || sanitizeGifUrl(g.previewUrl),
          width: Number(g.width) || 200,
          height: Number(g.height) || 150
        }))
        .filter(g => g.id && g.previewUrl && g.gifUrl),
      error: data.error ? String(data.error) : ''
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchGiphyGifs(query = '') {
  const cleanQ = String(query || '').trim().slice(0, 120);
  const direct = extractDirectGiphyUrl(cleanQ);
  if (direct) {
    return { configured: true, gifs: [direct], error: '' };
  }

  const cacheKey = cleanQ.toLowerCase();
  const cached = giphyQueryCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < 120000) {
    return cached.data;
  }

  const isGithubPages = (window.location.hostname || '').endsWith('github.io');
  let result = null;
  if (!isGithubPages) {
    result = await tryGiphyEndpoint('/api/giphy', cleanQ, 24, 8000);
  }
  if (!result) {
    result = await tryGiphyEndpoint(GRIND_GIPHY_REMOTE_URL, cleanQ, 24, 6000);
  }
  if (!result) {
    return {
      configured: false,
      gifs: [],
      error: 'Could not reach the GIPHY service right now.'
    };
  }

  if (result.configured && result.gifs.length > 0) {
    giphyQueryCache.set(cacheKey, { ts: Date.now(), data: result });
  }
  return result;
}

async function renderGiphyPickerGrid({ gridEl, statusEl, query, emptyText, onSelect }) {
  if (!gridEl) return;
  const nextToken = (giphyRequestTokens.get(gridEl) || 0) + 1;
  giphyRequestTokens.set(gridEl, nextToken);

  if (statusEl) {
    statusEl.classList.remove('hidden');
    statusEl.textContent = String(query || '').trim() ? 'Searching GIPHY...' : 'Loading trending GIFs...';
  }
  gridEl.innerHTML = '<div class="dm-gif-skeleton"></div>'.repeat(6);

  const res = await fetchGiphyGifs(query);
  if (giphyRequestTokens.get(gridEl) !== nextToken || !gridEl.isConnected) return;

  if (!res.configured && !res.gifs.length) {
    gridEl.innerHTML = '';
    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.textContent = 'GIPHY live search needs GIPHY_API_KEY configured on the server — or paste any giphy.com GIF link above!';
    }
    return;
  }

  if (!res.gifs.length) {
    gridEl.innerHTML = '';
    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.textContent = res.error || emptyText || 'No GIFs found. Try another search or paste a giphy.com link.';
    }
    return;
  }

  if (statusEl) {
    statusEl.classList.add('hidden');
    statusEl.textContent = '';
  }

  gridEl.innerHTML = res.gifs.map((g, idx) => `
    <button type="button" class="dm-gif-tile" data-gif-idx="${idx}" title="${escapeHtml(g.title || 'GIF')}">
      <img src="${escapeHtml(g.previewUrl)}" alt="${escapeHtml(g.title || 'GIF')}" loading="lazy">
    </button>
  `).join('');

  gridEl.querySelectorAll('[data-gif-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.gifIdx);
      const chosen = res.gifs[idx];
      if (chosen && typeof onSelect === 'function') onSelect(chosen);
    });
  });
}

function renderCommentGifPreview() {
  const prevEl = $('#commentGifPreview');
  if (!prevEl) return;
  if (!pendingCommentGif || !pendingCommentGif.gifUrl) {
    prevEl.innerHTML = '';
    prevEl.classList.add('hidden');
    return;
  }
  prevEl.classList.remove('hidden');
  prevEl.innerHTML = `
    <div class="comment-gif-chip">
      <img src="${escapeHtml(pendingCommentGif.previewUrl || pendingCommentGif.gifUrl)}" alt="${escapeHtml(pendingCommentGif.title || 'Selected GIF')}">
      <div class="comment-gif-chip-meta">
        <strong>GIF attached</strong>
        <span class="muted tiny">${escapeHtml(pendingCommentGif.title || 'GIPHY GIF')}</span>
      </div>
      <button type="button" class="zoom-btn comment-gif-remove-btn" id="removeCommentGifBtn" aria-label="Remove GIF">✕</button>
    </div>
  `;
  $('#removeCommentGifBtn')?.addEventListener('click', () => {
    pendingCommentGif = null;
    renderCommentGifPreview();
  });
}

function loadCommentGifPicker() {
  return renderGiphyPickerGrid({
    gridEl: $('#commentGifGrid'),
    statusEl: $('#commentGifStatus'),
    query: commentGifSearchQuery,
    emptyText: 'No GIFs matched your search.',
    onSelect: (gif) => {
      pendingCommentGif = gif;
      setCommentGifPickerOpen(false);
      renderCommentGifPreview();
      $('#commentInput')?.focus();
    }
  });
}

function setCommentGifPickerOpen(open) {
  commentGifPickerOpen = Boolean(open);
  const picker = $('#commentGifPicker');
  const btn = $('#commentGifBtn');
  if (picker) picker.classList.toggle('hidden', !commentGifPickerOpen);
  if (btn) {
    btn.classList.toggle('active', commentGifPickerOpen);
    btn.setAttribute('aria-expanded', commentGifPickerOpen ? 'true' : 'false');
  }
  if (commentGifPickerOpen) {
    loadCommentGifPicker();
    $('#commentGifSearchInput')?.focus();
  }
}

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
  const attachedGif = !isReply && pendingCommentGif && sanitizeGifUrl(pendingCommentGif.gifUrl)
    ? pendingCommentGif
    : null;
  if (!text && !attachedGif) {
    return toast(isReply ? 'Write a reply first.' : 'Write a comment or pick a GIF first.');
  }
  if (btn) btn.disabled = true;

  const payload = {
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    coin_id: String(coin.id),
    text,
    ts: Date.now()
  };
  if (attachedGif) {
    payload.gif_url = sanitizeGifUrl(attachedGif.gifUrl);
    payload.gif_title = String(attachedGif.title || 'GIF').slice(0, 80);
  }
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
  playSound('commenting');
  if (isReply) {
    expandedCommentReplies.add(String(replyTarget.parentId));
    activeReplyTarget = null;
    toast('Reply posted!');
  } else {
    if (input) input.value = '';
    pendingCommentGif = null;
    commentGifSearchQuery = '';
    if ($('#commentGifSearchInput')) $('#commentGifSearchInput').value = '';
    setCommentGifPickerOpen(false);
    renderCommentGifPreview();
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
      .select('user_id, reason, created_at, profiles(id, username, is_premium)')
      .like('reason', '__CMT_%')
      .order('created_at', { ascending: true })
      .limit(1000);
    rows = data || [];
  } catch (e) {}

  if (!selectedCoin || String(selectedCoin.id) !== coinId) return;
  await ensureProfilesCached(rows.map(r => r.user_id).filter(Boolean));
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
        const cleanGif = sanitizeGifUrl(p?.gif_url);
        const cleanText = String(p?.text || '').trim();
        if (!p || String(p.coin_id) !== coinId || !p.id || (!cleanText && !cleanGif)) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        commentsMap.set(String(p.id), {
          id: String(p.id),
          user_id: r.user_id,
          parent_id: p.parent_id ? String(p.parent_id) : null,
          reply_to_user_id: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
          reply_to_username: p.reply_to_username ? String(p.reply_to_username) : null,
          text: String(p.text || ''),
          gif_url: cleanGif,
          gif_title: p.gif_title ? String(p.gif_title) : 'GIF',
          ts,
          profile: getCachedProfile(r.user_id, r.profiles)
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
            ${rp.text ? `<div class="comment-text">${mentionHtml}${escapeHtml(rp.text).replace(/\n/g, '<br>')}</div>` : (mentionHtml ? `<div class="comment-text">${mentionHtml}</div>` : '')}
            ${rp.gif_url ? `<div class="comment-gif-wrap"><img src="${escapeHtml(rp.gif_url)}" alt="${escapeHtml(rp.gif_title || 'GIF')}" loading="lazy"></div>` : ''}
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
        ${cm.text ? `<div class="comment-text">${escapeHtml(cm.text).replace(/\n/g, '<br>')}</div>` : ''}
        ${cm.gif_url ? `<div class="comment-gif-wrap"><img src="${escapeHtml(cm.gif_url)}" alt="${escapeHtml(cm.gif_title || 'GIF')}" loading="lazy"></div>` : ''}
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
  if (typeof checkActiveTraderBattleFloor === 'function') checkActiveTraderBattleFloor(nw);
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
    playSound('buy');
    toast(`Bought for ${money(amount)}! Price ${priceFmt(coin.price)} (+${(impact * 100).toFixed(impact < 0.1 ? 2 : 0)}%)`);
    await loadCoins();
    selectedCoin = coins.find(x => x.id === coin.id) || coin;
    await renderCoinDetail();
    if (amount >= 1000) {
      triggerWhaleCoinBuyAnimation(selectedCoin, amount, impact);
    } else if (amount > 200) {
      triggerMediumCoinBuyAnimation(selectedCoin, amount, impact);
    }
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
    playSound('sell');
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

  const baseW = Math.max(scroll.clientWidth || 600, 240);
  const isNarrowChart = baseW < 430;
  const PAD_X = isNarrowChart ? 28 : 46;
  const PAD_TOP = isNarrowChart ? 58 : 64;
  const PAD_BOT = 24;
  const H = isNarrowChart ? 250 : 300;

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
  const accentStroke = (getComputedStyle(document.body).getPropertyValue('--purple') || '').trim() || '#c084fc';
  ctx.strokeStyle = accentStroke;
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
    .select('user_id, amount_usd, profiles(username, is_premium)')
    .eq('coin_id', coinId)
    .eq('type', 'buy');
  if (error || !data) return [];
  await ensureProfilesCached(data.map(t => t.user_id).filter(Boolean));

  const totals = new Map();
  for (const t of data) {
    if (!t.user_id || String(t.user_id) === '6480431e-0f8b-4d0a-9dd9-6269ff872f77') continue;
    if (String(t.profiles?.username || '').trim().toLowerCase() === 'grind_test') continue;
    const cachedProf = getCachedProfile(t.user_id, t.profiles);
    if (String(cachedProf?.username || '').trim().toLowerCase() === 'grind_test') continue;
    const prev = totals.get(t.user_id) || {
      id: t.user_id,
      user_id: t.user_id,
      username: cachedProf?.username || t.profiles?.username || 'Unknown',
      avatar_url: cachedProf?.avatar_url || null,
      is_premium: Boolean(cachedProf?.is_premium ?? t.profiles?.is_premium),
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

let lbRenderSeq = 0;
let lbAnimatingUntil = 0;
let lbHoldTimer = null;
let lbCleanupTimer = null;
let lbRankRaf = null;

function formatSignedPct(val) {
  const n = Number(val || 0);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '0.00%';
  const abs = Math.abs(n);
  const decimals = abs >= 1000 ? 0 : (abs >= 100 ? 1 : 2);
  return `${n > 0 ? '+' : '-'}${abs.toFixed(decimals)}%`;
}

function formatSignedMoney(val) {
  const n = Number(val || 0);
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return '$0.00';
  return `${n > 0 ? '+' : '-'}${money(Math.abs(n))}`;
}

async function computeWeeklyProfitStats(rawProfiles) {
  const statsMap = new Map();
  if (!sb || !Array.isArray(rawProfiles) || !rawProfiles.length) return statsMap;

  try {
    const srvResetTs = adminModStateCache.serverResetTs || 0;
    const delCoins = adminModStateCache.deletedCoinIds || new Set();
    const selfSoldMap = adminModStateCache.selfSoldCoins || new Map();
    const weekStartTs = Date.now() - 7 * 24 * 60 * 60 * 1000;

    let coinsQ = sb.from('coins').select('id, creator_id, price, created_at');
    if (srvResetTs > 0) {
      coinsQ = coinsQ.gt('created_at', new Date(srvResetTs).toISOString());
    }

    const fetchAllTrades = async () => {
      const collected = [];
      const pageSize = 1000;
      for (let offset = 0; offset < 5000; offset += pageSize) {
        let q = sb.from('trades')
          .select('user_id, coin_id, type, amount_usd, shares, price_after, created_at')
          .order('created_at', { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (srvResetTs > 0) {
          q = q.gt('created_at', new Date(srvResetTs).toISOString());
        }
        const { data: batch, error } = await q;
        if (error || !Array.isArray(batch) || !batch.length) break;
        collected.push(...batch);
        if (batch.length < pageSize) break;
      }
      return collected;
    };

    const [{ data: allCoins }, allTrades] = await Promise.all([
      coinsQ,
      fetchAllTrades()
    ]);

    const activeCoinMap = new Map();
    (allCoins || []).forEach(c => {
      const cid = String(c.id);
      if (delCoins.has(cid)) return;
      if (selfSoldMap && selfSoldMap.has(cid)) return;
      activeCoinMap.set(cid, {
        id: cid,
        price: Number(c.price || 1),
        createdTs: c.created_at ? new Date(c.created_at).getTime() : 0
      });
    });

    const coinPriceBeforeWeek = new Map();
    const sharesBeforeWeek = new Map(); // uid -> Map(cid -> shares)
    const currSharesByUser = new Map(); // uid -> Map(cid -> shares)
    const buys7dByUser = new Map();
    const sells7dByUser = new Map();

    const ensureUserMap = (outer, uid) => {
      let m = outer.get(uid);
      if (!m) {
        m = new Map();
        outer.set(uid, m);
      }
      return m;
    };

    (allTrades || []).forEach(t => {
      const cid = String(t.coin_id || '');
      if (!activeCoinMap.has(cid)) return;
      const uid = String(t.user_id || '');
      if (!uid) return;
      const ts = t.created_at ? new Date(t.created_at).getTime() : 0;
      const isSell = t.type === 'sell';
      const sh = Math.max(0, Number(t.shares || 0));
      const usd = Math.max(0, Number(t.amount_usd || 0));
      const priceAfter = Number(t.price_after);

      if (ts < weekStartTs) {
        if (Number.isFinite(priceAfter) && priceAfter > 0) {
          coinPriceBeforeWeek.set(cid, priceAfter);
        }
        const uStart = ensureUserMap(sharesBeforeWeek, uid);
        const prevSh = uStart.get(cid) || 0;
        uStart.set(cid, isSell ? Math.max(0, prevSh - sh) : (prevSh + sh));
      } else {
        if (isSell) {
          sells7dByUser.set(uid, (sells7dByUser.get(uid) || 0) + usd);
        } else {
          buys7dByUser.set(uid, (buys7dByUser.get(uid) || 0) + usd);
        }
      }

      const uCurr = ensureUserMap(currSharesByUser, uid);
      const prevCurr = uCurr.get(cid) || 0;
      uCurr.set(cid, isSell ? Math.max(0, prevCurr - sh) : (prevCurr + sh));
    });

    rawProfiles.forEach(p => {
      const pid = String(p.id);
      const uStart = sharesBeforeWeek.get(pid);
      const uCurr = currSharesByUser.get(pid);

      let startHoldVal = 0;
      if (uStart) {
        uStart.forEach((sh, cid) => {
          if (sh <= 1e-8) return;
          const coin = activeCoinMap.get(cid);
          if (!coin) return;
          const pStart = coinPriceBeforeWeek.get(cid) || (coin.createdTs > 0 && coin.createdTs < weekStartTs ? 1 : coin.price);
          startHoldVal += calcHoldingsValue(pStart, sh);
        });
      }

      let endHoldVal = 0;
      if (uCurr) {
        uCurr.forEach((sh, cid) => {
          if (sh <= 1e-8) return;
          const coin = activeCoinMap.get(cid);
          if (!coin) return;
          endHoldVal += calcHoldingsValue(coin.price, sh);
        });
      }

      const buys7d = buys7dByUser.get(pid) || 0;
      const sells7d = sells7dByUser.get(pid) || 0;
      const basisUsd = startHoldVal + buys7d;
      const profitUsd = (endHoldVal + sells7d) - basisUsd;
      const hasActivity = basisUsd > 0.01 || sells7d > 0.01;
      const profitPct = basisUsd > 0.01 ? (profitUsd / basisUsd) * 100 : 0;

      statsMap.set(pid, {
        profitPct: Number.isFinite(profitPct) ? profitPct : 0,
        profitUsd: Number.isFinite(profitUsd) ? profitUsd : 0,
        basisUsd,
        hasActivity
      });
    });
  } catch (err) {
    console.warn('Weekly profit computation note:', err);
  }

  return statsMap;
}

async function renderLeaderboard() {
  if (!sb) return;
  const seq = ++lbRenderSeq;
  const modeAtStart = lbMode;
  const weeklySortAtStart = lbWeeklySort;
  const listEl = $('#leaderboardList');
  if (modeAtStart === 'weekly' && listEl) {
    listEl.innerHTML = '<div class="empty-state" style="padding:28px 14px;"><p class="muted tiny">Calculating 7-day profits...</p></div>';
  }
  await Promise.all([
    loadProUserIds(),
    fetchAdminModerationState(),
    typeof loadTitleSystemState === 'function' ? loadTitleSystemState() : Promise.resolve(),
    modeAtStart === 'creators' && typeof loadPlayData === 'function' ? loadPlayData(true) : Promise.resolve()
  ]);
  if (currentUser) await updateNetWorth();
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const { data } = await sb.from('profiles').select('id, username, cash, net_worth, time_played, is_premium, is_test_account').neq('id', '6480431e-0f8b-4d0a-9dd9-6269ff872f77').limit(200);
  if (seq !== lbRenderSeq || modeAtStart !== lbMode) return;

  let list = (data || [])
    .filter(p => p.is_test_account !== true && String(p.id) !== '6480431e-0f8b-4d0a-9dd9-6269ff872f77' && !delUsers.has(String(p.id)) && String(p.username || '').trim().toLowerCase() !== 'grind_test')
    .map(getEffectiveProfileStats);

  const weeklyWrap = $('#lbWeeklyControls');
  const spotlightsEl = $('#lbWeeklySpotlights');
  if (weeklyWrap) weeklyWrap.classList.toggle('hidden', lbMode !== 'weekly');

  let bestGainerPid = null;
  let worstLoserPid = null;
  let weeklyBest = null;
  let weeklyWorst = null;

  if (lbMode === 'weekly') {
    const weeklyMap = await computeWeeklyProfitStats(list);
    if (seq !== lbRenderSeq || modeAtStart !== lbMode || weeklySortAtStart !== lbWeeklySort) return;

    list = list.map(p => {
      const st = weeklyMap.get(String(p.id)) || { profitPct: 0, profitUsd: 0, basisUsd: 0, hasActivity: false };
      return { ...p, weeklyProfitPct: st.profitPct, weeklyProfitUsd: st.profitUsd, weeklyHasActivity: st.hasActivity };
    });

    const activeTraders = list.filter(p => p.weeklyHasActivity);
    const pool = activeTraders.length ? activeTraders : list;
    if (pool.length) {
      const sortedUp = [...pool].sort((a, b) => (b.weeklyProfitPct - a.weeklyProfitPct) || (b.weeklyProfitUsd - a.weeklyProfitUsd));
      const sortedDown = [...pool].sort((a, b) => (a.weeklyProfitPct - b.weeklyProfitPct) || (a.weeklyProfitUsd - b.weeklyProfitUsd));
      weeklyBest = sortedUp[0];
      weeklyWorst = sortedDown[0];
      if (weeklyBest && weeklyBest.weeklyProfitPct > 0.005) bestGainerPid = String(weeklyBest.id);
      if (weeklyWorst && weeklyWorst.weeklyProfitPct < -0.005) worstLoserPid = String(weeklyWorst.id);
    } else if (spotlightsEl) {
      spotlightsEl.innerHTML = '';
    }

    $$('.feed-tab[data-lb-weekly]').forEach(x => {
      x.classList.toggle('active', x.dataset.lbWeekly === lbWeeklySort);
    });

    if (lbWeeklySort === 'down') {
      list.sort((a, b) => {
        if (a.weeklyHasActivity !== b.weeklyHasActivity) return a.weeklyHasActivity ? -1 : 1;
        return (a.weeklyProfitPct - b.weeklyProfitPct) || (a.weeklyProfitUsd - b.weeklyProfitUsd);
      });
    } else {
      list.sort((a, b) => {
        if (a.weeklyHasActivity !== b.weeklyHasActivity) return a.weeklyHasActivity ? -1 : 1;
        return (b.weeklyProfitPct - a.weeklyProfitPct) || (b.weeklyProfitUsd - a.weeklyProfitUsd);
      });
    }
  } else if (lbMode === 'creators') {
    const creatorStats = new Map();
    (playState.videos || []).forEach(v => {
      const creatorId = String(v.user_id || '');
      if (!creatorId) return;
      const st = creatorStats.get(creatorId) || { views: 0, likes: 0, videos: 0 };
      const sum = typeof getPlayVoteSummary === 'function' ? getPlayVoteSummary(v.id) : { likes: 0, views: 0 };
      st.views += Number(sum.views || 0);
      st.likes += Number(sum.likes || 0);
      st.videos += 1;
      creatorStats.set(creatorId, st);
    });
    list = list.map(p => {
      const pid = String(p.id);
      const st = creatorStats.get(pid) || { views: 0, likes: 0, videos: 0 };
      const fols = typeof getFollowersCount === 'function' ? getFollowersCount(pid) : 0;
      return {
        ...p,
        creatorViews: st.views,
        creatorLikes: st.likes,
        creatorVideos: st.videos,
        creatorFollowers: fols
      };
    });
    list.sort((a, b) =>
      (b.creatorViews - a.creatorViews)
      || (b.creatorLikes - a.creatorLikes)
      || (b.creatorFollowers - a.creatorFollowers)
      || (Number(b.net_worth || 0) - Number(a.net_worth || 0))
    );
  } else if (lbMode === 'networth') {
    list.sort((a, b) => Number(b.net_worth || 0) - Number(a.net_worth || 0));
  } else {
    list.sort((a, b) => Number(b.time_played || 0) - Number(a.time_played || 0));
  }
  list = list.slice(0, 100);

  // Hydrate missing avatars only for rendered top-100 + weekly spotlight users via shared cache
  const needAvatarIds = list.map(p => p.id);
  if (weeklyBest?.id) needAvatarIds.push(weeklyBest.id);
  if (weeklyWorst?.id) needAvatarIds.push(weeklyWorst.id);
  await ensureProfilesCached(needAvatarIds);
  if (seq !== lbRenderSeq || modeAtStart !== lbMode) return;
  list = list.map(p => {
    const cached = getCachedProfile(p.id, p);
    return { ...p, avatar_url: cached?.avatar_url ?? null };
  });

  if (lbMode === 'weekly' && spotlightsEl && (weeklyBest || weeklyWorst)) {
    const best = weeklyBest ? { ...weeklyBest, avatar_url: getCachedProfile(weeklyBest.id, weeklyBest)?.avatar_url ?? null } : null;
    const worst = weeklyWorst ? { ...weeklyWorst, avatar_url: getCachedProfile(weeklyWorst.id, weeklyWorst)?.avatar_url ?? null } : null;
    const upCard = best ? `
      <button type="button" class="lb-spotlight-card up" data-profile="${escapeHtml(best.id)}">
        <div class="lb-spotlight-label">▲ MOST % UP (7D)</div>
        <div class="lb-spotlight-user">
          <div class="avatar" style="width:30px;height:30px;font-size:12px;">${best.avatar_url ? `<img src="${escapeHtml(best.avatar_url)}">` : escapeHtml((best.username || '?')[0].toUpperCase())}</div>
          <span class="lb-spotlight-name">${escapeHtml(best.username || 'Unknown')}${tierBadgeHtml(best)}</span>
        </div>
        <div class="lb-spotlight-stat up">${escapeHtml(formatSignedPct(best.weeklyProfitPct))} <small>${escapeHtml(formatSignedMoney(best.weeklyProfitUsd))}</small></div>
      </button>` : '';
    const downCard = worst ? `
      <button type="button" class="lb-spotlight-card down" data-profile="${escapeHtml(worst.id)}">
        <div class="lb-spotlight-label">▼ DOWN MOST % (7D)</div>
        <div class="lb-spotlight-user">
          <div class="avatar" style="width:30px;height:30px;font-size:12px;">${worst.avatar_url ? `<img src="${escapeHtml(worst.avatar_url)}">` : escapeHtml((worst.username || '?')[0].toUpperCase())}</div>
          <span class="lb-spotlight-name">${escapeHtml(worst.username || 'Unknown')}${tierBadgeHtml(worst)}</span>
        </div>
        <div class="lb-spotlight-stat down">${escapeHtml(formatSignedPct(worst.weeklyProfitPct))} <small>${escapeHtml(formatSignedMoney(worst.weeklyProfitUsd))}</small></div>
      </button>` : '';
    spotlightsEl.innerHTML = upCard + downCard;
    $$('#lbWeeklySpotlights [data-profile]').forEach(el => {
      el.addEventListener('click', () => openProfileModal(el.dataset.profile));
    });
  }

  const storageKey = lbMode === 'weekly'
    ? `grind_lb_ranks_${currentUser?.id || 'guest'}_weekly_${lbWeeklySort}`
    : `grind_lb_ranks_${currentUser?.id || 'guest'}_${lbMode}`;
  let prevRanks = null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') prevRanks = parsed;
    }
  } catch (e) {}

  const currRanks = {};
  let climbedCount = 0;
  let declinedCount = 0;
  let myMove = null;
  const hasPrev = Boolean(prevRanks && Object.keys(prevRanks).length > 0);

  const rowModels = list.map((p, i) => {
    const pid = String(p.id);
    currRanks[pid] = i;
    const prevIdx = hasPrev && typeof prevRanks[pid] === 'number' ? prevRanks[pid] : null;
    const delta = prevIdx !== null ? (prevIdx - i) : null;
    if (delta !== null) {
      if (delta > 0) climbedCount += 1;
      else if (delta < 0) declinedCount += 1;
    }
    const isMe = Boolean(currentUser && pid === String(currentUser.id));
    if (isMe && hasPrev) {
      myMove = { prevIdx, currIdx: i, delta };
    }
    return { p, pid, currIdx: i, prevIdx, delta, isMe };
  });

  if (lbHoldTimer) { clearTimeout(lbHoldTimer); lbHoldTimer = null; }
  if (lbCleanupTimer) { clearTimeout(lbCleanupTimer); lbCleanupTimer = null; }
  if (lbRankRaf) { cancelAnimationFrame(lbRankRaf); lbRankRaf = null; }

  const bannerEl = $('#lbMovementBanner');
  const modeDisplayName = lbMode === 'weekly'
    ? (lbWeeklySort === 'down' ? 'Weekly Profit (Down Most %)' : 'Weekly Profit (Most % Up)')
    : (lbMode === 'creators' ? 'Creators (Views)' : (lbMode === 'networth' ? 'Net Worth' : 'Time Played'));

  if (bannerEl) {
    const anyChanges = hasPrev && (climbedCount > 0 || declinedCount > 0);
    if (anyChanges || (myMove && myMove.delta !== null && myMove.delta !== 0)) {
      const parts = [];
      if (myMove && myMove.prevIdx !== null && myMove.delta !== 0) {
        const up = myMove.delta > 0;
        parts.push(`<span class="lb-movement-pill ${up ? 'up' : 'down'}">Your rank: #${myMove.prevIdx + 1} → #${myMove.currIdx + 1} (${up ? '▲ +' : '▼ '}${Math.abs(myMove.delta)})</span>`);
      } else if (myMove && myMove.delta === null) {
        parts.push(`<span class="lb-movement-pill up">You entered the Top 100 at #${myMove.currIdx + 1}!</span>`);
      } else {
        parts.push(`<span>Since your last visit to <strong>${escapeHtml(modeDisplayName)}</strong>:</span>`);
      }
      const statBits = [];
      if (climbedCount > 0) statBits.push(`<span style="color:#34d399;font-weight:700;">▲ ${climbedCount} climbed</span>`);
      if (declinedCount > 0) statBits.push(`<span style="color:#f87171;font-weight:700;">▼ ${declinedCount} slipped</span>`);
      bannerEl.innerHTML = `${parts.join('')}<div>${statBits.join(' · ') || 'Positions updated'}</div>`;
      bannerEl.classList.remove('hidden');
    } else {
      bannerEl.classList.add('hidden');
      bannerEl.innerHTML = '';
    }
  }

  listEl.innerHTML = rowModels.map(({ p, pid, currIdx, prevIdx, delta, isMe }) => {
    const startRankNum = (delta !== null && delta !== 0) ? (prevIdx + 1) : (currIdx + 1);
    let deltaHtml = '';
    let stateCls = '';
    if (hasPrev) {
      if (delta === null) {
        deltaHtml = `<span class="lb-delta new">NEW</span>`;
        stateCls = 'is-new-entry';
      } else if (delta > 0) {
        deltaHtml = `<span class="lb-delta up">▲ ${delta}</span>`;
        stateCls = 'is-climbing';
      } else if (delta < 0) {
        deltaHtml = `<span class="lb-delta down">▼ ${Math.abs(delta)}</span>`;
        stateCls = 'is-declining';
      } else {
        deltaHtml = `<span class="lb-delta same">—</span>`;
      }
    }

    let subText = lbMode === 'networth' ? 'Net worth' : 'Time played';
    let valueHtml = lbMode === 'networth' ? money(p.net_worth || 0) : formatTime(p.time_played || 0);
    let valueCls = '';
    let tagHtml = '';

    if (lbMode === 'creators') {
      const vc = Number(p.creatorViews || 0);
      const lc = Number(p.creatorLikes || 0);
      const vcount = Number(p.creatorVideos || 0);
      const fc = Number(p.creatorFollowers || 0);
      subText = `${vcount} video${vcount === 1 ? '' : 's'} · ♥ ${lc} · ${fc} follower${fc === 1 ? '' : 's'}`;
      valueHtml = `${vc.toLocaleString()} view${vc === 1 ? '' : 's'}`;
    } else if (lbMode === 'weekly') {
      const pct = Number(p.weeklyProfitPct || 0);
      const usd = Number(p.weeklyProfitUsd || 0);
      if (p.weeklyHasActivity) {
        const signCls = pct > 0.005 ? 'up' : (pct < -0.005 ? 'down' : 'flat');
        valueCls = signCls;
        subText = `7d P&L: ${formatSignedMoney(usd)}`;
        valueHtml = escapeHtml(formatSignedPct(pct));
      } else {
        valueCls = 'flat';
        subText = 'No trades this week';
        valueHtml = '0.00%';
      }
      if (pid === bestGainerPid) tagHtml = '<span class="lb-weekly-tag up">▲ Most Up</span>';
      else if (pid === worstLoserPid) tagHtml = '<span class="lb-weekly-tag down">▼ Down Most</span>';
    }

    const equippedTitleId = typeof getUserEquippedTitleId === 'function' ? getUserEquippedTitleId(pid) : null;
    const equippedTitleHtml = equippedTitleId && typeof renderTitleBadgeHtml === 'function'
      ? `<div class="lb-title-slot">${renderTitleBadgeHtml(equippedTitleId, true)}</div>`
      : '';

    return `
      <div class="lb-row ${stateCls} ${isMe ? 'is-me' : ''}" data-lb-idx="${currIdx}" data-lb-prev="${prevIdx !== null ? prevIdx : ''}" data-lb-delta="${delta !== null ? delta : 'new'}">
        <div class="lb-rank-side">
          <div class="lb-rank ${currIdx < 3 ? 'top3' : ''}">#${startRankNum}</div>
          ${deltaHtml}
        </div>
        <div class="avatar">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
        <div class="lb-info">
          <strong class="profile-link" data-profile="${escapeHtml(pid)}">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}${tagHtml}</strong>
          ${equippedTitleHtml}
          <div class="muted tiny">${escapeHtml(subText)}</div>
        </div>
        <div class="lb-value ${valueCls}">${valueHtml}</div>
      </div>
    `;
  }).join('');

  $('#emptyLeaderboard').classList.toggle('hidden', list.length > 0);
  $$('#leaderboardList [data-profile]').forEach(el => el.addEventListener('click', () => openProfileModal(el.dataset.profile)));

  try {
    localStorage.setItem(storageKey, JSON.stringify(currRanks));
  } catch (e) {}

  // FLIP smooth climb / decline animation from last-visit spot to current spot
  if (hasPrev && (climbedCount > 0 || declinedCount > 0)) {
    const rows = Array.from(listEl.querySelectorAll('.lb-row'));
    let stride = 74;
    if (rows.length >= 2) {
      const measured = rows[1].offsetTop - rows[0].offsetTop;
      if (measured > 30) stride = measured;
    }

    const movedRows = [];
    rows.forEach(row => {
      const prevStr = row.dataset.lbPrev;
      const d = Number(row.dataset.lbDelta);
      if (prevStr === '' || !Number.isFinite(d) || d === 0) return;
      const prevIdx = Number(prevStr);
      const currIdx = Number(row.dataset.lbIdx);
      const rawOffset = (prevIdx - currIdx) * stride;
      const maxJump = stride * 14;
      const clampedOffset = Math.sign(rawOffset) * Math.min(Math.abs(rawOffset), maxJump);

      row.style.transition = 'none';
      row.style.transform = `translate3d(0, ${clampedOffset}px, 0) scale(0.992)`;
      row.style.zIndex = d > 0 ? '6' : '2';
      movedRows.push({
        row,
        prevIdx,
        currIdx,
        delta: d,
        rankEl: row.querySelector('.lb-rank')
      });
    });

    if (movedRows.length > 0) {
      lbAnimatingUntil = Date.now() + 1600;
      void listEl.offsetHeight;

      lbHoldTimer = setTimeout(() => {
        if (seq !== lbRenderSeq) return;
        requestAnimationFrame(() => {
          movedRows.forEach((m, idx) => {
            const delay = Math.min(idx * 16, 220);
            m.row.style.transition = `transform 1150ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, box-shadow 450ms ease, border-color 450ms ease`;
            m.row.style.transform = 'translate3d(0, 0, 0) scale(1)';
          });

          const animStart = performance.now();
          const animDur = 1100;
          const stepRanks = now => {
            if (seq !== lbRenderSeq) return;
            const t = Math.min(1, (now - animStart) / animDur);
            const eased = 1 - Math.pow(1 - t, 3);
            movedRows.forEach(m => {
              if (!m.rankEl) return;
              const val = Math.round((m.prevIdx + 1) + ((m.currIdx - m.prevIdx) * eased));
              m.rankEl.textContent = `#${val}`;
            });
            if (t < 1) {
              lbRankRaf = requestAnimationFrame(stepRanks);
            } else {
              movedRows.forEach(m => {
                if (m.rankEl) m.rankEl.textContent = `#${m.currIdx + 1}`;
              });
              lbRankRaf = null;
            }
          };
          lbRankRaf = requestAnimationFrame(stepRanks);

          lbCleanupTimer = setTimeout(() => {
            movedRows.forEach(m => {
              m.row.style.transition = '';
              m.row.style.transform = '';
              m.row.style.zIndex = '';
            });
            lbCleanupTimer = null;
          }, 1450);
        });
      }, 220);
    }
  }
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
  const chalBtn = $('#profileChallengeBtn');
  if (!modal || !body) return;
  if (chalBtn) {
    chalBtn.classList.add('hidden');
    chalBtn.onclick = null;
  }
  body.innerHTML = '<p class="muted tiny">Loading profile...</p>';
  modal.classList.remove('hidden');

  await Promise.all([
    loadProUserIds(),
    fetchAdminModerationState(),
    typeof loadTitleSystemState === 'function' ? loadTitleSystemState() : Promise.resolve(),
    typeof loadPlayData === 'function' ? loadPlayData() : Promise.resolve(),
    typeof loadTraderBattles === 'function' ? loadTraderBattles(false) : Promise.resolve()
  ]);
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
  const userPlayVideos = typeof getPlayVideosForUser === 'function' ? getPlayVideosForUser(p.id) : [];
  const isTargetBanned = Boolean(adminModStateCache.bans.get(p.id)?.banned);
  const isTargetPremium = isEffectivePremium(p);
  const canModerate = isDompinator() && currentUser && p.id !== currentUser.id;
  const equippedTitleId = typeof getUserEquippedTitleId === 'function' ? getUserEquippedTitleId(p.id) : null;
  const equippedTitleHtml = equippedTitleId && typeof renderTitleBadgeHtml === 'function'
    ? `<div class="profile-modal-title-slot">${renderTitleBadgeHtml(equippedTitleId)}</div>`
    : '';
  const followersCount = typeof getFollowersCount === 'function' ? getFollowersCount(p.id) : 0;
  const isFollowingTarget = typeof isFollowingUser === 'function' ? isFollowingUser(p.id) : false;
  const showFollowBtn = Boolean(currentUser && String(p.id) !== String(currentUser.id));
  if (chalBtn) {
    const activeBattle = typeof getActiveTraderBattleForUser === 'function' ? getActiveTraderBattleForUser(p.id) : null;
    const isOtherUser = Boolean(currentUser && String(p.id) !== String(currentUser.id));
    if (activeBattle) {
      chalBtn.classList.remove('hidden');
      chalBtn.classList.add('is-view-battle');
      chalBtn.textContent = '⚔️ View Battle';
      chalBtn.onclick = () => {
        if (typeof openTraderBattleInfoModal === 'function') openTraderBattleInfoModal(activeBattle.id);
      };
    } else if (isOtherUser && !isTargetBanned) {
      chalBtn.classList.remove('hidden', 'is-view-battle');
      chalBtn.textContent = '⚔️ Challenge';
      chalBtn.onclick = () => {
        if (typeof openTraderBattleChallengeModal === 'function') openTraderBattleChallengeModal(p);
      };
    } else {
      chalBtn.classList.remove('is-view-battle');
      chalBtn.classList.add('hidden');
    }
  }

  body.innerHTML = `
    <div class="profile-modal-hero">
      <div class="avatar" style="width:58px;height:58px;font-size:22px;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
      <div style="flex:1;min-width:0;">
        <div class="profile-modal-name-row">
          <h3 style="margin:0;">${escapeHtml(p.username || 'Unknown')}${tierBadgeHtml(p)}${isTargetBanned ? '<span class="banned-tag">BANNED</span>' : ''}</h3>
          ${showFollowBtn ? `<button type="button" class="play-follow-btn ${isFollowingTarget ? 'is-following' : ''}" data-follow-user="${escapeHtml(p.id)}">${isFollowingTarget ? '✓ Following' : 'Follow'}</button>` : ''}
        </div>
        ${equippedTitleHtml}
        <div class="muted tiny">${tierLabel(p)}</div>
      </div>
    </div>
    <div class="profile-modal-stats">
      <div><span class="muted tiny">NET WORTH</span><strong>${money(p.net_worth || 0)}</strong></div>
      <div><span class="muted tiny">TIME PLAYED</span><strong>${formatTime(p.time_played || 0)}</strong></div>
      <div><span class="muted tiny">FOLLOWERS</span><strong id="profileModalFollowersCount">${followersCount}</strong></div>
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
    <div style="margin-top:16px;">
      <div class="eyebrow purple-text" style="margin-bottom:8px;">PLAY VIDEOS (${userPlayVideos.length})</div>
      ${userPlayVideos.length ? `
        <div class="profile-play-videos-grid">
          ${userPlayVideos.map(v => typeof renderProfilePlayThumbHtml === 'function' ? renderProfilePlayThumbHtml(v) : '').join('')}
        </div>
      ` : '<p class="muted tiny">No Play videos uploaded yet.</p>'}
    </div>
    ${currentUser && p.id !== currentUser.id ? `
      <button type="button" class="primary-btn dm-profile-btn" id="profileStartDmBtn">💬 Send Private DM</button>
    ` : ''}
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

  $$('#profileModalBody [data-follow-user]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof toggleFollowUser === 'function') toggleFollowUser(btn.dataset.followUser);
    });
  });

  $('#profileStartDmBtn')?.addEventListener('click', () => {
    modal.classList.add('hidden');
    if (typeof openDmModalWithUser === 'function') openDmModalWithUser(p);
  });

  $$('[data-modal-coin]').forEach(el => el.addEventListener('click', () => {
    modal.classList.add('hidden');
    openCoin(el.dataset.modalCoin);
  }));

  $$('#profileModalBody [data-modal-play-vid]').forEach(el => el.addEventListener('click', () => {
    const vidId = el.dataset.modalPlayVid;
    modal.classList.add('hidden');
    if (typeof openPlayAtVideo === 'function') openPlayAtVideo(vidId);
  }));

  $$('#profileModalBody [data-modal-del-vid]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const vidId = btn.dataset.modalDelVid;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = 'Confirm?';
      setTimeout(() => {
        if (btn.isConnected && btn.dataset.armed === '1') {
          btn.dataset.armed = '0';
          btn.textContent = '🗑';
        }
      }, 3000);
      return;
    }
    if (typeof deletePlayVideo === 'function') {
      await deletePlayVideo(vidId);
      openProfileModal(p.id);
    }
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

$('#closeProfileBtn')?.addEventListener('click', () => hideModalSmooth($('#profileModal')));
$('#profileModal')?.addEventListener('click', e => {
  if (e.target === $('#profileModal')) hideModalSmooth($('#profileModal'));
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
$('#closeDailyBtn')?.addEventListener('click', () => hideModalSmooth($('#dailyModal')));
$('#dailyModal')?.addEventListener('click', e => {
  if (e.target === $('#dailyModal')) hideModalSmooth($('#dailyModal'));
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
    if (getTierRank(getUserTier(currentUser)) <= 1) {
      try { localStorage.setItem('grind_seen_tier_' + currentUser.id, 'pro'); } catch (e) {}
      triggerTierPromotionAnimation('pro');
    }
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
    if (typeof triggerRewardBurstAnimation === 'function') {
      triggerRewardBurstAnimation(btn, `+${money(cashGain)}`, `Day ${day} Daily Reward`);
    }
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
  if (typeof hideModalSmooth === 'function') hideModalSmooth($('#dailyModal'));
  else $('#dailyModal')?.classList.add('hidden');
});

// ---------- Play (Shorts / Reels + Music/ & ads/ folders) ----------
const AD_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif'];
const AD_VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
const MUSIC_AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];

function getAdType(filename) {
  const lower = String(filename || '').toLowerCase();
  if (AD_VIDEO_EXTS.some(ext => lower.endsWith(ext))) return 'video';
  if (AD_IMAGE_EXTS.some(ext => lower.endsWith(ext))) return 'image';
  return null;
}

function isMusicAudioFile(filename) {
  const lower = String(filename || '').toLowerCase();
  return MUSIC_AUDIO_EXTS.some(ext => lower.endsWith(ext));
}

function cleanMediaDisplayName(filename = '') {
  return String(filename || '').replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Track';
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
  const seen = new Set();
  const addItem = (name, fallbackUrl = null) => {
    const type = getAdType(name);
    if (!type || seen.has(name)) return;
    seen.add(name);
    items.push({
      name,
      type,
      url: 'ads/' + encodeURIComponent(name),
      fallbackUrl
    });
  };

  try {
    const res = await fetch('/api/media/ads', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.files)) data.files.forEach(n => addItem(n));
    }
  } catch (e) {}

  const repo = detectGitHubRepo();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/ads`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.filter(f => f.type === 'file').forEach(f => addItem(f.name, f.download_url || null));
      }
    }
  } catch (e) {}

  if (!items.length) {
    try {
      const res = await fetch('ads/manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) list.forEach(n => addItem(n));
      }
    } catch (e) {}
  }

  adsCache = items;
  adsCacheTime = Date.now();
  return items;
}

async function loadMusicList(force = false) {
  if (!force && musicCache && Date.now() - musicCacheTime < 60000) return musicCache;
  let items = [];
  const seen = new Set();
  const addTrack = (name, fallbackUrl = null) => {
    if (!isMusicAudioFile(name) || seen.has(name)) return;
    seen.add(name);
    items.push({
      name,
      title: cleanMediaDisplayName(name),
      url: 'Music/' + encodeURIComponent(name),
      fallbackUrl
    });
  };

  try {
    const res = await fetch('/api/media/Music', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.files)) data.files.forEach(n => addTrack(n));
    }
  } catch (e) {}

  const repo = detectGitHubRepo();
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/Music`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        data.filter(f => f.type === 'file').forEach(f => addTrack(f.name, f.download_url || null));
      }
    }
  } catch (e) {}

  if (!items.length) {
    try {
      const res = await fetch('Music/manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) list.forEach(n => addTrack(n));
      }
    } catch (e) {}
  }

  musicCache = items;
  musicCacheTime = Date.now();
  return items;
}

const PLAY_ASPECT_RATIOS = {
  '9:16': 9 / 16,
  '4:5': 4 / 5,
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9
};

function parsePlayAspectRatio(val, fallback = 9 / 16) {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.min(2.6, Math.max(0.35, val));
  }
  const s = String(val || '').trim();
  if (PLAY_ASPECT_RATIOS[s]) return PLAY_ASPECT_RATIOS[s];
  if (s.includes(':')) {
    const [w, h] = s.split(':').map(Number);
    if (w > 0 && h > 0) return Math.min(2.6, Math.max(0.35, w / h));
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return Math.min(2.6, Math.max(0.35, n));
  return fallback;
}

const PLAY_LIKE_PAYOUT = 2.00;
const PLAY_LIKER_BONUS = 0.50;
const PLAY_VIEW_PAYOUT = 0.50;
const PLAY_FOLLOW_PAYOUT = 10.00;

function getPlayUploadCost(user = currentUser) {
  const tier = getUserTier(user);
  if (tier === 'premium') return 0;
  if (tier === 'pro') return 10;
  return 50;
}

const PLAY_VIDEO_FILTERS = {
  none: 'none',
  vivid: 'saturate(1.42) contrast(1.08)',
  warm: 'sepia(0.28) saturate(1.3) brightness(1.04)',
  cool: 'hue-rotate(15deg) saturate(1.15) contrast(1.06)',
  noir: 'grayscale(1) contrast(1.22)',
  retro: 'sepia(0.45) contrast(1.12) brightness(0.95)'
};

function getPlayVideoFilterCss(name = 'none') {
  return PLAY_VIDEO_FILTERS[String(name || 'none')] || 'none';
}

const playState = {
  videos: [],
  adsList: [],
  videosById: new Map(),
  votesByVideo: new Map(),           // videoId -> Map(userId -> 'like'|'dislike'|'none')
  uniqueLikersByVideo: new Map(),    // videoId -> Set(userId) (monotonic, prevents unlike/re-like spam)
  paidKeys: new Set(),               // `${videoId}_${likerId}`
  likerPaidVideoIds: new Set(),      // videoId current user already claimed +$0.50 like bonus for
  viewsByVideo: new Map(),           // videoId -> Set(viewerId)
  paidViewKeys: new Set(),           // `${videoId}_${viewerId}`
  sessionViewedIds: new Set(),
  followersByUser: new Map(),        // targetUserId -> Set(activeFollowerId)
  followingByUser: new Map(),        // followerId -> Set(activeTargetId)
  uniqueFollowersByUser: new Map(),  // targetUserId -> Set(allTimeFollowerId) (prevents follow spam)
  paidFollowKeys: new Set(),         // `${targetUserId}_${followerId}`
  donations: [],                     // all __PLAY_DONATE__ rows
  paidDonateIds: new Set(),          // donation IDs already credited to recipient
  commentsByVideo: new Map(),        // videoId -> Array
  commentVotesById: new Map(),       // commentId -> Map(userId -> 'like'|'dislike'|'none')
  expandedCommentReplies: new Set(), // commentId set
  activeCommentReplyTarget: null,    // { parentId, replyToUserId, replyToUsername } | null
  pinnedCommentIdByVideo: new Map(), // videoId -> commentId
  boostUntilByVideo: new Map(),      // videoId -> timestamp ms
  pollVotesByVideo: new Map(),       // videoId -> Map(userId -> optionIdx)
  deletedIds: new Set(),
  rawRows: [],                 // Cached PLAY activity; only fetch rows newer than the last sync
  rawRowIds: new Set(),
  lastRowCreatedAt: '',
  syncPromise: null,
  lastSyncAt: 0,
  payingLikes: false,
  payingViews: false,
  payingFollows: false,
  payingDonations: false,
  deck: [],
  activeSlideIndex: -1,
  muted: false,
  pausedByUser: false,
  observer: null,
  activeAudio: null,
  activeVoiceAudio: null,
  previewAudio: null,
  previewBtnEl: null,
  openCommentsVideoId: null,
  pendingCommentGif: null,
  commentGifPickerOpen: false,
  commentGifSearchQuery: ''
};

let playCashQueue = Promise.resolve();
function runPlayCashUpdate(taskFn) {
  playCashQueue = playCashQueue.then(taskFn, taskFn);
  return playCashQueue;
}

async function creditPlayCashQueued(deltaAmount, onSuccessInsertRowsFn) {
  if (!sb || !currentUser?.id || !Number.isFinite(deltaAmount) || deltaAmount <= 0) return false;
  const uid = String(currentUser.id);
  return runPlayCashUpdate(async () => {
    let liveCash = Number(currentUser.cash || 0);
    try {
      const { data: prof } = await sb.from('profiles').select('cash').eq('id', uid).maybeSingle();
      if (prof && prof.cash != null) liveCash = Number(prof.cash);
    } catch (e) {}

    const newCash = Math.round((liveCash + deltaAmount) * 100) / 100;
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', uid);
    if (error) return false;

    currentUser.cash = newCash;
    if ($('#topCash')) $('#topCash').textContent = money(newCash);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(newCash);

    if (typeof onSuccessInsertRowsFn === 'function') {
      const rows = onSuccessInsertRowsFn();
      if (Array.isArray(rows) && rows.length) {
        try { await sb.from('premium_requests').insert(rows); } catch (e) {}
      }
    }
    updateNetWorth();
    $('.cash-pill')?.classList.add('cash-pulse');
    setTimeout(() => $('.cash-pill')?.classList.remove('cash-pulse'), 620);
    return true;
  });
}

async function loadPlayData(force = false) {
  if (!sb) return;
  const now = Date.now();
  // Coalesce callers and keep the feed warm while avoiding repeated full-history downloads.
  if (playState.syncPromise) return playState.syncPromise;
  if (!force && (now - playState.lastSyncAt) < 15000 && playState.videos.length) return;

  playState.syncPromise = (async () => {
  try {
    const srvResetTs = adminModStateCache.serverResetTs || 0;

    // Hydrate cached lightweight PLAY rows from localStorage on cold load so page refreshes only transfer deltas
    if (!playState.rawRows.length) {
      try {
        const rawLs = localStorage.getItem(PLAY_CACHE_LS_KEY);
        if (rawLs) {
          const parsedLs = JSON.parse(rawLs);
          if (parsedLs && Number(parsedLs.srvResetTs || 0) === Number(srvResetTs || 0) && Array.isArray(parsedLs.rows)) {
            parsedLs.rows.forEach(row => {
              if (!row || !row.reason || String(row.reason).includes('data:video/')) return;
              const rowId = String(row.id || (String(row.created_at || '') + '|' + String(row.user_id || '') + '|' + String(row.reason || '')));
              if (playState.rawRowIds.has(rowId)) return;
              playState.rawRowIds.add(rowId);
              playState.rawRows.push(row);
              if (row.created_at && (!playState.lastRowCreatedAt || row.created_at > playState.lastRowCreatedAt)) {
                playState.lastRowCreatedAt = row.created_at;
              }
            });
          }
        }
      } catch (e) {}
    }

    let query = sb
      .from('premium_requests')
      .select('id, user_id, reason, created_at, profiles(id, username, is_premium)')
      .like('reason', '__PLAY_%')
      .not('reason', 'like', '%data:video/%')
      .order('created_at', { ascending: true })
      .limit(5000);

    // First load gets non-blob history; subsequent loads & refreshes only fetch deltas.
    if (playState.rawRows.length && playState.lastRowCreatedAt) {
      query = query.gte('created_at', playState.lastRowCreatedAt);
    }
    let res = await query;

    if (res?.error) {
      let fallbackQuery = sb
        .from('premium_requests')
        .select('id, user_id, reason, created_at')
        .like('reason', '__PLAY_%')
        .not('reason', 'like', '%data:video/%')
        .order('created_at', { ascending: true })
        .limit(5000);
      if (playState.rawRows.length && playState.lastRowCreatedAt) {
        fallbackQuery = fallbackQuery.gte('created_at', playState.lastRowCreatedAt);
      }
      res = await fallbackQuery;
    }
    const incoming = res?.data;
    if (res?.error || !Array.isArray(incoming)) return;

    for (const row of incoming) {
      if (row?.profiles && row.profiles.id) saveSharedProfileToCache(row.profiles);
      const rowId = String(row.id || (String(row.created_at || '') + '|' + String(row.user_id || '') + '|' + String(row.reason || '')));
      if (playState.rawRowIds.has(rowId)) continue;
      playState.rawRowIds.add(rowId);
      playState.rawRows.push(row);
      if (row.created_at && (!playState.lastRowCreatedAt || row.created_at > playState.lastRowCreatedAt)) {
        playState.lastRowCreatedAt = row.created_at;
      }
    }
    playState.rawRows.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
    const data = playState.rawRows;

    // Persist slimmed rows in localStorage (strip nested profile bloat & huge inline blobs)
    try {
      const compactRows = data
        .filter(r => r && r.reason && String(r.reason).length <= 16000)
        .slice(-3000)
        .map(r => ({
          id: r.id,
          user_id: r.user_id,
          reason: r.reason,
          created_at: r.created_at,
          profiles: r.profiles ? { id: r.profiles.id || r.user_id, username: r.profiles.username || 'Trader', is_premium: Boolean(r.profiles.is_premium) } : undefined
        }));
      localStorage.setItem(PLAY_CACHE_LS_KEY, JSON.stringify({
        srvResetTs: Number(srvResetTs || 0),
        rows: compactRows
      }));
    } catch (e) {}

    // Hydrate cached avatars once for participating users
    const playUids = data.map(r => r.user_id).filter(Boolean);
    await ensureProfilesCached(playUids);

    const videosMap = new Map();
    const deletedIds = new Set();
    const votesByVideo = new Map();
    const uniqueLikersByVideo = new Map();
    const paidKeys = new Set();
    const likerPaidVideoIds = new Set();
    const viewsByVideo = new Map();
    const paidViewKeys = new Set();
    const followersByUser = new Map();
    const followingByUser = new Map();
    const uniqueFollowersByUser = new Map();
    const paidFollowKeys = new Set();
    const donations = [];
    const paidDonateIds = new Set();
    const commentsMapByVideo = new Map();
    const commentVotesById = new Map();
    const pinnedCommentIdByVideo = new Map();
    const boostUntilByVideo = new Map();
    const pollVotesByVideo = new Map();
    const deletedCommentIds = new Set();

    data.forEach(r => {
      const reason = String(r.reason || '');
      const rowTs = r.created_at ? new Date(r.created_at).getTime() : 0;
      const uid = String(r.user_id || '');
      if (!uid) return;

      if (reason.startsWith('__PLAY_VID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_VID__:'.length));
          if (!p?.id) return;
          const voiceUrl = typeof p.voiceoverUrl === 'string' && (p.voiceoverUrl.startsWith('https://') || p.voiceoverUrl.startsWith('data:audio/')) ? p.voiceoverUrl : '';
          const vid = {
            id: String(p.id),
            user_id: uid,
            kind: p.kind === 'video' ? 'video' : 'scene',
            title: String(p.title || '').slice(0, 80),
            bgColor: String(p.bgColor || '#161222'),
            aspectRatio: p.aspectRatio || (p.videoWidth && p.videoHeight ? (Number(p.videoWidth) / Number(p.videoHeight)) : '9:16'),
            elements: Array.isArray(p.elements) ? p.elements.slice(0, 32) : [],
            videoUrl: typeof p.videoUrl === 'string' && (p.videoUrl.startsWith('data:video/') || p.videoUrl.startsWith('https://')) ? p.videoUrl : '',
            videoFilter: String(p.videoFilter || 'none'),
            playbackRate: Math.min(2.5, Math.max(0.5, Number(p.playbackRate || 1))),
            muteOriginal: Boolean(p.muteOriginal),
            voiceoverUrl: voiceUrl,
            linkedCoinId: p.linkedCoinId ? String(p.linkedCoinId) : '',
            linkedCoinName: p.linkedCoinName ? String(p.linkedCoinName).slice(0, 40) : '',
            linkedCoinTicker: p.linkedCoinTicker ? String(p.linkedCoinTicker).slice(0, 14) : '',
            musicName: String(p.musicName || ''),
            musicUrl: String(p.musicUrl || ''),
            musicFallbackUrl: String(p.musicFallbackUrl || ''),
            musicAudioId: p.musicAudioId ? String(p.musicAudioId).slice(0, 100) : '',
            musicBakedInVideo: Boolean(p.musicBakedInVideo),
            ts: Number(p.ts) || rowTs,
            profile: getCachedProfile(uid, r.profiles)
          };
          if (vid.kind === 'video' && !vid.videoUrl) return;
          videosMap.set(vid.id, vid);
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_DEL__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_DEL__:'.length));
          if (!p?.videoId) return;
          const target = videosMap.get(String(p.videoId));
          const isAdmin = (r.profiles?.username || '').toLowerCase() === 'dompinator';
          if (target && (target.user_id === uid || isAdmin)) {
            deletedIds.add(String(p.videoId));
          }
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_VOTE__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_VOTE__:'.length));
          const vidId = String(p?.videoId || '');
          if (!vidId) return;
          let vm = votesByVideo.get(vidId);
          if (!vm) { vm = new Map(); votesByVideo.set(vidId, vm); }
          const v = p.vote === 'like' || p.vote === 'dislike' ? p.vote : 'none';
          vm.set(uid, v);
          if (v === 'like') {
            let ls = uniqueLikersByVideo.get(vidId);
            if (!ls) { ls = new Set(); uniqueLikersByVideo.set(vidId, ls); }
            ls.add(uid);
          }
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_LIKE_PAID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_LIKE_PAID__:'.length));
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          if (p?.key) paidKeys.add(String(p.key));
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_LIKER_PAID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_LIKER_PAID__:'.length));
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          if (currentUser && uid === String(currentUser.id) && p?.videoId) {
            likerPaidVideoIds.add(String(p.videoId));
          }
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_VIEW__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_VIEW__:'.length));
          const vidId = String(p?.videoId || '');
          if (!vidId) return;
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          let vs = viewsByVideo.get(vidId);
          if (!vs) { vs = new Set(); viewsByVideo.set(vidId, vs); }
          vs.add(uid);
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_VIEW_PAID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_VIEW_PAID__:'.length));
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          if (p?.key) paidViewKeys.add(String(p.key));
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_FOLLOW__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_FOLLOW__:'.length));
          const targetId = String(p?.targetUserId || '');
          if (!targetId || targetId === uid) return;
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          let folSet = followersByUser.get(targetId);
          if (!folSet) { folSet = new Set(); followersByUser.set(targetId, folSet); }
          let ingSet = followingByUser.get(uid);
          if (!ingSet) { ingSet = new Set(); followingByUser.set(uid, ingSet); }
          if (p.following) {
            folSet.add(uid);
            ingSet.add(targetId);
            let ufol = uniqueFollowersByUser.get(targetId);
            if (!ufol) { ufol = new Set(); uniqueFollowersByUser.set(targetId, ufol); }
            ufol.add(uid);
          } else {
            folSet.delete(uid);
            ingSet.delete(targetId);
          }
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_FOLLOW_PAID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_FOLLOW_PAID__:'.length));
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          if (p?.key) paidFollowKeys.add(String(p.key));
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_DONATE__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_DONATE__:'.length));
          const amt = Number(p?.amount || 0);
          if (!p?.id || !p?.toUserId || !Number.isFinite(amt) || amt <= 0) return;
          const dts = Number(p.ts) || rowTs;
          if (srvResetTs > 0 && dts > 0 && dts <= srvResetTs) return;
          donations.push({
            id: String(p.id),
            fromUserId: uid,
            fromProfile: getCachedProfile(uid, r.profiles),
            toUserId: String(p.toUserId),
            toUsername: String(p.toUsername || 'Creator'),
            videoId: p.videoId ? String(p.videoId) : '',
            videoTitle: String(p.videoTitle || '').slice(0, 80),
            amount: Math.round(amt * 100) / 100,
            note: String(p.note || '').slice(0, 120),
            ts: dts
          });
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_DONATE_PAID__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_DONATE_PAID__:'.length));
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          if (p?.donationId) paidDonateIds.add(String(p.donationId));
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_CMT__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_CMT__:'.length));
          const vidId = String(p?.videoId || '');
          const cleanGif = typeof sanitizeGifUrl === 'function' ? sanitizeGifUrl(p?.gif_url) : '';
          const cleanText = String(p?.text || '').trim();
          if (!vidId || !p?.id || (!cleanText && !cleanGif)) return;
          let arr = commentsMapByVideo.get(vidId);
          if (!arr) { arr = []; commentsMapByVideo.set(vidId, arr); }
          arr.push({
            id: String(p.id),
            videoId: vidId,
            user_id: uid,
            parent_id: p.parent_id ? String(p.parent_id) : null,
            reply_to_user_id: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
            reply_to_username: p.reply_to_username ? String(p.reply_to_username) : null,
            text: String(p.text || ''),
            gif_url: cleanGif,
            gif_title: String(p.gif_title || 'GIF').slice(0, 80),
            ts: Number(p.ts) || rowTs,
            profile: getCachedProfile(uid, r.profiles)
          });
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_CMT_VOTE__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_CMT_VOTE__:'.length));
          if (!p?.commentId || !p?.videoId) return;
          let vm = commentVotesById.get(String(p.commentId));
          if (!vm) { vm = new Map(); commentVotesById.set(String(p.commentId), vm); }
          vm.set(uid, p.vote === 'like' || p.vote === 'dislike' ? p.vote : 'none');
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_CMT_DEL__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_CMT_DEL__:'.length));
          if (p?.commentId) deletedCommentIds.add(String(p.commentId));
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_CMT_PIN__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_CMT_PIN__:'.length));
          const vidId = String(p?.videoId || '');
          if (!vidId) return;
          const targetVid = videosMap.get(vidId);
          const isAdmin = (r.profiles?.username || '').toLowerCase() === 'dompinator';
          if (targetVid && (String(targetVid.user_id) === uid || isAdmin)) {
            if (p.commentId) pinnedCommentIdByVideo.set(vidId, String(p.commentId));
            else pinnedCommentIdByVideo.delete(vidId);
          }
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_BOOST__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_BOOST__:'.length));
          const vidId = String(p?.videoId || '');
          const until = Number(p?.boostUntil || 0);
          if (!vidId || !Number.isFinite(until) || until <= 0) return;
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          const prevUntil = boostUntilByVideo.get(vidId) || 0;
          if (until > prevUntil) boostUntilByVideo.set(vidId, until);
        } catch (e) {}
      } else if (reason.startsWith('__PLAY_POLL_VOTE__:')) {
        try {
          const p = JSON.parse(reason.slice('__PLAY_POLL_VOTE__:'.length));
          const vidId = String(p?.videoId || '');
          const optIdx = Number(p?.optionIndex);
          if (!vidId || !Number.isInteger(optIdx) || optIdx < 0 || optIdx > 3) return;
          if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) return;
          let pm = pollVotesByVideo.get(vidId);
          if (!pm) { pm = new Map(); pollVotesByVideo.set(vidId, pm); }
          pm.set(uid, optIdx);
        } catch (e) {}
      }
    });

    deletedIds.forEach(id => videosMap.delete(id));
    const delUsers = adminModStateCache.deletedUserIds || new Set();
    commentsMapByVideo.forEach((arr, vidId) => {
      const aliveRaw = arr.filter(c => !deletedCommentIds.has(c.id) && !delUsers.has(String(c.user_id)));
      const topIds = new Set(aliveRaw.filter(c => !c.parent_id).map(c => c.id));
      const alive = aliveRaw.filter(c => !c.parent_id || topIds.has(c.parent_id));
      commentsMapByVideo.set(vidId, alive);
      const pinId = pinnedCommentIdByVideo.get(vidId);
      if (pinId && !topIds.has(pinId)) {
        pinnedCommentIdByVideo.delete(vidId);
      }
    });

    const list = Array.from(videosMap.values()).sort((a, b) => b.ts - a.ts);
    playState.videos = list;
    playState.videosById = videosMap;
    playState.deletedIds = deletedIds;
    playState.votesByVideo = votesByVideo;
    playState.uniqueLikersByVideo = uniqueLikersByVideo;
    playState.paidKeys = paidKeys;
    playState.likerPaidVideoIds = likerPaidVideoIds;
    playState.viewsByVideo = viewsByVideo;
    playState.paidViewKeys = paidViewKeys;
    playState.followersByUser = followersByUser;
    playState.followingByUser = followingByUser;
    playState.uniqueFollowersByUser = uniqueFollowersByUser;
    playState.paidFollowKeys = paidFollowKeys;
    playState.donations = donations.sort((a, b) => b.ts - a.ts);
    playState.paidDonateIds = paidDonateIds;
    playState.commentsByVideo = commentsMapByVideo;
    playState.commentVotesById = commentVotesById;
    playState.pinnedCommentIdByVideo = pinnedCommentIdByVideo;
    playState.boostUntilByVideo = boostUntilByVideo;
    playState.pollVotesByVideo = pollVotesByVideo;
    playState.lastSyncAt = Date.now();
  } catch (e) {
    console.warn('PLAY data sync failed:', e);
  } finally {
    playState.syncPromise = null;
  }
  })();
  return playState.syncPromise;
}

function getPlayBoostUntil(videoId) {
  return Number(playState.boostUntilByVideo.get(String(videoId || '')) || 0);
}

function isPlayVideoBoosted(videoId) {
  return getPlayBoostUntil(videoId) > Date.now();
}

function formatPlayBoostRemaining(ms) {
  const rem = Math.max(0, Number(ms || 0));
  if (rem <= 0) return 'Expired';
  const totalMins = Math.ceil(rem / 60000);
  const days = Math.floor(totalMins / 1440);
  const hrs = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hrs}h left`;
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${Math.max(1, mins)}m left`;
}

function getPlayPollSummary(videoId, pollEl) {
  const opts = Array.isArray(pollEl?.options) ? pollEl.options.slice(0, 4) : [];
  const counts = new Array(opts.length).fill(0);
  const pm = videoId ? playState.pollVotesByVideo.get(String(videoId)) : null;
  let totalVotes = 0;
  let myOption = -1;
  if (pm) {
    pm.forEach((optIdx, uid) => {
      if (optIdx >= 0 && optIdx < counts.length) {
        counts[optIdx] += 1;
        totalVotes += 1;
        if (currentUser && uid === String(currentUser.id)) myOption = optIdx;
      }
    });
  }
  return {
    question: String(pollEl?.question || 'Poll'),
    options: opts,
    counts,
    totalVotes,
    myOption
  };
}

function renderPlayPollCardHtml(pollEl, videoId = '', editable = false) {
  const sum = editable
    ? {
        question: String(pollEl?.question || 'Poll'),
        options: Array.isArray(pollEl?.options) ? pollEl.options.slice(0, 4) : [],
        counts: new Array((pollEl?.options || []).length).fill(0),
        totalVotes: 0,
        myOption: -1
      }
    : getPlayPollSummary(videoId, pollEl);
  const showResults = !editable && (sum.totalVotes > 0 || sum.myOption >= 0);
  return `
    <div class="play-poll-card" ${videoId ? `data-play-poll-card="${escapeHtml(videoId)}"` : ''}>
      <div class="play-poll-q">📊 ${escapeHtml(sum.question)}</div>
      <div class="play-poll-opts">
        ${sum.options.map((opt, idx) => {
          const cnt = sum.counts[idx] || 0;
          const pct = sum.totalVotes > 0 ? Math.round((cnt / sum.totalVotes) * 100) : 0;
          const voted = sum.myOption === idx;
          return `
            <button type="button" class="play-poll-opt-btn ${voted ? 'is-voted' : ''}" ${!editable && videoId ? `data-play-poll-opt="${idx}" data-vid="${escapeHtml(videoId)}"` : 'disabled'}>
              <span class="play-poll-bar" style="width:${showResults ? pct : 0}%;"></span>
              <span class="play-poll-opt-label">${voted ? '✓ ' : ''}${escapeHtml(opt)}</span>
              <span class="play-poll-opt-pct">${showResults ? `${pct}%` : ''}</span>
            </button>`;
        }).join('')}
      </div>
      <div class="play-poll-foot">${sum.totalVotes} vote${sum.totalVotes === 1 ? '' : 's'}</div>
    </div>`;
}

async function handlePlayPollVote(videoId, optionIndex) {
  if (!sb || !currentUser?.id || !videoId) return;
  const vidId = String(videoId);
  const vid = playState.videosById.get(vidId);
  const pollEl = (vid?.elements || []).find(el => el && el.type === 'poll');
  if (!pollEl || !Array.isArray(pollEl.options)) return;
  const optIdx = Number(optionIndex);
  if (!Number.isInteger(optIdx) || optIdx < 0 || optIdx >= pollEl.options.length) return;

  const uid = String(currentUser.id);
  let pm = playState.pollVotesByVideo.get(vidId);
  if (!pm) { pm = new Map(); playState.pollVotesByVideo.set(vidId, pm); }
  pm.set(uid, optIdx);

  const updatedHtml = renderPlayPollCardHtml(pollEl, vidId, false);
  document.querySelectorAll(`[data-play-poll-card="${CSS.escape(vidId)}"]`).forEach(cardEl => {
    const wrap = document.createElement('div');
    wrap.innerHTML = updatedHtml.trim();
    const fresh = wrap.firstElementChild;
    if (fresh) {
      cardEl.replaceWith(fresh);
      fresh.querySelectorAll('[data-play-poll-opt]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          handlePlayPollVote(btn.dataset.vid, Number(btn.dataset.playPollOpt));
        });
      });
    }
  });

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_POLL_VOTE__:' + JSON.stringify({ videoId: vidId, optionIndex: optIdx, ts: Date.now() }),
    status: 'denied'
  });
  if (error) {
    toast('Could not save poll vote: ' + error.message);
  }
}

function getPlayVoteSummary(videoId) {
  const vidId = String(videoId || '');
  const vm = playState.votesByVideo.get(vidId);
  let likes = 0;
  let dislikes = 0;
  let myVote = 'none';
  if (vm) {
    vm.forEach((v, uid) => {
      if (v === 'like') likes += 1;
      else if (v === 'dislike') dislikes += 1;
      if (currentUser && uid === String(currentUser.id)) myVote = v;
    });
  }
  const uniqueLikers = playState.uniqueLikersByVideo.get(vidId);
  const vid = playState.videosById.get(vidId);
  let paidLikersCount = 0;
  if (uniqueLikers && vid) {
    uniqueLikers.forEach(uid => {
      if (uid !== String(vid.user_id)) paidLikersCount += 1;
    });
  }
  const viewsSet = playState.viewsByVideo.get(vidId);
  const views = viewsSet ? viewsSet.size : 0;
  let paidViewersCount = 0;
  if (viewsSet && vid) {
    viewsSet.forEach(uid => {
      if (uid !== String(vid.user_id)) paidViewersCount += 1;
    });
  }
  const commentsCount = (playState.commentsByVideo.get(vidId) || []).length;
  return { likes, dislikes, myVote, paidLikersCount, commentsCount, views, paidViewersCount };
}

function getPlayVideosForUser(userId) {
  const target = String(userId || '');
  return (playState.videos || []).filter(v => String(v.user_id) === target);
}

function isFollowingUser(targetUserId) {
  if (!currentUser?.id || !targetUserId) return false;
  const set = playState.followingByUser.get(String(currentUser.id));
  return Boolean(set && set.has(String(targetUserId)));
}

function getFollowersCount(userId) {
  const set = playState.followersByUser.get(String(userId || ''));
  return set ? set.size : 0;
}

function getFollowingCount(userId) {
  const set = playState.followingByUser.get(String(userId || ''));
  return set ? set.size : 0;
}

function updateFollowUiForUser(targetUserId) {
  const tid = String(targetUserId || '');
  const isFol = isFollowingUser(tid);
  const count = getFollowersCount(tid);
  document.querySelectorAll(`[data-follow-user="${CSS.escape(tid)}"]`).forEach(btn => {
    btn.classList.toggle('is-following', isFol);
    btn.textContent = isFol ? '✓ Following' : 'Follow';
  });
  const profCountEl = $('#profileModalFollowersCount');
  if (profCountEl && document.querySelector(`#profileModalBody [data-follow-user="${CSS.escape(tid)}"]`)) {
    profCountEl.textContent = String(count);
  }
  if (typeof renderAccountIdentityAndTitles === 'function') {
    renderAccountIdentityAndTitles();
  }
}

async function toggleFollowUser(targetUserId) {
  if (!sb || !currentUser?.id || !targetUserId) return;
  const uid = String(currentUser.id);
  const tid = String(targetUserId);
  if (uid === tid) return toast('You cannot follow yourself.');

  const prevFol = isFollowingUser(tid);
  const nextFol = !prevFol;

  let folSet = playState.followersByUser.get(tid);
  if (!folSet) { folSet = new Set(); playState.followersByUser.set(tid, folSet); }
  let ingSet = playState.followingByUser.get(uid);
  if (!ingSet) { ingSet = new Set(); playState.followingByUser.set(uid, ingSet); }

  if (nextFol) {
    folSet.add(uid);
    ingSet.add(tid);
    let ufol = playState.uniqueFollowersByUser.get(tid);
    if (!ufol) { ufol = new Set(); playState.uniqueFollowersByUser.set(tid, ufol); }
    ufol.add(uid);
  } else {
    folSet.delete(uid);
    ingSet.delete(tid);
  }

  updateFollowUiForUser(tid);

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_FOLLOW__:' + JSON.stringify({ targetUserId: tid, following: nextFol, ts: Date.now() }),
    status: 'denied'
  });
  if (error) {
    toast('Follow failed: ' + error.message);
    return;
  }
  toast(nextFol ? 'Following creator! Their Shorts will show up more often.' : 'Unfollowed creator.');
}

async function recordPlayVideoView(videoId) {
  if (!sb || !currentUser?.id || !videoId) return;
  const vidId = String(videoId);
  const uid = String(currentUser.id);
  const viewsSet = playState.viewsByVideo.get(vidId) || new Set();
  if (viewsSet.has(uid) || playState.sessionViewedIds.has(vidId)) return;

  playState.sessionViewedIds.add(vidId);
  viewsSet.add(uid);
  playState.viewsByVideo.set(vidId, viewsSet);

  const newCount = viewsSet.size;
  document.querySelectorAll(`[data-play-views="${CSS.escape(vidId)}"]`).forEach(el => {
    el.textContent = `👁 ${newCount}`;
  });

  try {
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__PLAY_VIEW__:' + JSON.stringify({ videoId: vidId, ts: Date.now() }),
      status: 'denied'
    });
  } catch (e) {}
}

async function syncPlayLikeEarnings() {
  if (!sb || !currentUser?.id || playState.payingLikes) return;
  const uid = String(currentUser.id);
  const myVideos = getPlayVideosForUser(uid);
  if (!myVideos.length) return;

  const unpaid = [];
  myVideos.forEach(v => {
    const likers = playState.uniqueLikersByVideo.get(v.id);
    if (!likers) return;
    likers.forEach(likerId => {
      if (likerId === uid) return;
      const key = `${v.id}_${likerId}`;
      const localKey = `grind_play_paid_${uid}_${key}`;
      if (playState.paidKeys.has(key)) return;
      try {
        if (localStorage.getItem(localKey) === '1') return;
      } catch (e) {}
      unpaid.push({ key, localKey, videoId: v.id, likerId });
    });
  });

  if (!unpaid.length) return;
  playState.payingLikes = true;
  try {
    const earned = Math.round(unpaid.length * PLAY_LIKE_PAYOUT * 100) / 100;
    const ok = await creditPlayCashQueued(earned, () => unpaid.map(item => {
      playState.paidKeys.add(item.key);
      try { localStorage.setItem(item.localKey, '1'); } catch (e) {}
      return {
        user_id: uid,
        reason: '__PLAY_LIKE_PAID__:' + JSON.stringify({
          key: item.key,
          videoId: item.videoId,
          likerId: item.likerId,
          amount: PLAY_LIKE_PAYOUT,
          ts: Date.now()
        }),
        status: 'denied'
      };
    }));
    if (ok) {
      if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
      toast(`▶ +${money(earned)} earned from ${unpaid.length} new Play like${unpaid.length === 1 ? '' : 's'}!`);
    }
  } finally {
    playState.payingLikes = false;
  }
}

async function syncPlayViewEarnings() {
  if (!sb || !currentUser?.id || playState.payingViews) return;
  const uid = String(currentUser.id);
  const myVideos = getPlayVideosForUser(uid);
  if (!myVideos.length) return;

  const unpaid = [];
  myVideos.forEach(v => {
    const viewers = playState.viewsByVideo.get(v.id);
    if (!viewers) return;
    viewers.forEach(viewerId => {
      if (viewerId === uid) return;
      const key = `${v.id}_${viewerId}`;
      const localKey = `grind_play_view_paid_${uid}_${key}`;
      if (playState.paidViewKeys.has(key)) return;
      try {
        if (localStorage.getItem(localKey) === '1') return;
      } catch (e) {}
      unpaid.push({ key, localKey, videoId: v.id, viewerId });
    });
  });

  if (!unpaid.length) return;
  playState.payingViews = true;
  try {
    const earned = Math.round(unpaid.length * PLAY_VIEW_PAYOUT * 100) / 100;
    const ok = await creditPlayCashQueued(earned, () => unpaid.map(item => {
      playState.paidViewKeys.add(item.key);
      try { localStorage.setItem(item.localKey, '1'); } catch (e) {}
      return {
        user_id: uid,
        reason: '__PLAY_VIEW_PAID__:' + JSON.stringify({
          key: item.key,
          videoId: item.videoId,
          viewerId: item.viewerId,
          amount: PLAY_VIEW_PAYOUT,
          ts: Date.now()
        }),
        status: 'denied'
      };
    }));
    if (ok) {
      if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
      toast(`👁 +${money(earned)} earned from ${unpaid.length} new video view${unpaid.length === 1 ? '' : 's'}!`);
    }
  } finally {
    playState.payingViews = false;
  }
}

async function syncPlayFollowEarnings() {
  if (!sb || !currentUser?.id || playState.payingFollows) return;
  const uid = String(currentUser.id);
  const myFol = playState.uniqueFollowersByUser.get(uid);
  if (!myFol || !myFol.size) return;

  const unpaid = [];
  myFol.forEach(followerId => {
    if (followerId === uid) return;
    const key = `${uid}_${followerId}`;
    const localKey = `grind_play_fol_paid_${uid}_${followerId}`;
    if (playState.paidFollowKeys.has(key)) return;
    try {
      if (localStorage.getItem(localKey) === '1') return;
    } catch (e) {}
    unpaid.push({ key, localKey, followerId });
  });

  if (!unpaid.length) return;
  playState.payingFollows = true;
  try {
    const earned = Math.round(unpaid.length * PLAY_FOLLOW_PAYOUT * 100) / 100;
    const ok = await creditPlayCashQueued(earned, () => unpaid.map(item => {
      playState.paidFollowKeys.add(item.key);
      try { localStorage.setItem(item.localKey, '1'); } catch (e) {}
      return {
        user_id: uid,
        reason: '__PLAY_FOLLOW_PAID__:' + JSON.stringify({
          key: item.key,
          targetUserId: uid,
          followerId: item.followerId,
          amount: PLAY_FOLLOW_PAYOUT,
          ts: Date.now()
        }),
        status: 'denied'
      };
    }));
    if (ok) {
      toast(`👤 +${money(earned)} earned from ${unpaid.length} new follower${unpaid.length === 1 ? '' : 's'}!`);
    }
  } finally {
    playState.payingFollows = false;
  }
}

async function syncPlayDonations() {
  if (!sb || !currentUser?.id || playState.payingDonations) return;
  const uid = String(currentUser.id);
  const unpaid = (playState.donations || []).filter(d => {
    if (String(d.toUserId) !== uid || String(d.fromUserId) === uid) return false;
    if (playState.paidDonateIds.has(d.id)) return false;
    try {
      if (localStorage.getItem(`grind_donate_paid_${uid}_${d.id}`) === '1') return false;
    } catch (e) {}
    return true;
  });
  if (!unpaid.length) return;

  playState.payingDonations = true;
  try {
    const earned = Math.round(unpaid.reduce((sum, d) => sum + Number(d.amount || 0), 0) * 100) / 100;
    if (earned <= 0) return;
    const ok = await creditPlayCashQueued(earned, () => unpaid.map(d => {
      playState.paidDonateIds.add(d.id);
      try { localStorage.setItem(`grind_donate_paid_${uid}_${d.id}`, '1'); } catch (e) {}
      return {
        user_id: uid,
        reason: '__PLAY_DONATE_PAID__:' + JSON.stringify({
          donationId: d.id,
          amount: d.amount,
          ts: Date.now()
        }),
        status: 'denied'
      };
    }));
    if (ok) {
      toast(`💛 Received ${money(earned)} in video donations!`);
    }
  } finally {
    playState.payingDonations = false;
  }
}

function syncAllPlayEarnings() {
  syncPlayLikeEarnings();
  syncPlayViewEarnings();
  syncPlayFollowEarnings();
  syncPlayDonations();
}

function stopActivePlayMedia() {
  if (playState.activeAudio) {
    try { playState.activeAudio.pause(); } catch (e) {}
    playState.activeAudio = null;
  }
  if (playState.activeVoiceAudio) {
    try { playState.activeVoiceAudio.pause(); } catch (e) {}
    playState.activeVoiceAudio = null;
  }
  $$('#playFeedTrack video').forEach(v => {
    try { v.pause(); } catch (e) {}
  });
}

function stopMusicPreviewAudio() {
  if (playState.previewAudio) {
    try { playState.previewAudio.pause(); } catch (e) {}
    playState.previewAudio = null;
  }
  if (playState.previewBtnEl) {
    playState.previewBtnEl.textContent = '▶ Test';
    playState.previewBtnEl = null;
  }
}

function cleanupPlay() {
  stopActivePlayMedia();
  stopMusicPreviewAudio();
  if (playState.observer) {
    try { playState.observer.disconnect(); } catch (e) {}
    playState.observer = null;
  }
  playState.activeSlideIndex = -1;
  playState.openCommentsVideoId = null;
  playState.activeCommentReplyTarget = null;
  $('#playCommentsDrawer')?.classList.add('hidden');
  setPlayCommentGifPickerOpen(false);
}

function renderPlaySceneElementsHtml(elements = [], videoId = '') {
  return (Array.isArray(elements) ? elements : []).map(el => {
    const x = Math.min(94, Math.max(6, Number(el.x ?? 50)));
    const y = Math.min(92, Math.max(8, Number(el.y ?? 50)));
    const scale = Math.min(2.6, Math.max(0.45, Number(el.scale ?? 1)));
    const rot = Math.min(180, Math.max(-180, Number(el.rot ?? 0)));
    const opacity = Math.min(1, Math.max(0.25, Number(el.opacity ?? 1)));
    const animCls = ['pulse', 'float', 'spin'].includes(el.anim) ? ` play-anim-${el.anim}` : '';
    const transformStyle = `left:${x}%;top:${y}%;opacity:${opacity};transform:translate(-50%,-50%) scale(${scale}) rotate(${rot}deg);`;

    if (el.type === 'poll' && el.question && Array.isArray(el.options) && el.options.length >= 2) {
      return `
        <div class="play-canvas-item is-poll${animCls}" style="${transformStyle}">
          ${renderPlayPollCardHtml(el, videoId, false)}
        </div>`;
    }
    if (el.type === 'gif' && el.gifUrl) {
      const cleanUrl = typeof sanitizeGifUrl === 'function' ? sanitizeGifUrl(el.gifUrl) : '';
      if (!cleanUrl) return '';
      return `
        <div class="play-canvas-item is-gif${animCls}" style="${transformStyle}">
          <img src="${escapeHtml(cleanUrl)}" alt="GIF" loading="lazy" draggable="false">
        </div>`;
    }
    if (el.type === 'photo' && el.photoUrl && String(el.photoUrl).startsWith('data:image/')) {
      return `
        <div class="play-canvas-item is-photo${animCls}" style="${transformStyle}">
          <img src="${escapeHtml(el.photoUrl)}" alt="Photo" loading="lazy" draggable="false">
        </div>`;
    }
    if (el.type === 'sticker' && el.emoji) {
      return `
        <div class="play-canvas-item is-sticker${animCls}" style="${transformStyle}">
          <span>${escapeHtml(el.emoji)}</span>
        </div>`;
    }
    if (el.type === 'text' && el.text) {
      const styleCls = el.style === 'plain' ? 'style-plain' : (el.style === 'outline' ? 'style-outline' : 'style-pill');
      const fontCls = ['impact', 'mono', 'serif'].includes(el.font) ? ` play-font-${el.font}` : ' play-font-sans';
      const color = /^#[0-9a-fA-F]{3,8}$/.test(String(el.color || '')) ? el.color : '#ffffff';
      return `
        <div class="play-canvas-item is-text ${styleCls}${fontCls}${animCls}" style="${transformStyle}color:${escapeHtml(color)};">
          ${escapeHtml(el.text)}
        </div>`;
    }
    return '';
  }).join('');
}

function getTotalPlayPoolCount() {
  return (playState.videos?.length || 0) + (playState.adsList?.length || 0);
}

function pickNextRandomPlayItem(lastUniqueKey = '') {
  const videos = playState.videos || [];
  const ads = playState.adsList || [];
  const totalUnique = videos.length + ads.length;
  if (totalUnique === 0) return null;

  if (totalUnique === 1) {
    if (lastUniqueKey) return null;
    if (videos.length === 1) {
      return { slideType: 'video', uniqueKey: 'vid:' + videos[0].id, id: videos[0].id, video: videos[0] };
    }
    return { slideType: 'ad', uniqueKey: 'ad:' + ads[0].name, id: 'ad_' + ads[0].name, ad: ads[0] };
  }

  const availVideos = videos.filter(v => ('vid:' + v.id) !== lastUniqueKey);
  const availAds = ads.filter(a => ('ad:' + a.name) !== lastUniqueKey);

  let pickAd = false;
  if (availVideos.length > 0 && availAds.length > 0) {
    pickAd = Math.random() < 0.22;
  } else if (availVideos.length === 0) {
    pickAd = true;
  }

  if (pickAd && availAds.length > 0) {
    const ad = availAds[Math.floor(Math.random() * availAds.length)];
    return { slideType: 'ad', uniqueKey: 'ad:' + ad.name, id: 'ad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), ad };
  }
  const pool = availVideos.length ? availVideos : videos;
  // Boost selection chance (3.5x weight) for creators you follow OR boosted videos
  const weights = pool.map(v => {
    const fol = isFollowingUser(v.user_id);
    const boosted = isPlayVideoBoosted(v.id);
    if (fol && boosted) return 5.0;
    if (fol || boosted) return 3.5;
    return 1;
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  let r = Math.random() * totalWeight;
  let vid = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      vid = pool[i];
      break;
    }
  }
  return { slideType: 'video', uniqueKey: 'vid:' + vid.id, id: vid.id, video: vid };
}

function buildInitialPlayDeck(videos, adsList, focusVideoId = null, batchSize = 10) {
  playState.adsList = Array.isArray(adsList) ? adsList : [];
  const deck = [];
  let lastKey = '';

  if (focusVideoId) {
    const focused = (videos || []).find(v => v.id === String(focusVideoId));
    if (focused) {
      lastKey = 'vid:' + focused.id;
      deck.push({ slideType: 'video', uniqueKey: lastKey, id: focused.id, video: focused });
    }
  }

  const targetLen = getTotalPlayPoolCount() <= 1 ? 1 : batchSize;
  while (deck.length < targetLen) {
    const next = pickNextRandomPlayItem(lastKey);
    if (!next) break;
    lastKey = next.uniqueKey;
    deck.push(next);
  }
  return deck;
}

function syncPlayMuteUi() {
  const btn = $('#playMuteAllBtn');
  if (btn) btn.textContent = playState.muted ? '🔇 Muted' : '🔊 Sound On';
  $$('#playFeedTrack video').forEach(v => {
    const forceMute = v.dataset.forceMute === '1';
    v.muted = forceMute || playState.muted;
  });
  if (playState.activeAudio) playState.activeAudio.muted = playState.muted;
  if (playState.activeVoiceAudio) playState.activeVoiceAudio.muted = playState.muted;
}

function createPlayableAudioElement(url, fallbackUrl = '') {
  const s = String(url || '');
  const isVideoCarrier = /\.(mp4|webm)(\?|$)/i.test(s) || s.startsWith('data:video/');
  const el = isVideoCarrier ? document.createElement('video') : new Audio();
  if (isVideoCarrier) el.playsInline = true;
  el.src = s;
  el.onerror = () => {
    if (fallbackUrl && !el.dataset.fallbackTried) {
      el.dataset.fallbackTried = '1';
      el.src = fallbackUrl;
      el.play().catch(() => {});
    }
  };
  return el;
}

function activatePlaySlide(index) {
  const slides = $$('#playFeedTrack .play-slide');
  if (!slides.length || index < 0 || index >= slides.length) return;
  if (playState.activeSlideIndex === index) return;

  stopActivePlayMedia();
  playState.activeSlideIndex = index;
  playState.pausedByUser = false;

  const slideEl = slides[index];
  slides.forEach((s, i) => s.classList.toggle('is-active', i === index));

  const item = playState.deck[index];
  if (!item) return;

  const vidEl = slideEl.querySelector('video.play-media-video');
  const musicUrl = item.slideType === 'video' ? item.video.musicUrl : '';
  const musicFallback = item.slideType === 'video' ? item.video.musicFallbackUrl : '';
  const musicAlreadyBaked = item.slideType === 'video' && Boolean(item.video.musicBakedInVideo);
  const voiceUrl = item.slideType === 'video' ? item.video.voiceoverUrl : '';
  const muteOrig = item.slideType === 'video' ? Boolean(item.video.muteOriginal) : false;
  const speed = item.slideType === 'video' ? Math.min(2.5, Math.max(0.5, Number(item.video.playbackRate || 1))) : 1;

  if (item.slideType === 'video' && item.video?.id) {
    recordPlayVideoView(item.video.id);
  }

  if (vidEl) {
    vidEl.currentTime = 0;
    try { vidEl.playbackRate = speed; } catch (e) {}
    vidEl.muted = muteOrig || playState.muted;
    vidEl.play().catch(() => {
      vidEl.muted = true;
      vidEl.play().catch(() => {});
    });
  }

  if (musicUrl && !musicAlreadyBaked) {
    const audio = createPlayableAudioElement(musicUrl, musicFallback);
    audio.loop = true;
    audio.muted = playState.muted;
    audio.volume = voiceUrl ? 0.42 : 0.54;
    playState.activeAudio = audio;
    audio.play().catch(() => {});
  }

  if (voiceUrl) {
    const voice = new Audio(voiceUrl);
    voice.loop = true;
    voice.muted = playState.muted;
    voice.volume = 0.96;
    playState.activeVoiceAudio = voice;
    voice.play().catch(() => {});
  }

  // Continuously extend infinite random stream before reaching the end
  if (index >= playState.deck.length - 4 && getTotalPlayPoolCount() >= 2) {
    appendRandomPlaySlides(6);
  }
}

function toggleActiveSlidePause(slideEl) {
  if (!slideEl) return;
  const idx = Number(slideEl.dataset.slideIdx);
  if (idx !== playState.activeSlideIndex) return;
  playState.pausedByUser = !playState.pausedByUser;
  const vidEl = slideEl.querySelector('video.play-media-video');
  const pauseBadge = slideEl.querySelector('.play-pause-badge');
  if (playState.pausedByUser) {
    if (vidEl) try { vidEl.pause(); } catch (e) {}
    if (playState.activeAudio) try { playState.activeAudio.pause(); } catch (e) {}
    if (playState.activeVoiceAudio) try { playState.activeVoiceAudio.pause(); } catch (e) {}
    pauseBadge?.classList.remove('hidden');
  } else {
    if (vidEl) vidEl.play().catch(() => {});
    if (playState.activeAudio) playState.activeAudio.play().catch(() => {});
    if (playState.activeVoiceAudio) playState.activeVoiceAudio.play().catch(() => {});
    pauseBadge?.classList.add('hidden');
  }
}

function createPlaySlideHtml(item, idx) {
  if (item.slideType === 'ad') {
    const ad = item.ad;
    const initAr = ad.type === 'video' ? 16 / 9 : 1;
    return `
      <article class="play-slide play-slide-ad" data-slide-idx="${idx}">
        <div class="play-phone-frame">
          <div class="play-media-surface" data-play-tap="${idx}" style="--play-ar-num:${initAr.toFixed(4)};aspect-ratio:${initAr.toFixed(4)};">
            ${ad.type === 'video'
              ? `<video class="play-media-video" src="${escapeHtml(ad.url)}" playsinline loop preload="metadata" data-fallback-src="${escapeHtml(ad.fallbackUrl || '')}"></video>`
              : `<img class="play-media-img" src="${escapeHtml(ad.url)}" alt="${escapeHtml(ad.name)}" data-fallback-src="${escapeHtml(ad.fallbackUrl || '')}">`}
            <div class="play-pause-badge hidden">❚❚</div>
            <div class="play-scrim-bottom"></div>
            <div class="play-meta-bottom">
              <span class="play-ad-pill">SPONSORED · AD</span>
              <div class="play-video-title">${escapeHtml(cleanMediaDisplayName(ad.name))}</div>
              <div class="muted tiny">Scroll up or down anytime to keep browsing Play.</div>
            </div>
          </div>
        </div>
      </article>`;
  }

  const v = item.video;
  const sum = getPlayVoteSummary(v.id);
  const prof = getCachedProfile(v.user_id, v.profile);
  const uname = prof.username || 'Trader';
  const equippedTid = typeof getUserEquippedTitleId === 'function' ? getUserEquippedTitleId(v.user_id) : null;
  const titleHtml = equippedTid && typeof renderTitleBadgeHtml === 'function' ? renderTitleBadgeHtml(equippedTid, true) : '';
  const canDel = currentUser && (String(currentUser.id) === String(v.user_id) || isDompinator());
  const isOwnVid = currentUser && String(currentUser.id) === String(v.user_id);
  const isFol = isFollowingUser(v.user_id);
  const isBoosted = isPlayVideoBoosted(v.id);
  const arNum = parsePlayAspectRatio(v.aspectRatio, 9 / 16);
  const filterCss = getPlayVideoFilterCss(v.videoFilter);
  const forceMute = Boolean(v.muteOriginal);
  const speedTag = v.kind === 'video' && Number(v.playbackRate || 1) !== 1 ? `<span class="play-speed-pill">${Number(v.playbackRate)}x</span>` : '';

  return `
    <article class="play-slide" data-slide-idx="${idx}" data-video-id="${escapeHtml(v.id)}">
      <div class="play-phone-frame">
        <div class="play-media-surface" data-play-tap="${idx}" style="--play-ar-num:${arNum.toFixed(4)};aspect-ratio:${arNum.toFixed(4)};background:${v.kind === 'scene' ? escapeHtml(v.bgColor) : '#090710'};">
          ${v.kind === 'video'
            ? `<video class="play-media-video" src="${escapeHtml(v.videoUrl)}" playsinline loop preload="metadata" data-force-mute="${forceMute ? '1' : '0'}" style="filter:${escapeHtml(filterCss)};"></video>`
            : `<div class="play-scene-layer">${renderPlaySceneElementsHtml(v.elements, v.id)}</div>`}
          <div class="play-pause-badge hidden">❚❚</div>
          <div class="play-scrim-bottom"></div>
          <div class="play-meta-bottom">
            <div class="play-creator-row">
              <div class="avatar play-creator-av" data-play-profile="${escapeHtml(v.user_id)}">${prof.avatar_url ? `<img src="${escapeHtml(prof.avatar_url)}">` : escapeHtml(uname[0].toUpperCase())}</div>
              <div class="play-creator-meta">
                <div class="play-creator-name">
                  <span class="play-creator-name-text" data-play-profile="${escapeHtml(v.user_id)}">${escapeHtml(uname)}${tierBadgeHtml(prof)}</span>
                  ${!isOwnVid ? `<button type="button" class="play-follow-btn ${isFol ? 'is-following' : ''}" data-follow-user="${escapeHtml(v.user_id)}">${isFol ? '✓ Following' : 'Follow'}</button>` : ''}
                  <button type="button" class="play-donate-plus-btn" data-play-donate="${escapeHtml(v.id)}" data-donate-user="${escapeHtml(v.user_id)}" title="Donate to ${escapeHtml(uname)}" aria-label="Donate to ${escapeHtml(uname)}">＋</button>
                </div>
                ${isBoosted ? `<div class="play-boosted-subtext">⚡ Boosted</div>` : ''}
                ${titleHtml ? `<div class="play-creator-title">${titleHtml}</div>` : ''}
              </div>
            </div>
            ${v.title ? `<div class="play-video-title">${escapeHtml(v.title)} ${speedTag}</div>` : (speedTag ? `<div>${speedTag}</div>` : '')}
            <div class="play-chips-row">
              <span class="play-views-tag" data-play-views="${escapeHtml(v.id)}">👁 ${sum.views}</span>
              ${v.musicName ? `<button type="button" class="play-music-chip play-music-chip-btn" data-play-song="${escapeHtml(v.id)}" title="Download or use this sound">♫ ${escapeHtml(cleanMediaDisplayName(v.musicName))} <span class="play-chip-use-tag">Use</span></button>` : ''}
              ${v.voiceoverUrl ? `<div class="play-vo-chip">🎙 Voiceover</div>` : ''}
              ${v.linkedCoinId ? `<button type="button" class="play-linked-coin-chip" data-play-coin="${escapeHtml(v.linkedCoinId)}">◈ ${escapeHtml(v.linkedCoinName || 'Coin')} ($${escapeHtml(v.linkedCoinTicker || 'COIN')}) →</button>` : ''}
            </div>
          </div>
        </div>

        <div class="play-action-rail">
          <button type="button" class="play-rail-btn ${sum.myVote === 'like' ? 'is-liked' : ''}" data-play-vote="like" data-vid="${escapeHtml(v.id)}" title="${isOwnVid ? 'Likes on your video' : 'Like (+$0.50 you / +$2 creator)'}">
            <span class="play-rail-icon">♥</span>
            <span class="play-rail-count">${sum.likes}</span>
          </button>
          <button type="button" class="play-rail-btn ${sum.myVote === 'dislike' ? 'is-disliked' : ''}" data-play-vote="dislike" data-vid="${escapeHtml(v.id)}" title="Dislike">
            <span class="play-rail-icon">👎</span>
            <span class="play-rail-count">${sum.dislikes}</span>
          </button>
          <button type="button" class="play-rail-btn" data-play-comment="${escapeHtml(v.id)}" title="Comments">
            <span class="play-rail-icon">💬</span>
            <span class="play-rail-count">${sum.commentsCount}</span>
          </button>
          ${canDel ? `
            <button type="button" class="play-rail-btn is-danger" data-play-delete="${escapeHtml(v.id)}" title="Delete video">
              <span class="play-rail-icon">🗑</span>
              <span class="play-rail-count">Del</span>
            </button>
          ` : ''}
        </div>
      </div>
    </article>`;
}

function wirePlaySlideInteractions(slideEl) {
  if (!slideEl) return;

  // Dynamic video/img file aspect ratio detection
  const surface = slideEl.querySelector('.play-media-surface');
  const vidEl = slideEl.querySelector('video.play-media-video');
  const imgEl = slideEl.querySelector('img.play-media-img');
  if (vidEl && surface) {
    const applyVidAr = () => {
      if (vidEl.videoWidth > 0 && vidEl.videoHeight > 0) {
        const ar = Math.min(2.6, Math.max(0.35, vidEl.videoWidth / vidEl.videoHeight));
        surface.style.setProperty('--play-ar-num', ar.toFixed(4));
        surface.style.aspectRatio = ar.toFixed(4);
      }
    };
    if (vidEl.readyState >= 1) applyVidAr();
    vidEl.addEventListener('loadedmetadata', applyVidAr);
  }
  if (imgEl && surface) {
    const applyImgAr = () => {
      if (imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
        const ar = Math.min(2.6, Math.max(0.35, imgEl.naturalWidth / imgEl.naturalHeight));
        surface.style.setProperty('--play-ar-num', ar.toFixed(4));
        surface.style.aspectRatio = ar.toFixed(4);
      }
    };
    if (imgEl.complete) applyImgAr();
    imgEl.addEventListener('load', applyImgAr);
  }

  // Fallback URL for ads
  slideEl.querySelectorAll('[data-fallback-src]').forEach(el => {
    const fb = el.dataset.fallbackSrc;
    if (!fb) return;
    el.addEventListener('error', () => {
      if (el.dataset.fbTried) return;
      el.dataset.fbTried = '1';
      el.src = fb;
      if (el.tagName === 'VIDEO') el.play().catch(() => {});
    });
  });

  // Tap to pause/play
  slideEl.querySelectorAll('[data-play-tap]').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-play-profile],[data-follow-user],[data-play-donate],[data-play-coin],[data-play-song],[data-play-poll-opt],.play-poll-card')) return;
      toggleActiveSlidePause(slideEl);
    });
  });

  // Poll vote buttons
  slideEl.querySelectorAll('[data-play-poll-opt]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handlePlayPollVote(btn.dataset.vid, Number(btn.dataset.playPollOpt));
    });
  });

  // Song chip click (download / use sound)
  slideEl.querySelectorAll('[data-play-song]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.playSong) openPlayUseSongModal(btn.dataset.playSong);
    });
  });

  // Creator profile click
  slideEl.querySelectorAll('[data-play-profile]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      openProfileModal(el.dataset.playProfile);
    });
  });

  // White Follow button click
  slideEl.querySelectorAll('[data-follow-user]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFollowUser(btn.dataset.followUser);
    });
  });

  // Yellow '+' Donation button click
  slideEl.querySelectorAll('[data-play-donate]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPlayDonateModal(btn.dataset.playDonate, btn.dataset.donateUser);
    });
  });

  // Linked coin click
  slideEl.querySelectorAll('[data-play-coin]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.playCoin) openCoin(btn.dataset.playCoin);
    });
  });

  // Vote buttons
  slideEl.querySelectorAll('[data-play-vote]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      handlePlayVote(btn.dataset.vid, btn.dataset.playVote);
    });
  });

  // Comment drawer buttons
  slideEl.querySelectorAll('[data-play-comment]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPlayCommentsDrawer(btn.dataset.playComment);
    });
  });

  // Delete video buttons
  slideEl.querySelectorAll('[data-play-delete]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const vidId = btn.dataset.playDelete;
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        const lbl = btn.querySelector('.play-rail-count');
        if (lbl) lbl.textContent = 'Sure?';
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            btn.dataset.armed = '0';
            if (lbl) lbl.textContent = 'Del';
          }
        }, 3000);
        return;
      }
      await deletePlayVideo(vidId);
    });
  });
}

function appendRandomPlaySlides(count = 6) {
  const track = $('#playFeedTrack');
  if (!track || getTotalPlayPoolCount() < 2) return;
  let lastKey = playState.deck.length ? playState.deck[playState.deck.length - 1].uniqueKey : '';
  const startIdx = playState.deck.length;
  const newItems = [];
  for (let i = 0; i < count; i++) {
    const next = pickNextRandomPlayItem(lastKey);
    if (!next) break;
    lastKey = next.uniqueKey;
    playState.deck.push(next);
    newItems.push({ item: next, idx: startIdx + newItems.length });
  }
  if (!newItems.length) return;

  const temp = document.createElement('div');
  temp.innerHTML = newItems.map(x => createPlaySlideHtml(x.item, x.idx)).join('');
  Array.from(temp.children).forEach(slideEl => {
    track.appendChild(slideEl);
    wirePlaySlideInteractions(slideEl);
    if (playState.observer) playState.observer.observe(slideEl);
  });
}

function renderPlayFeed(focusVideoId = null) {
  const track = $('#playFeedTrack');
  if (!track) return;

  stopActivePlayMedia();
  if (playState.observer) {
    try { playState.observer.disconnect(); } catch (e) {}
    playState.observer = null;
  }
  playState.activeSlideIndex = -1;

  if (!playState.deck.length) {
    track.innerHTML = `
      <div class="play-empty-slide">
        <div class="empty-icon">▶</div>
        <h3>No Play Videos Yet</h3>
        <p class="muted" style="max-width:340px;">Press <strong>← Back</strong> and click <strong>UPLOAD</strong> under Play in the sidebar to create or upload the first video! Earn <strong>$2</strong> per like and <strong>$0.50</strong> per view.</p>
      </div>`;
    return;
  }

  track.innerHTML = playState.deck.map((item, idx) => createPlaySlideHtml(item, idx)).join('');
  $$('#playFeedTrack .play-slide').forEach(slideEl => wirePlaySlideInteractions(slideEl));

  const slides = $$('#playFeedTrack .play-slide');
  if ('IntersectionObserver' in window) {
    playState.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          const idx = Number(entry.target.dataset.slideIdx);
          if (Number.isFinite(idx)) activatePlaySlide(idx);
        }
      });
    }, { root: track, threshold: [0.6] });
    slides.forEach(s => playState.observer.observe(s));
  }

  track.scrollTop = 0;
  requestAnimationFrame(() => activatePlaySlide(0));
}

async function startPlayPage(focusVideoId = null, openComments = false, forceRefresh = false) {
  cleanupPlay();
  const track = $('#playFeedTrack');
  if (track) {
    track.innerHTML = '<div class="play-empty-slide"><p class="muted">Loading Play feed...</p></div>';
  }
  const [adsList] = await Promise.all([
    loadAdsList(false),
    loadPlayData(forceRefresh),
    loadMusicList(false)
  ]);
  syncAllPlayEarnings();
  if (currentPage !== 'play') return;
  playState.deck = buildInitialPlayDeck(playState.videos, adsList, focusVideoId, 10);
  renderPlayFeed(focusVideoId);
  if (openComments && focusVideoId) {
    openPlayCommentsDrawer(focusVideoId);
  }
}

function openPlayAtVideo(videoId, openComments = false) {
  if (currentPage === 'play') {
    startPlayPage(videoId, openComments);
    return;
  }
  currentPage = 'play';
  $('#appView')?.classList.add('play-fullscreen');
  $$('.page').forEach(p => p.classList.add('hidden'));
  $('#page-play')?.classList.remove('hidden');
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === 'play'));
  $('#pageTitle').textContent = 'Play';
  if (typeof syncPremiumAmbientMusic === 'function') syncPremiumAmbientMusic();
  startPlayPage(videoId, openComments);
}

async function handlePlayVote(videoId, voteType) {
  if (!sb || !currentUser?.id || !videoId) return;
  const vidId = String(videoId);
  const uid = String(currentUser.id);
  const prevSum = getPlayVoteSummary(vidId);
  const nextVote = prevSum.myVote === voteType ? 'none' : voteType;
  const vid = playState.videosById.get(vidId);

  const hadEverLiked = Boolean(playState.uniqueLikersByVideo.get(vidId)?.has(uid));

  let vm = playState.votesByVideo.get(vidId);
  if (!vm) { vm = new Map(); playState.votesByVideo.set(vidId, vm); }
  vm.set(uid, nextVote);
  if (nextVote === 'like') {
    let ls = playState.uniqueLikersByVideo.get(vidId);
    if (!ls) { ls = new Set(); playState.uniqueLikersByVideo.set(vidId, ls); }
    ls.add(uid);
  }

  // Update ALL matching slides in infinite scroll without recreating video elements
  const newSum = getPlayVoteSummary(vidId);
  document.querySelectorAll(`#playFeedTrack .play-slide[data-video-id="${CSS.escape(vidId)}"]`).forEach(slideEl => {
    const likeBtn = slideEl.querySelector('[data-play-vote="like"]');
    const dislikeBtn = slideEl.querySelector('[data-play-vote="dislike"]');
    if (likeBtn) {
      likeBtn.classList.toggle('is-liked', newSum.myVote === 'like');
      const c = likeBtn.querySelector('.play-rail-count');
      if (c) c.textContent = String(newSum.likes);
    }
    if (dislikeBtn) {
      dislikeBtn.classList.toggle('is-disliked', newSum.myVote === 'dislike');
      const c = dislikeBtn.querySelector('.play-rail-count');
      if (c) c.textContent = String(newSum.dislikes);
    }
  });

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_VOTE__:' + JSON.stringify({ videoId: vidId, vote: nextVote, ts: Date.now() }),
    status: 'denied'
  });
  if (error) {
    toast('Vote failed: ' + error.message);
    return;
  }

  // Personal +$0.50 bonus when liking someone else's video (anti-spam: strictly once per video)
  if (nextVote === 'like' && !hadEverLiked && vid && String(vid.user_id) !== uid) {
    const localKey = `grind_liker_bonus_${uid}_${vidId}`;
    let alreadyClaimed = playState.likerPaidVideoIds.has(vidId);
    if (!alreadyClaimed) {
      try { alreadyClaimed = localStorage.getItem(localKey) === '1'; } catch (e) {}
    }
    if (!alreadyClaimed) {
      playState.likerPaidVideoIds.add(vidId);
      try { localStorage.setItem(localKey, '1'); } catch (e) {}
      const paidOk = await creditPlayCashQueued(PLAY_LIKER_BONUS, () => ([{
        user_id: currentUser.id,
        reason: '__PLAY_LIKER_PAID__:' + JSON.stringify({ videoId: vidId, amount: PLAY_LIKER_BONUS, ts: Date.now() }),
        status: 'denied'
      }]));
      if (paidOk) {
        toast(`♥ +${money(PLAY_LIKER_BONUS)} earned for liking!`);
      }
    }
  }
}

async function deletePlayVideo(videoId) {
  if (!sb || !currentUser?.id || !videoId) return;
  const vid = playState.videosById.get(String(videoId));
  if (!vid) return;
  if (String(vid.user_id) !== String(currentUser.id) && !isDompinator()) {
    toast('You can only delete your own videos.');
    return;
  }
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_DEL__:' + JSON.stringify({ videoId: String(videoId), ts: Date.now() }),
    status: 'denied'
  });
  if (error) {
    toast('Could not delete video: ' + error.message);
    return;
  }
  if (
    (vid.kind === 'video' && /^https:\/\/raw\.githubusercontent\.com\//i.test(String(vid.videoUrl || ''))) ||
    (vid.musicAudioId && /^https:\/\/raw\.githubusercontent\.com\//i.test(String(vid.musicUrl || '')))
  ) {
    try {
      await deletePlayVideoFileFromGitHub(vid);
    } catch (cleanupError) {
      console.warn('PLAY media file cleanup failed:', cleanupError);
    }
  }
  playState.deletedIds.add(String(videoId));
  playState.videos = playState.videos.filter(v => v.id !== String(videoId));
  playState.videosById.delete(String(videoId));
  toast('Video deleted');
  if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
  if (currentPage === 'play') {
    const ads = await loadAdsList(false);
    playState.deck = buildInitialPlayDeck(playState.videos, ads, null, 10);
    renderPlayFeed();
  }
}

function renderProfilePlayThumbHtml(v) {
  const sum = getPlayVoteSummary(v.id);
  const canDel = currentUser && (String(currentUser.id) === String(v.user_id) || isDompinator());
  return `
    <div class="profile-play-thumb-card" data-modal-play-vid="${escapeHtml(v.id)}">
      <div class="profile-play-thumb-stage" style="background:${v.kind === 'scene' ? escapeHtml(v.bgColor) : '#0d0917'};">
        ${v.kind === 'video'
          ? `<video src="${escapeHtml(v.videoUrl)}" muted playsinline preload="metadata"></video><span class="play-thumb-kind-tag">VIDEO</span>`
          : `<div class="play-scene-layer play-scene-thumb">${renderPlaySceneElementsHtml(v.elements)}</div><span class="play-thumb-kind-tag">SHORT</span>`}
      </div>
      <div class="profile-play-thumb-meta">
        <div class="profile-play-thumb-title">${escapeHtml(v.title || 'Untitled Short')}</div>
        <div class="profile-play-thumb-stats">
          <span>👁 ${sum.views} view${sum.views === 1 ? '' : 's'}</span>
          <span>♥ ${sum.likes}</span>
          <span>💬 ${sum.commentsCount}</span>
          ${canDel ? `<button type="button" class="zoom-btn play-thumb-del-btn" data-modal-del-vid="${escapeHtml(v.id)}" title="Delete video">🗑</button>` : ''}
        </div>
      </div>
    </div>`;
}

function renderAccountPlayVideos() {
  const grid = $('#accountPlayVideosGrid');
  const countEl = $('#accountPlayVideosCount');
  if (!grid || !currentUser) return;
  const mine = getPlayVideosForUser(currentUser.id);
  if (countEl) countEl.textContent = `${mine.length} video${mine.length === 1 ? '' : 's'}`;
  if (!mine.length) {
    grid.innerHTML = `<div class="muted tiny">No Play videos yet. Click <strong>UPLOAD</strong> under Play in the sidebar to Create a Short or Upload a Video! Earn <strong>$2</strong> per like &amp; <strong>$0.50</strong> per unique view.</div>`;
    return;
  }
  grid.innerHTML = mine.map(v => {
    const sum = getPlayVoteSummary(v.id);
    const earned = Math.round(((sum.paidLikersCount * PLAY_LIKE_PAYOUT) + (sum.paidViewersCount * PLAY_VIEW_PAYOUT)) * 100) / 100;
    const boostUntil = getPlayBoostUntil(v.id);
    const boosted = boostUntil > Date.now();
    return `
      <div class="account-play-video-card">
        <div class="account-play-thumb" data-acc-watch-vid="${escapeHtml(v.id)}" style="background:${v.kind === 'scene' ? escapeHtml(v.bgColor) : '#0d0917'};">
          ${v.kind === 'video'
            ? `<video src="${escapeHtml(v.videoUrl)}" muted playsinline preload="metadata"></video>`
            : `<div class="play-scene-layer play-scene-thumb">${renderPlaySceneElementsHtml(v.elements, v.id)}</div>`}
        </div>
        <div class="account-play-meta">
          <div class="account-play-title">${escapeHtml(v.title || 'Untitled Short')}</div>
          <div class="muted tiny">👁 ${sum.views} view${sum.views === 1 ? '' : 's'} · ♥ ${sum.likes} · 👎 ${sum.dislikes} · 💬 ${sum.commentsCount} · Earned <strong style="color:var(--green);">${money(earned)}</strong>${boosted ? ` · <span style="color:#c084fc;font-weight:800;">⚡ Boosted (${escapeHtml(formatPlayBoostRemaining(boostUntil - Date.now()))})</span>` : ''}</div>
          <div class="account-play-actions">
            <button type="button" class="zoom-btn" data-acc-watch-vid="${escapeHtml(v.id)}">▶ Watch</button>
            <button type="button" class="play-boost-bolt-btn ${boosted ? 'is-boosted' : ''}" data-acc-boost-vid="${escapeHtml(v.id)}" title="Boost Video ($399 1d / $500 2d)">⚡${boosted ? ' Boosted' : ''}</button>
            <button type="button" class="deny-btn" data-acc-del-vid="${escapeHtml(v.id)}" style="padding:5px 11px;font-size:12px;">Delete</button>
          </div>
        </div>
      </div>`;
  }).join('');

  $$('#accountPlayVideosGrid [data-acc-watch-vid]').forEach(el => {
    el.addEventListener('click', () => openPlayAtVideo(el.dataset.accWatchVid));
  });
  $$('#accountPlayVideosGrid [data-acc-boost-vid]').forEach(btn => {
    btn.addEventListener('click', () => openPlayBoostModal(btn.dataset.accBoostVid));
  });
  $$('#accountPlayVideosGrid [data-acc-del-vid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vidId = btn.dataset.accDelVid;
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = 'Confirm Delete';
        setTimeout(() => {
          if (btn.isConnected && btn.dataset.armed === '1') {
            btn.dataset.armed = '0';
            btn.textContent = 'Delete';
          }
        }, 3200);
        return;
      }
      await deletePlayVideo(vidId);
    });
  });
}

// ---------- Play Video Boost ($399 1 Day / $500 2 Days) ----------
let activeBoostVideoId = '';
let playBoostBusy = false;

function openPlayBoostModal(videoId) {
  if (!currentUser || !videoId) return;
  const vid = playState.videosById.get(String(videoId));
  if (!vid || String(vid.user_id) !== String(currentUser.id)) return;
  activeBoostVideoId = String(videoId);
  const metaEl = $('#playBoostVideoMeta');
  const noteEl = $('#playBoostStatusNote');
  const cashEl = $('#playBoostCashAvail');
  const msgEl = $('#playBoostMsg');
  if (metaEl) metaEl.textContent = vid.title || 'Untitled Short';
  if (msgEl) msgEl.textContent = '';
  if (cashEl) cashEl.textContent = `Available cash: ${money(currentUser.cash || 0)}`;
  const until = getPlayBoostUntil(activeBoostVideoId);
  if (noteEl) {
    if (until > Date.now()) {
      noteEl.textContent = `⚡ Currently Boosted — ${formatPlayBoostRemaining(until - Date.now())}. Buying another boost extends this duration!`;
      noteEl.classList.remove('hidden');
    } else {
      noteEl.classList.add('hidden');
    }
  }
  $('#playBoostModal')?.classList.remove('hidden');
}

function closePlayBoostModal() {
  activeBoostVideoId = '';
  hideModalSmooth($('#playBoostModal'));
}

$('#closePlayBoostBtn')?.addEventListener('click', closePlayBoostModal);
$('#playBoostModal')?.addEventListener('click', e => {
  if (e.target === $('#playBoostModal')) closePlayBoostModal();
});

$$('#playBoostModal [data-boost-days]').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (!sb || !currentUser?.id || !activeBoostVideoId || playBoostBusy) return;
    const days = Number(btn.dataset.boostDays || 1);
    const cost = Number(btn.dataset.boostCost || 399);
    const msgEl = $('#playBoostMsg');
    if (msgEl) msgEl.textContent = '';
    playBoostBusy = true;
    $$('#playBoostModal [data-boost-days]').forEach(b => { b.disabled = true; });

    try {
      const chargeRes = await runPlayCashUpdate(async () => {
        let liveCash = Number(currentUser.cash || 0);
        try {
          const { data: prof } = await sb.from('profiles').select('cash').eq('id', currentUser.id).maybeSingle();
          if (prof && prof.cash != null) liveCash = Number(prof.cash);
        } catch (e) {}
        if (liveCash + 0.0001 < cost) {
          return { ok: false, error: `You need ${money(cost)} to boost for ${days} day${days === 1 ? '' : 's'} (you have ${money(liveCash)}).` };
        }
        const nextCash = Math.round(Math.max(0, liveCash - cost) * 100) / 100;
        const { error: updErr } = await sb.from('profiles').update({ cash: nextCash }).eq('id', currentUser.id);
        if (updErr) return { ok: false, error: updErr.message };
        currentUser.cash = nextCash;
        if ($('#topCash')) $('#topCash').textContent = money(nextCash);
        if ($('#moneyCash')) $('#moneyCash').textContent = money(nextCash);
        updateNetWorth();
        return { ok: true, charged: cost };
      });

      if (!chargeRes.ok) {
        if (msgEl) msgEl.textContent = chargeRes.error;
        return;
      }

      const now = Date.now();
      const baseUntil = Math.max(now, getPlayBoostUntil(activeBoostVideoId));
      const boostUntil = baseUntil + days * 24 * 60 * 60 * 1000;
      const { error: reqErr } = await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__PLAY_BOOST__:' + JSON.stringify({
          videoId: activeBoostVideoId,
          days,
          cost,
          boostUntil,
          ts: now
        }),
        status: 'denied'
      });

      if (reqErr) {
        await refundPlayUploadFee(cost);
        if (msgEl) msgEl.textContent = 'Boost failed: ' + reqErr.message;
        return;
      }

      playState.boostUntilByVideo.set(activeBoostVideoId, boostUntil);
      playSound('buy');
      closePlayBoostModal();
      renderAccountPlayVideos();
      toast(`⚡ Video Boosted for ${days} day${days === 1 ? '' : 's'} (-${money(cost)})!`);
    } finally {
      playBoostBusy = false;
      $$('#playBoostModal [data-boost-days]').forEach(b => { b.disabled = false; });
    }
  });
});

// ---------- Play Comments Drawer + Pinned Comments + GIPHY ----------
function setPlayCommentGifPickerOpen(open) {
  playState.commentGifPickerOpen = Boolean(open);
  const picker = $('#playCommentGifPicker');
  const plusBtn = $('#playCommentPlusBtn');
  if (picker) picker.classList.toggle('hidden', !playState.commentGifPickerOpen);
  if (plusBtn) {
    plusBtn.classList.toggle('active', playState.commentGifPickerOpen);
    plusBtn.setAttribute('aria-expanded', playState.commentGifPickerOpen ? 'true' : 'false');
  }
  if (playState.commentGifPickerOpen) {
    loadPlayCommentGifs(playState.commentGifSearchQuery);
    setTimeout(() => $('#playCommentGifSearchInput')?.focus(), 40);
  }
}

function renderPlayCommentGifPreview() {
  const box = $('#playCommentGifPreview');
  if (!box) return;
  if (!playState.pendingCommentGif) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  box.innerHTML = `
    <div class="comment-gif-preview-chip">
      <img src="${escapeHtml(playState.pendingCommentGif.previewUrl)}" alt="${escapeHtml(playState.pendingCommentGif.title)}">
      <div><strong>GIF Ready</strong><span class="muted tiny">Will post with your comment</span></div>
      <button type="button" class="zoom-btn" id="playRemoveCommentGifBtn" aria-label="Remove selected GIF">✕</button>
    </div>`;
  $('#playRemoveCommentGifBtn')?.addEventListener('click', () => {
    playState.pendingCommentGif = null;
    renderPlayCommentGifPreview();
  });
}

async function loadPlayCommentGifs(query = '') {
  const grid = $('#playCommentGifGrid');
  const statusEl = $('#playCommentGifStatus');
  if (!grid || typeof fetchGiphyGifs !== 'function') return;
  grid.innerHTML = '<p class="muted tiny" style="grid-column:1/-1;padding:12px 4px;text-align:center;">Loading GIFs from GIPHY...</p>';
  const res = await fetchGiphyGifs(query, 24);
  if (statusEl) {
    if (res.error) { statusEl.textContent = res.error; statusEl.classList.remove('hidden'); }
    else { statusEl.textContent = ''; statusEl.classList.add('hidden'); }
  }
  if (!res.gifs.length) {
    grid.innerHTML = '<p class="muted tiny" style="grid-column:1/-1;padding:14px 6px;text-align:center;">No GIFs found — try another search or paste a giphy.com link.</p>';
    return;
  }
  grid.innerHTML = res.gifs.map((g, idx) => `
    <button type="button" class="dm-gif-tile" data-play-cmt-gif-idx="${idx}" title="${escapeHtml(g.title)}">
      <img src="${escapeHtml(g.previewUrl)}" alt="${escapeHtml(g.title)}" loading="lazy">
    </button>
  `).join('');
  $$('#playCommentGifGrid [data-play-cmt-gif-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const picked = res.gifs[Number(btn.dataset.playCmtGifIdx)];
      if (!picked) return;
      playState.pendingCommentGif = picked;
      setPlayCommentGifPickerOpen(false);
      renderPlayCommentGifPreview();
      $('#playCommentInput')?.focus();
    });
  });
}

async function togglePinPlayComment(videoId, commentId) {
  if (!sb || !currentUser?.id || !videoId) return;
  const vid = playState.videosById.get(String(videoId));
  if (!vid) return;
  if (String(vid.user_id) !== String(currentUser.id) && !isDompinator()) {
    toast('Only the video creator can pin comments.');
    return;
  }
  const curPin = playState.pinnedCommentIdByVideo.get(String(videoId)) || null;
  const nextPin = curPin === String(commentId) ? null : String(commentId);
  if (nextPin) playState.pinnedCommentIdByVideo.set(String(videoId), nextPin);
  else playState.pinnedCommentIdByVideo.delete(String(videoId));
  renderPlayCommentsDrawerList();

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_CMT_PIN__:' + JSON.stringify({ videoId: String(videoId), commentId: nextPin, ts: Date.now() }),
    status: 'denied'
  });
  if (error) {
    toast('Pin failed: ' + error.message);
    return;
  }
  toast(nextPin ? '📌 Comment pinned!' : 'Comment unpinned');
}

async function votePlayComment(videoId, commentId, currentVote, clickedType) {
  if (!sb || !currentUser?.id || !videoId || !commentId) return;
  const uid = String(currentUser.id);
  const cid = String(commentId);
  const nextVote = currentVote === clickedType ? 'none' : clickedType;

  let vm = playState.commentVotesById.get(cid);
  if (!vm) { vm = new Map(); playState.commentVotesById.set(cid, vm); }
  vm.set(uid, nextVote);
  renderPlayCommentsDrawerList();

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_CMT_VOTE__:' + JSON.stringify({
      videoId: String(videoId),
      commentId: cid,
      vote: nextVote,
      ts: Date.now()
    }),
    status: 'denied'
  });
  if (error) {
    toast('Vote error: ' + error.message);
  }
}

async function postPlayReplyComment(videoId, replyTarget) {
  if (!sb || !currentUser?.id || !videoId || !replyTarget?.parentId) return;
  const input = $(`#playReplyInput-${replyTarget.parentId}`);
  const sendBtn = $(`#playSendReplyBtn-${replyTarget.parentId}`);
  const text = (input?.value || '').trim();
  if (!text) return toast('Write a reply first!');
  if (text.length > 400) return toast('Reply must be 400 characters or less.');
  if (sendBtn) sendBtn.disabled = true;

  const payload = {
    id: 'pcmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    videoId: String(videoId),
    text: text.slice(0, 400),
    parent_id: String(replyTarget.parentId),
    ...(replyTarget.replyToUserId ? { reply_to_user_id: String(replyTarget.replyToUserId) } : {}),
    ...(replyTarget.replyToUsername ? { reply_to_username: String(replyTarget.replyToUsername) } : {}),
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_CMT__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (sendBtn) sendBtn.disabled = false;
  if (error) return toast('Reply error: ' + error.message);

  playSound('commenting');
  playState.expandedCommentReplies.add(String(replyTarget.parentId));
  playState.activeCommentReplyTarget = null;
  toast('Reply posted!');
  await loadPlayData(true);
  renderPlayCommentsDrawerList();
}

function renderPlayCommentsDrawerList() {
  const listEl = $('#playCommentsList');
  const titleEl = $('#playCommentsTitle');
  const vidId = playState.openCommentsVideoId;
  if (!listEl || !vidId) return;

  const rawCmts = playState.commentsByVideo.get(vidId) || [];
  const topComments = [];
  const repliesByParent = new Map();

  rawCmts.forEach(c => {
    if (!c.parent_id) topComments.push(c);
  });
  const activeTopIds = new Set(topComments.map(c => c.id));
  let totalVisibleCount = topComments.length;

  rawCmts.forEach(c => {
    if (!c.parent_id || !activeTopIds.has(c.parent_id)) return;
    const arr = repliesByParent.get(c.parent_id) || [];
    arr.push(c);
    repliesByParent.set(c.parent_id, arr);
    totalVisibleCount += 1;
  });

  let pinnedId = playState.pinnedCommentIdByVideo.get(vidId) || null;
  if (pinnedId && !activeTopIds.has(pinnedId)) {
    pinnedId = null;
  }

  topComments.sort((a, b) => {
    if (a.id === pinnedId && b.id !== pinnedId) return -1;
    if (b.id === pinnedId && a.id !== pinnedId) return 1;
    return b.ts - a.ts;
  });
  repliesByParent.forEach(arr => arr.sort((a, b) => a.ts - b.ts));

  if (titleEl) titleEl.textContent = `Comments (${totalVisibleCount})`;
  document.querySelectorAll(`#playFeedTrack .play-slide[data-video-id="${CSS.escape(vidId)}"] [data-play-comment] .play-rail-count`)
    .forEach(el => { el.textContent = String(totalVisibleCount); });

  if (!topComments.length) {
    listEl.innerHTML = '<div class="empty-state" style="padding:26px 12px;"><p class="muted tiny">No comments yet. Be the first to comment!</p></div>';
    return;
  }

  const vid = playState.videosById.get(vidId);
  const creatorUsername = vid?.profile?.username || 'Creator';
  const isViewerVidCreator = Boolean(currentUser && vid && (String(vid.user_id) === String(currentUser.id) || isDompinator()));
  const myAv = currentUser?.avatar_url
    ? `<img src="${escapeHtml(currentUser.avatar_url)}">`
    : escapeHtml((currentUser?.username || 'G')[0].toUpperCase());

  const renderVoteBtns = (cm) => {
    const vm = playState.commentVotesById.get(cm.id);
    let likes = 0;
    let dislikes = 0;
    if (vm) {
      vm.forEach(v => {
        if (v === 'like') likes += 1;
        else if (v === 'dislike') dislikes += 1;
      });
    }
    const myVote = currentUser && vm ? (vm.get(String(currentUser.id)) || 'none') : 'none';
    return `
      <button type="button" class="cmt-action-btn ${myVote === 'like' ? 'liked' : ''}" data-play-cmt-vote="like" data-cid="${escapeHtml(cm.id)}" data-cur="${escapeHtml(myVote)}" title="Like">
        ${THUMB_UP_SVG}<span>${likes}</span>
      </button>
      <button type="button" class="cmt-action-btn ${myVote === 'dislike' ? 'disliked' : ''}" data-play-cmt-vote="dislike" data-cid="${escapeHtml(cm.id)}" data-cur="${escapeHtml(myVote)}" title="Dislike">
        ${THUMB_DOWN_SVG}<span>${dislikes}</span>
      </button>
    `;
  };

  listEl.innerHTML = topComments.map(c => {
    const prof = getCachedProfile(c.user_id, c.profile);
    const uname = prof.username || 'Trader';
    const isPinned = c.id === pinnedId;
    const isCommenterCreator = Boolean(vid && String(c.user_id) === String(vid.user_id));
    const canDel = currentUser && (String(c.user_id) === String(currentUser.id) || isViewerVidCreator);
    const replies = repliesByParent.get(c.id) || [];
    const isExpanded = playState.expandedCommentReplies.has(c.id);
    const isReplyingHere = playState.activeCommentReplyTarget && playState.activeCommentReplyTarget.parentId === c.id;

    const repliesHtml = replies.map(rp => {
      const rProf = getCachedProfile(rp.user_id, rp.profile);
      const rUname = rProf.username || 'Trader';
      const rIsCreator = Boolean(vid && String(rp.user_id) === String(vid.user_id));
      const rCanDel = currentUser && (String(rp.user_id) === String(currentUser.id) || isViewerVidCreator);
      const mentionHtml = rp.reply_to_username && String(rp.reply_to_user_id) !== String(c.user_id)
        ? `<span class="cmt-reply-mention">@${escapeHtml(rp.reply_to_username)}</span>`
        : '';
      return `
        <div class="comment-item reply-item" data-play-cmt-id="${escapeHtml(rp.id)}">
          <div class="avatar" data-play-cmt-prof="${escapeHtml(rp.user_id)}">${rProf.avatar_url ? `<img src="${escapeHtml(rProf.avatar_url)}">` : escapeHtml(rUname[0].toUpperCase())}</div>
          <div class="comment-main">
            <div class="comment-meta">
              <strong class="profile-link" data-play-cmt-prof="${escapeHtml(rp.user_id)}">${escapeHtml(rUname)}${tierBadgeHtml(rProf)}</strong>
              ${rIsCreator ? '<span class="comment-creator-tag">Creator</span>' : ''}
              <span class="comment-time">${escapeHtml(formatRelativeTime(rp.ts))}</span>
            </div>
            ${rp.text ? `<div class="comment-text">${mentionHtml}${escapeHtml(rp.text).replace(/\n/g, '<br>')}</div>` : (mentionHtml ? `<div class="comment-text">${mentionHtml}</div>` : '')}
            ${rp.gif_url ? `<div class="comment-gif-wrap"><img src="${escapeHtml(rp.gif_url)}" alt="${escapeHtml(rp.gif_title || 'GIF')}" loading="lazy"></div>` : ''}
            <div class="comment-actions">
              ${renderVoteBtns(rp)}
              <button type="button" class="cmt-action-btn" data-play-cmt-reply="${escapeHtml(c.id)}" data-reply-uid="${escapeHtml(rp.user_id)}" data-reply-name="${escapeHtml(rUname)}">Reply</button>
              ${rCanDel ? `<button type="button" class="cmt-action-btn del-btn" data-play-cmt-del="${escapeHtml(rp.id)}">Delete</button>` : ''}
            </div>
          </div>
        </div>`;
    }).join('');

    return `
      <div class="comment-item ${isPinned ? 'pinned' : ''}" data-play-cmt-id="${escapeHtml(c.id)}">
        <div class="avatar" data-play-cmt-prof="${escapeHtml(c.user_id)}">${prof.avatar_url ? `<img src="${escapeHtml(prof.avatar_url)}">` : escapeHtml(uname[0].toUpperCase())}</div>
        <div class="comment-main">
          ${isPinned ? `<div class="comment-pinned-badge">${PIN_SVG} Pinned by ${escapeHtml(creatorUsername)}</div>` : ''}
          <div class="comment-meta">
            <strong class="profile-link" data-play-cmt-prof="${escapeHtml(c.user_id)}">${escapeHtml(uname)}${tierBadgeHtml(prof)}</strong>
            ${isCommenterCreator ? '<span class="comment-creator-tag">Creator</span>' : ''}
            <span class="comment-time">${escapeHtml(formatRelativeTime(c.ts))}</span>
          </div>
          ${c.text ? `<div class="comment-text">${escapeHtml(c.text).replace(/\n/g, '<br>')}</div>` : ''}
          ${c.gif_url ? `<div class="comment-gif-wrap"><img src="${escapeHtml(c.gif_url)}" alt="${escapeHtml(c.gif_title || 'GIF')}" loading="lazy"></div>` : ''}
          <div class="comment-actions">
            ${renderVoteBtns(c)}
            <button type="button" class="cmt-action-btn" data-play-cmt-reply="${escapeHtml(c.id)}" data-reply-uid="${escapeHtml(c.user_id)}" data-reply-name="${escapeHtml(uname)}">Reply</button>
            ${isViewerVidCreator ? `
              <button type="button" class="cmt-action-btn ${isPinned ? 'pinned-btn' : ''}" data-play-cmt-pin="${escapeHtml(c.id)}" title="${isPinned ? 'Unpin comment' : 'Pin comment'}">
                ${PIN_SVG}<span>${isPinned ? 'Unpin' : 'Pin'}</span>
              </button>
            ` : ''}
            ${canDel ? `<button type="button" class="cmt-action-btn del-btn" data-play-cmt-del="${escapeHtml(c.id)}">Delete</button>` : ''}
          </div>
          ${isReplyingHere ? `
            <div class="cmt-reply-box">
              <div class="avatar">${myAv}</div>
              <div class="cmt-reply-body">
                <textarea id="playReplyInput-${escapeHtml(c.id)}" rows="2" maxlength="400" placeholder="Replying to @${escapeHtml(playState.activeCommentReplyTarget.replyToUsername || uname)}..."></textarea>
                <div class="cmt-reply-actions">
                  <button type="button" class="zoom-btn" data-play-reply-cancel="${escapeHtml(c.id)}">Cancel</button>
                  <button type="button" class="primary-btn" id="playSendReplyBtn-${escapeHtml(c.id)}" data-play-reply-send="${escapeHtml(c.id)}" style="padding:7px 14px;font-size:12px;">Reply</button>
                </div>
              </div>
            </div>
          ` : ''}
          ${replies.length ? `
            <button type="button" class="cmt-replies-toggle" data-play-toggle-replies="${escapeHtml(c.id)}">
              ${isExpanded ? `▴ Hide ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}` : `▾ ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
            </button>
            ${isExpanded ? `<div class="cmt-replies-list">${repliesHtml}</div>` : ''}
          ` : ''}
        </div>
      </div>`;
  }).join('');

  $$('#playCommentsList [data-play-cmt-prof]').forEach(el => {
    el.addEventListener('click', () => openProfileModal(el.dataset.playCmtProf));
  });
  $$('#playCommentsList [data-play-cmt-vote]').forEach(btn => {
    btn.addEventListener('click', () => {
      votePlayComment(vidId, btn.dataset.cid, btn.dataset.cur, btn.dataset.playCmtVote);
    });
  });
  $$('#playCommentsList [data-play-cmt-pin]').forEach(btn => {
    btn.addEventListener('click', () => togglePinPlayComment(vidId, btn.dataset.playCmtPin));
  });
  $$('#playCommentsList [data-play-cmt-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!sb || !currentUser?.id) return;
      btn.disabled = true;
      const cmtId = btn.dataset.playCmtDel;
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__PLAY_CMT_DEL__:' + JSON.stringify({ videoId: vidId, commentId: cmtId, ts: Date.now() }),
        status: 'denied'
      });
      await loadPlayData(true);
      renderPlayCommentsDrawerList();
    });
  });
  $$('#playCommentsList [data-play-cmt-reply]').forEach(btn => {
    btn.addEventListener('click', () => {
      const parentId = btn.dataset.playCmtReply;
      playState.activeCommentReplyTarget = {
        parentId,
        replyToUserId: btn.dataset.replyUid || null,
        replyToUsername: btn.dataset.replyName || 'Trader'
      };
      playState.expandedCommentReplies.add(parentId);
      renderPlayCommentsDrawerList();
      $(`#playReplyInput-${parentId}`)?.focus();
    });
  });
  $$('#playCommentsList [data-play-reply-cancel]').forEach(btn => {
    btn.addEventListener('click', () => {
      playState.activeCommentReplyTarget = null;
      renderPlayCommentsDrawerList();
    });
  });
  $$('#playCommentsList [data-play-reply-send]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (playState.activeCommentReplyTarget && playState.activeCommentReplyTarget.parentId === btn.dataset.playReplySend) {
        postPlayReplyComment(vidId, playState.activeCommentReplyTarget);
      }
    });
  });
  $$('#playCommentsList textarea[id^="playReplyInput-"]').forEach(ta => {
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (playState.activeCommentReplyTarget) {
          postPlayReplyComment(vidId, playState.activeCommentReplyTarget);
        }
      }
    });
  });
  $$('#playCommentsList [data-play-toggle-replies]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.playToggleReplies;
      if (playState.expandedCommentReplies.has(pid)) playState.expandedCommentReplies.delete(pid);
      else playState.expandedCommentReplies.add(pid);
      renderPlayCommentsDrawerList();
    });
  });
}

function openPlayCommentsDrawer(videoId) {
  playState.openCommentsVideoId = String(videoId);
  playState.pendingCommentGif = null;
  playState.activeCommentReplyTarget = null;
  renderPlayCommentGifPreview();
  setPlayCommentGifPickerOpen(false);
  $('#playCommentsDrawer')?.classList.remove('hidden');
  renderPlayCommentsDrawerList();
}

$('#playCloseCommentsBtn')?.addEventListener('click', () => {
  playState.openCommentsVideoId = null;
  playState.activeCommentReplyTarget = null;
  $('#playCommentsDrawer')?.classList.add('hidden');
  setPlayCommentGifPickerOpen(false);
});
$('#playCommentPlusBtn')?.addEventListener('click', () => {
  setPlayCommentGifPickerOpen(!playState.commentGifPickerOpen);
});
$('#playCloseCommentGifBtn')?.addEventListener('click', () => setPlayCommentGifPickerOpen(false));
let playCommentGifTimer = null;
$('#playCommentGifSearchInput')?.addEventListener('input', e => {
  playState.commentGifSearchQuery = e.target.value;
  clearTimeout(playCommentGifTimer);
  playCommentGifTimer = setTimeout(() => {
    if (playState.commentGifPickerOpen) loadPlayCommentGifs(playState.commentGifSearchQuery);
  }, 320);
});
$('#playCommentForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!sb || !currentUser?.id || !playState.openCommentsVideoId) return;
  const input = $('#playCommentInput');
  const sendBtn = $('#playCommentSendBtn');
  const text = (input?.value || '').trim();
  const gif = playState.pendingCommentGif;
  if (!text && !gif) return toast('Write a comment or pick a GIF!');
  if (sendBtn) sendBtn.disabled = true;

  const payload = {
    id: 'pcmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    videoId: playState.openCommentsVideoId,
    text: text.slice(0, 400),
    ts: Date.now()
  };
  if (gif) {
    payload.gif_url = typeof sanitizeGifUrl === 'function' ? sanitizeGifUrl(gif.gifUrl) : gif.gifUrl;
    payload.gif_title = String(gif.title || 'GIF').slice(0, 80);
  }
  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_CMT__:' + JSON.stringify(payload),
    status: 'denied'
  });
  if (sendBtn) sendBtn.disabled = false;
  if (error) return toast('Comment error: ' + error.message);

  playSound('commenting');
  if (input) input.value = '';
  playState.pendingCommentGif = null;
  renderPlayCommentGifPreview();
  setPlayCommentGifPickerOpen(false);
  await loadPlayData(true);
  renderPlayCommentsDrawerList();
});

// Play Topbar & Scroll Controls
$('#playBackBtn')?.addEventListener('click', () => showPage('feed'));
$('#playRefreshBtn')?.addEventListener('click', () => startPlayPage(null, false, true));
$('#playMuteAllBtn')?.addEventListener('click', () => {
  playState.muted = !playState.muted;
  syncPlayMuteUi();
});
$('#playPrevBtn')?.addEventListener('click', () => {
  const track = $('#playFeedTrack');
  if (!track) return;
  const targetIdx = Math.max(0, playState.activeSlideIndex - 1);
  const slide = track.querySelector(`.play-slide[data-slide-idx="${targetIdx}"]`);
  if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#playNextBtn')?.addEventListener('click', () => {
  const track = $('#playFeedTrack');
  if (!track) return;
  if (playState.activeSlideIndex >= playState.deck.length - 3 && getTotalPlayPoolCount() >= 2) {
    appendRandomPlaySlides(6);
  }
  const targetIdx = Math.min(Math.max(0, playState.deck.length - 1), playState.activeSlideIndex + 1);
  const slide = track.querySelector(`.play-slide[data-slide-idx="${targetIdx}"]`);
  if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- Creator Donation Modal (Play & Live yellow '+' button) ----------
const playDonateState = {
  videoId: '',
  videoTitle: '',
  toUserId: '',
  toUsername: 'Creator',
  toProfile: null,
  busy: false
};

async function openPlayDonateModal(videoId, targetUserId) {
  if (!currentUser?.id) return toast('Please sign in first.');
  const vid = videoId ? playState.videosById.get(String(videoId)) : null;
  const uid = String(targetUserId || vid?.user_id || '');
  if (!uid) return toast('Creator not found.');
  if (uid === String(currentUser.id)) {
    return toast('You cannot donate to your own video!');
  }

  let prof = vid?.profile || null;
  if (!prof || !prof.username) {
    try {
      const { data } = await sb.from('profiles').select('id, username, avatar_url, is_premium').eq('id', uid).maybeSingle();
      if (data) prof = data;
    } catch (e) {}
  }
  prof = prof || { id: uid, username: 'Creator' };

  playDonateState.videoId = vid ? vid.id : String(videoId || '');
  playDonateState.videoTitle = vid?.title || (vid?.kind === 'video' ? 'Uploaded Video' : 'Play Short');
  playDonateState.toUserId = uid;
  playDonateState.toUsername = prof.username || 'Creator';
  playDonateState.toProfile = prof;
  playDonateState.busy = false;

  const av = prof.avatar_url
    ? `<img src="${escapeHtml(prof.avatar_url)}" alt="">`
    : escapeHtml((prof.username || 'C')[0].toUpperCase());
  const recEl = $('#playDonateRecipientCard');
  if (recEl) {
    recEl.innerHTML = `
      <div class="avatar" style="width:44px;height:44px;font-size:16px;">${av}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-weight:800;font-size:15px;">${escapeHtml(prof.username || 'Creator')}${tierBadgeHtml(prof)}</div>
        <div class="muted tiny">Video: ${escapeHtml(playDonateState.videoTitle)}</div>
      </div>`;
  }
  if ($('#playDonateAmountInput')) $('#playDonateAmountInput').value = '5';
  if ($('#playDonateNoteInput')) $('#playDonateNoteInput').value = '';
  if ($('#playDonateMsg')) $('#playDonateMsg').textContent = '';
  if ($('#playDonateCashAvail')) $('#playDonateCashAvail').textContent = `Available cash: ${money(currentUser.cash || 0)}`;
  $$('#playDonateQuickBtns .play-donate-chip').forEach(b => b.classList.toggle('active', b.dataset.donateAmt === '5'));
  const sendBtn = $('#confirmPlayDonateBtn');
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '＋ Send Donation'; }
  $('#playDonateModal')?.classList.remove('hidden');
}

function closePlayDonateModal() {
  hideModalSmooth($('#playDonateModal'));
}

$('#closePlayDonateBtn')?.addEventListener('click', closePlayDonateModal);
$('#cancelPlayDonateBtn')?.addEventListener('click', closePlayDonateModal);
$('#playDonateModal')?.addEventListener('click', e => {
  if (e.target === $('#playDonateModal')) closePlayDonateModal();
});
$$('#playDonateQuickBtns .play-donate-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const val = btn.dataset.donateAmt || '5';
    if ($('#playDonateAmountInput')) $('#playDonateAmountInput').value = val;
    $$('#playDonateQuickBtns .play-donate-chip').forEach(b => b.classList.toggle('active', b === btn));
  });
});
$('#playDonateAmountInput')?.addEventListener('input', e => {
  const v = String(e.target.value || '');
  $$('#playDonateQuickBtns .play-donate-chip').forEach(b => b.classList.toggle('active', b.dataset.donateAmt === v));
});

$('#confirmPlayDonateBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser?.id || playDonateState.busy) return;
  const msgEl = $('#playDonateMsg');
  const sendBtn = $('#confirmPlayDonateBtn');
  if (msgEl) msgEl.textContent = '';

  const amount = Math.round(Number($('#playDonateAmountInput')?.value || 0) * 100) / 100;
  const note = ($('#playDonateNoteInput')?.value || '').trim().slice(0, 120);
  if (!Number.isFinite(amount) || amount < 0.5) {
    if (msgEl) msgEl.textContent = 'Minimum donation is $0.50.';
    return;
  }
  if (playDonateState.toUserId === String(currentUser.id)) {
    if (msgEl) msgEl.textContent = 'You cannot donate to yourself.';
    return;
  }

  playDonateState.busy = true;
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

  let liveCash = Number(currentUser.cash || 0);
  try {
    const { data: prof } = await sb.from('profiles').select('cash').eq('id', currentUser.id).maybeSingle();
    if (prof && prof.cash != null) liveCash = Number(prof.cash);
  } catch (e) {}

  if (amount > liveCash) {
    playDonateState.busy = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '＋ Send Donation'; }
    if (msgEl) msgEl.textContent = `Not enough cash (${money(liveCash)} available).`;
    return;
  }

  const nextCash = Math.round((liveCash - amount) * 100) / 100;
  const { error: cashErr } = await sb.from('profiles').update({ cash: nextCash }).eq('id', currentUser.id);
  if (cashErr) {
    playDonateState.busy = false;
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '＋ Send Donation'; }
    if (msgEl) msgEl.textContent = 'Donation failed: ' + cashErr.message;
    return;
  }

  const donateId = 'pdon_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  const payload = {
    id: donateId,
    toUserId: playDonateState.toUserId,
    toUsername: playDonateState.toUsername,
    videoId: playDonateState.videoId,
    videoTitle: playDonateState.videoTitle,
    amount,
    note,
    ts: Date.now()
  };

  const { error: reqErr } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_DONATE__:' + JSON.stringify(payload),
    status: 'denied'
  });

  playDonateState.busy = false;
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '＋ Send Donation'; }

  if (reqErr) {
    // Roll back cash if log insert fails
    try { await sb.from('profiles').update({ cash: liveCash }).eq('id', currentUser.id); } catch (e) {}
    if (msgEl) msgEl.textContent = 'Donation error: ' + reqErr.message;
    return;
  }

  currentUser.cash = nextCash;
  if ($('#topCash')) $('#topCash').textContent = money(nextCash);
  if ($('#moneyCash')) $('#moneyCash').textContent = money(nextCash);
  updateNetWorth();
  playSound('buy');
  closePlayDonateModal();
  toast(`💛 Donated ${money(amount)} to ${playDonateState.toUsername}!`);
  await loadPlayData(true);
  if (currentPage === 'live') loadLiveFeed();
});

// ---------- Play Upload Choice + Short Creator Studio + Video File Upload ----------
const PLAY_STICKERS = ['🔥', '🚀', '💎', '👑', '💰', '📈', '⚡', '🎯', '😂', '🥳', '❤️', '👀', '🤯', '🏆', '🎵', '✨'];
const playEditorState = {
  bgColor: '#161222',
  aspectRatio: '9:16',
  elements: [], // { id, type:'gif'|'text'|'sticker'|'photo', x, y, scale, rot, opacity, anim, gifUrl, photoUrl, emoji, text, color, style, font }
  history: [],
  selectedId: null,
  musicName: '',
  musicUrl: '',
  musicFallbackUrl: '',
  linkedCoinId: '',
  gifQuery: '',
  saving: false
};

function snapshotPlayEditorState() {
  return JSON.stringify({
    bgColor: playEditorState.bgColor,
    aspectRatio: playEditorState.aspectRatio,
    elements: playEditorState.elements
  });
}

function pushPlayEditorHistory() {
  const snap = snapshotPlayEditorState();
  if (playEditorState.history[playEditorState.history.length - 1] === snap) return;
  playEditorState.history.push(snap);
  if (playEditorState.history.length > 25) playEditorState.history.shift();
  const undoBtn = $('#playCreatorUndoBtn');
  if (undoBtn) undoBtn.disabled = playEditorState.history.length === 0;
}

function undoPlayEditor() {
  if (!playEditorState.history.length) return;
  try {
    const prev = JSON.parse(playEditorState.history.pop());
    playEditorState.bgColor = prev.bgColor || '#161222';
    playEditorState.aspectRatio = prev.aspectRatio || '9:16';
    playEditorState.elements = Array.isArray(prev.elements) ? prev.elements : [];
    playEditorState.selectedId = null;
    syncPlayEditorAspectUi();
    renderPlayEditorStage();
  } catch (e) {}
  const undoBtn = $('#playCreatorUndoBtn');
  if (undoBtn) undoBtn.disabled = playEditorState.history.length === 0;
}

function populatePlayCoinSelect(selectEl, emptyLabel = 'No Linked Coin (optional)') {
  if (!selectEl) return;
  const list = Array.isArray(coins) ? coins : [];
  selectEl.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>` +
    list.map(c => `<option value="${escapeHtml(c.id)}">◈ ${escapeHtml(c.name)} ($${escapeHtml(c.ticker)})</option>`).join('');
}

function compressPlayCanvasImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read photo'));
    reader.onload = ev => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image file'));
      img.onload = () => {
        const maxSide = 420;
        const ratio = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(40, Math.round(img.width * ratio));
        canvas.height = Math.max(40, Math.round(img.height * ratio));
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.74));
      };
      img.src = String(ev.target?.result || '');
    };
    reader.readAsDataURL(file);
  });
}

function renderPlayStickerGrid() {
  const grid = $('#playEditorStickerGrid');
  if (!grid) return;
  grid.innerHTML = PLAY_STICKERS.map(em => `
    <button type="button" class="play-sticker-btn" data-add-sticker="${escapeHtml(em)}">${escapeHtml(em)}</button>
  `).join('');
  grid.querySelectorAll('[data-add-sticker]').forEach(btn => {
    btn.addEventListener('click', () => {
      const em = btn.dataset.addSticker;
      if (!em) return;
      pushPlayEditorHistory();
      const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
      playEditorState.elements.push({
        id: newId, type: 'sticker', x: 50, y: 48, scale: 1.2, rot: 0, opacity: 1, anim: 'none', emoji: em
      });
      playEditorState.selectedId = newId;
      $('#playEditorStickerPanel')?.classList.add('hidden');
      renderPlayEditorStage();
    });
  });
}

function syncPlayEditorAspectUi() {
  const ratioKey = playEditorState.aspectRatio || '9:16';
  const arNum = parsePlayAspectRatio(ratioKey, 9 / 16);
  const stage = $('#playEditorStage');
  if (stage) {
    stage.style.setProperty('--play-ar-num', arNum.toFixed(4));
    stage.style.aspectRatio = arNum.toFixed(4);
  }
  $$('#playAspectRatioGroup .play-aspect-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.aspect === ratioKey);
  });
}

async function populateMusicSelect(selectEl, emptyLabel = 'No Music') {
  if (!selectEl) return;
  const tracks = await loadMusicList(true);
  selectEl.innerHTML = `<option value="">${escapeHtml(emptyLabel)}</option>` +
    tracks.map((t, i) => `<option value="${escapeHtml(t.name)}" data-idx="${i}">♫ ${escapeHtml(t.title)}</option>`).join('');
}

function playSelectedMusicPreview(selectEl, btnEl) {
  const name = selectEl?.value || '';
  if (playState.previewAudio && playState.previewBtnEl === btnEl) {
    stopMusicPreviewAudio();
    return;
  }
  stopMusicPreviewAudio();
  if (!name) return toast('Pick a track from the Music folder first!');
  const track = (musicCache || []).find(t => t.name === name);
  if (!track) return;
  const audio = createPlayableAudioElement(track.url, track.fallbackUrl || '');
  audio.loop = true;
  audio.volume = 0.55;
  playState.previewAudio = audio;
  playState.previewBtnEl = btnEl;
  if (btnEl) btnEl.textContent = '■ Stop';
  audio.play().catch(() => toast('Tap again to preview track'));
}

// ---------- Play Voiceover Mic Recorder & Tier Upload Fee ----------
const playVoiceoverState = {
  creatorUrl: '',
  uploadUrl: '',
  recordingTarget: null,
  recorder: null,
  stream: null,
  chunks: [],
  timer: null,
  startTs: 0,
  maxDurationMs: 15000,
  previewAudio: null,
  previewTarget: null
};

function getVoiceoverDomEls(target) {
  const prefix = target === 'upload' ? 'playUploadVo' : 'playCreatorVo';
  return {
    recBtn: $('#' + prefix + 'RecBtn'),
    prevBtn: $('#' + prefix + 'PreviewBtn'),
    clearBtn: $('#' + prefix + 'ClearBtn'),
    statusEl: $('#' + prefix + 'Status')
  };
}

function stopVoiceoverPreview() {
  if (playVoiceoverState.previewAudio) {
    try { playVoiceoverState.previewAudio.pause(); } catch (e) {}
    playVoiceoverState.previewAudio = null;
  }
  const prevT = playVoiceoverState.previewTarget;
  playVoiceoverState.previewTarget = null;
  if (prevT) syncVoiceoverUi(prevT);
}

function stopVoiceoverStream() {
  if (playVoiceoverState.timer) {
    clearInterval(playVoiceoverState.timer);
    playVoiceoverState.timer = null;
  }
  if (playVoiceoverState.stream) {
    try { playVoiceoverState.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
    playVoiceoverState.stream = null;
  }
}

function stopVoiceoverRecorderIfActive() {
  if (playVoiceoverState.recorder && playVoiceoverState.recorder.state !== 'inactive') {
    try { playVoiceoverState.recorder.stop(); } catch (e) {}
  } else {
    stopVoiceoverStream();
    playVoiceoverState.recordingTarget = null;
  }
}

function syncVoiceoverUi(target) {
  const { recBtn, prevBtn, clearBtn, statusEl } = getVoiceoverDomEls(target);
  const url = target === 'upload' ? playVoiceoverState.uploadUrl : playVoiceoverState.creatorUrl;
  const isRec = playVoiceoverState.recordingTarget === target;
  const isPrev = playVoiceoverState.previewTarget === target;

  if (recBtn) {
    recBtn.classList.toggle('is-recording', isRec);
    recBtn.textContent = isRec ? '■ Stop Rec' : (url ? '🎙 Re-record' : '🎙 Record Mic');
  }
  if (prevBtn) {
    prevBtn.classList.toggle('hidden', isRec || !url);
    prevBtn.textContent = isPrev ? '■ Stop' : '▶ Test';
  }
  if (clearBtn) {
    clearBtn.classList.toggle('hidden', isRec || !url);
  }
  if (statusEl && !isRec) {
    statusEl.textContent = url
      ? 'Voiceover ready — loops alongside Music & video audio!'
      : (target === 'upload'
          ? 'Optional — record your mic (replays with Music & Video!).'
          : 'Optional — record your mic (replays with Music at the same time!).');
  }
}

async function toggleVoiceoverRecording(target) {
  if (playVoiceoverState.recordingTarget === target) {
    stopVoiceoverRecorderIfActive();
    return;
  }
  if (playVoiceoverState.recordingTarget) {
    stopVoiceoverRecorderIfActive();
  }
  stopVoiceoverPreview();
  stopMusicPreviewAudio();

  const { statusEl } = getVoiceoverDomEls(target);
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    if (statusEl) statusEl.textContent = 'Microphone recording is not supported in this browser.';
    toast('Microphone recording not available in this browser.');
    return;
  }

  let stream = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  } catch (err) {
    if (statusEl) statusEl.textContent = 'Microphone permission denied.';
    toast('Allow microphone access to record a voiceover.');
    return;
  }

  const mimes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const pickedMime = mimes.find(m => {
    try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
  });
  let recorder = null;
  try {
    const opts = pickedMime ? { mimeType: pickedMime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 };
    recorder = new MediaRecorder(stream, opts);
  } catch (e) {
    recorder = new MediaRecorder(stream);
  }

  playVoiceoverState.recordingTarget = target;
  playVoiceoverState.stream = stream;
  playVoiceoverState.recorder = recorder;
  playVoiceoverState.chunks = [];
  playVoiceoverState.startTs = Date.now();

  recorder.ondataavailable = ev => {
    if (ev.data && ev.data.size > 0) playVoiceoverState.chunks.push(ev.data);
  };

  recorder.onstop = async () => {
    stopVoiceoverStream();
    const endedTarget = target;
    playVoiceoverState.recordingTarget = null;
    playVoiceoverState.recorder = null;
    const chunks = playVoiceoverState.chunks || [];
    playVoiceoverState.chunks = [];
    if (!chunks.length) {
      syncVoiceoverUi(endedTarget);
      return;
    }
    try {
      const blobType = recorder.mimeType || pickedMime || 'audio/webm';
      const blob = new Blob(chunks, { type: blobType });
      if (blob.size > 480 * 1024) {
        toast('Voiceover too long/large (max ~15s). Please record a shorter clip.');
        syncVoiceoverUi(endedTarget);
        return;
      }
      const dataUrl = await readFileAsDataUrlPromise(blob);
      if (endedTarget === 'upload') playVoiceoverState.uploadUrl = dataUrl;
      else playVoiceoverState.creatorUrl = dataUrl;
      toast('Voiceover saved! Press ▶ Test to listen.');
    } catch (e) {
      toast('Could not save voiceover.');
    }
    syncVoiceoverUi(endedTarget);
  };

  recorder.start(250);
  syncVoiceoverUi(target);
  if (statusEl) statusEl.textContent = 'Recording mic... 0s / 15s (click Stop Rec when done)';

  playVoiceoverState.timer = setInterval(() => {
    const elapsed = Math.floor((Date.now() - playVoiceoverState.startTs) / 1000);
    if (statusEl) statusEl.textContent = `Recording mic... ${Math.min(15, elapsed)}s / 15s`;
    if (Date.now() - playVoiceoverState.startTs >= playVoiceoverState.maxDurationMs) {
      stopVoiceoverRecorderIfActive();
    }
  }, 300);
}

function toggleVoiceoverPreview(target) {
  if (playVoiceoverState.previewTarget === target) {
    stopVoiceoverPreview();
    return;
  }
  stopVoiceoverPreview();
  const url = target === 'upload' ? playVoiceoverState.uploadUrl : playVoiceoverState.creatorUrl;
  if (!url) return;
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = 0.92;
  playVoiceoverState.previewAudio = audio;
  playVoiceoverState.previewTarget = target;
  syncVoiceoverUi(target);
  audio.play().catch(() => toast('Tap again to preview voiceover'));
}

function clearVoiceover(target) {
  if (playVoiceoverState.previewTarget === target) stopVoiceoverPreview();
  if (target === 'upload') playVoiceoverState.uploadUrl = '';
  else playVoiceoverState.creatorUrl = '';
  syncVoiceoverUi(target);
}

$('#playCreatorVoRecBtn')?.addEventListener('click', () => toggleVoiceoverRecording('creator'));
$('#playCreatorVoPreviewBtn')?.addEventListener('click', () => toggleVoiceoverPreview('creator'));
$('#playCreatorVoClearBtn')?.addEventListener('click', () => clearVoiceover('creator'));
$('#playUploadVoRecBtn')?.addEventListener('click', () => toggleVoiceoverRecording('upload'));
$('#playUploadVoPreviewBtn')?.addEventListener('click', () => toggleVoiceoverPreview('upload'));
$('#playUploadVoClearBtn')?.addEventListener('click', () => clearVoiceover('upload'));

function updatePlayUploadFeeUi() {
  const cost = getPlayUploadCost(currentUser);
  const tier = getUserTier(currentUser);
  const tierLabel = tier === 'premium' ? 'Premium' : (tier === 'pro' ? 'PRO' : 'Member');
  const costText = cost > 0 ? money(cost) : 'FREE';
  const banner = $('#playUploadTierFeeBanner');
  if (banner) {
    banner.innerHTML = `Your Upload Cost (<strong>${tierLabel}</strong>): <strong style="color:${cost === 0 ? '#4ade80' : '#facc15'};">${costText}</strong> · Member: $50 · PRO: $10 · Premium: Free`;
  }
  const inline = $('#playUploadFeeInline');
  if (inline) {
    inline.textContent = `Your tier (${tierLabel}): ${costText} · Member: $50 · PRO: $10 · Premium: Free`;
  }
  const finishBtn = $('#playCreatorFinishBtn');
  if (finishBtn && !playEditorState.saving) {
    finishBtn.textContent = cost > 0 ? `Finish · ${money(cost)} ✓` : 'Finish ✓';
  }
  const pubBtn = $('#publishPlayVideoFileBtn');
  if (pubBtn && !pendingUploadBusy) {
    pubBtn.textContent = cost > 0 ? `Publish · ${money(cost)}` : 'Publish Video';
  }
}

async function chargePlayUploadFeeAtomic() {
  const cost = getPlayUploadCost(currentUser);
  if (cost <= 0) return { ok: true, charged: 0 };
  if (!sb || !currentUser?.id) return { ok: false, error: 'Please sign in first.' };
  return runPlayCashUpdate(async () => {
    let liveCash = Number(currentUser.cash || 0);
    const { data: prof, error: profErr } = await sb.from('profiles').select('cash').eq('id', currentUser.id).maybeSingle();
    if (!profErr && prof && prof.cash != null) liveCash = Number(prof.cash);
    if (liveCash < cost) {
      return {
        ok: false,
        error: `Not enough cash! Uploading costs ${money(cost)} on your tier (you have ${money(liveCash)}).`
      };
    }
    const nextCash = Math.round((liveCash - cost) * 100) / 100;
    const { error: updErr } = await sb.from('profiles').update({ cash: nextCash }).eq('id', currentUser.id);
    if (updErr) return { ok: false, error: updErr.message };
    currentUser.cash = nextCash;
    if ($('#topCash')) $('#topCash').textContent = money(nextCash);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(nextCash);
    updateNetWorth();
    return { ok: true, charged: cost };
  });
}

async function refundPlayUploadFee(amount) {
  if (!sb || !currentUser?.id || !Number.isFinite(amount) || amount <= 0) return;
  await runPlayCashUpdate(async () => {
    let liveCash = Number(currentUser.cash || 0);
    try {
      const { data: prof } = await sb.from('profiles').select('cash').eq('id', currentUser.id).maybeSingle();
      if (prof && prof.cash != null) liveCash = Number(prof.cash);
    } catch (e) {}
    const restored = Math.round((liveCash + amount) * 100) / 100;
    await sb.from('profiles').update({ cash: restored }).eq('id', currentUser.id);
    currentUser.cash = restored;
    if ($('#topCash')) $('#topCash').textContent = money(restored);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(restored);
    updateNetWorth();
  });
}

function openPlayUploadChoiceModal() {
  if (!currentUser) return toast('Please sign in first.');
  stopActivePlayMedia();
  updatePlayUploadFeeUi();
  $('#playUploadChoiceModal')?.classList.remove('hidden');
}

$('#closePlayChoiceBtn')?.addEventListener('click', () => hideModalSmooth($('#playUploadChoiceModal')));
$('#playUploadChoiceModal')?.addEventListener('click', e => {
  if (e.target === $('#playUploadChoiceModal')) hideModalSmooth($('#playUploadChoiceModal'));
});

function renderEditorSelectionBar() {
  const bar = $('#playEditorSelectionBar');
  const lbl = $('#playSelLabel');
  const colorInp = $('#playSelTextColorInput');
  const styleBtn = $('#playSelTextStyleBtn');
  const fontBtn = $('#playSelTextFontBtn');
  const animBtn = $('#playSelAnimBtn');
  const opBtn = $('#playSelOpacityBtn');
  const item = playEditorState.elements.find(el => el.id === playEditorState.selectedId) || null;
  if (!bar) return;
  if (!item) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  const labels = { gif: 'GIF Layer', photo: 'Image Layer', sticker: 'Sticker', text: 'Text Layer', poll: 'Poll Card' };
  if (lbl) lbl.textContent = labels[item.type] || 'Layer';
  if (animBtn) {
    const aMap = { none: '✨ Still', pulse: '💓 Pulse', float: '🎈 Float', spin: '🌀 Spin' };
    animBtn.textContent = aMap[item.anim || 'none'] || '✨ Still';
  }
  if (opBtn) opBtn.textContent = `${Math.round(Number(item.opacity ?? 1) * 100)}%`;
  if (colorInp) {
    colorInp.classList.toggle('hidden', item.type !== 'text');
    if (item.type === 'text') colorInp.value = item.color || '#ffffff';
  }
  if (styleBtn) {
    styleBtn.classList.toggle('hidden', item.type !== 'text');
    if (item.type === 'text') {
      styleBtn.textContent = item.style === 'plain' ? 'Clean' : (item.style === 'outline' ? 'Glow' : 'Pill');
    }
  }
  if (fontBtn) {
    fontBtn.classList.toggle('hidden', item.type !== 'text');
    if (item.type === 'text') {
      const fMap = { sans: 'Sans', impact: 'Impact', mono: 'Mono', serif: 'Serif' };
      fontBtn.textContent = fMap[item.font || 'sans'] || 'Sans';
    }
  }
}

function renderPlayEditorStage() {
  const stage = $('#playEditorStage');
  if (!stage) return;
  stage.style.background = playEditorState.bgColor || '#161222';
  const itemsHtml = playEditorState.elements.map(el => {
    const selCls = el.id === playEditorState.selectedId ? 'is-selected' : '';
    const scaleVal = Number(el.scale || 1);
    const invScale = (1 / Math.max(0.45, scaleVal)).toFixed(3);
    const rot = Number(el.rot ?? 0);
    const op = Number(el.opacity ?? 1);
    const animCls = ['pulse', 'float', 'spin'].includes(el.anim) ? ` play-anim-${el.anim}` : '';
    const posStyle = `left:${el.x}%;top:${el.y}%;opacity:${op};--el-inv-scale:${invScale};transform:translate(-50%,-50%) scale(${scaleVal}) rotate(${rot}deg);`;
    const resizeHandleHtml = `<span class="play-resize-handle" data-resize-el="${escapeHtml(el.id)}" title="Drag corner to resize">⤡</span>`;
    if (el.type === 'poll') {
      return `
        <div class="play-canvas-item is-poll is-editable${animCls} ${selCls}" data-edit-el="${escapeHtml(el.id)}" style="${posStyle}">
          ${renderPlayPollCardHtml(el, '', true)}
          ${resizeHandleHtml}
        </div>`;
    }
    if (el.type === 'gif') {
      return `
        <div class="play-canvas-item is-gif is-editable${animCls} ${selCls}" data-edit-el="${escapeHtml(el.id)}" style="${posStyle}">
          <img src="${escapeHtml(el.gifUrl)}" alt="GIF" draggable="false">
          ${resizeHandleHtml}
        </div>`;
    }
    if (el.type === 'photo') {
      return `
        <div class="play-canvas-item is-photo is-editable${animCls} ${selCls}" data-edit-el="${escapeHtml(el.id)}" style="${posStyle}">
          <img src="${escapeHtml(el.photoUrl)}" alt="Image" draggable="false">
          ${resizeHandleHtml}
        </div>`;
    }
    if (el.type === 'sticker') {
      return `
        <div class="play-canvas-item is-sticker is-editable${animCls} ${selCls}" data-edit-el="${escapeHtml(el.id)}" style="${posStyle}">
          <span>${escapeHtml(el.emoji)}</span>
          ${resizeHandleHtml}
        </div>`;
    }
    const styleCls = el.style === 'plain' ? 'style-plain' : (el.style === 'outline' ? 'style-outline' : 'style-pill');
    const fontCls = ['impact', 'mono', 'serif'].includes(el.font) ? ` play-font-${el.font}` : ' play-font-sans';
    return `
      <div class="play-canvas-item is-text is-editable ${styleCls}${fontCls}${animCls} ${selCls}" data-edit-el="${escapeHtml(el.id)}" style="${posStyle}color:${escapeHtml(el.color || '#ffffff')};">
        ${escapeHtml(el.text)}
        ${resizeHandleHtml}
      </div>`;
  }).join('');

  stage.innerHTML = (playEditorState.elements.length ? '' : '<div id="playEditorEmptyHint" class="play-editor-empty-hint">Press <strong>＋ Add Element</strong> to drop Images, GIFs, Text, or Stickers — drag to move &amp; resize!</div>') + itemsHtml;

  $$('#playEditorStage [data-edit-el]').forEach(domEl => {
    domEl.addEventListener('pointerdown', e => {
      if (e.target.closest('[data-resize-el]')) return;
      e.preventDefault();
      e.stopPropagation();
      const elId = domEl.dataset.editEl;
      playEditorState.selectedId = elId;
      $$('#playEditorStage [data-edit-el]').forEach(n => n.classList.toggle('is-selected', n.dataset.editEl === elId));
      renderEditorSelectionBar();

      const item = playEditorState.elements.find(it => it.id === elId);
      if (!item) return;
      const rect = stage.getBoundingClientRect();
      const startClientX = e.clientX;
      const startClientY = e.clientY;
      const startX = item.x;
      const startY = item.y;
      let moved = false;

      try { domEl.setPointerCapture(e.pointerId); } catch (err) {}

      const onMove = ev => {
        if (!rect.width || !rect.height) return;
        if (!moved && (Math.abs(ev.clientX - startClientX) > 3 || Math.abs(ev.clientY - startClientY) > 3)) {
          pushPlayEditorHistory();
          moved = true;
        }
        const dxPct = ((ev.clientX - startClientX) / rect.width) * 100;
        const dyPct = ((ev.clientY - startClientY) / rect.height) * 100;
        item.x = Math.min(94, Math.max(6, Math.round((startX + dxPct) * 10) / 10));
        item.y = Math.min(92, Math.max(8, Math.round((startY + dyPct) * 10) / 10));
        domEl.style.left = item.x + '%';
        domEl.style.top = item.y + '%';
      };
      const onUp = () => {
        domEl.removeEventListener('pointermove', onMove);
        domEl.removeEventListener('pointerup', onUp);
        domEl.removeEventListener('pointercancel', onUp);
      };
      domEl.addEventListener('pointermove', onMove);
      domEl.addEventListener('pointerup', onUp);
      domEl.addEventListener('pointercancel', onUp);
    });
  });

  $$('#playEditorStage [data-resize-el]').forEach(handleEl => {
    handleEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      e.stopPropagation();
      const elId = handleEl.dataset.resizeEl;
      const domEl = handleEl.closest('[data-edit-el]');
      const item = playEditorState.elements.find(it => it.id === elId);
      if (!domEl || !item) return;

      playEditorState.selectedId = elId;
      $$('#playEditorStage [data-edit-el]').forEach(n => n.classList.toggle('is-selected', n.dataset.editEl === elId));
      renderEditorSelectionBar();

      const r = domEl.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const startDist = Math.max(18, Math.hypot(e.clientX - cx, e.clientY - cy));
      const startScale = Number(item.scale || 1);
      const rot = Number(item.rot ?? 0);
      let resized = false;

      try { handleEl.setPointerCapture(e.pointerId); } catch (err) {}

      const onMove = ev => {
        const curDist = Math.max(10, Math.hypot(ev.clientX - cx, ev.clientY - cy));
        if (!resized && Math.abs(curDist - startDist) > 2) {
          pushPlayEditorHistory();
          resized = true;
        }
        const nextScale = Math.min(2.6, Math.max(0.35, Math.round((startScale * (curDist / startDist)) * 100) / 100));
        item.scale = nextScale;
        domEl.style.setProperty('--el-inv-scale', (1 / Math.max(0.45, nextScale)).toFixed(3));
        domEl.style.transform = `translate(-50%,-50%) scale(${nextScale}) rotate(${rot}deg)`;
      };
      const onUp = () => {
        handleEl.removeEventListener('pointermove', onMove);
        handleEl.removeEventListener('pointerup', onUp);
        handleEl.removeEventListener('pointercancel', onUp);
      };
      handleEl.addEventListener('pointermove', onMove);
      handleEl.addEventListener('pointerup', onUp);
      handleEl.addEventListener('pointercancel', onUp);
    });
  });

  renderEditorSelectionBar();
}

$('#playEditorStage')?.addEventListener('pointerdown', e => {
  if (e.target === $('#playEditorStage')) {
    playEditorState.selectedId = null;
    renderPlayEditorStage();
  }
});

async function loadPlayEditorGifs(query = '') {
  const grid = $('#playEditorGifGrid');
  const statusEl = $('#playEditorGifStatus');
  if (!grid || typeof fetchGiphyGifs !== 'function') return;
  grid.innerHTML = '<p class="muted tiny" style="grid-column:1/-1;padding:12px 4px;text-align:center;">Loading GIFs...</p>';
  const res = await fetchGiphyGifs(query, 24);
  if (statusEl) {
    if (res.error) { statusEl.textContent = res.error; statusEl.classList.remove('hidden'); }
    else { statusEl.textContent = ''; statusEl.classList.add('hidden'); }
  }
  if (!res.gifs.length) {
    grid.innerHTML = '<p class="muted tiny" style="grid-column:1/-1;padding:12px 4px;text-align:center;">No GIFs found.</p>';
    return;
  }
  grid.innerHTML = res.gifs.map((g, i) => `
    <button type="button" class="dm-gif-tile" data-editor-gif-idx="${i}" title="${escapeHtml(g.title)}">
      <img src="${escapeHtml(g.previewUrl)}" alt="${escapeHtml(g.title)}" loading="lazy">
    </button>
  `).join('');
  $$('#playEditorGifGrid [data-editor-gif-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const picked = res.gifs[Number(btn.dataset.editorGifIdx)];
      if (!picked) return;
      pushPlayEditorHistory();
      const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
      playEditorState.elements.push({
        id: newId,
        type: 'gif',
        x: 50,
        y: 48,
        scale: 1,
        rot: 0,
        opacity: 1,
        anim: 'none',
        gifUrl: picked.gifUrl
      });
      playEditorState.selectedId = newId;
      $('#playEditorGifPanel')?.classList.add('hidden');
      renderPlayEditorStage();
    });
  });
}

let pendingEditorAudioFile = null;
let pendingEditorAudioPreviewEl = null;
let pendingEditorAudioPreviewObjUrl = '';

function stopEditorCustomAudioPreview() {
  if (pendingEditorAudioPreviewEl) {
    try { pendingEditorAudioPreviewEl.pause(); } catch (e) {}
    pendingEditorAudioPreviewEl = null;
  }
  if (pendingEditorAudioPreviewObjUrl) {
    try { URL.revokeObjectURL(pendingEditorAudioPreviewObjUrl); } catch (e) {}
    pendingEditorAudioPreviewObjUrl = '';
  }
  const prevBtn = $('#playEditorCustomAudioPreviewBtn');
  if (prevBtn) prevBtn.textContent = '▶ Test';
}

function syncEditorCustomAudioUi() {
  const prevBtn = $('#playEditorCustomAudioPreviewBtn');
  const clearBtn = $('#playEditorCustomAudioClearBtn');
  const nameInp = $('#playEditorCustomAudioNameInput');
  const statusEl = $('#playEditorCustomAudioStatus');
  const musicSel = $('#playEditorMusicSelect');
  const hasAudio = Boolean(pendingEditorAudioFile);

  if (prevBtn) {
    prevBtn.classList.toggle('hidden', !hasAudio);
    prevBtn.textContent = pendingEditorAudioPreviewEl ? '■ Stop' : '▶ Test';
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasAudio);
  if (nameInp) nameInp.classList.toggle('hidden', !hasAudio);
  if (musicSel) {
    musicSel.disabled = hasAudio;
    if (hasAudio) musicSel.value = '';
  }
  if (statusEl) {
    statusEl.textContent = hasAudio
      ? `♪ ${pendingEditorAudioFile.name} — attached only to this video (viewers can download & use it too!).`
      : 'Optional — attach your own audio file to this video. Viewers can click the song in the corner to download & use it!';
  }
}

async function openPlayCreatorStudio(preloadedSong = null) {
  $('#playUploadChoiceModal')?.classList.add('hidden');
  stopActivePlayMedia();
  stopMusicPreviewAudio();
  stopEditorCustomAudioPreview();
  stopVoiceoverRecorderIfActive();
  stopVoiceoverPreview();
  playVoiceoverState.creatorUrl = '';
  syncVoiceoverUi('creator');

  pendingEditorAudioFile = preloadedSong?.file || null;
  if ($('#playEditorCustomAudioInput')) $('#playEditorCustomAudioInput').value = '';
  if ($('#playEditorCustomAudioNameInput')) {
    $('#playEditorCustomAudioNameInput').value = pendingEditorAudioFile
      ? cleanMediaDisplayName(preloadedSong?.name || pendingEditorAudioFile.name)
      : '';
  }

  playEditorState.bgColor = '#161222';
  playEditorState.aspectRatio = '9:16';
  playEditorState.elements = [];
  playEditorState.history = [];
  playEditorState.selectedId = null;
  playEditorState.linkedCoinId = '';
  playEditorState.gifQuery = '';
  playEditorState.saving = false;
  if ($('#playCreatorTitle')) $('#playCreatorTitle').value = '';
  if ($('#playBgColorInput')) $('#playBgColorInput').value = '#161222';
  if ($('#playCreatorMsg')) $('#playCreatorMsg').textContent = '';
  if ($('#playCreatorUndoBtn')) $('#playCreatorUndoBtn').disabled = true;
  if ($('#playCreatorFinishBtn')) {
    $('#playCreatorFinishBtn').disabled = false;
  }
  updatePlayUploadFeeUi();
  $$('#playBgSwatches .play-bg-swatch').forEach(b => b.classList.toggle('active', b.dataset.bg === '#161222'));
  $('#playEditorPlusMenu')?.classList.add('hidden');
  $('#playEditorTextPanel')?.classList.add('hidden');
  $('#playEditorStickerPanel')?.classList.add('hidden');
  $('#playEditorGifPanel')?.classList.add('hidden');
  $('#playEditorPollPanel')?.classList.add('hidden');
  if (typeof resetPlayEditorPollBuilder === 'function') resetPlayEditorPollBuilder();
  renderPlayStickerGrid();
  populatePlayCoinSelect($('#playEditorCoinSelect'), 'No Linked Coin (optional)');
  syncPlayEditorAspectUi();
  renderPlayEditorStage();
  syncEditorCustomAudioUi();
  $('#playCreatorModal')?.classList.remove('hidden');
  await populateMusicSelect($('#playEditorMusicSelect'), 'No Music');
  if (!pendingEditorAudioFile && preloadedSong?.builtInTrackName && $('#playEditorMusicSelect')) {
    $('#playEditorMusicSelect').value = preloadedSong.builtInTrackName;
  }
  syncEditorCustomAudioUi();
}

function closePlayCreatorStudio() {
  stopMusicPreviewAudio();
  stopEditorCustomAudioPreview();
  stopVoiceoverRecorderIfActive();
  stopVoiceoverPreview();
  pendingEditorAudioFile = null;
  hideModalSmooth($('#playCreatorModal'));
}

$('#playChooseCreateBtn')?.addEventListener('click', () => openPlayCreatorStudio());
$('#playCreatorCancelBtn')?.addEventListener('click', closePlayCreatorStudio);
$('#playCreatorUndoBtn')?.addEventListener('click', undoPlayEditor);

$$('#playAspectRatioGroup .play-aspect-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    pushPlayEditorHistory();
    playEditorState.aspectRatio = btn.dataset.aspect || '9:16';
    syncPlayEditorAspectUi();
  });
});

$$('#playBgSwatches .play-bg-swatch').forEach(btn => {
  btn.addEventListener('click', () => {
    pushPlayEditorHistory();
    playEditorState.bgColor = btn.dataset.bg || '#161222';
    if ($('#playBgColorInput') && /^#[0-9a-fA-F]{6}$/.test(playEditorState.bgColor)) {
      $('#playBgColorInput').value = playEditorState.bgColor;
    }
    $$('#playBgSwatches .play-bg-swatch').forEach(b => b.classList.toggle('active', b === btn));
    if ($('#playEditorStage')) $('#playEditorStage').style.background = playEditorState.bgColor;
  });
});
$('#playBgColorInput')?.addEventListener('input', e => {
  pushPlayEditorHistory();
  playEditorState.bgColor = e.target.value || '#161222';
  $$('#playBgSwatches .play-bg-swatch').forEach(b => b.classList.remove('active'));
  if ($('#playEditorStage')) $('#playEditorStage').style.background = playEditorState.bgColor;
});

function hideAllEditorSubpanels() {
  $('#playEditorPlusMenu')?.classList.add('hidden');
  $('#playEditorTextPanel')?.classList.add('hidden');
  $('#playEditorStickerPanel')?.classList.add('hidden');
  $('#playEditorGifPanel')?.classList.add('hidden');
  $('#playEditorPollPanel')?.classList.add('hidden');
}

function renderPlayEditorPollOptionRows(values = ['', '']) {
  const wrap = $('#playEditorPollOptionsWrap');
  const addBtn = $('#playEditorPollAddOptBtn');
  if (!wrap) return;
  const list = Array.isArray(values) ? values.slice(0, 4) : ['', ''];
  while (list.length < 2) list.push('');
  wrap.innerHTML = list.map((val, idx) => `
    <div class="play-poll-opt-row">
      <input class="play-poll-opt-input" maxlength="36" placeholder="Option ${idx + 1}" value="${escapeHtml(val)}">
      ${list.length > 2 ? `<button type="button" class="zoom-btn play-poll-rem-opt" data-rem-idx="${idx}" title="Remove option">✕</button>` : ''}
    </div>
  `).join('');
  wrap.querySelectorAll('.play-poll-rem-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.remIdx);
      const cur = Array.from(wrap.querySelectorAll('.play-poll-opt-input')).map(i => i.value);
      cur.splice(idx, 1);
      renderPlayEditorPollOptionRows(cur);
    });
  });
  if (addBtn) {
    addBtn.disabled = list.length >= 4;
    addBtn.textContent = list.length >= 4 ? 'Max 4 Options' : `＋ Add Option (${list.length}/4)`;
  }
}

function resetPlayEditorPollBuilder() {
  if ($('#playEditorPollQuestionInput')) $('#playEditorPollQuestionInput').value = '';
  renderPlayEditorPollOptionRows(['', '']);
}

$('#playEditorPollAddOptBtn')?.addEventListener('click', () => {
  const wrap = $('#playEditorPollOptionsWrap');
  if (!wrap) return;
  const cur = Array.from(wrap.querySelectorAll('.play-poll-opt-input')).map(i => i.value);
  if (cur.length >= 4) return toast('Polls can have a maximum of 4 options.');
  cur.push('');
  renderPlayEditorPollOptionRows(cur);
  wrap.querySelectorAll('.play-poll-opt-input')[cur.length - 1]?.focus();
});

$('#playEditorAddPollConfirmBtn')?.addEventListener('click', () => {
  const q = ($('#playEditorPollQuestionInput')?.value || '').trim().slice(0, 80);
  const opts = Array.from($$('#playEditorPollOptionsWrap .play-poll-opt-input'))
    .map(i => (i.value || '').trim().slice(0, 36))
    .filter(Boolean)
    .slice(0, 4);
  if (!q) return toast('Enter a poll question first!');
  if (opts.length < 2) return toast('Add at least 2 poll options (max 4)!');
  pushPlayEditorHistory();
  // Replace any existing poll element so each short stays clean with 1 interactive poll
  playEditorState.elements = playEditorState.elements.filter(el => el.type !== 'poll');
  const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
  playEditorState.elements.push({
    id: newId,
    type: 'poll',
    x: 50,
    y: 52,
    scale: 1,
    rot: 0,
    opacity: 1,
    anim: 'none',
    question: q,
    options: opts
  });
  playEditorState.selectedId = newId;
  hideAllEditorSubpanels();
  resetPlayEditorPollBuilder();
  renderPlayEditorStage();
});

$('#playEditorPlusBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  $('#playEditorPlusMenu')?.classList.toggle('hidden');
});
$('#playAddGifModeBtn')?.addEventListener('click', () => {
  hideAllEditorSubpanels();
  $('#playEditorGifPanel')?.classList.remove('hidden');
  loadPlayEditorGifs(playEditorState.gifQuery);
  setTimeout(() => $('#playEditorGifSearchInput')?.focus(), 40);
});
$('#playAddTextModeBtn')?.addEventListener('click', () => {
  hideAllEditorSubpanels();
  $('#playEditorTextPanel')?.classList.remove('hidden');
  setTimeout(() => $('#playEditorTextInput')?.focus(), 40);
});
$('#playAddStickerModeBtn')?.addEventListener('click', () => {
  hideAllEditorSubpanels();
  renderPlayStickerGrid();
  $('#playEditorStickerPanel')?.classList.remove('hidden');
});
$('#playAddPhotoModeBtn')?.addEventListener('click', () => {
  hideAllEditorSubpanels();
  $('#playEditorPhotoInput')?.click();
});
$('#playAddPollModeBtn')?.addEventListener('click', () => {
  hideAllEditorSubpanels();
  const existingPoll = playEditorState.elements.find(el => el.type === 'poll');
  if (existingPoll) {
    if ($('#playEditorPollQuestionInput')) $('#playEditorPollQuestionInput').value = existingPoll.question || '';
    renderPlayEditorPollOptionRows(existingPoll.options || ['', '']);
  } else {
    resetPlayEditorPollBuilder();
  }
  $('#playEditorPollPanel')?.classList.remove('hidden');
  setTimeout(() => $('#playEditorPollQuestionInput')?.focus(), 40);
});

async function addPlayEditorImageFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) {
    toast('Please choose an image file.');
    return;
  }
  try {
    const photoUrl = await compressPlayCanvasImage(file);
    pushPlayEditorHistory();
    const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    playEditorState.elements.push({
      id: newId, type: 'photo', x: 50, y: 48, scale: 1.15, rot: 0, opacity: 1, anim: 'none', photoUrl
    });
    playEditorState.selectedId = newId;
    renderPlayEditorStage();
  } catch (err) {
    toast(err?.message || 'Could not add image');
  }
}

$('#playEditorPhotoInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (file) await addPlayEditorImageFile(file);
});

(() => {
  const stageEl = $('#playEditorStage');
  if (!stageEl) return;
  stageEl.addEventListener('dragover', e => {
    if (e.dataTransfer?.types?.includes('Files')) {
      e.preventDefault();
      stageEl.classList.add('is-dragover');
    }
  });
  stageEl.addEventListener('dragleave', () => stageEl.classList.remove('is-dragover'));
  stageEl.addEventListener('drop', async e => {
    stageEl.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && String(file.type || '').startsWith('image/')) {
      e.preventDefault();
      await addPlayEditorImageFile(file);
    }
  });
})();

$('#playCustomEmojiAddBtn')?.addEventListener('click', () => {
  const inp = $('#playCustomEmojiInput');
  const em = (inp?.value || '').trim();
  if (!em) return toast('Enter an emoji first!');
  pushPlayEditorHistory();
  const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
  playEditorState.elements.push({
    id: newId, type: 'sticker', x: 50, y: 48, scale: 1.2, rot: 0, opacity: 1, anim: 'none', emoji: em.slice(0, 8)
  });
  playEditorState.selectedId = newId;
  if (inp) inp.value = '';
  $('#playEditorStickerPanel')?.classList.add('hidden');
  renderPlayEditorStage();
});

let playEditorGifTimer = null;
$('#playEditorGifSearchInput')?.addEventListener('input', e => {
  playEditorState.gifQuery = e.target.value;
  clearTimeout(playEditorGifTimer);
  playEditorGifTimer = setTimeout(() => loadPlayEditorGifs(playEditorState.gifQuery), 320);
});

$('#playEditorAddTextConfirmBtn')?.addEventListener('click', () => {
  const inp = $('#playEditorTextInput');
  const txt = (inp?.value || '').trim();
  if (!txt) return toast('Enter some text first!');
  const color = $('#playEditorNewTextColor')?.value || '#ffffff';
  const font = $('#playEditorNewTextFont')?.value || 'sans';
  pushPlayEditorHistory();
  const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
  playEditorState.elements.push({
    id: newId,
    type: 'text',
    x: 50,
    y: 45,
    scale: 1,
    rot: 0,
    opacity: 1,
    anim: 'none',
    text: txt.slice(0, 90),
    color,
    style: 'pill',
    font
  });
  playEditorState.selectedId = newId;
  if (inp) inp.value = '';
  $('#playEditorTextPanel')?.classList.add('hidden');
  renderPlayEditorStage();
});

$('#playSelScaleDownBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  it.scale = Math.max(0.5, Math.round(((it.scale || 1) - 0.15) * 100) / 100);
  renderPlayEditorStage();
});
$('#playSelScaleUpBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  it.scale = Math.min(2.4, Math.round(((it.scale || 1) + 0.15) * 100) / 100);
  renderPlayEditorStage();
});
$('#playSelRotLeftBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  it.rot = ((Number(it.rot || 0) - 15) + 360) % 360;
  if (it.rot > 180) it.rot -= 360;
  renderPlayEditorStage();
});
$('#playSelRotRightBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  it.rot = (Number(it.rot || 0) + 15);
  if (it.rot > 180) it.rot -= 360;
  renderPlayEditorStage();
});
$('#playSelAnimBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  const order = ['none', 'pulse', 'float', 'spin'];
  it.anim = order[(order.indexOf(it.anim || 'none') + 1) % order.length];
  renderPlayEditorStage();
});
$('#playSelOpacityBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  const order = [1, 0.8, 0.55];
  const idx = order.findIndex(v => Math.abs(v - Number(it.opacity ?? 1)) < 0.08);
  it.opacity = order[(idx + 1) % order.length];
  renderPlayEditorStage();
});
$('#playSelTextColorInput')?.addEventListener('input', e => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it || it.type !== 'text') return;
  it.color = e.target.value;
  renderPlayEditorStage();
});
$('#playSelTextStyleBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it || it.type !== 'text') return;
  pushPlayEditorHistory();
  const order = ['pill', 'outline', 'plain'];
  it.style = order[(order.indexOf(it.style || 'pill') + 1) % order.length];
  renderPlayEditorStage();
});
$('#playSelTextFontBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it || it.type !== 'text') return;
  pushPlayEditorHistory();
  const order = ['sans', 'impact', 'mono', 'serif'];
  it.font = order[(order.indexOf(it.font || 'sans') + 1) % order.length];
  renderPlayEditorStage();
});
$('#playSelFrontBtn')?.addEventListener('click', () => {
  const idx = playEditorState.elements.findIndex(el => el.id === playEditorState.selectedId);
  if (idx < 0 || idx === playEditorState.elements.length - 1) return;
  pushPlayEditorHistory();
  const [it] = playEditorState.elements.splice(idx, 1);
  playEditorState.elements.push(it);
  renderPlayEditorStage();
});
$('#playSelBackBtn')?.addEventListener('click', () => {
  const idx = playEditorState.elements.findIndex(el => el.id === playEditorState.selectedId);
  if (idx <= 0) return;
  pushPlayEditorHistory();
  const [it] = playEditorState.elements.splice(idx, 1);
  playEditorState.elements.unshift(it);
  renderPlayEditorStage();
});
$('#playSelDupBtn')?.addEventListener('click', () => {
  const it = playEditorState.elements.find(el => el.id === playEditorState.selectedId);
  if (!it) return;
  pushPlayEditorHistory();
  const newId = 'el_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
  const copy = { ...it, id: newId, x: Math.min(88, it.x + 6), y: Math.min(86, it.y + 6) };
  playEditorState.elements.push(copy);
  playEditorState.selectedId = newId;
  renderPlayEditorStage();
});
$('#playSelDeleteBtn')?.addEventListener('click', () => {
  if (!playEditorState.selectedId) return;
  pushPlayEditorHistory();
  playEditorState.elements = playEditorState.elements.filter(el => el.id !== playEditorState.selectedId);
  playEditorState.selectedId = null;
  renderPlayEditorStage();
});
$('#playEditorMusicPreviewBtn')?.addEventListener('click', () => {
  playSelectedMusicPreview($('#playEditorMusicSelect'), $('#playEditorMusicPreviewBtn'));
});

$('#playEditorCustomAudioInput')?.addEventListener('change', e => {
  const audioFile = e.target.files?.[0];
  stopEditorCustomAudioPreview();
  if (!audioFile) return;
  if (audioFile.size > 25 * 1024 * 1024) {
    toast('Audio file must be under 25 MB.');
    e.target.value = '';
    return;
  }
  stopMusicPreviewAudio();
  pendingEditorAudioFile = audioFile;
  if ($('#playEditorCustomAudioNameInput')) {
    $('#playEditorCustomAudioNameInput').value = cleanMediaDisplayName(audioFile.name);
  }
  syncEditorCustomAudioUi();
  toast(`Attached audio: ${audioFile.name}`);
});

$('#playEditorCustomAudioPreviewBtn')?.addEventListener('click', () => {
  if (pendingEditorAudioPreviewEl) {
    stopEditorCustomAudioPreview();
    return;
  }
  if (!pendingEditorAudioFile) return;
  stopMusicPreviewAudio();
  const objUrl = URL.createObjectURL(pendingEditorAudioFile);
  const audio = createPlayableAudioElement(objUrl);
  audio.loop = true;
  audio.volume = 0.72;
  pendingEditorAudioPreviewObjUrl = objUrl;
  pendingEditorAudioPreviewEl = audio;
  const prevBtn = $('#playEditorCustomAudioPreviewBtn');
  if (prevBtn) prevBtn.textContent = '■ Stop';
  audio.play().catch(() => toast('Tap again to preview audio'));
});

$('#playEditorCustomAudioClearBtn')?.addEventListener('click', () => {
  stopEditorCustomAudioPreview();
  pendingEditorAudioFile = null;
  if ($('#playEditorCustomAudioInput')) $('#playEditorCustomAudioInput').value = '';
  if ($('#playEditorCustomAudioNameInput')) $('#playEditorCustomAudioNameInput').value = '';
  syncEditorCustomAudioUi();
});

$('#playCreatorFinishBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser?.id || playEditorState.saving) return;
  const msgEl = $('#playCreatorMsg');
  const finishBtn = $('#playCreatorFinishBtn');
  if (!playEditorState.elements.length) {
    if (msgEl) msgEl.textContent = 'Press ＋ Add Element to drop a GIF, Text, Sticker, or Image first!';
    return;
  }
  if (playVoiceoverState.recordingTarget === 'creator') {
    if (msgEl) msgEl.textContent = 'Stop recording your voiceover before publishing!';
    return;
  }
  playEditorState.saving = true;
  if (msgEl) msgEl.textContent = '';
  if (finishBtn) {
    finishBtn.disabled = true;
    finishBtn.textContent = 'Publishing...';
  }

  const feeRes = await chargePlayUploadFeeAtomic();
  if (!feeRes.ok) {
    playEditorState.saving = false;
    if (finishBtn) finishBtn.disabled = false;
    updatePlayUploadFeeUi();
    if (msgEl) msgEl.textContent = feeRes.error;
    return;
  }

  const newVidId = 'pvid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  let customAudioName = '';
  let customAudioUrl = '';
  let customAudioId = '';
  if (pendingEditorAudioFile) {
    customAudioName = cleanMediaDisplayName(
      ($('#playEditorCustomAudioNameInput')?.value || '').trim() || pendingEditorAudioFile.name
    ) || 'Custom Audio';
    customAudioId = 'paud_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    try {
      if (msgEl) msgEl.textContent = 'Saving custom audio to GitHub...';
      customAudioUrl = await uploadPlayAudioToGitHub(pendingEditorAudioFile, customAudioId);
    } catch (audErr) {
      if (feeRes.charged > 0) await refundPlayUploadFee(feeRes.charged);
      playEditorState.saving = false;
      if (finishBtn) finishBtn.disabled = false;
      updatePlayUploadFeeUi();
      if (msgEl) msgEl.textContent = 'Audio upload failed: ' + (audErr?.message || 'Unknown error');
      return;
    }
  }

  const musicName = $('#playEditorMusicSelect')?.value || '';
  const track = !customAudioUrl && musicName ? (musicCache || []).find(t => t.name === musicName) : null;
  const linkedId = $('#playEditorCoinSelect')?.value || '';
  const linkedCoin = linkedId ? (coins || []).find(c => String(c.id) === String(linkedId)) : null;
  const rawVoUrl = playVoiceoverState.creatorUrl || '';
  let voUrl = rawVoUrl;
  if (rawVoUrl && rawVoUrl.startsWith('data:audio/') && typeof maybeUploadVoiceoverToGitHub === 'function') {
    if (msgEl) msgEl.textContent = 'Uploading voiceover to GitHub...';
    voUrl = await maybeUploadVoiceoverToGitHub(rawVoUrl, newVidId);
  }
  const payload = {
    id: newVidId,
    kind: 'scene',
    title: ($('#playCreatorTitle')?.value || '').trim().slice(0, 60),
    bgColor: playEditorState.bgColor || '#161222',
    aspectRatio: playEditorState.aspectRatio || '9:16',
    elements: playEditorState.elements.map(({ id, type, x, y, scale, rot, opacity, anim, gifUrl, photoUrl, emoji, text, color, style, font, question, options }) => ({
      id, type, x, y, scale, rot: Number(rot || 0), opacity: Number(opacity ?? 1), anim: anim || 'none',
      ...(gifUrl ? { gifUrl } : {}),
      ...(photoUrl ? { photoUrl } : {}),
      ...(emoji ? { emoji } : {}),
      ...(text ? { text, color, style, font: font || 'sans' } : {}),
      ...(type === 'poll' && question && Array.isArray(options) ? { question: String(question).slice(0, 80), options: options.slice(0, 4).map(o => String(o).slice(0, 36)) } : {})
    })),
    musicName: customAudioUrl ? customAudioName : (track ? track.name : ''),
    musicUrl: customAudioUrl ? customAudioUrl : (track ? track.url : ''),
    musicFallbackUrl: customAudioUrl ? '' : (track ? (track.fallbackUrl || '') : ''),
    ...(customAudioId ? { musicAudioId: customAudioId } : {}),
    ...(voUrl ? { voiceoverUrl: voUrl } : {}),
    ...(linkedCoin ? { linkedCoinId: String(linkedCoin.id), linkedCoinName: linkedCoin.name, linkedCoinTicker: linkedCoin.ticker } : {}),
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_VID__:' + JSON.stringify(payload),
    status: 'denied'
  });
  playEditorState.saving = false;
  if (finishBtn) finishBtn.disabled = false;
  updatePlayUploadFeeUi();
  if (error) {
    if (customAudioId) {
      try { await deletePlayVideoFileFromGitHub({ id: customAudioId, user_id: currentUser.id, musicAudioId: customAudioId }); } catch (e) {}
    }
    if (feeRes.charged > 0) await refundPlayUploadFee(feeRes.charged);
    if (msgEl) msgEl.textContent = 'Publish error: ' + error.message;
    return;
  }
  playSound('upload');
  closePlayCreatorStudio();
  toast(feeRes.charged > 0 ? `Short published to Play! (-${money(feeRes.charged)} fee)` : 'Short published to Play!');
  await loadPlayData(true);
  renderAccountPlayVideos();
  openPlayAtVideo(newVidId);
});

// Video File Upload Modal
let pendingUploadVideoDataUrl = '';
let pendingUploadVideoAspect = 9 / 16;
let pendingUploadBusy = false;
let pendingUploadSourceVideoFile = null;
let pendingUploadCustomSongFile = null;
let pendingUploadCustomSongPreviewAudio = null;
let pendingUploadCustomSongPreviewUrl = '';
let pendingUploadJobSeq = 0;

function readFileAsDataUrlPromise(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read video file'));
    r.readAsDataURL(file);
  });
}

function stopCustomSongPreviewAudio() {
  if (pendingUploadCustomSongPreviewAudio) {
    try { pendingUploadCustomSongPreviewAudio.pause(); } catch (e) {}
    pendingUploadCustomSongPreviewAudio = null;
  }
  if (pendingUploadCustomSongPreviewUrl) {
    try { URL.revokeObjectURL(pendingUploadCustomSongPreviewUrl); } catch (e) {}
    pendingUploadCustomSongPreviewUrl = '';
  }
  const prevBtn = $('#playUploadCustomSongPreviewBtn');
  if (prevBtn) prevBtn.textContent = '▶ Test';
}

function syncCustomSongUi() {
  const prevBtn = $('#playUploadCustomSongPreviewBtn');
  const clearBtn = $('#playUploadCustomSongClearBtn');
  const statusEl = $('#playUploadCustomSongStatus');
  const musicSel = $('#playUploadMusicSelect');
  const hasSong = Boolean(pendingUploadCustomSongFile);

  if (prevBtn) {
    prevBtn.classList.toggle('hidden', !hasSong);
    prevBtn.textContent = pendingUploadCustomSongPreviewAudio ? '■ Stop' : '▶ Test';
  }
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasSong);
  if (musicSel) {
    musicSel.disabled = hasSong;
    if (hasSong) musicSel.value = '';
  }
  if (statusEl) {
    statusEl.textContent = hasSong
      ? `♪ ${pendingUploadCustomSongFile.name} — baked into your GitHub video file!`
      : 'Optional — MP3, WAV, OGG, or M4A mixed directly into your GitHub video file.';
  }
}

async function compressPlayVideoFile(file, onProgress, options = {}) {
  const customSongFile = options?.customSongFile || null;
  const muteOriginal = Boolean(options?.muteOriginal);
  const objectUrl = URL.createObjectURL(file);
  const vid = document.createElement('video');
  vid.muted = false;
  vid.volume = 1;
  vid.playsInline = true;
  vid.src = objectUrl;

  await new Promise((res, rej) => {
    vid.onloadedmetadata = () => res();
    vid.onerror = () => rej(new Error('Unsupported video format'));
  });

  const maxDur = Math.min(Number(vid.duration || 12), 18);
  const natW = vid.videoWidth || 360;
  const natH = vid.videoHeight || 640;
  const aspectRatio = Math.min(2.6, Math.max(0.35, Number((natW / natH).toFixed(4))));
  // Every uploaded PLAY video is re-encoded with its longest edge capped at 340px.
  const scale = Math.min(1, 340 / Math.max(natW, natH));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round((natW * scale) / 2) * 2);
  canvas.height = Math.max(2, Math.round((natH * scale) / 2) * 2);
  const ctx = canvas.getContext('2d');
  const canvasStream = canvas.captureStream(24);
  const tracks = [...canvasStream.getVideoTracks()];

  // Mix original video audio and optional uploaded custom song via Web Audio (silent during encode)
  let audioCtx = null;
  let audioDest = null;
  let songBufferSource = null;
  let fallbackSongAudio = null;
  let fallbackSongUrl = '';
  let hasAudioTrack = false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      audioDest = audioCtx.createMediaStreamDestination();

      const sourceNode = audioCtx.createMediaElementSource(vid);
      const origGain = audioCtx.createGain();
      origGain.gain.value = muteOriginal ? 0 : (customSongFile ? 0.8 : 1.0);
      sourceNode.connect(origGain);
      origGain.connect(audioDest);

      if (customSongFile) {
        let decoded = false;
        try {
          const arrBuf = await customSongFile.arrayBuffer();
          const audioBuf = await audioCtx.decodeAudioData(arrBuf);
          songBufferSource = audioCtx.createBufferSource();
          songBufferSource.buffer = audioBuf;
          songBufferSource.loop = true;
          const songGain = audioCtx.createGain();
          songGain.gain.value = muteOriginal ? 0.92 : 0.72;
          songBufferSource.connect(songGain);
          songGain.connect(audioDest);
          decoded = true;
        } catch (decodeErr) {
          decoded = false;
        }
        if (!decoded) {
          fallbackSongUrl = URL.createObjectURL(customSongFile);
          fallbackSongAudio = document.createElement('audio');
          fallbackSongAudio.src = fallbackSongUrl;
          fallbackSongAudio.loop = true;
          fallbackSongAudio.playsInline = true;
          const songNode = audioCtx.createMediaElementSource(fallbackSongAudio);
          const songGain = audioCtx.createGain();
          songGain.gain.value = muteOriginal ? 0.92 : 0.72;
          songNode.connect(songGain);
          songGain.connect(audioDest);
        }
      }

      const capturedAudio = audioDest.stream.getAudioTracks();
      if (capturedAudio.length) {
        capturedAudio.forEach(tr => tracks.push(tr));
        hasAudioTrack = true;
      }
    }
  } catch (e) {
    if (audioCtx) { try { audioCtx.close(); } catch (err) {} }
    audioCtx = null;
    audioDest = null;
    songBufferSource = null;
    if (fallbackSongUrl) { try { URL.revokeObjectURL(fallbackSongUrl); } catch (err) {} }
    fallbackSongAudio = null;
    fallbackSongUrl = '';
  }

  // Fallback to video.captureStream audio track if AudioContext had none
  if (!hasAudioTrack) {
    try {
      const cap = vid.captureStream ? vid.captureStream() : (vid.mozCaptureStream ? vid.mozCaptureStream() : null);
      if (cap) {
        const capAudio = cap.getAudioTracks();
        if (capAudio.length) {
          capAudio.forEach(tr => tracks.push(tr));
          hasAudioTrack = true;
        }
      }
    } catch (e) {}
  }

  const stream = new MediaStream(tracks);
  const preferredMimes = hasAudioTrack
    ? [
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ]
    : [
        'video/mp4;codecs=avc1.42E01E',
        'video/mp4',
        'video/webm;codecs=vp8',
        'video/webm'
      ];
  const mime = preferredMimes.find(m => {
    try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
  }) || '';

  let recorder = null;
  try {
    recorder = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: 320000,
      ...(hasAudioTrack ? { audioBitsPerSecond: 48000 } : {})
    });
  } catch (e) {
    recorder = new MediaRecorder(stream, { videoBitsPerSecond: 320000 });
  }
  const chunks = [];
  recorder.ondataavailable = ev => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };

  return new Promise((resolve, reject) => {
    const cleanupAudio = () => {
      if (songBufferSource) { try { songBufferSource.stop(); } catch (e) {} songBufferSource = null; }
      if (fallbackSongAudio) { try { fallbackSongAudio.pause(); } catch (e) {} fallbackSongAudio = null; }
      if (fallbackSongUrl) { try { URL.revokeObjectURL(fallbackSongUrl); } catch (e) {} fallbackSongUrl = ''; }
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    };
    recorder.onstop = async () => {
      URL.revokeObjectURL(objectUrl);
      cleanupAudio();
      const outputMime = String(recorder.mimeType || mime || chunks[0]?.type || 'video/webm').split(';')[0];
      if (!['video/webm', 'video/mp4'].includes(outputMime)) {
        reject(new Error('This browser could not create a supported MP4/WebM video. Please try another browser.'));
        return;
      }
      const blob = new Blob(chunks, { type: outputMime });
      if (blob.size > 2.8 * 1024 * 1024) {
        reject(new Error('Video is too large after 340p compression. Please choose a shorter clip (under 15 seconds).'));
        return;
      }
      const dataUrl = await readFileAsDataUrlPromise(blob);
      resolve({ dataUrl, aspectRatio, mimeType: outputMime });
    };
    recorder.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      cleanupAudio();
      reject(new Error('Compression failed'));
    };

    vid.currentTime = 0;
    recorder.start(250);
    if (songBufferSource) {
      try { songBufferSource.start(0); } catch (e) {}
    } else if (fallbackSongAudio) {
      fallbackSongAudio.play().catch(() => {});
    }
    vid.play().catch(err => {
      vid.muted = true;
      vid.play().catch(reject);
    });

    const drawLoop = () => {
      if (vid.paused || vid.ended || vid.currentTime >= maxDur || (options?.shouldAbort && options.shouldAbort())) {
        try { vid.pause(); } catch (e) {}
        if (recorder.state !== 'inactive') recorder.stop();
        return;
      }
      ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
      if (onProgress && maxDur > 0) onProgress(Math.min(99, Math.round((vid.currentTime / maxDur) * 100)));
      requestAnimationFrame(drawLoop);
    };
    requestAnimationFrame(drawLoop);
  });
}

async function uploadPlayVideoToGitHub(dataUrl, videoId) {
  if (!sb || !currentUser?.id) throw new Error('Please sign in again before uploading.');
  const { data, error } = await sb.functions.invoke('play-video-storage', {
    body: { action: 'upload', videoId: String(videoId), dataUrl }
  });
  if (error) throw new Error(error.message || 'Could not upload video to GitHub.');
  if (!data?.url || !/^https:\/\/raw\.githubusercontent\.com\//i.test(data.url)) {
    throw new Error(data?.error || 'GitHub returned an invalid video URL.');
  }
  return data.url;
}

function inferPlayAudioMimeType(file) {
  const raw = String(file?.type || '').toLowerCase().split(';')[0].trim();
  const valid = new Set(['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/webm']);
  if (valid.has(raw)) return raw;
  const n = String(file?.name || '').toLowerCase();
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (n.endsWith('.m4a')) return 'audio/mp4';
  if (n.endsWith('.aac')) return 'audio/aac';
  if (n.endsWith('.ogg')) return 'audio/ogg';
  if (n.endsWith('.wav')) return 'audio/wav';
  if (n.endsWith('.webm')) return 'audio/webm';
  return '';
}

async function encodeAudioToMediaContainerDataUrl(audioFile) {
  const objectUrl = URL.createObjectURL(audioFile);
  const el = createPlayableAudioElement(objectUrl);
  el.preload = 'auto';
  el.playsInline = true;
  el.muted = false;
  el.volume = 1;

  await new Promise((resolve, reject) => {
    const done = () => resolve();
    if (el.readyState >= 1) return done();
    el.onloadedmetadata = done;
    el.onerror = () => reject(new Error('Could not read audio file'));
  });

  const maxDur = Math.min(Number(el.duration || 20) || 20, 42);
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#090710';
    ctx.fillRect(0, 0, 16, 16);
  }
  const tracks = [];
  if (canvas.captureStream) {
    tracks.push(...canvas.captureStream(1).getVideoTracks());
  }

  let audioCtx = null;
  let audioDest = null;
  let songBufferSource = null;
  let hasAudioTrack = false;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      audioDest = audioCtx.createMediaStreamDestination();
      let decoded = false;
      try {
        const arrBuf = await audioFile.arrayBuffer();
        const audioBuf = await audioCtx.decodeAudioData(arrBuf);
        songBufferSource = audioCtx.createBufferSource();
        songBufferSource.buffer = audioBuf;
        const g = audioCtx.createGain();
        g.gain.value = 1;
        songBufferSource.connect(g);
        g.connect(audioDest);
        decoded = true;
      } catch (decodeErr) {
        decoded = false;
      }
      if (!decoded) {
        const srcNode = audioCtx.createMediaElementSource(el);
        const g = audioCtx.createGain();
        g.gain.value = 1;
        srcNode.connect(g);
        g.connect(audioDest);
      }
      const cap = audioDest.stream.getAudioTracks();
      if (cap.length) {
        tracks.push(...cap);
        hasAudioTrack = true;
      }
    }
  } catch (e) {
    if (audioCtx) { try { audioCtx.close(); } catch (err) {} }
    audioCtx = null;
    audioDest = null;
    songBufferSource = null;
  }

  if (!hasAudioTrack) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('This browser cannot encode custom audio.');
  }

  const stream = new MediaStream(tracks);
  const preferredMimes = [
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4'
  ];
  const mime = preferredMimes.find(m => {
    try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; }
  }) || '';

  const recorder = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 16000,
    audioBitsPerSecond: 64000
  });
  const chunks = [];
  let totalBytes = 0;
  recorder.ondataavailable = ev => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
      totalBytes += ev.data.size;
      if (totalBytes > 2.4 * 1024 * 1024 && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) {}
      }
    }
  };

  return new Promise((resolve, reject) => {
    let stopTimer = null;
    const cleanup = () => {
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
      try { el.pause(); } catch (e) {}
      URL.revokeObjectURL(objectUrl);
      if (songBufferSource) { try { songBufferSource.stop(); } catch (e) {} songBufferSource = null; }
      if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    };
    recorder.onstop = async () => {
      cleanup();
      const outMime = String(recorder.mimeType || mime || chunks[0]?.type || 'video/webm').split(';')[0];
      const blob = new Blob(chunks, { type: outMime });
      if (blob.size > 2.8 * 1024 * 1024) {
        reject(new Error('Custom audio exceeds 2.8 MB after compression. Try a shorter clip.'));
        return;
      }
      const dataUrl = await readFileAsDataUrlPromise(blob);
      resolve({ dataUrl, mimeType: outMime });
    };
    recorder.onerror = () => {
      cleanup();
      reject(new Error('Audio encoding failed.'));
    };

    recorder.start(250);
    if (songBufferSource) {
      try { songBufferSource.start(0); } catch (e) {}
    } else {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    stopTimer = setTimeout(() => {
      if (recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) {}
      }
    }, Math.max(1000, Math.round(maxDur * 1000)));
  });
}

async function uploadPlayAudioToGitHub(audioFile, songId) {
  if (!sb || !currentUser?.id) throw new Error('Please sign in again before uploading.');
  const mime = inferPlayAudioMimeType(audioFile);
  if (mime && audioFile.size <= 2.65 * 1024 * 1024) {
    let rawDataUrl = await readFileAsDataUrlPromise(audioFile);
    if (!rawDataUrl.startsWith('data:audio/')) {
      const idx = rawDataUrl.indexOf(',');
      if (idx > 0) rawDataUrl = `data:${mime};base64,${rawDataUrl.slice(idx + 1)}`;
    }
    const { data, error } = await sb.functions.invoke('play-video-storage', {
      body: { action: 'upload_audio', videoId: String(songId), dataUrl: rawDataUrl }
    });
    if (!error && data?.url && /^https:\/\/raw\.githubusercontent\.com\//i.test(data.url)) {
      return data.url;
    }
  }
  const encoded = await encodeAudioToMediaContainerDataUrl(audioFile);
  return await uploadPlayVideoToGitHub(encoded.dataUrl, 'aud_' + String(songId));
}

async function maybeUploadVoiceoverToGitHub(voDataUrl, videoId) {
  if (!voDataUrl) return '';
  if (voDataUrl.startsWith('https://')) return voDataUrl;
  try {
    const resp = await fetch(voDataUrl);
    const blob = await resp.blob();
    const ext = String(blob.type || '').includes('mp4') ? 'm4a' : (String(blob.type || '').includes('ogg') ? 'ogg' : 'webm');
    const file = new File([blob], `vo_${videoId}.${ext}`, { type: blob.type || 'audio/webm' });
    return await uploadPlayAudioToGitHub(file, 'vo_' + String(videoId));
  } catch (e) {
    console.warn('Voiceover GitHub upload fallback:', e);
    return voDataUrl;
  }
}

async function deletePlayVideoFileFromGitHub(video) {
  if (!sb || !currentUser?.id || !video?.id || !video?.user_id) return;
  const { data, error } = await sb.functions.invoke('play-video-storage', {
    body: {
      action: 'delete',
      videoId: String(video.id),
      ownerId: String(video.user_id),
      ...(video.musicAudioId ? { audioId: String(video.musicAudioId) } : {})
    }
  });
  if (error) throw new Error(error.message || 'Could not remove the GitHub video file.');
  return Boolean(data?.deleted);
}

function syncPlayUploadPreviewEffects() {
  const prev = $('#playUploadPreviewVideo');
  if (!prev) return;
  const f = $('#playUploadFilterSelect')?.value || 'none';
  const spd = Math.min(2.5, Math.max(0.5, Number($('#playUploadSpeedSelect')?.value || 1)));
  // If a custom song was baked into the video file, do not mute the preview's video audio track
  const muteOrig = pendingUploadCustomSongFile ? false : Boolean($('#playUploadMuteOrigCheckbox')?.checked);
  prev.style.filter = getPlayVideoFilterCss(f);
  try { prev.playbackRate = spd; } catch (e) {}
  prev.muted = muteOrig;
}

async function recompressPendingUploadVideo() {
  const file = pendingUploadSourceVideoFile;
  if (!file) return;
  const myJobId = ++pendingUploadJobSeq;
  const msgEl = $('#playUploadMsg');
  const nameEl = $('#playUploadFileName');
  const pubBtn = $('#publishPlayVideoFileBtn');
  const prev = $('#playUploadPreviewVideo');
  const hasCustom = Boolean(pendingUploadCustomSongFile);
  const muteOrig = Boolean($('#playUploadMuteOrigCheckbox')?.checked);

  pendingUploadVideoDataUrl = '';
  pendingUploadVideoAspect = 9 / 16;
  if (pubBtn) pubBtn.disabled = true;
  if (msgEl) msgEl.textContent = '';

  try {
    pendingUploadBusy = true;
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error('This browser cannot safely compress videos to 340p. Please try an up-to-date Safari or Chrome browser.');
    }
    const labelVerb = hasCustom ? 'Baking custom song & compressing' : 'Optimizing';
    if (nameEl) nameEl.textContent = `${labelVerb} ${file.name} to 340p... 0%`;
    const res = await compressPlayVideoFile(
      file,
      pct => {
        if (myJobId === pendingUploadJobSeq && nameEl) {
          nameEl.textContent = `${labelVerb} ${file.name} to 340p... ${pct}%`;
        }
      },
      {
        customSongFile: pendingUploadCustomSongFile,
        muteOriginal: muteOrig,
        shouldAbort: () => myJobId !== pendingUploadJobSeq
      }
    );
    if (myJobId !== pendingUploadJobSeq) return;
    pendingUploadVideoDataUrl = res.dataUrl;
    pendingUploadVideoAspect = res.aspectRatio;
    if (nameEl) {
      nameEl.textContent = hasCustom
        ? `${file.name} · Ready (340p with custom song baked in!)`
        : `${file.name} · Ready (340p, original audio where supported)!`;
    }
    if (prev && pendingUploadVideoDataUrl) {
      prev.src = pendingUploadVideoDataUrl;
      prev.classList.remove('hidden');
      syncPlayUploadPreviewEffects();
    }
    if (pubBtn && pendingUploadVideoDataUrl) pubBtn.disabled = false;
  } catch (err) {
    if (myJobId === pendingUploadJobSeq && msgEl) {
      msgEl.textContent = err?.message || 'Could not process video file.';
    }
  } finally {
    if (myJobId === pendingUploadJobSeq) {
      pendingUploadBusy = false;
      updatePlayUploadFeeUi();
    }
  }
}

async function openPlayVideoFileModal(preloadedSong = null) {
  $('#playUploadChoiceModal')?.classList.add('hidden');
  stopActivePlayMedia();
  stopMusicPreviewAudio();
  stopVoiceoverRecorderIfActive();
  stopVoiceoverPreview();
  stopCustomSongPreviewAudio();
  playVoiceoverState.uploadUrl = '';
  syncVoiceoverUi('upload');

  pendingUploadJobSeq += 1;
  pendingUploadSourceVideoFile = null;
  pendingUploadCustomSongFile = preloadedSong?.file || null;
  pendingUploadVideoDataUrl = '';
  pendingUploadVideoAspect = 9 / 16;
  pendingUploadBusy = false;
  if ($('#playUploadTitleInput')) $('#playUploadTitleInput').value = '';
  if ($('#playUploadFileInput')) $('#playUploadFileInput').value = '';
  if ($('#playUploadCustomSongInput')) $('#playUploadCustomSongInput').value = '';
  if ($('#playUploadFileName')) $('#playUploadFileName').textContent = 'No video selected';
  if ($('#playUploadMsg')) $('#playUploadMsg').textContent = '';
  if ($('#playUploadFilterSelect')) $('#playUploadFilterSelect').value = 'none';
  if ($('#playUploadSpeedSelect')) $('#playUploadSpeedSelect').value = '1';
  if ($('#playUploadMuteOrigCheckbox')) $('#playUploadMuteOrigCheckbox').checked = false;
  populatePlayCoinSelect($('#playUploadCoinSelect'), 'No Linked Coin');
  const prev = $('#playUploadPreviewVideo');
  if (prev) { prev.src = ''; prev.style.filter = 'none'; prev.classList.add('hidden'); }
  const pubBtn = $('#publishPlayVideoFileBtn');
  if (pubBtn) pubBtn.disabled = true;
  updatePlayUploadFeeUi();
  $('#playVideoFileModal')?.classList.remove('hidden');
  await populateMusicSelect($('#playUploadMusicSelect'), 'Original Video Audio (No extra music)');
  if (!pendingUploadCustomSongFile && preloadedSong?.builtInTrackName && $('#playUploadMusicSelect')) {
    $('#playUploadMusicSelect').value = preloadedSong.builtInTrackName;
  }
  syncCustomSongUi();
}

function closePlayVideoFileModal() {
  pendingUploadJobSeq += 1;
  stopMusicPreviewAudio();
  stopCustomSongPreviewAudio();
  stopVoiceoverRecorderIfActive();
  stopVoiceoverPreview();
  const prev = $('#playUploadPreviewVideo');
  if (prev) { try { prev.pause(); } catch (e) {} prev.src = ''; }
  hideModalSmooth($('#playVideoFileModal'));
}

$('#playChooseUploadBtn')?.addEventListener('click', () => openPlayVideoFileModal());
$('#closePlayVideoFileBtn')?.addEventListener('click', closePlayVideoFileModal);
$('#cancelPlayVideoFileBtn')?.addEventListener('click', closePlayVideoFileModal);
$('#playUploadFilterSelect')?.addEventListener('change', syncPlayUploadPreviewEffects);
$('#playUploadSpeedSelect')?.addEventListener('change', syncPlayUploadPreviewEffects);
$('#playUploadMuteOrigCheckbox')?.addEventListener('change', () => {
  if (pendingUploadCustomSongFile && pendingUploadSourceVideoFile) {
    recompressPendingUploadVideo();
  } else {
    syncPlayUploadPreviewEffects();
  }
});
$('#playUploadMusicPreviewBtn')?.addEventListener('click', () => {
  playSelectedMusicPreview($('#playUploadMusicSelect'), $('#playUploadMusicPreviewBtn'));
});

$('#playUploadCustomSongInput')?.addEventListener('change', async e => {
  const audioFile = e.target.files?.[0];
  stopCustomSongPreviewAudio();
  if (!audioFile) return;
  if (audioFile.size > 25 * 1024 * 1024) {
    toast('Custom song file must be under 25 MB.');
    e.target.value = '';
    return;
  }
  stopMusicPreviewAudio();
  pendingUploadCustomSongFile = audioFile;
  syncCustomSongUi();
  toast(`Selected custom song: ${audioFile.name}`);
  if (pendingUploadSourceVideoFile) {
    await recompressPendingUploadVideo();
  }
});

$('#playUploadCustomSongPreviewBtn')?.addEventListener('click', () => {
  if (pendingUploadCustomSongPreviewAudio) {
    stopCustomSongPreviewAudio();
    return;
  }
  if (!pendingUploadCustomSongFile) return;
  stopMusicPreviewAudio();
  const objUrl = URL.createObjectURL(pendingUploadCustomSongFile);
  const audio = new Audio(objUrl);
  audio.loop = true;
  audio.volume = 0.72;
  pendingUploadCustomSongPreviewUrl = objUrl;
  pendingUploadCustomSongPreviewAudio = audio;
  const prevBtn = $('#playUploadCustomSongPreviewBtn');
  if (prevBtn) prevBtn.textContent = '■ Stop';
  audio.play().catch(() => toast('Tap again to preview custom song'));
});

$('#playUploadCustomSongClearBtn')?.addEventListener('click', async () => {
  stopCustomSongPreviewAudio();
  const hadSong = Boolean(pendingUploadCustomSongFile);
  pendingUploadCustomSongFile = null;
  if ($('#playUploadCustomSongInput')) $('#playUploadCustomSongInput').value = '';
  syncCustomSongUi();
  if (hadSong && pendingUploadSourceVideoFile) {
    await recompressPendingUploadVideo();
  }
});

$('#playUploadFileInput')?.addEventListener('change', async e => {
  const file = e.target.files?.[0];
  pendingUploadSourceVideoFile = file || null;
  if (!file) {
    pendingUploadVideoDataUrl = '';
    pendingUploadVideoAspect = 9 / 16;
    if ($('#publishPlayVideoFileBtn')) $('#publishPlayVideoFileBtn').disabled = true;
    return;
  }
  if ($('#playUploadFileName')) {
    $('#playUploadFileName').textContent = `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`;
  }
  await recompressPendingUploadVideo();
});

$('#publishPlayVideoFileBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser?.id || pendingUploadBusy || !pendingUploadVideoDataUrl) return;
  const pubBtn = $('#publishPlayVideoFileBtn');
  const msgEl = $('#playUploadMsg');
  if (playVoiceoverState.recordingTarget === 'upload') {
    if (msgEl) msgEl.textContent = 'Stop recording your voiceover before publishing!';
    return;
  }
  pubBtn.disabled = true;
  pubBtn.textContent = 'Publishing...';
  if (msgEl) msgEl.textContent = '';

  const feeRes = await chargePlayUploadFeeAtomic();
  if (!feeRes.ok) {
    pubBtn.disabled = false;
    updatePlayUploadFeeUi();
    if (msgEl) msgEl.textContent = feeRes.error;
    return;
  }

  const hasBakedSong = Boolean(pendingUploadCustomSongFile);
  const musicName = hasBakedSong
    ? cleanMediaDisplayName(pendingUploadCustomSongFile.name)
    : ($('#playUploadMusicSelect')?.value || '');
  const track = !hasBakedSong && musicName ? (musicCache || []).find(t => t.name === musicName) : null;
  const linkedId = $('#playUploadCoinSelect')?.value || '';
  const linkedCoin = linkedId ? (coins || []).find(c => String(c.id) === String(linkedId)) : null;
  const rawVoUrl = playVoiceoverState.uploadUrl || '';
  let voUrl = rawVoUrl;
  const newVidId = 'pvid_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  let githubVideoUrl = '';
  let sharedAudioUrl = '';
  let sharedAudioId = '';
  try {
    if (msgEl) msgEl.textContent = 'Uploading compressed video to GRIND...';
    githubVideoUrl = await uploadPlayVideoToGitHub(pendingUploadVideoDataUrl, newVidId);
    if (hasBakedSong) {
      try {
        sharedAudioId = 'paud_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        sharedAudioUrl = await uploadPlayAudioToGitHub(pendingUploadCustomSongFile, sharedAudioId);
      } catch (audioShareErr) {
        sharedAudioUrl = '';
        sharedAudioId = '';
      }
    }
    if (rawVoUrl && rawVoUrl.startsWith('data:audio/') && typeof maybeUploadVoiceoverToGitHub === 'function') {
      voUrl = await maybeUploadVoiceoverToGitHub(rawVoUrl, newVidId);
    }
  } catch (uploadError) {
    if (feeRes.charged > 0) await refundPlayUploadFee(feeRes.charged);
    pubBtn.disabled = false;
    pubBtn.textContent = 'Publish';
    updatePlayUploadFeeUi();
    if (msgEl) msgEl.textContent = 'Video upload failed: ' + (uploadError?.message || 'Unknown error');
    return;
  }

  const payload = {
    id: newVidId,
    kind: 'video',
    title: ($('#playUploadTitleInput')?.value || '').trim().slice(0, 60),
    aspectRatio: pendingUploadVideoAspect || (9 / 16),
    videoUrl: githubVideoUrl,
    videoFilter: $('#playUploadFilterSelect')?.value || 'none',
    playbackRate: Math.min(2.5, Math.max(0.5, Number($('#playUploadSpeedSelect')?.value || 1))),
    muteOriginal: hasBakedSong ? false : Boolean($('#playUploadMuteOrigCheckbox')?.checked),
    musicName: hasBakedSong ? musicName : (track ? track.name : ''),
    musicUrl: hasBakedSong ? sharedAudioUrl : (track ? track.url : ''),
    musicFallbackUrl: hasBakedSong ? '' : (track ? (track.fallbackUrl || '') : ''),
    ...(hasBakedSong ? { musicBakedInVideo: true } : {}),
    ...(sharedAudioId ? { musicAudioId: sharedAudioId } : {}),
    ...(voUrl ? { voiceoverUrl: voUrl } : {}),
    ...(linkedCoin ? { linkedCoinId: String(linkedCoin.id), linkedCoinName: linkedCoin.name, linkedCoinTicker: linkedCoin.ticker } : {}),
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__PLAY_VID__:' + JSON.stringify(payload),
    status: 'denied'
  });

  pubBtn.disabled = false;
  updatePlayUploadFeeUi();
  if (error) {
    try { await deletePlayVideoFileFromGitHub({ id: newVidId, user_id: currentUser.id, musicAudioId: sharedAudioId }); } catch (cleanupError) {}
    if (feeRes.charged > 0) await refundPlayUploadFee(feeRes.charged);
    if (msgEl) msgEl.textContent = 'Upload failed: ' + error.message;
    return;
  }
  playSound('upload');
  closePlayVideoFileModal();
  toast(feeRes.charged > 0 ? `Video published to Play! (-${money(feeRes.charged)} fee)` : 'Video published to Play!');
  await loadPlayData(true);
  renderAccountPlayVideos();
  openPlayAtVideo(newVidId);
});

// ---------- Use / Download Sound Modal (from bottom-corner PLAY song button) ----------
const playUseSongState = {
  videoId: '',
  songTitle: '',
  creatorName: '',
  sourceUrl: '',
  fallbackUrl: '',
  builtInTrackName: '',
  downloadedFile: null,
  downloading: false,
  previewEl: null,
  previewObjUrl: ''
};

function stopPlayUseSongPreview() {
  if (playUseSongState.previewEl) {
    try { playUseSongState.previewEl.pause(); } catch (e) {}
    playUseSongState.previewEl = null;
  }
  if (playUseSongState.previewObjUrl) {
    try { URL.revokeObjectURL(playUseSongState.previewObjUrl); } catch (e) {}
    playUseSongState.previewObjUrl = '';
  }
  const btn = $('#playUseSongPreviewBtn');
  if (btn) btn.textContent = '▶ Preview Sound';
}

function closePlayUseSongModal() {
  stopPlayUseSongPreview();
  hideModalSmooth($('#playUseSongModal'));
}

async function ensurePlayUseSongDownloadedFile() {
  if (playUseSongState.downloadedFile) return playUseSongState.downloadedFile;
  const candidates = [playUseSongState.sourceUrl, playUseSongState.fallbackUrl].filter(Boolean);
  if (!candidates.length) {
    throw new Error('This video has no downloadable audio URL.');
  }
  let lastErr = null;
  for (const url of candidates) {
    try {
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const rawType = String(blob.type || '').split(';')[0] || 'audio/mpeg';
      const extFromUrl = (url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || '').toLowerCase();
      const extMap = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/webm': 'webm', 'video/webm': 'webm', 'video/mp4': 'mp4' };
      const ext = extFromUrl || extMap[rawType] || 'mp3';
      const safeBase = (playUseSongState.songTitle || 'grind_sound').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 42) || 'grind_sound';
      const file = new File([blob], `${safeBase}.${ext}`, { type: rawType });
      playUseSongState.downloadedFile = file;
      return file;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Could not download sound.');
}

async function openPlayUseSongModal(videoId) {
  const vid = playState.videosById.get(String(videoId));
  if (!vid || !vid.musicName) return;

  stopPlayUseSongPreview();
  const title = cleanMediaDisplayName(vid.musicName) || 'Sound';
  const creator = vid.profile?.username || 'Creator';
  const builtInMatch = (musicCache || []).find(t => t.name === vid.musicName || cleanMediaDisplayName(t.name) === title);
  const srcUrl = vid.musicUrl || builtInMatch?.url || (vid.kind === 'video' ? vid.videoUrl : '');
  const fbUrl = vid.musicFallbackUrl || builtInMatch?.fallbackUrl || '';

  playUseSongState.videoId = vid.id;
  playUseSongState.songTitle = title;
  playUseSongState.creatorName = creator;
  playUseSongState.sourceUrl = srcUrl;
  playUseSongState.fallbackUrl = fbUrl;
  playUseSongState.builtInTrackName = builtInMatch && !/^https:\/\/raw\.githubusercontent\.com\/.+\/(?:PLAY|PLAY_AUDIO)\//i.test(String(srcUrl || '')) ? builtInMatch.name : '';
  playUseSongState.downloadedFile = null;
  playUseSongState.downloading = true;

  if ($('#playUseSongHeading')) $('#playUseSongHeading').textContent = `♫ ${title}`;
  if ($('#playUseSongSub')) $('#playUseSongSub').textContent = `Used by @${creator}`;
  if ($('#playUseSongMsg')) $('#playUseSongMsg').textContent = '';
  if ($('#playUseSongStatus')) $('#playUseSongStatus').textContent = 'Downloading sound from GitHub...';
  if ($('#playUseSongDownloadBtn')) $('#playUseSongDownloadBtn').disabled = true;
  $('#playUseSongModal')?.classList.remove('hidden');

  try {
    const file = await ensurePlayUseSongDownloadedFile();
    if (playUseSongState.videoId !== vid.id) return;
    playUseSongState.downloading = false;
    const kb = Math.max(1, Math.round(file.size / 1024));
    if ($('#playUseSongStatus')) {
      $('#playUseSongStatus').textContent = `Downloaded (${kb} KB) — ready to preview, save, or use in your video!`;
    }
    if ($('#playUseSongDownloadBtn')) $('#playUseSongDownloadBtn').disabled = false;
  } catch (err) {
    if (playUseSongState.videoId !== vid.id) return;
    playUseSongState.downloading = false;
    if ($('#playUseSongStatus')) $('#playUseSongStatus').textContent = 'Ready — click Preview or Use Sound.';
    if ($('#playUseSongDownloadBtn')) $('#playUseSongDownloadBtn').disabled = false;
    if ($('#playUseSongMsg')) $('#playUseSongMsg').textContent = err?.message || '';
  }
}

$('#closePlayUseSongBtn')?.addEventListener('click', closePlayUseSongModal);
$('#playUseSongModal')?.addEventListener('click', e => {
  if (e.target === $('#playUseSongModal')) closePlayUseSongModal();
});

$('#playUseSongPreviewBtn')?.addEventListener('click', () => {
  if (playUseSongState.previewEl) {
    stopPlayUseSongPreview();
    return;
  }
  stopActivePlayMedia();
  const prevBtn = $('#playUseSongPreviewBtn');
  let url = playUseSongState.sourceUrl;
  if (playUseSongState.downloadedFile) {
    const objUrl = URL.createObjectURL(playUseSongState.downloadedFile);
    playUseSongState.previewObjUrl = objUrl;
    url = objUrl;
  }
  if (!url) return toast('No audio preview available');
  const el = createPlayableAudioElement(url, playUseSongState.fallbackUrl);
  el.loop = true;
  el.volume = 0.72;
  playUseSongState.previewEl = el;
  if (prevBtn) prevBtn.textContent = '■ Stop';
  el.play().catch(() => toast('Tap again to preview sound'));
});

$('#playUseSongDownloadBtn')?.addEventListener('click', async () => {
  const msgEl = $('#playUseSongMsg');
  const dlBtn = $('#playUseSongDownloadBtn');
  if (msgEl) msgEl.textContent = '';
  if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = 'Downloading...'; }
  try {
    const file = await ensurePlayUseSongDownloadedFile();
    const objUrl = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch (e) {} }, 2500);
    toast(`Downloaded ${file.name}`);
  } catch (err) {
    if (msgEl) msgEl.textContent = err?.message || 'Download failed.';
  } finally {
    if (dlBtn) { dlBtn.disabled = false; dlBtn.textContent = '⬇ Download Audio'; }
  }
});

$('#playUseSongInEditorBtn')?.addEventListener('click', async () => {
  if (!currentUser) {
    closePlayUseSongModal();
    toast('Sign in to create a video with this sound!');
    return;
  }
  const msgEl = $('#playUseSongMsg');
  const btn = $('#playUseSongInEditorBtn');
  if (msgEl) msgEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading Sound...'; }
  try {
    const builtIn = playUseSongState.builtInTrackName;
    const file = builtIn ? null : await ensurePlayUseSongDownloadedFile();
    const songName = playUseSongState.songTitle;
    closePlayUseSongModal();
    await openPlayCreatorStudio({
      file,
      name: songName,
      builtInTrackName: builtIn || ''
    });
    toast(`♫ "${songName}" ready in Video Editor!`);
  } catch (err) {
    if (msgEl) msgEl.textContent = err?.message || 'Could not load sound into Video Editor.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🎬 Use in Video Editor'; }
  }
});

$('#playUseSongInUploadBtn')?.addEventListener('click', async () => {
  if (!currentUser) {
    closePlayUseSongModal();
    toast('Sign in to upload a video with this sound!');
    return;
  }
  const msgEl = $('#playUseSongMsg');
  const btn = $('#playUseSongInUploadBtn');
  if (msgEl) msgEl.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = 'Loading Sound...'; }
  try {
    const builtIn = playUseSongState.builtInTrackName;
    const file = builtIn ? null : await ensurePlayUseSongDownloadedFile();
    const songName = playUseSongState.songTitle;
    closePlayUseSongModal();
    await openPlayVideoFileModal({
      file,
      name: songName,
      builtInTrackName: builtIn || ''
    });
    toast(`♫ "${songName}" ready in Upload Video!`);
  } catch (err) {
    if (msgEl) msgEl.textContent = err?.message || 'Could not load sound into Upload Video.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📤 Use in Upload Video'; }
  }
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
  saveSharedProfileToCache(currentUser);
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
      saveSharedProfileToCache(currentUser);
      updateUIProfile();
      toast('Profile picture updated!');
    } else {
      toast('Error saving picture: ' + error.message);
    }
  });
});

// ---------- Theme Settings (Tier-locked visual themes) ----------
const GRIND_THEMES = [
  {
    id: 'default',
    name: 'Default',
    reqTier: 'member',
    tierBadge: 'Default',
    textureLabel: 'Classic Violet',
    desc: 'Classic GRIND deep violet interface.',
    colors: ['#0c0916', '#161222', '#c084fc', '#7c3aed']
  },
  {
    id: 'gold-obsidian',
    name: 'Gold & Obsidian',
    reqTier: 'pro',
    tierBadge: 'PRO',
    textureLabel: 'Volcanic Obsidian',
    desc: 'Matte volcanic obsidian stone with 24k gold veining.',
    colors: ['#08080b', '#121218', '#fbbf24', '#d97706']
  },
  {
    id: 'sapphire-obsidian',
    name: 'Sapphire & Obsidian',
    reqTier: 'premium',
    tierBadge: 'PREMIUM',
    textureLabel: 'Crystal Obsidian',
    desc: 'Polished volcanic obsidian crystal with royal sapphire veins & smoked glass.',
    colors: ['#050810', '#0e1523', '#38bdf8', '#2563eb']
  },
  {
    id: 'gold-platinum',
    name: 'Gold & Platinum',
    reqTier: 'premium',
    tierBadge: 'PREMIUM',
    textureLabel: 'Platinum Scales',
    desc: 'Sculpted metallic platinum scales background with 24k champagne gold gleam.',
    colors: ['#0a0c11', '#212634', '#e2e8f0', '#f3c969']
  },
  {
    id: 'rose-amethyst',
    name: 'Rose & Amethyst',
    reqTier: 'premium',
    tierBadge: 'PREMIUM',
    textureLabel: 'Amethyst Scales',
    desc: 'Pink & crimson crystal accents over smooth faceted amethyst shards & scales.',
    colors: ['#10050c', '#3b0a26', '#fb7185', '#c026d3']
  }
];

function isThemeUnlocked(themeId, tier) {
  if (themeId === 'default') return true;
  if (themeId === 'gold-obsidian') return tier === 'pro' || tier === 'premium';
  if (themeId === 'sapphire-obsidian' || themeId === 'gold-platinum' || themeId === 'rose-amethyst') return tier === 'premium';
  return false;
}

function getActiveThemeId() {
  if (!currentUser) return 'default';
  const tier = getUserTier(currentUser);
  let saved = 'default';
  try {
    saved = localStorage.getItem('grind_theme_' + currentUser.id) || 'default';
  } catch (e) {}
  if (!isThemeUnlocked(saved, tier)) return 'default';
  return saved;
}

function applyUserTheme() {
  const activeId = getActiveThemeId();
  if (activeId && activeId !== 'default') {
    document.body.dataset.theme = activeId;
  } else {
    delete document.body.dataset.theme;
  }
  if (typeof syncPremiumAmbientMusic === 'function') syncPremiumAmbientMusic();
  if (typeof renderMusicSettings === 'function') renderMusicSettings();
  if (currentPage === 'coin' && selectedCoin && typeof drawChart === 'function') {
    try { drawChart(); } catch (e) {}
  }
}

function renderThemeSettings() {
  const listEl = $('#themeStripsList');
  const subEl = $('#themeSettingsSub');
  if (!listEl || !currentUser) return;

  const tier = getUserTier(currentUser);
  const activeId = getActiveThemeId();

  if (subEl) {
    if (tier === 'premium') {
      subEl.textContent = 'Premium unlocked: switch freely between all 5 themes & textures.';
    } else if (tier === 'pro') {
      subEl.textContent = 'PRO unlocked: Default and Gold & Obsidian are available. Upgrade to Premium for textured Sapphire, Platinum & Rose Amethyst.';
    } else {
      subEl.textContent = 'Member tier uses Default. Unlock Gold & Obsidian with PRO or textured themes with Premium.';
    }
  }

  listEl.innerHTML = GRIND_THEMES.map(theme => {
    const unlocked = isThemeUnlocked(theme.id, tier);
    const isActive = activeId === theme.id;
    const pillClass = theme.reqTier === 'pro' ? 'pro' : theme.reqTier === 'premium' ? 'premium' : '';
    const statusText = isActive
      ? '✓ Active'
      : unlocked
        ? 'Use theme'
        : `🔒 ${theme.tierBadge}`;
    const swatchDots = theme.colors.map(hex => `<span style="background:${hex};"></span>`).join('');

    return `
      <button type="button"
              class="theme-strip ${isActive ? 'active' : ''} ${unlocked ? '' : 'locked'}"
              data-theme-pick="${escapeHtml(theme.id)}"
              aria-pressed="${isActive ? 'true' : 'false'}">
        <div class="theme-strip-banner" data-preview="${escapeHtml(theme.id)}">
          <div class="theme-strip-swatches" aria-hidden="true">${swatchDots}</div>
          <span class="theme-strip-tex-tag">${escapeHtml(theme.textureLabel)}</span>
        </div>
        <div class="theme-strip-body">
          <div class="theme-strip-meta">
            <div class="theme-strip-title">
              <span>${escapeHtml(theme.name)}</span>
              <span class="theme-tier-pill ${pillClass}">${escapeHtml(theme.tierBadge)}</span>
            </div>
            <div class="theme-strip-desc">${escapeHtml(theme.desc)}</div>
          </div>
          <span class="theme-strip-status">${statusText}</span>
        </div>
      </button>
    `;
  }).join('');

  $$('#themeStripsList [data-theme-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pickedId = btn.dataset.themePick;
      const themeObj = GRIND_THEMES.find(t => t.id === pickedId);
      if (!themeObj || !currentUser) return;
      const curTier = getUserTier(currentUser);
      if (!isThemeUnlocked(pickedId, curTier)) {
        const reqLabel = themeObj.reqTier === 'pro' ? 'PRO' : 'Premium';
        toast(`🔒 ${themeObj.name} requires ${reqLabel} tier!`);
        return;
      }
      try {
        localStorage.setItem('grind_theme_' + currentUser.id, pickedId);
      } catch (e) {}
      applyUserTheme();
      renderThemeSettings();
      toast(`Theme changed to ${themeObj.name}`);
    });
  });
}

// ---------- Premium requests ----------
const PREMIUM_REQUEST_STATUS_TTL_MS = 30000;
let premiumRequestStatus = { userId: null, pending: false, checkedAt: 0 };
let premiumRequestStatusPromise = null;
let premiumRequestSending = false;
let premiumRequestPollTimer = null;

async function _checkOwnPremiumRequestPending(uid) {
  const { data: pendingRow, error: pendingError } = await sb
    .from('premium_requests')
    .select('id')
    .eq('user_id', uid)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();
  if (pendingError) throw pendingError;
  if (pendingRow) return true;

  // Older installations may store requests as __PREM_REQ__ markers when
  // the normal pending insert is blocked by Row Level Security.
  const [{ data: legacyRows, error: legacyError }, { data: doneRows, error: doneError }] = await Promise.all([
    sb.from('premium_requests')
      .select('reason')
      .eq('user_id', uid)
      .like('reason', '__PREM_REQ__:%')
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('premium_requests')
      .select('reason')
      .like('reason', '__PREM_REQ_DONE__:%')
      .limit(300)
  ]);
  if (legacyError) throw legacyError;
  if (doneError) throw doneError;

  const doneIds = new Set((doneRows || []).map(row =>
    String(row.reason || '').slice('__PREM_REQ_DONE__:'.length).trim()
  ));
  return (legacyRows || []).some(row => {
    try {
      const parsed = JSON.parse(String(row.reason || '').slice('__PREM_REQ__:'.length));
      return Boolean(parsed?.id) && !doneIds.has(String(parsed.id));
    } catch (e) {
      return false;
    }
  });
}

async function refreshOwnPremiumRequestStatus(force = false) {
  if (!sb || !currentUser?.id) {
    premiumRequestStatus = { userId: null, pending: false, checkedAt: 0 };
    return false;
  }
  const uid = String(currentUser.id);
  if (premiumRequestStatusPromise) return premiumRequestStatusPromise;
  if (!force && premiumRequestStatus.userId === uid &&
      Date.now() - premiumRequestStatus.checkedAt < PREMIUM_REQUEST_STATUS_TTL_MS) {
    return premiumRequestStatus.pending;
  }

  premiumRequestStatusPromise = _checkOwnPremiumRequestPending(uid)
    .then(pending => {
      premiumRequestStatus = { userId: uid, pending, checkedAt: Date.now() };
      return pending;
    })
    .finally(() => { premiumRequestStatusPromise = null; });
  return premiumRequestStatusPromise;
}

function updatePremiumSection(checkStatus = true) {
  if (!currentUser) return;
  const statusEl = $('#premiumStatus');
  const form = $('#requestForm');
  const reasonEl = $('#premiumReason');
  const btn = $('#sendRequestBtn');
  const tier = getUserTier(currentUser);

  if (tier === 'premium') {
    statusEl.textContent = 'You have Premium! Max 3 coins, Blue Star icon, and 2X daily rewards.';
    form.classList.add('hidden');
  } else {
    form.classList.remove('hidden');
    if (premiumRequestStatus.userId === String(currentUser.id) && premiumRequestStatus.pending) {
      statusEl.textContent = 'Your Premium request is waiting for Dompinator to approve or deny it. You can send another request after a decision has been made.';
    } else if (tier === 'pro') {
      statusEl.textContent = 'You have PRO! Max 2 coins, Gold Crown icon, and 2X daily rewards. Request Premium for 3 coins and Blue Star.';
    } else {
      statusEl.textContent = 'Member account: max 1 coin. Unlock PRO on Daily Login Day 7 or request Premium for up to 3.';
    }
  }

  const isPending = tier !== 'premium' &&
    premiumRequestStatus.userId === String(currentUser.id) &&
    premiumRequestStatus.pending;
  if (reasonEl) reasonEl.disabled = isPending || premiumRequestSending;
  if (btn) {
    btn.disabled = isPending || premiumRequestSending || tier === 'premium';
    btn.textContent = premiumRequestSending ? 'Sending...' : (isPending ? 'Request pending' : 'Send request');
  }

  if (premiumRequestPollTimer) {
    clearInterval(premiumRequestPollTimer);
    premiumRequestPollTimer = null;
  }
  if (isPending && currentPage === 'account') {
    premiumRequestPollTimer = setInterval(async () => {
      if (currentPage !== 'account' || !currentUser) {
        clearInterval(premiumRequestPollTimer);
        premiumRequestPollTimer = null;
        return;
      }
      try {
        await refreshOwnPremiumRequestStatus(true);
        updatePremiumSection(false);
      } catch (e) {
        console.warn('Premium request status check note:', e);
      }
    }, 60000);
  }

  if (checkStatus && tier !== 'premium') {
    refreshOwnPremiumRequestStatus(false)
      .then(() => updatePremiumSection(false))
      .catch(e => {
        console.warn('Premium request status check note:', e);
        if (statusEl) statusEl.textContent = 'Could not verify your request status. Please try again in a moment.';
      });
  }
}

$('#sendRequestBtn')?.addEventListener('click', async () => {
  if (!sb || !currentUser) return toast('Please log in first.');
  if (premiumRequestSending) return;
  const reason = ($('#premiumReason')?.value || '').trim();
  if (!reason) return toast('Write a reason.');

  const btn = $('#sendRequestBtn');
  premiumRequestSending = true;
  updatePremiumSection(false);

  try {
    let { data: authData } = await sb.auth.getUser();
    if (!authData?.user) {
      const { data: refData } = await sb.auth.refreshSession();
      authData = { user: refData?.user || refData?.session?.user || null };
    }
    const uid = String(authData?.user?.id || currentUser.id || '');
    if (!uid) {
      toast('Session expired. Please log out and log back in.');
      return;
    }

    let alreadyPending;
    try {
      alreadyPending = await refreshOwnPremiumRequestStatus(true);
    } catch (statusError) {
      toast('Could not check your existing Premium request. Please try again.');
      console.warn('Premium request status check note:', statusError);
      return;
    }
    if (alreadyPending) {
      updatePremiumSection(false);
      toast('You already have a Premium request waiting for Dompinator.');
      return;
    }

    let { error } = await sb.from('premium_requests').insert({
      user_id: uid,
      reason,
      status: 'pending'
    });

    if (error && (error.code === '42501' || /row-level security/i.test(error.message || ''))) {
      const reqPayload = {
        id: 'preq_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        reason,
        ts: Date.now()
      };
      const fbRes = await sb.from('premium_requests').insert({
        user_id: uid,
        reason: '__PREM_REQ__:' + JSON.stringify(reqPayload),
        status: 'denied'
      });
      error = fbRes.error;
    }

    if (error) {
      toast(error.message);
      return;
    }

    premiumRequestStatus = { userId: uid, pending: true, checkedAt: Date.now() };
    toast('Request sent to Dompinator! You can send another after it is approved or denied.');
    if ($('#premiumReason')) $('#premiumReason').value = '';
    updatePremiumSection(false);
    if (isDompinator()) updateNotificationsBadge();
  } finally {
    premiumRequestSending = false;
    updatePremiumSection(false);
  }
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
    .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, creator_id), profiles(id, username, is_premium)')
    .order('created_at', { ascending: false })
    .limit(60);
  let coinsQ = sb
    .from('coins')
    .select('id, name, ticker, price, creator_id, created_at, profiles!coins_creator_id_fkey(id, username, is_premium)')
    .order('created_at', { ascending: false })
    .limit(40);
  let myTradesQ = currentUser
    ? sb.from('trades')
        .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, creator_id), profiles(id, username, is_premium)')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(60)
    : Promise.resolve({ data: [] });
  const myCoinIds = coins.filter(c => currentUser && c.creator_id === currentUser.id).map(c => c.id);
  let myCoinTradesQ = (currentUser && myCoinIds.length)
    ? sb.from('trades')
        .select('id, coin_id, user_id, type, amount_usd, price_after, created_at, coins(id, name, ticker, price, creator_id), profiles(id, username, is_premium)')
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

  let lpQ = sb.from('premium_requests')
    .select('id, user_id, reason, created_at, profiles(id, username, is_premium)')
    .like('reason', '__LIVE_POST__:%')
    .order('created_at', { ascending: false })
    .limit(40);
  if (srvResetTs > 0) {
    lpQ = lpQ.gt('created_at', new Date(srvResetTs).toISOString());
  }

  const safeQuery = async q => {
    try { return (await q) || { data: [] }; } catch (e) { return { data: [] }; }
  };

  let [tRes, cRes, mtRes, mctRes, lpRes] = await Promise.all([
    tradesQ,
    coinsQ,
    myTradesQ,
    myCoinTradesQ,
    safeQuery(lpQ),
    typeof loadPlayData === 'function' ? loadPlayData(false) : Promise.resolve()
  ]);

  if (tRes.error) {
    let fallbackT = sb.from('trades').select('id, coin_id, user_id, type, amount_usd, price_after, created_at').order('created_at', { ascending: false }).limit(60);
    if (srvResetTs > 0) fallbackT = fallbackT.gt('created_at', new Date(srvResetTs).toISOString());
    tRes = await fallbackT;
  }
  if (cRes.error) {
    let fallbackC = sb.from('coins').select('id, name, ticker, price, creator_id, created_at').order('created_at', { ascending: false }).limit(40);
    if (srvResetTs > 0) fallbackC = fallbackC.gt('created_at', new Date(srvResetTs).toISOString());
    cRes = await fallbackC;
  }
  if (lpRes.error) {
    let fbLp = sb.from('premium_requests')
      .select('id, user_id, reason, created_at')
      .like('reason', '__LIVE_POST__:%')
      .order('created_at', { ascending: false })
      .limit(40);
    if (srvResetTs > 0) fbLp = fbLp.gt('created_at', new Date(srvResetTs).toISOString());
    lpRes = await safeQuery(fbLp);
  }

  // Hydrate missing profile avatars and missing coin logos via shared caches
  const liveUserIds = [];
  [tRes?.data, mtRes?.data, mctRes?.data, lpRes?.data].forEach(arr => {
    (arr || []).forEach(r => { if (r?.user_id) liveUserIds.push(r.user_id); });
  });
  (cRes?.data || []).forEach(c => { if (c?.creator_id) liveUserIds.push(c.creator_id); });
  (playState.donations || []).forEach(d => {
    if (d.fromUserId) liveUserIds.push(d.fromUserId);
    if (d.toUserId) liveUserIds.push(d.toUserId);
  });

  const missingCoinImgIds = (cRes?.data || [])
    .map(c => c?.id)
    .filter(cid => cid && !sharedCoinImagesCache.has(String(cid)));

  await Promise.all([
    ensureProfilesCached(liveUserIds),
    missingCoinImgIds.length
      ? sb.from('coins').select('id, image_url').in('id', missingCoinImgIds).then(({ data }) => {
          (data || []).forEach(r => saveSharedCoinImageToCache(r.id, r.image_url));
        }).catch(() => {})
      : Promise.resolve()
  ]);

  const coinMap = new Map();
  coins.forEach(c => coinMap.set(String(c.id), c));
  (cRes?.data || []).forEach(c => {
    if (!c?.id) return;
    const cid = String(c.id);
    if (!coinMap.has(cid)) {
      coinMap.set(cid, {
        ...c,
        image_url: sharedCoinImagesCache.get(cid) ?? c.image_url ?? null
      });
    }
  });

  const seenKeys = new Set();
  const events = [];
  const pushTradeEvent = (t) => {
    const tidKey = 'trade_' + (t.id || `${t.coin_id}_${t.user_id}_${t.created_at}`);
    if (seenKeys.has(tidKey)) return;
    const cid = String(t.coin_id || '');
    const uid = String(t.user_id || '');
    if (!cid || delCoins.has(cid) || (uid && delUsers.has(uid))) return;
    const rawCoin = coinMap.get(cid) || t.coins;
    if (!rawCoin) return;
    const cObj = {
      ...rawCoin,
      image_url: rawCoin.image_url !== undefined ? rawCoin.image_url : (sharedCoinImagesCache.get(cid) ?? null)
    };
    const pObj = getCachedProfile(uid, t.profiles);
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
    const hydratedCoin = coinMap.get(cid) || { ...c, image_url: sharedCoinImagesCache.get(cid) ?? null };
    const pObj = getCachedProfile(uid, c.profiles);
    const ts = c.created_at ? new Date(c.created_at).getTime() : Date.now();
    if (srvResetTs && ts <= srvResetTs) return;
    const isSelf = currentUser && uid === String(currentUser.id);
    events.push({
      kind: 'coin',
      ts,
      userId: uid,
      profile: pObj,
      coin: hydratedCoin,
      price: Number(c.price || 1),
      isPersonal: Boolean(isSelf),
      isSelf: Boolean(isSelf),
      isMyCoin: Boolean(isSelf)
    });
  });

  const postRows = lpRes?.data || [];
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
        image_url: parsed.coin_image || sharedCoinImagesCache.get(cid) || null,
        price: 1
      };
      const pObj = getCachedProfile(uid, r.profiles);
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

  // Reuse already-synced & incrementally cached Play Videos & Donations (no duplicate 1,200-row scan!)
  (playState.videos || []).forEach(v => {
    if (!v?.id || delUsers.has(String(v.user_id))) return;
    if (srvResetTs > 0 && Number(v.ts || 0) <= srvResetTs) return;
    const vKey = 'playvid_' + String(v.id);
    if (seenKeys.has(vKey)) return;
    seenKeys.add(vKey);
    const isSelf = currentUser && String(v.user_id) === String(currentUser.id);
    events.push({
      kind: 'play_video',
      ts: Number(v.ts || 0),
      userId: String(v.user_id),
      profile: getCachedProfile(v.user_id, v.profile),
      video: {
        id: String(v.id),
        user_id: String(v.user_id),
        kind: v.kind === 'video' ? 'video' : 'scene',
        title: v.title || (v.kind === 'video' ? 'Uploaded Video' : 'Play Short'),
        ts: Number(v.ts || 0)
      },
      isPersonal: Boolean(isSelf),
      isSelf: Boolean(isSelf)
    });
  });

  (playState.donations || []).forEach(d => {
    if (!d?.id || delUsers.has(String(d.fromUserId)) || delUsers.has(String(d.toUserId))) return;
    if (srvResetTs > 0 && Number(d.ts || 0) <= srvResetTs) return;
    const dKey = 'playdon_' + String(d.id);
    if (seenKeys.has(dKey)) return;
    seenKeys.add(dKey);
    const isSelf = currentUser && (String(d.fromUserId) === String(currentUser.id) || String(d.toUserId) === String(currentUser.id));
    events.push({
      kind: 'play_donate',
      ts: Number(d.ts || 0),
      userId: String(d.fromUserId),
      profile: getCachedProfile(d.fromUserId, d.fromProfile),
      donate: {
        ...d,
        fromProfile: getCachedProfile(d.fromUserId, d.fromProfile),
        toProfile: getCachedProfile(d.toUserId, { id: d.toUserId, username: d.toUsername || 'Creator' })
      },
      isPersonal: Boolean(isSelf),
      isSelf: Boolean(isSelf)
    });
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
    if (liveMode === 'videos') return ev.kind === 'play_video';
    return true;
  });

  emptyEl.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 90).map(ev => {
    const uname = ev.profile?.username || 'Trader';
    const av = ev.profile?.avatar_url
      ? `<img src="${escapeHtml(ev.profile.avatar_url)}" alt="">`
      : escapeHtml(uname[0].toUpperCase());
    const profObj = { id: ev.userId, ...ev.profile };

    if (ev.kind === 'play_video') {
      const v = ev.video;
      const sum = getPlayVoteSummary(v.id);
      const personalTag = liveMode === 'personal' && ev.isSelf ? `<span class="live-personal-tag">YOU</span>` : '';
      return `
        <div class="live-row live-video-highlight">
          <div class="live-row-left">
            <div class="avatar profile-link" data-profile="${escapeHtml(ev.userId)}" style="cursor:pointer;">${av}</div>
            <div class="live-row-main">
              <div class="live-row-line">
                <span class="live-badge playvid">${v.kind === 'video' ? 'VIDEO' : 'SHORT'}</span>
                ${personalTag}
                <span class="live-user-donate-wrap">
                  <strong class="profile-link" data-profile="${escapeHtml(ev.userId)}">${escapeHtml(uname)}${tierBadgeHtml(profObj)}</strong>
                  <button type="button" class="play-donate-plus-btn live-donate-plus" data-live-donate="${escapeHtml(v.id)}" data-donate-user="${escapeHtml(ev.userId)}" title="Donate to ${escapeHtml(uname)}" aria-label="Donate to ${escapeHtml(uname)}">＋</button>
                </span>
                <span class="muted">posted <button type="button" class="live-video-chip" data-live-play-vid="${escapeHtml(v.id)}">▶ ${escapeHtml(v.title)}</button></span>
              </div>
              <div class="muted tiny" style="margin-top:3px;">♥ ${sum.likes} likes · 💬 ${sum.commentsCount} comments</div>
            </div>
          </div>
          <div class="live-row-right">
            <button type="button" class="zoom-btn live-watch-btn" data-live-play-vid="${escapeHtml(v.id)}">▶ Watch</button>
            <span class="muted tiny" title="${escapeHtml(new Date(ev.ts).toLocaleString())}">${escapeHtml(formatLiveTime(ev.ts))}</span>
          </div>
        </div>
      `;
    }

    if (ev.kind === 'play_donate') {
      const d = ev.donate;
      const toName = d.toProfile?.username || d.toUsername || 'Creator';
      const personalTag = liveMode === 'personal' && ev.isSelf ? `<span class="live-personal-tag">YOU</span>` : '';
      return `
        <div class="live-row live-donate-highlight">
          <div class="live-row-left">
            <div class="avatar profile-link" data-profile="${escapeHtml(ev.userId)}" style="cursor:pointer;">${av}</div>
            <div class="live-row-main">
              <div class="live-row-line">
                <span class="live-badge donate">DONATION</span>
                ${personalTag}
                <strong class="profile-link" data-profile="${escapeHtml(ev.userId)}">${escapeHtml(uname)}${tierBadgeHtml(profObj)}</strong>
                <span class="muted">donated <strong style="color:#facc15;">${money(d.amount)}</strong> to</span>
                <span class="live-user-donate-wrap">
                  <strong class="profile-link" data-profile="${escapeHtml(d.toUserId)}">${escapeHtml(toName)}${tierBadgeHtml(d.toProfile)}</strong>
                  <button type="button" class="play-donate-plus-btn live-donate-plus" data-live-donate="${escapeHtml(d.videoId)}" data-donate-user="${escapeHtml(d.toUserId)}" title="Donate to ${escapeHtml(toName)}" aria-label="Donate to ${escapeHtml(toName)}">＋</button>
                </span>
                ${d.videoId ? `<button type="button" class="live-video-chip" data-live-play-vid="${escapeHtml(d.videoId)}">▶ ${escapeHtml(d.videoTitle || 'Video')}</button>` : ''}
              </div>
              ${d.note ? `<div class="live-post-msg">“${escapeHtml(d.note)}”</div>` : ''}
            </div>
          </div>
          <div class="live-row-right">
            <span class="live-row-price" style="color:#facc15;">+${money(d.amount)}</span>
            <span class="muted tiny" title="${escapeHtml(new Date(ev.ts).toLocaleString())}">${escapeHtml(formatLiveTime(ev.ts))}</span>
          </div>
        </div>
      `;
    }

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
  listEl.querySelectorAll('[data-live-donate]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPlayDonateModal(btn.dataset.liveDonate, btn.dataset.donateUser);
    });
  });
  listEl.querySelectorAll('[data-live-play-vid]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.livePlayVid) openPlayAtVideo(el.dataset.livePlayVid);
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
let notificationPollInterval = null;
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

async function _fetchUserNotificationsFresh() {
  if (!sb || !currentUser) return [];
  const uid = String(currentUser.id);
  await fetchAdminModerationState();
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const delCoins = adminModStateCache.deletedCoinIds || new Set();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  // Never query __PLAY_VID__ or data:video/ blobs in notifications; read video titles from cached playState!
  const [updatesList, coinsRes, cmtRes, playRes] = await Promise.all([
    fetchActiveUpdates(),
    sb.from('coins').select('id, name, ticker, creator_id, created_at').limit(500),
    sb.from('premium_requests')
      .select('user_id, reason, created_at, profiles(id, username, is_premium)')
      .like('reason', '__CMT_%')
      .order('created_at', { ascending: true })
      .limit(1000),
    sb.from('premium_requests')
      .select('user_id, reason, created_at, profiles(id, username, is_premium)')
      .or('reason.like.__PLAY_VOTE__:%,reason.like.__PLAY_CMT__:%,reason.like.__PLAY_CMT_DEL__:%,reason.like.__PLAY_FOLLOW__:%,reason.like.__PLAY_DONATE__:%,reason.like.__PLAY_DEL__:%')
      .order('created_at', { ascending: true })
      .limit(2000),
    typeof loadPlayData === 'function' ? loadPlayData(false) : Promise.resolve(),
    typeof loadTraderBattles === 'function' ? loadTraderBattles(false) : Promise.resolve()
  ]);

  const notifUids = [];
  (cmtRes?.data || []).forEach(r => { if (r?.user_id) notifUids.push(r.user_id); });
  (playRes?.data || []).forEach(r => { if (r?.user_id) notifUids.push(r.user_id); });
  await ensureProfilesCached(notifUids);

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
        const hasGif = Boolean(sanitizeGifUrl(p?.gif_url));
        const cleanText = String(p?.text || '').trim();
        if (!p || !p.id || !p.coin_id || (!cleanText && !hasGif)) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        allComments.set(String(p.id), {
          id: String(p.id),
          coinId: String(p.coin_id),
          userId: String(r.user_id),
          parentId: p.parent_id ? String(p.parent_id) : null,
          replyToUserId: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
          text: cleanText || (hasGif ? 'Sent a GIF' : ''),
          ts,
          profile: getCachedProfile(r.user_id, r.profiles)
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

  // 5. Play Video Likes, Followers, Video Comments, and Creator Donations
  const playVideosMap = new Map();
  (playState.videos || []).forEach(v => {
    playVideosMap.set(String(v.id), {
      id: String(v.id),
      userId: String(v.user_id),
      title: String(v.title || '').slice(0, 80) || (v.kind === 'video' ? 'Uploaded Video' : 'Play Short'),
      ts: Number(v.ts || 0)
    });
  });
  const deletedPlayVidIds = new Set(playState.deletedIds || []);
  const playVotes = [];
  const playCmts = [];
  const deletedPlayCmtIds = new Set();
  const playDonates = [];
  const playFollowsByFollower = new Map();

  (playRes?.data || []).forEach(r => {
    const reason = String(r.reason || '');
    const rowTs = r.created_at ? new Date(r.created_at).getTime() : 0;
    const rowUid = String(r.user_id || '');
    if (!rowUid) return;

    if (reason.startsWith('__PLAY_DEL__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_DEL__:'.length));
        if (p?.videoId) deletedPlayVidIds.add(String(p.videoId));
      } catch (e) {}
    } else if (reason.startsWith('__PLAY_VOTE__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_VOTE__:'.length));
        if (!p?.videoId) return;
        playVotes.push({
          videoId: String(p.videoId),
          userId: rowUid,
          vote: p.vote === 'like' || p.vote === 'dislike' ? p.vote : 'none',
          ts: Number(p.ts) || rowTs,
          profile: getCachedProfile(rowUid, r.profiles)
        });
      } catch (e) {}
    } else if (reason.startsWith('__PLAY_FOLLOW__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_FOLLOW__:'.length));
        if (String(p?.targetUserId || '') !== uid || rowUid === uid) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        playFollowsByFollower.set(rowUid, {
          followerId: rowUid,
          following: Boolean(p.following),
          ts,
          profile: getCachedProfile(rowUid, r.profiles)
        });
      } catch (e) {}
    } else if (reason.startsWith('__PLAY_CMT__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_CMT__:'.length));
        const cleanGif = typeof sanitizeGifUrl === 'function' ? sanitizeGifUrl(p?.gif_url) : '';
        const cleanText = String(p?.text || '').trim();
        if (!p?.id || !p?.videoId || (!cleanText && !cleanGif)) return;
        playCmts.push({
          id: String(p.id),
          videoId: String(p.videoId),
          userId: rowUid,
          parentId: p.parent_id ? String(p.parent_id) : null,
          replyToUserId: p.reply_to_user_id ? String(p.reply_to_user_id) : null,
          text: cleanText,
          gifUrl: cleanGif,
          ts: Number(p.ts) || rowTs,
          profile: getCachedProfile(rowUid, r.profiles)
        });
      } catch (e) {}
    } else if (reason.startsWith('__PLAY_CMT_DEL__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_CMT_DEL__:'.length));
        if (p?.commentId) deletedPlayCmtIds.add(String(p.commentId));
      } catch (e) {}
    } else if (reason.startsWith('__PLAY_DONATE__:')) {
      try {
        const p = JSON.parse(reason.slice('__PLAY_DONATE__:'.length));
        const amt = Number(p?.amount || 0);
        if (!p?.id || !p?.toUserId || !Number.isFinite(amt) || amt <= 0) return;
        const ts = Number(p.ts) || rowTs;
        if (srvResetTs > 0 && ts <= srvResetTs) return;
        playDonates.push({
          id: String(p.id),
          fromUserId: rowUid,
          toUserId: String(p.toUserId),
          videoId: p.videoId ? String(p.videoId) : '',
          videoTitle: String(p.videoTitle || 'Play Video').slice(0, 80),
          amount: Math.round(amt * 100) / 100,
          note: String(p.note || '').slice(0, 120),
          ts,
          profile: getCachedProfile(rowUid, r.profiles)
        });
      } catch (e) {}
    }
  });

  // Keep latest vote per (videoId, voterId) so un-liking removes the notification
  const latestVoteByPair = new Map();
  playVotes.forEach(pv => {
    latestVoteByPair.set(`${pv.videoId}__${pv.userId}`, pv);
  });
  latestVoteByPair.forEach(pv => {
    if (pv.vote !== 'like' || pv.userId === uid || delUsers.has(pv.userId)) return;
    if (deletedPlayVidIds.has(pv.videoId)) return;
    const vid = playVideosMap.get(pv.videoId);
    if (!vid || vid.userId !== uid) return;
    if (srvResetTs > 0 && pv.ts <= srvResetTs) return;
    items.push({
      id: 'plike_' + pv.videoId + '_' + pv.userId,
      category: 'play_like',
      ts: pv.ts,
      videoId: pv.videoId,
      videoTitle: vid.title,
      authorId: pv.userId,
      authorProfile: { id: pv.userId, ...pv.profile },
      authorName: pv.profile?.username || 'Trader'
    });
  });

  playFollowsByFollower.forEach(pf => {
    if (!pf.following || delUsers.has(pf.followerId)) return;
    items.push({
      id: 'pfol_' + pf.followerId,
      category: 'play_follow',
      ts: pf.ts,
      authorId: pf.followerId,
      authorProfile: { id: pf.followerId, ...pf.profile },
      authorName: pf.profile?.username || 'Trader'
    });
  });

  const playCmtsById = new Map();
  playCmts.forEach(pc => playCmtsById.set(pc.id, pc));

  playCmts.forEach(pc => {
    if (deletedPlayCmtIds.has(pc.id) || deletedPlayVidIds.has(pc.videoId) || delUsers.has(pc.userId)) return;
    if (pc.userId === uid) return;
    const vid = playVideosMap.get(pc.videoId);
    if (!vid) return;
    if (srvResetTs > 0 && pc.ts <= srvResetTs) return;
    const parentPc = pc.parentId ? playCmtsById.get(pc.parentId) : null;
    if (pc.parentId && (!parentPc || deletedPlayCmtIds.has(parentPc.id))) return;

    const isReplyToMe = Boolean(
      pc.parentId && (parentPc?.userId === uid || pc.replyToUserId === uid)
    );
    const isCommentOnMyVid = vid.userId === uid;

    if (isReplyToMe) {
      items.push({
        id: 'prep_' + pc.id,
        category: 'play_reply',
        ts: pc.ts,
        videoId: pc.videoId,
        videoTitle: vid.title,
        authorId: pc.userId,
        authorProfile: { id: pc.userId, ...pc.profile },
        authorName: pc.profile?.username || 'Trader',
        body: pc.text || 'Sent a GIF',
        gifUrl: pc.gifUrl
      });
    } else if (isCommentOnMyVid && !pc.parentId) {
      items.push({
        id: 'pcmt_' + pc.id,
        category: 'play_comment',
        ts: pc.ts,
        videoId: pc.videoId,
        videoTitle: vid.title,
        authorId: pc.userId,
        authorProfile: { id: pc.userId, ...pc.profile },
        authorName: pc.profile?.username || 'Trader',
        body: pc.text || 'Sent a GIF',
        gifUrl: pc.gifUrl
      });
    }
  });

  playDonates.forEach(pd => {
    if (pd.toUserId !== uid || pd.fromUserId === uid || delUsers.has(pd.fromUserId)) return;
    items.push({
      id: 'pdon_' + pd.id,
      category: 'play_donate',
      ts: pd.ts,
      videoId: pd.videoId,
      videoTitle: pd.videoTitle,
      amount: pd.amount,
      note: pd.note,
      authorId: pd.fromUserId,
      authorProfile: { id: pd.fromUserId, ...pd.profile },
      authorName: pd.profile?.username || 'Trader'
    });
  });

  // 6. Trader Battles (Incoming challenges + Finished battle results)
  if (typeof getTraderBattleNotifications === 'function') {
    const tbItems = getTraderBattleNotifications(uid, delUsers);
    tbItems.forEach(item => items.push(item));
  }

  items.sort((a, b) => b.ts - a.ts);
  return items;
}

let userNotificationsFetchedAt = 0;
let userNotificationsPromise = null;
const NOTIFICATION_SCAN_TTL_MS = 180000;

async function fetchUserNotifications(force = false) {
  if (!sb || !currentUser) return [];
  if (userNotificationsPromise) return userNotificationsPromise;
  if (!force && userNotificationsFetchedAt && Date.now() - userNotificationsFetchedAt < NOTIFICATION_SCAN_TTL_MS) {
    return userNotifsCache;
  }
  userNotificationsPromise = _fetchUserNotificationsFresh()
    .then(items => {
      userNotifsCache = items || [];
      userNotificationsFetchedAt = Date.now();
      return userNotifsCache;
    })
    .finally(() => { userNotificationsPromise = null; });
  return userNotificationsPromise;
}

async function _fetchReportsAndPendingFresh() {
  if (!sb || !isDompinator()) return { reports: [], pendingRequests: [] };
  await fetchAdminModerationState();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  const [{ data: pendingRaw }, { data: structuredPremRaw }, { data: structuredPremDoneRaw }, { data: reportRaw }, { data: doneRaw }] = await Promise.all([
    sb.from('premium_requests')
      .select('*, profiles(username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    sb.from('premium_requests')
      .select('id, user_id, reason, created_at, profiles(username)')
      .like('reason', '__PREM_REQ__:%')
      .order('created_at', { ascending: false })
      .limit(100),
    sb.from('premium_requests')
      .select('reason, profiles(username)')
      .like('reason', '__PREM_REQ_DONE__:%')
      .limit(300),
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

  const donePremIds = new Set();
  (structuredPremDoneRaw || []).forEach(r => {
    if ((r.profiles?.username || '').toLowerCase() !== 'dompinator') return;
    const pid = String(r.reason || '').slice('__PREM_REQ_DONE__:'.length).trim();
    if (pid) donePremIds.add(pid);
  });

  const pendingRequests = (pendingRaw || []).filter(r =>
    !String(r.reason || '').startsWith('__') && !delUsers.has(String(r.user_id))
  );
  (structuredPremRaw || []).forEach(r => {
    if (delUsers.has(String(r.user_id))) return;
    try {
      const parsed = JSON.parse(String(r.reason || '').slice('__PREM_REQ__:'.length));
      if (!parsed || !parsed.id || donePremIds.has(String(parsed.id))) return;
      pendingRequests.push({
        id: 'preq:' + String(parsed.id),
        user_id: r.user_id,
        reason: String(parsed.reason || ''),
        created_at: r.created_at,
        profiles: r.profiles
      });
    } catch (e) {}
  });
  pendingRequests.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());

  const reports = [];
  (reportRaw || []).forEach(r => {
    try {
      const parsed = JSON.parse(String(r.reason || '').slice('__REPORT__:'.length));
      if (!parsed || !parsed.id || doneIds.has(String(parsed.id))) return;
      reports.push({
        rowId: r.id,
        id: String(parsed.id),
        type: parsed.type === 'bug' ? 'bug' : 'player',
        source: parsed.source || null,
        category: parsed.category || null,
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

let adminNotificationsFetchedAt = 0;
let adminNotificationsPromise = null;
async function fetchReportsAndPending(force = false) {
  if (!sb || !isDompinator()) return { reports: [], pendingRequests: [] };
  if (adminNotificationsPromise) return adminNotificationsPromise;
  if (!force && adminNotificationsFetchedAt && Date.now() - adminNotificationsFetchedAt < NOTIFICATION_SCAN_TTL_MS) {
    return adminNotificationsCache;
  }
  adminNotificationsPromise = _fetchReportsAndPendingFresh()
    .then(result => {
      adminNotificationsCache = result;
      adminNotificationsFetchedAt = Date.now();
      return result;
    })
    .finally(() => { adminNotificationsPromise = null; });
  return adminNotificationsPromise;
}
let adminNotificationsCache = { reports: [], pendingRequests: [] };

async function updateNotificationsBadge() {
  if (!sb || !currentUser) return;
  try {
    const seenTs = getUserNotifSeenTs();
    const userItems = await fetchUserNotifications(false);
    const unreadUserCount = userItems.filter(it => Number(it.ts || 0) > seenTs).length;
    if (isDompinator()) {
      const { reports, pendingRequests } = await fetchReportsAndPending(false);
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
    if (userNotifFilter === 'social') {
      return it.category === 'comment' || it.category === 'reply' || it.category === 'play_like' || it.category === 'play_comment' || it.category === 'play_reply' || it.category === 'play_follow';
    }
    if (userNotifFilter === 'donate') return it.category === 'play_donate';
    if (userNotifFilter === 'battle') return it.category === 'tb_challenge' || it.category === 'tb_result';
    return true;
  });

  emptyEl.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    listEl.innerHTML = '';
    return;
  }

  listEl.innerHTML = filtered.slice(0, 90).map(it => {
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
    } else if (it.category === 'play_donate') {
      tagCls = 'donate';
      tagText = 'Donation';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">donated <strong style="color:#facc15;">${money(it.amount)}</strong> on your video</span> <strong>“${escapeHtml(it.videoTitle || 'Play Video')}”</strong>`;
      bodyHtml = it.note ? `<div class="report-details-box">“${escapeHtml(it.note)}”</div>` : '';
      if (it.videoId) {
        actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-play-vid="${escapeHtml(it.videoId)}">▶ Open Video</button></div>`;
      }
    } else if (it.category === 'play_follow') {
      tagCls = 'follow';
      tagText = 'New Follower';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">started following you</span> <span style="color:var(--green);font-weight:800;">(+${money(PLAY_FOLLOW_PAYOUT)})</span>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-profile="${escapeHtml(it.authorId)}">View Profile</button></div>`;
    } else if (it.category === 'play_like') {
      tagCls = 'play-like';
      tagText = 'Video Like';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">liked your video</span> <strong>“${escapeHtml(it.videoTitle || 'Play Video')}”</strong> <span style="color:var(--green);font-weight:800;">(+${money(PLAY_LIKE_PAYOUT)})</span>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-play-vid="${escapeHtml(it.videoId)}">▶ Watch Video</button></div>`;
    } else if (it.category === 'play_reply') {
      tagCls = 'reply';
      tagText = 'Play Reply';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">replied to your comment on</span> <strong>“${escapeHtml(it.videoTitle || 'Play Video')}”</strong>`;
      bodyHtml = `
        <div class="report-details-box">
          ${escapeHtml(it.body || '').replace(/\n/g, '<br>')}
          ${it.gifUrl ? `<div class="comment-gif-wrap" style="margin-top:6px;"><img src="${escapeHtml(it.gifUrl)}" alt="GIF" loading="lazy"></div>` : ''}
        </div>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-play-cmt="${escapeHtml(it.videoId)}">💬 View Reply</button></div>`;
    } else if (it.category === 'play_comment') {
      tagCls = 'play-comment';
      tagText = 'Video Comment';
      headHtml = `<strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong> <span class="muted">commented on your video</span> <strong>“${escapeHtml(it.videoTitle || 'Play Video')}”</strong>`;
      bodyHtml = `
        <div class="report-details-box">
          ${escapeHtml(it.body || '').replace(/\n/g, '<br>')}
          ${it.gifUrl ? `<div class="comment-gif-wrap" style="margin-top:6px;"><img src="${escapeHtml(it.gifUrl)}" alt="GIF" loading="lazy"></div>` : ''}
        </div>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-notif-play-cmt="${escapeHtml(it.videoId)}">💬 View Comment</button></div>`;
    } else if (it.category === 'tb_challenge') {
      tagCls = 'battle';
      tagText = 'Trader Battle Request';
      headHtml = `<span class="muted">Trader Battle Request From -</span> <strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}${tierBadgeHtml(it.authorProfile)}</strong>`;
      bodyHtml = `<div class="report-details-box">Length: <strong>${escapeHtml(it.durationLabel)}</strong> · Prize: <strong style="color:#fde68a;">${escapeHtml(it.stakeLabel || money(it.stake))}</strong></div>`;
      actionHtml = it.isPending
        ? `<div class="request-actions">
            <button type="button" class="primary-btn" data-tb-accept="${escapeHtml(it.battleId)}" style="padding:6px 14px;font-size:12px;">⚔️ Yes</button>
            <button type="button" class="deny-btn" data-tb-decline="${escapeHtml(it.battleId)}" style="padding:6px 14px;font-size:12px;">No</button>
           </div>`
        : `<div class="muted tiny">${escapeHtml(it.statusNote || 'Handled')}</div>`;
    } else if (it.category === 'tb_result') {
      tagCls = 'battle';
      tagText = it.didWin ? 'Battle Won' : (it.isDraw ? 'Battle Draw' : 'Battle Lost');
      const titleWord = it.didWin ? 'You won the battle!' : (it.isDraw ? 'Battle ended in a draw!' : 'You lost the battle!');
      headHtml = `<strong style="color:${it.didWin ? 'var(--green)' : (it.isDraw ? '#e2e8f0' : '#fca5a5')};">${titleWord}</strong> <span class="muted">vs</span> <strong class="profile-link" data-profile="${escapeHtml(it.authorId)}">${escapeHtml(it.authorName)}</strong>`;
      bodyHtml = `<div class="report-details-box">${escapeHtml(it.summaryLine)}</div>`;
      actionHtml = `<div class="request-actions"><button type="button" class="zoom-btn" data-tb-view-result="${escapeHtml(it.battleId)}">View Breakdown</button></div>`;
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
  listEl.querySelectorAll('[data-notif-play-vid]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.notifPlayVid) openPlayAtVideo(el.dataset.notifPlayVid, false);
    });
  });
  listEl.querySelectorAll('[data-notif-play-cmt]').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.notifPlayCmt) openPlayAtVideo(el.dataset.notifPlayCmt, true);
    });
  });
  listEl.querySelectorAll('[data-tb-accept]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (typeof acceptTraderBattle === 'function') await acceptTraderBattle(btn.dataset.tbAccept);
    });
  });
  listEl.querySelectorAll('[data-tb-decline]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (typeof declineTraderBattle === 'function') await declineTraderBattle(btn.dataset.tbDecline);
    });
  });
  listEl.querySelectorAll('[data-tb-view-result]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof openTraderBattleResultById === 'function') openTraderBattleResultById(btn.dataset.tbViewResult);
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
    const isBotAuto = r.source === 'grind_bot_auto';
    const subjectLine = isBotAuto
      ? `Auto-flagged account: <strong${r.targetId ? ` class="profile-link" data-profile="${escapeHtml(r.targetId)}"` : ''}>${escapeHtml(r.targetName || r.reporterName || 'Unknown')}</strong> · <span style="color:#fca5a5;">${escapeHtml(r.category || 'Violation')}</span>`
      : (isPlayer
          ? `Reported player: <strong${r.targetId ? ` class="profile-link" data-profile="${escapeHtml(r.targetId)}"` : ''}>${escapeHtml(r.targetName || 'Unknown')}</strong>`
          : `Bug / Exploit: <strong>${escapeHtml(r.title || 'Bug Report')}</strong>`);
    return `
      <div class="report-card"${isBotAuto ? ' style="border-color:rgba(248,113,113,.55);background:linear-gradient(135deg,rgba(248,113,113,.08) 0%,var(--panel) 75%);"' : ''}>
        <div class="report-card-head">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="report-tag ${isPlayer ? 'player' : 'bug'}">${isPlayer ? 'Player Report' : 'Bug / Exploit'}</span>
            ${isBotAuto ? `<span class="report-tag" style="background:rgba(248,113,113,.2);color:#fca5a5;border:1px solid rgba(248,113,113,.55);">⌘ GRIND-BOT AUTO</span>` : ''}
            <span class="muted tiny">from <strong class="profile-link" data-profile="${escapeHtml(r.reporterId)}">${escapeHtml(isBotAuto ? 'GRIND-BOT (' + r.reporterName + ')' : r.reporterName)}${tierBadgeHtml(r.reporterProfile)}</strong></span>
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
    if (sub) sub.textContent = 'Updates, warnings, coin & video likes, comments, replies, donations, reports, and premium requests.';
  } else {
    adminWrap?.classList.add('hidden');
    if (eyebrow) eyebrow.textContent = 'INBOX';
    if (sub) sub.textContent = 'Updates, warnings, coin & video likes, comments, replies, and donations.';
  }

  userNotifsCache = await fetchUserNotifications(true);
  renderUserNotifsList();

  if (isDompinator()) {
    const { reports, pendingRequests } = await fetchReportsAndPending(true);
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
  if (String(reqId).startsWith('preq:')) {
    const reqKey = String(reqId).slice('preq:'.length);
    const { error: dErr } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__PREM_REQ_DONE__:' + reqKey,
      status: 'denied'
    });
    if (dErr) {
      toast('Request update error: ' + dErr.message);
      return;
    }
  } else {
    const { error: rErr } = await sb.from('premium_requests').update({ status }).eq('id', reqId);
    if (rErr) {
      toast('Request update error: ' + rErr.message);
      return;
    }
  }
  if (status === 'approved' && userId) {
    await sendAdminCommand('grant_premium', userId, 'Approved Premium');
    const { error: pErr } = await sb.from('profiles').update({ is_premium: true }).eq('id', userId);
    if (pErr) console.warn('Note: profiles update blocked by RLS until admin policy is added:', pErr);
  }
  toast(status === 'approved' ? 'Approved Premium!' : 'Denied request');
  loadRequests();
}

// ---------- Real-Time Notification Popups ----------
const shownRealtimePopupKeys = new Set();

function showLiveNotifPopup({ key, kind = 'donate', icon = '🔔', title = '', body = '', onClick = null }) {
  const stack = $('#liveNotifPopups');
  if (!stack) return;
  if (key && shownRealtimePopupKeys.has(key)) return;
  if (key) shownRealtimePopupKeys.add(key);

  const card = document.createElement('div');
  card.className = `live-notif-popup is-${kind}`;
  card.innerHTML = `
    <div class="live-notif-popup-icon">${escapeHtml(icon)}</div>
    <div class="live-notif-popup-body">
      <div class="live-notif-popup-title">${escapeHtml(title)}</div>
      <div class="live-notif-popup-text">${escapeHtml(body)}</div>
    </div>
    <button type="button" class="live-notif-popup-close" aria-label="Dismiss">✕</button>
  `;
  const removeCard = () => {
    card.classList.add('is-leaving');
    setTimeout(() => card.remove(), 220);
  };
  card.querySelector('.live-notif-popup-close')?.addEventListener('click', e => {
    e.stopPropagation();
    removeCard();
  });
  if (onClick) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      removeCard();
      onClick();
    });
  }
  stack.appendChild(card);
  while (stack.children.length > 4) {
    stack.firstElementChild?.remove();
  }
  setTimeout(removeCard, 6500);
}

async function handleRealtimePremiumInsertPopup(row) {
  if (!row || !currentUser?.id || !sb) return;
  const uid = String(currentUser.id);
  const fromId = String(row.user_id || '');
  if (!fromId || fromId === uid) return;
  const reason = String(row.reason || '');
  if (
    !reason.startsWith('__PLAY_DONATE__:') &&
    !reason.startsWith('__PLAY_VOTE__:') &&
    !reason.startsWith('__PLAY_CMT__:') &&
    !reason.startsWith('__PLAY_FOLLOW__:')
  ) {
    return;
  }

  let actorName = 'Someone';
  const cachedActor = sharedProfilesCache.get(fromId);
  if (cachedActor?.username) {
    actorName = cachedActor.username;
  } else {
    try {
      const { data: prof } = await sb.from('profiles').select('id, username, avatar_url, is_premium').eq('id', fromId).maybeSingle();
      if (prof?.id) {
        saveSharedProfileToCache(prof);
        if (prof.username) actorName = prof.username;
      }
    } catch (e) {}
  }

  if (reason.startsWith('__PLAY_DONATE__:')) {
    try {
      const p = JSON.parse(reason.slice('__PLAY_DONATE__:'.length));
      if (String(p?.toUserId || '') !== uid) return;
      const amt = Number(p.amount || 0);
      showLiveNotifPopup({
        key: 'pdon_' + (p.id || row.id || p.ts),
        kind: 'donate',
        icon: '💛',
        title: `${actorName} donated ${money(amt)}!`,
        body: (p.note ? `“${p.note}”` : `On your video "${p.videoTitle || 'Play Video'}"`) + ' — Tap to view',
        onClick: () => (p.videoId ? openPlayAtVideo(p.videoId, false) : showPage('notifications'))
      });
      playSound('buy');
    } catch (e) {}
  } else if (reason.startsWith('__PLAY_FOLLOW__:')) {
    try {
      const p = JSON.parse(reason.slice('__PLAY_FOLLOW__:'.length));
      if (!p?.following || String(p?.targetUserId || '') !== uid) return;
      showLiveNotifPopup({
        key: `pfol_${fromId}_${p.ts || row.id || ''}`,
        kind: 'follow',
        icon: '👤',
        title: `${actorName} started following you (+${money(PLAY_FOLLOW_PAYOUT)})`,
        body: 'Your Shorts are now boosted in their Play feed — Tap to view profile',
        onClick: () => openProfileModal(fromId)
      });
      playSound('buy');
    } catch (e) {}
  } else if (reason.startsWith('__PLAY_VOTE__:')) {
    try {
      const p = JSON.parse(reason.slice('__PLAY_VOTE__:'.length));
      if (p?.vote !== 'like' || !p?.videoId) return;
      const vid = playState.videosById.get(String(p.videoId));
      if (!vid || String(vid.user_id) !== uid) return;
      showLiveNotifPopup({
        key: `plike_${p.videoId}_${fromId}_${p.ts || ''}`,
        kind: 'like',
        icon: '♥',
        title: `${actorName} liked your video (+${money(PLAY_LIKE_PAYOUT)})`,
        body: `"${vid.title || 'Play Video'}" — Tap to open in Play`,
        onClick: () => openPlayAtVideo(vid.id, false)
      });
      playSound('click');
    } catch (e) {}
  } else if (reason.startsWith('__PLAY_CMT__:')) {
    try {
      const p = JSON.parse(reason.slice('__PLAY_CMT__:'.length));
      if (!p?.videoId) return;
      const vid = playState.videosById.get(String(p.videoId));
      const isReplyToMe = Boolean(p.reply_to_user_id && String(p.reply_to_user_id) === uid);
      const isVidOwner = Boolean(vid && String(vid.user_id) === uid);
      if (!isReplyToMe && !isVidOwner) return;
      const txt = String(p.text || '').trim() || 'Sent a GIF';
      showLiveNotifPopup({
        key: 'pcmt_' + (p.id || row.id || p.ts),
        kind: 'comment',
        icon: '💬',
        title: isReplyToMe
          ? `${actorName} replied to your Play comment`
          : `${actorName} commented on your video`,
        body: `"${txt}" — Tap to view comment`,
        onClick: () => openPlayAtVideo(p.videoId, true)
      });
      playSound('commenting');
    } catch (e) {}
  }
}

// ---------- Realtime ----------
let playRealtimeRefreshTimer = null;
let coinsRealtimeRefreshTimer = null;
let liveRealtimeRefreshTimer = null;
let titleRealtimeRefreshTimer = null;
let notifRealtimeRefreshTimer = null;
let dmRealtimeRefreshTimer = null;
let coinCommentsRealtimeTimer = null;

function startRealtime() {
  if (!sb) return;
  realtimeChannel = sb.channel('grind-live', { config: { broadcast: { self: false } } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coins' }, () => {
      coinsTradeStatsDirty = true;
      clearTimeout(coinsRealtimeRefreshTimer);
      coinsRealtimeRefreshTimer = setTimeout(() => {
        loadCoins();
        if (currentPage === 'live') loadLiveFeed();
        if (typeof refreshOpenTraderBattleModalLive === 'function') refreshOpenTraderBattleModalLive();
      }, 2800);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trades' }, () => {
      coinsTradeStatsDirty = true;
      clearTimeout(coinsRealtimeRefreshTimer);
      coinsRealtimeRefreshTimer = setTimeout(() => {
        loadCoins();
        if (selectedCoin && currentPage === 'coin') renderCoinDetail();
        if (currentPage === 'live') loadLiveFeed();
        if (currentPage === 'global' && lbMode === 'weekly' && Date.now() > lbAnimatingUntil) renderLeaderboard();
        if (typeof refreshOpenTraderBattleModalLive === 'function') refreshOpenTraderBattleModalLive();
      }, 2200);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'premium_requests' }, payload => {
      const changedReason = String(payload?.new?.reason || payload?.old?.reason || '');
      const changedUid = String(payload?.new?.user_id || payload?.old?.user_id || '');
      const myUid = currentUser?.id ? String(currentUser.id) : '';

      // 1. Admin / server-reset / account moderation commands
      if (/^__(ADMIN_CMD|SERVER_RESET|RESET_DONE|COIN_DEL|ACCOUNT_DELETED|COIN_SELF_SELL)__/.test(changedReason)) {
        invalidateAdminModerationStateCache();
        userNotificationsFetchedAt = 0;
        adminNotificationsFetchedAt = 0;
        if (currentUser) loadProfile();
      }

      // 2. Updates & Warnings & Direct Premium/PRO tier status changes
      if (changedReason.startsWith('__UPDATE__:') || changedReason.startsWith('__PRO_TIER__')) {
        if (changedReason.startsWith('__PRO_TIER__')) proUserIdsFetchedAt = 0;
        if (currentUser && (changedReason.startsWith('__UPDATE__:') || changedUid === myUid)) loadProfile();
      } else if (!changedReason.startsWith('__') && myUid && changedUid === myUid) {
        if (currentUser) loadProfile();
      }

      // 3. Featured coins
      if (changedReason.startsWith('__FEATURED_COINS__:')) {
        featuredCoinsFetchedAt = 0;
        if (currentPage === 'feed') fetchFeaturedCoins(true).then(() => renderFeaturedSection());
      }

      // 4. Coin comments
      if (changedReason.startsWith('__CMT_')) {
        if (selectedCoin && currentPage === 'coin') {
          clearTimeout(coinCommentsRealtimeTimer);
          coinCommentsRealtimeTimer = setTimeout(() => {
            if (selectedCoin && currentPage === 'coin') loadCoinComments(selectedCoin);
          }, 1200);
        }
      }

      // 5. LIVE shoutouts
      if (changedReason.startsWith('__LIVE_POST__:') && currentPage === 'live') {
        clearTimeout(liveRealtimeRefreshTimer);
        liveRealtimeRefreshTimer = setTimeout(() => {
          if (currentPage === 'live') loadLiveFeed();
        }, 1500);
      }

      // 6. Battle Pass (only reload when current user is viewing their own Pass & it changed)
      if (changedReason.startsWith('__PASS_') && currentPage === 'pass' && myUid && changedUid === myUid) {
        loadPassState().then(() => renderPassPage());
      }

      // 7. Titles & Crates (only when title/crate events actually occur)
      if ((changedReason.startsWith('__TITLE_EQUIP__:') || changedReason.startsWith('__CRATE_ITEM__:')) && typeof loadTitleSystemState === 'function') {
        clearTimeout(titleRealtimeRefreshTimer);
        titleRealtimeRefreshTimer = setTimeout(() => {
          loadTitleSystemState(true).then(() => {
            if (currentPage === 'account' && typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
            if (currentPage === 'marketplace' && typeof renderMarketplacePage === 'function') renderMarketplacePage();
            if (currentPage === 'global' && Date.now() > lbAnimatingUntil) renderLeaderboard();
          });
        }, 2500);
      }

      // 8. PLAY events (strictly scoped & debounced)
      if (changedReason.startsWith('__PLAY_') && typeof loadPlayData === 'function') {
        if (payload?.eventType === 'INSERT' && payload?.new) {
          handleRealtimePremiumInsertPopup(payload.new);
        }
        const isHighFreqPayoutOrView =
          changedReason.startsWith('__PLAY_VIEW__:') ||
          changedReason.startsWith('__PLAY_VIEW_PAID__:') ||
          changedReason.startsWith('__PLAY_LIKE_PAID__:') ||
          changedReason.startsWith('__PLAY_LIKER_PAID__:') ||
          changedReason.startsWith('__PLAY_FOLLOW_PAID__:') ||
          changedReason.startsWith('__PLAY_DONATE_PAID__:');
        const relevantPageVisible =
          currentPage === 'play' ||
          currentPage === 'account' ||
          currentPage === 'live' ||
          (currentPage === 'global' && lbMode === 'creators') ||
          Boolean(playState.openCommentsVideoId);
        if (!isHighFreqPayoutOrView || relevantPageVisible) {
          clearTimeout(playRealtimeRefreshTimer);
          playRealtimeRefreshTimer = setTimeout(() => {
            loadPlayData(true).then(() => {
              if (typeof syncAllPlayEarnings === 'function') syncAllPlayEarnings();
              else {
                if (typeof syncPlayLikeEarnings === 'function') syncPlayLikeEarnings();
                if (typeof syncPlayDonations === 'function') syncPlayDonations();
              }
              if (currentPage === 'account') {
                if (typeof renderAccountIdentityAndTitles === 'function') renderAccountIdentityAndTitles();
                if (typeof renderAccountPlayVideos === 'function') renderAccountPlayVideos();
              }
              if (currentPage === 'global' && lbMode === 'creators' && Date.now() > lbAnimatingUntil) renderLeaderboard();
              if (playState.openCommentsVideoId && typeof renderPlayCommentsDrawerList === 'function') renderPlayCommentsDrawerList();
              if (currentPage === 'live') loadLiveFeed();
            });
          }, 2500);
        }
      }

      // 9. Notifications & Admin inbox (only for notification-worthy events, debounced)
      const isNotifEvent =
        changedReason.startsWith('__PLAY_VOTE__:') ||
        changedReason.startsWith('__PLAY_CMT__:') ||
        changedReason.startsWith('__PLAY_CMT_DEL__:') ||
        changedReason.startsWith('__PLAY_FOLLOW__:') ||
        changedReason.startsWith('__PLAY_DONATE__:') ||
        changedReason.startsWith('__CMT_') ||
        changedReason.startsWith('__ADMIN_CMD__:') ||
        changedReason.startsWith('__UPDATE__:') ||
        changedReason.startsWith('__REPORT__:') ||
        changedReason.startsWith('__PREM_REQ__:') ||
        changedReason.startsWith('__TB_CHALLENGE__:') ||
        changedReason.startsWith('__TB_RESULT__:') ||
        !changedReason.startsWith('__');

      if (isNotifEvent) {
        userNotificationsFetchedAt = 0;
        adminNotificationsFetchedAt = 0;
        if (currentPage === 'notifications') {
          clearTimeout(notifRealtimeRefreshTimer);
          notifRealtimeRefreshTimer = setTimeout(() => loadRequests(), 2500);
        } else if (currentUser) {
          clearTimeout(notifRealtimeRefreshTimer);
          notifRealtimeRefreshTimer = setTimeout(() => updateNotificationsBadge(), 5000);
        }
        if (isDompinator() && currentPage === 'admin') loadAdminPage();
      }

      // 10. Direct Messages: ONLY refresh on actual __DM_ events involving current user (or when DM modal is open)!
      if (changedReason.startsWith('__DM_') && currentUser && typeof refreshDirectMessages === 'function') {
        const dmOpen = !$('#dmModal')?.classList.contains('hidden');
        const involvesMe = !myUid || changedUid === myUid || changedReason.includes(myUid);
        if (dmOpen || involvesMe) {
          clearTimeout(dmRealtimeRefreshTimer);
          dmRealtimeRefreshTimer = setTimeout(() => refreshDirectMessages(true), 800);
        }
      }

      // 11. Trader Battles: ONLY process events involving the current user
      if (changedReason.startsWith('__TB_') && currentUser && typeof handleTraderBattleRealtimeEvent === 'function') {
        if (!myUid || changedUid === myUid || changedReason.includes(myUid)) {
          handleTraderBattleRealtimeEvent(payload);
        }
      }
    })
    .on('broadcast', { event: 'dm_typing' }, ({ payload }) => {
      if (typeof handleIncomingDmTyping === 'function') handleIncomingDmTyping(payload);
    })
    .on('broadcast', { event: 'dm_read' }, ({ payload }) => {
      if (typeof handleIncomingDmRead === 'function') handleIncomingDmRead(payload);
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

function hasProPassAccess() {
  const t = getUserTier(currentUser);
  return t === 'pro' || t === 'premium';
}

function getPassProReward(reward) {
  if (!reward) return null;
  if (reward.type === 'cash') {
    const dbl = Number(reward.amount || 0) * 2;
    return {
      type: 'cash',
      amount: dbl,
      title: `$${dbl}`,
      desc: `2X PRO Bonus: Instant $${dbl.toFixed(2)} cash`
    };
  }
  if (reward.type === 'coin_live_post') {
    return {
      type: 'coin_live_post',
      count: 2,
      title: '2X Coin Live Posts',
      desc: 'Unlock +2 extra custom coin shoutouts in LIVE'
    };
  }
  return {
    type: 'cash',
    amount: 120,
    title: '$120 PRO Finale',
    desc: '2X Finale cash bonus for PRO & Premium holders'
  };
}

function getLivePostsGrantedCount() {
  return (passState.claimedTiers.has(10) ? 1 : 0) + (passState.claimedProTiers.has(10) ? 2 : 0);
}

function updatePassNavBadge() {
  const badge = $('#navPassBadge');
  if (!badge) return;
  if (!currentUser) {
    badge.classList.add('hidden');
    return;
  }
  const secs = getEffectivePassSeconds();
  const hasPro = hasProPassAccess();
  let unclaimed = 0;
  PASS_REWARDS.forEach(r => {
    if (secs >= r.tier * PASS_STEP_SECONDS) {
      if (!passState.claimedTiers.has(r.tier)) unclaimed += 1;
      if (hasPro && !passState.claimedProTiers.has(r.tier)) unclaimed += 1;
    }
  });
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
  if (!force && now - lastPassRemoteSyncAt < 115000) return;
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
  const localKeyProClaims = `grind_pass_pro_claims_s${season}_${uid}`;
  const localKeyLiveCount = `grind_pass_livepost_count_s${season}_${uid}`;

  let maxSecs = Number(localStorage.getItem(localKeySec) || 0) || 0;
  const claimed = new Set();
  const claimedPro = new Set();
  try {
    const arr = JSON.parse(localStorage.getItem(localKeyClaims) || '[]');
    if (Array.isArray(arr)) arr.forEach(t => claimed.add(Number(t)));
  } catch (e) {}
  try {
    const arrPro = JSON.parse(localStorage.getItem(localKeyProClaims) || '[]');
    if (Array.isArray(arrPro)) arrPro.forEach(t => claimedPro.add(Number(t)));
  } catch (e) {}

  let localLiveCount = Number(localStorage.getItem(localKeyLiveCount) || 0) || 0;
  if (localLiveCount === 0 && localStorage.getItem(`grind_pass_livepost_s${season}_${uid}`) === '1') {
    localLiveCount = 1;
  }
  let remoteLiveCount = 0;

  try {
    const [{ data: timeRows }, { data: claimRows }, { data: proClaimRows }, { data: postRows }] = await Promise.all([
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
        .like('reason', `__PASS_PRO_CLAIM__:${season}:%`)
        .limit(40),
      sb.from('premium_requests')
        .select('reason')
        .eq('user_id', uid)
        .like('reason', '__LIVE_POST__:%')
        .limit(50)
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
    (proClaimRows || []).forEach(r => {
      const parts = String(r.reason || '').split(':');
      const tVal = Number(parts[2] || 0);
      if (tVal >= 1 && tVal <= 20) claimedPro.add(tVal);
    });
    (postRows || []).forEach(r => {
      try {
        const parsed = JSON.parse(String(r.reason).slice('__LIVE_POST__:'.length));
        if (Number(parsed?.season || 1) === season) remoteLiveCount += 1;
      } catch (e) {}
    });
  } catch (e) {}

  const livePostsUsed = Math.max(localLiveCount, remoteLiveCount);
  passState = { season, seconds: maxSecs, claimedTiers: claimed, claimedProTiers: claimedPro, livePostsUsed };
  try {
    localStorage.setItem(localKeySec, String(maxSecs));
    localStorage.setItem(localKeyClaims, JSON.stringify([...claimed]));
    localStorage.setItem(localKeyProClaims, JSON.stringify([...claimedPro]));
    localStorage.setItem(localKeyLiveCount, String(livePostsUsed));
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

function renderPassPage(scrollToActive = false) {
  if (!currentUser) return;
  const season = passState.season || 1;
  const hasPro = hasProPassAccess();
  if ($('#passSeasonEyebrow')) $('#passSeasonEyebrow').textContent = `SEASON ${season} BATTLE PASS`;
  if ($('#passSeasonTitleNum')) $('#passSeasonTitleNum').textContent = String(season);
  if ($('#pageTitle') && currentPage === 'pass') $('#pageTitle').textContent = `Season ${season} Pass`;

  const proPill = $('#passProTrackStatus');
  if (proPill) {
    proPill.className = `pass-track-pill ${hasPro ? 'active' : 'locked'}`;
    proPill.textContent = hasPro
      ? '★ PRO 2X TRACK ACTIVE'
      : 'FREE TRACK ONLY · Unlock PRO for 2X bottom row';
  }

  updatePassLiveClock();
  const secs = getEffectivePassSeconds();

  let readyCount = 0;
  PASS_REWARDS.forEach(r => {
    if (secs >= r.tier * PASS_STEP_SECONDS) {
      if (!passState.claimedTiers.has(r.tier)) readyCount += 1;
      if (hasPro && !passState.claimedProTiers.has(r.tier)) readyCount += 1;
    }
  });
  const claimAllBtn = $('#passClaimAllBtn');
  if (claimAllBtn) {
    claimAllBtn.classList.toggle('hidden', readyCount === 0);
    if (readyCount > 0) claimAllBtn.textContent = `Claim All Ready (${readyCount})`;
  }

  // Tier 10 Coin Live Post Composer (Free = +1, PRO = +2)
  const livePostCard = $('#passLivePostCard');
  if (livePostCard) {
    const granted = getLivePostsGrantedCount();
    const used = Math.min(granted, Number(passState.livePostsUsed || 0));
    const remaining = Math.max(0, granted - used);
    livePostCard.classList.toggle('hidden', granted === 0);
    if (granted > 0) {
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
      if (remaining <= 0) {
        if (sendBtn) {
          sendBtn.disabled = true;
          sendBtn.textContent = `All ${granted} Used ✓`;
        }
        if (statusEl) statusEl.textContent = `0 / ${granted} Coin Live Posts remaining`;
        if (subEl) subEl.textContent = `You already broadcast all ${granted} Season ${season} Coin Live Post${granted > 1 ? 's' : ''} in LIVE.`;
      } else {
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Post Coin to LIVE';
        }
        if (statusEl) statusEl.textContent = `${remaining} / ${granted} Coin Live Post${remaining > 1 ? 's' : ''} remaining`;
        if (subEl) subEl.textContent = 'Pick a coin and write a message for everyone to see in the LIVE Activity feed.';
      }
    }
  }

  const trackEl = $('#passTiersTrack');
  if (!trackEl) return;

  trackEl.innerHTML = PASS_REWARDS.map(r => {
    const reqSecs = r.tier * PASS_STEP_SECONDS;
    const prevSecs = (r.tier - 1) * PASS_STEP_SECONDS;
    const isUnlocked = secs >= reqSecs;
    const fillPct = Math.max(0, Math.min(100, ((secs - prevSecs) / PASS_STEP_SECONDS) * 100)).toFixed(1);

    // Top Row: Free Track
    const isFreeClaimed = passState.claimedTiers.has(r.tier);
    const freeCardCls = [
      'pass-tier-card',
      isFreeClaimed ? 'claimed' : (isUnlocked ? 'unlocked' : '')
    ].filter(Boolean).join(' ');
    let freeBtnText = `Locked (${r.minutes}m)`;
    let freeBtnCls = 'pass-claim-btn';
    let freeDisabled = 'disabled';
    if (isFreeClaimed) {
      freeBtnText = 'Claimed ✓';
      freeBtnCls = 'pass-claim-btn claimed';
    } else if (isUnlocked) {
      freeBtnText = r.type === 'pro' ? 'Claim Free PRO' : (r.type === 'coin_live_post' ? 'Unlock Live Post' : `Claim ${r.title}`);
      freeBtnCls = 'pass-claim-btn ready';
      freeDisabled = '';
    }
    const freeRewardCls = r.type === 'cash' ? 'pass-tier-reward' : 'pass-tier-reward compact';

    // Bottom Row: PRO 2X Track
    const proR = getPassProReward(r);
    const isProClaimed = passState.claimedProTiers.has(r.tier);
    const proCardCls = [
      'pass-tier-card pro-card',
      !hasPro ? 'pro-locked' : (isProClaimed ? 'claimed' : (isUnlocked ? 'unlocked' : ''))
    ].filter(Boolean).join(' ');
    let proBtnText = !hasPro ? 'Requires PRO' : `Locked (${r.minutes}m)`;
    let proBtnCls = 'pass-claim-btn';
    let proDisabled = 'disabled';
    if (!hasPro) {
      proBtnText = 'Requires PRO';
    } else if (isProClaimed) {
      proBtnText = 'Claimed 2X ✓';
      proBtnCls = 'pass-claim-btn claimed';
    } else if (isUnlocked) {
      proBtnText = proR.type === 'coin_live_post' ? 'Unlock +2 Posts' : `Claim ${proR.title}`;
      proBtnCls = 'pass-claim-btn ready pro-ready';
      proDisabled = '';
    }
    const proRewardCls = proR.type === 'cash' && r.type === 'cash' ? 'pass-tier-reward' : 'pass-tier-reward compact';

    return `
      <div class="pass-col" data-pass-col="${r.tier}">
        <div class="pass-slot">
          <div class="${freeCardCls}">
            <div>
              <div class="pass-tier-top">
                <span class="pass-tier-num">FREE · LV ${r.tier}</span>
                <span class="tiny muted">${r.minutes}m</span>
              </div>
              <div class="${freeRewardCls}" style="margin-top:4px;">${escapeHtml(r.title)}</div>
              <div class="pass-tier-desc" style="margin-top:4px;">${escapeHtml(r.desc)}</div>
            </div>
            <button type="button" class="${freeBtnCls}" data-pass-claim="${r.tier}" data-pass-track="free" ${freeDisabled}>${escapeHtml(freeBtnText)}</button>
          </div>
        </div>

        <div class="pass-spine-cell">
          <div class="pass-spine-line"><div class="pass-spine-line-fill" style="width:${fillPct}%"></div></div>
          <div class="pass-spine-node ${isUnlocked ? 'reached' : ''}">${r.tier}</div>
          <span class="pass-spine-time">${r.minutes}m</span>
        </div>

        <div class="pass-slot">
          <div class="${proCardCls}">
            <div>
              <div class="pass-tier-top">
                <span class="pass-tier-num" style="color:#fcd34d;">PRO · LV ${r.tier}</span>
                <span class="pass-pro-x2">2X</span>
              </div>
              <div class="${proRewardCls}" style="margin-top:4px;color:#fef3c7;">${escapeHtml(proR.title)}</div>
              <div class="pass-tier-desc" style="margin-top:4px;">${escapeHtml(proR.desc)}</div>
            </div>
            <button type="button" class="${proBtnCls}" data-pass-claim="${r.tier}" data-pass-track="pro" ${proDisabled}>${escapeHtml(proBtnText)}</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $$('#passTiersTrack [data-pass-claim]').forEach(btn => {
    btn.addEventListener('click', () => claimPassReward(Number(btn.dataset.passClaim), btn.dataset.passTrack || 'free'));
  });

  if (scrollToActive && !passScrollInitDone) {
    passScrollInitDone = true;
    const scroller = $('#passColumnsScroll');
    if (scroller) {
      const unlockedLv = Math.min(PASS_REWARDS.length, Math.floor(secs / PASS_STEP_SECONDS));
      const targetTier = Math.max(1, Math.min(PASS_REWARDS.length, unlockedLv));
      const targetCol = scroller.querySelector(`[data-pass-col="${targetTier}"]`);
      if (targetCol) {
        requestAnimationFrame(() => {
          scroller.scrollLeft = Math.max(0, targetCol.offsetLeft - scroller.clientWidth / 3);
        });
      }
    }
  }
}

async function claimPassReward(tier, track = 'free') {
  if (!currentUser || !sb) return;
  const reward = PASS_REWARDS.find(r => r.tier === tier);
  if (!reward) return;
  const isProTrack = track === 'pro';
  const secs = getEffectivePassSeconds();
  if (secs < reward.tier * PASS_STEP_SECONDS) return;

  if (isProTrack) {
    if (!hasProPassAccess()) {
      toast('PRO or Premium tier is required for the bottom 2X PRO track!');
      return;
    }
    if (passState.claimedProTiers.has(tier)) return;
  } else {
    if (passState.claimedTiers.has(tier)) return;
  }

  const btn = $(`#passTiersTrack [data-pass-claim="${tier}"][data-pass-track="${track}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claiming...';
  }

  const season = passState.season || 1;
  const activeReward = isProTrack ? getPassProReward(reward) : reward;

  if (activeReward.type === 'cash') {
    const newCash = Number(currentUser.cash || 0) + Number(activeReward.amount);
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
    if (error) {
      toast('Pass reward error: ' + error.message);
      renderPassPage();
      return;
    }
    currentUser.cash = newCash;
    await updateNetWorth();
    if (typeof triggerRewardBurstAnimation === 'function') {
      triggerRewardBurstAnimation(btn, `+${money(activeReward.amount)}`, `${isProTrack ? 'PRO 2X ' : ''}Pass Level ${tier}`);
    }
    toast(`${isProTrack ? 'PRO 2X ' : ''}Pass Level ${tier} claimed: +${money(activeReward.amount)}!`);
  } else if (activeReward.type === 'pro') {
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
    if (getTierRank(getUserTier(currentUser)) <= 1) {
      try { localStorage.setItem('grind_seen_tier_' + currentUser.id, 'pro'); } catch (e) {}
      triggerTierPromotionAnimation('pro');
    }
    toast('Pass Level 20 claimed! Free PRO tier + bottom 2X PRO track unlocked!');
  } else if (activeReward.type === 'coin_live_post') {
    if (typeof triggerRewardBurstAnimation === 'function') {
      triggerRewardBurstAnimation(btn, isProTrack ? '+2 Live Posts' : '+1 Live Post', `Pass Level ${tier}`);
    }
    toast(isProTrack
      ? 'PRO 2X Level 10 claimed! +2 extra Coin Live Posts unlocked above.'
      : 'Level 10 Coin Live Post unlocked! Choose your coin & message above.');
  }

  if (isProTrack) {
    passState.claimedProTiers.add(tier);
    try {
      localStorage.setItem(`grind_pass_pro_claims_s${season}_${currentUser.id}`, JSON.stringify([...passState.claimedProTiers]));
    } catch (e) {}
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: `__PASS_PRO_CLAIM__:${season}:${tier}`,
      status: 'denied'
    });
  } else {
    passState.claimedTiers.add(tier);
    try {
      localStorage.setItem(`grind_pass_claims_s${season}_${currentUser.id}`, JSON.stringify([...passState.claimedTiers]));
    } catch (e) {}
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: `__PASS_CLAIM__:${season}:${tier}`,
      status: 'denied'
    });
  }

  await syncPassTimeToRemote(true);
  updatePassNavBadge();
  updateUIProfile();
  renderPassPage();
}

async function claimAllReadyPassRewards() {
  if (!currentUser || !sb) return;
  const secs = getEffectivePassSeconds();
  const season = passState.season || 1;
  let hasPro = hasProPassAccess();
  let totalCash = 0;
  let unlockedProNow = false;
  let unlockedLivePosts = 0;
  const newFreeTiers = [];
  const newProTiers = [];

  // Pass 1: Collect Free track first (Level 20 grants PRO for Pass 2)
  PASS_REWARDS.forEach(r => {
    if (secs >= r.tier * PASS_STEP_SECONDS && !passState.claimedTiers.has(r.tier)) {
      newFreeTiers.push(r.tier);
      if (r.type === 'cash') totalCash += Number(r.amount || 0);
      else if (r.type === 'coin_live_post') unlockedLivePosts += 1;
      else if (r.type === 'pro') {
        unlockedProNow = true;
        hasPro = true;
      }
    }
  });

  // Pass 2: Collect PRO 2X track if eligible
  if (hasPro) {
    PASS_REWARDS.forEach(r => {
      if (secs >= r.tier * PASS_STEP_SECONDS && !passState.claimedProTiers.has(r.tier)) {
        newProTiers.push(r.tier);
        const proR = getPassProReward(r);
        if (proR.type === 'cash') totalCash += Number(proR.amount || 0);
        else if (proR.type === 'coin_live_post') unlockedLivePosts += 2;
      }
    });
  }

  if (!newFreeTiers.length && !newProTiers.length) return;

  const btn = $('#passClaimAllBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Claiming all...';
  }

  if (totalCash > 0) {
    const newCash = Number(currentUser.cash || 0) + totalCash;
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', currentUser.id);
    if (error) {
      toast('Error claiming pass rewards: ' + error.message);
      if (btn) btn.disabled = false;
      renderPassPage();
      return;
    }
    currentUser.cash = newCash;
  }

  if (unlockedProNow && !currentUser.is_pro) {
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__PRO_TIER__',
      status: 'approved'
    });
    localStorage.setItem('grind_pro_' + currentUser.id, '1');
    currentUser.is_pro = true;
    proUserIds.add(currentUser.id);
    if (getTierRank(getUserTier(currentUser)) <= 1) {
      try { localStorage.setItem('grind_seen_tier_' + currentUser.id, 'pro'); } catch (e) {}
      triggerTierPromotionAnimation('pro');
    }
  }

  const inserts = [
    ...newFreeTiers.map(t => ({ user_id: currentUser.id, reason: `__PASS_CLAIM__:${season}:${t}`, status: 'denied' })),
    ...newProTiers.map(t => ({ user_id: currentUser.id, reason: `__PASS_PRO_CLAIM__:${season}:${t}`, status: 'denied' }))
  ];
  if (inserts.length) {
    await sb.from('premium_requests').insert(inserts);
  }

  newFreeTiers.forEach(t => passState.claimedTiers.add(t));
  newProTiers.forEach(t => passState.claimedProTiers.add(t));
  try {
    localStorage.setItem(`grind_pass_claims_s${season}_${currentUser.id}`, JSON.stringify([...passState.claimedTiers]));
    localStorage.setItem(`grind_pass_pro_claims_s${season}_${currentUser.id}`, JSON.stringify([...passState.claimedProTiers]));
  } catch (e) {}

  if (totalCash > 0) await updateNetWorth();
  await syncPassTimeToRemote(true);
  updatePassNavBadge();
  updateUIProfile();
  if (btn) btn.disabled = false;
  renderPassPage();

  const parts = [];
  if (totalCash > 0) parts.push(`+${money(totalCash)} cash`);
  if (unlockedLivePosts > 0) parts.push(`+${unlockedLivePosts} Coin Live Post${unlockedLivePosts > 1 ? 's' : ''}`);
  if (unlockedProNow) parts.push('Free PRO tier');
  if (typeof triggerRewardBurstAnimation === 'function' && totalCash > 0) {
    triggerRewardBurstAnimation(btn || $('#passClaimAllBtn'), `+${money(totalCash)}`, `${newFreeTiers.length + newProTiers.length} Pass Rewards Claimed`);
  }
  toast(`Claimed ${newFreeTiers.length + newProTiers.length} Pass rewards: ${parts.join(', ')}!`);
}

$('#passClaimAllBtn')?.addEventListener('click', claimAllReadyPassRewards);
$('#passScrollLeftBtn')?.addEventListener('click', () => {
  $('#passColumnsScroll')?.scrollBy({ left: -360, behavior: 'smooth' });
});
$('#passScrollRightBtn')?.addEventListener('click', () => {
  $('#passColumnsScroll')?.scrollBy({ left: 360, behavior: 'smooth' });
});

$('#sendPassLivePostBtn')?.addEventListener('click', async () => {
  const granted = getLivePostsGrantedCount();
  if (!currentUser || !sb || granted <= 0 || Number(passState.livePostsUsed || 0) >= granted) return;
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

  passState.livePostsUsed = Number(passState.livePostsUsed || 0) + 1;
  try { localStorage.setItem(`grind_pass_livepost_count_s${season}_${currentUser.id}`, String(passState.livePostsUsed)); } catch (e) {}
  if ($('#passLivePostMsg')) $('#passLivePostMsg').value = '';
  toast('Coin Live Post is now live for everyone!');
  renderPassPage();
});

// ============================================================
// ---------- GRIND-BOT (PRO+ AI STOCK TACTICS) ---------------
// ============================================================
const GRIND_BOT_REMOTE_URL = 'https://ais-pre-6t6kqxwlmllmygnc6gzkjm-935946932105.europe-west2.run.app/api/grind-bot';

function formatBotMessageHtml(rawText) {
  let html = escapeHtml(rawText || '');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

async function fetchGrindBotUserHoldings() {
  if (!sb || !currentUser) return [];
  try {
    const srvResetTs = adminModStateCache.serverResetTs || 0;
    const delCoins = adminModStateCache.deletedCoinIds || new Set();
    const { data } = await sb
      .from('holdings')
      .select('coin_id, shares, coins(id, name, ticker, price, created_at)')
      .eq('user_id', currentUser.id)
      .gt('shares', 0);
    return (data || [])
      .filter(h => !delCoins.has(String(h.coin_id)) && (!srvResetTs || (h.coins?.created_at && new Date(h.coins.created_at).getTime() > srvResetTs)))
      .map(h => {
        const c = coins.find(x => String(x.id) === String(h.coin_id)) || h.coins;
        const price = Number(c?.price || 1);
        const shares = Number(h.shares || 0);
        return {
          coinId: String(h.coin_id),
          name: c?.name || 'Coin',
          ticker: c?.ticker || 'COIN',
          price,
          shares,
          value: calcHoldingsValue(price, shares),
          recentBuys: c?.recent_buys_24h || 0,
          changePct: Number(c?.change_pct || 0)
        };
      });
  } catch (e) {
    return [];
  }
}

function buildGrindBotMarketContext(userHoldings = []) {
  const tier = tierLabel(currentUser);
  const cashStr = money(currentUser?.cash || 0);
  const nwStr = money(currentUser?.net_worth || currentUser?.cash || 0);
  const featSet = new Set((featuredCoinIdsCache || []).filter(Boolean).map(String));

  const allCoinsSummary = [...coins]
    .sort((a, b) => (b.recent_buys_24h || 0) - (a.recent_buys_24h || 0) || Number(b.buy_volume || 0) - Number(a.buy_volume || 0))
    .map(c => {
      const tags = [];
      if (featSet.has(String(c.id))) tags.push('FEATURED');
      if (watchlistIds.has(String(c.id))) tags.push('WATCHLIST');
      if (currentUser && String(c.creator_id) === String(currentUser.id)) tags.push('YOUR_COIN');
      const tagStr = tags.length ? ` [${tags.join(',')}]` : '';
      return `${c.name} ($${c.ticker}): price=${priceFmt(c.price)}, today=${Number(c.change_pct || 0).toFixed(2)}%, 24h_buys=${c.recent_buys_24h || 0}, total_buys=${c.total_buys || 0}, vol=${money(c.buy_volume || 0)}${tagStr}`;
    })
    .join('\n');

  const holdingsSummary = userHoldings.length
    ? userHoldings.map(h => `${h.name} ($${h.ticker}): shares=${h.shares.toFixed(4)}, value=${money(h.value)}, price=${priceFmt(h.price)}`).join('; ')
    : 'None';

  return `Trader: ${currentUser?.username || 'Trader'} | Tier: ${tier} | Available Cash: ${cashStr} | Net Worth: ${nwStr}
Your Current Holdings: ${holdingsSummary}
All Active Market Coins (${coins.length} total):
${allCoinsSummary || 'No active coins yet.'}`;
}

function isGreetingOrSmallTalk(question) {
  const q = String(question || '').trim().toLowerCase().replace(/[!?.]+$/g, '');
  if (!q) return false;
  return /^(hi|hello|hey|yo|sup|hiya|heya|howdy|greetings|hej|tja|tjena|hallå|mors|god\s*(morgon|kväll|dag)|good\s*(morning|afternoon|evening)|what'?s\s*up|wassup|how\s+are\s+you(\s+doing)?|hur\s+mår\s+du|läget|thanks|thank\s+you|thx|ty|tack|ok|okay|cool|nice|alright|got\s+it|sounds\s+good|bye|goodbye|cya|see\s+ya|who\s+are\s+you|what\s+can\s+you\s+do|help)$/i.test(q);
}

function hasGrindTopic(question) {
  const q = String(question || '').toLowerCase();
  const grindWords = /\b(grind|grind[\s-]?bot|coin|coins|currency|currencies|token|ticker|stock|stocks|market|trade|trading|invest|investing|investment|buy|sell|hold|holding|holdings|portfolio|net[\s-]?worth|cash|money|balance|wealth|rich|richer|higher|increase|grow|growth|boost|earn|gain|gains|profit|profits|pnl|price|chart|curve|bonding|trending|cheapest|expensive|featured|watchlist|live|live[\s-]?post|pass|battle[\s-]?pass|season|play[\s-]?time|pro|premium|member|creator|create|tier|level|reward|rewards|daily|login|streak|ad|ads|leaderboard|rank|ranking|divest|dip|pump|volume|momentum|strategy|tactic|tactics|recommend|suggest|best|should i|game|play|shares?|value|how do i make|make money|get rich|aktie|aktier|köp|köpa|sälj|sälja|investera|valuta|marknad|tips|bästa|pengar|tjäna|rik)\b/i;
  if (grindWords.test(q)) return true;
  if (coins.some(c => {
    const nm = (c.name || '').toLowerCase();
    const tk = (c.ticker || '').toLowerCase();
    return (nm.length >= 3 && q.includes(nm)) || (tk && (q.includes('$' + tk) || new RegExp(`\\b${tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)));
  })) {
    return true;
  }
  return false;
}

function trySolveMathExpression(question) {
  const raw = String(question || '').trim();
  const pctMatch = raw.match(/(?:what(?:'s|\s+is)\s+)?(-?\d+(?:\.\d+)?)\s*%\s*of\s*(-?\d+(?:\.\d+)?)/i);
  if (pctMatch) {
    const p = Number(pctMatch[1]);
    const base = Number(pctMatch[2]);
    if (Number.isFinite(p) && Number.isFinite(base)) {
      const res = (p / 100) * base;
      return `**${p}%** of **${base}** = **${Number.isInteger(res) ? res : Number(res.toFixed(6))}**`;
    }
  }
  const sqrtMatch = raw.match(/(?:square\s*root\s*of|sqrt)\s*\(?\s*(\d+(?:\.\d+)?)\s*\)?/i);
  if (sqrtMatch) {
    const v = Number(sqrtMatch[1]);
    if (Number.isFinite(v) && v >= 0) {
      const res = Math.sqrt(v);
      return `√**${v}** = **${Number.isInteger(res) ? res : Number(res.toFixed(6))}**`;
    }
  }
  let expr = raw
    .replace(/^(what(?:'s|\s+is)|calculate|solve|compute|eval)\s+/i, '')
    .replace(/[?=]+$/g, '')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .trim();
  if (!expr || !/^[\d\s+\-*/().^]+$/.test(expr) || !/\d/.test(expr) || !/[+\-*/^]/.test(expr)) {
    return null;
  }
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/()^]/g);
  if (!tokens) return null;
  let pos = 0;
  function parseExpr() {
    let left = parseTerm();
    while (tokens[pos] === '+' || tokens[pos] === '-') {
      const op = tokens[pos++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parsePower();
    while (tokens[pos] === '*' || tokens[pos] === '/') {
      const op = tokens[pos++];
      const right = parsePower();
      if (op === '/' && right === 0) throw new Error('Division by zero');
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }
  function parsePower() {
    let base = parseFactor();
    if (tokens[pos] === '^') {
      pos++;
      const exp = parsePower();
      base = Math.pow(base, exp);
    }
    return base;
  }
  function parseFactor() {
    if (tokens[pos] === '-') {
      pos++;
      return -parseFactor();
    }
    if (tokens[pos] === '+') {
      pos++;
      return parseFactor();
    }
    if (tokens[pos] === '(') {
      pos++;
      const val = parseExpr();
      if (tokens[pos] !== ')') throw new Error('Mismatched parens');
      pos++;
      return val;
    }
    const num = Number(tokens[pos++]);
    if (!Number.isFinite(num)) throw new Error('Invalid number');
    return num;
  }
  try {
    const val = parseExpr();
    if (pos !== tokens.length || !Number.isFinite(val)) return null;
    const formatted = Number.isInteger(val) ? String(val) : String(Number(val.toFixed(6)));
    return `**${expr}** = **${formatted}**`;
  } catch (e) {
    return null;
  }
}

async function tryWikipediaLookup(question) {
  const cleanQ = String(question || '')
    .replace(/^(who\s+(?:is|was|are|were)|what\s+(?:is|was|are|were)|where\s+(?:is|are)|when\s+(?:did|was|were)|tell\s+me\s+about|explain|define|search\s+(?:for)?)\s+/i, '')
    .replace(/[?!.]+$/g, '')
    .trim();
  if (!cleanQ || cleanQ.length < 2) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQ)}&srlimit=1&utf8=&format=json&origin=*`;
    const sRes = await fetch(searchUrl, { signal: controller.signal });
    if (!sRes.ok) return null;
    const sData = await sRes.json();
    const hit = sData?.query?.search?.[0];
    if (!hit?.pageid) return null;

    const extUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&exsentences=4&pageids=${hit.pageid}&format=json&origin=*`;
    const eRes = await fetch(extUrl, { signal: controller.signal });
    if (!eRes.ok) return null;
    const eData = await eRes.json();
    const page = eData?.query?.pages?.[String(hit.pageid)];
    const extract = String(page?.extract || '').trim();
    if (!extract) return null;
    return `**${page.title || hit.title}**\n\n${extract}`;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function generatePremiumGeneralReply(question) {
  const q = String(question || '').trim();
  const lower = q.toLowerCase();

  const mathRes = trySolveMathExpression(q);
  if (mathRes) return mathRes;

  if (/\b(what\s+time|current\s+time|what\s+date|today'?s\s+date|what\s+day\s+is\s+it)\b/i.test(lower)) {
    const now = new Date();
    return `Right now it is **${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}** on **${now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}**.`;
  }
  if (/\b(flip\s+a?\s*coin|heads\s+or\s+tails)\b/i.test(lower)) {
    return `Coin flip result: **${Math.random() < 0.5 ? 'Heads' : 'Tails'}**!`;
  }
  if (/\b(tell\s+me\s+a\s+joke|joke)\b/i.test(lower)) {
    const jokes = [
      `Why did the trader bring a ladder to the chart? Because they kept hearing about breaking resistance!`,
      `Why don't programmers like nature? Too many bugs.`,
      `Why did the math book look sad? Because it had too many problems.`
    ];
    return jokes[Math.floor(Math.random() * jokes.length)];
  }

  const wiki = await tryWikipediaLookup(q);
  if (wiki) return wiki;

  return `**GRIND-BOT Premium:** I looked for **"${q.slice(0, 80)}"**, and while the full AI model endpoint isn't responding from this host right now, Premium lets you ask anything — try a factual topic (e.g. _"What is quantum computing?"_), a math calculation, or any **GRIND** game & market question!`;
}

function generateLocalGrindBotReply(question, userHoldings = [], isPremium = false) {
  const q = String(question || '').trim();
  const cash = Number(currentUser?.cash || 0);
  const netWorth = Number(currentUser?.net_worth || cash);
  const uname = currentUser?.username || 'Trader';

  if (isGreetingOrSmallTalk(q) && !hasGrindTopic(q)) {
    const lowerG = q.toLowerCase();
    if (/^(thanks|thank\s+you|thx|ty|tack)/i.test(lowerG)) {
      return `Anytime, **${uname}**! Let me know whenever you want ${isPremium ? 'help with anything or a scan of' : 'me to scan'} the **${coins.length} active coins**.`;
    }
    if (/^(bye|goodbye|cya|see\s+ya)/i.test(lowerG)) {
      return `See you later, **${uname}**! Watch the **LIVE** feed and protect your profits.`;
    }
    if (/^(ok|okay|cool|nice|alright|got\s+it|sounds\s+good)/i.test(lowerG)) {
      return isPremium
        ? `Ready whenever you are! Since you have **Premium**, you can ask me **any question** on any topic or ask for GRIND market tactics.`
        : `Ready whenever you are! Ask me how to raise your net worth, what coins to invest in, or any question about GRIND.`;
    }
    return isPremium
      ? `Hey **${uname}**! I'm **GRIND-BOT Premium** ★ — watching **${coins.length} active coins** (cash: **${money(cash)}**, Net Worth: **${money(netWorth)}**).\n\nBecause you have **Premium**, I can answer **any question** (general knowledge, math, coding, writing, or anything else) as well as all **GRIND** tactics!`
      : `Hey **${uname}**! I'm **GRIND-BOT** — watching **${coins.length} active coins** in the live market (your cash: **${money(cash)}**, Net Worth: **${money(netWorth)}**).\n\nI can chat a bit, and I'm ready to help with **all GRIND game & stock questions** — raising your net worth, coin picks, Daily Login, Battle Pass, or curve tactics!`;
  }

  if (!hasGrindTopic(q)) {
    if (isPremium) return null;
    return `I'm **GRIND-BOT** — you can say hi anytime, and I can help with **anything inside the GRIND game** (net worth, stock tactics, Battle Pass, Daily Login, Play Shorts, Marketplace Crates, creating coins, or market coins).\n\nNon-GRIND questions require **Premium** tier!\n\nTry asking:\n• "How do I raise my net worth fast?"\n• "What coins should I invest in right now?"\n• "How does the bonding curve or Battle Pass work?"`;
  }

  const lower = q.toLowerCase();
  const featSet = new Set((featuredCoinIdsCache || []).filter(Boolean).map(String));

  // Game mechanics & overall GRIND help (Pass, Daily, Play, Curve, Create, Tiers, Leaderboard)
  if (/\b(battle\s*pass|pass|season|play[\s-]?time|2x track|live[\s-]?post)\b/i.test(lower) && !/\b(invest|buy|net[\s-]?worth|coin|pick)\b/i.test(lower)) {
    const lv = Math.min(20, Math.floor(getEffectivePassSeconds() / PASS_STEP_SECONDS));
    return `**Season ${passState.season || 1} Battle Pass Guide (Your Level: ${lv}/20):**\n• Every **5 minutes** of Pass Play Time unlocks 1 level (up to Level 20 at 100m).\n• **Top Row (Free Track):** Cash bonuses ($5–$60), **Coin Live Post** at Level 10, and **Free PRO upgrade** at Level 20.\n• **Bottom Row (PRO Track — 2X):** PRO & Premium players get **double** every cash tier ($10–$120), **+2 Coin Live Posts** at Level 10, and a **$120 PRO Finale** bonus at Level 20.\n• Season resets only reset **Pass Play Time** — your **Time Played Leaderboard** stays untouched!`;
  }

  if (/\b(daily|streak|ads?|watch ad|bonding curve|curve|how does.*game work|how to play)\b/i.test(lower) && !/\b(net[\s-]?worth|invest|buy|best coin)\b/i.test(lower)) {
    return `**GRIND Core Mechanics Guide:**\n• **Bonding Curve (CURVE_K = 0.30):** Coins start at **$1.00**. Every buy adds \`+$0.30 × $amount\` to the price; sells reverse the exact curve. You profit when other traders buy *after* you.\n• **Daily Login & Play:** Check **Daily Login** every day for cash streaks (**2X cash** for PRO/Premium, plus PRO on Day 7), and post Shorts/Videos in **Play** to earn **$2/like, $0.50/view & $10/follower** (plus **+$0.50** when you like someone else's video)!\n• **Tiers:** **Member** (1 coin, $50 Play upload), **PRO** (2 coins, 2X Daily, 2X Pass track, $10 Play upload, GRIND-BOT), **Premium** (3 coins, Blue Star, Free Play uploads, all PRO perks).`;
  }

  if (!coins.length) {
    return `There are **0 active coins** in the GRIND market right now.\n\n**Best way to grow your Net Worth (${money(netWorth)}) right now:**\n• You have **${money(cash)}** cash ready.\n• Launch a coin in **Create** ($1.00 start) — it adds directly to your portfolio value and attracts the first wave of buyers on the LIVE feed.\n• Claim **Battle Pass (2X PRO)**, **Daily Login**, and post Shorts in **Play** ($2/like, $0.50/view, $10/follower) while building capital.`;
  }

  // Score every active coin using live curve & demand data
  const scored = coins.map(c => {
    const price = Math.max(Number(c.price || 1), 0.01);
    const buys24 = Number(c.recent_buys_24h || 0);
    const totalBuys = Number(c.total_buys || 0);
    const vol = Number(c.buy_volume || 0);
    const pct = Number(c.change_pct || 0);
    const isFeatured = featSet.has(String(c.id));
    const curveLeverage = 3.0 / price; // +% move per $10 inflow on CURVE_K=0.30
    const momentumScore = buys24 * 12 + Math.min(vol, 500) * 0.25 + (isFeatured ? 14 : 0) + (pct > 0 ? Math.min(pct, 40) * 0.2 : 0);
    const earlyValueScore = (price <= 3.5 ? 25 : Math.max(0, 18 - price)) + buys24 * 6 + totalBuys * 1.5 + (isFeatured ? 10 : 0);
    return {
      coin: c,
      price,
      buys24,
      totalBuys,
      vol,
      pct,
      isFeatured,
      curveLeverage,
      momentumScore,
      earlyValueScore
    };
  });

  // 1. Check if user asked about a specific coin in the market
  const matchedCoin = coins.find(c => {
    const nm = (c.name || '').toLowerCase();
    const tk = (c.ticker || '').toLowerCase();
    return (tk && (lower.includes('$' + tk) || new RegExp(`\\b${tk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)))
      || (nm.length >= 3 && lower.includes(nm));
  });

  if (matchedCoin) {
    const s = scored.find(x => String(x.coin.id) === String(matchedCoin.id));
    const held = userHoldings.find(h => String(h.coinId) === String(matchedCoin.id));
    const sampleBuy = Math.min(Math.max(5, Math.floor(cash * 0.35 * 100) / 100), Math.max(cash, 5));
    const sim = calcCurveBuy(s.price, sampleBuy);
    const impactPct = ((sim.newPrice - s.price) / s.price) * 100;

    let verdict = '**Wait / Small Probe Only** — low recent demand right now. Because GRIND uses a CURVE_K=0.30 bonding curve, you only profit if other traders buy in after you.';
    if (s.buys24 >= 2 && s.price <= 5) {
      verdict = `**Strong Tactical Buy** — active 24h demand (${s.buys24} buys) at a low curve price (${priceFmt(s.price)}), giving strong upside per dollar of inflow.`;
    } else if (s.buys24 >= 2) {
      verdict = `**Momentum Ride (Scale Carefully)** — active 24h demand (${s.buys24} buys), though higher curve price (${priceFmt(s.price)}) means slower % moves; plan partial sells (1/4 or 1/2).`;
    } else if (s.isFeatured) {
      verdict = `**Featured Spotlight Play** — currently Featured on the Feed, which brings extra eyeballs and potential inflows.`;
    }

    const lines = [
      `**Market Breakdown: ${matchedCoin.name} ($${matchedCoin.ticker})**`,
      `• **Price:** ${priceFmt(s.price)} (${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(2)}% today) · **24h Buys:** ${s.buys24} · **Buy Volume:** ${money(s.vol)}${s.isFeatured ? ' · **★ Featured**' : ''}`,
      held ? `• **Your Position:** ${held.shares.toFixed(4)} $${matchedCoin.ticker} worth **${money(held.value)}**` : `• **Your Position:** None held`,
      `• **Curve Simulation:** Putting **${money(sampleBuy)}** moves the price to **${priceFmt(sim.newPrice)}** (+${impactPct.toFixed(1)}%) and mints **${sim.shares.toFixed(4)} shares**.`,
      `• **GRIND-BOT Verdict:** ${verdict}`
    ];
    return lines.join('\n');
  }

  // 2. Portfolio / Sell / Scaling out questions
  if (/\b(1\/4|1\/2|3\/4|scale out|when.*sell|best time to sell)\b/i.test(lower)) {
    const holdingLines = userHoldings.length
      ? `\n\n**Your Live Positions Right Now:**\n` + userHoldings.map(h =>
          `• **${h.name} ($${h.ticker})** (${money(h.value)} @ ${priceFmt(h.price)}, ${h.recentBuys} buys/24h): ${h.recentBuys >= 2 ? 'Keep **1/2**, trim **1/4** if spiking' : 'Consider **1/2** or **All** if volume stays quiet'}`
        ).join('\n')
      : '';
    return `**GRIND Partial Selling Tactics (1/4 vs 1/2 vs 3/4 vs All):**\n• **Sell 1/4:** Use on early green waves when 24h buys are still rising — locks in profit while letting 75% ride the curve.\n• **Sell 1/2:** Best when a coin doubles or slows down after a big surge — secures your original cash so your remaining shares are risk-free.\n• **Sell 3/4 or All:** Exit fast when **LIVE** activity stalls (` + '`0 recent buys`' + `) or large holders begin dumping.${holdingLines}`;
  }

  if (/\b(holding|holdings|portfolio|my coins|should i sell|sälj|sälja)\b/i.test(lower)) {
    if (!userHoldings.length) {
      return `You don't hold any other coins yet (**${money(cash)}** cash available).\n\nSince you have 0 open positions, look at active 24h movers and invest **25%–40%** of your cash rather than going all-in on a single coin.`;
    }
    const lines = [`**Your Holdings Tactical Review** (Cash: ${money(cash)} · Net Worth: ${money(netWorth)}):`];
    userHoldings.forEach(h => {
      let action = 'Hold & monitor LIVE activity';
      if (h.recentBuys >= 2 && h.changePct > 10) {
        action = 'Strong momentum — consider taking **1/4** or **1/2** profit on spikes while keeping core shares';
      } else if (h.recentBuys === 0 && h.value >= 3) {
        action = 'Quiet 24h volume — watch closely; rotate **1/2** or **All** if volume stays dead while other coins trend';
      }
      lines.push(`• **${h.name} ($${h.ticker})** — Value **${money(h.value)}** @ ${priceFmt(h.price)} (${h.recentBuys} buys/24h): ${action}`);
    });
    return lines.join('\n');
  }

  // 3. List all coins in the market if asked specifically
  const wantsFullList = /\b(all coins|all currencies|every coin|list|see all|hela marknaden|alla coins)\b/i.test(lower);
  const byMomentum = [...scored].sort((a, b) => b.momentumScore - a.momentumScore || b.vol - a.vol);
  const byEarly = [...scored]
    .filter(x => x.price <= 4.0)
    .sort((a, b) => b.earlyValueScore - a.earlyValueScore || a.price - b.price);

  const topMomentum = byMomentum[0];
  const topEarly = byEarly.find(x => !topMomentum || String(x.coin.id) !== String(topMomentum.coin.id)) || byMomentum[1];
  const featuredList = scored.filter(x => x.isFeatured);
  const coldCoins = scored.filter(x => x.buys24 === 0 && x.price > 4.0).sort((a, b) => b.price - a.price);

  const header = `**Live GRIND Market Scan (${coins.length} Active Coins · Your Cash: ${money(cash)})**`;
  const sections = [header];

  if (wantsFullList) {
    const marketLines = [...scored]
      .sort((a, b) => b.buys24 - a.buys24 || b.price - a.price)
      .slice(0, 25)
      .map(s => `• **${s.coin.name} ($${s.coin.ticker})** — ${priceFmt(s.price)} (${s.pct >= 0 ? '+' : ''}${s.pct.toFixed(1)}% today, ${s.buys24} buys/24h, vol ${money(s.vol)})${s.isFeatured ? ' ★' : ''}`);
    sections.push(marketLines.join('\n') + (coins.length > 25 ? `\n_(Showing top 25 of ${coins.length} coins)_` : ''));
  }

  // Smart Investment Recommendations
  const picks = [];
  if (topMomentum) {
    picks.push(`1. **Top Momentum Play — ${topMomentum.coin.name} ($${topMomentum.coin.ticker})** @ **${priceFmt(topMomentum.price)}**\n   • **Why:** ${topMomentum.buys24} buys in the last 24h (${money(topMomentum.vol)} volume, ${topMomentum.pct >= 0 ? '+' : ''}${topMomentum.pct.toFixed(1)}% today)${topMomentum.isFeatured ? ' + currently **Featured**' : ''}. High buyer traffic makes follow-on inflows more likely.`);
  }
  if (topEarly) {
    picks.push(`2. **Best Low-Price Curve Entry — ${topEarly.coin.name} ($${topEarly.coin.ticker})** @ **${priceFmt(topEarly.price)}**\n   • **Why:** At ${priceFmt(topEarly.price)}, every $10 of new buys adds +$3.00 to price (~+${Math.round((3 / topEarly.price) * 100)}% curve jump), giving much higher % leverage than expensive coins.`);
  }
  if (featuredList.length) {
    const fNames = featuredList.map(f => `**$${f.coin.ticker}** (${priceFmt(f.price)})`).join(', ');
    picks.push(`3. **Featured Spotlight:** ${fNames} — Featured coins sit at the top of everyone's Feed, often pulling extra impulse buys.`);
  }
  if (picks.length) {
    sections.push(`**Smartest Investments Right Now:**\n${picks.join('\n')}`);
  }

  // Tailored Cash Sizing Plan
  if (cash >= 2) {
    const leg1 = Math.round(cash * 0.40 * 100) / 100;
    const leg2 = Math.round(cash * 0.30 * 100) / 100;
    const reserve = Math.max(0, Math.round((cash - leg1 - leg2) * 100) / 100);
    if (topMomentum && topEarly) {
      sections.push(`**Suggested Cash Split for your ${money(cash)}:**\n• **${money(leg1)}** into **$${topMomentum.coin.ticker}** (momentum leader)\n• **${money(leg2)}** into **$${topEarly.coin.ticker}** (low-price curve leverage)\n• Keep **${money(reserve)}** in cash to snipe brand-new launches on the LIVE feed`);
    } else if (topMomentum) {
      sections.push(`**Suggested Cash Split for your ${money(cash)}:**\n• Put **${money(leg1)}** into **$${topMomentum.coin.ticker}** and keep **${money(cash - leg1)}** cash ready for new launches.`);
    }
  } else {
    sections.push(`**Cash Builder Note:** With **${money(cash)}** cash, grab **Season Pass** rewards (every 5m), **Daily Login**, or post/like Shorts in **Play** ($2/like earned, +$0.50 per like given) to build buying power before taking bigger swings.`);
  }

  if (coldCoins.length) {
    const warnNames = coldCoins.slice(0, 2).map(c => `$${c.coin.ticker} (${priceFmt(c.price)})`).join(', ');
    sections.push(`**Caution:** Avoid heavy buys into high-price coins with 0 buys in 24h (e.g. ${warnNames}) until fresh buyers appear in **LIVE**.`);
  }

  // Dedicated Net Worth / Growth Playbook if user asks how to raise net-worth or get richer
  if (/\b(net[\s-]?worth|higher|increase|grow|growth|boost|get rich|richer|wealth|make money|earn cash|earn more|rank up|leaderboard)\b/i.test(lower)) {
    const lv = Math.min(20, Math.floor(getEffectivePassSeconds() / PASS_STEP_SECONDS));
    const hasPro = hasProPassAccess();
    const myCreatedCount = coins.filter(c => currentUser && String(c.creator_id) === String(currentUser.id)).length;
    const nwTips = [
      `• **1. Claim Free + PRO 2X Battle Pass Rewards (Currently Lv ${lv}/20):** Every 5m of Play Time unlocks cash up to $60 Free + **$120 PRO 2X** per tier — pure zero-risk Net Worth growth.`,
      `• **2. Never Miss Daily Login & Play:** Daily Login gives **2X cash** for PRO/Premium (up to +$30 on Day 7), and **Play** pays creators **$2/like, $0.50/view & $10/follower** (plus +$0.50 for liking others' videos)!`,
      `• **3. Ride Early Inflows, Scale Out in Quarters:** Enter low-price or high-24h-buy coins early, then sell **1/4** or **1/2** after surges so other traders' buys lock into your Net Worth.`,
      myCreatedCount === 0
        ? `• **4. Launch Your Own Coin & Promote It:** Use **Create** to launch a coin and use your Level 10 **Coin Live Post** in **LIVE** to attract early buyers!`
        : `• **4. Promote Your Created Coin(s):** Use a Level 10 **Coin Live Post** (you get **3 total** with PRO!) and keep an eye on **LIVE** for incoming buyers.`,
      !hasPro ? `• **5. Unlock PRO:** Reach Pass Lv 20 or Daily Day 7 to double Daily & Pass rewards.` : `• **5. Leverage Your PRO Status:** Remember you get **2X** on both Daily Login and the bottom Battle Pass track — claim them as soon as they unlock!`
    ];
    sections.splice(1, 0, `**How to Raise Your Net Worth Faster (Current: ${money(netWorth)}):**\n${nwTips.join('\n')}`);
  }

  return sections.join('\n\n');
}

function renderGrindBotMessages() {
  const listEl = $('#grindBotMessages');
  if (!listEl) return;
  const isPremium = getUserTier(currentUser) === 'premium';
  if (!grindBotHistory.length) {
    grindBotHistory = [
      {
        role: 'model',
        text: isPremium
          ? `Welcome to **GRIND-BOT Premium ★**! With **Premium**, you can ask me **any question** (general knowledge, math, writing, or anything else) — plus I inspect **all ${coins.length} active coins** in GRIND to plan your moves!`
          : `Welcome to **GRIND-BOT**! I can inspect **all ${coins.length} active coins** in the live GRIND market plus your holdings to suggest smart investments, net worth growth, and exit timing.\n\n_(PRO sticks to GRIND questions — **Premium** unlocks asking any question!)_`
      }
    ];
  }
  listEl.innerHTML = grindBotHistory.map(m => `
    <div class="grindbot-msg ${m.role === 'user' ? 'user' : 'bot'}">
      <div class="grindbot-msg-label">${m.role === 'user' ? escapeHtml(currentUser?.username || 'You') : (isPremium ? '★ GRIND-BOT PREMIUM' : '⌘ GRIND-BOT')}</div>
      <div>${m.role === 'user' ? escapeHtml(m.text).replace(/\n/g, '<br>') : formatBotMessageHtml(m.text)}</div>
    </div>
  `).join('');
  listEl.scrollTop = listEl.scrollHeight;
}

function renderGrindBotPage() {
  if (!currentUser) return;
  const tier = getUserTier(currentUser);
  const hasPro = tier === 'pro' || tier === 'premium';
  const isPremium = tier === 'premium';
  $('#grindBotLocked')?.classList.toggle('hidden', hasPro);
  $('#grindBotApp')?.classList.toggle('hidden', !hasPro);
  const subEl = $('#grindBotSubtitle');
  if (subEl) {
    subEl.textContent = isPremium
      ? '★ PREMIUM UNLOCKED · Ask Anything + Live Market Aware'
      : 'All GRIND Questions & Tactics · Live Market Aware (Upgrade to Premium for Any Topic)';
  }
  const inputEl = $('#grindBotInput');
  if (inputEl) {
    inputEl.placeholder = isPremium
      ? 'Ask GRIND-BOT anything — any question, GRIND tactics, or market analysis...'
      : 'Ask GRIND-BOT about net worth, coins, Battle Pass, or tactics...';
  }
  if (hasPro) renderGrindBotMessages();
}

function detectClientGrindBotViolation(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(child\s*porn|cp\b|csam|underage\s*sex|loli|shota)\b/i.test(s)) return 'Illegal CSAM Content';
  if (/\b(how\s+to\s+(?:kill\s+myself|commit\s+suicide)|suicide\s+methods?|ways\s+to\s+self[\s-]?harm)\b/i.test(s)) return 'Self-Harm / Suicide';
  if (/\b(how\s+to\s+(?:make|build)\s+(?:a\s+)?(?:bomb|explosive|pipe\s*bomb|meth|cocaine|fentanyl|ricin|poison)|how\s+to\s+(?:murder|assassinate|shoot\s+up))\b/i.test(s)) return 'Illegal Weapons / Violence / Drugs';
  if (/\b(how\s+to\s+(?:hack|ddos|dox|phish|steal\s+accounts?|crack\s+passwords?|bypass\s+supabase|sql\s+injection|exploit\s+grind|dupe\s+cash|cheat\s+coins?)|ransomware|keylogger|carding|stolen\s+credit\s+cards?)\b/i.test(s)) return 'Hacking / Exploit / Fraud';
  if (/\b(nigger|nigga|faggot|kike|retard|kys|kill\s+yourself)\b/i.test(s)) return 'Hate Speech / Severe Harassment';
  return null;
}

async function submitGrindBotAutoReport(promptText, category = 'Policy Violation') {
  if (!sb || !currentUser) return false;
  try {
    const payload = {
      id: 'rep_bot_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      type: 'player',
      source: 'grind_bot_auto',
      category: String(category || 'Policy Violation').slice(0, 80),
      target_id: currentUser.id,
      target_name: currentUser.username || 'Unknown',
      title: `GRIND-BOT Auto-Report: ${category}`,
      details: `[GRIND-BOT AUTO-REPORT · ${category}]\nReported Account: ${currentUser.username || 'Unknown'} (${tierLabel(currentUser)})\nFlagged Message:\n"${String(promptText || '').slice(0, 800)}"`,
      ts: Date.now()
    };
    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__REPORT__:' + JSON.stringify(payload),
      status: 'denied'
    });
    if (!error && isDompinator()) updateNotificationsBadge();
    return !error;
  } catch (e) {
    return false;
  }
}

async function tryGrindBotEndpoint(url, payload, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    const data = await res.json();
    if (!res.ok || !data?.reply) return null;
    return {
      reply: data.reply,
      flagged: Boolean(data.flagged),
      flagReason: data.flagReason || null
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLocalGrindBotFallback(question, userHoldings, isPremium) {
  const local = generateLocalGrindBotReply(question, userHoldings, isPremium);
  if (local !== null) return local;
  return await generatePremiumGeneralReply(question);
}

async function sendGrindBotPrompt(text) {
  if (!currentUser || grindBotSending) return;
  const tier = getUserTier(currentUser);
  const hasPro = tier === 'pro' || tier === 'premium';
  const isPremium = tier === 'premium';
  if (!hasPro) {
    toast('GRIND-BOT requires PRO or Premium tier.');
    return;
  }
  const clean = String(text || '').trim();
  if (!clean) return;

  const historyToSend = grindBotHistory.slice(-10);
  grindBotHistory.push({ role: 'user', text: clean });
  grindBotHistory.push({ role: 'model', text: isPremium ? 'Thinking...' : 'Scanning all live GRIND coins & calculating tactics...' });
  grindBotSending = true;
  if ($('#grindBotInput')) $('#grindBotInput').value = '';
  if ($('#grindBotSendBtn')) $('#grindBotSendBtn').disabled = true;
  renderGrindBotMessages();

  try {
    const localViolation = detectClientGrindBotViolation(clean);
    if (localViolation) {
      await submitGrindBotAutoReport(clean, localViolation);
      grindBotHistory[grindBotHistory.length - 1] = {
        role: 'model',
        text: `⚠️ This message violates GRIND safety rules (**${localViolation}**) and has been automatically reported to **Dompinator**.`
      };
      return;
    }

    await loadCoins();
    const userHoldings = await fetchGrindBotUserHoldings();
    const marketContext = buildGrindBotMarketContext(userHoldings);
    const payload = {
      message: clean,
      history: historyToSend,
      marketContext,
      isProOrHigher: true,
      isPremium
    };

    const isGithubPages = (window.location.hostname || '').endsWith('github.io');
    let endpointResult = null;
    if (!isGithubPages) {
      endpointResult = await tryGrindBotEndpoint('/api/grind-bot', payload, 9000);
    }
    if (!endpointResult) {
      endpointResult = await tryGrindBotEndpoint(GRIND_BOT_REMOTE_URL, payload, 5000);
    }

    if (endpointResult?.flagged) {
      await submitGrindBotAutoReport(clean, endpointResult.flagReason || 'Policy Violation');
    }

    const reply = endpointResult?.reply || await resolveLocalGrindBotFallback(clean, userHoldings, isPremium);
    grindBotHistory[grindBotHistory.length - 1] = {
      role: 'model',
      text: reply
    };
  } catch (err) {
    grindBotHistory[grindBotHistory.length - 1] = {
      role: 'model',
      text: await resolveLocalGrindBotFallback(clean, [], isPremium)
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

// ---------- PRO Tier Paid Upgrade Modal (Member GRIND-BOT transition) ----------
let selectedProUpgradePlan = 'monthly';
let proUpgradeCloseTimer = null;

function setProUpgradePlan(plan) {
  selectedProUpgradePlan = plan === 'yearly' ? 'yearly' : 'monthly';
  $$('#proPlanGrid [data-pro-plan]').forEach(card => {
    card.classList.toggle('selected', card.dataset.proPlan === selectedProUpgradePlan);
  });
  const cta = $('#proUpgradePayBtn');
  if (cta) {
    cta.textContent = selectedProUpgradePlan === 'yearly'
      ? 'Upgrade to PRO · 499 kr / yr'
      : 'Upgrade to PRO · 39.99 kr / mo';
  }
}

function openProUpgradeModal() {
  const modal = $('#proUpgradeModal');
  if (!modal) return;
  if (proUpgradeCloseTimer) {
    clearTimeout(proUpgradeCloseTimer);
    proUpgradeCloseTimer = null;
  }
  setProUpgradePlan(selectedProUpgradePlan);
  modal.classList.remove('hidden');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      modal.classList.add('is-visible');
    });
  });
}

function closeProUpgradeModal() {
  const modal = $('#proUpgradeModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.remove('is-visible');
  if (proUpgradeCloseTimer) clearTimeout(proUpgradeCloseTimer);
  proUpgradeCloseTimer = setTimeout(() => {
    modal.classList.add('hidden');
    proUpgradeCloseTimer = null;
  }, 320);
}

$$('#proPlanGrid [data-pro-plan]').forEach(btn => {
  btn.addEventListener('click', () => setProUpgradePlan(btn.dataset.proPlan));
});
$('#proUpgradePayBtn')?.addEventListener('click', e => {
  e.preventDefault();
  // Intentionally does nothing (visual PRO upgrade prompt only)
});
$('#closeProUpgradeBtn')?.addEventListener('click', closeProUpgradeModal);
$('#proUpgradeLaterBtn')?.addEventListener('click', closeProUpgradeModal);
$('#proUpgradeModal')?.addEventListener('click', e => {
  if (e.target?.id === 'proUpgradeModal') closeProUpgradeModal();
});

// ============================================================
// ---------- SMOOTH PROMOTION & COIN BOOST ANIMATIONS --------
// ============================================================
let pendingTierPromo = null;
let tierPromoRaf = null;
let tierPromoCloseTimer = null;
let whaleOverlayTimer = null;
let whaleCanvasRaf = null;
let whaleCounterRaf = null;

function buildPromoCrownSvg(tier) {
  const isPrem = tier === 'premium';
  const gradId = isPrem ? 'promoPremCrownGrad' : 'promoProCrownGrad';
  const rimId = isPrem ? 'promoPremRimGrad' : 'promoProRimGrad';
  return `
    <svg viewBox="0 0 120 94" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="${gradId}" x1="16" y1="10" x2="106" y2="86" gradientUnits="userSpaceOnUse">
          ${isPrem
            ? `<stop offset="0%" stop-color="#f8fafc"/>
               <stop offset="32%" stop-color="#bae6fd"/>
               <stop offset="68%" stop-color="#38bdf8"/>
               <stop offset="100%" stop-color="#1d4ed8"/>`
            : `<stop offset="0%" stop-color="#fffbeb"/>
               <stop offset="32%" stop-color="#fde68a"/>
               <stop offset="68%" stop-color="#f59e0b"/>
               <stop offset="100%" stop-color="#b45309"/>`
          }
        </linearGradient>
        <linearGradient id="${rimId}" x1="16" y1="68" x2="104" y2="84" gradientUnits="userSpaceOnUse">
          ${isPrem
            ? `<stop offset="0%" stop-color="#fde68a"/>
               <stop offset="50%" stop-color="#e0f2fe"/>
               <stop offset="100%" stop-color="#fbbf24"/>`
            : `<stop offset="0%" stop-color="#fef3c7"/>
               <stop offset="50%" stop-color="#fbbf24"/>
               <stop offset="100%" stop-color="#92400e"/>`
          }
        </linearGradient>
      </defs>
      <!-- Crown Base Body -->
      <path d="M18 68L10 27L37 46L60 15L83 46L110 27L102 68H18Z" fill="url(#${gradId})" stroke="${isPrem ? '#e0f2fe' : '#fef3c7'}" stroke-width="2" stroke-linejoin="round"/>
      <!-- Inner Facet Shading -->
      <path d="M60 15L83 46L102 68H60V15Z" fill="${isPrem ? 'rgba(15,23,42,0.16)' : 'rgba(120,53,15,0.16)'}"/>
      <!-- Crown Band -->
      <rect x="16" y="69" width="88" height="12" rx="6" fill="url(#${rimId})" stroke="${isPrem ? '#bae6fd' : '#fef08a'}" stroke-width="1.5"/>
      <!-- Peak Orbs -->
      <circle cx="10" cy="24" r="5" fill="${isPrem ? '#e0f2fe' : '#fef3c7'}"/>
      <circle cx="60" cy="12" r="6.5" fill="${isPrem ? '#7dd3fc' : '#fde047'}"/>
      <circle cx="110" cy="24" r="5" fill="${isPrem ? '#e0f2fe' : '#fef3c7'}"/>
      <!-- Center Emblem Jewel -->
      ${isPrem
        ? `<path d="M60 36L64.2 44.6L73.6 46L66.8 52.6L68.4 62L60 57.5L51.6 62L53.2 52.6L46.4 46L55.8 44.6L60 36Z" fill="#ffffff" opacity="0.95"/>`
        : `<path d="M60 38L68 49L60 60L52 49L60 38Z" fill="#fffbeb" opacity="0.92"/><path d="M60 41L65 49L60 57L55 49L60 41Z" fill="#f59e0b"/>`
      }
      <!-- Side Band Jewels -->
      <circle cx="36" cy="75" r="2.8" fill="${isPrem ? '#0ea5e9' : '#b45309'}"/>
      <circle cx="60" cy="75" r="3.4" fill="${isPrem ? '#ffffff' : '#fffbeb'}"/>
      <circle cx="84" cy="75" r="2.8" fill="${isPrem ? '#0ea5e9' : '#b45309'}"/>
    </svg>
  `;
}

function startTierPromoParticles(tier) {
  const canvas = $('#tierPromoCanvas');
  if (!canvas) return;
  if (tierPromoRaf) {
    cancelAnimationFrame(tierPromoRaf);
    tierPromoRaf = null;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const isPrem = tier === 'premium';
  const palette = isPrem
    ? ['#f8fafc', '#bae6fd', '#38bdf8', '#60a5fa', '#fde68a']
    : ['#fffbeb', '#fde68a', '#fbbf24', '#f59e0b'];

  const cx = w / 2;
  const cy = h / 2 - 40;
  const motes = Array.from({ length: 68 }, (_, i) => {
    const burst = i < 36;
    const angle = (Math.PI * 2 * i) / 36 + (Math.random() - 0.5) * 0.35;
    const speed = burst ? (1.8 + Math.random() * 5.2) : (0.3 + Math.random() * 0.9);
    return {
      x: burst ? cx + (Math.random() - 0.5) * 30 : Math.random() * w,
      y: burst ? cy + (Math.random() - 0.5) * 24 : h * 0.2 + Math.random() * h * 0.8,
      vx: burst ? Math.cos(angle) * speed : (Math.random() - 0.5) * 0.35,
      vy: burst ? Math.sin(angle) * speed - 0.9 : -(0.35 + Math.random() * 0.75),
      r: 1.5 + Math.random() * 3.2,
      alpha: burst ? 0.95 : 0.25 + Math.random() * 0.55,
      color: palette[i % palette.length],
      burst,
      phase: Math.random() * Math.PI * 2
    };
  });

  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of motes) {
      m.phase += 0.04;
      if (m.burst) {
        m.vx *= 0.965;
        m.vy = m.vy * 0.965 + 0.03;
        m.alpha *= 0.985;
        if (m.alpha < 0.04) {
          m.burst = false;
          m.x = Math.random() * w;
          m.y = h + 12;
          m.vx = (Math.random() - 0.5) * 0.35;
          m.vy = -(0.4 + Math.random() * 0.85);
          m.alpha = 0.25 + Math.random() * 0.5;
        }
      } else {
        m.x += Math.sin(m.phase) * 0.25;
        if (m.y < -15) {
          m.y = h + 15;
          m.x = Math.random() * w;
        }
      }
      m.x += m.vx;
      m.y += m.vy;
      const glowAlpha = Math.max(0, Math.min(1, m.alpha * (0.75 + 0.25 * Math.sin(m.phase))));
      ctx.globalAlpha = glowAlpha;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    tierPromoRaf = requestAnimationFrame(draw);
  };
  tierPromoRaf = requestAnimationFrame(draw);
}

function closeTierPromoOverlay(immediate = false) {
  const overlay = $('#tierPromoOverlay');
  if (!overlay) return;
  if (tierPromoCloseTimer) {
    clearTimeout(tierPromoCloseTimer);
    tierPromoCloseTimer = null;
  }
  const stopCanvas = () => {
    if (tierPromoRaf) {
      cancelAnimationFrame(tierPromoRaf);
      tierPromoRaf = null;
    }
  };
  if (immediate || overlay.classList.contains('hidden')) {
    overlay.classList.add('hidden');
    overlay.classList.remove('is-closing', 'is-pro', 'is-premium');
    stopCanvas();
    return;
  }
  overlay.classList.add('is-closing');
  tierPromoCloseTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.classList.remove('is-closing', 'is-pro', 'is-premium');
    stopCanvas();
    tierPromoCloseTimer = null;
  }, 290);
}

function triggerTierPromotionAnimation(tier) {
  if (tier !== 'pro' && tier !== 'premium') return;
  const overlay = $('#tierPromoOverlay');
  if (!overlay) return;

  const appVisible = !$('#appView')?.classList.contains('hidden');
  if (!appVisible) {
    pendingTierPromo = tier;
    return;
  }
  pendingTierPromo = null;

  if (tierPromoCloseTimer) {
    clearTimeout(tierPromoCloseTimer);
    tierPromoCloseTimer = null;
  }

  const isPrem = tier === 'premium';
  overlay.classList.remove('hidden', 'is-closing', 'is-pro', 'is-premium');
  overlay.classList.add(isPrem ? 'is-premium' : 'is-pro');

  const stage = $('#tierPromoStage');
  if (stage) {
    stage.style.animation = 'none';
    void stage.offsetWidth;
    stage.style.animation = '';
  }

  const crownWrap = $('#tierPromoCrownSvg');
  if (crownWrap) crownWrap.innerHTML = buildPromoCrownSvg(tier);

  if ($('#tierPromoKicker')) {
    $('#tierPromoKicker').textContent = isPrem ? 'ROYAL TIER PROMOTION' : 'TIER PROMOTION';
  }
  if ($('#tierPromoTitle')) {
    $('#tierPromoTitle').textContent = isPrem ? 'PROMOTED TO PREMIUM' : 'PROMOTED TO PRO';
  }
  if ($('#tierPromoSub')) {
    $('#tierPromoSub').textContent = isPrem
      ? 'You reached the highest GRIND tier. Every luxury material, perk, and AI feature is now yours.'
      : 'Welcome to PRO. You unlocked your Gold Crown badge, double rewards, and live market tactics.';
  }
  if ($('#tierPromoPerks')) {
    const perks = isPrem
      ? ['Blue Star + Crown', '3 Coins Max', 'Sapphire & Platinum Themes', '2X Daily & Pass', 'GRIND-BOT Ask Anything']
      : ['Gold Crown Badge', '2 Coins Max', 'Gold & Obsidian Theme', '2X Daily & Pass', 'GRIND-BOT Unlocked'];
    $('#tierPromoPerks').innerHTML = perks.map(p => `<span class="tier-promo-perk">${escapeHtml(p)}</span>`).join('');
  }
  if ($('#tierPromoCloseBtn')) {
    $('#tierPromoCloseBtn').textContent = isPrem ? 'Enter Luxury Market' : 'Start Grinding';
  }

  startTierPromoParticles(tier);
}

function flushPendingTierPromo() {
  if (!pendingTierPromo) return;
  const tier = pendingTierPromo;
  pendingTierPromo = null;
  setTimeout(() => {
    if (currentUser && !currentUser.is_banned) {
      triggerTierPromotionAnimation(tier);
    }
  }, 280);
}

function detectAndTriggerTierPromotion(prevMemTier) {
  if (!currentUser?.id) return;
  const uid = currentUser.id;
  const resolvedTier = getUserTier(currentUser);
  const key = 'grind_seen_tier_' + uid;
  let storedTier = null;
  try { storedTier = localStorage.getItem(key); } catch (e) {}

  const baseline = prevMemTier || storedTier;
  if (baseline && getTierRank(resolvedTier) > getTierRank(baseline)) {
    try { localStorage.setItem(key, resolvedTier); } catch (e) {}
    triggerTierPromotionAnimation(resolvedTier);
  } else if (!storedTier || getTierRank(resolvedTier) !== getTierRank(storedTier)) {
    try { localStorage.setItem(key, resolvedTier); } catch (e) {}
  }
}

$('#tierPromoCloseBtn')?.addEventListener('click', () => closeTierPromoOverlay(false));
$('#tierPromoOverlay')?.addEventListener('click', e => {
  if (e.target?.id === 'tierPromoOverlay') closeTierPromoOverlay(false);
});
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#tierPromoOverlay')?.classList.contains('hidden')) {
    closeTierPromoOverlay(false);
  }
});

function pulseCoinDetailSurface() {
  const panel = $('#coinDetail .trade-panel');
  if (panel) {
    panel.classList.remove('trade-boost-glow');
    void panel.offsetWidth;
    panel.classList.add('trade-boost-glow');
  }
  const priceEl = $('#coinDetail .detail-price');
  if (priceEl) {
    priceEl.classList.remove('price-surge-flash');
    void priceEl.offsetWidth;
    priceEl.classList.add('price-surge-flash');
  }
}

function triggerMediumCoinBuyAnimation(coin, amount, impact) {
  const layer = $('#coinBoostFxLayer');
  if (!layer) return;
  pulseCoinDetailSurface();

  const pill = document.createElement('div');
  pill.className = 'coin-boost-pill';
  const pct = (Math.max(0, Number(impact) || 0) * 100);
  const pctTxt = pct >= 1 ? `+${pct.toFixed(1)}%` : `+${pct.toFixed(2)}%`;
  pill.innerHTML = `
    <div class="coin-boost-badge">▲</div>
    <div class="coin-boost-text">
      <strong>+${escapeHtml(money(amount))} added to $${escapeHtml(coin?.ticker || 'COIN')}</strong>
      <span>Market surge ${escapeHtml(pctTxt)}</span>
    </div>
  `;
  layer.appendChild(pill);

  // Smooth radiating emerald-gold sparks around the floating pill
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight - 108;
  for (let i = 0; i < 16; i++) {
    const spark = document.createElement('span');
    spark.className = 'coin-boost-spark';
    const angle = (-Math.PI * 0.9) + (Math.PI * 0.8 * (i / 15)) + (Math.random() - 0.5) * 0.25;
    const dist = 54 + Math.random() * 88;
    const sx = Math.cos(angle) * dist;
    const sy = Math.sin(angle) * dist - 14;
    spark.style.left = `${cx + (Math.random() - 0.5) * 110}px`;
    spark.style.top = `${cy + (Math.random() - 0.5) * 16}px`;
    spark.style.setProperty('--sx', `${sx.toFixed(1)}px`);
    spark.style.setProperty('--sy', `${sy.toFixed(1)}px`);
    spark.style.setProperty('--dur', `${(0.85 + Math.random() * 0.5).toFixed(2)}s`);
    layer.appendChild(spark);
    setTimeout(() => spark.remove(), 1500);
  }

  setTimeout(() => pill.remove(), 1850);
}

function triggerWhaleCoinBuyAnimation(coin, amount, impact) {
  const overlay = $('#whaleBuyOverlay');
  const canvas = $('#whaleBuyCanvas');
  const amountEl = $('#whaleAmountNum');
  const rowEl = $('#whaleCoinRow');
  if (!overlay || !canvas || !amountEl || !rowEl) return;

  pulseCoinDetailSurface();

  if (whaleOverlayTimer) {
    clearTimeout(whaleOverlayTimer);
    whaleOverlayTimer = null;
  }
  if (whaleCanvasRaf) {
    cancelAnimationFrame(whaleCanvasRaf);
    whaleCanvasRaf = null;
  }
  if (whaleCounterRaf) {
    cancelAnimationFrame(whaleCounterRaf);
    whaleCounterRaf = null;
  }

  // Restart CSS animations cleanly by cloning animated nodes or resetting animation
  overlay.classList.add('hidden');
  void overlay.offsetWidth;
  overlay.classList.remove('hidden');

  const pct = Math.max(0, Number(impact) || 0) * 100;
  const pctTxt = pct >= 1 ? `+${pct.toFixed(1)}%` : `+${pct.toFixed(2)}%`;
  const ticker = coin?.ticker || 'COIN';
  const chipInner = coin?.image_url
    ? `<img src="${escapeHtml(coin.image_url)}" alt="">`
    : escapeHtml(ticker[0] || '$');
  rowEl.innerHTML = `
    <span class="whale-coin-chip">${chipInner}</span>
    <span>$${escapeHtml(ticker)}</span>
    <span class="whale-impact-tag">${escapeHtml(pctTxt)} SURGE</span>
  `;

  // Smooth cubic ease-out rolling dollar counter ($0 -> exact amount)
  const countStart = performance.now();
  const countDur = 680;
  const stepCounter = now => {
    const t = Math.min(1, (now - countStart) / countDur);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = amount * eased;
    amountEl.textContent = `+${money(val)}`;
    if (t < 1) {
      whaleCounterRaf = requestAnimationFrame(stepCounter);
    } else {
      amountEl.textContent = `+${money(amount)}`;
      whaleCounterRaf = null;
    }
  };
  whaleCounterRaf = requestAnimationFrame(stepCounter);

  // 60fps full-viewport particle fountain & shockwave sparks
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = w / 2;
    const cy = h / 2;
    const colors = ['#34d399', '#6ee7b7', '#fde047', '#fbbf24', '#ffffff', '#a7f3d0'];
    const particles = [];

    // Radial explosion burst
    for (let i = 0; i < 125; i++) {
      const ang = (Math.PI * 2 * i) / 125 + (Math.random() - 0.5) * 0.25;
      const spd = 3.5 + Math.random() * 14.5;
      particles.push({
        x: cx,
        y: cy,
        px: cx,
        py: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 1.2,
        size: 2.2 + Math.random() * 4.8,
        color: colors[i % colors.length],
        alpha: 1,
        decay: 0.008 + Math.random() * 0.011,
        gravity: 0.14,
        drag: 0.968,
        kind: i % 5 === 0 ? 'diamond' : 'streak'
      });
    }

    // Bottom celebration fountain jets
    for (let i = 0; i < 70; i++) {
      const side = i % 2 === 0 ? 0.22 : 0.78;
      const ox = w * side + (Math.random() - 0.5) * 90;
      const oy = h + 10;
      particles.push({
        x: ox,
        y: oy,
        px: ox,
        py: oy,
        vx: (w / 2 - ox) * 0.018 + (Math.random() - 0.5) * 4.2,
        vy: -(11 + Math.random() * 9.5),
        size: 3 + Math.random() * 4.5,
        color: colors[(i + 2) % colors.length],
        alpha: 0.95,
        decay: 0.007 + Math.random() * 0.008,
        gravity: 0.22,
        drag: 0.985,
        kind: 'orb'
      });
    }

    const startTime = performance.now();
    const renderWhale = now => {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      let alive = false;
      for (const p of particles) {
        if (p.alpha <= 0.015) continue;
        alive = true;
        p.px = p.x;
        p.py = p.y;
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.alpha = Math.max(0, p.alpha - p.decay);

        ctx.globalAlpha = p.alpha;
        if (p.kind === 'streak') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1.5, p.size * 0.65);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else if (p.kind === 'diamond') {
          ctx.fillStyle = p.color;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(elapsed * 0.006 + p.size);
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      if (alive && elapsed < 2950) {
        whaleCanvasRaf = requestAnimationFrame(renderWhale);
      } else {
        ctx.clearRect(0, 0, w, h);
        whaleCanvasRaf = null;
      }
    };
    whaleCanvasRaf = requestAnimationFrame(renderWhale);
  }

  whaleOverlayTimer = setTimeout(() => {
    overlay.classList.add('hidden');
    if (whaleCanvasRaf) {
      cancelAnimationFrame(whaleCanvasRaf);
      whaleCanvasRaf = null;
    }
    whaleOverlayTimer = null;
  }, 3020);
}

// ---------- Init ----------
(async () => {
  if (!sb) {
    authMsg('Failed to connect to Supabase. Replace the API key in app.js with your real anon key.');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    try {
      const pendingRaw = sessionStorage.getItem('grind_pending_pw');
      if (pendingRaw) {
        const parsed = JSON.parse(pendingRaw);
        if (parsed?.email && parsed?.password && session.user?.email?.toLowerCase() === parsed.email.toLowerCase()) {
          await sb.auth.updateUser({ password: parsed.password });
          sessionStorage.removeItem('grind_pending_pw');
        }
      }
    } catch (e) {}
    await loadProfile();
    if (!currentUser?.is_banned) enterApp();
  } else {
    setAuthMode('login');
  }
})();

// ============================================================
// ---------- SOUND ENGINE (sounds/*.mp3) ---------------------
// ============================================================
const GRIND_SOUNDS = ['click', 'buy', 'sell', 'upload', 'commenting'];
const GRIND_SOUND_VOLUMES = {
  click: 0.28,
  buy: 0.48,
  sell: 0.48,
  upload: 0.52,
  commenting: 0.42
};
let grindAudioCtx = null;
const grindSoundBuffers = new Map();
const grindSoundLoading = new Map();
let lastClickSoundAt = 0;

function ensureGrindAudioCtx() {
  if (!grindAudioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) {
      try { grindAudioCtx = new Ctx(); } catch (e) {}
    }
  }
  if (grindAudioCtx && grindAudioCtx.state === 'suspended') {
    grindAudioCtx.resume().catch(() => {});
  }
  return grindAudioCtx;
}

async function preloadGrindSound(name) {
  if (!GRIND_SOUNDS.includes(name)) return null;
  if (grindSoundBuffers.has(name)) return grindSoundBuffers.get(name);
  if (grindSoundLoading.has(name)) return grindSoundLoading.get(name);
  const task = (async () => {
    const ctx = ensureGrindAudioCtx();
    if (!ctx) return null;
    for (const ext of ['mp3', 'wav', 'ogg']) {
      try {
        const res = await fetch(`sounds/${name}.${ext}`);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        grindSoundBuffers.set(name, buf);
        return buf;
      } catch (e) {}
    }
    return null;
  })();
  grindSoundLoading.set(name, task);
  return task;
}

function playSound(name) {
  if (!GRIND_SOUNDS.includes(name)) return;
  const vol = GRIND_SOUND_VOLUMES[name] ?? 0.45;
  try {
    const ctx = ensureGrindAudioCtx();
    const cachedBuf = grindSoundBuffers.get(name);
    if (ctx && cachedBuf) {
      const src = ctx.createBufferSource();
      src.buffer = cachedBuf;
      const gain = ctx.createGain();
      gain.gain.value = vol;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
      return;
    }
    preloadGrindSound(name);
    const audio = new Audio(`sounds/${name}.mp3`);
    audio.volume = vol;
    audio.play().catch(() => {});
  } catch (e) {}
}

document.addEventListener('pointerdown', e => {
  ensureGrindAudioCtx();
  GRIND_SOUNDS.forEach(s => preloadGrindSound(s));
  if (typeof handleUserGestureForAmbientMusic === 'function') {
    handleUserGestureForAmbientMusic();
  }
  const target = e.target?.closest?.(
    'button, .nav-btn, .feed-tab, .coin-card, .amount-btn, .sell-btn, .fav-btn, .zoom-btn, .creator-chip, .live-coin-chip, .theme-strip, .profile-link, a.brand, .auth-tab, .pro-plan-card'
  );
  if (!target || target.disabled || target.classList.contains('locked')) return;
  if (
    target.id === 'buyBtn' ||
    target.classList.contains('sell-btn') ||
    target.id === 'postCommentBtn' ||
    target.hasAttribute('data-reply-send') ||
    (target.closest('#createForm') && target.type === 'submit')
  ) {
    return;
  }
  const now = performance.now();
  if (now - lastClickSoundAt < 45) return;
  lastClickSoundAt = now;
  playSound('click');
}, { passive: true });

// ============================================================
// ---------- PREMIUM THEME AMBIENT MUSIC ENGINE --------------
// ============================================================
const PREMIUM_MUSIC_TRACKS = {
  'sapphire-obsidian': { file: 'premium-ambient', title: 'Obsidian Lounge — Soothing Ambient' },
  'gold-platinum': { file: 'premium-ambient', title: 'Obsidian Lounge — Soothing Ambient' },
  'rose-amethyst': { file: 'rose-amethyst-ambient', title: 'Velvet Crystal — Rose & Amethyst' }
};
const AMBIENT_TARGET_GAIN = 0.22;
const ambientBuffers = new Map();
const ambientLoadingTasks = new Map();
let ambientCurrentTrackFile = null;
let ambientSourceNode = null;
let ambientGainNode = null;
let ambientFallbackAudio = null;
let ambientFadeTimer = null;
let ambientStopTimer = null;
let ambientDesired = false;
let ambientPlaying = false;

function getPremiumMusicTrackForTheme(themeId) {
  return PREMIUM_MUSIC_TRACKS[themeId] || null;
}

function isPremiumMusicTheme(themeId) {
  return Boolean(getPremiumMusicTrackForTheme(themeId));
}

function getMusicPrefKey(uid) {
  return 'grind_music_enabled_' + (uid || 'guest');
}

function isUserMusicEnabled() {
  if (!currentUser?.id) return true;
  try {
    return localStorage.getItem(getMusicPrefKey(currentUser.id)) !== '0';
  } catch (e) {
    return true;
  }
}

function setUserMusicEnabled(enabled) {
  if (!currentUser?.id) return;
  try {
    localStorage.setItem(getMusicPrefKey(currentUser.id), enabled ? '1' : '0');
  } catch (e) {}
}

function shouldPlayPremiumAmbientMusic() {
  if (!currentUser || currentUser.is_banned) return false;
  if ($('#appView')?.classList.contains('hidden')) return false;
  if (!isUserMusicEnabled()) return false;
  if (currentPage === 'play') return false;
  return isPremiumMusicTheme(getActiveThemeId());
}

async function loadAmbientMusicBuffer(trackFile) {
  if (!trackFile) return null;
  if (ambientBuffers.has(trackFile)) return ambientBuffers.get(trackFile);
  if (ambientLoadingTasks.has(trackFile)) return ambientLoadingTasks.get(trackFile);
  const task = (async () => {
    const ctx = ensureGrindAudioCtx();
    if (!ctx) return null;
    for (const ext of ['mp3', 'wav', 'ogg']) {
      try {
        const res = await fetch(`sounds/${trackFile}.${ext}`);
        if (!res.ok) continue;
        const arr = await res.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arr);
        ambientBuffers.set(trackFile, decoded);
        return decoded;
      } catch (e) {}
    }
    return null;
  })();
  ambientLoadingTasks.set(trackFile, task);
  return task;
}

function clearAmbientTimers() {
  if (ambientFadeTimer) {
    clearInterval(ambientFadeTimer);
    ambientFadeTimer = null;
  }
  if (ambientStopTimer) {
    clearTimeout(ambientStopTimer);
    ambientStopTimer = null;
  }
}

function stopFallbackAmbientAudio(immediate) {
  if (!ambientFallbackAudio) return;
  const aud = ambientFallbackAudio;
  if (immediate) {
    clearAmbientTimers();
    try { aud.pause(); aud.currentTime = 0; } catch (e) {}
    ambientFallbackAudio = null;
    return;
  }
  clearAmbientTimers();
  ambientFadeTimer = setInterval(() => {
    try {
      if (aud.volume <= 0.02) {
        clearAmbientTimers();
        aud.pause();
        aud.volume = 0;
        if (ambientFallbackAudio === aud) ambientFallbackAudio = null;
      } else {
        aud.volume = Math.max(0, aud.volume - 0.025);
      }
    } catch (e) {
      clearAmbientTimers();
    }
  }, 45);
}

function stopCurrentAmbientPlayback(immediate = false) {
  ambientPlaying = false;
  clearAmbientTimers();

  if (ambientSourceNode && ambientGainNode && grindAudioCtx) {
    const src = ambientSourceNode;
    const gain = ambientGainNode;
    ambientSourceNode = null;
    ambientGainNode = null;
    const now = grindAudioCtx.currentTime;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      if (immediate) {
        gain.gain.setValueAtTime(0, now);
        src.stop();
      } else {
        gain.gain.linearRampToValueAtTime(0.0001, now + 0.55);
        ambientStopTimer = setTimeout(() => {
          try { src.stop(); } catch (e) {}
        }, 600);
      }
    } catch (e) {
      try { src.stop(); } catch (err) {}
    }
  }

  stopFallbackAmbientAudio(immediate);
}

function stopPremiumAmbientMusic(immediate = false) {
  ambientDesired = false;
  ambientCurrentTrackFile = null;
  stopCurrentAmbientPlayback(immediate);
  renderMusicSettings();
}

async function startPremiumAmbientMusic() {
  const track = getPremiumMusicTrackForTheme(getActiveThemeId());
  if (!track || !shouldPlayPremiumAmbientMusic()) {
    stopPremiumAmbientMusic(false);
    return;
  }

  const targetFile = track.file;
  const switchingTrack = Boolean(ambientCurrentTrackFile && ambientCurrentTrackFile !== targetFile);
  if (switchingTrack) {
    stopCurrentAmbientPlayback(true);
  }

  ambientDesired = true;
  ambientCurrentTrackFile = targetFile;
  clearAmbientTimers();

  const ctx = ensureGrindAudioCtx();
  if (ctx && ctx.state === 'running') {
    const buf = await loadAmbientMusicBuffer(targetFile);
    if (!ambientDesired || !shouldPlayPremiumAmbientMusic()) return;
    if (getPremiumMusicTrackForTheme(getActiveThemeId())?.file !== targetFile) return;
    if (buf) {
      stopFallbackAmbientAudio(true);
      if (ambientSourceNode && ambientGainNode && ambientCurrentTrackFile === targetFile) {
        const now = ctx.currentTime;
        ambientGainNode.gain.cancelScheduledValues(now);
        ambientGainNode.gain.setValueAtTime(ambientGainNode.gain.value, now);
        ambientGainNode.gain.linearRampToValueAtTime(AMBIENT_TARGET_GAIN, now + 0.9);
        ambientPlaying = true;
        renderMusicSettings();
        return;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(AMBIENT_TARGET_GAIN, now + 1.15);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(0);
      ambientSourceNode = src;
      ambientGainNode = gain;
      ambientPlaying = true;
      renderMusicSettings();
      return;
    }
  }

  // Fallback HTMLAudio if AudioContext isn't ready/suspended yet or buffer still loading
  try {
    if (!ambientFallbackAudio || switchingTrack || ambientFallbackAudio.dataset.track !== targetFile) {
      if (ambientFallbackAudio) {
        try { ambientFallbackAudio.pause(); } catch (e) {}
      }
      ambientFallbackAudio = new Audio(`sounds/${targetFile}.mp3`);
      ambientFallbackAudio.dataset.track = targetFile;
      ambientFallbackAudio.loop = true;
      ambientFallbackAudio.volume = 0;
    }
    await ambientFallbackAudio.play();
    if (!ambientDesired || !shouldPlayPremiumAmbientMusic()) {
      stopFallbackAmbientAudio(true);
      return;
    }
    if (getPremiumMusicTrackForTheme(getActiveThemeId())?.file !== targetFile) {
      stopFallbackAmbientAudio(true);
      return;
    }
    ambientPlaying = true;
    renderMusicSettings();
    ambientFadeTimer = setInterval(() => {
      if (!ambientFallbackAudio || !ambientDesired) {
        clearAmbientTimers();
        return;
      }
      if (ambientFallbackAudio.volume >= AMBIENT_TARGET_GAIN - 0.01) {
        ambientFallbackAudio.volume = AMBIENT_TARGET_GAIN;
        clearAmbientTimers();
      } else {
        ambientFallbackAudio.volume = Math.min(AMBIENT_TARGET_GAIN, ambientFallbackAudio.volume + 0.02);
      }
    }, 55);
  } catch (e) {
    ambientPlaying = false;
    renderMusicSettings();
  }
}

function syncPremiumAmbientMusic() {
  if (shouldPlayPremiumAmbientMusic()) {
    startPremiumAmbientMusic();
  } else {
    stopPremiumAmbientMusic(false);
  }
}

function handleUserGestureForAmbientMusic() {
  if (!shouldPlayPremiumAmbientMusic()) return;
  const ctx = ensureGrindAudioCtx();
  const targetFile = getPremiumMusicTrackForTheme(getActiveThemeId())?.file || null;
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => {
      if (shouldPlayPremiumAmbientMusic()) startPremiumAmbientMusic();
    }).catch(() => {});
  } else if (!ambientPlaying || ambientCurrentTrackFile !== targetFile || (ambientBuffers.has(targetFile) && !ambientSourceNode)) {
    startPremiumAmbientMusic();
  }
}

window.addEventListener('keydown', () => {
  handleUserGestureForAmbientMusic();
}, { passive: true });

function renderMusicSettings() {
  const toggleBtn = $('#ambientMusicToggleBtn');
  const toggleLabel = $('#ambientMusicToggleLabel');
  const eqBars = $('#musicEqBars');
  const pill = $('#musicStatePill');
  const titleEl = $('#musicTrackTitle');
  const desc = $('#musicStatusDesc');
  if (!toggleBtn) return;

  const enabled = isUserMusicEnabled();
  const activeTheme = getActiveThemeId();
  const activeTrack = getPremiumMusicTrackForTheme(activeTheme);
  const onPremiumTheme = Boolean(activeTrack);
  const pausedForPlay = currentPage === 'play';

  toggleBtn.classList.toggle('active', enabled);
  toggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  if (toggleLabel) {
    toggleLabel.textContent = enabled ? 'Music: On' : 'Music: Off';
  }
  if (titleEl) {
    titleEl.textContent = activeTrack ? activeTrack.title : 'Obsidian Lounge — Soothing Ambient';
  }

  const activelyPlaying = Boolean(enabled && onPremiumTheme && !pausedForPlay && ambientPlaying);
  eqBars?.classList.toggle('playing', activelyPlaying);

  if (pill) {
    pill.classList.remove('playing', 'ready');
    if (!enabled) {
      pill.textContent = 'Muted';
    } else if (pausedForPlay) {
      pill.textContent = 'Paused (Play)';
      pill.classList.add('ready');
    } else if (activelyPlaying) {
      pill.textContent = 'Playing';
      pill.classList.add('playing');
    } else if (onPremiumTheme) {
      pill.textContent = 'Tap to Play';
      pill.classList.add('ready');
    } else {
      pill.textContent = 'PREMIUM Theme Only';
    }
  }

  if (desc) {
    if (!enabled) {
      desc.textContent = 'Background music is turned off for your account.';
    } else if (activeTheme === 'rose-amethyst') {
      desc.textContent = activelyPlaying
        ? 'Now playing Velvet Crystal ambient soundtrack for Rose & Amethyst.'
        : 'Enabled — Velvet Crystal ambient music plays while Rose & Amethyst is active.';
    } else if (onPremiumTheme) {
      desc.textContent = activelyPlaying
        ? 'Now playing soothing ambient lounge music for your PREMIUM theme.'
        : 'Enabled — soothing ambient music plays while Sapphire & Obsidian or Gold & Platinum is active.';
    } else {
      desc.textContent = 'Switch to a PREMIUM theme above (Sapphire & Obsidian, Gold & Platinum, or Rose & Amethyst) to hear its soundtrack.';
    }
  }
}

$('#ambientMusicToggleBtn')?.addEventListener('click', () => {
  if (!currentUser?.id) return;
  const next = !isUserMusicEnabled();
  setUserMusicEnabled(next);
  renderMusicSettings();
  syncPremiumAmbientMusic();
  toast(next ? 'Ambient music turned on' : 'Ambient music turned off');
});

// ============================================================
// ---------- SMOOTH MODAL CLOSE & REWARD BURST ENGINE --------
// ============================================================
function hideModalSmooth(modalEl) {
  if (!modalEl || modalEl.classList.contains('hidden')) return;
  if (modalEl.id === 'dmModal' && typeof stopOutgoingDmTyping === 'function') {
    stopOutgoingDmTyping();
    setDmCoinPickerOpen(false);
  }
  if (modalEl.classList.contains('modal-closing')) return;
  modalEl.classList.add('modal-closing');
  setTimeout(() => {
    modalEl.classList.add('hidden');
    modalEl.classList.remove('modal-closing');
  }, 175);
}

function triggerRewardBurstAnimation(sourceEl, amountLabel, subtitleLabel) {
  const layer = $('#rewardBurstLayer');
  if (!layer) return;

  playSound('buy');

  let originX = window.innerWidth / 2;
  let originY = window.innerHeight * 0.56;
  if (sourceEl && typeof sourceEl.getBoundingClientRect === 'function') {
    const r = sourceEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      originX = r.left + r.width / 2;
      originY = r.top + r.height / 2;
    }
  }

  let targetX = window.innerWidth - 135;
  let targetY = 36;
  const cashPill = $('.cash-pill');
  if (cashPill) {
    const cr = cashPill.getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) {
      targetX = cr.left + cr.width / 2;
      targetY = cr.top + cr.height / 2;
    }
  }

  // Radial golden shockwave at reward source
  const ring = document.createElement('div');
  ring.className = 'reward-shock-ring';
  ring.style.left = `${originX}px`;
  ring.style.top = `${originY}px`;
  layer.appendChild(ring);
  setTimeout(() => ring.remove(), 800);

  // Radiating emerald & gold sparks
  const sparkColors = ['#fde047', '#34d399', '#6ee7b7', '#fbbf24', '#ffffff'];
  for (let i = 0; i < 20; i++) {
    const sp = document.createElement('span');
    sp.className = 'reward-spark';
    const ang = (Math.PI * 2 * i) / 20 + (Math.random() - 0.5) * 0.25;
    const dist = 48 + Math.random() * 92;
    sp.style.left = `${originX}px`;
    sp.style.top = `${originY}px`;
    sp.style.setProperty('--rx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
    sp.style.setProperty('--ry', `${(Math.sin(ang) * dist).toFixed(1)}px`);
    sp.style.setProperty('--rdur', `${(0.54 + Math.random() * 0.34).toFixed(2)}s`);
    sp.style.setProperty('--rcolor', sparkColors[i % sparkColors.length]);
    layer.appendChild(sp);
    setTimeout(() => sp.remove(), 950);
  }

  // Arcing golden coins flying into wallet cash pill
  const coinCount = 12;
  for (let i = 0; i < coinCount; i++) {
    const coinEl = document.createElement('div');
    coinEl.className = 'reward-fly-coin';
    coinEl.textContent = '$';
    const sx = originX + (Math.random() - 0.5) * 38;
    const sy = originY + (Math.random() - 0.5) * 24;
    const ctrlX = (sx + targetX) * 0.5 + (Math.random() - 0.5) * 180;
    const ctrlY = Math.min(sy, targetY) - (60 + Math.random() * 110);
    const delay = i * 38;
    const dur = 640 + Math.random() * 180;
    coinEl.style.left = `${sx}px`;
    coinEl.style.top = `${sy}px`;
    coinEl.style.opacity = '0';
    layer.appendChild(coinEl);

    const animStart = performance.now() + delay;
    const tick = now => {
      if (now < animStart) {
        requestAnimationFrame(tick);
        return;
      }
      const raw = Math.min(1, (now - animStart) / dur);
      const t = 1 - Math.pow(1 - raw, 2.2);
      const inv = 1 - t;
      const x = inv * inv * sx + 2 * inv * t * ctrlX + t * t * targetX;
      const y = inv * inv * sy + 2 * inv * t * ctrlY + t * t * targetY;
      const sc = raw < 0.2 ? 0.6 + raw * 2.5 : 1.1 - t * 0.45;
      coinEl.style.left = `${x}px`;
      coinEl.style.top = `${y}px`;
      coinEl.style.opacity = raw > 0.88 ? String(Math.max(0, (1 - raw) / 0.12)) : '1';
      coinEl.style.transform = `translate(-50%, -50%) scale(${sc.toFixed(3)})`;
      if (raw < 1) {
        requestAnimationFrame(tick);
      } else {
        coinEl.remove();
        if (i === coinCount - 1 && cashPill) {
          cashPill.classList.remove('cash-pulse');
          void cashPill.offsetWidth;
          cashPill.classList.add('cash-pulse');
        }
      }
    };
    requestAnimationFrame(tick);
  }

  // Luxury floating claim banner
  const banner = document.createElement('div');
  banner.className = 'reward-banner-pill';
  banner.style.left = `${Math.min(window.innerWidth - 150, Math.max(150, originX))}px`;
  banner.style.top = `${Math.max(96, originY - 38)}px`;
  banner.innerHTML = `
    <span>✦ ${escapeHtml(subtitleLabel || 'Reward Claimed')}</span>
    <span class="reward-banner-amt">${escapeHtml(amountLabel || '')}</span>
  `;
  layer.appendChild(banner);
  setTimeout(() => banner.remove(), 1700);
}

// ============================================================
// ---------- COIN TIMELINE "WATCH" CUTSCENE ENGINE -----------
// ============================================================
const watchState = {
  coin: null,
  points: [],      // { price, trade, ts, tNorm }
  rafId: null,
  playing: false,
  speed: 1,
  progress: 0,     // 0..1
  durationMs: 12000,
  lastTickMs: 0,
  lastEventIdx: -1,
  shownBubbleIndices: new Set()
};

function formatTimelineMoment(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function stopWatchLoop() {
  if (watchState.rafId) {
    cancelAnimationFrame(watchState.rafId);
    watchState.rafId = null;
  }
  watchState.playing = false;
  const playBtn = $('#watchPlayPauseBtn');
  if (playBtn) playBtn.textContent = watchState.progress >= 0.999 ? '↺ Replay' : '▶ Play';
}

function closeCoinWatchModal(immediate = false) {
  stopWatchLoop();
  const modal = $('#coinWatchModal');
  if (!modal) return;
  if (immediate) modal.classList.add('hidden');
  else hideModalSmooth(modal);
}

async function openCoinWatchModal(coin) {
  if (!coin || !sb) return;
  const modal = $('#coinWatchModal');
  if (!modal) return;

  stopWatchLoop();
  watchState.coin = coin;
  watchState.progress = 0;
  watchState.lastEventIdx = -1;
  watchState.shownBubbleIndices.clear();

  const logoEl = $('#watchCoinLogo');
  if (logoEl) {
    logoEl.innerHTML = coin.image_url ? `<img src="${escapeHtml(coin.image_url)}">` : escapeHtml((coin.ticker || '?')[0]);
  }
  if ($('#watchCoinTitle')) $('#watchCoinTitle').textContent = `${coin.name} ($${coin.ticker})`;
  if ($('#watchStatusEyebrow')) $('#watchStatusEyebrow').textContent = 'TIMELINE CUTSCENE';
  if ($('#watchPriceReadout')) $('#watchPriceReadout').textContent = priceFmt(1);
  if ($('#watchPctReadout')) {
    $('#watchPctReadout').textContent = '+0.00% vs $1.00';
    $('#watchPctReadout').className = 'watch-pct-readout flat';
  }
  if ($('#watchTimeBadge')) $('#watchTimeBadge').textContent = 'Loading history...';
  if ($('#watchEventTicker')) $('#watchEventTicker').textContent = 'Fetching complete trade timeline...';
  if ($('#watchBubblesLayer')) $('#watchBubblesLayer').innerHTML = '';

  modal.classList.remove('hidden');

  // Fetch COMPLETE chronological trade history for this coin
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const { data: fullTrades } = await sb
    .from('trades')
    .select('id, coin_id, user_id, type, amount_usd, shares, price_after, created_at, profiles(username, is_premium)')
    .eq('coin_id', coin.id)
    .order('created_at', { ascending: true })
    .limit(1000);
  await ensureProfilesCached((fullTrades || []).map(t => t.user_id).filter(Boolean));

  const tradeMap = new Map();
  (fullTrades || []).forEach(t => {
    const tMs = new Date(t.created_at || 0).getTime();
    if (srvResetTs > 0 && tMs <= srvResetTs) return;
    tradeMap.set(t.id || (t.created_at + t.shares), {
      ...t,
      profiles: t.user_id ? getCachedProfile(t.user_id, t.profiles) : t.profiles
    });
  });
  (coin.localTrades || []).forEach(t => {
    const tMs = new Date(t.created_at || 0).getTime();
    if (srvResetTs > 0 && tMs <= srvResetTs) return;
    tradeMap.set(t.id || (t.created_at + t.shares), t);
  });

  const sortedTrades = Array.from(tradeMap.values())
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

  const createdTs = coin.created_at
    ? new Date(coin.created_at).getTime()
    : (sortedTrades[0]?.created_at ? new Date(sortedTrades[0].created_at).getTime() - 5000 : Date.now() - 5000);

  const rawPoints = [{ price: 1, trade: null, ts: createdTs }];
  sortedTrades.forEach(t => {
    rawPoints.push({
      price: Number(t.price_after) || Number(coin.price) || 1,
      trade: t,
      ts: t.created_at ? new Date(t.created_at).getTime() : createdTs
    });
  });

  // Always conclude cleanly on current live coin price
  const currentPriceNum = Number(coin.price || 1);
  if (rawPoints.length === 1) {
    rawPoints.push({ price: currentPriceNum, trade: null, ts: Date.now(), isCurrentAnchor: true });
  } else if (Math.abs(rawPoints[rawPoints.length - 1].price - currentPriceNum) > 1e-4) {
    rawPoints.push({ price: currentPriceNum, trade: null, ts: Date.now(), isCurrentAnchor: true });
  }

  // Realistic compressed-time spacing between purchases/sells:
  // Uses power compression dt^0.42 so long idle periods feel realistically spaced without stalling,
  // while rapid back-to-back trades happen briskly!
  const segWeights = [];
  for (let i = 1; i < rawPoints.length; i++) {
    const dtMs = Math.max(1200, (rawPoints[i].ts || 0) - (rawPoints[i - 1].ts || 0));
    segWeights.push(Math.pow(dtMs, 0.42));
  }
  const totalWeight = segWeights.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  rawPoints[0].tNorm = 0;
  for (let i = 1; i < rawPoints.length; i++) {
    acc += segWeights[i - 1];
    rawPoints[i].tNorm = acc / totalWeight;
  }
  rawPoints[rawPoints.length - 1].tNorm = 1;

  watchState.points = rawPoints;
  watchState.durationMs = Math.min(18500, Math.max(6500, 5200 + sortedTrades.length * 420));
  watchState.speed = 1;
  $$('[data-watch-speed]').forEach(b => b.classList.toggle('active', b.dataset.watchSpeed === '1'));

  startWatchPlayback(0);
}

function renderWatchFrame(progress) {
  const canvas = $('#watchChartCanvas');
  const stage = canvas?.parentElement;
  const bubblesLayer = $('#watchBubblesLayer');
  const pts = watchState.points;
  const coin = watchState.coin;
  if (!canvas || !stage || !pts.length || !coin) return;

  const W = Math.max(stage.clientWidth || 640, 320);
  const H = stage.clientHeight || 330;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const p = Math.min(1, Math.max(0, progress));
  const slider = $('#watchProgressRange');
  if (slider) slider.value = String(Math.round(p * 1000));

  // Find current segment along realistic tNorm timeline
  let segIdx = 0;
  for (let i = 1; i < pts.length; i++) {
    if (p <= pts[i].tNorm || i === pts.length - 1) {
      segIdx = i - 1;
      break;
    }
  }
  const p0 = pts[segIdx];
  const p1 = pts[Math.min(pts.length - 1, segIdx + 1)];
  const span = Math.max(1e-6, (p1.tNorm || 1) - (p0.tNorm || 0));
  const localAlpha = Math.min(1, Math.max(0, (p - (p0.tNorm || 0)) / span));
  const curPrice = p0.price + (p1.price - p0.price) * localAlpha;
  const curTs = (p0.ts || 0) + ((p1.ts || p0.ts || 0) - (p0.ts || 0)) * localAlpha;

  // Dynamic smooth Y-range around revealed points so climbs & crashes look dramatic and legible
  const revealedCount = p >= 0.999 ? pts.length : segIdx + 1;
  const revealedPrices = pts.slice(0, revealedCount).map(pt => pt.price);
  revealedPrices.push(curPrice);
  let minP = Math.min(...revealedPrices);
  let maxP = Math.max(...revealedPrices);
  if (maxP - minP < Math.max(0.15, maxP * 0.08)) {
    const mid = (maxP + minP) / 2;
    minP = Math.max(0.01, mid * 0.9);
    maxP = mid * 1.12;
  } else {
    const pad = (maxP - minP) * 0.14;
    minP = Math.max(0.001, minP - pad);
    maxP += pad;
  }

  const PAD_X = 52;
  const PAD_TOP = 64;
  const PAD_BOT = 28;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_TOP - PAD_BOT;
  const xAtNorm = tn => PAD_X + tn * plotW;
  const yAtPrice = pr => PAD_TOP + plotH - ((pr - minP) / Math.max(1e-6, maxP - minP)) * plotH;

  // Background horizontal grid + price axis
  ctx.font = '11px sans-serif';
  ctx.fillStyle = 'rgba(190, 165, 225, 0.62)';
  ctx.strokeStyle = 'rgba(190, 165, 225, 0.11)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = PAD_TOP + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    const val = maxP - ((maxP - minP) * i) / 4;
    ctx.fillText('$' + val.toFixed(val < 1 ? 3 : 2), 6, y - 4);
  }

  // Build path up to current cursor
  const curX = xAtNorm(p);
  const curY = yAtPrice(curPrice);
  const rawAccent = (getComputedStyle(document.body).getPropertyValue('--purple') || '').trim() || '#c084fc';
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(rawAccent) ? rawAccent : '#c084fc';

  // Subtle gradient fill beneath curve
  const fillGrad = ctx.createLinearGradient(0, PAD_TOP, 0, H - PAD_BOT);
  fillGrad.addColorStop(0, accentColor + '44');
  fillGrad.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.beginPath();
  ctx.moveTo(xAtNorm(0), yAtPrice(pts[0].price));
  for (let i = 1; i < revealedCount; i++) {
    ctx.lineTo(xAtNorm(pts[i].tNorm), yAtPrice(pts[i].price));
  }
  ctx.lineTo(curX, curY);
  ctx.lineTo(curX, H - PAD_BOT);
  ctx.lineTo(xAtNorm(0), H - PAD_BOT);
  ctx.closePath();
  ctx.fillStyle = fillGrad;
  ctx.fill();

  // Crisp glowing curve stroke
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xAtNorm(0), yAtPrice(pts[0].price));
  for (let i = 1; i < revealedCount; i++) {
    ctx.lineTo(xAtNorm(pts[i].tNorm), yAtPrice(pts[i].price));
  }
  ctx.lineTo(curX, curY);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3.2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.restore();

  // Dots for reached trades
  for (let i = 0; i < revealedCount; i++) {
    const pt = pts[i];
    ctx.beginPath();
    ctx.arc(xAtNorm(pt.tNorm), yAtPrice(pt.price), pt.trade ? 4 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = pt.trade ? (pt.trade.type === 'sell' ? '#f87171' : '#34d399') : '#e9d5ff';
    ctx.fill();
  }

  // Pulsing live playhead cursor
  ctx.beginPath();
  ctx.arc(curX, curY, 9, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(curX, curY, 4.8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // Keep trader avatar bubbles synced cleanly for all reached trades
  if (bubblesLayer) {
    bubblesLayer.innerHTML = '';
    const maxBubblesToShow = 28;
    const reachedTradeIndices = [];
    for (let i = 1; i < revealedCount; i++) {
      if (pts[i].trade) reachedTradeIndices.push(i);
    }
    const visibleTradeIndices = reachedTradeIndices.slice(-maxBubblesToShow);
    visibleTradeIndices.forEach(idx => {
      const pt = pts[idx];
      const t = pt.trade;
      const isBuy = t.type !== 'sell';
      const name = t.profiles?.username || (t.user_id === currentUser?.id ? currentUser.username : 'Someone');
      const avatar = t.profiles?.avatar_url || (t.user_id === currentUser?.id ? currentUser.avatar_url : null);
      const amt = Number(t.amount_usd || 0);
      const b = document.createElement('div');
      const isNewlyPopped = !watchState.shownBubbleIndices.has(idx);
      if (isNewlyPopped) watchState.shownBubbleIndices.add(idx);
      b.className = `bubble ${isBuy ? 'buy' : 'sell'} ${isNewlyPopped ? 'watch-bubble-pop' : ''}`;
      b.style.left = `${xAtNorm(pt.tNorm)}px`;
      b.style.top = `${Math.max(48, yAtPrice(pt.price) - 8)}px`;
      b.innerHTML = `
        <div class="bubble-pfp">${avatar ? `<img src="${escapeHtml(avatar)}">` : `<span>${escapeHtml(name[0].toUpperCase())}</span>`}</div>
        <div class="bubble-amt">${isBuy ? '' : '−'}${money(amt)}</div>
      `;
      bubblesLayer.appendChild(b);
    });
  }

  // Update header readout metrics
  const priceEl = $('#watchPriceReadout');
  const pctEl = $('#watchPctReadout');
  const timeEl = $('#watchTimeBadge');
  const tickerEl = $('#watchEventTicker');
  if (priceEl) {
    priceEl.textContent = priceFmt(curPrice);
    priceEl.classList.toggle('pulse-up', curPrice > 1.005);
    priceEl.classList.toggle('pulse-down', curPrice < 0.995);
  }
  if (pctEl) {
    const pct = ((curPrice - 1) / 1) * 100;
    const sign = pct >= 0 ? '+' : '';
    pctEl.textContent = `${sign}${pct.toFixed(2)}% vs $1.00`;
    pctEl.className = `watch-pct-readout ${pct > 0.05 ? 'up' : pct < -0.05 ? 'down' : 'flat'}`;
  }
  if (timeEl) {
    timeEl.textContent = p >= 0.999 ? `Now · Current Price` : formatTimelineMoment(curTs);
  }

  const latestIdx = revealedCount - 1;
  if (tickerEl) {
    if (p >= 0.999) {
      tickerEl.textContent = `Current price: ${priceFmt(coin.price)} · ${pts.filter(x => x.trade).length} total trades`;
    } else if (latestIdx > 0 && pts[latestIdx]?.trade) {
      const tr = pts[latestIdx].trade;
      const actor = tr.profiles?.username || (tr.user_id === currentUser?.id ? currentUser.username : 'Trader');
      const verb = tr.type === 'sell' ? 'sold' : 'bought';
      tickerEl.textContent = `${actor} ${verb} ${money(tr.amount_usd || 0)} → ${priceFmt(tr.price_after || curPrice)}`;
    } else {
      tickerEl.textContent = `Launched $${coin.ticker} at $1.00`;
    }
  }
}

function startWatchPlayback(fromProgress = watchState.progress) {
  if (watchState.rafId) {
    cancelAnimationFrame(watchState.rafId);
    watchState.rafId = null;
  }
  watchState.progress = Math.min(1, Math.max(0, fromProgress));
  if (watchState.progress >= 0.999) {
    watchState.progress = 0;
    watchState.shownBubbleIndices.clear();
  }
  watchState.playing = true;
  watchState.lastTickMs = performance.now();
  const playBtn = $('#watchPlayPauseBtn');
  if (playBtn) playBtn.textContent = '⏸ Pause';

  const step = now => {
    if (!watchState.playing) return;
    const dt = Math.max(0, Math.min(80, now - watchState.lastTickMs));
    watchState.lastTickMs = now;
    watchState.progress = Math.min(1, watchState.progress + (dt * watchState.speed) / watchState.durationMs);
    renderWatchFrame(watchState.progress);
    if (watchState.progress >= 1) {
      stopWatchLoop();
      return;
    }
    watchState.rafId = requestAnimationFrame(step);
  };
  renderWatchFrame(watchState.progress);
  watchState.rafId = requestAnimationFrame(step);
}

$('#closeWatchModalBtn')?.addEventListener('click', () => closeCoinWatchModal(false));
$('#coinWatchModal')?.addEventListener('click', e => {
  if (e.target === $('#coinWatchModal')) closeCoinWatchModal(false);
});
$('#watchPlayPauseBtn')?.addEventListener('click', () => {
  if (watchState.playing) {
    stopWatchLoop();
  } else {
    startWatchPlayback(watchState.progress >= 0.999 ? 0 : watchState.progress);
  }
});
$('#watchReplayBtn')?.addEventListener('click', () => {
  watchState.shownBubbleIndices.clear();
  startWatchPlayback(0);
});
$('#watchProgressRange')?.addEventListener('input', e => {
  const val = Number(e.target.value || 0) / 1000;
  stopWatchLoop();
  watchState.progress = val;
  watchState.shownBubbleIndices.clear();
  renderWatchFrame(val);
});
$$('[data-watch-speed]').forEach(btn => {
  btn.addEventListener('click', () => {
    const spd = Number(btn.dataset.watchSpeed || 1);
    watchState.speed = spd;
    $$('[data-watch-speed]').forEach(b => b.classList.toggle('active', b === btn));
  });
});

// ============================================================
// ---------- PRIVATE DIRECT MESSAGES (DMs) -------------------
// ============================================================
const dmState = {
  profilesMap: new Map(),   // userId -> profile
  rawRows: [],              // cached __DM_% rows for incremental sync
  rawRowIds: new Set(),
  lastRowCreatedAt: '',
  messagesByPartner: new Map(), // partnerId -> [{ id, from, to, type, text, ts, ... }]
  partnerReadTsByPartner: new Map(), // partnerId -> latest message ts partner opened/read
  lastSentReadByPartner: new Map(), // partnerId -> latest incoming ts we already acked
  typingUntilByPartner: new Map(), // partnerId -> expiry ts
  typingClearTimers: new Map(), // partnerId -> timeoutId
  lastTypingSentAt: 0,
  lastTypingTargetId: null,
  typingStopTimer: null,
  activePartnerId: null,
  searchQuery: '',
  totalUnread: 0,
  lastUnreadNotifiedCount: 0,
  coinPickerOpen: false,
  attachTab: 'coins', // 'coins' | 'gifs'
  coinSearchQuery: '',
  gifSearchQuery: '',
  sendingCoin: false,
  sendingGif: false
};

function getDmSeenKey(myId, partnerId) {
  return `grind_dm_seen_${myId}_${partnerId}`;
}

function getDmSentReadKey(myId, partnerId) {
  return `grind_dm_sent_read_${myId}_${partnerId}`;
}

function getDmSeenTs(partnerId) {
  if (!currentUser?.id || !partnerId) return 0;
  try {
    return Number(localStorage.getItem(getDmSeenKey(currentUser.id, partnerId)) || 0);
  } catch (e) {
    return 0;
  }
}

function getDmSentReadWatermark(partnerId) {
  if (!currentUser?.id || !partnerId) return 0;
  const pid = String(partnerId);
  const mem = dmState.lastSentReadByPartner.get(pid) || 0;
  let ls = 0;
  try {
    ls = Number(localStorage.getItem(getDmSentReadKey(currentUser.id, pid)) || 0);
  } catch (e) {}
  return Math.max(mem, ls);
}

function setDmSentReadWatermark(partnerId, ts) {
  if (!currentUser?.id || !partnerId) return;
  const pid = String(partnerId);
  const next = Math.max(getDmSentReadWatermark(pid), Number(ts) || 0);
  dmState.lastSentReadByPartner.set(pid, next);
  try {
    localStorage.setItem(getDmSentReadKey(currentUser.id, pid), String(next));
  } catch (e) {}
}

function markDmThreadSeen(partnerId, latestTs = Date.now()) {
  if (!currentUser?.id || !partnerId) return;
  try {
    const prev = getDmSeenTs(partnerId);
    const next = Math.max(prev, Number(latestTs) || 0, Date.now());
    localStorage.setItem(getDmSeenKey(currentUser.id, partnerId), String(next));
  } catch (e) {}
  updateDmUnreadBadge();
}

function isDmPartnerTyping(partnerId) {
  if (!partnerId) return false;
  const exp = dmState.typingUntilByPartner.get(String(partnerId)) || 0;
  return exp > Date.now();
}

function emitDmTyping(isTyping, targetPartnerId = dmState.activePartnerId) {
  if (!realtimeChannel || !currentUser?.id || !targetPartnerId) return;
  try {
    realtimeChannel.send({
      type: 'broadcast',
      event: 'dm_typing',
      payload: {
        from: String(currentUser.id),
        to: String(targetPartnerId),
        typing: Boolean(isTyping),
        ts: Date.now()
      }
    });
  } catch (e) {}
}

function stopOutgoingDmTyping(targetId = dmState.lastTypingTargetId) {
  clearTimeout(dmState.typingStopTimer);
  dmState.typingStopTimer = null;
  if (targetId) {
    emitDmTyping(false, targetId);
  }
  dmState.lastTypingSentAt = 0;
  dmState.lastTypingTargetId = null;
}

function renderDmTypingUi() {
  const dmModalOpen = !$('#dmModal')?.classList.contains('hidden');
  if (!dmModalOpen) return;

  const typingRow = $('#dmTypingRow');
  const statusEl = $('#dmChatHeaderStatus');
  const partnerId = dmState.activePartnerId ? String(dmState.activePartnerId) : null;
  const activeTyping = partnerId ? isDmPartnerTyping(partnerId) : false;

  if (statusEl) {
    if (activeTyping) {
      statusEl.textContent = 'typing...';
      statusEl.classList.add('is-typing');
    } else {
      statusEl.textContent = 'Private DM · Click to view profile';
      statusEl.classList.remove('is-typing');
    }
  }

  if (typingRow) {
    if (partnerId && activeTyping) {
      const p = getDmPartnerProfile(partnerId);
      typingRow.classList.remove('hidden');
      typingRow.innerHTML = `
        <div class="dm-typing-indicator">
          <span class="dm-typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span><strong>${escapeHtml(p.username || 'Trader')}</strong> is typing...</span>
        </div>
      `;
    } else {
      typingRow.classList.add('hidden');
      typingRow.innerHTML = '';
    }
  }

  renderDmSidebar();
}

function handleIncomingDmTyping(payload) {
  if (!payload || !currentUser?.id) return;
  const myId = String(currentUser.id);
  const fromId = String(payload.from || '');
  const toId = String(payload.to || '');
  if (!fromId || fromId === myId || toId !== myId) return;

  const existingTimer = dmState.typingClearTimers.get(fromId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    dmState.typingClearTimers.delete(fromId);
  }

  if (payload.typing) {
    dmState.typingUntilByPartner.set(fromId, Date.now() + 3600);
    const tid = setTimeout(() => {
      dmState.typingUntilByPartner.delete(fromId);
      dmState.typingClearTimers.delete(fromId);
      renderDmTypingUi();
    }, 3700);
    dmState.typingClearTimers.set(fromId, tid);
  } else {
    dmState.typingUntilByPartner.delete(fromId);
  }

  renderDmTypingUi();
}

function handleIncomingDmRead(payload) {
  if (!payload || !currentUser?.id) return;
  const myId = String(currentUser.id);
  const fromId = String(payload.from || '');
  const toId = String(payload.to || '');
  const seenTs = Number(payload.seenTs || 0);
  if (!fromId || fromId === myId || toId !== myId || seenTs <= 0) return;

  const prev = dmState.partnerReadTsByPartner.get(fromId) || 0;
  if (seenTs > prev) {
    dmState.partnerReadTsByPartner.set(fromId, seenTs);
  }
  const dmModalOpen = !$('#dmModal')?.classList.contains('hidden');
  if (dmModalOpen && dmState.activePartnerId === fromId) {
    renderDmThread();
  }
}

async function syncDmReadReceipt(partnerId) {
  if (!sb || !currentUser?.id || !partnerId) return;
  const myId = String(currentUser.id);
  const pid = String(partnerId);
  const msgs = dmState.messagesByPartner.get(pid) || [];
  let latestTheirMsgTs = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].from === pid) {
      latestTheirMsgTs = Math.max(latestTheirMsgTs, Number(msgs[i].ts) || 0);
      break;
    }
  }
  if (!latestTheirMsgTs) return;

  const alreadySentTs = getDmSentReadWatermark(pid);
  if (latestTheirMsgTs <= alreadySentTs) return;

  setDmSentReadWatermark(pid, latestTheirMsgTs);

  if (realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'dm_read',
        payload: { from: myId, to: pid, seenTs: latestTheirMsgTs }
      });
    } catch (e) {}
  }

  try {
    await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__DM_READ__:' + JSON.stringify({ to: pid, seenTs: latestTheirMsgTs, ts: Date.now() }),
      status: 'denied'
    });
  } catch (e) {}
}

function updateDmUnreadBadge() {
  const badge = $('#dmUnreadBadge');
  if (!badge) return;
  if (!currentUser?.id) {
    badge.classList.add('hidden');
    return;
  }
  let unread = 0;
  const uid = String(currentUser.id);
  dmState.messagesByPartner.forEach((msgs, partnerId) => {
    const seen = getDmSeenTs(partnerId);
    msgs.forEach(m => {
      if (m.from !== uid && m.ts > seen) unread += 1;
    });
  });
  dmState.totalUnread = unread;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function setDmAttachTab(tab = 'coins') {
  dmState.attachTab = tab === 'gifs' ? 'gifs' : 'coins';
  const coinsTab = $('#dmAttachCoinsTab');
  const gifsTab = $('#dmAttachGifsTab');
  const coinPane = $('#dmCoinPane');
  const gifPane = $('#dmGifPane');
  const titleEl = $('#dmAttachPickerTitle');
  const subEl = $('#dmAttachPickerSubtitle');

  const isGif = dmState.attachTab === 'gifs';
  if (coinsTab) {
    coinsTab.classList.toggle('active', !isGif);
    coinsTab.setAttribute('aria-selected', !isGif ? 'true' : 'false');
  }
  if (gifsTab) {
    gifsTab.classList.toggle('active', isGif);
    gifsTab.setAttribute('aria-selected', isGif ? 'true' : 'false');
  }
  if (coinPane) coinPane.classList.toggle('hidden', isGif);
  if (gifPane) gifPane.classList.toggle('hidden', !isGif);
  if (titleEl) titleEl.textContent = isGif ? 'Send a GIF' : 'Share a Coin';
  if (subEl) {
    subEl.textContent = isGif
      ? 'Search GIPHY GIFs or paste a giphy.com link'
      : 'Pick any currency to send with a Check It card';
  }

  if (dmState.coinPickerOpen) {
    if (isGif) {
      loadDmGifPicker();
      $('#dmGifSearchInput')?.focus();
    } else {
      renderDmCoinPicker();
      $('#dmCoinSearchInput')?.focus();
    }
  }
}

function setDmCoinPickerOpen(open, tab = null) {
  dmState.coinPickerOpen = Boolean(open);
  if (tab === 'coins' || tab === 'gifs') {
    dmState.attachTab = tab;
  }
  const picker = $('#dmCoinPicker');
  const btn = $('#dmAttachCoinBtn');
  if (picker) picker.classList.toggle('hidden', !dmState.coinPickerOpen);
  if (btn) {
    btn.classList.toggle('active', dmState.coinPickerOpen);
    btn.setAttribute('aria-expanded', dmState.coinPickerOpen ? 'true' : 'false');
  }
  if (dmState.coinPickerOpen) {
    setDmAttachTab(dmState.attachTab);
  }
}

function resetDmStateOnLogout() {
  stopOutgoingDmTyping();
  dmState.typingClearTimers.forEach(tid => clearTimeout(tid));
  dmState.typingClearTimers.clear();
  dmState.typingUntilByPartner.clear();
  dmState.rawRows = [];
  dmState.rawRowIds.clear();
  dmState.lastRowCreatedAt = '';
  dmState.messagesByPartner.clear();
  dmState.partnerReadTsByPartner.clear();
  dmState.lastSentReadByPartner.clear();
  dmState.activePartnerId = null;
  dmState.searchQuery = '';
  dmState.totalUnread = 0;
  dmState.lastUnreadNotifiedCount = 0;
  dmState.coinPickerOpen = false;
  dmState.attachTab = 'coins';
  dmState.coinSearchQuery = '';
  dmState.gifSearchQuery = '';
  dmState.sendingCoin = false;
  dmState.sendingGif = false;
  if ($('#dmUserSearchInput')) $('#dmUserSearchInput').value = '';
  if ($('#dmCoinSearchInput')) $('#dmCoinSearchInput').value = '';
  if ($('#dmGifSearchInput')) $('#dmGifSearchInput').value = '';
  setDmCoinPickerOpen(false);
  updateDmUnreadBadge();
}

function formatDmTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function refreshDirectMessages(fromRealtime = false) {
  if (!sb || !currentUser?.id) return;
  const myId = String(currentUser.id);
  await fetchAdminModerationState();
  const delUsers = adminModStateCache.deletedUserIds || new Set();

  let dmQ = sb.from('premium_requests')
    .select('id, user_id, reason, created_at')
    .like('reason', '__DM_%')
    .order('created_at', { ascending: true })
    .limit(2000);
  if (dmState.rawRows.length && dmState.lastRowCreatedAt) {
    dmQ = dmQ.gte('created_at', dmState.lastRowCreatedAt);
  }

  const [dmRes] = await Promise.all([
    dmQ,
    ensureProfilesCached([], false)
  ]);

  const incoming = dmRes?.data || [];
  incoming.forEach(row => {
    const rowId = String(row.id || (String(row.created_at || '') + '|' + String(row.user_id || '') + '|' + String(row.reason || '')));
    if (dmState.rawRowIds.has(rowId)) return;
    dmState.rawRowIds.add(rowId);
    dmState.rawRows.push(row);
    if (row.created_at && (!dmState.lastRowCreatedAt || row.created_at > dmState.lastRowCreatedAt)) {
      dmState.lastRowCreatedAt = row.created_at;
    }
  });
  dmState.rawRows.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

  const profMap = new Map();
  sharedProfilesCache.forEach((p, pid) => {
    if (delUsers.has(pid)) return;
    if (adminModStateCache.bans?.get(pid)?.banned) return;
    profMap.set(pid, p);
  });
  dmState.profilesMap = profMap;

  const grouped = new Map();
  const partnerReadMap = new Map(dmState.partnerReadTsByPartner);

  dmState.rawRows.forEach(r => {
    const raw = String(r.reason || '');
    if (raw.startsWith('__DM_READ__:')) {
      try {
        const p = JSON.parse(raw.slice('__DM_READ__:'.length));
        const readerId = String(r.user_id || '');
        const msgSenderId = String(p?.to || '');
        const seenTs = Number(p?.seenTs || 0);
        if (readerId && readerId !== myId && msgSenderId === myId && seenTs > 0) {
          partnerReadMap.set(readerId, Math.max(partnerReadMap.get(readerId) || 0, seenTs));
        }
      } catch (e) {}
      return;
    }

    if (!raw.startsWith('__DM_MSG__:')) return;
    try {
      const p = JSON.parse(raw.slice('__DM_MSG__:'.length));
      const senderId = String(r.user_id || '');
      const toId = String(p?.to || '');
      const cleanGifUrl = p?.type === 'gif' ? sanitizeGifUrl(p?.gifUrl) : '';
      const msgType = p?.type === 'coin' && p?.coinId
        ? 'coin'
        : (cleanGifUrl ? 'gif' : 'text');
      const text = String(p?.text || '').trim();
      if (!senderId || !toId) return;
      if (msgType === 'text' && !text) return;
      if (senderId !== myId && toId !== myId) return;
      const partnerId = senderId === myId ? toId : senderId;
      if (!partnerId || partnerId === myId || delUsers.has(partnerId)) return;
      const ts = Number(p.ts) || (r.created_at ? new Date(r.created_at).getTime() : Date.now());
      if (!grouped.has(partnerId)) grouped.set(partnerId, []);
      grouped.get(partnerId).push({
        id: String(p.id || r.id || (ts + '_' + senderId)),
        from: senderId,
        to: toId,
        type: msgType,
        text: text || (msgType === 'coin' ? `Shared $${p.coinTicker || 'COIN'}` : (msgType === 'gif' ? 'Sent a GIF' : '')),
        coinId: p.coinId ? String(p.coinId) : null,
        coinName: p.coinName ? String(p.coinName) : '',
        coinTicker: p.coinTicker ? String(p.coinTicker) : '',
        coinDesc: p.coinDesc ? String(p.coinDesc) : '',
        coinImg: p.coinImg ? String(p.coinImg) : '',
        gifUrl: cleanGifUrl,
        gifTitle: p.gifTitle ? String(p.gifTitle) : 'GIF',
        ts
      });
    } catch (e) {}
  });

  grouped.forEach(list => list.sort((a, b) => a.ts - b.ts));
  dmState.messagesByPartner = grouped;
  dmState.partnerReadTsByPartner = partnerReadMap;

  const dmModalOpen = !$('#dmModal')?.classList.contains('hidden');
  if (dmModalOpen && dmState.activePartnerId) {
    const thread = dmState.messagesByPartner.get(dmState.activePartnerId) || [];
    const latest = thread.length ? thread[thread.length - 1].ts : Date.now();
    markDmThreadSeen(dmState.activePartnerId, latest);
    syncDmReadReceipt(dmState.activePartnerId);
  }

  const prevUnread = dmState.totalUnread;
  updateDmUnreadBadge();

  if (fromRealtime && dmState.totalUnread > prevUnread) {
    playSound('commenting');
  }

  if (dmModalOpen) {
    renderDmSidebar();
    if (dmState.activePartnerId) {
      renderDmThread();
      renderDmTypingUi();
    }
  }
}

function getDmPartnerProfile(partnerId) {
  return dmState.profilesMap.get(String(partnerId)) || { id: partnerId, username: 'Trader', avatar_url: null };
}

function updateDmMobilePane() {
  const layout = $('#dmModal .dm-layout');
  if (!layout) return;
  layout.classList.toggle('is-chat-open', Boolean(dmState.activePartnerId));
}

function renderDmSidebar() {
  const listEl = $('#dmSidebarList');
  if (!listEl || !currentUser?.id) return;
  const myId = String(currentUser.id);
  const q = (dmState.searchQuery || '').trim().toLowerCase();

  let rowsHtml = '';
  if (q) {
    const matches = [];
    dmState.profilesMap.forEach((p, pid) => {
      if (pid === myId) return;
      if ((p.username || '').toLowerCase().includes(q)) matches.push(p);
    });
    matches.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
    if (!matches.length) {
      listEl.innerHTML = '<p class="muted tiny" style="padding:14px;text-align:center;">No matching accounts found.</p>';
      return;
    }
    rowsHtml = matches.slice(0, 40).map(p => {
      const pid = String(p.id);
      const msgs = dmState.messagesByPartner.get(pid) || [];
      const last = msgs[msgs.length - 1];
      const typingNow = isDmPartnerTyping(pid);
      const preview = typingNow
        ? 'typing...'
        : (last ? (last.from === myId ? 'You: ' : '') + last.text : 'Click to start a DM');
      const activeCls = dmState.activePartnerId === pid ? 'active' : '';
      return `
        <button type="button" class="dm-thread-item ${activeCls}" data-dm-partner="${escapeHtml(pid)}">
          <div class="avatar" style="width:36px;height:36px;font-size:14px;flex-shrink:0;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
          <div class="dm-thread-meta">
            <div class="dm-thread-top">
              <span class="dm-thread-name">${escapeHtml(p.username || 'Trader')}${tierBadgeHtml(p)}</span>
            </div>
            <div class="dm-thread-preview ${typingNow ? 'is-typing' : ''}">${escapeHtml(preview)}</div>
          </div>
        </button>`;
    }).join('');
  } else {
    const threads = [];
    dmState.messagesByPartner.forEach((msgs, partnerId) => {
      if (!msgs.length) return;
      const last = msgs[msgs.length - 1];
      const seen = getDmSeenTs(partnerId);
      const unread = msgs.filter(m => m.from !== myId && m.ts > seen).length;
      threads.push({ partnerId, last, unread });
    });
    threads.sort((a, b) => b.last.ts - a.last.ts);

    if (!threads.length) {
      listEl.innerHTML = '<p class="muted tiny" style="padding:16px 12px;text-align:center;">No DMs yet.<br>Search an account above to start chatting!</p>';
      return;
    }
    rowsHtml = threads.map(th => {
      const p = getDmPartnerProfile(th.partnerId);
      const activeCls = dmState.activePartnerId === th.partnerId ? 'active' : '';
      const typingNow = isDmPartnerTyping(th.partnerId);
      const preview = typingNow
        ? 'typing...'
        : ((th.last.from === myId ? 'You: ' : '') + th.last.text);
      return `
        <button type="button" class="dm-thread-item ${activeCls}" data-dm-partner="${escapeHtml(th.partnerId)}">
          <div class="avatar" style="width:36px;height:36px;font-size:14px;flex-shrink:0;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
          <div class="dm-thread-meta">
            <div class="dm-thread-top">
              <span class="dm-thread-name">${escapeHtml(p.username || 'Trader')}${tierBadgeHtml(p)}</span>
              ${th.unread > 0 ? `<span class="dm-item-unread">${th.unread}</span>` : `<span class="tiny muted">${escapeHtml(formatDmTime(th.last.ts))}</span>`}
            </div>
            <div class="dm-thread-preview ${typingNow ? 'is-typing' : ''}">${escapeHtml(preview)}</div>
          </div>
        </button>`;
    }).join('');
  }

  listEl.innerHTML = rowsHtml;
  $$('#dmSidebarList [data-dm-partner]').forEach(btn => {
    btn.addEventListener('click', () => selectDmPartner(btn.dataset.dmPartner));
  });
}

function selectDmPartner(partnerId) {
  if (!partnerId) return;
  const nextId = String(partnerId);
  if (dmState.activePartnerId && dmState.activePartnerId !== nextId) {
    stopOutgoingDmTyping(dmState.activePartnerId);
  }
  dmState.activePartnerId = nextId;
  setDmCoinPickerOpen(false);
  const msgs = dmState.messagesByPartner.get(dmState.activePartnerId) || [];
  const latestTs = msgs.length ? msgs[msgs.length - 1].ts : Date.now();
  markDmThreadSeen(dmState.activePartnerId, latestTs);
  syncDmReadReceipt(dmState.activePartnerId);
  updateDmMobilePane();
  renderDmSidebar();
  renderDmThread();
  renderDmTypingUi();
  $('#dmMessageInput')?.focus();
}

function loadDmGifPicker() {
  return renderGiphyPickerGrid({
    gridEl: $('#dmGifGrid'),
    statusEl: $('#dmGifStatus'),
    query: dmState.gifSearchQuery,
    emptyText: 'No GIFs matched your search.',
    onSelect: (gif) => sendDmGif(gif)
  });
}

function renderDmCoinPicker() {
  const listEl = $('#dmCoinPickerList');
  if (!listEl) return;
  const q = (dmState.coinSearchQuery || '').trim().toLowerCase();
  const available = (coins || []).filter(c => {
    if (!q) return true;
    return (c.name || '').toLowerCase().includes(q)
      || (c.ticker || '').toLowerCase().includes(q)
      || (c.description || '').toLowerCase().includes(q);
  });

  if (!available.length) {
    listEl.innerHTML = '<p class="muted tiny" style="padding:14px;text-align:center;">No coins match your search.</p>';
    return;
  }

  listEl.innerHTML = available.slice(0, 40).map(c => {
    const thumb = c.image_url
      ? `<img src="${escapeHtml(c.image_url)}" alt="">`
      : escapeHtml((c.ticker || c.name || 'C')[0].toUpperCase());
    const desc = (c.description || '').trim() || 'Community coin on GRIND';
    return `
      <button type="button" class="dm-coin-option" data-dm-pick-coin="${escapeHtml(c.id)}">
        <div class="coin-logo dm-coin-opt-logo">${thumb}</div>
        <div class="dm-coin-opt-meta">
          <div class="dm-coin-opt-top">
            <span class="dm-coin-opt-name">${escapeHtml(c.name)} <small>$${escapeHtml(c.ticker)}</small></span>
            <span class="dm-coin-opt-price">${escapeHtml(priceFmt(c.price))}</span>
          </div>
          <div class="dm-coin-opt-desc">${escapeHtml(desc)}</div>
        </div>
      </button>`;
  }).join('');

  $$('#dmCoinPickerList [data-dm-pick-coin]').forEach(btn => {
    btn.addEventListener('click', () => {
      sendDmCoinCard(btn.dataset.dmPickCoin);
    });
  });
}

async function sendDmCoinCard(coinId) {
  if (!currentUser?.id || !sb || !dmState.activePartnerId || dmState.sendingCoin) return;
  const coin = (coins || []).find(c => String(c.id) === String(coinId));
  if (!coin) {
    toast('Coin could not be found.');
    return;
  }
  stopOutgoingDmTyping();
  dmState.sendingCoin = true;
  const safeDesc = String(coin.description || '').trim().slice(0, 180);
  const compactImg = coin.image_url && String(coin.image_url).length <= 400 ? String(coin.image_url) : '';
  const msgObj = {
    id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    to: String(dmState.activePartnerId),
    type: 'coin',
    coinId: String(coin.id),
    coinName: String(coin.name || 'Coin'),
    coinTicker: String(coin.ticker || ''),
    coinDesc: safeDesc,
    coinImg: compactImg,
    text: `Shared $${String(coin.ticker || '')} — ${String(coin.name || 'Coin')}`,
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__DM_MSG__:' + JSON.stringify(msgObj),
    status: 'denied'
  });
  dmState.sendingCoin = false;

  if (error) {
    toast('Could not share coin: ' + error.message);
    return;
  }

  setDmCoinPickerOpen(false);
  const pid = String(dmState.activePartnerId);
  if (!dmState.messagesByPartner.has(pid)) dmState.messagesByPartner.set(pid, []);
  dmState.messagesByPartner.get(pid).push({
    id: msgObj.id,
    from: String(currentUser.id),
    to: pid,
    type: 'coin',
    text: msgObj.text,
    coinId: msgObj.coinId,
    coinName: msgObj.coinName,
    coinTicker: msgObj.coinTicker,
    coinDesc: msgObj.coinDesc,
    coinImg: coin.image_url || compactImg,
    ts: msgObj.ts
  });
  markDmThreadSeen(pid, msgObj.ts);
  playSound('commenting');
  renderDmSidebar();
  renderDmThread();
}

async function sendDmGif(gifObj) {
  if (!currentUser?.id || !sb || !dmState.activePartnerId || dmState.sendingGif) return;
  const cleanUrl = sanitizeGifUrl(gifObj?.gifUrl);
  if (!cleanUrl) {
    toast('Invalid GIF URL.');
    return;
  }
  stopOutgoingDmTyping();
  dmState.sendingGif = true;
  const msgObj = {
    id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    to: String(dmState.activePartnerId),
    type: 'gif',
    gifUrl: cleanUrl,
    gifTitle: String(gifObj?.title || 'GIF').slice(0, 80),
    text: 'Sent a GIF',
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__DM_MSG__:' + JSON.stringify(msgObj),
    status: 'denied'
  });
  dmState.sendingGif = false;

  if (error) {
    toast('Could not send GIF: ' + error.message);
    return;
  }

  setDmCoinPickerOpen(false);
  const pid = String(dmState.activePartnerId);
  if (!dmState.messagesByPartner.has(pid)) dmState.messagesByPartner.set(pid, []);
  dmState.messagesByPartner.get(pid).push({
    id: msgObj.id,
    from: String(currentUser.id),
    to: pid,
    type: 'gif',
    text: msgObj.text,
    gifUrl: msgObj.gifUrl,
    gifTitle: msgObj.gifTitle,
    ts: msgObj.ts
  });
  markDmThreadSeen(pid, msgObj.ts);
  playSound('commenting');
  renderDmSidebar();
  renderDmThread();
}

function renderDmThread() {
  const headerEl = $('#dmChatHeader');
  const emptyEl = $('#dmEmptyState');
  const listEl = $('#dmMessagesList');
  const formEl = $('#dmSendForm');
  const typingRow = $('#dmTypingRow');
  if (!headerEl || !emptyEl || !listEl || !formEl) return;

  updateDmMobilePane();

  if (!dmState.activePartnerId || !currentUser?.id) {
    headerEl.classList.add('hidden');
    listEl.classList.add('hidden');
    formEl.classList.add('hidden');
    if (typingRow) {
      typingRow.classList.add('hidden');
      typingRow.innerHTML = '';
    }
    setDmCoinPickerOpen(false);
    emptyEl.classList.remove('hidden');
    return;
  }

  const p = getDmPartnerProfile(dmState.activePartnerId);
  const partnerTyping = isDmPartnerTyping(dmState.activePartnerId);
  headerEl.classList.remove('hidden');
  listEl.classList.remove('hidden');
  formEl.classList.remove('hidden');
  emptyEl.classList.add('hidden');

  headerEl.innerHTML = `
    <div class="dm-header-left">
      <button type="button" class="zoom-btn dm-mobile-back-btn" id="dmBackToListBtn" aria-label="Back to conversations">← Chats</button>
      <button type="button" class="dm-chat-partner" id="dmPartnerProfileBtn">
        <div class="avatar" style="width:34px;height:34px;font-size:13px;">${p.avatar_url ? `<img src="${escapeHtml(p.avatar_url)}">` : escapeHtml((p.username || '?')[0].toUpperCase())}</div>
        <div>
          <strong>${escapeHtml(p.username || 'Trader')}${tierBadgeHtml(p)}</strong>
          <div id="dmChatHeaderStatus" class="tiny muted ${partnerTyping ? 'is-typing' : ''}">${partnerTyping ? 'typing...' : 'Private DM · Click to view profile'}</div>
        </div>
      </button>
    </div>`;
  $('#dmBackToListBtn')?.addEventListener('click', () => {
    stopOutgoingDmTyping();
    dmState.activePartnerId = null;
    setDmCoinPickerOpen(false);
    renderDmSidebar();
    renderDmThread();
  });
  $('#dmPartnerProfileBtn')?.addEventListener('click', () => {
    openProfileModal(p.id);
  });

  const myId = String(currentUser.id);
  const msgs = dmState.messagesByPartner.get(dmState.activePartnerId) || [];
  if (!msgs.length) {
    listEl.innerHTML = `<div class="muted tiny" style="margin:auto;text-align:center;">Say hello or tap <strong>＋</strong> to send a GIF or share a coin with <strong>${escapeHtml(p.username || 'Trader')}</strong>!</div>`;
  } else {
    const coinById = new Map((coins || []).map(c => [String(c.id), c]));
    const partnerReadTs = dmState.partnerReadTsByPartner.get(String(dmState.activePartnerId)) || 0;
    let lastMineIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].from === myId) {
        lastMineIdx = i;
        break;
      }
    }

    listEl.innerHTML = msgs.map((m, idx) => {
      const mine = m.from === myId;
      const isRead = mine && partnerReadTs > 0 && Number(m.ts) <= partnerReadTs;
      const showReceipt = mine && idx === lastMineIdx;
      const metaFooter = showReceipt
        ? `<span class="dm-msg-meta-row">${escapeHtml(formatDmTime(m.ts))} · <span class="dm-read-badge ${isRead ? 'is-read' : ''}">${isRead ? '✓✓ READ' : '✓ Sent'}</span></span>`
        : `<span class="dm-msg-time">${escapeHtml(formatDmTime(m.ts))}</span>`;

      if (m.type === 'coin' && m.coinId) {
        const liveCoin = coinById.get(String(m.coinId));
        const title = liveCoin?.name || m.coinName || 'Currency';
        const ticker = liveCoin?.ticker || m.coinTicker || '';
        const desc = ((liveCoin?.description ?? m.coinDesc) || '').trim() || 'Community currency on GRIND';
        const imgUrl = liveCoin?.image_url || m.coinImg || '';
        const thumbHtml = imgUrl
          ? `<img src="${escapeHtml(imgUrl)}" alt="">`
          : escapeHtml((ticker || title || 'C')[0].toUpperCase());
        const priceHtml = liveCoin ? `<span class="dm-coin-live-price">${escapeHtml(priceFmt(liveCoin.price))}</span>` : '';
        return `
          <div class="dm-msg-row dm-msg-coin ${mine ? 'mine' : 'theirs'}">
            <div class="dm-coin-card">
              <div class="dm-coin-card-top">
                <div class="coin-logo dm-coin-card-logo">${thumbHtml}</div>
                <div class="dm-coin-card-head">
                  <div class="dm-coin-card-title">${escapeHtml(title)} ${ticker ? `<span class="dm-coin-card-ticker">$${escapeHtml(ticker)}</span>` : ''}</div>
                  ${priceHtml}
                </div>
              </div>
              <p class="dm-coin-card-desc">${escapeHtml(desc)}</p>
              <button type="button" class="dm-check-it-btn" data-dm-check-coin="${escapeHtml(m.coinId)}">Check It</button>
            </div>
            ${metaFooter}
          </div>`;
      }

      if (m.type === 'gif' && m.gifUrl) {
        return `
          <div class="dm-msg-row dm-msg-gif ${mine ? 'mine' : 'theirs'}">
            <div class="dm-gif-bubble">
              <img src="${escapeHtml(m.gifUrl)}" alt="${escapeHtml(m.gifTitle || 'GIF')}" loading="lazy">
            </div>
            ${metaFooter}
          </div>`;
      }

      return `
        <div class="dm-msg-row ${mine ? 'mine' : 'theirs'}">
          <div class="dm-msg-bubble">${escapeHtml(m.text)}</div>
          ${metaFooter}
        </div>`;
    }).join('');
    $$('#dmMessagesList [data-dm-check-coin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.dmCheckCoin;
        if (!cid) return;
        let targetCoin = (coins || []).find(c => String(c.id) === String(cid));
        if (!targetCoin && sb) {
          await loadCoins();
          targetCoin = (coins || []).find(c => String(c.id) === String(cid));
        }
        if (!targetCoin) {
          toast('This coin is no longer available on the market.');
          return;
        }
        hideModalSmooth($('#dmModal'));
        openCoin(targetCoin.id);
      });
    });
    listEl.scrollTop = listEl.scrollHeight;
  }
}

async function openDmModalWithUser(targetProfile = null) {
  const modal = $('#dmModal');
  if (!modal || !currentUser?.id) return;
  modal.classList.remove('hidden');
  setDmCoinPickerOpen(false);
  await Promise.all([
    refreshDirectMessages(false),
    (!coins || !coins.length) ? loadCoins() : Promise.resolve()
  ]);
  if (targetProfile?.id && String(targetProfile.id) !== String(currentUser.id)) {
    dmState.profilesMap.set(String(targetProfile.id), targetProfile);
    selectDmPartner(targetProfile.id);
  } else {
    renderDmSidebar();
    renderDmThread();
    renderDmTypingUi();
  }
}

$('#openDmBtn')?.addEventListener('click', () => openDmModalWithUser(null));
$('#closeDmModalBtn')?.addEventListener('click', () => hideModalSmooth($('#dmModal')));
$('#dmModal')?.addEventListener('click', e => {
  if (e.target === $('#dmModal')) hideModalSmooth($('#dmModal'));
});
$('#dmUserSearchInput')?.addEventListener('input', e => {
  dmState.searchQuery = e.target.value || '';
  renderDmSidebar();
});
$('#dmAttachCoinBtn')?.addEventListener('click', async () => {
  if (!coins || !coins.length) await loadCoins();
  setDmCoinPickerOpen(!dmState.coinPickerOpen);
});
$('#dmCloseCoinPickerBtn')?.addEventListener('click', () => setDmCoinPickerOpen(false));
$('#dmAttachCoinsTab')?.addEventListener('click', () => setDmAttachTab('coins'));
$('#dmAttachGifsTab')?.addEventListener('click', () => setDmAttachTab('gifs'));
$('#dmCoinSearchInput')?.addEventListener('input', e => {
  dmState.coinSearchQuery = e.target.value || '';
  renderDmCoinPicker();
});
let dmGifSearchTimer = null;
$('#dmGifSearchInput')?.addEventListener('input', e => {
  dmState.gifSearchQuery = e.target.value || '';
  clearTimeout(dmGifSearchTimer);
  const delay = extractDirectGiphyUrl(dmState.gifSearchQuery) ? 0 : 280;
  dmGifSearchTimer = setTimeout(() => {
    if (dmState.coinPickerOpen && dmState.attachTab === 'gifs') loadDmGifPicker();
  }, delay);
});
$('#dmMessageInput')?.addEventListener('input', e => {
  if (!currentUser?.id || !dmState.activePartnerId) return;
  const val = (e.target.value || '').trim();
  const pid = String(dmState.activePartnerId);
  if (!val) {
    stopOutgoingDmTyping(pid);
    return;
  }
  const now = Date.now();
  if (now - dmState.lastTypingSentAt >= 1200 || dmState.lastTypingTargetId !== pid) {
    dmState.lastTypingSentAt = now;
    dmState.lastTypingTargetId = pid;
    emitDmTyping(true, pid);
  }
  clearTimeout(dmState.typingStopTimer);
  dmState.typingStopTimer = setTimeout(() => {
    stopOutgoingDmTyping(pid);
  }, 2800);
});
$('#dmSendForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  if (!currentUser?.id || !sb || !dmState.activePartnerId) return;
  const input = $('#dmMessageInput');
  const sendBtn = $('#dmSendBtn');
  const text = (input?.value || '').trim();
  if (!text) return;

  stopOutgoingDmTyping();
  if (sendBtn) sendBtn.disabled = true;
  const msgObj = {
    id: 'dm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    to: String(dmState.activePartnerId),
    type: 'text',
    text,
    ts: Date.now()
  };

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__DM_MSG__:' + JSON.stringify(msgObj),
    status: 'denied'
  });

  if (sendBtn) sendBtn.disabled = false;
  if (error) {
    toast('Could not send DM: ' + error.message);
    return;
  }

  if (input) input.value = '';
  const pid = String(dmState.activePartnerId);
  if (!dmState.messagesByPartner.has(pid)) dmState.messagesByPartner.set(pid, []);
  dmState.messagesByPartner.get(pid).push({
    id: msgObj.id,
    from: String(currentUser.id),
    to: pid,
    type: 'text',
    text: msgObj.text,
    ts: msgObj.ts
  });
  markDmThreadSeen(pid, msgObj.ts);
  playSound('commenting');
  renderDmSidebar();
  renderDmThread();
});

// ---------- Mobile & Tablet Responsive Drawer & Viewport Handlers ----------
function openMobileSidebar() {
  const sidebar = $('.sidebar');
  const backdrop = $('#mobileSidebarBackdrop');
  const btn = $('#mobileMenuBtn');
  if (sidebar) sidebar.classList.add('mobile-open');
  if (backdrop) backdrop.classList.remove('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  document.body.classList.add('mobile-nav-open');
}

function closeMobileSidebar() {
  const sidebar = $('.sidebar');
  const backdrop = $('#mobileSidebarBackdrop');
  const btn = $('#mobileMenuBtn');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('mobile-nav-open');
}

$('#mobileMenuBtn')?.addEventListener('click', () => {
  const isOpen = $('.sidebar')?.classList.contains('mobile-open');
  if (isOpen) closeMobileSidebar();
  else openMobileSidebar();
});
$('#mobileSidebarBackdrop')?.addEventListener('click', () => closeMobileSidebar());

let viewportResizeTimer = null;
window.addEventListener('resize', () => {
  if (window.innerWidth > 760) closeMobileSidebar();
  clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    if (currentPage === 'coin' && selectedCoin && $('#priceChart')) {
      renderCoinDetail();
    }
    if (!$('#coinWatchModal')?.classList.contains('hidden')) {
      renderWatchFrame(watchState.progress);
    }
  }, 160);
});

window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('.sidebar')?.classList.contains('mobile-open')) {
    closeMobileSidebar();
    return;
  }
  if (!$('#crateOpenModal')?.classList.contains('hidden')) {
    if (!titleSystemState.isSpinning) closeCrateModal();
    return;
  }
  if (!$('#playUseSongModal')?.classList.contains('hidden')) {
    closePlayUseSongModal();
    return;
  }
  if (!$('#playCreatorModal')?.classList.contains('hidden')) {
    closePlayCreatorStudio();
    return;
  }
  if (!$('#playVideoFileModal')?.classList.contains('hidden')) {
    closePlayVideoFileModal();
    return;
  }
  if (!$('#playUploadChoiceModal')?.classList.contains('hidden')) {
    hideModalSmooth($('#playUploadChoiceModal'));
    return;
  }
  if (playState.commentGifPickerOpen) {
    setPlayCommentGifPickerOpen(false);
    return;
  }
  if (playState.openCommentsVideoId) {
    playState.openCommentsVideoId = null;
    $('#playCommentsDrawer')?.classList.add('hidden');
    return;
  }
  if (commentGifPickerOpen) {
    setCommentGifPickerOpen(false);
    return;
  }
  if (dmState.coinPickerOpen) {
    setDmCoinPickerOpen(false);
    return;
  }
  if (!$('#coinWatchModal')?.classList.contains('hidden')) closeCoinWatchModal(false);
  else if (!$('#dmModal')?.classList.contains('hidden')) hideModalSmooth($('#dmModal'));
  else if (currentPage === 'play') showPage('feed');
});

// ============================================================
// ---------- STORE · MARKETPLACE · SEASON 1 CRATES & TITLES --
// ============================================================
const TITLE_RARITIES = {
  common:    { key: 'common',    label: 'Common',    order: 1 },
  uncommon:  { key: 'uncommon',  label: 'Uncommon',  order: 2 },
  epic:      { key: 'epic',      label: 'Epic',      order: 3 },
  legendary: { key: 'legendary', label: 'Legendary', order: 4 },
  mythic:    { key: 'mythic',    label: 'Mythic',    order: 5 }
};

const SEASON_1_TITLES = [
  { id: 's1_creator',   name: 'Creator',                     rarity: 'common' },
  { id: 's1_cool',      name: 'Cool',                        rarity: 'common' },
  { id: 's1_dude',      name: 'Dude',                        rarity: 'common' },
  { id: 's1_lol',       name: 'LOL',                         rarity: 'uncommon' },
  { id: 's1_master',    name: 'Master',                      rarity: 'uncommon' },
  { id: 's1_nugget',    name: 'Chicken Nugget',              rarity: 'epic' },
  { id: 's1_insane',    name: 'Insane',                      rarity: 'epic' },
  { id: 's1_artificial',name: 'Artificial',                  rarity: 'epic' },
  { id: 's1_guardian',  name: 'Guardian',                    rarity: 'legendary' },
  { id: 's1_angel',     name: 'Angel',                       rarity: 'legendary' },
  { id: 's1_protector', name: 'Protector Of Worlds',         rarity: 'mythic' },
  { id: 's1_agow',      name: 'Artificial Guardian Of Worlds', rarity: 'mythic' }
];

const SEASON_1_TITLE_MAP = new Map(SEASON_1_TITLES.map(t => [t.id, t]));

const STORE_CRATES = [
  {
    id: 'default_1',
    name: 'Default Crate 1',
    price: 100,
    badge: 'SEASON 1',
    tagline: 'Standard Season 1 drop table with all 12 collectible Titles.',
    ultra: false,
    tierWeights: { common: 62, uncommon: 25, epic: 10, legendary: 2.5, mythic: 0.5 }
  },
  {
    id: 'ultra_1',
    name: 'ULTRA Crate 1',
    price: 500,
    badge: '2X EPIC · LEG · MYTHIC',
    tagline: '2X higher drop chance on every Epic, Legendary & Mythic Title!',
    ultra: true,
    tierWeights: { common: 40, uncommon: 34, epic: 20, legendary: 5, mythic: 1 }
  }
];

const titleSystemState = {
  ownedIds: new Set(),
  equippedByUser: new Map(), // userId -> titleId
  lastSyncAt: 0,
  loadedForUid: null,
  selectedCrateId: 'default_1',
  isOpening: false,
  isSpinning: false,
  spinRaf: null,
  lastReveal: null // { crateId, item, isDuplicate }
};

function getTitleMeta(titleId) {
  return SEASON_1_TITLE_MAP.get(String(titleId || '')) || null;
}

function getUserEquippedTitleId(userId) {
  if (!userId) return null;
  const tid = titleSystemState.equippedByUser.get(String(userId)) || null;
  return tid && SEASON_1_TITLE_MAP.has(tid) ? tid : null;
}

function renderTitleBadgeHtml(titleId, compact = false) {
  const item = getTitleMeta(titleId);
  if (!item) return '';
  const rar = TITLE_RARITIES[item.rarity] || TITLE_RARITIES.common;
  return `<span class="user-title-badge rarity-${escapeHtml(rar.key)} ${compact ? 'compact' : ''}" title="${escapeHtml(rar.label)} Title">${escapeHtml(item.name)}</span>`;
}

function readLocalOwnedTitles(uid) {
  try {
    const raw = localStorage.getItem('grind_titles_owned_' + uid);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(id => SEASON_1_TITLE_MAP.has(id));
    }
  } catch (e) {}
  return [];
}

function writeLocalOwnedTitles(uid, set) {
  try {
    localStorage.setItem('grind_titles_owned_' + uid, JSON.stringify(Array.from(set)));
  } catch (e) {}
}

function readLocalEquippedTitle(uid) {
  try {
    const val = localStorage.getItem('grind_title_equipped_' + uid);
    return val && SEASON_1_TITLE_MAP.has(val) ? val : null;
  } catch (e) {
    return null;
  }
}

function writeLocalEquippedTitle(uid, titleId) {
  try {
    if (titleId) localStorage.setItem('grind_title_equipped_' + uid, titleId);
    else localStorage.removeItem('grind_title_equipped_' + uid);
  } catch (e) {}
}

async function loadTitleSystemState(force = false) {
  if (!sb) return;
  const now = Date.now();
  const uid = currentUser?.id ? String(currentUser.id) : null;
  if (!force && (now - titleSystemState.lastSyncAt) < 8000 && titleSystemState.loadedForUid === uid) {
    return;
  }

  if (uid) {
    readLocalOwnedTitles(uid).forEach(id => titleSystemState.ownedIds.add(id));
    const localEq = readLocalEquippedTitle(uid);
    if (localEq && !titleSystemState.equippedByUser.has(uid)) {
      titleSystemState.equippedByUser.set(uid, localEq);
    }
  }

  try {
    const equipPromise = sb
      .from('premium_requests')
      .select('user_id, reason, created_at')
      .like('reason', '__TITLE_EQUIP__:%')
      .order('created_at', { ascending: true })
      .limit(1500);

    const ownedPromise = uid
      ? sb
          .from('premium_requests')
          .select('reason')
          .eq('user_id', uid)
          .like('reason', '__CRATE_ITEM__:%')
          .limit(300)
      : Promise.resolve({ data: [] });

    const [eqRes, ownRes] = await Promise.all([equipPromise, ownedPromise]);

    const nextEquipped = new Map();
    (eqRes?.data || []).forEach(r => {
      const raw = String(r.reason || '');
      if (!raw.startsWith('__TITLE_EQUIP__:')) return;
      try {
        const p = JSON.parse(raw.slice('__TITLE_EQUIP__:'.length));
        const rUid = String(r.user_id || '');
        if (!rUid) return;
        const tid = p?.titleId ? String(p.titleId) : null;
        if (tid && SEASON_1_TITLE_MAP.has(tid)) {
          nextEquipped.set(rUid, tid);
        } else {
          nextEquipped.delete(rUid);
        }
      } catch (e) {}
    });
    titleSystemState.equippedByUser = nextEquipped;

    if (uid) {
      const owned = new Set(readLocalOwnedTitles(uid));
      (ownRes?.data || []).forEach(r => {
        const raw = String(r.reason || '');
        if (!raw.startsWith('__CRATE_ITEM__:')) return;
        try {
          const p = JSON.parse(raw.slice('__CRATE_ITEM__:'.length));
          if (p?.itemId && SEASON_1_TITLE_MAP.has(String(p.itemId))) {
            owned.add(String(p.itemId));
          }
        } catch (e) {}
      });
      titleSystemState.ownedIds = owned;
      writeLocalOwnedTitles(uid, owned);
      const eqMine = nextEquipped.get(uid) || null;
      writeLocalEquippedTitle(uid, eqMine);
    }

    titleSystemState.lastSyncAt = Date.now();
    titleSystemState.loadedForUid = uid;
  } catch (e) {}
}

async function equipUserTitle(titleId = null) {
  if (!currentUser?.id || !sb) return;
  const uid = String(currentUser.id);
  const cleanId = titleId && SEASON_1_TITLE_MAP.has(String(titleId)) ? String(titleId) : null;
  if (cleanId && !titleSystemState.ownedIds.has(cleanId)) {
    toast('Unlock that title from a crate first!');
    return;
  }

  if (cleanId) titleSystemState.equippedByUser.set(uid, cleanId);
  else titleSystemState.equippedByUser.delete(uid);
  writeLocalEquippedTitle(uid, cleanId);
  titleSystemState.lastSyncAt = Date.now();

  renderAccountIdentityAndTitles();
  if (currentPage === 'marketplace') renderMarketplacePage();
  if (currentPage === 'global') renderLeaderboard();

  const { error } = await sb.from('premium_requests').insert({
    user_id: currentUser.id,
    reason: '__TITLE_EQUIP__:' + JSON.stringify({ titleId: cleanId, ts: Date.now() }),
    status: 'denied'
  });

  if (error) {
    toast('Title sync note: ' + error.message);
    return;
  }
  const meta = cleanId ? getTitleMeta(cleanId) : null;
  toast(meta ? `Equipped "${meta.name}"!` : 'Title unequipped');
}

function renderAccountIdentityAndTitles() {
  if (!currentUser) return;
  const uid = String(currentUser.id);
  const avEl = $('#accountIdentityAvatar');
  const nameEl = $('#accountIdentityName');
  const slotEl = $('#accountIdentityTitleSlot');
  const countEl = $('#accountTitlesCount');
  const gridEl = $('#accountTitlesGrid');

  if (avEl) {
    avEl.innerHTML = currentUser.avatar_url
      ? `<img src="${escapeHtml(currentUser.avatar_url)}">`
      : escapeHtml((currentUser.username || 'G')[0].toUpperCase());
  }
  if (nameEl) {
    nameEl.innerHTML = `${escapeHtml(currentUser.username || 'Trader')}${tierBadgeHtml(currentUser)}`;
  }

  const followStatsEl = $('#accountIdentityFollowStats');
  if (followStatsEl) {
    const folCount = typeof getFollowersCount === 'function' ? getFollowersCount(uid) : 0;
    const ingCount = typeof getFollowingCount === 'function' ? getFollowingCount(uid) : 0;
    followStatsEl.textContent = `${folCount} Follower${folCount === 1 ? '' : 's'} · ${ingCount} Following`;
  }

  const equippedId = getUserEquippedTitleId(uid);
  if (slotEl) {
    slotEl.innerHTML = equippedId
      ? renderTitleBadgeHtml(equippedId)
      : '<span class="muted tiny">No title equipped</span>';
  }
  if (countEl) {
    countEl.textContent = `${titleSystemState.ownedIds.size} / ${SEASON_1_TITLES.length} unlocked`;
  }
  if (gridEl) {
    const ownedItems = SEASON_1_TITLES.filter(t => titleSystemState.ownedIds.has(t.id));
    if (!ownedItems.length) {
      gridEl.innerHTML = '<div class="muted tiny">No titles unlocked yet — open Season 1 Crates in Store → Marketplace!</div>';
    } else {
      gridEl.innerHTML = `
        <button type="button" class="account-title-opt ${!equippedId ? 'active' : ''}" data-acc-title="">
          <span>None</span>
        </button>
        ${ownedItems.map(item => `
          <button type="button" class="account-title-opt rarity-${escapeHtml(item.rarity)} ${equippedId === item.id ? 'active' : ''}" data-acc-title="${escapeHtml(item.id)}">
            <span>${escapeHtml(item.name)}</span>
            <small>${escapeHtml(TITLE_RARITIES[item.rarity]?.label || item.rarity)}</small>
          </button>
        `).join('')}
      `;
      $$('#accountTitlesGrid [data-acc-title]').forEach(btn => {
        btn.addEventListener('click', () => {
          const val = btn.dataset.accTitle || null;
          equipUserTitle(val);
        });
      });
    }
  }
}

function getCrateItemChancePct(crate, rarity) {
  const sameTierCount = SEASON_1_TITLES.filter(t => t.rarity === rarity).length || 1;
  const tierWeight = Number(crate?.tierWeights?.[rarity] || 0);
  return tierWeight / sameTierCount;
}

function rollItemFromCrate(crate) {
  const weights = crate.tierWeights;
  const tiers = Object.keys(weights);
  const total = tiers.reduce((s, k) => s + Number(weights[k] || 0), 0);
  let r = Math.random() * total;
  let pickedTier = 'common';
  for (const k of tiers) {
    r -= Number(weights[k] || 0);
    if (r <= 0) {
      pickedTier = k;
      break;
    }
  }
  const pool = SEASON_1_TITLES.filter(t => t.rarity === pickedTier);
  return pool[Math.floor(Math.random() * pool.length)] || SEASON_1_TITLES[0];
}

function buildCrateCaseArtSvg(isUltra) {
  const accent = isUltra ? '#fbbf24' : '#38bdf8';
  const accent2 = isUltra ? '#ef4444' : '#a855f7';
  const baseDark = isUltra ? '#261714' : '#161b2e';
  return `
    <svg viewBox="0 0 120 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="crateBody_${isUltra ? 'u' : 'd'}" x1="0" y1="0" x2="120" y2="96" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${baseDark}"/>
          <stop offset="100%" stop-color="#0b0814"/>
        </linearGradient>
        <linearGradient id="crateTrim_${isUltra ? 'u' : 'd'}" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${accent2}"/>
        </linearGradient>
      </defs>
      <rect x="8" y="22" width="104" height="62" rx="10" fill="url(#crateBody_${isUltra ? 'u' : 'd'})" stroke="url(#crateTrim_${isUltra ? 'u' : 'd'})" stroke-width="2.5"/>
      <path d="M14 22L24 10H96L106 22H14Z" fill="#1b152a" stroke="url(#crateTrim_${isUltra ? 'u' : 'd'})" stroke-width="2"/>
      <line x1="8" y1="45" x2="112" y2="45" stroke="url(#crateTrim_${isUltra ? 'u' : 'd'})" stroke-width="2" stroke-opacity="0.7"/>
      <rect x="46" y="37" width="28" height="17" rx="4" fill="#0d0917" stroke="${accent}" stroke-width="2"/>
      <circle cx="60" cy="45.5" r="3" fill="${accent}"/>
      <path d="M24 58H40M80 58H96" stroke="${accent2}" stroke-width="2.5" stroke-linecap="round" stroke-opacity="0.65"/>
      <path d="M24 70H96" stroke="#ffffff" stroke-opacity="0.1" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
}

function playCrateTickSound(speedRatio = 1) {
  try {
    const ctx = ensureGrindAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 680 + Math.min(1, Math.max(0, speedRatio)) * 420;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.032);
    gain.gain.setValueAtTime(0.085, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.04);
  } catch (e) {}
}

function playCrateLatchSound() {
  try {
    const ctx = ensureGrindAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    [240, 420].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.06);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.4, now + i * 0.06 + 0.08);
      gain.gain.setValueAtTime(0.06, now + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.06);
      osc.stop(now + i * 0.06 + 0.12);
    });
  } catch (e) {}
}

function playCrateRevealSound(rarity) {
  try {
    const ctx = ensureGrindAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const chords = {
      common:    [392.0, 493.88],
      uncommon:  [440.0, 554.37, 659.25],
      epic:      [392.0, 523.25, 659.25, 783.99],
      legendary: [440.0, 554.37, 659.25, 880.0, 1108.73],
      mythic:    [293.66, 440.0, 587.33, 739.99, 880.0, 1174.66]
    };
    const notes = chords[rarity] || chords.common;
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = rarity === 'mythic' || rarity === 'legendary' ? 'triangle' : 'sine';
      const t0 = now + idx * 0.055;
      osc.frequency.setValueAtTime(f, t0);
      gain.gain.setValueAtTime(0.001, t0);
      gain.gain.linearRampToValueAtTime(rarity === 'mythic' ? 0.12 : 0.09, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.65);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.68);
    });
  } catch (e) {}
}

function renderMarketplacePage() {
  if (!currentUser) return;
  const uid = String(currentUser.id);
  const equippedId = getUserEquippedTitleId(uid);
  const equippedMeta = equippedId ? getTitleMeta(equippedId) : null;

  if ($('#mktCashPill')) $('#mktCashPill').textContent = money(currentUser.cash || 0);
  if ($('#mktUnlockedPill')) $('#mktUnlockedPill').textContent = `${titleSystemState.ownedIds.size} / ${SEASON_1_TITLES.length}`;
  if ($('#mktEquippedPill')) {
    $('#mktEquippedPill').innerHTML = equippedMeta
      ? renderTitleBadgeHtml(equippedMeta.id, true)
      : 'None';
  }
  if ($('#mktUnequipTitleBtn')) {
    $('#mktUnequipTitleBtn').classList.toggle('hidden', !equippedId);
  }

  const cratesGrid = $('#marketplaceCratesGrid');
  if (cratesGrid) {
    cratesGrid.innerHTML = STORE_CRATES.map(cr => {
      const selected = titleSystemState.selectedCrateId === cr.id;
      const canAfford = Number(currentUser.cash || 0) >= cr.price;
      return `
        <div class="mkt-crate-card ${cr.ultra ? 'is-ultra' : ''} ${selected ? 'selected' : ''}" data-select-crate="${escapeHtml(cr.id)}">
          <div class="mkt-crate-top">
            <span class="mkt-crate-badge ${cr.ultra ? 'ultra' : ''}">${escapeHtml(cr.badge)}</span>
            <span class="mkt-crate-price">${money(cr.price)}</span>
          </div>
          <div class="mkt-crate-art">${buildCrateCaseArtSvg(cr.ultra)}</div>
          <div class="mkt-crate-info">
            <h4>${escapeHtml(cr.name)}</h4>
            <p class="muted tiny">${escapeHtml(cr.tagline)}</p>
          </div>
          <div class="mkt-crate-odds-chips">
            <span class="mkt-odds-chip rarity-epic">Epic ${cr.tierWeights.epic}%</span>
            <span class="mkt-odds-chip rarity-legendary">Legendary ${cr.tierWeights.legendary}%</span>
            <span class="mkt-odds-chip rarity-mythic">Mythic ${cr.tierWeights.mythic}%</span>
          </div>
          <div class="mkt-crate-actions">
            <button type="button" class="zoom-btn" data-inspect-crate="${escapeHtml(cr.id)}">${selected ? 'Inspecting' : 'Inspect Drops'}</button>
            <button type="button" class="${cr.ultra ? 'pro-upgrade-cta mkt-ultra-btn' : 'primary-btn'}" data-open-crate="${escapeHtml(cr.id)}" ${!canAfford || titleSystemState.isOpening ? 'disabled' : ''}>
              ${canAfford ? `Open · ${money(cr.price)}` : `Need ${money(cr.price)}`}
            </button>
          </div>
        </div>
      `;
    }).join('');

    $$('#marketplaceCratesGrid [data-inspect-crate]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        titleSystemState.selectedCrateId = btn.dataset.inspectCrate;
        renderMarketplacePage();
      });
    });
    $$('#marketplaceCratesGrid [data-select-crate]').forEach(card => {
      card.addEventListener('click', () => {
        titleSystemState.selectedCrateId = card.dataset.selectCrate;
        renderMarketplacePage();
      });
    });
    $$('#marketplaceCratesGrid [data-open-crate]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openCrateWithAnimation(btn.dataset.openCrate);
      });
    });
  }

  const activeCrate = STORE_CRATES.find(c => c.id === titleSystemState.selectedCrateId) || STORE_CRATES[0];
  if ($('#mktContentsEyebrow')) {
    $('#mktContentsEyebrow').textContent = activeCrate.ultra ? 'ULTRA CRATE CONTENTS · 2X HIGHER TIERS' : 'DEFAULT CRATE CONTENTS';
  }
  if ($('#mktContentsTitle')) $('#mktContentsTitle').textContent = `${activeCrate.name} · Season 1 Titles`;
  if ($('#mktContentsSub')) {
    $('#mktContentsSub').textContent = activeCrate.ultra
      ? 'Epic, Legendary, and Mythic drop rates are doubled compared to Default Crate 1. Duplicate titles refund 50%!'
      : 'All 12 Season 1 Titles can drop from this crate. Duplicate titles refund 50% of the crate cost!';
  }
  const openSelBtn = $('#mktOpenSelectedBtn');
  if (openSelBtn) {
    const canAfford = Number(currentUser.cash || 0) >= activeCrate.price;
    openSelBtn.textContent = `Open ${activeCrate.name} · ${money(activeCrate.price)}`;
    openSelBtn.disabled = !canAfford || titleSystemState.isOpening;
    openSelBtn.onclick = () => openCrateWithAnimation(activeCrate.id);
  }

  const oddsBar = $('#mktOddsBar');
  if (oddsBar) {
    oddsBar.innerHTML = Object.entries(activeCrate.tierWeights).map(([rar, pct]) => `
      <span class="mkt-odds-pill rarity-${escapeHtml(rar)}">
        <i></i>${escapeHtml(TITLE_RARITIES[rar]?.label || rar)}: <strong>${pct}%</strong>
      </span>
    `).join('');
  }

  const contentsGrid = $('#mktContentsGrid');
  if (contentsGrid) {
    const sorted = [...SEASON_1_TITLES].sort((a, b) => (TITLE_RARITIES[b.rarity]?.order || 0) - (TITLE_RARITIES[a.rarity]?.order || 0));
    contentsGrid.innerHTML = sorted.map(item => {
      const rar = TITLE_RARITIES[item.rarity] || TITLE_RARITIES.common;
      const owned = titleSystemState.ownedIds.has(item.id);
      const chance = getCrateItemChancePct(activeCrate, item.rarity);
      return `
        <div class="mkt-item-card rarity-${escapeHtml(rar.key)} ${owned ? 'is-owned' : ''}">
          <div class="mkt-item-top">
            <span class="mkt-item-rarity">${escapeHtml(rar.label)}</span>
            <span class="mkt-item-chance">${chance.toFixed(2)}%</span>
          </div>
          <div class="mkt-item-name">${escapeHtml(item.name)}</div>
          <div class="mkt-item-foot">
            ${owned ? '<span class="mkt-owned-tag">✓ Owned</span>' : '<span class="muted tiny">Title</span>'}
          </div>
        </div>
      `;
    }).join('');
  }

  const lockerGrid = $('#mktLockerGrid');
  if (lockerGrid) {
    const sorted = [...SEASON_1_TITLES].sort((a, b) => (TITLE_RARITIES[b.rarity]?.order || 0) - (TITLE_RARITIES[a.rarity]?.order || 0));
    lockerGrid.innerHTML = sorted.map(item => {
      const rar = TITLE_RARITIES[item.rarity] || TITLE_RARITIES.common;
      const owned = titleSystemState.ownedIds.has(item.id);
      const isEquipped = equippedId === item.id;
      return `
        <div class="mkt-item-card rarity-${escapeHtml(rar.key)} ${owned ? 'is-owned' : 'is-locked'} ${isEquipped ? 'is-equipped' : ''}">
          <div class="mkt-item-top">
            <span class="mkt-item-rarity">${escapeHtml(rar.label)}</span>
            ${isEquipped ? '<span class="mkt-equipped-tag">Equipped</span>' : (owned ? '<span class="mkt-owned-tag">Unlocked</span>' : '<span class="muted tiny">Locked</span>')}
          </div>
          <div class="mkt-item-name">${escapeHtml(item.name)}</div>
          <div class="mkt-item-foot">
            ${owned
              ? `<button type="button" class="${isEquipped ? 'zoom-btn' : 'primary-btn'} mkt-equip-btn" data-equip-title="${escapeHtml(isEquipped ? '' : item.id)}">${isEquipped ? 'Unequip' : 'Equip'}</button>`
              : '<span class="muted tiny">Unbox in Crate 1</span>'}
          </div>
        </div>
      `;
    }).join('');

    $$('#mktLockerGrid [data-equip-title]').forEach(btn => {
      btn.addEventListener('click', () => {
        equipUserTitle(btn.dataset.equipTitle || null);
      });
    });
  }
}

$('#mktUnequipTitleBtn')?.addEventListener('click', () => equipUserTitle(null));

function closeCrateModal() {
  if (titleSystemState.spinRaf) {
    cancelAnimationFrame(titleSystemState.spinRaf);
    titleSystemState.spinRaf = null;
  }
  titleSystemState.isSpinning = false;
  titleSystemState.isOpening = false;
  if (titleSystemState.lastReveal?.finalCash != null && currentUser) {
    const settled = titleSystemState.lastReveal.finalCash;
    currentUser.cash = settled;
    if ($('#topCash')) $('#topCash').textContent = money(settled);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(settled);
    if ($('#mktCashPill')) $('#mktCashPill').textContent = money(settled);
    updateNetWorth();
  }
  hideModalSmooth($('#crateOpenModal'));
  renderMarketplacePage();
}

function showCrateRevealResult(crate, rolledItem, isDuplicate, refund = 0, finalCash = null) {
  titleSystemState.isSpinning = false;
  if (titleSystemState.spinRaf) {
    cancelAnimationFrame(titleSystemState.spinRaf);
    titleSystemState.spinRaf = null;
  }

  if (finalCash != null && currentUser) {
    currentUser.cash = finalCash;
    if ($('#topCash')) $('#topCash').textContent = money(finalCash);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(finalCash);
    if ($('#mktCashPill')) $('#mktCashPill').textContent = money(finalCash);
    updateNetWorth();
  }

  const skipBtn = $('#crateSkipSpinBtn');
  const closeBtn = $('#closeCrateModalBtn');
  const caption = $('#crateSpinCaption');
  const panel = $('#crateRevealPanel');
  const tierEl = $('#crateRevealTier');
  const nameEl = $('#crateRevealItemName');
  const statusEl = $('#crateRevealStatus');
  const equipBtn = $('#crateEquipRewardBtn');
  const againBtn = $('#crateOpenAgainBtn');
  const card = $('#crateOpenCard');

  if (skipBtn) skipBtn.classList.add('hidden');
  if (closeBtn) closeBtn.classList.remove('hidden');
  if (caption) caption.classList.add('hidden');

  const rar = TITLE_RARITIES[rolledItem.rarity] || TITLE_RARITIES.common;
  if (card) {
    card.dataset.revealRarity = rar.key;
  }
  if (tierEl) tierEl.textContent = rar.label.toUpperCase();
  if (nameEl) nameEl.textContent = rolledItem.name;
  if (statusEl) {
    if (isDuplicate) {
      statusEl.textContent = `ALREADY OWNED · +${money(refund)} (50% crate cashback)`;
      statusEl.className = 'crate-reveal-status is-dup';
      if (refund > 0) {
        $('.cash-pill')?.classList.add('cash-pulse');
        setTimeout(() => $('.cash-pill')?.classList.remove('cash-pulse'), 620);
      }
    } else {
      statusEl.textContent = 'NEW TITLE UNLOCKED!';
      statusEl.className = 'crate-reveal-status is-new';
    }
  }
  if (equipBtn && currentUser) {
    const alreadyEquipped = getUserEquippedTitleId(currentUser.id) === rolledItem.id;
    equipBtn.textContent = alreadyEquipped ? 'Already Equipped' : 'Equip Title';
    equipBtn.disabled = alreadyEquipped;
    equipBtn.onclick = async () => {
      await equipUserTitle(rolledItem.id);
      equipBtn.textContent = 'Equipped ✓';
      equipBtn.disabled = true;
    };
  }
  if (againBtn && currentUser) {
    const canAgain = Number(currentUser.cash || 0) >= crate.price;
    againBtn.textContent = `Open Another · ${money(crate.price)}`;
    againBtn.disabled = !canAgain;
    againBtn.onclick = () => openCrateWithAnimation(crate.id);
  }
  if (panel) {
    panel.className = `crate-reveal-panel rarity-${rar.key}`;
  }

  playCrateRevealSound(rar.key);
  renderMarketplacePage();
  renderAccountIdentityAndTitles();
}

async function openCrateWithAnimation(crateId) {
  if (!currentUser?.id || !sb || titleSystemState.isOpening || titleSystemState.isSpinning) return;
  const crate = STORE_CRATES.find(c => c.id === crateId) || STORE_CRATES[0];

  titleSystemState.isOpening = true;
  if (currentPage === 'marketplace') renderMarketplacePage();

  let liveCash = Number(currentUser.cash || 0);
  try {
    const { data: profRow } = await sb
      .from('profiles')
      .select('cash')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (profRow && profRow.cash != null) liveCash = Number(profRow.cash);
  } catch (e) {}

  if (liveCash < crate.price) {
    titleSystemState.isOpening = false;
    if (currentPage === 'marketplace') renderMarketplacePage();
    toast(`You need ${money(crate.price)} to open ${crate.name}.`);
    return;
  }

  const rolled = rollItemFromCrate(crate);
  const isDuplicate = titleSystemState.ownedIds.has(rolled.id);
  const refund = isDuplicate ? Math.round((crate.price * 0.5) * 100) / 100 : 0;
  const newCash = Math.round((liveCash - crate.price) * 100) / 100;
  const finalCash = Math.round((newCash + refund) * 100) / 100;

  const { error: cashErr } = await sb
    .from('profiles')
    .update({ cash: finalCash })
    .eq('id', currentUser.id);

  if (cashErr) {
    titleSystemState.isOpening = false;
    if (currentPage === 'marketplace') renderMarketplacePage();
    toast('Purchase failed: ' + cashErr.message);
    return;
  }

  currentUser.cash = newCash;
  if ($('#topCash')) $('#topCash').textContent = money(newCash);
  if ($('#moneyCash')) $('#moneyCash').textContent = money(newCash);
  if ($('#mktCashPill')) $('#mktCashPill').textContent = money(newCash);
  updateNetWorth();

  if (!isDuplicate) {
    titleSystemState.ownedIds.add(rolled.id);
    writeLocalOwnedTitles(currentUser.id, titleSystemState.ownedIds);
    try {
      await sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__CRATE_ITEM__:' + JSON.stringify({
          itemId: rolled.id,
          crateId: crate.id,
          ts: Date.now()
        }),
        status: 'denied'
      });
    } catch (e) {}
  }

  titleSystemState.lastReveal = { crate, item: rolled, isDuplicate, refund, finalCash };
  titleSystemState.isOpening = false;

  // Build CSGO roulette reel (66 cards, winner anchored at index 52)
  const WIN_INDEX = 52;
  const TOTAL_CARDS = 66;
  const reelCards = [];
  for (let i = 0; i < TOTAL_CARDS; i++) {
    reelCards.push(i === WIN_INDEX ? rolled : rollItemFromCrate(crate));
  }

  const modal = $('#crateOpenModal');
  const card = $('#crateOpenCard');
  const titleEl = $('#crateOpenTitle');
  const eyebrowEl = $('#crateOpenEyebrow');
  const reelEl = $('#crateReel');
  const viewportEl = $('#crateSpinnerViewport');
  const skipBtn = $('#crateSkipSpinBtn');
  const closeBtn = $('#closeCrateModalBtn');
  const caption = $('#crateSpinCaption');
  const revealPanel = $('#crateRevealPanel');

  if (!modal || !reelEl || !viewportEl) {
    toast(`Unboxed: ${rolled.name}${isDuplicate ? ' (Already Owned)' : ''}`);
    renderMarketplacePage();
    return;
  }

  if (card) delete card.dataset.revealRarity;
  if (eyebrowEl) eyebrowEl.textContent = crate.ultra ? 'ULTRA CRATE · 2X HIGHER TIERS' : 'SEASON 1 TITLE CRATE';
  if (titleEl) titleEl.textContent = crate.name;
  if (skipBtn) skipBtn.classList.remove('hidden');
  if (closeBtn) closeBtn.classList.add('hidden');
  if (caption) {
    caption.classList.remove('hidden');
    caption.textContent = 'Spinning crate...';
  }
  if (revealPanel) revealPanel.className = 'crate-reveal-panel hidden';

  reelEl.innerHTML = reelCards.map((it, idx) => {
    const r = TITLE_RARITIES[it.rarity] || TITLE_RARITIES.common;
    return `
      <div class="crate-reel-card rarity-${escapeHtml(r.key)} ${idx === WIN_INDEX ? 'is-target' : ''}">
        <div class="crate-reel-tier">${escapeHtml(r.label)}</div>
        <div class="crate-reel-name">${escapeHtml(it.name)}</div>
        <div class="crate-reel-strip"></div>
      </div>
    `;
  }).join('');

  reelEl.style.transform = 'translate3d(0px, 0, 0)';
  modal.classList.remove('hidden');
  titleSystemState.isSpinning = true;
  playCrateLatchSound();

  const finishSpinNow = () => {
    const firstCard = reelEl.querySelector('.crate-reel-card');
    const cardW = firstCard ? firstCard.getBoundingClientRect().width : 138;
    const gap = 10;
    const step = cardW + gap;
    const centerX = (viewportEl.clientWidth || 640) / 2;
    const finalX = Math.max(0, (WIN_INDEX * step + cardW / 2) - centerX);
    reelEl.style.transform = `translate3d(-${finalX.toFixed(1)}px, 0, 0)`;
    showCrateRevealResult(crate, rolled, isDuplicate, refund, finalCash);
  };

  if (skipBtn) {
    skipBtn.onclick = () => {
      if (titleSystemState.isSpinning) finishSpinNow();
    };
  }

  requestAnimationFrame(() => {
    if (!titleSystemState.isSpinning) return;
    const firstCard = reelEl.querySelector('.crate-reel-card');
    const cardW = firstCard ? firstCard.getBoundingClientRect().width : 138;
    const gap = 10;
    const step = cardW + gap;
    const centerX = (viewportEl.clientWidth || 640) / 2;
    const jitter = (Math.random() - 0.5) * (cardW * 0.48);
    const targetX = Math.max(0, (WIN_INDEX * step + cardW / 2 + jitter) - centerX);

    const startTime = performance.now();
    const duration = 5300;
    let lastPassedIdx = Math.floor(centerX / step);

    const tick = (now) => {
      if (!titleSystemState.isSpinning) return;
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      // Quintic ease-out for long suspenseful CSGO slowdown
      const eased = 1 - Math.pow(1 - t, 4.4);
      const currX = targetX * eased;
      reelEl.style.transform = `translate3d(-${currX.toFixed(2)}px, 0, 0)`;

      const currentCenterIdx = Math.floor((currX + centerX) / step);
      if (currentCenterIdx !== lastPassedIdx) {
        lastPassedIdx = currentCenterIdx;
        playCrateTickSound(1 - t);
      }

      if (t < 1) {
        titleSystemState.spinRaf = requestAnimationFrame(tick);
      } else {
        titleSystemState.spinRaf = null;
        if (caption) caption.textContent = `Landed on ${rolled.name}!`;
        setTimeout(() => {
          if (titleSystemState.isSpinning) showCrateRevealResult(crate, rolled, isDuplicate, refund, finalCash);
        }, 320);
      }
    };

    titleSystemState.spinRaf = requestAnimationFrame(tick);
  });
}

$('#closeCrateModalBtn')?.addEventListener('click', closeCrateModal);
$('#crateDoneBtn')?.addEventListener('click', closeCrateModal);
$('#crateOpenModal')?.addEventListener('click', e => {
  if (e.target === $('#crateOpenModal') && !titleSystemState.isSpinning) closeCrateModal();
});

// ============================================================
// ---------- TRADER BATTLE SYSTEM (2h–96h · SHRINKING BAR) ---
// ============================================================
const TB_ALLOWED_MINS = [120, 480, 720, 1440, 2880, 5760];
const tbState = {
  rawRows: [],
  rawRowIds: new Set(),
  lastRowCreatedAt: '',
  battles: new Map(),
  loaded: false,
  lastSyncAt: 0,
  syncPromise: null,
  tickTimer: null,
  liveSyncTimer: null,
  liveRefreshInFlight: false,
  challengeTarget: null,
  selectedMins: 120,
  selectedMode: 'fixed',
  maxStakeAllowed: 0,
  targetFreshNw: 0,
  myFreshNw: 0,
  activeInfoBattleId: null,
  lastSnapshotByBattle: new Map(),
  settlingIds: new Set(),
  payingIds: new Set(),
  lsCacheKey: 'grind_tb_cache_v1',
  lsResultShownPrefix: 'grind_tb_popup_shown_v1_'
};

function computeClassicBattlePrize(cScore, oScore, cEndNw, oEndNw) {
  const totalPositiveGains = Math.max(0, round2(cScore)) + Math.max(0, round2(oScore));
  const halfPool = Math.max(0, round2(totalPositiveGains / 2));
  const diff = round2(cScore - oScore);
  if (Math.abs(diff) < 0.01) return halfPool;
  const trailerNw = diff > 0 ? oEndNw : cEndNw;
  return Math.max(0, floor2(Math.min(halfPool, Math.max(0, round2(trailerNw)))));
}

function formatTbStakeLabel(b) {
  if (b?.mode === 'classic') return '🔥 Classic Mode (½ Gains)';
  return money(b?.initialStake || 0);
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function floor2(n) {
  return Math.floor(((Number(n) || 0) + 1e-9) * 100) / 100;
}

function formatTbDuration(mins) {
  const m = Math.max(1, Math.round(Number(mins) || 120));
  if (m >= 60 && m % 60 === 0) return `${m / 60}h`;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  return `${m}m`;
}

function formatTbCountdown(msLeft) {
  const s = Math.max(0, Math.floor((msLeft || 0) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return `${h}:${pad(m)}:${pad(sec)}`;
}

function signedMoney(n) {
  const v = round2(n);
  if (v > 0) return `+${money(v)}`;
  if (v < 0) return `-${money(Math.abs(v))}`;
  return money(0);
}

function readTbLocalCache() {
  try {
    const raw = localStorage.getItem(tbState.lsCacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.rows)) return parsed;
  } catch (e) {}
  return null;
}

function writeTbLocalCache() {
  try {
    const trimmed = tbState.rawRows.slice(-400);
    localStorage.setItem(tbState.lsCacheKey, JSON.stringify({
      lastRowCreatedAt: tbState.lastRowCreatedAt || '',
      rows: trimmed
    }));
  } catch (e) {}
}

function hasShownTbResultPopup(battleId) {
  const uid = currentUser?.id ? String(currentUser.id) : '';
  if (!uid || !battleId) return false;
  try {
    return localStorage.getItem(tbState.lsResultShownPrefix + uid + '_' + battleId) === '1';
  } catch (e) {
    return false;
  }
}

function markTbResultPopupShown(battleId) {
  const uid = currentUser?.id ? String(currentUser.id) : '';
  if (!uid || !battleId) return;
  try {
    localStorage.setItem(tbState.lsResultShownPrefix + uid + '_' + battleId, '1');
  } catch (e) {}
}

function resetTraderBattleStateOnLogout() {
  tbState.activeInfoBattleId = null;
  tbState.challengeTarget = null;
  if (tbState.tickTimer) {
    clearInterval(tbState.tickTimer);
    tbState.tickTimer = null;
  }
  if (tbState.liveSyncTimer) {
    clearInterval(tbState.liveSyncTimer);
    tbState.liveSyncTimer = null;
  }
  $('#topBattlePill')?.classList.add('hidden');
  $('#traderBattleModal')?.classList.add('hidden');
  $('#traderBattleInfoModal')?.classList.add('hidden');
  $('#traderBattleResultModal')?.classList.add('hidden');
}

function rebuildTraderBattlesFromRows() {
  const srvResetTs = adminModStateCache.serverResetTs || 0;
  const battles = new Map();

  for (const r of tbState.rawRows) {
    const reason = String(r.reason || '');
    const rowTs = r.created_at ? new Date(r.created_at).getTime() : 0;
    if (srvResetTs > 0 && rowTs > 0 && rowTs <= srvResetTs) continue;

    if (reason.startsWith('__TB_CHALLENGE__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_CHALLENGE__:'.length));
        if (!p || !p.id || !p.challengerId || !p.opponentId) continue;
        const ts = Number(p.ts) || rowTs || Date.now();
        if (srvResetTs > 0 && ts <= srvResetTs) continue;
        battles.set(String(p.id), {
          id: String(p.id),
          challengerId: String(p.challengerId),
          opponentId: String(p.opponentId),
          mode: p.mode === 'classic' ? 'classic' : 'fixed',
          initialStake: p.mode === 'classic' ? 0 : round2(p.stake),
          minStake: p.mode === 'classic' ? 0 : round2(p.stake),
          livePrize: 0,
          durationMins: Math.max(1, Number(p.durationMins) || 120),
          createdAt: ts,
          startedAt: 0,
          endsAt: 0,
          challengerStartNw: 0,
          opponentStartNw: 0,
          status: 'pending',
          declinedBy: null,
          cancelledBy: null,
          result: null,
          paidUsers: new Set(),
          barEvents: []
        });
      } catch (e) {}
    } else if (reason.startsWith('__TB_ACCEPT__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_ACCEPT__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        if (!b || b.status !== 'pending') continue;
        b.status = 'active';
        b.startedAt = Number(p.startedAt) || rowTs || Date.now();
        b.endsAt = Number(p.endsAt) || (b.startedAt + b.durationMins * 60000);
        b.challengerStartNw = round2(p.challengerStartNw);
        b.opponentStartNw = round2(p.opponentStartNw);
        const accStake = round2(p.initialStake);
        if (accStake >= 0 && accStake < b.minStake) b.minStake = accStake;
      } catch (e) {}
    } else if (reason.startsWith('__TB_DECLINE__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_DECLINE__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        if (!b || b.status !== 'pending') continue;
        b.status = 'declined';
        b.declinedBy = String(p.byId || r.user_id || '');
      } catch (e) {}
    } else if (reason.startsWith('__TB_CANCEL__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_CANCEL__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        // Never allow stopping a battle mid-battle once accepted/active!
        if (!b || b.status !== 'pending') continue;
        b.status = 'cancelled';
        b.cancelledBy = String(p.byId || r.user_id || '');
      } catch (e) {}
    } else if (reason.startsWith('__TB_BAR__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_BAR__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        if (!b || b.status !== 'active') continue;
        const newBar = Math.max(0, round2(p.stake));
        if (newBar < b.minStake) b.minStake = newBar;
        b.barEvents.push({ stake: newBar, byId: String(p.byId || ''), ts: Number(p.ts) || rowTs });
      } catch (e) {}
    } else if (reason.startsWith('__TB_RESULT__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_RESULT__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        if (!b || b.result) continue;
        b.status = 'completed';
        b.result = p;
        b.minStake = Math.max(0, round2(p.finalPrize));
      } catch (e) {}
    } else if (reason.startsWith('__TB_PAID__:')) {
      try {
        const p = JSON.parse(reason.slice('__TB_PAID__:'.length));
        const b = p?.id ? battles.get(String(p.id)) : null;
        const uid = String(p?.userId || r.user_id || '');
        if (b && uid) b.paidUsers.add(uid);
      } catch (e) {}
    }
  }

  tbState.battles = battles;
}

async function loadTraderBattles(force = false) {
  if (!sb) return;
  const now = Date.now();
  if (tbState.syncPromise) return tbState.syncPromise;
  if (!force && tbState.loaded && (now - tbState.lastSyncAt) < 12000) return;

  tbState.syncPromise = (async () => {
    try {
      if (!tbState.loaded) {
        const cached = readTbLocalCache();
        if (cached) {
          tbState.rawRows = cached.rows || [];
          tbState.rawRowIds = new Set(tbState.rawRows.map(x => String(x.id)));
          tbState.lastRowCreatedAt = cached.lastRowCreatedAt || '';
          rebuildTraderBattlesFromRows();
        }
      }

      let q = sb
        .from('premium_requests')
        .select('id, user_id, reason, created_at')
        .like('reason', '__TB_%')
        .order('created_at', { ascending: true })
        .limit(400);

      if (tbState.lastRowCreatedAt) {
        q = q.gte('created_at', tbState.lastRowCreatedAt);
      }

      const { data: deltaRows, error } = await q;
      if (!error && Array.isArray(deltaRows)) {
        let added = 0;
        for (const row of deltaRows) {
          const rid = String(row.id || '');
          if (rid && tbState.rawRowIds.has(rid)) continue;
          if (rid) tbState.rawRowIds.add(rid);
          tbState.rawRows.push(row);
          if (row.created_at && (!tbState.lastRowCreatedAt || row.created_at > tbState.lastRowCreatedAt)) {
            tbState.lastRowCreatedAt = row.created_at;
          }
          added++;
        }
        if (added > 0) writeTbLocalCache();
      }

      rebuildTraderBattlesFromRows();

      const uids = [];
      tbState.battles.forEach(b => {
        uids.push(b.challengerId, b.opponentId);
      });
      if (uids.length) await ensureProfilesCached(uids);

      tbState.loaded = true;
      tbState.lastSyncAt = Date.now();
      updateTraderBattleHud();
    } catch (e) {
      // Soft fail
    } finally {
      tbState.syncPromise = null;
    }
  })();

  return tbState.syncPromise;
}

function getMyTraderBattles() {
  const uid = currentUser?.id ? String(currentUser.id) : '';
  if (!uid) return [];
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const out = [];
  tbState.battles.forEach(b => {
    if (b.challengerId !== uid && b.opponentId !== uid) return;
    if (delUsers.has(b.challengerId) || delUsers.has(b.opponentId)) return;
    out.push(b);
  });
  out.sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
  return out;
}

function getProfileSafe(userId) {
  const uid = String(userId || '');
  if (currentUser && String(currentUser.id) === uid) return currentUser;
  return sharedProfilesCache.get(uid) || { id: uid, username: 'Trader', avatar_url: '', is_premium: false };
}

function updateTraderBattleHud() {
  const pill = $('#topBattlePill');
  if (!currentUser) {
    pill?.classList.add('hidden');
    if (tbState.tickTimer) {
      clearInterval(tbState.tickTimer);
      tbState.tickTimer = null;
    }
    return;
  }

  const uid = String(currentUser.id);
  const mine = getMyTraderBattles();
  const active = mine.filter(b => b.status === 'active');
  const pendingIncoming = mine.filter(b => b.status === 'pending' && b.opponentId === uid);
  const pendingOutgoing = mine.filter(b => b.status === 'pending' && b.challengerId === uid);

  const primary = active[0] || pendingIncoming[0] || pendingOutgoing[0] || null;
  if (pill) {
    if (!primary) {
      pill.classList.add('hidden');
    } else if (primary.status === 'active') {
      const msLeft = Math.max(0, primary.endsAt - Date.now());
      pill.classList.remove('hidden', 'is-pending');
      const prizeTxt = primary.mode === 'classic'
        ? `Classic ${money(primary.livePrize || 0)}`
        : money(primary.minStake);
      pill.textContent = `⚔️ ${formatTbCountdown(msLeft)} · ${prizeTxt}`;
      pill.onclick = () => openTraderBattleInfoModal(primary.id);
    } else if (primary.opponentId === uid) {
      const opp = getProfileSafe(primary.challengerId);
      pill.classList.remove('hidden');
      pill.classList.add('is-pending');
      pill.textContent = `⚔️ Request (${opp.username || 'Trader'})`;
      pill.onclick = () => openTraderBattleInfoModal(primary.id);
    } else {
      pill.classList.remove('hidden');
      pill.classList.add('is-pending');
      pill.textContent = `⚔️ Pending (${primary.mode === 'classic' ? 'Classic' : money(primary.initialStake)})`;
      pill.onclick = () => openTraderBattleInfoModal(primary.id);
    }
  }

  // Live countdown inside open Battle Info Modal
  if (tbState.activeInfoBattleId && !$('#traderBattleInfoModal')?.classList.contains('hidden')) {
    const countdownEl = $('#tbInfoCountdownValue');
    const b = tbState.battles.get(tbState.activeInfoBattleId);
    if (countdownEl && b && b.status === 'active') {
      const left = Math.max(0, b.endsAt - Date.now());
      countdownEl.textContent = left > 0 ? formatTbCountdown(left) : 'Settling...';
    }
  }

  const needsTick = active.length > 0;
  if (needsTick && !tbState.tickTimer) {
    tbState.tickTimer = setInterval(() => {
      updateTraderBattleHud();
      const now = Date.now();
      const myActive = getMyTraderBattles().filter(b => b.status === 'active');
      if (myActive.some(b => now >= b.endsAt)) {
        evaluateTraderBattles();
      }
    }, 1000);
  } else if (!needsTick && tbState.tickTimer) {
    clearInterval(tbState.tickTimer);
    tbState.tickTimer = null;
  }
}

async function openTraderBattleChallengeModal(opponentProfile) {
  if (!currentUser || !sb) return toast('Log in to challenge traders.');
  if (!opponentProfile?.id || String(opponentProfile.id) === String(currentUser.id)) return;
  if (currentUser.is_banned) return toast('Your account is restricted.');

  await loadTraderBattles(false);
  const myUid = String(currentUser.id);
  const oppUid = String(opponentProfile.id);

  // Prevent duplicate pending or active battle against same opponent
  const existing = getMyTraderBattles().find(b =>
    (b.status === 'pending' || b.status === 'active') &&
    ((b.challengerId === myUid && b.opponentId === oppUid) || (b.challengerId === oppUid && b.opponentId === myUid))
  );
  if (existing) {
    return openTraderBattleInfoModal(existing.id);
  }

  tbState.challengeTarget = opponentProfile;
  tbState.selectedMins = 120; // Default 2h
  tbState.selectedMode = 'fixed';

  const modal = $('#traderBattleModal');
  if (!modal) return;
  $('#tbOpponentMeta').textContent = `Challenging @${opponentProfile.username || 'Trader'}`;
  $('#tbStepLength')?.classList.remove('hidden');
  $('#tbStepPrice')?.classList.add('hidden');
  if ($('#tbLengthMsg')) $('#tbLengthMsg').textContent = '';
  if ($('#tbPriceMsg')) $('#tbPriceMsg').textContent = '';
  if ($('#tbStakeInput')) $('#tbStakeInput').value = '';
  setTbPrizeMode('fixed');

  $$('#tbLengthPresets .tb-preset-chip').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.tbMins) === tbState.selectedMins);
  });

  modal.classList.remove('hidden');
}

function setTbPrizeMode(mode) {
  tbState.selectedMode = mode === 'classic' ? 'classic' : 'fixed';
  $$('#tbPriceModeTabs .tb-mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tbMode === tbState.selectedMode);
  });
  $('#tbFixedStakePanel')?.classList.toggle('hidden', tbState.selectedMode === 'classic');
  $('#tbClassicModePanel')?.classList.toggle('hidden', tbState.selectedMode !== 'classic');

  const sendBtn = $('#tbSendChallengeBtn');
  const priceMsg = $('#tbPriceMsg');
  if (tbState.selectedMode === 'classic') {
    if (sendBtn) sendBtn.disabled = false;
    if (priceMsg) priceMsg.textContent = '';
  } else {
    if (sendBtn) sendBtn.disabled = tbState.maxStakeAllowed < 1;
    if (priceMsg) {
      priceMsg.textContent = tbState.maxStakeAllowed < 1
        ? 'Both players need at least $1.00 total money for a Set Stake battle (or switch to Classic Mode).'
        : '';
    }
  }
}

function closeTraderBattleModal() {
  $('#traderBattleModal')?.classList.add('hidden');
  tbState.challengeTarget = null;
}

async function proceedToTraderBattlePriceStep() {
  if (!currentUser || !sb || !tbState.challengeTarget) return;
  const opp = tbState.challengeTarget;
  const lengthMsg = $('#tbLengthMsg');

  if (!TB_ALLOWED_MINS.includes(tbState.selectedMins)) {
    if (lengthMsg) lengthMsg.textContent = 'Select a valid battle length (2h, 8h, 12h, 24h, 48h, or 96h).';
    return;
  }
  if (lengthMsg) lengthMsg.textContent = '';

  const nextBtn = $('#tbNextToPriceBtn');
  if (nextBtn) nextBtn.disabled = true;

  try {
    await updateNetWorth();
    const [{ data: myProf }, { data: oppProf }] = await Promise.all([
      sb.from('profiles').select('id, username, cash, net_worth').eq('id', currentUser.id).maybeSingle(),
      sb.from('profiles').select('id, username, cash, net_worth').eq('id', opp.id).maybeSingle()
    ]);

    const myNw = Math.max(0, round2(myProf?.net_worth ?? currentUser.net_worth ?? currentUser.cash ?? 0));
    const oppNw = Math.max(0, round2(oppProf?.net_worth ?? opp.net_worth ?? opp.cash ?? 0));
    const maxAllowed = floor2(Math.min(myNw, oppNw));

    tbState.myFreshNw = myNw;
    tbState.targetFreshNw = oppNw;
    tbState.maxStakeAllowed = maxAllowed;

    const sumEl = $('#tbBalancesSummary');
    if (sumEl) {
      sumEl.innerHTML = `
        <div class="tb-balance-card">
          <div class="muted tiny">Your Total Money</div>
          <strong>${money(myNw)}</strong>
        </div>
        <div class="tb-balance-card">
          <div class="muted tiny">${escapeHtml(oppProf?.username || opp.username || 'Opponent')}</div>
          <strong>${money(oppNw)}</strong>
        </div>
      `;
    }

    const stakeInput = $('#tbStakeInput');
    if (stakeInput) {
      stakeInput.max = String(maxAllowed);
      const suggested = Math.min(maxAllowed, 50);
      stakeInput.value = maxAllowed >= 1 ? String(suggested >= 1 ? suggested : maxAllowed) : '';
    }

    $$('#tbPricePresets .tb-preset-chip').forEach(btn => {
      const raw = btn.dataset.tbStake;
      if (raw === 'max') {
        btn.disabled = maxAllowed < 1;
        btn.classList.remove('active');
      } else {
        const val = Number(raw);
        btn.disabled = maxAllowed < val;
        btn.classList.toggle('active', stakeInput && Number(stakeInput.value) === val && !btn.disabled);
      }
    });

    setTbPrizeMode(tbState.selectedMode);

    $('#tbStepLength')?.classList.add('hidden');
    $('#tbStepPrice')?.classList.remove('hidden');
  } catch (e) {
    toast('Could not load trader balances.');
  } finally {
    if (nextBtn) nextBtn.disabled = false;
  }
}

async function sendTraderBattleChallenge() {
  if (!currentUser || !sb || !tbState.challengeTarget) return;
  const opp = tbState.challengeTarget;
  const priceMsg = $('#tbPriceMsg');
  const sendBtn = $('#tbSendChallengeBtn');
  const isClassic = tbState.selectedMode === 'classic';
  const stake = isClassic ? 0 : round2(Number($('#tbStakeInput')?.value || 0));

  if (!isClassic) {
    if (!Number.isFinite(stake) || stake < 1) {
      if (priceMsg) priceMsg.textContent = 'Minimum Set Stake is $1.00 (or choose Classic Mode).';
      return;
    }
    if (stake > tbState.maxStakeAllowed + 0.001) {
      if (priceMsg) priceMsg.textContent = `Max stake both players can afford is ${money(tbState.maxStakeAllowed)}.`;
      return;
    }
  }

  if (sendBtn) sendBtn.disabled = true;
  try {
    if (!isClassic) {
      const [{ data: myProf }, { data: oppProf }] = await Promise.all([
        sb.from('profiles').select('net_worth').eq('id', currentUser.id).maybeSingle(),
        sb.from('profiles').select('net_worth').eq('id', opp.id).maybeSingle()
      ]);
      const liveMax = floor2(Math.min(Number(myProf?.net_worth || 0), Number(oppProf?.net_worth || 0)));
      if (stake > liveMax + 0.001) {
        tbState.maxStakeAllowed = liveMax;
        if (priceMsg) priceMsg.textContent = `Balances updated — max stake is now ${money(liveMax)}.`;
        if (sendBtn) sendBtn.disabled = false;
        return;
      }
    }

    const battleId = `tb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = {
      id: battleId,
      challengerId: String(currentUser.id),
      opponentId: String(opp.id),
      mode: isClassic ? 'classic' : 'fixed',
      stake,
      durationMins: tbState.selectedMins,
      ts: Date.now()
    };

    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__TB_CHALLENGE__:' + JSON.stringify(payload),
      status: 'denied'
    });
    if (error) throw error;

    await loadTraderBattles(true);
    playSound('click');
    const modeSummary = isClassic ? 'Classic Mode (½ Gains)' : money(stake);
    toast(`⚔️ Battle request sent to @${opp.username || 'Trader'} (${formatTbDuration(tbState.selectedMins)} · ${modeSummary})!`);
    closeTraderBattleModal();
  } catch (e) {
    if (priceMsg) priceMsg.textContent = 'Failed to send challenge: ' + (e?.message || 'Error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function acceptTraderBattle(battleId) {
  if (!currentUser || !sb || !battleId) return;
  await loadTraderBattles(true);
  const b = tbState.battles.get(String(battleId));
  if (!b) return toast('Battle not found.');
  if (b.opponentId !== String(currentUser.id)) return;
  if (b.status !== 'pending') {
    toast(b.status === 'active' ? 'Battle already started!' : 'This battle request is no longer pending.');
    await loadRequests();
    return;
  }

  try {
    await updateNetWorth();
    const [{ data: cProf }, { data: oProf }] = await Promise.all([
      sb.from('profiles').select('net_worth').eq('id', b.challengerId).maybeSingle(),
      sb.from('profiles').select('net_worth').eq('id', b.opponentId).maybeSingle()
    ]);

    const cNw = Math.max(0, round2(cProf?.net_worth ?? 0));
    const oNw = Math.max(0, round2(oProf?.net_worth ?? currentUser.net_worth ?? currentUser.cash ?? 0));
    const isClassic = b.mode === 'classic';
    if (!isClassic && Math.min(cNw, oNw) < 1) {
      toast('One player no longer has at least $1.00 to start this Set Stake battle.');
      return;
    }

    const initialStake = isClassic ? 0 : Math.max(1, floor2(Math.min(b.initialStake, cNw, oNw)));
    const startedAt = Date.now();
    const endsAt = startedAt + b.durationMins * 60000;

    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__TB_ACCEPT__:' + JSON.stringify({
        id: b.id,
        startedAt,
        endsAt,
        challengerStartNw: cNw,
        opponentStartNw: oNw,
        initialStake,
        ts: startedAt
      }),
      status: 'denied'
    });
    if (error) throw error;

    await loadTraderBattles(true);
    userNotificationsFetchedAt = 0;
    if (currentPage === 'notifications') {
      userNotifsCache = await fetchUserNotifications(true);
      renderUserNotifsList();
    }
    updateNotificationsBadge();
    playSound('buy');
    toast(`⚔️ Trader Battle started! ${formatTbDuration(b.durationMins)} (${isClassic ? 'Classic Mode' : money(initialStake)})!`);
    openTraderBattleInfoModal(b.id);
  } catch (e) {
    toast('Failed to start battle: ' + (e?.message || 'Error'));
  }
}

async function declineTraderBattle(battleId) {
  if (!currentUser || !sb || !battleId) return;
  await loadTraderBattles(true);
  const b = tbState.battles.get(String(battleId));
  if (!b || b.status !== 'pending' || b.opponentId !== String(currentUser.id)) return;

  try {
    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__TB_DECLINE__:' + JSON.stringify({
        id: b.id,
        byId: String(currentUser.id),
        ts: Date.now()
      }),
      status: 'denied'
    });
    if (error) throw error;

    await loadTraderBattles(true);
    userNotificationsFetchedAt = 0;
    if (currentPage === 'notifications') {
      userNotifsCache = await fetchUserNotifications(true);
      renderUserNotifsList();
    }
    updateNotificationsBadge();
    if (tbState.activeInfoBattleId === b.id) $('#traderBattleInfoModal')?.classList.add('hidden');
    toast('Declined Trader Battle request.');
  } catch (e) {
    toast('Could not decline battle.');
  }
}

// Only permitted while STILL PENDING before opponent accepts; strictly blocked mid-battle!
async function cancelPendingTraderBattle(battleId) {
  if (!currentUser || !sb || !battleId) return;
  await loadTraderBattles(true);
  const b = tbState.battles.get(String(battleId));
  if (!b || b.challengerId !== String(currentUser.id)) return;
  if (b.status !== 'pending') {
    return toast('You cannot stop a Trader Battle mid-battle!');
  }
  try {
    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__TB_CANCEL__:' + JSON.stringify({
        id: b.id,
        byId: String(currentUser.id),
        ts: Date.now()
      }),
      status: 'denied'
    });
    if (error) throw error;
    await loadTraderBattles(true);
    $('#traderBattleInfoModal')?.classList.add('hidden');
    toast('Cancelled pending battle request.');
  } catch (e) {
    toast('Could not cancel pending request.');
  }
}

function getActiveTraderBattleForUser(userId) {
  const uid = String(userId || '');
  if (!uid) return null;
  const delUsers = adminModStateCache.deletedUserIds || new Set();
  const matches = [];
  tbState.battles.forEach(b => {
    if (b.status !== 'active') return;
    if (b.challengerId !== uid && b.opponentId !== uid) return;
    if (delUsers.has(b.challengerId) || delUsers.has(b.opponentId)) return;
    matches.push(b);
  });
  matches.sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
  return matches[0] || null;
}

async function refreshActiveBattleModalDom(b, { showLoading = false } = {}) {
  const modal = $('#traderBattleInfoModal');
  const modalCard = modal?.querySelector('.tb-modal-card');
  const body = $('#tbInfoModalBody');
  if (!b || !modal || !body || b.status !== 'active') return;
  if (tbState.liveRefreshInFlight) return;
  tbState.liveRefreshInFlight = true;

  try {
    const uid = currentUser?.id ? String(currentUser.id) : '';
    const isParticipant = uid && (b.challengerId === uid || b.opponentId === uid);
    const isChallenger = uid && b.challengerId === uid;
    const isClassic = b.mode === 'classic';

    if (showLoading) {
      body.innerHTML = `<p class="muted tiny">Loading live battle breakdown...</p>`;
    }

    const sinceIso = new Date(Math.max(0, (b.startedAt || Date.now()) - 2000)).toISOString();
    let cProf = getProfileSafe(b.challengerId);
    let oProf = getProfileSafe(b.opponentId);
    let cNw = isChallenger ? round2(currentUser?.net_worth) : round2(cProf?.net_worth);
    let oNw = (uid && b.opponentId === uid) ? round2(currentUser?.net_worth) : round2(oProf?.net_worth);
    let battleTrades = [];
    let battleHoldings = [];

    try {
      const [cpRes, opRes, trRes, hdRes] = await Promise.all([
        sb.from('profiles').select('id, username, avatar_url, is_premium, net_worth').eq('id', b.challengerId).maybeSingle(),
        sb.from('profiles').select('id, username, avatar_url, is_premium, net_worth').eq('id', b.opponentId).maybeSingle(),
        sb.from('trades')
          .select('id, coin_id, user_id, type, amount_usd, shares, price_after, created_at')
          .in('user_id', [b.challengerId, b.opponentId])
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false })
          .limit(120),
        sb.from('holdings')
          .select('user_id, coin_id, shares')
          .in('user_id', [b.challengerId, b.opponentId])
          .gt('shares', 0.000001)
      ]);
      if (cpRes?.data) {
        cProf = cpRes.data;
        saveSharedProfileToCache(cpRes.data);
        if (cpRes.data.net_worth != null) cNw = round2(cpRes.data.net_worth);
      }
      if (opRes?.data) {
        oProf = opRes.data;
        saveSharedProfileToCache(opRes.data);
        if (opRes.data.net_worth != null) oNw = round2(opRes.data.net_worth);
      }
      battleTrades = Array.isArray(trRes?.data) ? trRes.data : [];
      battleHoldings = Array.isArray(hdRes?.data) ? hdRes.data : [];
    } catch (e) {}

    // If modal was closed while awaiting, bail cleanly
    if (modal.classList.contains('hidden') || tbState.activeInfoBattleId !== b.id) return;

    const coinsById = new Map();
    (coins || []).forEach(c => coinsById.set(String(c.id), c));
    const missingCoinIds = new Set();
    battleTrades.forEach(t => { if (t?.coin_id && !coinsById.has(String(t.coin_id))) missingCoinIds.add(String(t.coin_id)); });
    battleHoldings.forEach(h => { if (h?.coin_id && !coinsById.has(String(h.coin_id))) missingCoinIds.add(String(h.coin_id)); });
    if (missingCoinIds.size > 0) {
      try {
        const { data: extraCoins } = await sb
          .from('coins')
          .select('id, name, ticker, image_url, price, created_at')
          .in('id', Array.from(missingCoinIds));
        (extraCoins || []).forEach(c => coinsById.set(String(c.id), c));
      } catch (e) {}
    }

    const cScore = round2(cNw - b.challengerStartNw);
    const oScore = round2(oNw - b.opponentStartNw);
    const cPct = b.challengerStartNw > 0 ? ((cScore / b.challengerStartNw) * 100) : 0;
    const oPct = b.opponentStartNw > 0 ? ((oScore / b.opponentStartNw) * 100) : 0;

    let livePrize = b.minStake;
    if (isClassic) {
      livePrize = computeClassicBattlePrize(cScore, oScore, cNw, oNw);
      b.livePrize = livePrize;
    } else {
      const minLive = Math.min(cNw, oNw);
      if (isParticipant && minLive < b.minStake - 0.01) {
        const shrunk = Math.max(0, floor2(minLive));
        b.minStake = shrunk;
        sb.from('premium_requests').insert({
          user_id: currentUser.id,
          reason: '__TB_BAR__:' + JSON.stringify({ id: b.id, stake: shrunk, byId: uid, ts: Date.now() }),
          status: 'denied'
        }).then(() => {});
      }
      livePrize = b.minStake;
    }

    // Track +/- prize deltas and score deltas vs previous refresh
    const prev = tbState.lastSnapshotByBattle.get(b.id);
    let prizeDelta = prev ? round2(livePrize - prev.prize) : 0;
    if (Math.abs(prizeDelta) < 0.01 && prev?.recentPrizeDelta && (Date.now() - (prev.recentPrizeDeltaAt || 0)) < 5000) {
      prizeDelta = prev.recentPrizeDelta;
    }
    const cMove = prev ? round2(cScore - prev.cScore) : 0;
    const oMove = prev ? round2(oScore - prev.oScore) : 0;

    tbState.lastSnapshotByBattle.set(b.id, {
      prize: livePrize,
      cScore,
      oScore,
      recentPrizeDelta: Math.abs(prizeDelta) >= 0.01 ? prizeDelta : 0,
      recentPrizeDeltaAt: Math.abs(prizeDelta) >= 0.01 ? Date.now() : (prev?.recentPrizeDeltaAt || 0)
    });

    updateTraderBattleHud();
    const leftMs = Math.max(0, b.endsAt - Date.now());

    const renderPlayerSide = (pObj, playerId, nwNow, startNw, score, pct, moveDelta, isLeading) => {
      const pid = String(playerId);
      const uname = pObj?.username || 'Trader';
      const isMe = uid && pid === uid;
      const pctCls = pct > 0.005 ? 'is-up' : (pct < -0.005 ? 'is-down' : 'is-flat');
      const pctText = `${pct >= 0 ? '▲ +' : '▼ '}${pct.toFixed(2)}%`;

      const scoreSignCls = score > 0.005 ? 'is-plus' : (score < -0.005 ? 'is-minus' : 'is-flat');
      const scoreSignChar = score > 0.005 ? '+' : (score < -0.005 ? '-' : '•');
      const contribHalf = isClassic ? round2(Math.max(0, score) / 2) : 0;
      const moveBadge = Math.abs(moveDelta) >= 0.01
        ? `<span class="tb-prize-delta-badge ${moveDelta > 0 ? 'is-plus' : 'is-minus'}">${moveDelta > 0 ? '+' : '-'} ${money(Math.abs(moveDelta))}</span>`
        : '';

      const pHoldings = battleHoldings
        .filter(h => String(h.user_id) === pid && coinsById.has(String(h.coin_id)))
        .map(h => {
          const c = coinsById.get(String(h.coin_id));
          const val = calcHoldingsValue(c?.price, h.shares);
          return { coin: c, shares: Number(h.shares || 0), val };
        })
        .filter(x => x.val >= 0.01)
        .sort((a, b2) => b2.val - a.val);

      const pTrades = battleTrades.filter(t => String(t.user_id) === pid);

      const holdingsHtml = pHoldings.length
        ? `<div class="tb-held-coins-row">
            ${pHoldings.slice(0, 8).map(h => `
              <button type="button" class="tb-held-chip" data-tb-coin="${escapeHtml(h.coin.id)}" title="Open ${escapeHtml(h.coin.name)}">
                <span>$${escapeHtml(h.coin.ticker || '?')}</span>
                <span style="color:#fff;">${money(h.val)}</span>
              </button>
            `).join('')}
           </div>`
        : '';

      const tradesHtml = pTrades.length
        ? `<div class="tb-trades-list">
            ${pTrades.map(t => {
              const c = coinsById.get(String(t.coin_id));
              const isBuy = t.type === 'buy';
              const amt = round2(t.amount_usd);
              const ts = t.created_at ? new Date(t.created_at).getTime() : 0;
              return `
                <div class="tb-trade-row" data-tb-coin="${escapeHtml(t.coin_id)}">
                  <div class="tb-trade-left">
                    <div class="tb-trade-logo">${c?.image_url ? `<img src="${escapeHtml(c.image_url)}" alt="">` : escapeHtml((c?.ticker || '?')[0])}</div>
                    <div style="min-width:0;">
                      <div style="display:flex;align-items:center;gap:5px;">
                        <span class="tb-trade-type ${isBuy ? 'is-buy' : 'is-sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
                        <strong class="tiny" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">$${escapeHtml(c?.ticker || 'COIN')}</strong>
                      </div>
                      <div class="muted tiny">${ts ? escapeHtml(formatRelativeTime(ts)) : ''} · ${priceFmt(t.price_after || c?.price || 0)}</div>
                    </div>
                  </div>
                  <div style="text-align:right;flex-shrink:0;">
                    <strong class="tiny" style="color:${isBuy ? '#7dd3fc' : 'var(--green)'};">${isBuy ? '-' : '+'}${money(amt)}</strong>
                  </div>
                </div>
              `;
            }).join('')}
           </div>`
        : `<div class="muted tiny" style="padding:8px 0;">No coin trades yet during this battle.</div>`;

      return `
        <div class="tb-side-card ${isLeading ? 'is-leading' : ''}">
          <div class="tb-side-head">
            <div class="tb-side-avatar profile-link" data-tb-profile="${escapeHtml(pid)}">
              ${pObj?.avatar_url ? `<img src="${escapeHtml(pObj.avatar_url)}" alt="">` : escapeHtml((uname[0] || '?').toUpperCase())}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
                <strong class="profile-link" data-tb-profile="${escapeHtml(pid)}">@${escapeHtml(uname)}</strong>${tierBadgeHtml(pObj)}${isMe ? '<span class="muted tiny">(You)</span>' : ''}
              </div>
              <div class="muted tiny">Start ${money(startNw)} → Now <strong style="color:#fff;">${money(nwNow)}</strong></div>
            </div>
          </div>

          <div class="tb-side-stats">
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
              <span class="tb-pm-sign ${scoreSignCls}" title="${score >= 0 ? 'Gaining money' : 'Losing money'}">${scoreSignChar}</span>
              <div>
                <div class="muted tiny">Gained During Battle ${moveBadge}</div>
                <strong style="font-size:17px;color:${score >= 0 ? 'var(--green)' : '#fca5a5'};">${signedMoney(score)}</strong>
                ${isClassic && contribHalf > 0 ? `<div class="muted tiny">Adds <strong style="color:#fde68a;">+${money(contribHalf)}</strong> to Prize Pool</div>` : ''}
              </div>
            </div>
            <span class="tb-pct-badge ${pctCls}">${pctText}</span>
          </div>

          ${holdingsHtml ? `<div><div class="muted tiny" style="margin-bottom:4px;">Active Coins Held</div>${holdingsHtml}</div>` : ''}
          <div>
            <div class="muted tiny" style="margin-bottom:5px;">Trades During Battle (${pTrades.length})</div>
            ${tradesHtml}
          </div>
        </div>
      `;
    };

    const prizeBadgeHtml = Math.abs(prizeDelta) >= 0.01
      ? `<span class="tb-prize-delta-badge ${prizeDelta > 0 ? 'is-plus' : 'is-minus'}">${prizeDelta > 0 ? '+' : '-'} ${money(Math.abs(prizeDelta))}</span>`
      : '';

    const prizeLabelHtml = isClassic
      ? `<span class="tb-prize-live-wrap"><strong style="color:#fde68a;">🔥 Live Prize (½ Gains): ${money(livePrize)}</strong>${prizeBadgeHtml}</span>`
      : `<span class="tb-prize-live-wrap"><strong style="color:#fde68a;">🏆 Prize Money: ${money(livePrize)}${livePrize < b.initialStake ? ` <span class="muted tiny">(shrunk from ${money(b.initialStake)})</span>` : ''}</strong>${prizeBadgeHtml}</span>`;

    modalCard?.classList.add('is-wide');
    body.innerHTML = `
      <div class="tb-result-banner">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <strong>⏱ Time Left: <span id="tbInfoCountdownValue">${leftMs > 0 ? formatTbCountdown(leftMs) : 'Settling...'}</span></strong>
          ${prizeLabelHtml}
        </div>
        <span class="muted tiny">🔒 ${isClassic ? 'Classic Mode · Live half-gains prize updates with + / - changes' : `Battle is live (${escapeHtml(formatTbDuration(b.durationMins))})`} — cannot be stopped mid-battle.</span>
      </div>
      <div class="tb-spectator-grid">
        ${renderPlayerSide(cProf, b.challengerId, cNw, b.challengerStartNw, cScore, cPct, cMove, cScore > oScore)}
        ${renderPlayerSide(oProf, b.opponentId, oNw, b.opponentStartNw, oScore, oPct, oMove, oScore > cScore)}
      </div>
    `;

    body.querySelectorAll('[data-tb-profile]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.tbProfile) {
          closeTbInfoModal();
          openProfileModal(el.dataset.tbProfile);
        }
      });
    });
    body.querySelectorAll('[data-tb-coin]').forEach(el => {
      el.addEventListener('click', () => {
        if (el.dataset.tbCoin) {
          closeTbInfoModal();
          $('#profileModal')?.classList.add('hidden');
          openCoin(el.dataset.tbCoin);
        }
      });
    });

    if (leftMs <= 0 && isParticipant) evaluateTraderBattles();
  } finally {
    tbState.liveRefreshInFlight = false;
  }
}

function closeTbInfoModal() {
  tbState.activeInfoBattleId = null;
  if (tbState.liveSyncTimer) {
    clearInterval(tbState.liveSyncTimer);
    tbState.liveSyncTimer = null;
  }
  const modal = $('#traderBattleInfoModal');
  modal?.querySelector('.tb-modal-card')?.classList.remove('is-wide');
  modal?.classList.add('hidden');
}

function refreshOpenTraderBattleModalLive() {
  if (!tbState.activeInfoBattleId) return;
  const modal = $('#traderBattleInfoModal');
  if (!modal || modal.classList.contains('hidden')) return;
  const b = tbState.battles.get(tbState.activeInfoBattleId);
  if (b && b.status === 'active') {
    refreshActiveBattleModalDom(b, { showLoading: false });
  }
}

async function openTraderBattleInfoModal(battleId) {
  if (!sb || !battleId) return;
  await loadTraderBattles(false);
  const b = tbState.battles.get(String(battleId));
  const modal = $('#traderBattleInfoModal');
  const modalCard = modal?.querySelector('.tb-modal-card');
  const body = $('#tbInfoModalBody');
  if (!b || !modal || !body) return;

  tbState.activeInfoBattleId = b.id;
  if (tbState.liveSyncTimer) {
    clearInterval(tbState.liveSyncTimer);
    tbState.liveSyncTimer = null;
  }

  const uid = currentUser?.id ? String(currentUser.id) : '';
  const isParticipant = uid && (b.challengerId === uid || b.opponentId === uid);
  const isChallenger = uid && b.challengerId === uid;
  const oppId = isChallenger ? b.opponentId : b.challengerId;
  const oppProf = getProfileSafe(oppId);
  const oppName = oppProf.username || 'Trader';

  if (b.status === 'pending') {
    modalCard?.classList.remove('is-wide');
    if (!currentUser || !isParticipant) return;
    const stakeLabel = formatTbStakeLabel(b);
    if (b.opponentId === uid) {
      body.innerHTML = `
        <div class="tb-result-banner">
          <strong>Trader Battle Request From - ${escapeHtml(oppName)}</strong>
          <span class="muted tiny">Length: <strong>${escapeHtml(formatTbDuration(b.durationMins))}</strong> · Prize: <strong style="color:#fde68a;">${escapeHtml(stakeLabel)}</strong></span>
        </div>
        <p class="muted tiny" style="margin:0 0 12px;">If you press Yes, the battle starts immediately and cannot be stopped until time runs out.</p>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="deny-btn" id="tbInfoDeclineBtn" style="padding:9px 16px;">No</button>
          <button type="button" class="primary-btn" id="tbInfoAcceptBtn">⚔️ Yes — Start Battle</button>
        </div>
      `;
      modal.classList.remove('hidden');
      $('#tbInfoAcceptBtn')?.addEventListener('click', () => acceptTraderBattle(b.id));
      $('#tbInfoDeclineBtn')?.addEventListener('click', () => declineTraderBattle(b.id));
    } else {
      body.innerHTML = `
        <div class="tb-result-banner">
          <strong>Waiting for @${escapeHtml(oppName)}</strong>
          <span class="muted tiny">Length: <strong>${escapeHtml(formatTbDuration(b.durationMins))}</strong> · Prize: <strong style="color:#fde68a;">${escapeHtml(stakeLabel)}</strong></span>
        </div>
        <p class="muted tiny" style="margin:0 0 12px;">Your challenge has been sent. Once @${escapeHtml(oppName)} accepts, the battle cannot be stopped mid-battle.</p>
        <div style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="zoom-btn" id="tbInfoWithdrawBtn" style="padding:9px 14px;">Withdraw Request</button>
        </div>
      `;
      modal.classList.remove('hidden');
      $('#tbInfoWithdrawBtn')?.addEventListener('click', () => cancelPendingTraderBattle(b.id));
    }
    return;
  }

  if (b.status === 'active') {
    modalCard?.classList.add('is-wide');
    modal.classList.remove('hidden');
    await refreshActiveBattleModalDom(b, { showLoading: true });
    tbState.liveSyncTimer = setInterval(() => {
      if (modal.classList.contains('hidden') || tbState.activeInfoBattleId !== b.id) {
        clearInterval(tbState.liveSyncTimer);
        tbState.liveSyncTimer = null;
        return;
      }
      const latest = tbState.battles.get(b.id);
      if (latest && latest.status === 'active') {
        refreshActiveBattleModalDom(latest, { showLoading: false });
      }
    }, 4500);
    return;
  }

  if (b.status === 'completed' && b.result) {
    closeTbInfoModal();
    showTraderBattleResultPopup(b);
  }
}

function checkActiveTraderBattleFloor(liveNw) {
  if (!currentUser || !sb || !Number.isFinite(liveNw)) return;
  const uid = String(currentUser.id);
  const mine = getMyTraderBattles().filter(b => b.status === 'active');
  if (!mine.length) return;

  for (const b of mine) {
    if (b.mode === 'classic') continue;
    if (liveNw < b.minStake - 0.01) {
      const shrunk = Math.max(0, floor2(liveNw));
      if (shrunk >= b.minStake) continue;
      b.minStake = shrunk;
      updateTraderBattleHud();
      toast(`📉 Battle stake bar shrunk to ${money(shrunk)} to match minimum funds.`);
      sb.from('premium_requests').insert({
        user_id: currentUser.id,
        reason: '__TB_BAR__:' + JSON.stringify({
          id: b.id,
          stake: shrunk,
          byId: uid,
          ts: Date.now()
        }),
        status: 'denied'
      }).then(() => {});
    }
  }
}

async function deductTraderBattleLossQueued(prizeAmount, battleId) {
  if (!sb || !currentUser?.id || !Number.isFinite(prizeAmount) || prizeAmount <= 0) return true;
  const uid = String(currentUser.id);

  return runPlayCashUpdate(async () => {
    let liveCash = Number(currentUser.cash || 0);
    try {
      const { data: prof } = await sb.from('profiles').select('cash').eq('id', uid).maybeSingle();
      if (prof && prof.cash != null) liveCash = Number(prof.cash);
    } catch (e) {}

    // If liquid cash is below the prize owed, liquidate own coin holdings cleanly via bonding curve
    if (liveCash < prizeAmount) {
      try {
        const srvResetTs = adminModStateCache.serverResetTs || 0;
        const delCoins = adminModStateCache.deletedCoinIds || new Set();
        const { data: holds } = await sb
          .from('holdings')
          .select('coin_id, shares, coins(id, price, today_open_price, created_at)')
          .eq('user_id', uid);

        const validHolds = (holds || []).filter(h =>
          Number(h.shares) > 1e-8 &&
          !delCoins.has(String(h.coin_id)) &&
          h.coins &&
          (!srvResetTs || (h.coins.created_at && new Date(h.coins.created_at).getTime() > srvResetTs))
        );

        for (const h of validHolds) {
          if (liveCash >= prizeAmount - 0.01) break;
          const shortfall = round2(prizeAmount - liveCash);
          const coin = h.coins;
          const owned = Number(h.shares || 0);
          const p = Math.max(Number(coin.price) || 1, 0.01);
          const fullSale = calcCurveSell(p, owned);
          if (fullSale.proceeds <= 0) continue;

          let sellShares = owned;
          if (fullSale.proceeds > shortfall) {
            const targetPrice = Math.max(0.01, p - CURVE_K * shortfall);
            const approxShares = Math.log(p / targetPrice) / CURVE_K;
            sellShares = Math.min(owned, Math.max(0, approxShares * 1.001));
          }
          if (sellShares <= 1e-8) continue;

          const { newPrice, proceeds } = calcCurveSell(p, sellShares);
          const remainingShares = (owned - sellShares) < 1e-8 ? 0 : (owned - sellShares);
          const prevOpen = Number(coin.today_open_price) || p;
          const todayPct = prevOpen > 0 ? ((newPrice - prevOpen) / prevOpen) * 100 : 0;

          await sb.from('holdings').update({ shares: remainingShares }).eq('user_id', uid).eq('coin_id', coin.id);
          await sb.from('coins').update({ price: newPrice, change_pct: todayPct }).eq('id', coin.id);
          await sb.from('trades').insert({
            coin_id: coin.id,
            user_id: uid,
            type: 'sell',
            amount_usd: proceeds,
            shares: sellShares,
            price_after: newPrice
          });
          liveCash = round2(liveCash + proceeds);
        }
      } catch (e) {}
    }

    const newCash = Math.max(0, round2(liveCash - prizeAmount));
    const { error } = await sb.from('profiles').update({ cash: newCash }).eq('id', uid);
    if (error) return false;

    currentUser.cash = newCash;
    if ($('#topCash')) $('#topCash').textContent = money(newCash);
    if ($('#moneyCash')) $('#moneyCash').textContent = money(newCash);
    await updateNetWorth();
    return true;
  });
}

async function applyOwnTraderBattleSettlement(battle) {
  if (!currentUser || !sb || !battle?.result) return;
  const uid = String(currentUser.id);
  if (battle.challengerId !== uid && battle.opponentId !== uid) return;

  const res = battle.result;
  if (!battle.paidUsers.has(uid) && !tbState.payingIds.has(battle.id)) {
    tbState.payingIds.add(battle.id);
    try {
      const prize = Math.max(0, round2(res.finalPrize));
      const isWinner = !res.isDraw && String(res.winnerId) === uid;
      const isLoser = !res.isDraw && String(res.loserId) === uid;

      let paidOk = true;
      if (isWinner && prize > 0) {
        paidOk = await creditPlayCashQueued(prize, () => ([{
          user_id: uid,
          reason: '__TB_PAID__:' + JSON.stringify({
            id: battle.id,
            userId: uid,
            role: 'winner',
            prizeDelta: prize,
            ts: Date.now()
          }),
          status: 'denied'
        }]));
        if (paidOk) battle.paidUsers.add(uid);
      } else if (isLoser && prize > 0) {
        paidOk = await deductTraderBattleLossQueued(prize, battle.id);
        if (paidOk) {
          battle.paidUsers.add(uid);
          try {
            await sb.from('premium_requests').insert({
              user_id: uid,
              reason: '__TB_PAID__:' + JSON.stringify({
                id: battle.id,
                userId: uid,
                role: 'loser',
                prizeDelta: -prize,
                ts: Date.now()
              }),
              status: 'denied'
            });
          } catch (e) {}
        }
      } else {
        battle.paidUsers.add(uid);
        try {
          await sb.from('premium_requests').insert({
            user_id: uid,
            reason: '__TB_PAID__:' + JSON.stringify({
              id: battle.id,
              userId: uid,
              role: 'draw',
              prizeDelta: 0,
              ts: Date.now()
            }),
            status: 'denied'
          });
        } catch (e) {}
      }
      if (typeof loadCoins === 'function' && isLoser) loadCoins().catch(() => {});
    } finally {
      tbState.payingIds.delete(battle.id);
    }
  }

  if (!hasShownTbResultPopup(battle.id)) {
    markTbResultPopupShown(battle.id);
    const isWin = !res.isDraw && String(res.winnerId) === uid;
    playSound(isWin ? 'buy' : 'sell');
    userNotificationsFetchedAt = 0;
    updateNotificationsBadge();
    showTraderBattleResultPopup(battle);
  }
}

async function settleTraderBattle(battle) {
  if (!currentUser || !sb || !battle || battle.status !== 'active') return;
  if (tbState.settlingIds.has(battle.id)) return;
  tbState.settlingIds.add(battle.id);

  try {
    // Re-sync so we don't duplicate __TB_RESULT__ if opponent settled milliseconds earlier
    await loadTraderBattles(true);
    const freshB = tbState.battles.get(battle.id);
    if (!freshB || freshB.status !== 'active' || freshB.result) {
      if (freshB?.result) await applyOwnTraderBattleSettlement(freshB);
      return;
    }

    await updateNetWorth();
    const [{ data: cProf }, { data: oProf }] = await Promise.all([
      sb.from('profiles').select('net_worth').eq('id', freshB.challengerId).maybeSingle(),
      sb.from('profiles').select('net_worth').eq('id', freshB.opponentId).maybeSingle()
    ]);

    const cEndNw = Math.max(0, round2(cProf?.net_worth ?? freshB.challengerStartNw));
    const oEndNw = Math.max(0, round2(oProf?.net_worth ?? freshB.opponentStartNw));
    const cTradePnl = round2(cEndNw - freshB.challengerStartNw);
    const oTradePnl = round2(oEndNw - freshB.opponentStartNw);

    const barPrize = freshB.mode === 'classic'
      ? computeClassicBattlePrize(cTradePnl, oTradePnl, cEndNw, oEndNw)
      : Math.max(0, floor2(Math.min(freshB.minStake, cEndNw, oEndNw)));
    const diff = round2(cTradePnl - oTradePnl);
    const isDraw = Math.abs(diff) < 0.01;
    const winnerId = isDraw ? null : (diff > 0 ? freshB.challengerId : freshB.opponentId);
    const loserId = isDraw ? null : (diff > 0 ? freshB.opponentId : freshB.challengerId);
    const finalPrize = isDraw ? 0 : barPrize;

    const cTotalDelta = isDraw ? cTradePnl : round2(cTradePnl + (winnerId === freshB.challengerId ? finalPrize : -finalPrize));
    const oTotalDelta = isDraw ? oTradePnl : round2(oTradePnl + (winnerId === freshB.opponentId ? finalPrize : -finalPrize));

    const resultPayload = {
      id: freshB.id,
      mode: freshB.mode,
      challengerStartNw: freshB.challengerStartNw,
      challengerEndNw: cEndNw,
      challengerTradePnl: cTradePnl,
      challengerTotalDelta: cTotalDelta,
      opponentStartNw: freshB.opponentStartNw,
      opponentEndNw: oEndNw,
      opponentTradePnl: oTradePnl,
      opponentTotalDelta: oTotalDelta,
      winnerId,
      loserId,
      isDraw,
      finalPrize,
      settledAt: Date.now()
    };

    const { error } = await sb.from('premium_requests').insert({
      user_id: currentUser.id,
      reason: '__TB_RESULT__:' + JSON.stringify(resultPayload),
      status: 'denied'
    });
    if (error) return;

    await loadTraderBattles(true);
    const settledB = tbState.battles.get(freshB.id);
    if (settledB?.result) {
      if (tbState.activeInfoBattleId === settledB.id) {
        closeTbInfoModal();
      }
      await applyOwnTraderBattleSettlement(settledB);
    }
  } finally {
    tbState.settlingIds.delete(battle.id);
  }
}

async function evaluateTraderBattles() {
  if (!currentUser || !sb) return;
  const now = Date.now();
  const mine = getMyTraderBattles();

  for (const b of mine) {
    if (b.status === 'active' && b.endsAt > 0 && now >= b.endsAt) {
      await settleTraderBattle(b);
    } else if (b.status === 'completed' && b.result) {
      const uid = String(currentUser.id);
      if (!b.paidUsers.has(uid) || !hasShownTbResultPopup(b.id)) {
        await applyOwnTraderBattleSettlement(b);
      }
    }
  }
  updateTraderBattleHud();
}

function showTraderBattleResultPopup(battle) {
  if (!currentUser || !battle?.result) return;
  const modal = $('#traderBattleResultModal');
  const heading = $('#tbResultHeading');
  const body = $('#tbResultModalBody');
  const doneBtn = $('#tbResultDoneBtn');
  if (!modal || !heading || !body) return;

  const uid = String(currentUser.id);
  const res = battle.result;
  const isChallenger = battle.challengerId === uid;
  const didWin = !res.isDraw && String(res.winnerId) === uid;
  const isDraw = Boolean(res.isDraw);

  const cProf = getProfileSafe(battle.challengerId);
  const oProf = getProfileSafe(battle.opponentId);
  const cName = battle.challengerId === uid ? `You (${cProf.username || 'Trader'})` : `@${cProf.username || 'Trader'}`;
  const oName = battle.opponentId === uid ? `You (${oProf.username || 'Trader'})` : `@${oProf.username || 'Trader'}`;
  const winnerProf = res.winnerId ? getProfileSafe(res.winnerId) : null;
  const winnerLabel = isDraw ? 'Draw (Tie)' : (String(res.winnerId) === uid ? 'You' : `@${winnerProf?.username || 'Trader'}`);

  heading.textContent = isDraw ? 'Battle ended in a draw!' : (didWin ? 'You won the battle!' : 'You lost the battle!');
  if (doneBtn) doneBtn.textContent = didWin ? 'Claim Victory' : 'Close';

  const bannerCls = isDraw ? '' : (didWin ? 'is-win' : 'is-loss');
  const cWon = !isDraw && String(res.winnerId) === battle.challengerId;
  const oWon = !isDraw && String(res.winnerId) === battle.opponentId;
  const prize = round2(res.finalPrize);

  body.innerHTML = `
    <div class="tb-result-banner ${bannerCls}">
      <strong>${isDraw ? 'Exact Tie — No prize money transferred.' : (didWin ? `🏆 Winner: ${escapeHtml(winnerLabel)} (+${money(prize)} prize won!)` : `🏆 Winner: ${escapeHtml(winnerLabel)} · You lost ${money(prize)} prize money.`)}</strong>
      <span class="muted tiny">
        ${isDraw
          ? 'Both traders had identical trading scores.'
          : battle.mode === 'classic'
            ? `Classic Mode prize (½ total gains): ${money(prize)}`
            : `Prize transferred: ${money(prize)}${prize < battle.initialStake ? ` (shrunk from ${money(battle.initialStake)} initial bar)` : ''}`}
      </span>
    </div>
    <div class="tb-score-grid">
      <div class="tb-player-card ${cWon ? 'is-winner' : (!isDraw ? 'is-loser' : '')}">
        <div class="muted tiny">${escapeHtml(cName)} ${cWon ? '🏆' : ''}</div>
        <div><span class="muted tiny">Trading Score: </span><strong style="color:${res.challengerTradePnl >= 0 ? 'var(--green)' : '#fca5a5'};">${signedMoney(res.challengerTradePnl)}</strong></div>
        <div><span class="muted tiny">Prize: </span><strong style="color:${cWon ? 'var(--green)' : '#fca5a5'};">${isDraw ? money(0) : (cWon ? '+' + money(prize) : '-' + money(prize))}</strong></div>
        <div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--line);">
          <span class="muted tiny">Total Entire Battle (incl. prize): </span>
          <strong style="color:${res.challengerTotalDelta >= 0 ? 'var(--green)' : '#fca5a5'};">${signedMoney(res.challengerTotalDelta)}</strong>
        </div>
      </div>
      <div class="tb-player-card ${oWon ? 'is-winner' : (!isDraw ? 'is-loser' : '')}">
        <div class="muted tiny">${escapeHtml(oName)} ${oWon ? '🏆' : ''}</div>
        <div><span class="muted tiny">Trading Score: </span><strong style="color:${res.opponentTradePnl >= 0 ? 'var(--green)' : '#fca5a5'};">${signedMoney(res.opponentTradePnl)}</strong></div>
        <div><span class="muted tiny">Prize: </span><strong style="color:${oWon ? 'var(--green)' : '#fca5a5'};">${isDraw ? money(0) : (oWon ? '+' + money(prize) : '-' + money(prize))}</strong></div>
        <div style="margin-top:4px;padding-top:4px;border-top:1px solid var(--line);">
          <span class="muted tiny">Total Entire Battle (incl. prize): </span>
          <strong style="color:${res.opponentTotalDelta >= 0 ? 'var(--green)' : '#fca5a5'};">${signedMoney(res.opponentTotalDelta)}</strong>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function openTraderBattleResultById(battleId) {
  const b = tbState.battles.get(String(battleId || ''));
  if (b?.result) {
    showTraderBattleResultPopup(b);
  } else {
    toast('Battle result is loading...');
  }
}

function getTraderBattleNotifications(uid, delUsers) {
  const items = [];
  const del = delUsers || new Set();
  tbState.battles.forEach(b => {
    if (del.has(b.challengerId) || del.has(b.opponentId)) return;

    // Incoming challenges (and kept visible as handled after Yes/No)
    if (b.opponentId === uid && (b.status === 'pending' || b.status === 'active' || b.status === 'declined')) {
      const cProf = getProfileSafe(b.challengerId);
      items.push({
        id: 'tb_ch_' + b.id,
        category: 'tb_challenge',
        ts: Number(b.createdAt || 0),
        battleId: b.id,
        stake: b.initialStake,
        stakeLabel: formatTbStakeLabel(b),
        durationLabel: formatTbDuration(b.durationMins),
        isPending: b.status === 'pending',
        statusNote: b.status === 'active' ? 'Battle started (accepted)' : 'Declined',
        authorId: b.challengerId,
        authorProfile: cProf,
        authorName: cProf.username || 'Trader'
      });
    }

    // Completed battle results for BOTH challenger & opponent
    if (b.status === 'completed' && b.result && (b.challengerId === uid || b.opponentId === uid)) {
      const res = b.result;
      const isChallenger = b.challengerId === uid;
      const oppId = isChallenger ? b.opponentId : b.challengerId;
      const oppProf = getProfileSafe(oppId);
      const didWin = !res.isDraw && String(res.winnerId) === uid;
      const isDraw = Boolean(res.isDraw);
      const myTradePnl = isChallenger ? res.challengerTradePnl : res.opponentTradePnl;
      const oppTradePnl = isChallenger ? res.opponentTradePnl : res.challengerTradePnl;
      const myTotal = isChallenger ? res.challengerTotalDelta : res.opponentTotalDelta;

      items.push({
        id: 'tb_res_' + b.id,
        category: 'tb_result',
        ts: Number(res.settledAt || b.endsAt || b.createdAt || 0),
        battleId: b.id,
        didWin,
        isDraw,
        authorId: oppId,
        authorProfile: oppProf,
        authorName: oppProf.username || 'Trader',
        summaryLine: isDraw
          ? `Draw! Score: You ${signedMoney(myTradePnl)} vs @${oppProf.username || 'Trader'} ${signedMoney(oppTradePnl)} · Total: ${signedMoney(myTotal)}`
          : `Score: You ${signedMoney(myTradePnl)} vs @${oppProf.username || 'Trader'} ${signedMoney(oppTradePnl)} · Prize ${didWin ? 'won' : 'lost'}: ${money(res.finalPrize)} · Your Total (incl. prize): ${signedMoney(myTotal)}`
      });
    }
  });
  return items;
}

async function handleTraderBattleRealtimeEvent(payload) {
  if (!currentUser || !sb || !payload?.new) return;
  const row = payload.new;
  const reason = String(row.reason || '');
  const uid = String(currentUser.id);

  await loadTraderBattles(true);

  if (reason.startsWith('__TB_CHALLENGE__:')) {
    try {
      const p = JSON.parse(reason.slice('__TB_CHALLENGE__:'.length));
      if (p && String(p.opponentId) === uid) {
        await ensureProfilesCached([p.challengerId]);
        const cProf = getProfileSafe(p.challengerId);
        const cName = cProf.username || 'Trader';
        const prizeSummary = p.mode === 'classic' ? 'Classic Mode (½ Gains)' : money(p.stake);
        playSound('buy');
        showLiveNotifPopup({
          key: 'tb_req_' + p.id,
          kind: 'battle',
          icon: '⚔️',
          title: 'Trader Battle Request',
          body: `Trader Battle Request From - ${cName} (${formatTbDuration(p.durationMins)} · ${prizeSummary})`,
          onClick: () => openTraderBattleInfoModal(p.id)
        });
        updateTraderBattleHud();
        userNotificationsFetchedAt = 0;
        updateNotificationsBadge();
      }
    } catch (e) {}
  } else if (reason.startsWith('__TB_ACCEPT__:')) {
    try {
      const p = JSON.parse(reason.slice('__TB_ACCEPT__:'.length));
      const b = p?.id ? tbState.battles.get(String(p.id)) : null;
      if (b && b.challengerId === uid) {
        const oProf = getProfileSafe(b.opponentId);
        playSound('buy');
        showLiveNotifPopup({
          key: 'tb_acc_' + b.id,
          kind: 'battle',
          icon: '⚔️',
          title: 'Trader Battle Is ON!',
          body: `@${oProf.username || 'Trader'} pressed Yes! ${formatTbDuration(b.durationMins)} (${formatTbStakeLabel(b)})`,
          onClick: () => openTraderBattleInfoModal(b.id)
        });
      }
    } catch (e) {}
  } else if (reason.startsWith('__TB_RESULT__:')) {
    try {
      const p = JSON.parse(reason.slice('__TB_RESULT__:'.length));
      const b = p?.id ? tbState.battles.get(String(p.id)) : null;
      if (b && (b.challengerId === uid || b.opponentId === uid)) {
        await applyOwnTraderBattleSettlement(b);
      }
    } catch (e) {}
  } else if (reason.startsWith('__TB_BAR__:')) {
    try {
      const p = JSON.parse(reason.slice('__TB_BAR__:'.length));
      const b = p?.id ? tbState.battles.get(String(p.id)) : null;
      if (b && String(p.byId) !== uid && (b.challengerId === uid || b.opponentId === uid)) {
        toast(`📉 Opponent dropped below bar — battle stake shrunk to ${money(b.minStake)}`);
      }
    } catch (e) {}
  }

  updateTraderBattleHud();
}

// Trader Battle Modal Listeners
$$('#tbLengthPresets .tb-preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const mins = Number(btn.dataset.tbMins || 120);
    if (!TB_ALLOWED_MINS.includes(mins)) return;
    tbState.selectedMins = mins;
    $$('#tbLengthPresets .tb-preset-chip').forEach(x => x.classList.toggle('active', x === btn));
  });
});

$$('#tbPriceModeTabs .tb-mode-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    setTbPrizeMode(btn.dataset.tbMode === 'classic' ? 'classic' : 'fixed');
  });
});

$$('#tbPricePresets .tb-preset-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const raw = btn.dataset.tbStake;
    const val = raw === 'max' ? tbState.maxStakeAllowed : Number(raw);
    if (!Number.isFinite(val) || val < 1) return;
    if ($('#tbStakeInput')) $('#tbStakeInput').value = String(floor2(val));
    $$('#tbPricePresets .tb-preset-chip').forEach(x => x.classList.toggle('active', x === btn));
  });
});

$('#tbNextToPriceBtn')?.addEventListener('click', proceedToTraderBattlePriceStep);
$('#tbBackToLengthBtn')?.addEventListener('click', () => {
  $('#tbStepPrice')?.classList.add('hidden');
  $('#tbStepLength')?.classList.remove('hidden');
});
$('#tbSendChallengeBtn')?.addEventListener('click', sendTraderBattleChallenge);
$('#closeTraderBattleBtn')?.addEventListener('click', closeTraderBattleModal);
$('#tbCancelLengthBtn')?.addEventListener('click', closeTraderBattleModal);
$('#traderBattleModal')?.addEventListener('click', e => {
  if (e.target === $('#traderBattleModal')) closeTraderBattleModal();
});

$('#closeTbInfoBtn')?.addEventListener('click', closeTbInfoModal);
$('#traderBattleInfoModal')?.addEventListener('click', e => {
  if (e.target === $('#traderBattleInfoModal')) closeTbInfoModal();
});

$('#closeTbResultBtn')?.addEventListener('click', () => $('#traderBattleResultModal')?.classList.add('hidden'));
$('#tbResultDoneBtn')?.addEventListener('click', () => $('#traderBattleResultModal')?.classList.add('hidden'));
$('#traderBattleResultModal')?.addEventListener('click', e => {
  if (e.target === $('#traderBattleResultModal')) $('#traderBattleResultModal')?.classList.add('hidden');
});





