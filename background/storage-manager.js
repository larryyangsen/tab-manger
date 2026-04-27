/**
 * StorageManager — 本機儲存管理模組
 * 負責所有 chrome.storage.local 的讀寫操作
 */

const STORAGE_KEYS = {
  SESSIONS: 'tabstash_sessions',
  SETTINGS: 'tabstash_settings',
};

const DEFAULT_SETTINGS = {
  excludePinned: true,
  closeAfterCollect: true,
  syncProvider: null, // "google-drive" | "onedrive" | null
  lastSyncAt: null,
  autoSyncInterval: 0, // minutes, 0 = disabled
};

/**
 * 產生 UUID v4
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * 取得所有 sessions
 * @returns {Promise<Array>}
 */
export async function getSessions() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS);
  return result[STORAGE_KEYS.SESSIONS] || [];
}

/**
 * 儲存 sessions 陣列
 * @param {Array} sessions
 */
export async function saveSessions(sessions) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS]: sessions });
}

/**
 * 取得單一 session
 * @param {string} sessionId
 * @returns {Promise<Object|null>}
 */
export async function getSession(sessionId) {
  const sessions = await getSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * 建立新 session
 * @param {string} name
 * @param {Array} tabs - [{url, title, favIconUrl}]
 * @returns {Promise<Object>} 新建立的 session
 */
export async function createSession(name, tabs) {
  const sessions = await getSessions();
  const now = new Date().toISOString();

  const newSession = {
    id: generateId(),
    name: name,
    createdAt: now,
    updatedAt: now,
    tabs: tabs.map(tab => ({
      url: tab.url,
      title: tab.title,
      favIconUrl: tab.favIconUrl || '',
    })),
  };

  sessions.unshift(newSession); // 最新的放最前面
  await saveSessions(sessions);
  return newSession;
}

/**
 * 刪除 session
 * @param {string} sessionId
 */
export async function deleteSession(sessionId) {
  const sessions = await getSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  await saveSessions(filtered);
}

/**
 * 重新命名 session
 * @param {string} sessionId
 * @param {string} newName
 */
export async function renameSession(sessionId, newName) {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    session.name = newName;
    session.updatedAt = new Date().toISOString();
    await saveSessions(sessions);
  }
}

/**
 * 從 session 中移除單一分頁
 * @param {string} sessionId
 * @param {number} tabIndex
 */
export async function removeTabFromSession(sessionId, tabIndex) {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);
  if (session && tabIndex >= 0 && tabIndex < session.tabs.length) {
    session.tabs.splice(tabIndex, 1);
    session.updatedAt = new Date().toISOString();

    // 如果 session 沒有分頁了，就刪除整個 session
    if (session.tabs.length === 0) {
      const filtered = sessions.filter(s => s.id !== sessionId);
      await saveSessions(filtered);
    } else {
      await saveSessions(sessions);
    }
  }
}

/**
 * 取得設定
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEYS.SETTINGS] };
}

/**
 * 更新設定
 * @param {Object} updates - 要更新的欄位
 */
export async function updateSettings(updates) {
  const current = await getSettings();
  const newSettings = { ...current, ...updates };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: newSettings });
  return newSettings;
}

/**
 * 取得所有資料（用於同步匯出）
 * @returns {Promise<Object>}
 */
export async function getAllData() {
  const sessions = await getSessions();
  const settings = await getSettings();
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    sessions,
    settings,
  };
}

/**
 * 匯入資料（用於同步匯入）
 * @param {Object} data
 * @param {string} strategy - 'replace' | 'merge'
 */
export async function importData(data, strategy = 'merge') {
  if (strategy === 'replace') {
    await saveSessions(data.sessions || []);
  } else {
    // merge: 以 id 為 key，比較 updatedAt 取較新的
    const localSessions = await getSessions();
    const remoteSessions = data.sessions || [];

    const merged = new Map();

    // 先放入本機資料
    for (const session of localSessions) {
      merged.set(session.id, session);
    }

    // 遠端資料如果較新就覆蓋
    for (const session of remoteSessions) {
      const existing = merged.get(session.id);
      if (!existing || new Date(session.updatedAt) > new Date(existing.updatedAt)) {
        merged.set(session.id, session);
      }
    }

    const mergedArray = Array.from(merged.values())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    await saveSessions(mergedArray);
  }
}
