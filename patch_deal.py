#!/usr/bin/env python3
"""One-shot patch: add Deal-mode toggle + deal amount column to PayoutsView,
and wire dealMade + payoutAmountDeal into the push payload."""
import sys

PATH = "app.html"

with open(PATH, "r") as f:
    src = f.read()
original = src

def replace_once(needle, replacement, tag):
    """Replace exactly one occurrence; abort with clear error if zero or many."""
    global src
    n = src.count(needle)
    if n != 1:
        sys.exit(f"ABORT {tag}: expected 1 hit, got {n}")
    src = src.replace(needle, replacement, 1)

# ============================================================
# Edit 1: Add Deal mode toggle bar above the Reconciliation bar
# ============================================================
# Anchor: the reconciliation bar comment
anchor_1 = "        {/* Reconciliation bar */}"
deal_toggle_block = '''        {/* Deal mode toggle */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'8px 14px',background:tournament.dealMade?'#1a1004':'#09140b',border:'1px solid '+(tournament.dealMade?'#2a1c06':'#1a2e22'),borderRadius:6,marginBottom:14}}>
          <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:12,color:tournament.dealMade?'#c8973a':'#7aaa82',fontWeight:600,userSelect:'none'}}>
            <input type="checkbox" checked={!!tournament.dealMade} onChange={e=>{
              const on=e.target.checked;
              if(on){
                const withDeal=rows.map(r=>({...r,dealAmount:r.amount}));
                setRows(withDeal);
                onUpdate({dealMade:true,payoutTable:withDeal});
              } else {
                const withoutDeal=rows.map(r=>{const {dealAmount,dealAmount_raw,...rest}=r;return rest;});
                setRows(withoutDeal);
                onUpdate({dealMade:false,payoutTable:withoutDeal});
              }
            }} style={{cursor:'pointer'}}/>
            <span>Deal made</span>
          </label>
          {tournament.dealMade&&<span style={{fontSize:11,color:'#c8973a'}}>Deal amounts editable in table below · raw amounts preserved for Hendon Mob</span>}
        </div>
'''
replace_once(anchor_1, deal_toggle_block + anchor_1, "toggle-bar")

# ============================================================
# Edit 2: Add "Deal (S$)" column header when dealMade
# ============================================================
anchor_2 = '''                  <th style={{width:'15%'}}>Place</th>
                  <th style={{width:'25%'}}>%</th>
                  <th style={{width:'45%'}}>Amount (S$)</th>
                  <th style={{width:'15%'}}></th>'''
replacement_2 = '''                  <th style={{width:'12%'}}>Place</th>
                  <th style={{width:'20%'}}>%</th>
                  <th style={{width:tournament.dealMade?'26%':'53%'}}>Amount (S$)</th>
                  {tournament.dealMade&&<th style={{width:'27%',color:'#c8973a'}}>Deal (S$)</th>}
                  <th style={{width:'15%'}}></th>'''
replace_once(anchor_2, replacement_2, "column-header")

# ============================================================
# Edit 3: Add the Deal amount input cell to each row
# ============================================================
# Anchor: the closing </td> of the Amount cell + start of remove button cell
anchor_3 = '''                          onKeyDown={e=>{if(e.key==='Enter')commitRow(i,'amount');}}/>
                      </div>
                    </td>
                    <td style={{padding:'4px 10px'}}>
                      <button className="del-row-btn" onClick={()=>removeRow(i)}>✕</button>
                    </td>'''
replacement_3 = '''                          onKeyDown={e=>{if(e.key==='Enter')commitRow(i,'amount');}}/>
                      </div>
                    </td>
                    {tournament.dealMade&&<td style={{padding:'4px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:12,color:'#c8973a'}}>S$</span>
                        <input type="text" inputMode="numeric"
                          style={{background:'#1a1004',border:'1px solid #2a1c06',color:'#c8973a',padding:'4px 7px',borderRadius:4,width:100,fontSize:13,fontWeight:600,fontFamily:"'Rajdhani',sans-serif",outline:'none'}}
                          value={r.dealAmount_raw!==undefined?r.dealAmount_raw:(r.dealAmount!==undefined?r.dealAmount:r.amount)}
                          onChange={e=>updateRowRaw(i,'dealAmount',e.target.value)}
                          onBlur={()=>{
                            const raw=rows[i].dealAmount_raw;
                            if(raw!==undefined&&raw!==''){
                              const v=parseFloat(raw);
                              const dealAmount=isNaN(v)?rows[i].dealAmount:Math.round(v/100)*100;
                              setRows(rs=>{const upd=rs.map((r2,j)=>j!==i?r2:{...r2,dealAmount,dealAmount_raw:undefined});onUpdate({payoutTable:upd});return upd;});
                            } else {
                              setRows(rs=>rs.map((r2,j)=>j!==i?r2:{...r2,dealAmount_raw:undefined}));
                            }
                          }}
                          onKeyDown={e=>{if(e.key==='Enter')e.target.blur();}}/>
                      </div>
                    </td>}
                    <td style={{padding:'4px 10px'}}>
                      <button className="del-row-btn" onClick={()=>removeRow(i)}>✕</button>
                    </td>'''
replace_once(anchor_3, replacement_3, "row-cell")

# ============================================================
# Edit 4: Include dealMade on the tournament in push payload
# ============================================================
# Anchor: the spc_series line we added last time in the payload
anchor_4 = "          spc_series:t.spcSeries||null,\n          eventType:t.eventType||null,"
replacement_4 = "          spc_series:t.spcSeries||null,\n          dealMade:t.dealMade||false,\n          eventType:t.eventType||null,"
replace_once(anchor_4, replacement_4, "payload-tournament-dealMade")

# ============================================================
# Edit 5: Include payoutAmountDeal per result in push payload
# ============================================================
# The results push has two arms (busted players + extra bag winners).
# We only need to touch the busted arm — extra bag winners have no deal.
# Anchor: the busted results.push block
anchor_5 = """          payoutAmount:payoutAmt,
          extraBagAmount:extraBag,
          totalPrize:payoutAmt+extraBag,"""
# Insert dealAmount lookup from payoutMap
replacement_5 = """          payoutAmount:payoutAmt,
          payoutAmountDeal:(t.dealMade&&payoutMap[p.bustPosition]&&payoutMap[p.bustPosition].dealAmount!=null)?payoutMap[p.bustPosition].dealAmount:null,
          extraBagAmount:extraBag,
          totalPrize:((t.dealMade&&payoutMap[p.bustPosition]&&payoutMap[p.bustPosition].dealAmount!=null)?payoutMap[p.bustPosition].dealAmount:payoutAmt)+extraBag,"""
replace_once(anchor_5, replacement_5, "payload-result-deal")

# ============================================================
# Write back
# ============================================================
if src == original:
    sys.exit("ABORT: no changes were made")

with open(PATH, "w") as f:
    f.write(src)

print("OK — all 5 anchors matched and patched.")
