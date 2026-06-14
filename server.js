/**
 * SPC Floor Server - pure Node.js built-ins
 */
const http = require('http');
const url = require('url');

let httpServer = null;
let currentState = null;
let floorActionCallback = null;

const CLOSE_TABLE_JS = `
var closeTableMode=null;
function startCloseTable(){
  if(!lastState||!lastState.tournament||!modalTable)return;
  var tm=lastState.tournament.tableMap||[];
  var tbl=null;
  for(var i=0;i<tm.length;i++)if(tm[i].num===modalTable){tbl=tm[i];break;}
  if(!tbl)return;
  var displaced=tbl.players||[];
  var otherCap=0;
  for(var i=0;i<tm.length;i++)if(tm[i].num!==modalTable)otherCap+=(tm[i].capacity-tm[i].count);
  if(otherCap<displaced.length){alert("Not enough seats: "+otherCap+" available, "+displaced.length+" need reseating.");return;}
  var assignments={};
  displaced.forEach(function(p){assignments[p.id]={tableNum:"",seatNum:""};});
  closeTableMode={closingTable:modalTable,displaced:displaced,assignments:assignments};
  document.getElementById("modal-title").textContent="Closing T"+modalTable;
  var ctb=document.getElementById("ct-btn");if(ctb)ctb.style.display="none";
  renderCloseTableContent();
}
function cancelCloseTable(){
  closeTableMode=null;
  document.getElementById("modal-title").textContent="Table "+modalTable;
  var ctb=document.getElementById("ct-btn");if(ctb)ctb.style.display="block";
  renderModalContent();
}
function setCTA(pid,field,val){
  if(!closeTableMode)return;
  var a=closeTableMode.assignments[pid]||{tableNum:"",seatNum:""};
  if(field==="tableNum"){
    closeTableMode.assignments[pid]={tableNum:val,seatNum:""};
    updateSeatDropdown(pid);
  } else {
    closeTableMode.assignments[pid]={tableNum:a.tableNum,seatNum:val};
  }
}
function updateSeatDropdown(pid){
  var el=document.getElementById("ct-seat-"+pid);
  if(!el)return;
  var a=closeTableMode.assignments[pid]||{tableNum:"",seatNum:""};
  var seats=a.tableNum?getEmptySeats(parseInt(a.tableNum)):[];
  var h="<option value=''>-- Seat --</option>";
  for(var k=0;k<seats.length;k++)h+="<option value='"+seats[k]+"'>Seat "+seats[k]+"</option>";
  el.innerHTML=h;
  el.disabled=!a.tableNum;
}
function getEmptySeats(targetTableNum){
  if(!lastState||!lastState.tournament||!targetTableNum||!closeTableMode)return[];
  var tm=lastState.tournament.tableMap||[];
  var tbl=null;
  for(var i=0;i<tm.length;i++)if(tm[i].num===targetTableNum){tbl=tm[i];break;}
  if(!tbl)return[];
  var cap=tbl.capacity||9;
  var occupied=new Set();
  for(var i=0;i<tbl.players.length;i++){
    var isDisplaced=false;
    for(var j=0;j<closeTableMode.displaced.length;j++)if(closeTableMode.displaced[j].id===tbl.players[i].id)isDisplaced=true;
    if(!isDisplaced)occupied.add(tbl.players[i].seatNum);
  }
  var assigned=new Set();
  var keys=Object.keys(closeTableMode.assignments);
  for(var i=0;i<keys.length;i++){
    var aa=closeTableMode.assignments[keys[i]];
    if(aa.tableNum===String(targetTableNum)&&aa.seatNum)assigned.add(parseInt(aa.seatNum));
  }
  var seats=[];
  for(var s=1;s<=cap;s++)if(!occupied.has(s)&&!assigned.has(s))seats.push(s);
  return seats;
}
function confirmCloseTable(){
  if(!closeTableMode)return;
  var d=closeTableMode.displaced;
  for(var i=0;i<d.length;i++){
    var a=closeTableMode.assignments[d[i].id];
    if(!a||!a.tableNum||!a.seatNum){alert("Assign table and seat for "+d[i].name+".");return;}
  }
  var assignments=d.map(function(p){
    var a=closeTableMode.assignments[p.id];
    return{playerId:p.id,tableNum:parseInt(a.tableNum),seatNum:parseInt(a.seatNum)};
  });
  sendAction({type:"close-table-confirm",closingTable:closeTableMode.closingTable,assignments:assignments})
    .then(function(){showToast("Table "+closeTableMode.closingTable+" closed","warn");closeTableMode=null;closeModal();});
}
function renderCloseTableContent(){
  if(!closeTableMode||!lastState||!lastState.tournament)return;
  var tm=lastState.tournament.tableMap||[];
  var otherTables=[];
  for(var i=0;i<tm.length;i++)if(tm[i].num!==closeTableMode.closingTable)otherTables.push(tm[i]);
  var d=closeTableMode.displaced;
  var h="<div>";
  if(d.length===0){
    h+="<div style='font-size:13px;color:#3dba6f;margin-bottom:14px'>Table is empty - safe to close.</div>";
  } else {
    for(var i=0;i<d.length;i++){
      var p=d[i];
      var a=closeTableMode.assignments[p.id]||{tableNum:"",seatNum:""};
      var seats=a.tableNum?getEmptySeats(parseInt(a.tableNum)):[];
      h+="<div style='margin-bottom:10px;padding:12px;background:#0b1610;border-radius:8px'>";
      h+="<div style='font-size:14px;color:#e8d8a0;font-weight:600;margin-bottom:8px'>"+p.name+"</div>";
      h+="<div style='display:flex;gap:8px'>";
      h+="<select style='flex:1;padding:10px 6px;background:#060e09;border:1px solid #2a1c06;border-radius:6px;color:#b2d4ba;font-size:14px;outline:none;-webkit-appearance:auto' onchange=\\"setCTA('"+p.id+"','tableNum',this.value)\\">";
      h+="<option value=''>-- Table --</option>";
      for(var j=0;j<otherTables.length;j++){
        var t=otherTables[j];
        h+="<option value='"+t.num+"'"+(a.tableNum==String(t.num)?" selected":"")+">T"+t.num+" ("+t.count+"/"+t.capacity+")</option>";
      }
      h+="</select>";
      h+="<select id='ct-seat-"+p.id+"' style='flex:1;padding:10px 6px;background:#060e09;border:1px solid #2a1c06;border-radius:6px;color:#b2d4ba;font-size:14px;outline:none;-webkit-appearance:auto' onchange=\\"setCTA('"+p.id+"','seatNum',this.value)\\""+(a.tableNum?"":" disabled")+">";
      h+="<option value=''>-- Seat --</option>";
      for(var k=0;k<seats.length;k++)h+="<option value='"+seats[k]+"'"+(a.seatNum==String(seats[k])?" selected":"")+">Seat "+seats[k]+"</option>";
      h+="</select>";
      h+="</div></div>";
    }
  }
  h+="<div style='display:flex;gap:8px;margin-top:6px'>";
  h+="<button style='flex:1;padding:14px;background:#3dba6f;border:none;border-radius:10px;color:#04080a;font-size:15px;font-weight:700;cursor:pointer' onclick='confirmCloseTable()'>Confirm close</button>";
  h+="<button style='padding:14px 18px;background:transparent;border:1px solid #3a2020;border-radius:10px;color:#8a4040;font-size:15px;font-weight:600;cursor:pointer' onclick='cancelCloseTable()'>Cancel</button>";
  h+="</div></div>";
  document.getElementById("modal-content").innerHTML=h;
}

function lockToggle(t,s,c){
  var types=["none","move","reg","all"];
  var lk=getLock(t,s);
  lockSeat(t,s,lk===types[c]?"none":types[c]);
}
var shotTimer=null;var shotSeconds=30;
function toggleShotClock(){
  if(shotTimer){stopShotClock();return;}
  shotSeconds=30;
  document.getElementById("shot-overlay").style.display="flex";
  document.getElementById("shot-display").textContent=shotSeconds;
  document.getElementById("shot-btn").className="shot-btn active";
  document.getElementById("shot-btn").textContent=shotSeconds;
  shotTimer=setInterval(function(){
    shotSeconds--;
    document.getElementById("shot-display").textContent=shotSeconds;
    document.getElementById("shot-btn").textContent=shotSeconds;
    if(shotSeconds<=5)document.getElementById("shot-display").style.color="#ff0000";
    if(shotSeconds<=0){
      clearInterval(shotTimer);shotTimer=null;
      document.getElementById("shot-display").textContent="TIME";
      document.getElementById("shot-display").style.color="#ff0000";
      document.getElementById("shot-btn").textContent="TIME";
      try{navigator.vibrate&&navigator.vibrate([200,100,200]);}catch(e){}
      setTimeout(function(){stopShotClock();},3000);
    }
  },1000);
}
function stopShotClock(){
  if(shotTimer){clearInterval(shotTimer);shotTimer=null;}
  document.getElementById("shot-overlay").style.display="none";
  document.getElementById("shot-display").style.color="#ff4040";
  document.getElementById("shot-btn").className="shot-btn";
  document.getElementById("shot-btn").innerHTML="SHOT<br>CLOCK";
}

function searchPlayer(q){
  var results=document.getElementById("search-results");
  var map=document.getElementById("table-map");
  if(!q||q.length<1||!lastState||!lastState.tournament){results.style.display="none";map.style.display="";return;}
  var tm=lastState.tournament.tableMap||[];
  var matches=[];
  var ql=q.toLowerCase();
  for(var i=0;i<tm.length;i++){
    var t=tm[i];
    for(var j=0;j<t.players.length;j++){
      var p=t.players[j];
      if(p.name.toLowerCase().indexOf(ql)>=0){
        matches.push({name:p.name,tableNum:t.num,seatNum:p.seatNum});
      }
    }
  }
  if(matches.length===0){results.style.display="block";results.innerHTML='<div style="padding:16px;text-align:center;color:#3a5a42">No matches</div>';map.style.display="none";return;}
  var html="";
  matches.forEach(function(p){html+='<div class="search-result"><span class="search-result-name">'+p.name+'</span><span class="search-result-seat">T'+p.tableNum+' S'+p.seatNum+'</span></div>';});
  results.innerHTML=html;results.style.display="block";map.style.display="none";
}

function lockBtns(tNum,sNum){
  var lk=getLock(tNum,sNum);
  return '<div class="seat-actions-m">'
    +'<button class="sa-btn sa-lock'+(lk==="move"?" active":"")+'" onclick="event.stopPropagation();lockToggle('+tNum+','+sNum+',1)">Lock moves</button>'
    +'<button class="sa-btn sa-lock'+(lk==="reg"?" active":"")+'" onclick="event.stopPropagation();lockToggle('+tNum+','+sNum+',2)">Lock reg</button>'
    +'<button class="sa-btn sa-lock'+(lk==="all"?" active":"")+'" onclick="event.stopPropagation();lockToggle('+tNum+','+sNum+',3)">Lock all</button>'
    +(lk?'<button class="sa-btn sa-lock" onclick="event.stopPropagation();lockToggle('+tNum+','+sNum+',0)">Unlock</button>':'')
    +'</div>';
}

`;

const COUNTER_SUGGEST_JS = `
function showSuggest(q){
  var sl=document.getElementById("suggest-list");
  if(!q||q.length<1||!memberList.length){sl.className="suggest-list";return;}
  var ql=q.toLowerCase();
  var matches=memberList.filter(function(m){return m.name.toLowerCase().indexOf(ql)>=0;}).slice(0,8);
  if(!matches.length){sl.className="suggest-list";return;}
  sl.innerHTML=matches.map(function(m){
    return '<div class="suggest-item" onmousedown="selectSuggest(this)" data-name="'+m.name.replace(/"/g,'')+'">'+m.name+'<span class="suggest-id">'+m.id+'</span></div>';
  }).join("");
  sl.className="suggest-list show";
}
function selectSuggest(el){
  var name=el.getAttribute("data-name");
  scanInput.value=name;
  document.getElementById("suggest-list").className="suggest-list";
  doScan();
}
`;




function getFloorHTML() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><meta name="apple-mobile-web-app-capable" content="yes"><title>SPC Floor</title><style>*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}html,body{background:#06090a;color:#e4f0e8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow-x:hidden;min-height:100vh}.header{background:#08120a;border-bottom:1px solid #152018;padding:12px 16px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}.brand{font-size:13px;font-weight:700;letter-spacing:2px;color:#3dba6f;text-transform:uppercase}.conn-dot{width:8px;height:8px;border-radius:50%;background:#e05a5a;transition:.3s}.conn-dot.connected{background:#3dba6f}.move-banner{background:#1a1004;border-bottom:1px solid #2a1c06;padding:10px 16px;display:flex;align-items:center;gap:10px}.move-banner-text{font-size:13px;color:#e8d8a0;font-weight:600;flex:1}.move-cancel{padding:6px 12px;background:transparent;border:1px solid #3a2020;color:#8a4040;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600}.clock-bar{background:#0b1610;border-bottom:1px solid #152018;padding:12px 16px;text-align:center}.clock-event{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c8973a;margin-bottom:2px}.clock-level{font-size:11px;letter-spacing:2px;color:rgba(255,255,255,.5);text-transform:uppercase;margin-bottom:5px}.clock-time{font-size:48px;font-weight:700;letter-spacing:-1px;line-height:1;color:#e4f0e8;font-variant-numeric:tabular-nums}.clock-time.warn{color:#c8973a}.clock-time.danger{color:#e05a5a}.clock-blinds{display:flex;justify-content:center;gap:18px;margin-top:7px}.blind-item{text-align:center}.blind-lbl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.3);margin-bottom:2px}.blind-val{font-size:16px;font-weight:700;color:#e4f0e8}.stats-row{display:flex;border-bottom:1px solid #152018}.stat{flex:1;padding:9px 6px;text-align:center;border-right:1px solid #152018}.stat:last-child{border-right:none}.stat-lbl{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:2px}.stat-val{font-size:17px;font-weight:700;color:#e4f0e8}.stat-val.green{color:#3dba6f}.reentry-bar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid #152018;font-size:11px}.reentry-bar.open{background:#0a1f0d}.reentry-bar.closed{background:#1a0a0a}.reentry-label{font-weight:700}.reentry-bar.open .reentry-label{color:#3dba6f}.reentry-bar.closed .reentry-label{color:#e05a5a}.reentry-desc{color:rgba(255,255,255,.4);font-size:10px}.section{padding:12px 16px}.section-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.section-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.3);font-weight:600}.section-action{padding:5px 11px;background:transparent;border:1px solid #1a2e22;color:#3dba6f;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer}.act-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.act-btn{padding:14px;border-radius:10px;font-size:14px;font-weight:700;border:none;cursor:pointer}.register-btn{background:#3dba6f;color:#04080a}.bust-btn{background:#c8302a;color:#fff}.undo-btn{background:#1a3a22;color:#3dba6f;border:1px solid #2a5a32;font-size:13px;padding:10px}.undo-bust-btn{background:#2a1010;color:#e05a5a;border:1px solid #4a1a1a;font-size:13px;padding:10px}.clock-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}.clk-btn{padding:12px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;background:#0d1a0f;border:1px solid #1a2e22;color:#b2d4ba}.clk-btn.play-pause{grid-column:span 2;background:#3dba6f20;border-color:#3dba6f50;color:#3dba6f;font-size:15px;padding:14px}.clk-btn.play-pause.running{background:#c8302a20;border-color:#c8302a50;color:#e05a5a}.unseated-section{background:#0f0c04;border-top:1px solid #2a1c06;border-bottom:1px solid #2a1c06;padding:12px 16px}.unseated-title{font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c8973a;margin-bottom:8px;font-weight:600}.unseated-row{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #1a1204}.unseated-row:last-child{border-bottom:none}.unseated-name{flex:1;font-size:14px;color:#e8d8a0;font-weight:500}.assign-btn{padding:6px 14px;border:1px solid #2a1c06;border-radius:6px;background:transparent;color:#c8973a;font-size:12px;font-weight:600;cursor:pointer}.table-map{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:0 16px 16px}.table-card{background:#0b1610;border:1px solid #1a2e22;border-radius:8px;padding:8px;text-align:center;cursor:pointer;transition:.15s}.table-card:active{transform:scale(.96)}.table-card.full{border-color:#3a1a1a}.table-card.dest{border-color:#3dba6f;background:#0d1f12}.table-num{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#527a5c;margin-bottom:3px}.table-count{font-size:18px;font-weight:700;color:#b2d4ba}.table-count.full{color:#e05a5a}.table-cap{font-size:10px;color:#3a5a42}.table-bar{height:3px;background:#152018;border-radius:2px;margin-top:5px;overflow:hidden}.table-bar-fill{height:100%;background:#3dba6f;border-radius:2px}.table-bar-fill.near{background:#c8973a}.table-bar-fill.full{background:#e05a5a}.divider{height:1px;background:#152018;margin:0 16px}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#3dba6f;color:#04080a;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;opacity:0;transition:.3s;pointer-events:none;z-index:9999;white-space:nowrap}.toast.show{opacity:1}.toast.error{background:#e05a5a;color:#fff}.toast.warn{background:#c8973a;color:#0a0a0a}.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:1000;display:none;flex-direction:column}.modal-bg.show{display:flex}.modal-header{background:#08120a;border-bottom:1px solid #152018;padding:12px 16px;display:flex;align-items:center;gap:14px}.modal-back{background:transparent;border:none;color:#3dba6f;font-size:22px;cursor:pointer;padding:0}.modal-title{font-size:16px;font-weight:700;color:#e4f0e8;flex:1}.modal-content{flex:1;overflow-y:auto;padding:14px}.seat-list{display:flex;flex-direction:column;gap:4px}.seat-row-m{background:#0b1610;border:1px solid #1a2e22;border-radius:8px;padding:12px 14px;cursor:pointer;transition:.12s}.seat-row-m.empty-seat{background:#060e09;border-style:dashed;opacity:.7}.seat-row-m.dest-seat{border-color:#3dba6f;background:#0d1f12;opacity:1}.seat-row-m.selected-seat{border-color:#c8973a;background:#1a1004}.seat-row-m.locked-seat{border-left:3px solid #c85a5a}.seat-top{display:flex;align-items:center;gap:8px}.seat-n-m{font-size:11px;color:#527a5c;width:20px;font-weight:700}.seat-name-m{flex:1;font-size:14px;color:#e4f0e8;font-weight:500}.seat-empty-m{flex:1;font-size:13px;color:#3a5a42;font-style:italic}.lock-badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;letter-spacing:.5px}.lock-badge.lm{background:#1a1004;color:#c8973a;border:1px solid #2a1c06}.lock-badge.lr{background:#0a1020;color:#5a8ac8;border:1px solid #1a2a4a}.lock-badge.la{background:#1a0a0a;color:#c85a5a;border:1px solid #3a1a1a}.seat-actions-m{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}.sa-btn{flex:1;min-width:70px;padding:9px 6px;border:none;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;text-align:center}.sa-bust{background:#c8302a;color:#fff}.sa-move{background:#c8973a;color:#0a0a0a}.sa-lock{background:#0d1a0f;color:#b2d4ba;border:1px solid #1a2e22;font-size:11px;min-width:60px;flex:0}.sa-lock.active{background:#1a0a0a;color:#c85a5a;border-color:#3a1a1a}.seat-mode-bar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid #152018;background:#08120a}.seat-mode-label{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.4);font-weight:600}.seat-mode-btns{display:flex;border-radius:6px;overflow:hidden;border:1px solid #1a2e22}.seat-mode-btn{padding:6px 14px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:#0d1a0f;color:#527a5c;transition:.15s}.seat-mode-btn.active{background:#3dba6f;color:#04080a}.shot-clock{position:fixed;bottom:80px;right:16px;z-index:200}.shot-btn{width:56px;height:56px;border-radius:50%;border:2px solid #c8973a;background:#1a1004;color:#c8973a;font-size:11px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;text-align:center;line-height:1.1;box-shadow:0 4px 16px rgba(0,0,0,.5)}.shot-btn.active{border-color:#ff4040;background:#1a0808;color:#ff4040;font-size:22px}.shot-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:199}.shot-display{font-size:120px;font-weight:700;color:#ff4040;font-family:monospace}.search-bar{display:flex;gap:8px;padding:8px 16px;border-bottom:1px solid #152018;background:#08120a}.search-input{flex:1;padding:8px 12px;background:#060e09;border:1px solid #1a2e22;border-radius:6px;color:#b2d4ba;font-size:14px;outline:none}.search-result{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid #0e1a12}.search-result-name{color:#e4f0e8;font-weight:500;font-size:14px}.search-result-seat{color:#3dba6f;font-weight:700;font-size:15px}</style></head><body><div class="header"><div class="brand">SPC Floor</div><div class="conn-dot" id="dot"></div></div><div class="move-banner" id="move-banner" style="display:none"><span class="move-banner-text" id="move-banner-text"></span><button class="move-cancel" onclick="cancelMove()">Cancel</button></div><div class="clock-bar"><div class="clock-event" id="ev-name">--</div><div class="clock-level" id="cl-level">--</div><div class="clock-time" id="cl-time">--:--</div><div class="clock-blinds" id="cl-blinds"></div></div><div class="stats-row"><div class="stat"><div class="stat-lbl">Players</div><div class="stat-val" id="st-players">-</div></div><div class="stat"><div class="stat-lbl">Tables</div><div class="stat-val" id="st-tables">-</div></div><div class="stat"><div class="stat-lbl">Entries</div><div class="stat-val" id="st-entries">-</div></div><div class="stat"><div class="stat-lbl">Prize pool</div><div class="stat-val green" id="st-prize">-</div></div></div><div class="reentry-bar closed" id="reentry-bar" style="display:none"><span class="reentry-label" id="re-label"></span><span class="reentry-desc" id="re-desc"></span></div><div class="unseated-section" id="unseated-section" style="display:none"><div class="unseated-title" id="unseated-title">Awaiting seats</div><div id="unseated-list"></div></div><div class="seat-mode-bar"><span class="seat-mode-label">Seating</span><div class="seat-mode-btns"><button class="seat-mode-btn" id="mode-auto" onclick="setMode(\'auto\')">Auto</button><button class="seat-mode-btn" id="mode-manual" onclick="setMode(\'manual\')">Manual</button></div></div><div class="section"><div class="section-head"><span class="section-title">Player actions</span></div><div class="act-row"><button class="act-btn register-btn" onclick="act(\'register-next\')">+ Register</button><button class="act-btn bust-btn" onclick="act(\'bust-random\')">Bust out</button></div><div class="act-row"><button class="act-btn undo-btn" onclick="act(\'undo-register\')">Undo register</button><button class="act-btn undo-bust-btn" onclick="act(\'undo-bust\')">Undo bust</button></div></div><div class="divider"></div><div class="section"><div class="section-head"><span class="section-title">Clock control</span></div><div class="clock-btns"><button class="clk-btn play-pause" id="pp-btn" onclick="act(\'clock-toggle\')">Start</button><button class="clk-btn" onclick="clockAct(\'prev\')">Prev level</button><button class="clk-btn" onclick="clockAct(\'next\')">Next level</button><button class="clk-btn" onclick="clockAct(\'minus1\')">- 1 min</button><button class="clk-btn" onclick="clockAct(\'plus1\')">+ 1 min</button></div></div><div class="divider"></div><div class="section"><div class="section-head"><span class="section-title">Table map</span><button class="section-action" onclick="openTable()">+ Open table</button></div></div><div class="search-bar"><input class="search-input" type="text" id="player-search" placeholder="Find player..." oninput="searchPlayer(this.value)"/></div><div id="search-results" style="display:none"></div><div class="table-map" id="table-map"></div><div class="toast" id="toast"></div><div class="modal-bg" id="modal"><div class="modal-header"><button class="modal-back" onclick="closeModal()">&lt;</button><div class="modal-title" id="modal-title">Table</div><button id="ct-btn" style="display:none;padding:6px 12px;background:#1a0a0a;border:1px solid #3a1a1a;border-radius:6px;color:#c87a40;font-size:12px;font-weight:700;cursor:pointer" onclick="startCloseTable()">Close table</button></div><div class="modal-content" id="modal-content"></div></div><script>'+CLOSE_TABLE_JS+'var clockRunning=false,lastState=null,moveTarget=null,modalTable=null,selectedSeat=null;function fmt(s){if(!s&&s!==0)return"--:--";if(s<0)s=0;var m=Math.floor(s/60),sec=s%60;return String(m).padStart(2,"0")+":"+String(sec).padStart(2,"0");}function chips(n){if(!n&&n!==0)return"-";if(n>=1000)return(n/1000).toFixed(1).replace(/\.0$/,"")+"K";return n.toLocaleString();}function currency(n){return"S$"+Math.round(n||0).toLocaleString();}function showToast(msg,type){var t=document.getElementById("toast");t.textContent=msg;t.className="toast show"+(type?" "+type:"");setTimeout(function(){t.className="toast";},2500);}function sendAction(obj){return fetch("/api/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(obj)});}function act(type){sendAction({type:type});}function clockAct(a){sendAction({type:"clock-action",action:a});}function assignSeat(id,name){if(lastState&&lastState.tournament&&lastState.tournament.seatingMode==="manual"){moveTarget={id:id,name:name,isAssign:true};document.getElementById("move-banner").style.display="flex";document.getElementById("move-banner-text").textContent="Assigning "+name+" — tap table then empty seat";renderTableMap();}else{sendAction({type:"assign-seat",playerId:id}).then(function(){showToast("Assigned "+name);});}}function setMode(m){sendAction({type:"set-seating-mode",mode:m}).then(function(){showToast("Seating: "+m.toUpperCase());});}function openTable(){sendAction({type:"open-table"}).then(function(){showToast("Table opened");});}function bustPlayer(id,name){if(!confirm("Bust "+name+"?"))return;sendAction({type:"bust-player",playerId:id}).then(function(){showToast(name+" busted","error");closeModal();});}function startMove(id,name){moveTarget={id:id,name:name};document.getElementById("move-banner").style.display="flex";document.getElementById("move-banner-text").textContent="Moving "+name+" — tap destination table";closeModal();renderTableMap();}function cancelMove(){moveTarget=null;document.getElementById("move-banner").style.display="none";selectedSeat=null;renderTableMap();}function moveTo(tNum,sNum){if(!moveTarget)return;var aType=moveTarget.isAssign?"assign-seat":"move-player";sendAction({type:aType,playerId:moveTarget.id,tableNum:tNum,seatNum:sNum}).then(function(){showToast(moveTarget.name+(moveTarget.isAssign?" assigned to ":" moved to ")+"T"+tNum+" S"+sNum);moveTarget=null;document.getElementById("move-banner").style.display="none";closeModal();renderTableMap();});}function lockSeat(tNum,sNum,lockType){sendAction({type:"set-seat-lock",tableNum:tNum,seatNum:sNum,lockType:lockType}).then(function(){showToast(lockType==="none"?"Unlocked":"Locked: "+lockType);renderModalContent(true);});}function openTableModal(num){modalTable=num;selectedSeat=null;closeTableMode=null;document.getElementById("modal-title").textContent="Table "+num+(moveTarget?" — tap empty seat":"");document.getElementById("modal").className="modal-bg show";var ctb=document.getElementById("ct-btn");if(ctb)ctb.style.display=moveTarget?"none":"block";renderModalContent();}function closeModal(){document.getElementById("modal").className="modal-bg";modalTable=null;selectedSeat=null;closeTableMode=null;var ctb=document.getElementById("ct-btn");if(ctb)ctb.style.display="none";}function toggleSeat(seatNum){selectedSeat=selectedSeat===seatNum?null:seatNum;renderModalContent(true);}function getLock(tNum,sNum){if(!lastState||!lastState.tournament)return null;var lk=(lastState.tournament.seatLocks||{})[tNum+"-"+sNum];return lk||null;}function lockBadge(lk){if(lk==="move")return\'<span class="lock-badge lm">MOVE</span>\';if(lk==="reg")return\'<span class="lock-badge lr">REG</span>\';if(lk==="all")return\'<span class="lock-badge la">ALL</span>\';return"";}function renderModalContent(force){if(closeTableMode)return;if(selectedSeat&&!force)return;if(!modalTable||!lastState||!lastState.tournament)return;var tm=lastState.tournament.tableMap||[];var t=null;for(var i=0;i<tm.length;i++)if(tm[i].num===modalTable){t=tm[i];break;}if(!t)return;var cap=t.capacity||9;var h=\'<div class="seat-list">\';for(var s=1;s<=cap;s++){var p=null;for(var j=0;j<t.players.length;j++)if(t.players[j].seatNum===s){p=t.players[j];break;}var lk=getLock(modalTable,s);var isSel=selectedSeat===s;if(p){var cls="seat-row-m"+(isSel?" selected-seat":"")+(lk?" locked-seat":"");h+=\'<div class="\'+cls+\'" onclick="toggleSeat(\'+s+\')">\';h+=\'<div class="seat-top"><span class="seat-n-m">\'+s+\'</span><span class="seat-name-m">\'+p.name+\'</span>\'+lockBadge(lk)+\'</div>\';if(isSel&&!moveTarget){h+=\'<div class="seat-actions-m"><button class="sa-btn sa-bust" onclick="event.stopPropagation();bustPlayer(\\\'\'+p.id+"\',\'"+p.name.replace(/\'/g,"")+"\')\\">Bust out</button>"+\'<button class="sa-btn sa-move" onclick="event.stopPropagation();startMove(\\\'\'+p.id+"\',\'"+p.name.replace(/\'/g,"")+"\')\\">Move</button></div>";h+=lockBtns(modalTable,s);}h+="</div>";}else{var isDest=moveTarget!==null;var isMoveLocked=lk==="move"||lk==="all";var cls="seat-row-m empty-seat"+(isDest&&!isMoveLocked?" dest-seat":"")+(isSel?" selected-seat":"")+(lk?" locked-seat":"");h+=\'<div class="\'+cls+\'"\'+(isDest&&!isMoveLocked?\' onclick="moveTo(\'+modalTable+","+s+\')"\':\' onclick="toggleSeat(\'+s+\')"\')+">";h+=\'<div class="seat-top"><span class="seat-n-m">\'+s+\'</span><span class="seat-empty-m">\'+(isDest?(isMoveLocked?"locked":"Tap to move here"):"empty")+"</span>"+lockBadge(lk)+"</div>";if(isSel&&!isDest){h+=lockBtns(modalTable,s);}h+="</div>";}}h+="</div>";document.getElementById("modal-content").innerHTML=h;}function renderTableMap(){if(!lastState||!lastState.tournament){document.getElementById("table-map").innerHTML="";return;}var tm=lastState.tournament.tableMap||[];if(!tm.length){document.getElementById("table-map").innerHTML="";return;}document.getElementById("table-map").innerHTML=tm.map(function(t){var pct=t.capacity>0?Math.round(t.count/t.capacity*100):0;var isFull=t.count>=t.capacity;var fc=isFull?"full":pct>=78?"near":"";var isDest=moveTarget&&t.count<t.capacity;return\'<div class="table-card\'+(isFull?" full":"")+(isDest?" dest":"")+\'" onclick="openTableModal(\'+t.num+\')"><div class="table-num">T\'+t.num+\'</div><div class="table-count\'+(isFull?" full":"")+\'">\'+t.count+\'</div><div class="table-cap">/ \'+t.capacity+\'</div><div class="table-bar"><div class="table-bar-fill \'+fc+\'" style="width:\'+pct+\'%"></div></div></div>\';}).join("");}function updateClock(d){var t=d.secs<=60?"danger":d.secs<=300?"warn":"";document.getElementById("cl-time").className="clock-time"+(t?" "+t:"");document.getElementById("cl-time").textContent=fmt(d.secs);document.getElementById("cl-level").textContent=d.isBreak?"BREAK":("LEVEL "+(d.level||"-"));document.getElementById("ev-name").textContent=d.eventName||"-";clockRunning=d.running;var pp=document.getElementById("pp-btn");pp.textContent=clockRunning?"Pause":"Start";pp.className="clk-btn play-pause"+(clockRunning?" running":"");if(!d.isBreak&&d.sb){document.getElementById("cl-blinds").innerHTML=\'<div class="blind-item"><div class="blind-lbl">SB</div><div class="blind-val">\'+chips(d.sb)+\'</div></div><div class="blind-item"><div class="blind-lbl">BB</div><div class="blind-val">\'+chips(d.bb)+\'</div></div>\'+(d.ante>0?\'<div class="blind-item"><div class="blind-lbl">Ante</div><div class="blind-val">\'+chips(d.ante)+\'</div></div>\':"");}else{document.getElementById("cl-blinds").innerHTML="";}}function updateTournament(d){var cumE=(d.players||0)+(d.inheritedEntries||0);document.getElementById("st-players").textContent=(d.active||0)+(cumE>0?"/"+cumE:"");document.getElementById("st-tables").textContent=d.tables||"-";document.getElementById("st-entries").textContent=cumE||"-";document.getElementById("st-prize").textContent=d.prizePool>0?currency(d.prizePool):"-";var rbar=document.getElementById("reentry-bar");if(d.reentryUntil>0){rbar.style.display="flex";rbar.className="reentry-bar "+(d.reentryOpen?"open":"closed");document.getElementById("re-label").textContent=d.reentryOpen?"Re-entries OPEN":"Re-entries CLOSED";document.getElementById("re-desc").textContent=d.reentryDesc||"";}else{rbar.style.display="none";}var sm=d.seatingMode||"auto";var mAuto=document.getElementById("mode-auto");var mMan=document.getElementById("mode-manual");if(mAuto&&mMan){mAuto.className="seat-mode-btn"+(sm==="auto"?" active":"");mMan.className="seat-mode-btn"+(sm==="manual"?" active":"");}var unseated=d.unseated||[];var usec=document.getElementById("unseated-section");if(unseated.length>0){usec.style.display="block";document.getElementById("unseated-title").textContent="Awaiting seats ("+unseated.length+")";document.getElementById("unseated-list").innerHTML=unseated.map(function(p){return\'<div class="unseated-row"><span class="unseated-name">\'+p.name+\'</span><button class="assign-btn" onclick="assignSeat(\\\'\'+p.id+"\',\'"+p.name.replace(/\'/g,"")+"\')\\">Assign seat</button></div>";}).join("");}else{usec.style.display="none";}renderTableMap();if(modalTable)renderModalContent();}function poll(){fetch("/api/state").then(function(r){return r.json();}).then(function(data){lastState=data;document.getElementById("dot").className="conn-dot connected";if(data.clock)updateClock(data.clock);if(data.tournament)updateTournament(data.tournament);}).catch(function(){document.getElementById("dot").className="conn-dot";});}poll();setInterval(poll,1500);</script><div class="shot-clock"><button class="shot-btn" id="shot-btn" onclick="toggleShotClock()">SHOT<br>CLOCK</button></div><div class="shot-overlay" id="shot-overlay" style="display:none" onclick="stopShotClock()"><div class="shot-display" id="shot-display">30</div></div></body></html>';
}


function getRegisterHTML() {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><title>SPC Registration</title><style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#06090a;color:#e4f0e8;font-family:-apple-system,BlinkMacSystemFont,sans-serif;height:100%;overflow-x:hidden}.reg-header{background:#08120a;border-bottom:1px solid #152018;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}.reg-brand{font-size:14px;font-weight:700;letter-spacing:2px;color:#c8973a;text-transform:uppercase}.reg-dot{width:8px;height:8px;border-radius:50%;background:#e05a5a;transition:.3s}.reg-dot.on{background:#3dba6f}.reg-stats{display:flex;border-bottom:1px solid #152018}.rs{flex:1;padding:10px 8px;text-align:center;border-right:1px solid #152018}.rs:last-child{border-right:none}.rs-lbl{font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:2px;font-weight:600}.rs-val{font-size:18px;font-weight:700;color:#e4f0e8}.rs-val.green{color:#3dba6f}.reentry-strip{padding:8px 20px;font-size:11px;border-bottom:1px solid #152018;display:none;align-items:center;justify-content:space-between}.reentry-strip.open{display:flex;background:#0a1f0d}.reentry-strip.closed{display:flex;background:#1a0a0a}.re-lbl{font-weight:700}.reentry-strip.open .re-lbl{color:#3dba6f}.reentry-strip.closed .re-lbl{color:#e05a5a}.re-desc{color:rgba(255,255,255,.4);font-size:10px}.scan-area{padding:20px;max-width:600px;margin:0 auto}.scan-box{background:#060e09;border:2px solid #1a2e22;border-radius:12px;padding:18px 20px;margin-bottom:16px;transition:.15s}.scan-box:focus-within{border-color:#c8973a}.scan-label{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7aaa82;margin-bottom:8px;font-weight:600}.scan-input{width:100%;background:transparent;border:none;outline:none;font-size:20px;color:#e8f0ea;caret-color:#c8973a;font-weight:500}.scan-input::placeholder{color:#2a4a35}.scan-hint{font-size:12px;color:#527a5c;margin-top:6px}.last-reg{background:#0b1610;border:1px solid #1a2e22;border-radius:12px;padding:16px 20px;margin-bottom:16px;display:none}.last-reg.show{display:block}.last-reg.dup{background:#1a1004;border-color:#2a1c06}.lr-name{font-size:22px;font-weight:700;color:#b2d4ba;margin-bottom:4px}.lr-seat{font-size:14px;color:#3dba6f;font-weight:600}.lr-seat.pending{color:#c8973a}.lr-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px}.lr-badge.dup{background:#1a0a0a;color:#c87a40;border:1px solid #3a2010}.lr-badge.reentry{background:#0d0816;color:#9b7bce;border:1px solid #2a1a40}.reg-log{background:#060e09;border:1px solid #1a2e22;border-radius:12px;overflow:hidden}.rl-hdr{padding:10px 16px;border-bottom:1px solid #1a2e22;display:flex;justify-content:space-between}.rl-title{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#7aaa82;font-weight:600}.rl-count{font-size:12px;color:#7aaa82}.rl-list{max-height:400px;overflow-y:auto}.rl-row{display:flex;align-items:center;gap:10px;padding:9px 16px;border-bottom:1px solid #0e1a12}.rl-row:last-child{border-bottom:none}.rl-row.dup-row{background:#0f0c04}.rl-num{font-size:12px;color:#7aaa82;width:24px;text-align:right;font-weight:500}.rl-name{flex:1;font-size:14px;color:#b2d4ba;font-weight:500}.rl-seat{font-size:13px;color:#3dba6f;font-weight:600}.rl-time{font-size:11px;color:#7aaa82;font-weight:500}.rl-empty{padding:24px;text-align:center;color:#3a5a42;font-size:13px}.toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#3dba6f;color:#04080a;padding:10px 22px;border-radius:8px;font-size:14px;font-weight:600;opacity:0;transition:.3s;pointer-events:none;z-index:999}.toast.show{opacity:1}.toast.error{background:#e05a5a;color:#fff}.suggest-list{position:absolute;left:0;right:0;top:100%;background:#0b1610;border:1px solid #1a2e22;border-radius:0 0 10px 10px;max-height:200px;overflow-y:auto;z-index:20;display:none}.suggest-list.show{display:block}.suggest-item{padding:10px 16px;font-size:15px;color:#b2d4ba;cursor:pointer;border-bottom:1px solid #0e1a12}.suggest-item:active,.suggest-item:hover{background:#112016;color:#3dba6f}.suggest-id{font-size:11px;color:#527a5c;margin-left:8px}.member-sync-bar{padding:8px 20px;border-bottom:1px solid #152018;background:#0a0a18;display:flex;align-items:center;gap:10px}.member-count{font-size:11px;color:#7a7aaa;font-weight:500}</style></head><body><div class="reg-header"><div class="reg-brand">SPC Registration</div><div class="reg-dot" id="dot"></div></div><div class="reg-stats"><div class="rs"><div class="rs-lbl">Active</div><div class="rs-val" id="s-active">-</div></div><div class="rs"><div class="rs-lbl">Entries</div><div class="rs-val" id="s-entries">-</div></div><div class="rs"><div class="rs-lbl">Tables</div><div class="rs-val" id="s-tables">-</div></div><div class="rs"><div class="rs-lbl">Mode</div><div class="rs-val green" id="s-mode">-</div></div></div><div class="reentry-strip" id="re-strip"><span class="re-lbl" id="re-lbl2"></span><span class="re-desc" id="re-desc2"></span></div><div class="scan-area"><div class="member-sync-bar"><span class="member-count" id="member-count">Members: syncing...</span></div><div class="scan-box" style="position:relative"><div class="scan-label">Scan SPC card / boarding pass / type name + Enter</div><input class="scan-input" id="scan" placeholder="Ready to scan..." autocomplete="off" autocorrect="off" spellcheck="false"><div class="suggest-list" id="suggest-list"></div></div><div class="last-reg" id="last-reg"><div class="lr-name" id="lr-name"></div><div class="lr-seat" id="lr-seat"></div></div><div class="reg-log"><div class="rl-hdr"><span class="rl-title">Registrations this session</span><span class="rl-count" id="rl-count">0</span></div><div class="rl-list" id="rl-list"><div class="rl-empty">No registrations yet</div></div></div></div><div class="toast" id="toast"></div><script>' + COUNTER_SUGGEST_JS + 'var lastState=null;var regLog=[];var memberList=[];var scanInput=document.getElementById(\'scan\');scanInput.focus();document.addEventListener(\'click\',function(){scanInput.focus();});function parseQR(raw){if(!raw||!raw.trim())return null;var parts=raw.trim().split(\';\');var name=parts[3]?parts[3].trim():\'\';return name||raw.trim();}function showToast(msg,type){var t=document.getElementById(\'toast\');t.textContent=msg;t.className=\'toast show\'+(type?\' \'+type:\'\');setTimeout(function(){t.className=\'toast\';},2500);}function sendAction(obj){return fetch(\'/api/action\',{method:\'POST\',headers:{\'Content-Type\':\'application/json\'},body:JSON.stringify(obj)});}function findPlayerSeat(name){if(!lastState||!lastState.tournament)return null;var tm=lastState.tournament.tableMap||[];for(var i=0;i<tm.length;i++){var t=tm[i];for(var j=0;j<t.players.length;j++){if(t.players[j].name===name)return{table:t.num,seat:t.players[j].seatNum};}}return null;}function doScan(){var raw=scanInput.value;if(!raw.trim())return;var name=parseQR(raw);if(!name){showToast(\'Could not parse scan\',\'error\');scanInput.value=\'\';return;}var isDup=false;if(lastState&&lastState.tournament){var tm=lastState.tournament.tableMap||[];for(var i=0;i<tm.length;i++){for(var j=0;j<tm[i].players.length;j++){if(tm[i].players[j].name===name){isDup=true;break;}}if(isDup)break;}}sendAction({type:\'register\',name:name}).then(function(){var entry={name:name,isDup:isDup,time:new Date()};regLog.unshift(entry);var lr=document.getElementById(\'last-reg\');lr.className=\'last-reg show\'+(isDup?\' dup\':\'\');document.getElementById(\'lr-name\').innerHTML=name+(isDup?\'<span class="lr-badge dup">DUPLICATE</span>\':\'\');document.getElementById(\'lr-seat\').textContent=\'Assigning seat...\';document.getElementById(\'lr-seat\').className=\'lr-seat pending\';setTimeout(function(){fetch(\'/api/state\').then(function(r){return r.json();}).then(function(data){lastState=data;var seat=findPlayerSeat(name);if(seat){document.getElementById(\'lr-seat\').textContent=\'Table \'+seat.table+\' Seat \'+seat.seat;document.getElementById(\'lr-seat\').className=\'lr-seat\';entry.table=seat.table;entry.seat=seat.seat;}else{document.getElementById(\'lr-seat\').textContent=data.tournament&&data.tournament.seatingMode===\'manual\'?\'Added to queue (manual mode)\':\'Seated\';document.getElementById(\'lr-seat\').className=\'lr-seat\';}renderLog();});},800);showToast(isDup?name+\' (DUPLICATE - registered anyway)\':name+\' registered\');renderLog();});scanInput.value=\'\';scanInput.focus();}scanInput.addEventListener(\'keydown\',function(e){if(e.key===\'Enter\'){e.preventDefault();doScan();}});scanInput.addEventListener("input",function(){showSuggest(scanInput.value);});scanInput.addEventListener("blur",function(){setTimeout(function(){document.getElementById("suggest-list").className="suggest-list";},200);});function pad2(n){return n<10?\'0\'+n:\'\'+n;}function renderLog(){document.getElementById(\'rl-count\').textContent=regLog.length;if(!regLog.length){document.getElementById(\'rl-list\').innerHTML=\'<div class="rl-empty">No registrations yet</div>\';return;}document.getElementById(\'rl-list\').innerHTML=regLog.map(function(r,i){var seatStr=r.table?\'T\'+r.table+\' S\'+r.seat:\'...\';var timeStr=pad2(r.time.getHours())+\':\'+pad2(r.time.getMinutes())+\':\'+pad2(r.time.getSeconds());return \'<div class="rl-row\'+(r.isDup?\' dup-row\':\'\')+\'"><span class="rl-num">\'+(regLog.length-i)+\'</span><span class="rl-name">\'+r.name+(r.isDup?\' <span class="lr-badge dup">DUP</span>\':\'\')+\'</span><span class="rl-seat">\'+seatStr+\'</span><span class="rl-time">\'+timeStr+\'</span></div>\';}).join(\'\');}function updateStats(d){if(!d)return;var cumE=(d.players||0)+(d.inheritedEntries||0);document.getElementById(\'s-active\').textContent=d.active||\'-\';document.getElementById(\'s-entries\').textContent=cumE||\'-\';document.getElementById(\'s-tables\').textContent=d.tables||\'-\';document.getElementById(\'s-mode\').textContent=(d.seatingMode||\'auto\').toUpperCase();var rs=document.getElementById(\'re-strip\');if(d.reentryUntil>0){rs.style.display=\'flex\';rs.className=\'reentry-strip \'+(d.reentryOpen?\'open\':\'closed\');document.getElementById(\'re-lbl2\').textContent=d.reentryOpen?\'Re-entries OPEN\':\'Re-entries CLOSED\';document.getElementById(\'re-desc2\').textContent=d.reentryDesc||\'\';}else{rs.style.display=\'none\';}}function poll(){fetch(\'/api/state\').then(function(r){return r.json();}).then(function(data){lastState=data;document.getElementById(\'dot\').className=\'reg-dot on\';if(data.members&&data.members.length){memberList=data.members;document.getElementById(\'member-count\').textContent=\'Members: \'+data.members.length+\' loaded\';}if(data.tournament)updateStats(data.tournament);}).catch(function(){document.getElementById(\'dot\').className=\'reg-dot\';});}poll();setInterval(poll,2000);</script></body></html>';
}

module.exports = {
  start: function(port, callback) {
    httpServer = http.createServer(function(req, res) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
      var path = url.parse(req.url).pathname;
      if (path === '/') { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); res.end(getFloorHTML()); }
      else if (path === '/register') { res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}); res.end(getRegisterHTML()); }
      else if (path === '/health') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"ok":true,"v":6}'); }
      else if (path === '/api/state') { res.writeHead(200, {'Content-Type': 'application/json'}); res.end(JSON.stringify(currentState || {})); }
      else if (path === '/api/action' && req.method === 'POST') {
        var body = '';
        req.on('data', function(c) { body += c; });
        req.on('end', function() { try { var a = JSON.parse(body); if (floorActionCallback) floorActionCallback(a); res.writeHead(200, {'Content-Type': 'application/json'}); res.end('{"ok":true}'); } catch(e) { res.writeHead(400); res.end('err'); } });
      } else { res.writeHead(404); res.end(''); }
    });
    httpServer.listen(port, '0.0.0.0', function() { callback(httpServer.address().port); });
    httpServer.on('error', function(err) { if (err.code === 'EADDRINUSE') { httpServer.listen(0, '0.0.0.0', function() { callback(httpServer.address().port); }); } });
  },
  broadcastClockState: function(s) { if (!currentState) currentState = {}; currentState.clock = s; },
  broadcastTournamentState: function(s) { if (!currentState) currentState = {}; if(s&&s._membersOnly){currentState.members=s.members;return;} currentState.tournament = s; if(s&&s.members) currentState.members = s.members; },
  broadcastMembers: function(m) { if (!currentState) currentState = {}; currentState.members = m; },
  onFloorAction: function(cb) { floorActionCallback = cb; },
  onClockRequest: function(cb) {},
  stop: function() { if (httpServer) httpServer.close(); }
};
