let sessionAccount=APP_CONFIG.session,sessionBusy=false,sessionPollTimer=null;
const SESSION_POLL_MS=2000,SESSION_POLL_LIMIT=330;
function sessionConnected(){return !!(sessionAccount&&sessionAccount.connected);}
function syncSessionControls(){
  const connected=sessionConnected();
  if(typeof syncPlaylistsUI==='function')syncPlaylistsUI();
  if(typeof syncNotificationsUI==='function')syncNotificationsUI();
  // P6: predictively load playlist data the moment the user connects.
  if(typeof fetchMyPlaylists==='function'&&sessionConnected())void fetchMyPlaylists(true);
  $('session-signed-out').hidden=connected;
  $('session-signed-in').hidden=!connected;
  if(connected){$('settings-account-name').textContent=sessionAccount.username||'';}
  $('settings-session-login').hidden=connected||sessionBusy;
  $('settings-session-logout').hidden=!connected||sessionBusy;
}
function sessionMessage(message,error=false){
  uiText($('settings-session-message'),message);
  $('settings-session-message').classList.toggle('is-error',error);
  $('settings-session-message').hidden=false;
}
function stopSessionPolling(){if(sessionPollTimer!==null){clearInterval(sessionPollTimer);sessionPollTimer=null;}}
async function fetchSessionStatus(){
  try{
    const result=await installerRequest('GET','/v1/session/status');
    if(result&&typeof result==='object'&&typeof result.connected==='boolean'){sessionAccount=result;syncSessionControls();return result;}
  }catch(error){/* keep the last confirmed state (red line 13) */}
  return null;
}
async function requestSessionLogin(){
  if(sessionBusy)return;
  sessionBusy=true;syncSessionControls();$('settings-session-message').hidden=true;
  try{
    await installerRequest('POST','/v1/session/login',{});
    sessionMessage(m('The sign-in window is open. Finish signing in there'));
    let polls=0;
    sessionPollTimer=setInterval(async()=>{
      polls+=1;
      const result=await fetchSessionStatus();
      if(result&&result.connected){
        stopSessionPolling();sessionBusy=false;syncSessionControls();$('settings-session-message').hidden=true;
      }else if(result&&!result.loginActive||polls>=SESSION_POLL_LIMIT){
        stopSessionPolling();sessionBusy=false;syncSessionControls();
        sessionMessage(m('Sign-in was cancelled or timed out'),true);
      }
    },SESSION_POLL_MS);
  }catch(error){
    stopSessionPolling();sessionBusy=false;syncSessionControls();
    sessionMessage(error.code==='session_connected'?m('Already signed in'):error.code==='session_window_unavailable'?m('The sign-in window could not open. Reopen the app window and try again'):errorText(error),true);
  }
}
async function requestSessionLogout(){
  if(sessionBusy)return;
  sessionBusy=true;syncSessionControls();
  try{
    await installerRequest('POST','/v1/session/logout',{});
    sessionAccount={connected:false,username:null,userId:null,loginActive:false};
    $('settings-session-message').hidden=true;
  }catch(error){sessionMessage(errorText(error),true);}
  sessionBusy=false;syncSessionControls();
}
function setupSession(){
  syncSessionControls();
  $('settings-session-login').addEventListener('click',()=>requestSessionLogin());
  $('settings-session-logout').addEventListener('click',()=>requestSessionLogout());
}
