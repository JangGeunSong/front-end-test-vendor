const { spawn } = require('node:child_process');

/**
 * Build an immutable-by-convention process request without mutating either the
 * parent environment or the caller-provided overrides.
 *
 * @param {{ command: string, args: string[], cwd: string, env?: object }} input
 * @param {{ parentEnv?: object }} dependencies
 * @returns {{ command: string, args: string[], cwd: string, env: object }}
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
  const parentEnv = dependencies.parentEnv === undefined ? process.env : dependencies.parentEnv;
  return {
    command: input.command,
    args: [...input.args],
    cwd: input.cwd,
    env: { ...parentEnv, ...(input.env || {}) },
  };
}

/**
 * Invoke one existing engine process and return its raw terminal outcome.
 * The result deliberately omits the environment so inherited secrets are not
 * exposed. Spawn failures are data, distinct from non-zero process exits.
 *
 * @param {{ command: string, args: string[], cwd: string, env: object }} request
 * @param {{ spawnImpl?: Function }} dependencies
 * @returns {Promise<{
 *   command: string,
 *   args: string[],
 *   cwd: string,
 *   exitCode: number|null,
 *   signal: string|null,
 *   stdout: string,
 *   stderr: string,
 *   spawnError: Error|null,
 * }>}
 */
function invokeEngineProcess(request, dependencies = {}) {
  const spawnImpl = dependencies.spawnImpl || spawn;
  return new Promise((resolve) => {
    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (exitCode, signal, spawnError) => {
      if (settled) return;
      settled = true;
      if (child) {
        child.removeListener('error', onError);
        child.removeListener('close', onClose);
        child.stdout?.removeListener('data', onStdout);
        child.stderr?.removeListener('data', onStderr);
      }
      resolve({
        command: request.command,
        args: [...request.args],
        cwd: request.cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        spawnError,
      });
    };
    const onStdout = (chunk) => { stdout += chunk.toString(); };
    const onStderr = (chunk) => { stderr += chunk.toString(); };
    const onError = (error) => finish(null, null, error);
    const onClose = (code, signal) => finish(code, signal || null, null);

    try {
      child = spawnImpl(request.command, request.args, {
        cwd: request.cwd,
        windowsHide: true,
        env: request.env,
      });
      child.stdout?.on('data', onStdout);
      child.stderr?.on('data', onStderr);
      child.on('error', onError);
      child.on('close', onClose);
    } catch (error) {
      finish(null, null, error);
    }
  });
}

module.exports = {
  createEngineInvocationRequest,
  invokeEngineProcess,
};
