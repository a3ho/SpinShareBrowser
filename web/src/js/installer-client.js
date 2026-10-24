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
async function installerRequest(method,path,body,revision='',signal=null){
  const permitted=method==='GET'&&(['/v1/settings','/v1/activity','/v1/desktop/window','/v1/desktop/dialog','/v1/session/status','/v1/playlists'].includes(path)||(/^\/v1\/jobs\/[a-f0-9]{32}$/.test(path)||/^\/v1\/playlists\/\d+$/.test(path)))||method==='POST'&&['/v1/install','/v1/installations/check','/v1/installations/index','/v1/installations/delete','/v1/settings','/v1/directory/select','/v1/shutdown','/v1/language','/v1/close-behavior','/v1/player-shortcuts-seen','/v1/player-volume','/v1/preview/resolve','/v1/session/login','/v1/session/logout','/v1/playlists/create','/v1/playlists/delete','/v1/playlists/song','/v1/reviews/add','/v1/reviews/delete','/v1/install-directory-confirmation','/v1/desktop/window','/v1/desktop/window/regions','/v1/desktop/dialog','/v1/desktop/exit'].includes(path);
  if(!permitted)throw uiError(m("Unable to complete this action. Reopen SpinShareBrowser.exe."));
  if(path==='/v1/install'&&!/^[a-f0-9]{32}$/.test(revision))throw uiError(m("Open Settings and choose the install folder again."));
  const request=new AbortController();let timedOut=false;
  const abort=()=>request.abort();if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{timedOut=true;request.abort();},path==='/v1/directory/select'?600000:path==='/v1/preview/resolve'?20000:10000);
  const headers={'X-SpinShare-Key':INSTALL_KEY};if(method==='POST')headers['Content-Type']='application/json';
  if(path==='/v1/install')headers['X-SpinShare-Settings']=revision;
  try{
    const response=await fetch(INSTALL_ORIGIN+path,{method,mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',headers,...(body?{body:JSON.stringify(body)}:{}),signal:request.signal});
    const limit=path==='/v1/installations/index'?8*1024*1024:64*1024;
    let result;try{result=await readJSONResponse({ok:true,headers:response.headers,body:response.body},limit);}catch(error){if(request.signal.aborted)throw error;throw uiError(path==='/v1/installations/delete'?m("Could not confirm deletion. Refresh the installation status before trying again."):m("Could not confirm installation. Check its status before trying again."));}
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
      if(path==='/v1/installations/delete')throw uiError(m("Deletion timed out. Refresh the installation status before trying again."));
      throw uiError(m("Installer response timed out. The task may still be running; check its progress."));
    }
    if(error instanceof TypeError)throw uiError(m("Cannot reach the installer. Reopen SpinShareBrowser.exe and allow local network access if asked."));
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function installationStatePending(state,activeId){return Boolean(state?.running||state?.requesting||state?.requestId&&!state.rejected&&!state.expired&&!['complete','error'].includes(state.job?.state)||activeId&&activeId!==state?.job?.id);}
function installationPending(songId){
  const saved=installationStates.get(songId),state=saved?.targetDirectory===INSTALL_DIRECTORY?saved:null;
  return installationStatePending(state,installationActivityIds.get(songId));
}
function deletionState(songId){return typeof deletionStates==='undefined'?null:deletionStates.get(songId)||null;}
function deletionPending(songId){return ['queued','deleting','leaving'].includes(deletionState(songId)?.phase);}
function installationWorkActive(){
  const songIds=new Set([...installationStates.keys(),...installationActivityIds.keys()]);
  return activityJobs.length>0||[...songIds].some(songId=>installationStatePending(installationStates.get(songId),installationActivityIds.get(songId)));
}
function deletionWorkActive(){return typeof deletionStates!=='undefined'&&[...deletionStates.values()].some(state=>['queued','deleting','leaving'].includes(state.phase));}
function clearDeletionErrors(){if(typeof deletionStates!=='undefined')for(const [songId,state] of deletionStates)if(state.phase==='error')deletionStates.delete(songId);}
