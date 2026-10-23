function setupInputModality(){
  const root=document.documentElement;
  root.dataset.inputModality='keyboard';
  globalThis.addEventListener?.('pointerdown',()=>{root.dataset.inputModality='pointer';},{capture:true,passive:true});
  // Tab is the operation that moves focus through the interface. Other keys
  // (notably Escape and the global Space shortcut) must not resurrect a ring
  // on the last control clicked with the pointer.
  globalThis.addEventListener?.('keydown',event=>{if(event.key==='Tab')root.dataset.inputModality='keyboard';},true);
}
function motionAllowed(){return hostVisible&&!document.hidden&&!motionPreference?.matches;}
function playMotion(node,keyframes,options={}){
  if(!motionAllowed()||typeof node?.animate!=='function')return null;
  const animation=node.animate(keyframes,{duration:MOTION_MS.feedback,easing:'cubic-bezier(.2,.7,.2,1)',...options});
  activeMotions.add(animation);
  animation.finished.then(()=>activeMotions.delete(animation),()=>activeMotions.delete(animation));
  return animation;
}
function syncMotion(){
  document.documentElement.classList.toggle('motion-paused',!motionAllowed());
  if(!motionAllowed())for(const animation of [...activeMotions]){try{animation.finish();}catch{animation.cancel();}}
  if(!hostVisible||document.hidden){dismissCloseHelp($('settings-panel'));dismissCloseHelp($('app-dialog'));if(typeof setCatalogHelp==='function')setCatalogHelp(false);if(typeof pauseCatalogToast==='function')pauseCatalogToast();if(typeof dismissPreviewShortcutHint==='function')dismissPreviewShortcutHint(false);dismissChartDescription(false,false);}
  else{if(typeof resumeCatalogToast==='function')resumeCatalogToast();if(typeof flushCatalogToast==='function')flushCatalogToast();if(typeof maybeRunAutomaticCatalogSync==='function')maybeRunAutomaticCatalogSync();}
}
function rememberEntry(key){
  if(entrySeen.has(key))return false;
  entrySeen.add(key);
  if(entrySeen.size>20000)entrySeen.delete(entrySeen.values().next().value);
  return true;
}
function revealEntry(node,key,kind='card',delay=0){
  if(!rememberEntry(key))return;
  playMotion(node,[{opacity:0,transform:`translateY(${kind==='card'?10:4}px)`},{opacity:1,transform:'translateY(0)'}],{duration:kind==='card'?MOTION_MS.panel:MOTION_MS.standard,delay:Math.min(delay,100),fill:'backwards'});
}
function queueEntry(node,key,kind='card'){
  if(entrySeen.has(key))return;
  if(typeof IntersectionObserver!=='function'||typeof node.animate!=='function'){revealEntry(node,key,kind);return;}
  if(!entryObserver)entryObserver=new IntersectionObserver(entries=>{
    let index=0;
    for(const entry of entries){
      if(!entry.isIntersecting)continue;
      const target=entryTargets.get(entry.target);entryObserver.unobserve(entry.target);entryTargets.delete(entry.target);
      if(target&&entry.target.isConnected)revealEntry(entry.target,target.key,target.kind,index++*20);
    }
  });
  entryTargets.set(node,{key,kind});entryObserver.observe(node);
}
function pruneEntries(){for(const node of entryTargets.keys())if(!node.isConnected){entryObserver?.unobserve(node);entryTargets.delete(node);}}
function setupMotion(){
  document.addEventListener('visibilitychange',syncMotion);
  motionPreference?.addEventListener?.('change',syncMotion);
  syncMotion();
  const panel=$('filter-panel');
  // Keep the large document reflow native and instantaneous. Only the newly
  // revealed controls move, so opening the filter never animates layout.
  panel.addEventListener('toggle',()=>{
    if(panel.open)playMotion($('filters'),[{opacity:.55,transform:'translateY(-4px)'},{opacity:1,transform:'none'}],{duration:MOTION_MS.standard,fill:'backwards'});
  });
}
const number = n => UI_PREFIX+'number:'+n+UI_END;
