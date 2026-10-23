function cancelChartDescriptionMotion(view){
  const motion=view?.motion;if(motion)try{motion.cancel();}catch{}if(view)view.motion=null;
  if(view?.preview){view.preview.style.height='';view.preview.style.willChange='';}
}
function releaseChartDescriptionGeometry(view){
  if(!view)return;const {preview,content,notes,card}=view;
  preview?.classList.remove('is-floating','is-collapsing');
  card?.classList.remove('is-description-expanded');notes?.classList.remove('is-description-expanded');
  if(preview){
    preview.style.height='';preview.style.willChange='';
    for(const name of ['--description-float-top','--description-float-left','--description-float-width','--description-expanded-height'])preview.style.removeProperty(name);
  }
  if(content)content.scrollTop=0;
  if(notes){notes.style.height='';notes.style.minHeight='';}
}
function chartDescriptionGeometry(view){
  const {preview,content,notes}=view,previewRect=preview.getBoundingClientRect(),notesRect=notes?.getBoundingClientRect?.()||previewRect;
  const notesStyle=notes?getComputedStyle(notes):null,borderTop=Number.parseFloat(notesStyle?.borderTopWidth)||0,borderLeft=Number.parseFloat(notesStyle?.borderLeftWidth)||0;
  const from=previewRect.height||preview.clientHeight||view.cut+3;
  const viewportHeight=document.documentElement.clientHeight||globalThis.innerHeight||800;
  const available=Math.max(from,viewportHeight-Math.max(16,previewRect.top)-28);
  const target=Math.max(from,Math.min(content.scrollHeight,520,available));
  const width=previewRect.width||preview.clientWidth||Math.max(0,notesRect.width-(previewRect.left-notesRect.left));
  return {from,target,top:previewRect.top-notesRect.top-borderTop,left:previewRect.left-notesRect.left-borderLeft,width,notesHeight:notesRect.height||notes?.clientHeight||from};
}
function prepareChartDescriptionGeometry(view,geometry){
  const {preview,notes,card}=view;
  preview.style.setProperty('--description-float-top',geometry.top+'px');
  preview.style.setProperty('--description-float-left',geometry.left+'px');
  preview.style.setProperty('--description-float-width',geometry.width+'px');
  preview.style.setProperty('--description-expanded-height',geometry.target+'px');
  if(notes){notes.style.height=geometry.notesHeight+'px';notes.style.minHeight=geometry.notesHeight+'px';notes.classList.add('is-description-expanded');}
  card?.classList.add('is-description-expanded');preview.classList.add('is-floating');
}
function syncChartDescriptionAccessibility(view,expanded){
  const {preview,content,config}=view;content.inert=!expanded;preview.tabIndex=view.overflow?0:-1;
  preview.setAttribute('role',expanded?'region':'button');
  if(expanded){preview.removeAttribute('aria-expanded');preview.removeAttribute('aria-controls');}
  else{preview.setAttribute('aria-expanded','false');preview.setAttribute('aria-controls',content.id);}
  uiAttr(preview,'aria-label',m(expanded?config.collapse:config.read)+view.row[1]);
  uiAttr(preview,'aria-description',m(expanded?config.collapseHelp:config.readHelp));
}
function setChartDescriptionExpanded(view,expanded,animate=true){
  if(!view?.preview.isConnected||expanded&&!view.overflow)return false;
  const {preview,content}=view,wasFloating=preview.classList.contains('is-floating');
  const currentHeight=preview.getBoundingClientRect().height||preview.clientHeight||view.cut+3;
  const geometry=expanded&&!wasFloating?chartDescriptionGeometry(view):{from:currentHeight,target:Number.parseFloat(preview.style.getPropertyValue('--description-expanded-height'))||content.scrollHeight};
  cancelChartDescriptionMotion(view);view.expanded=expanded;
  if(expanded){
    if(!wasFloating)prepareChartDescriptionGeometry(view,geometry);
    preview.classList.remove('is-collapsing');preview.classList.add('is-expanded');
  }else{
    preview.classList.remove('is-expanded');preview.classList.add('is-collapsing');
  }
  syncChartDescriptionAccessibility(view,expanded);
  if(expanded)chartDescriptionOwner=view;else if(chartDescriptionOwner===view)chartDescriptionOwner=null;
  const from=currentHeight,to=expanded?(Number.parseFloat(preview.style.getPropertyValue('--description-expanded-height'))||geometry.target):view.cut+3;
  const settle=()=>{preview.style.height='';preview.style.willChange='';if(!view.expanded){releaseChartDescriptionGeometry(view);scheduleChartDescriptions();}};
  if(!animate||!motionAllowed()||!from||!to||Math.abs(from-to)<1){settle();return true;}
  preview.style.willChange='height';
  const motion=playMotion(preview,[{height:from+'px'},{height:to+'px'}],{duration:expanded?MOTION_MS.panel:MOTION_MS.standard,easing:expanded?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)',fill:'both'});view.motion=motion;
  playMotion(content,expanded?[{opacity:.5,transform:'translateY(-2px)'},{opacity:1,transform:'translateY(0)'}]:[{opacity:1,transform:'translateY(0)'},{opacity:.58,transform:'translateY(-2px)'}],{duration:expanded?MOTION_MS.panel:MOTION_MS.feedback,easing:expanded?'cubic-bezier(.16,1,.3,1)':'cubic-bezier(.4,0,1,1)'});
  const finish=()=>{if(view.motion!==motion)return;view.motion=null;settle();};
  if(motion)motion.finished.then(finish,()=>{});else finish();
  return true;
}
function refreshChartDescriptions(){
  const measured=[];
  for(const [preview,view] of chartDescriptionViews){
    if(!preview.isConnected){
      cancelChartDescriptionMotion(view);releaseChartDescriptionGeometry(view);if(chartDescriptionOwner===view)chartDescriptionOwner=null;
      chartDescriptionObserver?.unobserve(preview);chartDescriptionViews.delete(preview);continue;
    }
    if(view.expanded||preview.classList.contains('is-floating'))continue;
    const content=view.content,line=parseFloat(getComputedStyle(content).lineHeight)||22.1,budget=line*view.config.budgetLines;
    const overflow=preview.clientWidth>0&&content.scrollHeight>budget+1;
    let cut=line*view.config.previewLines;
    if(overflow&&typeof document.createRange==='function'){
      // Clip through actual lettering, not an empty paragraph line; all reads precede writes.
      const top=content.getBoundingClientRect().top,range=document.createRange();range.selectNodeContents(content);
      let last=null;
      for(const rect of range.getClientRects())if(rect.width>0&&rect.top>=top-.5&&rect.bottom<=top+budget+.5&&(!last||rect.top>last.top))last=rect;
      if(last)cut=Math.max(line*.5,Math.min(budget-.5,last.top-top+last.height/2));
    }
    measured.push({view,overflow,cut});
  }
  for(const {view,overflow,cut} of measured){
    const {preview,content}=view;view.overflow=overflow;view.cut=cut;
    preview.classList.toggle('has-overflow',overflow);content.inert=overflow;preview.tabIndex=overflow?0:-1;
    if(overflow||view.config.shortRole)preview.setAttribute('role',overflow?'button':view.config.shortRole);else preview.removeAttribute('role');
    if(overflow||view.config.shortRole)uiAttr(preview,'aria-label',overflow?m(view.config.read)+view.row[1]:m(view.config.label));else{uiAttr(preview,'aria-label','');preview.removeAttribute('aria-label');}
    if(overflow){
      preview.style.setProperty('--description-preview-height',cut+'px');
      preview.setAttribute('aria-expanded','false');preview.setAttribute('aria-controls',content.id);
      uiAttr(preview,'aria-description',m(view.config.readHelp));
    }else{
      preview.style.removeProperty('--description-preview-height');
      preview.removeAttribute('aria-expanded');preview.removeAttribute('aria-controls');
      uiAttr(preview,'aria-description','');
      if(view.expanded)setChartDescriptionExpanded(view,false,false);
      content.inert=false;
    }
  }
}
function scheduleChartDescriptions(){
  if(chartDescriptionFrame)return;
  chartDescriptionFrame=requestAnimationFrame(()=>{chartDescriptionFrame=0;refreshChartDescriptions();});
}
function dismissChartDescription(restoreFocus=false,animate=true){
  const owner=chartDescriptionOwner;if(owner)setChartDescriptionExpanded(owner,false,animate);
  if(restoreFocus&&owner?.preview.isConnected)owner.preview.focus({preventScroll:true});
  return Boolean(owner);
}
function showChartDescription(view,input='mouse'){
  if(!view?.overflow||!view.preview.isConnected||!view.card||!hostVisible||document.hidden||appExiting||phase!=='ready')return false;
  if($('tag-picker').matches(':popover-open')||$('selected-tag-popover').matches(':popover-open'))return false;
  view.input=input;if(chartDescriptionOwner===view)return setChartDescriptionExpanded(view,false);
  if(chartDescriptionOwner)dismissChartDescription(false,chartDescriptionOwner.card!==view.card);
  closeTemporaryReviews(reviewPopoverOwner,false,false);dismissChartTags();
  return setChartDescriptionExpanded(view,true);
}
function bindChartDescription(row,preview,content,kind='description'){
  const config=CHART_DISCLOSURE_CONFIG[kind]||CHART_DISCLOSURE_CONFIG.description,view={row,preview,content,config,card:null,notes:preview.parentElement,overflow:false,expanded:false,cut:0,input:'mouse',motion:null};chartDescriptionViews.set(preview,view);
  content.id=config.idPrefix+row[0];preview.tabIndex=-1;if(config.shortRole){preview.setAttribute('role',config.shortRole);uiAttr(preview,'aria-label',m(config.label));}content.inert=false;
  preview.addEventListener('pointerdown',event=>{view.pointerType=event.pointerType;});
  preview.addEventListener('click',event=>{
    if(!view.overflow)return;if(view.expanded&&event.target.closest?.('a'))return;
    const selection=globalThis.getSelection?.();if(view.expanded&&selection&&!selection.isCollapsed&&preview.contains(selection.anchorNode))return;
    event.preventDefault();showChartDescription(view,event.detail===0?'keyboard':view.pointerType||'mouse');
  });
  preview.addEventListener('keydown',event=>{if(event.target===preview&&view.overflow&&['Enter',' '].includes(event.key)){event.preventDefault();showChartDescription(view,'keyboard');}});
  preview.addEventListener('pointerleave',event=>{if(view.expanded&&event.pointerType!=='touch'&&!preview.contains(event.relatedTarget))setChartDescriptionExpanded(view,false);});
  preview.addEventListener('wheel',event=>{
    if(!view.expanded||event.ctrlKey)return;event.preventDefault();event.stopPropagation();
    const scale=event.deltaMode===1?20:event.deltaMode===2?Math.max(1,content.clientHeight):1;
    content.scrollTop+=event.deltaY*scale;
  },{passive:false});
  if(typeof ResizeObserver==='function'){
    if(!chartDescriptionObserver)chartDescriptionObserver=new ResizeObserver(scheduleChartDescriptions);
    chartDescriptionObserver.observe(preview);
  }
  if(!chartDescriptionControlsReady){
    chartDescriptionControlsReady=true;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&chartDescriptionOwner){event.preventDefault();dismissChartDescription(true);}});
    globalThis.addEventListener?.('resize',()=>{dismissChartDescription(false,false);scheduleChartDescriptions();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)dismissChartDescription(false,false);});
    document.fonts?.ready?.then(scheduleChartDescriptions);
  }
  scheduleChartDescriptions();return view;
}
function bindChartDescriptionCard(card){
  for(const preview of card.querySelectorAll('.chart-disclosure')){const view=chartDescriptionViews.get(preview);if(view){view.card=card;view.notes=preview.parentElement;}}
}
let chartTagsPopover=null,chartTagsOwner=null,chartTagsTimer=null,chartTagsFrame=0,chartTagsIgnoreFocus=false;
function chartTagsOverflow(strip){return strip.clientWidth>0&&strip.scrollWidth>strip.clientWidth+1;}
function makeChartTagButton(tag,chartId){
  const button=element('button',tag,'chart-tag-button');button.type='button';button.dataset.chartTag=tag;button.dataset.chartId=String(chartId);
  button.addEventListener('click',()=>addTagFilter(tag,button));return button;
}
function refreshChartTagButtons(){
  for(const button of document.querySelectorAll('.chart-tag-button')){
    const selected=selectedTags.has(tagKey(button.dataset.chartTag));button.setAttribute('aria-pressed',String(selected));
    uiAttr(button,'aria-label',m(selected?'Tag already selected: ':'Filter by tag: ')+button.dataset.chartTag);
  }
  for(const strip of document.querySelectorAll('.chart-tags')){
    const overflow=chartTagsOverflow(strip);strip.tabIndex=overflow?0:-1;strip.classList.toggle('has-overflow',overflow);
    if(overflow){strip.setAttribute('aria-haspopup','dialog');strip.setAttribute('aria-controls','chart-tags-popover');uiAttr(strip,'aria-description',m('Hover, focus, or tap to show all tags.'));}
    else{strip.removeAttribute('aria-haspopup');strip.removeAttribute('aria-controls');uiAttr(strip,'aria-description','');}
    for(const button of strip.children)button.tabIndex=overflow?-1:0;
  }
  if(chartTagsOwner){if(!chartTagsOwner.isConnected||!chartTagsOverflow(chartTagsOwner))dismissChartTags();else positionChartTags();}
}
function scheduleChartTagsRefresh(){
  if(chartTagsFrame)return;
  chartTagsFrame=requestAnimationFrame(()=>{chartTagsFrame=0;refreshChartTagButtons();});
}
function dismissChartTags(){
  clearTimeout(chartTagsTimer);chartTagsTimer=null;
  const owner=chartTagsOwner;chartTagsOwner=null;owner?.classList.remove('is-open');
  if(chartTagsPopover?.matches(':popover-open'))chartTagsPopover.hidePopover();
  if(chartTagsPopover&&chartTagsPopover.parentElement!==document.body)document.body.append(chartTagsPopover);
  return Boolean(owner);
}
function leaveChartTags(){
  clearTimeout(chartTagsTimer);chartTagsTimer=setTimeout(()=>{
    chartTagsTimer=null;const owner=chartTagsOwner,panel=chartTagsPopover,focused=document.activeElement;
    if(!owner)return;
    const keyboardFocused=document.documentElement.dataset.inputModality==='keyboard'&&focused?.matches(':focus-visible');
    if(owner.matches(':hover')||panel.matches(':hover')||keyboardFocused&&(owner.contains(focused)||panel.contains(focused)))return;
    dismissChartTags();
  },160);
}
function positionChartTags(){
  const strip=chartTagsOwner,panel=chartTagsPopover;if(!strip||!panel?.matches(':popover-open'))return;
  if(!strip.isConnected){dismissChartTags();return;}
  const scrollTop=panel.scrollTop;
  const anchor=strip.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,edge=12,gap=6;
  const ceiling=Math.max(edge,(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+gap);
  if(anchor.bottom<=ceiling||anchor.top>=height-edge){dismissChartTags();return;}
  panel.style.width=`${Math.min(Math.max(anchor.width,280),440,Math.max(1,width-edge*2))}px`;
  panel.style.maxHeight=`${Math.max(1,height-ceiling-edge)}px`;
  let box=panel.getBoundingClientRect();
  const below=height-edge-anchor.bottom-gap,above=anchor.top-gap-ceiling,down=below>=box.height||below>=above;
  panel.style.maxHeight=`${Math.max(1,down?below:above)}px`;box=panel.getBoundingClientRect();
  panel.style.left=`${Math.max(edge,Math.min(anchor.left,width-edge-box.width))}px`;
  panel.style.top=`${Math.max(ceiling,Math.min(down?anchor.bottom+gap:anchor.top-gap-box.height,height-edge-box.height))}px`;
  panel.scrollTop=scrollTop;
}
function ensureChartTagsPopover(){
  if(chartTagsPopover)return chartTagsPopover;
  const panel=element('div',undefined,'close-help chart-tags-popover');chartTagsPopover=panel;
  panel.id='chart-tags-popover';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.tabIndex=-1;uiAttr(panel,'aria-label',m('Chart tags'));document.body.append(panel);
  panel.addEventListener('pointerenter',()=>{clearTimeout(chartTagsTimer);chartTagsTimer=null;});
  panel.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')leaveChartTags();});
  panel.addEventListener('focusout',leaveChartTags);
  panel.addEventListener('beforetoggle',event=>{
    if(event.newState!=='closed')return;
    // Closing can restore focus to the strip before the native toggle finishes.
    chartTagsIgnoreFocus=true;queueMicrotask(()=>{chartTagsIgnoreFocus=false;});
    clearTimeout(chartTagsTimer);chartTagsTimer=null;chartTagsOwner?.classList.remove('is-open');chartTagsOwner=null;
  });
  panel.addEventListener('toggle',event=>{if(event.newState==='closed'&&!panel.matches(':popover-open')&&panel.parentElement!==document.body)document.body.append(panel);});
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!chartTagsOwner)return;
    const owner=chartTagsOwner,restore=panel.contains(document.activeElement);chartTagsIgnoreFocus=true;dismissChartTags();
    if(restore&&owner.isConnected)owner.focus({preventScroll:true});chartTagsIgnoreFocus=false;event.preventDefault();event.stopPropagation();
  },true);
  globalThis.addEventListener?.('resize',scheduleChartTagsRefresh);
  globalThis.addEventListener?.('scroll',event=>{if(!chartTagsPopover?.contains(event.target))positionChartTags();},{capture:true,passive:true});
  globalThis.addEventListener?.('blur',dismissChartTags);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)dismissChartTags();});
  if(typeof ResizeObserver==='function')new ResizeObserver(positionChartTags).observe(panel);
  document.fonts?.ready?.then(scheduleChartTagsRefresh);return panel;
}
function showChartTags(strip){
  if($('tag-picker').matches(':popover-open')||$('selected-tag-popover').matches(':popover-open'))return false;
  clearTimeout(chartTagsTimer);chartTagsTimer=null;
  if(!strip.isConnected||!hostVisible||document.hidden||!chartTagsOverflow(strip))return false;
  dismissChartDescription(false,false);
  const panel=ensureChartTagsPopover();
  if(chartTagsOwner!==strip){
    dismissChartTags();chartTagsOwner=strip;strip.classList.add('is-open');strip.after(panel);
    panel.replaceChildren(...[...strip.children].map(button=>makeChartTagButton(button.dataset.chartTag,button.dataset.chartId)));
    panel.showPopover();refreshChartTagButtons();
  }
  positionChartTags();return chartTagsOwner===strip;
}
