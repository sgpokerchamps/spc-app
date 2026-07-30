/* ============================================================
   07_views.js
   Floor-facing subviews shown inside the Sidebar navigation:
   Register, Blind Edit, Clock, Players (+ RegistrationBoard
   helper), Tables, Activity Log. POTYView and PayoutsView are
   NOT here — they're substantial enough to get their own files
   (09_potyview.js, 08_payouts.js) per the plan.
   ============================================================ */

/* ==== REGISTER VIEW ==== */
function RegisterView({tournament, onRegister, onSetMode, onAssignSeat, serverInfo}) {
  const inputRef = useRef(null);
  const [lastScanned, setLastScanned] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [selIdx, setSelIdx] = useState(-1);
  const [recentLog, setRecentLog] = useState(tournament.regLog||[]);
  const [syncStatus, setSyncStatus] = useState(() => {
    try {
      const ts = localStorage.getItem('spc_members_synced_at');
      const cache = JSON.parse(localStorage.getItem('spc_members_cache')||'{}');
      const count = Object.keys(cache).length;
      return ts ? `${count} members · synced ${new Date(ts).toLocaleString()}` : 'Not synced';
    } catch(e) { return 'Not synced'; }
  });

  async function syncMembers() {
    setSyncStatus('Syncing...');
    try {
      const res = await fetch('https://spc-members.onrender.com/api/members');
      const data = await res.json();
      if(data.members) {
        const cache = {};
        data.members.forEach((m, i) => {
          const key = m.member_id || ('noId_'+i);
          cache[key] = {name: m.name, country: m.country || null, memberId: m.member_id || null};
        });
        localStorage.setItem('spc_members_cache', JSON.stringify(cache));
        localStorage.setItem('spc_members_synced_at', data.syncedAt);
        setSyncStatus(`${data.members.length} members · synced ${new Date(data.syncedAt).toLocaleString()}`);
      }
    } catch(e) {
      setSyncStatus('Sync failed — check internet connection');
    }
  }
  const displayLog = recentLog.filter(r=>Date.now()-r.ts<600000);
  function addToLog(entry){
    setRecentLog(prev=>{
      const updated=[entry,...prev].slice(0,100);
      // Sync back to tournament state for persistence
      if(window._spcUpdateRegLog) window._spcUpdateRegLog(updated);
      return updated;
    });
  }

  const evCfg = EVENT_CONFIGS[tournament.eventType]||null;
  const mode = tournament.seatingMode||'auto';
  const [assigningId,setAssigningId]=useState(null);
  const [assignTable,setAssignTable]=useState('');
  const [assignSeatN,setAssignSeatN]=useState('');
  const spt=tournament.seatsPerTable||9;
  const allTables=getTableNumbers(tournament);
  function getEmptySeats(tNum){
    if(!tNum)return[];
    const occupied=new Set(tournament.players.filter(p=>p.status==='active'&&p.tableNum===Number(tNum)).map(p=>p.seatNum));
    const seats=[];
    for(let s=1;s<=spt;s++){const lk=(tournament.seatLocks||{})[tNum+'-'+s];if(!occupied.has(s)&&lk!=='reg'&&lk!=='all')seats.push(s);}
    return seats;
  }
  function confirmAssign(){
    if(assigningId&&assignTable&&assignSeatN){onAssignSeat(assigningId,Number(assignTable),Number(assignSeatN));setAssigningId(null);setAssignTable('');setAssignSeatN('');}
  }
  const cur = tournament.structure[tournament.currentLevelIdx];
  const curLevel = cur&&!cur.isBreak ? cur.level : null;

  // Re-entry open/closed
  const reentryUntil = evCfg ? evCfg.reentryUntilLevel : 0;
  const maxR = evCfg ? evCfg.maxReentries : 0;
  const reentryOpen = reentryUntil > 0 && (curLevel === null || curLevel <= reentryUntil);
  const reentryDesc = !evCfg ? '' :
    maxR === 0 ? 'No re-entries' :
    maxR === 1 ? `1 re-entry · closes after Level ${reentryUntil}` :
    `Unlimited re-entries · closes after Level ${reentryUntil}`;

  // Unassigned players (manual mode)
  const unassigned = tournament.players.filter(p=>p.status==='active'&&!p.tableNum);

  // Stats
  const active = tournament.players.filter(p=>p.status==='active').length;
  const totalEntries = tournament.players.length + (tournament.inheritedEntries||0);
  const tablesUsed = [...new Set(tournament.players.filter(p=>p.status==='active'&&p.tableNum).map(p=>p.tableNum))].length;

  // Focus scan field on mount and whenever user clicks anywhere in the panel
  useEffect(()=>{ if(inputRef.current) inputRef.current.focus(); },[]);

  function handleScan(raw) {
    setLastScanned('');
    setSuggestions([]);
    setSelIdx(-1);
    const result = parseQR(raw);
    if(!result) return;
    const name = result.name;
    const country = result.country || null;

    // Check for duplicate (same name, currently active)
    const isDup = !!tournament.players.find(p=>p.name===name&&p.status==='active');
    // Check re-entry (same name was busted before)
    const wasActive = !!tournament.players.find(p=>p.name===name&&p.status==='busted');
    const isReentry = wasActive && !isDup;

    // 1B: check max re-entries
    if(isReentry && maxR === 1) {
      const prevReentries = recentLog.filter(l=>l.name===name&&l.isReentry).length;
      if(prevReentries >= 1) {
        alert(`${name} has already used their 1 re-entry (Flight 1B rule).`);
        return;
      }
    }

    onRegister(name, false, country);
    SoundEngine.register();

    // Find the seat that was just assigned (last registered player)
    // We look it up after state update — store it for the log
    const logEntry = {name, country, isDup, isReentry, ts: Date.now(), tableNum: null, seatNum: null};
    addToLog(logEntry);
  }

  function handleKeyDown(e) {
    if(e.key==='ArrowDown') {
      e.preventDefault();
      setSelIdx(i => Math.min(i+1, suggestions.length-1));
    } else if(e.key==='ArrowUp') {
      e.preventDefault();
      setSelIdx(i => Math.max(i-1, -1));
    } else if(e.key==='Enter') {
      if(selIdx>=0 && suggestions[selIdx]) {
        const picked = suggestions[selIdx];
        setLastScanned('');
        setSuggestions([]);
        setSelIdx(-1);
        handleScan(picked);
      } else {
        const val = e.target.value.trim();
        if(val) { handleScan(val); e.target.value=''; }
      }
    } else if(e.key==='Escape') {
      setSuggestions([]);
      setSelIdx(-1);
    }
  }

  function handleChange(e) {
    const val = e.target.value;
    setLastScanned(val);
    const q = val.trim().toLowerCase();
    if(q.length < 2) { setSuggestions([]); setSelIdx(-1); return; }
    // Don't show suggestions for SPC Member IDs
    if(/^spc-/i.test(q)) { setSuggestions([]); setSelIdx(-1); return; }
    try {
      const cache = JSON.parse(localStorage.getItem('spc_members_cache')||'{}');
      const names = Object.values(cache).map(e => typeof e === 'string' ? e : e.name).filter(Boolean);
      const matches = names.filter(n => n.toLowerCase().includes(q)).slice(0, 6);
      setSuggestions(matches);
      setSelIdx(-1);
    } catch(e) { setSuggestions([]); }
  }

  return(
    <div className="reg-wrap" onClick={()=>inputRef.current&&inputRef.current.focus()}>
      <div className="reg-header">
        <div className="reg-title">Registration</div>
        <div className="reg-mode-row">
          <span className="reg-mode-label">Seating</span>
          <div className="mode-toggle">
            <button className={`mode-btn ${mode==='auto'?'active':''}`} onClick={e=>{e.stopPropagation();onSetMode('auto');}}>Auto</button>
            <button className={`mode-btn ${mode==='manual'?'active':''}`} onClick={e=>{e.stopPropagation();onSetMode('manual');}}>Manual</button>
          </div>
        </div>
      </div>

      {/* Staff connection URLs */}
      {serverInfo&&(
        <div style={{display:'flex',gap:10,marginBottom:16}}>
          <div style={{flex:1,background:'#0f0c04',border:'1px solid #2a1c06',borderRadius:8,padding:'10px 14px'}}>
            <div style={{fontSize:11,letterSpacing:1.5,textTransform:'uppercase',color:'#c8973a',marginBottom:5,fontWeight:700}}>Counter staff URL</div>
            <div style={{fontSize:15,color:'#e8d8a0',fontWeight:700,wordBreak:'break-all'}}>{`http://${serverInfo.ip}:${serverInfo.port}/register`}</div>
          </div>
          <div style={{flex:1,background:'#060e09',border:'1px solid #1a2e22',borderRadius:8,padding:'10px 14px'}}>
            <div style={{fontSize:11,letterSpacing:1.5,textTransform:'uppercase',color:'#7aaa82',marginBottom:5,fontWeight:700}}>Floor staff URL</div>
            <div style={{fontSize:15,color:'#3dba6f',fontWeight:700,wordBreak:'break-all'}}>{`http://${serverInfo.ip}:${serverInfo.port}`}</div>
          </div>
        </div>
      )}

      {/* Member sync */}
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16,background:'#0a0812',border:'1px solid #2a1c3a',borderRadius:8,padding:'10px 14px'}}>
        <button onClick={e=>{e.stopPropagation();syncMembers();}} style={{padding:'8px 16px',background:'#C9A227',color:'#111',fontSize:13,fontWeight:700,border:'none',borderRadius:6,cursor:'pointer',whiteSpace:'nowrap'}}>Sync Members</button>
        <div style={{fontSize:12,color:'#a89060'}}>{syncStatus}</div>
      </div>

      {/* Stats row */}
      <div className="reg-info-row">
        <div className="reg-info-card">
          <div className="reg-info-lbl">Active players</div>
          <div className="reg-info-val">{active}</div>
        </div>
        <div className="reg-info-card">
          <div className="reg-info-lbl">Total entries</div>
          <div className="reg-info-val">{totalEntries}</div>
        </div>
        <div className="reg-info-card">
          <div className="reg-info-lbl">Tables</div>
          <div className="reg-info-val">{tablesUsed}</div>
        </div>
        {evCfg&&evCfg.reentryUntilLevel>0&&(
          <div className="reg-info-card">
            <div className="reg-info-lbl">Re-entries</div>
            <div className="reg-info-val" style={{fontSize:13}}>
              <span className={`reentry-badge ${reentryOpen?'open':'closed'}`}>
                {reentryOpen ? '⬤ OPEN' : '✕ CLOSED'}
              </span>
              <div style={{fontSize:12,color:'#7aaa82',marginTop:4}}>{reentryDesc}</div>
            </div>
          </div>
        )}
      </div>

      {/* Scan input */}
      <div className="scan-box">
        <div className="scan-label">Scan SPC card / boarding pass / type name + Enter</div>
        <input
          ref={inputRef}
          className="scan-input"
          placeholder="Ready to scan…"
          value={lastScanned}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {suggestions.length>0 && (
          <div style={{position:'relative'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,zIndex:50,background:'#1a2a1e',border:'1px solid #3a5a3e',borderRadius:8,maxHeight:240,overflowY:'auto'}}>
              {suggestions.map((s,i)=>(
                <div key={s}
                  onMouseDown={e=>{e.preventDefault();setLastScanned('');setSuggestions([]);setSelIdx(-1);handleScan(s);}}
                  style={{padding:'10px 14px',cursor:'pointer',fontSize:15,color:i===selIdx?'#111':'#e8f0ea',background:i===selIdx?'#c8973a':'transparent',borderBottom:'1px solid #2a3a2e'}}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="scan-hint">
          {mode==='auto' ? 'Player will be auto-seated at the least-full table' : 'Player will be added to the unassigned queue — assign seats from Tables tab'}
        </div>
      </div>

      {/* Unassigned queue (manual mode) */}
      {unassigned.length>0&&(
        <div className="unassigned-queue">
          <div className="uq-hdr">
            <span className="uq-title">⚠ Awaiting seat assignment — {unassigned.length} player{unassigned.length!==1?'s':''}</span>
          </div>
          {unassigned.map(p=>(
            <div key={p.id} style={{padding:'8px 14px',borderBottom:'1px solid #1a2e22'}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span className="uq-name">{p.name}{pf(p)}</span>
                {assigningId===p.id?(
                  <button style={{fontSize:11,background:'none',border:'1px solid #3a2020',borderRadius:4,color:'#8a4040',cursor:'pointer',padding:'3px 8px'}} onClick={()=>setAssigningId(null)}>Cancel</button>
                ):(
                  <button className="uq-btn" onClick={()=>{if(mode==='auto'){onAssignSeat(p.id);}else{setAssigningId(p.id);setAssignTable('');setAssignSeatN('');}}}>{mode==='auto'?'Auto assign':'Choose seat'}</button>
                )}
              </div>
              {assigningId===p.id&&(
                <div style={{display:'flex',gap:6,alignItems:'center',marginTop:6}}>
                  <select style={{flex:1,padding:'6px 8px',background:'#060e09',border:'1px solid #1a2e22',borderRadius:4,color:'#b2d4ba',fontSize:12,outline:'none'}}
                    value={assignTable} onChange={e=>{setAssignTable(e.target.value);setAssignSeatN('');}}>
                    <option value="">— Table —</option>
                    {allTables.map(t=>{const occ=tournament.players.filter(pp=>pp.status==='active'&&pp.tableNum===t).length;return <option key={t} value={t}>Table {t} ({occ}/{spt})</option>;})}
                  </select>
                  <select style={{flex:1,padding:'6px 8px',background:'#060e09',border:'1px solid #1a2e22',borderRadius:4,color:'#b2d4ba',fontSize:12,outline:'none'}}
                    value={assignSeatN} onChange={e=>setAssignSeatN(e.target.value)} disabled={!assignTable}>
                    <option value="">— Seat —</option>
                    {getEmptySeats(assignTable).map(s=><option key={s} value={s}>Seat {s}</option>)}
                  </select>
                  <button style={{padding:'6px 12px',background:'#1a3a22',border:'1px solid #2a5a32',borderRadius:4,color:'#3dba6f',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}
                    onClick={confirmAssign} disabled={!assignTable||!assignSeatN}>✓ Assign</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Recent registrations log */}
      <div className="reg-log">
        <div className="reg-log-hdr">
          <span className="reg-log-title">Recent registrations</span>
          <span style={{fontSize:11,color:'#3a5a42'}}>{displayLog.length} this session</span>
        </div>
        <div className="reg-log-list">
          {displayLog.length===0&&(
            <div style={{padding:'20px 16px',textAlign:'center',color:'#2a4a35',fontSize:12}}>No registrations yet this session</div>
          )}
          {displayLog.map((r,i)=>{
            // Look up current seat from tournament state
            const live = tournament.players.find(p=>p.name===r.name&&p.status==='active');
            const seatStr = live&&live.tableNum ? `T${live.tableNum} S${live.seatNum}` : null;
            return(
              <div key={i} className={`reg-log-row ${r.isDup?'dup':''}`}>
                <span className="reg-log-num">{displayLog.length-i}</span>
                <span className="reg-log-name">{r.name}{r.country?' '+countryFlag(r.country):''}</span>
                {r.isDup&&<span className="reg-log-badge dup">DUP</span>}
                {r.isReentry&&!r.isDup&&<span className="reg-log-badge reentry">RE-ENTRY</span>}
                {seatStr
                  ? <span className="reg-log-seat">{seatStr}</span>
                  : <span className="reg-log-seat unassigned">Unassigned</span>
                }
                <span className="reg-log-time">{new Date(r.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
/* ==== BLIND EDIT VIEW ==== */
function BlindEditView({tournament, onUpdate, onSetChips}) {
  const structure = tournament.structure || [];
  const curIdx = tournament.currentLevelIdx || 0;

  function inputStyle(highlight) {
    return {width:72,padding:'4px 6px',background:highlight?'#0f0c04':'#060e09',border:'1px solid '+(highlight?'#2a1c06':'#0e1a12'),borderRadius:4,color:highlight?'#e8d8a0':'#b2d4ba',fontSize:12,outline:'none',textAlign:'right'};
  }

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div className="view-head">
        <div>
          <div className="view-title">Blind Structure</div>
          <div className="view-sub">Edit any level — changes take effect immediately</div>
        </div>
        {tournament.stack===0&&(
          <div style={{display:'flex',alignItems:'center',gap:8,background:'#0f0c04',border:'1px solid #2a1c06',borderRadius:8,padding:'8px 14px'}}>
            <span style={{fontSize:11,color:'#c8973a',fontWeight:600,whiteSpace:'nowrap'}}>Chips in play</span>
            <input type="number" placeholder={`e.g. ${((tournament.players.length+(tournament.inheritedEntries||0))*25000).toLocaleString()}`}
              defaultValue={tournament.chipsInPlay||''}
              style={{width:130,padding:'4px 8px',background:'#06090a',border:'1px solid #2a1c06',borderRadius:4,color:'#e4f0e8',fontSize:13,outline:'none'}}
              onBlur={e=>{if(onSetChips)onSetChips(e.target.value);}}
              onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}/>
            <span style={{fontSize:10,color:'#527a5c'}}>chips total</span>
          </div>
        )}
      </div>
      <div style={{flex:1,overflow:'auto',padding:'0 24px 24px'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
          <thead>
            <tr style={{borderBottom:'1px solid #1a2e22'}}>
              <th style={{padding:'8px 10px',textAlign:'left',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42',fontWeight:600}}>Level</th>
              <th style={{padding:'8px 10px',textAlign:'right',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42',fontWeight:600}}>SB</th>
              <th style={{padding:'8px 10px',textAlign:'right',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42',fontWeight:600}}>BB</th>
              <th style={{padding:'8px 10px',textAlign:'right',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42',fontWeight:600}}>Ante</th>
              <th style={{padding:'8px 10px',textAlign:'right',fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#3a5a42',fontWeight:600}}>Mins</th>
            </tr>
          </thead>
          <tbody>
            {structure.map((lv,i)=>{
              const isCur=i===curIdx;
              const isPast=i<curIdx;
              const textColor=isCur?'#e8d8a0':isPast?'#3a5a42':'#b2d4ba';
              return(
                <tr key={i} style={{background:isCur?'#0f0c04':'transparent',borderBottom:'1px solid #0e1a12',borderLeft:isCur?'3px solid #c8973a':'3px solid transparent'}}>
                  <td style={{padding:'6px 10px',color:isCur?'#c8973a':textColor,fontWeight:isCur?700:400}}>
                    {lv.isBreak?`Break${lv.note?' — '+lv.note:''}`:`Level ${lv.level}`}
                    {isCur&&<span style={{fontSize:10,marginLeft:6,color:'#c8973a',fontWeight:700}}>← NOW</span>}
                  </td>
                  {lv.isBreak?(
                    <>
                      <td colSpan={3} style={{padding:'6px 10px',color:'#2a4a35',textAlign:'center',fontSize:11,fontStyle:'italic'}}>break</td>
                      <td style={{padding:'6px 10px',textAlign:'right'}}>
                        <input style={inputStyle(isCur)} type="number" defaultValue={lv.mins}
                          onBlur={e=>onUpdate(i,'mins',e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
                      </td>
                    </>
                  ):(
                    <>
                      <td style={{padding:'6px 10px',textAlign:'right'}}>
                        <input style={inputStyle(isCur)} type="number" defaultValue={lv.sb}
                          onBlur={e=>onUpdate(i,'sb',e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right'}}>
                        <input style={inputStyle(isCur)} type="number" defaultValue={lv.bb}
                          onBlur={e=>onUpdate(i,'bb',e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right'}}>
                        <input style={inputStyle(isCur)} type="number" defaultValue={lv.ante||0}
                          onBlur={e=>onUpdate(i,'ante',e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
                      </td>
                      <td style={{padding:'6px 10px',textAlign:'right'}}>
                        <input style={inputStyle(isCur)} type="number" defaultValue={lv.mins}
                          onBlur={e=>onUpdate(i,'mins',e.target.value)}
                          onKeyDown={e=>e.key==='Enter'&&e.target.blur()}/>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
/* ==== CLOCK ==== */
function ClockView({tournament,cur,nxt,activePlayers,bustedPlayers,tablesInUse,secs,clockCls,onToggle,onPrev,onNext,onAdjust,totalEntries,onUpdateBlinds,onRegisterRandom,onBustRandom}) {
  const _evCfg=EVENT_CONFIGS[tournament.eventType]||null;
  const [ctxMenu,setCtxMenu]=useState(null); // {x,y}
  const isBreak=cur&&cur.isBreak;
  const isComplete=tournament.status==='complete';
  const isRunning=tournament.status==='running';
  const clockRef=useRef(null);
  const [isFS,setIsFS]=useState(false);

  function handleContextMenu(e){
    e.preventDefault();
    setCtxMenu({x:e.clientX,y:e.clientY});
  }
  function closeCtx(){ setCtxMenu(null); }
  function ctxRegister(){ closeCtx(); onRegisterRandom&&onRegisterRandom(); }
  function ctxBust(){ closeCtx(); onBustRandom&&onBustRandom(); }
  function ctxToggleClock(){ closeCtx(); onToggle(); }
  useEffect(()=>{
    function onFSChange(){setIsFS(!!document.fullscreenElement);}
    document.addEventListener('fullscreenchange',onFSChange);
    return()=>document.removeEventListener('fullscreenchange',onFSChange);
  },[]);
  useEffect(()=>{
    function onKeyDown(e){
      if(e.code==='Space'&&e.target===document.body){
        e.preventDefault();
        onToggle();
      }
    }
    document.addEventListener('keydown',onKeyDown);
    return()=>document.removeEventListener('keydown',onKeyDown);
  },[onToggle]);
  function toggleFS(){
    if(!document.fullscreenElement) clockRef.current?.requestFullscreen().catch(()=>{});
    else document.exitFullscreen();
  }
  const entries=tournament.players.length;
  const _effChips=tournament.chipsInPlay||(entries*(tournament.stack||0));const avgStack=activePlayers.length>0?Math.round(_effChips/activePlayers.length):0;
  const fsTimerColor=secs<=60?'#e05a5a':secs<=300?'#c8973a':'#e4f0e8';
  const [_fsPage,_setFsPage]=useState(0);
  const _fsAllPayouts=(()=>{
    if(!tournament) return [];
    let rows=[];
    if(tournament.payoutTable&&tournament.payoutTable.length) rows=tournament.payoutTable;
    else{
      const _e=(tournament.players||[]).length+(tournament.inheritedEntries||0);
      const _pp=tournament.prizePool||0;
      if(_e>0&&_pp>0) rows=generatePayoutRows(_e,_pp,tournament.eventType==='mysteryBounty');
    }
    if(!rows.length) return [];
    const collapsed=[];
    let i=0;
    while(i<rows.length){
      let j=i;
      while(j+1<rows.length&&rows[j+1].amount===rows[i].amount) j++;
      const label=i===j
        ?(i===0?'1st':i===1?'2nd':i===2?'3rd':`${i+1}th`)
        :`${i+1}${i===0?'st':i===1?'nd':i===2?'rd':'th'}–${j+1}${j===0?'st':j===1?'nd':j===2?'rd':'th'}`;
      collapsed.push({label,amount:rows[i].amount,top:i<3?i:-1});
      i=j+1;
    }
    return collapsed;
  })();
  const _fsPageCountOuter=Math.max(1,Math.ceil(_fsAllPayouts.length/10));
  useEffect(()=>{
    if(!tournament||!tournament.payoutsPublished||_fsAllPayouts.length<=10)return;
    const t=setInterval(()=>_setFsPage(p=>(p+1)%_fsPageCountOuter),10000);
    return()=>clearInterval(t);
  },[tournament&&tournament.payoutsPublished,_fsPageCountOuter,_fsAllPayouts.length]);

  if(isFS) {
    const _fsCfg=EVENT_CONFIGS[tournament.eventType]||null;
    const _fsAccent=_fsCfg?_fsCfg.color:'#3dba6f';
    const _fsIsMe=_fsCfg&&_fsCfg.isMainEvent;
    const _allFsPayouts=_fsAllPayouts;
    const _fsPageCount=_fsPageCountOuter;
    const _fsPayouts=_fsAllPayouts.slice(_fsPage*10,(_fsPage+1)*10);
    const _totalE=totalEntries||0;
    const posColors=['#f0c040','#c8d0d8','#c87a3a'];
    return(
    <div ref={clockRef} className="clock-fs" onContextMenu={handleContextMenu}
      style={{background:`radial-gradient(ellipse at center, ${_fsCfg?_fsCfg.bgDeep:'#09180c'} 0%, #020806 72%)`}}>
      {/* Logos */}
      {_fsIsMe&&<img src={N8_LOGO} alt="Natural8" style={{position:'absolute',top:'2vh',right:'2.5vw',height:'6vh',objectFit:'contain',mixBlendMode:'screen',zIndex:10}}/>}
      {/* Event name */}
      <div className="fs-name" style={{color:_fsAccent}}>{_fsCfg?_fsCfg.group:tournament.name}</div>
      {_fsCfg&&_fsCfg.subtitle&&<div style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.3)',letterSpacing:'0.3em',textTransform:'uppercase',marginBottom:'0.3vh'}}>{_fsCfg.subtitle}</div>}
      <div className="fs-level" style={{color:isBreak?'#c8973a':_fsAccent}}>
        {isComplete?'Tournament Complete':isBreak?'Break':cur?`Level ${cur.level}`:'—'}
      </div>
      {isBreak&&cur&&cur.note&&<div className="fs-note">{cur.note}</div>}
      <div className="fs-clock" style={{color:fsTimerColor}}>{fmt.time(secs)}</div>
      {cur&&!isBreak&&!isComplete&&(
        <div className="fs-blinds">
          {[['SB',cur.sb],['BB',cur.bb],...(cur.ante>0?[['Ante',cur.ante]]:[])].map(([lbl,val])=>(
            <div key={lbl} className="fs-blind">
              <div className="fs-blind-lbl">{lbl}</div>
              <div className="fs-blind-val">{fmt.chips(val)}</div>
            </div>
          ))}
        </div>
      )}
      {nxt&&(
        <div className="fs-next">
          <span style={{color:'rgba(255,255,255,0.4)',fontSize:'1.2vw',letterSpacing:'.15em'}}>NEXT &nbsp;</span>
          <span>{nxt.isBreak?`Break${nxt.note?' — '+nxt.note:''} (${nxt.mins} min)`:`Level ${nxt.level} — ${fmt.chips(nxt.sb)}/${fmt.chips(nxt.bb)}${nxt.ante?` · Ante ${fmt.chips(nxt.ante)}`:''} · ${nxt.mins} min`}</span>
        </div>
      )}
      {/* Stats row */}
      <div className="fs-stats">
        <img src={SPC_LOGO} alt="SPC" style={{height:'10vh',objectFit:'contain'}}/>
        <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:'2.5vh',background:'rgba(0,0,0,0.35)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:10,padding:'2vh 1.8vw'}}>
        {(()=>{
          const _cumE=tournament.players.length+(tournament.inheritedEntries||0);
          const _cumB=bustedPlayers.length+(tournament.inheritedBusted||0);
          const _totalChips=tournament.chipsInPlay||(_cumE*(tournament.stack||0));
          // Next break calculation
          let _nextBreakMins=null;
          if(tournament.structure&&!isComplete){
            let mins=secs/60;
            for(let i=tournament.currentLevelIdx+1;i<tournament.structure.length;i++){
              const lv=tournament.structure[i];
              if(lv.isBreak){_nextBreakMins=Math.round(mins);break;}
              mins+=lv.mins;
            }
          }
          return(<>
            <div className="fs-stat"><div className="fs-stat-lbl">Players</div><div className="fs-stat-val" style={{color:_fsAccent}}>{activePlayers.length}{_cumE>0?`/${_cumE}`:''}</div></div>
            <div className="fs-stat"><div className="fs-stat-lbl">Tables</div><div className="fs-stat-val">{tablesInUse||'—'}</div></div>
            {avgStack>0&&<div className="fs-stat"><div className="fs-stat-lbl">Avg stack</div><div className="fs-stat-val" style={{color:'#9b7bce'}}>{fmt.chips(avgStack)}</div></div>}
            {tournament.bountyPool>0&&<div className="fs-stat"><div className="fs-stat-lbl">Bounty pool</div><div className="fs-stat-val" style={{color:'#c8973a'}}>{fmt.currency(tournament.bountyPool)}</div></div>}
            {(()=>{
              const _extraTotal=(tournament.extraBagCount||0)*1500;
              const _netPrize=tournament.prizePool-_extraTotal;
              return(<>
                {_netPrize>0&&<div className="fs-stat"><div className="fs-stat-lbl">{_extraTotal>0?'Net prize pool':'Prize pool'}</div><div className="fs-stat-val" style={{color:'#9b7bce'}}>{fmt.currency(_netPrize)}</div></div>}
                {_extraTotal>0&&<div className="fs-stat"><div className="fs-stat-lbl">Extra bags</div><div className="fs-stat-val" style={{color:'#c8973a'}}>{fmt.currency(_extraTotal)}</div></div>}
              </>);
            })()}
            {_totalChips>0&&<div className="fs-stat"><div className="fs-stat-lbl">Total chips</div><div className="fs-stat-val" style={{color:'#527a5c'}}>{fmt.chips(_totalChips)}</div></div>}
            {_nextBreakMins!==null&&<div className="fs-stat"><div className="fs-stat-lbl">Next break</div><div className="fs-stat-val" style={{color:'#c8973a',fontSize:'2.2vw'}}>{_nextBreakMins>=60?`${Math.floor(_nextBreakMins/60)}h ${_nextBreakMins%60}m`:`${_nextBreakMins}m`}</div></div>}
          </>);
        })()}
        </div>
      </div>
      {tournament.payoutsPublished&&_fsPayouts.length>0&&(
        <div style={{position:'absolute',right:'2.5vw',top:'50%',transform:'translateY(-50%)',display:'flex',flexDirection:'column',gap:'1.4vh',alignItems:'flex-end',zIndex:5}}>
          <div style={{fontSize:'1vw',color:'rgba(255,255,255,0.4)',letterSpacing:'0.25em',textTransform:'uppercase',marginBottom:'0.4vh',textAlign:'right'}}>
            Payouts{_fsPageCount>1?` · ${_fsPage+1}/${_fsPageCount}`:''}
          </div>
          {_fsPayouts.map((p,i)=>(
            <div key={i} style={{textAlign:'right',display:'flex',alignItems:'baseline',justifyContent:'flex-end',gap:'0.6vw'}}>
              <span style={{fontSize:'1.2vw',color:'rgba(255,255,255,0.5)',letterSpacing:'0.1em',textTransform:'uppercase'}}>{p.label}</span>
              <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:p.top===0?'3vw':p.top===1?'2.5vw':p.top===2?'2.2vw':'1.9vw',fontWeight:700,color:p.top>=0?posColors[p.top]:'#b2d4ba'}}>{fmt.currency(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {ctxMenu&&(
        <>
          <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={closeCtx} onContextMenu={e=>{e.preventDefault();closeCtx();}}/>
          <div className="ctx-menu" style={{left:Math.min(ctxMenu.x,window.innerWidth-210),top:Math.min(ctxMenu.y,window.innerHeight-130)}}>
            <div className="ctx-label">Quick actions</div>
            <div className="ctx-item" onClick={ctxToggleClock}>
              <span className="ctx-icon">{isRunning?'⏸':'▶'}</span>{isRunning?'Pause clock':'Start clock'}
            </div>
            <div className="ctx-sep"/>
            <div className="ctx-item" onClick={ctxRegister}>
              <span className="ctx-icon">＋</span>Register next player
            </div>
            {activePlayers.length>0&&(
              <div className="ctx-item danger" onClick={ctxBust}>
                <span className="ctx-icon">✕</span>Bust random player
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );}

  return(
    <div ref={clockRef} className="clock-outer" onContextMenu={handleContextMenu}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'rgba(0,0,0,0.3)',flexShrink:0,gap:12}}>
        <img src={SPC_LOGO} alt="SPC" style={{height:46,objectFit:'contain',flexShrink:0}}/>
        <div style={{textAlign:'center',flex:1}}>
          <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:17,fontWeight:700,color:'var(--accent,#3dba6f)',letterSpacing:2,lineHeight:1}}>{_evCfg?_evCfg.group:tournament.name}</div>
          {_evCfg&&_evCfg.subtitle&&<div style={{fontSize:10,color:'rgba(255,255,255,0.28)',letterSpacing:2,marginTop:1,textTransform:'uppercase'}}>{_evCfg.subtitle}</div>}
        </div>
        {_evCfg&&_evCfg.isMainEvent
          ?<img src={N8_LOGO} alt="Natural8" style={{height:28,objectFit:'contain',flexShrink:0,mixBlendMode:'screen'}}/>
          :<div style={{width:90,flexShrink:0}}/>
        }
      </div>
      <div className="clock-view">
        <div className={`level-badge ${isBreak?'is-break':''} ${isComplete?'is-complete':''}`}>
          {isComplete?'Tournament Complete':isBreak?'Break':cur?`Level ${cur.level}`:'—'}
        </div>
        {isBreak&&cur&&cur.note&&<div style={{fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#c8973a80',marginBottom:6,position:'relative'}}>{cur.note}</div>}
        <div className={`clock-num ${clockCls}`}>{fmt.time(secs)}</div>
        {cur&&!isBreak&&!isComplete&&(
          <div className="blinds-row">
            <div className="blind-box"><div className="blind-lbl">Small blind</div><div className="blind-val">{fmt.chips(cur.sb)}</div></div>
            <div className="blind-sep">/</div>
            <div className="blind-box"><div className="blind-lbl">Big blind</div><div className="blind-val">{fmt.chips(cur.bb)}</div></div>
            {cur.ante>0&&<><div className="blind-sep">·</div><div className="blind-box"><div className="blind-lbl">Ante</div><div className="blind-val">{fmt.chips(cur.ante)}</div></div></>}
          </div>
        )}
        {nxt&&(
          <div className="next-bar">
            Next: <strong>{nxt.isBreak?`Break${nxt.note?' — '+nxt.note:''} (${nxt.mins} min)`:`Level ${nxt.level} — ${fmt.chips(nxt.sb)}/${fmt.chips(nxt.bb)}${nxt.ante?' · Ante '+fmt.chips(nxt.ante):''} · ${nxt.mins} min`}</strong>
          </div>
        )}
        {!isComplete&&(
          <div className="clock-controls">
            <button className="cc-btn" onClick={onPrev}>⏮ Prev level</button>
            <button className="cc-btn" onClick={()=>onAdjust(-60)}>−1 min</button>
            <button className={`pp-btn ${!isRunning?'paused':''}`} onClick={onToggle}>{isRunning?'⏸ Pause':'▶ Start'}</button>
            <button className="cc-btn" onClick={()=>onAdjust(60)}>+1 min</button>
            <button className="cc-btn" onClick={onNext}>Next level ⏭</button>
            <button className="fs-btn" onClick={toggleFS} style={{marginLeft:8}}>⛶ Fullscreen</button>
          </div>
        )}
      </div>
      <div className="stats-bar">
        {(()=>{
          const cumE=tournament.players.length+(tournament.inheritedEntries||0);
          const cumB=bustedPlayers.length+(tournament.inheritedBusted||0);
          const hasPlayers=activePlayers.length>0||bustedPlayers.length>0||cumE>0||cumB>0;
          const _eff2=tournament.chipsInPlay||(cumE*(tournament.stack||0));const avgStack=activePlayers.length>0
            ?Math.round(_eff2/activePlayers.length)
            :(tournament.stack||0);
          return(<>
            <>
              <div className="stat"><div className="stat-lbl">Players remaining</div><div className="stat-val g">{hasPlayers?`${activePlayers.length}${cumE>0?'/'+cumE:''}`:'—'}</div></div>
              <div className="stat"><div className="stat-lbl">Tables active</div><div className="stat-val">{hasPlayers?tablesInUse:'—'}</div></div>
              <div className="stat"><div className="stat-lbl">Total entries</div><div className="stat-val">{cumE>0?cumE:'—'}</div></div>
              <div className="stat"><div className="stat-lbl">Busted out</div><div className="stat-val r">{cumB>0?cumB:hasPlayers?'0':'—'}</div></div>
            </>
            {tournament.bountyPool>0&&<div className="stat"><div className="stat-lbl">Bounty pool</div><div className="stat-val" style={{color:'#c8973a'}}>{fmt.currency(tournament.bountyPool)}</div></div>}
          {(()=>{const _et=(tournament.extraBagCount||0)*1500;const _np=tournament.prizePool-_et;return(<>
            {_np>0&&<div className="stat"><div className="stat-lbl">{_et>0?'Net prize pool':'Prize pool'}</div><div className="stat-val au">{fmt.currency(_np)}</div></div>}
            {_et>0&&<div className="stat"><div className="stat-lbl">Extra bags</div><div className="stat-val" style={{color:'#c8973a',fontSize:13}}>{fmt.currency(_et)}</div></div>}
          </>);})()}
            {(tournament.chipsInPlay>0||(cumE>0&&tournament.stack>0))&&<div className="stat"><div className="stat-lbl">Total chips</div><div className="stat-val" style={{color:'#527a5c',fontSize:13}}>{fmt.chips(tournament.chipsInPlay||(cumE*tournament.stack))}</div></div>}
            <div className="stat"><div className="stat-lbl">Level</div><div className="stat-val">{tournament.currentLevelIdx+1}/{tournament.structure.length}</div></div>
            <div className="stat"><div className="stat-lbl">Blind</div><div className="stat-val" style={{fontSize:14,paddingTop:4}}>{cur&&!cur.isBreak?`${fmt.chips(cur.sb)}/${fmt.chips(cur.bb)}`:'Break'}</div></div>
            {avgStack>0&&<div className="stat"><div className="stat-lbl">Avg stack</div><div className="stat-val" style={{color:'#9b7bce'}}>{fmt.chips(avgStack)}</div></div>}
          </>);
        })()}
      </div>
    {ctxMenu&&(
      <>
        <div style={{position:'fixed',inset:0,zIndex:9998}} onClick={closeCtx} onContextMenu={e=>{e.preventDefault();closeCtx();}}/>
        <div className="ctx-menu" style={{left:Math.min(ctxMenu.x,window.innerWidth-210),top:Math.min(ctxMenu.y,window.innerHeight-130)}}>
          <div className="ctx-label">Quick actions</div>
          <div className="ctx-item" onClick={ctxRegister}>
            <span className="ctx-icon">＋</span>Register next player
          </div>
          {activePlayers.length>0&&(
            <div className="ctx-item danger" onClick={ctxBust}>
              <span className="ctx-icon">✕</span>Bust random player
            </div>
          )}
        </div>
      </>
    )}
    </div>
  );
}
/* ==== PLAYERS ==== */
function RegistrationBoard({players, onRegister}) {
  const [open, setOpen] = React.useState(true);
  const activeNums = new Set(players.filter(p=>p.status==='active').map(p=>p.name));
  const bustedNums = new Set(players.filter(p=>p.status==='busted').map(p=>p.name));
  const total = 400;
  const activeCount = activeNums.size;
  const bustedCount = bustedNums.size;
  const available = total - activeCount - bustedCount;
  return(
    <div className="reg-board-wrap">
      <div className="reg-board-header" onClick={()=>setOpen(o=>!o)}>
        <span className="reg-board-title">Player board 001–400</span>
        <span className="reg-board-stats">
          <span style={{color:'#3dba6f'}}>{activeCount} active</span>
          {bustedCount>0&&<span style={{color:'#e05a5a',marginLeft:8}}>{bustedCount} busted</span>}
          <span style={{marginLeft:8}}>{available} available</span>
          <span style={{marginLeft:12,color:'#3a5a42'}}>{open?'▲':'▼'}</span>
        </span>
      </div>
      {open&&(
        <div className="reg-board-grid">
          {Array.from({length:total},(_,i)=>{
            const num=String(i+1).padStart(3,'0');
            const isActive=activeNums.has(num);
            const isBusted=bustedNums.has(num);
            return(
              <button
                key={num}
                className={`reg-num ${isActive?'is-active':isBusted?'is-busted':''}`}
                onClick={()=>!isActive&&!isBusted&&onRegister(num)}
                disabled={isActive||isBusted}
                title={isActive?`Player ${num} — active`:isBusted?`Player ${num} — busted`:`Register player ${num}`}
              >{num}</button>
            );
          })}
        </div>
      )}
    </div>
  );
}
function PlayersView({tournament,activePlayers,bustedPlayers,onAdd,onAddMany,onBust,onBustMany,onUndoBust,onRename,onRemove,modal,setModal}) {
  const [search,setSearch]=useState('');
  const [newName,setNewName]=useState('');
  const [bulkText,setBulkText]=useState('');
  const [bulkCount,setBulkCount]=useState('');
  const [rangeFrom,setRangeFrom]=useState('');
  const [rangeTo,setRangeTo]=useState('');
  const [bulkBustCount,setBulkBustCount]=useState('');
  const [editId,setEditId]=useState(null);
  const [editName,setEditName]=useState('');
  const [showBusted,setShowBusted]=useState(true);

  function exportToCSV(){
    const rows=[['Name','Status','Table','Seat','Registered']];
    const all=[...tournament.players].sort((a,b)=>(a.registeredAt||0)-(b.registeredAt||0));
    all.forEach(p=>{
      const time=p.registeredAt?new Date(p.registeredAt).toLocaleTimeString():'';
      rows.push([p.name,p.status,p.tableNum?'Table '+p.tableNum:'',p.seatNum?'Seat '+p.seatNum:'',time]);
    });
    const csv=rows.map(r=>r.map(v=>'"'+(String(v||'').replace(/"/g,'""'))+'"').join(',')).join('\n');
    const defaultName=(tournament.name||'players').replace(/\s+/g,'_')+'.csv';
    if(window.electronAPI&&window.electronAPI.showSaveDialog){
      window.electronAPI.showSaveDialog({
        defaultPath:defaultName,
        filters:[{name:'CSV Files',extensions:['csv']},{name:'All Files',extensions:['*']}]
      }).then(function(result){
        if(!result.canceled&&result.filePath){
          window.electronAPI.writeFile(result.filePath,csv);
        }
      });
    } else {
      const blob=new Blob([csv],{type:'text/csv'});
      const url=URL.createObjectURL(blob);
      const a=document.createElement('a');
      a.href=url;a.download=defaultName;
      a.click();URL.revokeObjectURL(url);
    }
  }

  function handleAdd(){const n=newName.trim();if(!n)return;onAdd(n);setNewName('');}
  function handleBulk(){const names=bulkText.split('\n').map(s=>s.trim()).filter(Boolean);if(names.length){onAddMany(names);setBulkText('');setModal(null);}}
  function handleBulkBust(){
    const count=parseInt(bulkBustCount)||0;
    if(count<1)return;
    // Bust the last `count` active players by registration number (highest first)
    const active=tournament.players
      .filter(p=>p.status==='active')
      .sort((a,b)=>parseInt(b.name||0)-parseInt(a.name||0));
    const toBust=active.slice(0,count).map(p=>p.id);
    if(toBust.length>0){onBustMany(toBust);setBulkBustCount('');}
  }
  function handleBulkRegister(){
    const count=parseInt(bulkCount)||0;
    if(count<1)return;
    const registered=new Set(tournament.players.map(p=>p.name));
    const toAdd=[];
    for(let i=1;i<=700&&toAdd.length<count;i++){
      const num=String(i).padStart(3,'0');
      if(!registered.has(num))toAdd.push(num);
    }
    if(toAdd.length>0){onAddMany(toAdd);setBulkCount('');}
  }
  function handleRangeRegister(){
    const from=parseInt(rangeFrom)||0;const to=parseInt(rangeTo)||0;
    if(from<1||to<from)return;
    const registered=new Set(tournament.players.map(p=>p.name));
    const toAdd=[];
    for(let i=from;i<=to&&i<=700;i++){
      const num=String(i).padStart(3,'0');
      if(!registered.has(num))toAdd.push(num);
    }
    if(toAdd.length>0){onAddMany(toAdd);setRangeFrom('');setRangeTo('');}
  }

  const sorted=[...tournament.players].sort((a,b)=>{
    if(a.status!==b.status)return a.status==='active'?-1:1;
    if(a.tableNum!==b.tableNum)return(a.tableNum||99)-(b.tableNum||99);
    return(a.seatNum||99)-(b.seatNum||99);
  });
  const filtered=sorted.filter(p=>{
    if(!showBusted&&p.status==='busted')return false;
    return p.name.toLowerCase().includes(search.toLowerCase());
  });
  const posLabel=pos=>{if(pos===1)return'1st';if(pos===2)return'2nd';if(pos===3)return'3rd';return pos+'th';};

  return(
    <div className="players-view">
      <div className="view-head">
        <div><div className="view-title">Players</div><div className="view-sub">{activePlayers.length} active · {bustedPlayers.length} busted · {tournament.players.length} total</div></div>
        <button className="btn-sec" style={{fontSize:12,padding:'5px 12px'}} onClick={exportToCSV} title="Download player list as CSV">↓ Export CSV</button>
        <div className="btn-row">
          <button className="btn-sec" onClick={()=>setShowBusted(b=>!b)}>{showBusted?'Hide':'Show'} busted</button>
          {bustedPlayers.length>0&&<button className="btn-sec" style={{borderColor:'#c87a3a',color:'#c87a3a'}} onClick={onUndoBust}>↩ Undo bust</button>}
          <button className="btn-sec" onClick={()=>setModal({type:'bulk'})}>Bulk add</button>
        </div>
      </div>
      <RegistrationBoard players={tournament.players} onRegister={name=>onAdd(name)}/>
      <div className="quick-add">
        <div style={{display:'flex',alignItems:'center',gap:7}}>
          <input
            className="qa-input"
            type="number" min="1" max="400"
            placeholder="e.g. 50"
            value={bulkCount}
            onChange={e=>setBulkCount(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleBulkRegister();}}
            style={{width:80,textAlign:'center'}}
          />
          <button className="btn-primary" onClick={handleBulkRegister} style={{whiteSpace:'nowrap'}}>
            Bulk register{bulkCount&&parseInt(bulkCount)>0?` ${parseInt(bulkCount)}`:''}
          </button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:5,marginLeft:10,paddingLeft:16,borderLeft:'1px solid #152018'}}>
          <input className="qa-input" type="number" min="1" max="400" placeholder="from" value={rangeFrom}
            onChange={e=>setRangeFrom(e.target.value)} style={{width:60,textAlign:'center'}}/>
          <span style={{color:'#3a5a42',fontSize:12}}>–</span>
          <input className="qa-input" type="number" min="1" max="400" placeholder="to" value={rangeTo}
            onChange={e=>setRangeTo(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleRangeRegister();}}
            style={{width:60,textAlign:'center'}}/>
          <button className="btn-primary" onClick={handleRangeRegister} style={{whiteSpace:'nowrap'}}>
            Range{rangeFrom&&rangeTo?` ${rangeFrom}–${rangeTo}`:''}
          </button>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:7,marginLeft:10,paddingLeft:16,borderLeft:'1px solid #152018'}}>
          <input
            className="qa-input"
            type="number" min="1" max="400"
            placeholder="e.g. 10"
            value={bulkBustCount}
            onChange={e=>setBulkBustCount(e.target.value)}
            onKeyDown={e=>{if(e.key==='Enter')handleBulkBust();}}
            style={{width:80,textAlign:'center'}}
          />
          <button
            className="btn-danger-sm"
            onClick={handleBulkBust}
            style={{whiteSpace:'nowrap',padding:'7px 14px',fontSize:13,fontFamily:"'Rajdhani',sans-serif",fontWeight:700}}
          >
            Bulk bust{bulkBustCount&&parseInt(bulkBustCount)>0?` ${parseInt(bulkBustCount)}`:''}
          </button>
        </div>
        <input className="qa-input" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{marginLeft:'auto',width:180}}/>
      </div>
      <div className="players-wrap">
        <table className="ptable">
          <thead><tr><th>#</th><th>Name</th><th>Table</th><th>Seat</th><th>Status</th><th>Finish</th><th></th></tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan="7" className="empty-state">No players yet — add one above or use Bulk add</td></tr>}
            {filtered.map((p,i)=>(
              <tr key={p.id} className={p.status==='busted'?'busted-row':''}>
                <td style={{color:'#7aaa82',fontSize:12,fontWeight:500}}>{i+1}</td>
                <td style={{fontWeight:500}}>
                  {editId===p.id
                    ?<input className="qa-input" style={{padding:'3px 8px',fontSize:12,width:140}} value={editName} onChange={e=>setEditName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){onRename(p.id,editName);setEditId(null);}}} autoFocus/>
                    :<span onDoubleClick={()=>{setEditId(p.id);setEditName(p.name);}} title="Double-click to rename">{p.name}{pf(p)}</span>
                  }
                </td>
                <td>{p.tableNum?`Table ${p.tableNum}`:'—'}</td>
                <td>{p.seatNum?`Seat ${p.seatNum}`:'—'}</td>
                <td><span className={`badge ${p.status}`}>{p.status==='active'?'● Active':'✕ Busted'}</span></td>
                <td style={{color:'#527a5c',fontSize:11}}>{p.bustPosition?posLabel(p.bustPosition):p.status==='active'?'—':'1st'}</td>
                <td style={{display:'flex',gap:6}}>
                  {p.status==='active'&&<button className="btn-danger-sm" onClick={()=>onBust(p.id)}>Bust out</button>}
                  {onRemove&&<button className="btn-danger-sm" style={{background:'transparent',borderColor:'#3a2020',color:'#8a4040',fontSize:11}} onClick={()=>{if(confirm(`Remove ${p.name} entirely from this tournament?`))onRemove(p.id);}}>Remove</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal&&modal.type==='bulk'&&(
        <div className="modal-bg" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-title">Bulk add players</div>
            <div className="modal-sub">One player name per line</div>
            <textarea className="form-input" rows={12} placeholder={"Alice Tan\nBob Lim\nCharlie Wong\n..."} value={bulkText} onChange={e=>setBulkText(e.target.value)} style={{resize:'vertical',flex:1}}/>
            <div className="modal-actions">
              <button className="btn-sec" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn-primary" onClick={handleBulk}>Add {bulkText.split('\n').filter(s=>s.trim()).length} players</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function TablesView({tournament,activePlayers,onBalance,onOpen,onCloseConfirm,onMove,onRemove,onLock,onRedraw,onUpdateChipCount,onExportSeating}) {
  const [selectedPlayer,setSelectedPlayer] = useState(null);
  const [closeMode,setCloseMode] = useState(null);
  const [breakMode,setBreakMode] = useState(null); // {closingTable, assignments:{id:{tableNum,seatNum}}}
  const [chipMode,setChipMode] = useState(false);
  const [openMode,setOpenMode] = useState(false);
  const [searchQ,setSearchQ] = useState('');
  const searchMatch=searchQ.trim().length>0?activePlayers.filter(p=>p.name.toLowerCase().includes(searchQ.toLowerCase())):[];
  const startTable = tournament.startTable||1;
  const maxTables = tournament.maxTables||15;
  const locks = tournament.seatLocks||{};
  const evCfg = EVENT_CONFIGS[tournament.eventType]||null;
  const isMultiDay = evCfg && (evCfg.group==='Main Event'||evCfg.group==='Mini Roller');

  const tables={};
  activePlayers.forEach(p=>{if(p.tableNum){if(!tables[p.tableNum])tables[p.tableNum]=[];tables[p.tableNum].push(p);}});
  const allTableNums = getTableNumbers(tournament);
  const unseated=activePlayers.filter(p=>!p.tableNum);

  // --- Close table logic ---
  function startCloseTable(){
    if(maxTables<=1){alert('Cannot close — only one table remaining.');return;}
    // Open table picker first — no assignments yet
    setCloseMode({choosingTable:true,closingTable:null,assignments:{},displaced:[]});
  }

  function selectTableToClose(tNum){
    const tNumN=Number(tNum);
    const displaced=(tables[tNumN]||[]);
    // Count available seats in remaining tables
    const otherPlayers=activePlayers.filter(p=>p.tableNum&&p.tableNum!==tNumN);
    const otherCapacity=(maxTables-1)*(tournament.seatsPerTable||9);
    const available=otherCapacity-otherPlayers.length;
    if(available<displaced.length){
      alert(`Cannot close Table ${tNumN} — only ${available} seat${available!==1?'s':''} available across other tables but ${displaced.length} player${displaced.length!==1?'s':''} need reseating.`);
      return;
    }
    const assignments={};
    displaced.forEach(p=>{assignments[p.id]={tableNum:'',seatNum:''};});
    setCloseMode({choosingTable:false,closingTable:tNumN,assignments,displaced});
  }

  function setAssignment(playerId,field,val){
    setCloseMode(cm=>{
      const cur=cm.assignments[playerId]||{tableNum:'',seatNum:''};
      const updated=field==='tableNum'
        ?{tableNum:Number(val)||'',seatNum:''}
        :{...cur,seatNum:Number(val)||''};
      return{...cm,assignments:{...cm.assignments,[playerId]:updated}};
    });
  }

  function confirmClose(){
    const {closingTable,assignments,displaced}=closeMode;
    if(!closingTable||!displaced){return;}
    for(const p of displaced){
      const a=assignments[p.id];
      if(!a||!a.tableNum||!a.seatNum){alert(`Please assign a table and seat for ${p.name}.`);return;}
    }
    const taken=new Set();
    for(const p of displaced){
      const a=assignments[p.id];
      const key=a.tableNum+'-'+a.seatNum;
      if(taken.has(key)){alert('Two players assigned to the same seat. Please fix.');return;}
      const occupant=activePlayers.find(ap=>ap.tableNum===a.tableNum&&ap.seatNum===a.seatNum&&!displaced.find(d=>d.id===ap.id));
      if(occupant){alert(`Seat ${a.seatNum} at Table ${a.tableNum} is occupied by ${occupant.name}.`);return;}
      taken.add(key);
    }
    const assList=displaced.map(p=>({playerId:p.id,tableNum:assignments[p.id].tableNum,seatNum:assignments[p.id].seatNum}));
    onCloseConfirm(assList,closingTable);
    setCloseMode(null);
  }

  // --- Seat move logic ---
  function handleSeatClick(p){
    if(closeMode)return;
    if(!selectedPlayer){setSelectedPlayer({id:p.id,name:p.name,tableNum:p.tableNum,seatNum:p.seatNum});}
    else if(selectedPlayer.id===p.id){setSelectedPlayer(null);}
    else{onMove(selectedPlayer.id,p.tableNum,p.seatNum);onMove(p.id,selectedPlayer.tableNum,selectedPlayer.seatNum);setSelectedPlayer(null);}
  }
  function handleEmptySeatClick(tNum,seat){
    if(!selectedPlayer)return;
    const lk=locks[tNum+'-'+seat];
    if(lk==='move'||lk==='all')return;
    onMove(selectedPlayer.id,tNum,seat);setSelectedPlayer(null);
  }
  function cycleLock(tNum,seat,e){e.stopPropagation();const key=tNum+'-'+seat;const cur=locks[key]||'none';const cycle=['none','move','reg','all'];const next=cycle[(cycle.indexOf(cur)+1)%cycle.length];onLock(tNum,seat,next);}
  function lockLabel(lk){if(lk==='move')return{text:'M',color:'#c8973a'};if(lk==='reg')return{text:'R',color:'#5a8ac8'};if(lk==='all')return{text:'L',color:'#c85a5a'};return null;}

  // Get available seats for close table assignment (excluding already assigned in this session)
  function getAvailableSeats(targetTable){
    if(!targetTable)return[];
    const {closingTable,assignments}=closeMode;
    const alreadyAssigned=Object.values(assignments).filter(a=>a.tableNum===targetTable&&a.seatNum).map(a=>a.seatNum);
    const occupied=(tables[targetTable]||[]).filter(p=>!closeMode.displaced.find(d=>d.id===p.id)).map(p=>p.seatNum);
    const taken=new Set([...alreadyAssigned,...occupied]);
    const seats=[];
    for(let s=1;s<=(tournament.seatsPerTable||9);s++){if(!taken.has(s))seats.push(s);}
    return seats;
  }

  function startBreakTable(){if(maxTables<=1){alert('Only one table.');return;}setBreakMode({stage:'pick'});}
  function selectTableToBreak(tNum){const tNumN=Number(tNum);const displaced=(tables[tNumN]||[]).map(p=>({id:p.id,name:p.name,tableNum:p.tableNum,seatNum:p.seatNum,country:p.country||null}));if(displaced.length===0){if(confirm('Table '+tNumN+' is empty. Close it?')){onCloseConfirm([],tNumN);setBreakMode(null);}return;}const spt=tournament.seatsPerTable||9;const lk=tournament.seatLocks||{};const result=computeBreakAssignments({closingTable:tNumN,players:activePlayers,tableNumbers:allTableNums,seatsPerTable:spt,seatLocks:lk});if(!result.ok){alert('Cannot break Table '+tNumN+' — only '+result.availableCount+' seats available, '+result.neededCount+' needed.');return;}setBreakMode({stage:'preview',closingTable:tNumN,assignments:result.assignments,displaced});}
  function confirmBreak(){if(!breakMode||breakMode.stage!=='preview')return;const assList=breakMode.assignments.map(a=>({playerId:a.playerId,tableNum:a.tableNum,seatNum:a.seatNum}));onCloseConfirm(assList,breakMode.closingTable);setBreakMode({...breakMode,stage:'done'});}

  return(
    <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
      <div className="view-head">
        <div>
          <div className="view-title">Tables</div>
          <div className="view-sub">{`Tables ${formatTableRanges(allTableNums)} · ${Object.keys(tables).length} in use · ${activePlayers.length} seated`}{unseated.length>0?` · ${unseated.length} unseated`:''}</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {selectedPlayer&&(
            <div style={{fontSize:12,color:'#c8973a',padding:'5px 12px',background:'#1a1004',border:'1px solid #2a1c06',borderRadius:5}}>
              Moving: <strong>{selectedPlayer.name}{pf(selectedPlayer)}</strong>
              <button style={{marginLeft:8,background:'none',border:'none',color:'#8a4040',cursor:'pointer',fontSize:12}} onClick={()=>setSelectedPlayer(null)}>✕</button>
            </div>
          )}
          <button className="btn-sec" onClick={onBalance}>Auto-balance</button>
          {isMultiDay&&!closeMode&&<button className="btn-sec" style={{borderColor:'#5a8ac8',color:'#5a8ac8'}} onClick={()=>{if(confirm('Randomly redraw ALL player seats? This cannot be undone.'))onRedraw();}}>⇄ Redraw seats</button>}
          {!closeMode&&<button className="btn-sec" style={{borderColor:chipMode?'#3dba6f':'#2a5a32',color:chipMode?'#3dba6f':'#527a5c',background:chipMode?'#0d1a0f':'transparent'}} onClick={()=>setChipMode(!chipMode)}>📊 Chip counts</button>}
          {!closeMode&&<button className="btn-sec" style={{borderColor:'#2a5a32',color:'#527a5c'}} onClick={onExportSeating}>↓ Export seating</button>}
          <div style={{position:'relative',marginLeft:'auto'}}>
            <input type="text" placeholder="🔍 Find player..." value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              style={{width:160,padding:'6px 10px',background:'#060e09',border:'1px solid #1a2e22',borderRadius:6,color:'#b2d4ba',fontSize:12,outline:'none'}}/>
            {searchMatch.length>0&&searchQ&&(
              <div style={{position:'absolute',top:'100%',right:0,marginTop:4,background:'#0b1610',border:'1px solid #1a2e22',borderRadius:8,padding:4,zIndex:20,minWidth:220,maxHeight:200,overflowY:'auto',boxShadow:'0 8px 24px rgba(0,0,0,.5)'}}>
                {searchMatch.map(p=>(
                  <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',borderRadius:4,cursor:'default',fontSize:12}}
                    onMouseEnter={e=>e.currentTarget.style.background='#112016'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{color:'#e4f0e8',fontWeight:500}}>{p.name}{pf(p)}</span>
                    <span style={{color:'#3dba6f',fontWeight:600,fontSize:13}}>T{p.tableNum} S{p.seatNum}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {!closeMode&&!breakMode&&<button className="btn-primary" style={{padding:'6px 14px',fontSize:12}} onClick={()=>{if(maxTables>=15){alert('Cannot open — 15 table cap reached.');return;}setOpenMode(true);}}>+ Open table</button>}
          {!closeMode&&!breakMode&&<button className="btn-sec" style={{padding:'6px 14px',fontSize:12,borderColor:'#c87a40',color:'#c87a40'}} onClick={startBreakTable}>✂ Break table</button>}
          {!closeMode&&!breakMode&&<button className="btn-sec" style={{padding:'6px 14px',fontSize:12,borderColor:'#3a2020',color:'#c87a40'}} onClick={startCloseTable}>− Close table</button>}
          {closeMode&&<button className="btn-sec" style={{borderColor:'#3a2020',color:'#8a4040'}} onClick={()=>setCloseMode(null)}>Cancel</button>}
          {closeMode&&!closeMode.choosingTable&&<button className="btn-primary" style={{padding:'6px 14px',fontSize:12}} onClick={confirmClose}>✓ Confirm close</button>}
          {breakMode&&breakMode.stage==='pick'&&<button className="btn-sec" style={{borderColor:'#3a2020',color:'#8a4040'}} onClick={()=>setBreakMode(null)}>Cancel</button>}
        </div>
      </div>

      {/* Close table panel */}
      {closeMode&&(
        <div style={{background:'#0f0c04',border:'1px solid #2a1c06',borderRadius:8,margin:'8px 16px',padding:16}}>
          {closeMode.choosingTable?(
            <>
              <div style={{fontSize:12,color:'#c8973a',fontWeight:700,marginBottom:12}}>Select table to close:</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
                {allTableNums.map(tNum=>(
                  <button key={tNum} style={{padding:'8px 16px',background:'#0b1610',border:'1px solid #1a2e22',borderRadius:6,color:'#b2d4ba',fontSize:13,cursor:'pointer'}}
                    onClick={()=>selectTableToClose(tNum)}>
                    Table {tNum} · {(tables[tNum]||[]).length} players
                  </button>
                ))}
              </div>
            </>
          ):(
            <>
              <div style={{fontSize:12,color:'#c8973a',fontWeight:700,marginBottom:12}}>
                Closing Table {closeMode.closingTable} — assign {closeMode.displaced.length} player{closeMode.displaced.length!==1?'s':''} to new seats
              </div>
              {closeMode.displaced.length===0&&<div style={{fontSize:12,color:'#3dba6f'}}>Table is empty — safe to close.</div>}
              {closeMode.displaced.map(p=>{
                const a=closeMode.assignments[p.id]||{tableNum:'',seatNum:''};
                const availSeats=a.tableNum?getAvailableSeats(a.tableNum):[];
                return(
                  <div key={p.id} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'8px 10px',background:'#0b1610',borderRadius:6}}>
                    <span style={{flex:1,fontSize:13,color:'#e8d8a0',fontWeight:500}}>{p.name}{pf(p)}</span>
                    <select style={{padding:'5px 8px',background:'#060e09',border:'1px solid #2a1c06',borderRadius:4,color:'#b2d4ba',fontSize:12,outline:'none'}}
                      value={a.tableNum||''} onChange={e=>setAssignment(p.id,'tableNum',e.target.value)}>
                      <option value=''>— Table —</option>
                      {allTableNums.filter(t=>t!==closeMode.closingTable).map(t=>(
                        <option key={t} value={t}>Table {t} ({(tables[t]||[]).length}/{tournament.seatsPerTable})</option>
                      ))}
                    </select>
                    <select style={{padding:'5px 8px',background:'#060e09',border:'1px solid #2a1c06',borderRadius:4,color:'#b2d4ba',fontSize:12,outline:'none'}}
                      value={a.seatNum||''} onChange={e=>setAssignment(p.id,'seatNum',e.target.value)} disabled={!a.tableNum}>
                      <option value=''>— Seat —</option>
                      {availSeats.map(s=><option key={s} value={s}>Seat {s}</option>)}
                    </select>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {breakMode&&breakMode.stage==='pick'&&(<div style={{background:'#0f0c04',border:'1px solid #c87a40',borderRadius:8,margin:'8px 16px',padding:16}}><div style={{fontSize:12,color:'#c87a40',fontWeight:700,marginBottom:12}}>✂ Select table to break:</div><div style={{display:'flex',flexWrap:'wrap',gap:8}}>{allTableNums.map(tNum=>(<button key={tNum} style={{padding:'8px 16px',background:'#0b1610',border:'1px solid #1a2e22',borderRadius:6,color:'#b2d4ba',fontSize:13,cursor:'pointer'}} onClick={()=>selectTableToBreak(tNum)}>Table {tNum} · {(tables[tNum]||[]).length} players</button>))}</div></div>)}

      {openMode&&(<div style={{background:'#0a140c',border:'1px solid #3dba6f',borderRadius:8,margin:'8px 16px',padding:16}}>
        <div style={{fontSize:12,color:'#3dba6f',fontWeight:700,marginBottom:12}}>+ Select a table number to open:</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
          {Array.from({length:15},(_,i)=>i+1).map(n=>{
            const open=allTableNums.includes(n);
            return <button key={n} disabled={open} onClick={()=>{onOpen(n);setOpenMode(false);}}
              style={{padding:'8px 16px',borderRadius:6,fontSize:13,fontWeight:700,cursor:open?'default':'pointer',
                background:open?'#0b1610':'#1a3a22',border:'1px solid '+(open?'#152018':'#3dba6f'),color:open?'#3a5a42':'#3dba6f'}}>
              {n}{open?' · open':''}
            </button>;
          })}
        </div>
        <div style={{marginTop:12}}><button className="btn-sec" style={{borderColor:'#3a2020',color:'#8a4040'}} onClick={()=>setOpenMode(false)}>Cancel</button></div>
      </div>)}

      {breakMode&&(breakMode.stage==='preview'||breakMode.stage==='done')&&(<div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999}}><div style={{background:'#0d1a12',border:'1px solid '+(breakMode.stage==='done'?'#3dba6f':'#c87a40'),borderRadius:12,padding:24,maxWidth:600,width:'90%',maxHeight:'80vh',overflowY:'auto'}}>
        <div style={{fontSize:18,fontWeight:700,color:breakMode.stage==='done'?'#3dba6f':'#c87a40',marginBottom:4}}>{breakMode.stage==='done'?'✓ Table '+breakMode.closingTable+' Broken':'✂ Break Table '+breakMode.closingTable+'?'}</div>
        <div style={{fontSize:12,color:'#7aaa82',marginBottom:16}}>{breakMode.assignments.length} player{breakMode.assignments.length!==1?'s':''} {breakMode.stage==='done'?'reassigned':'to be reassigned'}</div>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:13,marginBottom:16}}><thead><tr><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#7aaa82',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'left'}}>Player</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#c85a5a',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'center'}}>From</th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#7aaa82',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'center'}}></th><th style={{fontSize:9,letterSpacing:1,textTransform:'uppercase',color:'#3dba6f',padding:'6px 10px',borderBottom:'1px solid #152018',textAlign:'center'}}>To</th></tr></thead><tbody>
          {breakMode.assignments.map((a,i)=>(<tr key={i} style={{borderBottom:'1px solid #0a1412'}}><td style={{padding:'8px 10px',color:'#e8d8a0',fontWeight:500}}>{a.name}{a.country?' '+countryFlag(a.country):''}</td><td style={{padding:'8px 10px',textAlign:'center',color:'#c85a5a',fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:600}}>T{a.fromTable} S{a.fromSeat}</td><td style={{padding:'8px 10px',textAlign:'center',color:'#527a5c',fontSize:14}}>→</td><td style={{padding:'8px 10px',textAlign:'center',color:'#3dba6f',fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:700}}>T{a.tableNum} S{a.seatNum}</td></tr>))}
        </tbody></table>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>{breakMode.stage==='preview'&&<><button onClick={()=>setBreakMode(null)} style={{padding:'8px 18px',background:'none',border:'1px solid #3a2020',color:'#8a4040',borderRadius:6,cursor:'pointer',fontSize:13}}>Cancel</button><button onClick={confirmBreak} style={{padding:'8px 18px',background:'#1a3a22',border:'1px solid #3dba6f',color:'#3dba6f',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>✓ Confirm break</button></>}{breakMode.stage==='done'&&<button onClick={()=>setBreakMode(null)} style={{padding:'8px 18px',background:'#1a3a22',border:'1px solid #3dba6f',color:'#3dba6f',borderRadius:6,cursor:'pointer',fontSize:13,fontWeight:700}}>Done</button>}</div>
      </div></div>)}

      {/* Chip count entry panel */}
      {chipMode&&(
        <div style={{flex:1,overflow:'auto',padding:'8px 16px'}}>
          <div style={{background:'#0b1610',border:'1px solid #1a2e22',borderRadius:10,overflow:'hidden'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',borderBottom:'1px solid #1a2e22'}}>
              <div>
                <div style={{fontSize:13,color:'#b2d4ba',fontWeight:600}}>End-of-flight chip counts</div>
                <div style={{fontSize:11,color:'#3a5a42',marginTop:2}}>Enter each survivor's stack · {activePlayers.filter(p=>p.chipCount>0).length}/{activePlayers.length} entered · Total: {fmt.chips(activePlayers.reduce((s,p)=>s+(p.chipCount||0),0))}</div>
              </div>
            </div>
            <div style={{maxHeight:'calc(100vh - 260px)',overflowY:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                <thead>
                  <tr style={{borderBottom:'1px solid #1a2e22',position:'sticky',top:0,background:'#0b1610',zIndex:1}}>
                    <th style={{padding:'8px 12px',textAlign:'left',color:'#7aaa82',fontSize:10,letterSpacing:1.5,textTransform:'uppercase',fontWeight:600}}>Table</th>
                    <th style={{padding:'8px 8px',textAlign:'left',color:'#7aaa82',fontSize:10,letterSpacing:1.5,textTransform:'uppercase',fontWeight:600}}>Seat</th>
                    <th style={{padding:'8px 8px',textAlign:'left',color:'#7aaa82',fontSize:10,letterSpacing:1.5,textTransform:'uppercase',fontWeight:600,flex:1}}>Player</th>
                    <th style={{padding:'8px 16px',textAlign:'right',color:'#7aaa82',fontSize:10,letterSpacing:1.5,textTransform:'uppercase',fontWeight:600}}>Chip count</th>
                  </tr>
                </thead>
                <tbody>
                  {[...activePlayers].sort((a,b)=>(a.tableNum||0)-(b.tableNum||0)||(a.seatNum||0)-(b.seatNum||0)).map(p=>{
                    const hasCount=p.chipCount>0;
                    return(
                      <tr key={p.id} style={{borderBottom:'1px solid #0e1a12'}}>
                        <td style={{padding:'7px 12px',color:'#3a5a42'}}>{p.tableNum||'—'}</td>
                        <td style={{padding:'7px 8px',color:'#3a5a42'}}>{p.seatNum||'—'}</td>
                        <td style={{padding:'7px 8px',color:hasCount?'#7aaa82':'#b2d4ba',fontWeight:500}}>{p.name}{pf(p)}</td>
                        <td style={{padding:'4px 12px',textAlign:'right'}}>
                          <input type="number" defaultValue={p.chipCount||''} placeholder="—"
                            onBlur={e=>onUpdateChipCount(p.id,e.target.value)}
                            onKeyDown={e=>{if(e.key==='Enter'){e.target.blur();}}}
                            style={{width:100,padding:'5px 8px',background:hasCount?'#0d1a0f':'#060e09',border:'1px solid '+(hasCount?'#2a5a32':'#1a2e22'),borderRadius:4,color:hasCount?'#3dba6f':'#b2d4ba',fontSize:14,textAlign:'right',outline:'none',fontWeight:600}}/>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {!chipMode&&<div className="tables-view">
        <div className="tables-grid">
          {allTableNums.map(tNum=>{
            const seated=tables[tNum]||[];
            const isClosing=closeMode&&tNum===closeMode.closingTable;
            return(
              <div key={tNum} className="table-card" style={{opacity:isClosing?.5:1,borderColor:isClosing?'#c85a5a':''}}>
                <div className="table-num">Table {tNum}<span className="table-count">{seated.length}/{tournament.seatsPerTable}</span>{isClosing&&<span style={{fontSize:9,color:'#c85a5a',marginLeft:4}}>CLOSING</span>}</div>
                {Array.from({length:tournament.seatsPerTable},(_,i)=>i+1).map(seat=>{
                  const p=seated.find(x=>x.seatNum===seat);
                  const isSel=selectedPlayer&&p&&p.id===selectedPlayer.id;
                  const lk=locks[tNum+'-'+seat];
                  const lkInfo=lockLabel(lk);
                  const lockBtn=<button style={{background:'none',border:'1px solid '+(lkInfo?lkInfo.color:'#1a2e22'),borderRadius:3,color:lkInfo?lkInfo.color:'#1a2e22',cursor:'pointer',fontSize:9,padding:'1px 4px',lineHeight:'14px',fontWeight:700,minWidth:18}} title='Click to cycle lock' onClick={e=>cycleLock(tNum,seat,e)}>{lkInfo?lkInfo.text:'·'}</button>;
                  if(p){return(
                    <div key={seat} className="seat-row" style={{cursor:'pointer',background:isSel?'#1a1004':'',borderLeft:isSel?'2px solid #c8973a':'2px solid transparent'}} onClick={()=>handleSeatClick(p)}>
                      <span className="seat-n">{seat}</span>
                      <span className="seat-name" style={{color:isSel?'#c8973a':'',flex:1}}>{p.name}{pf(p)}</span>
                      {lockBtn}
                      {!selectedPlayer&&!closeMode&&onRemove&&<button style={{background:'none',border:'none',color:'#3a2020',cursor:'pointer',fontSize:11,padding:'0 3px'}} onClick={e=>{e.stopPropagation();if(confirm(`Remove ${p.name}?`))onRemove(p.id);}}>✕</button>}
                    </div>
                  );}else{
                    const isTarget=!!selectedPlayer&&!isSel;
                    const isBlocked=isTarget&&(lk==='move'||lk==='all');
                    return(
                      <div key={seat} className="seat-row" style={{cursor:isTarget&&!isBlocked?'pointer':'default',background:isTarget&&!isBlocked?'#0b1a0c':'',borderLeft:'2px solid transparent',opacity:isBlocked?.4:1}} onClick={()=>!isBlocked&&handleEmptySeatClick(tNum,seat)}>
                        <span className="seat-n">{seat}</span>
                        <span className="seat-empty" style={{color:isTarget&&!isBlocked?'#2a5a32':'',flex:1}}>{isBlocked?'locked':isTarget?'← move here':'empty'}</span>
                        {lockBtn}
                      </div>
                    );
                  }
                })}
              </div>
            );
          })}
        </div>
        {unseated.length>0&&(
          <div style={{marginTop:16,padding:'12px',background:'#0b1610',border:'1px solid #1a2e22',borderRadius:7}}>
            <div style={{fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'#c8973a',marginBottom:7}}>Unseated ({unseated.length})</div>
            {unseated.map(p=><div key={p.id} style={{fontSize:12,color:'#b2d4ba',padding:'2px 0'}}>{p.name}{pf(p)}</div>)}
          </div>
        )}
      </div>}
    </div>
  );
}
/* ==== ACTIVITY LOG ==== */
function LogView({activityLog}) {
  const [filter,setFilter]=useState('all');
  const types={all:'All',bust:'Busts',move:'Moves',clock:'Clock',table:'Tables',register:'Register'};
  const filtered=filter==='all'?activityLog:activityLog.filter(e=>e.type===filter);
  const sorted=[...filtered].reverse();
  return(
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div className="view-header">
        <div>
          <div className="view-title">Activity Log</div>
          <div className="view-sub">{activityLog.length} events recorded</div>
        </div>
        <div style={{display:'flex',gap:4}}>
          {Object.entries(types).map(([k,v])=>(
            <button key={k} style={{padding:'5px 10px',fontSize:11,fontWeight:filter===k?600:400,
              background:filter===k?'#112016':'transparent',border:'1px solid '+(filter===k?'#3dba6f':'#1a2e22'),
              borderRadius:5,color:filter===k?'#3dba6f':'#7aaa82',cursor:'pointer'}} onClick={()=>setFilter(k)}>{v}</button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'0 22px 18px'}}>
        {sorted.length===0&&<div style={{padding:40,textAlign:'center',color:'#3a5a42'}}>No events yet</div>}
        {sorted.map((e,i)=>(
          <div key={i} style={{display:'flex',gap:12,alignItems:'flex-start',padding:'8px 0',borderBottom:'1px solid #0e1a12',fontSize:13}}>
            <span style={{color:'#3a5a42',fontSize:11,whiteSpace:'nowrap',minWidth:70,flexShrink:0}}>{new Date(e.ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>
            <span style={{padding:'1px 8px',borderRadius:3,fontSize:10,fontWeight:600,letterSpacing:.5,textTransform:'uppercase',flexShrink:0,
              background:e.type==='bust'?'#1a0808':e.type==='move'?'#0a1018':e.type==='clock'?'#18180a':e.type==='table'?'#0a1810':'#101810',
              color:e.type==='bust'?'#c06060':e.type==='move'?'#6080c0':e.type==='clock'?'#c0a040':e.type==='table'?'#40a060':'#7aaa82',
              border:'1px solid '+(e.type==='bust'?'#2a1515':e.type==='move'?'#15152a':e.type==='clock'?'#2a2a15':e.type==='table'?'#152a18':'#1a2e22')
            }}>{e.type}</span>
            <span style={{color:'#b2d4ba'}}>{e.detail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
