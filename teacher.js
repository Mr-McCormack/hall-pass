// Your dashboard: live view, classes and PINs, schedule, the day's log, and settings.
import {
  getDocs, query, orderBy, limit, logCol, saveTeacher, rotateRoomCode, goOut, comeBack, joinLine, leaveLine,
  hashPin, matchStudentPin, newId, esc, toast, tickTimers, lsGet, lsSet, backupText, savedKey
} from './shared.js';
import { DAY_NAMES, fmt12, fmtClock, currentPeriod, activeClass, shortName, byName, toMin, minToHHMM, overlaps, upList, dateKey } from './logic.js';

export function mountDashboard(view, ctx) {
  const S = ctx.S;
  const $ = s => view.querySelector(s);
  let tab = lsGet('hp-tab') || 'live';
  let selClass = null, pendingRender = false;
  let log = null, logLoading = false, logDay = dateKey(), logClass = '';
  let idleTimer = null, manualPickId = '';

  const T = () => S.T;
  const uid = () => S.uid;
  const code = () => S.code;
  const room = () => S.room;
  const studentLink = () => location.origin + location.pathname + '?room=' + code();
  const findClass = id => T().classes.find(c => c.id === id);
  const findStu = id => findClass(selClass)?.students.find(s => s.id === id);
  const current = () => activeClass(T());
  const save = async (patch, quiet) => {
    try { await saveTeacher(uid(), patch); if (!quiet) toast('Saved'); }
    catch (e) { toast('Could not save: ' + e.message, true); }
  };
  const saveClasses = () => save({ classes: T().classes });
  const savePeriods = () => save({ periods: T().periods });

  view.innerHTML = `<header class="top">
      <div class="brand">Hall Pass</div>
      <nav id="tabs">
        <button data-tab="live">Live</button><button data-tab="classes">Classes</button>
        <button data-tab="schedule">Schedule</button><button data-tab="log">Log</button>
        <button data-tab="settings">Settings</button>
      </nav>
      <div class="grow"></div>
      <span class="conn" data-conn></span>
      <button class="btn primary" data-top="float">⧉ Floating window</button>
      <button class="btn" data-top="lock">🔒 Lock</button>
    </header>
    <div id="bk"></div>
    <main id="panel"></main>`;
  const panel = $('#panel');

  // ---------- auto-lock when you step away ----------
  const resetIdle = () => {
    clearTimeout(idleTimer);
    const m = Number(T().settings.autoLockMin);
    if (m > 0) idleTimer = setTimeout(() => ctx.lock(), m * 60000);
  };
  const activity = () => resetIdle();
  ['pointerdown', 'keydown', 'pointermove'].forEach(ev => document.addEventListener(ev, activity, { passive: true }));
  resetIdle();

  // ---------- rendering ----------
  function render(force) {
    if (!T()) return;
    view.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const a = document.activeElement;
    if (!force && a && panel.contains(a) && a.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=file])')) { pendingRender = true; return; }
    pendingRender = false;
    $('#bk').innerHTML = lsGet('hp-backup-at') ? '' : `<div class="backup-banner">
      <span><b>Download your backup file.</b> It's the only way back into your dashboard if this browser's data gets cleared or you switch computers.</span>
      <button class="btn primary" data-action="backup">Download backup</button></div>`;
    ({ live: renderLive, classes: renderClasses, schedule: renderSchedule, log: renderLog, settings: renderSettings }[tab] || renderLive)();
    tickTimers(room());
  }
  panel.addEventListener('focusout', () => setTimeout(() => { if (pendingRender) render(); }, 0));

  // ---------- Live ----------
  function renderLive() {
    const s = T().settings, r = room(), per = r?.period;
    const title = per ? (per.name ? `${per.name}: ${per.className}` : per.className) : 'No class scheduled';
    const roster = (current()?.cls.students || []).slice().sort(byName);
    const ups = upList(r || {});
    const upIds = new Set(ups.map(u => u.id));
    panel.innerHTML = `
      <div class="status" data-status></div>
      <div class="grid3">
        <div class="card">
          <h2>Up next</h2>
          ${ups.length ? `<ul class="list">${ups.map(u => `<li><span class="name">${esc(u.name)}</span>
            <button class="btn sm primary" data-action="go" data-id="${u.id}">Left</button>
            <button class="btn sm ghost" data-action="skip" data-id="${u.id}">Skip</button></li>`).join('')}</ul>`
            : '<p class="muted">Nobody yet.</p>'}
        </div>
        <div class="card"><h2>Out now</h2>${(r?.out || []).length ? `<ul class="list">${r.out.map(o => `<li>
            <span class="name">${esc(o.name)}</span><span class="muted">left ${fmtClock(o.since)}</span>
            <span class="timer" data-since="${o.since}"></span>
            <button class="btn sm primary" data-action="back" data-id="${o.id}">Back</button></li>`).join('')}</ul>`
            : '<p class="muted">Nobody is out.</p>'}</div>
        <div class="card"><h2>Line</h2>${(r?.line || []).length ? `<ol class="list">${r.line.map(x => `<li>
            <span class="name">${esc(x.name)}</span>${upIds.has(x.id) ? '<span class="pill up">up</span>' : ''}
            <button class="btn sm ghost" data-action="skip" data-id="${x.id}" title="Remove from line">✕</button></li>`).join('')}</ol>`
            : '<p class="muted">No one is waiting.</p>'}</div>
      </div>
      <div class="grid2">
        <div class="card">
          <h2>Right now</h2>
          <p class="big">${esc(title)}</p>
          ${per ? `<p class="muted">${per.manual ? 'Picked by hand (schedule is ignored)' : `${fmt12(per.start)}–${fmt12(per.end)}`}</p>` : ''}
          ${per && per.windows.length ? `<p class="muted">No passes: ${per.windows.map(w => `${fmt12(w.start)}–${fmt12(w.end)}`).join(', ')}</p>` : ''}
          <label class="field">Class
            <select data-change="override">
              <option value="">Follow the schedule</option>
              ${T().classes.map(c => `<option value="${c.id}" ${s.override === c.id ? 'selected' : ''}>${esc(c.name)} (by hand)</option>`).join('')}
            </select>
          </label>
          <div class="row"><button class="btn ${s.paused ? 'danger' : ''}" data-action="pause">${s.paused ? 'Resume passes' : 'Pause passes'}</button>
            <span class="muted small">Only for surprises. No-pass times happen on their own.</span></div>
        </div>
        <div class="card">
          <h2>Students without a computer</h2>
          ${roster.length ? `<p class="muted">They can type their PIN on any computer, including this one after you lock it. Or do it for them:</p>
            <div class="row"><select id="manualPick">${roster.map(x => `<option value="${x.id}" ${x.id === manualPickId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
            <button class="btn" data-action="mLine">Add to line</button>
            <button class="btn" data-action="mGo">Send now</button></div>
            <p class="muted small">"Send now" skips the line and no-pass times.</p>`
            : '<p class="muted">No class right now.</p>'}
          <h3>Room code</h3>
          <div class="row"><span class="code">${esc(s.roomCode)}</span>
            <button class="btn sm" data-action="copylink">Copy student link</button>
            <button class="btn sm ghost" data-action="rotate">New code</button></div>
        </div>
      </div>`;
  }

  // ---------- Classes ----------
  function renderClasses() {
    if (!findClass(selClass)) selClass = T().classes[0]?.id || null;
    const c = findClass(selClass);
    panel.innerHTML = `<div class="layout-side">
      <div class="card">
        <h2>Classes</h2>
        <ul class="pick">${T().classes.map(x => `<li><button class="${x.id === selClass ? 'active' : ''}" data-action="selClass" data-id="${x.id}">
          <span>${esc(x.name)}</span><span class="muted">${(x.students || []).length}</span></button></li>`).join('')}</ul>
        <div class="row"><input id="newClass" placeholder="New class name" class="grow"><button class="btn" data-action="addClass">Add</button></div>
      </div>
      <div class="card">${c ? classEditor(c) : '<p class="muted">Add a class to get started, then add students and set their PINs.</p>'}</div>
    </div>`;
  }
  function classEditor(c) {
    const st = (c.students || []).slice().sort(byName);
    const noPin = st.filter(s => !s.pinHash).length;
    return `
      <div class="row spread">
        <label class="field grow">Class name<input data-change="className" value="${esc(c.name)}"></label>
        <button class="btn ghost danger-text" data-action="delClass">Delete class</button>
      </div>
      <h3>Students (${st.length})${noPin ? ` <span class="pill warn">${noPin} without a PIN</span>` : ''}</h3>
      ${st.length ? `<div class="tblwrap"><table class="tbl"><thead><tr><th>Name shown</th><th>PIN</th><th></th></tr></thead><tbody>
        ${st.map(s => `<tr>
          <td><input data-change="stuName" data-id="${s.id}" value="${esc(s.name)}"></td>
          <td><div class="row nowrap">
            <span class="pill ${s.pinHash ? 'ok' : 'warn'}">${s.pinHash ? 'PIN set' : 'No PIN'}</span>
            <input class="pin" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="${s.pinHash ? 'New PIN' : 'PIN'}" data-pin="${s.id}">
            <button class="btn sm" data-action="setPin" data-id="${s.id}">Save</button>
          </div></td>
          <td><button class="btn sm ghost" data-action="delStu" data-id="${s.id}" title="Remove student">✕</button></td>
        </tr>`).join('')}</tbody></table></div>
        <p class="muted">PINs are 4 to 8 digits and must be different for each student in a class. They're stored scrambled,
          so you can set a new one any time but can't look an old one up.</p>`
        : '<p class="muted">No students yet.</p>'}
      <h3>Add students</h3>
      <p class="muted">Paste one per line, like <code>Maria Lopez</code> or <code>Lopez, Maria</code>. Only the first initial and last name are saved (Maria Lopez → M. Lopez). You can edit the shown name afterward if two students match.</p>
      <textarea id="addStu" rows="5"></textarea>
      <div class="row"><button class="btn primary" data-action="addStu">Add students</button></div>`;
  }

  // ---------- Schedule ----------
  function renderSchedule() {
    const now = currentPeriod(T().periods);
    const bad = overlaps(T().periods);
    panel.innerHTML = `<div class="card">
      <h2>Schedule</h2>
      <p class="muted">Each period says when a class is with you. Hall Pass switches classes and turns passes on and off by itself.
        ${now ? `Right now: <b>${esc(now.name)}</b>.` : 'Nothing is scheduled right now.'}</p>
      ${T().periods.map(p => periodCard(p, bad.has(p.id))).join('') || '<p class="muted">No periods yet.</p>'}
      <div class="row"><button class="btn primary" data-action="addPeriod">Add period</button></div>
    </div>`;
  }
  function periodCard(p, overlap) {
    const id = p.id;
    const badTime = toMin(p.end) <= toMin(p.start);
    return `<div class="period ${overlap || badTime || !p.classId ? 'warn' : ''}">
      <div class="row">
        <label class="field">Name<input data-change="p" data-id="${id}" data-field="name" value="${esc(p.name)}"></label>
        <label class="field">Class<select data-change="p" data-id="${id}" data-field="classId">
          <option value="">Choose a class</option>
          ${T().classes.map(c => `<option value="${c.id}" ${c.id === p.classId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
        <label class="field">Starts<input type="time" data-change="p" data-id="${id}" data-field="start" value="${p.start}"></label>
        <label class="field">Ends<input type="time" data-change="p" data-id="${id}" data-field="end" value="${p.end}"></label>
      </div>
      <div class="row">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="chk"><input type="checkbox" data-change="pday" data-id="${id}" data-day="${d}" ${(p.days || []).includes(d) ? 'checked' : ''}>${DAY_NAMES[d]}</label>`).join('')}</div>
      <div class="row">
        <label class="field">No passes at the start<span class="unit"><input type="number" min="0" max="120" data-change="p" data-id="${id}" data-field="noPassFirst" value="${p.noPassFirst || 0}"> min</span></label>
        <label class="field">No passes at the end<span class="unit"><input type="number" min="0" max="120" data-change="p" data-id="${id}" data-field="noPassLast" value="${p.noPassLast || 0}"> min</span></label>
      </div>
      <div class="windows"><span class="muted">Other no-pass times:</span>
        ${(p.noPass || []).map((w, j) => `<span class="win">
          <input type="time" data-change="pwin" data-id="${id}" data-j="${j}" data-k="start" value="${w.start}">–<input type="time" data-change="pwin" data-id="${id}" data-j="${j}" data-k="end" value="${w.end}">
          <button class="btn sm ghost" data-action="delWin" data-id="${id}" data-j="${j}" title="Remove">✕</button></span>`).join('')}
        <button class="btn sm" data-action="addWin" data-id="${id}">+ Add a time</button>
      </div>
      <div class="row spread">
        <span class="${overlap || badTime || !p.classId ? 'danger-text' : 'muted'}">${
          !p.classId ? 'Pick a class for this period.' : badTime ? 'End time is before the start time.' :
          overlap ? 'Overlaps another period on the same day.' : ''}</span>
        <button class="btn sm ghost danger-text" data-action="delPeriod" data-id="${id}">Delete period</button>
      </div>
    </div>`;
  }

  // ---------- Log ----------
  async function loadLog() {
    logLoading = true;
    try {
      const snap = await getDocs(query(logCol(uid()), orderBy('out', 'desc'), limit(2000)));
      log = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { toast(e.message, true); log = []; }
    logLoading = false;
    if (tab === 'log') render(true);
  }
  const isOver = h => h.minutes != null
    ? h.minutes > (h.limitMin || T().settings.timeLimitMin || 8)
    : Date.now() - h.out > (h.limitMin || 8) * 60000;
  const logRows = () => (log || []).filter(h => (!logDay || h.date === logDay) && (!logClass || h.className === logClass));
  function renderLog() {
    if (!log) {
      panel.innerHTML = '<div class="card"><p class="muted">Loading the log…</p></div>';
      if (!logLoading) loadLog();
      return;
    }
    const days = [...new Set([dateKey(), ...log.map(h => h.date)])].sort().reverse();
    const classes = [...new Set(log.map(h => h.className).filter(Boolean))].sort();
    const rows = logRows();
    const done = rows.filter(h => h.minutes != null);
    const avg = done.length ? (done.reduce((a, h) => a + h.minutes, 0) / done.length).toFixed(1) : '–';
    const overRows = rows.filter(isOver);
    const counts = {};
    rows.forEach(h => (counts[h.name] = (counts[h.name] || 0) + 1));
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const dayLabel = d => d === dateKey() ? 'Today' : new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    panel.innerHTML = `<div class="card">
      <div class="row spread"><h2>Log</h2>
        <div class="row">
          <select data-change="logDay"><option value="">All days</option>${days.map(d => `<option value="${d}" ${d === logDay ? 'selected' : ''}>${dayLabel(d)}</option>`).join('')}</select>
          <select data-change="logClass"><option value="">All classes</option>${classes.map(c => `<option ${c === logClass ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <button class="btn" data-action="logRefresh">Refresh</button>
          <button class="btn" data-action="logCsv">Download CSV</button>
        </div>
      </div>
      <div class="stats">
        <div><b>${rows.length}</b><span class="muted">passes</span></div>
        <div><b>${avg}</b><span class="muted">avg minutes</span></div>
        <div class="${overRows.length ? 'danger-text' : ''}"><b>${overRows.length}</b><span class="muted">too long</span></div>
        ${top.length ? `<div><span class="muted">Most passes:</span><br>${top.map(([n, c]) => `${esc(n)} (${c})`).join(', ')}</div>` : ''}
      </div>
      ${overRows.length ? `<div class="flagbox"><b>Flagged:</b> ${overRows.map(h => `${esc(h.name)} (${h.minutes != null ? h.minutes + ' min' : 'still out'}${logDay ? '' : ', ' + esc(h.date)})`).join(', ')}</div>` : ''}
      ${rows.length ? `<div class="tblwrap"><table class="tbl"><thead><tr>${logDay ? '' : '<th>Date</th>'}<th>Name</th><th>Class</th><th>Left</th><th>Back</th><th>Minutes</th><th></th></tr></thead><tbody>
        ${rows.slice(0, 500).map(h => `<tr class="${isOver(h) ? 'over' : ''}">
          ${logDay ? '' : `<td>${esc(h.date)}</td>`}<td>${esc(h.name)}</td><td>${esc(h.className)}</td>
          <td>${fmtClock(h.out)}</td><td>${h.back ? fmtClock(h.back) : '<span class="muted">still out</span>'}</td>
          <td>${h.minutes ?? ''}</td>
          <td>${isOver(h) ? `<span class="pill bad">over ${h.limitMin || 8} min</span>` : ''}${h.by === 'teacher' ? ' <span class="pill">sent by you</span>' : ''}</td></tr>`).join('')}
      </tbody></table></div>` : `<p class="muted">No passes ${logDay === dateKey() ? 'yet today' : 'for this day'}.</p>`}
    </div>`;
  }
  function downloadCsv() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Date,Name,Class,Period,Left,Back,Minutes,Limit,Too long',
      ...logRows().map(h => [h.date, h.name, h.className, h.periodName, fmtClock(h.out), h.back ? fmtClock(h.back) : '',
        h.minutes ?? '', h.limitMin || '', isOver(h) ? 'YES' : ''].map(q).join(','))
    ].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `hall-pass-${logDay || 'all'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------- Settings ----------
  function renderSettings() {
    const s = T().settings;
    const chime = lsGet('hp-chime') !== 'off';
    panel.innerHTML = `<div class="card">
      <h2>Passes</h2>
      <div class="row">
        <label class="field">Time limit<span class="unit"><input type="number" min="1" max="60" data-change="timeLimit" value="${s.timeLimitMin || 8}"> min</span></label>
        <label class="field">Students out at once<span class="unit"><input type="number" min="1" max="5" data-change="maxOut" value="${s.maxOut || 1}"></span></label>
      </div>
      <p class="muted">A pass longer than the time limit turns red on every screen and is flagged in the Log.</p>
    </div>
    <div class="card">
      <h2>Your screen</h2>
      <div class="row">
        <label class="field">Lock the dashboard after<span class="unit"><input type="number" min="0" max="120" data-change="autoLock" value="${s.autoLockMin ?? 10}"> min idle</span></label>
      </div>
      <p class="muted">Locking only hides the dashboard. Hall Pass keeps running and the floating window stays up. 0 = never lock.</p>
      <label class="chk"><input type="checkbox" data-change="chime" ${chime ? 'checked' : ''}> Chime when a student is up</label>
      <h3>Teacher PIN</h3>
      <div class="row">
        <input class="pin" type="password" inputmode="numeric" maxlength="8" placeholder="New PIN" id="tp1">
        <input class="pin" type="password" inputmode="numeric" maxlength="8" placeholder="Again" id="tp2">
        <button class="btn" data-action="teacherPin">Change PIN</button>
      </div>
    </div>
    <div class="card">
      <h2>Room code</h2>
      <div class="row"><span class="code">${esc(s.roomCode)}</span>
        <button class="btn" data-action="copylink">Copy student link</button>
        <button class="btn ghost" data-action="rotate">New code</button></div>
      <p class="muted">Students need the code (or the link) once on each computer. If it gets shared outside class, make a new one.</p>
    </div>
    <div class="card">
      <h2>Backup</h2>
      <p class="muted">Your backup file opens your dashboard on another computer, or this one if its browser data gets cleared.
        It also keeps a copy of your classes and schedule. Keep it somewhere private, like your school OneDrive. Students
        who got hold of it could get into your dashboard.</p>
      ${savedKey() ? '' : '<p class="danger-text">This browser is missing your teacher key, so a backup from here won\'t work. Use a backup file you saved earlier.</p>'}
      <p class="muted small">${lsGet('hp-backup-at') ? 'Last downloaded ' + esc(new Date(lsGet('hp-backup-at')).toLocaleString()) : 'Not downloaded yet.'}</p>
      <div class="row">
        <button class="btn primary" data-action="backup">Download backup</button>
        <button class="btn ghost" data-action="signout">Remove Hall Pass from this computer</button>
      </div>
    </div>`;
  }

  // ---------- clicks ----------
  view.onclick = async e => {
    const top = e.target.closest('[data-top]')?.dataset.top;
    if (top === 'float') return ctx.openFloat();
    if (top === 'lock') return ctx.lock();
    const tb = e.target.closest('[data-tab]');
    if (tb) {
      tab = tb.dataset.tab; lsSet('hp-tab', tab);
      if (tab === 'log') log = null;
      return render(true);
    }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action, id = b.dataset.id;
    const rosterFind = sid => (current()?.cls.students || []).find(s => s.id === sid)
      || [...(room()?.line || []), ...(room()?.out || [])].find(s => s.id === sid);
    try {
      switch (a) {
        // live
        case 'go': { const s = rosterFind(id); if (s) await goOut(uid(), code(), { id: s.id, name: s.name }, { force: true }); break; }
        case 'back': await comeBack(uid(), code(), id); break;
        case 'skip': await leaveLine(code(), id); break;
        case 'pause': await save({ 'settings.paused': !T().settings.paused }, true); break;
        case 'mGo': { const s = rosterFind($('#manualPick').value); if (s) await goOut(uid(), code(), { id: s.id, name: s.name }, { force: true }); break; }
        case 'mLine': { const s = rosterFind($('#manualPick').value); if (s) { const n = await joinLine(code(), { id: s.id, name: s.name }); toast(`${s.name} is #${n} in line`); } break; }
        case 'rotate':
          if (confirm('Make a new room code? Students will need the new code or link.')) { await rotateRoomCode(uid(), T()); toast('New code ready'); }
          break;
        case 'copylink': await navigator.clipboard.writeText(studentLink()); toast('Student link copied'); break;
        // classes
        case 'selClass': selClass = id; render(true); break;
        case 'addClass': {
          const name = $('#newClass').value.trim();
          if (!name) return toast('Type a class name first', true);
          const c = { id: newId(), name, students: [] };
          T().classes.push(c); selClass = c.id;
          await saveClasses(); render(true); break;
        }
        case 'delClass': {
          const c = findClass(selClass);
          if (!c || !confirm(`Delete ${c.name} and its ${c.students.length} students?`)) return;
          T().classes = T().classes.filter(x => x.id !== c.id);
          T().periods.forEach(p => { if (p.classId === c.id) p.classId = ''; });
          const patch = { classes: T().classes, periods: T().periods };
          if (T().settings.override === c.id) patch['settings.override'] = '';
          await save(patch); render(true); break;
        }
        case 'addStu': {
          const c = findClass(selClass);
          const names = $('#addStu').value.split('\n').map(shortName).filter(Boolean);
          if (!names.length) return toast('Paste some names first', true);
          names.forEach(name => c.students.push({ id: newId(), name, pinHash: null }));
          await saveClasses(); render(true); toast(`Added ${names.length}`); break;
        }
        case 'setPin': {
          const box = view.querySelector(`[data-pin="${id}"]`);
          const pin = box.value.trim();
          if (!/^\d{4,8}$/.test(pin)) { toast('A PIN is 4 to 8 digits', true); box.focus(); return; }
          const c = findClass(selClass), s = findStu(id);
          const others = { ...c, students: c.students.filter(x => x.id !== id) };
          if (await matchStudentPin(uid(), others, pin)) { toast('Another student in this class has that PIN. Pick a different one.', true); box.select(); return; }
          if (await hashPin(uid(), 'teacher', pin) === T().settings.teacherPinHash) { toast("That's your teacher PIN. Pick a different one.", true); box.select(); return; }
          s.pinHash = await hashPin(uid(), id, pin);
          await save({ classes: T().classes }, true); render(true); toast(`PIN saved for ${s.name}`); break;
        }
        case 'delStu': {
          const c = findClass(selClass), s = findStu(id);
          if (!s || !confirm(`Remove ${s.name}?`)) return;
          c.students = c.students.filter(x => x.id !== id);
          await saveClasses(); render(true); break;
        }
        // schedule
        case 'addPeriod': {
          const P = T().periods, last = P[P.length - 1];
          const start = last ? minToHHMM(toMin(last.end) + 5) : '08:00';
          P.push({ id: newId(), name: `Period ${P.length + 1}`, classId: '', days: [1, 2, 3, 4, 5],
            start, end: minToHHMM(toMin(start) + 55), noPassFirst: 10, noPassLast: 10, noPass: [] });
          await savePeriods(); render(true); break;
        }
        case 'delPeriod': {
          const p = T().periods.find(x => x.id === id);
          if (!p || !confirm(`Delete ${p.name}?`)) return;
          T().periods = T().periods.filter(x => x.id !== id);
          await savePeriods(); render(true); break;
        }
        case 'addWin': {
          const p = T().periods.find(x => x.id === id);
          const mid = Math.round((toMin(p.start) + toMin(p.end)) / 2);
          (p.noPass ||= []).push({ start: minToHHMM(mid), end: minToHHMM(mid + 10) });
          await savePeriods(); render(true); break;
        }
        case 'delWin': {
          const p = T().periods.find(x => x.id === id);
          p.noPass.splice(Number(b.dataset.j), 1);
          await savePeriods(); render(true); break;
        }
        // log & settings
        case 'logRefresh': log = null; render(true); break;
        case 'logCsv': downloadCsv(); break;
        case 'teacherPin': {
          const p1 = $('#tp1').value.trim(), p2 = $('#tp2').value.trim();
          if (!/^\d{4,8}$/.test(p1)) return toast('Use 4 to 8 digits', true);
          if (p1 !== p2) return toast("Those didn't match", true);
          for (const c of T().classes) if (await matchStudentPin(uid(), c, p1)) return toast('A student already uses that PIN. Pick another.', true);
          await save({ 'settings.teacherPinHash': await hashPin(uid(), 'teacher', p1) }, true);
          toast('Teacher PIN changed'); render(true); break;
        }
        case 'backup': {
          const a2 = document.createElement('a');
          a2.href = URL.createObjectURL(new Blob([backupText(T())], { type: 'application/json' }));
          a2.download = `hall-pass-backup-${dateKey()}.json`;
          a2.click();
          setTimeout(() => URL.revokeObjectURL(a2.href), 1000);
          lsSet('hp-backup-at', new Date().toISOString());
          toast('Backup downloaded'); render(true); break;
        }
        case 'signout':
          if (confirm("Remove Hall Pass from this computer? Students' passes stop working until you open your backup file on a computer again.")) {
            lsSet('hp-teacher-key', null); await ctx.signOut();
          }
          break;
      }
    } catch (err) { toast(err.message, true); }
  };

  view.onkeydown = e => {
    if (e.key === 'Enter' && e.target.matches('[data-pin]')) {
      e.preventDefault();
      view.querySelector(`[data-action="setPin"][data-id="${e.target.dataset.pin}"]`)?.click();
    }
  };

  view.onchange = async e => {
    if (e.target.id === 'manualPick') manualPickId = e.target.value;
    const el = e.target, kind = el.dataset.change;
    if (!kind) return;
    const p = el.dataset.id ? T().periods.find(x => x.id === el.dataset.id) : null;
    switch (kind) {
      case 'override': await save({ 'settings.override': el.value }, true); el.blur(); break;
      case 'className': { const c = findClass(selClass); if (el.value.trim()) { c.name = el.value.trim(); await saveClasses(); } break; }
      case 'stuName': { const s = findStu(el.dataset.id); if (s && el.value.trim()) { s.name = el.value.trim(); await saveClasses(); } break; }
      case 'p': {
        const f = el.dataset.field;
        p[f] = f === 'noPassFirst' || f === 'noPassLast' ? Math.max(0, Number(el.value) || 0) : el.value;
        await savePeriods(); break;
      }
      case 'pday': {
        const d = Number(el.dataset.day);
        p.days = el.checked ? [...new Set([...(p.days || []), d])] : (p.days || []).filter(x => x !== d);
        await savePeriods(); break;
      }
      case 'pwin': p.noPass[Number(el.dataset.j)][el.dataset.k] = el.value; await savePeriods(); break;
      case 'logDay': logDay = el.value; render(true); break;
      case 'logClass': logClass = el.value; render(true); break;
      case 'maxOut': await save({ 'settings.maxOut': Math.min(5, Math.max(1, Number(el.value) || 1)) }); break;
      case 'timeLimit': await save({ 'settings.timeLimitMin': Math.min(60, Math.max(1, Number(el.value) || 8)) }); break;
      case 'autoLock': await save({ 'settings.autoLockMin': Math.min(120, Math.max(0, Number(el.value) || 0)) }); resetIdle(); break;
      case 'chime': lsSet('hp-chime', el.checked ? null : 'off'); break;
    }
  };

  render(true);
  let ticks = 0;
  return {
    update: () => { if (tab === 'live') render(); },
    tick: () => { if (tab === 'live' && ++ticks % 15 === 0) render(); }, // no-pass times start on the clock
    updateT: () => { render(); resetIdle(); },
    destroy: () => {
      clearTimeout(idleTimer);
      ['pointerdown', 'keydown', 'pointermove'].forEach(ev => document.removeEventListener(ev, activity));
    },
  };
}
