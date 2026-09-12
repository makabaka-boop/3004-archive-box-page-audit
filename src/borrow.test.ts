import{describe,expect,it}from'vitest';
import{borrowArchive,isBorrowed,parseBorrowRecords,returnBorrow}from'./borrow';
import{makeBackup,parseBackup}from'./data';
import type{Archive,BorrowRecord}from'./types';

const a=(x:Partial<Archive>):Archive=>({id:'1',archiveNo:'A-1',title:'年度总结',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:'',...x});
const NOW='2026-09-12T08:00:00.000Z';
const borrow=(records:BorrowRecord[],archives:Archive[],id:string,borrower='张三',due='2026-09-20')=>{const r=borrowArchive(records,archives,id,borrower,due,NOW);if('error'in r)throw new Error('不应失败');return r};

describe('借阅台',()=>{
 it('借出记录保存档案快照、查阅人、借出时间、预计归还日，归还时间为空，原记录数组不被改写',()=>{
  const arc=a({id:'arc-1',archiveNo:'ZK-001',title:'年度总结',boxNo:'A-01',startPage:3,endPage:9});
  const before:BorrowRecord[]=[];
  const r=borrowArchive(before,[arc],'arc-1',' 张三 ','2026-09-20',NOW);
  if('error'in r)throw new Error('不应失败');
  expect(r.record).toEqual({id:expect.any(String),archiveId:'arc-1',archiveNo:'ZK-001',title:'年度总结',boxNo:'A-01',startPage:3,endPage:9,borrower:'张三',borrowedAt:NOW,dueDate:'2026-09-20',returnedAt:null});
  expect(r.records).toHaveLength(1);
  expect(r.records[0]).toBe(r.record);
  // 不可变：传入的记录数组原样
  expect(before).toEqual([]);
  // 是快照：借出后改动档案登记信息不影响记录
  arc.title='被改过的题名';arc.boxNo='Z-99';arc.startPage=100;
  expect(r.record.title).toBe('年度总结');
  expect(r.record.boxNo).toBe('A-01');
  expect(r.record.startPage).toBe(3);
 });

 it('已有未归还记录时按档案标识拒绝重复借出，失败不产生记录；归还后可再次借出',()=>{
  const arc=a({id:'arc-1'});
  const first=borrow([],[arc],'arc-1');
  expect(isBorrowed(first.records,'arc-1')).toBe(true);
  // 同一档案再借：拒绝，记录不变
  const again=borrowArchive(first.records,[arc],'arc-1','李四','2026-09-21',NOW);
  expect(again).toEqual({error:expect.stringContaining('未归还')});
  expect(first.records).toHaveLength(1);
  // 其他档案不受影响
  const other=borrow(first.records,[arc,a({id:'arc-2',archiveNo:'A-2'})],'arc-2');
  expect(other.records).toHaveLength(2);
  // 归还后同一档案可再次借出，新记录独立
  const ret=returnBorrow(first.records,first.record.id,'2026-09-15T10:00:00.000Z');
  if('error'in ret)throw new Error('不应失败');
  expect(isBorrowed(ret.records,'arc-1')).toBe(false);
  const second=borrow(ret.records,[arc],'arc-1','李四','2026-09-25');
  expect(second.records).toHaveLength(2);
  expect(second.record.id).not.toBe(first.record.id);
  expect(second.record.returnedAt).toBeNull();
 });

 it('归还只补写归还时间，其余字段与原记录数组保持不变',()=>{
  const b=borrow([],[a({id:'arc-1'})],'arc-1');
  const ret=returnBorrow(b.records,b.record.id,'2026-09-15T10:00:00.000Z');
  if('error'in ret)throw new Error('不应失败');
  expect(ret.record).toEqual({...b.record,returnedAt:'2026-09-15T10:00:00.000Z'});
  expect(ret.records).toHaveLength(1);
  expect(ret.records[0]).toBe(ret.record);
  // 不可变：原记录与原数组未动
  expect(b.record.returnedAt).toBeNull();
  expect(b.records[0].returnedAt).toBeNull();
 });

 it('重复归还是不改变原记录的幂等操作，不存在的记录报错',()=>{
  const b=borrow([],[a({id:'arc-1'})],'arc-1');
  const r1=returnBorrow(b.records,b.record.id,'2026-09-15T10:00:00.000Z');
  if('error'in r1)throw new Error('不应失败');
  // 再次归还：原记录（含首次归还时间）原样保留，数组引用不变
  const r2=returnBorrow(r1.records,b.record.id,'2026-09-16T00:00:00.000Z');
  if('error'in r2)throw new Error('不应失败');
  expect(r2.record.returnedAt).toBe('2026-09-15T10:00:00.000Z');
  expect(r2.record).toBe(r1.record);
  expect(r2.records).toBe(r1.records);
  expect(returnBorrow(r1.records,'nope')).toEqual({error:'借阅记录不存在'});
 });

 it('查阅人为空、日期无效或早于借出当天时说明原因且不产生记录',()=>{
  const arc=a({id:'arc-1'});
  expect(borrowArchive([],[arc],'arc-1','','2026-09-20',NOW)).toEqual({error:'请填写查阅人'});
  expect(borrowArchive([],[arc],'arc-1','   ','2026-09-20',NOW)).toEqual({error:'请填写查阅人'});
  expect(borrowArchive([],[arc],'arc-1','张三','',NOW)).toEqual({error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'});
  expect(borrowArchive([],[arc],'arc-1','张三','明天',NOW)).toEqual({error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'});
  expect(borrowArchive([],[arc],'arc-1','张三','2026-9-1',NOW)).toEqual({error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'});
  expect(borrowArchive([],[arc],'arc-1','张三','2026-13-01',NOW)).toEqual({error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'});
  expect(borrowArchive([],[arc],'arc-1','张三','2026-02-30',NOW)).toEqual({error:'预计归还日无效，请使用 YYYY-MM-DD 格式的有效日期'});
  expect(borrowArchive([],[arc],'arc-1','张三','2026-09-11',NOW)).toEqual({error:'预计归还日不能早于借出当天'});
  expect(borrowArchive([],[arc],'arc-1','张三','2025-12-31',NOW)).toEqual({error:'预计归还日不能早于借出当天'});
  // 借出当天与更晚日期均可
  expect('error'in borrowArchive([],[arc],'arc-1','张三','2026-09-12',NOW)).toBe(false);
  expect('error'in borrowArchive([],[arc],'arc-1','张三','2026-09-13',NOW)).toBe(false);
 });

 it('目标档案在确认前被删除时提示重新选择，不产生记录',()=>{
  expect(borrowArchive([],[],'ghost','张三','2026-09-20',NOW)).toEqual({error:'目标档案已被删除，请重新选择'});
 });

 it('本地存储解析：非法内容回退为空，合法记录往返保留，旧浏览器数据按空列表加载',()=>{
  expect(parseBorrowRecords(null)).toEqual([]);
  expect(parseBorrowRecords('not json')).toEqual([]);
  expect(parseBorrowRecords('{"x":1}')).toEqual([]);
  expect(parseBorrowRecords('[{"id":1}]')).toEqual([]);
  expect(parseBorrowRecords('[{"id":"x","archiveId":"a"}]')).toEqual([]);
  const b=borrow([],[a({id:'arc-1'})],'arc-1');
  const ret=returnBorrow(b.records,b.record.id,'2026-09-15T10:00:00.000Z');
  if('error'in ret)throw new Error('不应失败');
  const round=parseBorrowRecords(JSON.stringify([...ret.records,{broken:true}]));
  expect(round).toEqual(ret.records);
 });

 it('损坏数据中同一档案的多条未归还记录只保留先读到的一条，缺失归还时间归一化为未归还',()=>{
  const b=borrow([],[a({id:'arc-1'})],'arc-1');
  const dup={...b.record,id:'other-id',borrower:'李四'};
  const round=parseBorrowRecords(JSON.stringify([b.record,dup]));
  expect(round).toHaveLength(1);
  expect(round[0].id).toBe(b.record.id);
  // 旧数据缺 returnedAt 字段：按未归还加载
  const legacy=JSON.parse(JSON.stringify(b.record))as Record<string,unknown>;
  delete legacy.returnedAt;
  const round2=parseBorrowRecords(JSON.stringify([legacy]));
  expect(round2).toHaveLength(1);
  expect(round2[0].returnedAt).toBeNull();
 });

 it('JSON 备份往返不携带借阅记录：导出不含、恢复结果也不引入借阅数据',()=>{
  const b=borrow([],[a({id:'arc-1'})],'arc-1');
  expect(b.records).toHaveLength(1);
  // 备份只含档案与处置，借阅记录不在备份结构中
  const backup=makeBackup([a({})],{});
  expect(Object.keys(backup).sort()).toEqual(['archives','exportedAt','resolutions','version']);
  const restored=parseBackup(JSON.stringify(backup));
  expect(Object.keys(restored).sort()).toEqual(['archives','exportedAt','resolutions','version']);
  expect('borrows'in restored).toBe(false);
  // 往返之后既有借阅记录原样保留（恢复不触碰借阅存储）
  expect(b.records[0].returnedAt).toBeNull();
 });
});
