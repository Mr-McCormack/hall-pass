// The floating window: a small always-on-top window for your screen.
// In Chrome and Edge it uses Picture-in-Picture, so it floats over every app (PowerPoint, Desmos, etc.).
// In other browsers it falls back to a small pop-up window.
import { goOut, comeBack, leaveLine, esc, toast, tickTimers, lsGet } from './shared.js';
import { passStatus, upList } from './logic.js';

let win = null;
let lastUps = null;
let audioCtx = null;

export const floatIsOpen = () => !!win && !win.closed;
export function closeFloat() { try { win?.close(); } catch { /* ignore */ } win = null; }

export async function openFloat(ctx) {
  if (floatIsOpen()) { try { win.focus(); } catch { /* ignore */ } return; }
  const w = 360, h = 250;
  win = null;
  if ('documentPictureInPicture' in window) {
    try { win = await window.documentPictureInPicture.requestWindow({ width: w, height: h }); } catch { win = null; }
  }
  if (!win) {
    win = window.open('', 'hallpass-float', `popup,width=${w},height=${h}`);
    if (!win) { toast('Your browser blocked the window. Allow pop-ups for this site, or use Chrome or Edge.', true); return; }
    toast('Tip: in Chrome or Edge this window stays on top of everything.');
  }
  const d = win.document;
  d.title = 'Hall Pass';
  d.head.innerHTML = '';
  const link = d.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('style.css', location.href).href;
  d.head.appendChild(link);
  d.body.className = 'float-body';
  d.body.innerHTML = '<div id="fl" class="fl closed"></div>';
  d.body.addEventListener('click', e => floatClick(ctx, e));
  win.addEventListener('pagehide', () => { win = null; });
  floatUpdate(ctx);
}

function chime() {
  if (lsGet('hp-chime') === 'off') return;
  try {
    audioCtx ||= new AudioContext();
    const t = audioCtx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(audioCtx.destination);
      const s = t + i * 0.18;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.25, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.35);
      o.start(s); o.stop(s + 0.4);
    });
  } catch { /* sound is optional */ }
}

// Called whenever the room changes.
export function floatUpdate(ctx) {
  const S = ctx.S;
  if (S.mode !== 'teacher') return;
  const r = S.room;
  const ups = upList(r || {});
  // chime when someone new is up (not on page load)
  const ids = new Set(ups.map(u => u.id));
  const fresh = lastUps && [...ids].some(id => !lastUps.has(id));
  lastUps = ids;
  if (fresh) chime();

  if (!floatIsOpen()) return;
  const el = win.document.getElementById('fl');
  if (!el) return;
  const st = passStatus(r);
  const out = r?.out || [], line = r?.line || [];
  let state = st.state, main;
  if (ups.length) { state = 'up'; main = `${esc(ups[0].name)}, you're up!`; }
  else if (out.length) { state = 'full'; main = `${esc(out[0].name)} is out`; }
  else main = esc(st.label);

  const rows = [
    ...ups.map(u => `<div class="fl-row"><span class="name">${esc(u.name)}</span>
      <button class="fl-btn go" data-fa="go" data-id="${u.id}" title="Mark as left the room">Left</button>
      <button class="fl-btn ghost" data-fa="skip" data-id="${u.id}" title="Take out of the line">Skip</button></div>`),
    ...out.map(o => `<div class="fl-row"><span class="name">${esc(o.name)}</span>
      <span class="timer" data-since="${o.since}"></span>
      <button class="fl-btn back" data-fa="back" data-id="${o.id}" title="Mark as back">Back</button></div>`),
  ].join('');
  const waiting = line.filter(x => !ids.has(x.id));
  const foot = [
    (out.length || ups.length) && (st.state === 'nopass' || st.state === 'paused') ? esc(st.label) : '',
    waiting.length ? `Next: ${esc(waiting[0].name)}${waiting.length > 1 ? ` · ${waiting.length} waiting` : ''}` : '',
    !r?.period ? '' : esc(r.period.className),
  ].filter(Boolean).join(' · ');

  const wasUp = el.classList.contains('up');
  el.className = `fl ${state}`;
  el.innerHTML = `<div class="fl-main">${main}</div>${rows ? `<div class="fl-rows">${rows}</div>` : ''}<div class="fl-foot">${foot}</div>`;
  if (fresh && !wasUp) { el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 3000); }
  floatTick(ctx);
}

// Once a second: timers, and turn red if a pass runs too long.
export function floatTick(ctx) {
  if (!floatIsOpen() || ctx.S.mode !== 'teacher') return;
  const d = win.document, r = ctx.S.room;
  tickTimers(r, d);
  const el = d.getElementById('fl');
  if (!el) return;
  const over = (r?.out || []).some(o => Date.now() - o.since > (o.limitMin || r.timeLimitMin || 8) * 60000);
  el.classList.toggle('over', over);
  // no-pass times start and end on the clock, not on a change, so re-check the status
  const st = passStatus(r).state;
  if (el.dataset.st !== st) { el.dataset.st = st; if (el.dataset.ready) floatUpdate(ctx); el.dataset.ready = '1'; }
}

async function floatClick(ctx, e) {
  const b = e.target.closest('[data-fa]');
  if (!b) return;
  const { uid, code, room } = ctx.S;
  const id = b.dataset.id;
  b.disabled = true;
  try {
    if (b.dataset.fa === 'go') {
      const s = (room?.line || []).find(x => x.id === id);
      if (s) await goOut(uid, code, { id: s.id, name: s.name }, { force: true });
    } else if (b.dataset.fa === 'back') await comeBack(uid, code, id);
    else if (b.dataset.fa === 'skip') await leaveLine(code, id);
  } catch (err) { toast(err.message, true); b.disabled = false; }
}
