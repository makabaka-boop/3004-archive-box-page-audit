import type{Archive,BorrowRecord}from'./types';

// 借阅台：独立借阅记录 + 本地存储新键，绝不改写档案登记、异常处置与盘点会话
export const BORROW_KEY='archive-audit:borrow-records';
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;

export const isOpen=(r:BorrowRecord)=>r.returnedAt===null;
// 某件档案当前是否借出中：存在该档案标识的未归还记录
export const isBorrowed=(rs:BorrowRecord[],archiveId:string)=>rs.some(r=>r.archiveId===archiveId&&isOpen(r));

// 预计归还日须为 YYYY-MM-DD 格式的合法日历日期（拒绝 2026-02-30 之类不存在的日期）
const validDate=(s:string):boolean=>{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const[y,m,d]=s.split('-').map(Number);
 const t=new Date(Date.UTC(y,m-1,d));
 return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d;
};

// 发起借阅：以确认时刻的档案与记录现状为准——目标档案已被删除或已有未归还记录（他处借出）时拒绝；
// 查阅人空白、预计归还日非法或早于借出当天同样拒绝；任何失败都不产生记录，原记录数组不被改写。
// 成功时写入借出当时的档案快照（档号、题名、盒号、页码），此后档案改动不影响本记录
export function borrowArchive(records:BorrowRecord[],archives:Archive[],archiveId:string,borrower:string,dueDate:string,now=new Date().toISOString()):{records:BorrowRecord[];record:BorrowRecord}|{error:string}{
 const a=archives.find(x=>x.id===archiveId);
 if(!a)return{error:'目标档案已被删除，请重新选择'};
 if(isBorrowed(records,archiveId))return{error:`${a.archiveNo} 已有未归还记录，请先归还或重新选择`};
 const name=borrower.trim();
 if(!name)return{error:'请填写查阅人'};
 const due=dueDate.trim();
 if(!validDate(due))return{error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'};
 if(due<now.slice(0,10))return{error:'预计归还日不能早于借出当天'};
 const record:BorrowRecord={id:uid(),archiveId:a.id,archiveNo:a.archiveNo,title:a.title,boxNo:a.boxNo,startPage:a.startPage,endPage:a.endPage,borrower:name,borrowedAt:now,dueDate:due,returnedAt:null};
 return{records:[...records,record],record};
}

// 归还：只补写归还时间，其余字段原样；重复归还是幂等空操作，原记录（含首次归还时间）保持不变
export function returnBorrow(records:BorrowRecord[],recordId:string,now=new Date().toISOString()):{records:BorrowRecord[];record:BorrowRecord}|{error:string}{
 const r=records.find(x=>x.id===recordId);
 if(!r)return{error:'借阅记录不存在'};
 if(r.returnedAt!==null)return{records,record:r};
 const record:BorrowRecord={...r,returnedAt:now};
 return{records:records.map(x=>x.id===recordId?record:x),record};
}

const validRecord=(x:unknown):x is BorrowRecord=>{if(!x||typeof x!=='object')return false;const r=x as Record<string,unknown>;return['id','archiveId','archiveNo','title','boxNo','borrower','borrowedAt','dueDate'].every(k=>typeof r[k]==='string')&&Number.isInteger(r.startPage)&&Number.isInteger(r.endPage)&&(r.returnedAt===undefined||r.returnedAt===null||typeof r.returnedAt==='string')};
// 本地存储解析：非法或残缺内容直接丢弃，旧浏览器数据（无此键）按空列表加载；
// 缺失归还时间的旧记录归一化为 null（未归还）；同一档案出现多条未归还记录属损坏数据，只保留先读到的一条
export function parseBorrowRecords(text:string|null):BorrowRecord[]{
 if(!text)return[];
 let x:unknown;
 try{x=JSON.parse(text)}catch{return[]}
 if(!Array.isArray(x))return[];
 const out:BorrowRecord[]=[];
 const openIds=new Set<string>();
 for(const raw of x){
  if(!validRecord(raw))continue;
  const r:BorrowRecord={...raw,returnedAt:typeof raw.returnedAt==='string'?raw.returnedAt:null};
  if(isOpen(r)){if(openIds.has(r.archiveId))continue;openIds.add(r.archiveId)}
  out.push(r);
 }
 return out;
}
