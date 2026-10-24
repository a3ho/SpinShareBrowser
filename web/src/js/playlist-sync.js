let playlistSync=null; // {id,title,rows,unavailable,index,stopping,running,started}
const PLAYLIST_SYNC_GAP_MS=1200,PLAYLIST_SYNC_POLL_MS=400;
function playlistSyncActive(){return Boolean(playlistSync&&playlistSync.running);}
function playlistCatalogRow(songId){
  const all=typeof compact==='function'&&catalog?compact(catalog,{dateFrom:'',dateTo:'',diffs:[0,1,2,3,4],min:0,max:99}):[];
  return all.find(row=>row[0]===songId)||null;
}
async function openPlaylistSync(playlistId){
  if(playlistSyncActive())return;
  if(!installDirectoryConfirmed){requestInstallation(playlistCatalogRow(1)||null);return;}
  let detail;
  try{detail=await playlistDetailCached(playlistId);}
  catch(error){playlistHint(errorText(error),true);return;}
  const rows=[],unavailable=[];
  for(const songId of detail.songIds){
    const row=playlistCatalogRow(songId);
    if(row)rows.push(row);else unavailable.push(songId);
  }
  let presence=new Map();
  if(rows.length){
    try{
      const result=await installerRequest('POST','/v1/installations/check',{expectedRevision:settingsRevision,
        charts:rows.map(row=>({songId:row[0],fileReference:row[8].fileReference,updateHash:row[8].updateHash}))});
      if(result&&typeof result==='object'){
        const charts=result.charts&&typeof result.charts==='object'?result.charts:result;
        for(const row of rows)if(charts[String(row[0])]!==undefined)presence.set(row[0],charts[String(row[0])]);
      }
    }catch(error){/* preview without presence; every song is offered */}
  }
  const toInstall=rows.filter(row=>presence.get(row[0])!==true&&presence.get(row[0])!=='different');
  playlistSync={id:playlistId,title:detail.title||'',rows:toInstall,skipped:rows.length-toInstall.length,
    unavailable,index:0,stopping:false,running:false,started:false};
  renderPlaylistSyncDialog();
  $('playlist-sync-dialog').showModal();
}
function playlistSyncStatusLabel(songId,index){
  if(!playlistSync||!playlistSync.started)return m('Waiting');
  const state=installationStates.get(songId);
  if(index<playlistSync.index)return state?.job?.state==='complete'?m('Installed'):m('Failed');
  if(index===playlistSync.index&&playlistSync.running)return m('Installing…');
  return m('Waiting');
}
function renderPlaylistSyncDialog(){
  const sync=playlistSync;
  const summary=$('playlist-sync-summary'),list=$('playlist-sync-list'),start=$('playlist-sync-start'),stop=$('playlist-sync-stop');
  if(!sync){summary.replaceChildren();list.replaceChildren();return;}
  uiText($('playlist-sync-title'),m('Sync playlist')+': '+sync.title);
  summary.replaceChildren();
  const lines=[[m('Charts to install')+': '+number(sync.rows.length),true],
    [m('Already installed')+': '+number(sync.skipped)],
    [m('Not available on SpinShare')+': '+number(sync.unavailable.length)]];
  const dlc=sync.rows.filter(row=>row[8]?.dlc).length;
  if(dlc)lines.push([m('Requires DLC')+': '+number(dlc)]);
  for(const [text,emphasis] of lines){
    const line=element('p',undefined,'playlist-sync-line'+(emphasis?' is-emphasis':''));
    uiText(line,text);summary.append(line);
  }
  list.replaceChildren();
  list.setAttribute('role','list');
  sync.rows.forEach((row,index)=>{
    const item=element('div',undefined,'playlist-sync-row');
    item.setAttribute('role','listitem');
    const name=element('span',row[1],'playlist-sync-name');
    const status=element('span',undefined,'playlist-sync-status');
    uiText(status,playlistSyncStatusLabel(row[0],index));
    if(row[8]?.dlc){const badge=element('span',undefined,'playlist-sync-badge');uiText(badge,m('Requires DLC'));item.append(badge);}
    item.append(name,status);list.append(item);
  });
  start.hidden=sync.started||sync.running;
  start.disabled=!sync.rows.length;
  stop.hidden=!sync.running;
  const note=$('playlist-sync-note');
  if(sync.started&&!sync.running){
    const failed=sync.rows.filter(row=>installationStates.get(row[0])?.job?.state!=='complete').length;
    uiText(note,failed?m('Sync finished with failures')+': '+number(failed):m('Sync finished'));
    note.hidden=false;
  }else note.hidden=true;
}
async function runPlaylistSync(){
  const sync=playlistSync;
  if(!sync||sync.running)return;
  sync.running=true;sync.started=true;
  renderPlaylistSyncDialog();
  while(sync.index<sync.rows.length){
    if(sync.stopping||appExiting)break;
    const row=sync.rows[sync.index];
    renderPlaylistSyncDialog();
    startInstallation(row);
    await playlistSyncSettled(row[0]);
    sync.index++;
    renderPlaylistSyncDialog();
    if(sync.index<sync.rows.length&&!sync.stopping)await playlistSyncGap();
  }
  sync.running=false;
  renderPlaylistSyncDialog();
  refreshInstallationChecks();
}
function playlistSyncSettled(songId){
  return new Promise(resolve=>{
    const timer=setInterval(()=>{
      if(!playlistSync||!installationPending(songId)){clearInterval(timer);resolve();}
    },PLAYLIST_SYNC_POLL_MS);
  });
}
function playlistSyncGap(){return new Promise(resolve=>setTimeout(resolve,PLAYLIST_SYNC_GAP_MS));}
function stopPlaylistSync(){
  if(!playlistSync)return;
  playlistSync.stopping=true;
  renderPlaylistSyncDialog();
  // The in-flight installation is never killed (red line 9); only future ones stop.
}
function closePlaylistSyncDialog(){
  $('playlist-sync-dialog').close();
  if(playlistSync&&!playlistSync.running)playlistSync=null;
}
function setupPlaylistSync(){
  $('playlist-sync-close').addEventListener('click',closePlaylistSyncDialog);
  $('playlist-sync-dialog').addEventListener('cancel',event=>{event.preventDefault();closePlaylistSyncDialog();});
  $('playlist-sync-start').addEventListener('click',()=>runPlaylistSync());
  $('playlist-sync-stop').addEventListener('click',stopPlaylistSync);
}
