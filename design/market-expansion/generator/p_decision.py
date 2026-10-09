from components import *

INP = "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"
G2A = [("approved", "Mandate · 5 Oct"), ("approved", "Validation €15k · 16 Oct"), ("awaiting", "Pilot €120k · 90 days · due 27 Nov"), ("notstarted", "Scale")]
hA = case_header("Decisions", stage("Pilot approval pending"), 3, G2A, next_block("G2 · Approve pilot €120k · 90 days", "Elena Fischer · due today, 27 Nov", "EF"), "Evidence checked 2 days ago · current")
hO = case_header("Decisions", stage("Pilot approved"), 3, G_PILOT, next_block("Activate pilot plan", "Jonas Klein · from 1 Dec · task creation is separate", "JK",
                 f'<a href="Pilot.dc.html" style="display:inline-flex;gap:4px;align-items:center;margin-top:8px;font-size:12.5px;font-weight:500;text-decoration:none">Open pilot{icon("chevr", 13)}</a>'), "Evidence checked 2 days ago · current")
headers = IF("hAwait", hA, True) + IF("hOk", hO)

SER = "margin:0;font-family:$serif;font-size:17px;line-height:28px;color:$t1"
H3 = "margin:0 0 10px;font-family:$ui;font-size:12px;font-weight:600;color:$t2;letter-spacing:0.04em"


def sec(n, title, inner):
    return f'<section aria-label="{title}" style="padding:22px 0;border-top:1px solid $border"><h3 style="{H3}">{n} · {title.upper()}</h3>{inner}</section>'


UL = "margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px"
scope = f'''<dl style="margin:0;display:grid;grid-template-columns:140px 1fr;gap:6px 14px;font-size:14px">
<dt style="color:$t3">Geography · segment</dt><dd style="margin:0">Germany · food-processing plants</dd>
<dt style="color:$t3">Sites</dt><dd style="margin:0">Up to 4 — the sites with paid commitments from EXP-03</dd>
<dt style="color:$t3">Duration</dt><dd style="margin:0">90 days · 1 Dec 2026 – 28 Feb 2027</dd>
<dt style="color:$t3">Budget</dt><dd style="margin:0"><b style="font-weight:600">€120k</b> · approved budget ceiling · one-time pilot spend</dd>
<dt style="color:$t3">Pilot owner</dt><dd style="margin:0">Jonas Klein</dd><dt style="color:$t3">Review</dt><dd style="margin:0">Day-90 review · due 3 Mar 2027</dd></dl>'''

econ = f'''<div style="overflow-x:auto"><table aria-label="Economics from snapshot v3" style="width:100%;border-collapse:collapse;min-width:520px;font-family:$ui;table-layout:fixed">
<thead><tr><th scope="col" style="{TH};width:40%">Steady state · end of year 3 · EUR 2026</th>{"".join(f'<th scope="col" style="{TH};text-align:right">{sc_mark(s)} {s}</th>' for s in ["Downside", "Base", "Upside"])}</tr></thead><tbody>
<tr><td style="{TD}">Customers</td><td style="{TD};{NUM}">50</td><td style="{TD};{NUM}">100</td><td style="{TD};{NUM}">120 · capped</td></tr>
<tr><td style="{TD}">Annual revenue</td><td style="{TD};{NUM}">€1.0m</td><td style="{TD};{NUM}">€2.0m</td><td style="{TD};{NUM}">€2.4m</td></tr>
<tr><td style="{TD}">Gross contribution · 60%</td><td style="{TD};{NUM}">€0.60m</td><td style="{TD};{NUM}">€1.20m</td><td style="{TD};{NUM}">€1.44m</td></tr>
<tr><td style="{TD}">After incremental opex €600k</td><td style="{TD};{NUM}">€0k (break-even)</td><td style="{TD};{NUM}">€600k</td><td style="{TD};{NUM}">€840k</td></tr></tbody></table></div>
<p style="margin:8px 0 0;font-family:$ui;font-size:13px;color:$t2">{icon("lock", 12)} Frozen in v3. €400k one-time scale-entry investment is separate and not requested here. Payback and cash flow: not available — needs ramp, retention and cash-timing inputs.</p>'''

positions = table(["Reviewer", "Position", "Scope of review", "Version"], [
    [person("DW", "Finance"), f'<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("checkcircle", 14, "$okf")}Supports with conditions</span>', "Margin definition · opex scope · EUR 2026. Not checked: ramp, cash timing.", mono("v3")],
    [person("LH", "Specialist"), f'<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("checkcircle", 14, "$okf")}Supports</span>', "<b style='font-weight:600'>Signed for pilot only: up to 4 sites, 90 days</b> · 23 Nov. Does not cover scale.", mono("v3")],
    [person("PS", "Product"), f'<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("checkcircle", 14, "$okf")}Supports</span>', "Pilot workflow; adaptation list attached", mono("v3")],
    [person("JK", "Pilot owner"), f'<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("checkcircle", 14, "$okf")}Accepts ownership</span>', "Pilot plan, thresholds and budget", mono("v3")],
], minw=600)

brief = f'''<article aria-label="Decision package" style="min-width:0;max-width:760px">
{IF("isStale", '<div style="margin-bottom:14px">' + banner("warn", "This snapshot is out of date: the adoption assumption changed on 26 Nov. Approval is disabled.", "Maya Rao edited Base adoption in Economics after Daniel Weber’s review; v3 still shows the earlier value. You can never approve something different from what you read.", btn("See what changed", "s", href="Economics.dc.html") + f'<button type="button" class="bs" onClick="{hv("refresh")}" style="{BTN}border:1px solid $bstrong;color:$t1">{icon("refresh", 15)}Refresh snapshot (creates v4)</button>') + '</div>')}
{IF("refreshed", '<div style="margin-bottom:14px">' + banner("info", "v4 is being prepared by Maya Rao", "You will be asked to review v4. v3 stays read-only and cannot be approved.") + '</div>')}
{IF("isG1", f'''<section aria-label="Gate history" style="margin-bottom:16px;border:1px solid $border;border-radius:8px;overflow:hidden">
<div style="padding:10px 14px;background:$canvas;border-bottom:1px solid $border;font-size:13px;font-weight:600">Gate history · ME-104</div>
<div style="padding:14px;display:flex;flex-direction:column;gap:10px;font-size:13.5px">
<div style="display:flex;gap:10px;align-items:flex-start">{diamond("approved", 18)}<div><b style="font-weight:600">G1 · Approve validation €15k</b> · Approved 16 Oct 2026, 15:02 by Elena Fischer<div style="font-size:12.5px;color:$t2">Snapshot v1 · {mono("2B71·0E4D", 12)} · Rationale: “Bounded spend, clear thresholds, outcome changes the G2 decision.”</div>
<div style="margin-top:8px">{auth_boxes(["Validation outreach to 20 sites · up to €15k", "Discovery interviews and paid pilot commitments"], ["Not a pilot", "Not market entry or scale", "No spend above €15k"])}</div></div></div>
<div style="display:flex;gap:10px;align-items:center">{diamond("approved", 18)}<div><b style="font-weight:600">G0 · Approve mandate</b> · Approved 5 Oct 2026 by Elena Fischer · scope v2</div></div>
<div style="display:flex;gap:10px;align-items:center">{diamond("superseded", 18)}<div style="color:$t2"><b style="font-weight:600">G2 · Package v2</b> · Superseded by v3 on 25 Nov · never decided</div></div></div></section>''')}
<div style="border:1px solid $border;border-radius:8px;padding:22px 26px 6px;background:$surface">
<div style="font-size:12.5px;color:$t3;display:flex;gap:8px;align-items:center;flex-wrap:wrap">Decision package {mono("ME-104")} · G2 · Snapshot v3 · {mono("7F3A·19C2")}<span style="display:inline-flex;gap:4px;align-items:center">{icon("lock", 12)}Read-only</span><span>· Submitted by Maya Rao · 25 Nov, 16:40</span></div>
<h2 style="margin:8px 0 0;font-family:$serif;font-size:28px;line-height:36px;font-weight:600;text-wrap:balance">Pilot: German food-processing plants</h2>
<div style="margin-top:10px;font-size:12.5px;color:$t2;display:flex;gap:6px;align-items:center;flex-wrap:wrap">{icon("compare", 13)}Changes since v2, which you viewed on 24 Nov: specialist sign-off added · stop rules added · condition C1 added</div>
<div style="margin-top:16px;padding:14px 16px;background:$canvas;border-radius:6px;border:1px solid $border"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:4px">THE ASK</div>
<p style="{SER};font-size:16.5px;line-height:27px">Approve a 90-day paid pilot at up to 4 German food-processing sites, with a budget of up to <b style="font-weight:600">€120k</b>, owned by Jonas Klein. This is not market entry and not a scale decision.</p></div>
{sec(1, "Scope", scope)}
{sec(2, "Recommendation", f'<p style="{SER}"><span style="font-family:$ui;font-size:12px;font-weight:600;color:$t2;border:1px dashed $ctrl;border-radius:4px;padding:1px 6px;margin-right:6px;vertical-align:2px">RECOMMENDATION</span>Approve the pilot with condition C1. Validation thresholds were met; adoption at scale remains unproven and is what the pilot tests.</p>')}
{sec(3, "Alternatives considered", f'<ul style="{UL}"><li><b style="font-weight:600">No entry.</b> Stop here; keep €120k. We would not learn deployment effort or renewal intent.</li><li><b style="font-weight:600">Extend validation without a pilot.</b> Cheaper, but interviews do not show paid use.</li><li><b style="font-weight:600">Partner resale only.</b> No deployment learning for Aster.</li></ul>')}
{sec(4, "Validation results", f'<div style="display:flex;flex-direction:column;gap:8px;font-family:$ui;font-size:14px"><div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center">{result("Met", "9 interviews · threshold 8")}{result("Met", "4 paid commitments · threshold 4")}{kind("Actual", "19 Oct–20 Nov", small=True)}</div><p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;color:$t2">Limitation: interviews do not validate conversion or full-market demand. 20 selected sites are not a random sample.</p></div>')}
{sec(5, "Critical assumptions", f'<div style="display:flex;flex-wrap:wrap;gap:8px">{assumption_chip("Adoption 20% by year 3", "Maya Rao", True)}{assumption_chip("€20k annual price", "Maya Rao")}{assumption_chip("Channel reaches 500 sites", "Jonas Klein")}{assumption_chip("Capacity 120", "[Operations lead]")}</div>')}
{sec(6, "Economics from snapshot", econ)}
{sec(7, "Sign-offs and reviewer positions", positions)}
{sec(8, "Budget and stop rules", f'<ul style="{UL}"><li>Approved budget ceiling €120k. Spend above it needs a scope-change request and a new authorization.</li><li>Pause if a specialist condition is breached.</li><li>Day-90 review against pre-registered thresholds: paid use and continuation at 4 of 4 pilot customers; deployment effort within the assumed [hours per site].</li></ul>')}
{sec(9, "Conditions", f'<div style="display:flex;flex-direction:column;gap:8px;font-family:$ui">{condition("C1", "Pilot limited to 4 sites as signed by the specialist", "Jonas Klein", "1 Dec", True)}{condition("C2", "Log deployment effort per site every week", "Jonas Klein", "Weekly", False)}{FOR("addedConds", "c", f"<div style=\'border:1px solid $border;border-radius:8px;padding:10px 12px;font-size:13.5px;display:flex;gap:8px;flex-wrap:wrap;align-items:center\'>{mono(hv('c.id'), 12, '$t1')}<b style=\'font-weight:500;flex:1 1 200px\'>{hv('c.text')}</b><span style=\'font-size:12px;color:$t2\'>Added by Elena Fischer at approval · {hv('c.flag')}</span></div>", 1)}</div>')}
{sec(10, "Dissent", dissent("DW", "I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use. I support the pilot because it tests exactly this.", "24 Nov, 17:05", "Scope: adoption assumption · signed on v3"))}
{sec(11, "Known limitations", f'<ul style="{UL}"><li>Four sites cannot show market-wide adoption.</li><li>Deployment effort is estimated, not measured.</li><li>Specialist sign-off covers the pilot only.</li></ul>')}
{sec(12, "Sources", f'<div style="display:flex;flex-wrap:wrap;gap:6px">{src("Site census", "3 Jun 2026")}{src("Trade survey", "2026", "Some")}{src("Partner coverage list", "10 Oct", "Some")}{src("EXP-03 results", "20 Nov")}</div>')}
</div></article>'''

STAMPS = [("stAwait", "awaiting"), ("stOk", "approvedc"), ("stRet", "returned"), ("stNo", "notapproved"), ("stAbs", "notstarted")]
stamps = "".join(IF(k, f'<span style="display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:2px 10px;border-radius:4px;border:1.5px solid {DIA[d][0]};font-size:13px;font-weight:600;color:$t1">{diamond(d, 16)}{hv("stampText")}</span>', k == "stAwait") for k, d in STAMPS)

panel = f'''<aside aria-label="Approval panel" style="border:1px solid $border;border-radius:8px;padding:16px 18px;background:$surface;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start"><span style="font-size:12px;color:$t3;font-weight:500">Gate G2 · status</span><div role="status" aria-live="polite">{stamps}</div></div>
<dl style="margin:0;display:grid;grid-template-columns:96px 1fr;gap:6px 10px;font-size:13px">
<dt style="color:$t3">Version</dt><dd style="margin:0;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="font-weight:600">Snapshot v3</b>{icon("fingerprint", 13, "$t2")}{mono("7F3A·19C2", 12)}</dd>
<dt style="color:$t3">Expires</dt><dd style="margin:0">If unused by 11 Dec 2026</dd></dl>
<div style="font-size:13px;padding:10px 12px;background:$canvas;border-radius:6px"><div style="font-weight:500">Your authority</div><div style="color:$t2">Up to €[limit] · BU Water · pilots and validation <span style="color:$t3">(policy placeholder)</span></div></div>
{auth_boxes(["Pilot at up to 4 German food-processing sites", "Up to €120k · 90 days, 1 Dec 2026 – 28 Feb 2027", "Creating the approved pilot tasks"], ["Not market entry", "Not scale", "Not prospect outreach", "Not spend above €120k"])}
<div><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Approval chain · 1 of 1 required</div>
<div style="display:flex;gap:10px;align-items:center;font-size:13px">{avatar("EF")}<div style="flex:1"><div style="font-weight:500">Elena Fischer {hv("youTag")}</div><div style="font-size:12px;color:$t2">Pilot spend in BU Water routes to the BU VP</div></div><span style="font-size:12.5px;color:$t2">{hv("chainState")}</span></div></div>
{IF("isUnauth", f'<div style="border-top:1px solid $border;padding-top:14px">{banner("lock", "You authored this package and cannot approve it.", "Viewing as Maya Rao. Only Elena Fischer can decide G2 v3. You can comment or withdraw the package.", btn("Withdraw v3", "s"), live=False)}</div>')}
{IF("canAct", f'''<div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid $border;padding-top:14px">
{IF("noMode", f"""<div style="display:flex;flex-direction:column;gap:8px">{approve_btn("Approve pilot €120k · 90 days", handler="mApprove")}
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">{btn("Return for revision", "s", handler="mReturn", extra="padding:0 6px;font-size:12.5px;white-space:normal;line-height:16px")}{btn("Not approved", "s", handler="mNo", extra="padding:0 6px;font-size:12.5px")}{btn("Abstain", "s", handler="mAbs", extra="padding:0 6px;font-size:12.5px")}</div></div>""", True)}
{IF("hasMode", f"""<div style="display:flex;flex-direction:column;gap:10px"><div style="font-size:14px;font-weight:600">{hv("modeTitle")}</div>
<fieldset style="border:0;margin:0;padding:0"><legend style="font-size:12.5px;font-weight:500;margin-bottom:6px">Rationale (required)</legend><div style="display:flex;flex-wrap:wrap;gap:6px">{FOR("reasons", "r", f'<button type="button" onClick="{hv("r.pick")}" aria-pressed="{hv("r.on")}" style="{hv("r.style")}">{hv("r.label")}</button>', 3)}</div></fieldset>
<label for="note" style="font-size:12.5px;font-weight:500">Note <span style="color:$t3;font-weight:400">(optional)</span><textarea id="note" rows="2" style="{INP};margin-top:6px"></textarea></label>
{IF("showConds", f'<fieldset style="border:0;margin:0;padding:0"><legend style="font-size:12.5px;font-weight:500;margin-bottom:6px">Add conditions (optional)</legend>{FOR("condOpts", "c", f"<label style=\'display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:4px 0;cursor:pointer\'><input type=\'checkbox\' checked=\'{hv("c.on")}\' onChange=\'{hv("c.pick")}\' style=\'width:16px;height:16px;margin:2px 0 0;accent-color:#3049C9\'><span>{hv("c.text")} <span style=\'color:$t3\'>· {hv("c.flag")}</span></span></label>", 2)}</fieldset>')}
<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onClick="{hv("confirm")}" disabled="{hv("noReason")}" style="{BTN}{hv("confirmStyle")}">{hv("confirmLabel")}</button>{btn("Cancel", "g", handler="cancel")}</div>
<p style="margin:0;font-size:12px;color:$t3">{hv("modeNote")}</p></div>""")}</div>''', True)}
{IF("cantAct", f'<div style="border-top:1px solid $border;padding-top:14px;display:flex;flex-direction:column;gap:8px">{approve_btn("Approve pilot €120k · 90 days", disabled=True)}<p role="status" style="margin:0;font-size:12.5px;color:$t2">{hv("cantReason")}</p></div>')}
{IF("isDone", f'<div style="border-top:1px solid $border;padding-top:14px;display:flex;flex-direction:column;gap:8px"><p style="margin:0;font-size:13px">{hv("doneNote")}</p>{IF("isApproved", btn("Open pilot plan", "s", href="Pilot.dc.html", ic="arrowr", extra="align-self:flex-start"))}</div>')}
</aside>'''

body = f'''{proto_bar([("Variant", "varBtns")])}
<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<div style="flex:999 1 600px;min-width:0">{brief}</div>
<div style="flex:1 1 340px;min-width:0;max-width:440px">{panel}</div></div>'''

js = logic(r"""    const s = this.state;
    const v = s.v, r = s.result;
    const MODES = {
      approve: { t: 'Approve pilot €120k · 90 days · v3', opts: ['Validation thresholds met; scope is bounded', 'Stop rules and owner are clear', 'Dissent is addressed by the pilot design'], btn: 'Approve pilot €120k · 90 days', note: 'Records your identity, time, authority and fingerprint 7F3A·19C2. Tasks are created separately by Jonas Klein.' },
      ret: { t: 'Return for revision', opts: ['Clarify deployment-effort threshold', 'Add finance re-check of adoption', 'Narrow budget lines'], btn: 'Return for revision', note: 'Maya Rao revises and submits v4. Your comment is kept.' },
      no: { t: 'Not approved', opts: ['Evidence insufficient for a paid pilot', 'Outside BU priorities this cycle', 'Prefer no entry'], btn: 'Record: Not approved', note: 'A recorded decision, not a failure. The case stays open for a stop or revision decision.' },
      abs: { t: 'Abstain', opts: ['Conflict of interest', 'Outside my authority', 'Need more time'], btn: 'Record abstention', note: 'Routes to the next approver under policy.' }
    };
    const md = s.mode ? MODES[s.mode] : null;
    const CONDS = [{ id: 'C3', text: 'Finance re-checks adoption at the day-90 review', flag: 'Monitor only' }, { id: 'C4', text: 'No outreach beyond the 4 committed sites', flag: 'Blocks execution until met' }];
    const condOpts = CONDS.map(c => ({ text: c.text, flag: c.flag, on: !!s.conds[c.id], pick: () => this.setState({ conds: Object.assign({}, s.conds, { [c.id]: !s.conds[c.id] }) }) }));
    const reasons = md ? md.opts.map(o => ({ label: o, on: s.reason === o ? 'true' : 'false', pick: () => this.setState({ reason: o }), style: this.chipStyle(s.reason === o) })) : [];
    const stale = v === 'stale', unauth = v === 'unauth';
    const approved = r && r.k === 'ok';
    let stamp = 'stAwait', stampText = 'Awaiting decision · due 27 Nov';
    if (r) { stamp = { ok: 'stOk', ret: 'stRet', no: 'stNo', abs: 'stAbs' }[r.k]; stampText = { ok: 'Approved with conditions · ' + r.n + ' conditions', ret: 'Returned for revision', no: 'Not approved', abs: 'Abstained' }[r.k] + ' · 27 Nov, 09:14'; }
    const st = {}; ['stAwait', 'stOk', 'stRet', 'stNo', 'stAbs'].forEach(k => { st[k] = k === stamp; });
    const confirm = () => {
      if (!s.reason) return;
      const n = 2 + Object.keys(s.conds).filter(k => s.conds[k]).length;
      this.setState({ result: { k: { approve: 'ok', ret: 'ret', no: 'no', abs: 'abs' }[s.mode], n }, mode: null, reason: null });
    };
    const added = approved ? CONDS.filter(c => s.conds[c.id]) : [];
    const canAct = !stale && !unauth && !r;
    return Object.assign(st, {
      varBtns: [['await', 'Awaiting decision'], ['stale', 'Stale snapshot'], ['unauth', 'Unauthorized reviewer'], ['g1', 'G1 history']].map(o => ({ label: o[1], on: v === o[0] ? 'true' : 'false', style: this.segStyle(v === o[0]),
        pick: () => this.setState({ v: o[0], mode: null, reason: null, result: null, refreshed: false }) })),
      hAwait: !approved, hOk: approved, stampText,
      isStale: stale && !s.refreshed, refreshed: stale && s.refreshed, refresh: () => this.setState({ refreshed: true }),
      isG1: v === 'g1', isUnauth: unauth,
      youTag: unauth ? '' : '· you', chainState: approved ? 'Approved' : r ? 'Decided' : 'Waiting',
      canAct, cantAct: stale, cantReason: s.refreshed ? 'v3 cannot be approved. Wait for v4.' : 'Approval disabled: snapshot v3 is out of date. Refresh to create v4.',
      noMode: !s.mode, hasMode: !!s.mode, modeTitle: md ? md.t : '', modeNote: md ? md.note : '', reasons, noReason: !s.reason,
      showConds: s.mode === 'approve', condOpts,
      confirmLabel: md ? md.btn : '',
      confirmStyle: s.reason ? (s.mode === 'approve' ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$t1;color:#fff;border:1px solid $t1;cursor:pointer;') : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;',
      mApprove: () => this.setState({ mode: 'approve', reason: null }), mReturn: () => this.setState({ mode: 'ret', reason: null }),
      mNo: () => this.setState({ mode: 'no', reason: null }), mAbs: () => this.setState({ mode: 'abs', reason: null }),
      cancel: () => this.setState({ mode: null, reason: null }), confirm,
      isDone: !!r, isApproved: approved,
      doneNote: approved ? 'Pilot approved for v3 only. Conditions marked “Blocks execution” must be met before Jonas Klein activates the plan. Material changes invalidate this approval.' : r ? 'Decision recorded with your rationale. Maya Rao is notified.' : '',
      addedConds: added
    });""", "{ v: 'await', mode: null, reason: null, conds: {}, result: null, refreshed: false }")

page("Decisions.dc.html", "Decision Package", shell("Reviews", "Fri 27 Nov 2026", headers + body, user="EF", counts={"Reviews": "1"}), js, height=2500)
