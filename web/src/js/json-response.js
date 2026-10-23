async function readJSONResponse(response,limit,onProgress){
  if(!response.ok)throw uiError(m("SpinShare is unavailable (")+response.status+m("). Try again later."));
  if(Number(response.headers.get('Content-Length'))>limit){await response.body?.cancel();throw uiError(m("This response is too large. Open SpinShare to view it."));}
  if(!response.body)throw uiError(m("Empty response. Try again."));
  const reader=response.body.getReader(),decoder=new TextDecoder(),parts=[];let bytes=0,lastProgress=0;
  try{
    while(true){
      const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
      if(bytes>limit){await reader.cancel();throw uiError(m("This response is too large. Open SpinShare to view it."));}
      parts.push(decoder.decode(chunk.value,{stream:true}));
      if(onProgress&&Date.now()-lastProgress>=250){lastProgress=Date.now();onProgress(bytes);}
    }
  }finally{reader.releaseLock();}
  parts.push(decoder.decode());
  try{return JSON.parse(parts.join(''));}catch{throw uiError(m("Loading failed. Please try again."));}
}
