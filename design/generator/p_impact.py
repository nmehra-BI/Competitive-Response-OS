from common import *

nxt = f'''<div style="font-size:13.5px;font-weight:500">{{{{ nextTitle }}}}</div>
<div style="font-size:12.5px;color:$t2;margin-top:2px">{{{{ nextSub }}}}</div>
<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
<sc-if value="{{{{ canConfirm }}}}" hint-placeholder-val="{{{{ true }}}}">{btn("Confirm assessment", "p", handler="confirmAssessment", ic="check")}</sc-if>
<sc-if value="{{{{ assessed }}}}" hint-placeholder-val="{{{{ false }}}}">{btn("Compare response options", "p", href="ResponseOptions.dc.html", ic="arrowr")}</sc-if>
<sc-if value="{{{{ blocked }}}}" hint-placeholder-val="{{{{ false }}}}">{btn("Confirm assessment", "p", disabled=True)}</sc-if></div>'''
header = case_header("Impact", "Assessing", "Assess", "Partial", "9 Oct, 15:30", nxt)


def st(kind):
    m = {"Confirmed": ("checkcircle", "$okf"), "Pending review": ("halfcircle", "$wnf"), "Unresolved": ("shieldalert", "$dgf"),
         "Not established": ("dashcircle", "$t2"), "Unverified": ("shielddash", "$t2")}
    i, c = m[kind]
    return f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:500;color:{c};white-space:nowrap">{icon(i, 14)}{kind}</span>'


TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 14px;height:36px;border-bottom:1px solid $border;white-space:nowrap;background:$canvas"
TD = "padding:12px 14px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px"
cat = src("Verified", "ND-200 catalog", "internal")
prs = src("Verified", "Apex press release", "8 Oct")

row1 = f'''<tr><th scope="row" style="{TD};text-align:left;font-weight:500">Intended use · use case 1<div style="font-weight:400;color:$t3;font-size:12px">Routine laboratory testing</div></th>
<td style="{TD}">Routine diagnostic testing in hospital laboratories<div style="margin-top:6px">{cat}</div></td>
<td style="{TD}">Routine diagnostic testing in hospital laboratories<div style="margin-top:6px">{prs}</div></td>
<td style="{TD}"><sc-if value="{{{{ overlapOk }}}}" hint-placeholder-val="{{{{ true }}}}">{st("Confirmed")}<div style="font-size:12px;color:$t3;margin-top:3px">Maya Patel · 9 Oct, 15:20</div></sc-if>
<sc-if value="{{{{ overlapPending }}}}" hint-placeholder-val="{{{{ false }}}}">{st("Pending review")}<div style="font-size:12px;color:$t3;margin:3px 0 8px">{ai()}</div>{btn("Confirm overlap", "s", handler="confirmOverlap", extra="height:30px;font-size:12.5px")}</sc-if></td></tr>'''
rows = [
    ("Other use cases", "Specialty panels <span style=\"color:$t3\">[per catalog]</span>", "Not stated in sources", st("Not established"), ""),
    ("Customer segment", "Hospital laboratories · Germany, selected segment", "Hospital laboratories · Germany", st("Confirmed"), ""),
    ("Geography", "Germany, Austria, Switzerland", "Germany (announced)", st("Confirmed"), '<div style="font-size:12px;color:$t3;margin-top:3px">Overlap in Germany only</div>'),
    ("Clinical performance", "Published performance data <span style=\"color:$t3\">[internal ref.]</span>", "Manufacturer claims comparable performance; no independent data", st("Unresolved"), '<div style="font-size:12px;color:$dgf;margin-top:3px">Do not claim equivalence</div>'),
    ("Regulatory status · Germany", "Marketed", "Reported by one trade source", st("Unverified"), '<div style="font-size:12px;color:$t3;margin-top:3px">See claim C-08</div>'),
]
rest = "".join(f'<tr><th scope="row" style="{TD};text-align:left;font-weight:500">{a}</th><td style="{TD}">{b}</td><td style="{TD}">{c}</td><td style="{TD}">{d}{e}</td></tr>' for a, b, c, d, e in rows)

matrix = f'''<section aria-label="Product overlap">
{h2("Product overlap", "Attributes compared side by side. Each row is reviewed on its own; there is no single similarity score.", '<button type="button" class="bg" onClick="{{ togglePreview }}" style="height:30px;padding:0 10px;border:1px dashed $bstrong;border-radius:6px;font:inherit;font-size:12px;color:$t2;cursor:pointer">{{ previewLabel }}</button>')}
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:860px">
<thead><tr><th scope="col" style="{TH};width:190px">Attribute</th><th scope="col" style="{TH}">ND-200 · Northstar</th><th scope="col" style="{TH}">AX-Scan · Apex Diagnostics</th><th scope="col" style="{TH};width:200px">Review</th></tr></thead>
<tbody>{row1}{rest}</tbody></table></div>
<p style="margin:10px 0 0;font-size:12.5px;color:$t2;display:flex;gap:6px;align-items:flex-start">{icon("info", 14)}Overlap is confirmed in one use case. Clinical-performance equivalence is unresolved and excluded from positioning claims.</p>
</section>'''

dl = "display:grid;grid-template-columns:150px 1fr;gap:8px 14px;margin:0;font-size:13px;line-height:19px"
definition = f'''<div style="border:1px solid $border;border-radius:8px;padding:14px 16px;flex:1 1 360px;min-width:0">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="font-size:13.5px;font-weight:600">Definition</span><span style="font-size:12px;color:$t3">Same snapshot and inputs reproduce the same result</span></div>
<dl style="{dl}">
<dt style="color:$t3">Currency</dt><dd style="margin:0">EUR</dd>
<dt style="color:$t3">Period</dt><dd style="margin:0">Trailing 12 months, 1 Oct 2025 – 30 Sep 2026</dd>
<dt style="color:$t3">Snapshot</dt><dd style="margin:0;display:flex;gap:8px;flex-wrap:wrap;align-items:center">30 Sep 2026 · CSV import by Maya Patel, 1 Oct <span style="font-size:12px;color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("clock", 12)}9 days old</span></dd>
<dt style="color:$t3">Filters</dt><dd style="margin:0">ND-200 · German segment · confirmed use case 1</dd>
<dt style="color:$t3">Deduplication</dt><dd style="margin:0">Accounts with several ND-200 contracts counted once, by account ID</dd>
<dt style="color:$t3">Exclusions</dt><dd style="margin:0">Accounts without a German site · unconfirmed use cases</dd>
<dt style="color:$t3">Coverage</dt><dd style="margin:0">CSV snapshot only · CRM not connected · pipeline from the same snapshot</dd></dl>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">{btn("Request data", "g", ic="users")}{btn("Upload newer CSV", "g", ic="upload", href="Watchlists.dc.html")}</div></div>'''

scenario = f'''<div style="border:1.5px dashed $ctrl;border-radius:8px;padding:16px 18px;background:$canvas;min-width:0;flex:1.2 1 340px">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:12.5px;font-weight:500;color:$t2">Scenario range (assumption)</span>
<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;border:1px dashed $ctrl;font-size:11.5px;color:$t2;font-weight:500">{icon("ruler", 11)}Assumption</span>
<span style="margin-left:auto;font-size:12px;color:$t3">{{{{ editedBy }}}}</span></div>
<div role="status" aria-live="polite" style="{{{{ rangeStyle }}}}">{{{{ range }}}}</div>
<div style="font-family:$mono;font-size:13px;color:$t2;margin-top:2px">{{{{ formula }}}}</div>
<div style="font-size:12px;color:$t3;margin-top:4px">Assumed erosion of relevant annual revenue over a future 12-month period. Not predicted loss. No midpoint is shown.</div>
<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:14px">
<div><label for="sc-low" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Low assumption</label>
<div style="display:flex;align-items:center;gap:4px"><button type="button" class="bs" aria-label="Decrease low assumption" onClick="{{{{ lowDown }}}}" style="width:32px;height:36px;border:1px solid $bstrong;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:$t1">{icon("minus", 14)}</button>
<span style="position:relative;display:inline-flex;align-items:center"><input id="sc-low" type="number" min="0" max="50" value="{{{{ low }}}}" onChange="{{{{ setLow }}}}" style="width:72px;height:36px;box-sizing:border-box;padding:0 22px 0 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:14px;font-variant-numeric:tabular-nums;background:$surface"><span style="position:absolute;right:8px;color:$t3;font-size:13px">%</span></span>
<button type="button" class="bs" aria-label="Increase low assumption" onClick="{{{{ lowUp }}}}" style="width:32px;height:36px;border:1px solid $bstrong;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:$t1">{icon("plus", 14)}</button></div></div>
<div><label for="sc-high" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">High assumption</label>
<div style="display:flex;align-items:center;gap:4px"><button type="button" class="bs" aria-label="Decrease high assumption" onClick="{{{{ highDown }}}}" style="width:32px;height:36px;border:1px solid $bstrong;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:$t1">{icon("minus", 14)}</button>
<span style="position:relative;display:inline-flex;align-items:center"><input id="sc-high" type="number" min="0" max="50" value="{{{{ high }}}}" onChange="{{{{ setHigh }}}}" style="width:72px;height:36px;box-sizing:border-box;padding:0 22px 0 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:14px;font-variant-numeric:tabular-nums;background:$surface"><span style="position:absolute;right:8px;color:$t3;font-size:13px">%</span></span>
<button type="button" class="bs" aria-label="Increase high assumption" onClick="{{{{ highUp }}}}" style="width:32px;height:36px;border:1px solid $bstrong;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:$t1">{icon("plus", 14)}</button></div></div>
<div style="align-self:flex-end"><button type="button" class="bg" onClick="{{{{ reset }}}}" style="height:36px;padding:0 10px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer;display:inline-flex;gap:6px;align-items:center">{icon("history", 14)}Reset to 5–15%</button></div></div>
<sc-if value="{{{{ hasWarn }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-top:10px;font-size:12.5px;color:$wnf;display:flex;gap:6px;align-items:center">{icon("alert", 13)}{{{{ warn }}}}</div></sc-if>
</div>'''

exposure = f'''<section aria-label="Exposure">
{h2("Exposure", "Three typed measures in separate groups. Revenue and pipeline are never added; the scenario is an assumption you set.")}
<sc-if value="{{{{ gate }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="border:1px dashed $bstrong;border-radius:8px;padding:28px;display:flex;gap:12px;align-items:flex-start;background:$canvas">
<span style="color:$wnf">{icon("halfcircle", 20)}</span><div><div style="font-weight:600;font-size:14.5px">Confirm overlap before exposure is calculated</div>
<p style="margin:4px 0 0;font-size:13px;color:$t2;max-width:60ch;line-height:20px">The use-case mapping is an AI draft. Exposure uses only confirmed product and segment scope, so nothing is calculated yet.</p>
<div style="margin-top:12px">{btn("Confirm overlap", "p", handler="confirmOverlap", ic="check")}</div></div></div></sc-if>
<sc-if value="{{{{ overlapOk }}}}" hint-placeholder-val="{{{{ true }}}}"><div>
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:stretch">
<div style="flex:2 1 380px;min-width:0"><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:8px">Recognized revenue basis</div>
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">{measure("Relevant annual revenue", "€24.0M", "TTM to 30 Sep 2026 · ND-200 · German segment · EUR", "Exact: €24,000,000")}{measure("Affected existing accounts", "18", "Distinct accounts · confirmed product and segment scope", "Counted once per account ID")}</div></div>
<div role="separator" aria-label="Not recognized revenue" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:$t3;writing-mode:vertical-rl;transform:rotate(180deg);padding-top:24px"><span style="flex:1;width:1px;background:$bstrong"></span>Not recognized revenue<span style="flex:1;width:1px;background:$bstrong"></span></div>
<div style="flex:1 1 200px;min-width:0"><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:8px">Opportunities</div>{measure("Open pipeline", "€6.0M", "Current opportunity amount · EUR · snapshot 30 Sep 2026", "Exact: €6,000,000 · separate from revenue")}</div></div>
<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;align-items:stretch">{scenario}{definition}</div>
</div></sc-if></section>'''

ACC = [("DE-01", "University hospital lab", "Bavaria", "Sofia Klein", "Yes"), ("DE-02", "Regional hospital lab", "Hesse", "Sofia Klein", "No"),
       ("DE-03", "Private laboratory group", "North Rhine-Westphalia", "Sofia Klein", "Yes"), (None,), ("DE-05", "Municipal hospital lab", "Hamburg", "Sofia Klein", "No"),
       ("DE-06", "University hospital lab", "Baden-Württemberg", "Sofia Klein", "Yes"), (None,), ("DE-08", "Regional hospital lab", "Lower Saxony", "Sofia Klein", "No"),
       ("DE-09", "Private laboratory group", "Berlin", "Sofia Klein", "Yes"), ("DE-10", "Regional hospital lab", "Saxony", "Sofia Klein", "No")]
arows = ""
for a in ACC:
    if a[0] is None:
        arows += f'<tr><td style="{TD}">{restr()}</td><td style="{TD}">{restr()}</td><td style="{TD}">{restr()}</td><td style="{TD}">Key account team</td><td style="{TD}">ND-200 · use case 1</td><td style="{TD}">{restr()}</td></tr>'
    else:
        arows += f'<tr class="hr"><td style="{TD}">{mono(a[0])}</td><td style="{TD}">{a[1]}</td><td style="{TD}">{a[2]}</td><td style="{TD}">{a[3]}</td><td style="{TD}">ND-200 · use case 1</td><td style="{TD}">{a[4]}</td></tr>'

drill = f'''<section aria-label="Calculation">
<button type="button" class="bs" onClick="{{{{ toggleDrill }}}}" aria-expanded="{{{{ drillExpanded }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;color:$t1">{icon("sigma", 15)}{{{{ drillLabel }}}}</button>
<sc-if value="{{{{ drillOpen }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="margin-top:12px">
<div style="display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;margin-bottom:8px;font-size:12.5px;color:$t2"><span style="font-weight:500;color:$t1">Scope: Diagnostics BU · Germany · ND-200 · confirmed use case 1</span><span style="display:inline-flex;gap:5px;align-items:center">{icon("lock", 13)}You can see 14 of 18 accounts. Totals reflect all 18 and are shown only as the aggregates above.</span></div>
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:820px">
<thead><tr><th scope="col" style="{TH}">Account</th><th scope="col" style="{TH}">Site type</th><th scope="col" style="{TH}">Region</th><th scope="col" style="{TH}">Account owner</th><th scope="col" style="{TH}">Matched scope</th><th scope="col" style="{TH}">Open opportunity</th></tr></thead>
<tbody>{arows}<tr><td colspan="6" style="padding:10px 14px;font-size:12.5px;color:$t2">Showing 10 of 18 · <a href="#" style="font-weight:500">Show all</a> · Per-account revenue is not shown here. Restricted rows are summarised by their owner; request access from the key account team.</td></tr></tbody></table></div></div></sc-if>
</section>'''

content = header + f'''<div style="max-width:1160px;padding:24px;display:flex;flex-direction:column;gap:32px">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="font-size:13px;color:$t2;flex:1 1 300px">Where AX-Scan touches our business, and how big the exposure is by each measure.</span>{btn("Edit mappings", "g", ic="pencil")}{btn("Update assumptions", "g", ic="ruler")}{btn("Request data", "s", ic="users")}</div>
{matrix}{exposure}{drill}</div>'''

logic = r'''class Component extends DCLogic {
  state = { overlap: true, low: 5, high: 15, edited: false, drill: true, assessed: false };
  renderVals() {
    const s = this.state;
    const clamp = (v) => Math.max(0, Math.min(50, Math.round(Number(v) || 0)));
    const setLH = (low, high) => this.setState({ low: clamp(low), high: clamp(high), edited: true });
    const lo = Math.min(s.low, s.high), hi = Math.max(s.low, s.high);
    const m = (p) => (24 * p / 100).toFixed(1);
    const range = lo === hi ? '€' + m(lo) + 'M' : '€' + m(lo) + '–' + m(hi) + 'M';
    const pct = lo === hi ? lo + '%' : lo + '–' + hi + '%';
    const changed = s.edited && !(s.low === 5 && s.high === 15);
    return {
      overlapOk: s.overlap, overlapPending: !s.overlap, gate: !s.overlap,
      confirmOverlap: () => this.setState({ overlap: true }),
      togglePreview: () => this.setState({ overlap: !s.overlap, assessed: false }),
      previewLabel: s.overlap ? 'Preview: before overlap is confirmed' : 'Back to confirmed state',
      low: s.low, high: s.high,
      setLow: (e) => setLH(e.target.value, s.high), setHigh: (e) => setLH(s.low, e.target.value),
      lowDown: () => setLH(s.low - 1, s.high), lowUp: () => setLH(s.low + 1, s.high),
      highDown: () => setLH(s.low, s.high - 1), highUp: () => setLH(s.low, s.high + 1),
      reset: () => this.setState({ low: 5, high: 15, edited: false }),
      range, formula: '€24.0M × ' + pct + ' = ' + range,
      rangeStyle: 'font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.02em;margin-top:8px;font-variant-numeric:tabular-nums;transition:background 600ms;border-radius:4px;' + (changed ? 'background:$accbg;' : 'background:transparent;'),
      editedBy: changed ? 'Edited by Maya Patel · just now' : (s.edited ? 'Reviewed by Maya Patel · just now' : 'AI draft · proposed 8 Oct, 14:31'),
      hasWarn: s.low > s.high, warn: 'Low is above high. The range uses the smaller value as low.',
      drillOpen: s.drill, drillExpanded: s.drill ? 'true' : 'false', toggleDrill: () => this.setState({ drill: !s.drill }),
      drillLabel: s.drill ? 'Hide calculation' : 'Show calculation: 18 accounts',
      canConfirm: s.overlap && !s.assessed, assessed: s.assessed, blocked: !s.overlap,
      confirmAssessment: () => this.setState({ assessed: true }),
      nextTitle: !s.overlap ? 'Confirm overlap to calculate exposure' : (s.assessed ? 'Assessment confirmed · 9 Oct, 15:31' : 'Confirm assessment'),
      nextSub: !s.overlap ? 'Exposure waits for a confirmed product mapping.' : (s.assessed ? 'Next: compare response options.' : 'Overlap confirmed. Scenario inputs ' + pct + '.')
    };
  }
}'''

page("Impact.dc.html", "Impact Workspace", shell("Cases", "Fri 9 Oct 2026, 15:30", content), logic, height=2000)
