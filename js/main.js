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
  renderArchive();
  if(currentPairPostId){
    const p = getCurrentPost();
    if(p) fillPairDetail(p);
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
  cards:[], pairPosts:[], archive:[], archiveSeqCounter:0
};

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
  renderArchive();
  applyEditMode();
}

/* ============================================================
   REUSABLE ADJUSTABLE IMAGE COMPONENT
   ============================================================ */
function createAdjustable(container, getObj, setObj, opts={}){
  const layer = container.querySelector('.adj-layer');
  const emptyBtn = container.querySelector('.adj-empty');
  const changeBtn = container.querySelector('.adj-change');
  let dragging=false, startX,startY,startPX,startPY, panelEl=null;

  function paint(){
    const o = getObj() || blankImg();
    if(o.src){
      layer.style.backgroundImage = `url(${o.src})`;
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
    if(btn.dataset.view==='archive'){
      currentArchiveCategory='ooc';
      document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.toggle('active', b.dataset.archivesub==='ooc'));
      arcPage=1;
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
    renderPairPosts();
    navItems.forEach(b=>b.classList.remove('active'));
    document.querySelector('.nav-item[data-view="pair"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-pair').classList.add('active');
    pairSub.classList.add('open');
  });
});
document.querySelectorAll('#archiveSub .nav-sub-item').forEach(btn=>{
  btn.addEventListener('click', (e)=>{
    e.stopPropagation();
    document.querySelectorAll('#archiveSub .nav-sub-item').forEach(b=>b.classList.remove('active')); btn.classList.add('active');
    currentArchiveCategory = btn.dataset.archivesub;
    arcPage=1;
    navItems.forEach(b=>b.classList.remove('active'));
    document.querySelector('.nav-item[data-view="archive"]').classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-archive').classList.add('active');
    archiveSub.classList.add('open');
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
document.getElementById('addCardBtn').addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  state.cards.push({ id:Date.now(), name:'이름', catch:'캐치프레이즈', genre:'장르', desc:'짧은 소개글을 입력하세요.', image:blankImg() });
  await storageSet('cards', state.cards);
  renderCards();
});

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
let currentArchiveCategory='ooc';
let selectMode=false;
let selectedPairIds=new Set();

document.getElementById('writePairBtn').addEventListener('click', async ()=>{
  if(!isLoggedIn) return;
  const post = migratePost({ id:Date.now(), type: currentPairFilter==='dream'?'dream':'aichat', title:'새 페어' });
  state.pairPosts.push(post);
  await storageSet('pairPosts', state.pairPosts);
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

function renderPairPosts(){
  const grid=document.getElementById('postGrid'); grid.innerHTML='';
  const list = state.pairPosts.filter(p=> currentPairFilter==='all' || p.type===currentPairFilter);
  if(list.length===0){ grid.innerHTML='<div class="empty-note">아직 작성된 글이 없어요.</div>'; return; }
  list.forEach(p=>{
    const el=document.createElement('div'); el.className='post-card'+(selectMode?' selectable':'');
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
  });
}

let currentPairPostId=null;
function getCurrentPost(){ return state.pairPosts.find(x=>x.id===currentPairPostId); }

function openPairDetail(id){
  currentPairPostId=id;
  const p=getCurrentPost();
  fillPairDetail(p);
  openModal('modalPairDetail');
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
  pdLogPage = 1;
  currentGalleryFolderId = p.galleryFolders[0].id;
  galleryPage = 1;
  gallerySelectMode = false;
  gallerySelectedIdx.clear();
  document.getElementById('gallerySelectInfo').style.display='none';
  document.getElementById('gallerySelectDeleteBtn').style.display='none';
  document.getElementById('gallerySelectBtn').innerText='✓';
  document.getElementById('gallerySelectBtn').classList.remove('active');
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

function bindMeta(elId, field, obj){
  const el=document.getElementById(elId); el.value=obj[field]||''; el.readOnly=!isLoggedIn;
  el.oninput=()=>{ if(!isLoggedIn)return; obj[field]=el.value; storageSet('pairPosts',state.pairPosts); };
}
let draggedMetaRow = null;
function bindMetaContainer(elId, obj){
  // 라벨(::라벨 값) 전용 컨테이너. 본문과 완전히 독립된 레이어로 동작.
  const el=document.getElementById(elId);
  el.innerHTML = obj.metaHtml || '';
  el.querySelectorAll('.meta-label,.meta-value').forEach(span=>{ span.contentEditable = isLoggedIn ? 'true' : 'false'; });
  const save = ()=>{ obj.metaHtml=el.innerHTML; storageSet('pairPosts',state.pairPosts); };
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
function bindBodyText(elId, obj){
  // 본문 전용 영역. 라벨과 완전히 분리되어 일반적인 줄바꿈 동작만 수행.
  const el=document.getElementById(elId);
  el.innerHTML = obj.intro || '';
  el.contentEditable = isLoggedIn ? 'true' : 'false';
  const save = ()=>{ obj.intro=el.innerHTML; storageSet('pairPosts',state.pairPosts); };
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
    if(tb.classList.contains('rt-toolbar-arc')) return; // 아카이브 에디터 툴바는 별도 로직으로 바인딩됨
    const targetEl = document.getElementById(tb.dataset.target); // 본문 영역 (B/I/색상 적용 대상)
    const metaEl = document.getElementById(tb.dataset.metaTarget); // 라벨 컨테이너 (+ 버튼 대상)
    tb.querySelectorAll('button[data-cmd]').forEach(btn=>{
      btn.onmousedown = (e)=> e.preventDefault();
      btn.onclick = ()=>{ targetEl.focus(); document.execCommand(btn.dataset.cmd, false, null); };
    });
    const colorInput = tb.querySelector('.rt-color');
    colorInput.oninput = (e)=>{ targetEl.focus(); document.execCommand('foreColor', false, e.target.value); };
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

/* --- Log (작성 시각 자동, 15개씩 페이지네이션, 행 크기/폰트는 완전 고정) --- */
let pdLogPage = 1;
function renderLogList(p){
  const wrap=document.getElementById('logList');
  const perPage=15;
  const items = p.log.slice().reverse();
  if(items.length===0){ wrap.innerHTML='<div class="empty-note">등록된 게시글이 없어요.</div>'; return; }
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
let editingLogId = null;
let currentLogViewId = null;
document.getElementById('addLogBtn').addEventListener('click', ()=>{
  if(!isLoggedIn) return;
  editingLogId = null;
  document.getElementById('logWriteHeading').innerText='게시글 작성';
  document.getElementById('logWriteHint').innerText='작성 시각이 자동으로 기록됩니다.';
  document.getElementById('logTitle').value=''; document.getElementById('logContent').value='';
  openModal('modalLogWrite');
});
document.getElementById('saveLogBtn').addEventListener('click', async ()=>{
  const title=document.getElementById('logTitle').value.trim();
  if(!title){ alert('제목을 입력해주세요.'); return; }
  const p=getCurrentPost();
  if(editingLogId){
    const entry = p.log.find(x=>x.id===editingLogId);
    if(entry){ entry.title=title; entry.content=document.getElementById('logContent').value; }
  }else{
    p.log.push({ id:Date.now(), title, date:nowStamp(), content:document.getElementById('logContent').value });
  }
  await storageSet('pairPosts', state.pairPosts);
  pdLogPage=1;
  renderLogList(p); closeModal('modalLogWrite');
});
function openLogView(entry){
  currentLogViewId = entry.id;
  document.getElementById('logViewTitle').innerText=entry.title;
  document.getElementById('logViewDate').innerText=entry.date||'';
  document.getElementById('logViewContent').innerText=entry.content;
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
  const p=getCurrentPost();
  const entry = p.log.find(x=>x.id===currentLogViewId);
  if(!entry) return;
  editingLogId = entry.id;
  document.getElementById('logWriteHeading').innerText='게시글 수정';
  document.getElementById('logWriteHint').innerText=`작성일: ${entry.date||''}`;
  document.getElementById('logTitle').value = entry.title;
  document.getElementById('logContent').value = entry.content;
  closeModal('modalLogView');
  openModal('modalLogWrite');
});
document.getElementById('logDeleteBtn').addEventListener('click', async ()=>{
  logKebabMenu.classList.remove('open');
  if(!isLoggedIn || currentLogViewId==null) return;
  if(!confirm('이 게시글을 삭제할까요?')) return;
  const p=getCurrentPost();
  p.log = p.log.filter(x=>x.id!==currentLogViewId);
  await storageSet('pairPosts', state.pairPosts);
  renderLogList(p);
  closeModal('modalLogView');
});

/* --- Gallery (폴더 분류 + 다중 선택 + 이동) --- */
let currentGalleryFolderId = null;
let gallerySelectMode = false;
let gallerySelectedIdx = new Set(); // "folderId::imgIdx"

function getFolder(p, folderId){ return p.galleryFolders.find(f=>f.id===folderId); }

function renderGalleryFolderBar(p){
  const bar=document.getElementById('galleryFolderBar');
  bar.innerHTML='';
  p.galleryFolders.forEach(f=>{
    const btn=document.createElement('button');
    btn.type='button'; btn.className='gallery-folder-tab'+(f.id===currentGalleryFolderId?' active':'');
    const nameSpan=document.createElement('span');
    nameSpan.innerText=f.name;
    btn.appendChild(nameSpan);
    btn.addEventListener('click', (e)=>{
      if(e.target.closest('.gallery-folder-rename')) return;
      currentGalleryFolderId=f.id; gallerySelectedIdx.clear(); galleryPage=1; renderGallery(p);
    });
    if(isLoggedIn){
      const renameBtn=document.createElement('button');
      renameBtn.type='button'; renameBtn.className='gallery-folder-rename'; renameBtn.innerText='✎'; renameBtn.title='폴더 이름 수정';
      renameBtn.addEventListener('click', async (e)=>{
        e.stopPropagation();
        const name=prompt('폴더 이름 수정', f.name);
        if(name && name.trim()){ f.name=name.trim(); await storageSet('pairPosts', state.pairPosts); renderGallery(p); }
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
        await storageSet('pairPosts', state.pairPosts);
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
    addBtn.addEventListener('click', async ()=>{
      const name=prompt('새 폴더 이름');
      if(name && name.trim()){
        p.galleryFolders.push({ id:'f'+Date.now(), name:name.trim(), images:[] });
        await storageSet('pairPosts', state.pairPosts);
        currentGalleryFolderId = p.galleryFolders[p.galleryFolders.length-1].id;
        renderGallery(p);
      }
    });
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
function animateGalleryPageChange(direction, applyChange){
  if(galleryTransitioning) return;
  galleryTransitioning = true;
  const grid = document.getElementById('galleryGrid');
  grid.style.transition = 'transform .18s ease, opacity .18s ease';
  grid.style.transform = `translateX(${direction*-26}px)`;
  grid.style.opacity = '0';
  setTimeout(()=>{
    applyChange();
    grid.style.transition = 'none';
    grid.style.transform = `translateX(${direction*26}px)`;
    grid.style.opacity = '0';
    void grid.offsetWidth; // 강제 리플로우로 트랜지션 재적용
    grid.style.transition = 'transform .26s cubic-bezier(.22,.61,.36,1), opacity .26s ease';
    grid.style.transform = 'translateX(0)';
    grid.style.opacity = '1';
    setTimeout(()=>{ galleryTransitioning = false; }, 270);
  }, 170);
}
const galleryGridWrapEl = document.getElementById('galleryGridWrap');
galleryGridWrapEl.addEventListener('wheel', (e)=>{
  if(galleryTransitioning) return;
  const p = getCurrentPost(); if(!p) return;
  const folder = getFolder(p, currentGalleryFolderId); if(!folder) return;
  const totalPages = Math.max(1, Math.ceil(folder.images.length/20));
  if(totalPages<=1) return;
  if(e.deltaY>0 && galleryPage<totalPages){
    animateGalleryPageChange(1, ()=>{ galleryPage++; renderGallery(p); });
  }else if(e.deltaY<0 && galleryPage>1){
    animateGalleryPageChange(-1, ()=>{ galleryPage--; renderGallery(p); });
  }
}, {passive:true});

function renderGallery(p){
  if(!currentGalleryFolderId) currentGalleryFolderId = p.galleryFolders[0].id;
  renderGalleryFolderBar(p);

  const grid=document.getElementById('galleryGrid'); grid.innerHTML='';
  const hint = document.getElementById('galleryScrollHint');
  const folder = getFolder(p, currentGalleryFolderId);
  if(!folder || folder.images.length===0){ grid.innerHTML='<div class="empty-note">등록된 이미지가 없어요.</div>'; hint.style.display='none'; return; }

  const perPage=20;
  const totalPages=Math.max(1, Math.ceil(folder.images.length/perPage));
  if(galleryPage>totalPages) galleryPage=totalPages;
  if(galleryPage<1) galleryPage=1;
  const start=(galleryPage-1)*perPage;
  const pageImages = folder.images.slice(start, start+perPage);

  pageImages.forEach((src, i)=>{
    const idx = start+i;
    const key = folder.id+'::'+idx;
    const el=document.createElement('div'); el.className='gallery-thumb'; el.style.backgroundImage=`url('${src}')`;
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
        el.addEventListener('dragstart', ()=>{ draggedGalleryKey = key; draggedGalleryEl = el; el.classList.add('dragging'); });
        el.addEventListener('dragend', async ()=>{
          el.classList.remove('dragging');
          if(draggedGalleryEl){
            // 같은 폴더 내에서 순서가 바뀌었으면 반영
            const domKeys = Array.from(grid.querySelectorAll('.gallery-thumb')).map(x=>x.dataset.key);
            const stillSameFolder = domKeys.every(k=> k.split('::')[0]===folder.id);
            if(stillSameFolder){
              const newImages = domKeys.map(k=> folder.images[Number(k.split('::')[1])]);
              folder.images = newImages;
              await storageSet('pairPosts', state.pairPosts);
            }
          }
          draggedGalleryKey=null; draggedGalleryEl=null;
          renderGallery(p);
        });
      }
    }else{
      el.addEventListener('click', ()=> openGalleryLightbox(folder.images.slice(), idx));
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

  if(totalPages>1 && galleryPage<totalPages){
    hint.style.display='block';
  }else{
    hint.style.display='none';
  }
}
function updateGallerySelectCount(){
  const info=document.getElementById('gallerySelectInfo');
  if(gallerySelectedIdx.size>0){ info.style.display='block'; info.innerText=`${gallerySelectedIdx.size}개 선택됨`; }
  else{ info.style.display='none'; }
}
document.getElementById('gallerySelectBtn').addEventListener('click', ()=>{
  gallerySelectMode = !gallerySelectMode;
  gallerySelectedIdx.clear();
  const btn = document.getElementById('gallerySelectBtn');
  btn.innerText = gallerySelectMode ? '✕' : '✓';
  btn.classList.toggle('active', gallerySelectMode);
  updateGallerySelectCount();
  document.getElementById('gallerySelectDeleteBtn').style.display = (gallerySelectMode && isLoggedIn) ? 'flex' : 'none';
  renderGallery(getCurrentPost());
});
document.getElementById('gallerySelectDeleteBtn').addEventListener('click', async ()=>{
  if(gallerySelectedIdx.size===0) return;
  if(!confirm(`선택한 ${gallerySelectedIdx.size}장의 이미지를 삭제할까요?`)) return;
  const p = getCurrentPost();
  const bySrc = [];
  gallerySelectedIdx.forEach(key=>{
    const [folderId, idxStr] = key.split('::');
    const folder = getFolder(p, folderId);
    if(folder) bySrc.push({ folder, idx:Number(idxStr) });
  });
  bySrc.sort((a,b)=> b.idx-a.idx);
  bySrc.forEach(({folder, idx})=>{ folder.images.splice(idx,1); });
  await storageSet('pairPosts', state.pairPosts);
  gallerySelectedIdx.clear();
  updateGallerySelectCount();
  renderGallery(p);
});
document.getElementById('addGalleryBtn').addEventListener('click', ()=>{
  if(!isLoggedIn) return;
  const input=document.createElement('input'); input.type='file'; input.accept='image/*';
  input.addEventListener('change', async ()=>{
    const f=input.files[0]; if(!f) return;
    const url=await fileToDataUrl(f); const p=getCurrentPost();
    const folder = getFolder(p, currentGalleryFolderId) || p.galleryFolders[0];
    folder.images.push(url);
    await storageSet('pairPosts', state.pairPosts); renderGallery(p);
  });
  input.click();
});
document.getElementById('lightbox').addEventListener('click', (e)=>{ if(e.target.id==='lightbox') document.getElementById('lightbox').classList.remove('open'); });
document.getElementById('lbPrev').addEventListener('click', (e)=>{ e.stopPropagation(); stepGalleryLightbox(-1); });
document.getElementById('lbNext').addEventListener('click', (e)=>{ e.stopPropagation(); stepGalleryLightbox(1); });

/* --- Timeline (원형 마커 + 연결선 + 볼드 타이틀 구조) --- */
function renderTimeline(p){
  const wrap=document.getElementById('timelineList'); wrap.innerHTML='';
  if(p.timeline.length===0){ wrap.innerHTML='<div class="empty-note">등록된 타임라인이 없어요.</div>'; return; }
  p.timeline.forEach((t, i)=>{
    const el=document.createElement('div'); el.className='tl-item';
    el.innerHTML = `
      <div class="tl-marker"><div class="tl-dot"></div><div class="tl-line"></div></div>
      <div class="tl-body">
        <div class="tl-title">${escapeHtml(t.title||'(제목 없음)')}</div>
        <div class="tl-content">${escapeHtml(t.text)}</div>
      </div>`;
    if(i===p.timeline.length-1) el.classList.add('last');
    wrap.appendChild(el);
  });
}
document.getElementById('addTimelineBtn').addEventListener('click', ()=>{
  if(!isLoggedIn) return;
  document.getElementById('tlTitle').value='';
  document.getElementById('tlText').value='';
  openModal('modalTimelineWrite');
});
document.getElementById('saveTlBtn').addEventListener('click', async ()=>{
  const p=getCurrentPost();
  p.timeline.push({
    title: document.getElementById('tlTitle').value.trim(),
    text: document.getElementById('tlText').value
  });
  await storageSet('pairPosts', state.pairPosts);
  renderTimeline(p); closeModal('modalTimelineWrite');
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
  document.getElementById('arcContentEditor').innerHTML = existingItem ? existingItem.content : '';
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

document.getElementById('saveArcBtn').addEventListener('click', async ()=>{
  const title=document.getElementById('arcTitleInput').value.trim();
  const category=document.getElementById('arcCategoryInput').value;
  const content=document.getElementById('arcContentEditor').innerHTML.trim();
  if(!title){ alert('제목을 입력해주세요.'); return; }
  if(editingArcId){
    const item = state.archive.find(x=>x.id===editingArcId);
    if(item){ item.title=title; item.category=category; item.content=content; item.files=arcAttachments.slice(); }
  }else{
    state.archiveSeqCounter = (state.archiveSeqCounter||0) + 1;
    state.archive.push({ id:Date.now(), seq:state.archiveSeqCounter, category, title, content, date:nowStamp(), files:arcAttachments.slice(), pinned:false });
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
  btn.innerText = item.pinned ? '📌 고정 해제' : '📌 고정';
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
function openArcView(item){
  currentArcViewId = item.id;
  document.getElementById('arcViewTitle').innerText=item.title;
  document.getElementById('arcViewDate').innerText=item.date||'';
  document.getElementById('arcViewContent').innerHTML=item.content;
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
function renderArchive(){
  const wrap=document.getElementById('archiveBody');
  const isGallery = currentArchiveCategory==='nai';
  const perPage = isGallery ? 18 : 15;
  const catItems = state.archive.filter(x=>(x.category||'ooc')===currentArchiveCategory);
  if(catItems.length===0){ wrap.innerHTML='<div class="empty-note">아직 백업된 항목이 없어요.</div>'; return; }
  const pinned = catItems.filter(x=>x.pinned).slice(0,3).sort((a,b)=>(a.seq||0)-(b.seq||0));
  const rest = catItems.filter(x=>!x.pinned).slice().sort((a,b)=>(b.seq||0)-(a.seq||0));
  const items = [...pinned, ...rest];

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
    let cells='';
    pageItems.forEach((item,i)=>{
      const thumb = extractFirstImage(item.content);
      cells += `<div class="arc-nai-thumb" data-abs="${start+i}" style="${thumb?`background-image:url('${thumb}')`:'background:var(--surface);'}">
        ${item.pinned?'<span class="arc-nai-pin">📌</span>':''}
        <div class="arc-nai-overlay ${thumb?'':'arc-nai-overlay-static'}"><div class="arc-nai-title">${escapeHtml(item.title)}</div></div>
      </div>`;
    });
    wrap.innerHTML = `<div class="arc-nai-grid">${cells}</div>${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}`;
    wrap.querySelectorAll('.arc-nai-thumb[data-abs]').forEach(el=>{
      el.addEventListener('click', ()=> openArcView(items[Number(el.dataset.abs)]));
    });
  }else{
    let rows='';
    pageItems.forEach((item,i)=>{
      rows += `<tr data-abs="${start+i}"><td>${item.seq!=null?item.seq:''}</td><td class="log-td-title">${item.pinned?'<span class="arc-pin-tag">📌</span> ':''}${escapeHtml(item.title)}</td><td>${item.date||''}</td></tr>`;
    });
    wrap.innerHTML = `<table class="log-table"><thead><tr><th>No</th><th>Title</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>
      ${totalPages>1?`<div class="log-pagination">${pag}</div>`:''}`;
    wrap.querySelectorAll('tr[data-abs]').forEach(tr=>{
      tr.addEventListener('click', ()=> openArcView(items[Number(tr.dataset.abs)]));
    });
  }
  wrap.querySelectorAll('.log-pg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.pg==='prev') arcPage=Math.max(1,arcPage-1);
      else if(btn.dataset.pg==='next') arcPage=Math.min(totalPages,arcPage+1);
      else arcPage=Number(btn.dataset.pg);
      renderArchive();
    });
  });
}

/* ============================================================
   INIT
   ------------------------------------------------------------
   Firestore에서 데이터를 받아온 뒤 화면을 그립니다.
   로그인 상태가 바뀌면 편집 모드도 따라서 갱신됩니다.
   ============================================================ */
async function boot(){
  initPairImageAdjusters();
  initSaveIndicator();

  window.SiteStore.onAuthChange((admin)=>{
    isLoggedIn = admin;
    applyEditMode();
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
