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

function normalizeInvocationPolicy(input) {
  const hasDeadline = input.timeoutMs !== undefined;
  const hasSignal = input.signal !== undefined;
  if (hasDeadline) validatePositiveSafeInteger(input.timeoutMs, 'timeoutMs', MAX_INVOCATION_TIMEOUT_MS);
  if (hasSignal && (!input.signal || typeof input.signal.aborted !== 'boolean'
      || typeof input.signal.addEventListener !== 'function'
      || typeof input.signal.removeEventListener !== 'function')) {
    throw new TypeError('signal must be an AbortSignal.');
  }
  if (!hasDeadline && !hasSignal) {
    if (input.terminationGraceMs !== undefined) {
      throw new TypeError('terminationGraceMs requires timeoutMs or signal.');
    }
    return null;
  }
  const terminationGraceMs = input.terminationGraceMs === undefined
    ? DEFAULT_TERMINATION_GRACE_MS
    : input.terminationGraceMs;
  validatePositiveSafeInteger(terminationGraceMs, 'terminationGraceMs', MAX_TERMINATION_GRACE_MS);
  return Object.freeze({
    ...(hasDeadline ? { timeoutMs: input.timeoutMs } : {}),
    ...(hasSignal ? { signal: input.signal } : {}),
    terminationGraceMs,
  });
}

/**
 * Build an immutable-by-convention process request without mutating either the
 * parent environment or the caller-provided overrides.
 *
 * @param {{ command: string, args: string[], cwd: string, env?: object, timeoutMs?: number, terminationGraceMs?: number, signal?: AbortSignal }} input
 * @param {{ parentEnv?: object }} dependencies
 * @returns {{ command: string, args: string[], cwd: string, env: object, timeoutMs?: number, terminationGraceMs?: number, signal?: AbortSignal }}
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
  const policy = normalizeInvocationPolicy(input);
  const parentEnv = dependencies.parentEnv === undefined ? process.env : dependencies.parentEnv;
  return Object.freeze({
    command: input.command,
    args: Object.freeze([...input.args]),
    cwd: input.cwd,
    env: Object.freeze({ ...parentEnv, ...(input.env || {}) }),
    ...(policy || {}),
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
  const policy = normalizeInvocationPolicy(request);
  const deadline = policy?.timeoutMs === undefined ? null : policy;
  const cancellationSignal = policy?.signal || null;
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let terminalCause = null;
    let spawned = false;
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
      cancellationSignal?.removeEventListener('abort', onAbort);
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
        spawned,
        timedOut: terminalCause === 'timeout',
        cancelled: terminalCause === 'cancellation',
        timeoutMs: deadline?.timeoutMs || null,
        termination: Object.freeze({ ...termination }),
      }));
    };
    const onStdout = (chunk) => { if (!settled) stdout += chunk.toString(); };
    const onStderr = (chunk) => { if (!settled) stderr += chunk.toString(); };
    const acceptCause = (cause) => {
      if (terminalCause !== null) return false;
      terminalCause = cause;
      return true;
    };
    const onError = (error) => {
      if (acceptCause('spawn-error')) finish(null, null, error);
      else if (terminalCause === 'cancellation' || terminalCause === 'timeout') finish(null, null, null);
    };
    const onClose = (code, signal) => {
      acceptCause('normal');
      finish(code, signal || null, null);
    };
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
    const beginTermination = (cause) => {
      if (!acceptCause(cause)) return;
      clearTimer(deadlineTimer);
      deadlineTimer = null;
      terminate(false);
      if (settled) return;
      graceTimer = schedule(() => {
        if (settled) return;
        terminate(true);
        finish(null, null, null);
      }, policy.terminationGraceMs);
    };
    const onAbort = () => beginTermination('cancellation');

    if (cancellationSignal?.aborted) {
      acceptCause('cancellation');
      finish(null, null, null);
      return;
    }
    try {
      child = spawnImpl(request.command, request.args, {
        cwd: request.cwd,
        windowsHide: true,
        env: request.env,
        shell: false,
        ...(policy && platform !== 'win32' ? { detached: true } : {}),
      });
      spawned = true;
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
      cancellationSignal?.addEventListener('abort', onAbort, { once: true });
      if (cancellationSignal?.aborted) onAbort();
      if (deadline && terminalCause === null) {
        deadlineTimer = schedule(() => {
          if (!settled) beginTermination('timeout');
        }, deadline.timeoutMs);
      }
    } catch (error) {
      onError(error);
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
