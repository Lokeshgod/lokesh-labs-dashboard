(function(){
const STAGES=[
  ["PACKAGE","Package"],
  ["SCHEMA","Schema"],
  ["STATIC","Static"],
  ["NOVELTY_1","Similarity / Novelty"],
  ["BUILD","Environment Build"],
  ["SECURITY","Security"],
  ["NOP","NOP"],
  ["ORACLE","Oracle"],
  ["VERIFIER","Verifier Integrity"],
  ["ADVERSARIAL","Anti-cheat"],
  ["QUALITY","Quality Review"],
  ["FEASIBILITY","Feasibility"],
  ["STRUCTURAL","ESS + Structural"],
  ["STRONG_AGENT","Strong Agent"],
  ["PER_TEST","Per-test Feasibility"],
  ["NOVELTY_2","Final Similarity"],
  ["RELEASE","Release Integrity"],
  ["FREEZE","Freeze / Accept"]
];
let data=null,lastGood=null,previousPositions={};
const el=id=>document.getElementById(id);
const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
function toast(msg){const x=el("toast");x.textContent=msg;x.classList.add("show");setTimeout(()=>x.classList.remove("show"),1300)}
function normalizeStatus(v){
  const s=String(v==null?"":v).toUpperCase();
  if(["PASS","PASSED","SUCCESS","PASS_STATIC"].includes(s))return"PASS";
  if(["FAIL","FAILED","ERROR","NO","REJECTED"].includes(s))return"FAIL";
  if(s.includes("PASS"))return"PASS";
  if(s.includes("FAIL")||s.includes("ERROR")||s.includes("REJECT"))return"FAIL";
  if(!s||s.includes("WAIT")||s.includes("UNVERIFIED")||s.includes("DEFER")||s.includes("PROVISIONAL")||s.includes("CANDIDATE"))return"WAITING";
  return"INFO";
}
function virtualPipeline(task){
  const base={};
  (task.pipeline||[]).forEach(g=>base[g.key]={key:g.key,label:g.label,status:normalizeStatus(g.status),raw:g.raw});
  const out=[];
  STAGES.forEach(([key,label])=>{
    if(key==="STRONG_AGENT"){
      let st="WAITING",raw=null;
      if(task.stage==="STRONG_AGENT"){st="INFO";raw="RUNNING"}
      else if(task.participant_attempted){st="PASS";raw="RECORDED"}
      out.push({key,label,status:st,raw});
    }else{
      out.push(base[key]||{key,label,status:"WAITING",raw:null});
    }
  });
  return out;
}
function taskState(task){
  const batch=data.marathon_batch||{},bt=(batch.task_status||{})[task.id]||{};
  const explicit=String(bt.state||"").toUpperCase();
  if(explicit==="RUNNING"||explicit==="REPAIRING"||explicit==="ACCEPTED"||explicit==="BLOCKED"||explicit==="RETIRED")return explicit;
  if(String(task.stage).startsWith("ACCEPTED"))return"ACCEPTED";
  if(task.stage==="REPAIRING")return"REPAIRING";
  if(["EXECUTING","STRONG_AGENT","RETESTING","READY"].includes(task.stage))return"RUNNING";
  return"WAITING";
}
function currentGate(task){
  const batch=data.marathon_batch||{},bt=(batch.task_status||{})[task.id]||{};
  if(bt.gate){
    const key=String(bt.gate).replace(/^GATE:\s*/,"").toUpperCase().replace(/\s+/g,"_");
    const direct=STAGES.findIndex(x=>x[0]===key);
    if(direct>=0)return direct;
    if(key.includes("STRONG"))return STAGES.findIndex(x=>x[0]==="STRONG_AGENT");
    if(key.includes("MODEL"))return STAGES.findIndex(x=>x[0]==="STRONG_AGENT");
  }
  if(String(task.stage).startsWith("ACCEPTED"))return STAGES.length-1;
  const pipe=virtualPipeline(task);
  for(let i=0;i<pipe.length;i++){
    if(pipe[i].key==="FREEZE")continue;
    if(pipe[i].status==="FAIL")return i;
    if(pipe[i].status!=="PASS")return i;
  }
  return STAGES.length-1;
}
function filteredTasks(){
  const q=el("search").value.trim().toLowerCase(),domain=el("domainFilter").value,state=el("stateFilter").value;
  return(data.tasks||[]).filter(t=>{
    const hay=[t.id,t.title,t.domain,t.archetype,t.subdomain].join(" ").toLowerCase();
    const st=taskState(t);
    return(!q||hay.includes(q))&&(!domain||t.domain===domain)&&(!state||st===state);
  });
}
function renderStats(){
  const tasks=data.tasks||[],accepted=tasks.filter(t=>taskState(t)==="ACCEPTED").length,
        repairing=tasks.filter(t=>taskState(t)==="REPAIRING").length,
        running=tasks.filter(t=>taskState(t)==="RUNNING").length;
  el("acceptedCount").textContent=accepted;
  el("activeCount").textContent=running;
  el("repairCount").textContent=repairing;
  el("remainingCount").textContent=Math.max(0,tasks.length-accepted);
}
function renderFilters(){
  const current=el("domainFilter").value;
  const domains=[...new Set((data.tasks||[]).map(t=>t.domain).filter(Boolean))].sort();
  el("domainFilter").innerHTML='<option value="">All domains</option>'+domains.map(d=>'<option '+(d===current?'selected':'')+'>'+esc(d)+'</option>').join("");
}
function stationX(i){const left=90,right=3510;return left+(right-left)*(i/(STAGES.length-1))}
function renderPipeline(){
  const tasks=filteredTasks();
  const byStage=Array.from({length:STAGES.length},()=>[]);
  tasks.forEach(t=>byStage[currentGate(t)].push(t));
  let html="";
  STAGES.forEach(([key,label],i)=>{
    const rows=byStage[i];
    const hasRepair=rows.some(t=>taskState(t)==="REPAIRING");
    const hasActive=rows.some(t=>taskState(t)==="RUNNING");
    const hasPass=rows.length>0&&!hasRepair&&!hasActive&&rows.some(t=>taskState(t)==="ACCEPTED"||currentGate(t)>i);
    const cls=hasRepair?"has-repair":hasActive?"has-active":hasPass?"has-pass":"";
    html+='<div class="station '+cls+'" data-stage="'+key+'" style="left:'+stationX(i)+'px">'+
      '<div class="station-index">'+String(i+1).padStart(2,"0")+'</div>'+
      '<div class="station-label">'+esc(label)+'</div>'+
      '<div class="station-valve"></div><div class="station-stem"></div>'+
      '<div class="task-cluster">'+rows.slice(0,8).map(t=>capsule(t)).join("")+
      (rows.length>8?'<div class="task-capsule">+'+(rows.length-8)+' more</div>':'')+'</div>'+
      '<div class="station-count">'+rows.length+'</div></div>';
  });
  el("stations").innerHTML=html;
  bindTaskClicks();
  const positioned=tasks.filter(t=>taskState(t)!=="WAITING").length;
  el("pipelineSummary").textContent=tasks.length+" visible · "+positioned+" active/repair/accepted · "+STAGES.length+" strict gates";
  maybeFollowActive(tasks);
}
function capsule(t){
  const st=taskState(t),cls=st.toLowerCase();
  const short=t.id.replace(/^llb-/,"");
  const idx=currentGate(t);
  const moved=previousPositions[t.id]!=null&&previousPositions[t.id]!==idx;
  previousPositions[t.id]=idx;
  return '<button class="task-capsule '+cls+(moved?' moved':'')+'" data-task="'+esc(t.id)+'" title="'+esc(t.title)+'">'+esc(short)+'</button>';
}
function maybeFollowActive(tasks){
  const current=(data.marathon_batch||{}).current_task;
  const t=tasks.find(x=>x.id===current);
  if(!t)return;
  const viewport=el("pipeViewport"),target=stationX(currentGate(t));
  const desired=Math.max(0,target-viewport.clientWidth*.45);
  if(Math.abs(viewport.scrollLeft-desired)>250)viewport.scrollTo({left:desired,behavior:"smooth"});
}
function renderTaskList(){
  const tasks=filteredTasks().sort((a,b)=>currentGate(b)-currentGate(a)||a.id.localeCompare(b.id));
  el("visibleCount").textContent=tasks.length+" tasks";
  el("taskList").innerHTML=tasks.map(t=>{
    const idx=currentGate(t),st=taskState(t);
    return '<div class="task-row" data-task="'+esc(t.id)+'"><div class="task-main"><b>'+esc(t.title)+'</b><small>'+esc(t.id)+'</small></div>'+
      '<div class="task-domain">'+esc(t.domain)+' · '+esc(t.archetype)+'</div>'+
      '<div class="task-stage">'+String(idx+1).padStart(2,"0")+' · '+esc(STAGES[idx][1])+'</div>'+
      '<div class="task-state '+st+'">'+esc(st)+'</div></div>';
  }).join("")||'<div style="padding:20px;color:#71869d">No tasks match these filters.</div>';
  bindTaskClicks();
}
function renderRun(){
  const b=data.marathon_batch||{};
  el("batchBadge").textContent=b.status||"MANUAL";
  const current=b.current_task||"No task currently marked as running";
  const gate=b.current_gate||"Waiting for next manual pipeline update";
  el("currentRun").innerHTML='<div class="run-main"><span>CURRENT TASK</span><b>'+esc(current)+'</b><small>'+esc(gate)+'</small></div>'+
    '<div class="run-grid"><div><b>'+esc(b.completed||0)+'</b><span>Completed</span></div><div><b>'+esc(b.accepted||0)+'</b><span>Accepted</span></div><div><b>'+esc(b.repairing||0)+'</b><span>Repairing</span></div></div>';
}
function renderActivity(){
  const items=(data.activity||[]).slice(0,6);
  el("activity").innerHTML=items.map(a=>'<div class="activity-item"><b>'+esc(a.type||"UPDATE")+' · '+esc(a.title||"Pipeline update")+'</b><p>'+esc(a.detail||"")+'</p></div>').join("")||
    '<div class="activity-item"><b>MANUAL PIPELINE</b><p>Waiting for the next recorded transition.</p></div>';
}
function openTask(id){
  const t=(data.tasks||[]).find(x=>x.id===id);if(!t)return;
  const p=virtualPipeline(t),idx=currentGate(t),st=taskState(t);
  const passes=p.filter(x=>x.status==="PASS").length;
  const fails=p.filter(x=>x.status==="FAIL").length;
  const failures=(t.failure_codes||[]).length?'<div class="failure-box"><b>Current failure / repair reason</b><br>'+esc(t.failure_codes.join(" · "))+'</div>':"";
  el("drawerContent").innerHTML='<div class="drawer-id">'+esc(t.id)+'</div><h2>'+esc(t.title)+'</h2>'+
    '<div class="drawer-meta">'+esc(t.domain)+' · '+esc(t.archetype)+(t.subdomain?' · '+esc(t.subdomain):'')+'</div>'+
    '<div class="drawer-kpis"><div class="drawer-kpi"><b>'+esc(st)+'</b><span>State</span></div><div class="drawer-kpi"><b>'+String(idx+1).padStart(2,"0")+'</b><span>Current gate</span></div><div class="drawer-kpi"><b>'+(t.ess==null?'—':esc(t.ess))+'</b><span>ESS</span></div><div class="drawer-kpi"><b>'+(t.structural_score==null?'—':esc(t.structural_score)+'/20')+'</b><span>Structural</span></div></div>'+
    failures+
    '<div class="gate-list">'+p.map((g,i)=>'<div class="gate-row"><div class="gate-num">'+String(i+1).padStart(2,"0")+'</div><div><b>'+esc(g.label)+'</b><small>'+esc(g.raw==null?"No fresh evidence yet":g.raw)+'</small></div><span class="gate-status '+g.status+'">'+g.status+'</span></div>').join("")+'</div>';
  el("drawer").classList.add("show");el("backdrop").classList.add("show");
}
function bindTaskClicks(){
  document.querySelectorAll("[data-task]").forEach(n=>{n.onclick=e=>{e.stopPropagation();openTask(n.getAttribute("data-task"))}});
}
function renderFreshness(){
  const dt=new Date(data.generated_at),age=(Date.now()-dt.getTime())/1000;
  const fresh=!isNaN(dt)&&age<180;
  el("livePulse").classList.toggle("off",!fresh);
  el("freshness").textContent=isNaN(dt)?"Live feed connected":"Updated "+dt.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+(fresh?" · LIVE":" · STALE");
}
function render(){if(!data)return;renderStats();renderFilters();renderPipeline();renderTaskList();renderRun();renderActivity();renderFreshness()}
async function load(silent){
  try{
    const r=await fetch("status.json?t="+Date.now(),{cache:"no-store"});if(!r.ok)throw new Error("HTTP "+r.status);
    data=await r.json();lastGood=data;render();if(!silent)toast("Pipeline refreshed");
  }catch(e){if(lastGood){data=lastGood;render()}el("livePulse").classList.add("off");el("freshness").textContent="Feed reconnecting…"}
}
["search","domainFilter","stateFilter"].forEach(id=>el(id).addEventListener(id==="search"?"input":"change",()=>{renderPipeline();renderTaskList()}));
el("refreshBtn").onclick=()=>load(false);
el("drawerClose").onclick=()=>{el("drawer").classList.remove("show");el("backdrop").classList.remove("show")};
el("backdrop").onclick=el("drawerClose").onclick;
document.addEventListener("keydown",e=>{if(e.key==="Escape")el("drawerClose").click()});
load(true);setInterval(()=>load(true),15000);
})();