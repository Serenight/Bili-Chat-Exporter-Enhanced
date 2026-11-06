/* Local enhancement for the unpacked 0.2.0 build. Loaded before the content bundle. */
(() => {
  "use strict";

  const MAX_PART_SIZE = 2000;
  const MAX_HTML_PART_SIZE = 10000;
  let active = null;

  function checkCancelled(context) {
    if (context.cancelled) {
      const error = new Error("已停止后续导出");
      error.cancelled = true;
      throw error;
    }
  }

  function safeName(value) {
    // Also remove control characters, trailing dots and Windows reserved characters.
    return String(value).replace(/[\x00-\x1f\\/:*?"<>|]/g, "_")
      .replace(/[. ]+$/g, "").slice(0, 60) || "chat";
  }

  async function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const send = message => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        if (error || !response?.ok) reject(new Error(error?.message || response?.error || "下载失败，请重新加载插件后重试"));
        else resolve(response);
      });
    });
    try {
      const { id } = await send({ type: "BILI_SPLIT_DOWNLOAD", url, filename });
      for (;;) {
        const result = await send({ type: "BILI_SPLIT_DOWNLOAD_STATUS", id });
        if (result.state === "complete") return id;
        if (result.state === "interrupted") throw new Error(`下载中断：${result.error || "未知原因"}`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // PDF lays out the whole part in the DOM. Blob URLs allow its renderer to
  // reuse decoded attachments without expanding each URL into a base64 string.
  async function renderPDF(render, messages, args) {
    const cache = new Map(), urls = [];
    async function fetchImage(source) {
      const response = await fetch(source);
      if (!response.ok) return source;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return url;
    }
    function loadImage(source) {
      if (!cache.has(source)) cache.set(source, fetchImage(source).catch(() => source));
      return cache.get(source);
    }
    try {
      return await render(args.talkerId, messages, args.config, args.name, args.map, args.report,
        { returnBlob: true, loadImage });
    } finally {
      await Promise.allSettled(cache.values());
      for (const url of urls) URL.revokeObjectURL(url);
    }
  }

  async function run({ talkerId, format, partSize = 500, config, api, exporters,
    onProgress = () => {}, onCount = () => {}, save = downloadBlob,
    pause = () => new Promise(resolve => setTimeout(resolve, 120)) }) {
    if (active) throw new Error("已有分文件导出任务正在运行");
    if (!["json", "html", "pdf"].includes(format)) throw new Error("不支持的分文件导出格式");
    const formatLimit = { html: MAX_HTML_PART_SIZE, pdf: 200, json: MAX_PART_SIZE }[format];
    if (!Number.isInteger(partSize) || partSize < 1 || partSize > formatLimit) {
      const message = `${format.toUpperCase()} 每份条数须为 1～${formatLimit} 的整数，请调整后重试。`;
      onProgress(message);
      throw new Error(message);
    }
    const context = { cancelled: false, parts: 0, saved: 0, fetched: 0 };
    active = context;
    let pending = [], cursor = 0;
    let emotes = {};
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    // Keep only emotes used in the current part; the map does not grow with history.
    function partEmotes(messages) {
      const result = {};
      for (const message of messages) {
        const text = String(message.content || "");
        for (const key of Object.keys(emotes)) {
          if (text.includes(key)) result[key] = emotes[key];
        }
      }
      return result;
    }

    let name;
    async function writePart(messages) {
      checkCancelled(context);
      const number = context.parts + 1;
      const report = text => onProgress(`第 ${number} 份（已保存 ${context.parts} 份）：${text}`);
      const map = partEmotes(messages);
      let blob;
      try {
        report(`正在生成 ${messages.length} 条消息`);
        const options = { returnBlob: true };
        if (format === "json") {
          blob = await exporters.exportToJSON(talkerId, messages, name, map, options);
        } else if (format === "html") {
          blob = await exporters.exportToHTML(talkerId, messages, config, name, map, report, options);
        } else {
          blob = await renderPDF(exporters.exportToPDF, messages, { talkerId, config, name, map, report });
        }
        if (!(blob instanceof Blob)) throw new Error("导出器未返回有效文件");
      } catch (error) {
        if (/invalid string length|out of memory/i.test(error.message)) {
          throw new Error(`第 ${number} 份（${messages.length} 条）超出浏览器内存限制，请减少每份条数后重试。`, { cause: error });
        }
        throw error;
      }
      checkCancelled(context);
      const first = messages[0].msg_seqno, last = messages[messages.length - 1].msg_seqno;
      const filename = `${safeName(name)}_${safeName(talkerId)}_${stamp}_part${String(number).padStart(4, "0")}_seq${safeName(last)}-${safeName(first)}.${format}`;
      report("正在保存文件，请等待下载完成");
      // Do not fetch more history or release the Blob URL until this download completes.
      await save(blob, filename);
      context.parts++;
      context.saved += messages.length;
      checkCancelled(context);
    }

    async function flush() {
      if (!pending.length) return;
      await writePart(pending);
      pending = [];
    }

    try {
      onCount(0);
      onProgress("正在获取用户信息…");
      name = (await api.getUserInfo(talkerId))?.name || talkerId;
      for (;;) {
        checkCancelled(context);
        onProgress(`正在读取历史消息（已读取 ${context.fetched} 条，已保存 ${context.parts} 份）…`);
        const page = await api.fetchSessionMsgs(talkerId, cursor);
        checkCancelled(context);
        const rows = [...page.messages].sort((a, b) => Number(b.msg_seqno) - Number(a.msg_seqno));
        if (!rows.length) {
          if (page.has_more) throw new Error("接口返回空页但仍有历史消息，已停止以避免遗漏");
          break;
        }
        const next = Number(page.min_seqno) - 1;
        if (page.has_more && (!Number.isSafeInteger(next) || next <= 0 || (cursor > 0 && next >= cursor))) {
          throw new Error("历史消息分页游标未前进，已停止以避免重复或遗漏");
        }
        const pageEmotes = {};
        for (const entry of page.e_infos || []) {
          if (entry.text && (entry.url || entry.uri)) pageEmotes[entry.text] = entry.url || entry.uri;
        }
        Object.assign(emotes, pageEmotes);
        // The cursor boundary excludes overlap from earlier pages; duplicates within a page are removed too.
        const seen = new Set();
        for (const message of rows) {
          checkCancelled(context);
          const seq = Number(message.msg_seqno);
          if (!Number.isSafeInteger(seq) || seq <= 0) throw new Error("消息序号无效，已停止以避免遗漏");
          if ((cursor > 0 && seq > cursor) || seen.has(seq)) continue;
          seen.add(seq);
          pending.push(message);
          context.fetched++;
          onCount(context.fetched);
          if (pending.length === partSize) {
            await flush();
            emotes = { ...pageEmotes };
          }
        }
        if (!page.has_more) break;
        cursor = next;
        await pause();
      }
      await flush();
      const text = context.fetched
        ? `分文件导出完成：已保存 ${context.parts} 份，共 ${context.saved} 条消息。`
        : "没有可导出的消息。";
      onProgress(text);
      return { ...context, status: "complete" };
    } catch (error) {
      const text = `${error.cancelled ? "已停止" : "导出中断"}：已保存 ${context.parts} 份、${context.saved} 条消息。${error.cancelled ? "" : error.message}`;
      onProgress(text);
      if (error.cancelled) return { ...context, status: "cancelled" };
      throw new Error(text, { cause: error });
    } finally {
      active = null;
    }
  }

  globalThis.BiliChatSplitExport = {
    run,
    cancel() { if (active) active.cancelled = true; },
    isActive() { return active !== null; },
    isRendering() { return active !== null; },
    checkActive() { if (active) checkCancelled(active); },
    createHTMLBlob(parts) {
      return new Blob(parts, { type: "text/html;charset=utf-8" });
    }
  };
})();
