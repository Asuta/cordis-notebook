import type { ClientContext } from '@cordis-notebook/host'
export interface NarrativeUI {
  registerInspector(owner:ClientContext,descriptor:NarrativeInspector):void;
  inspectors(type:string):NarrativeInspector[];observeInspectors(owner:ClientContext,fn:()=>void):()=>void;
  navigate(id:string):Promise<void>;
  refresh():void;
  mountEditorToolbar?(node:HTMLElement):()=>void;
  registerPanel(owner:ClientContext,descriptor:{id:string;label:string;icon?:string;order?:number;wide?:boolean;readOnly?:boolean;beforeLeave?:()=>unknown;render:(container:HTMLElement)=>void|(()=>void)}):void;
  registerSurface(owner:ClientContext,descriptor:{id:string;order?:number;mount:(container:HTMLElement)=>void|(()=>void)}):void;
  registerToolbar(owner:ClientContext,descriptor:{id:string;label:string;icon?:string;place:'player'|'header';run:()=>unknown}):void;
}
declare module '@cordis-notebook/host' {interface ClientServices {narrativeUI:NarrativeUI}}

export interface NarrativeInspector {id:string;types:string[];render:(host:HTMLElement,context:{object:import('../../project/types/client.js').NarrativeObject;sceneId:string;patch:(value:import('../../project/types/client.js').NarrativeObjectOverride)=>void})=>void|(()=>void)}
