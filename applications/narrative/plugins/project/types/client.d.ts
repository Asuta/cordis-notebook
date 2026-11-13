import type { ClientContext } from '@cordis-notebook/host'
export interface NarrativeCondition { type: string; variable: string; op: 'gte'|'lte'|'eq'|'gt'|'lt'; value: number }
export interface NarrativeAction { type: string; [key: string]: unknown }
export interface NarrativeActionField {key:string;label:string;kind:'string'|'number'|'boolean'|'variable'|'node'|'expression'|'asset';assetKind?:'image'|'audio';default?:string|number|boolean}
export interface NarrativeActionDescriptor {type:string;label:string;fields?:NarrativeActionField[];execute:(action:NarrativeAction,payload:Record<string,unknown>)=>unknown}
export interface NarrativeStage { background: string; characterId: string; expression: string; position: number; scale: number }
export interface NarrativeNode { id: string; title: string; type: string; stage: NarrativeStage; lines: {speaker:string;text:string}[]; choices: {id:string;text:string;target:string;condition?:NarrativeCondition;actions:NarrativeAction[]}[]; next?: string; chat?:{characterId:string;prompt:string;maxTurns:number;next:string;label:string;demoReplies:string[]} }
export interface NarrativeCharacter {id:string;name:string;description:string;personality:string;portrait:string;expressions:Record<string,string>;color:string;live2d?:Record<string,unknown>;meshAvatar?:{archiveId:string;name:string;size:number}}
export interface NarrativeProject {schemaVersion:1;id:string;revision:number;title:string;description:string;template:string;startNodeId:string;characters:NarrativeCharacter[];assets:{id:string;name:string;kind:'image'|'audio';url:string;mime?:string;size?:number}[];variables:{id:string;name:string;initial:number;min:number;max:number}[];nodes:NarrativeNode[];rules:{id:string;name:string;event:string;nodeId?:string;once:boolean;condition?:NarrativeCondition;actions:NarrativeAction[]}[];settings:{dialogueStyle:'novel'|'chat';accent:string;worldInfo:string}}
export interface NarrativeRuntime {nodeId:string;lineIndex:number;text:{speaker:string;text:string};variables:Record<string,number>;stage:NarrativeStage;transcript:{id:string;role:'user'|'assistant'|'narrator';name:string;text:string}[];chatTurns:number;ended:boolean;busy:boolean;error:string;visited:string[];firedRules:string[];log:unknown[]}
export interface NarrativeChange {type:string;render?:boolean}
export interface NarrativeService {
  readonly project:NarrativeProject;readonly runtime:NarrativeRuntime|null;readonly mode:'edit'|'play';readonly selection:{nodeId:string;characterId:string};readonly status:string;readonly version:number;readonly held:boolean;
  update(fn:(p:NarrativeProject)=>void,options?:{render?:boolean}):void;select(patch:Partial<{nodeId:string;characterId:string}>):void;observe(owner:ClientContext,fn:(event:NarrativeChange)=>void):()=>void;
  asset(id:string):string;scene():NarrativeNode;transact(fn:(r:NarrativeRuntime)=>void):void;play(nodeId?:string):Promise<void>;stop():void;go(id:string):Promise<void>;advance():Promise<void>;
  registerNode(owner:ClientContext,descriptor:{type:string;label:string;color?:string;enter?:(node:NarrativeNode)=>unknown;advance?:(node:NarrativeNode)=>unknown}):void;nodeTypes():{type:string;label:string;color?:string}[];
  registerAction(owner:ClientContext,descriptor:NarrativeActionDescriptor):void;actions():NarrativeActionDescriptor[];
  registerCondition(owner:ClientContext,descriptor:{type:string;label:string;test:(condition:NarrativeCondition)=>boolean}):void;test(condition?:NarrativeCondition|null):boolean;runActions(actions:NarrativeAction[],payload?:Record<string,unknown>):Promise<void>;
  onEvent(owner:ClientContext,fn:(event:string,payload:Record<string,unknown>)=>unknown):void;emit(event:string,payload?:Record<string,unknown>):Promise<void>;
  save():Promise<void>;error(message:string):void;issues():string[];list():Promise<{id:string;title:string;nodes:number;characters:number;revision:number}[]>;open(id:string):Promise<void>;create(template:string,title?:string):Promise<NarrativeProject>;importProject(value:NarrativeProject):Promise<NarrativeProject>;exportProject():NarrativeProject;restoreRuntime(snapshot:NarrativeRuntime):void;
  registerResources(owner:ClientContext,descriptor:{id:string;prepare?:(project:NarrativeProject)=>unknown;export?:(project:NarrativeProject)=>Promise<unknown>;import:(project:NarrativeProject,bundle:unknown)=>Promise<void>}):void;
  exportBundle():Promise<NarrativeProject & {resourceBundles?:Record<string,unknown>}>;
}
declare module '@cordis-notebook/host' { interface ClientServices {narrative:NarrativeService} }
