// 網頁版單字引擎的邏輯測試（在 Node 裡跑，用假的 localStorage）。
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};

const ctx = vm.createContext({ localStorage, console, alert: () => {} });
['js/srs.js', 'js/textutil.js', 'js/cards.js', 'js/legacy-words.js', 'js/store.js']
  .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}
function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || ''} 期待 ${sb}，得到 ${sa}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || '應為 true'); }
const run = expr => vm.runInContext(expr, ctx);

console.log('--- SM-2 ---');
check('首次 Good = 1 天', () => eq(run('SRS.nextInterval({interval:0,ease:2.5,reviews:0}, 3)'), 1));
check('首次 Easy = 6 天', () => eq(run('SRS.nextInterval({interval:0,ease:2.5,reviews:0}, 4)'), 6));
check('第二次 Good = 6 天', () => eq(run('SRS.nextInterval({interval:1,ease:2.5,reviews:1}, 3)'), 6));
check('成熟卡 Good = interval×ease', () => eq(run('SRS.nextInterval({interval:10,ease:2.5,reviews:5}, 3)'), 25));
check('Hard = ×1.2', () => eq(run('SRS.nextInterval({interval:10,ease:2.5,reviews:5}, 2)'), 12));
check('Easy = ×ease×1.3', () => eq(run('SRS.nextInterval({interval:10,ease:2.5,reviews:5}, 4)'), 32.5));
check('Again 重置為 1 天', () => eq(run('SRS.nextInterval({interval:90,ease:2.5,reviews:9}, 1)'), 1));
check('ease 隨評分調整', () => {
  eq(run('SRS.schedule({interval:10,ease:2.5,reviews:3},2,"2026-03-01").ease'), 2.35, 'Hard');
  eq(run('SRS.schedule({interval:10,ease:2.5,reviews:3},4,"2026-03-01").ease'), 2.65, 'Easy');
});
check('ease 有下限 1.3', () => {
  const e = run('(() => { let s={interval:5,ease:1.35,reviews:5,lapses:0}; for(let i=0;i<5;i++) s=SRS.schedule(s,1,"2026-03-01"); return s.ease; })()');
  ok(e >= 1.3, `ease=${e}`);
});
check('Again 記錄 lapse 且排到明天', () => {
  const s = run('SRS.schedule({interval:30,ease:2.5,reviews:6,lapses:0},1,"2026-03-01")');
  eq(s.lapses, 1); eq(s.due, '2026-03-02');
});
check('間隔有上限', () => {
  const s = run('SRS.schedule({interval:400,ease:3.0,reviews:20,lapses:0},4,"2026-03-01")');
  ok(s.interval <= 730, `interval=${s.interval}`);
});
check('不修改傳入的 state', () => {
  const r = run('(() => { const o={interval:5,ease:2.5,reviews:2,lapses:0}; SRS.schedule(o,3,"2026-03-01"); return o.interval===5 && o.reviews===2; })()');
  ok(r);
});
check('短間隔不抖動', () => eq(run('SRS.applyJitter(1)'), 1));
check('抖動不超過 ±5%', () => {
  const r = run('(() => { for(let i=0;i<200;i++){ const v=SRS.applyJitter(100); if(v<95||v>105) return false; } return true; })()');
  ok(r);
});
check('日期加減正確', () => {
  eq(run('Dates.addDays("2026-02-27", 2)'), '2026-03-01');
  eq(run('Dates.diffDays("2026-03-05","2026-03-01")'), 4);
});

console.log('--- 挖空與拼字 ---');
check('挖掉原形', () => {
  const r = run('TextUtil.maskSentence("Governments must act now to mitigate the effects.","mitigate")');
  eq(r.hits, 1); ok(!r.text.includes('mitigate'));
});
check('挖掉變化形', () => {
  ok(run('TextUtil.maskSentence("Air quality has deteriorated sharply.","deteriorate").hits') >= 1);
  ok(run('TextUtil.maskSentence("Researchers conducted a survey.","conduct").hits') >= 1);
  ok(run('TextUtil.maskSentence("The council allocates a budget.","allocate").hits') >= 1);
});
check('挖掉 equip → equipped（字母規則會誤判 ui 為兩個母音）', () => {
  eq(run('TextUtil.maskSentence("Schools were equipped with laptops.","equip").hits'), 1);
  eq(run('TextUtil.maskSentence("Equipping every classroom proved costly.","equip").hits'), 1);
  ok(!run('[...TextUtil.inflections("remain")]').includes('remainned'), 'remain 不該被加上重複字尾');
});
check('挖掉不規則過去式', () => {
  const cases = [
    ['Online sales overtook high-street sales in 2019.', 'overtake'],
    ['Prices rose sharply after the subsidy ended.', 'rise'],
    ['The figure fell to just 20 per cent.', 'fall'],
    ['Enrolment grew steadily throughout the decade.', 'grow'],
    ['The council withdrew the proposal last month.', 'withdraw'],
  ];
  for (const [s, w] of cases) {
    const r = run(`TextUtil.maskSentence(${JSON.stringify(s)}, ${JSON.stringify(w)})`);
    eq(r.hits, 1, `${w}: ${s}`);
  }
});
check('挖掉短字的重複字尾', () => {
  const r = run('TextUtil.maskSentence("Sales dipped briefly in 2012.","dip")');
  eq(r.hits, 1); ok(!r.text.includes('dipped'));
});
check('不誤挖相似字', () => {
  const t = run('TextUtil.maskSentence("That position is possible and posts are open.","pose").text');
  ok(t.includes('position') && t.includes('possible'), t);
});
check('片語挖實詞', () => {
  const r = run('TextUtil.maskSentence("Long working hours take a heavy toll on health.","take its toll")');
  ok(r.hits >= 2); ok(!r.text.includes('toll')); ok(r.text.includes('heavy'));
});
check('空輸入安全', () => {
  eq(run('TextUtil.maskSentence("","word").hits'), 0);
  eq(run('TextUtil.maskSentence("A sentence.","").hits'), 0);
  eq(run('TextUtil.maskSentence("A sentence.","中文").hits'), 0);
});
check('標出目標字', () => ok(run('TextUtil.highlightTarget("Rising sea levels pose a threat.","pose")').includes('《pose》')));
check('拼字比對容忍大小寫與標點', () => {
  ok(run('TextUtil.spellingCorrect("mitigate","  Mitigate ")'));
  ok(run('TextUtil.spellingCorrect("take its toll","Take its toll.")'));
  ok(!run('TextUtil.spellingCorrect("mitigate","mitigat")'));
});
check('編輯距離', () => {
  eq(run('TextUtil.editDistance("mitigate","mitigate")'), 0);
  eq(run('TextUtil.editDistance("mitigate","mitigat")'), 1);
  eq(run('TextUtil.editDistance("mitigate","mitagate")'), 1);
});
check('diff 標出差異', () => {
  const d = run('TextUtil.formatDiff("mitigate","mitagate")');
  ok(d.expected.includes('【') && d.actual.includes('【'), JSON.stringify(d));
});
check('提示不洩答案', () => {
  const s = run('TextUtil.letterSkeleton("mitigate")');
  ok(s.startsWith('m') && s.includes('8') && !s.includes('mitigate'), s);
});

console.log('--- 同義詞比對 ---');
check('各種分隔符號', () => {
  eq(run('TextUtil.splitAnswers("alleviate, reduce; ease")'), ['alleviate', 'reduce', 'ease']);
  eq(run('TextUtil.splitAnswers("alleviate、reduce")'), ['alleviate', 'reduce']);
  eq(run('TextUtil.splitAnswers("alleviate reduce")'), ['alleviate', 'reduce']);
});
check('完全比對', () => {
  const r = run('TextUtil.matchSynonyms(["reduce","ease"],["alleviate","reduce","ease","lessen"])');
  eq(r.matched.length, 2); eq(r.missed.sort(), ['alleviate', 'lessen']); eq(r.extras, []);
});
check('容忍詞形變化', () => {
  const r = run('TextUtil.matchSynonyms(["Reducing","EASE"],["reduce","ease"])');
  eq(r.matched.length, 2); eq(r.extras, []);
});
check('不在清單的另外列出', () => {
  const r = run('TextUtil.matchSynonyms(["banana"],["reduce","ease"])');
  eq(r.matched.length, 0); eq(r.extras, ['banana']); eq(r.missed.length, 2);
});
check('重複答案只算一次', () => {
  const r = run('TextUtil.matchSynonyms(["reduce","reduce"],["reduce","ease"])');
  eq(r.matched.length, 1); eq(r.extras, ['reduce']);
});

console.log('--- 資料層 ---');
run('Store.init()');
check('種子 + 舊資料都進來了', () => {
  const n = run('Store.cardCount()');
  ok(n >= 780, `cardCount=${n}`);
});
check('AWL 570 個字頭都在', () => {
  for (const w of ['abandon', 'analyse', 'constrain', 'sustain', 'widespread']) {
    ok(run(`!!Store.findByWord(${JSON.stringify(w)})`), `缺 ${w}`);
  }
});
check('種子的話題字每個主題剛好 20 個', () => {
  const counts = run(`(() => {
    const c = {};
    SEED_CARDS.filter(x => x.category === '高頻話題字')
      .forEach(x => { c[x.topic] = (c[x.topic] || 0) + 1; });
    return c;
  })()`);
  for (const topic of ['環境', '教育', '科技', '健康', '都市化', '犯罪', '媒體']) {
    eq(counts[topic], 20, topic);
  }
});
check('舊資料的話題字併進同一個主題，不另立分類', () => {
  // 舊版的 Environment / Education 等會對應到中文主題，所以庫裡會比種子多
  const rows = run('Store.coverage("topic")');
  const byName = Object.fromEntries(rows.map(r => [r.name, r.total]));
  for (const topic of ['環境', '教育', '科技', '健康', '都市化', '犯罪', '媒體']) {
    ok(byName[topic] >= 20, `${topic} = ${byName[topic]}`);
  }
});
check('Sublist 1、2 的 120 個字四維度齊全', () => {
  for (const sublist of ['Sublist 1', 'Sublist 2']) {
    const cards = run(`SEED_CARDS.filter(c => c.topic === ${JSON.stringify(sublist)})`);
    eq(cards.length, 60, sublist);
    const bad = cards.filter(c => !c.example || !c.collocations.length || !c.root || c.synonyms.length < 2);
    eq(bad.map(c => c.word), [], `${sublist} 這些卡缺維度`);
  }
});
check('留白的只有例句一項，其他三個維度都備妥', () => {
  const queue = run('Store.completionQueue()');
  eq(queue.length, 432, `待寫例句 ${queue.length} 張`);
  const wrong = run(`Store.completionQueue()
    .filter(c => JSON.stringify(Store.missingCore(c)) !== '["example"]')
    .map(c => c.word)`);
  eq(wrong, [], '這些卡缺的不只例句');
});
check('等你寫例句的卡片都有參考例句可看', () => {
  const bad = run(`Store.completionQueue()
    .filter(c => !c.exampleRef || TextUtil.maskSentence(c.exampleRef, c.word).hits === 0)
    .map(c => c.word)`);
  eq(bad, [], '這些卡沒有可用的參考例句');
});
check('補完佇列依 sublist 由高頻排到低頻', () => {
  const ranks = run(`Store.completionQueue().map(c => {
    const m = /^Sublist (\\d+)$/.exec(c.topic || '');
    return m ? Number(m[1]) : 99;
  })`);
  eq(ranks, [...ranks].sort((a, b) => a - b), '沒有照 sublist 排');
  eq(run('Store.completionQueue()[0].topic'), 'Sublist 3');
});
check('AWL 依 sublist 分組，可以只練 Sublist 1', () => {
  const names = run('Store.coverage("topic").map(r => r.name)');
  for (let n = 1; n <= 10; n++) ok(names.includes(`Sublist ${n}`), `缺 Sublist ${n}`);
});
check('寫好的例句一定含目標字', () => {
  const bad = run(`Store.listCards().filter(c => c.example &&
    TextUtil.maskSentence(c.example, c.word).hits === 0).map(c => c.word)`);
  eq(bad, [], '這些卡的例句挖不到空');
});
check('舊資料的音標補進了既有卡片，沒有被丟掉', () => {
  // 種子卡現在四個維度都齊了，所以舊資料補的是音標與中文句譯這類額外欄位
  const withPhonetic = run('Store.listCards().filter(c => c.phonetic).length');
  eq(withPhonetic, 100, '舊版 100 個字的音標應該全部落在卡片上');
  const c = run('Store.findByWord("analyse")');
  ok(c && c.phonetic, 'analyse 應該從舊資料的 analyze 拿到音標');
});
check('句譯一定對得上卡片上的例句', () => {
  // 句譯與例句是綁在一起的一組。換了例句卻留著舊翻譯，
  // 就會出現中英對不起來的卡 —— 那比沒有翻譯更糟。
  const seed = new Map(run('SEED_CARDS.map(c => [c.word.toLowerCase(), { ex: c.example, zh: c.exampleZh }])'));
  const rows = run('Store.listCards().map(c => ({ w: c.word, ex: c.example, zh: c.exampleZh }))');
  const bad = rows.filter(r => {
    const own = seed.get(r.w.toLowerCase());
    return own && own.ex && own.ex === r.ex && r.zh !== own.zh;
  }).map(r => r.w);
  eq(bad, [], `${bad.length} 張卡的句譯跟例句對不起來`);
});
check('沒有孤兒句譯，種子例句也都附了句譯', () => {
  // 自己寫的句子沒有翻譯很正常；但「有翻譯卻沒有句子」代表翻譯配到別的句子上了
  const orphan = run('Store.listCards().filter(c => c.exampleZh && !c.example).map(c => c.word)');
  eq(orphan, [], '有句譯卻沒有例句');
  const missing = run('SEED_CARDS.filter(c => c.example && !c.exampleZh).map(c => c.word)');
  eq(missing, [], '種子例句缺句譯');
});
check('參考例句也都有中譯', () => {
  const bad = run(`SEED_CARDS.filter(c =>
    (c.exampleRef && !c.exampleRefZh) || (c.exampleRefZh && !c.exampleRef)).map(c => c.word)`);
  eq(bad, [], `${bad.length} 張卡的參考例句與中譯沒有成對`);
});

check('美式與英式拼法不會變成兩張卡', () => {
  ok(!run('Store.findByWord("analyze")'), 'analyze 應該併進 analyse，不該另開一張');
  ok(!!run('Store.findByWord("analyse")'), 'analyse 要在');
});
check('選 Sublist 1 不會混進 Sublist 10', () => {
  const topics = run('Store.listCards({ topic: "Sublist 1" }).map(c => c.topic)');
  eq([...new Set(topics)], ['Sublist 1']);
  eq(topics.length, 60);
});
check('例句已經寫好的那批，四維度齊全', () => {
  const complete = run('SEED_CARDS.filter(c => c.example)');
  eq(complete.length, 347, `例句已寫好的有 ${complete.length} 張`);
  const bad = complete.filter(c => !c.collocations.length || !c.root || c.synonyms.length < 2);
  eq(bad.map(c => c.word), [], '這些卡缺維度');
});
check('每張種子卡的搭配詞、字根、同義詞都齊全', () => {
  const bad = run(`SEED_CARDS.filter(c =>
    !c.collocations.length || !c.root || c.synonyms.length < 2
  ).map(c => c.word)`);
  eq(bad, [], `${bad.length} 張卡沒寫齊`);
});
check('例句欄留白的卡片一定有參考例句', () => {
  const bad = run('SEED_CARDS.filter(c => !c.example && !c.exampleRef).map(c => c.word)');
  eq(bad, [], `${bad.length} 張卡連參考例句都沒有`);
});
check('舊版單字進到庫裡之後也都是四個維度齊全的', () => {
  // 跟種子重複的字會併進既有卡片（那張本來就齊全）；其餘的字自己帶著四個維度進來
  const bad = run(`LEGACY_VOCABULARY
    .map(w => Store.findLoosely(w.en))
    .filter(c => c && Store.missingCore(c).length)
    .map(c => c.word)`);
  eq(bad, [], `${bad.length} 張舊字卡沒寫齊`);
});
check('種子字四個分類都在', () => {
  const names = run('Store.coverage("category").map(r => r.name)');
  ['AWL', '高頻話題字', 'Task1圖表用語', '口說表達'].forEach(c => ok(names.includes(c), `缺 ${c}`));
});
check('每張卡都有三軌排程', () => {
  const r = run('Store.listCards().every(c => Store.TRACKS.every(t => !!Store.getSrs(c.id, t)))');
  ok(r);
});
check('新卡今天到期', () => ok(run('Store.dueCount("recall") > 0')));
check('每天的新卡有上限，不會一次爆 800 張', () => {
  const n = run('Store.dueCount("recall")');
  eq(n, run('Store.NEW_PER_DAY'), `今日到期 ${n} 張`);
  eq(run('Store.spellingQueue({}).length'), run('Store.NEW_PER_DAY'));
});
check('複習過的舊卡不受新卡上限影響', () => {
  const r = run(`(() => {
    const before = Store.dueCount('recall');
    const items = Store.dueItems('recall', { limit: 5 });
    items.forEach(c => Store.grade(c.id, 'recall', 1));
    return { before, after: Store.dueCount('recall'),
             introduced: Store.newIntroducedToday('recall') };
  })()`);
  eq(r.introduced, 5, '今天放行了 5 張新卡');
  eq(r.after, r.before - 5, '額度應該扣掉已放行的張數');
});
check('評分後今天就不再出現', () => {
  const r = run(`(() => {
    const card = Store.dueItems('recall', {limit:1})[0];
    Store.grade(card.id, 'recall', 3);
    return Store.getSrs(card.id,'recall').due > Store.today();
  })()`);
  ok(r);
});
check('三軌獨立：拼錯不影響認讀', () => {
  const r = run(`(() => {
    const card = Store.findByWord('mitigate');
    Store.grade(card.id,'recall',4); Store.grade(card.id,'recall',4); Store.grade(card.id,'recall',4);
    const before = Store.getSrs(card.id,'recall').interval;
    Store.grade(card.id,'spelling',1);
    const after = Store.getSrs(card.id,'recall').interval;
    return {same: before === after, spelling: Store.getSrs(card.id,'spelling').interval};
  })()`);
  ok(r.same, '認讀間隔被拼字影響了');
  eq(r.spelling, 1);
});
check('拼錯進錯誤清單，且當下就能重練', () => {
  const r = run(`(() => {
    const card = Store.findByWord('congestion');
    Store.recordSpelling(card.id, 'congession', false);
    Store.grade(card.id, 'spelling', 1);
    const queue = Store.spellingQueue({onlyWrong:true});
    const errs = Store.spellingErrorList();
    return { inQueue: queue.some(c => c.id === card.id), topError: errs[0].card.word };
  })()`);
  ok(r.inQueue, '剛拼錯的字應該可以立刻重練');
  eq(r.topError, 'congestion');
});
check('之後拼對就移出錯誤清單', () => {
  const r = run(`(() => {
    const card = Store.findByWord('congestion');
    Store.recordSpelling(card.id, 'congestion', true);
    return Store.spellingQueue({onlyWrong:true}).some(c => c.id === card.id);
  })()`);
  ok(!r);
});
check('拼字正確率', () => {
  const a = run('Store.spellingAccuracy()');
  eq(a.total, 2); eq(a.correct, 1); eq(a.accuracy, 0.5);
});
check('升級條件：複習過 3 次才夠格', () => {
  const r = run(`(() => {
    const ids = Store.promotionCandidates({minReviews:3, limit:50}).map(c => c.word);
    return { hasMitigate: ids.includes('mitigate'), hasFresh: ids.includes('curriculum') };
  })()`);
  ok(r.hasMitigate, 'mitigate 複習過 3 次應該夠格');
  ok(!r.hasFresh, '沒複習過的字不該列入');
});
check('升級後進入造句池', () => {
  const r = run(`(() => {
    const card = Store.findByWord('curriculum');
    const before = Store.productionCandidates().some(c => c.id === card.id);
    Store.setCardType(card.id, 'active');
    return { before, after: Store.productionCandidates().some(c => c.id === card.id) };
  })()`);
  ok(!r.before && r.after);
});
check('造句紀錄與匯出', () => {
  run(`(() => { const c = Store.findByWord('curriculum'); Store.addProduction(c.id, '教育', 'Q?', 'The national curriculum should include financial literacy.'); })()`);
  const md = run('Store.exportProductionsMarkdown()');
  ok(md.includes('curriculum') && md.includes('financial literacy'), md.slice(0, 200));
  eq(run('Store.distinctWordsUsed()'), 1);
});
check('補完欄位後不再是 incomplete', () => {
  const r = run(`(() => {
    const card = Store.addCard({ word: 'zzpartial', example: 'A zzpartial case.', collocations: ['a zzpartial case'] });
    const before = Store.isIncomplete(Store.getCard(card.id));
    Store.updateCard(card.id, { root: 'ana-(分開) + lyz(鬆開) → 拆開來看', synonyms: 'examine; study; evaluate' });
    const after = Store.getCard(card.id);
    return { before, incomplete: Store.isIncomplete(after), syn: after.synonyms };
  })()`);
  ok(r.before, '補之前應該是不完整的');
  ok(!r.incomplete);
  eq(r.syn, ['examine', 'study', 'evaluate']);
});
check('連續學習天數', () => ok(run('Store.streak()') >= 1));

console.log('--- CSV ---');
check('匯入新字並標記不完整', () => {
  const r = run(`Store.importCSV("word,pos,中文\\nnegligible,adj.,微不足道的\\n")`);
  eq(r.added, 1); eq(r.incomplete, 1);
  eq(run('Store.findCard("negligible","adj.").zh'), '微不足道的');
});
check('重複的字預設略過', () => {
  const r = run(`Store.importCSV("word,pos\\nnegligible,adj.\\n")`);
  eq(r.added, 0); eq(r.skipped, 1);
});
check('--update 會覆寫', () => {
  const r = run(`Store.importCSV("word,pos,中文\\nnegligible,adj.,微不足道的、可忽略的\\n", {update:true})`);
  eq(r.updated, 1);
  eq(run('Store.findCard("negligible","adj.").zh'), '微不足道的、可忽略的');
});
check('缺 word 的列回報行號不當掉', () => {
  const r = run(`Store.importCSV("word,pos\\n,adj.\\nvalid,n.\\n")`);
  eq(r.added, 1); eq(r.skipped, 1); eq(r.errors.length, 1);
  ok(r.errors[0].includes('第 2 行'), r.errors[0]);
});
check('引號內的逗號不會被切開', () => {
  const r = run(`Store.importCSV('word,example_sentence\\nphase,"First, we assess the phase."\\n')`);
  eq(r.added, 1);
  eq(run('Store.findCard("phase").example'), 'First, we assess the phase.');
});
check('Tab 分隔也吃得下', () => {
  const r = run(`Store.importCSV("word\\tpos\\ntabbed\\tv.\\n")`);
  eq(r.added, 1);
});
check('沒有 word 欄位會明確報錯', () => {
  const r = run(`Store.importCSV("foo,bar\\n1,2\\n")`);
  eq(r.added, 0); ok(r.errors[0].includes('word'), r.errors[0]);
});
check('匯出可以再匯入（欄位對得回去）', () => {
  const csv = run('Store.exportCSV()');
  ok(csv.split('\n')[0].includes('word,pos,example_sentence'), csv.slice(0, 80));
  ok(csv.includes('mitigate'));
});

console.log('--- 舊進度轉換 ---');
check('舊的 known / learning 會換算成認讀進度', () => {
  const mem2 = {};
  const ls = {
    getItem: k => (k in mem2 ? mem2[k] : null),
    setItem: (k, v) => { mem2[k] = String(v); },
    removeItem: k => { delete mem2[k]; }
  };
  ls.setItem('ielts-state', JSON.stringify({ vocab: { analyze: { status: 'known' }, approach: { status: 'learning' } } }));
  const c2 = vm.createContext({ localStorage: ls, console, alert: () => {} });
  ['js/srs.js', 'js/textutil.js', 'js/cards.js', 'js/legacy-words.js', 'js/store.js']
    .forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c2, { filename: f }));
  vm.runInContext('Store.init()', c2);
  const known = vm.runInContext('Store.getSrs(Store.findLoosely("analyze").id,"recall")', c2);
  const learning = vm.runInContext('Store.getSrs(Store.findByWord("approach").id,"recall")', c2);
  eq(known.reviews, 2, 'known');
  eq(known.interval, 6, 'known interval');
  eq(learning.reviews, 1, 'learning');
  const fresh = vm.runInContext('Store.getSrs(Store.findByWord("mitigate").id,"recall").reviews', c2);
  eq(fresh, 0, '沒學過的字不該有進度');
});

console.log('--- 種子資料的線索 ---');
// 用 SEED_CARDS 而不是 Store.listCards()：上面的 CSV 測試會往同一個 store
// 塞測試卡片，拿整個 store 檢查會抓到那些假資料。
check('每張種子卡都至少有一個線索（不然任何模式都出不了題）', () => {
  const mute = run(`SEED_CARDS
    .filter(c => !c.example && !c.exampleRef && !c.notes).map(c => c.word)`);
  eq(mute, [], `${mute.length} 張卡沒有任何線索`);
});
check('關掉中文之後拼字題一張也不會少', () => {
  const bad = run(`SEED_CARDS.filter(c => !Store.spellingSentence(c) && !c.notes).map(c => c.word)`);
  eq(bad, [], '這些卡在純英文模式下出不了拼字題');
});
check('每張種子卡都有詞性', () => {
  const missing = run('SEED_CARDS.filter(c => !c.pos).map(c => c.word)');
  eq(missing, [], `${missing.length} 張卡沒有詞性`);
});
check('只能靠備註出題的卡片，備註裡不會有答案', () => {
  // 備註只有在「例句與參考例句都沒有」時才拿來當拼字線索
  const leaks = run(`SEED_CARDS
    .filter(c => !c.example && !c.exampleRef && c.notes
                 && TextUtil.maskSentence(c.notes, c.word).hits > 0)
    .map(c => c.word)`);
  eq(leaks, [], '備註裡出現了答案本身');
});

check('例句還沒寫的卡片照樣進得了通勤複習', () => {
  // 背面還有搭配詞、字根、同義詞、中文 —— 那已經是一張夠用的卡
  const blank = run(`Store.completionQueue()[0]`);
  ok(blank && !blank.example, '應該有例句留白的卡片');
  ok(run(`Store.hasBackContent(Store.completionQueue()[0])`), '背面不該被當成空的');
});
check('完全沒內容的卡片不會進通勤複習', () => {
  const r = run(`(() => {
    const c = Store.addCard({ word: 'zzempty' });
    return Store.hasBackContent(c);
  })()`);
  eq(r, false);
});
check('可複習的卡片數不受「例句還沒寫」影響', () => {
  const n = run('Store.listCards({ cardType: "passive" }).filter(Store.hasBackContent).length');
  ok(n > 700, `只有 ${n} 張可複習`);
});

console.log('--- 中文意思開關 ---');
check('預設是顯示中文', () => eq(run('Store.showZh()'), true));
check('CSV 認得 chinese_meaning 這個欄位名', () => {
  ['chinese_meaning', 'Chinese Meaning', 'chineseMeaning', '中文意思', '中文'].forEach(h => {
    eq(run(`Store.normaliseHeader(${JSON.stringify(h)})`), 'zh_hint', h);
  });
});
check('關掉之後 showZh() 為 false，而且存得住', () => {
  run('Store.setPrefs({showZh:false})');
  eq(run('Store.showZh()'), false);
  const saved = JSON.parse(mem['ielts-vocab-v2']);
  eq(saved.prefs.showZh, false, '沒有寫進 localStorage');
});
check('關掉中文時，只有中文可當線索的卡片不會出拼字題', () => {
  const r = run(`(() => {
    const card = Store.addCard({ word: 'zzonlyzh', zh: '只有中文' });
    Store.setPrefs({showZh:false});
    const hiddenOk = Store.hasSpellingClue(card);
    Store.setPrefs({showZh:true});
    const shownOk = Store.hasSpellingClue(card);
    return [hiddenOk, shownOk];
  })()`);
  eq(r, [false, true]);
});
check('有例句的卡片不受中文開關影響', () => {
  const r = run(`(() => {
    const card = Store.addCard({ word: 'zzhasex', example: 'A zzhasex appeared.', zh: '有中文' });
    Store.setPrefs({showZh:false});
    const a = Store.hasSpellingClue(card);
    Store.setPrefs({showZh:true});
    return [a, Store.hasSpellingClue(card)];
  })()`);
  eq(r, [true, true]);
});
check('只有英文定義的字頭卡在純英文模式下照樣能出題', () => {
  const r = run(`(() => {
    const card = Store.addCard({ word: 'zzdefonly', notes: 'AWL 定義：something' });
    Store.setPrefs({showZh:false});
    const a = Store.hasSpellingClue(card);
    Store.setPrefs({showZh:true});
    return a;
  })()`);
  eq(r, true);
});
check('setPrefs 只吃布林，塞垃圾不會壞掉', () => {
  run('Store.setPrefs({showZh:"yes"})');
  eq(run('Store.showZh()'), false, '非 true 一律當關閉');
  run('Store.setPrefs({showZh:true})');
  eq(run('Store.showZh()'), true);
});

console.log('--- 發音 ---');
// 這個 context 沒有 window，等同「不支援語音合成的瀏覽器」
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), ctx, { filename: 'js/speech.js' });

check('沒有語音合成時 supported() 為 false', () => eq(run('Speech.supported()'), false));
check('不支援時不畫喇叭按鈕', () => eq(run('Speech.button("mitigate")'), ''));
check('不支援時 say() 回 false，不丟例外', () => eq(run('Speech.say("mitigate")'), false));

check('挑語音：同口音的本機語音優先', () => {
  const r = run(`Speech.pickVoice([
    {name:'US cloud', lang:'en-US', localService:false},
    {name:'GB cloud', lang:'en-GB', localService:false},
    {name:'GB local', lang:'en-GB', localService:true}
  ], 'en-GB').name`);
  eq(r, 'GB local');
});
check('挑語音：沒有本機的就用同口音雲端語音', () => {
  eq(run(`Speech.pickVoice([{name:'GB cloud',lang:'en-GB',localService:false}], 'en-GB').name`), 'GB cloud');
});
check('挑語音：沒有該口音時退回其他英語', () => {
  eq(run(`Speech.pickVoice([{name:'AU',lang:'en-AU',localService:true}], 'en-GB').name`), 'AU');
});
check('挑語音：en_GB 底線寫法也算同口音', () => {
  eq(run(`Speech.pickVoice([{name:'X',lang:'en_GB',localService:true}], 'en-GB').name`), 'X');
});
check('挑語音：完全沒有英語語音時回 null', () => {
  eq(run(`Speech.pickVoice([{name:'中文',lang:'zh-TW',localService:true}], 'en-GB')`), null);
});
check('挑語音：清單是空的或壞的都不會爆', () => {
  eq(run(`Speech.pickVoice([], 'en-GB')`), null);
  eq(run(`Speech.pickVoice(null, 'en-GB')`), null);
  eq(run(`Speech.pickVoice([null, undefined], 'en-GB')`), null);
});

check('設定預設值：英式、0.9 倍速、不自動念', () => {
  const p = run('Speech._normalisePrefs({})');
  eq(p, { accent: 'en-GB', rate: 0.9, autoExample: false });
});
check('語速夾在 0.6–1.2', () => {
  eq(run('Speech._normalisePrefs({rate: 5}).rate'), 1.2);
  eq(run('Speech._normalisePrefs({rate: 0.1}).rate'), 0.6);
  eq(run('Speech._normalisePrefs({rate: "abc"}).rate'), 0.9);
});
check('不認得的口音退回英式', () => eq(run('Speech._normalisePrefs({accent:"fr-FR"}).accent'), 'en-GB'));
check('設定寫得進 localStorage 也讀得回來', () => {
  run('Speech.setPrefs({accent:"en-US", rate:1.1, autoExample:true})');
  eq(JSON.parse(mem['ielts-speech']), { accent: 'en-US', rate: 1.1, autoExample: true });
  eq(run('Speech.getPrefs().accent'), 'en-US');
  run('Speech.setPrefs({accent:"en-GB", rate:0.9, autoExample:false})');
});

// 換一個有 window 的 context，模擬真的支援語音合成的瀏覽器
check('支援語音時會呼叫 speak，並帶上挑好的語音與語速', () => {
  const spoken = [];
  const win = {
    speechSynthesis: {
      getVoices: () => [{ name: 'Daniel', lang: 'en-GB', localService: true }],
      speak: u => spoken.push(u),
      cancel: () => {}, resume: () => {},
      addEventListener: () => {}
    },
    SpeechSynthesisUtterance: function (text) { this.text = text; }
  };
  const c3 = vm.createContext({ localStorage, console, window: win });
  c3.window.SpeechSynthesisUtterance = win.SpeechSynthesisUtterance;
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/speech.js'), 'utf8'), c3, { filename: 'js/speech.js' });
  vm.runInContext('Speech.setPrefs({accent:"en-GB", rate:0.8, autoExample:false})', c3);
  eq(vm.runInContext('Speech.supported()', c3), true, 'supported');
  eq(vm.runInContext('Speech.say("mitigate")', c3), true, 'say 回傳值');
  eq(spoken.length, 1, '念了幾次');
  eq(spoken[0].text, 'mitigate');
  eq(spoken[0].voice.name, 'Daniel');
  eq(spoken[0].rate, 0.8);
  eq(spoken[0].lang, 'en-GB');

  // 自動念要看設定
  eq(vm.runInContext('Speech.autoSay("hello")', c3), false, '沒開自動念時不該出聲');
  vm.runInContext('Speech.setPrefs({autoExample:true})', c3);
  eq(vm.runInContext('Speech.autoSay("hello")', c3), true, '開了就要出聲');
  eq(spoken.length, 2);

  // 按鈕：例句裡的引號不能把 HTML 屬性切斷
  const html = vm.runInContext(`Speech.button('He said "no" & left')`, c3);
  ok(html.includes('data-speak="He said &quot;no&quot; &amp; left"'), `按鈕 HTML 沒跳脫好：${html}`);
  ok(!html.includes('<script'), '不該混進標籤');
});

console.log(`\n通過 ${passed} 項，失敗 ${failed} 項`);
process.exit(failed ? 1 : 0);
