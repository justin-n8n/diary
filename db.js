/* 手機上的資料庫（IndexedDB）：app.js 和 sw.js 共用。
   entries：每篇日記；blobs：還沒傳上雲端的照片影片；kv：設定與草稿；shared：從相簿分享進來、還沒放進草稿的檔案。 */
const DB_NAME = 'xiaohui-diary';
let dbConn = null;

function dbOpen() {
  if (dbConn) return Promise.resolve(dbConn);
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('entries', { keyPath: 'id' });
      d.createObjectStore('blobs', { keyPath: 'id' });
      d.createObjectStore('kv', { keyPath: 'k' });
      d.createObjectStore('shared', { keyPath: 'n', autoIncrement: true });
    };
    r.onsuccess = () => { dbConn = r.result; dbConn.onclose = () => { dbConn = null; }; resolve(dbConn); };
    r.onerror = () => reject(r.error);
  });
}
async function dbDo(store, mode, fn) {
  const d = await dbOpen();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const q = fn(t.objectStore(store));
    t.oncomplete = () => resolve(q && q.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const dbPut = (s, v) => dbDo(s, 'readwrite', o => o.put(v));
const dbGet = (s, k) => dbDo(s, 'readonly', o => o.get(k));
const dbDel = (s, k) => dbDo(s, 'readwrite', o => o.delete(k));
const dbAll = s => dbDo(s, 'readonly', o => o.getAll());
const dbClear = s => dbDo(s, 'readwrite', o => o.clear());
const kvGet = async k => (await dbGet('kv', k))?.v;
const kvSet = (k, v) => dbPut('kv', { k, v });
const kvDel = k => dbDel('kv', k);
