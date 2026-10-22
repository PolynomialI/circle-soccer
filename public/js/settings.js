// Key bindings and other per-player preferences, saved in localStorage.

export const ACTIONS = [
  { id: 'moveUp', label: 'Move up', key: 'KeyW' },
  { id: 'moveLeft', label: 'Move left', key: 'KeyA' },
  { id: 'moveDown', label: 'Move down', key: 'KeyS' },
  { id: 'moveRight', label: 'Move right', key: 'KeyD' },
  { id: 'aimUp', label: 'Aim up', key: 'ArrowUp' },
  { id: 'aimLeft', label: 'Aim left', key: 'ArrowLeft' },
  { id: 'aimDown', label: 'Aim down', key: 'ArrowDown' },
  { id: 'aimRight', label: 'Aim right', key: 'ArrowRight' },
  { id: 'shoot', label: 'Shoot (hold to charge)', key: 'Space' },
  { id: 'lob', label: 'Lob (hold to charge)', key: 'KeyQ' },
  { id: 'pass', label: 'Pass to teammate', key: 'KeyE' },
  { id: 'dash', label: 'Dash', key: 'ShiftLeft' },
  { id: 'tackle', label: 'Slide tackle', key: 'KeyF' },
];

const STORAGE_KEY = 'circleSoccer.settings';

function defaults() {
  return {
    binds: Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])),
    volume: 0.6,
    name: '',
  };
}

export function loadSettings() {
  const s = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.binds) {
      for (const a of ACTIONS) if (typeof saved.binds[a.id] === 'string') s.binds[a.id] = saved.binds[a.id];
    }
    if (typeof saved.volume === 'number') s.volume = saved.volume;
    if (typeof saved.name === 'string') s.name = saved.name;
  } catch {
    // Storage blocked or corrupt: fall back to defaults.
  }
  return s;
}

export function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Not fatal; settings just won't persist.
  }
}

export function resetBinds(s) {
  s.binds = defaults().binds;
}

// Binds a key to an action. If another action already uses that key the two swap,
// so no action is ever left without a key.
export function bindKey(s, actionId, code) {
  const other = ACTIONS.find((a) => a.id !== actionId && s.binds[a.id] === code);
  if (other) s.binds[other.id] = s.binds[actionId];
  s.binds[actionId] = code;
}

const NAMED = {
  Space: 'Space',
  ShiftLeft: 'L-Shift',
  ShiftRight: 'R-Shift',
  ControlLeft: 'L-Ctrl',
  ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt',
  AltRight: 'R-Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  CapsLock: 'Caps',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
