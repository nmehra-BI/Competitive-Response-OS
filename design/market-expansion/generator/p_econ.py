from components import *

nxt = next_block("G1 · Approve validation €15k", "Elena Fischer decides · due 16 Oct", "EF",
                 f'<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:$t2">{icon("message", 13, "$wnf")}Finance review in progress · Daniel Weber · due 22 Oct</div>')
header = case_header("Economics", stage("Assessment"), 1, G_ASSESS, nxt, "Evidence checked 2 days ago · 1 source ageing", {"Feasibility": "1 pending", "Validation": "1 disputed"})

NI = "width:96px;height:34px;box-sizing:border-box;padding:0 8px;border:1px solid $ctrl;border-radius:6px;font-family:$mono;font-size:13px;text-align:right;background:$surface;color:$t1"


def drv(key, label, unit_pre, unit_post, kind_html, owner_note):
    return (f'<tr class="hr"><th scope="row" style="{TD};text-align:left;font-weight:500"><label for="in-{key}">{label}</label></th>'
            f'<td style="{TD}"><span style="display:inline-flex;align-items:center;gap:6px;font-family:$mono;font-size:13px">{unit_pre}'
            f'<input id="in-{key}" type="number" value="{hv(key)}" onChange="{hv("set_" + key)}" style="{NI};{hv("st_" + key)}">{unit_post}</span></td>'
            f'<td style="{TD}">{kind_html}</td><td style="{TD};color:$t2;font-size:12.5px">{owner_note}</td></tr>')


drivers = f'''<section aria-labelledby="dr">{h2("Drivers", "Edit in draft. The approved snapshot never recalculates.", hid="dr", right=f'<span role="status" style="font-size:12.5px;{hv("draftStyle")}">{hv("draftNote")}</span>' + btn("Reset to v2", "g", handler="reset"))}
{card(f"""<div style="overflow-x:auto"><table aria-label="Economics drivers" style="width:100%;border-collapse:collapse;min-width:720px"><thead><tr><th scope="col" style="{TH}">Driver</th><th scope="col" style="{TH}">Value</th><th scope="col" style="{TH}">Kind</th><th scope="col" style="{TH}">Basis</th></tr></thead><tbody>
{drv("price", "Annual price per site", "€", "k/year", kind("Assumption", "Maya Rao", small=True), "Test: paid pilot offer · buyer interviews")}
{drv("adopt", "Adoption by year 3 · Base", "", "%", kind("Assumption", "Maya Rao", small=True) + f' <a href="Validation.dc.html" style="display:inline-flex;gap:3px;align-items:center;font-size:12px;color:$wnf;font-weight:500;text-decoration:none;vertical-align:-2px">{icon("message", 12)}Disputed</a>', "Of the 500-site reachable pool · Downside fixed at 10% (Daniel Weber)")}
{drv("margin", "Gross margin", "", "%", kind("Assumption", "Daniel Weber", small=True), "Delivery and COGS deducted")}
{drv("opex", "Annual incremental opex", "€", "k/year", kind("Assumption", "Daniel Weber", small=True), "Sales and admin only · excludes COGS")}
{drv("cap", "Installation and support capacity", "", "customers", kind("Assumption", "[Operations lead]", small=True), "Raising it is a G3 decision")}
{drv("once", "Scale-entry investment", "€", "k one-time", kind("Assumption", "Maya Rao", small=True), "Kept apart from all /year values")}
<tr><th scope="row" style="{TD};text-align:left;font-weight:500;color:$t2">Reachable pool</th><td style="{TD};font-family:$mono;font-size:13px">500 sites</td><td style="{TD}">{kind("Assumption", "Jonas Klein", small=True)}</td><td style="{TD};color:$t2;font-size:12.5px">From Sizing v2 · edit there</td></tr>
</tbody></table></div>""", "overflow:hidden")}</section>'''


def scrow(label, key, formula_txt, strong=False):
    w = "font-weight:600;" if strong else ""
    return (f'<tr class="hr"><th scope="row" style="{TD};text-align:left;font-weight:500">{label}<div style="font-family:$mono;font-size:11.5px;color:$t3;font-weight:400;margin-top:2px">{formula_txt}</div></th>'
            + "".join(f'<td style="{TD};{NUM};{w}{hv(s + "_" + key + "St")}">{hv(s + "_" + key)}</td>' for s in ["dn", "bs", "up"]) + "</tr>")


sc_head = "".join(f'<th scope="col" style="{TH};text-align:right;width:22%"><span style="display:inline-flex;gap:6px;align-items:center;color:$t1;font-size:12.5px;font-weight:600">{sc_mark(s, 12)}{s}</span></th>' for s in ["Downside", "Base", "Upside"])
scen = f'''<section aria-labelledby="sc" style="margin-top:28px">{h2("Scenarios", "Conditional cases with named changes — not probabilities. Steady state at end of year 3 · EUR · 2026 prices.", hid="sc", right=kind("Scenario", "Year 3"))}
{card(f"""<div style="overflow-x:auto"><table aria-label="Scenario table" style="width:100%;border-collapse:collapse;min-width:720px;table-layout:fixed"><thead><tr><th scope="col" style="{TH};width:34%">Measure</th>{sc_head}</tr></thead><tbody>
{scrow("Customers · end of year 3", "cust", "min(500 × adoption, capacity)")}
{scrow("Annual revenue", "rev", "customers × price")}
{scrow("Gross contribution", "gross", "revenue × margin")}
{scrow("Annual incremental opex", "opex", "input")}
{scrow("Contribution after incremental opex", "after", "gross contribution − opex", True)}
<tr><th scope="row" style="{TD};text-align:left;font-weight:500">What changes vs Base</th><td style="{TD};font-size:12.5px;color:$t2">{hv("dn_what")}</td><td style="{TD};font-size:12.5px;color:$t2">—</td><td style="{TD};font-size:12.5px;color:$t2">{hv("up_what")}</td></tr>
</tbody></table></div>""", "overflow:hidden")}
<p style="margin:8px 0 0;font-size:12.5px;color:$t3">Revenue in €m with one decimal · gross contribution in €m with two · opex and after-opex in €k. Cells marked Recalculated differ from snapshot v2.</p></section>'''

money = f'''<section aria-labelledby="mc" style="margin-top:28px">{h2("Recurring and one-time money", "Different time bases", hid="mc")}
<div style="display:flex;flex-wrap:wrap;gap:0;align-items:stretch">
<div style="flex:1 1 300px;min-width:0;border:1px solid $border;border-radius:8px;padding:14px 16px">{eyebrow("Recurring · per year · steady state · Base")}
<dl style="margin:0;display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:13.5px"><dt>Annual revenue</dt><dd style="margin:0;font-weight:600">{hv("bs_rev")}/year</dd><dt>Gross contribution · {hv("margin")}% margin</dt><dd style="margin:0;font-weight:600">{hv("bs_gross")}/year</dd><dt>Contribution after incremental opex</dt><dd style="margin:0;font-weight:600">{hv("bs_after")}/year</dd></dl></div>
<div role="separator" aria-label="Different time bases. Do not add." style="flex:0 0 120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;color:$t2;font-size:12px;text-align:center"><span style="width:1px;height:24px;background:$bstrong"></span>{icon("x", 14)}<span style="font-weight:600;color:$t1">Do not add</span><span>Different time bases</span><span style="width:1px;height:24px;background:$bstrong"></span></div>
<div style="flex:1 1 220px;min-width:0;border:1px solid $border;border-radius:8px;padding:14px 16px">{eyebrow("One-time")}
<div style="font-size:24px;font-weight:600;letter-spacing:-0.01em">{hv("onceTxt")}</div><div style="font-size:12.5px;color:$t2;margin-top:2px">Scale-entry investment · only relevant at G3 · not part of the pilot</div></div></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:12px">
<div aria-disabled="true" style="border:1px dashed $ctrl;border-radius:8px;padding:14px 16px;background:$canvas;color:$t2">
<div style="display:flex;gap:6px;align-items:center;font-weight:600;color:$t1;font-size:13.5px">{icon("lock", 14)}Cash flow</div>
<div style="font-size:13px;margin-top:4px">Not available — needs inputs below.</div></div>
<div aria-disabled="true" style="border:1px dashed $ctrl;border-radius:8px;padding:14px 16px;background:$canvas;color:$t2">
<div style="display:flex;gap:6px;align-items:center;font-weight:600;color:$t1;font-size:13.5px">{icon("lock", 14)}Payback</div>
<div style="font-size:13px;margin-top:4px">Not available — no reproducible formula without the inputs below.</div></div>
<div style="border:1px solid $border;border-radius:8px;padding:14px 16px">{eyebrow("Missing inputs")}<ul style="margin:0;padding-left:18px;font-size:13px;line-height:20px"><li>Acquisition ramp</li><li>Retention</li><li>Cash timing</li><li>Partner margin</li><li>FX and base year policy</li></ul></div></div>
<div style="margin-top:12px;border:1px solid $border;border-radius:8px;padding:12px 14px;font-size:13px;display:flex;gap:10px;align-items:flex-start;background:$surface">{icon("info", 15, "$t2")}<span><b style="font-weight:600">Exclusions</b> · Before taxes, working capital, ramp timing and financing. Constant price and margin. Not a year-one profit or cash-flow forecast.</span></div></section>'''

mustbe = f'''<aside aria-label="What must be true" style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
<div style="font-size:14px;font-weight:600">What must be true?</div>
<p style="margin:0;font-size:13px;color:$t2">Working back from a target contribution after opex of €0k (break-even):</p>
<div style="font-family:$mono;font-size:12.5px;line-height:19px;padding:8px 10px;background:$canvas;border:1px solid $border;border-radius:6px">customers = opex ÷ (price × margin)<br>= {hv("opexTxt")} ÷ ({hv("priceTxt")} × {hv("margin")}%)<br>= <b style="color:$t1">{hv("beCust")}</b></div>
<p role="status" style="margin:0;font-size:13px">{hv("beNote")}</p></aside>'''

chart = f'''<section aria-labelledby="ch" style="border:1px solid $border;border-radius:8px;padding:14px 16px">
<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;flex-wrap:wrap"><h2 id="ch" style="margin:0;font-size:14px;font-weight:600">Customers by scenario</h2>{seg("chBtns", "Chart or table")}</div>
<p style="margin:4px 0 8px;font-size:12px;color:$t2">Count at end of year 3 · capacity line {hv("cap")}</p>
{IF("chChart", f"""<svg role="img" aria-label="{hv('chAria')}" viewBox="0 0 300 90" style="width:100%;height:auto;display:block;font-family:Geist,sans-serif">
<line x1="10" y1="50" x2="290" y2="50" stroke="#D6D6D0"></line>
<line x1="{hv('capX')}" y1="14" x2="{hv('capX')}" y2="62" stroke="#8A5300" stroke-width="2"></line><text x="{hv('capX')}" y="10" font-size="10" fill="#8A5300" text-anchor="middle">Capacity {hv('cap')}</text>
<circle cx="{hv('dnX')}" cy="50" r="5" fill="#5E8FA8"></circle><text x="{hv('dnX')}" y="76" font-size="10" fill="#4B4F57" text-anchor="middle">▼ {hv('dn_custN')}</text>
<circle cx="{hv('bsX')}" cy="50" r="6" fill="#2F5F78"></circle><text x="{hv('bsX')}" y="88" font-size="10" fill="#4B4F57" text-anchor="middle">● {hv('bs_custN')}</text>
<circle cx="{hv('upX')}" cy="50" r="5" fill="#163A4D"></circle><text x="{hv('upX')}" y="34" font-size="10" fill="#4B4F57" text-anchor="middle">▲ {hv('up_custN')}</text></svg>""", True)}
{IF("chTable", table(["Scenario", ">Customers"], [["▼ Downside", hv("dn_custN")], ["● Base", hv("bs_custN")], ["▲ Upside", hv("up_custN")]], minw=200))}</section>'''

review_box = f'''<aside aria-label="Finance review" style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px">
<div style="display:flex;gap:8px;align-items:center">{avatar("DW", 24)}<div style="line-height:17px"><div style="font-size:13px;font-weight:600">Finance review · Daniel Weber</div><div style="font-size:12px;color:$t2">Requested 13 Oct · due 22 Oct</div></div></div>
<div style="font-size:12.5px"><div style="color:$t3;font-weight:500">Checked so far</div>Margin definition · opex scope · currency EUR 2026</div>
<div style="font-size:12.5px"><div style="color:$t3;font-weight:500">Not checked</div>Ramp, retention, cash timing (not in model)</div>
<a href="Validation.dc.html" style="display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:$wnf;font-weight:500;text-decoration:none">{icon("message", 13)}Disputes 20% adoption · open thread</a></aside>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<div style="flex:999 1 640px;min-width:0">{drivers}{scen}{money}
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid $border">{btn("Request finance review", "s", ic="send")}{btn("Create snapshot v3", "p")}{btn("Export with formulas", "s", ic="download")}</div></div>
<div style="flex:1 1 300px;min-width:0;display:flex;flex-direction:column;gap:14px">{mustbe}{chart}{review_box}</div></div>'''

js = logic(r"""    const s = this.state;
    const D = { price: 20, adopt: 20, margin: 60, opex: 600, cap: 120, once: 400 };
    const n = (k) => { const v = parseFloat(s[k]); return isNaN(v) ? D[k] : v; };
    const P = n('price'), A = n('adopt') / 100, M = n('margin') / 100, O = n('opex'), C = Math.max(0, Math.round(n('cap'))), ONCE = n('once');
    const mny = (k) => k === 0 ? '€0k (break-even)' : (k < 0 ? '−€' + Math.abs(Math.round(k)) + 'k' : '€' + Math.round(k) + 'k');
    const calc = (cust) => { const rev = cust * P, gross = rev * M; return { cust, rev, gross, after: Math.round(gross - O) }; };
    const dnRaw = Math.round(500 * 0.10), bsRaw = Math.round(500 * A);
    const sc = { dn: calc(Math.min(dnRaw, C)), bs: calc(Math.min(bsRaw, C)), up: calc(C) };
    const ref = { dn: { cust: 50, rev: 1000, gross: 600, after: 0 }, bs: { cust: 100, rev: 2000, gross: 1200, after: 600 }, up: { cust: 120, rev: 2400, gross: 1440, after: 840 } };
    const out = {};
    const chg = 'background:$scb;box-shadow:inset 0 -2px 0 $scf;';
    ['dn', 'bs', 'up'].forEach(k => {
      const v = sc[k], r = ref[k];
      const capped = (k === 'dn' ? dnRaw : k === 'bs' ? bsRaw : Infinity) > C || k === 'up';
      out[k + '_cust'] = v.cust + (capped ? ' · capped at ' + C : '') + (v.cust !== r.cust ? ' · Recalculated' : '');
      out[k + '_custN'] = v.cust;
      out[k + '_rev'] = '€' + (v.rev / 1000).toFixed(1) + 'm';
      out[k + '_gross'] = '€' + (v.gross / 1000).toFixed(2) + 'm';
      out[k + '_opex'] = '€' + Math.round(O) + 'k';
      out[k + '_after'] = mny(v.after);
      out[k + '_custSt'] = v.cust !== r.cust ? chg : '';
      out[k + '_revSt'] = Math.round(v.rev) !== r.rev ? chg : '';
      out[k + '_grossSt'] = Math.round(v.gross) !== r.gross ? chg : '';
      out[k + '_opexSt'] = Math.round(O) !== 600 ? chg : '';
      out[k + '_afterSt'] = v.after !== r.after ? chg : '';
    });
    const changed = Object.keys(D).filter(k => n(k) !== D[k]);
    const be = P * M > 0 ? Math.ceil(O / (P * M)) : null;
    const x = (c) => Math.round(10 + Math.min(c, 160) / 160 * 280);
    const inSt = (k) => n(k) !== D[k] ? 'border-color:$scf;background:$scb;' : '';
    const setter = (k) => (e) => this.setState({ [k]: e.target.value });
    return Object.assign(out, {
      price: s.price, adopt: s.adopt, margin: s.margin, opex: s.opex, cap: C, once: s.once,
      set_price: setter('price'), set_adopt: setter('adopt'), set_margin: setter('margin'), set_opex: setter('opex'), set_cap: setter('cap'), set_once: setter('once'),
      st_price: inSt('price'), st_adopt: inSt('adopt'), st_margin: inSt('margin'), st_opex: inSt('opex'), st_cap: inSt('cap'), st_once: inSt('once'),
      draftNote: changed.length ? 'Draft · ' + changed.length + ' driver' + (changed.length > 1 ? 's' : '') + ' differ from snapshot v2' : 'Matches snapshot v2',
      draftStyle: changed.length ? 'color:$scf;font-weight:500' : 'color:$t2',
      reset: () => this.setState({ price: '20', adopt: '20', margin: '60', opex: '600', cap: '120', once: '400' }),
      dn_what: 'Adoption 10% (50 of 500 sites) · Daniel Weber’s position',
      up_what: 'Adoption high enough to reach capacity · capped at ' + C + ' (unconstrained would be higher)',
      onceTxt: '€' + Math.round(ONCE) + 'k one-time',
      opexTxt: '€' + Math.round(O) + 'k', priceTxt: '€' + P + 'k', beCust: be === null ? 'Not available' : be + ' customers',
      beNote: be === null ? 'Not available — price × margin is zero.' : 'Break-even needs ' + be + ' customers, ' + Math.round(be / 5) + '% of the reachable pool' + (be > C ? ', which is above capacity ' + C + '.' : '. Base is ' + sc.bs.cust + '.'),
      chBtns: this.seg([['chart', 'Chart'], ['table', 'Table']], 'ch'), chChart: s.ch === 'chart', chTable: s.ch === 'table',
      dnX: x(sc.dn.cust), bsX: x(sc.bs.cust), upX: x(sc.up.cust), capX: x(C),
      chAria: 'Downside ' + sc.dn.cust + ', Base ' + sc.bs.cust + ', Upside ' + sc.up.cust + ' customers; capacity ' + C
    });""", "{ price: '20', adopt: '20', margin: '60', opex: '600', cap: '120', once: '400', ch: 'chart' }")

page("Economics.dc.html", "Economics", shell("Expansion Cases", "Wed 14 Oct 2026", header + body, user="MR", autosave="Saved · 2 min ago"), js, height=2000)
