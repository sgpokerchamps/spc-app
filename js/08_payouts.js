/* ============================================================
   08_payouts.js
   PayoutsView component — payout table editor, deal-making mode
   (checkbox toggle, editable deal amounts, raw-vs-deal tracking
   for Hendon Mob reporting), publish/unpublish controls.
   ============================================================ */

const DEAL_BLOCK_MSG = 'A deal is active. Undo the deal before importing a structure.';
/* ==== IMPORT PAYOUT STRUCTURE (percentages only; amounts come from the current payout pool) ==== */
function ImportPayoutPanel({tournament, entries, prizePool, payoutPrizePool, extraBags, extraBagDeduction, isMainEvent, payoutMultiple, onApply, onClose}) {
  const [text,setText] = useState('');
  const [res,setRes] = useState(null);
  const fileRef = useRef(null);
  const itm = tournament.itmPercent||15;
  function preview(t){ setRes(parsePayoutStructure(t!=null?t:text,{entries,itmPercent:itm})); }
  function scaleTo100(){
    const scaled = scalePayoutPcts(res.rows);
    const t = 'SPC PAYOUTS\n'+scaled.map(r=>r.position+': '+r.pct).join('\n');
    setText(t); preview(t);
  }
  function loadFile(e){
    const f = e.target.files&&e.target.files[0];
    if(!f) return;
    const rd = new FileReader();
    rd.onload = ()=>{ setText(String(rd.result||'')); setRes(null); };
    rd.readAsText(f);
    e.target.value = '';
  }
  const valid = !!res && res.errors.length===0 && res.rows.length>0;
  const amounts = valid && payoutPrizePool>0 ? payoutAmountsFromPcts(res.rows.map(r=>r.pct),payoutPrizePool,payoutMultiple) : null;
  const totalPaid = amounts ? amounts.reduce((s,r)=>s+r.amount,0) : 0;
  const canApply = !!amounts && !tournament.dealMade;
  const poolLine = isMainEvent&&extraBagDeduction>0 ? 'Prize pool '+fmt.currency(prizePool)+' - '+extraBags+' extra bag'+(extraBags===1?'':'s')+' '+fmt.currency(extraBagDeduction)+' = '+fmt.currency(payoutPrizePool)+' to pay' : 'Prize pool '+fmt.currency(payoutPrizePool)+' to pay';
  const posLabel = n => n===1?'1st':n===2?'2nd':n===3?'3rd':n+'th';
  return(
    <div style={{background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,padding:'12px 14px',marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
        <div style={{fontSize:13,fontWeight:700,color:'#b2d4ba',letterSpacing:1}}>IMPORT PAYOUT STRUCTURE</div>
        <button className="btn-sec" onClick={onClose}>Close</button>
      </div>
      <div style={{fontSize:11,color:'#527a5c',marginBottom:6}}>Paste a structure (first line SPC PAYOUTS, then place: percent). Percentages are applied to the payout pool.</div>
      <textarea value={text} onChange={e=>{setText(e.target.value);setRes(null);}} placeholder={'SPC PAYOUTS\n1: 60\n2: 40'} spellCheck={false} style={{width:'100%',minHeight:140,boxSizing:'border-box',padding:8,background:'#060e09',border:'1px solid #1a2e22',borderRadius:4,color:'#e4f0e8',fontSize:12,fontFamily:'monospace',outline:'none'}}/>
      <div style={{display:'flex',gap:8,margin:'8px 0',alignItems:'center'}}>
        <button className="btn-primary" style={{padding:'6px 16px',fontSize:12}} onClick={()=>preview()}>Preview</button>
        <button className="btn-sec" onClick={()=>fileRef.current&&fileRef.current.click()}>Load file...</button>
        <input ref={fileRef} type="file" accept=".txt,text/plain" style={{display:'none'}} onChange={loadFile}/>
      </div>
      {res&&(
        <div>
          <div style={{fontSize:12,color:'#b2d4ba',marginBottom:6}}>{poolLine}</div>
          {res.errors.length>0&&(
            <div style={{background:'#1a0808',border:'1px solid #4a1a1a',borderRadius:4,padding:'8px 10px',marginBottom:8}}>
              {res.errors.map((m,i)=><div key={i} style={{fontSize:12,color:'#e05a5a'}}>{m}</div>)}
              {res.canScale&&<button className="btn-sec" style={{marginTop:6}} onClick={scaleTo100}>Scale to 100%</button>}
            </div>
          )}
          {res.warnings.length>0&&(
            <div style={{background:'#18140a',border:'1px solid #4a3a1a',borderRadius:4,padding:'8px 10px',marginBottom:8}}>
              {res.warnings.map((m,i)=><div key={i} style={{fontSize:12,color:'#c8973a'}}>Warning: {m}</div>)}
            </div>
          )}
          {valid&&payoutPrizePool<=0&&<div style={{fontSize:12,color:'#e05a5a',marginBottom:8}}>There is no prize pool yet. Register players before importing a structure.</div>}
          {amounts&&(
            <div>
              <div style={{maxHeight:260,overflowY:'auto',border:'1px solid #1a2e22',borderRadius:4,marginBottom:8}}>
                <table className="payout-table" style={{width:'100%'}}>
                  <thead><tr><th>Place</th><th>%</th><th>Amount (S$)</th></tr></thead>
                  <tbody>{amounts.map(r=><tr key={r.position}><td>{posLabel(r.position)}</td><td>{res.rows[r.position-1].pct}</td><td>{r.amount.toLocaleString()}</td></tr>)}</tbody>
                </table>
              </div>
              <div style={{fontSize:12,color:Math.abs(payoutPrizePool-totalPaid)<100?'#3dba6f':'#e05a5a',marginBottom:4}}>Total paid {fmt.currency(totalPaid)} of {fmt.currency(payoutPrizePool)}{Math.abs(payoutPrizePool-totalPaid)<100?' - balanced':''}</div>
              <div style={{fontSize:12,color:'#7aaa82',marginBottom:8}}>{res.rows.length} places paid{entries>0?' ('+(Math.round(res.rows.length/entries*1000)/10)+'% of '+entries+' entries)':''}</div>
            </div>
          )}
          {tournament.dealMade&&<div style={{fontSize:12,color:'#e05a5a',marginBottom:8}}>{DEAL_BLOCK_MSG}</div>}
          <button className="btn-primary" style={{padding:'6px 18px',fontSize:12,opacity:canApply?1:0.4,cursor:canApply?'pointer':'not-allowed'}} disabled={!canApply} onClick={()=>onApply(res.rows)}>Apply</button>
        </div>
      )}
    </div>
  );
}

/* ==== PAYOUTS ==== */
function PayoutsView({tournament, activePlayers, onUpdate, onPublish, onUnpublish}) {
  const entries = tournament.players.length+(tournament.inheritedEntries||0);
  const guarantee = tournament.guarantee||0;
  // Day 2 has prizePerEntry=0 — use the already-computed tournament.prizePool directly
  const prizePool = (tournament.inheritedPrizePool>0 && (tournament.prizePerEntry||0)===0)
    ? tournament.prizePool
    : Math.max(entries>0?Math.round(entries*(tournament.prizePerEntry||(tournament.prizeComponent||0)*(1-(tournament.adminFeePercent||0)/100))*100)/100:0, guarantee);
  const overGuarantee = guarantee>0 && prizePool>guarantee;

  const isMainEvent = tournament.eventType && tournament.eventType.startsWith('me_');
  const EXTRA_BAG_RATE = 1500;
  const [extraBags,setExtraBags] = useState(tournament.extraBagCount||0);
  const [newWinnerName,setNewWinnerName] = useState('');

  // Where a bag winner sits in this tournament: cashed / bag-only (busted without a paid place) / still in / not entered
  function bagWinnerStatus(w){
    const key=normalizeNameKey(w.name);
    const pl=tournament.players.filter(p=>normalizeNameKey(p.name)===key);
    if(!pl.length) return {text:'not in this tournament',color:'#c87a3a'};
    const busted=pl.filter(p=>p.status==='busted').sort((a,b)=>(a.bustPosition||9999)-(b.bustPosition||9999))[0];
    if(!busted) return {text:'still in',color:'#527a5c'};
    const paid=(tournament.payoutTable||[]).find(r=>(r.position||0)===busted.bustPosition&&(r.amount||0)>0);
    return paid?{text:'cashed '+busted.bustPosition+' + bag',color:'#3dba6f'}:{text:'bag only \u00b7 busted '+busted.bustPosition,color:'#c8973a'};
  }
  function syncBagTotal(winners){
    const total=winners.reduce((s,w)=>s+w.bags,0);
    setExtraBags(total);
    onUpdate({extraBagCount:total,extraBagWinners:winners});
  }
  function adjustBag(idx,delta){
    const winners=[...(tournament.extraBagWinners||[])];
    if(!winners[idx])return;
    winners[idx]={...winners[idx],bags:Math.max(0,winners[idx].bags+delta),totalQualifications:Math.max(1,(winners[idx].totalQualifications||1)+delta)};
    if(winners[idx].bags<=0){winners.splice(idx,1);}
    syncBagTotal(winners);
  }
  function removeBagWinner(idx){
    const winners=[...(tournament.extraBagWinners||[])];
    winners.splice(idx,1);
    syncBagTotal(winners);
  }
  function addBagWinner(name){
    if(!name||!name.trim())return;
    const winners=[...(tournament.extraBagWinners||[])];
    const existing=winners.findIndex(w=>w.name===name.trim());
    if(existing>=0){
      winners[existing]={...winners[existing],bags:winners[existing].bags+1,totalQualifications:(winners[existing].totalQualifications||1)+1};
    }else{
      winners.push({name:name.trim(),bags:1,totalQualifications:2});
    }
    syncBagTotal(winners);
    setNewWinnerName('');
  }
  const extraBagDeduction = isMainEvent ? extraBags * EXTRA_BAG_RATE : 0;
  const payoutPrizePool = prizePool - extraBagDeduction;  // what's left for payouts
  const payoutMultiple = tournament.eventType==='mysteryBounty' ? 50 : 100;
  const [showImport,setShowImport] = useState(false);
  const isImported = tournament.payoutSource==='imported';
  // Recalc / add row / remove row regenerate from the standard SPC table, which would overwrite an imported structure.
  const srcReset = isImported ? {payoutSource:'standard'} : {};
  function guardImported(){ return !isImported || window.confirm('This replaces the imported structure with the standard SPC table. Continue?'); }
  function openImport(){
    if (tournament.dealMade) { alert(DEAL_BLOCK_MSG); return; }
    setShowImport(true);
  }
  function applyImport(parsedRows){
    if (tournament.dealMade) { alert(DEAL_BLOCK_MSG); return; }
    if (!(payoutPrizePool>0)) { alert('There is no prize pool yet. Register players before importing a structure.'); return; }
    if (tournament.payoutsPublished && !window.confirm('Payouts are published. This changes what players and the screens see. Apply?')) return;
    const newRows = payoutAmountsFromPcts(parsedRows.map(r=>r.pct), payoutPrizePool, payoutMultiple);
    setRows(newRows);
    onUpdate({payoutTable:newRows,payoutPoolBasis:payoutPrizePool,payoutSource:'imported',payoutImportedAt:Date.now(),activityLog:[...(tournament.activityLog||[]),{ts:Date.now(),type:'payout',detail:'Payout structure imported: '+newRows.length+' places, 1st '+newRows[0].pct+'%'}]});
    setShowImport(false);
  }
  function recalcFromItm(){
    if (!guardImported()) return;
    const pct=itmInput; const p=Math.max(1,Math.round(entries*pct/100));
    setPlacesInput(p); onUpdate({itmPercent:pct}); regen(p);
  }
  const [itmInput,setItmInput] = useState(tournament.itmPercent||15);
  const [placesInput,setPlacesInput] = useState(()=>Math.max(1,Math.floor((entries||1)*(tournament.itmPercent||15)/100)));
  const [rows,setRows] = useState(()=>{
    if (tournament.payoutTable && tournament.payoutTable.length) return tournament.payoutTable;
    const _initPool = prizePool - (isMainEvent?(tournament.extraBagCount||0)*EXTRA_BAG_RATE:0);
    const _pool = _initPool>0 ? _initPool : (guarantee>0 ? guarantee : 0);
    // Use actual entries, or estimate from guarantee, or minimum 50 for structure
    const _entries = entries>0 ? entries : guarantee>0 ? Math.max(50,Math.ceil(guarantee/Math.max(tournament.prizeComponent||500,1))) : 50;
    return generatePayoutRows(_entries, _pool>0?_pool:0, tournament.eventType==='mysteryBounty');
  });

  // When the payout pool changes, keep the percentages and recalculate the amounts (shared rounding, 1st topped up).
  // A saved table is also written back, so the floor, the screens and the commit never carry amounts from an older
  // pool. payoutPoolBasis is the pool the saved amounts were last computed for: without it a re-visit would
  // overwrite figures a TD typed by hand. dealAmount and other per-row fields are left untouched.
  useEffect(()=>{
    if (!(payoutPrizePool>0)) return;
    const saved = !!(tournament.payoutTable && tournament.payoutTable.length);
    if (saved) {
      if (tournament.payoutPoolBasis===payoutPrizePool) return;
      if (tournament.payoutPoolBasis==null) { onUpdate({payoutPoolBasis:payoutPrizePool}); return; }
    }
    const fresh = payoutAmountsFromPcts(rows.map(r=>r.pct), payoutPrizePool, payoutMultiple);
    const next = rows.map((r,i)=>({...r,amount:fresh[i].amount}));
    setRows(next);
    if (saved) onUpdate({payoutTable:next,payoutPoolBasis:payoutPrizePool});
  },[payoutPrizePool]);

  const isMBEvent = tournament.eventType==='mysteryBounty';
  const bountyCfg = EVENT_CONFIGS[tournament.eventType];
  const hasBounty = !!(bountyCfg && bountyCfg.bountyAmount);
  const bountyAmountPerEntry = tournament.bountyAmount || (bountyCfg && bountyCfg.bountyAmount) || 0;
  const bountyPool = tournament.bountyPool || 0;
  const [showBounties,setShowBounties] = useState(false);
  function regen(p) {
    const places = p || Math.max(1, Math.round(entries * itmInput / 100));
    const newRows = generatePayoutRows(entries, payoutPrizePool, isMBEvent, places);
    setRows(newRows);
    onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:newRows,...srcReset});
  }

  function updateRow(i, field, raw) {
    setRows(rs=>{
      const updated = rs.map((r,j)=>{
        if (j!==i) return r;
        if (field==='pct') {
          const pct=Math.round(parseFloat(raw)*10)/10||0;
          return {...r, pct, amount:Math.floor(pct/100*payoutPrizePool/payoutMultiple)*payoutMultiple};
        } else {
          const v=parseFloat(raw);
          const amount=isNaN(v)?r.amount:Math.round(v/payoutMultiple)*payoutMultiple;
          return {...r, amount, pct:payoutPrizePool>0?Math.round(amount/payoutPrizePool*10000)/100:0};
        }
      });
      onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:updated});
      return updated;
    });
  }
  function updateRowRaw(i, field, raw) {
    setRows(rs=>{
      const updated=rs.map((r,j)=>j!==i?r:{...r,[field+'_raw']:raw});
      return updated;
    });
  }
  function commitRow(i, field) {
    setRows(rs=>{
      const r=rs[i];
      const raw=r[field+'_raw'];
      if(raw===undefined||raw==='') return rs;
      const updated=rs.map((r2,j)=>j!==i?r2:{...r2,[field+'_raw']:undefined});
      return updated;
    });
    const r=rows[i];
    const raw=r[field+'_raw'];
    if(raw!==undefined&&raw!=='') updateRow(i,field,raw);
  }

  function addRow() {
    if (!guardImported()) return;
    const newPlaces = rows.length + 1;
    const newRows = generatePayoutRows(entries, payoutPrizePool, isMBEvent, newPlaces);
    if (newRows.length === newPlaces) {
      setRows(newRows); onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:newRows,...srcReset});
    } else {
      // Fallback: just append a blank row and redistribute
      setRows(rs=>{
        const r=[...rs,{position:rs.length+1,pct:0,amount:0}];
        onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:r,...srcReset}); return r;
      });
    }
  }

  function removeRow(i) {
    if (!guardImported()) return;
    const newPlaces = rows.length - 1;
    if (newPlaces < 1) return;
    const newRows = generatePayoutRows(entries, payoutPrizePool, isMBEvent, newPlaces);
    if (newRows.length === newPlaces) {
      setRows(newRows); onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:newRows,...srcReset});
    } else {
      setRows(rs=>{
        const r=rs.filter((_,j)=>j!==i).map((x,j)=>({...x,position:j+1}));
        onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:r,...srcReset}); return r;
      });
    }
  }

  const totalPaid = rows.reduce((s,r)=>s+(r.amount||0),0);
  const diff = payoutPrizePool - totalPaid;
  const posLabel = i => i===0?'1st':i===1?'2nd':i===2?'3rd':`${i+1}th`;
  const posColor = i => i===0?'#f0c040':i===1?'#c8d0d8':i===2?'#c87a3a':'#b2d4ba';
  // Which player finished in each place. 1st never has a bustPosition (the winner doesn't bust) -
  // treated separately as the sole remaining active player. Re-entries can leave a stale busted
  // record under the same name; getFinishingPositions already resolves to each name's final bust.
  // Two different players can still collide on the same bustPosition (a known historical bug -
  // recovered events may still carry it locally even after the cloud copy was SQL-patched, and the
  // commit-time validator's own duplicate-position check is the real backstop). Rather than silently
  // keeping one name and dropping the other, list every name a position collides on so it's visibly
  // wrong instead of quietly blank.
  const finishPositions = getFinishingPositions(tournament.players);
  const positionNames = {};
  Object.keys(finishPositions).forEach(n=>{
    const pos=finishPositions[n].position;
    (positionNames[pos]=positionNames[pos]||[]).push(n);
  });
  const winnerName = getWinnerName(tournament.players);

  const [committedIds,setCommittedIds] = useState(()=>getCommittedTournamentIds());
  const [isCommitting,setIsCommitting] = useState(false);
  const canCommit = canCommitTournament(tournament.eventType);
  const isCommitted = committedIds.includes(tournament.id);

  async function commitTournament(){
    const evName = tournament.name||getEventType(tournament.eventType)||'Event';
    const payload = buildTournamentCommitPayload(tournament);
    const problems = validateCommitPayload(payload, tournament);
    if(problems.length && !confirm('Please review before committing:\n\n'+problems.map(p=>(p.level==='error'?'[!] ':'[?] ')+p.msg).join('\n')+'\n\nCommit anyway?')) return;
    let confirmMsg = `${tournament.testMode?'[TEST MODE - hidden from history and stats] ':''}Commit ${evName} to cloud? Prize pool S$${(tournament.prizePool||0).toLocaleString()}, ${payload.results.length} players.`;
    if(hasBounty){
      const loggedTotal=Object.values(tournament.bounties||{}).reduce((s,v)=>s+(Number(v)||0),0);
      if(loggedTotal!==bountyPool) confirmMsg += `\n\n⚠ Bounties logged S$${loggedTotal.toLocaleString()} of S$${bountyPool.toLocaleString()} — commit anyway?`;
    }
    if(!confirm(confirmMsg)) return;
    setIsCommitting(true);
    try {
      const reportHtml = generateTournamentReportHTML(tournament);
      const res = await staffFetch('https://spc-members.onrender.com/api/tournament', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload, report_html:reportHtml}),
      });
      if(!res) return;
      const data = await res.json();
      if(!res.ok||!data.success){ alert('Commit failed: '+(data.error||res.statusText)); setIsCommitting(false); return; }
      markTournamentCommitted(tournament.id);
      setCommittedIds(getCommittedTournamentIds());
      if(data.report_upload_error) alert('Committed, but report upload failed: '+data.report_upload_error);
    } catch(e) {
      alert('Commit failed: '+e.message+'\n\nCheck internet connection and try again.');
    } finally {
      setIsCommitting(false);
    }
  }

  async function undoCommitTournament(){
    const evName = tournament.name||getEventType(tournament.eventType)||'this event';
    if(!confirm(`Undo cloud commit for "${evName}"? This deletes the tournament and its results from the cloud.`)) return;
    setIsCommitting(true);
    try {
      const res = await staffFetch('https://spc-members.onrender.com/api/tournament/undo', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tournament_id:tournament.id}),
      });
      if(!res) return;
      const data = await res.json();
      if(!res.ok||!data.success){ alert('Undo failed: '+(data.error||res.statusText)); setIsCommitting(false); return; }
      markTournamentUncommitted(tournament.id);
      setCommittedIds(getCommittedTournamentIds());
    } catch(e) {
      alert('Undo failed: '+e.message);
    } finally {
      setIsCommitting(false);
    }
  }

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div className="view-head">
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          {/* Hidden dev toggle: shift-click the title. Test tournaments are flagged test_mode in the cloud and hidden from history/stats. */}
          <div className="view-title" onClick={e=>{if(e.shiftKey)onUpdate({testMode:!tournament.testMode});}}>Payouts</div>
          {tournament.testMode&&<span style={{background:'#3a1414',border:'1px solid #8a2a2a',color:'#e05a5a',borderRadius:4,padding:'2px 8px',fontSize:10,fontWeight:700,letterSpacing:1.5}}>TEST MODE</span>}
        </div>
        <div className="btn-row">
          {tournament.payoutsPublished
            ?<>
              <div style={{display:'flex',alignItems:'center',gap:6,background:'#0b1f10',border:'1px solid #1a4a22',borderRadius:7,padding:'6px 14px'}}>
                <span style={{color:'#3dba6f',fontSize:12}}>✓</span>
                <span style={{color:'#3dba6f',fontSize:12,fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:1}}>Published</span>
              </div>
              <button className="btn-sec" style={{color:'#e05a5a',borderColor:'#4a1a1a'}} onClick={onUnpublish}>↩ Undo Publish</button>
            </>
            :<button className="btn-primary" style={{padding:'6px 16px',fontSize:12}} onClick={onPublish}>📢 Publish Payouts</button>
          }
          {hasBounty&&<button className="btn-sec" style={showBounties?{color:'#c8973a',borderColor:'#4a2c1a'}:{}} onClick={()=>setShowBounties(s=>!s)}>Log Bounties</button>}
          {canCommit&&tournament.eventType==='me_d2'&&(
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#527a5c'}} title="Totals across flights 1A-1D (Day 2 only sees survivors). Needed for Hendon Mob.">
              <span>Flights:</span>
              <input type="number" min="0" className="form-input" placeholder="unique" style={{width:64,padding:'4px 6px',fontSize:12,textAlign:'center'}}
                value={tournament.flightUniqueEntries!=null?tournament.flightUniqueEntries:''}
                onChange={e=>onUpdate({flightUniqueEntries:e.target.value===''?null:Math.max(0,parseInt(e.target.value)||0)})}/>
              <input type="number" min="0" className="form-input" placeholder="re-entries" style={{width:78,padding:'4px 6px',fontSize:12,textAlign:'center'}}
                value={tournament.flightReentries!=null?tournament.flightReentries:''}
                onChange={e=>onUpdate({flightReentries:e.target.value===''?null:Math.max(0,parseInt(e.target.value)||0)})}/>
            </div>
          )}
          {canCommit&&(
            isCommitting
              ?<button className="sf-btn" disabled style={{width:'auto',opacity:0.7,cursor:'wait'}}>⟳ Committing…</button>
              :isCommitted
                ?<>
                  <button className="sf-btn" style={{width:'auto',borderColor:'#3dba6f',color:'#3dba6f'}} onClick={commitTournament}>✓ Committed · Re-commit?</button>
                  <button className="btn-sec" style={{color:'#c87a3a',borderColor:'#4a2c1a'}} onClick={undoCommitTournament}>↩ Undo</button>
                </>
                :<button className="sf-btn" style={{width:'auto',borderColor:'#4fa8d4',color:'#4fa8d4'}} onClick={commitTournament}>☁ Commit Tournament</button>
          )}
        </div>
      </div>
      <div className="payouts-view">
        {/* Summary cards */}
        <div className="payout-stats">
          <div className="pstat">
            <div className="pstat-lbl">Net prize pool</div>
            <div className="pstat-val">{fmt.currency(prizePool)}</div>
            {guarantee>0&&(
              <div style={{fontSize:10,marginTop:3,color:overGuarantee?'#3dba6f':'#c8973a'}}>
                {!overGuarantee&&`Guarantee applies · S$${(guarantee-Math.max(0,Math.round(entries*(tournament.prizePerEntry||(tournament.prizeComponent||0)*(1-(tournament.adminFeePercent||0)/100))*100)/100)).toLocaleString()} overlay`}
              </div>
            )}
          </div>
          <div className="pstat">
            <div className="pstat-lbl">Entries</div>
            <div className="pstat-val" style={{color:'#b2d4ba'}}>{entries}</div>
            {entries>0&&guarantee>0&&<div style={{fontSize:10,color:'#3a5a42',marginTop:3}}>Need {Math.ceil(guarantee/((tournament.prizeComponent||1)*(1-(tournament.adminFeePercent||0)/100)))} entries to cover</div>}
          </div>
          <div className="pstat">
            <div className="pstat-lbl">ITM %</div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:6,flexWrap:'wrap'}}>
              <input type="number" className="form-input" style={{width:58,padding:'4px 8px',fontSize:15}}
                value={itmInput}
                onChange={e=>setItmInput(+e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){recalcFromItm();}}}/>
              <span style={{fontSize:12,color:'#3a5a42'}}>%</span>
              <button style={{padding:'4px 10px',background:'#0d1a0f',border:'1px solid #1a2e22',borderRadius:4,color:'#3dba6f',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={recalcFromItm}>↻ Recalc</button>
              <button style={{padding:'4px 10px',background:'#0d1a0f',border:'1px solid #1a2e22',borderRadius:4,color:'#c8973a',fontSize:11,fontWeight:600,cursor:'pointer'}} onClick={openImport}>Import structure</button>
            </div>
            <div style={{fontSize:10,color:'#2a4a35',marginTop:3}}>{Math.round(entries*itmInput/100)} places from {entries} entries</div>
          </div>
          <div className="pstat">
            <div className="pstat-lbl">Places paid</div>
            <div className="pstat-val" style={{color:'#b2d4ba',marginTop:4}}>{rows.length}</div>
            <div style={{fontSize:10,color:'#2a4a35',marginTop:2}}>per SPC structure</div>
          </div>
          {hasBounty&&(
            <div className="pstat">
              <div className="pstat-lbl">Bounty pool</div>
              <div className="pstat-val" style={{color:'#c8973a'}}>{fmt.currency(bountyPool)}</div>
              <div style={{fontSize:10,color:'#2a4a35',marginTop:2}}>S${bountyAmountPerEntry} x {entries} entries</div>
            </div>
          )}
        </div>

        {/* Extra Bag Bonus — Main Event only */}
        {isMainEvent&&(
          <div style={{background:'#0d0c04',border:'1px solid #2a1e06',borderRadius:7,padding:'12px 16px',marginBottom:14}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
              <div>
                <div style={{fontSize:10,letterSpacing:1.5,textTransform:'uppercase',color:'#c8973a',marginBottom:4,fontWeight:600}}>Extra Bag Bonus  ·  S$1,500 per extra bag</div>
                <div style={{fontSize:11,color:'#3a5a42'}}>Players who bag twice receive S$1,500 cash — deducted from prize pool before payout distribution</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <input
                    type="number" min="0"
                    className="form-input"
                    style={{width:70,padding:'5px 8px',fontSize:15,textAlign:'center'}}
                    value={extraBags}
                    onChange={e=>{
                      const n=Math.max(0,parseInt(e.target.value)||0);
                      setExtraBags(n);
                      onUpdate({extraBagCount:n});
                    }}
                  />
                  <span style={{fontSize:12,color:'#3a5a42'}}>bags</span>
                </div>
                {extraBags>0&&(
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:11,color:'#c8973a'}}>−{fmt.currency(extraBagDeduction)} deducted</div>
                    <div style={{fontSize:11,color:'#3dba6f'}}>Payout pool: {fmt.currency(payoutPrizePool)}</div>
                  </div>
                )}
              </div>
            </div>
            {/* Extra Bag Winners list */}
            <div style={{marginTop:12,borderTop:'1px solid #2a1e06',paddingTop:10}}>
              <div style={{fontSize:10,letterSpacing:1.5,textTransform:'uppercase',color:'#c8973a',marginBottom:8,fontWeight:600}}>
                Extra bag winners
                {tournament.extraBagWinners&&tournament.extraBagWinners.length>0&&
                  ` (${tournament.extraBagWinners.length} player${tournament.extraBagWinners.length!==1?'s':''} · ${tournament.extraBagWinners.reduce((s,w)=>s+w.bags,0)} total bags)`
                }
              </div>
              {tournament.extraBagWinners&&tournament.extraBagWinners.length>0&&(
                <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:10}}>
                  {tournament.extraBagWinners.map((w,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 10px',background:'#1a1004',border:'1px solid #2a1c06',borderRadius:5,fontSize:12}}>
                      <span style={{color:'#e8d8a0',fontWeight:600,flex:1}}>{w.name}{w.country?' '+countryFlag(w.country):''}</span>
                      {(()=>{const st=bagWinnerStatus(w);return <span style={{color:st.color,fontSize:10}}>{st.text}</span>;})()}
                      <span style={{color:'#527a5c',fontSize:10}}>({w.totalQualifications||'-'} flights)</span>
                      <button style={{background:'none',border:'1px solid #2a1c06',borderRadius:3,color:'#8a4040',cursor:'pointer',fontSize:13,padding:'1px 6px',lineHeight:'18px'}}
                        onClick={()=>adjustBag(i,-1)} title="Remove 1 bag">−</button>
                      <span style={{color:'#c8973a',fontWeight:700,minWidth:24,textAlign:'center'}}>×{w.bags}</span>
                      <button style={{background:'none',border:'1px solid #2a1c06',borderRadius:3,color:'#3dba6f',cursor:'pointer',fontSize:13,padding:'1px 6px',lineHeight:'18px'}}
                        onClick={()=>adjustBag(i,+1)} title="Add 1 bag">+</button>
                      <button style={{background:'none',border:'none',color:'#3a2020',cursor:'pointer',fontSize:12,padding:'0 4px'}}
                        onClick={()=>removeBagWinner(i)} title="Remove player">✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <datalist id="bag-winner-names">{[...new Set(tournament.players.map(p=>p.name))].map(n=><option key={n} value={n}/>)}</datalist>
                <input type="text" list="bag-winner-names" placeholder="Player name" value={newWinnerName} onChange={e=>setNewWinnerName(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'){addBagWinner(newWinnerName);}}}
                  style={{flex:1,maxWidth:200,padding:'5px 8px',background:'#060e09',border:'1px solid #2a1c06',borderRadius:4,color:'#e4f0e8',fontSize:12,outline:'none'}}/>
                <button style={{padding:'5px 10px',background:'#0d1a0f',border:'1px solid #1a2e22',borderRadius:4,color:'#3dba6f',fontSize:11,fontWeight:600,cursor:'pointer'}}
                  onClick={()=>addBagWinner(newWinnerName)}>+ Add winner</button>
              </div>
            </div>
          </div>
        )}
        {showImport&&<ImportPayoutPanel tournament={tournament} entries={entries} prizePool={prizePool} payoutPrizePool={payoutPrizePool} extraBags={extraBags} extraBagDeduction={extraBagDeduction} isMainEvent={isMainEvent} payoutMultiple={payoutMultiple} onApply={applyImport} onClose={()=>setShowImport(false)}/>}
        {/* Deal mode toggle */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'8px 14px',background:tournament.dealMade?'#1a1004':'#09140b',border:'1px solid '+(tournament.dealMade?'#2a1c06':'#1a2e22'),borderRadius:6,marginBottom:14}}>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:tournament.dealMade?'#c8973a':'#7aaa82',fontWeight:600,userSelect:'none'}}>
            <input type="checkbox" checked={!!tournament.dealMade} onChange={e=>{
              const on=e.target.checked;
              if(on){
                const withDeal=rows.map(r=>({...r,dealAmount:r.amount}));
                setRows(withDeal);
                onUpdate({dealMade:true,payoutTable:withDeal});
              } else {
                const withoutDeal=rows.map(r=>{const {dealAmount,dealAmount_raw,...rest}=r;return rest;});
                setRows(withoutDeal);
                onUpdate({dealMade:false,payoutTable:withoutDeal});
              }
            }} style={{cursor:'pointer'}}/>
            <span>Deal made</span>
          </label>
          {tournament.dealMade&&<span style={{fontSize:11,color:'#c8973a'}}>Deal amounts editable in table below · raw amounts preserved for Hendon Mob</span>}
        </div>
        {/* Reconciliation bar */}
        <div style={{display:'flex',gap:16,padding:'8px 14px',background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,fontSize:12,color:'#527a5c',marginBottom:14,flexWrap:'wrap'}}>
          <span>{isMainEvent&&extraBagDeduction>0?'Payout pool':'Prize pool'} <strong style={{color:'#c8973a'}}>{fmt.currency(payoutPrizePool)}</strong></span>
          <span>·</span>
          <span>Allocated <strong style={{color:totalPaid>payoutPrizePool?'#e05a5a':'#b2d4ba'}}>{fmt.currency(totalPaid)}</strong></span>
          <span>·</span>
          <span style={{color:Math.abs(diff)<100?'#3dba6f':diff>0?'#c8973a':'#e05a5a',fontWeight:600}}>
            {Math.abs(diff)<100?'✓ Balanced':diff>0?`${fmt.currency(diff)} unallocated`:`${fmt.currency(-diff)} over budget`}
          </span>
        </div>

        {/* Payout table */}
        {entries===0?(
          <div className="empty-state">Add players to calculate payouts.</div>
        ):(
          <>
            <table className="payout-table" style={{tableLayout:'fixed',width:'100%'}}>
              <thead>
                <tr>
                  <th style={{width:tournament.dealMade?'8%':'10%'}}>Place</th>
                  <th style={{width:tournament.dealMade?'18%':'20%'}}>Player</th>
                  <th style={{width:tournament.dealMade?'12%':'16%'}}>%</th>
                  <th style={{width:tournament.dealMade?'25%':'39%'}}>Amount (S$)</th>
                  {tournament.dealMade&&<th style={{width:'25%',color:'#c8973a'}}>Deal (S$)</th>}
                  <th style={{width:tournament.dealMade?'12%':'15%'}}></th>
                </tr>
              </thead>
              <tbody>

                {rows.map((r,i)=>{
                  const pos=r.position||(i+1);
                  const namesHere=pos===1?(winnerName?[winnerName]:[]):(positionNames[pos]||[]);
                  const collision=namesHere.length>1;
                  const finishedName=namesHere.length===1?namesHere[0]:null;
                  return (
                  <tr key={i} style={{borderBottom:'1px solid #0a1412'}}>
                    <td style={{color:posColor(i),fontWeight:i<3?600:400,padding:'7px 14px'}}>{posLabel(i)}</td>
                    <td style={{padding:'7px 14px',color:collision?'#e05a5a':finishedName?'#b2d4ba':'#3a5a42',fontWeight:collision?700:finishedName?600:400,fontSize:13}} title={collision?namesHere.join(', '):undefined}>{collision?`${namesHere.length} players (!)`:(finishedName||'—')}</td>
                    <td style={{padding:'4px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <input type="number" step="0.1" min="0" max="100"
                          style={{background:'#0b1610',border:'1px solid #1a2e22',color:'#b2d4ba',padding:'4px 7px',borderRadius:4,width:64,fontSize:13,fontFamily:"'Barlow',sans-serif",outline:'none'}}
                          value={r.pct}
                          onChange={e=>updateRow(i,'pct',e.target.value)}/>
                        <span style={{fontSize:11,color:'#3a5a42'}}>%</span>
                      </div>
                    </td>
                    <td style={{padding:'4px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:12,color:'#3a5a42'}}>S$</span>
                        <input type="text" inputMode="numeric"
                          style={{background:'#0b1610',border:'1px solid #2a4a32',color:'#3dba6f',padding:'4px 7px',borderRadius:4,width:100,fontSize:13,fontWeight:600,fontFamily:"'Rajdhani',sans-serif",outline:'none'}}
                          value={r.amount_raw!==undefined?r.amount_raw:r.amount}
                          onChange={e=>updateRowRaw(i,'amount',e.target.value)}
                          onBlur={()=>commitRow(i,'amount')}
                          onKeyDown={e=>{if(e.key==='Enter')commitRow(i,'amount');}}/>
                      </div>
                    </td>
                    {tournament.dealMade&&<td style={{padding:'4px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:12,color:'#c8973a'}}>S$</span>
                        <input type="text" inputMode="numeric"
                          style={{background:'#1a1004',border:'1px solid #2a1c06',color:'#c8973a',padding:'4px 7px',borderRadius:4,width:100,fontSize:13,fontWeight:600,fontFamily:"'Rajdhani',sans-serif",outline:'none'}}
                          value={r.dealAmount_raw!==undefined?r.dealAmount_raw:(r.dealAmount!==undefined?r.dealAmount:r.amount)}
                          onChange={e=>updateRowRaw(i,'dealAmount',e.target.value)}
                          onBlur={()=>{
                            const raw=rows[i].dealAmount_raw;
                            if(raw!==undefined&&raw!==''){
                              const v=parseFloat(raw);
                              const dealAmount=isNaN(v)?rows[i].dealAmount:Math.round(v/100)*100;
                              setRows(rs=>{const upd=rs.map((r2,j)=>j!==i?r2:{...r2,dealAmount,dealAmount_raw:undefined});onUpdate({payoutPoolBasis:payoutPrizePool,payoutTable:upd});return upd;});
                            } else {
                              setRows(rs=>rs.map((r2,j)=>j!==i?r2:{...r2,dealAmount_raw:undefined}));
                            }
                          }}
                          onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}/>
                      </div>
                    </td>}
                    <td style={{padding:'4px 10px'}}>
                      <button className="del-row-btn" onClick={()=>removeRow(i)}>✕</button>
                    </td>
                  </tr>
                  );})}
              </tbody>
            </table>
            <button className="add-row-btn" style={{marginTop:8,width:'fit-content',padding:'6px 18px'}} onClick={addRow}>
              + Add position
            </button>
            {isImported&&<div style={{marginTop:8,fontSize:11,color:'#c8973a'}}>Imported structure ({rows.length} places)</div>}
          </>
            )}
        {hasBounty&&showBounties&&<BountyPanel tournament={tournament} bountyPool={bountyPool} onUpdate={onUpdate}/>}
      </div>
    </div>
  );
}

/* ==== BOUNTY LOGGING PANEL ==== */
function BountyPanel({tournament, bountyPool, onUpdate}) {
  const bounties = tournament.bounties || {};
  const [raw,setRaw] = useState(()=>{
    const r={};
    Object.entries(bounties).forEach(([id,v])=>{ r[id]=String(v); });
    return r;
  });
  const players = [...tournament.players].sort((a,b)=>a.name.localeCompare(b.name));
  const loggedTotal = Object.values(bounties).reduce((s,v)=>s+(Number(v)||0),0);
  const diff = bountyPool - loggedTotal;
  const isExact = bountyPool>0 && diff===0;
  const isOver = diff<0;
  const barColor = isExact?'#3dba6f':isOver?'#e05a5a':'#c8973a';
  const barText = isExact
    ? `✓ Bounties logged: ${fmt.currency(loggedTotal)} of ${fmt.currency(bountyPool)}`
    : isOver
      ? `Bounties logged: ${fmt.currency(loggedTotal)} of ${fmt.currency(bountyPool)} · ${fmt.currency(-diff)} over`
      : `Bounties logged: ${fmt.currency(loggedTotal)} of ${fmt.currency(bountyPool)} · ${fmt.currency(diff)} remaining`;

  function handleChange(id, val) {
    setRaw(r=>({...r,[id]:val}));
    const v=parseFloat(val);
    const updated={...bounties};
    if (val===''||isNaN(v)) delete updated[id]; else updated[id]=v;
    onUpdate({bounties:updated});
  }

  return (
    <div style={{background:'#09140b',border:'1px solid #1a2e22',borderRadius:7,padding:'14px 16px',marginTop:14}}>
      <div style={{fontSize:12,fontWeight:600,color:barColor,marginBottom:12}}>{barText}</div>
      <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:400,overflowY:'auto'}}>
        {players.map(p=>(
          <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 10px',background:'#0b1610',border:'1px solid #152018',borderRadius:5}}>
            <span style={{flex:1,fontSize:13,color:'#b2d4ba'}}>{p.name}{p.country?' '+countryFlag(p.country):''}</span>
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <span style={{fontSize:12,color:'#3a5a42'}}>S$</span>
              <input type="text" inputMode="numeric" placeholder="0"
                style={{background:'#0b1610',border:'1px solid #1a2e22',color:'#c8973a',padding:'4px 7px',borderRadius:4,width:90,fontSize:13,fontWeight:600,fontFamily:"'Rajdhani',sans-serif",outline:'none'}}
                value={raw[p.id]!==undefined?raw[p.id]:(bounties[p.id]!=null?String(bounties[p.id]):'')}
                onChange={e=>handleChange(p.id,e.target.value)}/>
            </div>
          </div>
        ))}
        {players.length===0&&<div style={{fontSize:12,color:'#3a5a42',padding:'8px 0'}}>No players registered yet.</div>}
      </div>
    </div>
  );
}

/* ==== SATELLITE PAYOUTS (seats, not cash) ==== */
function SatellitePayoutsView({tournament, onUpdate, onPublish, onUnpublish}) {
  const s=getSatelliteSeats(tournament);
  const activeNames=[...new Set(tournament.players.filter(p=>p.status==='active').map(p=>p.name))];
  const fp=getFinishingPositions(tournament.players);
  const bustedSeat=Object.keys(fp).filter(n=>fp[n].position<=s.seats).sort((a,b)=>fp[a].position-fp[b].position);
  const reached=activeNames.length>0&&activeNames.length<=s.seats;
  const seatWinners=reached||bustedSeat.length>0?[...activeNames.filter(()=>reached),...bustedSeat]:[];
  const bubbleName=s.bubblePos?Object.keys(fp).find(n=>fp[n].position===s.bubblePos):null;
  const numStyle={width:90,padding:'4px 8px',fontSize:15};
  return(
    <div className="players-view" style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div className="view-head">
        <div className="view-title">Payouts</div>
        <div className="btn-row">
          {tournament.payoutsPublished
            ?<>
              <div style={{display:'flex',alignItems:'center',gap:6,background:'#0b1f10',border:'1px solid #1a4a22',borderRadius:7,padding:'6px 14px'}}>
                <span style={{color:'#3dba6f',fontSize:12}}>✓</span>
                <span style={{color:'#3dba6f',fontSize:12,fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:1}}>Published</span>
              </div>
              <button className="btn-sec" style={{color:'#e05a5a',borderColor:'#4a1a1a'}} onClick={onUnpublish}>↩ Undo Publish</button>
            </>
            :<button className="btn-primary" style={{padding:'6px 16px',fontSize:12}} onClick={onPublish}>📢 Publish Payouts</button>
          }
        </div>
      </div>
      <div className="payouts-view">
        <div className="payout-stats">
          <div className="pstat">
            <div className="pstat-lbl">Net prize pool</div>
            <div className="pstat-val">{fmt.currency(s.pool)}</div>
          </div>
          <div className="pstat">
            <div className="pstat-lbl">Entries</div>
            <div className="pstat-val" style={{color:'#b2d4ba'}}>{s.entries}</div>
          </div>
          <div className="pstat">
            <div className="pstat-lbl">Seat value</div>
            <div style={{display:'flex',alignItems:'center',gap:5,marginTop:6}}>
              <span style={{fontSize:13,color:'#3a5a42'}}>S$</span>
              <input key={'sv'+s.seatValue} type="number" className="form-input" style={numStyle} defaultValue={s.seatValue}
                onBlur={e=>{const v=Number(e.target.value);if(v>0)onUpdate({seatValue:v});}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}/>
            </div>
            <div style={{fontSize:10,color:'#2a4a35',marginTop:3}}>{s.perSeatEntries} entries per seat</div>
          </div>
          <div className="pstat">
            <div className="pstat-lbl">Seats awarded</div>
            <div className="pstat-val" style={{color:'#b2d4ba'}}>{s.seats}</div>
            <div style={{fontSize:10,color:'#2a4a35',marginTop:3}}>{s.fromGuarantee?'guarantee':'field'} · guaranteed
              <input key={'gs'+s.guaranteed} type="number" className="form-input" style={{width:54,marginLeft:6,padding:'2px 6px',fontSize:12}} defaultValue={s.guaranteed}
                onBlur={e=>{const v=Math.floor(Number(e.target.value));if(v>0)onUpdate({guaranteedSeats:v});}} onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}/>
            </div>
          </div>
        </div>
        <div style={{background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,padding:'10px 14px',fontSize:13,color:'#b2d4ba',marginBottom:10}}>
          Pool <strong>{fmt.currency(s.pool)}</strong> · {s.seats} seat{s.seats===1?'':'s'} x {fmt.currency(s.seatValue)} = <strong>{fmt.currency(s.seatsTotal)}</strong>
          {s.overlay>0&&<> · <strong style={{color:'#e05a5a'}}>Overlay {fmt.currency(s.overlay)} (SPC-funded)</strong></>}
          {s.leftover>0&&<> · <strong style={{color:'#3dba6f'}}>Leftover {fmt.currency(s.leftover)} to bubble</strong></>}
        </div>
        <div style={{fontSize:11,color:'#3a5a42',marginBottom:12}}>Seats are live: 1 extra seat per {s.perSeatEntries} entries, so the count can rise with re-entries.</div>
        {s.allSeats&&<div style={{background:'#2a1c06',border:'1px solid #c8973a',borderRadius:6,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#c8973a'}}>Entries are not more than the seats on offer - every player wins a seat.</div>}
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead><tr style={{borderBottom:'1px solid #1a2e22'}}>
            <th style={{padding:'8px 10px',textAlign:'left',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42'}}>Place</th>
            <th style={{padding:'8px 10px',textAlign:'left',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42'}}>Player</th>
            <th style={{padding:'8px 10px',textAlign:'right',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42'}}>Prize</th>
          </tr></thead>
          <tbody>
            <tr style={{borderBottom:'1px solid #0e1a12'}}>
              <td style={{padding:'10px',color:'#c8973a',fontWeight:700}}>{s.seats} seat winner{s.seats===1?'':'s'}</td>
              <td style={{padding:'10px',color:'#b2d4ba'}}>
                {seatWinners.length>0
                  ?seatWinners.join(', ')
                  :<span style={{color:'#527a5c'}}>{activeNames.length} players remaining, seats awarded when {s.seats} remain</span>}
              </td>
              <td style={{padding:'10px',textAlign:'right',color:'#3dba6f',fontWeight:700}}>Seat</td>
            </tr>
            {s.bubblePos&&(
              <tr style={{borderBottom:'1px solid #0e1a12'}}>
                <td style={{padding:'10px',color:'#b2d4ba'}}>{s.bubblePos}{(['th','st','nd','rd'][(s.bubblePos%100-20)%10]||['th','st','nd','rd'][s.bubblePos%100]||'th')} (bubble)</td>
                <td style={{padding:'10px',color:'#b2d4ba'}}>{bubbleName||<span style={{color:'#527a5c'}}>not yet determined</span>}</td>
                <td style={{padding:'10px',textAlign:'right',color:'#3dba6f',fontWeight:700}}>{fmt.currency(s.leftover)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
