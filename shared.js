// Firebase setup, the shared room actions, and the PIN check that runs on the teacher's screen.
//
// How PINs stay private: students never see anyone's PIN, not even scrambled. A student's device
// drops a sealed "request" (their PIN or sign-in token) into a mailbox only the teacher can open.
// The teacher's screen checks it, makes the change, and leaves a reply. That's why the teacher
// page needs to be open during class.
import * as F from './fb.js';
import { firebaseConfig } from './firebase-config.js';
import { activeClass, noPassWindows, dateKey, decide, passStatus, fmtElapsed, limitWindows, passUsage, usedUp, usedUpMsg } from './logic.js';

export const configured = !String(firebaseConfig.apiKey || '').includes('PASTE');
const app = configured ? F.initializeApp(firebaseConfig) : null;
export const auth = app ? F.getAuth(app) : null;
// Long polling works through school web filters that break Firebase's normal streaming connection.
export const db = app ? F.initializeFirestore(app, { experimentalForceLongPolling: true }) : null;

export const { onAuthStateChanged, onSnapshot, getDoc, getDocs, query, orderBy, limit } = F;
export const signOutNow = () => F.signOut(auth);

export const teacherRef = uid => F.doc(db, 'teachers', uid);
export const logCol = uid => F.collection(db, 'teachers', uid, 'log');
const tokensCol = uid => F.collection(db, 'teachers', uid, 'tokens');
const tokenRef = (uid, t) => F.doc(db, 'teachers', uid, 'tokens', t);
export const roomRef = code => F.doc(db, 'rooms', code);
const reqCol = code => F.collection(db, 'rooms', code, 'requests');
const reqRef = (code, id) => F.doc(db, 'rooms', code, 'requests', id);
const repliesCol = code => F.collection(db, 'rooms', code, 'replies');
const replyRef = (code, id) => F.doc(db, 'rooms', code, 'replies', id);

// ---------- small utilities ----------
export function newId(n = 10) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), b => a[b % a.length]).join('');
}
export function newRoomCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L, easier for kids to type
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), b => a[b % a.length]).join('');
}
export async function hashPin(uid, who, pin) {
  const data = new TextEncoder().encode(`${uid}|${who}|${pin}`);
  const h = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function lsSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } }
export function ssGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
export function ssSet(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } }
export function deviceId() {
  let d = lsGet('hp-device');
  if (!d) { d = newId(16); lsSet('hp-device', d); }
  return d;
}

let toastTimer;
export function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  if (!t || !msg) return;
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isError ? 5000 : 2200);
}

export function setupNotice(el) {
  el.innerHTML = `<div class="card center-card"><h1>Almost ready</h1>
    <p>This site isn't connected to Firebase yet. Paste your Firebase settings into
    <code>firebase-config.js</code> (see SETUP.md), then reload.</p></div>`;
}

// Updates running timers and status banners. Called once a second.
export function tickTimers(room, root = document) {
  const lim = (room?.timeLimitMin || 8) * 60000;
  root.querySelectorAll('.timer[data-since]').forEach(el => {
    const ms = Date.now() - Number(el.dataset.since);
    el.textContent = fmtElapsed(ms);
    el.classList.toggle('over', ms > lim);
  });
  root.querySelectorAll('[data-status]').forEach(el => {
    const s = passStatus(room);
    el.className = 'status ' + s.state;
    el.textContent = s.label;
  });
}

// ---------- the teacher key (no visible login) ----------
// The first time you set up, the site makes a hidden account in your Firebase project with a long
// random key. That key, not your PIN, is what lets your computer change things. Your PIN just locks
// the screen. The key is saved in this browser and in your backup file.
const KEY = 'hp-teacher-key';
export function savedKey() { try { return JSON.parse(lsGet(KEY) || 'null'); } catch { return null; } }

export async function createTeacherAccount() {
  const key = { email: `teacher-${newId(12)}@example.com`, password: newId(32) };
  await F.createUserWithEmailAndPassword(auth, key.email, key.password);
  lsSet(KEY, JSON.stringify(key));
  lsSet('hp-backup-at', null);
  return key;
}

export function backupText(T) {
  return JSON.stringify({
    app: 'hall-pass', version: 2, savedAt: new Date().toISOString(),
    note: 'Keep this file private. It opens your Hall Pass dashboard on any computer.',
    key: savedKey(),
    data: { settings: T.settings, classes: T.classes, periods: T.periods }
  }, null, 2);
}

export async function restoreBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch { throw new Error("That isn't a Hall Pass backup file."); }
  if (b?.app !== 'hall-pass' || !b.key?.email || !b.key?.password) throw new Error("That isn't a Hall Pass backup file.");
  let cred, fresh = false;
  try {
    cred = await F.signInWithEmailAndPassword(auth, b.key.email, b.key.password);
  } catch (e) {
    // The account is gone (for example, deleted in Firebase). Start a new one from the saved data.
    if (!b.data) throw e;
    cred = await F.createUserWithEmailAndPassword(auth, b.key.email, b.key.password);
    fresh = true;
  }
  lsSet(KEY, JSON.stringify(b.key));
  lsSet('hp-backup-at', b.savedAt || new Date().toISOString());
  const ref = teacherRef(cred.user.uid);
  const s = await F.getDoc(ref);
  if (b.data && (fresh || !s.exists() || !(s.data().classes || []).length)) {
    const data = structuredClone(b.data);
    if (fresh) data.settings = { ...data.settings, roomCode: newRoomCode() };
    await F.setDoc(ref, data);
  }
}

// ---------- teacher document ----------
export async function ensureTeacher(uid) {
  const ref = teacherRef(uid);
  // A transaction, so it never overwrites data a backup restore is writing at the same moment.
  await F.runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      tx.set(ref, {
        settings: { maxOut: 1, timeLimitMin: 8, paused: false, override: '', roomCode: newRoomCode(),
          teacherPinHash: null, autoLockMin: 10 },
        classes: [], periods: []
      });
    } else if (!snap.data().settings?.roomCode) {
      tx.update(ref, { 'settings.roomCode': newRoomCode() });
    }
  });
}
export const saveTeacher = (uid, patch) => F.updateDoc(teacherRef(uid), patch);

// ---------- the room (what students can see with the room code) ----------
// Holds only: the current class name, no-pass times, and the names of students who are
// out or in line (first name + last initial). No rosters, no PINs, no schedule, no history.
export function desiredRoom(uid, T, d = new Date()) {
  const s = T.settings || {};
  const a = activeClass(T, d);
  const p = a?.period;
  return {
    ownerUid: uid,
    periodKey: p ? `${dateKey(d)}|${p.id}` : null,
    period: p ? {
      name: p.name || '', className: a.cls.name,
      start: p.start, end: p.end, manual: !!p.manual,
      windows: p.manual ? [] : noPassWindows(p)
    } : null,
    maxOut: Number(s.maxOut) || 1, timeLimitMin: Number(s.timeLimitMin) || 8, paused: !!s.paused
  };
}

// Keeps the room in step with the schedule. Only writes when something changed.
export async function syncRoom(uid, T) {
  const code = T?.settings?.roomCode;
  if (!code) return;
  const want = desiredRoom(uid, T);
  const sig = JSON.stringify(want);
  await F.runTransaction(db, async tx => {
    const ref = roomRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists()) { tx.set(ref, { ...want, sig, out: [], line: [] }); return; }
    const cur = snap.data();
    if (cur.sig === sig) return;
    const upd = { ...want, sig };
    if (cur.periodKey !== want.periodKey) upd.line = []; // new class, fresh line
    tx.update(ref, upd);
  });
}

export async function rotateRoomCode(uid, T) {
  const old = T.settings?.roomCode;
  const code = newRoomCode();
  let carry = { out: [], line: [] };
  if (old) {
    const s = await F.getDoc(roomRef(old));
    if (s.exists()) carry = { out: s.data().out || [], line: s.data().line || [] };
  }
  const want = desiredRoom(uid, T);
  await F.setDoc(roomRef(code), { ...want, sig: JSON.stringify(want), ...carry });
  await F.updateDoc(teacherRef(uid), { 'settings.roomCode': code });
  if (old) await F.deleteDoc(roomRef(old)).catch(() => {});
  return code;
}

// ---------- pass actions (run by the teacher's screen) ----------
// force=true is the teacher overriding the line and no-pass times.
export async function goOut(uid, code, student, { force = false, anytime = false } = {}) {
  const logRef = F.doc(logCol(uid));
  let info = null;
  await F.runTransaction(db, async tx => {
    const ref = roomRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room not found');
    const room = snap.data();
    if ((room.out || []).some(o => o.id === student.id)) return;
    if (!force && !anytime) {
      const d = decide(room, student.id);
      if (d.action !== 'go') throw new Error(d.reason || "It's not your turn yet");
    }
    const since = Date.now(), limitMin = room.timeLimitMin || 8;
    info = { className: room.period?.className || '', periodName: room.period?.name || '', since, limitMin };
    tx.update(ref, {
      out: [...(room.out || []), { id: student.id, name: student.name, since, limitMin, logId: logRef.id, ...(anytime ? { anytime: true } : {}) }],
      line: (room.line || []).filter(x => x.id !== student.id)
    });
  });
  if (!info) return false; // already out: nothing new logged
  {
    await F.setDoc(logRef, {
      studentId: student.id, name: student.name, className: info.className, periodName: info.periodName,
      date: dateKey(new Date(info.since)), out: info.since, back: null, minutes: null,
      limitMin: info.limitMin, over: false, by: force && !anytime ? 'teacher' : 'student', anytime: !!anytime
    });
  }
  return true;
}

export async function comeBack(uid, code, studentId) {
  let entry = null;
  await F.runTransaction(db, async tx => {
    const ref = roomRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const out = snap.data().out || [];
    entry = out.find(o => o.id === studentId) || null;
    if (entry) tx.update(ref, { out: out.filter(o => o.id !== studentId) });
  });
  if (entry?.logId) {
    const back = Date.now();
    const minutes = Math.round((back - entry.since) / 6000) / 10;
    await F.updateDoc(F.doc(logCol(uid), entry.logId), {
      back, minutes, over: minutes > (entry.limitMin || 8)
    }).catch(() => {});
  }
}

export async function joinLine(code, student) {
  let pos = 0;
  await F.runTransaction(db, async tx => {
    const ref = roomRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Room not found');
    const room = snap.data();
    const line = room.line || [];
    const i = line.findIndex(x => x.id === student.id);
    if (i >= 0) { pos = i + 1; return; }
    if ((room.out || []).some(o => o.id === student.id)) throw new Error("You're already out");
    if (!room.period) throw new Error('There’s no class right now');
    pos = line.length + 1;
    tx.update(ref, { line: [...line, { id: student.id, name: student.name, at: Date.now() }] });
  });
  return pos;
}

export async function leaveLine(code, studentId) {
  await F.runTransaction(db, async tx => {
    const ref = roomRef(code);
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const line = snap.data().line || [];
    if (line.some(x => x.id === studentId)) tx.update(ref, { line: line.filter(x => x.id !== studentId) });
  });
}

// ---------- pass limits ----------
// Counts a student's passes from your log. Returns [] when no limits are on or the student has "No limit".
export async function studentUsage(uid, T, stu) {
  const w = limitWindows(T.settings);
  if (!w.length || stu?.noLimit || stu?.anytime) return [];
  const snap = await F.getDocs(F.query(logCol(uid), F.where('studentId', '==', stu.id)));
  return passUsage(snap.docs.map(d => d.data()), w);
}
export const setExcused = (uid, logId, excused) => F.updateDoc(F.doc(logCol(uid), logId), { excused });

// ---------- PIN check: runs only on the teacher's screen ----------
const fails = new Map(); // device -> { n, until }
function failed(dev, msg) {
  const f = fails.get(dev) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; msg = 'Too many wrong PINs. Wait a minute, then try again.'; }
  fails.set(dev, f);
  return { ok: false, msg };
}

// Finds the student in the current class whose PIN this is (null if none).
export async function matchStudentPin(uid, cls, pin) {
  for (const s of cls?.students || []) {
    if (s.pinHash && await hashPin(uid, s.id, pin) === s.pinHash) return s;
  }
  return null;
}

export async function handleRequest(uid, T, code, req) {
  try {
    const dev = String(req.device || 'unknown');
    const f = fails.get(dev);
    if (f && f.until > Date.now()) return { ok: false, msg: 'Too many wrong PINs. Wait a minute, then try again.' };
    const a = activeClass(T);

    if (req.action === 'login') {
      const pin = String(req.pin || '');
      if (!/^\d{3,8}$/.test(pin)) return failed(dev, 'Wrong PIN. Try again.');
      if (T.settings?.teacherPinHash && await hashPin(uid, 'teacher', pin) === T.settings.teacherPinHash) {
        fails.delete(dev);
        return { ok: true, role: 'teacher' };
      }
      if (!a) return { ok: false, msg: 'There’s no class right now.' };
      const s = await matchStudentPin(uid, a.cls, pin);
      if (!s) return failed(dev, 'Wrong PIN. Try again.');
      fails.delete(dev);
      const token = newId(24);
      await F.setDoc(tokenRef(uid, token), { sid: s.id, classId: a.cls.id, day: dateKey(), at: Date.now() });
      const usage = await studentUsage(uid, T, s).catch(() => []);
      return { ok: true, role: 'student', token, sid: s.id, name: s.name, usage, anytime: !!s.anytime };
    }

    // Everything else needs a valid sign-in token from today, for the class that's here now.
    const tok = /^[a-z0-9]{10,40}$/.test(String(req.token || '')) ? await F.getDoc(tokenRef(uid, req.token)) : null;
    const t = tok?.exists() ? tok.data() : null;
    const stu = t && a && t.day === dateKey() && t.classId === a.cls.id
      ? (a.cls.students || []).find(s => s.id === t.sid) : null;
    if (!stu) {
      if (t) await F.deleteDoc(tokenRef(uid, req.token)).catch(() => {});
      return { ok: false, expired: true, msg: 'Please type your PIN again.' };
    }
    const student = { id: stu.id, name: stu.name };
    const usage = ['join', 'go', 'back'].includes(req.action) ? await studentUsage(uid, T, stu).catch(() => []) : undefined;
    const hit = usedUp(usage);
    const R = o => ({ ...o, anytime: !!stu.anytime }); // keeps the student's screen up to date
    switch (req.action) {
      case 'join': {
        if (hit) return R({ ok: false, msg: usedUpMsg(hit), usage });
        const n = await joinLine(code, student); return R({ ok: true, msg: `You're #${n} in line`, usage });
      }
      case 'leave': await leaveLine(code, student.id); return R({ ok: true, msg: 'You left the line' });
      case 'go': {
        if (stu.anytime) { await goOut(uid, code, student, { anytime: true }); return R({ ok: true, msg: 'Go ahead', usage: [], anytime: true }); }
        // Limits are checked when joining the line. Someone already in line (or added by you) can go.
        const rs = hit ? await F.getDoc(roomRef(code)) : null;
        const inLine = (rs?.data()?.line || []).some(x => x.id === student.id);
        if (hit && !inLine) return R({ ok: false, msg: usedUpMsg(hit), usage });
        const logged = await goOut(uid, code, student);
        return R({ ok: true, msg: 'Go straight there and back', usage: logged ? usage.map(u => ({ ...u, used: u.used + 1, left: Math.max(0, u.left - 1) })) : usage });
      }
      case 'back': await comeBack(uid, code, student.id); return R({ ok: true, msg: 'Welcome back!', usage });
      case 'logout': await F.deleteDoc(tokenRef(uid, req.token)).catch(() => {}); return R({ ok: true });
      default: return { ok: false, msg: 'Unknown request' };
    }
  } catch (e) {
    return { ok: false, msg: e.message || 'Something went wrong' };
  }
}

// The teacher's screen watches the mailbox and answers each request once.
export function startProcessor(uid, getT, code) {
  const seen = new Set();
  const now = Date.now(), today = dateKey();
  // tidy up old replies and old sign-ins
  F.getDocs(repliesCol(code)).then(s => s.docs.forEach(d => {
    if ((d.data().at || 0) < now - 10 * 60000) F.deleteDoc(replyRef(code, d.id)).catch(() => {});
  })).catch(() => {});
  F.getDocs(tokensCol(uid)).then(s => s.docs.forEach(d => {
    if (d.data().day !== today) F.deleteDoc(tokenRef(uid, d.id)).catch(() => {});
  })).catch(() => {});

  async function claim(id) {
    let req = null;
    try {
      await F.runTransaction(db, async tx => {
        const s = await tx.get(reqRef(code, id));
        if (!s.exists()) return; // another teacher screen already took it
        req = s.data();
        tx.delete(reqRef(code, id));
      });
    } catch (e) { console.warn('claim', e); return; }
    if (!req) return;
    const at = typeof req.at?.toMillis === 'function' ? req.at.toMillis() : Number(req.at) || Date.now();
    const reply = Date.now() - at > 60000
      ? { ok: false, msg: 'That took too long. Try again.' }
      : await handleRequest(uid, getT(), code, req);
    await F.setDoc(replyRef(code, id), { ...reply, at: Date.now() }).catch(e => console.warn('reply', e));
  }

  return F.onSnapshot(reqCol(code), snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type === 'added' && !seen.has(ch.doc.id)) { seen.add(ch.doc.id); claim(ch.doc.id); }
    });
  }, e => console.warn('requests', e));
}

// ---------- student devices: send a request and wait for the teacher's screen to answer ----------
export async function sendRequest(code, payload, timeoutMs = 25000) {
  const ref = F.doc(reqCol(code));
  const body = { action: payload.action, device: deviceId(), at: F.serverTimestamp() };
  if (payload.pin != null) body.pin = String(payload.pin);
  if (payload.token != null) body.token = String(payload.token);
  return new Promise(resolve => {
    let done = false, unsub = null, timer = null;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); if (unsub) unsub(); resolve(r); };
    unsub = F.onSnapshot(replyRef(code, ref.id), s => {
      if (!s.exists()) return;
      const r = s.data();
      F.deleteDoc(replyRef(code, ref.id)).catch(() => {});
      finish(r);
    }, () => {});
    if (done) unsub();
    timer = setTimeout(() => finish({ ok: false, offline: true,
      msg: "Your teacher's screen isn't answering. Ask your teacher to open Hall Pass." }), timeoutMs);
    // Don't wait for the send to finish first: on a shaky connection it can stall, and the timer below
    // still needs to run so the student isn't stuck on "Checking…".
    F.setDoc(ref, body).catch(() => finish({ ok: false, msg: "Couldn't reach Hall Pass. Check your internet and try again." }));
  });
}
