function syncCatalogRefresh(){
  const busy=catalogManualBusy||catalogAutomaticBusy||catalogStartupBusy;
  $('refresh-data').disabled=appExiting||busy;
  loadingIndicator($('refresh-data'),catalogManualBusy);
}
function catalogWaitDuration(value){
  const seconds=Math.max(1,Math.ceil(Number(value)||0)),minutes=Math.floor(seconds/60),remainder=seconds%60;
  if(minutes&&remainder)return number(minutes)+m(' min ')+number(remainder)+m(' sec');
  if(minutes)return number(minutes)+m(' min');
  return number(seconds)+m(' sec');
}
function catalogPayloadError(result,fallback=m('Chart data could not be loaded')){
  const code=typeof result?.errorCode==='string'?result.errorCode:typeof result?.code==='string'?result.code:'';
  const manualWait=Number.isFinite(result?.retryAfterSeconds)&&result.retryAfterSeconds>0?Math.ceil(result.retryAfterSeconds):null,automaticWait=Number.isFinite(result?.automaticRetryAfterSeconds)&&result.automaticRetryAfterSeconds>0?Math.ceil(result.automaticRetryAfterSeconds):null;
  const cooling=['cooldown','manual_cooldown','backoff'].includes(result?.outcome),specific=code==='charts_cache_error'?m('Local chart data could not be read or saved'):CHART_ERROR_TEXT[code]||INSTALLER_ERROR_TEXT[code]||(code==='charts_cooldown'||code==='charts_automatic_backoff'||cooling?m('The manual update interval has not ended yet'):fallback);
  const error=uiError(specific);error.code=code;error.catalogResult=result;error.catalogReason=specific;error.catalogManualWait=manualWait;error.catalogAutomaticWait=automaticWait;error.catalogCooling=cooling||code==='charts_cooldown'||code==='charts_automatic_backoff';return error;
}
function catalogUpdateFailed(result){return Boolean(result?.refreshError)||['failed','backoff','cooldown','manual_cooldown'].includes(result?.outcome);}
function catalogToastFailure(error,channel='manual'){
  const wait=channel==='automatic'?error?.catalogAutomaticWait:error?.catalogManualWait;
  const intervalOnly=error?.catalogCooling&&(!error?.code||['charts_cooldown','charts_automatic_backoff'].includes(error.code));
  const title=intervalOnly?m(channel==='automatic'?'Automatic sync did not finish':'Manual update is not available yet'):CHART_TOAST_ERROR_TEXT[error?.code]||error?.catalogReason||m('Chart data was not updated');
  return {title,primary:{label:m(channel==='automatic'?'Automatic retry':'Manual retry'),value:wait!==null&&wait!==undefined?m('Available in ')+catalogWaitDuration(wait):m('Available now')},secondary:{label:m('Currently using'),value:m('Local chart data')}};
}
function updateCatalogDeadlines(result){
  if(Number.isFinite(result?.nextAllowedAt))catalogNextAllowedAt=Math.max(0,result.nextAllowedAt);
  if(Number.isFinite(result?.automaticNextAllowedAt))catalogAutomaticNextAllowedAt=Math.max(0,result.automaticNextAllowedAt);
  syncCatalogRefresh();
}
async function requestCatalog(kind,signal,onProgress,afterInstall=false){
  const path=CHART_ENDPOINTS[kind];if(!path||!['cache','manual','automatic'].includes(kind))throw uiError(m('Chart data could not be loaded'));
  const method=kind==='cache'?'GET':'POST',headers={'X-SpinShare-Key':INSTALL_KEY};if(method==='POST')headers['Content-Type']='application/json';
  const response=await fetch(INSTALL_ORIGIN+path,{method,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',headers,...(method==='POST'?{body:JSON.stringify(kind==='automatic'&&afterInstall?{afterInstall:true}:{})}:{}),signal});
  const length=Number(response.headers.get('Content-Length')),contentLength=Number.isFinite(length)&&length>0?length:null;
  const result=await readJSONResponse({ok:true,headers:response.headers,body:response.body},responseLimit+64*1024,bytes=>onProgress?.({phase:'receiving',bytesReceived:bytes,contentLength}));
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  updateCatalogDeadlines(result);
  if(!response.ok)throw catalogPayloadError(result);
  const noCache=kind==='cache'&&result?.data===null;
  if(!result||typeof result!=='object'||!Array.isArray(result.data)&&!noCache)throw catalogPayloadError(result);
  return result;
}
async function loadRemote(signal){
  // GET is deliberately cache-only. Network updates use the two explicit POST endpoints.
  return requestCatalog('cache',signal,status=>{if(!signal.aborted&&Number.isFinite(status.bytesReceived))setStatus(m('Receiving chart data: ')+number(Math.round(status.bytesReceived/100000)/10)+m(' MB.'));});
}
async function timedCatalogRequest(kind,onProgress,afterInstall=false){
  const request=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;request.abort();},requestTimeout);
  try{return await requestCatalog(kind,request.signal,onProgress,afterInstall);}
  catch(error){
    if(timedOut)throw uiError(m(kind==='cache'?'Loading charts timed out. Try again.':'Updating chart data timed out. Try again.'));
    if(error instanceof TypeError)throw uiError(m('Cannot reach the local chart service. Reopen SpinShareBrowser.exe and try again.'));
    throw error;
  }finally{clearTimeout(timer);}
}
function catalogResultAvailable(result){return Array.isArray(result?.data)&&(result.data.length>0||Number.isFinite(result.fetchedAt)||result.cached===true||result.stale===false);}
function invalidateCatalogDerived(){
  if(typeof reconcilePreviewCatalog==='function')reconcilePreviewCatalog(catalog);
  cacheGeneration++;reviewCounts.clear();reviewCache.clear();profileCache.clear();userSearchCache.clear();installedCharts.clear();presenceProblem=false;presenceGeneration++;presenceQueue.clear();clearDeletionErrors();
}
function publishCatalogResult(result){
  if(!catalogResultAvailable(result))return {available:Array.isArray(catalog),changed:false};
  const fetchedAt=Number.isFinite(result.fetchedAt)?result.fetchedAt:null;
  // A cache read or cooldown response can carry a newer tray-owned generation
  // even when this request did not change the server data.
  const externalRefresh=catalog!==null&&fetchedAt!==null&&fetchedAt!==catalogFetchedAt;
  const serverChanged=catalog!==null&&result.changed===true;
  const changed=serverChanged||externalRefresh;
  catalog=result.data;catalogFetchedAt=fetchedAt;indexCatalogTags(catalog);if(changed)invalidateCatalogDerived();
  return {available:true,changed,serverChanged};
}
async function rebuildPublishedCatalog(changed){
  if(!changed||phase!=='ready'||!applied)return;
  stopTextSearch(true);currentRows=compact(catalog,applied);await rebuild();
}
function catalogIsStale(result){return result?.stale===true||!catalogResultAvailable(result)||!Number.isFinite(result?.fetchedAt)||Date.now()-result.fetchedAt>=CATALOG_STALE_MS;}

function positionCatalogHelp(){
  const button=$('refresh-data-help'),panel=$('refresh-data-help-panel');if(!button||!panel?.matches?.(':popover-open'))return;
  const anchor=button.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,edge=12,gap=8;
  const box=panel.getBoundingClientRect(),left=Math.max(edge,Math.min(anchor.right-box.width,width-edge-box.width));
  const below=height-anchor.bottom-edge-gap,top=below>=box.height?anchor.bottom+gap:Math.max(edge,anchor.top-gap-box.height);
  panel.style.left=left+'px';panel.style.top=top+'px';
}
function setCatalogHelp(visible){
  clearHelpPopoverTimer('refresh-data-help');
  const button=$('refresh-data-help'),panel=$('refresh-data-help-panel');if(!button||!panel)return;
  if(visible&&(button.disabled||!hostVisible||document.hidden))return;
  const open=panel.matches?.(':popover-open');button.classList.toggle('is-active',visible);
  if(!visible){if(open)panel.hidePopover();return;}
  for(const id of closeHelpIds)setCloseHelp(id,false);
  if(typeof setAutoUpdateHelp==='function')setAutoUpdateHelp(false);
  if(!open)panel.showPopover();positionCatalogHelp();
}
function setupCatalogHelp(){
  const button=$('refresh-data-help'),panel=$('refresh-data-help-panel');
  setupHoverHelp('refresh-data-help',setCatalogHelp,{preventClick:true});
  panel.addEventListener('toggle',()=>{const visible=panel.matches(':popover-open');button.classList.toggle('is-active',visible);if(visible)positionCatalogHelp();});
  globalThis.addEventListener?.('resize',positionCatalogHelp);globalThis.addEventListener?.('scroll',positionCatalogHelp,true);
  if(typeof ResizeObserver==='function')new ResizeObserver(positionCatalogHelp).observe(panel);
}

function pauseCatalogToast(){
  if(!catalogToastTimer)return;clearTimeout(catalogToastTimer);catalogToastTimer=null;
  catalogToastRemaining=Math.max(250,catalogToastRemaining-(Date.now()-catalogToastStartedAt));
}
function resumeCatalogToast(){
  const toast=$('catalog-sync-toast');if(!toast||toast.hidden||catalogToastTimer||document.hidden||!hostVisible)return;
  catalogToastStartedAt=Date.now();catalogToastTimer=setTimeout(()=>hideCatalogToast(),catalogToastRemaining||4200);
}
function flushCatalogToast(){if(catalogPendingToast&&hostVisible&&!document.hidden){const pending=catalogPendingToast;catalogPendingToast=null;showCatalogToast(pending.content,pending.kind);}}
function hideCatalogToast(immediate=false){
  const toast=$('catalog-sync-toast');clearTimeout(catalogToastTimer);catalogToastTimer=null;catalogToastRemaining=0;
  if(!toast||toast.hidden)return;catalogToastMotion?.cancel();catalogToastMotion=null;
  const finish=()=>{toast.hidden=true;};
  const animation=immediate?null:playMotion(toast,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
  if(animation){catalogToastMotion=animation;animation.finished.then(finish,finish);}else finish();
}
function setCatalogToastFact(name,fact){
  const row=$('catalog-sync-toast-fact-'+name),visible=Boolean(fact?.label&&fact?.value);row.hidden=!visible;
  uiText($('catalog-sync-toast-'+name+'-label'),visible?fact.label:'');uiText($('catalog-sync-toast-'+name+'-value'),visible?fact.value:'');
}
function showCatalogToast(content,kind='success'){
  if(!hostVisible||document.hidden){catalogPendingToast={content,kind};return;}
  const toast=$('catalog-sync-toast');catalogToastMotion?.cancel();catalogToastMotion=null;clearTimeout(catalogToastTimer);
  const structured=content&&typeof content==='object',primary=structured?content.primary:null,secondary=structured?content.secondary:null;
  toast.hidden=false;toast.dataset.kind=kind;uiText($('catalog-sync-toast-message'),structured?content.title:content);
  setCatalogToastFact('primary',primary);setCatalogToastFact('secondary',secondary);$('catalog-sync-toast-facts').hidden=!primary&&!secondary;
  catalogToastMotion=playMotion(toast,[{opacity:0},{opacity:1}],{duration:MOTION_MS.panel,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
  catalogToastRemaining=4200;catalogToastStartedAt=Date.now();catalogToastTimer=setTimeout(()=>hideCatalogToast(),catalogToastRemaining);
}

function catalogProgressText(status){
  const bytes=Number.isFinite(status?.bytesReceived)&&status.bytesReceived>=0?status.bytesReceived:null,total=Number.isFinite(status?.contentLength)&&status.contentLength>0?status.contentLength:null;
  if(bytes!==null){const value=number(Math.round(bytes/100000)/10);return m('Received ')+value+m(' MB')+(total!==null?m(' of ')+number(Math.round(total/100000)/10)+m(' MB'):'');}
  const phases={idle:'Preparing chart update...',connecting:'Connecting to the chart server...',receiving:'Receiving chart data...',saving:'Saving chart data safely...'};
  return m(phases[status?.phase]||'Updating chart data...');
}
function updateCatalogSyncProgress(status={}){
  const meter=$('catalog-sync-meter'),fill=meter.querySelector('span'),total=Number.isFinite(status.contentLength)&&status.contentLength>0?status.contentLength:null,bytes=Number.isFinite(status.bytesReceived)&&status.bytesReceived>=0?status.bytesReceived:null;
  meter.classList.toggle('is-determinate',total!==null);meter.classList.toggle('is-indeterminate',total===null);
  if(total!==null)fill.style.transform=`scaleX(${Math.max(0,Math.min(1,(bytes||0)/total))})`;else fill.style.removeProperty('transform');
  uiText($('catalog-sync-progress'),catalogProgressText(status));
}
function stopCatalogStatusPolling(){
  const poll=catalogStatusPoll;catalogStatusPoll=null;if(!poll)return;clearTimeout(poll.timer);poll.controller.abort();
}
function startCatalogStatusPolling(){
  stopCatalogStatusPolling();const poll={controller:new AbortController(),timer:null};catalogStatusPoll=poll;
  const read=async()=>{
    if(catalogStatusPoll!==poll)return;
    try{
      const response=await fetch(INSTALL_ORIGIN+CHART_ENDPOINTS.status,{method:'GET',mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',headers:{'X-SpinShare-Key':INSTALL_KEY},signal:poll.controller.signal});
      if(!response.ok){stopCatalogStatusPolling();return;}
      const result=await readJSONResponse({ok:true,headers:response.headers,body:response.body},64*1024),activity=result?.activity&&typeof result.activity==='object'?result.activity:result;
      if(catalogStatusPoll!==poll)return;updateCatalogSyncProgress(activity);poll.timer=setTimeout(read,CATALOG_STATUS_POLL_MS);
    }catch{if(catalogStatusPoll===poll)stopCatalogStatusPolling();}
  };
  poll.timer=setTimeout(read,CATALOG_STATUS_POLL_MS);
}
function openCatalogSyncDialog(){
  const dialog=$('catalog-sync-dialog');clearTimeout(catalogDialogCloseTimer);catalogDialogCloseTimer=null;dialog.classList.remove('is-closing');dialog.inert=false;
  if(dialog.open)return;dialog.showModal();playMotion(dialog,[{opacity:0},{opacity:1}],{duration:MOTION_MS.expressive,easing:'cubic-bezier(.16,1,.3,1)',fill:'backwards'});
}
function closeCatalogSyncDialog(){
  const dialog=$('catalog-sync-dialog');clearTimeout(catalogDialogCloseTimer);catalogDialogCloseTimer=null;if(!dialog.open)return;
  dialog.inert=true;dialog.classList.add('is-closing');const animation=playMotion(dialog,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
  const finish=()=>{dialog.close();dialog.inert=false;dialog.classList.remove('is-closing');};if(animation)animation.finished.then(finish,finish);else finish();
}
function setCatalogSyncFacts(visible,error=null,hasData=false){
  const detail=$('catalog-sync-detail');detail.hidden=!visible;
  uiText($('catalog-sync-retry-state'),visible?(error?.catalogManualWait!==null&&error?.catalogManualWait!==undefined?m('Available in ')+catalogWaitDuration(error.catalogManualWait):m('Available now')):'');
  uiText($('catalog-sync-local-state'),visible?m(hasData?'Local chart data':'No local chart data'):'');
}
function showCatalogSyncLoading(noCache=false){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='loading';dialog.setAttribute('aria-busy','true');catalogFailureHasData=!noCache;
  uiText($('catalog-sync-title'),m('Updating chart data'));
  uiText($('catalog-sync-message'),m(noCache?'Preparing chart data for your first search.':'Your saved chart data is over 12 hours old. Updating it now.'));
  setCatalogSyncFacts(false);$('catalog-sync-actions').hidden=true;for(const id of ['catalog-sync-retry','catalog-sync-fallback'])$(id).disabled=false;
  updateCatalogSyncProgress({phase:'idle'});openCatalogSyncDialog();
}
function showCatalogSyncError(hasData,error){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='error';dialog.setAttribute('aria-busy','false');catalogFailureHasData=hasData;
  uiText($('catalog-sync-title'),m('Chart data was not updated'));
  uiText($('catalog-sync-message'),error?.catalogReason||errorText(error));
  uiText($('catalog-sync-progress'),'');setCatalogSyncFacts(true,error,hasData);
  $('catalog-sync-actions').hidden=false;uiText($('catalog-sync-fallback'),m(hasData?'Use local data':'Quit app'));for(const id of ['catalog-sync-retry','catalog-sync-fallback'])$(id).disabled=false;openCatalogSyncDialog();
}
function showCatalogSyncSuccess(){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='success';dialog.setAttribute('aria-busy','false');
  uiText($('catalog-sync-title'),m('Chart data is up to date'));uiText($('catalog-sync-message'),m('The latest chart data is ready.'));uiText($('catalog-sync-progress'),m('Update complete'));setCatalogSyncFacts(false);$('catalog-sync-actions').hidden=true;
  catalogDialogCloseTimer=setTimeout(closeCatalogSyncDialog,motionAllowed()?620:320);
}
async function exitFromCatalogSync(){
  for(const id of ['catalog-sync-retry','catalog-sync-fallback'])$(id).disabled=true;uiText($('catalog-sync-progress'),m('Exiting...'));
  if(!await exitTool())showCatalogSyncError(false,uiError(m('Could not confirm exit. Please try again.')));
}
function useLocalCatalog(){
  if(!catalogFailureHasData||!Array.isArray(catalog))return;catalogStartupBusy=false;syncFilters();closeCatalogSyncDialog();scheduleAutomaticCatalogSync(60000);
}
function automaticCatalogDueAt(){
  const staleAt=!catalogInstallRecheck&&Number.isFinite(catalogFetchedAt)?catalogFetchedAt+CATALOG_STALE_MS:Date.now();return Math.max(staleAt,catalogAutomaticNextAllowedAt||0,catalogNextAllowedAt||0);
}
function maybeRunAutomaticCatalogSync(){
  if(hostVisible&&!document.hidden&&!catalogStartupBusy&&!catalogManualBusy&&!catalogAutomaticBusy&&automaticCatalogDueAt()<=Date.now())return automaticCatalogSync(false);
}
function scheduleAutomaticCatalogSync(minimumDelay=1000){
  clearTimeout(catalogAutomaticTimer);catalogAutomaticTimer=null;if(appExiting||!Array.isArray(catalog))return;
  const delay=Math.max(minimumDelay,automaticCatalogDueAt()-Date.now());catalogAutomaticTimer=setTimeout(()=>{catalogAutomaticTimer=null;maybeRunAutomaticCatalogSync();},Math.min(delay,2147483647));
}
async function automaticCatalogSync(startup=false){
  if(catalogAutomaticBusy||catalogManualBusy||appExiting)return false;catalogAutomaticBusy=true;syncCatalogRefresh();if(startup){showCatalogSyncLoading(!Array.isArray(catalog));startCatalogStatusPolling();}
  const afterInstall=catalogInstallRecheck,fetchedAt=catalogFetchedAt;catalogInstallRecheck=false;
  try{
    const result=await timedCatalogRequest('automatic',startup?updateCatalogSyncProgress:undefined,afterInstall);stopCatalogStatusPolling();const published=publishCatalogResult(result);await rebuildPublishedCatalog(published.changed);
    if(catalogUpdateFailed(result)||result.stale===true||!published.available)throw catalogPayloadError(result,m('Chart data could not be updated.'));
    if(startup){catalogStartupBusy=false;syncFilters();showCatalogSyncSuccess();}
    else if(published.serverChanged)showCatalogToast(m('Chart data was updated.'));
    scheduleAutomaticCatalogSync();return true;
  }catch(error){
    stopCatalogStatusPolling();const published=publishCatalogResult(error.catalogResult);await rebuildPublishedCatalog(published.changed);
    if(afterInstall&&catalogFetchedAt===fetchedAt)catalogInstallRecheck=true;
    if(!Number.isFinite(catalogAutomaticNextAllowedAt)||catalogAutomaticNextAllowedAt<=Date.now())catalogAutomaticNextAllowedAt=Date.now()+5*60*1000;
    const available=Array.isArray(catalog);if(startup)showCatalogSyncError(available,error);else if(available)showCatalogToast(catalogToastFailure(error,'automatic'),'error');
    if(available)scheduleAutomaticCatalogSync();return false;
  }finally{catalogAutomaticBusy=false;syncCatalogRefresh();}
}
async function manualCatalogSync(startup=false){
  if(catalogManualBusy||catalogAutomaticBusy||!startup&&catalogStartupBusy||appExiting)return false;catalogManualBusy=true;syncCatalogRefresh();if(startup){showCatalogSyncLoading(!Array.isArray(catalog));startCatalogStatusPolling();}
  const afterInstall=catalogInstallRecheck,fetchedAt=catalogFetchedAt;catalogInstallRecheck=false;
  try{
    const result=await timedCatalogRequest('manual',startup?updateCatalogSyncProgress:undefined);stopCatalogStatusPolling();const published=publishCatalogResult(result);await rebuildPublishedCatalog(published.changed);
    if(catalogUpdateFailed(result)||!published.available)throw catalogPayloadError(result,m('Chart data could not be updated.'));
    if(startup){catalogStartupBusy=false;syncFilters();showCatalogSyncSuccess();}else showCatalogToast(m(published.serverChanged?'Chart data was updated.':'Chart data is already up to date.'));
    scheduleAutomaticCatalogSync();return true;
  }catch(error){
    stopCatalogStatusPolling();const published=publishCatalogResult(error.catalogResult);await rebuildPublishedCatalog(published.changed);
    if(afterInstall&&catalogFetchedAt===fetchedAt)catalogInstallRecheck=true;
    if(startup)showCatalogSyncError(Array.isArray(catalog),error);else showCatalogToast(catalogToastFailure(error,'manual'),'error');return false;
  }finally{catalogManualBusy=false;syncCatalogRefresh();if(catalogInstallRecheck)scheduleAutomaticCatalogSync();}
}
async function startCatalogRuntime(){
  if(catalogStartupWork)return catalogStartupWork;
  catalogStartupWork=(async()=>{
    catalogStartupBusy=true;syncFilters();
    try{
      const result=await timedCatalogRequest('cache'),published=publishCatalogResult(result);
      if(!published.available||catalogIsStale(result)){showCatalogSyncLoading(!published.available);await automaticCatalogSync(true);return;}
      catalogStartupBusy=false;syncFilters();scheduleAutomaticCatalogSync();
    }catch(error){
      const published=publishCatalogResult(error.catalogResult);
      if(error.code==='charts_cache_missing'){showCatalogSyncLoading(true);await automaticCatalogSync(true);return;}
      showCatalogSyncError(published.available,error);
    }
  })();return catalogStartupWork;
}
function setupCatalogSyncUI(){
  setupCatalogHelp();const toast=$('catalog-sync-toast');toast.addEventListener('pointerenter',pauseCatalogToast);toast.addEventListener('pointerleave',resumeCatalogToast);
  $('catalog-sync-dialog').addEventListener('cancel',event=>event.preventDefault());$('catalog-sync-retry').addEventListener('click',()=>manualCatalogSync(true));
  $('catalog-sync-fallback').addEventListener('click',()=>catalogFailureHasData?useLocalCatalog():exitFromCatalogSync());
}
