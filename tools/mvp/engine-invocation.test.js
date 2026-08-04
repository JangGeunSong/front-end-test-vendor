const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createEngineInvocationRequest,
  invokeEngineProcess,
} = require('./engine-invocation');

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function request(overrides = {}) {
  return {
    command: 'engine-command',
    args: ['--mode', 'plan'],
    cwd: 'C:\\workspace',
    env: { BASELINE: 'yes' },
    ...overrides,
  };
}

test('collects successful stdout and stderr with a zero exit', async () => {
  const child = createChild();
  const resultPromise = invokeEngineProcess(request(), {
    spawnImpl: () => child,
  });
  child.stdout.emit('data', Buffer.from('analysis complete'));
  child.stderr.emit('data', Buffer.from('diagnostic'));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'analysis complete');
  assert.equal(result.stderr, 'diagnostic');
  assert.equal(result.spawnError, null);
});

test('preserves non-zero exit output without converting it to a spawn failure', async () => {
  const child = createChild();
  const resultPromise = invokeEngineProcess(request(), { spawnImpl: () => child });
  child.stdout.emit('data', 'partial output');
  child.stderr.emit('data', 'validation failed');
  child.emit('close', 7, null);
  const result = await resultPromise;
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, 'partial output');
  assert.equal(result.stderr, 'validation failed');
  assert.equal(result.spawnError, null);
});

test('distinguishes spawn failure and settles only once when close follows error', async () => {
  const child = createChild();
  const spawnError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
  const resultPromise = invokeEngineProcess(request(), { spawnImpl: () => child });
  child.emit('error', spawnError);
  child.emit('close', -1, null);
  const result = await resultPromise;
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, null);
  assert.equal(result.spawnError, spawnError);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('close'), 0);
});

test('distinguishes signal termination from a numeric exit code', async () => {
  const child = createChild();
  const resultPromise = invokeEngineProcess(request(), { spawnImpl: () => child });
  child.emit('close', null, 'SIGTERM');
  const result = await resultPromise;
  assert.equal(result.exitCode, null);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.spawnError, null);
});

test('combines chunked stdout and stderr in emission order', async () => {
  const child = createChild();
  const resultPromise = invokeEngineProcess(request(), { spawnImpl: () => child });
  child.stdout.emit('data', Buffer.from('one'));
  child.stdout.emit('data', Buffer.from('-two'));
  child.stderr.emit('data', Buffer.from('three'));
  child.stderr.emit('data', Buffer.from('-four'));
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.stdout, 'one-two');
  assert.equal(result.stderr, 'three-four');
});

test('copies parent environment and applies explicit overrides without exposing env in results', async () => {
  const parentEnv = { KEEP: 'parent', OVERRIDE: 'parent' };
  const overrides = { OVERRIDE: 'child', ADDED: 'child' };
  const invocation = createEngineInvocationRequest({
    command: 'python.exe',
    args: ['engine.py'],
    cwd: 'C:\\repo',
    env: overrides,
  }, { parentEnv });
  assert.deepEqual(invocation.env, { KEEP: 'parent', OVERRIDE: 'child', ADDED: 'child' });
  assert.notEqual(invocation.env, parentEnv);
  assert.notEqual(invocation.env, overrides);

  const child = createChild();
  let spawnOptions;
  const resultPromise = invokeEngineProcess(invocation, {
    spawnImpl: (command, args, options) => {
      assert.equal(command, 'python.exe');
      assert.deepEqual(args, ['engine.py']);
      spawnOptions = options;
      return child;
    },
  });
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.deepEqual(spawnOptions.env, invocation.env);
  assert.equal(Object.hasOwn(result, 'env'), false);
});

test('converts a synchronous spawn throw into a spawn failure result', async () => {
  const spawnError = new Error('spawn implementation failed');
  const result = await invokeEngineProcess(request(), {
    spawnImpl: () => { throw spawnError; },
  });
  assert.equal(result.spawnError, spawnError);
  assert.equal(result.exitCode, null);
});

test('invokes a real child directly without a shell', async () => {
  const invocation = createEngineInvocationRequest({
    command: process.execPath,
    args: ['-e', "process.stdout.write('real-out'); process.stderr.write('real-err')"],
    cwd: process.cwd(),
    env: {},
  });
  const result = await invokeEngineProcess(invocation);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, 'real-out');
  assert.equal(result.stderr, 'real-err');
  assert.equal(result.spawnError, null);
});
