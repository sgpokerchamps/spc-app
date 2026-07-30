/* ============================================================
   10_tournament.js
   The main App component (state management, all tournament
   action handlers, startTournament, view routing) plus
   DisplayPage (the spectator/projector window, driven by the
   DISPLAY_ID hash check and writeLive polling). Loads last —
   everything else this file references is already a global by
   the time this executes.
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;



/* ==== DISPLAY PAGE ==== */
function DisplayPage({id}) {
  const [d, setD] = useState(null);
  const [last, setLast] = useState(0);
  useEffect(()=>{
    function read() {
      try {
        const raw=localStorage.getItem(`spc_live_${id}`);
        if(raw){const parsed=JSON.parse(raw); if(parsed.ts!==last){setD(parsed);setLast(parsed.ts);}}
      }catch(e){}
    }
    read();
    const iv=setInterval(read,400);
    function onStorage(e){if(e.key===`spc_live_${id}`)read();}
    window.addEventListener('storage',onStorage);
    return()=>{clearInterval(iv);window.removeEventListener('storage',onStorage);};
  },[id]);

  if(!d) return(
    <div className="display-page" style={{background:`radial-gradient(ellipse at center, ${_dCfg?_dCfg.bgDeep:'#09180c'} 0%, #020806 72%)`}}>
      <img src={SPC_LOGO} alt="SPC" style={{width:120,opacity:.5,marginBottom:20}}/>
      <div className="d-waiting">Waiting for tournament data...</div>
      <div style={{marginTop:12,fontSize:12,color:'#2a4a35',letterSpacing:2}}>KEEP THIS WINDOW OPEN</div>
    </div>
  );

  const {name, cur, nxt, secs, status, activePlayers, tablesInUse, prizePool, bountyPool, avgStack, eventType, totalEntries, payouts, payoutsPublished} = d;
  const _dCfg = EVENT_CONFIGS[eventType]||null;
  const _dAccent = _dCfg ? _dCfg.color : '#3dba6f';
  const _dIsMe = _dCfg && _dCfg.isMainEvent;
  const clockCls = secs<=60?'danger':secs<=300?'warn':'';
  const isBreak = cur && cur.isBreak;
  const isComplete = status==='complete';

  return(
    <div className="display-page" style={{background:`radial-gradient(ellipse at center, ${_dCfg?_dCfg.bgDeep:'#09180c'} 0%, #020806 72%)`}}>
      {/* SPC logo — always top-left */}
      <img src={SPC_LOGO} alt="SPC" style={{position:'absolute',top:20,left:36,height:92,objectFit:'contain',zIndex:10}}/>
      {/* Natural8 logo — top-right, Main Event only */}
      {_dIsMe&&<img src={N8_LOGO} alt="Natural8" style={{position:'absolute',top:28,right:36,height:52,objectFit:'contain',mixBlendMode:'screen',zIndex:10}}/>}
      <div className="d-name" style={{color:_dAccent}}>{_dCfg?_dCfg.group:name}</div>
      {_dCfg&&_dCfg.subtitle&&<div style={{fontSize:13,letterSpacing:3,color:'rgba(255,255,255,0.3)',marginBottom:4,textTransform:'uppercase'}}>{_dCfg.subtitle}</div>}
      <div className={`d-level ${isBreak?'break':''}`} style={{color:isBreak?'#c8973a':_dAccent}}>
        {isComplete?'Tournament Complete':isBreak?'Break':cur?`Level ${cur.level}`:'—'}
      </div>
      {isBreak && cur && cur.note && <div className="d-note">{cur.note}</div>}
      <div className={`d-clock ${clockCls}`}>{fmt.time(secs)}</div>
      {cur && !isBreak && !isComplete && (
        <div className="d-blinds">
          <div className="d-blind"><div className="d-blind-lbl">Small blind</div><div className="d-blind-val">{fmt.chips(cur.sb)}</div></div>
          <div className="d-blind-sep">/</div>
          <div className="d-blind"><div className="d-blind-lbl">Big blind</div><div className="d-blind-val">{fmt.chips(cur.bb)}</div></div>
          {cur.ante>0&&<><div className="d-blind-sep">·</div><div className="d-blind"><div className="d-blind-lbl">Ante</div><div className="d-blind-val">{fmt.chips(cur.ante)}</div></div></>}
        </div>
      )}
      {nxt&&(
        <div className="d-next">
          Next: <strong>{nxt.isBreak?`Break${nxt.note?' — '+nxt.note:''} (${nxt.mins} min)`:`Level ${nxt.level} — ${fmt.chips(nxt.sb)}/${fmt.chips(nxt.bb)}${nxt.ante?' · Ante '+fmt.chips(nxt.ante):''} · ${nxt.mins} min`}</strong>
        </div>
      )}
      <div className="d-stats">
        <div className="d-stat"><div className="d-stat-lbl">Players</div><div className="d-stat-val">{activePlayers}</div></div>
        <div className="d-stat"><div className="d-stat-lbl">Tables</div><div className="d-stat-val">{tablesInUse}</div></div>
        {avgStack>0&&<div className="d-stat"><div className="d-stat-lbl">Avg stack</div><div className="d-stat-val" style={{color:'#9b7bce'}}>{fmt.chips(avgStack)}</div></div>}
        {bountyPool>0&&<div className="d-stat"><div className="d-stat-lbl">Bounty pool</div><div className="d-stat-val" style={{color:'#c8973a'}}>{fmt.currency(bountyPool)}</div></div>}
        <div className="d-stat"><div className="d-stat-lbl">Prize pool</div><div className="d-stat-val" style={{color:bountyPool>0?'#9b7bce':_dAccent}}>{fmt.currency(prizePool)}</div></div>
        {(tournament.chipsInPlay>0||(totalEntries>0&&tournament.stack>0))&&<div className="d-stat"><div className="d-stat-lbl">Total chips</div><div className="d-stat-val" style={{color:'#3a5a42'}}>{fmt.chips(tournament.chipsInPlay||(totalEntries*tournament.stack))}</div></div>}
      </div>
      {payoutsPublished&&payouts&&payouts.length>0&&(
        <div style={{display:'flex',gap:20,marginTop:14,flexWrap:'wrap',justifyContent:'center',maxWidth:'80vw'}}>
          {payouts.map((p,i)=>{
            const posColors=['#f0c040','#c8d0d8','#c87a3a'];
            return(
              <div key={i} style={{textAlign:'center',minWidth:70}}>
                <div style={{fontSize:11,color:'rgba(255,255,255,0.3)',letterSpacing:1,textTransform:'uppercase',marginBottom:3}}>{i===0?'1st':i===1?'2nd':i===2?'3rd':`${i+1}th`}</div>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:18,fontWeight:700,color:posColors[i]||'#b2d4ba'}}>{fmt.currency(p.amount)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ==== APP ==== */
function App() {
  if(DISPLAY_ID) return <DisplayPage id={DISPLAY_ID}/>;

  const [view,setView] = useState('home');
  const [selEvent,setSelEvent] = useState(null);
  const [tournament,setTournament] = useState(null);
  const [subview,setSubview] = useState('clock');
  // Global callback for RegisterView to persist regLog
  window._spcUpdateRegLog = function(log){ setTournament(t=>({...t,regLog:log})); };
  const [modal,setModal] = useState(null);
  const [savedIndex,setSavedIndex] = useState(getIndex);
  const timerRef = useRef(null);

  /* Timer */
  useEffect(()=>{
    if(tournament&&tournament.status==='running'){
      clearInterval(timerRef.current);
      timerRef.current=setInterval(()=>{
        setTournament(prev=>{
          if(!prev||prev.status!=='running')return prev;
          const t=prev.timeRemainingSeconds-1;
          return t<=0?advanceLevelFn(prev):{...prev,timeRemainingSeconds:t};
        });
      },1000);
    } else clearInterval(timerRef.current);
    return()=>clearInterval(timerRef.current);
  },[tournament&&tournament.status, tournament&&tournament.currentLevelIdx]);

  /* Live display sync — write on every tournament state change */
  useEffect(()=>{
    if(!tournament) return;
    const cur=tournament.structure[tournament.currentLevelIdx];
    const nxt=tournament.structure[tournament.currentLevelIdx+1];
    const active=tournament.players.filter(p=>p.status==='active');
    const tables=[...new Set(active.map(p=>p.tableNum).filter(Boolean))].length;
    writeLive(tournament,cur,nxt,active.length,tables);
    // Sync to floor UI via Electron
    if(typeof window.electronAPI!=='undefined'&&tournament){
      window.electronAPI.sendClockState({
        secs:tournament.timeRemainingSeconds,
        running:tournament.status==='running',
        isBreak:cur&&cur.isBreak,
        level:cur&&cur.level,
        sb:cur&&cur.sb,bb:cur&&cur.bb,ante:cur&&cur.ante,
        eventName:EVENT_CONFIGS[tournament.eventType]?EVENT_CONFIGS[tournament.eventType].group:'SPC',
      });
      const cumE=tournament.players.length+(tournament.inheritedEntries||0);
      const _activePlayers=tournament.players.filter(p=>p.status==='active');
      const _unseated=_activePlayers.filter(p=>!p.tableNum).map(p=>({id:p.id,name:p.name,country:p.country||null}));
      const _evCfg=EVENT_CONFIGS[tournament.eventType]||null;
      const _curLevel=cur&&!cur.isBreak?cur.level:null;
      const _reentryUntil=_evCfg?(_evCfg.reentryUntilLevel||0):0;
      const _maxR=_evCfg?_evCfg.maxReentries:0;
      const _reentryOpen=_reentryUntil>0&&(_curLevel===null||_curLevel<=_reentryUntil);
      const _reentryDesc=!_evCfg||_maxR===0?'No re-entries':
        _maxR===1?`1 re-entry · closes after Level ${_reentryUntil}`:
        `Unlimited re-entries · closes after Level ${_reentryUntil}`;
      // Build table map with full player data per seat
      const _tableMap={};
      const _st=tournament.startTable||1;
      const _mt=tournament.maxTables||15;
      for(let i=0;i<_mt;i++) _tableMap[_st+i]={num:_st+i,count:0,capacity:tournament.seatsPerTable||9,players:[]};
      _activePlayers.forEach(p=>{if(p.tableNum&&_tableMap[p.tableNum]){_tableMap[p.tableNum].count++;_tableMap[p.tableNum].players.push({id:p.id,name:p.name,seatNum:p.seatNum,country:p.country||null});}});
      window.electronAPI.sendTournamentState({
        active:_activePlayers.length,
        players:tournament.players.length,
        inheritedEntries:tournament.inheritedEntries||0,
        tables:[...new Set(_activePlayers.map(p=>p.tableNum).filter(Boolean))].length,
        prizePool:tournament.prizePool||0,
        unseated:_unseated,
        tableMap:Object.values(_tableMap).sort((a,b)=>a.num-b.num),
        reentryOpen:_reentryOpen,
        reentryDesc:_reentryDesc,
        reentryUntil:_reentryUntil,
        seatingMode:tournament.seatingMode||'auto',
        eventName:_evCfg?_evCfg.name:'',
        seatLocks:tournament.seatLocks||{},
        regLog:(tournament.regLog||[]).slice(0,50).map(r=>{const lv=tournament.players.find(p=>p.name===r.name&&p.status==='active');return{...r,tableNum:lv&&lv.tableNum?lv.tableNum:r.tableNum,seatNum:lv&&lv.seatNum?lv.seatNum:r.seatNum};}),
        members:(()=>{try{const c=JSON.parse(localStorage.getItem('spc_members_cache')||'{}');return Object.entries(c).map(([id,v])=>({member_id:id,name:typeof v==='string'?v:v.name,country:typeof v==='object'?v.country:null}));}catch(e){return[];}})(),
      });
    }
  },[tournament]);

  /* Floor action handler (from phones via Electron) */
  useEffect(()=>{
    function handleFloorAction(e){
      const action=e.detail;
      if(!action||!tournament)return;
      if(action.type==='register'||action.type==='register-next'){
        // register by name if given, otherwise register next available number
        if(action.name){
          const existing=tournament.players.find(p=>p.name===action.name&&p.status==='active');
          const isDup=!!existing;
          if(!existing){addPlayer(action.name, false, action.country||null);SoundEngine.register();}
          // Add to regLog so counter sees it
          setTournament(t=>{const entry={name:action.name,country:action.country||null,isDup,isReentry:!!t.players.find(p=>p.name===action.name&&p.status==='busted'),ts:Date.now(),tableNum:null,seatNum:null};return{...t,regLog:[entry,...(t.regLog||[])].slice(0,100)};});
        } else {
          // find next unused number
          const used=new Set(tournament.players.map(p=>p.name));
          let next=1;
          while(used.has(String(next).padStart(3,'0')))next++;
          addPlayer(String(next).padStart(3,'0'));SoundEngine.register();
        }
      } else if(action.type==='undo-register'){
        // remove the most recently registered active player
        setTournament(t=>{
          const active=[...t.players].filter(p=>p.status==='active').sort((a,b)=>b.registeredAt-a.registeredAt);
          if(active.length===0)return t;
          const remove=active[0].id;
          return {...t, players:t.players.filter(p=>p.id!==remove)};
        });
      } else if(action.type==='bust'||action.type==='bust-random'){
        if(action.name){
          const p=tournament.players.find(pl=>pl.name===action.name&&pl.status==='active');
          if(p){bustPlayer(p.id);SoundEngine.bust();}
        } else {
          // bust a random active player
          const active=tournament.players.filter(p=>p.status==='active');
          if(active.length>0){
            const p=active[Math.floor(Math.random()*active.length)];
            bustPlayer(p.id);SoundEngine.bust();
          }
        }
      } else if(action.type==='undo-bust'){
        undoBust();
      } else if(action.type==='clock-toggle'){
        toggleClock();
      } else if(action.type==='clock-action'){
        if(action.action==='prev')prevLevel();
        else if(action.action==='next')nextLevel();
        else if(action.action==='minus1')adjustTime(-60);
        else if(action.action==='plus1')adjustTime(60);
      } else if(action.type==='assign-seat'){
        if(action.playerId) assignSeat(action.playerId, action.tableNum, action.seatNum);
      } else if(action.type==='bust-player'){
        if(action.playerId){ bustPlayer(action.playerId); SoundEngine.bust(); }
      } else if(action.type==='move-player'){
        if(action.playerId&&action.tableNum&&action.seatNum){
          movePlayerSeat(action.playerId, action.tableNum, action.seatNum);
        }
      } else if(action.type==='open-table'){
        openTable();
      } else if(action.type==='set-seating-mode'){
        if(action.mode) setSeatingMode(action.mode);
      } else if(action.type==='close-table-confirm'){
        if(action.assignments&&action.closingTable){
          closeTableConfirm(action.assignments, action.closingTable);
        }
      } else if(action.type==='break-table'){
        if(action.tableNum){
          const tNumN=Number(action.tableNum);const spt=tournament.seatsPerTable||9;const active=tournament.players.filter(p=>p.status==='active');const displaced=active.filter(p=>p.tableNum===tNumN);if(displaced.length===0){closeTableConfirm([],tNumN);return;}const lk=tournament.seatLocks||{};const st=tournament.startTable||1;const mt=tournament.maxTables||15;const tableNumbers=Array.from({length:mt},(_,i)=>st+i);const result=computeBreakAssignments({closingTable:tNumN,players:active,tableNumbers:tableNumbers,seatsPerTable:spt,seatLocks:lk});if(!result.ok)return;closeTableConfirm(result.assignments,tNumN);
        }
      } else if(action.type==='set-seat-lock'){
        if(action.tableNum&&action.seatNum) setSeatLock(action.tableNum,action.seatNum,action.lockType||'none');
      }
    }
    window.addEventListener('spc-floor-action',handleFloorAction);
    return()=>window.removeEventListener('spc-floor-action',handleFloorAction);
  },[tournament,addPlayer,bustPlayer,toggleClock,prevLevel,nextLevel,adjustTime,assignSeat,movePlayerSeat,openTable,setSeatLock]);

  /* Floor URL overlay */
  const [serverInfo,setServerInfo]=useState(null);
  const [showFloorModal,setShowFloorModal]=useState(false);
  useEffect(()=>{
    // Listen for future events
    function onServer(e){setServerInfo(e.detail);}
    window.addEventListener('spc-server-ready',onServer);
    // Also poll immediately — server may have started before React mounted
    if(typeof window.electronAPI!=='undefined'){
      window.electronAPI.getServerInfo().then(info=>{
        if(info&&info.ip) setServerInfo(info);
      });
      // Poll every 2s for up to 30s in case server is slow to start
      let attempts=0;
      const poll=setInterval(()=>{
        attempts++;
        window.electronAPI.getServerInfo().then(info=>{
          if(info&&info.ip){ setServerInfo(info); clearInterval(poll); }
          if(attempts>=15) clearInterval(poll);
        });
      },2000);
      return()=>{ window.removeEventListener('spc-server-ready',onServer); clearInterval(poll); };
    }
    return()=>window.removeEventListener('spc-server-ready',onServer);
  },[]);

  /* Auto-save every 30s */
  useEffect(()=>{
    if(!tournament) return;
    const iv=setInterval(()=>{saveT(tournament);setSavedIndex(getIndex());},30000);
    return()=>clearInterval(iv);
  },[tournament]);

  function startTournament(config) {
    const structure=[...config.structure];
    const guarantee = config.guarantee||0;
    const inheritedEntries=config.inheritedEntries||0;
    const inheritedBusted=config.inheritedBusted||0;
    const inheritedPrizePool=config.inheritedPrizePool||0;
    // Pre-seat survivors from prior flight
    const _inheritedPlayers=config.inheritedPlayers||[];
    const _maxT=config.maxTables||15;
    const _spt=config.seatsPerTable||9;
    const isDay2=config.stack===0;

    // Detect duplicate players in inherited list (multi-flight qualifiers)
    let _deduped=_inheritedPlayers;
    let _extraBagWinners=[];
    let _totalExtraBags=0;
    let _actualChips=0;

    // Always deduplicate inherited players: keep best stack per name
    if(_inheritedPlayers.length>0){
      const bestByName={};
      _inheritedPlayers.forEach(p=>{
        if(!bestByName[p.name]||(p.chipCount||0)>(bestByName[p.name].chipCount||0)){
          bestByName[p.name]=p;
        }
      });
      _deduped=Object.values(bestByName);
    }

    // Day 2: calculate extra bags and actual chips
    if(isDay2&&_inheritedPlayers.length>0){
      const counts={};
      _inheritedPlayers.forEach(p=>{counts[p.name]=(counts[p.name]||0)+1;});
      const _ipCountries={};_inheritedPlayers.forEach(p=>{if(p.country)_ipCountries[p.name]=p.country;});
      Object.keys(counts).forEach(name=>{
        if(counts[name]>1){
          const bags=counts[name]-1;
          _extraBagWinners.push({name,bags,totalQualifications:counts[name],country:_ipCountries[name]||null});
          _totalExtraBags+=bags;
        }
      });
      _extraBagWinners.sort((a,b)=>b.bags-a.bags||a.name.localeCompare(b.name));
      _actualChips=_deduped.reduce((s,p)=>s+(p.chipCount||0),0);
    }

    let _seatedPlayers=[];
    let _baggedPlayers=[];
    if(isDay2){
      // Day 2: seat deduplicated inherited players
      _deduped.forEach((p,idx)=>{
        const tNum=(idx%_maxT)+1;
        const sNum=Math.floor(idx/_maxT)+1;
        const bestHistorical=Math.max(p.chipCount||0,p.inheritedChipCount||0);
        _seatedPlayers.push({...p,id:uid(),status:'active',bustPosition:null,inherited:true,
          chipCount:p.chipCount||0,inheritedChipCount:bestHistorical,
          tableNum:sNum<=_spt?tNum:null,seatNum:sNum<=_spt?sNum:null});
      });
    }else{
      // Day 1 flights: store ALL inherited entries (no dedup) to preserve flight counts for Day 2 extra bags
      _baggedPlayers=_inheritedPlayers.map(p=>({
        name:p.name,
        chipCount:Math.max(p.chipCount||0,p.inheritedChipCount||0),
        inheritedChipCount:Math.max(p.chipCount||0,p.inheritedChipCount||0),
      }));
    }
    // Pre-seeded survivors are now in players[] — remove them from
    // inheritedEntries and inheritedBusted to avoid double-counting
    const adjustedInheritedEntries = isDay2 ? Math.max(0, inheritedEntries - _deduped.length) : inheritedEntries;
    const adjustedInheritedBusted  = inheritedBusted; // busted count stays — survivors are not busted
    const bountyAmount=config.bountyAmount||0;
    const netPerEntry=(config.prizeComponent||0)*(1-(config.adminFeePercent||0)/100); // keep full decimal e.g. 508.80
    const prizePerEntry=netPerEntry-bountyAmount;
    const calcInitPrize=inheritedPrizePool>0
      ? inheritedPrizePool
      : Math.round((inheritedEntries+_inheritedPlayers.length)*prizePerEntry*100)/100;
    const t={id:uid(),name:config.name,spcSeries:config.spcSeries||null,eventType:config.eventType,buyin:config.buyin,
      prizeComponent:config.prizeComponent,adminFeePercent:config.adminFeePercent,
      itmPercent:config.itmPercent||15,guarantee,
      inheritedEntries:adjustedInheritedEntries,inheritedBusted:adjustedInheritedBusted,inheritedPrizePool,
      bountyAmount,prizePerEntry,bountyPool:Math.max(Math.round(inheritedEntries*bountyAmount),0),
      stack:config.stack,maxTables:config.maxTables,seatsPerTable:config.seatsPerTable,startTable:config.startTable||1,
      players:_seatedPlayers,structure,currentLevelIdx:0,timeRemainingSeconds:structure[0].mins*60,
      status:'paused',prizePool:Math.max(calcInitPrize,guarantee),payoutTable:null,seatingMode:'auto',regLog:[],seatLocks:{},
      baggedPlayers:_baggedPlayers,
      extraBagWinners:_extraBagWinners,extraBagCount:_totalExtraBags>0?_totalExtraBags:(config.extraBagCount||0),
      chipsInPlay:_actualChips>0?_actualChips
        :(config.stack===0&&inheritedEntries>0&&config.inheritedStack>0
        ? inheritedEntries*(config.inheritedStack)
        : 0)};
    setTournament({...t, payoutsPublished:false}); setSubview('register'); setView('tournament');
  }

  function resetTournament() {
    if (!tournament) return;
    if (!confirm('Reset this event? All players, busts and table assignments will be cleared. Clock returns to Level 1. This cannot be undone.')) return;
    setTournament(t => ({
      ...t,
      players: [],
      currentLevelIdx: 0,
      timeRemainingSeconds: t.structure[0].mins * 60,
      status: 'paused',
      prizePool: t.guarantee || 0,
      bountyPool: 0,
      payoutTable: null,
    }));
  }
  function exportCurrentSave() { if(tournament) exportTournament(tournament, false); }
  function exportCurrentTemplate() { if(tournament) exportTournament(tournament, true); }

  function handleImportFile(file) {
    importFromFile(file, data => {
      if (data._spcExport === 'tournament') {
        // Full save: load directly
        const t = {...data};
        delete t._spcExport; delete t._version;
        // Give it a fresh id to avoid collision
        t.id = uid();
        saveT(t); setSavedIndex(getIndex());
        alert(`Imported: "${t.name}"
Saved to your tournament list.`);
      } else if (data._spcExport === 'template') {
        // Template: create new tournament from config
        const cfg = {...data};
        delete cfg._spcExport; delete cfg._version;
        alert(`Template imported: "${cfg.name}"
Starting setup — you can adjust settings before launching.`);
        setSelEvent(cfg.eventType||'miniRoller');
        // Pre-fill setup by storing template config for SetupScreen to read
        window._importedTemplate = cfg;
        setView('setup');
      } else {
        alert('Unrecognised file format.');
      }
    }, err => alert('Import failed: ' + err));
  }

  function resumeTournament(id) {
    const t=loadT(id);
    if(t){setTournament({...t, payoutsPublished:t.payoutsPublished||false});setSubview('clock');setView('tournament');}
  }

  function deleteTournament(id) {
    deleteT(id); setSavedIndex(getIndex());
    if(tournament&&tournament.id===id){setTournament(null);setView('home');}
  }

  function saveTournamentNow() {
    if(!tournament) return;
    saveT(tournament); setSavedIndex(getIndex()); alert('Saved!');
  }

  function toggleClock(){setTournament(t=>{
    const newStatus=t.status==='running'?'paused':'running';
    return{...t,status:newStatus,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'clock',detail:newStatus==='running'?'Clock started':'Clock paused'}]};
  });}
  function publishPayouts(){setTournament(t=>({...t,payoutsPublished:true}));}
  function unpublishPayouts(){setTournament(t=>({...t,payoutsPublished:false}));}
  function prevLevel(){setTournament(t=>{const i=Math.max(0,t.currentLevelIdx-1);return{...t,currentLevelIdx:i,timeRemainingSeconds:t.structure[i].mins*60};});}
  function nextLevel(){setTournament(advanceLevelFn);}
  function adjustTime(s){setTournament(t=>({...t,timeRemainingSeconds:Math.max(0,t.timeRemainingSeconds+s)}));}

  function addPlayer(name, forceAuto=false, country=null){
    setTournament(t=>{
      const mode=t.seatingMode||'auto';
      let players=[...t.players];
      const seat=(mode==='auto'||forceAuto)?findSeat(players,t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{}):{tableNum:null,seatNum:null};
      const p={id:uid(),name,status:'active',bustPosition:null,...seat,registeredAt:Date.now()};
      if(country) p.country=country;
      players=[...players,p];
      const totalE=(players.length+(t.inheritedEntries||0));
      let prizePool;
      if(t.inheritedPrizePool>0&&t.prizePerEntry===0){
        prizePool=t.inheritedPrizePool;
      } else {
        const _ppeCalc=t.prizePerEntry!=null&&t.prizePerEntry>0?t.prizePerEntry:(t.prizeComponent||0)*(1-(t.adminFeePercent||0)/100);
        const calcPrize=Math.round(totalE*_ppeCalc*100)/100;
        prizePool=Math.max(calcPrize,t.guarantee||0);
      }
      const bountyPool=t.bountyAmount>0?Math.round(totalE*t.bountyAmount):0;
      return{...t,players,prizePool,bountyPool,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'register',detail:`${name} registered${seat.tableNum?` → T${seat.tableNum} S${seat.seatNum}`:' (unseated)'}`}]};
    });
  }
  function addPlayers(names){
    setTournament(t=>{
      let players=[...t.players];
      names.forEach(name=>{const seat=findSeat(players,t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{});players.push({id:uid(),name,status:'active',bustPosition:null,...seat});});
      const totalE=(players.length+(t.inheritedEntries||0));
      let prizePool;
      if(t.inheritedPrizePool>0&&t.prizePerEntry===0){
        // Day 2: prize pool is fixed from carry-forward, doesn't grow with new entries
        prizePool=t.inheritedPrizePool;
      } else {
        const _ppeCalc=t.prizePerEntry!=null&&t.prizePerEntry>0?t.prizePerEntry:(t.prizeComponent||0)*(1-(t.adminFeePercent||0)/100);
        const calcPrize=Math.round(totalE*_ppeCalc*100)/100; // round to cents
        prizePool=Math.max(calcPrize,t.guarantee||0);
      }
      const bountyPool=t.bountyAmount>0?Math.round(totalE*t.bountyAmount):0;
      return{...t,players,prizePool,bountyPool};
    });
  }
  function bustPlayer(id){
    const player=tournament.players.find(p=>p.id===id);
    setTournament(t=>{
      const active=t.players.filter(p=>p.status==='active');
      const position=active.length;
      return{...t,players:t.players.map(p=>p.id===id?{...p,status:'busted',bustPosition:position,prevTableNum:p.tableNum,prevSeatNum:p.seatNum,tableNum:null,seatNum:null,bustedAt:Date.now()}:p),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'bust',detail:`${player?player.name:'?'} busted ${fmt.ordinal(position)} (T${player?player.tableNum:''} S${player?player.seatNum:''})`}]};
    });
  }
  function updatePlayerName(id,name){setTournament(t=>({...t,players:t.players.map(p=>p.id===id?{...p,name}:p)}));}
  function bustManyPlayers(ids){
    setTournament(t=>{
      let players=[...t.players];
      ids.forEach(id=>{
        const active=players.filter(p=>p.status==='active');
        const position=active.length;
        players=players.map(p=>p.id===id?{...p,status:'busted',bustPosition:position,prevTableNum:p.tableNum,prevSeatNum:p.seatNum,tableNum:null,seatNum:null,bustedAt:Date.now()}:p);
      });
      return{...t,players};
    });
  }
  function undoBust(){
    setTournament(t=>{
      const busted=[...t.players].filter(p=>p.status==='busted').sort((a,b)=>(b.bustedAt||0)-(a.bustedAt||0));
      if(busted.length===0){alert('No busted players to undo.');return t;}
      const p=busted[0];
      let tableNum=p.prevTableNum||null,seatNum=p.prevSeatNum||null;
      if(tableNum&&seatNum){const taken=t.players.find(x=>x.status==='active'&&x.tableNum===tableNum&&x.seatNum===seatNum);if(taken){tableNum=null;seatNum=null;}}
      if(!tableNum||!seatNum){const seat=findSeat(t.players.filter(x=>x.id!==p.id),t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{});tableNum=seat.tableNum;seatNum=seat.seatNum;}
      return{...t,players:t.players.map(x=>x.id===p.id?{...x,status:'active',bustPosition:undefined,bustedAt:undefined,tableNum,seatNum,prevTableNum:undefined,prevSeatNum:undefined}:x),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'undo-bust',detail:`${p.name} undo bust → T${tableNum||'?'} S${seatNum||'?'}`}]};
    });
  }
  function removePlayer(id){
    setTournament(t=>({...t,players:t.players.filter(p=>p.id!==id)}));
  }
  function assignSeat(id, tableNum, seatNum){
    setTournament(t=>{
      let seat;
      if(tableNum&&seatNum){
        seat={tableNum:Number(tableNum),seatNum:Number(seatNum)};
      }else{
        seat=findSeat(t.players,t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{});
      }
      const p=t.players.find(x=>x.id===id);
      return{...t,players:t.players.map(p=>p.id===id?{...p,...seat}:p),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'move',detail:`${p?p.name:'?'} assigned → T${seat.tableNum||'?'} S${seat.seatNum||'?'}`}]};
    });
  }
  function movePlayerSeat(id,tableNum,seatNum){
    setTournament(t=>{
      const lk=(t.seatLocks||{})[tableNum+'-'+seatNum];
      if(lk==='move'||lk==='all') return t;
      const p=t.players.find(x=>x.id===id);
      const from=p?`T${p.tableNum||'?'} S${p.seatNum||'?'}`:'?';
      return{...t,players:t.players.map(p=>p.id===id?{...p,tableNum,seatNum}:p),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'move',detail:`${p?p.name:'?'} moved ${from} → T${tableNum} S${seatNum}`}]};
    });
  }
  function setSeatingMode(mode){
    setTournament(t=>({...t,seatingMode:mode}));
  }

  function logActivity(type,detail){
    setTournament(t=>{
      const log=[...(t.activityLog||[]),{ts:Date.now(),type,detail}];
      if(log.length>500) log.splice(0,log.length-500);
      return{...t,activityLog:log};
    });
  }
  function updateCurrentBlinds(sb, bb, ante) {
    setTournament(t=>{
      const structure=t.structure.map((lv,i)=>
        i===t.currentLevelIdx ? {...lv, sb:Number(sb)||lv.sb, bb:Number(bb)||lv.bb, ante:Number(ante)||0} : lv
      );
      return{...t,structure};
    });
  }
  function updateBlindLevel(idx, field, val) {
    setTournament(t=>{
      const structure=t.structure.map((lv,i)=>
        i===idx ? {...lv, [field]:Number(val)||0} : lv
      );
      return{...t,structure};
    });
  }
  function setChipsInPlay(val) {
    setTournament(t=>({...t,chipsInPlay:Number(val)||0}));
  }
  function updateChipCount(playerId,chipCount){
    setTournament(t=>({...t,players:t.players.map(p=>p.id===playerId?{...p,chipCount:Number(chipCount)||0}:p)}));
  }
  function exportSeating(){
    const sorted=[...activePlayers].sort((a,b)=>(a.tableNum||0)-(b.tableNum||0)||(a.seatNum||0)-(b.seatNum||0));
    const evName=tournament.name||'Tournament';
    const rows=[['Table','Seat','Player','Chip Count']];
    sorted.forEach(p=>rows.push([
      p.tableNum||'',
      p.seatNum||'',
      p.name||'',
      p.chipCount||''
    ]));
    const csv='\uFEFF'+rows.map(r=>r.map(v=>{
      const s=String(v==null?'':v);
      return s.includes(',')||s.includes('"')?'"'+s.replace(/"/g,'""')+'"':s;
    }).join(',')).join('\n');
    const defaultName=evName.replace(/[^a-zA-Z0-9]/g,'_')+'_Seating.csv';
    if(window.electronAPI&&window.electronAPI.showSaveDialog){
      window.electronAPI.showSaveDialog({defaultPath:defaultName,filters:[{name:'CSV',extensions:['csv']}]}).then(function(result){
        if(!result.canceled&&result.filePath) window.electronAPI.writeFile(result.filePath,csv);
      });
    }else{
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=defaultName;a.click();
    }
  }
  function setSeatLock(tableNum,seatNum,lockType){
    setTournament(t=>{
      const key=tableNum+'-'+seatNum;
      const locks={...(t.seatLocks||{})};
      if(!lockType||lockType==='none') delete locks[key];
      else locks[key]=lockType;
      return{...t,seatLocks:locks};
    });
  }
  function importPlayersFromFile(playerList) {
    setTournament(t => {
      let players = [...t.players];
      playerList.forEach(({name, tableNum}) => {
        let tNum = tableNum || null, seatNum = null;
        if (tNum) {
          for (let s = 1; s <= t.seatsPerTable; s++) {
            if (!players.find(p => p.status==='active' && p.tableNum===tNum && p.seatNum===s)) { seatNum=s; break; }
          }
          if (!seatNum) { const seat=findSeat(players,t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{}); tNum=seat.tableNum; seatNum=seat.seatNum; }
        } else {
          const seat=findSeat(players,t.maxTables,t.seatsPerTable,t.startTable||1,t.seatLocks||{}); tNum=seat.tableNum; seatNum=seat.seatNum;
        }
        players.push({id:uid(),name,status:'active',bustPosition:null,tableNum:tNum,seatNum});
      });
      const totalE=(players.length+(t.inheritedEntries||0));
      let prizePool;
      if(t.inheritedPrizePool>0&&t.prizePerEntry===0){
        // Day 2: prize pool is fixed from carry-forward, doesn't grow with new entries
        prizePool=t.inheritedPrizePool;
      } else {
        const _ppeCalc=t.prizePerEntry!=null&&t.prizePerEntry>0?t.prizePerEntry:(t.prizeComponent||0)*(1-(t.adminFeePercent||0)/100);
        const calcPrize=Math.round(totalE*_ppeCalc*100)/100; // round to cents
        prizePool=Math.max(calcPrize,t.guarantee||0);
      }
      const bountyPool=t.bountyAmount>0?Math.round(totalE*t.bountyAmount):0;
      return{...t,players,prizePool,bountyPool};
    });
  }
  function balanceTables(){
    setTournament(t=>{
      const active=t.players.filter(p=>p.status==='active');
      if(!active.length)return t;
      const st=t.startTable||1;
      const numT=Math.min(t.maxTables,Math.ceil(active.length/t.seatsPerTable));
      const reassigned=active.map((p,i)=>({...p,tableNum:st+(i%numT),seatNum:Math.floor(i/numT)+1}));
      const ids=new Set(reassigned.map(p=>p.id));
      return{...t,players:[...reassigned,...t.players.filter(p=>!ids.has(p.id))]};
    });
  }

  function openTable(){
    setTournament(t=>{
      const newMax=Math.min(15,t.maxTables+1);
      const newTableNum=(t.startTable||1)+newMax-1;
      return{...t,maxTables:newMax,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'table',detail:`Table ${newTableNum} opened`}]};
    });
    SoundEngine.register();
  }

  function closeTableConfirm(assignments, closingTable){
    logActivity('table',`Table ${closingTable} closed — ${Object.keys(assignments).length} players reassigned`);
    setTournament(t=>{
      if(t.maxTables<=1)return t;
      const newMax=t.maxTables-1;
      // Adjust startTable if we're closing a table that's NOT the last one
      const lastTable=(t.startTable||1)+t.maxTables-1;
      let newStart=t.startTable||1;
      // Move players from closing table to their assigned seats
      let players=[...t.players];
      assignments.forEach(({playerId,tableNum,seatNum})=>{
        players=players.map(p=>p.id===playerId?{...p,tableNum,seatNum}:p);
      });
      // If closing a middle table, shift higher tables down by 1
      if(closingTable!==lastTable){
        players=players.map(p=>p.status==='active'&&p.tableNum&&p.tableNum>closingTable
          ?{...p,tableNum:p.tableNum-1}:p);
      }
      return{...t,maxTables:newMax,players};
    });
  }

  function redrawSeats(){
    setTournament(t=>{
      const active=t.players.filter(p=>p.status==='active');
      const st=t.startTable||1;
      const mt=t.maxTables||15;
      const sp=t.seatsPerTable||9;
      // Build all available seat positions
      const seats=[];
      for(let tb=0;tb<mt;tb++) for(let s=1;s<=sp;s++) seats.push({tableNum:st+tb,seatNum:s});
      // Fisher-Yates shuffle
      for(let i=seats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[seats[i],seats[j]]=[seats[j],seats[i]];}
      const reassigned=active.map((p,i)=>({...p,...(seats[i]||{tableNum:null,seatNum:null})}));
      const ids=new Set(reassigned.map(p=>p.id));
      return{...t,players:[...reassigned,...t.players.filter(p=>!ids.has(p.id))]};
    });
  }

  function updatePayoutSettings(updates) {
    setTournament(t => {
      const merged = {...t, ...updates};
      if (updates.guarantee !== undefined || updates.prizeComponent !== undefined || updates.adminFeePercent !== undefined) {
        const _ppe=merged.prizePerEntry!=null?merged.prizePerEntry:Math.round((merged.prizeComponent||0)*(1-(merged.adminFeePercent||0)/100));
        const calcPrize = Math.round((t.players.length+(t.inheritedEntries||0))*_ppe);
        merged.prizePool = Math.max(calcPrize, merged.guarantee||0);
      }
      return merged;
    });
  }

  const cur=tournament?tournament.structure[tournament.currentLevelIdx]:null;
  const nxt=tournament?tournament.structure[tournament.currentLevelIdx+1]:null;
  const activePlayers=tournament?tournament.players.filter(p=>p.status==='active'):[];
  const bustedPlayers=tournament?tournament.players.filter(p=>p.status==='busted'):[];
  const tablesInUse=[...new Set(activePlayers.map(p=>p.tableNum).filter(Boolean))].length;
  const secs=tournament?tournament.timeRemainingSeconds:0;
  const clockCls=secs<=60?'danger':secs<=300?'warn':'';

  return(
    <div className="app">
      {view==='home'&&<HomeScreen onSelect={t=>{setSelEvent(t);setView('setup');}} savedIndex={savedIndex} onResume={resumeTournament} onDelete={deleteTournament} onExportSave={t=>exportTournament(t,false)} onExportTemplate={t=>exportTournament(t,true)} onImport={handleImportFile}/>}
      {view==='setup'&&<SetupScreen eventType={selEvent} onBack={()=>setView('home')} onStart={startTournament}/>}
      {/* Floor staff connection modal */}
      {showFloorModal&&(
        <div className="floor-modal-bg" onClick={()=>setShowFloorModal(false)}>
          <div className="floor-modal" onClick={e=>e.stopPropagation()}>
            <div className="floor-modal-title">Floor Staff Access</div>
            <div className="floor-modal-sub">Open this URL on any phone on the same wifi</div>
            {serverInfo
              ?<div className="floor-url-big">{`http://${serverInfo.ip}:${serverInfo.port}`}</div>
              :<div className="floor-url-big" style={{fontSize:14,color:'#c8973a'}}>
                Run in Terminal: <br/>
                <span style={{fontSize:12,letterSpacing:.5}}>ipconfig getifaddr en0</span><br/>
                <span style={{fontSize:11,color:'#3a5a42'}}>Then open http://[that IP]:3456 on your phone</span>
              </div>
            }
            <div style={{fontSize:11,color:'#3a5a42',marginBottom:16}}>Floor staff can register players, bust players, and control the clock.</div>
            <button className="btn-primary" style={{width:'100%'}} onClick={()=>setShowFloorModal(false)}>Close</button>
          </div>
        </div>
      )}
      {view==='tournament'&&tournament&&(()=>{
        const _th=getTheme(tournament.eventType);
        return(<div className="tour-layout" style={{'--accent':_th.accent,'--sidebar-bg':_th.sidebarBg,'--active-bg':_th.activeBg,'--active-nav':_th.activeNav}}>
          <Sidebar tournament={tournament} subview={subview} setSubview={setSubview}
            onSave={saveTournamentNow}
            onExportSave={exportCurrentSave} onExportTemplate={exportCurrentTemplate}
            onReset={resetTournament} onFloor={()=>setShowFloorModal(true)}
            onHome={()=>{clearInterval(timerRef.current);saveT(tournament);setSavedIndex(getIndex());setView('home');}}/>
          <div className="main">
            {subview==='register'&&<RegisterView tournament={tournament} onRegister={addPlayer} onSetMode={setSeatingMode} onAssignSeat={assignSeat} serverInfo={serverInfo}/>}
            {subview==='clock'&&<ClockView tournament={tournament} cur={cur} nxt={nxt} activePlayers={activePlayers} bustedPlayers={bustedPlayers} tablesInUse={tablesInUse} secs={secs} clockCls={clockCls} onToggle={toggleClock} onPrev={prevLevel} onNext={nextLevel} onAdjust={adjustTime} totalEntries={tournament.players.length} onUpdateBlinds={updateCurrentBlinds} onRegisterRandom={()=>{const reg=new Set(tournament.players.map(p=>p.name));for(let i=1;i<=700;i++){const n=String(i).padStart(3,'0');if(!reg.has(n)){addPlayer(n);break;}}}} onBustRandom={()=>{const a=tournament.players.filter(p=>p.status==='active');if(a.length)bustPlayer(a[Math.floor(Math.random()*a.length)].id);}}/>}
            {subview==='players'&&<PlayersView tournament={tournament} activePlayers={activePlayers} bustedPlayers={bustedPlayers} onAdd={addPlayer} onAddMany={addPlayers} onBust={bustPlayer} onBustMany={bustManyPlayers} onUndoBust={undoBust} onRename={updatePlayerName} onRemove={removePlayer} modal={modal} setModal={setModal}/>}
            {subview==='tables'&&<TablesView tournament={tournament} activePlayers={activePlayers} onBalance={balanceTables} onOpen={openTable} onCloseConfirm={closeTableConfirm} onMove={movePlayerSeat} onRemove={removePlayer} onLock={setSeatLock} onRedraw={redrawSeats} onUpdateChipCount={updateChipCount} onExportSeating={exportSeating}/>}
            {subview==='log'&&<LogView activityLog={tournament.activityLog||[]}/>}
            {subview==='blinds'&&<BlindEditView tournament={tournament} onUpdate={updateBlindLevel} onSetChips={setChipsInPlay}/>}
            {subview==='payouts'&&<PayoutsView tournament={tournament} activePlayers={activePlayers} onUpdate={updatePayoutSettings} onPublish={publishPayouts} onUnpublish={unpublishPayouts}/>}
            {subview==='poty'&&<POTYView tournament={tournament}/>}
          </div>
        </div>);
      })()}
    </div>
  );
}
