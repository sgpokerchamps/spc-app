/* ============================================================
   04_setup.js
   SetupScreen component — buy-in/stack/reentry configuration
   screen shown before a tournament starts.
   ============================================================ */

/* ==== SETUP ==== */
function SetupScreen({eventType,onBack,onStart,takenTables}) {
  const _taken=takenTables||{};
  const cfg=EVENT_CONFIGS[eventType]||EVENT_CONFIGS.miniRoller;
  const isME=cfg.isMainEvent;
  const [name,setName]=useState(_tpl?_tpl.name:`SPC ${cfg.name}`);
  const [buyin,setBuyin]=useState(_tpl?_tpl.buyin:cfg.buyin);
  const [prizeComp,setPrizeComp]=useState(_tpl?_tpl.prizeComponent:cfg.prizeComponent??cfg.buyin);
  const [adminFee,setAdminFee]=useState(_tpl?_tpl.adminFeePercent:cfg.adminFeePercent??4);
  const [guarantee,setGuarantee]=useState(_tpl?_tpl.guarantee:cfg.guarantee??0);
  const [lateReg,setLateReg]=useState(_tpl&&_tpl.lateRegLevel!==undefined?(_tpl.lateRegLevel==null?'':_tpl.lateRegLevel):(cfg.lateRegLevel==null?'':cfg.lateRegLevel));
  const [itmPct,setItmPct]=useState(_tpl?_tpl.itmPercent:cfg.itmPercent??15);
  const [bountyAmt,setBountyAmt]=useState(cfg.bountyAmount??0);
  const isSat=eventType==='satellite';
  const [seatValue,setSeatValue]=useState(_tpl&&_tpl.seatValue?_tpl.seatValue:(cfg.seatValue??600));
  const [guaranteedSeats,setGuaranteedSeats]=useState(_tpl&&_tpl.guaranteedSeats?_tpl.guaranteedSeats:(cfg.guaranteedSeats??10));
  const isMB=eventType==='mysteryBounty';
  const _netPerEntry=prizeComp*(1-adminFee/100); // e.g. 508.80
  const _prizePerEntry=_netPerEntry-(isMB?bountyAmt:0);
  const [stack,setStack]=useState(cfg.stack);
  const [spcSeries,setSpcSeries]=useState(_tpl?_tpl.spcSeries||CURRENT_SPC_SERIES:CURRENT_SPC_SERIES);
  const [selectedTables,setSelectedTables]=useState([]);
  const [seats,setSeats]=useState(9);
  function toggleTable(n){if(_taken[n]!=null)return;setSelectedTables(s=>s.includes(n)?s.filter(x=>x!==n):[...s,n].sort((a,b)=>a-b));}
  const _tpl=window._importedTemplate&&window._importedTemplate.eventType===eventType?window._importedTemplate:null;
  useEffect(()=>{ window._importedTemplate=null; },[]);
  const [structure,setStructure]=useState((_tpl&&_tpl.structure?_tpl.structure:STRUCTURES[eventType]||STRUCTURES.miniRoller).map((r,i)=>({...r,_id:i})));
  const isD2=eventType==='me_d2';
  const [parentIds,setParentIds]=useState([]);
  const [aliases,setAliases]=useState({});
  const [splits,setSplits]=useState({});
  const d2Flights=isD2?getIndex().filter(x=>x.eventType&&x.eventType.startsWith('me_')&&x.eventType!=='me_d2').map(x=>({id:x.id,name:x.name,t:loadT(x.id)})).filter(f=>f.t):[];
  const derived=isD2&&parentIds.length?deriveInheritance(d2Flights.filter(f=>parentIds.includes(f.id)).map(f=>f.t),aliases,splits):null;

  function updRow(idx,field,val){setStructure(s=>s.map((r,i)=>i===idx?{...r,[field]:field==='isBreak'?val:Number(val)}:r));}
  function addLevel(){
    const last=structure.filter(r=>!r.isBreak).slice(-1)[0]||{level:0,sb:1000,bb:2000,ante:2000,mins:30};
    setStructure(s=>[...s,{level:(last.level||0)+1,sb:last.sb*2,bb:last.bb*2,ante:last.ante?last.ante*2:0,mins:last.mins,_id:Math.random()}]);
  }
  function addBreak(){setStructure(s=>[...s,{isBreak:true,mins:15,note:'',_id:Math.random()}]);}
  function removeRow(idx){setStructure(s=>s.filter((_,i)=>i!==idx));}

  return(
    <div className="setup">
      <div className="setup-head">
        <button className="back-btn-small" onClick={onBack}>← Back</button>
        <span className="setup-head-title">Configure — {cfg.name}</span>
        <button className="back-btn-small" style={{marginLeft:'auto',borderColor:'#1a3a22',color:'#3dba6f'}}
          onClick={()=>{
            const tpl={_spcExport:'template',_version:1,name,spcSeries,eventType,buyin,prizeComponent:prizeComp,
              adminFeePercent:adminFee,guarantee,itmPercent:itmPct,stack,maxTables,seatsPerTable:seats,
              structure,lateRegLevel:lateReg===''?null:+lateReg,bountyAmount:isMB?bountyAmt:0,...(isSat?{seatValue,guaranteedSeats}:{})};
            const blob=new Blob([JSON.stringify(tpl,null,2)],{type:'application/json'});
            const url=URL.createObjectURL(blob);
            const a=document.createElement('a');
            a.href=url;
            a.download=`spc_template_${name.replace(/[^a-z0-9]/gi,'_').toLowerCase()}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}>↓ Save as template</button>
      </div>
      <div className="setup-body">
        <div className="setup-left">
          <div className="section-title">Tournament settings</div>
          <div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)}/></div>
          <div className="form-group"><label className="form-label">SPC Series</label><input className="form-input" value={spcSeries} onChange={e=>setSpcSeries(e.target.value)} placeholder="e.g. SPC XXII"/><div style={{fontSize:10,color:"#5a8a6a",marginTop:4}}>Which series this tournament belongs to (used on cloud commit)</div></div>
          <div className="grid-2">
            <div className="form-group"><label className="form-label">Total buy-in (S$)</label><input className="form-input" type="number" value={buyin} onChange={e=>setBuyin(+e.target.value)}/></div>
            <div className="form-group"><label className="form-label">Starting chips</label><input className="form-input" type="number" value={stack} onChange={e=>setStack(+e.target.value)}/></div>
          </div>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Prize component (S$)</label>
              <input className="form-input" type="number" value={prizeComp} onChange={e=>setPrizeComp(+e.target.value)}/>
              <div style={{fontSize:10,color:'#5a8a6a',marginTop:4}}>Buy-in minus entry fee</div>
            </div>
            <div className="form-group">
              <label className="form-label">Admin fee (%)</label>
              <input className="form-input" type="number" value={adminFee} onChange={e=>setAdminFee(+e.target.value)}/>
              <div style={{fontSize:10,color:'#5a8a6a',marginTop:4}}>Deducted from prize pool</div>
            </div>
          </div>
          <div style={{background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,padding:'8px 12px',fontSize:11,color:'#3a5a42',marginBottom:4}}>
            {isMB?(
              <>
                <div>Prize component: <strong style={{color:'#3dba6f'}}>S${prizeComp.toLocaleString()}</strong> − {adminFee}% admin (S${(prizeComp*adminFee/100).toFixed(2)}) = S${_netPerEntry.toFixed(2)} net</div>
                <div style={{marginTop:3}}>→ Bounty pool: <strong style={{color:'#c8973a'}}>S${bountyAmt}/entry</strong> &nbsp;·&nbsp; Prize pool: <strong style={{color:'#9b7bce'}}>S${_prizePerEntry.toFixed(2)}/entry</strong></div>
              </>
            ):(
              <>Prize pool per entry: <strong style={{color:'#3dba6f'}}>S${_prizePerEntry.toFixed(2)}</strong> &nbsp;·&nbsp; {buyin} total − {buyin-prizeComp} fee − {adminFee}% admin</>
            )}
          </div>
          {isMB&&(
            <div className="form-group">
              <label className="form-label">Bounty pool per entry (S$)</label>
              <input className="form-input" type="number" value={bountyAmt} onChange={e=>setBountyAmt(+e.target.value)}/>
            </div>
          )}
          {isSat&&(
            <>
              <div style={{fontSize:11,color:'#3a5a42',marginBottom:6}}>Rake-free by default: S$60 per entry goes to the prize pool. Prize component and admin fee stay editable above.</div>
              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">Main Event buy-in / seat value (S$)</label>
                  <input className="form-input" type="number" value={seatValue} onChange={e=>setSeatValue(+e.target.value)}/>
                  <div style={{fontSize:10,color:'#2a4a35',marginTop:4}}>Value of one seat</div>
                </div>
                <div className="form-group">
                  <label className="form-label">Guaranteed seats</label>
                  <input className="form-input" type="number" value={guaranteedSeats} onChange={e=>setGuaranteedSeats(+e.target.value)}/>
                  <div style={{fontSize:10,color:'#2a4a35',marginTop:4}}>Minimum seats awarded</div>
                </div>
              </div>
              <div style={{background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,padding:'8px 12px',fontSize:11,color:'#3a5a42',marginBottom:10}}>
                {guaranteedSeats} seats x S${(seatValue||0).toLocaleString()} = <strong style={{color:'#3dba6f'}}>S${((guaranteedSeats||0)*(seatValue||0)).toLocaleString()}</strong> guaranteed
                {_prizePerEntry>0&&seatValue>0?<> &nbsp;·&nbsp; funded at <strong style={{color:'#c8973a'}}>{Math.ceil((guaranteedSeats||0)*(seatValue||0)/_prizePerEntry)}</strong> entries &nbsp;·&nbsp; 1 extra seat per <strong style={{color:'#c8973a'}}>{Math.ceil(seatValue/_prizePerEntry)}</strong> entries</>:null}
              </div>
            </>
          )}
          {!isSat&&<div className="grid-2">
            <div className="form-group">
              <label className="form-label">Guarantee (S$)</label>
              <input className="form-input" type="number" value={guarantee} onChange={e=>setGuarantee(+e.target.value)}/>
              <div style={{fontSize:10,color:'#2a4a35',marginTop:4}}>0 = no guarantee</div>
            </div>
            <div className="form-group">
              <label className="form-label">ITM %</label>
              <input className="form-input" type="number" value={itmPct} onChange={e=>setItmPct(+e.target.value)}/>
              <div style={{fontSize:10,color:'#2a4a35',marginTop:4}}>% of field paid out</div>
            </div>
          </div>}
          {!cfg.noEntries&&<div className="form-group"><label className="form-label">Late registration ends after level</label><input className="form-input" type="number" style={{maxWidth:120}} value={lateReg} onChange={e=>setLateReg(e.target.value)}/><div style={{fontSize:10,color:'#2a4a35',marginTop:4}}>Advisory: the counter keeps accepting after it; only Close at the desk stops it. Empty = none.</div></div>}
          <div className="form-group"><label className="form-label">Seats / table</label><input className="form-input" type="number" style={{maxWidth:120}} value={seats} onChange={e=>setSeats(+e.target.value)}/></div>
          <div className="form-group">
            <label className="form-label">Tables in play — tap to toggle</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
              {Array.from({length:15},(_,i)=>i+1).map(n=>{
                const on=selectedTables.includes(n);const tk=_taken[n];
                return <button key={n} type="button" disabled={tk!=null} title={tk!=null?('In use by '+tk):''} onClick={()=>toggleTable(n)}
                  style={{padding:'7px 13px',borderRadius:6,fontSize:12,fontWeight:700,cursor:tk!=null?'not-allowed':'pointer',opacity:tk!=null?0.45:1,
                    background:on?'#1a3a22':'#0b1610',border:`1px solid ${tk!=null?'#5a2a2a':on?'#3dba6f':'#152018'}`,color:tk!=null?'#a05555':on?'#3dba6f':'#527a5c'}}>
                  {n}{tk!=null&&<div style={{fontSize:8,fontWeight:600}}>{tk}</div>}
                </button>;
              })}
            </div>
          </div>
          <div style={{fontSize:11,color:'#2a4a35',marginBottom:4}}>Tables {formatTableRanges(selectedTables)||'none selected'} · {selectedTables.length} × {seats} = {selectedTables.length*seats} seats</div>
          {isD2&&(
            <div style={{marginBottom:16}}>
              <div className="form-label">Combine survivors from these Main Event flights</div>
              {d2Flights.length===0&&<div style={{fontSize:11,color:'#a05555',marginTop:6}}>No saved Main Event flights found.</div>}
              <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:6}}>
                {d2Flights.map(f=>{
                  const on=parentIds.includes(f.id);
                  return(<div key={f.id} style={{cursor:'pointer',background:on?'#112016':'#0b1610',border:`1px solid ${on?'#3dba6f40':'#152018'}`,borderRadius:6,padding:'7px 11px'}}
                    onClick={()=>setParentIds(p=>p.includes(f.id)?p.filter(x=>x!==f.id):[...p,f.id])}>
                    <div style={{fontSize:12,color:on?'#3dba6f':'#b2d4ba',fontWeight:500}}>{on?'\u2611 ':'\u2610 '}{f.name}</div>
                    <div style={{fontSize:10,color:'#3a5a42',marginTop:1}}>{f.t.players.length+(f.t.inheritedEntries||0)} entries · {f.t.players.filter(p=>p.status==='active').length+(f.t.baggedPlayers||[]).length} survivors{f.t.inheritedEntries>0||(f.t.baggedPlayers||[]).length>0?' · CHAINED (older save)':''}</div>
                  </div>);
                })}
              </div>
              {derived&&(<div style={{marginTop:10,background:'#09140b',border:'1px solid #1a2e22',borderRadius:6,padding:'9px 11px',fontSize:11,color:'#b2d4ba'}}>
                <div style={{color:'#3dba6f',fontWeight:700,marginBottom:4}}>Preview</div>
                <div>{derived.entries} entries · {derived.busted} busted · {derived.players.length} bags from {derived.parents.length} flight{derived.parents.length>1?'s':''}</div>
                <div>{derived.unique} players on Day 2 · {derived.extraBags} extra bag{derived.extraBags===1?'':'s'} ({fmt.currency(derived.extraBags*1500)})</div>
                <div>Prize pool {fmt.currency(derived.prizePool)}{derived.guarantee>0&&derived.rawPool<derived.guarantee?' (guarantee applies)':''} · chips {derived.chips.toLocaleString()}</div>
                {derived.duplicates.length>0&&<div style={{marginTop:6,color:'#c8973a'}}>Same name bagged in more than one flight. Choose for each:</div>}
                {derived.duplicates.map(d=>(<div key={d.key} style={{marginTop:4,paddingLeft:8,borderLeft:'2px solid #3a2a10'}}>
                  <div style={{color:'#e8d8a0'}}>{d.name}: {d.chips.map(c=>c.src+' ('+c.chip.toLocaleString()+')').join(' / ')}</div>
                  <button type="button" style={{fontSize:10,padding:'2px 8px',cursor:'pointer',marginRight:6,fontWeight:d.split?400:700,background:d.split?'none':'#1a3a22',color:d.split?'#7aaa82':'#3dba6f',border:'1px solid #2a4a35',borderRadius:4}} onClick={()=>setSplits(x=>{const n={...x};delete n[d.key];return n;})}>Same person (one seat, best stack, {d.count-1} extra bag{d.count-1===1?'':'s'})</button>
                  <button type="button" disabled={d.sameFlight} style={{fontSize:10,padding:'2px 8px',cursor:d.sameFlight?'not-allowed':'pointer',opacity:d.sameFlight?0.45:1,fontWeight:d.split?700:400,background:d.split?'#3a2a10':'none',color:d.split?'#e8d8a0':'#7aaa82',border:'1px solid #2a4a35',borderRadius:4}} onClick={()=>setSplits(x=>({...x,[d.key]:true}))}>Different people ({d.count} seats, no extra bag)</button>
                  {d.sameFlight&&<span style={{marginLeft:6,color:'#e07a5f',fontSize:10}}>Two survivors from the same flight cannot be told apart by flight, so they cannot be split here.</span>}
                </div>))}
                {derived.chained.length>0&&<div style={{marginTop:6,color:'#e07a5f'}}>Warning: {derived.chained.join(', ')} carried players from an earlier flight (older chained save). Those players may be counted twice if you also tick the earlier flight.</div>}
                {derived.flags.map((fl,i)=>(<div key={i} style={{marginTop:6,color:'#e07a5f'}}>Possibly the same player: {fl.names.join(' / ')}
                  <button type="button" style={{marginLeft:8,fontSize:10,padding:'2px 8px',cursor:'pointer'}} onClick={()=>setAliases(a=>{const n={...a};fl.keys.forEach(k=>{n[k]=fl.names[0];});return n;})}>Same player</button></div>))}
              </div>)}
              {parentIds.length===0&&<div style={{marginTop:6,fontSize:11,color:'#c8973a'}}>Tick at least one flight to carry survivors forward.</div>}
            </div>
          )}
          <button className="start-btn" onClick={()=>{if(!selectedTables.length){alert('Pick at least one table.');return;}if(isD2&&!derived&&!confirm('No flights are ticked, so Day 2 will start with no players. Continue?'))return;onStart({name,spcSeries,buyin,prizeComponent:prizeComp,adminFeePercent:adminFee,guarantee,itmPercent:itmPct,stack,maxTables:selectedTables.length,startTable:selectedTables[0],tableNumbers:selectedTables,seatsPerTable:seats,eventType,structure,inheritedEntries:derived?derived.entries:0,inheritedBusted:derived?derived.busted:0,inheritedPrizePool:derived?derived.prizePool:0,inheritedPlayers:derived?derived.players:[],inheritedStack:0,parents:derived?parentIds:[],parentAliases:aliases,parentSplits:splits,splitNames:derived?derived.splitNames:[],lateRegLevel:lateReg===''?null:+lateReg,bountyAmount:isMB?bountyAmt:0,...(isSat?{seatValue,guaranteedSeats}:{})});}}>Start tournament →</button>
        </div>
        <div className="setup-right">
          <div className="section-title">Blind structure <span style={{fontWeight:400,color:'#2a4a35',fontSize:9}}>— editable</span></div>
          <table className="struct-table">
            <thead><tr><th>Level</th><th>SB</th><th>BB</th><th>Ante</th><th>Mins</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {structure.map((row,i)=>(
                <tr key={row._id??i} className={row.isBreak?'break-row':''}>
                  <td>{row.isBreak?'☕ Break':`Lvl ${row.level}`}</td>
                  <td>{!row.isBreak&&<input className="si" type="number" value={row.sb} onChange={e=>updRow(i,'sb',e.target.value)}/>}</td>
                  <td>{!row.isBreak&&<input className="si" type="number" value={row.bb} onChange={e=>updRow(i,'bb',e.target.value)}/>}</td>
                  <td>{!row.isBreak&&<input className="si" type="number" value={row.ante} onChange={e=>updRow(i,'ante',e.target.value)}/>}</td>
                  <td><input className="si" type="number" value={row.mins} onChange={e=>updRow(i,'mins',e.target.value)} style={{width:42}}/></td>
                  <td>{row.isBreak&&<input className="si" style={{width:90,color:'#c8973a'}} value={row.note||''} onChange={e=>updRow(i,'note',e.target.value)} placeholder="e.g. Colour Up"/>}</td>
                  <td><button className="del-row-btn" onClick={()=>removeRow(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{display:'flex',gap:8,marginTop:10}}>
            <button className="add-row-btn" style={{flex:2}} onClick={addLevel}>+ Add level</button>
            <button className="add-row-btn" style={{flex:1}} onClick={addBreak}>+ Break</button>
          </div>
        </div>
      </div>
    </div>
  );
}
