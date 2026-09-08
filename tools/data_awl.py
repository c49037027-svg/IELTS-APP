"""AWL 學術詞彙表。

分兩種：
  FULL      四個維度齊全的卡片，可以直接進通勤複習。
  headwords AWL 570 字頭的其餘部分，只帶詞性與英文定義進來，
            標記為不完整 —— 例句、搭配詞、字根、同義詞由你在
            「補完卡片」模式自己寫。自己寫出來的才記得住。

topic 一律是 "Sublist N"，所以在 App 裡可以只練 Sublist 1，
進度頁的主題覆蓋也會照 sublist 分組顯示。
"""

from awl_defs import DEFINITIONS
from awl_headwords import HEADWORDS
from data_awl_s1 import SUBLIST_1
from data_awl_s2 import SUBLIST_2
from data_awl_s3 import SUBLIST_3
from data_awl_s4 import SUBLIST_4
from data_awl_s5 import SUBLIST_5
from data_awl_s6 import SUBLIST_6
from data_awl_s7 import SUBLIST_7
from data_awl_s8 import SUBLIST_8
from data_awl_s9 import SUBLIST_9
from data_awl_s10 import SUBLIST_10

SUBLIST = dict(HEADWORDS)


def _topic(word: str) -> str:
    return f"Sublist {SUBLIST[word]}"


FULL = [
    {
        "word": "conduct", "pos": "v.",
        "example": "Researchers conducted a survey of two thousand university students.",
        "collocations": ["conduct research", "conduct a survey", "conduct an experiment"],
        "root": "con-(一起) + duct(引導, 同 conductor 導體/introduce) → 引導著進行",
        "synonyms": ["carry out", "perform", "undertake"],
        "category": "AWL", "topic": _topic("conduct"), "zh": "進行、執行",
        "notes": "學術寫作講「做研究」幾乎都用這個字，不用 do research",
    },
    {
        "word": "constitute", "pos": "v.",
        "example": "Migrant workers constitute nearly a third of the city's workforce.",
        "collocations": ["constitute a threat", "constitute a majority", "constitute evidence"],
        "root": "con-(一起) + stitut(建立, 同 institute/substitute) → 一起建立成 → 組成",
        "synonyms": ["make up", "form", "comprise", "account for"],
        "category": "AWL", "topic": _topic("constitute"), "zh": "構成、組成",
    },
    {
        "word": "advocate", "pos": "v.",
        "example": "Many educators advocate replacing final exams with continuous assessment.",
        "collocations": ["advocate a policy", "advocate for reform", "strongly advocate"],
        "root": "ad-(朝向) + voc(聲音, 同 voice/vocal/vocation) + -ate → 為某事發聲",
        "synonyms": ["support", "champion", "promote", "call for"],
        "category": "AWL", "topic": _topic("advocate"), "zh": "提倡、主張",
        "notes": "Task 2 表達立場好用；名詞 an advocate of 也很常見",
    },
    {
        "word": "allocate", "pos": "v.",
        "example": "The council allocates a fixed budget to each district every year.",
        "collocations": ["allocate resources", "allocate funding", "allocate time"],
        "root": "ad-(朝向) + loc(地方, 同 location/local) + -ate → 放到該去的位置",
        "synonyms": ["distribute", "assign", "apportion", "earmark"],
        "category": "AWL", "topic": _topic("allocate"), "zh": "分配、撥出",
    },
    {
        "word": "implement", "pos": "v.",
        "example": "The government implemented stricter penalties for repeat offenders.",
        "collocations": ["implement a policy", "implement measures", "implement reforms"],
        "root": "im-(進入) + ple(填滿, 同 complete/supplement) + -ment → 填滿內容 → 付諸實行",
        "synonyms": ["carry out", "enforce", "put into practice", "execute"],
        "category": "AWL", "topic": _topic("implement"), "zh": "實施、執行",
    },
    {
        "word": "accumulate", "pos": "v.",
        "example": "Toxins from processed food gradually accumulate in the body.",
        "collocations": ["accumulate wealth", "accumulate evidence", "accumulate over time"],
        "root": "ac-(朝向) + cumul(堆積, 同 cumulative) + -ate → 一層層堆起來",
        "synonyms": ["build up", "amass", "gather", "pile up"],
        "category": "AWL", "topic": _topic("accumulate"), "zh": "逐漸累積",
    },
    {
        "word": "compensate", "pos": "v.",
        "example": "Longer holidays do not compensate for consistently low wages.",
        "collocations": ["compensate for", "compensate workers", "adequately compensate"],
        "root": "com-(一起) + pens(秤重、支付, 同 expense/pension) + -ate → 秤平、補足",
        "synonyms": ["make up for", "offset", "reimburse", "counterbalance"],
        "category": "AWL", "topic": _topic("compensate"), "zh": "彌補、補償",
        "notes": "compensate for 的 for 不能省",
    },
    {
        "word": "attribute", "pos": "v.",
        "example": "Analysts attribute the drop in sales to the rise of online shopping.",
        "collocations": ["attribute the rise to", "be attributed to", "widely attributed"],
        "root": "at-(朝向) + tribut(給予, 同 tribute/contribute/distribute) → 把原因歸給…",
        "synonyms": ["ascribe", "credit", "put down to"],
        "category": "AWL", "topic": _topic("attribute"), "zh": "歸因於",
        "notes": "attribute A to B 的搭配一定要記",
    },
    {
        "word": "inevitable", "pos": "adj.",
        "example": "Rapid urbanisation makes some loss of farmland inevitable.",
        "collocations": ["an inevitable consequence", "an inevitable decline", "almost inevitable"],
        "root": "in-(不) + evit(避開, 同 evade/evitable) + -able → 無法避開的",
        "synonyms": ["unavoidable", "inescapable", "certain", "bound to happen"],
        "category": "AWL", "topic": _topic("inevitable"), "zh": "不可避免的",
    },
    {
        "word": "pose", "pos": "v.",
        "example": "Rising sea levels pose a serious threat to coastal communities.",
        "collocations": ["pose a threat", "pose a risk", "pose a challenge", "pose a question"],
        "root": "pos(放置, 同 position/expose/compose) → 把某物放到眼前 → 造成、提出",
        "synonyms": ["present", "constitute", "raise", "create"],
        "category": "AWL", "topic": _topic("pose"), "zh": "造成（威脅）、提出",
        "notes": "pose a threat / pose a risk 是閱讀高頻搭配",
    },
    {
        "word": "bias", "pos": "n.",
        "example": "Readers should be aware of the political bias of the newspapers they follow.",
        "collocations": ["media bias", "political bias", "a bias towards", "unconscious bias"],
        "root": "原指保齡球球體偏一邊滾的斜度 → 偏向某一邊",
        "synonyms": ["prejudice", "partiality", "slant", "one-sidedness"],
        "category": "AWL", "topic": _topic("bias"), "zh": "偏見、偏向",
    },
    {
        "word": "infrastructure", "pos": "n.",
        "example": "The city has invested heavily in transport infrastructure over the past decade.",
        "collocations": ["invest in infrastructure", "ageing infrastructure", "transport infrastructure"],
        "root": "infra-(在下面, 同 infrared 紅外線) + structure(結構) → 撐在底下的結構",
        "synonyms": ["public facilities", "basic systems", "utilities", "networks"],
        "category": "AWL", "topic": _topic("infrastructure"), "zh": "基礎建設",
    },
    {
        "word": "integrate", "pos": "v.",
        "example": "Schools are gradually integrating digital tools into everyday lessons.",
        "collocations": ["integrate into", "fully integrated", "integrate with"],
        "root": "integr(完整, 同 integrity/entire) + -ate → 併成完整的一體",
        "synonyms": ["combine", "incorporate", "merge", "bring together"],
        "category": "AWL", "topic": _topic("integrate"), "zh": "整合、融入",
    },
    {
        "word": "offset", "pos": "v.",
        "example": "Planting trees can partly offset the emissions produced by air travel.",
        "collocations": ["offset emissions", "offset the impact", "partly offset"],
        "root": "off(離開) + set(放置) → 放到另一邊去抵掉",
        "synonyms": ["counterbalance", "compensate for", "cancel out", "counteract"],
        "category": "AWL", "topic": _topic("offset"), "zh": "抵銷",
    },
]

#: 已經寫齊四個維度的 sublist。
FULL = [*FULL, *SUBLIST_1, *SUBLIST_2, *SUBLIST_3, *SUBLIST_4, *SUBLIST_5, *SUBLIST_6, *SUBLIST_7, *SUBLIST_8, *SUBLIST_9, *SUBLIST_10]

_FULL_WORDS = {entry["word"].lower() for entry in FULL}

#: 有些 AWL 字頭同時是 Task 1 用語、口說表達或話題字（decline、overall、
#: whereas…）。這些字以功能分類為準，只留一張卡，AWL 出身記在備註裡，
#: 免得同一個字在庫裡出現兩次。
def _claimed_elsewhere() -> set[str]:
    from data_speaking import SPEAKING
    from data_task1 import TASK1
    from data_topics import TOPICS
    return {e["word"].lower() for e in (*TOPICS, *TASK1, *SPEAKING)}


_CLAIMED = _claimed_elsewhere()

#: 其餘字頭：帶詞性與英文定義進來，四個維度留白給補完模式。
BARE = []
for _word, _sub in HEADWORDS:
    if _word.lower() in _FULL_WORDS or _word.lower() in _CLAIMED:
        continue
    _pos, _definition = DEFINITIONS.get(_word, ("", ""))
    BARE.append({
        "word": _word,
        "pos": f"{_pos}." if _pos else "",
        "category": "AWL",
        "topic": f"Sublist {_sub}",
        "zh": "",
        "notes": f"AWL 定義：{_definition}" if _definition else "",
        "bare": True,
    })

AWL = [*FULL, *BARE]
