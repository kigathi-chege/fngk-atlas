type UrlOpener=(url:string)=>Promise<void>;

export async function openExternalHttps(value:string,open:UrlOpener):Promise<void>{
  let url:URL;
  try{url=new URL(value)}catch{throw new Error('The authorization URL is invalid.')}
  const local=url.hostname==='localhost'||url.hostname.endsWith('.localhost')||url.hostname==='127.0.0.1'||url.hostname==='[::1]';
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&local))throw new Error('The authorization URL must use HTTPS.')
  await open(url.toString());
}

export async function openAuthorizationUrl(value:string):Promise<void>{
  return openExternalHttps(value,async url=>{
    if(typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window){
      const {openUrl}=await import('@tauri-apps/plugin-opener');
      await openUrl(url);
      return;
    }
    const opened=window.open(url,'_blank','noopener,noreferrer');
    if(!opened)throw new Error('The browser blocked the authorization window. Allow pop-ups and try again.');
  });
}

/** Opens a sign-in link in a new browser tab; false when the browser blocked it. Never throws. */
export function tryOpenInBrowser(value:string):boolean{
  try{
    const url=new URL(value);
    if(url.protocol!=='https:'&&url.protocol!=='http:')return false;
    // Not 'noopener': it makes window.open return null even on success.
    const opened=window.open(url.toString(),'_blank');
    if(opened)try{opened.opener=null}catch{}
    return Boolean(opened);
  }catch{return false}
}
