export type Archive={id:string;archiveNo:string;title:string;year:number;retention:string;boxNo:string;startPage:number;endPage:number;declaredPages:number;note:string};
export type IssueKind='duplicate'|'reversed'|'count'|'overlap';
export type Issue={key:string;archiveId:string;archiveNo:string;pages:string;kind:IssueKind;reason:string};
export type Resolution={status:'fixed'|'kept';note:string};
export type Resolutions=Record<string,Resolution>;
export type Backup={version:1;exportedAt:string;archives:Archive[];resolutions:Resolutions};
// 实物序号 physicalSeq：命中登记时从 1 递增、不可重复的实物摆放次序；旧会话记录没有该字段（null），无法复核顺序
export type InventoryItem={itemId:string;archiveId:string;archiveNo:string;title:string;startPage:number;endPage:number;found:boolean;physicalSeq:number|null};
export type InventorySession={id:string;boxNo:string;createdAt:string;completedAt:string|null;items:InventoryItem[]};
// 借阅记录：以记录为核心对象，保存借出时的档案快照（档号、题名、盒号、页码）、查阅人、借出时间、预计归还日与归还时间；
// 此后档案被编辑或删除都不影响已产生的借阅历史
export type BorrowRecord={id:string;archiveId:string;archiveNo:string;title:string;boxNo:string;startPage:number;endPage:number;borrower:string;borrowedAt:string;dueDate:string;returnedAt:string|null};
