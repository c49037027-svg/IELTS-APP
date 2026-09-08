"""在真的瀏覽器裡把網頁版點過一輪，抓 console 錯誤並截圖。

用法：
    python3 -m http.server 8899 --bind 127.0.0.1 &
    python3 tests/browser.test.py
截圖會存到 tests/screenshots/。
"""
import os
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8899/index.html"
OUT = str(Path(__file__).resolve().parent / "screenshots")
Path(OUT).mkdir(exist_ok=True)

# 有設定 PLAYWRIGHT_BROWSERS_PATH 的環境直接指定 Chromium，其餘交給 Playwright 自己找
CHROME = os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome")

errors = []
steps = []


def step(name, ok, detail=""):
    steps.append((name, ok, detail))
    print(f"{'✓' if ok else '✗'} {name}{(' — ' + detail) if detail else ''}")


with sync_playwright() as p:
    browser = p.chromium.launch(**({"executable_path": CHROME} if os.path.exists(CHROME) else {}))
    page = browser.new_page(viewport={"width": 390, "height": 844})  # iPhone 尺寸
    page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    # 無頭 Chromium 有 speechSynthesis 但沒有任何語音，念了也沒聲音。
    # 換成假的，才能確認「按下喇叭 → 真的把正確的字送去念、而且帶對語速與語音」。
    page.add_init_script("""
      window.__spoken = [];
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [
          { name: 'US voice', lang: 'en-US', localService: true },
          { name: 'GB voice', lang: 'en-GB', localService: true }
        ],
        speak: u => window.__spoken.push({ text: u.text, rate: u.rate, lang: u.lang,
                                           voice: u.voice && u.voice.name }),
        cancel: () => {}, resume: () => {}, addEventListener: () => {}
      }});
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true,
        value: function (text) { this.text = text; } });
    """)

    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(400)

    # --- 首頁 ---
    step("首頁載入", page.locator("#vocab-home .today-card").count() == 1)
    modes = page.locator(".mode-card").all_text_contents()
    step("五種模式都在", len(modes) == 5, " / ".join(m.split("\n")[0].strip() for m in modes)[:80])
    due_recall = page.locator(".today-num b").first.inner_text()
    step("今日待複習有數字", due_recall.isdigit() and int(due_recall) > 0, f"認讀 {due_recall}")
    page.screenshot(path=f"{OUT}/shot-home.png", full_page=True)

    # --- 模式 A：通勤複習 ---
    page.locator(".mode-card", has_text="通勤複習").click()
    page.wait_for_timeout(200)
    word_before = page.locator(".card-word").inner_text()
    step("複習：顯示單字", bool(word_before), word_before)
    step("複習：正面不顯示中文", page.locator(".dim-box").count() == 0)
    page.get_by_text("看例句與同義詞").click()
    page.wait_for_timeout(200)
    dims = page.locator(".dim-key").all_text_contents()
    step("複習：背面四維度", "例句" in dims and "字根" in dims and "同義" in dims, " ".join(dims))
    # 中文意思：預設顯示，但固定排在四個維度之後
    dim_order = [d for d in dims if d in ("例句", "搭配", "字根", "同義", "中文")]
    if "中文" in dims:
        step("複習：中文排在四個維度後面",
             dim_order[-1] == "中文", " → ".join(dim_order))
        step("複習：中文是小字",
             page.locator("#vocab-stage .dim-row.zh-row").count() >= 1)
    else:
        step("複習：這張卡沒有中文（可跳過順序檢查）", True, " ".join(dims))

    # --- 發音 ---
    step("複習：單字旁邊有喇叭", page.locator(".word-line .speak-btn").count() == 1)
    page.locator(".word-line .speak-btn").click()
    page.wait_for_timeout(150)
    spoken = page.evaluate("window.__spoken")
    step("發音：按喇叭會念出這個字",
         len(spoken) == 1 and spoken[0]["text"] == word_before,
         f"{spoken[0]['text'] if spoken else '(沒念)'} · {spoken[0]['voice'] if spoken else '-'}")
    step("發音：預設用英式語音與 0.9 倍速",
         bool(spoken) and spoken[0]["voice"] == "GB voice" and spoken[0]["rate"] == 0.9)
    step("發音：例句也有自己的喇叭",
         page.locator(".dim-row .speak-btn").count() >= 1)
    page.locator(".dim-row .speak-btn").first.click()
    page.wait_for_timeout(150)
    spoken = page.evaluate("window.__spoken")
    step("發音：例句念的是整句不是單字", len(spoken) == 2 and len(spoken[1]["text"]) > len(word_before))
    page.keyboard.press("p")
    page.wait_for_timeout(150)
    step("發音：p 鍵也能念", len(page.evaluate("window.__spoken")) == 3)
    step("發音：按喇叭不會誤觸翻面或評分", page.locator(".rating-grid").count() == 1)
    page.evaluate("window.__spoken = []")

    page.screenshot(path=f"{OUT}/shot-review.png", full_page=True)
    page.locator(".rate-3").click()
    page.wait_for_timeout(200)
    step("複習：評分後換下一張", page.locator(".card-word").inner_text() != word_before)
    # 鍵盤操作
    page.keyboard.press(" ")
    page.wait_for_timeout(150)
    step("複習：空白鍵翻面", page.locator(".dim-box").count() == 1)
    page.keyboard.press("1")
    page.wait_for_timeout(150)
    step("複習：數字鍵評分", page.locator(".dim-box").count() == 0)
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 模式 B：拼字練習 ---
    page.locator(".mode-card", has_text="拼字練習").click()
    page.wait_for_timeout(200)
    prompt_text = page.locator(".dim-box").inner_text()
    step("拼字：題目有線索（中文或英文定義）",
         "中文" in prompt_text or "定義" in prompt_text,
         prompt_text.replace("\n", " ")[:60])
    step("拼字：優先出挖空例句的完整題目", "______" in prompt_text,
         prompt_text.replace("\n", " ")[:60])
    page.locator("#spell-input").fill("zzzwrong")
    page.get_by_role("button", name="送出", exact=True).click()
    page.wait_for_timeout(200)
    step("拼字：錯了有 diff", page.locator(".feedback.bad").count() == 1)
    step("拼字：告知進錯誤清單", "錯誤清單" in page.locator(".feedback.bad").inner_text())
    page.screenshot(path=f"{OUT}/shot-spell.png", full_page=True)
    page.get_by_role("button", name="下一題").click()
    page.wait_for_timeout(200)
    page.locator("#spell-input").fill("x")
    page.get_by_role("button", name="看提示").click()
    page.wait_for_timeout(200)
    step("拼字：提示只給首字母與長度", "提示" in page.locator(".dim-box").inner_text())
    # 聽寫：按「聽發音」要念出正確答案（雅思聽力本來就是聽了要拼得出來）
    page.get_by_role("button", name="🔊 聽發音").click()
    page.wait_for_timeout(150)
    spoken = page.evaluate("window.__spoken")
    step("拼字：聽發音念的是答案本身",
         len(spoken) == 1 and " " not in spoken[0]["text"],
         spoken[0]["text"] if spoken else "(沒念)")
    page.evaluate("window.__spoken = []")
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # 錯誤清單當下就能重練
    step("首頁出現錯誤清單捷徑", page.get_by_text("只練今天拼錯的").count() == 1)

    # --- 同義詞測驗 ---
    page.locator(".mode-card", has_text="同義詞測驗").click()
    page.wait_for_timeout(200)
    page.locator("#syn-input").fill("banana, apple")
    page.get_by_role("button", name="送出", exact=True).click()
    page.wait_for_timeout(200)
    fb = page.locator(".feedback").inner_text()
    step("同義詞：答錯會列出正解", "還有" in fb, fb.replace("\n", " ")[:70])
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 升級 + 主動輸出 ---
    page.get_by_text("⬆ 升級 active").click()
    page.wait_for_timeout(200)
    if page.locator(".promote-row").count() > 0:
        step("升級：列出候選字", True, f"{page.locator('.promote-row').count()} 個")
        page.get_by_text("把勾選的字升級成 active").click()
        page.wait_for_timeout(200)
        step("升級：完成", "已升級" in page.locator(".empty-title").inner_text())
        page.get_by_text("現在去造句").click()
    else:
        step("升級：候選為空時有引導", page.locator(".empty-title").count() == 1)
        page.locator("#vocab-stage .back-btn").click()
        page.wait_for_timeout(200)
        page.locator(".mode-card", has_text="主動輸出").click()
    page.wait_for_timeout(300)

    if page.locator("#produce-input").count():
        step("造句：有話題題幹", "話題" in page.locator(".dim-box").inner_text())
        page.locator("#produce-input").fill("This sentence does not contain it.")
        page.get_by_role("button", name="存起來", exact=True).click()
        page.wait_for_timeout(200)
        step("造句：沒用到目標字會擋下", page.locator(".feedback.bad").count() == 1)
        target = page.locator(".card-word").inner_text()
        page.locator("#produce-input").fill(f"Governments should {target} the problem immediately.")
        page.get_by_role("button", name="存起來", exact=True).click()
        page.wait_for_timeout(200)
        step("造句：存檔成功", page.locator(".feedback.ok").count() == 1)
        page.screenshot(path=f"{OUT}/shot-produce.png", full_page=True)
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 寫例句 ---
    # 搭配詞／字根／同義詞都備好了，留白的只有例句
    page.locator(".mode-card", has_text="寫例句").click()
    page.wait_for_timeout(300)
    step("寫例句：只問例句一項",
         page.locator(".complete-field").count() == 1,
         f"{page.locator('.complete-field').count()} 個欄位")
    step("寫例句：缺的就是例句",
         "英文例句" in page.locator(".missing-tag").inner_text(),
         page.locator(".missing-tag").inner_text())
    step("寫例句：搭配／字根／同義詞已經在卡片上",
         page.locator("#vocab-stage .dim-key").count() >= 3,
         " ".join(page.locator("#vocab-stage .dim-key").all_text_contents()))

    # 參考例句：預設藏起來，按了才出現
    step("寫例句：參考例句預設看不到",
         page.locator("#vocab-stage .ref-text").count() == 1
         and page.locator("#vocab-stage .ref-text").is_hidden())
    word_now = page.locator(".card-word").inner_text()
    page.get_by_role("button", name="想不出來？看一句參考").click()
    page.wait_for_timeout(200)
    ref = page.locator("#vocab-stage .ref-text").inner_text()
    step("寫例句：按了才給參考句", bool(ref.strip()), ref.replace("\n", " ")[:60])
    step("寫例句：參考句裡真的有這個字",
         word_now.lower()[:5] in ref.lower(), f"{word_now} / {ref[:40]}")

    page.locator("#cf-example").fill(f"I wrote my own sentence with {word_now} in it.")
    page.get_by_role("button", name="存起來，下一張").click()
    page.wait_for_timeout(300)
    step("寫例句：存完就換下一張", page.locator(".card-word").inner_text() != word_now)
    saved = page.evaluate(f"Store.findByWord({word_now!r})")
    step("寫例句：存的是我自己寫的句子",
         "my own sentence" in (saved or {}).get("example", ""),
         (saved or {}).get("example", "(沒存到)")[:50])
    step("寫例句：寫完就不再是待補完，也有了複習用的例句",
         page.evaluate(f"""(() => {{
             const c = Store.findByWord({word_now!r});
             return !!c && !Store.isIncomplete(c) && !!c.example;
         }})()"""))
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 卡片清單 ---
    page.get_by_text("📇 卡片清單").click()
    page.wait_for_timeout(300)
    step("清單：列出卡片", page.locator(".lib-row").count() > 100,
         f"{page.locator('.lib-row').count()} 張")
    page.locator(".lib-row").first.click()
    page.wait_for_timeout(200)
    step("卡片詳情：三軌排程都顯示", page.locator(".track-row").count() == 3)
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 匯入匯出 ---
    page.get_by_text("📥 匯入匯出").click()
    page.wait_for_timeout(200)
    step("匯入匯出頁存在", page.locator("#csv-file").count() == 1)
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 只剩單字與進度兩個分頁 ---
    step("只有單字與進度兩個分頁", page.locator(".tab-btn").count() == 2,
         " / ".join(page.locator(".tab-btn").all_text_contents()))
    step("沒有閱讀/聽力殘留", page.locator("#reading, #listening").count() == 0)
    page.locator('.tab-btn[data-tab="progress"]').click()
    page.wait_for_timeout(400)
    dash = page.locator("#vocab-dashboard").inner_text()
    step("進度頁有單字儀表板", "今天待複習" in dash and "拼字準確度" in dash)
    step("進度頁有連續學習天數", "連續學習" in dash)
    step("進度頁有分類覆蓋", "分類覆蓋" in dash)
    step("學習計畫有產出", len(page.locator("#daily-plan").inner_text()) > 10)
    page.screenshot(path=f"{OUT}/shot-progress.png", full_page=True)

    # --- 中文意思開關 ---
    page.locator('.tab-btn[data-tab="vocab"]').click()
    page.wait_for_timeout(200)
    page.locator(".mode-card", has_text="通勤複習").click()
    page.wait_for_timeout(200)
    page.get_by_text("看例句與同義詞").click()
    page.wait_for_timeout(200)
    step("中文：預設看得到", page.locator("#vocab-stage .dim-row.zh-row").count() >= 1)
    page.locator(".settings-btn").click()
    page.wait_for_timeout(200)
    page.locator("#show-zh").uncheck()
    page.wait_for_timeout(200)
    page.locator("#settings-modal .close-btn").click()
    page.wait_for_timeout(200)
    step("中文：關掉之後眼前這張卡立刻不見中文",
         page.locator("#vocab-stage .dim-row.zh-row").count() == 0)
    step("中文：關掉之後四個維度還在",
         page.locator("#vocab-stage .dim-row").count() >= 3)
    spell_hidden = page.evaluate("Store.spellingQueue({}).length")
    step("中文：關掉之後拼字題目仍然有得出", spell_hidden > 0, f"{spell_hidden} 題")
    step("中文：關掉之後拼字題不會出「只有中文可當線索」的字",
         page.evaluate("""Store.spellingQueue({})
                            .every(c => Store.spellingSentence(c) || c.notes)"""))
    page.locator(".settings-btn").click()
    page.wait_for_timeout(200)
    page.locator("#show-zh").check()
    page.wait_for_timeout(150)
    step("中文：可以再打開", page.evaluate("Store.showZh()") is True)
    page.locator("#settings-modal .close-btn").click()
    page.wait_for_timeout(200)
    page.locator("#vocab-stage .back-btn").click()
    page.wait_for_timeout(200)

    # --- 發音設定 ---
    page.locator(".settings-btn").click()
    page.wait_for_timeout(200)
    step("設定：有發音區塊", page.locator("#speech-section").count() == 1)
    page.select_option("#speech-accent", "en-US")
    page.wait_for_timeout(100)
    page.get_by_role("button", name="🔊 試聽").click()
    page.wait_for_timeout(150)
    spoken = page.evaluate("window.__spoken")
    step("設定：改成美式之後就用美式語音",
         bool(spoken) and spoken[-1]["voice"] == "US voice",
         spoken[-1]["voice"] if spoken else "(沒念)")
    page.locator("#speech-rate").fill("1.2")
    page.dispatch_event("#speech-rate", "input")
    page.wait_for_timeout(100)
    step("設定：語速標籤跟著動",
         page.locator("#speech-rate-label").inner_text() == "1.2×",
         page.locator("#speech-rate-label").inner_text())
    page.locator("#speech-auto").check()
    page.wait_for_timeout(100)
    page.screenshot(path=f"{OUT}/shot-settings.png", full_page=True)
    page.locator("#settings-modal .close-btn").click()
    page.wait_for_timeout(200)

    # --- 重新整理後資料還在 ---
    page.locator('.tab-btn[data-tab="vocab"]').click()
    page.wait_for_timeout(200)
    before = page.locator(".today-num b").first.inner_text()
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(400)
    after = page.locator(".today-num b").first.inner_text()
    step("重新整理後進度保留", before == after, f"{before} → {after}")
    step("重新整理後發音設定保留",
         page.evaluate("Speech.getPrefs()") == {"accent": "en-US", "rate": 1.2, "autoExample": True},
         str(page.evaluate("Speech.getPrefs()")))

    # 開了自動念之後，翻面就會自動出聲
    page.evaluate("window.__spoken = []")
    page.locator(".mode-card", has_text="通勤複習").click()
    page.wait_for_timeout(200)
    page.get_by_text("看例句與同義詞").click()
    page.wait_for_timeout(200)
    step("發音：開了自動念，翻面就出聲", len(page.evaluate("window.__spoken")) == 1)

    browser.close()

print()
failed = [s for s in steps if not s[1]]
if errors:
    print("JS 錯誤：")
    for e in errors[:10]:
        print("  " + e)
print(f"通過 {len(steps) - len(failed)} / {len(steps)} 項；JS 錯誤 {len(errors)} 個")
sys.exit(1 if failed or errors else 0)
