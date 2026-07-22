const state = { runId: null, analysis: null, poll: null };
const $ = (selector) => document.querySelector(selector);

async function api(url, options) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}

function setMessage(message, isError = false) {
  $('#message').textContent = message;
  $('#message').style.color = isError ? '#7a2632' : '#14594d';
}

function renderProgress(status) {
  $('#progress').innerHTML = Object.entries(status.stages).map(([name, value]) =>
    `<div class="step ${value.status}"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(value.status)}${value.detail ? `<br>${escapeHtml(value.detail)}` : ''}</div>`).join('');
}

function metric(label, value) { return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`; }
function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }

function renderAnalysis(analysis) {
  state.analysis = analysis;
  $('#review-panel').classList.remove('hidden');
  const s = analysis.summary;
  $('#analysis-summary').innerHTML = [
    metric('Navigation tests', s.navigationCount), metric('Interactions', s.interactionCount),
    metric('Safe', s.safe), metric('Unsafe', s.unsafe), metric('Unknown', s.unknown), metric('Execution eligible', s.executionEligible),
  ].join('');
  $('#navigation-list').innerHTML = analysis.navigation.map((item) => `
    <article class="card"><strong>${escapeHtml(item.pageContext || item.title)}</strong>
      <p>${escapeHtml(item.navigation)}</p>
      <span class="tag">${escapeHtml(item.identityType)}</span><span class="tag">${item.executable ? 'executable' : 'review needed'}</span>
      <p>${escapeHtml(item.identitySummary)}</p></article>`).join('') || '<p>No navigation tests found.</p>';
  $('#interaction-list').innerHTML = analysis.interactions.map((item) => `
    <article class="card">
      <label class="check"><input class="candidate" type="checkbox" value="${escapeHtml(item.candidateKey)}" ${item.executionEligible ? '' : 'disabled'}>
        <span><strong>${escapeHtml(item.targetText)}</strong> · ${escapeHtml(item.pageContext)}</span></label>
      <span class="tag ${escapeHtml(item.classification)}">${escapeHtml(item.classification)}</span>
      <span class="tag ${item.executionEligible ? 'eligible' : ''}">${item.executionEligible ? 'execution eligible' : 'not eligible'}</span>
      <p>Expected: ${escapeHtml(item.expectedTransition)}</p><p>Restore: ${escapeHtml(item.restore)}</p>
      ${item.ineligibleReason ? `<p>Reason: ${escapeHtml(item.ineligibleReason)}</p>` : ''}
    </article>`).join('') || '<p>No interaction candidates found.</p>';
  $('#analysis-debug').textContent = JSON.stringify(analysis, null, 2);
  document.querySelectorAll('.candidate').forEach((node) => node.addEventListener('change', updateApprovalButton));
  updateApprovalButton();
}

function selectedKeys() { return [...document.querySelectorAll('.candidate:checked')].map((node) => node.value); }
function updateApprovalButton() { $('#approve-button').disabled = !$('#explicit-approval').checked || selectedKeys().length === 0; }

async function pollStatus() {
  try {
    const status = await api(`/api/runs/${state.runId}/status`);
    renderProgress(status);
    if (status.status === 'waiting_for_approval' && !state.analysis) {
      clearInterval(state.poll);
      renderAnalysis(await api(`/api/runs/${state.runId}/analysis`));
      setMessage('Analysis complete. Review the current evidence and approve explicitly.');
    } else if (status.status === 'completed') {
      clearInterval(state.poll);
      renderResult(await api(`/api/runs/${state.runId}/result`), status);
    } else if (status.status === 'failed') {
      clearInterval(state.poll);
      setMessage(status.error || 'Run failed. Open debugging details for server output.', true);
      $('#analysis-debug').textContent = JSON.stringify(status.debugLog || [], null, 2);
    }
  } catch (error) { clearInterval(state.poll); setMessage(error.message, true); }
}

function renderResult(result, status) {
  $('#result-panel').classList.remove('hidden');
  const nav = result.pageNavigation; const soft = result.softInteractions;
  $('#result-summary').innerHTML = `<h3 class="result-${result.overall.toLowerCase()}">Overall: ${result.overall}</h3>
    <div class="metrics">${metric('Navigation passed', `${nav.passed}/${nav.total}`)}${metric('Identity verified', `${nav.identityVerified}/${nav.identityTotal}`)}
    ${metric('Interactions passed', `${soft.passed}/${soft.approved}`)}${metric('Restoration passed', `${soft.restorationPassed}/${soft.restorationTotal}`)}
    ${metric('Duration', `${(result.durationMs / 1000).toFixed(1)}s`)}</div>`;
  $('#report-link').href = result.reportUrl;
  $('#result-debug').textContent = JSON.stringify({ failedTests: result.failedTests, stages: status.stages, debugLog: status.debugLog }, null, 2);
  setMessage(`Test run completed: ${result.overall}.`, result.overall !== 'PASS');
}

$('#analyze-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    clearInterval(state.poll); state.analysis = null;
    $('#review-panel').classList.add('hidden'); $('#result-panel').classList.add('hidden');
    setMessage('Analysis queued…');
    const response = await api('/api/analyze', { method: 'POST', body: JSON.stringify({ url: $('#target-url').value }) });
    state.runId = response.runId; await pollStatus(); state.poll = setInterval(pollStatus, 1000);
  } catch (error) { setMessage(error.message, true); }
});

$('#explicit-approval').addEventListener('change', updateApprovalButton);
$('#approve-button').addEventListener('click', async () => {
  try {
    $('#approve-button').disabled = true; setMessage('Creating and validating the approval artifact…');
    await api(`/api/runs/${state.runId}/approve`, { method: 'POST', body: JSON.stringify({ candidateKeys: selectedKeys(), reviewer: $('#reviewer').value }) });
    $('#execute-button').disabled = false; setMessage('Approval validated. Ready to generate and run tests.'); await pollStatus();
  } catch (error) { setMessage(error.message, true); updateApprovalButton(); }
});

$('#execute-button').addEventListener('click', async () => {
  try {
    $('#execute-button').disabled = true; setMessage('Generating specs and running Playwright…');
    await api(`/api/runs/${state.runId}/execute`, { method: 'POST', body: '{}' });
    state.poll = setInterval(pollStatus, 1000); await pollStatus();
  } catch (error) { setMessage(error.message, true); }
});

$('#again-button').addEventListener('click', () => window.location.reload());
