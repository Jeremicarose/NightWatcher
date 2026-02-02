/**
 * Nightwatch Dashboard
 * Real-time monitoring of CI failure healing
 */

const API_BASE = '';
let selectedFailureId = null;
let pollInterval = null;
let allFailures = [];
let filteredFailures = [];

// Status configuration with icons and colors
const STATUS_CONFIG = {
  pending: { icon: '!', label: 'Pending', class: 'pending', lucide: 'alert-circle' },
  fetching_logs: { icon: '↓', label: 'Fetching', class: 'analyzing', lucide: 'download' },
  analyzing: { icon: '◎', label: 'Analyzing', class: 'analyzing', lucide: 'search' },
  reproducing: { icon: '▶', label: 'Reproducing', class: 'analyzing', lucide: 'play' },
  generating_test: { icon: '⚗', label: 'Testing', class: 'analyzing', lucide: 'flask-conical' },
  fixing: { icon: '⚙', label: 'Fixing', class: 'analyzing', lucide: 'wrench' },
  creating_pr: { icon: '✎', label: 'Creating PR', class: 'analyzing', lucide: 'git-pull-request' },
  fixed: { icon: '✓', label: 'Fixed', class: 'fixed', lucide: 'check-circle' },
  escalated: { icon: '⚠', label: 'Escalated', class: 'escalated', lucide: 'alert-triangle' },
  failed: { icon: '✕', label: 'Failed', class: 'failed', lucide: 'x-circle' },
  not_reproduced: { icon: '?', label: 'Not Reproduced', class: 'failed', lucide: 'help-circle' },
};

// Error type icons
const ERROR_ICONS = {
  ValueError: { icon: '⚠', class: 'value-error' },
  IndexError: { icon: '🔍', class: 'index-error' },
  TypeError: { icon: '⌧', class: 'type-error' },
  SyntaxError: { icon: '⟨⟩', class: 'syntax-error' },
  default: { icon: '?', class: 'unknown' }
};

// ============ API Functions ============

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

// ============ UI Update Functions ============

function updateStats(stats) {
  document.getElementById('stat-total').textContent = stats.total;
  document.getElementById('stat-fixed').textContent = stats.fixed;
  document.getElementById('stat-progress').textContent = stats.in_progress;
  document.getElementById('stat-escalated').textContent = stats.escalated;
}

function groupFailuresByRepo(failures) {
  const groups = {};
  failures.forEach(failure => {
    const repo = failure.repo || 'unknown';
    if (!groups[repo]) {
      groups[repo] = {
        repo,
        failures: [],
        stats: { total: 0, fixed: 0, progress: 0, pending: 0 }
      };
    }
    groups[repo].failures.push(failure);
    groups[repo].stats.total++;

    if (failure.status === 'fixed') {
      groups[repo].stats.fixed++;
    } else if (['analyzing', 'reproducing', 'generating_test', 'fixing', 'creating_pr', 'fetching_logs'].includes(failure.status)) {
      groups[repo].stats.progress++;
    } else {
      groups[repo].stats.pending++;
    }
  });
  return Object.values(groups);
}

function getErrorIcon(errorType) {
  const type = errorType || 'Unknown';
  for (const [key, value] of Object.entries(ERROR_ICONS)) {
    if (type.toLowerCase().includes(key.toLowerCase())) {
      return value;
    }
  }
  return ERROR_ICONS.default;
}

function renderRepoGroups(failures) {
  const container = document.getElementById('repo-groups');
  const countEl = document.getElementById('failure-count');

  countEl.textContent = `${failures.length} failure${failures.length !== 1 ? 's' : ''}`;

  if (failures.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">
          <i data-lucide="shield-check" style="width: 24px; height: 24px;"></i>
        </div>
        <div class="title">All clear!</div>
        <div class="subtitle">No failures detected. Your CI is healthy.</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const groups = groupFailuresByRepo(failures);

  container.innerHTML = groups.map((group, index) => {
    const repoName = group.repo.split('/').pop() || group.repo;
    const isExpanded = index === 0; // First group expanded by default

    return `
      <div class="repo-group ${isExpanded ? 'expanded' : ''}" data-repo="${group.repo}">
        <div class="repo-header" onclick="toggleRepoGroup(this)">
          <div class="repo-header-left">
            <div class="repo-toggle">
              <i data-lucide="chevron-right" style="width: 16px; height: 16px;"></i>
            </div>
            <div class="repo-icon">
              <i data-lucide="folder-git" style="width: 16px; height: 16px;"></i>
            </div>
            <div class="repo-info">
              <h3>${repoName}</h3>
              <div class="repo-stats">
                ${group.stats.fixed > 0 ? `<span class="stat fixed">✓ ${group.stats.fixed} fixed</span>` : ''}
                ${group.stats.progress > 0 ? `<span class="stat progress">◎ ${group.stats.progress} in progress</span>` : ''}
                ${group.stats.pending > 0 ? `<span class="stat pending">! ${group.stats.pending} pending</span>` : ''}
              </div>
            </div>
          </div>
          <div class="repo-header-right">
            <span class="failure-count-badge">${group.stats.total}</span>
          </div>
        </div>
        <div class="repo-failures">
          ${group.failures.map(failure => renderFailureItem(failure)).join('')}
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function renderFailureItem(failure) {
  const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;
  const isSelected = selectedFailureId === failure.id;
  const errorIcon = getErrorIcon(failure.error_type);
  const errorType = failure.error_type || 'Unknown error';
  const filePath = failure.file_path || 'unknown file';
  const prText = failure.pr_url ? `PR #${failure.pr_url.split('/').pop()}` : status.label;

  const badgeContent = ['analyzing', 'reproducing', 'generating_test', 'fixing', 'creating_pr', 'fetching_logs'].includes(failure.status)
    ? `<span class="spinner"></span>${prText}`
    : prText;

  return `
    <div class="failure-item ${isSelected ? 'selected' : ''}" onclick="selectFailure(${failure.id})" data-failure-id="${failure.id}">
      <div class="failure-left">
        <div class="error-icon ${errorIcon.class}" data-tooltip="${errorType}">
          ${errorIcon.icon}
        </div>
        <div class="failure-info">
          <div class="error-type">${errorType}</div>
          <div class="file-path">${filePath}${failure.line_number ? ':' + failure.line_number : ''}</div>
        </div>
      </div>
      <span class="badge ${status.class}">${badgeContent}</span>
    </div>
  `;
}

function toggleRepoGroup(header) {
  const group = header.closest('.repo-group');
  group.classList.toggle('expanded');
}

async function selectFailure(id) {
  selectedFailureId = id;

  // Update selection in UI
  document.querySelectorAll('.failure-item').forEach(item => {
    item.classList.toggle('selected', parseInt(item.dataset.failureId) === id);
  });

  const detailContent = document.getElementById('details-content');
  detailContent.innerHTML = `
    <div class="skeleton-card">
      <div class="skeleton skeleton-line medium"></div>
      <div class="skeleton skeleton-line short"></div>
    </div>
    <div class="skeleton-card">
      <div class="skeleton skeleton-line full"></div>
      <div class="skeleton skeleton-line medium"></div>
    </div>
  `;

  const details = await fetchFailureDetails(id);
  if (!details) {
    detailContent.innerHTML = `
      <div class="empty-state">
        <div class="icon" style="background: var(--danger-bg);">
          <i data-lucide="alert-circle" style="width: 24px; height: 24px; color: var(--danger);"></i>
        </div>
        <div class="title">Failed to load</div>
        <div class="subtitle">Could not fetch failure details.</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  renderDetails(details);
}

function renderDetails(details) {
  const { failure, fix_attempts = [] } = details;
  const status = STATUS_CONFIG[failure.status] || STATUS_CONFIG.pending;
  const detailContent = document.getElementById('details-content');
  const errorIcon = getErrorIcon(failure.error_type);

  // Build agent timeline
  const timelineSteps = buildAgentTimeline(failure, fix_attempts);

  detailContent.innerHTML = `
    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="folder-git" style="width: 12px; height: 12px;"></i>
        Repository
      </div>
      <div class="detail-value">${failure.repo}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="alert-circle" style="width: 12px; height: 12px;"></i>
        Error
      </div>
      <div class="detail-code">${failure.error_type || 'Unknown'} in ${failure.file_path || 'unknown'}${failure.line_number ? ':' + failure.line_number : ''}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="activity" style="width: 12px; height: 12px;"></i>
        Status
      </div>
      <span class="badge ${status.class}">${status.label}</span>
    </div>

    ${failure.pr_url ? `
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="git-pull-request" style="width: 12px; height: 12px;"></i>
          Pull Request
        </div>
        <a href="${failure.pr_url}" target="_blank" class="pr-link">
          <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
          PR #${failure.pr_url.split('/').pop()}
        </a>
      </div>
    ` : ''}

    ${failure.issue_url ? `
      <div class="detail-section">
        <div class="detail-section-title">
          <i data-lucide="file-warning" style="width: 12px; height: 12px;"></i>
          Issue
        </div>
        <a href="${failure.issue_url}" target="_blank" class="pr-link" style="background: var(--warning-bg); color: var(--warning);">
          <i data-lucide="external-link" style="width: 14px; height: 14px;"></i>
          Issue #${failure.issue_url.split('/').pop()}
        </a>
      </div>
    ` : ''}

    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="clock" style="width: 12px; height: 12px;"></i>
        Detected
      </div>
      <div class="detail-value">${getTimeAgo(failure.created_at)}</div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="bot" style="width: 12px; height: 12px;"></i>
        Agent Actions
      </div>
      <div class="agent-timeline">
        ${timelineSteps}
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">
        <i data-lucide="zap" style="width: 12px; height: 12px;"></i>
        Quick Actions
      </div>
      <div class="detail-actions">
        ${failure.pr_url ? `
          <a href="${failure.pr_url}" target="_blank" class="action-btn primary">
            <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>
            View PR
          </a>
        ` : ''}
        <button class="action-btn" onclick="viewOnGitHub('${failure.repo}', '${failure.file_path}')">
          <i data-lucide="github" style="width: 12px; height: 12px;"></i>
          View Code
        </button>
        ${!['fixed', 'escalated'].includes(failure.status) ? `
          <button class="action-btn" onclick="showToast('info', 'Retry', 'Retry feature coming soon')">
            <i data-lucide="refresh-cw" style="width: 12px; height: 12px;"></i>
            Retry Fix
          </button>
        ` : ''}
        ${!['escalated'].includes(failure.status) ? `
          <button class="action-btn" onclick="showToast('warning', 'Escalated', 'This failure has been escalated to humans')">
            <i data-lucide="user" style="width: 12px; height: 12px;"></i>
            Escalate
          </button>
        ` : ''}
      </div>
    </div>
  `;

  lucide.createIcons();
}

function buildAgentTimeline(failure, fix_attempts) {
  const steps = [];
  const status = failure.status;

  // Detected
  steps.push({
    text: 'Failure detected in CI',
    time: failure.created_at,
    status: 'completed'
  });

  // Based on current status, show what has happened
  const statusOrder = ['pending', 'fetching_logs', 'analyzing', 'reproducing', 'generating_test', 'fixing', 'creating_pr', 'fixed'];
  const currentIndex = statusOrder.indexOf(status);

  if (currentIndex >= 1 || status === 'fixed') {
    steps.push({
      text: 'Fetched CI logs',
      time: null,
      status: currentIndex > 1 || status === 'fixed' ? 'completed' : 'active'
    });
  }

  if (currentIndex >= 2 || status === 'fixed') {
    steps.push({
      text: 'Analyzed with Gemini AI',
      time: null,
      status: currentIndex > 2 || status === 'fixed' ? 'completed' : 'active'
    });
  }

  if (currentIndex >= 3 || status === 'fixed') {
    steps.push({
      text: 'Reproduced in Docker sandbox',
      time: null,
      status: currentIndex > 3 || status === 'fixed' ? 'completed' : 'active'
    });
  }

  if (currentIndex >= 4 || status === 'fixed') {
    steps.push({
      text: 'Generated regression test',
      time: null,
      status: currentIndex > 4 || status === 'fixed' ? 'completed' : 'active'
    });
  }

  if (currentIndex >= 5 || status === 'fixed') {
    steps.push({
      text: `Applied fix (attempt ${fix_attempts.length || 1})`,
      time: null,
      status: currentIndex > 5 || status === 'fixed' ? 'completed' : 'active'
    });
  }

  if (status === 'fixed') {
    steps.push({
      text: 'Created pull request',
      time: failure.completed_at,
      status: 'completed'
    });
  } else if (status === 'creating_pr') {
    steps.push({
      text: 'Creating pull request...',
      time: null,
      status: 'active'
    });
  }

  if (status === 'escalated') {
    steps.push({
      text: 'Escalated to human review',
      time: failure.completed_at,
      status: 'failed'
    });
  }

  if (status === 'failed' || status === 'not_reproduced') {
    steps.push({
      text: status === 'not_reproduced' ? 'Could not reproduce failure' : 'Fix attempt failed',
      time: failure.completed_at,
      status: 'failed'
    });
  }

  return steps.map(step => `
    <div class="timeline-item ${step.status}">
      <div class="timeline-text">${step.text}</div>
      ${step.time ? `<div class="timeline-time">${getTimeAgo(step.time)}</div>` : ''}
    </div>
  `).join('');
}

function viewOnGitHub(repo, filePath) {
  const url = `https://github.com/${repo}/blob/main/${filePath || ''}`;
  window.open(url, '_blank');
}

function renderActivity(failures) {
  const container = document.getElementById('activity-list');

  const activities = failures
    .filter(f => f.status !== 'pending')
    .slice(0, 8)
    .map(f => {
      const status = STATUS_CONFIG[f.status] || STATUS_CONFIG.pending;
      let text = '';
      let iconClass = 'analyzing';
      let lucideIcon = 'activity';

      if (f.status === 'fixed') {
        text = `Auto-fixed ${f.error_type || 'error'} in ${f.repo.split('/')[1]}`;
        iconClass = 'merged';
        lucideIcon = 'check-circle';
      } else if (f.status === 'analyzing') {
        text = `Analyzing failure in ${f.repo.split('/')[1]}`;
        iconClass = 'analyzing';
        lucideIcon = 'search';
      } else if (f.status === 'reproducing') {
        text = `Reproducing in Docker: ${f.repo.split('/')[1]}`;
        iconClass = 'analyzing';
        lucideIcon = 'play';
      } else if (f.status === 'escalated') {
        text = `Escalated ${f.error_type || 'error'} in ${f.repo.split('/')[1]}`;
        iconClass = 'escalated';
        lucideIcon = 'alert-triangle';
      } else if (f.status === 'failed') {
        text = `Fix failed for ${f.repo.split('/')[1]}`;
        iconClass = 'failed';
        lucideIcon = 'x-circle';
      } else {
        text = `${status.label}: ${f.repo.split('/')[1]}`;
      }

      return { iconClass, lucideIcon, text, time: f.completed_at || f.created_at };
    });

  if (activities.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="subtitle">No recent activity</div></div>';
    return;
  }

  container.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-icon ${a.iconClass}">
        <i data-lucide="${a.lucideIcon}" style="width: 16px; height: 16px;"></i>
      </div>
      <div class="activity-content">
        <div class="activity-text">${a.text}</div>
        <div class="activity-time">${getTimeAgo(a.time)}</div>
      </div>
    </div>
  `).join('');

  lucide.createIcons();
}

function renderConnectedRepos(failures) {
  const container = document.getElementById('repos-list');
  const repos = [...new Set(failures.map(f => f.repo))];

  if (repos.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 1.5rem;">
        <div class="subtitle">No repos connected yet</div>
      </div>
      <button class="add-repo-btn" onclick="showToast('info', 'Add Repo', 'Install the GitHub App on your repos to get started')">
        <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
        Add Repository
      </button>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = repos.slice(0, 5).map(repo => `
    <div class="connected-repo">
      <div class="connected-repo-left">
        <div class="connected-repo-icon">
          <i data-lucide="folder-git" style="width: 14px; height: 14px;"></i>
        </div>
        <span class="connected-repo-name">${repo.split('/').pop()}</span>
      </div>
      <div class="connected-repo-status" data-tooltip="Connected"></div>
    </div>
  `).join('') + `
    <button class="add-repo-btn" onclick="showToast('info', 'Add Repo', 'Install the GitHub App on more repos')">
      <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
      Add Repository
    </button>
  `;

  lucide.createIcons();
}

// ============ Search & Filter ============

function handleSearch() {
  const query = document.getElementById('search-input').value.toLowerCase();
  applyFilters();
}

function handleFilter() {
  applyFilters();
}

function applyFilters() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const statusFilter = document.getElementById('status-filter').value;
  const timeFilter = document.getElementById('time-filter').value;

  filteredFailures = allFailures.filter(failure => {
    // Search filter
    const matchesSearch = !query ||
      (failure.repo && failure.repo.toLowerCase().includes(query)) ||
      (failure.error_type && failure.error_type.toLowerCase().includes(query)) ||
      (failure.file_path && failure.file_path.toLowerCase().includes(query));

    // Status filter
    let matchesStatus = statusFilter === 'all';
    if (statusFilter === 'analyzing') {
      matchesStatus = ['analyzing', 'reproducing', 'generating_test', 'fixing', 'creating_pr', 'fetching_logs'].includes(failure.status);
    } else if (statusFilter !== 'all') {
      matchesStatus = failure.status === statusFilter;
    }

    // Time filter
    let matchesTime = timeFilter === 'all';
    if (timeFilter !== 'all') {
      const createdAt = new Date(failure.created_at);
      const now = new Date();
      const diffHours = (now - createdAt) / (1000 * 60 * 60);

      if (timeFilter === '24h') matchesTime = diffHours <= 24;
      else if (timeFilter === '7d') matchesTime = diffHours <= 168;
      else if (timeFilter === '30d') matchesTime = diffHours <= 720;
    }

    return matchesSearch && matchesStatus && matchesTime;
  });

  renderRepoGroups(filteredFailures);
}

// ============ Toast Notifications ============

function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  const iconMap = {
    success: 'check-circle',
    info: 'info',
    warning: 'alert-triangle',
    error: 'alert-circle'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">
      <i data-lucide="${iconMap[type]}" style="width: 14px; height: 14px;"></i>
    </div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============ Data Refresh ============

async function refreshData() {
  const [failures, stats] = await Promise.all([
    fetchFailures(),
    fetchStats()
  ]);

  // Check for new failures to show toast
  if (allFailures.length > 0 && failures.length > allFailures.length) {
    const newFailure = failures[0];
    showToast('error', 'New Failure', `Detected in ${newFailure.repo.split('/').pop()}`);
  }

  // Check for newly fixed
  const previousFixed = allFailures.filter(f => f.status === 'fixed').length;
  const currentFixed = failures.filter(f => f.status === 'fixed').length;
  if (previousFixed > 0 && currentFixed > previousFixed) {
    const fixedFailure = failures.find(f => f.status === 'fixed');
    showToast('success', 'Auto-Fixed!', `PR created for ${fixedFailure?.repo.split('/').pop() || 'repo'}`);
  }

  allFailures = failures;

  updateStats(stats);
  applyFilters();
  renderActivity(failures);
  renderConnectedRepos(failures);

  if (selectedFailureId) {
    const details = await fetchFailureDetails(selectedFailureId);
    if (details) renderDetails(details);
  }
}

async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('loading');
  await refreshData();
  btn.classList.remove('loading');
  showToast('info', 'Refreshed', 'Dashboard data updated');
}

// ============ Utilities ============

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

function dismissWelcome() {
  const banner = document.getElementById('welcome-banner');
  banner.classList.add('hidden');
  localStorage.setItem('nightwatch-welcome-dismissed', 'true');
}

function checkWelcomeBanner() {
  const dismissed = localStorage.getItem('nightwatch-welcome-dismissed');
  if (dismissed) {
    document.getElementById('welcome-banner').classList.add('hidden');
  }
}

// ============ Polling ============

function startPolling(intervalMs = 5000) {
  stopPolling();
  const autoRefresh = document.getElementById('auto-refresh');
  if (autoRefresh && autoRefresh.checked) {
    pollInterval = setInterval(refreshData, intervalMs);
  }
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ============ Initialization ============

document.addEventListener('DOMContentLoaded', () => {
  checkWelcomeBanner();
  refreshData();
  startPolling();

  // Auto-refresh toggle
  const autoRefresh = document.getElementById('auto-refresh');
  if (autoRefresh) {
    autoRefresh.addEventListener('change', () => {
      if (autoRefresh.checked) {
        startPolling();
      } else {
        stopPolling();
      }
    });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    refreshData();
    startPolling();
  }
});

// Make functions available globally
window.selectFailure = selectFailure;
window.toggleRepoGroup = toggleRepoGroup;
window.manualRefresh = manualRefresh;
window.dismissWelcome = dismissWelcome;
window.viewOnGitHub = viewOnGitHub;
window.showToast = showToast;
window.handleSearch = handleSearch;
window.handleFilter = handleFilter;
