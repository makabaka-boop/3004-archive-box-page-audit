import{boxOrder}from'./data';
import type{Archive,InventoryItem,InventorySession}from'./types';

// 盒内盘点：独立会话快照 + 本地存储新键，绝不改写档案登记、异常处置与连续编页数据
export const INVENTORY_KEY='archive-audit:inventory-sessions';
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;

// 创建盘点会话：保存所选盒号、创建时间与当时盒内档案的快照；
// 每个会话项生成独立标识并保留来源档案标识，此后档案登记信息如何改动都不影响本次快照；
// 快照中的位置（index+1）即盘点序号，作为期望摆放顺序，新会话尚无实物序号
export function createSession(archives:Archive[],boxNo:string,now=new Date().toISOString()):InventorySession|{error:string}{
 const inBox=archives.filter(a=>a.boxNo===boxNo).sort(boxOrder);
 if(!inBox.length)return{error:'所选盒号不存在或盒内没有档案'};
 return{id:uid(),boxNo,createdAt:now,completedAt:null,items:inBox.map(a=>({itemId:uid(),archiveId:a.id,archiveNo:a.archiveNo,title:a.title,startPage:a.startPage,endPage:a.endPage,found:false,physicalSeq:null}))};
}

export const foundCount=(s:InventorySession)=>s.items.filter(i=>i.found).length;
export const isComplete=(s:InventorySession)=>s.items.length>0&&s.items.every(i=>i.found);
// 盘点序号（期望序号）：会话项在快照中的落位（从 1 开始），用于歧义候选与清单展示
export const itemSeq=(s:InventorySession,item:InventoryItem)=>s.items.findIndex(i=>i.itemId===item.itemId)+1;
// 下一个实物序号：已分配实物序号从 1 起连续不重复，取最大值 + 1；刷新恢复后据此继续编号
export const nextPhysicalSeq=(s:InventorySession)=>s.items.reduce((m,i)=>Math.max(m,i.physicalSeq??0),0)+1;
// 旧会话（没有实物序号的记录）：已登记项缺少实物序号则无法复核摆放顺序
export const isLegacySession=(s:InventorySession)=>s.items.some(i=>i.found&&i.physicalSeq===null);
// 顺序可复核：不存在已登记但缺实物序号的旧项；仍在进行中的会话也能逐件对照
export const canVerifyOrder=(s:InventorySession)=>!s.items.some(i=>i.found&&i.physicalSeq===null);

export type OrderRow={item:InventoryItem;expectedSeq:number;physicalSeq:number|null;match:boolean};
// 按档案（快照盘点序号）展示期望序号、实物序号与一致/错位结果
export function orderRows(s:InventorySession):OrderRow[]{
 return s.items.map((item,idx)=>({item,expectedSeq:idx+1,physicalSeq:item.physicalSeq,match:item.physicalSeq===idx+1}));
}
// 首个错位位置（盘点序号）：可复核的会话中，第一件实物序号与盘点序号不一致的已登记项
export function firstMismatch(s:InventorySession):number|null{
 if(!canVerifyOrder(s))return null;
 const row=orderRows(s).find(r=>r.item.found&&r.physicalSeq!==null&&!r.match);
 return row?row.expectedSeq:null;
}

// 登记命中：仅在唯一命中或歧义候选确认成功时调用，分配下一个递增且不重复的实物序号；全部命中时自动完成
const stamp=(s:InventorySession,itemId:string,now:string):InventorySession=>{
 const seq=nextPhysicalSeq(s);
 const next:InventorySession={...s,items:s.items.map(i=>i.itemId===itemId?{...i,found:true,physicalSeq:seq}:i)};
 return isComplete(next)?{...next,completedAt:now}:next;
};

// 按会话项标识登记为已找到并落实物序号；全部命中时自动完成。只返回新的盘点快照，不触碰档案登记数据
export function markFound(session:InventorySession,itemId:string,now=new Date().toISOString()):{session:InventorySession;item:InventoryItem}|{error:string}{
 if(session.completedAt)return{error:'本次盘点已完成'};
 const item=session.items.find(i=>i.itemId===itemId);
 if(!item)return{error:'盘点项不存在'};
 if(item.found)return{error:'该盘点项已登记为已找到'};
 return{session:stamp(session,itemId,now),item};
}

export type ScanOutcome=
 |{kind:'found';session:InventorySession;item:InventoryItem}
 |{kind:'ambiguous';candidates:InventoryItem[];matched:number}
 |{kind:'duplicate';item:InventoryItem}
 |{kind:'not-found'};

// 扫描/录入档号：快照中仅此一件时唯一命中，直接按会话项标识登记并分配下一个实物序号；
// 同一档号在快照中有多件时一律返回未找到候选由用户明示选择——即使选中后只剩一件未找到，也不自动登记另一件，
// 用户确认候选成功时才分配序号；空输入、档号不存在、重复扫描或取消候选均不分配序号，原序列保持不变
export function scanArchiveNo(session:InventorySession,raw:string,now=new Date().toISOString()):ScanOutcome{
 const no=raw.trim();
 if(!no)return{kind:'not-found'};
 const matched=session.items.filter(i=>i.archiveNo===no);
 if(!matched.length)return{kind:'not-found'};
 const pending=matched.filter(i=>!i.found);
 if(!pending.length)return{kind:'duplicate',item:matched[0]};
 if(matched.length>1)return{kind:'ambiguous',candidates:pending,matched:matched.length};
 return{kind:'found',session:stamp(session,pending[0].itemId,now),item:pending[0]};
}

// 本地存储解析：非法或残缺内容直接丢弃，旧数据（无此键）按空列表加载；
// 旧版会话项没有实物序号时归一化为 null（照常显示进度但无法复核顺序）；实物序号重复或非法的整条会话丢弃
const validItem=(x:unknown):x is Omit<InventoryItem,'physicalSeq'>&{physicalSeq:unknown}=>{if(!x||typeof x!=='object')return false;const i=x as Record<string,unknown>;return['itemId','archiveId','archiveNo','title'].every(k=>typeof i[k]==='string')&&Number.isInteger(i.startPage)&&Number.isInteger(i.endPage)&&typeof i.found==='boolean'&&(i.physicalSeq===undefined||i.physicalSeq===null||typeof i.physicalSeq==='number')};
export function parseSessions(text:string|null):InventorySession[]{
 if(!text)return[];
 let x:unknown;
 try{x=JSON.parse(text)}catch{return[]}
 if(!Array.isArray(x))return[];
 return x.filter((raw):raw is InventorySession=>{
  if(!raw||typeof raw!=='object')return false;
  const v=raw as Record<string,unknown>;
  if(!(typeof v.id==='string'&&typeof v.boxNo==='string'&&typeof v.createdAt==='string'&&(v.completedAt===null||typeof v.completedAt==='string')&&Array.isArray(v.items)&&v.items.every(validItem)))return false;
  const seqs=(v.items as Array<Record<string,unknown>>).map(i=>i.physicalSeq).filter((q):q is number=>typeof q==='number');
  if(seqs.some(q=>!Number.isInteger(q)||q<1))return false;
  return new Set(seqs).size===seqs.length;
 }).map(s=>({...s,items:s.items.map(i=>({...i,physicalSeq:i.physicalSeq??null}))}));
}
