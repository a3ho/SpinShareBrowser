// APP_CONFIG is frozen at bootstrap; keep this feature's mutable state module-local.
let autoUpdateBusy=false,autoUpdateEnabled=false;
function syncAutoUpdateToggle(enabled){
  const box=$('settings-auto-update');
  if(box)box.checked=enabled===true;
}
function readAutoUpdateFromBootstrap(){
  if(APP_CONFIG&&typeof APP_CONFIG.autoUpdateCharts==='boolean'){
    autoUpdateEnabled=APP_CONFIG.autoUpdateCharts;
    syncAutoUpdateToggle(autoUpdateEnabled);
  }
}
async function setAutoUpdate(enabled){
  if(autoUpdateBusy)return;
  autoUpdateBusy=true;
  const box=$('settings-auto-update');
  box.disabled=true;
  try{
    const result=await installerRequest('POST','/v1/auto-update',{enabled});
    if(result&&typeof result.autoUpdateCharts==='boolean')autoUpdateEnabled=result.autoUpdateCharts;
  }catch(error){/* keep the last confirmed value */}
  syncAutoUpdateToggle(autoUpdateEnabled);
  autoUpdateBusy=false;
  box.disabled=false;
}
// Help popover: same hover pattern as the close-behavior and catalog helps —
// anchored beside its button, never the bare showPopover() that parked the
// panel in the window's top-left corner.
function positionAutoUpdateHelp(){
  const button=$('settings-auto-update-help'),panel=$('settings-auto-update-help-panel');
  if(!button||!panel?.matches?.(':popover-open'))return;
  const anchor=button.getBoundingClientRect(),width=document.documentElement.clientWidth,height=document.documentElement.clientHeight,edge=12,gap=8;
  const box=panel.getBoundingClientRect(),left=Math.max(edge,Math.min(anchor.right+gap,width-edge-box.width));
  const below=height-anchor.bottom-edge-gap,top=below>=box.height?anchor.bottom+gap:Math.max(edge,anchor.top-gap-box.height);
  panel.style.left=left+'px';panel.style.top=top+'px';
}
function setAutoUpdateHelp(visible){
  clearHelpPopoverTimer('settings-auto-update-help');
  const button=$('settings-auto-update-help'),panel=$('settings-auto-update-help-panel');
  if(!button||!panel)return;
  if(visible&&(button.hidden||button.disabled||!hostVisible||document.hidden))return;
  const open=panel.matches?.(':popover-open');button.classList.toggle('is-active',visible);
  if(!visible){if(open)panel.hidePopover();return;}
  if(typeof setCatalogHelp==='function')setCatalogHelp(false);
  if(typeof setCloseHelp==='function')for(const id of closeHelpIds)setCloseHelp(id,false);
  if(!open)panel.showPopover();positionAutoUpdateHelp();
}
function setupAutoUpdate(){
  readAutoUpdateFromBootstrap();
  $('settings-auto-update').addEventListener('change',event=>setAutoUpdate(event.target.checked));
  const help=$('settings-auto-update-help'),panel=$('settings-auto-update-help-panel');
  if(help&&panel){
    setupHoverHelp('settings-auto-update-help',setAutoUpdateHelp,{preventClick:true});
    panel.addEventListener('toggle',()=>{const visible=panel.matches(':popover-open');help.classList.toggle('is-active',visible);if(visible)positionAutoUpdateHelp();});
    globalThis.addEventListener?.('resize',positionAutoUpdateHelp);globalThis.addEventListener?.('scroll',positionAutoUpdateHelp,true);
    if(typeof ResizeObserver==='function')new ResizeObserver(positionAutoUpdateHelp).observe(panel);
  }
}
