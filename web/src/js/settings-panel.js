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
  if(appExiting||settingsBusy||settingsStale)return;
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
  if(state?.exiting===true&&!appExiting){markAppExiting(true);updateAllInstallationViews();renderActivity();syncFilters();refreshActivity();}
  if(typeof state?.customChrome!=='boolean'||typeof state.maximized!=='boolean')return;
  document.documentElement.classList.toggle('desktop-chrome',state.customChrome);
  document.documentElement.classList.toggle('desktop-maximized',state.maximized);
  $('window-controls').hidden=!state.customChrome;
  $('window-controls').classList.toggle('is-maximized',state.maximized);
  uiAttr($('window-maximize'),'aria-label',m(state.maximized?'Restore window':'Maximize window'));
  scheduleWindowRegions();
}
