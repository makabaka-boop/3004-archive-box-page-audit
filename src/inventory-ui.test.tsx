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
  expect(s0[0].items.every(i=>i.itemId&&i.itemId!==i.archiveId&&!i.found)).toBe(true);
  expect(new Set(s0[0].items.map(i=>i.itemId)).size).toBe(2);
  expect(within(panel).getByText('0 / 2')).toBeTruthy();
  // 连续扫描第一件
  scan(panel,'A-001');
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  expect(within(panel).getByText(/已登记为已找到（1\/2）/)).toBeTruthy();
  // 模拟刷新页面：进度仍在，可续盘
  unmount();
  const again=render(<App/>);
  const panel2=panelOf('B1');
  expect(within(panel2).getByText('1 / 2')).toBeTruthy();
  expect(within(panel2).getByText('进行中')).toBeTruthy();
  expect(within(panel2).getByText('已找到')).toBeTruthy();
  // 续盘第二件 → 全部命中自动完成
  scan(panel2,'A-002');
  expect(within(panel2).getByText('2 / 2')).toBeTruthy();
  expect(within(panel2).getByText(/全部命中，盘点自动完成/)).toBeTruthy();
  expect(within(panel2).getByText('已完成')).toBeTruthy();
  const done=storedSessions()[0];
  expect(done.completedAt).toBeTruthy();
  expect(done.items.every(i=>i.found)).toBe(true);
  // 再次刷新结果仍可查看
  again.unmount();
  const view=render(<App/>);
  const panel3=panelOf('B1');
  expect(within(panel3).getByText('2 / 2')).toBeTruthy();
  expect(within(panel3).getByText('已完成')).toBeTruthy();
  expect(within(panel3).getByText(/全部 2 件已找到/)).toBeTruthy();
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
  // 唯一命中一件
  scan(panel,'A-001');
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  // 重复扫描同一档号
  scan(panel,'A-001');
  expect(within(panel).getByText(/重复扫描/)).toBeTruthy();
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  // 存储中的快照与计数同样未变
  const s=storedSessions()[0];
  expect(s.items.map(i=>i.found)).toEqual([true,false]);
  expect(s.completedAt).toBeNull();
  expect(storedArchives()).toEqual(seed);
 });

 it('同一档号命中多件时展示候选，取消不推进，明示选中才落到正确会话项',()=>{
  setup();render(<App/>);
  const panel=panelOf('B2');
  fireEvent.click(within(panel).getByText('开始盘点'));
  scan(panel,'DUP');
  expect(within(panel).getByText(/命中 2 件/)).toBeTruthy();
  // 候选展示盘点序号、题名和页码区间
  const cands=within(panel).getByLabelText('歧义候选');
  expect(within(cands).getByText('第 1 项')).toBeTruthy();
  expect(within(cands).getByText('同名甲')).toBeTruthy();
  expect(within(cands).getByText('1—5')).toBeTruthy();
  expect(within(cands).getByText('第 2 项')).toBeTruthy();
  expect(within(cands).getByText('同名乙')).toBeTruthy();
  expect(within(cands).getByText('6—9')).toBeTruthy();
  // 取消选择：提示且计数不变
  fireEvent.click(within(cands).getByText('取消选择'));
  expect(within(panel).getByText(/已取消选择/)).toBeTruthy();
  expect(within(panel).getByText('0 / 2')).toBeTruthy();
  expect(storedSessions()[0].items.every(i=>!i.found)).toBe(true);
  // 再次扫描并明确选中第二件（同名乙）
  scan(panel,'DUP');
  const cands2=within(panel).getByLabelText('歧义候选');
  const second=within(cands2).getByText('同名乙').closest('.inv-candidate') as HTMLElement;
  fireEvent.click(within(second).getByText('选中此件'));
  expect(within(panel).getByText('1 / 2')).toBeTruthy();
  expect(within(panel).getByText(/已选中第 2 项/)).toBeTruthy();
  // 落到正确会话项：同名乙（archiveId id4），同名甲仍未找到
  const s=storedSessions()[0];
  expect(s.items[1].found).toBe(true);
  expect(s.items[1].archiveId).toBe('id4');
  expect(s.items[0].found).toBe(false);
  expect(s.completedAt).toBeNull();
 });
});
