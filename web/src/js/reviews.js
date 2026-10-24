function reviewsOpen(cell){return !cell.retired&&cardViews.get(cell.row[0])?.cell===cell&&(showChartReviews||cell.reviewTemporaryOpen);}
function reviewRefreshRemaining(){
  try{
    const stored=Number(globalThis.localStorage.getItem(REVIEW_REFRESH_STORAGE_KEY));
    if(Number.isSafeInteger(stored)&&stored>0)reviewRefreshNextAllowedAt=Math.max(reviewRefreshNextAllowedAt,stored);
  }catch{}
  return Math.max(0,reviewRefreshNextAllowedAt-Date.now());
}
function reviewRefreshClock(remaining){
  const seconds=Math.ceil(remaining/1000);return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
}
function syncReviewRefresh(){
  const remaining=reviewRefreshRemaining(),blocked=remaining>0||Boolean(reviewRefreshOwner);
  const label=m('Refresh reviews')+(remaining?' · '+reviewRefreshClock(remaining):'');
  const help=remaining?m('Reviews can be refreshed again in ')+reviewRefreshClock(remaining):reviewRefreshOwner?m('A review refresh is queued. Please wait.') : '';
  let active=false;
  for(const {cell} of cardViews.values()){
    if(cell.retired)continue;active=true;
    cell.refresh.disabled=Boolean(cell.pending)||blocked;uiText(cell.refreshLabel,label);
    uiAttr(cell.refresh,'aria-label',m('Reload ')+cell.row[1]+m("'s complete reviews")+(help?' · '+help:''));
  }
  if(remaining&&active){
    if(reviewRefreshTimer===null)reviewRefreshTimer=setTimeout(()=>{reviewRefreshTimer=null;syncReviewRefresh();},1000);
  }else{clearTimeout(reviewRefreshTimer);reviewRefreshTimer=null;}
}
function reserveReviewRefresh(cell,state){
  if(reviewRefreshRemaining()>0||reviewRefreshOwner){syncReviewRefresh();return null;}
  const owner={cell,state,started:false};reviewRefreshOwner=owner;syncReviewRefresh();return owner;
}
function releaseReviewRefresh(owner){
  if(owner&&reviewRefreshOwner===owner){reviewRefreshOwner=null;syncReviewRefresh();}
}
function beginReviewRefresh(owner){
  if(owner&&(reviewRefreshOwner!==owner||owner.started||owner.cell.retired||owner.state.stopped))throw new DOMException('Aborted','AbortError');
  const remaining=reviewRefreshRemaining();
  if(remaining>0||reviewRefreshOwner&&reviewRefreshOwner!==owner){
    syncReviewRefresh();
    const error=uiError(remaining?m('Reviews can be refreshed again in ')+reviewRefreshClock(remaining):m('A review refresh is queued. Please wait.'));
    error.code=remaining?'review_refresh_cooldown':'review_refresh_queued';throw error;
  }
  // A failed force request still consumes the shared minute; storage failure keeps the in-page gate.
  reviewRefreshNextAllowedAt=Date.now()+REVIEW_REFRESH_MS;
  try{globalThis.localStorage.setItem(REVIEW_REFRESH_STORAGE_KEY,String(reviewRefreshNextAllowedAt));}catch{}
  if(owner)owner.started=true;syncReviewRefresh();
}
function bindReadingWheel(target,list,active=()=>true){
  target.addEventListener('wheel',event=>{
    if(!active()||target.inert||!target.matches(':popover-open')||event.ctrlKey)return;
    // Headers, padding and scroll boundaries belong to the same reading surface.
    event.preventDefault();event.stopPropagation();
    const unit=event.deltaMode===1?parseFloat(getComputedStyle(list).lineHeight)||16:event.deltaMode===2?list.clientHeight||target.clientHeight:1;
    list.scrollTop+=event.deltaY*unit;
  },{passive:false});
}
function cancelReadingMotion(cell){
  let from=null;
  if(cell.target.matches(':popover-open')){
    const surface=getComputedStyle(cell.body),backdrop=getComputedStyle(cell.target,'::backdrop');
    from={opacity:surface.opacity,transform:surface.transform||'none',backdropOpacity:backdrop.opacity};
  }
  cell.readingMotion?.cancel();cell.readingMotion=null;
  cell.readingBackdropMotion?.cancel();cell.readingBackdropMotion=null;
  return from;
}
function animateReadingPopover(cell,open,animate,from=null){
  const target=cell.target,offset=cell.readingEnterOffset||10;
  const start=from?{opacity:from.opacity,transform:from.transform}:{opacity:0,transform:'translateY('+offset+'px) scale(.985)'};
  const end=open?{opacity:1,transform:'translateY(0) scale(1)'}:{opacity:0,transform:'translateY('+(offset*.6)+'px) scale(.985)'};
  const options={...(open?READING_MOTION.enter:READING_MOTION.exit),fill:'both'};
  const motion=animate?playMotion(cell.body,[start,end],options):null;
  let backdropMotion=null;
  // Older WebViews may not animate ::backdrop; the static shade remains usable.
  if(animate)try{backdropMotion=playMotion(target,[{opacity:from?.backdropOpacity??0},{opacity:open?1:0}],{...options,pseudoElement:'::backdrop'});}catch{}
  cell.readingMotion=motion;cell.readingBackdropMotion=backdropMotion;
  const finish=()=>{
    if(cell.readingMotion!==motion)return;
    cell.readingMotion=null;
    if(!cell.readingVisible){if(target.matches(':popover-open'))target.hidePopover();target.hidden=true;}
    motion?.cancel();backdropMotion?.cancel();
    if(cell.readingBackdropMotion===backdropMotion)cell.readingBackdropMotion=null;
  };
  if(motion)motion.finished.then(finish,()=>{});else finish();
}
function positionReadingPopover(cell){
  const anchor=cell.toggle.getBoundingClientRect(),width=document.documentElement.clientWidth||innerWidth,height=innerHeight;
  const top=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||64)+12;
  const narrow=width<=680,panelWidth=Math.min(cell.readingWidth||680,width-24),spaceBelow=height-anchor.bottom-20,spaceAbove=anchor.top-top-8;
  const style=cell.target.style,left=Math.max(12,Math.min(anchor.left,width-panelWidth-12));
  style.width=panelWidth+'px';style.left=left+'px';
  if(narrow){
    // Keep the sheet within a short pointer path even when its trigger is near the top.
    style.top=Math.max(top,Math.min(anchor.bottom+8,height*.3))+'px';style.bottom='12px';style.height='auto';style.maxHeight='none';
    cell.readingEnterOffset=12;cell.body.style.transformOrigin='50% 100%';
  }else{
    const below=spaceBelow>=Math.min(360,height*.45)||spaceBelow>=spaceAbove;
    style.top=below?Math.max(top,anchor.bottom+8)+'px':'auto';
    style.bottom=below?'auto':Math.max(12,height-anchor.top+8)+'px';
    style.height='auto';style.maxHeight=Math.max(100,Math.min(560,below?height-Math.max(top,anchor.bottom+8)-12:spaceAbove))+'px';
    cell.readingEnterOffset=below?-10:10;cell.body.style.transformOrigin=Math.max(16,Math.min(panelWidth-16,anchor.left+anchor.width/2-left))+'px '+(below?'top':'bottom');
  }
}
function changeReviewContent(cell,write){write();}
function syncReviewCount(cell){
  const known=reviewCounts.has(cell.row[0]),empty=reviewCounts.get(cell.row[0])===0;
  uiText(cell.commentValue,known?number(reviewCounts.get(cell.row[0])):cell.reviewError?'!':'…');
  cell.commentValue.setAttribute('aria-busy',String(Boolean(cell.pending)));
  cell.toggle.classList.toggle('is-count-error',Boolean(cell.reviewError)&&!empty);
  syncReviewToggle(cell);
}
function syncReviewToggle(cell){
  const empty=reviewCounts.get(cell.row[0])===0,open=reviewsOpen(cell),pinned=showChartReviews&&open;
  cell.toggle.disabled=false;cell.chevron.hidden=false;
  cell.toggle.setAttribute('aria-expanded',String(open));cell.toggle.setAttribute('aria-controls',cell.target.id);
  cell.toggle.setAttribute('aria-disabled',String(pinned));
  const label=(empty||pinned?m('Reviews for '):open?m('Collapse reviews for '):m('Expand reviews for '))+cell.row[1];
  uiAttr(cell.toggle,'aria-label',label+(reviewCounts.has(cell.row[0])?' · '+m('Reviews')+': '+number(reviewCounts.get(cell.row[0])):''));
  uiAttr(cell.toggle,'aria-description',empty?m('No reviews yet.'):cell.reviewError?m('Review count could not be updated. Open reviews to retry.'):!reviewCounts.has(cell.row[0])?m('Loading review count...'):'');
  if(pinned)cell.toggle.removeAttribute('aria-haspopup');else cell.toggle.setAttribute('aria-haspopup','dialog');
  cell.target.classList.toggle('is-pinned',pinned);
  cell.context.hidden=showChartReviews;
}
function syncReviewVisibility(animate=false,cells=[...cardViews.values()].map(view=>view.cell)){
  const control=$('show-chart-reviews'),state=pageDetails;control.checked=showChartReviews;control.disabled=phase!=='ready';
  if(showChartReviews)reviewPopoverOwner=null;
  for(const cell of cells){
    const empty=reviewCounts.get(cell.row[0])===0,restoreFocus=empty&&(cell.target.contains(document.activeElement)||document.activeElement===cell.toggle);
    if(empty){
      clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;cell.reviewTemporaryOpen=false;cell.reviewLoaded=false;
      if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
      if(cell.list.children.length){cell.list.replaceChildren();pruneEntries();}
    }
    const target=cell.target,open=reviewsOpen(cell),changed=cell.readingVisible!==open||target.hasAttribute('popover')===showChartReviews;
    if(changed){
      const from=cancelReadingMotion(cell);cell.readingVisible=open;target.inert=!open;
      if(showChartReviews){
        if(target.matches(':popover-open'))target.hidePopover();
        target.removeAttribute('popover');target.removeAttribute('style');cell.body.removeAttribute('style');target.setAttribute('role','region');target.hidden=!open;
      }else{
        target.setAttribute('popover','manual');target.setAttribute('role','dialog');
        if(open){
          reviewPopoverOwner=cell;target.hidden=false;positionReadingPopover(cell);
          if(!target.matches(':popover-open'))target.showPopover();animateReadingPopover(cell,true,animate,from);
        }else if(target.matches(':popover-open'))animateReadingPopover(cell,false,animate,from);
        else target.hidden=true;
      }
    }
    syncReviewToggle(cell);
    if(restoreFocus)cell.card.querySelector('.song-title')?.focus({preventScroll:true});
    if(state&&open&&animate)queueReviews(cell,state);
  }
  syncReviewRefresh();
}
function closeTemporaryReviews(cell,focus=false,animate=true){
  if(!cell)return;
  clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
  if(showChartReviews||!cell.reviewTemporaryOpen)return;
  if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
  cell.reviewTemporaryOpen=false;syncReviewVisibility(animate,[cell]);
  if(focus)cell.toggle.focus({preventScroll:true});
}
function bindReviewDrawer(cell){
  const card=cell.card;
  cell.toggle.addEventListener('pointerdown',event=>{cell.reviewPointerType=event.pointerType;});
  cell.toggle.addEventListener('click',event=>{
    if(showChartReviews)return;
    dismissChartDescription(false,false);
    clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
    cell.reviewInput=event.detail===0?'keyboard':cell.reviewPointerType||'mouse';
    if(reviewPopoverOwner&&reviewPopoverOwner!==cell)closeTemporaryReviews(reviewPopoverOwner);
    cell.reviewTemporaryOpen=!cell.reviewTemporaryOpen;syncReviewVisibility(true,[cell]);
    if(!cell.reviewTemporaryOpen&&reviewPopoverOwner===cell)reviewPopoverOwner=null;
    if(cell.reviewTemporaryOpen&&cell.reviewInput==='keyboard')cell.target.focus({preventScroll:true});
  });
  bindReadingWheel(cell.target,cell.list,()=>!showChartReviews);
  const enter=()=>{clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;};
  const leave=event=>{
    if(event.pointerType==='touch'||cell.reviewInput==='keyboard'||card.contains(event.relatedTarget))return;
    clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=setTimeout(()=>{
      cell.reviewLeaveTimer=null;closeTemporaryReviews(cell);
    },180);
  };
  card.addEventListener('pointerenter',enter);card.addEventListener('pointerleave',leave);
  cell.target.addEventListener('pointerenter',enter);cell.target.addEventListener('pointerleave',leave);
  card.addEventListener('focusout',event=>{if(cell.reviewInput==='keyboard'&&!card.contains(event.relatedTarget))closeTemporaryReviews(cell);});
  cell.target.addEventListener('toggle',event=>{
    if(event.newState==='closed'&&cell.reviewTemporaryOpen&&!cell.target.matches(':popover-open'))closeTemporaryReviews(cell);
  });
}
function retireReviewCell(cell){
  cell.retired=true;clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;
  cell.request?.abort();cancelReadingMotion(cell);
  if(reviewRefreshOwner?.cell===cell)releaseReviewRefresh(reviewRefreshOwner);
  if(reviewPopoverOwner===cell)reviewPopoverOwner=null;
  if(cell.target.matches(':popover-open'))cell.target.hidePopover();cell.target.hidden=true;
}
function setupPageControls(){
  uiText($('show-chart-reviews-label'),m('Expand all reviews'));
  $('show-chart-reviews').addEventListener('change',()=>{
    showChartReviews=$('show-chart-reviews').checked;
    for(const {cell} of cardViews.values()){clearTimeout(cell.reviewLeaveTimer);cell.reviewLeaveTimer=null;cell.reviewTemporaryOpen=false;}
    syncReviewVisibility(true);
  });
  document.addEventListener('pointerdown',event=>{if(reviewPopoverOwner&&!reviewPopoverOwner.card.contains(event.target))closeTemporaryReviews(reviewPopoverOwner);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&reviewPopoverOwner){event.preventDefault();closeTemporaryReviews(reviewPopoverOwner,true);}});
  document.addEventListener('scroll',event=>{if(event.target===document||event.target===document.documentElement)closeTemporaryReviews(reviewPopoverOwner);},{capture:true,passive:true});
  globalThis.addEventListener?.('resize',()=>{if(reviewPopoverOwner)positionReadingPopover(reviewPopoverOwner);});
  globalThis.addEventListener?.('blur',()=>closeTemporaryReviews(reviewPopoverOwner));
  globalThis.addEventListener?.('focus',syncReviewRefresh);
  globalThis.addEventListener?.('storage',event=>{if(event.key===REVIEW_REFRESH_STORAGE_KEY||event.key===null)syncReviewRefresh();});
  syncReviewRefresh();
  const button=$('back-to-top');uiAttr(button,'aria-label',m('Back to top'));
  let shown=false;
  const update=()=>{
    const visible=globalThis.scrollY>Math.max(300,globalThis.innerHeight*.5);if(visible===shown)return;shown=visible;
    button.classList.toggle('is-visible',visible);button.inert=!visible;button.tabIndex=visible?0:-1;button.setAttribute('aria-hidden',String(!visible));
    if(!visible&&document.activeElement===button)$('filter-panel').querySelector('summary').focus({preventScroll:true});
  };
  button.addEventListener('click',()=>{$('filter-panel').querySelector('summary').focus({preventScroll:true});globalThis.scrollTo({top:0,behavior:motionAllowed()?'smooth':'auto'});});
  globalThis.addEventListener?.('scroll',update,{passive:true});globalThis.addEventListener?.('resize',update);
  update();syncReviewVisibility();
}
