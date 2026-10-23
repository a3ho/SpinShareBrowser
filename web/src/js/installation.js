function syncInstallationInterlocks(){for(const songId of installationViews.keys())updateInstallationView(songId);refreshSettingsControls();}
function installationFilterMode(){const value=$('installation-filter').value;return ['installed','uninstalled','different'].includes(value)?value:'all';}
function installationKey(row){return settingsRevision+':'+row[8].fileReference+':'+row[8].updateHash;}
function canCheckInstallation(row){return /^spinshare_[a-f0-9]{1,64}$/i.test(row[8].fileReference||'')&&/^[a-f0-9]{32}$/i.test(row[8].updateHash||'');}
function installationPresence(row){
  if(!canCheckInstallation(row))return null;
  if(settingsStale||installationPending(row[0]))return null;
  const record=installedCharts.get(row[0]);return record?.key===installationKey(row)?record.value:undefined;
}
function installationIndexValue(row,index=installationIndex){
  if(!index||index.revision!==settingsRevision)return undefined;
  const hash=index.entries.get(String(row[8].fileReference).toLowerCase());
  return hash===undefined?false:hash===String(row[8].updateHash).toLowerCase()?true:'different';
}
function readInstallationIndex(payload,revision){
  if(payload?.settingsRevision!==revision||!Array.isArray(payload.installations))throw new Error('Invalid installation index response');
  const entries=new Map();
  for(const item of payload.installations){
    if(!item||typeof item!=='object'||Object.keys(item).length!==2||typeof item.fileReference!=='string'||!/^spinshare_[a-f0-9]{1,64}$/i.test(item.fileReference)||typeof item.updateHash!=='string'||!/^[a-f0-9]{32}$/i.test(item.updateHash))throw new Error('Invalid installation index entry');
    const reference=item.fileReference.toLowerCase(),hash=item.updateHash.toLowerCase();if(entries.has(reference))throw new Error('Duplicate installation index entry');entries.set(reference,hash);
  }
  return {revision,entries};
}
function readInstallationCheck(payload,row,revision){
  const result=payload?.installations?.[0];
  if(payload?.settingsRevision!==revision||!Array.isArray(payload.installations)||payload.installations.length!==1||!result||typeof result!=='object'||Object.keys(result).length!==2||result.songId!==row[0]||typeof result.installed!=='boolean'&&result.installed!=='different')throw new Error('Invalid installation check response');
  return result.installed;
}
function noteInstallationMutation(row,installed){
  installationMutationGeneration++;
  if(!installationIndex||installationIndex.revision!==settingsRevision||!canCheckInstallation(row)||typeof installed!=='boolean')return;
  const reference=String(row[8].fileReference).toLowerCase();
  if(installed)installationIndex.entries.set(reference,String(row[8].updateHash).toLowerCase());else installationIndex.entries.delete(reference);
}
function trimPresenceQueue(rows=[]){
  const keep=new Set(rows.map(row=>row[0]));
  for(const [id,{record}] of presenceQueue)if(!keep.has(id)){
    record.pending=false;if(record.value===undefined&&installedCharts.get(id)===record)installedCharts.delete(id);
    presenceQueue.delete(id);
  }
}
function installationProgressText(pending,total=installationFilterTotal){return m('Checking installation status: ')+number(Math.max(0,total-pending))+' / '+number(total);}
function syncInstallationFilter(){
  const ready=Boolean(applied)&&phase==='ready',active=ready&&installationFilterMode()!=='all';let pending=0,unknown=0,retry=false,checkable=0;
  if(active)for(const row of installationCandidates){
    const value=installationPresence(row);
    if(!canCheckInstallation(row)){unknown++;continue;}
    checkable++;
    if(value===undefined)pending++;
    else if(value===null){unknown++;if(canCheckInstallation(row)&&!installationPending(row[0]))retry=true;}
  }
  installationFilterPending=pending>0;
  installationFilterRemaining=pending;
  installationFilterTotal=checkable;
  const refreshing=ready&&(presenceBusy||presenceQueue.size>0)&&pending===0;
  const stageOwnsProgress=pending>0&&filtered.length===0;
  const relevantProblem=ready&&presenceProblem&&(active?checkable>0:[...installationViews.values()].some(view=>canCheckInstallation(view.row))),notices=[];
  if(relevantProblem)notices.push(typeof presenceProblem==='string'?presenceProblem:m('Installation status could not be updated. Current results remain visible.'));
  if(active&&unknown)notices.push(m('Installation status unknown: ')+number(unknown)+m(' charts excluded.'));
  const message=settingsStale?m('Open Settings to confirm the changed install directory.'):pending?installationProgressText(pending,checkable):notices.join(m(' | '));
  $('installation-filter-feedback').hidden=!ready||!message||stageOwnsProgress;
  $('installation-filter-retry').hidden=!ready||!relevantProblem&&!retry||settingsStale||pending>0||refreshing;
  $('installation-filter-retry').disabled=appExiting||pending>0||refreshing;
  $('installation-filter').setAttribute('aria-busy',String(pending>0||refreshing));
  uiText($('installation-filter-message'),message);
  loadingIndicator($('installation-filter-message'),pending>0||refreshing);return pending;
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
  if(failedOnly&&!presenceProblem)rows=rows.filter(row=>installationPresence(row)===null);
  queueInstallationChecks(rows,true);syncInstallationFilter();
}
function refreshInstallationActivity(){
  const active=new Map(activityJobs.map(job=>[job.songId,job.id])),changed=new Set([...installationActivityIds.keys(),...active.keys()]);
  for(const id of changed)if(installationActivityIds.get(id)===active.get(id))changed.delete(id);
  for(const id of changed){
    const previous=installationActivityIds.get(id),state=installationStates.get(id),record=installedCharts.get(id),currentRow=currentRows.find(row=>row[0]===id);
    if(previous&&!active.has(id)&&state?.job?.id===previous&&state.job.state==='complete'&&record?.key===installationKey(currentRow||state.row)&&(typeof record.value==='boolean'||record.value==='different')&&!record.pending)changed.delete(id);
  }
  installationActivityIds=active;
  if(!changed.size)return;
  installationMutationGeneration++;
  for(const id of changed){installedCharts.delete(id);presenceQueue.delete(id);}
  queueInstallationChecks(currentRows.filter(row=>changed.has(row[0])),true);refreshInstallationResults();
}
function queueInstallationChecks(rows,force=false){
  if(settingsStale||appExiting)return;
  let queued=false;
  for(const row of rows){
    if(!row||!canCheckInstallation(row)||installationPending(row[0])||deletionPending(row[0]))continue;
    const key=installationKey(row);let record=installedCharts.get(row[0]);
    if(record?.key!==key){record={key,value:undefined,pending:false};installedCharts.set(row[0],record);}
    if(record.pending||!force&&record.value!==undefined)continue;
    if(!force&&!presenceBusy&&!presenceQueue.size){const value=installationIndexValue(row);if(value!==undefined){record.value=value;updateInstallationView(row[0]);continue;}}
    if(force&&record.value===null)record.value=undefined;
    record.pending=true;presenceQueue.set(row[0],{row,record});queued=true;updateInstallationView(row[0]);
  }
  if(queued)presenceProblem=false;
  return readInstallationPresence();
}
function publishInstallationIndex(index,batch){
  installationIndex=index;presenceProblem=false;
  const rows=new Map(currentRows.map(row=>[row[0],row]));
  for(const {row} of batch)if(!rows.has(row[0]))rows.set(row[0],row);
  const wanted=new Set(installationCandidates.map(row=>row[0]));let changed=false;
  for(const row of rows.values()){
    if(!canCheckInstallation(row))continue;
    const record=installedCharts.get(row[0]);if(!record||record.key!==installationKey(row))continue;
    if(installationPending(row[0])||deletionPending(row[0])){
      record.pending=false;if(presenceQueue.get(row[0])?.record===record)presenceQueue.delete(row[0]);continue;
    }
    const before=record.value,wasPending=record.pending;record.value=installationIndexValue(row,index);record.pending=false;
    if(presenceQueue.get(row[0])?.record===record)presenceQueue.delete(row[0]);
    updateInstallationView(row[0]);if(wanted.has(row[0])&&(wasPending||before!==record.value))changed=true;
  }
  return changed;
}
async function readInstallationPresence(){
  if(presenceBusy||settingsStale||appExiting)return;
  presenceBusy=true;let publishResults=false;
  try{
    while(presenceQueue.size&&!settingsStale&&!appExiting){
      const batch=[...presenceQueue.values()],revision=settingsRevision,generation=presenceGeneration,mutationGeneration=installationMutationGeneration;
      presenceQueue.clear();let index=null,failed=false;
      try{
        index=readInstallationIndex(await installerRequest('POST','/v1/installations/index',{expectedRevision:revision}),revision);
      }catch(error){failed=error;}
      if(generation!==presenceGeneration||revision!==settingsRevision)continue;
      if(mutationGeneration!==installationMutationGeneration){
        for(const {row,record} of batch){
          if(installedCharts.get(row[0])!==record)continue;
          if(installationPending(row[0])||deletionPending(row[0]))record.pending=false;
          else{record.pending=true;presenceQueue.set(row[0],{row,record});}
        }
        syncInstallationFilter();continue;
      }
      if(!failed&&!settingsStale){publishResults=publishInstallationIndex(index,batch)||publishResults;syncInstallationFilter();continue;}
      presenceProblem=failed?.code==='installation_recovery_required'?errorText(failed):true;
      const wanted=new Set(installationCandidates.map(row=>row[0]));let changed=false;
      for(const {row,record} of batch){
        // A completed install or new directory can replace a record while this batch is in flight.
        if(installedCharts.get(row[0])!==record)continue;
        record.pending=false;
        if(settingsStale||installationPending(row[0])||deletionPending(row[0])){if(record.value===undefined)record.value=null;}
        else if(record.value===undefined)record.value=null;
        updateInstallationView(row[0]);
        if(wanted.has(row[0]))changed=true;
      }
      syncInstallationFilter();publishResults=publishResults||changed;
    }
  }finally{presenceBusy=false;syncInstallationFilter();if(publishResults)refreshInstallationResults();}
}
function updateInstallationView(songId){
  const view=installationViews.get(songId);if(!view)return;
  const saved=installationStates.get(songId),state=saved?.targetDirectory===INSTALL_DIRECTORY?saved:null,deletion=deletionState(songId),job=state?.job,presence=installationPresence(view.row),installed=presence===true,different=presence==='different';
  const overwriteNotice=m('Installing again replaces the local chart and any local edits.');
  let label=installed||different?m("Install again"):m("Download and install"),message=different?overwriteNotice:'';
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
  if(deletion?.phase==='queued')message=m('Waiting to delete local files.');
  else if(['deleting','leaving'].includes(deletion?.phase))message=m('Deleting local chart files...');
  else if(deletion?.phase==='error')message=deletion.problem;
  const error=deletion?.phase==='error'||Boolean(state?.problem)||job?.state==='error'||job?.state==='complete'&&!job.zipRemoved;
  const needsSubmit=!job||state?.rejected||state?.expired||['complete','error'].includes(job.state);
  uiText(view.presence,installed?m("Installed"):different?m('Local files differ'):presence===false?m("Not installed"):presence===undefined?m('Checking installation status...'):m('Installation status unknown'));view.presence.classList.toggle('is-installed',installed);
  uiAttr(view.button,'aria-description',different?overwriteNotice:m('Install all difficulties and replace matching files.'));
  uiText(view.label,label);uiAttr(view.button,"aria-label",label+' '+view.songTitle);view.button.disabled=Boolean(state?.running)||deletionWorkActive()||appExiting||settingsBusy==='saving'||settingsBusy==='shutdown'||settingsStale&&needsSubmit;view.button.classList.toggle('is-complete',installed);
  const deleteLabel=deletion?.phase==='queued'?m('Queued'):['deleting','leaving'].includes(deletion?.phase)?m('Deleting...'):m('Delete');
  uiText(view.deleteLabel,deleteLabel);uiAttr(view.deleteButton,'aria-label',deleteLabel+' '+view.songTitle);view.deleteButton.hidden=!installed;view.deleteButton.disabled=deletionPending(songId)||installationWorkActive()||appExiting||settingsBusy==='saving'||settingsBusy==='shutdown'||settingsStale;view.deleteButton.classList.toggle('is-error',deletion?.phase==='error');
  loadingIndicator(view.deleteLabel,deletionPending(songId),deletion?.phase==='queued');view.deleteButton.setAttribute('aria-busy',String(deletionPending(songId)));
  uiText(view.note,message);view.note.hidden=!message;view.note.classList.toggle('is-error',error);
  const active=Boolean(state?.running)&&!error;
  loadingIndicator(view.label,active,job?.state==='queued');view.button.setAttribute('aria-busy',String(active));
  updateTaskProgress(view.progress,job,active,label+' '+view.songTitle);
}
function deletionResult(payload,state){
  if(!payload||payload.settingsRevision!==state.settingsRevision||payload.songId!==state.songId||payload.deleted!==true||!Number.isSafeInteger(payload.filesDeleted)||payload.filesDeleted<1)throw uiError(m('Could not confirm deletion. Refresh the installation status before trying again.'));
  return payload;
}
function currentDeletionContext(state){
  const rows=typeof currentRows==='undefined'?[]:currentRows,currentRow=rows.find(row=>row[0]===state.songId)||null;
  return {currentRow,sameContext:!settingsStale&&settingsRevision===state.settingsRevision&&currentRow&&currentRow[8].fileReference===state.row[8].fileReference&&currentRow[8].updateHash===state.row[8].updateHash};
}
function settleDeletion(state){
  if(deletionState(state.songId)!==state)return;
  const view=installationViews.get(state.songId),card=view?.card,focused=document.activeElement,focusInside=Boolean(card?.contains(focused)),deleteFocused=focused===view?.deleteButton,mode=installationFilterMode();
  const cards=card?.parentElement===$('rows')?[...$('rows').children]:[],nextCard=cards[cards.indexOf(card)+1]||null;
  const {currentRow,sameContext}=currentDeletionContext(state);
  deletionStates.delete(state.songId);
  if(sameContext){installedCharts.set(state.songId,{key:installationKey(currentRow),value:false,pending:false});presenceQueue.delete(state.songId);if(installationIndex?.revision===settingsRevision)installationIndex.entries.delete(String(currentRow[8].fileReference).toLowerCase());}
  syncInstallationInterlocks();
  if(!sameContext&&currentRow)queueInstallationChecks([currentRow],true);
  if(mode!=='all')rebuild(false,true);
  uiText($('installation-announcement'),m('Deleted local chart: ')+state.row[1]);
  if(mode==='installed'?!focusInside:mode!=='all'||!deleteFocused)return;
  queueMicrotask(()=>{
    if(mode==='installed')(nextCard?.isConnected&&nextCard.querySelector('.song-title')||$('results-start')).focus({preventScroll:true});
    else if(view?.button?.isConnected&&!view.button.disabled)view.button.focus({preventScroll:true});
    else (card?.isConnected&&card.querySelector('.song-title')||$('results-start')).focus({preventScroll:true});
  });
}
function completeDeletion(state){
  if(deletionState(state.songId)!==state)return;
  const view=installationViews.get(state.songId),card=view?.card;
  if(installationFilterMode()!=='installed'||!card?.isConnected){settleDeletion(state);return;}
  state.phase='leaving';updateInstallationView(state.songId);
  let finished=false,motion;
  const finish=()=>{if(finished)return;finished=true;motion?.cancel();settleDeletion(state);};
  motion=playMotion(card,[{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(-4px) scale(.995)'}],{duration:MOTION_MS.standard,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'});
  if(motion)motion.finished.then(finish,finish);else finish();
}
function failDeletion(state,error){
  if(deletionState(state.songId)!==state)return;
  const {currentRow,sameContext}=currentDeletionContext(state);
  state.phase='error';state.problem=errorText(error)||m('Could not delete local chart files. Close the game and try again.');
  noteInstallationMutation(state.row);
  if(error?.code==='delete_partial')uiText($('installation-announcement'),state.problem);
  if(!sameContext)deletionStates.delete(state.songId);
  installedCharts.delete(state.songId);presenceQueue.delete(state.songId);if(currentRow)queueInstallationChecks([currentRow],true);syncInstallationFilter();
  syncInstallationInterlocks();
}
async function drainDeletionQueue(){
  if(deletionBusy)return;deletionBusy=true;
  try{
    while(deletionQueue.length){
      const state=deletionQueue.shift();if(deletionState(state.songId)!==state)continue;
      state.phase='deleting';updateInstallationView(state.songId);
      try{
        const result=await installerRequest('POST','/v1/installations/delete',{expectedRevision:state.settingsRevision,songId:state.songId,fileReference:state.row[8].fileReference,updateHash:state.row[8].updateHash});
        deletionResult(result,state);noteInstallationMutation(state.row,false);completeDeletion(state);
      }catch(error){failDeletion(state,error);}
    }
  }finally{deletionBusy=false;refreshSettingsControls();}
}
function startDeletion(row){
  if(!canCheckInstallation(row)||installationPresence(row)!==true||installationWorkActive()||deletionPending(row[0])||appExiting||settingsBusy==='saving'||settingsBusy==='shutdown'||settingsStale)return;
  const state={songId:row[0],row,phase:'queued',problem:'',settingsRevision};deletionStates.set(state.songId,state);deletionQueue.push(state);syncInstallationInterlocks();void drainDeletionQueue();
}
async function settleInstallationPresence(state){
  if(!state.row)return;
  if(state.job?.state!=='complete'){
    queueInstallationChecks([state.row],true);refreshInstallationResults();return;
  }
  try{
    const row=currentRows.find(item=>item[0]===state.songId)||state.row,revision=state.settingsRevision,installed=readInstallationCheck(await installerRequest('POST','/v1/installations/check',{expectedRevision:revision,charts:[{songId:state.songId,fileReference:row[8].fileReference,updateHash:row[8].updateHash}]}),row,revision);
    if(installationStates.get(state.songId)!==state||settingsStale||settingsRevision!==revision||installationPending(state.songId))return;
    const currentRow=currentRows.find(item=>item[0]===state.songId);if(currentRow&&installationKey(currentRow)!==installationKey(row)){queueInstallationChecks([currentRow],true);refreshInstallationResults();return;}
    if(installed===true)noteInstallationMutation(row,true);else{installationMutationGeneration++;installationIndex=null;}
    installedCharts.set(state.songId,{key:installationKey(row),value:installed,pending:false});presenceQueue.delete(state.songId);updateInstallationView(state.songId);syncInstallationFilter();refreshInstallationResults();
    if(installed==='different'&&!state.catalogRecheckRequested){
      // The download can be newer than the cached catalog. Recheck the catalog,
      // then let the normal local hash comparison decide whether it matches.
      state.catalogRecheckRequested=true;catalogInstallRecheck=true;scheduleAutomaticCatalogSync();
    }
  }catch{
    if(installationStates.get(state.songId)===state&&!installationPending(state.songId)){queueInstallationChecks([state.row],true);refreshInstallationResults();}
  }
}
function scheduleInstallationPoll(state){
  clearTimeout(state.timer);state.timer=setTimeout(()=>{state.timer=null;pollInstallation(state);},700);
}
function receiveInstallationJob(state,payload){
  const previous=state.job?.state;state.job=installerJob(payload,state.songId,state.job?.id||'',state.targetDirectory);state.problem='';
  if(state.job.state==='complete'&&previous!=='complete'&&state.row)noteInstallationMutation(state.row,true);
  state.running=!['complete','error'].includes(state.job.state);syncInstallationInterlocks();
  renderActivity();refreshActivity();
  if(state.running)scheduleInstallationPoll(state);else if(state.row){installedCharts.delete(state.songId);refreshInstallationResults();}
}
async function pollInstallation(state){
  if(!state.job||state.requesting)return;state.requesting=true;
  try{receiveInstallationJob(state,await installerRequest('GET','/v1/jobs/'+state.job.id));}
  catch(error){state.running=false;state.expired=error.httpStatus===410&&error.code==='request_expired';state.problem=errorText(error);updateInstallationView(state.songId);}
  finally{state.requesting=false;syncInstallationInterlocks();renderActivity();refreshActivity();if(state.row&&!installationPending(state.songId))await settleInstallationPresence(state);}
}
async function startInstallation(row){
  if(appExiting||settingsBusy==='saving'||settingsBusy==='shutdown')return;
  if(deletionWorkActive())return;
  if(deletionState(row[0])?.phase==='error')deletionStates.delete(row[0]);
  let state=installationStates.get(row[0]);if(state?.running||state?.requesting)return;
  if(settingsStale&&(!state?.job||state.rejected||state.expired||['complete','error'].includes(state.job.state))){updateInstallationView(row[0]);return;}
  if(!state||state.rejected||state.expired||state.job&&['complete','error'].includes(state.job.state)){
    state={songId:row[0],row,requestId:'',job:null,running:false,requesting:false,rejected:false,expired:false,problem:'',timer:null,targetDirectory:INSTALL_DIRECTORY,settingsRevision};installationStates.set(row[0],state);
  }
  installedCharts.delete(row[0]);presenceQueue.delete(row[0]);state.running=true;state.problem='';syncInstallationInterlocks();renderActivity();refreshInstallationResults();
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
  finally{state.requesting=false;syncInstallationInterlocks();renderActivity();refreshActivity();if(!installationPending(state.songId))await settleInstallationPresence(state);}
}
