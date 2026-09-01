'use strict';
const UI_CATALOG=__SPINSHARE_UI_CATALOG__;
const UI_KEYS=Object.keys(UI_CATALOG.en),UI_KEY_INDEX=new Map(UI_KEYS.map((key,index)=>[key,index]));
const UI_PREFIX='\u0001spinshare-'+Math.random().toString(36).slice(2)+':',UI_END='\u0002';
const UI_PATTERN=new RegExp(UI_PREFIX+'(text|number):([^\u0002]*)'+UI_END,'g');
const uiBindings=new WeakMap();
let uiLanguage='zh-CN',languageBusy=false;
// Translate app tokens, leaving user text and existing card nodes untouched.
function m(key){const index=UI_KEY_INDEX.get(key);if(index===undefined)throw new Error('Missing UI catalog key: '+key);return UI_PREFIX+'text:'+index+UI_END;}
function renderUI(value,language=uiLanguage){return String(value??'').replace(UI_PATTERN,(_,kind,data)=>kind==='text'?UI_CATALOG[language][UI_KEYS[Number(data)]]:Number(data).toLocaleString(language));}
function uiText(node,value){
  const text=String(value??''),binding=uiBindings.get(node)||{attributes:new Map()};
  if(text.includes(UI_PREFIX)){binding.text=text;uiBindings.set(node,binding);node.setAttribute('data-ui-text','');}else{delete binding.text;node.removeAttribute('data-ui-text');}
  node.textContent=renderUI(text);return node;
}
function uiAttr(node,name,value){
  const text=String(value??''),binding=uiBindings.get(node)||{attributes:new Map()};
  if(text.includes(UI_PREFIX)){binding.attributes.set(name,text);uiBindings.set(node,binding);node.setAttribute('data-ui-attributes','');}else binding.attributes.delete(name);
  node.setAttribute(name,renderUI(text));return node;
}
function uiError(value){const error=new Error(renderUI(value,'en'));error.uiMessage=String(value);return error;}
function errorText(error){return typeof error?.uiMessage==='string'?error.uiMessage:typeof error?.message==='string'?error.message:String(error);}
function setUILanguage(language){
  if(!['zh-CN','en'].includes(language))return;
  uiLanguage=language;document.documentElement.lang=language;
  for(const node of document.querySelectorAll('[data-ui-text],[data-ui-attributes]')){const binding=uiBindings.get(node);if(!binding)continue;if(binding.text!==undefined)node.textContent=renderUI(binding.text);for(const [name,value] of binding.attributes)node.setAttribute(name,renderUI(value));}
  for(const id of ['ui-language','settings-language'])$(id).value=language;
  if(typeof syncChoiceMenus==='function')syncChoiceMenus(true);syncTagControls();scheduleChartTagsRefresh();scheduleChartDescriptions();syncCatalogRefresh();renderDateCalendar();if(typeof syncPreviewInterface==='function')syncPreviewInterface();
}
async function saveLanguage(language=uiLanguage){
  if(languageBusy||appExiting)return;
  if(!['zh-CN','en'].includes(language))return;
  setUILanguage(language);for(const prefix of ['language','settings-language'])$(prefix+'-feedback').hidden=true;
  languageBusy=true;for(const id of ['ui-language','settings-language','language-retry','settings-language-retry'])$(id).disabled=true;
  languageFeedback(m('Saving...'),false,true);let saved=false;
  try{const result=await installerRequest('POST','/v1/language',{language});if(result?.language!==language)throw uiError(m('The language could not be saved. Please retry.'));saved=true;}
  catch(error){languageFeedback(m('Could not save the language. Please retry.')+'\n'+errorText(error),true);}
  finally{languageBusy=false;for(const id of ['ui-language','settings-language','language-retry','settings-language-retry'])$(id).disabled=appExiting;for(const prefix of ['language','settings-language']){loadingIndicator($(prefix+'-message'),false);if(saved)$(prefix+'-feedback').hidden=true;}}
}
function languageFeedback(message,retry=false,loading=false){for(const prefix of ['language','settings-language']){uiText($(prefix+'-message'),message);loadingIndicator($(prefix+'-message'),loading);$(prefix+'-feedback').hidden=false;$(prefix+'-retry').hidden=!retry;}}
function setupLanguage(){
  for(const node of document.querySelectorAll('[data-ui-static]'))uiText(node,m(node.getAttribute('data-ui-static')));
  for(const name of ['aria-label','alt','placeholder'])for(const node of document.querySelectorAll('[data-ui-attr-'+name+']'))uiAttr(node,name,m(node.getAttribute('data-ui-attr-'+name)));
  setUILanguage(APP_CONFIG.language);
  for(const id of ['ui-language','settings-language'])$(id).addEventListener('change',event=>saveLanguage(event.target.value));
  for(const id of ['language-retry','settings-language-retry'])$(id).addEventListener('click',()=>saveLanguage());
}
const $ = id => document.getElementById(id);
const labels = ['Easy','Normal','Hard','Expert','XD'];
const shortLabels = ['E','N','H','EX','XD'];
const keys = [['hasEasyDifficulty','easyDifficulty'],['hasNormalDifficulty','normalDifficulty'],['hasHardDifficulty','hardDifficulty'],['hasExtremeDifficulty','expertDifficulty'],['hasXDDifficulty','XDDifficulty']];
const requestTimeout = 120000, responseLimit = 32*1024*1024;
const FIRST_UPLOAD_DATE='2020-01-01',scrollBatchSize=20;
const pagerMedia=typeof matchMedia==='function'?matchMedia('(max-width:900px)'):null;
const APP_CONFIG=validateRuntimeConfig(__SPINSHARE_RUNTIME_CONFIG__);
uiLanguage=APP_CONFIG.language;
const INSTALL_KEY=APP_CONFIG.key,INSTALL_ORIGIN=APP_CONFIG.origin;
let INSTALL_DIRECTORY=APP_CONFIG.targetDirectory,DEFAULT_INSTALL_DIRECTORY=APP_CONFIG.defaultDirectory,settingsRevision=APP_CONFIG.settingsRevision;
const installationStates=new Map(),installationViews=new Map();
let settingsBusy='',settingsLoaded=false,settingsStale=false,closeBehavior=APP_CONFIG.closeBehavior,installDirectoryConfirmed=APP_CONFIG.installDirectoryConfirmed;
let installDirectoryConfirmation=null,installDirectoryConfirmBusy=false;
let appDialogState=null,appDialogBusy=false,appDialogFocus=null;
let appExiting=false,exitFailed=false,activityJobs=[],activityTimer=null,activityPending=false,activityProblem='';
const activityViews=new Map();let activityVisible=false,activityMotion=null;
let currentRows=[],applied=null,lastAppliedCriteria=null,filtered=[],page=1,controller=null,phase='idle';
let resultToolsVisible=false,resultToolsMotion=null;
let showChartReviews=false;
let reviewPopoverOwner=null;
const REVIEW_REFRESH_MS=60000,REVIEW_REFRESH_STORAGE_KEY='spinshare.reviewRefreshNextAllowedAt';
let reviewRefreshNextAllowedAt=0,reviewRefreshOwner=null,reviewRefreshTimer=null;
let pageDetails = null, textFilterTimer = null, appliedText = '';
const searchFields={title:1,subtitle:2,artist:3,creator:4},searchScopes=new Set(Object.keys(searchFields)),userSearchCache=new Map();
const selectedTags=new Map(),tagCatalog=new Map();
let tagResultCounts=new Map(),tagPickerAnchor=null,tagCandidateIndex=-1,tagCandidates=[],tagStripSignature='',pendingTagAnchor=null,tagViewportFrame=null;
let textSearchWork=null,textSearchProblem='';
let visibleCount=scrollBatchSize,renderedCount=0,moreObserver=null;
const reviewCounts=new Map(),cardViews=new Map(),installedCharts=new Map(),presenceQueue=new Map();
const reviewCache=new Map(),profileCache=new Map(),profileRequests=new Map();
let catalog=null,cacheGeneration=0,presenceBusy=false,presenceGeneration=0;
let installationCandidates=[],installationFilterPending=false,installationFilterRemaining=0,presenceRefreshQueued=false,installationActivityIds=new Map();
const CHART_ENDPOINTS=Object.freeze({cache:'/v1/charts',manual:'/v1/charts/manual',automatic:'/v1/charts/automatic',status:'/v1/charts/status'});
const CATALOG_STALE_MS=12*60*60*1000,CATALOG_STATUS_POLL_MS=500;
let catalogNextAllowedAt=0,catalogAutomaticNextAllowedAt=0,catalogFetchedAt=null;
let catalogStartupBusy=true,catalogManualBusy=false,catalogAutomaticBusy=false,catalogAutomaticTimer=null,catalogStartupWork=null;
let catalogFailureHasData=false;
let catalogStatusPoll=null,catalogHelpTimer=null,catalogDialogCloseTimer=null,catalogToastTimer=null,catalogToastMotion=null,catalogToastStartedAt=0,catalogToastRemaining=0,catalogPendingToast=null;
const motionPreference=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):null;
const MOTION_MS=Object.freeze({feedback:150,standard:180,panel:220,expressive:280});
const PREVIEW_LOAD_TIMEOUT_MS=15000,PREVIEW_SHORTCUT_FEEDBACK_MS=900,PREVIEW_SEEK_SECONDS=5,PREVIEW_HINT_MS=6500,PREVIEW_REFERENCE=/^spinshare_[a-f0-9]{1,64}$/i;
const READING_MOTION=Object.freeze({
  enter:Object.freeze({duration:MOTION_MS.panel,easing:'cubic-bezier(.16,1,.3,1)'}),
  exit:Object.freeze({duration:MOTION_MS.feedback,easing:'cubic-bezier(.4,0,1,1)'})
});
const activeMotions=new Set(),entrySeen=new Set(),entryTargets=new Map();
let hostVisible=true,entryObserver=null;
function setupInputModality(){
  const root=document.documentElement;
  root.dataset.inputModality='keyboard';
  globalThis.addEventListener?.('pointerdown',()=>{root.dataset.inputModality='pointer';},{capture:true,passive:true});
  // Tab is the operation that moves focus through the interface. Other keys
  // (notably Escape and the global Space shortcut) must not resurrect a ring
  // on the last control clicked with the pointer.
  globalThis.addEventListener?.('keydown',event=>{if(event.key==='Tab')root.dataset.inputModality='keyboard';},true);
}
function motionAllowed(){return hostVisible&&!document.hidden&&!motionPreference?.matches;}
function playMotion(node,keyframes,options={}){
  if(!motionAllowed()||typeof node?.animate!=='function')return null;
  const animation=node.animate(keyframes,{duration:MOTION_MS.feedback,easing:'cubic-bezier(.2,.7,.2,1)',...options});
  activeMotions.add(animation);
  animation.finished.then(()=>activeMotions.delete(animation),()=>activeMotions.delete(animation));
  return animation;
}
function syncMotion(){
  document.documentElement.classList.toggle('motion-paused',!motionAllowed());
  if(!motionAllowed())for(const animation of [...activeMotions]){try{animation.finish();}catch{animation.cancel();}}
  if(!hostVisible||document.hidden){dismissCloseHelp($('settings-panel'));dismissCloseHelp($('app-dialog'));if(typeof setCatalogHelp==='function')setCatalogHelp(false);if(typeof pauseCatalogToast==='function')pauseCatalogToast();if(typeof dismissPreviewShortcutHint==='function')dismissPreviewShortcutHint(false);dismissChartDescription(false,false);}
  else{if(typeof resumeCatalogToast==='function')resumeCatalogToast();if(typeof flushCatalogToast==='function')flushCatalogToast();if(typeof maybeRunAutomaticCatalogSync==='function')maybeRunAutomaticCatalogSync();}
}
function rememberEntry(key){
  if(entrySeen.has(key))return false;
  entrySeen.add(key);
  if(entrySeen.size>20000)entrySeen.delete(entrySeen.values().next().value);
  return true;
}
function revealEntry(node,key,kind='card',delay=0){
  if(!rememberEntry(key))return;
  playMotion(node,[{opacity:0,transform:`translateY(${kind==='card'?10:4}px)`},{opacity:1,transform:'translateY(0)'}],{duration:kind==='card'?MOTION_MS.panel:MOTION_MS.standard,delay:Math.min(delay,100),fill:'backwards'});
}
function queueEntry(node,key,kind='card'){
  if(entrySeen.has(key))return;
  if(typeof IntersectionObserver!=='function'||typeof node.animate!=='function'){revealEntry(node,key,kind);return;}
  if(!entryObserver)entryObserver=new IntersectionObserver(entries=>{
    let index=0;
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const target=entryTargets.get(entry.target);entryObserver.unobserve(entry.target);entryTargets.delete(entry.target);
      if(target&&entry.target.isConnected)revealEntry(entry.target,target.key,target.kind,index++*20);
    }
  });
  entryTargets.set(node,{key,kind});entryObserver.observe(node);
}
function pruneEntries(){for(const node of entryTargets.keys())if(!node.isConnected){entryObserver?.unobserve(node);entryTargets.delete(node);}}
function setupMotion(){
  document.addEventListener('visibilitychange',syncMotion);
  motionPreference?.addEventListener?.('change',syncMotion);
  syncMotion();
  const panel=$('filter-panel');
  // Keep the large document reflow native and instantaneous. Only the newly
  // revealed controls move, so opening the filter never animates layout.
  panel.addEventListener('toggle',()=>{
    if(panel.open)playMotion($('filters'),[{opacity:.55,transform:'translateY(-4px)'},{opacity:1,transform:'none'}],{duration:MOTION_MS.standard,fill:'backwards'});
  });
}
const number = n => UI_PREFIX+'number:'+n+UI_END;
function loadingIndicator(target,active,queued=false){target.classList.toggle('is-loading',Boolean(active)&&!queued);target.classList.toggle('is-queued',Boolean(active)&&queued);}
function updateTaskProgress(target,job,active,label){
  const downloading=job?.state==='downloading',installing=job?.state==='extracting',total=downloading?job.totalBytes:installing?job.fileCount:0,done=downloading?job.downloadedBytes:installing?job.filesWritten:0;
  target.hidden=!active||!Number.isSafeInteger(total)||total<=0||!Number.isSafeInteger(done)||done<0;
  if(!target.hidden){target.max=total;target.value=Math.min(done,total);uiAttr(target,'aria-label',label);}
}
function setStatus(message,error=false){
  const emptyState=Boolean(message)&&(phase==='loading'||phase==='error'),status=$('status'),empty=$('empty');
  if(emptyState){
    uiText(status,'');status.classList.remove('error');loadingIndicator(status,false);
    uiText(empty,message);empty.classList.toggle('error',error);loadingIndicator(empty,phase==='loading'&&!error);return;
  }
  uiText(status,message);status.classList.toggle('error',error);loadingIndicator(status,false);
}
const INSTALLER_MESSAGE_REPLACEMENTS=Object.keys(UI_CATALOG.en).filter(key=>key.startsWith("engine.")).map(key=>[UI_CATALOG.en[key],key]).sort((a,b)=>b[0].length-a[0].length);
const INSTALLER_ERROR_TEXT=Object.freeze({invalid_installations:m("Installation status could not be read."),invalid_language:m("Choose a language and try again."),settings_changed:m("The install directory changed."),installer_busy:m("Wait for installations before changing the directory or exiting."),shutting_down:m("Exiting. Reopen SpinShareBrowser.exe to continue."),pairing_failed:m("Reopen SpinShareBrowser.exe to reconnect."),invalid_body:m("Unable to complete this action. Reopen SpinShareBrowser.exe."),invalid_type:m("Unable to complete this action. Reopen SpinShareBrowser.exe."),invalid_settings:m("Open Settings and choose the install folder again."),invalid_install:m("Unable to complete this action. Reopen SpinShareBrowser.exe."),invalid_revision:m("Open Settings and choose the install folder again."),invalid_request:m("Check the install folder in Settings, then try again."),settings_io_error:m("Settings could not be saved or read. Check permissions and free space."),request_expired:m("Could not confirm whether this chart was installed."),request_history_full:m("After installations finish, exit and reopen SpinShareBrowser.exe."),job_not_found:m("Cannot find this installation. Check the install folder."),not_found:m("Installer unavailable. Reopen SpinShareBrowser.exe."),context_rejected:m("Reopen SpinShareBrowser.exe to reconnect."),directory_confirmation_required:m("Confirm the chart installation directory before downloading."),directory_picker_busy:m("A folder selection dialog is already open."),directory_picker_error:m("Folder selection failed. Try again."),directory_picker_expired:m("Choosing a folder timed out. Close the folder dialog before retrying.")});
const CHART_ERROR_TEXT=Object.freeze({charts_network_error:m('The chart server could not be reached. Check your network and retry.'),charts_request_timeout:m('The chart server did not respond after the request may have reached it. Retry after the refresh interval.'),charts_access_denied:m('The chart server refused access. No refresh cooldown was used; retry when access is restored.'),charts_rate_limited:m('The chart server limited this request. Retry after the refresh interval.'),charts_server_error:m('The chart server failed after the request may have reached it. Retry after the refresh interval.'),charts_request_rejected:m('The chart server rejected this request. Retry after the refresh interval or check for an app update.'),charts_remote_timeout:m('The full chart transfer timed out. Try again after the refresh interval.'),charts_response_incomplete:m('The chart request or response was interrupted. Try again after the refresh interval.'),charts_response_too_large:m('The full chart response was too large to use safely. Retry after the refresh interval.'),charts_invalid_response:m('The chart server returned invalid data. Try again after the refresh interval.')});
const CHART_TOAST_ERROR_TEXT=Object.freeze({charts_network_error:m('Chart server unavailable.'),charts_request_timeout:m('The chart server timed out.'),charts_access_denied:m('Chart server access was refused.'),charts_rate_limited:m('Chart server rate limit reached.'),charts_server_error:m('The chart server returned an error.'),charts_request_rejected:m('The chart server rejected the update.'),charts_remote_timeout:m('Chart data transfer timed out.'),charts_response_incomplete:m('Chart data transfer was interrupted.'),charts_response_too_large:m('Chart data exceeded the safe size limit.'),charts_invalid_response:m('The chart server returned invalid data.'),charts_cache_error:m('Chart data could not be saved locally.'),charts_cooldown:m('Chart data update is still cooling down.')});
function localizeInstallerMessage(message){let text=typeof message==="string"?message:"";if(UI_KEY_INDEX.has(text))return m(text);for(const [english,key] of INSTALLER_MESSAGE_REPLACEMENTS){text=text.replaceAll(english+'.',m(key));text=text.replaceAll(english+'。',m(key));text=text.replaceAll(english,m(key));}return text.replace(/[。.]$/u,'');}
function directoryText(value){return typeof value==='string'&&value.length>0&&value.length<=32767&&!/[\x00-\x1f]/.test(value);}
function validateRuntimeConfig(config){
  let valid=config&&typeof config==='object'&&config.mode==='desktop'&&config.version==='2.0.0'&&typeof config.key==='string'&&/^[a-f0-9]{64}$/i.test(config.key)&&directoryText(config.targetDirectory)&&directoryText(config.defaultDirectory)&&typeof config.origin==='string';
  if(valid){try{const url=new URL(config.origin);valid=url.protocol==='http:'&&url.hostname==='127.0.0.1'&&Number(url.port)>=1&&Number(url.port)<=65535&&url.origin===config.origin&&globalThis.location?.origin===config.origin&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;}catch{valid=false;}}
  if(valid)valid=typeof config.settingsRevision==='string'&&/^[a-f0-9]{32}$/.test(config.settingsRevision);
  if(valid)valid=['zh-CN','en'].includes(config.language);
  if(valid)valid=config.closeBehavior===undefined||['ask','exit','tray'].includes(config.closeBehavior);
  if(valid)valid=typeof config.playerShortcutHintShown==='boolean';
  if(valid)valid=typeof config.installDirectoryConfirmed==='boolean';
  if(!valid){uiText($('status'),m("Unable to open the app. Reopen SpinShareBrowser.exe."));$('status').classList.add('error');throw uiError('Invalid SpinShare Browser runtime configuration');}
  return Object.freeze({mode:config.mode,key:config.key,origin:config.origin,targetDirectory:config.targetDirectory,defaultDirectory:config.defaultDirectory,settingsRevision:config.settingsRevision,version:config.version,language:config.language,closeBehavior:config.closeBehavior||'ask',playerShortcutHintShown:config.playerShortcutHintShown,installDirectoryConfirmed:config.installDirectoryConfirmed});
}
function settingsMessage(message,error=false){uiText($('settings-message'),message);$('settings-message').classList.toggle('is-error',error);loadingIndicator($('settings-message'),Boolean(message)&&Boolean(settingsBusy)&&!error);}
function hasActiveInstallations(){return activityJobs.length>0||[...installationStates.values()].some(state=>state.running||state.requesting);}
function refreshSettingsControls(){
  const locked=Boolean(settingsBusy)||appExiting,active=hasActiveInstallations();
  $('settings-default').disabled=locked||!settingsLoaded||active||INSTALL_DIRECTORY===DEFAULT_INSTALL_DIRECTORY;
  $('settings-select').disabled=locked||!settingsLoaded||active;
  $('settings-exit').disabled=Boolean(settingsBusy)||(appExiting&&!exitFailed);
  for(const input of document.querySelectorAll('input[name="close-behavior"]'))input.disabled=locked||!settingsLoaded;
  for(const id of ['ui-language','settings-language','language-retry','settings-language-retry'])$(id).disabled=languageBusy||appExiting;
  $('settings-close').disabled=settingsBusy==='saving'||settingsBusy==='shutdown';
  if(!settingsBusy)loadingIndicator($('settings-message'),false);
  loadingIndicator($('settings-exit'),settingsBusy==='shutdown');
}
function updateAllInstallationViews(){refreshInstallationActivity();for(const songId of installationViews.keys())updateInstallationView(songId);refreshSettingsControls();if(settingsStale)refreshInstallationResults();}
function readSettings(payload){
  const settings=payload?.settings;
  if(!settings||typeof settings!=='object'||!directoryText(settings.targetDirectory)||!directoryText(settings.defaultDirectory)||!(settings.customDirectory===null||directoryText(settings.customDirectory))||typeof settings.revision!=='string'||!/^[a-f0-9]{32}$/.test(settings.revision)||typeof settings.installDirectoryConfirmed!=='boolean'||settings.version!=='2.0.0')throw uiError(m("Settings could not be loaded. Reopen Settings."));
  if(settings.targetDirectory!==(settings.customDirectory===null?settings.defaultDirectory:settings.customDirectory))throw uiError(m("Open Settings and choose the install folder again."));
  if(settings.closeBehavior!==undefined&&!['ask','exit','tray'].includes(settings.closeBehavior))throw uiError(m("Settings could not be loaded. Reopen Settings."));
  return {targetDirectory:settings.targetDirectory,defaultDirectory:settings.defaultDirectory,customDirectory:settings.customDirectory,revision:settings.revision,version:settings.version,closeBehavior:settings.closeBehavior||'ask',installDirectoryConfirmed:settings.installDirectoryConfirmed,exiting:settings.exiting===true};
}
function applySettings(settings){
  const changed=settingsStale||settingsRevision!==settings.revision||INSTALL_DIRECTORY!==settings.targetDirectory;
  if(changed){installedCharts.clear();presenceQueue.clear();presenceGeneration++;for(const [id,state] of installationStates)if(!state.running&&!state.requesting)installationStates.delete(id);}
  INSTALL_DIRECTORY=settings.targetDirectory;DEFAULT_INSTALL_DIRECTORY=settings.defaultDirectory;settingsRevision=settings.revision;settingsLoaded=true;settingsStale=false;
  if(typeof settings.installDirectoryConfirmed==='boolean')installDirectoryConfirmed=settings.installDirectoryConfirmed;
  uiText($('install-directory'),INSTALL_DIRECTORY);
  uiText($('settings-directory'),INSTALL_DIRECTORY);
  if(typeof refreshInstallDirectoryConfirmation==='function')refreshInstallDirectoryConfirmation();
  closeBehavior=settings.closeBehavior;appExiting=appExiting||settings.exiting;syncCloseOptions();renderActivity();
  updateAllInstallationViews();syncFilters();queueInstallationChecks([...installationViews.values()].map(view=>view.row));
  if(changed)refreshInstallationResults();
}
async function loadSettings(){
  if(settingsBusy)return;
  settingsBusy='loading';refreshSettingsControls();settingsMessage(m("Loading settings..."));
  try{
    applySettings(readSettings(await installerRequest('GET','/v1/settings')));settingsMessage('');
  }
  catch(error){settingsMessage(errorText(error),true);}
  finally{settingsBusy='';refreshSettingsControls();}
}
const dialogMotions=new WeakMap();
function openDialogPanel(panel){
  if(panel.open&&!panel.inert)return;
  const current=panel.open?globalThis.getComputedStyle?.(panel):null;
  const from={opacity:panel.open?(current?.opacity||'1'):0,transform:panel.open?(current?.transform||'none'):'translateY(6px)'};
  const previous=dialogMotions.get(panel);dialogMotions.delete(panel);previous?.cancel();
  panel.inert=false;panel.classList.remove('dialog-closing');if(!panel.open)panel.showModal();else panel.querySelector('.settings-close')?.focus({preventScroll:true});
  const animation=playMotion(panel,[from,{opacity:1,transform:'none'}],{duration:MOTION_MS.feedback,easing:'cubic-bezier(.2,.7,.2,1)'});
  if(animation){dialogMotions.set(panel,animation);const done=()=>{if(dialogMotions.get(panel)===animation)dialogMotions.delete(panel);};animation.finished.then(done,done);}
}
function closeDialogPanel(panel,onClosed){
  if(!panel.open){onClosed?.();return;}
  if(panel.inert)return;
  const current=globalThis.getComputedStyle?.(panel),from={opacity:current?.opacity||'1',transform:current?.transform||'none'};
  const previous=dialogMotions.get(panel);dialogMotions.delete(panel);previous?.cancel();
  panel.inert=true;panel.classList.add('dialog-closing');
  const animation=playMotion(panel,[from,{opacity:0,transform:'translateY(4px)'}],{duration:MOTION_MS.feedback,easing:'ease-out'});
  const done=()=>{if(animation&&dialogMotions.get(panel)!==animation)return;dialogMotions.delete(panel);panel.close();panel.inert=false;panel.classList.remove('dialog-closing');onClosed?.();};
  if(animation){dialogMotions.set(panel,animation);animation.finished.then(done,done);}else done();
}
function refreshCloseHelpTasks(){
  const active=hasActiveInstallations()||Boolean(appDialogState?.activeCount>0);
  for(const note of document.querySelectorAll('.close-help-task'))note.hidden=!active;
}
const closeHelpIds=['settings-close-help','app-dialog-help'];let closeHelpTimer=null;
function positionCloseHelp(id){
  const button=$(id),panel=$(id+'-panel');if(!panel.matches(':popover-open'))return;
  const anchor=button.getBoundingClientRect(),owner=$(id==='settings-close-help'?'settings-panel':'app-dialog').getBoundingClientRect();
  const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,gap=8,edge=12;
  if(anchor.bottom<=Math.max(edge,owner.top)||anchor.top>=Math.min(height-edge,owner.bottom)){setCloseHelp(id,false);return;}
  panel.style.maxHeight=`${height-edge*2}px`;let box=panel.getBoundingClientRect(),left=anchor.right+gap,top=anchor.top-6;
  if(left+box.width>width-edge)left=anchor.left-gap-box.width;
  if(left<edge){
    left=Math.max(edge,Math.min(anchor.left,width-edge-box.width));
    const below=height-edge-anchor.bottom-gap,above=anchor.top-gap-edge,down=below>=box.height||below>=above;
    panel.style.maxHeight=`${Math.max(1,down?below:above)}px`;box=panel.getBoundingClientRect();
    top=down?anchor.bottom+gap:anchor.top-gap-box.height;
  }
  panel.style.left=`${Math.max(edge,Math.min(left,width-edge-box.width))}px`;
  panel.style.top=`${Math.max(edge,Math.min(top,height-edge-box.height))}px`;
}
function setCloseHelp(id,visible){
  clearTimeout(closeHelpTimer);closeHelpTimer=null;
  const button=$(id),panel=$(id+'-panel'),owner=$(id==='settings-close-help'?'settings-panel':'app-dialog');
  if(visible&&(button.hidden||button.disabled||!owner.open||owner.inert||!hostVisible||document.hidden))return;
  button.classList.toggle('is-active',visible);
  if(!visible){if(panel.matches(':popover-open'))panel.hidePopover();return;}
  for(const other of closeHelpIds)if(other!==id&&$(other+'-panel').matches(':popover-open'))setCloseHelp(other,false);
  refreshCloseHelpTasks();if(!panel.matches(':popover-open'))panel.showPopover();positionCloseHelp(id);
}
function dismissCloseHelp(panel){
  const button=panel.querySelector('.help-toggle');if(!button||!$(button.id+'-panel').matches(':popover-open'))return false;
  setCloseHelp(button.id,false);return true;
}
function setupCloseHelp(){
  for(const id of closeHelpIds){
    const button=$(id),panel=$(id+'-panel'),show=()=>setCloseHelp(id,true);
    const keyboardFocused=()=>document.documentElement.dataset.inputModality==='keyboard'&&button.matches(':focus-visible');
    const leave=()=>{clearTimeout(closeHelpTimer);closeHelpTimer=setTimeout(()=>{closeHelpTimer=null;if(!button.matches(':hover')&&!keyboardFocused()&&!panel.matches(':hover'))setCloseHelp(id,false);},100);};
    button.addEventListener('pointerenter',show);panel.addEventListener('pointerenter',show);
    button.addEventListener('pointerleave',leave);panel.addEventListener('pointerleave',leave);
    button.addEventListener('focus',()=>{if(keyboardFocused())show();});button.addEventListener('blur',leave);
  }
  const reposition=()=>{for(const id of closeHelpIds)positionCloseHelp(id);};
  globalThis.addEventListener?.('resize',reposition);globalThis.addEventListener?.('scroll',reposition,true);
  globalThis.addEventListener?.('blur',()=>{for(const id of closeHelpIds)setCloseHelp(id,false);});
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(reposition);for(const id of closeHelpIds)observer.observe($(id+'-panel'));}
}
async function openSettings(){
  const panel=$('settings-panel');dismissCloseHelp(panel);openDialogPanel(panel);
  uiText($('settings-directory'),INSTALL_DIRECTORY);
  await loadSettings();
}
function closeSettings(){if(settingsBusy==='saving'||settingsBusy==='shutdown')return;const panel=$('settings-panel');dismissCloseHelp(panel);closeDialogPanel(panel,()=>$('settings-open').focus({preventScroll:true}));}
async function selectDirectory(useDefault=false){
  if(settingsBusy||appExiting)return;
  if(!settingsLoaded){settingsMessage(m("Load the current settings before saving."),true);return;}
  if(hasActiveInstallations()){settingsMessage(m("Wait for installations to finish."),true);return;}
  settingsBusy='saving';updateAllInstallationViews();settingsMessage(useDefault?m("Saving..."):m("Choose an install folder in the Windows dialog."));
  try{
    const result=await installerRequest('POST',useDefault?'/v1/settings':'/v1/directory/select',{...(useDefault?{directory:null}:{}),expectedRevision:settingsRevision});
    if(!useDefault&&typeof result?.cancelled!=='boolean')throw uiError(m("Folder selection failed. Try again."));
    applySettings(readSettings(result));settingsMessage(result.cancelled?m("Folder selection cancelled."):m("Saved."));
  }
  catch(error){settingsMessage(errorText(error),true);}
  finally{settingsBusy='';updateAllInstallationViews();}
}
const installDirectoryConfirmControls=['install-directory-close','install-directory-change','install-directory-confirm'];
function installDirectoryConfirmMessage(message='',error=false){
  const target=$('install-directory-error');uiText(target,message);target.classList.toggle('is-error',error);loadingIndicator(target,Boolean(message)&&installDirectoryConfirmBusy&&!error);
}
function refreshInstallDirectoryConfirmation(){
  const dialog=$('install-directory-dialog');if(!dialog)return;
  uiText($('install-directory-confirm-path'),INSTALL_DIRECTORY);
  if(installDirectoryConfirmation)installDirectoryConfirmation.revision=settingsRevision;
}
function setInstallDirectoryConfirmBusy(busy){
  installDirectoryConfirmBusy=busy;
  for(const id of installDirectoryConfirmControls)$(id).disabled=busy||appExiting;
  $('install-directory-dialog').setAttribute('aria-busy',String(busy));
  const feedback=$('install-directory-error');
  loadingIndicator(feedback,Boolean(feedback.textContent)&&busy&&!feedback.classList.contains('is-error'));
}
function closeInstallDirectoryConfirmation(){
  if(installDirectoryConfirmBusy||!installDirectoryConfirmation)return;
  const context=installDirectoryConfirmation,dialog=$('install-directory-dialog');
  closeDialogPanel(dialog,()=>{if(installDirectoryConfirmation===context)installDirectoryConfirmation=null;if(context.focus?.isConnected)context.focus.focus({preventScroll:true});});
}
function requestInstallation(row,focus=document.activeElement){
  if(installDirectoryConfirmed)return startInstallation(row);
  if(row[8].dlc||appExiting||settingsBusy||settingsStale)return;
  if(installDirectoryConfirmation){openDialogPanel($('install-directory-dialog'));return;}
  installDirectoryConfirmation={row,focus,revision:settingsRevision};
  refreshInstallDirectoryConfirmation();installDirectoryConfirmMessage('');setInstallDirectoryConfirmBusy(false);
  openDialogPanel($('install-directory-dialog'));$('install-directory-confirm').focus({preventScroll:true});
}
async function reloadInstallDirectoryConfirmation(message){
  try{applySettings(readSettings(await installerRequest('GET','/v1/settings')));installDirectoryConfirmMessage(message,true);}
  catch(error){installDirectoryConfirmMessage(errorText(error),true);}
}
async function changeInstallDirectoryFromConfirmation(){
  if(!installDirectoryConfirmation||installDirectoryConfirmBusy||appExiting)return;
  setInstallDirectoryConfirmBusy(true);settingsBusy='saving';updateAllInstallationViews();installDirectoryConfirmMessage(m("Choose an install folder in the Windows dialog."));
  try{
    const result=await installerRequest('POST','/v1/directory/select',{expectedRevision:settingsRevision});
    if(typeof result?.cancelled!=='boolean')throw uiError(m("Folder selection failed. Try again."));
    applySettings(readSettings(result));
    installDirectoryConfirmMessage(result.cancelled?m("Folder selection cancelled."):m("Directory changed. Confirm the new folder to continue."));
  }catch(error){
    if(error.code==='settings_changed')await reloadInstallDirectoryConfirmation(m("The install directory changed while this window was open. Review the current folder and confirm again."));
    else installDirectoryConfirmMessage(errorText(error),true);
  }finally{settingsBusy='';setInstallDirectoryConfirmBusy(false);updateAllInstallationViews();}
}
async function confirmInstallDirectoryAndContinue(){
  if(!installDirectoryConfirmation||installDirectoryConfirmBusy||appExiting)return;
  const context=installDirectoryConfirmation,revision=settingsRevision,directory=INSTALL_DIRECTORY;
  setInstallDirectoryConfirmBusy(true);settingsBusy='saving';updateAllInstallationViews();installDirectoryConfirmMessage(m("Confirming directory..."));
  try{
    const result=await installerRequest('POST','/v1/install-directory-confirmation',{expectedRevision:revision});
    if(result?.confirmed!==true||result.settingsRevision!==revision||result.targetDirectory!==directory)throw uiError(m("Could not confirm installation. Check its status before trying again."));
    installDirectoryConfirmed=true;settingsBusy='';setInstallDirectoryConfirmBusy(false);installDirectoryConfirmMessage('');
    closeDialogPanel($('install-directory-dialog'),()=>{if(installDirectoryConfirmation===context)installDirectoryConfirmation=null;startInstallation(context.row);});
  }catch(error){
    if(error.code==='settings_changed')await reloadInstallDirectoryConfirmation(m("The install directory changed while this window was open. Review the current folder and confirm again."));
    else installDirectoryConfirmMessage(errorText(error),true);
  }finally{
    if(installDirectoryConfirmation===context){settingsBusy='';setInstallDirectoryConfirmBusy(false);updateAllInstallationViews();}
  }
}
async function exitTool(){
  if(settingsBusy||appExiting&&!exitFailed)return false;
  settingsBusy='shutdown';refreshSettingsControls();settingsMessage('');
  let exited=false;
  try{const result=await installerRequest('POST','/v1/desktop/exit',{});if(result?.ok!==true)throw uiError(m("Could not confirm exit. Please try again."));exited=true;}
  catch(error){settingsMessage(errorText(error),true);}
  finally{settingsBusy='';refreshSettingsControls();}
  return exited;
}
function syncCloseOptions(){for(const input of document.querySelectorAll('input[name="close-behavior"]'))input.checked=input.value===closeBehavior;}
async function saveCloseBehavior(behavior){
  if(settingsBusy||appExiting||!settingsLoaded)return;
  settingsBusy='saving';refreshSettingsControls();settingsMessage(m("Saving..."));
  try{applySettings(readSettings(await installerRequest('POST','/v1/close-behavior',{closeBehavior:behavior})));settingsMessage(m("Saved."));}
  catch(error){syncCloseOptions();settingsMessage(errorText(error),true);}
  finally{settingsBusy='';refreshSettingsControls();}
}
function applyWindowState(state){
  if(typeof state?.visible==='boolean'){hostVisible=state.visible;if(!hostVisible)pausePreview();syncMotion();if(hostVisible)maybeRunAutomaticCatalogSync();}
  if(typeof state?.exitFailed==='boolean'){exitFailed=state.exitFailed;renderActivity();refreshSettingsControls();}
  if(state?.exiting===true&&!appExiting){appExiting=true;disposePreview();updateAllInstallationViews();renderActivity();syncFilters();refreshActivity();}
  if(typeof state?.customChrome!=='boolean'||typeof state.maximized!=='boolean')return;
  document.documentElement.classList.toggle('desktop-chrome',state.customChrome);
  document.documentElement.classList.toggle('desktop-maximized',state.maximized);
  $('window-controls').hidden=!state.customChrome;
  $('window-controls').classList.toggle('is-maximized',state.maximized);
  uiAttr($('window-maximize'),'aria-label',m(state.maximized?'Restore window':'Maximize window'));
}
async function windowCommand(action){
  try{const result=await installerRequest('POST','/v1/desktop/window',{action});if(result?.ok!==true)throw uiError(m('The window control could not be used. Please try again.'));}
  catch(error){languageFeedback(errorText(error));}
}
function setupWindowControls(){
  for(const action of ['minimize','maximize','close'])$('window-'+action).addEventListener('click',()=>windowCommand(action));
  let receivedEvent=false;
  globalThis.addEventListener?.('spinshare-window-state',event=>{receivedEvent=true;applyWindowState(event.detail);});
  installerRequest('GET','/v1/desktop/window').then(result=>{if(!receivedEvent)applyWindowState(result?.window);}).catch(()=>{});
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
  $('settings-open').addEventListener('click',openSettings);$('settings-close').addEventListener('click',closeSettings);
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
  $('settings-exit').addEventListener('click',exitTool);refreshSettingsControls();
}
function readDifficulty(){
  const min=Number($('min').value),max=Number($('max').value),diffs=Array.from(document.querySelectorAll('input[name="diff"]:checked'),el=>Number(el.value));
  if($('min').value===''||$('max').value===''||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>999||min>max)throw uiError(m("Use whole numbers from 0 to 999, with minimum no higher than maximum."));
  if(!diffs.length)throw uiError(m("Select at least one difficulty."));
  return {min,max,diffs};
}
function readCriteria(){
  const difficulty=readDifficulty();
  const dateFrom=$('date-from').value.trim(),dateTo=$('date-to').value.trim(),today=updateDateBounds();
  if([dateFrom,dateTo].some(value=>value&&(!validDate(value)||value<FIRST_UPLOAD_DATE||value>today)))throw uiError(m("Choose dates between 2020-01-01 and today."));
  if(dateFrom&&dateTo&&dateFrom>dateTo)throw uiError(m("Choose a valid date range, with the start no later than the end."));
  return {...difficulty,dateFrom,dateTo};
}
function filtersChanged(){
  if(!applied)return false;
  try{return JSON.stringify(readCriteria())!==JSON.stringify(applied);}catch{return true;}
}
function syncResultTools(visible,previousFocus){
  const panel=$('result-tools'),busy=phase==='loading';
  if(!visible&&panel.contains(previousFocus)||previousFocus===$('apply-filters')&&busy){
    const filter=$('filter-panel'),action=$('apply-filters');
    const target=filter.open&&!action.hidden&&!action.disabled?action:filter.querySelector('summary');
    target.focus({preventScroll:true});
  }
  panel.inert=!visible;if(visible===resultToolsVisible)return;resultToolsVisible=visible;
  const height=panel.hidden?0:panel.getBoundingClientRect().height,opacity=panel.hidden?0:globalThis.getComputedStyle?.(panel)?.opacity||'1';
  const previous=resultToolsMotion;resultToolsMotion=null;previous?.cancel();
  if(panel.hidden&&!visible)return;panel.hidden=false;panel.classList.add('is-transitioning');
  const end=visible?$('result-tools-content').getBoundingClientRect().height:0;
  const animation=playMotion(panel,[{height:height+'px',opacity},{height:end+'px',opacity:visible?1:0}],{duration:MOTION_MS.standard});
  const finish=()=>{if(animation&&resultToolsMotion!==animation)return;resultToolsMotion=null;panel.hidden=!resultToolsVisible;panel.classList.remove('is-transitioning');};
  if(animation){resultToolsMotion=animation;animation.finished.then(finish,finish);}else finish();
}
function syncFilters(){
  const busy=phase==='loading'||typeof catalogStartupBusy!=='undefined'&&catalogStartupBusy,ready=Boolean(applied)&&phase==='ready',previousFocus=document.activeElement;
  $('difficulty-fields').disabled=busy||appExiting;$('date-fields').disabled=busy||appExiting;
  if((busy||appExiting)&&$('date-calendar')?.matches?.(':popover-open'))$('date-calendar').hidePopover();
  $('apply-filters').disabled=busy||appExiting;
  loadingIndicator($('apply-filters'),false);
  syncCatalogRefresh();
  $('reset-filters').disabled=busy||appExiting;
  for(const id of ['local-search','search-submit','search-clear'])$(id).disabled=!ready;
  $('installation-filter').disabled=!ready||appExiting;
  uiText($('filter-dirty'),!busy&&filtersChanged()?m('Filters changed. Select Filter charts to apply them.'):'');
  syncResultTools(ready,previousFocus);
  syncTagControls();
  if(typeof syncChoiceMenus==='function')syncChoiceMenus();
}
function cancelQuery(){
  const active=controller;controller=null;active?.abort();
  stopTextSearch(true);clearTimeout(textFilterTimer);textFilterTimer=null;
  currentRows=[];filtered=[];applied=null;appliedText='';phase='idle';
  setStatus('');render();
}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function siteToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}
function updateDateBounds(){
  const today=siteToday();
  for(const id of ['date-from','date-to']){
    const picker=$(id+'-picker');picker.setAttribute('min',FIRST_UPLOAD_DATE);picker.setAttribute('max',today);
  }
  return today;
}
function syncDates(){
  $('custom-dates').hidden=$('date-preset').value!=='custom';
  for(const id of ['date-from','date-to'])$(id+'-picker').value=validDate($(id).value.trim())?$(id).value.trim():'';
  if($('custom-dates').hidden)closeDateCalendar();else if(dateCalendar?.matches(':popover-open'))renderDateCalendar();
}
let dateCalendar=null,dateCalendarField='',dateCalendarFocus='';
function closeDateCalendar(restoreFocus=false){
  if(!dateCalendar?.matches(':popover-open'))return;
  dateCalendar.hidePopover();
  if(restoreFocus&&!appExiting)$(dateCalendarField+'-open').focus({preventScroll:true});
}
function positionDateCalendar(){
  if(!dateCalendar?.matches(':popover-open'))return;
  const anchor=$(dateCalendarField+'-open'),rect=anchor.getBoundingClientRect(),edge=12,gap=8;
  const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;
  const ceiling=Math.max(edge,(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+gap);
  if(appExiting||!anchor.isConnected||$('custom-dates').hidden||rect.bottom<=ceiling||rect.top>=height-edge){closeDateCalendar();return;}
  dateCalendar.style.width=Math.min(320,Math.max(1,width-edge*2))+'px';dateCalendar.style.maxHeight=Math.max(1,height-ceiling-edge)+'px';
  let box=dateCalendar.getBoundingClientRect();
  const below=height-edge-rect.bottom-gap,above=rect.top-gap-ceiling,down=below>=box.height||below>=above;
  dateCalendar.style.maxHeight=Math.max(1,down?below:above)+'px';box=dateCalendar.getBoundingClientRect();
  dateCalendar.style.left=Math.max(edge,Math.min(rect.left,width-edge-box.width))+'px';
  dateCalendar.style.top=Math.max(ceiling,Math.min(down?rect.bottom+gap:rect.top-gap-box.height,height-edge-box.height))+'px';
}
function moveDateCalendar(days=0,months=0,focus=true){
  if(appExiting)return;
  const date=new Date(dateCalendarFocus+'T00:00:00Z'),day=date.getUTCDate(),today=updateDateBounds();
  if(months){
    date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
    date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));
  }
  date.setUTCDate(date.getUTCDate()+days);
  const value=date.toISOString().slice(0,10);dateCalendarFocus=value<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:value>today?today:value;
  renderDateCalendar(focus);
}
function chooseCalendarDate(value){
  if(appExiting||!dateCalendar?.matches(':popover-open'))return;
  if(value&&(!validDate(value)||value<FIRST_UPLOAD_DATE||value>updateDateBounds()))return;
  $(dateCalendarField).value=value;$('date-preset').value='custom';
  syncDates();syncFilters();closeDateCalendar(true);
}
function renderDateCalendar(focus=false){
  if(!dateCalendar||!dateCalendarField)return;
  const restoreFocus=focus||dateCalendar.contains(document.activeElement)&&document.activeElement.classList.contains('calendar-day');
  const today=updateDateBounds(),date=new Date(dateCalendarFocus+'T00:00:00Z'),year=date.getUTCFullYear(),month=date.getUTCMonth(),monthKey=dateCalendarFocus.slice(0,7);
  const from=$('date-from').value.trim(),to=$('date-to').value.trim(),selected=$(dateCalendarField).value.trim();
  const hasRange=validDate(from)&&validDate(to)&&from>=FIRST_UPLOAD_DATE&&to<=today&&from<=to;
  uiText(dateCalendar.querySelector('.calendar-context'),m(dateCalendarField==='date-from'?'Choose start date':'Choose end date'));
  const yearSelect=dateCalendar.querySelector('.calendar-year'),monthSelect=dateCalendar.querySelector('.calendar-month');
  yearSelect.replaceChildren();monthSelect.replaceChildren();
  for(let value=Number(FIRST_UPLOAD_DATE.slice(0,4));value<=Number(today.slice(0,4));value++){
    const option=element('option',String(value));option.value=String(value);yearSelect.append(option);
  }
  const monthLabel=new Intl.DateTimeFormat(uiLanguage,{month:'long',timeZone:'UTC'});
  for(let value=0;value<12;value++){
    const key=year+'-'+String(value+1).padStart(2,'0'),option=element('option',monthLabel.format(new Date(Date.UTC(year,value,1))));
    option.value=String(value);option.disabled=key<FIRST_UPLOAD_DATE.slice(0,7)||key>today.slice(0,7);monthSelect.append(option);
  }
  yearSelect.value=String(year);monthSelect.value=String(month);
  const nav=dateCalendar.querySelectorAll('.calendar-nav');nav[0].disabled=monthKey<=FIRST_UPLOAD_DATE.slice(0,7);nav[1].disabled=monthKey>=today.slice(0,7);
  const weekdays=dateCalendar.querySelector('.calendar-weekdays'),days=dateCalendar.querySelector('.calendar-days');weekdays.replaceChildren();days.replaceChildren();
  const weekdayLabel=new Intl.DateTimeFormat(uiLanguage,{weekday:'short',timeZone:'UTC'}),fullLabel=new Intl.DateTimeFormat(uiLanguage,{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
  date.setUTCDate(1);date.setUTCDate(1-(date.getUTCDay()+6)%7);
  for(let index=0;index<42;index++,date.setUTCDate(date.getUTCDate()+1)){
    if(index<7)weekdays.append(element('span',weekdayLabel.format(date)));
    const value=date.toISOString().slice(0,10),button=element('button',String(date.getUTCDate()),'calendar-day');
    button.type='button';button.dataset.date=value;button.disabled=value<FIRST_UPLOAD_DATE||value>today;button.tabIndex=value===dateCalendarFocus?0:-1;
    button.setAttribute('aria-label',fullLabel.format(date));button.setAttribute('aria-pressed',String(value===selected));
    button.classList.toggle('is-outside',date.getUTCMonth()!==month);button.classList.toggle('is-today',value===today);
    button.classList.toggle('is-in-range',hasRange&&value>=from&&value<=to);
    button.classList.toggle('is-range-start',hasRange&&value===from);button.classList.toggle('is-range-end',hasRange&&value===to);
    if(value===today)button.setAttribute('aria-current','date');days.append(button);
  }
  positionDateCalendar();
  if(restoreFocus&&dateCalendar.matches(':popover-open'))days.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
}
function ensureDateCalendar(){
  if(dateCalendar)return dateCalendar;
  const panel=element('div',undefined,'date-calendar');dateCalendar=panel;
  panel.id='date-calendar';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','date-calendar-context');
  const context=element('p',undefined,'calendar-context');context.id='date-calendar-context';context.setAttribute('aria-live','polite');
  const header=element('div',undefined,'calendar-header'),selects=element('div',undefined,'calendar-selects');
  const year=element('select',undefined,'calendar-year'),month=element('select',undefined,'calendar-month');
  uiAttr(year,'aria-label',m('Year'));uiAttr(month,'aria-label',m('Month'));
  year.addEventListener('change',()=>moveDateCalendar(0,(Number(year.value)-Number(dateCalendarFocus.slice(0,4)))*12,false));
  month.addEventListener('change',()=>moveDateCalendar(0,Number(month.value)-Number(dateCalendarFocus.slice(5,7))+1,false));
  selects.append(year,month);
  for(const offset of [-1,1]){
    const button=element('button',undefined,'calendar-nav');button.type='button';button.append(icon(offset<0?'left':'right'));
    uiAttr(button,'aria-label',m(offset<0?'Previous month':'Next month'));button.addEventListener('click',()=>moveDateCalendar(0,offset));
    header.append(button);if(offset<0)header.append(selects);
  }
  const weekdays=element('div',undefined,'calendar-weekdays'),days=element('div',undefined,'calendar-days'),footer=element('div',undefined,'calendar-footer');
  weekdays.setAttribute('aria-hidden','true');
  const today=element('button',m('Today'),'calendar-today'),clear=element('button',m('Clear date'),'calendar-clear');today.type='button';clear.type='button';
  today.addEventListener('click',()=>chooseCalendarDate(siteToday()));clear.addEventListener('click',()=>chooseCalendarDate(''));
  footer.append(today,clear);panel.append(context,header,weekdays,days,footer);
  days.addEventListener('click',event=>{const button=event.target.closest('.calendar-day');if(button&&!button.disabled)chooseCalendarDate(button.dataset.date);});
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDateCalendar(true);return;}
    if(!event.target.classList.contains('calendar-day')||event.altKey||event.ctrlKey||event.metaKey)return;
    dateCalendarFocus=event.target.dataset.date;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseCalendarDate(dateCalendarFocus);return;}
    const weekday=(new Date(dateCalendarFocus+'T00:00:00Z').getUTCDay()+6)%7,offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};
    if(event.key in offsets){event.preventDefault();moveDateCalendar(offsets[event.key]);}
    else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();moveDateCalendar(0,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1));}
  });
  panel.addEventListener('toggle',()=>{for(const id of ['date-from','date-to'])$(id+'-open').setAttribute('aria-expanded',String(panel.matches(':popover-open')&&dateCalendarField===id));});
  globalThis.addEventListener?.('resize',positionDateCalendar);
  globalThis.addEventListener?.('scroll',event=>{if(!panel.contains(event.target))positionDateCalendar();},{capture:true,passive:true});
  return panel;
}
function openDatePicker(id){
  if(appExiting)return;
  const today=updateDateBounds(),picker=$(id+'-picker'),value=$(id).value.trim();picker.value=validDate(value)?value:'';
  if(dateCalendar?.matches(':popover-open')&&dateCalendarField===id){closeDateCalendar(true);return;}
  dateCalendarField=id;dateCalendarFocus=!validDate(value)||value>today?today:value<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:value;
  const panel=ensureDateCalendar(),control=$(id+'-open').closest('.date-control');
  if(panel.parentElement!==control.parentElement){closeDateCalendar();control.after(panel);}
  renderDateCalendar();
  if(!panel.matches(':popover-open'))panel.showPopover();positionDateCalendar();
  for(const field of ['date-from','date-to'])$(field+'-open').setAttribute('aria-expanded',String(panel.matches(':popover-open')&&field===id));
  panel.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
}
function presetDates(preset,today=siteToday()){
  if(preset==='all')return {from:'',to:''};
  if(!validDate(today))throw new Error('Invalid calendar date');
  const date=new Date(today+'T00:00:00Z');
  if(preset==='month'||preset==='quarter'){
    const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-(preset==='month'?1:3));
    const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last)+1);
  }else if(['1','2','7'].includes(preset))date.setUTCDate(date.getUTCDate()-Number(preset)+1);
  else throw new Error('Unknown date preset');
  const from=date.toISOString().slice(0,10);return {from:from<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:from,to:today};
}
function applyDatePreset(){
  updateDateBounds();
  if($('date-preset').value!=='custom'){
    const range=presetDates($('date-preset').value);$('date-from').value=range.from;$('date-to').value=range.to;
  }
  syncDates();syncFilters();
}
function titleKey(value){return String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function remember(cache,key,value,limit=128,maxLength=65536){
  // Bound each entry and the number retained; oversized responses are displayed directly.
  if(JSON.stringify(value).length>maxLength)return value;
  cache.delete(key);cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value);return value;
}
function canSearchUsers(query){return query.length>=2&&query.length<=80&&(query.match(/[\p{L}\p{N}]/ug)||[]).length>=2&&!/[%*]/.test(query);}
function unknownSearchUploaders(){return currentRows.some(row=>row[8].uploader&&!profileCache.has(row[8].uploader));}
function needsUserSearch(query){return phase==='ready'&&searchScopes.has('creator')&&canSearchUsers(query)&&!userSearchCache.has(query)&&unknownSearchUploaders();}
function syncSearchControls(){
  $('search-clear').hidden=!$('local-search').value;
  for(const field of Object.keys(searchFields)){
    const button=$('search-scope-'+field),selected=searchScopes.has(field),last=selected&&searchScopes.size===1;
    button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-disabled',String(last));
  }
  const query=titleKey($('local-search').value),active=phase==='ready'&&searchScopes.has('creator')&&Boolean(query);
  const message=!active?'':textSearchWork?m('Searching uploader accounts...'):textSearchProblem||(!canSearchUsers(query)&&unknownSearchUploaders()?m('For uploader accounts, enter 2–80 characters with at least two letters or digits, without % or *.'):'');
  uiText($('search-message'),message);$('search-feedback').hidden=!message;$('search-feedback').classList.toggle('is-error',Boolean(textSearchProblem));$('search-retry').hidden=!active||!textSearchProblem;
  loadingIndicator($('search-message'),active&&Boolean(textSearchWork));
}
// Tag matching uses only the catalog already returned by searchCharts.
// Never fetch /api/song/{id}: the site's detail endpoint increments views.
function tagKey(value){return String(value??'').trim().toLowerCase();}
function cleanTags(value){
  const tags=new Map();
  for(const tag of Array.isArray(value)?value:[])if(typeof tag==='string'&&tag.trim()&&!tags.has(tagKey(tag)))tags.set(tagKey(tag),tag.trim());
  return [...tags.values()];
}
function rowsMatchingTags(rows,selection=selectedTags){
  if(!selection.size)return rows;
  const required=[...selection.keys()];
  return rows.filter(row=>{const tags=new Set((row[8].tags||[]).map(tagKey));return required.every(key=>tags.has(key));});
}
function countTagResults(rows){
  const counts=new Map();
  for(const row of rows)for(const key of new Set((row[8].tags||[]).map(tagKey)))counts.set(key,(counts.get(key)||0)+1);
  return counts;
}
function indexCatalogTags(data){
  tagCatalog.clear();
  for(const song of data)for(const tag of cleanTags(song?.tags))if(!tagCatalog.has(tagKey(tag)))tagCatalog.set(tagKey(tag),tag);
}
function tagFilterReady(){return phase==='ready'&&Boolean(applied)&&!appExiting;}
function positionTagPanel(panel,anchor){
  if(!anchor||!panel.matches(':popover-open'))return;
  const rect=anchor.getBoundingClientRect(),top=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||60;
  if(!anchor.isConnected||rect.bottom<top||rect.top>innerHeight){panel.hidePopover();return;}
  const width=panel.offsetWidth,height=panel.offsetHeight;
  panel.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';
  panel.style.top=Math.max(top+8,Math.min(rect.bottom+8,innerHeight-height-12))+'px';
}
function tagChip(key,name){
  const chip=element('span',undefined,'selected-tag'),label=element('span',name,'selected-tag-name'),remove=element('button',undefined,'selected-tag-remove');
  chip.dataset.tagKey=key;remove.type='button';uiAttr(remove,'aria-label',m('Remove tag: ')+name);
  remove.append(icon('close'));remove.addEventListener('click',()=>removeTagFilter(key));chip.append(label,remove);return chip;
}
function updateTagOverflow(){
  const strip=$('tag-filter-strip'),container=$('selected-tags'),more=$('tag-more');
  if(strip.hidden)return;
  for(const chip of container.children){chip.style.visibility='';chip.inert=false;chip.removeAttribute('aria-hidden');}
  more.hidden=true;
  if(container.scrollWidth<=container.clientWidth+1)return;
  more.hidden=false;uiText(more,'+'+selectedTags.size);
  const edge=container.getBoundingClientRect().right;let hidden=0;
  for(const chip of container.children)if(chip.getBoundingClientRect().right>edge+1){chip.style.visibility='hidden';chip.inert=true;chip.setAttribute('aria-hidden','true');hidden++;}
  more.hidden=!hidden;uiText(more,'+'+hidden);
}
function syncTagControls(){
  const ready=tagFilterReady(),strip=$('tag-filter-strip'),signature=JSON.stringify([...selectedTags]);
  $('tag-add-open').disabled=!ready;strip.hidden=!ready||!selectedTags.size;strip.inert=!ready;
  if(signature!==tagStripSignature){
    tagStripSignature=signature;$('selected-tags').replaceChildren();$('selected-tag-popover-content').replaceChildren();
    for(const [key,name] of selectedTags){$('selected-tags').append(tagChip(key,name));$('selected-tag-popover-content').append(tagChip(key,name));}
    refreshChartTagButtons();
  }
  if(!ready){for(const id of ['tag-picker','selected-tag-popover'])if($(id).matches(':popover-open'))$(id).hidePopover();dismissChartTags();}
  if(strip.hidden&&$('selected-tag-popover').matches(':popover-open'))$('selected-tag-popover').hidePopover();
  updateTagOverflow();
  if($('tag-picker').matches(':popover-open'))renderTagCandidates();
  positionTagPanel($('selected-tag-popover'),$('tag-more'));
}
function renderTagCandidates(){
  const query=tagKey($('tag-input').value),previous=tagCandidates[tagCandidateIndex]?.key;
  tagCandidates=[...tagCatalog].filter(([key])=>!selectedTags.has(key)&&(!query||key.includes(query)))
    .map(([key,name])=>({key,name,count:tagResultCounts.get(key)||0}))
    .sort((a,b)=>Number(b.key.startsWith(query))-Number(a.key.startsWith(query))||b.count-a.count||a.name.localeCompare(b.name,uiLanguage)).slice(0,30);
  tagCandidateIndex=previous?tagCandidates.findIndex(item=>item.key===previous):-1;
  const pending=Boolean(textSearchWork),list=$('tag-candidates');list.replaceChildren();
  for(const [index,item] of tagCandidates.entries()){
    const button=element('button',undefined,'tag-candidate'),label=element('span',item.name,'tag-candidate-name'),count=element('small',pending?m('Counting...'):number(item.count)+m(' results'),'tag-candidate-count');
    button.type='button';button.id='tag-candidate-'+index;button.setAttribute('role','option');button.tabIndex=-1;button.setAttribute('aria-selected',String(index===tagCandidateIndex));
    button.append(label,count);button.addEventListener('pointerdown',event=>event.preventDefault());
    button.addEventListener('click',()=>{if(addTagFilter(item.name,button)){$('tag-input').value='';tagCandidateIndex=-1;renderTagCandidates();$('tag-input').focus({preventScroll:true});}});
    list.append(button);
  }
  if(tagCandidateIndex>=0)$('tag-input').setAttribute('aria-activedescendant','tag-candidate-'+tagCandidateIndex);else $('tag-input').removeAttribute('aria-activedescendant');
  uiText($('tag-picker-feedback'),tagCandidates.length?m('Counts include the current search and all selected tags.'):query?m('No matching tag. Choose an existing tag.'):m('No more tags available.'));
  positionTagPanel($('tag-picker'),tagPickerAnchor);
}
function openTagPicker(anchor){
  if(!tagFilterReady())return;
  dismissChartTags();tagPickerAnchor=anchor;
  if($('selected-tag-popover').matches(':popover-open'))$('selected-tag-popover').hidePopover();
  $('tag-input').value='';tagCandidateIndex=-1;
  if(!$('tag-picker').matches(':popover-open'))$('tag-picker').showPopover();
  renderTagCandidates();$('tag-input').focus({preventScroll:true});
}
function captureTagAnchor(source){
  if(scrollY<10)return null;
  let view=cardViews.get(Number(source?.dataset.chartId));
  if(!view){const top=$('tag-filter-strip').hidden?60:$('tag-filter-strip').getBoundingClientRect().bottom;view=[...cardViews.values()].find(item=>{const rect=item.card.getBoundingClientRect();return rect.bottom>top&&rect.top<innerHeight;});}
  return view?{id:view.row[0],top:view.card.getBoundingClientRect().top}:null;
}
function captureTagViewport(){return {viewport:true,left:scrollX,top:scrollY,page,visibleCount};}
function tagFlightTarget(key){
  const chip=[...$('selected-tags').children].find(node=>node.dataset.tagKey===key&&!node.inert);
  return chip||(!$('tag-more').hidden?$('tag-more'):$('tag-filter-strip'));
}
function pulseTag(key){const target=tagFlightTarget(key);if(!target.hidden)playMotion(target,[{filter:'brightness(1)'},{filter:'brightness(1.8)'},{filter:'brightness(1)'}],{duration:MOTION_MS.panel});}
function flyTag(name,rect,key){
  if(!rect||!motionAllowed()){pulseTag(key);return;}
  const target=tagFlightTarget(key).getBoundingClientRect(),ghost=element('div',name,'tag-flight');
  ghost.setAttribute('aria-hidden','true');ghost.setAttribute('popover','manual');ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';document.body.append(ghost);ghost.showPopover();
  const dx=target.left+target.width/2-rect.left-ghost.offsetWidth/2,dy=target.top+target.height/2-rect.top-ghost.offsetHeight/2;
  const animation=playMotion(ghost,[{transform:'translate(0,0) scale(1)',opacity:.95},{transform:'translate('+(dx*.45+20)+'px,'+(dy*.55-18)+'px) scale(.98)',opacity:.9,offset:.5},{transform:'translate('+dx+'px,'+dy+'px) scale(.7)',opacity:.3}],{duration:MOTION_MS.expressive});
  const finish=()=>{ghost.remove();if(selectedTags.has(key))pulseTag(key);};
  if(animation)animation.finished.then(finish,finish);else finish();
}
function addTagFilter(value,source){
  if(!tagFilterReady())return false;
  const key=tagKey(value);
  if(selectedTags.has(key)){pulseTag(key);return false;}
  const name=tagCatalog.get(key);if(!name)return false;
  const rect=source?.getBoundingClientRect(),anchor=source?.dataset?.chartId?captureTagAnchor(source):captureTagViewport();
  selectedTags.set(key,name);dismissChartTags();pendingTagAnchor=anchor;
  rebuild();flyTag(name,rect,key);return true;
}
function removeTagFilter(key){
  if(!tagFilterReady()||!selectedTags.has(key))return;
  const panel=$('selected-tag-popover'),inPanel=panel.contains(document.activeElement),area=$(inPanel?'selected-tag-popover-content':'selected-tags');
  const index=[...area.children].findIndex(chip=>chip.dataset.tagKey===key);
  pendingTagAnchor=captureTagViewport();selectedTags.delete(key);rebuild();
  const next=area.children[Math.min(index,area.children.length-1)],available=inPanel?panel.matches(':popover-open'):next&&!next.inert;
  const target=available?next?.querySelector('button'):$('tag-filter-strip').hidden?$('tag-add-open'):$('tag-add-sticky');
  if(!document.activeElement?.isConnected||document.activeElement===document.body)target.focus({preventScroll:true});
}
function clearTagFilters(){
  if(!tagFilterReady()||!selectedTags.size)return;
  pendingTagAnchor=captureTagViewport();selectedTags.clear();rebuild();$('tag-add-open').focus({preventScroll:true});
}
function prepareTagAnchor(ready,continuous){
  if(tagViewportFrame!==null){cancelAnimationFrame(tagViewportFrame);tagViewportFrame=null;}
  document.documentElement.classList.remove('tag-viewport-update');
  const anchor=pendingTagAnchor;if(!anchor)return;
  if(anchor.viewport){
    // Removing a constraint preserves the viewport, even when existing cards move to another page.
    document.documentElement.classList.add('tag-viewport-update');
    page=anchor.page;visibleCount=Math.max(visibleCount,anchor.visibleCount);return;
  }
  if(!ready)return;
  const index=filtered.findIndex(row=>row[0]===anchor.id);
  if(index>=0){if(continuous)visibleCount=Math.max(visibleCount,Math.ceil((index+1)/scrollBatchSize)*scrollBatchSize);else page=Math.floor(index/pageSize())+1;}
}
function restoreTagAnchor(){
  const anchor=pendingTagAnchor;if(!anchor)return;pendingTagAnchor=null;
  if(anchor.viewport){
    const restore=()=>scrollTo({left:anchor.left,top:anchor.top,behavior:'instant'});
    restore();
    tagViewportFrame=requestAnimationFrame(()=>{
      restore();document.documentElement.classList.remove('tag-viewport-update');tagViewportFrame=null;
    });
    return;
  }
  const card=cardViews.get(anchor.id)?.card;
  if(card)scrollBy({top:card.getBoundingClientRect().top-anchor.top,behavior:'instant'});
  else{
    const first=$('rows').firstElementChild||$('empty'),offset=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||60)+($('tag-filter-strip').hidden?0:$('tag-filter-strip').offsetHeight)+14;
    scrollBy({top:first.getBoundingClientRect().top-offset,behavior:'instant'});
  }
}
function setupTagFilters(){
  for(const id of ['tag-add-open','tag-add-sticky'])$(id).addEventListener('click',()=>openTagPicker($(id)));
  $('tag-picker-close').addEventListener('click',()=>{$('tag-picker').hidePopover();tagPickerAnchor?.focus({preventScroll:true});});
  $('tag-picker').addEventListener('toggle',event=>{if(event.newState==='closed')tagPickerAnchor?.setAttribute('aria-expanded','false');else tagPickerAnchor?.setAttribute('aria-expanded','true');});
  $('tag-input').addEventListener('input',()=>{tagCandidateIndex=-1;renderTagCandidates();});
  $('tag-input').addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!tagCandidates.length)return;
      tagCandidateIndex=(tagCandidateIndex+(event.key==='ArrowDown'?1:-1)+tagCandidates.length)%tagCandidates.length;
      for(const [index,node] of [...$('tag-candidates').children].entries())node.setAttribute('aria-selected',String(index===tagCandidateIndex));
      $('tag-input').setAttribute('aria-activedescendant','tag-candidate-'+tagCandidateIndex);$('tag-candidates').children[tagCandidateIndex]?.scrollIntoView({block:'nearest'});return;
    }
    if(event.key==='Enter'){
      event.preventDefault();const candidate=tagCandidates[tagCandidateIndex],name=candidate?.name||tagCatalog.get(tagKey($('tag-input').value));
      if(name&&addTagFilter(name,candidate?$('tag-candidates').children[tagCandidateIndex]:$('tag-input'))){$('tag-input').value='';tagCandidateIndex=-1;renderTagCandidates();}
      else if(!name)uiText($('tag-picker-feedback'),m('Choose a suggested tag, or enter its complete name.'));
    }
  });
  $('tag-clear').addEventListener('click',clearTagFilters);
  $('tag-more').addEventListener('click',()=>{const panel=$('selected-tag-popover');if(panel.matches(':popover-open'))panel.hidePopover();else{panel.showPopover();positionTagPanel(panel,$('tag-more'));panel.querySelector('button')?.focus({preventScroll:true});}});
  $('selected-tag-popover').addEventListener('toggle',event=>$('tag-more').setAttribute('aria-expanded',String(event.newState==='open')));
  $('selected-tag-popover').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('selected-tag-popover').hidePopover();(!$('tag-more').hidden?$('tag-more'):$('tag-add-open')).focus({preventScroll:true});}});
  let frame=null;
  const reposition=()=>{if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;positionTagPanel($('tag-picker'),tagPickerAnchor);positionTagPanel($('selected-tag-popover'),$('tag-more'));});};
  const resize=()=>{updateTagOverflow();reposition();};
  globalThis.addEventListener('scroll',reposition,{passive:true});globalThis.addEventListener('resize',resize);
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resize);observer.observe($('tag-filter-strip'));}
  document.fonts?.ready?.then(updateTagOverflow);
}
function stopTextSearch(clear=false){const work=textSearchWork;textSearchWork=null;work?.controller.abort();if(clear)textSearchProblem='';}
function scopeSearchUsers(users,rows){const ids=new Set(rows.map(row=>row[8].uploader));for(const user of users)if(ids.has(user.id))remember(profileCache,user.id,user,2048);}
function startTextSearch(query){
  if(textSearchWork||textSearchProblem||!needsUserSearch(query))return;
  const work={controller:new AbortController(),query,rows:currentRows,generation:cacheGeneration,promise:null};textSearchWork=work;
  work.promise=(async()=>{
    try{const users=await readUserSearch(query,work.controller.signal);if(textSearchWork===work)scopeSearchUsers(users,currentRows);}
    catch{if(textSearchWork===work)textSearchProblem=m('Uploader search failed. Please retry.');}
    finally{if(textSearchWork===work){textSearchWork=null;await rebuild(false);}}
  })();
}
function changeSearchScope(field){
  if(searchScopes.has(field)){if(searchScopes.size===1)return;searchScopes.delete(field);}else searchScopes.add(field);
  textSearchProblem='';if(!searchScopes.has('creator'))stopTextSearch();
  syncSearchControls();if(phase!=='ready'||!titleKey($('local-search').value))return;
  rebuild(false);
  if(!textSearchWork&&needsUserSearch(titleKey($('local-search').value)))textFilterTimer=setTimeout(()=>{textFilterTimer=null;rebuild();},300);
}
function resetFilters(){
  selectedTags.clear();pendingTagAnchor=null;
  lastAppliedCriteria=null;cancelQuery();$('local-search').value='';$('min').value='0';$('max').value='99';
  for(const field of Object.keys(searchFields))searchScopes.add(field);
  for(const input of document.querySelectorAll('input[name="diff"]'))input.checked=input.value==='4';
  $('date-preset').value='7';applyDatePreset();$('sort').value='date';$('sort-direction').value='desc';syncSearchControls();syncFilters();
}
function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)uiText(el,text);if(className)el.className=className;return el;}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');use.setAttribute('href','#icon-'+name);svg.append(use);return svg;}
const choiceMenus=new Map();
let choiceMenuFrame=null;
function choiceSelectOptions(select){return Array.from(select.options||select.querySelectorAll('option'));}
function choiceSelectedOption(select){return choiceSelectOptions(select).find(option=>option.value===select.value)||choiceSelectOptions(select)[0]||null;}
function choiceLabel(select){
  const ids=(select.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean),text=ids.map(id=>$(id)?.textContent?.trim()).filter(Boolean).join(' ');
  return text||select.getAttribute('aria-label')||'';
}
function choiceMenuHost(select){
  for(let node=select.parentNode;node;node=node.parentNode)if(node.matches?.('dialog,[popover]'))return node;
  return document.body;
}
function renderChoiceMenu(view){
  const {select,menu}=view,selected=choiceSelectedOption(select);menu.replaceChildren();
  for(const option of choiceSelectOptions(select)){
    const button=element('button',undefined,'choice-option');button.type='button';button.setAttribute('role','option');button.dataset.value=option.value;
    button.disabled=option.disabled;button.setAttribute('aria-selected',String(option===selected));button.classList.toggle('is-selected',option===selected);
    button.append(element('span',option.textContent,'choice-option-label'),icon('check'));
    button.addEventListener('click',()=>chooseChoice(view,option.value));menu.append(button);
  }
}
function syncChoiceMenu(view,rebuild=false){
  const {select,button,value,menu}=view,selected=choiceSelectedOption(select),label=choiceLabel(select);
  button.disabled=select.disabled;button.setAttribute('aria-busy',select.getAttribute('aria-busy')||'false');
  const describedBy=select.getAttribute('aria-describedby');if(describedBy)button.setAttribute('aria-describedby',describedBy);else button.removeAttribute('aria-describedby');
  value.textContent=selected?.textContent||'';menu.setAttribute('aria-label',label);
  if(select.getAttribute('aria-labelledby'))button.setAttribute('aria-labelledby',select.getAttribute('aria-labelledby')+' '+value.id);
  else button.setAttribute('aria-label',[label,value.textContent].filter(Boolean).join(': '));
  if(button.disabled&&menu.matches(':popover-open'))menu.hidePopover();
  if(rebuild||menu.matches(':popover-open'))renderChoiceMenu(view);
}
function syncChoiceMenus(rebuild=false){for(const view of choiceMenus.values())syncChoiceMenu(view,rebuild);}
function positionChoiceMenu(view){
  if(!view?.menu.matches(':popover-open'))return;
  const {button,menu}=view,rect=button.getBoundingClientRect(),edge=12,gap=7,available=Math.max(160,globalThis.innerWidth-edge*2);
  menu.style.width='max-content';menu.style.maxHeight=Math.max(120,globalThis.innerHeight-edge*2)+'px';
  const natural=Math.ceil(menu.getBoundingClientRect().width),width=Math.min(available,Math.max(rect.width,natural));menu.style.width=width+'px';
  const height=menu.getBoundingClientRect().height,below=rect.bottom+gap,above=rect.top-gap-height;
  menu.style.left=Math.max(edge,Math.min(rect.left,globalThis.innerWidth-width-edge))+'px';
  menu.style.top=(below+height<=globalThis.innerHeight-edge||above<edge?Math.min(below,globalThis.innerHeight-height-edge):above)+'px';
}
function focusChoiceOption(view,edge=0){
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)'));if(!options.length)return;
  const selected=options.find(option=>option.getAttribute('aria-selected')==='true'),target=edge<0?options.at(-1):edge>0?options[0]:selected||options[0];target.focus({preventScroll:true});
}
function openChoice(view,focus=0){
  if(view.button.disabled)return false;
  renderChoiceMenu(view);if(!view.menu.matches(':popover-open'))view.menu.showPopover();view.button.setAttribute('aria-expanded','true');positionChoiceMenu(view);
  if(focus!==null)queueMicrotask(()=>focusChoiceOption(view,focus));return true;
}
function closeChoice(view,restoreFocus=false){
  if(view.menu.matches(':popover-open'))view.menu.hidePopover();view.button.setAttribute('aria-expanded','false');
  if(restoreFocus)view.button.focus({preventScroll:true});
}
function chooseChoice(view,value){
  const option=choiceSelectOptions(view.select).find(item=>item.value===value&&!item.disabled);if(!option)return;
  const changed=view.select.value!==value;view.select.value=value;closeChoice(view,true);syncChoiceMenu(view);
  if(changed)view.select.dispatchEvent(new Event('change',{bubbles:true}));
}
function moveChoiceFocus(view,key){
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)'));if(!options.length)return;
  if(key==='Home'||key==='End'){options[key==='Home'?0:options.length-1].focus({preventScroll:true});return;}
  const current=options.indexOf(document.activeElement),offset=key==='ArrowUp'?-1:1,index=current<0?(offset<0?options.length-1:0):(current+offset+options.length)%options.length;
  options[index].focus({preventScroll:true});
}
function moveChoiceTab(view,backwards=false){
  const candidates=Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(node=>{
    if(node===view.select||view.menu.contains(node)||node.disabled||node.hidden||node.getAttribute('aria-hidden')==='true'||node.tabIndex<0)return false;
    for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.hidden||parent.inert)return false;
    return true;
  });
  const index=candidates.indexOf(view.button),target=candidates[index+(backwards?-1:1)];closeChoice(view);
  (target||view.button).focus({preventScroll:true});
}
function choiceTypeahead(view,key){
  clearTimeout(view.typeTimer);const letter=key.toLocaleLowerCase(uiLanguage);
  view.typeQuery=view.typeQuery.length===1&&view.typeQuery===letter?letter:(view.typeQuery+letter).toLocaleLowerCase(uiLanguage);
  view.typeTimer=setTimeout(()=>{view.typeQuery='';view.typeTimer=null;},650);
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)')),start=Math.max(0,options.indexOf(document.activeElement));
  const ordered=[...options.slice(start+1),...options.slice(0,start+1)],match=ordered.find(option=>option.textContent.trim().toLocaleLowerCase(uiLanguage).startsWith(view.typeQuery));match?.focus({preventScroll:true});
}
function enhanceChoiceSelect(select){
  if(!select||choiceMenus.has(select))return choiceMenus.get(select);
  const shell=element('span',undefined,'choice-shell'),button=element('button',undefined,'choice-trigger'),value=element('span',undefined,'choice-value'),menu=element('div',undefined,'choice-menu');
  const id=select.id||'choice-'+(choiceMenus.size+1);value.id=id+'-choice-value';menu.id=id+'-choice-menu';button.type='button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',menu.id);button.setAttribute('popovertarget',menu.id);menu.setAttribute('popover','auto');menu.setAttribute('role','listbox');menu.tabIndex=-1;
  select.parentNode.insertBefore(shell,select);shell.append(select,button);button.append(value,icon('down'));
  choiceMenuHost(select).append(menu);select.classList.add('choice-menu-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.hidden=true;
  const view={select,shell,button,value,menu,typeQuery:'',typeTimer:null,observer:null};choiceMenus.set(select,view);
  button.addEventListener('click',event=>{event.preventDefault();if(menu.matches(':popover-open'))closeChoice(view);else openChoice(view,null);});
  button.addEventListener('keydown',event=>{
    if(['Enter',' '].includes(event.key)){event.preventDefault();if(menu.matches(':popover-open'))closeChoice(view,true);else openChoice(view,0);return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openChoice(view,event.key==='ArrowUp'?-1:1);}
  });
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeChoice(view,true);return;}
    if(event.key==='Tab'){event.preventDefault();moveChoiceTab(view,event.shiftKey);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();moveChoiceFocus(view,event.key);return;}
    if(event.key!==' '&&event.key.length===1&&!event.altKey&&!event.ctrlKey&&!event.metaKey)choiceTypeahead(view,event.key);
  });
  menu.addEventListener('toggle',event=>{const open=event.newState==='open';button.setAttribute('aria-expanded',String(open));button.classList.toggle('is-open',open);if(open)positionChoiceMenu(view);});
  select.addEventListener('change',()=>syncChoiceMenu(view));
  if(typeof MutationObserver==='function'){
    view.observer=new MutationObserver(()=>syncChoiceMenu(view,true));
    view.observer.observe(select,{attributes:true,attributeFilter:['disabled','aria-busy','aria-describedby','aria-label','aria-labelledby']});
  }
  syncChoiceMenu(view,true);return view;
}
function setupChoiceMenus(){
  for(const select of document.querySelectorAll('select[data-choice-menu]'))enhanceChoiceSelect(select);
  const reposition=()=>{if(choiceMenuFrame!==null)return;choiceMenuFrame=requestAnimationFrame(()=>{choiceMenuFrame=null;for(const view of choiceMenus.values())positionChoiceMenu(view);});};
  globalThis.addEventListener?.('resize',reposition);globalThis.addEventListener?.('scroll',reposition,{capture:true,passive:true});
}
function countValue(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
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
  if(user.id){link.href='https://spinsha.re/user/'+user.id;link.target='_blank';link.rel='noopener noreferrer';}
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
let previewTrack=null,previewState='idle',previewFormat='ogg',previewExpectedSource='',previewGeneration=0,previewPlayAttempt=0,previewReady=false,previewWantsPlay=false,previewHasPlayed=false,previewFrame=0,previewSourceTimer=null,previewSourceCleanup=null,previewCoverToken=0,previewArtworkSlot=0,previewArtworkMotions=[],previewLastAnnouncement='',previewRenderedSecond=-1,previewRenderedLimit=-1,previewShortcutPending=0,previewShortcutTimer=null,previewShortcutHintShown=APP_CONFIG.playerShortcutHintShown,previewHintTimer=null,previewHintMotion=null;
function chartPreviewReference(row){
  const value=String(row?.[8]?.previewReference||row?.[8]?.fileReference||'');return PREVIEW_REFERENCE.test(value)?value:'';
}
function previewSource(reference,format='ogg'){
  return PREVIEW_REFERENCE.test(reference)&&['ogg','mp3'].includes(format)?`https://spinshare.b-cdn.net/uploads/audio/${reference}_0.${format}`:'';
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
  const audio=$('preview-audio'),limit=previewLimit(),position=limit||Math.max(0,Number(audio.currentTime)||0);clearPreviewShortcutFeedback();previewWantsPlay=false;previewState='ended';previewPlayAttempt++;clearPreviewWatchdog();stopPreviewFrame();
  audio.pause();updatePreviewProgress(position,true);syncPreviewInterface();announcePreview('Song finished: ');
}
function previewTick(){
  previewFrame=0;if(!previewTrack||previewState!=='playing'||document.hidden)return;
  const audio=$('preview-audio');
  if(audio.currentTime>0)previewHasPlayed=true;updatePreviewProgress();if(typeof requestAnimationFrame==='function')previewFrame=requestAnimationFrame(previewTick);
}
function startPreviewFrame(){stopPreviewFrame();if(previewState==='playing'&&!document.hidden&&typeof requestAnimationFrame==='function')previewFrame=requestAnimationFrame(previewTick);}
function announcePreview(key){
  if(!previewTrack)return;const signature=key+previewTrack.id;if(signature===previewLastAnnouncement)return;previewLastAnnouncement=signature;uiText($('preview-player-status'),m(key)+previewTrack.title);
}
function clearPreviewShortcutFeedback(clearPending=true){
  if(previewShortcutTimer!==null)clearTimeout(previewShortcutTimer);previewShortcutTimer=null;if(clearPending)previewShortcutPending=0;$('preview-player-toggle')?.classList.remove('is-shortcut-feedback');
}
function showPreviewShortcutFeedback(){
  clearPreviewShortcutFeedback(false);const toggle=$('preview-player-toggle');if(!previewTrack||!toggle)return;toggle.classList.add('is-shortcut-feedback');previewShortcutTimer=setTimeout(()=>{previewShortcutTimer=null;toggle.classList.remove('is-shortcut-feedback');},PREVIEW_SHORTCUT_FEEDBACK_MS);
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
}
function syncPreviewButtons(){for(const view of coverViews.values())syncPreviewButton(view);}
function syncPreviewInterface(){
  const player=$('preview-player');if(!player)return;
  if(!previewTrack){player.hidden=true;syncPreviewButtons();return;}
  player.hidden=false;uiText($('preview-player-title'),previewTrack.title);uiText($('preview-player-artist'),previewTrack.artist||m('Unknown artist'));
  const toggle=$('preview-player-toggle'),active=previewWantsPlay&&['loading','playing'].includes(previewState),loading=previewState==='loading'&&previewWantsPlay;toggle.classList.toggle('is-playing',active);toggle.classList.toggle('is-loading',loading);toggle.classList.toggle('is-error',previewState==='error');toggle.disabled=appExiting;toggle.setAttribute('aria-pressed',String(active));toggle.setAttribute('aria-busy',String(loading));uiAttr(toggle,'aria-label',previewControlLabel());
  player.classList.toggle('is-playing',previewState==='playing');player.classList.toggle('is-error',previewState==='error');player.setAttribute('aria-busy',String(previewState==='loading'));
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
function failPreview(){
  if(!previewTrack)return;clearPreviewShortcutFeedback();previewWantsPlay=false;previewReady=false;previewPlayAttempt++;clearPreviewWatchdog();stopPreviewFrame();$('preview-audio').pause();previewState='error';syncPreviewInterface();announcePreview('Song unavailable: ');
}
function attemptPreviewPlay(token,source,shortcut=false){
  const audio=$('preview-audio'),attempt=++previewPlayAttempt;let work;
  if(shortcut)previewShortcutPending=attempt;
  const current=()=>attempt===previewPlayAttempt&&token===previewGeneration&&source===previewExpectedSource;
  const rejected=error=>{if(!current()||error?.name==='AbortError')return;if(error?.name==='NotSupportedError'){handlePreviewSourceFailure(token,source);return;}if(previewShortcutPending===attempt)previewShortcutPending=0;previewWantsPlay=false;previewState='paused';clearPreviewWatchdog();stopPreviewFrame();audio.pause();syncPreviewInterface();announcePreview('Song paused: ');};
  const accepted=()=>{if(!current()||!previewWantsPlay||previewShortcutPending!==attempt)return;previewShortcutPending=0;showPreviewShortcutFeedback();};
  try{work=audio.play();}catch(error){rejected(error);return;}
  Promise.resolve(work).then(accepted,rejected);
}
function bindPreviewSource(token,source,resumeAt=0){
  const audio=$('preview-audio'),listeners=[],current=()=>token===previewGeneration&&source===previewExpectedSource&&Boolean(previewTrack);
  const on=(name,handler)=>{const wrapped=event=>{if(current())handler(event);};audio.addEventListener(name,wrapped);listeners.push([name,wrapped]);};
  on('loadedmetadata',()=>{previewReady=true;const limit=previewLimit();if(resumeAt>0)try{audio.currentTime=limit>0?Math.min(resumeAt,limit):resumeAt;}catch{}updatePreviewProgress(audio.currentTime,true);syncPreviewInterface();if(resumeAt>0&&previewWantsPlay)attemptPreviewPlay(token,source);});
  on('durationchange',()=>updatePreviewProgress(audio.currentTime,true));
  on('timeupdate',()=>{if(audio.currentTime>0)previewHasPlayed=true;updatePreviewProgress();});
  on('playing',()=>{if(!previewWantsPlay){audio.pause();return;}previewHasPlayed=true;clearPreviewWatchdog();previewState='playing';syncPreviewInterface();startPreviewFrame();announcePreview('Now playing: ');if(previewShortcutPending){previewShortcutPending=0;showPreviewShortcutFeedback();}});
  on('waiting',()=>{if(previewWantsPlay){previewState='loading';stopPreviewFrame();armPreviewWatchdog(token,source);syncPreviewInterface();}});
  on('stalled',()=>{if(previewWantsPlay&&previewState==='loading')armPreviewWatchdog(token,source);});
  on('pause',()=>{stopPreviewFrame();if(!previewWantsPlay&&!['ended','error'].includes(previewState)){clearPreviewWatchdog();previewState='paused';syncPreviewInterface();announcePreview('Song paused: ');}});
  on('ended',finishPreview);on('error',event=>handlePreviewSourceFailure(token,source,event));
  previewSourceCleanup=()=>{for(const [name,handler] of listeners)audio.removeEventListener(name,handler);};
}
function setPreviewSource(format,token,resumeAt=0){
  const source=previewSource(previewTrack?.reference||'',format);if(!source){failPreview();return;}
  const audio=$('preview-audio');previewPlayAttempt++;clearPreviewWatchdog();clearPreviewSourceEvents();audio.pause();audio.removeAttribute('src');audio.load();previewFormat=format;previewExpectedSource=source;previewReady=false;previewState='loading';audio.src=source;bindPreviewSource(token,source,resumeAt);audio.load();syncPreviewInterface();if(previewWantsPlay){armPreviewWatchdog(token,source);if(resumeAt<=0)attemptPreviewPlay(token,source);}
}
function handlePreviewSourceFailure(token,source){
  if(token!==previewGeneration||source!==previewExpectedSource)return;
  clearPreviewWatchdog();
  if(previewFormat==='ogg'){const position=Math.max(0,Number($('preview-audio').currentTime)||0);setPreviewSource('mp3',token,position);return;}failPreview();
}
function startChartPreview(row,force=false){
  const reference=chartPreviewReference(row);if(!reference||appExiting)return false;
  if(!force&&samePreviewTrack(row)){toggleCurrentPreview();return true;}
  const player=$('preview-player'),first=player.hidden;clearPreviewShortcutFeedback();previewGeneration++;previewLastAnnouncement='';previewRenderedSecond=-1;previewRenderedLimit=-1;previewWantsPlay=true;previewReady=false;previewHasPlayed=false;previewState='loading';previewTrack={id:row[0],reference,updateHash:String(row[8]?.updateHash||''),title:row[1],artist:row[3],cover:row[8]?.cover||'',thumbnail:row[8]?.thumbnail||'',row};
  stopPreviewFrame();setPreviewArtwork(previewTrack);syncPreviewInterface();animatePreviewSelection(first);announcePreview('Loading song: ');setPreviewSource('ogg',previewGeneration);showPreviewShortcutHint();return true;
}
function toggleCurrentPreview(origin='control'){
  if(!previewTrack||appExiting)return false;
  if(origin!=='shortcut')clearPreviewShortcutFeedback();
  if(previewState==='error')return startChartPreview(previewTrack.row,true);
  const audio=$('preview-audio');if(previewWantsPlay&&['loading','playing'].includes(previewState)){
    const audible=previewHasPlayed||Number(audio.currentTime)>.01;previewWantsPlay=false;previewPlayAttempt++;previewShortcutPending=0;clearPreviewWatchdog();audio.pause();previewState='paused';syncPreviewInterface();announcePreview('Song paused: ');if(origin==='shortcut'&&audible)showPreviewShortcutFeedback();return true;
  }
  const limit=previewLimit();if(previewState==='ended'||limit>0&&audio.currentTime>=limit-.015){try{audio.currentTime=0;}catch{}updatePreviewProgress(0);}
  previewWantsPlay=true;previewState='loading';armPreviewWatchdog(previewGeneration,previewExpectedSource);syncPreviewInterface();attemptPreviewPlay(previewGeneration,previewExpectedSource,origin==='shortcut');return true;
}
function toggleChartPreview(row){return samePreviewTrack(row)?toggleCurrentPreview():startChartPreview(row);}
function pausePreview(){
  if(!previewTrack||!previewWantsPlay)return;clearPreviewShortcutFeedback();previewWantsPlay=false;previewPlayAttempt++;clearPreviewWatchdog();$('preview-audio').pause();previewState='paused';stopPreviewFrame();syncPreviewInterface();announcePreview('Song paused: ');
}
function disposePreview(){
  previewGeneration++;previewPlayAttempt++;previewWantsPlay=false;previewReady=false;previewHasPlayed=false;previewState='idle';previewExpectedSource='';previewLastAnnouncement='';previewRenderedSecond=-1;previewRenderedLimit=-1;previewTrack=null;previewCoverToken++;clearPreviewShortcutFeedback();dismissPreviewShortcutHint(false);clearPreviewWatchdog();stopPreviewFrame();clearPreviewSourceEvents();cancelPreviewArtworkMotions();
  const audio=$('preview-audio');if(audio){audio.pause();audio.removeAttribute('src');audio.load();}for(const image of [$('preview-player-image'),$('preview-player-image-next')])if(image){image.onload=null;image.onerror=null;image.classList.remove('is-visible');image.hidden=true;image.removeAttribute('src');}previewArtworkSlot=0;$('preview-player')?.setAttribute('hidden','');syncPreviewButtons();
}
function reconcilePreviewCatalog(data){
  if(!previewTrack||!Array.isArray(data))return;const song=data.find(item=>Number(item?.id)===previewTrack.id),reference=String(song?.fileReference||''),hash=String(song?.updateHash||'');if(!song||!PREVIEW_REFERENCE.test(reference)||reference!==previewTrack.reference||hash!==previewTrack.updateHash)disposePreview();
}
function previewSpaceReserved(event){
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return true;const target=event.target;
  if(!target?.closest)return false;if(target.closest('a[href],textarea,select,button,summary,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role="button"],[role="checkbox"],[role="radio"],[role="switch"],[role="textbox"],[role="combobox"],[role="menuitem"],[role="tab"]'))return true;
  const input=target.closest('input');if(input&&String(input.type||'').toLowerCase()!=='range')return true;return Boolean(target.closest('.reading-content'));
}
function handlePreviewSpace(event){
  if((event.key!==' '&&event.code!=='Space')||!previewTrack||previewSpaceReserved(event))return;event.preventDefault();if(event.repeat)return;
  if(!toggleCurrentPreview('shortcut'))return;
  if(document.activeElement===$('preview-player-progress'))document.activeElement.blur?.();
}
function previewSeekReserved(event){
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey||event.shiftKey)return true;const target=event.target;
  if(!target?.closest)return false;
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
function setupAudioPreview(){
  const audio=$('preview-audio'),progress=$('preview-player-progress');$('preview-player-toggle').addEventListener('click',toggleCurrentPreview);
  progress.addEventListener('input',()=>{if(!previewTrack||!previewReady)return;const limit=previewLimit();if(!(limit>0))return;const value=Math.max(0,Math.min(Number(progress.value)||0,limit));try{audio.currentTime=value;}catch{}if(value>=limit-.015){if(previewState==='ended')updatePreviewProgress(limit,true);else finishPreview();return;}if(previewState==='ended'){previewState='paused';previewWantsPlay=false;}updatePreviewProgress(value,true);syncPreviewInterface();});
  document.addEventListener('keydown',handlePreviewSpace);document.addEventListener('keydown',handlePreviewSeekKey);document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePreview();});globalThis.addEventListener?.('pagehide',disposePreview);syncPreviewInterface();
}
const chartDescriptionViews=new Map();
let chartDescriptionOwner=null,chartDescriptionObserver=null,chartDescriptionFrame=0,chartDescriptionControlsReady=false;
function cancelChartDescriptionMotion(view){
  const motion=view?.motion;if(motion)try{motion.cancel();}catch{}if(view)view.motion=null;
  if(view?.preview){view.preview.style.height='';view.preview.style.willChange='';}
}
function releaseChartDescriptionGeometry(view){
  if(!view)return;const {preview,notes,card}=view;
  preview?.classList.remove('is-floating','is-collapsing');
  card?.classList.remove('is-description-expanded');notes?.classList.remove('is-description-expanded');
  if(preview){
    preview.style.height='';preview.style.willChange='';
    for(const name of ['--description-float-top','--description-float-left','--description-float-width','--description-expanded-height'])preview.style.removeProperty(name);
  }
  if(notes){notes.style.height='';notes.style.minHeight='';}
}
function chartDescriptionGeometry(view){
  const {preview,content,notes}=view,previewRect=preview.getBoundingClientRect(),notesRect=notes?.getBoundingClientRect?.()||previewRect;
  const notesStyle=notes?getComputedStyle(notes):null,borderTop=Number.parseFloat(notesStyle?.borderTopWidth)||0,borderLeft=Number.parseFloat(notesStyle?.borderLeftWidth)||0;
  const from=previewRect.height||preview.clientHeight||view.cut+3;
  const viewportHeight=document.documentElement.clientHeight||globalThis.innerHeight||800;
  const available=Math.max(from,viewportHeight-Math.max(16,previewRect.top)-28);
  const target=Math.max(from,Math.min(content.scrollHeight,520,available));
  const width=previewRect.width||preview.clientWidth||Math.max(0,notesRect.width-(previewRect.left-notesRect.left));
  return {from,target,top:previewRect.top-notesRect.top-borderTop,left:previewRect.left-notesRect.left-borderLeft,width,notesHeight:notesRect.height||notes?.clientHeight||from};
}
function prepareChartDescriptionGeometry(view,geometry){
  const {preview,notes,card}=view;
  preview.style.setProperty('--description-float-top',geometry.top+'px');
  preview.style.setProperty('--description-float-left',geometry.left+'px');
  preview.style.setProperty('--description-float-width',geometry.width+'px');
  preview.style.setProperty('--description-expanded-height',geometry.target+'px');
  if(notes){notes.style.height=geometry.notesHeight+'px';notes.style.minHeight=geometry.notesHeight+'px';notes.classList.add('is-description-expanded');}
  card?.classList.add('is-description-expanded');preview.classList.add('is-floating');
}
function syncChartDescriptionAccessibility(view,expanded){
  const {preview,content}=view;content.inert=!expanded;preview.tabIndex=view.overflow?0:-1;
  preview.setAttribute('role',expanded?'region':'button');
  if(expanded){preview.removeAttribute('aria-expanded');preview.removeAttribute('aria-controls');}
  else{preview.setAttribute('aria-expanded','false');preview.setAttribute('aria-controls',content.id);}
  uiAttr(preview,'aria-label',m(expanded?'Collapse the note for ':'Read the full note for ')+view.row[1]);
  uiAttr(preview,'aria-description',m(expanded?'Click or press Enter to collapse the note.':'Click or press Enter to read the full note.'));
}
function setChartDescriptionExpanded(view,expanded,animate=true){
  if(!view?.preview.isConnected||expanded&&!view.overflow)return false;
  const {preview,content}=view,wasFloating=preview.classList.contains('is-floating');
  const currentHeight=preview.getBoundingClientRect().height||preview.clientHeight||view.cut+3;
  const geometry=expanded&&!wasFloating?chartDescriptionGeometry(view):{from:currentHeight,target:Number.parseFloat(preview.style.getPropertyValue('--description-expanded-height'))||content.scrollHeight};
  cancelChartDescriptionMotion(view);view.expanded=expanded;
  if(expanded){
    if(!wasFloating)prepareChartDescriptionGeometry(view,geometry);
    preview.classList.remove('is-collapsing');preview.classList.add('is-expanded');
  }else{
    preview.classList.remove('is-expanded');preview.classList.add('is-collapsing');
  }
  syncChartDescriptionAccessibility(view,expanded);
  if(expanded)chartDescriptionOwner=view;else if(chartDescriptionOwner===view)chartDescriptionOwner=null;
  const from=currentHeight,to=expanded?(Number.parseFloat(preview.style.getPropertyValue('--description-expanded-height'))||geometry.target):view.cut+3;
  const settle=()=>{preview.style.height='';preview.style.willChange='';if(!view.expanded){releaseChartDescriptionGeometry(view);scheduleChartDescriptions();}};
  if(!animate||!motionAllowed()||!from||!to||Math.abs(from-to)<1){settle();return true;}
  preview.style.willChange='height';
  const motion=playMotion(preview,[{height:from+'px'},{height:to+'px'}],{duration:expanded?MOTION_MS.panel:MOTION_MS.standard,easing:expanded?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});view.motion=motion;
  playMotion(content,expanded?[{opacity:.5,transform:'translateY(-2px)'},{opacity:1,transform:'translateY(0)'}]:[{opacity:1,transform:'translateY(0)'},{opacity:.58,transform:'translateY(-2px)'}],{duration:expanded?MOTION_MS.panel:MOTION_MS.feedback,easing:expanded?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)'});
  const finish=()=>{if(view.motion!==motion)return;view.motion=null;settle();};
  if(motion)motion.finished.then(finish,()=>{});else finish();
  return true;
}
function refreshChartDescriptions(){
  const measured=[];
  for(const [preview,view] of chartDescriptionViews){
    if(!preview.isConnected){
      cancelChartDescriptionMotion(view);releaseChartDescriptionGeometry(view);if(chartDescriptionOwner===view)chartDescriptionOwner=null;
      chartDescriptionObserver?.unobserve(preview);chartDescriptionViews.delete(preview);continue;
    }
    if(view.expanded||preview.classList.contains('is-floating'))continue;
    const content=view.content,line=parseFloat(getComputedStyle(content).lineHeight)||22.1,budget=line*5;
    const overflow=preview.clientWidth>0&&content.scrollHeight>budget+1;
    let cut=line*4.5;
    if(overflow&&typeof document.createRange==='function'){
      // Clip through actual lettering, not an empty paragraph line; all reads precede writes.
      const top=content.getBoundingClientRect().top,range=document.createRange();range.selectNodeContents(content);
      let last=null;
      for(const rect of range.getClientRects())if(rect.width>0&&rect.top>=top-.5&&rect.bottom<=top+budget+.5&&(!last||rect.top>last.top))last=rect;
      if(last)cut=Math.max(line*.5,Math.min(budget-.5,last.top-top+last.height/2));
    }
    measured.push({view,overflow,cut});
  }
  for(const {view,overflow,cut} of measured){
    const {preview,content}=view;view.overflow=overflow;view.cut=cut;
    preview.classList.toggle('has-overflow',overflow);content.inert=overflow;preview.tabIndex=overflow?0:-1;
    preview.setAttribute('role',overflow?'button':'region');
    uiAttr(preview,'aria-label',overflow?m('Read the full note for ')+view.row[1]:m('Chart description'));
    if(overflow){
      preview.style.setProperty('--description-preview-height',cut+'px');
      preview.setAttribute('aria-expanded','false');preview.setAttribute('aria-controls',content.id);
      uiAttr(preview,'aria-description',m('Click or press Enter to read the full note.'));
    }else{
      preview.style.removeProperty('--description-preview-height');
      preview.removeAttribute('aria-expanded');preview.removeAttribute('aria-controls');
      uiAttr(preview,'aria-description','');
      if(view.expanded)setChartDescriptionExpanded(view,false,false);
      content.inert=false;
    }
  }
}
function scheduleChartDescriptions(){
  if(chartDescriptionFrame)return;
  chartDescriptionFrame=requestAnimationFrame(()=>{chartDescriptionFrame=0;refreshChartDescriptions();});
}
function dismissChartDescription(restoreFocus=false,animate=true){
  const owner=chartDescriptionOwner;if(owner)setChartDescriptionExpanded(owner,false,animate);
  if(restoreFocus&&owner?.preview.isConnected)owner.preview.focus({preventScroll:true});
  return Boolean(owner);
}
function showChartDescription(view,input='mouse'){
  if(!view?.overflow||!view.preview.isConnected||!view.card||!hostVisible||document.hidden||appExiting||phase!=='ready')return false;
  if($('tag-picker').matches(':popover-open')||$('selected-tag-popover').matches(':popover-open'))return false;
  view.input=input;if(chartDescriptionOwner===view)return setChartDescriptionExpanded(view,false);
  if(chartDescriptionOwner)dismissChartDescription(false);
  closeTemporaryReviews(reviewPopoverOwner,false,false);dismissChartTags();
  return setChartDescriptionExpanded(view,true);
}
function bindChartDescription(row,preview,content){
  const view={row,preview,content,card:null,notes:preview.parentElement,overflow:false,expanded:false,cut:0,input:'mouse',motion:null};chartDescriptionViews.set(preview,view);
  content.id='chart-description-'+row[0];preview.tabIndex=-1;preview.setAttribute('role','region');preview.setAttribute('aria-controls',content.id);uiAttr(preview,'aria-label',m('Chart description'));content.inert=true;
  preview.addEventListener('pointerdown',event=>{view.pointerType=event.pointerType;});
  preview.addEventListener('click',event=>{
    if(!view.overflow)return;if(view.expanded&&event.target.closest?.('a'))return;
    const selection=globalThis.getSelection?.();if(view.expanded&&selection&&!selection.isCollapsed&&preview.contains(selection.anchorNode))return;
    event.preventDefault();showChartDescription(view,event.detail===0?'keyboard':view.pointerType||'mouse');
  });
  preview.addEventListener('keydown',event=>{if(event.target===preview&&view.overflow&&['Enter',' '].includes(event.key)){event.preventDefault();showChartDescription(view,'keyboard');}});
  preview.addEventListener('pointerleave',event=>{if(view.expanded&&event.pointerType!=='touch'&&!preview.contains(event.relatedTarget))setChartDescriptionExpanded(view,false);});
  preview.addEventListener('wheel',event=>{
    if(!view.expanded||event.ctrlKey)return;event.preventDefault();event.stopPropagation();
    const scale=event.deltaMode===1?20:event.deltaMode===2?Math.max(1,content.clientHeight):1;
    content.scrollTop+=event.deltaY*scale;
  },{passive:false});
  if(typeof ResizeObserver==='function'){
    if(!chartDescriptionObserver)chartDescriptionObserver=new ResizeObserver(scheduleChartDescriptions);
    chartDescriptionObserver.observe(preview);
  }
  if(!chartDescriptionControlsReady){
    chartDescriptionControlsReady=true;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&chartDescriptionOwner){event.preventDefault();dismissChartDescription(true);}});
    globalThis.addEventListener?.('resize',()=>{dismissChartDescription(false,false);scheduleChartDescriptions();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)dismissChartDescription(false,false);});
    document.fonts?.ready?.then(scheduleChartDescriptions);
  }
  scheduleChartDescriptions();return view;
}
function bindChartDescriptionCard(card){
  const view=chartDescriptionViews.get(card.querySelector('.chart-description'));if(!view)return;view.card=card;view.notes=view.preview.parentElement;
}
let chartTagsPopover=null,chartTagsOwner=null,chartTagsTimer=null,chartTagsFrame=0,chartTagsIgnoreFocus=false;
function chartTagsOverflow(strip){return strip.clientWidth>0&&strip.scrollWidth>strip.clientWidth+1;}
function makeChartTagButton(tag,chartId){
  const button=element('button',tag,'chart-tag-button');button.type='button';button.dataset.chartTag=tag;button.dataset.chartId=String(chartId);
  button.addEventListener('click',()=>addTagFilter(tag,button));return button;
}
function refreshChartTagButtons(){
  for(const button of document.querySelectorAll('.chart-tag-button')){
    const selected=selectedTags.has(tagKey(button.dataset.chartTag));button.setAttribute('aria-pressed',String(selected));
    uiAttr(button,'aria-label',m(selected?'Tag already selected: ':'Filter by tag: ')+button.dataset.chartTag);
  }
  for(const strip of document.querySelectorAll('.chart-tags')){
    const overflow=chartTagsOverflow(strip);strip.tabIndex=overflow?0:-1;strip.classList.toggle('has-overflow',overflow);
    if(overflow){strip.setAttribute('aria-haspopup','dialog');strip.setAttribute('aria-controls','chart-tags-popover');uiAttr(strip,'aria-description',m('Hover, focus, or tap to show all tags.'));}
    else{strip.removeAttribute('aria-haspopup');strip.removeAttribute('aria-controls');uiAttr(strip,'aria-description','');}
    for(const button of strip.children)button.tabIndex=overflow?-1:0;
  }
  if(chartTagsOwner){if(!chartTagsOwner.isConnected||!chartTagsOverflow(chartTagsOwner))dismissChartTags();else positionChartTags();}
}
function scheduleChartTagsRefresh(){
  if(chartTagsFrame)return;
  chartTagsFrame=requestAnimationFrame(()=>{chartTagsFrame=0;refreshChartTagButtons();});
}
function dismissChartTags(){
  clearTimeout(chartTagsTimer);chartTagsTimer=null;
  const owner=chartTagsOwner;chartTagsOwner=null;owner?.classList.remove('is-open');
  if(chartTagsPopover?.matches(':popover-open'))chartTagsPopover.hidePopover();
  if(chartTagsPopover&&chartTagsPopover.parentElement!==document.body)document.body.append(chartTagsPopover);
  return Boolean(owner);
}
function leaveChartTags(){
  clearTimeout(chartTagsTimer);chartTagsTimer=setTimeout(()=>{
    chartTagsTimer=null;const owner=chartTagsOwner,panel=chartTagsPopover,focused=document.activeElement;
    if(!owner)return;
    const keyboardFocused=document.documentElement.dataset.inputModality==='keyboard'&&focused?.matches(':focus-visible');
    if(owner.matches(':hover')||panel.matches(':hover')||keyboardFocused&&(owner.contains(focused)||panel.contains(focused)))return;
    dismissChartTags();
  },160);
}
function positionChartTags(){
  const strip=chartTagsOwner,panel=chartTagsPopover;if(!strip||!panel?.matches(':popover-open'))return;
  if(!strip.isConnected){dismissChartTags();return;}
  const scrollTop=panel.scrollTop;
  const anchor=strip.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,edge=12,gap=6;
  const ceiling=Math.max(edge,(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+gap);
  if(anchor.bottom<=ceiling||anchor.top>=height-edge){dismissChartTags();return;}
  panel.style.width=`${Math.min(Math.max(anchor.width,280),440,Math.max(1,width-edge*2))}px`;
  panel.style.maxHeight=`${Math.max(1,height-ceiling-edge)}px`;
  let box=panel.getBoundingClientRect();
  const below=height-edge-anchor.bottom-gap,above=anchor.top-gap-ceiling,down=below>=box.height||below>=above;
  panel.style.maxHeight=`${Math.max(1,down?below:above)}px`;box=panel.getBoundingClientRect();
  panel.style.left=`${Math.max(edge,Math.min(anchor.left,width-edge-box.width))}px`;
  panel.style.top=`${Math.max(ceiling,Math.min(down?anchor.bottom+gap:anchor.top-gap-box.height,height-edge-box.height))}px`;
  panel.scrollTop=scrollTop;
}
function ensureChartTagsPopover(){
  if(chartTagsPopover)return chartTagsPopover;
  const panel=element('div',undefined,'close-help chart-tags-popover');chartTagsPopover=panel;
  panel.id='chart-tags-popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.tabIndex=-1;uiAttr(panel,'aria-label',m('Chart tags'));document.body.append(panel);
  panel.addEventListener('pointerenter',()=>{clearTimeout(chartTagsTimer);chartTagsTimer=null;});
  panel.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')leaveChartTags();});
  panel.addEventListener('focusout',leaveChartTags);
  panel.addEventListener('beforetoggle',event=>{
    if(event.newState!=='closed')return;
    // Closing can restore focus to the strip before the native toggle finishes.
    chartTagsIgnoreFocus=true;queueMicrotask(()=>{chartTagsIgnoreFocus=false;});
    clearTimeout(chartTagsTimer);chartTagsTimer=null;chartTagsOwner?.classList.remove('is-open');chartTagsOwner=null;
  });
  panel.addEventListener('toggle',event=>{if(event.newState==='closed'&&!panel.matches(':popover-open')&&panel.parentElement!==document.body)document.body.append(panel);});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!chartTagsOwner)return;
    const owner=chartTagsOwner,restore=panel.contains(document.activeElement);chartTagsIgnoreFocus=true;dismissChartTags();
    if(restore&&owner.isConnected)owner.focus({preventScroll:true});chartTagsIgnoreFocus=false;event.preventDefault();event.stopPropagation();
  },true);
  globalThis.addEventListener?.('resize',scheduleChartTagsRefresh);
  globalThis.addEventListener?.('scroll',event=>{if(!chartTagsPopover?.contains(event.target))positionChartTags();},{capture:true,passive:true});
  globalThis.addEventListener?.('blur',dismissChartTags);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)dismissChartTags();});
  if(typeof ResizeObserver==='function')new ResizeObserver(positionChartTags).observe(panel);
  document.fonts?.ready?.then(scheduleChartTagsRefresh);return panel;
}
function showChartTags(strip){
  if($('tag-picker').matches(':popover-open')||$('selected-tag-popover').matches(':popover-open'))return false;
  clearTimeout(chartTagsTimer);chartTagsTimer=null;
  if(!strip.isConnected||!hostVisible||document.hidden||!chartTagsOverflow(strip))return false;
  dismissChartDescription(false,false);
  const panel=ensureChartTagsPopover();
  if(chartTagsOwner!==strip){
    dismissChartTags();chartTagsOwner=strip;strip.classList.add('is-open');strip.after(panel);
    panel.replaceChildren(...[...strip.children].map(button=>makeChartTagButton(button.dataset.chartTag,button.dataset.chartId)));
    panel.showPopover();refreshChartTagButtons();
  }
  positionChartTags();return chartTagsOwner===strip;
}
function installationRequestId(){
  if(!globalThis.crypto?.getRandomValues)throw uiError(m("This browser cannot create install requests. Try another browser."));
  return Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function installerJob(payload,songId,expectedId='',targetDirectory=INSTALL_DIRECTORY){
  const job=payload?.job,states=['queued','downloading','validating','extracting','complete','error'];
  if(!job||typeof job!=='object'||!/^[a-f0-9]{32}$/.test(job.id)||job.songId!==songId||!states.includes(job.state)||expectedId&&job.id!==expectedId)throw uiError(m("Could not confirm installation. Check its status before trying again."));
  if(job.targetDirectory!==targetDirectory)throw uiError(m("The install folder does not match. Check Settings before continuing."));
  return {id:job.id,songId:job.songId,state:job.state,message:typeof job.message==='string'?job.message:'',downloadedBytes:countValue(job.downloadedBytes)??0,totalBytes:countValue(job.totalBytes),fileCount:countValue(job.fileCount)??0,filesWritten:countValue(job.filesWritten)??0,zipRemoved:job.zipRemoved===true,targetDirectory:job.targetDirectory};
}
async function installerRequest(method,path,body,revision=''){
  const permitted=method==='GET'&&(['/v1/settings','/v1/activity','/v1/desktop/window','/v1/desktop/dialog'].includes(path)||/^\/v1\/jobs\/[a-f0-9]{32}$/.test(path))||method==='POST'&&['/v1/install','/v1/installations/check','/v1/settings','/v1/directory/select','/v1/shutdown','/v1/language','/v1/close-behavior','/v1/player-shortcuts-seen','/v1/install-directory-confirmation','/v1/desktop/window','/v1/desktop/dialog','/v1/desktop/exit'].includes(path);
  if(!permitted)throw uiError(m("Unable to complete this action. Reopen SpinShareBrowser.exe."));
  if(path==='/v1/install'&&!/^[a-f0-9]{32}$/.test(revision))throw uiError(m("Open Settings and choose the install folder again."));
  const request=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;request.abort();},path==='/v1/directory/select'?600000:10000);
  const headers={'X-SpinShare-Key':INSTALL_KEY};if(method==='POST')headers['Content-Type']='application/json';
  if(path==='/v1/install')headers['X-SpinShare-Settings']=revision;
  try{
    const response=await fetch(INSTALL_ORIGIN+path,{method,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',headers,...(body?{body:JSON.stringify(body)}:{}),signal:request.signal});
    let result;try{result=await readJSONResponse({ok:true,headers:response.headers,body:response.body},64*1024);}catch(error){if(request.signal.aborted)throw error;throw uiError(m("Could not confirm installation. Check its status before trying again."));}
    if(!response.ok){
      const code=typeof result?.code==='string'?result.code:'',detail=typeof result?.error==='string'?localizeInstallerMessage(result.error):'',localized=code==='queue_full'?m('The install queue is full. Wait for a task to finish, then try again.'):Object.hasOwn(INSTALLER_ERROR_TEXT,code)?INSTALLER_ERROR_TEXT[code]:'';
      const error=uiError(localized||detail||m("The installer returned HTTP ")+response.status);error.httpStatus=response.status;error.code=code;
      if(error.code==='settings_changed'){
        const requestRevision=typeof body?.expectedRevision==='string'?body.expectedRevision:revision;
        const obsoleteSettingsError=/^[a-f0-9]{32}$/.test(requestRevision)&&requestRevision!==settingsRevision;
        if(!obsoleteSettingsError){settingsStale=true;error.uiMessage=errorText(error)+m(" Open Settings to confirm the directory before retrying.");updateAllInstallationViews();}
      }
      throw error;
    }
    return result;
  }catch(error){
    if(timedOut){
      if(path==='/v1/language')throw uiError(m('Saving the language timed out. Please retry.'));
      if(path==='/v1/settings')throw uiError(method==='POST'?m("Saving settings timed out. Reopen Settings to check the result."):m("Loading settings timed out. Reopen Settings and try again."));
      if(path==='/v1/directory/select')throw uiError(m("Choosing a folder timed out. Close the folder dialog before retrying."));
      if(path==='/v1/shutdown')throw uiError(m("Exit timed out. Check whether the app is still running."));
      throw uiError(m("Installer response timed out. The task may still be running; check its progress."));
    }
    if(error instanceof TypeError)throw uiError(m("Cannot reach the installer. Reopen SpinShareBrowser.exe and allow local network access if asked."));
    throw error;
  }finally{clearTimeout(timer);}
}
function installationPending(songId){
  const saved=installationStates.get(songId),state=saved?.targetDirectory===INSTALL_DIRECTORY?saved:null,activeId=installationActivityIds.get(songId);
  return Boolean(state?.running||state?.requestId&&!state.rejected&&!state.expired&&!['complete','error'].includes(state.job?.state)||activeId&&activeId!==state?.job?.id);
}
function installationFilterMode(){const value=$('installation-filter').value;return ['installed','uninstalled'].includes(value)?value:'all';}
function installationKey(row){return settingsRevision+':'+row[8].fileReference+':'+row[8].updateHash;}
function canCheckInstallation(row){return !row[8].dlc&&/^spinshare_[a-f0-9]{1,64}$/i.test(row[8].fileReference||'')&&/^[a-f0-9]{32}$/i.test(row[8].updateHash||'');}
function installationPresence(row){
  if(settingsStale||!canCheckInstallation(row)||installationPending(row[0]))return null;
  const record=installedCharts.get(row[0]);return record?.key===installationKey(row)?record.value:undefined;
}
function trimPresenceQueue(rows=[]){
  const keep=new Set(rows.map(row=>row[0]));
  for(const [id,{record}] of presenceQueue)if(!keep.has(id)){
    if(installedCharts.get(id)===record)installedCharts.delete(id);
    presenceQueue.delete(id);
  }
}
function installationProgressText(pending){return m('Checking installation status: ')+number(installationCandidates.length-pending)+' / '+number(installationCandidates.length);}
function syncInstallationFilter(){
  const active=Boolean(applied)&&phase==='ready'&&installationFilterMode()!=='all';let pending=0,unknown=0,retry=false;
  if(active)for(const row of installationCandidates){
    const value=installationPresence(row);
    if(value===undefined)pending++;
    else if(value===null){unknown++;if(canCheckInstallation(row)&&!installationPending(row[0]))retry=true;}
  }
  installationFilterPending=pending>0;
  installationFilterRemaining=pending;
  const stageOwnsProgress=pending>0&&filtered.length===0;
  $('installation-filter-feedback').hidden=!active||!pending&&!unknown||stageOwnsProgress;
  $('installation-filter-retry').hidden=!active||!retry||settingsStale;
  $('installation-filter-retry').disabled=appExiting||pending>0;
  $('installation-filter').setAttribute('aria-busy',String(pending>0));
  uiText($('installation-filter-message'),settingsStale?m('Open Settings to confirm the changed install directory.'):pending?installationProgressText(pending):unknown?m('Installation status unknown: ')+number(unknown)+m(' charts excluded.'):'');
  loadingIndicator($('installation-filter-message'),pending>0);return pending;
}
function refreshInstallationResults(){
  if(!applied||phase!=='ready'||installationFilterMode()==='all'||presenceRefreshQueued)return;
  presenceRefreshQueued=true;queueMicrotask(()=>{
    presenceRefreshQueued=false;
    if(applied&&phase==='ready'&&installationFilterMode()!=='all')rebuild(false,true);
  });
}
function refreshInstallationChecks(failedOnly=false){
  if(!applied||phase!=='ready'||appExiting||settingsStale)return;
  let rows=installationFilterMode()==='all'?[...installationViews.values()].map(view=>view.row):installationCandidates;
  if(failedOnly)rows=rows.filter(row=>installationPresence(row)===null);
  queueInstallationChecks(rows,true);syncInstallationFilter();
}
function refreshInstallationActivity(){
  const active=new Map(activityJobs.map(job=>[job.songId,job.id])),changed=new Set([...installationActivityIds.keys(),...active.keys()]);
  for(const id of changed)if(installationActivityIds.get(id)===active.get(id))changed.delete(id);
  installationActivityIds=active;
  if(!changed.size)return;
  for(const id of changed){installedCharts.delete(id);presenceQueue.delete(id);}
  queueInstallationChecks(currentRows.filter(row=>changed.has(row[0])));refreshInstallationResults();
}
function queueInstallationChecks(rows,force=false){
  if(settingsStale||appExiting)return;
  for(const row of rows){
    if(!row||!canCheckInstallation(row)||installationPending(row[0]))continue;
    const key=installationKey(row);let record=installedCharts.get(row[0]);
    if(record?.key!==key||force&&!record.pending){record={key,value:undefined,pending:false};installedCharts.set(row[0],record);}
    if(record.pending||record.value!==undefined)continue;
    record.pending=true;presenceQueue.set(row[0],{row,record});updateInstallationView(row[0]);
  }
  return readInstallationPresence();
}
async function readInstallationPresence(){
  if(presenceBusy||settingsStale||appExiting)return;
  presenceBusy=true;
  try{
    while(presenceQueue.size&&!settingsStale&&!appExiting){
      const batch=[...presenceQueue.values()].slice(0,30),revision=settingsRevision,generation=presenceGeneration,values=new Map(batch.map(({row})=>[row[0],null]));
      for(const {row} of batch)presenceQueue.delete(row[0]);
      try{
        const charts=batch.map(({row})=>({songId:row[0],fileReference:row[8].fileReference,updateHash:row[8].updateHash}));
        const result=await installerRequest('POST','/v1/installations/check',{expectedRevision:revision,charts});
        const seen=new Set();
        if(result?.settingsRevision!==revision||!Array.isArray(result.installations)||result.installations.length!==batch.length)throw new Error('Invalid installation status response');
        for(const item of result.installations){
          if(!item||!values.has(item.songId)||seen.has(item.songId)||typeof item.installed!=='boolean')throw new Error('Invalid installation status entry');
          seen.add(item.songId);
        }
        for(const item of result.installations)values.set(item.songId,item.installed);
      }catch{}
      if(generation!==presenceGeneration||revision!==settingsRevision)continue;
      const wanted=new Set(installationCandidates.map(row=>row[0]));let changed=false;
      for(const {row,record} of batch){
        // A completed install or new directory can replace a record while this batch is in flight.
        if(installedCharts.get(row[0])!==record)continue;
        record.pending=false;record.value=settingsStale||installationPending(row[0])?null:values.get(row[0]);
        updateInstallationView(row[0]);
        if(wanted.has(row[0]))changed=true;
      }
      const pending=syncInstallationFilter();if(changed&&!pending)refreshInstallationResults();
    }
  }finally{presenceBusy=false;}
}
function updateInstallationView(songId){
  const view=installationViews.get(songId);if(!view)return;
  const saved=installationStates.get(songId),state=saved?.targetDirectory===INSTALL_DIRECTORY?saved:null,job=state?.job,presence=installationPresence(view.row),installed=presence===true;
  let label=installed?m("Install again"):m("Download and install"),message='';
  if(state?.problem){
    label=state.expired?m("Download and install again"):job?m("Check progress"):state.rejected?m("Try installing again"):m("Check installation");message=state.problem+(state.expired?m("\nDownloading again will replace files with the same name."):'');
  }else if(state?.running&&!job){
    label=m("Submitting...");message=m("Connecting to the installer...");
  }else if(job){
    if(job.state==='queued'){label=m("Queued");message=m("Waiting to install.");}
    else if(job.state==='downloading'){
      label=m("Downloading...");message=m("Downloaded ")+(job.downloadedBytes/1000000).toFixed(1)+(job.totalBytes?(' / '+(job.totalBytes/1000000).toFixed(1)):'')+m(" MB");
    }else if(job.state==='validating'){label=m("Preparing installation...");message=job.message==='Downloaded; waiting for installation.'?m('Downloaded; waiting for installation.'):m("Preparing files...");}
    else if(job.state==='extracting'){label=m("Installing...");message=m("Installing: ")+number(job.filesWritten)+' / '+number(job.fileCount)+m(" files");}
    else if(job.state==='complete'){if(!job.zipRemoved)message=m("Remove the leftover ZIP from this folder.");}
    else{label=m("Install failed; retry");message=job.message?localizeInstallerMessage(job.message):m("Installation failed.");}
  }
  if(!state&&settingsStale){label=m("Confirm directory");message=m("Open Settings to confirm the changed install directory.");}
  const error=Boolean(state?.problem)||job?.state==='error'||job?.state==='complete'&&!job.zipRemoved;
  const needsSubmit=!job||state?.rejected||state?.expired||['complete','error'].includes(job.state);
  uiText(view.presence,installed?m("Installed"):presence===false?m("Not installed"):presence===undefined?m('Checking installation status...'):m('Installation status unknown'));view.presence.classList.toggle('is-installed',installed);
  uiText(view.label,label);uiAttr(view.button,"aria-label",label+' '+view.songTitle);view.button.disabled=Boolean(state?.running)||appExiting||settingsBusy==='saving'||settingsBusy==='shutdown'||settingsStale&&needsSubmit;view.button.classList.toggle('is-complete',installed);
  uiText(view.note,message);view.note.hidden=!message;view.note.classList.toggle('is-error',error);
  const active=Boolean(state?.running)&&!error;
  loadingIndicator(view.label,active,job?.state==='queued');view.button.setAttribute('aria-busy',String(active));
  updateTaskProgress(view.progress,job,active,label+' '+view.songTitle);
}
function scheduleInstallationPoll(state){
  clearTimeout(state.timer);state.timer=setTimeout(()=>{state.timer=null;pollInstallation(state);},700);
}
function receiveInstallationJob(state,payload){
  state.job=installerJob(payload,state.songId,state.job?.id||'',state.targetDirectory);state.problem='';
  state.running=!['complete','error'].includes(state.job.state);updateInstallationView(state.songId);
  refreshSettingsControls();renderActivity();refreshActivity();
  if(state.running)scheduleInstallationPoll(state);else if(state.row){installedCharts.delete(state.songId);queueInstallationChecks([state.row]);refreshInstallationResults();}
}
async function pollInstallation(state){
  if(!state.job||state.requesting)return;state.requesting=true;
  try{receiveInstallationJob(state,await installerRequest('GET','/v1/jobs/'+state.job.id));}
  catch(error){state.running=false;state.expired=error.httpStatus===410&&error.code==='request_expired';state.problem=errorText(error);updateInstallationView(state.songId);}
  finally{state.requesting=false;refreshSettingsControls();renderActivity();refreshActivity();if(state.expired&&state.row){queueInstallationChecks([state.row]);refreshInstallationResults();}}
}
async function startInstallation(row){
  if(row[8].dlc||appExiting||settingsBusy==='saving'||settingsBusy==='shutdown')return;
  let state=installationStates.get(row[0]);if(state?.running||state?.requesting)return;
  if(settingsStale&&(!state?.job||state.rejected||state.expired||['complete','error'].includes(state.job.state))){updateInstallationView(row[0]);return;}
  if(!state||state.rejected||state.expired||state.job&&['complete','error'].includes(state.job.state)){
    state={songId:row[0],row,requestId:'',job:null,running:false,requesting:false,rejected:false,expired:false,problem:'',timer:null,targetDirectory:INSTALL_DIRECTORY,settingsRevision};installationStates.set(row[0],state);
  }
  installedCharts.delete(row[0]);presenceQueue.delete(row[0]);state.running=true;state.problem='';refreshSettingsControls();renderActivity();refreshInstallationResults();
  queueInstallationChecks([...installationViews.values()].map(view=>view.row));
  if(state.job){updateInstallationView(state.songId);await pollInstallation(state);return;}
  updateInstallationView(state.songId);state.requesting=true;
  const confirmingUnknown=Boolean(state.requestId);
  try{
    if(!state.requestId)state.requestId=installationRequestId();
    receiveInstallationJob(state,await installerRequest('POST','/v1/install',{songId:state.songId,requestId:state.requestId},state.settingsRevision));
  }catch(error){
    const lostConfirmation=confirmingUnknown&&error.httpStatus===409&&error.code==='settings_changed';
    state.running=false;state.expired=lostConfirmation||error.httpStatus===410&&error.code==='request_expired';state.rejected=!state.expired&&error.httpStatus>=400&&error.httpStatus<500;
    state.problem=lostConfirmation?m("Installation could not be confirmed. Check the folder in Settings before downloading again."):errorText(error);updateInstallationView(state.songId);
  }
  finally{state.requesting=false;refreshSettingsControls();renderActivity();refreshActivity();if(!installationPending(state.songId)){queueInstallationChecks([state.row]);refreshInstallationResults();}}
}
function applyActivity(data){
  if(!data||typeof data.exiting!=='boolean'||!Number.isInteger(data.activeCount)||data.activeCount<0||data.activeCount>128||!Array.isArray(data.jobs)||data.jobs.length!==data.activeCount)throw uiError(m('Task status is unavailable. Please retry.'));
  for(const job of data.jobs){
    if(!job||typeof job.id!=='string'||!/^[a-f0-9]{32}$/.test(job.id)||!Number.isSafeInteger(job.songId)||job.songId<1||!['queued','downloading','validating','extracting'].includes(job.state)||!['downloadedBytes','filesWritten','fileCount'].every(key=>Number.isSafeInteger(job[key])&&job[key]>=0)||job.totalBytes!==null&&(!Number.isSafeInteger(job.totalBytes)||job.totalBytes<0))throw uiError(m('Task status is unavailable. Please retry.'));
  }
  appExiting=appExiting||data.exiting;activityJobs=data.jobs;activityProblem='';updateAllInstallationViews();renderActivity();syncFilters();
}
function showActivity(visible){
  if(activityVisible===visible)return;
  activityVisible=visible;activityMotion?.cancel();activityMotion=null;
  const panel=$('app-activity'),frames=[{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}];
  if(visible)panel.hidden=false;
  const motion=playMotion(panel,visible?frames:[...frames].reverse(),{duration:MOTION_MS.feedback,easing:'ease-out'});activityMotion=motion;
  if(!visible){if(motion)motion.finished.then(()=>{if(!activityVisible)panel.hidden=true;}).catch(()=>{});else panel.hidden=true;}
}
function renderActivity(){
  refreshCloseHelpTasks();
  const jobs=new Map(activityJobs.map(job=>[job.songId,job]));
  for(const state of installationStates.values()){
    if(state.running||state.requesting){if(!jobs.has(state.songId)||!state.job||jobs.get(state.songId).id===state.job.id)jobs.set(state.songId,state.job||{songId:state.songId,state:'submitting'});}
    else if(state.job&&['complete','error'].includes(state.job.state)&&jobs.get(state.songId)?.id===state.job.id)jobs.delete(state.songId);
  }
  const visible=appExiting||jobs.size>0||Boolean(activityProblem);
  showActivity(visible);$('app-activity').classList.toggle('is-exiting',appExiting);
  $('activity-retry').hidden=!activityProblem&&!exitFailed;
  if(!visible){loadingIndicator($('activity-message'),false);for(const view of activityViews.values())loadingIndicator(view.label,false);return;}
  uiText($('activity-message'),exitFailed?m('The app could not exit. Please try again.'):appExiting?m('The app will quit when all installations finish.'):activityProblem||m('Install queue: ')+number(jobs.size));
  loadingIndicator($('activity-message'),appExiting&&!exitFailed&&!activityProblem);
  const lines=[],wanted=new Set();
  for(const job of [...jobs.values()].slice(0,2)){
    const title=installationStates.get(job.songId)?.row?.[1]||currentRows.find(row=>row[0]===job.songId)?.[1]||m('Chart ')+job.songId;
    const state=m(job.state==='downloading'?'Downloading...':job.state==='extracting'?'Installing...':job.state==='validating'?'Preparing installation...':job.state==='submitting'?'Submitting...':'Queued');
    const progress=job.state==='downloading'?' '+((job.downloadedBytes||0)/1000000).toFixed(1)+(job.totalBytes?' / '+(job.totalBytes/1000000).toFixed(1):'')+m(' MB'):job.state==='extracting'?' '+number(job.filesWritten||0)+' / '+number(job.fileCount||0):'';
    wanted.add(job.songId);let view=activityViews.get(job.songId);
    if(!view){
      view={node:element('span',undefined,'activity-job'),title:element('span',undefined,'activity-title'),label:element('span',undefined,'activity-job-label'),progress:element('progress',undefined,'task-progress')};
      const line=element('span',undefined,'activity-job-line');line.append(view.title,view.label);view.node.append(line,view.progress);activityViews.set(job.songId,view);
    }
    uiText(view.title,title);uiText(view.label,state+progress);loadingIndicator(view.label,!activityProblem&&!exitFailed,job.state==='queued');
    updateTaskProgress(view.progress,job,!activityProblem&&!exitFailed,title+' · '+state);lines.push(view.node);
  }
  if(jobs.size>2){wanted.add('more');let view=activityViews.get('more');if(!view){view={node:element('span',undefined,'activity-job activity-job-more'),label:element('span')};view.node.append(view.label);activityViews.set('more',view);}uiText(view.label,'+ '+number(jobs.size-2));lines.push(view.node);}
  for(const [key,view] of activityViews)if(!wanted.has(key)){view.node.remove();activityViews.delete(key);}
  for(const [index,line] of lines.entries())if($('activity-jobs').children[index]!==line)$('activity-jobs').insertBefore(line,$('activity-jobs').children[index]||null);
}
async function refreshActivity(){
  if(activityPending)return;
  clearTimeout(activityTimer);activityTimer=null;activityPending=true;loadingIndicator($('activity-retry'),true);
  try{applyActivity(await installerRequest('GET','/v1/activity'));}
  catch{activityProblem=m('Task status is unavailable. Please retry.');renderActivity();}
  finally{
    activityPending=false;loadingIndicator($('activity-retry'),false);
    if(!activityProblem&&(appExiting||hasActiveInstallations()))activityTimer=setTimeout(()=>{activityTimer=null;refreshActivity();},document.hidden?5000:1500);
  }
}
function setupActivity(){
  $('activity-retry').addEventListener('click',async()=>{
    if(!exitFailed)return refreshActivity();if(settingsBusy)return;
    loadingIndicator($('activity-retry'),true);try{await exitTool();}finally{loadingIndicator($('activity-retry'),false);}
  });
  globalThis.addEventListener?.('focus',refreshActivity);refreshActivity();
}
function reviewsOpen(cell){return !cell.retired&&reviewCounts.get(cell.row[0])!==0&&cardViews.get(cell.row[0])?.cell===cell&&(showChartReviews||cell.reviewTemporaryOpen);}
function reviewRefreshRemaining(){
  try{
    const stored=Number(globalThis.localStorage.getItem(REVIEW_REFRESH_STORAGE_KEY));
    if(Number.isSafeInteger(stored)&&stored>0)reviewRefreshNextAllowedAt=Math.max(reviewRefreshNextAllowedAt,stored);
  }catch{}
  return Math.max(0,reviewRefreshNextAllowedAt-Date.now());
}
function reviewRefreshClock(remaining){
  const seconds=Math.ceil(remaining/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function syncReviewRefresh(){
  const remaining=reviewRefreshRemaining(),blocked=remaining>0||Boolean(reviewRefreshOwner);
  const label=m('Refresh reviews')+(remaining?' · '+reviewRefreshClock(remaining):'');
  const help=remaining?m('Reviews can be refreshed again in ')+reviewRefreshClock(remaining):reviewRefreshOwner?m('A review refresh is queued. Please wait.') : '';
  let active=false;
  for(const {cell} of cardViews.values()){
    if(cell.retired)continue;active=true;
    cell.refresh.disabled=Boolean(cell.pending)||blocked;uiText(cell.refreshLabel,label);
    uiAttr(cell.refresh,'aria-label',m('Reload ')+cell.row[1]+m("'s complete reviews")+(help?' · '+help:''));
  }
  if(remaining&&active){
    if(reviewRefreshTimer===null)reviewRefreshTimer=setTimeout(()=>{reviewRefreshTimer=null;syncReviewRefresh();},1000);
  }else{clearTimeout(reviewRefreshTimer);reviewRefreshTimer=null;}
}
function reserveReviewRefresh(cell,state){
  if(reviewRefreshRemaining()>0||reviewRefreshOwner){syncReviewRefresh();return null;}
  const owner={cell,state,started:false};reviewRefreshOwner=owner;syncReviewRefresh();return owner;
}
function releaseReviewRefresh(owner){
  if(owner&&reviewRefreshOwner===owner){reviewRefreshOwner=null;syncReviewRefresh();}
}
function beginReviewRefresh(owner){
  if(owner&&(reviewRefreshOwner!==owner||owner.started||owner.cell.retired||owner.state.stopped))throw new DOMException('Aborted','AbortError');
  const remaining=reviewRefreshRemaining();
  if(remaining>0||reviewRefreshOwner&&reviewRefreshOwner!==owner){
    syncReviewRefresh();
    const error=uiError(remaining?m('Reviews can be refreshed again in ')+reviewRefreshClock(remaining):m('A review refresh is queued. Please wait.'));
    error.code=remaining?'review_refresh_cooldown':'review_refresh_queued';throw error;
  }
  // A failed force request still consumes the shared minute; storage failure keeps the in-page gate.
  reviewRefreshNextAllowedAt=Date.now()+REVIEW_REFRESH_MS;
  try{globalThis.localStorage.setItem(REVIEW_REFRESH_STORAGE_KEY,String(reviewRefreshNextAllowedAt));}catch{}
  if(owner)owner.started=true;syncReviewRefresh();
}
function bindReadingWheel(target,list,active=()=>true){
  target.addEventListener('wheel',event=>{
    if(!active()||target.inert||!target.matches(':popover-open')||event.ctrlKey)return;
    // Headers, padding and scroll boundaries belong to the same reading surface.
    event.preventDefault();event.stopPropagation();
    const unit=event.deltaMode===1?parseFloat(getComputedStyle(list).lineHeight)||16:event.deltaMode===2?list.clientHeight||target.clientHeight:1;
    list.scrollTop+=event.deltaY*unit;
  },{passive:false});
}
function cancelReadingMotion(cell){
  let from=null;
  if(cell.target.matches(':popover-open')){
    const surface=getComputedStyle(cell.body),backdrop=getComputedStyle(cell.target,'::backdrop');
    from={opacity:surface.opacity,transform:surface.transform||'none',backdropOpacity:backdrop.opacity};
  }
  cell.readingMotion?.cancel();cell.readingMotion=null;
  cell.readingBackdropMotion?.cancel();cell.readingBackdropMotion=null;
  return from;
}
function animateReadingPopover(cell,open,animate,from=null){
  const target=cell.target,offset=cell.readingEnterOffset||10;
  const start=from?{opacity:from.opacity,transform:from.transform}:{opacity:0,transform:'translateY('+offset+'px) scale(.985)'};
  const end=open?{opacity:1,transform:'translateY(0) scale(1)'}:{opacity:0,transform:'translateY('+(offset*.6)+'px) scale(.985)'};
  const options={...(open?READING_MOTION.enter:READING_MOTION.exit),fill:'both'};
  const motion=animate?playMotion(cell.body,[start,end],options):null;
  let backdropMotion=null;
  // Older WebViews may not animate ::backdrop; the static shade remains usable.
  if(animate)try{backdropMotion=playMotion(target,[{opacity:from?.backdropOpacity??0},{opacity:open?1:0}],{...options,pseudoElement:'::backdrop'});}catch{}
  cell.readingMotion=motion;cell.readingBackdropMotion=backdropMotion;
  const finish=()=>{
    if(cell.readingMotion!==motion)return;
    cell.readingMotion=null;
    if(!cell.readingVisible){if(target.matches(':popover-open'))target.hidePopover();target.hidden=true;}
    motion?.cancel();backdropMotion?.cancel();
    if(cell.readingBackdropMotion===backdropMotion)cell.readingBackdropMotion=null;
  };
  if(motion)motion.finished.then(finish,()=>{});else finish();
}
function positionReadingPopover(cell){
  const anchor=cell.toggle.getBoundingClientRect(),width=document.documentElement.clientWidth||innerWidth,height=innerHeight;
  const top=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||64)+12;
  const narrow=width<=680,panelWidth=Math.min(cell.readingWidth||680,width-24),spaceBelow=height-anchor.bottom-20,spaceAbove=anchor.top-top-8;
  const style=cell.target.style,left=Math.max(12,Math.min(anchor.left,width-panelWidth-12));
  style.width=panelWidth+'px';style.left=left+'px';
  if(narrow){
    // Keep the sheet within a short pointer path even when its trigger is near the top.
    style.top=Math.max(top,Math.min(anchor.bottom+8,height*.3))+'px';style.bottom='12px';style.height='auto';style.maxHeight='none';
    cell.readingEnterOffset=12;cell.body.style.transformOrigin='50% 100%';
  }else{
    const below=spaceBelow>=Math.min(360,height*.45)||spaceBelow>=spaceAbove;
    style.top=below?Math.max(top,anchor.bottom+8)+'px':'auto';
    style.bottom=below?'auto':Math.max(12,height-anchor.top+8)+'px';
    style.height='auto';style.maxHeight=Math.max(100,Math.min(560,below?height-Math.max(top,anchor.bottom+8)-12:spaceAbove))+'px';
    cell.readingEnterOffset=below?-10:10;cell.body.style.transformOrigin=Math.max(16,Math.min(panelWidth-16,anchor.left+anchor.width/2-left))+'px '+(below?'top':'bottom');
  }
}
function changeReviewContent(cell,write){write();}
function syncReviewCount(cell){
  const known=reviewCounts.has(cell.row[0]),empty=reviewCounts.get(cell.row[0])===0;
  uiText(cell.commentValue,known?number(reviewCounts.get(cell.row[0])):cell.reviewError?'!':'…');
  cell.commentValue.setAttribute('aria-busy',String(Boolean(cell.pending)));
  cell.toggle.classList.toggle('is-count-error',Boolean(cell.reviewError)&&!empty);
  if(empty)syncReviewVisibility(false,[cell]);else syncReviewToggle(cell);
}
function syncReviewToggle(cell){
  const empty=reviewCounts.get(cell.row[0])===0,open=reviewsOpen(cell),pinned=showChartReviews&&open;
  cell.toggle.disabled=empty;cell.chevron.hidden=empty;
  if(empty){cell.toggle.removeAttribute('aria-expanded');cell.toggle.removeAttribute('aria-controls');}
  else{cell.toggle.setAttribute('aria-expanded',String(open));cell.toggle.setAttribute('aria-controls',cell.target.id);}
  cell.toggle.setAttribute('aria-disabled',String(empty||pinned));
  const label=(empty||pinned?m('Reviews for '):open?m('Collapse reviews for '):m('Expand reviews for '))+cell.row[1];
  uiAttr(cell.toggle,'aria-label',label+(reviewCounts.has(cell.row[0])?' · '+m('Reviews')+': '+number(reviewCounts.get(cell.row[0])):''));
  uiAttr(cell.toggle,'aria-description',empty?m('No reviews yet.'):cell.reviewError?m('Review count could not be updated. Open reviews to retry.'):!reviewCounts.has(cell.row[0])?m('Loading review count...'):'');
  if(empty||pinned)cell.toggle.removeAttribute('aria-haspopup');else cell.toggle.setAttribute('aria-haspopup','dialog');
  cell.target.classList.toggle('is-pinned',pinned);
  cell.context.hidden=showChartReviews;
}
function syncReviewVisibility(animate=false,cells=[...cardViews.values()].map(view=>view.cell)){
  const control=$('show-chart-reviews'),state=pageDetails;control.checked=showChartReviews;control.disabled=phase!=='ready';
  if(showChartReviews)reviewPopoverOwner=null;
  for(const cell of cells){
    const empty=reviewCounts.get(cell.row[0])===0,restoreFocus=empty&&(cell.target.contains(document.activeElement)||document.activeElement===cell.toggle);
    if(empty){
      clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;cell.reviewTemporaryOpen=false;cell.reviewLoaded=false;
      if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
      if(cell.list.children.length){cell.list.replaceChildren();pruneEntries();}
    }
    const target=cell.target,open=reviewsOpen(cell),changed=cell.readingVisible!==open||target.hasAttribute('popover')===showChartReviews;
    if(changed){
      const from=cancelReadingMotion(cell);cell.readingVisible=open;target.inert=!open;
      if(showChartReviews){
        if(target.matches(':popover-open'))target.hidePopover();
        target.removeAttribute('popover');target.removeAttribute('style');cell.body.removeAttribute('style');target.setAttribute('role','region');target.hidden=!open;
      }else{
        target.setAttribute('popover','manual');target.setAttribute('role','dialog');
        if(open){
          reviewPopoverOwner=cell;target.hidden=false;positionReadingPopover(cell);
          if(!target.matches(':popover-open'))target.showPopover();animateReadingPopover(cell,true,animate,from);
        }else if(target.matches(':popover-open'))animateReadingPopover(cell,false,animate,from);
        else target.hidden=true;
      }
    }
    syncReviewToggle(cell);
    if(restoreFocus)cell.card.querySelector('.song-title')?.focus({preventScroll:true});
    if(state&&open&&animate)queueReviews(cell,state);
  }
  syncReviewRefresh();
}
function closeTemporaryReviews(cell,focus=false,animate=true){
  if(!cell)return;
  clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
  if(showChartReviews||!cell.reviewTemporaryOpen)return;
  if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
  cell.reviewTemporaryOpen=false;syncReviewVisibility(animate,[cell]);
  if(focus)cell.toggle.focus({preventScroll:true});
}
function bindReviewDrawer(cell){
  const card=cell.card;
  cell.toggle.addEventListener('pointerdown',event=>{cell.reviewPointerType=event.pointerType;});
  cell.toggle.addEventListener('click',event=>{
    if(showChartReviews||reviewCounts.get(cell.row[0])===0)return;
    dismissChartDescription(false,false);
    clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
    cell.reviewInput=event.detail===0?'keyboard':cell.reviewPointerType||'mouse';
    if(reviewPopoverOwner&&reviewPopoverOwner!==cell)closeTemporaryReviews(reviewPopoverOwner);
    cell.reviewTemporaryOpen=!cell.reviewTemporaryOpen;syncReviewVisibility(true,[cell]);
    if(!cell.reviewTemporaryOpen&&reviewPopoverOwner===cell)reviewPopoverOwner=null;
    if(cell.reviewTemporaryOpen&&cell.reviewInput==='keyboard')cell.target.focus({preventScroll:true});
  });
  bindReadingWheel(cell.target,cell.list,()=>!showChartReviews);
  const enter=()=>{clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;};
  const leave=event=>{
    if(event.pointerType==='touch'||cell.reviewInput==='keyboard'||card.contains(event.relatedTarget))return;
    clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=setTimeout(()=>{
      cell.reviewLeaveTimer=null;closeTemporaryReviews(cell);
    },180);
  };
  card.addEventListener('pointerenter',enter);card.addEventListener('pointerleave',leave);
  cell.target.addEventListener('pointerenter',enter);cell.target.addEventListener('pointerleave',leave);
  card.addEventListener('focusout',event=>{if(cell.reviewInput==='keyboard'&&!card.contains(event.relatedTarget))closeTemporaryReviews(cell);});
  cell.target.addEventListener('toggle',event=>{
    if(event.newState==='closed'&&cell.reviewTemporaryOpen&&!cell.target.matches(':popover-open'))closeTemporaryReviews(cell);
  });
}
function retireReviewCell(cell){
  cell.retired=true;clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
  cell.request?.abort();cancelReadingMotion(cell);
  if(reviewRefreshOwner?.cell===cell)releaseReviewRefresh(reviewRefreshOwner);
  if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
  if(cell.target.matches(':popover-open'))cell.target.hidePopover();cell.target.hidden=true;
}
function setupPageControls(){
  uiText($('show-chart-reviews-label'),m('Expand all reviews'));
  $('show-chart-reviews').addEventListener('change',()=>{
    showChartReviews=$('show-chart-reviews').checked;
    for(const {cell} of cardViews.values()){clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;cell.reviewTemporaryOpen=false;}
    syncReviewVisibility(true);
  });
  document.addEventListener('pointerdown',event=>{if(reviewPopoverOwner&&!reviewPopoverOwner.card.contains(event.target))closeTemporaryReviews(reviewPopoverOwner);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&reviewPopoverOwner){event.preventDefault();closeTemporaryReviews(reviewPopoverOwner,true);}});
  document.addEventListener('scroll',event=>{if(event.target===document||event.target===document.documentElement)closeTemporaryReviews(reviewPopoverOwner);},{capture:true,passive:true});
  globalThis.addEventListener?.('resize',()=>{if(reviewPopoverOwner)positionReadingPopover(reviewPopoverOwner);});
  globalThis.addEventListener?.('blur',()=>closeTemporaryReviews(reviewPopoverOwner));
  globalThis.addEventListener?.('focus',syncReviewRefresh);
  globalThis.addEventListener?.('storage',event=>{if(event.key===REVIEW_REFRESH_STORAGE_KEY||event.key===null)syncReviewRefresh();});
  syncReviewRefresh();
  const button=$('back-to-top');uiAttr(button,'aria-label',m('Back to top'));
  let shown=false;
  const update=()=>{
    const visible=globalThis.scrollY>Math.max(300,globalThis.innerHeight*.5);if(visible===shown)return;shown=visible;
    button.classList.toggle('is-visible',visible);button.inert=!visible;button.tabIndex=visible?0:-1;button.setAttribute('aria-hidden',String(!visible));
    if(!visible&&document.activeElement===button)$('filter-panel').querySelector('summary').focus({preventScroll:true});
  };
  button.addEventListener('click',()=>{$('filter-panel').querySelector('summary').focus({preventScroll:true});globalThis.scrollTo({top:0,behavior:motionAllowed()?'smooth':'auto'});});
  globalThis.addEventListener?.('scroll',update,{passive:true});globalThis.addEventListener?.('resize',update);
  update();syncReviewVisibility();
}
function setupScrolling(){
  const timers=new WeakMap(),targets=[...document.querySelectorAll('.settings-panel')].reverse();
  let hovered=null,dragged=null;
  const hover=target=>{if(hovered===target)return;hovered?.classList.remove('scroll-hover');hovered=target;hovered?.classList.add('scroll-hover');};
  const hit=event=>{
    for(const target of [...targets,document.documentElement]){
      const root=target===document.documentElement;
      if(target.hidden||!root&&target.tagName==='DIALOG'&&!target.open)continue;
      const rect=root?{top:0,right:globalThis.innerWidth,bottom:globalThis.innerHeight}:target.getBoundingClientRect();
      if(target.scrollHeight<=target.clientHeight||event.clientY<rect.top||event.clientY>rect.bottom)continue;
      if(event.clientX>=rect.right-9&&event.clientX<=rect.right)return target;
    }
    return null;
  };
  document.addEventListener('pointermove',event=>hover(dragged||hit(event)),{capture:true,passive:true});
  document.addEventListener('pointerdown',event=>{dragged=hit(event);hover(dragged);},{capture:true,passive:true});
  document.addEventListener('pointerup',event=>{dragged=null;hover(hit(event));},{capture:true,passive:true});
  document.addEventListener('pointercancel',()=>{dragged=null;hover(null);},{capture:true,passive:true});
  document.addEventListener('pointerleave',()=>{if(!dragged)hover(null);},{passive:true});
  globalThis.addEventListener?.('blur',()=>{dragged=null;hover(null);});
  document.addEventListener('scroll',event=>{
    const target=event.target===document?document.documentElement:event.target;
    if(!target?.classList)return;
    clearTimeout(timers.get(target));target.classList.add('is-scrolling');
    timers.set(target,setTimeout(()=>{target.classList.remove('is-scrolling');timers.delete(target);},300));
  },{capture:true,passive:true});
}
function installationControl(row,stats,card){
  const actions=element('div',undefined,'card-actions');stats.append(actions);
  if(row[8].dlc){
    const link=element('a',undefined,'download-button');link.href='https://spinsha.re/song/'+row[0];link.target='_blank';link.rel='noopener noreferrer';
    uiAttr(link,'aria-label',m('Download on SpinShare: ')+row[1]);uiAttr(link,'aria-description',m('DLC chart: authorize and download on SpinShare.'));link.append(icon('downloads'),element('span',m('Download on official site')));actions.append(link);card.append(stats);return;
  }
  const button=element('button',undefined,'download-button'),label=element('span',m("Download and install")),note=element('p','','install-note'),presence=element('span',m('Installation status unknown'),'install-presence'),progress=element('progress',undefined,'task-progress');
  button.type='button';uiAttr(button,'aria-label',m('Download and install ')+row[1]);uiAttr(button,'aria-description',m('Install all difficulties and replace matching files.'));button.append(icon('downloads'),label);button.addEventListener('click',()=>requestInstallation(row,button));
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.hidden=true;progress.hidden=true;actions.append(presence,button);card.append(stats,progress,note);
  installationViews.set(row[0],{button,label,note,presence,progress,row,songTitle:row[1]});updateInstallationView(row[0]);
}
function isContinuous(){return $('page-size').value==='all';}
function pageSize(){const size=Number($('page-size').value);return [10,20,30].includes(size)?size:20;}
function pages(){return isContinuous()?1:Math.max(1,Math.ceil(filtered.length/pageSize()));}
function renderPageLinks(suffix,ready){
  const links=$('page-links'+suffix);links.replaceChildren();if(!ready||!filtered.length||isContinuous())return;
  const total=pages(),count=pagerMedia?.matches?3:10,start=Math.max(1,Math.min(page-Math.floor((count-1)/2),total-count+1));
  const targets=[...new Set([1,...Array.from({length:Math.min(count,total)},(_,index)=>start+index),total])].sort((a,b)=>a-b);
  let previous=0;
  for(const target of targets){
    if(previous&&target>previous+1){const gap=element('span','…','page-gap');gap.setAttribute('aria-hidden','true');links.append(gap);}
    const button=element('button',String(target));button.type='button';uiAttr(button,'aria-label',m("Page ")+number(target));
    if(target===page)button.setAttribute('aria-current','page');button.addEventListener('click',()=>changePage(target));links.append(button);previous=target;
  }
}
function sortRows(rows){
  const control=$('sort'),mode=['date','views','downloads','level','title'].includes(control.value)?control.value:'date',direction=$('sort-direction').value==='asc'?1:-1;
  control.value=mode;
  const value=row=>mode==='date'?row[5]||null:mode==='title'?row[1]:mode==='level'?row[7]:row[8][mode];
  rows.sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av==null||bv==null)return av==null&&bv==null?b[0]-a[0]:av==null?1:-1;
    const order=typeof av==='string'?av.localeCompare(bv,mode==='title'?uiLanguage:'en'):av-bv;
    return order*direction||b[0]-a[0];
  });
}
async function rebuild(resolveUsers=true,preservePage=false){
  if(resolveUsers){clearTimeout(textFilterTimer);textFilterTimer=null;}
  appliedText=$('local-search').value.trim();const text=titleKey(appliedText),uploaders=new Set(),fields=[...searchScopes];
  if(textSearchWork&&(textSearchWork.query!==text||textSearchWork.rows!==currentRows||textSearchWork.generation!==cacheGeneration||!searchScopes.has('creator')||phase!=='ready'))stopTextSearch(true);
  if(text&&searchScopes.has('creator')){
    const users=userSearchCache.get(text)||[];scopeSearchUsers(users,currentRows);
    for(const row of currentRows){const user=profileCache.get(row[8].uploader);if(user&&titleKey(user.name).includes(text))uploaders.add(user.id);}
    for(const user of users)if(titleKey(user.name).includes(text))uploaders.add(user.id);
  }
  installationCandidates=rowsMatchingTags(currentRows.filter(row=>!text||fields.some(field=>titleKey(row[searchFields[field]]).includes(text)||field==='creator'&&uploaders.has(row[8].uploader))));
  const installationMode=installationFilterMode();
  if(phase==='ready'&&installationMode!=='all'){trimPresenceQueue(installationCandidates);queueInstallationChecks(installationCandidates);}
  filtered=installationMode==='all'?installationCandidates.slice():installationCandidates.filter(row=>installationPresence(row)===(installationMode==='installed'));
  tagResultCounts=countTagResults(filtered);
  if(!preservePage){page=1;visibleCount=scrollBatchSize;}
  if(resolveUsers)startTextSearch(text);
  syncSearchControls();syncInstallationFilter();
  sortRows(filtered);render();return textSearchWork?.promise;
}
function changePage(target,scroll=true){
  if(isContinuous()||phase!=='ready'||!Number.isInteger(target)||target<1||target>pages()||target===page)return;
  page=target;render();if(scroll)focusResults();
}
function jumpToPage(suffix){
  const input=$('page-number'+suffix),target=Number(input.value);
  if(Number.isInteger(target)&&target>=1&&target<=pages())changePage(target);else input.value=String(page);
}
function loadMore(){
  if(!isContinuous()||phase!=='ready'||renderedCount>=filtered.length)return;
  visibleCount=Math.min(visibleCount+scrollBatchSize,filtered.length);render(true);
}
function watchMore(ready){
  moreObserver?.disconnect();moreObserver=null;
  const button=$('load-more');button.hidden=!ready||!isContinuous()||renderedCount>=filtered.length;
  if(button.hidden||typeof IntersectionObserver!=='function')return;
  const observer=new IntersectionObserver(entries=>{if(moreObserver===observer&&entries.some(entry=>entry.target===button&&entry.isIntersecting))loadMore();},{rootMargin:'400px'});
  moreObserver=observer;observer.observe(button);
}
function focusResults(){$('results-start').scrollIntoView({block:'start'});$('results-start').focus({preventScroll:true});}
function render(append=false){
  const ready=phase==='ready',continuous=isContinuous();
  prepareTagAnchor(ready,continuous);
  if(!append){dismissChartTags();dismissChartDescription(false,false);}
  if(!ready){stopPageDetails();installationViews.clear();cardViews.clear();renderedCount=0;$('rows').replaceChildren();if(phase!=='ready')trimPresenceQueue();}
  const size=pageSize(),totalPages=pages();page=Math.max(1,Math.min(page,totalPages));
  const start=continuous?0:(page-1)*size,end=Math.min(continuous?visibleCount:start+size,filtered.length);
  const shown=ready?filtered.slice(start,end):[],wanted=new Map(shown.map(row=>[row[0],row])),reviewCells=[];
  for(const [id,view] of cardViews)if(wanted.get(id)!==view.row){retireReviewCell(view.cell);view.card.remove();cardViews.delete(id);installationViews.delete(id);}
  prunePageDetails(new Set([...cardViews.values()].map(view=>view.cell)));
  for(const row of shown){
    if(cardViews.has(row[0]))continue;
    const view=createChartCard(row);reviewCells.push(view.cell);cardViews.set(row[0],view);
  }
  $('rows').setAttribute('aria-busy',phase==='loading'||installationFilterPending?'true':'false');
  for(const [index,row] of shown.entries()){const card=cardViews.get(row[0]).card;if($('rows').children[index]!==card)$('rows').insertBefore(card,$('rows').children[index]||null);queueEntry(card,'chart:'+row[0]);}renderedCount=continuous?end:shown.length;pruneEntries();scheduleChartDescriptions();
  const emptyState=$('empty-state'),empty=$('empty');emptyState.hidden=ready&&filtered.length!==0;
  const installationProgress=installationFilterPending?installationProgressText(installationFilterRemaining):m('Checking installation status...');
  uiText(empty,phase==='loading'?m("Loading charts..."):phase==='error'?m("Search failed. Try again."):ready?installationFilterPending?installationProgress:textSearchWork?m('Searching uploader accounts...'):textSearchProblem||m("No matching charts. Try other filters."):m("Choose difficulty and dates, then select Filter charts."));
  empty.classList.toggle('error',phase==='error');loadingIndicator(empty,phase==='loading'||ready&&installationFilterPending&&filtered.length===0);
  $('query-retry').hidden=phase!=='error';$('query-retry').disabled=appExiting;
  uiText($('count'),ready?number(filtered.length)+m(" charts"):phase==='loading'?m("Searching..."):phase==='error'?m("Search failed"):m("Ready to search"));
  const scope=applied?[m("Rating: ")+applied.min+'–'+applied.max,applied.diffs.map(i=>labels[i]).join(' / ')]:[];
  if(applied?.dateFrom||applied?.dateTo)scope.push(m("Upload date: ")+(applied.dateFrom||'…')+' – '+(applied.dateTo||'…'));
  if(appliedText)scope.push(m("Text: ")+appliedText);uiText($('scope'),scope.join(m(" | ")));
  $('scope').hidden=!ready||$('filter-panel').open;
  const pageText=ready?(filtered.length?continuous?m("Showing ")+number(end)+m(" items"):m("Page ")+page+' / '+totalPages+m(" | Showing ")+number(start+1)+'–'+number(end)+m(" items"):m("No matching results")):phase==='loading'?m("Loading results..."):phase==='error'?m("Search failed"):m("Ready to search"),showPageNavigation=ready&&filtered.length>0&&!continuous&&totalPages>1,showContinuousControl=ready&&filtered.length>0&&continuous;
  for(const suffix of ['','-bottom']){
    uiText($('page-label'+suffix),pageText);
    const pager=$('pager'+suffix),displayOnly=!suffix&&showContinuousControl;
    pager.hidden=suffix?!showPageNavigation:!(showPageNavigation||showContinuousControl);pager.classList.toggle('is-display-only',displayOnly);
    $('page-controls'+suffix).hidden=continuous;$('page-jump'+suffix).hidden=continuous;
    renderPageLinks(suffix,ready);$('prev'+suffix).disabled=!ready||page===1;$('next'+suffix).disabled=!ready||page===totalPages;
    $('page-number'+suffix).value=String(page);$('page-number'+suffix).max=String(totalPages);
    $('page-number'+suffix).disabled=!ready||continuous;$('jump'+suffix).disabled=!ready||continuous;
    $('page-size'+suffix).value=continuous?'all':String(size);$('page-size'+suffix).disabled=phase!=='ready';
  }
  syncFilters();syncSearchControls();syncInstallationFilter();
  for(const id of ['sort','sort-direction'])$(id).disabled=phase!=='ready';
  syncReviewVisibility();
  if(ready&&reviewCells.length)watchPageReviews(reviewCells);
  watchMore(ready);
  syncCovers();
  if(typeof syncPreviewButtons==='function')syncPreviewButtons();
  if(ready){if(installationFilterMode()==='all')trimPresenceQueue(shown);queueInstallationChecks(append?shown.slice(-scrollBatchSize):shown);}
  if(ready||pendingTagAnchor?.viewport)restoreTagAnchor();
}
function setBusy(){syncFilters();}
function compact(data,criteria){
  const found=new Map();
  for(const song of data){
    if(!song||typeof song!=='object')continue;
    const id=Number(song.id);if(!Number.isSafeInteger(id)||id<=0)continue;
    const date=String(song.uploadDate?.date||'').slice(0,10);
    if((criteria.dateFrom||criteria.dateTo)&&(!validDate(date)||criteria.dateFrom&&date<criteria.dateFrom||criteria.dateTo&&date>criteria.dateTo))continue;
    const diffs=[];keys.forEach(([flag,key],index)=>{const rating=song[key];if(criteria.diffs.includes(index)&&song[flag]&&typeof rating==='number'&&Number.isFinite(rating)&&rating>=criteria.min&&rating<=criteria.max)diffs.push([index,rating]);});
    if(!diffs.length)continue;
    const cover=coverURL(song.cover),reference=String(song.fileReference||''),previewReference=/^spinshare_[a-f0-9]{1,64}$/i.test(reference)?reference:'',thumbnail=coverURL(song.thumbnail)||(previewReference?'https://spinshare.b-cdn.net/uploads/thumbnail/'+previewReference+'.jpg':'');
    found.set(id,[id,String(song.title||''),String(song.subtitle||''),String(song.artist||''),String(song.charter||''),String(song.uploadDate?.date||''),diffs,Math.min(...diffs.map(pair=>pair[1])),{cover,thumbnail,fileReference:reference,previewReference,updateHash:/^[a-f0-9]{32}$/i.test(song.updateHash||'')?song.updateHash:'',views:countValue(song.views),downloads:countValue(song.downloads),uploader:Number.isSafeInteger(song.uploader)&&song.uploader>0?song.uploader:null,dlc:song.dlc!==undefined&&song.dlc!==null&&song.dlc!==false,tags:cleanTags(song.tags),description:typeof song.description==='string'?song.description:''}]);
  }
  return [...found.values()];
}
function syncCatalogRefresh(){
  const busy=catalogManualBusy||catalogAutomaticBusy||catalogStartupBusy;
  $('refresh-data').disabled=appExiting||busy;
  loadingIndicator($('refresh-data'),catalogManualBusy);
}
function catalogPayloadError(result,fallback=m('Charts could not be loaded. Try again.')){
  const code=typeof result?.errorCode==='string'?result.errorCode:typeof result?.code==='string'?result.code:'';
  const manualWait=Number.isFinite(result?.retryAfterSeconds)&&result.retryAfterSeconds>0?Math.ceil(result.retryAfterSeconds):null,automaticWait=Number.isFinite(result?.automaticRetryAfterSeconds)&&result.automaticRetryAfterSeconds>0?Math.ceil(result.automaticRetryAfterSeconds):null;
  const cooling=['cooldown','manual_cooldown','backoff'].includes(result?.outcome),specific=code==='charts_cache_error'?m('The chart cache could not be read or saved safely. Check app data permissions and free space.'):CHART_ERROR_TEXT[code]||INSTALLER_ERROR_TEXT[code]||(code==='charts_cooldown'||code==='charts_automatic_backoff'||cooling?m('The previous catalog request used server resources. Retry after the refresh interval.'):fallback);
  const wait=manualWait!==null?m('Manual update can be retried in ')+number(manualWait)+m(' seconds.'):automaticWait!==null?m('Automatic updates will retry in ')+number(automaticWait)+m(' seconds. Manual retry is still available.'):'',message=wait?specific+'\n'+wait:specific;
  const error=uiError(message);error.code=code;error.catalogResult=result;return error;
}
function catalogUpdateFailed(result){return Boolean(result?.refreshError)||['failed','backoff','cooldown','manual_cooldown'].includes(result?.outcome);}
function catalogToastFailure(error){return (CHART_TOAST_ERROR_TEXT[error?.code]||errorText(error))+'\n'+m('Continuing with the last saved chart data.');}
function updateCatalogDeadlines(result){
  if(Number.isFinite(result?.nextAllowedAt))catalogNextAllowedAt=Math.max(0,result.nextAllowedAt);
  if(Number.isFinite(result?.automaticNextAllowedAt))catalogAutomaticNextAllowedAt=Math.max(0,result.automaticNextAllowedAt);
  syncCatalogRefresh();
}
async function requestCatalog(kind,signal,onProgress){
  const path=CHART_ENDPOINTS[kind];if(!path||!['cache','manual','automatic'].includes(kind))throw uiError(m('Charts could not be loaded. Try again.'));
  const method=kind==='cache'?'GET':'POST',headers={'X-SpinShare-Key':INSTALL_KEY};if(method==='POST')headers['Content-Type']='application/json';
  const response=await fetch(INSTALL_ORIGIN+path,{method,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',headers,...(method==='POST'?{body:'{}'}:{}),signal});
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
async function timedCatalogRequest(kind,onProgress){
  const request=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;request.abort();},requestTimeout);
  try{return await requestCatalog(kind,request.signal,onProgress);}
  catch(error){
    if(timedOut)throw uiError(m(kind==='cache'?'Loading charts timed out. Try again.':'Updating chart data timed out. Try again.'));
    if(error instanceof TypeError)throw uiError(m('Cannot reach the local chart service. Reopen SpinShareBrowser.exe and try again.'));
    throw error;
  }finally{clearTimeout(timer);}
}
function catalogResultAvailable(result){return Array.isArray(result?.data)&&(result.data.length>0||Number.isFinite(result.fetchedAt)||result.cached===true||result.stale===false);}
function invalidateCatalogDerived(){
  if(typeof reconcilePreviewCatalog==='function')reconcilePreviewCatalog(catalog);
  cacheGeneration++;reviewCounts.clear();reviewCache.clear();profileCache.clear();userSearchCache.clear();installedCharts.clear();presenceGeneration++;presenceQueue.clear();
}
function publishCatalogResult(result){
  if(!catalogResultAvailable(result))return {available:Array.isArray(catalog),changed:false};
  const fetchedAt=Number.isFinite(result.fetchedAt)?result.fetchedAt:null;
  // A hidden WebView can miss the native tray worker's completed refresh.  On
  // return, the automatic endpoint reports that the disk cache is already
  // fresh (changed=false for this request), while fetchedAt identifies a newer
  // cache generation than the one rendered by this client.
  const externalRefresh=catalog!==null&&result.outcome==='fresh'&&fetchedAt!==catalogFetchedAt;
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
  clearTimeout(catalogHelpTimer);catalogHelpTimer=null;
  const button=$('refresh-data-help'),panel=$('refresh-data-help-panel');if(!button||!panel)return;
  if(visible&&(button.disabled||!hostVisible||document.hidden))return;
  const open=panel.matches?.(':popover-open');button.classList.toggle('is-active',visible);button.setAttribute('aria-expanded',String(visible));
  if(!visible){if(open)panel.hidePopover();return;}
  if(!open)panel.showPopover();positionCatalogHelp();
}
function setupCatalogHelp(){
  const button=$('refresh-data-help'),panel=$('refresh-data-help-panel');
  button.addEventListener('click',event=>event.stopPropagation());
  panel.addEventListener('toggle',()=>{const visible=panel.matches(':popover-open');button.classList.toggle('is-active',visible);button.setAttribute('aria-expanded',String(visible));if(visible)positionCatalogHelp();});
  globalThis.addEventListener?.('resize',positionCatalogHelp);globalThis.addEventListener?.('scroll',positionCatalogHelp,true);
}

function pauseCatalogToast(){
  if(!catalogToastTimer)return;clearTimeout(catalogToastTimer);catalogToastTimer=null;
  catalogToastRemaining=Math.max(250,catalogToastRemaining-(Date.now()-catalogToastStartedAt));
}
function resumeCatalogToast(){
  const toast=$('catalog-sync-toast');if(!toast||toast.hidden||catalogToastTimer||document.hidden||!hostVisible)return;
  catalogToastStartedAt=Date.now();catalogToastTimer=setTimeout(()=>hideCatalogToast(),catalogToastRemaining||4200);
}
function flushCatalogToast(){if(catalogPendingToast&&hostVisible&&!document.hidden){const pending=catalogPendingToast;catalogPendingToast=null;showCatalogToast(pending.message,pending.kind);}}
function hideCatalogToast(immediate=false){
  const toast=$('catalog-sync-toast');clearTimeout(catalogToastTimer);catalogToastTimer=null;catalogToastRemaining=0;
  if(!toast||toast.hidden)return;catalogToastMotion?.cancel();catalogToastMotion=null;
  const finish=()=>{toast.hidden=true;};
  const animation=immediate?null:playMotion(toast,[{opacity:1},{opacity:0}],{duration:MOTION_MS.feedback,easing:'cubic-bezier(.4,0,1,1)',fill:'both'});
  if(animation){catalogToastMotion=animation;animation.finished.then(finish,finish);}else finish();
}
function showCatalogToast(message,kind='success'){
  if(!hostVisible||document.hidden){catalogPendingToast={message,kind};return;}
  const toast=$('catalog-sync-toast');catalogToastMotion?.cancel();catalogToastMotion=null;clearTimeout(catalogToastTimer);
  toast.hidden=false;toast.dataset.kind=kind;uiText($('catalog-sync-toast-message'),message);
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
function showCatalogSyncLoading(noCache=false){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='loading';dialog.setAttribute('aria-busy','true');catalogFailureHasData=!noCache;
  uiText($('catalog-sync-title'),m('Updating chart data'));
  uiText($('catalog-sync-message'),m(noCache?'Preparing chart data for your first search.':'Your saved chart data is over 12 hours old. Updating it now.'));
  uiText($('catalog-sync-detail'),'');$('catalog-sync-actions').hidden=true;for(const id of ['catalog-sync-retry','catalog-sync-fallback'])$(id).disabled=false;
  updateCatalogSyncProgress({phase:'idle'});openCatalogSyncDialog();
}
function showCatalogSyncError(hasData,error){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='error';dialog.setAttribute('aria-busy','false');catalogFailureHasData=hasData;
  uiText($('catalog-sync-title'),m('Chart data could not be updated'));
  uiText($('catalog-sync-message'),m(hasData?'You can retry or continue with the last saved data.':'No saved chart data is available. Retry or quit the app.'));
  uiText($('catalog-sync-progress'),m('Update paused'));uiText($('catalog-sync-detail'),errorText(error));
  $('catalog-sync-actions').hidden=false;uiText($('catalog-sync-fallback'),m(hasData?'Use local data':'Quit app'));for(const id of ['catalog-sync-retry','catalog-sync-fallback'])$(id).disabled=false;openCatalogSyncDialog();
}
function showCatalogSyncSuccess(){
  const dialog=$('catalog-sync-dialog');dialog.dataset.state='success';dialog.setAttribute('aria-busy','false');
  uiText($('catalog-sync-title'),m('Chart data is up to date'));uiText($('catalog-sync-message'),m('The latest chart data is ready.'));uiText($('catalog-sync-progress'),m('Update complete'));uiText($('catalog-sync-detail'),'');$('catalog-sync-actions').hidden=true;
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
  const staleAt=Number.isFinite(catalogFetchedAt)?catalogFetchedAt+CATALOG_STALE_MS:Date.now();return Math.max(staleAt,catalogAutomaticNextAllowedAt||0);
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
  try{
    const result=await timedCatalogRequest('automatic',startup?updateCatalogSyncProgress:undefined);stopCatalogStatusPolling();const published=publishCatalogResult(result);await rebuildPublishedCatalog(published.changed);
    if(catalogUpdateFailed(result)||result.stale===true||!published.available)throw catalogPayloadError(result,m('Chart data could not be updated.'));
    if(startup){catalogStartupBusy=false;syncFilters();showCatalogSyncSuccess();}
    else if(published.serverChanged)showCatalogToast(m('Chart data was updated.'));
    scheduleAutomaticCatalogSync();return true;
  }catch(error){
    stopCatalogStatusPolling();const published=publishCatalogResult(error.catalogResult);await rebuildPublishedCatalog(published.changed);
    if(!Number.isFinite(catalogAutomaticNextAllowedAt)||catalogAutomaticNextAllowedAt<=Date.now())catalogAutomaticNextAllowedAt=Date.now()+5*60*1000;
    const available=Array.isArray(catalog);if(startup)showCatalogSyncError(available,error);else if(available)showCatalogToast(catalogToastFailure(error),'error');
    if(available)scheduleAutomaticCatalogSync();return false;
  }finally{catalogAutomaticBusy=false;syncCatalogRefresh();}
}
async function manualCatalogSync(startup=false){
  if(catalogManualBusy||catalogAutomaticBusy||!startup&&catalogStartupBusy||appExiting)return false;catalogManualBusy=true;syncCatalogRefresh();if(startup){showCatalogSyncLoading(!Array.isArray(catalog));startCatalogStatusPolling();}
  try{
    const result=await timedCatalogRequest('manual',startup?updateCatalogSyncProgress:undefined);stopCatalogStatusPolling();const published=publishCatalogResult(result);await rebuildPublishedCatalog(published.changed);
    if(catalogUpdateFailed(result)||!published.available)throw catalogPayloadError(result,m('Chart data could not be updated.'));
    if(startup){catalogStartupBusy=false;syncFilters();showCatalogSyncSuccess();}else showCatalogToast(m(published.serverChanged?'Chart data was updated.':'Chart data is already up to date.'));
    scheduleAutomaticCatalogSync();return true;
  }catch(error){
    stopCatalogStatusPolling();const published=publishCatalogResult(error.catalogResult);await rebuildPublishedCatalog(published.changed);
    if(startup)showCatalogSyncError(Array.isArray(catalog),error);else showCatalogToast(catalogToastFailure(error),'error');return false;
  }finally{catalogManualBusy=false;syncCatalogRefresh();}
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
async function readJSONResponse(response,limit,onProgress){
  if(!response.ok)throw uiError(m("SpinShare is unavailable (")+response.status+m("). Try again later."));
  if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw uiError(m("This response is too large. Open SpinShare to view it."));}
  if(!response.body)throw uiError(m("Empty response. Try again."));
  const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let bytes=0,lastProgress=0;
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>limit){await reader.cancel();throw uiError(m("This response is too large. Open SpinShare to view it."));}
      parts.push(decoder.decode(chunk.value,{stream:true}));
      if(onProgress&&Date.now()-lastProgress>=250){lastProgress=Date.now();onProgress(bytes);}
    }
  }finally{reader.releaseLock();}
  parts.push(decoder.decode());
  try{return JSON.parse(parts.join(''));}catch{throw uiError(m("Loading failed. Please try again."));}
}
async function readReviews(id,signal,refresh=false,priority='high',refreshOwner=null){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!refresh&&reviewCache.has(id))return reviewCache.get(id);
  const generation=cacheGeneration;
  if(refresh)beginReviewRefresh(refreshOwner);
  const response=await fetch('https://spinsha.re/api/song/'+id+'/reviews',{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',priority,signal});
  const result=await readJSONResponse(response,2*1024*1024),data=result?.data;
  if(result?.status!==200||!data||typeof data!=='object'||Array.isArray(data))throw uiError(m("Reviews could not be loaded."));
  // SpinShare omits reviews only for an empty collection, whose average is false.
  const entries=!Object.hasOwn(data,'reviews')&&data.average===false?[]:data.reviews;
  if(!Array.isArray(entries))throw uiError(m("Reviews could not be loaded."));
  const items=entries.map(item=>{if(!item||typeof item!=='object')throw uiError(m("Reviews could not be loaded."));return {user:publicUser(item.user),text:String(item.comment||''),date:String(item.reviewDate?.date||''),timezone:String(item.reviewDate?.timezone||''),recommended:item.recommended===true?true:item.recommended===false?false:null};});
  const average=typeof data.average==='number'&&Number.isFinite(data.average)&&data.average>=0&&data.average<=100?data.average:null;
  const reviews={items,total:items.length,comments:items.filter(item=>item.text.trim()).length,average};
  if(!signal.aborted&&generation===cacheGeneration){reviewCache.delete(id);remember(reviewCache,id,reviews);}
  return reviews;
}
async function readSharedUser(id,signal,read){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const generation=cacheGeneration;
  let pending=profileRequests.get(id);
  if(!pending||pending.generation!==generation||pending.request.signal.aborted){
    const request=new AbortController(),timer=setTimeout(()=>request.abort(),20000);
    pending={generation,request,users:0,promise:null};
    pending.promise=(async()=>{
      try{return await read(request.signal,generation);}
      finally{clearTimeout(timer);if(profileRequests.get(id)===pending)profileRequests.delete(id);}
    })();
    profileRequests.set(id,pending);
  }
  pending.users++;let released=false,rejectAbort;
  const aborted=new Promise((resolve,reject)=>{rejectAbort=reject;});
  const release=()=>{if(released)return;released=true;if(--pending.users===0)pending.request.abort();};
  const onAbort=()=>{release();rejectAbort(new DOMException('Aborted','AbortError'));};
  signal.addEventListener('abort',onAbort,{once:true});
  try{
    const user=await Promise.race([pending.promise,aborted]);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    return user;
  }finally{signal.removeEventListener('abort',onAbort);release();}
}
async function readUserProfile(id,signal){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(profileCache.has(id))return profileCache.get(id);
  return readSharedUser(id,signal,async(request,generation)=>{
    const response=await fetch('https://spinsha.re/api/user/'+id,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',priority:'low',signal:request});
    const result=await readJSONResponse(response,2*1024*1024),data=result?.data;
    if(result?.status!==200||!data||typeof data!=='object'||Array.isArray(data))throw uiError(m("Uploader profile unavailable."));
    const user=publicUser(data);if(user.id!==id)throw uiError(m("Uploader account mismatch."));
    if(request.aborted)throw new DOMException('Aborted','AbortError');
    if(generation===cacheGeneration)remember(profileCache,id,user,2048);return user;
  });
}
async function readUserSearch(query,signal){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!canSearchUsers(query))return [];
  if(userSearchCache.has(query))return userSearchCache.get(query);
  return readSharedUser('search:'+query,signal,async(request,generation)=>{
    const response=await fetch('https://spinsha.re/api/searchUsers',{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',priority:'low',headers:{'Content-Type':'application/json'},body:JSON.stringify({searchQuery:query}),signal:request});
    const result=await readJSONResponse(response,512*1024);
    if(result?.status!==200||!Array.isArray(result.data))throw uiError(m('Uploader search failed. Please retry.'));
    const users=result.data.filter(user=>typeof user?.username==='string'&&titleKey(user.username).includes(query)).map(publicUser).filter(user=>user.id);
    if(request.aborted)throw new DOMException('Aborted','AbortError');
    if(generation===cacheGeneration)remember(userSearchCache,query,users,32,2*1024*1024);return users;
  });
}
function prunePageDetails(cells){
  if(!pageDetails)return;
  if(reviewRefreshOwner?.state===pageDetails&&!cells.has(reviewRefreshOwner.cell))releaseReviewRefresh(reviewRefreshOwner);
  for(const [target,cell] of pageDetails.targets)if(!cells.has(cell)){pageDetails.observer?.unobserve(target);pageDetails.targets.delete(target);}
  pageDetails.jobs=pageDetails.jobs.filter(job=>{
    if(job.kind==='reviews'){if(!cells.has(job.cell)){job.cell.pending=false;releaseReviewRefresh(job.refreshOwner);return false;}return true;}
    job.cells=job.cells.filter(cell=>cells.has(cell));
    if(!job.cells.length&&pageDetails.profiles.get(job.id)===job)pageDetails.profiles.delete(job.id);
    return Boolean(job.cells.length);
  });
  for(const job of pageDetails.profiles.values()){
    job.cells=job.cells.filter(cell=>cells.has(cell));
    if(!job.cells.length){job.request?.abort();pageDetails.profiles.delete(job.id);}
  }
}
function stopPageDetails(){
  moreObserver?.disconnect();moreObserver=null;
  for(const {cell} of cardViews.values())retireReviewCell(cell);
  clearTimeout(reviewRefreshTimer);reviewRefreshTimer=null;
  if(!pageDetails)return;pageDetails.stopped=true;pageDetails.observer?.disconnect();pageDetails.jobs.length=0;
  if(reviewRefreshOwner?.state===pageDetails)releaseReviewRefresh(reviewRefreshOwner);
  pageDetails.targets.clear();pageDetails.profiles.clear();for(const request of pageDetails.controllers)request.abort();pageDetails=null;
}
function watchPageReviews(cells){
  const state=pageDetails||{stopped:false,jobs:[],controllers:new Set(),profiles:new Map(),targets:new Map(),active:0,observer:null};pageDetails=state;
  const queue=visible=>{
    if(state.stopped)return;const fresh=visible.filter(cell=>!cell.seen);for(const cell of fresh)cell.seen=true;
    for(const cell of visible)queueReviews(cell,state);for(const cell of fresh)queueProfile(cell,state);
  };
  for(const cell of cells){
    if(!cell.watched){cell.watched=true;cell.refresh.addEventListener('click',()=>queueReviews(cell,state,true));}
    // Only rendered pages/batches enter this bounded queue; collapsed cards still get counts.
    queueReviews(cell,state);
    const user=profileCache.get(cell.row[8].uploader);if(user)showProfile(cell,user);
  }
  if(typeof IntersectionObserver==='function'){
    if(!state.observer)state.observer=new IntersectionObserver(entries=>{
      const visible=[];for(const entry of entries)if(entry.isIntersecting){const cell=state.targets.get(entry.target);if(cell){state.observer.unobserve(entry.target);state.targets.delete(entry.target);visible.push(cell);}}queue(visible);
    },{rootMargin:'40px'});
    for(const cell of cells){const target=cardViews.get(cell.row[0])?.card||cell.target;state.targets.set(target,cell);state.observer.observe(target);}
  }else queue(cells);
}
function queueProfile(cell,state){
  const id=cell.row[8].uploader;if(!id||state.stopped||cell.retired)return;
  if(profileCache.has(id)){showProfile(cell,profileCache.get(id));return;}
  const ongoing=state.profiles.get(id);
  if(ongoing){ongoing.cells.push(cell);return;}
  const job={kind:'profile',id,cells:[cell]};state.profiles.set(id,job);state.jobs.push(job);pumpPageReviews(state);
}
function queueReviews(cell,state,refresh=false){
  if(state.stopped||cell.retired||cell.pending)return;
  if(!refresh&&reviewCounts.has(cell.row[0])&&(!reviewsOpen(cell)||cell.reviewLoaded)){syncReviewCount(cell);return;}
  if(!refresh&&cell.reviewError&&!reviewsOpen(cell))return;
  refresh=refresh||Boolean(cell.reviewError)&&reviewsOpen(cell)&&reviewCounts.has(cell.row[0])&&!reviewCache.has(cell.row[0]);
  const refreshOwner=refresh?reserveReviewRefresh(cell,state):null;
  if(refresh&&!refreshOwner)return;
  if(refresh){cell.reviewRetried=false;cell.reviewLoaded=false;}
  cell.reviewError='';
  cell.pending=true;syncReviewRefresh();
  syncReviewCount(cell);
  changeReviewContent(cell,()=>{uiText(cell.summary,m("Reviews")+': '+m("Queued"));loadingIndicator(cell.summary,true,true);uiText(cell.note,'');cell.target.setAttribute('aria-busy','true');});
  if(!refresh&&reviewCache.has(cell.row[0]))loadInlineReviews(cell,state);
  else{state.jobs.push({kind:'reviews',cell,refresh,refreshOwner});pumpPageReviews(state);}
}
function pumpPageReviews(state){
  while(!state.stopped&&state.active<2&&state.jobs.length){
    let next=state.jobs.findIndex(job=>job.kind==='reviews'&&reviewsOpen(job.cell));
    if(next<0)next=state.jobs.findIndex(job=>job.kind==='reviews'&&job.cell.seen);
    if(next<0)next=state.jobs.findIndex(job=>job.kind==='profile');
    const [job]=state.jobs.splice(next<0?0:next,1);state.active++;runPageJob(job,state);
  }
}
async function runPageJob(job,state){
  try{if(job.kind==='profile')await loadProfile(job,state);else await loadInlineReviews(job.cell,state,job.refresh,job.refreshOwner);}
  finally{state.active--;pumpPageReviews(state);}
}
async function loadProfile(job,state){
  const request=new AbortController();job.request=request;state.controllers.add(request);const timer=setTimeout(()=>request.abort(),20000);
  try{
    const user=await readUserProfile(job.id,request.signal);if(state.stopped||request.signal.aborted)return;
    for(const cell of job.cells)showProfile(cell,user);
  }catch(error){if(!state.stopped)for(const cell of job.cells)uiAttr(cell.charterAvatar,'aria-description',m('Avatar could not be loaded.'));}
  finally{clearTimeout(timer);state.controllers.delete(request);if(state.profiles.get(job.id)===job)state.profiles.delete(job.id);}
}
function showProfile(cell,user){
  if(cell.retired||cell.profile===user)return;cell.profile=user;
  if(cell.row[4].trim()&&cell.row[4].trim().toLocaleLowerCase()===user.name.trim().toLocaleLowerCase()){
    const link=userLink(user,'charter-name'),source=m("Avatar from uploader: ")+user.name;
    uiAttr(cell.charterAvatar,'aria-description',source);uiAttr(link,'aria-label',user.name);
    cell.charterAvatar.replaceChildren(makeAvatar(user.avatar,user.name));cell.charterIdentity.replaceChildren(element('span',m("Charter"),'meta-label'),link);
  }else{
    uiAttr(cell.charterAvatar,'aria-description',m('Uploader account shown below.'));
    cell.uploader.replaceChildren(element('span',m("Uploader"),'meta-label'),makeAvatar(user.avatar,user.name),userLink(user,'uploader-name'));cell.uploader.hidden=false;
  }
}
function reviewElement(item){
  const article=element('article',undefined,'review-item'),head=element('div',undefined,'review-head'),identity=element('div',undefined,'review-identity'),meta=element('div',undefined,'review-meta');
  article.setAttribute('role','listitem');identity.append(userLink(item.user,'review-author'));
  if(item.user.pronouns)identity.append(element('span',item.user.pronouns,'review-pronouns'));
  if(item.user.verified)identity.append(element('span',m("Verified"),'user-badge'));
  if(item.user.patron)identity.append(element('span',m("Patreon supporter"),'user-badge'));
  const date=element('time',item.date.replace(/\.0+$/,'')||m("Date unavailable"),'review-date');
  uiAttr(date,'aria-label',m('Review date')+': '+(item.date.replace(/\.0+$/,'')||m('Date unavailable')));if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(item.date))date.setAttribute('datetime',item.date.slice(0,19).replace(' ','T'));
  meta.append(element('span',item.recommended===true?m("Recommended"):item.recommended===false?m("Not recommended"):m("Unrated"),item.recommended===true?'recommend':item.recommended===false?'not-recommend':''),date);
  const info=element('div',undefined,'review-person');info.append(identity,meta);head.append(makeAvatar(item.user.avatar,item.user.name),info);
  article.append(head,element('p',item.text.trim()?item.text:m("Rating only"),'review-text'));return article;
}
async function renderAllReviews(cell,result,state,request){
  const fragment=document.createDocumentFragment(),entries=[];
  if(!result.items.length)fragment.append(element('p',m("No reviews yet."),'reviews-empty'));
  for(let start=0;start<result.items.length;start+=40){
    if(state.stopped||request.signal.aborted)return false;
    for(const item of result.items.slice(start,start+40)){const node=reviewElement(item);fragment.append(node);entries.push([node,'review:'+cell.row[0]+':'+item.user.id+':'+item.date]);}
    if(start+40<result.items.length)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(state.stopped||request.signal.aborted||!reviewsOpen(cell))return false;
  // Build off-DOM in bounded batches; the temporary popover never resizes the document.
  changeReviewContent(cell,()=>{
    uiText(cell.summary,number(result.total)+m(" ratings | ")+number(result.comments)+m(" comments")+(result.average===null?'':' · '+result.average+m("% recommended")));
    cell.list.replaceChildren(fragment);uiText(cell.note,'');
  });
  for(const [node,key] of entries)queueEntry(node,key,'review');
  return true;
}
async function loadInlineReviews(cell,state,refresh=false,refreshOwner=null){
  if(state.stopped||cell.retired){cell.pending=false;releaseReviewRefresh(refreshOwner);return;}
  const generation=cacheGeneration,request=new AbortController();cell.request=request;state.controllers.add(request);let timedOut=false,reading=true,retry=false;
  uiText(cell.summary,m("Loading reviews..."));loadingIndicator(cell.summary,true);
  const timer=setTimeout(()=>{timedOut=true;request.abort();},20000);
  try{
    const result=await readReviews(cell.row[0],request.signal,refresh,reviewsOpen(cell)?'high':'low',refreshOwner);
    if(state.stopped||cell.retired||generation!==cacheGeneration)return;if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
    reading=false;clearTimeout(timer);
    reviewCounts.set(cell.row[0],result.total);syncReviewCount(cell);
    if(!reviewsOpen(cell)||!await renderAllReviews(cell,result,state,request))return;
    cell.reviewLoaded=true;if(!state.stopped)uiText(cell.note,'');
  }catch(error){
    retry=!refresh&&reading&&!state.stopped&&!cell.retired&&!cell.reviewRetried&&(timedOut||!request.signal.aborted&&error instanceof TypeError);
    if(retry)cell.reviewRetried=true;
    else if(!state.stopped&&!cell.retired){
      cell.reviewError=timedOut?m("Reading reviews timed out."):error instanceof TypeError?m("Cannot reach SpinShare reviews."):errorText(error);
      changeReviewContent(cell,()=>{cell.list.replaceChildren();pruneEntries();uiText(cell.summary,m("Reviews unavailable"));uiText(cell.note,cell.reviewError+m(" Select Refresh reviews to retry."));});
    }
  }finally{
    clearTimeout(timer);state.controllers.delete(request);
    if(cell.request===request){
      cell.request=null;cell.pending=false;loadingIndicator(cell.summary,false);
      if(!state.stopped&&!cell.retired){cell.target.setAttribute('aria-busy','false');syncReviewCount(cell);}
      if(!state.stopped&&retry)queueReviews(cell,state);
    }
    releaseReviewRefresh(refreshOwner);syncReviewRefresh();
  }
}
async function apply(){
  if(phase==='loading'||catalogStartupBusy||appExiting)return;
  let criteria;try{criteria=readCriteria();}catch(error){setStatus(errorText(error),true);return;}
  const request=new AbortController();controller=request;let timedOut=false,timer=null;
  try{
    stopTextSearch(true);clearTimeout(textFilterTimer);textFilterTimer=null;
    currentRows=[];filtered=[];phase='loading';page=1;visibleCount=scrollBatchSize;render();
    // Startup normally restores this cache before the controls unlock. Keep a
    // cache-only fallback here for isolated reloads; filtering never triggers a remote update.
    if(catalog===null){
      timer=setTimeout(()=>{timedOut=true;request.abort();},requestTimeout);setStatus(m('Loading charts...'));
      const result=await loadRemote(request.signal);if(controller!==request)return;if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
      if(!publishCatalogResult(result).available)throw uiError(m('Charts could not be loaded. Try again.'));
      clearTimeout(timer);timer=null;
    }
    if(controller!==request)return;if(request.signal.aborted&&!timedOut)throw new DOMException('Aborted','AbortError');
    const rows=compact(catalog,criteria);
    if(lastAppliedCriteria&&JSON.stringify(criteria)!==JSON.stringify(lastAppliedCriteria)){$('local-search').value='';appliedText='';}
    applied=criteria;lastAppliedCriteria=criteria;currentRows=rows;phase='ready';
    syncSearchControls();setStatus('');await rebuild();
  }catch(error){
    if(controller!==request)return;request.abort();
    const message=error.name==='AbortError'?(timedOut?m('Loading charts timed out. Try again.'):m('Search cancelled.')):error instanceof TypeError?m('Connection failed. Check your network and try again.'):errorText(error);
    currentRows=[];filtered=[];applied=null;phase='error';render();setStatus(message,true);
  }finally{clearTimeout(timer);if(controller===request){controller=null;syncFilters();}}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();return apply();});
$('apply-filters').addEventListener('click',event=>{event.preventDefault();return apply();});
$('refresh-data').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();return manualCatalogSync();});
$('query-retry').addEventListener('click',()=>apply());
$('chart-search-form').addEventListener('submit',event=>{event.preventDefault();textSearchProblem='';if(phase==='ready')return rebuild();});
$('search-clear').addEventListener('click',()=>{stopTextSearch(true);$('local-search').value='';syncSearchControls();$('local-search').focus();if(phase==='ready')return rebuild();});
for(const field of Object.keys(searchFields))$('search-scope-'+field).addEventListener('click',()=>changeSearchScope(field));
$('search-retry').addEventListener('click',()=>{textSearchProblem='';if(phase==='ready')return rebuild();});
$('installation-filter').addEventListener('change',()=>{if(phase==='ready'&&!appExiting)rebuild(false);});
$('installation-filter-retry').addEventListener('click',()=>refreshInstallationChecks(true));
$('reset-filters').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();resetFilters();});
$('date-preset').addEventListener('change',applyDatePreset);
for(const id of ['date-from','date-to']){
  $(id).addEventListener('input',()=>{$('date-preset').value='custom';syncDates();syncFilters();});
  $(id).addEventListener('change',()=>{$(id).value=$(id).value.trim();syncDates();syncFilters();});
  $(id+'-open').addEventListener('click',()=>openDatePicker(id));
  $(id+'-open').setAttribute('aria-haspopup','dialog');$(id+'-open').setAttribute('aria-controls','date-calendar');$(id+'-open').setAttribute('aria-expanded','false');
  $(id+'-picker').addEventListener('change',()=>{if(appExiting)return;$(id).value=$(id+'-picker').value;$('date-preset').value='custom';syncDates();syncFilters();$(id+'-open').focus({preventScroll:true});});
}
for(const input of document.querySelectorAll('input[name="diff"],#min,#max'))input.addEventListener('input',syncFilters);
$('filter-panel').addEventListener('toggle',()=>{setCatalogHelp(false);$('scope').hidden=$('filter-panel').open||phase!=='ready';});
$('local-search').addEventListener('input',()=>{stopTextSearch(true);syncSearchControls();clearTimeout(textFilterTimer);textFilterTimer=null;if(phase==='ready')textFilterTimer=setTimeout(()=>{textFilterTimer=null;rebuild();},300);});
for(const id of ['sort','sort-direction'])$(id).addEventListener('change',()=>rebuild());
for(const suffix of ['','-bottom']){
  $('page-size'+suffix).addEventListener('change',()=>{$('page-size').value=$('page-size'+suffix).value;page=1;visibleCount=scrollBatchSize;render();if(suffix)focusResults();});
  $('prev'+suffix).addEventListener('click',()=>changePage(page-1));$('next'+suffix).addEventListener('click',()=>changePage(page+1));
  $('jump'+suffix).addEventListener('click',()=>jumpToPage(suffix));
  $('page-number'+suffix).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpToPage(suffix);}});
}
$('load-more').addEventListener('click',loadMore);
pagerMedia?.addEventListener('change',()=>{for(const suffix of ['','-bottom'])renderPageLinks(suffix,phase==='ready');});
globalThis.addEventListener?.('focus',()=>{if(!document.hidden){refreshInstallationChecks();maybeRunAutomaticCatalogSync();}});
setupTagFilters();setupRuntime();setupPageControls();applyDatePreset();render();syncFilters();startCatalogRuntime();
