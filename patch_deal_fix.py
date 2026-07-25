#!/usr/bin/env python3
"""Fix: payoutMap must store full row (not just amount) so dealAmount can be read.
Also update getPotyPoints to use dealAmount when tournament.dealMade is true."""
import sys

PATH = "app.html"
with open(PATH, "r") as f:
    src = f.read()
original = src

def replace_once(needle, replacement, tag):
    global src
    n = src.count(needle)
    if n != 1:
        sys.exit(f"ABORT {tag}: expected 1 hit, got {n}")
    src = src.replace(needle, replacement, 1)

# ============================================================
# Fix A1: pushTournamentToCloud — payoutMap must store the full row object
# ============================================================
anchor_a1 = "      payouts.forEach((p,i)=>{payoutMap[p.position||i+1]=p.amount||0;});"
replacement_a1 = "      payouts.forEach((p,i)=>{payoutMap[p.position||i+1]=p;});"
replace_once(anchor_a1, replacement_a1, "push-payoutMap")

# ============================================================
# Fix A2: pushTournamentToCloud — payoutAmt must extract .amount from the row
# ============================================================
anchor_a2 = "        const payoutAmt=payoutMap[p.bustPosition]||0;"
replacement_a2 = "        const payoutRow=payoutMap[p.bustPosition]||null;\n        const payoutAmt=payoutRow?(payoutRow.amount||0):0;"
replace_once(anchor_a2, replacement_a2, "push-payoutAmt")

# ============================================================
# Fix A3: simplify the payoutAmountDeal + totalPrize lines to use payoutRow
# ============================================================
anchor_a3 = "          payoutAmountDeal:(t.dealMade&&payoutMap[p.bustPosition]&&payoutMap[p.bustPosition].dealAmount!=null)?payoutMap[p.bustPosition].dealAmount:null,\n          extraBagAmount:extraBag,\n          totalPrize:((t.dealMade&&payoutMap[p.bustPosition]&&payoutMap[p.bustPosition].dealAmount!=null)?payoutMap[p.bustPosition].dealAmount:payoutAmt)+extraBag,"
replacement_a3 = "          payoutAmountDeal:(t.dealMade&&payoutRow&&payoutRow.dealAmount!=null)?payoutRow.dealAmount:null,\n          extraBagAmount:extraBag,\n          totalPrize:((t.dealMade&&payoutRow&&payoutRow.dealAmount!=null)?payoutRow.dealAmount:payoutAmt)+extraBag,"
replace_once(anchor_a3, replacement_a3, "push-deal-lines")

# ============================================================
# Fix B: getPotyPoints — use dealAmount when tournament.dealMade
# ============================================================
# Current line uses po.amount everywhere. We want the effective amount = dealAmount if dealMade else amount.
anchor_b = "busted.forEach(p=>{const po=payoutMap[p.bustPosition];if(po&&po.amount>0){results.push({name:p.name,payoutAmount:po.amount,extraBagAmount:0,totalPrize:po.amount,points:Math.floor(po.amount/POTY_RATE)});}});"
replacement_b = "busted.forEach(p=>{const po=payoutMap[p.bustPosition];if(po&&po.amount>0){const eff=(tournament.dealMade&&po.dealAmount!=null)?po.dealAmount:po.amount;results.push({name:p.name,payoutAmount:eff,extraBagAmount:0,totalPrize:eff,points:Math.floor(eff/POTY_RATE)});}});"
replace_once(anchor_b, replacement_b, "getPotyPoints-deal")

# ============================================================
if src == original:
    sys.exit("ABORT: no changes were made")

with open(PATH, "w") as f:
    f.write(src)

print("OK — 4 anchors matched and patched.")
