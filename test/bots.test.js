import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../server/match.js';
import { buildPractice, BotSquad } from '../server/bots.js';
import { PRACTICE_FORMATS } from '../server/config.js';

function seeded(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

// Plays a full bot-vs-bot match (red = team 0, blue = team 1) and gathers some stats.
function play(format, red, blue, seed) {
  const rng = seeded(seed);
  const setup = buildPractice({ format, level: blue, teammateLevel: red });
  const m = new Match({ mode: setup.mode, players: setup.players, rng });
  const squad = new BotSquad(m, setup.bots, rng);
  const stats = { poss: [0, 0], passes: [0, 0], gkDepth: [], moved: {} };
  for (let i = 0; i < 60 * 260 && !m.done; i++) {
    squad.update();
    m.step();
    if (m.state === 'playing') {
      const owner = m.ball.ownerId ? m.players.get(m.ball.ownerId) : null;
      if (owner) stats.poss[owner.team]++;
      for (const bot of squad.bots) {
        const p = m.players.get(bot.id);
        stats.moved[bot.id] = (stats.moved[bot.id] || 0) + Math.hypot(p.vx, p.vy) / 60;
        if (bot.role === 'gk') stats.gkDepth.push((p.x * (p.team === 0 ? 1 : -1) + m.hw) / (2 * m.hw));
      }
    }
    for (const e of m.events) {
      if (e.k === 'kick' && e.t === 'pass') stats.passes[[...m.players.values()].find((p) => p.idx === e.p).team]++;
    }
    m.events = [];
  }
  return { score: m.score, stats, squad };
}

function series(format, red, blue, seeds) {
  const total = [0, 0];
  for (const seed of seeds) {
    const { score } = play(format, red, blue, seed);
    total[0] += score[0];
    total[1] += score[1];
  }
  return total;
}

test('practice rosters: human plus bot teammates against a full bot team', () => {
  for (const [format, fmt] of Object.entries(PRACTICE_FORMATS)) {
    const setup = buildPractice({ format, level: 'hard', humanId: 'me', humanName: 'Me' });
    if (format === 'single') {
      assert.equal(setup.players.length, 1);
      assert.equal(setup.bots.length, 0);
      continue;
    }
    assert.equal(setup.players.length, fmt.size * 2, format);
    assert.equal(setup.players.filter((p) => p.team === 0).length, fmt.size);
    assert.equal(setup.bots.length, fmt.size * 2 - 1);
    const blueRoles = setup.bots.filter((b) => b.team === 1).map((b) => b.role);
    if (fmt.size >= 3) assert.equal(blueRoles.filter((r) => r === 'gk').length, 1, `${format} needs one keeper`);
  }
  assert.deepEqual(buildPractice({ format: '1v1', level: 'easy', humanId: 'me' }).bots.map((b) => b.role), ['solo']);
  assert.deepEqual(buildPractice({ format: '2v2', level: 'easy', humanId: 'me' }).bots.map((b) => b.role), ['sweeper', 'sweeper', 'fwd']);
  assert.ok(['4v4', '8v8'].every((f) => PRACTICE_FORMATS[f].mode === '3v3'), 'big formats reuse the 3v3 pitch');
});

test('2011 Barcelona bots carry the squad names', () => {
  const names = buildPractice({ format: '5v5', level: 'barcelona', humanId: 'me' }).players.filter((p) => p.team === 1).map((p) => p.name);
  assert.ok(names.includes('Valdés') && names.includes('Messi'), names.join(', '));
});

test('each difficulty beats the one below it', () => {
  const seeds = [11, 18];
  const intEasy = series('3v3', 'intermediate', 'easy', seeds);
  const hardInt = series('3v3', 'hard', 'intermediate', seeds);
  const barcaHard = series('3v3', 'barcelona', 'hard', seeds);
  assert.ok(intEasy[0] > intEasy[1] * 2, `intermediate vs easy ${intEasy}`);
  assert.ok(hardInt[0] > hardInt[1] * 2, `hard vs intermediate ${hardInt}`);
  assert.ok(barcaHard[0] > barcaHard[1] * 2, `barcelona vs hard ${barcaHard}`);
  const big = series('5v5', 'barcelona', 'hard', seeds);
  assert.ok(big[0] > big[1], `5v5 barcelona vs hard ${big}`);
});

test('Barcelona keeps the ball with lots of short passes', () => {
  const { stats } = play('5v5', 'barcelona', 'hard', 11);
  const possession = stats.poss[0] / (stats.poss[0] + stats.poss[1]);
  assert.ok(possession > 0.55, `possession ${possession}`);
  assert.ok(stats.passes[0] > stats.passes[1] * 1.5, `passes ${stats.passes}`);
});

test('keepers stay home and nobody stands frozen', () => {
  const { stats, squad } = play('5v5', 'hard', 'intermediate', 18);
  const gk = stats.gkDepth.reduce((a, b) => a + b, 0) / stats.gkDepth.length;
  assert.ok(gk < 0.08, `keepers averaged depth ${gk}`);
  for (const bot of squad.bots) {
    const min = bot.role === 'gk' ? 300 : 2000;
    assert.ok(stats.moved[bot.id] > min, `${bot.id} (${bot.role}) only moved ${stats.moved[bot.id]}`);
  }
});

test('a keeper gets across to stop a shot', () => {
  for (const level of ['hard', 'barcelona']) {
    const rng = seeded(5);
    const setup = buildPractice({ format: '3v3', level, teammateLevel: level });
    const m = new Match({ mode: setup.mode, players: setup.players, rng });
    const squad = new BotSquad(m, setup.bots, rng);
    while (m.state === 'countdown') {
      squad.update();
      m.step();
    }
    // Clear everyone else out of the way and fire a shot at the corner of blue's goal.
    for (const p of m.players.values()) {
      const bot = squad.bots.find((b) => b.id === p.id);
      if (bot.role !== 'gk') Object.assign(p, { x: 0, y: (p.team ? 1 : -1) * (m.hh - 40) + p.idx, vx: 0, vy: 0 });
    }
    for (let i = 0; i < 30; i++) {
      squad.update();
      m.step();
    }
    Object.assign(m.ball, { ownerId: null, x: m.hw - 450, y: 0, z: 0, vx: 1000, vy: 240, vz: 0, spin: 0 });
    for (let i = 0; i < 90 && m.state === 'playing'; i++) {
      squad.update();
      m.step();
    }
    assert.equal(m.score[0], 0, `${level} keeper let it in`);
  }
});
