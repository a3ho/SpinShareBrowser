async function apply(){
  if(phase==='loading'||catalogStartupBusy||appExiting)return;
  let criteria;try{criteria=readCriteria();}catch(error){setStatus(errorText(error),true);return;}
  const request=new AbortController();controller=request;let timedOut=false,timer=null;
  try{
    stopTextSearch(true);clearTimeout(textFilterTimer);textFilterTimer=null;
    currentRows=[];filtered=[];phase='loading';page=1;visibleCount=scrollBatchSize;render();
    // Startup normally restores this cache before the controls unlock. Keep a
    // cache-only fallback here for isolated reloads; filtering never triggers a remote update.
    if(catalog===null){
      timer=setTimeout(()=>{timedOut=true;request.abort();},requestTimeout);setStatus(m('Loading charts...'));
      const result=await loadRemote(request.signal);if(controller!==request)return;if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
      if(!publishCatalogResult(result).available)throw uiError(m('Chart data could not be loaded'));
      clearTimeout(timer);timer=null;
    }
    if(controller!==request)return;if(request.signal.aborted&&!timedOut)throw new DOMException('Aborted','AbortError');
    const rows=compact(catalog,criteria);
    if(lastAppliedCriteria&&JSON.stringify(criteria)!==JSON.stringify(lastAppliedCriteria)){$('local-search').value='';appliedText='';}
    applied=criteria;lastAppliedCriteria=criteria;currentRows=rows;phase='ready';
    syncSearchControls();setStatus('');await rebuild();
  }catch(error){
    if(controller!==request)return;request.abort();
    const message=error.name==='AbortError'?(timedOut?m('Loading charts timed out. Try again.'):m('Search cancelled.')):error instanceof TypeError?m('Connection failed. Check your network and try again.'):errorText(error);
    currentRows=[];filtered=[];applied=null;phase='error';render();setStatus(message,true);
  }finally{clearTimeout(timer);if(controller===request){controller=null;syncFilters();}}
}
$('filters').addEventListener('submit',event=>{event.preventDefault();return apply();});
$('apply-filters').addEventListener('click',event=>{event.preventDefault();return apply();});
$('refresh-data').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();return manualCatalogSync();});
$('query-retry').addEventListener('click',()=>apply());
$('chart-search-form').addEventListener('submit',event=>{event.preventDefault();textSearchProblem='';if(phase==='ready')return rebuild();});
$('search-clear').addEventListener('click',()=>{stopTextSearch(true);$('local-search').value='';syncSearchControls();$('local-search').focus();if(phase==='ready')return rebuild();});
for(const field of Object.keys(searchFields))$('search-scope-'+field).addEventListener('click',()=>changeSearchScope(field));
$('search-retry').addEventListener('click',()=>{textSearchProblem='';if(phase==='ready')return rebuild();});
$('installation-filter').addEventListener('change',()=>{if(phase==='ready'&&!appExiting)rebuild(false);});
$('installation-filter-retry').addEventListener('click',()=>refreshInstallationChecks(true));
$('reset-filters').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();resetFilters();});
$('date-preset').addEventListener('change',applyDatePreset);
for(const id of ['date-from','date-to']){
  $(id).addEventListener('input',()=>{$('date-preset').value='custom';syncDates();syncFilters();});
  $(id).addEventListener('change',()=>{$(id).value=$(id).value.trim();syncDates();syncFilters();});
  $(id+'-open').addEventListener('click',()=>openDatePicker(id));
  $(id+'-open').setAttribute('aria-haspopup','dialog');$(id+'-open').setAttribute('aria-controls','date-calendar');$(id+'-open').setAttribute('aria-expanded','false');
  $(id+'-picker').addEventListener('change',()=>{if(appExiting)return;$(id).value=$(id+'-picker').value;$('date-preset').value='custom';syncDates();syncFilters();$(id+'-open').focus({preventScroll:true});});
}
for(const input of document.querySelectorAll('input[name="diff"],#min,#max'))input.addEventListener('input',syncFilters);
$('filter-panel').addEventListener('toggle',()=>{setCatalogHelp(false);$('scope').hidden=$('filter-panel').open||phase!=='ready';});
$('local-search').addEventListener('input',()=>{stopTextSearch(true);syncSearchControls();clearTimeout(textFilterTimer);textFilterTimer=null;if(phase==='ready')textFilterTimer=setTimeout(()=>{textFilterTimer=null;rebuild();},300);});
for(const id of ['sort','sort-direction'])$(id).addEventListener('change',()=>rebuild());
for(const suffix of ['','-bottom']){
  $('page-size'+suffix).addEventListener('change',()=>{$('page-size').value=$('page-size'+suffix).value;page=1;visibleCount=scrollBatchSize;render();if(suffix)focusResults();});
  $('prev'+suffix).addEventListener('click',()=>changePage(page-1));$('next'+suffix).addEventListener('click',()=>changePage(page+1));
  $('jump'+suffix).addEventListener('click',()=>jumpToPage(suffix));
  $('page-number'+suffix).addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();jumpToPage(suffix);}});
}
$('load-more').addEventListener('click',loadMore);
pagerMedia?.addEventListener('change',()=>{for(const suffix of ['','-bottom'])renderPageLinks(suffix,phase==='ready');});
globalThis.addEventListener?.('focus',()=>{if(!document.hidden){refreshInstallationChecks();maybeRunAutomaticCatalogSync();}});
setupTagFilters();setupRuntime();setupPageControls();applyDatePreset();captureDefaultCriteria();render();syncFilters();startCatalogRuntime();
