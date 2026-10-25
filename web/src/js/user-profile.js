let userProfileCache=new Map(),userProfileBusy=false;
let activeProfile=null; // {userId, data, tab, charts, playlists, reviews, spinplays}
const USER_PROFILE_FRESH_MS=120000,USER_PROFILE_CACHE_LIMIT=24;
// Live session state (APP_CONFIG is a frozen boot snapshot; a sign-in after
// launch would leave its userId null and "My profile" silently dead).
function profileIdentity(){return typeof sessionConnected==='function'&&sessionConnected()&&typeof sessionAccount==='object'&&sessionAccount&&Number.isInteger(sessionAccount.userId)?sessionAccount:null;}
function rememberUserProfile(userId,payload){
  userProfileCache.delete(userId);
  userProfileCache.set(userId,{at:Date.now(),payload});
  while(userProfileCache.size>USER_PROFILE_CACHE_LIMIT)userProfileCache.delete(userProfileCache.keys().next().value);
}
async function fetchPublicJSON(path){
  const response=await fetch('https://spinsha.re'+path,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error'});
  const result=await readJSONResponse(response,2*1024*1024);
  if(!result||result.status!==200||typeof result.data!=='object')throw uiError(m('Profile unavailable'));
  return result.data;
}
async function fetchUserProfile(userId,tab='charts'){
  const cached=userProfileCache.get(userId);
  const fresh=cached&&Date.now()-cached.at<USER_PROFILE_FRESH_MS;
  const profile=fresh?cached.payload:await fetchPublicJSON('/api/user/'+userId);
  if(!fresh)rememberUserProfile(userId,profile);
  const lists={};
  if(tab==='charts')lists.charts=await fetchPublicJSON('/api/user/'+userId+'/charts');
  else if(tab==='playlists')lists.playlists=await fetchPublicJSON('/api/user/'+userId+'/playlists');
  else if(tab==='reviews')lists.reviews=await fetchPublicJSON('/api/user/'+userId+'/reviews');
  else if(tab==='spinplays')lists.spinplays=await fetchPublicJSON('/api/user/'+userId+'/spinplays');
  return {profile,lists};
}
function profileBannerHue(userId){
  return (userId*137)%360;
}
async function openUserProfile(userId,tab='charts'){
  if(userProfileBusy)return;
  userProfileBusy=true;
  renderUserProfileShell(userId,tab,true);
  try{
    const {profile,lists}=await fetchUserProfile(userId,tab);
    activeProfile={userId,profile,tab,...lists};
    userProfileCache.set('__active__',{at:Date.now(),payload:null});
    renderUserProfile();
  }catch(error){
    const view=$('user-profile-view');
    if(view){
      const note=element('p',undefined,'profile-error');
      uiText(note,errorText(error));note.setAttribute('role','alert');
      $('profile-tab-content').replaceChildren(note);
    }
  }
  userProfileBusy=false;
}
function openMyProfile(){const identity=profileIdentity();if(identity)openUserProfile(identity.userId,'charts');}
function closeUserProfile(){
  activeProfile=null;
  const view=$('user-profile-view');
  if(view){view.hidden=true;view.replaceChildren();}
  $('chart-panel').hidden=false;
  const filter=$('playlist-filter-bar');
  if(filter)filter.hidden=true;
}
function renderUserProfileShell(userId,tab,loading){
  const view=$('user-profile-view');
  if(!view)return;
  $('chart-panel').hidden=true;
  view.hidden=false;
  const hue=profileBannerHue(userId);
  view.replaceChildren();
  const banner=element('div',undefined,'profile-banner');
  banner.style.background='linear-gradient(120deg, hsl('+hue+' 30% 8%) 0%, hsl('+((hue+40)%360)+' 35% 18%) 100%)';
  const row=element('div',undefined,'profile-banner-row');
  const avatar=element('div',undefined,'profile-avatar');
  const info=element('div',undefined,'profile-info');
  const name=element('div',undefined,'profile-name');
  uiText(name,loading?m('Loading…'):'');
  const sub=element('div',undefined,'profile-sub');
  const actions=element('div',undefined,'profile-actions');
  if(profileIdentity()&&profileIdentity().userId===userId){
    const upload=element('button',undefined,'button primary');
    upload.type='button';
    upload.append(element('span',m('Upload chart')));
    upload.addEventListener('click',()=>{closeUserProfile();openUploadDialog();});
    actions.append(upload);
  }
  row.append(avatar,info,actions);
  info.append(name,sub);
  banner.append(row);
  const segments=element('div',undefined,'profile-segments');
  segments.setAttribute('role','tablist');
  segments.setAttribute('aria-label',m('Profile sections'));
  for(const [key,label] of [['charts',m('Charts')],['playlists',m('Playlists')],['reviews',m('Reviews')],['spinplays',m('SpinPlays')]]){
    const seg=element('button',undefined,'profile-segment'+(key===tab?' is-active':''));
    seg.type='button';seg.setAttribute('role','tab');
    seg.setAttribute('aria-selected',key===tab?'true':'false');
    uiText(seg,label);
    seg.addEventListener('click',()=>{if(activeProfile&&activeProfile.userId===userId&&activeProfile.tab!==key)openUserProfile(userId,key);});
    segments.append(seg);
  }
  const close=element('button',undefined,'profile-close');
  close.type='button';
  uiAttr(close,'aria-label',m('Close profile'));
  close.append(element('span',m('Close profile')));
  close.addEventListener('click',closeUserProfile);
  const content=element('div',undefined,'profile-tab-content');
  content.id='profile-tab-content';
  if(loading){const note=element('p',undefined,'profile-loading');uiText(note,m('Loading…'));content.append(note);}
  view.append(banner,segments,close,content);
}
function renderUserProfile(){
  const profile=activeProfile;
  if(!profile)return;
  renderUserProfileShell(profile.userId,profile.tab,false);
  const view=$('user-profile-view');
  const avatar=view.querySelector('.profile-avatar');
  const avatarUrl=typeof profile.profile.avatar==='string'&&profile.profile.avatar?profile.profile.avatar:'';
  if(avatarUrl){const img=element('img');img.src=avatarUrl;img.alt='';img.loading='lazy';avatar.append(img);img.addEventListener('error',()=>{img.remove();},{once:true});}
  const name=view.querySelector('.profile-name');
  name.replaceChildren(element('span',String(profile.profile.username||'')));
  if(profile.profile.isVerified===true){const badge=element('span',undefined,'profile-badge v');uiText(badge,m('Verified'));name.append(badge);}
  if(profile.profile.isPatreon===true){const badge=element('span',undefined,'profile-badge p');uiText(badge,m('Patreon supporter'));name.append(badge);}
  const sub=view.querySelector('.profile-sub');
  const stats=[];
  if(typeof profile.profile.pronouns==='string'&&profile.profile.pronouns)stats.push(String(profile.profile.pronouns));
  if(profile.tab==='charts'&&Array.isArray(profile.charts))stats.push(number(profile.charts.length)+m(' charts'));
  if(profile.tab==='playlists'&&Array.isArray(profile.playlists))stats.push(number(profile.playlists.length)+m(' playlists'));
  if(profile.tab==='reviews'&&Array.isArray(profile.reviews))stats.push(number(profile.reviews.length)+m(' reviews'));
  if(profile.tab==='spinplays'&&Array.isArray(profile.spinplays))stats.push(number(profile.spinplays.length)+m(' SpinPlays'));
  sub.replaceChildren(element('span',stats.join(' · ')));
  const content=$('profile-tab-content');
  if(profile.tab==='charts')renderProfileCharts(profile,content);
  else if(profile.tab==='playlists')renderProfilePlaylists(profile,content);
  else if(profile.tab==='reviews')renderProfileReviews(profile,content);
  else if(profile.tab==='spinplays')renderProfileSpinplays(profile,content);
}
function renderProfileCharts(profile,content){
  content.replaceChildren();
  const charts=Array.isArray(profile.charts)?profile.charts:[];
  if(!charts.length){const empty=element('p',undefined,'profile-empty');uiText(empty,m('No charts yet'));content.append(empty);return;}
  const grid=element('div',undefined,'chart-grid profile-grid');
  grid.setAttribute('role','list');
  const rows=compact(charts,{dateFrom:'',dateTo:'',diffs:[0,1,2,3,4],min:0,max:99});
  for(const row of rows){
    const view=createChartCard(row);
    view.card.classList.add('profile-card-item');
    grid.append(view.card);
  }
  content.append(grid);
  if(typeof syncCovers==='function')syncCovers();
  if(typeof queueInstallationChecks==='function')queueInstallationChecks([...installationViews.values()].map(v=>v.row));
}
function renderProfilePlaylists(profile,content){
  content.replaceChildren();
  const playlists=Array.isArray(profile.playlists)?profile.playlists:[];
  if(!playlists.length){const empty=element('p',undefined,'profile-empty');uiText(empty,m('No playlists yet'));content.append(empty);return;}
  const identity=profileIdentity();
  const mine=identity&&identity.userId===profile.userId;
  const list=element('div',undefined,'profile-playlist-list');
  list.setAttribute('role','list');
  for(const entry of playlists){
    if(typeof entry?.id!=='number'||typeof entry.title!=='string')continue;
    const row=element('div',undefined,'playlists-row');
    row.setAttribute('role','listitem');
    const coverWrap=element('span',undefined,'playlists-cover');
    if(typeof entry.cover==='string'&&entry.cover){const img=element('img');img.src=entry.cover;img.alt='';img.loading='lazy';coverWrap.append(img);img.addEventListener('error',()=>{img.remove();},{once:true});}
    const info=element('div',undefined,'playlists-info');
    const title=element('span',entry.title,'playlists-title');
    const count=element('span',undefined,'playlists-count');
    const songs=typeof entry.songs==='number'?entry.songs:0;
    uiText(count,songs===1?m('1 song'):number(songs)+m(' songs'));
    info.append(title,count);
    const actions=element('div',undefined,'playlists-actions');
    const open=element('button',undefined,'button secondary');
    open.type='button';
    open.append(element('span',m('Open')));
    uiAttr(open,'aria-label',m('Open playlist: ')+entry.title);
    open.addEventListener('click',async()=>{
      try{
        const detail=await playlistDetailCached(entry.id);
        closeUserProfile();
        playlistFilter={id:entry.id,title:detail.title||entry.title,songIds:new Set(detail.songIds),kind:'playlist'};
        page=1;visibleCount=scrollBatchSize;
        await apply();renderPlaylistFilterBar();focusResults();
      }catch(error){/* leave profile open on failure */}
    });
    actions.append(open);
    if(mine){
      const sync=element('button',undefined,'button secondary');
      sync.type='button';
      sync.append(element('span',m('Sync to game')));
      uiAttr(sync,'aria-label',m('Sync playlist to game')+': '+entry.title);
      sync.addEventListener('click',()=>{closeUserProfile();openPlaylistSync(entry.id);});
      actions.append(sync);
    }else{
      const sync=element('button',undefined,'button secondary');
      sync.type='button';
      sync.append(element('span',m('Sync to game')));
      uiAttr(sync,'aria-label',m('Sync playlist to game')+': '+entry.title);
      sync.addEventListener('click',()=>{closeUserProfile();openPlaylistSync(entry.id);});
      actions.append(sync);
    }
    row.append(coverWrap,info,actions);list.append(row);
  }
  content.append(list);
}
function renderProfileReviews(profile,content){
  content.replaceChildren();
  const reviews=Array.isArray(profile.reviews)?profile.reviews:[];
  if(!reviews.length){const empty=element('p',undefined,'profile-empty');uiText(empty,m('No reviews yet'));content.append(empty);return;}
  const list=element('div',undefined,'profile-review-list');
  list.setAttribute('role','list');
  for(const item of reviews){
    if(!item||typeof item!=='object')continue;
    const song=item.song&&typeof item.song==='object'?item.song:null;
    if(!song||typeof song.title!=='string')continue;
    const row=element('div',undefined,'profile-review-row');
    row.setAttribute('role','listitem');
    const head=element('div',undefined,'profile-review-head');
    const title=element('span',song.title,'profile-review-song');
    const verdict=element('span',undefined,'profile-review-verdict '+(item.recommended===true?'is-up':item.recommended===false?'is-down':''));
    uiText(verdict,item.recommended===true?m('Recommended'):item.recommended===false?m('Not recommended'):'');
    const date=element('span',String(item.reviewDate?.date||'').slice(0,10),'profile-review-date');
    head.append(title,verdict,date);
    row.append(head);
    if(typeof item.comment==='string'&&item.comment.trim()){
      const text=element('p',undefined,'profile-review-text');
      text.append(element('span',item.comment));
      row.append(text);
    }
    list.append(row);
  }
  content.append(list);
}
function renderProfileSpinplays(profile,content){
  content.replaceChildren();
  const spinplays=Array.isArray(profile.spinplays)?profile.spinplays:[];
  if(!spinplays.length){const empty=element('p',undefined,'profile-empty');uiText(empty,m('No SpinPlays yet'));content.append(empty);return;}
  const list=element('div',undefined,'profile-spinplay-list');
  list.setAttribute('role','list');
  for(const item of spinplays){
    if(!item||typeof item!=='object')continue;
    const song=item.song&&typeof item.song==='object'?item.song:null;
    const chartTitle=song&&typeof song['title']==='string'?song['title']:m('Unknown chart');
    const url=typeof item.videoUrl==='string'?item.videoUrl:'';
    const row=url?element('a',undefined,'profile-spinplay-row'):element('div',undefined,'profile-spinplay-row');
    if(url){row.href=url;row.target='_blank';row.rel='noopener noreferrer';}
    row.setAttribute('role','listitem');
    row.append(element('span',chartTitle,'profile-spinplay-title'));
    if(url)row.append(element('span',undefined,'profile-spinplay-link'),);
    list.append(row);
  }
  content.append(list);
}
function setupUserProfile(){
  // no persistent bindings; the view builds its own controls per render
}
