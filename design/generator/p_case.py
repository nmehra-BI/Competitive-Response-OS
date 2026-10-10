from common import *

why = f'''<div style="display:flex;align-items:center;gap:10px">
<span aria-hidden="true" style="width:28px;height:28px;border-radius:50%;background:$ntb;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">EF</span>
<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">Waiting on Elena Fischer</div><div style="font-size:12.5px;color:$t2">Approve response · since 14 Oct, 10:42</div></div>
<button type="button" class="bs" onClick="{{{{ toggleWhy }}}}" aria-expanded="{{{{ whyExpanded }}}}" style="height:30px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;color:$t1">Why?</button></div>
<sc-if value="{{{{ whyOpen }}}}" hint-placeholder-val="{{{{ false }}}}"><ul style="list-style:none;margin:10px 0 0;padding:10px 0 0;border-top:1px solid $border;font-size:12.5px;display:flex;flex-direction:column;gap:6px">
<li style="display:flex;gap:6px;align-items:center;color:$okf">{icon("checkcircle", 14)}<span style="color:$t1">Decision package v3 submitted</span></li>
<li style="display:flex;gap:6px;align-items:center;color:$okf">{icon("checkcircle", 14)}<span style="color:$t1">Approver with Diagnostics · Germany authority assigned</span></li>
<li style="display:flex;gap:6px;align-items:center;color:$t2">{icon("lock", 14)}<span>You can’t approve: Elena Fischer approves Diagnostics responses</span></li></ul></sc-if>
<a href="Decision.dc.html" style="display:inline-flex;align-items:center;gap:4px;margin-top:10px;font-size:12.5px;font-weight:500;text-decoration:none">View decision package v3{icon("chevr", 13)}</a>'''

header = case_header("Summary", "Awaiting approval · v3", "Decide", "Partial", "14 Oct, 10:42", why)

GUARDS = [("Evidence reviewed", "9 of 11 claims reviewed · 2 open questions disclosed"), ("Product overlap confirmed", "1 use case · Maya Patel · 9 Oct"),
          ("Exposure definition attached", "Snapshot 30 Sep 2026 · CSV import"), ("Uncertainties disclosed", "3 open questions in the package"),
          ("Approver assigned", "Elena Fischer · Diagnostics · Germany")]
guards = "".join(f'<li style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid $border"><span style="color:$okf;margin-top:1px">{icon("checkcircle", 15)}</span><div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">{a}</div><div style="font-size:12.5px;color:$t2">{b}</div></div><span style="font-size:12px;color:$okf;font-weight:500">Met</span></li>' for a, b in GUARDS)

nextcard = f'''<section aria-label="Next step" style="border:1px solid $border;border-radius:8px;padding:16px 18px">
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center"><h2 style="margin:0;font-size:16px;font-weight:600;flex:1 1 280px">Next step: Elena Fischer reviews decision package v3</h2>{btn("Open decision package", "s", href="Decision.dc.html", ic="file")}</div>
<p style="margin:6px 0 0;font-size:13px;color:$t2">v3 answers Elena’s 13 Oct request: account scope is stated and the brief will not claim clinical equivalence. Plan release is a separate step after approval.</p>
<ul style="list-style:none;margin:10px 0 0;padding:0">{guards}</ul>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Readiness checks are workflow rules, not a judgment of the decision.</p></section>'''

S = "margin:0;font-family:$serif;font-size:17px;line-height:28px;max-width:68ch"
what = f'''<section aria-label="What happened"><h2 style="margin:0 0 8px;font-size:16px;font-weight:600">What happened</h2>
<p style="{S}">On 7 Oct 2026 Apex Diagnostics announced the launch of AX-Scan in Germany for hospital laboratories. {src("Verified", "Apex press release", "8 Oct")}</p>
<p style="{S};margin-top:10px">A separate trade report says AX-Scan is cleared for sale in Germany. That claim has a single source and remains unverified. {src("Unverified", "Trade publication", "8 Oct")}</p></section>'''

scope = f'''<section aria-label="Why it matters"><h2 style="margin:0 0 8px;font-size:16px;font-weight:600">Why it matters</h2>
<p style="{S}">AX-Scan overlaps ND-200 in one confirmed laboratory use case in Germany. Clinical-performance equivalence is unresolved. {src("Verified", "Analyst review · Maya Patel", "9 Oct")}</p>
<dl style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:14px 0 0;padding:14px;border:1px solid $border;border-radius:8px;font-size:13px">
<div><dt style="color:$t3;font-size:12px">Our product</dt><dd style="margin:2px 0 0;font-weight:500">ND-200</dd></div>
<div><dt style="color:$t3;font-size:12px">Competitor product</dt><dd style="margin:2px 0 0;font-weight:500">AX-Scan</dd></div>
<div><dt style="color:$t3;font-size:12px">Overlap</dt><dd style="margin:2px 0 0;font-weight:500">1 confirmed use case</dd></div>
<div><dt style="color:$t3;font-size:12px">Market · segment</dt><dd style="margin:2px 0 0;font-weight:500">Germany · selected segment</dd></div>
<div><dt style="color:$t3;font-size:12px">Business unit</dt><dd style="margin:2px 0 0;font-weight:500">Diagnostics BU</dd></div></dl></section>'''

expo = f'''<section aria-label="Exposure summary"><div style="display:flex;align-items:baseline;gap:12px;margin-bottom:10px;flex-wrap:wrap"><h2 style="margin:0;font-size:16px;font-weight:600">Exposure</h2><span style="font-size:12.5px;color:$t3">Three separate measures · never added together</span><a href="Impact.dc.html" style="margin-left:auto;font-size:12.5px;font-weight:500;text-decoration:none">Show calculation</a></div>
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:stretch">
<div style="flex:2 1 320px;min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">{measure("Relevant annual revenue", "€24.0M", "TTM to 30 Sep 2026 · ND-200 · German segment")}{measure("Affected existing accounts", "18", "Distinct · confirmed scope")}</div>
<div role="separator" aria-label="Not recognized revenue" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:$t3;writing-mode:vertical-rl;transform:rotate(180deg)"><span style="flex:1;width:1px;background:$bstrong"></span>Not recognized revenue<span style="flex:1;width:1px;background:$bstrong"></span></div>
<div style="flex:1 1 160px;min-width:0">{measure("Open pipeline", "€6.0M", "Current opportunities")}</div>
<div style="flex:1.3 1 220px;min-width:0">{measure("Scenario range (assumption)", "€1.2–3.6M", "€24.0M × 5–15% · not predicted loss", dashed=True, tag="Assumption")}</div></div>
<div style="font-size:12px;color:$t3;margin-top:8px;display:flex;gap:6px;align-items:center">{icon("database", 13)}Snapshot 30 Sep 2026 · EUR · CRM not connected</div></section>'''

EVS = [("Verified", "4"), ("Partial", "1"), ("Conflicting", "1"), ("Unverified", "1")]
evid = f'''<section aria-label="Evidence status" style="flex:1 1 300px;min-width:0"><h2 style="margin:0 0 10px;font-size:16px;font-weight:600">Evidence status</h2>
<div style="border:1px solid $border;border-radius:8px;padding:6px 14px">
{"".join(f'<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid $border">{ev(a)}<span style="font-size:13.5px;font-weight:500">{b} claims</span></div>' for a, b in EVS)}
<div style="display:flex;justify-content:space-between;padding:7px 0;font-size:13px;color:$t2"><span>Assumptions 1 · Unknown 1 · Excluded 1 · Unavailable 1</span></div></div>
<a href="Evidence.dc.html" style="display:inline-flex;gap:4px;align-items:center;margin-top:8px;font-size:12.5px;font-weight:500;text-decoration:none">Open evidence{icon("chevr", 13)}</a></section>'''

openq = f'''<section aria-label="Open questions" style="flex:1 1 300px;min-width:0"><h2 style="margin:0 0 10px;font-size:16px;font-weight:600">Open questions</h2>
<div role="note" style="border:1px solid #EBCB8B;background:$wnb;border-radius:8px;padding:12px 14px">
<div style="display:flex;align-items:center;gap:8px;color:$wnf;font-weight:600;font-size:13.5px">{icon("help", 15)}What we don’t know</div>
<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:21px"><li>Clinical-performance equivalence with ND-200 (sources conflict)</li><li>Precise regulatory status for sale in Germany</li><li>Reimbursement status in Germany</li></ul></div></section>'''

decision = f'''<section aria-label="Current decision"><h2 style="margin:0 0 10px;font-size:16px;font-weight:600">Current decision</h2>
<div style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center">
<div style="flex:1 1 320px;min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-weight:600;font-size:14px">Decision package v3</span>{mono("7c1e·94ab")}<span style="display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:4px;border:1px solid $bstrong;font-size:12px;font-weight:500">{icon("clock", 12)}Awaiting Elena Fischer</span></div>
<div style="font-size:13px;color:$t2;margin-top:6px">Chosen responses: Update positioning · Account review. Alternatives considered: Monitor only, Product assessment.</div></div>
{btn("Open decision", "s", href="Decision.dc.html")}</div></section>'''

ACT = [
    ("MP", "Maya Patel", "submitted decision package", "v3", "14 Oct, 10:42", True, ""),
    ("MP", "Maya Patel", "edited Known limitations in", "v3 draft", "14 Oct, 10:15", False, ""),
    ("EF", "Elena Fischer", "requested changes on", "v2", "13 Oct, 09:30", True, "“Clarify which accounts are in scope and confirm the brief won’t claim clinical equivalence.”"),
    ("MP", "Maya Patel", "submitted decision package", "v2", "12 Oct, 16:05", True, ""),
    ("MP", "Maya Patel", "selected Update positioning + Account review", "", "12 Oct, 11:20", False, ""),
    ("MP", "Maya Patel", "confirmed product overlap · 1 use case", "", "9 Oct, 15:20", False, ""),
    ("MP", "Maya Patel", "edited scenario assumption to 5–15%", "", "9 Oct, 15:12", False, ""),
    ("—", "System", "finished checking sources and prepared the impact assessment", "", "8 Oct, 14:31", False, ""),
    ("MP", "Maya Patel", "created case from", "SIG-881", "8 Oct, 14:20", True, ""),
]
acts = ""
for ini, who, verb, obj, when, pin, q in ACT:
    o = f" {mono(obj)}" if obj else ""
    p = f'<span style="font-size:11.5px;color:$t3;display:inline-flex;align-items:center;gap:3px">{icon("flag", 11)}Key event</span>' if pin else ""
    qq = f'<div style="font-size:12.5px;color:$t2;margin-top:4px;padding:6px 8px;background:$canvas;border-radius:4px">{q}</div>' if q else ""
    acts += f'''<li style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid $border">
<span aria-hidden="true" style="width:24px;height:24px;border-radius:50%;background:$ntb;font-size:10.5px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">{ini}</span>
<div style="flex:1;min-width:0;font-size:13px;line-height:19px"><span style="font-weight:500">{who}</span> <span style="color:$t2">{verb}</span>{o}
<div style="display:flex;gap:10px;align-items:center;margin-top:2px"><span style="font-size:12px;color:$t3">{when}</span>{p}</div>{qq}</div></li>'''

panel = f'''<sc-if value="{{{{ panelOpen }}}}" hint-placeholder-val="{{{{ true }}}}"><aside aria-label="Case context" style="flex:1 1 320px;max-width:100%;min-width:0;border-left:1px solid $border;padding:16px 18px;box-sizing:border-box">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
<div role="tablist" aria-label="Context panel" style="display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas">
<button type="button" role="tab" aria-selected="{{{{ actSel }}}}" onClick="{{{{ showAct }}}}" style="{{{{ actStyle }}}}">Activity</button>
<button type="button" role="tab" aria-selected="{{{{ comSel }}}}" onClick="{{{{ showCom }}}}" style="{{{{ comStyle }}}}">Comments · {{{{ comCount }}}}</button></div>
<button type="button" class="bg" aria-label="Hide context panel" onClick="{{{{ togglePanel }}}}" style="margin-left:auto;height:30px;padding:0 8px;border:0;border-radius:6px;display:flex;align-items:center;gap:6px;color:$t2;cursor:pointer;font:inherit;font-size:12px">{icon("panel", 15)}{kbd("]")}</button></div>
<sc-if value="{{{{ actOn }}}}" hint-placeholder-val="{{{{ true }}}}"><div><div style="font-size:12px;color:$t3;margin-bottom:4px">Append-only history · newest first</div><ol style="list-style:none;margin:0;padding:0">{acts}</ol></div></sc-if>
<sc-if value="{{{{ comOn }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="display:flex;flex-direction:column;gap:12px">
<sc-for list="{{{{ comments }}}}" as="c" hint-placeholder-count="2"><div style="border:1px solid $border;border-radius:8px;padding:10px 12px">
<div style="display:flex;gap:8px;align-items:center"><span aria-hidden="true" style="width:22px;height:22px;border-radius:50%;background:$ntb;font-size:10px;font-weight:600;display:flex;align-items:center;justify-content:center">{{{{ c.ini }}}}</span><span style="font-size:13px;font-weight:500">{{{{ c.who }}}}</span><span style="font-size:12px;color:$t3;margin-left:auto">{{{{ c.when }}}}</span></div>
<div style="font-size:12px;color:$t3;margin-top:6px">On {{{{ c.anchor }}}}</div>
<p style="margin:4px 0 0;font-size:13px;line-height:19px">{{{{ c.text }}}}</p></div></sc-for>
<label for="cm-new" style="font-size:12.5px;font-weight:500">Add a comment</label>
<textarea id="cm-new" rows="3" value="{{{{ draft }}}}" onChange="{{{{ setDraft }}}}" placeholder="Mention someone with @" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13px;resize:vertical"></textarea>
<div style="display:flex;justify-content:flex-end">{btn("Comment", "p", handler="addComment")}</div></div></sc-if>
</aside></sc-if>'''

showpanel = f'''<sc-if value="{{{{ panelClosed }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="position:absolute;right:16px;top:16px"><button type="button" class="bs" onClick="{{{{ togglePanel }}}}" style="height:32px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;display:flex;align-items:center;gap:6px;cursor:pointer;font:inherit;font-size:12.5px;color:$t1">{icon("panel", 15)}Show activity</button></div></sc-if>'''

content = header + f'''<div style="display:flex;flex-wrap:wrap;align-items:stretch;position:relative">
<div style="flex:999 1 560px;min-width:0;padding:24px;display:flex;flex-direction:column;gap:28px;max-width:860px">
{nextcard}{what}{scope}{expo}
<div style="display:flex;flex-wrap:wrap;gap:20px">{evid}{openq}</div>
{decision}
</div>
{panel}{showpanel}
</div>'''

logic = r'''class Component extends DCLogic {
  state = { why: false, panel: true, tab: 'act', draft: '', extra: [] };
  renderVals() {
    const s = this.state;
    const seg = (on) => 'height:26px;padding:0 10px;border-radius:4px;border:0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms;' + (on ? 'background:$surface;color:$t1;font-weight:500;box-shadow:0 0 0 1px $border;' : 'background:transparent;color:$t2;');
    const comments = [
      { ini: 'EF', who: 'Elena Fischer', when: '13 Oct, 09:30', anchor: 'v2 · Chosen responses', text: 'Which accounts are in scope? Please also confirm the positioning brief will not claim clinical equivalence.' },
      { ini: 'MP', who: 'Maya Patel', when: '14 Oct, 10:40', anchor: 'v3 · Known limitations', text: 'Added the account scope (18 distinct accounts; restricted rows summarised by their owner) and a limitation: no clinical-equivalence claim.' }
    ].concat(s.extra);
    return {
      whyOpen: s.why, whyExpanded: s.why ? 'true' : 'false', toggleWhy: () => this.setState({ why: !s.why }),
      panelOpen: s.panel, panelClosed: !s.panel, togglePanel: () => this.setState({ panel: !s.panel }),
      actOn: s.tab === 'act', comOn: s.tab === 'com', actSel: s.tab === 'act' ? 'true' : 'false', comSel: s.tab === 'com' ? 'true' : 'false',
      actStyle: seg(s.tab === 'act'), comStyle: seg(s.tab === 'com'),
      showAct: () => this.setState({ tab: 'act' }), showCom: () => this.setState({ tab: 'com' }),
      comments, comCount: comments.length, draft: s.draft,
      setDraft: (e) => this.setState({ draft: e.target.value }),
      addComment: () => s.draft.trim() && this.setState({ extra: s.extra.concat([{ ini: 'MP', who: 'Maya Patel', when: 'Just now', anchor: 'Case', text: s.draft.trim() }]), draft: '' })
    };
  }
}'''

page("CaseSummary.dc.html", "Case Summary", shell("Cases", "Wed 14 Oct 2026, 11:00", content), logic, height=1400)
