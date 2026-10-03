/* ============================================================
   06_sidebar.js
   Sidebar component — navigation between Register/Clock/Players/
   Tables/Payouts/Blinds/Log/POTY subviews during a running event.
   ============================================================ */

function Sidebar({tournament,subview,setSubview,onSave,onExportSave,onExportTemplate,onReset,onHome,onFloor,liveRows,focusedId,onFocus,onCloseEvent,screens,onScreen}) {
  const _cfg=EVENT_CONFIGS[tournament.eventType]||null;
  const nav=[{key:'register',label:'Register',icon:'⊕'},{key:'clock',label:'Clock',icon:'⏱'},{key:'players',label:'Players',icon:'👥'},{key:'tables',label:'Tables',icon:'⬡'},{key:'payouts',label:'Payouts',icon:'S$'},{key:'blinds',label:'Blinds',icon:'♠'},{key:'log',label:'Log',icon:'📋'},{key:'poty',label:'POTY',icon:'🏆'}];
  const status=tournament.status;
  return(
    <div className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-label">{_cfg?_cfg.group:'SPC Director'}</div>
        {_cfg&&_cfg.subtitle&&<div style={{fontSize:14,color:'#b2d4ba',letterSpacing:1.5,marginTop:3,textTransform:'uppercase',fontWeight:500}}>{_cfg.subtitle}</div>}
        <div className={`brand-status ${status}`} style={{marginTop:4}}>{status.toUpperCase()}</div>
      </div>
      {liveRows&&liveRows.length>0&&(
        <div className="lv-switch">
          {liveRows.map(r=>(
            <button key={r.id} className={'lv-row'+(r.id===focusedId?' active':'')} onClick={()=>onFocus(r.id)}>
              <span className="lv-bar" style={{background:r.color}}></span>
              <span className="lv-main"><span className="lv-short">{r.short}</span><span className={'lv-status '+r.status}>{r.status.toUpperCase()}</span><span className={'lv-reg '+r.regState}>{r.regLabel}</span></span>
              <span className="lv-clock">{fmt.time(r.secs)}</span>
            </button>
          ))}
          <button className="lv-add" onClick={onHome}>+ Add event</button>
        </div>
      )}
      {screens&&<ScreensPanel screens={screens} liveRows={liveRows||[]} onScreen={onScreen}/>}
      <div className="sidebar-nav">
        {nav.map(n=>(
          <button key={n.key} className={`nav-btn ${subview===n.key?'active':''}`} onClick={()=>setSubview(n.key)}>
            <span className="nav-icon">{n.icon}</span>{n.label}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="sf-btn" onClick={onSave}>💾 Save tournament</button>
        <button className="sf-btn" style={{borderColor:'#1a3a22',color:'#3dba6f'}} onClick={onFloor}>📱 Floor staff URL</button>
        <button className="sf-btn" onClick={onExportSave} title="Download full backup as .spc">↓ Export backup</button>
        <button className="sf-btn" onClick={onExportTemplate} title="Download printable tournament report">↓ Tournament report</button>
        <button className="sf-btn" style={{borderColor:'#1a3a22',color:'#7aaa82'}} onClick={()=>{
          const btn=event.target;btn.disabled=true;btn.textContent='Checking...';
          if(window.electronAPI&&window.electronAPI.checkForUpdates){
            window.electronAPI.checkForUpdates().then(r=>{
              if(r.success){if(confirm('Updated: '+r.files.join(', ')+'. Restart now?')){window.electronAPI.restartApp();}else{btn.textContent='🔄 Check for updates';btn.disabled=false;}}
              else{alert('Update failed: '+(r.error||'Unknown error'));btn.textContent='🔄 Check for updates';btn.disabled=false;}
            }).catch(e=>{alert('Update error: '+e.message);btn.textContent='🔄 Check for updates';btn.disabled=false;});
          }else{btn.textContent='🔄 Check for updates';btn.disabled=false;}
        }}>🔄 Check for updates</button>
        <button className="sf-btn" onClick={onCloseEvent} title="Save this event and remove it from the live set">Close event (keep saved)</button>
        <button className="sf-btn" onClick={onHome}>← Back to home</button>
        <button className="sf-btn" style={{borderColor:'#3a2020',color:'#8a4040',marginTop:4}} onClick={onReset}
          onMouseEnter={e=>{e.target.style.borderColor='#e05a5a';e.target.style.color='#e05a5a';}}
          onMouseLeave={e=>{e.target.style.borderColor='#3a2020';e.target.style.color='#8a4040';}}>
          ↺ Reset event
        </button>
      </div>
    </div>
  );
}

/* Which live event(s) each venue screen shows. Pinned here; they never follow the desk's focus. */
function ScreensPanel({screens,liveRows,onScreen}) {
  const labels={main:'Main screen',side:'Side screen'};
  const opts=liveRows.map(r=>(<option key={r.id} value={r.id}>{r.short}</option>));
  function modeOf(sc){return sc.layout==='logo'?'logo':sc.layout==='split'?'split':(sc.events[0]||'logo');}
  function onMode(which,sc,v){
    if(v==='logo') onScreen(which,'logo',[]);
    else if(v==='split') onScreen(which,'split',[sc.events[0]||'',sc.events[1]||'']);
    else onScreen(which,'single',[v]);
  }
  return(
    <div className="sc-panel">
      <div className="sc-title">Screens</div>
      {['main','side'].map(which=>{
        const sc=screens[which];
        const liveIds=liveRows.map(r=>r.id);
        const gone=sc.events.map((id,i)=>({id,name:sc.names[i]})).filter(x=>x.id&&liveIds.indexOf(x.id)<0);
        const shown=sc.events.map(id=>{const r=liveRows.find(x=>x.id===id);return r?r.short:null;}).filter(Boolean);
        return(
          <div key={which} className="sc-row">
            <div className="sc-lbl">{labels[which]}</div>
            <select className="sc-sel" value={modeOf(sc)} onChange={e=>onMode(which,sc,e.target.value)}>
              <option value="logo">Logo</option>
              {opts}
              <option value="split">Split...</option>
            </select>
            {sc.layout==='split'&&(
              <div className="sc-split">
                {[0,1].map(i=>(
                  <select key={i} className="sc-sel" value={sc.events[i]||''} onChange={e=>{const ev=[sc.events[0]||'',sc.events[1]||''];ev[i]=e.target.value;onScreen(which,'split',ev);}}>
                    <option value="">(choose)</option>
                    {opts}
                  </select>
                ))}
              </div>
            )}
            {gone.length>0
              ?<div className="sc-warn">{labels[which]}: {gone.map(x=>x.name||'event').join(', ')} closed. Choose an event.</div>
              :<div className="sc-state">{sc.layout==='logo'?'Showing: logo':'Showing: '+(shown.join(' + ')||'nothing yet')}</div>}
          </div>
        );
      })}
    </div>
  );
}
