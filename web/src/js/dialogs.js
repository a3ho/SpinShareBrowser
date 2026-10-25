function openDialogPanel(panel){
  if(panel.open&&!panel.inert)return;
  const current=panel.open?globalThis.getComputedStyle?.(panel):null;
  const from={opacity:panel.open?(current?.opacity||'1'):0,transform:panel.open?(current?.transform||'none'):'translateY(6px)'};
  const previous=dialogMotions.get(panel);dialogMotions.delete(panel);previous?.cancel();
  panel.inert=false;panel.classList.remove('dialog-closing');if(!panel.open)panel.showModal();else panel.querySelector('.settings-close')?.focus({preventScroll:true});
  const animation=playMotion(panel,[from,{opacity:1,transform:'none'}],{duration:MOTION_MS.feedback,easing:'cubic-bezier(.2,.7,.2,1)'});
  if(animation){dialogMotions.set(panel,animation);const done=()=>{if(dialogMotions.get(panel)===animation)dialogMotions.delete(panel);};animation.finished.then(done,done);}
}
function closeDialogPanel(panel,onClosed){
  if(!panel.open){onClosed?.();return;}
  if(panel.inert)return;
  const current=globalThis.getComputedStyle?.(panel),from={opacity:current?.opacity||'1',transform:current?.transform||'none'};
  const previous=dialogMotions.get(panel);dialogMotions.delete(panel);previous?.cancel();
  panel.inert=true;panel.classList.add('dialog-closing');
  const animation=playMotion(panel,[from,{opacity:0,transform:'translateY(4px)'}],{duration:MOTION_MS.feedback,easing:'ease-out'});
  const done=()=>{if(animation&&dialogMotions.get(panel)!==animation)return;dialogMotions.delete(panel);panel.close();panel.inert=false;panel.classList.remove('dialog-closing');onClosed?.();};
  if(animation){dialogMotions.set(panel,animation);animation.finished.then(done,done);}else done();
}
function refreshCloseHelpTasks(){
  const active=hasActiveInstallations()||Boolean(appDialogState?.activeCount>0);
  for(const note of document.querySelectorAll('.close-help-task'))note.hidden=!active;
}
const closeHelpIds=['settings-close-help','app-dialog-help'],helpPopoverTimers=new Map();
function clearHelpPopoverTimer(id){const timer=helpPopoverTimers.get(id);if(timer!==undefined)clearTimeout(timer);helpPopoverTimers.delete(id);}
function setupHoverHelp(id,setVisible,{preventClick=false}={}){
  const button=$(id),panel=$(id+'-panel'),show=()=>{clearHelpPopoverTimer(id);setVisible(true);};
  const keyboardFocused=()=>document.documentElement.dataset.inputModality==='keyboard'&&button.matches(':focus-visible');
  const leave=()=>{clearHelpPopoverTimer(id);helpPopoverTimers.set(id,setTimeout(()=>{helpPopoverTimers.delete(id);if(!button.matches(':hover')&&!keyboardFocused()&&!panel.matches(':hover'))setVisible(false);},100));};
  button.addEventListener('pointerenter',show);panel.addEventListener('pointerenter',show);
  button.addEventListener('pointerleave',leave);panel.addEventListener('pointerleave',leave);
  button.addEventListener('focus',()=>{if(keyboardFocused())show();});button.addEventListener('blur',leave);
  if(preventClick)button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
}
function positionCloseHelp(id){
  const button=$(id),panel=$(id+'-panel');if(!panel.matches(':popover-open'))return;
  const anchor=button.getBoundingClientRect(),owner=$(id==='settings-close-help'?'settings-panel':'app-dialog').getBoundingClientRect();
  const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,gap=8,edge=12;
  if(anchor.bottom<=Math.max(edge,owner.top)||anchor.top>=Math.min(height-edge,owner.bottom)){setCloseHelp(id,false);return;}
  panel.style.maxHeight=`${height-edge*2}px`;let box=panel.getBoundingClientRect(),left,top;
  if(id==='app-dialog-help'){
    const room=Math.max(1,anchor.top-gap-edge);panel.style.maxHeight=`${room}px`;box=panel.getBoundingClientRect();
    left=anchor.right-box.width;top=anchor.top-gap-box.height;
    panel.style.left=`${Math.max(edge,Math.min(left,width-edge-box.width))}px`;
    panel.style.top=`${Math.max(edge,top)}px`;return;
  }
  left=anchor.right+gap;top=anchor.top-6;
  if(left+box.width>width-edge)left=anchor.left-gap-box.width;
  if(left<edge){
    left=Math.max(edge,Math.min(anchor.left,width-edge-box.width));
    const below=height-edge-anchor.bottom-gap,above=anchor.top-gap-edge,down=below>=box.height||below>=above;
    panel.style.maxHeight=`${Math.max(1,down?below:above)}px`;box=panel.getBoundingClientRect();
    top=down?anchor.bottom+gap:anchor.top-gap-box.height;
  }
  panel.style.left=`${Math.max(edge,Math.min(left,width-edge-box.width))}px`;
  panel.style.top=`${Math.max(edge,Math.min(top,height-edge-box.height))}px`;
}
function setCloseHelp(id,visible){
  clearHelpPopoverTimer(id);
  const button=$(id),panel=$(id+'-panel'),owner=$(id==='settings-close-help'?'settings-panel':'app-dialog');
  if(visible&&(button.hidden||button.disabled||!owner.open||owner.inert||!hostVisible||document.hidden))return;
  button.classList.toggle('is-active',visible);
  if(!visible){if(panel.matches(':popover-open'))panel.hidePopover();return;}
  setCatalogHelp(false);
  if(typeof setAutoUpdateHelp==='function')setAutoUpdateHelp(false);
  for(const other of closeHelpIds)if(other!==id&&$(other+'-panel').matches(':popover-open'))setCloseHelp(other,false);
  refreshCloseHelpTasks();if(!panel.matches(':popover-open'))panel.showPopover();positionCloseHelp(id);
}
function dismissCloseHelp(panel){
  const button=panel.querySelector('.help-toggle');if(!button||!$(button.id+'-panel').matches(':popover-open'))return false;
  setCloseHelp(button.id,false);return true;
}
function setupCloseHelp(){
  for(const id of closeHelpIds)setupHoverHelp(id,visible=>setCloseHelp(id,visible));
  const reposition=()=>{for(const id of closeHelpIds)positionCloseHelp(id);};
  globalThis.addEventListener?.('resize',reposition);globalThis.addEventListener?.('scroll',reposition,true);
  globalThis.addEventListener?.('blur',()=>{for(const id of closeHelpIds)setCloseHelp(id,false);});
  document.addEventListener('keydown',event=>{if(event.key!=='Escape'||event.defaultPrevented)return;const open=[...closeHelpIds,'refresh-data-help','settings-auto-update-help'].find(helpId=>$(helpId+'-panel')?.matches?.(':popover-open'));if(!open)return;event.preventDefault();event.stopPropagation();open==='refresh-data-help'?setCatalogHelp(false):open==='settings-auto-update-help'?setAutoUpdateHelp(false):setCloseHelp(open,false);$(open).focus({preventScroll:true});});
  if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(reposition);for(const id of closeHelpIds)observer.observe($(id+'-panel'));}
}
