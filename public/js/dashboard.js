/**
 * Nightwatch Dashboard
 * Real-time monitoring of CI failure healing
 */

const API_BASE = '';
let selectedFailureId = null;
let pollInterval = null;

const STATUS_CONFIG = {
  pending: { icon: '🔴', label: 'Pending', class: 'pending' },
  fetching_logs: { icon: '📥', label: 'Fetching', class: 'analyzing' },
  analyzing: { icon: '🔍', label: 'Analyzing...', class: 'analyzing' },
  reproducing: { icon: '🐳', label: 'Reproducing', class: 'analyzing' },
  generating_test: { icon: '🧪', label: 'Testing', class: 'analyzing' },
  fixing: { icon: '🔧', label: 'Fixing', class: 'analyzing' },
  creating_pr: { icon: '📝', label: 'Creating PR', class: 'analyzing' },
  fixed: { icon: '✅', label: 'Fixed', class: 'fixed' },
  escalated: { icon: '⚠️', label: 'Escalated', class: 'escalated' },
  failed: { icon: '❌', label: 'Failed', class: 'failed' },
  not_reproduced: { icon: '🤷', label: 'Not Reproduced', class: 'failed' },
};

async function fetchFailures() {
  try {
    const response = await fetch(`${API_BASE}/api/failures`);
    if (!response.ok) throw new Error('Failed to fetch');
    const data = await response.json();
    return data.failures || [];
  } catch (error) {
    console.error('Error fetching failures:', error);
    return [];
  }
}

async function fetchFailureDetails(id) {
  try {
    const response = await fetch(`${API_BASE}/api/failures/${id}`);
    if (!response.ok) throw new Error('Failed to fetch details');
    return await response.json();
  } catch (error) {
    console.error('Error fetching failure details:', error);
    return null;
  }
}

async function fetchStats() {
  try {
    const response = await fetch(`${API_BASE}/api/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return await response.json();
  } catch (error) {
    console.error('Error fetching stats:', error);
    return { total: 0, fixed: 0, in_progress: 0, escalated: 0 };
  }
}

function updateStats(stats) {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-fixed').textContent = stats.fixed;
  document.getElementById('stat-progress').textContent = stats.in_progress;
  document.getElementById('stat-escalated').textContent = stats.escalated;
}

function renderFailures(failures) {
  const container = document.getElementById('failures-list');
  const countEl = document.getElementById('failure-count');

  countEl.textContent = `${failures.length} failure${failures.length !== 1 ? 's' : ''}`;

  if (failures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🎉</div>
        <div>No failures yet. Your CI is healthy!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = failures.map(failure => {
    const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;
    const isSelected = selectedFailureId === failure.id;
    const prText = failure.pr_url ? `Fixed → PR #${failure.pr_url.split('/').pop()}` : status.label;

    return `
      <div class="failure-item ${isSelected ? 'selected' : ''}" onclick="selectFailure(${failure.id})">
        <div class="failure-left">
          <span class="failure-icon">${status.icon}</span>
          <div class="failure-info">
            <div class="repo">${failure.repo}</div>
            <div class="error">${failure.error_type || 'Unknown'} in ${failure.file_path || 'unknown'}</div>
          </div>
        </div>
        <span class="badge ${status.class}">${prText}</span>
      </div>
    `;
  }).join('');
}

async function selectFailure(id) {
  selectedFailureId = id;

  const detailContent = document.getElementById('details-content');
  detailContent.innerHTML = '<div class="empty-state">Loading...</div>';

  const details = await fetchFailureDetails(id);
  if (!details) {
    detailContent.innerHTML = '<div class="empty-state">Failed to load details</div>';
    return;
  }

  renderDetails(details);

  // Re-render failures list to show selection
  const failures = await fetchFailures();
  renderFailures(failures);
}

function renderDetails(details) {
  const { failure, fix_attempts = [] } = details;
  const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;
  const detailContent = document.getElementById('details-content');

  detailContent.innerHTML = `
    <div class="detail-row">
      <div class="detail-label">Repository</div>
      <div class="detail-value">${failure.repo}</div>
    </div>

    <div class="detail-row">
      <div class="detail-label">Error</div>
      <div class="detail-code">${failure.error_type || 'Unknown'} in ${failure.file_path || 'unknown'}${failure.line_number ? ':' + failure.line_number : ''}</div>
    </div>

    <div class="detail-row">
      <div class="detail-label">Status</div>
      <span class="badge ${status.class}">${status.label}</span>
    </div>

    ${failure.pr_url ? `
      <div class="detail-row">
        <div class="detail-label">Pull Request</div>
        <a href="${failure.pr_url}" target="_blank" class="pr-link">PR #${failure.pr_url.split('/').pop()} →</a>
      </div>
    ` : ''}

    ${failure.issue_url ? `
      <div class="detail-row">
        <div class="detail-label">Issue</div>
        <a href="${failure.issue_url}" target="_blank" class="pr-link">Issue #${failure.issue_url.split('/').pop()} →</a>
      </div>
    ` : ''}

    <div class="detail-row">
      <div class="detail-label">Detected</div>
      <div class="detail-value">${getTimeAgo(failure.created_at)}</div>
    </div>

    ${fix_attempts.length > 0 ? `
      <div class="detail-row">
        <div class="detail-label">Fix Attempts</div>
        <div class="detail-value">${fix_attempts.length} attempt${fix_attempts.length !== 1 ? 's' : ''}</div>
      </div>
    ` : ''}
  `;
}

function renderActivity(failures) {
  const container = document.getElementById('activity-list');

  const activities = failures
    .filter(f => f.status !== 'pending')
    .slice(0, 5)
    .map(f => {
      const status = STATUS_CONFIG[f.status] || STATUS_CONFIG.pending;
      let text = '';

      if (f.status === 'fixed') {
        text = `PR merged for ${f.repo.split('/')[1]}`;
      } else if (f.status === 'analyzing') {
        text = `Started analysis on ${f.repo.split('/')[1]} failure`;
      } else if (f.status === 'reproducing') {
        text = `Spawned Docker sandbox for ${f.repo.split('/')[1]}`;
      } else {
        text = `${status.label} - ${f.repo.split('/')[1]}`;
      }

      return { icon: status.icon, text, time: f.completed_at || f.created_at };
    });

  if (activities.length === 0) {
    container.innerHTML = '<div class="empty-state">No recent activity</div>';
    return;
  }

  container.innerHTML = activities.map(a => `
    <div class="activity-item">
      <span class="icon">${a.icon}</span>
      <div>
        <div class="text">${a.text}</div>
        <div class="time">${getTimeAgo(a.time)}</div>
      </div>
    </div>
  `).join('');
}

async function refreshData() {
  const [failures, stats] = await Promise.all([
    fetchFailures(),
    fetchStats()
  ]);

  updateStats(stats);
  renderFailures(failures);
  renderActivity(failures);

  if (selectedFailureId) {
    const details = await fetchFailureDetails(selectedFailureId);
    if (details) renderDetails(details);
  }
}

function getTimeAgo(dateString) {
  if (!dateString) return 'Unknown';

  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min${Math.floor(seconds / 60) !== 1 ? 's' : ''} ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hour${Math.floor(seconds / 3600) !== 1 ? 's' : ''} ago`;
  return `${Math.floor(seconds / 86400)} day${Math.floor(seconds / 86400) !== 1 ? 's' : ''} ago`;
}

function startPolling(intervalMs = 5000) {
  stopPolling();
  pollInterval = setInterval(refreshData, intervalMs);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  refreshData();
  startPolling();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    refreshData();
    startPolling();
  }
});
