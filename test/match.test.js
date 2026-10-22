import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match.js';
import { MATCH, DT, PLAYER, TACKLE, MODES, FIELD } from '../server/config.js';

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

test('countdown leads into play with a whistle', () => {
  const m = new Match({ mode: '1v1', players: [{ id: 'a', name: 'A', team: 0 }], rng: seeded() });
  assert.equal(m.state, 'countdown');
  stepFor(m, MATCH.firstCountdown + 0.05);
  assert.equal(m.state, 'playing');
});

test('a charged shot into the right goal scores for red', () => {
  const m = newMatch();
  park(m, 'b', 0, -200);
  const a = park(m, 'a', m.hw - 150, 0);
  Object.assign(m.ball, { x: a.x + 31, y: 0, vx: 0, vy: 0 });
  m.handleInput('a', { ax: 1, ay: 0, sh: true });
  stepFor(m, 0.5);
  m.handleInput('a', { ax: 1, ay: 0, sh: false });
  stepFor(m, 1);
  assert.deepEqual(m.score, [1, 0]);
  assert.equal(m.goals[0].scorer, 'Alice');
  assert.equal(m.state, 'goal');
});

test('ball bounces off the side walls and stays in the pitch', () => {
  const m = newMatch();
  park(m, 'a', -300, 0);
  park(m, 'b', 300, 0);
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
    park(m, 'b', 0, 300);
    const a = park(m, 'a', -400, 0);
    a.vy = moveY * PLAYER.maxSpeed;
    Object.assign(m.ball, { x: a.x + 31, y: 0, vx: 0, vy: 0 });
    m.handleInput('a', { mx: 0, my: moveY, ax: 1, ay: 0, sh: true });
    a.charge = 0.8;
    m.handleInput('a', { mx: 0, my: moveY, ax: 1, ay: 0, sh: false });
    m.step();
    m.handleInput('a', { mx: 0, my: 0, ax: 0, ay: 0 });
    stepFor(m, 0.6);
    return m.ball.y;
  };
  const straight = shoot(0);
  const down = shoot(1);
  const up = shoot(-1);
  assert.ok(Math.abs(straight) < 2, `straight shot drifted ${straight}`);
  assert.ok(down > 20, `expected curve down, got ${down}`);
  assert.ok(up < -20, `expected curve up, got ${up}`);
});

test('a lob flies over a defender, bounces, then rolls to a stop', () => {
  const m = newMatch();
  const a = park(m, 'a', -300, 0);
  const b = park(m, 'b', -150, 0);
  Object.assign(m.ball, { x: a.x + 31, y: 0 });
  m.handleInput('a', { ax: 1, ay: 0, lb: true });
  stepFor(m, 0.6);
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
  assert.ok(bounces >= 2, `expected several bounces, got ${bounces}`);
  assert.equal(m.ball.z, 0);
  stepFor(m, 8);
  assert.equal(Math.hypot(m.ball.vx, m.ball.vy), 0, 'ball should come to rest');
});

test('a high ball hits the crossbar instead of scoring', () => {
  const m = newMatch();
  park(m, 'a', 0, -200);
  park(m, 'b', 0, 200);
  Object.assign(m.ball, { x: m.hw - 60, y: 0, z: FIELD.crossbarHeight + 30, vx: 900, vy: 0, vz: 0 });
  stepFor(m, 0.3);
  assert.deepEqual(m.score, [0, 0]);
  assert.ok(m.ball.vx < 0, 'ball should bounce back off the crossbar');
});

test('pass picks the teammate in the aim cone', () => {
  const m = newMatch('2v2', [
    { id: 'a', name: 'A', team: 0 },
    { id: 'c', name: 'C', team: 0 },
    { id: 'b', name: 'B', team: 1 },
    { id: 'd', name: 'D', team: 1 },
  ]);
  const a = park(m, 'a', -200, 0);
  const c = park(m, 'c', 100, -180);
  park(m, 'b', 300, 200);
  park(m, 'd', 400, 200);
  Object.assign(m.ball, { x: a.x + 31, y: 0 });
  // Aim straight right; the teammate is ~31 degrees up from that.
  m.handleInput('a', { ax: 1, ay: 0, ps: 1 });
  m.step();
  const ang = Math.atan2(m.ball.vy, m.ball.vx);
  const want = Math.atan2(c.y - a.y, c.x - a.x - 31);
  assert.ok(Math.abs(ang - want) < 0.1, `pass went ${ang}, wanted about ${want}`);
});

test('slide tackle stuns an opponent, who then gets immunity', () => {
  const m = newMatch();
  const a = park(m, 'a', -100, 0);
  const b = park(m, 'b', -40, 0);
  m.handleInput('a', { mx: 1, my: 0, tk: 1 });
  stepFor(m, 0.15);
  assert.equal(b.state, 'stunned');
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
  park(m, 'a', 0, -200);
  park(m, 'b', 0, 200);
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

test('power-ups spawn during play and are picked up', () => {
  const m = newMatch();
  park(m, 'a', -300, 0);
  park(m, 'b', 300, 0);
  stepFor(m, 17);
  assert.ok(m.powerups.length > 0, 'expected a power-up on the field');
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
        assert.ok(Math.abs(p.x) <= m.hw + FIELD.playerMargin + 0.5, `${mode}: player x out ${p.x}`);
        assert.ok(Math.abs(p.y) <= m.hh + FIELD.playerMargin + 0.5, `${mode}: player y out ${p.y}`);
      }
      if (m.state === 'ended') break;
    }
    m.snapshot();
    m.step();
    const size = JSON.stringify(m.snapshot()).length;
    assert.ok(size < 1500, `${mode}: snapshot is ${size} bytes`);
  }
});
