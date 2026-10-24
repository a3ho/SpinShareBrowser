let autoUpdateBusy=false;
function syncAutoUpdateToggle(enabled){
  const box=$('settings-auto-update');
  if(box)box.checked=enabled===true;
}
function readAutoUpdateFromBootstrap(){
  if(APP_CONFIG&&typeof APP_CONFIG.autoUpdateCharts==='boolean')syncAutoUpdateToggle(APP_CONFIG.autoUpdateCharts);
}
async function setAutoUpdate(enabled){
  if(autoUpdateBusy)return;
  autoUpdateBusy=true;
  const box=$('settings-auto-update');
  box.disabled=true;
  try{
    const result=await installerRequest('POST','/v1/auto-update',{enabled});
    if(result&&typeof result.autoUpdateCharts==='boolean'){
      APP_CONFIG.autoUpdateCharts=result.autoUpdateCharts;
    }
  }catch(error){
    syncAutoUpdateToggle(APP_CONFIG.autoUpdateCharts);
  }
  syncAutoUpdateToggle(APP_CONFIG.autoUpdateCharts);
  autoUpdateBusy=false;
  box.disabled=false;
}
function setupAutoUpdate(){
  readAutoUpdateFromBootstrap();
  // Single trigger: only the checkbox's native change event (P4).
  $('settings-auto-update').addEventListener('change',event=>setAutoUpdate(event.target.checked));
  // Help tooltip for the switch (matches the "close behavior" help pattern).
  const help=$('settings-auto-update-help'),panel=$('settings-auto-update-help-panel');
  if(help&&panel){
    help.addEventListener('click',()=>{
      if(panel.matches(':popover-open'))panel.hidePopover();
      else panel.showPopover();
    });
    document.addEventListener('pointerdown',event=>{
      if(panel.matches(':popover-open')&&!panel.contains(event.target)&&!help.contains(event.target))panel.hidePopover();
    },true);
  }
}
