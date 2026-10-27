import { DT, PLAYER, BALL, KICK, DASH, TACKLE, PRACTICE_FORMATS } from './config.js';

// Difficulty profiles. Bots send the same inputs a human does; these only change how well they
// read the game: reaction time, accuracy, decisions, pressing, positioning and keeping.
export const BOT_LEVELS = {
  easy: {
    name: 'Rookie', think: 0.45, keeperReact: 0.5, keeperNoise: 40, speedMul: 0.8, eightDir: true,
    aimError: 0.3, shootRange: 420, charge: [0.15, 0.55], lobKeeper: false,
    passRate: 0.12, shortPass: 0, minHold: 0.6, pressure: 55, dribbleAvoid: 0.15,
    tackle: 0, dash: 0, pressers: 1, counterPress: 0, discipline: 0.35, support: 0,
    lineHeight: -0.05, mistake: 0.2,
  },
  intermediate: {
    name: 'Pro', think: 0.25, keeperReact: 0.3, keeperNoise: 20, speedMul: 0.9, eightDir: false,
    aimError: 0.15, shootRange: 520, charge: [0.4, 0.8], lobKeeper: false,
    passRate: 0.35, shortPass: 0.3, minHold: 0.4, pressure: 80, dribbleAvoid: 0.5,
    tackle: 0.12, dash: 0.15, pressers: 1, counterPress: 0, discipline: 0.6, support: 1,
    lineHeight: 0, mistake: 0.07,
  },
  hard: {
    name: 'Ace', think: 0.13, keeperReact: 0.16, keeperNoise: 8, speedMul: 1, eightDir: false,
    aimError: 0.07, shootRange: 600, charge: [0.6, 1], lobKeeper: true,
    passRate: 0.5, shortPass: 0.45, minHold: 0.3, pressure: 100, dribbleAvoid: 0.8,
    tackle: 0.3, dash: 0.35, pressers: 2, counterPress: 0, discipline: 0.82, support: 1,
    lineHeight: 0.03, mistake: 0.02,
  },
  // The strongest setting, playing tiki-taka: quick short passes in triangles, a high line and
  // an instant counter-press after losing the ball.
  barcelona: {
    name: 'Barça', think: 0.06, keeperReact: 0.07, keeperNoise: 3, speedMul: 1, eightDir: false,
    aimError: 0.025, shootRange: 560, charge: [0.75, 1], lobKeeper: true,
    passRate: 0.85, shortPass: 1, minHold: 0.15, pressure: 120, dribbleAvoid: 1,
    tackle: 0.38, dash: 0.45, pressers: 2, counterPress: 3, discipline: 0.95, support: 2,
    lineHeight: 0.1, mistake: 0,
  },
};
export const TEAMMATE_LEVEL = 'intermediate';

// Who plays where, by team size. Positioning and playstyle change with the number of players.
const ROLE_TEMPLATES = {
  1: ['solo'],
  2: ['sweeper', 'fwd'],
  3: ['gk', 'def', 'fwd'],
  4: ['gk', 'def', 'mid', 'fwd'],
  5: ['gk', 'def', 'def', 'mid', 'fwd'],
  6: ['gk', 'def', 'def', 'mid', 'mid', 'fwd'],
  7: ['gk', 'def', 'def', 'mid', 'mid', 'fwd', 'fwd'],
  8: ['gk', 'def', 'def', 'def', 'mid', 'mid', 'fwd', 'fwd'],
};
// depth: 0 = own goal line, 1 = opponent goal line. lat: -1..1 across the pitch.
const BASE_DEPTH = { gk: 0.03, sweeper: 0.13, def: 0.24, mid: 0.44, fwd: 0.64, solo: 0.3 };
const LATERALS = { 1: [0], 2: [-0.42, 0.42], 3: [-0.6, 0, 0.6], 4: [-0.66, -0.22, 0.22, 0.66] };
const BARCA_NAMES = {
  gk: ['Valdés'], sweeper: ['Valdés'], def: ['Piqué', 'Puyol', 'Alves', 'Abidal'],
  mid: ['Busquets', 'Xavi', 'Iniesta'], fwd: ['Messi', 'Villa', 'Pedro'], solo: ['Messi'],
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};
const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

function segDist(a, b, p) {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const l2 = ex * ex + ey * ey;
  const t = l2 ? clamp(((p.x - a.x) * ex + (p.y - a.y) * ey) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t));
}

// Slots (role, home position, kickoff spot) for one team.
function teamSlots(size) {
  const roles = ROLE_TEMPLATES[size];
  const counts = {};
  for (const r of roles) counts[r] = (counts[r] || 0) + 1;
  const used = {};
  return roles.map((role) => {
    const i = (used[role] = (used[role] || 0) + 1) - 1;
    const lat = LATERALS[counts[role]][i];
    const depth = BASE_DEPTH[role];
    return { role, depth, lat, spot: { fx: 1 - 2 * Math.min(depth, 0.42), fy: lat * 0.8 } };
  });
}

// Builds the players for a practice match: the human on team 0 (red) with bot teammates,
// against a full bot team. `level` is the opponents' difficulty. Without a humanId both
// teams are bots (used for bot-vs-bot testing).
export function buildPractice({ format, level, humanId = null, humanName = '', teammateLevel = TEAMMATE_LEVEL }) {
  const fmt = PRACTICE_FORMATS[format];
  const players = [];
  const bots = [];
  if (fmt.bots === false) {
    players.push({ id: humanId, name: humanName, team: 0 });
    return { mode: fmt.mode, players, bots };
  }
  let n = 0;
  for (const team of [0, 1]) {
    const levelKey = team === 0 ? teammateLevel : level;
    const lv = BOT_LEVELS[levelKey];
    const slots = teamSlots(fmt.size);
    if (team === 0 && humanId) {
      // The human takes an attacking slot; bots fill the rest.
      let hi = slots.findIndex((s) => s.role === 'fwd');
      if (hi < 0) hi = slots.length - 1;
      const [human] = slots.splice(hi, 1);
      players.push({ id: humanId, name: humanName, team, spot: fmt.size > 1 ? human.spot : undefined });
    }
    const taken = {};
    slots.forEach((slot, i) => {
      const id = `bot-${team}-${i}`;
      let name = `${lv.name} ${++n}`;
      if (levelKey === 'barcelona') {
        const list = BARCA_NAMES[slot.role];
        name = list[(taken[slot.role] = (taken[slot.role] || 0) + 1) - 1] || name;
      }
      players.push({ id, name, team, spot: slot.spot, speedMul: lv.speedMul, bot: true });
      bots.push({ id, team, role: slot.role, home: { depth: slot.depth, lat: slot.lat }, level: levelKey });
    });
  }
  return { mode: fmt.mode, players, bots };
}

// Drives every bot in one match. Call update() once per tick, before match.step().
export class BotSquad {
  constructor(match, bots, rng = Math.random) {
    this.match = match;
    this.rng = rng;
    this.time = 0;
    this.bots = bots.map((b) => new Bot(this, b));
    this.teams = [0, 1].map((team) => ({
      team, dir: team === 0 ? 1 : -1, phase: 'loose', lostAt: -99, chaserId: null, pressers: new Set(),
      level: BOT_LEVELS[bots.find((b) => b.team === team)?.level || TEAMMATE_LEVEL],
    }));
  }

  update() {
    this.time += DT;
    const ctx = this.analyze();
    for (const bot of this.bots) {
      if (!bot.player()) continue;
      if (this.time >= bot.nextThink) {
        bot.think(ctx);
        const interval = bot.role === 'gk' || bot.role === 'sweeper' ? bot.level.keeperReact : bot.level.think;
        bot.nextThink = this.time + interval * (0.85 + 0.3 * this.rng());
      }
      bot.act(ctx);
    }
  }

  // ---- shared picture of the game, rebuilt every tick ---------------------------------

  analyze() {
    const m = this.match;
    const b = m.ball;
    const owner = b.ownerId ? m.players.get(b.ownerId) : null;
    const players = [...m.players.values()];
    const ctx = { m, b, owner, players, hw: m.hw, hh: m.hh, gw2: m.gw2, teams: this.teams };
    for (const p of players) p._t = this.interceptTime(p, ctx);

    for (const tc of this.teams) {
      tc.members = players.filter((p) => p.team === tc.team);
      tc.opponents = players.filter((p) => p.team !== tc.team);
      const phase = owner ? (owner.team === tc.team ? 'attack' : 'defend') : 'loose';
      if (tc.phase === 'attack' && phase !== 'attack') tc.lostAt = this.time;
      tc.phase = phase;
      tc.bestT = Math.min(...tc.members.map((p) => p._t), 99);
      tc.chaserId = null;
      tc.pressers = new Set();
      const ballInBox = this.inOwnBox(tc, b, ctx);
      const ballDepth = this.depth(tc, b, ctx);
      // Keepers only join in near their own goal; they have their own rules for coming out.
      const eligible = tc.members
        .filter((p) => {
          const bot = this.botFor(p);
          if (!bot) return true; // humans count, so bots leave the ball to a closer human teammate
          if (bot.role === 'gk') return ballInBox;
          if (bot.role === 'sweeper') return ballDepth < 0.45;
          return true;
        })
        .sort((a, c) => a._t - c._t);
      if (phase === 'loose') {
        const first = eligible[0];
        if (first && this.botFor(first)) tc.chaserId = first.id;
      } else if (phase === 'defend') {
        let k = tc.level.pressers + (this.time - tc.lostAt < tc.level.counterPress ? 1 : 0);
        for (const p of eligible) {
          if (k <= 0) break;
          if (this.botFor(p)) tc.pressers.add(p.id);
          k--;
        }
      }
    }
    return ctx;
  }

  botFor(p) {
    return this.bots.find((bot) => bot.id === p.id) || null;
  }

  // Where the ball will be after t seconds (rough: friction only, kept on the pitch).
  ballAt(t, ctx) {
    const b = ctx.b;
    if (ctx.owner) {
      const s = Math.min(t, 0.5);
      return { x: b.x + ctx.owner.vx * s, y: b.y + ctx.owner.vy * s };
    }
    const k = BALL.groundFriction;
    const f = (1 - Math.exp(-k * t)) / k;
    return {
      x: clamp(b.x + b.vx * f, -ctx.hw + b.r, ctx.hw - b.r),
      y: clamp(b.y + b.vy * f, -ctx.hh + b.r, ctx.hh - b.r),
    };
  }

  // Seconds until this player could reach the ball.
  interceptTime(p, ctx) {
    if (p.state === 'stunned') return 99;
    const speed = PLAYER.maxSpeed * (p.speedMul || 1);
    for (let t = 0; t <= 3; t += 0.05) {
      const bp = this.ballAt(t, ctx);
      if (Math.hypot(bp.x - p.x, bp.y - p.y) - p.r - ctx.b.r <= speed * t + 2) return t;
    }
    return 3.5;
  }

  depth(tc, pt, ctx) {
    return (pt.x * tc.dir + ctx.hw) / (2 * ctx.hw);
  }

  fromDepth(tc, depth, lat, ctx) {
    return { x: tc.dir * (depth * 2 * ctx.hw - ctx.hw), y: lat * ctx.hh };
  }

  inOwnBox(tc, pt, ctx) {
    return this.depth(tc, pt, ctx) < 0.12 && Math.abs(pt.y) < ctx.gw2 + 0.3 * ctx.hh;
  }
}

class Bot {
  constructor(squad, { id, team, role, home, level }) {
    this.squad = squad;
    this.id = id;
    this.team = team;
    this.role = role;
    this.home = home;
    this.level = BOT_LEVELS[level];
    this.nextThink = 0;
    this.plan = { target: null, dir: null, aim: null, action: null };
    this.counters = { ps: 0, ds: 0, tk: 0 };
    this.lastSent = '';
    this.ballSince = null;
    this.noise = { x: 0, y: 0 };
  }

  player() {
    return this.squad.match.players.get(this.id);
  }

  rand() {
    return this.squad.rng();
  }

  // ---- decisions (run every `think` seconds) --------------------------------------------

  think(ctx) {
    const p = this.player();
    const tc = ctx.teams[this.team];
    const plan = this.plan;
    if (ctx.m.state !== 'playing') {
      this.plan = { target: null, dir: null, aim: null, action: null };
      return;
    }
    const hasBall = ctx.b.ownerId === p.id;
    if (hasBall && this.ballSince === null) this.ballSince = this.squad.time;
    if (!hasBall) this.ballSince = null;
    this.noise = { x: (this.rand() * 2 - 1) * this.level.keeperNoise, y: (this.rand() * 2 - 1) * this.level.keeperNoise };

    if (plan.action && plan.action.type === 'charge' && hasBall) {
      plan.dir = this.dribbleDir(ctx);
      plan.target = null;
      return;
    }
    plan.action = null;
    plan.target = null;
    plan.dir = null;

    if (this.rand() < this.level.mistake) {
      // An off moment: wander or look the wrong way.
      plan.target = { x: p.x + (this.rand() * 2 - 1) * 150, y: p.y + (this.rand() * 2 - 1) * 150 };
      plan.aim = norm(this.rand() * 2 - 1, this.rand() * 2 - 1);
      return;
    }
    if (hasBall) return this.onBall(ctx, tc);
    if (this.role === 'gk') return this.keeper(ctx, tc, false);
    if (this.role === 'sweeper') return this.keeper(ctx, tc, true);
    return this.outfield(ctx, tc);
  }

  outfield(ctx, tc) {
    const p = this.player();
    const b = ctx.b;
    this.plan.aim = norm(b.x - p.x, b.y - p.y);
    if (tc.phase === 'loose') {
      if (tc.chaserId === p.id) return this.chase(ctx);
      this.plan.target = this.formationTarget(ctx, tc, 'loose');
    } else if (tc.phase === 'defend') {
      if (tc.pressers.has(p.id) || this.role === 'solo') return this.press(ctx, tc);
      this.plan.target = this.defendTarget(ctx, tc);
    } else {
      this.plan.target = this.supportTarget(ctx, tc);
    }
  }

  chase(ctx) {
    const p = this.player();
    const t = Math.min(p._t, 2);
    this.plan.target = this.squad.ballAt(t, ctx);
    this.plan.aim = norm(ctx.b.x - p.x, ctx.b.y - p.y);
  }

  // Close down the ball carrier, getting goal-side first if we're caught upfield.
  press(ctx, tc) {
    const p = this.player();
    const b = ctx.b;
    const owner = ctx.owner;
    const lead = this.level.think < 0.2 ? 0.15 : 0;
    const ballPt = { x: b.x + (owner ? owner.vx * lead : 0), y: b.y + (owner ? owner.vy * lead : 0) };
    const myDepth = this.squad.depth(tc, p, ctx);
    const ballDepth = this.squad.depth(tc, b, ctx);
    if (owner && myDepth > ballDepth + 0.03 && this.level.discipline > 0.5) {
      const goal = { x: -tc.dir * ctx.hw, y: 0 };
      const back = norm(goal.x - owner.x, goal.y - owner.y);
      this.plan.target = { x: owner.x + back.x * 55, y: owner.y + back.y * 55 };
    } else {
      this.plan.target = ballPt;
    }
    this.plan.aim = norm(b.x - p.x, b.y - p.y);
    const d = dist(p, b);
    if (owner && d < 85 && d > 28 && p.stamina > TACKLE.cost + 5 && this.rand() < this.level.tackle) {
      this.plan.action = { type: 'tackle', dir: norm(ballPt.x - p.x, ballPt.y - p.y) };
    } else if (d > 120 && d < 320 && p.stamina > 60 && this.rand() < this.level.dash * 0.5) {
      this.plan.action = { type: 'dash' };
    }
  }

  // Home position, shifted with the ball and the phase of play.
  formationTarget(ctx, tc, phase) {
    const lv = this.level;
    const bd = this.squad.depth(tc, ctx.b, ctx);
    const bl = ctx.b.y / ctx.hh;
    let d = this.home.depth + lv.lineHeight;
    if (phase === 'attack') d += 0.35 * (bd - 0.5) + 0.06;
    else d += 0.3 * (bd - 0.5) - 0.04;
    if (this.role === 'def') d = Math.min(d, phase === 'attack' ? 0.58 : 0.45);
    if (this.role === 'fwd' && phase !== 'attack') d = Math.max(d, 0.42);
    d = clamp(d, 0.06, 0.9);
    const wide = phase === 'attack' ? 1 : 0.75;
    const lat = clamp(this.home.lat * wide + bl * (phase === 'attack' ? 0.15 : 0.3), -0.88, 0.88);
    return this.separate(ctx, tc, this.squad.fromDepth(tc, d, lat, ctx));
  }

  // Hold shape, mark the nearest attacker goal-side, and never get caught behind the ball.
  defendTarget(ctx, tc) {
    const p = this.player();
    let target = this.formationTarget(ctx, tc, 'defend');
    if ((this.role === 'def' || this.role === 'mid') && this.level.discipline >= 0.5) {
      const goal = { x: -tc.dir * ctx.hw, y: 0 };
      let mark = null;
      for (const o of tc.opponents) {
        if (o === ctx.owner) continue;
        const d = dist(o, target);
        if (d < 260 && (!mark || d < dist(mark, target))) mark = o;
      }
      if (mark) {
        const back = norm(goal.x - mark.x, goal.y - mark.y);
        const markPt = { x: mark.x + back.x * 45, y: mark.y + back.y * 45 };
        target = { x: lerp(target.x, markPt.x, 0.6 * this.level.discipline), y: lerp(target.y, markPt.y, 0.6 * this.level.discipline) };
      }
    }
    const bd = this.squad.depth(tc, ctx.b, ctx);
    if (this.role === 'def' && bd < 0.5) {
      const td = this.squad.depth(tc, target, ctx);
      if (td > bd - 0.02) target = this.squad.fromDepth(tc, Math.max(0.05, bd - 0.02), target.y / ctx.hh, ctx);
    }
    this.plan.aim = norm(ctx.b.x - p.x, ctx.b.y - p.y);
    return target;
  }

  // Off the ball while a teammate has it: find open space with a clear passing lane.
  supportTarget(ctx, tc) {
    const p = this.player();
    const lv = this.level;
    const carrier = ctx.owner;
    let base = this.formationTarget(ctx, tc, 'attack');
    const carrierDepth = this.squad.depth(tc, carrier, ctx);
    if (this.role === 'fwd' && lv.support > 0) {
      const d = clamp(Math.max(this.home.depth + 0.12, carrierDepth + 0.22), 0.4, 0.86);
      base = this.squad.fromDepth(tc, d, base.y / ctx.hh, ctx);
    }
    if (lv.support === 0) return base;

    const candidates = [base];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      candidates.push({ x: base.x + Math.cos(a) * 110, y: base.y + Math.sin(a) * 110 });
    }
    if (lv.support >= 2 && dist(p, carrier) < 520) {
      // Tiki-taka: offer a short option at an angle to the carrier, forming triangles.
      for (let deg = -120; deg <= 120; deg += 30) {
        const a = (deg * Math.PI) / 180;
        const fx = Math.cos(a) * tc.dir;
        const fy = Math.sin(a);
        candidates.push({ x: carrier.x + fx * 200, y: carrier.y + fy * 200 });
      }
    }
    let best = base;
    let bestScore = -Infinity;
    for (const c of candidates) {
      if (Math.abs(c.x) > ctx.hw - 30 || Math.abs(c.y) > ctx.hh - 30) continue;
      const open = Math.min(250, ...tc.opponents.map((o) => dist(o, c)));
      const lane = Math.min(999, ...tc.opponents.map((o) => segDist(carrier, c, o) - o.r));
      const teammateGap = Math.min(250, ...tc.members.filter((q) => q !== p).map((q) => dist(q, c)));
      let score = open + (lane > 30 ? 120 : -80) - dist(c, base) * 0.35 * lv.discipline + Math.min(teammateGap, 150) * 0.5;
      score += (this.squad.depth(tc, c, ctx) - carrierDepth) * 120;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  // Keep teammates from bunching up on the same spot.
  separate(ctx, tc, target) {
    const p = this.player();
    let { x, y } = target;
    for (const q of tc.members) {
      if (q === p) continue;
      const d = Math.hypot(x - q.x, y - q.y);
      if (d < 70 && d > 0.01) {
        x += ((x - q.x) / d) * (70 - d) * 0.5;
        y += ((y - q.y) / d) * (70 - d) * 0.5;
      }
    }
    return { x: clamp(x, -ctx.hw + 25, ctx.hw - 25), y: clamp(y, -ctx.hh + 25, ctx.hh - 25) };
  }

  // Goalkeeper (or, in a team of two, a sweeper-keeper who comes much further out).
  keeper(ctx, tc, sweeper) {
    const p = this.player();
    const b = ctx.b;
    const lv = this.level;
    const goal = { x: -tc.dir * ctx.hw, y: 0 };
    this.plan.aim = norm(b.x - p.x, b.y - p.y);

    // A shot coming in: get across to where it will cross the line.
    if (!ctx.owner && -tc.dir * b.vx > 150) {
      const t = (goal.x - b.x) / b.vx;
      if (t > 0 && t < 1.6) {
        const yc = b.y + b.vy * t;
        if (Math.abs(yc) < ctx.gw2 + 50) {
          this.plan.target = { x: goal.x + tc.dir * (p.r + 3), y: clamp(yc, -ctx.gw2 + 8, ctx.gw2 - 8) };
          if (dist(p, this.plan.target) > 60 && p.stamina > DASH.cost && this.rand() < lv.dash + 0.2) {
            this.plan.action = { type: 'dash' };
          }
          return;
        }
      }
    }

    const ballDepth = this.squad.depth(tc, b, ctx);
    const opponentT = ctx.teams[1 - this.team].bestT;
    // Claim a loose ball in the box (a sweeper covers the whole defensive half).
    if (!ctx.owner && (this.squad.inOwnBox(tc, b, ctx) || (sweeper && ballDepth < 0.45))) {
      if (p._t <= tc.bestT + 0.01 && p._t < opponentT * 1.15) return this.chase(ctx);
    }
    // Rush an attacker who is bearing down on goal.
    if (ctx.owner && ctx.owner.team !== this.team && dist(ctx.owner, goal) < (sweeper ? 330 : 170)) {
      return this.press(ctx, tc);
    }

    const dg = dist(b, goal);
    let D = sweeper ? clamp(40 + dg * 0.18, 40, 230) : clamp(22 + dg * 0.06, 22, 75);
    if (sweeper && tc.phase === 'attack') D = clamp(dg * 0.3, 60, 0.3 * 2 * ctx.hw);
    const toBall = norm(b.x - goal.x, b.y - goal.y);
    let target = { x: goal.x + toBall.x * D + this.noise.x, y: goal.y + toBall.y * D + this.noise.y };
    if (!sweeper) target.y = clamp(target.y, -ctx.gw2 + 6, ctx.gw2 - 6);
    if ((target.x - goal.x) * tc.dir < p.r + 2) target.x = goal.x + tc.dir * (p.r + 2);
    this.plan.target = target;
  }

  // ---- on the ball ----------------------------------------------------------------

  onBall(ctx, tc) {
    const p = this.player();
    const lv = this.level;
    const goal = { x: tc.dir * ctx.hw, y: 0 };
    const dG = dist(p, goal);
    const pressure = Math.min(999, ...tc.opponents.filter((o) => o.state !== 'stunned').map((o) => dist(o, p)));
    const held = this.squad.time - (this.ballSince ?? this.squad.time);

    if (this.role === 'gk') return this.clearBall(ctx, tc, pressure);

    const shot = this.evalShot(ctx, tc, p, goal, dG);
    const pass = this.bestPass(ctx, tc, p);
    const dribbleValue = 0.25 + (pressure > lv.pressure ? 0.2 : -0.2);

    if (shot && (shot.quality > 0.55 || dG < 260)) return this.startShot(ctx, tc, shot.target, dG, 'shot');
    const lob = lv.lobKeeper && this.lobChance(ctx, tc, p, goal, dG);
    if (lob) return this.startShot(ctx, tc, goal, dG, 'lob');
    const wantsPass = pressure < lv.pressure || this.rand() < lv.passRate || (pass && pass.score > dribbleValue + 0.4);
    if (pass && held >= lv.minHold && wantsPass && (this.role === 'sweeper' || pass.score > dribbleValue - (pressure < lv.pressure ? 0.5 : 0))) {
      return this.startPass(pass.to);
    }
    if (shot && this.rand() < 0.3 * (1 - lv.passRate)) return this.startShot(ctx, tc, shot.target, dG, 'shot');

    this.plan.dir = this.dribbleDir(ctx);
    if (pressure < 70 && p.stamina > 55 && this.rand() < lv.dash) this.plan.action = { type: 'dash' };
  }

  evalShot(ctx, tc, p, goal, dG) {
    const lv = this.level;
    if (dG > lv.shootRange) return null;
    const keeper = tc.opponents.reduce((k, o) => (!k || dist(o, goal) < dist(k, goal) ? o : k), null);
    let best = null;
    for (const f of [-0.68, -0.3, 0.3, 0.68]) {
      const target = { x: goal.x, y: f * ctx.gw2 };
      const lane = Math.min(999, ...tc.opponents.map((o) => segDist(p, target, o) - o.r));
      const kGap = keeper ? segDist(p, target, keeper) : 200;
      let q = clamp(1 - dG / lv.shootRange, 0, 1) * 0.6 + (lane > ctx.b.r + 4 ? 0.25 : -1) + clamp(kGap / 120, 0, 1) * 0.35;
      if (Math.abs(p.y) > ctx.gw2 && this.squad.depth(tc, p, ctx) > 0.92) q -= 0.3;
      if (!best || q > best.quality) best = { target, quality: q };
    }
    return best && best.quality > 0 ? best : null;
  }

  // Lob when the keeper has come off their line.
  lobChance(ctx, tc, p, goal, dG) {
    if (dG < 250 || dG > 750) return false;
    const keeper = tc.opponents.reduce((k, o) => (!k || dist(o, goal) < dist(k, goal) ? o : k), null);
    return !!keeper && dist(keeper, goal) > 140 && dist(keeper, p) < dG;
  }

  startShot(ctx, tc, target, dG, kind) {
    const p = this.player();
    const lv = this.level;
    let charge;
    if (kind === 'lob') {
      // Pick the charge whose first bounce lands just short of the goal.
      charge = 0.5;
      let bestErr = Infinity;
      for (let c = 0; c <= 1; c += 0.05) {
        const power = lerp(KICK.minPower, KICK.maxPower, c) * KICK.lobPowerMul;
        const air = (2 * lerp(KICK.lobLiftMin, KICK.lobLiftMax, c)) / BALL.gravity;
        const err = Math.abs(power * air - (dG - 80));
        if (err < bestErr) {
          bestErr = err;
          charge = c;
        }
      }
    } else {
      charge = clamp(Math.max(lerp(lv.charge[0], lv.charge[1], this.rand()), dG / 1100), lv.charge[0], lv.charge[1]);
    }
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const a = base + (this.rand() + this.rand() - 1) * lv.aimError;
    this.plan.action = {
      type: 'charge', kind, aim: { x: Math.cos(a), y: Math.sin(a) },
      start: this.squad.time, release: this.squad.time + charge * KICK.chargeTime, started: false,
    };
    this.plan.dir = this.dribbleDir(ctx);
  }

  bestPass(ctx, tc, p) {
    const lv = this.level;
    let best = null;
    const myDepth = this.squad.depth(tc, p, ctx);
    for (const t of tc.members) {
      if (t === p || t.state === 'stunned') continue;
      const d = dist(p, t);
      if (d < 90 || d > 1100) continue;
      const lane = Math.min(999, ...tc.opponents.map((o) => segDist(p, t, o) - o.r));
      if (lane < 18 + d * 0.03) continue;
      const space = Math.min(300, ...tc.opponents.map((o) => dist(o, t)));
      const prog = this.squad.depth(tc, t, ctx) - myDepth;
      const tb = this.squad.botFor(t);
      let score = prog * 1.6 + (space / 300) * 0.8 - (d / 1100) * lv.shortPass * 0.8;
      if (!tb) score += 0.15; // a human teammate wants the ball too
      if (tb && tb.role === 'gk') score -= 0.6;
      if (space < 50) score -= 0.5;
      if (!best || score > best.score) best = { to: t, score, space };
    }
    return best;
  }

  startPass(to) {
    const p = this.player();
    const err = (this.rand() * 2 - 1) * this.level.aimError * 0.4;
    const a = Math.atan2(to.y - p.y, to.x - p.x) + err;
    this.plan.action = { type: 'pass', aim: { x: Math.cos(a), y: Math.sin(a) }, deadline: this.squad.time + 0.35 };
    this.plan.dir = null;
  }

  // Keeper with the ball: find a safe pass, otherwise launch it upfield.
  clearBall(ctx, tc, pressure) {
    const p = this.player();
    const pass = this.bestPass(ctx, tc, p);
    if (pass && pass.space > 110 && (pressure > 90 || this.level.shortPass > 0.5)) return this.startPass(pass.to);
    const lat = (this.rand() * 2 - 1) * 0.5;
    const aim = norm(tc.dir, lat);
    this.plan.action = {
      type: 'charge', kind: 'lob', aim, start: this.squad.time,
      release: this.squad.time + lerp(0.6, 0.9, this.rand()) * KICK.chargeTime, started: false,
    };
    this.plan.dir = aim;
  }

  // Head for goal, swerving away from defenders and the touchlines.
  dribbleDir(ctx) {
    const p = this.player();
    const tc = ctx.teams[this.team];
    const goalPt = { x: tc.dir * (ctx.hw - 60), y: clamp(p.y * 0.5, -ctx.gw2, ctx.gw2) };
    const g = norm(goalPt.x - p.x, goalPt.y - p.y);
    let ax = 0;
    let ay = 0;
    for (const o of tc.opponents) {
      const d = dist(o, p);
      if (d > 170 || d < 1) continue;
      const ahead = ((o.x - p.x) * g.x + (o.y - p.y) * g.y) / d;
      if (ahead < -0.2) continue;
      const w = (170 - d) / 170;
      ax += ((p.x - o.x) / d) * w;
      ay += ((p.y - o.y) / d) * w;
    }
    let x = g.x + ax * this.level.dribbleAvoid * 1.6;
    let y = g.y + ay * this.level.dribbleAvoid * 1.6;
    if (Math.abs(p.y) > ctx.hh - 70) y -= Math.sign(p.y) * 0.8;
    return norm(x, y);
  }

  // ---- every tick: turn the plan into an input message ----------------------------------

  act(ctx) {
    const p = this.player();
    const m = ctx.m;
    const plan = this.plan;
    const msg = { mx: 0, my: 0, ax: 0, ay: 0, sh: false, lb: false, ...this.counters };

    if (m.state === 'playing') {
      let dir = plan.dir;
      if (plan.target) {
        const dx = plan.target.x - p.x;
        const dy = plan.target.y - p.y;
        const d = Math.hypot(dx, dy);
        dir = d > 10 ? { x: dx / d, y: dy / d } : null;
      }
      if (dir) {
        msg.mx = dir.x;
        msg.my = dir.y;
        if (this.level.eightDir) {
          msg.mx = Math.abs(dir.x) > 0.38 ? Math.sign(dir.x) : 0;
          msg.my = Math.abs(dir.y) > 0.38 ? Math.sign(dir.y) : 0;
        }
      }
      const a = plan.action;
      const aim = (a && a.aim) || (ctx.b.ownerId === p.id && dir) || plan.aim;
      if (aim) {
        msg.ax = aim.x;
        msg.ay = aim.y;
      }
      if (a) this.runAction(ctx, p, a, msg);
    } else {
      plan.action = null;
    }

    const key = JSON.stringify(msg);
    if (key !== this.lastSent) {
      this.lastSent = key;
      m.handleInput(this.id, msg);
    }
  }

  runAction(ctx, p, a, msg) {
    const now = this.squad.time;
    const aimed = Math.abs(angleDiff(p.aimAngle, Math.atan2(a.aim ? a.aim.y : 0, a.aim ? a.aim.x : 1))) < 0.12;
    if (a.type === 'charge') {
      const key = a.kind === 'lob' ? 'lb' : 'sh';
      if (ctx.b.ownerId !== p.id && now - a.start > 0.1) {
        this.plan.action = null; // lost it mid-charge: let go
      } else if (!a.started || now < a.release || !aimed) {
        msg[key] = true;
        a.started = true;
      } else {
        this.plan.action = null; // release: sh/lb back to false fires the kick
      }
    } else if (a.type === 'pass') {
      if (aimed || now > a.deadline) {
        msg.ps = ++this.counters.ps;
        this.plan.action = null;
      }
    } else if (a.type === 'tackle') {
      msg.mx = a.dir.x;
      msg.my = a.dir.y;
      msg.tk = ++this.counters.tk;
      this.plan.action = null;
    } else if (a.type === 'dash') {
      msg.ds = ++this.counters.ds;
      this.plan.action = null;
    }
  }
}
