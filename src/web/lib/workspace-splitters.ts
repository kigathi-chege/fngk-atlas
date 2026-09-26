import type {DockviewApi} from 'dockview';

/** Add keyboard interaction without replacing Dockview's pointer resizing. */
export function installWorkspaceSplitters(host:HTMLElement,dock:DockviewApi){
  const vertical=(sash:HTMLElement)=>Boolean(sash.parentElement?.parentElement?.classList.contains('dv-horizontal'));
  const decorate=()=>{
    for(const sash of host.querySelectorAll<HTMLElement>('.dv-sash')){
      if(!sash.getClientRects().length)continue;
      const columns=vertical(sash),box=sash.getBoundingClientRect(),container=host.getBoundingClientRect();
      sash.tabIndex=0;sash.setAttribute('role','separator');
      sash.setAttribute('aria-label',columns?'Resize workspace columns':'Resize workspace rows');
      sash.setAttribute('aria-orientation',columns?'vertical':'horizontal');
      sash.setAttribute('aria-valuemin','0');
      sash.setAttribute('aria-valuemax',String(Math.round(columns?container.width:container.height)));
      sash.setAttribute('aria-valuenow',String(Math.round(columns?box.left-container.left:box.top-container.top)));
    }
  };
  const keydown=(event:KeyboardEvent)=>{
    const sash=event.target as HTMLElement;if(!sash.matches('.dv-sash'))return;
    const columns=vertical(sash),keys=columns?['ArrowLeft','ArrowRight']:['ArrowUp','ArrowDown'];
    if(!keys.includes(event.key))return;event.preventDefault();event.stopPropagation();
    const rect=sash.getBoundingClientRect(),position=columns?rect.left:rect.top;
    const candidates=dock.groups.map(group=>({group,rect:(group as unknown as {element:HTMLElement}).element.getBoundingClientRect()}))
      .filter(item=>columns?item.rect.right<=position+8&&item.rect.bottom>rect.top&&item.rect.top<rect.bottom:item.rect.bottom<=position+8&&item.rect.right>rect.left&&item.rect.left<rect.right)
      .sort((a,b)=>columns?b.rect.right-a.rect.right:b.rect.bottom-a.rect.bottom);
    const target=candidates[0];if(!target)return;
    const delta=(event.key===keys[0]?-1:1)*(event.shiftKey?50:10);
    target.group.api.setSize(columns?{width:Math.max(80,target.rect.width+delta)}:{height:Math.max(80,target.rect.height+delta)});
    requestAnimationFrame(decorate);
  };
  const subscription=dock.onDidLayoutChange(()=>requestAnimationFrame(decorate));
  host.addEventListener('keydown',keydown);requestAnimationFrame(decorate);
  return()=>{subscription.dispose();host.removeEventListener('keydown',keydown)};
}
