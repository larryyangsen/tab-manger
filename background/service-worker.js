/**
 * Service Worker — TabStash 核心邏輯
 * 處理分頁收集、還原、以及與 popup 的通訊
 */

import {
  getSessions,
  createSession,
  deleteSession,
  renameSession,
  removeTabFromSession,
  getSettings,
  updateSettings,
  getAllData,
  importData,
} from './storage-manager.js';

/**
 * 收集當前視窗的分頁
 * @param {Object} options
 * @param {boolean} options.excludePinned - 是否排除鎖定分頁
 * @param {boolean} options.closeAfterCollect - 收集後是否關閉分頁
 * @param {string} options.sessionName - Session 名稱
 * @returns {Promise<Object>} 新建立的 session
 */
async function collectTabs(options = {}) {
  const settings = await getSettings();
  const excludePinned = options.excludePinned ?? settings.excludePinned;
  const closeAfterCollect = options.closeAfterCollect ?? settings.closeAfterCollect;

  // 取得當前視窗的所有分頁
  const allTabs = await chrome.tabs.query({ currentWindow: true });

  // 過濾分頁
  const tabsToCollect = allTabs.filter(tab => {
    // 排除鎖定分頁
    if (excludePinned && tab.pinned) return false;
    // 排除 chrome:// 和 edge:// 等系統頁面
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) return false;
    // 排除新分頁
    if (tab.url === 'chrome://newtab/' || tab.url === 'edge://newtab/') return false;
    return true;
  });

  if (tabsToCollect.length === 0) {
    return { error: '沒有可收集的分頁' };
  }

  // 建立 session 名稱
  const now = new Date();
  const defaultName = `${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} (${tabsToCollect.length} 個分頁)`;
  const sessionName = options.sessionName || defaultName;

  // 建立 session
  const session = await createSession(sessionName, tabsToCollect);

  // 關閉已收集的分頁
  if (closeAfterCollect) {
    const tabIds = tabsToCollect.map(t => t.id);
    // 確保至少留一個分頁在視窗中
    const remainingTabs = allTabs.filter(t => !tabIds.includes(t.id));
    if (remainingTabs.length === 0) {
      // 先建立一個新分頁再關閉
      await chrome.tabs.create({ active: true });
    }
    await chrome.tabs.remove(tabIds);
  }

  return { session };
}

/**
 * 還原 session 的所有分頁
 * @param {string} sessionId
 * @param {Object} options
 * @param {boolean} options.newWindow - 是否在新視窗開啟
 * @param {boolean} options.removeAfterRestore - 還原後是否刪除 session
 */
async function restoreSession(sessionId, options = {}) {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);

  if (!session || session.tabs.length === 0) {
    return { error: '找不到 session 或 session 沒有分頁' };
  }

  if (options.newWindow) {
    // 在新視窗開啟第一個分頁，其餘加入同一視窗
    const newWindow = await chrome.windows.create({ url: session.tabs[0].url });
    for (let i = 1; i < session.tabs.length; i++) {
      await chrome.tabs.create({
        windowId: newWindow.id,
        url: session.tabs[i].url,
        active: false,
      });
    }
  } else {
    // 在當前視窗開啟
    for (const tab of session.tabs) {
      await chrome.tabs.create({ url: tab.url, active: false });
    }
  }

  if (options.removeAfterRestore) {
    await deleteSession(sessionId);
  }

  return { success: true };
}

/**
 * 還原單一分頁
 * @param {string} sessionId
 * @param {number} tabIndex
 */
async function restoreSingleTab(sessionId, tabIndex) {
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === sessionId);

  if (!session || tabIndex < 0 || tabIndex >= session.tabs.length) {
    return { error: '找不到分頁' };
  }

  await chrome.tabs.create({ url: session.tabs[tabIndex].url, active: true });
  return { success: true };
}

/**
 * 監聽來自 popup 的訊息
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.action) {
        case 'collectTabs':
          return await collectTabs(message.options || {});

        case 'getSessions':
          return { sessions: await getSessions() };

        case 'restoreSession':
          return await restoreSession(message.sessionId, message.options || {});

        case 'restoreSingleTab':
          return await restoreSingleTab(message.sessionId, message.tabIndex);

        case 'deleteSession':
          await deleteSession(message.sessionId);
          return { success: true };

        case 'renameSession':
          await renameSession(message.sessionId, message.newName);
          return { success: true };

        case 'removeTabFromSession':
          await removeTabFromSession(message.sessionId, message.tabIndex);
          return { success: true };

        case 'getSettings':
          return { settings: await getSettings() };

        case 'updateSettings':
          return { settings: await updateSettings(message.updates) };

        case 'getTabCount': {
          const settings = await getSettings();
          const tabs = await chrome.tabs.query({ currentWindow: true });
          const collectableTabs = tabs.filter(tab => {
            if (settings.excludePinned && tab.pinned) return false;
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('chrome-extension://')) return false;
            return true;
          });
          return { total: tabs.length, collectable: collectableTabs.length };
        }

        case 'exportData':
          return await getAllData();

        case 'importData':
          await importData(message.data, message.strategy || 'merge');
          return { success: true };

        default:
          return { error: `未知的操作: ${message.action}` };
      }
    } catch (error) {
      console.error('TabStash error:', error);
      return { error: error.message };
    }
  };

  handler().then(sendResponse);
  return true; // 保持 sendResponse 通道開啟
});

// 安裝時初始化設定
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await updateSettings(settings); // 確保預設值被寫入
  console.log('TabStash installed, settings initialized.');
});
