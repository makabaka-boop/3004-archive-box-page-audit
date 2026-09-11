import{useEffect,useMemo,useRef,useState}from'react';
import{canVerifyOrder,firstMismatch,foundCount,isLegacySession,itemSeq,markFound,nextPhysicalSeq,orderRows,scanArchiveNo}from'./inventory';
import type{InventoryItem,InventorySession}from'./types';

const fmt=(iso:string)=>{const t=new Date(iso);return Number.isNaN(t.getTime())?iso:t.toLocaleString()};

// 独立的盒内盘点面板：只读写盘点会话快照，不改动档案登记信息
export default function InventoryPanel({box,session,onStart,onSession}:{box:string;session:InventorySession|undefined;onStart:()=>void;onSession:(s:InventorySession)=>void}){
 const[input,setInput]=useState('');
 const[candidates,setCandidates]=useState<InventoryItem[]|null>(null);
 const[message,setMessage]=useState<{kind:'ok'|'error'|'info';text:string}|null>(null);
 const inputRef=useRef<HTMLInputElement>(null);
 const sessionId=session?.id;
 // 换一会话（开始/重新盘点）时清空输入、候选与提示等临时状态；重新盘点生成全新序列
 useEffect(()=>{setInput('');setCandidates(null);setMessage(null)},[sessionId]);
 const found=session?foundCount(session):0;
 const total=session?.items.length??0;
 const done=!!session?.completedAt;
 const legacy=session?isLegacySession(session):false;
 const mismatch=useMemo(()=>session?firstMismatch(session):null,[session]);

 const submit=(e:React.FormEvent)=>{
  e.preventDefault();
  if(!session||done)return;
  const raw=input.trim();
  setInput('');
  inputRef.current?.focus();
  if(!raw){setCandidates(null);setMessage({kind:'error',text:'请先扫描或输入档号'});return}
  const out=scanArchiveNo(session,raw);
  if(out.kind==='found'){
   onSession(out.session);
   setCandidates(null);
   const seq=itemSeq(session,out.item);
   const physical=nextPhysicalSeq(session);
   setMessage({kind:'ok',text:out.session.completedAt?`第 ${seq} 项「${out.item.archiveNo}」已登记为已找到（实物序号 ${physical}），全部命中，盘点自动完成`:`第 ${seq} 项「${out.item.archiveNo}」已登记为已找到，实物序号 ${physical}（${found+1}/${total}）`});
  }else if(out.kind==='ambiguous'){
   setCandidates(out.candidates);
   setMessage({kind:'info',text:`档号「${raw}」在快照中共有 ${out.matched} 件，请明确选中一件才会推进进度`});
  }else if(out.kind==='duplicate'){
   setCandidates(null);
   setMessage({kind:'error',text:`档号「${raw}」已登记过，重复扫描不推进进度、不消耗实物序号，快照与计数保持不变`});
  }else{
   setCandidates(null);
   setMessage({kind:'error',text:`档号「${raw}」不在本盒盘点快照中，快照与计数保持不变`});
  }
 };

 const pick=(item:InventoryItem)=>{
  if(!session)return;
  const r=markFound(session,item.itemId);
  setCandidates(null);
  if('error'in r){setMessage({kind:'error',text:r.error});return}
  onSession(r.session);
  const seq=itemSeq(session,r.item);
  const physical=nextPhysicalSeq(session);
  setMessage({kind:'ok',text:r.session.completedAt?`已选中第 ${seq} 项，实物序号 ${physical}，全部命中，盘点自动完成`:`已选中第 ${seq} 项，「${r.item.archiveNo}」登记为已找到，实物序号 ${physical}（${found+1}/${total}）`});
  inputRef.current?.focus();
 };

 const cancel=()=>{setCandidates(null);setMessage({kind:'info',text:'已取消选择，不消耗实物序号，快照与计数保持不变'});inputRef.current?.focus()};

 return<section className="inventory-panel" aria-label={`盒 ${box} 盒内盘点`}>
  <div className="inv-head"><span className="kicker">盒内盘点</span>{!session?<span className="inv-badge">未开始</span>:done?<span className="inv-badge done">已完成</span>:<span className="inv-badge doing">进行中</span>}</div>
  {!session?<>
   <p className="inv-tip">以当前盒内档案生成盘点快照，逐件扫描登记；不改动档案登记信息。</p>
   <button type="button" className="primary" onClick={onStart}>开始盘点</button>
  </>:<>
   <p className="inv-meta">会话创建于 {fmt(session.createdAt)} · 快照 {total} 件{done&&session.completedAt?` · 完成于 ${fmt(session.completedAt)}`:''}</p>
   <div className="inv-progress"><progress value={found} max={total}/><span>{found} / {total}</span></div>
   {message&&<p className={`inv-msg ${message.kind}`} role="status">{message.text}</p>}
   {legacy&&<p className="inv-legacy" role="status">该会话创建于实物序号功能上线前，已有登记缺少实物序号，只能显示原盘点进度，无法复核实体摆放顺序；如需复核请重新盘点。</p>}
   {done?<>
    {canVerifyOrder(session)?<>
     <div className="inv-done" role="status">✓ 全部 {total} 件已找到，本次盘点自动完成。</div>
     <div className="inv-order" aria-label="摆放顺序复核">
      <h4>摆放顺序复核（以创建快照时的盘点序号为期望顺序）</h4>
      <table className="inv-order-table"><thead><tr><th>期望序号</th><th>档号 / 题名</th><th>实物序号</th><th>结果</th></tr></thead>
       <tbody>{orderRows(session).map(r=><tr key={r.item.itemId} className={r.match?'ok':'mis'}>
        <td>{r.expectedSeq}</td>
        <td><strong>{r.item.archiveNo}</strong><small>{r.item.title}</small></td>
        <td>{r.physicalSeq}</td>
        <td>{r.match?'一致':'错位'}</td>
       </tr>)}</tbody></table>
      <p className={mismatch===null?'inv-order-summary ok':'inv-order-summary mis'} role="status">{mismatch===null?`全部 ${total} 件实物序号与期望序号一致，摆放顺序无误。`:`发现错位：首个错位位置为期望序号第 ${mismatch} 项。`}</p>
     </div>
    </>:<div className="inv-done legacy" role="status">✓ 全部 {total} 件已找到，但该会话为旧版记录、缺少实物序号，无法复核摆放顺序。</div>}
    <button type="button" onClick={onStart}>重新盘点</button>
   </>:<>
    <form className="inv-scan" onSubmit={submit}>
     <input ref={inputRef} aria-label="扫描或输入档号" value={input} onChange={e=>setInput(e.target.value)} placeholder="扫描或输入档号后回车"/>
     <button type="submit">登记</button>
    </form>
    {candidates&&<div className="inv-candidates" aria-label="歧义候选">
     <p>同一档号命中多件，请选中实际盘点的那一件：</p>
     {candidates.map(c=><div className="inv-candidate" key={c.itemId}>
      <span className="inv-seq">第 {itemSeq(session,c)} 项</span>
      <strong>{c.title}</strong>
      <code>{c.startPage}—{c.endPage}</code>
      <button type="button" onClick={()=>pick(c)}>选中此件</button>
     </div>)}
     <button type="button" onClick={cancel}>取消选择</button>
    </div>}
   </>}
   <ul className="inv-items">
    {session.items.map((it,idx)=><li key={it.itemId} className={it.found?'found':''}>
     <span className="inv-seq">{idx+1}</span>
     <span className="inv-no">{it.archiveNo}</span>
     <small>{it.title}</small>
     <code>{it.startPage}—{it.endPage}</code>
     {it.found&&<em className="inv-physical" data-match={it.physicalSeq===null?undefined:String(it.physicalSeq===idx+1)}>实物序号 {it.physicalSeq??'—'}</em>}
     <em>{it.found?'已找到':'待盘点'}</em>
    </li>)}
   </ul>
  </>}
 </section>;
}
