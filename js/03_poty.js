/* ============================================================
   03_poty.js
   Player-of-the-Year: localStorage read/write, seed-year init,
   points calculation from a completed tournament's payouts.
   Note: pushTournamentToCloud is NOT here — it's defined inside
   the POTYView component (uses local state/hooks) and moves with
   POTYView when we get to 09_potyview.js, per the migration rule.
   ============================================================ */

function potyKey(yr){return 'spc_poty_'+yr;}
function loadPOTYForYear(yr){try{const d=JSON.parse(localStorage.getItem(potyKey(yr)));if(d&&d.players)return d;return null;}catch(e){return null;}}
function initPOTY(yr){const existing=loadPOTYForYear(yr);if(existing)return existing;const players={};if(yr===2026){Object.entries(POTY_INITIAL_2026).forEach(([name,pts])=>{players[name]={points:pts,events:['SPC XX & XXI (pre-loaded)']};});}const d={year:yr,players,committed:[],aliases:{}};localStorage.setItem(potyKey(yr),JSON.stringify(d));return d;}
function savePOTY(d){try{localStorage.setItem(potyKey(d.year),JSON.stringify(d));}catch(e){}}
function getPotyYears(){const years=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith('spc_poty_')){const y=parseInt(k.replace('spc_poty_',''));if(!isNaN(y))years.push(y);}}const cur=new Date().getFullYear();if(years.indexOf(cur)<0)years.push(cur);return years.sort((a,b)=>b-a);}
function getPotyPoints(tournament){const results=[];const entries=tournament.players.length+(tournament.inheritedEntries||0);let payouts=tournament.payoutTable||[];const pp=tournament.prizePool||0;const extraBags=tournament.extraBagCount||0;const extraDed=extraBags*1500;const payoutPool=pp-extraDed;if(payouts.length===0&&entries>0&&payoutPool>0){payouts=generatePayoutRows(entries,payoutPool,tournament.eventType==='mysteryBounty');}payouts=payouts.map((p,i)=>({...p,position:p.position||i+1,amount:p.amount||Math.round(payoutPool*(p.pct||0)/100)}));const payoutMap={};payouts.forEach(p=>{payoutMap[p.position]=p;});const busted=tournament.players.filter(p=>p.status==='busted').sort((a,b)=>(a.bustPosition||9999)-(b.bustPosition||9999));busted.forEach(p=>{const po=payoutMap[p.bustPosition];if(po&&po.amount>0){const eff=(tournament.dealMade&&po.dealAmount!=null)?po.dealAmount:po.amount;results.push({name:p.name,payoutAmount:eff,extraBagAmount:0,totalPrize:eff,points:Math.floor(eff/POTY_RATE)});}});if(tournament.extraBagWinners&&tournament.extraBagWinners.length>0){tournament.extraBagWinners.forEach(w=>{const amt=w.bags*1500;const existing=results.find(r=>r.name===w.name);if(existing){existing.extraBagAmount=amt;existing.totalPrize+=amt;existing.points=Math.floor(existing.totalPrize/POTY_RATE);}else{results.push({name:w.name,payoutAmount:0,extraBagAmount:amt,totalPrize:amt,points:Math.floor(amt/POTY_RATE)});}});}return results.filter(r=>r.points>0);}
