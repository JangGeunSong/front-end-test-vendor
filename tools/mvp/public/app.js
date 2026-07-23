const state = {
  runId: null,
  analysis: null,
  poll: null,
  filter: 'ready',
  approvalValidated: false,
};

function interactionMatchesFilter(item, filter, selectedKeys) {
  if (filter === 'ready') return item.executionEligible;
  if (filter === 'review') return !item.executionEligible;
  if (filter === 'selected') return selectedKeys.has(item.candidateKey);
  return true;
}

function runButtonLabel(navigationCount, selectedCount) {
  const total = navigationCount + selectedCount;
  return selectedCount > 0 ? `Run ${total} tests` : `Run ${navigationCount} navigation tests`;
}

function identityBuckets(navigation) {
  return (navigation || []).reduce((counts, item) => {
    const raw = String(item.identityType || '').toLowerCase();
    const key = raw.includes('heading') ? 'Heading identity'
      : raw.includes('content') || raw.includes('container') ? 'Content identity'
        : raw.includes('tab') ? 'Tab identity' : 'Other';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function shouldIgnoreCardToggle(target) {
  return Boolean(target.closest('a, button, input, label, details, summary'));
}

if (typeof module !== 'undefined') {
  module.exports = { identityBuckets, interactionMatchesFilter, runButtonLabel, shouldIgnoreCardToggle };
}

if (typeof document !== 'undefined') {
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

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
  }

  function renderProgress(status) {
    $('#progress').innerHTML = Object.entries(status.stages).map(([name, value]) => {
      const displayStatus = value.status === 'pending' ? 'not started' : value.status;
      return `<div class="step ${value.status}"><strong>${escapeHtml(name)}</strong><br>${escapeHtml(displayStatus)}${value.detail ? `<br>${escapeHtml(value.detail)}` : ''}</div>`;
    }).join('');
  }

  function metric(label, value) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
  }

  function selectedKeys() {
    return [...document.querySelectorAll('.candidate:checked')].map((node) => node.value);
  }

  function updateCandidateCard(checkbox) {
    const card = checkbox.closest('.interaction-card');
    card.classList.toggle('selected', checkbox.checked);
    card.querySelector('.selected-badge').classList.toggle('hidden', !checkbox.checked);
    card.setAttribute('aria-selected', String(checkbox.checked));
  }

  function renderNavigation(analysis) {
    $('#navigation-total').textContent = `${analysis.summary.navigationCount} tests`;
    const buckets = identityBuckets(analysis.navigation);
    $('#navigation-breakdown').innerHTML = ['Heading identity', 'Content identity', 'Tab identity', 'Other']
      .map((label) => metric(label, buckets[label] || 0)).join('');
    $('#navigation-list').innerHTML = analysis.navigation.map((item) => `
      <article class="card navigation-card"><strong>${escapeHtml(item.pageContext || item.title)}</strong>
        <p>${escapeHtml(item.navigation)}</p>
        <span class="tag">${escapeHtml(item.identityType)}</span>
        <span class="tag">${item.executable ? 'executable' : 'review needed'}</span>
        <p>${escapeHtml(item.identitySummary)}</p>
      </article>`).join('') || '<p>No navigation tests found.</p>';
  }

  function renderInteractions(analysis) {
    $('#interaction-list').innerHTML = analysis.interactions.map((item) => `
      <article class="card interaction-card" data-key="${escapeHtml(item.candidateKey)}" tabindex="${item.executionEligible ? '0' : '-1'}"
        aria-selected="false" aria-disabled="${String(!item.executionEligible)}">
        <div class="candidate-heading">
          <label class="candidate-check">
            <input class="candidate" type="checkbox" value="${escapeHtml(item.candidateKey)}" ${item.executionEligible ? '' : 'disabled'}>
            <span><strong>${escapeHtml(item.targetText)}</strong><small>${escapeHtml(item.pageContext)}</small></span>
          </label>
          <span class="tag selected-badge hidden">Selected</span>
        </div>
        <span class="tag ${escapeHtml(item.classification)}">${escapeHtml(item.classification)}</span>
        <span class="tag ${item.executionEligible ? 'eligible' : ''}">${item.executionEligible ? 'Ready to test' : 'Needs review'}</span>
        <p>Expected: ${escapeHtml(item.expectedTransition)}</p>
        <p>Restore: ${escapeHtml(item.restore)}</p>
        ${item.ineligibleReason ? `<details><summary>Why this needs review</summary><p>${escapeHtml(item.ineligibleReason)}</p></details>` : ''}
      </article>`).join('');

    document.querySelectorAll('.candidate').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        updateCandidateCard(checkbox);
        state.approvalValidated = false;
        updateReviewState();
      });
    });
    document.querySelectorAll('.interaction-card').forEach((card) => {
      const toggle = () => {
        const checkbox = card.querySelector('.candidate');
        if (checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      };
      card.addEventListener('click', (event) => {
        if (!shouldIgnoreCardToggle(event.target)) toggle();
      });
      card.addEventListener('keydown', (event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          toggle();
        }
      });
    });
  }

  function applyInteractionFilter() {
    const selected = new Set(selectedKeys());
    let visible = 0;
    document.querySelectorAll('.interaction-card').forEach((card) => {
      const item = state.analysis.interactions.find((candidate) => candidate.candidateKey === card.dataset.key);
      const show = interactionMatchesFilter(item, state.filter, selected);
      card.classList.toggle('filtered-out', !show);
      if (show) visible += 1;
    });
    const empty = $('#interaction-empty');
    empty.classList.toggle('hidden', visible > 0);
    if (visible === 0) {
      empty.innerHTML = state.filter === 'ready'
        ? '<strong>No supported soft interactions are ready to test.</strong><p>Page Navigation and Page Identity tests can still be run.</p>'
        : '<strong>No candidates match this filter.</strong><p>Use another filter to review the preserved candidates.</p>';
    }
  }

  function updateReviewState() {
    if (!state.analysis) return;
    const navigationCount = state.analysis.summary.navigationCount;
    const selectedCount = selectedKeys().length;
    $('#selected-count').textContent = `Selected interactions: ${selectedCount}`;
    $('#run-summary').textContent = `Navigation ${navigationCount} · Interactions selected ${selectedCount}`;
    $('#execute-button').textContent = runButtonLabel(navigationCount, selectedCount);
    $('#approve-button').disabled = selectedCount === 0 || !$('#explicit-approval').checked || state.approvalValidated;
    $('#execute-button').disabled = navigationCount === 0 || (selectedCount > 0 && !state.approvalValidated);
    $('#run-note').textContent = selectedCount === 0
      ? 'Soft Interaction and Restoration will be skipped.'
      : state.approvalValidated
        ? 'Approved interactions will run after Navigation.'
        : 'Explicit approval is required for the selected interactions.';
    applyInteractionFilter();
  }

  function renderAnalysis(analysis) {
    state.analysis = analysis;
    state.filter = 'ready';
    state.approvalValidated = false;
    $('#review-panel').classList.remove('hidden');
    const s = analysis.summary;
    $('#analysis-summary').innerHTML = [
      metric('Navigation tests', s.navigationCount),
      metric('Ready interactions', s.executionEligible),
      metric('Needs review', s.interactionCount - s.executionEligible),
    ].join('');
    renderNavigation(analysis);
    renderInteractions(analysis);
    $('#analysis-debug').textContent = JSON.stringify(analysis, null, 2);
    document.querySelectorAll('.filter').forEach((button) => {
      const active = button.dataset.filter === 'ready';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    updateReviewState();
  }

  async function pollStatus() {
    try {
      const status = await api(`/api/runs/${state.runId}/status`);
      renderProgress(status);
      if (status.status === 'ready_for_execution' && !state.analysis) {
        clearInterval(state.poll);
        renderAnalysis(await api(`/api/runs/${state.runId}/analysis`));
        setMessage('Analysis complete. Navigation tests are ready; soft interactions are optional.');
      } else if (status.status === 'completed') {
        clearInterval(state.poll);
        renderResult(await api(`/api/runs/${state.runId}/result`), status);
      } else if (status.status === 'failed') {
        clearInterval(state.poll);
        setMessage(status.error || 'Run failed. Open debugging details for server output.', true);
        $('#analysis-debug').textContent = JSON.stringify(status.debugLog || [], null, 2);
      }
    } catch (error) {
      clearInterval(state.poll);
      setMessage(error.message, true);
    }
  }

  function renderResult(result, status) {
    $('#result-panel').classList.remove('hidden');
    const nav = result.pageNavigation;
    const soft = result.softInteractions;
    const interactionMetrics = soft.status === 'skipped'
      ? `${metric('Soft Interaction', 'SKIPPED')}${metric('Restoration', 'SKIPPED')}`
      : `${metric('Interactions passed', `${soft.passed}/${soft.approved}`)}${metric('Restoration passed', `${soft.restorationPassed}/${soft.restorationTotal}`)}`;
    const skipReason = soft.status === 'skipped'
      ? '<p class="skip-reason">No approved supported interactions. Navigation and Page Identity ran normally.</p>' : '';
    $('#result-summary').innerHTML = `<h3 class="result-${result.overall.toLowerCase()}">Overall: ${result.overall}</h3>
      <div class="metrics">
        ${metric('Navigation passed', `${nav.passed}/${nav.total}`)}
        ${metric('Identity verified', `${nav.identityVerified}/${nav.identityTotal}`)}
        ${interactionMetrics}
        ${metric('Duration', `${(result.durationMs / 1000).toFixed(1)}s`)}
      </div>${skipReason}`;
    $('#report-link').href = result.reportUrl;
    $('#result-debug').textContent = JSON.stringify({
      failedTests: result.failedTests,
      interactionStatus: soft.status,
      interactionReason: soft.reason,
      stages: status.stages,
      debugLog: status.debugLog,
    }, null, 2);
    setMessage(`Test run completed: ${result.overall}.`, result.overall !== 'PASS');
    $('#result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#analyze-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      clearInterval(state.poll);
      state.analysis = null;
      $('#review-panel').classList.add('hidden');
      $('#result-panel').classList.add('hidden');
      setMessage('Analysis queued…');
      const response = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ url: $('#target-url').value }),
      });
      state.runId = response.runId;
      await pollStatus();
      state.poll = setInterval(pollStatus, 1000);
    } catch (error) {
      setMessage(error.message, true);
    }
  });

  $('#explicit-approval').addEventListener('change', updateReviewState);
  $('#interaction-filters').addEventListener('click', (event) => {
    const button = event.target.closest('.filter');
    if (!button) return;
    state.filter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach((item) => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    applyInteractionFilter();
  });

  $('#approve-button').addEventListener('click', async () => {
    try {
      $('#approve-button').disabled = true;
      setMessage('Creating and validating the approval artifact…');
      await api(`/api/runs/${state.runId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ candidateKeys: selectedKeys(), reviewer: $('#reviewer').value }),
      });
      state.approvalValidated = true;
      document.querySelectorAll('.candidate').forEach((checkbox) => { checkbox.disabled = true; });
      setMessage('Approval validated. Navigation and approved interactions are ready to run.');
      updateReviewState();
    } catch (error) {
      setMessage(error.message, true);
      updateReviewState();
    }
  });

  $('#execute-button').addEventListener('click', async () => {
    try {
      $('#execute-button').disabled = true;
      setMessage(selectedKeys().length > 0
        ? 'Generating interaction spec and running Navigation plus Soft Interaction…'
        : 'Running Navigation and Page Identity tests…');
      await api(`/api/runs/${state.runId}/execute`, { method: 'POST', body: '{}' });
      state.poll = setInterval(pollStatus, 1000);
      await pollStatus();
    } catch (error) {
      setMessage(error.message, true);
      updateReviewState();
    }
  });

  $('#again-button').addEventListener('click', () => window.location.reload());
}
