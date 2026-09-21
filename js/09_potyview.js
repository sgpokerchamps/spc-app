/* ============================================================
   09_potyview.js
   POTYView component — Player-of-the-Year standings display and
   commit-to-cloud flow. pushTournamentToCloud lives here (not in
   03_poty.js) because it's defined inside this component and
   closes over its local state (pendingPoints, poty, isSyncing).
   ============================================================ */

function POTYView({tournament}) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [poty, setPoty] = useState(()=>initPOTY(currentYear));
  const [showCommit, setShowCommit] = useState(false);
  const [pendingPoints, setPendingPoints] = useState([]);
  const [linkingIdx, setLinkingIdx] = useState(-1);
  const [linkTarget, setLinkTarget] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [syncStatus, setSyncStatus] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);

  async function syncFromCloud(yr){
    setIsSyncing(true); setSyncStatus('Syncing…');
    try {
      const res = await fetch('https://spc-members.onrender.com/api/poty/'+yr, {headers:{'X-Staff-Pw':'Cowcow808'}});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      // Convert cloud format → local POTY shape
      const players = {};
      (data.standings||[]).forEach(s => {
        players[s.player_name] = {points:s.points, events:Array.isArray(s.events_played)?s.events_played:[]};
      });
      const committed = (data.commits||[]).map(c=>c.tournament_id);
      const undoHistory = (data.commits||[]).slice().reverse().map(c=>({
        tournamentId:c.tournament_id, tournamentName:c.tournament_name, date:c.committed_at,
        pointsAdded:c.points_added, commitId:c.id,
      }));
      const newPoty = {year:yr, players, committed, aliases:(poty.aliases||{}), undoHistory};
      setPoty(newPoty);
      savePOTY(newPoty);
      setSyncStatus('Synced '+new Date().toLocaleTimeString());
    } catch(e) {
      setSyncStatus('⚠ Sync failed: '+e.message+' (showing local cache)');
    } finally {
      setIsSyncing(false);
    }
  }

  // Auto-sync on mount and when year changes
  useEffect(()=>{ syncFromCloud(selectedYear); },[selectedYear]);

  const isCurrentYear = selectedYear === currentYear;
  const isCommitted = poty.committed.indexOf(tournament.id)>=0;
  const activePlayers = tournament.players.filter(p=>p.status==='active').length;
  const hasUndo = poty.undoHistory && poty.undoHistory.length > 0;
  const sorted = Object.entries(poty.players).map(([name,d])=>({name,points:d.points,events:d.events||[]})).sort((a,b)=>b.points-a.points);
  const filtered = searchFilter ? sorted.filter(p=>p.name.toLowerCase().includes(searchFilter.toLowerCase())) : sorted;
  const availableYears = getPotyYears();
  function switchYear(yr){
    setSelectedYear(yr);
    setShowCommit(false);
    setPendingPoints([]);
    setSearchFilter('');
    // syncFromCloud will be triggered by the useEffect on selectedYear change
  }
  function startCommit(){if(activePlayers>0){if(!confirm('WARNING: Tournament still has '+activePlayers+' active players. Points will be incomplete.\n\nCommit now?'))return;}const pts=getPotyPoints(tournament);if(pts.length===0){alert('No POTY points — no payouts found.');return;}const resolved=pts.map(p=>{const alias=poty.aliases[p.name];return{...p,potyName:alias||(poty.players[p.name]?p.name:null)};});setPendingPoints(resolved);setShowCommit(true);setLinkingIdx(-1);}
  function resolveLink(idx,target){const updated=[...pendingPoints];updated[idx]={...updated[idx],potyName:target};const newPoty={...poty,aliases:{...poty.aliases,[updated[idx].name]:target}};setPoty(newPoty);savePOTY(newPoty);setPendingPoints(updated);setLinkingIdx(-1);setLinkTarget('');}
  function createNew(idx){const updated=[...pendingPoints];updated[idx]={...updated[idx],potyName:updated[idx].name};setPendingPoints(updated);setLinkingIdx(-1);}
  async function confirmCommit(){
    if(tournament.testMode){alert('This tournament is in TEST MODE - POTY commit is disabled so test data cannot reach the standings.');return;}
    const unlinked=pendingPoints.filter(p=>!p.potyName);
    if(unlinked.length>0){alert(unlinked.length+' unlinked players.');return;}
    const totalPts=pendingPoints.reduce((s,p)=>s+p.points,0);
    const evName=tournament.name||tournament.eventType||'Event';
    if(!confirm('Commit '+totalPts.toLocaleString()+' points from "'+evName+'" across '+pendingPoints.length+' players to the CLOUD POTY?'))return;
    setIsSyncing(true); setSyncStatus('Committing to cloud…');
    try {
      const res = await fetch('https://spc-members.onrender.com/api/poty/commit', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Staff-Pw':'Cowcow808'},
        body:JSON.stringify({
          year:selectedYear,
          tournament_id:tournament.id,
          tournament_name:evName,
          device:(window.electronAPI&&window.electronAPI.platform)||'browser',
          points:pendingPoints.map(p=>({name:p.potyName,points:p.points})),
        }),
      });
      const data = await res.json();
      if(!res.ok){
        if(data.already_committed){
          alert('This tournament has already been committed to POTY '+selectedYear+'.');
        } else {
          alert('Commit failed: '+(data.error||res.statusText));
        }
        setSyncStatus('⚠ Commit failed'); setIsSyncing(false); return;
      }
      // Push tournament data to Supabase too (for Tournament History)
      pushTournamentToCloud(tournament, pendingPoints, poty);
      // Resync from cloud to get fresh standings
      await syncFromCloud(selectedYear);
      setShowCommit(false); setPendingPoints([]);
      alert('Committed to cloud! '+pendingPoints.length+' players, '+totalPts.toLocaleString()+' points.');
    } catch(e) {
      alert('Commit failed: '+e.message+'\n\nPOTY was NOT updated. Check internet connection and try again.');
      setSyncStatus('⚠ Commit failed: '+e.message);
      setIsSyncing(false);
    }
  }


  async function pushTournamentToCloud(t, points, potyData){
    try {
      // Single payload builder shared with the Payouts-tab commit, so both paths send identical data
      // (bounties, unique/re-entries, fee, rounded prize pool). RPC replaces results on every call.
      const payload=buildTournamentCommitPayload(t);
      // Never silently write a known-bad payload; the Payouts tab commit asks the TD first.
      if(validateCommitPayload(payload,t).some(p=>p.level==='error')){console.warn('Cloud push skipped: payload failed validation');return;}

      const res=await fetch('https://spc-members.onrender.com/api/tournament',{
        method:'POST',
        headers:{'Content-Type':'application/json','X-Staff-Pw':'Cowcow808'},
        body:JSON.stringify(payload),
      });
      const data=await res.json();
      if(data.success){
        console.log('Tournament pushed to cloud:',data.tournament_id,data.results_count,'results');
      } else {
        console.warn('Cloud push failed:',data.error);
      }
    } catch(err) {
      // Silently fail — POTY commit still succeeded locally
      console.warn('Cloud push error:',err.message);
    }
  }
  async function undoLastCommit(){
    if(!hasUndo)return;
    const lc=poty.undoHistory[0];
    if(!confirm('Undo cloud commit from "'+lc.tournamentName+'"?'))return;
    setIsSyncing(true); setSyncStatus('Undoing on cloud…');
    try {
      const res = await fetch('https://spc-members.onrender.com/api/poty/undo', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Staff-Pw':'Cowcow808'},
        body:JSON.stringify({year:selectedYear, commit_id:lc.commitId}),
      });
      const data = await res.json();
      if(!res.ok){alert('Undo failed: '+(data.error||res.statusText)); setSyncStatus('⚠ Undo failed'); setIsSyncing(false); return;}
      await syncFromCloud(selectedYear);
      alert('Undone on cloud: '+lc.tournamentName);
    } catch(e) {
      alert('Undo failed: '+e.message); setSyncStatus('⚠ Undo failed'); setIsSyncing(false);
    }
  }
  function exportCSV(){let csv='Rank,Player,Points\n';sorted.forEach((p,i)=>{csv+=(i+1)+',"'+p.name+'",'+p.points+'\n';});if(window.electronAPI&&window.electronAPI.showSaveDialog){window.electronAPI.showSaveDialog({defaultPath:'POTY_'+selectedYear+'_Standings.csv',filters:[{name:'CSV',extensions:['csv']}]}).then(r=>{if(!r.canceled&&r.filePath)window.electronAPI.writeFile(r.filePath,csv);});}else{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));a.download='POTY_'+selectedYear+'_Standings.csv';a.click();}}
  const potyNames=Object.keys(poty.players).sort();
  return(<div style={{flex:1,overflowY:'auto',padding:'18px 22px'}}>
    <div className="view-title" style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}><span>Player of the Year</span>
      <select value={selectedYear} onChange={e=>switchYear(parseInt(e.target.value))} style={{background:'#0a1a10',border:'1px solid #1a3a22',color:'#c8973a',padding:'4px 8px',borderRadius:4,fontSize:16,fontWeight:700,fontFamily:"'Rajdhani',sans-serif",cursor:'pointer'}}>{availableYears.map(y=><option key={y} value={y}>{y}</option>)}</select>
      <span style={{fontSize:12,color:'#7aaa82',fontWeight:400}}>{sorted.length} players</span>
      {!isCurrentYear&&<span style={{fontSize:11,color:'#c87a3a',fontWeight:400}}>(archived)</span>}
      <div style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:10}}>
        {syncStatus&&<span style={{fontSize:13,color:syncStatus.startsWith('⚠')?'#c87a3a':'#7aaa82',fontWeight:500}}>{syncStatus}</span>}
        <button onClick={()=>syncFromCloud(selectedYear)} disabled={isSyncing} style={{padding:'5px 12px',background:'transparent',border:'1px solid #1a5c3a',color:isSyncing?'#527a5c':'#4caf82',fontSize:11,fontWeight:600,borderRadius:5,cursor:isSyncing?'wait':'pointer',fontFamily:'inherit'}}>{isSyncing?'⟳ Syncing…':'🔄 Sync POTY'}</button>
      </div>
    </div>
    {isCurrentYear&&activePlayers>0&&<div style={{background:'#2a1c06',border:'1px solid #c8973a',borderRadius:6,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#c8973a'}}>⚠ Tournament has {activePlayers} active players. Commit after event finishes.</div>}
    <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
      {isCurrentYear&&(!isCommitted?<button className="sf-btn" style={{width:'auto',borderColor:'#c8973a',color:'#c8973a'}} onClick={startCommit}>🏆 Commit this event to POTY</button>:<span style={{fontSize:12,color:'#3dba6f',padding:'7px 10px'}}>✓ This event already committed</span>)}
      {isCurrentYear&&hasUndo&&<button className="sf-btn" style={{width:'auto',borderColor:'#c87a3a',color:'#c87a3a'}} onClick={undoLastCommit}>↩ Undo last commit</button>}
      <button className="sf-btn" style={{width:'auto'}} onClick={exportCSV}>↓ Export CSV</button>
    </div>
    <input type="text" placeholder="Search players..." value={searchFilter} onChange={e=>setSearchFilter(e.target.value)} style={{width:'100%',maxWidth:300,padding:'8px 12px',background:'#0a1a10',border:'1px solid #1a3a22',borderRadius:6,color:'#b2d4ba',fontSize:13,marginBottom:14,fontFamily:'inherit'}}/>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr><th style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'#3dba6f',padding:'8px 14px',borderBottom:'1px solid #152018',textAlign:'left',fontWeight:600,width:50}}>Rank</th><th style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'#3dba6f',padding:'8px 14px',borderBottom:'1px solid #152018',textAlign:'left',fontWeight:600}}>Player</th><th style={{fontSize:9,letterSpacing:1.5,textTransform:'uppercase',color:'#3dba6f',padding:'8px 14px',borderBottom:'1px solid #152018',textAlign:'right',fontWeight:600,width:80}}>Points</th></tr></thead><tbody>
      {filtered.map((p,i)=>{const rank=sorted.indexOf(p)+1;const rowColor=rank===1?'#f0c040':rank===2?'#c8d0d8':rank===3?'#c87a3a':'#b2d4ba';return(<tr key={p.name} style={{borderBottom:'1px solid #0a1412'}}><td style={{padding:'9px 14px',color:rank<=3?rowColor:'#527a5c',fontWeight:rank<=3?700:400}}>{rank}</td><td style={{padding:'9px 14px',color:rowColor,fontWeight:rank<=5?600:400}}>{p.name}</td><td style={{padding:'9px 14px',color:rowColor,textAlign:'right',fontFamily:"'Rajdhani',sans-serif",fontSize:rank<=3?18:14,fontWeight:700}}>{p.points.toLocaleString()}</td></tr>);})}
    </tbody></table>
    {showCommit&&<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}><div style={{background:'#0d1a12',border:'1px solid #1a3a22',borderRadius:12,padding:24,maxWidth:700,width:'90%',maxHeight:'80vh',overflowY:'auto'}}>
      <div style={{fontSize:18,fontWeight:700,color:'#c8973a',marginBottom:4}}>Commit POTY Points</div>
      <div style={{fontSize:12,color:'#7aaa82',marginBottom:16}}>{pendingPoints.length} players with points</div>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:16}}><thead><tr><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'left'}}>Name</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'right'}}>Payout</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'right'}}>Extra Bag</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'right'}}>Points</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'left'}}>POTY Name</th></tr></thead><tbody>
        {pendingPoints.map((p,i)=>(<tr key={i} style={{borderBottom:'1px solid #0a1412'}}><td style={{padding:'6px 10px',color:'#b2d4ba'}}>{p.name}</td><td style={{padding:'6px 10px',color:'#b2d4ba',textAlign:'right'}}>{p.payoutAmount>0?'S$'+p.payoutAmount.toLocaleString():'—'}</td><td style={{padding:'6px 10px',color:'#c8973a',textAlign:'right'}}>{p.extraBagAmount>0?'S$'+p.extraBagAmount.toLocaleString():'—'}</td><td style={{padding:'6px 10px',color:'#f0c040',textAlign:'right',fontWeight:700}}>{p.points}</td><td style={{padding:'6px 10px'}}>{p.potyName?<span style={{color:'#3dba6f',fontSize:12}}>✓ {p.potyName===p.name?'(new)':p.potyName}</span>:linkingIdx===i?<div style={{display:'flex',flexDirection:'column',gap:4}}><select value={linkTarget} onChange={e=>setLinkTarget(e.target.value)} style={{background:'#0a1a10',border:'1px solid #1a3a22',color:'#b2d4ba',padding:'4px 8px',borderRadius:4,fontSize:12}}><option value="">— Select —</option>{potyNames.map(n=><option key={n} value={n}>{n}</option>)}</select><div style={{display:'flex',gap:4}}><button onClick={()=>{if(linkTarget)resolveLink(i,linkTarget);}} style={{fontSize:11,padding:'3px 8px',background:'#1a3a22',border:'1px solid #3dba6f',color:'#3dba6f',borderRadius:4,cursor:'pointer'}}>Link</button><button onClick={()=>createNew(i)} style={{fontSize:11,padding:'3px 8px',background:'#1a2a1a',border:'1px solid #7aaa82',color:'#7aaa82',borderRadius:4,cursor:'pointer'}}>New</button><button onClick={()=>{setLinkingIdx(-1);setLinkTarget('');}} style={{fontSize:11,padding:'3px 8px',background:'none',border:'1px solid #3a2020',color:'#8a4040',borderRadius:4,cursor:'pointer'}}>Cancel</button></div></div>:<button onClick={()=>setLinkingIdx(i)} style={{fontSize:11,padding:'3px 8px',background:'none',border:'1px solid #c8973a',color:'#c8973a',borderRadius:4,cursor:'pointer'}}>Link name</button>}</td></tr>))}
      </tbody></table>
      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button onClick={()=>{setShowCommit(false);setPendingPoints([]);}} style={{padding:'8px 18px',background:'none',border:'1px solid #3a2020',color:'#8a4040',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button><button onClick={confirmCommit} disabled={pendingPoints.some(p=>!p.potyName)} style={{padding:'8px 18px',background:pendingPoints.some(p=>!p.potyName)?'#1a1a1a':'#1a3a22',border:'1px solid '+(pendingPoints.some(p=>!p.potyName)?'#333':'#3dba6f'),color:pendingPoints.some(p=>!p.potyName)?'#555':'#3dba6f',borderRadius:6,cursor:pendingPoints.some(p=>!p.potyName)?'not-allowed':'pointer',fontSize:13,fontWeight:700}}>Commit {pendingPoints.reduce((s,p)=>s+p.points,0).toLocaleString()} points</button></div>
    </div></div>}
  </div>);
}
