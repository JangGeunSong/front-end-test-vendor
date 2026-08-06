const { spawn } = require('node:child_process');

const MAX_INVOCATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TERMINATION_GRACE_MS = 1000;
const MAX_TERMINATION_GRACE_MS = 60 * 1000;
const TERMINATION_METHODS = Object.freeze([
  'windows-child-kill',
  'windows-taskkill',
  'posix-process-group',
  'posix-child-kill',
]);

function validatePositiveSafeInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${label} must be a positive safe integer no greater than ${maximum}.`);
  }
}

function normalizeDeadline(input) {
  if (input.timeoutMs === undefined) {
    if (input.terminationGraceMs !== undefined) {
      throw new TypeError('terminationGraceMs requires timeoutMs.');
    }
    return null;
  }
  validatePositiveSafeInteger(input.timeoutMs, 'timeoutMs', MAX_INVOCATION_TIMEOUT_MS);
  const terminationGraceMs = input.terminationGraceMs === undefined
    ? DEFAULT_TERMINATION_GRACE_MS
    : input.terminationGraceMs;
  validatePositiveSafeInteger(terminationGraceMs, 'terminationGraceMs', MAX_TERMINATION_GRACE_MS);
  return Object.freeze({ timeoutMs: input.timeoutMs, terminationGraceMs });
}

/**
 * Build an immutable-by-convention process request without mutating either the
 * parent environment or the caller-provided overrides.
 *
 * @param {{ command: string, args: string[], cwd: string, env?: object, timeoutMs?: number, terminationGraceMs?: number }} input
 * @param {{ parentEnv?: object }} dependencies
 * @returns {{ command: string, args: string[], cwd: string, env: object, timeoutMs?: number, terminationGraceMs?: number }}
 */
function createEngineInvocationRequest(input, dependencies = {}) {
  if (!input || typeof input.command !== 'string' || input.command.length === 0) {
    throw new TypeError('Engine invocation command must be a non-empty string.');
  }
  if (!Array.isArray(input.args) || input.args.some((argument) => typeof argument !== 'string')) {
    throw new TypeError('Engine invocation args must be an array of strings.');
  }
  if (typeof input.cwd !== 'string' || input.cwd.length === 0) {
    throw new TypeError('Engine invocation cwd must be a non-empty string.');
  }
  const deadline = normalizeDeadline(input);
  const parentEnv = dependencies.parentEnv === undefined ? process.env : dependencies.parentEnv;
  return Object.freeze({
    command: input.command,
    args: Object.freeze([...input.args]),
    cwd: input.cwd,
    env: Object.freeze({ ...parentEnv, ...(input.env || {}) }),
    ...(deadline || {}),
  });
}

function expectedTerminationMethod(platform, force) {
  if (platform === 'win32') return 'windows-taskkill';
  return 'posix-process-group';
}

/**
 * Best-effort process-tree termination seam. HMV-007 can reuse this operation,
 * while timeout and cancellation continue to own distinct state transitions.
 */
function terminateInvocationProcess(child, options = {}) {
  const platform = options.platform || process.platform;
  const force = options.force === true;
  const signal = force ? 'SIGKILL' : 'SIGTERM';
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return Object.freeze({ requested: false, method: null, error: null });
  }

  if (platform === 'win32') {
    try {
      const spawnTerminationImpl = options.spawnTerminationImpl || spawn;
      const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
      const killer = spawnTerminationImpl('taskkill', args, {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
      });
      killer?.once?.('error', () => {});
      killer?.unref?.();
      return Object.freeze({ requested: true, method: 'windows-taskkill', error: null });
    } catch (error) {
      if (!force) {
        try {
          child.kill();
          return Object.freeze({ requested: true, method: 'windows-child-kill', error: null });
        } catch {
          // Preserve the tree-termination request failure below.
        }
      }
      return Object.freeze({ requested: true, method: 'windows-taskkill', error });
    }
  }

  try {
    const killImpl = options.killImpl || process.kill;
    killImpl(-pid, signal);
    return Object.freeze({ requested: true, method: 'posix-process-group', error: null });
  } catch (groupError) {
    try {
      child.kill(signal);
      return Object.freeze({ requested: true, method: 'posix-child-kill', error: null });
    } catch {
      return Object.freeze({ requested: true, method: 'posix-process-group', error: groupError });
    }
  }
}

/**
 * Invoke one existing engine process and return its raw terminal outcome.
 * The result deliberately omits the environment so inherited secrets are not
 * exposed. Spawn failures, deadline expiry, signals and non-zero exits remain
 * distinct. A deadline is owned and enforced entirely by this adapter.
 */
function invokeEngineProcess(request, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl || spawn;
  const setTimeoutImpl = dependencies.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = dependencies.clearTimeoutImpl || clearTimeout;
  const platform = dependencies.platform || process.platform;
  const deadline = normalizeDeadline(request);
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let deadlineTimer = null;
    let graceTimer = null;
    const termination = { requested: false, forced: false, method: null };

    const clearTimer = (timer) => {
      if (timer !== null) clearTimeoutImpl(timer);
    };
    const cleanup = () => {
      clearTimer(deadlineTimer);
      clearTimer(graceTimer);
      deadlineTimer = null;
      graceTimer = null;
      if (child) {
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        child.stdout?.removeListener('data', onStdout);
        child.stderr?.removeListener('data', onStderr);
      }
    };
    const finish = (exitCode, signal, spawnError) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Object.freeze({
        command: request.command,
        args: Object.freeze([...request.args]),
        cwd: request.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        spawnError,
        timedOut,
        timeoutMs: deadline?.timeoutMs || null,
        termination: Object.freeze({ ...termination }),
      }));
    };
    const onStdout = (chunk) => { if (!settled) stdout += chunk.toString(); };
    const onStderr = (chunk) => { if (!settled) stderr += chunk.toString(); };
    const onError = (error) => finish(null, null, error);
    const onClose = (code, signal) => finish(code, signal || null, null);
    const schedule = (callback, delay) => {
      const timer = setTimeoutImpl(callback, delay);
      timer?.unref?.();
      return timer;
    };
    const terminate = (force) => {
      termination.requested = true;
      termination.forced = force;
      termination.method = expectedTerminationMethod(platform, force);
      try {
        const result = (dependencies.terminateProcessImpl || terminateInvocationProcess)(child, {
          platform,
          force,
          killImpl: dependencies.killImpl,
          spawnTerminationImpl: dependencies.spawnTerminationImpl,
        });
        if (result?.method) termination.method = result.method;
      } catch {
        // Timeout remains the primary outcome; termination is best effort.
      }
    };

    try {
      child = spawnImpl(request.command, request.args, {
        cwd: request.cwd,
        windowsHide: true,
        env: request.env,
        shell: false,
        ...(deadline && platform !== 'win32' ? { detached: true } : {}),
      });
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
      if (deadline) {
        deadlineTimer = schedule(() => {
          if (settled) return;
          timedOut = true;
          terminate(false);
          if (settled) return;
          graceTimer = schedule(() => {
            if (settled) return;
            terminate(true);
            finish(null, null, null);
          }, deadline.terminationGraceMs);
        }, deadline.timeoutMs);
      }
    } catch (error) {
      finish(null, null, error);
    }
  });
}

module.exports = {
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_INVOCATION_TIMEOUT_MS,
  MAX_TERMINATION_GRACE_MS,
  TERMINATION_METHODS,
  createEngineInvocationRequest,
  invokeEngineProcess,
  terminateInvocationProcess,
};
