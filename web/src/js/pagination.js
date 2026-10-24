function setupScrolling(){
  const timers=new WeakMap(),targets=[...document.querySelectorAll('.settings-panel')].reverse();
  let hovered=null,dragged=null;
  const hover=target=>{if(hovered===target)return;hovered?.classList.remove('scroll-hover');hovered=target;hovered?.classList.add('scroll-hover');};
  const hit=event=>{
    for(const target of [...targets,document.documentElement]){
      const root=target===document.documentElement;
      if(target.hidden||!root&&target.tagName==='DIALOG'&&!target.open)continue;
      const rect=root?{top:0,right:globalThis.innerWidth,bottom:globalThis.innerHeight}:target.getBoundingClientRect();
      if(target.scrollHeight<=target.clientHeight||event.clientY<rect.top||event.clientY>rect.bottom)continue;
      if(event.clientX>=rect.right-9&&event.clientX<=rect.right)return target;
    }
    return null;
  };
  document.addEventListener('pointermove',event=>hover(dragged||hit(event)),{capture:true,passive:true});
  document.addEventListener('pointerdown',event=>{dragged=hit(event);hover(dragged);},{capture:true,passive:true});
  document.addEventListener('pointerup',event=>{dragged=null;hover(hit(event));},{capture:true,passive:true});
  document.addEventListener('pointercancel',()=>{dragged=null;hover(null);},{capture:true,passive:true});
  document.addEventListener('pointerleave',()=>{if(!dragged)hover(null);},{passive:true});
  globalThis.addEventListener?.('blur',()=>{dragged=null;hover(null);});
  document.addEventListener('scroll',event=>{
    const target=event.target===document?document.documentElement:event.target;
    if(!target?.classList)return;
    clearTimeout(timers.get(target));target.classList.add('is-scrolling');
    timers.set(target,setTimeout(()=>{target.classList.remove('is-scrolling');timers.delete(target);},300));
  },{capture:true,passive:true});
}
function installationControl(row,stats,card){
  const actions=element('div',undefined,'card-actions');stats.append(actions);
  const button=element('button',undefined,'download-button'),label=element('span',m("Download and install")),deleteButton=element('button',undefined,'delete-button'),deleteLabel=element('span',m('Delete')),buttonGroup=element('div',undefined,'card-action-buttons'),note=element('p','','install-note'),presence=element('span',m('Installation status unknown'),'install-presence'),progress=element('progress',undefined,'task-progress');
  button.type='button';uiAttr(button,'aria-label',m('Download and install ')+row[1]);uiAttr(button,'aria-description',m('Install all difficulties and replace matching files.'));button.append(icon('downloads'),label);button.addEventListener('click',()=>requestInstallation(row,button));
  deleteButton.type='button';deleteButton.hidden=true;uiAttr(deleteButton,'aria-label',m('Delete')+' '+row[1]);uiAttr(deleteButton,'aria-description',m('Delete this chart, its cover, and its audio from the install directory.'));deleteButton.append(deleteLabel);deleteButton.addEventListener('click',()=>startDeletion(row));
  note.setAttribute('role','status');note.setAttribute('aria-live','polite');note.hidden=true;progress.hidden=true;buttonGroup.append(deleteButton,button);actions.append(presence,buttonGroup);card.append(stats,progress,note);
  installationViews.set(row[0],{button,label,deleteButton,deleteLabel,note,presence,progress,row,card,songTitle:row[1]});updateInstallationView(row[0]);
}
function isContinuous(){return $('page-size').value==='all';}
function pageSize(){const size=Number($('page-size').value);return [10,20,30].includes(size)?size:20;}
function pages(){return isContinuous()?1:Math.max(1,Math.ceil(filtered.length/pageSize()));}
function renderPageLinks(suffix,ready){
  const links=$('page-links'+suffix);links.replaceChildren();if(!ready||!filtered.length||isContinuous())return;
  const total=pages(),count=pagerMedia?.matches?3:10,start=Math.max(1,Math.min(page-Math.floor((count-1)/2),total-count+1));
  const targets=[...new Set([1,...Array.from({length:Math.min(count,total)},(_,index)=>start+index),total])].sort((a,b)=>a-b);
  let previous=0;
  for(const target of targets){
    if(previous&&target>previous+1){const gap=element('span','…','page-gap');gap.setAttribute('aria-hidden','true');links.append(gap);}
    const button=element('button',String(target));button.type='button';uiAttr(button,'aria-label',m("Page ")+number(target));
    if(target===page)button.setAttribute('aria-current','page');button.addEventListener('click',()=>changePage(target));links.append(button);previous=target;
  }
}
function sortRows(rows){
  const control=$('sort'),mode=['date','views','downloads','level','title'].includes(control.value)?control.value:'date',direction=$('sort-direction').value==='asc'?1:-1;
  control.value=mode;
  const value=row=>mode==='date'?row[5]||null:mode==='title'?row[1]:mode==='level'?row[7]:row[8][mode];
  rows.sort((a,b)=>{
    const av=value(a),bv=value(b);
    if(av==null||bv==null)return av==null&&bv==null?b[0]-a[0]:av==null?1:-1;
    const order=typeof av==='string'?av.localeCompare(bv,mode==='title'?uiLanguage:'en'):av-bv;
    return order*direction||b[0]-a[0];
  });
}
async function rebuild(resolveUsers=true,preservePage=false){
  if(resolveUsers){clearTimeout(textFilterTimer);textFilterTimer=null;}
  appliedText=$('local-search').value.trim();const text=titleKey(appliedText),uploaders=new Set(),fields=[...searchScopes];
  if(textSearchWork&&(textSearchWork.query!==text||textSearchWork.rows!==currentRows||textSearchWork.generation!==cacheGeneration||!searchScopes.has('creator')||phase!=='ready'))stopTextSearch(true);
  if(text&&searchScopes.has('creator')){
    const users=userSearchCache.get(text)||[];scopeSearchUsers(users,currentRows);
    for(const row of currentRows){const user=profileCache.get(row[8].uploader);if(user&&titleKey(user.name).includes(text))uploaders.add(user.id);}
    for(const user of users)if(titleKey(user.name).includes(text))uploaders.add(user.id);
  }
  installationCandidates=rowsMatchingTags(currentRows.filter(row=>!text||fields.some(field=>titleKey(row[searchFields[field]]).includes(text)||field==='creator'&&uploaders.has(row[8].uploader))));
  const installationMode=installationFilterMode();
  if(phase==='ready'&&installationMode!=='all'){trimPresenceQueue(installationCandidates);queueInstallationChecks(installationCandidates);}
  filtered=installationMode==='all'?installationCandidates.slice():installationCandidates.filter(row=>{
    const value=installationPresence(row);return installationMode==='installed'?value===true||value==='different':installationMode==='different'?value==='different':value===false;
  });
  if(typeof playlistFilter!=='undefined'&&playlistFilter)filtered=filtered.filter(row=>playlistFilter.songIds.has(row[0]));
  tagResultCounts=countTagResults(filtered);
  if(!preservePage){page=1;visibleCount=scrollBatchSize;}
  if(resolveUsers)startTextSearch(text);
  syncSearchControls();syncInstallationFilter();
  sortRows(filtered);render();return textSearchWork?.promise;
}
function changePage(target,scroll=true){
  if(isContinuous()||phase!=='ready'||!Number.isInteger(target)||target<1||target>pages()||target===page)return;
  page=target;render();if(scroll)focusResults();
}
function jumpToPage(suffix){
  const input=$('page-number'+suffix),target=Number(input.value);
  if(Number.isInteger(target)&&target>=1&&target<=pages())changePage(target);else input.value=String(page);
}
function loadMore(){
  if(!isContinuous()||phase!=='ready'||renderedCount>=filtered.length)return;
  visibleCount=Math.min(visibleCount+scrollBatchSize,filtered.length);render(true);
}
function watchMore(ready){
  moreObserver?.disconnect();moreObserver=null;
  const button=$('load-more');button.hidden=!ready||!isContinuous()||renderedCount>=filtered.length;
  if(button.hidden||typeof IntersectionObserver!=='function')return;
  const observer=new IntersectionObserver(entries=>{if(moreObserver===observer&&entries.some(entry=>entry.target===button&&entry.isIntersecting))loadMore();},{rootMargin:'400px'});
  moreObserver=observer;observer.observe(button);
}
function focusResults(){$('results-start').scrollIntoView({block:'start'});$('results-start').focus({preventScroll:true});}
