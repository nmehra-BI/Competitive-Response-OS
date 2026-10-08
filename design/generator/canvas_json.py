import json
rows = [
 ("n1","Foundations",[("Main.dc.html","Overview — Maya Patel (CI lead)",1180,True),("DesignSystem.dc.html","Foundations — tokens, status grammars, components",2700,False)]),
 ("n2","Signal → Evidence",[("SignalInbox.dc.html","Signal Inbox — triage and create case",1180,True),("CaseSummary.dc.html","Case Summary — CR-1042",1400,True),("Evidence.dc.html","Evidence Workspace",1360,True)]),
 ("n3","Impact → Decision",[("Impact.dc.html","Impact Workspace — overlap and exposure",2000,True),("ResponseOptions.dc.html","Response Options",1560,True),("Decision.dc.html","Decision Review — Elena Fischer",2050,True)]),
 ("n4","Execution → Outcomes",[("ActionPlan.dc.html","Action Plan — release and sync recovery",1560,True),("MyActions.dc.html","My Actions — Jonas Weber",1300,True),("Outcomes.dc.html","Outcomes — day-30 review",1600,True)]),
 ("n5","Supporting views",[("Watchlists.dc.html","Watchlists and portfolio import",1760,True),("Integrations.dc.html","Integrations, roles and audit",1700,True)]),
]
boards, order, notes = {}, [], {}
y = 0
for nid, title, items in rows:
    notes[nid] = {"x":0,"y":y-300,"text":title,"kind":"title1","maxW":3000}
    x = 0; mh = 0
    for f,t,h,inter in items:
        boards[f] = {"x":x,"y":y,"w":1440,"h":h,"title":t,"expand":"fill","is_interactive":inter}
        order.append(f); x += 1440+80; mh = max(mh,h)
    y += mh + 120 + 300
doc = {"v":3,"createdOnFiles":{"v":1,"at":"2026-10-08T12:00:00Z"},"title":"Competitive Response OS — Prototype",
 "launch":{"view":"canvas"},"pages":[],"boards":boards,"order":order,"notes":notes,"designSystems":[]}
open("/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad/canvas/project/canvas.json","w").write(json.dumps(doc,ensure_ascii=False,indent=1))
print(order[0], len(order))
