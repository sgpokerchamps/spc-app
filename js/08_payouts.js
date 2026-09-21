/* ============================================================
   08_payouts.js
   PayoutsView component — payout table editor, deal-making mode
   (checkbox toggle, editable deal amounts, raw-vs-deal tracking
   for Hendon Mob reporting), publish/unpublish controls.
   ============================================================ */

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
  const [itmInput,setItmInput] = useState(tournament.itmPercent||15);
  const [placesInput,setPlacesInput] = useState(()=>Math.max(1,Math.floor((entries||1)*(tournament.itmPercent||15)/100)));
  const [rows,setRows] = useState(()=>{
    if (tournament.payoutTable && tournament.payoutTable.length) return tournament.payoutTable;
    const _initPool = prizePool - (isMainEvent?(tournament.extraBagCount||0)*1500:0);
    const _pool = _initPool>0 ? _initPool : (guarantee>0 ? guarantee : 0);
    // Use actual entries, or estimate from guarantee, or minimum 50 for structure
    const _entries = entries>0 ? entries : guarantee>0 ? Math.max(50,Math.ceil(guarantee/Math.max(tournament.prizeComponent||500,1))) : 50;
    return generatePayoutRows(_entries, _pool>0?_pool:0, tournament.eventType==='mysteryBounty');
  });

  // When prize pool changes, keep % but recalculate amounts
  useEffect(()=>{
    if (payoutPrizePool>0) setRows(rs=>rs.map(r=>({...r,amount:Math.floor(r.pct/100*payoutPrizePool/100)*100})));
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
    onUpdate({payoutTable:newRows});
  }

  function updateRow(i, field, raw) {
    setRows(rs=>{
      const updated = rs.map((r,j)=>{
        if (j!==i) return r;
        if (field==='pct') {
          const pct=Math.round(parseFloat(raw)*10)/10||0;
          return {...r, pct, amount:Math.floor(pct/100*payoutPrizePool/100)*100};
        } else {
          const v=parseFloat(raw);
          const amount=isNaN(v)?r.amount:Math.round(v/100)*100;
          return {...r, amount, pct:payoutPrizePool>0?Math.round(amount/payoutPrizePool*10000)/100:0};
        }
      });
      onUpdate({payoutTable:updated});
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
    const newPlaces = rows.length + 1;
    const newRows = generatePayoutRows(entries, payoutPrizePool, isMBEvent, newPlaces);
    if (newRows.length === newPlaces) {
      setRows(newRows); onUpdate({payoutTable:newRows});
    } else {
      // Fallback: just append a blank row and redistribute
      setRows(rs=>{
        const r=[...rs,{position:rs.length+1,pct:0,amount:0}];
        onUpdate({payoutTable:r}); return r;
      });
    }
  }

  function removeRow(i) {
    const newPlaces = rows.length - 1;
    if (newPlaces < 1) return;
    const newRows = generatePayoutRows(entries, payoutPrizePool, isMBEvent, newPlaces);
    if (newRows.length === newPlaces) {
      setRows(newRows); onUpdate({payoutTable:newRows});
    } else {
      setRows(rs=>{
        const r=rs.filter((_,j)=>j!==i).map((x,j)=>({...x,position:j+1}));
        onUpdate({payoutTable:r}); return r;
      });
    }
  }

  const totalPaid = rows.reduce((s,r)=>s+(r.amount||0),0);
  const diff = prizePool - totalPaid;
  const posLabel = i => i===0?'1st':i===1?'2nd':i===2?'3rd':`${i+1}th`;
  const posColor = i => i===0?'#f0c040':i===1?'#c8d0d8':i===2?'#c87a3a':'#b2d4ba';

  const [committedIds,setCommittedIds] = useState(()=>getCommittedTournamentIds());
  const [isCommitting,setIsCommitting] = useState(false);
  const canCommit = canCommitTournament(tournament.eventType);
  const isCommitted = committedIds.includes(tournament.id);

  async function commitTournament(){
    const evName = tournament.name||getEventType(tournament.eventType)||'Event';
    const payload = buildTournamentCommitPayload(tournament);
    const problems = validateCommitPayload(payload, tournament);
    if(problems.length && !confirm('Please review before committing:\n\n'+problems.map(p=>(p.level==='error'?'[!] ':'[?] ')+p.msg).join('\n')+'\n\nCommit anyway?')) return;
    let confirmMsg = `Commit ${evName} to cloud? Prize pool S$${(tournament.prizePool||0).toLocaleString()}, ${payload.results.length} players.`;
    if(hasBounty){
      const loggedTotal=Object.values(tournament.bounties||{}).reduce((s,v)=>s+(Number(v)||0),0);
      if(loggedTotal!==bountyPool) confirmMsg += `\n\n⚠ Bounties logged S$${loggedTotal.toLocaleString()} of S$${bountyPool.toLocaleString()} — commit anyway?`;
    }
    if(!confirm(confirmMsg)) return;
    setIsCommitting(true);
    try {
      const reportHtml = generateTournamentReportHTML(tournament);
      const res = await fetch('https://spc-members.onrender.com/api/tournament', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Staff-Pw':'Cowcow808'},
        body:JSON.stringify({...payload, report_html:reportHtml}),
      });
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
      const res = await fetch('https://spc-members.onrender.com/api/tournament/undo', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Staff-Pw':'Cowcow808'},
        body:JSON.stringify({tournament_id:tournament.id}),
      });
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
        <div><div className="view-title">Payouts</div></div>
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
                onKeyDown={e=>{if(e.key==='Enter'){const pct=itmInput;const p=Math.max(1,Math.round(entries*pct/100));setPlacesInput(p);onUpdate({itmPercent:pct});regen(p);}}}/>
              <span style={{fontSize:12,color:'#3a5a42'}}>%</span>
              <button style={{padding:'4px 10px',background:'#0d1a0f',border:'1px solid #1a2e22',borderRadius:4,color:'#3dba6f',fontSize:11,fontWeight:600,cursor:'pointer'}}
                onClick={()=>{const pct=itmInput;const p=Math.max(1,Math.round(entries*pct/100));setPlacesInput(p);onUpdate({itmPercent:pct});regen(p);}}>↻ Recalc</button>
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
          <span>Allocated <strong style={{color:totalPaid>prizePool?'#e05a5a':'#b2d4ba'}}>{fmt.currency(totalPaid)}</strong></span>
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
                  <th style={{width:'12%'}}>Place</th>
                  <th style={{width:'20%'}}>%</th>
                  <th style={{width:tournament.dealMade?'26%':'53%'}}>Amount (S$)</th>
                  {tournament.dealMade&&<th style={{width:'27%',color:'#c8973a'}}>Deal (S$)</th>}
                  <th style={{width:'15%'}}></th>
                </tr>
              </thead>
              <tbody>

                {rows.map((r,i)=>(
                  <tr key={i} style={{borderBottom:'1px solid #0a1412'}}>
                    <td style={{color:posColor(i),fontWeight:i<3?600:400,padding:'7px 14px'}}>{posLabel(i)}</td>
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
                              setRows(rs=>{const upd=rs.map((r2,j)=>j!==i?r2:{...r2,dealAmount,dealAmount_raw:undefined});onUpdate({payoutTable:upd});return upd;});
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
                ))}
              </tbody>
            </table>
            <button className="add-row-btn" style={{marginTop:8,width:'fit-content',padding:'6px 18px'}} onClick={addRow}>
              + Add position
            </button>
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
