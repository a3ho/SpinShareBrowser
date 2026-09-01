// Chart presentation. Business state stays in app.js.

function appendChartDescription(body,text){
  let end=0;
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)){
    const raw=match[0];let value=raw.replace(/[.,!?;:\u3002\uff0c\uff01\uff1f\uff1b\uff1a]+$/u,'');
    for(const [open,close] of [['(',')'],['[',']'],['{','}']]){
      let excess=value.split(close).length-value.split(open).length,length=value.length;
      while(excess>0&&value[length-1]===close){length--;excess--;}
      value=value.slice(0,length);
    }
    body.append(text.slice(end,match.index));let url=null;try{url=new URL(value);}catch{}
    if(url&&['http:','https:'].includes(url.protocol)&&url.hostname){const link=element('a',value);link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';body.append(link,raw.slice(value.length));}
    else body.append(raw);
    end=match.index+raw.length;
  }
  body.append(text.slice(end));
}
function steamDLCURL(value){
  try{
    const url=new URL(value);
    if(url.origin!=='https://store.steampowered.com'||url.username||url.password||url.search||url.hash)return '';
    if(!/^\/app\/[1-9]\d{0,11}(?:\/[A-Za-z0-9_-]{1,200})?\/?$/.test(url.pathname))return '';
    return url.href;
  }catch{return '';}
}
function makeDLCRequirement(row){
  const dlc=row[8]?.dlc;if(!dlc)return null;
  const rawTitle=typeof dlc['title']==='string'?dlc['title'].trim():'',title=rawTitle&&rawTitle.length<=160&&!/[\p{Cc}\p{Cf}\p{Cs}]/u.test(rawTitle)?rawTitle:'',url=title?steamDLCURL(dlc.storeLink):'',valid=Boolean(title&&url);
  const label=valid?m('Requires ')+title:m('Requires DLC'),requirement=element(valid?'a':'span',undefined,'dlc-requirement');
  uiAttr(requirement,'aria-label',url?m('Open required DLC on Steam: ')+title:label);
  requirement.append(element('span',label));
  if(url){requirement.href=url;requirement.target='_blank';requirement.rel='noopener noreferrer';requirement.append(icon('external'));}
  return requirement;
}
function makeSongCredit(row,text,className,kind){
  const preview=element('p',undefined,className+' song-credit chart-disclosure'),content=element('span',text,'song-credit-text chart-disclosure-text');
  preview.append(content);bindChartDescription(row,preview,content,kind);return preview;
}
function makeChartNotes(row){
  const meta=row[8]||{},description=typeof meta.description==='string'?meta.description:'',tags=Array.isArray(meta.tags)?meta.tags.filter(tag=>typeof tag==='string'&&tagKey(tag)):[];
  if(!description.trim()&&!tags.length)return null;
  const notes=element('div',undefined,'chart-notes'+(description.trim()?'':' is-tags-only'));
  if(description.trim()){
    const preview=element('div',undefined,'chart-description chart-disclosure'),content=element('div',undefined,'chart-description-text chart-disclosure-text');
    appendChartDescription(content,description);preview.append(content);notes.append(preview);bindChartDescription(row,preview,content,'description');
  }
  if(tags.length){
    ensureChartTagsPopover();const strip=element('div',undefined,'chart-tags');strip.setAttribute('role','group');uiAttr(strip,'aria-label',m('Chart tags'));
    strip.append(...tags.map(tag=>makeChartTagButton(tag,row[0])));notes.append(strip);let touchOpening=false;
    strip.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showChartTags(strip);});
    strip.addEventListener('pointerleave',event=>{if(event.pointerType!=='touch')leaveChartTags();});
    strip.addEventListener('pointerdown',event=>{touchOpening=event.pointerType==='touch'&&chartTagsOwner!==strip&&chartTagsOverflow(strip);});
    strip.addEventListener('pointercancel',()=>{touchOpening=false;});
    strip.addEventListener('click',event=>{if(touchOpening||event.target===strip){touchOpening=false;if(showChartTags(strip)){event.preventDefault();event.stopPropagation();}}},true);
    strip.addEventListener('focusin',event=>{if(document.documentElement.dataset.inputModality!=='pointer'&&!chartTagsIgnoreFocus&&event.target.matches(':focus-visible'))showChartTags(strip);});
    strip.addEventListener('focusout',leaveChartTags);
    strip.addEventListener('keydown',event=>{if(event.target===strip&&['Enter',' ','ArrowDown'].includes(event.key)&&showChartTags(strip)){event.preventDefault();chartTagsPopover.querySelector('button')?.focus({preventScroll:true});}});
    scheduleChartTagsRefresh();
  }
  return notes;
}

function createChartCard(row){
  const card=element('article',undefined,'chart-card');
  card.setAttribute('role','listitem');
  card.setAttribute('aria-labelledby','song-title-'+row[0]);

  const info=element('div',undefined,'song-info');
  const copy=element('div',undefined,'song-copy');
  const titleRow=element('div',undefined,'song-title-row');
  const songTitle=element('h2',row[1],'song-title');
  const official=element('a',undefined,'chart-official-link');
  songTitle.id='song-title-'+row[0];songTitle.tabIndex=-1;
  official.href='https://spinsha.re/song/'+row[0];official.target='_blank';official.rel='noopener noreferrer';
  uiAttr(official,'aria-label',m('Open on SpinShare: ')+row[1]);official.append(icon('external'));
  titleRow.append(songTitle,official);copy.append(titleRow);
  if(row[2])copy.append(makeSongCredit(row,row[2],'subtitle','subtitle'));
  copy.append(makeSongCredit(row,row[3]||m('Unknown artist'),'artist','artist'));
  const dlcRequirement=makeDLCRequirement(row);if(dlcRequirement)copy.append(dlcRequirement);

  const levels=element('div',undefined,'levels');
  uiAttr(levels,'aria-label',m('Matching difficulties'));
  for(let kind=0;kind<labels.length;kind++){
    const match=row[6].find(pair=>pair[0]===kind);
    const badge=element('span',shortLabels[kind]+(match?' '+match[1]:''),'badge'+(match?'':' is-muted'));
    const description=labels[kind]+(match?' '+match[1]:m(': outside this filter'));
    badge.dataset.difficulty=String(kind);
    uiAttr(badge,'aria-label',description);
    levels.append(badge);
  }

  const meta=element('div',undefined,'card-meta');
  const charter=element('div',undefined,'charter');
  const charterAvatar=element('span',undefined,'charter-avatar');
  const charterIdentity=element('span',undefined,'charter-identity');
  const uploader=element('div',undefined,'uploader');
  charterAvatar.append(makeAvatar('',row[4]||m('Charter')));
  charterIdentity.append(element('span',m('Charter'),'meta-label'),element('span',row[4]||m('Unknown charter'),'charter-name'));
  charter.append(charterAvatar,charterIdentity);
  uploader.hidden=true;meta.append(charter,uploader);
  info.append(makeCover(row),copy,levels,meta);

  const chartHeading=element('div',undefined,'chart-heading');
  const notes=makeChartNotes(row);
  chartHeading.append(info);
  if(notes)chartHeading.append(notes);
  card.append(chartHeading);

  const stats=element('div',undefined,'card-stats');
  const metrics=element('div',undefined,'card-metrics');stats.append(metrics);
  const date=element('time',row[5].slice(0,10)||'—','date');
  if(row[5])date.setAttribute('datetime',row[5].slice(0,10));
  uiAttr(date,'aria-label',m('Upload date')+': '+(row[5].slice(0,10)||'—'));metrics.append(date);
  for(const key of ['views','downloads']){
    const label=key==='views'?m('Views'):m('Downloads');
    const value=row[8][key]===null?'—':number(row[8][key]);
    const metric=element('div',undefined,'metric metric-'+key);
    uiAttr(metric,'aria-label',label+m(': ')+value);
    metric.append(icon(key),element('span',value,'metric-value'),element('span',label,'metric-label'));
    metrics.append(metric);
  }
  const commentMetric=element('button',undefined,'metric metric-comments review-toggle');
  const commentValue=element('span',reviewCounts.has(row[0])?number(reviewCounts.get(row[0])):'…','metric-value');
  commentMetric.type='button';commentMetric.setAttribute('aria-controls','chart-reviews-'+row[0]);commentMetric.setAttribute('aria-expanded','false');
  const chevron=element('span',undefined,'review-chevron');chevron.setAttribute('aria-hidden','true');
  commentMetric.append(icon('comments'),commentValue,element('span',m('Reviews'),'metric-label'),chevron);
  metrics.append(commentMetric);
  installationControl(row,stats,card);

  const reviewCell=element('section',undefined,'review-cell reading-popover');
  reviewCell.id='chart-reviews-'+row[0];reviewCell.hidden=true;reviewCell.inert=true;reviewCell.tabIndex=-1;reviewCell.setAttribute('popover','manual');
  const reviewBody=element('div',undefined,'review-body reading-body');
  const context=element('div',undefined,'review-context');
  const title=element('span',row[1],'review-context-title');
  context.append(title);
  const heading=element('div',undefined,'reviews-heading');
  const summary=element('p',m('Reviews'),'review-summary');
  const refresh=element('button',undefined,'review-refresh');
  const refreshLabel=element('span',m('Refresh reviews'));
  const list=element('div',undefined,'inline-reviews reading-content');
  const note=element('p','','review-note');
  uiAttr(reviewCell,'aria-label',row[1]+m("'s public reviews"));
  summary.setAttribute('role','status');list.setAttribute('role','list');
  list.tabIndex=0;
  uiAttr(list,'aria-label',m('All public ratings and reviews'));
  refresh.type='button';
  uiAttr(refresh,'aria-label',m('Reload ')+row[1]+m("'s complete reviews"));
  refresh.append(icon('refresh'),refreshLabel);
  heading.append(summary,refresh);reviewBody.append(context,heading,note,list);reviewCell.append(reviewBody);card.append(reviewCell);
  const cell={row,card,target:reviewCell,body:reviewBody,toggle:commentMetric,chevron,context,summary,refresh,refreshLabel,list,note,charterAvatar,charterIdentity,uploader,commentValue,seen:false,pending:false,reviewTemporaryOpen:false};
  bindReviewDrawer(cell);
  bindChartDescriptionCard(card);
  return {row,card,cell};
}
