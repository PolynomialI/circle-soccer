import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { createGameServer } from '../server/index.js';

let server;
let url;
const sockets = [];

before(async () => {
  server = createGameServer();
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${server.httpServer.address().port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  server.lobby.stop();
  server.io.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
});

function waitFor(socket, event, predicate = () => true, ms = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for ${event}`));
    }, ms);
    function handler(data) {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

async function player(name) {
  const s = connect(url, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  const welcome = await waitFor(s, 'welcome');
  s.id_ = welcome.id;
  s.emit('hello', { name });
  return s;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('queues, quick matches and private rooms all run at the same time', async () => {
  // Two separate 1v1 matches from one queue.
  const duel = await Promise.all(['A1', 'A2', 'A3', 'A4'].map(player));
  const duelStarts = duel.map((s) => waitFor(s, 'matchStart'));
  for (const s of duel) s.emit('queue', { mode: '1v1' });
  const duelMatches = await Promise.all(duelStarts);
  for (const m of duelMatches) assert.equal(m.roster.length, 2);
  const pairs = new Set(duelMatches.map((m) => m.roster.map((r) => r.id).sort().join('|')));
  assert.equal(pairs.size, 2, 'four 1v1 players should be split into two different matches');

  // A 2v2 match alongside them.
  const squad = await Promise.all(['B1', 'B2', 'B3', 'B4'].map(player));
  const squadStarts = squad.map((s) => waitFor(s, 'matchStart'));
  for (const s of squad) s.emit('queue', { mode: '2v2' });
  const squadMatch = await Promise.all(squadStarts);
  assert.equal(squadMatch[0].roster.length, 4);
  assert.deepEqual(
    squadMatch[0].roster.map((r) => r.team).sort(),
    [0, 0, 1, 1],
  );

  // A private 3v3 room with players who pick teams.
  const host = await player('Host');
  const roomMsg = waitFor(host, 'room');
  host.emit('createRoom', { mode: '3v3' });
  const room = await roomMsg;
  assert.equal(room.mode, '3v3');
  const friend = await player('Friend');
  const joined = waitFor(friend, 'room');
  friend.emit('joinRoom', { code: room.code.toLowerCase() });
  const afterJoin = await joined;
  assert.equal(afterJoin.members.length, 2);
  assert.equal(afterJoin.members.find((m) => m.id === friend.id_).team, 1, 'joiners balance onto the smaller team');
  const switched = waitFor(host, 'room', (r) => r.members.some((m) => m.id === friend.id_ && m.team === 0));
  friend.emit('setTeam', { team: 0 });
  await switched;

  // Someone waiting in the 1v1 queue meanwhile.
  const waiting = await player('Waiting');
  const status = waitFor(waiting, 'queueStatus');
  waiting.emit('queue', { mode: '1v1' });
  assert.deepEqual(await status, { mode: '1v1', count: 1, needed: 2 });

  const privateStarts = [host, friend].map((s) => waitFor(s, 'matchStart'));
  host.emit('startMatch');
  const privateMatch = await Promise.all(privateStarts);
  assert.equal(privateMatch[0].roster.length, 2);
  assert.equal(privateMatch[0].init.mode, '3v3');

  // A late joiner becomes a spectator of the running private match.
  const late = await player('Late');
  const spectate = waitFor(late, 'matchStart');
  late.emit('joinRoom', { code: room.code });
  assert.equal((await spectate).spectator, true);

  // Every match streams its own snapshots at the same time.
  const everyone = [...duel, ...squad, host, friend, late];
  const counts = new Map(everyone.map((s) => [s, []]));
  for (const s of everyone) s.on('snap', (snap) => counts.get(s).push(snap));
  await sleep(500);
  for (const [s, snaps] of counts) {
    assert.ok(snaps.length >= 8, `client got only ${snaps.length} snapshots`);
    const expected = duel.includes(s) ? 2 : squad.includes(s) ? 4 : 2;
    assert.equal(snaps.at(-1).p.length, expected, 'snapshots must come from the client\'s own match');
  }

  // Input in one match does not leak into another: wait out the countdown, then run right.
  await sleep(2700);
  const mover = duel[0];
  const myIdx = duelMatches[0].roster.find((r) => r.id === mover.id_).idx;
  const before = (await waitFor(mover, 'snap')).p.find((p) => p[0] === myIdx)[1];
  mover.emit('input', { mx: 1, my: 0, ax: 0, ay: 0, sh: false, lb: false, ps: 0, ds: 0, tk: 0 });
  await sleep(400);
  const moved = (await waitFor(mover, 'snap')).p.find((p) => p[0] === myIdx)[1];
  assert.ok(moved - before > 40, `player should have run right (moved ${moved - before})`);
  const squadSnap = await waitFor(squad[0], 'snap');
  for (const p of squadSnap.p) assert.equal(p[3], 0, '2v2 players should be untouched');

  // Leaving a quick match forfeits it for the remaining player only.
  const opponent = duel.find((s) => s !== mover && duelMatches[duel.indexOf(s)].roster.some((r) => r.id === mover.id_));
  const end = waitFor(opponent, 'matchEnd');
  mover.emit('leaveRoom');
  const { result, quick } = await end;
  assert.equal(quick, true);
  assert.equal(result.forfeit, true);
  const otherDuel = duel.find((s) => s !== mover && s !== opponent);
  const stillRunning = await waitFor(otherDuel, 'snap', (s) => s.st !== 'ended');
  assert.ok(stillRunning, 'the other 1v1 keeps going');
});

test('bad room codes get a friendly notice', async () => {
  const s = await player('Lost');
  const notice = waitFor(s, 'notice');
  s.emit('joinRoom', { code: 'ZZZZZ' });
  assert.match((await notice).msg, /not found/i);
});

test('host leaving hands the room to someone else', async () => {
  const host = await player('H');
  const created = waitFor(host, 'room');
  host.emit('createRoom', { mode: '1v1' });
  const room = await created;
  const guest = await player('G');
  const joined = waitFor(guest, 'room');
  guest.emit('joinRoom', { code: room.code });
  await joined;
  const handed = waitFor(guest, 'room', (r) => r.hostId === guest.id_);
  host.emit('leaveRoom');
  const r = await handed;
  assert.equal(r.members.length, 1);
});
