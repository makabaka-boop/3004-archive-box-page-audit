export type Archive={id:string;archiveNo:string;title:string;year:number;retention:string;boxNo:string;startPage:number;endPage:number;declaredPages:number;note:string};
export type IssueKind='duplicate'|'reversed'|'count'|'overlap';
export type Issue={key:string;archiveId:string;archiveNo:string;pages:string;kind:IssueKind;reason:string};
export type Resolution={status:'fixed'|'kept';note:string};
export type Resolutions=Record<string,Resolution>;
export type Backup={version:1;exportedAt:string;archives:Archive[];resolutions:Resolutions};
// 实物序号 physicalSeq：命中登记时从 1 递增、不可重复的实物摆放次序；旧会话记录没有该字段（null），无法复核顺序
export type InventoryItem={itemId:string;archiveId:string;archiveNo:string;title:string;startPage:number;endPage:number;found:boolean;physicalSeq:number|null};
export type InventorySession={id:string;boxNo:string;createdAt:string;completedAt:string|null;items:InventoryItem[]};
