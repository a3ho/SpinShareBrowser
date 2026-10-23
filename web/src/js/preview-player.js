function chartPreviewReference(row){
  const value=String(row?.[8]?.previewReference||row?.[8]?.fileReference||'');return PREVIEW_REFERENCE.test(value)?value:'';
}
function previewSource(reference,format='ogg'){
  return PREVIEW_REFERENCE.test(reference)&&['ogg','mp3'].includes(format)?`https://spinshare.b-cdn.net/uploads/audio/${reference}_0.${format}`:'';
}
function localPreviewSource(path){return typeof path==='string'&&/^\/v1\/preview\/audio\/[a-f0-9]{48}$/.test(path)?INSTALL_ORIGIN+path:'';}
function previewErrorText(detail=false){
  if(previewErrorCode==='game_audio_not_found')return m(detail?'Game audio was not found. Confirm that the game is installed, then retry.':'Check game files');
  if(previewErrorCode==='preview_lookup_failed')return m(detail?'Could not locate this song audio. Check your connection, then retry.':'Could not load audio');
  return m(detail?'This song audio is unavailable. Retry or choose another song.':'Audio unavailable');
}
function samePreviewTrack(row){return Boolean(previewTrack&&row&&previewTrack.id===row[0]&&previewTrack.reference===chartPreviewReference(row));}
function previewLimit(){const duration=$('preview-audio').duration;return Number.isFinite(duration)&&duration>0?duration:0;}
function previewTime(value){
  const seconds=Math.max(0,Number.isFinite(value)?Math.floor(value):0);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function updatePreviewProgress(value=$('preview-audio').currentTime,force=false){
  if(!previewTrack)return;
  const control=$('preview-player-progress'),limit=previewLimit(),raw=Number.isFinite(value)?value:0,position=Math.max(0,limit>0?Math.min(raw,limit):raw),ratio=limit>0?position/limit:0;
  if(control.max!==String(limit||1))control.max=String(limit||1);control.value=String(position);control.style.setProperty('--preview-progress',(ratio*100).toFixed(3)+'%');
  const second=Math.floor(position),limitSecond=Math.floor(limit);if(force||second!==previewRenderedSecond||limitSecond!==previewRenderedLimit){previewRenderedSecond=second;previewRenderedLimit=limitSecond;control.setAttribute('aria-valuetext',previewTime(position)+' / '+previewTime(limit));$('preview-player-current').textContent=previewTime(position);$('preview-player-duration').textContent=previewTime(limit);}
}
function stopPreviewFrame(){if(previewFrame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(previewFrame);previewFrame=0;}
function clearPreviewWatchdog(){if(previewSourceTimer!==null)clearTimeout(previewSourceTimer);previewSourceTimer=null;}
function armPreviewWatchdog(token,source){clearPreviewWatchdog();previewSourceTimer=setTimeout(()=>{previewSourceTimer=null;if(token===previewGeneration&&source===previewExpectedSource&&previewWantsPlay&&previewState==='loading')handlePreviewSourceFailure(token,source);},PREVIEW_LOAD_TIMEOUT_MS);}
function finishPreview(){
  if(!previewTrack||previewState==='ended')return;
  const audio=$('preview-audio'),limit=previewLimit(),position=limit||Math.max(0,Number(audio.currentTime)||0);clearPreviewShortcutFeedback();previewWantsPlay=false;previewPlaybackConfirmed=false;previewState='ended';previewPlayAttempt++;clearPreviewWatchdog();stopPreviewFrame();
  audio.pause();updatePreviewProgress(position,true);syncPreviewInterface();announcePreview('Song finished: ');
}
function previewTick(){
  previewFrame=0;if(!previewTrack||previewState!=='playing'||document.hidden)return;
  const audio=$('preview-audio');
  updatePreviewProgress();if(typeof requestAnimationFrame==='function')previewFrame=requestAnimationFrame(previewTick);
}
function startPreviewFrame(){stopPreviewFrame();if(previewState==='playing'&&!document.hidden&&typeof requestAnimationFrame==='function')previewFrame=requestAnimationFrame(previewTick);}
function announcePreview(key){
  if(!previewTrack)return;const signature=key+previewTrack.id;if(signature===previewLastAnnouncement)return;previewLastAnnouncement=signature;uiText($('preview-player-status'),m(key)+previewTrack.title);
}
function clearPreviewShortcutFeedback(clearPending=true){
  if(previewShortcutTimer!==null)clearTimeout(previewShortcutTimer);previewShortcutTimer=null;if(clearPending){previewShortcutPending=0;if(previewResolveWork)previewResolveWork.shortcut=false;}$('preview-player-toggle')?.classList.remove('is-shortcut-feedback');
}
function showPreviewShortcutFeedback(){
  clearPreviewShortcutFeedback(false);const toggle=$('preview-player-toggle');if(!previewTrack||!toggle)return;toggle.classList.add('is-shortcut-feedback');previewShortcutTimer=setTimeout(()=>{previewShortcutTimer=null;toggle.classList.remove('is-shortcut-feedback');},PREVIEW_SHORTCUT_FEEDBACK_MS);
}
function acknowledgePreviewShortcut(attempt=previewShortcutPending){
  if(!attempt||previewShortcutPending!==attempt)return false;previewShortcutPending=0;showPreviewShortcutFeedback();return true;
}
function confirmPreviewPlaying(){
  if(!previewTrack||!previewWantsPlay)return false;previewPlaybackConfirmed=true;clearPreviewWatchdog();previewState='playing';syncPreviewInterface();startPreviewFrame();announcePreview('Now playing: ');acknowledgePreviewShortcut();return true;
}
function dismissPreviewShortcutHint(animate=true){
  if(previewHintTimer!==null)clearTimeout(previewHintTimer);previewHintTimer=null;
  const hint=$('player-shortcut-hint');if(!hint||hint.hidden)return;
  previewHintMotion?.cancel?.();previewHintMotion=null;
  const finish=()=>{hint.hidden=true;hint.inert=true;previewHintMotion=null;};
  if(!animate){finish();return;}
  previewHintMotion=playMotion(hint,[{opacity:1,transform:'translate(-50%,0) scale(1)'},{opacity:0,transform:'translate(-50%,-3px) scale(.985)'}],{duration:MOTION_MS.panel,easing:'cubic-bezier(.4,0,1,1)'});
  if(previewHintMotion)previewHintMotion.finished.then(finish,()=>{});else finish();
}
function showPreviewShortcutHint(){
  if(previewShortcutHintShown)return;previewShortcutHintShown=true;
  const hint=$('player-shortcut-hint');if(!hint)return;hint.inert=false;hint.hidden=false;
  previewHintMotion?.cancel?.();previewHintMotion=playMotion(hint,[{opacity:0,transform:'translate(-50%,-3px) scale(.985)'},{opacity:1,transform:'translate(-50%,0) scale(1)'}],{duration:MOTION_MS.panel,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
  previewHintTimer=setTimeout(()=>dismissPreviewShortcutHint(),PREVIEW_HINT_MS);
  if(typeof installerRequest==='function')installerRequest('POST','/v1/player-shortcuts-seen',{}).catch(()=>{});
}
function previewControlLabel(){
  if(!previewTrack)return m('Play song');
  if(previewState==='error')return m('Retry song: ')+previewTrack.title;
  if(previewWantsPlay&&['loading','playing'].includes(previewState))return m('Pause song: ')+previewTrack.title;
  return m('Play song: ')+previewTrack.title;
}
function syncPreviewButton(view){
  if(!view?.play)return;
  const available=Boolean(chartPreviewReference(view.row)),current=available&&samePreviewTrack(view.row),active=current&&previewWantsPlay&&['loading','playing'].includes(previewState),loading=current&&previewState==='loading'&&previewWantsPlay,error=current&&previewState==='error';
  view.box.classList.toggle('is-preview-current',current);view.play.classList.toggle('is-current',current);view.play.classList.toggle('is-playing',active);view.play.classList.toggle('is-loading',loading);view.play.classList.toggle('is-error',error);view.play.disabled=!available||appExiting;view.play.setAttribute('aria-pressed',String(active));view.play.setAttribute('aria-busy',String(loading));
  const label=!available?m('Song unavailable: ')+view.row[1]:error?m('Retry song: ')+view.row[1]:active?m('Pause song: ')+view.row[1]:m('Play song: ')+view.row[1];uiAttr(view.play,'aria-label',label);
  uiAttr(view.play,'aria-description',error?previewErrorText(true):'');
}
function syncPreviewButtons(){for(const view of coverViews.values())syncPreviewButton(view);}
function syncPreviewInterface(){
  const player=$('preview-player');if(!player)return;
  if(!previewTrack){player.hidden=true;closeVolumePopover();syncPreviewButtons();return;}
  player.hidden=false;uiText($('preview-player-title'),previewTrack.title);uiText($('preview-player-artist'),previewTrack.artist||m('Unknown artist'));
  const toggle=$('preview-player-toggle'),active=previewWantsPlay&&['loading','playing'].includes(previewState),loading=previewState==='loading'&&previewWantsPlay;toggle.classList.toggle('is-playing',active);toggle.classList.toggle('is-loading',loading);toggle.classList.toggle('is-error',previewState==='error');toggle.disabled=appExiting;toggle.setAttribute('aria-pressed',String(active));toggle.setAttribute('aria-busy',String(loading));uiAttr(toggle,'aria-label',previewControlLabel());
  player.classList.toggle('is-playing',previewState==='playing');player.classList.toggle('is-error',previewState==='error');player.setAttribute('aria-busy',String(previewState==='loading'));
  const failed=previewState==='error';$('preview-player-timeline').hidden=failed;$('preview-player-error').hidden=!failed;if(failed)closeVolumePopover();uiText($('preview-player-error-text'),failed?previewErrorText():'');uiAttr(toggle,'aria-description',failed?previewErrorText(true):'');uiAttr($('preview-player-retry'),'aria-label',m('Retry song: ')+previewTrack.title);uiAttr($('preview-player-retry'),'aria-description',failed?previewErrorText(true):'');$('preview-player-retry').disabled=appExiting;
  $('preview-player-progress').disabled=!previewReady||previewState==='error'||appExiting;updatePreviewProgress();syncPreviewButtons();
}
function animatePreviewSelection(first){
  const player=$('preview-player');
  if(first)playMotion(player,[{opacity:0,transform:'translateY(3px) scale(.99)'},{opacity:1,transform:'none'}],{duration:MOTION_MS.panel,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
  else{playMotion(player.querySelector('.global-player-body'),[{opacity:.28,transform:'translateY(2px)'},{opacity:1,transform:'none'}],{duration:MOTION_MS.standard,fill:'backwards'});playMotion($('preview-player-toggle'),[{transform:'scale(.94)'},{transform:'scale(1)'}],{duration:MOTION_MS.standard,easing:'cubic-bezier(.16,1,.3,1)'});}
}
function cancelPreviewArtworkMotions(){const motions=previewArtworkMotions;previewArtworkMotions=[];for(const motion of motions)try{motion.cancel();}catch{}}
function settlePreviewArtworkMotions(motions,complete){const group=motions.filter(Boolean);previewArtworkMotions=group;if(!group.length){complete();return;}Promise.allSettled(group.map(motion=>motion.finished)).then(()=>{if(previewArtworkMotions!==group)return;previewArtworkMotions=[];complete();});}
function setPreviewArtwork(track){
  const images=[$('preview-player-image'),$('preview-player-image-next')],placeholder=$('preview-player').querySelector('.global-player-placeholder'),sources=[...new Set([coverURL(track.cover),coverURL(track.thumbnail)].filter(Boolean))],token=++previewCoverToken,current=images[previewArtworkSlot],nextSlot=1-previewArtworkSlot,image=images[nextSlot];
  cancelPreviewArtworkMotions();image.onload=null;image.onerror=null;image.classList.remove('is-visible');image.hidden=true;image.removeAttribute('src');
  let index=0;
  const clearOld=()=>{if(token!==previewCoverToken)return;current.hidden=true;current.removeAttribute('src');};
  const missing=()=>{if(token!==previewCoverToken)return;image.hidden=true;image.removeAttribute('src');placeholder.hidden=false;current.classList.remove('is-visible');const fade=playMotion(current,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback}),placeholderFade=playMotion(placeholder,[{opacity:0},{opacity:1}],{duration:MOTION_MS.feedback});settlePreviewArtworkMotions([fade,placeholderFade],clearOld);};
  const loaded=()=>{if(token!==previewCoverToken)return;const hadPlaceholder=!placeholder.hidden;image.hidden=false;image.classList.add('is-visible');current.classList.remove('is-visible');previewArtworkSlot=nextSlot;const incoming=playMotion(image,[{opacity:0,transform:'scale(1.025)'},{opacity:1,transform:'scale(1)'}],{duration:MOTION_MS.standard,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'}),outgoing=current.hidden?null:playMotion(current,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback}),placeholderFade=hadPlaceholder?playMotion(placeholder,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback,fill:'forwards'}):null;settlePreviewArtworkMotions([incoming,outgoing,placeholderFade],()=>{clearOld();if(token===previewCoverToken)placeholder.hidden=true;});};
  const load=()=>{if(token!==previewCoverToken)return;if(index>=sources.length){missing();return;}image.src=sources[index++];};
  image.onload=loaded;image.onerror=load;image.referrerPolicy='no-referrer';if(sources.length)load();else missing();
}
function clearPreviewSourceEvents(){previewSourceCleanup?.();previewSourceCleanup=null;}
function markAppExiting(exiting){if(exiting===true&&!appExiting){appExiting=true;disposePreview();}}
function cancelPreviewResolve(){const work=previewResolveWork;previewResolveWork=null;work?.abort();}
function failPreview(code='preview_unavailable'){
  if(!previewTrack)return;cancelPreviewResolve();clearPreviewSourceEvents();clearPreviewShortcutFeedback();previewWantsPlay=false;previewReady=false;previewPlaybackConfirmed=false;previewPlayAttempt++;clearPreviewWatchdog();stopPreviewFrame();$('preview-audio').pause();previewErrorCode=code;previewState='error';syncPreviewInterface();uiText($('preview-player-status'),m('Song unavailable: ')+previewTrack.title+' — '+previewErrorText(true));
}
function attemptPreviewPlay(token,source,shortcut=false){
  const audio=$('preview-audio'),attempt=++previewPlayAttempt;let work;
  if(shortcut)previewShortcutPending=attempt;
  const current=()=>attempt===previewPlayAttempt&&token===previewGeneration&&source===previewExpectedSource;
  const rejected=error=>{if(!current()||error?.name==='AbortError')return;if(error?.name==='NotSupportedError'){handlePreviewSourceFailure(token,source);return;}if(previewShortcutPending===attempt)previewShortcutPending=0;previewWantsPlay=false;previewPlaybackConfirmed=false;previewState='paused';clearPreviewWatchdog();stopPreviewFrame();audio.pause();syncPreviewInterface();announcePreview('Song paused: ');};
  try{work=audio.play();}catch(error){rejected(error);return;}
  if(work&&typeof work.then==='function')Promise.resolve(work).catch(rejected);
}
function bindPreviewSource(token,source,resumeAt=0,resumeShortcut=false){
  const audio=$('preview-audio'),listeners=[],current=()=>token===previewGeneration&&source===previewExpectedSource&&Boolean(previewTrack);
  const on=(name,handler)=>{const wrapped=event=>{if(current())handler(event);};audio.addEventListener(name,wrapped);listeners.push([name,wrapped]);};
  on('loadedmetadata',()=>{previewReady=true;const limit=previewLimit();if(resumeAt>0)try{audio.currentTime=limit>0?Math.min(resumeAt,limit):resumeAt;}catch{}updatePreviewProgress(audio.currentTime,true);syncPreviewInterface();if(resumeAt>0&&previewWantsPlay&&audio.paused)attemptPreviewPlay(token,source,resumeShortcut);});
  on('durationchange',()=>updatePreviewProgress(audio.currentTime,true));
  on('timeupdate',()=>updatePreviewProgress());
  on('playing',()=>{if(!previewWantsPlay){audio.pause();return;}confirmPreviewPlaying();});
  on('waiting',()=>{if(previewWantsPlay){previewState='loading';stopPreviewFrame();armPreviewWatchdog(token,source);syncPreviewInterface();}});
  on('stalled',()=>{if(previewWantsPlay&&previewState==='loading')armPreviewWatchdog(token,source);});
  on('pause',()=>{stopPreviewFrame();if(!previewWantsPlay&&!['ended','error'].includes(previewState)){clearPreviewWatchdog();previewPlaybackConfirmed=false;previewState='paused';syncPreviewInterface();announcePreview('Song paused: ');}});
  on('ended',finishPreview);on('error',event=>handlePreviewSourceFailure(token,source,event));
  previewSourceCleanup=()=>{for(const [name,handler] of listeners)audio.removeEventListener(name,handler);};
}
function setPreviewSource(format,token,resumeAt=0,resumeShortcut=false,localPath=''){
  const source=format==='local'?localPreviewSource(localPath):previewSource(previewTrack?.reference||'',format);if(!source){failPreview();return;}
  const audio=$('preview-audio');previewPlayAttempt++;if(resumeShortcut)previewShortcutPending=0;previewPlaybackConfirmed=false;clearPreviewWatchdog();clearPreviewSourceEvents();audio.pause();audio.removeAttribute('src');audio.load();previewFormat=format;previewExpectedSource=source;previewReady=false;previewResumeAt=resumeAt;previewState=previewWantsPlay?'loading':'paused';audio.src=source;bindPreviewSource(token,source,resumeAt,resumeShortcut);audio.load();syncPreviewInterface();if(previewWantsPlay){armPreviewWatchdog(token,source);if(resumeAt<=0)attemptPreviewPlay(token,source,resumeShortcut);}
}
async function resolvePreviewSource(token,resumeAt,resumeShortcut){
  cancelPreviewResolve();const work=new AbortController();work.shortcut=resumeShortcut;previewResolveWork=work;
  const current=()=>previewResolveWork===work&&token===previewGeneration&&Boolean(previewTrack)&&!appExiting;
  const audio=$('preview-audio');previewPlayAttempt++;previewShortcutPending=0;previewPlaybackConfirmed=false;previewReady=false;previewExpectedSource='';previewFormat='local';clearPreviewSourceEvents();stopPreviewFrame();audio.pause();audio.removeAttribute('src');audio.load();previewState=previewWantsPlay?'loading':'paused';syncPreviewInterface();
  try{
    const result=await installerRequest('POST','/v1/preview/resolve',{fileReference:previewTrack.reference,updateHash:previewTrack.updateHash},'',work.signal);
    if(!current())return;
    previewResolveWork=null;if(!localPreviewSource(result?.url)){failPreview('preview_lookup_failed');return;}
    setPreviewSource('local',token,resumeAt,work.shortcut,result.url);
  }catch(error){if(current()){previewResolveWork=null;failPreview(['game_audio_not_found','preview_unavailable','preview_lookup_failed'].includes(error?.code)?error.code:'preview_lookup_failed');}}
}
function handlePreviewSourceFailure(token,source){
  if(token!==previewGeneration||source!==previewExpectedSource||previewResolveWork||previewState==='error')return;
  clearPreviewWatchdog();
  const position=previewReady?Math.max(0,Number($('preview-audio').currentTime)||0):previewResumeAt,resumeShortcut=previewShortcutPending>0;
  if(previewFormat==='ogg'){setPreviewSource('mp3',token,position,resumeShortcut);return;}
  if(previewFormat==='mp3'){resolvePreviewSource(token,position,resumeShortcut);return;}failPreview();
}
function startChartPreview(row,force=false){
  const reference=chartPreviewReference(row);if(!reference||appExiting)return false;
  if(!force&&samePreviewTrack(row)){toggleCurrentPreview();return true;}
  const player=$('preview-player'),first=player.hidden;cancelPreviewResolve();clearPreviewShortcutFeedback();previewGeneration++;previewErrorCode='';previewLastAnnouncement='';previewRenderedSecond=-1;previewRenderedLimit=-1;previewWantsPlay=true;previewReady=false;previewPlaybackConfirmed=false;previewState='loading';previewTrack={id:row[0],reference,updateHash:String(row[8]?.updateHash||''),title:row[1],artist:row[3],cover:row[8]?.cover||'',thumbnail:row[8]?.thumbnail||'',row};
  stopPreviewFrame();setPreviewArtwork(previewTrack);syncPreviewInterface();animatePreviewSelection(first);announcePreview('Loading song: ');setPreviewSource('ogg',previewGeneration);showPreviewShortcutHint();return true;
}
function toggleCurrentPreview(origin='control'){
  if(!previewTrack||appExiting)return false;
  if(origin!=='shortcut')clearPreviewShortcutFeedback();
  if(previewState==='error')return startChartPreview(previewTrack.row,true);
  const audio=$('preview-audio');if(previewWantsPlay&&['loading','playing'].includes(previewState)){
    const activePlayback=previewPlaybackConfirmed||previewState==='playing';previewWantsPlay=false;previewPlaybackConfirmed=false;previewPlayAttempt++;previewShortcutPending=0;if(previewResolveWork)previewResolveWork.shortcut=false;clearPreviewWatchdog();audio.pause();previewState='paused';syncPreviewInterface();announcePreview('Song paused: ');if(origin==='shortcut'&&activePlayback)showPreviewShortcutFeedback();return true;
  }
  const limit=previewLimit();if(previewState==='ended'||limit>0&&audio.currentTime>=limit-.015){try{audio.currentTime=0;}catch{}updatePreviewProgress(0);}
  previewWantsPlay=true;previewPlaybackConfirmed=false;previewState='loading';syncPreviewInterface();if(previewResolveWork)previewResolveWork.shortcut=origin==='shortcut';else{armPreviewWatchdog(previewGeneration,previewExpectedSource);attemptPreviewPlay(previewGeneration,previewExpectedSource,origin==='shortcut');}return true;
}
function toggleChartPreview(row){return samePreviewTrack(row)?toggleCurrentPreview():startChartPreview(row);}
function pausePreview(){
  if(!previewTrack||!previewWantsPlay)return;clearPreviewShortcutFeedback();previewWantsPlay=false;previewPlaybackConfirmed=false;previewPlayAttempt++;clearPreviewWatchdog();$('preview-audio').pause();previewState='paused';stopPreviewFrame();syncPreviewInterface();announcePreview('Song paused: ');
}
function disposePreview(){
  cancelPreviewResolve();previewErrorCode='';
  closeVolumePopover();flushPreviewVolume();
  previewGeneration++;previewPlayAttempt++;previewWantsPlay=false;previewReady=false;previewPlaybackConfirmed=false;previewState='idle';previewExpectedSource='';previewLastAnnouncement='';previewRenderedSecond=-1;previewRenderedLimit=-1;previewTrack=null;previewCoverToken++;clearPreviewShortcutFeedback();dismissPreviewShortcutHint(false);clearPreviewWatchdog();stopPreviewFrame();clearPreviewSourceEvents();cancelPreviewArtworkMotions();
  const audio=$('preview-audio');if(audio){audio.pause();audio.removeAttribute('src');audio.load();}for(const image of [$('preview-player-image'),$('preview-player-image-next')])if(image){image.onload=null;image.onerror=null;image.classList.remove('is-visible');image.hidden=true;image.removeAttribute('src');}previewArtworkSlot=0;$('preview-player')?.setAttribute('hidden','');syncPreviewButtons();
}
function reconcilePreviewCatalog(data){
  if(!previewTrack||!Array.isArray(data))return;const song=data.find(item=>Number(item?.id)===previewTrack.id),reference=String(song?.fileReference||''),hash=String(song?.updateHash||'');if(!song||!PREVIEW_REFERENCE.test(reference)||reference!==previewTrack.reference||hash!==previewTrack.updateHash)disposePreview();
}
function currentPreviewControl(target){
  const control=target?.closest?.('.preview-toggle');if(!control)return null;return control===$('preview-player-toggle')||control.classList.contains('is-current')?control:null;
}
function previewSpaceReserved(event){
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return true;const target=event.target;
  if(!target?.closest)return false;if(currentPreviewControl(target))return false;if(target.closest('a[href],textarea,select,button,summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"],[role="combobox"],[role="slider"],[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="spinbutton"],[role="tree"],[role="treeitem"],[role="grid"],[role="gridcell"],[role="tab"]'))return true;
  const input=target.closest('input');if(input&&String(input.type||'').toLowerCase()!=='range')return true;return Boolean(target.closest('.reading-content,.calendar-popover'));
}
function handlePreviewSpace(event){
  if((event.key!==' '&&event.code!=='Space')||!previewTrack||previewSpaceReserved(event))return;event.preventDefault();if(event.repeat)return;
  if(!toggleCurrentPreview('shortcut'))return;
  if(document.activeElement===$('preview-player-progress'))document.activeElement.blur?.();
}
function previewSeekReserved(event){
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return true;const target=event.target;
  if(!target?.closest)return false;
  if(currentPreviewControl(target)||target===$('preview-player-progress'))return false;
  const selection=globalThis.getSelection?.();if(selection&&!selection.isCollapsed)return true;
  return Boolean(target.closest('a[href],input,textarea,select,button,summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"],[role="combobox"],[role="slider"],[role="menu"],[role="menuitem"],[role="listbox"],[role="option"],[role="spinbutton"],[role="tree"],[role="treeitem"],[role="grid"],[role="gridcell"],[role="tab"],.reading-content,.calendar-popover'));
}
function seekPreviewBy(seconds){
  if(!previewTrack||!previewReady||previewState==='error'||appExiting)return false;
  const audio=$('preview-audio'),limit=previewLimit();if(!(limit>0))return false;
  const next=Math.max(0,Math.min((Number(audio.currentTime)||0)+seconds,limit));
  try{audio.currentTime=next;}catch{return false;}
  if(next>=limit-.015)finishPreview();
  else{if(previewState==='ended'){previewState='paused';previewWantsPlay=false;}updatePreviewProgress(next,true);syncPreviewInterface();}
  return true;
}
function handlePreviewSeekKey(event){
  if(!['ArrowLeft','ArrowRight'].includes(event.key)||previewSeekReserved(event))return;
  if(!seekPreviewBy(event.key==='ArrowLeft'?-PREVIEW_SEEK_SECONDS:PREVIEW_SEEK_SECONDS))return;
  event.preventDefault();
}
function volumeGlyphState(){return previewVolume<=0?'mute':previewVolume<.5?'low':'high';}
function announceVolumeMute(muted){
  const key=muted?'Volume muted':'Volume restored',signature='volume:'+key;
  if(signature===previewVolumeAnnouncement)return;
  previewVolumeAnnouncement=signature;uiText($('preview-player-status'),m(key));
}
function syncVolumeInterface(){
  const button=$('preview-player-volume-button'),slider=$('volume-slider'),muted=previewVolume<=0;
  slider.value=String(previewVolume);
  slider.style.setProperty('--volume-level',(previewVolume*100)+'%');
  slider.setAttribute('aria-valuetext',Math.round(previewVolume*100)+'%');
  for(const glyph of button.querySelectorAll('.volume-glyph'))glyph.classList.toggle('is-active',glyph.dataset.volume===volumeGlyphState());
  uiAttr(button,'aria-label',muted?m('Unmute playback'):m('Mute playback'));
  button.setAttribute('aria-pressed',String(muted));
  button.disabled=appExiting;slider.disabled=appExiting;
}
function flushPreviewVolume(){if(previewVolumeTimer===null)return;clearTimeout(previewVolumeTimer);persistPreviewVolume();}
function persistPreviewVolume(){previewVolumeTimer=null;installerRequest('POST','/v1/player-volume',{volume:previewVolume}).catch(()=>{});}
function schedulePreviewVolume(immediate=false){
  clearTimeout(previewVolumeTimer);
  if(immediate)persistPreviewVolume();else previewVolumeTimer=setTimeout(persistPreviewVolume,600);
}
function setPreviewVolume(value,immediate=false){
  const next=Math.round(Math.max(0,Math.min(1,Number(value)||0))*100)/100,wasMuted=previewVolume<=0;
  if(next>0)previewLastVolume=next;
  previewVolume=next;
  $('preview-audio').volume=previewVolume;
  syncVolumeInterface();schedulePreviewVolume(immediate);
  if((previewVolume<=0)!==wasMuted)announceVolumeMute(previewVolume<=0);
}
function togglePreviewMute(){setPreviewVolume(previewVolume<=0?previewLastVolume:0,true);}
function positionVolumePopover(){
  const panel=$('volume-popover');if(!panel.matches(':popover-open'))return;
  const anchor=$('preview-player-volume-button'),rect=anchor.getBoundingClientRect();
  const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,edge=12,gap=8;
  const ceiling=(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+gap;
  if(!anchor.isConnected||rect.bottom<=0||rect.top>=height){closeVolumePopover();return;}
  panel.style.left=Math.max(edge,Math.min(rect.right-panel.offsetWidth,width-edge-panel.offsetWidth))+'px';
  panel.style.top=Math.max(ceiling,rect.bottom+gap)+'px';
}
function openVolumePopover(){
  if(previewVolumePopoverOpen||appExiting||document.hidden)return;
  clearTimeout(previewVolumeLeaveTimer);previewVolumeLeaveTimer=null;
  previewVolumePopoverOpen=true;
  const panel=$('volume-popover');if(!panel.matches(':popover-open'))panel.showPopover();
  positionVolumePopover();
}
function closeVolumePopover(restoreFocus=false){
  clearTimeout(previewVolumeLeaveTimer);previewVolumeLeaveTimer=null;
  if(!previewVolumePopoverOpen)return;
  previewVolumePopoverOpen=false;
  const panel=$('volume-popover');if(panel.matches(':popover-open'))panel.hidePopover();
  flushPreviewVolume();
  if(restoreFocus)$('preview-player-volume-button').focus({preventScroll:true});
}
function leaveVolumePopover(){
  clearTimeout(previewVolumeLeaveTimer);
  previewVolumeLeaveTimer=setTimeout(()=>{
    previewVolumeLeaveTimer=null;
    const button=$('preview-player-volume-button'),panel=$('volume-popover'),focused=document.activeElement;
    const keyboardFocused=document.documentElement.dataset.inputModality==='keyboard'&&focused?.matches?.(':focus-visible');
    if(button.matches(':hover')||panel.matches(':hover')||keyboardFocused&&(button.contains(focused)||panel.contains(focused)))return;
    closeVolumePopover();
  },160);
}
function wheelPreviewVolume(event){
  if(event.ctrlKey)return;
  event.preventDefault();event.stopPropagation();
  setPreviewVolume(previewVolume+(event.deltaY<0?.05:-.05));
}
function setupAudioPreview(){
  const audio=$('preview-audio'),progress=$('preview-player-progress');$('preview-player-toggle').addEventListener('click',toggleCurrentPreview);
  $('preview-player-retry').addEventListener('click',()=>{if(previewState!=='error')return;const focused=document.activeElement===$('preview-player-retry');if(toggleCurrentPreview()&&focused)$('preview-player-toggle').focus({preventScroll:true});});
  progress.addEventListener('input',()=>{if(!previewTrack||!previewReady)return;const limit=previewLimit();if(!(limit>0))return;const value=Math.max(0,Math.min(Number(progress.value)||0,limit));try{audio.currentTime=value;}catch{}if(value>=limit-.015){if(previewState==='ended')updatePreviewProgress(limit,true);else finishPreview();return;}if(previewState==='ended'){previewState='paused';previewWantsPlay=false;}updatePreviewProgress(value,true);syncPreviewInterface();});
  const volumeButton=$('preview-player-volume-button'),volumeSlider=$('volume-slider'),volumePanel=$('volume-popover');
  audio.volume=previewVolume;
  volumeButton.addEventListener('click',()=>{if(!appExiting)togglePreviewMute();});
  volumeButton.addEventListener('pointerenter',openVolumePopover);
  volumeButton.addEventListener('pointerleave',leaveVolumePopover);
  volumeButton.addEventListener('focus',()=>{if(document.documentElement.dataset.inputModality==='keyboard'&&volumeButton.matches(':focus-visible'))openVolumePopover();});
  volumeButton.addEventListener('blur',leaveVolumePopover);
  volumeButton.addEventListener('wheel',wheelPreviewVolume,{passive:false});
  volumePanel.addEventListener('pointerenter',()=>{clearTimeout(previewVolumeLeaveTimer);previewVolumeLeaveTimer=null;});
  volumePanel.addEventListener('pointerleave',leaveVolumePopover);
  volumePanel.addEventListener('wheel',wheelPreviewVolume,{passive:false});
  volumeSlider.addEventListener('input',()=>{if(!appExiting)setPreviewVolume(Number(volumeSlider.value));});
  volumeSlider.addEventListener('change',()=>flushPreviewVolume());
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&previewVolumePopoverOpen){event.preventDefault();event.stopPropagation();closeVolumePopover(true);}});
  document.addEventListener('pointerdown',event=>{if(previewVolumePopoverOpen&&!volumePanel.contains(event.target)&&!volumeButton.contains(event.target))closeVolumePopover();},true);
  globalThis.addEventListener?.('blur',()=>closeVolumePopover());
  globalThis.addEventListener?.('resize',positionVolumePopover);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)closeVolumePopover();});
  syncVolumeInterface();
  document.addEventListener('keydown',handlePreviewSpace);document.addEventListener('keydown',handlePreviewSeekKey);document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePreview();});globalThis.addEventListener?.('pagehide',()=>{flushPreviewVolume();disposePreview();});syncPreviewInterface();
}
const CHART_DISCLOSURE_CONFIG={
  description:{budgetLines:5,previewLines:4.5,idPrefix:'chart-description-',label:'Chart description',read:'Read the full note for ',collapse:'Collapse the note for ',readHelp:'Click or press Enter to read the full note.',collapseHelp:'Click or press Enter to collapse the note.',shortRole:'region'},
  subtitle:{budgetLines:2,previewLines:1.5,idPrefix:'chart-subtitle-',label:'Subtitle',read:'Read the full subtitle for ',collapse:'Collapse the subtitle for ',readHelp:'Click or press Enter to read the full subtitle.',collapseHelp:'Click or press Enter to collapse the subtitle.',shortRole:''},
  artist:{budgetLines:2,previewLines:1.5,idPrefix:'chart-artist-',label:'Artist',read:'Read the full artist credit for ',collapse:'Collapse the artist credit for ',readHelp:'Click or press Enter to read the full artist credit.',collapseHelp:'Click or press Enter to collapse the artist credit.',shortRole:''}
};
const chartDescriptionViews=new Map();
let chartDescriptionOwner=null,chartDescriptionObserver=null,chartDescriptionFrame=0,chartDescriptionControlsReady=false;
