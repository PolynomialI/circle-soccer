import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { Input } = await import('../public/js/input.js');
const { ACTIONS } = await import('../public/js/settings.js');

function setup() {
  const settings = { binds: Object.fromEntries(ACTIONS.map((a) => [a.id, a.key])) };
  const input = new Input(settings, () => {});
  input.enabled = true;
  const key = (code, down) => input.onKey({ code, repeat: false, preventDefault() {} }, down);
  return { input, key };
}

test('the most recently pressed of two opposite keys wins', () => {
  const { input, key } = setup();
  key('KeyA', true);
  key('KeyW', true);
  assert.deepEqual([input.state().mx, input.state().my], [-1, -1]);
  key('KeyD', true);
  key('KeyS', true);
  assert.deepEqual([input.state().mx, input.state().my], [1, 1], 'D and S override A and W');
  key('KeyD', false);
  assert.equal(input.state().mx, -1, 'letting go of D falls back to the still-held A');
  key('KeyA', false);
  assert.equal(input.state().mx, 0);
});

test('aim keys follow the same rule', () => {
  const { input, key } = setup();
  key('ArrowLeft', true);
  key('ArrowRight', true);
  assert.equal(input.state().ax, 1);
  key('ArrowLeft', false);
  key('ArrowLeft', true);
  assert.equal(input.state().ax, -1, 'pressing left again takes over');
});
