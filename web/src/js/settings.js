function hasActiveInstallations(){return installationWorkActive()||deletionWorkActive();}
function refreshSettingsControls(){
  const locked=Boolean(settingsBusy)||appExiting,active=hasActiveInstallations();
  $('settings-default').disabled=locked||!settingsLoaded||active||INSTALL_DIRECTORY===DEFAULT_INSTALL_DIRECTORY;
  $('settings-select').disabled=locked||!settingsLoaded||active;
  for(const input of document.querySelectorAll('input[name="close-behavior"]'))input.disabled=locked||!settingsLoaded;
  for(const id of ['settings-language','settings-language-retry'])$(id).disabled=languageBusy||appExiting;
  if(!settingsBusy)loadingIndicator($('settings-message'),false);
}
function updateAllInstallationViews(){refreshInstallationActivity();for(const songId of installationViews.keys())updateInstallationView(songId);refreshSettingsControls();if(settingsStale)refreshInstallationResults();}
function readSettings(payload){
  const settings=payload?.settings;
  if(!settings||typeof settings!=='object'||!directoryText(settings.targetDirectory)||!directoryText(settings.defaultDirectory)||!(settings.customDirectory===null||directoryText(settings.customDirectory))||typeof settings.revision!=='string'||!/^[a-f0-9]{32}$/.test(settings.revision)||typeof settings.installDirectoryConfirmed!=='boolean'||settings.version!=='2.3.1')throw uiError(m("Settings could not be loaded. Reopen Settings."));
  if(settings.targetDirectory!==(settings.customDirectory===null?settings.defaultDirectory:settings.customDirectory))throw uiError(m("Open Settings and choose the install folder again."));
  if(settings.closeBehavior!==undefined&&!['ask','exit','tray'].includes(settings.closeBehavior))throw uiError(m("Settings could not be loaded. Reopen Settings."));
  return {targetDirectory:settings.targetDirectory,defaultDirectory:settings.defaultDirectory,customDirectory:settings.customDirectory,revision:settings.revision,version:settings.version,closeBehavior:settings.closeBehavior||'ask',installDirectoryConfirmed:settings.installDirectoryConfirmed,exiting:settings.exiting===true};
}
function applySettings(settings){
  const changed=settingsStale||settingsRevision!==settings.revision||INSTALL_DIRECTORY!==settings.targetDirectory;
  if(changed){installedCharts.clear();presenceQueue.clear();installationIndex=null;presenceProblem=false;presenceGeneration++;clearDeletionErrors();for(const [id,state] of installationStates)if(!state.running&&!state.requesting)installationStates.delete(id);}
  INSTALL_DIRECTORY=settings.targetDirectory;DEFAULT_INSTALL_DIRECTORY=settings.defaultDirectory;settingsRevision=settings.revision;settingsLoaded=true;settingsStale=false;
  if(typeof settings.installDirectoryConfirmed==='boolean')installDirectoryConfirmed=settings.installDirectoryConfirmed;
  uiText($('install-directory'),INSTALL_DIRECTORY);
  uiText($('settings-directory'),INSTALL_DIRECTORY);
  if(typeof refreshInstallDirectoryConfirmation==='function')refreshInstallDirectoryConfirmation();
  closeBehavior=settings.closeBehavior;markAppExiting(settings.exiting);syncCloseOptions();renderActivity();
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
