import { loadSettings, saveSettings, resetBinds, bindKey, keyLabel, ACTIONS } from './settings.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Renderer, TEAMS } from './render.js';
import { renderHistory, weekSeries } from './history.js';

const INTERP_DELAY = 0.08; // seconds we render behind the newest snapshot, hides network jitter
const TEAM_SIZE = { '1v1': 1, '2v2': 2, '3v3': 3 };

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const sound = new Sound(settings.volume);
const socket = io({ transports: ['websocket', 'polling'] });
const renderer = new Renderer($('game'));
const input = new Input(settings, (s) => socket.emit('input', s));

const app = {
  myId: null,
  screen: 'menu',
  room: null,
  quickMode: null,
  match: null,
  ping: null,
  listening: null, // action id being rebound in settings
  pendingRoom: new URLSearchParams(location.search).get('room'),
};

// ---- screens & overlays ---------------------------------------------------------

function showScreen(name) {
  for (const id of ['menu', 'queue', 'room']) $(id).classList.toggle('hidden', id !== name);
  $('game').classList.toggle('hidden', name !== 'game');
  app.screen = name;
  refreshInput();
}

function overlayOpen() {
  return ['pause', 'settings', 'history'].some((id) => !$(id).classList.contains('hidden'));
}

function setOverlay(id, open) {
  $(id).classList.toggle('hidden', !open);
  refreshInput();
}

function refreshInput() {
  const on = app.screen === 'game' && app.match && !app.match.spectator && !overlayOpen();
  if (!on) input.releaseAll();
  input.enabled = !!on;
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3200);
}

function leaveToMenu() {
  socket.emit('leaveRoom');
  app.match = null;
  app.room = null;
  setOverlay('pause', false);
  $('result').classList.add('hidden');
  showScreen('menu');
}

// ---- menu --------------------------------------------------------------------------

$('name').value = settings.name;
$('name').addEventListener('change', () => {
  settings.name = $('name').value.trim();
  saveSettings(settings);
  socket.emit('hello', { name: settings.name });
});

function queueFor(mode) {
  app.quickMode = mode;
  socket.emit('queue', { mode });
  $('queue-mode').textContent = mode;
  $('queue-count').textContent = '';
  showScreen('queue');
}

document.querySelectorAll('[data-queue]').forEach((btn) => {
  btn.addEventListener('click', () => queueFor(btn.dataset.queue));
});
$('cancel-queue').addEventListener('click', () => {
  socket.emit('leaveQueue');
  showScreen('menu');
});
$('create-room').addEventListener('click', () => socket.emit('createRoom', { mode: $('create-mode').value }));
const joinByCode = () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length === 5) socket.emit('joinRoom', { code });
  else toast('Room codes are 5 characters.');
};
$('join-room').addEventListener('click', joinByCode);
$('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinByCode();
});

// ---- practice against bots ----------------------------------------------------------

function startPractice(practice) {
  socket.emit('startPractice', practice);
}
// Home team = your bot teammates (none in Singleplayer or 1v1); away team = the opponents.
const syncPracticeLevel = () => {
  const format = $('practice-format').value;
  $('practice-home').disabled = format === 'single' || format === '1v1';
  $('practice-away').disabled = format === 'single';
};
$('practice-format').addEventListener('change', syncPracticeLevel);
syncPracticeLevel();
$('start-practice').addEventListener('click', () => {
  startPractice({ format: $('practice-format').value, home: $('practice-home').value, level: $('practice-away').value });
});

// ---- private room lobby ------------------------------------------------------------

document.querySelectorAll('[data-team]').forEach((btn) => {
  btn.addEventListener('click', () => socket.emit('setTeam', { team: Number(btn.dataset.team) }));
});
$('room-mode').addEventListener('change', () => socket.emit('setMode', { mode: $('room-mode').value }));
$('start-match').addEventListener('click', () => socket.emit('startMatch'));
$('leave-room').addEventListener('click', leaveToMenu);
$('copy-link').addEventListener('click', async () => {
  const url = `${location.origin}/?room=${app.room.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied.');
  } catch {
    window.prompt('Copy this invite link:', url);
  }
});

function renderRoom(room) {
  const isHost = room.hostId === app.myId;
  const size = TEAM_SIZE[room.mode];
  $('room-code').textContent = room.code;
  $('room-mode').value = room.mode;
  $('room-mode').disabled = !isHost || room.inMatch;

  const lists = { 0: $('team-0'), 1: $('team-1'), [-1]: $('team-spec') };
  for (const ul of Object.values(lists)) ul.replaceChildren();
  const counts = { 0: 0, 1: 0, [-1]: 0 };
  for (const m of room.members) {
    const li = document.createElement('li');
    li.textContent = `${m.id === room.hostId ? '★ ' : ''}${m.name}${m.id === app.myId ? ' (you)' : ''}`;
    if (m.id === app.myId) li.classList.add('me');
    lists[m.team].appendChild(li);
    counts[m.team]++;
  }
  const mine = room.members.find((m) => m.id === app.myId);
  document.querySelectorAll('[data-team]').forEach((btn) => {
    const t = Number(btn.dataset.team);
    btn.disabled = room.inMatch || (mine && mine.team === t) || (t !== -1 && counts[t] >= size);
  });
  $('start-match').classList.toggle('hidden', !isHost);
  $('start-match').disabled = room.inMatch || counts[0] + counts[1] === 0;
  $('room-hint').textContent = room.inMatch
    ? 'A match is in progress.'
    : isHost
      ? `Share the code or invite link. Teams hold ${size} each. Start whenever you're ready.`
      : 'Pick a team. The host (★) starts the match.';
}

// ---- match -------------------------------------------------------------------------

function startMatch({ init, roster, spectator }) {
  const meEntry = roster.find((r) => r.id === app.myId);
  app.match = {
    init,
    roster: new Map(roster.map((r) => [r.idx, r])),
    spectator,
    me: meEntry ? meEntry.idx : -1,
    myTeam: meEntry ? meEntry.team : -1,
    snaps: [],
    renderTime: null,
    lastTick: -1,
  };
  renderer.setMatch(init);
  input.reset();
  $('result').classList.add('hidden');
  setOverlay('pause', false);
  showScreen('game');
}

const lerp = (a, b, t) => a + (b - a) * t;

function buildView(m, dt) {
  const snaps = m.snaps;
  if (!snaps.length) return null;
  const rate = m.init.tickRate;
  const target = snaps[snaps.length - 1].t / rate - INTERP_DELAY;
  if (m.renderTime === null || Math.abs(target - m.renderTime) > 0.5) {
    // First frame or resync (e.g. the tab was in the background): skip stale events.
    m.renderTime = target;
    for (const s of snaps) if (s.t / rate <= target) m.lastTick = Math.max(m.lastTick, s.t);
  } else {
    m.renderTime += dt + (target - m.renderTime) * 0.08;
  }

  let i = snaps.length - 1;
  while (i > 0 && snaps[i].t / rate > m.renderTime) i--;
  const a = snaps[i];
  const b = snaps[i + 1] || a;
  const ta = a.t / rate;
  const tb = b.t / rate;
  const t = tb > ta ? Math.min(1, Math.max(0, (m.renderTime - ta) / (tb - ta))) : 0;

  const prevPlayers = new Map(a.p.map((p) => [p[0], p]));
  const players = b.p.map((pb) => {
    const pa = prevPlayers.get(pb[0]) || pb;
    let aimX = lerp(pa[5], pb[5], t);
    let aimY = lerp(pa[6], pb[6], t);
    const al = Math.hypot(aimX, aimY) || 1;
    aimX /= al;
    aimY /= al;
    return {
      idx: pb[0], x: lerp(pa[1], pb[1], t), y: lerp(pa[2], pb[2], t), vx: pb[3], vy: pb[4],
      aimX, aimY, r: lerp(pa[7], pb[7], t), ct: pb[8], charge: pb[9], stamina: pb[10], state: pb[11], fx: pb[12],
    };
  });
  const view = {
    st: a.st,
    tm: lerp(a.tm, b.st === a.st ? b.tm : a.tm, t),
    clk: lerp(a.clk, b.clk, t),
    ot: a.ot,
    sc: a.sc,
    ball: {
      x: lerp(a.b[0], b.b[0], t), y: lerp(a.b[1], b.b[1], t), z: lerp(a.b[2], b.b[2], t),
      vx: b.b[3], vy: b.b[4], spin: b.b[5], owner: b.b[6],
    },
    players,
    powerups: a.pu.map((pu) => ({ id: pu[0], type: m.init.powerupTypes[pu[1]], x: pu[2], y: pu[3], ttl: pu[4] })),
  };

  // Fire each snapshot's events once its moment comes up on screen.
  for (const s of snaps) {
    if (s.t / rate <= m.renderTime && s.t > m.lastTick) {
      m.lastTick = s.t;
      for (const ev of s.ev) renderer.onEvent(ev, view, m, sound);
    }
  }
  while (snaps.length > 2 && snaps[1].t / rate < m.renderTime - 1) snaps.shift();
  return view;
}

function showResult({ result, quick, practice }) {
  const m = app.match;
  const myTeam = m ? m.myTeam : -1;
  const w = result.winner;
  let title;
  if (w === -1) title = 'No result';
  else if (myTeam === -1) title = `${TEAMS[w].name} wins!`;
  else title = w === myTeam ? 'Victory!' : 'Defeat';
  if (w !== -1 && result.forfeit) title += ' (forfeit)';
  $('result-title').textContent = title;
  const red = document.createElement('span');
  red.className = 'r';
  red.textContent = result.score[0];
  const blue = document.createElement('span');
  blue.className = 'b';
  blue.textContent = result.score[1];
  $('result-score').replaceChildren(red, ' – ', blue);

  const ul = $('result-goals');
  ul.replaceChildren();
  for (const g of result.goals) {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 't';
    time.textContent = `${Math.floor(g.time / 60)}:${String(g.time % 60).padStart(2, '0')}`;
    const who = document.createElement('span');
    who.style.color = TEAMS[g.team].light;
    who.textContent = g.own ? `${g.scorer} (own goal)` : `${g.scorer || 'Unknown'}${g.assist ? ` · assist ${g.assist}` : ''}`;
    li.append(time, who);
    ul.appendChild(li);
  }

  const actions = $('result-actions');
  actions.replaceChildren();
  const button = (label, primary, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', onClick);
    actions.appendChild(b);
  };
  if (practice) {
    button('Play again', true, () => {
      $('result').classList.add('hidden');
      app.match = null;
      startPractice(practice);
    });
    button('Main menu', false, leaveToMenu);
  } else if (quick) {
    button('Play again', true, () => {
      $('result').classList.add('hidden');
      app.match = null;
      queueFor(app.quickMode || m.init.mode);
    });
    button('Main menu', false, leaveToMenu);
  } else {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Back to the room in a few seconds…';
    actions.appendChild(p);
    button('Leave room', false, leaveToMenu);
  }
  setOverlay('pause', false);
  $('result').classList.remove('hidden');
}

// ---- socket ------------------------------------------------------------------------

socket.on('connect', () => {
  $('conn').textContent = 'Connected';
});

socket.on('welcome', (data) => {
  app.myId = data.id;
  if (settings.name) socket.emit('hello', { name: settings.name });
  else $('name').value = data.name;
  if (app.pendingRoom) {
    socket.emit('joinRoom', { code: app.pendingRoom });
    app.pendingRoom = null;
    history.replaceState(null, '', location.pathname);
  }
});

socket.on('disconnect', () => {
  $('conn').textContent = 'Disconnected, reconnecting…';
  if (app.screen !== 'menu') toast('Lost connection to the server. Reconnecting…');
  app.match = null;
  app.room = null;
  $('result').classList.add('hidden');
  setOverlay('pause', false);
  showScreen('menu');
});

socket.on('notice', ({ msg }) => toast(msg));

socket.on('queueStatus', ({ mode, count, needed }) => {
  $('queue-mode').textContent = mode;
  $('queue-count').textContent = `${count} / ${needed} players`;
});

socket.on('room', (room) => {
  app.room = room;
  renderRoom(room);
  if (!room.inMatch && app.screen !== 'room') {
    // Either we just made/joined the room or the match finished: back to the lobby.
    app.match = null;
    $('result').classList.add('hidden');
    setOverlay('pause', false);
    showScreen('room');
  }
});

socket.on('matchStart', startMatch);

socket.on('roster', (roster) => {
  if (!app.match) return;
  app.match.roster = new Map(roster.map((r) => [r.idx, r]));
});

socket.on('snap', (snap) => {
  if (!app.match) return;
  const snaps = app.match.snaps;
  if (snaps.length && snap.t <= snaps[snaps.length - 1].t) return;
  snaps.push(snap);
  if (snaps.length > 90) snaps.shift(); // rendering pauses in background tabs
});

socket.on('matchEnd', showResult);

// ---- player history -----------------------------------------------------------------

function setLive({ online, privRooms }) {
  $('online-now').textContent = online;
  $('online-word').textContent = online === 1 ? 'player' : 'players';
  $('h-rooms-now').textContent = privRooms;
}

socket.on('online', setLive);

$('open-history').addEventListener('click', () => {
  setOverlay('history', true);
  socket.emit('history', (data) => {
    const points = weekSeries(data);
    setLive(data.live);
    $('h-peak').textContent = Math.max(data.live.online, ...points.map((p) => p.o));
    $('h-rooms-week').textContent = points.reduce((n, p) => n + p.c, 0);
    $('history-note').classList.toggle('hidden', data.persistent);
    renderHistory($('history-chart'), points);
  });
});
$('close-history').addEventListener('click', () => setOverlay('history', false));

setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.emit('latency', () => {
    app.ping = Math.round(performance.now() - t0);
  });
}, 2000);

// ---- settings ----------------------------------------------------------------------

function renderBinds() {
  const table = $('binds');
  table.replaceChildren();
  for (const a of ACTIONS) {
    const tr = document.createElement('tr');
    const label = document.createElement('td');
    label.textContent = a.label;
    const cell = document.createElement('td');
    const b = document.createElement('button');
    const listening = app.listening === a.id;
    b.textContent = listening ? 'Press a key…' : keyLabel(settings.binds[a.id]);
    b.classList.toggle('listening', listening);
    b.addEventListener('click', () => {
      app.listening = a.id;
      renderBinds();
    });
    cell.appendChild(b);
    tr.append(label, cell);
    table.appendChild(tr);
  }
}

function openSettings() {
  app.listening = null;
  renderBinds();
  $('volume').value = settings.volume;
  setOverlay('settings', true);
}

$('open-settings').addEventListener('click', openSettings);
$('pause-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', () => {
  app.listening = null;
  setOverlay('settings', false);
});
$('reset-binds').addEventListener('click', () => {
  resetBinds(settings);
  saveSettings(settings);
  app.listening = null;
  renderBinds();
});
$('volume').addEventListener('input', () => {
  settings.volume = Number($('volume').value);
  sound.setVolume(settings.volume);
  saveSettings(settings);
});
$('resume').addEventListener('click', () => setOverlay('pause', false));
$('leave-match').addEventListener('click', leaveToMenu);

// Rebinding listens in the capture phase so the key never reaches the game.
window.addEventListener('keydown', (e) => {
  if (!app.listening) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.code !== 'Escape') {
    bindKey(settings, app.listening, e.code);
    saveSettings(settings);
  }
  app.listening = null;
  renderBinds();
}, true);

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || app.listening) return;
  if (!$('settings').classList.contains('hidden')) setOverlay('settings', false);
  else if (!$('history').classList.contains('hidden')) setOverlay('history', false);
  else if (app.screen === 'game' && $('result').classList.contains('hidden')) {
    setOverlay('pause', $('pause').classList.contains('hidden'));
  }
});

// Browsers only allow audio after a user gesture.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => sound.unlock());

renderBinds();

// ---- render loop -------------------------------------------------------------------

let lastFrame = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const m = app.match;
  if (app.screen === 'game' && m) {
    const view = buildView(m, dt);
    if (view) {
      const me = view.players.find((p) => p.idx === m.me);
      const canCharge = me && view.st === 'playing' && (me.state === 0 || me.state === 3);
      renderer.draw(view, {
        roster: m.roster,
        me: m.me,
        spectator: m.spectator,
        ping: app.ping,
        localCharge: m.spectator ? undefined : canCharge ? input.localCharge(m.init.chargeTime) : null,
      }, dt);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
