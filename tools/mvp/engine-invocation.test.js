const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const {
  MAX_INVOCATION_TIMEOUT_MS,
  createEngineInvocationRequest,
  invokeEngineProcess,
  terminateInvocationProcess,
} = require('./engine-invocation');

function createChild(pid = 4321) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = pid;
  child.kill = () => true;
  return child;
}

function createManualTimers() {
  let nextId = 1;
  const scheduled = new Map();
  const cleared = [];
  return {
    setTimeoutImpl(callback, delay) {
      const timer = { id: nextId, delay, callback, unrefCalled: false, unref() { this.unrefCalled = true; } };
      nextId += 1;
      scheduled.set(timer.id, timer);
      return timer;
    },
    clearTimeoutImpl(timer) {
      cleared.push(timer.id);
      scheduled.delete(timer.id);
    },
    fireNext() {
      const timer = [...scheduled.values()][0];
      assert.ok(timer, 'expected a pending timer');
      scheduled.delete(timer.id);
      timer.callback();
      return timer;
    },
    get pending() { return [...scheduled.values()]; },
    get cleared() { return cleared; },
  };
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
  assert.equal(result.spawned, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
  assert.equal(result.timeoutMs, null);
  assert.deepEqual(result.termination, { requested: false, forced: false, method: null });
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

test('validates deadline input without changing the no-timeout request shape', () => {
  const unchanged = createEngineInvocationRequest(request(), { parentEnv: {} });
  assert.equal(Object.hasOwn(unchanged, 'timeoutMs'), false);
  const deadline = createEngineInvocationRequest(request({ timeoutMs: 25, terminationGraceMs: 5 }), { parentEnv: {} });
  assert.equal(deadline.timeoutMs, 25);
  assert.equal(deadline.terminationGraceMs, 5);
  for (const value of [0, -1, NaN, Infinity, '10', MAX_INVOCATION_TIMEOUT_MS + 1]) {
    assert.throws(() => createEngineInvocationRequest(request({ timeoutMs: value })), /timeoutMs/);
  }
  assert.throws(() => createEngineInvocationRequest(request({ terminationGraceMs: 5 })), /requires timeoutMs/);
  assert.throws(() => createEngineInvocationRequest(request({ timeoutMs: 5, terminationGraceMs: 0 })), /terminationGraceMs/);
});

test('normal close wins before deadline and clears the timer', async () => {
  const child = createChild();
  const timers = createManualTimers();
  const resultPromise = invokeEngineProcess(request({ timeoutMs: 20, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    ...timers,
  });
  assert.equal(timers.pending.length, 1);
  assert.equal(timers.pending[0].unrefCalled, true);
  child.emit('close', 0, null);
  const result = await resultPromise;
  assert.equal(result.timedOut, false);
  assert.equal(timers.pending.length, 0);
  assert.equal(child.listenerCount('close'), 0);
});

test('already-aborted signal cancels without spawning a process', async () => {
  const controller = new AbortController();
  controller.abort(new Error('private reason'));
  let spawnCount = 0;
  const result = await invokeEngineProcess(request({
    signal: controller.signal,
    terminationGraceMs: 5,
  }), {
    spawnImpl: () => { spawnCount += 1; return createChild(); },
  });
  assert.equal(spawnCount, 0);
  assert.equal(result.spawned, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.spawnError, null);
  assert.deepEqual(result.termination, { requested: false, forced: false, method: null });
  assert.equal(JSON.stringify(result).includes('private reason'), false);
});

test('cancellation requests graceful termination and removes timers and listeners on close', async () => {
  const controller = new AbortController();
  const child = createChild();
  const timers = createManualTimers();
  const calls = [];
  const resultPromise = invokeEngineProcess(request({
    timeoutMs: 20,
    terminationGraceMs: 5,
    signal: controller.signal,
  }), {
    spawnImpl: () => child,
    terminateProcessImpl: (_child, options) => {
      calls.push(options.force);
      return { requested: true, method: 'windows-child-kill' };
    },
    platform: 'win32',
    ...timers,
  });
  controller.abort();
  assert.deepEqual(calls, [false]);
  assert.equal(timers.pending.length, 1);
  child.emit('close', null, 'SIGTERM');
  const result = await resultPromise;
  assert.equal(result.cancelled, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.termination.forced, false);
  assert.equal(child.listenerCount('close'), 0);
  assert.equal(timers.pending.length, 0);
});

test('abort during synchronous spawn handoff terminates the returned child once', async () => {
  const controller = new AbortController();
  const child = createChild();
  const calls = [];
  const resultPromise = invokeEngineProcess(request({ signal: controller.signal, terminationGraceMs: 5 }), {
    spawnImpl: () => {
      controller.abort();
      return child;
    },
    terminateProcessImpl: (_child, options) => {
      calls.push(options.force);
      return { requested: true, method: 'posix-process-group' };
    },
    platform: 'linux',
  });
  child.emit('close', null, 'SIGTERM');
  const result = await resultPromise;
  assert.deepEqual(calls, [false]);
  assert.equal(result.cancelled, true);
  assert.equal(result.spawned, true);
});

test('unresponsive cancellation forces termination once after grace', async () => {
  const controller = new AbortController();
  const child = createChild();
  const timers = createManualTimers();
  const calls = [];
  const resultPromise = invokeEngineProcess(request({ signal: controller.signal, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    terminateProcessImpl: (_child, options) => {
      calls.push(options.force);
      return { requested: true, method: 'posix-process-group' };
    },
    platform: 'linux',
    ...timers,
  });
  controller.abort();
  timers.fireNext();
  const result = await resultPromise;
  assert.deepEqual(calls, [false, true]);
  assert.equal(result.cancelled, true);
  assert.equal(result.termination.forced, true);
  child.emit('close', null, 'SIGKILL');
  assert.equal(calls.length, 2);
});

test('first accepted cause wins timeout and cancellation races', async () => {
  const cancelFirst = new AbortController();
  const cancelChild = createChild();
  const cancelTimers = createManualTimers();
  const cancelPromise = invokeEngineProcess(request({
    timeoutMs: 20, terminationGraceMs: 5, signal: cancelFirst.signal,
  }), {
    spawnImpl: () => cancelChild,
    terminateProcessImpl: () => ({ requested: true, method: 'posix-process-group' }),
    platform: 'linux',
    ...cancelTimers,
  });
  cancelFirst.abort();
  cancelChild.emit('close', null, 'SIGTERM');
  const cancelled = await cancelPromise;
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.timedOut, false);

  const timeoutFirst = new AbortController();
  const timeoutChild = createChild();
  const timeoutTimers = createManualTimers();
  const timeoutPromise = invokeEngineProcess(request({
    timeoutMs: 20, terminationGraceMs: 5, signal: timeoutFirst.signal,
  }), {
    spawnImpl: () => timeoutChild,
    terminateProcessImpl: () => ({ requested: true, method: 'posix-process-group' }),
    platform: 'linux',
    ...timeoutTimers,
  });
  timeoutTimers.fireNext();
  timeoutFirst.abort();
  timeoutChild.emit('close', null, 'SIGTERM');
  const timedOut = await timeoutPromise;
  assert.equal(timedOut.timedOut, true);
  assert.equal(timedOut.cancelled, false);
});

test('termination helper failure and late events preserve cancellation settlement', async () => {
  const controller = new AbortController();
  const child = createChild();
  const timers = createManualTimers();
  const resultPromise = invokeEngineProcess(request({ signal: controller.signal, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    terminateProcessImpl: () => { throw new Error('termination unavailable'); },
    ...timers,
  });
  controller.abort();
  child.emit('close', 0, null);
  const result = await resultPromise;
  child.stdout.emit('data', 'late private output');
  child.emit('close', 9, null);
  assert.equal(result.cancelled, true);
  assert.equal(result.stdout, '');
  assert.equal(result.spawnError, null);
});

test('deadline requests graceful termination and settles on close without forcing', async () => {
  const child = createChild();
  const timers = createManualTimers();
  const calls = [];
  const resultPromise = invokeEngineProcess(request({ timeoutMs: 20, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    terminateProcessImpl: (_child, options) => {
      calls.push(options.force);
      return { requested: true, method: 'windows-child-kill' };
    },
    platform: 'win32',
    ...timers,
  });
  timers.fireNext();
  assert.deepEqual(calls, [false]);
  child.emit('close', null, 'SIGTERM');
  const result = await resultPromise;
  assert.equal(result.timedOut, true);
  assert.equal(result.timeoutMs, 20);
  assert.deepEqual(result.termination, { requested: true, forced: false, method: 'windows-child-kill' });
  assert.equal(timers.pending.length, 0);
});

test('unresponsive child receives forced termination after grace and settles once', async () => {
  const child = createChild();
  const timers = createManualTimers();
  const calls = [];
  const resultPromise = invokeEngineProcess(request({ timeoutMs: 20, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    terminateProcessImpl: (_child, options) => {
      calls.push(options.force);
      return { requested: true, method: options.force ? 'windows-taskkill' : 'windows-child-kill' };
    },
    platform: 'win32',
    ...timers,
  });
  timers.fireNext();
  child.stdout.emit('data', 'before-force');
  timers.fireNext();
  const result = await resultPromise;
  assert.deepEqual(calls, [false, true]);
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout, 'before-force');
  assert.deepEqual(result.termination, { requested: true, forced: true, method: 'windows-taskkill' });
  child.stdout.emit('data', '-late');
  child.emit('close', 0, null);
  assert.equal(result.stdout, 'before-force');
  assert.equal(child.listenerCount('close'), 0);
});

test('spawn error and non-timeout signal clear deadline state', async () => {
  const spawnChild = createChild();
  const spawnTimers = createManualTimers();
  const spawnPromise = invokeEngineProcess(request({ timeoutMs: 20 }), {
    spawnImpl: () => spawnChild,
    ...spawnTimers,
  });
  spawnChild.emit('error', new Error('spawn failed'));
  const spawnResult = await spawnPromise;
  assert.equal(spawnResult.timedOut, false);
  assert.equal(spawnTimers.pending.length, 0);

  const signalChild = createChild();
  const signalTimers = createManualTimers();
  const signalPromise = invokeEngineProcess(request({ timeoutMs: 20 }), {
    spawnImpl: () => signalChild,
    ...signalTimers,
  });
  signalChild.emit('close', null, 'SIGTERM');
  const signalResult = await signalPromise;
  assert.equal(signalResult.timedOut, false);
  assert.equal(signalResult.signal, 'SIGTERM');
  assert.equal(signalTimers.pending.length, 0);
});

test('termination helper failure preserves timeout as the primary outcome', async () => {
  const child = createChild();
  const timers = createManualTimers();
  const resultPromise = invokeEngineProcess(request({ timeoutMs: 20, terminationGraceMs: 5 }), {
    spawnImpl: () => child,
    terminateProcessImpl: () => { throw new Error('termination unavailable'); },
    platform: 'linux',
    ...timers,
  });
  timers.fireNext();
  timers.fireNext();
  const result = await resultPromise;
  assert.equal(result.timedOut, true);
  assert.equal(result.termination.forced, true);
  assert.equal(result.termination.method, 'posix-process-group');
});

test('Windows graceful and forced tree termination use safe taskkill arguments without a shell', () => {
  const child = createChild(9876);
  const captured = [];
  const spawnTerminationImpl = (command, args, options) => {
    const killer = new EventEmitter();
    killer.unref = () => { killer.unrefCalled = true; };
    captured.push({ command, args, options, killer });
    return killer;
  };
  const graceful = terminateInvocationProcess(child, {
    platform: 'win32',
    force: false,
    spawnTerminationImpl,
  });
  const forced = terminateInvocationProcess(child, {
    platform: 'win32',
    force: true,
    spawnTerminationImpl,
  });
  assert.deepEqual(captured[0].args, ['/PID', '9876', '/T']);
  assert.deepEqual(captured[1].args, ['/PID', '9876', '/T', '/F']);
  assert.equal(captured[0].command, 'taskkill');
  assert.equal(captured[0].options.shell, false);
  assert.equal(captured[0].options.stdio, 'ignore');
  assert.equal(captured[0].killer.unrefCalled, true);
  assert.equal(graceful.method, 'windows-taskkill');
  assert.equal(forced.method, 'windows-taskkill');
});

test('POSIX termination targets the isolated process group then falls back to the child', () => {
  const child = createChild(2468);
  const signals = [];
  const group = terminateInvocationProcess(child, {
    platform: 'linux',
    force: false,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals, [[-2468, 'SIGTERM']]);
  assert.equal(group.method, 'posix-process-group');

  let fallbackSignal;
  child.kill = (signal) => { fallbackSignal = signal; };
  const fallback = terminateInvocationProcess(child, {
    platform: 'darwin',
    force: true,
    killImpl: () => { throw new Error('group unavailable'); },
  });
  assert.equal(fallbackSignal, 'SIGKILL');
  assert.equal(fallback.method, 'posix-child-kill');
});

test('deadline process-tree characterization does not leave a neutral descendant', { timeout: 5000 }, async () => {
  const childProgram = 'setInterval(() => {}, 1000)';
  const parentProgram = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { stdio: 'ignore' });`,
    "process.stdout.write(String(child.pid) + '\\n');",
    'setInterval(() => {}, 1000);',
  ].join(' ');
  let descendantPid = null;
  try {
    const result = await invokeEngineProcess(createEngineInvocationRequest({
      command: process.execPath,
      args: ['-e', parentProgram],
      cwd: process.cwd(),
      env: {},
      timeoutMs: 150,
      terminationGraceMs: 100,
    }));
    descendantPid = Number.parseInt(result.stdout.trim(), 10);
    assert.equal(result.timedOut, true);
    assert.equal(Number.isSafeInteger(descendantPid), true);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && processExists(descendantPid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(processExists(descendantPid), false);
  } finally {
    if (Number.isSafeInteger(descendantPid) && processExists(descendantPid)) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(descendantPid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      } else {
        try { process.kill(descendantPid, 'SIGKILL'); } catch { /* already exited */ }
      }
    }
  }
});

test('cancellation process-tree characterization does not leave a neutral descendant', { timeout: 5000 }, async () => {
  const childProgram = 'setInterval(() => {}, 1000)';
  const parentProgram = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], { stdio: 'ignore' });`,
    "process.stdout.write(String(child.pid) + '\\n');",
    'setInterval(() => {}, 1000);',
  ].join(' ');
  const controller = new AbortController();
  let descendantPid = null;
  try {
    const resultPromise = invokeEngineProcess(createEngineInvocationRequest({
      command: process.execPath,
      args: ['-e', parentProgram],
      cwd: process.cwd(),
      env: {},
      terminationGraceMs: 100,
      signal: controller.signal,
    }));
    setTimeout(() => controller.abort(), 150);
    const result = await resultPromise;
    descendantPid = Number.parseInt(result.stdout.trim(), 10);
    assert.equal(result.cancelled, true);
    assert.equal(result.timedOut, false);
    assert.equal(Number.isSafeInteger(descendantPid), true);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && processExists(descendantPid)) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(processExists(descendantPid), false);
  } finally {
    if (Number.isSafeInteger(descendantPid) && processExists(descendantPid)) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(descendantPid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      } else {
        try { process.kill(descendantPid, 'SIGKILL'); } catch { /* already exited */ }
      }
    }
  }
});

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}
