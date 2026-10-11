from components import *

nxt = next_block(hv("nextTitle"), hv("nextSub"), "EF",
                 f'<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:$t2">{diamond("blocked", 13)}G3 Scale blocked · 2 preconditions unmet</div>')
header = case_header("Outcomes", stage("Validation"), 2, G_REVIEW, nxt, "Actuals recorded 4 Mar 2027 · current")

SER = "margin:0;font-family:$serif;font-size:17px;line-height:28px;color:$t1"

lead = f'''<section aria-labelledby="dr" style="border:1px solid $border;border-radius:8px;padding:20px 22px;background:$surface;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center">{icon("filetext", 18, "$t2")}<h1 id="dr" style="margin:0;font-size:20px;line-height:28px;font-weight:600">Decision recorded: Revise and extend validation</h1>
<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:$t1;border:1px solid $t1;border-radius:4px;padding:0 6px;font-weight:600">Key decision</span></div>
<div style="font-size:13px;color:$t2">Elena Fischer · 5 Mar 2027, 11:20 · on Maya Rao’s recommendation · pilot review v1</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px 28px">
<div>{eyebrow("What we learned")}<ul style="margin:0;padding-left:20px;font-family:$serif;font-size:16px;line-height:26px">
<li>Three of four pilot customers met the paid-use and continuation threshold; one did not.</li>
<li>Deployment effort per site was above the assumption. Installation needs more operations time than planned.</li>
<li>The specialist sign-off covered the pilot only. Scale readiness has not been reviewed.</li></ul></div>
<div>{eyebrow("What changes next")}<ul style="margin:0;padding-left:20px;font-family:$serif;font-size:16px;line-height:26px">
<li>A scoped extension with its own spend cap tests deployment effort and the fourth site.</li>
<li>Lena Hoffmann scopes a scale-readiness review.</li>
<li>Daniel Weber re-checks the adoption assumption (condition C3).</li></ul></div></div></section>'''


def res_cell(r, extra=""):
    return result(r, extra)


actuals = table(["Metric", "Threshold · pre-registered at G2 v3", "Actual", "Result"], [
    ["Paid use and continuation", "4 of 4 pilot customers", f'<b style="font-weight:700">3 of 4</b> {kind("Actual", "1 Dec–28 Feb", small=True)}<div style="font-size:12px;color:$t2;margin-top:3px">Source: billing records</div>', res_cell("Not met")],
    ["Deployment effort per site", "Within [hours per site] assumed", f'<b style="font-weight:700">Above assumption</b> · [actual hours per site] {kind("Actual", "weekly log", small=True)}<div style="font-size:12px;color:$t2;margin-top:3px">Source: effort log (C2)</div>', res_cell("Not met")],
    ["Buyer fit", "Qualitative · interview notes", f'<b style="font-weight:700">Mixed</b> {kind("Actual", "Feb interviews", small=True)}<div style="font-size:12px;color:$t2;margin-top:3px">Source: interview notes</div>', res_cell("Inconclusive")],
    ["Spend", "Within €120k approved", f'€[spent] of €120k {kind("Unknown", "placeholder", small=True)}', '<span style="color:$t2">Not a threshold</span>'],
], minw=760, aria="Baseline versus actuals")

chart = f'''<section aria-labelledby="pu" style="border:1px solid $border;border-radius:8px;padding:14px 16px">
<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><h2 id="pu" style="margin:0;font-size:14px;font-weight:600">Pilot customers meeting the paid-use threshold</h2>{seg("chBtns", "Chart or table")}</div>
<p style="margin:4px 0 10px;font-size:12px;color:$t2">Count of pilot customers · 1 Dec 2026 – 28 Feb 2027 · threshold 4 of 4 (pre-registered)</p>
{IF("chChart", '''<svg role="img" aria-label="Actual 3 of 4 pilot customers met the threshold; threshold is 4 of 4" viewBox="0 0 360 120" style="width:100%;max-width:520px;height:auto;display:block;font-family:Geist,sans-serif">
<line x1="40" y1="100" x2="340" y2="100" stroke="#D6D6D0"></line>
<rect x="60" y="40" width="80" height="60" fill="#17191B"></rect><text x="100" y="34" font-size="12" fill="#17181B" text-anchor="middle" font-weight="700">■ Actual 3</text>
<rect x="200" y="20" width="80" height="80" fill="none" stroke="#4B4F57" stroke-dasharray="4 2"></rect><text x="240" y="14" font-size="12" fill="#4B4F57" text-anchor="middle">Threshold 4 (pre-registered)</text>
<text x="100" y="114" font-size="11" fill="#4B4F57" text-anchor="middle">Met threshold</text><text x="240" y="114" font-size="11" fill="#4B4F57" text-anchor="middle">Required</text></svg>''', True)}
{IF("chTable", table(["Series", ">Pilot customers"], [["Actual · met threshold", "3"], ["Threshold (pre-registered)", "4"], ["Pilot customers", "4"]], minw=260))}</section>'''

readiness = f'''<section aria-labelledby="rd" style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
<h2 id="rd" style="margin:0;font-size:14px;font-weight:600">Readiness and limitations</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center">{review("Pending", "specialist scale-readiness · incomplete")}{person("LH")}</div>
<p style="margin:0;font-size:13px;color:$t2">Pilot review does not cover scale. Signed scope: up to 4 sites, 90 days.</p>
<div>{eyebrow("Causal limitations (required)")}<ul style="margin:0;padding-left:18px;font-size:13px;line-height:20px"><li>4 sites, no comparison group.</li><li>Winter production period only.</li><li>Results describe these sites, not the 500-site pool.</li><li>No revenue is attributed to the pilot beyond its own billing.</li></ul></div></section>'''

gate3 = f'''<section aria-labelledby="g3" style="border:1px solid $wnf;border-radius:8px;padding:14px 16px;background:$surface;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;gap:8px;align-items:center">{diamond("blocked", 20)}<h2 id="g3" style="margin:0;font-size:14px;font-weight:600">G3 · Scale / enter market — Blocked</h2></div>
<p style="margin:0;font-size:13px">2 preconditions unmet:</p>
<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:13px">
<li style="display:flex;gap:8px;align-items:flex-start">{icon("targetdash", 15, "$ntf")}<span><b style="font-weight:600">Demand threshold</b> · 3 of 4 met; 4 of 4 required</span></li>
<li style="display:flex;gap:8px;align-items:flex-start">{icon("dashcircle", 15, "$ntf")}<span><b style="font-weight:600">Specialist scale-readiness review</b> · incomplete</span></li></ul>
{approve_btn("Authorize scale", disabled=True)}
<p style="margin:0;font-size:12px;color:$t3">Requesting scale approval is disabled until both preconditions are met. The €400k one-time scale-entry investment is not requested.</p></section>'''

INP = "width:100%;box-sizing:border-box;min-height:36px;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"
ext_form = f'''<section aria-labelledby="xf" style="border:1px solid $acc;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px;background:$surface">
<h2 id="xf" style="margin:0;font-size:15px;font-weight:600">Request extension · new gate request</h2>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
<div><span style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Spend cap</span><div style="{INP};background:$canvas;font-family:$mono">€[cap]</div><div style="font-size:12px;color:$wnf;margin-top:4px">Placeholder · confirm with PM. The PRD sets no amount.</div></div>
<div><span style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Duration</span><div style="{INP};background:$canvas">[duration] days</div></div>
<div><span style="display:block;font-size:13px;font-weight:500;margin-bottom:6px">Owner</span><div style="{INP};background:$canvas;display:flex;gap:8px;align-items:center">{avatar("JK", 20)}Jonas Klein</div></div></div>
<fieldset style="border:0;margin:0;padding:0"><legend style="font-size:13px;font-weight:500;margin-bottom:6px">Scope (choose at least one)</legend>
{FOR("scopes", "c", f'<label style="display:flex;gap:8px;align-items:center;font-size:13px;padding:4px 0;cursor:pointer"><input type="checkbox" checked="{hv("c.on")}" onChange="{hv("c.pick")}" style="width:16px;height:16px;margin:0;accent-color:#3049C9">{hv("c.t")}</label>', 3)}</fieldset>
{auth_boxes(["Extension work within €[cap] and the chosen scope", "The existing 4 pilot sites"], ["Not scale", "No new sites without a new gate", "Does not unblock G3"], "This extension would authorize", "It would not authorize")}
<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" onClick="{hv("submitExt")}" disabled="{hv("noScope")}" style="{BTN}{hv("subStyle")}">Submit extension request €[cap]</button>{btn("Cancel", "g", handler="closeExt")}</div></section>'''

ext_done = f'''<section aria-label="Extension request" style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">
{gate_chip("awaiting", "Extension €[cap] · Awaiting decision · Elena Fischer")}<span style="font-size:12.5px;color:$t2">{mono("ME-104-X1", 12)} · submitted 5 Mar 2027, 14:05 · {hv("scopeSummary")}</span>
<span style="font-size:12.5px;color:$t3;flex-basis:100%">A new authorization with its own cap. The original scale gate stays blocked.</span></section>'''

actions = f'''<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
{IF("canRequest", btn("Request extension €[cap]", "p", handler="openExt", ic="plus"), True)}
{btn("Revise thesis", "s", href="Thesis.dc.html", ic="pencil")}{btn("Stop case (decision)", "s", ic="squarestop")}{btn("Request scale approval", "s", disabled=True)}
<span style="font-size:12.5px;color:$t3">Scale request disabled: G3 preconditions unmet.</span></div>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
{lead}
{actions}
{IF("showForm", ext_form)}
{IF("submitted", ext_done)}
{h2("Baseline versus actuals", "Thresholds were agreed before activation and have not moved.")}
{card(actuals, "overflow:hidden")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px">{chart}{readiness}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px">
<section aria-labelledby="rc" style="border:1px dashed $ctrl;border-radius:8px;padding:14px 16px;background:$canvas"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:6px">RECOMMENDATION · ACCEPTED</div><h2 id="rc" style="margin:0;font-size:16px;font-weight:600">Revise and extend validation</h2><p style="margin:6px 0 0;{SER};font-size:15.5px;line-height:24px">Not scale. Test deployment effort and the fourth site under a scoped extension before any G3 request.</p></section>
{gate3}</div>
<section aria-labelledby="tl">{h2("Key events", hid="tl")}<ul style="list-style:none;margin:0;padding:0;border-top:1px solid $border">
{activity_item("EF", "Decision recorded: Revise and extend validation", "Pilot review v1 · rationale attached", "5 Mar 2027, 11:20", True)}
{activity_item("JK", "Actuals recorded for 1 Dec–28 Feb", "Billing records · effort log · interview notes", "4 Mar 2027, 16:10")}
{activity_item("EF", "Approved pilot €120k · 90 days (G2) with conditions", "Snapshot v3 · 7F3A·19C2", "27 Nov 2026, 09:14", True)}</ul></section>
</div>'''

js = logic(r"""    const s = this.state;
    const S = ['Deployment-effort study at the 4 pilot sites', 'Specialist scale-readiness review', 'Renewal-intent follow-up with the fourth site'];
    const scopes = S.map((t, i) => ({ t, on: !!s.sc[i], pick: () => this.setState({ sc: Object.assign({}, s.sc, { [i]: !s.sc[i] }) }) }));
    const n = S.filter((t, i) => s.sc[i]).length;
    return {
      chBtns: this.seg([['chart', 'Chart'], ['table', 'Table']], 'ch'), chChart: s.ch === 'chart', chTable: s.ch === 'table',
      canRequest: !s.form && !s.sub, showForm: s.form && !s.sub, submitted: s.sub,
      openExt: () => this.setState({ form: true }), closeExt: () => this.setState({ form: false }),
      scopes, noScope: n === 0,
      subStyle: n ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;',
      submitExt: () => { if (n) this.setState({ sub: true, form: false }); },
      scopeSummary: S.filter((t, i) => s.sc[i]).join(' · '),
      nextTitle: s.sub ? 'Extension €[cap] · awaiting decision' : 'Request extension €[cap]',
      nextSub: s.sub ? 'Elena Fischer decides' : 'Maya Rao prepares · Elena Fischer decides'
    };""", "{ ch: 'chart', form: false, sub: false, sc: { 0: true, 1: true } }")

page("Outcomes.dc.html", "Outcome Review", shell("Expansion Cases", "Fri 5 Mar 2027", header + body, user="MR", autosave="Saved · just now"), js, height=2200)
