let myPlaylists=null,playlistsFetchedAt=0,playlistsPanelBusy=false,playlistsHintText='',playlistsHintError=false;
let playlistFilter=null;
let playlistPickerState=null,playlistPickerAnchor=null,playlistPickerNewVisible=false,playlistPickerBusy=false;
let playlistDetailsCache=new Map();
const PLAYLISTS_FRESH_MS=45000;
function playlistSessionReady(){return sessionConnected();}
function playlistsCacheFresh(){return myPlaylists!==null&&Date.now()-playlistsFetchedAt<PLAYLISTS_FRESH_MS;}
async function fetchMyPlaylists(force=false){
  if(!playlistSessionReady())return null;
  if(!force&&playlistsCacheFresh())return myPlaylists;
  try{
    const result=await installerRequest('GET','/v1/playlists');
    if(Array.isArray(result?.playlists)){myPlaylists=result.playlists;playlistsFetchedAt=Date.now();}
  }catch(error){/* keep the last confirmed list (red line 13) */}
  syncPlaylistsUI();
  return myPlaylists;
}
async function playlistDetailCached(playlistId){
  const cached=playlistDetailsCache.get(playlistId);
  if(cached&&Date.now()-cached.at<PLAYLISTS_FRESH_MS)return cached.data;
  const result=await installerRequest('GET','/v1/playlists/'+playlistId);
  if(!result||typeof result!=='object'||!Array.isArray(result.songIds))throw uiError(m('The playlist is unavailable'));
  playlistDetailsCache.set(playlistId,{at:Date.now(),data:result});
  updatePlaylistMembershipIndex(playlistId,result.songIds);
  return result;
}
function updatePlaylistMembershipIndex(playlistId,songIds){
  for(const [songId,owners] of playlistMembershipIndex){
    owners.delete(playlistId);
    if(!owners.size)playlistMembershipIndex.delete(songId);
  }
  for(const songId of songIds){
    let owners=playlistMembershipIndex.get(songId);
    if(!owners){owners=new Set();playlistMembershipIndex.set(songId,owners);}
    owners.add(playlistId);
  }
  refreshPlaylistButtons();
}
function playlistHint(message,error=false){playlistsHintText=message;playlistsHintError=error;renderPlaylistsPanel();}
function syncPlaylistsUI(){
  if(typeof syncAccountChip==='function')syncAccountChip();
  renderPlaylistsPanel();
  renderPlaylistFilterBar();
  refreshPlaylistButtons();
}
function playlistCountLabel(entry){return entry.songs===1?m('1 song'):number(entry.songs)+m(' songs');}
function renderPlaylistsPanel(){
  const list=$('playlists-list');if(!list)return;
  const hint=$('playlists-hint');
  uiText(hint,playlistsHintText);hint.classList.toggle('is-error',playlistsHintError);hint.hidden=!playlistsHintText;
  list.replaceChildren();
  if(!playlistSessionReady()){list.append(playlistEmptyRow(m('Sign in to use playlists')));return;}
  if(myPlaylists===null){list.append(playlistEmptyRow(m('Loading playlists…')));return;}
  if(!myPlaylists.length){list.append(playlistEmptyRow(m('No playlists yet. Create one above')));return;}
  for(const entry of myPlaylists){
    const row=element('div',undefined,'playlists-row');row.setAttribute('role','listitem');
    const coverWrap=element('span',undefined,'playlists-cover');
    if(entry.cover){const cover=element('img');cover.src=entry.cover;cover.alt='';cover.loading='lazy';coverWrap.append(cover);cover.addEventListener('error',()=>{cover.remove();},{once:true});}
    const info=element('div',undefined,'playlists-info');
    const title=element('span',entry.title,'playlists-title');
    const count=element('span',undefined,'playlists-count');uiText(count,playlistCountLabel(entry));
    info.append(title,count);
    const actions=element('div',undefined,'playlists-actions');
    const open=element('button',undefined,'button secondary');open.type='button';
    open.append(element('span',m('Open')));
    uiAttr(open,'aria-label',m('Open playlist: ')+entry.title);
    open.addEventListener('click',()=>openPlaylistFilter(entry.id));
    const sync=element('button',undefined,'button secondary');sync.type='button';
    sync.append(element('span',m('Sync to game')));
    uiAttr(sync,'aria-label',m('Sync playlist to game')+': '+entry.title);
    sync.addEventListener('click',()=>openPlaylistSync(entry.id));
    const remove=element('button',undefined,'playlists-remove');remove.type='button';
    uiAttr(remove,'aria-label',m('Delete playlist: ')+entry.title);
    remove.append(element('span',m('Delete')));
    remove.addEventListener('click',()=>{
      if(!remove.dataset.armed){
        remove.dataset.armed='1';uiText(remove.firstChild,m('Confirm delete'));
        remove._timer=setTimeout(()=>{delete remove.dataset.armed;uiText(remove.firstChild,m('Delete'));},3200);
        return;
      }
      clearTimeout(remove._timer);delete remove.dataset.armed;
      void deletePlaylist(entry.id);
    });
    actions.append(open,sync,remove);row.append(coverWrap,info,actions);list.append(row);
  }
}
function playlistEmptyRow(message){const row=element('div',undefined,'playlists-empty');row.setAttribute('role','listitem');uiText(row,message);return row;}
async function deletePlaylist(playlistId){
  if(playlistsPanelBusy)return;
  playlistsPanelBusy=true;renderPlaylistsPanel();
  try{
    await installerRequest('POST','/v1/playlists/delete',{playlistId});
    if(Array.isArray(myPlaylists))myPlaylists=myPlaylists.filter(entry=>entry.id!==playlistId);
    playlistDetailsCache.delete(playlistId);
    if(playlistFilter&&playlistFilter.id===playlistId)clearPlaylistFilter();
    playlistHint(m('Playlist deleted'));
  }catch(error){playlistHint(errorText(error),true);}
  playlistsPanelBusy=false;renderPlaylistsPanel();refreshPlaylistButtons();
}
async function createPlaylist(title){
  const clean=title.trim();
  if(!clean){playlistHint(m('Type a playlist name first'),true);return false;}
  try{
    const result=await installerRequest('POST','/v1/playlists/create',{title:clean});
    if(result?.playlist){myPlaylists=[...(myPlaylists||[]),result.playlist];playlistsFetchedAt=Date.now();playlistDetailsCache.set(result.playlist.id,{at:Date.now(),data:{id:result.playlist.id,title:clean,songIds:[]}});
      playlistHint(m('Playlist created'));renderPlaylistsPanel();refreshPlaylistButtons();return result.playlist;}
    playlistHint(m('The playlist could not be created'),true);
  }catch(error){playlistHint(errorText(error),true);}
  return false;
}
function openPlaylistsPanel(){
  if(!playlistSessionReady())return;
  $('playlists-panel').showModal();
  playlistsHintText='';renderPlaylistsPanel();
  void fetchMyPlaylists(true);
  $('playlists-new-title').focus();
}
function closePlaylistsPanel(){$('playlists-panel').close();}
async function openPlaylistFilter(playlistId){
  try{
    const detail=await playlistDetailCached(playlistId);
    playlistFilter={id:playlistId,title:detail.title||'',songIds:new Set(detail.songIds),kind:'playlist'};
    closePlaylistsPanel();
    page=1;visibleCount=scrollBatchSize;
    rebuild(false);
    renderPlaylistFilterBar();
  }catch(error){playlistHint(errorText(error),true);}
}
function clearPlaylistFilter(){
  if(!playlistFilter)return;
  playlistFilter=null;page=1;visibleCount=scrollBatchSize;
  rebuild(false);renderPlaylistFilterBar();focusResults();
}
function renderPlaylistFilterBar(){
  const bar=$('playlist-filter-bar');
  if(!playlistFilter){bar.hidden=true;bar.replaceChildren();return;}
  bar.hidden=false;bar.replaceChildren();
  const chip=element('span',undefined,'playlist-chip');
  const iconNode=element('span',undefined,'playlist-chip-icon');iconNode.append(icon('playlist'));
  const label=element('span',undefined,'playlist-chip-label');uiText(label,(playlistFilter.kind==='playlist'?m('Playlist')+': ':'')+playlistFilter.title+' ('+number(playlistFilter.songIds.size)+')');
  const close=element('button',undefined,'playlist-chip-close');close.type='button';
  uiAttr(close,'aria-label',m('Clear playlist filter'));
  close.append(element('span',m('Clear playlist filter')));
  close.addEventListener('click',clearPlaylistFilter);
  chip.append(iconNode,label,close);bar.append(chip);
}
function openPlaylistPicker(row,anchor){
  if(!playlistSessionReady())return;
  // Open instantly with whatever is cached; membership is confirmed in the
  // background and the checkboxes update in place.
  const known=playlistMembershipIndex.get(row[0]);
  showPlaylistPicker(anchor,row,known?new Set(known):new Set(),myPlaylists===null);
  void refreshPickerData(row[0]);
}
async function refreshPickerData(songId){
  await fetchMyPlaylists(true);
  if(!playlistPickerState||playlistPickerState.songId!==songId)return;
  let membership=new Set(),failed=false;
  try{
    const details=await Promise.all(myPlaylists.map(entry=>playlistDetailCached(entry.id)));
    membership=new Set(myPlaylists.filter((entry,index)=>details[index].songIds.includes(songId)).map(entry=>entry.id));
  }catch(error){failed=true;}
  if(!playlistPickerState||playlistPickerState.songId!==songId)return;
  playlistPickerState.loading=false;
  if(!failed){
    for(const entry of myPlaylists){
      if(!playlistPickerState.touched.has(entry.id))playlistPickerState.checks.set(entry.id,membership.has(entry.id));
    }
  }
  renderPlaylistPicker();
  if(playlistPickerState)getPlaylistPickerEngine().reposition();
}
function showPlaylistPicker(anchor,row,membership,loading){
  playlistPickerAnchor=anchor;
  playlistPickerState={songId:row[0],title:row[1],loading:Boolean(loading),
    touched:new Set(),checks:new Map((myPlaylists||[]).map(entry=>[entry.id,membership.has(entry.id)]))};
  playlistPickerNewVisible=false;
  renderPlaylistPicker();
  getPlaylistPickerEngine().open();
  $('playlist-picker').querySelector('.playlist-picker-option input, .playlist-picker-new input, #playlist-picker-new-toggle')?.focus({preventScroll:true});
}
function renderPlaylistPicker(){
  const list=$('playlist-picker-list');list.replaceChildren();
  const state=playlistPickerState;
  if(!state)return;
  const status=$('playlist-picker-status');
  if(status){
    const needsConfirm=state.loading&&Array.isArray(myPlaylists)&&myPlaylists.length>0;
    uiText(status,needsConfirm?m('Checking your playlists…'):'');
    status.hidden=!needsConfirm;
  }
  if(!myPlaylists){
    const empty=element('p',undefined,'playlist-picker-empty');uiText(empty,m('Loading playlists…'));list.append(empty);
  }else if(!myPlaylists.length){
    const empty=element('p',undefined,'playlist-picker-empty');uiText(empty,m('No playlists yet'));list.append(empty);
  }
  for(const entry of myPlaylists||[]){
    const label=element('label',undefined,'playlist-picker-option');
    const box=element('input');box.type='checkbox';box.checked=state.checks.get(entry.id)===true;
    box.addEventListener('change',()=>{state.checks.set(entry.id,box.checked);state.touched.add(entry.id);renderPlaylistPicker();});
    const name=element('span',entry.title,'playlist-picker-name');
    label.append(box,name);list.append(label);
  }
  $('playlist-picker-new').hidden=!playlistPickerNewVisible;
  const hasList=Array.isArray(myPlaylists)&&myPlaylists.length>0;
  const confirmed=!state.loading||state.touched.size>0;
  $('playlist-picker-save').disabled=!hasList||!confirmed;
}
let playlistPickerEngine=null;
function getPlaylistPickerEngine(){
  if(!playlistPickerEngine){
    playlistPickerEngine=createPopoverEngine({
      popover:$('playlist-picker'),
      getAnchor:()=>playlistPickerAnchor,
    });
  }
  return playlistPickerEngine;
}
function closePlaylistPicker(){
  getPlaylistPickerEngine().close();
  playlistPickerState=null;playlistPickerAnchor=null;
}
async function savePlaylistPicker(){
  const state=playlistPickerState;
  if(!state||playlistPickerBusy)return;
  const wanted=[...state.checks.entries()].filter(([,on])=>on).map(([id])=>id);
  playlistPickerBusy=true;
  $('playlist-picker-save').disabled=true;
  try{
    const result=await installerRequest('POST','/v1/playlists/song',{songId:state.songId,playlistIds:wanted});
    if(Array.isArray(result?.playlists)){myPlaylists=result.playlists;playlistsFetchedAt=Date.now();playlistDetailsCache.clear();}
    closePlaylistPicker();
    refreshPlaylistButtons();
    renderPlaylistsPanel();
  }catch(error){
    const picker=$('playlist-picker');
    const existing=picker.querySelector('.playlist-picker-error');
    if(existing)existing.remove();
    const note=element('p',undefined,'playlist-picker-error');uiText(note,errorText(error));picker.append(note);
    if(error.code==='session_expired')closePlaylistPicker();
  }
  playlistPickerBusy=false;
  if(playlistPickerState)$('playlist-picker-save').disabled=false;
}
function attachPickerCreate(playlist){
  if(playlistPickerState&&playlist&&typeof playlist.id==='number')playlistPickerState.checks.set(playlist.id,true);
}
function refreshPlaylistButtons(){
  const connected=playlistSessionReady();
  for(const view of cardViews.values()){
    const card=view.card;
    if(!card||typeof card.querySelector!=='function')continue;
    let button=card.querySelector('.playlist-save-button');
    if(connected&&!button){
      const group=card.querySelector('.card-action-buttons');
      if(!group)continue;
      button=makePlaylistCardButton(view.row);
      group.append(button);
    }else if(!connected&&button&&typeof button.remove==='function'){button.remove();}
    if(button)button.classList.toggle('is-saved',playlistMembershipIndex.has(view.row[0]));
  }
}
let playlistMembershipIndex=new Map();
function makePlaylistCardButton(row){
  const button=element('button',undefined,'playlist-save-button');
  button.type='button';
  uiAttr(button,'aria-label',m('Add to playlist')+': '+row[1]);
  button.append(icon('playlist'),element('span',m('Add to playlist')));
  button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openPlaylistPicker(row,button);});
  return button;
}
function setupPlaylists(){
  $('playlists-close').addEventListener('click',closePlaylistsPanel);
  $('playlists-panel').addEventListener('cancel',event=>{event.preventDefault();closePlaylistsPanel();});
  $('playlists-create').addEventListener('submit',async event=>{
    event.preventDefault();
    const input=$('playlists-new-title');
    const created=await createPlaylist(input.value);
    if(created){input.value='';renderPlaylistsPanel();}
  });
  const picker=$('playlist-picker');
  $('playlist-picker-save').addEventListener('click',()=>savePlaylistPicker());
  $('playlist-picker-new-toggle').addEventListener('click',()=>{
    playlistPickerNewVisible=!playlistPickerNewVisible;renderPlaylistPicker();
    if(playlistPickerNewVisible){$('playlist-picker-new-title').focus();positionPlaylistPicker();}
  });
  $('playlist-picker-new').addEventListener('submit',async event=>{
    event.preventDefault();
    const input=$('playlist-picker-new-title');
    const created=await createPlaylist(input.value);
    if(created){input.value='';playlistPickerNewVisible=false;
      attachPickerCreate(created);
      renderPlaylistPicker();positionPlaylistPicker();}
  });
  picker.addEventListener('toggle',()=>{if(!picker.matches(':popover-open')&&playlistPickerState&&!playlistPickerBusy){playlistPickerState=null;playlistPickerAnchor=null;}});
  picker.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePlaylistPicker();}});
  document.addEventListener('pointerdown',event=>{
    if(!playlistPickerState)return;
    if(picker.contains(event.target)||event.target.closest('.metric-playlist'))return;
    closePlaylistPicker();
  },true);
  addEventListener('resize',()=>{if(playlistPickerState)positionPlaylistPicker();});
  syncPlaylistsUI();
}
