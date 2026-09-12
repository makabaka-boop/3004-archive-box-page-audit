import{useEffect,useState}from'react';
import type{Archive,BorrowRecord}from'./types';

const fmt=(iso:string)=>{const t=new Date(iso);return Number.isNaN(t.getTime())?iso:t.toLocaleString()};

// 独立借阅台：集中展示未归还记录与历史记录，只读写借阅记录，不改动档案登记、异常处置与盘点会话
export default function BorrowPanel({records,target,error,onConfirm,onCancel,onReturn}:{
 records:BorrowRecord[];
 target:Archive|null;
 error:string|null;
 onConfirm:(borrower:string,due:string)=>void;
 onCancel:()=>void;
 onReturn:(recordId:string)=>void;
}){
 const[borrower,setBorrower]=useState('');
 const[due,setDue]=useState('');
 const targetId=target?.id;
 // 换一个借阅目标时重置表单；校验失败时目标不变，输入原样保留
 useEffect(()=>{setBorrower('');setDue('')},[targetId]);
 const open=records.filter(r=>r.returnedAt===null);
 const history=records.filter(r=>r.returnedAt!==null);
 const submit=(e:React.FormEvent)=>{e.preventDefault();onConfirm(borrower,due)};
 const row=(r:BorrowRecord,last:React.ReactNode)=><tr key={r.id}>
  <td><strong>{r.archiveNo}</strong><small>{r.title}</small></td>
  <td><b>{r.boxNo}</b></td>
  <td>{r.startPage}–{r.endPage}</td>
  <td>{r.borrower}</td>
  <td>{fmt(r.borrowedAt)}</td>
  <td>{r.dueDate}</td>
  {last}
 </tr>;
 return<section className="panel borrow" id="borrowdesk">
  <div className="section-head"><div><span className="kicker">05 / BORROW</span><h2>借阅台</h2></div><span className="count">{open.length} 件借出中</span></div>
  {target&&<form className="borrow-form" aria-label="借出登记" onSubmit={submit}>
   <p className="borrow-target">借出档案：<strong>{target.archiveNo}</strong> {target.title}<code>盒 {target.boxNo} · {target.startPage}–{target.endPage} 页</code></p>
   <div className="borrow-controls">
    <label>查阅人 *<input aria-label="查阅人" value={borrower} onChange={e=>setBorrower(e.target.value)} placeholder="查阅人姓名"/></label>
    <label>预计归还日 *<input aria-label="预计归还日" value={due} onChange={e=>setDue(e.target.value)} placeholder="YYYY-MM-DD" inputMode="numeric"/></label>
    <button className="primary" type="submit">确认借出</button>
    <button type="button" onClick={onCancel}>取消</button>
   </div>
   {error&&<p className="borrow-error" role="alert">{error}</p>}
  </form>}
  <div className="borrow-list" aria-label="未归还记录">
   <h3>未归还（{open.length}）</h3>
   {open.length===0?<p className="borrow-empty">当前没有未归还记录。</p>:<div className="table-wrap"><table>
    <thead><tr><th>档号 / 题名</th><th>盒号</th><th>页码</th><th>查阅人</th><th>借出时间</th><th>预计归还日</th><th>操作</th></tr></thead>
    <tbody>{open.map(r=>row(r,<td><button type="button" onClick={()=>onReturn(r.id)}>归还</button></td>))}</tbody>
   </table></div>}
  </div>
  <div className="borrow-list" aria-label="借阅历史">
   <h3>历史记录（{history.length}）</h3>
   {history.length===0?<p className="borrow-empty">暂无历史记录。</p>:<div className="table-wrap"><table>
    <thead><tr><th>档号 / 题名</th><th>盒号</th><th>页码</th><th>查阅人</th><th>借出时间</th><th>预计归还日</th><th>归还时间</th></tr></thead>
    <tbody>{history.map(r=>row(r,<td>{r.returnedAt?fmt(r.returnedAt):''}</td>))}</tbody>
   </table></div>}
  </div>
 </section>;
}
