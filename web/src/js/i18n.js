// Translate app tokens, leaving user text and existing card nodes untouched.
function m(key){const index=UI_KEY_INDEX.get(key);if(index===undefined)throw new Error('Missing UI catalog key: '+key);return UI_PREFIX+'text:'+index+UI_END;}
function renderUI(value,language=uiLanguage){return String(value??'').replace(UI_PATTERN,(_,kind,data)=>kind==='text'?UI_CATALOG[language][UI_KEYS[Number(data)]]:Number(data).toLocaleString(language));}
function uiText(node,value){
  const text=String(value??''),binding=uiBindings.get(node)||{attributes:new Map()};
  if(text.includes(UI_PREFIX)){binding.text=text;uiBindings.set(node,binding);node.setAttribute('data-ui-text','');}else{delete binding.text;node.removeAttribute('data-ui-text');}
  node.textContent=renderUI(text);return node;
}
function uiAttr(node,name,value){
  const text=String(value??''),binding=uiBindings.get(node)||{attributes:new Map()};
  if(text.includes(UI_PREFIX)){binding.attributes.set(name,text);uiBindings.set(node,binding);node.setAttribute('data-ui-attributes','');}else binding.attributes.delete(name);
  node.setAttribute(name,renderUI(text));return node;
}
function uiError(value){const error=new Error(renderUI(value,'en'));error.uiMessage=String(value);return error;}
function errorText(error){return typeof error?.uiMessage==='string'?error.uiMessage:typeof error?.message==='string'?error.message:String(error);}
function setUILanguage(language){
  if(!['zh-CN','en'].includes(language))return;
  uiLanguage=language;document.documentElement.lang=language;
  for(const node of document.querySelectorAll('[data-ui-text],[data-ui-attributes]')){const binding=uiBindings.get(node);if(!binding)continue;if(binding.text!==undefined)node.textContent=renderUI(binding.text);for(const [name,value] of binding.attributes)node.setAttribute(name,renderUI(value));}
  for(const id of ['ui-language','settings-language'])$(id).value=language;
  if(typeof syncChoiceMenus==='function')syncChoiceMenus(true);syncTagControls();scheduleChartTagsRefresh();scheduleChartDescriptions();syncCatalogRefresh();renderDateCalendar();if(typeof syncPreviewInterface==='function')syncPreviewInterface();
}
async function saveLanguage(language=uiLanguage){
  if(languageBusy||appExiting)return;
  if(!['zh-CN','en'].includes(language))return;
  setUILanguage(language);for(const prefix of ['language','settings-language'])$(prefix+'-feedback').hidden=true;
  languageBusy=true;for(const id of ['ui-language','settings-language','language-retry','settings-language-retry'])$(id).disabled=true;
  languageFeedback(m('Saving...'),false,true);let saved=false;
  try{const result=await installerRequest('POST','/v1/language',{language});if(result?.language!==language)throw uiError(m('The language could not be saved. Please retry.'));saved=true;}
  catch(error){languageFeedback(m('Could not save the language. Please retry.')+'\n'+errorText(error),true);}
  finally{languageBusy=false;for(const id of ['ui-language','settings-language','language-retry','settings-language-retry'])$(id).disabled=appExiting;for(const prefix of ['language','settings-language']){loadingIndicator($(prefix+'-message'),false);if(saved)$(prefix+'-feedback').hidden=true;}}
}
function languageFeedback(message,retry=false,loading=false){for(const prefix of ['language','settings-language']){uiText($(prefix+'-message'),message);loadingIndicator($(prefix+'-message'),loading);$(prefix+'-feedback').hidden=false;$(prefix+'-retry').hidden=!retry;}}
function setupLanguage(){
  for(const node of document.querySelectorAll('[data-ui-static]'))uiText(node,m(node.getAttribute('data-ui-static')));
  for(const name of ['aria-label','alt','placeholder'])for(const node of document.querySelectorAll('[data-ui-attr-'+name+']'))uiAttr(node,name,m(node.getAttribute('data-ui-attr-'+name)));
  setUILanguage(APP_CONFIG.language);
  for(const id of ['ui-language','settings-language'])$(id).addEventListener('change',event=>saveLanguage(event.target.value));
  for(const id of ['language-retry','settings-language-retry'])$(id).addEventListener('click',()=>saveLanguage());
}
