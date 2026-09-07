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
check('補完佇列依 sublist 排序，從 Sublist 3 開始', () => {
  const queue = run('Store.completionQueue({ limit: 20 }).map(c => c.topic)');
  ok(queue.length > 0, '佇列不該是空的');
  eq([...new Set(queue)], ['Sublist 3'], `實際是 ${[...new Set(queue)]}`);
  const ranks = run(`Store.completionQueue().map(c => {
    const m = /^Sublist (\\d+)$/.exec(c.topic || '');
    return m ? Number(m[1]) : 99;
  })`);
  eq(ranks, [...ranks].sort((a, b) => a - b), '補完順序沒有照 sublist 由小到大');
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
check('舊資料的例句補進了 AWL 空卡，沒有被丟掉', () => {
  const merged = run(`(() => {
    const c = Store.listCards().find(x => x.category === 'AWL' && !x.root
      && x.example && x.collocations.length);
    return c ? c.word : null;
  })()`);
  ok(merged, '應該有 AWL 卡片從舊資料拿到例句與搭配詞');
});
check('選 Sublist 1 不會混進 Sublist 10', () => {
  const topics = run('Store.listCards({ topic: "Sublist 1" }).map(c => c.topic)');
  eq([...new Set(topics)], ['Sublist 1']);
  eq(topics.length, 60);
});
check('寫完的卡片四維度齊全', () => {
  const complete = run(`SEED_CARDS.filter(c => c.example || c.root || c.collocations.length || c.synonyms.length)`);
  ok(complete.length > 200, `只有 ${complete.length} 張`);
  const bad = complete.filter(c => !c.example || !c.collocations.length || !c.root || c.synonyms.length < 2);
  eq(bad.map(c => c.word), [], '這些卡缺維度');
});
check('沒寫完的卡片標記為不完整，交給補完模式', () => {
  const n = run('Store.incompleteCount()');
  ok(n > 400, `incomplete=${n}`);
  const card = run('Store.findByWord("alternative")');
  ok(card, '找不到 alternative');
  eq(run('Store.missingCore(Store.findByWord("alternative")).sort()'),
     ['collocations', 'example', 'root', 'synonyms']);
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
    const card = Store.findByWord('analyze');
    Store.updateCard(card.id, { root: 'ana-(分開) + lyz(鬆開) → 拆開來看', synonyms: 'examine; study; evaluate' });
    const after = Store.getCard(card.id);
    return { incomplete: Store.isIncomplete(after), syn: after.synonyms };
  })()`);
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
  const known = vm.runInContext('Store.getSrs(Store.findByWord("analyze").id,"recall")', c2);
  const learning = vm.runInContext('Store.getSrs(Store.findByWord("approach").id,"recall")', c2);
  eq(known.reviews, 2, 'known');
  eq(known.interval, 6, 'known interval');
  eq(learning.reviews, 1, 'learning');
  const fresh = vm.runInContext('Store.getSrs(Store.findByWord("mitigate").id,"recall").reviews', c2);
  eq(fresh, 0, '沒學過的字不該有進度');
});

console.log(`\n通過 ${passed} 項，失敗 ${failed} 項`);
process.exit(failed ? 1 : 0);
