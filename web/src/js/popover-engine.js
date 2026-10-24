// Unified popover positioning engine (P8: measure after show, all popovers share this).
// Usage: const engine = createPopoverEngine({ popover, getAnchor, onDismiss });
// engine.open(); engine.close(); engine.reposition();
function createPopoverEngine(options){
  const{popover,getAnchor,onDismiss,gap=8,edge=12}=options;
  let frame=null,visible=false;
  function reposition(){
    if(!visible)return;
    // Zero-viewport guard only: hidden pages still report real geometry, and
    // the first synchronous positioning must run even in a background window —
    // a document.hidden bail here left popovers at their CSS default spot
    // (the "popover opens in the wrong place" bug).
    if(!innerHeight||!document.documentElement.clientHeight)return;
    const anchor=getAnchor();
    if(!anchor||!anchor.isConnected){dismiss();return;}
    const bar=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top'))||64)+8;
    const rect=anchor.getBoundingClientRect();
    // Topbar anchors (bell, account chip) legitimately live above the content
    // top; only a truly off-screen anchor dismisses.
    if(rect.bottom<0||rect.top>innerHeight){dismiss();return;}
    // Force layout so offsetWidth is valid after showPopover().
    void popover.offsetWidth;
    const width=popover.offsetWidth,height=popover.offsetHeight;
    if(!width||!height)return;
    const left=Math.max(edge,Math.min(rect.left,innerWidth-width-edge));
    const below=rect.bottom+gap+height<=innerHeight-edge;
    // Neutralize the UA popover sheet ([popover]:popover-open { inset:0; margin:auto }):
    // without this, auto margins re-center the box between our top and the
    // viewport bottom, opening the popover far from its anchor.
    popover.style.right='auto';
    popover.style.bottom='auto';
    popover.style.margin='0';
    popover.style.left=left+'px';
    popover.style.top=(below?rect.bottom+gap:Math.max(bar,rect.top-height-gap))+'px';
    const originX=Math.max(16,Math.min(width-16,rect.left+rect.width/2-left));
    popover.style.transformOrigin=originX+'px '+(below?'top':'bottom');
  }
  function scheduleFrame(){
    if(frame!==null)return;
    const step=()=>{
      frame=null;
      reposition();
      if(visible)frame=requestAnimationFrame(step);
    };
    frame=requestAnimationFrame(step);
  }
  function show(){
    if(visible)return;
    visible=true;
    popover.showPopover();
    reposition();
    scheduleFrame();
  }
  function dismiss(){
    if(frame!==null){cancelAnimationFrame(frame);frame=null;}
    if(!visible)return;
    visible=false;
    if(typeof popover.matches==='function'&&popover.matches(':popover-open')&&typeof popover.hidePopover==='function')popover.hidePopover();
    onDismiss?.();
  }
  return{open:show,close:dismiss,reposition,isOpen:()=>visible};
}
