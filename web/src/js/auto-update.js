let autoUpdateBusy=false;
function syncAutoUpdateToggle(enabled){
  const box=$('settings-auto-update');
  if(box)box.checked=enabled===true;
  box.disabled=autoUpdateBusy;
}
function readAutoUpdateFromBootstrap(){
  if(APP_CONFIG&&typeof APP_CONFIG.autoUpdateCharts==='boolean')syncAutoUpdateToggle(APP_CONFIG.autoUpdateCharts);
}
async function setAutoUpdate(enabled){
  if(autoUpdateBusy)return;
  autoUpdateBusy=true;syncAutoUpdateToggle(enabled);
  try{
    const result=await installerRequest('POST','/v1/auto-update',{enabled});
    if(result&&typeof result.autoUpdateCharts==='boolean'){
      APP_CONFIG.autoUpdateCharts=result.autoUpdateCharts;
      syncAutoUpdateToggle(result.autoUpdateCharts);
    }
  }catch(error){syncAutoUpdateToggle(!enabled);}
  autoUpdateBusy=false;syncAutoUpdateToggle(APP_CONFIG.autoUpdateCharts);
}
function setupAutoUpdate(){
  readAutoUpdateFromBootstrap();
  $('settings-auto-update').addEventListener('change',event=>setAutoUpdate(event.target.checked));
}
