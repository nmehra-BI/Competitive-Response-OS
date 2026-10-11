from common import *

LB = "display:block;font-size:12.5px;font-weight:500;margin-bottom:6px"
inp = "width:100%;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13.5px;color:$t1;background:$surface"
tag = lambda t, extra="": f'<span style="display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid $border;border-radius:6px;font-size:13px;background:$canvas">{t}{extra}</span>'

config = f'''<section aria-label="Watchlist configuration" style="flex:999 1 560px;min-width:0;border:1px solid $border;border-radius:8px">
<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid $border;flex-wrap:wrap"><h2 style="margin:0;font-size:16px;font-weight:600">Apex Diagnostics · DACH</h2>
<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$okb;color:$okf;font-size:12.5px;font-weight:500">{icon("checkcircle", 13)}Active</span><span style="font-size:12.5px;color:$t3;margin-left:auto">Owner Maya Patel · edited 1 Oct, 09:40</span></div>
<div style="padding:18px;display:flex;flex-direction:column;gap:18px">
<div><span style="{LB}">Competitors</span><div style="display:flex;flex-wrap:wrap;gap:8px">{tag("Apex Diagnostics", '<span style="color:$t3;font-size:12px">aliases: Apex Dx, Apex Diagnostics GmbH</span>')}</div></div>
<div><span style="{LB}">Product mappings</span><div style="display:flex;flex-wrap:wrap;gap:8px">{tag("AX-Scan ↔ ND-200", f'<span style="color:$wnf;font-size:12px;display:inline-flex;gap:4px;align-items:center">{icon("halfcircle", 12)}Pending review</span>')}</div><div style="font-size:12px;color:$t3;margin-top:6px">Mappings are confirmed per case before exposure is calculated.</div></div>
<div><span style="{LB}">Markets</span><div style="display:flex;flex-wrap:wrap;gap:8px">{tag("Germany")}{tag("Austria")}{tag("Switzerland")}</div></div>
<fieldset style="border:0;margin:0;padding:0"><legend style="{LB}">Event types</legend><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px 16px">
<sc-for list="{{{{ events }}}}" as="e" hint-placeholder-count="6"><label style="display:flex;gap:8px;align-items:center;font-size:13.5px;cursor:pointer;min-height:28px"><input type="checkbox" checked="{{{{ e.on }}}}" onChange="{{{{ e.pick }}}}" style="width:16px;height:16px;margin:0;accent-color:#3049C9">{{{{ e.label }}}}</label></sc-for></div></fieldset>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
<div><label for="wl-owner" style="{LB}">Routing owner</label><select id="wl-owner" style="{inp}"><option>Maya Patel</option><option>Jonas Weber</option></select></div>
<div><label for="wl-digest" style="{LB}">Digest</label><select id="wl-digest" value="{{{{ digest }}}}" onChange="{{{{ setDigest }}}}" style="{inp}"><option value="daily">Daily at 08:00 CET</option><option value="weekly">Weekly, Monday 08:00 CET</option><option value="material">Material events only</option></select></div></div>
<div><span style="{LB}">Priority thresholds</span>
<ul style="list-style:none;margin:0;padding:0;border:1px solid $border;border-radius:8px;font-size:13px">
<li style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-bottom:1px solid $border"><span style="width:90px">{prio("High")}</span><span style="color:$t2">Overlaps a monitored product in a monitored market and has a primary source</span></li>
<li style="display:flex;gap:12px;align-items:center;padding:10px 12px;border-bottom:1px solid $border"><span style="width:90px">{prio("Medium")}</span><span style="color:$t2">Named competitor and monitored market, no product overlap yet</span></li>
<li style="display:flex;gap:12px;align-items:center;padding:10px 12px"><span style="width:90px">{prio("Low")}</span><span style="color:$t2">Indirect signals such as hiring or general statements</span></li></ul></div>
<div role="status" aria-live="polite" style="font-size:12.5px;color:$t2">{{{{ saveMsg }}}}</div>
</div></section>'''

guard = f'''<aside aria-label="Activation" style="flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:16px">
<div style="border:1px solid $border;border-radius:8px;padding:16px 18px"><h3 style="margin:0 0 8px;font-size:14px;font-weight:600">Ready to activate</h3>
<ul style="list-style:none;margin:0;padding:0;font-size:13px">{"".join(f'<li style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid $border"><span style="color:$okf">{icon("checkcircle", 15)}</span><span style="flex:1">{a}</span><span style="font-size:12px;color:$t3">{b}</span></li>' for a, b in [("Minimum scope", "1 competitor · 3 markets"), ("Routing owner", "Maya Patel"), ("Sources available", "Curated public · licensed (excerpt-only)"), ("Event types", "At least one")])}</ul>
<p style="margin:10px 0 0;font-size:12px;color:$t3">A watchlist can’t be activated without scope and an owner.</p></div>
<div style="border:1px solid $border;border-radius:8px;padding:16px 18px"><h3 style="margin:0;font-size:14px;font-weight:600">What would have been surfaced</h3><p style="margin:4px 0 10px;font-size:12.5px;color:$t2">Permitted examples from the last 30 days with these settings.</p>
<ul style="list-style:none;margin:0;padding:0;font-size:13px;display:flex;flex-direction:column;gap:8px">
<li style="display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid $border;border-radius:6px"><span>Apex Diagnostics half-year update mentions European expansion</span><span style="display:flex;gap:8px;align-items:center">{prio("Low")}{ev("Verified")}</span></li>
<li style="display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:1px solid $border;border-radius:6px"><span>AX-Scan product page updated (September 2026)</span><span style="display:flex;gap:8px;align-items:center">{prio("Medium")}{ev("Verified")}</span></li></ul></div></aside>'''

STEPS = ["Map fields", "Validate", "Preview", "Create snapshot"]
stepper = f'''<ol aria-label="Import steps" style="list-style:none;margin:0;padding:14px 18px;display:flex;flex-wrap:wrap;gap:10px 8px;align-items:center;border-bottom:1px solid $border">
<sc-for list="{{{{ steps }}}}" as="p" hint-placeholder-count="4"><li style="display:inline-flex;align-items:center;gap:8px;font-size:13px"><span style="{{{{ p.dot }}}}">{{{{ p.n }}}}</span><span style="{{{{ p.lab }}}}">{{{{ p.label }}}}</span><span aria-hidden="true" style="{{{{ p.sep }}}}"></span></li></sc-for></ol>'''

TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 12px;height:34px;border-bottom:1px solid $border;white-space:nowrap;background:$canvas"
TD = "padding:8px 12px;border-bottom:1px solid $border;font-size:13px;vertical-align:middle"
sel = "height:32px;padding:0 8px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13px;background:$surface;color:$t1;min-width:220px"
MAP = [("account_id", "Account ID", "DE-01"), ("account_name", "Account name · restricted field", None), ("site_country", "Country", "DE"), ("segment", "Segment", "Selected German segment"),
       ("product", "Product", "ND-200"), ("revenue_ttm_eur", "Relevant revenue · TTM · EUR", None), ("period_end", "Period end", "2026-09-30"),
       ("opp_amount_eur", "Open opportunity amount · EUR", None), ("owner_email", "Account owner", "Sofia Klein")]
maprows = "".join(f'<tr><td style="{TD};font-family:$mono;font-size:12.5px">{c}</td><td style="{TD}">{icon("arrowr", 14, "$t3")}</td><td style="{TD}"><select aria-label="Field for {c}" style="{sel}"><option>{f}</option><option>Do not import</option></select></td><td style="{TD};color:$t2">{v if v else restr()}</td></tr>' for c, f, v in MAP)
step1 = f'''<sc-if value="{{{{ s1 }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="padding:18px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px"><span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("file", 15)}northstar_de_accounts_2026-09-30.csv</span><span style="color:$t3">Uploaded by Maya Patel · 1 Oct, 09:52</span><span style="margin-left:auto;color:$t2">9 columns detected · all mapped</span></div>
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:720px"><thead><tr><th scope="col" style="{TH}">CSV column</th><th scope="col" style="{TH};width:30px"></th><th scope="col" style="{TH}">Maps to</th><th scope="col" style="{TH}">Sample value</th></tr></thead><tbody>{maprows}</tbody></table></div>
<div style="font-size:12.5px;color:$t2">Commercial values are restricted in previews. Totals are computed server-side.</div>
<div style="display:flex;justify-content:flex-end">{btn("Validate file", "p", handler="next", ic="arrowr")}</div></div></sc-if>'''

ISS = f'''<sc-for list="{{{{ issues }}}}" as="i" hint-placeholder-count="4"><li style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:12px 14px;border-bottom:1px solid $border">
<span style="{{{{ i.badge }}}}">{{{{ i.kind }}}}</span><span style="flex:1 1 280px;min-width:0;font-size:13px"><b style="font-weight:500">{{{{ i.where }}}}</b> · {{{{ i.text }}}}</span>
<sc-if value="{{{{ i.open }}}}" hint-placeholder-val="{{{{ true }}}}"><span style="display:flex;gap:6px"><button type="button" class="bs" onClick="{{{{ i.fix }}}}" style="height:30px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;color:$t1">{{{{ i.fixLabel }}}}</button><button type="button" class="bg" onClick="{{{{ i.skip }}}}" style="height:30px;padding:0 10px;border:0;border-radius:6px;font:inherit;font-size:12.5px;cursor:pointer;color:$t2">{{{{ i.skipLabel }}}}</button></span></sc-if>
<sc-if value="{{{{ i.done }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="font-size:12.5px;color:$okf;display:inline-flex;gap:4px;align-items:center">{icon("check", 13)}{{{{ i.result }}}}</span></sc-if></li></sc-for>'''
step2 = f'''<sc-if value="{{{{ s2 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="padding:18px;display:flex;flex-direction:column;gap:14px">
<div style="display:flex;gap:8px 20px;flex-wrap:wrap;font-size:13px"><span><b style="font-weight:600">[n]</b> rows parsed</span><span style="color:$t2">{{{{ openCount }}}} issues to resolve</span><span style="color:$t3">Nothing is imported until you create the snapshot.</span></div>
<ul style="list-style:none;margin:0;padding:0;border:1px solid $border;border-radius:8px">{ISS}</ul>
<div style="display:flex;justify-content:space-between">{btn("Back", "g", handler="back", ic="chevl")}<button type="button" onClick="{{{{ next }}}}" disabled="{{{{ v2Disabled }}}}" style="{{{{ v2Style }}}}">Continue to preview</button></div></div></sc-if>'''

step3 = f'''<sc-if value="{{{{ s3 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="padding:18px;display:flex;flex-direction:column;gap:14px">
<p style="margin:0;font-size:13px;color:$t2">Segment totals from this file. Case-level filters (confirmed use cases, deduplication by account) are applied later in each case.</p>
<div style="display:flex;flex-wrap:wrap;gap:12px">
<div style="flex:1 1 240px;min-width:0">{measure("Relevant annual revenue", "€24.0M", "ND-200 · German segment · TTM to 30 Sep 2026 · EUR")}</div>
<div style="flex:1 1 240px;min-width:0">{measure("Open pipeline", "€6.0M", "Current opportunities · separate from revenue")}</div>
<div style="flex:1 1 200px;min-width:0">{measure("Rows imported", "[n]", "After resolved issues · illustrative count")}</div></div>
<div style="display:flex;justify-content:space-between">{btn("Back", "g", handler="back", ic="chevl")}{btn("Continue", "p", handler="next", ic="arrowr")}</div></div></sc-if>'''

step4 = f'''<sc-if value="{{{{ s4 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="padding:18px;display:flex;flex-direction:column;gap:14px">
<sc-if value="{{{{ notCreated }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="display:flex;flex-direction:column;gap:12px">
<dl style="display:grid;grid-template-columns:150px 1fr;gap:8px 14px;margin:0;font-size:13.5px"><dt style="color:$t3">Snapshot date</dt><dd style="margin:0;font-weight:500">30 Sep 2026</dd><dt style="color:$t3">Source</dt><dd style="margin:0">northstar_de_accounts_2026-09-30.csv</dd><dt style="color:$t3">Currency · period</dt><dd style="margin:0">EUR · TTM to 30 Sep 2026</dd><dt style="color:$t3">Earlier snapshots</dt><dd style="margin:0">Kept. The 30 Jun 2026 snapshot is not overwritten.</dd></dl>
<div style="display:flex;justify-content:space-between">{btn("Back", "g", handler="back", ic="chevl")}{btn("Create dated snapshot", "p", handler="create", ic="database")}</div></div></sc-if>
<sc-if value="{{{{ created }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("ok", "Snapshot 30 Sep 2026 created", "It is now the current portfolio snapshot. Cases use it for exposure and show its date next to every figure.")}</sc-if></div></sc-if>'''

history = f'''<section aria-label="Snapshot history">{h2("Snapshot history", "Every import creates a new dated snapshot. Nothing is overwritten.")}
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:720px"><thead><tr><th scope="col" style="{TH}">Snapshot date</th><th scope="col" style="{TH}">Source file</th><th scope="col" style="{TH}">Rows</th><th scope="col" style="{TH}">Created</th><th scope="col" style="{TH}">Status</th></tr></thead><tbody>
<tr><td style="{TD};font-weight:500">30 Sep 2026</td><td style="{TD};font-family:$mono;font-size:12.5px">northstar_de_accounts_2026-09-30.csv</td><td style="{TD}">[n]</td><td style="{TD}">{{{{ newCreated }}}}</td><td style="{TD}">{{{{ newStatus }}}}</td></tr>
<tr><td style="{TD};font-weight:500">30 Jun 2026</td><td style="{TD};font-family:$mono;font-size:12.5px">northstar_de_accounts_2026-06-30.csv</td><td style="{TD}">[n]</td><td style="{TD}">Maya Patel · 2 Jul 2026</td><td style="{TD}">{{{{ oldStatus }}}}</td></tr></tbody></table></div></section>'''

content = f'''<div style="max-width:1160px;padding:20px 24px 40px;display:flex;flex-direction:column;gap:28px">
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end"><div style="flex:1 1 400px;min-width:0"><h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">Watchlists and portfolio</h1>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Are we watching the right things, and is our product and account data sound?</p></div>{btn("New watchlist", "s", ic="plus")}</div>
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">{config}{guard}</div>
<section aria-label="Portfolio import" style="border:1px solid $border;border-radius:8px">
<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid $border;flex-wrap:wrap"><h2 style="margin:0;font-size:16px;font-weight:600">Portfolio import</h2><span style="font-size:12.5px;color:$t3">CSV · for teams without a CRM connection</span></div>
{stepper}{step1}{step2}{step3}{step4}</section>
{history}</div>'''

logic = r'''class Component extends DCLogic {
  state = { step: 2, ev: { launch: true, reg: true, price: true, partner: true, entry: true, hiring: false }, digest: 'daily', fixed: {}, created: false, saved: '' };
  renderVals() {
    const s = this.state;
    const EV = [['launch', 'Product launch'], ['reg', 'Regulatory status change'], ['price', 'Pricing change'], ['partner', 'Partnership or distribution'], ['entry', 'Market entry'], ['hiring', 'Hiring signals']];
    const events = EV.map(([k, l]) => ({ label: l, on: !!s.ev[k], pick: () => this.setState({ ev: { ...s.ev, [k]: !s.ev[k] }, saved: 'Saved · ' + l + (s.ev[k] ? ' off' : ' on') }) }));
    const L = ['Map fields', 'Validate', 'Preview', 'Create snapshot'];
    const steps = L.map((l, i) => ({ n: s.step > i + 1 || (s.created && i === 3) ? '✓' : String(i + 1), label: l,
      dot: 'width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;' + (s.step > i + 1 || (s.created && i === 3) ? 'background:$okb;color:$okf;' : (s.step === i + 1 ? 'background:$t1;color:#fff;' : 'border:1px solid $bstrong;color:$t3;')),
      lab: s.step === i + 1 ? 'color:$t1;font-weight:500;' : 'color:$t2;', sep: i < 3 ? 'display:inline-block;width:28px;height:1px;background:$bstrong;margin:0 4px;' : 'display:none;' }));
    const I = [
      { id: 'a', kind: 'Missing value', where: 'Row 14', text: 'period_end is empty', fixLabel: 'Use 2026-09-30', skipLabel: 'Exclude row', fixed: 'Set to 2026-09-30', skipped: 'Row excluded' },
      { id: 'b', kind: 'Invalid number', where: 'Row 22', text: 'revenue_ttm_eur is “1,2M”, not a number', fixLabel: 'Edit value', skipLabel: 'Exclude row', fixed: 'Value corrected', skipped: 'Row excluded' },
      { id: 'c', kind: 'Duplicate record', where: 'Rows 31 and 32', text: 'same account_id DE-07 and product', fixLabel: 'Merge', skipLabel: 'Keep first', fixed: 'Merged into one record', skipped: 'Kept row 31' },
      { id: 'd', kind: 'Missing column', where: 'File', text: 'no currency column; all values look like EUR', fixLabel: 'Set EUR for all rows', skipLabel: 'Cancel import', fixed: 'Currency set to EUR', skipped: 'Import cancelled' }
    ];
    const badge = (k) => 'display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:12px;font-weight:500;white-space:nowrap;' + (k === 'Duplicate record' ? 'background:$wnb;color:$wnf;' : (k === 'Missing column' ? 'background:$inb;color:$inf;' : 'background:$dgb;color:$dgf;'));
    const issues = I.map(i => ({ ...i, badge: badge(i.kind), open: !s.fixed[i.id], done: !!s.fixed[i.id], result: s.fixed[i.id] || '',
      fix: () => this.setState({ fixed: { ...s.fixed, [i.id]: i.fixed } }), skip: () => this.setState({ fixed: { ...s.fixed, [i.id]: i.skipped } }) }));
    const openCount = I.filter(i => !s.fixed[i.id]).length;
    const ok = openCount === 0;
    return {
      events, digest: s.digest, setDigest: (e) => this.setState({ digest: e.target.value, saved: 'Saved · digest updated' }), saveMsg: s.saved,
      steps, s1: s.step === 1, s2: s.step === 2, s3: s.step === 3, s4: s.step === 4,
      next: () => (s.step !== 2 || ok) && this.setState({ step: Math.min(4, s.step + 1) }), back: () => this.setState({ step: Math.max(1, s.step - 1) }),
      issues, openCount: String(openCount), v2Disabled: !ok,
      v2Style: 'display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (ok ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      create: () => this.setState({ created: true }), created: s.created, notCreated: !s.created,
      newCreated: s.created ? 'Maya Patel · 1 Oct 2026' : 'Not created yet', newStatus: s.created ? 'Current' : 'Draft import', oldStatus: s.created ? 'Superseded · kept' : 'Current'
    };
  }
}'''

page("Watchlists.dc.html", "Watchlists", shell("Watchlists", "Thu 1 Oct 2026, 10:00 · setup", content), logic, height=1760)
