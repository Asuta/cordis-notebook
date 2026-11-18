import type { ClientContext } from '@cordis-notebook/host'
export interface NarrativeCondition { type: string; variable: string; op: 'gte'|'lte'|'eq'|'gt'|'lt'; value: number }
export interface NarrativeAction { type: string; [key: string]: unknown }
export interface NarrativeActionField {key:string;label:string;kind:'string'|'number'|'boolean'|'variable'|'node'|'expression'|'asset';assetKind?:'image'|'audio';default?:string|number|boolean}
export interface NarrativeActionDescriptor {type:string;label:string;fields?:NarrativeActionField[];execute:(action:NarrativeAction,payload:Record<string,unknown>)=>unknown}
export interface NarrativeStage { background: string; characterId: string; expression: string; position: number; scale: number }
export interface NarrativeNode { id: string; title: string; type: string; stage: NarrativeStage; lines: {speaker:string;text:string}[]; choices: {id:string;text:string;target:string;condition?:NarrativeCondition;actions:NarrativeAction[]}[]; next?: string; chat?:{characterId:string;prompt:string;maxTurns:number;next:string;label:string;demoReplies:string[]} }
export interface NarrativeCharacter {id:string;name:string;description:string;personality:string;portrait:string;expressions:Record<string,string>;color:string;live2d?:Record<string,unknown>;meshAvatar?:{archiveId:string;name:string;size:number}}
export interface NarrativeProject {schemaVersion:1;id:string;revision:number;title:string;description:string;template:string;stories?:NarrativeStory[];characters:NarrativeCharacter[];assets:{id:string;name:string;kind:'image'|'audio';url:string;mime?:string;size?:number}[];settings:{dialogueStyle:'novel'|'chat';accent:string;worldInfo:string}}
export interface NarrativeStory {id:string;name:string;startNodeId:string;nodes:NarrativeNode[];variables:{id:string;name:string;initial:number;min:number;max:number}[];rules:{id:string;name:string;event:string;nodeId?:string;once:boolean;condition?:NarrativeCondition;actions:NarrativeAction[]}[]}
export interface NarrativeRuntime {busy:boolean;error:string;objects?:NarrativeObjectSnapshot}
export interface NarrativeSelection {nodeId?:string;characterId:string;storyId?:string;flowObjectId?:string;flowSceneId?:string}
export interface NarrativePlayRequest {sceneId?:string;objectId?:string;storyId?:string;nodeId?:string}

export interface NarrativeChange {type:string;render?:boolean}
export interface NarrativeService {
  readonly composition:NarrativeComposition;readonly sceneHistory:{undo:number;redo:number};
  expandScene(id:string,document?:NarrativeComposition):NarrativeScene;
  canRunObject(objects:NarrativeObject[],id:string):boolean;
  validateComposition(document:NarrativeComposition):NarrativeComposition;
  sceneCommand(command:NarrativeSceneCommand,version?:number,validate?:(document:NarrativeComposition)=>void):NarrativeComposition;
  sceneUndo():void;sceneRedo():void;
  readonly project:NarrativeProject;readonly runtime:NarrativeRuntime|null;readonly mode:'edit'|'play';readonly selection:NarrativeSelection;readonly status:string;readonly version:number;readonly held:boolean;
  update(fn:(p:NarrativeProject)=>void,options?:{render?:boolean}):void;select(patch:Partial<NarrativeSelection>):void;observe(owner:ClientContext,fn:(event:NarrativeChange)=>void):()=>void;
  prefabPresets():NarrativePrefab[];asset(id:string):string;transact(fn:(r:NarrativeRuntime)=>void):void;play(options?:string|NarrativePlayRequest):Promise<void>;stop():void;
  hasProjectFormat(id:string):boolean;
  registerProjectFormat(owner:ClientContext,descriptor:NarrativeProjectFormat):void;
  registerAction(owner:ClientContext,descriptor:NarrativeActionDescriptor):void;actions():NarrativeActionDescriptor[];
  registerCondition(owner:ClientContext,descriptor:{type:string;label:string;test:(condition:NarrativeCondition)=>boolean}):void;test(condition?:NarrativeCondition|null):boolean;runActions(actions:NarrativeAction[],payload?:Record<string,unknown>):Promise<void>;
  onEvent(owner:ClientContext,fn:(event:string,payload:Record<string,unknown>)=>unknown):void;emit(event:string,payload?:Record<string,unknown>):Promise<void>;
  save():Promise<void>;error(message:string):void;issues():string[];list():Promise<{id:string;title:string;nodes:number;characters:number;revision:number}[]>;open(id:string):Promise<void>;create(template:string,title?:string):Promise<NarrativeProject>;importProject(value:NarrativeProject):Promise<NarrativeProject>;exportProject():NarrativeProject;restoreRuntime(snapshot:NarrativeRuntime):void;
  registerRuntimeValidator(owner:ClientContext,descriptor:{id:string;validate:(snapshot:NarrativeRuntime,context:{project:NarrativeProject;composition:NarrativeComposition;restoring:boolean})=>void}):void;
  validateSave(snapshot:NarrativeRuntime,project?:NarrativeProject):void;
  registerResources(owner:ClientContext,descriptor:{id:string;prepare?:(project:NarrativeProject)=>unknown;export?:(project:NarrativeProject)=>Promise<unknown>;import:(project:NarrativeProject,bundle:unknown)=>Promise<void>}):void;
  exportBundle():Promise<NarrativeProject & {resourceBundles?:Record<string,unknown>}>;
}
declare module '@cordis-notebook/host' { interface ClientServices {narrative:NarrativeService} }

export interface NarrativeLayout {
  mode?:'column'|'row'|'grid'|'overlay'|'anchor'|'scroll';
  anchor?:'flow'|'fill'|'top-left'|'top-right'|'bottom-left'|'bottom-right'|'center';
  gap?:number;padding?:number;columns?:number;width?:number;height?:number;grow?:number;
  align?:'stretch'|'start'|'center'|'end';compact?:Omit<NarrativeLayout,'compact'>;
}
export interface NarrativeObjectOverride {props?:Record<string,unknown>;refs?:Record<string,string>;layout?:NarrativeLayout;visible?:boolean;enabled?:boolean;paused?:boolean}
export interface NarrativeObject extends NarrativeObjectOverride {id:string;name?:string;parent?:string|null;type?:string;prefab?:{id:string;version:number};overrides?:Record<string,NarrativeObjectOverride>}
export interface NarrativeConnection {id:string;source:string;event:string;target:string;method:string;args?:Record<string,unknown>;argument?:string}
export interface NarrativeScene {id:string;name:string;objects:NarrativeObject[];connections:NarrativeConnection[]}
export interface NarrativePrefab extends NarrativeScene {version:number;bindings?:Record<string,string>}
export interface NarrativeComposition {schemaVersion:1;startSceneId:string;dependencies:{id:string;version:string}[];scenes:NarrativeScene[];prefabs:NarrativePrefab[]}
export interface NarrativeSceneCommand {op:'add'|'patch'|'move'|'remove'|'clone'|'connect'|'disconnect'|'save-prefab'|'instantiate'|'unpack'|'add-scene'|'start-scene'|'rename-scene'|'batch'|'add-prefab';sceneId?:string;id?:string;commands?:NarrativeSceneCommand[];[key:string]:unknown}
export interface NarrativeObjectSnapshot {schemaVersion:1;sceneId:string;states:Record<string,Record<string,unknown>>;flags:Record<string,{visible?:boolean;enabled?:boolean;paused?:boolean}>}
export interface NarrativeProject {composition?:NarrativeComposition}
export interface NarrativeRuntime {objects?:NarrativeObjectSnapshot}
export interface NarrativeCompositionTools {defaultComposition(project:NarrativeProject):NarrativeComposition;expandScene(doc:NarrativeComposition,id:string):NarrativeScene}
export interface NarrativeProjectFormat {
  id:string;validate(project:NarrativeProject):void;
  migrate?(project:NarrativeProject,tools:NarrativeCompositionTools):void;
  diagnose?(project:NarrativeProject):string[];
  restore?(value:NarrativeRuntime,project:NarrativeProject,tools:NarrativeCompositionTools):NarrativeRuntime;
  selection?(project:NarrativeProject):Partial<NarrativeSelection>;prefabs?(project:NarrativeProject):NarrativePrefab[];
  playRequest?(value:string,selection:NarrativeSelection):NarrativePlayRequest;
}
