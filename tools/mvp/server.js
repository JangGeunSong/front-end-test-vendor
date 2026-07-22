const fs = require('fs');
const http = require('http');
const path = require('path');
const {
  analyzeRun,
  approveRun,
  createRun,
  enqueue,
  executeRun,
  getRun,
  publicRun,
  validateTargetUrl,
} = require('./controller');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.MVP_PORT || 4173);

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error('Request body is too large.'));
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Request body must be valid JSON.')); }
    });
    request.on('error', reject);
  });
}

function mimeType(filePath) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.zip': 'application/zip',
  })[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function serveFile(response, root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const filePath = path.resolve(resolvedRoot, relativePath);
  if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
    json(response, 403, { error: 'Path is outside the allowed directory.' });
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    json(response, 404, { error: 'File not found.' });
    return;
  }
  response.writeHead(200, { 'Content-Type': mimeType(filePath) });
  fs.createReadStream(filePath).pipe(response);
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (request.method === 'POST' && url.pathname === '/api/analyze') {
    const body = await readBody(request);
    const target = validateTargetUrl(body.url);
    const run = createRun(target);
    enqueue(() => analyzeRun(run));
    json(response, 202, { runId: run.id });
    return;
  }

  if (parts[0] === 'api' && parts[1] === 'runs' && parts[2]) {
    const run = getRun(parts[2]);
    const action = parts[3];
    if (request.method === 'GET' && action === 'status') {
      json(response, 200, publicRun(run));
      return;
    }
    if (request.method === 'GET' && action === 'analysis') {
      if (!run.analysis) throw new Error('Analysis is not ready.');
      json(response, 200, run.analysis);
      return;
    }
    if (request.method === 'POST' && action === 'approve') {
      const body = await readBody(request);
      await enqueue(() => approveRun(run, body.candidateKeys, body.reviewer, body.note));
      json(response, 200, { status: run.status, approvedCandidateKeys: run.approvedCandidateKeys });
      return;
    }
    if (request.method === 'POST' && action === 'execute') {
      if (run.status !== 'approved') throw new Error('Explicit approval is required before execution.');
      enqueue(() => executeRun(run));
      json(response, 202, { status: 'executing' });
      return;
    }
    if (request.method === 'GET' && action === 'result') {
      if (!run.result) throw new Error('Execution result is not ready.');
      json(response, 200, run.result);
      return;
    }
    if (request.method === 'GET' && action === 'report') {
      if (!run.reportDir) throw new Error('HTML report is unavailable.');
      if (parts.length === 4) {
        response.writeHead(302, { Location: `/api/runs/${run.id}/report/index.html` });
        response.end();
        return;
      }
      const relative = parts.slice(4).join('/') || 'index.html';
      serveFile(response, run.reportDir, relative);
      return;
    }
  }

  if (request.method === 'GET' && (url.pathname === '/' || !url.pathname.startsWith('/api/'))) {
    serveFile(response, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
    return;
  }
  json(response, 404, { error: 'Not found.' });
}

const server = http.createServer((request, response) => {
  route(request, response).catch((error) => {
    json(response, /not found/i.test(error.message) ? 404 : 400, { error: error.message });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local Test MVP: http://127.0.0.1:${PORT}`);
});
