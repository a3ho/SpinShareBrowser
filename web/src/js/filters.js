function readDifficulty(){
  const min=Number($('min').value),max=Number($('max').value),diffs=Array.from(document.querySelectorAll('input[name="diff"]:checked'),el=>Number(el.value));
  if($('min').value===''||$('max').value===''||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max>999||min>max)throw uiError(m("Use whole numbers from 0 to 999, with minimum no higher than maximum."));
  if(!diffs.length)throw uiError(m("Select at least one difficulty."));
  return {min,max,diffs};
}
function readCriteria(){
  const difficulty=readDifficulty();
  const dateFrom=$('date-from').value.trim(),dateTo=$('date-to').value.trim(),today=updateDateBounds();
  if([dateFrom,dateTo].some(value=>value&&(!validDate(value)||value<FIRST_UPLOAD_DATE||value>today)))throw uiError(m("Choose dates between 2020-01-01 and today."));
  if(dateFrom&&dateTo&&dateFrom>dateTo)throw uiError(m("Choose a valid date range, with the start no later than the end."));
  return {...difficulty,dateFrom,dateTo};
}
function filtersChanged(){
  if(!applied)return false;
  try{return JSON.stringify(readCriteria())!==JSON.stringify(applied);}catch{return true;}
}
function syncResultTools(visible,previousFocus){
  const panel=$('result-tools'),busy=phase==='loading';
  if(!visible&&panel.contains(previousFocus)||previousFocus===$('apply-filters')&&busy){
    const filter=$('filter-panel'),action=$('apply-filters');
    const target=filter.open&&!action.hidden&&!action.disabled?action:filter.querySelector('summary');
    target.focus({preventScroll:true});
  }
  panel.inert=!visible;if(visible===resultToolsVisible)return;resultToolsVisible=visible;
  const height=panel.hidden?0:panel.getBoundingClientRect().height,opacity=panel.hidden?0:globalThis.getComputedStyle?.(panel)?.opacity||'1';
  const previous=resultToolsMotion;resultToolsMotion=null;previous?.cancel();
  if(panel.hidden&&!visible)return;panel.hidden=false;panel.classList.add('is-transitioning');
  const end=visible?$('result-tools-content').getBoundingClientRect().height:0;
  const animation=playMotion(panel,[{height:height+'px',opacity},{height:end+'px',opacity:visible?1:0}],{duration:MOTION_MS.standard});
  const finish=()=>{if(animation&&resultToolsMotion!==animation)return;resultToolsMotion=null;panel.hidden=!resultToolsVisible;panel.classList.remove('is-transitioning');};
  if(animation){resultToolsMotion=animation;animation.finished.then(finish,finish);}else finish();
}
function syncFilters(){
  const busy=phase==='loading'||typeof catalogStartupBusy!=='undefined'&&catalogStartupBusy,ready=Boolean(applied)&&phase==='ready',previousFocus=document.activeElement;
  $('difficulty-fields').disabled=busy||appExiting;$('date-fields').disabled=busy||appExiting;
  if((busy||appExiting)&&$('date-calendar')?.matches?.(':popover-open'))$('date-calendar').hidePopover();
  $('apply-filters').disabled=busy||appExiting;
  loadingIndicator($('apply-filters'),false);
  syncCatalogRefresh();
  $('reset-filters').disabled=busy||appExiting;
  for(const id of ['local-search','search-submit','search-clear'])$(id).disabled=!ready;
  $('installation-filter').disabled=!ready||appExiting;
  const dirty=!busy&&filtersChanged(),applyButton=$('apply-filters');
  // Clean, ready forms have nothing to apply; the first run (not ready yet)
  // and any pending change stay enabled. Reset goes quiet only when the form
  // also matches the captured startup defaults.
  const clean=ready&&!dirty;
  applyButton.disabled=busy||appExiting||clean;
  $('reset-filters').disabled=busy||appExiting||clean&&!filtersDifferFromDefaults();
  uiText(applyButton,dirty?m('Apply changes'):m('Filter charts'));applyButton.classList.toggle('has-pending-changes',dirty);
  const dirtyStatus=$('filter-dirty'),dirtyMessage=dirty?m('Filters changed. Select Apply changes to update the results.'):'';
  if(dirtyStatus.textContent!==renderUI(dirtyMessage))uiText(dirtyStatus,dirtyMessage);
  syncResultTools(ready,previousFocus);
  syncTagControls();
  if(typeof syncChoiceMenus==='function')syncChoiceMenus();
}
let defaultCriteriaSnapshot=null;
function filtersDifferFromDefaults(){
  if(!defaultCriteriaSnapshot)return false;
  const current=readCriteria();
  return JSON.stringify(current)!==JSON.stringify(defaultCriteriaSnapshot);
}
function captureDefaultCriteria(){
  if(defaultCriteriaSnapshot)return;
  defaultCriteriaSnapshot=readCriteria();
}
function cancelQuery(){
  const active=controller;controller=null;active?.abort();
  stopTextSearch(true);clearTimeout(textFilterTimer);textFilterTimer=null;
  currentRows=[];filtered=[];applied=null;appliedText='';phase='idle';
  setStatus('');render();
}
function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function siteToday(){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  return ['year','month','day'].map(type=>parts.find(part=>part.type===type).value).join('-');
}
function updateDateBounds(){
  const today=siteToday();
  for(const id of ['date-from','date-to']){
    const picker=$(id+'-picker');picker.setAttribute('min',FIRST_UPLOAD_DATE);picker.setAttribute('max',today);
  }
  return today;
}
function syncDates(){
  $('custom-dates').hidden=$('date-preset').value!=='custom';
  for(const id of ['date-from','date-to'])$(id+'-picker').value=validDate($(id).value.trim())?$(id).value.trim():'';
  if($('custom-dates').hidden)closeDateCalendar();else if(dateCalendar?.matches(':popover-open'))renderDateCalendar();
}
let dateCalendar=null,dateCalendarField='',dateCalendarFocus='';
function closeDateCalendar(restoreFocus=false){
  if(!dateCalendar?.matches(':popover-open'))return;
  dateCalendar.hidePopover();
  if(restoreFocus&&!appExiting)$(dateCalendarField+'-open').focus({preventScroll:true});
}
function positionDateCalendar(){
  if(!dateCalendar?.matches(':popover-open'))return;
  const anchor=$(dateCalendarField+'-open'),rect=anchor.getBoundingClientRect(),edge=12,gap=8;
  const width=document.documentElement.clientWidth,height=document.documentElement.clientHeight;
  const ceiling=Math.max(edge,(document.querySelector('.topbar')?.getBoundingClientRect().bottom||0)+gap);
  if(appExiting||!anchor.isConnected||$('custom-dates').hidden||rect.bottom<=ceiling||rect.top>=height-edge){closeDateCalendar();return;}
  dateCalendar.style.width=Math.min(320,Math.max(1,width-edge*2))+'px';dateCalendar.style.maxHeight=Math.max(1,height-ceiling-edge)+'px';
  let box=dateCalendar.getBoundingClientRect();
  const below=height-edge-rect.bottom-gap,above=rect.top-gap-ceiling,down=below>=box.height||below>=above;
  dateCalendar.style.maxHeight=Math.max(1,down?below:above)+'px';box=dateCalendar.getBoundingClientRect();
  dateCalendar.style.left=Math.max(edge,Math.min(rect.left,width-edge-box.width))+'px';
  dateCalendar.style.top=Math.max(ceiling,Math.min(down?rect.bottom+gap:rect.top-gap-box.height,height-edge-box.height))+'px';
}
function moveDateCalendar(days=0,months=0,focus=true){
  if(appExiting)return;
  const date=new Date(dateCalendarFocus+'T00:00:00Z'),day=date.getUTCDate(),today=updateDateBounds();
  if(months){
    date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
    date.setUTCDate(Math.min(day,new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate()));
  }
  date.setUTCDate(date.getUTCDate()+days);
  const value=date.toISOString().slice(0,10);dateCalendarFocus=value<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:value>today?today:value;
  renderDateCalendar(focus);
}
function chooseCalendarDate(value){
  if(appExiting||!dateCalendar?.matches(':popover-open'))return;
  if(value&&(!validDate(value)||value<FIRST_UPLOAD_DATE||value>updateDateBounds()))return;
  $(dateCalendarField).value=value;$('date-preset').value='custom';
  syncDates();syncFilters();closeDateCalendar(true);
}
function renderDateCalendar(focus=false){
  if(!dateCalendar||!dateCalendarField)return;
  const restoreFocus=focus||dateCalendar.contains(document.activeElement)&&document.activeElement.classList.contains('calendar-day');
  const today=updateDateBounds(),date=new Date(dateCalendarFocus+'T00:00:00Z'),year=date.getUTCFullYear(),month=date.getUTCMonth(),monthKey=dateCalendarFocus.slice(0,7);
  const from=$('date-from').value.trim(),to=$('date-to').value.trim(),selected=$(dateCalendarField).value.trim();
  const hasRange=validDate(from)&&validDate(to)&&from>=FIRST_UPLOAD_DATE&&to<=today&&from<=to;
  uiText(dateCalendar.querySelector('.calendar-context'),m(dateCalendarField==='date-from'?'Choose start date':'Choose end date'));
  const yearSelect=dateCalendar.querySelector('.calendar-year'),monthSelect=dateCalendar.querySelector('.calendar-month');
  yearSelect.replaceChildren();monthSelect.replaceChildren();
  for(let value=Number(FIRST_UPLOAD_DATE.slice(0,4));value<=Number(today.slice(0,4));value++){
    const option=element('option',String(value));option.value=String(value);yearSelect.append(option);
  }
  const monthLabel=new Intl.DateTimeFormat(uiLanguage,{month:'long',timeZone:'UTC'});
  for(let value=0;value<12;value++){
    const key=year+'-'+String(value+1).padStart(2,'0'),option=element('option',monthLabel.format(new Date(Date.UTC(year,value,1))));
    option.value=String(value);option.disabled=key<FIRST_UPLOAD_DATE.slice(0,7)||key>today.slice(0,7);monthSelect.append(option);
  }
  yearSelect.value=String(year);monthSelect.value=String(month);
  const nav=dateCalendar.querySelectorAll('.calendar-nav');nav[0].disabled=monthKey<=FIRST_UPLOAD_DATE.slice(0,7);nav[1].disabled=monthKey>=today.slice(0,7);
  const weekdays=dateCalendar.querySelector('.calendar-weekdays'),days=dateCalendar.querySelector('.calendar-days');weekdays.replaceChildren();days.replaceChildren();
  const weekdayLabel=new Intl.DateTimeFormat(uiLanguage,{weekday:'short',timeZone:'UTC'}),fullLabel=new Intl.DateTimeFormat(uiLanguage,{weekday:'long',year:'numeric',month:'long',day:'numeric',timeZone:'UTC'});
  date.setUTCDate(1);date.setUTCDate(1-(date.getUTCDay()+6)%7);
  for(let index=0;index<42;index++,date.setUTCDate(date.getUTCDate()+1)){
    if(index<7)weekdays.append(element('span',weekdayLabel.format(date)));
    const value=date.toISOString().slice(0,10),button=element('button',String(date.getUTCDate()),'calendar-day');
    button.type='button';button.dataset.date=value;button.disabled=value<FIRST_UPLOAD_DATE||value>today;button.tabIndex=value===dateCalendarFocus?0:-1;
    button.setAttribute('aria-label',fullLabel.format(date));button.setAttribute('aria-pressed',String(value===selected));
    button.classList.toggle('is-outside',date.getUTCMonth()!==month);button.classList.toggle('is-today',value===today);
    button.classList.toggle('is-in-range',hasRange&&value>=from&&value<=to);
    button.classList.toggle('is-range-start',hasRange&&value===from);button.classList.toggle('is-range-end',hasRange&&value===to);
    if(value===today)button.setAttribute('aria-current','date');days.append(button);
  }
  positionDateCalendar();
  if(restoreFocus&&dateCalendar.matches(':popover-open'))days.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
}
function ensureDateCalendar(){
  if(dateCalendar)return dateCalendar;
  const panel=element('div',undefined,'date-calendar');dateCalendar=panel;
  panel.id='date-calendar';panel.setAttribute('popover','auto');panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','date-calendar-context');
  const context=element('p',undefined,'calendar-context');context.id='date-calendar-context';context.setAttribute('aria-live','polite');
  const header=element('div',undefined,'calendar-header'),selects=element('div',undefined,'calendar-selects');
  const year=element('select',undefined,'calendar-year'),month=element('select',undefined,'calendar-month');
  uiAttr(year,'aria-label',m('Year'));uiAttr(month,'aria-label',m('Month'));
  year.addEventListener('change',()=>moveDateCalendar(0,(Number(year.value)-Number(dateCalendarFocus.slice(0,4)))*12,false));
  month.addEventListener('change',()=>moveDateCalendar(0,Number(month.value)-Number(dateCalendarFocus.slice(5,7))+1,false));
  selects.append(year,month);
  for(const offset of [-1,1]){
    const button=element('button',undefined,'calendar-nav');button.type='button';button.append(icon(offset<0?'left':'right'));
    uiAttr(button,'aria-label',m(offset<0?'Previous month':'Next month'));button.addEventListener('click',()=>moveDateCalendar(0,offset));
    header.append(button);if(offset<0)header.append(selects);
  }
  const weekdays=element('div',undefined,'calendar-weekdays'),days=element('div',undefined,'calendar-days'),footer=element('div',undefined,'calendar-footer');
  weekdays.setAttribute('aria-hidden','true');
  const today=element('button',m('Today'),'calendar-today'),clear=element('button',m('Clear date'),'calendar-clear');today.type='button';clear.type='button';
  today.addEventListener('click',()=>chooseCalendarDate(siteToday()));clear.addEventListener('click',()=>chooseCalendarDate(''));
  footer.append(today,clear);panel.append(context,header,weekdays,days,footer);
  days.addEventListener('click',event=>{const button=event.target.closest('.calendar-day');if(button&&!button.disabled)chooseCalendarDate(button.dataset.date);});
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeDateCalendar(true);return;}
    if(!event.target.classList.contains('calendar-day')||event.altKey||event.ctrlKey||event.metaKey)return;
    dateCalendarFocus=event.target.dataset.date;
    if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseCalendarDate(dateCalendarFocus);return;}
    const weekday=(new Date(dateCalendarFocus+'T00:00:00Z').getUTCDay()+6)%7,offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-weekday,End:6-weekday};
    if(event.key in offsets){event.preventDefault();moveDateCalendar(offsets[event.key]);}
    else if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();moveDateCalendar(0,(event.key==='PageUp'?-1:1)*(event.shiftKey?12:1));}
  });
  panel.addEventListener('toggle',()=>{for(const id of ['date-from','date-to'])$(id+'-open').setAttribute('aria-expanded',String(panel.matches(':popover-open')&&dateCalendarField===id));});
  globalThis.addEventListener?.('resize',positionDateCalendar);
  globalThis.addEventListener?.('scroll',event=>{if(!panel.contains(event.target))positionDateCalendar();},{capture:true,passive:true});
  return panel;
}
function openDatePicker(id){
  if(appExiting)return;
  const today=updateDateBounds(),picker=$(id+'-picker'),value=$(id).value.trim();picker.value=validDate(value)?value:'';
  if(dateCalendar?.matches(':popover-open')&&dateCalendarField===id){closeDateCalendar(true);return;}
  dateCalendarField=id;dateCalendarFocus=!validDate(value)||value>today?today:value<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:value;
  const panel=ensureDateCalendar(),control=$(id+'-open').closest('.date-control');
  if(panel.parentElement!==control.parentElement){closeDateCalendar();control.after(panel);}
  renderDateCalendar();
  if(!panel.matches(':popover-open'))panel.showPopover();positionDateCalendar();
  for(const field of ['date-from','date-to'])$(field+'-open').setAttribute('aria-expanded',String(panel.matches(':popover-open')&&field===id));
  panel.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
}
function presetDates(preset,today=siteToday()){
  if(preset==='all')return {from:'',to:''};
  if(!validDate(today))throw new Error('Invalid calendar date');
  const date=new Date(today+'T00:00:00Z');
  if(preset==='month'||preset==='quarter'){
    const day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-(preset==='month'?1:3));
    const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last)+1);
  }else if(['1','2','7'].includes(preset))date.setUTCDate(date.getUTCDate()-Number(preset)+1);
  else throw new Error('Unknown date preset');
  const from=date.toISOString().slice(0,10);return {from:from<FIRST_UPLOAD_DATE?FIRST_UPLOAD_DATE:from,to:today};
}
function applyDatePreset(){
  updateDateBounds();
  if($('date-preset').value!=='custom'){
    const range=presetDates($('date-preset').value);$('date-from').value=range.from;$('date-to').value=range.to;
  }
  syncDates();syncFilters();
}
