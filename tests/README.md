# 網頁版測試

```bash
# 1. 引擎邏輯（SM-2、挖空、拼字比對、同義詞比對、資料層、CSV、舊資料轉換）
node tests/engine.test.js

# 2. 瀏覽器端到端（需要 playwright + chromium）
python3 -m http.server 8899 --bind 127.0.0.1 &
python3 tests/browser.test.py     # 截圖存在 tests/screenshots/
```

指令列版本的測試在 `cli/`：

```bash
cd cli && python3 -m unittest discover -s tests -t .
```
