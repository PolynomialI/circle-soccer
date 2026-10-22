import { ACTIONS } from './settings.js';

// Turns key presses into the input message the server expects and sends it whenever it changes.
export class Input {
  constructor(settings, send) {
    this.settings = settings;
    this.send = send;
    this.held = new Set(); // action ids currently held
    this.counters = { ps: 0, ds: 0, tk: 0 };
    this.enabled = false;
    this.last = '';
    this.chargeStart = { shoot: 0, lob: 0 };

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  actionFor(code) {
    const a = ACTIONS.find((x) => this.settings.binds[x.id] === code);
    return a ? a.id : null;
  }

  onKey(e, down) {
    if (!this.enabled) return;
    const action = this.actionFor(e.code);
    if (!action) return;
    e.preventDefault();
    if (down) {
      if (e.repeat || this.held.has(action)) return;
      this.held.add(action);
      if (action === 'pass') this.counters.ps++;
      if (action === 'dash') this.counters.ds++;
      if (action === 'tackle') this.counters.tk++;
      if (action === 'shoot' || action === 'lob') this.chargeStart[action] = performance.now();
    } else {
      this.held.delete(action);
    }
    this.flush();
  }

  axis(neg, pos) {
    return (this.held.has(pos) ? 1 : 0) - (this.held.has(neg) ? 1 : 0);
  }

  state() {
    return {
      mx: this.axis('moveLeft', 'moveRight'),
      my: this.axis('moveUp', 'moveDown'),
      ax: this.axis('aimLeft', 'aimRight'),
      ay: this.axis('aimUp', 'aimDown'),
      sh: this.held.has('shoot'),
      lb: this.held.has('lob'),
      ...this.counters,
    };
  }

  flush() {
    const s = this.state();
    const key = JSON.stringify(s);
    if (key === this.last) return;
    this.last = key;
    this.send(s);
  }

  // Local charge estimate so our own charge ring reacts instantly.
  localCharge(chargeTime) {
    for (const a of ['shoot', 'lob']) {
      if (this.held.has(a)) {
        return { type: a === 'shoot' ? 1 : 2, value: Math.min(1, (performance.now() - this.chargeStart[a]) / 1000 / chargeTime) };
      }
    }
    return null;
  }

  releaseAll() {
    if (this.held.size === 0) return;
    this.held.clear();
    if (this.enabled) this.flush();
  }

  // Called at the start of every match: the server expects counters to start at zero.
  reset() {
    this.held.clear();
    this.counters = { ps: 0, ds: 0, tk: 0 };
    this.last = '';
  }
}
