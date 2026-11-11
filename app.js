// One page for everyone. It decides what to show:
//  - On your computer (signed in with Google): the PIN screen, your dashboard after your PIN,
//    and it quietly answers students' requests in the background.
//  - On a student's computer: room code (once), then PIN, then their own line controls.
import {
  configured, auth, createTeacherAccount, restoreBackup, onAuthStateChanged, onSnapshot, getDoc, teacherRef, roomRef,
  ensureTeacher, syncRoom, startProcessor, handleRequest, sendRequest, hashPin, matchStudentPin, saveTeacher,
  signOutNow, esc, toast, setupNotice, tickTimers, lsGet, lsSet, ssGet, ssSet
} from './shared.js';
import { passStatus, decide, upList, usedUp, usedUpMsg } from './logic.js';
import { mountDashboard } from './teacher.js';
import { openFloat, floatUpdate, floatTick, floatIsOpen, closeFloat } from './float.js';

const $ = s => document.querySelector(s);
const view = $('#view');

const S = { mode: null, user: null, uid: null, T: null, code: null, room: null, session: null };
let screen = null;
let roomUnsub = null, teacherUnsub = null, procUnsub = null, procCode = null, firstT = true;

const ctx = {
  S,
  lock: () => { ssSet('hp-unlocked', null); showPad(); },
  openFloat: () => openFloat(ctx),
  floatIsOpen,
  signOut: async () => { ssSet('hp-unlocked', null); closeFloat(); await signOutNow(); },
};

function setScreen(s) {
  screen?.destroy?.();
  screen = s;
  view.onclick = null; view.onsubmit = null; view.onchange = null; view.oninput = null; view.onkeydown = null;
}
const roomTitle = () => {
  const p = S.room?.period;
  return p ? (p.name ? `${p.name}: ${p.className}` : p.className) : '';
};

// ---------- startup ----------
if (!configured) setupNotice(view);
else {
  onAuthStateChanged(auth, onAuth);
  setInterval(() => { tickTimers(S.room); screen?.tick?.(); floatTick(ctx); drawConn(); }, 1000);
  setInterval(() => { if (S.mode === 'teacher' && S.T) syncRoom(S.uid, S.T).catch(() => {}); }, 20000);
}

async function onAuth(u) {
  teacherUnsub?.(); teacherUnsub = null;
  procUnsub?.(); procUnsub = null; procCode = null;
  if (u) {
    S.mode = 'teacher'; S.user = u; S.uid = u.uid; S.session = null; firstT = true;
    try { await ensureTeacher(u.uid); } catch (e) { toast(e.message, true); return; }
    teacherUnsub = onSnapshot(teacherRef(u.uid), snap => {
      const T = snap.data();
      if (!T) return;
      T.classes ||= []; T.periods ||= []; T.settings ||= {};
      S.T = T;
      if (S.code !== T.settings.roomCode) { S.code = T.settings.roomCode; watchRoom(S.code); }
      if (procCode !== S.code) {
        procUnsub?.();
        procCode = S.code;
        procUnsub = startProcessor(S.uid, () => S.T, S.code);
      }
      syncRoom(S.uid, T).catch(e => console.warn('sync', e));
      if (firstT) {
        firstT = false;
        if (!T.settings.teacherPinHash) showCreatePin();
        else if (ssGet('hp-unlocked') === '1') showDashboard();
        else showPad();
      } else screen?.updateT?.();
    }, e => toast(e.message, true));
  } else {
    S.mode = 'student'; S.user = S.uid = S.T = null;
    const fromUrl = new URLSearchParams(location.search).get('room');
    const code = (fromUrl || lsGet('hp-room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) return showCode();
    useRoom(code);
  }
}

function useRoom(code) {
  S.code = code;
  try { S.session = JSON.parse(lsGet('hp-sess-' + code) || 'null'); } catch { S.session = null; }
  watchRoom(code);
}

// Connection status, shown as a small dot on every screen.
let offlineSince = Date.now();
function setOnline(on) {
  if (on) offlineSince = 0;
  else if (!offlineSince) offlineSince = Date.now();
}
function drawConn() {
  const bad = offlineSince && Date.now() - offlineSince > 4000;
  document.querySelectorAll('[data-conn]').forEach(el => {
    el.className = 'conn ' + (bad ? 'off' : 'on');
    el.textContent = bad ? 'Reconnecting…' : 'Connected';
  });
}

function watchRoom(code) {
  roomUnsub?.();
  S.room = null;
  let first = true, lastJson;
  setOnline(false);
  if (S.mode === 'student') showConnecting();
  roomUnsub = onSnapshot(roomRef(code), { includeMetadataChanges: true }, s => {
    setOnline(!s.metadata.fromCache);
    // Not connected yet: "no such room" from the browser's cache doesn't mean the code is wrong.
    if (!s.exists() && s.metadata.fromCache) return;
    const json = s.exists() ? JSON.stringify(s.data()) : null;
    if (!first && json === lastJson) return; // only the connection status changed
    lastJson = json;
    S.room = s.exists() ? s.data() : null;
    if (S.mode === 'student') {
      if (!s.exists()) {
        lsSet('hp-room', null);
        return showCode("That room code didn't work. Check with your teacher.");
      }
      if (first) {
        first = false;
        lsSet('hp-room', code);
        if (new URLSearchParams(location.search).get('room') !== code) history.replaceState(null, '', '?room=' + code);
        return S.session ? showStudent() : showPad();
      }
    }
    first = false;
    screen?.update?.();
    floatUpdate(ctx);
  }, err => {
    console.warn('room', err);
    setOnline(false);
    // try again in a few seconds instead of giving up on the code
    setTimeout(() => { if (S.code === code) watchRoom(code); }, 5000);
  });
}

function showConnecting() {
  setScreen({});
  view.innerHTML = `<div class="card center-card">
    <div class="brand big-brand">Hall Pass</div>
    <h1>Connecting…</h1>
    <p class="muted">This can take a few seconds on the school network.</p>
    <p class="muted small" id="slow" hidden>Still trying. If this doesn't go away, reload the page.</p>
    <p class="muted small">Room ${esc(S.code)} · <a href="#" data-a="changeRoom">Change room</a></p>
  </div>`;
  const t = setTimeout(() => { const el = $('#slow'); if (el) el.hidden = false; }, 12000);
  screen.destroy = () => clearTimeout(t);
  view.onclick = e => {
    if (e.target.closest('[data-a="changeRoom"]')) { e.preventDefault(); roomUnsub?.(); lsSet('hp-room', null); history.replaceState(null, '', location.pathname); showCode(); }
  };
}

// Student devices send requests; your computer answers them itself.
const transport = p => S.mode === 'teacher'
  ? handleRequest(S.uid, S.T, S.code, { ...p, device: 'teacher-screen' })
  : sendRequest(S.code, p);

// ---------- PIN pad ----------
const padHTML = `<div class="dots"></div><div class="msg" aria-live="polite"></div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-k="${n}">${n}</button>`).join('')}
  <button type="button" data-k="del" aria-label="Delete">⌫</button><button type="button" data-k="0">0</button>
  <button type="button" data-k="ok" class="ok" aria-label="Enter">✓</button></div>`;

function makePad(root, onSubmit, note = '') {
  let pin = '', busy = false;
  const dots = root.querySelector('.dots'), msg = root.querySelector('.msg');
  const draw = () => {
    dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join('');
  };
  const key = async k => {
    if (busy) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (k === 'ok') {
      if (!pin) return;
      const p = pin; pin = ''; draw();
      busy = true; root.classList.add('busy'); msg.textContent = 'Checking…'; msg.classList.remove('err');
      let err;
      try { err = await onSubmit(p); } catch (e) { err = e.message; }
      busy = false; root.classList.remove('busy');
      if (!root.isConnected) return;
      msg.textContent = err || ''; msg.classList.toggle('err', !!err);
      if (err) { root.classList.add('shake'); setTimeout(() => root.classList.remove('shake'), 400); }
      return;
    } else if (pin.length < 8) { pin += k; msg.textContent = ''; }
    draw();
  };
  root.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) key(b.dataset.k); });
  const onKey = e => {
    if (!root.isConnected) return document.removeEventListener('keydown', onKey);
    if (e.target.matches?.('input, textarea, select')) return;
    if (/^\d$/.test(e.key)) key(e.key);
    else if (e.key === 'Backspace') key('del');
    else if (e.key === 'Enter') key('ok');
    else return;
    e.preventDefault();
  };
  document.addEventListener('keydown', onKey);
  draw();
  if (note) { msg.textContent = note; msg.classList.add('err'); }
}

// ---------- screens ----------
function showCode(msg = '') {
  setScreen({});
  roomUnsub?.(); roomUnsub = null; S.room = null;
  view.innerHTML = `<div class="card center-card">
    <div class="brand big-brand">Hall Pass</div>
    <h1>Enter your room code</h1>
    <p class="muted">${esc(msg || 'Your teacher will give you the code.')}</p>
    <form id="codeF" class="row center">
      <input id="codeIn" autocomplete="off" autocapitalize="characters" maxlength="8" placeholder="ABC123" class="code-input" aria-label="Room code">
      <button class="btn primary huge">Go</button>
    </form>
    <p class="muted small"><a href="#" data-a="teacher">Teacher setup</a></p>
  </div>`;
  $('#codeIn').focus();
  view.onsubmit = e => {
    e.preventDefault();
    const c = $('#codeIn').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) useRoom(c);
  };
  view.onclick = e => {
    if (e.target.closest('[data-a="teacher"]')) { e.preventDefault(); showTeacherSetup(false); }
  };
}

function showPad(note = '') {
  const isT = S.mode === 'teacher';
  const head = () => { const el = $('#cls'); if (el) el.textContent = roomTitle(); };
  setScreen({ update: head });
  view.innerHTML = `<div class="padscreen">
    <div class="brand big-brand">Hall Pass</div>
    <div class="status" data-status></div>
    <p class="big" id="cls"></p>
    <div class="card padcard" id="padbox"><h1>Type your PIN</h1>${padHTML}</div>
    <p><span class="conn" data-conn></span></p>
    <p class="muted small">${isT
      ? 'Students can type their PIN here too.'
      : `Room ${esc(S.code)} · <a href="#" data-a="changeRoom">Change room</a>`}</p>
  </div>`;
  head(); tickTimers(S.room);
  makePad($('#padbox'), async pin => {
    if (isT && await hashPin(S.uid, 'teacher', pin) === S.T.settings.teacherPinHash) {
      ssSet('hp-unlocked', '1'); showDashboard(); return;
    }
    const r = await transport({ action: 'login', pin });
    if (!r.ok) return r.msg;
    if (r.role === 'teacher') {
      if (isT) { ssSet('hp-unlocked', '1'); showDashboard(); } else showTeacherSetup(true);
      return;
    }
    S.session = { token: r.token, sid: r.sid, name: r.name, usage: r.usage || [], anytime: !!r.anytime };
    if (!isT) lsSet('hp-sess-' + S.code, JSON.stringify(S.session));
    showStudent();
  }, note);
  view.onclick = e => {
    if (e.target.closest('[data-a="changeRoom"]')) { e.preventDefault(); lsSet('hp-room', null); history.replaceState(null, '', location.pathname); showCode(); }
  };
}

// Teacher setup on a computer that isn't signed in yet: first-time setup, or open a backup file.
// fromPin = they just typed the teacher PIN on a student screen.
function showTeacherSetup(fromPin) {
  setScreen({});
  view.innerHTML = `<div class="card center-card">
    <div class="brand big-brand">Hall Pass</div>
    ${fromPin
      ? `<h1>Teacher PIN</h1><p>Your dashboard opens on your own computer. To use <b>this</b> computer instead, open your Hall Pass backup file.</p>`
      : `<h1>Teacher setup</h1><p>Open your backup file to use this computer as your teacher computer.</p>`}
    <div class="row center">
      <button class="btn primary huge" data-a="restore">Open backup file</button>
      <input type="file" id="bkFile" accept=".json,application/json" hidden>
    </div>
    ${fromPin ? '' : `<hr class="sep">
      <p class="muted">First time using Hall Pass? This creates your own private Hall Pass. Only do this once.</p>
      <button class="btn" data-a="fresh">Set up Hall Pass for the first time</button>`}
    <p class="muted small" id="setupMsg"></p>
    <p><a href="#" data-a="cancel">Cancel</a></p>
  </div>`;
  const msg = t => { $('#setupMsg').textContent = t; };
  view.onclick = async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    e.preventDefault();
    if (a === 'cancel') { const c = lsGet('hp-room'); return c ? useRoom(c) : showCode(); }
    if (a === 'restore') return $('#bkFile').click();
    if (a === 'fresh') {
      if (!confirm('Set up a brand-new Hall Pass? If you already set one up on another computer, use "Open backup file" instead.')) return;
      msg('Setting up…');
      try { await createTeacherAccount(); } // the sign-in change takes you to "Create your teacher PIN"
      catch (err) { msg(err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation'
        ? 'New setups are turned off in your Firebase project (that is expected after setup). Use your backup file.'
        : err.message); }
    }
  };
  view.onchange = async e => {
    if (e.target.id !== 'bkFile' || !e.target.files[0]) return;
    msg('Opening…');
    try {
      const text = await e.target.files[0].text();
      if (fromPin) ssSet('hp-unlocked', '1');
      await restoreBackup(text); // the sign-in change takes you to your dashboard or PIN screen
      toast('Backup opened');
    } catch (err) {
      ssSet('hp-unlocked', null);
      msg(err.code ? "That backup didn't work. Make sure it's your most recent Hall Pass backup." : err.message);
    }
    e.target.value = '';
  };
}

function showCreatePin() {
  let first = null;
  setScreen({});
  const draw = (title, sub) => {
    view.innerHTML = `<div class="padscreen">
      <div class="brand big-brand">Hall Pass</div>
      <div class="card padcard" id="padbox"><h1>${title}</h1><p class="muted">${sub}</p>${padHTML}</div></div>`;
  };
  const step1 = (note = '') => {
    draw('Create your teacher PIN', '4 to 8 digits. You’ll type it to open your dashboard.');
    makePad($('#padbox'), async pin => {
      if (!/^\d{4,8}$/.test(pin)) return 'Use 4 to 8 digits.';
      for (const c of S.T.classes) if (await matchStudentPin(S.uid, c, pin)) return 'A student already uses that PIN. Pick another.';
      first = pin; step2();
    }, note);
  };
  const step2 = () => {
    draw('Type it again', 'Just to be sure.');
    makePad($('#padbox'), async pin => {
      if (pin !== first) { step1("Those didn't match. Start over."); return; }
      await saveTeacher(S.uid, { 'settings.teacherPinHash': await hashPin(S.uid, 'teacher', pin) });
      ssSet('hp-unlocked', '1'); toast('Teacher PIN saved'); showDashboard();
    });
  };
  step1();
}

function showDashboard() {
  setScreen(null);
  screen = mountDashboard(view, ctx);
}

function showStudent() {
  const local = S.mode === 'teacher';   // a student using your computer
  let idle = null, sig = '';
  const resetIdle = () => {
    if (!local) return;
    clearTimeout(idle);
    idle = setTimeout(logout, 45000);
  };
  const logout = () => {
    const t = S.session?.token;
    if (t) transport({ action: 'logout', token: t }).catch(() => {});
    if (!local) lsSet('hp-sess-' + S.code, null);
    S.session = null;
    showPad();
  };
  const state = () => {
    const room = S.room, me = S.session.sid;
    const out = room?.out || [], line = room?.line || [];
    const isOut = out.find(o => o.id === me);
    const pos = line.findIndex(x => x.id === me);
    const d = room ? decide(room, me) : { action: 'blocked', reason: 'No class right now' };
    const st = passStatus(room);
    return { room, me, out, line, isOut, pos, d, st };
  };
  const draw = () => {
    if (!S.session || !$('#me')) return;
    const { me, out, line, isOut, pos, d, st } = state();
    const name = esc(S.session.name);
    sig = JSON.stringify([!!isOut, pos, d.action, st.state]);
    $('#cls').textContent = roomTitle();
    $('#out').innerHTML = out.length
      ? `<ul class="list">${out.map(o => `<li class="${o.id === me ? 'me' : ''}"><span class="name">${esc(o.name)}</span><span class="timer" data-since="${o.since}"></span></li>`).join('')}</ul>`
      : '<p class="muted">Nobody is out.</p>';
    $('#line').innerHTML = line.length
      ? `<ol class="list">${line.map(x => `<li class="${x.id === me ? 'me' : ''}"><span class="name">${esc(x.name)}</span></li>`).join('')}</ol>`
      : '<p class="muted">No one is waiting.</p>';
    let html, up = false;
    if (isOut) {
      html = `<p class="eyebrow">You're out</p><p class="huge-time"><span class="timer" data-since="${isOut.since}"></span></p>
        <button class="btn primary xl" data-a="back">I'm back</button>`;
    } else if (S.session.anytime && st.state !== 'closed') {
      html = `<p class="big">You can go any time</p><p class="muted">Tap the button as you leave the room.</p>
        <button class="btn primary xl" data-a="go">I'm leaving now</button>`;
    } else if (pos >= 0 && d.action === 'go') {
      up = true;
      html = `<p class="up-banner">${name}, you're up!</p><p class="muted">Tap the button as you leave the room.</p>
        <div class="row center"><button class="btn primary xl" data-a="go">I'm leaving now</button></div>
        <button class="btn ghost sm" data-a="leave">Leave the line</button>`;
    } else if (pos < 0 && usedUp(S.session.usage) && st.state !== 'closed') {
      html = `<p class="big">No passes left</p><p class="muted">${esc(usedUpMsg(usedUp(S.session.usage)))}</p>`;
    } else if (pos >= 0) {
      html = `<p class="big">You're #${pos + 1} in line</p>
        <p class="muted">${esc(d.reason || st.label)}. This page will tell you when it's your turn.</p>
        <button class="btn" data-a="leave">Leave the line</button>`;
    } else if (d.action === 'go') {
      html = `<p class="big">The pass is open</p><p class="muted">Tap the button as you leave the room.</p>
        <button class="btn primary xl" data-a="go">I'm leaving now</button>`;
    } else if (st.state === 'closed') {
      html = `<p class="big">There's no class right now.</p>`;
    } else {
      html = `<p class="big">Need to go?</p><p class="muted">${esc(d.reason || st.label)}. You can still get in line.</p>
        <button class="btn primary xl" data-a="join">Get in line</button>`;
    }
    const usage = S.session.usage || [];
    if (usage.length && !isOut) {
      html += `<p class="passes-left">Passes left: ${usage.map(u => `<b class="${u.left ? '' : 'danger-text'}">${u.left}</b> ${esc(u.label)}`).join(' · ')}</p>`;
    }
    const meEl = $('#me');
    meEl.innerHTML = html;
    meEl.classList.toggle('is-up', up);
    document.title = up ? "You're up! · Hall Pass" : 'Hall Pass';
    tickTimers(S.room);
  };

  setScreen({
    update: draw,
    tick: () => { if (S.session && $('#me')) { const { isOut, pos, d, st } = state(); if (JSON.stringify([!!isOut, pos, d.action, st.state]) !== sig) draw(); } },
    destroy: () => { clearTimeout(idle); document.title = 'Hall Pass'; },
  });
  view.innerHTML = `<header class="top">
      <div class="brand">Hall Pass</div><div class="grow"></div>
      <span class="muted" id="cls"></span><span class="conn" data-conn></span>
      <button class="btn sm" data-a="logout">${local ? 'Done' : 'Log out'}</button>
    </header>
    <main class="narrow">
      <p class="hello">Hi, ${esc(S.session.name)}</p>
      <div class="status" data-status></div>
      <div class="card me" id="me"></div>
      <div class="grid2">
        <div class="card"><h2>Out now</h2><div id="out"></div></div>
        <div class="card"><h2>Line</h2><div id="line"></div></div>
      </div>
    </main>`;
  draw();
  resetIdle();

  view.onclick = async e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    resetIdle();
    const a = b.dataset.a;
    if (a === 'logout') return logout();
    view.querySelectorAll('#me button').forEach(x => (x.disabled = true));
    const r = await transport({ action: a, token: S.session.token });
    if (r.expired) {
      if (!local) lsSet('hp-sess-' + S.code, null);
      S.session = null;
      return showPad(r.msg);
    }
    if (S.session && 'anytime' in r) S.session.anytime = !!r.anytime;
    if (r.usage && S.session) {
      S.session.usage = r.usage;
      if (!local) lsSet('hp-sess-' + S.code, JSON.stringify(S.session));
    }
    toast(r.msg, !r.ok);
    draw();
    if (local && r.ok && (a === 'go' || a === 'back')) setTimeout(() => { if (S.session) logout(); }, 3000);
  };
}
