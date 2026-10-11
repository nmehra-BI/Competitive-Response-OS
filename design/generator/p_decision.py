from common import *

EF = '<span aria-hidden="true" style="width:28px;height:28px;border-radius:50%;background:$ntb;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">{}</span>'


def nb(ini, title, sub, extra=""):
    return f'<div style="display:flex;align-items:center;gap:10px">{EF.format(ini)}<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">{title}</div><div style="font-size:12.5px;color:$t2">{sub}</div></div></div>{extra}'


H = {
    "hV2": case_header("Decision", "Awaiting approval · v2", "Decide", "Partial", "12 Oct, 16:05", nb("EF", "Awaiting your decision", "Approve response · v2 · submitted 12 Oct, 16:05")),
    "hGen": case_header("Decision", "Ready for decision", "Decide", "Partial", "{{ updated }}", nb("MP", "{{ nextTitle }}", "{{ nextSub }}")),
    "hV3": case_header("Decision", "Awaiting approval · v3", "Decide", "Partial", "14 Oct, 10:42", nb("EF", "Awaiting your decision", "Approve response · v3 · submitted 14 Oct, 10:42")),
    "hOk": case_header("Decision", "Approved", "Decide", "Partial", "{{ updated }}", nb("MP", "Waiting on Maya Patel", "Authorize and release plan · approval is separate from release", f'<a href="ActionPlan.dc.html" style="display:inline-flex;gap:4px;align-items:center;margin-top:10px;font-size:12.5px;font-weight:500;text-decoration:none">Open action plan{icon("chevr", 13)}</a>')),
}
headers = "".join(f'<sc-if value="{{{{ {k} }}}}" hint-placeholder-val="{{{{ {"true" if k == "hV3" else "false"} }}}}">{v}</sc-if>' for k, v in H.items())

seg = "display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas;flex-wrap:wrap"
proto = f'''<div role="region" aria-label="Prototype controls" style="display:flex;flex-wrap:wrap;gap:8px 20px;align-items:center;padding:10px 24px;border-bottom:1px dashed $bstrong;background:$canvas;font-size:12.5px;color:$t2">
<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("sliders", 14)}Prototype states</span>
<div role="group" aria-label="Journey step" style="{seg}"><sc-for list="{{{{ stepBtns }}}}" as="b" hint-placeholder-count="4"><button type="button" onClick="{{{{ b.pick }}}}" aria-pressed="{{{{ b.on }}}}" style="{{{{ b.style }}}}">{{{{ b.label }}}}</button></sc-for></div>
<span style="color:$t3">Variant</span>
<div role="group" aria-label="Variant" style="{seg}"><sc-for list="{{{{ varBtns }}}}" as="b" hint-placeholder-count="4"><button type="button" onClick="{{{{ b.pick }}}}" aria-pressed="{{{{ b.on }}}}" style="{{{{ b.style }}}}">{{{{ b.label }}}}</button></sc-for></div></div>'''

S = "margin:0;font-family:$serif;font-size:17px;line-height:28px;color:$t1"
H3 = "margin:0 0 8px;font-family:$ui;font-size:12.5px;font-weight:600;color:$t2;letter-spacing:0.02em"
INS = "text-decoration:underline;text-decoration-color:#1B7046;text-decoration-thickness:1.5px;text-underline-offset:3px;background:$okb"
DEL = "text-decoration:line-through;color:$t3;background:$dgb"
lab_add = f'<span style="font-family:$ui;font-size:11px;font-weight:600;color:$okf;margin-right:4px;vertical-align:2px">+ Added</span>'
lab_rem = f'<span style="font-family:$ui;font-size:11px;font-weight:600;color:$dgf;margin-right:4px;vertical-align:2px">− Removed</span>'


def sec(n, title, inner, anchor=""):
    return f'<section aria-label="{title}" style="padding:22px 0;border-top:1px solid $border"><h3 style="{H3}">{n} · {title.upper()}</h3>{inner}{anchor}</section>'


acc_v2 = "Account review of affected accounts in Germany."
acc_v3 = "Account review of 18 distinct affected accounts in the German segment (ND-200, confirmed use case 1). Restricted rows are summarised by their owner."
chosen = f'''<ol style="margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px">
<li><b style="font-weight:600">Update positioning.</b> Germany positioning brief with cited comparison limits, owned by Jonas Weber.</li>
<li><b style="font-weight:600">Account review.</b>
<sc-if value="{{{{ showDiff }}}}" hint-placeholder-val="{{{{ true }}}}"><span>{lab_rem}<del style="{DEL}">{acc_v2}</del> {lab_add}<ins style="{INS}">{acc_v3}</ins></span></sc-if>
<sc-if value="{{{{ plainV3 }}}}" hint-placeholder-val="{{{{ false }}}}"><span>{acc_v3}</span></sc-if>
<sc-if value="{{{{ plainV2 }}}}" hint-placeholder-val="{{{{ false }}}}"><span>{acc_v2}</span></sc-if> Owned by Sofia Klein.</li></ol>'''
anchor_comment = f'''<sc-if value="{{{{ showAnchor }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-top:12px;border:1px solid $wnf;border-radius:8px;padding:10px 12px;background:$wnb;font-family:$ui">
<div style="display:flex;gap:8px;align-items:center;font-size:12.5px"><b style="font-weight:600">Elena Fischer</b><span style="color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("message", 12)}Requested changes on this section</span><span style="margin-left:auto;color:$t3">13 Oct, 09:30</span></div>
<p style="margin:4px 0 0;font-size:13.5px;line-height:20px">Which accounts are in scope? Please also confirm the positioning brief will not claim clinical equivalence.</p></div></sc-if>
<sc-if value="{{{{ showResolved }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="margin-top:10px;font-family:$ui;font-size:12.5px;color:$okf;display:flex;gap:6px;align-items:center">{icon("checkcircle", 13)}Addresses Elena Fischer’s 13 Oct comment</div></sc-if>'''

lim_add = "The positioning brief will not claim clinical-performance equivalence with AX-Scan."
limits = f'''<ul style="margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px">
<li>Regulatory status of AX-Scan in Germany is unverified (single trade source).</li>
<li>Clinical-performance equivalence is unresolved; sources conflict.</li>
<li>Reimbursement status is unknown.</li>
<li>Exposure uses the 30 Sep 2026 CSV snapshot; CRM is not connected.</li>
<sc-if value="{{{{ showDiff }}}}" hint-placeholder-val="{{{{ true }}}}"><li>{lab_add}<ins style="{INS}">{lim_add}</ins></li></sc-if>
<sc-if value="{{{{ plainV3 }}}}" hint-placeholder-val="{{{{ false }}}}"><li>{lim_add}</li></sc-if></ul>'''

TDs = "padding:8px 10px;border-bottom:1px solid $border;font-size:13px;vertical-align:top"
expo_tbl = f'''<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-family:$ui;min-width:520px">
<thead><tr><th scope="col" style="{TDs};text-align:left;color:$t3;font-weight:500;font-size:12px">Measure</th><th scope="col" style="{TDs};text-align:right;color:$t3;font-weight:500;font-size:12px">Value</th><th scope="col" style="{TDs};text-align:left;color:$t3;font-weight:500;font-size:12px">Definition</th></tr></thead>
<tbody><tr><td style="{TDs}">Relevant annual revenue</td><td style="{TDs};text-align:right;font-weight:600">€24.0M</td><td style="{TDs};color:$t2">TTM to 30 Sep 2026 · ND-200 · German segment</td></tr>
<tr><td style="{TDs}">Affected existing accounts</td><td style="{TDs};text-align:right;font-weight:600">18</td><td style="{TDs};color:$t2">Distinct accounts in confirmed scope</td></tr>
<tr><td style="{TDs}">Open pipeline</td><td style="{TDs};text-align:right;font-weight:600">€6.0M</td><td style="{TDs};color:$t2">Current opportunities · not recognized revenue · not added to revenue</td></tr></tbody></table></div>
<p style="{S};font-size:15px;line-height:24px;color:$t2;margin-top:8px">There is no combined total. Revenue and pipeline measure different things.</p>'''

TASKS = [("Validate competitor claims and comparison limits", "[ND-200 product manager]", "Day 2 · 17 Oct"), ("Update Germany positioning brief", "Jonas Weber", "Day 5 · 20 Oct"),
         ("Review 18 affected accounts", "Sofia Klein", "Day 10 · 25 Oct"), ("Review early response outcomes", "Maya Patel", "Day 30 · 14 Nov")]
owners = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-family:$ui;min-width:520px"><tbody>' + "".join(
    f'<tr><td style="{TDs}">{a}</td><td style="{TDs}">{b}</td><td style="{TDs};color:$t2;white-space:nowrap">{c}</td></tr>' for a, b, c in TASKS) + '</tbody></table></div><p style="margin:8px 0 0;font-family:$ui;font-size:12.5px;color:$t3">Due dates assume plan release on 15 Oct 2026.</p>'

brief = f'''<article aria-label="Decision brief" style="max-width:720px;min-width:0">
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;margin-bottom:16px">
<div role="group" aria-label="Version" style="{seg}"><sc-for list="{{{{ verBtns }}}}" as="b" hint-placeholder-count="3"><button type="button" onClick="{{{{ b.pick }}}}" disabled="{{{{ b.disabled }}}}" aria-pressed="{{{{ b.on }}}}" style="{{{{ b.style }}}}">{{{{ b.label }}}}</button></sc-for></div>
<span style="font-size:12.5px;color:$t2">{{{{ verMeta }}}}</span>
<sc-if value="{{{{ canDiff }}}}" hint-placeholder-val="{{{{ true }}}}"><label for="dc-diff" style="margin-left:auto;display:inline-flex;gap:8px;align-items:center;font-size:13px;font-weight:500;cursor:pointer"><input id="dc-diff" type="checkbox" checked="{{{{ diff }}}}" onChange="{{{{ toggleDiff }}}}" style="width:16px;height:16px;accent-color:#3049C9;margin:0">{icon("compare", 14)}Changes since v2</label></sc-if></div>
<sc-if value="{{{{ bSuper }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-bottom:16px">{banner("neutral", "You’re viewing v2. It was superseded by v3 on 14 Oct, 10:42.", "Superseded versions are read-only and can’t be approved.", btn("Open v3", "s", handler="openV3"))}</div></sc-if>
<sc-if value="{{{{ bInvalid }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-bottom:16px">{banner("danger", "Approval of v3 invalidated — evidence changed", "On 16 Oct the regulatory-status source (C-08) was corrected. Unexecuted Jira writes are paused; confirmed tasks keep their references. Maya Patel must reassess and submit v4.", btn("See what changed", "s", href="Evidence.dc.html"))}</div></sc-if>
<sc-if value="{{{{ bRole }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-bottom:16px">{banner("neutral", "Viewing as Jonas Weber · you can read this decision but can’t approve it", "Elena Fischer approves Diagnostics responses. Task ownership does not include approval rights.", btn("Escalate", "s", ic="arrowr"))}</div></sc-if>
<div style="border:1px solid $border;border-radius:8px;padding:22px 26px 6px;background:$surface">
<div style="font-size:12.5px;color:$t3;display:flex;gap:8px;align-items:center;flex-wrap:wrap">Decision package {mono("CR-1042")} · {{{{ verShort }}}} · {mono("{{ fp }}")}<span style="display:inline-flex;gap:4px;align-items:center">{icon("lock", 12)}Read-only</span></div>
<h2 style="margin:8px 0 0;font-family:$serif;font-size:28px;line-height:36px;font-weight:600;text-wrap:balance">Apex AX-Scan Germany launch response</h2>
<div style="margin-top:16px;padding:14px 16px;background:$canvas;border-radius:6px;border:1px solid $border"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:4px">THE ASK</div>
<p style="{S};font-size:16px;line-height:26px">Approve <b style="font-weight:600">Update positioning</b> and <b style="font-weight:600">Account review</b> for Diagnostics · Germany. No pricing change and no new customer communication is authorised.</p></div>
{sec(1, "Event", f'<p style="{S}">On 7 Oct 2026 Apex Diagnostics announced the launch of AX-Scan in Germany for hospital laboratories. {src("Verified", "Apex press release", "8 Oct")}</p>')}
{sec(2, "Confirmed facts", f'<ul style="margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px"><li>The launch was announced for Germany, dated 7 Oct 2026. {src("Verified", "Apex press release", "8 Oct")}</li><li>The notice targets hospital laboratories. {src("Verified", "Apex press release", "8 Oct")}</li><li>AX-Scan overlaps ND-200 in one laboratory use case. {src("Verified", "Analyst review · Maya Patel", "9 Oct")}</li></ul>')}
{sec(3, "Exposure definition", expo_tbl)}
{sec(4, "Assumptions", f'<div style="border:1.5px dashed $ctrl;border-radius:8px;padding:12px 14px;background:$canvas"><p style="{S};font-size:16px;line-height:26px">Scenario range (assumption): 5–15% erosion of relevant annual revenue over 12 months.</p><div style="font-family:$mono;font-size:13px;color:$t2;margin-top:4px">€24.0M × 5–15% = €1.2–3.6M · not predicted loss · set by Maya Patel, 9 Oct</div></div>')}
{sec(5, "Chosen responses", chosen, anchor_comment)}
{sec(6, "Alternatives considered", f'<ul style="margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px"><li><b style="font-weight:600">Monitor only.</b> Not chosen: the launch is verified and overlap is confirmed.</li><li><b style="font-weight:600">Product assessment.</b> Not chosen here: outside this approval scope. Escalate separately if performance claims are supported.</li></ul>')}
{sec(7, "Requested resources", f'<p style="{S}">Product marketing: about 5 days for the positioning brief. Regional sales: account reviews across 18 accounts by Day 10. Product management: claim validation by Day 2.</p>')}
{sec(8, "Owners", owners)}
{sec(9, "Success measures", f'<ul style="margin:0;padding-left:22px;font-family:$serif;font-size:17px;line-height:28px"><li>Positioning brief approved by Day 5.</li><li>18 of 18 accounts reviewed with a summary by Day 10.</li><li>Day-30 outcome review against the 15 Oct baseline.</li></ul>')}
{sec(10, "Known limitations", limits)}
</div></article>'''

STAMPS = [("stAwait", "clock", "$t1", "$bstrong"), ("stChanges", "message", "$wnf", "$wnf"), ("stOk", "check", "$okf", "$okf"),
          ("stRej", "xcircle", "$dgf", "$dgf"), ("stDef", "pause", "$t2", "$bstrong"), ("stInv", "alert", "$dgf", "$dgf"), ("stSup", "history", "$t2", "$bstrong")]
stamps = "".join(f'<sc-if value="{{{{ {k} }}}}" hint-placeholder-val="{{{{ {"true" if k == "stAwait" else "false"} }}}}"><span style="display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:2px 10px;border-radius:4px;border:1.5px solid {bd};color:{c};font-size:13px;font-weight:600">{icon(i, 14)}{{{{ stampText }}}}</span></sc-if>' for k, i, c, bd in STAMPS)

chip_row = f'<div style="display:flex;flex-wrap:wrap;gap:6px"><sc-for list="{{{{ reasons }}}}" as="r" hint-placeholder-count="3"><button type="button" onClick="{{{{ r.pick }}}}" aria-pressed="{{{{ r.on }}}}" style="{{{{ r.style }}}}">{{{{ r.label }}}}</button></sc-for></div>'
cons = f'<sc-if value="{{{{ showCons }}}}" hint-placeholder-val="{{{{ false }}}}"><fieldset style="border:0;margin:12px 0 0;padding:0"><legend style="font-size:12.5px;font-weight:500;margin-bottom:6px">Constraints (optional)</legend><sc-for list="{{{{ consList }}}}" as="c" hint-placeholder-count="3"><label style="display:flex;gap:8px;align-items:flex-start;font-size:13px;padding:4px 0;cursor:pointer"><input type="checkbox" checked="{{{{ c.on }}}}" onChange="{{{{ c.pick }}}}" style="width:16px;height:16px;margin:2px 0 0;accent-color:#3049C9">{{{{ c.label }}}}</label></sc-for></fieldset></sc-if>'

panel = f'''<aside aria-label="Approval" style="flex:1 1 320px;max-width:100%;min-width:0">
<div style="border:1px solid $border;border-radius:8px;padding:16px 18px;background:$surface;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start"><span style="font-size:12px;color:$t3;font-weight:500">Status</span>{stamps}</div>
<div><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">What you are approving</div>
<dl style="margin:0;display:grid;grid-template-columns:96px 1fr;gap:6px 10px;font-size:13px;line-height:19px">
<dt style="color:$t3">Version</dt><dd style="margin:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><b style="font-weight:600">{{{{ verShort }}}}</b>{mono("{{ fp }}")}</dd>
<dt style="color:$t3">Responses</dt><dd style="margin:0">Update positioning · Account review</dd>
<dt style="color:$t3">Owners</dt><dd style="margin:0">Jonas Weber · Sofia Klein · [ND-200 product manager] · Maya Patel</dd>
<dt style="color:$t3">Resources</dt><dd style="margin:0">Brief by Day 5 · 18 account reviews by Day 10</dd>
<dt style="color:$t3">Not included</dt><dd style="margin:0">Pricing changes · customer communication · Jira release</dd></dl></div>
<div style="font-size:13px;line-height:19px;padding:10px 12px;background:$canvas;border-radius:6px"><div style="font-weight:500">Your authority</div><div style="color:$t2">Diagnostics · Germany · positioning and account review</div></div>
<div><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Approval chain · 1 of 1 required</div>
<div style="display:flex;gap:10px;align-items:center;font-size:13px">{EF.format("EF")}<div style="flex:1"><div style="font-weight:500">Elena Fischer <span style="color:$t3;font-weight:400">· you</span></div><div style="font-size:12.5px;color:$t2">Diagnostics BU Head</div></div><span style="font-size:12.5px;color:$t2">{{{{ chainState }}}}</span></div></div>
<sc-if value="{{{{ canAct }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid $border;padding-top:14px">
<sc-if value="{{{{ noMode }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="display:flex;flex-direction:column;gap:8px">
{btn("Approve response", "p", handler="mApprove", ic="check", extra="width:100%")}
<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">{btn("Request changes", "s", handler="mChanges", extra="padding:0 8px;font-size:13px")}{btn("Reject", "s", handler="mReject", extra="padding:0 8px;font-size:13px")}{btn("Defer", "s", handler="mDefer", extra="padding:0 8px;font-size:13px")}</div></div></sc-if>
<sc-if value="{{{{ hasMode }}}}" hint-placeholder-val="{{{{ false }}}}"><div role="dialog" aria-label="Confirm decision" style="display:flex;flex-direction:column;gap:10px">
<div style="font-size:14px;font-weight:600">{{{{ modeTitle }}}}</div>
<div style="font-size:12.5px;font-weight:500">{{{{ reasonLabel }}}}</div>{chip_row}
<label for="dc-note" style="font-size:12.5px;font-weight:500">Rationale details (optional)</label><textarea id="dc-note" rows="2" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13px;resize:vertical"></textarea>
{cons}
<div style="font-size:12px;color:$t3;line-height:17px">{{{{ modeNote }}}}</div>
<div style="display:flex;gap:8px;justify-content:flex-end">{btn("Cancel", "g", handler="cancel")}<button type="button" onClick="{{{{ confirm }}}}" disabled="{{{{ confirmDisabled }}}}" style="{{{{ confirmStyle }}}}">{{{{ confirmLabel }}}}</button></div></div></sc-if>
</div></sc-if>
<sc-if value="{{{{ showOpenV3 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="border-top:1px solid $border;padding-top:14px;display:flex;flex-direction:column;gap:8px"><div style="font-size:13px;color:$t2">Maya Patel submitted v3 on 14 Oct, 10:42 in response to your comment.</div>{btn("Open v3", "p", handler="openV3", ic="arrowr")}</div></sc-if>
<sc-if value="{{{{ cantAct }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="border-top:1px solid $border;padding-top:14px;display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:$t2">{icon("lock", 14)}<span>{{{{ cantReason }}}}</span></div></sc-if>
<div style="font-size:12px;color:$t3;line-height:17px;border-top:1px solid $border;padding-top:12px">Approval binds to this exact version and fingerprint. A material change to scope, exposure assumptions, responses or plan invalidates it. Releasing the plan to Jira is a separate authorization.</div>
</div></aside>'''

content = headers + proto + f'''<div role="status" aria-live="polite" style="position:absolute;left:-9999px">{{{{ live }}}}</div>
<div style="display:flex;flex-wrap:wrap;gap:24px;padding:24px;align-items:flex-start;justify-content:center">
<div style="flex:999 1 560px;min-width:0;display:flex;justify-content:center">{brief}</div>{panel}</div>'''

logic = r'''class Component extends DCLogic {
  state = { step: 'v3', view: 3, diff: true, mode: null, reason: null, cons: {}, result: null, variant: 'none' };
  renderVals() {
    const s = this.state;
    const segB = (on) => 'height:26px;padding:0 10px;border-radius:4px;border:0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms;' + (on ? 'background:$surface;color:$t1;font-weight:500;box-shadow:0 0 0 1px $border;' : 'background:transparent;color:$t2;');
    const go = (step) => {
      const m = { v2: { view: 2, result: null }, changes: { view: 2, result: { kind: 'changes', ver: 2, when: '13 Oct, 09:30' } }, v3: { view: 3, result: null }, done: { view: 3, result: { kind: 'approved', ver: 3, when: '14 Oct, 15:10' } } };
      this.setState({ step, mode: null, reason: null, cons: {}, variant: 'none', diff: true, ...m[step] });
    };
    const steps = [['v2', '1 · v2 awaiting'], ['changes', '2 · Changes requested'], ['v3', '3 · v3 awaiting'], ['done', '4 · Approved']];
    const stepKey = s.step === 'done' ? 'done' : s.step;
    const stepBtns = steps.map(([k, l]) => ({ label: l, on: stepKey === k ? 'true' : 'false', style: segB(stepKey === k), pick: () => go(k) }));
    const vars = [['none', 'None'], ['super', 'Superseded'], ['invalid', 'Invalidated'], ['role', 'Role insufficient']];
    const v3e = s.step === 'v3' || s.step === 'done';
    const varBtns = vars.map(([k, l]) => ({ label: l, on: s.variant === k ? 'true' : 'false', style: segB(s.variant === k),
      pick: () => {
        if (k === 'none') this.setState({ variant: k, mode: null, view: v3e ? 3 : 2 });
        else if (k === 'super') this.setState(v3e ? { variant: k, mode: null, view: 2 } : { variant: k, mode: null, view: 2, step: 'v3', result: null });
        else if (k === 'invalid') this.setState({ variant: k, mode: null, view: 3, step: 'done', result: { kind: 'approved', ver: 3, when: '14 Oct, 15:10' } });
        else this.setState({ variant: k, mode: null });
      } }));
    const v3exists = s.step === 'v3' || s.step === 'done';
    const verBtns = [
      { label: 'v1 · draft', disabled: true, on: 'false', style: segB(false) + 'opacity:.55;cursor:not-allowed;', pick: () => {} },
      { label: 'v2', disabled: false, on: s.view === 2 ? 'true' : 'false', style: segB(s.view === 2), pick: () => this.setState({ view: 2, mode: null }) },
      { label: v3exists ? 'v3 · current' : 'v3 · not yet submitted', disabled: !v3exists, on: s.view === 3 ? 'true' : 'false', style: segB(s.view === 3) + (v3exists ? '' : 'opacity:.55;cursor:not-allowed;'), pick: () => v3exists && this.setState({ view: 3 }) }
    ];
    const viewingV3 = s.view === 3;
    const superseded = s.view === 2 && v3exists;
    const awaiting = (s.step === 'v2' && s.view === 2) || (s.step === 'v3' && s.view === 3);
    const invalid = s.variant === 'invalid';
    const role = s.variant === 'role';
    const r = s.result;
    let stamp = 'stAwait', stampText = 'Awaiting your decision';
    if (superseded) { stamp = 'stSup'; stampText = 'Superseded by v3'; }
    else if (invalid) { stamp = 'stInv'; stampText = 'Invalidated — evidence changed · 16 Oct'; }
    else if (r && r.kind === 'approved') { stamp = 'stOk'; stampText = 'Approved v' + r.ver + ' · Elena Fischer · ' + r.when; }
    else if (r && r.kind === 'changes') { stamp = 'stChanges'; stampText = 'Changes requested on v' + r.ver + ' · ' + r.when; }
    else if (r && r.kind === 'rejected') { stamp = 'stRej'; stampText = 'Rejected v' + r.ver + ' · ' + r.when; }
    else if (r && r.kind === 'deferred') { stamp = 'stDef'; stampText = 'Deferred until 15 Nov 2026'; }
    const st = {}; ['stAwait', 'stChanges', 'stOk', 'stRej', 'stDef', 'stInv', 'stSup'].forEach(k => { st[k] = k === stamp; });
    const RS = {
      approve: { title: 'Approve response · ' + (viewingV3 ? 'v3' : 'v2'), label: 'Rationale (required)', opts: ['Scope and owners are clear', 'Evidence is sufficient for an internal response', 'Limitations are disclosed'], btn: 'Approve response', note: 'Records your identity, time and this fingerprint. The plan is released separately by Maya Patel.' },
      changes: { title: 'Request changes', label: 'What needs to change? (required)', opts: ['Clarify account scope', 'Confirm claim limits in the brief', 'Explain exposure definition'], btn: 'Request changes', note: 'Your comment is anchored to the Chosen responses section. Maya Patel submits a new version.' },
      reject: { title: 'Reject response', label: 'Reason (required)', opts: ['Response not warranted', 'Evidence too weak', 'Outside business priorities'], btn: 'Reject', note: 'The rationale is kept. Maya Patel can revise and submit a new package.' },
      defer: { title: 'Defer decision', label: 'Defer until (required)', opts: ['21 Oct 2026 · 7 days', '15 Nov 2026', 'After regulatory status is verified'], btn: 'Defer', note: 'The case keeps its state and reminds you on the chosen date.' }
    };
    const md = s.mode ? RS[s.mode] : null;
    const reasons = md ? md.opts.map(o => ({ label: o, on: s.reason === o ? 'true' : 'false', pick: () => this.setState({ reason: o }),
      style: 'min-height:30px;padding:4px 10px;border-radius:999px;font:inherit;font-size:12.5px;cursor:pointer;text-align:left;transition:background 140ms;' + (s.reason === o ? 'background:$t1;color:#fff;border:1px solid $t1;' : 'background:$surface;color:$t1;border:1px solid $bstrong;') })) : [];
    const consList = ['No pricing changes', 'No new customer communication', 'Brief must not claim clinical equivalence'].map(c => ({ label: c, on: !!s.cons[c], pick: () => this.setState({ cons: { ...s.cons, [c]: !s.cons[c] } }) }));
    const ver = s.view;
    const confirm = () => {
      if (!s.reason) return;
      const when = ver === 2 ? '13 Oct, 09:30' : '14 Oct, 15:10';
      const kind = { approve: 'approved', changes: 'changes', reject: 'rejected', defer: 'deferred' }[s.mode];
      const step = ver === 2 && kind === 'changes' ? 'changes' : 'done';
      this.setState({ result: { kind, ver, when }, step, mode: null, reason: null });
    };
    const fp = ver === 3 ? '7c1e·94ab' : '3b90·1f2d';
    const hOk = !invalid && r && r.kind === 'approved';
    const hV3 = !r && s.step === 'v3';
    const hV2 = !r && s.step === 'v2';
    let nextTitle = 'Waiting on Maya Patel', nextSub = 'Submit v3 · changes requested on v2';
    if (r && r.kind === 'changes' && r.ver === 3) nextSub = 'Submit v4 · changes requested on v3';
    if (r && r.kind === 'rejected') nextSub = 'Revise and resubmit · v' + r.ver + ' rejected';
    if (r && r.kind === 'deferred') { nextTitle = 'Deferred'; nextSub = 'Elena Fischer revisits on 15 Nov 2026'; }
    if (invalid) nextSub = 'Reassess and submit v4 · approval invalidated 16 Oct';
    let cantReason = '';
    if (role) cantReason = 'Approval requires Diagnostics BU authority.';
    else if (superseded) cantReason = 'Superseded versions can’t be approved.';
    else if (invalid) cantReason = 'This approval no longer authorizes execution. A new version is needed.';
    else if (r) cantReason = 'Decision recorded. Submitted versions can’t be edited; amendments create a new version.';
    const canAct = awaiting && !role && !invalid && !superseded && !r;
    return { ...st, stampText, stepBtns, varBtns, verBtns,
      hV2, hV3, hOk, hGen: !hV2 && !hV3 && !hOk, nextTitle, nextSub, updated: s.step === 'changes' ? '13 Oct, 09:30' : '14 Oct, 15:10',
      verShort: 'Version ' + ver, fp, verMeta: ver === 3 ? 'Submitted by Maya Patel · 14 Oct, 10:42 · built from options v2' : 'Submitted by Maya Patel · 12 Oct, 16:05',
      canDiff: viewingV3, diff: s.diff, toggleDiff: () => this.setState({ diff: !s.diff }),
      showDiff: viewingV3 && s.diff, plainV3: viewingV3 && !s.diff, plainV2: !viewingV3,
      showAnchor: !viewingV3 && (s.step !== 'v2' || (r && r.kind === 'changes')), showResolved: viewingV3 && s.diff,
      bSuper: superseded, bInvalid: invalid, bRole: role,
      chainState: r ? (r.kind === 'approved' ? 'Approved' : 'Decided') : (awaiting ? 'Waiting' : '—'),
      canAct, cantAct: !canAct && !(s.step === 'changes' && !superseded && !role), cantReason,
      showOpenV3: s.step === 'changes' && !role,
      noMode: !s.mode, hasMode: !!s.mode, modeTitle: md ? md.title : '', reasonLabel: md ? md.label : '', modeNote: md ? md.note : '',
      reasons, showCons: s.mode === 'approve', consList,
      mApprove: () => this.setState({ mode: 'approve', reason: null }), mChanges: () => this.setState({ mode: 'changes', reason: null }),
      mReject: () => this.setState({ mode: 'reject', reason: null }), mDefer: () => this.setState({ mode: 'defer', reason: null }),
      cancel: () => this.setState({ mode: null, reason: null }),
      confirm, confirmDisabled: !s.reason, confirmLabel: md ? md.btn : '',
      confirmStyle: 'display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (s.reason ? (s.mode === 'approve' ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$t1;color:#fff;border:1px solid $t1;cursor:pointer;') : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      openV3: () => this.setState({ step: s.step === 'changes' ? 'v3' : s.step, view: 3, variant: s.variant === 'super' ? 'none' : s.variant, result: s.step === 'changes' ? null : s.result }),
      live: stampText
    };
  }
}'''

page("Decision.dc.html", "Decision Review", shell("Cases", "Tue 13 – Wed 14 Oct 2026", content, user=("Elena Fischer", "Diagnostics BU Head · Approver", "EF"), counts={"My Actions": "1"}), logic, height=2050)
