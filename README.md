# Bili Chat Exporter Enhanced

Bili Chat Exporter Enhanced 是一款用于 Microsoft Edge 的 Bilibili 私信导出扩展。**0.4.0** 在 cdz-hy 的原作基础上新增了**按消息条数分段导出**，适合备份含有大量文字和图片的长对话。

## 原项目与署名

- 原项目为 **bili-chat-exporter**，作者为 **cdz-hy**。感谢原作者提供私信读取、导出和离线阅读功能。[原项目仓库](https://github.com/cdz-hy/bili-chat-exporter)
- 增强版基于原项目改良，增加分段读取、连续下载和含图聊天记录的按条数分卷。[增强版仓库](https://github.com/Serenight/Bili-Chat-Exporter-Enhanced)

## 安装

1. 下载本仓库的 ZIP 并解压，或使用 Git 克隆仓库。
2. 在 Edge 地址栏打开 `edge://extensions/`，开启 **开发人员模式**。如已安装旧版本，先停用旧版本。
3. 点击 **加载解压缩的扩展**，选择包含 `manifest.json` 的目录。
4. 登录 Bilibili 并刷新私信页面。

## 使用

1. 打开需要备份的对话，点击私信页面**左上角**的 **导出此对话**。
2. 导出单个文件时，直接选择格式。需要分段备份时，开启 **分文件导出**，填写每份消息数，再选择 HTML、JSON 或 PDF。
3. 保持私信页面打开。扩展会依次生成并下载各份文件，在完成后显示已保存的文件数和消息总数。

| 格式 | 适用场景 | 每份消息数 |
| --- | --- | ---: |
| HTML | 离线阅读、搜索消息、查看随文件保存的图片 | 1～10,000 |
| JSON | 保存结构化记录，便于后续处理 | 1～2,000 |
| PDF | 按页阅读、打印 | 1～200 |

例如，对话有 1,875 条消息，设置每份 500 条后，导出结果为 **500、500、500、375 条**。`part0001` 包含最新一卷。HTML 和 PDF 卷内按时间正序显示，JSON 按从新到旧的顺序保存。完整分卷采用设定条数，最后一卷保存剩余消息。

分段导出会逐页读取对话并逐份写入文件。HTML 会复用同一卷内相同 URL 的图片，减少头像或表情重复嵌入带来的文件体积。媒体资源还可使用 **打包媒体 ZIP** 单独下载。

## 许可

本项目采用 [MIT License](./LICENSE)。原作者在[原项目 README](https://github.com/cdz-hy/bili-chat-exporter#license) 中标注了 MIT 许可。
