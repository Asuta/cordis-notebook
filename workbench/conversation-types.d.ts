export interface Message { id?: string; turnId?: string; messageId?: string; role?: string; text?: string; [key:string]:unknown }
export interface Turn { id:string; startedAt?:number; [key:string]:unknown }
export interface Command { session_id:string; turnId?:string; [key:string]:unknown }
export interface Conversation {
  id:string; appId?:string; title?:string; revision?:number; messages:Message[]; turns?:Turn[]; commands?:Command[];
  browserVerificationEnabled?:boolean; contextUsage?:unknown; hasImages?:boolean; sessionFile?:string; running?:boolean;
}
export interface PublicThread {
  id:string; appId?:string; title?:string; revision?:number; messages?:Message[]; turns?:Turn[]; commands?:Command[];
  browserVerificationEnabled?:boolean; contextUsage?:unknown; hasImages?:boolean; canCompact?:boolean; running?:boolean;
  messageCount?:number; turnCount?:number; detailRevision?:number; history?:{before:number; end:number; total:number}; unchanged?:boolean;
}
