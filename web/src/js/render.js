function render(append=false){
  const ready=phase==='ready',continuous=isContinuous();
  prepareTagAnchor(ready,continuous);
  if(!append){dismissChartTags();dismissChartDescription(false,false);}
  if(!ready){stopPageDetails();installationViews.clear();cardViews.clear();renderedCount=0;$('rows').replaceChildren();if(phase!=='ready')trimPresenceQueue();}
  const size=pageSize(),totalPages=pages();page=Math.max(1,Math.min(page,totalPages));
  const start=continuous?0:(page-1)*size,end=Math.min(continuous?visibleCount:start+size,filtered.length);
  const shown=ready?filtered.slice(start,end):[],wanted=new Map(shown.map(row=>[row[0],row])),reviewCells=[];
  for(const [id,view] of cardViews)if(wanted.get(id)!==view.row){retireReviewCell(view.cell);view.card.remove();cardViews.delete(id);installationViews.delete(id);}
  prunePageDetails(new Set([...cardViews.values()].map(view=>view.cell)));
  for(const row of shown){
    if(cardViews.has(row[0]))continue;
    const view=createChartCard(row);reviewCells.push(view.cell);cardViews.set(row[0],view);
  }
  $('rows').setAttribute('aria-busy',phase==='loading'||installationFilterPending?'true':'false');
  for(const [index,row] of shown.entries()){const card=cardViews.get(row[0]).card;if($('rows').children[index]!==card)$('rows').insertBefore(card,$('rows').children[index]||null);queueEntry(card,'chart:'+row[0]);}renderedCount=continuous?end:shown.length;pruneEntries();scheduleChartDescriptions();
  const emptyState=$('empty-state'),empty=$('empty');emptyState.hidden=ready&&filtered.length!==0;
  const installationProgress=installationFilterPending?installationProgressText(installationFilterRemaining):m('Checking installation status...');
  uiText(empty,phase==='loading'?m("Loading charts..."):phase==='error'?m("Search failed. Try again."):ready?installationFilterPending?installationProgress:textSearchWork?m('Searching uploader accounts...'):textSearchProblem||m("No matching charts. Try other filters."):m("Choose difficulty and dates, then select Filter charts."));
  empty.classList.toggle('error',phase==='error');loadingIndicator(empty,phase==='loading'||ready&&installationFilterPending&&filtered.length===0);
  $('query-retry').hidden=phase!=='error';$('query-retry').disabled=appExiting;
  uiText($('count'),ready?number(filtered.length)+m(" charts"):phase==='loading'?m("Searching..."):phase==='error'?m("Search failed"):m("Ready to search"));
  const scope=applied?[m("Rating: ")+applied.min+'–'+applied.max,applied.diffs.map(i=>labels[i]).join(' / ')]:[];
  if(applied?.dateFrom||applied?.dateTo)scope.push(m("Upload date: ")+(applied.dateFrom||'…')+' – '+(applied.dateTo||'…'));
  if(appliedText)scope.push(m("Text: ")+appliedText);uiText($('scope'),scope.join(m(" | ")));
  $('scope').hidden=!ready||$('filter-panel').open;
  const pageText=ready?(filtered.length?continuous?m("Showing ")+number(end)+m(" items"):m("Page ")+page+' / '+totalPages+m(" | Showing ")+number(start+1)+'–'+number(end)+m(" items"):m("No matching results")):phase==='loading'?m("Loading results..."):phase==='error'?m("Search failed"):m("Ready to search"),showPageNavigation=ready&&filtered.length>0&&!continuous&&totalPages>1,showContinuousControl=ready&&filtered.length>0&&continuous;
  for(const suffix of ['','-bottom']){
    uiText($('page-label'+suffix),pageText);
    const pager=$('pager'+suffix),displayOnly=!suffix&&showContinuousControl;
    pager.hidden=suffix?!showPageNavigation:!(showPageNavigation||showContinuousControl);pager.classList.toggle('is-display-only',displayOnly);
    $('page-controls'+suffix).hidden=continuous;$('page-jump'+suffix).hidden=continuous;
    renderPageLinks(suffix,ready);$('prev'+suffix).disabled=!ready||page===1;$('next'+suffix).disabled=!ready||page===totalPages;
    $('page-number'+suffix).value=String(page);$('page-number'+suffix).max=String(totalPages);
    $('page-number'+suffix).disabled=!ready||continuous;$('jump'+suffix).disabled=!ready||continuous;
    $('page-size'+suffix).value=continuous?'all':String(size);$('page-size'+suffix).disabled=phase!=='ready';
  }
  syncFilters();syncSearchControls();syncInstallationFilter();
  for(const id of ['sort','sort-direction'])$(id).disabled=phase!=='ready';
  syncReviewVisibility();
  if(ready&&reviewCells.length)watchPageReviews(reviewCells);
  watchMore(ready);
  syncCovers();
  if(typeof syncPreviewButtons==='function')syncPreviewButtons();
  if(ready){if(installationFilterMode()==='all')trimPresenceQueue(shown);queueInstallationChecks(append?shown.slice(-scrollBatchSize):shown);}
  if(ready||pendingTagAnchor?.viewport)restoreTagAnchor();
}
function setBusy(){syncFilters();}
function compact(data,criteria){
  const found=new Map();
  for(const song of data){
    if(!song||typeof song!=='object')continue;
    const id=Number(song.id);if(!Number.isSafeInteger(id)||id<=0)continue;
    const date=String(song.uploadDate?.date||'').slice(0,10);
    if((criteria.dateFrom||criteria.dateTo)&&(!validDate(date)||criteria.dateFrom&&date<criteria.dateFrom||criteria.dateTo&&date>criteria.dateTo))continue;
    const diffs=[];keys.forEach(([flag,key],index)=>{const rating=song[key];if(criteria.diffs.includes(index)&&song[flag]&&typeof rating==='number'&&Number.isFinite(rating)&&rating>=criteria.min&&rating<=criteria.max)diffs.push([index,rating]);});
    if(!diffs.length)continue;
    const cover=coverURL(song.cover),reference=String(song.fileReference||''),previewReference=/^spinshare_[a-f0-9]{1,64}$/i.test(reference)?reference:'',thumbnail=coverURL(song.thumbnail)||(previewReference?'https://spinshare.b-cdn.net/uploads/thumbnail/'+previewReference+'.jpg':'');
    found.set(id,[id,String(song.title||''),String(song.subtitle||''),String(song.artist||''),String(song.charter||''),String(song.uploadDate?.date||''),diffs,Math.min(...diffs.map(pair=>pair[1])),{cover,thumbnail,fileReference:reference,previewReference,updateHash:/^[a-f0-9]{32}$/i.test(song.updateHash||'')?song.updateHash:'',views:countValue(song.views),downloads:countValue(song.downloads),uploader:Number.isSafeInteger(song.uploader)&&song.uploader>0?song.uploader:null,dlc:compactDLC(song.dlc),tags:cleanTags(song.tags),description:typeof song.description==='string'?song.description:''}]);
  }
  return [...found.values()];
}
