/* 阿輝的心情日誌（repo 名 diary）v0.2.1：今天（小語、心情方塊、問題、自由日記、語音兩模式、心情、四它、安安、感恩、照片影片）、時間軸、設定。資料先存手機，有網路再送雲端。 */
const APP_VERSION = '0.2.1';
const NEED_GS = 'v3';            // 新欄位要 Code.gs v3 才存得住
const CHUNK = 8 * 1024 * 1024;   // 一塊 8 MiB（要是 256 KiB 的倍數）
const MOODS = ['平靜', '歡喜', '感恩', '煩躁', '焦慮', '疲累', '低落'];
const MOOD_GOOD = ['歡喜', '感恩'], MOOD_LOW = ['煩躁', '焦慮', '疲累', '低落'];
const FOUR_ITS = ['面對它', '接受它', '處理它', '放下它'];
const VOICE_MODES = [['text', '只轉文字'], ['audio', '只錄音']];   // 11/6 真手機：錄音和轉文字不能同時用，而且不會報錯，所以不提供
const QUOTES_DAYS = 7;           // 幾天向雲端確認一次句庫
const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
const pad = n => String(n).padStart(2, '0');
const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayNum = date => Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
const niceDate = date => { const d = new Date(date + 'T00:00:00'); return `${d.getMonth() + 1}月${d.getDate()}日 週${'日一二三四五六'[d.getDay()]}`; };
const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2600); }

/* ---------------- 問題 ---------------- */
function questionFor(date, shift = 0) {
  const n = dayNum(date) + shift, len = QUESTIONS.length;
  return QUESTIONS[((n % len) + len) % len];
}

/* ---------------- 天數與心情方塊 ---------------- */
function stats(entries) {
  const days = new Set(entries.filter(e => !e.deleted).map(e => e.date));
  const today = dayNum(localDate());
  const in14 = [...days].filter(d => today - dayNum(d) < 14 && today >= dayNum(d)).length;
  return { total: days.size, in14 };
}
/* 好和低落都有時看哪邊多，一樣多算普通；自訂心情、平靜、沒選心情都算普通 */
function moodClass(moods = []) {
  const good = moods.filter(m => MOOD_GOOD.includes(m)).length, low = moods.filter(m => MOOD_LOW.includes(m)).length;
  return good > low ? 'g' : low > good ? 'l' : 'm';
}
function days14(entries) {
  const last = {};   // 當天多篇時用最後一篇
  for (const e of entries) if (!e.deleted && (!last[e.date] || String(e.at) > String(last[e.date].at))) last[e.date] = e;
  const out = [], now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), key = localDate(d);
    out.push({ date: key, cls: last[key] ? moodClass(last[key].moods) : '' });
  }
  return out;
}
const daysHtml = entries => `<div class="days">${days14(entries).map(d => `<i class="${d.cls}" title="${esc(d.date)}"></i>`).join('')}</div>
  <div class="legend"><span><b class="g"></b>好</span><span><b class="m"></b>普通</span><span><b class="l"></b>低落</span><span><b></b>沒寫</span></div>`;

/* ---------------- 每日小語：每天三句，一次一句 ---------------- */
let quoteList = [], quoteOrder = [], quoteI = 0;
function shuffled(n) {   // 固定順序的洗牌，每天不用記狀態，主題也不會擠在一起
  const a = [...Array(n).keys()]; let s = 47;
  for (let i = n - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function setQuotes(list) { quoteList = Array.isArray(list) ? list : []; quoteOrder = shuffled(quoteList.length); }
function quoteFor(date, i) {
  const n = quoteList.length; if (!n) return null;
  return quoteList[quoteOrder[(((dayNum(date) * 3 + i) % n) + n) % n]];
}
function paintQuote() {
  const box = $('#quoteBox'); if (!box) return;
  const q = quoteFor(localDate(), quoteI);
  if (!q) { box.innerHTML = ''; return; }
  const work = q.work ? `《${esc(q.work)}》` : '';
  const src = q.said ? `${esc(q.said)}，引自 ${esc(q.author)}${work}` : `${esc(q.author)}${work ? '，' + work : ''}`;
  box.innerHTML = `<div class="quote"><div class="en">“${esc(q.en)}”</div><div class="zh">${esc(q.zh)}</div>
    <div class="src">— ${src}${q.year ? `（${esc(q.year)}）` : ''}</div>
    <div class="qfoot"><span>${quoteI + 1}/3</span><button class="link" id="nextQuote">下一句 ›</button></div></div>`;
}
async function loadQuotes(force) {   // 句庫有著作權，不放公開 repo：放私人雲端，用密語讀進手機
  const cfg = await kvGet('cfg');
  if (!cfg?.url) return;
  const at = await kvGet('quotesAt');
  if (!force && quoteList.length && at && Date.now() - at < QUOTES_DAYS * 86400000) return;
  try {
    const r = await api('quotes');
    await kvSet('quotesAt', Date.now());
    if (Array.isArray(r.quotes) && r.quotes.length) { await kvSet('quotes', r.quotes); setQuotes(r.quotes); paintQuote(); }
  } catch (_) { /* 舊版 Code.gs 或斷線：小語不影響寫日記，下次再試 */ }
}

/* ---------------- 草稿 ---------------- */
function newDraft() {
  const date = localDate(), { q, cat } = questionFor(date);
  return { date, shift: 0, q, qcat: cat, text: '', moods: [], fourIt: '', ananMood: '', thanks: ['', '', ''], accept: '', handle: '', letgo: '', anan: '', private: false, media: [] };
}
/* 舊版草稿、舊日記沒有新欄位，補齊才不會出錯；舊欄位原樣留著 */
const fill = d => {
  const r = { ...newDraft(), ...d };
  if (d.q && d.qcat === undefined) r.qcat = '';   // 舊題目沒有類別
  r.thanks = [...(r.thanks || [])]; while (r.thanks.length < 3) r.thanks.push('');
  r.moods = [...(r.moods || [])];
  return r;
};
/* 今天的草稿和修改舊篇分開放，修改舊篇不會蓋掉今天寫到一半的內容 */
const keepDraft = d => kvSet(d.editId ? 'editDraft' : 'draft', d);
const dropDraft = d => kvDel(d.editId ? 'editDraft' : 'draft');
async function getDraft() {
  const edit = await kvGet('editDraft');
  if (edit) return fill(edit);
  const saved = await kvGet('draft');
  if (!saved) return newDraft();
  const d = fill(saved);
  // 昨天沒寫完的草稿，內容留著，日期跟著今天；修改舊日記的不動
  if (d.date !== localDate()) { d.date = localDate(); if (!d.text) { const n = questionFor(d.date); d.shift = 0; d.q = n.q; d.qcat = n.cat; } }
  return d;
}

/* ---------------- 語音：只轉文字（Web Speech）或只錄音（MediaRecorder） ---------------- */
const MIC_HELP = '請打開麥克風權限：用 Chrome 開這個網址 → 網址列左邊的圖示 → 權限 → 麥克風 →「允許」。如果還是不行：手機的「設定 → 應用程式 → Chrome → 權限 → 麥克風」也要允許。改完把 App 關掉重開。';
let recog = null, recorder = null, recording = false, recogFailed = false, starting = false, stopped = null, stopWait = null, voiceSeq = 0, slowTimer;
let vmode = 'text', micTarget = null;
const note = m => { const n = $('#interim'); if (n) n.textContent = m; };
const micFail = m => { const n = $('#interim'); if (n) n.innerHTML = `<div class="help">⚠️ ${esc(m)}<br>${esc(MIC_HELP)}</div>`; };
const micErr = e => ({ NotAllowedError: '麥克風權限沒有允許。', NotFoundError: '找不到麥克風。', NotReadableError: '麥克風被別的 App 佔用中（例如通話、錄音）。' }[e.name] || '無法使用麥克風：' + (e.message || e.name));
function micUi() { const b = $('#micBtn'); if (b) { b.disabled = false; b.textContent = recording ? '⏹ 說完了' : '🎤 用說的'; b.classList.toggle('rec', recording); } }
function appendTo(el, t) {
  t = t.trim(); if (!t || !el?.isConnected) return;
  const v = el.value;
  el.value = v + (!v || /[\s，。！？、；：,.!?]$/.test(v) ? '' : '，') + t;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function startRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { recogFailed = true; note('這支手機不支援語音轉文字，請用鍵盤上的麥克風。'); stopVoice(); return; }
  recog = new SR(); recog.lang = 'zh-TW'; recog.continuous = true; recog.interimResults = true;
  recog.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) appendTo(micTarget, t); else interim += t;
    }
    note(interim ? '…' + interim : '');
  };
  recog.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    recogFailed = true;
    const m = { network: '沒有網路，無法轉文字。', 'not-allowed': '沒有麥克風權限。', 'service-not-allowed': '這支手機不允許語音轉文字。',
      'audio-capture': '麥克風被別的 App 佔用中。' }[e.error] || '轉文字發生問題：' + e.error;
    if (/allowed/.test(e.error)) micFail(m); else note(m);
    stopVoice();   // 沒東西在收音了，不要讓人以為還在聽
  };
  recog.onend = () => { if (recording && !recogFailed) { try { recog.start(); } catch (_) { /* 已在跑 */ } } };
  try { recog.start(); } catch (e) { recogFailed = true; note('轉文字無法開始：' + e.message); stopVoice(); }
}
/* 同一時間只准一個麥克風請求：voiceSeq 變了就代表這次請求作廢，晚到的只收掉自己拿到的麥克風 */
async function startVoice(draft) {
  if (starting || recording) return;
  starting = true;
  const my = ++voiceSeq, stale = () => my !== voiceSeq;
  const b = $('#micBtn'); if (b) { b.textContent = '⏳ 正在開啟麥克風…'; b.disabled = true; }
  const give = fn => { starting = false; clearTimeout(slowTimer); micUi(); fn?.(); };
  if (!navigator.mediaDevices?.getUserMedia) { give(() => micFail('這個瀏覽器不能使用麥克風。')); return; }
  try {   // 已經被封鎖的話，Chrome 不會再跳視窗，直接說明
    const st = await navigator.permissions?.query({ name: 'microphone' });
    if (stale()) return;
    if (st?.state === 'denied') { give(() => micFail('麥克風權限被封鎖了，所以不會跳出詢問視窗。')); return; }
  } catch (_) { if (stale()) return; /* 有些瀏覽器不支援查詢，直接試 */ }
  note('正在開啟麥克風…（如果跳出詢問，請按「允許」）');
  slowTimer = setTimeout(() => {
    if (stale()) return;
    voiceSeq++;
    give(() => { const x = $('#micBtn'); if (x) x.textContent = '🎤 再試一次'; micFail('5 秒了麥克風還沒有回應，可能是權限視窗沒有顯示出來。'); });
  }, 5000);
  let s;
  try { s = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { if (!stale()) give(() => micFail(micErr(e))); return; }
  if (stale()) { s.getTracks().forEach(t => t.stop()); return; }
  try {
    if (vmode === 'text') s.getTracks().forEach(t => t.stop());   // 只轉文字：先確認權限，拿到就放掉
    else {
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => window.MediaRecorder?.isTypeSupported?.(t));
      const rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const chunks = [], d = draft;
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        s.getTracks().forEach(t => t.stop());
        try { await addAudio(new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] }), d); } finally { stopped?.(); stopped = null; }
      };
      rec.start(1000);
      recorder = rec;
    }
  } catch (e) { s.getTracks().forEach(t => t.stop()); give(() => micFail(micErr(e))); return; }
  starting = false; clearTimeout(slowTimer);
  recording = true; recogFailed = false; micUi(); note('請說…');
  keepAwake(true);
  if (vmode !== 'audio') startRecog();
}
/* 停止；回傳的 Promise 等錄音檔真的放進草稿才完成（最多 3 秒）。連呼叫兩次拿到同一個 Promise；開啟中就當取消 */
function stopVoice() {
  if (starting) { voiceSeq++; starting = false; clearTimeout(slowTimer); micUi(); note(''); }
  if (!recording) return stopWait || Promise.resolve();
  recording = false;
  try { recog?.stop(); } catch (_) { /* 已停 */ }
  recog = null;
  let wait = Promise.resolve();
  if (recorder && recorder.state !== 'inactive') {
    wait = Promise.race([new Promise(res => { stopped = res; }), new Promise(res => setTimeout(res, 3000))]);
    recorder.stop();
  }
  recorder = null; micUi(); keepAwake(false);
  setTimeout(() => { if (!recording && !recogFailed) note(''); }, 1500);
  stopWait = wait.finally(() => { stopWait = null; });
  return stopWait;
}
async function addAudio(blob, d) {
  if (!blob.size || d.dropped) return;
  const id = uid(), ext = /mp4/.test(blob.type) ? 'm4a' : 'webm';
  try { await dbPut('blobs', { id, blob }); }
  catch (_) { toast('手機空間不夠，這段錄音放不進來'); return; }
  const m = { id, name: `錄音_${localTime().replace(':', '')}_${id.slice(-4)}.${ext}`, mime: blob.type, size: blob.size, kind: 'audio', fileId: '' };
  if (d.savedId) {   // 這篇已經存了：錄音接到那一篇，不要把草稿救回來
    const e = await dbGet('entries', d.savedId);
    if (e) { await dbPut('entries', { ...e, media: [...e.media, m], dirty: true, rev: (e.rev || 0) + 1 }); sync(); }
    return;
  }
  d.media.push(m);
  await keepDraft(d);
  paintAudio(d);
}
let wake = null, wakeCount = 0;
async function keepAwake(on) {
  wakeCount = Math.max(0, wakeCount + (on ? 1 : -1));
  try {
    if (wakeCount && !wake) { wake = await navigator.wakeLock?.request('screen'); if (wake) wake.onrelease = () => { wake = null; }; }
    if (!wakeCount && wake) { await wake.release(); wake = null; }
  } catch (_) { wake = null; }
}

/* ---------------- 照片影片 ---------------- */
function drawThumb(src, w, h) {
  const s = 240 / Math.min(w, h), c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .7);
}
function makeThumb(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const end = v => { URL.revokeObjectURL(url); resolve(v); };
    setTimeout(() => end(null), 5000);
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      v.onloadeddata = () => { v.currentTime = Math.min(.5, (v.duration || 1) / 2); };
      v.onseeked = () => { try { end(drawThumb(v, v.videoWidth, v.videoHeight)); } catch (_) { end(null); } };
      v.onerror = () => end(null);
    } else {
      const i = new Image();
      i.onload = () => { try { end(drawThumb(i, i.naturalWidth, i.naturalHeight)); } catch (_) { end(null); } };
      i.onerror = () => end(null);
      i.src = url;
    }
  });
}
async function addFiles(files, draft) {
  let bad = 0;
  for (const f of files) {
    const kind = f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : '';
    if (!kind) { bad++; continue; }
    const id = uid();
    try { await dbPut('blobs', { id, blob: f }); }
    catch (_) { toast('手機空間不夠，這個檔案放不進來'); continue; }
    draft.media.push({ id, name: f.name || `${id}.${kind === 'video' ? 'mp4' : 'jpg'}`, mime: f.type, size: f.size, kind, thumb: await makeThumb(f), fileId: '' });
  }
  if (bad) toast('只能放照片和影片');
  await keepDraft(draft);
}
function tile(m, canRemove) {
  const inner = m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : ({ video: '🎬', audio: '🎧' }[m.kind] || '🖼️');
  const tag = m.kind === 'video' ? `<span class="tag">🎬 ${mb(m.size || 0)}</span>` : '';
  const rm = canRemove ? `<button class="rm" data-rm="${esc(m.id)}" aria-label="拿掉">✕</button>` : '';
  const link = !canRemove && m.fileId ? `<a href="https://drive.google.com/file/d/${esc(m.fileId)}/view" target="_blank" rel="noopener" style="display:contents">${inner}</a>` : inner;
  return `<div class="tile" data-media="${esc(m.id)}">${link}${tag}${rm}</div>`;
}
const pics = list => list.filter(m => m.kind !== 'audio');
const auds = list => list.filter(m => m.kind === 'audio');
const paintGrid = d => { const g = $('#grid'); if (g) g.innerHTML = pics(d.media).map(m => tile(m, true)).join(''); };
/* 錄音：手機上還有原檔就直接播；傳上雲端後手機不留，點連結用雲端硬碟打開 */
const audioRow = (m, canRemove) => `<div class="aud">${m.fileId
  ? `<a href="https://drive.google.com/file/d/${esc(m.fileId)}/view" target="_blank" rel="noopener">🎧 ${esc(m.name)}</a>`
  : `<audio controls preload="none" data-blob="${esc(m.id)}"></audio>`}${canRemove ? `<button class="link" data-rm="${esc(m.id)}">拿掉</button>` : ''}</div>`;
async function fillAudio(root) {
  for (const a of root.querySelectorAll('audio[data-blob]')) {
    const rec = await dbGet('blobs', a.dataset.blob);
    if (rec) a.src = URL.createObjectURL(rec.blob);
    else a.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: '🎧 錄音在另一台手機，傳上雲端後這裡會有連結' }));
  }
}
function paintAudio(d) { const b = $('#audioBox'); if (b) { b.innerHTML = auds(d.media).map(m => audioRow(m, true)).join(''); fillAudio(b); } }
const chip = (label, attr, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${esc(label)}">${esc(label)}</button>`;
const thanksRow = (t, i) => `<div class="thx"><span>${i + 1}</span><input type="text" data-i="${i}" value="${esc(t)}" aria-label="感恩第 ${i + 1} 件"></div>`;

/* ---------------- 今天 ---------------- */
async function renderToday() {
  const draft = await getDraft();
  const entries = await dbAll('entries');
  const s = stats(entries);
  const wrote = entries.filter(e => e.date === localDate() && !e.deleted).length;
  const cfg = await kvGet('cfg');
  vmode = (await kvGet('voiceMode')) === 'audio' ? 'audio' : 'text';   // 舊的 both 改成只轉文字
  const custom = (await kvGet('customMoods')) || [];
  const moods = [...new Set([...MOODS, ...custom, ...draft.moods])];
  const edit = !!draft.editId;
  const legacy = draft.accept || draft.handle || draft.letgo || draft.anan;   // 舊版日記的欄位，有內容才出現
  view.innerHTML = `
    <div class="top"><span class="cloud c1"></span><span class="cloud c2"></span><span class="cloud c3"></span>
      <div class="brand">阿輝的心情日誌</div>
      <h1>${edit ? '修改 ' : ''}${esc(niceDate(draft.date))}</h1>
      <p>近 14 天寫了 ${s.in14} 天・累積 ${s.total} 天</p>
      ${edit ? '' : `<div id="quoteBox"></div>${daysHtml(entries)}`}
    </div>
    <div class="under">
    ${wrote && !edit ? `<p class="note">今天已經寫了 ${wrote} 篇，想再寫也可以。</p>` : ''}
    ${cfg?.url ? '' : '<p class="help">還沒連雲端，日記先存在手機。到「設定」填網址和密語就會送上去。</p>'}
    <div class="card">
      <span class="cat" id="qcat">${esc(draft.qcat)}</span>${edit ? '' : '<button class="link next" id="nextQ">換一題</button>'}
      <p class="q" id="q">${esc(draft.q)}</p>
    </div>
    <div class="card">
      <h2>📝 我的日記</h2>
      <textarea id="text" data-f="text" placeholder="想到什麼就寫什麼，用說的也可以">${esc(draft.text)}</textarea>
      <div class="modes" id="vmode">${VOICE_MODES.map(([v, l]) => `<button type="button" class="${vmode === v ? 'on' : ''}" data-vmode="${v}">${l}</button>`).join('')}</div>
      <button class="btn primary wide" id="micBtn">🎤 用說的</button>
      <div id="interim"></div>
      <div id="audioBox"></div>
    </div>
    <div class="card">
      <h2>😊 今天的心情</h2>
      <div class="chips" id="moods">${moods.map(m => chip(m, 'data-mood', draft.moods.includes(m))).join('')}</div>
      <h2 class="gap">🪷 四它</h2>
      <div class="chips" id="four">${FOUR_ITS.map(f => chip(f, 'data-four', draft.fourIt === f)).join('')}</div>
    </div>
    <div class="card">
      <h2>👧 與安安相處的心情</h2>
      <textarea class="short" data-f="ananMood" placeholder="今天和安安相處的感受、教養的想法">${esc(draft.ananMood)}</textarea>
    </div>
    <div class="card">
      <h2>🙏 今天感恩的三件事</h2>
      <div id="thanks">${draft.thanks.map(thanksRow).join('')}</div>
      <button class="link" id="moreThanks">＋再加一件</button>
    </div>
    ${legacy ? `<div class="card"><h2>舊版的內容</h2>
      ${draft.accept ? `<label class="field"><span>接受它</span><textarea class="short" data-f="accept">${esc(draft.accept)}</textarea></label>` : ''}
      ${draft.handle ? `<label class="field"><span>處理它</span><textarea class="short" data-f="handle">${esc(draft.handle)}</textarea></label>` : ''}
      ${draft.letgo ? `<label class="field"><span>放下它</span><textarea class="short" data-f="letgo">${esc(draft.letgo)}</textarea></label>` : ''}
      ${draft.anan ? `<label class="field"><span>安安今天的一句話</span><textarea class="short" data-f="anan">${esc(draft.anan)}</textarea></label>` : ''}
    </div>` : ''}
    <div class="card">
      <h2>📷 照片影片</h2>
      <div class="grid" id="grid">${pics(draft.media).map(m => tile(m, true)).join('')}</div>
      <label class="btn add">＋ 加照片影片<input id="pick" type="file" accept="image/*,video/*" multiple hidden></label>
      <label class="check"><input type="checkbox" id="priv" ${draft.private ? 'checked' : ''}>這篇不給小輝看</label>
    </div>
    <button class="btn primary wide save" id="save">${edit ? '存好修改' : '存起來'}</button>
    ${edit ? '<button class="btn wide" id="cancel">不改了</button>' : ''}
    </div>`;
  paintQuote();
  paintAudio(draft);

  let timer;
  const keep = () => { clearTimeout(timer); timer = setTimeout(() => keepDraft(draft), 300); };
  micTarget = $('#text');
  view.oninput = e => {
    const f = e.target.dataset?.f;
    if (f) { draft[f] = e.target.value; keep(); }
    if (e.target.dataset?.i !== undefined) { draft.thanks[Number(e.target.dataset.i)] = e.target.value; keep(); }
    if (e.target.id === 'priv') { draft.private = e.target.checked; keep(); }
  };
  view.onchange = async e => {
    if (e.target.id === 'priv') { draft.private = e.target.checked; keep(); }
    if (e.target.id === 'pick') {
      const n = e.target.files.length; if (!n) return;
      toast(`正在放進 ${n} 個檔案…`);
      await addFiles([...e.target.files], draft);
      e.target.value = '';
      paintGrid(draft);
    }
  };
  view.onclick = async e => {
    if (e.target.id === 'micBtn') { recording ? stopVoice() : startVoice(draft); return; }
    if (e.target.id === 'nextQuote') { quoteI = (quoteI + 1) % 3; paintQuote(); return; }
    if (e.target.id === 'nextQ') {
      draft.shift++;
      const n = questionFor(draft.date, draft.shift);
      draft.q = n.q; draft.qcat = n.cat;
      $('#q').textContent = n.q; const c = $('#qcat'); if (c) c.textContent = n.cat;
      keep(); return;
    }
    const vm = e.target.closest?.('[data-vmode]');
    if (vm) {
      if (recording || starting) { toast('先按「說完了」再換模式'); return; }
      vmode = vm.dataset.vmode; kvSet('voiceMode', vmode);
      document.querySelectorAll('#vmode button').forEach(b => b.classList.toggle('on', b.dataset.vmode === vmode));
      return;
    }
    const mood = e.target.dataset?.mood;
    if (mood) { draft.moods = draft.moods.includes(mood) ? draft.moods.filter(x => x !== mood) : [...draft.moods, mood]; e.target.classList.toggle('on'); keep(); return; }
    const four = e.target.dataset?.four;
    if (four) {
      draft.fourIt = draft.fourIt === four ? '' : four;
      document.querySelectorAll('#four .chip').forEach(b => b.classList.toggle('on', b.dataset.four === draft.fourIt));
      keep(); return;
    }
    if (e.target.id === 'moreThanks') {
      draft.thanks.push('');
      $('#thanks').insertAdjacentHTML('beforeend', thanksRow('', draft.thanks.length - 1));
      $('#thanks .thx:last-child input').focus(); keep(); return;
    }
    const rm = e.target.dataset?.rm;
    if (rm) {
      draft.media = draft.media.filter(m => m.id !== rm);
      if (!draft.editId) await dbDel('blobs', rm);
      await keepDraft(draft);
      paintGrid(draft); paintAudio(draft);
      return;
    }
    if (e.target.id === 'cancel') { await stopVoice(); clearTimeout(timer); draft.dropped = true; await dropDraft(draft); location.hash = '#e/' + draft.editId; return; }
    if (e.target.id === 'save') { clearTimeout(timer); await saveDraft(draft); }
  };
}
let saving = false;
async function saveDraft(d) {
  if (saving) return;   // 連按兩下只存一篇
  saving = true;
  const b = $('#save'); if (b) b.disabled = true;
  try { await stopVoice(); await doSave(d); }   // 等錄音檔收好才存
  finally { saving = false; if (b) b.disabled = false; }
}
async function doSave(d) {
  const thanks = d.thanks.map(t => t.trim()).filter(Boolean);   // 空的不存
  if (![d.text, d.ananMood, d.accept, d.handle, d.letgo, d.anan].some(x => x.trim()) && !thanks.length && !d.moods.length && !d.fourIt && !d.media.length) { toast('寫一點或選個心情再存'); return; }
  const now = new Date();
  const old = d.editId ? await dbGet('entries', d.editId) : null;
  for (const m of d.media) { const o = old?.media.find(x => x.id === m.id); if (o?.fileId) m.fileId = o.fileId; }
  const e = { id: d.editId || uid(), date: d.date, time: old?.time || localTime(now), at: old?.at || now.toISOString(), q: d.q, qcat: d.qcat,
    text: d.text, moods: d.moods, fourIt: d.fourIt, ananMood: d.ananMood, thanks, accept: d.accept, handle: d.handle, letgo: d.letgo, anan: d.anan,
    private: d.private, media: d.media, dirty: true, rev: (old?.rev || 0) + 1 };
  await dbPut('entries', e);
  d.savedId = e.id;
  await dropDraft(d);
  toast('寫好了 🙏');
  location.hash = '#list';
  sync();
}

/* ---------------- 時間軸與單篇 ---------------- */
function preview(e) {
  return [e.text, e.ananMood, e.accept, e.handle, e.letgo].filter(Boolean).join('\n') || e.anan || (e.thanks || []).join('、') || (e.moods || []).join('、') || e.fourIt
    || (auds(e.media).length && !pics(e.media).length ? '（錄音）' : '（照片影片）');
}
const tags = e => [...(e.moods || []).map(m => `<span class="tag2 ${moodClass([m])}">${esc(m)}</span>`), e.fourIt ? `<span class="tag2">🪷 ${esc(e.fourIt)}</span>` : ''].join('');
async function renderList() {
  const list = (await dbAll('entries')).filter(e => !e.deleted).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  if (!list.length) { view.innerHTML = '<div class="head"><h1>時間軸</h1></div><p class="muted">還沒有日記。到「今天」講一段就有了。</p>'; return; }
  let html = '<div class="head"><h1>時間軸</h1></div>', day = '';
  for (const e of list) {
    if (e.date !== day) { day = e.date; html += `<div class="day">${esc(niceDate(day))}<span class="muted small">　${esc(day.slice(0, 4))}</span></div>`; }
    html += `<a class="card item" href="#e/${esc(e.id)}"><div class="meta">${esc(e.time)}${e.private ? '・🔒 不給小輝看' : ''}${e.dirty ? '・⏳ 還沒送上雲端' : ''}</div>
      <div class="pv">${esc(preview(e))}</div>${tags(e) ? `<div class="tags">${tags(e)}</div>` : ''}${e.media.length ? `<div class="grid">${e.media.slice(0, 4).map(m => tile(m, false).replace(/<a [^>]*>|<\/a>/g, '')).join('')}</div>` : ''}</a>`;
  }
  view.innerHTML = html;
  view.onclick = view.oninput = view.onchange = null;
  loadThumbs(list);
}
let thumbBusy = false;
async function loadThumbs(list) {
  const cfg = await kvGet('cfg');
  if (thumbBusy || !cfg?.url || !navigator.onLine) return;
  thumbBusy = true;
  try {
    for (const e of list) for (const m of e.media) {
      if (m.thumb || !m.fileId || m.noThumb || m.kind === 'audio') continue;
      const r = await api('thumb', { fileId: m.fileId });
      await patchMedia(e.id, m.id, r.data ? { thumb: r.data } : { noThumb: true });
      m.thumb = r.data;
      const box = $(`[data-media="${m.id}"]`);
      if (box && r.data) box.innerHTML = `<img src="${esc(r.data)}" alt="">`;
    }
  } catch (_) { /* 下次打開再抓 */ }
  thumbBusy = false;
}
async function renderEntry(id) {
  const e = await dbGet('entries', id);
  if (!e || e.deleted) { location.hash = '#list'; return; }
  const sec = (t, v) => v ? `<h2>${esc(t)}</h2><div class="body">${esc(v)}</div>` : '';
  view.innerHTML = `<div class="head"><h1>${esc(niceDate(e.date))}</h1><span class="muted small">${esc(e.time)}${e.private ? '・🔒 不給小輝看' : ''}${e.dirty ? '・⏳ 還沒送上雲端' : ''}</span></div>
    <div class="card">${e.q ? `<p class="muted small" style="margin-top:0">${e.qcat ? esc(e.qcat) + '・' : ''}${esc(e.q)}</p>` : ''}
    ${sec('我的日記', e.text)}${tags(e) ? `<div class="tags">${tags(e)}</div>` : ''}${sec('與安安相處的心情', e.ananMood)}
    ${e.thanks?.length ? `<h2>今天感恩的事</h2><ol class="body">${e.thanks.map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}
    ${sec('接受它', e.accept)}${sec('處理它', e.handle)}${sec('放下它', e.letgo)}${sec('安安今天的一句話', e.anan)}
    ${auds(e.media).map(m => audioRow(m, false)).join('')}
    ${pics(e.media).length ? `<div class="grid">${pics(e.media).map(m => tile(m, false)).join('')}</div><p class="muted small">點照片影片會用雲端硬碟打開原檔</p>` : ''}</div>
    <div class="row"><button class="btn" id="edit">修改</button><button class="btn" id="del">刪除</button></div>`;
  fillAudio(view);
  view.oninput = view.onchange = null;
  view.onclick = async ev => {
    if (ev.target.id === 'edit') {
      await kvSet('editDraft', { editId: e.id, date: e.date, shift: 0, q: e.q, qcat: e.qcat || '', text: e.text || '', moods: e.moods || [], fourIt: e.fourIt || '', ananMood: e.ananMood || '', thanks: e.thanks || [],
        accept: e.accept || '', handle: e.handle || '', letgo: e.letgo || '', anan: e.anan || '', private: e.private, media: e.media });
      location.hash = '#today';
    }
    if (ev.target.id === 'del' && confirm('刪除這篇？雲端的檔案會移到「已刪除」資料夾，不會真的消失。')) {
      const cur = await dbGet('entries', e.id);
      await dbPut('entries', { ...cur, deleted: true, dirty: true, rev: (cur.rev || 0) + 1 });
      for (const m of cur.media) await dbDel('blobs', m.id);
      location.hash = '#list'; sync();
    }
  };
  loadThumbs([e]);
}

/* ---------------- 設定 ---------------- */
async function renderSettings() {
  const cfg = (await kvGet('cfg')) || {};
  const last = await kvGet('lastUpload');
  const lastSync = await kvGet('lastSync');
  const list = await dbAll('entries');
  const waiting = list.filter(e => e.dirty).length;
  const est = await navigator.storage?.estimate?.();
  const custom = (await kvGet('customMoods')) || [];
  view.innerHTML = `<div class="head"><h1>設定</h1><span class="muted small">v${APP_VERSION}</span></div>
    <div class="card"><h2 style="margin-top:0">自訂心情</h2>
      <p class="muted small">加進「今天的心情」，方塊算普通。</p>
      <div class="chips" id="cm">${custom.map(m => `<button type="button" class="chip on" data-cm="${esc(m)}">${esc(m)} ✕</button>`).join('')}</div>
      <div class="addrow"><input type="text" id="newMood" maxlength="8" placeholder="例如：感動" aria-label="新的心情"><button class="btn" id="addMood">加入</button></div></div>
    <div class="card"><h2 style="margin-top:0">雲端同步</h2>
      <label class="field"><span>Apps Script 網址</span><input type="url" id="url" value="${esc(cfg.url || '')}" autocomplete="off"></label>
      <label class="field"><span>密語</span><input type="password" id="pass" value="${esc(cfg.pass || '')}" autocomplete="off"></label>
      <button class="btn primary wide" id="test">儲存並測試</button>
      <p id="res" class="small"></p></div>
    <div class="card"><h2 style="margin-top:0">狀態</h2>
      <p class="small">手機上有 ${list.filter(e => !e.deleted).length} 篇，${waiting} 篇等著送上雲端。</p>
      <p class="small">上次同步：${esc(lastSync?.at ? new Date(lastSync.at).toLocaleString('zh-TW') : '還沒有')}${lastSync?.error ? '<br>⚠️ ' + esc(lastSync.error) : ''}</p>
      <p class="small">上次上傳：${last ? `${esc(last.name)}，${mb(last.size)}，${last.mode === 'direct' ? '手機直傳' : '經 Apps Script 切塊'}，${last.sec} 秒` : '還沒有'}</p>
      <p class="small">每日小語：${quoteList.length ? `${quoteList.length} 句` : '還沒讀到（要先連雲端）'}</p>
      ${est ? `<p class="small">手機空間：已用 ${mb(est.usage)}</p>` : ''}
      <button class="btn wide" id="now">現在同步</button>
      <button class="btn wide" id="restore">從雲端還原</button>
      <p class="muted small">換手機時：填好網址和密語，按「從雲端還原」就會抓回全部文字。原檔留在雲端，不會下載到手機。</p></div>`;
  view.oninput = view.onchange = null;
  view.onclick = async e => {
    const saveMoods = async list => { await kvSet('customMoods', list); await renderSettings(); };
    if (e.target.id === 'addMood') {
      const m = $('#newMood').value.trim();
      if (!m) return;
      if (MOODS.includes(m) || custom.includes(m)) { toast('已經有這個心情了'); return; }
      await saveMoods([...custom, m]); return;
    }
    if (e.target.dataset?.cm) { await saveMoods(custom.filter(x => x !== e.target.dataset.cm)); return; }
    if (e.target.id === 'test') {
      const c = { url: $('#url').value.trim(), pass: $('#pass').value };
      await kvSet('cfg', c); gsOk = false;
      $('#res').textContent = '測試中…';
      try {
        const r = await api('ping');
        $('#res').textContent = r.version === NEED_GS ? '✅ ' + r.message : `⚠️ ${r.message}，但雲端程式是 ${r.version || '舊版'}，要更新到 ${NEED_GS} 才會同步，日記先留在手機`;
        sync(); await loadQuotes(true);
      }
      catch (err) { $('#res').textContent = '⚠️ ' + err.message; }
    }
    if (e.target.id === 'now') { toast('同步中…'); await sync(); route(); }
    if (e.target.id === 'restore') { await kvDel('since'); toast('還原中…'); await sync(); route(); }
  };
}

/* ---------------- 同步 ---------------- */
async function api(action, data = {}, timeoutMs = 120000) {
  const cfg = await kvGet('cfg');
  if (!cfg?.url) throw new Error('還沒填網址');
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pass: cfg.pass, action, ...data }), signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || '雲端回了錯誤');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('等太久沒有回應');
    if (e instanceof TypeError) throw new Error('連不上雲端');
    throw e;
  } finally { clearTimeout(t); }
}
async function patchMedia(entryId, mediaId, patch) {
  const e = await dbGet('entries', entryId); if (!e) return;
  const m = e.media.find(x => x.id === mediaId); if (!m) return;
  Object.assign(m, patch); await dbPut('entries', e);
}
const serverCopy = e => ({ ...e, media: e.media.map(({ thumb, noThumb, ...m }) => m) });
function bar(msg) { const b = $('#bar'); b.hidden = !msg; b.textContent = msg || ''; }
const toBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

/** 手機直傳一塊；回傳 {done,fileId,offset}。瀏覽器不准（CORS）或斷線時丟 TypeError。 */
async function putDirect(url, blob, start, end, total) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 180000);   // 卡死時不要讓同步永遠停住
  let r;
  try { r = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }, body: blob.slice(start, end), signal: ctl.signal }); }
  catch (e) { if (e.name === 'AbortError') throw new Error('上傳等太久沒有回應'); throw e; }
  finally { clearTimeout(t); }
  if (r.status === 200 || r.status === 201) return { done: true, fileId: (await r.json()).id };
  if (r.status === 308) {
    const m = /bytes=0-(\d+)/.exec(r.headers.get('Range') || '');
    return { done: false, offset: m ? Number(m[1]) + 1 : end };
  }
  if (r.status === 404 || r.status === 410) return { expired: true };
  throw new Error('上傳失敗：HTTP ' + r.status);
}
async function putProxy(url, blob, start, end, total) {
  return api('uploadChunk', { url, start, end, total, data: await toBase64(blob.slice(start, end)) }, 180000);
}
async function uploadMedia(e, m, label) {
  const rec = await dbGet('blobs', m.id);
  if (!rec) return;   // 原檔在另一台，由那台上傳
  const blob = rec.blob, total = blob.size, key = 'up_' + m.id, began = Date.now();
  let st = (await kvGet(key)) || {};
  const start = async () => {
    const r = await api('uploadStart', { date: e.date, private: e.private, name: m.name, mime: m.mime || blob.type, size: total });
    st = { url: r.url, offset: 0, mode: st.mode || (await kvGet('uploadMode')) || 'direct' };
    await kvSet(key, st);
  };
  const finish = async fileId => {
    await patchMedia(e.id, m.id, { fileId });
    await dbDel('blobs', m.id); await kvDel(key);
    await kvSet('lastUpload', { name: m.name, size: total, mode: st.mode, sec: Math.round((Date.now() - began) / 1000) });
  };
  if (st.url) {   // 上次傳到一半：問雲端傳到哪裡
    const q = await api('uploadQuery', { url: st.url, total });
    if (q.done) return finish(q.fileId);
    if (q.expired) await start(); else st.offset = q.offset;
  } else await start();

  while (st.offset < total) {
    const end = Math.min(st.offset + CHUNK, total);
    bar(`${label}：${Math.floor(st.offset / total * 100)}%（${mb(total)}）`);
    let r;
    if (st.mode === 'direct') {
      try { r = await putDirect(st.url, blob, st.offset, end, total); await kvSet('directOk', true); }
      catch (err) {
        if (!(err instanceof TypeError) || !navigator.onLine || await kvGet('directOk')) throw err;   // 直傳成功過：只是斷線，下次接著傳
        st.mode = 'proxy'; await kvSet('uploadMode', 'proxy');   // 從沒成功過：瀏覽器不准直傳，之後都切塊經 Apps Script
        const q = await api('uploadQuery', { url: st.url, total });
        if (q.done) return finish(q.fileId);
        if (q.expired) { await start(); continue; }
        st.offset = q.offset; await kvSet(key, st);
        continue;
      }
    } else r = await putProxy(st.url, blob, st.offset, end, total);
    if (r.done) return finish(r.fileId);
    if (r.expired) { await start(); continue; }
    st.offset = r.offset; await kvSet(key, st);
  }
  const q = await api('uploadQuery', { url: st.url, total });   // 剛好傳完但沒收到結果
  if (q.done) return finish(q.fileId);
  throw new Error('上傳沒有完成，下次再試');
}

let syncing = false, syncAgain = false, retryTimer, gsOk = false;
/* Code.gs 只存它認得的欄位：不是 v3 就整個不同步，日記留在手機，新欄位才不會被蓋掉 */
async function checkCloud() {
  if (gsOk) return;
  const r = await api('ping');
  if (r.version !== NEED_GS) throw new Error(`雲端程式是 ${r.version || '舊版'}，要更新到 ${NEED_GS}，日記先留在手機`);
  gsOk = true;
}
async function sync() {
  if (syncing) { syncAgain = true; return; }
  const cfg = await kvGet('cfg');
  if (!cfg?.url || !navigator.onLine) return;
  syncing = true; keepAwake(true);
  const errs = [];
  const attempt = async fn => { try { await fn(); } catch (e) { errs.push(e instanceof TypeError ? '連不上雲端' : e.message); } };
  const clean = async (id, rev) => { const c = await dbGet('entries', id); if (c && c.rev === rev) await dbPut('entries', { ...c, dirty: false }); };
  const pendingOf = async e => { const r = []; for (const m of e.media) if (!m.fileId && await dbGet('blobs', m.id)) r.push(m); return r; };
  await attempt(checkCloud);
  if (gsOk) {
  // 第一段：全部文字先上去，一篇失敗不影響其他篇
  for (const snap of (await dbAll('entries')).filter(x => x.dirty)) await attempt(async () => {
    if (snap.deleted) { await api('delete', { id: snap.id }); await dbDel('entries', snap.id); return; }
    await api('save', { entry: serverCopy(snap) });
    if (!(await pendingOf(snap)).length) await clean(snap.id, snap.rev);
  });
  // 第二段：照片影片，新的先傳
  const waiting = (await dbAll('entries')).filter(x => x.dirty && !x.deleted).sort((x, y) => String(y.at).localeCompare(String(x.at)));
  for (const snap of waiting) await attempt(async () => {
    const todo = await pendingOf(snap);
    for (let i = 0; i < todo.length; i++) await uploadMedia(snap, todo[i], `上傳照片影片 ${i + 1}/${todo.length}`);
    const cur = await dbGet('entries', snap.id);
    if (!cur) return;
    await api('save', { entry: serverCopy(cur) });
    await clean(cur.id, snap.rev);
  });
  // 第三段：抓另一台的新內容
  await attempt(async () => {
    let since = (await kvGet('since')) || '', more = true;
    while (more) {
      const r = await api('pull', { since });
      for (const s of r.entries) {
        const local = await dbGet('entries', s.id);
        if (local?.dirty) continue;
        if (s.deleted) { await dbDel('entries', s.id); continue; }
        const thumbs = Object.fromEntries((local?.media || []).map(m => [m.id, m.thumb]));
        await dbPut('entries', { ...local, ...s, media: s.media.map(m => ({ ...m, thumb: thumbs[m.id] })), dirty: false, rev: local?.rev || 0 });   // 雲端沒有的欄位留手機的
      }
      since = r.since; more = r.more;
      await kvSet('since', since);
    }
  });
  await loadQuotes();
  }
  const error = errs[0] || '';
  await kvSet('lastSync', { at: Date.now(), error });
  syncing = false; keepAwake(false);
  bar(error ? `⚠️ ${error}，等一下會再試` : '');
  if (error) { clearTimeout(retryTimer); retryTimer = setTimeout(sync, 60000); }
  const here = location.hash || '#today';
  if (!error && !here.startsWith('#today') && !here.startsWith('#settings')) route();
  if (syncAgain) { syncAgain = false; sync(); }
}

/* ---------------- 相簿分享進來 ---------------- */
async function takeShared() {
  const items = await dbAll('shared');
  if (!items.length) return;
  const draft = fill((await kvGet('draft')) || {});
  const files = items.filter(i => i.file).map(i => i.file);
  const text = items.filter(i => i.text).map(i => i.text).join('\n');
  if (text) draft.text = draft.text ? draft.text + '\n' + text : text;
  await addFiles(files, draft);
  await dbClear('shared');
  toast(`收到 ${files.length} 個檔案`);
}

/* ---------------- 頁面切換 ---------------- */
async function route() {
  const h = location.hash || '#today';
  await stopVoice();   // 換頁前收好錄音，才不會掉
  const tab = h.startsWith('#e/') ? 'list' : h.slice(1);
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  if (h.startsWith('#e/')) await renderEntry(decodeURIComponent(h.slice(3)));
  else if (h === '#list') await renderList();
  else if (h === '#settings') await renderSettings();
  else await renderToday();
  scrollTo(0, 0);
}
addEventListener('hashchange', route);
addEventListener('online', sync);
addEventListener('pagehide', () => { stopVoice(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopVoice(); /* 來電、切 App 被收掉前先把錄音存進草稿 */ else { if (wakeCount && !wake) keepAwake(true).then(() => { wakeCount--; }); sync(); } });
(async () => {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  view.addEventListener('focusin', e => { if (e.target.matches?.('textarea, #thanks input')) micTarget = e.target; });   // 語音進最後點的框
  setQuotes(await kvGet('quotes'));
  if (location.search.includes('shared')) { await takeShared(); history.replaceState(null, '', './#today'); }
  await route();
  sync();
})();
