let uploadBusy=false,uploadChosenPath='';
function openUploadDialog(){
  if(!sessionConnected())return;
  $('upload-dialog').showModal();
  uiText($('upload-file'),uploadChosenPath?uploadChosenPath:m('No file chosen'));
  $('upload-note').hidden=true;
  $('upload-submit').disabled=!uploadChosenPath||uploadBusy;
  void loadUploadOptions();
}
function closeUploadDialog(){$('upload-dialog').close();}
async function loadUploadOptions(){
  try{
    const options=await installerRequest('GET','/v1/upload/options');
    if(!options||typeof options!=='object')return;
    fillUploadSelect('upload-dlc',options.dlc,0);
    fillUploadSelect('upload-publication',options.publication,0);
  }catch(error){/* keep the previous options; defaults below */}
}
function fillUploadSelect(id,entries,fallbackValue){
  const select=$(id);
  if(!select||!Array.isArray(entries)||!entries.length)return;
  select.replaceChildren();
  for(const entry of entries){
    const option=element('option',entry.label);
    option.value=String(entry.value);
    select.append(option);
  }
  select.value=String(fallbackValue);
  if(typeof syncChoiceMenus==='function')syncChoiceMenus(id);
}
async function pickUploadFile(){
  if(uploadBusy)return;
  try{
    const result=await installerRequest('POST','/v1/upload/pick',{});
    if(result&&typeof result.path==='string'){
      uploadChosenPath=result.path;
      uiText($('upload-file'),uploadChosenPath);
      $('upload-submit').disabled=false;
      $('upload-note').hidden=true;
    }
  }catch(error){
    uiText($('upload-note'),errorText(error));$('upload-note').hidden=false;$('upload-note').classList.add('is-error');
  }
}
async function submitUpload(){
  if(uploadBusy||!uploadChosenPath)return;
  uploadBusy=true;
  const submit=$('upload-submit');submit.disabled=true;
  uiText($('upload-note'),m('Uploading…'));$('upload-note').hidden=false;$('upload-note').classList.remove('is-error');
  try{
    const result=await installerRequest('POST','/v1/upload/start',{
      backupPath:uploadChosenPath,
      description:$('upload-description').value,
      tags:$('upload-tags').value,
      dlc:Number($('upload-dlc').value||0),
      publicationStatus:Number($('upload-publication').value||0),
      isExplicit:$('upload-explicit').checked});
    if(!result||!Number.isInteger(result.songId))throw uiError(m('The chart could not be uploaded'));
    uiText($('upload-note'),m('Chart uploaded'));$('upload-note').classList.remove('is-error');
    uploadChosenPath='';uiText($('upload-file'),m('No file chosen'));
    $('upload-description').value='';$('upload-tags').value='';$('upload-explicit').checked=false;
    $('upload-submit').disabled=true;
    myReviewsCache=null;
  }catch(error){
    uiText($('upload-note'),errorText(error));$('upload-note').classList.add('is-error');
    $('upload-submit').disabled=false;
  }
  uploadBusy=false;
}
function setupUpload(){
  $('upload-close').addEventListener('click',closeUploadDialog);
  $('upload-dialog').addEventListener('cancel',event=>{event.preventDefault();closeUploadDialog();});
  $('upload-pick').addEventListener('click',()=>pickUploadFile());
  $('upload-submit').addEventListener('click',()=>submitUpload());
}
