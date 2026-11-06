/* 小輝日記 v0.1.0：今天（問題、語音、照片影片）、時間軸、設定。資料先存手機，有網路再送雲端。 */
const APP_VERSION = '0.1.0';
const CHUNK = 8 * 1024 * 1024;   // 一塊 8 MiB（要是 256 KiB 的倍數）
const MAIN_Q = '今天最想面對的一件事？';
const BANK = [
  '今天哪一刻讓你停了一下？', '今天有什麼事，你想對自己說辛苦了？', '今天誰讓你心裡一暖？', '今天有什麼事卡在心裡？',
  '今天你做對了哪一件小事？', '今天最累的是哪一段？', '今天有什麼想謝謝的人或事？', '今天你學到了什麼？',
  '今天哪件事可以放下了？', '如果今天重來，你會改哪裡？', '今天你陪家人的時候，記得哪一幕？', '明天你想怎麼對待自己？'
];
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
  const n = dayNum(date);
  if (!shift && n % 2 === 0) return MAIN_Q;   // 隔天回到主問題
  return BANK[(Math.floor(n / 2) + shift) % BANK.length];
}

/* ---------------- 天數 ---------------- */
function stats(entries) {
  const days = new Set(entries.filter(e => !e.deleted).map(e => e.date));
  const today = dayNum(localDate());
  const in14 = [...days].filter(d => today - dayNum(d) < 14 && today >= dayNum(d)).length;
  return { total: days.size, in14 };
}

/* ---------------- 草稿 ---------------- */
function newDraft() {
  const date = localDate();
  return { date, shift: 0, q: questionFor(date), text: '', accept: '', handle: '', letgo: '', anan: '', private: false, media: [] };
}
async function getDraft() {
  let d = await kvGet('draft');
  if (!d) return newDraft();
  // 昨天沒寫完的草稿，內容留著，日期跟著今天；修改舊日記的不動
  if (!d.editId && d.date !== localDate()) { d.date = localDate(); if (!d.text) { d.shift = 0; d.q = questionFor(d.date); } }
  return d;
}

/* ---------------- 語音 ---------------- */
const MIC_HELP = '請打開麥克風權限：用 Chrome 開這個網址 → 網址列左邊的圖示 → 權限 → 麥克風 →「允許」。改完把 App 關掉重開。';
let recog = null, listening = false, micTarget = null;
function stopMic() { listening = false; try { recog?.stop(); } catch (_) {} recog = null; const b = $('#micBtn'); if (b) { b.textContent = '🎤 用說的'; b.classList.remove('primary'); } keepAwake(false); }
function appendTo(el, t) {
  t = t.trim(); if (!t || !el) return;
  const v = el.value;
  el.value = v + (!v || /[\s，。！？、；：,.!?]$/.test(v) ? '' : '，') + t;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
function startMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const note = m => { const n = $('#interim'); if (n) n.textContent = m; };
  if (!SR) { note('這個瀏覽器不支援語音轉文字，請用鍵盤上的麥克風。'); return; }
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
    stopMic();
    const n = $('#interim');
    if (n) n.innerHTML = `<div class="help">⚠️ ${esc({ network: '沒有網路，無法轉文字，可以先用打的。', 'not-allowed': '沒有麥克風權限。', 'service-not-allowed': '這支手機不允許語音轉文字。' }[e.error] || '轉文字發生問題：' + e.error)}${/allowed/.test(e.error) ? '<br>' + esc(MIC_HELP) : ''}</div>`;
  };
  recog.onend = () => { if (listening) { try { recog.start(); } catch (_) {} } };
  try { recog.start(); listening = true; } catch (e) { note('轉文字無法開始：' + e.message); return; }
  const b = $('#micBtn'); b.textContent = '⏹ 說完了'; b.classList.add('primary');
  note('請說…'); keepAwake(true);
}
let wake = null, wakeCount = 0;
async function keepAwake(on) {
  wakeCount = Math.max(0, wakeCount + (on ? 1 : -1));
  try {
    if (wakeCount && !wake) wake = await navigator.wakeLock?.request('screen');
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
  await kvSet('draft', draft);
}
function tile(m, canRemove) {
  const inner = m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : (m.kind === 'video' ? '🎬' : '🖼️');
  const tag = m.kind === 'video' ? `<span class="tag">🎬 ${mb(m.size || 0)}</span>` : '';
  const rm = canRemove ? `<button class="rm" data-rm="${esc(m.id)}" aria-label="拿掉">✕</button>` : '';
  const link = !canRemove && m.fileId ? `<a href="https://drive.google.com/file/d/${esc(m.fileId)}/view" target="_blank" rel="noopener" style="display:contents">${inner}</a>` : inner;
  return `<div class="tile" data-media="${esc(m.id)}">${link}${tag}${rm}</div>`;
}

/* ---------------- 今天 ---------------- */
async function renderToday() {
  const draft = await getDraft();
  const entries = await dbAll('entries');
  const s = stats(entries);
  const wrote = entries.filter(e => e.date === localDate() && !e.deleted).length;
  const cfg = await kvGet('cfg');
  const more = draft.accept || draft.handle || draft.letgo;
  view.innerHTML = `
    <div class="head"><h1>${draft.editId ? '修改 ' + esc(niceDate(draft.date)) : esc(niceDate(draft.date))}</h1>
      <span class="muted small">近 14 天寫了 ${s.in14} 天・累積 ${s.total} 天</span></div>
    ${wrote && !draft.editId ? `<p class="muted small">今天已經寫了 ${wrote} 篇，想再寫也可以。</p>` : ''}
    ${cfg?.url ? '' : '<p class="help">還沒連雲端，日記先存在手機。到「設定」填網址和密語就會送上去。</p>'}
    <div class="card">
      <p class="q" id="q">${esc(draft.q)}</p>
      ${draft.editId ? '' : '<button class="link" id="nextQ">換一題</button>'}
      <label class="field"><textarea id="text" data-f="text" placeholder="用說的或打字，講一段就算寫完">${esc(draft.text)}</textarea></label>
      <button class="btn wide" id="micBtn">🎤 用說的</button>
      <div id="interim"></div>
      <details ${more ? 'open' : ''}><summary>想多講</summary>
        <label class="field"><span>哪一部分你已經接受了？</span><textarea class="short" data-f="accept">${esc(draft.accept)}</textarea></label>
        <label class="field"><span>你打算怎麼處理？下一步是什麼？</span><textarea class="short" data-f="handle">${esc(draft.handle)}</textarea></label>
        <label class="field"><span>什麼可以放下了？</span><textarea class="short" data-f="letgo">${esc(draft.letgo)}</textarea></label>
      </details>
    </div>
    <div class="card">
      <label class="field" style="margin-top:0"><span>安安今天的一句話</span><textarea class="short" data-f="anan">${esc(draft.anan)}</textarea></label>
    </div>
    <div class="card">
      <label class="btn" style="width:100%">📷 加照片影片<input id="pick" type="file" accept="image/*,video/*" multiple hidden></label>
      <div class="grid" id="grid">${draft.media.map(m => tile(m, true)).join('')}</div>
      <label class="check"><input type="checkbox" id="priv" ${draft.private ? 'checked' : ''}>這篇不給小輝看</label>
    </div>
    <button class="btn primary wide" id="save">${draft.editId ? '存好修改' : '存起來'}</button>
    ${draft.editId ? '<button class="btn wide" id="cancel">不改了</button>' : ''}`;

  let timer;
  const keep = () => { clearTimeout(timer); timer = setTimeout(() => kvSet('draft', draft), 300); };
  micTarget = $('#text');
  view.oninput = e => {
    const f = e.target.dataset?.f;
    if (f) { draft[f] = e.target.value; keep(); }
    if (e.target.id === 'priv') { draft.private = e.target.checked; keep(); }
  };
  view.onchange = async e => {
    if (e.target.id === 'priv') { draft.private = e.target.checked; keep(); }
    if (e.target.id === 'pick') {
      const n = e.target.files.length; if (!n) return;
      toast(`正在放進 ${n} 個檔案…`);
      await addFiles([...e.target.files], draft);
      e.target.value = '';
      $('#grid').innerHTML = draft.media.map(m => tile(m, true)).join('');
    }
  };
  view.addEventListener('focusin', e => { if (e.target.matches?.('textarea')) micTarget = e.target; });
  view.onclick = async e => {
    if (e.target.id === 'micBtn') { listening ? stopMic() : startMic(); return; }
    if (e.target.id === 'nextQ') { draft.shift++; draft.q = questionFor(draft.date, draft.shift); $('#q').textContent = draft.q; keep(); return; }
    const rm = e.target.dataset?.rm;
    if (rm) {
      draft.media = draft.media.filter(m => m.id !== rm);
      if (!draft.editId) await dbDel('blobs', rm);
      await kvSet('draft', draft);
      $('#grid').innerHTML = draft.media.map(m => tile(m, true)).join('');
      return;
    }
    if (e.target.id === 'cancel') { await kvDel('draft'); location.hash = '#e/' + draft.editId; return; }
    if (e.target.id === 'save') { stopMic(); clearTimeout(timer); await saveDraft(draft); }
  };
}
async function saveDraft(d) {
  if (![d.text, d.accept, d.handle, d.letgo, d.anan].some(x => x.trim()) && !d.media.length) { toast('講一句話再存'); return; }
  const now = new Date();
  const old = d.editId ? await dbGet('entries', d.editId) : null;
  for (const m of d.media) { const o = old?.media.find(x => x.id === m.id); if (o?.fileId) m.fileId = o.fileId; }
  const e = { id: d.editId || uid(), date: d.date, time: old?.time || localTime(now), at: old?.at || now.toISOString(), q: d.q,
    text: d.text, accept: d.accept, handle: d.handle, letgo: d.letgo, anan: d.anan, private: d.private, media: d.media,
    dirty: true, rev: (old?.rev || 0) + 1 };
  await dbPut('entries', e);
  await kvDel('draft');
  toast('寫好了 🙏');
  location.hash = '#list';
  sync();
}

/* ---------------- 時間軸與單篇 ---------------- */
function preview(e) { return [e.text, e.accept, e.handle, e.letgo].filter(Boolean).join('\n') || e.anan || '（照片影片）'; }
async function renderList() {
  const list = (await dbAll('entries')).filter(e => !e.deleted).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  if (!list.length) { view.innerHTML = '<div class="head"><h1>時間軸</h1></div><p class="muted">還沒有日記。到「今天」講一段就有了。</p>'; return; }
  let html = '<div class="head"><h1>時間軸</h1></div>', day = '';
  for (const e of list) {
    if (e.date !== day) { day = e.date; html += `<div class="day">${esc(niceDate(day))}<span class="muted small">　${esc(day.slice(0, 4))}</span></div>`; }
    html += `<a class="card item" href="#e/${esc(e.id)}"><div class="meta">${esc(e.time)}${e.private ? '・🔒 不給小輝看' : ''}${e.dirty ? '・⏳ 還沒送上雲端' : ''}</div>
      <div class="pv">${esc(preview(e))}</div>${e.media.length ? `<div class="grid">${e.media.slice(0, 4).map(m => tile(m, false).replace(/<a [^>]*>|<\/a>/g, '')).join('')}</div>` : ''}</a>`;
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
      if (m.thumb || !m.fileId || m.noThumb) continue;
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
    <div class="card">${sec(e.q, e.text)}${sec('接受它', e.accept)}${sec('處理它', e.handle)}${sec('放下它', e.letgo)}${sec('安安今天的一句話', e.anan)}
    ${e.media.length ? `<div class="grid">${e.media.map(m => tile(m, false)).join('')}</div><p class="muted small">點照片影片會用雲端硬碟打開原檔</p>` : ''}</div>
    <div class="row"><button class="btn" id="edit">修改</button><button class="btn" id="del">刪除</button></div>`;
  view.oninput = view.onchange = null;
  view.onclick = async ev => {
    if (ev.target.id === 'edit') {
      await kvSet('draft', { editId: e.id, date: e.date, shift: 0, q: e.q, text: e.text, accept: e.accept, handle: e.handle, letgo: e.letgo, anan: e.anan, private: e.private, media: e.media });
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
  view.innerHTML = `<div class="head"><h1>設定</h1><span class="muted small">v${APP_VERSION}</span></div>
    <div class="card"><h2 style="margin-top:0">雲端同步</h2>
      <label class="field"><span>Apps Script 網址</span><input type="url" id="url" value="${esc(cfg.url || '')}" autocomplete="off"></label>
      <label class="field"><span>密語</span><input type="password" id="pass" value="${esc(cfg.pass || '')}" autocomplete="off"></label>
      <button class="btn primary wide" id="test">儲存並測試</button>
      <p id="res" class="small"></p></div>
    <div class="card"><h2 style="margin-top:0">狀態</h2>
      <p class="small">手機上有 ${list.filter(e => !e.deleted).length} 篇，${waiting} 篇等著送上雲端。</p>
      <p class="small">上次同步：${esc(lastSync?.at ? new Date(lastSync.at).toLocaleString('zh-TW') : '還沒有')}${lastSync?.error ? '<br>⚠️ ' + esc(lastSync.error) : ''}</p>
      <p class="small">上次上傳：${last ? `${esc(last.name)}，${mb(last.size)}，${last.mode === 'direct' ? '手機直傳' : '經 Apps Script 切塊'}，${last.sec} 秒` : '還沒有'}</p>
      ${est ? `<p class="small">手機空間：已用 ${mb(est.usage)}</p>` : ''}
      <button class="btn wide" id="now">現在同步</button>
      <button class="btn wide" id="restore">從雲端還原</button>
      <p class="muted small">換手機時：填好網址和密語，按「從雲端還原」就會抓回全部文字。原檔留在雲端，不會下載到手機。</p></div>`;
  view.oninput = view.onchange = null;
  view.onclick = async e => {
    if (e.target.id === 'test') {
      const c = { url: $('#url').value.trim(), pass: $('#pass').value };
      await kvSet('cfg', c);
      $('#res').textContent = '測試中…';
      try { const r = await api('ping'); $('#res').textContent = '✅ ' + r.message; sync(); }
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
  const r = await fetch(url, { method: 'PUT', headers: { 'Content-Range': `bytes ${start}-${end - 1}/${total}` }, body: blob.slice(start, end) });
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

let syncing = false, syncAgain = false, retryTimer;
async function sync() {
  if (syncing) { syncAgain = true; return; }
  const cfg = await kvGet('cfg');
  if (!cfg?.url || !navigator.onLine) return;
  syncing = true; keepAwake(true);
  let error = '';
  try {
    for (const snap of (await dbAll('entries')).filter(x => x.dirty)) {
      if (snap.deleted) { await api('delete', { id: snap.id }); await dbDel('entries', snap.id); continue; }
      await api('save', { entry: serverCopy(snap) });   // 文字先上去，影片傳失敗也不怕
      const todo = snap.media.filter(m => !m.fileId);
      for (let i = 0; i < todo.length; i++) await uploadMedia(snap, todo[i], `上傳照片影片 ${i + 1}/${todo.length}`);
      const cur = await dbGet('entries', snap.id);
      if (!cur) continue;
      if (todo.length) await api('save', { entry: serverCopy(cur) });
      if (cur.rev === snap.rev) await dbPut('entries', { ...cur, dirty: false });
    }
    let since = (await kvGet('since')) || '', more = true;
    while (more) {
      const r = await api('pull', { since });
      for (const s of r.entries) {
        const local = await dbGet('entries', s.id);
        if (local?.dirty) continue;
        if (s.deleted) { await dbDel('entries', s.id); continue; }
        const thumbs = Object.fromEntries((local?.media || []).map(m => [m.id, m.thumb]));
        await dbPut('entries', { ...s, media: s.media.map(m => ({ ...m, thumb: thumbs[m.id] })), dirty: false, rev: local?.rev || 0 });
      }
      since = r.since; more = r.more;
      await kvSet('since', since);
    }
  } catch (e) { error = e instanceof TypeError ? '連不上雲端' : e.message; }
  await kvSet('lastSync', { at: Date.now(), error });
  syncing = false; keepAwake(false);
  bar(error ? `⚠️ ${error}，等一下會再試` : '');
  if (error) { clearTimeout(retryTimer); retryTimer = setTimeout(sync, 60000); }
  if (!error && !location.hash.startsWith('#today') && !location.hash.startsWith('#settings')) route();
  if (syncAgain) { syncAgain = false; sync(); }
}

/* ---------------- 相簿分享進來 ---------------- */
async function takeShared() {
  const items = await dbAll('shared');
  if (!items.length) return;
  const draft = await getDraft();
  const files = items.filter(i => i.file).map(i => i.file);
  const text = items.filter(i => i.text).map(i => i.text).join('\n');
  if (text) draft.text = draft.text ? draft.text + '\n' + text : text;
  await addFiles(files, draft);
  await kvSet('draft', draft);
  await dbClear('shared');
  toast(`收到 ${files.length} 個檔案`);
}

/* ---------------- 頁面切換 ---------------- */
async function route() {
  const h = location.hash || '#today';
  if (listening) stopMic();
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
(async () => {
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  if (location.search.includes('shared')) { await takeShared(); history.replaceState(null, '', './#today'); }
  await route();
  sync();
})();
