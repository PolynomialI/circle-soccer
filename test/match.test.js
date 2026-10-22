import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match.js';
import { MATCH, DT, PLAYER, TACKLE, MODES, FIELD, POWERUP } from '../server/config.js';

function seeded(seed = 1) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function newMatch(mode = '1v1', players) {
  const list = players || [
    { id: 'a', name: 'Alice', team: 0 },
    { id: 'b', name: 'Bob', team: 1 },
  ];
  const m = new Match({ mode, players: list, rng: seeded(7) });
  // Skip the opening countdown.
  while (m.state === 'countdown') m.step();
  return m;
}

function stepFor(m, seconds) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) m.step();
}

function park(m, id, x, y) {
  const p = m.players.get(id);
  Object.assign(p, { x, y, vx: 0, vy: 0 });
  return p;
}

// Puts the ball at a player's feet, aimed (and carried) in the given direction.
function giveBall(m, id, ax = 1, ay = 0) {
  const p = m.players.get(id);
  m.handleInput(id, { ax, ay });
  p.aimX = ax;
  p.aimY = ay;
  p.holdAngle = Math.atan2(ay, ax);
  m.ball.ownerId = id;
  m.step();
  return p;
}

const FOUR = [
  { id: 'a', name: 'Alice', team: 0 },
  { id: 'c', name: 'Carol', team: 0 },
  { id: 'b', name: 'Bob', team: 1 },
  { id: 'd', name: 'Dan', team: 1 },
];

test('countdown leads into play with a whistle', () => {
  const m = new Match({ mode: '1v1', players: [{ id: 'a', name: 'A', team: 0 }], rng: seeded() });
  assert.equal(m.state, 'countdown');
  stepFor(m, MATCH.firstCountdown + 0.05);
  assert.equal(m.state, 'playing');
});

test('movement reaches near full speed almost instantly', () => {
  const m = newMatch();
  const a = park(m, 'a', -300, 0);
  m.handleInput('a', { mx: 1, my: 0 });
  stepFor(m, 3 * DT);
  assert.ok(a.vx > PLAYER.maxSpeed * 0.9, `only reached ${a.vx}`);
});

test('touching a loose ball picks it up and it rides in front of the carrier', () => {
  const m = newMatch();
  park(m, 'b', 400, 300);
  const a = park(m, 'a', -300, 0);
  Object.assign(m.ball, { x: -270, y: 0, vx: 0, vy: 0 });
  m.handleInput('a', { mx: 1, my: 0 });
  stepFor(m, 0.1);
  assert.equal(m.ball.ownerId, 'a');
  // Run up and right; the ball stays glued to the front.
  m.handleInput('a', { mx: 1, my: -1 });
  stepFor(m, 0.8);
  const d = Math.hypot(m.ball.x - a.x, m.ball.y - a.y);
  assert.ok(Math.abs(d - (a.r + m.ball.r + 1)) < 0.5, `ball drifted to ${d}`);
  const front = ((m.ball.x - a.x) * a.aimX + (m.ball.y - a.y) * a.aimY) / d;
  assert.ok(front > 0.99, 'ball should sit in the aim direction');
});

test('the carried ball swings round smoothly when the aim flips', () => {
  const m = newMatch();
  park(m, 'b', 400, 300);
  const a = park(m, 'a', 0, 0);
  giveBall(m, 'a', 1, 0);
  m.handleInput('a', { ax: -1, ay: 0 });
  m.step();
  assert.ok(m.ball.x > a.x, 'should not teleport through the player');
  stepFor(m, 0.3);
  assert.ok(m.ball.x < a.x - 10, 'should end up on the new side');
});

test('an opponent running into the ball steals it, and cannot lose it straight back', () => {
  const m = newMatch();
  const a = park(m, 'a', 0, 0);
  giveBall(m, 'a', 1, 0);
  park(m, 'b', 60, 0);
  m.handleInput('b', { mx: -1, my: 0 });
  stepFor(m, 0.15);
  assert.equal(m.ball.ownerId, 'b');
  assert.ok(m.events.some((e) => e.k === 'steal'));
  // Alice is right there, but the steal protection keeps it with Bob for a moment.
  m.handleInput('a', { mx: 1, my: 0 });
  stepFor(m, 0.3);
  assert.equal(m.ball.ownerId, 'b');
  assert.ok(a.pickupCooldown >= 0);
});

test('teammates run through a carried ball without taking it', () => {
  const m = newMatch('2v2', FOUR);
  park(m, 'b', 600, 400);
  park(m, 'd', 700, 400);
  park(m, 'a', 0, 0);
  giveBall(m, 'a', 1, 0);
  park(m, 'c', 80, 0);
  m.handleInput('c', { mx: -1, my: 0 });
  stepFor(m, 0.5);
  assert.equal(m.ball.ownerId, 'a');
});

test('a charged shot from possession scores for red', () => {
  const m = newMatch();
  park(m, 'b', 0, -300);
  park(m, 'a', m.hw - 300, 0);
  giveBall(m, 'a', 1, 0);
  m.handleInput('a', { ax: 1, ay: 0, sh: true });
  stepFor(m, 0.5);
  m.handleInput('a', { ax: 1, ay: 0, sh: false });
  stepFor(m, 1);
  assert.deepEqual(m.score, [1, 0]);
  assert.equal(m.goals[0].scorer, 'Alice');
  assert.equal(m.state, 'goal');
  assert.equal(m.ball.ownerId, null);
});

test('dribbling the ball into the net scores', () => {
  const m = newMatch();
  park(m, 'b', 0, -300);
  park(m, 'a', m.hw - 120, 0);
  giveBall(m, 'a', 1, 0);
  m.handleInput('a', { mx: 1, my: 0 });
  stepFor(m, 1.5);
  assert.deepEqual(m.score, [1, 0]);
});

test('hard shots bounce off players, slow balls get collected', () => {
  const m = newMatch();
  park(m, 'a', -600, 300);
  park(m, 'b', 0, 0);
  Object.assign(m.ball, { x: -200, y: 0, vx: 1300, vy: 0 });
  stepFor(m, 0.3);
  assert.equal(m.ball.ownerId, null);
  assert.ok(m.ball.vx < 0, 'hard shot should rebound');

  Object.assign(m.ball, { x: -200, y: 0, z: 0, vz: 0, vx: 500, vy: 0 });
  park(m, 'b', 0, 0);
  m.players.get('b').pickupCooldown = 0;
  stepFor(m, 0.6);
  assert.equal(m.ball.ownerId, 'b');
});

test('ball bounces off the side walls and stays in the pitch', () => {
  const m = newMatch();
  park(m, 'a', -500, 0);
  park(m, 'b', 500, 0);
  Object.assign(m.ball, { x: 0, y: 0, vx: 300, vy: -1500 });
  for (let i = 0; i < 200; i++) {
    m.step();
    assert.ok(m.ball.y >= -m.hh + m.ball.r - 0.01, `ball escaped at y=${m.ball.y}`);
  }
  assert.ok(m.ball.vy !== 0);
});

test('moving sideways while shooting curves the ball towards that side', () => {
  const shoot = (moveY) => {
    const m = newMatch('3v3', [{ id: 'a', name: 'A', team: 0 }, { id: 'b', name: 'B', team: 1 }]);
    park(m, 'b', 0, 500);
    const a = park(m, 'a', -600, 0);
    giveBall(m, 'a', 1, 0);
    a.vy = moveY * PLAYER.maxSpeed;
    const startY = m.ball.y;
    m.handleInput('a', { mx: 0, my: moveY, ax: 1, ay: 0, sh: true });
    a.charge = 0.8;
    m.handleInput('a', { mx: 0, my: moveY, ax: 1, ay: 0, sh: false });
    m.step();
    m.handleInput('a', { mx: 0, my: 0, ax: 0, ay: 0 });
    stepFor(m, 0.6);
    return m.ball.y - startY;
  };
  const straight = shoot(0);
  const down = shoot(1);
  const up = shoot(-1);
  assert.ok(Math.abs(straight) < 2, `straight shot drifted ${straight}`);
  assert.ok(down > 20, `expected curve down, got ${down}`);
  assert.ok(up < -20, `expected curve up, got ${up}`);
});

test('a lob flies over a defender, bounces a lot, then settles', () => {
  const m = newMatch('3v3', [{ id: 'a', name: 'A', team: 0 }, { id: 'b', name: 'B', team: 1 }]);
  const a = park(m, 'a', -600, 0);
  const b = park(m, 'b', -450, 0);
  giveBall(m, 'a', 1, 0);
  m.handleInput('a', { ax: 1, ay: 0, lb: true });
  stepFor(m, 0.45);
  m.handleInput('a', { ax: 1, ay: 0, lb: false });
  let maxZ = 0;
  let bounces = 0;
  let passedOver = false;
  for (let i = 0; i < 360; i++) {
    m.step();
    maxZ = Math.max(maxZ, m.ball.z);
    bounces += m.events.filter((e) => e.k === 'bounce').length;
    m.events = [];
    if (m.ball.x > b.x + 30) passedOver = true;
  }
  assert.ok(maxZ > PLAYER.height, `lob only reached z=${maxZ}`);
  assert.ok(passedOver, 'lob should clear the defender');
  assert.ok(bounces >= 3, `expected several bounces, got ${bounces}`);
  assert.equal(m.ball.z, 0);
  stepFor(m, 10);
  assert.equal(Math.hypot(m.ball.vx, m.ball.vy), 0, 'ball should come to rest');
  assert.ok(a);
});

test('a high ball hits the crossbar instead of scoring', () => {
  const m = newMatch();
  park(m, 'a', 0, -300);
  park(m, 'b', 0, 300);
  Object.assign(m.ball, { x: m.hw - 60, y: 0, z: FIELD.crossbarHeight + 30, vx: 900, vy: 0, vz: 0 });
  stepFor(m, 0.3);
  assert.deepEqual(m.score, [0, 0]);
  assert.ok(m.ball.vx < 0, 'ball should bounce back off the crossbar');
});

test('pass goes to the teammate in the aim cone, who collects it', () => {
  const m = newMatch('2v2', FOUR);
  const a = park(m, 'a', -300, 0);
  const c = park(m, 'c', 100, -200);
  park(m, 'b', 300, 400);
  park(m, 'd', 500, 400);
  giveBall(m, 'a', 1, 0);
  const bx = m.ball.x;
  const by = m.ball.y;
  // Aim straight right; the teammate is ~27 degrees up from that.
  m.handleInput('a', { ax: 1, ay: 0, ps: 1 });
  m.step();
  const ang = Math.atan2(m.ball.vy, m.ball.vx);
  const want = Math.atan2(c.y - by, c.x - bx);
  assert.ok(Math.abs(ang - want) < 0.1, `pass went ${ang}, wanted about ${want}`);
  stepFor(m, 2);
  assert.equal(m.ball.ownerId, 'c');
  assert.ok(a);
});

test('slide tackle stuns the carrier and knocks the ball loose', () => {
  const m = newMatch();
  const a = park(m, 'a', -100, 0);
  const b = park(m, 'b', 0, 0);
  giveBall(m, 'b', 1, 0);
  m.handleInput('a', { mx: 1, my: 0, tk: 1 });
  stepFor(m, 0.15);
  assert.equal(b.state, 'stunned');
  assert.notEqual(m.ball.ownerId, 'b');
  assert.ok(a.stamina < PLAYER.staminaMax);
  stepFor(m, TACKLE.stun + 0.05);
  assert.equal(b.state, 'normal');
  assert.ok(b.immunity > 0);
});

test('dash costs stamina and is refused when stamina is low', () => {
  const m = newMatch();
  const a = park(m, 'a', -100, 0);
  a.stamina = 10;
  m.handleInput('a', { mx: 1, my: 0, ds: 1 });
  m.step();
  assert.equal(a.state, 'normal');
  a.stamina = 100;
  m.handleInput('a', { mx: 1, my: 0, ds: 2 });
  m.step();
  assert.equal(a.state, 'dash');
  assert.ok(a.stamina <= 70);
});

test('tied at full time goes to golden goal; next goal ends it', () => {
  const m = newMatch();
  m.clock = DT;
  m.step();
  assert.equal(m.overtime, true);
  assert.equal(m.state, 'playing');
  park(m, 'a', 0, -300);
  park(m, 'b', 0, 300);
  Object.assign(m.ball, { x: -m.hw + 40, y: 0, vx: -800, vy: 0 });
  m.lastTouch = { id: 'b', team: 1, name: 'Bob' };
  stepFor(m, 0.5);
  assert.deepEqual(m.score, [0, 1]);
  stepFor(m, MATCH.goalPause + 0.1);
  assert.equal(m.state, 'ended');
  assert.equal(m.result.winner, 1);
});

test('leaving empties a team and forfeits the match', () => {
  const m = newMatch();
  m.removePlayer('b');
  assert.equal(m.state, 'ended');
  assert.equal(m.result.winner, 0);
  assert.equal(m.result.forfeit, true);
});

test('power-ups spawn (rarely, one at a time) and are picked up', () => {
  const m = newMatch();
  park(m, 'a', -500, 0);
  park(m, 'b', 500, 0);
  stepFor(m, POWERUP.spawnMin - 1);
  assert.equal(m.powerups.length, 0, 'nothing should spawn this early');
  stepFor(m, POWERUP.spawnMax - POWERUP.spawnMin + 2);
  assert.equal(m.powerups.length, 1);
  const pu = m.powerups[0];
  const a = park(m, 'a', pu.x, pu.y);
  m.step();
  assert.ok(a.effects[pu.type] > 0);
});

test('random chaos keeps everything finite and inside the arena', () => {
  for (const mode of Object.keys(MODES)) {
    const n = MODES[mode].teamSize;
    const players = [];
    for (let i = 0; i < n * 2; i++) players.push({ id: `p${i}`, name: `P${i}`, team: i % 2 });
    const m = newMatch(mode, players);
    const rng = seeded(42);
    const counters = {};
    for (let t = 0; t < 60 * 90; t++) {
      if (t % 6 === 0) {
        for (const pl of players) {
          const c = (counters[pl.id] ||= { ps: 0, ds: 0, tk: 0 });
          if (rng() < 0.05) c.ps++;
          if (rng() < 0.03) c.ds++;
          if (rng() < 0.03) c.tk++;
          m.handleInput(pl.id, {
            mx: rng() * 2 - 1, my: rng() * 2 - 1, ax: Math.round(rng() * 2 - 1), ay: Math.round(rng() * 2 - 1),
            sh: rng() < 0.4, lb: rng() < 0.1, ...c,
          });
        }
      }
      m.step();
      const b = m.ball;
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.z));
      assert.ok(Math.abs(b.y) <= m.hh + 1, `${mode}: ball y out ${b.y}`);
      assert.ok(Math.abs(b.x) <= m.hw + FIELD.goalDepth + 1, `${mode}: ball x out ${b.x}`);
      for (const p of m.players.values()) {
        assert.ok(Math.abs(p.x) <= m.hw + FIELD.goalDepth + 0.5, `${mode}: player x out ${p.x}`);
        assert.ok(Math.abs(p.y) <= m.hh + 0.5, `${mode}: player y out ${p.y}`);
      }
      if (m.state === 'ended') break;
    }
    m.snapshot();
    m.step();
    const size = JSON.stringify(m.snapshot()).length;
    assert.ok(size < 1500, `${mode}: snapshot is ${size} bytes`);
  }
});
