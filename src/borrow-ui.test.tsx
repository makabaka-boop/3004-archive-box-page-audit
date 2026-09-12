import{afterEach,describe,expect,it,vi}from'vitest';
import{cleanup,fireEvent,render,waitFor,within}from'@testing-library/react';
import App from'./App';
import{BORROW_KEY}from'./borrow';
import{INVENTORY_KEY}from'./inventory';
import{makeBackup}from'./data';
import type{Archive,BorrowRecord}from'./types';

const ARCHIVES_KEY='archive-audit:archives',RES_KEY='archive-audit:resolutions';
const seed:Archive[]=[
 {id:'id1',archiveNo:'A-001',title:'第一件',year:2024,retention:'永久',boxNo:'B1',startPage:1,endPage:10,declaredPages:10,note:''},
 {id:'id2',archiveNo:'A-002',title:'第二件',year:2024,retention:'30年',boxNo:'B1',startPage:11,endPage:20,declaredPages:10,note:''},
];
const setup=()=>{localStorage.clear();localStorage.setItem(ARCHIVES_KEY,JSON.stringify(seed))};
const storedBorrows=():BorrowRecord[]=>JSON.parse(localStorage.getItem(BORROW_KEY)||'[]');
const storedArchives=():Archive[]=>JSON.parse(localStorage.getItem(ARCHIVES_KEY)||'[]');
const desk=()=>document.querySelector('#borrowdesk') as HTMLElement;
const openList=()=>within(desk()).getByLabelText('未归还记录');
const historyList=()=>within(desk()).getByLabelText('借阅历史');
const rowOf=(no:string)=>[...document.querySelectorAll('.records tbody tr')].find(tr=>tr.textContent?.includes(no)) as HTMLElement;
const startBorrow=(no:string)=>fireEvent.click(within(rowOf(no)).getByText('借阅'));
const fillForm=(borrower:string,due:string)=>{fireEvent.change(within(desk()).getByLabelText('查阅人'),{target:{value:borrower}});fireEvent.change(within(desk()).getByLabelText('预计归还日'),{target:{value:due}})};
const confirmBorrow=()=>fireEvent.click(within(desk()).getByText('确认借出'));

afterEach(()=>{cleanup();vi.restoreAllMocks()});

describe('借阅台界面',()=>{
 it('旧浏览器数据直接加载；从档案清单发起借阅，确认后写入独立存储键，刷新后该档案仍显示借出中',()=>{
  setup();const{unmount}=render(<App/>);
  // 旧浏览器数据（没有借阅键）直接加载为空台
  expect(within(desk()).getByText('当前没有未归还记录。')).toBeTruthy();
  expect(within(desk()).getByText('暂无历史记录。')).toBeTruthy();
  expect(within(desk()).getByText('0 件借出中')).toBeTruthy();
  // 从档案清单发起借阅：表单展示目标档案快照信息
  startBorrow('A-001');
  expect(within(desk()).getByText(/借出档案：/)).toBeTruthy();
  expect(within(desk()).getByText(/盒 B1 · 1–10 页/)).toBeTruthy();
  fillForm('张三','2099-01-01');
  confirmBorrow();
  expect(within(desk()).getByText('1 件借出中')).toBeTruthy();
  // 成功记录写入新的本地存储键：快照、查阅人、借出时间、预计归还日、归还时间
  const recs=storedBorrows();
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({archiveId:'id1',archiveNo:'A-001',title:'第一件',boxNo:'B1',startPage:1,endPage:10,borrower:'张三',dueDate:'2099-01-01',returnedAt:null});
  expect(recs[0].id).toBeTruthy();
  expect(recs[0].borrowedAt).toBeTruthy();
  // 档案行显示借出中且不能再发起；未归还区集中展示该记录
  const row=rowOf('A-001');
  expect(within(row).getByText('借出中')).toBeTruthy();
  expect(within(row).queryByText('借阅')).toBeNull();
  expect(within(openList()).getByText('张三')).toBeTruthy();
  expect(within(openList()).getByText('2099-01-01')).toBeTruthy();
  expect(within(openList()).getByText('A-001')).toBeTruthy();
  // 模拟刷新页面：该档案仍显示借出中，未归还记录仍在
  unmount();
  render(<App/>);
  expect(within(rowOf('A-001')).getByText('借出中')).toBeTruthy();
  expect(within(rowOf('A-001')).queryByText('借阅')).toBeNull();
  expect(within(openList()).getByText('张三')).toBeTruthy();
  expect(within(desk()).getByText('1 件借出中')).toBeTruthy();
  // 档案登记与异常处置键的内容未被借阅改写
  expect(storedArchives()).toEqual(seed);
  expect(localStorage.getItem(RES_KEY)).toBe('{}');
 });

 it('对未归还记录执行归还后只补写归还时间，记录进入历史；登记、处置与盘点会话不被改写',()=>{
  setup();render(<App/>);
  startBorrow('A-001');
  fillForm('张三','2099-01-01');
  confirmBorrow();
  const before=storedBorrows()[0];
  fireEvent.click(within(openList()).getByText('归还'));
  // 只补写归还时间：其余字段与标识原样
  const after=storedBorrows()[0];
  expect(storedBorrows()).toHaveLength(1);
  expect(after.returnedAt).toBeTruthy();
  const{returnedAt:_ret,...rest}=after;
  const{returnedAt:_old,...orig}=before;
  expect(rest).toEqual(orig);
  // 未归还区清空，历史区可查阅；档案行恢复可借阅
  expect(within(desk()).getByText('当前没有未归还记录。')).toBeTruthy();
  expect(within(desk()).getByText('0 件借出中')).toBeTruthy();
  expect(within(historyList()).getByText('张三')).toBeTruthy();
  expect(within(historyList()).getByText('A-001')).toBeTruthy();
  expect(within(rowOf('A-001')).queryByText('借出中')).toBeNull();
  expect(within(rowOf('A-001')).getByText('借阅')).toBeTruthy();
  // 档案登记、异常处置与盘点会话均不被改写
  expect(storedArchives()).toEqual(seed);
  expect(localStorage.getItem(RES_KEY)).toBe('{}');
  expect(localStorage.getItem(INVENTORY_KEY)).toBe('[]');
 });

 it('查阅人为空、日期无效或早于借出当天时在表单旁说明原因并保留输入，失败不产生记录',()=>{
  setup();render(<App/>);
  startBorrow('A-001');
  // 查阅人为空
  fillForm('   ','2099-01-01');
  confirmBorrow();
  expect(within(desk()).getByRole('alert').textContent).toBe('请填写查阅人');
  expect((within(desk()).getByLabelText('预计归还日') as HTMLInputElement).value).toBe('2099-01-01');
  // 日期无效：非日期文本与不存在的日子
  fillForm('张三','明天');
  confirmBorrow();
  expect(within(desk()).getByRole('alert').textContent).toContain('预计归还日无效');
  expect((within(desk()).getByLabelText('查阅人') as HTMLInputElement).value).toBe('张三');
  fillForm('张三','2099-02-30');
  confirmBorrow();
  expect(within(desk()).getByRole('alert').textContent).toContain('预计归还日无效');
  // 早于借出当天
  fillForm('张三','2000-01-01');
  confirmBorrow();
  expect(within(desk()).getByRole('alert').textContent).toBe('预计归还日不能早于借出当天');
  expect((within(desk()).getByLabelText('预计归还日') as HTMLInputElement).value).toBe('2000-01-01');
  // 全部失败：不产生任何记录，表单仍在原目标上
  expect(storedBorrows()).toEqual([]);
  expect(within(desk()).getByText('当前没有未归还记录。')).toBeTruthy();
  expect(within(desk()).getByText(/借出档案：/)).toBeTruthy();
  expect(within(rowOf('A-001')).queryByText('借出中')).toBeNull();
 });

 it('目标档案在确认前被删除时提示重新选择且不产生记录',()=>{
  setup();render(<App/>);
  startBorrow('A-001');
  fillForm('张三','2099-01-01');
  // 确认前目标档案被他处删除
  vi.spyOn(window,'confirm').mockReturnValue(true);
  fireEvent.click(within(rowOf('A-001')).getByText('删除'));
  confirmBorrow();
  expect(within(desk()).getByRole('alert').textContent).toBe('目标档案已被删除，请重新选择');
  expect(storedBorrows()).toEqual([]);
  expect(within(desk()).getByText('当前没有未归还记录。')).toBeTruthy();
 });

 it('借出后编辑或删除档案，借阅台仍显示借出时的档号、题名、盒号和页码快照',()=>{
  setup();render(<App/>);
  startBorrow('A-001');
  fillForm('张三','2099-01-01');
  confirmBorrow();
  // 借出后编辑档案：题名、盒号、页码全部改变
  fireEvent.click(within(rowOf('A-001')).getByText('编辑'));
  fireEvent.change(within(document.querySelector('#editor') as HTMLElement).getByLabelText(/标题 \*/),{target:{value:'改名后的第一件'}});
  fireEvent.change(within(document.querySelector('#editor') as HTMLElement).getByLabelText(/盒号 \*/),{target:{value:'B9'}});
  fireEvent.change(within(document.querySelector('#editor') as HTMLElement).getByLabelText(/起始页 \*/),{target:{value:'50'}});
  fireEvent.change(within(document.querySelector('#editor') as HTMLElement).getByLabelText(/结束页 \*/),{target:{value:'60'}});
  fireEvent.change(within(document.querySelector('#editor') as HTMLElement).getByLabelText(/申报页数 \*/),{target:{value:'11'}});
  fireEvent.click(within(document.querySelector('#editor') as HTMLElement).getByText('保存并复核'));
  // 未归还记录仍是借出时的快照
  expect(within(openList()).getByText('第一件')).toBeTruthy();
  expect(within(openList()).getByText('B1')).toBeTruthy();
  expect(within(openList()).getByText('1–10')).toBeTruthy();
  expect(within(openList()).queryByText('改名后的第一件')).toBeNull();
  expect(within(openList()).queryByText('B9')).toBeNull();
  // 归还后删除档案：历史记录仍可查阅原快照
  fireEvent.click(within(openList()).getByText('归还'));
  vi.spyOn(window,'confirm').mockReturnValue(true);
  fireEvent.click(within(rowOf('A-001')).getByText('删除'));
  expect(rowOf('A-001')).toBeUndefined();
  expect(within(historyList()).getByText('A-001')).toBeTruthy();
  expect(within(historyList()).getByText('第一件')).toBeTruthy();
  expect(within(historyList()).getByText('B1')).toBeTruthy();
  expect(within(historyList()).getByText('1–10')).toBeTruthy();
  expect(storedBorrows()).toHaveLength(1);
 });

 it('JSON 备份恢复不导入也不清除借阅记录',async()=>{
  setup();const{container}=render(<App/>);
  startBorrow('A-001');
  fillForm('张三','2099-01-01');
  confirmBorrow();
  const before=storedBorrows();
  expect(before).toHaveLength(1);
  // 备份中夹带借阅记录字段也不会被导入
  const foreign={id:'fake-borrow',archiveId:'id2',archiveNo:'A-002',title:'第二件',boxNo:'B1',startPage:11,endPage:20,borrower:'外来记录',borrowedAt:'2020-01-01T00:00:00.000Z',dueDate:'2020-01-02',returnedAt:null};
  const backup={...makeBackup(seed,{}),borrows:[foreign]};
  const input=container.querySelector('input[accept=".json,application/json"]') as HTMLInputElement;
  fireEvent.change(input,{target:{files:[new File([JSON.stringify(backup)],'备份.json',{type:'application/json'})]}});
  await waitFor(()=>{if(!container.querySelector('.notice'))throw new Error('等待导入结果')});
  // 借阅记录既未被清除也未被导入：仍是原来那一条，档案仍显示借出中
  expect(storedBorrows()).toEqual(before);
  expect(within(rowOf('A-001')).getByText('借出中')).toBeTruthy();
  expect(within(openList()).getByText('张三')).toBeTruthy();
  expect(within(openList()).queryByText('外来记录')).toBeNull();
  expect(within(desk()).getByText('1 件借出中')).toBeTruthy();
 });
});
