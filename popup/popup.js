/**
 * TabStash — Popup 互動邏輯
 * 處理 UI 事件、與 Service Worker 通訊
 */

// ---- DOM Elements ----
const DOM = {
  // Views
  viewMain: document.getElementById('view-main'),
  viewSettings: document.getElementById('view-settings'),

  // Header
  btnSettings: document.getElementById('btn-settings'),
  btnBack: document.getElementById('btn-back'),

  // Tab Info
  tabCount: document.getElementById('tab-count'),

  // Collect Button
  btnCollect: document.getElementById('btn-collect'),

  // Quick Settings
  settingExcludePinned: document.getElementById('setting-exclude-pinned'),
  settingCloseAfter: document.getElementById('setting-close-after'),

  // Sessions
  sessionsCount: document.getElementById('sessions-count'),
  sessionsList: document.getElementById('sessions-list'),
  sessionsEmpty: document.getElementById('sessions-empty'),

  // Search
  searchBar: document.getElementById('search-bar'),
  searchInput: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),

  // Settings - Sync
  syncProviderLabel: document.getElementById('sync-provider-label'),
  syncLastTime: document.getElementById('sync-last-time'),
  btnSyncGoogle: document.getElementById('btn-sync-google'),
  btnSyncOnedrive: document.getElementById('btn-sync-onedrive'),
  btnSyncNow: document.getElementById('btn-sync-now'),
  btnSyncDisconnect: document.getElementById('btn-sync-disconnect'),

  // Settings - Data
  btnExport: document.getElementById('btn-export'),
  btnImport: document.getElementById('btn-import'),
  importFile: document.getElementById('import-file'),

  // Toast
  toast: document.getElementById('toast'),
  toastMessage: document.getElementById('toast-message'),
};

// ---- State ----
let currentSessions = [];
let currentSettings = {};
let searchQuery = '';

// ---- Constants ----
const MAX_POPUP_SESSIONS = 10; // Max sessions shown in popup before linking to manage page

// ---- Messaging Helper ----
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
  }, 2500);
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

    const cleanup = (result) => {
      overlay.remove();
      resolve(result);
    };

    overlay.querySelector('.btn-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.btn-confirm').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    document.body.appendChild(overlay);
  });
}

// ---- Format Date ----
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

  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ---- Group Sessions by Date ----
function groupSessionsByDate(sessions) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay()); // Sunday as week start
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const groups = [
    { key: 'today',     label: '今天',   icon: '📌', sessions: [] },
    { key: 'yesterday', label: '昨天',   icon: '🕐', sessions: [] },
    { key: 'week',      label: '本週',   icon: '📅', sessions: [] },
    { key: 'month',     label: '本月',   icon: '🗓️', sessions: [] },
    { key: 'older',     label: '更早',   icon: '📦', sessions: [] },
  ];

  for (const session of sessions) {
    const created = new Date(session.createdAt);
    if (created >= today) {
      groups[0].sessions.push(session);
    } else if (created >= yesterday) {
      groups[1].sessions.push(session);
    } else if (created >= weekStart) {
      groups[2].sessions.push(session);
    } else if (created >= monthStart) {
      groups[3].sessions.push(session);
    } else {
      groups[4].sessions.push(session);
    }
  }

  // Only return groups that have sessions
  return groups.filter(g => g.sessions.length > 0);
}

// ---- Render a single session card ----
function renderSessionCard(session) {
  return `
    <div class="session-card" data-session-id="${session.id}" id="session-${session.id}">
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
        ${session.tabs.map((tab, tabIdx) => `
          <div class="session-tab-item" data-action="open-tab" data-tab-index="${tabIdx}">
            <img class="session-tab-favicon" src="${tab.favIconUrl || 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%23333%22/></svg>'}" alt="" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22><rect width=%2216%22 height=%2216%22 rx=%223%22 fill=%22%23333%22/></svg>'">
            <span class="session-tab-title" title="${escapeHtml(tab.url)}">${escapeHtml(tab.title || tab.url)}</span>
            <button class="session-tab-remove" data-action="remove-tab" data-tab-index="${tabIdx}" title="移除">
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

// ---- Filter sessions by search query ----
function filterSessions(sessions, query) {
  if (!query) return sessions;
  const q = query.toLowerCase();
  return sessions.filter(session => {
    // Match session name
    if (session.name.toLowerCase().includes(q)) return true;
    // Match any tab title or URL
    return session.tabs.some(tab =>
      (tab.title && tab.title.toLowerCase().includes(q)) ||
      (tab.url && tab.url.toLowerCase().includes(q))
    );
  });
}

// ---- Render Sessions (grouped by date, max 10 total) ----
function renderSessions() {
  // Apply search filter
  const filtered = filterSessions(currentSessions, searchQuery);

  if (currentSessions.length === 0) {
    DOM.sessionsList.classList.add('hidden');
    DOM.sessionsEmpty.classList.remove('hidden');
    DOM.searchBar.classList.add('hidden');
    DOM.sessionsCount.textContent = '0';
    return;
  }

  // Show search bar when there are sessions
  DOM.searchBar.classList.remove('hidden');

  if (filtered.length === 0) {
    DOM.sessionsList.innerHTML = `
      <div class="sessions-empty-inline">
        <p>找不到符合「${escapeHtml(searchQuery)}」的結果</p>
      </div>
    `;
    DOM.sessionsList.classList.remove('hidden');
    DOM.sessionsEmpty.classList.add('hidden');
    DOM.sessionsCount.textContent = currentSessions.length;
    return;
  }

  DOM.sessionsList.classList.remove('hidden');
  DOM.sessionsEmpty.classList.add('hidden');
  DOM.sessionsCount.textContent = searchQuery
    ? `${filtered.length}/${currentSessions.length}`
    : currentSessions.length;

  // Limit total sessions shown in popup
  const limitedSessions = filtered.slice(0, MAX_POPUP_SESSIONS);
  const hasMore = filtered.length > MAX_POPUP_SESSIONS;
  const hiddenCount = filtered.length - MAX_POPUP_SESSIONS;

  const groups = groupSessionsByDate(limitedSessions);

  let html = groups.map(group => `
    <div class="session-group" data-group="${group.key}">
      <div class="session-group-header" data-action="toggle-group">
        <div class="session-group-left">
          <span class="session-group-icon">${group.icon}</span>
          <span class="session-group-label">${group.label}</span>
          <span class="session-group-count">${group.sessions.length}</span>
        </div>
        <svg class="session-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="session-group-body">
        ${group.sessions.map(session => renderSessionCard(session)).join('')}
      </div>
    </div>
  `).join('');

  // Add "manage all" button if there are more sessions
  if (hasMore) {
    html += `
      <button class="show-more-btn" id="btn-open-manage">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
        </svg>
        <span>查看全部（還有 ${hiddenCount} 個）</span>
      </button>
    `;
  }

  DOM.sessionsList.innerHTML = html;

  // Add group toggle listeners
  DOM.sessionsList.querySelectorAll('[data-action="toggle-group"]').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.session-group').classList.toggle('collapsed');
    });
  });

  // Add manage page link
  const manageBtn = document.getElementById('btn-open-manage');
  if (manageBtn) {
    manageBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('manage/manage.html') });
    });
  }
}

// ---- Escape HTML ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Load Data ----
async function loadData() {
  try {
    const [sessionsResult, settingsResult, tabCountResult] = await Promise.all([
      sendMessage({ action: 'getSessions' }),
      sendMessage({ action: 'getSettings' }),
      sendMessage({ action: 'getTabCount' }),
    ]);

    currentSessions = sessionsResult.sessions || [];
    currentSettings = settingsResult.settings || {};

    // Update UI
    DOM.tabCount.textContent = tabCountResult.collectable || 0;
    DOM.settingExcludePinned.checked = currentSettings.excludePinned !== false;
    DOM.settingCloseAfter.checked = currentSettings.closeAfterCollect !== false;

    renderSessions();
    updateSyncUI();
  } catch (error) {
    console.error('Failed to load data:', error);
    showToast('載入資料失敗', 'error');
  }
}

// ---- Update Sync UI ----
function updateSyncUI() {
  const provider = currentSettings.syncProvider;

  if (provider) {
    DOM.syncProviderLabel.textContent = provider === 'google-drive' ? 'Google Drive' : 'OneDrive';
    DOM.syncProviderLabel.classList.add('connected');

    if (currentSettings.lastSyncAt) {
      DOM.syncLastTime.textContent = `上次同步：${formatDate(currentSettings.lastSyncAt)}`;
    }

    DOM.btnSyncNow.classList.remove('hidden');
    DOM.btnSyncDisconnect.classList.remove('hidden');

    if (provider === 'google-drive') {
      DOM.btnSyncGoogle.classList.add('active');
      DOM.btnSyncOnedrive.classList.remove('active');
    } else {
      DOM.btnSyncOnedrive.classList.add('active');
      DOM.btnSyncGoogle.classList.remove('active');
    }
  } else {
    DOM.syncProviderLabel.textContent = '尚未連接';
    DOM.syncProviderLabel.classList.remove('connected');
    DOM.syncLastTime.textContent = '';
    DOM.btnSyncNow.classList.add('hidden');
    DOM.btnSyncDisconnect.classList.add('hidden');
    DOM.btnSyncGoogle.classList.remove('active');
    DOM.btnSyncOnedrive.classList.remove('active');
  }
}

// ---- Event Handlers ----

// Navigate to Settings
DOM.btnSettings.addEventListener('click', () => {
  DOM.viewMain.classList.add('hidden');
  DOM.viewSettings.classList.remove('hidden');
});

// Navigate back to Main
DOM.btnBack.addEventListener('click', () => {
  DOM.viewSettings.classList.add('hidden');
  DOM.viewMain.classList.remove('hidden');
});

// Collect Tabs
DOM.btnCollect.addEventListener('click', async () => {
  DOM.btnCollect.classList.add('collecting');

  try {
    const result = await sendMessage({
      action: 'collectTabs',
      options: {
        excludePinned: DOM.settingExcludePinned.checked,
        closeAfterCollect: DOM.settingCloseAfter.checked,
      },
    });

    if (result.error) {
      showToast(result.error, 'error');
    } else {
      showToast(`已收集 ${result.session.tabs.length} 個分頁 ✨`, 'success');
      await loadData();
    }
  } catch (error) {
    showToast('收集失敗', 'error');
  } finally {
    DOM.btnCollect.classList.remove('collecting');
  }
});

// Quick Settings Toggle
DOM.settingExcludePinned.addEventListener('change', async () => {
  await sendMessage({
    action: 'updateSettings',
    updates: { excludePinned: DOM.settingExcludePinned.checked },
  });
  // Refresh tab count
  const result = await sendMessage({ action: 'getTabCount' });
  DOM.tabCount.textContent = result.collectable || 0;
});

DOM.settingCloseAfter.addEventListener('change', async () => {
  await sendMessage({
    action: 'updateSettings',
    updates: { closeAfterCollect: DOM.settingCloseAfter.checked },
  });
});

// Search
let searchDebounce = null;

DOM.searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = DOM.searchInput.value.trim();
    DOM.searchClear.classList.toggle('hidden', !searchQuery);
    renderSessions();
  }, 200);
});

DOM.searchClear.addEventListener('click', () => {
  DOM.searchInput.value = '';
  searchQuery = '';
  DOM.searchClear.classList.add('hidden');
  renderSessions();
  DOM.searchInput.focus();
});

DOM.searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    DOM.searchInput.value = '';
    searchQuery = '';
    DOM.searchClear.classList.add('hidden');
    renderSessions();
  }
});

// Sessions List Event Delegation
DOM.sessionsList.addEventListener('click', async (e) => {
  const sessionCard = e.target.closest('.session-card');
  if (!sessionCard) return;

  const sessionId = sessionCard.dataset.sessionId;
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  switch (action) {
    case 'toggle': {
      // Don't toggle if clicking on actions
      if (e.target.closest('.session-card-actions')) return;
      sessionCard.classList.toggle('expanded');
      break;
    }

    case 'restore': {
      e.stopPropagation();
      const session = currentSessions.find(s => s.id === sessionId);
      if (!session) return;

      const result = await sendMessage({
        action: 'restoreSession',
        sessionId,
        options: { newWindow: false, removeAfterRestore: false },
      });

      if (result.error) {
        showToast(result.error, 'error');
      } else {
        showToast(`已還原 ${session.tabs.length} 個分頁 🎉`, 'success');
      }
      break;
    }

    case 'rename': {
      e.stopPropagation();
      const nameEl = sessionCard.querySelector('.session-card-name');
      const currentName = nameEl.textContent;

      // Replace name with input
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-rename-input';
      input.value = currentName;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const finishRename = async () => {
        const newName = input.value.trim() || currentName;
        const newNameEl = document.createElement('div');
        newNameEl.className = 'session-card-name';
        newNameEl.setAttribute('data-action', 'name');
        newNameEl.textContent = newName;
        input.replaceWith(newNameEl);

        if (newName !== currentName) {
          await sendMessage({ action: 'renameSession', sessionId, newName });
          showToast('已重新命名', 'success');
          await loadData();
        }
      };

      input.addEventListener('blur', finishRename);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          input.value = currentName;
          input.blur();
        }
      });
      break;
    }

    case 'delete': {
      e.stopPropagation();
      const confirmed = await showConfirm(
        '刪除 Session',
        '確定要刪除這個 Session 嗎？此操作無法復原。',
        '刪除',
        true
      );
      if (confirmed) {
        await sendMessage({ action: 'deleteSession', sessionId });
        showToast('已刪除 Session', 'success');
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

// Sync Buttons
DOM.btnSyncGoogle.addEventListener('click', async () => {
  showToast('Google Drive 同步功能即將推出 🚀', 'success');
  // Phase 2: Will implement Google Drive OAuth flow
});

DOM.btnSyncOnedrive.addEventListener('click', async () => {
  showToast('OneDrive 同步功能即將推出 🚀', 'success');
  // Phase 2: Will implement OneDrive OAuth flow
});

DOM.btnSyncNow.addEventListener('click', async () => {
  showToast('同步功能即將推出 🚀', 'success');
  // Phase 2: Will trigger sync
});

DOM.btnSyncDisconnect.addEventListener('click', async () => {
  const confirmed = await showConfirm(
    '中斷連接',
    '確定要中斷雲端同步嗎？本機資料不會被刪除。',
    '中斷連接',
    true
  );
  if (confirmed) {
    await sendMessage({
      action: 'updateSettings',
      updates: { syncProvider: null, lastSyncAt: null },
    });
    currentSettings.syncProvider = null;
    currentSettings.lastSyncAt = null;
    updateSyncUI();
    showToast('已中斷連接', 'success');
  }
});

// Export Data
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

// Import Data
DOM.btnImport.addEventListener('click', () => {
  DOM.importFile.click();
});

DOM.importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    const confirmed = await showConfirm(
      '匯入資料',
      `將匯入 ${data.sessions?.length || 0} 個 Sessions。現有資料將與匯入資料合併。`,
      '匯入',
      false
    );

    if (confirmed) {
      await sendMessage({ action: 'importData', data, strategy: 'merge' });
      showToast('資料已匯入 ✨', 'success');
      await loadData();
    }
  } catch (error) {
    showToast('匯入失敗：檔案格式不正確', 'error');
  }

  // Reset file input
  DOM.importFile.value = '';
});

// ---- Initialize ----
document.addEventListener('DOMContentLoaded', loadData);
