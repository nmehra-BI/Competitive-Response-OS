from common import *


def stat_card(title, inner, link=None, linklabel=None, aria=None):
    l = f'<a href="{link}" class="lk" style="display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:500;text-decoration:none;margin-top:auto;padding-top:10px">{linklabel}{icon("chevr", 13)}</a>' if link else ""
    return (f'<section aria-label="{aria or title}" style="border:1px solid $border;border-radius:8px;padding:14px 16px;background:$surface;display:flex;flex-direction:column;min-width:0">'
            f'<h2 style="margin:0 0 10px;font-size:13px;font-weight:500;color:$t2">{title}</h2>{inner}{l}</section>')


big = lambda n, sub="": f'<div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:28px;line-height:34px;font-weight:600;letter-spacing:-0.02em">{n}</span><span style="font-size:12.5px;color:$t2">{sub}</span></div>'

stages = [("Discovery", 1), ("Assessment", 1), ("Pilot approval pending", 1), ("Stopped", 1)]
stage_rows = "".join(
    f'<li style="display:grid;grid-template-columns:1fr 60px 16px;gap:8px;align-items:center;font-size:12.5px;padding:3px 0"><span style="display:inline-flex;gap:6px;align-items:center">{icon("squarestop", 12) if s == "Stopped" else ""}{s}</span>'
    f'<span aria-hidden="true" style="height:6px;border-radius:3px;background:{"$ntf" if s == "Stopped" else "$acc"};width:{n * 25}%"></span><span style="text-align:right;font-weight:600">{n}</span></li>'
    for s, n in stages)
c_stage = big("4", "cases you can access") + f'<ul style="list-style:none;margin:8px 0 0;padding:0">{stage_rows}</ul>'

c_dec = big("1", "awaiting you") + f'''<a href="Decisions.dc.html" class="hr" style="display:flex;gap:10px;align-items:flex-start;margin-top:8px;padding:10px;border:1px solid $border;border-radius:6px;text-decoration:none;color:$t1">
{diamond("awaiting", 16)}<span style="display:flex;flex-direction:column;line-height:18px;min-width:0"><span style="font-size:13px;font-weight:600">Approve pilot €120k · 90 days</span><span style="font-size:12px;color:$t2">{mono("ME-104", 12)} · v3 · due Fri 27 Nov</span></span></a>'''

spend_bars = f'''<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px" aria-label="Approved versus requested budget, ME-104" role="img">
<div><div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="display:inline-flex;gap:6px;align-items:center">{diamond("approved", 13)}Approved · G1 validation</span><b style="font-weight:600">€15k</b></div>
<div style="height:8px;border-radius:4px;background:$sunken;margin-top:4px"><div style="height:8px;border-radius:4px;background:$okf;width:12.5%"></div></div></div>
<div><div style="display:flex;justify-content:space-between;font-size:12.5px"><span style="display:inline-flex;gap:6px;align-items:center">{diamond("awaiting", 13)}Requested · G2 pilot</span><b style="font-weight:600">€120k</b></div>
<div style="height:8px;border-radius:4px;background:$sunken;margin-top:4px"><div style="height:8px;border-radius:4px;background:$inb;border:1px dashed $inf;box-sizing:border-box;width:100%"></div></div></div>
</div>'''
spend_table = table(["Gate", "Status", ">Amount"], [["G1 · Validation", "Approved 16 Oct", "€15k"], ["G2 · Pilot · 90 days", "Awaiting decision", "€120k"], ["Spent to date", "Not available — finance source unavailable", "—"]], minw=260)
c_spend = f'''<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:12px;color:$t3">ME-104 · one-time budgets · EUR</span>{seg("spendBtns", "Chart or table")}</div>
{IF("showChart", spend_bars, True)}{IF("showTable", spend_table)}
<div style="display:flex;gap:6px;align-items:flex-start;margin-top:10px;font-size:12px;color:$wnf">{icon("alert", 13)}<span style="color:$t2">Spent to date: not available. Finance source unavailable since 08:10.</span></div>'''

c_over = big("1", "test past due") + f'''<a href="Validation.dc.html" class="hr" style="display:flex;gap:10px;align-items:flex-start;margin-top:8px;padding:10px;border:1px solid $border;border-radius:6px;text-decoration:none;color:$t1">
<span style="color:$asf;margin-top:1px">{icon("pencilruler", 15)}</span><span style="display:flex;flex-direction:column;line-height:18px"><span style="font-size:13px;font-weight:500">Channel reach test · ME-102</span><span style="font-size:12px;color:$t2">Due 20 Nov · owner Maya Rao</span></span></a>'''

c_pil = big("0", "pilots need review") + f'<p style="margin:8px 0 0;font-size:12.5px;color:$t2;line-height:18px">No pilot is running. If G2 is approved, the ME-104 pilot review falls due on 3 Mar 2027.</p>'

cards = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
{stat_card("Cases by stage", c_stage, "Thesis.dc.html", "Open cases")}
{stat_card("Decisions awaiting you", c_dec, "Decisions.dc.html", "Open decision brief")}
{stat_card("Approved vs requested spend", c_spend)}
{stat_card("Overdue validation", c_over, "Validation.dc.html", "Open register")}
{stat_card("Pilots needing review", c_pil, "Outcomes.dc.html", "Preview review screen")}
</div>'''

rows = [
    [f'<a href="Thesis.dc.html" class="lk" style="text-decoration:none;color:$t1;display:flex;flex-direction:column;line-height:18px"><span style="font-weight:600">German food-processing plants — monitoring</span>{mono("ME-104", 12)}</a>',
     "Germany · food processing", person("MR"), stage("Pilot approval pending"), gate_chip("awaiting", "G2 · Pilot €120k · 90 days"),
     f'<span style="display:inline-flex;gap:6px;align-items:center">{icon("message", 13)}1 dissent recorded</span>', fresh("Current", "2 days"), '<span style="color:$t2">Package v3 submitted · 25 Nov</span>'],
    [f'<a href="Thesis.dc.html" class="lk" style="text-decoration:none;color:$t1;display:flex;flex-direction:column;line-height:18px"><span style="font-weight:600">Austrian breweries — monitoring</span>{mono("ME-102", 12)}</a>',
     "Austria · beverages", person("MR"), stage("Assessment"), gate_chip("precond", "G1 · Preconditions open (2 of 4 met)"),
     f'<span style="display:inline-flex;gap:6px;align-items:center;color:$wnf">{icon("alert", 13)}<span style="color:$t1">1 test past due</span></span>', fresh("Ageing", "9 days"), '<span style="color:$t2">Sizing draft v1 · 17 Nov</span>'],
    [f'<a href="Opportunities.dc.html" class="lk" style="text-decoration:none;color:$t1;display:flex;flex-direction:column;line-height:18px"><span style="font-weight:600">Dutch food-processing plants — monitoring</span>{mono("ME-105", 12)}</a>',
     "Netherlands · food processing", person("MR"), stage("Discovery"), gate_chip("notstarted", "G1 · Not started"),
     '<span style="color:$t3">None</span>', fresh("Current", "1 day"), '<span style="color:$t2">Converted from opportunity · 24 Nov</span>'],
    [f'<a href="Decisions.dc.html" class="lk" style="text-decoration:none;color:$t1;display:flex;flex-direction:column;line-height:18px"><span style="font-weight:600">Polish beverage bottlers — monitoring</span>{mono("ME-097", 12)}</a>',
     "Poland · beverages", person("MR"), stage("Stopped"), gate_chip("notapproved", "G1 · Not approved"),
     '<span style="color:$t3">—</span>', fresh("Superseded", "archived"), '<span style="color:$t2">Stopped by decision · 2 Oct · rationale recorded</span>'],
]
case_table = table(["Case", "Market", "Owner", "Stage", "Next gate", "Blockers", "Evidence", "Latest update"], rows, minw=1060, aria="Expansion cases")

activity = [
    ("MR", "Maya Rao submitted G2 package v3", "Pilot €120k · 90 days · fingerprint 7F3A·19C2", "25 Nov, 16:40", "Decisions.dc.html"),
    ("LH", "Lena Hoffmann signed the specialist review for pilot scope only", "Up to 4 sites, 90 days · does not cover scale", "23 Nov, 11:05", "Feasibility.dc.html"),
    ("MR", "Validation results recorded · ME-104", "9 interviews (target 8) · 4 paid commitments (target 4) · Met", "20 Nov, 17:12", "Validation.dc.html"),
    ("DW", "Daniel Weber disputed the 20% adoption assumption", "Dissent carried into package v3", "14 Oct, 10:02", "Validation.dc.html"),
]
act = "".join(f'''<li style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid $border">{avatar(i, 24)}<div style="flex:1;min-width:0;line-height:18px">
<a href="{h}" class="lk" style="font-size:13px;font-weight:500;color:$t1;text-decoration:none">{t}</a><div style="font-size:12.5px;color:$t2">{s}</div></div><span style="font-size:12px;color:$t3;white-space:nowrap">{w}</span></li>''' for i, t, s, w, h in activity)

MAP = [("Foundations", [("Design foundations", "DesignSystem.dc.html", "Tokens, status, components")]),
       ("Discover", [("S02 Mandate", "Mandate.dc.html", "Maya · 2 Oct"), ("S03 Opportunities", "Opportunities.dc.html", "Maya · 7 Oct"), ("S04 Compare", "Compare.dc.html", "Maya · 8 Oct")]),
       ("Assess", [("S05 Thesis", "Thesis.dc.html", "Maya · 14 Oct"), ("S06 Sizing", "Sizing.dc.html", "Maya · 13 Oct"), ("S07 Feasibility", "Feasibility.dc.html", "Maya · 14 Oct"), ("S08 Economics", "Economics.dc.html", "Daniel · 14 Oct")]),
       ("Validate → Decide", [("S09 Validation", "Validation.dc.html", "Maya · 15 Oct → 20 Nov"), ("S10 Decision package", "Decisions.dc.html", "Elena · 26 Nov")]),
       ("Execute → Review", [("S11 Pilot", "Pilot.dc.html", "Jonas · 1 Dec"), ("S12 Outcomes", "Outcomes.dc.html", "Maya · 5 Mar 2027"), ("My Work", "MyWork.dc.html", "Jonas · 2 Dec")]),
       ("Supporting", [("S13 Evidence", "Evidence.dc.html", "Maya · 13 Oct"), ("S14 Administration", "Admin.dc.html", "Admin · 9 Oct")])]
journey = "".join(f'''<div style="min-width:0"><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">{g}</div><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px">
{"".join(f'<li><a href="{h}" class="hr" style="display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;text-decoration:none;color:$t1;font-size:13px"><span style="font-weight:500">{n}</span><span style="color:$t3;font-size:12px;white-space:nowrap">{m}</span></a></li>' for n, h, m in items)}</ul></div>''' for g, items in MAP)

full = f'''<div style="padding:24px;display:flex;flex-direction:column;gap:20px;max-width:1240px">
<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px">
<div style="flex:1 1 400px;min-width:0"><h1 style="margin:0;font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.01em">Portfolio overview</h1>
<p style="margin:4px 0 0;font-size:13px;color:$t2">Showing BU Water · cases you can access · hidden cases are not counted</p></div>
<label for="bu" style="display:inline-flex;align-items:center;gap:8px;font-size:13px;color:$t2">Business unit
<select id="bu" style="height:36px;padding:0 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13px;background:$surface;color:$t1"><option>BU Water</option><option disabled="disabled">BU Air · no access</option></select></label>
{btn("Create mandate", "p", href="Mandate.dc.html", ic="plus")}
</div>
{banner("warn", "Finance source unavailable · spend last refreshed 26 Nov, 08:10", "Approved and requested budgets come from gate records and are current. Spent-to-date figures are hidden until finance data returns.", live=True)}
{cards}
<section aria-labelledby="ct">{h2("Expansion cases", "Market sizes are not totalled across cases. Each case has its own market boundary, unit and year.", f'<a href="Opportunities.dc.html" class="lk" style="font-size:13px;font-weight:500;text-decoration:none">Opportunities{icon("chevr", 13)}</a>', hid="ct")}
{card(case_table, "overflow:hidden")}</section>
<div style="display:flex;flex-wrap:wrap;gap:20px">
<section aria-labelledby="ac" style="flex:1 1 420px;min-width:0">{h2("Key events", "Decisions and sign-offs only", hid="ac")}<ul style="list-style:none;margin:0;padding:0;border-top:1px solid $border">{act}</ul></section>
<section aria-labelledby="jm" style="flex:1 1 520px;min-width:0">{h2("Prototype map", "Every screen in the Aster journey. Each opens at its journey moment.", hid="jm")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 20px;border:1px solid $border;border-radius:8px;padding:14px">{journey}</div></section>
</div></div>'''

empty = f'''<div style="padding:64px 24px;display:flex;justify-content:center"><div style="max-width:520px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px">
<span style="width:44px;height:44px;border-radius:10px;background:$sunken;display:flex;align-items:center;justify-content:center;color:$t2">{icon("compass", 22)}</span>
<h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">No expansion cases yet</h1>
<p style="margin:0;font-size:14px;color:$t2;line-height:22px">Start with a mandate: what you may look for, under which constraints, and who owns it. Your sponsor approves it at G0.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">{btn("Create a mandate", "p", href="Mandate.dc.html", ic="plus")}{btn("Explore the Aster example (Illustrative)", "s", handler="showFull")}</div></div></div>'''

content = proto_bar([("View", "viewBtns")]) + IF("full", full, True) + IF("empty", empty)

js = logic("""    const s = this.state;
    return {
      viewBtns: this.seg([['full', 'Portfolio'], ['empty', 'Empty state']], 'view'),
      full: s.view === 'full', empty: s.view === 'empty', showFull: () => this.setState({ view: 'full' }),
      spendBtns: this.seg([['chart', 'Chart'], ['table', 'Table']], 'spend'),
      showChart: s.spend === 'chart', showTable: s.spend === 'table'
    };""", "{ view: 'full', spend: 'chart' }")

page("Main.dc.html", "Portfolio Overview", shell("Overview", "Thu 26 Nov 2026", content, user="EF", counts={"Reviews": "1"}), js, height=1500)
