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
function getPayouts(entries, prizePool) {
  const keys=Object.keys(PAYOUT_DATA).map(Number).sort((a,b)=>a-b);
  const key=keys.find(k=>k>=entries)||keys[keys.length-1];
  return PAYOUT_DATA[key].map((pct,i)=>({position:i+1,pct,amount:Math.floor((pct/100)*prizePool/100)*100}));
}
function getTableNumbers(tournament) {
  if(tournament.tableNumbers && tournament.tableNumbers.length) return tournament.tableNumbers.slice();
  const startTable=tournament.startTable||1;
  const maxTables=tournament.maxTables||15;
  const out=[];
  for(let i=0;i<maxTables;i++) out.push(startTable+i);
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
function advanceLevelFn(t) {
  const ni=t.currentLevelIdx+1;
  if(ni>=t.structure.length) return{...t,status:'complete',timeRemainingSeconds:0};
  return{...t,currentLevelIdx:ni,timeRemainingSeconds:t.structure[ni].mins*60};
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
    let payouts=t.payoutTable||[];
    const pp=t.prizePool||0;
    const extraBags=t.extraBagCount||0;
    const extraDed=extraBags*1500;
    const payoutPool=pp-extraDed;
    // If no saved payout table, generate one
    if(payouts.length===0&&entries>0&&payoutPool>0){
      payouts=generatePayoutRows(entries,payoutPool,t.eventType==='mysteryBounty');
    }
    // Always recalculate amounts from pct (saved amounts may be stale)
    payouts=payouts.map((p,i)=>({...p,position:p.position||i+1,amount:Math.round(payoutPool*(p.pct||0)/100)}));
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
</div>
${t.extraBagWinners&&t.extraBagWinners.length>0?`<h2>Extra Bag Winners</h2><table><tr><th>Player</th><th>Country</th><th>Bags</th><th class="r">Amount</th></tr>${t.extraBagWinners.map(w=>`<tr><td>${w.name}</td><td>${w.country||'—'}</td><td>×${w.bags} (${w.totalQualifications} flights)</td><td class="r amt">S$${(w.bags*1500).toLocaleString()}</td></tr>`).join('')}</table>`:''}
<h2>Final Standings</h2><table><tr><th>#</th><th>Player</th><th>Country</th><th>Status</th><th class="r">Payout (S$)</th></tr>
${active>0?t.players.filter(p=>p.status==='active').map(p=>{const po=payouts.find(x=>(x.position||0)===1);return`<tr><td>—</td><td>${p.name}</td><td>${p.country||'—'}</td><td>Active</td><td class="r"></td></tr>`;}).join(''):''}
${standings.map(p=>{const po=payoutMap[p.bustPosition];const amt=po?po.amount:0;return`<tr><td>${p.bustPosition||'—'}</td><td>${p.name}</td><td>${p.country||'—'}</td><td>Eliminated</td><td class="r${po?' amt':''}">${po?'S$'+amt.toLocaleString():''}</td></tr>`;}).join('')}
</table></body></html>`;
    return html;
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
  const payload = { _spcExport: 'tournament', _version: 1, ...t };
  const json = JSON.stringify(payload, null, 2);
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

  let payouts=t.payoutTable||[];
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
    localStorage.setItem(`spc_t_${t.id}`, JSON.stringify(t));
    const idx=getIndex(); const i=idx.findIndex(x=>x.id===t.id);
    const entry={id:t.id,name:t.name,eventType:t.eventType,status:t.status,modified:Date.now()};
    if(i>=0)idx[i]=entry; else idx.unshift(entry);
    localStorage.setItem('spc_index',JSON.stringify(idx));
  } catch(e){}
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
function writeLive(t, cur, nxt, active, tables) {
  try {
    const _payouts=(()=>{
      if(t.payoutTable&&t.payoutTable.length) return t.payoutTable.slice(0,10);
      const _e=t.players.length+(t.inheritedEntries||0);
      const _pp=t.prizePool||0;
      if(_e>0&&_pp>0) return generatePayoutRows(_e,_pp,t.eventType==='mysteryBounty').slice(0,10);
      return [];
    })();
    const _cumEntries=t.players.length+(t.inheritedEntries||0);
    const _cumBusted=t.players.filter(p=>p.status==='busted').length+(t.inheritedBusted||0);
    localStorage.setItem(`spc_live_${t.id}`, JSON.stringify({
      name:t.name, eventType:t.eventType, cur, nxt,
      secs:t.timeRemainingSeconds, status:t.status,
      activePlayers:active.length, tablesInUse:tables, prizePool:t.prizePool, bountyPool:t.bountyPool||0,
      totalEntries:_cumEntries, totalBusted:_cumBusted,
      avgStack:active.length>0?Math.round(((t.chipsInPlay||_cumEntries*t.stack))/active.length):0,
      payouts:_payouts, payoutsPublished:t.payoutsPublished||false, ts:Date.now()
    }));
  } catch(e){}
}

