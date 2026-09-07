# IELTS 單字學習 CLI

專為「理解型 + 需要講出來 + 拼字容易出錯 + 通勤時間長」的學習方式設計的命令列單字程式。
資料存在本地 SQLite，沒有網頁介面、不需要帳號、不連任何伺服器。

**核心設計原則：不做「單字 → 中文對照」的卡片。** 每張卡的記憶點固定是四個維度：

| 維度 | 為什麼是它 |
|---|---|
| 例句 | 記語境，不記孤立的字 |
| 搭配詞 | 雅思寫作口說的自然度靠搭配 |
| 字根字首 | 理解型記憶的抓手，記得住也猜得到生字 |
| 同義詞群 | 雅思聽力閱讀的核心機制是同義替換 |

中文提示（`zh_hint`）只在拼字模式與補完模式出現，複習模式預設完全不顯示中文。

---

## 安裝

需求：Python 3.9 以上。除了選用的 `rich` 之外沒有任何外部依賴。

```bash
cd cli

# 方式一：直接跑，不安裝
python3 -m ielts init

# 方式二：安裝成 ielts 指令（建議）
pip install -e .
ielts init

# 想要框線與顏色（選用，沒裝會自動降級成純文字）
pip install rich
```

`ielts init` 會建立資料庫並灌入 779 張卡片，然後印出儀表板。
資料庫預設在 `cli/ielts.db`，可用 `--db 路徑` 或環境變數 `IELTS_DB` 覆寫。

單字庫內容：

| 分類 | 張數 | 四維度齊全 |
|---|---:|---:|
| AWL 學術詞彙（570 字頭全收，`topic` = Sublist 1–10） | 564 | 132 |
| 高頻話題字（7 個主題 × 20） | 140 | 140 |
| Task 1 圖表用語（依功能分組） | 39 | 39 |
| 口說表達（依功能分組） | 36 | 36 |

**Sublist 1、2 的 120 個字四維度全部寫齊**，裝好就能直接複習。
Sublist 3 以後的字頭卡只帶詞性與英文定義進來，四個維度留白，由 `ielts complete` 逐一補上 ——
補完佇列**依 sublist 由高頻排到低頻**，打開就是從 Sublist 3 開始。
資料的唯一來源在專案根目錄的 `tools/`，改完跑 `python3 tools/build_seed.py` 重新產生。

**每天最多放 20 張新卡**（每軌各 20），到期的舊卡不受限制 ——
沒有這個上限，整份 AWL 會在第一天全部到期。

---

## 五種模式怎麼觸發

### 模式 A：通勤複習 `ielts review`

只出 `card_type = passive` 的到期卡片。單手單鍵操作，適合在車上一路按到底。

```bash
ielts review                 # 預設 30 張
ielts review --limit 50      # 一次跑 50 張
ielts review --topic 環境    # 只複習某個主題
ielts review --topic "Sublist 1"   # 只練 AWL 第一組（最高頻的 60 字）
ielts review --all           # 連 active 卡片也一起複習
ielts review --zh            # 背面也顯示中文（預設不顯示）
```

操作鍵：

| 按鍵 | 動作 |
|---|---|
| `空白鍵` | 翻面，顯示例句 / 搭配 / 字根 / 同義 |
| `1` `2` `3` `4` | Again / Hard / Good / Easy |
| `s` | 跳過這張（不影響排程） |
| `q` | 離開（已答的都存好了） |

### 模式 B：拼字練習 `ielts spell`

顯示挖空的例句 + 中文提示，你打出完整拼字，程式逐字元比對並標出錯在哪裡。
目標字在例句、搭配詞、字根說明裡都會一併被遮掉，不會洩題。

```bash
ielts spell                  # 預設 20 題
ielts spell --limit 40
ielts spell --only-wrong     # 只練錯誤清單裡的字（不看到期日，剛錯完就能再練）
ielts spell --list           # 只看最常拼錯的字，不作答
```

作答時輸入 `?` 會給提示（首字母 + 字母數，不會給答案）；直接 Enter 跳過；`:q` 離開。
拼錯的字會寫進錯誤清單，並把拼字排程壓回明天，隔天優先出現；答錯後可以再打一次正確拼字加深印象。

### 模式 C：主動輸出 `ielts produce`

程式給你一個 active 單字 + 一個雅思常見話題，你用該字造一句，句子存進資料庫。

```bash
ielts promote                # 每週跑一次：把認讀已經穩的字升級成 active
ielts promote --count 15 --dry-run   # 先看名單不動手
ielts produce                # 造句（預設 5 句）
ielts produce --count 15
ielts produce --history      # 看過去寫過的句子
ielts export-productions     # 匯出成 markdown，整份貼給 AI 批改
```

句子裡如果沒用到目標字，程式會提醒並讓你重寫。
`promote` 的預設條件是「認讀複習過 3 次以上、且有例句」，可用 `--min-reviews` 調整。

### 同義詞群測驗 `ielts syn`

給一個字，你列出 2–3 個同義詞，程式比對卡片上的 `synonyms` 欄位。
比對容忍大小寫與詞形變化（`Reducing` 對得上 `reduce`）。

```bash
ielts syn                    # 預設 15 題
ielts syn --target 3         # 每題至少要列 3 個
ielts syn --topic 科技
```

答案不在卡片清單裡時會列出來，你可以用 `ielts complete` 把它補進同義詞欄位。

### 補完模式 `ielts complete`

匯入時欄位空白的卡片會被標記為 incomplete，這個模式逐一把缺的補齊。

```bash
ielts complete               # 預設處理 20 張，依 sublist 由高頻排到低頻
ielts complete --word mitigate
```

只會問缺的欄位，每填一張立刻存檔，`:q` 隨時離開。標題會顯示這張卡屬於哪個 sublist。

---

## 匯入 / 匯出

```bash
ielts template my.csv        # 產生 CSV 範本（含一列填法示範）
ielts import awl.csv         # 匯入
ielts import awl.csv --update  # 已存在的字用檔案內容覆寫
ielts export backup.csv      # 把整個單字庫匯出成 CSV
```

CSV 欄位（只有 `word` 必填）：

| 欄位 | 說明 |
|---|---|
| `word` | 單字或片語 |
| `pos` | 詞性 |
| `example_sentence` | 英文例句 |
| `collocations` | 搭配詞，用 `;` 分隔 |
| `root_analysis` | 字根字首拆解 |
| `synonyms` | 同義詞，用 `;` 分隔 |
| `category` | AWL / 高頻話題字 / Task1圖表用語 / 口說表達 |
| `topic` | 環境、教育、科技、健康、都市化、犯罪、媒體… |
| `card_type` | `passive`（預設）或 `active` |
| `zh_hint` | 中文提示（只在拼字與補完模式顯示） |
| `notes` | 自己的筆記 |

匯入很寬鬆：欄位名大小寫、底線、空白、常見別名（`example`、`root`、`中文`、`詞性`…）都對得上；
Excel 匯出的 Big5 編碼與 UTF-8 BOM 都吃得下；分隔符號逗號或 Tab 皆可。
`(word, pos)` 相同視為同一張卡，預設跳過不覆寫。
缺欄位的列會被匯入並標記 incomplete，不會整批失敗。

---

## 統計儀表板

```bash
ielts stats                  # 今天要做什麼 + 覆蓋進度
ielts stats --full           # 加上評分分布與前 20 個最常錯的字
```

包含：今日各軌待複習數、連續學習天數（streak）、passive vs active 比例、
本週複習/新學/造句、拼字錯誤率與最常拼錯的字、各 category 與 topic 的覆蓋進度、
以及一個「下一步該跑哪個指令」的建議清單。

其他查詢指令：

```bash
ielts list --topic 環境          # 列出卡片
ielts list --incomplete          # 只看不完整的
ielts show mitigate              # 看一張卡的完整內容與三軌排程狀態
ielts add                        # 手動新增一張卡（互動輸入）
```

---

## 間隔重複（SM-2）

實作 Anki 同源的 SM-2 演算法：

| 評分 | 新間隔 | ease 調整 |
|---|---|---|
| Again | 重置為 1 天 | −0.20，`lapse_count` +1 |
| Hard | ×1.2 | −0.15 |
| Good | ×ease（首答 1 天 → 次答 6 天） | 不變 |
| Easy | ×ease×1.3 | +0.15 |

ease 下限 1.3、上限 3.0；間隔上限兩年；4 天以上的間隔會加 ±5% 隨機抖動，
避免大量卡片集中在同一天到期。

**排程分成三軌**（`recall` / `spelling` / `synonym`）：
「認得這個字」「拼得出這個字」「講得出同義詞」是三種不同能力，各自獨立排程。
拼錯一次只會把拼字進度壓回明天，不會連帶把你已經很熟的認讀間隔一起打回原點。

---

## 專案結構

```
cli/
├── ielts/
│   ├── cli.py          # argparse 子指令分派、全域錯誤處理
│   ├── db.py           # schema、連線、交易、migration
│   ├── models.py       # Card / SrsState / Production 等資料模型
│   ├── repository.py   # 所有 SQL 集中在這一層
│   ├── srs.py          # SM-2 純函式（無 I/O，好測試）
│   ├── textutil.py     # 挖空、拼字比對、同義詞寬鬆比對
│   ├── render.py       # 卡片四維度的統一排版
│   ├── ui.py           # rich / 純文字雙軌輸出，單鍵與整行輸入
│   ├── importer.py     # CSV 匯入匯出
│   ├── stats.py        # 儀表板
│   ├── seed.py         # 種子資料載入
│   ├── data/seed_cards.csv
│   └── modes/          # 五種模式，各自獨立
│       ├── commute.py  # 模式 A
│       ├── spelling.py # 模式 B
│       ├── production.py # 模式 C + promote + export
│       ├── synonym.py  # 同義詞測驗
│       └── complete.py # 補完
└── tests/
```

要加新模式：在 `modes/` 新增一個提供 `run(ctx, ...)` 的模組，再到 `cli.py` 註冊一個子指令即可。
模式層只呼叫 `repository`，不自己寫 SQL。

### 資料表

| 表 | 用途 |
|---|---|
| `cards` | 卡片內容 + incomplete 標記 |
| `srs_state` | 排程狀態，主鍵 `(card_id, track)` |
| `review_log` | 每次評分紀錄 → streak、統計 |
| `spelling_attempts` | 每次拼字作答 → 錯誤清單、錯誤率 |
| `productions` | 造句紀錄 |
| `meta` | schema 版本（供之後 migration） |

---

## 測試

```bash
cd cli
python3 -m unittest discover -s tests -t .   # 142 個測試
```

涵蓋 SM-2 排程數學、挖空與拼字比對（含不規則動詞）、同義詞寬鬆比對、資料層查詢與三軌獨立性、
每日新卡上限、CSV 匯入的各種髒資料、streak 計算、種子資料內容驗證，
以及五種模式的端到端流程（用假的 UI 餵入按鍵）。

---

## 常用流程建議

| 時機 | 指令 |
|---|---|
| 早上出門前 | `ielts stats` 看今天的量 |
| 通勤去程（40 分鐘） | `ielts review --limit 40` |
| 通勤回程 | `ielts spell --limit 20` 然後 `ielts syn` |
| 睡前 10 分鐘 | `ielts produce --count 5` |
| 每週日 | `ielts promote` 升級 12 個字 → `ielts export-productions` 貼給 AI 批改 |
| 匯入新單字表之後 | `ielts complete` 逐一補完 |
