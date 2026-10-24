let accountMenuAnchor=null,myReviewsCache=null,myReviewsFetchedAt=0;
const MY_REVIEWS_FRESH_MS=60000;
let accountAvatarURL='';
async function syncAccountChip(){
  const chip=$('account-chip');
  if(!chip)return;
  const identity=myReviewIdentity();
  chip.hidden=!identity;
  if(identity){
    uiText($('account-chip-name'),identity.username||'');
    const avatar=chip.querySelector('.account-chip-avatar');
    if(avatar){
      if(accountAvatarURL){
        avatar.style.backgroundImage='url('+accountAvatarURL+')';
        avatar.style.backgroundSize='cover';
        avatar.style.backgroundPosition='center';
      }else{
        try{
          const response=await fetch('https://spinsha.re/api/user/'+identity.userId,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error'});
          const result=await readJSONResponse(response,64*1024);
          if(result?.status===200&&typeof result.data?.avatar==='string'&&result.data.avatar){
            accountAvatarURL=result.data.avatar;
            avatar.style.backgroundImage='url('+accountAvatarURL+')';
            avatar.style.backgroundSize='cover';
            avatar.style.backgroundPosition='center';
          }
        }catch(error){/* gradient fallback */}
      }
    }
  }else{
    accountAvatarURL='';
    const avatar=chip.querySelector('.account-chip-avatar');
    if(avatar){avatar.style.backgroundImage='';avatar.style.backgroundSize='';avatar.style.backgroundPosition='';}
  }
}
let accountMenuEngine=null;
function getAccountMenuEngine(){
  if(!accountMenuEngine){
    accountMenuEngine=createPopoverEngine({
      popover:$('account-menu'),
      getAnchor:()=>accountMenuAnchor,
    });
  }
  return accountMenuEngine;
}
function openAccountMenu(anchor){
  if(!sessionConnected())return;
  accountMenuAnchor=anchor;
  getAccountMenuEngine().open();
  $('account-menu').querySelector('button')?.focus({preventScroll:true});
}
function closeAccountMenu(){
  getAccountMenuEngine().close();
}
async function applyPersonalView(title,songIds,kind='view'){
  playlistFilter={id:null,title,songIds,kind};
  closeAccountMenu();
  // Personal views span all upload dates. Reset the preset visibly and run the
  // full pipeline so currentRows is re-compacted without the date bound.
  if(typeof applyDatePreset==='function'&&$('date-preset')&&$('date-preset').value!=='all'){
    $('date-preset').value='all';applyDatePreset();
  }
  if(typeof apply==='function')await apply();
  else await rebuild(false);
  renderPlaylistFilterBar();focusResults();
}
async function openMyChartsView(){
  const identity=myReviewIdentity();
  if(!identity)return;
  const rows=compact(catalog,{dateFrom:'',dateTo:'',diffs:[0,1,2,3,4],min:0,max:99});
  const mine=rows.filter(row=>row[8]&&row[8].uploader===identity.userId);
  applyPersonalView(m('My charts'),new Set(mine.map(row=>row[0])));
}
async function openMyReviewsView(){
  const identity=myReviewIdentity();
  if(!identity)return;
  if(!myReviewsCache||Date.now()-myReviewsFetchedAt>MY_REVIEWS_FRESH_MS){
    try{
      const response=await fetch('https://spinsha.re/api/user/'+identity.userId+'/reviews',{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error'});
      const result=await readJSONResponse(response,2*1024*1024);
      if(result?.status===200&&Array.isArray(result.data)){
        myReviewsCache=result.data.map(entry=>entry&&entry.song&&Number.isSafeInteger(entry.song.id)?entry.song.id:null).filter(id=>id!==null);
        myReviewsFetchedAt=Date.now();
      }
    }catch(error){/* keep the last confirmed set (red line 13) */}
  }
  if(!myReviewsCache)return;
  applyPersonalView(m('My reviews'),new Set(myReviewsCache));
}
function setupAccountMenu(){
  const chip=$('account-chip'),menu=$('account-menu');
  if(!chip||!menu)return;
  chip.addEventListener('click',()=>openAccountMenu(chip));
  $('account-menu-playlists').addEventListener('click',()=>{closeAccountMenu();openPlaylistsPanel();});
  $('account-menu-profile').addEventListener('click',()=>{closeAccountMenu();openMyProfile();});
  $('account-menu-signout').addEventListener('click',()=>{closeAccountMenu();requestSessionLogout();});
  $('account-menu-upload').addEventListener('click',()=>{closeAccountMenu();openUploadDialog();});
  menu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeAccountMenu();}});
  document.addEventListener('pointerdown',event=>{
    if(typeof menu.matches!=='function'||!menu.matches(':popover-open'))return;
    if(menu.contains(event.target)||chip.contains(event.target))return;
    closeAccountMenu();
  },true);
  addEventListener('resize',()=>{if(typeof menu.matches==='function'&&menu.matches(':popover-open'))positionAccountMenu();});
  syncAccountChip();
}

function refreshOwnChartButtons(){
  if(typeof playlistFilter==='undefined'||!playlistFilter||playlistFilter.kind!=='view')return;
  const identity=myReviewIdentity();if(!identity)return;
  for(const view of cardViews.values()){
    const card=view.card;
    if(!card||typeof card.querySelector!=='function')continue;
    const existing=card.querySelector('.own-chart-delete');
    if(existing)existing.remove();
    if(view.row[8]&&view.row[8].uploader===identity.userId){
      const del=element('button',undefined,'metric own-chart-delete');
      del.type='button';
      uiAttr(del,'aria-label',m('Delete chart')+': '+view.row[1]);
      del.append(element('span',m('Delete chart')));
      del.addEventListener('click',()=>{
        if(!del.dataset.armed){
          del.dataset.armed='1';uiText(del.firstChild,m('Confirm delete'));
          del._timer=setTimeout(()=>{delete del.dataset.armed;uiText(del.firstChild,m('Delete chart'));},3600);
          return;
        }
        clearTimeout(del._timer);delete del.dataset.armed;
        void deleteOwnChart(view.row[0],del);
      });
      const metrics=card.querySelector('.card-metrics');
      if(metrics)metrics.append(del);
    }
  }
}
async function deleteOwnChart(songId,button){
  button.disabled=true;
  try{
    await installerRequest('POST','/v1/upload/delete',{songId});
    if(typeof playlistFilter!=='undefined'&&playlistFilter&&playlistFilter.songIds)playlistFilter.songIds.delete(songId);
    const view=[...cardViews.values()].find(v=>v.row[0]===songId);
    if(view&&view.card&&typeof view.card.remove==='function')view.card.remove();
    renderPlaylistFilterBar();
  }catch(error){button.disabled=false;uiText(button.firstChild,errorText(error));}
}
