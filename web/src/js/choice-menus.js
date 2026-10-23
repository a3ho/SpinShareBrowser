function element(tag,text,className){const el=document.createElement(tag);if(text!==undefined)uiText(el,text);if(className)el.className=className;return el;}
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS('http://www.w3.org/2000/svg','use');svg.setAttribute('class','icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');use.setAttribute('href','#icon-'+name);svg.append(use);return svg;}
const choiceMenus=new Map();
let choiceMenuFrame=null;
function choiceSelectOptions(select){return Array.from(select.options||select.querySelectorAll('option'));}
function choiceSelectedOption(select){return choiceSelectOptions(select).find(option=>option.value===select.value)||choiceSelectOptions(select)[0]||null;}
function choiceLabel(select){
  const ids=(select.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean),text=ids.map(id=>$(id)?.textContent?.trim()).filter(Boolean).join(' ');
  return text||select.getAttribute('aria-label')||'';
}
function choiceMenuHost(select){
  for(let node=select.parentNode;node;node=node.parentNode)if(node.matches?.('dialog,[popover]'))return node;
  return document.body;
}
function renderChoiceMenu(view){
  const {select,menu}=view,selected=choiceSelectedOption(select);menu.replaceChildren();
  for(const option of choiceSelectOptions(select)){
    const button=element('button',undefined,'choice-option');button.type='button';button.setAttribute('role','option');button.dataset.value=option.value;
    button.disabled=option.disabled;button.setAttribute('aria-selected',String(option===selected));button.classList.toggle('is-selected',option===selected);
    button.append(element('span',option.textContent,'choice-option-label'),icon('check'));
    button.addEventListener('click',()=>chooseChoice(view,option.value));menu.append(button);
  }
}
function syncChoiceMenu(view,rebuild=false){
  const {select,button,value,menu}=view,selected=choiceSelectedOption(select),label=choiceLabel(select);
  button.disabled=select.disabled;button.setAttribute('aria-busy',select.getAttribute('aria-busy')||'false');
  const describedBy=select.getAttribute('aria-describedby');if(describedBy)button.setAttribute('aria-describedby',describedBy);else button.removeAttribute('aria-describedby');
  value.textContent=selected?.textContent||'';menu.setAttribute('aria-label',label);
  if(select.getAttribute('aria-labelledby'))button.setAttribute('aria-labelledby',select.getAttribute('aria-labelledby')+' '+value.id);
  else button.setAttribute('aria-label',[label,value.textContent].filter(Boolean).join(': '));
  if(button.disabled&&menu.matches(':popover-open'))menu.hidePopover();
  if(rebuild||menu.matches(':popover-open'))renderChoiceMenu(view);
}
function syncChoiceMenus(rebuild=false){for(const view of choiceMenus.values())syncChoiceMenu(view,rebuild);}
function positionChoiceMenu(view){
  if(!view?.menu.matches(':popover-open'))return;
  const {button,menu}=view,rect=button.getBoundingClientRect(),edge=12,gap=7,available=Math.max(160,globalThis.innerWidth-edge*2);
  menu.style.width='max-content';menu.style.maxHeight=Math.max(120,globalThis.innerHeight-edge*2)+'px';
  const natural=Math.ceil(menu.getBoundingClientRect().width),width=Math.min(available,Math.max(rect.width,natural));menu.style.width=width+'px';
  const height=menu.getBoundingClientRect().height,below=rect.bottom+gap,above=rect.top-gap-height;
  menu.style.left=Math.max(edge,Math.min(rect.left,globalThis.innerWidth-width-edge))+'px';
  menu.style.top=(below+height<=globalThis.innerHeight-edge||above<edge?Math.min(below,globalThis.innerHeight-height-edge):above)+'px';
}
function focusChoiceOption(view,edge=0){
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)'));if(!options.length)return;
  const selected=options.find(option=>option.getAttribute('aria-selected')==='true'),target=edge<0?options.at(-1):edge>0?options[0]:selected||options[0];target.focus({preventScroll:true});
}
function openChoice(view,focus=0){
  if(view.button.disabled)return false;
  renderChoiceMenu(view);if(!view.menu.matches(':popover-open'))view.menu.showPopover();view.button.setAttribute('aria-expanded','true');positionChoiceMenu(view);
  if(focus!==null)queueMicrotask(()=>focusChoiceOption(view,focus));return true;
}
function closeChoice(view,restoreFocus=false){
  if(view.menu.matches(':popover-open'))view.menu.hidePopover();view.button.setAttribute('aria-expanded','false');
  if(restoreFocus)view.button.focus({preventScroll:true});
}
function chooseChoice(view,value){
  const option=choiceSelectOptions(view.select).find(item=>item.value===value&&!item.disabled);if(!option)return;
  const changed=view.select.value!==value;view.select.value=value;closeChoice(view,true);syncChoiceMenu(view);
  if(changed)view.select.dispatchEvent(new Event('change',{bubbles:true}));
}
function moveChoiceFocus(view,key){
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)'));if(!options.length)return;
  if(key==='Home'||key==='End'){options[key==='Home'?0:options.length-1].focus({preventScroll:true});return;}
  const current=options.indexOf(document.activeElement),offset=key==='ArrowUp'?-1:1,index=current<0?(offset<0?options.length-1:0):(current+offset+options.length)%options.length;
  options[index].focus({preventScroll:true});
}
function moveChoiceTab(view,backwards=false){
  const candidates=Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(node=>{
    if(node===view.select||view.menu.contains(node)||node.disabled||node.hidden||node.getAttribute('aria-hidden')==='true'||node.tabIndex<0)return false;
    for(let parent=node.parentElement;parent;parent=parent.parentElement)if(parent.hidden||parent.inert)return false;
    return true;
  });
  const index=candidates.indexOf(view.button),target=candidates[index+(backwards?-1:1)];closeChoice(view);
  (target||view.button).focus({preventScroll:true});
}
function choiceTypeahead(view,key){
  clearTimeout(view.typeTimer);const letter=key.toLocaleLowerCase(uiLanguage);
  view.typeQuery=view.typeQuery.length===1&&view.typeQuery===letter?letter:(view.typeQuery+letter).toLocaleLowerCase(uiLanguage);
  view.typeTimer=setTimeout(()=>{view.typeQuery='';view.typeTimer=null;},650);
  const options=Array.from(view.menu.querySelectorAll('.choice-option:not(:disabled)')),start=Math.max(0,options.indexOf(document.activeElement));
  const ordered=[...options.slice(start+1),...options.slice(0,start+1)],match=ordered.find(option=>option.textContent.trim().toLocaleLowerCase(uiLanguage).startsWith(view.typeQuery));match?.focus({preventScroll:true});
}
function enhanceChoiceSelect(select){
  if(!select||choiceMenus.has(select))return choiceMenus.get(select);
  const shell=element('span',undefined,'choice-shell'),button=element('button',undefined,'choice-trigger'),value=element('span',undefined,'choice-value'),menu=element('div',undefined,'choice-menu');
  const id=select.id||'choice-'+(choiceMenus.size+1);value.id=id+'-choice-value';menu.id=id+'-choice-menu';button.type='button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',menu.id);button.setAttribute('popovertarget',menu.id);menu.setAttribute('popover','auto');menu.setAttribute('role','listbox');menu.tabIndex=-1;
  select.parentNode.insertBefore(shell,select);shell.append(select,button);button.append(value,icon('down'));
  choiceMenuHost(select).append(menu);select.classList.add('choice-menu-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.hidden=true;
  const view={select,shell,button,value,menu,typeQuery:'',typeTimer:null,observer:null};choiceMenus.set(select,view);
  button.addEventListener('click',event=>{event.preventDefault();if(menu.matches(':popover-open'))closeChoice(view);else openChoice(view,null);});
  button.addEventListener('keydown',event=>{
    if(['Enter',' '].includes(event.key)){event.preventDefault();if(menu.matches(':popover-open'))closeChoice(view,true);else openChoice(view,0);return;}
    if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openChoice(view,event.key==='ArrowUp'?-1:1);}
  });
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeChoice(view,true);return;}
    if(event.key==='Tab'){event.preventDefault();moveChoiceTab(view,event.shiftKey);return;}
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();moveChoiceFocus(view,event.key);return;}
    if(event.key!==' '&&event.key.length===1&&!event.altKey&&!event.ctrlKey&&!event.metaKey)choiceTypeahead(view,event.key);
  });
  menu.addEventListener('toggle',event=>{const open=event.newState==='open';button.setAttribute('aria-expanded',String(open));button.classList.toggle('is-open',open);if(open)positionChoiceMenu(view);});
  select.addEventListener('change',()=>syncChoiceMenu(view));
  if(typeof MutationObserver==='function'){
    view.observer=new MutationObserver(()=>syncChoiceMenu(view,true));
    view.observer.observe(select,{attributes:true,attributeFilter:['disabled','aria-busy','aria-describedby','aria-label','aria-labelledby']});
  }
  syncChoiceMenu(view,true);return view;
}
function setupChoiceMenus(){
  for(const select of document.querySelectorAll('select[data-choice-menu]'))enhanceChoiceSelect(select);
  const reposition=()=>{if(choiceMenuFrame!==null)return;choiceMenuFrame=requestAnimationFrame(()=>{choiceMenuFrame=null;for(const view of choiceMenus.values())positionChoiceMenu(view);});};
  globalThis.addEventListener?.('resize',reposition);globalThis.addEventListener?.('scroll',reposition,{capture:true,passive:true});
}
