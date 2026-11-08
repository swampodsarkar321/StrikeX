// StrikeX Admin Panel
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD1o0lIozPuVztWVtLOlJtwCjxe4GtdBT0',
  authDomain: 'strikex-29776.firebaseapp.com',
  databaseURL: 'https://strikex-29776-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'strikex-29776',
  storageBucket: 'strikex-29776.firebasestorage.app',
  messagingSenderId: '32371795404',
  appId: '1:32371795404:web:e7c9b671eb1f0b589c2969',
};
const DB_ROOT = 'strikex';
const ADMIN_PASSWORD = 'strikexadmin'; // change this
const SERVER_URL = 'https://server-dhrz.onrender.com';

let db = null, mod = null, app = null;
let players = [];
let events = [];
let mailLog = [];

async function initFirebase() {
  const [appMod, dbMod] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js'),
  ]);
  app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
  db = dbMod.getDatabase(app);
  mod = dbMod;
  return true;
}

// ---- login ----
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const adminPass = document.getElementById('adminPass');
const loginBtn = document.getElementById('loginBtn');
const loginMsg = document.getElementById('loginMsg');

loginBtn.addEventListener('click', () => {
  if (adminPass.value === ADMIN_PASSWORD) {
    loginScreen.classList.add('hidden');
    dashboard.classList.remove('hidden');
    initDashboard();
  } else {
    loginMsg.textContent = 'INVALID PASSWORD';
    loginMsg.style.color = '#ff4d5e';
    adminPass.value = '';
  }
});
adminPass.addEventListener('keydown', (e) => { if (e.key === 'Enter') loginBtn.click(); });

document.getElementById('logoutBtn').addEventListener('click', () => {
  dashboard.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  adminPass.value = '';
});

// ---- tabs ----
document.querySelectorAll('.dash-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    document.querySelectorAll('.dash-section').forEach((s) => {
      s.classList.toggle('active', s.dataset.section === name);
    });
  });
});

// ---- helpers ----
function $(s) { return document.querySelector(s); }
function toast(msg, color = '#7ee08a') {
  const el = document.getElementById('mailStatus') || document.getElementById('eventStatus');
  if (el) { el.textContent = msg; el.style.color = color; }
}

function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

// ---- dashboard init ----
async function initDashboard() {
  try { await initFirebase(); } catch (e) { console.error('Firebase init failed', e); }
  await loadPlayers();
  await loadEvents();
  await loadServerStatus();
  await refreshOverview();
  setInterval(loadServerStatus, 30000);
  setInterval(refreshOverview, 60000);
}

// ---- players ----
async function loadPlayers() {
  if (!db) return;
  try {
    const snap = await mod.get(mod.ref(db, `${DB_ROOT}/players`));
    players = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val();
        if (v && v.name) {
          players.push({
            uid: child.key,
            name: v.name,
            level: v.level || 1,
            rp: (v.rank && v.rank.rp) || 0,
            online: !!v.online,
            lastSeen: v.lastSeen || 0,
            matches: (v.stats && v.stats.matches) || 0,
            kills: (v.stats && v.stats.kills) || 0,
          });
        }
      });
    }
    players.sort((a, b) => b.rp - a.rp);
    renderPlayers();
    populateMailRecipients();
  } catch (e) { console.error('loadPlayers failed', e); }
}

function renderPlayers(filter = '') {
  const tbody = document.getElementById('playerTable');
  tbody.innerHTML = '';
  const q = filter.toLowerCase();
  const filtered = q ? players.filter((p) => p.name.toLowerCase().includes(q)) : players;
  filtered.forEach((p) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.level}</td>
      <td>${p.rp}</td>
      <td class="${p.online ? 'online' : 'offline'}">${p.online ? 'ONLINE' : 'OFFLINE'}</td>
      <td>${timeAgo(p.lastSeen)}</td>
      <td>
        <button class="btn ghost" style="min-width:60px;padding:4px 8px;font-size:8px;" onclick="sendQuickMail('${p.name}')">MAIL</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('ovPlayers').textContent = players.length;
  document.getElementById('ovOnline').textContent = players.filter((p) => p.online).length;
}

document.getElementById('playerSearch').addEventListener('input', (e) => {
  renderPlayers(e.target.value);
});
document.getElementById('refreshPlayers').addEventListener('click', loadPlayers);

// ---- overview ----
async function refreshOverview() {
  if (!db) return;
  try {
    const snap = await mod.get(mod.ref(db, `${DB_ROOT}/players`));
    let totalMatches = 0;
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val();
        if (v && v.stats) totalMatches += v.stats.matches || 0;
      });
    }
    document.getElementById('ovMatches').textContent = totalMatches;
  } catch (e) {}
  document.getElementById('ovEvents').textContent = events.filter((e) => e.active).length;
}

// ---- mail ----
function populateMailRecipients() {
  const sel = document.getElementById('mailRecipient');
  sel.innerHTML = '<option value="all">ALL PLAYERS</option>';
  players.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name + (p.online ? ' (ONLINE)' : '');
    sel.appendChild(opt);
  });
}

async function sendMail() {
  const recipient = document.getElementById('mailRecipient').value;
  const title = document.getElementById('mailTitle').value.trim();
  const body = document.getElementById('mailBody').value.trim();
  const reward = parseInt(document.getElementById('mailReward').value, 10) || 0;
  if (!title) { document.getElementById('mailStatus').textContent = 'TITLE REQUIRED'; document.getElementById('mailStatus').style.color = '#ff4d5e'; return; }

  const mailItem = {
    id: 'admin_' + Date.now(),
    title: title.toUpperCase(),
    desc: body || 'No message.',
    reward: reward + ' COINS',
    rewardCoins: reward,
    claimed: false,
    from: 'ADMIN',
    createdAt: Date.now(),
  };

  try {
    if (recipient === 'all') {
      // write to a global mail node that all players read
      await mod.push(mod.ref(db, `${DB_ROOT}/mail/global`), mailItem);
    } else {
      // find player uid
      const p = players.find((x) => x.name === recipient);
      if (!p) { document.getElementById('mailStatus').textContent = 'PLAYER NOT FOUND'; document.getElementById('mailStatus').style.color = '#ff4d5e'; return; }
      await mod.push(mod.ref(db, `${DB_ROOT}/mail/${p.uid}`), mailItem);
    }
    document.getElementById('mailStatus').textContent = 'MAIL SENT SUCCESSFULLY';
    document.getElementById('mailStatus').style.color = '#7ee08a';
    // log
    mailLog.unshift({ ...mailItem, recipient, sentAt: Date.now() });
    renderMailLog();
    // reset form
    document.getElementById('mailTitle').value = '';
    document.getElementById('mailBody').value = '';
  } catch (e) {
    console.error('sendMail failed', e);
    document.getElementById('mailStatus').textContent = 'SEND FAILED: ' + e.message;
    document.getElementById('mailStatus').style.color = '#ff4d5e';
  }
}
document.getElementById('sendMailBtn').addEventListener('click', sendMail);

function renderMailLog() {
  const list = document.getElementById('mailLog');
  list.innerHTML = '';
  mailLog.slice(0, 20).forEach((m) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<div>${m.title} → ${m.recipient} (${m.reward})</div><small>${new Date(m.sentAt).toLocaleString()}</small>`;
    list.appendChild(item);
  });
}

// ---- sendQuickMail (from player table) ----
window.sendQuickMail = function (name) {
  document.querySelectorAll('.dash-tab').forEach((t) => t.classList.remove('active'));
  document.querySelector('.dash-tab[data-tab="mail"]').classList.add('active');
  document.querySelectorAll('.dash-section').forEach((s) => s.classList.toggle('active', s.dataset.section === 'mail'));
  document.getElementById('mailRecipient').value = name;
  document.getElementById('mailTitle').focus();
};

// ---- events ----
async function loadEvents() {
  if (!db) return;
  try {
    const snap = await mod.get(mod.ref(db, `${DB_ROOT}/events`));
    events = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        events.push({ id: child.key, ...child.val() });
      });
    }
    renderEvents();
  } catch (e) { console.error('loadEvents failed', e); }
}

function renderEvents() {
  const list = document.getElementById('eventList');
  list.innerHTML = '';
  events.forEach((ev) => {
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<div>${ev.name} — ${ev.reward || ''}</div><small>${ev.desc || ''} · ${ev.active ? 'ACTIVE' : 'INACTIVE'}</small>`;
    list.appendChild(item);
  });
  document.getElementById('ovEvents').textContent = events.filter((e) => e.active).length;
}

async function addEvent() {
  const name = document.getElementById('eventName').value.trim();
  const desc = document.getElementById('eventDesc').value.trim();
  const reward = document.getElementById('eventReward').value.trim();
  const condition = document.getElementById('eventCondition').value;
  if (!name) { document.getElementById('eventStatus').textContent = 'NAME REQUIRED'; document.getElementById('eventStatus').style.color = '#ff4d5e'; return; }
  try {
    await mod.push(mod.ref(db, `${DB_ROOT}/events`), {
      name: name.toUpperCase(),
      desc: desc || '',
      reward: reward || '100 COINS',
      condition,
      active: true,
      createdAt: Date.now(),
    });
    document.getElementById('eventStatus').textContent = 'EVENT ADDED';
    document.getElementById('eventStatus').style.color = '#7ee08a';
    document.getElementById('eventName').value = '';
    document.getElementById('eventDesc').value = '';
    document.getElementById('eventReward').value = '';
    await loadEvents();
  } catch (e) {
    document.getElementById('eventStatus').textContent = 'FAILED: ' + e.message;
    document.getElementById('eventStatus').style.color = '#ff4d5e';
  }
}
document.getElementById('addEventBtn').addEventListener('click', addEvent);

// ---- server ping ----
async function pingServer() {
  const statusEl = document.getElementById('serverStatus');
  const textEl = document.getElementById('serverStatusText');
  const srvStatus = document.getElementById('srvStatus');
  const srvPing = document.getElementById('srvPing');
  const srvCode = document.getElementById('srvCode');
  const log = document.getElementById('serverLog');

  statusEl.className = 'status-dot checking';
  textEl.textContent = 'CHECKING...';
  const start = Date.now();
  try {
    const res = await fetch(SERVER_URL.replace('wss://', 'https://').replace('ws://', 'http://'), { mode: 'no-cors', cache: 'no-store' });
    const ms = Date.now() - start;
    statusEl.className = 'status-dot online';
    textEl.textContent = 'ONLINE';
    srvStatus.textContent = 'ONLINE';
    srvPing.textContent = ms + 'ms';
    srvCode.textContent = res.status || '200';
    // log
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<div>Server ping OK — ${ms}ms</div><small>${new Date().toLocaleString()}</small>`;
    log.prepend(item);
  } catch (e) {
    const ms = Date.now() - start;
    statusEl.className = 'status-dot offline';
    textEl.textContent = 'OFFLINE';
    srvStatus.textContent = 'OFFLINE';
    srvPing.textContent = ms + 'ms';
    srvCode.textContent = 'ERR';
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<div>Server ping FAILED — ${e.message}</div><small>${new Date().toLocaleString()}</small>`;
    log.prepend(item);
  }
  // update firebase serverStatus
  if (db) {
    try {
      await mod.update(mod.ref(db, `${DB_ROOT}/serverStatus`), {
        lastPing: Date.now(),
        status: textEl.textContent,
      });
    } catch (e) {}
  }
  document.getElementById('ovServer').textContent = textEl.textContent;
  document.getElementById('ovPing').textContent = srvPing.textContent;
}
document.getElementById('pingServerBtn').addEventListener('click', pingServer);

// check server status on load
async function loadServerStatus() {
  if (!db) return;
  try {
    const snap = await mod.get(mod.ref(db, `${DB_ROOT}/serverStatus`));
    if (snap.exists()) {
      const v = snap.val();
      const ago = Math.floor((Date.now() - (v.lastPing || 0)) / 1000);
      document.getElementById('ovPing').textContent = ago < 60 ? ago + 's ago' : Math.floor(ago / 60) + 'm ago';
      document.getElementById('ovServer').textContent = v.status || '—';
    }
  } catch (e) {}
}
