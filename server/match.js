import {
  TICK_RATE, DT, SUBSTEPS, MODES, FORMATIONS, MATCH, FIELD, PLAYER, POSSESSION, BALL, KICK, DASH, TACKLE, POWERUP,
} from './config.js';
import {
  len, normalize, clamp, collideCircles, collideSegment, confineToBox,
} from './physics.js';

const POWERUP_TYPES = Object.keys(POWERUP.types);
const EFFECTS = ['speed', 'mega', 'giant', 'energy'];
const STATE_CODE = { normal: 0, dash: 1, slide: 2, recover: 3, stunned: 4 };
const CHARGE_CODE = { shot: 1, lob: 2 };

const lerp = (a, b, t) => a + (b - a) * t;
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

// One football match: owns the simulation, the rules and the snapshot format.
export class Match {
  constructor({ mode, players, rng = Math.random }) {
    const m = MODES[mode];
    this.mode = mode;
    this.teamSize = m.teamSize;
    this.hw = m.width / 2;
    this.hh = m.height / 2;
    this.gw2 = m.goalWidth / 2;
    this.field = {
      width: m.width,
      height: m.height,
      goalWidth: m.goalWidth,
      goalDepth: FIELD.goalDepth,
      postRadius: FIELD.postRadius,
      crossbarHeight: FIELD.crossbarHeight,
      playerMargin: FIELD.playerMargin,
    };
    this.rng = rng;

    this.tick = 0;
    this.players = new Map();
    this.nextIdx = 0;
    this.ball = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0,
      r: BALL.radius, m: BALL.mass, ignoreId: null, ignoreTimer: 0,
      ownerId: null, protect: 0,
    };
    this.score = [0, 0];
    this.clock = MATCH.duration;
    this.playTime = 0;
    this.overtime = false;
    this.state = 'countdown';
    this.stateTimer = MATCH.firstCountdown;
    this.kickoffTeam = rng() < 0.5 ? 0 : 1;
    this.events = [];
    this.powerups = [];
    this.nextPowerupId = 1;
    this.powerupTimer = lerp(POWERUP.spawnMin, POWERUP.spawnMax, rng());
    this.lastTouch = null;
    this.prevTouch = null;
    this.goals = [];
    this.result = null;
    this.done = false;
    this.teamHadPlayers = [false, false];

    this.buildWalls();
    for (const p of players) this.addPlayer(p.id, p.name, p.team);
    this.resetPositions();
  }

  buildWalls() {
    const { hw, hh, gw2 } = this;
    const gd = FIELD.goalDepth;
    const seg = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
    // Pitch boundary with gaps for the two goal mouths.
    this.ballWalls = [
      seg(-hw, -hh, hw, -hh),
      seg(-hw, hh, hw, hh),
      seg(-hw, -hh, -hw, -gw2),
      seg(-hw, gw2, -hw, hh),
      seg(hw, -hh, hw, -gw2),
      seg(hw, gw2, hw, hh),
    ];
    this.nets = [
      seg(-hw, -gw2, -hw - gd, -gw2),
      seg(-hw - gd, -gw2, -hw - gd, gw2),
      seg(-hw - gd, gw2, -hw, gw2),
      seg(hw, -gw2, hw + gd, -gw2),
      seg(hw + gd, -gw2, hw + gd, gw2),
      seg(hw + gd, gw2, hw, gw2),
    ];
    // Only solid for a ball flying above crossbar height.
    this.crossbars = [seg(-hw, -gw2, -hw, gw2), seg(hw, -gw2, hw, gw2)];
    this.posts = [[-hw, -gw2], [-hw, gw2], [hw, -gw2], [hw, gw2]].map(([x, y]) => ({
      x, y, vx: 0, vy: 0, r: FIELD.postRadius, m: Infinity,
    }));
  }

  addPlayer(id, name, team) {
    const num = [...this.players.values()].filter((p) => p.team === team).length + 1;
    this.players.set(id, {
      id, name, team, num, idx: this.nextIdx++,
      x: 0, y: 0, vx: 0, vy: 0, r: PLAYER.radius, m: PLAYER.mass,
      aimX: team === 0 ? 1 : -1, aimY: 0,
      input: { mx: 0, my: 0, ax: 0, ay: 0, sh: false, lb: false, ps: 0, ds: 0, tk: 0 },
      charging: null, charge: 0, pendingKick: null,
      wantPass: false, wantDash: false, wantTackle: false,
      state: 'normal', stateTimer: 0, dirX: 0, dirY: 0,
      immunity: 0, kickCooldown: 0, pickupCooldown: 0, holdAngle: 0,
      stamina: PLAYER.staminaMax, staminaDelay: 0,
      effects: { speed: 0, mega: 0, giant: 0, energy: 0 },
      goals: 0,
    });
    this.teamHadPlayers[team] = true;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (this.ball.ownerId === id) this.ball.ownerId = null;
    if (this.state === 'ended') return;
    const counts = this.teamCounts();
    if (counts[0] === 0 && counts[1] === 0) this.endMatch(-1, true);
    else if (this.teamHadPlayers[p.team] && counts[p.team] === 0) this.endMatch(1 - p.team, true);
  }

  teamCounts() {
    const c = [0, 0];
    for (const p of this.players.values()) c[p.team]++;
    return c;
  }

  resetPositions() {
    const b = this.ball;
    Object.assign(b, {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, ignoreId: null, ignoreTimer: 0, ownerId: null, protect: 0,
    });
    const formation = FORMATIONS[this.teamSize];
    for (const team of [0, 1]) {
      const side = team === 0 ? -1 : 1;
      const members = [...this.players.values()].filter((p) => p.team === team).sort((a, c) => a.num - c.num);
      members.forEach((p, i) => {
        const spot = formation[i % formation.length];
        p.x = side * spot.fx * this.hw;
        p.y = spot.fy * this.hh;
        if (i === 0 && team === this.kickoffTeam) {
          p.x = side * (BALL.radius + PLAYER.radius + 25);
          p.y = 0;
        }
        Object.assign(p, {
          vx: 0, vy: 0, aimX: -side, aimY: 0, state: 'normal', stateTimer: 0,
          charging: null, charge: 0, pendingKick: null, pickupCooldown: 0,
          wantPass: false, wantDash: false, wantTackle: false,
        });
      });
    }
    this.powerups = [];
    this.lastTouch = null;
    this.prevTouch = null;
  }

  // ---- input -------------------------------------------------------------

  handleInput(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    const axis = (v) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, -1, 1) : 0);
    const counter = (v) => (Number.isInteger(v) ? v : 0);
    const inp = p.input;
    inp.mx = axis(msg.mx);
    inp.my = axis(msg.my);
    inp.ax = axis(msg.ax);
    inp.ay = axis(msg.ay);

    // Discrete actions arrive as counters so a quick tap is never lost between ticks.
    const ps = counter(msg.ps);
    const ds = counter(msg.ds);
    const tk = counter(msg.tk);
    if (ps !== inp.ps) p.wantPass = true;
    if (ds !== inp.ds) p.wantDash = true;
    if (tk !== inp.tk) p.wantTackle = true;
    inp.ps = ps;
    inp.ds = ds;
    inp.tk = tk;

    // Charge transitions are handled per message for the same reason.
    const sh = msg.sh === true;
    const lb = msg.lb === true;
    if (!p.charging && this.state === 'playing' && (p.state === 'normal' || p.state === 'recover')) {
      if (sh && !inp.sh) this.startCharge(p, 'shot');
      else if (lb && !inp.lb) this.startCharge(p, 'lob');
    }
    if ((p.charging === 'shot' && !sh) || (p.charging === 'lob' && !lb)) {
      p.pendingKick = { type: p.charging, charge: p.charge, ttl: KICK.grace };
      p.charging = null;
      p.charge = 0;
    }
    inp.sh = sh;
    inp.lb = lb;
  }

  startCharge(p, type) {
    p.charging = type;
    p.charge = 0;
    p.pendingKick = null;
  }

  // ---- main loop -----------------------------------------------------------

  step() {
    this.tick++;
    switch (this.state) {
      case 'countdown':
        this.stateTimer -= DT;
        for (const p of this.players.values()) this.updateAim(p, normalize(p.input.mx, p.input.my));
        if (this.stateTimer <= 0) {
          this.state = 'playing';
          this.stateTimer = 0;
          this.emit({ k: 'whistle' });
        }
        break;
      case 'playing':
        this.playTime += DT;
        if (!this.overtime) {
          this.clock -= DT;
          if (this.clock <= 0) {
            this.clock = 0;
            if (this.score[0] !== this.score[1]) {
              this.endMatch(this.score[0] > this.score[1] ? 0 : 1, false);
              break;
            }
            this.overtime = true;
            this.emit({ k: 'overtime' });
          }
        }
        this.simulate(true);
        break;
      case 'goal':
        this.stateTimer -= DT;
        this.simulate(false);
        if (this.stateTimer <= 0) {
          if (this.overtime) {
            this.endMatch(this.score[0] > this.score[1] ? 0 : 1, false);
          } else {
            this.resetPositions();
            this.state = 'countdown';
            this.stateTimer = MATCH.countdown;
          }
        }
        break;
      case 'ended':
        this.stateTimer -= DT;
        this.simulate(false);
        if (this.stateTimer <= 0) this.done = true;
        break;
    }
  }

  simulate(live) {
    for (const p of this.players.values()) this.updatePlayer(p, live);
    if (live) {
      for (const p of this.players.values()) this.tryKick(p);
      this.updatePowerups();
    }
    this.updateBallForces();
    this.integrate(live);
    if (live) this.checkGoal();
  }

  updatePlayer(p, live) {
    if (live) {
      for (const e of EFFECTS) if (p.effects[e] > 0) p.effects[e] = Math.max(0, p.effects[e] - DT);
    }
    const giant = p.effects.giant > 0;
    p.r = PLAYER.radius * (giant ? POWERUP.types.giant.radiusMul : 1);
    p.m = PLAYER.mass * (giant ? POWERUP.types.giant.massMul : 1) * (p.state === 'dash' ? DASH.massMul : 1);
    p.kickCooldown = Math.max(0, p.kickCooldown - DT);
    p.pickupCooldown = Math.max(0, p.pickupCooldown - DT);
    p.immunity = Math.max(0, p.immunity - DT);

    if (p.effects.energy > 0) p.stamina = PLAYER.staminaMax;
    else if (p.staminaDelay > 0) p.staminaDelay -= DT;
    else p.stamina = Math.min(PLAYER.staminaMax, p.stamina + PLAYER.staminaRegen * DT);

    if (p.state !== 'normal') {
      p.stateTimer -= DT;
      if (p.stateTimer <= 0) {
        if (p.state === 'slide') {
          p.state = 'recover';
          p.stateTimer = TACKLE.recover;
        } else {
          if (p.state === 'stunned') p.immunity = TACKLE.immunity;
          p.state = 'normal';
          p.stateTimer = 0;
        }
      }
    }

    const mv = normalize(p.input.mx, p.input.my);
    const canMove = p.state === 'normal' || p.state === 'recover';

    if (p.wantDash) {
      p.wantDash = false;
      if (live && p.state === 'normal' && this.hasStamina(p, DASH.cost)) {
        const d = mv.x || mv.y ? mv : { x: p.aimX, y: p.aimY };
        this.spendStamina(p, DASH.cost);
        p.vx = d.x * DASH.speed;
        p.vy = d.y * DASH.speed;
        p.state = 'dash';
        p.stateTimer = DASH.time;
        this.emit({ k: 'dash', p: p.idx });
      }
    }
    if (p.wantTackle) {
      p.wantTackle = false;
      if (live && p.state === 'normal' && this.hasStamina(p, TACKLE.cost)) {
        const d = mv.x || mv.y ? mv : { x: p.aimX, y: p.aimY };
        this.spendStamina(p, TACKLE.cost);
        p.vx = d.x * TACKLE.speed;
        p.vy = d.y * TACKLE.speed;
        p.dirX = d.x;
        p.dirY = d.y;
        p.state = 'slide';
        p.stateTimer = TACKLE.time;
        p.charging = null;
        p.charge = 0;
        p.pendingKick = null;
        this.emit({ k: 'slide', p: p.idx });
      }
    }
    if (p.wantPass) {
      p.wantPass = false;
      if (live && canMove && !p.charging) p.pendingKick = { type: 'pass', charge: 0, ttl: KICK.grace };
    }

    if (p.charging) {
      if (!live || !canMove) {
        p.charging = null;
        p.charge = 0;
      } else {
        p.charge = Math.min(1, p.charge + DT / KICK.chargeTime);
      }
    }

    // Re-check: a dash or slide that started this tick must keep its burst speed.
    if (p.state === 'normal' || p.state === 'recover') {
      let speed = PLAYER.maxSpeed;
      if (p.effects.speed > 0) speed *= POWERUP.types.speed.speedMul;
      if (p.charging) speed *= PLAYER.chargingSpeedMul;
      if (p.state === 'recover') speed *= PLAYER.recoverSpeedMul;
      const k = Math.min(1, PLAYER.response * DT);
      p.vx += (mv.x * speed - p.vx) * k;
      p.vy += (mv.y * speed - p.vy) * k;
      this.updateAim(p, mv);
    } else {
      const f = Math.exp((p.state === 'stunned' ? -5 : -1.5) * DT);
      p.vx *= f;
      p.vy *= f;
    }

    // A carried ball swings smoothly round to wherever the carrier aims.
    if (this.ball.ownerId === p.id) {
      let diff = Math.atan2(p.aimY, p.aimX) - p.holdAngle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const maxTurn = POSSESSION.turnRate * DT;
      p.holdAngle += clamp(diff, -maxTurn, maxTurn);
    }
  }

  // Arrow keys aim; with no arrow held the player aims where they run.
  updateAim(p, mv) {
    const a = normalize(p.input.ax, p.input.ay);
    if (a.x || a.y) {
      p.aimX = a.x;
      p.aimY = a.y;
    } else if (mv.x || mv.y) {
      p.aimX = mv.x;
      p.aimY = mv.y;
    }
  }

  hasStamina(p, cost) {
    return p.effects.energy > 0 || p.stamina >= cost;
  }

  spendStamina(p, cost) {
    if (p.effects.energy > 0) return;
    p.stamina -= cost;
    p.staminaDelay = PLAYER.staminaRegenDelay;
  }

  // ---- kicking -------------------------------------------------------------

  canReachBall(p) {
    const b = this.ball;
    if (b.ownerId) return b.ownerId === p.id;
    if (b.z >= PLAYER.height) return false;
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const d = len(dx, dy);
    if (d > p.r + b.r + PLAYER.kickReach) return false;
    // The ball has to be roughly in front of where the player is aiming.
    return d < 1e-6 || (dx * p.aimX + dy * p.aimY) / d > -0.3;
  }

  tryKick(p) {
    const k = p.pendingKick;
    if (!k) return;
    k.ttl -= DT;
    if (p.state === 'stunned' || p.state === 'slide') {
      p.pendingKick = null;
      return;
    }
    if (p.kickCooldown <= 0 && this.canReachBall(p)) {
      this.kick(p, k);
      p.pendingKick = null;
    } else if (k.ttl <= 0) {
      p.pendingKick = null;
    }
  }

  kick(p, k) {
    const b = this.ball;
    let dirX = p.aimX;
    let dirY = p.aimY;
    let power;
    let spin = 0;
    const mega = p.effects.mega > 0 ? KICK.megaMul : 1;

    if (k.type === 'pass') {
      const target = this.findPassTarget(p);
      if (target) {
        const dx = target.x - b.x;
        const dy = target.y - b.y;
        const d = len(dx, dy);
        const lead = d / 700; // rough flight time, used to lead a moving teammate
        const d2 = normalize(dx + target.vx * lead * 0.8, dy + target.vy * lead * 0.8);
        dirX = d2.x;
        dirY = d2.y;
        // Enough to arrive slow enough for the teammate to collect it.
        power = clamp(d * 0.8 + 300, KICK.passMin, KICK.passMax);
      } else {
        power = KICK.passSolo;
      }
      b.vz = Math.min(b.vz, 0);
    } else {
      power = lerp(KICK.minPower, KICK.maxPower, k.charge) * mega;
      // Moving sideways relative to the shot puts spin on the ball, bending it that way.
      const lateral = clamp((dirX * p.vy - dirY * p.vx) / PLAYER.maxSpeed, -1, 1);
      spin = lateral * KICK.maxCurve * (0.5 + 0.5 * k.charge);
      if (k.type === 'lob') {
        power *= KICK.lobPowerMul;
        b.vz = lerp(KICK.lobLiftMin, KICK.lobLiftMax, k.charge);
      } else {
        b.vz = KICK.shotHopMax * k.charge;
      }
    }

    b.ownerId = null;
    p.pickupCooldown = POSSESSION.regrabDelay;
    b.vx = dirX * power;
    b.vy = dirY * power;
    b.spin = spin;
    b.ignoreId = p.id; // let the ball leave the foot without clipping the kicker
    b.ignoreTimer = 0.12;
    p.kickCooldown = PLAYER.kickCooldown;
    this.touch(p);
    this.emit({ k: 'kick', p: p.idx, t: k.type, pw: r2(power / KICK.maxPower) });
  }

  findPassTarget(p) {
    const b = this.ball;
    let best = null;
    let bestAngle = KICK.passCone;
    for (const q of this.players.values()) {
      if (q === p || q.team !== p.team) continue;
      const dx = q.x - b.x;
      const dy = q.y - b.y;
      const d = len(dx, dy);
      if (d < 40) continue;
      const angle = Math.acos(clamp((dx * p.aimX + dy * p.aimY) / d, -1, 1));
      if (angle < bestAngle) {
        best = q;
        bestAngle = angle;
      }
    }
    return best;
  }

  touch(p) {
    if (this.lastTouch && this.lastTouch.id === p.id) return;
    this.prevTouch = this.lastTouch;
    this.lastTouch = { id: p.id, team: p.team, name: p.name };
  }

  stun(victim, attacker) {
    if (victim.immunity > 0 || victim.state === 'stunned') return;
    victim.state = 'stunned';
    victim.stateTimer = TACKLE.stun;
    victim.charging = null;
    victim.charge = 0;
    victim.pendingKick = null;
    victim.vx += attacker.dirX * TACKLE.knock;
    victim.vy += attacker.dirY * TACKLE.knock;
    this.emit({ k: 'tackle', p: attacker.idx, v: victim.idx });
    if (this.ball.ownerId === victim.id) this.knockLoose(victim, attacker);
  }

  // ---- possession -------------------------------------------------------------

  canGrab(p) {
    return p.pickupCooldown <= 0 && p.state !== 'stunned' && p.state !== 'slide';
  }

  takeBall(p, from) {
    const b = this.ball;
    b.ownerId = p.id;
    b.z = 0;
    b.vz = 0;
    b.spin = 0;
    b.ignoreId = null;
    p.holdAngle = Math.atan2(b.y - p.y, b.x - p.x);
    this.touch(p);
    if (from) {
      b.protect = POSSESSION.stealProtect;
      from.pickupCooldown = POSSESSION.loseDelay;
      this.emit({ k: 'steal', p: p.idx, v: from.idx });
    } else {
      this.emit({ k: 'grab', p: p.idx });
    }
  }

  // A slide tackle pops the ball off its carrier in the direction of the slide.
  knockLoose(carrier, slider) {
    const b = this.ball;
    b.ownerId = null;
    b.vx = slider.dirX * TACKLE.ballPoke + carrier.vx * 0.3;
    b.vy = slider.dirY * TACKLE.ballPoke + carrier.vy * 0.3;
    b.vz = 180;
    b.ignoreId = slider.id;
    b.ignoreTimer = 0.15;
    carrier.pickupCooldown = POSSESSION.loseDelay;
    this.touch(slider);
    this.emit({ k: 'kick', p: slider.idx, t: 'poke', pw: 0.5 });
  }

  // Moves the carried ball to the spot in front of its carrier. It sweeps out from the
  // carrier's centre in small steps so walls stop it instead of it popping through.
  carryBall(p) {
    const b = this.ball;
    const dist = p.r + b.r + POSSESSION.holdGap;
    const steps = 4;
    const dx = (Math.cos(p.holdAngle) * dist) / steps;
    const dy = (Math.sin(p.holdAngle) * dist) / steps;
    b.x = p.x;
    b.y = p.y;
    b.vx = 0;
    b.vy = 0;
    for (let i = 0; i < steps; i++) {
      b.x += dx;
      b.y += dy;
      this.ballVsStatic(false);
    }
    b.vx = p.vx;
    b.vy = p.vy;
    b.z = 0;
    b.vz = 0;
    b.spin = 0;
  }

  ballVsPlayers(players, live) {
    const b = this.ball;
    const carrier = b.ownerId ? this.players.get(b.ownerId) : null;
    for (const p of players) {
      if (p === carrier || p.id === b.ignoreId) continue;
      const touching = len(b.x - p.x, b.y - p.y) <= p.r + b.r + POSSESSION.pickupSlack;
      if (carrier) {
        // Opponents take a carried ball by running into it; teammates pass through it.
        if (!live || !touching || p.team === carrier.team || p.state === 'stunned') continue;
        if (p.state === 'slide') {
          this.knockLoose(carrier, p);
          return;
        }
        if (b.protect <= 0 && p.pickupCooldown <= 0) {
          this.takeBall(p, carrier);
          return;
        }
        continue;
      }
      if (live && touching && this.canGrab(p) && len(b.vx, b.vy) < POSSESSION.catchSpeed) {
        this.takeBall(p, null);
        return;
      }
      if (collideCircles(p, b, BALL.playerBounce) > 0) {
        this.touch(p);
        if (p.state === 'slide') {
          const d = normalize(b.x - p.x + p.dirX * b.r, b.y - p.y + p.dirY * b.r);
          b.vx = d.x * TACKLE.ballPoke;
          b.vy = d.y * TACKLE.ballPoke;
          b.spin = 0;
          b.ignoreId = p.id;
          b.ignoreTimer = 0.12;
          this.emit({ k: 'kick', p: p.idx, t: 'poke', pw: 0.5 });
        }
      }
    }
  }

  ballVsStatic(events) {
    const b = this.ball;
    if (b.z < FIELD.crossbarHeight) {
      for (const post of this.posts) {
        const j = collideCircles(post, b, BALL.postBounce);
        if (events && j > 150) this.emit({ k: 'post', s: r2(Math.min(1, j / 1000)) });
      }
    }
    for (const net of this.nets) collideSegment(b, net, 0.25);
    for (const wall of this.ballWalls) {
      const v = collideSegment(b, wall, BALL.wallBounce);
      if (events && v > 150) this.emit({ k: 'wall', s: r2(Math.min(1, v / 1000)) });
    }
    if (b.z >= FIELD.crossbarHeight) {
      for (const bar of this.crossbars) {
        const v = collideSegment(b, bar, BALL.wallBounce);
        if (events && v > 150) this.emit({ k: 'post', s: r2(Math.min(1, v / 1000)) });
      }
    }
  }

  // ---- power-ups -------------------------------------------------------------

  updatePowerups() {
    this.powerupTimer -= DT;
    if (this.powerupTimer <= 0) {
      this.powerupTimer = lerp(POWERUP.spawnMin, POWERUP.spawnMax, this.rng());
      if (this.powerups.length < POWERUP.maxOnField) this.spawnPowerup();
    }
    for (const pu of this.powerups) pu.ttl -= DT;
    this.powerups = this.powerups.filter((pu) => pu.ttl > 0);

    for (const p of this.players.values()) {
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const pu = this.powerups[i];
        if (len(pu.x - p.x, pu.y - p.y) < p.r + POWERUP.radius) {
          p.effects[pu.type] = POWERUP.types[pu.type].duration;
          if (pu.type === 'energy') p.stamina = PLAYER.staminaMax;
          this.powerups.splice(i, 1);
          this.emit({ k: 'pickup', p: p.idx, type: pu.type });
        }
      }
    }
  }

  spawnPowerup() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = lerp(-this.hw + 120, this.hw - 120, this.rng());
      const y = lerp(-this.hh + 50, this.hh - 50, this.rng());
      const clear = len(x - this.ball.x, y - this.ball.y) > 60
        && [...this.players.values()].every((p) => len(x - p.x, y - p.y) > 80);
      if (!clear) continue;
      const type = POWERUP_TYPES[Math.floor(this.rng() * POWERUP_TYPES.length)];
      this.powerups.push({ id: this.nextPowerupId++, type, x, y, ttl: POWERUP.lifetime });
      return;
    }
  }

  // ---- ball & integration ----------------------------------------------------

  updateBallForces() {
    const b = this.ball;
    if (b.ignoreTimer > 0) {
      b.ignoreTimer -= DT;
      if (b.ignoreTimer <= 0) b.ignoreId = null;
    }
    b.protect = Math.max(0, b.protect - DT);
    if (b.ownerId) return; // carried: position comes from the carrier

    // Spin rotates the velocity vector (Magnus effect), so curving keeps the speed.
    if (b.spin !== 0) {
      const a = b.spin * DT;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const vx = b.vx * c - b.vy * s;
      b.vy = b.vx * s + b.vy * c;
      b.vx = vx;
      b.spin *= Math.exp(-BALL.spinDecay * DT);
      if (Math.abs(b.spin) < 0.01) b.spin = 0;
    }

    const onGround = b.z <= 0 && b.vz === 0;
    if (onGround) {
      const f = Math.exp(-BALL.groundFriction * DT);
      b.vx *= f;
      b.vy *= f;
      const speed = len(b.vx, b.vy);
      const dec = BALL.rollResistance * DT;
      if (speed <= dec) {
        b.vx = 0;
        b.vy = 0;
      } else {
        b.vx *= (speed - dec) / speed;
        b.vy *= (speed - dec) / speed;
      }
    } else {
      const f = Math.exp(-BALL.airDrag * DT);
      b.vx *= f;
      b.vy *= f;
      b.vz -= BALL.gravity * DT;
      b.z += b.vz * DT;
      if (b.z <= 0) {
        b.z = 0;
        if (-b.vz > BALL.minBounceSpeed) {
          this.emit({ k: 'bounce', s: r2(Math.min(1, -b.vz / 500)) });
          b.vz = -b.vz * BALL.groundBounce;
          b.vx *= BALL.bounceSlowdown;
          b.vy *= BALL.bounceSlowdown;
          b.spin *= 0.7;
        } else {
          b.vz = 0;
        }
      }
    }

    const speed = len(b.vx, b.vy);
    if (speed > BALL.maxSpeed) {
      b.vx *= BALL.maxSpeed / speed;
      b.vy *= BALL.maxSpeed / speed;
    }
  }

  integrate(live) {
    const b = this.ball;
    const players = [...this.players.values()];
    const h = DT / SUBSTEPS;
    const m = FIELD.playerMargin;

    for (let s = 0; s < SUBSTEPS; s++) {
      for (const p of players) {
        p.x += p.vx * h;
        p.y += p.vy * h;
      }
      if (!b.ownerId) {
        b.x += b.vx * h;
        b.y += b.vy * h;
      }

      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const a = players[i];
          const c = players[j];
          if (collideCircles(a, c, PLAYER.playerBounce) > 0 && a.team !== c.team) {
            if (a.state === 'slide') this.stun(c, a);
            if (c.state === 'slide') this.stun(a, c);
          }
        }
      }

      // Players stay on the pitch (and may step into the goal mouths).
      for (const p of players) {
        for (const post of this.posts) collideCircles(post, p, PLAYER.wallBounce);
        for (const wall of this.ballWalls) collideSegment(p, wall, PLAYER.wallBounce);
        for (const net of this.nets) collideSegment(p, net, PLAYER.wallBounce);
        confineToBox(p, -this.hw - m, -this.hh - m, this.hw + m, this.hh + m, PLAYER.wallBounce);
      }

      const carrier = b.ownerId ? this.players.get(b.ownerId) : null;
      if (carrier) this.carryBall(carrier);
      if (b.z < PLAYER.height) this.ballVsPlayers(players, live);
      if (!b.ownerId) this.ballVsStatic(true);
    }

    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.z)) {
      Object.assign(b, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, ownerId: null });
    }
  }

  checkGoal() {
    const b = this.ball;
    if (b.x < -this.hw - b.r) this.scoreGoal(1);
    else if (b.x > this.hw + b.r) this.scoreGoal(0);
  }

  scoreGoal(team) {
    this.score[team]++;
    const lt = this.lastTouch;
    const own = !!lt && lt.team !== team;
    const pt = this.prevTouch;
    const assist = lt && !own && pt && pt.team === team && pt.id !== lt.id ? pt.name : null;
    if (lt && !own) {
      const scorer = this.players.get(lt.id);
      if (scorer) scorer.goals++;
    }
    const goal = {
      team,
      scorer: lt ? lt.name : null,
      own,
      assist,
      time: Math.floor(this.playTime),
    };
    this.goals.push(goal);
    this.emit({ k: 'goal', team, s: goal.scorer, own, a: assist });
    this.state = 'goal';
    this.stateTimer = MATCH.goalPause;
    this.kickoffTeam = 1 - team;
    this.ball.ownerId = null;
    for (const p of this.players.values()) {
      p.charging = null;
      p.charge = 0;
      p.pendingKick = null;
    }
  }

  endMatch(winner, forfeit) {
    this.state = 'ended';
    this.stateTimer = MATCH.endPause;
    this.result = {
      winner,
      forfeit,
      score: [...this.score],
      goals: this.goals,
      players: [...this.players.values()].map((p) => ({ name: p.name, team: p.team, goals: p.goals })),
    };
    this.emit({ k: 'end', w: winner });
  }

  emit(ev) {
    this.events.push(ev);
  }

  // ---- network payloads ------------------------------------------------------

  initPayload() {
    return {
      mode: this.mode,
      tickRate: TICK_RATE,
      field: this.field,
      ballRadius: BALL.radius,
      playerRadius: PLAYER.radius,
      playerHeight: PLAYER.height,
      kickReach: PLAYER.kickReach,
      staminaMax: PLAYER.staminaMax,
      duration: MATCH.duration,
      powerupRadius: POWERUP.radius,
      powerupTypes: POWERUP_TYPES,
      dashCost: DASH.cost,
      tackleCost: TACKLE.cost,
      chargeTime: KICK.chargeTime,
    };
  }

  ownerIdx() {
    const owner = this.ball.ownerId ? this.players.get(this.ball.ownerId) : null;
    return owner ? owner.idx : -1;
  }

  roster() {
    return [...this.players.values()].map((p) => ({
      idx: p.idx, id: p.id, name: p.name, team: p.team, num: p.num,
    }));
  }

  snapshot() {
    const b = this.ball;
    const snap = {
      t: this.tick,
      st: this.state,
      tm: r2(Math.max(0, this.stateTimer)),
      clk: r1(this.clock),
      ot: this.overtime ? 1 : 0,
      sc: this.score,
      b: [r1(b.x), r1(b.y), r1(b.z), r1(b.vx), r1(b.vy), r2(b.spin), this.ownerIdx()],
      p: [...this.players.values()].map((p) => [
        p.idx, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), r2(p.aimX), r2(p.aimY), r1(p.r),
        p.charging ? CHARGE_CODE[p.charging] : 0, r2(p.charge),
        Math.round(p.stamina), STATE_CODE[p.state],
        EFFECTS.some((e) => p.effects[e] > 0) ? EFFECTS.map((e) => r1(p.effects[e])) : 0,
      ]),
      pu: this.powerups.map((pu) => [pu.id, POWERUP_TYPES.indexOf(pu.type), r1(pu.x), r1(pu.y), r1(pu.ttl)]),
      ev: this.events,
    };
    this.events = [];
    return snap;
  }
}
