/* ============================================================
   05_home.js
   HomeScreen component — event picker + saved-tournament list
   shown on app launch.
   ============================================================ */

/* ==== HOME ==== */
function HomeScreen({onSelect,savedIndex,onResume,onDelete,onExportSave,onExportTemplate,onImport}) {
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
          <img src={SPC_LOGO} alt="SPC" style={{height:90,objectFit:'contain',opacity:.85,marginTop:4}}/>
        </div>
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
