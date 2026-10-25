async function windowCommand(action){
  try{const result=await installerRequest('POST','/v1/desktop/window',{action});if(result?.ok!==true)throw uiError(m('The window control could not be used. Please try again.'));}
  catch(error){languageFeedback(errorText(error));}
}
function setupWindowControls(){
  for(const action of ['minimize','maximize','close'])$('window-'+action).addEventListener('click',()=>windowCommand(action));
  let receivedEvent=false;
  globalThis.addEventListener?.('spinshare-window-state',event=>{receivedEvent=true;applyWindowState(event.detail);});
  installerRequest('GET','/v1/desktop/window').then(result=>{if(!receivedEvent)applyWindowState(result?.window);}).catch(()=>{});
  const bar=document.querySelector('.topbar');
  if(bar&&typeof ResizeObserver==='function'){
    const observer=new ResizeObserver(scheduleWindowRegions);
    for(const node of [bar,...bar.children,...bar.querySelectorAll('.global-player button,.global-player input,.global-player-error > span')])observer.observe(node);
  }
  if(typeof MutationObserver==='function'){
    const observer=new MutationObserver(()=>{scheduleWindowRegions();closeVolumePopover();});
    for(const dialog of document.querySelectorAll('dialog'))observer.observe(dialog,{attributes:true,attributeFilter:['open']});
    // The player appearing (hidden removed) changes which topbar rects are
    // clickable; without this the cover stays covered by the drag region.
    const player=document.getElementById('preview-player');
    if(player)observer.observe(player,{attributes:true,attributeFilter:['hidden']});
  }
  globalThis.addEventListener?.('resize',scheduleWindowRegions);
  // Maximized/restore transitions change the viewport without a resize event
  // in some cases; re-publish regions when the desktop reports a state change.
  globalThis.addEventListener?.('message',event=>{
    if(event.data?.type!=='window-state')return;
    scheduleWindowRegions();
    // Maximize/restore settles over multiple frames; re-publish once more
    // after layout stabilizes to catch any stale viewport reports.
    setTimeout(scheduleWindowRegions,120);
  });
}
let windowRegionsFrame=0,windowRegionsBusy=false,windowRegionsAgain=false,windowRegionsSignature='';
function windowRegionRect(node){
  let left=0,top=0;
  for(let parent=node;parent;parent=parent.offsetParent){
    left+=parent.offsetLeft;top+=parent.offsetTop;
    if(parent!==node){left+=parent.clientLeft||0;top+=parent.clientTop||0;}
  }
  // Keep the short (up to 3px) entry/hover motion inside a stable click target.
  const padding=node.closest('.global-player')?3:0;
  return [left-padding,top-padding,node.offsetWidth+padding*2,node.offsetHeight+padding*2];
}
function scheduleWindowRegions(){
  if(windowRegionsFrame||!document.documentElement.classList.contains('desktop-chrome')||typeof requestAnimationFrame!=='function')return;
  windowRegionsFrame=requestAnimationFrame(()=>{windowRegionsFrame=0;publishWindowRegions();});
}
async function publishWindowRegions(){
  if(windowRegionsBusy){windowRegionsAgain=true;return;}
  const bar=document.querySelector('.topbar');
  if(!bar||!document.documentElement.classList.contains('desktop-chrome')||!globalThis.innerWidth||!globalThis.innerHeight)return;
  // Layout coordinates intentionally ignore player/cover animation transforms.
  // The bell and account chip sit inside .topbar-actions, so its container rect
  // already covers them — keep the list at six rects (the publisher and the
  // native validator stay in lockstep).
  const excluded=['.brand','.topbar-actions','#preview-player-toggle','#preview-player-progress','#preview-player-retry','#preview-player-volume'].map(selector=>bar.querySelector(selector))
    .filter(node=>node&&node.offsetWidth>0&&node.offsetHeight>0)
    .map(windowRegionRect);
  const layout={viewport:[innerWidth,innerHeight],pixelRatio:globalThis.devicePixelRatio||1,headerHeight:document.querySelector('dialog[open]')?0:bar.offsetHeight,excluded};
  const signature=JSON.stringify(layout);if(signature===windowRegionsSignature)return;
  windowRegionsBusy=true;
  try{const result=await installerRequest('POST','/v1/desktop/window/regions',layout);if(result?.ok===true)windowRegionsSignature=signature;}
  catch{}
  finally{windowRegionsBusy=false;if(windowRegionsAgain){windowRegionsAgain=false;scheduleWindowRegions();}}
}
const dialogControls=['app-dialog-close','app-dialog-continue','app-dialog-wait','app-dialog-tray','app-dialog-remember-choice','app-dialog-help'];
function showAppDialog(detail){
  const dialog=$('app-dialog');
  if(detail===null){appDialogState=null;dismissCloseHelp(dialog);closeDialogPanel(dialog,()=>{appDialogFocus?.focus({preventScroll:true});appDialogFocus=null;});return;}
  if(!detail||typeof detail.id!=='string'||!/^[a-f0-9]{32}$/.test(detail.id)||!['close','exit','message'].includes(detail.kind)||typeof detail.message!=='string')return;
  const changed=appDialogState?.id!==detail.id||appDialogState?.kind!==detail.kind,choosing=detail.kind==='close';appDialogState=detail;
  uiText($('app-dialog-title'),m(choosing?'Close window':detail.kind==='exit'?'Quit app':'Notice'));
  uiText($('app-dialog-message'),UI_KEY_INDEX.has(detail.message)?m(detail.message):detail.message);
  uiText($('app-dialog-continue'),m(choosing?'Cancel':detail.kind==='exit'?'Keep running':'OK'));
  uiText($('app-dialog-wait'),m(choosing&&!(detail.activeCount>0)?'Quit app':'Exit after tasks finish'));
  $('app-dialog-wait').hidden=detail.kind==='message';$('app-dialog-tray').hidden=!choosing;$('app-dialog-remember').hidden=!choosing;$('app-dialog-continue').hidden=choosing;$('app-dialog-help').hidden=detail.kind==='message';
  if(changed){dismissCloseHelp(dialog);dismissCloseHelp($('settings-panel'));$('app-dialog-remember-choice').checked=false;uiText($('app-dialog-error'),'');appDialogBusy=false;for(const id of dialogControls)$(id).disabled=false;loadingIndicator($('app-dialog-actions'),false);}
  refreshCloseHelpTasks();if(!dialog.open)appDialogFocus=document.activeElement;openDialogPanel(dialog);
  if(changed)$(choosing?'app-dialog-close':'app-dialog-continue').focus();
}
async function replyAppDialog(action){
  if(!appDialogState||appDialogBusy)return;
  const id=appDialogState.id,remember=appDialogState.kind==='close'&&['exit','tray'].includes(action)?$('app-dialog-remember-choice').checked:undefined;appDialogBusy=true;
  dismissCloseHelp($('app-dialog'));
  for(const name of dialogControls)$(name).disabled=true;
  loadingIndicator($('app-dialog-actions'),true);
  uiText($('app-dialog-error'),'');
  try{
    const result=await installerRequest('POST','/v1/desktop/dialog',{id,action,...(remember===undefined?{}:{remember})});
    if(result?.ok!==true)throw uiError(m('Could not confirm exit. Please try again.'));
    if(appDialogState?.id===id)showAppDialog(null);
    if(action==='wait'||action==='exit')refreshActivity();
  }catch(error){if(appDialogState?.id===id)uiText($('app-dialog-error'),errorText(error));}
  finally{if(!appDialogState||appDialogState.id===id){appDialogBusy=false;for(const name of dialogControls)$(name).disabled=false;loadingIndicator($('app-dialog-actions'),false);}}
}
function setupAppDialogs(){
  $('app-dialog-close').addEventListener('click',()=>replyAppDialog('continue'));
  $('app-dialog-continue').addEventListener('click',()=>replyAppDialog('continue'));
  $('app-dialog-wait').addEventListener('click',()=>replyAppDialog(appDialogState?.kind==='close'?'exit':'wait'));
  $('app-dialog-tray').addEventListener('click',()=>replyAppDialog('tray'));
  $('app-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!dismissCloseHelp($('app-dialog')))replyAppDialog('continue');});
  let receivedEvent=false;
  globalThis.addEventListener?.('spinshare-dialog',event=>{receivedEvent=true;showAppDialog(event.detail);});
  installerRequest('GET','/v1/desktop/dialog').then(result=>{if(!receivedEvent)showAppDialog(result?.dialog);}).catch(()=>{});
}
function setupRuntime(){
  setupInputModality();
  setupMotion();
  setupLanguage();
  setupChoiceMenus();
  setupAudioPreview();
  setupWindowControls();
  setupAppDialogs();setupCloseHelp();setupCatalogSyncUI();setupActivity();setupScrolling();
  uiText($('install-directory'),INSTALL_DIRECTORY);$('settings-open').hidden=false;uiText($('settings-version'),'SpinShare Browser '+APP_CONFIG.version);
  $('settings-open').addEventListener('click',openSettings);$('settings-ok').addEventListener('click',closeSettings);
  $('settings-panel').addEventListener('cancel',event=>{event.preventDefault();if(!dismissCloseHelp($('settings-panel')))closeSettings();});
  $('settings-select').addEventListener('click',()=>selectDirectory());
  refreshInstallDirectoryConfirmation();
  $('install-directory-close').addEventListener('click',closeInstallDirectoryConfirmation);
  $('install-directory-change').addEventListener('click',changeInstallDirectoryFromConfirmation);
  $('install-directory-confirm').addEventListener('click',confirmInstallDirectoryAndContinue);
  $('install-directory-dialog').addEventListener('cancel',event=>{event.preventDefault();closeInstallDirectoryConfirmation();});
  syncCloseOptions();
  for(const input of document.querySelectorAll('input[name="close-behavior"]'))input.addEventListener('change',()=>{if(input.checked)return saveCloseBehavior(input.value);});
  $('settings-default').addEventListener('click',()=>{if(!$('settings-default').disabled)return selectDirectory(true);});
  refreshSettingsControls();setupAutoUpdate();setupSession();setupNotifications();setupAccountMenu();setupUpload();setupPlaylists();setupPlaylistSync();setupUserProfile();
}
