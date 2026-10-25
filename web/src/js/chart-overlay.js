// Chart browse overlay: one large floating panel for browsing chart cards
// without leaving the current page (owner design ruling 2026-10-25: fewer
// page jumps; playlists, reviewed charts and notification jumps all open
// here instead of navigating the filter view). No filters inside; the outer
// top-bar player keeps working underneath.
let chartOverlayFocus=null,chartOverlayCells=[];
function catalogSongRows(songIds){
  // Full-stat rows come from the local catalog cache: the slim API payloads
  // (user charts, playlist entries) lack views/downloads/dates/tags.
  if(!Array.isArray(catalog)||!songIds||!songIds.size)return [];
  const byId=new Map();
  for(const song of catalog){const id=Number(song&&song.id);if(Number.isSafeInteger(id))byId.set(id,song);}
  const picked=[];
  for(const id of songIds){const song=byId.get(id);if(song)picked.push(song);}
  return compact(picked,{dateFrom:'',dateTo:'',diffs:[0,1,2,3,4],min:0,max:99});
}
function closeChartOverlayCells(){
  for(const cell of chartOverlayCells){
    cell.retired=true;
    if(typeof retireReviewCell==='function')retireReviewCell(cell);
  }
  chartOverlayCells=[];
}
function openChartOverlay(title,rows,subtitle){
  const dialog=$('chart-overlay');
  if(!dialog||typeof dialog.showModal!=='function')return;
  chartOverlayFocus=document.activeElement;
  uiText($('chart-overlay-title'),title||'');
  uiText($('chart-overlay-subtitle'),subtitle||'');
  const body=$('chart-overlay-body');
  body.replaceChildren();body.scrollTop=0;
  closeChartOverlayCells();
  if(rows&&rows.length){
    const grid=element('div',undefined,'chart-grid chart-overlay-grid');
    grid.setAttribute('role','list');
    const cells=[];
    for(const row of rows){
      const view=createChartCard(row);
      cells.push(view.cell);
      grid.append(view.card);
    }
    chartOverlayCells=cells;
    body.append(grid);
    if(typeof syncCovers==='function')syncCovers();
    if(typeof watchPageReviews==='function')watchPageReviews(cells.slice());
    if(typeof queueInstallationChecks==='function')queueInstallationChecks(cells.map(cell=>cell.row));
  }else{
    const empty=element('p',undefined,'chart-overlay-empty');
    uiText(empty,m('No charts found in the local chart library'));
    body.append(empty);
  }
  dialog.showModal();
  $('chart-overlay-close')?.focus({preventScroll:true});
}
function closeChartOverlay(){
  const dialog=$('chart-overlay');
  if(dialog&&dialog.open)dialog.close();
}
async function viewPlaylistCharts(playlistId,fallbackTitle){
  try{
    const detail=await playlistDetailCached(playlistId);
    const songIds=new Set(Array.isArray(detail.songIds)?detail.songIds:[]);
    const rows=catalogSongRows(songIds);
    openChartOverlay(detail.title||fallbackTitle||m('Playlist'),rows,number(songIds.size)+m(' charts'));
  }catch(error){
    if(typeof playlistHint==='function')playlistHint(errorText(error),true);
  }
}
function viewChartById(songId,title){
  const rows=catalogSongRows(new Set([Number(songId)]));
  openChartOverlay(title||'',rows,rows.length?'':m('Not in the local chart library'));
}
function setupChartOverlay(){
  const dialog=$('chart-overlay');
  if(!dialog)return;
  $('chart-overlay-close').addEventListener('click',closeChartOverlay);
  dialog.addEventListener('close',()=>{
    closeChartOverlayCells();
    chartOverlayFocus?.focus?.({preventScroll:true});
    chartOverlayFocus=null;
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeChartOverlay();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeChartOverlay();});
}
