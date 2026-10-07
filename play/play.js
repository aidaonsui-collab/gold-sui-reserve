/* The Gold Reserve: playable Mine-tab demo.
   Everything here is simulated in the browser: no wallet, no chain, no real tokens.
   Rules follow docs/SCOPE.md §8 (v0.3, stake-to-build + redeemable vault). */
(() => {
'use strict';

// ---------- constants ----------
const N = 16, CELLS = N * N;
const HOUR = 3600000, DAY = 24 * HOUR;          // a round is 24 game-hours
const ROUND_REAL_MS = 4 * 60000;                // ...compressed to 4 real minutes at 1×
const BASE = { mine: 120, shaft: 280 };
const ESCALATION = 0.25;                        // +25% stake per extra building of a kind
const CAP = { mine: 24, shaft: 6 };
const SURVEY_FEE = 40, MOVE_FEE = 20;           // $RESERVE fees into the prize pool (never burned)
const SURVEY_R = 2, SHAFT_R = 2;
const MOVE_COOLDOWN = 30 * 60000;               // 30 game-minutes
const SUI_PER_RESERVE = 0.02;                   // demo conversion for fees → SUI pot
const SUI_PER_XAUM = 1300, USD_PER_XAUM = 4159; // demo prices
const REDEEM_FEE = 0.015, EPOCH_CAP = 0.03, TX_CAP = 0.01;
const POT_BASE = 160;                           // fee-funded pot seed at round open (simulated)
const KEY = 'goldReserveDemo.v1';
const START_RESERVE = 1240;
const BOTS = [
  { id: 'b1', name: '0x3f…a1', color: '#7fb3ff', mines: [5, 9], shafts: [1, 2], skill: 0.85 },
  { id: 'b2', name: '0x9c…7e', color: '#ff8a7a', mines: [4, 7], shafts: [0, 1], skill: 0.7 },
  { id: 'b3', name: '0xb2…04', color: '#9be38a', mines: [3, 6], shafts: [1, 2], skill: 0.6 },
  { id: 'b4', name: '0x51…dd', color: '#d79bff', mines: [6, 10], shafts: [0, 1], skill: 0.5 },
  { id: 'b5', name: '0xe8…3c', color: '#7fe0d8', mines: [2, 5], shafts: [0, 1], skill: 0.75 },
];
const BOT = Object.fromEntries(BOTS.map(b => [b.id, b]));
const ME = 'you';

// ---------- deterministic hashing ----------
function h32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
function mulberry(a) {
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const u01 = (s) => h32(s) / 4294967296;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const idx = (x, y) => y * N + x;
const xy = (i) => [i % N, Math.floor(i / N)];

// richness(x,y) = f(hash(seed,x,y)) shaped into veins so rich cells cluster
function genRichness(seed) {
  const rnd = mulberry(h32(seed + ':veins'));
  const L = 5, lat = Array.from({ length: L * L }, () => rnd());
  const sm = t => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const gx = x / (N - 1) * (L - 1), gy = y / (N - 1) * (L - 1);
    const x0 = Math.min(L - 2, Math.floor(gx)), y0 = Math.min(L - 2, Math.floor(gy));
    const tx = sm(gx - x0), ty = sm(gy - y0);
    const a = lat[y0 * L + x0], b = lat[y0 * L + x0 + 1], c = lat[(y0 + 1) * L + x0], d = lat[(y0 + 1) * L + x0 + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
  const veins = [];
  const nv = 2 + Math.floor(rnd() * 2);
  for (let v = 0; v < nv; v++) {
    const side = Math.floor(rnd() * 4);
    let px, py;
    if (side === 0) { px = -0.5; py = rnd() * N; } else if (side === 1) { px = N - 0.5; py = rnd() * N; }
    else if (side === 2) { px = rnd() * N; py = -0.5; } else { px = rnd() * N; py = N - 0.5; }
    let ang = Math.atan2(N / 2 - py + (rnd() - 0.5) * 8, N / 2 - px + (rnd() - 0.5) * 8);
    const pts = [], amp = 0.8 + rnd() * 0.2;
    for (let s = 0; s < 40; s++) {
      pts.push([px, py]);
      ang += (rnd() - 0.5) * 0.75;
      px += Math.cos(ang) * 0.7; py += Math.sin(ang) * 0.7;
      if (px < -1.5 || py < -1.5 || px > N + 0.5 || py > N + 0.5) break;
    }
    veins.push({ pts, amp, w: 0.9 + rnd() * 0.6 });
  }
  const pockets = Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => ({ x: 2 + rnd() * (N - 4), y: 2 + rnd() * (N - 4), amp: 0.6 + rnd() * 0.3, w: 1.1 + rnd() * 0.8 }));
  const out = new Array(CELLS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let best = 0;
    for (const v of veins) {
      let d2 = 1e9;
      for (const [qx, qy] of v.pts) { const dx = qx - x, dy = qy - y; const dd = dx * dx + dy * dy; if (dd < d2) d2 = dd; }
      best = Math.max(best, v.amp * Math.exp(-d2 / (2 * v.w * v.w)));
    }
    for (const p of pockets) { const dx = p.x - x, dy = p.y - y; best = Math.max(best, p.amp * Math.exp(-(dx * dx + dy * dy) / (2 * p.w * p.w))); }
    const jitter = u01(seed + ':' + x + ':' + y);
    out[idx(x, y)] = Math.max(0, 0.68 * best + 0.26 * noise(x, y) + 0.16 * jitter - 0.06);
  }
  const mx = Math.max(...out) || 1; // stretch so every round has a true motherlode, then darken the background
  return out.map(r => Math.round(clamp(Math.pow(r / mx, 1.35) * 99, 0, 100)));
}
// What you see without a survey: a blurred, noisy, banded estimate
function genEstimate(seed, R) {
  const out = new Array(CELLS);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let s = 0, w = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      const ww = (dx || dy) ? 1 : 1.5; s += R[idx(X, Y)] * ww; w += ww;
    }
    const n = (u01(seed + ':fog:' + x + ':' + y) - 0.5) * 40;
    out[idx(x, y)] = clamp(Math.round((s / w + n) / 5) * 5, 0, 100);
  }
  return out;
}

// ---------- state ----------
let S, R = [], EST = [];
function newSeed(i) { return '0x' + (h32('round' + i + ':' + Date.now() + ':' + Math.random()).toString(16).padStart(8, '0')) + (h32('b' + i + Math.random()).toString(16).padStart(8, '0')); }
function freshState() {
  const st = {
    v: 1, speed: 1, paused: false, created: Date.now(),
    bal: { reserve: START_RESERVE, sui: 0, xaum: 0, claimable: 0 },
    settled: [], past: [], hist: [], nextId: 1,
    vault: { xaum: 3.25, circ: 2400000, epochBase: 3.25, epochOut: 0, hist: [] },
    round: null, rollover: 0, selected: null, moving: null,
  };
  S = st;
  openRound(1);
  log('Demo started with 1,240 RESERVE (simulated).');
  S.vault.hist.push(backing());
  return st;
}
function openRound(i) {
  const seed = newSeed(i);
  const rnd = mulberry(h32(seed + ':bots'));
  const plans = [];
  for (const b of BOTS) {
    const nm = b.mines[0] + Math.floor(rnd() * (b.mines[1] - b.mines[0] + 1));
    const ns = b.shafts[0] + Math.floor(rnd() * (b.shafts[1] - b.shafts[0] + 1));
    for (let k = 0; k < nm; k++) plans.push({ bot: b.id, kind: 'mine', t: Math.pow(rnd(), 1.5) * DAY * 0.92 + (k === 0 ? 0 : 0) });
    for (let k = 0; k < ns; k++) plans.push({ bot: b.id, kind: 'shaft', t: (0.15 + rnd() * 0.7) * DAY });
  }
  // make sure a couple of rivals show up right away
  plans.slice(0, 2).forEach((p, j) => { p.t = (0.2 + j * 0.3) * HOUR; });
  plans.sort((a, b) => a.t - b.t);
  S.round = { idx: i, seed, t: 0, feed: [], pot: POT_BASE + (S.rollover || 0), potFees: 0, buildings: [], surveyed: {}, plans, rateK: 3 + rnd() * 3, phase: rnd() * 6 };
  S.rollover = 0;
  S.vault.epochBase = S.vault.xaum; S.vault.epochOut = 0;
  S.selected = null; S.moving = null;
  rebuildMaps();
}
function rebuildMaps() { R = genRichness(S.round.seed); EST = genEstimate(S.round.seed, R); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore quota */ } }
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const st = JSON.parse(raw); if (st && st.v === 1 && st.round) { S = st; S.moving = null; rebuildMaps(); return; } }
  } catch (e) { /* fall through */ }
  freshState();
}

// ---------- helpers ----------
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtX = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function feed(text) { const f = S.round.feed || (S.round.feed = []); f.unshift({ t: S.round.t, text }); if (f.length > 30) f.length = 30; }
function log(text) { S.hist.unshift({ at: Date.now(), r: S.round ? S.round.idx : 0, text }); if (S.hist.length > 200) S.hist.length = 200; }
function nameOf(o) { return o === ME ? 'You' : (BOT[o] ? BOT[o].name : o); }
function gameClock(ms) { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(v => String(v).padStart(2, '0')).join(':'); }
function at(i) { return S.round.buildings.find(b => b.cell === i); }
function mine(owner) { return S.round.buildings.filter(b => b.owner === owner); }
function countKind(owner, kind) { return S.round.buildings.filter(b => b.owner === owner && b.kind === kind).length; }
function stakeFor(owner, kind) { return Math.round(BASE[kind] * (1 + ESCALATION * countKind(owner, kind))); }
function stakedLive(owner) { return mine(owner).reduce((s, b) => s + b.stake, 0); }
function settledTotal() { return S.settled.reduce((s, b) => s + b.stake, 0); }
function isSurveyed(i) { return !!S.round.surveyed[i]; }
function backing() { return S.vault.xaum / S.vault.circ; }

// ---------- scoring (SCOPE §8.2) ----------
// mine score = richness × vein adjacency × overcrowding × shaft boost × time factor
function scoreMine(b, bs, rich, tNow) {
  const [x, y] = xy(b.cell);
  const grid = new Map(bs.map(o => [o.cell, o]));
  let adj = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
    const o = grid.get(idx(X, Y)); if (o && o.kind === 'mine' && o.owner === b.owner) adj++;
  }
  let crowd = 0, shafts = 0;
  for (const o of bs) {
    const [ox, oy] = xy(o.cell); const d = Math.max(Math.abs(ox - x), Math.abs(oy - y));
    if (o.kind === 'mine' && d <= 1) crowd++;
    if (o.kind === 'shaft' && d <= SHAFT_R) shafts++;
  }
  const vein = 1 + Math.min(0.6, 0.2 * adj);
  const crowdM = Math.max(0.25, 1 - 0.15 * Math.max(0, crowd - 3));
  const shaftM = 1 + 0.25 * Math.min(3, shafts);
  const tf = clamp((DAY - b.placed) / DAY, 0, 1);
  const r = rich[b.cell];
  return { score: r * vein * crowdM * shaftM * tf, r, vein, crowdM, shaftM, tf, adj, crowd, shafts };
}
function scoreBoard(bs = S.round.buildings, rich = R) {
  const per = {}, byOwner = {};
  for (const b of bs) if (b.kind === 'mine') { const d = scoreMine(b, bs, rich); per[b.id] = d; byOwner[b.owner] = (byOwner[b.owner] || 0) + d.score; }
  const total = Object.values(byOwner).reduce((a, b) => a + b, 0);
  return { per, byOwner, total };
}
// Preview for the player using what they can see (exact if surveyed/placed, estimate otherwise)
function visibleRich() { const v = EST.slice(); for (const k in S.round.surveyed) v[k] = R[k]; for (const b of S.round.buildings) if (b.owner === ME) v[b.cell] = R[b.cell]; return v; }
function preview(kind, cell) {
  const vis = visibleRich();
  const before = scoreBoard(S.round.buildings, vis);
  const tmp = S.round.buildings.concat([{ id: -1, owner: ME, kind, cell, placed: S.round.t }]);
  const after = scoreBoard(tmp, vis);
  const meDelta = (after.byOwner[ME] || 0) - (before.byOwner[ME] || 0);
  let rivDelta = 0; for (const o in after.byOwner) if (o !== ME) rivDelta += after.byOwner[o] - (before.byOwner[o] || 0);
  return { meDelta, rivDelta, self: after.per[-1], exact: isSurveyed(cell) };
}

// ---------- actions ----------
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 2600); }
function addPotReserveFee(amount) { const sui = amount * SUI_PER_RESERVE; S.round.pot += sui; S.round.potFees += sui; return sui; }

function place(kind) {
  const cell = S.selected;
  if (cell == null) return toast('Tap a cell on the grid first.', true);
  if (S.round.t >= DAY) return toast('Round is closing.', true);
  if (at(cell)) return toast('That cell is taken. First placer owns it.', true);
  if (countKind(ME, kind) >= CAP[kind]) return toast(`Cap reached: ${CAP[kind]} ${kind}s per round.`, true);
  const need = stakeFor(ME, kind);
  // Rebuild: reuse a settled building of this kind if you have one (top up or refund the difference)
  const sIdx = S.settled.findIndex(b => b.kind === kind);
  const reuse = sIdx >= 0 ? S.settled[sIdx].stake : 0;
  const pay = need - reuse;
  if (pay > S.bal.reserve) return toast(`Not enough RESERVE: need ${fmt(pay)} more.`, true);
  if (sIdx >= 0) S.settled.splice(sIdx, 1);
  S.bal.reserve -= pay;
  const b = { id: S.nextId++, owner: ME, kind, cell, placed: S.round.t, lastMove: -1e12, stake: need, fresh: Date.now() };
  S.round.buildings.push(b);
  const [x, y] = xy(cell);
  if (reuse) log(`Rebuilt a ${kind} at (${x},${y}) with a settled ${fmt(reuse)} stake${pay > 0 ? `, topped up ${fmt(pay)}` : pay < 0 ? `, ${fmt(-pay)} refunded` : ''}. ${fmt(need)} RESERVE locked.`);
  else log(`Placed a ${kind === 'mine' ? 'Gold Mine' : 'Vault Shaft'} at (${x},${y}). ${fmt(need)} RESERVE locked (not burned).`);
  feed(`You placed a ${kind} at (${x},${y})`);
  toast(`${kind === 'mine' ? 'Mine' : 'Shaft'} placed · ${fmt(need)} RESERVE locked`);
  save(); render(true);
}
function survey() {
  const cell = S.selected;
  if (cell == null) return toast('Tap a cell to survey around it.', true);
  if (S.bal.reserve < SURVEY_FEE) return toast('Not enough RESERVE for a survey.', true);
  const [x, y] = xy(cell); let n = 0;
  for (let dy = -SURVEY_R; dy <= SURVEY_R; dy++) for (let dx = -SURVEY_R; dx <= SURVEY_R; dx++) {
    const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
    if (!S.round.surveyed[idx(X, Y)]) n++; S.round.surveyed[idx(X, Y)] = 1;
  }
  if (!n) return toast('This area is already surveyed.', true);
  S.bal.reserve -= SURVEY_FEE;
  const sui = addPotReserveFee(SURVEY_FEE);
  log(`Surveyed around (${x},${y}): ${n} cells revealed. Fee ${SURVEY_FEE} RESERVE → +${fmt(sui, 2)} SUI to the prize pool.`);
  feed(`You surveyed around (${x},${y})`);
  toast(`Survey done · ${n} cells revealed`);
  save(); render(true);
}
function startMove() {
  const b = at(S.selected); if (!b || b.owner !== ME) return;
  if (S.round.t - b.lastMove < MOVE_COOLDOWN) return toast('This building is on move cooldown.', true);
  if (S.bal.reserve < MOVE_FEE) return toast(`Moving costs a ${MOVE_FEE} RESERVE fee.`, true);
  S.moving = b.id; toast('Tap an empty cell to move it there.'); render(true);
}
function finishMove(cell) {
  const b = S.round.buildings.find(o => o.id === S.moving); S.moving = null;
  if (!b) return render(true);
  if (at(cell)) { toast('Pick an empty cell.', true); return render(true); }
  const [x0, y0] = xy(b.cell), [x, y] = xy(cell);
  S.bal.reserve -= MOVE_FEE; const sui = addPotReserveFee(MOVE_FEE);
  b.cell = cell; b.placed = S.round.t; b.lastMove = S.round.t; b.fresh = Date.now();
  S.selected = cell;
  log(`Moved a ${b.kind} (${x0},${y0}) → (${x},${y}). Fee ${MOVE_FEE} RESERVE → +${fmt(sui, 2)} SUI to the pool. Its clock restarted.`);
  feed(`You moved a ${b.kind} to (${x},${y})`);
  toast('Moved · time factor restarted');
  save(); render(true);
}
function demolishAll() {
  if (!S.settled.length) return toast('Nothing settled to demolish.', true);
  const amt = settledTotal(), n = S.settled.length;
  S.bal.reserve += amt; S.settled = [];
  log(`Demolished ${n} settled building${n > 1 ? 's' : ''}: ${fmt(amt)} RESERVE stake returned in full.`);
  toast(`${fmt(amt)} RESERVE returned to your wallet`);
  save(); render(true);
}
function claim() {
  if (S.bal.claimable <= 0) return toast('Nothing to claim yet.', true);
  const a = S.bal.claimable; S.bal.sui += a; S.bal.claimable = 0;
  log(`Claimed ${fmt(a, 2)} SUI of round rewards.`); toast(`Claimed ${fmt(a, 2)} SUI`);
  save(); render(true);
}
function redeemQuote(x) {
  const v = S.vault; const gross = v.xaum * x / v.circ; const fee = gross * REDEEM_FEE; const out = gross - fee;
  const after = (v.xaum - out) / (v.circ - x);
  const dayLeft = Math.max(0, v.epochBase * EPOCH_CAP - v.epochOut), txCap = v.xaum * TX_CAP;
  return { gross, fee, out, after, dayLeft, txCap };
}
function redeem() {
  const x = Math.floor(Number($('rAmt').value));
  if (!(x > 0)) return toast('Enter an amount of RESERVE.', true);
  if (x > S.bal.reserve) return toast('More than your free RESERVE (staked tokens are locked).', true);
  const q = redeemQuote(x);
  if (q.out > q.txCap) return toast('Above the 1%-of-vault per-transaction cap.', true);
  if (q.out > q.dayLeft) return toast("Above today's remaining global cap.", true);
  const v = S.vault; const b0 = backing();
  S.bal.reserve -= x; v.circ -= x; v.xaum -= q.out; v.epochOut += q.out; S.bal.xaum += q.out;
  v.hist.push(backing());
  log(`Redeemed ${fmt(x)} RESERVE (burned) → ${fmtX(q.out)} XAUm. Fee ${fmtX(q.fee)} XAUm stayed in the vault; backing per token +${((backing() / b0 - 1) * 100).toFixed(4)}%.`);
  toast(`Received ${fmtX(q.out)} XAUm`);
  $('rAmt').value = '';
  save(); render(true);
}

// ---------- bots ----------
function botAct(p) {
  const bot = BOT[p.bot];
  if (countKind(p.bot, p.kind) >= CAP[p.kind]) return;
  const own = S.round.buildings.filter(b => b.owner === p.bot && b.kind === 'mine');
  const rnd = mulberry(h32(S.round.seed + p.bot + p.t));
  let best = -1, bestV = -1e9;
  for (let i = 0; i < CELLS; i++) {
    if (at(i)) continue;
    const [x, y] = xy(i);
    let v;
    if (p.kind === 'mine') {
      v = EST[i] * bot.skill + R[i] * (1 - bot.skill) * 0.6 + (rnd() - 0.5) * 30;
      let ownAdj = 0, crowd = 0;
      for (const b of S.round.buildings) {
        const [bx, by] = xy(b.cell); const d = Math.max(Math.abs(bx - x), Math.abs(by - y));
        if (b.kind === 'mine' && d <= 1) crowd++;
        if (b.owner === p.bot && b.kind === 'mine' && Math.abs(bx - x) + Math.abs(by - y) === 1) ownAdj++;
      }
      v += ownAdj * 14 - Math.max(0, crowd - 2) * 12;
    } else {
      v = (rnd() - 0.5) * 6;
      for (const b of own) { const [bx, by] = xy(b.cell); if (Math.max(Math.abs(bx - x), Math.abs(by - y)) <= SHAFT_R) v += 10 + R[b.cell] * 0.2; }
      v -= EST[i] * 0.15; // keep rich cells for mines
    }
    if (v > bestV) { bestV = v; best = i; }
  }
  if (best < 0) return;
  S.round.buildings.push({ id: S.nextId++, owner: p.bot, kind: p.kind, cell: best, placed: S.round.t, lastMove: -1e12, stake: stakeFor(p.bot, p.kind), fresh: Date.now() });
  const [bx, by] = xy(best); feed(`${bot.name} placed a ${p.kind} at (${bx},${by})`);
}

// ---------- time ----------
function potRate(t) { return S.round.rateK * (1 + 0.45 * Math.sin(t / HOUR / 2.7 + S.round.phase)); } // SUI per game-hour into the pot
function advance(gdt) {
  const r = S.round;
  while (gdt > 0 && r.t < DAY) {
    const step = Math.min(gdt, 10 * 60000, DAY - r.t);
    const add = potRate(r.t) * step / HOUR;
    r.pot += add;                                    // 20% rewards slice of simulated fees
    S.vault.xaum += add * (75 / 20) / SUI_PER_XAUM;  // 75% reserve slice → XAUm in the vault
    const before = Math.floor(r.t / (3 * HOUR));
    r.t += step; gdt -= step;
    if (Math.floor(r.t / (3 * HOUR)) !== before) { S.vault.hist.push(backing()); if (S.vault.hist.length > 80) S.vault.hist.shift(); }
    while (r.plans.length && r.plans[0].t <= r.t) botAct(r.plans.shift());
  }
  if (r.t >= DAY) closeRound();
}
function closeRound() {
  const r = S.round;
  const sb = scoreBoard();
  const owners = new Set(r.buildings.map(b => b.owner));
  const rows = [...owners].map(o => ({ owner: o, score: sb.byOwner[o] || 0 })).sort((a, b) => b.score - a.score);
  let paid = 0;
  for (const row of rows) { row.payout = sb.total > 0 ? Math.floor(r.pot * row.score / sb.total * 100) / 100 : 0; paid += row.payout; }
  const dust = sb.total > 0 ? r.pot - paid : r.pot;
  const meRow = rows.find(x => x.owner === ME);
  const myStake = stakedLive(ME);
  const myN = mine(ME).length;
  if (meRow && meRow.payout > 0) S.bal.claimable += meRow.payout;
  // your buildings become settled (stake still locked, withdrawable via demolish or reusable via rebuild)
  for (const b of mine(ME)) S.settled.push({ id: b.id, kind: b.kind, stake: b.stake, round: r.idx });
  const rec = { idx: r.idx, pot: r.pot, total: sb.total, rows: rows.slice(0, 8).map(x => ({ owner: x.owner, score: x.score, payout: x.payout })), you: meRow ? { score: meRow.score, payout: meRow.payout, rank: rows.indexOf(meRow) + 1 } : null, players: rows.length, dust };
  S.past.unshift(rec); if (S.past.length > 30) S.past.length = 30;
  log(meRow ? `Round ${r.idx} closed: your score ${fmt(meRow.score)} (#${rec.you.rank} of ${rows.length}) earned ${fmt(meRow.payout, 2)} SUI. ${myN} building${myN === 1 ? '' : 's'} settled (${fmt(myStake)} RESERVE ready to demolish).` : `Round ${r.idx} closed. Pot ${fmt(r.pot, 2)} SUI split among ${rows.length} rival miners. You didn't play this round.`);
  S.rollover = dust;
  openRound(r.idx + 1);
  log(`Round ${S.round.idx} opened with a new public seed ${S.round.seed}.`);
  save();
  showResults(rec, myStake, myN);
}

// ---------- rendering ----------
const STOPS = [[0, [15, 10, 4]], [20, [36, 25, 8]], [38, [74, 52, 12]], [52, [136, 94, 17]], [65, [204, 148, 30]], [80, [246, 200, 78]], [100, [255, 246, 204]]];
function heat(v) {
  for (let k = 1; k < STOPS.length; k++) if (v <= STOPS[k][0]) {
    const [a, ca] = STOPS[k - 1], [b, cb] = STOPS[k]; const t = (v - a) / (b - a);
    return `rgb(${ca.map((c, j) => Math.round(c + (cb[j] - c) * t)).join(',')})`;
  }
  return 'rgb(255,243,190)';
}
let cellEls = [], sigCache = [];
function buildGrid() {
  const g = $('grid'); g.innerHTML = '';
  cellEls = []; sigCache = [];
  for (let i = 0; i < CELLS; i++) { const d = document.createElement('div'); d.className = 'c'; d.dataset.i = i; g.appendChild(d); cellEls.push(d); sigCache.push(''); }
}
function renderGrid() {
  const sel = S.selected, selB = sel != null ? at(sel) : null;
  const radius = new Set();
  const shaftCenter = selB && selB.kind === 'shaft' ? selB.cell : null;
  if (shaftCenter != null) { const [sx, sy] = xy(shaftCenter); for (let i = 0; i < CELLS; i++) { const [x, y] = xy(i); if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= SHAFT_R) radius.add(i); } }
  const now = Date.now();
  for (let i = 0; i < CELLS; i++) {
    const surv = isSurveyed(i);
    const b = at(i);
    const known = surv || (b && b.owner === ME);
    const v = known ? R[i] : EST[i];
    const fresh = b && b.fresh && now - b.fresh < 600;
    const sig = [v, known ? 1 : 0, i === sel ? 1 : 0, b ? b.kind + b.owner : '', radius.has(i) ? 1 : 0, S.moving && !b ? 1 : 0, fresh ? 1 : 0].join('|');
    if (sig === sigCache[i]) continue;
    sigCache[i] = sig;
    const el = cellEls[i];
    let cls = 'c';
    if (!known) cls += ' fog'; else if (surv) cls += ' surv';
    if (v >= 62) cls += ' glow';
    if (i === sel) cls += ' sel';
    if (radius.has(i)) cls += ' rad';
    if (S.moving && !b) cls += ' mvt';
    if (b) cls += b.owner === ME ? ' b-own' : ' b-bot';
    if (fresh) cls += ' new';
    el.className = cls;
    el.style.setProperty('--h', heat(v));
    if (v >= 62) el.style.setProperty('--ga', ((v - 62) / 38 * 0.8 + 0.15).toFixed(2));
    if (b && b.owner !== ME) el.style.setProperty('--bc', BOT[b.owner].color);
    el.innerHTML = b ? `<svg viewBox="0 0 32 32"><use href="#i-${b.kind}"/></svg>` : '';
    el.setAttribute('aria-label', `cell ${i % N},${Math.floor(i / N)}`);
  }
  // vein links between orthogonally adjacent mines of the same owner, plus shaft radius ring
  let svg = '';
  const bs = S.round.buildings.filter(b => b.kind === 'mine');
  const m = new Map(bs.map(b => [b.cell, b]));
  for (const b of bs) {
    const [x, y] = xy(b.cell);
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const o = m.get(idx(x + dx, y + dy)); if (!o || x + dx >= N || o.owner !== b.owner) continue;
      svg += b.owner === ME ? `<line class="own" x1="${x + .5}" y1="${y + .5}" x2="${x + dx + .5}" y2="${y + dy + .5}"/>` : `<line class="bot" stroke="${BOT[b.owner].color}" x1="${x + .5}" y1="${y + .5}" x2="${x + dx + .5}" y2="${y + dy + .5}"/>`;
    }
  }
  if (shaftCenter != null) { const [sx, sy] = xy(shaftCenter); svg += `<rect class="ring" x="${Math.max(0, sx - 2) + .05}" y="${Math.max(0, sy - 2) + .05}" width="${Math.min(N, sx + 3) - Math.max(0, sx - 2) - .1}" height="${Math.min(N, sy + 3) - Math.max(0, sy - 2) - .1}" rx=".2"/>`; }
  const vs = $('veins'); if (vs._svg !== svg) { vs.innerHTML = svg; vs._svg = svg; }
}
function renderTip(sb) {
  const tip = $('tip'); const sel = S.selected;
  if (sel == null) { tip.hidden = true; return; }
  const [x, y] = xy(sel); const b = at(sel);
  const known = isSurveyed(sel) || (b && b.owner === ME);
  let l1 = known ? `Richness ${R[sel]}` : `Richness ~${EST[sel]} <small>est.</small>`, l2 = '';
  if (b && b.kind === 'mine') { const d = sb.per[b.id]; const bits = []; if (d.adj) bits.push(`+${Math.round((d.vein - 1) * 100)}% vein`); if (d.shafts) bits.push(`+${Math.round((d.shaftM - 1) * 100)}% shaft`); if (d.crowdM < 1) bits.push(`−${Math.round((1 - d.crowdM) * 100)}% crowd`); l2 = bits.join(' · ') || `${nameOf(b.owner)}'s mine`; }
  else if (b) l2 = `${nameOf(b.owner)}'s shaft`;
  else { const p = preview('mine', sel); const d = p.self; const bits = []; if (d.adj) bits.push(`+${Math.round((d.vein - 1) * 100)}% vein`); if (d.shafts) bits.push(`+${Math.round((d.shaftM - 1) * 100)}% shaft`); if (d.crowdM < 1) bits.push(`−${Math.round((1 - d.crowdM) * 100)}% crowd`); l2 = bits.join(' · ') || 'empty cell'; }
  tip.innerHTML = `<b>${l1}</b><span>${l2}</span>`;
  tip.hidden = false;
  const bw = $('board').clientWidth, tw = tip.offsetWidth;
  tip.style.left = clamp((x + 0.5) / N * bw, tw / 2 + 3, bw - tw / 2 - 3) + 'px';
  if (y < 2) { tip.classList.add('below'); tip.style.top = ((y + 1) / N * 100) + '%'; } else { tip.classList.remove('below'); tip.style.top = (y / N * 100) + '%'; }
}
function renderCellInfo(sb) {
  const el = $('cellInfo'); const sel = S.selected;
  let html;
  if (S.moving) { html = '<b>Moving</b>: tap an empty cell. Fee ' + MOVE_FEE + ' RESERVE into the prize pool, and the building\'s time factor restarts. <div class="row"><button type="button" data-a="cancelmove">Cancel</button></div>'; }
  else if (sel == null) html = 'Tap a cell to inspect it, then choose <b>Mine</b>, <b>Shaft</b> or <b>Survey</b>. Bright cells are richer. Striped cells are estimates until you survey.';
  else {
    const [x, y] = xy(sel); const b = at(sel);
    const known = isSurveyed(sel) || (b && b.owner === ME);
    const rtxt = known ? `richness <b>${R[sel]}</b>` : `estimated richness <b>${Math.max(0, EST[sel] - 15)}–${Math.min(100, EST[sel] + 15)}</b> (survey for exact)`;
    if (!b) {
      const pm = preview('mine', sel), ps = preview('shaft', sel);
      const sign = v => (v >= 0 ? '+' : '−') + fmt(Math.abs(v));
      html = `Cell (${x},${y}) · ${rtxt}<br>Mine here: <b>${pm.exact ? '' : '≈'}${sign(pm.meDelta)}</b> to your score (time factor ${(pm.self.tf * 100).toFixed(0)}%)` +
        `<br>Shaft here: your score <b>${sign(ps.meDelta)}</b>, rivals <b>${sign(ps.rivDelta)}</b>`;
    } else if (b.owner === ME) {
      const cd = Math.max(0, MOVE_COOLDOWN - (S.round.t - b.lastMove));
      const d = b.kind === 'mine' ? sb.per[b.id] : null;
      html = `Your ${b.kind === 'mine' ? 'Gold Mine' : 'Vault Shaft'} at (${x},${y}) · ${rtxt} · stake <b>${fmt(b.stake)}</b> locked` +
        (d ? `<br>Score <b>${fmt(d.score)}</b> = ${d.r} × ${d.vein.toFixed(2)} vein × ${d.crowdM.toFixed(2)} crowd × ${d.shaftM.toFixed(2)} shaft × ${d.tf.toFixed(2)} time` : `<br>Boosts every mine within 2 cells by +25% (rivals' too).`) +
        `<div class="row"><button type="button" data-a="move" ${cd > 0 ? 'disabled' : ''}>Move (${MOVE_FEE} fee)${cd > 0 ? ' · cooldown ' + gameClock(cd).slice(3) : ''}</button><button type="button" disabled title="Stakes unlock after the round closes">Demolish (after round)</button></div>`;
    } else {
      const d = b.kind === 'mine' ? sb.per[b.id] : null;
      html = `<span class="dot" style="background:${BOT[b.owner].color}"></span>${esc(nameOf(b.owner))}'s ${b.kind} at (${x},${y}) · ${rtxt}` + (d ? ` · score <b>${fmt(d.score)}</b>` : '') + '<br><span class="dim">First placer owns the cell. You can crowd it or boost it, not take it.</span>';
    }
  }
  if (el._h !== html) { el.innerHTML = html; el._h = html; }
}
function renderTop(sb) {
  const r = S.round;
  $('balTop').textContent = fmt(S.bal.reserve);
  $('roundNo').textContent = 'Round ' + r.idx;
  $('roundClock').textContent = gameClock(DAY - r.t);
  $('potTop').textContent = fmt(r.pot, 1) + ' SUI';
  $('potRate').textContent = S.paused ? '· paused' : `· +${potRate(r.t).toFixed(1)}/h from fees`;
  const my = sb.byOwner[ME] || 0;
  $('stScore').textContent = fmt(my);
  $('stShare').textContent = (sb.total > 0 ? (my / sb.total * 100) : 0).toFixed(1) + '%';
  $('stStaked').textContent = fmt(stakedLive(ME));
  const cm = stakeFor(ME, 'mine'), cs = stakeFor(ME, 'shaft');
  $('costMine').textContent = fmt(cm); $('costShaft').textContent = fmt(cs);
  const sel = S.selected, empty = sel != null && !at(sel) && !S.moving;
  const reuse = k => (S.settled.find(b => b.kind === k) || { stake: 0 }).stake;
  $('actMine').disabled = !(empty && countKind(ME, 'mine') < CAP.mine && cm - reuse('mine') <= S.bal.reserve);
  $('actShaft').disabled = !(empty && countKind(ME, 'shaft') < CAP.shaft && cs - reuse('shaft') <= S.bal.reserve);
  $('actSurvey').disabled = !(sel != null && !S.moving && S.bal.reserve >= SURVEY_FEE);
  $('actMine').classList.toggle('ready', !$('actMine').disabled);
  for (const btn of document.querySelectorAll('.speed [data-speed]')) btn.classList.toggle('on', Number(btn.dataset.speed) === S.speed && !S.paused);
  $('pauseBtn').textContent = S.paused ? '▶' : '❚❚'; $('pauseBtn').classList.toggle('on', S.paused);
  const st = settledTotal();
  const sbar = $('settledBar');
  const h = S.settled.length ? `<div class="settled card"><span>${S.settled.length} settled building${S.settled.length > 1 ? 's' : ''} · <b>${fmt(st)}</b> RESERVE ready. Place again to rebuild with it.</span><button type="button" data-a="demolish">Demolish · get ${fmt(st)} back</button></div>` : '';
  if (sbar._h !== h) { sbar.innerHTML = h; sbar._h = h; }
  const fh = (S.round.feed || []).slice(0, 5).map(e => `<li><time>${gameClock(e.t).slice(0, 5)}</time>${esc(e.text)}</li>`).join('') || '<li class="dim">Quiet so far. Rivals will start placing soon.</li>';
  const fe = $('feed'); if (fe && fe._h !== fh) { fe.innerHTML = fh; fe._h = fh; }
  $('vaultBarVal').textContent = `${fmtX(backing() * 1000)} XAUm / 1k`;
}
function spark(el, data) {
  if (data.length < 2) data = [data[0] || 0, data[0] || 0];
  const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || hi * 0.01 || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1) * 300).toFixed(1)},${(64 - (v - lo) / span * 56).toFixed(1)}`).join(' ');
  el.innerHTML = `<polyline points="0,70 ${pts} 300,70" fill="rgba(240,194,74,.12)" stroke="none"/><polyline points="${pts}" fill="none" stroke="#f0c24a" stroke-width="2"/>`;
}
function renderVault() {
  const v = S.vault;
  $('vXaum').textContent = v.xaum.toFixed(4);
  $('vUsd').textContent = `≈ $${fmt(v.xaum * USD_PER_XAUM)} at a demo price of $${fmt(USD_PER_XAUM)}/XAUm`;
  $('vBacking').textContent = `${fmtX(backing() * 1000)} XAUm (≈ $${(backing() * 1000 * USD_PER_XAUM).toFixed(2)})`;
  $('vCirc').textContent = fmt(v.circ) + ' RESERVE';
  $('vYour').textContent = fmt(S.bal.reserve);
  const yq = redeemQuote(S.bal.reserve);
  $('vYourVal').textContent = `${fmtX(yq.out)} XAUm (≈ $${(yq.out * USD_PER_XAUM).toFixed(2)})`;
  $('vYourX').textContent = fmtX(S.bal.xaum);
  const x = Math.floor(Number($('rAmt').value)) || 0;
  const q = redeemQuote(x);
  const qh = x > 0 ? `<div><span>Burn</span><b>${fmt(x)} RESERVE</b></div><div><span>Gross share</span><b>${fmtX(q.gross)} XAUm</b></div><div><span>Fee 1.5% (stays in vault)</span><b>−${fmtX(q.fee)}</b></div><div><span>You receive</span><b class="good">${fmtX(q.out)} XAUm</b></div><div><span>Backing per token after</span><b>+${((q.after / backing() - 1) * 100).toFixed(4)}%</b></div>` : '<div class="dim">Enter an amount to see a quote.</div>';
  if ($('rQuote')._h !== qh) { $('rQuote').innerHTML = qh; $('rQuote')._h = qh; }
  $('rBtn').disabled = !(x > 0 && x <= S.bal.reserve);
  const cap = v.epochBase * EPOCH_CAP;
  $('capDay').textContent = `${fmtX(Math.max(0, cap - v.epochOut))} of ${fmtX(cap)} XAUm left`;
  $('capBar').style.width = clamp(v.epochOut / cap * 100, 0, 100) + '%';
  $('capTx').textContent = `${fmtX(v.xaum * TX_CAP)} XAUm max`;
  const key = v.hist.length + ':' + v.hist[v.hist.length - 1];
  if ($('vSpark')._k !== key) { spark($('vSpark'), v.hist.concat([backing()]).map(b => b * 1000)); $('vSpark')._k = key; }
}
function renderBoard(sb) {
  const r = S.round;
  const owners = new Set(r.buildings.map(b => b.owner)); owners.add(ME);
  const rows = [...owners].map(o => ({ o, s: sb.byOwner[o] || 0, m: countKind(o, 'mine'), sh: countKind(o, 'shaft') })).sort((a, b) => b.s - a.s);
  $('lbTitle').textContent = `Round ${r.idx} · live (projected at close) · pool ${fmt(r.pot, 1)} SUI`;
  const h = rows.map((x, k) => `<tr class="${x.o === ME ? 'you' : ''}"><td>${k + 1}</td><td><span class="dot" style="background:${x.o === ME ? '#ffd35a' : BOT[x.o].color}"></span>${esc(nameOf(x.o))}</td><td>${x.m}</td><td>${x.sh}</td><td>${fmt(x.s)}</td><td>${sb.total ? (x.s / sb.total * 100).toFixed(1) : '0.0'}%</td><td>${sb.total ? fmt(r.pot * x.s / sb.total, 2) : '0.00'} SUI</td></tr>`).join('');
  if ($('lbBody')._h !== h) { $('lbBody').innerHTML = h; $('lbBody')._h = h; }
  const ph = S.past.length ? S.past.map(p => `<div class="pr"><span><b>Round ${p.idx}</b> · pool ${fmt(p.pot, 2)} SUI · ${p.players} miners</span><span>Top: ${p.rows.slice(0, 3).map(x => esc(nameOf(x.owner)) + ' ' + fmt(x.payout, 2)).join(', ') || 'nobody (rolled over)'}</span><span>${p.you ? `You: #${p.you.rank} · score ${fmt(p.you.score)} · <b>${fmt(p.you.payout, 2)} SUI</b>` : '<span class="dim">You sat out</span>'}</span></div>`).join('') : '<div class="dim">No rounds closed yet. Use <b>End round ⏭</b> on the Mine tab to fast-forward.</div>';
  if ($('pastList')._h !== ph) { $('pastList').innerHTML = ph; $('pastList')._h = ph; }
}
function renderWallet() {
  $('wRes').textContent = fmt(S.bal.reserve) + ' RESERVE';
  $('wStaked').textContent = fmt(stakedLive(ME)) + ' RESERVE';
  $('wSettled').textContent = fmt(settledTotal()) + ' RESERVE';
  $('wDemolish').disabled = !S.settled.length;
  $('wClaim').textContent = fmt(S.bal.claimable, 2) + ' SUI';
  $('wClaimBtn').disabled = S.bal.claimable <= 0;
  $('wSui').textContent = fmt(S.bal.sui, 2) + ' SUI';
  $('wX').textContent = fmtX(S.bal.xaum) + ' XAUm';
  const h = S.hist.slice(0, 80).map(e => `<li><time>${new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><span>${esc(e.text)}</span></li>`).join('');
  if ($('histList')._h !== h) { $('histList').innerHTML = h; $('histList')._h = h; }
}
let currentTab = 'mine';
function render() {
  const sb = scoreBoard();
  renderTop(sb);
  if (currentTab === 'mine') { renderGrid(); renderTip(sb); renderCellInfo(sb); }
  else if (currentTab === 'vault') renderVault();
  else if (currentTab === 'board') renderBoard(sb);
  else renderWallet();
}
function showResults(rec, myStake, myN) {
  const m = $('modal'), box = $('mbox');
  const you = rec.you;
  box.innerHTML = `<h2>Round ${rec.idx} closed</h2>` +
    (you ? `<div class="dim">You earned</div><div class="big">${fmt(you.payout, 2)} SUI</div>
      <div class="mrow"><div>Score<b>${fmt(you.score)}</b></div><div>Rank<b>#${you.rank} / ${rec.players}</b></div><div>Pool<b>${fmt(rec.pot, 1)}</b></div></div>
      <p class="dim small">Your ${myN} building${myN === 1 ? ' is' : 's are'} settled. The ${fmt(myStake)} RESERVE stake is still yours: demolish to get it back, or place again this round to rebuild with it.</p>`
      : `<p>The ${fmt(rec.pot, 1)} SUI pool went to ${rec.players} rival miner${rec.players === 1 ? '' : 's'}. Place a mine this round to compete.</p>`) +
    `<div class="btns">${myN ? `<button class="primary" data-m="demolish" type="button">Demolish · get ${fmt(myStake)} RESERVE back</button><button class="ghost" data-m="keep" type="button">Keep stake to rebuild in round ${rec.idx + 1}</button>` : ''}${you && you.payout > 0 ? `<button class="ghost" data-m="claim" type="button">Claim ${fmt(S.bal.claimable, 2)} SUI</button>` : ''}<button class="ghost" data-m="close" type="button">Continue</button></div>`;
  m.hidden = false;
}

// ---------- wiring ----------
function setTab(t) {
  currentTab = t;
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('active', s.dataset.tab === t);
  for (const b of document.querySelectorAll('.bottom button')) b.classList.toggle('on', b.dataset.go === t);
  sigCache = sigCache.map(() => ''); $('veins')._svg = null;
  render(); window.scrollTo(0, 0);
}
function init() {
  load();
  buildGrid();
  $('grid').addEventListener('click', e => {
    const c = e.target.closest('.c'); if (!c) return;
    const i = Number(c.dataset.i);
    if (S.moving) return finishMove(i);
    S.selected = S.selected === i ? null : i; render();
  });
  $('actMine').addEventListener('click', () => place('mine'));
  $('actShaft').addEventListener('click', () => place('shaft'));
  $('actSurvey').addEventListener('click', survey);
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-a]'); if (a) {
      if (a.dataset.a === 'move') startMove();
      else if (a.dataset.a === 'cancelmove') { S.moving = null; render(); }
      else if (a.dataset.a === 'demolish') demolishAll();
    }
    const mb = e.target.closest('[data-m]'); if (mb) {
      $('modal').hidden = true;
      if (mb.dataset.m === 'demolish') demolishAll();
      else if (mb.dataset.m === 'claim') claim();
      else if (mb.dataset.m === 'keep') toast('Stake kept. Place a building to rebuild with it.');
    }
  });
  $('modal').addEventListener('click', e => { if (e.target === $('modal')) $('modal').hidden = true; });
  for (const b of document.querySelectorAll('.bottom button')) b.addEventListener('click', () => setTab(b.dataset.go));
  $('vaultBar').addEventListener('click', () => setTab('vault'));
  for (const b of document.querySelectorAll('.speed [data-speed]')) b.addEventListener('click', () => { S.speed = Number(b.dataset.speed); S.paused = false; save(); render(); });
  $('pauseBtn').addEventListener('click', () => { S.paused = !S.paused; save(); render(); });
  $('skipBtn').addEventListener('click', () => advance(DAY - S.round.t + 1));
  $('wDemolish').addEventListener('click', demolishAll);
  $('wClaimBtn').addEventListener('click', claim);
  $('rMax').addEventListener('click', () => { $('rAmt').value = Math.floor(S.bal.reserve); render(); });
  $('rAmt').addEventListener('input', () => render());
  $('rBtn').addEventListener('click', redeem);
  $('resetBtn').addEventListener('click', () => { if (confirm('Reset the demo? Your simulated balances and history will be cleared.')) { localStorage.removeItem(KEY); freshState(); buildGrid(); $('modal').hidden = true; setTab('mine'); save(); toast('Demo reset'); } });
  addEventListener('keydown', e => { if (e.key === 'Escape') { S.moving = null; S.selected = null; $('modal').hidden = true; render(); } });
  let last = performance.now(), lastSave = 0;
  setInterval(() => {
    const now = performance.now(); const dt = Math.min(1000, now - last); last = now;
    if (!S.paused && $('modal').hidden) advance(dt * S.speed * DAY / ROUND_REAL_MS);
    render();
    if (now - lastSave > 1500) { save(); lastSave = now; }
  }, 200);
  render();
  // test hook for headless play-testing (read-only snapshot + fast-forward)
  window.__gold = { state: () => S, rich: () => R.slice(), est: () => EST.slice(), score: () => scoreBoard(), advance: ms => advance(ms), HOUR, DAY };
}
document.addEventListener('DOMContentLoaded', init);
})();
