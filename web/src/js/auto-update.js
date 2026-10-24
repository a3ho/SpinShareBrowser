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
function setupAutoUpdate(){
  readAutoUpdateFromBootstrap();
  $('settings-auto-update').addEventListener('change',event=>setAutoUpdate(event.target.checked));
  const help=$('settings-auto-update-help'),panel=$('settings-auto-update-help-panel');
  if(help&&panel){
    help.addEventListener('click',()=>{panel.matches(':popover-open')?panel.hidePopover():panel.showPopover();});
    document.addEventListener('pointerdown',e=>{
      if(panel.matches(':popover-open')&&!panel.contains(e.target)&&!help.contains(e.target))panel.hidePopover();
    },true);
  }
}
