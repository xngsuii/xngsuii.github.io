/* ============================================================
   AUTH
   ============================================================ */
/* 로그인 상태는 Firebase Authentication이 관리합니다.
   비밀번호는 코드에 저장하지 않으며, 편집 권한은
   Firestore 보안 규칙이 서버에서 최종 확인합니다. */
let isLoggedIn = false;

/* 한 군데가 터져도 나머지 화면은 계속 그리도록 감쌉니다 —
   예전에 렌더 한 곳이 예외를 내면 그 뒤가 통째로 멈춰 편집 모드에 갇혔습니다. */
function safely(label, fn){
  try{ fn(); }catch(e){ console.error(label+' 그리기 실패', e); }
}
function applyEditMode(){
  document.body.classList.toggle('logged-in', isLoggedIn);
  document.getElementById('loginBadge').innerText = isLoggedIn ? 'UNLOCKED' : 'LOCKED';
  document.getElementById('loginBtn').innerText = isLoggedIn ? '로그아웃' : '로그인';

  document.getElementById('profileName').readOnly = !isLoggedIn;
  document.getElementById('profileBio').readOnly = !isLoggedIn;
  document.getElementById('siteName').readOnly = !isLoggedIn;
  document.getElementById('homeIntro').contentEditable = isLoggedIn ? 'true' : 'false';

  safely('배너', ()=>{ introBannerAdj && introBannerAdj.paint(); });
  /* 보기 모드로 돌아오면 선택 줄이 남아 있으면 안 됩니다 —
     이 줄은 [data-editonly] 이 아니라 JS 가 여닫으므로 여기서 꺼줍니다. */
  safely('선택 모드 해제', ()=>{
    if(isLoggedIn) return;
    selectMode = false; selectedPairIds.clear();
    document.getElementById('selectPairBtn').innerText = '선택';
    document.getElementById('pairSelectBar').style.display = 'none';
    ocSelectMode = false; ocSelectedIds.clear();
  });
  // ＋·✎ 와 끌어서 옮기기는 편집 모드에서만 달리므로 다시 그립니다
  safely('사이드바 분류', renderNavSubs);
  safely('PAIR 목록', renderPairPosts);
  safely('카드', renderCards);
  safely('OC 목록', renderOcPosts);
  safely('ARCHIVE', renderArchive);
  safely('PAIR 상세', ()=>{
    if(!currentPairPostId) return;
    const p = getCurrentPost();
    if(p) fillPairDetail(p);
  });
  safely('OC 상세', ()=>{
    if(!(currentOcId && document.getElementById('modalOcDetail').classList.contains('open'))) return;
    const o = getCurrentOc();
    if(o) fillOcDetail(o);
  });
}

const loginBtnEl = document.getElementById('loginBtn');
loginBtnEl.addEventListener('click', async ()=>{
  if(isLoggedIn){
    /* 저장이 밀려 있으면 몇 초 걸릴 수 있어 버튼을 잠가 둡니다 */
    loginBtnEl.disabled = true;
    const before = loginBtnEl.innerText;
    loginBtnEl.innerText = '로그아웃 중…';
    try{
      await window.SiteStore.signOut();
    }catch(e){
      console.error('로그아웃 실패', e);
      alert('로그아웃하지 못했어요. 잠시 뒤 다시 눌러주세요.');
    }finally{
      loginBtnEl.disabled = false;
      if(loginBtnEl.innerText==='로그아웃 중…') loginBtnEl.innerText = before;
    }
  }
  else{
    document.getElementById('loginId').value='';
    document.getElementById('loginPw').value='';
    document.getElementById('loginError').style.display='none';
    openModal('modalLogin');
  }
});
document.getElementById('loginSubmitBtn').addEventListener('click', async ()=>{
  const email=document.getElementById('loginId').value.trim();
  const pw=document.getElementById('loginPw').value;
  const errEl=document.getElementById('loginError');
  const btn=document.getElementById('loginSubmitBtn');
  errEl.style.display='none';
  btn.disabled=true;
  try{
    await window.SiteStore.signIn(email, pw);
    closeModal('modalLogin');
  }catch(e){
    errEl.innerText = loginErrorMessage(e);
    errEl.style.display='block';
  }finally{
    btn.disabled=false;
  }
});
/* Firebase 오류 코드를 사람이 읽을 수 있는 안내로 바꿉니다 */
function loginErrorMessage(e){
  switch(e && e.code){
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return '이메일 또는 비밀번호가 일치하지 않습니다.';
    case 'auth/invalid-email':
      return '이메일 형식이 올바르지 않습니다.';
    case 'auth/too-many-requests':
      return '시도가 너무 많았습니다. 잠시 후 다시 시도해주세요.';
    case 'auth/network-request-failed':
      return '네트워크 연결을 확인해주세요.';
    case 'auth/unauthorized-domain':
      return '이 주소는 Firebase에 승인되지 않았습니다. 콘솔 > Authentication > 설정 > 승인된 도메인에 추가해주세요.';
    case 'auth/operation-not-allowed':
      return '이메일/비밀번호 로그인이 꺼져 있습니다. 콘솔 > Authentication에서 사용 설정해주세요.';
    default:
      return (e && e.message) || '로그인에 실패했습니다.';
  }
}

['loginId','loginPw'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key==='Enter'){ e.preventDefault(); document.getElementById('loginSubmitBtn').click(); }
  });
});

/* ============================================================
   STORAGE
   ============================================================ */
async function storageGet(key, fallback){
  try{ return window.SiteStore.get(key, fallback); }catch(e){ return fallback; }
}
async function storageSet(key, value){
  try{ await window.SiteStore.set(key, value); }catch(e){ console.error('저장 실패', e); }
}
/* ------------------------------------------------------------
   사진은 화면보다 늦게 도착합니다
   ------------------------------------------------------------
   글·목록만 먼저 받아 곧바로 그리기 때문에(firebase-store.js 참고),
   그리는 시점에는 아직 사진이 안 왔을 수 있습니다. state 에는
   blob://<id> 참조가 그대로 들어 있고 imgUrl() 로 꺼내 씁니다.
   아직이면 빈 문자열이 나오므로 자리만 비워두고, 도착하면
   화면 전체가 아니라 그 요소만 다시 칠합니다 — 전체를 다시 그리면
   글을 쓰던 중이었을 때 커서가 튑니다.
   ------------------------------------------------------------ */
function imgUrl(v){
  if(!v) return '';
  try{ return window.SiteStore.resolve(v); }catch(e){ return v; }
}
function imgReady(v){
  if(!v) return true;
  try{ return window.SiteStore.hasAll(v); }catch(e){ return true; }
}
function prefetchImgs(v){
  try{ window.SiteStore.prefetch(v); }catch(e){}
}
const pendingPaints = [];
function whenImgArrives(v, el, redraw){
  if(imgReady(v)) return;
  prefetchImgs(v);
  // 그리는 함수가 여러 번 불려도 대기표는 하나만 둡니다
  if(pendingPaints.some(p=> p.el===el && p.v===v)) return;
  pendingPaints.push({ v, el, redraw });
}
function flushPendingPaints(){
  for(let i=pendingPaints.length-1; i>=0; i--){
    const p = pendingPaints[i];
    if(p.el && !p.el.isConnected){ pendingPaints.splice(i,1); continue; }   // 이미 사라진 자리
    if(!imgReady(p.v)) continue;
    pendingPaints.splice(i,1);
    try{ p.redraw(); }catch(e){ console.error('사진 다시 칠하기 실패', e); }
  }
}

function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
/* 이미지는 저장 용량을 아끼려고 자동으로 압축합니다.
   (이미지가 아닌 첨부파일은 원본 그대로 유지) */
function fileToDataUrl(file){ return window.SiteStore.compressImage(file); }
function blankImg(){ return {src:'',scale:100,x:50,y:50}; }
function normalizeImg(v){ if(!v) return blankImg(); if(typeof v==='string') return {src:v,scale:100,x:50,y:50}; return v; }
function nowStamp(){ const d=new Date(); const yy=String(d.getFullYear()).slice(-2); const mm=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${yy}.${mm}.${dd}`; }

let state = {
  profile:{ name:'이름', bio:'여기에 소개글을 적어주세요.', photo:'' },
  siteName:'사이트 이름', homeIntro:'', homeBanner: blankImg(),
  cards:[], pairPosts:[], archive:[], archiveSeqCounter:0,
  archiveFolders:[], archiveFoldersOoc:[], archiveFoldersEtc:[], ocPosts:[],
  pairCats:[], ocCats:[]
};

/* ---- PROMPT 폴더 ----
   PAIR_GALLERY 의 폴더와 같은 모양({id,name,secret,pwHash,blur})이지만
   이미지가 아니라 아카이브 글을 담습니다. 글 쪽에 folderId 를 적어두고
   폴더 목록은 따로 저장합니다(개수가 적어 스칼라 키로 충분).
   기본 폴더 id 는 갤러리의 'default' 와 겹치지 않게 다른 이름을 씁니다 —
   비밀 폴더 열람 기록(unlockedFolders)을 두 곳이 함께 쓰기 때문입니다. */
const ARC_DEFAULT_FOLDER = 'arcdefault';
/* 세부 카테고리(OOC·PROMPT·ETC)마다 폴더 목록을 따로 둡니다 — 담기는 글이
   서로 다르니 폴더도 섞이면 안 됩니다. PROMPT 는 먼저 있던 키를 그대로 씁니다. */
const ARC_FOLDER_KEY = { ooc:'archiveFoldersOoc', nai:'archiveFolders', etc:'archiveFoldersEtc' };
const ARC_DEFAULT_FOLDER_ID = { ooc:'arcoocdefault', nai:ARC_DEFAULT_FOLDER, etc:'arcetcdefault' };
function arcFoldersOf(cat){
  const key = ARC_FOLDER_KEY[cat] || ARC_FOLDER_KEY.ooc;
  if(!Array.isArray(state[key]) || !state[key].length){
    state[key] = normalizeArcFolders(null, ARC_DEFAULT_FOLDER_ID[cat]);
  }
  return state[key];
}
function setArcFolders(cat, list){ state[ARC_FOLDER_KEY[cat] || ARC_FOLDER_KEY.ooc] = list; }
function saveArcFolders(cat){ return storageSet(ARC_FOLDER_KEY[cat] || ARC_FOLDER_KEY.ooc, arcFoldersOf(cat)); }
function normalizeArcFolders(list, defaultId){
  const out = Array.isArray(list) ? list.slice() : [];
  if(!out.length){
    out.push({ id: defaultId || ARC_DEFAULT_FOLDER, name:'기본' });
  }
  out.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    if(f.blur   == null) f.blur   = false;
  });
  return out;
}
/* ---- OC 폴더 ----
   PROMPT 폴더와 같은 모양이지만 '썸네일 흐리게'는 쓰지 않고 비밀 폴더만 씁니다.
   카테고리마다 다른 폴더를 가질 수 있어(아래 normalizeOcCats 참고),
   이 목록은 전역이 아니라 카테고리 객체 하나(cat.folders)에 딸립니다. */
const OC_DEFAULT_FOLDER = 'ocdefault';
function normalizeOcFolders(list){
  const out = Array.isArray(list) ? list.slice() : [];
  if(!out.length){
    out.push({ id:OC_DEFAULT_FOLDER, name:'기본' });
  }
  out.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    f.blur = false;
  });
  return out;
}
/* ---- 사이드바 세부 카테고리 (PAIR · OC 공용) ----
   `[{id, name}]` 목록이고, 글 쪽에는 그 id 가 `type` 으로 적힙니다.
   PAIR 은 맨 위에 '전체' 가 있어 — 카테고리를 지워도 그 안의 글은
   카테고리 없이 남아 '전체'에서만 보입니다(글 자체는 지우지 않습니다).
   PAIR 의 aichat/dream 은 이미 저장된 글이 가리키고 있는 id 라 그대로 둡니다.

   OC 는 '전체' 가 없어(목록이 카테고리별 폴더까지 갈라지므로 '전체'가
   여러 폴더 체계를 한꺼번에 보여줘야 해서 의미가 없습니다) 카테고리가
   최소 1개 있어야 화면을 그릴 수 있습니다 — normalizeOcCats() 가 그 자리를
   보장합니다. 첫 도입 시점에는 그 하나의 카테고리가 예전의 전역 OC 폴더
   목록(legacyFolders)을 그대로 이어받습니다. */
const PAIR_DEFAULT_CATS = [{ id:'aichat', name:'Ai chat' }, { id:'dream', name:'Dream' }];
const OC_DEFAULT_CAT = 'occdefault';
function normalizeCats(list, fallback){
  if(!Array.isArray(list)) return (fallback||[]).map(c=>({ ...c }));
  return list.filter(c=> c && c.id).map(c=> ({ ...c, id:String(c.id), name: c.name || '이름 없음' }));
}
function normalizeOcCats(list, legacyFolders){
  const out = normalizeCats(list, []);
  if(!out.length){
    out.push({ id:OC_DEFAULT_CAT, name:'기본', folders: normalizeOcFolders(legacyFolders) });
  }
  out.forEach(c=>{ if(!Array.isArray(c.folders)) c.folders = normalizeOcFolders(null); });
  return out;
}
/* 글이 가리키는 카테고리 이름. 지워진 카테고리를 가리키고 있으면 빈 문자열 */
function catName(list, id){
  const c = list.find(x=> x.id === id);
  return c ? c.name : '';
}
function ocCatOf(id){
  return state.ocCats.find(c=>c.id===id) || state.ocCats[0];
}
function ocFoldersOf(catId){
  const cat = ocCatOf(catId);
  if(!Array.isArray(cat.folders)) cat.folders = normalizeOcFolders(null);
  return cat.folders;
}
function ocFolderIdOf(item){
  const cat = ocCatOf(item.type);
  const folders = ocFoldersOf(cat.id);
  const fallback = folders[0] ? folders[0].id : OC_DEFAULT_FOLDER;
  const id = item.folderId || fallback;
  return folders.some(f=>f.id===id) ? id : fallback;
}

/* OC 글 한 건의 기본 모양을 채웁니다 (예전 데이터에 빠진 항목도 여기서 메꿉니다) */
function migrateOcPost(o){
  /* 이름·부제목은 비워 둡니다 — 입력칸의 안내 문구(placeholder)만 보이고,
     쓰는 사람이 예시 글자를 지울 필요가 없습니다. */
  if(o.title == null) o.title = '';
  if(o.subtitle == null) o.subtitle = '';
  o.headerImage = normalizeImg(o.headerImage);
  o.sideImage   = normalizeImg(o.sideImage);
  o.profile = o.profile || {};
  if(o.profile.name == null) o.profile.name = '';
  if(o.profile.subtitle == null) o.profile.subtitle = '';
  if(o.profile.intro == null) o.profile.intro = '';
  if(o.profile.metaHtml == null) o.profile.metaHtml = '';
  o.profile.image = normalizeImg(o.profile.image);
  if(o.quote == null) o.quote = '';
  migrateThemeSongs(o);
  if(!Array.isArray(o.keywords) || o.keywords.length !== 3) o.keywords = ['','',''];
  if(o.freeText == null) o.freeText = '';
  /* 사이드바 세부 카테고리 — 실제로 존재하는 카테고리로 맞추는 일은
     loadState() 가 카테고리 목록을 다 읽은 뒤에 한 번에 합니다(아래 참고). */
  if(o.type == null) o.type = '';
  if(!o.folderId) o.folderId = OC_DEFAULT_FOLDER;
  o.log = o.log || [];
  migrateGalleryFolders(o);   // 갤러리 폴더 구조는 PAIR 과 똑같이 씁니다
  migrateLog(o);
  return o;
}

/* 로그인 상태는 데이터를 불러오기 전에 먼저 확정될 수 있고, 그때 applyEditMode 가
   renderArchive / renderOcPosts 를 부릅니다. 폴더·카테고리 목록이 비어 있으면
   찾지 못해 터지므로, 기본값을 미리 넣어둡니다. */
state.archiveFolders    = normalizeArcFolders(null, ARC_DEFAULT_FOLDER_ID.nai);
state.archiveFoldersOoc = normalizeArcFolders(null, ARC_DEFAULT_FOLDER_ID.ooc);
state.archiveFoldersEtc = normalizeArcFolders(null, ARC_DEFAULT_FOLDER_ID.etc);
state.ocCats = normalizeOcCats(null, null);

/* 글이 가리키는 폴더가 지워졌으면 그 글이 속한 카테고리의 첫 폴더로 봅니다 */
function arcFolderIdOf(item){
  const folders = arcFoldersOf(item.category || 'ooc');
  const fallback = folders[0] ? folders[0].id : ARC_DEFAULT_FOLDER;
  const id = item.folderId || fallback;
  return folders.some(f=>f.id===id) ? id : fallback;
}

function migrateCard(c){
  if(typeof c.image==='string' || !c.image) c.image = normalizeImg(c.image);
  return c;
}
function splitLegacyIntro(obj){
  // 라벨(meta-row)과 본문이 하나의 contenteditable에 뒤섞여 있던 구버전 데이터를
  // 라벨 컨테이너(metaHtml) / 본문(intro) 두 필드로 분리 마이그레이션
  if(obj.metaHtml !== undefined) return;
  const temp = document.createElement('div');
  temp.innerHTML = obj.intro || '';
  const metaDiv = document.createElement('div');
  let node = temp.firstChild;
  while(node && node.nodeType===1 && node.classList && node.classList.contains('meta-row')){
    const next = node.nextSibling;
    metaDiv.appendChild(node);
    node = next;
  }
  obj.metaHtml = metaDiv.innerHTML;
  obj.intro = temp.innerHTML;
}
function migratePost(old){
  if(old.char && old.persona) { // already new shape
    old.headerImage = normalizeImg(old.headerImage);
    old.char.image = normalizeImg(old.char.image);
    old.persona.image = normalizeImg(old.persona.image);
    old.char.keywords = old.char.keywords && old.char.keywords.length===3 ? old.char.keywords : defaultKw();
    old.persona.keywords = old.persona.keywords && old.persona.keywords.length===3 ? old.persona.keywords : defaultKw();
    if(old.relLabelCharToPersona===undefined) old.relLabelCharToPersona='Relationship';
    if(old.relLabelPersonaToChar===undefined) old.relLabelPersonaToChar='Relationship';
    if(old.char.subtitle == null) old.char.subtitle = '';
    if(old.persona.subtitle == null) old.persona.subtitle = '';
    old.sideImage = normalizeImg(old.sideImage);
    migrateThemeSongs(old);
    migrateMessages(old);
    splitLegacyIntro(old.char);
    splitLegacyIntro(old.persona);
    migrateGalleryFolders(old);
    migrateLog(old);
    return old;
  }
  const migrated = {
    id: old.id, type: old.type, title: old.title||'',
    headerImage: normalizeImg(old.thumb),
    char:{ name:'', subtitle:'', gender:'', age:'', height:'', keywords:defaultKw(), intro: old.charProfile||'', metaHtml:'', image: normalizeImg(old.charImg) },
    persona:{ name:'', subtitle:'', gender:'', age:'', height:'', keywords:defaultKw(), intro: old.personaProfile||'', metaHtml:'', image: normalizeImg(old.personaImg) },
    relCharToPersona:'', relPersonaToChar:'',
    relLabelCharToPersona:'', relLabelPersonaToChar:'',
    log: old.log||[], gallery: old.gallery||[], timeline: old.timeline||[]
  };
  splitLegacyIntro(migrated.char);
  splitLegacyIntro(migrated.persona);
  migrateGalleryFolders(migrated);
  migrateLog(migrated);
  migrated.sideImage = normalizeImg(migrated.sideImage);
  migrateThemeSongs(migrated);
  migrateMessages(migrated);
  return migrated;
}
/* 테마곡 목록의 기본 모양 (PAIR·OC 공용) */
function migrateThemeSongs(obj){
  if(!Array.isArray(obj.themeSongs)) obj.themeSongs = [];
  obj.themeSongs.forEach(s=>{
    if(s.id==null) s.id = Date.now()+Math.floor(Math.random()*1000);
    if(s.title==null) s.title='';
    if(s.artist==null) s.artist='';
    if(s.lyrics==null) s.lyrics='';
    if(s.cover==null) s.cover='';
  });
}
/* 메시지(말풍선) 목록의 기본 모양 */
function migrateMessages(obj){
  if(!Array.isArray(obj.messages)) obj.messages = [];
  obj.messages.forEach(m=>{
    if(m.id==null) m.id = Date.now()+Math.floor(Math.random()*1000);
    if(m.side!=='persona') m.side='char';
    if(m.text==null) m.text='';
    if(!Array.isArray(m.images)) m.images=[];
    if(m.images.length>1) m.images = m.images.slice(0,1);   // 한 말풍선에 사진 한 장
    delete m.files;                                        // 파일 첨부는 쓰지 않습니다
  });
}
/* ---- LOG 폴더 ----
   갤러리 폴더와 같은 모양이고, 갤러리처럼 글 하나에 딸립니다(p.logFolders).
   담기는 것이 이미지가 아니라 글이라 '썸네일 흐리게'는 쓰지 않고,
   글 쪽에 folderId 를 적어둡니다. 기본 폴더 id 는 다른 폴더들과 겹치지
   않게 따로 씁니다 — 비밀 폴더 열람 기록(unlockedFolders)을 다 같이 쓰기 때문입니다. */
const LOG_DEFAULT_FOLDER = 'logdefault';
function migrateLog(p){
  let seed = Date.now();
  (p.log||[]).forEach(entry=>{ if(entry.id==null){ entry.id = seed++; } });
  if(!Array.isArray(p.logFolders) || p.logFolders.length===0){
    p.logFolders = [{ id:LOG_DEFAULT_FOLDER, name:'기본' }];
  }
  p.logFolders.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    f.blur = false;
  });
}
/* 글이 가리키는 폴더가 지워졌으면 남아 있는 첫 폴더로 봅니다 */
function logFolderIdOf(p, entry){
  const folders = p.logFolders || [];
  const fallback = folders[0] ? folders[0].id : LOG_DEFAULT_FOLDER;
  const id = entry.folderId || fallback;
  return folders.some(f=>f.id===id) ? id : fallback;
}
function migrateGalleryFolders(p){
  if(!p.galleryFolders || p.galleryFolders.length===0){
    p.galleryFolders = [{ id:'default', name:'기본', images: p.gallery||[] }];
  }
  // 비밀 폴더 / 썸네일 흐리게 옵션은 나중에 추가된 항목이라 기본값을 채워둔다
  p.galleryFolders.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    if(f.blur   == null) f.blur   = false;
    if(!Array.isArray(f.images)) f.images = [];
    /* 예전에 폴더로 끌어다 놓을 때 생기던 빈 칸(썸네일만 남고 그림이 없던 것)을
       불러오면서 걷어냅니다. 지금은 만들어지지 않지만 이미 저장된 것이 있습니다. */
    else if(f.images.some(src=> typeof src !== 'string' || !src)){
      f.images = f.images.filter(src=> typeof src === 'string' && src);
    }
  });
}
/* 예시 글자는 값이 아니라 자리 표시로 둡니다 — 지우고 다시 쓸 필요가 없게 */
function defaultKw(){ return [{text:'',color:'#4b4bff'},{text:'',color:'#4b4bff'},{text:'',color:'#4b4bff'}]; }
function migrateArchiveItem(item){
  if(item.title!==undefined && item.date!==undefined && item.kind===undefined){
    if(!item.category) item.category='ooc';
    return item;
  }
  let content = item.content||'';
  if(item.kind==='image'){ content = `<img src="${item.content}" />${item.caption?`<div>${escapeHtml(item.caption)}</div>`:''}`; }
  else if(item.kind==='html'){ content = `<pre><code>${escapeHtml(item.content)}</code></pre>`; }
  else if(item.kind==='text'){ content = escapeHtml(item.content).replace(/\n/g,'<br>'); }
  return { id:item.id, category:'ooc', title: item.kind ? `(${item.kind}) 이전 항목` : (item.title||'제목 없음'), content, date: item.date||'' };
}

async function loadState(){
  state.profile   = await storageGet('profile', state.profile);
  state.siteName  = await storageGet('siteName', state.siteName);
  state.homeIntro = await storageGet('homeIntro', '');
  state.homeBanner= normalizeImg(await storageGet('homeBanner', null));
  state.cards     = (await storageGet('cards', [])).map(migrateCard);
  state.pairPosts = (await storageGet('pairPosts', [])).map(migratePost);
  state.archive   = (await storageGet('archive', [])).map(migrateArchiveItem);
  state.archiveFolders    = normalizeArcFolders(await storageGet('archiveFolders', null),    ARC_DEFAULT_FOLDER_ID.nai);
  state.archiveFoldersOoc = normalizeArcFolders(await storageGet('archiveFoldersOoc', null), ARC_DEFAULT_FOLDER_ID.ooc);
  state.archiveFoldersEtc = normalizeArcFolders(await storageGet('archiveFoldersEtc', null), ARC_DEFAULT_FOLDER_ID.etc);
  /* 처음 열 때는 예전부터 있던 Ai chat / Dream 을 그대로 씁니다.
     OC 는 카테고리가 하나 있어야 하므로, 카테고리 개념이 생기기 전
     전역으로 저장돼 있던 OC 폴더 목록(ocFolders)을 그 첫 카테고리가 이어받습니다 —
     그래야 이미 만들어둔 폴더가 사라지지 않습니다. */
  state.pairCats = normalizeCats(await storageGet('pairCats', null), PAIR_DEFAULT_CATS);
  state.ocCats = normalizeOcCats(await storageGet('ocCats', null), await storageGet('ocFolders', null));
  state.ocPosts = (await storageGet('ocPosts', [])).map(migrateOcPost);
  /* 카테고리가 이제 필수라, 없어졌거나 유효하지 않은 카테고리를 가리키는 글은
     첫 카테고리로 보냅니다(글 자체는 그대로 둡니다). */
  {
    const ocCatIds = new Set(state.ocCats.map(c=>c.id));
    state.ocPosts.forEach(o=>{ if(!ocCatIds.has(o.type)) o.type = state.ocCats[0].id; });
  }
  state.archiveSeqCounter = await storageGet('archiveSeqCounter', 0);
  let maxSeq = 0;
  state.archive.forEach(item=>{ if(item.seq==null){ maxSeq++; item.seq = maxSeq; } else if(item.seq>maxSeq){ maxSeq=item.seq; } });
  if(state.archiveSeqCounter < maxSeq){
    state.archiveSeqCounter = maxSeq;
    await storageSet('archiveSeqCounter', state.archiveSeqCounter);
    await storageSet('archive', state.archive);
  }
  renderAll();
}

function renderAll(){
  document.getElementById('profileName').value = state.profile.name;
  document.getElementById('profileBio').value = state.profile.bio;
  document.getElementById('siteName').value = state.siteName;
  document.getElementById('homeIntro').innerText = state.homeIntro;
  renderNavSubs();
  renderCards();
  renderPairPosts();
  renderOcPosts();
  renderArchive();
  applyEditMode();
}

/* ============================================================
   THUMBNAIL DOWNSCALE CACHE
   원본은 830~1800px인데 갤러리 썸네일 박스는 124px, 프로필은 144px이다.
   브라우저는 이런 큰 배율(5~7배)의 축소를 한 번에 처리하면서 단순 필터를 써
   계단 현상이 생긴다. 캔버스에서 2배씩 나눠 줄이면 픽셀이 평균화되어 매끄럽다.
   표시용으로만 쓰고 저장값(state)은 항상 원본을 유지한다.
   ============================================================ */
const thumbCache = new Map();   // src(원본 문자열 참조) -> Map(bucket -> 축소본)
const THUMB_BUCKET = 64;        // 캐시 항목이 무한정 늘지 않도록 목표 크기를 64px 단위로 묶는다

function thumbRemember(src, bucket, val){
  if(thumbCache.size > 300) thumbCache.clear();   // 오래 보다가 무한정 쌓이는 것 방지
  let slot = thumbCache.get(src);
  if(!slot){ slot = new Map(); thumbCache.set(src, slot); }
  slot.set(bucket, val);   // null(=원본 사용)도 기억해야 확대/드래그 중 매번 다시 디코딩하지 않는다
  return val;
}

function downscaleThumb(src, wantPx){
  // 실제 필요한 픽셀 = 표시 폭 × 화면 배율, 여기에 창 크기 변화 대비 25% 여유
  const need = wantPx * (window.devicePixelRatio||1) * 1.25;
  const bucket = Math.max(THUMB_BUCKET, Math.ceil(need/THUMB_BUCKET)*THUMB_BUCKET);
  const per = thumbCache.get(src);
  if(per && per.has(bucket)) return Promise.resolve(per.get(bucket));
  return new Promise(resolve=>{
    const img = new Image();
    img.onload = ()=>{
      let w = img.naturalWidth, h = img.naturalHeight;
      // 축소 폭이 크지 않으면 원본이 더 낫다
      if(Math.min(w,h) <= bucket*1.25){ resolve(thumbRemember(src, bucket, null)); return; }
      let cur = img;
      const step = (tw,th)=>{
        const cv = document.createElement('canvas');
        cv.width = tw; cv.height = th;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = true;
        cx.imageSmoothingQuality = 'high';
        cx.drawImage(cur, 0, 0, tw, th);
        cur = cv; w = tw; h = th;
      };
      while(Math.min(w,h)/2 >= bucket) step(Math.round(w/2), Math.round(h/2));
      const ratio = bucket/Math.min(w,h);
      if(ratio < 1) step(Math.max(1,Math.round(w*ratio)), Math.max(1,Math.round(h*ratio)));
      let out;
      try{ out = cur.toDataURL('image/jpeg', 0.9); }catch(e){ resolve(thumbRemember(src, bucket, null)); return; }
      resolve(thumbRemember(src, bucket, out));
    };
    img.onerror = ()=> resolve(null);
    img.src = src;
  });
}

/* 원본을 먼저 깔고, 축소본이 준비되면 교체한다(첫 렌더만 비동기, 이후 캐시 즉시 반영)
   boxPx를 생략하면 요소의 실제 폭을 재서 쓴다. 숨은 화면(다른 뷰/닫힌 모달)에서는
   폭이 0이라 판단할 수 없으므로 폭이 잡히는 시점까지만 짧게 다시 시도한다. */
let thumbToken = 0;
function applyThumbBg(el, src, boxPx){
  if(!src) return;
  /* 아직 안 받은 사진이면 자리만 두고, 도착하면 그때 칠한다 */
  const full = imgUrl(src);
  if(!full){ whenImgArrives(src, el, ()=> applyThumbBg(el, src, boxPx)); return; }
  const px = boxPx || el.clientWidth;
  if(!px){
    el._thumbTries = (el._thumbTries||0) + 1;
    if(el._thumbTries <= 20) setTimeout(()=>{ if(el.isConnected) applyThumbBg(el, src); }, 32);
    return;
  }
  el._thumbTries = 0;
  // dataset이 아니라 JS 속성 — data URL을 DOM 속성에 쓰면 안 된다
  el._thumbFor = full;
  const token = el._thumbToken = ++thumbToken;
  downscaleThumb(full, px).then(url=>{
    if(!el.isConnected) return;
    // 그 사이 다시 렌더/확대된 경우(늦게 도착한 이전 요청) 무시
    if(el._thumbFor !== full || el._thumbToken !== token) return;
    /* 축소본이 없으면(=원본이 이미 충분히 작으면) 원본을 그대로 깐다.
       예전에는 아무것도 하지 않아, 부르는 쪽이 미리 깔아두지 않은 자리는
       빈 칸으로 남았다 — 사진이 늦게 오는 지금은 그 경우가 실제로 생긴다. */
    el.style.backgroundImage = `url('${url || full}')`;
  });
}

/* ---- 목록 썸네일 위치 조정 (PAIR · OC · PROMPT 공용) ----
   선택 모드에서 ✥ 를 누르면 그 썸네일만 끌어서 보이는 자리를 옮깁니다.
   글 순서와는 상관없고, 저장되는 것은 item.thumbPos = {x,y} (% 단위)뿐입니다.
   갤러리 썸네일은 대상이 아닙니다. */
let panningThumbEl = null;
function thumbPosOf(item){
  if(!item.thumbPos || typeof item.thumbPos.x!=='number') item.thumbPos = { x:50, y:50 };
  return item.thumbPos;
}
function applyThumbPos(el, item){
  const pos = thumbPosOf(item);
  el.style.backgroundPosition = pos.x+'% '+pos.y+'%';
}
/* card: 카드 요소, imgEl: 배경을 그리는 요소, item: 글, save: 저장 함수 */
function addThumbPanControl(card, imgEl, item, save){
  if(!isLoggedIn || !imgEl) return;
  const btn=document.createElement('button');
  btn.type='button'; btn.className='thumb-pan-btn'; btn.title='이미지 위치 조정';
  btn.innerText='✥';
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    const on = !card.classList.contains('thumb-panning');
    stopThumbPan();
    if(on){
      card.classList.add('thumb-panning');
      btn.classList.add('on');
      panningThumbEl = card;
    }
  });
  card.appendChild(btn);

  /* 조정 중에는 카드 클릭(선택 토글)이 아니라 끌기로 동작합니다 */
  let dragging=false, sx=0, sy=0, ox=50, oy=50;
  const down=(e)=>{
    if(!card.classList.contains('thumb-panning')) return;
    if(e.target.closest('.thumb-pan-btn')) return;
    e.preventDefault(); e.stopPropagation();
    const pos=thumbPosOf(item);
    dragging=true; sx=e.clientX; sy=e.clientY; ox=pos.x; oy=pos.y;
    try{ card.setPointerCapture(e.pointerId); }catch(_){}   // 캡처 실패는 무시(끌기는 그대로 동작)
  };
  const move=(e)=>{
    if(!dragging) return;
    const rect=imgEl.getBoundingClientRect();
    const pos=thumbPosOf(item);
    pos.x = clamp(ox - ((e.clientX-sx)/Math.max(1,rect.width))*100, 0, 100);
    pos.y = clamp(oy - ((e.clientY-sy)/Math.max(1,rect.height))*100, 0, 100);
    applyThumbPos(imgEl, item);
  };
  const up=async ()=>{ if(!dragging) return; dragging=false; await save(); };
  /* PROMPT 썸네일은 이미지 위에 '커서를 올리면 어두워지는 덮개'가 깔려 있어
     이미지 자체는 포인터를 받지 못합니다. 그래서 카드에 겁니다(거리 계산만
     이미지 칸 기준). PAIR·OC 도 같은 방식이라 동작이 통일됩니다. */
  card.addEventListener('pointerdown', down);
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', up);
  card.addEventListener('pointercancel', up);
  /* 조정 중에는 카드 클릭이 선택 토글로 새지 않게 막습니다 */
  card.addEventListener('click', (e)=>{
    if(card.classList.contains('thumb-panning') && !e.target.closest('.thumb-pan-btn')){
      e.stopPropagation();
    }
  }, true);
}
function stopThumbPan(){
  document.querySelectorAll('.thumb-panning').forEach(el=> el.classList.remove('thumb-panning'));
  document.querySelectorAll('.thumb-pan-btn.on').forEach(el=> el.classList.remove('on'));
  panningThumbEl = null;
}

/* ============================================================
   REUSABLE ADJUSTABLE IMAGE COMPONENT
   ============================================================ */
/* 그림의 원래 가로세로 비를 기억해 둡니다 (칸을 꽉 채우는 배율 계산용) */
const imgRatioCache = new Map();
function imageRatio(src){
  if(!src) return Promise.resolve(null);
  if(imgRatioCache.has(src)) return Promise.resolve(imgRatioCache.get(src));
  return new Promise(res=>{
    const im=new Image();
    im.onload=()=>{ const r = im.naturalHeight ? im.naturalWidth/im.naturalHeight : null;
      imgRatioCache.set(src, r); res(r); };
    im.onerror=()=>{ imgRatioCache.set(src, null); res(null); };
    im.src=src;
  });
}
/* 확대 0(=100%)일 때 칸에 여백이 남지 않도록, 짧은 쪽을 기준으로 채우는 배율.
   background-size 를 '너비 %' 로 주고 있으므로 그 % 를 돌려줍니다. */
function coverPercent(container, src){
  const r = imgRatioCache.get(src);
  if(!r) return 100;
  const cw = container.clientWidth, ch = container.clientHeight;
  if(!cw || !ch) return 100;
  const boxRatio = cw/ch;
  return r > boxRatio ? (r/boxRatio)*100 : 100;
}

function createAdjustable(container, getObj, setObj, opts={}){
  const layer = container.querySelector('.adj-layer');
  const emptyBtn = container.querySelector('.adj-empty');
  const changeBtn = container.querySelector('.adj-change');
  let dragging=false, startX,startY,startPX,startPY, panelEl=null;

  // 모달 안의 박스는 닫혀 있을 때 clientWidth가 0이라 어느 크기의 축소본이 필요한지 알 수 없다.
  // 폭이 잡히는 프레임까지만 짧게 다시 시도한다.
  // requestAnimationFrame은 탭이 백그라운드면 아예 실행되지 않으므로 setTimeout을 쓴다
  let thumbRetries = 0;
  function retryThumbWhenSized(){
    if(thumbRetries > 20) return;
    thumbRetries++;
    setTimeout(()=>{
      if(container.clientWidth) paint();
      else retryThumbWhenSized();
    }, 32);
  }

  function paint(){
    const o = getObj() || blankImg();
    /* 사진이 아직 안 왔으면 자리만 비워두고 기다립니다.
       확대·위치는 o 에 그대로 있으므로 도착하면 한 번에 제자리로 그려집니다. */
    const full = o.src ? imgUrl(o.src) : '';
    if(o.src && !full){
      layer.style.backgroundImage = '';
      layer.style.visibility = 'hidden';
      if(emptyBtn) emptyBtn.style.display='none';
      if(changeBtn) changeBtn.style.display = isLoggedIn?'flex':'none';
      whenImgArrives(o.src, container, paint);
      return;
    }
    if(o.src){
      layer.style.backgroundImage = `url(${full})`;
      /* 확대가 0(100%)일 때는 CSS 의 cover 에 맡깁니다 — % 로 계산하면
         칸 크기가 소수점일 때 1px 안팎이 모자라 한쪽에 흰 줄이 남습니다.
         확대한 뒤에만 '꽉 채우는 크기 x 배율' 로 키웁니다. */
      const scale = o.scale || 100;
      /* 사진을 넣을 때 적어둔 비율이 있으면 그대로 씁니다 —
         비율을 다시 재는 동안 확대 전 크기로 한 번 그려지는 것을 막습니다. */
      if(o.ratio && !imgRatioCache.has(full)) imgRatioCache.set(full, o.ratio);
      const known = imgRatioCache.has(full);
      if(!known){
        imageRatio(full).then(r=>{
          if(r && !o.ratio){ o.ratio = r; }   // 다음 번엔 기다리지 않도록 적어둡니다
          if(container.isConnected) paint();
        });
      }
      const cover = coverPercent(container, full);
      const useCover = (scale <= 100) || !known;
      const fill = cover * (scale/100);
      /* 확대해 둔 사진인데 비율을 아직 모르면, 잠깐 확대 안 된 크기로 그렸다가
         곧바로 커지는 것이 눈에 띕니다. 비율이 올 때까지 감춰 둡니다
         (사진은 이미 메모리에 있어 보통 한 프레임 안에 끝납니다). */
      layer.style.visibility = (scale > 100 && !known) ? 'hidden' : '';
      // background-size가 컨테이너 기준 %라서 축소본으로 바꿔도 확대/위치 값은 그대로 유효하다
      const needPx = (container.clientWidth||0) * (useCover ? cover/100 : fill/100);
      if(needPx){ thumbRetries = 0; applyThumbBg(layer, o.src, needPx); }
      else retryThumbWhenSized();
      layer.style.backgroundSize = useCover ? 'cover' : (fill.toFixed(2)+'% auto');
      layer.style.backgroundPosition = (o.x!=null?o.x:50)+'% '+(o.y!=null?o.y:50)+'%';
      if(emptyBtn) emptyBtn.style.display='none';
      if(changeBtn) changeBtn.style.display = isLoggedIn?'flex':'none';
    }else{
      layer.style.backgroundImage='';
      layer.style.visibility='';
      if(emptyBtn) emptyBtn.style.display = isLoggedIn?'flex':'none';
      if(changeBtn) changeBtn.style.display='none';
    }
  }

  function pickFile(autoAdjust){
    const input = document.createElement('input');
    input.type='file'; input.accept='image/*';
    input.onchange = async ()=>{
      const f = input.files[0]; if(!f) return;
      const url = await fileToDataUrl(f);
      // 비율을 미리 재 두면 다음에 열 때 확대 크기를 바로 잡을 수 있습니다
      const ratio = await imageRatio(url);
      const o = { src:url, scale:100, x:50, y:50, ratio: ratio || null };
      setObj(o); paint();
      if(autoAdjust) openPanel();
    };
    input.click();
  }

  function positionPanel(){
    if(!panelEl) return;
    const rect = container.getBoundingClientRect();
    panelEl.style.left = rect.left+'px';
    panelEl.style.top = (rect.bottom+6)+'px';
    panelEl.style.width = rect.width+'px';
  }

  function openPanel(){
    if(!isLoggedIn) return;
    const o = getObj();
    if(!o || !o.src) return;
    closePanel();
    container.classList.add('adjust-active');
    if(opts.onAdjustToggle) opts.onAdjustToggle(true);
    panelEl = document.createElement('div');
    panelEl.className='adj-panel adj-panel-floating';
    panelEl.innerHTML = `<input type="range" min="100" max="300" value="${o.scale||100}" class="adj-range"><button type="button" class="adj-done">완료</button>`;
    document.body.appendChild(panelEl);
    positionPanel();
    window.addEventListener('scroll', positionPanel, true);
    window.addEventListener('resize', positionPanel);
    panelEl.querySelector('.adj-range').addEventListener('input', (e)=>{
      const cur=getObj(); cur.scale=Number(e.target.value); setObj(cur); paint();
    });
    panelEl.querySelector('.adj-done').addEventListener('click',(e)=>{ e.stopPropagation(); closePanel(); });
  }
  function closePanel(){
    container.classList.remove('adjust-active');
    if(opts.onAdjustToggle) opts.onAdjustToggle(false);
    window.removeEventListener('scroll', positionPanel, true);
    window.removeEventListener('resize', positionPanel);
    if(panelEl){ panelEl.remove(); panelEl=null; }
  }

  container.addEventListener('dblclick', (e)=>{
    if(!isLoggedIn) return;
    e.stopPropagation(); e.preventDefault();
    if(container.classList.contains('adjust-active')) closePanel(); else openPanel();
  });
  layer.addEventListener('mousedown', (e)=>{
    if(!isLoggedIn || !container.classList.contains('adjust-active')) return;
    e.preventDefault(); dragging=true;
    const o=getObj(); startX=e.clientX; startY=e.clientY; startPX=o.x!=null?o.x:50; startPY=o.y!=null?o.y:50;
  });
  window.addEventListener('mousemove',(e)=>{
    if(!dragging) return;
    const rect = container.getBoundingClientRect();
    const dx=e.clientX-startX, dy=e.clientY-startY;
    const o=getObj();
    o.x = clamp(startPX-(dx/rect.width)*100,0,100);
    o.y = clamp(startPY-(dy/rect.height)*100,0,100);
    setObj(o); paint();
  });
  window.addEventListener('mouseup', ()=>{ dragging=false; });

  if(emptyBtn) emptyBtn.addEventListener('click',(e)=>{ e.stopPropagation(); pickFile(true); });
  if(changeBtn) changeBtn.addEventListener('click',(e)=>{ e.stopPropagation(); pickFile(true); });

  paint();
  return { paint };
}

/* ============================================================
   NAV
   ============================================================ */
const navItems = document.querySelectorAll('.nav-item');
const pairSub = document.getElementById('pairSub');
const ocSub = document.getElementById('ocSub');
const archiveSub = document.getElementById('archiveSub');
navItems.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    navItems.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    pairSub.classList.toggle('open', btn.dataset.view==='pair');
    ocSub.classList.toggle('open', btn.dataset.view==='oc');
    archiveSub.classList.toggle('open', btn.dataset.view==='archive');
    /* 큰 메뉴를 누르면 하위 카테고리는 늘 첫 항목으로 돌아갑니다 */
    if(btn.dataset.view==='pair'){
      currentPairFilter=defaultCatId(PAIR_CAT_NAV);
      pairPage=1;
      selectMode=false; selectedPairIds.clear();
      document.getElementById('selectPairBtn').innerText='선택';
      document.getElementById('pairSelectBar').style.display='none';
      PAIR_CAT_NAV.adding=false;
      PAIR_CAT_NAV.title(catTitle(PAIR_CAT_NAV, currentPairFilter));
      renderNavSub(PAIR_CAT_NAV);
      renderPairPosts();
    }
    if(btn.dataset.view==='oc'){
      currentOcFilter=defaultCatId(OC_CAT_NAV);
      ocPage=1; ocSelectMode=false; ocSelectedIds.clear();
      OC_CAT_NAV.adding=false;
      OC_CAT_NAV.title(catTitle(OC_CAT_NAV, currentOcFilter));
      renderNavSub(OC_CAT_NAV);
      renderOcPosts();
    }
    if(btn.dataset.view==='archive'){
      currentArchiveCategory='nai';
      document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.toggle('active', b.dataset.archivesub==='nai'));
      arcPage=1;
      arcUnblurred.clear();
      arcSelectedIds.clear();   // 카테고리를 옮기면 골라둔 것도 비웁니다
      renderArchive();
    }
  });
});

/* ------------------------------------------------------------
   PAIR · OC 세부 카테고리
   ------------------------------------------------------------
   사이드바의 '전체 / Ai chat / Dream' 같은 줄입니다. 편집 모드에서
   추가·이름 변경·삭제·순서 변경을 할 수 있어 고정 마크업이 아니라
   목록(state.pairCats / state.ocCats)을 보고 매번 그립니다.

   PAIR 와 OC 가 완전히 같은 코드를 쓰도록, 다른 점은 이 두 묶음에만
   모아 둡니다. 갤러리·LOG 를 host 로 공유하는 것과 같은 방식입니다.

   hasAll — PAIR 는 맨 위에 '전체' 가 있어 카테고리를 몇 개를 지우든
   상관없습니다(지워진 카테고리의 글은 '전체'에서만 보입니다).
   OC 는 '전체' 가 없어(카테고리마다 폴더 체계가 따로 있어 '전체'가
   여러 폴더를 한꺼번에 보여줘야 해서 의미가 없습니다) minCats:1 로
   마지막 하나는 지울 수 없게 막습니다 — catCtx() 의 canDelete 가 봅니다. */
const PAIR_CAT_NAV = {
  view: 'pair',
  hasAll: true,
  minCats: 0,
  subEl: ()=> pairSub,
  cats: ()=> state.pairCats,
  setCats: (v)=>{ state.pairCats = v; },
  save: ()=> storageSet('pairCats', state.pairCats),
  posts: ()=> state.pairPosts,
  savePosts: ()=> storageSet('pairPosts', state.pairPosts),
  newId: ()=> 'pc'+Date.now(),
  title: (name)=>{ document.getElementById('pairTitle').innerText = 'Pair · ' + name; },
  get: ()=> currentPairFilter,
  set: (id)=>{ currentPairFilter = id; pairPage = 1; },
  moveBtns: ()=> document.getElementById('pairMoveBtns'),
  selected: ()=> selectedPairIds,
  rerender: ()=> renderPairPosts()
};
const OC_CAT_NAV = {
  view: 'oc',
  hasAll: false,
  minCats: 1,
  subEl: ()=> ocSub,
  cats: ()=> state.ocCats,
  setCats: (v)=>{ state.ocCats = v; },
  save: ()=> storageSet('ocCats', state.ocCats),
  posts: ()=> state.ocPosts,
  savePosts: ()=> saveOc(),
  newId: ()=> 'occ'+Date.now(),
  newExtra: ()=> ({ folders: normalizeOcFolders(null) }),   // 카테고리마다 자기 폴더 목록을 갖습니다
  title: (name)=>{ const el=document.getElementById('ocTitle'); if(el) el.innerText = 'OC · ' + name; },
  get: ()=> currentOcFilter,
  set: (id)=>{ currentOcFilter = id; ocPage = 1; },
  moveBtns: ()=> document.getElementById('ocMoveBtns'),
  selected: ()=> ocSelectedIds,
  rerender: ()=> renderOcPosts()
};

/* '전체'가 있으면 '전체', 없으면(OC) 첫 카테고리로 */
function defaultCatId(nav){
  if(nav.hasAll) return 'all';
  return nav.cats()[0] ? nav.cats()[0].id : '';
}
/* 사이드바 제목·타이틀에 쓸 이름 */
function catTitle(nav, id){
  if(nav.hasAll && id==='all') return '전체';
  return catName(nav.cats(), id) || (nav.hasAll ? '전체' : (nav.cats()[0] ? nav.cats()[0].name : ''));
}

let draggedCatId = null;

/* 화면만 그 메뉴로 전환합니다(고른 카테고리는 건드리지 않음) —
   '+' 로 새 카테고리를 추가하는 중에 다른 메뉴가 보이면 안 되므로 씁니다. */
function openNavSection(nav){
  navItems.forEach(b=>b.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${nav.view}"]`).classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+nav.view).classList.add('active');
  [pairSub, ocSub, archiveSub].forEach(el=> el.classList.toggle('open', el===nav.subEl()));
}

function renderNavSub(nav){
  const wrap = nav.subEl();
  if(!wrap) return;
  wrap.innerHTML = '';
  const cur = nav.get();

  const addItem = (id, name, fixed)=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-sub-item' + (cur===id ? ' active' : '');
    btn.dataset.catid = id;
    btn.innerHTML = `<span class="ns-name">${escapeHtml(name)}</span>`
      + (fixed ? '' : `<span class="ns-edit" data-editonly title="이름 변경·삭제">✎</span>`);
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(e.target.closest('.ns-edit')){
        if(!isLoggedIn) return;
        openFolderModal(catCtx(nav), nav.cats().find(c=>c.id===id));
        return;
      }
      selectNavSub(nav, id);
    });
    /* '전체'는 늘 맨 위에 있어야 하므로 끌 수 없습니다.
       draggable 만 켜두면 손가락 드래그는 initTouchDrag 가 알아서 처리합니다. */
    if(!fixed && isLoggedIn){
      btn.draggable = true;
      btn.addEventListener('dragstart', ()=>{ draggedCatId = id; btn.classList.add('dragging'); });
      btn.addEventListener('dragend', async ()=>{
        btn.classList.remove('dragging');
        if(!draggedCatId) return;
        draggedCatId = null;
        await nav.save();
      });
      btn.addEventListener('dragover', (e)=>{
        if(!draggedCatId || draggedCatId===id) return;
        e.preventDefault();
        const list = nav.cats();
        const from = list.findIndex(c=>c.id===draggedCatId);
        const to   = list.findIndex(c=>c.id===id);
        if(from<0 || to<0) return;
        const play = flipByKey(wrap, '.nav-sub-item', 'catid');
        list.splice(to, 0, list.splice(from, 1)[0]);
        /* 지나가는 자리마다 실시간으로 밀려나게 합니다(갤러리와 같은 방식).
           다시 그리지 않고 요소만 옮기는 것이 중요합니다 — 끌고 있던 요소를
           지워버리면 dragend 가 오지 않아 순서가 저장되지 않습니다. */
        const dragEl = wrap.querySelector(`.nav-sub-item[data-catid="${draggedCatId}"]`);
        if(dragEl) wrap.insertBefore(dragEl, from < to ? btn.nextSibling : btn);
        play();
      });
    }
    wrap.appendChild(btn);
  };

  if(nav.hasAll) addItem('all', '전체', true);
  nav.cats().forEach(c=> addItem(c.id, c.name, false));

  /* '+' 로 추가하는 중일 때만, 목록 맨 아래에 이름 입력 칸이 뜹니다.
     평소에는 아무 것도 없습니다 — 추가 버튼은 이제 PAIR/OC 메뉴 옆의 '＋' 뿐입니다. */
  if(nav.adding){
    const row = document.createElement('div');
    row.className = 'ns-add-row';
    row.setAttribute('data-editonly', '');
    row.innerHTML = `<input type="text" class="ns-add-input" placeholder="예: Ai chat">`
      + `<button type="button" class="ns-add-ok" title="추가">✓</button>`
      + `<button type="button" class="ns-add-cancel" title="취소">✕</button>`;
    const input = row.querySelector('.ns-add-input');
    const finishAdd = async ()=>{
      const name = input.value.trim();
      if(!name){ input.focus(); return; }
      const created = { id: nav.newId(), name, ...(nav.newExtra ? nav.newExtra() : {}) };
      nav.cats().push(created);
      nav.adding = false;
      await nav.save();
      nav.set(created.id);
      nav.title(created.name);
      renderNavSub(nav);
      nav.rerender();
    };
    const cancelAdd = ()=>{ nav.adding = false; renderNavSub(nav); };
    row.querySelector('.ns-add-ok').addEventListener('click', (e)=>{ e.stopPropagation(); finishAdd(); });
    row.querySelector('.ns-add-cancel').addEventListener('click', (e)=>{ e.stopPropagation(); cancelAdd(); });
    input.addEventListener('click', e=> e.stopPropagation());
    input.addEventListener('keydown', (e)=>{
      if(e.key==='Enter'){ e.preventDefault(); finishAdd(); }
      else if(e.key==='Escape'){ e.preventDefault(); cancelAdd(); }
    });
    wrap.appendChild(row);
  }

  renderMoveBtns(nav);
}
function renderNavSubs(){
  [PAIR_CAT_NAV, OC_CAT_NAV].forEach(nav=>{
    nav.title(catTitle(nav, nav.get()));
    renderNavSub(nav);
  });
}

/* PAIR/OC 라벨 옆 '＋' — 창을 띄우지 않고, 목록 하단에 입력 칸을 엽니다 */
function startAddCat(nav){
  if(!isLoggedIn) return;
  openNavSection(nav);
  nav.adding = true;
  renderNavSub(nav);
  setTimeout(()=>{ const inp = nav.subEl().querySelector('.ns-add-input'); if(inp) inp.focus(); }, 0);
}
document.querySelectorAll('.nav-cat-add').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    startAddCat(btn.dataset.nav==='oc' ? OC_CAT_NAV : PAIR_CAT_NAV);
  });
});

/* 세부 카테고리를 골랐을 때 — 큰 메뉴를 눌러 들어온 것과 같은 모습이 되도록 맞춥니다 */
function selectNavSub(nav, id){
  nav.set(id);
  nav.title(catTitle(nav, id));
  openNavSection(nav);
  renderNavSub(nav);
  nav.rerender();
}

/* '○○로' / '○○으로' — 앞말 받침에 따라 조사를 고릅니다.
   분류 이름을 직접 지으실 수 있어서 문구를 고정해 둘 수가 없습니다.
   한글은 받침이 없거나 ㄹ 이면 '로', 그 밖에는 '으로'.
   영문·숫자는 소리 나는 대로 읽었을 때를 따릅니다(Dream→드림→'으로'). */
function particleRo(word){
  const ch = String(word||'').trim().slice(-1);
  if(!ch) return '로';
  const code = ch.charCodeAt(0);
  if(code >= 0xAC00 && code <= 0xD7A3){
    const jong = (code - 0xAC00) % 28;
    return (jong === 0 || jong === 8) ? '로' : '으로';   // 0 = 받침 없음, 8 = ㄹ
  }
  if(/[0-9]/.test(ch)) return '036'.includes(ch) ? '으로' : '로';   // 영·삼·육만 받침이 남습니다
  if(/[aeiouyrl]/i.test(ch)) return '로';
  return '으로';
}

/* 선택 줄의 '○○로 이동' 단추 */
function renderMoveBtns(nav){
  const wrap = nav.moveBtns();
  if(!wrap) return;
  wrap.innerHTML = '';
  const move = async (toId)=>{
    const ids = nav.selected();
    if(ids.size===0) return;
    nav.posts().forEach(p=>{ if(ids.has(p.id)) p.type = toId; });
    await nav.savePosts();
    ids.clear();
    nav.rerender();
  };
  nav.cats().forEach(c=>{
    const b = document.createElement('button');
    b.type='button'; b.className='btn-ghost';
    b.innerText = `${c.name}${particleRo(c.name)} 이동`;
    b.addEventListener('click', ()=> move(c.id));
    wrap.appendChild(b);
  });
  /* OC 는 '전체'가 없어 글이 카테고리 없이 남는 상태를 만들 수 없습니다 */
  if(nav.hasAll && nav.cats().length){
    const b = document.createElement('button');
    b.type='button'; b.className='btn-ghost';
    b.innerText = '카테고리 없음으로';
    b.addEventListener('click', ()=> move(''));
    wrap.appendChild(b);
  }
}

/* 카테고리 수정·삭제 창은 폴더 창을 그대로 씁니다 (비밀·흐림 항목만 숨김).
   추가는 이제 이 창을 쓰지 않으므로(목록 하단 입력 칸으로 대체) newFolder/onCreate 가 없습니다. */
function catCtx(nav){
  const countIn = (c)=> nav.posts().filter(p=> p.type===c.id).length;
  return {
    label: '카테고리',
    hideBlur: true,
    hideSecret: true,
    blurHint: '',
    getList: ()=> nav.cats(),
    canDelete: ()=> nav.cats().length > (nav.minCats || 0),
    deleteWarn: (c)=>{
      const n = countIn(c);
      if(nav.hasAll){
        return n>0
          ? `'${c.name}' 카테고리를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 카테고리 없이 남아 '전체'에서 볼 수 있습니다.`
          : `'${c.name}' 카테고리를 삭제합니다.`;
      }
      const fallback = nav.cats().find(x=>x.id!==c.id);
      return n>0
        ? `'${c.name}' 카테고리를 삭제합니다. 안에 있는 글 ${n}개는 '${fallback ? fallback.name : ''}' 카테고리로 옮겨집니다.`
        : `'${c.name}' 카테고리를 삭제합니다.`;
    },
    onDelete: async (c)=>{
      if(nav.hasAll){
        nav.setCats(nav.cats().filter(x=> x!==c));
        if(nav.get()===c.id) nav.set('all');
        /* 글의 type 은 일부러 지우지 않습니다 — 같은 이름으로 다시 만들 일이
           있어도 되살릴 수 있고, 지워진 id 를 가리키는 글은 '전체'에만 뜹니다. */
        return;
      }
      /* OC 는 '전체' 가 없어 글이 카테고리 없이 남으면 안 보이게 되므로,
         남는 카테고리 중 하나로 옮겨줍니다(폴더 삭제 때 '기본' 폴더로
         옮기는 것과 같은 방식). 그 카테고리의 폴더 목록도 함께 사라지지만,
         옮겨간 글은 ocFolderIdOf() 가 새 카테고리의 기본 폴더로 알아서 되돌립니다. */
      const remaining = nav.cats().filter(x=> x!==c);
      const fallback = remaining[0];
      nav.posts().forEach(p=>{ if(p.type===c.id) p.type = fallback.id; });
      nav.setCats(remaining);
      if(nav.get()===c.id) nav.set(fallback.id);
      await nav.savePosts();
    },
    save: ()=> nav.save(),
    rerender: ()=>{
      nav.title(catTitle(nav, nav.get()));
      renderNavSub(nav);
      nav.rerender();
    }
  };
}
document.querySelectorAll('#archiveSub .nav-sub-item').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    currentArchiveCategory = btn.dataset.archivesub;
    arcPage=1;
    arcUnblurred.clear();
    arcSelectedIds.clear();   // 카테고리를 옮기면 골라둔 것도 비웁니다
    navItems.forEach(b=>b.classList.remove('active'));
    document.querySelector('.nav-item[data-view="archive"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-archive').classList.add('active');
    // 고른 쪽만 열어둡니다 — 큰 메뉴를 눌러 들어왔을 때와 같은 모습이 되도록
    archiveSub.classList.add('open');
    pairSub.classList.remove('open');
    renderArchive();
  });
});

const homePagesWrap = document.getElementById('homePagesWrap');
const homeCardsPageEl = document.getElementById('home-cards-page');
/* 카드가 여섯 장을 넘으면 여러 장으로 나눠 담고 스크롤로 넘깁니다.
   LOVE INTEREST 줄은 그대로 있고 카드 칸만 밀려납니다. 점 표시는 두지 않습니다. */
const CARDS_PER_PAGE = 6;
let cardPageIdx = 0;
function cardPageCount(){
  return Math.max(1, Math.ceil((state.cards ? state.cards.length : 0)/CARDS_PER_PAGE));
}
function setCardPage(idx, animate){
  const wrap = document.getElementById('cardPages');
  if(!wrap) return;
  const pages = Array.from(wrap.querySelectorAll('.card-page'));
  if(!pages.length) return;
  cardPageIdx = clamp(idx, 0, pages.length-1);
  pages.forEach((el,n)=>{
    el.style.transition = (animate===false) ? 'none' : '';
    el.style.transform = `translateY(${(n-cardPageIdx)*100}%)`;
  });
  if(animate===false){
    void pages[0].offsetWidth;
    pages.forEach(el=>{ el.style.transition=''; });
  }
}
let cardWheelLock = 0;
homePagesWrap.addEventListener('wheel', (e)=>{
  const showingCards = homePagesWrap.classList.contains('show-cards');
  if(!showingCards){
    if(e.deltaY>0){ homePagesWrap.classList.add('show-cards'); }
    return;
  }
  /* 카드 장이 여럿이면 먼저 그 안에서 넘깁니다.
     첫 장에서 더 올리면 그때 소개 화면으로 돌아갑니다. */
  const last = cardPageCount()-1;
  const now = Date.now();
  if(e.deltaY>0 && cardPageIdx < last){
    if(now < cardWheelLock) return;
    cardWheelLock = now + 500;
    setCardPage(cardPageIdx+1);
    return;
  }
  if(e.deltaY<0 && cardPageIdx > 0){
    if(now < cardWheelLock) return;
    cardWheelLock = now + 500;
    setCardPage(cardPageIdx-1);
    return;
  }
  if(e.deltaY<0 && homeCardsPageEl.scrollTop<=0){ homePagesWrap.classList.remove('show-cards'); }
}, {passive:true});

/* ============================================================
   MODAL HELPERS
   ============================================================ */
/* 붙여넣은 글의 '서식'만 사이트 기준으로 맞춥니다 — 글 내용은 건드리지 않습니다.
   빈 줄을 지우거나 줄을 합치지 않는 것은 그래서입니다(그건 내용을 바꾸는 일입니다).
   눈에 안 보이지만 모양을 어긋나게 하는 두 가지만 고칩니다:
   줄바꿈 문자 종류(윈도우·맥), 그리고 웹에서 딸려오는 '줄바꿈 없는 공백'
   (겉보기엔 보통 공백이지만 그 자리에서 줄이 안 넘어가 문단 모양이 틀어집니다). */
function normalizePastedText(raw){
  return String(raw)
    .replace(/\r\n?/g, '\n')      // 윈도우·맥 줄바꿈을 하나로
    .replace(/ /g, ' ');     // 줄바꿈 없는 공백 → 보통 공백
}
document.addEventListener('paste', (e)=>{
  const target = e.target;
  if(target && target.isContentEditable){
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, normalizePastedText(text));
  }
});

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(el=>{ el.addEventListener('click', ()=> el.closest('.modal-overlay').classList.remove('open')); });
document.querySelectorAll('.modal-overlay').forEach(ov=>{ ov.addEventListener('click',(e)=>{ if(e.target===ov) ov.classList.remove('open'); }); });

/* 글쓰기 창(ARCHIVE·LOG)에서 저장하지 않은 변경사항이 있는 채로 바깥을
   클릭하거나 X(.modal-close) 버튼을 눌러 나가려 하면, 그래도 나갈지
   사이트 디자인에 맞춘 확인창(siteConfirm)으로 한 번 더 묻습니다.
   '취소'(.btn-ghost, 위의 [data-close] 로 이미 처리됨)는 그 자체가 버리겠다는
   뜻이라 다시 묻지 않습니다 — 그래서 여기서는 .modal-close 와 오버레이 바깥
   클릭만 가로챕니다. 위 두 줄의 일반 핸들러가 이미 등록돼 있으므로, 여기
   핸들러는 capture 단계에서 먼저 받아 필요할 때만 막습니다(stopPropagation).
   getSnapshot() 은 지금 입력 상태를 문자열로 돌려주는 함수 — 모달을 열 때
   armUnsavedGuard() 로 그 시점 값을 기준선으로 저장해 두고, 닫으려는 시점에
   다시 불러 값이 달라졌으면 '저장 안 됨'으로 봅니다. */
function guardUnsavedClose(overlayId, getSnapshot){
  const overlay = document.getElementById(overlayId);
  if(!overlay) return;
  let baseline = null;
  overlay._armUnsavedGuard = ()=>{ baseline = getSnapshot(); };
  const dirty = ()=> baseline !== null && getSnapshot() !== baseline;
  const attempt = (e)=>{
    if(!overlay.classList.contains('open') || !dirty()) return;
    e.stopPropagation();
    e.preventDefault();
    siteConfirm('저장하지 않은 내용이 있어요. 그래도 나갈까요?', '나가기').then(ok=>{
      if(ok){ baseline = null; overlay.classList.remove('open'); }
    });
  };
  overlay.querySelectorAll('.modal-close').forEach(btn=> btn.addEventListener('click', attempt, true));
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) attempt(e); }, true);
}
guardUnsavedClose('modalArcWrite', ()=> JSON.stringify([
  document.getElementById('arcTitleInput').value,
  document.getElementById('arcCategoryInput').value,
  document.getElementById('arcContentEditor').innerHTML,
  arcAttachments
]));
guardUnsavedClose('modalLogWrite', ()=> JSON.stringify([
  document.getElementById('logTitle').value,
  document.getElementById('logContent').innerHTML,
  document.getElementById('logSubColor').value,
  document.getElementById('logParenColor').value,
  document.getElementById('logHighlightColor').value
]));

/* ============================================================
   PROFILE
   ============================================================ */
document.getElementById('profileName').addEventListener('change', e=>{ if(!isLoggedIn)return; state.profile.name=e.target.value; storageSet('profile',state.profile); });
document.getElementById('profileBio').addEventListener('change', e=>{ if(!isLoggedIn)return; state.profile.bio=e.target.value; storageSet('profile',state.profile); });
document.getElementById('siteName').addEventListener('change', e=>{ if(!isLoggedIn)return; state.siteName=e.target.value; storageSet('siteName',state.siteName); });

document.getElementById('homeIntro').addEventListener('blur', e=>{ if(!isLoggedIn)return; state.homeIntro=e.target.innerText; storageSet('homeIntro',state.homeIntro); });

const introBannerAdj = createAdjustable(
  document.getElementById('introBannerBox'),
  ()=> state.homeBanner,
  (o)=>{ state.homeBanner=o; storageSet('homeBanner', o); }
);

/* ============================================================
   HOME - CARDS (인라인 편집, 드래그 정렬)
   ============================================================ */
bindOnce(document.getElementById('addCardBtn'), async ()=>{
  if(!isLoggedIn) return;
  state.cards.push({ id:Date.now(), name:'', catch:'', genre:'', desc:'', image:blankImg() });
  await storageSet('cards', state.cards);
  renderCards();
});

/* ------------------------------------------------------------
   저장/추가 버튼 중복 실행 방지
   ------------------------------------------------------------
   저장은 await storageSet(...) 을 기다리는 비동기 처리라,
   그 사이에 버튼을 한 번 더 누르면 같은 항목이 두 번 만들어집니다.
   처리 중에는 버튼을 잠그고 한 번만 받습니다.
   ------------------------------------------------------------ */
function bindOnce(el, handler){
  if(!el) return;
  let busy = false;
  el.addEventListener('click', async (e)=>{
    if(busy) return;
    busy = true;
    const wasDisabled = el.disabled;
    el.disabled = true;
    try{ await handler(e); }
    finally{ busy = false; el.disabled = wasDisabled; }
  });
}

/* FLIP 기반 실시간 드래그 재정렬 유틸 */
/* 브라우저 기본 확인 창 대신 쓰는 사이트 모양의 확인 창.
   true/false 를 돌려주므로 confirm() 자리에 await 로 그대로 넣으면 됩니다. */
function siteConfirm(message, okText){
  const ov = document.getElementById('modalConfirm');
  if(!ov) return Promise.resolve(window.confirm(message));   // 옛 HTML 이면 기본 창으로
  return new Promise(res=>{
    const textEl = document.getElementById('confirmText');
    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');
    textEl.innerText = message;
    ok.innerText = okText || '삭제';
    const finish = (v)=>{
      ov.classList.remove('open');
      ok.onclick = null; cancel.onclick = null; ov.onclick = null;
      document.removeEventListener('keydown', onKey, true);
      res(v);
    };
    const onKey = (e)=>{
      if(e.key==='Escape'){ e.stopPropagation(); finish(false); }
      else if(e.key==='Enter'){ e.stopPropagation(); finish(true); }
    };
    ok.onclick = ()=> finish(true);
    cancel.onclick = ()=> finish(false);
    ov.onclick = (e)=>{ if(e.target===ov) finish(false); };
    document.addEventListener('keydown', onKey, true);
    ov.classList.add('open');
    setTimeout(()=>{ try{ ok.focus(); }catch(_){} }, 30);
  });
}

/* 같은 자리를 지키는 것이 아니라 '어떤 항목'인지로 짝을 맞추는 FLIP.
   목록을 통째로 다시 그린 뒤에도 밀려나는 움직임을 보여줄 수 있습니다. */
function flipByKey(container, itemSelector, keyName){
  const before = new Map();
  container.querySelectorAll(itemSelector).forEach(el=>{
    if(el.dataset[keyName]!=null) before.set(el.dataset[keyName], el.getBoundingClientRect());
  });
  return ()=>{
    container.querySelectorAll(itemSelector).forEach(el=>{
      const b = before.get(el.dataset[keyName]);
      if(!b) return;
      const a = el.getBoundingClientRect();
      const dy = b.top - a.top;
      if(!dy) return;
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      setTimeout(()=>{
        el.style.transition = 'transform .22s ease';
        el.style.transform = '';
      }, 16);
    });
  };
}

function flipCapture(container, itemSelector){
  return new Map(Array.from(container.querySelectorAll(itemSelector)).map(el=>[el, el.getBoundingClientRect()]));
}
function flipPlay(rectsBefore){
  rectsBefore.forEach((before, el)=>{
    const after = el.getBoundingClientRect();
    const dx = before.left - after.left, dy = before.top - after.top;
    if(dx || dy){
      el.style.transition='none';
      el.style.transform = `translate(${dx}px,${dy}px)`;
      requestAnimationFrame(()=>{
        el.style.transition='transform .22s ease';
        el.style.transform='';
      });
    }
  });
}
function reorderArrayByDomOrder(container, itemSelector, arr){
  const domIds = Array.from(container.querySelectorAll(itemSelector)).map(el=> el.dataset.id);
  arr.sort((a,b)=> domIds.indexOf(String(a.id)) - domIds.indexOf(String(b.id)));
}

let draggedCardEl=null;
const cardGridEl = document.getElementById('cardPages');
cardGridEl.addEventListener('dragover', (e)=>{
  e.preventDefault();
  if(!draggedCardEl) return;
  const target = e.target.closest('.dream-card');
  if(!target || target===draggedCardEl || target.parentNode!==draggedCardEl.parentNode) return;
  const rects = flipCapture(cardGridEl, '.dream-card');
  const rect = target.getBoundingClientRect();
  const before = (e.clientX - rect.left) < rect.width/2;
  target.parentNode.insertBefore(draggedCardEl, before?target:target.nextSibling);
  flipPlay(rects);
});
cardGridEl.addEventListener('drop', (e)=> e.preventDefault());

function renderCards(){
  const wrap=document.getElementById('cardPages');
  if(!wrap) return;
  wrap.innerHTML='';
  /* 여섯 장씩 끊어 담고, 마지막 장이 덜 차도 격자 높이는 그대로 둡니다 */
  const pageCount = Math.max(1, Math.ceil(state.cards.length/CARDS_PER_PAGE));
  const grids=[];
  for(let n=0;n<pageCount;n++){
    const page=document.createElement('div'); page.className='card-page';
    const g=document.createElement('div'); g.className='card-grid';
    page.appendChild(g); wrap.appendChild(page); grids.push(g);
  }
  state.cards.forEach((c, ci)=>{
    const grid = grids[Math.floor(ci/CARDS_PER_PAGE)];
    const el=document.createElement('div');
    el.className='dream-card'; el.draggable=isLoggedIn; el.dataset.id=c.id;
    el.innerHTML = `
      <div class="adjustable-img dc-adjustable"><div class="adj-layer"></div>
        <button class="adj-empty" data-editonly>＋ 사진 추가</button>
        <button class="adj-change" data-editonly>📷</button></div>
      <div class="dc-grad"></div>
      <span class="dc-drag" data-editonly>⠿</span>
      <button class="dc-del" data-editonly>✕</button>
      <div class="dc-content">
        <div class="dc-genre" contenteditable="${isLoggedIn}" data-f="genre">${escapeHtml(c.genre)}</div>
        <div class="dc-name" contenteditable="${isLoggedIn}" data-f="name">${escapeHtml(c.name)}</div>
        <div class="dc-catch" contenteditable="${isLoggedIn}" data-f="catch">${escapeHtml(c.catch)}</div>
        <div class="dc-desc" contenteditable="${isLoggedIn}" data-f="desc">${escapeHtml(c.desc)}</div>
      </div>`;

    el.querySelectorAll('[data-f]').forEach(fieldEl=>{
      fieldEl.addEventListener('blur', ()=>{
        if(!isLoggedIn) return;
        c[fieldEl.dataset.f] = fieldEl.innerText;
        storageSet('cards', state.cards);
      });
      fieldEl.addEventListener('mousedown', ev=> ev.stopPropagation());
    });

    el.querySelector('.dc-del').addEventListener('click', async (ev)=>{
      ev.stopPropagation(); if(!isLoggedIn) return;
      state.cards = state.cards.filter(x=>x.id!==c.id);
      await storageSet('cards', state.cards); renderCards();
    });

    createAdjustable(
      el.querySelector('.dc-adjustable'),
      ()=>c.image,
      (o)=>{ c.image=o; storageSet('cards', state.cards); },
      { onAdjustToggle:(active)=>{ el.draggable = isLoggedIn && !active; } }
    );

    el.addEventListener('dragstart', ()=>{ draggedCardEl=el; el.classList.add('dragging'); });
    el.addEventListener('dragend', async ()=>{
      el.classList.remove('dragging');
      if(draggedCardEl){
        reorderArrayByDomOrder(wrap, '.dream-card', state.cards);
        await storageSet('cards', state.cards);
      }
      draggedCardEl=null;
    });
    grid.appendChild(el);
  });
  // 장 수가 줄었을 수 있으니 현재 장을 범위 안으로 맞춰 다시 세웁니다
  setCardPage(Math.min(cardPageIdx, pageCount-1), false);
}

/* ============================================================
   PAIR
   ============================================================ */
let currentPairFilter='all';
let currentOcFilter = state.ocCats[0] ? state.ocCats[0].id : '';   // OC 는 '전체'가 없어 늘 실제 카테고리를 가리킵니다
let currentArchiveCategory='nai';   // ARCHIVE 첫 진입은 PROMPT
let selectMode=false;
let selectedPairIds=new Set();

/* 새 글은 지금 보고 있는 분류로 들어갑니다.
   '전체'를 보고 있으면 맨 앞 분류로, 분류가 하나도 없으면 분류 없이. */
function newPostType(nav){
  const cur = nav.get();
  if(cur !== 'all') return cur;
  const first = nav.cats()[0];
  return first ? first.id : '';
}

bindOnce(document.getElementById('writePairBtn'), async ()=>{
  if(!isLoggedIn) return;
  /* 이름·부제목은 비워 둡니다 — 입력칸의 안내 문구(placeholder)만 보이고,
     쓰는 사람이 예시 글자를 지울 필요가 없습니다. */
  const post = migratePost({ id:Date.now(), type: newPostType(PAIR_CAT_NAV), title:'' });
  // 새 글은 맨 앞에 쌓입니다 — 첫 페이지 왼쪽 위에서 바로 보입니다
  state.pairPosts.unshift(post);
  await storageSet('pairPosts', state.pairPosts);
  pairPage = 1;
  renderPairPosts();
  openPairDetail(post.id);
});

document.getElementById('selectPairBtn').addEventListener('click', ()=>{
  selectMode=!selectMode;
  selectedPairIds.clear();
  document.getElementById('selectPairBtn').innerText = selectMode ? '선택 취소' : '선택';
  document.getElementById('pairSelectBar').style.display = selectMode ? 'flex' : 'none';
  renderPairPosts();
});
function updateSelectCountLabel(){
  document.getElementById('selectCountLabel').innerText = `${selectedPairIds.size}개 선택됨`;
}
document.getElementById('deleteSelectedBtn').addEventListener('click', async ()=>{
  if(selectedPairIds.size===0) return;
  if(!await siteConfirm(`선택한 ${selectedPairIds.size}개 글을 삭제할까요?`)) return;
  state.pairPosts = state.pairPosts.filter(p=>!selectedPairIds.has(p.id));
  await storageSet('pairPosts', state.pairPosts);
  selectedPairIds.clear();
  renderPairPosts();
});
/* PC 는 4열 x 2행 = 8개, 모바일은 2열 x 2행 = 4개.
   CSS 의 .post-grid 열 수와 반드시 짝을 맞춰야 합니다.
   (isMobileWidth 는 갤러리 쪽과 같은 기준을 씁니다 — 아래 MOBILE_MQ 참고) */
function pairPerPage(){ return isMobileWidth() ? 4 : 8; }
let pairPage = 1;

function renderPairPosts(){
  const grid=document.getElementById('postGrid'); grid.innerHTML='';
  const pagSlot=document.getElementById('pairPagination');
  if(pagSlot) pagSlot.innerHTML='';
  const list = state.pairPosts.filter(p=> currentPairFilter==='all' || p.type===currentPairFilter);
  if(list.length===0){ grid.innerHTML='<div class="empty-note">아직 작성된 글이 없어요.</div>'; return; }

  const perPage = pairPerPage();
  const totalPages = Math.max(1, Math.ceil(list.length/perPage));
  if(pairPage>totalPages) pairPage=totalPages;
  if(pairPage<1) pairPage=1;
  const start=(pairPage-1)*perPage;
  const pageItems = list.slice(start, start+perPage);

  pageItems.forEach(p=>{
    const el=document.createElement('div'); el.className='post-card'+(selectMode?' selectable':'');
    el.dataset.id = p.id;
    const checked = selectedPairIds.has(p.id);
    el.innerHTML = `${selectMode?`<div class="post-check ${checked?'checked':''}">${checked?'✓':''}</div>`:''}
      <div class="post-thumb" style="background-image:url('${(p.headerImage&&p.headerImage.src)||''}')"></div>
      <div class="post-info"><div class="post-type">${escapeHtml(catName(state.pairCats, p.type))}</div><div class="post-title">${escapeHtml(p.title)}</div></div>`;
    el.addEventListener('click', ()=>{
      if(selectMode){
        if(selectedPairIds.has(p.id)) selectedPairIds.delete(p.id); else selectedPairIds.add(p.id);
        updateSelectCountLabel();
        renderPairPosts();
      }else{
        openPairDetail(p.id);
      }
    });
    grid.appendChild(el);
    // 목록 썸네일도 표시용 축소본으로 (박스는 250px 안팎, 원본은 800px대).
    // 붙인 뒤에 호출해야 실제 폭을 잴 수 있다.
    const thumbSrc = p.headerImage && p.headerImage.src;
    const thumbEl = el.querySelector('.post-thumb');
    if(thumbSrc) applyThumbBg(thumbEl, thumbSrc);
    applyThumbPos(thumbEl, p);
    if(selectMode && thumbSrc) addThumbPanControl(el, thumbEl, p, savePair);
  });

  // 마지막 페이지가 덜 차도 격자 높이가 그대로 유지되도록 빈 자리를 채웁니다
  for(let i=pageItems.length;i<perPage;i++){
    const slot=document.createElement('div'); slot.className='post-slot';
    grid.appendChild(slot);
  }

  if(pagSlot && totalPages>1){
    let pag = `<button class="log-pg-btn" data-pg="prev" ${pairPage===1?'disabled':''}>&lt;</button>`;
    for(let i=1;i<=totalPages;i++){ pag += `<button class="log-pg-btn ${i===pairPage?'active':''}" data-pg="${i}">${i}</button>`; }
    pag += `<button class="log-pg-btn" data-pg="next" ${pairPage===totalPages?'disabled':''}>&gt;</button>`;
    pagSlot.innerHTML = `<div class="log-pagination">${pag}</div>`;
    pagSlot.querySelectorAll('.log-pg-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(btn.dataset.pg==='prev') pairPage=Math.max(1,pairPage-1);
        else if(btn.dataset.pg==='next') pairPage=Math.min(totalPages,pairPage+1);
        else pairPage=Number(btn.dataset.pg);
        renderPairPosts();
      });
    });
  }
}

let currentPairPostId=null;
function getCurrentPost(){ return state.pairPosts.find(x=>x.id===currentPairPostId); }

function openPairDetail(id){
  currentPairPostId=id;
  const p=getCurrentPost();
  prefetchImgs(p);   // 지금 보는 글의 사진을 대기열 맨 앞으로
  /* 창을 먼저 열고 나서 그립니다 — 숨은 상태에서는 사진 칸의 폭·높이가 0 이라
     '꽉 채우는 배율'을 계산할 수 없어 확대가 안 된 크기로 한 번 그렸다가
     곧바로 확대되는 것이 눈에 보입니다. 같은 작업 안에서 이어 하므로
     화면이 중간 상태로 그려지지는 않습니다. */
  openModal('modalPairDetail');
  fillPairDetail(p);
  // 혹시 폭이 아직 안 잡혔을 때를 대비한 한 번 더 (rAF는 백그라운드 탭에서 실행되지 않아 setTimeout)
  setTimeout(()=>{
    if(pdCharImgAdj) pdCharImgAdj.paint();
    if(pdPersonaImgAdj) pdPersonaImgAdj.paint();
    if(pdHeaderImgAdj) pdHeaderImgAdj.paint();
    if(pdSideImgAdj) pdSideImgAdj.paint();
  });
}

let pdCharImgAdj=null, pdPersonaImgAdj=null, pdHeaderImgAdj=null, pdSideImgAdj=null;
function initPairImageAdjusters(){
  pdSideImgAdj = createAdjustable(document.getElementById('pdSideImgBox'),
    ()=>{ const post=getCurrentPost(); return post ? post.sideImage : blankImg(); },
    (o)=>{ const post=getCurrentPost(); if(!post) return; post.sideImage=o; storageSet('pairPosts',state.pairPosts); });
  pdCharImgAdj = createAdjustable(document.getElementById('pdCharImgBox'),
    ()=>{ const post=getCurrentPost(); return post ? post.char.image : blankImg(); },
    (o)=>{ const post=getCurrentPost(); if(!post) return; post.char.image=o; storageSet('pairPosts',state.pairPosts); });
  pdPersonaImgAdj = createAdjustable(document.getElementById('pdPersonaImgBox'),
    ()=>{ const post=getCurrentPost(); return post ? post.persona.image : blankImg(); },
    (o)=>{ const post=getCurrentPost(); if(!post) return; post.persona.image=o; storageSet('pairPosts',state.pairPosts); });
  pdHeaderImgAdj = createAdjustable(document.getElementById('pdHeaderImgBox'),
    ()=>{ const post=getCurrentPost(); return post ? post.headerImage : blankImg(); },
    (o)=>{ const post=getCurrentPost(); if(!post) return; post.headerImage=o; storageSet('pairPosts',state.pairPosts); renderPairPosts(); });
}

function fillPairDetail(p){
  const titleInput=document.getElementById('pdTitleInput');
  titleInput.value=p.title; titleInput.readOnly=!isLoggedIn;
  titleInput.oninput=()=>{ if(!isLoggedIn)return; p.title=titleInput.value; storageSet('pairPosts',state.pairPosts); renderPairPosts(); };

  const subtitleInput=document.getElementById('pdSubtitleInput');
  if(p.subtitle==null) p.subtitle='';
  subtitleInput.value=p.subtitle; subtitleInput.readOnly=!isLoggedIn;
  subtitleInput.oninput=()=>{ if(!isLoggedIn)return; p.subtitle=subtitleInput.value; storageSet('pairPosts',state.pairPosts); };

  bindMeta('pdCharName','name',p.char);
  bindMeta('pdCharSub','subtitle',p.char);
  bindMeta('pdPersonaName','name',p.persona);
  bindMeta('pdPersonaSub','subtitle',p.persona);

  bindMetaContainer('pdCharMeta', p.char);
  bindBodyText('pdCharIntro', p.char);
  bindMetaContainer('pdPersonaMeta', p.persona);
  bindBodyText('pdPersonaIntro', p.persona);

  bindRelText('relCharToPersona','relCharToPersona',p);
  bindRelText('relPersonaToChar','relPersonaToChar',p);
  bindRelText('relLabelCharToPersona','relLabelCharToPersona',p);
  bindRelText('relLabelPersonaToChar','relLabelPersonaToChar',p);

  pdCharImgAdj.paint();
  pdPersonaImgAdj.paint();
  pdHeaderImgAdj.paint();
  if(pdSideImgAdj) pdSideImgAdj.paint();

  /* 오른쪽 칸 — 세로 이미지 / TIMELINE / 테마곡 / 메시지 */
  PAIR_THEME_HOST.idx = 0;
  renderThemeSongs(PAIR_THEME_HOST);
  renderMessages(p);
  if(pdSidePager) pdSidePager.set(0, false);

  bindRichTextToolbars();
  /* 갤러리·로그 엔진을 PAIR 창 쪽으로 돌려놓습니다 */
  galleryHost = PAIR_GALLERY_HOST;
  logHost = PAIR_LOG_HOST;
  pdLogPage = 1;
  currentLogFolderId = p.logFolders[0].id;
  logSelectMode = false; logSelectedIds.clear();
  currentGalleryFolderId = p.galleryFolders[0].id;
  galleryPage = 1;
  gallerySelectMode = false;
  gallerySelectedIdx.clear();
  gq('.gallery-select-info').style.display='none';
  gq('.gallery-select-delete').style.display='none';
  gq('.gallery-select-toggle').innerText='✓';
  gq('.gallery-select-toggle').classList.remove('active');
  document.querySelectorAll('.pd-index-tab').forEach(t=>t.classList.toggle('active', t.dataset.pdtab==='info'));
  document.querySelectorAll('.pd-tab-pane').forEach(pn=>pn.classList.toggle('active', pn.dataset.pdpane==='info'));
  renderLogList(p); renderGallery(p); renderTimeline(p);
}

document.querySelectorAll('.pd-index-tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.pd-index-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.querySelectorAll('.pd-tab-pane').forEach(pn=>pn.classList.toggle('active', pn.dataset.pdpane===tab.dataset.pdtab));
  });
});

/* persist 를 넘기지 않으면 PAIR 글로 저장합니다 (OC 창은 자기 저장 함수를 넘깁니다) */
function bindMeta(elId, field, obj, persist){
  const save = persist || savePair;
  const el=document.getElementById(elId); el.value=obj[field]||''; el.readOnly=!isLoggedIn;
  el.oninput=()=>{ if(!isLoggedIn)return; obj[field]=el.value; save(); };
}
let draggedMetaRow = null;
function bindMetaContainer(elId, obj, persist){
  // 라벨(::라벨 값) 전용 컨테이너. 본문과 완전히 독립된 레이어로 동작.
  const el=document.getElementById(elId);
  el.innerHTML = obj.metaHtml || '';
  el.querySelectorAll('.meta-label,.meta-value').forEach(span=>{ span.contentEditable = isLoggedIn ? 'true' : 'false'; });
  const persistFn = persist || savePair;
  el._saveMeta = ()=>{ obj.metaHtml=el.innerHTML; persistFn(); };

  /* 조작은 이 요소에 딱 한 번만 겁니다.
     창을 열 때마다 다시 걸면 예전 글을 가리키는 저장 함수가 그대로 남아,
     다음 글의 라벨을 고칠 때 그 내용이 예전 글에도 덮어써집니다.
     저장은 언제나 지금 걸려 있는 el._saveMeta 로만 합니다. */
  if(el._metaBound) return;
  el._metaBound = true;

  el.addEventListener('focusout', (e)=>{
    if(!isLoggedIn) return;
    if(e.target.classList && (e.target.classList.contains('meta-label') || e.target.classList.contains('meta-value'))) el._saveMeta();
  });
  el.addEventListener('keydown', (e)=>{
    // 라벨/값은 한 줄 입력만 허용 (엔터 시 줄바꿈 대신 입력 확정)
    if(e.key==='Enter'){ e.preventDefault(); e.target.blur(); }
  });

  el.addEventListener('dragstart', (e)=>{
    const handle = e.target.closest('.meta-drag');
    if(!handle){ return; }
    const row = handle.closest('.meta-row');
    draggedMetaRow = row; row.classList.add('dragging-meta');
  });
  el.addEventListener('dragover', (e)=>{
    if(!draggedMetaRow) return;
    const row = e.target.closest ? e.target.closest('.meta-row') : null;
    if(!row || row===draggedMetaRow || row.parentNode!==el) return;
    e.preventDefault();
    const rects = flipCapture(el, '.meta-row');
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height/2;
    el.insertBefore(draggedMetaRow, before?row:row.nextSibling);
    flipPlay(rects);
  });
  el.addEventListener('dragend', ()=>{
    if(draggedMetaRow){ draggedMetaRow.classList.remove('dragging-meta'); el._saveMeta(); }
    draggedMetaRow=null;
  });
  el.addEventListener('click', (e)=>{
    const delBtn = e.target.closest('.meta-del');
    if(delBtn){
      delBtn.closest('.meta-row').remove();
      el._saveMeta();
    }
  });
}
function bindBodyText(elId, obj, persist){
  // 본문 전용 영역. 라벨과 완전히 분리되어 일반적인 줄바꿈 동작만 수행.
  const el=document.getElementById(elId);
  el.innerHTML = obj.intro || '';
  el.contentEditable = isLoggedIn ? 'true' : 'false';
  const persistFn = persist || savePair;
  const save = ()=>{ obj.intro=el.innerHTML; persistFn(); };
  el.onblur=()=>{ if(!isLoggedIn)return; save(); };
  el._saveMeta = save;
}
function bindRelText(elId, field, p){
  const el=document.getElementById(elId);
  el.innerText = p[field]||'';
  el.contentEditable = isLoggedIn ? 'true' : 'false';
  el.onblur=()=>{ if(!isLoggedIn)return; p[field]=el.innerText; storageSet('pairPosts',state.pairPosts); };
}
function renderKeywords(rowId, obj){
  const row=document.getElementById(rowId); row.innerHTML='';
  obj.keywords.forEach((kw, idx)=>{
    const chip=document.createElement('span'); chip.className='kw-chip';
    chip.style.background = `color-mix(in srgb, ${kw.color} 16%, white)`;
    chip.style.color = kw.color;
    chip.innerHTML = `<span class="kw-text" contenteditable="${isLoggedIn}">${escapeHtml(kw.text)}</span><input type="color" class="kw-color" value="${kw.color}" data-editonly />`;
    chip.querySelector('.kw-text').addEventListener('blur', (e)=>{ if(!isLoggedIn)return; kw.text=e.target.innerText; storageSet('pairPosts',state.pairPosts); });
    chip.querySelector('.kw-color').addEventListener('input', (e)=>{
      kw.color=e.target.value; chip.style.background=`color-mix(in srgb, ${kw.color} 16%, white)`; chip.style.color=kw.color;
      storageSet('pairPosts',state.pairPosts);
    });
    row.appendChild(chip);
  });
}
function bindRichTextToolbars(){
  document.querySelectorAll('.rt-toolbar').forEach(tb=>{
    // 아카이브·LOG 에디터 툴바는 각자 전용 로직으로 바인딩됨
    if(tb.classList.contains('rt-toolbar-arc')) return;
    if(tb.classList.contains('rt-toolbar-log')) return;
    if(tb.classList.contains('rt-toolbar-ocfree')) return;
    const targetEl = document.getElementById(tb.dataset.target); // 본문 영역 (B/I/색상 적용 대상)
    const metaEl = document.getElementById(tb.dataset.metaTarget); // 라벨 컨테이너 (+ 버튼 대상)
    // 본문 없이 라벨만 다루는 툴바(OC)도 있으므로 각각 따로 겁니다
    if(targetEl){
      tb.querySelectorAll('button[data-cmd]').forEach(btn=>{
        btn.onmousedown = (e)=> e.preventDefault();
        btn.onclick = ()=>{ targetEl.focus(); document.execCommand(btn.dataset.cmd, false, null); };
      });
      const colorInput = tb.querySelector('.rt-color');
      if(colorInput) colorInput.oninput = (e)=>{ targetEl.focus(); document.execCommand('foreColor', false, e.target.value); };
    }
    const addRowBtn = tb.querySelector('.rt-add-row');
    if(addRowBtn && metaEl){
      const maxRows = Number(tb.dataset.maxRows) || 0;
      addRowBtn.onmousedown = (e)=> e.preventDefault();
      addRowBtn.onclick = ()=>{
        if(maxRows && metaEl.querySelectorAll('.meta-row').length >= maxRows){
          alert(`라벨은 최대 ${maxRows}개까지 넣을 수 있어요.`);
          return;
        }
        const row=document.createElement('div');
        row.className='meta-row';
        row.innerHTML = `<span class="meta-drag" contenteditable="false" draggable="true" data-editonly>::</span><span class="meta-label" contenteditable="true"></span><span class="meta-value" contenteditable="true"></span><button type="button" class="meta-del" contenteditable="false" data-editonly>✕</button>`;
        metaEl.appendChild(row);
        row.querySelector('.meta-label').focus();
        if(metaEl._saveMeta) metaEl._saveMeta();
      };
    }
  });
}

/* ------------------------------------------------------------
   LOG 본문 서식 처리
   ------------------------------------------------------------
   본문은 HTML로 저장합니다. 예전에 일반 텍스트로 저장된 글도
   그대로 읽을 수 있게 변환해서 다룹니다.
   ------------------------------------------------------------ */
const LOG_SUB_COLOR_DEFAULT   = '#c1440e';  // 게시글 추가 버튼 글자색
const LOG_PAREN_COLOR_DEFAULT = '#6b675e';  // 타임라인 내용 글자색
const LOG_HIGHLIGHT_DEFAULT   = '#f8ddbf';  // 형광펜 (연한 오렌지톤)

function looksLikeHtml(s){ return /<[a-z][\s\S]*>/i.test(s||''); }

/* ------------------------------------------------------------
   색 서식 껐다 켜기
   ------------------------------------------------------------
   볼드/이탤릭은 execCommand 가 알아서 토글하지만 색 명령은 그렇지 않습니다 —
   같은 색을 다시 넣어도 그대로 남습니다. 이미 그 색이 걸려 있으면
   기본값으로 되돌려서 한 번 더 누르면 풀리게 합니다.
   ------------------------------------------------------------ */
const LOG_TEXT_DEFAULT = '#1a1a1a';   // 본문 기본 글자색 (--text)

/* '#c1440e' / 'rgb(193,68,14)' 처럼 표기가 달라도 비교할 수 있게
   브라우저가 계산한 값으로 통일합니다. */
function toRgb(color){
  if(!color) return '';
  const probe = document.createElement('span');
  probe.style.color = color;
  if(!probe.style.color) return '';      // 브라우저가 못 읽는 값
  probe.style.position = 'fixed';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const v = getComputedStyle(probe).color;
  probe.remove();
  return v;
}
function queryColor(cmd){
  try{ return document.queryCommandValue(cmd) || ''; }catch(e){ return ''; }
}
function toggleForeColor(color){
  const on = toRgb(queryColor('foreColor')) === toRgb(color);
  document.execCommand('foreColor', false, on ? LOG_TEXT_DEFAULT : color);
}
/* 형광펜은 queryCommandValue 로 판단할 수 없습니다 —
   크롬은 hiliteColor 에 빈 문자열을, backColor 에는 물려받은 페이지 배경색을
   돌려줘서 칠하지 않은 글자도 "배경이 있다"고 나옵니다.
   그래서 선택 위치에서 위로 올라가며 인라인 배경색이 걸린 요소를 직접 찾습니다. */
function highlightedWith(color){
  const sel = window.getSelection();
  if(!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  let node = range.startContainer;
  // 선택 시작점이 요소면 그 자리의 자식부터 봅니다 (칸 전체를 선택한 경우)
  if(node.nodeType === 1) node = node.childNodes[range.startOffset] || node;
  if(node.nodeType === 3) node = node.parentNode;
  const want = toRgb(color);
  while(node && node.nodeType === 1){
    if(node.isContentEditable === false || node.classList.contains('log-editor')
       || node.classList.contains('arc-editor')) break;
    const bg = node.style && node.style.backgroundColor;
    if(bg) return toRgb(bg) === want;
    node = node.parentNode;
  }
  return false;
}
function toggleHighlight(color){
  const next = highlightedWith(color) ? 'transparent' : color;
  if(!document.execCommand('hiliteColor', false, next)){
    document.execCommand('backColor', false, next);
  }
}

/* 구버전(일반 텍스트) 본문을 HTML로 */
function logContentToHtml(content){
  if(!content) return '';
  if(looksLikeHtml(content)) return content;
  return escapeHtml(content).replace(/\n/g,'<br>');
}

function htmlToPlainText(html){
  const d = document.createElement('div');
  d.innerHTML = logContentToHtml(html);
  return d.innerText || '';
}

/* "따옴표" → 보조색, (괄호) → 괄호색, **별표** → 볼드.
   HTML 문자열을 정규식으로 건드리면 태그·속성이 깨지므로
   글자 노드만 골라서 바꿉니다. */
function applyAutoFormat(root, subColor, parenColor){
  /* **볼드** 를 *기울임* 보다 먼저 적어야 합니다 — 갈래는 적힌 순서대로 시도되므로,
     기울임이 앞에 오면 **볼드** 의 앞쪽 별 두 개를 기울임으로 먼저 채가 버립니다. */
  const RE = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|"([^"\n]*)"|\(([^)\n]*)\)/g;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const targets = [];
  let n;
  while((n = walker.nextNode())){
    // 코드 블록 안은 적은 그대로 보여야 하므로 자동 서식을 걸지 않습니다
    if(n.parentNode && n.parentNode.closest && n.parentNode.closest('.code-block')) continue;
    if(n.nodeValue && RE.test(n.nodeValue)) targets.push(n);
    RE.lastIndex = 0;
  }
  targets.forEach(node=>{
    const frag = document.createDocumentFragment();
    let last = 0, m;
    RE.lastIndex = 0;
    while((m = RE.exec(node.nodeValue))){
      if(m.index > last) frag.appendChild(document.createTextNode(node.nodeValue.slice(last, m.index)));
      if(m[1] !== undefined){                       // **볼드** — 기호는 제거
        const b = document.createElement('b'); b.textContent = m[1];
        frag.appendChild(b);
      }else if(m[2] !== undefined){                 // *기울임* — 기호는 제거
        const it = document.createElement('i'); it.textContent = m[2];
        frag.appendChild(it);
      }else if(m[3] !== undefined){                 // "보조색" — 따옴표 유지
        const s = document.createElement('span');
        s.style.color = subColor; s.textContent = `"${m[3]}"`;
        frag.appendChild(s);
      }else{                                        // (괄호색) — 괄호 유지
        const s = document.createElement('span');
        s.style.color = parenColor; s.textContent = `(${m[4]})`;
        frag.appendChild(s);
      }
      last = m.index + m[0].length;
    }
    if(last < node.nodeValue.length) frag.appendChild(document.createTextNode(node.nodeValue.slice(last)));
    node.parentNode.replaceChild(frag, node);
  });
}

/* ============================================================
   본문 공통 서식 — 코드 블록(```) / 접기(▸) / 복사 버튼
   ------------------------------------------------------------
   LOG 와 ARCHIVE 게시글에 함께 적용합니다.
   본문은 contenteditable 이 만든 HTML 이라 줄바꿈이 <br> 로 들어오기도,
   <div> 로 감싸지기도 합니다. ``` 가 어느 줄에 있는지 알아야 하므로
   최상위 자식들을 먼저 줄 단위로 묶은 뒤 처리합니다.
   ============================================================ */
const CODE_FENCE = '```';
/* 편집기는 연속된 공백을 줄바꿈 없는 공백(&nbsp;)으로 넣습니다.
   코드 들여쓰기가 깨지므로 평범한 공백으로 되돌립니다. */
const NBSP_RE = / /g;
const BLOCK_TAGS = ['DIV','P','LI','UL','OL','H1','H2','H3','H4','H5','H6',
                    'BLOCKQUOTE','PRE','HR','TABLE','FIGURE'];

/* 본문 전체를 줄바꿈이 살아있는 순수 텍스트로 펼치면서, 그 텍스트의 각 글자가
   원래 어느 DOM 위치(문자/자식 인덱스)에 있었는지도 함께 기록합니다.
   contenteditable 이 만드는 DOM 은 줄마다 모양이 들쭉날쭉해서(앞 내용과 아무
   경계 없이 이어 붙기도, <br> 하나로만 끊기기도, <div> 로 감싸이기도 합니다)
   최상위 자식만 보고 '줄'을 나누면 뒤쪽 코드 블록을 놓치는 경우가 있었습니다.
   이 좌표를 그대로 Range 경계로 써서 정확히 그 구간만 지우고 코드 블록을
   끼워 넣기 위한 것입니다. */
function flattenForFences(root){
  let text = '';
  const marks = [];   // { pos, container, offset } — Range 경계로 바로 쓸 수 있는 DOM 위치
  const mark = (container, offset)=> marks.push({ pos:text.length, container, offset });
  const childIndex = (node)=> Array.prototype.indexOf.call(node.parentNode.childNodes, node);

  /* 블록 여닫는 경계는 그 자체가 내용이 아니라 인접한 블록끼리 구분만
     지어주면 되는 표시라서, 실제 줄바꿈 글자는 앞이 이미 줄바꿈이면 새로
     더하지 않습니다(안 그러면 <div>A</div><div>B</div> 처럼 붙어 있는 두 줄
     사이에 그 경계가 두 번(닫힘+열림) 잡혀 없던 빈 줄이 생깁니다).
     그래도 마크 자체는 매번 남겨야 합니다 — 접기처럼 여러 단계 경계가 같은
     글자 자리에 겹칠 때(예: 제목 줄이 끝나고 곧바로 내용 칸이 시작하는 자리는
     'fold-head 가 끝나는 자리'이면서 동시에 'fold-body 가 시작하는 자리'),
     나중에 남긴(더 안쪽) 마크가 그 자리의 대표가 되어야 실제로 커서가 있는
     안쪽 위치로 정확히 찾아갑니다. <br> 와 텍스트 속 실제 줄바꿈 문자는
     사용자가 직접 넣은 내용이라 겹치더라도(빈 줄을 의도한 것일 수 있으니)
     글자 자체는 항상 더합니다. */
  const addBoundary = (container, offset)=>{
    if(text.length && !text.endsWith('\n')) text += '\n';
    mark(container, offset);
  };
  function walkText(node){
    const s = node.data;
    let start = 0;
    for(let i=0;i<s.length;i++){
      if(s[i] === '\n'){
        if(i > start){ mark(node, start); text += s.slice(start, i); }
        text += '\n';
        mark(node, i+1);
        start = i + 1;
      }
    }
    if(start < s.length){ mark(node, start); text += s.slice(start); }
  }
  function walk(node){
    if(node.nodeType === 3){ walkText(node); return; }
    if(node.nodeType !== 1) return;
    if(node.tagName === 'BR'){ text += '\n'; mark(node.parentNode, childIndex(node)+1); return; }
    const isBlock = BLOCK_TAGS.includes(node.tagName);
    if(isBlock) addBoundary(node.parentNode, childIndex(node));
    Array.from(node.childNodes).forEach(walk);
    if(isBlock) addBoundary(node.parentNode, childIndex(node) + 1);
  }
  Array.from(root.childNodes).forEach(walk);
  addBoundary(root, root.childNodes.length);
  return { text: text.replace(NBSP_RE,' '), marks };   // 치환은 글자 수를 바꾸지 않아 좌표가 그대로 맞습니다
}
/* marks 는 위치(pos) 오름차순입니다. pos 이하인 마지막 마크를 찾아 그 마크가
   가리키는 DOM 위치에서 (pos - 마크.pos) 만큼 더한 지점이 실제 Range 경계입니다. */
function resolveFenceOffset(marks, pos){
  let best = marks[0];
  for(let i=0;i<marks.length;i++){
    if(marks[i].pos <= pos) best = marks[i]; else break;
  }
  return { container: best.container, offset: best.offset + (pos - best.pos) };
}
/* 한 줄을 끝맺는 것들 — <br> 뿐 아니라 사진·구분선·이미 만들어진 코드 상자처럼
   자기 줄을 차지하는(display:block) 것들도 줄을 나눕니다. 글자로는 아무것도
   내놓지 않아 펼친 텍스트에서는 앞줄과 같은 자리에 붙어 보이지만, 화면에서는
   분명히 다른 줄이고 무엇보다 지워지면 안 되는 내용입니다. */
function isLineSeparator(node){
  if(!node || node.nodeType !== 1) return false;
  if(node.tagName === 'BR' || node.tagName === 'IMG') return true;
  if(BLOCK_TAGS.includes(node.tagName)) return true;
  return node.classList && (node.classList.contains('code-block') || node.classList.contains('code-embed'));
}
/* 펜스 글자를 감싼 가장 가까운 블록 요소(el, 예: .fold-body) 안에서, 그 글자가
   속한 '줄'만 골라 경계를 찾습니다 — el 전체가 아닙니다. el 은 흔히 한 줄짜리
   그릇(접기 안에서 줄마다 따로 감싸인 <div> 하나)이지만, 줄을 <br> 로만 나눈
   경우엔 el 하나(예: .fold-body 자신) 안에 여러 줄이 형제로 같이 들어있을 수
   있습니다 — 그때 el 전체를 지우면 그 안의 다른 줄까지 함께 사라집니다.
   특히 `<div class="fold-body"><img>```</div>` 처럼 사진과 여는 펜스가 <br> 도
   없이 한 그릇에 들어있는 글이 실제로 저장돼 있어서(접기 안에 사진을 넣고 바로
   백틱을 친 경우), <br> 만 찾으면 그 사진까지 지워집니다. 그래서 사진·구분선
   같은 것도 줄 끝으로 봅니다(isLineSeparator).
   그 방향에 줄 끝이 하나도 없으면 el 자체가 통째로 한 줄이라는 뜻이므로,
   el 을 지울 단위로 보고 el 의 부모 안에서 el 의 위치를 씁니다. */
function localLineBoundary(el, node, dir){
  let cur = node;
  while(cur.parentNode !== el) cur = cur.parentNode;
  let sib = dir < 0 ? cur.previousSibling : cur.nextSibling;
  while(sib){
    if(isLineSeparator(sib)){
      const idx = Array.prototype.indexOf.call(el.childNodes, sib);
      return { container: el, offset: dir < 0 ? idx + 1 : idx };
    }
    sib = dir < 0 ? sib.previousSibling : sib.nextSibling;
  }
  const parent = el.parentNode;
  const idx = Array.prototype.indexOf.call(parent.childNodes, el);
  return { container: parent, offset: dir < 0 ? idx : idx + 1 };
}
/* 펜스 글자가 있는 지점에서 그 글자를 감싼 '줄'의 시작 또는 끝 위치를 찾습니다.
   접기처럼 여러 단계로 중첩된 곳에서는 이 방법만 확실합니다 — 좌표(글자 수)
   기준으로는 '닫는 경계가 여러 겹 겹치는 자리'에서 가장 안쪽 경계인지 가장
   바깥쪽 경계인지 좌표만 보고는 구별할 수 없기 때문입니다(여는 경계는 안쪽이
   나중에 잡혀 항상 안쪽이 이기지만, 닫는 경계는 반대로 안쪽이 먼저 잡혀 좌표만
   보면 바깥쪽으로 밀려납니다). 감싸는 블록 요소가 없으면(문단 없이 편집기에
   바로 붙어 있는 글자) null 을 돌려주고, 부르는 쪽이 좌표 기반 좌표로 대신합니다. */
function fenceLineBoundary(root, point, after){
  let el = point.container.nodeType === 3 ? point.container.parentNode : point.container;
  while(el && el !== root && !BLOCK_TAGS.includes(el.tagName)) el = el.parentNode;
  if(!el || el === root) return null;
  return localLineBoundary(el, point.container, after ? 1 : -1);
}

function makeCodeBlock(code){
  const box = document.createElement('div');
  box.className = 'code-block';
  box.setAttribute('contenteditable','false');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'code-block-copy'; btn.innerText = '⧉';
  const pre = document.createElement('pre');
  pre.className = 'code-block-body';
  pre.textContent = code.replace(NBSP_RE,' ').replace(/^\n+|\n+$/g,'');
  box.appendChild(btn); box.appendChild(pre);
  return box;
}

/* ``` 로 감싼 구간을 코드 블록으로 바꿉니다.
   ``` 는 각각 자기 줄에 두는 것을 기준으로 하고(한 줄에서 열고 닫는 것도 됩니다),
   닫는 ``` 이 없으면 손대지 않고 원문 그대로 둡니다.
   여러 개가 있으면 문서 순서대로 (1,2)(3,4)(5,6)... 쌍을 짓고, 마지막에 짝이
   안 맞는 하나가 남으면 손대지 않습니다. */
function applyCodeFences(root){
  const { text, marks } = flattenForFences(root);
  const fenceLen = CODE_FENCE.length;
  const positions = [];
  let idx = text.indexOf(CODE_FENCE);
  while(idx >= 0){ positions.push(idx); idx = text.indexOf(CODE_FENCE, idx + fenceLen); }
  if(positions.length < 2) return;

  const pairs = [];
  for(let k=0; k+1 < positions.length; k+=2) pairs.push([positions[k], positions[k+1]]);

  /* 뒤에서부터 지웁니다 — marks 는 지우기 전 좌표 기준이라, 앞에서부터 지우면
     이미 지운 자리 뒤에 있던 좌표들이 다 밀려 어긋납니다.
     닫는 펜스와 다음 블록의 여는 펜스가 어쩌다 같은 줄에 놓이면(정상적인
     사용에서는 안 생기지만) 두 블록이 지울 범위가 겹칠 수 있습니다 — 이미
     처리한(뒤쪽) 블록이 차지한 자리와 겹치는 블록은 건드리지 않고 원문 그대로 둡니다. */
  let claimedFrom = text.length + 1;
  for(let p = pairs.length - 1; p >= 0; p--){
    const [openPos, closePos] = pairs[p];
    const nextNl = text.indexOf('\n', openPos + fenceLen);
    const sameLine = nextNl === -1 || nextNl >= closePos;   // 한 줄 안에서 열고 닫은 경우

    let code;
    if(sameLine){
      code = text.slice(openPos + fenceLen, closePos);
    }else{
      const codeStart = nextNl + 1;
      const closeLineStart = text.lastIndexOf('\n', closePos - 1) + 1;
      const codeEnd = Math.max(codeStart, closeLineStart > 0 ? closeLineStart - 1 : closeLineStart);
      code = text.slice(codeStart, codeEnd);
    }

    // 지울 범위(문자열 좌표) — 겹침 검사와, 감싸는 블록이 없을 때의 대체 계산에 씁니다
    const delStart = text.lastIndexOf('\n', openPos - 1) + 1;
    let delEnd = text.indexOf('\n', closePos + fenceLen);
    delEnd = delEnd < 0 ? text.length : delEnd + 1;
    if(delEnd > claimedFrom) continue;   // 뒤쪽 블록과 범위가 겹침

    try{
      /* 실제로 지울 DOM 범위는 펜스를 감싼 가장 가까운 블록 요소(줄) 기준으로
         잡습니다 — 접기처럼 여러 단계 중첩된 곳에서 좌표만으로는 '닫는 경계가
         겹치는 자리'가 안쪽인지 바깥쪽인지 구별할 수 없기 때문입니다
         (fenceLineBoundary 주석 참고). 감싸는 블록이 없는 경우에만 좌표 기반으로
         돌아갑니다. */
      const openPoint = resolveFenceOffset(marks, openPos);
      const closePoint = resolveFenceOffset(marks, closePos);
      const startPoint = fenceLineBoundary(root, openPoint, false) || resolveFenceOffset(marks, delStart);
      const endPoint = fenceLineBoundary(root, closePoint, true) || resolveFenceOffset(marks, delEnd);
      const range = document.createRange();
      range.setStart(startPoint.container, startPoint.offset);
      range.setEnd(endPoint.container, endPoint.offset);
      range.deleteContents();
      range.insertNode(makeCodeBlock(code));
      claimedFrom = delStart;
    }catch(e){ /* 예상 밖의 DOM 모양이면 이 블록은 건드리지 않고 넘어갑니다 */ }
  }
}

/* ============================================================
   마크다운 — 줄 단위 서식 (인용문 / 글머리 / 표)
   ------------------------------------------------------------
   코드 블록과 완전히 같은 방식으로 동작합니다: 본문을 줄바꿈이 살아있는
   글자열로 펼쳐(flattenForFences) 어느 줄이 무엇인지 정한 다음, 그 줄이
   차지한 DOM 범위만 골라 바꿔치웁니다. 최상위 자식만 훑어서는 안 되는
   이유도 같습니다(줄이 <div> 로 감싸이기도, <br> 로만 끊기기도 합니다).
   *기울임* 같은 한 줄 안의 서식은 여기가 아니라 applyAutoFormat 이 맡습니다.
   ============================================================ */
const MD_HEADING_RE = /^(#{1,6})\s+(\S.*)$/;
/* |---|---| 처럼 생긴 표의 구분줄. 칸이 둘 이상이어야 표로 봅니다 —
   글에서 그냥 쓴 --- 한 줄을 표로 잘못 읽지 않게. */
const MD_TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;
/* | 로 감싼 한 줄을 칸으로 자릅니다 (양 끝의 | 는 있어도 없어도 됩니다) */
function mdTableCells(line){
  let s = line.trim();
  if(s.startsWith('|')) s = s.slice(1);
  if(s.endsWith('|'))   s = s.slice(0, -1);
  return s.split('|').map(c=> c.trim());
}
function mdBuildTable(rows){
  const table = document.createElement('table');
  table.className = 'md-table';
  const head = document.createElement('thead');
  const hr = document.createElement('tr');
  mdTableCells(rows[0]).forEach(c=>{
    const th = document.createElement('th'); th.textContent = c; hr.appendChild(th);
  });
  head.appendChild(hr); table.appendChild(head);
  const body = document.createElement('tbody');
  rows.slice(2).forEach(line=>{
    const tr = document.createElement('tr');
    mdTableCells(line).forEach(c=>{
      const td = document.createElement('td'); td.textContent = c; tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  if(body.childNodes.length) table.appendChild(body);
  return table;
}
function mdBuildQuote(lines){
  const q = document.createElement('blockquote');
  q.className = 'md-quote';
  lines.forEach((line, i)=>{
    if(i) q.appendChild(document.createElement('br'));
    q.appendChild(document.createTextNode(line.trim().replace(/^>\s?/, '')));
  });
  return q;
}
function mdBuildHeading(line){
  const m = line.trim().match(MD_HEADING_RE);
  const h = document.createElement('h' + m[1].length);
  h.className = 'md-h';
  h.textContent = m[2].trim();
  return h;
}
/* 코드 블록·코드 상자 안의 글은 적은 그대로 보여야 하므로 건드리지 않습니다 */
function mdInsideCode(point){
  const el = point.container.nodeType === 3 ? point.container.parentNode : point.container;
  return !!(el && el.closest && el.closest('.code-block, .code-embed'));
}
function applyMarkdownBlocks(root){
  const { text, marks } = flattenForFences(root);
  if(!text) return;
  const lines = [];
  let pos = 0;
  text.split('\n').forEach(s=>{ lines.push({ s, start:pos, end:pos + s.length }); pos += s.length + 1; });

  /* 무엇을 무엇으로 바꿀지 먼저 다 정해 둡니다. 한 줄이 두 군데에 들어가는 일이
     없도록 묶음을 잡을 때마다 그만큼 건너뜁니다. */
  const groups = [];
  for(let i=0;i<lines.length;i++){
    const t = lines[i].s.trim();
    if(!t) continue;
    // 표 — 머리줄 바로 아래에 구분줄이 있어야 표입니다
    if(t.includes('|') && i+1 < lines.length && MD_TABLE_SEP_RE.test(lines[i+1].s.trim())){
      let j = i + 2;
      while(j < lines.length && lines[j].s.trim() && lines[j].s.includes('|')) j++;
      groups.push({ kind:'table', from:i, to:j-1 });
      i = j - 1; continue;
    }
    // 인용문 — 이어지는 > 줄들을 한 덩어리로 묶습니다
    if(t.startsWith('>')){
      let j = i;
      while(j < lines.length && lines[j].s.trim().startsWith('>')) j++;
      groups.push({ kind:'quote', from:i, to:j-1 });
      i = j - 1; continue;
    }
    if(MD_HEADING_RE.test(t)) groups.push({ kind:'heading', from:i, to:i });
  }
  if(!groups.length) return;

  /* 뒤에서부터 바꿉니다 — marks 는 바꾸기 전 좌표라, 앞에서부터 손대면
     그 뒤 좌표가 전부 밀립니다 (코드 블록과 같은 이유). */
  for(let g = groups.length - 1; g >= 0; g--){
    const grp = groups[g];
    const first = lines[grp.from], last = lines[grp.to];
    try{
      const startPoint = resolveFenceOffset(marks, first.start);
      const lastPoint  = resolveFenceOffset(marks, Math.max(first.start, last.end - 1));
      if(mdInsideCode(startPoint) || mdInsideCode(lastPoint)) continue;
      const s = fenceLineBoundary(root, startPoint, false) || startPoint;
      const e = fenceLineBoundary(root, lastPoint, true)
             || resolveFenceOffset(marks, Math.min(text.length, last.end + 1));
      const rows = [];
      for(let k=grp.from; k<=grp.to; k++) rows.push(lines[k].s);
      const node = grp.kind==='table' ? mdBuildTable(rows)
                 : grp.kind==='quote' ? mdBuildQuote(rows)
                 : mdBuildHeading(rows[0]);
      const range = document.createRange();
      range.setStart(s.container, s.offset);
      range.setEnd(e.container, e.offset);
      range.deleteContents();
      range.insertNode(node);
    }catch(err){ /* 예상 밖의 DOM 모양이면 이 줄은 건드리지 않고 넘어갑니다 */ }
  }
}

/* 예전에 넣은 코드 상자에는 복사 버튼이 없으므로 그릴 때 채워 넣습니다 */
function ensureCodeEmbedCopy(root){
  root.querySelectorAll('.code-embed').forEach(embed=>{
    const bar = embed.querySelector('.code-embed-toolbar');
    if(!bar || bar.querySelector('.code-embed-copy')) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'code-embed-copy'; btn.title = '코드 복사';
    btn.innerText = '⧉';
    bar.insertBefore(btn, bar.querySelector('.code-embed-download') || null);
  });
}

/* 게시글 본문 한 번에 처리 — 코드 블록 + 줄 단위 마크다운 + 코드 상자 복사 버튼.
   코드 블록을 먼저 만들어야 그 안의 # 이나 | 를 마크다운으로 잘못 읽지 않습니다. */
function decorateContent(el){
  applyCodeFences(el);
  applyMarkdownBlocks(el);
  ensureCodeEmbedCopy(el);
}

/* navigator.clipboard 는 https / localhost 에서만 동작합니다.
   막히면 화면 밖 textarea 를 만들어 예전 방식으로 복사합니다. */
async function copyText(text){
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch(e){ /* 아래 대체 경로로 넘어갑니다 */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try{ ok = document.execCommand('copy'); }catch(e){ ok = false; }
  ta.remove();
  return ok;
}

/* 본문은 열 때마다 새로 그려지므로 문서에 한 번만 걸어둡니다 */
function initContentBlocks(){
  document.addEventListener('click', async (e)=>{
    if(!(e.target instanceof Element)) return;

    const copyBtn = e.target.closest('.code-block-copy, .code-embed-copy');
    if(copyBtn){
      e.preventDefault(); e.stopPropagation();
      const box = copyBtn.closest('.code-block, .code-embed');
      const body = box && box.querySelector('.code-block-body, .code-embed-code');
      const label = copyBtn.innerText;
      const ok = await copyText(body ? body.textContent : '');
      copyBtn.innerText = ok ? '✓' : '✕';
      setTimeout(()=>{ copyBtn.innerText = label; }, 1200);
      return;
    }

    /* 접기 — 편집 중에도 접었다 펼 수 있어야 하므로,
       글을 쓰는 중에는 화살표만 반응합니다(제목 줄을 누르면 커서가 가야 하니까).
       읽을 때는 제목 줄 아무 데나 눌러도 열립니다. */
    const arrow = e.target.closest('.fold-arrow');
    const head  = e.target.closest('.fold-head');
    const block = (arrow || head) && (arrow || head).closest('.fold-block');
    if(block){
      const editing = !!block.closest('[contenteditable="true"]');
      if(editing && !arrow) return;
      setFoldOpen(block, !block.classList.contains('open'));
    }
  });

  /* 화살표를 누를 때 편집기 커서가 튀지 않게 합니다 */
  document.addEventListener('mousedown', (e)=>{
    if(e.target instanceof Element && e.target.closest('.fold-arrow')) e.preventDefault();
  });
}

function setFoldOpen(block, open){
  block.classList.toggle('open', open);
  const a = block.querySelector('.fold-arrow');
  if(a) a.textContent = open ? '▾' : '▸';
}

/* 접기 블록을 편집기에 넣습니다 (ARCHIVE·LOG·OC 자유 텍스트가 함께 씁니다).
   타이틀·내용은 실제 글자가 아니라 안내 문구(CSS :empty:before, OC 자유 텍스트와
   같은 방식)라서 지울 필요 없이 바로 이어 쓸 수 있습니다. 넣자마자 펼친 상태로
   만들고, 저장할 때 editorHtml() 이 .open 을 떼어내 게시글에서는 접힌 채로
   시작합니다.
   execCommand 대신 Range.insertNode() 로 직접 넣습니다 — 커서가 이미 다른 접기의
   내용 칸 안에 있으면 그 자리에 그대로 끼워져 접기 안에 접기가 중첩됩니다. */
function insertFoldBlock(editorId){
  const editor = document.getElementById(editorId);
  if(!editor) return;
  editor.focus();
  const sel = window.getSelection();
  let range = (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer))
    ? sel.getRangeAt(0) : null;
  if(!range){
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();

  const block = document.createElement('div');
  block.className = 'fold-block open';
  block.innerHTML =
    '<div class="fold-head"><span class="fold-arrow" contenteditable="false">▾</span>'
    + '<span class="fold-title"></span></div>'
    + '<div class="fold-body"></div>';
  const frag = document.createDocumentFragment();
  frag.appendChild(block);
  frag.appendChild(document.createElement('br'));
  range.insertNode(frag);

  const titleRange = document.createRange();
  titleRange.selectNodeContents(block.querySelector('.fold-title'));
  titleRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(titleRange);
}

/* 접기 안에서 엔터 — 타이틀과 내용 칸 두 자리를 다 다룹니다.

   타이틀: 접힌 상태(제목만 보임)면 이 접기를 벗어나 상위(중첩된 접기라면 그
   부모의 내용 칸, 아니면 최상위 본문)에 새 줄을 만들어 나가고, 펼친 상태
   (내용까지 보임)면 벗어나지 않고 내용 칸 맨 앞에 줄바꿈을 넣어 그리로
   들어갑니다. 두 경우 모두 '접기 블록 바로 뒤/안'에 <br> 하나만 끼워 넣는
   것이라, 중첩 깊이에 상관없이 같은 코드로 됩니다.

   내용 칸(.fold-body): 브라우저 기본 동작에 맡기면 안 됩니다 — Chrome 은 엔터로
   블록을 나눌 때 원래 요소의 class 를 그대로 물려받은 새 형제 <div class="fold-body">
   를 만들어버려서, 한 접기 안에 .fold-body 가 여러 개 나란히 남습니다. 그러면
   `.fold-block:not(.open) .fold-body{display:none}` 가 그 중 일부만(또는 전부를
   각각) 숨기게 되어, 그 사이에 백틱 코드블록이라도 끼어들면 접어도 안 사라지고
   접기 밖으로 빠져나온 것처럼 보입니다. 그래서 여기서는 항상 같은 칸 안에서
   <br> 로만 줄을 바꾸도록 가로챕니다. */
/* <br> 뒤에 커서를 두되, 그 br 이 칸의 마지막 자식이 되면(뒤에 실제 내용이
   없으면) 커서 위치가 불안정해집니다 — Chrome 의 execCommand('insertText')/
   실제 타이핑이 "그 다음에 올 글자"를 이 br 뒤가 아니라 앞(원래 텍스트 쪽)에
   붙여버리는 경우가 있습니다(자리는 정확히 "br 뒤"인데도). 그래서 항상 br
   뒤에 무언가(원래 있던 다음 형제, 없으면 채움용 <br> 하나)를 두고 그 앞에
   커서를 놓습니다 — "그 다음 형제 앞"은 안정적으로 해석됩니다. */
function placeCursorAfterBr(sel, br){
  let next = br.nextSibling;
  if(!next || (next.nodeType===3 && !next.data)){
    if(next) next.remove();
    next = document.createElement('br');
    br.parentNode.insertBefore(next, br.nextSibling);
  }
  const r = document.createRange();
  r.setStartBefore(next);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}
function initFoldEnter(editorId){
  const editor = document.getElementById(editorId);
  if(!editor) return;
  editor.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter' || e.shiftKey) return;
    const sel = window.getSelection();
    if(!sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType===1 ? range.startContainer : range.startContainer.parentElement;

    const title = startEl && startEl.closest('.fold-title');
    if(title && editor.contains(title)){
      e.preventDefault();
      const block = title.closest('.fold-block');
      const br = document.createElement('br');
      if(block.classList.contains('open')){
        const body = block.querySelector(':scope > .fold-body');
        body.insertBefore(br, body.firstChild);
      }else{
        block.parentNode.insertBefore(br, block.nextSibling);
      }
      placeCursorAfterBr(sel, br);
      return;
    }

    const body = startEl && startEl.closest('.fold-body');
    if(body && editor.contains(body)){
      e.preventDefault();
      range.deleteContents();
      const br = document.createElement('br');
      range.insertNode(br);
      placeCursorAfterBr(sel, br);
    }
  });
}

/* 인용구 삽입 (ARCHIVE·OC 자유 텍스트가 함께 씁니다).
   execCommand('formatBlock','blockquote') 는 커서가 들어 있는 가장 가까운
   블록 요소를 통째로 blockquote 로 바꿔치기합니다 — 접기 안에서 쓰면 그
   '가장 가까운 블록'이 .fold-body 자신이라, 접기 구조를 감싸버리고 맙니다
   (`<blockquote><div class="fold-body">...`). insertFoldBlock 과 같은 방식으로
   Range 에 직접 넣어서, 접기 안이든 밖이든 커서가 있는 자리에만 끼워 넣습니다. */
function insertBlockquote(editorId){
  const editor = document.getElementById(editorId);
  if(!editor) return;
  editor.focus();
  const sel = window.getSelection();
  if(!sel.rangeCount || !editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  const range = sel.getRangeAt(0);
  const collapsed = range.collapsed;
  const bq = document.createElement('blockquote');
  if(collapsed) bq.appendChild(document.createElement('br'));
  else bq.appendChild(range.extractContents());
  range.insertNode(bq);

  const r = document.createRange();
  r.selectNodeContents(bq);
  r.collapse(collapsed);
  sel.removeAllRanges();
  sel.addRange(r);
}

/* 저장할 본문을 꺼냅니다 — 펼쳐둔 접기 블록은 접힌 상태로 되돌립니다 */
function editorHtml(editorId){
  const copy = document.getElementById(editorId).cloneNode(true);
  copy.querySelectorAll('.fold-block.open').forEach(b=> setFoldOpen(b, false));
  return copy.innerHTML;
}

/* 저장된 본문을 화면에 그릴 때 쓰는 렌더러 */
function renderLogContentInto(el, entry){
  /* 본문 안에 박힌 사진도 아직 안 왔을 수 있습니다 — 오면 본문만 다시 그립니다 */
  const paintBody = ()=>{
    el.innerHTML = imgUrl(logContentToHtml(entry.content));
    decorateContent(el);
    applyAutoFormat(el,
      entry.subColor   || LOG_SUB_COLOR_DEFAULT,
      entry.parenColor || LOG_PAREN_COLOR_DEFAULT);
  };
  paintBody();
  whenImgArrives(entry.content, el, paintBody);
}

/* --- Log (작성 시각 자동, 15개씩 페이지네이션, 행 크기/폰트는 완전 고정) --- */
let pdLogPage = 1;
/* 지금 보고 있는 LOG 폴더 (창을 열 때 그 글의 첫 폴더로 맞춥니다) */
let currentLogFolderId = null;
let draggedLogId = null;
/* 선택 모드 — ARCHIVE 의 표 화면과 같은 방식입니다 */
let logSelectMode = false;
let logSelectedIds = new Set();
let logSearchTerm = '';
let logSearchField = 'title';
let logSearchDate = '';     // YYYY-MM-DD, 비우면 전체 기간

/* 게시일 문자열에서 날짜 부분만 뽑는다 (예: "2026-07-30 14:02" → "2026-07-30") */
function dateKeyOf(entry){
  const d = String(entry.date||'');
  const m = d.match(/\d{4}[-.\/]\d{1,2}[-.\/]\d{1,2}/);
  if(!m) return '';
  const [y,mo,da] = m[0].split(/[-.\/]/);
  return `${y}-${String(mo).padStart(2,'0')}-${String(da).padStart(2,'0')}`;
}

/* 검색은 보기 모드(LOCKED)에서만 적용합니다.
   게시일과 제목/내용은 각각 독립적으로 걸립니다(둘 다 있으면 AND).
   게시일을 비워두면 전체 기간이 대상입니다. */
function filterLogItems(items){
  if(isLoggedIn) return items;
  const q = logSearchTerm.trim().toLowerCase();
  const day = logSearchDate;
  if(!q && !day) return items;
  return items.filter(entry=>{
    if(day && dateKeyOf(entry) !== day) return false;
    if(!q) return true;
    if(logSearchField==='title') return (entry.title||'').toLowerCase().includes(q);
    // 내용은 서식 태그를 걷어내고 글자만 비교
    return htmlToPlainText(entry.content||'').toLowerCase().includes(q);
  });
}

function renderLogList(p){
  const wrap=lq('.log-list');
  /* 폴더가 하나뿐이면 보기 모드에서는 탭 줄을 아예 내보내지 않습니다 —
     고를 것이 없는 탭 하나가 목록 높이만 가져가기 때문입니다.
     탭 줄이 뜨는 보기 모드에서는 그 높이만큼(한 줄) 페이지 크기를 줄입니다 —
     보기 모드는 아래에 검색 줄까지 있어 15줄이 딱 맞게 들어차 있었습니다. */
  const showFolderBar = isLoggedIn || (p.logFolders||[]).length>1;
  const perPage = (!isLoggedIn && showFolderBar) ? 14 : 15;
  renderLogFolderBar(p, showFolderBar);
  /* 지금 고른 폴더의 글만 보여줍니다 (갤러리·PROMPT 와 같은 규칙) */
  const folder = (p.logFolders||[]).find(f=>f.id===currentLogFolderId) || (p.logFolders||[])[0];
  if(folder) currentLogFolderId = folder.id;
  /* 잠긴 비밀 폴더는 목록을 아예 그리지 않습니다 */
  if(folder && folderLocked(folder)){
    wrap.innerHTML = '<div class="gallery-locked log-locked"><div class="gl-icon">🔒</div>'
      + '<div class="gl-text">비밀 폴더입니다.</div>'
      + '<button type="button" class="btn-ghost log-unlock-btn">비밀번호 입력</button></div>';
    const ub = wrap.querySelector('.log-unlock-btn');
    if(ub) ub.addEventListener('click', ()=> openFolderUnlock(folder, ()=> renderLogList(p)));
    return;
  }
  const inFolder = folder ? p.log.filter(x=> logFolderIdOf(p,x)===folder.id) : p.log.slice();
  const all = inFolder.slice().reverse();
  const found = filterLogItems(all);
  /* 안내글은 목록 칸 한가운데에 놓습니다 (갤러리의 '이미지가 없어요' 와 같은 자리) */
  if(all.length===0){ wrap.innerHTML='<div class="empty-note log-empty-note">등록된 게시글이 없어요.</div>'; return; }
  if(found.length===0){ wrap.innerHTML='<div class="empty-note log-empty-note">검색 결과가 없어요.</div>'; return; }
  /* 고정한 글이 맨 위로 올라옵니다 (ARCHIVE 와 같은 방식, 최대 3개) */
  const items = [...found.filter(x=>x.pinned).slice(0,3), ...found.filter(x=>!x.pinned)];
  /* 화면에 보이는 No 는 이 폴더 안의 등록 순서로 매깁니다 —
     그래야 고정하거나 검색해도 같은 글의 번호가 바뀌지 않습니다. */
  const displayNo = new Map(inFolder.map((it,i)=>[it, i+1]));
  const totalPages = Math.max(1, Math.ceil(items.length/perPage));
  if(pdLogPage>totalPages) pdLogPage=totalPages;
  if(pdLogPage<1) pdLogPage=1;
  const start=(pdLogPage-1)*perPage;
  const pageItems = items.slice(start, start+perPage);

  /* 선택 모드에서는 표 맨 앞에 체크 칸이 하나 더 붙습니다 (ARCHIVE 와 같은 모양) */
  const sel = isLoggedIn && logSelectMode;
  let rows='';
  pageItems.forEach((entry, i)=>{
    const checked = logSelectedIds.has(entry.id);
    rows += `<tr data-abs="${start+i}"${checked?' class="selected"':''}>`
      + (sel?`<td class="arc-td-check"><div class="gallery-check${checked?' checked':''}">${checked?'✓':''}</div></td>`:'')
      + `<td>${displayNo.get(entry)||''}</td><td class="log-td-title">${entry.pinned?'<span class="arc-pin-tag">📌</span> ':''}${escapeHtml(entry.title)}</td><td>${entry.date||''}</td></tr>`;
  });
  let pag='';
  if(totalPages>1){
    pag += `<button class="log-pg-btn" data-pg="prev" ${pdLogPage===1?'disabled':''}>&lt;</button>`;
    for(let i=1;i<=totalPages;i++){ pag += `<button class="log-pg-btn ${i===pdLogPage?'active':''}" data-pg="${i}">${i}</button>`; }
    pag += `<button class="log-pg-btn" data-pg="next" ${pdLogPage===totalPages?'disabled':''}>&gt;</button>`;
  }
  wrap.innerHTML = `<div class="log-table-scroll"><table class="log-table" id="pdLogTable"><thead><tr>${sel?'<th class="arc-th-check"></th>':''}<th>No</th><th>LOG</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="log-pagination-slot">${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}</div>`;
  updateLogSelectBtns();

  wrap.querySelectorAll('tr[data-abs]').forEach(tr=>{
    const entry = items[Number(tr.dataset.abs)];
    tr.addEventListener('click', ()=>{
      if(sel){
        if(logSelectedIds.has(entry.id)) logSelectedIds.delete(entry.id);
        else logSelectedIds.add(entry.id);
        renderLogList(p);
        return;
      }
      openLogView(entry);
    });
    /* 편집 모드에서는 줄을 끌어다 폴더 탭에 놓아 옮길 수 있습니다 */
    if(isLoggedIn){
      tr.setAttribute('draggable','true');
      tr.addEventListener('dragstart', (e)=>{
        draggedLogId = entry.id;
        tr.classList.add('dragging');
        if(e.dataTransfer){ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', String(entry.id)); }
      });
      tr.addEventListener('dragend', ()=>{ tr.classList.remove('dragging'); draggedLogId=null; });
    }
  });
  wrap.querySelectorAll('.log-pg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.pg==='prev') pdLogPage=Math.max(1,pdLogPage-1);
      else if(btn.dataset.pg==='next') pdLogPage=Math.min(totalPages,pdLogPage+1);
      else pdLogPage=Number(btn.dataset.pg);
      renderLogList(p);
    });
  });
}

/* 선택 모드 단추 두 개의 표시를 지금 상태에 맞춥니다.
   요소는 id 가 아니라 지금 열려 있는 창(logHost.root) 안에서 찾습니다 —
   PAIR·OC 두 벌이 동시에 화면에 있기 때문입니다. */
function updateLogSelectBtns(){
  const selBtn = lq('.log-select-btn');
  const delBtn = lq('.log-select-delete');
  if(selBtn){
    selBtn.innerText = logSelectMode ? '선택 취소' : '선택';
    selBtn.classList.toggle('active', logSelectMode);
  }
  if(delBtn) delBtn.style.display = logSelectMode ? '' : 'none';
}

/* ---- LOG 폴더 탭 줄 ----
   OC·ARCHIVE 는 폴더를 상단바 드롭다운에서 고르지만, LOG 는 갤러리와 마찬가지로
   상세 창 안이라 얹을 상단바가 없습니다 — 그래서 갤러리와 같은 탭 줄을 씁니다.
   다만 목록 높이를 뺏지 않도록 새 줄을 만들지 않고, 이미 있던 '＋ 게시글 추가'
   줄의 왼쪽 빈 자리에 넣습니다. */
function renderLogFolderBar(p, show){
  const bar = lq('.log-folder-bar');
  if(!bar) return;
  bar.innerHTML='';
  if(show===false) return;
  const folders = p.logFolders || [];
  folders.forEach(f=>{
    const btn=document.createElement('button');
    btn.type='button'; btn.className='gallery-folder-tab'+(f.id===currentLogFolderId?' active':'');
    if(f.secret){
      const lock=document.createElement('span');
      lock.className='gf-lock'; lock.innerText='🔒'; lock.title='비밀 폴더';
      btn.appendChild(lock);
    }
    const nameSpan=document.createElement('span');
    nameSpan.innerText=f.name;
    btn.appendChild(nameSpan);
    btn.addEventListener('click', (e)=>{
      if(e.target.closest('.gallery-folder-rename')) return;
      const open = ()=>{
        currentLogFolderId=f.id; pdLogPage=1;
        logSelectedIds.clear();   // 폴더를 옮기면 골라둔 것도 비웁니다
        renderLogList(p);
      };
      if(folderLocked(f)) openFolderUnlock(f, open);
      else open();
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename'; renameBtn.innerText='✎'; renameBtn.title='폴더 설정';
      renameBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        openFolderModal(logFolderCtx(p), f);
      });
      btn.appendChild(renameBtn);

      /* 글 줄을 끌어다 놓으면 그 폴더로 옮깁니다.
         탭끼리 끄는 '순서 바꾸기'와 한 탭에 같이 걸려 있으므로,
         각자 자기 표시(draggedLogId / draggedFolderId)가 있을 때만 움직입니다. */
      btn.addEventListener('dragover', (e)=>{
        if(draggedLogId==null) return;
        e.preventDefault();
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', ()=> btn.classList.remove('drop-target'));
      btn.addEventListener('drop', async (e)=>{
        if(draggedLogId==null) return;
        e.preventDefault();
        btn.classList.remove('drop-target');
        // 골라둔 글이 있으면 함께, 없으면 끌던 글 하나만 옮깁니다
        const ids = new Set(logSelectedIds); ids.add(draggedLogId);
        draggedLogId=null;
        (p.log||[]).forEach(x=>{ if(ids.has(x.id)) x.folderId = f.id; });
        logSelectedIds.clear();
        await logHost.save();
        renderLogList(p);
      });

      bindFolderTabReorder(btn, f, logFolderCtx(p), bar);
    }
    bar.appendChild(btn);
  });
  if(isLoggedIn){
    const addBtn=document.createElement('button');
    addBtn.type='button'; addBtn.className='gallery-folder-add';
    addBtn.innerText='＋ 폴더';
    addBtn.addEventListener('click', ()=> openFolderModal(logFolderCtx(p), null));
    bar.appendChild(addBtn);
  }
}

/* ---- LOG 조각 하나에 조작을 붙입니다 (PAIR 상세 / OC 상세가 각각 한 번씩) ---- */
function initLogRoot(host){
  const root = host.root;
  if(!root) return;
  const use = ()=>{ logHost = host; };

  const addBtn = root.querySelector('.log-add-btn');
  if(addBtn) addBtn.addEventListener('click', ()=>{
    use();
    if(!isLoggedIn) return;
    editingLogId = null;
    document.getElementById('logWriteHeading').innerText='게시글 작성';
    document.getElementById('logWriteHint').innerText='작성 시각이 자동으로 기록됩니다.';
    fillLogEditor(null);
    openModal('modalLogWrite');
  });

  /* 선택 모드 — ARCHIVE 표 화면과 같은 규칙입니다 */
  const selBtn = root.querySelector('.log-select-btn');
  if(selBtn) selBtn.addEventListener('click', ()=>{
    use();
    if(!isLoggedIn) return;
    logSelectMode = !logSelectMode;
    logSelectedIds.clear();
    const p = logPost(); if(p) renderLogList(p);
  });
  const selDel = root.querySelector('.log-select-delete');
  if(selDel) selDel.addEventListener('click', async ()=>{
    use();
    if(!isLoggedIn) return;
    if(logSelectedIds.size===0){ alert('삭제할 글을 먼저 선택해주세요.'); return; }
    if(!await siteConfirm(`선택한 ${logSelectedIds.size}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const p = logPost(); if(!p) return;
    p.log = p.log.filter(x=> !logSelectedIds.has(x.id));
    logSelectedIds.clear();
    await logHost.save();
    renderLogList(p);
  });

  const input  = root.querySelector('.log-search-input');
  const field  = root.querySelector('.log-search-field');
  const clear  = root.querySelector('.log-search-clear');
  const dateEl = root.querySelector('.log-search-date');
  if(!input || !field || !clear) return;
  const rerender = ()=>{ use(); pdLogPage=1; const p=logPost(); if(p) renderLogList(p); };
  input.addEventListener('input', ()=>{ logSearchTerm = input.value; rerender(); });
  field.addEventListener('change', ()=>{ logSearchField = field.value; rerender(); });
  if(dateEl) dateEl.addEventListener('change', ()=>{ logSearchDate = dateEl.value; rerender(); });
  clear.addEventListener('click', ()=>{
    input.value=''; logSearchTerm='';
    if(dateEl){ dateEl.value=''; logSearchDate=''; }
    rerender();
  });
}

let editingLogId = null;
let currentLogViewId = null;
/* 편집 툴바 */
(function initLogToolbar(){
  const editor = document.getElementById('logContent');
  const toolbar = document.querySelector('.rt-toolbar-log');
  // 캐시 등으로 HTML이 옛 버전이면 요소가 없을 수 있습니다.
  // 여기서 예외가 나면 이후 스크립트가 통째로 멈추므로 조용히 건너뜁니다.
  if(!editor || !toolbar) return;
  // 버튼을 눌러도 본문 선택이 풀리지 않도록
  toolbar.querySelectorAll('button').forEach(b=> b.addEventListener('mousedown', e=> e.preventDefault()));
  toolbar.querySelectorAll('button[data-cmd]').forEach(btn=>{
    btn.addEventListener('click', ()=>{ editor.focus(); document.execCommand(btn.dataset.cmd, false, null); });
  });
  const subBtn = document.getElementById('logSubColorBtn');
  if(subBtn) subBtn.addEventListener('click', ()=>{
    editor.focus();
    toggleForeColor(document.getElementById('logSubColor').value);
  });
  const hlBtn = document.getElementById('logHighlightBtn');
  if(hlBtn) hlBtn.addEventListener('click', ()=>{
    editor.focus();
    toggleHighlight(document.getElementById('logHighlightColor').value);
  });
  const divBtn = document.getElementById('logDividerBtn');
  if(divBtn) divBtn.addEventListener('click', ()=>{
    editor.focus();
    document.execCommand('insertHTML', false, '<hr><br>');
  });
  const textColor = document.getElementById('logTextColor');
  if(textColor) textColor.addEventListener('input', (e)=>{
    editor.focus();
    document.execCommand('foreColor', false, e.target.value);
  });
  /* 접기 — ARCHIVE 편집기와 같은 블록을 넣습니다 */
  const foldBtn = document.getElementById('logFoldBtn');
  if(foldBtn) foldBtn.addEventListener('click', ()=> insertFoldBlock('logContent'));
  initFoldEnter('logContent');
  /* 사진 삽입 — ARCHIVE 편집기와 같은 방식(본문 안에 data URL 로 넣습니다) */
  const imgBtn = document.getElementById('logInsertImageBtn');
  if(imgBtn) imgBtn.addEventListener('click', ()=>{
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.addEventListener('change', async ()=>{
      const f=input.files[0]; if(!f) return;
      const url=await fileToDataUrl(f);
      editor.focus();
      document.execCommand('insertHTML', false, `<img src="${url}" /><br>`);
    });
    input.click();
  });
})();

/* 편집기는 값을 읽어서 도로 저장하는 자리라, 사진이 다 온 뒤에 채웁니다.
   안 온 사진을 빈 자리로 그려놓고 저장하면 그 사진이 지워집니다. */
async function fillLogEditor(entry){
  if(entry) await window.SiteStore.ensure(entry.content);
  document.getElementById('logTitle').value = entry ? entry.title : '';
  document.getElementById('logContent').innerHTML = entry ? imgUrl(logContentToHtml(entry.content)) : '';
  document.getElementById('logSubColor').value       = (entry && entry.subColor)       || LOG_SUB_COLOR_DEFAULT;
  document.getElementById('logParenColor').value     = (entry && entry.parenColor)     || LOG_PAREN_COLOR_DEFAULT;
  document.getElementById('logHighlightColor').value = (entry && entry.highlightColor) || LOG_HIGHLIGHT_DEFAULT;
  document.getElementById('logTextColor').value  = '#1a1a1a';
  document.getElementById('modalLogWrite')._armUnsavedGuard?.();
}

bindOnce(document.getElementById('saveLogBtn'), async ()=>{
  const title=document.getElementById('logTitle').value.trim();
  if(!title){ alert('제목을 입력해주세요.'); return; }
  const p=logPost();
  const content        = editorHtml('logContent');
  const subColor       = document.getElementById('logSubColor').value;
  const parenColor     = document.getElementById('logParenColor').value;
  const highlightColor = document.getElementById('logHighlightColor').value;
  if(editingLogId){
    const entry = p.log.find(x=>x.id===editingLogId);
    if(entry){ entry.title=title; entry.content=content; entry.subColor=subColor; entry.parenColor=parenColor; entry.highlightColor=highlightColor; }
  }else{
    /* 새 글은 지금 보고 있는 폴더에 들어갑니다 (갤러리·PROMPT 와 같은 규칙) */
    const folderId = currentLogFolderId || (p.logFolders[0] && p.logFolders[0].id) || LOG_DEFAULT_FOLDER;
    p.log.push({ id:Date.now(), title, date:nowStamp(), content, subColor, parenColor, highlightColor, folderId });
  }
  await logHost.save();
  pdLogPage=1;
  renderLogList(p); closeModal('modalLogWrite');
});
function openLogView(entry){
  currentLogViewId = entry.id;
  document.getElementById('logViewTitle').innerText=entry.title;
  document.getElementById('logViewDate').innerText=entry.date||'';
  renderLogContentInto(document.getElementById('logViewContent'), entry);
  updateLogPinBtn(entry);
  openModal('modalLogView');
}
function updateLogPinBtn(entry){
  const btn=document.getElementById('logPinBtn');
  if(btn) btn.innerText = entry.pinned ? '해제' : '고정';
}
const logKebabBtn = document.getElementById('logKebabBtn');
const logKebabMenu = document.getElementById('logKebabMenu');
logKebabBtn.addEventListener('click', (e)=>{ e.stopPropagation(); logKebabMenu.classList.toggle('open'); });
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#logKebabMenu') && !e.target.closest('#logKebabBtn')) logKebabMenu.classList.remove('open');
});
/* 고정 — ARCHIVE 와 같은 규칙입니다 (한 게시글 묶음당 최대 3개) */
const logPinBtnEl = document.getElementById('logPinBtn');
if(logPinBtnEl) logPinBtnEl.addEventListener('click', async ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  const p=logPost(); if(!p) return;
  const entry = p.log.find(x=>x.id===currentLogViewId);
  if(!entry) return;
  if(!entry.pinned){
    if(p.log.filter(x=>x.pinned).length>=3){ alert('고정은 최대 3개까지 가능해요.'); return; }
    entry.pinned = true;
  }else{
    entry.pinned = false;
  }
  await logHost.save();
  updateLogPinBtn(entry);
  renderLogList(p);
});
document.getElementById('logEditBtn').addEventListener('click', async ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  const p=logPost();
  const entry = p.log.find(x=>x.id===currentLogViewId);
  if(!entry) return;
  editingLogId = entry.id;
  document.getElementById('logWriteHeading').innerText='게시글 수정';
  document.getElementById('logWriteHint').innerText=`작성일: ${entry.date||''}`;
  closeModal('modalLogView');
  openModal('modalLogWrite');
  await fillLogEditor(entry);
});
document.getElementById('logDeleteBtn').addEventListener('click', async ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  if(!await siteConfirm('이 게시글을 삭제할까요?')) return;
  const p=logPost();
  p.log = p.log.filter(x=>x.id!==currentLogViewId);
  await logHost.save();
  renderLogList(p);
  closeModal('modalLogView');
});

/* ============================================================
   갤러리 / LOG 엔진 공용화
   ------------------------------------------------------------
   PAIR 상세와 OC 상세가 똑같은 코드를 나눠 씁니다. 두 창은
   어느 화면 조각 안에서 도는지(root), 어떤 글을 그리는지(getPost),
   어디에 저장하는지(save)만 다르므로 그것만 host 로 받습니다.
   요소는 id 가 아니라 root 안의 클래스로 찾습니다 —
   같은 id 를 두 창에 둘 수 없기 때문입니다.
   창은 한 번에 하나만 열리므로 아래 상태값들은 그대로 함께 씁니다.
   ============================================================ */
let galleryHost = null;   // { root, getPost, save, horizontal }
let logHost = null;       // { root, getPost, save }
function gq(sel){ return galleryHost ? galleryHost.root.querySelector(sel) : null; }
function galleryPost(){ return galleryHost ? galleryHost.getPost() : null; }
function gallerySave(){ return galleryHost ? galleryHost.save() : Promise.resolve(); }
function lq(sel){ return logHost ? logHost.root.querySelector(sel) : null; }
function logPost(){ return logHost ? logHost.getPost() : null; }

const savePair = ()=> storageSet('pairPosts', state.pairPosts);
const PAIR_GALLERY_HOST = { root: document.querySelector('.pd-tab-pane-gallery'),
  getPost: ()=> getCurrentPost(), save: savePair, horizontal:false };
const PAIR_LOG_HOST     = { root: document.querySelector('.pd-tab-pane-log'),
  getPost: ()=> getCurrentPost(), save: savePair };
/* OC 갤러리만 가로로 넘깁니다 — 세로 스크롤은 창 페이지 넘김이 씁니다 */
const OC_GALLERY_HOST   = { root: document.querySelector('.oc-page-gallery'),
  getPost: ()=> getCurrentOc(), save: ()=> saveOc(), horizontal:true };
const OC_LOG_HOST       = { root: document.querySelector('.oc-page-log'),
  getPost: ()=> getCurrentOc(), save: ()=> saveOc() };

/* --- Gallery (폴더 분류 + 다중 선택 + 이동) --- */
let currentGalleryFolderId = null;
let gallerySelectMode = false;
let gallerySelectedIdx = new Set(); // "folderId::imgIdx"

function getFolder(p, folderId){ return p.galleryFolders.find(f=>f.id===folderId); }

/* ---- 비밀 폴더 ----
   주의: Firestore 읽기는 공개이므로 이 비밀번호는 "실제 보안"이 아니다.
   이미지 자체도 공개적으로 읽을 수 있어, 화면에서 가리는 용도(소프트 잠금)일 뿐이다.
   그래도 평문 저장은 피하려고 SHA-256 해시만 저장한다. */
const unlockedFolders = new Set();   // 이 세션에서 열어둔 폴더 (새로고침하면 초기화)

async function hashPw(str){
  const buf = new TextEncoder().encode('gf:'+str);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function folderLocked(f){
  // 관리자(편집 모드)는 폴더를 관리해야 하므로 잠금을 통과한다
  if(!f || !f.secret || !f.pwHash) return false;
  if(isLoggedIn) return false;
  return !unlockedFolders.has(f.id);
}

/* ---- 폴더 추가/수정 모달 ----
   PAIR_GALLERY 와 ARCHIVE_PROMPT 가 같은 창을 씁니다.
   두 곳은 폴더 목록이 어디에 붙어 있는지(글 안 / 사이트 전체)와
   안에 든 것이 무엇인지(이미지 / 글)만 다르므로, 그 차이만 ctx 로 받습니다. */
let gfTarget = null;   // { ctx, folder|null }

function galleryFolderCtx(post){
  return {
    getList: ()=> post.galleryFolders,
    blurHint: '썸네일이 흐리게 보이고, 커서를 올리면 선명해집니다.',
    canDelete: ()=> post.galleryFolders.length>1,   // 마지막 폴더는 남겨둡니다
    deleteWarn: (f)=> f.images.length>0
      ? `'${f.name}' 폴더와 안에 있는 이미지 ${f.images.length}장이 함께 삭제됩니다. 되돌릴 수 없습니다.`
      : `'${f.name}' 폴더를 삭제합니다.`,
    newFolder: (base)=> ({ ...base, id:'f'+Date.now(), images:[] }),
    onCreate: (f)=>{ currentGalleryFolderId = f.id; galleryPage = 1; },
    onDelete: async (f)=>{
      post.galleryFolders = post.galleryFolders.filter(x=>x!==f);
      if(currentGalleryFolderId===f.id){
        currentGalleryFolderId = post.galleryFolders[0].id;
        galleryPage = 1;
      }
    },
    save: ()=> storageSet('pairPosts', state.pairPosts),
    rerender: ()=> renderGallery(post)
  };
}

/* LOG 폴더 — 갤러리와 같은 탭 줄을 쓰지만, 담기는 것이 이미지가 아니라 글입니다.
   그래서 두 가지가 PROMPT 폴더와 같습니다: 폴더를 지워도 안의 글은 남겨서 다른
   폴더로 옮기고, '썸네일 흐리게'는 쓸 데가 없어 칸 자체를 감춥니다. */
function logFolderCtx(post){
  const countIn = (f)=> (post.log||[]).filter(x=> logFolderIdOf(post, x)===f.id).length;
  return {
    hideBlur: true,
    getList: ()=> post.logFolders,
    canDelete: ()=> post.logFolders.length>1,   // 마지막 폴더는 남겨둡니다
    deleteWarn: (f)=>{
      const n = countIn(f);
      if(n===0) return `'${f.name}' 폴더를 삭제합니다.`;
      const fallbackName = post.logFolders.find(x=>x!==f).name;
      return `'${f.name}' 폴더를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 '${fallbackName}' 폴더로 옮겨집니다.`;
    },
    newFolder: (base)=> ({ ...base, id:'lf'+Date.now() }),
    onCreate: (f)=>{ currentLogFolderId = f.id; pdLogPage = 1; },
    onDelete: async (f)=>{
      const remaining = post.logFolders.filter(x=>x!==f);
      const fallback = remaining[0].id;
      (post.log||[]).forEach(x=>{ if(x.folderId===f.id) x.folderId = fallback; });
      post.logFolders = remaining;
      if(currentLogFolderId===f.id){ currentLogFolderId = fallback; pdLogPage = 1; }
    },
    save: ()=> logHost ? logHost.save() : Promise.resolve(),
    rerender: ()=> renderLogList(post)
  };
}

/* cat 을 안 넘기면 지금 보고 있는 세부 카테고리(OOC·PROMPT·ETC)를 씁니다 */
function archiveFolderCtx(cat){
  const c = cat || currentArchiveCategory;
  const countIn = (f)=> state.archive.filter(x=>
    (x.category||'ooc')===c && arcFolderIdOf(x)===f.id).length;
  return {
    getList: ()=> arcFoldersOf(c),
    blurHint: '썸네일이 흐리게 보이고, 각 글 오른쪽 위의 👁 를 누르면 그 글만 선명해집니다.',
    /* 썸네일 격자로 보여주는 PROMPT 에서만 '흐리게'가 뜻이 있습니다 */
    hideBlur: c!=='nai',
    canDelete: ()=> arcFoldersOf(c).length>1,   // 마지막 폴더는 남겨둡니다
    /* 갤러리와 달리 안에 든 글은 지우지 않습니다 — 글은 이미지보다 되돌리기 어렵고,
       일괄 삭제는 선택 모드의 🗑 버튼으로 따로 할 수 있습니다. */
    deleteWarn: (f)=>{
      const n = countIn(f);
      if(n===0) return `'${f.name}' 폴더를 삭제합니다.`;
      const fallbackName = arcFoldersOf(c).find(x=>x!==f).name;
      return `'${f.name}' 폴더를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 '${fallbackName}' 폴더로 옮겨집니다.`;
    },
    newFolder: (base)=> ({ ...base, id:'af'+Date.now() }),
    onCreate: (f)=>{ setCurArcFolderId(f.id, c); arcPage = 1; },
    onDelete: async (f)=>{
      const remaining = arcFoldersOf(c).filter(x=>x!==f);
      const fallback = remaining[0].id;
      state.archive.forEach(x=>{ if((x.category||'ooc')===c && x.folderId===f.id) x.folderId = fallback; });
      setArcFolders(c, remaining);
      if(curArcFolderId(c)===f.id){ setCurArcFolderId(fallback, c); arcPage = 1; }
      await storageSet('archive', state.archive);
    },
    save: ()=> saveArcFolders(c),
    rerender: ()=> renderArchive()
  };
}

function openFolderModal(ctx, folder){
  gfTarget = { ctx, folder: folder||null };
  /* 사이드바 세부 분류도 이 창을 그대로 씁니다 — 부르는 쪽이 이름만 바꿔 넣습니다 */
  const label = ctx.label || '폴더';
  document.getElementById('gfModalTitle').innerText = label + (folder ? ' 수정' : ' 추가');
  const nameLabel = document.getElementById('gfNameLabel');
  if(nameLabel) nameLabel.innerText = label + ' 이름';
  const nameEl = document.getElementById('gfName');
  nameEl.placeholder = '새 ' + label + ' 이름';
  nameEl.value = folder ? folder.name : '';
  document.getElementById('gfSecret').checked = !!(folder && folder.secret);
  document.getElementById('gfBlur').checked   = !!(folder && folder.blur);
  document.getElementById('gfPw').value = '';
  document.getElementById('gfError').style.display='none';
  const blurHint = document.getElementById('gfBlurHint');
  if(blurHint) blurHint.innerText = ctx.blurHint;
  // OC 폴더는 '썸네일 흐리게'를 쓰지 않으므로 그 칸 자체를 숨깁니다
  const blurOpt = document.getElementById('gfBlur').closest('.gf-option');
  if(blurOpt) blurOpt.style.display = ctx.hideBlur ? 'none' : '';
  if(ctx.hideBlur) document.getElementById('gfBlur').checked = false;   // 앞서 연 폴더의 값이 남지 않게
  // 세부 분류에는 비밀번호를 걸지 않으므로 그 칸도 숨깁니다
  const secretOpt = document.getElementById('gfSecret').closest('.gf-option');
  if(secretOpt) secretOpt.style.display = ctx.hideSecret ? 'none' : '';
  if(ctx.hideSecret) document.getElementById('gfSecret').checked = false;
  // 기존 비밀번호가 있으면 "비워두면 유지" 안내를 보여준다
  document.getElementById('gfPwKeep').style.display = (folder && folder.pwHash) ? 'block' : 'none';
  document.getElementById('gfPwRow').style.display  = document.getElementById('gfSecret').checked ? 'block' : 'none';
  // 삭제 버튼은 기존 폴더를 수정할 때만, 그리고 지울 수 있는 폴더일 때만
  const delBtn=document.getElementById('gfDeleteBtn');
  const warn=document.getElementById('gfDeleteWarn');
  if(delBtn){
    delBtn.style.display = (folder && ctx.canDelete(folder)) ? 'inline-flex' : 'none';
    delBtn.innerText=label+' 삭제';
    delBtn.dataset.confirm='';
  }
  if(warn) warn.style.display='none';
  document.getElementById('gfSaveBtn').disabled = false;
  openModal('modalGalleryFolder');
  setTimeout(()=> document.getElementById('gfName').focus(), 30);
}

function initFolderModal(){
  const secret=document.getElementById('gfSecret'), pwRow=document.getElementById('gfPwRow');
  const nameInput=document.getElementById('gfName'), err=document.getElementById('gfError');
  const saveBtn=document.getElementById('gfSaveBtn');
  if(!secret || !saveBtn) return;

  secret.addEventListener('change', ()=>{ pwRow.style.display = secret.checked ? 'block' : 'none'; });

  const showErr=(msg)=>{ err.innerText=msg; err.style.display='block'; };

  /* 저장 버튼과 Enter 키가 같은 save() 를 부르므로,
     연달아 눌리면 폴더가 두 개 만들어질 수 있다. 진행 중에는 한 번만 받는다. */
  let saving = false;
  const save = async ()=>{
    if(!gfTarget || saving) return;
    const { ctx, folder } = gfTarget;
    const name = nameInput.value.trim();
    if(!name){ showErr((ctx.label||'폴더')+' 이름을 입력해주세요.'); nameInput.focus(); return; }
    const wantSecret = secret.checked;
    const typedPw = document.getElementById('gfPw').value;
    const hadHash = folder && folder.pwHash;
    if(wantSecret && !typedPw && !hadHash){ showErr('비밀 폴더는 비밀번호가 필요합니다.'); return; }

    saving = true;
    saveBtn.disabled = true;
    let pwHash = folder ? (folder.pwHash||'') : '';
    if(!wantSecret) pwHash = '';
    else if(typedPw) pwHash = await hashPw(typedPw);

    const wantBlur = document.getElementById('gfBlur').checked;
    if(folder){
      folder.name = name;
      folder.secret = wantSecret;
      folder.pwHash = pwHash;
      folder.blur = wantBlur;
      // 비밀번호가 바뀌었으면 이 세션의 열람 기록도 지운다
      if(typedPw) unlockedFolders.delete(folder.id);
    }else{
      const created = ctx.newFolder({ name, secret:wantSecret, pwHash, blur:wantBlur });
      ctx.getList().push(created);
      ctx.onCreate(created);
      // 만든 사람은 편집 모드라서 어차피 바로 보인다.
      // 여기서 unlockedFolders 에 넣으면 로그아웃 후에도 열린 상태로 남으므로 넣지 않는다.
    }
    await ctx.save();
    closeModal('modalGalleryFolder');
    ctx.rerender();
    saving = false;
    saveBtn.disabled = false;
  };

  saveBtn.addEventListener('click', save);
  nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') save(); });
  document.getElementById('gfPw').addEventListener('keydown', (e)=>{ if(e.key==='Enter') save(); });

  /* 폴더 삭제 — 안에 든 이미지가 함께 사라지므로 한 번 더 확인받는다.
     브라우저 기본 confirm 창 대신 모달 안에서 두 번 눌러 확인하는 방식. */
  const delBtn=document.getElementById('gfDeleteBtn');
  const warn=document.getElementById('gfDeleteWarn');
  if(delBtn) delBtn.addEventListener('click', async ()=>{
    if(!gfTarget || !gfTarget.folder) return;
    const { ctx, folder } = gfTarget;
    if(!ctx.canDelete(folder)) return;
    if(delBtn.dataset.confirm!=='1'){
      delBtn.dataset.confirm='1';
      delBtn.innerText='한 번 더 누르면 삭제';
      warn.innerText = ctx.deleteWarn(folder);
      warn.style.display='block';
      return;
    }
    unlockedFolders.delete(folder.id);
    await ctx.onDelete(folder);
    await ctx.save();
    closeModal('modalGalleryFolder');
    ctx.rerender();
  });
}

/* 비밀 폴더 열람 */
let fuTarget = null;   // { folder, onOk }
function openFolderUnlock(folder, onOk){
  fuTarget = { folder, onOk };
  document.getElementById('fuFolderName').innerText = folder.name;
  document.getElementById('fuPw').value='';
  document.getElementById('fuError').style.display='none';
  openModal('modalFolderUnlock');
  setTimeout(()=> document.getElementById('fuPw').focus(), 30);
}
function initFolderUnlock(){
  const pw=document.getElementById('fuPw'), btn=document.getElementById('fuSubmitBtn'), err=document.getElementById('fuError');
  if(!pw || !btn) return;
  const submit = async ()=>{
    if(!fuTarget) return;
    const h = await hashPw(pw.value);
    if(h !== fuTarget.folder.pwHash){
      err.innerText='비밀번호가 일치하지 않습니다.';
      err.style.display='block';
      pw.select();
      return;
    }
    unlockedFolders.add(fuTarget.folder.id);
    const cb = fuTarget.onOk;
    closeModal('modalFolderUnlock');
    fuTarget = null;
    if(cb) cb();
  };
  btn.addEventListener('click', submit);
  pw.addEventListener('keydown', (e)=>{ if(e.key==='Enter') submit(); });
}

/* ---- 폴더 탭 순서 바꾸기 (갤러리 / PROMPT / OC 공용) ----
   탭을 끌어 다른 탭 위에 놓으면 그 자리로 들어갑니다.
   글·이미지를 폴더로 끌어다 놓는 기존 기능과 같은 버튼에 걸리므로,
   양쪽 모두 자기 쪽 표시(draggedFolderId / draggedGalleryKey ...)가
   있을 때만 반응하도록 해서 섞이지 않게 합니다. */
let draggedFolderId = null;
let draggedFolderBar = null;
function bindFolderTabReorder(btn, folder, ctx, bar){
  // 속성으로 넣어야 터치 드래그(initTouchDrag)도 같이 걸립니다
  btn.setAttribute('draggable','true');
  btn.addEventListener('dragstart', (e)=>{
    draggedFolderId = folder.id;
    draggedFolderBar = bar;
    btn.classList.add('dragging');
    if(e.dataTransfer){
      e.dataTransfer.effectAllowed='move';
      e.dataTransfer.setData('text/plain', String(folder.id));
    }
  });
  btn.addEventListener('dragend', ()=>{
    btn.classList.remove('dragging');
    draggedFolderId=null; draggedFolderBar=null;
    bar.querySelectorAll('.drop-target').forEach(el=> el.classList.remove('drop-target'));
  });
  btn.addEventListener('dragover', (e)=>{
    if(draggedFolderId==null || draggedFolderBar!==bar) return;
    if(draggedFolderId===folder.id) return;
    e.preventDefault();
    btn.classList.add('drop-target');
  });
  btn.addEventListener('dragleave', ()=> btn.classList.remove('drop-target'));
  btn.addEventListener('drop', async (e)=>{
    if(draggedFolderId==null || draggedFolderBar!==bar) return;
    e.preventDefault();
    btn.classList.remove('drop-target');
    const list = ctx.getList();
    const from = list.findIndex(x=>x.id===draggedFolderId);
    const to   = list.findIndex(x=>x.id===folder.id);
    draggedFolderId=null; draggedFolderBar=null;
    if(from<0 || to<0 || from===to) return;
    const [moved] = list.splice(from,1);
    list.splice(to,0,moved);
    await ctx.save();
    ctx.rerender();
  });
}

function renderGalleryFolderBar(p){
  const bar=gq('.gallery-folder-bar');
  bar.innerHTML='';
  p.galleryFolders.forEach(f=>{
    const btn=document.createElement('button');
    btn.type='button'; btn.className='gallery-folder-tab'+(f.id===currentGalleryFolderId?' active':'');
    if(f.secret){
      const lock=document.createElement('span');
      lock.className='gf-lock'; lock.innerText='🔒'; lock.title='비밀 폴더';
      btn.appendChild(lock);
    }
    const nameSpan=document.createElement('span');
    nameSpan.innerText=f.name;
    btn.appendChild(nameSpan);
    btn.addEventListener('click', (e)=>{
      if(e.target.closest('.gallery-folder-rename')) return;
      const open = ()=>{
        currentGalleryFolderId=f.id; gallerySelectedIdx.clear(); galleryPage=1; renderGallery(p);
      };
      if(folderLocked(f)) openFolderUnlock(f, open);
      else open();
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename'; renameBtn.innerText='✎'; renameBtn.title='폴더 설정';
      renameBtn.addEventListener('click', (e)=>{
        e.stopPropagation();
        openFolderModal(galleryFolderCtx(p), f);
      });
      btn.appendChild(renameBtn);

      btn.addEventListener('dragover', (e)=>{
        if(!draggedGalleryKey) return;
        e.preventDefault();
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', ()=> btn.classList.remove('drop-target'));
      btn.addEventListener('drop', async (e)=>{
        e.preventDefault();
        btn.classList.remove('drop-target');
        if(!draggedGalleryKey) return;
        // 곧 이어 올 dragend 의 '순서 바꾸기'가 끼어들지 않게 표시해 둡니다
        galleryDropHandled = true;
        const keys = gallerySelectedIdx.size>0 ? Array.from(gallerySelectedIdx) : [draggedGalleryKey];
        const targetFolder = f;
        const bySrc = [];
        keys.forEach(key=>{
          const [folderId, idxStr] = key.split('::');
          const srcFolder = getFolder(p, folderId);
          if(srcFolder) bySrc.push({ folder:srcFolder, idx:Number(idxStr) });
        });
        bySrc.sort((a,b)=> b.idx-a.idx);
        const movedSrcs=[];
        bySrc.forEach(({folder, idx})=>{
          const [removed] = folder.images.splice(idx,1);
          if(removed) movedSrcs.push(removed);
        });
        targetFolder.images.push(...movedSrcs);
        await gallerySave();
        gallerySelectedIdx.clear();
        draggedGalleryKey = null;
        renderGallery(p);
      });

      bindFolderTabReorder(btn, f, galleryFolderCtx(p), bar);
    }
    bar.appendChild(btn);
  });
  if(isLoggedIn){
    const addBtn=document.createElement('button');
    addBtn.type='button'; addBtn.className='gallery-folder-add';
    addBtn.innerText='＋ 폴더';
    addBtn.addEventListener('click', ()=> openFolderModal(galleryFolderCtx(p), null));
    bar.appendChild(addBtn);
  }
}

let galleryLbImages=[]; let galleryLbIndex=0;
let lbAnimating=false;
function openGalleryLightbox(images, idx){
  galleryLbImages = images; galleryLbIndex = idx;
  lbAnimating = false;    // 넘기는 중에 닫았다 다시 열어도 막히지 않게
  prefetchImgs(images);   // 크게 보는 사진이 제일 급하다
  renderGalleryLightbox();
  document.getElementById('lightbox').classList.add('open');
}
/* 사진 한 장을 그립니다 (썸네일 줄은 그대로 두고 표시만 갱신) */
function paintGalleryLightbox(){
  const el = document.getElementById('lightboxImg');
  const src = galleryLbImages[galleryLbIndex];
  el.src = imgUrl(src);
  whenImgArrives(src, el, ()=>{
    // 그 사이 다른 사진으로 넘어갔으면 덮어쓰지 않는다
    if(galleryLbImages[galleryLbIndex] === src) el.src = imgUrl(src);
  });
  const many = galleryLbImages.length > 1;
  document.getElementById('lbPrev').style.visibility = galleryLbIndex>0 ? 'visible' : 'hidden';
  document.getElementById('lbNext').style.visibility = galleryLbIndex<galleryLbImages.length-1 ? 'visible' : 'hidden';
  /* 몇 번째인지 알려주는 칩 — 한 장뿐이면 알려줄 것이 없습니다 */
  const cnt = document.getElementById('lbCount');
  if(cnt){
    cnt.style.display = many ? '' : 'none';
    cnt.innerText = `${galleryLbIndex+1} / ${galleryLbImages.length}`;
  }
  markGalleryLbThumb();
}
/* 아래 썸네일 줄. 창을 열 때 한 번만 만들고, 넘길 때는 표시만 옮깁니다. */
function renderGalleryLbThumbs(){
  const wrap = document.getElementById('lbThumbs');
  if(!wrap) return;
  wrap.innerHTML='';
  if(galleryLbImages.length < 2){ wrap.style.display='none'; return; }
  wrap.style.display='flex';
  galleryLbImages.forEach((src,i)=>{
    const t=document.createElement('div');
    t.className='lb-thumb'+(i===galleryLbIndex?' active':'');
    applyThumbBg(t, src, 64);   // .lb-thumb 는 64x64 고정
    t.addEventListener('click', ()=> jumpGalleryLightbox(i));
    wrap.appendChild(t);
  });
}
function markGalleryLbThumb(){
  const wrap = document.getElementById('lbThumbs');
  if(!wrap) return;
  const items = wrap.querySelectorAll('.lb-thumb');
  items.forEach((t,i)=> t.classList.toggle('active', i===galleryLbIndex));
  /* 지금 보는 것이 줄 밖으로 밀려나 있으면 끌어옵니다.
     block:'nearest' 라 뒤에 있는 화면이 세로로 딸려 움직이지 않습니다. */
  const cur = items[galleryLbIndex];
  if(cur) cur.scrollIntoView({ block:'nearest', inline:'nearest' });
}
function renderGalleryLightbox(){
  renderGalleryLbThumbs();
  paintGalleryLightbox();
}
/* 옆으로 밀리며 바뀝니다 — 나가는 방향과 들어오는 방향이 반대여야
   '넘어갔다'는 느낌이 납니다. 사진 크기가 장마다 다르므로 칸을 고정하지 않고
   사진 자체를 움직입니다(칸을 고정하면 작은 사진이 큰 빈칸 안에 뜹니다). */
const LB_SLIDE_PX = 56;
const LB_OUT_MS = 150, LB_IN_MS = 210;
const LB_EASE = 'cubic-bezier(.4,0,.2,1)';
function slideGalleryLightbox(dir, commit){
  const el = document.getElementById('lightboxImg');
  if(lbAnimating) return;
  if(!el || !el.animate){ commit(); paintGalleryLightbox(); return; }
  lbAnimating = true;
  const out = el.animate(
    [{transform:'translateX(0)', opacity:1},
     {transform:`translateX(${-dir*LB_SLIDE_PX}px)`, opacity:0}],
    {duration:LB_OUT_MS, easing:LB_EASE, fill:'forwards'});
  /* 사진 교체를 애니메이션의 finish 이벤트에 맡기면 안 됩니다 — 그 이벤트는
     화면을 다시 그릴 때 함께 보내지는 것이라, 다른 탭에 가 있는 동안에는
     오지 않습니다. 그러면 사진이 반쯤 사라진 채로 영영 멈추고 다음 넘김도
     막힙니다. 눈에 보이는 효과와 상관없이 시간으로 이어붙입니다. */
  setTimeout(()=>{
    commit();
    paintGalleryLightbox();
    out.cancel();          // fill:forwards 로 붙잡아 둔 위치를 놓아줍니다
    const back = el.animate(
      [{transform:`translateX(${dir*LB_SLIDE_PX}px)`, opacity:0},
       {transform:'translateX(0)', opacity:1}],
      {duration:LB_IN_MS, easing:LB_EASE});
    /* 새로 만든 애니메이션은 첫 화면 그리기 때 시작 시각이 정해지는데,
       다른 탭에 가 있으면 그 순간이 오지 않아 첫 장면(안 보이는 상태)에
       머뭅니다. 시간이 지나면 무조건 걷어내 사진이 제자리로 돌아오게 합니다. */
    setTimeout(()=>{ back.cancel(); lbAnimating = false; }, LB_IN_MS);
  }, LB_OUT_MS);
}
function stepGalleryLightbox(dir){
  const next = galleryLbIndex + dir;
  if(next<0 || next>=galleryLbImages.length) return;
  slideGalleryLightbox(dir, ()=>{ galleryLbIndex = next; });
}
function jumpGalleryLightbox(i){
  if(i===galleryLbIndex || i<0 || i>=galleryLbImages.length) return;
  slideGalleryLightbox(i>galleryLbIndex ? 1 : -1, ()=>{ galleryLbIndex = i; });
}

let galleryPage = 1;
let draggedGalleryKey = null;
let draggedGalleryEl = null;
let galleryTransitioning = false;
/* 페이지 전환: HOME 페이지와 동일하게 두 페이지가 "동시에" 세로로 밀립니다.
   (사라진 뒤 나타나는 2단계 방식은 끊겨 보여서 한 번에 움직이도록 함) */
const GALLERY_EASE = 'cubic-bezier(.4,0,.2,1)';
const GALLERY_SLIDE_MS = 450;
/* PC 는 5열 x 3행 = 15장, 모바일은 3열 x 3행 = 9장.
   (CSS 의 .gallery-grid 열 개수와 반드시 짝을 맞춰야 합니다)
   iPhone SE 처럼 세로가 짧은 기기는 3행이 잘리므로 2행 = 6장으로 줄입니다.
   행 수는 CSS 에서 지정하지 않고 자동으로 늘어나므로 여기만 바꾸면 됩니다. */
const MOBILE_MQ = '(max-width:768px)';
const SHORT_MQ  = '(max-height:720px)';
function isMobileWidth(){ return window.matchMedia(MOBILE_MQ).matches; }
function galleryPerPage(){
  if(!isMobileWidth()) return 15;
  return window.matchMedia(SHORT_MQ).matches ? 6 : 9;
}
function galleryTotalPages(folder){
  return Math.max(1, Math.ceil(folder.images.length / galleryPerPage()));
}
function animateGalleryPageChange(direction, applyChange){
  if(galleryTransitioning) return;
  galleryTransitioning = true;
  const grid = gq('.gallery-grid');
  const wrap = gq('.gallery-grid-wrap');

  // 나가는 페이지를 복제해 같은 자리에 겹쳐 둡니다
  const gridRect = grid.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const ghost = grid.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.className = 'gallery-grid gallery-grid-ghost';
  ghost.style.left  = (gridRect.left - wrapRect.left) + 'px';
  ghost.style.top   = (gridRect.top  - wrapRect.top)  + 'px';
  ghost.style.width = gridRect.width + 'px';
  wrap.appendChild(ghost);

  applyChange();  // 새 페이지를 실제 그리드에 렌더

  /* PAIR 는 위아래로, OC 는 좌우로 밀립니다 —
     OC 창은 세로 스크롤을 프로필/갤러리/로그 페이지 넘김에 쓰기 때문입니다. */
  const horiz = !!(galleryHost && galleryHost.horizontal);
  const axis = horiz ? 'X' : 'Y';
  const dist = horiz
    ? Math.max(120, wrap.clientWidth  || gridRect.width  || 320)
    : Math.max(120, wrap.clientHeight || gridRect.height || 320);
  grid.style.transition  = 'none';
  grid.style.transform   = `translate${axis}(${direction*dist}px)`;
  ghost.style.transition = 'none';
  ghost.style.transform  = `translate${axis}(0)`;
  void wrap.offsetWidth;  // 강제 리플로우로 트랜지션 재적용

  const tr = `transform ${GALLERY_SLIDE_MS}ms ${GALLERY_EASE}`;
  grid.style.willChange  = 'transform';
  ghost.style.willChange = 'transform';
  grid.style.transition  = tr;
  ghost.style.transition = tr;
  grid.style.transform   = `translate${axis}(0)`;
  ghost.style.transform  = `translate${axis}(${direction*-dist}px)`;

  setTimeout(()=>{
    ghost.remove();
    grid.style.transition = '';
    grid.style.transform  = '';
    grid.style.willChange = '';   // 레이어를 풀어 이미지 선명도 회복
    galleryTransitioning = false;
  }, GALLERY_SLIDE_MS);
}
function renderGallery(p){
  if(!currentGalleryFolderId) currentGalleryFolderId = p.galleryFolders[0].id;
  renderGalleryFolderBar(p);

  const grid=gq('.gallery-grid'); grid.innerHTML='';
  const hint = gq('.gallery-scroll-hint:not(.up)');
  const hintUp = gq('.gallery-scroll-hint.up');
  const emptyMsg = gq('.gallery-empty-msg');
  const folder = getFolder(p, currentGalleryFolderId);

  /* 이미지 수와 무관하게 격자 크기를 일정하게 유지하는 빈 자리.
     덕분에 첫 이미지는 항상 좌상단 같은 위치에서 시작합니다. */
  const fillSlots = (count)=>{
    for(let i=0;i<count;i++){
      const slot=document.createElement('div');
      slot.className='gallery-slot';
      grid.appendChild(slot);
    }
  };

  /* 잠긴 비밀 폴더는 썸네일을 아예 그리지 않는다.
     (폴더 탭을 거치지 않고 들어오는 경로가 있어 여기서도 막는다) */
  const locked = gq('.gallery-locked');
  if(folderLocked(folder)){
    fillSlots(galleryPerPage());
    if(emptyMsg) emptyMsg.style.display='none';
    if(locked) locked.style.display='flex';
    setGalleryHint(hint, false);
    setGalleryHint(hintUp, false);
    return;
  }
  if(locked) locked.style.display='none';

  if(!folder || folder.images.length===0){
    fillSlots(galleryPerPage());
    if(emptyMsg) emptyMsg.style.display='block';
    setGalleryHint(hint, false);
    setGalleryHint(hintUp, false);
    return;
  }
  if(emptyMsg) emptyMsg.style.display='none';

  const perPage=galleryPerPage();
  const totalPages=galleryTotalPages(folder);
  if(galleryPage>totalPages) galleryPage=totalPages;
  if(galleryPage<1) galleryPage=1;
  const start=(galleryPage-1)*perPage;
  const pageImages = folder.images.slice(start, start+perPage);

  pageImages.forEach((src, i)=>{
    const idx = start+i;
    const key = folder.id+'::'+idx;
    const el=document.createElement('div');
    el.className='gallery-thumb'+(folder.blur?' blurred':'');
    // 이미지는 안쪽 레이어에 — 블러가 보더까지 번지지 않게, 선택 체크 표시도 선명하게 유지
    const img=document.createElement('div');
    img.className='gt-img';
    img.style.backgroundImage=`url('${imgUrl(src)}')`;
    applyThumbBg(img, src, 128);   // 실측 박스 123.6px
    el.appendChild(img);
    el.dataset.key = key;
    if(gallerySelectMode){
      const checked = gallerySelectedIdx.has(key);
      const chk=document.createElement('div'); chk.className='gallery-check'+(checked?' checked':''); chk.innerText=checked?'✓':'';
      el.appendChild(chk);
      el.addEventListener('click', ()=>{
        if(gallerySelectedIdx.has(key)) gallerySelectedIdx.delete(key); else gallerySelectedIdx.add(key);
        renderGallery(p);
      });
      if(isLoggedIn){
        el.draggable = true;
        el.addEventListener('dragstart', ()=>{
          draggedGalleryKey = key; draggedGalleryEl = el; el.classList.add('dragging');
          galleryDragPageMoved = false;
          galleryDropHandled = false;
          // 여러 장을 선택해 둔 경우 함께 옮긴다 (드래그 시작 시점으로 고정)
          galleryDragSrcKeys = gallerySelectedIdx.size>0 ? Array.from(gallerySelectedIdx) : [key];
          // 드래그 중에만 화살표가 드롭을 받도록(평소에는 pointer-events:none)
          document.body.classList.add('gallery-dragging');
        });
        el.addEventListener('dragend', async ()=>{
          el.classList.remove('dragging');
          document.body.classList.remove('gallery-dragging');
          document.querySelectorAll('.gallery-scroll-hint.drop-target')
            .forEach(h=> h.classList.remove('drop-target'));
          /* 화살표로 다른 페이지를 거쳐 왔으면, 화면(DOM)에 놓인 자리를 그대로 반영한다 */
          if(galleryDragPageMoved){ await finishGalleryDrag(); return; }
          /* 폴더 탭에 놓아 이미 다른 폴더로 옮겨간 경우에는 여기서 손대면 안 된다.
             drop 이 dragend 보다 먼저 오지만 저장을 기다리는 중이라 화면은 아직
             옛 배치 그대로다. 그걸 순서 바꾸기로 착각해 되쓰면 옮겨간 자리에
             undefined 가 채워져 빈 썸네일이 남는다. */
          if(galleryDropHandled){
            galleryDropHandled=false;
            galleryDragSrcKeys=null;
            draggedGalleryKey=null; draggedGalleryEl=null;
            return;
          }
          galleryDragSrcKeys=null;
          if(draggedGalleryEl){
            /* 화면에는 현재 페이지 몫만 그려져 있습니다.
               전체 배열을 DOM 순서로 덮어쓰면 다른 페이지 이미지가 사라지므로,
               현재 페이지가 차지하는 구간만 잘라서 그 안에서만 순서를 바꿉니다. */
            const domKeys = Array.from(grid.querySelectorAll('.gallery-thumb')).map(x=>x.dataset.key);
            const stillSameFolder = domKeys.every(k=> k.split('::')[0]===folder.id);
            const pageIdx = domKeys.map(k=> Number(k.split('::')[1]));
            const sameSet = pageIdx.length === pageImages.length
              && pageIdx.every(i=> i>=start && i<start+pageImages.length);
            const reordered = pageIdx.map(i=> folder.images[i]);
            // 배열이 그새 줄어들어 빈 칸이 섞였으면 되쓰지 않는다
            if(stillSameFolder && sameSet && reordered.every(src=> typeof src === 'string')){
              folder.images.splice(start, reordered.length, ...reordered);
              await gallerySave();
            }
          }
          draggedGalleryKey=null; draggedGalleryEl=null;
          renderGallery(p);
        });
      }
    }else{
      el.addEventListener('click', ()=>{
        /* 터치 기기에는 hover 가 없습니다. 흐린 폴더는 첫 탭에서 선명해지고
           두 번째 탭에서 원본이 열립니다 — 마우스로 올려보고 누르던 흐름과 같습니다. */
        if(folder.blur && !el.classList.contains('revealed')
           && !window.matchMedia('(hover:hover)').matches){
          el.classList.add('revealed');
          return;
        }
        openGalleryLightbox(folder.images.slice(), idx);
      });
    }
    grid.appendChild(el);
  });

  grid.querySelectorAll('.gallery-thumb').forEach(el=>{
    el.addEventListener('dragover', (e)=>{
      e.preventDefault();
      if(!draggedGalleryEl || draggedGalleryEl===el) return;
      const rects = flipCapture(grid, '.gallery-thumb');
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width/2;
      grid.insertBefore(draggedGalleryEl, before?el:el.nextSibling);
      flipPlay(rects);
    });
  });

  // 마지막 페이지처럼 이미지가 덜 찬 경우에도 격자 높이를 유지
  fillSlots(perPage - pageImages.length);

  // 화살표는 항상 두고, 넘길 페이지가 없는 방향만 비활성(회색·애니메이션 없음)으로
  setGalleryHint(hint,   totalPages>1 && galleryPage<totalPages);
  setGalleryHint(hintUp, totalPages>1 && galleryPage>1);
}
function setGalleryHint(el, active){
  if(!el) return;
  el.style.display='block';
  el.classList.toggle('disabled', !active);
}

/* ------------------------------------------------------------
   선택 모드에서 이미지를 화살표로 끌고 가 다른 페이지로 옮기기
   ------------------------------------------------------------
   화살표 위에 잠깐 머무르면 그 방향 페이지로 "화면만" 넘깁니다.
   데이터는 그대로 두고, 끌고 있던 이미지를 새 페이지 격자에 끼워 넣어
   같은 페이지에서 순서를 바꾸는 것과 똑같이 원하는 자리에 놓을 수 있습니다.
   실제 배열 변경은 드롭이 끝나는 시점(dragend)에 한 번만 합니다.
   ------------------------------------------------------------ */
let galleryDragSrcKeys = null;   // 드래그 시작 시점의 이동 대상 키들
let galleryDragPageMoved = false;
/* 폴더 탭이 드롭을 처리했는지 — dragend 의 순서 바꾸기가 겹치지 않게 */
let galleryDropHandled = false;
const HINT_DWELL_MS = 450;

/* 화면만 목표 페이지로 넘기고, 끌고 있던 이미지를 그 격자에 넣어준다 */
function flipGalleryPageDuringDrag(dir){
  if(!draggedGalleryKey) return false;
  if(galleryTransitioning) return false;
  const p = galleryPost(); if(!p) return false;
  const folder = getFolder(p, currentGalleryFolderId); if(!folder) return false;
  const targetPage = galleryPage + dir;
  if(targetPage < 1 || targetPage > galleryTotalPages(folder)) return false;

  // 휠로 넘길 때와 똑같은 세로 스와이프 효과로 넘긴다
  animateGalleryPageChange(dir, ()=>{
    galleryPage = targetPage;
    galleryDragPageMoved = true;
    renderGallery(p);                  // 데이터는 건드리지 않음
    attachDraggedThumbToGrid(folder);
  });
  return true;
}

/* 끌고 있던 썸네일을 현재 격자에 다시 만들어 붙인다(이동 중 표시용) */
function attachDraggedThumbToGrid(folder){
  const grid = gq('.gallery-grid');
  if(!grid || !draggedGalleryKey) return;
  const idx = Number(draggedGalleryKey.split('::')[1]);
  const src = folder.images[idx];
  if(src === undefined) return;

  // 빈 자리를 하나 빼서 격자 높이가 그대로 유지되게 한다
  const slot = grid.querySelector('.gallery-slot');
  if(slot) slot.remove();

  const el = document.createElement('div');
  el.className = 'gallery-thumb dragging' + (folder.blur ? ' blurred' : '');
  el.dataset.key = draggedGalleryKey;
  const img = document.createElement('div');
  img.className = 'gt-img';
  img.style.backgroundImage = `url('${imgUrl(src)}')`;
  applyThumbBg(img, src, 128);
  el.appendChild(img);
  // 원본 썸네일은 페이지가 넘어가면서 사라지므로, 이 대역 요소에도 종료 처리를 붙여둔다
  el.addEventListener('dragend', ()=> finishGalleryDrag());
  grid.appendChild(el);
  draggedGalleryEl = el;
}

/* 드래그 종료 처리 — drop / dragend 중 먼저 오는 쪽에서 한 번만 확정한다.
   (페이지를 넘기면 원본 요소가 DOM 에서 사라져 dragend 가 오지 않을 수 있다) */
let galleryDragCommitting = false;
async function finishGalleryDrag(){
  if(galleryDragCommitting || !galleryDragPageMoved) return;
  galleryDragCommitting = true;
  const p = galleryPost();
  const folder = p ? getFolder(p, currentGalleryFolderId) : null;
  try{
    if(p && folder) await commitCrossPageDrag(p, folder);
  }finally{
    galleryDragPageMoved = false;
    galleryDragSrcKeys = null;
    gallerySelectedIdx.clear();
    draggedGalleryKey = null; draggedGalleryEl = null;
    document.body.classList.remove('gallery-dragging');
    document.querySelectorAll('.gallery-scroll-hint.drop-target')
      .forEach(h=> h.classList.remove('drop-target'));
    galleryDragCommitting = false;
    if(p) renderGallery(p);
  }
}

/* 드롭이 끝났을 때: 화면(DOM) 순서를 그대로 배열에 반영한다.
   다른 페이지에서 끌고 온 이미지는 DOM 에 놓인 그 자리에 들어간다. */
async function commitCrossPageDrag(p, folder){
  const grid = gq('.gallery-grid');
  const perPage = galleryPerPage();
  const order = Array.from(grid.querySelectorAll('.gallery-thumb')).map(el=> el.dataset.key);

  const movingKeys = new Set(galleryDragSrcKeys || [draggedGalleryKey]);
  const movingIdx = [...new Set(
    [...movingKeys].map(k=> String(k).split('::')).filter(([fid])=> fid===folder.id).map(([,i])=> Number(i))
  )].filter(i=> Number.isInteger(i) && i>=0 && i<folder.images.length).sort((a,b)=> a-b);
  if(!movingIdx.length) return false;

  const movingImgs = movingIdx.map(i=> folder.images[i]);
  const movingSet = new Set(movingIdx);

  // 화면에 보이는 페이지를 DOM 순서대로 다시 구성 (이동 대상은 그 자리에 통째로)
  const pageImgs = [];
  let placed = false;
  order.forEach(k=>{
    if(movingKeys.has(k)){
      if(!placed){ pageImgs.push(...movingImgs); placed = true; }
      return;
    }
    const i = Number(String(k).split('::')[1]);
    if(!movingSet.has(i) && folder.images[i] !== undefined) pageImgs.push(folder.images[i]);
  });
  if(!placed) pageImgs.push(...movingImgs);   // 화살표만 누르고 놓은 경우 등

  const rest = folder.images.filter((_,i)=> !movingSet.has(i));
  const pageStart = (galleryPage-1)*perPage;
  const movedBefore = movingIdx.filter(i=> i < pageStart).length;
  const startRest = Math.max(0, Math.min(rest.length, pageStart - movedBefore));
  const existingCount = pageImgs.length - movingImgs.length;

  rest.splice(startRest, existingCount, ...pageImgs);
  folder.images = rest;

  await gallerySave();
  return true;
}

function initGalleryPageDrop(host){
  const root = host.root;
  const bind = (el, dir)=>{
    if(!el) return;
    const use = ()=>{ galleryHost = host; };
    let dwell = null;
    const clear = ()=>{ if(dwell){ clearTimeout(dwell); dwell=null; } el.classList.remove('drop-target'); };
    el.addEventListener('dragover', (e)=>{
      if(!draggedGalleryKey || el.classList.contains('disabled')) return;
      e.preventDefault();
      use();
      el.classList.add('drop-target');
      if(!dwell) dwell = setTimeout(()=>{ dwell=null; clear(); flipGalleryPageDuringDrag(dir); }, HINT_DWELL_MS);
    });
    el.addEventListener('dragleave', clear);
    // 화살표 위에서 그냥 놓으면 페이지만 넘기고, 위치는 사용자가 이어서 정한다
    el.addEventListener('drop', (e)=>{
      if(!draggedGalleryKey || el.classList.contains('disabled')) return;
      e.preventDefault();
      use();
      clear();
      flipGalleryPageDuringDrag(dir);
    });
  };
  bind(root.querySelector('.gallery-scroll-hint:not(.up)'), 1);
  bind(root.querySelector('.gallery-scroll-hint.up'), -1);

  /* 격자 안에서 놓았을 때 확정 — 원본 요소가 사라져 dragend 가 오지 않는 경우를 대비 */
  const wrap = root.querySelector('.gallery-grid-wrap');
  if(wrap) wrap.addEventListener('drop', (e)=>{
    if(!galleryDragPageMoved) return;
    e.preventDefault();
    galleryHost = host;
    finishGalleryDrag();
  });
}
function updateGallerySelectCount(){
  const info=gq('.gallery-select-info');
  if(gallerySelectedIdx.size>0){ info.style.display='block'; info.innerText=`${gallerySelectedIdx.size}개 선택됨`; }
  else{ info.style.display='none'; }
}
/* ---- 갤러리 조각 하나에 조작을 붙입니다 (PAIR 상세 / OC 상세가 각각 한 번씩) ---- */
function initGalleryRoot(host){
  const root = host.root;
  if(!root) return;
  const use = ()=>{ galleryHost = host; };   // 어느 창인지 확정하고 시작

  const selBtn = root.querySelector('.gallery-select-toggle');
  const delBtn = root.querySelector('.gallery-select-delete');
  const addBtn = root.querySelector('.gallery-add');
  const unlockBtn = root.querySelector('.gallery-unlock-btn');

  if(selBtn) selBtn.addEventListener('click', ()=>{
    use();
    gallerySelectMode = !gallerySelectMode;
    gallerySelectedIdx.clear();
    selBtn.innerText = gallerySelectMode ? '✕' : '✓';
    selBtn.classList.toggle('active', gallerySelectMode);
    updateGallerySelectCount();
    if(delBtn) delBtn.style.display = (gallerySelectMode && isLoggedIn) ? 'flex' : 'none';
    renderGallery(galleryPost());
  });

  if(delBtn) delBtn.addEventListener('click', async ()=>{
    use();
    if(gallerySelectedIdx.size===0) return;
    if(!await siteConfirm(`선택한 ${gallerySelectedIdx.size}장의 이미지를 삭제할까요?`)) return;
    const p = galleryPost();
    const bySrc = [];
    gallerySelectedIdx.forEach(key=>{
      const [folderId, idxStr] = key.split('::');
      const folder = getFolder(p, folderId);
      if(folder) bySrc.push({ folder, idx:Number(idxStr) });
    });
    bySrc.sort((a,b)=> b.idx-a.idx);
    bySrc.forEach(({folder, idx})=>{ folder.images.splice(idx,1); });
    await gallerySave();
    gallerySelectedIdx.clear();
    updateGallerySelectCount();
    renderGallery(p);
  });

  /* + 버튼과 바깥에서 끌어다 놓기가 같은 방식으로 이미지를 추가합니다 */
  const addGalleryFiles = async (fileList)=>{
    const files = Array.from(fileList||[]).filter(f=> f.type.startsWith('image/'));
    if(!files.length) return;
    const p=galleryPost();
    const folder = getFolder(p, currentGalleryFolderId) || p.galleryFolders[0];
    // 고른 순서대로 넣습니다 (한 장씩 줄여 담아야 메모리가 덜 튑니다)
    for(const f of files){
      const url=await fileToDataUrl(f);
      folder.images.push(url);
    }
    await gallerySave(); renderGallery(p);
  };

  if(addBtn) addBtn.addEventListener('click', ()=>{
    use();
    if(!isLoggedIn) return;
    const input=document.createElement('input');
    input.type='file'; input.accept='image/*'; input.multiple = true;
    input.addEventListener('change', ()=> addGalleryFiles(input.files));
    input.click();
  });

  if(unlockBtn) unlockBtn.addEventListener('click', ()=>{
    use();
    const p=galleryPost(); if(!p) return;
    const f=getFolder(p, currentGalleryFolderId); if(!f) return;
    openFolderUnlock(f, ()=> renderGallery(p));
  });

  /* 페이지 넘기기.
     PAIR 는 세로(휠/위아래 스와이프), OC 는 가로입니다 —
     OC 창은 세로 스크롤을 프로필/갤러리/로그 페이지 넘김에 쓰기 때문입니다. */
  const wrap = root.querySelector('.gallery-grid-wrap');
  const next = root.querySelector('.gallery-scroll-hint:not(.up)');
  const prev = root.querySelector('.gallery-scroll-hint.up');

  const step = (dir)=>{ use(); galleryStepPage(dir); };
  if(next) next.addEventListener('click', ()=>{ if(!next.classList.contains('disabled')) step(1); });
  if(prev) prev.addEventListener('click', ()=>{ if(!prev.classList.contains('disabled')) step(-1); });

  /* 다른 창(탐색기 등)에서 이미지를 끌어다 놓아도 + 버튼과 같이 추가됩니다.
     이미지 순서 바꾸기 드래그(내부, dataTransfer 에 파일이 없음)와는
     dataTransfer.types 로 구분합니다 — 놓지 않으면 브라우저가 파일을
     새 페이지로 열어버리므로 dragover 에서도 preventDefault 가 필요합니다. */
  if(wrap){
    const isFileDrag = (e)=> e.dataTransfer && Array.from(e.dataTransfer.types||[]).includes('Files');
    wrap.addEventListener('dragover', (e)=>{
      if(!isLoggedIn || !isFileDrag(e)) return;
      e.preventDefault();
      wrap.classList.add('gallery-file-dragover');
    });
    wrap.addEventListener('dragleave', (e)=>{
      if(e.target===wrap) wrap.classList.remove('gallery-file-dragover');
    });
    wrap.addEventListener('drop', (e)=>{
      if(!isLoggedIn || !isFileDrag(e)) return;
      e.preventDefault();
      wrap.classList.remove('gallery-file-dragover');
      use();
      addGalleryFiles(e.dataTransfer.files);
    });
  }

  if(wrap){
    /* 세로 휠은 PAIR 갤러리에서만 씁니다 — OC 창은 세로를 장 넘김에 쓰거든요.
       가로 휠(트랙패드 좌우 / 마우스는 Shift+휠)은 양쪽 다 받습니다. */
    wrap.addEventListener('wheel', (e)=>{
      const dx = wheelDeltaX(e);
      if(dx){ markOcHandled(e); step(dx>0 ? 1 : -1); return; }
      if(!host.horizontal && Math.abs(e.deltaY) >= 4) step(e.deltaY>0 ? 1 : -1);
    }, {passive:true});
  }

  /* 손가락 스와이프 — 넘기는 방향에 맞춰 가로/세로를 봅니다 */
  if(wrap){
    let x0=null, y0=0;
    wrap.addEventListener('touchstart', (e)=>{
      if(e.touches.length!==1 || document.body.classList.contains('touch-dragging')){ x0=null; return; }
      x0=e.touches[0].clientX; y0=e.touches[0].clientY;
    }, {passive:true});
    wrap.addEventListener('touchend', (e)=>{
      if(x0===null) return;
      const dx=e.changedTouches[0].clientX-x0, dy=e.changedTouches[0].clientY-y0;
      x0=null;
      if(document.body.classList.contains('touch-dragging')) return;
      if(host.horizontal){
        if(Math.abs(dx)<45 || Math.abs(dx)<Math.abs(dy)) return;
        step(dx<0 ? 1 : -1);
      }else{
        if(Math.abs(dy)<45 || Math.abs(dy)<Math.abs(dx)) return;
        step(dy<0 ? 1 : -1);
      }
    }, {passive:true});
  }

  initGalleryPageDrop(host);
}
/* 바깥(검은 바탕)이나 사진 줄의 빈 자리를 누르면 닫습니다 —
   썸네일·화살표·사진 자체는 각자 할 일이 있으므로 제외합니다. */
document.getElementById('lightbox').addEventListener('click', (e)=>{
  if(e.target.id==='lightbox' || e.target.id==='lbStage' || e.target.classList.contains('lb-row'))
    document.getElementById('lightbox').classList.remove('open');
});
document.getElementById('lbPrev').addEventListener('click', (e)=>{ e.stopPropagation(); stepGalleryLightbox(-1); });
document.getElementById('lbNext').addEventListener('click', (e)=>{ e.stopPropagation(); stepGalleryLightbox(1); });

/* --- Timeline (원형 마커 + 연결선 + 볼드 타이틀 구조)
   편집 모드(UNLOCKED)에서는 프로필 칸처럼 목록에서 바로 수정합니다.
   별도 입력 모달 없이 추가 버튼이 즉시 항목을 만들어요. --- */
function renderTimeline(p){
  const wrap=document.getElementById('timelineList'); wrap.innerHTML='';
  if(p.timeline.length===0){ wrap.innerHTML='<div class="empty-note">등록된 타임라인이 없어요.</div>'; return; }
  p.timeline.forEach((t, i)=>{
    const el=document.createElement('div'); el.className='tl-item';
    el.innerHTML = `
      <div class="tl-marker"><div class="tl-dot"></div><div class="tl-line"></div></div>
      <div class="tl-body">
        <div class="tl-title" data-tlfield="title" contenteditable="false"></div>
        <div class="tl-content" data-tlfield="text" contenteditable="false"></div>
      </div>
      <button class="tl-del" data-editonly title="삭제">✕</button>`;
    if(i===p.timeline.length-1) el.classList.add('last');

    const titleEl = el.querySelector('[data-tlfield="title"]');
    const textEl  = el.querySelector('[data-tlfield="text"]');
    titleEl.innerText = t.title || '';
    textEl.innerText  = t.text || '';

    [titleEl, textEl].forEach(node=>{
      node.contentEditable = isLoggedIn ? 'true' : 'false';
      node.addEventListener('blur', async ()=>{
        if(!isLoggedIn) return;
        const field = node.dataset.tlfield;
        const val = node.innerText;
        if(t[field] === val) return;
        t[field] = val;
        await storageSet('pairPosts', state.pairPosts);
      });
      // 줄바꿈 대신 편집 종료 (타이틀만)
      if(node === titleEl){
        node.addEventListener('keydown', (e)=>{
          if(e.key==='Enter'){ e.preventDefault(); node.blur(); }
        });
      }
    });

    el.querySelector('.tl-del').addEventListener('click', async ()=>{
      if(!isLoggedIn) return;
      if(!await siteConfirm('이 타임라인을 삭제할까요?')) return;
      p.timeline.splice(i,1);
      await storageSet('pairPosts', state.pairPosts);
      renderTimeline(p);
    });

    wrap.appendChild(el);
  });
}
document.getElementById('addTimelineBtn').addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  const p=getCurrentPost(); if(!p) return;
  p.timeline.push({ title:'', text:'' });
  await storageSet('pairPosts', state.pairPosts);
  renderTimeline(p);
  // 새로 만든 항목의 타이틀에 바로 커서를 둡니다
  const items = document.getElementById('timelineList').querySelectorAll('.tl-item');
  const last = items[items.length-1];
  if(last){
    const t = last.querySelector('[data-tlfield="title"]');
    if(t){ t.focus(); document.getSelection().selectAllChildren(t); }
  }
});

/* ============================================================
   OC
   ------------------------------------------------------------
   목록은 PAIR 과 같은 4열 x 2행 격자 + 폴더 탭(PROMPT 방식),
   상세 창은 인덱스 탭 없이 프로필 / 갤러리 / 로그 세 장이
   위아래로 넘어갑니다. 갤러리·로그는 PAIR 상세와 같은 코드를 씁니다.
   ============================================================ */
/* PAIR 목록과 같은 규칙 — PC 8개, 모바일 4개 */
function ocPerPage(){ return isMobileWidth() ? 4 : 8; }
let ocPage = 1;
let currentOcFolderId = OC_DEFAULT_FOLDER;
let ocSelectMode = false;
let ocSelectedIds = new Set();
let draggedOcId = null;
let currentOcId = null;

function getCurrentOc(){ return state.ocPosts.find(x=>x.id===currentOcId); }
function saveOc(){ return storageSet('ocPosts', state.ocPosts); }

/* 폴더는 카테고리마다 따로입니다 — catId 로 어느 카테고리의 폴더인지 받습니다.
   (전에는 state.ocFolders 하나를 OC 전체가 공유해서, 1번 카테고리에서 만든
   폴더가 2번 카테고리 목록에도 그대로 보였습니다.) */
function ocFolderCtx(catId){
  const cat = ocCatOf(catId);
  const countIn = (f)=> state.ocPosts.filter(x=> x.type===cat.id && ocFolderIdOf(x)===f.id).length;
  return {
    getList: ()=> ocFoldersOf(cat.id),
    hideBlur: true,          // OC 는 '썸네일 흐리게'를 쓰지 않습니다
    blurHint: '',
    canDelete: ()=> ocFoldersOf(cat.id).length>1,   // 마지막 폴더는 남겨둡니다
    deleteWarn: (f)=>{
      const n = countIn(f);
      if(n===0) return `'${f.name}' 폴더를 삭제합니다.`;
      const fallbackName = ocFoldersOf(cat.id).find(x=>x!==f).name;
      return `'${f.name}' 폴더를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 '${fallbackName}' 폴더로 옮겨집니다.`;
    },
    newFolder: (base)=> ({ ...base, id:'ocf'+Date.now(), blur:false }),
    onCreate: (f)=>{ currentOcFolderId = f.id; ocPage = 1; },
    onDelete: async (f)=>{
      const remaining = ocFoldersOf(cat.id).filter(x=>x!==f);
      const fallback = remaining[0].id;
      state.ocPosts.forEach(x=>{ if(x.type===cat.id && x.folderId===f.id) x.folderId = fallback; });
      cat.folders = remaining;
      if(currentOcFolderId===f.id){ currentOcFolderId = fallback; ocPage = 1; }
      await saveOc();
    },
    save: ()=> storageSet('ocCats', state.ocCats),
    rerender: ()=> renderOcPosts()
  };
}

/* ---- 폴더 고르기 드롭다운 (OC · ARCHIVE 공용) ----
   예전에는 목록 위에 폴더 탭이 한 줄 깔려 있었지만, 그 줄이 차지하던 높이를
   글 목록에 돌려주려고 상단바 오른쪽 끝의 드롭다운으로 옮겼습니다(갤러리는
   창 안이라 예전 탭 그대로입니다). 두 곳이 다른 점은 host 로만 받습니다 —
   갤러리·LOG 를 host 로 공유하는 것과 같은 방식입니다. */
function renderFolderDropdown(host){
  const root = document.getElementById(host.rootId);
  if(!root) return;
  const folders = host.folders();
  const cur = folders.find(f=>f.id===host.currentId()) || folders[0];
  if(!cur) return;
  root.innerHTML = '';
  root.classList.remove('open');
  const close = ()=> root.classList.remove('open');

  const btn = document.createElement('button');
  btn.type='button'; btn.className='folder-dd-btn'; btn.title='폴더';
  if(cur.secret){
    const lock=document.createElement('span');
    lock.className='gf-lock'; lock.innerText='🔒'; lock.title='비밀 폴더';
    btn.appendChild(lock);
  }
  const nameEl=document.createElement('span'); nameEl.className='fdd-name'; nameEl.innerText=cur.name;
  const caret=document.createElement('span'); caret.className='fdd-caret'; caret.innerText='▾';
  btn.appendChild(nameEl); btn.appendChild(caret);
  btn.addEventListener('click', (e)=>{ e.stopPropagation(); root.classList.toggle('open'); });
  /* 글을 끌고 단추 위로 오면 저절로 펼쳐집니다 — 예전 탭처럼 끌어다 놓아
     폴더를 옮길 수 있어야 하는데, 닫혀 있으면 놓을 자리가 없기 때문입니다. */
  btn.addEventListener('dragover', (e)=>{
    if(host.draggedId()==null) return;
    e.preventDefault(); root.classList.add('open');
  });
  root.appendChild(btn);

  const menu = document.createElement('div');
  menu.className='folder-dd-menu';
  root.appendChild(menu);

  folders.forEach(f=>{
    const item=document.createElement('button');
    item.type='button'; item.className='folder-dd-item'+(f.id===cur.id?' active':'');
    if(f.secret){
      const lock=document.createElement('span');
      lock.className='gf-lock'; lock.innerText='🔒'; lock.title='비밀 폴더';
      item.appendChild(lock);
    }
    const label=document.createElement('span'); label.className='fdd-label'; label.innerText=f.name;
    item.appendChild(label);
    item.addEventListener('click', (e)=>{
      if(e.target.closest('.gallery-folder-rename')) return;
      const open = ()=>{ close(); host.select(f); };
      if(folderLocked(f)) openFolderUnlock(f, open); else open();
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename';
      renameBtn.innerText='✎'; renameBtn.title='폴더 설정';
      renameBtn.addEventListener('click', (e)=>{ e.stopPropagation(); close(); openFolderModal(host.ctx(), f); });
      item.appendChild(renameBtn);

      item.addEventListener('dragover', (e)=>{
        if(host.draggedId()==null) return;
        e.preventDefault(); item.classList.add('drop-target');
      });
      item.addEventListener('dragleave', ()=> item.classList.remove('drop-target'));
      item.addEventListener('drop', async (e)=>{
        if(host.draggedId()==null) return;
        e.preventDefault(); item.classList.remove('drop-target'); close();
        await host.onDrop(f);
      });
      // 폴더끼리 끌어 순서 바꾸기 — 예전 탭에서 쓰던 것을 그대로 씁니다
      bindFolderTabReorder(item, f, host.ctx(), menu);
    }
    menu.appendChild(item);
  });

  if(isLoggedIn){
    const sep=document.createElement('div'); sep.className='folder-dd-sep'; menu.appendChild(sep);
    const addBtn=document.createElement('button');
    addBtn.type='button'; addBtn.className='folder-dd-add'; addBtn.innerText='＋ 폴더';
    addBtn.addEventListener('click', (e)=>{ e.stopPropagation(); close(); openFolderModal(host.ctx(), null); });
    menu.appendChild(addBtn);
  }
}
/* 바깥을 누르면 닫습니다 */
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.folder-dd.open').forEach(dd=>{
    if(!dd.contains(e.target)) dd.classList.remove('open');
  });
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') document.querySelectorAll('.folder-dd.open').forEach(dd=> dd.classList.remove('open'));
});

const OC_FOLDER_DD = {
  rootId: 'ocFolderDD',
  folders: ()=> ocFoldersOf(currentOcFilter),
  currentId: ()=> currentOcFolderId,
  ctx: ()=> ocFolderCtx(currentOcFilter),
  select: (f)=>{ currentOcFolderId=f.id; ocPage=1; ocSelectedIds.clear(); renderOcPosts(); },
  draggedId: ()=> draggedOcId,
  onDrop: async (f)=>{
    const ids = new Set(ocSelectedIds); ids.add(draggedOcId);
    state.ocPosts.forEach(x=>{ if(ids.has(x.id)) x.folderId = f.id; });
    draggedOcId=null; ocSelectedIds.clear();
    await saveOc();
    renderOcPosts();
  }
};
function renderOcFolderBar(){ renderFolderDropdown(OC_FOLDER_DD); }

function renderOcPosts(){
  const grid=document.getElementById('ocGrid');
  if(!grid) return;
  grid.innerHTML='';
  const pagSlot=document.getElementById('ocPagination');
  if(pagSlot) pagSlot.innerHTML='';
  const locked=document.getElementById('ocLockedPanel');
  if(locked) locked.remove();

  const selBtn=document.getElementById('ocSelectBtn');
  if(selBtn){ selBtn.innerText = ocSelectMode ? '선택 취소' : '선택'; selBtn.classList.toggle('active', ocSelectMode); }
  const selBar=document.getElementById('ocSelectBar');
  if(selBar) selBar.style.display = ocSelectMode ? 'flex' : 'none';
  updateOcSelectCountLabel();

  /* 카테고리가 지워졌거나 아직 유효한 값이 아니면(첫 렌더 등) 첫 카테고리로 되돌립니다 —
     폴더 쪽 자기 치유(바로 아래)와 같은 방식입니다. */
  if(!state.ocCats.some(c=>c.id===currentOcFilter)) currentOcFilter = defaultCatId(OC_CAT_NAV);

  const folders = ocFoldersOf(currentOcFilter);
  const folder = folders.find(f=>f.id===currentOcFolderId) || folders[0];
  currentOcFolderId = folder.id;
  renderOcFolderBar(currentOcFilter);

  /* 잠긴 비밀 폴더는 목록을 그리지 않습니다 */
  if(folderLocked(folder)){
    const panel=document.createElement('div');
    panel.className='gallery-locked'; panel.id='ocLockedPanel';
    panel.innerHTML='<div class="gl-icon">🔒</div><div class="gl-text">비밀 폴더입니다.</div>'
      + '<button type="button" class="btn-ghost">비밀번호 입력</button>';
    panel.querySelector('button').addEventListener('click', ()=> openFolderUnlock(folder, ()=> renderOcPosts()));
    document.querySelector('.oc-body').appendChild(panel);
    return;
  }

  const list = state.ocPosts.filter(x=>
    x.type===currentOcFilter && ocFolderIdOf(x)===folder.id);
  if(list.length===0){ grid.innerHTML='<div class="empty-note">아직 만들어진 캐릭터가 없어요.</div>'; return; }

  const perPage = ocPerPage();
  const totalPages = Math.max(1, Math.ceil(list.length/perPage));
  if(ocPage>totalPages) ocPage=totalPages;
  if(ocPage<1) ocPage=1;
  const start=(ocPage-1)*perPage;
  const pageItems = list.slice(start, start+perPage);

  pageItems.forEach(o=>{
    const el=document.createElement('div');
    el.className='post-card oc-card'+(ocSelectMode?' selectable':'');
    el.dataset.id = o.id;
    const checked = ocSelectedIds.has(o.id);
    /* PAIR 카드와 같은 모양이되 분류 줄(AI CHAT/DREAM)은 빼고 제목만 둡니다 */
    el.innerHTML = `${ocSelectMode?`<div class="post-check ${checked?'checked':''}">${checked?'✓':''}</div>`:''}
      <div class="post-thumb"></div>
      <div class="post-info"><div class="post-title">${escapeHtml(o.title)}</div>
        <div class="oc-catch">${escapeHtml(o.subtitle||'')}</div></div>`;
    el.addEventListener('click', ()=>{
      if(ocSelectMode){
        if(ocSelectedIds.has(o.id)) ocSelectedIds.delete(o.id); else ocSelectedIds.add(o.id);
        renderOcPosts();
      }else{
        openOcDetail(o.id);
      }
    });
    if(ocSelectMode && isLoggedIn){
      el.draggable = true;
      el.addEventListener('dragstart', ()=>{ draggedOcId=o.id; el.classList.add('dragging'); });
      el.addEventListener('dragend', ()=>{ el.classList.remove('dragging'); draggedOcId=null; });
    }
    grid.appendChild(el);
    const src = o.headerImage && o.headerImage.src;
    const thumb = el.querySelector('.post-thumb');
    if(src){
      thumb.style.backgroundImage = `url('${imgUrl(src)}')`;
      applyThumbBg(thumb, src);
    }
    applyThumbPos(thumb, o);
    if(ocSelectMode && src) addThumbPanControl(el, thumb, o, saveOc);
  });

  // 마지막 페이지가 덜 차도 격자 높이가 유지되도록
  for(let i=pageItems.length;i<perPage;i++){
    const slot=document.createElement('div'); slot.className='post-slot';
    grid.appendChild(slot);
  }

  if(pagSlot && totalPages>1){
    let pag = `<button class="log-pg-btn" data-pg="prev" ${ocPage===1?'disabled':''}>&lt;</button>`;
    for(let i=1;i<=totalPages;i++){ pag += `<button class="log-pg-btn ${i===ocPage?'active':''}" data-pg="${i}">${i}</button>`; }
    pag += `<button class="log-pg-btn" data-pg="next" ${ocPage===totalPages?'disabled':''}>&gt;</button>`;
    pagSlot.innerHTML = `<div class="log-pagination">${pag}</div>`;
    pagSlot.querySelectorAll('.log-pg-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        if(btn.dataset.pg==='prev') ocPage=Math.max(1,ocPage-1);
        else if(btn.dataset.pg==='next') ocPage=Math.min(totalPages,ocPage+1);
        else ocPage=Number(btn.dataset.pg);
        renderOcPosts();
      });
    });
  }
}

/* ---- OC 상세 창 ---- */
let ocHeaderAdj=null, ocProfileAdj=null, ocSideAdj=null;
let ocPageIdx = 0;

function setOcPage(idx, animate){
  const pages = Array.from(document.querySelectorAll('#ocPages .oc-page'));
  if(!pages.length) return;
  ocPageIdx = clamp(idx, 0, pages.length-1);
  pages.forEach((el,i)=>{
    el.style.transition = (animate===false) ? 'none' : '';
    el.style.transform = `translateY(${(i-ocPageIdx)*100}%)`;
    el.classList.toggle('active', i===ocPageIdx);
  });
  if(animate===false){
    // 다음 프레임부터 다시 애니메이션이 걸리도록 되돌립니다
    void pages[0].offsetWidth;
    pages.forEach(el=>{ el.style.transition=''; });
  }
  // 지금 몇 번째 장인지 점으로 알려줍니다 (인덱스 탭이 없으므로).
  // 넘기는 것은 스크롤 / 스와이프로만 합니다 — 점은 표시용입니다.
  const dots=document.getElementById('ocPageDots');
  if(dots){
    dots.innerHTML='';
    pages.forEach((_,i)=>{
      const d=document.createElement('span');
      d.className='oc-page-dot'+(i===ocPageIdx?' active':'');
      dots.appendChild(d);
    });
  }
}

function renderOcKeywords(o){
  const row=document.getElementById('ocKwRow');
  if(!row) return;
  row.innerHTML='';
  o.keywords.forEach((kw,i)=>{
    const cell=document.createElement('div');
    cell.className='oc-kw';
    cell.contentEditable = isLoggedIn ? 'true' : 'false';
    cell.innerText = kw || '';
    cell.addEventListener('blur', ()=>{
      if(!isLoggedIn) return;
      if(o.keywords[i] === cell.innerText) return;
      o.keywords[i] = cell.innerText;
      saveOc();
    });
    cell.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); cell.blur(); } });
    row.appendChild(cell);
  });
}

/* ---- 가로 휠 ----
   트랙패드는 좌우로 밀면 deltaX 가 오지만, 휠 마우스는 Shift 를 누르고
   굴려도 브라우저에 따라 deltaY 로만 옵니다. 둘 다 가로로 봐줍니다.
   가로로 처리한 휠은 표시해 두어 OC 창의 장 넘김(세로)이 겹쳐 돌지 않게 합니다. */
function wheelDeltaX(e){
  if(Math.abs(e.deltaX) >= 4) return e.deltaX;
  if(e.shiftKey && Math.abs(e.deltaY) >= 4) return e.deltaY;
  return 0;
}
function markOcHandled(e){ try{ e.__ocHandled = true; }catch(_){} }

/* ---- 오른쪽 칸 넘기기 ----
   OC 는 [세로 이미지 · 테마곡] 두 장, PAIR 은 [세로 이미지 · TIMELINE ·
   테마곡 · 메시지] 네 장입니다. 옆으로 미는 동작으로 넘깁니다 —
   창 자체의 장 넘김은 위아래라 서로 겹치지 않습니다. */
function makeSidePager(pagesEl, dotsEl){
  if(!pagesEl) return { set(){}, get(){ return 0; } };
  let idx = 0;
  function set(i, animate){
    const pages = Array.from(pagesEl.querySelectorAll('.side-page'));
    if(!pages.length) return;
    idx = clamp(i, 0, pages.length-1);
    pages.forEach((el,n)=>{
      el.style.transition = (animate===false) ? 'none' : '';
      /* 장끼리 16px 씩 띄웁니다 — 딱 붙여두면 옆 장의 가장자리(버튼 등)가
         1px 씩 삐져나와 보입니다. */
      el.style.transform = `translateX(calc(${(n-idx)*100}% + ${(n-idx)*16}px))`;
      el.classList.toggle('active', n===idx);
    });
    if(animate===false){
      void pages[0].offsetWidth;
      pages.forEach(el=>{ el.style.transition=''; });
    }
    if(dotsEl){
      dotsEl.innerHTML='';
      pages.forEach((_,n)=>{
        const d=document.createElement('span');
        d.className='side-dot'+(n===idx?' active':'');
        d.addEventListener('click', ()=> set(n));
        dotsEl.appendChild(d);
      });
    }
  }
  /* 가로 휠(트랙패드 좌우, 마우스는 Shift+휠) */
  let lock=0;
  pagesEl.addEventListener('wheel', (e)=>{
    const dx = wheelDeltaX(e);
    if(!dx) return;
    markOcHandled(e);
    const now=Date.now();
    if(now < lock) return;
    lock = now + 500;
    set(idx + (dx>0 ? 1 : -1));
  }, {passive:true});
  /* 휠(가운데) 버튼을 누른 채 좌우로 끌어도 넘어갑니다.
     크롬의 오토스크롤은 스크롤될 곳이 있어야 뜨는데 이 칸은 높이가 고정이라
     아무 일도 일어나지 않으므로, 그 동작을 대신합니다. */
  let mx=null, moved=false;
  pagesEl.addEventListener('pointerdown', (e)=>{
    if(e.button!==1) return;
    e.preventDefault();
    mx=e.clientX; moved=false;
    try{ pagesEl.setPointerCapture(e.pointerId); }catch(_){}
  });
  pagesEl.addEventListener('pointermove', (e)=>{
    if(mx===null) return;
    const dx=e.clientX-mx;
    if(Math.abs(dx) < 60 || moved) return;
    moved=true;
    set(idx + (dx<0 ? 1 : -1));
  });
  const endMiddle=()=>{ mx=null; };
  pagesEl.addEventListener('pointerup', endMiddle);
  pagesEl.addEventListener('pointercancel', endMiddle);
  // 가운데 버튼의 기본 동작(오토스크롤 원 표시)은 막아둡니다
  pagesEl.addEventListener('auxclick', (e)=>{ if(e.button===1) e.preventDefault(); });

  /* 손가락으로 옆으로 밀기 */
  let x0=null, y0=0;
  pagesEl.addEventListener('touchstart', (e)=>{
    if(e.touches.length!==1){ x0=null; return; }
    x0=e.touches[0].clientX; y0=e.touches[0].clientY;
  }, {passive:true});
  pagesEl.addEventListener('touchend', (e)=>{
    if(x0===null) return;
    const dx=e.changedTouches[0].clientX-x0, dy=e.changedTouches[0].clientY-y0;
    x0=null;
    if(Math.abs(dx)<40 || Math.abs(dx)<=Math.abs(dy)) return;
    set(idx + (dx<0 ? 1 : -1));
  }, {passive:true});
  set(0, false);
  return { set, get(){ return idx; } };
}
let ocSidePager = null, pdSidePager = null;
function initSidePagers(){
  ocSidePager = makeSidePager(document.getElementById('ocSidePages'), document.getElementById('ocSideDots'));
  pdSidePager = makeSidePager(document.getElementById('pdSidePages'), document.getElementById('pdSideDots'));
}

/* ---- 테마곡 ----
   곡을 누르면 위 칸(NOW PLAYING)으로 올라오고 그 곡의 가사가 펼쳐집니다.
   사이트가 직접 소리를 내지는 않습니다 — 음원 파일을 Firestore 에 통째로
   넣으면 너무 무거워지기 때문입니다.
   PAIR 과 OC 가 같은 코드를 나눠 쓰므로 요소는 id 가 아니라
   host.root 안의 클래스로 찾습니다 (갤러리·LOG 와 같은 방식). */
const OC_THEME_HOST   = { root: document.querySelector('#ocSidePages .oc-theme'),
  getPost: ()=> getCurrentOc(), save: ()=> saveOc(), idx: 0 };
const PAIR_THEME_HOST = { root: document.querySelector('#pdSidePages .oc-theme'),
  getPost: ()=> getCurrentPost(), save: ()=> savePair(), idx: 0 };

let draggedSongRow = null;
function renderThemeSongs(host){
  const root = host && host.root;
  if(!root) return;
  const post = host.getPost();
  if(!post) return;
  if(!Array.isArray(post.themeSongs)) post.themeSongs = [];
  const songs = post.themeSongs;
  const list = root.querySelector('.oc-theme-list');
  if(!list) return;
  if(host.idx >= songs.length) host.idx = 0;
  const now = songs[host.idx] || null;

  const art=root.querySelector('.oc-theme-now-art');
  if(art){
    const cover = (now && now.cover) ? imgUrl(now.cover) : '';
    art.style.backgroundImage = cover ? `url('${cover}')` : 'none';
    if(now && now.cover) whenImgArrives(now.cover, art, ()=>{
      art.style.backgroundImage = `url('${imgUrl(now.cover)}')`;
    });
  }
  const t=root.querySelector('.oc-theme-now-title');
  if(t) t.innerText = now ? (now.title || '제목 없음') : '테마곡';
  const a=root.querySelector('.oc-theme-now-artist');
  if(a) a.innerText = now ? (now.artist || '') : '';
  /* 막대는 몇 번째 곡인지를 나타냅니다 — 세 곡 중 첫 곡이면 1/3, 다섯 중 넷이면 4/5 */
  const bar=root.querySelector('.oc-theme-bar span');
  if(bar) bar.style.width = now ? (((host.idx+1)/songs.length)*100).toFixed(2)+'%' : '0%';

  list.innerHTML='';
  /* 끌고 지나가는 줄이 실시간으로 자리를 내주도록 — 목록 하나에 한 번만 겁니다 */
  if(!list._songDragBound){
    list._songDragBound = true;
    list.addEventListener('dragover', (e)=>{
      if(!draggedSongRow) return;
      e.preventDefault();
      const over = e.target.closest ? e.target.closest('.oc-theme-row') : null;
      if(!over || over===draggedSongRow || over.parentNode!==list) return;
      const rects = flipCapture(list, '.oc-theme-row');
      const rect = over.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height/2;
      list.insertBefore(draggedSongRow, before ? over : over.nextSibling);
      flipPlay(rects);
    });
    list.addEventListener('drop', (e)=>{ if(draggedSongRow) e.preventDefault(); });
  }
  /* ＋ 곡 추가는 목록 안, 마지막 곡 아래에 붙입니다 */
  const addBtn=document.createElement('button');
  addBtn.type='button'; addBtn.className='oc-theme-add'; addBtn.setAttribute('data-editonly','');
  addBtn.innerText='＋ 곡 추가';
  addBtn.addEventListener('click', async ()=>{
    if(!isLoggedIn) return;
    songs.push({ id:Date.now(), cover:'', title:'', artist:'', lyrics:'' });
    await host.save();
    renderThemeSongs(host);
  });

  if(!songs.length){
    // 곡이 없을 때는 추가 버튼이 칸 맨 위에 옵니다
    list.appendChild(addBtn);
    const empty=document.createElement('div');
    empty.className='oc-theme-empty';
    empty.innerText = isLoggedIn ? '아직 넣은 곡이 없어요.' : '등록된 곡이 없어요.';
    list.appendChild(empty);
    return;
  }
  songs.forEach((s, i)=>{
    const row=document.createElement('div');
    row.className='oc-theme-row'+(i===host.idx?' current':'');
    row.dataset.songId = String(s.id);   // 순서를 바꿀 때 밀려나는 움직임을 짝지어 주는 표시
    row.innerHTML =
      `<span class="oc-theme-grip" draggable="true" title="끌어서 순서 변경">::</span>`
      + `<div class="oc-theme-art"></div>`
      + `<div class="oc-theme-meta">`
      +   `<div class="oc-theme-title" contenteditable="${isLoggedIn}">${escapeHtml(s.title)}</div>`
      +   `<div class="oc-theme-artist" contenteditable="${isLoggedIn}">${escapeHtml(s.artist)}</div>`
      + `</div>`
      + `<button type="button" class="oc-theme-mini oc-theme-del" data-editonly>삭제</button>`
      /* 가사는 고른 곡에서만 펼쳐집니다 */
      + `<div class="oc-theme-lyrics" contenteditable="${isLoggedIn}">${escapeHtml(s.lyrics||'')}</div>`;

    const artEl=row.querySelector('.oc-theme-art');
    if(s.cover) applyThumbBg(artEl, s.cover, 32);
    else artEl.classList.add('no-cover');
    artEl.addEventListener('click', (e)=>{
      if(!isLoggedIn) return;
      e.stopPropagation();
      const input=document.createElement('input'); input.type='file'; input.accept='image/*';
      input.addEventListener('change', async ()=>{
        const f=input.files[0]; if(!f) return;
        s.cover = await fileToDataUrl(f);
        await host.save(); renderThemeSongs(host);
      });
      input.click();
    });

    const bindText=(sel, field)=>{
      const el=row.querySelector(sel);
      el.addEventListener('blur', ()=>{
        if(!isLoggedIn) return;
        if(s[field]===el.innerText) return;
        s[field]=el.innerText;
        host.save(); renderThemeSongs(host);
      });
      el.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); el.blur(); } });
    };
    bindText('.oc-theme-title','title');
    bindText('.oc-theme-artist','artist');
    /* 가사는 줄바꿈을 그대로 쓰므로 innerText 로 주고받습니다 */
    const lyr=row.querySelector('.oc-theme-lyrics');
    lyr.addEventListener('click', (e)=> e.stopPropagation());
    lyr.addEventListener('blur', ()=>{
      if(!isLoggedIn) return;
      if(s.lyrics===lyr.innerText) return;
      s.lyrics=lyr.innerText;
      host.save();
    });

    row.querySelector('.oc-theme-del').addEventListener('click', async (e)=>{
      e.stopPropagation();
      if(!isLoggedIn) return;
      if(!await siteConfirm(`'${s.title||'이 곡'}' 을 목록에서 뺄까요?`)) return;
      songs.splice(i,1);
      if(host.idx>=songs.length) host.idx=0;
      await host.save(); renderThemeSongs(host);
    });
    /* 줄을 누르면 위 칸으로 올라오고 가사가 펼쳐집니다 */
    row.addEventListener('click', ()=>{
      if(host.idx===i) return;
      host.idx = i;
      renderThemeSongs(host);
    });

    /* 손잡이(::)를 끌어 순서를 바꿉니다. 제목·아티스트가 글자 편집 칸이라
       줄 전체를 끌게 하면 글자 선택이 안 되므로 손잡이만 draggable 입니다. */
    /* 잡고 움직이는 동안 다른 줄이 실시간으로 밀려납니다 (갤러리와 같은 방식).
       놓는 순간에 한꺼번에 바뀌는 게 아니라, 지나가는 자리마다 자리를 내줍니다. */
    const grip=row.querySelector('.oc-theme-grip');
    if(grip && isLoggedIn){
      grip.addEventListener('dragstart', (e)=>{
        draggedSongRow = row;
        row.classList.add('dragging');
        if(e.dataTransfer){ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain','song'); }
      });
      grip.addEventListener('dragend', async ()=>{
        row.classList.remove('dragging');
        if(!draggedSongRow){ return; }
        draggedSongRow = null;
        /* 화면에 놓인 순서를 그대로 목록에 옮겨 담습니다 */
        const order = Array.from(list.querySelectorAll('.oc-theme-row')).map(el=> el.dataset.songId);
        const playing = songs[host.idx];          // 듣던 곡은 그대로 따라가게
        songs.sort((a,b)=> order.indexOf(String(a.id)) - order.indexOf(String(b.id)));
        const back = songs.indexOf(playing);
        host.idx = back<0 ? 0 : back;
        renderThemeSongs(host);
        await host.save();
      });
    }
    list.appendChild(row);
  });
  list.appendChild(addBtn);
}

/* ---- 메시지 (PAIR) ----
   카톡처럼 주고받는 화면입니다. 캐릭터(상대)는 왼쪽, 페르소나(나)는 오른쪽.
   사진과 파일은 말풍선 안에 배열로 따로 담습니다 — 본문 HTML 안에 넣으면
   저장할 때 큰 파일이 문서에 그대로 들어가 용량 제한에 걸립니다.
   (배열에 담긴 data URL 은 firebase-store 가 알아서 따로 떼어 저장합니다) */
function renderMessages(p){
  const list=document.getElementById('pdMsgList');
  if(!list) return;
  if(!Array.isArray(p.messages)) p.messages = [];
  const msgs = p.messages;
  const save = ()=> savePair();
  list.innerHTML='';

  if(!msgs.length){
    const empty=document.createElement('div');
    empty.className='msg-empty';
    empty.innerText = isLoggedIn ? '아직 주고받은 말이 없어요.' : '등록된 메시지가 없어요.';
    list.appendChild(empty);
  }

  msgs.forEach((m, i)=>{
    const row=document.createElement('div');
    row.className='msg-row '+(m.side==='persona'?'persona':'char');
    /* 페르소나는 오른쪽에서 시작하므로 삭제 버튼이 말풍선 왼쪽에 옵니다 */
    const delBtn = `<button type="button" class="msg-del" title="삭제">✕</button>`;
    /* 보기 모드에서 내용이 없으면 글자 칸을 아예 그리지 않습니다 —
       그래야 사진만 있는 말풍선이 사진에 딱 맞게 붙습니다. */
    const showText = isLoggedIn || !!(m.text||'').trim();
    const bubble =
      `<div class="msg-bubble">`
      /* data-editonly 를 쓰지 않습니다 — 그 전역 규칙이 아래 .editing 규칙을
         눌러버려서 항상 보이게 됩니다. 편집 모드 여부는 .editing 쪽에서 봅니다. */
      +   `<div class="msg-tools">`
      +     `<button type="button" class="msg-tool msg-img">사진</button>`
      /* 사진을 누르면 크게 보기가 열리므로 지우기는 여기 버튼으로 합니다 */
      +     ((m.images||[])[0] ? `<button type="button" class="msg-tool msg-img-del">사진 삭제</button>` : '')
      +   `</div>`
      +   `<div class="msg-imgs"></div>`
      +   (showText ? `<div class="msg-text" contenteditable="${isLoggedIn}"></div>` : '')
      + `</div>`;
    row.innerHTML = (m.side==='persona') ? (delBtn + bubble) : (bubble + delBtn);

    const textEl=row.querySelector('.msg-text');
    if(textEl){
      textEl.innerText = m.text || '';
      textEl.addEventListener('blur', ()=>{
        if(!isLoggedIn) return;
        if(m.text===textEl.innerText) return;
        m.text=textEl.innerText;
        save();
      });
    }

    /* 사진 — 한 말풍선에 한 장만 들어갑니다 */
    const imgs=row.querySelector('.msg-imgs');
    const shot = (m.images||[])[0];
    if(shot){
      const im=document.createElement('img');
      im.src=imgUrl(shot);
      whenImgArrives(shot, im, ()=>{ im.src = imgUrl(shot); });
      im.addEventListener('click', ()=> openGalleryLightbox([shot], 0));
      imgs.appendChild(im);
    }

    /* 사진 버튼은 이 말풍선을 고치는 동안에만 위에 뜹니다 */
    row.querySelectorAll('.msg-tool').forEach(b=> b.addEventListener('mousedown', e=> e.preventDefault()));
    row.addEventListener('focusin', ()=> setEditingMsgRow(row));
    row.addEventListener('click', (e)=>{ if(isLoggedIn && !e.target.closest('.msg-del')) setEditingMsgRow(row); });

    row.querySelector('.msg-img').addEventListener('click', ()=>{
      if(!isLoggedIn) return;
      const input=document.createElement('input');
      input.type='file'; input.accept='image/*';
      input.addEventListener('change', async ()=>{
        const f=input.files[0]; if(!f) return;
        m.images=[ await fileToDataUrl(f) ];   // 있던 사진은 갈아 끼웁니다
        await save(); renderMessages(p);
      });
      input.click();
    });
    const imgDel=row.querySelector('.msg-img-del');
    if(imgDel) imgDel.addEventListener('click', async ()=>{
      if(!isLoggedIn) return;
      m.images=[];
      await save(); renderMessages(p);
    });

    /* 말풍선 자체를 지우는 ✕ (파일 줄의 ✕ 는 위에서 따로 걸었습니다) */
    const rowDel = (m.side==='persona') ? row.firstElementChild : row.lastElementChild;
    if(rowDel && rowDel.classList.contains('msg-del')){
      rowDel.addEventListener('click', async (e)=>{
        e.stopPropagation();
        if(!isLoggedIn) return;
        if(!await siteConfirm('이 말풍선을 지울까요?')) return;
        msgs.splice(i,1);
        await save(); renderMessages(p);
      });
    }
    list.appendChild(row);
  });

  /* 목록 끝의 추가 버튼 두 개 */
  const addRow=document.createElement('div');
  addRow.className='msg-add-row';
  const mk=(side, label)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='msg-add'; b.innerText=label;
    b.addEventListener('click', async ()=>{
      if(!isLoggedIn) return;
      msgs.push({ id:Date.now(), side, text:'', images:[] });
      await save();
      renderMessages(p);
      const rows=list.querySelectorAll('.msg-row');
      const last=rows[rows.length-1];
      if(last){ setEditingMsgRow(last); last.querySelector('.msg-text').focus(); }
      list.scrollTop = list.scrollHeight;
    });
    return b;
  };
  addRow.appendChild(mk('char',    '＋ ' + ((p.char && p.char.name) || '상대')));
  addRow.appendChild(mk('persona', '＋ ' + ((p.persona && p.persona.name) || '나')));
  list.appendChild(addRow);
}
/* 지금 고치는 중인 말풍선 하나에만 표시를 남깁니다 */
function setEditingMsgRow(row){
  document.querySelectorAll('.msg-row.editing').forEach(r=>{ if(r!==row) r.classList.remove('editing'); });
  if(row) row.classList.add('editing');
}
document.addEventListener('click', (e)=>{
  if(e.target.closest && e.target.closest('.msg-row')) return;
  document.querySelectorAll('.msg-row.editing').forEach(r=> r.classList.remove('editing'));
});

/* ---- OC 자유 텍스트 서식 ---- */
function saveOcFree(){
  const o=getCurrentOc();
  const el=document.getElementById('ocFree');
  if(!o || !el || !isLoggedIn) return;
  const html=editorHtml('ocFree');
  if(o.freeText===html) return;
  o.freeText=html;
  saveOc();
}
/* 지금 커서(선택 시작점)에 실제로 걸려 있는 글자 크기 */
function selectionFontSize(editor){
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount) return null;
  const range=sel.getRangeAt(0);
  let node=range.startContainer;
  // selectNodeContents 로 잡으면 startContainer 가 요소입니다 — 안으로 한 칸 들어갑니다
  if(node.nodeType===1) node=node.childNodes[range.startOffset] || node;
  if(node && node.nodeType===3) node=node.parentNode;
  if(!node || !editor.contains(node)) node=editor;
  return parseFloat(getComputedStyle(node).fontSize) || null;
}

/* 글자 크기를 1px 씩 올리고 내립니다.
   execCommand('fontSize') 는 1~7 단계뿐이라 px 을 직접 못 넣습니다. 그래서
   7 로 한 번 감싸 브라우저가 선택 영역을 알아서 잘라주게 한 뒤,
   그 껍데기를 실제 크기를 적은 span 으로 바꿔 답니다.
   기준 크기는 execCommand 를 부르기 *전에* 재둬야 합니다 —
   크롬이 이미 걸려 있던 span 을 <font> 로 통째로 바꿔버리기 때문입니다. */
function stepFontSize(editorId, delta){
  const editor=document.getElementById(editorId);
  if(!editor) return;
  const sel=window.getSelection();
  if(!sel || !sel.rangeCount || sel.isCollapsed) return;
  if(!editor.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
  const base=selectionFontSize(editor) || 12.5;
  const next=clamp(base+delta, 8, 40);
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  const made=[];
  editor.querySelectorAll('font[size="7"]').forEach(f=>{
    const span=document.createElement('span');
    span.style.fontSize=next+'px';
    while(f.firstChild) span.appendChild(f.firstChild);
    // 안쪽에 따로 지정돼 있던 크기는 걷어냅니다 —
    // 겹겹이 쌓이면 다음에 누를 때 기준이 흔들립니다
    span.querySelectorAll('[style*="font-size"]').forEach(el=>{
      el.style.fontSize='';
      if(!el.getAttribute('style')) el.removeAttribute('style');
    });
    f.replaceWith(span);
    made.push(span);
  });
  // 이어서 한 번 더 누를 수 있게 방금 바꾼 자리를 다시 선택해 둡니다
  if(made.length){
    const r=document.createRange();
    r.setStartBefore(made[0]);
    r.setEndAfter(made[made.length-1]);
    sel.removeAllRanges();
    sel.addRange(r);
  }
}
(function initOcFreeToolbar(){
  const toolbar=document.querySelector('.rt-toolbar-ocfree');
  const editor=document.getElementById('ocFree');
  if(!toolbar || !editor) return;
  // 버튼을 눌러도 본문 선택이 풀리지 않도록
  toolbar.querySelectorAll('button').forEach(b=> b.addEventListener('mousedown', e=> e.preventDefault()));
  toolbar.querySelectorAll('button[data-cmd]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      editor.focus();
      if(btn.dataset.cmd==='blockquote') insertBlockquote('ocFree');
      else document.execCommand(btn.dataset.cmd, false, null);
      saveOcFree();
    });
  });
  const color=document.getElementById('ocFreeColor');
  if(color) color.addEventListener('input', (e)=>{
    editor.focus();
    document.execCommand('foreColor', false, e.target.value);
    saveOcFree();
  });
  const up=document.getElementById('ocFreeSizeUp');
  if(up) up.addEventListener('click', ()=>{ stepFontSize('ocFree', 1); saveOcFree(); });
  const down=document.getElementById('ocFreeSizeDown');
  if(down) down.addEventListener('click', ()=>{ stepFontSize('ocFree', -1); saveOcFree(); });
  const fold=document.getElementById('ocFreeFoldBtn');
  if(fold) fold.addEventListener('click', ()=>{ insertFoldBlock('ocFree'); saveOcFree(); });
  initFoldEnter('ocFree');
  const divider=document.getElementById('ocFreeDividerBtn');
  if(divider) divider.addEventListener('click', ()=>{
    editor.focus();
    document.execCommand('insertHTML', false, '<hr><br>');
    saveOcFree();
  });
})();

function fillOcDetail(o){
  const title=document.getElementById('ocTitleInput');
  title.value=o.title; title.readOnly=!isLoggedIn;
  title.oninput=()=>{ if(!isLoggedIn)return; o.title=title.value; saveOc(); renderOcPosts(); };

  const sub=document.getElementById('ocSubtitleInput');
  sub.value=o.subtitle; sub.readOnly=!isLoggedIn;
  // 캐치프레이즈는 목록 카드에도 나오므로 함께 다시 그립니다
  sub.oninput=()=>{ if(!isLoggedIn)return; o.subtitle=sub.value; saveOc(); renderOcPosts(); };

  /* 대사 한 줄 — 보기 모드에서 비어 있으면 따옴표만 남으므로 줄째로 감춥니다 */
  const quote=document.getElementById('ocQuote');
  if(quote){
    quote.innerText = o.quote || '';
    quote.contentEditable = isLoggedIn ? 'true' : 'false';
    quote.onblur=()=>{ if(!isLoggedIn) return; if(o.quote===quote.innerText) return; o.quote=quote.innerText; saveOc(); };
    quote.onkeydown=(e)=>{ if(e.key==='Enter'){ e.preventDefault(); quote.blur(); } };
    const row=quote.closest('.oc-quote');
    if(row) row.style.display = (!isLoggedIn && !(o.quote||'').trim()) ? 'none' : '';
  }

  bindMeta('ocProfileName','name',o.profile, saveOc);
  bindMeta('ocProfileSub','subtitle',o.profile, saveOc);
  bindMetaContainer('ocMeta', o.profile, saveOc);
  renderOcKeywords(o);
  OC_THEME_HOST.idx = 0;
  renderThemeSongs(OC_THEME_HOST);
  if(ocSidePager) ocSidePager.set(0, false);   // 오른쪽 칸은 언제나 세로 이미지부터

  const free=document.getElementById('ocFree');
  free.innerHTML = o.freeText || '';
  free.contentEditable = isLoggedIn ? 'true' : 'false';
  // 접기 블록이 들어갈 수 있으므로 editorHtml 로 꺼냅니다 (펼친 상태는 떼고 저장)
  free.onblur=()=> saveOcFree();

  if(ocHeaderAdj) ocHeaderAdj.paint();
  if(ocProfileAdj) ocProfileAdj.paint();
  if(ocSideAdj) ocSideAdj.paint();
  bindRichTextToolbars();

  /* 갤러리·로그 엔진을 OC 창 쪽으로 돌려놓습니다 */
  galleryHost = OC_GALLERY_HOST;
  logHost = OC_LOG_HOST;
  pdLogPage = 1;
  currentLogFolderId = o.logFolders[0].id;
  logSelectMode = false; logSelectedIds.clear();
  currentGalleryFolderId = o.galleryFolders[0].id;
  galleryPage = 1;
  gallerySelectMode = false;
  gallerySelectedIdx.clear();
  const g = OC_GALLERY_HOST.root;
  if(g){
    g.querySelector('.gallery-select-info').style.display='none';
    g.querySelector('.gallery-select-delete').style.display='none';
    const st=g.querySelector('.gallery-select-toggle');
    st.innerText='✓'; st.classList.remove('active');
  }
  setOcPage(0, false);
  renderLogList(o);
  renderGallery(o);
}

function openOcDetail(id){
  currentOcId = id;
  const o = getCurrentOc();
  if(!o) return;
  prefetchImgs(o);   // 지금 보는 글의 사진을 대기열 맨 앞으로
  /* 창을 먼저 열고 나서 그립니다 (PAIR 과 같은 이유 — 위 주석 참고) */
  openModal('modalOcDetail');
  fillOcDetail(o);
  // 혹시 폭이 아직 안 잡혔을 때를 대비한 한 번 더
  setTimeout(()=>{
    if(ocProfileAdj) ocProfileAdj.paint();
    if(ocSideAdj) ocSideAdj.paint();
    if(ocHeaderAdj) ocHeaderAdj.paint();
  });
}

function initOcDetail(){
  ocHeaderAdj = createAdjustable(document.getElementById('ocHeaderImgBox'),
    ()=>{ const o=getCurrentOc(); return o ? o.headerImage : blankImg(); },
    (v)=>{ const o=getCurrentOc(); if(!o) return; o.headerImage=v; saveOc(); renderOcPosts(); });
  ocProfileAdj = createAdjustable(document.getElementById('ocProfileImgBox'),
    ()=>{ const o=getCurrentOc(); return o ? o.profile.image : blankImg(); },
    (v)=>{ const o=getCurrentOc(); if(!o) return; o.profile.image=v; saveOc(); });
  ocSideAdj = createAdjustable(document.getElementById('ocSideImgBox'),
    ()=>{ const o=getCurrentOc(); return o ? o.sideImage : blankImg(); },
    (v)=>{ const o=getCurrentOc(); if(!o) return; o.sideImage=v; saveOc(); });

  const pages = document.getElementById('ocPages');
  if(!pages) return;

  /* 테마곡 목록은 다릅니다 — 스크롤이 생겨 있으면 위아래 끝에 닿아도
     장을 넘기지 않고 그 칸에서만 스크롤합니다. 곡을 훑어보다가 창이
     넘어가버리면 곤란하기 때문입니다. 스크롤이 없으면 그냥 넘어갑니다. */
  const lockedByThemeList = (target)=>{
    if(!target || !target.closest) return false;
    const box = target.closest('.oc-theme-list');
    if(!box) return false;
    return box.scrollHeight > box.clientHeight + 1;
  };

  /* 안에서 따로 스크롤되는 칸(자유 텍스트 / LOG 표) 위에서는
     그 칸이 끝까지 내려간 뒤에야 페이지를 넘깁니다. */
  const consumedByInnerScroll = (target, down)=>{
    if(!target || !target.closest) return false;
    // 좁은 화면에서는 장 자체도 스크롤됩니다 (.oc-page)
    const box = target.closest('.oc-free-box, .log-table-scroll, .oc-page');
    if(!box) return false;
    if(box.scrollHeight <= box.clientHeight + 1) return false;
    const atTop = box.scrollTop <= 0;
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
    return down ? !atBottom : !atTop;
  };
  let wheelLock = 0;
  pages.addEventListener('wheel', (e)=>{
    // 안쪽에서 가로로 이미 처리한 휠(오른쪽 칸 / 갤러리)은 장 넘김에 쓰지 않습니다
    if(e.__ocHandled || wheelDeltaX(e)) return;
    if(Math.abs(e.deltaY) < 4) return;
    if(lockedByThemeList(e.target)) return;
    if(consumedByInnerScroll(e.target, e.deltaY>0)) return;
    const now = Date.now();
    if(now < wheelLock) return;
    wheelLock = now + 600;      // 한 번 굴릴 때 한 장만 넘어가게
    setOcPage(ocPageIdx + (e.deltaY>0 ? 1 : -1));
  }, {passive:true});

  /* 휠(가운데) 버튼을 누른 채 위아래로 끌면 장이 넘어갑니다.
     높이가 고정이라 크롬의 오토스크롤이 뜨지 않으므로 대신 붙였습니다.
     좌우로 끄는 것은 오른쪽 칸(makeSidePager)이 따로 받습니다. */
  let my=null, midMoved=false;
  pages.addEventListener('pointerdown', (e)=>{
    if(e.button!==1) return;
    e.preventDefault();
    my=e.clientY; midMoved=false;
    try{ pages.setPointerCapture(e.pointerId); }catch(_){}
  });
  pages.addEventListener('pointermove', (e)=>{
    if(my===null) return;
    const dy=e.clientY-my;
    if(Math.abs(dy) < 60 || midMoved) return;
    midMoved=true;
    setOcPage(ocPageIdx + (dy<0 ? 1 : -1));
  });
  const endMid=()=>{ my=null; };
  pages.addEventListener('pointerup', endMid);
  pages.addEventListener('pointercancel', endMid);
  pages.addEventListener('auxclick', (e)=>{ if(e.button===1) e.preventDefault(); });

  /* 손가락 위아래 스와이프. 갤러리의 좌우 스와이프와는 방향으로 구분됩니다. */
  let y0=null, x0=0, startTarget=null;
  pages.addEventListener('touchstart', (e)=>{
    if(e.touches.length!==1 || document.body.classList.contains('touch-dragging')){ y0=null; return; }
    y0=e.touches[0].clientY; x0=e.touches[0].clientX; startTarget=e.target;
  }, {passive:true});
  pages.addEventListener('touchend', (e)=>{
    if(y0===null) return;
    const dy=e.changedTouches[0].clientY-y0, dx=e.changedTouches[0].clientX-x0;
    y0=null;
    if(document.body.classList.contains('touch-dragging')) return;
    if(Math.abs(dy)<50 || Math.abs(dy)<Math.abs(dx)) return;
    // 안에서 아직 더 스크롤될 곳이 남았으면 페이지를 넘기지 않습니다
    if(lockedByThemeList(startTarget)) return;
    if(consumedByInnerScroll(startTarget, dy<0)) return;
    setOcPage(ocPageIdx + (dy<0 ? 1 : -1));
  }, {passive:true});
}

/* ---- OC 목록 버튼 ---- */
bindOnce(document.getElementById('ocWriteBtn'), async ()=>{
  if(!isLoggedIn) return;
  const post = migrateOcPost({ id:Date.now(), folderId:currentOcFolderId, type:newPostType(OC_CAT_NAV) });
  state.ocPosts.unshift(post);     // 새 글은 맨 앞에
  await saveOc();
  ocPage = 1;
  renderOcPosts();
  openOcDetail(post.id);
});
const ocSelectBtnEl = document.getElementById('ocSelectBtn');
if(ocSelectBtnEl) ocSelectBtnEl.addEventListener('click', ()=>{
  ocSelectMode = !ocSelectMode;
  ocSelectedIds.clear();
  renderOcPosts();
});
function updateOcSelectCountLabel(){
  const el=document.getElementById('ocSelectCountLabel');
  if(el) el.innerText = `${ocSelectedIds.size}개 선택됨`;
}
const ocSelectDeleteBtnEl = document.getElementById('ocSelectDeleteBtn');
if(ocSelectDeleteBtnEl) ocSelectDeleteBtnEl.addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  if(ocSelectedIds.size===0){ alert('삭제할 글을 먼저 선택해주세요.'); return; }
  if(!await siteConfirm(`선택한 ${ocSelectedIds.size}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  state.ocPosts = state.ocPosts.filter(x=> !ocSelectedIds.has(x.id));
  ocSelectedIds.clear();
  await saveOc();
  renderOcPosts();
});

/* ============================================================
   ARCHIVE
   ============================================================ */
let editingArcId = null;
let arcAttachments = [];

/* fillLogEditor 과 같은 이유로, 사진·첨부가 다 온 뒤에 채웁니다 */
async function openArcWriteModal(existingItem){
  editingArcId = existingItem ? existingItem.id : null;
  document.getElementById('arcWriteHeading').innerText = existingItem ? '게시글 수정' : '글쓰기';
  document.getElementById('arcCategoryInput').value = existingItem ? (existingItem.category||'ooc') : currentArchiveCategory;
  document.getElementById('arcTitleInput').value = existingItem ? existingItem.title : '';
  const editorEl = document.getElementById('arcContentEditor');
  editorEl.innerHTML = '';
  arcAttachments = [];
  renderArcAttachList();
  openModal('modalArcWrite');
  if(existingItem) await window.SiteStore.ensure([existingItem.content, existingItem.files || []]);
  if(editingArcId !== (existingItem ? existingItem.id : null)) return;   // 그 사이 다른 글을 열었으면 그만
  editorEl.innerHTML = existingItem ? imgUrl(existingItem.content) : '';
  // 예전에 넣은 코드 상자에도 복사 버튼이 생기도록
  ensureCodeEmbedCopy(editorEl);
  arcAttachments = existingItem && existingItem.files ? existingItem.files.slice() : [];
  renderArcAttachList();
  document.getElementById('modalArcWrite')._armUnsavedGuard?.();
}

document.getElementById('addArchiveBtn').addEventListener('click', ()=>{
  if(!isLoggedIn) return;
  openArcWriteModal(null);
});

document.querySelectorAll('.rt-toolbar-arc button[data-cmd]').forEach(btn=>{
  btn.addEventListener('mousedown', e=> e.preventDefault());
  btn.addEventListener('click', ()=>{
    const editor=document.getElementById('arcContentEditor');
    editor.focus();
    if(btn.dataset.cmd==='blockquote'){
      insertBlockquote('arcContentEditor');
    }else{
      document.execCommand(btn.dataset.cmd, false, null);
    }
  });
});
document.getElementById('arcColorInput').addEventListener('input', (e)=>{
  const editor=document.getElementById('arcContentEditor');
  editor.focus();
  document.execCommand('foreColor', false, e.target.value);
});

/* 인용구 안에서 엔터 — 브라우저 기본 동작은 인용구를 하나 더 만들어버립니다.
   커서 뒤에 남은 내용(있다면)은 새 문단으로 옮기고 그 문단으로 나가서,
   인용구는 하나만 남고 이어서 평범하게 씁니다. Shift+엔터는 그대로 둬서
   인용구 안에서 줄바꿈하는 기본 동작(<br> 삽입)이 계속 됩니다. */
document.getElementById('arcContentEditor').addEventListener('keydown', (e)=>{
  if(e.key !== 'Enter' || e.shiftKey) return;
  const sel = window.getSelection();
  if(!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const startEl = range.startContainer.nodeType===1 ? range.startContainer : range.startContainer.parentElement;
  const bq = startEl && startEl.closest('blockquote');
  if(!bq || !document.getElementById('arcContentEditor').contains(bq)) return;
  e.preventDefault();
  const afterRange = range.cloneRange();
  afterRange.selectNodeContents(bq);
  afterRange.setStart(range.endContainer, range.endOffset);
  const rest = afterRange.extractContents();
  const p = document.createElement('div');
  if(rest.textContent.trim() || rest.querySelector('img,hr')) p.appendChild(rest);
  else p.innerHTML = '<br>';
  bq.parentNode.insertBefore(p, bq.nextSibling);
  if(!bq.textContent.trim() && !bq.querySelector('img,hr')) bq.remove();
  const r = document.createRange();
  r.selectNodeContents(p); r.collapse(true);
  sel.removeAllRanges(); sel.addRange(r);
});
/* 구분선 삽입 (LOG 편집기와 같은 방식) */
const arcDividerBtn = document.getElementById('arcDividerBtn');
if(arcDividerBtn){
  arcDividerBtn.addEventListener('mousedown', e=> e.preventDefault());
  arcDividerBtn.addEventListener('click', ()=>{
    const editor=document.getElementById('arcContentEditor');
    editor.focus();
    document.execCommand('insertHTML', false, '<hr><br>');
  });
}

const arcFoldBtn = document.getElementById('arcFoldBtn');
if(arcFoldBtn){
  arcFoldBtn.addEventListener('mousedown', e=> e.preventDefault());
  arcFoldBtn.addEventListener('click', ()=> insertFoldBlock('arcContentEditor'));
}
initFoldEnter('arcContentEditor');

/* 이미지 삽입 + 삽입 후 삭제/이동 툴바 */
document.getElementById('arcInsertImageBtn').addEventListener('click', ()=>{
  /* 파일 선택창이 뜨는 동안 포커스가 옮겨가 선택이 풀리므로, 여는 시점의
     커서 위치를 기억해 뒀다가 넣기 직전에 되돌립니다 — 안 그러면 접기
     안에 있던 커서가 접기 밖으로 빠져나가 사진이 엉뚱한 자리에 들어갑니다. */
  const editorAtOpen = document.getElementById('arcContentEditor');
  const selAtOpen = window.getSelection();
  const rangeAtOpen = (selAtOpen.rangeCount && editorAtOpen.contains(selAtOpen.getRangeAt(0).commonAncestorContainer))
    ? selAtOpen.getRangeAt(0).cloneRange() : null;
  const input=document.createElement('input'); input.type='file'; input.accept='image/*';
  input.addEventListener('change', async ()=>{
    const f=input.files[0]; if(!f) return;
    const url=await fileToDataUrl(f);
    const editor=document.getElementById('arcContentEditor'); editor.focus();
    if(rangeAtOpen){
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(rangeAtOpen);
    }
    document.execCommand('insertHTML', false, `<img src="${url}" /><br>`);
  });
  input.click();
});
/* ============================================================
   본문 사진 — 툴바와 '가로 두 칸' 블록
   ------------------------------------------------------------
   사진 위에 커서를 올리면 위/아래로 옮기고 지우는 작은 줄이 뜹니다.
   사진을 다른 사진 위로 끌어다 놓으면 둘이 나란히 들어가는 두 칸짜리
   블록(.img-pair)이 만들어지고, 그 다음부터는 같은 줄의 단추로
   각 칸의 사진을 바꾸거나 좌우를 맞바꿉니다.
   블록은 통째로 하나의 덩어리라 contenteditable=false 로 둡니다 —
   그래야 편집기가 안쪽 칸 사이에 커서를 끼워 넣거나 칸을 쪼개지 않습니다.
   ============================================================ */
function removeImgToolbar(){ const t=document.querySelector('.img-toolbar'); if(t) t.remove(); }

/* 사진 하나를 고르게 하고 data URL 로 돌려줍니다 (툴바의 '변경' 이 씁니다) */
function pickImageFile(){
  return new Promise(resolve=>{
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.addEventListener('change', async ()=>{
      const f=input.files[0];
      resolve(f ? await fileToDataUrl(f) : null);
    });
    input.click();
  });
}

/* 사진 하나 뒤에 붙어 있는 줄바꿈까지 같이 걷어냅니다 —
   사진만 빼내면 빈 줄이 남습니다. */
function removeImgWithBreak(img){
  const next = img.nextSibling;
  if(next && next.nodeType===1 && next.tagName==='BR') next.remove();
  img.remove();
}

/* 두 칸 블록을 만들어 target 자리에 놓습니다 (왼쪽=target, 오른쪽=source) */
function makeImagePair(targetImg, sourceImg){
  const block=document.createElement('div');
  block.className='img-pair';
  block.setAttribute('contenteditable','false');
  [targetImg.getAttribute('src'), sourceImg.getAttribute('src')].forEach(src=>{
    const cell=document.createElement('div');
    cell.className='img-pair-cell';
    const im=document.createElement('img');
    im.setAttribute('src', src);
    cell.appendChild(im);
    block.appendChild(cell);
  });
  targetImg.parentNode.insertBefore(block, targetImg);
  const br=document.createElement('br');
  block.parentNode.insertBefore(br, block.nextSibling);
  removeImgWithBreak(targetImg);
  removeImgWithBreak(sourceImg);
  return block;
}

/* 두 칸 블록을 풀어 사진 한 장만 남깁니다 (칸 하나를 지웠을 때) */
function unwrapImagePair(block, keepSrc){
  const im=document.createElement('img');
  im.setAttribute('src', keepSrc);
  block.parentNode.insertBefore(im, block);
  block.remove();
}

function showImgToolbar(img){
  removeImgToolbar();
  const cell = img.parentElement && img.parentElement.classList.contains('img-pair-cell')
    ? img.parentElement : null;
  const block = cell ? cell.parentElement : null;
  /* 위/아래로 옮기고 지우는 대상은, 두 칸 블록 안의 사진이면 블록 전체입니다 */
  const unit = block || img;
  const rect = (cell || img).getBoundingClientRect();
  const toolbar=document.createElement('div');
  toolbar.className='img-toolbar';
  toolbar.innerHTML =
      (cell ? `<button type="button" data-act="swap-img" title="이 칸 사진 변경">변경</button>`
            + `<button type="button" data-act="flip" title="좌우 바꾸기">⇄</button>` : '')
    + `<button type="button" data-act="up" title="위로">↑</button>`
    + `<button type="button" data-act="down" title="아래로">↓</button>`
    + `<button type="button" data-act="del" title="${cell?'이 칸 사진 삭제':'삭제'}">✕</button>`;
  document.body.appendChild(toolbar);
  toolbar.style.left = rect.left+'px';
  toolbar.style.top = Math.max(0, rect.top-28)+'px';
  toolbar.addEventListener('mousedown', e=> e.preventDefault());
  const act = (name, fn)=>{
    const btn = toolbar.querySelector(`[data-act="${name}"]`);
    if(btn) btn.addEventListener('click', (e)=>{ e.stopPropagation(); fn(); });
  };
  act('del', ()=>{
    /* 두 칸 중 하나를 지우면 남은 한 장은 그대로 두고 블록만 풉니다 —
       한 칸짜리 두 칸 블록은 뜻이 없기 때문입니다. */
    if(cell){
      const other = Array.from(block.children).find(c=>c!==cell);
      const keep = other ? other.querySelector('img') : null;
      if(keep) unwrapImagePair(block, keep.getAttribute('src'));
      else block.remove();
    }else{
      img.remove();
    }
    removeImgToolbar();
  });
  act('up', ()=>{
    const prev=unit.previousElementSibling;
    if(prev) unit.parentNode.insertBefore(unit, prev);
    removeImgToolbar();
  });
  act('down', ()=>{
    const next=unit.nextElementSibling;
    if(next) unit.parentNode.insertBefore(next, unit);
    removeImgToolbar();
  });
  act('flip', ()=>{
    const cells = Array.from(block.children);
    if(cells.length===2) block.insertBefore(cells[1], cells[0]);
    removeImgToolbar();
  });
  act('swap-img', async ()=>{
    removeImgToolbar();
    const url = await pickImageFile();
    if(url) img.setAttribute('src', url);
  });
}

/* ---- 편집기 하나에 사진 조작을 붙입니다 (ARCHIVE 글쓰기 / LOG 글쓰기) ---- */
let draggedEditorImg = null;
function initEditorImageTools(editorId){
  const editor = document.getElementById(editorId);
  if(!editor) return;
  editor.addEventListener('mouseover', (e)=>{
    const img = e.target.closest('img');
    if(img) showImgToolbar(img);
  });
  editor.addEventListener('mouseout', (e)=>{
    const img = e.target.closest('img');
    if(img && (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.img-toolbar'))) removeImgToolbar();
  });

  /* 사진을 다른 사진 위로 끌어다 놓으면 두 칸 블록이 됩니다.
     이미 두 칸 블록 안에 든 사진은 끌지도, 받지도 않습니다 — 그쪽 사진을
     바꾸는 길은 툴바의 '변경' 하나로만 둬서, 끌다 놓쳐 한 장이 사라지는
     일이 없게 합니다. */
  const plainImg = (el)=>{
    const img = el && el.closest ? el.closest('img') : null;
    if(!img || !editor.contains(img)) return null;
    return img.closest('.img-pair') ? null : img;
  };
  editor.addEventListener('dragstart', (e)=>{
    const img = plainImg(e.target);
    if(!img) return;
    draggedEditorImg = img;
    img.classList.add('img-dragging');
    if(e.dataTransfer) e.dataTransfer.effectAllowed='move';
  });
  editor.addEventListener('dragover', (e)=>{
    if(!draggedEditorImg) return;
    const img = plainImg(e.target);
    if(!img || img===draggedEditorImg) return;
    e.preventDefault();
    editor.querySelectorAll('.img-drop-target').forEach(el=> el.classList.remove('img-drop-target'));
    img.classList.add('img-drop-target');
  });
  editor.addEventListener('dragleave', (e)=>{
    const img = plainImg(e.target);
    if(img) img.classList.remove('img-drop-target');
  });
  editor.addEventListener('drop', (e)=>{
    if(!draggedEditorImg) return;
    const target = plainImg(e.target);
    if(!target || target===draggedEditorImg) return;
    /* 막지 않으면 편집기가 자기 방식대로 사진을 옮겨 놓습니다 */
    e.preventDefault();
    e.stopPropagation();
    target.classList.remove('img-drop-target');
    removeImgToolbar();
    makeImagePair(target, draggedEditorImg);
    draggedEditorImg = null;
  });
  editor.addEventListener('dragend', ()=>{
    if(draggedEditorImg) draggedEditorImg.classList.remove('img-dragging');
    editor.querySelectorAll('.img-drop-target').forEach(el=> el.classList.remove('img-drop-target'));
    draggedEditorImg = null;
  });
}
const arcEditorEl = document.getElementById('arcContentEditor');
initEditorImageTools('arcContentEditor');
initEditorImageTools('logContent');
arcEditorEl.addEventListener('click', (e)=>{
  const img = e.target.closest('img');
  if(img) openArcLightbox(arcEditorEl, img);
});
document.getElementById('arcViewContent').addEventListener('click', (e)=>{
  const img = e.target.closest('img');
  if(img) openArcLightbox(document.getElementById('arcViewContent'), img);
});

/* --- Archive 이미지 라이트박스 (화살표 이동 + 우측 썸네일) --- */
let arcLbImages=[]; let arcLbIndex=0;
function openArcLightbox(containerEl, clickedImg){
  /* 아직 안 받은 사진은 src 가 비어 있습니다 — 그대로 넣으면 im.src 가
     페이지 주소로 읽혀 라이트박스에 엉뚱한 것이 뜹니다. */
  const imgs = Array.from(containerEl.querySelectorAll('img'))
    .filter(im=> im.getAttribute('src'));
  if(imgs.length===0) return;
  arcLbImages = imgs.map(im=>im.src);
  arcLbIndex = Math.max(0, imgs.indexOf(clickedImg));
  renderArcLightbox();
  document.getElementById('arcLightbox').classList.add('open');
}
function renderArcLightbox(){
  document.getElementById('arcLbMain').src = arcLbImages[arcLbIndex];
  const nav = arcLbImages.length>1;
  document.getElementById('arcLbPrev').style.display = nav?'flex':'none';
  document.getElementById('arcLbNext').style.display = nav?'flex':'none';
  const thumbs = document.getElementById('arcLbThumbs');
  thumbs.style.display = arcLbImages.length>1 ? 'flex' : 'none';
  thumbs.innerHTML='';
  arcLbImages.forEach((src,i)=>{
    const t=document.createElement('div');
    t.className='arc-lb-thumb'+(i===arcLbIndex?' active':'');
    t.style.backgroundImage=`url('${src}')`;
    applyThumbBg(t, src, 64);   // .arc-lb-thumb 는 64x64 고정
    t.addEventListener('click', ()=>{ arcLbIndex=i; renderArcLightbox(); });
    thumbs.appendChild(t);
  });
}
document.getElementById('arcLbPrev').addEventListener('click', ()=>{ arcLbIndex=(arcLbIndex-1+arcLbImages.length)%arcLbImages.length; renderArcLightbox(); });
document.getElementById('arcLbNext').addEventListener('click', ()=>{ arcLbIndex=(arcLbIndex+1)%arcLbImages.length; renderArcLightbox(); });
document.getElementById('arcLbClose').addEventListener('click', ()=> document.getElementById('arcLightbox').classList.remove('open'));
document.getElementById('arcLightbox').addEventListener('click', (e)=>{
  if(e.target.id==='arcLightbox') document.getElementById('arcLightbox').classList.remove('open');
});

/* 파일 첨부: 본문에 넣지 않고 별도 첨부 목록으로 관리 */
document.getElementById('arcInsertFileBtn').addEventListener('click', ()=>{
  const input=document.createElement('input'); input.type='file';
  input.addEventListener('change', async ()=>{
    const f=input.files[0]; if(!f) return;
    const url=await fileToDataUrl(f);
    arcAttachments.push({ name:f.name, src:url });
    renderArcAttachList();
  });
  input.click();
});
function renderArcAttachList(){
  const wrap=document.getElementById('arcAttachList');
  if(arcAttachments.length===0){ wrap.innerHTML='<div class="empty-note" style="padding:8px 0;">첨부된 파일이 없어요.</div>'; return; }
  wrap.innerHTML='';
  arcAttachments.forEach((f, idx)=>{
    const el=document.createElement('div'); el.className='arc-attach-item';
    el.innerHTML = `<a href="${imgUrl(f.src)}" download="${escapeHtml(f.name)}">📎 ${escapeHtml(f.name)}</a><button type="button" class="arc-attach-del" data-idx="${idx}">삭제</button>`;
    el.querySelector('.arc-attach-del').addEventListener('click', ()=>{ arcAttachments.splice(idx,1); renderArcAttachList(); });
    wrap.appendChild(el);
  });
}

/* 코드 삽입: 기본으로 실제 HTML/CSS 시뮬레이션(라이브 렌더링)을 보여주고, 다운로드 시점에 그 상태를 이미지로 캡처
   버튼을 누른 시점의 커서 위치를 기억해 뒀다가 넣을 때 그대로 되돌립니다 —
   모달이 열리는 동안 포커스가 옮겨가면서 선택이 풀리면, 그 뒤 editor.focus() 는
   기억된 위치 없이 기본 자리에 커서를 두므로 접기 안에 있던 커서가 접기 밖으로
   빠져나가 버립니다. */
let arcCodeInsertRange = null;
document.getElementById('arcInsertCodeBtn').addEventListener('click', ()=>{
  const editor = document.getElementById('arcContentEditor');
  const sel = window.getSelection();
  arcCodeInsertRange = (sel.rangeCount && editor.contains(sel.getRangeAt(0).commonAncestorContainer))
    ? sel.getRangeAt(0).cloneRange() : null;
  document.getElementById('arcCodeInput').value='';
  openModal('modalArcCode');
});
document.getElementById('arcCodeInsertBtn').addEventListener('click', ()=>{
  const code=document.getElementById('arcCodeInput').value;
  if(!code.trim()){ alert('코드를 입력해주세요.'); return; }
  const uid = 'ce'+Date.now();
  const html = `<div class="code-embed" id="${uid}" data-mode="preview" contenteditable="false">
    <div class="code-embed-toolbar">
      <button type="button" class="ce-tab active" data-mode="preview">미리보기</button>
      <button type="button" class="ce-tab" data-mode="code">&lt;/&gt; 코드</button>
      <button type="button" class="code-embed-copy" title="코드 복사">⧉</button>
      <button type="button" class="code-embed-download" title="이미지 다운로드">⬇</button>
    </div>
    <div class="code-embed-preview-live">${code}</div>
    <div class="code-embed-code" style="display:none;">${escapeHtml(code)}</div>
  </div><br>`;
  const editor=document.getElementById('arcContentEditor'); editor.focus();
  if(arcCodeInsertRange){
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(arcCodeInsertRange);
  }
  document.execCommand('insertHTML', false, html);
  closeModal('modalArcCode');
});
function setCodeEmbedMode(embed, mode){
  embed.dataset.mode = mode;
  embed.querySelectorAll('.ce-tab').forEach(t=> t.classList.toggle('active', t.dataset.mode===mode));
  embed.querySelector('.code-embed-preview-live').style.display = mode==='preview' ? 'block':'none';
  embed.querySelector('.code-embed-code').style.display = mode==='code' ? 'block':'none';
}
document.addEventListener('click', async (e)=>{
  const tab = e.target.closest('.ce-tab');
  if(tab){
    setCodeEmbedMode(tab.closest('.code-embed'), tab.dataset.mode);
    return;
  }
  const dlBtn = e.target.closest('.code-embed-download');
  if(dlBtn){
    const embed = dlBtn.closest('.code-embed');
    const wasCodeMode = embed.dataset.mode === 'code';
    if(wasCodeMode) setCodeEmbedMode(embed, 'preview');
    const preview = embed.querySelector('.code-embed-preview-live');
    try{
      const canvas = await html2canvas(preview, {backgroundColor:'#ffffff', scale:2});
      const url = canvas.toDataURL('image/png');
      const a=document.createElement('a'); a.href=url; a.download='code-embed.png'; a.click();
    }catch(err){ console.error('html2canvas failed', err); alert('이미지 변환에 실패했어요.'); }
    if(wasCodeMode) setCodeEmbedMode(embed, 'code');
    return;
  }
});

function arcEditorHtml(){ return editorHtml('arcContentEditor').trim(); }

bindOnce(document.getElementById('saveArcBtn'), async ()=>{
  const title=document.getElementById('arcTitleInput').value.trim();
  const category=document.getElementById('arcCategoryInput').value;
  const content=arcEditorHtml();
  if(!title){ alert('제목을 입력해주세요.'); return; }
  /* 새 글은 그 카테고리에서 지금 보고 있는 폴더에 들어갑니다.
     쓰는 도중에 카테고리를 바꿨으면 그쪽 카테고리의 첫 폴더에 넣습니다. */
  const catFolders = arcFoldersOf(category);
  const folderId = (category===currentArchiveCategory && curArcFolderId(category))
    ? curArcFolderId(category)
    : catFolders[0].id;
  if(editingArcId){
    const item = state.archive.find(x=>x.id===editingArcId);
    if(item){
      item.title=title; item.category=category; item.content=content; item.files=arcAttachments.slice();
      if(!item.folderId) item.folderId = folderId;
    }
  }else{
    state.archiveSeqCounter = (state.archiveSeqCounter||0) + 1;
    state.archive.push({ id:Date.now(), seq:state.archiveSeqCounter, category, title, content, date:nowStamp(), files:arcAttachments.slice(), pinned:false, folderId });
    await storageSet('archiveSeqCounter', state.archiveSeqCounter);
  }
  await storageSet('archive', state.archive);
  arcPage=1;
  renderArchive();
  closeModal('modalArcWrite');
});

const arcKebabBtn = document.getElementById('arcKebabBtn');
const arcKebabMenu = document.getElementById('arcKebabMenu');
arcKebabBtn.addEventListener('click', (e)=>{
  e.stopPropagation();
  arcKebabMenu.classList.toggle('open');
});
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#arcKebabMenu') && !e.target.closest('#arcKebabBtn')) arcKebabMenu.classList.remove('open');
});

document.getElementById('arcEditBtn').addEventListener('click', ()=>{
  arcKebabMenu.classList.remove('open');
  if(!isLoggedIn || !currentArcViewId) return;
  const item = state.archive.find(x=>x.id===currentArcViewId);
  if(!item) return;
  closeModal('modalArcView');
  openArcWriteModal(item);
});
document.getElementById('arcPinBtn').addEventListener('click', async ()=>{
  arcKebabMenu.classList.remove('open');
  if(!isLoggedIn || !currentArcViewId) return;
  const item = state.archive.find(x=>x.id===currentArcViewId);
  if(!item) return;
  if(!item.pinned){
    const pinnedCount = state.archive.filter(x=>x.pinned).length;
    if(pinnedCount>=3){ alert('고정은 최대 3개까지 가능해요.'); return; }
    item.pinned = true;
  }else{
    item.pinned = false;
  }
  await storageSet('archive', state.archive);
  updateArcPinBtn(item);
  renderArchive();
});
function updateArcPinBtn(item){
  const btn=document.getElementById('arcPinBtn');
  btn.innerText = item.pinned ? '해제' : '고정';
}
document.getElementById('arcDeleteBtn').addEventListener('click', async ()=>{
  arcKebabMenu.classList.remove('open');
  if(!isLoggedIn || !currentArcViewId) return;
  if(!await siteConfirm('이 게시글을 삭제할까요?')) return;
  state.archive = state.archive.filter(x=>x.id!==currentArcViewId);
  await storageSet('archive', state.archive);
  closeModal('modalArcView');
  renderArchive();
});

let arcPage=1;
let currentArcViewId=null;
/* 지금 보고 있는 폴더는 세부 카테고리마다 따로 기억합니다 —
   OOC 를 보다 ETC 로 갔다 돌아와도 아까 보던 폴더가 그대로 열립니다. */
const currentArcFolderIds = { ooc:null, nai:null, etc:null };
function curArcFolderId(cat){ return currentArcFolderIds[cat || currentArchiveCategory]; }
function setCurArcFolderId(id, cat){ currentArcFolderIds[cat || currentArchiveCategory] = id; }
/* PROMPT 전용 상태 */
let arcSelectMode = false;
let arcSelectedIds = new Set();
/* 👁 로 잠깐 선명하게 본 글. 페이지·폴더를 옮기면 다시 흐려지도록 비웁니다. */
let arcUnblurred = new Set();
let draggedArcId = null;
function openArcView(item){
  currentArcViewId = item.id;
  document.getElementById('arcViewTitle').innerText=item.title;
  document.getElementById('arcViewDate').innerText=item.date||'';
  const viewEl = document.getElementById('arcViewContent');
  const paintBody = ()=>{ viewEl.innerHTML = imgUrl(item.content); decorateContent(viewEl); };
  paintBody();
  whenImgArrives(item.content, viewEl, paintBody);
  updateArcPinBtn(item);
  const attachSection = document.getElementById('arcViewAttachSection');
  const attachList = document.getElementById('arcViewAttachList');
  if(item.files && item.files.length>0){
    attachSection.style.display='block';
    attachList.innerHTML='';
    item.files.forEach(f=>{
      const el=document.createElement('div'); el.className='arc-attach-item';
      const draw = ()=>{ el.innerHTML = `<a href="${imgUrl(f.src)}" download="${escapeHtml(f.name)}">📎 ${escapeHtml(f.name)}</a>`; };
      draw();
      whenImgArrives(f.src, el, draw);
      attachList.appendChild(el);
    });
  }else{
    attachSection.style.display='none';
  }
  openModal('modalArcView');
}
function extractFirstImage(html){
  const m = (html||'').match(/<img[^>]+src="([^"]*)"/i);
  return m ? m[1] : '';
}
/* 사이드바 세부 카테고리 키 → 상단 표기 */
const ARCHIVE_CAT_LABEL = { ooc:'OOC', nai:'PROMPT', etc:'ETC' };

/* --- ARCHIVE 검색 (보기 모드 전용, LOG 와 같은 방식) --- */
let arcSearchTerm = '';
let arcSearchField = 'title';
let arcSearchDate = '';
function filterArchiveItems(items){
  if(isLoggedIn) return items;
  const q = arcSearchTerm.trim().toLowerCase();
  const day = arcSearchDate;
  if(!q && !day) return items;
  return items.filter(item=>{
    if(day && dateKeyOf(item) !== day) return false;
    if(!q) return true;
    if(arcSearchField==='title') return (item.title||'').toLowerCase().includes(q);
    return htmlToPlainText(item.content||'').toLowerCase().includes(q);
  });
}
(function initArcSearch(){
  const input=document.getElementById('arcSearchInput');
  const field=document.getElementById('arcSearchField');
  const clear=document.getElementById('arcSearchClear');
  const dateEl=document.getElementById('arcSearchDate');
  if(!input || !field || !clear) return;
  const rerender=()=>{ arcPage=1; renderArchive(); };
  input.addEventListener('input', ()=>{ arcSearchTerm=input.value; rerender(); });
  field.addEventListener('change', ()=>{ arcSearchField=field.value; rerender(); });
  if(dateEl) dateEl.addEventListener('change', ()=>{ arcSearchDate=dateEl.value; rerender(); });
  clear.addEventListener('click', ()=>{
    input.value=''; arcSearchTerm='';
    if(dateEl){ dateEl.value=''; arcSearchDate=''; }
    rerender();
  });
})();

/* ARCHIVE 폴더 — OC 와 같은 상단바 드롭다운을 씁니다(renderFolderDropdown).
   세부 카테고리(OOC·PROMPT·ETC)마다 목록이 다르므로 지금 보고 있는 것을 따라갑니다. */
const ARC_FOLDER_DD = {
  rootId: 'arcFolderDD',
  folders: ()=> arcFoldersOf(currentArchiveCategory),
  currentId: ()=> curArcFolderId(),
  ctx: ()=> archiveFolderCtx(),
  select: (f)=>{
    setCurArcFolderId(f.id); arcPage=1;
    arcUnblurred.clear(); arcSelectedIds.clear();
    renderArchive();
  },
  draggedId: ()=> draggedArcId,
  onDrop: async (f)=>{
    // 선택해 둔 글이 있으면 함께, 없으면 끌던 글 하나만 옮깁니다
    const ids = new Set(arcSelectedIds); ids.add(draggedArcId);
    state.archive.forEach(x=>{ if(ids.has(x.id)) x.folderId = f.id; });
    draggedArcId=null; arcSelectedIds.clear(); arcUnblurred.clear();
    await storageSet('archive', state.archive);
    renderArchive();
  }
};
function renderArcFolderBar(){ renderFolderDropdown(ARC_FOLDER_DD); }

function renderArchive(){
  const wrap=document.getElementById('archiveBody');
  // PAIR 처럼 상단에 현재 카테고리를 함께 표기
  const titleEl=document.getElementById('archiveTitle');
  if(titleEl) titleEl.innerText = 'Archive · ' + (ARCHIVE_CAT_LABEL[currentArchiveCategory] || currentArchiveCategory);
  const isGallery = currentArchiveCategory==='nai';

  /* 선택 / 일괄 삭제는 세 카테고리 모두에서 씁니다.
     PROMPT 는 썸네일 위에 체크가 뜨고, OOC·ETC 는 표 맨 앞에 체크 칸이 생깁니다. */
  const selBtn=document.getElementById('arcSelectBtn');
  const selDelBtn=document.getElementById('arcSelectDeleteBtn');
  if(selBtn){
    selBtn.style.display = 'inline-flex';
    selBtn.innerText = arcSelectMode ? '선택 취소' : '선택';
    selBtn.classList.toggle('active', arcSelectMode);
  }
  if(selDelBtn) selDelBtn.style.display = arcSelectMode ? 'inline-flex' : 'none';

  // PROMPT 는 4열 x 2행(모바일은 2열 x 4행)으로 8개 고정,
  // OOC/ETC 는 데스크톱 15줄 / 모바일 10줄
  const perPage = isGallery ? 8 : (isMobileWidth() ? 10 : 15);

  /* 세부 카테고리(OOC·PROMPT·ETC) 안에서 폴더로 한 번 더 걸러 보여줍니다.
     폴더 고르기는 목록 위 탭이 아니라 상단바 드롭다운입니다. */
  const folderBarHtml = '';
  const folderDD = document.getElementById('arcFolderDD');
  if(folderDD) folderDD.style.display = '';
  const folders = arcFoldersOf(currentArchiveCategory);
  const folder = folders.find(f=>f.id===curArcFolderId()) || folders[0];
  setCurArcFolderId(folder.id);
  let catItems = state.archive.filter(x=>
    (x.category||'ooc')===currentArchiveCategory && arcFolderIdOf(x)===folder.id);

  /* 잠긴 비밀 폴더는 내용을 아예 그리지 않습니다 */
  if(folderLocked(folder)){
    wrap.innerHTML = folderBarHtml
      + (isGallery ? `<div class="arc-nai-grid">${'<div class="arc-nai-slot"></div>'.repeat(8)}</div>` : '')
      + '<div class="gallery-locked"><div class="gl-icon">🔒</div>'
      + '<div class="gl-text">비밀 폴더입니다.</div>'
      + '<button type="button" class="btn-ghost" id="arcUnlockBtn">비밀번호 입력</button></div>'
      + '<div class="log-pagination-slot"></div>';
    renderArcFolderBar();
    const ub = document.getElementById('arcUnlockBtn');
    if(ub) ub.addEventListener('click', ()=> openFolderUnlock(folder, ()=> renderArchive()));
    return;
  }

  if(catItems.length===0){
    wrap.innerHTML = folderBarHtml + '<div class="empty-note">아직 백업된 항목이 없어요.</div>';
    renderArcFolderBar();
    return;
  }
  const found = filterArchiveItems(catItems);
  if(found.length===0){
    wrap.innerHTML = folderBarHtml + '<div class="empty-note">검색 결과가 없어요.</div>';
    renderArcFolderBar();
    return;
  }
  const pinned = found.filter(x=>x.pinned).slice(0,3).sort((a,b)=>(a.seq||0)-(b.seq||0));
  const rest = found.filter(x=>!x.pinned).slice().sort((a,b)=>(b.seq||0)-(a.seq||0));
  const items = [...pinned, ...rest];

  /* 화면에 보이는 No 는 저장된 seq(누적 카운터)가 아니라
     카테고리 안의 등록 순서로 1부터 다시 매긴다.
     seq 를 그대로 쓰면 글을 모두 지운 뒤 새로 써도 번호가 계속 커진다.
     등록 순서를 기준으로 하므로 고정(📌)해도 번호는 바뀌지 않는다. */
  const chrono = catItems.slice().sort((a,b)=> (a.seq||0)-(b.seq||0) || (a.id||0)-(b.id||0));
  const displayNo = new Map(chrono.map((it,i)=> [it, i+1]));

  const totalPages=Math.max(1, Math.ceil(items.length/perPage));
  if(arcPage>totalPages) arcPage=totalPages;
  if(arcPage<1) arcPage=1;
  const start=(arcPage-1)*perPage;
  const pageItems=items.slice(start, start+perPage);

  let pag='';
  if(totalPages>1){
    pag += `<button class="log-pg-btn" data-pg="prev" ${arcPage===1?'disabled':''}>&lt;</button>`;
    for(let i=1;i<=totalPages;i++){ pag += `<button class="log-pg-btn ${i===arcPage?'active':''}" data-pg="${i}">${i}</button>`; }
    pag += `<button class="log-pg-btn" data-pg="next" ${arcPage===totalPages?'disabled':''}>&gt;</button>`;
  }

  if(isGallery){
    const folderBlur = !!(folder && folder.blur);
    let cells='';
    pageItems.forEach((item,i)=>{
      const thumb = extractFirstImage(item.content);
      const blurred = folderBlur && !arcUnblurred.has(item.id);
      const checked = arcSelectedIds.has(item.id);
      /* 이미지는 안쪽 레이어에 깝니다 — 흐림 효과가 제목/버튼까지 번지지 않게 */
      cells += `<div class="arc-nai-thumb${blurred?' blurred':''}" data-abs="${start+i}">
        <div class="an-img"${thumb?` style="background-image:url('${imgUrl(thumb)}')"`:''}></div>
        ${(item.pinned && !arcSelectMode)?'<span class="arc-nai-pin">📌</span>':''}
        ${folderBlur?'<button type="button" class="an-eye" title="흐림 해제">👁︎</button>':''}
        ${arcSelectMode?`<div class="gallery-check${checked?' checked':''}">${checked?'✓':''}</div>`:''}
        <div class="arc-nai-overlay ${thumb?'':'arc-nai-overlay-static'}"><div class="arc-nai-title">${escapeHtml(item.title)}</div></div>
      </div>`;
    });
    /* 페이지 버튼 자리는 항상 비워두고(하단 중앙 고정),
       다음 페이지가 있을 때만 버튼을 그린다 — 격자 높이가 흔들리지 않게 */
    wrap.innerHTML = folderBarHtml + `<div class="arc-nai-grid">${cells}</div>`
      + `<div class="log-pagination-slot">${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}</div>`;
    renderArcFolderBar();
    wrap.querySelectorAll('.arc-nai-thumb[data-abs]').forEach(el=>{
      const item = items[Number(el.dataset.abs)];

      /* 👁 — 이 글만 잠깐 선명하게. 페이지나 폴더를 옮기면 다시 흐려집니다. */
      const eye = el.querySelector('.an-eye');
      if(eye) eye.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(arcUnblurred.has(item.id)) arcUnblurred.delete(item.id);
        else arcUnblurred.add(item.id);
        el.classList.toggle('blurred', !arcUnblurred.has(item.id));
      });

      el.addEventListener('click', ()=>{
        if(arcSelectMode){
          if(arcSelectedIds.has(item.id)) arcSelectedIds.delete(item.id);
          else arcSelectedIds.add(item.id);
          renderArchive();
          return;
        }
        /* 터치 기기에는 hover 가 없습니다. 사진이 있는 칸은 첫 탭에서 반투명
           레이어와 제목이 뜨고, 두 번째 탭에서 글이 열립니다 — 마우스를 올려
           제목을 확인하고 누르던 흐름과 같습니다.
           사진이 없는 칸(.arc-nai-overlay-static)은 이미 제목이 보이므로 바로 엽니다. */
        const hasImage = !el.querySelector('.arc-nai-overlay-static');
        if(hasImage && !el.classList.contains('revealed')
           && !window.matchMedia('(hover:hover)').matches){
          // 한 번에 하나만 드러나게 (마우스를 옮기는 느낌과 같게)
          wrap.querySelectorAll('.arc-nai-thumb.revealed').forEach(o=> o.classList.remove('revealed'));
          el.classList.add('revealed');
          return;
        }
        openArcView(item);
      });

      /* 선택 모드에서는 폴더 탭으로 끌어다 옮길 수 있습니다.
         순서 바꾸기는 하지 않으므로 칸끼리는 서로 받지 않습니다. */
      if(arcSelectMode && isLoggedIn){
        el.draggable = true;
        el.addEventListener('dragstart', ()=>{ draggedArcId=item.id; el.classList.add('dragging'); });
        el.addEventListener('dragend', ()=>{ el.classList.remove('dragging'); draggedArcId=null; });
      }

      // 4열 격자라 칸이 작은데 원본은 800px대다 — 표시용 축소본으로 교체
      const src = extractFirstImage(item.content);
      const imgEl = el.querySelector('.an-img');
      if(src) applyThumbBg(imgEl, src);
      applyThumbPos(imgEl, item);
      if(arcSelectMode && src){
        addThumbPanControl(el, imgEl, item, ()=> storageSet('archive', state.archive));
      }
    });
  }else{
    /* 선택 모드에서는 표 맨 앞에 체크 칸이 한 줄 더 생깁니다
       (PROMPT 썸네일 위에 뜨는 체크와 같은 모양) */
    let rows='';
    pageItems.forEach((item,i)=>{
      const checked = arcSelectedIds.has(item.id);
      rows += `<tr data-abs="${start+i}"${checked?' class="selected"':''}>`
        + (arcSelectMode?`<td class="arc-td-check"><div class="gallery-check${checked?' checked':''}">${checked?'✓':''}</div></td>`:'')
        + `<td>${displayNo.get(item)||''}</td><td class="log-td-title">${item.pinned?'<span class="arc-pin-tag">📌</span> ':''}${escapeHtml(item.title)}</td><td>${item.date||''}</td></tr>`;
    });
    wrap.innerHTML = `<div class="archive-table-scroll"><table class="log-table"><thead><tr>${arcSelectMode?'<th class="arc-th-check"></th>':''}<th>No</th><th>Title</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<div class="log-pagination-slot">${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}</div>`;
    renderArcFolderBar();
    wrap.querySelectorAll('tr[data-abs]').forEach(tr=>{
      const item = items[Number(tr.dataset.abs)];
      tr.addEventListener('click', ()=>{
        if(arcSelectMode){
          if(arcSelectedIds.has(item.id)) arcSelectedIds.delete(item.id);
          else arcSelectedIds.add(item.id);
          renderArchive();
          return;
        }
        openArcView(item);
      });
      /* 편집 모드에서는 줄을 끌어 폴더 단추 위로 가져가면 메뉴가 펼쳐지고,
         항목에 놓으면 그 폴더로 옮겨집니다 (PROMPT 썸네일과 같은 방식). */
      if(isLoggedIn){
        tr.setAttribute('draggable','true');
        tr.addEventListener('dragstart', (e)=>{
          draggedArcId=item.id; tr.classList.add('dragging');
          if(e.dataTransfer){ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', String(item.id)); }
        });
        tr.addEventListener('dragend', ()=>{ tr.classList.remove('dragging'); draggedArcId=null; });
      }
    });
  }
  wrap.querySelectorAll('.log-pg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.pg==='prev') arcPage=Math.max(1,arcPage-1);
      else if(btn.dataset.pg==='next') arcPage=Math.min(totalPages,arcPage+1);
      else arcPage=Number(btn.dataset.pg);
      arcUnblurred.clear();   // 페이지를 옮기면 흐림 상태로 되돌립니다
      renderArchive();
    });
  });
}

/* ---- 선택 모드 (세 카테고리 공용) ---- */
const arcSelectBtnEl = document.getElementById('arcSelectBtn');
if(arcSelectBtnEl) arcSelectBtnEl.addEventListener('click', ()=>{
  arcSelectMode = !arcSelectMode;
  arcSelectedIds.clear();
  renderArchive();
});
const arcSelectDeleteBtnEl = document.getElementById('arcSelectDeleteBtn');
if(arcSelectDeleteBtnEl) arcSelectDeleteBtnEl.addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  if(arcSelectedIds.size===0){ alert('삭제할 글을 먼저 선택해주세요.'); return; }
  if(!await siteConfirm(`선택한 ${arcSelectedIds.size}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
  state.archive = state.archive.filter(x=> !arcSelectedIds.has(x.id));
  arcSelectedIds.clear();
  await storageSet('archive', state.archive);
  renderArchive();
});

/* ============================================================
   INIT
   ------------------------------------------------------------
   Firestore에서 데이터를 받아온 뒤 화면을 그립니다.
   로그인 상태가 바뀌면 편집 모드도 따라서 갱신됩니다.
   ============================================================ */
/* ============================================================
   모바일 / 터치
   ------------------------------------------------------------
   PC 동작은 그대로 두고, 마우스가 없어서 못 쓰는 조작만 채웁니다.
   ============================================================ */

/* ---- 햄버거 서랍 ---- */
function initMobileDrawer(){
  const btn = document.getElementById('mobileMenuBtn');
  const backdrop = document.getElementById('drawerBackdrop');
  const sidebar = document.getElementById('sidebar');
  if(!btn || !backdrop || !sidebar) return;

  const setOpen = (open)=>{
    sidebar.classList.toggle('open', open);
    backdrop.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  btn.addEventListener('click', ()=> setOpen(!sidebar.classList.contains('open')));
  backdrop.addEventListener('click', ()=> setOpen(false));
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') setOpen(false); });

  /* HOME 은 하위 메뉴가 없으니 바로 닫고,
     PAIR/ARCHIVE 는 이어서 하위 항목을 고를 수 있게 열어 둡니다. */
  document.querySelectorAll('.nav-item').forEach(b=>{
    b.addEventListener('click', ()=>{ if(b.dataset.view === 'home') setOpen(false); });
  });
  /* PAIR·OC 의 하위 항목은 JS 가 다시 그리므로 위임해서 받습니다.
     ＋(분류 추가)와 ✎(이름 변경)은 창이 뜨는 동안 서랍이 열려 있어야 하므로 제외합니다. */
  sidebar.addEventListener('click', (e)=>{
    const item = e.target.closest('.nav-sub-item');
    if(!item || e.target.closest('.ns-edit')) return;
    setOpen(false);
  });

  // 창이 넓어져 PC 레이아웃으로 돌아가면 서랍 흔적을 지웁니다
  window.matchMedia(MOBILE_MQ).addEventListener('change', (e)=>{ if(!e.matches) setOpen(false); });
}

/* ---- HOME 페이지 전환 (휠 대체) ---- */
function initHomeTouchNav(){
  const wrap = document.getElementById('homePagesWrap');
  const cards = document.getElementById('home-cards-page');
  const toCards = document.getElementById('toCardsBtn');
  const toIntro = document.getElementById('toIntroBtn');
  if(toCards) toCards.addEventListener('click', ()=> wrap && wrap.classList.add('show-cards'));
  if(toIntro) toIntro.addEventListener('click', ()=> wrap && wrap.classList.remove('show-cards'));
  if(!wrap || !cards) return;

  let y0 = null, t0 = 0;
  wrap.addEventListener('touchstart', (e)=>{
    if(e.touches.length !== 1){ y0 = null; return; }
    y0 = e.touches[0].clientY; t0 = Date.now();
  }, {passive:true});
  wrap.addEventListener('touchend', (e)=>{
    if(y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if(Date.now() - t0 > 700) return;      // 천천히 끈 것은 스크롤로 봅니다
    if(Math.abs(dy) < 50) return;
    const showing = wrap.classList.contains('show-cards');
    if(!showing && dy < 0) wrap.classList.add('show-cards');
    else if(showing && dy > 0 && cards.scrollTop <= 0) wrap.classList.remove('show-cards');
  }, {passive:true});
}

/* ---- 갤러리 페이지 전환 (휠 대체) ---- */
function galleryStepPage(dir){
  if(galleryTransitioning) return;
  const p = galleryPost(); if(!p) return;
  const folder = getFolder(p, currentGalleryFolderId); if(!folder) return;
  const total = galleryTotalPages(folder);
  if(dir > 0 && galleryPage < total){
    animateGalleryPageChange(1, ()=>{ galleryPage++; renderGallery(p); });
  }else if(dir < 0 && galleryPage > 1){
    animateGalleryPageChange(-1, ()=>{ galleryPage--; renderGallery(p); });
  }
}
/* ---- 길게 눌러 드래그 ----------------------------------------
   HTML5 드래그앤드롭은 터치에서 아예 동작하지 않습니다.
   기존 dragstart/dragover/dragleave/drop/dragend 핸들러들은 전부 평범한
   리스너라서, 같은 이름의 MouseEvent 를 만들어 쏘면 그대로 실행됩니다.
   덕분에 카드 순서 / 프로필 정보행 / 갤러리 썸네일 / 폴더 탭 드롭 네 곳의
   기존 코드를 한 줄도 고치지 않고 터치를 지원합니다.
   (갤러리 화살표 위에 손가락을 얹고 있으면 페이지가 넘어가는 것도 그대로) */
function initTouchDrag(){
  const HOLD_MS = 400;        // 이만큼 누르고 있어야 드래그 시작
  const MOVE_TOLERANCE = 8;   // 그 전에 이만큼 움직이면 스크롤로 봅니다

  let timer = null, src = null, ghost = null, active = false;
  let startX = 0, startY = 0, offX = 0, offY = 0, lastTarget = null;

  const fire = (el, type, x, y)=>{
    if(!el) return;
    el.dispatchEvent(new MouseEvent(type, {
      bubbles:true, cancelable:true, clientX:x, clientY:y, view:window
    }));
  };

  const cleanup = ()=>{
    if(timer){ clearTimeout(timer); timer = null; }
    if(ghost){ ghost.remove(); ghost = null; }
    document.body.classList.remove('touch-dragging');
    src = null; active = false; lastTarget = null;
  };

  const begin = (visual)=>{
    active = true;
    if(navigator.vibrate) navigator.vibrate(15);   // 안드로이드만 반응, iOS 는 무시
    document.body.classList.add('touch-dragging');
    /* 길게 누르는 사이 브라우저가 이미 글자를 선택했을 수 있습니다.
       CSS 의 user-select:none 은 새 선택만 막으므로 여기서 한 번 지웁니다. */
    const sel = window.getSelection && window.getSelection();
    if(sel && sel.rangeCount) sel.removeAllRanges();

    const r = visual.getBoundingClientRect();
    offX = startX - r.left;
    offY = startY - r.top;
    ghost = visual.cloneNode(true);
    ghost.classList.add('touch-drag-ghost');
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    ghost.style.margin = '0';
    document.body.appendChild(ghost);

    fire(src, 'dragstart', startX, startY);
  };

  /* 화면 스크롤을 실제로 막는 것은 touchmove 의 preventDefault 뿐입니다.
     - pointermove 에서 preventDefault 해봐야 스크롤에는 아무 영향이 없습니다.
     - touch-action 은 손가락이 닿는 순간 값이 정해지므로, 드래그가 시작된
       뒤에 body 에 붙여도 이미 진행 중인 제스처에는 적용되지 않습니다.
     드래그는 손가락을 움직이지 않고 0.4초를 기다려야 시작되므로, 그 시점엔
     아직 스크롤이 시작되지 않아 첫 touchmove 를 막으면 위아래로 자유롭게
     끌 수 있습니다. */
  document.addEventListener('touchmove', (e)=>{
    if(active && e.cancelable) e.preventDefault();
  }, {passive:false});

  document.addEventListener('pointerdown', (e)=>{
    if(e.pointerType === 'mouse') return;         // PC 는 기본 DnD 를 씁니다
    const t = e.target;
    if(!(t instanceof Element)) return;
    // 글을 쓰는 중에는 iOS 텍스트 선택(돋보기)과 충돌하므로 걸지 않습니다
    if(t.closest('[contenteditable="true"]')) return;
    const handle = t.closest('[draggable="true"]');
    if(!handle) return;

    cleanup();
    src = handle;
    startX = e.clientX; startY = e.clientY;
    // 손잡이(::)만 draggable 인 정보행은 행 전체를 들어올려야 자연스럽습니다
    const visual = handle.closest('.meta-row') || handle;
    timer = setTimeout(()=> begin(visual), HOLD_MS);
  }, {passive:true});

  document.addEventListener('pointermove', (e)=>{
    if(e.pointerType === 'mouse' || !src) return;
    if(!active){
      // 아직 시작 전인데 움직였다면 스크롤하려던 것으로 봅니다
      if(Math.hypot(e.clientX - startX, e.clientY - startY) > MOVE_TOLERANCE) cleanup();
      return;
    }
    e.preventDefault();
    ghost.style.left = (e.clientX - offX) + 'px';
    ghost.style.top  = (e.clientY - offY) + 'px';

    // 고스트 자신이 잡히지 않게 잠깐 숨기고 아래 요소를 찾습니다
    ghost.style.display = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    ghost.style.display = '';

    if(under !== lastTarget){
      if(lastTarget) fire(lastTarget, 'dragleave', e.clientX, e.clientY);
      lastTarget = under;
    }
    if(under) fire(under, 'dragover', e.clientX, e.clientY);
  }, {passive:false});

  const finish = (e)=>{
    if(e.pointerType === 'mouse' || !src) return;
    if(!active){ cleanup(); return; }
    const source = src;
    ghost.style.display = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if(under) fire(under, 'drop', e.clientX, e.clientY);
    fire(source, 'dragend', e.clientX, e.clientY);

    /* 손을 떼면 브라우저가 click 을 한 번 더 보냅니다.
       그대로 두면 방금 옮긴 썸네일의 선택이 토글되므로 한 번만 막습니다. */
    const block = (ev)=>{ ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener('click', block, {capture:true, once:true});
    setTimeout(()=> document.removeEventListener('click', block, {capture:true}), 400);

    cleanup();
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', ()=> cleanup());
}

/* ---- 라이트박스 좌우 스와이프 ---- */
function initLightboxSwipe(){
  const bind = (id, onStep)=>{
    const el = document.getElementById(id);
    if(!el) return;
    let x0 = null, y0 = 0;
    el.addEventListener('touchstart', (e)=>{
      if(e.touches.length !== 1){ x0 = null; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    }, {passive:true});
    el.addEventListener('touchend', (e)=>{
      if(x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if(Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
      onStep(dx < 0 ? 1 : -1);     // 왼쪽으로 밀면 다음 장
    }, {passive:true});
  };
  bind('lightbox', (d)=> stepGalleryLightbox(d));
  bind('arcLightbox', (d)=>{
    if(arcLbImages.length < 2) return;
    arcLbIndex = (arcLbIndex + d + arcLbImages.length) % arcLbImages.length;
    renderArcLightbox();
  });
}

/* ---- 화면 크기가 바뀌면 한 페이지 장수가 달라지므로 다시 그립니다 ---- */
function initResponsiveWatch(){
  const onChange = ()=>{
    galleryPage = 1;
    const p = getCurrentPost();
    if(p && document.getElementById('modalPairDetail').classList.contains('open')) renderGallery(p);
    const o = getCurrentOc();
    if(o && document.getElementById('modalOcDetail').classList.contains('open')) renderGallery(o);
    if(document.getElementById('view-archive').classList.contains('active')) renderArchive();
    /* PAIR·OC 목록도 한 페이지 개수가 달라지므로(8 ↔ 4) 첫 페이지로 되돌리고 다시 그립니다 */
    pairPage = 1; ocPage = 1;
    if(document.getElementById('view-pair').classList.contains('active')) renderPairPosts();
    if(document.getElementById('view-oc').classList.contains('active')) renderOcPosts();
  };
  window.matchMedia(MOBILE_MQ).addEventListener('change', onChange);
  window.matchMedia(SHORT_MQ).addEventListener('change', onChange);
}

async function boot(){
  initPairImageAdjusters();
  initSaveIndicator();
  initFolderModal();
  initFolderUnlock();
  /* 갤러리·LOG 는 PAIR 상세와 OC 상세 두 곳에서 같은 코드로 돕니다 */
  initGalleryRoot(PAIR_GALLERY_HOST);
  initGalleryRoot(OC_GALLERY_HOST);
  initLogRoot(PAIR_LOG_HOST);
  initLogRoot(OC_LOG_HOST);
  initOcDetail();
  initSidePagers();
  initMobileDrawer();
  initHomeTouchNav();
  initLightboxSwipe();
  initTouchDrag();
  initResponsiveWatch();
  initContentBlocks();

  window.SiteStore.onAuthChange((admin)=>{
    isLoggedIn = admin;
    // 로그인/로그아웃 시 비밀 폴더 열람 기록을 비운다.
    // (편집 모드에서 열어둔 폴더가 보기 모드로 돌아온 뒤에도 열려 있으면 안 된다)
    unlockedFolders.clear();
    applyEditMode();
    const post = getCurrentPost();
    if(post && document.getElementById('modalPairDetail').classList.contains('open')) renderGallery(post);
    const oc = getCurrentOc();
    if(oc && document.getElementById('modalOcDetail').classList.contains('open')) renderGallery(oc);
  });

  /* 사진이 도착할 때마다 그 자리만 다시 칠합니다 */
  window.SiteStore.onBlobs(flushPendingPaints);
  initPhotoIndicator();

  try{
    await window.SiteStore.load();
  }catch(e){
    console.error('데이터를 불러오지 못했습니다.', e);
    showLoadError();
    return;
  }
  await loadState();

  /* 첫 화면(HOME)에 보이는 사진을 대기열 맨 앞으로 — renderAll 이
     안 보이는 목록까지 전부 그리면서 순서를 밀어냈을 수 있습니다. */
  prefetchImgs([state.profile, state.homeBanner, state.cards]);
}

/* ------------------------------------------------------------
   저장 상태 표시
   ------------------------------------------------------------
   저장은 자동(입력 후 약 1초)이라 성공/실패가 보이지 않으면
   저장된 줄 알고 창을 닫게 됩니다. 상태를 항상 보여줍니다.
   ------------------------------------------------------------ */
function initSaveIndicator(){
  const el = document.createElement('div');
  el.id = 'saveIndicator';
  el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9998;font-family:inherit;'
    + 'font-size:11px;padding:7px 12px;border:1px solid var(--border);background:var(--bg);'
    + 'color:var(--text);opacity:0;transition:opacity .25s;pointer-events:none;max-width:60vw;';
  document.body.appendChild(el);

  let hideTimer = null;
  const show = (text, sticky, bg, fg)=>{
    el.innerText = text;
    el.style.background = bg || 'var(--bg)';
    el.style.color = fg || 'var(--text)';
    el.style.opacity = '1';
    if(hideTimer) clearTimeout(hideTimer);
    if(!sticky) hideTimer = setTimeout(()=>{ el.style.opacity='0'; }, 1800);
  };

  window.SiteStore.onSaveState((s)=>{
    if(s==='saving') show('저장 중…', true);
    else if(s==='saved') show('저장됨 ✓', false);
    else if(s==='error') show('저장 실패 — 다시 시도 중입니다. 창을 닫지 마세요.', true, '#c1440e', '#fff');
  });

  // 저장되지 않은 변경분이 남은 채로 창을 닫으려 하면 경고
  window.addEventListener('beforeunload', (e)=>{
    if(window.SiteStore.hasUnsaved){ e.preventDefault(); e.returnValue = ''; }
  });
}

/* ------------------------------------------------------------
   사진 받는 중 표시
   ------------------------------------------------------------
   글은 바로 뜨지만 사진은 뒤에서 계속 들어옵니다. 아무 표시가 없으면
   빈 사진 칸을 보고 고장난 줄 알게 되므로, 다 받을 때까지만
   왼쪽 아래에 조용히 진행 상황을 보여줍니다.
   ------------------------------------------------------------ */
function initPhotoIndicator(){
  const el = document.createElement('div');
  el.id = 'photoIndicator';
  el.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:9998;font-family:inherit;'
    + 'font-size:11px;padding:7px 12px;border:1px solid var(--border);background:var(--bg);'
    + 'color:var(--text);opacity:0;transition:opacity .25s;pointer-events:none;';
  document.body.appendChild(el);

  let doneTimer = null;
  const tick = ()=>{
    const { done, total } = window.SiteStore.blobStats();
    if(!total) return;                       // 아직 사진 목록도 안 왔을 때
    if(done >= total){
      if(doneTimer) return;
      doneTimer = setTimeout(()=>{ el.style.opacity='0'; }, 600);
      return;
    }
    el.innerText = `사진 불러오는 중… ${done}/${total}`;
    el.style.opacity = '1';
  };
  window.SiteStore.onBlobs(tick);
  // 첫 장이 오기 전에도 뜨도록 잠깐 살펴봅니다
  const warmup = setInterval(()=>{
    tick();
    if(window.SiteStore.blobStats().total) clearInterval(warmup);
  }, 300);
  setTimeout(()=> clearInterval(warmup), 15000);
}

/* 불러오기 실패를 화면 위에 조용히 알립니다 (동작을 막지 않도록) */
function showLoadError(){
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;background:#c1440e;color:#fff;'
    + 'font-size:12px;padding:8px 12px;text-align:center;font-family:inherit;';
  bar.innerText = '데이터를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침 해주세요.';
  document.body.appendChild(bar);
}

if(window.SiteStore) boot();
else window.addEventListener('store-ready', boot, { once:true });
