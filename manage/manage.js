/**
 * TabStash — 管理頁面互動邏輯
 * 完整的 session 管理介面
 */

// ---- DOM ----
const DOM = {
  // Sidebar
  navItems: document.querySelectorAll('.nav-item'),
  navAllCount: document.getElementById('nav-all-count'),
  navTodayCount: document.getElementById('nav-today-count'),
  navYesterdayCount: document.getElementById('nav-yesterday-count'),
  navWeekCount: document.getElementById('nav-week-count'),
  navOlderCount: document.getElementById('nav-older-count'),
  totalSessions: document.getElementById('total-sessions'),
  totalTabs: document.getElementById('total-tabs'),

  // Search
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),

  // Actions
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  importFile: document.getElementById('import-file'),

  // Content
  contentTitle: document.getElementById('content-title'),
  contentCount: document.getElementById('content-count'),
  sessionsGrid: document.getElementById('sessions-grid'),
  emptyState: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
};

// ---- State ----
let allSessions = [];
let currentFilter = 'all';
let searchQuery = '';

// ---- Message Helper ----
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve(response);
      }
    });
  });
}

// ---- Toast ----
let toastTimer = null;
function showToast(message, type = 'success') {
  clearTimeout(toastTimer);
  DOM.toast.className = 'toast show ' + type;
  DOM.toastMessage.textContent = message;
  toastTimer = setTimeout(() => {
    DOM.toast.className = 'toast';
  }, 3000);
}

// ---- Confirm Dialog ----
function showConfirm(title, message, confirmText = '確認', isDanger = true) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="confirm-dialog-actions">
          <button class="btn-cancel">取消</button>
          <button class="btn-confirm ${isDanger ? '' : 'primary'}">${confirmText}</button>
        </div>
      </div>
    `;
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('.btn-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.btn-confirm').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.body.appendChild(overlay);
  });
}

// ---- Helpers ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  if (diffHours < 24) return `${diffHours} 小時前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ---- Date Grouping ----
function getDateBucket(isoString) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const created = new Date(isoString);

  if (created >= today) return 'today';
  if (created >= yesterday) return 'yesterday';
  if (created >= weekStart) return 'week';
  if (created >= monthStart) return 'month';
  return 'older';
}

function groupSessionsByDate(sessions) {
  const groups = [
    { key: 'today',     label: '今天',   icon: '📌', sessions: [] },
    { key: 'yesterday', label: '昨天',   icon: '🕐', sessions: [] },
    { key: 'week',      label: '本週',   icon: '📅', sessions: [] },
    { key: 'month',     label: '本月',   icon: '🗓️', sessions: [] },
    { key: 'older',     label: '更早',   icon: '📦', sessions: [] },
  ];

  for (const session of sessions) {
    const bucket = getDateBucket(session.createdAt);
    const group = groups.find(g => g.key === bucket);
    if (group) group.sessions.push(session);
  }

  return groups.filter(g => g.sessions.length > 0);
}

// ---- Filter & Search ----
function getFilteredSessions() {
  let sessions = allSessions;

  // Apply date filter
  if (currentFilter !== 'all') {
    sessions = sessions.filter(s => {
      const bucket = getDateBucket(s.createdAt);
      if (currentFilter === 'older') return bucket === 'older' || bucket === 'month';
      return bucket === currentFilter;
    });
  }

  // Apply search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    sessions = sessions.filter(s => {
      if (s.name.toLowerCase().includes(q)) return true;
      return s.tabs.some(t =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.url && t.url.toLowerCase().includes(q))
      );
    });
  }

  return sessions;
}

// ---- Update Sidebar Counts ----
function updateSidebarCounts() {
  const counts = { today: 0, yesterday: 0, week: 0, month: 0, older: 0 };
  let totalTabCount = 0;

  for (const session of allSessions) {
    const bucket = getDateBucket(session.createdAt);
    counts[bucket] = (counts[bucket] || 0) + 1;
    totalTabCount += session.tabs.length;
  }

  DOM.navAllCount.textContent = allSessions.length;
  DOM.navTodayCount.textContent = counts.today;
  DOM.navYesterdayCount.textContent = counts.yesterday;
  DOM.navWeekCount.textContent = counts.week;
  DOM.navOlderCount.textContent = counts.older + counts.month;
  DOM.totalSessions.textContent = allSessions.length;
  DOM.totalTabs.textContent = totalTabCount;
}

// ---- Render Session Card ----
function renderSessionCard(session) {
  const defaultFavicon = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%23333%22/></svg>";

  return `
    <div class="session-card" data-session-id="${session.id}">
      <div class="session-card-header" data-action="toggle">
        <div class="session-card-info">
          <div class="session-card-name" data-action="name">${escapeHtml(session.name)}</div>
          <div class="session-card-meta">
            <span class="session-card-date">${formatDate(session.createdAt)}</span>
            <span class="session-card-tab-count">${session.tabs.length} 個分頁</span>
          </div>
        </div>
        <div class="session-card-actions">
          <button class="icon-btn restore" data-action="restore" title="還原所有分頁">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="1 4 1 10 7 10"></polyline>
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
            </svg>
          </button>
          <button class="icon-btn" data-action="rename" title="重新命名">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="icon-btn danger" data-action="delete" title="刪除">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <svg class="session-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="session-tabs">
        ${session.tabs.map((tab, i) => `
          <div class="session-tab-item" data-action="open-tab" data-tab-index="${i}">
            <img class="session-tab-favicon" src="${tab.favIconUrl || defaultFavicon}" alt="" onerror="this.src='${defaultFavicon}'">
            <span class="session-tab-title">${escapeHtml(tab.title || tab.url)}</span>
            <span class="session-tab-url">${escapeHtml(new URL(tab.url).hostname)}</span>
            <button class="session-tab-remove" data-action="remove-tab" data-tab-index="${i}" title="移除">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

// ---- Render All ----
function render() {
  const filtered = getFilteredSessions();

  updateSidebarCounts();

  // Update content header
  const filterLabels = {
    all: '所有 Sessions',
    today: '今天',
    yesterday: '昨天',
    week: '本週',
    older: '更早',
  };
  DOM.contentTitle.textContent = filterLabels[currentFilter] || '所有 Sessions';

  if (filtered.length === 0) {
    DOM.sessionsGrid.classList.add('hidden');
    DOM.emptyState.classList.remove('hidden');
    DOM.emptyTitle.textContent = searchQuery
      ? `找不到符合「${searchQuery}」的結果`
      : '此分類尚無 Sessions';
    DOM.contentCount.textContent = `0 個 sessions`;
    return;
  }

  DOM.sessionsGrid.classList.remove('hidden');
  DOM.emptyState.classList.add('hidden');
  DOM.contentCount.textContent = searchQuery
    ? `${filtered.length}/${allSessions.length} 個 sessions`
    : `${filtered.length} 個 sessions`;

  // Group by date for "all" filter, flat list for specific filters
  if (currentFilter === 'all') {
    const groups = groupSessionsByDate(filtered);
    DOM.sessionsGrid.innerHTML = groups.map(group => `
      <div class="date-group" data-group="${group.key}">
        <div class="date-group-header" data-action="toggle-group">
          <span class="date-group-icon">${group.icon}</span>
          <span class="date-group-label">${group.label}</span>
          <span class="date-group-count">${group.sessions.length}</span>
          <div class="date-group-line"></div>
          <svg class="date-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
        <div class="date-group-body">
          ${group.sessions.map(s => renderSessionCard(s)).join('')}
        </div>
      </div>
    `).join('');
  } else {
    DOM.sessionsGrid.innerHTML = `
      <div class="date-group-body">
        ${filtered.map(s => renderSessionCard(s)).join('')}
      </div>
    `;
  }

  // Date group toggle
  DOM.sessionsGrid.querySelectorAll('[data-action="toggle-group"]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.date-group').classList.toggle('collapsed');
    });
  });
}

// ---- Load Data ----
async function loadData() {
  try {
    const result = await sendMessage({ action: 'getSessions' });
    allSessions = result.sessions || [];
    render();
  } catch (error) {
    console.error('Failed to load:', error);
    showToast('載入失敗', 'error');
  }
}

// ---- Event Handlers ----

// Sidebar navigation
DOM.navItems.forEach(item => {
  item.addEventListener('click', () => {
    DOM.navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    currentFilter = item.dataset.filter;
    render();
  });
});

// Search
let searchDebounce = null;
DOM.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = DOM.searchInput.value.trim();
    DOM.searchClear.classList.toggle('hidden', !searchQuery);
    render();
  }, 200);
});

DOM.searchClear.addEventListener('click', () => {
  DOM.searchInput.value = '';
  searchQuery = '';
  DOM.searchClear.classList.add('hidden');
  render();
  DOM.searchInput.focus();
});

DOM.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    DOM.searchInput.value = '';
    searchQuery = '';
    DOM.searchClear.classList.add('hidden');
    render();
  }
});

// Session card event delegation
DOM.sessionsGrid.addEventListener('click', async (e) => {
  const card = e.target.closest('.session-card');
  if (!card) return;

  const sessionId = card.dataset.sessionId;
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  switch (action) {
    case 'toggle': {
      if (e.target.closest('.session-card-actions')) return;
      card.classList.toggle('expanded');
      break;
    }

    case 'restore': {
      e.stopPropagation();
      const session = allSessions.find(s => s.id === sessionId);
      if (!session) return;
      const result = await sendMessage({
        action: 'restoreSession',
        sessionId,
        options: { newWindow: false, removeAfterRestore: false },
      });
      if (result.error) showToast(result.error, 'error');
      else showToast(`已還原 ${session.tabs.length} 個分頁 🎉`, 'success');
      break;
    }

    case 'rename': {
      e.stopPropagation();
      const nameEl = card.querySelector('.session-card-name');
      const currentName = nameEl.textContent;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-rename-input';
      input.value = currentName;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const finish = async () => {
        const newName = input.value.trim() || currentName;
        const el = document.createElement('div');
        el.className = 'session-card-name';
        el.setAttribute('data-action', 'name');
        el.textContent = newName;
        input.replaceWith(el);
        if (newName !== currentName) {
          await sendMessage({ action: 'renameSession', sessionId, newName });
          showToast('已重新命名', 'success');
          await loadData();
        }
      };

      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') input.blur();
        if (ev.key === 'Escape') { input.value = currentName; input.blur(); }
      });
      break;
    }

    case 'delete': {
      e.stopPropagation();
      const confirmed = await showConfirm('刪除 Session', '確定要刪除嗎？此操作無法復原。', '刪除');
      if (confirmed) {
        await sendMessage({ action: 'deleteSession', sessionId });
        showToast('已刪除', 'success');
        await loadData();
      }
      break;
    }

    case 'open-tab': {
      const tabIndex = parseInt(actionEl.dataset.tabIndex);
      await sendMessage({ action: 'restoreSingleTab', sessionId, tabIndex });
      break;
    }

    case 'remove-tab': {
      e.stopPropagation();
      const tabIndex = parseInt(actionEl.dataset.tabIndex);
      await sendMessage({ action: 'removeTabFromSession', sessionId, tabIndex });
      showToast('已移除分頁', 'success');
      await loadData();
      break;
    }
  }
});

// Export
DOM.btnExport.addEventListener('click', async () => {
  try {
    const data = await sendMessage({ action: 'exportData' });
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tabstash-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('資料已匯出 📦', 'success');
  } catch (error) {
    showToast('匯出失敗', 'error');
  }
});

// Import
DOM.btnImport.addEventListener('click', () => DOM.importFile.click());

DOM.importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const confirmed = await showConfirm(
      '匯入資料',
      `將匯入 ${data.sessions?.length || 0} 個 Sessions，與現有資料合併。`,
      '匯入',
      false
    );
    if (confirmed) {
      await sendMessage({ action: 'importData', data, strategy: 'merge' });
      showToast('資料已匯入 ✨', 'success');
      await loadData();
    }
  } catch (error) {
    showToast('匯入失敗：格式不正確', 'error');
  }
  DOM.importFile.value = '';
});

// ---- Read URL params for initial filter ----
const urlParams = new URLSearchParams(window.location.search);
const filterParam = urlParams.get('filter');
if (filterParam && ['all', 'today', 'yesterday', 'week', 'older'].includes(filterParam)) {
  currentFilter = filterParam;
  DOM.navItems.forEach(n => {
    n.classList.toggle('active', n.dataset.filter === filterParam);
  });
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', loadData);
