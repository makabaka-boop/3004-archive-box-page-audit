import{boxOrder}from'./data';
import type{Archive,InventoryItem,InventorySession}from'./types';

// 盒内盘点：独立会话快照 + 本地存储新键，绝不改写档案登记、异常处置与连续编页数据
export const INVENTORY_KEY='archive-audit:inventory-sessions';
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;

// 创建盘点会话：保存所选盒号、创建时间与当时盒内档案的快照；
// 每个会话项生成独立标识并保留来源档案标识，此后档案登记信息如何改动都不影响本次快照
export function createSession(archives:Archive[],boxNo:string,now=new Date().toISOString()):InventorySession|{error:string}{
 const inBox=archives.filter(a=>a.boxNo===boxNo).sort(boxOrder);
 if(!inBox.length)return{error:'所选盒号不存在或盒内没有档案'};
 return{id:uid(),boxNo,createdAt:now,completedAt:null,items:inBox.map(a=>({itemId:uid(),archiveId:a.id,archiveNo:a.archiveNo,title:a.title,startPage:a.startPage,endPage:a.endPage,found:false}))};
}

export const foundCount=(s:InventorySession)=>s.items.filter(i=>i.found).length;
export const isComplete=(s:InventorySession)=>s.items.length>0&&s.items.every(i=>i.found);
// 盘点序号：会话项在快照中的落位（从 1 开始），用于歧义候选与清单展示
export const itemSeq=(s:InventorySession,item:InventoryItem)=>s.items.findIndex(i=>i.itemId===item.itemId)+1;

const stamp=(s:InventorySession,itemId:string,now:string):InventorySession=>{
 const next:InventorySession={...s,items:s.items.map(i=>i.itemId===itemId?{...i,found:true}:i)};
 return isComplete(next)?{...next,completedAt:now}:next;
};

// 按会话项标识登记为已找到；全部命中时自动完成。只返回新的盘点快照，不触碰档案登记数据
export function markFound(session:InventorySession,itemId:string,now=new Date().toISOString()):{session:InventorySession;item:InventoryItem}|{error:string}{
 if(session.completedAt)return{error:'本次盘点已完成'};
 const item=session.items.find(i=>i.itemId===itemId);
 if(!item)return{error:'盘点项不存在'};
 if(item.found)return{error:'该盘点项已登记为已找到'};
 return{session:stamp(session,itemId,now),item};
}

export type ScanOutcome=
 |{kind:'found';session:InventorySession;item:InventoryItem}
 |{kind:'ambiguous';candidates:InventoryItem[]}
 |{kind:'duplicate';item:InventoryItem}
 |{kind:'not-found'};

// 扫描/录入档号：唯一命中直接按会话项标识登记；命中多件未找到项时返回候选，由用户明示选择；
// 档号不存在或重复扫描时不产生任何变化，快照与计数保持不变
export function scanArchiveNo(session:InventorySession,raw:string,now=new Date().toISOString()):ScanOutcome{
 const no=raw.trim();
 if(!no)return{kind:'not-found'};
 const matched=session.items.filter(i=>i.archiveNo===no);
 if(!matched.length)return{kind:'not-found'};
 const pending=matched.filter(i=>!i.found);
 if(!pending.length)return{kind:'duplicate',item:matched[0]};
 if(pending.length>1)return{kind:'ambiguous',candidates:pending};
 return{kind:'found',session:stamp(session,pending[0].itemId,now),item:pending[0]};
}

// 本地存储解析：非法或残缺内容直接丢弃，旧数据（无此键）按空列表加载
const validItem=(x:unknown):x is InventoryItem=>{if(!x||typeof x!=='object')return false;const i=x as Record<string,unknown>;return['itemId','archiveId','archiveNo','title'].every(k=>typeof i[k]==='string')&&Number.isInteger(i.startPage)&&Number.isInteger(i.endPage)&&typeof i.found==='boolean'};
export function parseSessions(text:string|null):InventorySession[]{
 if(!text)return[];
 let x:unknown;
 try{x=JSON.parse(text)}catch{return[]}
 if(!Array.isArray(x))return[];
 return x.filter((s):s is InventorySession=>{if(!s||typeof s!=='object')return false;const v=s as Record<string,unknown>;return typeof v.id==='string'&&typeof v.boxNo==='string'&&typeof v.createdAt==='string'&&(v.completedAt===null||typeof v.completedAt==='string')&&Array.isArray(v.items)&&v.items.every(validItem)});
}
