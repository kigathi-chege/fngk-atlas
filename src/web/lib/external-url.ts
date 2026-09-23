type UrlOpener=(url:string)=>Promise<void>;

export async function openExternalHttps(value:string,open:UrlOpener):Promise<void>{
  let url:URL;
  try{url=new URL(value)}catch{throw new Error('The authorization URL is invalid.')}
  if(url.protocol!=='https:')throw new Error('The authorization URL must use HTTPS.')
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
