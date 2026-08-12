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
  getFirestore, doc, getDoc, setDoc, deleteDoc, deleteField,
  collection, getDocs, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js';
import { FIREBASE_CONFIG, ADMIN_UID } from './firebase-config.js?v=104';

const app  = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);

/* 사이트 데이터가 들어가는 최상위 문서 */
const ROOT = ['site', 'main'];
const metaRef = () => doc(db, ROOT[0], ROOT[1]);
const listRef = (key) => collection(db, ROOT[0], ROOT[1], key);
const blobsRef = () => collection(db, ROOT[0], ROOT[1], 'blobs');

/* 작은 값은 meta 문서 하나에, 배열은 항목별 문서로 나눠 저장 */
/* archiveFolders* 는 ARCHIVE 세부 카테고리별 폴더 목록입니다. 안에 글을 담지 않고
   이름·비밀번호해시·옵션만 들어 있어 항목 수가 적으므로 meta 문서에 함께 둡니다.
   (글 쪽에 folderId 가 적혀 있어 폴더-글 연결은 archive 문서들이 갖습니다)
   PROMPT 것은 먼저 있던 키라 이름을 그대로 두고, OOC / ETC 는 따로 하나씩 더 둡니다 —
   세 카테고리는 담는 글이 다르니 폴더도 섞이면 안 됩니다. */
/* pairCats / ocCats 는 사이드바의 세부 분류 목록입니다({id,name} 몇 개뿐이라 meta 문서에 함께 둡니다).
   글 쪽에 type 이 적혀 있어 분류-글 연결은 글 문서들이 갖습니다. */
const SCALAR_KEYS = ['profile', 'siteName', 'homeIntro', 'homeBanner', 'archiveSeqCounter',
                     'archiveFolders', 'archiveFoldersOoc', 'archiveFoldersEtc',
                     'ocFolders', 'pairCats', 'ocCats',
                     /* 사이드바 뮤직 위젯의 재생 목록. 곡마다 영상 번호와 제목·아티스트뿐이라
                        몇십 곡이 되어도 작습니다(음량은 기기별 취향이라 저장하지 않습니다). */
                     'musicList'];
const LIST_KEYS   = ['cards', 'pairPosts', 'archive', 'ocPosts'];

/* Firestore 문서 1개 최대 1MiB. 여유를 두고 자릅니다. */
const CHUNK_CHARS = 700000;

/* ------------------------------------------------------------
   상태
   ------------------------------------------------------------ */
let cache = {};            // key -> 화면에 넘길 값 (사진 자리에는 blob:// 참조가 그대로 들어 있음)
let savedJson = {};         // "key/docId" -> 마지막으로 저장한 JSON (변경 감지용)
/* "key/docId" -> 마지막으로 저장한 순서(__order).
   순서는 위 JSON 에 들어 있지 않습니다(stripMeta 가 빼고 저장합니다). 그래서
   순서만 바꾸면 모든 항목의 JSON 이 그대로라 "바뀐 게 없다"고 보고 아무것도
   쓰지 않았고, 새로고침하면 예전 순서로 돌아왔습니다. 순서를 따로 기억해
   내용과 함께 견줍니다. */
let savedOrder = {};
let blobCache = new Map();  // blobId -> data URL (도착한 것부터 채워집니다)
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
/* maxDim / targetChars 를 올리면 저장 용량이 늘어나는 대신 선명해집니다.
   큰 데이터는 아래 writeBlob 이 조각내어 저장하므로 문서 크기 제한에는 걸리지 않습니다.
   원본이 가장 크게 표시되는 곳은 페어 상세 배너(718px)와 아카이브 라이트박스이므로
   1800px면 충분합니다. 썸네일 계단 현상은 해상도가 아니라 축소 방식 문제였고
   main.js 의 downscaleThumb 이 담당하므로, 여기서 원본을 더 키울 이유는 없습니다.
   화질이 뭉개지지 않도록 최저 품질은 0.6으로 둡니다. */
export async function compressImage(file, maxDim = 1800, targetChars = 900000) {
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
    let q = 0.92;
    out = canvas.toDataURL('image/jpeg', q);
    while (out.length > targetChars && q > 0.6) {
      q -= 0.06;
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
    /* 사진 자체(data URL)는 통째로 훑을 필요가 없습니다 —
       그릴 때마다 부르는 함수라 수십만 글자를 매번 뒤지면 눈에 띄게 느려집니다. */
    if (isDataUrl(value)) return value;
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

/* ------------------------------------------------------------
   받은 사진을 브라우저에 보관하기
   ------------------------------------------------------------
   Firestore 문서는 브라우저가 캐시해 주지 않습니다. 그래서 새로고침
   한 번마다 사진을 전부 서버에서 다시 받았고, 그것만으로 하루 읽기
   한도(5만 건)를 스무 번쯤 여는 것으로 다 써버렸습니다.

   사진 id 는 그 내용의 SHA-256 입니다. 내용이 달라지면 id 도 달라지므로
   여기 보관된 것이 낡을 수가 없습니다 — 유효기간을 두거나 서버에
   물어볼 필요 없이, id 가 같으면 무조건 같은 사진입니다.

   실패는 전부 조용히 넘깁니다. 보관이 막혀 있어도(사생활 보호 모드,
   저장 공간 부족) 예전처럼 서버에서 받으면 그만이고, 화면 동작은
   달라지지 않아야 합니다. 그래서 아래 함수들은 절대 던지지 않고
   null 을 돌려줍니다.
   ------------------------------------------------------------ */
const IDB_NAME = 'siteBlobs', IDB_VER = 1;
const S_BLOBS = 'blobs', S_STAT = 'stat';
const IDB_BUDGET = 350 * 1024 * 1024;   // 넘으면 오래 전에 받은 것부터 버립니다
let idbPromise = null;
let idbUsed = null;          // 보관 중인 총 글자 수 (null = 아직 모름)
let idbTrimming = false;

function idbOpen() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((res) => {
    let req;
    try { req = indexedDB.open(IDB_NAME, IDB_VER); }
    catch (e) { return res(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(S_BLOBS)) {
        /* 't' 는 받은 시각입니다. 자리가 모자랄 때 오래된 것부터 훑기 위한 것입니다. */
        db.createObjectStore(S_BLOBS, { keyPath: 'id' }).createIndex('t', 't');
      }
      if (!db.objectStoreNames.contains(S_STAT)) db.createObjectStore(S_STAT, { keyPath: 'k' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
    req.onblocked = () => res(null);
  });
  return idbPromise;
}

/* 거래(transaction)가 끝날 때 resolve 합니다. 어떤 이유로든 실패하면 null 입니다. */
function idbRun(stores, mode, fn) {
  return idbOpen().then(db => {
    if (!db) return null;
    return new Promise((res) => {
      let tx;
      try { tx = db.transaction(stores, mode); }
      catch (e) { return res(null); }
      let out = null;
      tx.oncomplete = () => res(out);
      tx.onerror = () => res(null);
      tx.onabort = () => res(null);
      try { fn(tx, (v) => { out = v; }); }
      catch (e) { try { tx.abort(); } catch (e2) {} }
    });
  }).catch(() => null);
}

/* 보관량 기록을 늘리거나(양수) 줄입니다(음수). 같은 거래 안에서 처리합니다. */
function bumpUsed(tx, delta) {
  if (!delta) return;
  const st = tx.objectStore(S_STAT);
  const r = st.get('used');
  r.onsuccess = () => {
    const v = Math.max(0, ((r.result && r.result.v) || 0) + delta);
    idbUsed = v;
    st.put({ k: 'used', v });
  };
}

function cacheGetBlob(id) {
  return idbRun([S_BLOBS], 'readonly', (tx, done) => {
    const r = tx.objectStore(S_BLOBS).get(id);
    r.onsuccess = () => done(r.result ? r.result.d : null);
  });
}

function cachePutBlob(id, dataUrl) {
  return idbRun([S_BLOBS, S_STAT], 'readwrite', (tx) => {
    tx.objectStore(S_BLOBS).put({ id, d: dataUrl, n: dataUrl.length, t: Date.now() });
    bumpUsed(tx, dataUrl.length);
  }).then(() => { if (idbUsed !== null && idbUsed > IDB_BUDGET) idbTrim(); });
}

function cacheDropBlobs(ids) {
  if (!ids.length) return Promise.resolve(null);
  return idbRun([S_BLOBS, S_STAT], 'readwrite', (tx) => {
    const st = tx.objectStore(S_BLOBS);
    let freed = 0, left = ids.length;
    const step = () => { if (--left === 0) bumpUsed(tx, -freed); };
    ids.forEach(id => {
      const g = st.get(id);
      g.onsuccess = () => { if (g.result) { freed += g.result.n || 0; st.delete(id); } step(); };
      g.onerror = step;
    });
  });
}

/* 예산을 넘으면 오래 전에 받은 것부터 80% 선까지 버립니다.
   지워도 손해는 없습니다 — 다음에 필요하면 서버에서 다시 받습니다. */
function idbTrim() {
  if (idbTrimming) return Promise.resolve(null);
  idbTrimming = true;
  let over = idbUsed - IDB_BUDGET * 0.8;
  let freed = 0;
  return idbRun([S_BLOBS, S_STAT], 'readwrite', (tx) => {
    const cur = tx.objectStore(S_BLOBS).index('t').openCursor();
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || freed >= over) { bumpUsed(tx, -freed); return; }
      freed += (c.value.n || 0);
      c.delete();
      c.continue();
    };
  }).finally(() => { idbTrimming = false; });
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
  blobChunks.set(id, total);
  cachePutBlob(id, dataUrl);    // 방금 올린 사진을 서버에서 도로 받을 이유는 없습니다
  return total;                 // 부르는 쪽이 사진 목록에 적어 둡니다
}

/* 조각들은 한꺼번에 받습니다 — 하나씩 기다리면 조각 수만큼 왕복이 늘어납니다 */
async function readBlob(id) {
  const kept = await cacheGetBlob(id);
  if (kept) return kept;

  let chunks = blobChunks.get(id);
  if (!chunks) {
    /* 사진 목록에 없는 사진입니다. 목록이 아직 안 만들어졌거나 다른 기기에서
       올린 사진일 수 있습니다. 그 사진 문서만 직접 열어 조각 수를 알아냅니다.
       목록은 읽기를 아끼기 위한 빠른 길일 뿐 정답이 아니어야 합니다 —
       목록이 틀렸다고 사진이 안 뜨면 안 됩니다. */
    const head = await getDoc(doc(blobsRef(), id));
    if (!head.exists()) throw new Error('사진 문서가 없습니다: ' + id);
    chunks = head.data().chunks || 1;
    blobChunks.set(id, chunks);
    knownBlobIds.add(id);
  }

  const snaps = await Promise.all(
    Array.from({ length: chunks }, (_, i) =>
      getDoc(doc(collection(doc(blobsRef(), id), 'parts'), String(i))))
  );
  const data = snaps.map(s => (s.exists() ? (s.data().d || '') : '')).join('');
  if (data) cachePutBlob(id, data);   // 기다리지 않습니다
  return data;
}

/* ------------------------------------------------------------
   사진 늦게 받기
   ------------------------------------------------------------
   사진은 이 사이트 데이터의 99.9% 를 차지합니다(984장, 수백 MB).
   예전에는 화면을 그리기 전에 이걸 전부, 그것도 한 장씩 순서대로
   받느라 첫 화면이 20초 넘게 걸렸습니다.

   지금은 글·목록만 먼저 받아 곧바로 그리고(0.1MB), 사진은 뒤에서
   여러 장씩 동시에 받아 도착하는 대로 채웁니다. 화면 코드가 받는 값에는
   blob://<id> 참조가 그대로 들어 있고, 그릴 때 SiteStore.resolve() 로
   실제 사진을 꺼내 씁니다.

   그리고 '뒤에서'가 '전부'는 아닙니다. 한동안은 첫 화면을 그린 뒤 사이트의
   사진을 통째로 내려받았는데, Firestore 는 문서 하나가 읽기 한 건이라
   HOME 만 열어도 방문 한 번에 읽기 2천여 건(사진 목록 984 + 조각 1천여)과
   수백 MB 가 나갔습니다. 하루 한도가 5만 건이라 스무 번만 열면 사이트가
   멈췄습니다. 지금은 그리는 쪽이 prefetch 로 부른 것만 받고, 한 번 받은
   사진은 브라우저에 보관해(위 IndexedDB) 두 번째 방문부터는 서버를
   부르지 않습니다.

   참조를 그대로 두는 것이 중요합니다. 아직 안 받은 자리를 빈 문자열로
   바꿔버리면 그 상태에서 저장이 나갈 때 사진이 영영 지워집니다.
   blob:// 문자열은 deflate 가 손대지 않고 통과시키므로,
   받았든 안 받았든 저장 왕복 결과가 똑같습니다.
   ------------------------------------------------------------ */
const BLOB_CONCURRENCY = 6;    // 실측: 동시에 6장이 한 장씩보다 2.8배 빠릅니다
const blobChunks = new Map();  // id -> 조각 수
let blobQueue = [];            // 받을 차례를 기다리는 id (앞이 우선)
const blobActive = new Set();
const blobWanted = new Set();  // 목록이 도착하기 전에 먼저 달라고 한 id
let blobIndexed = false;
const blobListeners = new Set();
let blobArrived = new Set();
let blobNotifyTimer = null;

function blobIdsIn(value, out = []) {
  if (typeof value === 'string') {
    if (isDataUrl(value)) return out;   // 사진 자체 — 참조가 들어 있을 수 없습니다
    for (const m of value.matchAll(/blob:\/\/([a-f0-9]{32})/g)) out.push(m[1]);
  } else if (Array.isArray(value)) {
    value.forEach(v => blobIdsIn(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach(v => blobIdsIn(v, out));
  }
  return out;
}

function missingBlobIds(value) {
  return [...new Set(blobIdsIn(value))].filter(id => !blobCache.has(id));
}

/* 한 장마다 화면을 다시 그리면 낭비라 짧게 묶어서 알립니다 */
function announceBlob(id) {
  blobArrived.add(id);
  if (blobNotifyTimer) return;
  blobNotifyTimer = setTimeout(() => {
    blobNotifyTimer = null;
    const batch = blobArrived; blobArrived = new Set();
    blobListeners.forEach(fn => { try { fn(batch); } catch (e) { console.error(e); } });
  }, 120);
}

/* 몇 번을 다시 시도해도 안 오는 사진은 그만 부릅니다 — 없는 사진을 4초마다
   영원히 다시 부르면 그것만으로 읽기 할당량이 나갑니다. */
const BLOB_TRIES = 3;
const blobFails = new Map();

function pumpBlobs() {
  while (blobActive.size < BLOB_CONCURRENCY && blobQueue.length) {
    const id = blobQueue.shift();
    if (blobCache.has(id) || blobActive.has(id)) continue;
    blobActive.add(id);
    readBlob(id)
      .then(data => { blobFails.delete(id); blobCache.set(id, data); announceBlob(id); })
      .catch(e => {
        const n = (blobFails.get(id) || 0) + 1;
        blobFails.set(id, n);
        if (n >= BLOB_TRIES) { console.warn('사진을 받지 못했습니다 — 그만 시도합니다.', id, e); return; }
        console.warn('사진을 받지 못했습니다 — 잠시 후 다시 시도합니다.', id, e);
        setTimeout(() => { if (!blobCache.has(id)) { blobQueue.push(id); pumpBlobs(); } }, 4000);
      })
      .finally(() => { blobActive.delete(id); pumpBlobs(); });
  }
}

/* 지금 화면에 필요한 사진을 대기열 맨 앞으로 당깁니다 */
function wantBlobs(ids) {
  const need = ids.filter(id => !blobCache.has(id));
  if (!need.length) return;
  if (!blobIndexed) { need.forEach(id => blobWanted.add(id)); return; }
  /* 사진 목록에 없어도 대기열에 넣습니다 — readBlob 이 그 사진 문서를 직접 보고
     조각 수를 알아냅니다. 예전에는 여기서 걸러 버려서, 목록이 조금이라도 낡으면
     그 사진은 영영 뜨지 않았습니다. */
  const jump = new Set(need.filter(id => !blobActive.has(id)));
  if (!jump.size) return;
  /* 다시 부른 사진은 실패 기록을 지웁니다 — 위 횟수 제한은 아무도 안 보는데
     혼자 4초마다 재시도하며 할당량을 갉아먹는 것을 막기 위한 것이지,
     화면이 실제로 필요로 하는 사진을 포기하기 위한 것이 아닙니다. */
  jump.forEach(id => blobFails.delete(id));
  blobQueue = [...jump, ...blobQueue.filter(id => !jump.has(id))];
  pumpBlobs();
}

/* ------------------------------------------------------------
   사진 목록
   ------------------------------------------------------------
   사진 id -> 조각 수 표입니다. 이 표는 site/main 문서 안의 blobIndex 필드에
   들어 있어서, 이미 받아 온 meta 문서에 딸려 옵니다 — 읽기가 0건입니다.

   예전에는 blobs 컬렉션을 통째로 훑어서 만들었는데, Firestore 는 문서 하나가
   읽기 한 건이라 사진 수만큼(984장이면 984건) 그냥 나갔습니다.
   ------------------------------------------------------------ */
let blobIndexComplete = false;   // 표가 이미 있어 컬렉션을 훑을 필요가 없음

function applyBlobIndex(idx) {
  knownBlobIds.clear(); blobChunks.clear();
  const ids = (idx && typeof idx === 'object') ? Object.keys(idx) : [];
  ids.forEach(id => { knownBlobIds.add(id); blobChunks.set(id, idx[id] || 1); });
  blobIndexComplete = ids.length > 0;
  blobIndexed = true;
}

/* 화면이 달라고 한 사진만 받기 시작합니다.
   예전에는 여기서 사이트의 사진을 전부 대기열에 넣었습니다 — HOME 만 보고
   있어도 갤러리 984장을 통째로 받느라 방문 한 번에 읽기 2천여 건과
   수백 MB 가 나갔습니다. 지금은 그리는 쪽에서 prefetch 로 부르는 것만 받습니다. */
function startBlobQueue() {
  blobQueue = [...blobWanted].filter(id => !blobCache.has(id));
  blobWanted.clear();
  pumpBlobs();
}

/* 표가 아직 없을 때(이 기능을 처음 켠 직후) 딱 한 번 만들어 둡니다.
   관리자만 합니다 — 쓰기 권한이 있어야 하고, 보는 사람에게 984건을
   물릴 이유가 없습니다. 표가 없는 동안에도 사진은 readBlob 이 문서를
   직접 찾아 띄우므로 화면은 멀쩡합니다. */
async function ensureBlobIndex() {
  if (!isAdmin || blobIndexComplete) return;
  blobIndexComplete = true;                 // 여러 번 부르더라도 한 번만
  try {
    const snap = await getDocs(blobsRef());
    const idx = {};
    snap.docs.forEach(d => { idx[d.id] = d.data().chunks || 1; });
    snap.docs.forEach(d => { knownBlobIds.add(d.id); blobChunks.set(d.id, idx[d.id]); });
    if (Object.keys(idx).length) await setDoc(metaRef(), { blobIndex: idx }, { merge: true });
  } catch (e) {
    blobIndexComplete = false;
    console.warn('사진 목록을 만들지 못했습니다 — 사진은 개별로 받습니다.', e);
  }
}

/* ------------------------------------------------------------
   불러오기
   ------------------------------------------------------------ */
async function loadAll() {
  blobCache.clear(); knownBlobIds.clear(); blobChunks.clear();
  blobQueue = []; blobWanted.clear(); blobIndexed = false;

  /* 글·목록만 먼저 받습니다 — 전부 합쳐도 0.1MB 라 0.2초면 끝납니다.
     여기서 사진(122MB)까지 기다리면 첫 화면이 20초 넘게 걸립니다. */
  const [metaSnap, ...listSnaps] = await Promise.all([
    getDoc(metaRef()),
    ...LIST_KEYS.map(key => getDocs(listRef(key)))
  ]);

  const raw = {};
  const meta = metaSnap.exists() ? metaSnap.data() : {};
  for (const k of SCALAR_KEYS) {
    raw[k] = meta[k] === undefined ? null : meta[k];
    savedJson[`${k}/_`] = JSON.stringify(raw[k]);
  }

  LIST_KEYS.forEach((key, n) => {
    const items = listSnaps[n].docs
      .map(d => ({ ...d.data(), __docId: d.id }))
      .sort((a, b) => (a.__order ?? 0) - (b.__order ?? 0));
    items.forEach((it, i) => {
      savedJson[`${key}/${it.__docId}`] = JSON.stringify(stripMeta(it));
      /* 서버에 적힌 순서가 아니라 정렬한 뒤의 자리(i)를 기억합니다 — 저장할 때
         넣는 값도 배열에서의 자리라 같은 기준이어야 합니다. 예전에 저장돼
         __order 가 아예 없는 문서는 위 정렬에서 전부 0 으로 몰려 자리만
         남으므로, 다음 저장 때 제 번호를 받아 갑니다. */
      savedOrder[`${key}/${it.__docId}`] = i;
    });
    raw[key] = items.map(stripMeta);
  });

  /* 사진 자리의 blob://<id> 는 그대로 둡니다 — 그리는 쪽에서 꺼내 씁니다 */
  cache = raw;
  loaded = true;

  /* 사진 목록은 방금 받은 meta 문서 안에 들어 있습니다 (추가 읽기 없음) */
  applyBlobIndex(meta.blobIndex);
  startBlobQueue();
  if (isAdmin) ensureBlobIndex().then(collectGarbage);
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
  /* 불러오기가 성공적으로 끝나기 전에는 절대 쓰지 않습니다.
     메모리가 비어 있는 상태로 저장이 나가면, 아래 삭제 로직이
     서버의 멀쩡한 문서를 "사라진 항목"으로 보고 지워버립니다. */
  if (!loaded) { console.warn('불러오기 전이라 저장을 보류합니다.'); return; }
  const keys = [...dirty]; dirty.clear();

  const pending = new Map();               // 새로 저장해야 할 이미지/첨부
  const metaPatch = {};
  const listWrites = [];                   // {key, docId, data}
  const listDeletes = [];                  // {key, docId}
  /* 저장이 성공한 뒤에만 "저장됨" 기록을 갱신합니다.
     먼저 갱신해버리면, 쓰기가 실패했을 때 다음번에
     "바뀐 게 없다"고 판단해 변경분을 영영 잃게 됩니다. */
  const nextSaved = {};
  const nextOrder = {};
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
      const sk = `${key}/${docId}`;
      // 내용이 같아도 자리가 달라졌으면 써야 합니다 (순서만 바꾼 경우)
      if (savedJson[sk] !== json || savedOrder[sk] !== i) {
        listWrites.push({ key, docId, data: { ...stored, __order: i } });
        nextSaved[sk] = json;
        nextOrder[sk] = i;
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
    /* 새로 올린 사진은 사진 목록(meta 의 blobIndex)에도 적어 둡니다.
       merge 는 표 안쪽까지 합쳐주므로 다른 사진의 항목은 건드리지 않습니다. */
    const indexAdds = {};
    for (const [id, dataUrl] of pending) indexAdds[id] = await writeBlob(id, dataUrl);
    if (Object.keys(indexAdds).length) metaPatch.blobIndex = indexAdds;

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
    Object.assign(savedOrder, nextOrder);
    dropSaved.forEach(sk => { delete savedJson[sk]; delete savedOrder[sk]; });
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
  /* 사진 목록이 서기 전에는 knownBlobIds 가 비어 있어 판단할 근거가 없습니다.
     목록이 서면 loadAll / ensureBlobIndex 가 다시 부릅니다.
     목록이 불완전해도 안전합니다 — 여기서 지우는 것은 '목록에 있으면서
     어느 글에서도 안 쓰는' 사진이라, 목록이 모자라면 덜 지울 뿐입니다. */
  if (!blobIndexed) return;
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

  const removed = [];
  for (const id of [...knownBlobIds]) {
    if (used.has(id)) continue;
    try {
      /* 조각 수는 사진 목록에 이미 있습니다 — 없을 때만 문서를 봅니다 */
      let chunks = blobChunks.get(id);
      if (!chunks) {
        const snap = await getDoc(doc(blobsRef(), id));
        chunks = snap.exists() ? (snap.data().chunks || 1) : 0;
      }
      for (let i = 0; i < chunks; i++) {
        await deleteDoc(doc(collection(doc(blobsRef(), id), 'parts'), String(i)));
      }
      await deleteDoc(doc(blobsRef(), id));
      knownBlobIds.delete(id); blobChunks.delete(id); blobCache.delete(id);
      removed.push(id);
    } catch (e) { console.warn('미사용 이미지 정리 실패', id, e); }
  }

  if (!removed.length) return;
  /* 사진 목록에서도 뺍니다. 지운 항목만 콕 집어 지웁니다 — 표를 통째로 다시 쓰면
     다른 기기에서 방금 올린 사진의 항목까지 같이 날아갑니다. */
  try {
    const patch = {};
    removed.forEach(id => { patch[id] = deleteField(); });
    await setDoc(metaRef(), { blobIndex: patch }, { merge: true });
  } catch (e) { console.warn('사진 목록 정리 실패', e); }
  cacheDropBlobs(removed);
}

/* ------------------------------------------------------------
   로그인
   ------------------------------------------------------------ */
const listeners = new Set();
let authResolved = false;
function notify() { listeners.forEach(fn => { try { fn(isAdmin); } catch (e) { console.error(e); } }); }

/* '사용자가 직접 로그아웃을 눌렀다'는 표시.
   signOut(auth) 은 실패할 수 있고(IndexedDB 가 막혔거나 네트워크가 끊긴 경우)
   실패해도 조용합니다. 그러면 로그인 기록이 브라우저에 그대로 남아, 새로고침을
   하거나 토큰이 갱신될 때 '아직 로그인 중'이라는 알림이 다시 와서 저절로 편집
   모드로 돌아갑니다 — 아무리 눌러도 로그아웃이 안 되는 것처럼 보이는 원인입니다.
   그래서 이 표시를 브라우저에 남겨두고(새로고침해도 살아남습니다), 표시가 있는
   동안 오는 로그인 알림은 무시하면서 조용히 다시 로그아웃을 시도합니다.
   로그인을 다시 시도하는 순간 표시는 지웁니다. */
const SIGNED_OUT_KEY = 'siteSignedOut';
function markSignedOut(on) {
  try { on ? localStorage.setItem(SIGNED_OUT_KEY, '1') : localStorage.removeItem(SIGNED_OUT_KEY); }
  catch (e) { /* 저장이 막혀 있어도 이번 세션 안에서는 아래 로직이 그대로 돕니다 */ }
}
function signedOutByUser() {
  try { return localStorage.getItem(SIGNED_OUT_KEY) === '1'; } catch (e) { return false; }
}

await setPersistence(auth, browserLocalPersistence).catch(() => {});
onAuthStateChanged(auth, (user) => {
  const admin = !!user && user.uid === ADMIN_UID;
  authResolved = true;
  if (admin && signedOutByUser()) {
    isAdmin = false;
    notify();
    signOut(auth).catch(() => {});   // 지난번에 못 끝낸 로그아웃을 마저 합니다
    return;
  }
  isAdmin = admin;
  notify();
  /* 로그인은 불러오기보다 늦게 확정될 수 있어, 여기서도 한 번 챙깁니다 */
  if (isAdmin && loaded) ensureBlobIndex().then(collectGarbage);
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
    /* 표시를 먼저 지웁니다 — 로그인 알림은 아래 await 가 끝나기 전에 오기도 해서,
       나중에 지우면 방금 한 로그인을 위 감시가 내쫓아버립니다. */
    markSignedOut(false);
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred.user.uid !== ADMIN_UID) {
      await signOut(auth);
      throw new Error('관리자 계정이 아닙니다.');
    }
    return true;
  },

  /* 나가기 전에 남은 변경분을 저장하되, 저장이 끝나기를 무한정 기다리지는
     않습니다. 쓰기가 밀려 있으면(오프라인이거나 대기열이 막힌 경우)
     flushNow() 가 영영 끝나지 않아 로그아웃 버튼이 아무 반응도 하지 않는
     것처럼 보입니다. 3초만 기다렸다가 그냥 로그아웃합니다. */
  async signOut() {
    /* 표시부터 남깁니다 — 아래에서 무엇이 실패하든, 다음에 열었을 때 저절로
       편집 모드로 돌아가지 않고 위 감시가 로그아웃을 마저 끝냅니다. */
    markSignedOut(true);
    const wait = (ms) => new Promise(res => setTimeout(res, ms));
    await Promise.race([flushNow().catch(() => {}), wait(3000)]);
    /* signOut 자체도 기다려주지 않을 수 있습니다(IndexedDB·네트워크가 막힌 경우).
       화면이 편집 모드에 갇히지 않도록 시간을 두고, 끝나면 어떤 경우든
       보기 모드로 되돌립니다. 서버 권한은 어차피 Firestore 규칙이 봅니다. */
    try { await Promise.race([signOut(auth), wait(4000)]); }
    catch (e) { console.error('로그아웃 처리 중 오류', e); }
    /* isAdmin 이 이미 false 여도 알립니다 — 화면 쪽이 편집 모드에 남아 있을 수
       있고(알림을 놓쳤거나 그리다 걸린 경우), 한 번 더 알리는 것은 해가 없습니다. */
    isAdmin = false;
    notify();
  },

  async load() { await loadAll(); },

  /* ---- 사진 (늦게 도착합니다) ---- */

  /* 그릴 때 blob://<id> 를 실제 사진으로 바꿉니다. 아직 안 왔으면 '' 입니다.
     data URL 이나 보통 문자열은 그대로 돌려줍니다. */
  resolve(value) { return inflate(value); },

  /* 이 값 안의 사진을 전부 받았는지 */
  hasAll(value) { return missingBlobIds(value).length === 0; },

  /* 지금 보는 것부터 먼저 받게 합니다 (기다리지 않습니다) */
  prefetch(value) { wantBlobs(missingBlobIds(value)); },

  /* 이 값 안의 사진이 다 올 때까지 기다립니다.
     편집기처럼 값을 읽어서 도로 저장하는 곳에서만 씁니다 —
     안 받은 채로 저장하면 그 사진이 지워지기 때문입니다.

     다 왔으면 true, 시간 안에 못 받았으면 false 입니다. 부르는 쪽은 false 면
     편집기를 열지 말아야 합니다 — 빈 자리로 그려놓고 저장하는 순간
     그 사진은 영영 사라집니다. */
  ensure(value, timeoutMs = 20000) {
    if (missingBlobIds(value).length === 0) return Promise.resolve(true);
    wantBlobs(missingBlobIds(value));
    return new Promise(res => {
      let off = null;
      const timer = setTimeout(() => finish(false), timeoutMs);
      function finish(ok) { clearTimeout(timer); if (off) off(); res(ok); }
      off = SiteStore.onBlobs(() => { if (missingBlobIds(value).length === 0) finish(true); });
    });
  },

  /* 사진이 도착할 때마다(묶어서) 알립니다: fn(방금 온 id 들의 Set) */
  onBlobs(fn) { blobListeners.add(fn); return () => blobListeners.delete(fn); },

  /* 진행 표시용 — {받은 장수, 받아야 할 장수}.
     사이트 전체가 아니라 '지금 화면이 달라고 한 것' 기준입니다.
     사진을 미리 다 받지 않게 된 뒤로 전체 장수는 표시할 의미가 없습니다 —
     HOME 만 보고 있으면 갤러리 984장은 애초에 부르지도 않습니다. */
  blobStats() {
    const pending = blobQueue.length + blobActive.size;
    return { done: blobCache.size, total: blobCache.size + pending };
  },

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
