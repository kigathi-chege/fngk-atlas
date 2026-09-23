export interface AtlasCommand {
  id:string;
  label:string;
  keywords?:string[];
  shortcut?:string;
  enabled?:()=>boolean;
  run:()=>void|Promise<void>;
}

export class AtlasCommandRegistry {
  #commands=new Map<string,AtlasCommand>();
  #listeners=new Set<(commands:AtlasCommand[])=>void>();

  register(command:AtlasCommand){
    if(this.#commands.has(command.id))throw Object.assign(new Error(`Command ${command.id} is already registered.`),{code:'command_exists'});
    this.#commands.set(command.id,command);this.#publish();
    return()=>{if(this.#commands.delete(command.id))this.#publish()};
  }
  async execute(id:string){
    const command=this.#commands.get(id);
    if(!command)throw Object.assign(new Error(`Command ${id} was not found.`),{code:'command_not_found'});
    if(command.enabled&&!command.enabled())throw Object.assign(new Error(`Command ${id} is unavailable.`),{code:'command_unavailable'});
    await command.run();
  }
  search(query:string){
    const wanted=query.trim().toLocaleLowerCase();
    return this.#snapshot().filter(command=>!wanted||[command.label,command.id,...command.keywords??[]].some(value=>value.toLocaleLowerCase().includes(wanted)));
  }
  subscribe(listener:(commands:AtlasCommand[])=>void){this.#listeners.add(listener);listener(this.#snapshot());return()=>this.#listeners.delete(listener)}
  #snapshot(){return [...this.#commands.values()].sort((left,right)=>left.label.localeCompare(right.label))}
  #publish(){const snapshot=this.#snapshot();for(const listener of this.#listeners)listener(snapshot)}
}
