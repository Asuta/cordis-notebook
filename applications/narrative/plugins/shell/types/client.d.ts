import type { ClientContext } from '@cordis-notebook/host'
export interface NarrativeUI {
  registerPanel(owner:ClientContext,descriptor:{id:string;label:string;icon?:string;order?:number;wide?:boolean;beforeLeave?:()=>unknown;render:(container:HTMLElement)=>void|(()=>void)}):void;
  registerSurface(owner:ClientContext,descriptor:{id:string;order?:number;mount:(container:HTMLElement)=>void|(()=>void)}):void;
  registerToolbar(owner:ClientContext,descriptor:{id:string;label:string;icon?:string;place:'player'|'header';run:()=>unknown}):void;
  navigate(id:string):Promise<void>;refresh():void;
}
declare module '@cordis-notebook/host' {interface ClientServices {narrativeUI:NarrativeUI}}
