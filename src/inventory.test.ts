import{describe,expect,it}from'vitest';
import{createSession,foundCount,isComplete,itemSeq,markFound,parseSessions,scanArchiveNo}from'./inventory';
import type{Archive,InventorySession}from'./types';

const a=(x:Partial<Archive>):Archive=>({id:'1',archiveNo:'A-1',title:'年度总结',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:'',...x});
const sessionOf=(xs:Archive[],box='B1'):InventorySession=>{const s=createSession(xs,box);if('error'in s)throw new Error('不应失败');return s};

describe('盒内盘点会话',()=>{
 it('创建会话保存盒号、创建时间与盒内档案快照，会话项独立标识并保留来源档案标识',()=>{
  const xs=[a({id:'arc-1',archiveNo:'A-1',startPage:5,endPage:9}),a({id:'arc-2',archiveNo:'A-2',title:'纪要',startPage:1,endPage:4}),a({id:'arc-3',archiveNo:'Z-1',boxNo:'B2'})];
  const s=createSession(xs,'B1','2026-09-10T08:00:00.000Z');
  if('error'in s)throw new Error('不应失败');
  expect(s.boxNo).toBe('B1');
  expect(s.createdAt).toBe('2026-09-10T08:00:00.000Z');
  expect(s.completedAt).toBeNull();
  // 快照只含本盒，按盒内落位排序
  expect(s.items.map(i=>i.archiveNo)).toEqual(['A-2','A-1']);
  expect(s.items[0]).toMatchObject({archiveId:'arc-2',title:'纪要',startPage:1,endPage:4,found:false});
  // 独立标识：与来源档案标识不同且互不相同
  expect(s.items.every(i=>i.itemId&&i.itemId!==i.archiveId)).toBe(true);
  expect(new Set(s.items.map(i=>i.itemId)).size).toBe(2);
  // 是快照：之后改动档案登记信息不影响会话项
  xs[0].title='被改过的题名';xs[0].startPage=100;
  expect(s.items[1].title).toBe('年度总结');
  expect(s.items[1].startPage).toBe(5);
 });

 it('盒号不存在或盒内无档案时给出错误',()=>{
  expect(createSession([a({})],'NOPE')).toEqual({error:'所选盒号不存在或盒内没有档案'});
 });

 it('唯一命中按会话项标识登记为已找到，原会话不被改写',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  const out=scanArchiveNo(s,' A-2 ');
  if(out.kind!=='found')throw new Error('应唯一命中');
  expect(out.item.itemId).toBe(s.items[1].itemId);
  expect(out.item.archiveId).toBe('arc-2');
  expect(out.session.items[1].found).toBe(true);
  expect(out.session.items[0].found).toBe(false);
  // 不可变更新：原会话与计数未变
  expect(s.items.every(i=>!i.found)).toBe(true);
  expect(foundCount(s)).toBe(0);
  expect(foundCount(out.session)).toBe(1);
 });

 it('同一档号命中多件时返回各候选且不推进进度，明示选中才落到正确会话项',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'DUP',title:'甲',startPage:1,endPage:5}),a({id:'arc-2',archiveNo:'DUP',title:'乙',startPage:6,endPage:9}),a({id:'arc-3',archiveNo:'A-9',startPage:10,endPage:12})]);
  const out=scanArchiveNo(s,'DUP');
  if(out.kind!=='ambiguous')throw new Error('应歧义');
  expect(out.candidates.map(c=>[itemSeq(s,c),c.title])).toEqual([[1,'甲'],[2,'乙']]);
  // 快照与计数未变
  expect(foundCount(s)).toBe(0);
  expect(s.items.every(i=>!i.found)).toBe(true);
  // 用户选中第二件（乙）：落到正确会话项，另一件不受影响
  const r=markFound(s,out.candidates[1].itemId);
  if('error'in r)throw new Error('不应失败');
  expect(r.item.archiveId).toBe('arc-2');
  expect(r.session.items.map(i=>i.found)).toEqual([false,true,false]);
  // 再扫描 DUP：只剩一件未找到，唯一命中第一件
  const out2=scanArchiveNo(r.session,'DUP');
  if(out2.kind!=='found')throw new Error('应唯一命中剩余项');
  expect(out2.item.archiveId).toBe('arc-1');
  expect(out2.session.items.map(i=>i.found)).toEqual([true,true,false]);
 });

 it('档号不存在与重复扫描时不改动快照和计数',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'})]);
  expect(scanArchiveNo(s,'NOPE').kind).toBe('not-found');
  expect(scanArchiveNo(s,'   ').kind).toBe('not-found');
  const hit=scanArchiveNo(s,'A-1');
  if(hit.kind!=='found')throw new Error('应命中');
  const dup=scanArchiveNo(hit.session,'A-1');
  if(dup.kind!=='duplicate')throw new Error('应判重');
  expect(dup.item.itemId).toBe(hit.item.itemId);
  expect(foundCount(hit.session)).toBe(1);
  expect(hit.session.completedAt).toBeTruthy();
 });

 it('全部命中后自动完成，完成后不再接受登记',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:11,endPage:20})]);
  const h1=scanArchiveNo(s,'A-1');if(h1.kind!=='found')throw new Error('应命中');
  expect(h1.session.completedAt).toBeNull();
  expect(isComplete(h1.session)).toBe(false);
  const h2=scanArchiveNo(h1.session,'A-2');if(h2.kind!=='found')throw new Error('应命中');
  expect(isComplete(h2.session)).toBe(true);
  expect(h2.session.completedAt).toBeTruthy();
  expect(markFound(h2.session,h2.session.items[0].itemId)).toEqual({error:'本次盘点已完成'});
 });

 it('本地存储解析：非法内容回退为空，合法会话往返保留，旧数据按空列表加载',()=>{
  expect(parseSessions(null)).toEqual([]);
  expect(parseSessions('not json')).toEqual([]);
  expect(parseSessions('{"x":1}')).toEqual([]);
  expect(parseSessions('[{"id":1}]')).toEqual([]);
  const s=sessionOf([a({id:'arc-1'})]);
  const round=parseSessions(JSON.stringify([s,{broken:true}]));
  expect(round).toHaveLength(1);
  expect(round[0]).toEqual(s);
 });
});
