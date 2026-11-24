/* 生活日曆（v0.6.0，2026-11-24 規劃 47 號 規劃/生活日曆改版規劃_20261124_v1.md）
   🎂 紀念日：正數（已經 N 天）、倒數（還有 N 天）、每年重複；點卡片換 日 → 週 → 月 → 年；安靜顯示下一個里程碑，不推播。
   📅 生活日曆：每天的流水帳＝上班範本＋Google 主要日曆＋修行（34）＋英文打卡（43）＋Claude 專案時間（筆電算好）＋自己補的事＋日記。
   這個檔在 app.js 之前載入；用到 app.js 的工具（$、esc、api、kvGet…）都在函式裡，執行時才找。
   資料：手機存 kv 的 annivs、lifelogs；雲端 小輝日記_私人資料/生活紀錄/紀念日.json、手動紀錄.json（Code.gs v5 lifeSync 用 upd 合併）。 */

const LIFE_CATS = [['work', '🏢', '上班'], ['family', '👨‍👩‍👧', '家庭'], ['xiu', '🪷', '修行'], ['learn', '📚', '學習'], ['health', '💪', '健康'], ['proj', '🛠️', '專案'], ['rest', '☕', '休息娛樂']];
const LIFE_CAT = Object.fromEntries(LIFE_CATS.map(([k, i, n]) => [k, { icon: i, name: n }]));
const WORK = { start: '08:00', end: '17:00' };   // Q11：週一～週五 08:00～17:00，沒上班或改時間在那天自己改
const EVENT_KW = [   // Google 日曆的行程沒有分類，用關鍵字猜；猜不到就不上色
  ['family', /安安|珈安|老婆|太太|家人|家庭|爸|媽|女兒|親子|學校|聚餐|回娘家/],
  ['xiu', /法鼓|禪|念佛|佛|共修|法會|抄經|打坐|義工|菩薩/],
  ['learn', /課|讀書會|英文|Funday|講座|研習|上課|iPAS|考試|學習|演講/i],
  ['health', /運動|健身|跑步|游泳|醫|診|減重|體檢|牙|復健|爬山|騎車/],
  ['work', /公司|會議|稽核|開會|鈦隼|IPO|上班/],
  ['rest', /電影|旅行|旅遊|出遊|休假|放假|看展|音樂會/]
];
const UNITS = ['d', 'w', 'm', 'y'];
const KIND_NAME = { up: '正數（已經 N 天）', down: '倒數（還有 N 天）', yearly: '每年重複（生日、紀念日）' };

const nowIso = () => new Date().toISOString();
const lifeId = () => 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const wk = date => '日一二三四五六'[new Date(date + 'T00:00:00').getDay()];
const fullDate = date => { const [y, m, d] = date.split('-').map(Number); return `${y}-${m}-${d} 星期${wk(date)}`; };   // 跟 Days Matter 一樣：2026-5-31 星期日

/* ---------------- 資料 ---------------- */
async function lifeList(key) { return ((await kvGet(key)) || []).filter(x => x && !x.deleted); }
async function lifePut(key, item) {
  const all = (await kvGet(key)) || [];
  const i = all.findIndex(x => x.id === item.id);
  item.upd = nowIso();
  if (i >= 0) all[i] = item; else all.push(item);
  await kvSet(key, all);
  await kvSet('lifeDirty', true);
  sync();
}
/* sync() 最後呼叫：手機有改才送整份上去，沒改只拿回雲端的；兩邊都用 upd 合併，新的贏 */
async function syncLife() {
  const dirty = !!(await kvGet('lifeDirty'));
  const mine = { annivs: (await kvGet('annivs')) || [], logs: (await kvGet('lifelogs')) || [] };
  const r = await api('lifeSync', dirty ? mine : { annivs: [], logs: [] });
  for (const [kind, key] of [['annivs', 'annivs'], ['logs', 'lifelogs']]) {
    const map = {};
    for (const x of (await kvGet(key)) || []) map[x.id] = x;   // 送出後手機上又改的也留著
    for (const x of r[kind] || []) if (!map[x.id] || String(x.upd || '') > String(map[x.id].upd || '')) map[x.id] = x;
    await kvSet(key, Object.values(map));
  }
  if (dirty) await kvSet('lifeDirty', false);
}

/* ---------------- 紀念日的算法 ---------------- */
const todayNum = () => dayNum(localDate());
function addYM(date, y, m) {   // 2/29、1/31 這種日子，加上去的月份沒有那天就用月底
  const [Y, M, D] = date.split('-').map(Number);
  const t = new Date(Y + y, M - 1 + m, 1), last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return localDate(new Date(t.getFullYear(), t.getMonth(), Math.min(D, last)));
}
function between(a, b) {   // a ≤ b：幾年幾月幾天
  let months = 0;
  while (addYM(a, 0, months + 1) <= b) months++;
  const days = dayNum(b) - dayNum(addYM(a, 0, months));
  return { months, days, years: Math.floor(months / 12), ym: months % 12 };
}
function nextYearly(date) {
  const t = localDate();
  let y = 0;
  const base = Number(t.slice(0, 4)) - Number(date.slice(0, 4));
  y = Math.max(0, base - 1);
  while (addYM(date, y, 0) < t) y++;
  return { date: addYM(date, y, 0), years: y };
}
/** 一筆紀念日現在的狀態：主數字（天數）、從哪天算到哪天、標題 */
function annState(a) {
  const t = localDate(), tn = todayNum();
  if (a.kind === 'down') {
    const n = dayNum(a.date) - tn;
    return n >= 0 ? { n, from: t, to: a.date, word: '還有', title: `${a.name}還有` } : { n: -n, from: a.date, to: t, word: '已經過了', title: `${a.name}已經過了` };
  }
  if (a.kind === 'yearly') {
    const nx = nextYearly(a.date), n = dayNum(nx.date) - tn;
    return { n, from: t, to: nx.date, word: n ? '還有' : '就是今天', title: n ? `${a.name}還有` : `今天是${a.name}`, next: nx, since: tn - dayNum(a.date) };
  }
  const n = tn - dayNum(a.date);
  return n >= 0 ? { n, from: a.date, to: t, word: '已經', title: `${a.name}已經` } : { n: -n, from: t, to: a.date, word: '還有', title: `${a.name}還有` };
}
/** 換單位：回傳 [大數字, 單位, 小字] */
function annUnit(st, unit) {
  const n = st.n;
  if (unit === 'w') return [Math.floor(n / 7), '週', n % 7 ? `又 ${n % 7} 天` : ''];
  if (unit === 'm' || unit === 'y') {
    const b = between(st.from, st.to);
    if (unit === 'm') return [b.months, '個月', b.days ? `又 ${b.days} 天` : ''];
    const rest = [b.ym ? `${b.ym} 個月` : '', b.days ? `${b.days} 天` : ''].filter(Boolean).join(' ');
    return [b.years, '年', rest ? '又 ' + rest : ''];
  }
  return [n, '天', ''];
}
/** 下一個里程碑（正數、每年重複）：未滿 1000 天每 100 天，之後每 1000 天；正數也算週年。挑最近的 */
function milestone(a) {
  if (a.kind === 'down') return '';
  const tn = todayNum(), n = tn - dayNum(a.date);
  if (n < 0) return '';
  const step = n < 1000 ? 100 : 1000, mark = (Math.floor(n / step) + 1) * step;
  const opts = [{ left: mark - n, text: `${mark.toLocaleString()} 天` }];
  if (a.kind === 'up') { const nx = nextYearly(a.date); if (nx.years > 0) opts.push({ left: dayNum(nx.date) - tn, text: `${nx.years} 週年` }); }
  const best = opts.sort((x, y) => x.left - y.left)[0];
  const on = localDate(new Date(Date.now() + best.left * 864e5));
  return best.left === 0 ? `🎉 今天滿 ${best.text}` : `下一個里程碑：${best.text}（還有 ${best.left} 天，${on.slice(5).replace('-', '/')}）`;
}

/* ---------------- 紀念日畫面 ---------------- */
async function annUnitOf(id) { return ((await kvGet('annUnits')) || {})[id] || 'd'; }
async function annCycle(id) {
  const u = (await kvGet('annUnits')) || {};
  u[id] = UNITS[(UNITS.indexOf(u[id] || 'd') + 1) % UNITS.length];
  await kvSet('annUnits', u);
  return u[id];
}
function annCardHtml(a, unit, big) {
  const st = annState(a), [num, u, rest] = annUnit(st, unit);
  return `<div class="anncard ${a.kind === 'up' && st.word === '已經' ? 'up' : 'down'}${big ? ' big' : ''}" data-anncard="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(st.title)} ${num} ${u}，點一下換單位">
    <div class="at">${esc(st.title)}</div>
    <div class="an"><b>${num.toLocaleString()}</b><span>${u}</span></div>
    ${rest ? `<div class="ar">${esc(rest)}</div>` : ''}
    <div class="ad">${a.kind === 'yearly' ? `日期：${esc(fullDate(a.date))}` : a.kind === 'down' ? `目標日：${esc(fullDate(a.date))}` : `起始日：${esc(fullDate(a.date))}`}</div>
    <div class="ahint">點一下換 日／週／月／年</div></div>`;
}
/** 卡片：點一下換單位（直接綁在卡片上，不影響各頁原本的點擊） */
function wireCards(root) {
  root.querySelectorAll('[data-anncard]').forEach(el => {
    const go = async ev => {
      ev.stopPropagation(); ev.preventDefault();
      const id = el.dataset.anncard, a = (await lifeList('annivs')).find(x => x.id === id);
      if (!a) return;
      const unit = await annCycle(id);
      const tmp = document.createElement('div');
      tmp.innerHTML = annCardHtml(a, unit, el.classList.contains('big'));
      const n = tmp.firstElementChild;
      el.replaceWith(n); wireCards(n.parentNode);
    };
    el.onclick = go;
    el.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') go(ev); };
  });
}
const pinnedOf = list => list.find(a => a.pin) || null;
const annSort = list => [...list].sort((x, y) => (y.pin ? 1 : 0) - (x.pin ? 1 : 0) || (x.ord ?? 999) - (y.ord ?? 999) || x.date.localeCompare(y.date));

/* 「今天」頁最上面：置頂那一筆 */
async function paintAnnivTop() {
  const box = $('#annivTop'); if (!box) return;
  const p = pinnedOf(await lifeList('annivs'));
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = annCardHtml(p, await annUnitOf(p.id), false);
  wireCards(box);
}

async function renderAnniv(rest) {
  view.oninput = view.onchange = view.onclick = null;
  const list = annSort(await lifeList('annivs'));
  if (rest && rest.startsWith('edit/')) return renderAnnEdit(rest.slice(5), list);
  if (rest) {   // 一筆的大卡片
    const a = list.find(x => x.id === rest);
    if (!a) { location.hash = '#ann'; return; }
    view.innerHTML = `<div class="head"><a class="btn small" href="#ann">← 紀念日</a><a class="btn small" href="#ann/edit/${esc(a.id)}">✏️ 編輯</a></div>
      ${annCardHtml(a, await annUnitOf(a.id), true)}
      ${milestone(a) ? `<p class="mile">${esc(milestone(a))}</p>` : ''}
      ${a.kind === 'yearly' ? `<p class="muted small center">從 ${esc(a.date)} 到今天已經 ${annState(a).since.toLocaleString()} 天</p>` : ''}
      ${a.note ? `<div class="card"><div class="body">${esc(a.note)}</div></div>` : ''}`;
    wireCards(view);
    return;
  }
  const p = pinnedOf(list), units = (await kvGet('annUnits')) || {};
  view.innerHTML = `<div class="head"><h1>🎂 紀念日</h1><a class="btn small primary" href="#ann/edit/new">＋ 新增</a></div>
    ${p ? annCardHtml(p, units[p.id] || 'd', true) : ''}
    ${list.length ? `<div class="annlist">${list.map(a => {
      const st = annState(a), m = milestone(a);
      return `<a class="annrow" href="#ann/${esc(a.id)}"><span class="nm">${esc(st.title)}${a.pin ? ' 📌' : ''}${m ? `<small>${esc(m)}</small>` : ''}</span>
        <span class="num ${st.word === '已經' || st.word === '已經過了' ? 'up' : 'down'}"><b>${st.n.toLocaleString()}</b><i>天</i></span></a>`;
    }).join('')}</div>` : '<div class="card"><p>還沒有紀念日。按右上角「＋ 新增」。</p></div>'}
    <p class="muted small center">點一筆看大卡片；卡片點一下換 日／週／月／年</p>`;
  wireCards(view);
}

async function renderAnnEdit(id, list) {
  const a = id === 'new' ? { id: lifeId(), name: '', date: localDate(), kind: 'up', pin: false, note: '' } : list.find(x => x.id === id);
  if (!a) { location.hash = '#ann'; return; }
  view.innerHTML = `<div class="head"><h1>${id === 'new' ? '新增紀念日' : '編輯紀念日'}</h1><a class="btn small" href="${id === 'new' ? '#ann' : '#ann/' + esc(a.id)}">取消</a></div>
    <div class="card">
      <label class="field"><span>事項（不用寫「已經」「還有」，會自動加）</span><input type="text" id="aName" maxlength="30" value="${esc(a.name)}" placeholder="例如：菩薩戒"></label>
      <label class="field"><span>日期</span><input type="date" id="aDate" value="${esc(a.date)}"></label>
      <div class="field"><span>類型</span><div class="chips" id="aKind">${Object.entries(KIND_NAME).map(([k, n]) => `<button type="button" class="chip ${a.kind === k ? 'on' : ''}" data-kind="${k}">${n}</button>`).join('')}</div></div>
      <label class="check"><input type="checkbox" id="aPin" ${a.pin ? 'checked' : ''}> 📌 置頂（紀念日頁和「今天」頁最上面的大卡片，只能一筆）</label>
      <label class="field"><span>備註（可不填）</span><textarea id="aNote" rows="2">${esc(a.note || '')}</textarea></label>
      <button class="btn primary wide" id="aSave">儲存</button>
      ${id === 'new' ? '' : '<button class="btn wide" id="aDel">刪除這筆</button>'}
    </div>`;
  let kind = a.kind;
  view.onclick = async ev => {
    const k = ev.target.closest?.('[data-kind]');
    if (k) { kind = k.dataset.kind; view.querySelectorAll('#aKind .chip').forEach(c => c.classList.toggle('on', c.dataset.kind === kind)); return; }
    if (ev.target.id === 'aSave') {
      const name = $('#aName').value.trim().replace(/(已經|還有)$/, ''), date = $('#aDate').value;
      if (!name) { toast('請寫事項'); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('請選日期'); return; }
      const pin = $('#aPin').checked;
      if (pin) for (const o of list) if (o.pin && o.id !== a.id) await lifePut('annivs', { ...o, pin: false });
      await lifePut('annivs', { ...a, name, date, kind, pin, note: $('#aNote').value.trim() });
      toast('存好了'); location.hash = '#ann/' + a.id;
    }
    if (ev.target.id === 'aDel' && confirm(`刪除「${a.name}」？`)) {
      await lifePut('annivs', { ...a, deleted: true });
      location.hash = '#ann';
    }
  };
}

/* ---------------- 生活日曆：一個月的自動資料 ---------------- */
const monthRange = ym => { const [y, m] = ym.split('-').map(Number); return [`${ym}-01`, `${ym}-${pad(new Date(y, m, 0).getDate())}`]; };
async function lifeMonthData(ym, force) {
  const key = 'lm:' + ym, c = await kvGet(key);
  const fresh = c && Date.now() - c.at < 5 * 60000;
  if (!force && fresh) return c.d;
  const cfg = await kvGet('cfg');
  if (!cfg?.url || !navigator.onLine || !gsOk) return c?.d || null;
  try {
    const [from, to] = monthRange(ym);
    const d = await api('lifeMonth', { from, to }, 60000);
    await kvSet(key, { at: Date.now(), d });
    return d;
  } catch (_) { return c?.d || null; }
}
const guessCat = title => (EVENT_KW.find(([, re]) => re.test(title)) || [''])[0];
const workOf = (logs, date) => logs.find(x => x.kind === 'work' && x.date === date);
const isWeekday = date => { const d = new Date(date + 'T00:00:00').getDay(); return d >= 1 && d <= 5; };
const timeKey = t => {
  const m = /(\d{1,2}):(\d{2})/.exec(t || '');
  if (m) return pad(m[1]) + ':' + m[2];
  if (/早|晨|上午/.test(t || '')) return '08:30';
  if (/中午/.test(t || '')) return '12:00';
  if (/下午/.test(t || '')) return '15:00';
  if (/傍晚/.test(t || '')) return '18:00';
  if (/晚/.test(t || '')) return '20:00';
  return '23:58';
};
const hrs = m => m >= 60 ? `${(m / 60).toFixed(1)} 小時` : `${m} 分鐘`;
/** 一天的流水帳（不含日記本身，日記照原本的列在下面） */
function dayItems(date, md, logs) {
  const items = [];
  const w = workOf(logs, date);
  if (isWeekday(date) || (w && !w.off)) {
    if (!w?.off) items.push({ t: w?.start || WORK.start, cat: 'work', title: '上班', sub: `${w?.start || WORK.start}～${w?.end || WORK.end}${w ? '（改過）' : ''}`, work: true });
    else items.push({ t: '00:00', cat: '', title: '這天沒上班', sub: '', work: true, off: true });
  }
  for (const e of md?.events || []) if (e.date === date) items.push({ t: e.allDay ? '00:01' : e.start, cat: guessCat(e.title), title: e.title, sub: e.allDay ? '全天' : `${e.start}～${e.end}`, src: '📆' });
  for (const x of md?.xiuxing || []) if (x.date === date) items.push({ t: x.time || '23:57', cat: 'xiu', title: `${x.type}${x.item ? '・' + x.item : ''}`, sub: [x.qty ? `${x.qty}${x.unit || ''}` : '', x.min ? `${x.min} 分鐘` : ''].filter(Boolean).join('，'), src: '修行 App' });
  for (const x of md?.english || []) if (x.date === date && x.total) items.push({ t: '23:56', cat: 'learn', title: '英文日課', sub: `${x.total} 分鐘（${[['Funday', x.funday], ['口說', x.speak], ['閱讀', x.read], ['複習', x.review]].filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join('、')}）`, src: '英文 App' });
  const pj = md?.projects?.[date];
  if (pj && Object.keys(pj).length) {
    const tot = Object.values(pj).reduce((a, b) => a + b, 0);
    items.push({ t: '23:59', cat: 'proj', title: `Claude 專案 ${hrs(tot)}`, sub: Object.entries(pj).sort((a, b) => b[1] - a[1]).map(([p, m]) => `${p} ${hrs(m)}`).join('、'), src: '筆電' });
  }
  for (const x of logs) if (x.kind === 'log' && x.date === date) items.push({ t: timeKey(x.time), cat: x.cat, title: x.text, sub: x.time || '', log: x });
  return items.sort((a, b) => a.t.localeCompare(b.t));
}
const dayCats = items => [...new Set(items.filter(i => i.cat && !i.off).map(i => i.cat))];

/* 月曆格的小圓點（renderCal 畫好後呼叫） */
async function paintCalDots(ym) {
  const logs = await lifeList('lifelogs');
  const draw = md => document.querySelectorAll('.cal .cd[data-day]').forEach(b => {
    if (!b.dataset.day.startsWith(ym) || b.dataset.day > localDate()) return;   // 還沒到的日子不畫（上班範本只算過去）
    let d = b.querySelector('.dots');
    if (!d) { d = document.createElement('span'); d.className = 'dots'; b.appendChild(d); }
    d.innerHTML = dayCats(dayItems(b.dataset.day, md, logs)).map(c => `<i class="k-${c}"></i>`).join('');
  });
  draw((await kvGet('lm:' + ym))?.d);
  const md = await lifeMonthData(ym);
  if (location.hash.startsWith('#cal') && (location.hash.slice(5) || localDate().slice(0, 7)) === ym) draw(md);
}

/* 點一天：流水帳時間軸＋補一筆（renderCal 的 paintDay 呼叫，放在那天的日記上面） */
async function paintLifeDay(date, box) {
  if (!box) return;
  const ym = date.slice(0, 7), logs = await lifeList('lifelogs');
  const cached = (await kvGet('lm:' + ym))?.d;
  const draw = md => {
    const items = dayItems(date, md, logs);
    box.innerHTML = `<div class="life">
      ${items.map((it, i) => `<div class="li ${it.cat ? 'k-' + it.cat : ''}${it.off ? ' off' : ''}" ${it.log ? `data-log="${esc(it.log.id)}"` : it.work ? 'data-work="1"' : ''}>
        <span class="lic">${it.cat ? LIFE_CAT[it.cat].icon : it.src || '•'}</span>
        <span class="lit"><b>${esc(it.title)}</b>${it.log?.private ? ' 🔒' : ''}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
        ${it.log || it.work ? '<span class="lie">✏️</span>' : it.src ? `<span class="lis">${esc(it.src)}</span>` : ''}</div>`).join('') || '<p class="muted small">這天還沒有紀錄。</p>'}
      <div id="lifeForm"></div>
      <button class="btn wide" id="addLog" type="button">＋ 補一筆</button>
      ${md?.errors?.length ? `<p class="muted small">⚠️ ${esc(md.errors.join('；'))}</p>` : ''}
      ${md?.projectsUpdated ? `<p class="muted small">Claude 專案時間算到 ${esc(md.projectsUpdated.slice(5, 16).replace('T', ' '))}（個人筆電）</p>` : ''}
    </div>`;
    box.onclick = async ev => {
      const t = ev.target;
      if (t.id === 'addLog') return logForm(date, null);
      const lg = t.closest?.('[data-log]');
      if (lg) return logForm(date, logs.find(x => x.id === lg.dataset.log));
      if (t.closest?.('[data-work]')) return workForm(date, workOf(logs, date));
    };
  };
  draw(cached);
  const md = await lifeMonthData(ym);
  if (md !== cached && box.isConnected) draw(md);
}

function logForm(date, x) {
  const f = $('#lifeForm'); if (!f) return;
  const it = x || { id: lifeId(), kind: 'log', date, time: '', cat: '', text: '', private: false };
  f.innerHTML = `<div class="card lform">
    <label class="field"><span>時間（可寫「14:30」「下午」，也可不寫）</span><input type="text" id="lTime" maxlength="12" value="${esc(it.time)}"></label>
    <div class="chips" id="lCat">${LIFE_CATS.map(([k, i, n]) => `<button type="button" class="chip k-${k} ${it.cat === k ? 'on' : ''}" data-cat="${k}">${i} ${n}</button>`).join('')}</div>
    <label class="field"><span>做了什麼</span><input type="text" id="lText" maxlength="80" value="${esc(it.text)}" placeholder="例如：陪安安去公園"></label>
    <label class="check"><input type="checkbox" id="lPriv" ${it.private ? 'checked' : ''}> 🔒 私密（小輝的週報不讀）</label>
    <div class="row"><button class="btn primary" id="lSave" type="button">存</button><button class="btn" id="lCancel" type="button">取消</button>${x ? '<button class="btn" id="lDel" type="button">刪除</button>' : ''}</div></div>`;
  let cat = it.cat;
  f.onclick = async ev => {
    ev.stopPropagation();
    const c = ev.target.closest?.('[data-cat]');
    if (c) { cat = c.dataset.cat; f.querySelectorAll('#lCat .chip').forEach(b => b.classList.toggle('on', b.dataset.cat === cat)); return; }
    if (ev.target.id === 'lCancel') { f.innerHTML = ''; return; }
    if (ev.target.id === 'lDel' && confirm('刪除這一筆？')) { await lifePut('lifelogs', { ...it, deleted: true }); paintLifeDay(date, $('#lifeBox')); paintCalDots(date.slice(0, 7)); return; }
    if (ev.target.id === 'lSave') {
      const text = $('#lText').value.trim();
      if (!text) { toast('請寫做了什麼'); return; }
      if (!cat) { toast('請選一個分類'); return; }
      await lifePut('lifelogs', { ...it, time: $('#lTime').value.trim(), cat, text, private: $('#lPriv').checked });
      toast('記好了'); paintLifeDay(date, $('#lifeBox')); paintCalDots(date.slice(0, 7));
    }
  };
  $('#lText').focus();
}

function workForm(date, w) {
  const f = $('#lifeForm'); if (!f) return;
  const it = w || { id: 'work-' + date, kind: 'work', date, off: false, start: WORK.start, end: WORK.end };
  f.innerHTML = `<div class="card lform"><p class="small" style="margin-top:0">🏢 ${esc(niceDate(date))} 的上班</p>
    <label class="check"><input type="checkbox" id="wOff" ${it.off ? 'checked' : ''}> 這天沒上班（請假、放假）</label>
    <div class="row"><label class="field"><span>上班</span><input type="time" id="wStart" value="${esc(it.start || WORK.start)}"></label>
      <label class="field"><span>下班</span><input type="time" id="wEnd" value="${esc(it.end || WORK.end)}"></label></div>
    <div class="row"><button class="btn primary" id="wSave" type="button">存</button><button class="btn" id="wCancel" type="button">取消</button>${w ? '<button class="btn" id="wReset" type="button">回到平常</button>' : ''}</div></div>`;
  f.onclick = async ev => {
    ev.stopPropagation();
    const id = ev.target.id;
    if (id === 'wCancel') { f.innerHTML = ''; return; }
    if (id === 'wReset') { await lifePut('lifelogs', { ...it, deleted: true }); }
    if (id === 'wSave') await lifePut('lifelogs', { ...it, deleted: false, off: $('#wOff').checked, start: $('#wStart').value || WORK.start, end: $('#wEnd').value || WORK.end });
    if (id === 'wSave' || id === 'wReset') { toast('改好了'); paintLifeDay(date, $('#lifeBox')); paintCalDots(date.slice(0, 7)); }
  };
}
