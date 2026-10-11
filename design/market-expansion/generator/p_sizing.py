from components import *

nxt = next_block("G1 · Approve validation €15k", "Elena Fischer decides · due 16 Oct", "EF",
                 f'<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:$t2">{diamond("precond", 13)}Preconditions 3 of 4 met · comparable sizing met</div>')
header = case_header("Sizing", stage("Assessment"), 1, G_ASSESS, nxt, "Evidence checked 1 day ago · 1 source ageing", {"Feasibility": "1 pending", "Validation": "1 disputed"})

strip = f'''<div style="display:flex;flex-wrap:wrap;gap:6px 18px;align-items:center;padding:10px 14px;border:1px solid $border;border-radius:8px;background:$canvas;font-size:13px">
<span><span style="color:$t3">Market unit</span> annual spend on water monitoring</span><span><span style="color:$t3">Population</span> unique sites</span>
<span><span style="color:$t3">Geography</span> Germany · food processing</span><span>{mono("EUR · 2026 prices", 12.5, "$t1")}</span>
<span style="display:inline-flex;gap:6px;align-items:center">{icon("lock", 13)}Sizing v2 · draft</span>
<span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;color:$t2">{icon("sigma", 14)}Calculated by sizing engine v1.2 · reproducible</span></div>'''


def lbtn(key, label="Lineage"):
    return f'<button type="button" onClick="{hv("sel_" + key)}" class="lk" style="background:none;border:0;padding:0;font:inherit;font-size:12px;font-weight:500;color:$acc;cursor:pointer">{label}</button>'


def lrow(name, meaning, sites_h, sites_pct, money, kinds, key):
    return f'''<div style="display:grid;grid-template-columns:minmax(120px,1fr) minmax(180px,1.7fr) minmax(150px,1.3fr) minmax(130px,1.1fr) minmax(140px,1.1fr);gap:8px 14px;align-items:center;padding:12px 14px;border:1px solid $border;border-radius:8px;background:$surface;{hv("ls_" + key)}">
<div style="font-size:14px;font-weight:600">{name}</div>
<div style="font-size:12.5px;color:$t2;line-height:18px">{meaning}</div>
<div><div style="font-size:14px;font-weight:600">{sites_h}</div><div aria-hidden="true" style="height:6px;border-radius:3px;background:$sunken;margin-top:5px"><div style="height:6px;border-radius:3px;background:$t2;width:{sites_pct}"></div></div></div>
<div style="font-size:14px">{money}</div>
<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">{kinds}{lbtn(key)}</div></div>'''


ladder = f'''<section aria-labelledby="ml">{h2("Measure ladder", "Four different questions. Rows narrow by sites first and money second. Never added together.", hid="ml")}
<div style="display:flex;flex-direction:column;gap:0">
{lrow("TAM", "Annual spend in the defined market. No claim of capture.", "5,000 unique sites", "100%", "<b style='font-weight:600'>€100m/year</b>", kind("Evidence", small=True) + kind("Assumption", "price", small=True), "tam")}
{connector("× eligibility and product-fit filters")}
{lrow("SAM", "Sites we could serve after eligibility and product-fit filters.", hv("samSites"), "40%", f"<b style='font-weight:600'>{hv('samMoney')}</b>", kind("Calculated", "1 assumption", small=True), "sam")}
{connector("× current channel and service coverage")}
{lrow("Reachable pool", "Sites inside current channel and service coverage. Not SOM.", "500 unique sites", "10%", '<span title="Reachable pool is a site count, not a market value." style="color:$t2">— <span style="font-size:12px">site count, not money</span></span>', kind("Assumption", "Jonas Klein", small=True), "reach")}
{connector(f"× {hv('somAdopt')} (Assumption) · capped at capacity 120")}
{lrow(f"SOM · {hv('scName')} · Year 3", "Scenario for a stated horizon. Not a forecast.", hv("somCust"), hv("somPct"), f"<b style='font-weight:600'>{hv('somMoney')}</b><div style='font-size:12px;color:$t2'>annual revenue at end of year 3</div>", kind("Scenario", hv("scName"), small=True), "som")}
</div>
<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:10px"><span style="font-size:12.5px;color:$t2">SOM scenario</span>{seg("scBtns", "SOM scenario")}
<span style="font-size:12.5px;color:$t2;display:inline-flex;gap:6px;align-items:center">{icon("lockbar", 14, "$cap")}{hv("capNote")}</span></div>
<p style="margin:8px 0 0;font-size:12.5px;color:$t3">No total row. €2.0m SOM is annual revenue under a scenario; €100m TAM is annual market spend. They are not progress toward each other.</p></section>'''

cohort_rows = f'''<tr><td style="{TD}">Size-qualified</td><td style="{TD};color:$t2">≥ size threshold (employees or volume)</td><td style="{TD};{NUM}">{hv("szSites")}</td><td style="{TD}">{src("Site census", "2026")}</td></tr>
<tr><td style="{TD}">Process-qualified <span style="color:$t3">(v1)</span></td><td style="{TD};color:$t2">Uses the target water process</td><td style="{TD};{NUM}">{hv("prSites")}</td><td style="{TD}">{src("Trade survey", "2026", "Some")}</td></tr>
<tr style="{hv("dupRowStyle")}"><td style="{TD}">{IF("dupOn", f'<span style="display:inline-flex;gap:6px;align-items:center;color:$wnf">{icon("alert", 14)}<span style="color:$t1">Process-qualified <span style="color:$t3">(imported)</span></span></span>')}</td><td style="{TD};color:$t2">{IF("dupOn", "Same rule, imported 13 Oct")}</td><td style="{TD};{NUM}">{IF("dupOn", "1,100")}</td><td style="{TD}">{IF("dupOn", '<span style="font-size:12px;color:$t2">Upload · 13 Oct</span>')}</td></tr>
<tr><td style="{TD}">Overlap removed <span style="color:$t3">(in both)</span></td><td style="{TD};color:$t2">Same site ID in both cohorts</td><td style="{TD};{NUM};color:$t1">−500</td><td style="{TD}">{mono("Dedup run v2", 12)}</td></tr>
<tr style="background:$canvas"><td style="{TD};font-weight:600">Unique eligible sites (SAM)</td><td style="{TD}"></td><td style="{TD};{NUM};font-weight:600;font-size:14px">{hv("samCount")}</td><td style="{TD};color:$t2">Calculated</td></tr>'''

cohorts = f'''<section aria-labelledby="co" style="margin-top:28px">{h2("Unique-site cohorts", "The arithmetic is the explanation", hid="co", right=btn("Inspect population", "s", ic="users", dis_hole="restricted"))}
{IF("dupOn", '<div style="margin-bottom:10px">' + banner("warn", "Duplicate cohort — calculation paused", "Process-qualified (v1) and Process-qualified (imported) list the same sites under the same rule. Keep one before calculating.", btn("Compare", "s") + btn("Keep v1", "s", handler="keepV1") + btn("Keep imported", "s", handler="keepV1")) + '</div>')}
{IF("restricted", '<div style="margin-bottom:10px">' + banner("lock", "Site list restricted under your access", "Aggregates are shown under policy. Individual site IDs and names are not available to you. Ask Jonas Klein (data owner) for access.", btn("Request access", "s")) + '</div>')}
{card(f'<div style="overflow-x:auto"><table aria-label="Cohorts" style="width:100%;border-collapse:collapse;min-width:560px"><thead><tr><th scope="col" style="{TH}">Cohort</th><th scope="col" style="{TH}">Rule</th><th scope="col" style="{TH};text-align:right">Sites</th><th scope="col" style="{TH}">Source</th></tr></thead><tbody>{cohort_rows}</tbody></table></div>', "overflow:hidden")}
<p style="margin:8px 0 0;font-size:12.5px;color:$t2">Dedup rule: unique by site ID. Sites of one parent company stay separate when they buy separately. Blocking checks: overlap below 0 · overlap above the smaller cohort · SAM above TAM · mixed units · mixed years.</p>
<div style="margin-top:12px">{formula("SAM", "(Size-qualified 1,400 + Process-qualified 1,100 − Overlap 500) × Annual spend per site €20,000", hv("samFormula"))}</div></section>'''

L = [("tam", "TAM site count", "5,000 sites", "Evidence", "", src("Site census", "2026"), "Strong", "v1", "1"),
     ("price", "Annual spend per site", "€20,000/year", "Assumption", "Maya Rao", "Test: paid pilot offer", "Weak", "v2", "4"),
     ("size", "Size-qualified sites", "1,400", "Evidence", "", src("Site census", "2026"), "Strong", "v1", "1"),
     ("proc", "Process-qualified sites", "1,100", "Evidence", "", src("Trade survey", "2026", "Some"), "Some", "v1", "1"),
     ("overlap", "Overlap removed", "−500", "Calculated", "", mono("Dedup run v2", 12), "—", "v2", "1"),
     ("reach", "Reachable pool", "500 sites", "Assumption", "Jonas Klein", "Partner coverage list", "Some", "v1", "1"),
     ("adopt", "Adoption by year 3 · Base", "20%", "Assumption", "Maya Rao", f'<span style="color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("message", 12)}Disputed · Daniel Weber</span>', "Weak", "v2", "3"),
     ("cap", "Installation and support capacity", "120 customers", "Assumption", "[Operations lead]", "Operations capacity model", "Some", "v1", "2")]
lrows = ""
for k, n, v, kd, owner, basis, q, ver, used in L:
    qq = evq(q) if q != "—" else '<span style="color:$t3">—</span>'
    lrows += (f'<tr style="{hv("lr_" + k)}"><td style="{TD}"><button type="button" onClick="{hv("sel_" + k)}" aria-pressed="{hv("lp_" + k)}" style="background:none;border:0;padding:0;font:inherit;font-weight:500;color:$t1;cursor:pointer;text-align:left">{n}</button></td>'
              f'<td style="{TD};{NUM};font-family:$mono;font-size:12.5px">{v}</td><td style="{TD}">{kind(kd, owner, small=True)}</td><td style="{TD}">{basis}</td><td style="{TD}">{qq}</td><td style="{TD}">{mono(ver)}</td><td style="{TD};{NUM}">{used}</td></tr>')
ledger = f'''<section aria-labelledby="lg" style="margin-top:28px">{h2("Input ledger", "Select a row to see its lineage. Exact values live here.", hid="lg", right=btn("Compare versions", "s", ic="compare") + btn("Attach source", "s", ic="clip"))}
{card(f'<div style="overflow-x:auto"><table aria-label="Input ledger" style="width:100%;border-collapse:collapse;min-width:820px"><thead><tr>{"".join(f"<th scope=\"col\" style=\"{TH}{";text-align:right" if h.startswith(">") else ""}\">{h.lstrip(">")}</th>" for h in ["Input", ">Value", "Kind", "Basis", "Evidence", "Version", ">Used by"])}</tr></thead><tbody>{lrows}</tbody></table></div>', "overflow:hidden")}</section>'''

drawer = f'''<aside aria-label="Lineage" style="border:1px solid $border;border-radius:8px;background:$surface;display:flex;flex-direction:column">
<div style="padding:14px 16px;border-bottom:1px solid $border"><div style="font-size:12px;color:$t3;font-weight:500">Lineage · {hv("lin.kind")}</div>
<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-top:2px"><h2 style="margin:0;font-size:17px;font-weight:600">{hv("lin.name")}</h2><span style="font-size:17px;font-weight:600">{hv("lin.value")}</span></div>
<div style="font-family:$mono;font-size:12px;color:$t2;margin-top:2px">Exact: {hv("lin.exact")}</div></div>
<div style="padding:14px 16px;display:flex;flex-direction:column;gap:14px;font-size:13px">
<div>{eyebrow("Formula")}<div style="font-family:$mono;font-size:12.5px;line-height:19px;padding:8px 10px;background:$canvas;border:1px solid $border;border-radius:6px">{hv("lin.formula")}</div></div>
<div>{eyebrow("Inputs · one level")}<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">{FOR("lin.inputs", "i", f'<li style="display:flex;justify-content:space-between;gap:8px"><span>{hv("i.n")}</span><span style="color:$t2;white-space:nowrap">{hv("i.v")}</span></li>', 3)}</ul>
<button type="button" class="lk" style="background:none;border:0;padding:0;margin-top:6px;font:inherit;font-size:12.5px;color:$acc;cursor:pointer">Show next level</button></div>
<div>{eyebrow("Used by")}<div style="display:flex;flex-wrap:wrap;gap:6px">{FOR("lin.usedBy", "u", f'<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px solid $border;border-radius:4px;font-size:12px">{hv("u")}</span>', 3)}</div></div>
<div>{eyebrow("History")}<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:$t2">{FOR("lin.hist", "h", f'<li>{hv("h")}</li>', 2)}</ul></div>
{btn("Recalculate in draft", "s", ic="refresh", extra="align-self:flex-start")}</div></aside>'''

xcheck = f'''<section aria-labelledby="xc" style="border:1px solid $border;border-radius:8px;padding:14px 16px">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between"><h2 id="xc" style="margin:0;font-size:14px;font-weight:600">Top-down cross-check · SAM</h2>{seg("xBtns", "Chart or table")}</div>
<p style="margin:4px 0 10px;font-size:12.5px;color:$t2">A test with a pass or explain outcome. Never averaged with the model.</p>
{IF("xChart", '''<figure style="margin:0"><svg role="img" aria-label="Bottom-up SAM 40 million euros per year sits inside the illustrative top-down range" viewBox="0 0 360 96" style="width:100%;height:auto;display:block;font-family:Geist,sans-serif">
<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#6A6E76" stroke-width="2"></line></pattern></defs>
<line x1="10" y1="60" x2="350" y2="60" stroke="#D6D6D0"></line>
<rect x="160" y="34" width="120" height="16" fill="url(#hatch)" stroke="#6A6E76"></rect>
<text x="220" y="28" font-size="11" fill="#4B4F57" text-anchor="middle">Top-down €[low]–[high]m/year · Illustrative</text>
<circle cx="230" cy="60" r="6" fill="#2F5F78"></circle><text x="230" y="82" font-size="11" fill="#17181B" text-anchor="middle">Bottom-up €40m/year</text>
<text x="10" y="94" font-size="10" fill="#6A6E76">€0</text><text x="350" y="94" font-size="10" fill="#6A6E76" text-anchor="end">€[scale]m</text></svg></figure>''', True)}
{IF("xTable", table(["Method", "Value", "Basis"], [["Bottom-up (model)", "€40m/year SAM", "Cohorts × price"], ["Top-down (cross-check)", "€[low]–[high]m/year", "Vendor segment estimate × share in scope · placeholder"], ["Result", "Within range · illustrative", "No average shown"]], minw=320))}
<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px">{icon("checkcircle", 14, "$okf")}<span>Within range <span style="color:$t2">· top-down figure is an illustrative placeholder, not PRD data</span></span></div></section>'''

errs = f'''{IF("samErr", '<div style="margin-bottom:12px">' + banner("danger", "Blocking: SAM is larger than TAM", "SAM 2,000 unique sites exceeds TAM 500 sites. The TAM site count was edited from 5,000 to 500 in this draft (13 Oct, 15:02, Maya Rao). Snapshot and submission are blocked until fixed.", btn("Undo edit", "s", handler="undo") + btn("Open TAM input", "g", handler="sel_tam")) + '</div>')}'''

body = f'''{proto_bar([("Variant", "varBtns")])}
<div style="padding:16px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
{strip}
{errs}
<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<div style="flex:999 1 620px;min-width:0">{ladder}{cohorts}{ledger}
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:16px;border-top:1px solid $border;align-items:center">
<button type="button" class="bp" disabled="{hv("snapBlocked")}" style="{BTN}{hv("snapStyle")}">Create snapshot v3</button>{btn("Edit assumption", "s", href="Validation.dc.html", ic="pencilruler")}<span style="font-size:12.5px;color:$t2">{hv("snapNote")}</span></div></div>
<div style="flex:1 1 340px;min-width:0;display:flex;flex-direction:column;gap:14px">{drawer}{xcheck}</div></div></div>'''

js = logic(r"""    const s = this.state;
    const LIN = {
      tam: { kind: 'Evidence', name: 'TAM site count', value: s.v === 'sam' ? '500 sites (draft edit)' : '5,000 sites', exact: s.v === 'sam' ? '500' : '5,000', formula: 'Input · Site census 2026, table 4', inputs: [{ n: 'Site census 2026', v: 'Evidence · Strong' }], usedBy: ['TAM'], hist: s.v === 'sam' ? ['v2 draft · 5,000 → 500 · Maya Rao · 13 Oct 15:02', 'v1 · 5,000 · 9 Oct'] : ['v1 · 5,000 · Maya Rao · 9 Oct'] },
      price: { kind: 'Assumption', name: 'Annual spend per site', value: '€20k/year', exact: '€20,000', formula: 'Input · owner Maya Rao · test: paid pilot offer and buyer interviews', inputs: [{ n: 'Trade survey 2026', v: 'Evidence · Some' }, { n: 'Current price list', v: 'Internal' }], usedBy: ['TAM', 'SAM', 'SOM', 'Economics'], hist: ['v2 · range removed, single value · 12 Oct', 'v1 · €18–22k · 9 Oct'] },
      size: { kind: 'Evidence', name: 'Size-qualified sites', value: '1,400', exact: '1,400', formula: 'Input · Site census 2026, filtered by size threshold', inputs: [{ n: 'Site census 2026', v: 'Evidence · Strong' }], usedBy: ['SAM'], hist: ['v1 · 9 Oct'] },
      proc: { kind: 'Evidence', name: 'Process-qualified sites', value: '1,100', exact: '1,100', formula: 'Input · Trade survey 2026', inputs: [{ n: 'Trade survey 2026', v: 'Evidence · Some' }], usedBy: ['SAM'], hist: ['v1 · 9 Oct'] },
      overlap: { kind: 'Calculated', name: 'Overlap removed', value: '−500', exact: '−500', formula: 'count(site IDs in Size-qualified ∩ Process-qualified)', inputs: [{ n: 'Size-qualified', v: '1,400' }, { n: 'Process-qualified', v: '1,100' }], usedBy: ['SAM'], hist: ['Dedup run v2 · 13 Oct'] },
      sam: { kind: 'Calculated · depends on 1 assumption', name: 'SAM', value: '€40m/year', exact: '€40,000,000/year', formula: 'SAM = (Size-qualified + Process-qualified − Overlap) × Annual spend per site', inputs: [{ n: 'Size-qualified', v: '1,400' }, { n: 'Process-qualified', v: '1,100' }, { n: 'Overlap', v: '−500' }, { n: 'Annual spend per site', v: '€20,000 · Assumption' }], usedBy: ['Reachable pool', 'Thesis', 'G1 package'], hist: ['v2 · 13 Oct · overlap confirmed'] },
      reach: { kind: 'Assumption', name: 'Reachable pool', value: '500 sites', exact: '500', formula: 'Input · owner Jonas Klein · partner list verification pending', inputs: [{ n: 'Partner coverage list', v: 'Evidence · Some' }], usedBy: ['SOM', 'Economics'], hist: ['v1 · 10 Oct'] },
      adopt: { kind: 'Assumption · disputed', name: 'Adoption by year 3 · Base', value: '20%', exact: '0.20', formula: 'Input · owner Maya Rao · disputed by Daniel Weber (proposes 10%)', inputs: [{ n: 'No comparable segment evidence', v: 'Evidence · Weak' }], usedBy: ['SOM', 'Economics', 'G2 package'], hist: ['v2 · dispute opened · 14 Oct', 'v1 · 20% · 10 Oct'] },
      cap: { kind: 'Assumption', name: 'Capacity', value: '120 customers', exact: '120', formula: 'Input · Operations capacity model · raising it is a scale decision (G3)', inputs: [{ n: 'Operations capacity model', v: 'Internal' }], usedBy: ['SOM', 'Economics'], hist: ['v1 · 10 Oct'] },
      som: { kind: 'Scenario · Base · Year 3', name: 'SOM · Base', value: '€2.0m annual revenue', exact: '€2,000,000 · 100 customers', formula: 'SOM = min(Reachable pool × Adoption, Capacity) × Annual spend per site', inputs: [{ n: 'Reachable pool', v: '500 · Assumption' }, { n: 'Adoption', v: '20% · Assumption' }, { n: 'Capacity', v: '120 · Assumption' }, { n: 'Price', v: '€20,000 · Assumption' }], usedBy: ['Economics', 'G2 package'], hist: ['v2 · 13 Oct'] }
    };
    const keys = Object.keys(LIN);
    const out = {};
    keys.forEach(k => { out['sel_' + k] = () => this.setState({ sel: k }); out['lr_' + k] = s.sel === k ? 'background:$accbg' : ''; out['lp_' + k] = s.sel === k ? 'true' : 'false'; out['ls_' + k] = s.sel === k ? 'border-color:$acc;box-shadow:0 0 0 1px $acc' : ''; });
    ['tam', 'sam', 'reach', 'som'].forEach(k => { out['ls_' + k] = s.sel === k ? 'border-color:$acc;box-shadow:0 0 0 1px $acc;' : ''; });
    const SC = { Downside: { c: 50, a: '10% adoption', m: '€1.0m', pct: '1%', note: 'Downside: 50 customers, below capacity 120' }, Base: { c: 100, a: '20% adoption', m: '€2.0m', pct: '2%', note: 'Base: 100 customers, below capacity 120' }, Upside: { c: 120, a: 'adoption above 24%', m: '€2.4m', pct: '2.4%', note: 'Upside: capped at 120 — raising capacity is a G3 decision' } };
    const sc = SC[s.sc];
    const blocked = s.v === 'sam' || s.v === 'dup';
    return Object.assign(out, {
      varBtns: this.seg([['normal', 'Normal'], ['dup', 'Duplicate cohort'], ['sam', 'SAM > TAM'], ['restricted', 'Restricted site list']], 'v'),
      scBtns: this.seg([['Downside', '▼ Downside'], ['Base', '● Base'], ['Upside', '▲ Upside']], 'sc'),
      scName: s.sc, somAdopt: sc.a, somCust: sc.c + ' customers', somPct: sc.pct, somMoney: sc.m, capNote: sc.note,
      samSites: '2,000 unique sites', samMoney: s.v === 'dup' ? 'Paused' : '€40m/year',
      samCount: s.v === 'dup' ? 'Paused' : '2,000', szSites: '1,400', prSites: '1,100',
      samFormula: s.v === 'dup' ? 'Paused — duplicate cohort' : '€40m/year · Calculated · depends on 1 assumption',
      dupOn: s.v === 'dup', dupRowStyle: s.v === 'dup' ? 'background:$wnb' : 'display:none',
      restricted: s.v === 'restricted', samErr: s.v === 'sam',
      keepV1: () => this.setState({ v: 'normal' }), undo: () => this.setState({ v: 'normal' }),
      lin: LIN[s.sel],
      xBtns: this.seg([['chart', 'Chart'], ['table', 'Table']], 'x'), xChart: s.x === 'chart', xTable: s.x === 'table',
      snapBlocked: blocked, snapStyle: blocked ? 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;' : 'background:$acc;color:#fff;border:1px solid $acc;',
      snapNote: s.v === 'sam' ? 'Blocked: SAM above TAM.' : s.v === 'dup' ? 'Blocked: resolve the duplicate cohort.' : 'A snapshot freezes values for G1 review. Later edits create a draft.'
    });""", "{ sel: 'sam', sc: 'Base', v: 'normal', x: 'chart' }")

page("Sizing.dc.html", "Sizing Workbench", shell("Expansion Cases", "Tue 13 Oct 2026", header + body, user="MR", autosave="Saved · 1 min ago"), js, height=2300)
