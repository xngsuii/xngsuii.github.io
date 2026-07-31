/* ============================================================
   AUTH
   ============================================================ */
/* 로그인 상태는 Firebase Authentication이 관리합니다.
   비밀번호는 코드에 저장하지 않으며, 편집 권한은
   Firestore 보안 규칙이 서버에서 최종 확인합니다. */
let isLoggedIn = false;

function applyEditMode(){
  document.body.classList.toggle('logged-in', isLoggedIn);
  document.getElementById('loginBadge').innerText = isLoggedIn ? 'UNLOCKED' : 'LOCKED';
  document.getElementById('loginBtn').innerText = isLoggedIn ? '로그아웃' : '로그인';

  document.getElementById('profileName').readOnly = !isLoggedIn;
  document.getElementById('profileBio').readOnly = !isLoggedIn;
  document.getElementById('siteName').readOnly = !isLoggedIn;
  document.getElementById('homeIntro').contentEditable = isLoggedIn ? 'true' : 'false';

  introBannerAdj && introBannerAdj.paint();
  renderCards();
  renderOcPosts();
  renderArchive();
  if(currentPairPostId){
    const p = getCurrentPost();
    if(p) fillPairDetail(p);
  }
  if(currentOcId && document.getElementById('modalOcDetail').classList.contains('open')){
    const o = getCurrentOc();
    if(o) fillOcDetail(o);
  }
}

document.getElementById('loginBtn').addEventListener('click', async ()=>{
  if(isLoggedIn){ await window.SiteStore.signOut(); }
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
  archiveFolders:[], ocPosts:[], ocFolders:[]
};

/* ---- PROMPT 폴더 ----
   PAIR_GALLERY 의 폴더와 같은 모양({id,name,secret,pwHash,blur})이지만
   이미지가 아니라 아카이브 글을 담습니다. 글 쪽에 folderId 를 적어두고
   폴더 목록은 따로 저장합니다(개수가 적어 스칼라 키로 충분).
   기본 폴더 id 는 갤러리의 'default' 와 겹치지 않게 다른 이름을 씁니다 —
   비밀 폴더 열람 기록(unlockedFolders)을 두 곳이 함께 쓰기 때문입니다. */
const ARC_DEFAULT_FOLDER = 'arcdefault';
function normalizeArcFolders(list){
  const out = Array.isArray(list) ? list.slice() : [];
  if(!out.some(f=> f && f.id===ARC_DEFAULT_FOLDER)){
    out.unshift({ id:ARC_DEFAULT_FOLDER, name:'기본' });
  }
  out.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    if(f.blur   == null) f.blur   = false;
  });
  return out;
}
/* ---- OC 폴더 ----
   PROMPT 폴더와 같은 모양이지만 '썸네일 흐리게'는 쓰지 않고 비밀 폴더만 씁니다. */
const OC_DEFAULT_FOLDER = 'ocdefault';
function normalizeOcFolders(list){
  const out = Array.isArray(list) ? list.slice() : [];
  if(!out.some(f=> f && f.id===OC_DEFAULT_FOLDER)){
    out.unshift({ id:OC_DEFAULT_FOLDER, name:'기본' });
  }
  out.forEach(f=>{
    if(f.secret == null) f.secret = false;
    if(f.pwHash == null) f.pwHash = '';
    f.blur = false;
  });
  return out;
}
function ocFolderIdOf(item){
  const id = item.folderId || OC_DEFAULT_FOLDER;
  return state.ocFolders.some(f=>f.id===id) ? id : OC_DEFAULT_FOLDER;
}

/* OC 글 한 건의 기본 모양을 채웁니다 (예전 데이터에 빠진 항목도 여기서 메꿉니다) */
function migrateOcPost(o){
  o.title = o.title || '새 캐릭터';
  if(o.subtitle == null) o.subtitle = '캐치프레이즈';
  o.headerImage = normalizeImg(o.headerImage);
  o.sideImage   = normalizeImg(o.sideImage);
  o.profile = o.profile || {};
  if(o.profile.name == null) o.profile.name = '';
  if(o.profile.intro == null) o.profile.intro = '';
  if(o.profile.metaHtml == null) o.profile.metaHtml = '';
  o.profile.image = normalizeImg(o.profile.image);
  if(!Array.isArray(o.keywords) || o.keywords.length !== 3) o.keywords = ['키워드','키워드','키워드'];
  if(o.freeText == null) o.freeText = '';
  if(!o.folderId) o.folderId = OC_DEFAULT_FOLDER;
  o.log = o.log || [];
  migrateGalleryFolders(o);   // 갤러리 폴더 구조는 PAIR 과 똑같이 씁니다
  migrateLogIds(o);
  return o;
}

/* 로그인 상태는 데이터를 불러오기 전에 먼저 확정될 수 있고, 그때 applyEditMode 가
   renderArchive / renderOcPosts 를 부릅니다. 폴더 목록이 비어 있으면 폴더를 못 찾아
   터지므로, 기본 폴더를 미리 넣어둡니다. */
state.archiveFolders = normalizeArcFolders(null);
state.ocFolders = normalizeOcFolders(null);

/* 글이 가리키는 폴더가 지워졌으면 기본 폴더로 봅니다 */
function arcFolderIdOf(item){
  const id = item.folderId || ARC_DEFAULT_FOLDER;
  return state.archiveFolders.some(f=>f.id===id) ? id : ARC_DEFAULT_FOLDER;
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
    splitLegacyIntro(old.char);
    splitLegacyIntro(old.persona);
    migrateGalleryFolders(old);
    migrateLogIds(old);
    return old;
  }
  const migrated = {
    id: old.id, type: old.type, title: old.title||'',
    headerImage: normalizeImg(old.thumb),
    char:{ name:'', gender:'', age:'', height:'', keywords:defaultKw(), intro: old.charProfile||'', metaHtml:'', image: normalizeImg(old.charImg) },
    persona:{ name:'', gender:'', age:'', height:'', keywords:defaultKw(), intro: old.personaProfile||'', metaHtml:'', image: normalizeImg(old.personaImg) },
    relCharToPersona:'', relPersonaToChar:'',
    relLabelCharToPersona:'Relationship', relLabelPersonaToChar:'Relationship',
    log: old.log||[], gallery: old.gallery||[], timeline: old.timeline||[]
  };
  splitLegacyIntro(migrated.char);
  splitLegacyIntro(migrated.persona);
  migrateGalleryFolders(migrated);
  migrateLogIds(migrated);
  return migrated;
}
function migrateLogIds(p){
  let seed = Date.now();
  (p.log||[]).forEach(entry=>{ if(entry.id==null){ entry.id = seed++; } });
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
  });
}
function defaultKw(){ return [{text:'키워드',color:'#4b4bff'},{text:'키워드',color:'#4b4bff'},{text:'키워드',color:'#4b4bff'}]; }
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
  state.archiveFolders = normalizeArcFolders(await storageGet('archiveFolders', null));
  state.ocFolders = normalizeOcFolders(await storageGet('ocFolders', null));
  state.ocPosts   = (await storageGet('ocPosts', [])).map(migrateOcPost);
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
  const px = boxPx || el.clientWidth;
  if(!px){
    el._thumbTries = (el._thumbTries||0) + 1;
    if(el._thumbTries <= 20) setTimeout(()=>{ if(el.isConnected) applyThumbBg(el, src); }, 32);
    return;
  }
  el._thumbTries = 0;
  // dataset이 아니라 JS 속성 — data URL을 DOM 속성에 쓰면 안 된다
  el._thumbFor = src;
  const token = el._thumbToken = ++thumbToken;
  downscaleThumb(src, px).then(url=>{
    if(!url || !el.isConnected) return;
    // 그 사이 다시 렌더/확대된 경우(늦게 도착한 이전 요청) 무시
    if(el._thumbFor !== src || el._thumbToken !== token) return;
    el.style.backgroundImage = `url('${url}')`;
  });
}

/* ============================================================
   REUSABLE ADJUSTABLE IMAGE COMPONENT
   ============================================================ */
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
    if(o.src){
      layer.style.backgroundImage = `url(${o.src})`;
      // background-size가 컨테이너 기준 %라서 축소본으로 바꿔도 확대/위치 값은 그대로 유효하다
      const needPx = (container.clientWidth||0) * ((o.scale||100)/100);
      if(needPx){ thumbRetries = 0; applyThumbBg(layer, o.src, needPx); }
      else retryThumbWhenSized();
      layer.style.backgroundSize = (o.scale||100)+'% auto';
      layer.style.backgroundPosition = (o.x!=null?o.x:50)+'% '+(o.y!=null?o.y:50)+'%';
      if(emptyBtn) emptyBtn.style.display='none';
      if(changeBtn) changeBtn.style.display = isLoggedIn?'flex':'none';
    }else{
      layer.style.backgroundImage='';
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
      const o = { src:url, scale:100, x:50, y:50 };
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
const archiveSub = document.getElementById('archiveSub');
navItems.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    navItems.forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    pairSub.classList.toggle('open', btn.dataset.view==='pair');
    archiveSub.classList.toggle('open', btn.dataset.view==='archive');
    /* 큰 메뉴를 누르면 하위 분류는 늘 첫 항목으로 돌아갑니다 */
    if(btn.dataset.view==='pair'){
      currentPairFilter='all';
      document.querySelectorAll('#pairSub .nav-sub-item').forEach(b=>b.classList.toggle('active', b.dataset.pairsub==='all'));
      document.getElementById('pairTitle').innerText='Pair · 전체';
      pairPage=1;
      renderPairPosts();
    }
    if(btn.dataset.view==='oc'){
      ocPage=1; ocSelectMode=false; ocSelectedIds.clear();
      renderOcPosts();
    }
    if(btn.dataset.view==='archive'){
      currentArchiveCategory='nai';
      document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.toggle('active', b.dataset.archivesub==='nai'));
      arcPage=1;
      arcUnblurred.clear();
      renderArchive();
    }
  });
});
document.querySelectorAll('#pairSub .nav-sub-item').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('#pairSub .nav-sub-item').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    currentPairFilter = btn.dataset.pairsub;
    document.getElementById('pairTitle').innerText = 'Pair · ' + (currentPairFilter==='all'?'전체':currentPairFilter==='aichat'?'Ai chat':'Dream');
    pairPage = 1;
    renderPairPosts();
    navItems.forEach(b=>b.classList.remove('active'));
    document.querySelector('.nav-item[data-view="pair"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-pair').classList.add('active');
    // 고른 쪽만 열어둡니다 — 큰 메뉴를 눌러 들어왔을 때와 같은 모습이 되도록
    pairSub.classList.add('open');
    archiveSub.classList.remove('open');
  });
});
document.querySelectorAll('#archiveSub .nav-sub-item').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    currentArchiveCategory = btn.dataset.archivesub;
    arcPage=1;
    arcUnblurred.clear();
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
homePagesWrap.addEventListener('wheel', (e)=>{
  const showingCards = homePagesWrap.classList.contains('show-cards');
  if(!showingCards){
    if(e.deltaY>0){ homePagesWrap.classList.add('show-cards'); }
  }else{
    if(e.deltaY<0 && homeCardsPageEl.scrollTop<=0){ homePagesWrap.classList.remove('show-cards'); }
  }
}, {passive:true});

/* ============================================================
   MODAL HELPERS
   ============================================================ */
/* 붙여넣기 시 외부 서식 제거 - 항상 순수 텍스트만 삽입 */
document.addEventListener('paste', (e)=>{
  const target = e.target;
  if(target && target.isContentEditable){
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }
});

function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('[data-close]').forEach(el=>{ el.addEventListener('click', ()=> el.closest('.modal-overlay').classList.remove('open')); });
document.querySelectorAll('.modal-overlay').forEach(ov=>{ ov.addEventListener('click',(e)=>{ if(e.target===ov) ov.classList.remove('open'); }); });

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
  state.cards.push({ id:Date.now(), name:'이름', catch:'캐치프레이즈', genre:'장르', desc:'짧은 소개글을 입력하세요.', image:blankImg() });
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
const cardGridEl = document.getElementById('cardGrid');
cardGridEl.addEventListener('dragover', (e)=>{
  e.preventDefault();
  if(!draggedCardEl) return;
  const target = e.target.closest('.dream-card');
  if(!target || target===draggedCardEl || target.parentNode!==cardGridEl) return;
  const rects = flipCapture(cardGridEl, '.dream-card');
  const rect = target.getBoundingClientRect();
  const before = (e.clientX - rect.left) < rect.width/2;
  cardGridEl.insertBefore(draggedCardEl, before?target:target.nextSibling);
  flipPlay(rects);
});
cardGridEl.addEventListener('drop', (e)=> e.preventDefault());

function renderCards(){
  const grid=document.getElementById('cardGrid');
  grid.querySelectorAll('.dream-card').forEach(el=>el.remove());
  state.cards.forEach(c=>{
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
        reorderArrayByDomOrder(grid, '.dream-card', state.cards);
        await storageSet('cards', state.cards);
      }
      draggedCardEl=null;
    });
    grid.appendChild(el);
  });
}

/* ============================================================
   PAIR
   ============================================================ */
let currentPairFilter='all';
let currentArchiveCategory='nai';   // ARCHIVE 첫 진입은 PROMPT
let selectMode=false;
let selectedPairIds=new Set();

bindOnce(document.getElementById('writePairBtn'), async ()=>{
  if(!isLoggedIn) return;
  const post = migratePost({ id:Date.now(), type: currentPairFilter==='dream'?'dream':'aichat', title:'새 페어' });
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
  if(!confirm(`선택한 ${selectedPairIds.size}개 글을 삭제할까요?`)) return;
  state.pairPosts = state.pairPosts.filter(p=>!selectedPairIds.has(p.id));
  await storageSet('pairPosts', state.pairPosts);
  selectedPairIds.clear();
  renderPairPosts();
});
document.getElementById('moveToAichatBtn').addEventListener('click', async ()=>{
  if(selectedPairIds.size===0) return;
  state.pairPosts.forEach(p=>{ if(selectedPairIds.has(p.id)) p.type='aichat'; });
  await storageSet('pairPosts', state.pairPosts);
  selectedPairIds.clear();
  renderPairPosts();
});
document.getElementById('moveToDreamBtn').addEventListener('click', async ()=>{
  if(selectedPairIds.size===0) return;
  state.pairPosts.forEach(p=>{ if(selectedPairIds.has(p.id)) p.type='dream'; });
  await storageSet('pairPosts', state.pairPosts);
  selectedPairIds.clear();
  renderPairPosts();
});

/* PROMPT 페이지와 같은 4열 x 2행 = 8개 (모바일은 2열 x 4행).
   CSS 의 .post-grid 열/행 수와 반드시 짝을 맞춰야 합니다. */
const PAIR_PER_PAGE = 8;
let pairPage = 1;

function renderPairPosts(){
  const grid=document.getElementById('postGrid'); grid.innerHTML='';
  const pagSlot=document.getElementById('pairPagination');
  if(pagSlot) pagSlot.innerHTML='';
  const list = state.pairPosts.filter(p=> currentPairFilter==='all' || p.type===currentPairFilter);
  if(list.length===0){ grid.innerHTML='<div class="empty-note">아직 작성된 글이 없어요.</div>'; return; }

  const totalPages = Math.max(1, Math.ceil(list.length/PAIR_PER_PAGE));
  if(pairPage>totalPages) pairPage=totalPages;
  if(pairPage<1) pairPage=1;
  const start=(pairPage-1)*PAIR_PER_PAGE;
  const pageItems = list.slice(start, start+PAIR_PER_PAGE);

  pageItems.forEach(p=>{
    const el=document.createElement('div'); el.className='post-card'+(selectMode?' selectable':'');
    el.dataset.id = p.id;
    const checked = selectedPairIds.has(p.id);
    el.innerHTML = `${selectMode?`<div class="post-check ${checked?'checked':''}">${checked?'✓':''}</div>`:''}
      <div class="post-thumb" style="background-image:url('${(p.headerImage&&p.headerImage.src)||''}')"></div>
      <div class="post-info"><div class="post-type">${p.type==='aichat'?'Ai chat':'Dream'}</div><div class="post-title">${escapeHtml(p.title)}</div></div>`;
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
    if(thumbSrc) applyThumbBg(el.querySelector('.post-thumb'), thumbSrc);
  });

  // 마지막 페이지가 덜 차도 격자 높이가 그대로 유지되도록 빈 자리를 채웁니다
  for(let i=pageItems.length;i<PAIR_PER_PAGE;i++){
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
  fillPairDetail(p);
  openModal('modalPairDetail');
  // 모달이 열려 레이아웃이 잡힌 뒤 한 번 더 그린다 — 숨겨진 상태에서는 컨테이너 폭이 0이라
  // 어느 크기의 축소본을 쓸지 판단할 수 없다 (rAF는 백그라운드 탭에서 실행되지 않아 setTimeout 사용)
  setTimeout(()=>{
    if(pdCharImgAdj) pdCharImgAdj.paint();
    if(pdPersonaImgAdj) pdPersonaImgAdj.paint();
    if(pdHeaderImgAdj) pdHeaderImgAdj.paint();
  });
}

let pdCharImgAdj=null, pdPersonaImgAdj=null, pdHeaderImgAdj=null;
function initPairImageAdjusters(){
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
  if(p.subtitle==null) p.subtitle='타이틀';
  subtitleInput.value=p.subtitle; subtitleInput.readOnly=!isLoggedIn;
  subtitleInput.oninput=()=>{ if(!isLoggedIn)return; p.subtitle=subtitleInput.value; storageSet('pairPosts',state.pairPosts); };

  bindMeta('pdCharName','name',p.char);
  bindMeta('pdPersonaName','name',p.persona);

  bindMetaContainer('pdCharMeta', p.char);
  bindBodyText('pdCharIntro', p.char);
  bindMetaContainer('pdPersonaMeta', p.persona);
  bindBodyText('pdPersonaIntro', p.persona);

  bindRelText('relCharToPersona','relCharToPersona',p);
  bindRelText('relPersonaToChar','relPersonaToChar',p);
  bindRelText('relLabelCharToPersona','relLabelCharToPersona',p);
  bindRelText('relLabelPersonaToChar','relLabelPersonaToChar',p);
  bindRelText('pdCharBubble','charBubble',p);
  bindRelText('pdPersonaBubble','personaBubble',p);

  pdCharImgAdj.paint();
  pdPersonaImgAdj.paint();
  pdHeaderImgAdj.paint();

  bindRichTextToolbars();
  /* 갤러리·로그 엔진을 PAIR 창 쪽으로 돌려놓습니다 */
  galleryHost = PAIR_GALLERY_HOST;
  logHost = PAIR_LOG_HOST;
  pdLogPage = 1;
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
  const save = ()=>{ obj.metaHtml=el.innerHTML; persistFn(); };
  el._saveMeta = save;

  el.addEventListener('focusout', (e)=>{
    if(!isLoggedIn) return;
    if(e.target.classList && (e.target.classList.contains('meta-label') || e.target.classList.contains('meta-value'))) save();
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
    const targetEl = document.getElementById(tb.dataset.target); // 본문 영역 (B/I/색상 적용 대상)
    const metaEl = document.getElementById(tb.dataset.metaTarget); // 라벨 컨테이너 (+ 버튼 대상)
    if(!targetEl) return;  // 대상이 없는 툴바는 건너뜀
    tb.querySelectorAll('button[data-cmd]').forEach(btn=>{
      btn.onmousedown = (e)=> e.preventDefault();
      btn.onclick = ()=>{ targetEl.focus(); document.execCommand(btn.dataset.cmd, false, null); };
    });
    const colorInput = tb.querySelector('.rt-color');
    if(colorInput) colorInput.oninput = (e)=>{ targetEl.focus(); document.execCommand('foreColor', false, e.target.value); };
    const addRowBtn = tb.querySelector('.rt-add-row');
    if(addRowBtn){
      addRowBtn.onmousedown = (e)=> e.preventDefault();
      addRowBtn.onclick = ()=>{
        const row=document.createElement('div');
        row.className='meta-row';
        row.innerHTML = `<span class="meta-drag" contenteditable="false" draggable="true" data-editonly>::</span><span class="meta-label" contenteditable="true">라벨</span><span class="meta-value" contenteditable="true">값</span><button type="button" class="meta-del" contenteditable="false" data-editonly>✕</button>`;
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
  const RE = /\*\*([^*\n]+)\*\*|"([^"\n]*)"|\(([^)\n]*)\)/g;
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
      }else if(m[2] !== undefined){                 // "보조색" — 따옴표 유지
        const s = document.createElement('span');
        s.style.color = subColor; s.textContent = `"${m[2]}"`;
        frag.appendChild(s);
      }else{                                        // (괄호색) — 괄호 유지
        const s = document.createElement('span');
        s.style.color = parenColor; s.textContent = `(${m[3]})`;
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

/* 요소의 자식들을 '한 줄'씩 묶어 돌려줍니다. 줄은 <br> 또는 블록 요소로 끊깁니다. */
function contentLines(root){
  const lines = [];
  let cur = { nodes:[], text:'' };
  const push = ()=>{ lines.push(cur); cur = { nodes:[], text:'' }; };
  Array.from(root.childNodes).forEach(node=>{
    if(node.nodeType===1 && node.tagName==='BR'){ cur.nodes.push(node); push(); return; }
    if(node.nodeType===1 && BLOCK_TAGS.includes(node.tagName)){
      if(cur.nodes.length) push();
      cur.nodes.push(node);
      cur.text = node.textContent || '';
      push();
      return;
    }
    cur.nodes.push(node);
    cur.text += node.textContent || '';
  });
  if(cur.nodes.length) push();
  return lines;
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
   닫는 ``` 이 없으면 손대지 않고 원문 그대로 둡니다. */
function applyCodeFences(root){
  const plain = (s)=> String(s||'').replace(NBSP_RE,' ');
  const lines = contentLines(root);
  let i = 0;
  while(i < lines.length){
    const t = plain(lines[i].text);
    const open = t.indexOf(CODE_FENCE);
    if(open < 0){ i++; continue; }
    let code, endLine;
    const sameLine = t.indexOf(CODE_FENCE, open + CODE_FENCE.length);
    if(sameLine >= 0){
      code = t.slice(open + CODE_FENCE.length, sameLine);
      endLine = i;
    }else{
      let j = i + 1;
      while(j < lines.length && plain(lines[j].text).indexOf(CODE_FENCE) < 0) j++;
      if(j >= lines.length){ i++; continue; }   // 닫는 ``` 이 없음
      code = lines.slice(i+1, j).map(l=> plain(l.text)).join('\n');
      endLine = j;
    }
    const anchor = lines[i].nodes[0];
    if(anchor && anchor.parentNode){
      anchor.parentNode.insertBefore(makeCodeBlock(code), anchor);
      for(let k=i;k<=endLine;k++) lines[k].nodes.forEach(n=> n.remove());
    }
    i = endLine + 1;
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

/* 게시글 본문 한 번에 처리 — 코드 블록 + 코드 상자 복사 버튼 */
function decorateContent(el){
  applyCodeFences(el);
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

/* 접기 블록을 편집기에 넣습니다 (ARCHIVE 와 PAIR_LOG 가 함께 씁니다).
   넣자마자 내용을 적어야 하므로 펼친 상태로 만들고,
   저장할 때 editorHtml() 이 .open 을 떼어내 게시글에서는 접힌 채로 시작합니다. */
function insertFoldBlock(editorId){
  const editor = document.getElementById(editorId);
  if(!editor) return;
  editor.focus();
  document.execCommand('insertHTML', false,
    '<div class="fold-block open">'
    + '<div class="fold-head"><span class="fold-arrow" contenteditable="false">▾</span>'
    + '<span class="fold-title">타이틀</span></div>'
    + '<div class="fold-body">내용을 입력하세요</div></div><br>');
}

/* 저장할 본문을 꺼냅니다 — 펼쳐둔 접기 블록은 접힌 상태로 되돌립니다 */
function editorHtml(editorId){
  const copy = document.getElementById(editorId).cloneNode(true);
  copy.querySelectorAll('.fold-block.open').forEach(b=> setFoldOpen(b, false));
  return copy.innerHTML;
}

/* 저장된 본문을 화면에 그릴 때 쓰는 렌더러 */
function renderLogContentInto(el, entry){
  el.innerHTML = logContentToHtml(entry.content);
  decorateContent(el);
  applyAutoFormat(el,
    entry.subColor   || LOG_SUB_COLOR_DEFAULT,
    entry.parenColor || LOG_PAREN_COLOR_DEFAULT);
}

/* --- Log (작성 시각 자동, 15개씩 페이지네이션, 행 크기/폰트는 완전 고정) --- */
let pdLogPage = 1;
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
  const perPage=15;
  const all = p.log.slice().reverse();
  const items = filterLogItems(all);
  if(all.length===0){ wrap.innerHTML='<div class="empty-note">등록된 게시글이 없어요.</div>'; return; }
  if(items.length===0){ wrap.innerHTML='<div class="empty-note">검색 결과가 없어요.</div>'; return; }
  const totalPages = Math.max(1, Math.ceil(items.length/perPage));
  if(pdLogPage>totalPages) pdLogPage=totalPages;
  if(pdLogPage<1) pdLogPage=1;
  const start=(pdLogPage-1)*perPage;
  const pageItems = items.slice(start, start+perPage);

  let rows='';
  pageItems.forEach((entry, i)=>{
    const num = items.length - (start+i);
    rows += `<tr data-abs="${start+i}"><td>${num}</td><td class="log-td-title">${escapeHtml(entry.title)}</td><td>${entry.date||''}</td></tr>`;
  });
  let pag='';
  if(totalPages>1){
    pag += `<button class="log-pg-btn" data-pg="prev" ${pdLogPage===1?'disabled':''}>&lt;</button>`;
    for(let i=1;i<=totalPages;i++){ pag += `<button class="log-pg-btn ${i===pdLogPage?'active':''}" data-pg="${i}">${i}</button>`; }
    pag += `<button class="log-pg-btn" data-pg="next" ${pdLogPage===totalPages?'disabled':''}>&gt;</button>`;
  }
  wrap.innerHTML = `<div class="log-table-scroll"><table class="log-table" id="pdLogTable"><thead><tr><th>No</th><th>LOG</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="log-pagination-slot">${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}</div>`;

  wrap.querySelectorAll('tr[data-abs]').forEach(tr=>{
    tr.addEventListener('click', ()=>{
      const entry = items[Number(tr.dataset.abs)];
      openLogView(entry);
    });
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

function fillLogEditor(entry){
  document.getElementById('logTitle').value = entry ? entry.title : '';
  document.getElementById('logContent').innerHTML = entry ? logContentToHtml(entry.content) : '';
  document.getElementById('logSubColor').value       = (entry && entry.subColor)       || LOG_SUB_COLOR_DEFAULT;
  document.getElementById('logParenColor').value     = (entry && entry.parenColor)     || LOG_PAREN_COLOR_DEFAULT;
  document.getElementById('logHighlightColor').value = (entry && entry.highlightColor) || LOG_HIGHLIGHT_DEFAULT;
  document.getElementById('logTextColor').value  = '#1a1a1a';
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
    p.log.push({ id:Date.now(), title, date:nowStamp(), content, subColor, parenColor, highlightColor });
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
  openModal('modalLogView');
}
const logKebabBtn = document.getElementById('logKebabBtn');
const logKebabMenu = document.getElementById('logKebabMenu');
logKebabBtn.addEventListener('click', (e)=>{ e.stopPropagation(); logKebabMenu.classList.toggle('open'); });
document.addEventListener('click', (e)=>{
  if(!e.target.closest('#logKebabMenu') && !e.target.closest('#logKebabBtn')) logKebabMenu.classList.remove('open');
});
document.getElementById('logEditBtn').addEventListener('click', ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  const p=logPost();
  const entry = p.log.find(x=>x.id===currentLogViewId);
  if(!entry) return;
  editingLogId = entry.id;
  document.getElementById('logWriteHeading').innerText='게시글 수정';
  document.getElementById('logWriteHint').innerText=`작성일: ${entry.date||''}`;
  fillLogEditor(entry);
  closeModal('modalLogView');
  openModal('modalLogWrite');
});
document.getElementById('logDeleteBtn').addEventListener('click', async ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  if(!confirm('이 게시글을 삭제할까요?')) return;
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

function archiveFolderCtx(){
  const countIn = (f)=> state.archive.filter(x=>
    (x.category||'ooc')==='nai' && arcFolderIdOf(x)===f.id).length;
  return {
    getList: ()=> state.archiveFolders,
    blurHint: '썸네일이 흐리게 보이고, 각 글 오른쪽 위의 👁 를 누르면 그 글만 선명해집니다.',
    canDelete: (f)=> f.id !== ARC_DEFAULT_FOLDER,
    /* 갤러리와 달리 안에 든 글은 지우지 않습니다 — 글은 이미지보다 되돌리기 어렵고,
       일괄 삭제는 선택 모드의 🗑 버튼으로 따로 할 수 있습니다. */
    deleteWarn: (f)=>{
      const n = countIn(f);
      return n>0
        ? `'${f.name}' 폴더를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 '기본' 폴더로 옮겨집니다.`
        : `'${f.name}' 폴더를 삭제합니다.`;
    },
    newFolder: (base)=> ({ ...base, id:'af'+Date.now() }),
    onCreate: (f)=>{ currentArcFolderId = f.id; arcPage = 1; },
    onDelete: async (f)=>{
      state.archive.forEach(x=>{ if(x.folderId===f.id) x.folderId = ARC_DEFAULT_FOLDER; });
      state.archiveFolders = state.archiveFolders.filter(x=>x!==f);
      if(currentArcFolderId===f.id){ currentArcFolderId = ARC_DEFAULT_FOLDER; arcPage = 1; }
      await storageSet('archive', state.archive);
    },
    save: ()=> storageSet('archiveFolders', state.archiveFolders),
    rerender: ()=> renderArchive()
  };
}

function openFolderModal(ctx, folder){
  gfTarget = { ctx, folder: folder||null };
  document.getElementById('gfModalTitle').innerText = folder ? '폴더 수정' : '폴더 추가';
  document.getElementById('gfName').value = folder ? folder.name : '';
  document.getElementById('gfSecret').checked = !!(folder && folder.secret);
  document.getElementById('gfBlur').checked   = !!(folder && folder.blur);
  document.getElementById('gfPw').value = '';
  document.getElementById('gfError').style.display='none';
  const blurHint = document.getElementById('gfBlurHint');
  if(blurHint) blurHint.innerText = ctx.blurHint;
  // OC 폴더는 '썸네일 흐리게'를 쓰지 않으므로 그 칸 자체를 숨깁니다
  const blurOpt = document.getElementById('gfBlur').closest('.gf-option');
  if(blurOpt) blurOpt.style.display = ctx.hideBlur ? 'none' : '';
  // 기존 비밀번호가 있으면 "비워두면 유지" 안내를 보여준다
  document.getElementById('gfPwKeep').style.display = (folder && folder.pwHash) ? 'block' : 'none';
  document.getElementById('gfPwRow').style.display  = document.getElementById('gfSecret').checked ? 'block' : 'none';
  // 삭제 버튼은 기존 폴더를 수정할 때만, 그리고 지울 수 있는 폴더일 때만
  const delBtn=document.getElementById('gfDeleteBtn');
  const warn=document.getElementById('gfDeleteWarn');
  if(delBtn){
    delBtn.style.display = (folder && ctx.canDelete(folder)) ? 'inline-flex' : 'none';
    delBtn.innerText='폴더 삭제';
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
    if(!name){ showErr('폴더 이름을 입력해주세요.'); nameInput.focus(); return; }
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
function openGalleryLightbox(images, idx){
  galleryLbImages = images; galleryLbIndex = idx;
  renderGalleryLightbox();
  document.getElementById('lightbox').classList.add('open');
}
function renderGalleryLightbox(){
  document.getElementById('lightboxImg').src = galleryLbImages[galleryLbIndex];
  document.getElementById('lbPrev').style.visibility = galleryLbIndex>0 ? 'visible' : 'hidden';
  document.getElementById('lbNext').style.visibility = galleryLbIndex<galleryLbImages.length-1 ? 'visible' : 'hidden';
}
function stepGalleryLightbox(dir){
  const next = galleryLbIndex + dir;
  if(next<0 || next>=galleryLbImages.length) return;
  galleryLbIndex = next;
  renderGalleryLightbox();
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
    img.style.backgroundImage=`url('${src}')`;
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
            if(stillSameFolder && sameSet){
              const reordered = pageIdx.map(i=> folder.images[i]);
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
  img.style.backgroundImage = `url('${src}')`;
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
    if(!confirm(`선택한 ${gallerySelectedIdx.size}장의 이미지를 삭제할까요?`)) return;
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

  if(addBtn) addBtn.addEventListener('click', ()=>{
    use();
    if(!isLoggedIn) return;
    const input=document.createElement('input'); input.type='file'; input.accept='image/*';
    input.addEventListener('change', async ()=>{
      const f=input.files[0]; if(!f) return;
      const url=await fileToDataUrl(f); const p=galleryPost();
      const folder = getFolder(p, currentGalleryFolderId) || p.galleryFolders[0];
      folder.images.push(url);
      await gallerySave(); renderGallery(p);
    });
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

  if(wrap && !host.horizontal){
    wrap.addEventListener('wheel', (e)=>{ step(e.deltaY>0 ? 1 : -1); }, {passive:true});
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
document.getElementById('lightbox').addEventListener('click', (e)=>{ if(e.target.id==='lightbox') document.getElementById('lightbox').classList.remove('open'); });
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
      if(!confirm('이 타임라인을 삭제할까요?')) return;
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
  p.timeline.push({ title:'새 타임라인', text:'내용을 입력하세요' });
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
const OC_PER_PAGE = 8;
let ocPage = 1;
let currentOcFolderId = OC_DEFAULT_FOLDER;
let ocSelectMode = false;
let ocSelectedIds = new Set();
let draggedOcId = null;
let currentOcId = null;

function getCurrentOc(){ return state.ocPosts.find(x=>x.id===currentOcId); }
function saveOc(){ return storageSet('ocPosts', state.ocPosts); }

function ocFolderCtx(){
  const countIn = (f)=> state.ocPosts.filter(x=> ocFolderIdOf(x)===f.id).length;
  return {
    getList: ()=> state.ocFolders,
    hideBlur: true,          // OC 는 '썸네일 흐리게'를 쓰지 않습니다
    blurHint: '',
    canDelete: (f)=> f.id !== OC_DEFAULT_FOLDER,
    deleteWarn: (f)=>{
      const n = countIn(f);
      return n>0
        ? `'${f.name}' 폴더를 삭제합니다. 안에 있는 글 ${n}개는 지워지지 않고 '기본' 폴더로 옮겨집니다.`
        : `'${f.name}' 폴더를 삭제합니다.`;
    },
    newFolder: (base)=> ({ ...base, id:'ocf'+Date.now(), blur:false }),
    onCreate: (f)=>{ currentOcFolderId = f.id; ocPage = 1; },
    onDelete: async (f)=>{
      state.ocPosts.forEach(x=>{ if(x.folderId===f.id) x.folderId = OC_DEFAULT_FOLDER; });
      state.ocFolders = state.ocFolders.filter(x=>x!==f);
      if(currentOcFolderId===f.id){ currentOcFolderId = OC_DEFAULT_FOLDER; ocPage = 1; }
      await saveOc();
    },
    save: ()=> storageSet('ocFolders', state.ocFolders),
    rerender: ()=> renderOcPosts()
  };
}

function renderOcFolderBar(){
  const bar = document.getElementById('ocFolderBar');
  if(!bar) return;
  bar.innerHTML='';
  state.ocFolders.forEach(f=>{
    const btn=document.createElement('button');
    btn.type='button'; btn.className='gallery-folder-tab'+(f.id===currentOcFolderId?' active':'');
    if(f.secret){
      const lock=document.createElement('span');
      lock.className='gf-lock'; lock.innerText='🔒'; lock.title='비밀 폴더';
      btn.appendChild(lock);
    }
    const nameSpan=document.createElement('span'); nameSpan.innerText=f.name;
    btn.appendChild(nameSpan);
    btn.addEventListener('click', (e)=>{
      if(e.target.closest('.gallery-folder-rename')) return;
      const open = ()=>{ currentOcFolderId=f.id; ocPage=1; ocSelectedIds.clear(); renderOcPosts(); };
      if(folderLocked(f)) openFolderUnlock(f, open); else open();
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename';
      renameBtn.innerText='✎'; renameBtn.title='폴더 설정';
      renameBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openFolderModal(ocFolderCtx(), f); });
      btn.appendChild(renameBtn);

      // 선택 모드에서 끌어다 놓으면 그 폴더로 옮겨집니다 (PROMPT 와 같은 방식)
      btn.addEventListener('dragover', (e)=>{
        if(draggedOcId==null) return;
        e.preventDefault(); btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', ()=> btn.classList.remove('drop-target'));
      btn.addEventListener('drop', async (e)=>{
        e.preventDefault(); btn.classList.remove('drop-target');
        if(draggedOcId==null) return;
        const ids = new Set(ocSelectedIds); ids.add(draggedOcId);
        state.ocPosts.forEach(x=>{ if(ids.has(x.id)) x.folderId = f.id; });
        draggedOcId=null; ocSelectedIds.clear();
        await saveOc();
        renderOcPosts();
      });
    }
    bar.appendChild(btn);
  });
  if(isLoggedIn){
    const addBtn=document.createElement('button');
    addBtn.type='button'; addBtn.className='gallery-folder-add'; addBtn.innerText='＋ 폴더';
    addBtn.addEventListener('click', ()=> openFolderModal(ocFolderCtx(), null));
    bar.appendChild(addBtn);
  }
}

function renderOcPosts(){
  const grid=document.getElementById('ocGrid');
  if(!grid) return;
  grid.innerHTML='';
  const pagSlot=document.getElementById('ocPagination');
  if(pagSlot) pagSlot.innerHTML='';
  const locked=document.getElementById('ocLockedPanel');
  if(locked) locked.remove();

  const selBtn=document.getElementById('ocSelectBtn');
  const delBtn=document.getElementById('ocSelectDeleteBtn');
  if(selBtn){ selBtn.innerText = ocSelectMode ? '선택 취소' : '선택'; selBtn.classList.toggle('active', ocSelectMode); }
  if(delBtn) delBtn.style.display = ocSelectMode ? 'inline-flex' : 'none';

  if(!state.ocFolders.length) state.ocFolders = normalizeOcFolders(null);
  const folder = state.ocFolders.find(f=>f.id===currentOcFolderId) || state.ocFolders[0];
  currentOcFolderId = folder.id;
  renderOcFolderBar();

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

  const list = state.ocPosts.filter(x=> ocFolderIdOf(x)===folder.id);
  if(list.length===0){ grid.innerHTML='<div class="empty-note">아직 만들어진 캐릭터가 없어요.</div>'; return; }

  const totalPages = Math.max(1, Math.ceil(list.length/OC_PER_PAGE));
  if(ocPage>totalPages) ocPage=totalPages;
  if(ocPage<1) ocPage=1;
  const start=(ocPage-1)*OC_PER_PAGE;
  const pageItems = list.slice(start, start+OC_PER_PAGE);

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
    if(src){
      const thumb = el.querySelector('.post-thumb');
      thumb.style.backgroundImage = `url('${src}')`;
      applyThumbBg(thumb, src);
    }
  });

  // 마지막 페이지가 덜 차도 격자 높이가 유지되도록
  for(let i=pageItems.length;i<OC_PER_PAGE;i++){
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

function fillOcDetail(o){
  const title=document.getElementById('ocTitleInput');
  title.value=o.title; title.readOnly=!isLoggedIn;
  title.oninput=()=>{ if(!isLoggedIn)return; o.title=title.value; saveOc(); renderOcPosts(); };

  const sub=document.getElementById('ocSubtitleInput');
  sub.value=o.subtitle; sub.readOnly=!isLoggedIn;
  // 캐치프레이즈는 목록 카드에도 나오므로 함께 다시 그립니다
  sub.oninput=()=>{ if(!isLoggedIn)return; o.subtitle=sub.value; saveOc(); renderOcPosts(); };

  bindMeta('ocProfileName','name',o.profile, saveOc);
  bindMetaContainer('ocMeta', o.profile, saveOc);
  bindBodyText('ocIntro', o.profile, saveOc);
  renderOcKeywords(o);

  const free=document.getElementById('ocFree');
  free.innerHTML = o.freeText || '';
  free.contentEditable = isLoggedIn ? 'true' : 'false';
  free.onblur=()=>{ if(!isLoggedIn)return; o.freeText=free.innerHTML; saveOc(); };

  if(ocHeaderAdj) ocHeaderAdj.paint();
  if(ocProfileAdj) ocProfileAdj.paint();
  if(ocSideAdj) ocSideAdj.paint();
  bindRichTextToolbars();

  /* 갤러리·로그 엔진을 OC 창 쪽으로 돌려놓습니다 */
  galleryHost = OC_GALLERY_HOST;
  logHost = OC_LOG_HOST;
  pdLogPage = 1;
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
  fillOcDetail(o);
  openModal('modalOcDetail');
  // 창이 열려 크기가 잡힌 뒤 한 번 더 그립니다 (숨은 상태에서는 폭이 0)
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
    if(Math.abs(e.deltaY) < 4) return;
    if(consumedByInnerScroll(e.target, e.deltaY>0)) return;
    const now = Date.now();
    if(now < wheelLock) return;
    wheelLock = now + 600;      // 한 번 굴릴 때 한 장만 넘어가게
    setOcPage(ocPageIdx + (e.deltaY>0 ? 1 : -1));
  }, {passive:true});

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
    if(consumedByInnerScroll(startTarget, dy<0)) return;
    setOcPage(ocPageIdx + (dy<0 ? 1 : -1));
  }, {passive:true});
}

/* ---- OC 목록 버튼 ---- */
bindOnce(document.getElementById('ocWriteBtn'), async ()=>{
  if(!isLoggedIn) return;
  const post = migrateOcPost({ id:Date.now(), folderId:currentOcFolderId });
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
const ocSelectDeleteBtnEl = document.getElementById('ocSelectDeleteBtn');
if(ocSelectDeleteBtnEl) ocSelectDeleteBtnEl.addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  if(ocSelectedIds.size===0){ alert('삭제할 글을 먼저 선택해주세요.'); return; }
  if(!confirm(`선택한 ${ocSelectedIds.size}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
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

function openArcWriteModal(existingItem){
  editingArcId = existingItem ? existingItem.id : null;
  document.getElementById('arcWriteHeading').innerText = existingItem ? '게시글 수정' : '글쓰기';
  document.getElementById('arcCategoryInput').value = existingItem ? (existingItem.category||'ooc') : currentArchiveCategory;
  document.getElementById('arcTitleInput').value = existingItem ? existingItem.title : '';
  const editorEl = document.getElementById('arcContentEditor');
  editorEl.innerHTML = existingItem ? existingItem.content : '';
  // 예전에 넣은 코드 상자에도 복사 버튼이 생기도록
  ensureCodeEmbedCopy(editorEl);
  arcAttachments = existingItem && existingItem.files ? existingItem.files.slice() : [];
  renderArcAttachList();
  openModal('modalArcWrite');
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
      document.execCommand('formatBlock', false, 'blockquote');
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

/* 이미지 삽입 + 삽입 후 삭제/이동 툴바 */
document.getElementById('arcInsertImageBtn').addEventListener('click', ()=>{
  const input=document.createElement('input'); input.type='file'; input.accept='image/*';
  input.addEventListener('change', async ()=>{
    const f=input.files[0]; if(!f) return;
    const url=await fileToDataUrl(f);
    const editor=document.getElementById('arcContentEditor'); editor.focus();
    document.execCommand('insertHTML', false, `<img src="${url}" /><br>`);
  });
  input.click();
});
function removeImgToolbar(){ const t=document.querySelector('.img-toolbar'); if(t) t.remove(); }
function showImgToolbar(img){
  removeImgToolbar();
  const rect = img.getBoundingClientRect();
  const toolbar=document.createElement('div');
  toolbar.className='img-toolbar';
  toolbar.innerHTML = `<button type="button" data-act="up" title="위로">↑</button><button type="button" data-act="down" title="아래로">↓</button><button type="button" data-act="del" title="삭제">✕</button>`;
  document.body.appendChild(toolbar);
  toolbar.style.left = rect.left+'px';
  toolbar.style.top = Math.max(0, rect.top-28)+'px';
  toolbar.addEventListener('mousedown', e=> e.preventDefault());
  toolbar.querySelector('[data-act="del"]').addEventListener('click', (e)=>{ e.stopPropagation(); img.remove(); removeImgToolbar(); });
  toolbar.querySelector('[data-act="up"]').addEventListener('click', (e)=>{
    e.stopPropagation();
    const prev=img.previousElementSibling;
    if(prev) img.parentNode.insertBefore(img, prev);
    removeImgToolbar();
  });
  toolbar.querySelector('[data-act="down"]').addEventListener('click', (e)=>{
    e.stopPropagation();
    const next=img.nextElementSibling;
    if(next) img.parentNode.insertBefore(next, img);
    removeImgToolbar();
  });
}
const arcEditorEl = document.getElementById('arcContentEditor');
arcEditorEl.addEventListener('mouseover', (e)=>{
  const img = e.target.closest('img');
  if(img) showImgToolbar(img);
});
arcEditorEl.addEventListener('mouseout', (e)=>{
  const img = e.target.closest('img');
  if(img && (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.img-toolbar'))) removeImgToolbar();
});
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
  const imgs = Array.from(containerEl.querySelectorAll('img'));
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
    el.innerHTML = `<a href="${f.src}" download="${escapeHtml(f.name)}">📎 ${escapeHtml(f.name)}</a><button type="button" class="arc-attach-del" data-idx="${idx}">삭제</button>`;
    el.querySelector('.arc-attach-del').addEventListener('click', ()=>{ arcAttachments.splice(idx,1); renderArcAttachList(); });
    wrap.appendChild(el);
  });
}

/* 코드 삽입: 기본으로 실제 HTML/CSS 시뮬레이션(라이브 렌더링)을 보여주고, 다운로드 시점에 그 상태를 이미지로 캡처 */
document.getElementById('arcInsertCodeBtn').addEventListener('click', ()=>{
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
  /* PROMPT 글은 폴더에 들어갑니다 — 지금 보고 있는 폴더에 넣고,
     다른 카테고리를 보다가 PROMPT 로 바꿔 쓴 경우엔 기본 폴더에 넣습니다. */
  const folderId = (currentArchiveCategory==='nai') ? currentArcFolderId : ARC_DEFAULT_FOLDER;
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
  if(!confirm('이 게시글을 삭제할까요?')) return;
  state.archive = state.archive.filter(x=>x.id!==currentArcViewId);
  await storageSet('archive', state.archive);
  closeModal('modalArcView');
  renderArchive();
});

let arcPage=1;
let currentArcViewId=null;
/* PROMPT 전용 상태 */
let currentArcFolderId = ARC_DEFAULT_FOLDER;
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
  viewEl.innerHTML=item.content;
  decorateContent(viewEl);
  updateArcPinBtn(item);
  const attachSection = document.getElementById('arcViewAttachSection');
  const attachList = document.getElementById('arcViewAttachList');
  if(item.files && item.files.length>0){
    attachSection.style.display='block';
    attachList.innerHTML='';
    item.files.forEach(f=>{
      const el=document.createElement('div'); el.className='arc-attach-item';
      el.innerHTML = `<a href="${f.src}" download="${escapeHtml(f.name)}">📎 ${escapeHtml(f.name)}</a>`;
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

/* PROMPT 폴더 탭 — 갤러리 폴더바와 같은 모양(같은 CSS 클래스)입니다.
   선택 모드에서 글을 끌어다 놓으면 그 폴더로 옮겨집니다. */
function renderArcFolderBar(){
  const bar = document.getElementById('arcFolderBar');
  if(!bar) return;
  bar.innerHTML='';
  state.archiveFolders.forEach(f=>{
    const btn=document.createElement('button');
    btn.type='button'; btn.className='gallery-folder-tab'+(f.id===currentArcFolderId?' active':'');
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
        currentArcFolderId=f.id; arcPage=1;
        arcUnblurred.clear(); arcSelectedIds.clear();
        renderArchive();
      };
      if(folderLocked(f)) openFolderUnlock(f, open);
      else open();
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename';
      renameBtn.innerText='✎'; renameBtn.title='폴더 설정';
      renameBtn.addEventListener('click', (e)=>{ e.stopPropagation(); openFolderModal(archiveFolderCtx(), f); });
      btn.appendChild(renameBtn);

      btn.addEventListener('dragover', (e)=>{
        if(draggedArcId==null) return;
        e.preventDefault();
        btn.classList.add('drop-target');
      });
      btn.addEventListener('dragleave', ()=> btn.classList.remove('drop-target'));
      btn.addEventListener('drop', async (e)=>{
        e.preventDefault();
        btn.classList.remove('drop-target');
        if(draggedArcId==null) return;
        // 선택해 둔 글이 있으면 함께, 없으면 끌던 글 하나만 옮깁니다
        const ids = new Set(arcSelectedIds);
        ids.add(draggedArcId);
        state.archive.forEach(x=>{ if(ids.has(x.id)) x.folderId = f.id; });
        draggedArcId=null;
        arcSelectedIds.clear();
        arcUnblurred.clear();
        await storageSet('archive', state.archive);
        renderArchive();
      });
    }
    bar.appendChild(btn);
  });
  if(isLoggedIn){
    const addBtn=document.createElement('button');
    addBtn.type='button'; addBtn.className='gallery-folder-add';
    addBtn.innerText='＋ 폴더';
    addBtn.addEventListener('click', ()=> openFolderModal(archiveFolderCtx(), null));
    bar.appendChild(addBtn);
  }
}

function renderArchive(){
  const wrap=document.getElementById('archiveBody');
  // PAIR 처럼 상단에 현재 카테고리를 함께 표기
  const titleEl=document.getElementById('archiveTitle');
  if(titleEl) titleEl.innerText = 'Archive · ' + (ARCHIVE_CAT_LABEL[currentArchiveCategory] || currentArchiveCategory);
  const isGallery = currentArchiveCategory==='nai';

  /* 선택 / 일괄 삭제는 PROMPT 에서만 씁니다 */
  if(!isGallery && arcSelectMode){ arcSelectMode=false; arcSelectedIds.clear(); }
  const selBtn=document.getElementById('arcSelectBtn');
  const selDelBtn=document.getElementById('arcSelectDeleteBtn');
  if(selBtn){
    selBtn.style.display = isGallery ? 'inline-flex' : 'none';
    selBtn.innerText = arcSelectMode ? '선택 취소' : '선택';
    selBtn.classList.toggle('active', arcSelectMode);
  }
  if(selDelBtn) selDelBtn.style.display = (isGallery && arcSelectMode) ? 'inline-flex' : 'none';

  // PROMPT 는 4열 x 2행(모바일은 2열 x 4행)으로 8개 고정,
  // OOC/ETC 는 데스크톱 15줄 / 모바일 10줄
  const perPage = isGallery ? 8 : (isMobileWidth() ? 10 : 15);

  /* PROMPT 는 폴더로 한 번 더 걸러서 보여줍니다 */
  let folder = null;
  const folderBarHtml = isGallery ? '<div class="gallery-folder-bar arc-folder-bar" id="arcFolderBar"></div>' : '';
  let catItems = state.archive.filter(x=>(x.category||'ooc')===currentArchiveCategory);
  if(isGallery){
    // 폴더 목록이 어떤 이유로든 비어 있으면 기본 폴더를 만들어 둡니다
    if(!state.archiveFolders.length) state.archiveFolders = normalizeArcFolders(null);
    folder = state.archiveFolders.find(f=>f.id===currentArcFolderId) || state.archiveFolders[0];
    currentArcFolderId = folder.id;
    catItems = catItems.filter(x=> arcFolderIdOf(x)===folder.id);

    /* 잠긴 비밀 폴더는 썸네일을 아예 그리지 않습니다 */
    if(folderLocked(folder)){
      wrap.innerHTML = folderBarHtml
        + `<div class="arc-nai-grid">${'<div class="arc-nai-slot"></div>'.repeat(8)}</div>`
        + '<div class="gallery-locked"><div class="gl-icon">🔒</div>'
        + '<div class="gl-text">비밀 폴더입니다.</div>'
        + '<button type="button" class="btn-ghost" id="arcUnlockBtn">비밀번호 입력</button></div>'
        + '<div class="log-pagination-slot"></div>';
      renderArcFolderBar();
      const ub = document.getElementById('arcUnlockBtn');
      if(ub) ub.addEventListener('click', ()=> openFolderUnlock(folder, ()=> renderArchive()));
      return;
    }
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
        <div class="an-img"${thumb?` style="background-image:url('${thumb}')"`:''}></div>
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
      if(src) applyThumbBg(el.querySelector('.an-img'), src);
    });
  }else{
    let rows='';
    pageItems.forEach((item,i)=>{
      rows += `<tr data-abs="${start+i}"><td>${displayNo.get(item)||''}</td><td class="log-td-title">${item.pinned?'<span class="arc-pin-tag">📌</span> ':''}${escapeHtml(item.title)}</td><td>${item.date||''}</td></tr>`;
    });
    wrap.innerHTML = `<div class="archive-table-scroll"><table class="log-table"><thead><tr><th>No</th><th>Title</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>`
      + `<div class="log-pagination-slot">${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}</div>`;
    wrap.querySelectorAll('tr[data-abs]').forEach(tr=>{
      tr.addEventListener('click', ()=> openArcView(items[Number(tr.dataset.abs)]));
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

/* ---- PROMPT 선택 모드 ---- */
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
  if(!confirm(`선택한 ${arcSelectedIds.size}개 글을 삭제할까요? 되돌릴 수 없습니다.`)) return;
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
  document.querySelectorAll('.nav-sub-item').forEach(b=>{
    b.addEventListener('click', ()=> setOpen(false));
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

  try{
    await window.SiteStore.load();
  }catch(e){
    console.error('데이터를 불러오지 못했습니다.', e);
    showLoadError();
    return;
  }
  await loadState();
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
