/* ============================================================
   06_sidebar.js
   Sidebar component — navigation between Register/Clock/Players/
   Tables/Payouts/Blinds/Log/POTY subviews during a running event.
   ============================================================ */

function Sidebar({tournament,subview,setSubview,onSave,onExportSave,onExportTemplate,onReset,onHome,onFloor}) {
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
