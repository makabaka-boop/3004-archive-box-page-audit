import{afterEach,describe,expect,it}from'vitest';import{cleanup,fireEvent,render,waitFor,within}from'@testing-library/react';import App from'./App';import{makeBackup}from'./data';import type{Archive,Resolutions}from'./types';

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
const importJson=(container:HTMLElement,backup:unknown)=>{const input=container.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;fireEvent.change(input,{target:{files:[new File([JSON.stringify(backup)],'备份.json',{type:'application/json'})]}});return waitFor(()=>{if(!container.querySelector('.notice'))throw new Error('等待导入结果')})};

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

 it('预览后修改同盒档案的题名、年度、期限或备注也必须重新预览',()=>{
  setup();const{getByText,getByLabelText}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  // 编辑同盒 A-001 的题名
  const row=[...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent?.includes('A-001')) as HTMLElement;
  fireEvent.click(within(row).getByText('编辑'));
  fireEvent.change(getByLabelText(/标题 \*/),{target:{value:'改名后的第一件'}});
  fireEvent.click(getByText('保存并复核'));
  // 旧预览过期：提示、禁用确认、点击不落盘
  expect(getByText('预览已过期')).toBeTruthy();
  const confirmBtn=getByText('确认写入') as HTMLButtonElement;
  expect(confirmBtn.disabled).toBe(true);
  fireEvent.click(confirmBtn);
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:20,endPage:25,title:'改名后的第一件'});
  // 重新预览后可确认
  fireEvent.click(getByText('预览重排'));
  expect((getByText('确认写入') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(getByText('确认写入'));
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:13,endPage:18,title:'改名后的第一件'});
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

 it('盒内存在申报页数为零的档案时预览说明原因并禁止确认',()=>{
  localStorage.clear();
  const withZero=seed.map(a=>a.id==='id3'?{...a,declaredPages:0}:a);
  localStorage.setItem(ARCHIVES_KEY,JSON.stringify(withZero));
  localStorage.setItem(RES_KEY,JSON.stringify(seedRes));
  const{getByText,queryByText}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  expect(getByText(/A-002 申报页数为 0/)).toBeTruthy();
  expect(queryByText('确认写入')).toBeNull();
  expect(storedArchives().find(a=>a.id==='id3')?.declaredPages).toBe(0);
 });

 it('预览后同盒档案变化必须重新预览才能确认',()=>{
  setup();const{getByText,getByLabelText}=render(<App/>);
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  expect(getByText('13—18')).toBeTruthy();
  // 在档案清单里编辑同盒的 A-001，申报页数 6 -> 3
  const row=[...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent?.includes('A-001')) as HTMLElement;
  fireEvent.click(within(row).getByText('编辑'));
  fireEvent.change(getByLabelText(/申报页数/),{target:{value:'3'}});
  fireEvent.click(getByText('保存并复核'));
  // 旧预览过期：提示并禁用确认，点击也不能落盘
  expect(getByText('预览已过期')).toBeTruthy();
  expect(getByText(/盒 B1 的档案或其异常处置发生过变化/)).toBeTruthy();
  const confirmBtn=getByText('确认写入') as HTMLButtonElement;
  expect(confirmBtn.disabled).toBe(true);
  fireEvent.click(confirmBtn);
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:20,endPage:25});
  // 重新预览后按新申报页数重排：A-001 变为 13—15，可正常确认
  fireEvent.click(getByText('预览重排'));
  expect(getByText('13—15')).toBeTruthy();
  expect((getByText('确认写入') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(getByText('确认写入'));
  expect(storedArchives().find(a=>a.id==='id2')).toMatchObject({startPage:13,endPage:15});
 });

 it('恢复含冒号档案标识的备份后确认连续编页，目标档案旧处置被清除',async()=>{
  localStorage.clear();
  const backup=makeBackup([
   {id:'r:1',archiveNo:'A-1',title:'甲',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:''},
   {id:'r:2',archiveNo:'A-2',title:'乙',year:2024,retention:'永久',boxNo:'B1',startPage:11,endPage:20,declaredPages:10,note:''},
  ],{'r:1:count':{status:'fixed',note:'旧处置'},'r:2:reversed':{status:'kept',note:'旧处置'}});
  const{container,getByText}=render(<App/>);
  await importJson(container,backup);
  expect(getByText(/已恢复 2 条档案/)).toBeTruthy();
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  expect(getByText(/将清除 2 条相关旧处置/)).toBeTruthy();
  fireEvent.click(getByText('确认写入'));
  expect(storedRes()).toEqual({});
  expect(storedArchives().map(a=>[a.id,a.startPage,a.endPage])).toEqual([['r:1',1,10],['r:2',11,20]]);
 });

 it('恢复含重复内部标识的同盒备份后确认，两件写入各自连续区间',async()=>{
  localStorage.clear();
  const backup=makeBackup([
   {id:'dup',archiveNo:'D-1',title:'甲',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:5,declaredPages:5,note:''},
   {id:'dup',archiveNo:'D-2',title:'乙',year:2024,retention:'永久',boxNo:'B1',startPage:10,endPage:20,declaredPages:4,note:''},
  ],{});
  const{container,getByText}=render(<App/>);
  await importJson(container,backup);
  expect(getByText(/已恢复 2 条档案/)).toBeTruthy();
  fireEvent.click(getByText('连续编页'));
  fireEvent.click(getByText('预览重排'));
  fireEvent.click(getByText('确认写入'));
  expect(storedArchives().map(a=>[a.archiveNo,a.startPage,a.endPage])).toEqual([['D-1',1,5],['D-2',6,9]]);
 });

 it('导入页码超过上限的旧版备份被拒绝，当前档案数据保持不变',async()=>{
  setup();
  const bad=makeBackup([{...seed[0],startPage:1000000,endPage:1000009}],{});
  const{container,getByText}=render(<App/>);
  await importJson(container,bad);
  expect(getByText(/无效备份/)).toBeTruthy();
  expect(storedArchives()).toEqual(seed);
  expect(storedRes()).toEqual(seedRes);
 });

 it('恢复的档案标识互为前缀时，确认连续编页不误删其他盒旧处置',async()=>{
  localStorage.clear();
  const backup=makeBackup([
   {id:'r',archiveNo:'A-1',title:'甲',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:''},
   {id:'r:1',archiveNo:'A-2',title:'乙',year:2024,retention:'永久',boxNo:'B2',startPage:1,endPage:5,declaredPages:5,note:''},
  ],{'r:count':{status:'fixed',note:'本盒处置'},'r:1:count':{status:'kept',note:'他盒处置'}});
  const{container,getByText}=render(<App/>);
  await importJson(container,backup);
  expect(getByText(/已恢复 2 条档案/)).toBeTruthy();
  fireEvent.click(getByText('连续编页'));
  // 默认选中盒 B1（标识 r），预览只统计本盒自己的 1 条处置
  fireEvent.click(getByText('预览重排'));
  expect(getByText(/将清除 1 条相关旧处置/)).toBeTruthy();
  fireEvent.click(getByText('确认写入'));
  // 本盒 r 的处置已清除，他盒 r:1 的处置保留
  expect(storedRes()).toEqual({'r:1:count':{status:'kept',note:'他盒处置'}});
  expect(storedArchives().find(a=>a.id==='r')).toMatchObject({startPage:1,endPage:10});
  expect(storedArchives().find(a=>a.id==='r:1')).toMatchObject({startPage:1,endPage:5});
 });
});
