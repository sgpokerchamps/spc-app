/* ============================================================
   05_home.js
   HomeScreen component — event picker + saved-tournament list
   shown on app launch.
   ============================================================ */

/* ==== HOME ==== */
/* Check for updates. Two steps on a current app package: (1) stage = download and check everything, change NOTHING;
   (2) only after you confirm, apply = write the changed files together, then restart. Cancel at the question changes nothing.
   An older app package only has a button that writes files the moment they download, so there we ask FIRST. */
function StorageLine() {
  const [u,setU]=useState(()=>storageUsage());
  useEffect(()=>{ const iv=setInterval(()=>setU(storageUsage()),30000); return()=>clearInterval(iv); },[]);
  const mb=b=>(b/1048576).toFixed(1);
  const sz=b=>b<1048576?Math.max(1,Math.round(b/1024))+' KB':mb(b)+' MB';
  const col=u.pct>80?'#e0594f':u.pct>60?'#e0a43c':'#527a5c';
  return(<div style={{fontSize:11,color:col,textAlign:'right',maxWidth:260}}>
    <div>{'Storage: '+sz(u.total)+' of '+mb(u.cap)+' MB ('+(u.pct<1?u.pct.toFixed(1):Math.round(u.pct))+'%)'}</div>
    {u.pct>60&&<div style={{marginTop:3}}>Largest saved tournaments:{u.top.map(t=>(<div key={t.key}>{t.name+' '+sz(t.bytes)}</div>))}<div style={{marginTop:3}}>Delete old tournaments from the list below to free space.</div></div>}
  </div>);
}
function UpdateButton() {
  const [busy,setBusy]=useState('');
  const api=typeof window.electronAPI!=='undefined'?window.electronAPI:null;
  const newApi=!!(api&&api.stageUpdate&&api.applyUpdate);
  const oldApi=!!(api&&api.checkForUpdates);
  async function check(){
    if(busy||!(newApi||oldApi)) return;
    if(newApi){
      setBusy('Checking...');
      try{
        const r=await api.stageUpdate();
        if(!r.success){ alert('Update check failed: '+(r.error||'Unknown error')+'\n\nNothing was changed.'); return; }
        if(!r.changed.length){ alert('Already up to date ('+r.ref+'). Nothing was changed.'); return; }
        const list=r.changed.slice(0,10).join(', ')+(r.changed.length>10?', ...':'');
        if(!confirm('Update available ('+r.ref+'): '+r.changed.length+' of '+r.total+' files change:\n'+list+'\n\nNothing has been changed yet. Apply the update and restart now?')) return;
        setBusy('Applying...');
        const a=await api.applyUpdate();
        if(!a.success){ alert('Update failed: '+(a.error||'Unknown error')+'\n\nThe existing files were left as they were.'); return; }
        api.restartApp();
      }catch(e){ alert('Update error: '+e.message+'\n\nNothing was changed.'); }
      finally{ setBusy(''); }
    } else {
      if(!confirm('This app version applies an update the moment it downloads it, and "Cancel" later does not undo it. Check for updates and apply now?')) return;
      setBusy('Checking...');
      try{
        const r=await api.checkForUpdates();
        if(r.success){ if(confirm('Updated: '+r.files.join(', ')+'. Restart now?')) api.restartApp(); }
        else alert('Update failed: '+(r.error||'Unknown error'));
      }catch(e){ alert('Update error: '+e.message); }
      finally{ setBusy(''); }
    }
  }
  if(!(newApi||oldApi)) return null;
  return <button className="home-update" onClick={check} disabled={!!busy}>{busy||'Check for updates'}</button>;
}

function HomeScreen({onSelect,savedIndex,onResume,onDelete,onExportSave,onExportTemplate,onImport,liveRows,onFocusLive}) {
  const others=[
    {key:'miniRoller',    suit:'♥',color:'#3dba6f',sub:'40-min levels · 27 levels'},
    {key:'mysteryBounty', suit:'◆',color:'#9b7bce',sub:'20-min levels · 18 levels'},
    {key:'satellite',     suit:'♣',color:'#4fa8d4',sub:'10-min levels · 12 levels · No antes'},
  ];
  const flights=[
    {key:'me_1a',label:'Flight 1A',mins:'40 min'},
    {key:'me_1b',label:'Flight 1B',mins:'30 min'},
    {key:'me_1c',label:'Flight 1C',mins:'25 min'},
    {key:'me_1d',label:'Flight 1D',mins:'10 min'},
    {key:'me_d2',label:'Day 2',    mins:'30 min · Lvl 13–32'},
  ];
  return(
    <div className="home">
      <div className="home-inner">
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:0}}>
          <div>
            <div className="home-brand">Singapore Poker Championships</div>
            <div className="home-title">Tournament Director</div>
          </div>
          <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:10}}>
            <img src={SPC_LOGO} alt="SPC" style={{height:90,objectFit:'contain',opacity:.85,marginTop:4}}/>
            <UpdateButton/>
            <StorageLine/>
            <button className="home-update" onClick={changeStaffPw} title="Clears the saved staff password and asks again">Change staff password</button>
          </div>
        </div>
        {liveRows&&liveRows.length>0&&(
          <div className="lv-strip">
            <div className="home-section">Running now</div>
            <div className="lv-strip-row">
              {liveRows.map(r=>(
                <button key={r.id} className="lv-strip-btn" style={{'--ac':r.color}} onClick={()=>onFocusLive(r.id)}>
                  <span className="lv-short" style={{color:r.color}}>{r.short}</span>
                  <span className="lv-clock">{fmt.time(r.secs)}</span>
                  <span className={'lv-status '+r.status}>{r.status.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {/* ME */}
        <div className="home-section">Main Event</div>
        <div className="event-grid" style={{marginBottom:12}}>
          {flights.slice(0,3).map(f=>(
            <div key={f.key} className="event-card" style={{'--ac':'#c8973a'}} onClick={()=>onSelect(f.key)}>
              <span className="ev-suit" style={{color:'#c8973a'}}>♠</span>
              <div className="ev-name">{f.label}</div>
              <div className="ev-sub">{f.mins} · Levels 1–12</div>
              <div className="ev-meta">Buy-in <strong>S$600</strong> · Stack <strong>25,000</strong></div>
            </div>
          ))}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:28}}>
          <div className="event-card" style={{'--ac':'#c8973a'}} onClick={()=>onSelect('me_1d')}>
            <span className="ev-suit" style={{color:'#c8973a'}}>♠</span>
            <div className="ev-name">Flight 1D</div>
            <div className="ev-sub">10 min · Levels 1–12</div>
            <div className="ev-meta">Buy-in <strong>S$600</strong> · Stack <strong>25,000</strong></div>
          </div>
          <div className="event-card" style={{'--ac':'#c8973a'}} onClick={()=>onSelect('me_d2')}>
            <span className="ev-suit" style={{color:'#c8973a'}}>♠</span>
            <div className="ev-name">Day 2</div>
            <div className="ev-sub">30 min · Levels 13–32</div>
            <div className="ev-meta">Survivors carry forward</div>
          </div>
          <div style={{background:'transparent',border:'none'}}></div>
        </div>
        {/* Other events */}
        <div className="home-section">Other events</div>
        <div className="event-grid" style={{marginBottom:28}}>
          {others.map(ev=>{
            const cfg=EVENT_CONFIGS[ev.key];
            return(
              <div key={ev.key} className="event-card" style={{'--ac':ev.color}} onClick={()=>onSelect(ev.key)}>
                <span className="ev-suit">{ev.suit}</span>
                <div className="ev-name">{cfg.name}</div>
                <div className="ev-sub">{ev.sub}</div>
                <div className="ev-meta">Buy-in <strong>{fmt.currency(cfg.buyin)}</strong> · Prize component <strong>{fmt.currency(cfg.prizeComponent)}</strong></div>
              </div>
            );
          })}
        </div>
        {/* Saved */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
          <div className="home-section" style={{margin:0}}>Saved tournaments</div>
          <div className="io-bar" style={{margin:0}}>
            <label className="io-btn import" title="Import a saved tournament or template (.json)">
              <input type="file" accept=".spc,.json" style={{display:'none'}} onChange={e=>{if(e.target.files[0]){onImport(e.target.files[0]);e.target.value='';}}}/>
              ↑ Load backup
            </label>
          </div>
        </div>
        {savedIndex.length===0
          ?<div className="empty-saved">No saved tournaments yet.</div>
          :<div className="saved-list">
            {savedIndex.map(s=>{
              const cfg=EVENT_CONFIGS[s.eventType]||{suit:'?',color:'#527a5c',short:s.eventType};
              return(
                <div key={s.id} className="saved-item" style={{'--ac':cfg.color}}>
                  <span className="saved-suit">{cfg.suit}</span>
                  <div className="saved-info">
                    <div className="saved-name">{s.name}</div>
                    <div className="saved-meta">{cfg.short||s.eventType} · {s.status} · {fmt.ago(s.modified)}</div>
                  </div>
                  <div className="saved-actions">
                    <button className="resume-btn" onClick={()=>onResume(s.id)}>Resume</button>
                    <button className="export-btn-sm" title="Download backup (.spc)" onClick={()=>{const t=loadT(s.id);if(t)onExportSave(t);}}>↓ Backup</button>
                    <button className="export-btn-sm" title="Download tournament report" onClick={()=>{const t=loadT(s.id);if(t)onExportTemplate(t);}}>↓ Report</button>
                    <button className="del-btn" onClick={()=>{if(confirm('Delete this tournament?'))onDelete(s.id);}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        }
      </div>
    </div>
  );
}
