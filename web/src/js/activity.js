function applyActivity(data){
  if(!data||typeof data.exiting!=='boolean'||!Number.isInteger(data.activeCount)||data.activeCount<0||data.activeCount>128||!Array.isArray(data.jobs)||data.jobs.length!==data.activeCount)throw uiError(m('Task status is unavailable. Please retry.'));
  for(const job of data.jobs){
    if(!job||typeof job.id!=='string'||!/^[a-f0-9]{32}$/.test(job.id)||!Number.isSafeInteger(job.songId)||job.songId<1||!['queued','downloading','validating','extracting'].includes(job.state)||!['downloadedBytes','filesWritten','fileCount'].every(key=>Number.isSafeInteger(job[key])&&job[key]>=0)||job.totalBytes!==null&&(!Number.isSafeInteger(job.totalBytes)||job.totalBytes<0))throw uiError(m('Task status is unavailable. Please retry.'));
  }
  markAppExiting(data.exiting);activityJobs=data.jobs;activityProblem='';updateAllInstallationViews();renderActivity();syncFilters();
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
