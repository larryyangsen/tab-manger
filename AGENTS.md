# AGENTS.md — TabStash

## Project
Chrome/Edge extension (Manifest V3) for collecting, storing, and restoring browser tab sessions, with optional cloud sync (Google Drive). Pure vanilla JS (ES modules), no build step, no package manager.

## Build / Lint / Test
- **Build**: none — load `/Users/senhaoyang/project/tab-manager` as an unpacked extension via `chrome://extensions` (Developer mode → Load unpacked).
- **Reload**: click the reload icon on the extension card after edits; for service-worker changes use "Inspect service worker" → reload.
- **Lint/Test**: no toolchain configured. If adding tests, prefer a single-file Node script runnable via `node path/to/test.js`; document the command here.

## Architecture
- [manifest.json](file:///Users/senhaoyang/project/tab-manager/manifest.json): MV3 manifest, declares `tabs`, `storage`, `identity` permissions and `oauth2` scope `drive.file`.
- [background/service-worker.js](file:///Users/senhaoyang/project/tab-manager/background/service-worker.js): ES-module service worker. Central message router via `chrome.runtime.onMessage` dispatching on `message.action` (`collectTabs`, `getSessions`, `restoreSession`, `restoreSingleTab`, `deleteSession`, `renameSession`, `removeTabFromSession`, `getSettings`, `updateSettings`, `getTabCount`, `exportData`, `importData`). Handlers must return a Promise; the listener returns `true` to keep `sendResponse` open.
- [background/storage-manager.js](file:///Users/senhaoyang/project/tab-manager/background/storage-manager.js): All `chrome.storage.local` access. Keys: `tabstash_sessions`, `tabstash_settings`. IDs via `crypto.randomUUID()`. Export named async functions only.
- [popup/](file:///Users/senhaoyang/project/tab-manager/popup): toolbar UI; communicates with worker via `chrome.runtime.sendMessage({ action, ... })`.
- [manage/](file:///Users/senhaoyang/project/tab-manager/manage): full management page (same messaging contract).

## Code Style
- ES modules (`import`/`export`), 2-space indent, single quotes, semicolons, trailing commas in multi-line literals, `async`/`await` (no `.then` chains except the message-listener bridge).
- Naming: `camelCase` functions/vars, `UPPER_SNAKE` constants (e.g. `STORAGE_KEYS`), `kebab-case` filenames.
- JSDoc on every exported / cross-module function (`@param`, `@returns`); user-facing strings and comments are in Traditional Chinese — keep that convention.
- Errors: handlers return `{ error: string }` on failure and `{ success: true }` or domain payload on success; `try/catch` at the message-router boundary logs with `console.error('TabStash ...', err)` and forwards `err.message`. Do not throw across the message boundary.
- Storage access only through `storage-manager.js`; never call `chrome.storage` from popup/manage. Never expose `chrome://`, `edge://`, or `chrome-extension://` URLs in collected tabs.
