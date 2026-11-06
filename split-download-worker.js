"use strict";

// A short request starts a download; polling uses short messages so an MV3 worker
// can restart even if a download is paused or waiting for user interaction.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url?.startsWith("https://message.bilibili.com/") !== true) return;
  if (message.type === "BILI_SPLIT_DOWNLOAD") {
    if (typeof message.url !== "string" || !message.url.startsWith("blob:https://message.bilibili.com/") ||
      typeof message.filename !== "string" || !/^[^/\\\x00-\x1f]+_part\d{4,}_seq\d+-\d+\.(json|html|pdf)$/.test(message.filename)) {
      sendResponse({ ok: false, error: "无效的导出文件" });
      return;
    }
    chrome.downloads.download({ url: message.url, filename: message.filename,
      conflictAction: "uniquify", saveAs: false }, id => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true, id });
    });
    return true;
  }
  if (message.type === "BILI_SPLIT_DOWNLOAD_STATUS" && Number.isInteger(message.id)) {
    chrome.downloads.search({ id: message.id }, items => {
      const error = chrome.runtime.lastError;
      const item = items?.[0];
      sendResponse(error || !item || item.byExtensionId !== chrome.runtime.id
        ? { ok: false, error: error?.message || "找不到当前导出文件的下载状态" }
        : { ok: true, state: item.state, error: item.error });
    });
    return true;
  }
});
