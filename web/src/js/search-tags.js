function titleKey(value){return String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();}
function remember(cache,key,value,limit=128,maxLength=65536){
  // Bound each entry and the number retained; oversized responses are displayed directly.
  if(JSON.stringify(value).length>maxLength)return value;
  cache.delete(key);cache.set(key,value);if(cache.size>limit)cache.delete(cache.keys().next().value);return value;
}
function canSearchUsers(query){return query.length>=2&&query.length<=80&&(query.match(/[\p{L}\p{N}]/ug)||[]).length>=2&&!/[%*]/.test(query);}
function unknownSearchUploaders(){return currentRows.some(row=>row[8].uploader&&!profileCache.has(row[8].uploader));}
function needsUserSearch(query){return phase==='ready'&&searchScopes.has('creator')&&canSearchUsers(query)&&!userSearchCache.has(query)&&unknownSearchUploaders();}
function syncSearchControls(){
  $('search-clear').hidden=!$('local-search').value;
  for(const field of Object.keys(searchFields)){
    const button=$('search-scope-'+field),selected=searchScopes.has(field),last=selected&&searchScopes.size===1;
    button.setAttribute('aria-pressed',String(selected));button.setAttribute('aria-disabled',String(last));
  }
  const query=titleKey($('local-search').value),active=phase==='ready'&&searchScopes.has('creator')&&Boolean(query);
  $('search-network-hint').hidden=!searchScopes.has('creator');
  const message=!active?'':textSearchWork?m('Searching uploader accounts...'):textSearchProblem||(!canSearchUsers(query)&&unknownSearchUploaders()?m('For uploader accounts, enter 2–80 characters with at least two letters or digits, without % or *.'):'');
  uiText($('search-message'),message);$('search-feedback').hidden=!message;$('search-feedback').classList.toggle('is-error',Boolean(textSearchProblem));$('search-retry').hidden=!active||!textSearchProblem;
  loadingIndicator($('search-message'),active&&Boolean(textSearchWork));
}
// Tag matching uses only the catalog already returned by searchCharts.
// Never fetch /api/song/{id}: the site's detail endpoint increments views.
function tagKey(value){return String(value??'').trim().toLowerCase();}
function cleanTags(value){
  const tags=new Map();
  for(const tag of Array.isArray(value)?value:[])if(typeof tag==='string'&&tag.trim()&&!tags.has(tagKey(tag)))tags.set(tagKey(tag),tag.trim());
  return [...tags.values()];
}
function rowsMatchingTags(rows,selection=selectedTags){
  if(!selection.size)return rows;
  const required=[...selection.keys()];
  return rows.filter(row=>{const tags=new Set((row[8].tags||[]).map(tagKey));return required.every(key=>tags.has(key));});
}
function countTagResults(rows){
  const counts=new Map();
  for(const row of rows)for(const key of new Set((row[8].tags||[]).map(tagKey)))counts.set(key,(counts.get(key)||0)+1);
  return counts;
}
function indexCatalogTags(data){
  tagCatalog.clear();
  for(const song of data)for(const tag of cleanTags(song?.tags))if(!tagCatalog.has(tagKey(tag)))tagCatalog.set(tagKey(tag),tag);
}
function tagFilterReady(){return phase==='ready'&&Boolean(applied)&&!appExiting;}
function positionTagPanel(panel,anchor){
  if(!anchor||!panel.matches(':popover-open'))return;
  const rect=anchor.getBoundingClientRect(),top=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||60;
  if(!anchor.isConnected||rect.bottom<top||rect.top>innerHeight){panel.hidePopover();return;}
  const width=panel.offsetWidth,height=panel.offsetHeight;
  panel.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';
  panel.style.top=Math.max(top+8,Math.min(rect.bottom+8,innerHeight-height-12))+'px';
}
function tagChip(key,name){
  const chip=element('span',undefined,'selected-tag'),label=element('span',name,'selected-tag-name'),remove=element('button',undefined,'selected-tag-remove');
  chip.dataset.tagKey=key;remove.type='button';uiAttr(remove,'aria-label',m('Remove tag: ')+name);
  remove.append(icon('close'));remove.addEventListener('click',()=>removeTagFilter(key));chip.append(label,remove);return chip;
}
function updateTagOverflow(){
  const strip=$('tag-filter-strip'),container=$('selected-tags'),more=$('tag-more');
  if(strip.hidden)return;
  for(const chip of container.children){chip.style.visibility='';chip.inert=false;chip.removeAttribute('aria-hidden');}
  more.hidden=true;
  if(container.scrollWidth<=container.clientWidth+1)return;
  more.hidden=false;uiText(more,'+'+selectedTags.size);
  const edge=container.getBoundingClientRect().right;let hidden=0;
  for(const chip of container.children)if(chip.getBoundingClientRect().right>edge+1){chip.style.visibility='hidden';chip.inert=true;chip.setAttribute('aria-hidden','true');hidden++;}
  more.hidden=!hidden;uiText(more,'+'+hidden);
}
function syncTagControls(){
  const ready=tagFilterReady(),strip=$('tag-filter-strip'),signature=JSON.stringify([...selectedTags]);
  $('tag-add-open').disabled=!ready;strip.hidden=!ready||!selectedTags.size;strip.inert=!ready;
  if(signature!==tagStripSignature){
    tagStripSignature=signature;$('selected-tags').replaceChildren();$('selected-tag-popover-content').replaceChildren();
    for(const [key,name] of selectedTags){$('selected-tags').append(tagChip(key,name));$('selected-tag-popover-content').append(tagChip(key,name));}
    refreshChartTagButtons();
  }
  if(!ready){for(const id of ['tag-picker','selected-tag-popover'])if($(id).matches(':popover-open'))$(id).hidePopover();dismissChartTags();}
  if(strip.hidden&&$('selected-tag-popover').matches(':popover-open'))$('selected-tag-popover').hidePopover();
  updateTagOverflow();
  if($('tag-picker').matches(':popover-open'))renderTagCandidates();
  positionTagPanel($('selected-tag-popover'),$('tag-more'));
}
function renderTagCandidates(){
  const query=tagKey($('tag-input').value),previous=tagCandidates[tagCandidateIndex]?.key;
  tagCandidates=[...tagCatalog].filter(([key])=>!selectedTags.has(key)&&(!query||key.includes(query)))
    .map(([key,name])=>({key,name,count:tagResultCounts.get(key)||0}))
    .sort((a,b)=>Number(b.key.startsWith(query))-Number(a.key.startsWith(query))||b.count-a.count||a.name.localeCompare(b.name,uiLanguage)).slice(0,30);
  tagCandidateIndex=previous?tagCandidates.findIndex(item=>item.key===previous):-1;
  const pending=Boolean(textSearchWork),list=$('tag-candidates');list.replaceChildren();
  for(const [index,item] of tagCandidates.entries()){
    const button=element('button',undefined,'tag-candidate'),label=element('span',item.name,'tag-candidate-name'),count=element('small',pending?m('Counting...'):number(item.count)+m(' results'),'tag-candidate-count');
    button.type='button';button.id='tag-candidate-'+index;button.setAttribute('role','option');button.tabIndex=-1;button.setAttribute('aria-selected',String(index===tagCandidateIndex));
    button.append(label,count);button.addEventListener('pointerdown',event=>event.preventDefault());
    button.addEventListener('click',()=>{if(addTagFilter(item.name,button)){$('tag-input').value='';tagCandidateIndex=-1;renderTagCandidates();$('tag-input').focus({preventScroll:true});}});
    list.append(button);
  }
  if(tagCandidateIndex>=0)$('tag-input').setAttribute('aria-activedescendant','tag-candidate-'+tagCandidateIndex);else $('tag-input').removeAttribute('aria-activedescendant');
  uiText($('tag-picker-feedback'),tagCandidates.length?m('Counts include the current search and all selected tags.'):query?m('No matching tag. Choose an existing tag.'):m('No more tags available.'));
  positionTagPanel($('tag-picker'),tagPickerAnchor);
}
function openTagPicker(anchor){
  if(!tagFilterReady())return;
  dismissChartTags();tagPickerAnchor=anchor;
  if($('selected-tag-popover').matches(':popover-open'))$('selected-tag-popover').hidePopover();
  $('tag-input').value='';tagCandidateIndex=-1;
  if(!$('tag-picker').matches(':popover-open'))$('tag-picker').showPopover();
  renderTagCandidates();$('tag-input').focus({preventScroll:true});
}
function captureTagAnchor(source){
  if(scrollY<10)return null;
  let view=cardViews.get(Number(source?.dataset.chartId));
  if(!view){const top=$('tag-filter-strip').hidden?60:$('tag-filter-strip').getBoundingClientRect().bottom;view=[...cardViews.values()].find(item=>{const rect=item.card.getBoundingClientRect();return rect.bottom>top&&rect.top<innerHeight;});}
  return view?{id:view.row[0],top:view.card.getBoundingClientRect().top}:null;
}
function captureTagViewport(){return {viewport:true,left:scrollX,top:scrollY,page,visibleCount};}
function tagFlightTarget(key){
  const chip=[...$('selected-tags').children].find(node=>node.dataset.tagKey===key&&!node.inert);
  return chip||(!$('tag-more').hidden?$('tag-more'):$('tag-filter-strip'));
}
function pulseTag(key){const target=tagFlightTarget(key);if(!target.hidden)playMotion(target,[{filter:'brightness(1)'},{filter:'brightness(1.8)'},{filter:'brightness(1)'}],{duration:MOTION_MS.panel});}
function flyTag(name,rect,key){
  if(!rect||!motionAllowed()){pulseTag(key);return;}
  const target=tagFlightTarget(key).getBoundingClientRect(),ghost=element('div',name,'tag-flight');
  ghost.setAttribute('aria-hidden','true');ghost.setAttribute('popover','manual');ghost.style.left=rect.left+'px';ghost.style.top=rect.top+'px';document.body.append(ghost);ghost.showPopover();
  const dx=target.left+target.width/2-rect.left-ghost.offsetWidth/2,dy=target.top+target.height/2-rect.top-ghost.offsetHeight/2;
  const animation=playMotion(ghost,[{transform:'translate(0,0) scale(1)',opacity:.95},{transform:'translate('+(dx*.45+20)+'px,'+(dy*.55-18)+'px) scale(.98)',opacity:.9,offset:.5},{transform:'translate('+dx+'px,'+dy+'px) scale(.7)',opacity:.3}],{duration:MOTION_MS.expressive});
  const finish=()=>{ghost.remove();if(selectedTags.has(key))pulseTag(key);};
  if(animation)animation.finished.then(finish,finish);else finish();
}
function addTagFilter(value,source){
  if(!tagFilterReady())return false;
  const key=tagKey(value);
  if(selectedTags.has(key)){pulseTag(key);return false;}
  const name=tagCatalog.get(key);if(!name)return false;
  const rect=source?.getBoundingClientRect(),anchor=source?.dataset?.chartId?captureTagAnchor(source):captureTagViewport();
  selectedTags.set(key,name);dismissChartTags();pendingTagAnchor=anchor;
  rebuild();flyTag(name,rect,key);return true;
}
function removeTagFilter(key){
  if(!tagFilterReady()||!selectedTags.has(key))return;
  const panel=$('selected-tag-popover'),inPanel=panel.contains(document.activeElement),area=$(inPanel?'selected-tag-popover-content':'selected-tags');
  const index=[...area.children].findIndex(chip=>chip.dataset.tagKey===key);
  pendingTagAnchor=captureTagViewport();selectedTags.delete(key);rebuild();
  const next=area.children[Math.min(index,area.children.length-1)],available=inPanel?panel.matches(':popover-open'):next&&!next.inert;
  const target=available?next?.querySelector('button'):$('tag-filter-strip').hidden?$('tag-add-open'):$('tag-add-sticky');
  if(!document.activeElement?.isConnected||document.activeElement===document.body)target.focus({preventScroll:true});
}
function clearTagFilters(){
  if(!tagFilterReady()||!selectedTags.size)return;
  pendingTagAnchor=captureTagViewport();selectedTags.clear();rebuild();$('tag-add-open').focus({preventScroll:true});
}
function prepareTagAnchor(ready,continuous){
  if(tagViewportFrame!==null){cancelAnimationFrame(tagViewportFrame);tagViewportFrame=null;}
  document.documentElement.classList.remove('tag-viewport-update');
  const anchor=pendingTagAnchor;if(!anchor)return;
  if(anchor.viewport){
    // Removing a constraint preserves the viewport, even when existing cards move to another page.
    document.documentElement.classList.add('tag-viewport-update');
    page=anchor.page;visibleCount=Math.max(visibleCount,anchor.visibleCount);return;
  }
  if(!ready)return;
  const index=filtered.findIndex(row=>row[0]===anchor.id);
  if(index>=0){if(continuous)visibleCount=Math.max(visibleCount,Math.ceil((index+1)/scrollBatchSize)*scrollBatchSize);else page=Math.floor(index/pageSize())+1;}
}
function restoreTagAnchor(){
  const anchor=pendingTagAnchor;if(!anchor)return;pendingTagAnchor=null;
  if(anchor.viewport){
    const restore=()=>scrollTo({left:anchor.left,top:anchor.top,behavior:'instant'});
    restore();
    tagViewportFrame=requestAnimationFrame(()=>{
      restore();document.documentElement.classList.remove('tag-viewport-update');tagViewportFrame=null;
    });
    return;
  }
  const card=cardViews.get(anchor.id)?.card;
  if(card)scrollBy({top:card.getBoundingClientRect().top-anchor.top,behavior:'instant'});
  else{
    const first=$('rows').firstElementChild||$('empty'),offset=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||60)+($('tag-filter-strip').hidden?0:$('tag-filter-strip').offsetHeight)+14;
    scrollBy({top:first.getBoundingClientRect().top-offset,behavior:'instant'});
  }
}
function setupTagFilters(){
  for(const id of ['tag-add-open','tag-add-sticky'])$(id).addEventListener('click',()=>openTagPicker($(id)));
  $('tag-picker-close').addEventListener('click',()=>{$('tag-picker').hidePopover();tagPickerAnchor?.focus({preventScroll:true});});
  $('tag-picker').addEventListener('toggle',event=>{if(event.newState==='closed')tagPickerAnchor?.setAttribute('aria-expanded','false');else tagPickerAnchor?.setAttribute('aria-expanded','true');});
  $('tag-input').addEventListener('input',()=>{tagCandidateIndex=-1;renderTagCandidates();});
  $('tag-input').addEventListener('keydown',event=>{
    if(event.isComposing||event.keyCode===229)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();if(!tagCandidates.length)return;
      tagCandidateIndex=(tagCandidateIndex+(event.key==='ArrowDown'?1:-1)+tagCandidates.length)%tagCandidates.length;
      for(const [index,node] of [...$('tag-candidates').children].entries())node.setAttribute('aria-selected',String(index===tagCandidateIndex));
      $('tag-input').setAttribute('aria-activedescendant','tag-candidate-'+tagCandidateIndex);$('tag-candidates').children[tagCandidateIndex]?.scrollIntoView({block:'nearest'});return;
    }
    if(event.key==='Enter'){
      event.preventDefault();const candidate=tagCandidates[tagCandidateIndex],name=candidate?.name||tagCatalog.get(tagKey($('tag-input').value));
      if(name&&addTagFilter(name,candidate?$('tag-candidates').children[tagCandidateIndex]:$('tag-input'))){$('tag-input').value='';tagCandidateIndex=-1;renderTagCandidates();}
      else if(!name)uiText($('tag-picker-feedback'),m('Choose a suggested tag, or enter its complete name.'));
    }
  });
  $('tag-clear').addEventListener('click',clearTagFilters);
  $('tag-more').addEventListener('click',()=>{const panel=$('selected-tag-popover');if(panel.matches(':popover-open'))panel.hidePopover();else{panel.showPopover();positionTagPanel(panel,$('tag-more'));panel.querySelector('button')?.focus({preventScroll:true});}});
  $('selected-tag-popover').addEventListener('toggle',event=>$('tag-more').setAttribute('aria-expanded',String(event.newState==='open')));
  $('selected-tag-popover').addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();$('selected-tag-popover').hidePopover();(!$('tag-more').hidden?$('tag-more'):$('tag-add-open')).focus({preventScroll:true});}});
  let frame=null;
  const reposition=()=>{if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;positionTagPanel($('tag-picker'),tagPickerAnchor);positionTagPanel($('selected-tag-popover'),$('tag-more'));});};
  const resize=()=>{updateTagOverflow();reposition();};
  globalThis.addEventListener('scroll',reposition,{passive:true});globalThis.addEventListener('resize',resize);
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(resize);observer.observe($('tag-filter-strip'));}
  document.fonts?.ready?.then(updateTagOverflow);
}
function stopTextSearch(clear=false){const work=textSearchWork;textSearchWork=null;work?.controller.abort();if(clear)textSearchProblem='';}
function scopeSearchUsers(users,rows){const ids=new Set(rows.map(row=>row[8].uploader));for(const user of users)if(ids.has(user.id))remember(profileCache,user.id,user,2048);}
function startTextSearch(query){
  if(textSearchWork||textSearchProblem||!needsUserSearch(query))return;
  const work={controller:new AbortController(),query,rows:currentRows,generation:cacheGeneration,promise:null};textSearchWork=work;
  work.promise=(async()=>{
    try{const users=await readUserSearch(query,work.controller.signal);if(textSearchWork===work)scopeSearchUsers(users,currentRows);}
    catch{if(textSearchWork===work)textSearchProblem=m('Uploader lookup failed. Showing local matches only.');}
    finally{if(textSearchWork===work){textSearchWork=null;await rebuild(false);}}
  })();
}
function changeSearchScope(field){
  if(searchScopes.has(field)){if(searchScopes.size===1)return;searchScopes.delete(field);}else searchScopes.add(field);
  textSearchProblem='';if(!searchScopes.has('creator'))stopTextSearch();
  syncSearchControls();if(phase!=='ready'||!titleKey($('local-search').value))return;
  rebuild(false);
  if(!textSearchWork&&needsUserSearch(titleKey($('local-search').value)))textFilterTimer=setTimeout(()=>{textFilterTimer=null;rebuild();},300);
}
function resetFilters(){
  selectedTags.clear();pendingTagAnchor=null;
  lastAppliedCriteria=null;cancelQuery();$('local-search').value='';$('min').value='0';$('max').value='99';
  for(const field of Object.keys(searchFields))searchScopes.add(field);
  for(const input of document.querySelectorAll('input[name="diff"]'))input.checked=input.value==='4';
  $('date-preset').value='7';applyDatePreset();$('sort').value='date';$('sort-direction').value='desc';syncSearchControls();syncFilters();
}
