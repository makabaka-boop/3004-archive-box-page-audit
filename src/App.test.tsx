import{afterEach,describe,expect,it}from'vitest';import{cleanup,fireEvent,render}from'@testing-library/react';import App from'./App';import type{Archive,Resolutions}from'./types';

const ARCHIVES_KEY='archive-audit:archives',RES_KEY='archive-audit:resolutions';
const seed:Archive[]=[
 {id:'id1',archiveNo:'A-003',title:'第三件',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:8,note:''},
 {id:'id2',archiveNo:'A-001',title:'第一件',year:2024,retention:'30年',boxNo:'B1',startPage:20,endPage:25,declaredPages:6,note:''},
 {id:'id3',archiveNo:'A-002',title:'第二件',year:2024,retention:'10年',boxNo:'B1',startPage:9,endPage:12,declaredPages:4,note:''},
 {id:'id4',archiveNo:'Z-001',title:'其他盒',year:2023,retention:'永久',boxNo:'B2',startPage:5,endPage:2,declaredPages:2,note:''},
];
const seedRes:Resolutions={'id1:count':{status:'fixed',note:'已改'},'id4:reversed':{status:'kept',note:'保留'}};
const setup=()=>{localStorage.clear();localStorage.setItem(ARCHIVES_KEY,JSON.stringify(seed));localStorage.setItem(RES_KEY,JSON.stringify(seedRes))};
const storedArchives=():Archive[]=>JSON.parse(localStorage.getItem(ARCHIVES_KEY)||'[]');
const storedRes=():Resolutions=>JSON.parse(localStorage.getItem(RES_KEY)||'{}');

afterEach(cleanup);

describe('连续编页界面',()=>{
 it('预览后取消不改动档案、处置与本地存储，刷新仍原样',()=>{
  setup();const{container,getByText,queryByText,unmount}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  expect(queryByText('预览结果（尚未写入）')).toBeNull();
  fireEvent.click(getByText('预览重排'));
  // 逐项展示原区间、新区间
  const olds=[...container.querySelectorAll('.repage-table .old-range')].map(el=>el.textContent);
  const news=[...container.querySelectorAll('.repage-table .new-range')].map(el=>el.textContent);
  expect(olds).toEqual(['1—10','9—12','20—25']);
  expect(news).toEqual(['1—8','9—12','13—18']);
  expect(getByText(/将清除 1 条相关旧处置/)).toBeTruthy();
  // 取消：不落盘
  fireEvent.click(getByText('取消（不落盘）'));
  expect(queryByText('预览结果（尚未写入）')).toBeNull();
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:20,endPage:25});
  expect(storedRes()['id1:count']).toEqual({status:'fixed',note:'已改'});
  // 模拟刷新页面：从 localStorage 重新加载，结果保持原样
  unmount();
  const again=render(<App/>);
  expect(again.queryByText('13—18')).toBeNull();
  expect(again.getByText('20—25')).toBeTruthy();
 });

 it('确认后整盒重排、清理相关处置并触发复核与刷新，刷新后保留',()=>{
  setup();const{getByText,queryByText,unmount}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  fireEvent.click(getByText('确认写入'));
  // 盒视图刷新为新区间，旧区间消失
  expect(getByText('1—8')).toBeTruthy();expect(getByText('13—18')).toBeTruthy();
  expect(queryByText('20—25')).toBeNull();
  // 本盒旧处置已清除，其他盒处置保留
  const res=storedRes();
  expect(res['id1:count']).toBeUndefined();
  expect(res['id4:reversed']).toEqual({status:'kept',note:'保留'});
  const b1=storedArchives().filter(a=>a.boxNo==='B1').map(a=>[a.archiveNo,a.startPage,a.endPage]);
  expect(b1).toEqual([['A-003',1,8],['A-001',13,18],['A-002',9,12]]);
  // 连续区间不再产生同盒重叠/页数异常，仅剩 B2 的倒置
  expect(getByText(/盒 B1 共 3 件已连续编页/)).toBeTruthy();
  // 刷新页面后结果仍保留
  unmount();
  const again=render(<App/>);
  expect(again.getByText('13—18')).toBeTruthy();
  expect(again.queryByText('20—25')).toBeNull();
 });

 it('起始页非法时预览区说明原因并禁止确认',()=>{
  setup();const{getByText,getByLabelText,queryByText}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  fireEvent.change(getByLabelText('连续编页：起始页'),{target:{value:'-5'}});
  fireEvent.click(getByText('预览重排'));
  expect(getByText('起始页须为非负整数')).toBeTruthy();
  expect(queryByText('确认写入')).toBeNull();
  // 数据原样
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:20,endPage:25});
 });
});
