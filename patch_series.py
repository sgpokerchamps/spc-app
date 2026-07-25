#!/usr/bin/env python3
"""One-shot patch: add SPC Series field to the TD app tournament config."""
import re, sys

PATH = "app.html"

with open(PATH, "r") as f:
    src = f.read()
original = src

# --- Edit A: add CURRENT_SPC_SERIES constant above EVENT_CONFIGS ---
if "CURRENT_SPC_SERIES" in src:
    sys.exit("ABORT: CURRENT_SPC_SERIES already exists — file not clean")

anchor_a = "const EVENT_CONFIGS = {"
assert src.count(anchor_a) == 1, f"Expected 1 hit for anchor A, got {src.count(anchor_a)}"
src = src.replace(
    anchor_a,
    'const CURRENT_SPC_SERIES = "SPC XXII";\n\n' + anchor_a,
    1,
)

# --- Edit B1: add spcSeries state hook in SetupScreen ---
anchor_b1 = "const [stack,setStack]=useState(cfg.stack);"
assert src.count(anchor_b1) == 1, f"Expected 1 hit for anchor B1, got {src.count(anchor_b1)}"
src = src.replace(
    anchor_b1,
    anchor_b1 + "\n  const [spcSeries,setSpcSeries]=useState(_tpl?_tpl.spcSeries||CURRENT_SPC_SERIES:CURRENT_SPC_SERIES);",
    1,
)

# --- Edit B2: add Series input field after Name input ---
anchor_b2 = '<div className="form-group"><label className="form-label">Name</label><input className="form-input" value={name} onChange={e=>setName(e.target.value)}/></div>'
assert src.count(anchor_b2) == 1, f"Expected 1 hit for anchor B2, got {src.count(anchor_b2)}"
series_input = (
    '<div className="form-group"><label className="form-label">SPC Series</label>'
    '<input className="form-input" value={spcSeries} onChange={e=>setSpcSeries(e.target.value)} placeholder="e.g. SPC XXII"/>'
    '<div style={{fontSize:10,color:"#5a8a6a",marginTop:4}}>Which series this tournament belongs to (used on cloud commit)</div>'
    '</div>'
)
src = src.replace(anchor_b2, anchor_b2 + "\n          " + series_input, 1)

# --- Edit C1: include spcSeries in onStart config ---
anchor_c1 = "onStart({name,buyin,prizeComponent:prizeComp"
assert src.count(anchor_c1) == 1, f"Expected 1 hit for anchor C1, got {src.count(anchor_c1)}"
src = src.replace(
    anchor_c1,
    "onStart({name,spcSeries,buyin,prizeComponent:prizeComp",
    1,
)

# --- Edit C2: store spcSeries on the tournament object ---
anchor_c2 = "const t={id:uid(),name:config.name,eventType:config.eventType"
assert src.count(anchor_c2) == 1, f"Expected 1 hit for anchor C2, got {src.count(anchor_c2)}"
src = src.replace(
    anchor_c2,
    "const t={id:uid(),name:config.name,spcSeries:config.spcSeries||null,eventType:config.eventType",
    1,
)

# --- Edit C3: include spcSeries in template export ---
anchor_c3 = "const tpl={_spcExport:'template',_version:1,name,eventType"
assert src.count(anchor_c3) == 1, f"Expected 1 hit for anchor C3, got {src.count(anchor_c3)}"
src = src.replace(
    anchor_c3,
    "const tpl={_spcExport:'template',_version:1,name,spcSeries,eventType",
    1,
)

# --- Edit C4: include spc_series in push payload ---
# Anchor: "name:t.name||t.eventType||'Event'," inside the tournament: { ... } payload
anchor_c4 = "name:t.name||t.eventType||'Event',"
count_c4 = src.count(anchor_c4)
assert count_c4 >= 1, f"Expected >=1 hit for anchor C4, got {count_c4}"
# We only want to replace the first occurrence (the push payload).
# If there are more, we still only patch the first.
src = src.replace(
    anchor_c4,
    anchor_c4 + "\n          spc_series:t.spcSeries||null,",
    1,
)

# --- Write back only if changed ---
if src == original:
    sys.exit("ABORT: no changes were made")

with open(PATH, "w") as f:
    f.write(src)

print("OK — all 7 anchors matched and patched.")
