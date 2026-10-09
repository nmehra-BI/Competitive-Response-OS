import json
from common import OUT

NOTE_GAP = 300  # title note sits 300 px above its row (>= 223)
rows = [
    ("n1", "Foundations", [("Main.dc.html", "S01 Portfolio overview — Elena Fischer", 1500, True),
                           ("DesignSystem.dc.html", "Foundations — type, palette, kinds, gates, status, components", 3400, False)]),
    ("n2", "Discover", [("Mandate.dc.html", "S02 Mandate — create, validate, submit to G0", 1500, True),
                        ("Opportunities.dc.html", "S03 Opportunity discovery — Maya shortlists", 1500, True),
                        ("Compare.dc.html", "S04 Compare up to 4 candidates", 1500, True)]),
    ("n3", "Assess", [("Thesis.dc.html", "S05 Expansion case — thesis", 2000, True),
                      ("Sizing.dc.html", "S06 Sizing workbench — ladder, cohorts, ledger", 2300, True),
                      ("Feasibility.dc.html", "S07 Feasibility and ability to win", 1500, True),
                      ("Economics.dc.html", "S08 Economics and scenarios", 2000, True)]),
    ("n4", "Validate → Decide", [("Validation.dc.html", "S09 Assumptions and validation", 2100, True),
                                 ("Decisions.dc.html", "S10 Decision package — G2 pilot approval", 2500, True)]),
    ("n5", "Execute → Review", [("Pilot.dc.html", "S11 Pilot execution — activate and create tasks", 2000, True),
                                ("Outcomes.dc.html", "S12 Outcome review and scale decision", 2200, True),
                                ("MyWork.dc.html", "My Work — Jonas Klein", 1400, True)]),
    ("n6", "Supporting", [("Evidence.dc.html", "S13 Evidence detail and history", 1700, True),
                          ("Admin.dc.html", "S14 Administration and connections", 2200, True)]),
]
boards, order, notes = {}, [], {}
y = NOTE_GAP
for nid, title, items in rows:
    notes[nid] = {"x": 0, "y": y - NOTE_GAP, "text": title, "kind": "title1", "maxW": 3000}
    x = 0
    mh = 0
    for f, t, h, inter in items:
        boards[f] = {"x": x, "y": y, "w": 1440, "h": h, "title": t, "expand": "fill", "is_interactive": inter}
        order.append(f)
        x += 1440 + 80
        mh = max(mh, h)
    y += mh + 120 + NOTE_GAP
doc = {"v": 3, "createdOnFiles": {"v": 1, "at": "2026-10-09T12:00:00Z"}, "title": "Market Expansion OS — Prototype",
       "launch": {"view": "canvas"}, "pages": [], "boards": boards, "order": order, "notes": notes, "designSystems": []}
open(OUT + "/canvas.json", "w").write(json.dumps(doc, ensure_ascii=False, indent=1))
print(order[0], len(order))
