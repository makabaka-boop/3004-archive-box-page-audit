export type Archive={id:string;archiveNo:string;title:string;year:number;retention:string;boxNo:string;startPage:number;endPage:number;declaredPages:number;note:string};
export type IssueKind='duplicate'|'reversed'|'count'|'overlap';
export type Issue={key:string;archiveId:string;archiveNo:string;pages:string;kind:IssueKind;reason:string};
export type Resolution={status:'fixed'|'kept';note:string};
export type Resolutions=Record<string,Resolution>;
export type Backup={version:1;exportedAt:string;archives:Archive[];resolutions:Resolutions};
export type InventoryItem={itemId:string;archiveId:string;archiveNo:string;title:string;startPage:number;endPage:number;found:boolean};
export type InventorySession={id:string;boxNo:string;createdAt:string;completedAt:string|null;items:InventoryItem[]};
