'use strict';
const UI_CATALOG=__SPINSHARE_UI_CATALOG__;
const UI_KEYS=Object.keys(UI_CATALOG.en),UI_KEY_INDEX=new Map(UI_KEYS.map((key,index)=>[key,index]));
const UI_PREFIX='\u0001spinshare-'+Math.random().toString(36).slice(2)+':',UI_END='\u0002';
const UI_PATTERN=new RegExp(UI_PREFIX+'(text|number):([^\u0002]*)'+UI_END,'g');
const uiBindings=new WeakMap();
let uiLanguage='zh-CN',languageBusy=false;
