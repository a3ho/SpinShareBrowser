const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../web/app.js'),'utf8');
const css=fs.readFileSync(require('node:path').join(__dirname,'../web/interface.css'),'utf8');
assert.match(css.match(/^\.topbar-actions\s*\{([^}]*)\}/m)?.[1]||'',/justify-self:\s*end\s*;/,'The right control group must hug its buttons, not exclude the whole stretched grid column from dragging');
assert.match(css,/\.desktop-chrome \.topbar-actions\s*\{\s*margin-inline-start:\s*24px;/,'Reserve at least 32px of drag space with the narrowest 8px grid gap');
const regionSource=source.slice(source.indexOf('let windowRegionsFrame='),source.indexOf("const dialogControls="));
const node=(left,top,width,height,parent=null)=>({offsetLeft:left,offsetTop:top,offsetWidth:width,offsetHeight:height,offsetParent:parent,closest:()=>parent?player:null,getBoundingClientRect(){throw Error('Animated bounds must not drive the native frame');}});
const brand=node(24,15,220,34),player=node(300,4,700,56),actions=node(1030,0,290,64);
player.clientLeft=player.clientTop=1;
const body=node(63,8,624,40,player),toggle=node(4,3,48,48,player),progress=node(40,22,544,18,body),retry=node(560,22,34,18,body);
retry.offsetWidth=0;
const nodes={'.brand':brand,'.topbar-actions':actions,'#preview-player-toggle':toggle,'#preview-player-progress':progress,'#preview-player-retry':retry};
const bar={offsetHeight:64,querySelector:selector=>nodes[selector]};
const frames=[],requests=[];
let modal=false,release=null;
const context=vm.createContext({document:{documentElement:{classList:{contains:()=>true}},querySelector:selector=>selector==='.topbar'?bar:selector==='dialog[open]'?modal:null},
  innerWidth:1320,innerHeight:860,requestAnimationFrame:fn=>(frames.push(fn),frames.length),
  installerRequest:async(method,path,body)=>{requests.push({method,path,body});if(release)await new Promise(resolve=>{release.resolve=resolve;});return {ok:true};}});
vm.runInContext(regionSource,context);
const run=code=>vm.runInContext(code,context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function frame(){assert.equal(frames.length,1);frames.shift()();await tick();}

(async()=>{
  for(let i=0;i<100;i++)run('scheduleWindowRegions()');
  await frame();
  assert.equal(requests.length,1);
  assert.equal(requests[0].path,'/v1/desktop/window/regions');
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].body)),{viewport:[1320,860],pixelRatio:1,headerHeight:64,excluded:[[24,15,220,34],[1030,0,290,64],[302,5,54,54],[401,32,550,24]]});
  for(let i=0;i<100;i++)run('scheduleWindowRegions()');
  await frame();assert.equal(requests.length,1,'Unchanged layouts must not send per-frame requests');
  progress.offsetWidth=0;retry.offsetWidth=34;run('scheduleWindowRegions()');await frame();
  assert.deepEqual(Array.from(requests.at(-1).body.excluded.at(-1)),[921,32,40,24],'Error state replaces the hidden seek input with the retry target, including nested borders');
  retry.offsetLeft=520;run('scheduleWindowRegions()');await frame();
  assert.equal(requests.at(-1).body.excluded.at(-1)[0],881,'A translated error label moves its retry target');
  toggle.offsetWidth=retry.offsetWidth=0;run('scheduleWindowRegions()');await frame();
  assert.equal(requests.at(-1).body.excluded.length,2,'A hidden player returns its empty area to the caption');
  modal=true;run('scheduleWindowRegions()');await frame();
  assert.equal(requests.at(-1).body.headerHeight,0,'A modal must not leave invisible caption hit targets above its backdrop');
  release={};context.innerWidth=1400;run('scheduleWindowRegions()');await frame();
  const before=requests.length;context.innerWidth=1500;
  for(let i=0;i<100;i++)run('scheduleWindowRegions()');
  await frame();assert.equal(requests.length,before,'Only one layout request may be in flight');
  const pending=release;release=null;pending.resolve();await tick();await frame();
  assert.equal(requests.length,before+1);assert.equal(requests.at(-1).body.viewport[0],1500);
  assert.equal(frames.length,0,'No perpetual animation-frame loop remains');
  const transport=[];
  Object.assign(context,{AbortController,setTimeout,clearTimeout,INSTALL_KEY:'a'.repeat(64),INSTALL_ORIGIN:'http://127.0.0.1:54901',
    m:value=>value,uiError:message=>new Error(message),readJSONResponse:async()=>({ok:true}),
    fetch:async(url,options)=>{transport.push({url,options});return {ok:true,headers:{},body:null};}});
  vm.runInContext(source.slice(source.indexOf('async function installerRequest('),source.indexOf('function installationStatePending(')),context);
  context.innerWidth=1600;run('scheduleWindowRegions()');await frame();
  assert.equal(transport.length,1,'Production installerRequest must allow the window layout endpoint');
  assert.equal(transport[0].url,'http://127.0.0.1:54901/v1/desktop/window/regions');
  assert.equal(transport[0].options.headers['X-SpinShare-Key'],'a'.repeat(64));
  assert.equal(JSON.parse(transport[0].options.body).viewport[0],1600);
  await assert.rejects(run('installerRequest("POST","/v1/desktop/window/arbitrary",{})'));
  assert.equal(transport.length,1,'The new endpoint must not permit arbitrary native commands');
  // Wide desktop: the right grid track stretches, but only the actual controls are excluded.
  Object.assign(player,node(726,4,760,56));Object.assign(actions,node(1894,0,300,64));
  toggle.offsetWidth=48;progress.offsetWidth=544;
  modal=false;context.innerWidth=2194;run('scheduleWindowRegions()');await frame();
  const wide=JSON.parse(transport.at(-1).options.body);
  const draggable=(x,y)=>y<wide.headerHeight&&!wide.excluded.some(([left,top,width,height])=>x>=left&&x<left+width&&y>=top&&y<top+height);
  assert.equal(draggable(1700,30),true,'Blank title-bar space between player and right controls remains draggable');
  assert.equal(draggable(800,25),true,'Player title and artist text can drag the window');
  assert.equal(draggable(800,42),true,'Time labels and player background can drag the window');
  assert.equal(draggable(750,30),false,'The cover button remains interactive');
  assert.equal(draggable(1000,42),false,'The seek input remains interactive');
  assert.equal(draggable(732,6),false,'Hover and entry motion stay inside the stable control exclusion');
  assert.equal(draggable(2000,30),false,'Language/settings/window controls remain interactive');
  console.log('Window regions: batching, stable geometry, modal/hidden-player transitions, coalescing and real installerRequest allowlist/authentication passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
