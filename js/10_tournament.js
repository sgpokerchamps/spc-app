/* ============================================================
   10_tournament.js
   The main App component (state management, all tournament
   action handlers, startTournament, view routing). Loads last —
   everything else this file references is already a global by
   the time this executes. (The old #display= window is gone:
   venue screens are the served /display page, see server.js.)
   ============================================================ */

const { useState, useEffect, useRef, useCallback } = React;



/* ==== BROADCAST PAYLOADS (one per live event) ==== */
function buildClockPayload(t, now) {
  const cur=t.structure[t.currentLevelIdx];
  const nxt=t.structure[t.currentLevelIdx+1];
  return {
    eventId:t.id,
    secs:clockRemainingSecs(t,now),
    running:t.status==='running',
    status:t.status,
    levelEndsAt:(t.status==='running'&&typeof t.levelEndsAt==='number')?t.levelEndsAt:null,
    pausedSecs:(t.status==='running')?null:Math.max(0,t.timeRemainingSeconds||0),
    isBreak:cur&&cur.isBreak,
    level:cur&&cur.level,
    sb:cur&&cur.sb,bb:cur&&cur.bb,ante:cur&&cur.ante,
    nextText:nxt?formatNextEntry(nxt):'',
    eventName:EVENT_CONFIGS[t.eventType]?EVENT_CONFIGS[t.eventType].group:'SPC',
  };
}
function buildTournamentPayload(tournament) {
  const cur=tournament.structure[tournament.currentLevelIdx];
      const cumE=tournament.players.length+(tournament.inheritedEntries||0);
      const _activePlayers=tournament.players.filter(p=>p.status==='active');
      const _unseated=_activePlayers.filter(p=>!p.tableNum).map(p=>({id:p.id,name:p.name,country:p.country||null,chipCount:p.chipCount||0}));
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
      getTableNumbers(tournament).forEach(num=>{ _tableMap[num]={num:num,count:0,capacity:tournament.seatsPerTable||9,players:[]}; });
      _activePlayers.forEach(p=>{if(p.tableNum&&_tableMap[p.tableNum]){_tableMap[p.tableNum].count++;_tableMap[p.tableNum].players.push({id:p.id,name:p.name,seatNum:p.seatNum,country:p.country||null,chipCount:p.chipCount||0});}});
  return({
        eventId:tournament.id,
        eventType:tournament.eventType,
        eventShort:_evCfg?_evCfg.short:(tournament.name||''),
        eventColor:_evCfg?_evCfg.color:'#c8973a',
        buyin:tournament.buyin||0,
        display:buildDisplayModel(tournament),
        reg:tournament.reg||defaultReg(tournament.eventType,'open'),
        lateRegEndsAt:lateRegEndsAtOf(tournament),
        maxReentries:(_evCfg&&typeof _evCfg.maxReentries==='number'&&isFinite(_evCfg.maxReentries))?_evCfg.maxReentries:null,
        noEntries:!!(_evCfg&&_evCfg.noEntries),
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
        bustedPositions:getFinishingPositions(tournament.players),
        currentLevelIdx:tournament.currentLevelIdx||0,
        structureRows:(tournament.structure||[]).map(e=>({text:formatNextEntry(e,true),isBreak:!!e.isBreak})),
        bustedCountries:(()=>{const m={};tournament.players.forEach(p=>{if(p.status==='busted'&&p.country)m[p.name]=p.country;});return m;})(),
        chipsInPlay:tournament.chipsInPlay||(cumE*(tournament.stack||0)),
        payoutTable:effectivePayoutTable(tournament),
        satellite:satelliteBroadcast(tournament),
        dealMade:tournament.dealMade||false,
        regLog:(tournament.regLog||[]).slice(0,1000).map(r=>{const lv=tournament.players.find(p=>p.name===r.name&&p.status==='active');return{...r,tableNum:lv&&lv.tableNum?lv.tableNum:r.tableNum,seatNum:lv&&lv.seatNum?lv.seatNum:r.seatNum};}),
        members:(()=>{try{const c=JSON.parse(localStorage.getItem('spc_members_cache')||'{}');return Object.entries(c).map(([id,v])=>({member_id:id,name:typeof v==='string'?v:v.name,country:typeof v==='object'?v.country:null}));}catch(e){return[];}})(),
  });
}

/* Shared by Resume and by auto-resume on relaunch: legacy migration, then catch the clock up to the wall clock.
   Over 10 minutes since the level should have ended: ask, naming the event. */
function prepareResumed(t, now) {
  t=ensureReg(t);
  if(t.status!=='running') return t;
  if(typeof t.levelEndsAt!=='number') t={...t,levelEndsAt:now+(t.timeRemainingSeconds||0)*1000};
  if(now-t.levelEndsAt>600000){
    const hm=ms=>new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
    const savedAt=typeof t.savedAt==='number'?t.savedAt:null;
    const cfg=EVENT_CONFIGS[t.eventType]||null;
    const nm=cfg?cfg.short:(t.name||'This event');
    if(confirm(nm+"'s clock was running when it was last saved at "+hm(savedAt||t.levelEndsAt)+". It is now "+hm(now)+". OK = catch up to where the clock would be now. Cancel = open it paused at the time shown when it was saved.")) return catchUpClock(t,now);
    return {...t,status:'paused',timeRemainingSeconds:savedAt?Math.max(0,Math.ceil((t.levelEndsAt-savedAt)/1000)):Math.max(0,t.timeRemainingSeconds||0),levelEndsAt:null};
  }
  return catchUpClock(t,now);
}

/* Screens persisted by the desk (localStorage spc_screens). */
function loadScreens() {
  const dflt={main:{layout:'logo',events:[],names:[]},side:{layout:'logo',events:[],names:[]}};
  try{
    const v=JSON.parse(localStorage.getItem('spc_screens')||'null');
    if(v&&v.main&&v.side){
      const fix=x=>({layout:['logo','single','split'].indexOf(x.layout)>=0?x.layout:'logo',events:Array.isArray(x.events)?x.events.slice(0,2):[],names:Array.isArray(x.names)?x.names.slice(0,2):[]});
      return {main:fix(v.main),side:fix(v.side)};
    }
  }catch(e){}
  return dflt;
}

/* ==== APP ==== */
function App() {

  const [view,setView] = useState('home');
  const [selEvent,setSelEvent] = useState(null);
  /* Live event registry. live = every event loaded in memory (keyed by id); focusedId = the event the desk is showing.
     tournament (below) is the focused event, derived. setTournament(u) keeps the old call-site shape but now targets
     scopeRef (floor actions, via withEvent) or else the focused event (desk clicks). It NEVER falls back to focus when a
     scope is set, and updateEvent never targets an event that is not live. Action functions called through withEvent must
     call setTournament synchronously (no timers, promises or awaits before it). */
  const [live,setLive] = useState({});
  const [focusedId,setFocusedId] = useState(null);
  const tournament = focusedId ? (live[focusedId]||null) : null;
  const liveRef = useRef({});
  liveRef.current = live;
  const focusedIdRef = useRef(null);
  focusedIdRef.current = focusedId;
  const scopeRef = useRef(null);
  const updateEvent = useCallback((id,updater)=>{
    setLive(prev=>{
      const cur=prev[id];
      if(!cur){console.warn('updateEvent: event not live, update dropped',id);return prev;}
      const next=typeof updater==='function'?updater(cur):updater;
      if(!next||next===cur) return prev;
      return {...prev,[id]:next};
    });
  },[]);
  const setTournament = useCallback(u=>{
    const id=scopeRef.current||focusedIdRef.current;
    if(!id){console.warn('setTournament: no target event');return;}
    updateEvent(id,u);
  },[updateEvent]);
  function withEvent(id,fn){
    const prev=scopeRef.current;
    scopeRef.current=id;
    try{ return fn(); } finally { scopeRef.current=prev; }
  }
  function addLiveEvent(t){
    if(Object.keys(liveRef.current).length>=3&&!confirm('3 events are already running. The design limit is 3. Add another anyway?')) return false;
    liveRef.current={...liveRef.current,[t.id]:t};
    setLive(prev=>({...prev,[t.id]:t}));
    focusedIdRef.current=t.id;
    setFocusedId(t.id);
    return true;
  }
  function focusEvent(id){
    if(!liveRef.current[id]) return;
    focusedIdRef.current=id;
    setFocusedId(id);
    setModal(null);
  }
  function removeLiveEvent(id){
    const rest={...liveRef.current}; delete rest[id];
    liveRef.current=rest;
    setLive(prev=>{const n={...prev}; delete n[id]; return n;});
    if(focusedIdRef.current===id){
      const nextId=Object.keys(rest)[0]||null;
      focusedIdRef.current=nextId;
      setFocusedId(nextId);
    }
    return Object.keys(rest).length;
  }
  const [subview,setSubview] = useState('clock');
  // Global callback for RegisterView to persist regLog
  window._spcUpdateRegLog = function(log){ setTournament(t=>({...t,regLog:log})); };
  const [modal,setModal] = useState(null);
  const [savedIndex,setSavedIndex] = useState(getIndex);
  const [tickSecond,setTickSecond] = useState(0);
  const lastSecsRef = useRef({});
  const lastSentRef = useRef({});
  const lastClockRef = useRef({});
  const secs = clockRemainingSecs(tournament, Date.now());

  /* Clock tick: one interval for the life of App, covering EVERY live event. Level changes come from levelEndsAt.
     Re-render only when some event's displayed second changed (tickSecond is just the re-render trigger). */
  useEffect(()=>{
    const iv=setInterval(()=>{
      const now=Date.now();
      const cur=liveRef.current;
      const ids=Object.keys(cur);
      const due=ids.filter(id=>{const t=cur[id];return t.status==='running'&&typeof t.levelEndsAt==='number'&&t.levelEndsAt<=now;});
      due.forEach(id=>updateEvent(id,prev=>catchUpClock(prev,Date.now())));
      let changed=false;
      ids.forEach(id=>{const sx=clockRemainingSecs(cur[id],now); if(lastSecsRef.current[id]!==sx){lastSecsRef.current[id]=sx;changed=true;}});
      if(changed) setTickSecond(n=>n+1);
    },250);
    return()=>clearInterval(iv);
  },[]);

  /* Floor, counter and venue-screen clock sync, for every live event, every displayed second */
  useEffect(()=>{
    const now=Date.now();
    Object.keys(live).forEach(id=>{
      const t=live[id];
      if(typeof window.electronAPI!=='undefined'){
        const p=buildClockPayload(t,now); const key=JSON.stringify(p);
        if(lastClockRef.current[id]!==key){ lastClockRef.current[id]=key; window.electronAPI.sendClockState(p); }
      }
    });
  },[live,tickSecond]);

  /* Tournament state sync - heavy payload, only for events whose object changed since last sent */
  useEffect(()=>{
    if(typeof window.electronAPI==='undefined') return;
    const sent=lastSentRef.current;
    Object.keys(live).forEach(id=>{
      if(sent[id]!==live[id]){ sent[id]=live[id]; window.electronAPI.sendTournamentState(buildTournamentPayload(live[id])); }
    });
    Object.keys(sent).forEach(id=>{ if(!live[id]) delete sent[id]; });
  },[live]);

  /* Tell the server which events are live (reuses the tournament-state IPC channel: no preload.js change needed) */
  const liveIdsKey=Object.keys(live).join(',');
  useEffect(()=>{
    if(typeof window.electronAPI!=='undefined') window.electronAPI.sendTournamentState({_liveList:liveIdsKey?liveIdsKey.split(','):[]});
  },[liveIdsKey]);

  /* Floor action handler (from phones via Electron). Routes by action.event: the action lands in THAT live event and never
     in the desk's focused event (invariant 2). The listener is registered once; floorHandlerRef always holds the latest closure. */
  const floorHandlerRef = useRef(null);
  floorHandlerRef.current = function handleFloorAction(e){
    const action=e.detail;
    if(!action)return;
    const id=action.event;
    const ev=(typeof id==='string'&&Object.prototype.hasOwnProperty.call(liveRef.current,id))?liveRef.current[id]:null;
    if(!ev){console.warn('floor action ignored: event not live',action.type,id);return;}
    withEvent(id,()=>{
        if(action.type==='register'||action.type==='register-next'){
          // register by name if given, otherwise register next available number
          if(action.name){
            const existing=ev.players.find(p=>p.name===action.name&&p.status==='active');
            const isDup=!!existing;
            if(!existing){addPlayer(action.name, false, action.country||null);SoundEngine.register();}
            // Add to regLog so counter sees it
            setTournament(t=>{const entry={name:action.name,country:action.country||null,isDup,isReentry:!!t.players.find(p=>p.name===action.name&&p.status==='busted'),late:!!action.late,ts:Date.now(),tableNum:null,seatNum:null};return{...t,regLog:[entry,...(t.regLog||[])].slice(0,1000)};});
          } else {
            // find next unused number
            const used=new Set(ev.players.map(p=>p.name));
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
            const p=ev.players.find(pl=>pl.name===action.name&&pl.status==='active');
            if(p){bustPlayer(p.id);SoundEngine.bust();}
          } else {
            // bust a random active player
            const active=ev.players.filter(p=>p.status==='active');
            if(active.length>0){
              const p=active[Math.floor(Math.random()*active.length)];
              bustPlayer(p.id);SoundEngine.bust();
            }
          }
        } else if(action.type==='undo-bust'){
          undoBust();
        } else if(action.type==='swap-bust'){
          swapBust(action.wrongId,action.intendedId);
        } else if(action.type==='update-chip-count'){
          if(action.playerId!=null) setChipCountFromFloor(action.playerId,action.chipCount);
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
          openTable(action.tableNum);
        } else if(action.type==='set-seating-mode'){
          if(action.mode) setSeatingMode(action.mode);
        } else if(action.type==='close-table-confirm'){
          if(action.assignments&&action.closingTable){
            closeTableConfirm(action.assignments, action.closingTable);
          }
        } else if(action.type==='redraw-final-table'){
          if(action.destTable&&action.assignments){
            applyFinalTableRedraw(action.destTable, action.assignments);
          }
        } else if(action.type==='break-table'){
          if(action.tableNum){
            const tNumN=Number(action.tableNum);const spt=ev.seatsPerTable||9;const active=ev.players.filter(p=>p.status==='active');const displaced=active.filter(p=>p.tableNum===tNumN);if(displaced.length===0){closeTableConfirm([],tNumN);return;}const lk=ev.seatLocks||{};const tableNumbers=getTableNumbers(ev);const result=computeBreakAssignments({closingTable:tNumN,players:active,tableNumbers:tableNumbers,seatsPerTable:spt,seatLocks:lk});if(!result.ok)return;closeTableConfirm(result.assignments,tNumN);
          }
        } else if(action.type==='set-seat-lock'){
          if(action.tableNum&&action.seatNum) setSeatLock(action.tableNum,action.seatNum,action.lockType||'none');
        }
    });
  };
  useEffect(()=>{
    function onFloorAction(e){ if(floorHandlerRef.current) floorHandlerRef.current(e); }
    window.addEventListener('spc-floor-action',onFloorAction);
    return()=>window.removeEventListener('spc-floor-action',onFloorAction);
  },[]);

  /* Floor URL overlay */
  const [serverInfo,setServerInfo]=useState(null);
  /* Main screen (venue HDMI output): status from the app shell. An older app package has no openMainScreen/mainScreenStatus. */
  const mainScreenSupported=typeof window.electronAPI!=='undefined'&&typeof window.electronAPI.mainScreenStatus==='function';
  const [mainScreenInfo,setMainScreenInfo]=useState(null);
  useEffect(()=>{
    if(!mainScreenSupported) return;
    let alive=true;
    const read=()=>{ window.electronAPI.mainScreenStatus().then(i=>{ if(alive) setMainScreenInfo(i); }).catch(()=>{}); };
    read(); const iv=setInterval(read,3000);
    return()=>{ alive=false; clearInterval(iv); };
  },[mainScreenSupported]);
  function reopenMainScreen(){ if(mainScreenSupported) window.electronAPI.openMainScreen().then(setMainScreenInfo).catch(()=>{}); }
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

  /* Save EVERY live event on EVERY change (saveT returns false on failure; failures raise a banner and are retried). */
  const lastSavedRef = useRef({});
  const saveFailuresRef = useRef({});
  const [saveFailures,setSaveFailures] = useState({});

  /* Screens: which live event(s) each venue screen shows. Pinned from the desk, persisted, and NEVER derived from focus.
     layout: 'logo' | 'single' | 'split'; events: [id] or [idA,idB]; names: short names kept so a closed event can still be named. */
  const [screens,setScreens] = useState(loadScreens);
  useEffect(()=>{
    try{ localStorage.setItem('spc_screens',JSON.stringify(screens)); }catch(e){}
    if(typeof window.electronAPI!=='undefined'){
      window.electronAPI.sendTournamentState({_screens:{main:{layout:screens.main.layout,events:screens.main.events},side:{layout:screens.side.layout,events:screens.side.events}}});
    }
  },[screens]);
  function setScreen(which,layout,events){
    const names=events.map(id=>{const t=liveRef.current[id];const c=t&&EVENT_CONFIGS[t.eventType];return id?(c?c.short:((screens[which].events||[]).indexOf(id)>=0?(screens[which].names||[])[(screens[which].events||[]).indexOf(id)]:'')):'';});
    setScreens(prev=>({...prev,[which]:{layout:layout,events:events,names:names}}));
  }
  function saveLiveEvent(id,t){
    let prev=null; try{ prev=getIndex().find(x=>x.id===id)||null; }catch(e){}
    const ok=saveT(t);
    if(ok){
      lastSavedRef.current[id]=t;
      if(!prev||prev.status!==t.status||prev.name!==t.name) setSavedIndex(getIndex());
      if(saveFailuresRef.current[id]){ const n={...saveFailuresRef.current}; delete n[id]; saveFailuresRef.current=n; setSaveFailures(n); }
    } else if(!saveFailuresRef.current[id]){
      const n={...saveFailuresRef.current,[id]:true}; saveFailuresRef.current=n; setSaveFailures(n);
    }
    return ok;
  }
  useEffect(()=>{
    Object.keys(live).forEach(id=>{ if(lastSavedRef.current[id]!==live[id]) saveLiveEvent(id,live[id]); });
    Object.keys(lastSavedRef.current).forEach(id=>{ if(!live[id]) delete lastSavedRef.current[id]; });
    const stale=Object.keys(saveFailuresRef.current).filter(id=>!live[id]);
    if(stale.length){ const n={...saveFailuresRef.current}; stale.forEach(id=>delete n[id]); saveFailuresRef.current=n; setSaveFailures(n); }
  },[live]);
  useEffect(()=>{
    const iv=setInterval(()=>{
      const cur=liveRef.current;
      Object.keys(saveFailuresRef.current).forEach(id=>{ if(cur[id]) saveLiveEvent(id,cur[id]); });
    },10000);
    return()=>clearInterval(iv);
  },[]);

  /* One-time cleanup: the retired display mode left one spc_live_<tournament id> key per event (display cache only; the
     tournaments themselves are spc_t_<id>). Delete them all EXCEPT spc_live_ids, which auto-resume uses. */
  useEffect(()=>{
    try{
      if(localStorage.getItem('spc_cleanup_display_keys_v1')) return;
      const del=[];
      for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.indexOf('spc_live_')===0&&k!=='spc_live_ids') del.push(k); }
      del.forEach(k=>localStorage.removeItem(k));
      localStorage.setItem('spc_cleanup_display_keys_v1',String(Date.now()));
      console.log('[SPC] removed '+del.length+' old spc_live_ display keys');
    }catch(e){}
  },[]);

  /* Auto-resume on launch: every event that was live comes back (crash, Cmd-Q, update restart). */
  const [restored,setRestored] = useState(false);
  useEffect(()=>{
    let ids=[]; let focus='';
    try{ ids=JSON.parse(localStorage.getItem('spc_live_ids')||'[]'); focus=localStorage.getItem('spc_focused_id')||''; }catch(e){}
    const now=Date.now(); const obj={}; let firstId=null;
    (Array.isArray(ids)?ids:[]).forEach(id=>{
      const raw=loadT(id); if(!raw) return;
      const t=prepareResumed(raw,now);
      obj[t.id]={...t, payoutsPublished:t.payoutsPublished||false, tableNumbers:getTableNumbers(t)};
      if(!firstId) firstId=t.id;
    });
    if(firstId){
      const fid=obj[focus]?focus:firstId;
      liveRef.current=obj; setLive(obj);
      focusedIdRef.current=fid; setFocusedId(fid);
      setSubview('clock'); setView('tournament');
    }
    setRestored(true);
  },[]);
  /* Remember which events are live and which is focused (only after the restore above, or it would overwrite what it reads). */
  useEffect(()=>{
    if(!restored) return;
    try{ localStorage.setItem('spc_live_ids',JSON.stringify(Object.keys(live))); localStorage.setItem('spc_focused_id',focusedId||''); }catch(e){}
  },[liveIdsKey,focusedId,restored]);

  function startTournament(config) {
    {const _want=(config.tableNumbers&&config.tableNumbers.length)?config.tableNumbers:null;
     if(_want){const _tk=tablesElsewhere(liveRef.current,null);const _bad=_want.filter(n=>_tk[n]!=null);
       if(_bad.length){alert('Table'+(_bad.length>1?'s ':' ')+_bad.join(', ')+' '+(_bad.length>1?'are':'is')+' already in use by another live event ('+_tk[_bad[0]]+'). Change the table selection.');return;}}}
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

    let _deduped=_inheritedPlayers;
    let _extraBagWinners=[];
    let _totalExtraBags=0;
    let _actualChips=0;
    let _seatedPlayers=[];
    let _baggedPlayers=[];
    if(isDay2){
      // Day 2: dedupe by normalised name (best stack), count extra bags, seat at the chosen tables
      const _sd=seatDay2(_inheritedPlayers,config.tableNumbers&&config.tableNumbers.length?config.tableNumbers:Array.from({length:_maxT},(_,k)=>k+1),_spt,uid);
      _deduped=_sd.deduped;_extraBagWinners=_sd.extraBagWinners;_totalExtraBags=_sd.totalExtraBags;_actualChips=_sd.chips;_seatedPlayers=_sd.seated;
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
      ...(config.eventType==='satellite'?{seatValue:config.seatValue>0?config.seatValue:600,guaranteedSeats:config.guaranteedSeats>0?config.guaranteedSeats:10}:{}),
      inheritedEntries:adjustedInheritedEntries,inheritedBusted:adjustedInheritedBusted,inheritedPrizePool,
      bountyAmount,prizePerEntry,bountyPool:Math.max(Math.round(inheritedEntries*bountyAmount),0),
      stack:config.stack,maxTables:config.maxTables,seatsPerTable:config.seatsPerTable,startTable:config.startTable||1,
      tableNumbers:(config.tableNumbers&&config.tableNumbers.length)?[...config.tableNumbers].sort((a,b)=>a-b):getTableNumbers({startTable:config.startTable||1,maxTables:config.maxTables}),
      players:_seatedPlayers,structure,currentLevelIdx:0,timeRemainingSeconds:structure[0].mins*60,levelEndsAt:null,
      reg:{...defaultReg(config.eventType,'notOpen'),...(config.lateRegLevel!==undefined?{lateRegLevel:config.lateRegLevel}:{})},
      status:'paused',prizePool:Math.max(calcInitPrize,guarantee),payoutTable:null,seatingMode:'auto',regLog:[],seatLocks:{},
      baggedPlayers:_baggedPlayers,
      ...(isDay2&&config.parents&&config.parents.length?{parents:config.parents,parentAliases:config.parentAliases||{}}:{}),
      extraBagWinners:_extraBagWinners,extraBagCount:_totalExtraBags>0?_totalExtraBags:(config.extraBagCount||0),
      chipsInPlay:_actualChips>0?_actualChips
        :(config.stack===0&&inheritedEntries>0&&config.inheritedStack>0
        ? inheritedEntries*(config.inheritedStack)
        : 0)};
    if(!addLiveEvent({...t, payoutsPublished:false})) return; setSubview('register'); setView('tournament');
  }

  function canRebuildInheritance(t){
    return !!(t&&t.parents&&t.parents.length&&t.status==='paused'&&t.levelEndsAt==null&&t.currentLevelIdx===0&&
      t.timeRemainingSeconds===(t.structure[0]?t.structure[0].mins*60:-1)&&!t.players.some(p=>p.status==='busted'));
  }
  function rebuildInheritance(){
    const id=focusedIdRef.current; const t=liveRef.current[id];
    if(!canRebuildInheritance(t)) return;
    const ps=t.parents.map(pid=>liveRef.current[pid]||loadT(pid)).filter(Boolean);
    if(ps.length<t.parents.length&&!confirm('Some source flights are no longer saved on this Mac. Rebuild from the '+ps.length+' that are?')) return;
    const d=deriveInheritance(ps,t.parentAliases);
    const sd=seatDay2(d.players,getTableNumbers(t),t.seatsPerTable||9,uid);
    if(!confirm('Rebuild Day 2 from '+ps.length+' flight(s)?\n'+sd.deduped.length+' players, '+sd.totalExtraBags+' extra bags, prize pool '+fmt.currency(Math.max(d.prizePool,t.guarantee||0))+'.\nThis replaces the current seating.')) return;
    updateEvent(id,cur=>({...cur,players:[...cur.players.filter(p=>!p.inherited),...sd.seated],
      inheritedEntries:Math.max(0,d.entries-sd.deduped.length),inheritedBusted:d.busted,inheritedPrizePool:d.prizePool,
      prizePool:Math.max(d.prizePool,cur.guarantee||0),extraBagWinners:sd.extraBagWinners,extraBagCount:sd.totalExtraBags,chipsInPlay:sd.chips,
      activityLog:[...(cur.activityLog||[]),{ts:Date.now(),type:'table',detail:'Day 2 survivors rebuilt from '+ps.length+' flight(s)'}]}));
  }

  function resetTournament() {
    if (!tournament) return;
    if (!confirm('Reset this event? All players, busts and table assignments will be cleared. Clock returns to Level 1. This cannot be undone.')) return;
    setTournament(t => ({
      ...t,
      players: [],
      currentLevelIdx: 0,
      timeRemainingSeconds: t.structure[0].mins * 60,
      levelEndsAt: null,
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
    // Already live: just focus it. Never reload from storage (that would discard the in-memory state).
    if(liveRef.current[id]){ focusEvent(id); setSubview('clock'); setView('tournament'); return; }
    let t=loadT(id);
    if(!t) return;
    t=prepareResumed(t,Date.now());
    if(!addLiveEvent({...t, payoutsPublished:t.payoutsPublished||false, tableNumbers:getTableNumbers(t)})) return; setSubview('clock');setView('tournament');
  }

  function deleteTournament(id) {
    deleteT(id); setSavedIndex(getIndex());
    if(liveRef.current[id]){ if(removeLiveEvent(id)===0) setView('home'); }
  }

  /* Registration controls (desk). Only Close / Close immediately stop the counter; the late-reg window is advisory. */
  function regAction(id,type,val) {
    updateEvent(id,t=>{
      const reg=t.reg||defaultReg(t.eventType,'open'); const now=Date.now(); const cfg=EVENT_CONFIGS[t.eventType]||null;
      const notLeft=lvl=>{const i=t.structure.findIndex(e=>!e.isBreak&&e.level===lvl);return i<0||t.currentLevelIdx<=i;};
      let next=reg, msg='';
      if(type==='open'){ if(cfg&&cfg.noEntries) return t; next={...reg,status:'open',closedAt:null,noGrace:false}; msg='Registration opened'; }
      else if(type==='close'){ next={...reg,status:'closed',closedAt:now,noGrace:false}; msg='Registration closed (grace '+reg.graceMins+' min)'; }
      else if(type==='closeNow'){ next={...reg,status:'closed',closedAt:now,noGrace:true}; msg='Registration closed immediately'; }
      else if(type==='extend'){
        if(reg.lateRegLevel==null||(cfg&&cfg.noEntries)) return t;
        const nl=reg.lateRegLevel+1;
        next={...reg,lateRegLevel:nl,lateRegEndedAt:notLeft(nl)?null:reg.lateRegEndedAt};
        if(reg.status==='closed') next={...next,status:'open',closedAt:null,noGrace:false};
        msg='Late registration extended to end of Level '+nl;
      }
      else if(type==='setLevel'){ const nl=(val===null||isNaN(val))?null:Math.max(1,Math.round(val)); next={...reg,lateRegLevel:nl,lateRegEndedAt:(nl!=null&&notLeft(nl))?null:reg.lateRegEndedAt}; msg=nl==null?'Late registration level cleared':'Late registration level set to '+nl; }
      else if(type==='setGrace'){ const g=Math.max(0,Math.round(val)||0); next={...reg,graceMins:g}; msg='Registration grace set to '+g+' min'; }
      else if(type==='override'){ msg='Desk registered '+val+' while registration was closed'; }
      else return t;
      return{...t,reg:next,activityLog:[...(t.activityLog||[]),{ts:now,type:'register',detail:msg}]};
    });
  }

  function closeFocusedEvent() {
    if(!tournament) return;
    if(tournament.status==='running'){ alert('Pause the clock first, then close the event.'); return; }
    saveT(tournament); setSavedIndex(getIndex());
    if(removeLiveEvent(tournament.id)===0) setView('home');
  }

  function saveTournamentNow() {
    if(!tournament) return;
    if(saveT(tournament)){ setSavedIndex(getIndex()); alert('Saved!'); } else alert('SAVE FAILED. Storage may be full. Export a backup now.');
  }

  function toggleClock(){setTournament(t=>{
    const now=Date.now();
    const wasRunning=t.status==='running';
    const newStatus=wasRunning?'paused':'running';
    return{...t,status:newStatus,timeRemainingSeconds:wasRunning?clockRemainingSecs(t,now):t.timeRemainingSeconds,levelEndsAt:wasRunning?null:now+(t.timeRemainingSeconds||0)*1000,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'clock',detail:newStatus==='running'?'Clock started':'Clock paused'}]};
  });}
  function publishPayouts(){setTournament(t=>({...t,payoutsPublished:true}));}
  function unpublishPayouts(){setTournament(t=>({...t,payoutsPublished:false}));}
  function prevLevel(){setTournament(t=>{const i=Math.max(0,t.currentLevelIdx-1);const s=t.structure[i].mins*60;return{...t,currentLevelIdx:i,timeRemainingSeconds:s,levelEndsAt:t.status==='running'?Date.now()+s*1000:null};});}
  function nextLevel(){setTournament(advanceLevelFn);}
  function adjustTime(s){setTournament(t=>{
    if(t.status==='running'&&typeof t.levelEndsAt==='number') return{...t,levelEndsAt:Math.max(Date.now(),t.levelEndsAt+s*1000)};
    return{...t,timeRemainingSeconds:Math.max(0,t.timeRemainingSeconds+s)};
  });}

  function addPlayer(name, forceAuto=false, country=null){
    setTournament(t=>{
      const mode=t.seatingMode||'auto';
      let players=[...t.players];
      const seat=(mode==='auto'||forceAuto)?findSeat(players,getTableNumbers(t),t.seatsPerTable,t.seatLocks||{}):{tableNum:null,seatNum:null};
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
      names.forEach(name=>{const seat=findSeat(players,getTableNumbers(t),t.seatsPerTable,t.seatLocks||{});players.push({id:uid(),name,status:'active',bustPosition:null,...seat});});
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
    setTournament(t=>{
      // Guard: a player who is already busted must not be re-busted (would reassign them the next position and tie with another player)
      const target=t.players.find(p=>p.id===id);
      if(!target||target.status!=='active') return t;
      const active=t.players.filter(p=>p.status==='active');
      const position=active.length;
      return{...t,players:t.players.map(p=>p.id===id?{...p,status:'busted',bustPosition:position,prevTableNum:p.tableNum,prevSeatNum:p.seatNum,tableNum:null,seatNum:null,bustedAt:Date.now()}:p),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'bust',detail:`${target.name} busted ${fmt.ordinal(position)} (T${target.tableNum} S${target.seatNum})`}]};
    });
  }
  function updatePlayerName(id,name){setTournament(t=>({...t,players:t.players.map(p=>p.id===id?{...p,name}:p)}));}
  function bustManyPlayers(ids){
    setTournament(t=>{
      let players=[...t.players];
      ids.forEach(id=>{
        const target=players.find(p=>p.id===id);
        if(!target||target.status!=='active') return;
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
      if(!tableNum||!seatNum){const seat=findSeat(t.players.filter(x=>x.id!==p.id),getTableNumbers(t),t.seatsPerTable,t.seatLocks||{});tableNum=seat.tableNum;seatNum=seat.seatNum;}
      return{...t,players:t.players.map(x=>x.id===p.id?{...x,status:'active',bustPosition:undefined,bustedAt:undefined,tableNum,seatNum,prevTableNum:undefined,prevSeatNum:undefined}:x),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'undo-bust',detail:`${p.name} undo bust → T${tableNum||'?'} S${seatNum||'?'}`}]};
    });
  }
  // Correct a wrong bust: floor busted `wrongId` when it should have been `intendedId`. A real
  // elimination happened at that moment - only the NAME attached to it was wrong - so this relabels
  // rather than undoes. intendedId inherits wrongId's exact bustPosition/bustedAt (payout is derived
  // from position everywhere - Payouts tab, commit payload - so nothing else needs to move). If
  // intended is currently active, wrongId takes intended's old seat (falling back to findSeat if that
  // seat was since taken, e.g. by a table break). If intended is also busted (both wrong relative to
  // each other), their positions simply trade - neither returns to play. Nobody else's bustPosition
  // changes; only the name<->position mapping for these two.
  function swapBust(wrongId,intendedId){
    if(wrongId===intendedId)return;
    setTournament(t=>{
      const wrong=t.players.find(p=>p.id===wrongId);
      const intended=t.players.find(p=>p.id===intendedId);
      if(!wrong){alert('Player to correct not found.');return t;}
      if(wrong.status!=='busted'){alert(`${wrong.name} is not currently busted - nothing to correct.`);return t;}
      if(!intended){alert('Intended player not found.');return t;}
      const pos=wrong.bustPosition, bustedAt=wrong.bustedAt;
      let players, detail;
      if(intended.status==='active'){
        let tableNum=intended.tableNum, seatNum=intended.seatNum;
        const seatTaken=tableNum&&seatNum&&t.players.some(p=>p.id!==intended.id&&p.status==='active'&&p.tableNum===tableNum&&p.seatNum===seatNum);
        if(!tableNum||!seatNum||seatTaken){
          const seat=findSeat(t.players.filter(p=>p.id!==wrong.id&&p.id!==intended.id),getTableNumbers(t),t.seatsPerTable,t.seatLocks||{});
          tableNum=seat.tableNum;seatNum=seat.seatNum;
        }
        players=t.players.map(p=>{
          if(p.id===wrong.id)return{...p,status:'active',bustPosition:undefined,bustedAt:undefined,tableNum,seatNum,prevTableNum:undefined,prevSeatNum:undefined};
          if(p.id===intended.id)return{...p,status:'busted',bustPosition:pos,bustedAt,prevTableNum:intended.tableNum,prevSeatNum:intended.seatNum,tableNum:null,seatNum:null};
          return p;
        });
        detail=`Correction: ${intended.name} recorded ${fmt.ordinal(pos)} (was ${wrong.name}); ${wrong.name} back in play`;
      } else {
        const intendedPos=intended.bustPosition, intendedBustedAt=intended.bustedAt;
        players=t.players.map(p=>{
          if(p.id===wrong.id)return{...p,bustPosition:intendedPos,bustedAt:intendedBustedAt};
          if(p.id===intended.id)return{...p,bustPosition:pos,bustedAt};
          return p;
        });
        detail=`Correction: ${intended.name} recorded ${fmt.ordinal(pos)}, ${wrong.name} recorded ${fmt.ordinal(intendedPos)} (positions swapped)`;
      }
      if(window.location&&window.location.hash.indexOf('dev')>=0){
        const before=t.players.map(p=>p.bustPosition).filter(x=>x!=null).sort((a,b)=>a-b);
        const after=players.map(p=>p.bustPosition).filter(x=>x!=null).sort((a,b)=>a-b);
        console.assert(JSON.stringify(before)===JSON.stringify(after),'swapBust changed the position multiset',before,after);
      }
      return{...t,players,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'swap-bust',detail}]};
    });
  }
  // Remove a phantom bust: no elimination happened at all, floor busted someone still at the table.
  // Unlike swapBust (a relabel - active count stays right), this asserts the elimination itself never
  // occurred, so it un-busts X AND shifts every finer-positioned bust worse by one to close the gap -
  // simulateRemovePhantomBust (02_utils.js) is the single source of truth for that shift, shared with
  // the preview so they can never disagree. Desktop only - no floor dispatcher entry for this action.
  function removePhantomBust(id){
    setTournament(t=>{
      const x=t.players.find(p=>p.id===id);
      if(!x){alert('Player not found.');return t;}
      if(x.status!=='busted'){alert(`${x.name} is not currently busted - nothing to remove.`);return t;}
      if(x.bustPosition==null){alert(`${x.name} has no recorded finishing position.`);return t;}
      const P=x.bustPosition;
      const shifted=simulateRemovePhantomBust(t.players,id);
      if(!shifted)return t;
      let tableNum=x.prevTableNum||null,seatNum=x.prevSeatNum||null;
      const seatTaken=tableNum&&seatNum&&t.players.some(p=>p.id!==x.id&&p.status==='active'&&p.tableNum===tableNum&&p.seatNum===seatNum);
      if(!tableNum||!seatNum||seatTaken){
        const seat=findSeat(t.players.filter(p=>p.id!==x.id),getTableNumbers(t),t.seatsPerTable,t.seatLocks||{});
        tableNum=seat.tableNum;seatNum=seat.seatNum;
      }
      const players=shifted.map(p=>p.id===x.id?{...p,tableNum,seatNum,prevTableNum:undefined,prevSeatNum:undefined}:p);
      const shiftedN=t.players.filter(p=>p.status==='busted'&&p.bustPosition!=null&&p.bustPosition<P).length;
      if(window.location.hash.indexOf('dev')>=0){
        const before=t.players.filter(p=>p.status==='busted'&&p.bustPosition!=null).map(p=>p.bustPosition).sort((a,b)=>a-b);
        const beforeExpected=before.filter(v=>v!==P).map(v=>v<P?v+1:v).sort((a,b)=>a-b);
        const after=players.filter(p=>p.status==='busted'&&p.bustPosition!=null).map(p=>p.bustPosition).sort((a,b)=>a-b);
        console.assert(JSON.stringify(beforeExpected)===JSON.stringify(after),'removePhantomBust invariant violated',beforeExpected,after);
      }
      return{...t,players,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'remove-phantom-bust',detail:`${x.name}'s bust at ${fmt.ordinal(P)} removed (no elimination occurred) - ${shiftedN} position${shiftedN!==1?'s':''} shifted, ${x.name} back in play at T${tableNum||'?'} S${seatNum||'?'}`}]};
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
        seat=findSeat(t.players,getTableNumbers(t),t.seatsPerTable,t.seatLocks||{});
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
  /* Append-only: adds ONE entry after the last existing one. Only touches t.structure - never currentLevelIdx,
     timeRemainingSeconds or status - so the running clock cannot move. Refused once the tournament is complete. */
  function appendStructureEntry(entry){
    setTournament(t=>{
      if(!t||!t.structure||t.status==='complete') return t;
      const e=entry.isBreak
        ?{isBreak:true,mins:Math.max(1,Number(entry.mins)||10),note:entry.note||''}
        :{level:t.structure.filter(r=>!r.isBreak).reduce((m,r)=>Math.max(m,r.level||0),0)+1,sb:Number(entry.sb)||0,bb:Number(entry.bb)||0,ante:Number(entry.ante)||0,mins:Math.max(1,Number(entry.mins)||1)};
      return{...t,structure:[...t.structure,e]};
    });
  }
  function setChipsInPlay(val) {
    setTournament(t=>({...t,chipsInPlay:Number(val)||0}));
  }
  function updateChipCount(playerId,chipCount){
    setTournament(t=>({...t,players:t.players.map(p=>p.id===playerId?{...p,chipCount:Number(chipCount)||0}:p)}));
  }
  // Floor-dispatched chip count ('update-chip-count'). Writes the same p.chipCount field the desktop input
  // and the inheritance path (04_setup.js -> startTournament) read. Active players only; 0 means "cleared /
  // not entered" (the floor UI never sends a typed 0, only an explicit Clear). Each call is a discrete
  // update of ONE player inside a functional setTournament, so two devices entering different players'
  // stacks at once cannot overwrite each other.
  function setChipCountFromFloor(playerId,chipCount){
    const n=Number(chipCount);
    if(!isFinite(n)||n<0||n>1000000000)return;
    const val=Math.round(n);
    setTournament(t=>{
      const target=t.players.find(p=>p.id===playerId);
      if(!target||target.status!=='active')return t;
      const was=target.chipCount||0;
      if(was===val)return t;
      return{...t,players:t.players.map(p=>p.id===playerId?{...p,chipCount:val}:p),
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'chips',detail:`${target.name} stack ${val>0?'set to '+val.toLocaleString():'cleared'}${was>0?' (was '+was.toLocaleString()+')':''} (floor)`}]};
    });
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
          if (!seatNum) { const seat=findSeat(players,getTableNumbers(t),t.seatsPerTable,t.seatLocks||{}); tNum=seat.tableNum; seatNum=seat.seatNum; }
        } else {
          const seat=findSeat(players,getTableNumbers(t),t.seatsPerTable,t.seatLocks||{}); tNum=seat.tableNum; seatNum=seat.seatNum;
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
      const tableNumbers=getTableNumbers(t);
      const numT=Math.min(tableNumbers.length,Math.ceil(active.length/t.seatsPerTable));
      const reassigned=active.map((p,i)=>({...p,tableNum:tableNumbers[i%numT],seatNum:Math.floor(i/numT)+1}));
      const ids=new Set(reassigned.map(p=>p.id));
      return{...t,players:[...reassigned,...t.players.filter(p=>!ids.has(p.id))]};
    });
  }

  function openTable(specificNum){
    const id=scopeRef.current||focusedIdRef.current;
    if(!id||!liveRef.current[id]) return;
    if(specificNum!=null){
      const _tk=tablesElsewhere(liveRef.current,id)[Number(specificNum)];
      if(_tk!=null){alert('Table '+specificNum+' is in use by '+_tk+'. Pick another table.');return;}
    }
    // Atomic: re-checks against every live event inside the single state update
    setLive(prev=>{
      const t=prev[id]; if(!t) return prev;
      const tableNumbers=getTableNumbers(t);
      if(tableNumbers.length>=15) return prev;
      const taken=tablesElsewhere(prev,id);
      let newTableNum;
      if(specificNum!=null){
        const n=Number(specificNum);
        if(!n||n<1||tableNumbers.includes(n)||taken[n]!=null) return prev;
        newTableNum=n;
      } else {
        newTableNum=Math.max.apply(null,tableNumbers)+1;
        while(taken[newTableNum]!=null&&newTableNum<=15) newTableNum++;
        if(newTableNum>15) return prev;
      }
      const newTableNumbers=[...tableNumbers,newTableNum].sort((a,b)=>a-b);
      return {...prev,[id]:{...t,tableNumbers:newTableNumbers,maxTables:newTableNumbers.length,activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'table',detail:`Table ${newTableNum} opened`}]}};
    });
    SoundEngine.register();
  }

  function closeTableConfirm(assignments, closingTable){
    logActivity('table',`Table ${closingTable} closed — ${Object.keys(assignments).length} players reassigned`);
    setTournament(t=>{
      const tableNumbers=getTableNumbers(t);
      if(tableNumbers.length<=1)return t;
      const newTableNumbers=tableNumbers.filter(n=>n!==closingTable);
      // Move players from closing table to their assigned seats
      let players=[...t.players];
      assignments.forEach(({playerId,tableNum,seatNum})=>{
        players=players.map(p=>p.id===playerId?{...p,tableNum,seatNum}:p);
      });
      return{...t,tableNumbers:newTableNumbers,maxTables:newTableNumbers.length,players};
    });
  }

  function redrawSeats(){
    setTournament(t=>{
      const active=t.players.filter(p=>p.status==='active');
      const sp=t.seatsPerTable||9;
      // Build all available seat positions
      const seats=[];
      getTableNumbers(t).forEach(tNum=>{ for(let s=1;s<=sp;s++) seats.push({tableNum:tNum,seatNum:s}); });
      // Fisher-Yates shuffle
      for(let i=seats.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[seats[i],seats[j]]=[seats[j],seats[i]];}
      const reassigned=active.map((p,i)=>({...p,...(seats[i]||{tableNum:null,seatNum:null})}));
      const ids=new Set(reassigned.map(p=>p.id));
      return{...t,players:[...reassigned,...t.players.filter(p=>!ids.has(p.id))]};
    });
  }
  // Applies an already-computed final-table redraw (assignments from computeFinalTableRedraw, shared
  // with the floor UI in 02_utils.js). Never recomputes the draw itself - a second random shuffle
  // would disagree with whatever was already shown in a preview (desktop's own confirm, or the floor's
  // preview screen before it dispatched this). Closes every other table down to just the destination.
  function applyFinalTableRedraw(destTable,assignments){
    setTournament(t=>{
      const byId={};assignments.forEach(a=>{byId[a.playerId]={tableNum:a.tableNum,seatNum:a.seatNum};});
      const players=t.players.map(p=>byId[p.id]?{...p,...byId[p.id]}:p);
      return{...t,tableNumbers:[destTable],maxTables:1,players,
        activityLog:[...(t.activityLog||[]),{ts:Date.now(),type:'redraw-final',detail:`Final table redrawn - ${assignments.length} players seated at Table ${destTable}`}]};
    });
  }
  // Desktop entry point: compute the draw, confirm with the TD, then apply. Destination table is the
  // lowest-numbered table that currently has an active player on it (not just the lowest in the
  // configured 1..15 range, which may include tables closed long ago).
  function redrawFinalTable(){
    const active=tournament.players.filter(p=>p.status==='active');
    if(active.length===0){alert('No active players to redraw.');return;}
    const occupied=[...new Set(active.map(p=>p.tableNum).filter(Boolean))].sort((a,b)=>a-b);
    const destTable=occupied.length?occupied[0]:getTableNumbers(tournament)[0];
    const result=computeFinalTableRedraw({players:active,destTable,seatsPerTable:tournament.seatsPerTable||9,seatLocks:tournament.seatLocks||{}});
    if(!result.ok){alert(`Cannot redraw — ${result.neededCount} players but only ${result.availableCount} open seats at Table ${destTable}.`);return;}
    if(!confirm(`Redraw ${result.assignments.length} players onto Table ${destTable} as the final table? Every other table closes. This cannot be undone.`))return;
    applyFinalTableRedraw(destTable,result.assignments);
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
  const clockCls=secs<=60?'danger':secs<=300?'warn':'';
  const _rowsNow=Date.now();
  const _regLabels={notOpen:'REG NOT OPEN',open:'REG OPEN',lateGrace:'LATE REG GRACE',lateOver:'LATE REG OVER',closingGrace:'REG CLOSING',closed:'REG CLOSED'};
  const _hm=ms=>new Date(ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false});
  const regBanners=[];
  const liveRows=Object.keys(live).map(id=>{
    const t=live[id];const c=EVENT_CONFIGS[t.eventType]||null;const short=c?c.short:(t.name||'Event');
    const lre=lateRegEndsAtOf(t); const rw=regWindow(t.reg,lre,_rowsNow);
    if(t.reg&&!(c&&c.noEntries)){
      if(rw.state==='open'&&lre!=null&&lre-_rowsNow<=300000) regBanners.push({id:id,kind:'warn',text:short+' late registration ends in '+fmt.time(Math.max(0,Math.ceil((lre-_rowsNow)/1000)))+' (end of Level '+t.reg.lateRegLevel+', +'+t.reg.graceMins+' min)'});
      else if(rw.state==='lateGrace') regBanners.push({id:id,kind:'warn',text:short+' late reg ended '+_hm(rw.lateRegEndedAt)+'. Grace until '+_hm(rw.adviceEndsAt)});
      else if(rw.state==='lateOver') regBanners.push({id:id,kind:'over',text:short+' late reg is over. The counter is still accepting. Press Close to stop.'});
      else if(rw.state==='closingGrace') regBanners.push({id:id,kind:'warn',text:short+' closing. Counter stops at '+_hm(rw.graceEndsAt)});
    }
    return{id:id,short:short,color:c?c.color:'#c8973a',status:t.status,secs:clockRemainingSecs(t,_rowsNow),regState:rw.state,regLabel:_regLabels[rw.state]};
  });

  return(
    <div className="app">
      {regBanners.length>0&&(<div className="reg-banners">{regBanners.map(b=>(<div key={b.id+b.kind} className={'reg-banner '+b.kind}><span>{b.text}</span>{b.kind==='over'&&(<span style={{display:'flex',gap:6}}><button onClick={()=>regAction(b.id,'close')}>Close</button><button onClick={()=>regAction(b.id,'closeNow')}>Close now</button></span>)}</div>))}</div>)}
      {tableOverlaps(live).map((o,i)=>(<div key={'ovl'+i} className="reg-banner warn"><span>{'Table clash: '+o.a+' and '+o.b+' both use table'+(o.tables.length>1?'s ':' ')+formatTableRanges(o.tables)+'. Nothing was changed. Close or move one of those tables.'}</span></div>))}
      {view==='tournament'&&canRebuildInheritance(tournament)&&(<div className="reg-banner warn"><span>Day 2 has not started. If a flight changed, rebuild the survivor list.</span><button style={{marginLeft:10,cursor:'pointer'}} onClick={rebuildInheritance}>Rebuild from flights</button></div>)}
      {Object.keys(saveFailures).length>0&&(<div className="save-banner">{'SAVE FAILED for '+Object.keys(saveFailures).map(id=>{const t=live[id];const c=t?EVENT_CONFIGS[t.eventType]:null;return c?c.short:(t?t.name:id);}).join(', ')+'. Storage may be full. Export backups now.'}</div>)}
      {view==='home'&&<HomeScreen liveRows={liveRows} onFocusLive={resumeTournament} onSelect={t=>{setSelEvent(t);setView('setup');}} savedIndex={savedIndex} onResume={resumeTournament} onDelete={deleteTournament} onExportSave={t=>exportTournament(t,false)} onExportTemplate={t=>exportTournament(t,true)} onImport={handleImportFile}/>}
      {view==='setup'&&<SetupScreen eventType={selEvent} onBack={()=>setView('home')} onStart={startTournament} takenTables={tablesElsewhere(live,null)}/>}
      {view==='tournament'&&tournament&&(()=>{
        const _th=getTheme(tournament.eventType);
        return(<div className="tour-layout" key={tournament.id} style={{'--accent':_th.accent,'--sidebar-bg':_th.sidebarBg,'--active-bg':_th.activeBg,'--active-nav':_th.activeNav}}>
          <Sidebar tournament={tournament} subview={subview} setSubview={setSubview} screens={screens} onScreen={setScreen} mainScreen={{supported:mainScreenSupported,info:mainScreenInfo,url:'http://127.0.0.1:'+((serverInfo&&serverInfo.port)||3456)+'/display?screen=main'}} onReopenMain={reopenMainScreen} liveRows={liveRows} focusedId={focusedId} onFocus={focusEvent} onCloseEvent={closeFocusedEvent}
            onSave={saveTournamentNow}
            onExportSave={exportCurrentSave} onExportTemplate={exportCurrentTemplate}
            onReset={resetTournament}
            onHome={()=>{saveT(tournament);setSavedIndex(getIndex());setView('home');}}/>
          <div className="main">
            {subview==='register'&&<RegisterView tournament={tournament} onRegister={addPlayer} onSetMode={setSeatingMode} onAssignSeat={assignSeat} serverInfo={serverInfo} onRegAction={(type,val)=>regAction(tournament.id,type,val)}/>}
            {subview==='clock'&&<ClockView tournament={tournament} cur={cur} nxt={nxt} activePlayers={activePlayers} bustedPlayers={bustedPlayers} tablesInUse={tablesInUse} secs={secs} clockCls={clockCls} onToggle={toggleClock} onPrev={prevLevel} onNext={nextLevel} onAdjust={adjustTime} totalEntries={tournament.players.length} onUpdateBlinds={updateCurrentBlinds} onRegisterRandom={()=>{const reg=new Set(tournament.players.map(p=>p.name));for(let i=1;i<=700;i++){const n=String(i).padStart(3,'0');if(!reg.has(n)){addPlayer(n);break;}}}} onBustRandom={()=>{const a=tournament.players.filter(p=>p.status==='active');if(a.length)bustPlayer(a[Math.floor(Math.random()*a.length)].id);}}/>}
            {subview==='players'&&<PlayersView tournament={tournament} activePlayers={activePlayers} bustedPlayers={bustedPlayers} onAdd={addPlayer} onAddMany={addPlayers} onBust={bustPlayer} onBustMany={bustManyPlayers} onUndoBust={undoBust} onSwapBust={swapBust} onRemovePhantomBust={removePhantomBust} onRename={updatePlayerName} onRemove={removePlayer} modal={modal} setModal={setModal}/>}
            {subview==='tables'&&<TablesView takenElsewhere={tablesElsewhere(live,focusedId)} tournament={tournament} activePlayers={activePlayers} onBalance={balanceTables} onOpen={openTable} onCloseConfirm={closeTableConfirm} onMove={movePlayerSeat} onRemove={removePlayer} onLock={setSeatLock} onRedraw={redrawSeats} onRedrawFinal={redrawFinalTable} onUpdateChipCount={updateChipCount} onExportSeating={exportSeating}/>}
            {subview==='log'&&<LogView activityLog={tournament.activityLog||[]}/>}
            {subview==='blinds'&&<BlindEditView tournament={tournament} onUpdate={updateBlindLevel} onSetChips={setChipsInPlay} onAppend={appendStructureEntry}/>}
            {subview==='payouts'&&isSatellite(tournament)&&<SatellitePayoutsView tournament={tournament} onUpdate={updatePayoutSettings} onPublish={publishPayouts} onUnpublish={unpublishPayouts}/>}
            {subview==='payouts'&&!isSatellite(tournament)&&<PayoutsView tournament={tournament} activePlayers={activePlayers} onUpdate={updatePayoutSettings} onPublish={publishPayouts} onUnpublish={unpublishPayouts}/>}
            {subview==='poty'&&<POTYView tournament={tournament}/>}
          </div>
        </div>);
      })()}
    </div>
  );
}
