// ------------------------------------------------------------------
//  StrikeX - username login screen
// ------------------------------------------------------------------
import { getSavedProfile, loginWithUsername } from './firebase.js?v=1';

let currentProfile = getSavedProfile();

export function getProfile() {
  return currentProfile || { username: 'PLAYER', cloud: false };
}

function initialsFor(name) {
  const clean = String(name || 'PLAYER').replace(/[^A-Za-z0-9]/g, '');
  return (clean.slice(0, 2) || 'PL').toUpperCase();
}

function paintProfile(profile) {
  if (!profile) return;
  const name = profile.username || 'PLAYER';
  document.querySelectorAll('[data-username]').forEach((el) => {
    el.textContent = name;
  });
  document.querySelectorAll('[data-avatar]').forEach((el) => {
    el.textContent = initialsFor(name);
  });
  document.querySelectorAll('[data-welcome]').forEach((el) => {
    el.textContent = 'WELCOME, ' + name.toUpperCase();
  });
}

function setStatus(msg, state = '') {
  const el = document.querySelector('#loginMsg');
  if (!el) return;
  el.textContent = msg;
  el.dataset.state = state;
}

export function initAuth() {
  const screen = document.querySelector('#loginScreen');
  if (!screen) return;

  const input = document.querySelector('#loginName');
  const button = document.querySelector('#loginBtn');
  const saved = getSavedProfile();
  let busy = false;

  if (saved) {
    currentProfile = saved;
    paintProfile(saved);
    if (input) input.value = saved.username;
    setStatus(saved.cloud ? 'WELCOME BACK · CLOUD PROFILE READY' : 'LOCAL PROFILE READY', 'ok');
  } else {
    setStatus('ENTER A USERNAME TO CONNECT', '');
  }

  const submit = async () => {
    if (busy || !input || !button) return;
    const name = input.value.trim();

    if (!/^[A-Za-z0-9_.]{3,16}$/.test(name)) {
      setStatus('USE 3-16 LETTERS, NUMBERS, _ OR .', 'error');
      input.focus();
      return;
    }

    busy = true;
    button.disabled = true;
    input.disabled = true;
    setStatus('CONNECTING TO FIREBASE...', 'busy');

    try {
      const profile = await loginWithUsername(name);
      currentProfile = profile;
      paintProfile(profile);
      setStatus(
        profile.cloud ? 'CONNECTED · WELCOME ' + profile.username.toUpperCase() : 'CLOUD OFFLINE · LOCAL PROFILE READY',
        profile.cloud ? 'ok' : 'warn'
      );

      window.setTimeout(() => {
        screen.classList.add('closing');
        window.setTimeout(() => screen.classList.add('hidden'), 420);
      }, profile.cloud ? 420 : 800);
    } catch (err) {
      if (err && err.code === 'USERNAME_TAKEN') {
        setStatus('USERNAME ALREADY TAKEN — TRY ANOTHER', 'error');
      } else if (err && err.code === 'INVALID_USERNAME') {
        setStatus('USE 3-16 LETTERS, NUMBERS, _ OR .', 'error');
      } else {
        setStatus('LOGIN FAILED — CHECK CONNECTION AND RETRY', 'error');
      }
      busy = false;
      button.disabled = false;
      input.disabled = false;
      input.focus();
    }
  };

  if (button) button.addEventListener('click', submit);
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    });
    window.setTimeout(() => input.focus(), 80);
  }
}
