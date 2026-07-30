/* ============================================================
   04_setup.js
   SetupScreen component — buy-in/stack/reentry configuration
   screen shown before a tournament starts.
   ============================================================ */

/* ==== SETUP ==== */
function SetupScreen({eventType,onBack,onStart}) {
  const cfg=EVENT_CONFIGS[eventType]||EVENT_CONFIGS.miniRoller;
  const isME=cfg.isMainEvent;
  const [name,setName]=useState(_tpl?_tpl.name:`SPC ${cfg.name}`);
  const [buyin,setBuyin]=useState(_tpl?_tpl.buyin:cfg.buyin);
  const [prizeComp,setPrizeComp]=useState(_tpl?_tpl.prizeComponent:cfg.prizeComponent??cfg.buyin);
  const [adminFee,setAdminFee]=useState(_tpl?_tpl.adminFeePercent:cfg.adminFeePercent??4);
  const [guarantee,setGuarantee]=useState(_tpl?_tpl.guarantee:cfg.guarantee??0);
  const [itmPct,setItmPct]=useState(_tpl?_tpl.itmPercent:cfg.itmPercent??15);
  const [bountyAmt,setBountyAmt]=useState(cfg.bountyAmount??0);
  const isMB=eventType==='mysteryBounty';
  const _netPerEntry=prizeComp*(1-adminFee/100); // e.g. 508.80
  const _prizePerEntry=_netPerEntry-(isMB?bountyAmt:0);
  const [stack,setStack]=useState(cfg.stack);
  const [spcSeries,setSpcSeries]=useState(_tpl?_tpl.spcSeries||CURRENT_SPC_SERIES:CURRENT_SPC_SERIES);
  const [selectedTables,setSelectedTables]=useState(Array.from({length:15},(_,i)=>i+1));
  const [seats,setSeats]=useState(9);
  function toggleTable(n){setSelectedTables(s=>s.includes(n)?s.filter(x=>x!==n):[...s,n].sort((a,b)=>a-b));}
  const _tpl=window._importedTemplate&&window._importedTemplate.eventType===eventType?window._importedTemplate:null;
  useEffect(()=>{ window._importedTemplate=null; },[]);
  const [structure,setStructure]=useState((_tpl&&_tpl.structure?_tpl.structure:STRUCTURES[eventType]||STRUCTURES.miniRoller).map((r,i)=>({...r,_id:i})));
  const [inheritFrom,setInheritFrom]=useState(null); // {entries, busted, name}
  const savedME=isME?getIndex().filter(x=>x.eventType&&x.eventType.startsWith('me_')):[];

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
              structure,bountyAmount:isMB?bountyAmt:0};
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
          <div className="grid-2">
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
          </div>
          <div className="form-group"><label className="form-label">Seats / table</label><input className="form-input" type="number" style={{maxWidth:120}} value={seats} onChange={e=>setSeats(+e.target.value)}/></div>
          <div className="form-group">
            <label className="form-label">Tables in play — tap to toggle</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:4}}>
              {Array.from({length:15},(_,i)=>i+1).map(n=>{
                const on=selectedTables.includes(n);
                return <button key={n} type="button" onClick={()=>toggleTable(n)}
                  style={{padding:'7px 13px',borderRadius:6,fontSize:12,fontWeight:700,cursor:'pointer',
                    background:on?'#1a3a22':'#0b1610',border:`1px solid ${on?'#3dba6f':'#152018'}`,color:on?'#3dba6f':'#527a5c'}}>
                  {n}
                </button>;
              })}
            </div>
          </div>
          <div style={{fontSize:11,color:'#2a4a35',marginBottom:4}}>Tables {formatTableRanges(selectedTables)||'none selected'} · {selectedTables.length} × {seats} = {selectedTables.length*seats} seats</div>
          {isME&&savedME.length>0&&(
            <div style={{marginBottom:16}}>
              <div className="form-label">Carry forward from previous flight</div>
              <div style={{display:'flex',flexDirection:'column',gap:5,marginTop:6}}>
                <div
                  className={`saved-item${inheritFrom===null?' ':''}`}
                  style={{cursor:'pointer',background:inheritFrom===null?'#112016':'#0b1610',border:`1px solid ${inheritFrom===null?'#3dba6f40':'#152018'}`,borderRadius:6,padding:'7px 11px',fontSize:12,color:inheritFrom===null?'#3dba6f':'#527a5c'}}
                  onClick={()=>setInheritFrom(null)}
                >None — this is the first flight</div>
                {savedME.map(s=>{
                  const t=loadT(s.id);
                  if(!t) return null;
                  const entries=t.players.length+(t.inheritedEntries||0);
                  const busted=t.players.filter(p=>p.status==='busted').length+(t.inheritedBusted||0);
                  const inheritedPrizePool=t.prizePool||0;
                  const sel=inheritFrom&&inheritFrom.id===s.id;
                  return(
                    <div key={s.id}
                      style={{cursor:'pointer',background:sel?'#112016':'#0b1610',border:`1px solid ${sel?'#3dba6f40':'#152018'}`,borderRadius:6,padding:'7px 11px',transition:'.15s'}}
                      onClick={()=>{
                        const activeP=t.players.filter(p=>p.status==='active');
                        const bagged=(t.baggedPlayers||[]);
                        const allForward=[...activeP.map(p=>({name:p.name,chipCount:p.chipCount||0,inheritedChipCount:p.inheritedChipCount||0})),...bagged];
                        setInheritFrom({id:s.id,entries,busted,inheritedPrizePool,name:s.name,activePlayers:allForward,stack:t.stack||0});
                      }}
                    >
                      <div style={{fontSize:12,color:sel?'#3dba6f':'#b2d4ba',fontWeight:500}}>{s.name}</div>
                      <div style={{fontSize:10,color:'#3a5a42',marginTop:1}}>{entries} entries · {busted} busted · {entries-busted} bagged · {fmt.currency(inheritedPrizePool)} prize pool</div>
                    </div>
                  );
                })}
              </div>
              {inheritFrom&&<div style={{marginTop:8,fontSize:11,color:'#3dba6f',background:'#09140b',border:'1px solid #1a2e22',borderRadius:5,padding:'6px 10px'}}>
                ✓ Carrying {inheritFrom.entries} entries + {inheritFrom.busted} busted from {inheritFrom.name}
              </div>}
            </div>
          )}
          <button className="start-btn" onClick={()=>{if(!selectedTables.length){alert('Pick at least one table.');return;}onStart({name,spcSeries,buyin,prizeComponent:prizeComp,adminFeePercent:adminFee,guarantee,itmPercent:itmPct,stack,maxTables:selectedTables.length,startTable:selectedTables[0],tableNumbers:selectedTables,seatsPerTable:seats,eventType,structure,inheritedEntries:inheritFrom?inheritFrom.entries:0,inheritedBusted:inheritFrom?inheritFrom.busted:0,inheritedPrizePool:inheritFrom?inheritFrom.inheritedPrizePool:0,inheritedPlayers:inheritFrom?inheritFrom.activePlayers:[],inheritedStack:inheritFrom?inheritFrom.stack:0,bountyAmount:isMB?bountyAmt:0});}}>Start tournament →</button>
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
