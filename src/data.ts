import type {Archive,Backup,Issue,Resolutions} from './types';

export const PAGE_MAX=999999;
export const CSV_HEADERS=['档号','标题','年度','保管期限','盒号','起始页','结束页','申报页数','备注'];
export const sampleArchives:Archive[]=[
 {id:'sample-1',archiveNo:'ZK-2024-001',title:'年度工作总结',year:2024,retention:'30年',boxNo:'A-01',startPage:1,endPage:18,declaredPages:18,note:''},
 {id:'sample-2',archiveNo:'ZK-2024-002',title:'项目验收材料',year:2024,retention:'永久',boxNo:'A-01',startPage:19,endPage:35,declaredPages:15,note:'待核实附件'},
 {id:'sample-3',archiveNo:'ZK-2023-008',title:'会议纪要汇编',year:2023,retention:'10年',boxNo:'A-02',startPage:1,endPage:12,declaredPages:12,note:''},
];
const uid=()=>globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random()}`;

function parseRows(text:string):string[][]{
 const rows:string[][]=[];let row:string[]=[];let cell='';let quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)throw new Error('CSV 存在未闭合的引号');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}return rows;
}
export function importCsv(text:string,existing:Archive[]=[]):Archive[]{
 const rows=parseRows(text.replace(/^\uFEFF/,''));if(!rows.length)throw new Error('CSV 文件为空');
 if(rows[0].length!==CSV_HEADERS.length||rows[0].some((v,i)=>v.trim()!==CSV_HEADERS[i]))throw new Error(`表头必须为：${CSV_HEADERS.join(',')}`);
 const errors:string[]=[];const result:Archive[]=[];const seen=new Set(existing.map(a=>a.archiveNo));
 rows.slice(1).forEach((cells,index)=>{const line=index+2;if(cells.length===1&&cells[0].trim()==='')return;if(cells.length!==CSV_HEADERS.length){errors.push(`第 ${line} 行：列数应为 ${CSV_HEADERS.length}`);return;}const v=cells.map(x=>x.trim());
  const required=[0,1,2,3,4,5,6,7];required.forEach(i=>{if(!v[i])errors.push(`第 ${line} 行：${CSV_HEADERS[i]}不能为空`)});
  const nums=[2,5,6,7].map(i=>Number(v[i]));[2,5,6,7].forEach((col,j)=>{if(!Number.isInteger(nums[j])||nums[j]<0||nums[j]>PAGE_MAX)errors.push(`第 ${line} 行：${CSV_HEADERS[col]}须为 0–${PAGE_MAX} 的整数`)});
  if(v[0]&&seen.has(v[0]))errors.push(`第 ${line} 行：档号“${v[0]}”重复`);else if(v[0])seen.add(v[0]);
  if(Number.isInteger(nums[1])&&Number.isInteger(nums[2])&&nums[2]<nums[1])errors.push(`第 ${line} 行：结束页不能小于起始页`);
  result.push({id:uid(),archiveNo:v[0],title:v[1],year:nums[0],retention:v[3],boxNo:v[4],startPage:nums[1],endPage:nums[2],declaredPages:nums[3],note:v[8]});
 });if(errors.length)throw new Error(errors.join('\n'));return result;
}
export function detectIssues(archives:Archive[]):Issue[]{const issues:Issue[]=[];const counts=new Map<string,number>();archives.forEach(a=>counts.set(a.archiveNo,(counts.get(a.archiveNo)||0)+1));
 const add=(a:Archive,kind:Issue['kind'],reason:string,keyExtra='')=>issues.push({key:`${a.id}:${kind}${keyExtra}`,archiveId:a.id,archiveNo:a.archiveNo,pages:`${a.startPage}–${a.endPage}`,kind,reason});
 archives.forEach(a=>{if((counts.get(a.archiveNo)||0)>1)add(a,'duplicate','档号重复');if(a.endPage<a.startPage)add(a,'reversed','结束页小于起始页');else if(a.endPage-a.startPage+1!==a.declaredPages)add(a,'count',`区间共 ${a.endPage-a.startPage+1} 页，与申报 ${a.declaredPages} 页不符`)});
 const boxes=new Map<string,Archive[]>();archives.forEach(a=>boxes.set(a.boxNo,[...(boxes.get(a.boxNo)||[]),a]));boxes.forEach(group=>{const sorted=[...group].sort((a,b)=>a.startPage-b.startPage);for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){const a=sorted[i],b=sorted[j];if(b.startPage>a.endPage)break;if(a.startPage<=b.endPage&&b.startPage<=a.endPage){add(a,'overlap',`与 ${b.archiveNo} 页码区间重叠`,`:${b.id}`);add(b,'overlap',`与 ${a.archiveNo} 页码区间重叠`,`:${a.id}`)}}});return issues;}
export type Filters={query:string;year:string;box:string;status:'all'|'pending'|'fixed'|'kept'};
export function filterArchives(archives:Archive[],issues:Issue[],resolutions:Resolutions,f:Filters){return archives.filter(a=>{const related=issues.filter(i=>i.archiveId===a.id);const statuses:Filters['status'][]=related.map(i=>resolutions[i.key]?.status||'pending');return(!f.query||a.title.toLowerCase().includes(f.query.toLowerCase())||a.archiveNo.toLowerCase().includes(f.query.toLowerCase()))&&(!f.year||String(a.year)===f.year)&&(!f.box||a.boxNo===f.box)&&(f.status==='all'||statuses.includes(f.status));});}
function validArchive(a:unknown):a is Archive{if(!a||typeof a!=='object')return false;const x=a as Record<string,unknown>;return ['id','archiveNo','title','retention','boxNo','note'].every(k=>typeof x[k]==='string')&&['year','startPage','endPage','declaredPages'].every(k=>Number.isInteger(x[k])&&(x[k] as number)>=0&&(x[k] as number)<=PAGE_MAX);}
export function makeBackup(archives:Archive[],resolutions:Resolutions):Backup{return{version:1,exportedAt:new Date().toISOString(),archives,resolutions}}export function parseBackup(text:string):Backup{let x:unknown;try{x=JSON.parse(text)}catch{throw new Error('无效备份：不是合法 JSON')}if(!x||typeof x!=='object')throw new Error('无效备份：格式错误');const b=x as Record<string,unknown>;if(b.version!==1||!Array.isArray(b.archives)||!b.archives.every(validArchive)||!b.resolutions||typeof b.resolutions!=='object'||Array.isArray(b.resolutions))throw new Error('无效备份：结构或档案字段错误');for(const value of Object.values(b.resolutions as Record<string,unknown>)){if(!value||typeof value!=='object'||!['fixed','kept'].includes(String((value as Record<string,unknown>).status))||typeof (value as Record<string,unknown>).note!=='string')throw new Error('无效备份：问题处置字段错误')}return b as unknown as Backup}

// 连续编页：按当前起始页、结束页、档号稳定排序后，依据每件申报页数依次生成连续区间；排序键完全相同时保留原有次序，不再按内部标识重排
export const boxOrder=(a:Archive,b:Archive)=>a.startPage-b.startPage||a.endPage-b.endPage||(a.archiveNo<b.archiveNo?-1:a.archiveNo>b.archiveNo?1:0);
export type RepageRow={archive:Archive;oldStart:number;oldEnd:number;newStart:number;newEnd:number;resolutionCount:number};
export type RepagePreview={box:string;startPage:number;rows:RepageRow[];fingerprint:string}|{error:string};
export function parseStartPage(raw:string):number|{error:string}{const t=raw.trim();if(t==='')return{error:'请填写起始页'};if(!/^\d+$/.test(t))return{error:'起始页须为非负整数'};const n=Number(t);if(n>PAGE_MAX)return{error:`起始页不能超过页码上限 ${PAGE_MAX}`};return n}
// 盒内档案（含其处置）的指纹：同盒数据（题名、年度、期限、页码等任一字段）变化后旧预览必须作废，他盒变化不影响
export function repageFingerprint(archives:Archive[],resolutions:Resolutions,box:string):string{
 const inBox=archives.filter(a=>a.boxNo===box);
 const items=inBox.map(a=>[a.id,a.archiveNo,a.title,a.year,a.retention,a.startPage,a.endPage,a.declaredPages,a.note]).sort((x,y)=>x[0]<y[0]?-1:x[0]>y[0]?1:0);
 // 处置键形如 `${id}:...`，档案标识本身可能含冒号，须以前缀匹配归属，不能按首个冒号截断
 const res=Object.keys(resolutions).filter(k=>inBox.some(a=>k.startsWith(`${a.id}:`))).sort().map(k=>[k,resolutions[k].status,resolutions[k].note]);
 return JSON.stringify({items,res});
}
export function buildRepagination(archives:Archive[],resolutions:Resolutions,box:string,rawStart:string):RepagePreview{
 if(!archives.some(a=>a.boxNo===box))return{error:'所选盒号不存在或盒内没有档案'};
 const start=parseStartPage(rawStart);if(typeof start!=='number')return start;
 const rows:RepageRow[]=[];let cursor=start;
 for(const a of archives.filter(x=>x.boxNo===box).sort(boxOrder)){
  const pages=a.declaredPages;
  if(pages<=0)return{error:`${a.archiveNo} 申报页数为 ${pages}，无法生成有效页码区间，请先修正该件申报页数`};
  const newEnd=cursor+pages-1;
  if(cursor>PAGE_MAX||newEnd>PAGE_MAX)return{error:`${a.archiveNo} 重排后页码超过上限 ${PAGE_MAX}，请减小起始页或申报页数`};
  const resolutionCount=Object.keys(resolutions).filter(k=>k.startsWith(`${a.id}:`)).length;
  rows.push({archive:a,oldStart:a.startPage,oldEnd:a.endPage,newStart:cursor,newEnd,resolutionCount});cursor=newEnd+1;
 }
 return{box,startPage:start,rows,fingerprint:repageFingerprint(archives,resolutions,box)};
}
export function applyRepagination(archives:Archive[],resolutions:Resolutions,preview:Exclude<RepagePreview,{error:string}>):{archives:Archive[];resolutions:Resolutions}{
 if(repageFingerprint(archives,resolutions,preview.box)!==preview.fingerprint)throw new Error('盒内档案已变化，请重新预览后再确认');
 // 指纹已保证盒内数据与预览时一致：重放同一排序并按位配对，同盒重复内部标识时每件仍写入各自区间
 const rowOf=new Map<Archive,RepageRow>();
 archives.filter(a=>a.boxNo===preview.box).sort(boxOrder).forEach((a,i)=>rowOf.set(a,preview.rows[i]));
 const next=archives.map(a=>{const r=rowOf.get(a);return r?{...a,startPage:r.newStart,endPage:r.newEnd}:a});
 const kept=Object.fromEntries(Object.entries(resolutions).filter(([k])=>!preview.rows.some(r=>k.startsWith(`${r.archive.id}:`))));
 return{archives:next,resolutions:kept};
}
