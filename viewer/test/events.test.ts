import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Emitter } from '../src/events.ts';

interface Events {
  ping: { value: number };
  pong: string;
}

test('on() delivers the payload of its own event only', () => {
  const emitter = new Emitter<Events>();
  const seen: number[] = [];
  emitter.on('ping', ({ value }) => seen.push(value));

  emitter.emit('ping', { value: 1 });
  emitter.emit('pong', 'ignored');

  assert.deepEqual(seen, [1]);
});

test('the function returned by on() unsubscribes that handler', () => {
  const emitter = new Emitter<Events>();
  let calls = 0;
  const off = emitter.on('pong', () => calls++);

  off();
  emitter.emit('pong', 'x');

  assert.equal(calls, 0);
});

test('a listener that throws does not stop the other listeners', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const emitter = new Emitter<Events>();
  let reached = false;
  emitter.on('pong', () => {
    throw new Error('boom');
  });
  emitter.on('pong', () => {
    reached = true;
  });

  emitter.emit('pong', 'x');

  assert.equal(reached, true);
  assert.equal(logged.mock.callCount(), 1);
});

test('clear() removes every listener', () => {
  const emitter = new Emitter<Events>();
  let calls = 0;
  emitter.on('ping', () => calls++);

  emitter.clear();
  emitter.emit('ping', { value: 1 });

  assert.equal(calls, 0);
});
