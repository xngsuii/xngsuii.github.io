/* ============================================================
   FIRESTORE 저장소 어댑터
   ------------------------------------------------------------
   기존 window.storage(일회성 저장)를 대체합니다.
   화면 코드(main.js)는 예전과 똑같이 storageGet/storageSet만
   호출하면 되고, 아래 내용은 전부 이 파일이 알아서 처리합니다.

     · 항목별 문서 분리   (Firestore 1MB/문서 제한 회피)
     · 이미지 자동 압축
     · 큰 파일 분할 저장
     · 변경된 문서만 저장 + 묶어서 저장(과도한 쓰기 방지)
     · 관리자 로그인(Firebase Authentication)
   ============================================================ */

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { FIREBASE_CONFIG, ADMIN_UID } from './firebase-config.js';

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

/* 사이트 데이터가 들어가는 최상위 문서 */
const ROOT = ['site', 'main'];
const metaRef = () => doc(db, ROOT[0], ROOT[1]);
const listRef = (key) => collection(db, ROOT[0], ROOT[1], key);
const blobsRef = () => collection(db, ROOT[0], ROOT[1], 'blobs');

/* 작은 값은 meta 문서 하나에, 배열은 항목별 문서로 나눠 저장 */
const SCALAR_KEYS = ['profile', 'siteName', 'homeIntro', 'homeBanner', 'archiveSeqCounter'];
const LIST_KEYS   = ['cards', 'pairPosts', 'archive'];

/* Firestore 문서 1개 최대 1MiB. 여유를 두고 자릅니다. */
const CHUNK_CHARS = 700000;

/* ------------------------------------------------------------
   상태
   ------------------------------------------------------------ */
let cache = {};            // key -> 화면에 그대로 넘길 값(이미지 복원 완료)
let savedJson = {};         // "key/docId" -> 마지막으로 저장한 JSON (변경 감지용)
let blobCache = new Map();  // blobId -> data URL
let knownBlobIds = new Set();
let loaded = false;
let isAdmin = false;

/* ------------------------------------------------------------
   유틸
   ------------------------------------------------------------ */
async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:');
const BLOB_REF  = /^blob:\/\/([a-f0-9]{32})$/;

/* ------------------------------------------------------------
   이미지 압축
   ------------------------------------------------------------
   원본을 그대로 저장하면 용량을 금방 써버리므로,
   긴 변 기준으로 줄이고 화질을 낮춰가며 목표 크기에 맞춥니다.
   GIF는 움직임이 사라지므로 건드리지 않습니다.
   ------------------------------------------------------------ */
export async function compressImage(file, maxDim = 1600, targetChars = 600000) {
  const raw = () => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
  });

  if (!file.type.startsWith('image/') || file.type === 'image/gif') return raw();

  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { return raw(); }   // 못 읽는 형식이면 원본 유지

  let w = bmp.width, h = bmp.height;
  const fit = Math.min(1, maxDim / Math.max(w, h));
  w = Math.max(1, Math.round(w * fit));
  h = Math.max(1, Math.round(h * fit));

  const draw = (cw, ch, withWhiteBg) => {
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    if (withWhiteBg) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); }
    ctx.drawImage(bmp, 0, 0, cw, ch);
    return c;
  };

  // PNG는 투명도가 있을 수 있으니, 충분히 작으면 PNG 그대로 유지
  if (file.type === 'image/png') {
    const png = draw(w, h, false).toDataURL('image/png');
    if (png.length <= targetChars) { bmp.close?.(); return png; }
  }

  // 그 외에는 JPEG로 변환 (투명 부분은 흰색으로)
  let cw = w, ch = h, out = '';
  for (let round = 0; round < 4; round++) {
    const canvas = draw(cw, ch, true);
    let q = 0.85;
    out = canvas.toDataURL('image/jpeg', q);
    while (out.length > targetChars && q > 0.4) {
      q -= 0.1;
      out = canvas.toDataURL('image/jpeg', q);
    }
    if (out.length <= targetChars) break;
    cw = Math.max(1, Math.round(cw * 0.75));   // 그래도 크면 더 줄임
    ch = Math.max(1, Math.round(ch * 0.75));
  }
  bmp.close?.();
  return out;
}

/* ------------------------------------------------------------
   큰 데이터(이미지·첨부파일) 분리 저장
   ------------------------------------------------------------
   저장 직전 data URL을 찾아내 별도 문서로 옮기고
   자리에는 blob://<id> 참조만 남깁니다.
   불러올 때는 반대로 되돌려서, 화면 코드는 차이를 모릅니다.
   ------------------------------------------------------------ */
async function storeBlob(dataUrl, pending) {
  const id = await sha256Hex(dataUrl);
  blobCache.set(id, dataUrl);
  if (!knownBlobIds.has(id)) pending.set(id, dataUrl);
  return `blob://${id}`;
}

/* HTML 본문 안에 박혀 있는 <img src="data:..."> 도 찾아냅니다 */
async function deflateHtml(html, pending) {
  const matches = [...html.matchAll(/(src\s*=\s*")(data:[^"]+)(")/g)];
  let out = html;
  for (const m of matches) {
    const ref = await storeBlob(m[2], pending);
    out = out.replace(m[2], ref);
  }
  return out;
}

export async function deflate(value, pending) {
  if (typeof value === 'string') {
    if (isDataUrl(value)) return storeBlob(value, pending);
    if (value.includes('data:')) return deflateHtml(value, pending);
    return value;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await deflate(v, pending));
    return out;
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = await deflate(value[k], pending);
    return out;
  }
  return value === undefined ? null : value;
}

export function inflate(value) {
  if (typeof value === 'string') {
    const m = value.match(BLOB_REF);
    if (m) return blobCache.get(m[1]) || '';
    if (value.includes('blob://')) {
      return value.replace(/blob:\/\/([a-f0-9]{32})/g, (_, id) => blobCache.get(id) || '');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(inflate);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = inflate(value[k]);
    return out;
  }
  return value;
}

/* 큰 데이터는 여러 조각으로 나눠 저장 */
async function writeBlob(id, dataUrl) {
  const total = Math.ceil(dataUrl.length / CHUNK_CHARS);
  await setDoc(doc(blobsRef(), id), { chunks: total, len: dataUrl.length });
  for (let i = 0; i < total; i++) {
    await setDoc(doc(collection(doc(blobsRef(), id), 'parts'), String(i)),
      { d: dataUrl.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
  }
  knownBlobIds.add(id);
}

async function readBlob(id, chunks) {
  const parts = [];
  for (let i = 0; i < chunks; i++) {
    const s = await getDoc(doc(collection(doc(blobsRef(), id), 'parts'), String(i)));
    parts.push(s.exists() ? (s.data().d || '') : '');
  }
  return parts.join('');
}

/* ------------------------------------------------------------
   불러오기
   ------------------------------------------------------------ */
async function loadAll() {
  // 이미지/첨부파일 먼저 (본문 복원에 필요)
  blobCache.clear(); knownBlobIds.clear();
  const blobSnap = await getDocs(blobsRef());
  for (const d of blobSnap.docs) {
    knownBlobIds.add(d.id);
    blobCache.set(d.id, await readBlob(d.id, d.data().chunks || 1));
  }

  const raw = {};
  const metaSnap = await getDoc(metaRef());
  const meta = metaSnap.exists() ? metaSnap.data() : {};
  for (const k of SCALAR_KEYS) {
    raw[k] = meta[k] === undefined ? null : meta[k];
    savedJson[`${k}/_`] = JSON.stringify(raw[k]);
  }

  for (const key of LIST_KEYS) {
    const snap = await getDocs(listRef(key));
    const items = snap.docs
      .map(d => ({ ...d.data(), __docId: d.id }))
      .sort((a, b) => (a.__order ?? 0) - (b.__order ?? 0));
    items.forEach(it => { savedJson[`${key}/${it.__docId}`] = JSON.stringify(stripMeta(it)); });
    raw[key] = items.map(stripMeta);
  }

  cache = {};
  for (const k of Object.keys(raw)) cache[k] = inflate(raw[k]);
  loaded = true;
  if (isAdmin) collectGarbage();
}

function stripMeta(o) {
  const c = { ...o };
  delete c.__docId; delete c.__order;
  return c;
}

/* ------------------------------------------------------------
   저장 (변경분만 · 묶어서)
   ------------------------------------------------------------
   제목 입력처럼 글자마다 호출되는 곳이 있어서,
   바로 쓰지 않고 잠깐 모았다가 한 번에 보냅니다.
   ------------------------------------------------------------ */
const dirty = new Set();
let flushTimer = null;
let flushChain = Promise.resolve();
let flushWaiters = [];
const SAVE_DELAY = 1200;

/* 저장 상태를 화면에 알리기 위한 알림 (saving / saved / error) */
const saveListeners = new Set();
let lastSaveState = 'idle';
function emitSave(stateName, detail) {
  lastSaveState = stateName;
  saveListeners.forEach(fn => { try { fn(stateName, detail); } catch (e) { console.error(e); } });
}

/* 실제 저장이 끝난 뒤에 resolve 되는 Promise를 돌려줍니다 */
let retryTimer = null;
function runFlush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const waiters = flushWaiters; flushWaiters = [];
  flushChain = flushChain
    .then(() => { if (dirty.size) emitSave('saving'); return flush(); })
    .then(() => { if (lastSaveState === 'saving') emitSave('saved'); })
    .catch(e => {
      console.error('저장 실패 — 잠시 후 다시 시도합니다.', e);
      emitSave('error', e);
      // 실패한 변경분은 dirty에 남아 있으므로 재시도만 걸어주면 됩니다
      if (dirty.size && !retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; runFlush(); }, 5000);
      }
    })
    .then(() => waiters.forEach(r => r()));
  return flushChain;
}

function scheduleFlush() {
  const p = new Promise(res => flushWaiters.push(res));
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(runFlush, SAVE_DELAY);
  return p;
}

async function flush() {
  if (!isAdmin || dirty.size === 0) return;
  const keys = [...dirty]; dirty.clear();

  const pending = new Map();               // 새로 저장해야 할 이미지/첨부
  const metaPatch = {};
  const listWrites = [];                   // {key, docId, data}
  const listDeletes = [];                  // {key, docId}
  /* 저장이 성공한 뒤에만 "저장됨" 기록을 갱신합니다.
     먼저 갱신해버리면, 쓰기가 실패했을 때 다음번에
     "바뀐 게 없다"고 판단해 변경분을 영영 잃게 됩니다. */
  const nextSaved = {};
  const dropSaved = [];

  for (const key of keys) {
    const value = cache[key];

    if (SCALAR_KEYS.includes(key)) {
      const stored = await deflate(value, pending);
      const json = JSON.stringify(stored);
      if (savedJson[`${key}/_`] !== json) {
        metaPatch[key] = stored;
        nextSaved[`${key}/_`] = json;
      }
      continue;
    }

    if (!LIST_KEYS.includes(key)) { console.warn('알 수 없는 저장 키:', key); continue; }

    // 배열 → 항목별 문서
    const arr = Array.isArray(value) ? value : [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      const docId = String(item?.id ?? `idx${i}`);
      seen.add(docId);
      const stored = await deflate(item, pending);
      const json = JSON.stringify(stored);
      if (savedJson[`${key}/${docId}`] !== json) {
        listWrites.push({ key, docId, data: { ...stored, __order: i } });
        nextSaved[`${key}/${docId}`] = json;
      }
    }
    // 사라진 항목 삭제
    for (const sk of Object.keys(savedJson)) {
      if (!sk.startsWith(key + '/')) continue;
      const docId = sk.slice(key.length + 1);
      if (docId === '_' || seen.has(docId)) continue;
      listDeletes.push({ key, docId });
      dropSaved.push(sk);
    }
  }

  try {
    for (const [id, dataUrl] of pending) await writeBlob(id, dataUrl);

    if (Object.keys(metaPatch).length) await setDoc(metaRef(), metaPatch, { merge: true });

    // 배치는 500개 제한이 있어 나눠서 처리
    const ops = [
      ...listWrites.map(w => ({ type: 'set', ...w })),
      ...listDeletes.map(d => ({ type: 'del', ...d }))
    ];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = writeBatch(db);
      for (const op of ops.slice(i, i + 400)) {
        const ref = doc(listRef(op.key), op.docId);
        if (op.type === 'set') batch.set(ref, op.data);
        else batch.delete(ref);
      }
      await batch.commit();
    }

    Object.assign(savedJson, nextSaved);
    dropSaved.forEach(sk => { delete savedJson[sk]; });
  } catch (e) {
    keys.forEach(k => dirty.add(k));       // 저장 기록을 건드리지 않았으므로 그대로 재시도됨
    throw e;
  }
}

/* 탭을 닫기 전에 남은 변경분을 최대한 저장 */
function flushNow() {
  if (!dirty.size && !flushWaiters.length) return flushChain;
  return runFlush();
}
window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
window.addEventListener('pagehide', flushNow);

/* ------------------------------------------------------------
   사용하지 않게 된 이미지 정리
   ------------------------------------------------------------
   전체를 불러온 직후에만, 관리자일 때만 실행합니다.
   ------------------------------------------------------------ */
async function collectGarbage() {
  if (!loaded || !isAdmin) return;
  // 아직 저장되지 않은 변경분이 있으면 건너뜁니다.
  // (방금 추가한 이미지를 "사용 안 함"으로 오판할 수 있음)
  if (dirty.size || flushTimer) return;
  const used = new Set();
  const scan = (v) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(/blob:\/\/([a-f0-9]{32})/g)) used.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === 'object') Object.values(v).forEach(scan);
  };
  Object.values(savedJson).forEach(scan);

  for (const id of [...knownBlobIds]) {
    if (used.has(id)) continue;
    try {
      const snap = await getDoc(doc(blobsRef(), id));
      const chunks = snap.exists() ? (snap.data().chunks || 1) : 0;
      for (let i = 0; i < chunks; i++) {
        await deleteDoc(doc(collection(doc(blobsRef(), id), 'parts'), String(i)));
      }
      await deleteDoc(doc(blobsRef(), id));
      knownBlobIds.delete(id); blobCache.delete(id);
    } catch (e) { console.warn('미사용 이미지 정리 실패', id, e); }
  }
}

/* ------------------------------------------------------------
   로그인
   ------------------------------------------------------------ */
const listeners = new Set();
let authResolved = false;
function notify() { listeners.forEach(fn => { try { fn(isAdmin); } catch (e) { console.error(e); } }); }

await setPersistence(auth, browserLocalPersistence).catch(() => {});
onAuthStateChanged(auth, (user) => {
  isAdmin = !!user && user.uid === ADMIN_UID;
  authResolved = true;
  notify();
  if (isAdmin) collectGarbage();
});

/* ------------------------------------------------------------
   화면 코드가 사용하는 API
   ------------------------------------------------------------ */
const SiteStore = {
  get isAdmin() { return isAdmin; },

  /* 저장 상태 구독: fn('saving'|'saved'|'error', 오류객체) */
  onSaveState(fn) { saveListeners.add(fn); return () => saveListeners.delete(fn); },

  /* 아직 저장되지 않은 변경분이 있는지 */
  get hasUnsaved() { return dirty.size > 0 || flushWaiters.length > 0; },

  onAuthChange(fn) {
    listeners.add(fn);
    // 이미 로그인 상태가 확정된 뒤에 연결됐다면 즉시 한 번 알려줍니다
    if (authResolved) { try { fn(isAdmin); } catch (e) { console.error(e); } }
    return () => listeners.delete(fn);
  },

  async signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.uid !== ADMIN_UID) {
      await signOut(auth);
      throw new Error('관리자 계정이 아닙니다.');
    }
    return true;
  },

  async signOut() { await flushNow().catch(() => {}); await signOut(auth); },

  async load() { await loadAll(); },

  get(key, fallback) {
    const v = cache[key];
    return (v === undefined || v === null) ? fallback : v;
  },

  set(key, value) {
    cache[key] = value;
    if (!isAdmin) return Promise.resolve();   // 규칙상 어차피 거부됨
    dirty.add(key);
    return scheduleFlush();
  },

  compressImage,
  flushNow
};

window.SiteStore = SiteStore;
window.dispatchEvent(new Event('store-ready'));
