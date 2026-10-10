from common import *

nxt = f'''<div style="font-size:13.5px;font-weight:500">{{{{ nextTitle }}}}</div><div style="font-size:12.5px;color:$t2;margin-top:2px">{{{{ nextSub }}}}</div>'''
header = case_header("Outcomes", "Monitoring", "Monitor", "Partial", "14 Nov, 09:40", nxt)

bar = lambda pct, label: f'<div style="display:flex;align-items:center;gap:10px"><div aria-hidden="true" style="flex:1;height:8px;border-radius:4px;background:$sunken;overflow:hidden"><div style="width:{pct}%;height:100%;background:$t2;border-radius:4px"></div></div><span style="font-size:13px;font-weight:600;min-width:64px;text-align:right">{label}</span></div>'


def kpi(title, value, bar_html, definition, scope):
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:14px 16px;min-width:0;display:flex;flex-direction:column;gap:8px">
<div style="font-size:12.5px;font-weight:500;color:$t2">{title}</div><div style="font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.01em">{value}</div>{bar_html}
<div style="font-size:12px;color:$t3;line-height:17px">{definition}</div><div style="font-size:12px;color:$t3">{scope}</div></div>'''


portfolio = f'''<section aria-label="Portfolio">
{h2("Portfolio · workflow health", "Diagnostics BU · 1 case reviewed so far. Workflow measures only; there is no revenue-saved figure.")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
{kpi("Decision speed", "6 days", bar(100, "CR-1042"), "Verified material signal (8 Oct) to approved response (14 Oct).", "Baseline: [historical median, to be measured in pilot]")}
{kpi("Action completion", "3 of 3", bar(100, "on time"), "Tasks done with required evidence by their due date, of tasks due so far.", "T-04 is this review")}
{kpi("Review discipline", "1 of 1", bar(100, "on schedule"), "Cases reviewed by the agreed date, of cases due for review.", "Next due: none scheduled")}
</div></section>'''

TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 12px;height:36px;border-bottom:1px solid $border;white-space:nowrap;background:$canvas"
TD = "padding:10px 12px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px"
TASKS = [("T-01", "Validate competitor claims and comparison limits", "[ND-200 product manager]", "17 Oct", "Done", "Done 17 Oct · on time", "Reviewed comparison with citations"),
         ("T-02", "Update Germany positioning brief", "Jonas Weber", "20 Oct", "Done", "Done 20 Oct · on time", "Approved document · reviewed by Maya Patel"),
         ("T-03", "Review 18 affected accounts", "Sofia Klein", "25 Oct", "Done", "Done 24 Oct · on time", "Account review summary · restricted details summarised"),
         ("T-04", "Review early response outcomes", "Maya Patel", "14 Nov", "In progress", "This review", "Baseline comparison and recommendation")]
trows = "".join(f'<tr><td style="{TD}"><span style="font-family:$mono;font-size:12px;color:$t3;margin-right:8px">{a}</span>{b}</td><td style="{TD}">{c}</td><td style="{TD};white-space:nowrap">{d}</td><td style="{TD}">{task(e)}<div style="font-size:12px;color:$t3;margin-top:2px">{f}</div></td><td style="{TD};color:$t2">{g}</td></tr>' for a, b, c, d, e, f, g in TASKS)
completion = f'''<section aria-label="Action completion">{h2("Action completion", "3 of 3 due tasks done on time. A completed task is not a business outcome.")}
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:820px"><thead><tr><th scope="col" style="{TH}">Task</th><th scope="col" style="{TH}">Owner</th><th scope="col" style="{TH}">Due</th><th scope="col" style="{TH}">Status</th><th scope="col" style="{TH}">Completion evidence</th></tr></thead><tbody>{trows}</tbody></table></div></section>'''

OBS = "display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:4px;border:1px solid $bstrong;font-size:12px;color:$t2;white-space:nowrap"


def indicator(name, base, now, note, evidence, state="observed"):
    if state == "unable":
        val = f'<div style="display:flex;gap:8px;align-items:center;color:$wnf;font-weight:600;font-size:14px">{icon("alert", 15)}Unable to compare</div>'
    else:
        val = f'<div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline"><span style="font-size:13px;color:$t3">Baseline</span><span style="font-size:15px;font-weight:600">{base}</span>{icon("arrowr", 14, "$t3")}<span style="font-size:13px;color:$t3">Day 30</span><span style="font-size:15px;font-weight:600">{now}</span></div>'
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;min-width:0">
<div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600;flex:1 1 200px">{name}</span><span style="{OBS}">{icon("eye", 12)}Observed change · attribution not established</span></div>
{val}<div style="font-size:13px;color:$t2;line-height:19px">{note}</div><div>{evidence}</div></div>'''


indicators = f'''<section aria-label="Observed indicators">{h2("Observed indicators", "What changed in the window, with evidence. These are observations, not effects of the response.")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px">
{indicator("Affected accounts reporting AX-Scan contact", "not measured", "[n] of 18", "From the account review. Per-account details are restricted to account owners.", src("Verified", "Account review summary · Sofia Klein", "24 Oct"))}
{indicator("Open pipeline in scope", "€6.0M", "", "No newer portfolio snapshot was imported after 30 Sep 2026, so pipeline can’t be compared. Import a dated snapshot to compare.", btn("Import snapshot", "s", href="Watchlists.dc.html", ic="upload", extra="height:30px;font-size:12.5px"), "unable")}
{indicator("Sales materials in use", "Old Germany brief", "Brief v1 in use", "Approved brief contains no clinical-equivalence claim (checked 20 Oct).", src("Verified", "Approved document · Jonas Weber", "20 Oct"))}
{indicator("AX-Scan regulatory status", "Unverified", "Unverified", "No registry record found by 14 Nov. The trade report remains the only source.", src("Unverified", "Trade publication", "8 Oct"))}
</div></section>'''

limits = f'''<section aria-label="Limitations and confounders"><h2 style="margin:0 0 10px;font-size:16px;font-weight:600">Limitations and confounders <span style="font-size:12px;color:$t3;font-weight:400">· required</span></h2>
<div role="note" style="border:1px solid #EBCB8B;background:$wnb;border-radius:8px;padding:12px 16px"><ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:22px">
<li>30 days is short relative to hospital tender and renewal cycles.</li><li>No comparison group: changes can’t be separated from market seasonality or other Apex activity.</li>
<li>AX-Scan’s actual availability in Germany is still unverified.</li><li>Pipeline was not re-snapshotted, so commercial movement is unknown.</li></ul></div></section>'''

reco = f'''<section aria-label="Recommendation"><div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap"><h2 style="margin:0;font-size:16px;font-weight:600">Recommendation</h2>{ai("AI draft · edited by Maya Patel")}</div>
<p style="margin:0;font-family:$serif;font-size:17px;line-height:28px;max-width:68ch">Continue monitoring for 60 days. Import a new portfolio snapshot before the next review, and reopen the assessment if AX-Scan’s regulatory status is verified or more accounts report contact.</p></section>'''

cards = f'''<sc-for list="{{{{ dispos }}}}" as="d" hint-placeholder-count="3"><button type="button" onClick="{{{{ d.pick }}}}" aria-pressed="{{{{ d.on }}}}" style="{{{{ d.style }}}}"><span style="font-size:14px;font-weight:600;color:$t1">{{{{ d.label }}}}</span><span style="font-size:12.5px;color:$t2;line-height:18px;margin-top:4px">{{{{ d.desc }}}}</span></button></sc-for>'''
record = f'''<section aria-label="Record review" style="border:1px solid $border;border-radius:8px;padding:16px 18px">
<sc-if value="{{{{ notRecorded }}}}" hint-placeholder-val="{{{{ true }}}}"><div>
<h2 style="margin:0;font-size:16px;font-weight:600">Record review</h2><p style="margin:4px 0 12px;font-size:13px;color:$t2">Choose a disposition and give a reason. Elena Fischer is notified; reopening keeps the original decision and review history.</p>
<div role="group" aria-label="Disposition" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">{cards}</div>
<div style="margin-top:14px;font-size:12.5px;font-weight:500">Reason (required)</div>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><sc-for list="{{{{ reasons }}}}" as="r" hint-placeholder-count="3"><button type="button" onClick="{{{{ r.pick }}}}" aria-pressed="{{{{ r.on }}}}" style="{{{{ r.style }}}}">{{{{ r.label }}}}</button></sc-for></div>
<div style="display:flex;justify-content:flex-end;gap:10px;align-items:center;margin-top:14px"><span style="font-size:12.5px;color:$t3">{{{{ hint }}}}</span><button type="button" onClick="{{{{ recordFn }}}}" disabled="{{{{ recDisabled }}}}" style="{{{{ recStyle }}}}">{icon("check", 15)}Record review</button></div></div></sc-if>
<sc-if value="{{{{ recorded }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="display:flex;gap:12px;align-items:flex-start"><span style="color:$okf">{icon("checkcircle", 20)}</span><div style="flex:1"><div style="font-size:15px;font-weight:600">{{{{ recTitle }}}}</div><p style="margin:4px 0 0;font-size:13px;color:$t2">{{{{ recSub }}}}</p>
<button type="button" class="bg" onClick="{{{{ undo }}}}" style="margin-top:8px;height:30px;padding:0 8px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer">Change disposition</button></div></div></sc-if></section>'''

overview = f'''<section aria-label="Review setup" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0;border:1px solid $border;border-radius:8px">
{"".join(f'<div style="padding:14px 16px;border-right:1px solid $border"><div style="font-size:12px;color:$t3">{a}</div><div style="font-size:14px;font-weight:600;margin-top:2px">{b}</div><div style="font-size:12px;color:$t2;margin-top:2px">{c}</div></div>' for a, b, c in [
    ("Review window", "15 Oct – 14 Nov 2026", "30 days from plan release"), ("Baseline", "Captured 15 Oct 2026", "18 accounts · €6.0M open pipeline (30 Sep snapshot)"),
    ("Metric owner", "Maya Patel", "Reviewer: Elena Fischer"), ("Targets set", "14 Oct 2026", "Before execution · in decision v3")])}</section>'''

targets = f'''<section aria-label="Intended targets">{h2("Intended targets", "Set before execution in decision v3.")}
<ul style="list-style:none;margin:0;padding:0;border:1px solid $border;border-radius:8px">
{"".join(f'<li style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:12px 16px;border-bottom:1px solid $border"><span style="flex:1 1 300px;font-size:13.5px">{a}</span><span style="display:inline-flex;gap:5px;align-items:center;font-size:12.5px;font-weight:500;color:$okf">{icon("checkcircle", 14)}Met</span><span style="font-size:12.5px;color:$t2;min-width:200px">{b}</span></li>' for a, b in [
    ("Positioning brief approved by Day 5", "Approved 20 Oct"), ("18 of 18 accounts reviewed with a summary by Day 10", "Summary submitted 24 Oct"), ("No unsupported clinical-equivalence claims in field materials", "Checked 20 Oct")])}
</ul></section>'''

content = header + f'''<div style="max-width:1160px;padding:24px;display:flex;flex-direction:column;gap:28px">
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end"><div style="flex:1 1 400px;min-width:0"><h2 style="margin:0;font-size:18px;line-height:26px;font-weight:600">Day-30 outcome review</h2>
<p style="margin:2px 0 0;font-size:13px;color:$t2">What changed, what we can honestly say about why, and what happens next.</p></div></div>
{overview}{targets}{completion}{indicators}{limits}{reco}{record}{portfolio}</div>'''

logic = r'''class Component extends DCLogic {
  state = { d: null, r: null, recorded: false };
  renderVals() {
    const s = this.state;
    const D = [
      { k: 'close', label: 'Close case', desc: 'The response is complete and no further watch is needed.' },
      { k: 'monitor', label: 'Continue monitoring', desc: 'Keep watching for 60 days. Next review 13 Jan 2027.' },
      { k: 'reopen', label: 'Reopen assessment', desc: 'New evidence changes the picture. Original decision is kept.' }
    ];
    const R = { close: ['Targets met; no new evidence', 'Competitor activity has stopped'], monitor: ['Regulatory status still unverified', 'Pipeline not yet comparable', 'Window too short to judge'], reopen: ['Regulatory status verified', 'More accounts report contact'] };
    const card = (on) => 'display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:12px 14px;border-radius:8px;font:inherit;cursor:pointer;transition:background 140ms,border-color 140ms,box-shadow 140ms;' + (on ? 'background:$accbg;border:1px solid $acc;box-shadow:0 0 0 1px $acc;' : 'background:$surface;border:1px solid $bstrong;');
    const dispos = D.map(d => ({ ...d, on: s.d === d.k ? 'true' : 'false', style: card(s.d === d.k), pick: () => this.setState({ d: d.k, r: null }) }));
    const reasons = (s.d ? R[s.d] : []).map(r => ({ label: r, on: s.r === r ? 'true' : 'false', pick: () => this.setState({ r }),
      style: 'height:32px;padding:0 12px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:background 140ms;' + (s.r === r ? 'background:$t1;color:#fff;border:1px solid $t1;' : 'background:$surface;color:$t1;border:1px solid $bstrong;') }));
    const ok = !!(s.d && s.r);
    const cur = D.find(d => d.k === s.d);
    const titles = { close: 'Review recorded · case closed', monitor: 'Review recorded · monitoring continues until 13 Jan 2027', reopen: 'Review recorded · assessment reopened' };
    return {
      dispos, reasons, notRecorded: !s.recorded, recorded: s.recorded,
      hint: !s.d ? 'Choose a disposition' : (!s.r ? 'Choose a reason' : ''),
      recDisabled: !ok, recordFn: () => ok && this.setState({ recorded: true }),
      recStyle: 'display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (ok ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      recTitle: s.d ? titles[s.d] : '', recSub: 'Recorded by Maya Patel · 14 Nov 2026 · reason: ' + (s.r || '') + '. Elena Fischer has been notified.',
      undo: () => this.setState({ recorded: false }),
      nextTitle: s.recorded ? (cur ? cur.label + ' · recorded' : '') : 'Record day-30 review',
      nextSub: s.recorded ? 'Elena Fischer notified' : 'Review due today · 14 Nov'
    };
  }
}'''

page("Outcomes.dc.html", "Outcomes", shell("Outcomes", "Sat 14 Nov 2026, 10:00 · day 30", content), logic, height=1600)
