// Pure helpers with no Firebase code. Shared by every part of the site.

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toMin(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minToHHMM(min) {
  min = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
}

// "13:05" -> "1:05"
export function fmt12(hhmm) {
  const t = toMin(hhmm);
  const h = Math.floor(t / 60) % 12 || 12;
  return `${h}:${String(t % 60).padStart(2, '0')}`;
}

// 754000 -> "12:34"
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtClock(ms) {
  const d = new Date(ms);
  return fmt12(`${d.getHours()}:${d.getMinutes()}`);
}

export function minutesNow(d = new Date()) {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "Maria Lopez" or "Lopez, Maria" -> "M. Lopez"  (only first initial + last name are kept)
export function shortName(line) {
  line = String(line || '').trim().replace(/\s+/g, ' ');
  if (!line) return '';
  let first, last;
  if (line.includes(',')) {
    const [l, f] = line.split(',').map(s => s.trim());
    first = (f || '').split(' ')[0];
    last = l;
  } else {
    const parts = line.split(' ');
    first = parts[0];
    last = parts.length > 1 ? parts[parts.length - 1] : '';
  }
  if (!first) { first = last; last = ''; }
  return last ? `${first[0].toUpperCase()}. ${last}` : first;
}

// Sort "M. Lopez" style names by last name, then initial.
export const byName = (a, b) => {
  const k = n => String(n.name || '').replace(/^\S+\s+/, '') + ' ' + String(n.name || '');
  return k(a).localeCompare(k(b));
};

// All no-pass windows for a period: first X minutes, last X minutes, plus custom times.
export function noPassWindows(period) {
  if (!period) return [];
  const w = [];
  const s = toMin(period.start), e = toMin(period.end);
  const first = Number(period.noPassFirst) || 0;
  const last = Number(period.noPassLast) || 0;
  if (first > 0) w.push({ start: period.start, end: minToHHMM(Math.min(e, s + first)) });
  if (last > 0) w.push({ start: minToHHMM(Math.max(s, e - last)), end: period.end });
  for (const x of period.noPass || []) {
    if (x && x.start && x.end && toMin(x.end) > toMin(x.start)) w.push({ start: x.start, end: x.end });
  }
  return w.sort((a, b) => toMin(a.start) - toMin(b.start));
}

export function currentPeriod(periods, d = new Date()) {
  const day = d.getDay(), t = minutesNow(d);
  return (periods || []).find(p =>
    (p.days || []).includes(day) && p.start && p.end && p.classId &&
    t >= toMin(p.start) && t < toMin(p.end)) || null;
}

// The class that's with the teacher right now: a manual pick wins, otherwise the schedule.
export function activeClass(T, d = new Date()) {
  const s = T?.settings || {}, classes = T?.classes || [];
  if (s.override) {
    const c = classes.find(c => c.id === s.override);
    if (c) return { cls: c, period: { id: 'manual-' + c.id, name: '', classId: c.id, start: '00:00', end: '23:59', manual: true } };
  }
  const p = currentPeriod(T?.periods || [], d);
  const c = p ? classes.find(c => c.id === p.classId) : null;
  return c ? { cls: c, period: p } : null;
}

// Pairs of periods that overlap on the same day (for a warning on the schedule page).
export function overlaps(periods) {
  const bad = new Set();
  const ps = periods || [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j];
    if (!(a.days || []).some(d => (b.days || []).includes(d))) continue;
    if (toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)) { bad.add(a.id); bad.add(b.id); }
  }
  return bad;
}

// Students out on an any-time pass don't count toward "students out at once".
export const regularOut = room => (room?.out || []).filter(o => !o.anytime);

// The room right now: open / up / full / nopass / paused / closed.
export function passStatus(room, d = new Date()) {
  if (!room || !room.period) return { state: 'closed', label: 'No class right now' };
  if (room.paused) return { state: 'paused', label: 'Passes are paused' };
  const t = minutesNow(d);
  const win = (room.period.windows || []).find(w => t >= toMin(w.start) && t < toMin(w.end));
  if (win) return { state: 'nopass', label: `No passes until ${fmt12(win.end)}` };
  const out = regularOut(room).length, max = room.maxOut || 1;
  if (out >= max) return { state: 'full', label: max === 1 ? 'Someone is out' : 'Passes are full' };
  const line = room.line || [];
  if (line.length) return { state: 'up', label: `${line[0].name}, you're up!` };
  return { state: 'open', label: 'Pass open' };
}

// Students in line whose turn it is right now (usually zero or one).
export function upList(room, d = new Date()) {
  const st = passStatus(room, d).state;
  if (st !== 'up') return [];
  const free = (room.maxOut || 1) - regularOut(room).length;
  return (room.line || []).slice(0, Math.max(0, free));
}

// What happens if this student tries to leave the room now.
export function decide(room, studentId, d = new Date()) {
  if ((room.out || []).some(o => o.id === studentId)) return { action: 'back' };
  const st = passStatus(room, d);
  if (st.state === 'closed') return { action: 'blocked', reason: st.label, canLine: false };
  if (st.state === 'paused' || st.state === 'nopass') return { action: 'blocked', reason: st.label, canLine: true };
  const line = room.line || [];
  const free = (room.maxOut || 1) - regularOut(room).length;
  const pos = line.findIndex(x => x.id === studentId);
  const myTurn = pos === -1 ? line.length < free : pos < free;
  if (myTurn) return { action: 'go' };
  if (free <= 0) return { action: 'line', reason: 'Someone is out right now' };
  return { action: 'line', reason: `${line[0].name} is ahead of you` };
}

// ---------- pass limits ----------
// Weeks start on Monday.
export function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

// The limits you've turned on, each with the first date it counts from.
export function limitWindows(settings, now = new Date()) {
  const L = settings?.limits || {};
  const w = [];
  if (L.day > 0) w.push({ key: 'day', label: 'today', short: 'today', max: +L.day, from: dateKey(now) });
  if (L.week > 0) w.push({ key: 'week', label: 'this week', short: 'wk', max: +L.week, from: dateKey(weekStart(now)) });
  if (L.month > 0) w.push({ key: 'month', label: 'this month', short: 'mo', max: +L.month, from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)) });
  if (L.semester > 0 && L.semesterStart && L.semesterStart <= dateKey(now)) {
    w.push({ key: 'semester', label: 'this semester', short: 'sem', max: +L.semester, from: L.semesterStart });
  }
  return w;
}

// How many passes a student has used in each window. Passes you marked "don't count" are skipped.
export function passUsage(entries, windows) {
  return windows.map(w => {
    const used = entries.filter(e => !e.excused && e.date >= w.from).length;
    return { key: w.key, label: w.label, short: w.short, max: w.max, used, left: Math.max(0, w.max - used) };
  });
}

// The limit a student has run out of, if any.
export const usedUp = usage => (usage || []).find(u => u.left <= 0) || null;

// The tightest limit (fewest passes left), for a compact "2/3 wk" label.
export const tightest = usage => (usage || []).slice().sort((a, b) => a.left - b.left)[0] || null;

export const usedUpMsg = u => `You've used all ${u.max} of your passes ${u.label}. Talk to your teacher if it's an emergency.`;
