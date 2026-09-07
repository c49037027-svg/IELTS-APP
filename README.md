# IELTS-APP

雅思學習工具，目前包含兩個各自獨立的部分：

| 目錄 | 內容 |
|---|---|
| `index.html` / `sw.js` / `manifest.webmanifest` | 網頁版 PWA「IELTS 學習助手」（單字、閱讀、聽力） |
| [`cli/`](./cli) | Python 命令列單字學習程式（SQLite + SM-2 間隔重複，五種學習模式） |

CLI 的安裝與使用說明見 [`cli/README.md`](./cli/README.md)：

```bash
cd cli
python3 -m ielts init      # 建立資料庫並灌入 30 個範例字
python3 -m ielts stats     # 看今天要做什麼
```
