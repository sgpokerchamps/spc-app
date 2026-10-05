/* ============================================================
   02_utils.js
   Pure helper functions: formatting, seat assignment, QR parsing,
   payout table generation, tournament export/import, localStorage
   persistence for saved tournaments. No component state, no JSX.
   (Note: potyKey/loadPOTYForYear/initPOTY/savePOTY/getPotyYears/
   getPotyPoints live in 03_poty.js, not here, since they form a
   cohesive POTY module of their own per the file plan.)
   ============================================================ */

/* ==== UTILITIES ==== */
const fmt = {
  time(s) { if(s<0)s=0; const m=Math.floor(s/60),sec=s%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`; },
  chips(n) { if(!n&&n!==0)return'—'; if(n>=1000000)return(n/1000000).toFixed(1).replace(/\.0$/,'')+'M'; if(n>=1000)return(n/1000).toFixed(1).replace(/\.0$/,'')+'K'; return n.toLocaleString(); },
  currency(n) { return `S$${Number(n||0).toLocaleString()}`; },
  ago(ms) { const m=Math.round((Date.now()-ms)/60000); if(m<2)return'just now'; if(m<60)return`${m}m ago`; const h=Math.round(m/60); return`${h}h ago`; },
  ordinal(n) { const s=['th','st','nd','rd']; const v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); },
};
/* Single formatter for a schedule entry (level or break/colour-up). Used by the desktop Next lines and the floor clock broadcast. */
function formatNextEntry(nxt, compact) {
  if(!nxt) return '';
  return nxt.isBreak?`Break${nxt.note?' — '+nxt.note:''} (${nxt.mins} min)`:`Level ${nxt.level} — ${fmt.chips(nxt.sb)}/${fmt.chips(nxt.bb)}${nxt.ante?(compact?'/'+fmt.chips(nxt.ante):' · Ante '+fmt.chips(nxt.ante)):''} · ${nxt.mins} min`;
}
/* ==== SATELLITE (seat guarantee + seat-based payouts) ====
   Satellite only. Everything is DERIVED from the live entry count on every call - nothing here is stored, so
   re-entries can never leave a stale seat count. Seats are NEVER money: they are not ladder rows and never reach
   payout_amount / payout_amount_deal / total_prize or POTY. The only S$ figure is the bubble leftover. */
function isSatellite(t) { return !!t&&t.eventType==='satellite'; }
function getSatelliteSeats(t) {
  const entries=(t.players||[]).length+(t.inheritedEntries||0);
  const ppe=(t.prizePerEntry>0)?t.prizePerEntry:(t.prizeComponent||0)*(1-(t.adminFeePercent||0)/100);
  const pool=Math.round(entries*ppe*100)/100;
  const seatValue=t.seatValue>0?t.seatValue:600;
  const guaranteed=t.guaranteedSeats>0?Math.floor(t.guaranteedSeats):10;
  const fromPool=Math.floor(pool/seatValue);
  const wanted=Math.max(guaranteed,fromPool);
  const seats=entries>0?Math.min(wanted,entries):wanted;
  const seatsTotal=seats*seatValue;
  const overlay=seatsTotal>pool?Math.round((seatsTotal-pool)*100)/100:0;
  const leftover=(entries>seats&&!overlay)?Math.round((pool-seatsTotal)*100)/100:0;
  return {entries,pool,seatValue,guaranteed,seats,seatsTotal,fromGuarantee:guaranteed>=fromPool,overlay,leftover,
    bubblePos:leftover>0?seats+1:null,allSeats:entries>0&&entries<=wanted,perSeatEntries:Math.max(1,Math.ceil(seatValue/(ppe||1)))};
}
function getSatelliteLadder(t) {
  const s=getSatelliteSeats(t);
  return s.bubblePos?[{position:s.bubblePos,pct:0,amount:s.leftover,bubble:true}]:[];
}
function effectivePayoutTable(t) { return isSatellite(t)?getSatelliteLadder(t):(t.payoutTable||[]); }
function satelliteBroadcast(t) {
  if(!isSatellite(t)) return null;
  const s=getSatelliteSeats(t);
  return {seats:s.seats,seatValue:s.seatValue,leftover:s.leftover,overlay:s.overlay,bubblePos:s.bubblePos,allSeats:s.allSeats,pool:s.pool,entries:s.entries,fromGuarantee:s.fromGuarantee};
}
function getPayouts(entries, prizePool) {
  const keys=Object.keys(PAYOUT_DATA).map(Number).sort((a,b)=>a-b);
  const key=keys.find(k=>k>=entries)||keys[keys.length-1];
  return PAYOUT_DATA[key].map((pct,i)=>({position:i+1,pct,amount:Math.floor((pct/100)*prizePool/100)*100}));
}

/* ---- Finishing position (bust order) helpers, shared by the Payouts tab and the floor broadcast ---- */
// A player who busted, then re-entered, then busted again has TWO 'busted' records under the same
// name (addPlayer creates a fresh record on re-entry and never touches the old one). Only the most
// recent bust (by bustedAt, which every bust sets) is their real finishing position; a currently
// active record for that name means they have not finished, even if an older busted record exists.
function getFinishingPositions(players) {
  const byName = {};
  (players||[]).forEach(p=>{ (byName[p.name]=byName[p.name]||[]).push(p); });
  const positions = {};
  Object.keys(byName).forEach(name=>{
    const recs = byName[name];
    if (recs.some(p=>p.status==='active')) return;
    const busted = recs.filter(p=>p.status==='busted'&&p.bustPosition!=null);
    if (!busted.length) return;
    busted.sort((a,b)=>(b.bustedAt||0)-(a.bustedAt||0));
    positions[name] = {position:busted[0].bustPosition, bustedAt:busted[0].bustedAt||0, id:busted[0].id};
  });
  return positions;
}
// The winner never busts, so there is no bustPosition/status marker for 1st place anywhere in the
// data model - the only real signal is that exactly one active player remains.
function getWinnerName(players) {
  const active = (players||[]).filter(p=>p.status==='active');
  return active.length===1 ? active[0].name : null;
}
// Phantom bust removal: no elimination actually happened at `id`'s recorded position P. Every OTHER
// busted record (any name, any re-entry generation) with bustPosition < P is one place better than
// recorded, since it was snapshotted against a field one player too small. Shared, single source of
// truth for both the desktop preview (read-only) and the committing reducer, so they can never drift.
// Returns null if `id` isn't a currently-busted player with a recorded position (nothing to remove).
function simulateRemovePhantomBust(players, id) {
  const x = (players||[]).find(p=>p.id===id);
  if (!x || x.status!=='busted' || x.bustPosition==null) return null;
  const P = x.bustPosition;
  return players.map(p=>{
    if (p.id===x.id) return {...p, status:'active', bustPosition:undefined, bustedAt:undefined};
    if (p.status==='busted' && p.bustPosition!=null && p.bustPosition<P) return {...p, bustPosition:p.bustPosition+1};
    return p;
  });
}

function getTableNumbers(tournament) {
  if(tournament.tableNumbers && tournament.tableNumbers.length) return tournament.tableNumbers.slice();
  const startTable=tournament.startTable||1;
  const maxTables=tournament.maxTables||15;
  const out=[];
  for(let i=0;i<maxTables;i++) out.push(startTable+i);
  return out;
}
/* ---- Day 2 inheritance (multi-parent). Flights are independent; Day 2 combines the ticked ones. ---- */
function normName(n){ return String(n||'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase(); }
function nameTokenKey(n){ return normName(n).split(' ').sort().join(' '); }
/* Dedupe survivors by normalised name (best stack wins), count extra bags (qualifications - 1 per name), seat round-robin at the chosen tables. */
function seatDay2(inheritedPlayers, tableNums, spt, makeId){
  const keyOf=p=>normName(p.name);
  const best={}, counts={}, ctry={}, nice={};
  (inheritedPlayers||[]).forEach(p=>{
    const k=keyOf(p);
    counts[k]=(counts[k]||0)+1;
    if(p.country) ctry[k]=p.country;
    if(!best[k]||(p.chipCount||0)>(best[k].chipCount||0)) best[k]=p;
    if(p.name!==p.name.toLowerCase()&&!nice[k]) nice[k]=p.name;
  });
  Object.keys(best).forEach(k=>{ if(nice[k]) best[k]={...best[k],name:nice[k]}; });
  const deduped=Object.keys(best).map(k=>best[k]);
  const extraBagWinners=[]; let totalExtraBags=0;
  Object.keys(counts).forEach(k=>{
    if(counts[k]>1){ extraBagWinners.push({name:best[k].name,bags:counts[k]-1,totalQualifications:counts[k],country:ctry[k]||null}); totalExtraBags+=counts[k]-1; }
  });
  extraBagWinners.sort((a,b)=>b.bags-a.bags||a.name.localeCompare(b.name));
  const tl=(tableNums&&tableNums.length)?[...tableNums].sort((a,b)=>a-b):[1];
  const seated=deduped.map((p,idx)=>{
    const tNum=tl[idx%tl.length]; const sNum=Math.floor(idx/tl.length)+1;
    const bestHistorical=Math.max(p.chipCount||0,p.inheritedChipCount||0);
    return {...p,id:makeId(),status:'active',bustPosition:null,inherited:true,chipCount:p.chipCount||0,inheritedChipCount:bestHistorical,
      country:p.country||ctry[keyOf(p)]||undefined,tableNum:sNum<=spt?tNum:null,seatNum:sNum<=spt?sNum:null};
  });
  return {seated,deduped,extraBagWinners,totalExtraBags,chips:deduped.reduce((a,p)=>a+(p.chipCount||0),0)};
}
/* parents: loaded flight tournaments. aliases: {normalisedVariant: canonicalName} chosen in the preview. */
/* Short flight label for names like "Daniel Tan (1A)": ME 1A -> 1A. */
function flightLabel(t){ const c=(typeof EVENT_CONFIGS!=='undefined'&&EVENT_CONFIGS[t.eventType])||null; return (c&&c.short?c.short.replace(/^ME\s*/i,''):'')||t.name||t.id||'flight'; }
/* splits: {normalisedName: true} = the TD says these same-name survivors are DIFFERENT people (kept as separate seats, no extra bag). */
function deriveInheritance(parents, aliases, splits){
  aliases=aliases||{}; splits=splits||{};
  const canon=n=>{ const a=aliases[normName(n)]; return a!=null?a:n; };
  let entries=0, busted=0, rawPool=0, guar=0;
  const players=[], info=[], chained=[];
  (parents||[]).forEach(t=>{
    const ps=t.players||[];
    const ent=ps.length+(t.inheritedEntries||0);
    const bus=ps.filter(p=>p.status==='busted').length+(t.inheritedBusted||0);
    const net=(t.prizeComponent||0)*(1-(t.adminFeePercent||0)/100);
    const ppe=(t.prizePerEntry>0)?t.prizePerEntry:(net-(t.bountyAmount||0));
    entries+=ent; busted+=bus; rawPool+=Math.round(ent*ppe*100)/100; guar=Math.max(guar,t.guarantee||0);
    const surv=[];
    ps.filter(p=>p.status==='active').forEach(p=>surv.push({name:canon(p.name),chipCount:p.chipCount||0,inheritedChipCount:p.inheritedChipCount||0,country:p.country||undefined,src:flightLabel(t),srcId:t.id}));
    (t.baggedPlayers||[]).forEach(p=>surv.push({name:canon(p.name),chipCount:p.chipCount||0,inheritedChipCount:p.inheritedChipCount||0,country:p.country||undefined,src:'earlier flight',srcId:'earlier:'+t.id}));
    if((t.inheritedEntries||0)>0||(t.baggedPlayers||[]).length>0) chained.push(t.name||t.id);
    surv.forEach(p=>players.push(p));
    info.push({id:t.id,name:t.name,entries:ent,busted:bus,survivors:surv.length});
  });
  const groupUp=()=>{ const g={}; players.forEach(p=>{ const k=normName(p.name); (g[k]=g[k]||[]).push(p); }); return g; };
  let groups=groupUp();
  // every same-name group, BEFORE any split, so the preview can always show the choice
  const duplicates=Object.keys(groups).filter(k=>groups[k].length>1).map(k=>{
    const ids=groups[k].map(p=>p.srcId);
    const sameFlight=ids.some((x,i)=>ids.indexOf(x)!==i);
    return {key:k,name:groups[k][0].name,count:groups[k].length,srcs:groups[k].map(p=>p.src),chips:groups[k].map(p=>({src:p.src,chip:p.chipCount||0})),
      best:Math.max.apply(null,groups[k].map(p=>p.chipCount||0)),sameFlight:sameFlight,split:!!splits[k]&&!sameFlight};
  });
  const splitNames=[];
  duplicates.filter(d=>d.split).forEach(d=>{
    groups[d.key].forEach(p=>{ p.name=p.name+' ('+p.src+')'; });
    splitNames.push({name:d.name,srcs:d.srcs});
  });
  if(splitNames.length) groups=groupUp();
  const byTok={};
  Object.keys(groups).forEach(k=>{ const tk=nameTokenKey(k); (byTok[tk]=byTok[tk]||[]).push(k); });
  const flags=Object.keys(byTok).filter(tk=>byTok[tk].length>1).map(tk=>({names:byTok[tk].map(k=>groups[k][0].name),keys:byTok[tk]}));
  const extraBags=Object.keys(groups).reduce((a,k)=>a+Math.max(0,groups[k].length-1),0);
  const poolRaw=Math.round(rawPool*100)/100;
  return {entries,busted,prizePool:Math.max(poolRaw,guar),rawPool:poolRaw,guarantee:guar,players,parents:info,chained,
    unique:Object.keys(groups).length,duplicates,splitNames,flags,extraBags,chips:Object.keys(groups).reduce((a,k)=>a+Math.max.apply(null,groups[k].map(p=>p.chipCount||0)),0)};
}
/* ---- Staff password for the SPC members server. NEVER put the value in this repo (it is public).
   Asked once per Mac, kept in localStorage. window.prompt() does not exist in Electron, so this draws its own dialog. ---- */
const STAFF_PW_KEY='spc_staff_pw';
let _staffPwAsk=null;
function askStaffPw(message){
  if(_staffPwAsk) return _staffPwAsk;
  _staffPwAsk=new Promise(resolve=>{
    const ov=document.createElement('div');
    ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;font-family:sans-serif';
    const box=document.createElement('div');
    box.style.cssText='background:#10180f;border:1px solid #3dba6f;border-radius:10px;padding:20px 22px;width:360px;color:#d8ead9';
    const t=document.createElement('div'); t.textContent=message; t.style.cssText='font-size:14px;margin-bottom:12px;line-height:1.4';
    const inp=document.createElement('input'); inp.type='password'; inp.autocomplete='off'; inp.style.cssText='width:100%;box-sizing:border-box;padding:9px 10px;font-size:15px;border-radius:6px;border:1px solid #2a4a35;background:#0b1610;color:#fff';
    const row=document.createElement('div'); row.style.cssText='display:flex;gap:8px;justify-content:flex-end;margin-top:14px';
    const mk=(txt,primary)=>{const b=document.createElement('button'); b.textContent=txt; b.type='button'; b.style.cssText='padding:7px 16px;border-radius:6px;font-size:13px;cursor:pointer;border:1px solid '+(primary?'#3dba6f':'#2a4a35')+';background:'+(primary?'#1a3a22':'none')+';color:'+(primary?'#3dba6f':'#7aaa82'); return b;};
    const cancel=mk('Cancel',false), ok=mk('OK',true);
    const done=v=>{ try{document.body.removeChild(ov);}catch(e){} _staffPwAsk=null; resolve(v); };
    cancel.onclick=()=>done(null); ok.onclick=()=>done(inp.value||null);
    inp.onkeydown=e=>{ if(e.key==='Enter') ok.onclick(); else if(e.key==='Escape') cancel.onclick(); };
    row.appendChild(cancel); row.appendChild(ok); box.appendChild(t); box.appendChild(inp); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    setTimeout(()=>inp.focus(),30);
  });
  return _staffPwAsk;
}
function readStaffPw(){ try{ return localStorage.getItem(STAFF_PW_KEY)||''; }catch(e){ return ''; } }
function clearStaffPw(){ try{ localStorage.removeItem(STAFF_PW_KEY); }catch(e){} }
/* Returns the stored password, asking once if there is none. null if cancelled. */
async function getStaffPw(){
  const have=readStaffPw(); if(have) return have;
  const pw=await askStaffPw('Staff password for the SPC members server (asked once on this Mac):');
  if(!pw) return null;
  try{ localStorage.setItem(STAFF_PW_KEY,pw); }catch(e){}
  return pw;
}
async function changeStaffPw(){
  clearStaffPw();
  const pw=await getStaffPw();
  alert(pw?'Staff password saved on this Mac.':'No staff password saved. You will be asked next time it is needed.');
}
/* fetch() to the members server with the staff header. Returns null (nothing sent) if there is no password or it was
   rejected (401/403): the stored value is cleared and the caller just stops. Never retries. opts.noPrompt: do not ask. */
async function staffFetch(url, opts){
  opts=opts||{};
  let pw=readStaffPw();
  if(!pw){
    if(opts.noPrompt) return null;
    pw=await getStaffPw();
    if(!pw){ alert('Not sent: no staff password.'); return null; }
  }
  const o={...opts}; delete o.noPrompt;
  o.headers={...(opts.headers||{}),'X-Staff-Pw':pw};
  const res=await fetch(url,o);
  if(res.status===401||res.status===403){ clearStaffPw(); alert("Staff password was rejected. You'll be asked for it again."); return null; }
  return res;
}
function evLabel(t){ const c=(typeof EVENT_CONFIGS!=='undefined'&&EVENT_CONFIGS[t.eventType])||null; return (c&&c.short)||t.eventShort||t.eventName||t.name||'another event'; }
/* Tables claimed by OTHER live events (empty and paused ones included). Returns {tableNum: eventName}. */
function tablesElsewhere(liveMap, exceptId) {
  const out={};
  Object.keys(liveMap||{}).forEach(id=>{
    if(id===exceptId) return;
    const t=liveMap[id]; if(!t) return;
    const nm=evLabel(t);
    getTableNumbers(t).forEach(n=>{ if(out[n]==null) out[n]=nm; });
  });
  return out;
}
/* [{a,b,tables}] pairs of live events that share table numbers (warn-only on resume). */
function tableOverlaps(liveMap) {
  const ids=Object.keys(liveMap||{}); const out=[];
  for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){
    const A=liveMap[ids[i]],B=liveMap[ids[j]]; if(!A||!B) continue;
    const bs=new Set(getTableNumbers(B)); const sh=getTableNumbers(A).filter(n=>bs.has(n));
    if(sh.length) out.push({a:evLabel(A),b:evLabel(B),tables:sh});
  }
  return out;
}
function formatTableRanges(nums) {
  if(!nums||!nums.length) return '';
  const sorted=[...nums].sort((a,b)=>a-b);
  const parts=[];
  let start=sorted[0], prev=sorted[0];
  for(let i=1;i<=sorted.length;i++){
    const cur=sorted[i];
    if(cur===prev+1){ prev=cur; continue; }
    parts.push(start===prev?`${start}`:`${start}-${prev}`);
    start=cur; prev=cur;
  }
  return parts.join(', ');
}
function findSeat(players, tableNumbers, seatsPerTable, seatLocks) {
  seatLocks=seatLocks||{};
  const active = players.filter(p=>p.status==='active');
  const counts = {};
  tableNumbers.forEach(t=>counts[t]=0);
  active.forEach(p=>{ if(p.tableNum!==null&&p.tableNum!==undefined&&counts[p.tableNum]!==undefined) counts[p.tableNum]=(counts[p.tableNum]||0)+1; });
  const tables=Object.keys(counts).map(Number)
    .filter(t=>counts[t]<seatsPerTable)
    .sort((a,b)=>counts[a]!==counts[b]?counts[a]-counts[b]:a-b);
  if(!tables.length) return{tableNum:null,seatNum:null};
  for(let ti=0;ti<tables.length;ti++){
    const tNum=tables[ti];
    for(let s=1;s<=seatsPerTable;s++){
      const lk=seatLocks[tNum+'-'+s];
      if(lk==='reg'||lk==='all') continue;
      if(!active.find(p=>p.tableNum===tNum&&p.seatNum===s)) return{tableNum:tNum,seatNum:s};
    }
  }
  return{tableNum:null,seatNum:null};
}

// ---SHARED:computeBreakAssignments:START---
// Table-break seat-reassignment. Kept plain ES5 (var/function, no arrow fns,
// no destructuring/spread) because server.js extracts this exact block by
// the markers above/below and embeds it verbatim into the floor UI's plain
// (non-Babel) <script> tag — see getFloorHTML() in server.js.
// opts: { closingTable, players, tableNumbers, seatsPerTable, seatLocks }
// players must already be filtered to active/seated players by the caller.
// returns: { ok, assignments, availableCount, neededCount }
function computeBreakAssignments(opts) {
  var closingTable = opts.closingTable;
  var players = opts.players || [];
  var tableNumbers = opts.tableNumbers || [];
  var seatsPerTable = opts.seatsPerTable;
  var seatLocks = opts.seatLocks || {};

  var displaced = players.filter(function(p) { return p.tableNum === closingTable; });

  var otherTables = tableNumbers.filter(function(t) { return t !== closingTable; });
  var counts = {};
  otherTables.forEach(function(t) {
    counts[t] = players.filter(function(p) { return p.tableNum === t; }).length;
  });

  var avail = [];
  otherTables.forEach(function(t) {
    for (var s = 1; s <= seatsPerTable; s++) {
      var lockType = seatLocks[t + '-' + s] || 'none';
      if (lockType === 'move' || lockType === 'all') continue;
      var occupied = players.some(function(p) { return p.tableNum === t && p.seatNum === s; });
      if (!occupied) avail.push({ tableNum: t, seatNum: s });
    }
  });

  if (avail.length < displaced.length) {
    return { ok: false, assignments: [], availableCount: avail.length, neededCount: displaced.length };
  }

  var assignments = [];
  var tc = {};
  Object.keys(counts).forEach(function(k) { tc[k] = counts[k]; });
  displaced.forEach(function(p) {
    var remaining = avail.filter(function(s) {
      return !assignments.some(function(a) { return a.tableNum === s.tableNum && a.seatNum === s.seatNum; });
    });
    remaining.sort(function(a, b) {
      return (tc[a.tableNum] || 0) - (tc[b.tableNum] || 0) || a.tableNum - b.tableNum || a.seatNum - b.seatNum;
    });
    var seat = remaining[0];
    assignments.push({ playerId: p.id, name: p.name, country: p.country || null, fromTable: closingTable, fromSeat: p.seatNum, tableNum: seat.tableNum, seatNum: seat.seatNum });
    tc[seat.tableNum] = (tc[seat.tableNum] || 0) + 1;
  });

  return { ok: true, assignments: assignments, availableCount: avail.length, neededCount: displaced.length };
}

// Final-table consolidation: every active player, wherever currently seated, is randomly assigned
// (Fisher-Yates - unbiased, unlike sort(() => Math.random())) to seats 1..N on a single destination
// table. Unlike computeBreakAssignments above (which slots displaced players into whatever seats are
// open elsewhere, keeping everyone else put), this is a fresh random draw - standard practice when a
// field collapses to a redrawn final table. Same marker block, same reasons: plain ES5, read verbatim
// by server.js into the floor UI's non-Babel <script> tag.
// opts: { players, destTable, seatsPerTable, seatLocks }
// players must already be filtered to active players by the caller, across ALL source tables.
// returns: { ok, assignments, availableCount, neededCount }
function computeFinalTableRedraw(opts) {
  var players = opts.players || [];
  var destTable = opts.destTable;
  var seatsPerTable = opts.seatsPerTable;
  var seatLocks = opts.seatLocks || {};

  var seats = [];
  for (var s = 1; s <= seatsPerTable; s++) {
    var lockType = seatLocks[destTable + '-' + s] || 'none';
    if (lockType === 'move' || lockType === 'all') continue;
    seats.push(s);
  }

  if (seats.length < players.length) {
    return { ok: false, assignments: [], availableCount: seats.length, neededCount: players.length };
  }

  for (var i = seats.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = seats[i]; seats[i] = seats[j]; seats[j] = tmp;
  }

  var assignments = [];
  for (var k = 0; k < players.length; k++) {
    var p = players[k];
    assignments.push({ playerId: p.id, name: p.name, country: p.country || null, fromTable: p.tableNum, fromSeat: p.seatNum, tableNum: destTable, seatNum: seats[k] });
  }

  return { ok: true, assignments: assignments, availableCount: seats.length, neededCount: players.length };
}
// ---SHARED:computeBreakAssignments:END---

// QR parser — boarding pass string is semicolon-delimited; name is at index 3
function countryFlag(cc){if(!cc)return'';try{return String.fromCodePoint(...[...cc.toUpperCase()].map(c=>0x1F1E6+c.charCodeAt(0)-65));}catch(e){return cc.toUpperCase();}}
function pf(p){if(!p||!p.country)return'';return' '+countryFlag(p.country);}

function parseQR(raw) {
  if(!raw||!raw.trim()) return null;
  const trimmed = raw.trim();

  // Check if this is an SPC Community Card QR (Member ID format: SPC-XXXXX or SPC-XXXXX/CC)
  const spcMatch = trimmed.match(/^(SPC-\d{5})(\/([A-Z]{2}))?$/i);
  if(spcMatch) {
    const memberId = spcMatch[1].toUpperCase();
    const qrCountry = spcMatch[3] ? spcMatch[3].toUpperCase() : null;
    try {
      const cache = JSON.parse(localStorage.getItem('spc_members_cache')||'{}');
      const entry = cache[memberId];
      if(!entry) {
        alert(`Member ${memberId} not found in local cache.\n\nPlease type the player's name manually (as printed on their card) to register them.`);
        return null;
      }
      // Support both old format (string) and new format ({name, country})
      const name = typeof entry === 'string' ? entry : entry.name;
      const country = qrCountry || (typeof entry === 'object' ? entry.country : null);
      if(name) return {name, country};
      return null;
    } catch(e) { return null; }
  }

  // Boarding pass format: semicolon-separated, name in position 4
  const parts=trimmed.split(';');
  if(parts.length>=4) {
    const name=parts[3]?parts[3].trim():'';
    if(!name) return null;
    return {name, country: memberCountryLookup(name)};
  }
  // Plain typed name — look up country from member cache
  return trimmed?{name:trimmed, country: memberCountryLookup(trimmed)}:null;
}
function memberCountryLookup(name) {
  try {
    const cache = JSON.parse(localStorage.getItem('spc_members_cache')||'{}');
    const match = Object.values(cache).find(e => {
      const n = typeof e === 'string' ? e : e.name;
      return n && n.toLowerCase() === name.toLowerCase();
    });
    if(match && typeof match === 'object') return match.country || null;
    return null;
  } catch(e) { return null; }
}
/* Clock model: running -> levelEndsAt (epoch ms) is the source of truth; paused/complete -> timeRemainingSeconds. */
function clockRemainingSecs(t, now) {
  if(!t) return 0;
  if(t.status==='running'&&typeof t.levelEndsAt==='number') return Math.max(0,Math.ceil((t.levelEndsAt-now)/1000));
  return Math.max(0,t.timeRemainingSeconds||0);
}
/* baseMs: when the NEW level starts. Manual advance -> now. Automatic advance -> the old levelEndsAt, so the schedule never drifts. */
function advanceLevelFn(t, baseMs) {
  const base=typeof baseMs==='number'?baseMs:Date.now();
  const ni=t.currentLevelIdx+1;
  // Leaving the late-registration level: record the exact moment it ended (advisory window, never changes status).
  let reg=t.reg;
  const left=t.structure[t.currentLevelIdx];
  if(reg&&reg.lateRegLevel!=null&&reg.lateRegEndedAt==null&&left&&!left.isBreak&&left.level===reg.lateRegLevel) reg={...reg,lateRegEndedAt:base};
  if(ni>=t.structure.length) return{...t,reg,status:'complete',timeRemainingSeconds:0,levelEndsAt:null};
  const secs=t.structure[ni].mins*60;
  return{...t,reg,currentLevelIdx:ni,timeRemainingSeconds:secs,levelEndsAt:t.status==='running'?base+secs*1000:null};
}
/* Advance through every level whose end time has passed. Used by the tick and by resume. */
function catchUpClock(t, now) {
  let x=t, guard=0;
  while(x&&x.status==='running'&&typeof x.levelEndsAt==='number'&&x.levelEndsAt<=now&&guard<1000){ x=advanceLevelFn(x,x.levelEndsAt); guard++; }
  return x;
}
// ---SHARED:regWindow:START---
/* Registration rules shared by the desk (browser) and server.js (Node, evaluated from this file).
   reg = {status:'notOpen'|'open'|'closed', lateRegLevel, graceMins, lateRegEndedAt, closedAt, noGrace}.
   Only the TD's Close / Close immediately blocks the counter. The late-registration window is advisory. */
function regWindow(reg, lateRegEndsAt, now) {
  var r = reg || {status:'notOpen'};
  var grace = (typeof r.graceMins === 'number' ? r.graceMins : 10) * 60000;
  var endedAt = (typeof r.lateRegEndedAt === 'number') ? r.lateRegEndedAt
    : ((typeof lateRegEndsAt === 'number' && now >= lateRegEndsAt) ? lateRegEndsAt : null);
  var out = {accepting:false, state:'notOpen', lateRegEndedAt:endedAt, adviceEndsAt:(endedAt != null ? endedAt + grace : null), closedAt:(typeof r.closedAt === 'number' ? r.closedAt : null), graceEndsAt:null};
  if (r.status === 'open') {
    out.accepting = true;
    if (endedAt == null) out.state = 'open';
    else if (now < endedAt + grace) out.state = 'lateGrace';
    else out.state = 'lateOver';
  } else if (r.status === 'closed') {
    out.state = 'closed';
    if (!r.noGrace && out.closedAt != null) {
      out.graceEndsAt = out.closedAt + grace;
      if (now < out.graceEndsAt) { out.state = 'closingGrace'; out.accepting = true; }
    }
  }
  return out;
}
/* The end of the late-registration level, only while the clock is running on that level (a paused clock does not end late reg). */
function lateRegEndsAtOf(t) {
  if (!t || !t.reg || t.reg.lateRegLevel == null || t.status !== 'running' || typeof t.levelEndsAt !== 'number') return null;
  var cur = t.structure && t.structure[t.currentLevelIdx];
  if (cur && !cur.isBreak && cur.level === t.reg.lateRegLevel) return t.levelEndsAt;
  return null;
}
/* Server-side judgement of one registration against an event's broadcast payload.
   ev: {tableMap, unseated, regLog, bustedPositions, maxReentries (number, or null/undefined = unlimited), noEntries, eventShort}
   pending: [{name,isReentry}] accepted a moment ago but not yet in the broadcast. */
function checkRegistration(ev, name, pending) {
  var active = {};
  (ev.tableMap || []).forEach(function(tb) { (tb.players || []).forEach(function(p) { active[p.name] = true; }); });
  (ev.unseated || []).forEach(function(p) { active[p.name] = true; });
  var pend = pending || [];
  var pendingSame = pend.filter(function(p) { return p.name === name; });
  var isDup = !!active[name] || pendingSame.length > 0;
  var isReentry = !isDup && !!(ev.bustedPositions && Object.prototype.hasOwnProperty.call(ev.bustedPositions, name));
  var used = (ev.regLog || []).filter(function(r) { return r.name === name && r.isReentry && !r.isDup; }).length;
  var max = (typeof ev.maxReentries === 'number') ? ev.maxReentries : null;
  var res = {isDup:isDup, isReentry:isReentry, reentriesUsed:used, blocked:null};
  if (ev.noEntries && !isDup) {
    // Day 2: survivors only. No new entries and no re-entries, ever.
    res.blocked = {code:'no_entries', message:(ev.eventShort || 'This event') + ' is closed to entries and re-entries.'};
  } else if (isReentry && max !== null && used >= max) {
    var nm = ev.eventShort || 'this event';
    res.blocked = {code:'reentry_limit', message: max === 0 ? ('No re-entries in ' + nm + '.') : (name + ' has already used their ' + max + ' re-entr' + (max === 1 ? 'y' : 'ies') + ' (' + nm + ').')};
  }
  return res;
}
// ---SHARED:regWindow:END---

/* Registration state for a tournament. New events start closed to the counter (the TD presses Open); events saved before
   this model existed default to open so nothing stops accepting mid-event. */
function defaultReg(eventType, status) {
  var cfg = EVENT_CONFIGS[eventType] || null;
  var noEntries = !!(cfg && cfg.noEntries);
  return {status:noEntries ? 'closed' : (status || 'notOpen'), lateRegLevel:(cfg && cfg.lateRegLevel != null ? cfg.lateRegLevel : null), graceMins:10, lateRegEndedAt:null, closedAt:null, noGrace:noEntries};
}
function ensureReg(t) {
  if (!t || t.reg) return t;
  return {...t, reg:defaultReg(t.eventType, 'open')};
}
function uid() { return Date.now().toString(36)+Math.random().toString(36).slice(2); }

const SPC_PAYOUT_TABLE = [
  {minP:1,maxP:9,paid:1,pcts:[100.0]},
  {minP:10,maxP:18,paid:2,pcts:[60.0,40.0]},
  {minP:19,maxP:27,paid:3,pcts:[50.0,30.0,20.0]},
  {minP:28,maxP:36,paid:4,pcts:[40.0,27.0,19.0,14.0]},
  {minP:37,maxP:45,paid:5,pcts:[35.0,25.0,18.0,13.0,9.0]},
  {minP:46,maxP:54,paid:6,pcts:[32.0,22.0,16.0,12.0,9.0,8.0]},
  {minP:55,maxP:63,paid:7,pcts:[30.0,19.0,15.0,12.0,9.0,8.0,7.0]},
  {minP:64,maxP:72,paid:8,pcts:[29.75,18.75,14.75,11.25,8.5,7.0,5.5,4.5]},
  {minP:73,maxP:81,paid:9,pcts:[29.5,18.75,14.0,10.0,8.0,6.75,5.5,4.25,3.25]},
  {minP:82,maxP:90,paid:10,pcts:[29.0,18.65,13.75,9.5,7.75,6.3,5.25,4.15,3.15,2.5]},
  {minP:91,maxP:108,paid:12,pcts:[28.5,18.5,13.5,9.0,7.25,5.75,4.5,3.5,2.75,2.25,2.25,2.25]},
  {minP:109,maxP:126,paid:15,pcts:[28.0,18.25,12.0,8.75,6.25,5.0,4.0,3.25,2.5,2.1,2.1,2.1,1.9,1.9,1.9]},
  {minP:127,maxP:144,paid:18,pcts:[25.75,17.05,11.0,8.5,6.25,5.0,4.0,3.15,2.5,2.15,2.15,2.15,1.85,1.85,1.85,1.6,1.6,1.6]},
  {minP:145,maxP:162,paid:21,pcts:[24.0,16.25,10.75,8.25,6.15,5.0,4.0,3.15,2.5,2.1,2.1,2.1,1.8,1.8,1.8,1.5,1.5,1.5,1.25,1.25,1.25]},
  {minP:163,maxP:189,paid:24,pcts:[23.0,15.45,10.5,8.25,6.1,5.0,4.0,3.15,2.5,2.0,2.0,2.0,1.7,1.7,1.7,1.45,1.45,1.45,1.2,1.2,1.2,1.0,1.0,1.0]},
  {minP:190,maxP:216,paid:27,pcts:[22.0,14.9,10.25,8.1,6.1,5.0,4.0,3.15,2.5,2.0,2.0,2.0,1.65,1.65,1.65,1.35,1.35,1.35,1.1,1.1,1.1,1.0,1.0,1.0,0.9,0.9,0.9]},
  {minP:217,maxP:243,paid:30,pcts:[21.0,14.7,10.0,8.1,6.05,5.0,4.0,3.15,2.5,2.0,2.0,2.0,1.6,1.6,1.6,1.3,1.3,1.3,1.05,1.05,1.05,0.95,0.95,0.95,0.85,0.85,0.85,0.75,0.75,0.75]},
  {minP:244,maxP:288,paid:36,pcts:[20.0,14.0,9.45,7.7,6.0,5.0,4.0,3.15,2.5,1.95,1.95,1.95,1.5,1.5,1.5,1.25,1.25,1.25,1.0,1.0,1.0,0.9,0.9,0.9,0.8,0.8,0.8,0.7,0.7,0.7,0.65,0.65,0.65,0.65,0.65,0.65]},
  {minP:289,maxP:342,paid:45,pcts:[19.0,13.75,9.25,7.5,6.0,5.0,4.0,3.0,2.2,1.7,1.7,1.7,1.25,1.25,1.25,1.1,1.1,1.1,0.95,0.95,0.95,0.85,0.85,0.85,0.75,0.75,0.75,0.65,0.65,0.65,0.6,0.6,0.6,0.6,0.6,0.6,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55]},
  {minP:343,maxP:405,paid:54,pcts:[18.5,13.35,9.0,7.125,5.8,4.85,3.9,2.95,2.125,1.65,1.65,1.65,1.2,1.2,1.2,1.0,1.0,1.0,0.9,0.9,0.9,0.8,0.8,0.8,0.7,0.7,0.7,0.6,0.6,0.6,0.55,0.55,0.55,0.55,0.55,0.55,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.5,0.475,0.475,0.475,0.475,0.475,0.475,0.475,0.475,0.475]},
  {minP:406,maxP:477,paid:63,pcts:[18.25,13.25,8.425,7.0,5.625,4.6,3.6,2.65,2.1,1.6,1.6,1.6,1.15,1.15,1.15,0.975,0.975,0.975,0.85,0.85,0.85,0.75,0.75,0.75,0.65,0.65,0.65,0.575,0.575,0.575,0.525,0.525,0.525,0.525,0.525,0.525,0.475,0.475,0.475,0.475,0.475,0.475,0.475,0.475,0.475,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4]},
  {minP:478,maxP:549,paid:72,pcts:[18.1,13.1,8.235,6.65,5.5,4.5,3.525,2.6,2.0,1.45,1.45,1.45,1.1,1.1,1.1,0.95,0.95,0.95,0.82,0.82,0.82,0.715,0.715,0.715,0.625,0.625,0.625,0.56,0.56,0.56,0.5,0.5,0.5,0.5,0.5,0.5,0.445,0.445,0.445,0.445,0.445,0.445,0.445,0.445,0.445,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.4,0.375,0.375,0.375,0.375,0.375,0.375,0.375,0.375,0.375,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35,0.35]},
  {minP:550,maxP:621,paid:81,pcts:[17.875,12.875,8.0,6.4,5.4,4.42,3.5,2.595,1.955,1.35,1.35,1.35,1.085,1.085,1.085,0.935,0.935,0.935,0.795,0.795,0.795,0.685,0.685,0.685,0.605,0.605,0.605,0.535,0.535,0.535,0.475,0.475,0.475,0.475,0.475,0.475,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.425,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.345,0.345,0.345,0.345,0.345,0.345,0.345,0.345,0.345,0.325,0.325,0.325,0.325,0.325,0.325,0.325,0.325,0.325,0.315,0.315,0.315,0.315,0.315,0.315,0.315,0.315,0.315]},
  {minP:622,maxP:693,paid:90,pcts:[17.85,12.85,7.931,6.25,5.2,4.25,3.325,2.5,1.75,1.25,1.25,1.25,1.05,1.05,1.05,0.91,0.91,0.91,0.775,0.775,0.775,0.683,0.683,0.683,0.6,0.6,0.6,0.52,0.52,0.52,0.455,0.455,0.455,0.455,0.455,0.455,0.405,0.405,0.405,0.405,0.405,0.405,0.405,0.405,0.405,0.36,0.36,0.36,0.36,0.36,0.36,0.36,0.36,0.36,0.335,0.335,0.335,0.335,0.335,0.335,0.335,0.335,0.335,0.315,0.315,0.315,0.315,0.315,0.315,0.315,0.315,0.315,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.285,0.285,0.285,0.285,0.285,0.285,0.285,0.285,0.285]},
  {minP:694,maxP:765,paid:99,pcts:[17.814,12.8,7.875,6.1,5.1,4.125,3.225,2.35,1.5,1.15,1.15,1.15,0.995,0.995,0.995,0.875,0.875,0.875,0.772,0.772,0.772,0.673,0.673,0.673,0.575,0.575,0.575,0.5,0.5,0.5,0.435,0.435,0.435,0.435,0.435,0.435,0.395,0.395,0.395,0.395,0.395,0.395,0.395,0.395,0.395,0.358,0.358,0.358,0.358,0.358,0.358,0.358,0.358,0.358,0.333,0.333,0.333,0.333,0.333,0.333,0.333,0.333,0.333,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.31,0.288,0.288,0.288,0.288,0.288,0.288,0.288,0.288,0.288,0.27,0.27,0.27,0.27,0.27,0.27,0.27,0.27,0.27,0.255,0.255,0.255,0.255,0.255,0.255,0.255,0.255,0.255]},
  {minP:766,maxP:837,paid:108,pcts:[17.8,12.75,7.85,6.092,5.075,4.12,3.2,2.325,1.455,1.05,1.05,1.05,0.925,0.925,0.925,0.82,0.82,0.82,0.72,0.72,0.72,0.63,0.63,0.63,0.55,0.55,0.55,0.475,0.475,0.475,0.42,0.42,0.42,0.42,0.42,0.42,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.385,0.355,0.355,0.355,0.355,0.355,0.355,0.355,0.355,0.355,0.327,0.327,0.327,0.327,0.327,0.327,0.327,0.327,0.327,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.3,0.275,0.275,0.275,0.275,0.275,0.275,0.275,0.275,0.275,0.255,0.255,0.255,0.255,0.255,0.255,0.255,0.255,0.255,0.24,0.24,0.24,0.24,0.24,0.24,0.24,0.24,0.24,0.23,0.23,0.23,0.23,0.23,0.23,0.23,0.23,0.23]},
];

function generatePayoutRows(entries, prizePool, roundToFifty=false, placesOverride=null) {
  if (entries <= 0 || prizePool <= 0) return [];
  // Find the matching bracket
  let bracket = SPC_PAYOUT_TABLE.find(b => entries >= b.minP && entries <= b.maxP)
    || SPC_PAYOUT_TABLE[SPC_PAYOUT_TABLE.length - 1];
  // If places override is given, find the bracket that has that many payout places
  if (placesOverride && placesOverride > 0) {
    const match = SPC_PAYOUT_TABLE.find(b => b.pcts && b.pcts.length === placesOverride);
    if (match) bracket = match;
    else {
      // If no exact match, trim or extend the bracket to fit
      bracket = {...bracket, pcts: bracket.pcts.slice(0, placesOverride)};
      // Normalize pcts to sum to 100
      const sum = bracket.pcts.reduce((a,b)=>a+b,0);
      if (sum > 0) bracket = {...bracket, pcts: bracket.pcts.map(p=>p/sum*100)};
    }
  }
  const multiple = roundToFifty ? 50 : 100;
  let rows = bracket.pcts.map((pct, i) => {
    const raw = pct / 100 * prizePool;
    const amount = Math.floor(raw / multiple) * multiple;
    return {position: i+1, pct: Math.round(pct*100)/100, amount};
  });
  // House tops up: sum all amounts, difference goes to 1st place
  const allocated = rows.reduce((s,r) => s+r.amount, 0);
  const diff = prizePool - allocated;
  if (diff > 0) rows[0].amount += Math.ceil(diff / multiple) * multiple;
  return rows;
}


/* ==== EXPORT / IMPORT HELPERS ==== */
function generateTournamentReportHTML(t) {
    // Tournament report — generate printable HTML summary
    const evCfg=EVENT_CONFIGS[t.eventType]||{};
    const entries=t.players.length+(t.inheritedEntries||0);
    const busted=t.players.filter(p=>p.status==='busted').length+(t.inheritedBusted||0);
    const active=t.players.filter(p=>p.status==='active').length;
    const standings=t.players.filter(p=>p.status==='busted').sort((a,b)=>(a.bustPosition||9999)-(b.bustPosition||9999));
    const _sat=isSatellite(t)?getSatelliteSeats(t):null;
    let payouts=isSatellite(t)?getSatelliteLadder(t):(t.payoutTable||[]);
    const pp=commitPrizePool(t.prizePool);
    const extraBags=t.extraBagCount||0;
    const extraDed=extraBags*1500;
    const payoutPool=pp-extraDed;
    // If no saved payout table, generate one
    if(!_sat&&payouts.length===0&&entries>0&&payoutPool>0){
      payouts=generatePayoutRows(entries,payoutPool,t.eventType==='mysteryBounty');
    }
    // Use the amounts actually paid - the same values buildTournamentCommitPayload sends (deal amount when a deal was made,
    // otherwise the saved row amount). Only fall back to pct x pool for rows that have no amount at all.
    payouts=payouts.map((p,i)=>({...p,position:p.position||i+1,amount:(t.dealMade&&p.dealAmount!=null)?p.dealAmount:(p.amount!=null?p.amount:Math.round(payoutPool*(p.pct||0)/100))}));
    // Build position→amount lookup for standings
    const payoutMap={};
    payouts.forEach(p=>{payoutMap[p.position]=p;});
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${t.name||'Tournament'} Report</title>
<style>body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#222}
h1{font-size:24px;margin-bottom:4px}h2{font-size:16px;margin-top:24px;border-bottom:2px solid #333;padding-bottom:4px}
.sub{color:#666;font-size:13px;margin-bottom:16px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0}
.stat{background:#f5f5f5;border-radius:6px;padding:10px 14px}.stat-label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;font-weight:600}
.stat-val{font-size:20px;font-weight:700;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:6px 10px;background:#f0f0f0;font-size:10px;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #ddd}
td{padding:6px 10px;border-bottom:1px solid #eee}.r{text-align:right}
.amt{font-weight:600;color:#1a7a3a}
@media print{body{padding:0}.stats{break-inside:avoid}table{page-break-inside:auto}}</style></head><body>
<h1>${t.name||'Tournament'}</h1>
<div class="sub">${evCfg.group||''} ${evCfg.subtitle||''} · ${new Date().toLocaleDateString('en-SG',{day:'numeric',month:'long',year:'numeric'})}</div>
<div class="stats">
<div class="stat"><div class="stat-label">Total entries</div><div class="stat-val">${entries}</div></div>
<div class="stat"><div class="stat-label">Prize pool</div><div class="stat-val">S$${pp.toLocaleString()}</div></div>
<div class="stat"><div class="stat-label">Extra bags</div><div class="stat-val">${extraBags} (−S$${extraDed.toLocaleString()})</div></div>
<div class="stat"><div class="stat-label">Payout pool</div><div class="stat-val">S$${payoutPool.toLocaleString()}</div></div>
</div>${_sat?`<div class="sub">${_sat.seats} seat${_sat.seats===1?'':'s'} awarded (S$${_sat.seatValue.toLocaleString()} each)${_sat.leftover>0?' · Bubble (position '+_sat.bubblePos+') S$'+_sat.leftover.toLocaleString():''}${_sat.overlay>0?' · Overlay S$'+_sat.overlay.toLocaleString()+' (SPC-funded)':''}</div>`:''}
${t.extraBagWinners&&t.extraBagWinners.length>0?`<h2>Extra Bag Winners</h2><table><tr><th>Player</th><th>Country</th><th>Bags</th><th class="r">Amount</th></tr>${t.extraBagWinners.map(w=>`<tr><td>${w.name}</td><td>${w.country||'—'}</td><td>×${w.bags} (${w.totalQualifications} flights)</td><td class="r amt">S$${(w.bags*1500).toLocaleString()}</td></tr>`).join('')}</table>`:''}
<h2>Final Standings</h2><table><tr><th>#</th><th>Player</th><th>Country</th><th>Status</th><th class="r">Payout (S$)</th></tr>
${active>0?t.players.filter(p=>p.status==='active').map(p=>{const po=payouts.find(x=>(x.position||0)===1);return`<tr><td>—</td><td>${p.name}</td><td>${p.country||'—'}</td><td>Active</td><td class="r">${_sat&&active<=_sat.seats?'Seat':''}</td></tr>`;}).join(''):''}
${standings.map(p=>{const po=payoutMap[p.bustPosition];const amt=po?po.amount:0;return`<tr><td>${p.bustPosition||'—'}</td><td>${p.name}</td><td>${p.country||'—'}</td><td>Eliminated</td><td class="r${po?' amt':''}">${_sat&&p.bustPosition&&p.bustPosition<=_sat.seats?'Seat':po?'S$'+amt.toLocaleString():''}</td></tr>`;}).join('')}
</table></body></html>`;
    return html;
}

/* The exact content of Export full save (.spc). extra: optional fields added at the top (the file backup adds _backupAt). */
function tournamentExportJson(t, extra) {
  const payload = { _spcExport: 'tournament', _version: 1, ...(extra||{}), ...t };
  return JSON.stringify(payload, null, 2);
}
/* localStorage use: Chromium counts key + value as UTF-16 (2 bytes per char) against about 10 MB per origin. */
const LS_CAP_BYTES = 10 * 1024 * 1024;
function storageUsage() {
  let total = 0; const tours = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i); const v = localStorage.getItem(k) || '';
      const bytes = (k.length + v.length) * 2; total += bytes;
      if (k.indexOf('spc_t_') === 0) { let name = k; try { name = JSON.parse(v).name || k; } catch (e) {} tours.push({ key: k, name: name, bytes: bytes }); }
    }
  } catch (e) {}
  tours.sort((a, b) => b.bytes - a.bytes);
  return { total: total, cap: LS_CAP_BYTES, pct: total / LS_CAP_BYTES * 100, top: tours.slice(0, 5), saved: tours.length };
}
function exportTournament(t, templateOnly=false) {
  if(templateOnly){
    const html=generateTournamentReportHTML(t);
    const reportName=(t.name||'tournament').replace(/[^a-z0-9]/gi,'_')+'_Report.html';
    if(window.electronAPI&&window.electronAPI.showSaveDialog){
      window.electronAPI.showSaveDialog({defaultPath:reportName,filters:[{name:'HTML',extensions:['html']}]}).then(function(result){
        if(!result.canceled&&result.filePath) window.electronAPI.writeFile(result.filePath,html);
      });
    }else{
      const blob=new Blob([html],{type:'text/html'});
      const a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=reportName;
      a.click();URL.revokeObjectURL(a.href);
    }
    return;
  }
  // Full backup — .spc file
  const json = tournamentExportJson(t);
  const safeName = (t.name||'tournament').replace(/[^a-z0-9]/gi,'_').toLowerCase();
  const backupName = `spc_backup_${safeName}.spc`;
  if(window.electronAPI&&window.electronAPI.showSaveDialog){
    window.electronAPI.showSaveDialog({defaultPath:backupName,filters:[{name:'SPC Backup',extensions:['spc']}]}).then(function(result){
      if(!result.canceled&&result.filePath) window.electronAPI.writeFile(result.filePath,json);
    });
  }else{
    const blob = new Blob([json], {type:'application/octet-stream'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = backupName;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}

/* ==== COMMIT TOURNAMENT PAYLOAD ==== */
// The live pool is kept as a full decimal (e.g. 530*0.96 = 508.80 per entry). Payouts are paid in S$100
// chips, so a fractional pool is floored to S$100 before commit; integer pools pass through untouched.
function commitPrizePool(pp){
  const n=Number(pp)||0;
  return Number.isInteger(n)?n:Math.floor(n/100)*100;
}
/* ---- Player-name helpers (commit-time only; live tournament state keeps names as typed) ---- */
// Reads the members cache. Keys of the form 'noId_<n>' are array indices invented by syncMembers for members
// without a member_id; they shift between syncs, so they are never treated as a real member_id.
function loadMemberIndex(){
  let cache={};
  try{cache=JSON.parse(localStorage.getItem('spc_members_cache')||'{}');}catch(e){}
  const byLower={};
  Object.entries(cache).forEach(([key,v])=>{
    const name=typeof v==='string'?v:(v&&v.name);
    if(!name) return;
    const id=typeof v==='string'?(key.indexOf('noId_')===0?null:key):(v.memberId||null);
    byLower[normalizeNameKey(name)]={name,id};
  });
  return {byLower,size:Object.keys(byLower).length};
}
function normalizeNameKey(name){ return String(name||'').trim().replace(/\s+/g,' ').toLowerCase(); }
function titleCaseName(name){
  const fix=seg=>{
    if(!seg) return seg;
    if(seg===seg.toUpperCase()||seg===seg.toLowerCase()) return seg.charAt(0).toUpperCase()+seg.slice(1).toLowerCase();
    return seg.charAt(0).toUpperCase()+seg.slice(1);
  };
  return String(name||'').trim().replace(/\s+/g,' ').split(' ').map(tok=>tok.split(/([-'\/.])/).map(fix).join('')).join(' ');
}
// Members-table spelling if the name is a known member (case-insensitive), otherwise title-cased.
function canonicalPlayerName(name,idx){
  const m=idx.byLower[normalizeNameKey(name)];
  return m?m.name:titleCaseName(name);
}
function editDistance(a,b){
  if(a===b) return 0;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const cur=[i];
    for(let j=1;j<=b.length;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1));
    prev=cur;
  }
  return prev[b.length];
}
// Near-duplicate test: small edit distance, or one name's tokens (2+) are all contained in the other's.
function namesLookRelated(a,b){
  const ka=normalizeNameKey(a), kb=normalizeNameKey(b);
  if(!ka||!kb||ka===kb) return false;
  if(Math.min(ka.length,kb.length)>=5 && editDistance(ka,kb)<=2) return true;
  const ta=ka.split(' '), tb=kb.split(' ');
  const [sm,lg]=ta.length<=tb.length?[ta,tb]:[tb,ta];
  return sm.length>=2 && sm.length<lg.length && sm.every(t=>lg.indexOf(t)>=0);
}
function suggestMemberName(name,idx){
  const k=normalizeNameKey(name);
  let best=null,bestD=99;
  Object.keys(idx.byLower).forEach(mk=>{
    if(!namesLookRelated(k,mk)) return;
    const d=editDistance(k,mk);
    if(d<bestD){bestD=d;best=idx.byLower[mk].name;}
  });
  return best;
}

// Pre-commit sanity checks on a built payload. Returns [{level:'error'|'warn', msg}] (empty = clean).
// 'error' = would corrupt payouts/history if committed as-is; 'warn' = worth a look (unknown or similar names, missing Hendon Mob fields).
// Pass the live tournament as `t` to enable the Main Event Day 2 flight-aggregate checks.
function validateCommitPayload(payload,t){
  const errors=[];
  const err=msg=>errors.push({level:'error',msg});
  const warn=msg=>errors.push({level:'warn',msg});
  const results=payload.results||[];
  const idx=loadMemberIndex();

  // Two players sharing a bust position would both be paid that place's prize.
  const namesByPos={};
  results.forEach(r=>{
    if(r.bust_position==null) return;
    (namesByPos[r.bust_position]=namesByPos[r.bust_position]||[]).push(r.player_name);
  });
  Object.entries(namesByPos).forEach(([pos,names])=>{
    if(names.length>1) err('Position '+pos+' is assigned to '+names.length+' players: '+names.join(', '));
  });

  // Placeholder / dummy entries ("001", "ab") that were never replaced with a real name.
  const uniqueNames=[...new Set(results.map(r=>r.player_name))];
  const isKnown=n=>!!idx.byLower[normalizeNameKey(n)];
  const placeholders=uniqueNames.filter(n=>/^\d+$/.test(n.trim())||(n.trim().length<=3&&!isKnown(n)));
  placeholders.forEach(n=>err('Placeholder name "'+n+'" - replace with a real name or remove the player'));

  // Names the members list does not recognise, with a suggestion when a close match exists.
  // Skipped when the members cache is empty (not synced), otherwise every player would be flagged.
  if(idx.size>0){
    const unknown=uniqueNames.filter(n=>placeholders.indexOf(n)<0&&!isKnown(n));
    const withHint=unknown.filter(n=>suggestMemberName(n,idx));
    withHint.forEach(n=>warn('"'+n+'" is not a member - did you mean "'+suggestMemberName(n,idx)+'"?'));
    const plain=unknown.filter(n=>withHint.indexOf(n)<0);
    if(plain.length) warn(plain.length+' name(s) not in the members list (new players?): '+plain.slice(0,10).join(', ')+(plain.length>10?', +'+(plain.length-10)+' more':''));
  }

  // Near-duplicate names inside this tournament (same person entered twice under different spellings).
  for(let i=0;i<uniqueNames.length;i++) for(let j=i+1;j<uniqueNames.length;j++){
    if(namesLookRelated(uniqueNames[i],uniqueNames[j])) warn('Possible duplicate player: "'+uniqueNames[i]+'" and "'+uniqueNames[j]+'"');
  }

  // Main Event Day 2 commits only see the survivors, so unique/re-entry counts must be entered from the flights.
  if(t&&t.eventType==='me_d2'){
    const u=t.flightUniqueEntries, r=t.flightReentries, e=payload.tournament.entries;
    if(u==null||r==null) warn('Main Event Day 2: flight unique entries / re-entries not filled in (needed for Hendon Mob) - the commit will store values derived from Day 2 alone');
    else if(u+r!==e) warn('Main Event Day 2: unique entries ('+u+') + re-entries ('+r+') = '+(u+r)+', but total entries is '+e);
  }
  return errors;
}
function buildTournamentCommitPayload(t) {
  const memberIdx=loadMemberIndex();
  const memberIdFor=name=>{const m=memberIdx.byLower[normalizeNameKey(name)];return m&&m.id?m.id:null;};
  const canon=name=>canonicalPlayerName(name,memberIdx);

  const reentryCountByName={};
  (t.regLog||[]).forEach(e=>{ if(e.isReentry) reentryCountByName[e.name]=(reentryCountByName[e.name]||0)+1; });

  const entries=t.players.length+(t.inheritedEntries||0);
  const totalReentries=(t.regLog||[]).filter(e=>e.isReentry).length;
  const uniqueEntries=entries-totalReentries;
  // Day 2 only sees survivors; the TD enters flight-aggregated unique/re-entry counts on the Payouts tab.
  const useFlightAgg=t.eventType==='me_d2'&&t.flightUniqueEntries!=null&&t.flightReentries!=null;

  let payouts=isSatellite(t)?[]:(t.payoutTable||[]);
  const payoutMap={};
  payouts.forEach((p,i)=>{payoutMap[p.position||i+1]=p;});

  const results=[];
  const seenNames=new Set();

  const bounties=t.bounties||{};

  const busted=t.players.filter(p=>p.status==='busted').sort((a,b)=>(a.bustPosition||9999)-(b.bustPosition||9999));
  busted.forEach(p=>{
    const payoutRow=payoutMap[p.bustPosition]||null;
    const payoutAmt=payoutRow?(payoutRow.amount||0):0;
    results.push({
      member_id:memberIdFor(p.name),
      player_name:canon(p.name),
      country:p.country||null,
      bust_position:p.bustPosition||null,
      payout_amount:payoutAmt,
      payout_amount_deal:(t.dealMade&&payoutRow&&payoutRow.dealAmount!=null)?payoutRow.dealAmount:null,
      extra_bag_amount:0,
      bounty_amount:bounties[p.id]||0,
      reentry_count:reentryCountByName[p.name]||0,
    });
    seenNames.add(canon(p.name));
  });

  // Players still active at commit time can still have logged bounties
  // (the eliminator may not have busted yet) — carry those into results too.
  t.players.filter(p=>p.status==='active').forEach(p=>{
    const amt=bounties[p.id]||0;
    if(amt<=0||seenNames.has(canon(p.name))) return;
    results.push({
      member_id:memberIdFor(p.name),
      player_name:canon(p.name),
      country:p.country||null,
      bust_position:null,
      payout_amount:0,
      payout_amount_deal:null,
      extra_bag_amount:0,
      bounty_amount:amt,
      reentry_count:reentryCountByName[p.name]||0,
    });
    seenNames.add(canon(p.name));
  });

  (t.extraBagWinners||[]).forEach(w=>{
    const extraAmt=(w.bags||0)*1500;
    if(seenNames.has(canon(w.name))){
      const row=results.find(r=>r.player_name===canon(w.name));
      if(row) row.extra_bag_amount=extraAmt;
      return;
    }
    results.push({
      member_id:memberIdFor(w.name),
      player_name:canon(w.name),
      country:w.country||null,
      bust_position:null,
      payout_amount:0,
      payout_amount_deal:null,
      extra_bag_amount:extraAmt,
      bounty_amount:0,
      reentry_count:reentryCountByName[w.name]||0,
    });
  });

  const fee=(t.buyin!=null&&t.prizeComponent!=null)?Math.max(0,t.buyin-t.prizeComponent):null;

  const tournament={
    id:t.id,
    name:t.name||getEventType(t.eventType)||'Event',
    event_type:getEventType(t.eventType),
    date:t.startedAt?new Date(t.startedAt).toISOString():new Date().toISOString(),
    spc_series:t.spcSeries||CURRENT_SPC_SERIES,
    buyin:t.buyin||0,
    fee,
    prize_pool:commitPrizePool(t.prizePool),
    guarantee:t.guarantee||0,
    hit_guarantee:(t.prizePool||0)>=(t.guarantee||0),
    entries,
    unique_entries:useFlightAgg?t.flightUniqueEntries:uniqueEntries,
    reentries:useFlightAgg?t.flightReentries:totalReentries,
    structure:t.structure||null,
    deal_made:t.dealMade||false,
    test_mode:t.testMode===true,
  };

  return {
    tournament,
    results,
    device:(window.electronAPI&&window.electronAPI.platform)||'browser',
    series:t.spcSeries||CURRENT_SPC_SERIES,
  };
}

function importFromFile(file, onSuccess, onError) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data._spcExport) throw new Error('Not a valid SPC export file');
      onSuccess(data);
    } catch(err) { onError(err.message); }
  };
  reader.readAsText(file);
}

/* ==== STORAGE HELPERS ==== */
function getIndex() { try{return JSON.parse(localStorage.getItem('spc_index')||'[]');}catch(e){return[];} }
function saveT(t) {
  try {
    localStorage.setItem(`spc_t_${t.id}`, JSON.stringify({...t,savedAt:Date.now()}));
    const idx=getIndex(); const i=idx.findIndex(x=>x.id===t.id);
    const entry={id:t.id,name:t.name,eventType:t.eventType,status:t.status,modified:Date.now()};
    if(i>=0)idx[i]=entry; else idx.unshift(entry);
    localStorage.setItem('spc_index',JSON.stringify(idx));
    return true;
  } catch(e){ console.error('saveT failed for',t&&t.id,e&&e.message); return false; }
}
function loadT(id) { try{return JSON.parse(localStorage.getItem(`spc_t_${id}`)||'null');}catch(e){return null;} }
function deleteT(id) {
  try {
    localStorage.removeItem(`spc_t_${id}`);
    localStorage.setItem('spc_index',JSON.stringify(getIndex().filter(x=>x.id!==id)));
  } catch(e){}
}
function getCommittedTournamentIds() { try{return JSON.parse(localStorage.getItem('spc_committed_tournaments')||'[]');}catch(e){return[];} }
function markTournamentCommitted(id) {
  try {
    const ids=getCommittedTournamentIds();
    if(!ids.includes(id)){ids.push(id);localStorage.setItem('spc_committed_tournaments',JSON.stringify(ids));}
  } catch(e){}
}
function markTournamentUncommitted(id) {
  try { localStorage.setItem('spc_committed_tournaments',JSON.stringify(getCommittedTournamentIds().filter(x=>x!==id))); } catch(e){}
}
