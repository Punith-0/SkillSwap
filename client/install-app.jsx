import React, {useEffect, useState} from 'react';
export function InstallApp(){
  const [prompt,setPrompt]=useState(null),[installed,setInstalled]=useState(false),[help,setHelp]=useState(false);
  useEffect(()=>{
    const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    setInstalled(standalone());
    const ready=e=>{e.preventDefault();setPrompt(e)};
    const done=()=>{setInstalled(true);setPrompt(null);setHelp(false)};
    window.addEventListener('beforeinstallprompt',ready);window.addEventListener('appinstalled',done);
    if('serviceWorker' in navigator && window.isSecureContext && !location.pathname.startsWith('/projects/')) navigator.serviceWorker.register('/sw.js').catch(()=>{});
    return()=>{window.removeEventListener('beforeinstallprompt',ready);window.removeEventListener('appinstalled',done)};
  },[]);
  if(installed||location.pathname.startsWith('/projects/'))return null;
  async function install(){if(!prompt){setHelp(!help);return}await prompt.prompt();await prompt.userChoice;setPrompt(null)}
  return <div className="install-app"><button type="button" onClick={install}>Install app</button>{help&&<div className="install-help" role="status"><strong>Add SkillSwap to your home screen</strong><p>Android: open Chrome’s menu → Add to Home screen → Install.</p><p>iPhone: open Safari’s Share menu → Add to Home Screen → Add.</p><button type="button" onClick={()=>setHelp(false)}>Close</button></div>}</div>;
}
