export interface SceneView {refresh():void;dispose():void}
export interface SceneViews {mount(host:HTMLElement,options?:{sceneId?:string|(()=>string);design?:boolean;onSelect?:(id:string)=>void}):SceneView}
declare module '@cordis-notebook/host' {interface ClientServices {sceneViews:SceneViews}}
