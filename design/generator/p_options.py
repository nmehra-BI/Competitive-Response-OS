from common import *

nxt = f'''<div style="font-size:13.5px;font-weight:500">Select a response, then preview the decision package</div>
<div style="font-size:12.5px;color:$t2;margin-top:2px">Nothing is selected for you. The recommendation is shown with its reasoning.</div>'''
header = case_header("Response Options", "Ready for decision", "Decide", "Partial", "12 Oct, 11:02", nxt)

OPTS = [
    ("mon", "Monitor", "Low", False),
    ("pos", "Update positioning", "Medium", True),
    ("acc", "Account review", "Medium", False),
    ("prd", "Product assessment", "High", False),
]
ROWS = [
    ("Rationale", ["Regulatory status and comparative performance are unverified. Wait for corroboration before acting.",
                   "Launch is verified and overlap is confirmed in one use case. Sellers need approved comparison language now.",
                   "18 existing accounts sit in the confirmed scope. Owners check exposure and tender timing account by account.",
                   "Assess whether ND-200’s roadmap needs to respond if AX-Scan performance claims are later supported."]),
    ("Evidence", [f'{ev("Unverified")} C-08 regulatory status<br>{ev("Conflicting")} C-05 performance',
                  f'{ev("Verified")} C-01 launch<br>{ev("Verified")} C-04 overlap · 1 use case',
                  f'{ev("Verified")} C-04 overlap<br><span style="font-size:12.5px;color:$t2">Exposure snapshot 30 Sep 2026</span>',
                  f'{ev("Conflicting")} C-05 performance<br>{ev("Partial")} C-06 specification · stale']),
    ("Expected benefit", ["Keeps capacity free; avoids reacting to a rumour.", "Consistent, cited talking points; no unsupported claims in the field.",
                          "Early view of which accounts are approached and when tenders fall.", "Informs product planning; no near-term commercial effect."]),
    ("Effort", ["Low", "Medium", "Medium", "High"]),
    ("Time", ["Review at 30 days", "5 days · brief due Day 5", "10 days · review due Day 10", '<span style="color:$t3">[4–6 weeks, illustrative]</span>']),
    ("Decision deadline", ["None · can be chosen any time", "Before sellers meet affected accounts", "Before sellers meet affected accounts", "No fixed deadline"]),
    ("Dependencies", ["Owner, trigger and review date are required", "Validated comparison limits (Day 2)", "Access to restricted account rows via their owner", "Product leadership time · clinical data"]),
    ("Risks", ["Late response if the launch reaches accounts quickly", "Over-claiming: clinical equivalence is unresolved", "Seller time across 18 accounts", "Outside Elena Fischer’s approval scope; needs escalation"]),
    ("Success measures", ["Corroboration status recorded at day 30", "Brief approved by Day 5 and used in account reviews", "18 of 18 accounts reviewed with summary by Day 10", "Assessment memo delivered"]),
]

TD = "padding:12px 14px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px"
head = f'<th scope="col" style="padding:0;border-bottom:1px solid $border;width:150px;background:$canvas"></th>'
for k, name, eff, rec in OPTS:
    r = f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;background:$accbg;color:$acc;font-size:11.5px;font-weight:600">{icon("target", 11)}Recommended</span>' if rec else ""
    head += f'''<th scope="col" style="{{{{ col_{k} }}}}">
<label for="op-{k}" style="display:flex;gap:10px;align-items:flex-start;cursor:pointer">
<input id="op-{k}" type="checkbox" checked="{{{{ sel_{k} }}}}" onChange="{{{{ tog_{k} }}}}" style="width:18px;height:18px;margin:1px 0 0;accent-color:#3049C9;flex:none">
<span style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;text-align:left"><span style="font-size:14px;font-weight:600;color:$t1">{name}</span>
<span style="display:flex;gap:6px;flex-wrap:wrap">{r}{ai("AI draft · edited" if k == "pos" else "AI draft")}</span></span></label></th>'''
head += f'<th scope="col" style="padding:12px 14px;border-bottom:1px solid $border;background:$canvas;vertical-align:top;width:120px"><button type="button" class="bs" onClick="{{{{ addOption }}}}" style="display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:1px dashed $bstrong;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer;white-space:nowrap">{icon("plus", 13)}Add option</button></th>'

body = ""
for label, vals in ROWS:
    body += f'<tr><th scope="row" style="{TD};text-align:left;font-weight:500;color:$t2;font-size:12.5px;background:$canvas">{label}</th>'
    for (k, *_), v in zip(OPTS, vals):
        body += f'<td style="{{{{ cell_{k} }}}}">{v}</td>'
    body += f'<td style="{TD}"></td></tr>'
body += f'<tr><th scope="row" style="{TD};text-align:left;font-weight:500;color:$t2;font-size:12.5px;background:$canvas;border-bottom:0"></th>'
for k, *_ in OPTS:
    body += f'<td style="padding:10px 14px;vertical-align:top"><button type="button" class="bg" style="display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 8px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer">{icon("pencil", 13)}Edit option</button></td>'
body += "<td></td></tr>"

table = f'<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:1040px;table-layout:fixed"><caption style="position:absolute;left:-9999px">Response options compared</caption><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'

reco = f'''<div style="border:1px solid $accbd;border-radius:8px;padding:14px 16px;background:$surface;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap">
<span style="color:$acc;margin-top:2px">{icon("target", 18)}</span>
<div style="flex:1 1 480px;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:600;font-size:14px">Recommended: Update positioning</span>{ai("AI draft · edited by Maya Patel")}<span style="font-size:12px;color:$t3">Based on 6 claims</span></div>
<p style="margin:6px 0 0;font-size:13.5px;line-height:21px;color:$t1;max-width:80ch">The launch is verified and overlap is confirmed in one use case, so sellers need approved comparison language. Positioning can be updated without claiming clinical equivalence. It is compatible with Account review. Exposure size alone did not drive this recommendation.</p>
<p style="margin:6px 0 0;font-size:12.5px;color:$t2">Not checked: competitor pricing, tender calendars, reimbursement status.</p></div></div>'''

summary = f'''<div style="position:sticky;bottom:0;border-top:1px solid $border;background:$surface;padding:14px 24px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center">
<div style="flex:1 1 360px;min-width:0"><div style="font-size:13.5px;font-weight:500">{{{{ selLabel }}}}</div>
<div role="status" aria-live="polite" style="{{{{ compatStyle }}}}">{{{{ compat }}}}</div></div>
<sc-if value="{{{{ canPreview }}}}" hint-placeholder-val="{{{{ false }}}}">{btn("Preview decision package", "p", href="Decision.dc.html", ic="file")}</sc-if>
<sc-if value="{{{{ cannotPreview }}}}" hint-placeholder-val="{{{{ true }}}}">{btn("Preview decision package", "p", disabled=True)}</sc-if></div>'''

content = header + f'''<div style="padding:24px;display:flex;flex-direction:column;gap:20px;max-width:1240px">
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end"><div style="flex:1 1 400px;min-width:0"><h2 style="margin:0;font-size:16px;font-weight:600">What could we do, and what are the trade-offs?</h2>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Four options drafted from the evidence and impact assessment. Benefits are qualitative; there is no ROI estimate. Combine compatible options.</p></div>
<span role="status" style="font-size:12.5px;color:$t2">{{{{ toast }}}}</span></div>
{reco}{table}</div>{summary}'''

logic = r'''class Component extends DCLogic {
  state = { sel: { mon: false, pos: false, acc: false, prd: false }, toast: '' };
  renderVals() {
    const s = this.state, sel = s.sel;
    const names = { mon: 'Monitor', pos: 'Update positioning', acc: 'Account review', prd: 'Product assessment' };
    const picked = Object.keys(names).filter(k => sel[k]);
    const v = {};
    const base = 'padding:12px 14px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px;transition:background 160ms;';
    Object.keys(names).forEach(k => {
      v['sel_' + k] = !!sel[k];
      v['tog_' + k] = () => this.setState({ sel: { ...sel, [k]: !sel[k] } });
      v['cell_' + k] = base + (sel[k] ? 'background:#F7F8FE;' : '');
      v['col_' + k] = 'padding:14px;border-bottom:1px solid $border;vertical-align:top;text-align:left;transition:background 160ms,box-shadow 160ms;' + (sel[k] ? 'background:$accbg;box-shadow:inset 0 2px 0 $acc;' : 'background:$canvas;');
    });
    let compat = 'Select at least one response to preview the decision package.', tone = '$t2';
    if (picked.length) {
      if (sel.mon && picked.length > 1) { compat = 'Monitor is a standalone response. The other options already include a 30-day outcome review.'; tone = '$wnf'; }
      else if (sel.prd) { compat = 'Product assessment needs product leadership authority. Elena Fischer can approve positioning and account review; this option will be escalated.'; tone = '$wnf'; }
      else if (sel.pos && sel.acc) { compat = '✓ Update positioning + Account review are compatible.'; tone = '$okf'; }
      else if (sel.mon) { compat = 'Monitor only: the package will ask for an owner, a trigger and a review date.'; tone = '$t2'; }
      else { compat = 'Compatible selection.'; tone = '$okf'; }
    }
    return { ...v,
      selLabel: picked.length ? 'Selected: ' + picked.map(k => names[k]).join(' + ') : 'No response selected',
      compat, compatStyle: 'font-size:12.5px;margin-top:2px;color:' + tone,
      canPreview: picked.length > 0, cannotPreview: picked.length === 0,
      toast: s.toast, addOption: () => this.setState({ toast: 'New option added as a human-authored draft (no AI badge).' })
    };
  }
}'''

page("ResponseOptions.dc.html", "Response Options", shell("Cases", "Mon 12 Oct 2026, 11:05", content), logic, height=1560)
