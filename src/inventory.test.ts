import{describe,expect,it}from'vitest';
import{canVerifyOrder,createSession,firstMismatch,foundCount,isComplete,isLegacySession,itemSeq,markFound,nextPhysicalSeq,orderRows,parseSessions,scanArchiveNo}from'./inventory';
import type{Archive,InventoryItem,InventorySession}from'./types';

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
  expect(s.items[0]).toMatchObject({archiveId:'arc-2',title:'纪要',startPage:1,endPage:4,found:false,physicalSeq:null});
  // 独立标识：与来源档案标识不同且互不相同
  expect(s.items.every(i=>i.itemId&&i.itemId!==i.archiveId)).toBe(true);
  expect(new Set(s.items.map(i=>i.itemId)).size).toBe(2);
  // 新会话没有实物序号，期望顺序即快照盘点序号
  expect(s.items.every(i=>i.physicalSeq===null)).toBe(true);
  // 是快照：之后改动档案登记信息不影响会话项
  xs[0].title='被改过的题名';xs[0].startPage=100;
  expect(s.items[1].title).toBe('年度总结');
  expect(s.items[1].startPage).toBe(5);
 });

 it('盒号不存在或盒内无档案时给出错误',()=>{
  expect(createSession([a({})],'NOPE')).toEqual({error:'所选盒号不存在或盒内没有档案'});
 });

 it('唯一命中按会话项标识登记为已找到，并从 1 开始分配递增不重复的实物序号，原会话不被改写',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  const out=scanArchiveNo(s,' A-2 ');
  if(out.kind!=='found')throw new Error('应唯一命中');
  expect(out.item.itemId).toBe(s.items[1].itemId);
  expect(out.item.archiveId).toBe('arc-2');
  expect(out.session.items[1].found).toBe(true);
  expect(out.session.items[1].physicalSeq).toBe(1);
  expect(out.session.items[0].found).toBe(false);
  expect(out.session.items[0].physicalSeq).toBeNull();
  // 连续扫描按命中先后依次落位 1、2
  const out2=scanArchiveNo(out.session,'A-1');
  if(out2.kind!=='found')throw new Error('应唯一命中');
  expect(out2.session.items.map(i=>i.physicalSeq)).toEqual([2,1]);
  expect(new Set(out2.session.items.map(i=>i.physicalSeq)).size).toBe(2);
  // 不可变更新：原会话与计数未变
  expect(s.items.every(i=>!i.found)).toBe(true);
  expect(s.items.every(i=>i.physicalSeq===null)).toBe(true);
  expect(foundCount(s)).toBe(0);
  expect(foundCount(out.session)).toBe(1);
 });

 it('同一档号命中多件时返回各候选且不推进进度，明示选中才落到正确会话项',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'DUP',title:'甲',startPage:1,endPage:5}),a({id:'arc-2',archiveNo:'DUP',title:'乙',startPage:6,endPage:9}),a({id:'arc-3',archiveNo:'A-9',startPage:10,endPage:12})]);
  const out=scanArchiveNo(s,'DUP');
  if(out.kind!=='ambiguous')throw new Error('应歧义');
  expect(out.candidates.map(c=>[itemSeq(s,c),c.title])).toEqual([[1,'甲'],[2,'乙']]);
  // 快照与计数未变，且未消耗实物序号
  expect(foundCount(s)).toBe(0);
  expect(s.items.every(i=>!i.found)).toBe(true);
  expect(s.items.every(i=>i.physicalSeq===null)).toBe(true);
  // 用户选中第二件（乙）：落到正确会话项并取得实物序号 1，另一件不受影响
  const r=markFound(s,out.candidates[1].itemId);
  if('error'in r)throw new Error('不应失败');
  expect(r.item.archiveId).toBe('arc-2');
  expect(r.session.items.map(i=>i.found)).toEqual([false,true,false]);
  expect(r.session.items.map(i=>i.physicalSeq)).toEqual([null,1,null]);
  // 再扫描 DUP：虽只剩一件未找到，仍返回候选要求明示选择，不自动登记
  const out2=scanArchiveNo(r.session,'DUP');
  if(out2.kind!=='ambiguous')throw new Error('仍应要求明示选择');
  expect(out2.matched).toBe(2);
  expect(out2.candidates.map(c=>c.archiveId)).toEqual(['arc-1']);
  expect(foundCount(r.session)).toBe(1);
  const r2=markFound(r.session,out2.candidates[0].itemId);
  if('error'in r2)throw new Error('不应失败');
  expect(r2.session.items.map(i=>i.found)).toEqual([true,true,false]);
  // 歧义确认依次落位：第二件确认的实物序号继续递增为 2
  expect(r2.session.items.map(i=>i.physicalSeq)).toEqual([2,1,null]);
 });

 it('同一档号有多件时，选中一件后再次扫描仍须明示选择，不自动登记另一件',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'DUP',title:'甲',startPage:1,endPage:5}),a({id:'arc-2',archiveNo:'DUP',title:'乙',startPage:6,endPage:9})]);
  const first=scanArchiveNo(s,'DUP');
  if(first.kind!=='ambiguous')throw new Error('应歧义');
  const r=markFound(s,first.candidates[0].itemId);
  if('error'in r)throw new Error('不应失败');
  // 再次扫描同一档号：剩余那件不自动登记，仍给出候选
  const again=scanArchiveNo(r.session,'DUP');
  if(again.kind!=='ambiguous')throw new Error('仍应歧义而非自动登记');
  expect(again.candidates).toHaveLength(1);
  expect(again.candidates[0].archiveId).toBe('arc-2');
  expect(foundCount(r.session)).toBe(1);
  // 两件都找到后再扫描 → 重复扫描
  const r2=markFound(r.session,again.candidates[0].itemId);
  if('error'in r2)throw new Error('不应失败');
  expect(r2.session.completedAt).toBeTruthy();
  expect(scanArchiveNo(r2.session,'DUP').kind).toBe('duplicate');
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

 it('空输入、不存在、重复扫描与取消候选均不消耗实物序号，序号只在命中成功时递增',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'DUP',title:'甲'}),a({id:'arc-3',archiveNo:'DUP',title:'乙',startPage:20,endPage:25})]);
  // 空输入与不存在：序列保持全空
  expect(scanArchiveNo(s,'   ').kind).toBe('not-found');
  expect(scanArchiveNo(s,'NOPE').kind).toBe('not-found');
  expect(s.items.every(i=>i.physicalSeq===null)).toBe(true);
  // 歧义出现但用户取消（不调用确认）：同样不消耗序号
  const amb=scanArchiveNo(s,'DUP');
  if(amb.kind!=='ambiguous')throw new Error('应歧义');
  expect(amb.candidates).toHaveLength(2);
  // 随后唯一命中：取得的仍是实物序号 1，可见取消候选没有消耗序号
  const h=scanArchiveNo(s,'A-1');
  if(h.kind!=='found')throw new Error('应命中');
  expect(h.session.items[0].physicalSeq).toBe(1);
  // 重复扫描不消耗序号
  expect(scanArchiveNo(h.session,'A-1').kind).toBe('duplicate');
  expect(scanArchiveNo(h.session,'NOPE').kind).toBe('not-found');
  // 再确认歧义候选：接续编号为 2，而不是 3
  const amb2=scanArchiveNo(h.session,'DUP');
  if(amb2.kind!=='ambiguous')throw new Error('应歧义');
  const r=markFound(h.session,amb2.candidates[0].itemId);
  if('error'in r)throw new Error('不应失败');
  expect(r.session.items.find(i=>i.archiveNo==='DUP'&&i.title==='甲')?.physicalSeq).toBe(2);
  const taken=r.session.items.flatMap(i=>i.physicalSeq===null?[]:[i.physicalSeq]).sort((x,y)=>x-y);
  expect(taken).toEqual([1,2]);
 });

 it('刷新恢复后从快照继续编号，实物序号始终从 1 起连续不重复',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25}),a({id:'arc-3',archiveNo:'A-3',startPage:30,endPage:35})]);
  const h1=scanArchiveNo(s,'A-2');if(h1.kind!=='found')throw new Error('应命中');
  const h2=scanArchiveNo(h1.session,'A-1');if(h2.kind!=='found')throw new Error('应命中');
  // 模拟写入本地存储后刷新：解析恢复并继续编号
  const restored=parseSessions(JSON.stringify([h2.session]))[0];
  expect(restored.items.map(i=>i.physicalSeq)).toEqual([2,1,null]);
  const h3=scanArchiveNo(restored,'A-3');if(h3.kind!=='found')throw new Error('应命中');
  expect(h3.session.items.map(i=>i.physicalSeq)).toEqual([2,1,3]);
  expect(new Set(h3.session.items.map(i=>i.physicalSeq)).size).toBe(3);
 });

 it('完成后按档案展示期望序号、实物序号与一致/错位结果，并汇总首个错位位置',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25}),a({id:'arc-3',archiveNo:'A-3',startPage:30,endPage:35})]);
  // 与快照顺序一致：全部一致
  const inOrder=['A-1','A-2','A-3'].reduce<InventorySession>((cur,no)=>{const o=scanArchiveNo(cur,no);if(o.kind!=='found')throw new Error('应命中');return o.session},s);
  expect(inOrder.items.every(i=>i.found)).toBe(true);
  expect(orderRows(inOrder).map(r=>[r.expectedSeq,r.physicalSeq,r.match])).toEqual([[1,1,true],[2,2,true],[3,3,true]]);
  expect(firstMismatch(inOrder)).toBeNull();
  // 乱序扫描：先扫第 3 件、再扫第 1 件、再扫第 2 件
  const mixed=['A-3','A-1','A-2'].reduce<InventorySession>((cur,no)=>{const o=scanArchiveNo(cur,no);if(o.kind!=='found')throw new Error('应命中');return o.session},s);
  expect(orderRows(mixed).map(r=>[r.expectedSeq,r.physicalSeq,r.match])).toEqual([[1,2,false],[2,3,false],[3,1,false]]);
  // 首个错位位置：第 1 项（实物序号为 2）
  expect(firstMismatch(mixed)).toBe(1);
  // 仅尾部错位时首项仍报真实错位位置
  const tail=['A-1','A-3','A-2'].reduce<InventorySession>((cur,no)=>{const o=scanArchiveNo(cur,no);if(o.kind!=='found')throw new Error('应命中');return o.session},s);
  expect(orderRows(tail).map(r=>r.match)).toEqual([true,false,false]);
  expect(firstMismatch(tail)).toBe(2);
 });

 it('没有实物序号的旧会话照常解析显示原进度，但明确无法复核顺序',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  // 旧记录：item 没有 physicalSeq 字段，且已有进度
  const legacyRaw=s.items.map(i=>{const copy:InventoryItem={...i,found:true};delete(copy as Partial<InventoryItem>).physicalSeq;return copy});
  const legacy={...s,completedAt:'2026-09-10T09:00:00.000Z',items:legacyRaw};
  const round=parseSessions(JSON.stringify([legacy]));
  expect(round).toHaveLength(1);
  const restored=round[0];
  // 归一化为 null，原进度照常
  expect(restored.items.every(i=>i.found)).toBe(true);
  expect(restored.items.every(i=>i.physicalSeq===null)).toBe(true);
  expect(foundCount(restored)).toBe(2);
  expect(restored.completedAt).toBeTruthy();
  // 明确无法复核顺序，不错误报错位
  expect(isLegacySession(restored)).toBe(true);
  expect(canVerifyOrder(restored)).toBe(false);
  expect(firstMismatch(restored)).toBeNull();
  expect(orderRows(restored).map(r=>r.match)).toEqual([false,false]);
  // 尚未登记任何项的旧会话不算缺序，仍可复核（新登记项会有序号）
  const fresh=parseSessions(JSON.stringify([s]))[0];
  expect(isLegacySession(fresh)).toBe(false);
  expect(canVerifyOrder(fresh)).toBe(true);
 });

 it('重新盘点生成全新会话与全新实物序号序列',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  const h=scanArchiveNo(s,'A-2');if(h.kind!=='found')throw new Error('应命中');
  expect(h.session.items[1].physicalSeq).toBe(1);
  // 重新盘点：全新快照、全新标识、序号重新从 1 开始
  const again=createSession([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})],'B1','2026-09-10T10:00:00.000Z');
  if('error'in again)throw new Error('不应失败');
  expect(again.id).not.toBe(h.session.id);
  expect(again.completedAt).toBeNull();
  expect(again.items.every(i=>i.physicalSeq===null&&!i.found)).toBe(true);
  expect(nextPhysicalSeq(again)).toBe(1);
 });

 it('解析时丢弃实物序号重复或非法的会话，避免不可重复约束被破坏',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  const dup=s.items.map((i,idx)=>({...i,found:true,physicalSeq:idx===0?1:1}));
  expect(parseSessions(JSON.stringify([{...s,items:dup}]))).toEqual([]);
  const bad=s.items.map((i,idx)=>({...i,found:true,physicalSeq:idx===0?0:1}));
  expect(parseSessions(JSON.stringify([{...s,items:bad}]))).toEqual([]);
 });

 it('登记保留档号两端空格时，扫描肉眼相同的档号仍正常命中并推进盘点',()=>{
  // 档案登记保留了档号两端空格，快照照存原样
  const s=sessionOf([a({id:'arc-1',archiveNo:' A-1 '}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  expect(s.items[0].archiveNo).toBe(' A-1 ');
  // 库房扫描不带空格的档号：正常命中而非误判不在快照中
  const out=scanArchiveNo(s,'A-1');
  if(out.kind!=='found')throw new Error('应唯一命中');
  expect(out.item.archiveId).toBe('arc-1');
  expect(out.session.items[0].found).toBe(true);
  expect(out.session.items[0].physicalSeq).toBe(1);
  expect(foundCount(out.session)).toBe(1);
  // 扫描件自身带空格、快照侧不带空格也同样命中；命中后再扫判定重复
  const s2=sessionOf([a({id:'arc-9',archiveNo:'A-9'})]);
  const out2=scanArchiveNo(s2,'  A-9  ');
  if(out2.kind!=='found')throw new Error('应唯一命中');
  expect(scanArchiveNo(out2.session,'A-9').kind).toBe('duplicate');
 });

 it('恢复仍有待盘项却带完成标记的会话时回退为进行中，可继续扫描直至全部命中',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25})]);
  // 损坏的本地数据：只命中一件，却已写入完成标记
  const broken={...s,completedAt:'2026-09-11T00:00:00.000Z',items:s.items.map((i,idx)=>idx===0?{...i,found:true,physicalSeq:1}:i)};
  const restored=parseSessions(JSON.stringify([broken]))[0];
  expect(restored.completedAt).toBeNull();
  expect(foundCount(restored)).toBe(1);
  expect(isComplete(restored)).toBe(false);
  // 仍可扫描推进，剩余件取得接续实物序号 2，全部命中后才真正完成
  const out=scanArchiveNo(restored,'A-2');
  if(out.kind!=='found')throw new Error('应命中');
  expect(out.session.items.map(i=>i.physicalSeq)).toEqual([1,2]);
  expect(out.session.completedAt).toBeTruthy();
  // 全部命中且带完成标记的正常完成会话，恢复后仍为已完成
  expect(parseSessions(JSON.stringify([out.session]))[0].completedAt).toBeTruthy();
 });

 it('恢复的待盘项残留实物序号时被清空，下一次有效扫描只接续已命中项编号',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'A-1'}),a({id:'arc-2',archiveNo:'A-2',startPage:20,endPage:25}),a({id:'arc-3',archiveNo:'A-3',startPage:30,endPage:35})]);
  // 第一件已命中取得序号 1；待盘的第二件却被写入残留序号 5（会导致跳号）
  const broken={...s,items:s.items.map((i,idx)=>idx===0?{...i,found:true,physicalSeq:1}:idx===1?{...i,physicalSeq:5}:i)};
  const restored=parseSessions(JSON.stringify([broken]))[0];
  expect(restored.items[1].found).toBe(false);
  expect(restored.items[1].physicalSeq).toBeNull();
  // 下一次有效扫描应接续为 2，而不是跳到 6
  const out=scanArchiveNo(restored,'A-2');
  if(out.kind!=='found')throw new Error('应命中');
  expect(out.session.items.map(i=>i.physicalSeq)).toEqual([1,2,null]);
 });

 it('恢复含重复会话项标识的会话后，明示选中一件只登记选中那件且不产生重复序号',()=>{
  const s=sessionOf([a({id:'arc-1',archiveNo:'DUP',title:'甲',startPage:1,endPage:5}),a({id:'arc-2',archiveNo:'DUP',title:'乙',startPage:6,endPage:9})]);
  // 损坏的本地数据：两个会话项共用同一 itemId
  const dupId=s.items[0].itemId;
  const broken={...s,items:s.items.map(i=>({...i,itemId:dupId}))};
  const restored=parseSessions(JSON.stringify([broken]))[0];
  const ids=restored.items.map(i=>i.itemId);
  expect(new Set(ids).size).toBe(2);
  expect(restored.items.map(i=>i.archiveId)).toEqual(['arc-1','arc-2']);
  // 歧义后选中第二件：只登记乙，取得唯一实物序号 1
  const out=scanArchiveNo(restored,'DUP');
  if(out.kind!=='ambiguous')throw new Error('应歧义');
  const picked=out.candidates.find(c=>c.archiveId==='arc-2')!;
  const r=markFound(restored,picked.itemId);
  if('error'in r)throw new Error('不应失败');
  expect(r.session.items.map(i=>i.found)).toEqual([false,true]);
  expect(r.session.items.map(i=>i.physicalSeq)).toEqual([null,1]);
 });
});
