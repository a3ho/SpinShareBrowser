async function readReviews(id,signal,refresh=false,priority='high',refreshOwner=null){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!refresh&&reviewCache.has(id))return reviewCache.get(id);
  const generation=cacheGeneration;
  if(refresh)beginReviewRefresh(refreshOwner);
  const response=await fetch('https://spinsha.re/api/song/'+id+'/reviews',{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',priority,signal});
  const result=await readJSONResponse(response,2*1024*1024),data=result?.data;
  if(result?.status!==200||!data||typeof data!=='object'||Array.isArray(data))throw uiError(m("Reviews could not be loaded."));
  // SpinShare omits reviews only for an empty collection, whose average is false.
  const entries=!Object.hasOwn(data,'reviews')&&data.average===false?[]:data.reviews;
  if(!Array.isArray(entries))throw uiError(m("Reviews could not be loaded."));
  const items=entries.map(item=>{if(!item||typeof item!=='object')throw uiError(m("Reviews could not be loaded."));return {user:publicUser(item.user),text:String(item.comment||''),date:String(item.reviewDate?.date||''),timezone:String(item.reviewDate?.timezone||''),recommended:item.recommended===true?true:item.recommended===false?false:null};});
  const average=typeof data.average==='number'&&Number.isFinite(data.average)&&data.average>=0&&data.average<=100?data.average:null;
  const reviews={items,total:items.length,comments:items.filter(item=>item.text.trim()).length,average};
  if(!signal.aborted&&generation===cacheGeneration){reviewCache.delete(id);remember(reviewCache,id,reviews);}
  return reviews;
}
async function readSharedUser(id,signal,read){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  const generation=cacheGeneration;
  let pending=profileRequests.get(id);
  if(!pending||pending.generation!==generation||pending.request.signal.aborted){
    const request=new AbortController(),timer=setTimeout(()=>request.abort(),20000);
    pending={generation,request,users:0,promise:null};
    pending.promise=(async()=>{
      try{return await read(request.signal,generation);}
      finally{clearTimeout(timer);if(profileRequests.get(id)===pending)profileRequests.delete(id);}
    })();
    profileRequests.set(id,pending);
  }
  pending.users++;let released=false,rejectAbort;
  const aborted=new Promise((resolve,reject)=>{rejectAbort=reject;});
  const release=()=>{if(released)return;released=true;if(--pending.users===0)pending.request.abort();};
  const onAbort=()=>{release();rejectAbort(new DOMException('Aborted','AbortError'));};
  signal.addEventListener('abort',onAbort,{once:true});
  try{
    const user=await Promise.race([pending.promise,aborted]);
    if(signal.aborted)throw new DOMException('Aborted','AbortError');
    return user;
  }finally{signal.removeEventListener('abort',onAbort);release();}
}
async function readUserProfile(id,signal){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(profileCache.has(id))return profileCache.get(id);
  return readSharedUser(id,signal,async(request,generation)=>{
    const response=await fetch('https://spinsha.re/api/user/'+id,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',priority:'low',signal:request});
    const result=await readJSONResponse(response,2*1024*1024),data=result?.data;
    if(result?.status!==200||!data||typeof data!=='object'||Array.isArray(data))throw uiError(m("Uploader profile unavailable."));
    const user=publicUser(data);if(user.id!==id)throw uiError(m("Uploader account mismatch."));
    if(request.aborted)throw new DOMException('Aborted','AbortError');
    if(generation===cacheGeneration)remember(profileCache,id,user,2048);return user;
  });
}
async function readUserSearch(query,signal){
  if(signal.aborted)throw new DOMException('Aborted','AbortError');
  if(!canSearchUsers(query))return [];
  if(userSearchCache.has(query))return userSearchCache.get(query);
  return readSharedUser('search:'+query,signal,async(request,generation)=>{
    const response=await fetch('https://spinsha.re/api/searchUsers',{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',priority:'low',headers:{'Content-Type':'application/json'},body:JSON.stringify({searchQuery:query}),signal:request});
    const result=await readJSONResponse(response,512*1024);
    if(result?.status!==200||!Array.isArray(result.data))throw uiError(m('Uploader lookup failed. Showing local matches only.'));
    const users=result.data.filter(user=>typeof user?.username==='string'&&titleKey(user.username).includes(query)).map(publicUser).filter(user=>user.id);
    if(request.aborted)throw new DOMException('Aborted','AbortError');
    if(generation===cacheGeneration)remember(userSearchCache,query,users,32,2*1024*1024);return users;
  });
}
function prunePageDetails(cells){
  if(!pageDetails)return;
  if(reviewRefreshOwner?.state===pageDetails&&!cells.has(reviewRefreshOwner.cell))releaseReviewRefresh(reviewRefreshOwner);
  for(const [target,cell] of pageDetails.targets)if(!cells.has(cell)){pageDetails.observer?.unobserve(target);pageDetails.targets.delete(target);}
  pageDetails.jobs=pageDetails.jobs.filter(job=>{
    if(job.kind==='reviews'){if(!cells.has(job.cell)){job.cell.pending=false;releaseReviewRefresh(job.refreshOwner);return false;}return true;}
    job.cells=job.cells.filter(cell=>cells.has(cell));
    if(!job.cells.length&&pageDetails.profiles.get(job.id)===job)pageDetails.profiles.delete(job.id);
    return Boolean(job.cells.length);
  });
  for(const job of pageDetails.profiles.values()){
    job.cells=job.cells.filter(cell=>cells.has(cell));
    if(!job.cells.length){job.request?.abort();pageDetails.profiles.delete(job.id);}
  }
}
function stopPageDetails(){
  moreObserver?.disconnect();moreObserver=null;
  for(const {cell} of cardViews.values())retireReviewCell(cell);
  clearTimeout(reviewRefreshTimer);reviewRefreshTimer=null;
  if(!pageDetails)return;pageDetails.stopped=true;pageDetails.observer?.disconnect();pageDetails.jobs.length=0;
  if(reviewRefreshOwner?.state===pageDetails)releaseReviewRefresh(reviewRefreshOwner);
  pageDetails.targets.clear();pageDetails.profiles.clear();for(const request of pageDetails.controllers)request.abort();pageDetails=null;
}
function watchPageReviews(cells){
  const state=pageDetails||{stopped:false,jobs:[],controllers:new Set(),profiles:new Map(),targets:new Map(),active:0,observer:null};pageDetails=state;
  const queue=visible=>{
    if(state.stopped)return;const fresh=visible.filter(cell=>!cell.seen);for(const cell of fresh)cell.seen=true;
    for(const cell of visible)queueReviews(cell,state);for(const cell of fresh)queueProfile(cell,state);
  };
  for(const cell of cells){
    if(!cell.watched){cell.watched=true;cell.refresh.addEventListener('click',()=>queueReviews(cell,state,true));}
    // Only rendered pages/batches enter this bounded queue; collapsed cards still get counts.
    queueReviews(cell,state);
    const user=profileCache.get(cell.row[8].uploader);if(user)showProfile(cell,user);
  }
  if(typeof IntersectionObserver==='function'){
    if(!state.observer)state.observer=new IntersectionObserver(entries=>{
      const visible=[];for(const entry of entries)if(entry.isIntersecting){const cell=state.targets.get(entry.target);if(cell){state.observer.unobserve(entry.target);state.targets.delete(entry.target);visible.push(cell);}}queue(visible);
    },{rootMargin:'40px'});
    for(const cell of cells){const target=cardViews.get(cell.row[0])?.card||cell.target;state.targets.set(target,cell);state.observer.observe(target);}
  }else queue(cells);
}
function queueProfile(cell,state){
  const id=cell.row[8].uploader;if(!id||state.stopped||cell.retired)return;
  if(profileCache.has(id)){showProfile(cell,profileCache.get(id));return;}
  const ongoing=state.profiles.get(id);
  if(ongoing){ongoing.cells.push(cell);return;}
  const job={kind:'profile',id,cells:[cell]};state.profiles.set(id,job);state.jobs.push(job);pumpPageReviews(state);
}
function queueReviews(cell,state,refresh=false){
  if(state.stopped||cell.retired||cell.pending)return;
  if(!refresh&&reviewCounts.has(cell.row[0])&&(!reviewsOpen(cell)||cell.reviewLoaded)){syncReviewCount(cell);return;}
  if(!refresh&&cell.reviewError&&!reviewsOpen(cell))return;
  refresh=refresh||Boolean(cell.reviewError)&&reviewsOpen(cell)&&reviewCounts.has(cell.row[0])&&!reviewCache.has(cell.row[0]);
  const refreshOwner=refresh?reserveReviewRefresh(cell,state):null;
  if(refresh&&!refreshOwner)return;
  if(refresh){cell.reviewRetried=false;cell.reviewLoaded=false;}
  cell.reviewError='';
  cell.pending=true;syncReviewRefresh();
  syncReviewCount(cell);
  changeReviewContent(cell,()=>{uiText(cell.summary,m("Reviews")+': '+m("Queued"));loadingIndicator(cell.summary,true,true);uiText(cell.note,'');cell.target.setAttribute('aria-busy','true');});
  if(!refresh&&reviewCache.has(cell.row[0]))loadInlineReviews(cell,state);
  else{state.jobs.push({kind:'reviews',cell,refresh,refreshOwner});pumpPageReviews(state);}
}
function pumpPageReviews(state){
  while(!state.stopped&&state.active<2&&state.jobs.length){
    let next=state.jobs.findIndex(job=>job.kind==='reviews'&&reviewsOpen(job.cell));
    if(next<0)next=state.jobs.findIndex(job=>job.kind==='reviews'&&job.cell.seen);
    if(next<0)next=state.jobs.findIndex(job=>job.kind==='profile');
    const [job]=state.jobs.splice(next<0?0:next,1);state.active++;runPageJob(job,state);
  }
}
async function runPageJob(job,state){
  try{if(job.kind==='profile')await loadProfile(job,state);else await loadInlineReviews(job.cell,state,job.refresh,job.refreshOwner);}
  finally{state.active--;pumpPageReviews(state);}
}
async function loadProfile(job,state){
  const request=new AbortController();job.request=request;state.controllers.add(request);const timer=setTimeout(()=>request.abort(),20000);
  try{
    const user=await readUserProfile(job.id,request.signal);if(state.stopped||request.signal.aborted)return;
    for(const cell of job.cells)showProfile(cell,user);
  }catch(error){if(!state.stopped)for(const cell of job.cells)uiAttr(cell.charterAvatar,'aria-description',m('Avatar could not be loaded.'));}
  finally{clearTimeout(timer);state.controllers.delete(request);if(state.profiles.get(job.id)===job)state.profiles.delete(job.id);}
}
function showProfile(cell,user){
  if(cell.retired||cell.profile===user)return;cell.profile=user;
  if(cell.row[4].trim()&&cell.row[4].trim().toLocaleLowerCase()===user.name.trim().toLocaleLowerCase()){
    const link=userLink(user,'charter-name'),source=m("Avatar from uploader: ")+user.name;
    uiAttr(cell.charterAvatar,'aria-description',source);uiAttr(link,'aria-label',user.name);
    cell.charterAvatar.replaceChildren(makeAvatar(user.avatar,user.name));cell.charterIdentity.replaceChildren(element('span',m("Charter"),'meta-label'),link);
  }else{
    uiAttr(cell.charterAvatar,'aria-description',m('Uploader account shown below.'));
    cell.uploader.replaceChildren(element('span',m("Uploader"),'meta-label'),makeAvatar(user.avatar,user.name),userLink(user,'uploader-name'));cell.uploader.hidden=false;
  }
}
function reviewElement(item){
  const article=element('article',undefined,'review-item'),head=element('div',undefined,'review-head'),identity=element('div',undefined,'review-identity'),meta=element('div',undefined,'review-meta');
  article.setAttribute('role','listitem');identity.append(userLink(item.user,'review-author'));
  if(item.user.pronouns)identity.append(element('span',item.user.pronouns,'review-pronouns'));
  if(item.user.verified)identity.append(element('span',m("Verified"),'user-badge'));
  if(item.user.patron)identity.append(element('span',m("Patreon supporter"),'user-badge'));
  const date=element('time',item.date.replace(/\.0+$/,'')||m("Date unavailable"),'review-date');
  uiAttr(date,'aria-label',m('Review date')+': '+(item.date.replace(/\.0+$/,'')||m('Date unavailable')));if(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(item.date))date.setAttribute('datetime',item.date.slice(0,19).replace(' ','T'));
  meta.append(element('span',item.recommended===true?m("Recommended"):item.recommended===false?m("Not recommended"):m("Unrated"),item.recommended===true?'recommend':item.recommended===false?'not-recommend':''),date);
  const info=element('div',undefined,'review-person');info.append(identity,meta);head.append(makeAvatar(item.user.avatar,item.user.name),info);
  article.append(head,element('p',item.text.trim()?item.text:m("Rating only"),'review-text'));return article;
}
async function renderAllReviews(cell,result,state,request){
  const fragment=document.createDocumentFragment(),entries=[];
  if(!result.items.length)fragment.append(element('p',m("No reviews yet."),'reviews-empty'));
  for(let start=0;start<result.items.length;start+=40){
    if(state.stopped||request.signal.aborted)return false;
    for(const item of result.items.slice(start,start+40)){const node=reviewElement(item);fragment.append(node);entries.push([node,'review:'+cell.row[0]+':'+item.user.id+':'+item.date]);}
    if(start+40<result.items.length)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(state.stopped||request.signal.aborted||!reviewsOpen(cell))return false;
  // Build off-DOM in bounded batches; the temporary popover never resizes the document.
  changeReviewContent(cell,()=>{
    uiText(cell.summary,number(result.total)+m(" ratings | ")+number(result.comments)+m(" comments")+(result.average===null?'':' · '+result.average+m("% recommended")));
    cell.list.replaceChildren(fragment);uiText(cell.note,'');
  });
  for(const [node,key] of entries)queueEntry(node,key,'review');
  return true;
}
async function loadInlineReviews(cell,state,refresh=false,refreshOwner=null){
  if(state.stopped||cell.retired){cell.pending=false;releaseReviewRefresh(refreshOwner);return;}
  const generation=cacheGeneration,request=new AbortController();cell.request=request;state.controllers.add(request);let timedOut=false,reading=true,retry=false;
  uiText(cell.summary,m("Loading reviews..."));loadingIndicator(cell.summary,true);
  const timer=setTimeout(()=>{timedOut=true;request.abort();},20000);
  try{
    const result=await readReviews(cell.row[0],request.signal,refresh,reviewsOpen(cell)?'high':'low',refreshOwner);
    if(state.stopped||cell.retired||generation!==cacheGeneration)return;if(request.signal.aborted)throw new DOMException('Aborted','AbortError');
    reading=false;clearTimeout(timer);
    reviewCounts.set(cell.row[0],result.total);syncReviewCount(cell);
    if(!reviewsOpen(cell)||!await renderAllReviews(cell,result,state,request))return;
    cell.reviewLoaded=true;if(!state.stopped)uiText(cell.note,'');
  }catch(error){
    retry=!refresh&&reading&&!state.stopped&&!cell.retired&&!cell.reviewRetried&&(timedOut||!request.signal.aborted&&error instanceof TypeError);
    if(retry)cell.reviewRetried=true;
    else if(!state.stopped&&!cell.retired){
      cell.reviewError=timedOut?m("Reading reviews timed out."):error instanceof TypeError?m("Cannot reach SpinShare reviews."):errorText(error);
      changeReviewContent(cell,()=>{cell.list.replaceChildren();pruneEntries();uiText(cell.summary,m("Reviews unavailable"));uiText(cell.note,cell.reviewError+m(" Select Refresh reviews to retry."));});
    }
  }finally{
    clearTimeout(timer);state.controllers.delete(request);
    if(cell.request===request){
      cell.request=null;cell.pending=false;loadingIndicator(cell.summary,false);
      if(!state.stopped&&!cell.retired){cell.target.setAttribute('aria-busy','false');syncReviewCount(cell);}
      if(!state.stopped&&retry)queueReviews(cell,state);
    }
    releaseReviewRefresh(refreshOwner);syncReviewRefresh();
  }
}
