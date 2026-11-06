/* Build one offline HTML document per requested message range. The content
 * bundle supplies its existing row and document templates to this renderer. */
(() => {
  "use strict";

  // The table appears after the rows. Each image is embedded once per URL, even
  // when the same avatar, emote or attachment appears in hundreds of messages.
  const restoreImages = `<script>(() => {
    const sources = new Map();
    for (const entry of document.querySelectorAll("template[data-bili-key]")) {
      sources.set(entry.dataset.biliKey, entry.content.textContent);
      entry.remove();
    }
    for (const image of document.querySelectorAll("img[data-bili-image]")) {
      image.src = sources.get(image.dataset.biliImage);
    }
  })();</script>`;

  async function render({ talkerId, messages, config, fallbackName, emotes, report,
    getUserInfo, getBase64Image, parseMessage, renderRow, documentBlob }) {
    const known = new Map();
    const assets = [];
    async function imageRef(source) {
      if (!source) return "";
      const url = source.replace(/@\d+w_\d+h.*$/, "");
      if (known.has(url)) return known.get(url);
      let value;
      try {
        value = await getBase64Image(url);
      } catch (error) {
        if (/invalid string length/i.test(error?.message)) throw error;
        value = source; // Same network fallback as the single-file HTML exporter.
      }
      if (typeof value === "string" && /^data:[^,]*;base64,/.test(value)) {
        const assetId = String(assets.length);
        assets.push(new Blob(['<template data-bili-key="', assetId, '">', value, '</template>']));
        value = { assetId };
      }
      known.set(url, value);
      return value;
    }

    const selfMessage = messages.find(message => String(message.sender_uid) !== talkerId);
    const [talker, self] = await Promise.all([getUserInfo(talkerId),
      selfMessage ? getUserInfo(String(selfMessage.sender_uid)) : null]);
    const profiles = {
      talker: { name: talker?.name || fallbackName || talkerId, face: await imageRef(talker?.face) },
      self: { name: self?.name || "我", face: await imageRef(self?.face) }
    };
    const title = config.titleFormat === "username" ? `与 ${profiles.talker.name} 的对话记录`
      : config.titleFormat === "custom" ? config.customTitle : `Bilibili 私信存档 / UID: ${talkerId}`;
    const localEmotes = Object.create(null);
    for (const [text, url] of Object.entries(emotes)) localEmotes[text] = await imageRef(url);

    const body = [];
    let rows = [], chars = 0, previousDate = "";
    for (let index = messages.length - 1; index >= 0; index--) {
      globalThis.BiliChatSplitExport.checkActive();
      const msg = messages[index];
      const parsed = parseMessage(msg.content, msg.msg_type);
      if (parsed.image) parsed.image = await imageRef(parsed.image);
      const date = new Date(msg.timestamp * 1000);
      const dateLabel = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
      const divider = dateLabel === previousDate ? "" : `<div class="date-divider"><span>${dateLabel}</span></div>`;
      previousDate = dateLabel;
      const html = renderRow({ msg, parsed, isMe: String(msg.sender_uid) !== talkerId,
        timeStr: date.toLocaleString("zh-CN", { hour12: false }) }, profiles, localEmotes, config, divider);
      rows.push(html);
      chars += html.length;
      if (chars >= 512 * 1024 || rows.length >= 128 || index === 0) {
        body.push(new Blob(rows));
        rows = [];
        chars = 0;
        report?.(`正在生成 HTML（${messages.length - index}/${messages.length} 条）`);
      }
    }
    if (assets.length) assets.push(restoreImages);
    return documentBlob(title, body, messages.length, config, assets);
  }
  globalThis.BiliChatHTMLVolume = { render };
})();
