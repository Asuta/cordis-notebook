import type { ClientContext } from '@cordis-notebook/host'
import type { NarrativeComposition, NarrativeScene, NarrativeSceneCommand, NarrativeObjectSnapshot, NarrativeService } from '../../project/types/client.js'

export interface SceneField {kind:'string'|'number'|'boolean'|'character'|'asset'|'scene';label:string;default?:string|number|boolean;required?:boolean;min?:number;max?:number;maxLength?:number;multiline?:boolean;options?:(string|[string,string])[]}
export interface SceneMethodContext {
  readonly id:string;readonly props:Readonly<Record<string,unknown>>;readonly state:Readonly<Record<string,unknown>>;readonly signal:AbortSignal;
  services:{engine:NarrativeService;service:(name:string)=>unknown};
  set(next:Record<string,unknown>|((state:Record<string,unknown>)=>Record<string,unknown>)):void;
  emit(event:string,payload?:unknown):Promise<void>;call(ref:string,method:string,args?:Record<string,unknown>):Promise<unknown>;
  flags(patch:{visible?:boolean;enabled?:boolean;paused?:boolean}):void;cancel():void;current():boolean;
}
export interface SceneType {
  type:string;label:string;plugin?:string;visual?:boolean;container?:boolean;singleton?:boolean;
  fields?:Record<string,SceneField>;refs?:Record<string,string>;events?:string[];
  methods?:Record<string,{label:string;fields?:Record<string,SceneField>;run:(context:SceneMethodContext,args:Record<string,unknown>)=>unknown}>;
  initial?:(props:Record<string,unknown>)=>Record<string,unknown>;
  restore?:(state:Record<string,unknown>)=>Record<string,unknown>;interrupt?:(state:Record<string,unknown>)=>Record<string,unknown>;
}
export interface SceneRuntimeInstance {
  readonly scene:NarrativeScene;readonly pending:number;
  state(id:string):Readonly<Record<string,unknown>>;status(id:string):{visible:boolean;enabled:boolean;paused:boolean};
  snapshot():NarrativeObjectSnapshot;invoke(id:string,method:string,args?:Record<string,unknown>):Promise<unknown>;
  setFlags(id:string,patch:{visible?:boolean;enabled?:boolean;paused?:boolean}):void;
}
export type SceneTypeDescription = Omit<SceneType,'initial'|'restore'|'interrupt'|'methods'> & {methods:Record<string,{label:string;fields?:Record<string,SceneField>}>}
export interface SceneRuntimeService {
  readonly runtime:SceneRuntimeInstance|null;readonly selected:string;readonly document:NarrativeComposition;readonly playing:boolean;
  register(owner:ClientContext,descriptor:SceneType):void;descriptor(type:string):SceneType|undefined;
  types():SceneTypeDescription[];
  provide(owner:ClientContext,name:string,value:unknown):void;service(name:string):unknown;
  observe(owner:ClientContext,fn:()=>void):()=>void;select(id:string):void;switchScene(id:string):void;expanded(id?:string):NarrativeScene;
  edit(command:NarrativeSceneCommand,version?:number):NarrativeComposition;undo():void;redo():void;
  call(id:string,method:string,args?:Record<string,unknown>):Promise<unknown>;validate():string[];
}
declare module '@cordis-notebook/host' { interface ClientServices {sceneRuntime:SceneRuntimeService} }
