import { MODES, QUICKPLAY_MODES, PRIVATE_MODES, PRACTICE_FORMATS, DT, SNAPSHOT_EVERY } from './config.js';
import { Match } from './match.js';
import { buildPractice, BotSquad, BOT_LEVELS } from './bots.js';
import { PlayerHistory } from './history.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOM_MEMBERS = 16;
const SPECTATOR = -1;
const PRACTICE_LABELS = { easy: 'Easy', intermediate: 'Intermediate', hard: 'Hard', barcelona: '2011 Barcelona' };

function cleanName(name) {
  const s = typeof name === 'string' ? name.replace(/[^\p{L}\p{N} _.\-!?]/gu, '').trim().slice(0, 16) : '';
  return s || `Player${Math.floor(Math.random() * 900 + 100)}`;
}

// Matchmaking queues, private rooms and the fixed-rate loop that drives every match.
export class Lobby {
  constructor(io, { history = new PlayerHistory() } = {}) {
    this.io = io;
    this.history = history;
    this.clients = new Map(); // socket id -> { socket, name, room, queue }
    this.rooms = new Map(); // code -> room
    this.queues = Object.fromEntries(QUICKPLAY_MODES.map((m) => [m, []]));
    this.statsTimer = null;
    io.on('connection', (socket) => this.onConnection(socket));
  }

  start() {
    let last = performance.now();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      if (acc > 0.25) acc = 0.25; // don't spiral after a stall
      while (acc >= DT) {
        acc -= DT;
        this.tick();
      }
    }, 4);
    // Sample player counts regularly (changes also trigger a sample) and save once a minute.
    this.sampleTimer = setInterval(() => this.history.record(this.stats()), 30 * 1000);
    this.flushTimer = setInterval(() => this.history.flush().catch((e) => console.error('History save failed:', e.message)), 60 * 1000);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.sampleTimer);
    clearInterval(this.flushTimer);
    clearTimeout(this.statsTimer);
  }

  stats() {
    const s = { online: this.clients.size, quick: 0, priv: 0, privRooms: 0, practice: 0 };
    for (const room of this.rooms.values()) {
      if (room.practice) s.practice += room.members.size;
      else if (room.isPrivate) {
        s.priv += room.members.size;
        s.privRooms++;
      } else s.quick += room.members.size;
    }
    return s;
  }

  // Counts changed: record them and tell everyone (at most once a second).
  statsChanged() {
    if (this.statsTimer) return;
    this.statsTimer = setTimeout(() => {
      this.statsTimer = null;
      const s = this.stats();
      this.history.record(s);
      this.io.emit('online', { online: s.online, privRooms: s.privRooms });
    }, 1000);
  }

  tick() {
    for (const room of this.rooms.values()) {
      const match = room.match;
      if (!match) continue;
      if (room.bots) room.bots.update();
      match.step();
      if (match.tick % SNAPSHOT_EVERY === 0) this.io.to(room.channel).volatile.emit('snap', match.snapshot());
      // Matches can also end outside step() (a forfeit), so announce on the first tick we see it.
      if (match.state === 'ended' && !match.endAnnounced) {
        match.endAnnounced = true;
        this.io.to(room.channel).emit('snap', match.snapshot());
        this.io.to(room.channel).emit('matchEnd', { result: match.result, quick: !room.isPrivate, practice: room.practice || null });
      }
      if (match.done) this.finishMatch(room);
    }
  }

  onConnection(socket) {
    const client = { socket, name: cleanName(), room: null, queue: null };
    this.clients.set(socket.id, client);
    socket.emit('welcome', { id: socket.id, name: client.name });
    this.statsChanged();

    socket.on('hello', (data) => {
      client.name = cleanName(data && data.name);
    });
    socket.on('queue', (data) => this.joinQueue(client, data && data.mode));
    socket.on('leaveQueue', () => this.leaveQueue(client));
    socket.on('createRoom', (data) => this.createPrivateRoom(client, data && data.mode));
    socket.on('joinRoom', (data) => this.joinPrivateRoom(client, data && data.code));
    socket.on('leaveRoom', () => this.leaveRoom(client));
    socket.on('setTeam', (data) => this.setTeam(client, data && data.team));
    socket.on('setMode', (data) => this.setMode(client, data && data.mode));
    socket.on('startMatch', () => this.startPrivateMatch(client));
    socket.on('startPractice', (data) => this.startPractice(client, data && data.format, data && data.level));
    socket.on('history', (cb) => {
      if (typeof cb !== 'function') return;
      const s = this.stats();
      cb({ ...this.history.snapshot(), live: { online: s.online, privRooms: s.privRooms } });
    });
    socket.on('input', (msg) => {
      const room = client.room;
      if (room && room.match) room.match.handleInput(socket.id, msg);
    });
    socket.on('latency', (cb) => {
      if (typeof cb === 'function') cb();
    });
    socket.on('disconnect', () => {
      this.leaveQueue(client);
      this.leaveRoom(client);
      this.clients.delete(socket.id);
      this.statsChanged();
    });
  }

  notice(client, msg) {
    client.socket.emit('notice', { msg });
  }

  // ---- quick play -------------------------------------------------------------

  joinQueue(client, mode) {
    if (!QUICKPLAY_MODES.includes(mode)) return;
    this.leaveQueue(client);
    this.leaveRoom(client);
    const queue = this.queues[mode];
    queue.push(client);
    client.queue = mode;
    const needed = MODES[mode].teamSize * 2;
    if (queue.length >= needed) {
      const group = queue.splice(0, needed);
      for (const c of group) c.queue = null;
      this.startQuickMatch(mode, group);
    }
    this.broadcastQueue(mode);
  }

  leaveQueue(client) {
    const mode = client.queue;
    if (!mode) return;
    const queue = this.queues[mode];
    const i = queue.indexOf(client);
    if (i >= 0) queue.splice(i, 1);
    client.queue = null;
    this.broadcastQueue(mode);
  }

  broadcastQueue(mode) {
    const queue = this.queues[mode];
    const needed = MODES[mode].teamSize * 2;
    for (const c of queue) c.socket.emit('queueStatus', { mode, count: queue.length, needed });
  }

  startQuickMatch(mode, group) {
    const room = this.makeRoom(mode, false);
    // Shuffle, then alternate teams.
    const shuffled = [...group].sort(() => Math.random() - 0.5);
    shuffled.forEach((c, i) => this.addMember(room, c, i % 2));
    this.beginMatch(room);
  }

  // ---- private rooms ---------------------------------------------------------

  createPrivateRoom(client, mode) {
    if (!PRIVATE_MODES.includes(mode)) mode = '2v2';
    this.leaveQueue(client);
    this.leaveRoom(client);
    const room = this.makeRoom(mode, true);
    room.hostId = client.socket.id;
    this.addMember(room, client, 0);
    this.history.roomCreated();
    this.broadcastRoom(room);
  }

  // ---- practice against bots -------------------------------------------------------

  startPractice(client, format, level) {
    if (!PRACTICE_FORMATS[format]) format = '1v1';
    if (!BOT_LEVELS[level]) level = 'intermediate';
    this.leaveQueue(client);
    this.leaveRoom(client);
    const setup = buildPractice({ format, level, humanId: client.socket.id, humanName: client.name });
    const room = this.makeRoom(setup.mode, false);
    room.practice = { format, level };
    this.addMember(room, client, 0);
    room.match = new Match({ mode: setup.mode, players: setup.players });
    room.bots = new BotSquad(room.match, setup.bots);
    const what = format === 'single' ? 'Singleplayer' : `${format} · ${PRACTICE_LABELS[level]}`;
    const init = { ...room.match.initPayload(), label: `Practice · ${what}` };
    client.socket.emit('matchStart', { init, roster: room.match.roster(), spectator: false });
  }

  joinPrivateRoom(client, code) {
    const room = typeof code === 'string' ? this.rooms.get(code.trim().toUpperCase()) : null;
    if (!room || !room.isPrivate) {
      this.notice(client, 'Room not found. Check the code and try again.');
      return;
    }
    if (client.room === room) return;
    if (room.members.size >= MAX_ROOM_MEMBERS) {
      this.notice(client, 'That room is full.');
      return;
    }
    this.leaveQueue(client);
    this.leaveRoom(client);
    const team = room.match ? SPECTATOR : this.openTeam(room);
    this.addMember(room, client, team);
    if (room.match) {
      client.socket.emit('matchStart', { init: room.match.initPayload(), roster: room.match.roster(), spectator: true });
    }
    this.broadcastRoom(room);
  }

  openTeam(room) {
    const size = MODES[room.mode].teamSize;
    const counts = this.teamCounts(room);
    if (counts[0] <= counts[1] && counts[0] < size) return 0;
    if (counts[1] < size) return 1;
    if (counts[0] < size) return 0;
    return SPECTATOR;
  }

  teamCounts(room) {
    const counts = [0, 0];
    for (const m of room.members.values()) if (m.team !== SPECTATOR) counts[m.team]++;
    return counts;
  }

  setTeam(client, team) {
    const room = client.room;
    if (!room || !room.isPrivate || room.match) return;
    if (![0, 1, SPECTATOR].includes(team)) return;
    const member = room.members.get(client.socket.id);
    if (member.team === team) return;
    if (team !== SPECTATOR && this.teamCounts(room)[team] >= MODES[room.mode].teamSize) {
      this.notice(client, 'That team is full.');
      return;
    }
    member.team = team;
    this.broadcastRoom(room);
  }

  setMode(client, mode) {
    const room = client.room;
    if (!room || !room.isPrivate || room.match || room.hostId !== client.socket.id) return;
    if (!PRIVATE_MODES.includes(mode)) return;
    room.mode = mode;
    // Bump anyone who no longer fits to spectator.
    const size = MODES[mode].teamSize;
    const counts = [0, 0];
    for (const m of room.members.values()) {
      if (m.team === SPECTATOR) continue;
      if (counts[m.team] >= size) m.team = SPECTATOR;
      else counts[m.team]++;
    }
    this.broadcastRoom(room);
  }

  startPrivateMatch(client) {
    const room = client.room;
    if (!room || !room.isPrivate || room.match || room.hostId !== client.socket.id) return;
    const counts = this.teamCounts(room);
    if (counts[0] + counts[1] === 0) {
      this.notice(client, 'Someone needs to join a team first.');
      return;
    }
    this.beginMatch(room);
    this.broadcastRoom(room);
  }

  // ---- shared room plumbing ----------------------------------------------------

  makeRoom(mode, isPrivate) {
    let code;
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = { code, channel: `room:${code}`, mode, isPrivate, hostId: null, members: new Map(), match: null };
    this.rooms.set(code, room);
    return room;
  }

  addMember(room, client, team) {
    room.members.set(client.socket.id, { client, team });
    client.room = room;
    client.socket.join(room.channel);
    this.statsChanged();
  }

  leaveRoom(client) {
    const room = client.room;
    if (!room) return;
    room.members.delete(client.socket.id);
    client.room = null;
    client.socket.leave(room.channel);
    this.statsChanged();
    if (room.match) {
      room.match.removePlayer(client.socket.id);
      this.io.to(room.channel).emit('roster', room.match.roster());
    }
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === client.socket.id) room.hostId = room.members.keys().next().value;
    if (room.isPrivate) this.broadcastRoom(room);
  }

  beginMatch(room) {
    const players = [];
    for (const [id, m] of room.members) {
      if (m.team !== SPECTATOR) players.push({ id, name: m.client.name, team: m.team });
    }
    room.match = new Match({ mode: room.mode, players });
    const init = room.match.initPayload();
    const roster = room.match.roster();
    for (const [, m] of room.members) {
      m.client.socket.emit('matchStart', { init, roster, spectator: m.team === SPECTATOR });
    }
  }

  finishMatch(room) {
    room.match = null;
    room.bots = null;
    if (room.isPrivate) {
      this.broadcastRoom(room);
      return;
    }
    // Quick play rooms dissolve once the result screen has had its time.
    for (const m of room.members.values()) {
      m.client.room = null;
      m.client.socket.leave(room.channel);
    }
    this.rooms.delete(room.code);
    this.statsChanged();
  }

  broadcastRoom(room) {
    const payload = {
      code: room.code,
      mode: room.mode,
      hostId: room.hostId,
      inMatch: !!room.match,
      members: [...room.members].map(([id, m]) => ({ id, name: m.client.name, team: m.team })),
    };
    this.io.to(room.channel).emit('room', payload);
  }
}
