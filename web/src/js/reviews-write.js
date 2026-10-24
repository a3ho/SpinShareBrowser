let reviewComposeBusy=false;
function myReviewIdentity(){return sessionConnected()&&APP_CONFIG.session&&Number.isInteger(APP_CONFIG.session.userId)?APP_CONFIG.session:null;}
function findMyReview(cell){
  const identity=myReviewIdentity();if(!identity)return null;
  const cached=reviewCache.get(cell.row[0]);
  if(!cached)return null;
  return cached.items.find(item=>item.user&&item.user.id===identity.userId)||null;
}
function ensureReviewCompose(cell){
  let host=cell.body.querySelector('.review-compose');
  if(!host){
    host=element('div',undefined,'review-compose');
    cell.body.insertBefore(host,cell.note);
    cell.compose=host;
  }
  return host;
}
function renderReviewCompose(cell){
  const host=ensureReviewCompose(cell);
  const identity=myReviewIdentity();
  if(!identity){host.hidden=true;host.replaceChildren();return;}
  host.hidden=false;
  const mine=findMyReview(cell);
  host.replaceChildren();
  if(!mine&&cell.row[8]&&cell.row[8].uploader===identity.userId){
    // The server silently ignores reviews on your own charts (SongController).
    const own=element('p',undefined,'review-compose-note');
    uiText(own,m('You cannot review your own chart'));
    host.append(own);
    return;
  }
  if(mine){
    const row=element('div',undefined,'review-compose-mine');
    const badge=element('span',undefined,'review-compose-badge');
    uiText(badge,mine.recommended===true?m('Your recommendation'):mine.recommended===false?m('Your non-recommendation'):m('Your review'));
    const remove=element('button',undefined,'review-compose-remove');
    remove.type='button';remove.append(element('span',m('Delete review')));
    uiAttr(remove,'aria-label',m('Delete your review of ')+cell.row[1]);
    remove.addEventListener('click',()=>{
      if(reviewComposeBusy)return;
      if(!remove.dataset.armed){
        remove.dataset.armed='1';uiText(remove.firstChild,m('Confirm delete review'));
        remove._timer=setTimeout(()=>{delete remove.dataset.armed;uiText(remove.firstChild,m('Delete review'));},3200);
        return;
      }
      clearTimeout(remove._timer);delete remove.dataset.armed;
      void deleteMyReview(cell,mine,remove);
    });
    row.append(badge,remove);host.append(row);
    return;
  }
  const form=element('form',undefined,'review-compose-form');
  form.noValidate=true;
  const recommend=element('div',undefined,'review-compose-verdict');
  recommend.setAttribute('role','radiogroup');
  uiAttr(recommend,'aria-label',m('Your verdict'));
  let recommended=true;
  const up=element('button',undefined,'review-verdict-btn is-up');
  up.type='button';up.setAttribute('role','radio');up.setAttribute('aria-checked','true');
  up.append(element('span',m('Recommended')));
  const down=element('button',undefined,'review-verdict-btn is-down');
  down.type='button';down.setAttribute('role','radio');down.setAttribute('aria-checked','false');
  down.append(element('span',m('Not recommended')));
  const setVerdict=value=>{recommended=value;up.setAttribute('aria-checked',String(value));down.setAttribute('aria-checked',String(!value));up.classList.toggle('is-selected',value);down.classList.toggle('is-selected',!value);};
  up.addEventListener('click',()=>setVerdict(true));
  down.addEventListener('click',()=>setVerdict(false));
  setVerdict(true); // default: recommended
  recommend.append(up,down);
  const text=element('textarea',undefined,'review-compose-text');
  text.rows=3;text.maxLength=2000;
  uiAttr(text,'aria-label',m('Write a review')+": "+cell.row[1]);
  text.placeholder=m('Write about the flow, difficulty or the patterns of the chart');
  const actions=element('div',undefined,'review-compose-actions');
  const submit=element('button',undefined,'button primary');
  submit.type='submit';submit.append(element('span',m('Post review')));
  uiAttr(submit,'aria-label',m('Post review for ')+cell.row[1]);
  actions.append(submit);
  const note=element('p',undefined,'review-compose-note');
  note.setAttribute('role','status');note.hidden=true;
  form.append(recommend,text,actions);
  host.append(form,note);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(reviewComposeBusy)return;
    const comment=text.value.trim();
    if(!comment){uiText(note,m('Write a review first'));note.hidden=false;note.classList.remove('is-error');return;}
    reviewComposeBusy=true;submit.disabled=true;
    uiText(note,m('Posting…'));note.hidden=false;note.classList.remove('is-error');
    try{
      const result=await installerRequest('POST','/v1/reviews/add',{songId:cell.row[0],recommended,comment});
      if(!result?.review||!Number.isInteger(result.review.reviewId))throw uiError(m('Review could not be posted'));
      reviewCache.delete(cell.row[0]);
      const identityNow=myReviewIdentity();
      const item={id:result.review.reviewId,user:{id:identityNow.userId,name:identityNow.username||'',avatar:'',verified:false,patron:false,pronouns:''},
        text:comment,date:new Date().toISOString().slice(0,19).replace('T',' '),timezone:'UTC',recommended};
      const article=reviewElement(item);
      article.dataset.reviewId=String(item.id);
      cell.list.prepend(article);pruneEntries();
      reviewCounts.set(cell.row[0],(reviewCounts.get(cell.row[0])||0)+1);syncReviewCount(cell);
      note.hidden=true;text.value='';
      renderReviewCompose(cell);
    }catch(error){
      uiText(note,errorText(error));note.hidden=false;note.classList.add('is-error');
      if(error.code==='session_expired'){sessionAccount={connected:false,username:null,userId:null,loginActive:false};syncSessionControls();}
    }
    reviewComposeBusy=false;submit.disabled=false;
  });
}
function syncReviewCompose(cell){renderReviewCompose(cell);}
async function deleteMyReview(cell,mine,remove){
  reviewComposeBusy=true;remove.disabled=true;
  try{
    await installerRequest('POST','/v1/reviews/delete',{songId:cell.row[0],reviewId:mine.id});
    reviewCache.delete(cell.row[0]);
    const article=cell.list.querySelector('[data-review-id="'+mine.id+'"]');
    if(article)article.remove();
    reviewCounts.set(cell.row[0],Math.max(0,(reviewCounts.get(cell.row[0])||1)-1));syncReviewCount(cell);
    renderReviewCompose(cell);
  }catch(error){
    uiText(remove.firstChild,errorText(error));
    if(error.code==='session_expired'){sessionAccount={connected:false,username:null,userId:null,loginActive:false};syncSessionControls();}
    remove.disabled=false;
  }
  reviewComposeBusy=false;
}
