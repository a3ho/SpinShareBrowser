function countValue(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
function compactDLC(value){
  if(!value)return null;
  if(typeof value!=='object'||Array.isArray(value))return {};
  return {id:Number.isSafeInteger(value.id)&&value.id>0?value.id:null,identifier:typeof value.identifier==='string'?value.identifier:'',title:typeof value['title']==='string'?value['title']:'',storeLink:typeof value.storeLink==='string'?value.storeLink:''};
}
function coverURL(value){
  try{const url=new URL(String(value));if(url.username||url.password||url.search||url.hash)return '';
    if(['https://spinsha.re','https://spinshare.b-cdn.net'].includes(url.origin)&&/^\/uploads\/(cover|thumbnail)\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|avif)$/i.test(url.pathname))return 'https://spinshare.b-cdn.net'+url.pathname;
    if(url.origin==='https://spinshare.b-cdn.net'&&url.pathname==='/assets/img/defaultAlbumArt.jpg')return url.href;
  }catch{}return '';
}
const defaultAvatarURL='https://spinshare.b-cdn.net/assets/img/defaultAvatar.jpg';
function avatarURL(value){
  try{const url=new URL(String(value));if(url.username||url.password||url.search||url.hash)return '';
    if(url.origin==='https://spinsha.re'&&/^\/uploads\/avatar\/[a-zA-Z0-9_-]{1,128}\.(png|jpg|jpeg|webp|gif)$/i.test(url.pathname))return url.href;
    if(url.href===defaultAvatarURL)return url.href;
  }catch{}return '';
}
function publicUser(value){
  const user=value&&typeof value==='object'?value:{},id=user.id;
  const legacy=typeof user.coverReference==='string'&&/^[a-zA-Z0-9_-]{1,128}\.(png|jpg|jpeg|webp|gif)$/i.test(user.coverReference)?'https://spinsha.re/uploads/avatar/'+user.coverReference:'';
  return {id:Number.isSafeInteger(id)&&id>0?id:null,name:String(user.username||m("Unnamed user")),avatar:avatarURL(user.avatar)||legacy,verified:user.isVerified===true,patron:user.isPatreon===true,pronouns:String(user.pronouns||'')};
}
function makeAvatar(url,name){
  const box=element('span',undefined,'avatar-box');box.setAttribute('role','img');uiAttr(box,"aria-label",name+m("'s avatar"));
  const initial=String(name).includes(UI_PREFIX)?'':([...String(name).trim()][0]||'').toLocaleUpperCase();
  const placeholder=initial?element('span',initial,'avatar-initial'):icon('user');box.append(placeholder);
  url=avatarURL(url);if(!url||url===defaultAvatarURL)return box;
  const img=element('img',undefined,'avatar');uiAttr(img,"alt",'');img.width=28;img.height=28;img.loading='lazy';img.decoding='async';img.fetchPriority='low';img.referrerPolicy='no-referrer';
    const loaded=()=>{if(img.parentNode===box){placeholder.setAttribute('hidden','');if(rememberEntry('avatar:'+url))playMotion(img,[{opacity:0},{opacity:1}],{duration:MOTION_MS.feedback});}};
  img.addEventListener('load',loaded);
  img.addEventListener('error',()=>{if(img.parentNode===box){placeholder.removeAttribute('hidden');box.replaceChildren(placeholder);uiAttr(box,'aria-description',m('Avatar unavailable'));}});
  box.append(img);img.src=url;if(img.complete&&img.naturalWidth>0)loaded();return box;
}
function userLink(user,className){
  const link=element(user.id?'a':'span',user.name,className);
  if(user.id&&typeof openUserProfile==='function'){link.href='#user-'+user.id;link.addEventListener('click',event=>{event.preventDefault();openUserProfile(user.id);});}
  else if(user.id){link.href='https://spinsha.re/user/'+user.id;link.target='_blank';link.rel='noopener noreferrer';}
  return link;
}
function makePreviewGlyphs(){
  const stack=element('span',undefined,'preview-glyphs'),play=icon('play'),pause=icon('pause'),problem=icon('audio-error'),spinner=element('span',undefined,'preview-spinner');
  play.classList.add('preview-glyph','preview-glyph-play');pause.classList.add('preview-glyph','preview-glyph-pause');problem.classList.add('preview-glyph','preview-glyph-error');stack.setAttribute('aria-hidden','true');stack.append(play,pause,problem,spinner);return stack;
}
const coverViews=new Map(),coverTargets=new Map();
let coverObserver=null,activeCovers=0;
function cancelCover(view){
  if(view.state!=='loading')return;
  clearTimeout(view.timer);activeCovers--;view.state='idle';
  view.probe?.abort();view.probe=null;
  const image=view.image;view.image=null;image.removeAttribute('src');image.remove();
}
function syncCovers(){
  if(!coverObserver&&typeof IntersectionObserver==='function')coverObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){const view=coverTargets.get(entry.target);if(view)view.visible=entry.isIntersecting&&view.box.isConnected;}
    pumpCovers();
  },{rootMargin:'300px'});
  const inactive=[];
  for(const view of coverViews.values()){
    if(view.box.isConnected){
      if(view.state==='loaded'||view.state==='missing'||!view.sources.length)continue;
      if(coverObserver){if(!coverTargets.has(view.box)){coverTargets.set(view.box,view);coverObserver.observe(view.box);}}
      else view.visible=true;
    }else{
      view.visible=false;coverObserver?.unobserve(view.box);coverTargets.delete(view.box);cancelCover(view);inactive.push(view);
    }
  }
  for(const view of inactive.slice(0,Math.max(0,inactive.length-80)))coverViews.delete(view.key);
  pumpCovers();
}
function pumpCovers(){
  for(const view of coverViews.values()){
    if(activeCovers>=2)return;
    if(view.visible&&view.box.isConnected&&view.state==='idle'&&view.sources.length)loadCover(view);
  }
}
function loadCover(view){
  const image=element('img',undefined,'cover');uiAttr(image,'alt','');image.width=64;image.height=64;image.loading='eager';image.decoding='async';image.fetchPriority='auto';image.referrerPolicy='no-referrer';
  const source=view.sources[view.index],url=new URL(source);
  if(view.retryVersion)url.searchParams.set('v',String(view.retryVersion));
  view.image=image;view.state='loading';activeCovers++;
  const finish=(loaded,missing=false)=>{
    if(view.image!==image||view.state!=='loading')return;
    clearTimeout(view.timer);activeCovers--;
    view.probe?.abort();view.probe=null;
    if(loaded){view.state='loaded';view.placeholder.setAttribute('hidden','');coverObserver?.unobserve(view.box);coverTargets.delete(view.box);if(rememberEntry('cover:'+source))playMotion(image,[{opacity:0},{opacity:1}],{duration:MOTION_MS.feedback});}
    else{
      if(missing)view.missingSources.add(source);
      view.image=null;image.removeAttribute('src');image.remove();view.index++;
      while(view.missingSources.has(view.sources[view.index]))view.index++;
      view.state=view.index<view.sources.length?'idle':view.missingSources.size===view.sources.length?'missing':'error';
      if(view.state==='error')view.retry.hidden=false;
      if(view.state==='missing'){view.missing.hidden=false;coverObserver?.unobserve(view.box);coverTargets.delete(view.box);}
    }
    pumpCovers();
  };
  image.addEventListener('load',()=>finish(true));
  image.addEventListener('error',()=>{
    if(view.image!==image||view.state!=='loading'||view.probe)return;
    const probe=new AbortController();view.probe=probe;
    fetch(url.href,{method:'HEAD',mode:'cors',credentials:'omit',cache:view.retryVersion?'reload':'default',referrerPolicy:'no-referrer',redirect:'error',signal:probe.signal})
      .then(response=>finish(false,response.status===404||response.status===410)).catch(()=>finish(false));
  });
  view.media.append(image);view.timer=setTimeout(()=>finish(image.complete&&image.naturalWidth>0),12000);image.src=url.href;
  if(image.complete&&image.naturalWidth>0)finish(true);
}
function makeCover(row){
  const meta=row[8],sources=[...new Set([coverURL(meta.thumbnail),coverURL(meta.cover)].filter(Boolean))],key=JSON.stringify([cacheGeneration,row[0],meta.updateHash||'',...sources]);
  let view=coverViews.get(key);
  if(view){coverViews.delete(key);coverViews.set(key,view);}
  else{
    const box=element('div',undefined,'cover-box'),media=element('div',undefined,'cover-media'),placeholder=icon('grid'),play=element('button',undefined,'cover-play preview-toggle'),retry=element('button',undefined,'cover-retry'),failure=element('span',undefined,'sr-only'),missing=element('span',m('No cover'),'cover-missing');
    missing.hidden=Boolean(sources.length);media.append(placeholder,missing);play.type='button';play.setAttribute('aria-pressed','false');play.setAttribute('aria-busy','false');play.append(makePreviewGlyphs());
    retry.type='button';retry.hidden=true;retry.append(failure,icon('refresh'));box.append(media,play,retry);
    view={key,row,box,media,play,placeholder,retry,failure,missing,sources,missingSources:new Set(),index:0,state:sources.length?'idle':'missing',visible:false,image:null,timer:null,probe:null,retryVersion:0};coverViews.set(key,view);
    play.addEventListener('click',()=>toggleChartPreview(view.row));
    retry.addEventListener('click',()=>{if(view.state!=='error')return;view.index=0;while(view.missingSources.has(view.sources[view.index]))view.index++;view.retryVersion=Math.max(Date.now(),view.retryVersion+1);view.state='idle';if(document.activeElement===view.retry)view.play.focus({preventScroll:true});view.retry.hidden=true;view.visible=true;syncCovers();});
  }
  view.row=row;view.play.disabled=!chartPreviewReference(row);uiAttr(view.retry,'aria-label',m('Retry cover')+': '+row[1]);uiText(view.failure,m('Cover unavailable'));uiText(view.missing,m('No cover'));syncPreviewButton(view);
  return view.box;
}

// One explicit, song-level stream. It never calls chart detail, view or download APIs.
let previewTrack=null,previewState='idle',previewFormat='ogg',previewExpectedSource='',previewGeneration=0,previewPlayAttempt=0,previewReady=false,previewResumeAt=0,previewWantsPlay=false,previewPlaybackConfirmed=false,previewFrame=0,previewSourceTimer=null,previewSourceCleanup=null,previewResolveWork=null,previewErrorCode='',previewCoverToken=0,previewArtworkSlot=0,previewArtworkMotions=[],previewLastAnnouncement='',previewRenderedSecond=-1,previewRenderedLimit=-1,previewShortcutPending=0,previewShortcutTimer=null,previewShortcutHintShown=APP_CONFIG.playerShortcutHintShown,previewHintTimer=null,previewHintMotion=null;
// Volume: one persisted level (0-1); zero doubles as the muted state.
let previewVolume=APP_CONFIG.playerVolume,previewLastVolume=previewVolume>0?previewVolume:1,previewVolumeTimer=null,previewVolumePopoverOpen=false,previewVolumeLeaveTimer=null,previewVolumeAnnouncement='';
