import{afterEach,describe,expect,it}from'vitest';
import{cleanup,fireEvent,render,within}from'@testing-library/react';
import App from'./App';
import{INVENTORY_KEY}from'./inventory';
import type{Archive,InventorySession}from'./types';

const ARCHIVES_KEY='archive-audit:archives',RES_KEY='archive-audit:resolutions';
const seed:Archive[]=[
 {id:'id1',archiveNo:'A-001',title:'第一件',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:''},
 {id:'id2',archiveNo:'A-002',title:'第二件',year:2024,retention:'30年',boxNo:'B1',startPage:11,endPage:20,declaredPages:10,note:''},
 {id:'id3',archiveNo:'DUP',title:'同名甲',year:2023,retention:'永久',boxNo:'B2',startPage:1,endPage:5,declaredPages:5,note:''},
 {id:'id4',archiveNo:'DUP',title:'同名乙',year:2023,retention:'10年',boxNo:'B2',startPage:6,endPage:9,declaredPages:4,note:''},
];
const setup=()=>{localStorage.clear();localStorage.setItem(ARCHIVES_KEY,JSON.stringify(seed))};
const storedSessions=():InventorySession[]=>JSON.parse(localStorage.getItem(INVENTORY_KEY)||'[]');
const storedArchives=():Archive[]=>JSON.parse(localStorage.getItem(ARCHIVES_KEY)||'[]');
const panelOf=(box:string)=>document.querySelector(`[aria-label="盒 ${box} 盒内盘点"]`) as HTMLElement;
const scan=(panel:HTMLElement,no:string)=>{fireEvent.change(within(panel).getByLabelText('扫描或输入档号'),{target:{value:no}});fireEvent.click(within(panel).getByText('登记'))};

afterEach(cleanup);

describe('盒内盘点界面',()=>{
 it('开始盘点后连续扫描，刷新续盘至全部命中自动完成，档案登记信息不被改写',()=>{
  setup();const{unmount}=render(<App/>);
  const panel=panelOf('B1');
  fireEvent.click(within(panel).getByText('开始盘点'));
  // 会话写入新的本地存储键：盒号、创建时间与当时盒内档案快照
  const s0=storedSessions();
  expect(s0).toHaveLength(1);
  expect(s0[0].boxNo).toBe('B1');
  expect(s0[0].createdAt).toBeTruthy();
  expect(s0[0].completedAt).toBeNull();
  expect(s0[0].items.map(i=>[i.archiveNo,i.archiveId])).toEqual([['A-001','id1'],['A-002','id2']]);
  expect(s0[0].items.every(i=>i.itemId&&i.itemId!==i.archiveId&&!i.found&&i.physicalSeq===null)).toBe(true);
  expect(new Set(s0[0].items.map(i=>i.itemId)).size).toBe(2);
  expect(within(panel).getByText('0 / 2')).toBeTruthy();
  // 连续扫描第一件：取得实物序号 1
  scan(panel,'A-001');
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  expect(within(panel).getByText(/已登记为已找到，实物序号 1（1\/2）/)).toBeTruthy();
  expect(within(panel).getByText('实物序号 1')).toBeTruthy();
  expect(storedSessions()[0].items.map(i=>i.physicalSeq)).toEqual([1,null]);
  // 模拟刷新页面：进度、实物序号仍在，续盘继续编号
  unmount();
  const again=render(<App/>);
  const panel2=panelOf('B1');
  expect(within(panel2).getByText('1 / 2')).toBeTruthy();
  expect(within(panel2).getByText('进行中')).toBeTruthy();
  expect(within(panel2).getByText('已找到')).toBeTruthy();
  expect(within(panel2).getByText('实物序号 1')).toBeTruthy();
  // 续盘第二件 → 刷新后接续分配实物序号 2，全部命中自动完成
  scan(panel2,'A-002');
  expect(within(panel2).getByText('2 / 2')).toBeTruthy();
  expect(within(panel2).getByText(/实物序号 2.*全部命中，盘点自动完成/)).toBeTruthy();
  expect(within(panel2).getByText('已完成')).toBeTruthy();
  const done=storedSessions()[0];
  expect(done.completedAt).toBeTruthy();
  expect(done.items.every(i=>i.found)).toBe(true);
  expect(done.items.map(i=>i.physicalSeq)).toEqual([1,2]);
  // 完成面板按档案展示期望序号、实物序号与一致结果
  const order=within(panel2).getByLabelText('摆放顺序复核');
  expect(within(order).getAllByText('一致')).toHaveLength(2);
  expect(within(panel2).getByText(/实物序号与期望序号一致/)).toBeTruthy();
  expect(within(panel2).queryByText('错位')).toBeNull();
  // 再次刷新结果仍可查看
  again.unmount();
  const view=render(<App/>);
  const panel3=panelOf('B1');
  expect(within(panel3).getByText('2 / 2')).toBeTruthy();
  expect(within(panel3).getByText('已完成')).toBeTruthy();
  expect(within(panel3).getByText(/全部 2 件已找到/)).toBeTruthy();
  expect(within(panel3).getByLabelText('摆放顺序复核')).toBeTruthy();
  view.unmount();
  // 档案登记与异常处置键的内容未被盘点改写
  expect(storedArchives()).toEqual(seed);
  expect(localStorage.getItem(RES_KEY)).toBe('{}');
 });

 it('档号不存在与重复扫描给出提示，快照和计数保持不变',()=>{
  setup();render(<App/>);
  const panel=panelOf('B1');
  fireEvent.click(within(panel).getByText('开始盘点'));
  // 档号不存在
  scan(panel,'A-404');
  expect(within(panel).getByText(/不在本盒盘点快照中/)).toBeTruthy();
  expect(within(panel).getByText('0 / 2')).toBeTruthy();
  // 唯一命中一件：实物序号 1
  scan(panel,'A-001');
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  // 空输入与重复扫描同一档号：不消耗实物序号
  scan(panel,'');
  expect(within(panel).getByText(/请先扫描或输入档号/)).toBeTruthy();
  scan(panel,'A-001');
  expect(within(panel).getByText(/重复扫描/)).toBeTruthy();
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  // 存储中的快照、计数与实物序号同样未变
  const s=storedSessions()[0];
  expect(s.items.map(i=>i.found)).toEqual([true,false]);
  expect(s.items.map(i=>i.physicalSeq)).toEqual([1,null]);
  expect(s.completedAt).toBeNull();
  expect(storedArchives()).toEqual(seed);
 });

 it('同一档号命中多件时展示候选，取消不推进，明示选中才落到正确会话项',()=>{
  setup();render(<App/>);
  const panel=panelOf('B2');
  fireEvent.click(within(panel).getByText('开始盘点'));
  scan(panel,'DUP');
  expect(within(panel).getByText(/共有 2 件/)).toBeTruthy();
  // 候选展示盘点序号、题名和页码区间
  const cands=within(panel).getByLabelText('歧义候选');
  expect(within(cands).getByText('第 1 项')).toBeTruthy();
  expect(within(cands).getByText('同名甲')).toBeTruthy();
  expect(within(cands).getByText('1—5')).toBeTruthy();
  expect(within(cands).getByText('第 2 项')).toBeTruthy();
  expect(within(cands).getByText('同名乙')).toBeTruthy();
  expect(within(cands).getByText('6—9')).toBeTruthy();
  // 取消选择：提示且计数与序号不变
  fireEvent.click(within(cands).getByText('取消选择'));
  expect(within(panel).getByText(/已取消选择/)).toBeTruthy();
  expect(within(panel).getByText('0 / 2')).toBeTruthy();
  expect(storedSessions()[0].items.every(i=>!i.found&&i.physicalSeq===null)).toBe(true);
  // 再次扫描并明确选中第二件（同名乙）
  scan(panel,'DUP');
  const cands2=within(panel).getByLabelText('歧义候选');
  const second=within(cands2).getByText('同名乙').closest('.inv-candidate') as HTMLElement;
  fireEvent.click(within(second).getByText('选中此件'));
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  expect(within(panel).getByText(/已选中第 2 项，.*实物序号 1/)).toBeTruthy();
  // 落到正确会话项：同名乙（archiveId id4）取得实物序号 1，同名甲仍未找到
  const s=storedSessions()[0];
  expect(s.items[1].found).toBe(true);
  expect(s.items[1].archiveId).toBe('id4');
  expect(s.items[1].physicalSeq).toBe(1);
  expect(s.items[0].found).toBe(false);
  expect(s.items[0].physicalSeq).toBeNull();
  expect(s.completedAt).toBeNull();
  // 再次扫描同一档号：仍须明示选择，不自动登记剩余那件
  scan(panel,'DUP');
  expect(within(panel).getByText(/共有 2 件/)).toBeTruthy();
  const cands3=within(panel).getByLabelText('歧义候选');
  expect(within(cands3).getByText('同名甲')).toBeTruthy();
  expect(within(cands3).queryByText('同名乙')).toBeNull();
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  expect(storedSessions()[0].items.map(i=>i.found)).toEqual([false,true]);
  expect(storedSessions()[0].items.map(i=>i.physicalSeq)).toEqual([null,1]);
  // 取消选择后计数与序号仍不变；明示选中同名甲才推进（实物序号 2）并自动完成
  fireEvent.click(within(cands3).getByText('取消选择'));
  expect(within(panel).getByText(/已取消选择/)).toBeTruthy();
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  scan(panel,'DUP');
  const cands4=within(panel).getByLabelText('歧义候选');
  const first=within(cands4).getByText('同名甲').closest('.inv-candidate') as HTMLElement;
  fireEvent.click(within(first).getByText('选中此件'));
  expect(within(panel).getByText('2 / 2')).toBeTruthy();
  expect(within(panel).getByText('已完成')).toBeTruthy();
  const fin=storedSessions()[0];
  expect(fin.items.every(i=>i.found)).toBe(true);
  expect(fin.completedAt).toBeTruthy();
  // 实物序号按确认先后落位 2、1，与期望顺序全部错位，首错在期望序号第 1 项
  expect(fin.items.map(i=>i.physicalSeq)).toEqual([2,1]);
  const order=within(panel).getByLabelText('摆放顺序复核');
  expect(within(order).getAllByText('错位')).toHaveLength(2);
  expect(within(order).queryByText('一致')).toBeNull();
  expect(within(panel).getByText(/首个错位位置为期望序号第 1 项/)).toBeTruthy();
 });

 it('乱序扫描完成后按档案展示错位结果并汇总首个错位位置，刷新后结论保留；重新盘点生成全新序列',()=>{
  setup();const{unmount}=render(<App/>);
  const panel=panelOf('B1');
  fireEvent.click(within(panel).getByText('开始盘点'));
  // 先扫第二件再扫第一件：实物序号 1、2 与期望顺序相反
  scan(panel,'A-002');
  expect(within(panel).getByText('实物序号 1')).toBeTruthy();
  // 无效操作不消耗序号
  scan(panel,'A-404');
  scan(panel,'A-002');
  scan(panel,'A-001');
  expect(within(panel).getByText(/实物序号 2.*（2\/2）|实物序号 2.*全部命中/)).toBeTruthy();
  const rows=()=>within(panel).getByLabelText('摆放顺序复核');
  const order=rows();
  const trs=[...order.querySelectorAll('tbody tr')].map(tr=>tr.textContent);
  expect(trs[0]).toContain('A-001');expect(trs[0]).toContain('2');expect(trs[0]).toContain('错位');
  expect(trs[1]).toContain('A-002');expect(trs[1]).toContain('1');expect(trs[1]).toContain('错位');
  expect(within(panel).getByText(/首个错位位置为期望序号第 1 项/)).toBeTruthy();
  // 刷新页面：序列与错位结论从独立本地存储恢复
  unmount();
  const again=render(<App/>);
  const panel2=panelOf('B1');
  expect(within(panel2).getByText('已完成')).toBeTruthy();
  expect(within(panel2).getByText(/首个错位位置为期望序号第 1 项/)).toBeTruthy();
  expect(within(panel2).getAllByText('错位')).toHaveLength(2);
  // 重新盘点生成全新会话：进度清零，序号重新从 1 开始
  fireEvent.click(within(panel2).getByText('重新盘点'));
  expect(within(panel2).getByText('0 / 2')).toBeTruthy();
  const sessions=storedSessions();
  expect(sessions).toHaveLength(2);
  expect(sessions[1].id).not.toBe(sessions[0].id);
  expect(sessions[1].items.every(i=>!i.found&&i.physicalSeq===null)).toBe(true);
  // 新会话按期望顺序扫描：结论为全部一致
  scan(panel2,'A-001');scan(panel2,'A-002');
  expect(within(panel2).getByText(/实物序号与期望序号一致/)).toBeTruthy();
  expect(storedSessions()[1].items.map(i=>i.physicalSeq)).toEqual([1,2]);
 });

 it('加载没有实物序号的旧会话：照常显示原进度，但明确提示无法复核顺序',()=>{
  // 旧版会话：item 不含 physicalSeq，进度为 2 件全部找到且已完成
  const legacy={id:'old-session',boxNo:'B1',createdAt:'2026-01-01T00:00:00.000Z',completedAt:'2026-01-01T01:00:00.000Z',items:[
   {itemId:'oi1',archiveId:'id1',archiveNo:'A-001',title:'第一件',startPage:1,endPage:10,found:true},
   {itemId:'oi2',archiveId:'id2',archiveNo:'A-002',title:'第二件',startPage:11,endPage:20,found:true},
  ]};
  localStorage.clear();
  localStorage.setItem(ARCHIVES_KEY,JSON.stringify(seed));
  localStorage.setItem(INVENTORY_KEY,JSON.stringify([legacy]));
  render(<App/>);
  const panel=panelOf('B1');
  expect(within(panel).getByText('2 / 2')).toBeTruthy();
  expect(within(panel).getByText('已完成')).toBeTruthy();
  expect(within(panel).getByText(/全部 2 件已找到/)).toBeTruthy();
  // 明确提示无法复核顺序，且不展示顺序复核表与一致/错位结论
  expect(within(panel).getByText(/缺少实物序号，无法复核摆放顺序/)).toBeTruthy();
  expect(within(panel).queryByLabelText('摆放顺序复核')).toBeNull();
  expect(within(panel).queryByText('一致')).toBeNull();
  expect(within(panel).queryByText('错位')).toBeNull();
  // 解析归一化：旧记录补 null，不丢原进度
  expect(storedSessions()[0].items.map(i=>[i.found,i.physicalSeq])).toEqual([[true,null],[true,null]]);
  // 进行中的旧会话（部分进度）同样提示无法复核，仍可继续登记；续登项接续编号
  const partial={...legacy,completedAt:null,items:[legacy.items[0],{...legacy.items[1],itemId:'oi2',found:false}]};
  localStorage.setItem(INVENTORY_KEY,JSON.stringify([partial]));
  cleanup();
  const view2=render(<App/>);
  const panel2=panelOf('B1');
  expect(within(panel2).getByText('1 / 2')).toBeTruthy();
  expect(within(panel2).getByText(/已有登记缺少实物序号.*无法复核实体摆放顺序/)).toBeTruthy();
  scan(panel2,'A-002');
  // 新登记的项接续分配实物序号 1，但因旧项缺序号，完成后仍不能复核
  expect(within(panel2).getByText('2 / 2')).toBeTruthy();
  expect(within(panel2).getByText(/缺少实物序号，无法复核摆放顺序/)).toBeTruthy();
  expect(within(panel2).queryByLabelText('摆放顺序复核')).toBeNull();
  view2.unmount();
 });
});
