let notificationData=null,notificationsBusy=false,notificationsAnchor=null;
function notificationsConnected(){return sessionConnected();}
function syncNotificationsUI(){
  const button=$('notifications-open');
  if(!button)return;
  button.hidden=!notificationsConnected();
  const badge=$('notifications-badge');
  if(badge)badge.hidden=!(notificationData&&notificationData.unread>0);
}
function notificationSongFromIcon(icon){
  if(typeof icon!=='string')return null;
  const match=icon.match(/\/uploads\/thumbnail\/(spinshare_[a-f0-9]{1,64})\.jpg/i);
  if(!match)return null;
  if(typeof compact!=='function'||!catalog)return null;
  const rows=compact(catalog,{dateFrom:'',dateTo:'',diffs:[0,1,2,3,4],min:0,max:99});
  return rows.find(row=>row[8]&&row[8].fileReference===match[1])||null;
}
async function fetchNotifications(){
  if(!notificationsConnected())return;
  try{
    const result=await installerRequest('GET','/v1/notifications');
    if(result&&typeof result==='object'&&Array.isArray(result.notifications)){
      notificationData={notifications:result.notifications,unread:Number(result.unread)||result.notifications.length};
    }
  }catch(error){/* keep the last confirmed state (red line 13) */}
  syncNotificationsUI();
  renderNotifications();
}
function renderNotifications(){
  const list=$('notifications-list');if(!list)return;
  list.replaceChildren();
  if(!notificationData){const empty=element('p',undefined,'notifications-empty');uiText(empty,m('Loading notifications…'));list.append(empty);return;}
  if(!notificationData.notifications.length){const empty=element('p',undefined,'notifications-empty');uiText(empty,m('No notifications'));list.append(empty);return;}
  for(const item of notificationData.notifications){
    const row=element('div',undefined,'notifications-row');
    row.setAttribute('role','listitem');
    const icon=element('span',undefined,'notifications-icon');
    if(item.icon){const img=element('img');img.src=item.icon;img.alt='';img.loading='lazy';icon.append(img);img.addEventListener('error',()=>{img.remove();},{once:true});}
    else icon.append(icon_('bell'));
    const text=element('span',undefined,'notifications-text');uiText(text,item.text);
    const actions=element('span',undefined,'notifications-actions');
    const song=notificationSongFromIcon(item.icon);
    if(song){
      const jump=element('button',undefined,'notifications-jump');jump.type='button';
      uiAttr(jump,'aria-label',m('Go to chart')+': '+song[1]);
      jump.append(element('span',m('Go to chart')));
      jump.addEventListener('click',()=>{
        playlistFilter={id:null,title:song[1],songIds:new Set([song[0]])};
        closeNotificationsPopover();
        page=1;visibleCount=scrollBatchSize;
        rebuild(false);renderPlaylistFilterBar();focusResults();
      });
      actions.append(jump);
    }
    const clear=element('button',undefined,'notifications-clear');clear.type='button';
    uiAttr(clear,'aria-label',m('Clear notification'));
    clear.append(element('span',m('Clear notification')));
    clear.addEventListener('click',()=>clearOneNotification(item.id,clear));
    actions.append(clear);
    row.append(icon,text,actions);list.append(row);
  }
}
async function clearOneNotification(notificationId,button){
  if(notificationsBusy)return;
  notificationsBusy=true;button.disabled=true;
  try{
    const result=await installerRequest('POST','/v1/notifications/clear',{notificationId});
    if(notificationData){
      notificationData.notifications=notificationData.notifications.filter(item=>item.id!==notificationId);
      notificationData.unread=typeof result?.unread==='number'?result.unread:Math.max(0,notificationData.unread-1);
    }
    syncNotificationsUI();renderNotifications();
  }catch(error){button.disabled=false;}
  notificationsBusy=false;
}
async function clearAllNotificationsUI(){
  if(notificationsBusy||!notificationData||!notificationData.notifications.length)return;
  notificationsBusy=true;
  try{
    await installerRequest('POST','/v1/notifications/clear-all',{});
    notificationData={notifications:[],unread:0};
    syncNotificationsUI();renderNotifications();
  }catch(error){}
  notificationsBusy=false;
}
function icon_(name){return icon(name);}
let notificationsEngine=null;
function getNotificationsEngine(){
  if(!notificationsEngine){
    notificationsEngine=createPopoverEngine({
      popover:$('notifications-popover'),
      getAnchor:()=>notificationsAnchor,
    });
  }
  return notificationsEngine;
}
function openNotificationsPopover(anchor){
  if(!notificationsConnected())return;
  notificationsAnchor=anchor;
  getNotificationsEngine().open();
  renderNotifications();
  void fetchNotifications();
  $('notifications-popover').querySelector('.notifications-row button, .notifications-empty')?.focus({preventScroll:true});
}
function closeNotificationsPopover(){
  getNotificationsEngine().close();
}
function setupNotifications(){
  const button=$('notifications-open'),popover=$('notifications-popover');
  if(!button||!popover)return;
  button.addEventListener('click',()=>openNotificationsPopover(button));
  $('notifications-clear-all').addEventListener('click',()=>clearAllNotificationsUI());
  popover.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();closeNotificationsPopover();}});
  document.addEventListener('pointerdown',event=>{
    if(!popover.matches(':popover-open'))return;
    if(popover.contains(event.target)||event.target===button||button.contains(event.target))return;
    closeNotificationsPopover();
  },true);
  addEventListener('resize',()=>{if(popover.matches(':popover-open'))positionNotificationsPopover();});
  syncNotificationsUI();
}
