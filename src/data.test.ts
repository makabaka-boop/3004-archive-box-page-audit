import{describe,expect,it}from'vitest';import{CSV_HEADERS,applyRepagination,buildRepagination,detectIssues,filterArchives,importCsv,makeBackup,parseBackup}from'./data';import type{Archive,Resolutions}from'./types';
const a=(x:Partial<Archive>):Archive=>({id:'1',archiveNo:'A-1',title:'年度总结',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:'',...x});
describe('CSV',()=>{it('解析标准 CSV 和引号字段',()=>{const t=CSV_HEADERS.join(',')+'\nA-2,"会议,纪要",2024,30年,B1,1,2,2,正常';expect(importCsv(t)[0]).toMatchObject({archiveNo:'A-2',title:'会议,纪要'})});it('错误带行号',()=>{const t=CSV_HEADERS.join(',')+'\nA-2,标题,2024,30年,B1,5,2,3,';expect(()=>importCsv(t)).toThrow(/第 2 行/) });it('拒绝重复档号',()=>{const t=CSV_HEADERS.join(',')+'\nA-1,标题,2024,永久,B1,1,2,2,';expect(()=>importCsv(t,[a({})])).toThrow(/重复/)})});
describe('页码',()=>{it('识别页数不符与倒置',()=>{const k=detectIssues([a({declaredPages:8}),a({id:'2',archiveNo:'A-2',startPage:9,endPage:3})]).map(i=>i.kind);expect(k).toEqual(expect.arrayContaining(['count','reversed']))});it('识别同盒重叠，不跨盒误报',()=>{const xs=[a({}),a({id:'2',archiveNo:'A-2',startPage:8,endPage:12,declaredPages:5}),a({id:'3',archiveNo:'A-3',boxNo:'B2',startPage:8,endPage:12,declaredPages:5})];expect(detectIssues(xs).filter(i=>i.kind==='overlap')).toHaveLength(2)})});
describe('连续编页',()=>{const r=(x:Partial<Archive>):Archive=>a({...x});
 it('排序相同时以档号稳定落位，区间首尾连续',()=>{
  const xs=[r({id:'x1',archiveNo:'C-3',startPage:1,endPage:20,declaredPages:10}),r({id:'x2',archiveNo:'C-1',startPage:1,endPage:20,declaredPages:5}),r({id:'x3',archiveNo:'C-2',startPage:1,endPage:9,declaredPages:3}),r({id:'x4',archiveNo:'D-1',boxNo:'B2',startPage:1,endPage:4,declaredPages:4})];
  const p=buildRepagination(xs,{},'B1','1');
  expect('error'in p).toBe(false);if('error'in p)throw new Error('不应失败');
  expect(p.rows.map(q=>q.archive.archiveNo)).toEqual(['C-2','C-1','C-3']);
  expect(p.rows.map(q=>[q.newStart,q.newEnd])).toEqual([[1,3],[4,8],[9,18]]);
  expect(p.rows[1].newStart).toBe(p.rows[0].newEnd+1);
  expect(p.rows[2].newEnd-p.rows[0].newStart+1).toBe(18);
 });
 it('起始页可从 0 开始，按申报页数连续推进',()=>{
  const p=buildRepagination([r({declaredPages:4}),r({id:'2',archiveNo:'A-2',startPage:20,endPage:30,declaredPages:1})],{},'B1','0');
  expect('error'in p).toBe(false);if('error'in p)throw new Error('不应失败');
  expect(p.rows.map(q=>[q.newStart,q.newEnd])).toEqual([[0,3],[4,4]]);
 });
 it('预览逐项给出原区间、新区间与受影响处置数量',()=>{
  const res:Resolutions={'1:count':{status:'fixed',note:'已改'},'1:overlap:2':{status:'kept',note:''},'2:reversed':{status:'fixed',note:''}};
  const p=buildRepagination([r({declaredPages:2}),r({id:'2',archiveNo:'A-2',declaredPages:2,startPage:9,endPage:8})],res,'B1','1');
  if('error'in p)throw new Error('不应失败');
  expect(p.rows[0]).toMatchObject({oldStart:1,oldEnd:10,newStart:1,newEnd:2,resolutionCount:2});
  expect(p.rows[1]).toMatchObject({oldStart:9,oldEnd:8,newStart:3,newEnd:4,resolutionCount:1});
 });
 it('起始页为空或非非负整数时禁止确认并说明原因',()=>{
  const xs=[r({})];
  expect(buildRepagination(xs,{},'B1','')).toEqual({error:'请填写起始页'});
  expect(buildRepagination(xs,{},'B1','  ')).toEqual({error:'请填写起始页'});
  expect(buildRepagination(xs,{},'B1','-1')).toEqual({error:'起始页须为非负整数'});
  expect(buildRepagination(xs,{},'B1','1.5')).toEqual({error:'起始页须为非负整数'});
  expect(buildRepagination(xs,{},'B1','abc')).toEqual({error:'起始页须为非负整数'});
  expect(buildRepagination(xs,{},'NOPE','1')).toEqual({error:'所选盒号不存在或盒内没有档案'});
 });
 it('计算结果超过页码上限时禁止确认',()=>{
  const p=buildRepagination([r({declaredPages:2})],{},'B1',String(999999));
  expect('error'in p).toBe(true);if(!('error'in p))throw new Error('应失败');
  expect(p.error).toMatch(/超过上限/);
 });
 it('确认后只更新目标盒档案并清除其关联旧处置，其他盒不动',()=>{
  const xs=[r({declaredPages:2}),r({id:'2',archiveNo:'A-2',declaredPages:2,startPage:5,endPage:6}),r({id:'3',archiveNo:'B-9',boxNo:'B2',startPage:3,endPage:3,declaredPages:1})];
  const res:Resolutions={'1:count':{status:'fixed',note:'x'},'2:reversed':{status:'kept',note:'y'},'3:reversed':{status:'fixed',note:'z'}};
  const p=buildRepagination(xs,res,'B1','10') as Exclude<ReturnType<typeof buildRepagination>,{error:string}>;
  const out=applyRepagination(xs,res,p);
  expect(out.archives.filter(a=>a.boxNo==='B1').map(a=>[a.startPage,a.endPage])).toEqual([[10,11],[12,13]]);
  expect(out.archives.find(a=>a.id==='3')).toMatchObject({startPage:3,endPage:3});
  expect(Object.keys(out.resolutions)).toEqual(['3:reversed']);
 });
});
describe('筛选与备份',()=>{it('组合筛选问题状态',()=>{const xs=[a({}),a({id:'2',title:'其他',archiveNo:'X',year:2023,boxNo:'B2',declaredPages:2})],is=detectIssues(xs);expect(filterArchives(xs,is,{}, {query:'其他',year:'2023',box:'B2',status:'pending'})).toHaveLength(1)});it('备份往返并拒绝非法结构',()=>{expect(parseBackup(JSON.stringify(makeBackup([a({})],{}))).archives).toHaveLength(1);expect(()=>parseBackup('{"version":1,"archives":"bad"}')).toThrow(/无效/)})});
