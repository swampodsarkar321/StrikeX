// ------------------------------------------------------------------
//  StrikeX - Firebase Realtime Database profile / username login
// ------------------------------------------------------------------
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyD1o0lIozPuVztWVtLOlJtwCjxe4GtdBT0',
  authDomain: 'strikex-29776.firebaseapp.com',
  databaseURL: 'https://strikex-29776-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'strikex-29776',
  storageBucket: 'strikex-29776.firebasestorage.app',
  messagingSenderId: '32371795404',
  appId: '1:32371795404:web:e7c9b671eb1f0b589c2969',
  measurementId: 'G-WYEV9WY647',
};

const DB_ROOT = 'strikex';
const PROFILE_KEY = 'strikex-profile-v1';
const UID_KEY = 'strikex-device-uid';

let firebaseBundle = null;
let heartbeatTimer = null;
let unloadHooked = false;

export function getSavedProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.username !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

function deviceUid() {
  let uid = '';
  try { uid = localStorage.getItem(UID_KEY) || ''; } catch {}
  if (!uid) {
    uid = (window.crypto && typeof window.crypto.randomUUID === 'function')
      ? window.crypto.randomUUID()
      : 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    try { localStorage.setItem(UID_KEY, uid); } catch {}
  }
  return uid;
}

async function ensureFirebase() {
  if (firebaseBundle) return firebaseBundle;

  const [appMod, dbMod] = await Promise.all([
    import('../vendor/firebase/firebase-app.js'),
    import('../vendor/firebase/firebase-database.js'),
  ]);

  const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG);
  const db = dbMod.getDatabase(app);

  firebaseBundle = { app, db, mod: dbMod };
  return firebaseBundle;
}

function startHeartbeat(bundle, uid) {
  const { db, mod } = bundle;
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    try {
      mod.update(mod.ref(db, `${DB_ROOT}/players/${uid}`), {
        online: true,
        lastSeen: Date.now(),
      }).catch(() => {});
    } catch {}
  }, 45000);

  if (!unloadHooked) {
    unloadHooked = true;
    const goOffline = () => {
      try {
        mod.update(mod.ref(db, `${DB_ROOT}/players/${uid}`), {
          online: false,
          lastSeen: Date.now(),
        });
      } catch {}
    };
    window.addEventListener('pagehide', goOffline);
    window.addEventListener('beforeunload', goOffline);
  }
}

function localProfile(username, uid) {
  const profile = {
    uid,
    username,
    cloud: false,
    savedAt: Date.now(),
  };
  saveProfile(profile);
  return profile;
}

export async function loadPlayerData() {
  let bundle;
  try { bundle = await ensureFirebase(); } catch (err) {
    console.warn('[StrikeX] Firebase unavailable for data load.', err);
    return null;
  }
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return null;
  const { db, mod } = bundle;
  try {
    const snapPromise = mod.get(mod.ref(db, `${DB_ROOT}/players/${profile.uid}`));
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
    const snap = await Promise.race([snapPromise, timeoutPromise]);
    if (!snap || !snap.exists()) return null;
    const val = snap.val() || {};
    return { rank: val.rank || null, armory: val.armory || null, level: val.level || 1, xp: val.xp || 0 };
  } catch (err) {
    console.warn('[StrikeX] Failed to load player data.', err);
    return null;
  }
}

export async function loadLeaderboard(limit = 20) {
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const snapPromise = mod.get(mod.ref(db, `${DB_ROOT}/players`));
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 5000));
    const snap = await Promise.race([snapPromise, timeoutPromise]);
    if (!snap || !snap.exists()) return [];
    const players = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v && v.name) {
        players.push({ name: v.name, rp: (v.rank && v.rank.rp) || 0, level: v.level || 1 });
      }
    });
    players.sort((a, b) => b.rp - a.rp);
    return players.slice(0, limit);
  } catch (err) {
    console.warn('[StrikeX] leaderboard load failed', err);
    return [];
  }
}
async function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function loadPlayerMail(uid) {
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const mails = [];
    // personal mail
    const personalSnap = await withTimeout(mod.get(mod.ref(db, `${DB_ROOT}/mail/${uid}`)));
    if (personalSnap.exists()) {
      personalSnap.forEach((child) => {
        const v = child.val();
        if (v) mails.push({ ...v, _key: child.key, _path: `${DB_ROOT}/mail/${uid}/${child.key}` });
      });
    }
    // global mail
    const globalSnap = await withTimeout(mod.get(mod.ref(db, `${DB_ROOT}/mail/global`)));
    if (globalSnap.exists()) {
      globalSnap.forEach((child) => {
        const v = child.val();
        if (v) mails.push({ ...v, _key: child.key, _path: `${DB_ROOT}/mail/global/${child.key}` });
      });
    }
    // check claimed state per player
    const claimedSnap = await withTimeout(mod.get(mod.ref(db, `${DB_ROOT}/mailClaimed/${uid}`)));
    const claimed = claimedSnap.exists() ? claimedSnap.val() : {};
    mails.forEach((m) => { if (claimed[m._key]) m.claimed = true; });
    return mails;
  } catch (err) {
    console.warn('[StrikeX] loadPlayerMail failed', err);
    return [];
  }
}

export async function claimMail(uid, mailKey, path) {
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return false; }
  const { db, mod } = bundle;
  try {
    await mod.set(mod.ref(db, `${DB_ROOT}/mailClaimed/${uid}/${mailKey}`), true);
    return true;
  } catch (err) {
    console.warn('[StrikeX] claimMail failed', err);
    return false;
  }
}

export async function sendFriendRequest(targetUsername) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return { ok: false, reason: 'NOT_LOGGED_IN' };
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return { ok: false, reason: 'OFFLINE' }; }
  const { db, mod } = bundle;
  const targetName = String(targetUsername || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_.]{3,16}$/.test(targetName)) return { ok: false, reason: 'INVALID_NAME' };
  if (targetName.toLowerCase() === profile.username.toLowerCase()) return { ok: false, reason: 'SELF' };
  try {
    const nameSnap = await mod.get(mod.ref(db, `${DB_ROOT}/usernames/${targetName.toLowerCase()}`));
    if (!nameSnap.exists()) return { ok: false, reason: 'USER_NOT_FOUND' };
    const claim = nameSnap.val();
    const targetUid = claim.uid;
    // check not already friend
    const friendsSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friends/${profile.uid}`));
    const friends = friendsSnap.exists() ? (friendsSnap.val() || []) : [];
    if (friends.includes(targetUid)) return { ok: false, reason: 'ALREADY_FRIEND' };
    // check not already requested
    const reqSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friendRequests/${targetUid}`));
    const reqs = reqSnap.exists() ? (reqSnap.val() || []) : [];
    if (reqs.some((r) => r.fromId === profile.uid)) return { ok: false, reason: 'ALREADY_REQUESTED' };
    // send request
    reqs.push({ fromId: profile.uid, fromName: profile.username, createdAt: Date.now() });
    await mod.set(mod.ref(db, `${DB_ROOT}/friendRequests/${targetUid}`), reqs);
    return { ok: true };
  } catch (err) {
    console.error('sendFriendRequest failed', err);
    return { ok: false, reason: 'ERROR' };
  }
}

export async function acceptFriendRequest(fromId) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return false;
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return false; }
  const { db, mod } = bundle;
  try {
    // remove from my requests
    const reqSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friendRequests/${profile.uid}`));
    const reqs = reqSnap.exists() ? (reqSnap.val() || []) : [];
    const fromReq = reqs.find((r) => r.fromId === fromId);
    if (!fromReq) return false;
    // add to my friends
    const myFriendsSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friends/${profile.uid}`));
    const myFriends = myFriendsSnap.exists() ? (myFriendsSnap.val() || []) : [];
    if (!myFriends.includes(fromId)) myFriends.push(fromId);
    await mod.set(mod.ref(db, `${DB_ROOT}/friends/${profile.uid}`), myFriends);
    // add to their friends
    const theirFriendsSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friends/${fromId}`));
    const theirFriends = theirFriendsSnap.exists() ? (theirFriendsSnap.val() || []) : [];
    if (!theirFriends.includes(profile.uid)) theirFriends.push(profile.uid);
    await mod.set(mod.ref(db, `${DB_ROOT}/friends/${fromId}`), theirFriends);
    // remove from my requests
    const newReqs = reqs.filter((r) => r.fromId !== fromId);
    await mod.set(mod.ref(db, `${DB_ROOT}/friendRequests/${profile.uid}`), newReqs);
    return true;
  } catch (err) {
    console.error('acceptFriendRequest failed', err);
    return false;
  }
}

export async function rejectFriendRequest(fromId) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return false;
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return false; }
  const { db, mod } = bundle;
  try {
    const reqSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friendRequests/${profile.uid}`));
    const reqs = reqSnap.exists() ? (reqSnap.val() || []) : [];
    const newReqs = reqs.filter((r) => r.fromId !== fromId);
    await mod.set(mod.ref(db, `${DB_ROOT}/friendRequests/${profile.uid}`), newReqs);
    return true;
  } catch (err) {
    console.error('rejectFriendRequest failed', err);
    return false;
  }
}

export async function loadFriends() {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return [];
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const friendsSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friends/${profile.uid}`));
    const friendUids = friendsSnap.exists() ? (friendsSnap.val() || []) : [];
    if (friendUids.length === 0) return [];
    const playersSnap = await mod.get(mod.ref(db, `${DB_ROOT}/players`));
    const players = playersSnap.exists() ? playersSnap.val() : {};
    const result = [];
    for (const uid of friendUids) {
      const p = players[uid];
      if (p) result.push({ uid, name: p.name, level: p.level || 1, online: !!p.online, lastSeen: p.lastSeen || 0, rp: (p.rank && p.rank.rp) || 0 });
    }
    return result;
  } catch (err) {
    console.error('loadFriends failed', err);
    return [];
  }
}

export async function loadFriendRequests() {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return [];
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const reqSnap = await mod.get(mod.ref(db, `${DB_ROOT}/friendRequests/${profile.uid}`));
    const reqs = reqSnap.exists() ? (reqSnap.val() || []) : [];
    return reqs;
  } catch (err) {
    console.error('loadFriendRequests failed', err);
    return [];
  }
}
export async function loadEvents() {
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const snap = await withTimeout(mod.get(mod.ref(db, `${DB_ROOT}/events`)));
    if (!snap.exists()) return [];
    const events = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v) events.push({ id: child.key, ...v });
    });
    return events;
  } catch (err) {
    console.warn('[StrikeX] loadEvents failed', err);
    return [];
  }
}
export async function loadEvents() {
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const snap = await withTimeout(mod.get(mod.ref(db, `${DB_ROOT}/events`)));
    if (!snap.exists()) return [];
    const events = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v) events.push({ id: child.key, ...v });
    });
    return events;
  } catch (err) {
    console.warn('[StrikeX] loadEvents failed', err);
    return [];
  }
}

export async function sendDuoInvite(targetUid) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return { ok: false, reason: 'NOT_LOGGED_IN' };
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return { ok: false, reason: 'OFFLINE' }; }
  const { db, mod } = bundle;
  const teamId = 'team_' + Math.random().toString(36).slice(2, 10);
  const invite = {
    fromId: profile.uid,
    fromName: profile.username,
    teamId,
    createdAt: Date.now(),
  };
  try {
    await mod.set(mod.ref(db, `${DB_ROOT}/invites/${targetUid}/${profile.uid}`), invite);
    return { ok: true, teamId };
  } catch (err) {
    console.error('sendDuoInvite failed', err);
    return { ok: false, reason: 'ERROR' };
  }
}

export async function loadDuoInvites() {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return [];
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return []; }
  const { db, mod } = bundle;
  try {
    const snap = await mod.get(mod.ref(db, `${DB_ROOT}/invites/${profile.uid}`));
    if (!snap.exists()) return [];
    const invites = [];
    snap.forEach((child) => {
      const v = child.val();
      if (v) invites.push({ ...v, key: child.key });
    });
    return invites;
  } catch (err) {
    console.error('loadDuoInvites failed', err);
    return [];
  }
}

export async function acceptDuoInvite(fromId, teamId) {
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return false;
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return false; }
  const { db, mod } = bundle;
  try {
    // remove invite
    await mod.remove(mod.ref(db, `${DB_ROOT}/invites/${profile.uid}/${fromId}`));
    return true;
  } catch (err) {
    console.error('acceptDuoInvite failed', err);
    return false;
  }
}

export async function rejectDuoInvite(fromId) {
  return acceptDuoInvite(fromId, null); // reject = same as remove
}
  const name = String(rawName || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_.]{3,16}$/.test(name)) return null;
  let bundle;
  try { bundle = await ensureFirebase(); } catch { return null; }
  const { db, mod } = bundle;
  try {
    const nameSnap = await mod.get(mod.ref(db, `${DB_ROOT}/usernames/${name.toLowerCase()}`));
    if (!nameSnap.exists()) return null;
    const claim = nameSnap.val();
    const playerSnap = await mod.get(mod.ref(db, `${DB_ROOT}/players/${claim.uid}`));
    if (!playerSnap.exists()) return { username: name, uid: claim.uid, online: false };
    const p = playerSnap.val();
    return { username: p.name || name, uid: claim.uid, online: !!p.online, lastSeen: p.lastSeen || 0, level: p.level || 1 };
  } catch (err) {
    console.warn('[StrikeX] lookup failed', err);
    return null;
  }
}
export async function savePlayerData(patch) {
  if (!patch || typeof patch !== 'object') return false;
  const profile = getSavedProfile();
  if (!profile || !profile.uid) return false;
  let bundle;
  try { bundle = await ensureFirebase(); } catch (err) {
    console.warn('[StrikeX] Firebase unavailable for data save.', err);
    return false;
  }
  const { db, mod } = bundle;
  try {
    await mod.update(mod.ref(db, `${DB_ROOT}/players/${profile.uid}`), patch);
    return true;
  } catch (err) {
    console.warn('[StrikeX] Failed to save player data.', err);
    return false;
  }
}

/**
 * Log in with a username against Firebase Realtime Database.
 * If the cloud cannot be reached the game still works with a local profile.
 */
export async function loginWithUsername(rawName) {
  const username = String(rawName || '').trim().replace(/\s+/g, '');
  if (!/^[A-Za-z0-9_.]{3,16}$/.test(username)) {
    const err = new Error('INVALID_USERNAME');
    err.code = 'INVALID_USERNAME';
    throw err;
  }

  const uid = deviceUid();
  const nameKey = username.toLowerCase();

  let bundle;
  try {
    bundle = await ensureFirebase();
  } catch (err) {
    console.warn('[StrikeX] Firebase SDK unavailable, using local profile.', err);
    return localProfile(username, uid);
  }

  const { db, mod } = bundle;

  try {
    const nameRef = mod.ref(db, `${DB_ROOT}/usernames/${nameKey}`);
    const nameSnap = await mod.get(nameRef);

    if (nameSnap.exists()) {
      const claim = nameSnap.val();
      if (!claim || claim.uid !== uid) {
        const err = new Error('USERNAME_TAKEN');
        err.code = 'USERNAME_TAKEN';
        throw err;
      }
    } else {
      await mod.set(nameRef, {
        uid,
        name: username,
        createdAt: Date.now(),
      });
    }

    const playerRef = mod.ref(db, `${DB_ROOT}/players/${uid}`);
    const playerSnap = await mod.get(playerRef);
    const now = Date.now();
    const playerData = {
      name: username,
      nameLower: nameKey,
      online: true,
      lastSeen: now,
    };
    if (!playerSnap.exists()) playerData.createdAt = now;

    await mod.update(playerRef, playerData);

    try {
      await mod.onDisconnect(mod.ref(db, `${DB_ROOT}/players/${uid}/online`)).set(false);
    } catch (err) {
      console.warn('[StrikeX] onDisconnect unavailable.', err);
    }

    const profile = {
      uid,
      username,
      cloud: true,
      savedAt: now,
    };
    saveProfile(profile);
    startHeartbeat(bundle, uid);
    return profile;
  } catch (err) {
    if (err && err.code === 'USERNAME_TAKEN') throw err;

    // Network/rules/SDK error: keep the game usable with the same username.
    console.warn('[StrikeX] Firebase login failed, using local profile.', err);
    return localProfile(username, uid);
  }
}

export function signOutProfile() {
  const profile = getSavedProfile();
  if (profile) {
    try {
      const raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (raw) {
        const bundle = firebaseBundle;
        if (bundle) {
          const { db, mod } = bundle;
          mod.update(mod.ref(db, `${DB_ROOT}/players/${profile.uid}`), {
            online: false,
            lastSeen: Date.now(),
          }).catch(() => {});
        }
      }
    } catch {}
  }
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  try { localStorage.removeItem(PROFILE_KEY); } catch {}
}
