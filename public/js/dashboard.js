/**
 * Nightwatch Dashboard
 * Real-time monitoring of CI failure healing
 */

const API_BASE = '';
let selectedFailureId = null;
let pollInterval = null;

// Status configurations
const STATUS_CONFIG = {
  pending: { icon: '⏳', label: 'Pending', color: 'text-gray-400', bg: 'bg-gray-500' },
  fetching_logs: { icon: '📥', label: 'Fetching Logs', color: 'text-blue-400', bg: 'bg-blue-500' },
  analyzing: { icon: '🔍', label: 'Analyzing', color: 'text-blue-400', bg: 'bg-blue-500', animate: true },
  reproducing: { icon: '🐳', label: 'Reproducing', color: 'text-blue-400', bg: 'bg-blue-500', animate: true },
  generating_test: { icon: '🧪', label: 'Generating Test', color: 'text-purple-400', bg: 'bg-purple-500', animate: true },
  fixing: { icon: '🔧', label: 'Fixing', color: 'text-yellow-400', bg: 'bg-yellow-500', animate: true },
  creating_pr: { icon: '📝', label: 'Creating PR', color: 'text-green-400', bg: 'bg-green-500', animate: true },
  fixed: { icon: '✅', label: 'Fixed', color: 'text-green-400', bg: 'bg-green-500' },
  escalated: { icon: '🚨', label: 'Escalated', color: 'text-yellow-400', bg: 'bg-yellow-500' },
  failed: { icon: '❌', label: 'Failed', color: 'text-red-400', bg: 'bg-red-500' },
  not_reproduced: { icon: '🤷', label: 'Not Reproduced', color: 'text-gray-400', bg: 'bg-gray-500' },
};

/**
 * Fetch failures from API
 */
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

/**
 * Fetch single failure with details
 */
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

/**
 * Fetch statistics
 */
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

/**
 * Update statistics display
 */
function updateStats(stats) {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-fixed').textContent = stats.fixed;
  document.getElementById('stat-progress').textContent = stats.in_progress;
  document.getElementById('stat-escalated').textContent = stats.escalated;
}

/**
 * Render failures list
 */
function renderFailures(failures) {
  const container = document.getElementById('failures-list');
  const countEl = document.getElementById('failure-count');

  countEl.textContent = `${failures.length} failure${failures.length !== 1 ? 's' : ''}`;

  if (failures.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <div class="text-4xl mb-2">🎉</div>
        <div>No failures yet. Your CI is healthy!</div>
      </div>
    `;
    return;
  }

  container.innerHTML = failures.map(failure => {
    const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;
    const isSelected = selectedFailureId === failure.id;
    const timeAgo = getTimeAgo(failure.created_at);

    return `
      <div
        class="p-4 hover:bg-night-800 cursor-pointer transition ${isSelected ? 'bg-night-800 border-l-2 border-blue-500' : ''} ${status.animate ? 'status-analyzing' : ''}"
        onclick="selectFailure(${failure.id})"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-lg">${status.icon}</span>
              <span class="font-medium truncate">${failure.repo}</span>
            </div>
            <div class="text-sm text-gray-400 truncate">
              ${failure.error_type || 'Unknown error'}
              ${failure.file_path ? `in <code class="text-blue-400">${failure.file_path}</code>` : ''}
            </div>
            <div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
              <span>${timeAgo}</span>
              <span>SHA: ${failure.sha?.substring(0, 7) || 'N/A'}</span>
              ${failure.branch ? `<span class="px-1.5 py-0.5 bg-night-700 rounded">${failure.branch}</span>` : ''}
            </div>
          </div>
          <div class="flex flex-col items-end gap-2">
            <span class="px-2 py-1 text-xs rounded-full ${status.bg}/20 ${status.color}">
              ${status.label}
            </span>
            ${failure.pr_url ? `
              <a href="${failure.pr_url}" target="_blank" class="text-xs text-green-400 hover:underline" onclick="event.stopPropagation()">
                View PR →
              </a>
            ` : ''}
            ${failure.issue_url ? `
              <a href="${failure.issue_url}" target="_blank" class="text-xs text-yellow-400 hover:underline" onclick="event.stopPropagation()">
                View Issue →
              </a>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Select a failure and show details
 */
async function selectFailure(id) {
  selectedFailureId = id;

  // Update selection in list
  document.querySelectorAll('#failures-list > div').forEach(el => {
    el.classList.remove('bg-night-800', 'border-l-2', 'border-blue-500');
  });

  const detailContent = document.getElementById('detail-content');
  detailContent.innerHTML = '<div class="text-center py-8"><div class="animate-spin text-2xl">⏳</div></div>';

  const details = await fetchFailureDetails(id);
  if (!details) {
    detailContent.innerHTML = '<div class="text-red-400">Failed to load details</div>';
    return;
  }

  renderDetails(details);
}

/**
 * Render failure details
 */
function renderDetails(details) {
  const { failure, fix_attempts = [], generated_test } = details;
  const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;

  const detailContent = document.getElementById('detail-content');

  detailContent.innerHTML = `
    <div class="animate-slide-in">
      <!-- Header -->
      <div class="flex items-center gap-2 mb-4">
        <span class="text-2xl">${status.icon}</span>
        <span class="text-lg font-semibold ${status.color}">${status.label}</span>
      </div>

      <!-- Error Info -->
      <div class="bg-night-800 rounded-lg p-3 mb-4">
        <div class="text-sm text-gray-400 mb-1">Error Type</div>
        <div class="font-mono text-red-400">${failure.error_type || 'Unknown'}</div>
      </div>

      ${failure.file_path ? `
        <div class="bg-night-800 rounded-lg p-3 mb-4">
          <div class="text-sm text-gray-400 mb-1">Location</div>
          <div class="font-mono text-blue-400">${failure.file_path}${failure.line_number ? `:${failure.line_number}` : ''}</div>
          ${failure.function_name ? `<div class="text-sm text-gray-500 mt-1">in ${failure.function_name}()</div>` : ''}
        </div>
      ` : ''}

      ${failure.error_message ? `
        <div class="bg-night-800 rounded-lg p-3 mb-4">
          <div class="text-sm text-gray-400 mb-1">Message</div>
          <div class="text-sm text-gray-300 break-words">${escapeHtml(failure.error_message)}</div>
        </div>
      ` : ''}

      ${failure.confidence ? `
        <div class="mb-4">
          <div class="text-sm text-gray-400 mb-1">AI Confidence</div>
          <div class="w-full bg-night-700 rounded-full h-2">
            <div class="h-2 rounded-full ${failure.confidence > 0.7 ? 'bg-green-500' : failure.confidence > 0.4 ? 'bg-yellow-500' : 'bg-red-500'}"
                 style="width: ${failure.confidence * 100}%"></div>
          </div>
          <div class="text-xs text-gray-500 mt-1">${(failure.confidence * 100).toFixed(0)}%</div>
        </div>
      ` : ''}

      <!-- Fix Attempts -->
      ${fix_attempts.length > 0 ? `
        <div class="mb-4">
          <div class="text-sm text-gray-400 mb-2">Fix Attempts (${fix_attempts.length})</div>
          <div class="space-y-2">
            ${fix_attempts.map(attempt => `
              <div class="bg-night-800 rounded-lg p-3">
                <div class="flex items-center justify-between mb-2">
                  <span class="text-sm font-medium">Attempt #${attempt.attempt_number}</span>
                  <span class="${attempt.test_result === 'pass' ? 'text-green-400' : 'text-red-400'}">
                    ${attempt.test_result === 'pass' ? '✅ Passed' : '❌ Failed'}
                  </span>
                </div>
                ${attempt.explanation ? `<div class="text-xs text-gray-400">${escapeHtml(attempt.explanation)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Generated Test -->
      ${generated_test ? `
        <div class="mb-4">
          <div class="text-sm text-gray-400 mb-2">Generated Test</div>
          <div class="bg-night-800 rounded-lg p-3">
            <div class="font-mono text-sm text-purple-400 mb-2">${generated_test.test_name}</div>
            <pre class="text-xs bg-night-950 p-2 rounded overflow-x-auto"><code>${escapeHtml(generated_test.test_code)}</code></pre>
          </div>
        </div>
      ` : ''}

      <!-- Links -->
      <div class="flex gap-2 mt-4">
        ${failure.pr_url ? `
          <a href="${failure.pr_url}" target="_blank" class="flex-1 text-center px-3 py-2 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30 transition text-sm">
            View PR
          </a>
        ` : ''}
        ${failure.issue_url ? `
          <a href="${failure.issue_url}" target="_blank" class="flex-1 text-center px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 transition text-sm">
            View Issue
          </a>
        ` : ''}
      </div>
    </div>
  `;
}

/**
 * Render activity timeline
 */
function renderTimeline(failures) {
  const container = document.getElementById('activity-timeline');

  // Get recent activity (last 10 status changes)
  const activities = failures
    .filter(f => f.status !== 'pending')
    .slice(0, 10)
    .map(f => ({
      time: f.completed_at || f.created_at,
      repo: f.repo,
      status: f.status,
      error_type: f.error_type,
    }));

  if (activities.length === 0) {
    container.innerHTML = '<div class="text-gray-500 text-center py-4">No recent activity</div>';
    return;
  }

  container.innerHTML = `
    <div class="space-y-3">
      ${activities.map(activity => {
        const status = STATUS_CONFIG[activity.status] || STATUS_CONFIG.pending;
        return `
          <div class="flex items-center gap-3 text-sm">
            <span class="w-2 h-2 rounded-full ${status.bg}"></span>
            <span class="text-gray-500 w-24">${getTimeAgo(activity.time)}</span>
            <span class="${status.color}">${status.icon} ${status.label}</span>
            <span class="text-gray-400 truncate">${activity.repo}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Refresh all data
 */
async function refreshData() {
  const [failures, stats] = await Promise.all([
    fetchFailures(),
    fetchStats()
  ]);

  updateStats(stats);
  renderFailures(failures);
  renderTimeline(failures);

  // Refresh details if one is selected
  if (selectedFailureId) {
    const details = await fetchFailureDetails(selectedFailureId);
    if (details) renderDetails(details);
  }
}

/**
 * Get relative time string
 */
function getTimeAgo(dateString) {
  if (!dateString) return 'Unknown';

  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Start polling for updates
 */
function startPolling(intervalMs = 5000) {
  stopPolling();
  pollInterval = setInterval(refreshData, intervalMs);
}

/**
 * Stop polling
 */
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  refreshData();
  startPolling();
});

// Handle visibility change (pause polling when tab is hidden)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    refreshData();
    startPolling();
  }
});
