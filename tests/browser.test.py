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
    step("複習：背面預設沒有中文", "中文" not in dims)
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

    # --- 補完卡片 ---
    page.locator(".mode-card", has_text="補完卡片").click()
    page.wait_for_timeout(200)
    step("補完：只問缺的欄位", page.locator(".complete-field").count() > 0,
         f"{page.locator('.complete-field').count()} 個欄位")
    step("補完：顯示缺什麼", page.locator(".missing-tag").count() == 1,
         page.locator(".missing-tag").inner_text())
    word = page.locator(".card-word").inner_text()
    if page.locator("#cf-root").count():
        page.locator("#cf-root").fill("測試字根拆解")
    if page.locator("#cf-synonyms").count():
        page.locator("#cf-synonyms").fill("alpha; beta")
    page.get_by_role("button", name="存起來，下一張").click()
    page.wait_for_timeout(200)
    step("補完：存檔後換下一張", page.locator(".card-word").inner_text() != word)
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

    # --- 重新整理後資料還在 ---
    page.locator('.tab-btn[data-tab="vocab"]').click()
    page.wait_for_timeout(200)
    before = page.locator(".today-num b").first.inner_text()
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(400)
    after = page.locator(".today-num b").first.inner_text()
    step("重新整理後進度保留", before == after, f"{before} → {after}")

    browser.close()

print()
failed = [s for s in steps if not s[1]]
if errors:
    print("JS 錯誤：")
    for e in errors[:10]:
        print("  " + e)
print(f"通過 {len(steps) - len(failed)} / {len(steps)} 項；JS 錯誤 {len(errors)} 個")
sys.exit(1 if failed or errors else 0)
