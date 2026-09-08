"""文字處理工具：挖空例句、拼字比對、同義詞寬鬆比對。

抽成獨立模組是因為這些規則最容易出錯，也最需要單獨測試。
"""

from __future__ import annotations

import difflib
import re
import unicodedata

MASK = "______"

#: 片語裡不值得挖空的功能詞。
STOPWORDS = {
    "a", "an", "the", "of", "to", "in", "on", "its", "it", "and", "or", "for",
    "at", "with", "be", "is", "are", "was", "were", "as", "by", "from", "that",
    "this", "his", "her", "their", "your", "my", "one",
}

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z'\-]*")
_WS_RE = re.compile(r"\s+")

#: 不規則動詞的過去式與過去分詞。規則式推不出這些形，但例句常用到，
#: 少了就會挖不到空。複合字（overtake → over + took）會自動沿用字尾的變化。
IRREGULAR = {
    "arise": ("arose", "arisen"), "become": ("became", "become"),
    "begin": ("began", "begun"), "break": ("broke", "broken"),
    "bring": ("brought", "brought"), "build": ("built", "built"),
    "buy": ("bought", "bought"), "choose": ("chose", "chosen"),
    "come": ("came", "come"), "deal": ("dealt", "dealt"),
    "draw": ("drew", "drawn"), "drive": ("drove", "driven"),
    "fall": ("fell", "fallen"), "feel": ("felt", "felt"),
    "find": ("found", "found"), "get": ("got", "gotten"),
    "give": ("gave", "given"), "go": ("went", "gone"),
    "grow": ("grew", "grown"), "hold": ("held", "held"),
    "keep": ("kept", "kept"), "know": ("knew", "known"),
    "lead": ("led", "led"), "leave": ("left", "left"),
    "lose": ("lost", "lost"), "make": ("made", "made"),
    "mean": ("meant", "meant"), "meet": ("met", "met"),
    "pay": ("paid", "paid"), "rise": ("rose", "risen"),
    "run": ("ran", "run"), "see": ("saw", "seen"),
    "seek": ("sought", "sought"), "sell": ("sold", "sold"),
    "send": ("sent", "sent"), "speak": ("spoke", "spoken"),
    "spend": ("spent", "spent"), "stand": ("stood", "stood"),
    "strike": ("struck", "struck"), "take": ("took", "taken"),
    "teach": ("taught", "taught"), "tell": ("told", "told"),
    "think": ("thought", "thought"), "wear": ("wore", "worn"),
    "win": ("won", "won"), "withdraw": ("withdrew", "withdrawn"),
    "write": ("wrote", "written"),
}


def tokens_of(text: str) -> list[str]:
    return _TOKEN_RE.findall(text or "")


def normalise(text: str) -> str:
    """比對用的正規化：去頭尾空白/標點、壓縮空白、轉小寫。"""
    if not text:
        return ""
    value = unicodedata.normalize("NFKC", str(text))
    value = value.replace("’", "'").replace("‘", "'")
    value = _WS_RE.sub(" ", value).strip()
    value = value.strip(" .,;:!?\"'()[]{}…—-")
    return value.casefold()


#: 字尾會重複、但上面的字母規則抓不到的字（ui 看起來是兩個母音，其實只發一個短音）
DOUBLE_FINAL = ("equip", "quiz")


def inflections(token: str) -> set[str]:
    """產生一個字的常見變化形，用來在例句裡找到它。

    刻意只用規則式（不引外部詞庫），寧可漏挖也不要誤挖到不相干的字。
    """
    word = token.strip().lower()
    forms: set[str] = set()
    if not word:
        return forms
    forms.add(word)
    forms.update({word + "s", word + "es", word + "ed", word + "ing", word + "ly"})

    if word.endswith("e"):
        stem = word[:-1]
        forms.update({stem + "ing", stem + "ed", stem + "es", stem + "ion", stem + "ation"})
    if word.endswith("y") and len(word) > 2 and word[-2] not in "aeiou":
        stem = word[:-1]
        forms.update({stem + "ies", stem + "ied", stem + "ier", stem + "iest"})
    if len(word) >= 3 and word[-1] not in "aeiouwxy" and word[-2] in "aeiou" and word[-3] not in "aeiou":
        # 重複字尾：plan → planned / planning；dip → dipped / dipping
        forms.update({word + word[-1] + "ed", word + word[-1] + "ing"})
    if any(word == b or word.endswith(b) for b in DOUBLE_FINAL):
        # 上面的規則看字母，所以 equip 的 "ui" 被當成兩個母音而漏掉；
        # 這些字其實只發一個短母音，字尾照樣重複。
        forms.update({word + word[-1] + "ed", word + word[-1] + "ing"})
    if word.endswith("ate"):
        stem = word[:-1]
        forms.update({stem + "ion", stem + "ions", stem + "ing", stem + "ed"})
    if word.endswith("t"):
        forms.add(word + "ion")

    # 不規則動詞（含 overtake / withdraw 這類複合字）
    for base, irregular_forms in IRREGULAR.items():
        if word == base or (word.endswith(base) and len(word) > len(base)):
            prefix = word[: len(word) - len(base)]
            forms.update(prefix + f for f in irregular_forms)
            break

    return {f for f in forms if len(f) >= 2}


def _pattern_for(tokens: list[str]) -> re.Pattern[str] | None:
    forms: set[str] = set()
    for token in tokens:
        forms |= inflections(token)
    if not forms:
        return None
    ordered = sorted(forms, key=len, reverse=True)
    body = "|".join(re.escape(f) for f in ordered)
    return re.compile(rf"\b(?:{body})\b", re.IGNORECASE)


def target_tokens(target: str) -> list[str]:
    """要挖空的字：單字就是它本身；片語則挑掉功能詞後的實詞。"""
    words = tokens_of(target)
    if len(words) <= 1:
        return words
    content = [w for w in words if w.lower() not in STOPWORDS and len(w) > 2]
    return content or words


def mask_sentence(sentence: str, target: str, mask: str = MASK) -> tuple[str, int]:
    """把例句中的目標字（含變化形）換成底線。回傳 (挖空後句子, 挖掉幾處)。"""
    if not sentence or not target:
        return sentence or "", 0
    pattern = _pattern_for(target_tokens(target))
    if pattern is None:
        return sentence, 0
    count = 0

    def _replace(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return mask

    masked = pattern.sub(_replace, sentence)
    return masked, count


def mask_all(items: list[str], target: str, mask: str = MASK) -> list[str]:
    """把一串文字（搭配詞、字根說明）裡的目標字一併挖空，避免拼字模式洩題。"""
    return [mask_sentence(item, target, mask)[0] for item in items]


def letter_skeleton(word: str) -> str:
    """給出首字母與長度提示：mitigate → m _ _ _ _ _ _ _（8 個字母）。"""
    parts: list[str] = []
    total = 0
    for chunk in (word or "").split():
        letters = [c for c in chunk if c.isalpha()]
        total += len(letters)
        if not letters:
            parts.append(chunk)
            continue
        shown = chunk[0] + " " + " ".join("_" if c.isalpha() else c for c in chunk[1:])
        parts.append(shown)
    body = "   ".join(parts)
    return f"{body}（{total} 個字母）" if total else body


def spelling_correct(expected: str, actual: str) -> bool:
    return normalise(expected) == normalise(actual)


def format_diff(expected: str, actual: str) -> tuple[str, str]:
    """把差異用【】框出來，讓錯在哪一眼看得到。"""
    exp, act = expected or "", actual or ""
    matcher = difflib.SequenceMatcher(None, exp.lower(), act.lower())
    exp_out: list[str] = []
    act_out: list[str] = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            exp_out.append(exp[i1:i2])
            act_out.append(act[j1:j2])
        else:
            if i2 > i1:
                exp_out.append(f"【{exp[i1:i2]}】")
            if j2 > j1:
                act_out.append(f"【{act[j1:j2]}】")
            elif tag == "delete":
                act_out.append("【?】")
    return "".join(exp_out), "".join(act_out)


def edit_distance(a: str, b: str) -> int:
    a, b = normalise(a), normalise(b)
    if a == b:
        return 0
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb))
            )
        previous = current
    return previous[-1]


def simple_stem(word: str) -> str:
    """極簡詞幹化，只為了讓同義詞比對寬鬆一點（reduce/reducing 算同一個）。"""
    w = normalise(word)
    for suffix in ("ing", "edly", "ed", "es", "s", "ly"):
        if len(w) > len(suffix) + 3 and w.endswith(suffix):
            w = w[: -len(suffix)]
            break
    if w.endswith("e") and len(w) > 4:
        w = w[:-1]
    return w


def match_synonyms(
    answers: list[str], expected: list[str]
) -> tuple[list[tuple[str, str]], list[str], list[str]]:
    """比對使用者列出的同義詞。

    回傳 (答對的 [(使用者輸入, 對應答案)], 沒答到的答案, 不在清單裡的輸入)。
    比對容忍大小寫、單複數、-ing/-ed 等詞形變化。
    """
    remaining = list(expected)
    matched: list[tuple[str, str]] = []
    extras: list[str] = []
    for raw in answers:
        answer = normalise(raw)
        if not answer:
            continue
        hit: str | None = None
        for candidate in remaining:
            if normalise(candidate) == answer:
                hit = candidate
                break
        if hit is None:
            stem = simple_stem(raw)
            for candidate in remaining:
                if stem and simple_stem(candidate) == stem:
                    hit = candidate
                    break
        if hit is None:
            extras.append(raw.strip())
        else:
            remaining.remove(hit)
            matched.append((raw.strip(), hit))
    return matched, remaining, extras


def split_answers(raw: str) -> list[str]:
    """使用者可能用逗號、頓號、分號或空白分隔答案。"""
    if not raw:
        return []
    parts = re.split(r"[,，、;；/]|\s{2,}", raw)
    if len(parts) == 1:
        parts = raw.split()
    return [p.strip() for p in parts if p.strip()]


def highlight_target(sentence: str, target: str, wrapper: str = "《》") -> str:
    """在例句裡把目標字用書名號標出來（複習模式用，不依賴顏色）。"""
    if not sentence or not target:
        return sentence or ""
    pattern = _pattern_for(target_tokens(target))
    if pattern is None:
        return sentence
    open_c, close_c = (wrapper + "《》")[0], (wrapper + "《》")[1]
    return pattern.sub(lambda m: f"{open_c}{m.group(0)}{close_c}", sentence)
