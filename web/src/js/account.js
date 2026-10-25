let accountMenuAnchor=null;
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
    const view=[...cardViews.values()].find(v=>v.row[0]===songId);
    if(view&&view.card&&typeof view.card.remove==='function')view.card.remove();
  }catch(error){button.disabled=false;uiText(button.firstChild,errorText(error));}
}
