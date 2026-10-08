from common import *

LBL = "font-size:12px;color:$t3;font-weight:500;margin:0 0 8px"


def dates(event, pub, added, gap=None):
    g = f'<div style="display:flex;align-items:center;gap:6px;color:$wnf;font-size:12.5px;margin-top:6px">{icon("alert", 13)}{gap}</div>' if gap else ""
    return f'''<dl style="display:flex;flex-wrap:wrap;gap:6px 20px;margin:12px 0 0;font-size:13px">
<div style="display:flex;align-items:center;gap:6px"><dt style="display:flex;align-items:center;gap:5px;color:$t3">{icon("calendar", 14)}Event date</dt><dd style="margin:0;font-weight:500">{event}</dd></div>
<div style="display:flex;align-items:center;gap:6px"><dt style="display:flex;align-items:center;gap:5px;color:$t3">{icon("file", 14)}Published</dt><dd style="margin:0;font-weight:500">{pub}</dd></div>
<div style="display:flex;align-items:center;gap:6px"><dt style="display:flex;align-items:center;gap:5px;color:$t3">{icon("arrowin", 14)}Added</dt><dd style="margin:0;font-weight:500">{added}</dd></div>
</dl>{g}'''


def block(title, inner):
    return f'<section style="padding:16px 0;border-top:1px solid $border"><h3 style="{LBL}">{title}</h3>{inner}</section>'


def claim(ctype, text, evs, chip=""):
    return f'<li style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;padding:8px 0;border-bottom:1px solid $border"><span style="flex:0 0 auto">{ct(ctype)}</span><span style="flex:1 1 260px;min-width:0;font-size:13.5px;line-height:20px">{text}</span><span style="display:flex;gap:6px;flex-wrap:wrap">{ev(evs)}{chip}</span></li>'


def head(sid, title, pr, evs, dts):
    return f'''<div style="font-size:12px;color:$t3;display:flex;gap:8px;align-items:center">{mono(sid)}<span>Apex Diagnostics · Product launch</span></div>
<h2 style="margin:6px 0 0;font-size:19px;line-height:26px;font-weight:600;text-wrap:balance">{title}</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin-top:10px">
<span style="display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:$t3">Priority {prio(pr)}</span>
<span style="display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:$t3">Evidence {ev(evs)}</span>
<sc-if value="{{{{ selHasTriage }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$ntb;color:$t1;font-size:12.5px">{icon("check", 13)}{{{{ selTriage }}}}</span></sc-if>
</div>{dts}'''


scope = f'''<dl style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 20px;margin:0;font-size:13px">
<div><dt style="color:$t3;font-size:12px">Matched product</dt><dd style="margin:2px 0 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">AX-Scan ↔ ND-200 <span style="font-size:12px;color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("halfcircle", 12)}Pending review</span></dd></div>
<div><dt style="color:$t3;font-size:12px">Market</dt><dd style="margin:2px 0 0">Germany</dd></div>
<div><dt style="color:$t3;font-size:12px">Business unit</dt><dd style="margin:2px 0 0">Diagnostics BU</dd></div>
<div><dt style="color:$t3;font-size:12px">Watchlist</dt><dd style="margin:2px 0 0">Apex Diagnostics · DACH</dd></div></dl>'''

copies = "".join(f'<li style="display:flex;gap:8px;align-items:center;padding:6px 0;font-size:13px;color:$t2"><span style="color:$t3">{icon("layers", 13)}</span><span style="flex:1;min-width:0">{p}</span><span style="font-size:12px;color:$t3">{t}</span></li>' for p, t in [
    ("Industry newswire · syndicated", "8 Oct 09:31"), ("Trade portal · reprint", "8 Oct 09:44"), ("Regional business daily · reprint", "8 Oct 10:02"), ("News aggregator feed", "8 Oct 10:05")])

d881 = head("SIG-881", "Apex Diagnostics announces AX-Scan launch in Germany", "High", "Partial",
            dates("7 Oct 2026", "8 Oct 2026, 09:15", '<span title="8 Oct 2026, 09:40">25 min ago</span>')) + \
    f'''<div style="margin-top:14px">{banner("info", "Launch is supported by the manufacturer notice. Regulatory status is a separate claim.", "SIG-884 reports a regulatory status for AX-Scan in Germany. It is unverified and is not implied by this launch notice.")}</div>''' + \
    block("What changed", f'<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;max-width:66ch">Apex Diagnostics announced the launch of AX-Scan in Germany, dated 7 Oct 2026. The notice describes availability to hospital laboratories. It does not state pricing, reimbursement or detailed regulatory status. {src("Verified", "Apex press release", "8 Oct")}</p>') + \
    block("Evidence · 3 claims", '<ul style="list-style:none;margin:0;padding:0">' +
          claim("Fact", "Apex announced an AX-Scan launch for Germany.", "Verified", "") +
          claim("Inference · AI", "AX-Scan addresses the same laboratory use case as ND-200.", "Partial", ai()) +
          claim("Unknown", "Regulatory status for sale in Germany.", "Unverified", "") + "</ul>") + \
    block("Matched portfolio scope", scope) + \
    block("Unknowns", '<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:22px"><li>Regulatory status for Germany (reported in SIG-884, not verified)</li><li>Clinical-performance comparison with ND-200</li><li>Pricing and reimbursement</li></ul>') + \
    block("Duplicates and linked items", f'''<div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;margin-bottom:8px"><span style="font-weight:500">Independent sources: 1</span><span style="color:$t2">Syndicated copies: {{{{ copyCount }}}} · not counted as corroboration</span></div>
<ul style="list-style:none;margin:0;padding:0">{copies}
<sc-if value="{{{{ dup }}}}" hint-placeholder-val="{{{{ false }}}}"><li style="display:flex;gap:8px;align-items:center;padding:6px 0;font-size:13px;color:$t2"><span style="color:$t3">{icon("layers", 13)}</span><span style="flex:1">German-language reprint · linked from {mono("SIG-870")}</span><span style="font-size:12px;color:$t3">8 Oct 09:48</span></li></sc-if>
</ul>
<sc-if value="{{{{ notDup }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 12px;border:1px solid $border;border-radius:6px;font-size:13px"><span style="color:$t2">{icon("compare", 14)}</span><span style="flex:1 1 220px">Likely duplicate: {mono("SIG-870")} German-language reprint</span><button type="button" class="bs" onClick="{{{{ linkDup }}}}" style="height:30px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer">Link as duplicate</button><button type="button" class="bg" onClick="{{{{ notDupFn }}}}" style="height:30px;padding:0 10px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer">Not a duplicate</button></div></sc-if>
<div style="margin-top:8px;font-size:13px;display:flex;gap:6px;align-items:center;color:$t2">{icon("link", 13)}Related: {mono("SIG-884")} regulatory-status report</div>''')

d884 = head("SIG-884", "Trade report says AX-Scan is cleared for sale in Germany", "High", "Unverified",
            dates("Not stated", "8 Oct 2026, 08:20", '<span title="8 Oct 2026, 09:02">1 h ago</span>')) + \
    f'''<div style="margin-top:14px">{banner("warn", "Unverified — this can’t be presented as a confirmed event.", "Single trade source citing unnamed sources. No registry or authority record has been checked yet. You can still create or link a case; it will carry this claim as Unverified.", btn("Request verification", "s", ic="shielddash"))}</div>''' + \
    block("What changed", f'<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;max-width:66ch">A trade publication reports that AX-Scan has the regulatory status required for sale in Germany. The article does not name its source or cite a registry entry. {src("Unverified", "Trade publication", "8 Oct")}</p>') + \
    block("Evidence · 1 claim", '<ul style="list-style:none;margin:0;padding:0">' + claim("Unknown", "AX-Scan holds the regulatory status required for sale in Germany.", "Unverified", '<span style="font-size:12px;color:$t3">Single source · no corroboration</span>') + "</ul>"
          + f'<p style="margin:10px 0 0;font-size:13px;color:$t2;line-height:19px">Regulatory status is not proof of market availability, reimbursement, clinical performance or sales impact.</p>') + \
    block("Matched portfolio scope", scope) + \
    block("Duplicates and linked items", f'<div style="font-size:13px;color:$t2;display:flex;gap:6px;align-items:center">{icon("link", 13)}Same event as {mono("SIG-881")} (launch notice). Not a duplicate: different claim.</div>')

d870 = head("SIG-870", "Apex AX-Scan launch notice — German-language reprint", "Medium", "Partial",
            dates("7 Oct 2026", "8 Oct 2026, 09:48", '<span title="8 Oct 2026, 09:58">7 min ago</span>')) + \
    f'''<div style="margin-top:14px">{banner("neutral", "Likely duplicate of SIG-881", "Same text as the manufacturer notice, translated. Linking keeps this source in SIG-881’s cluster as a syndicated copy.", btn("Link as duplicate", "s", handler="linkDup") + btn("Not a duplicate", "g", handler="notDupFn"))}</div>''' + \
    block("What changed", '<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;max-width:66ch">German-language reprint of the Apex launch notice dated 7 Oct 2026. No new claims compared with SIG-881.</p>')

d866 = head("SIG-866", "Apex Diagnostics advertises key account manager roles in Germany", "Low", "Unverified",
            dates("18 Sep 2026", "2 Oct 2026", '<span title="6 Oct 2026, 08:10">2 days ago</span>', "Published 14 days after the event")) + \
    block("What changed", '<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;max-width:66ch">Job postings for key account managers covering German hospital laboratories. Hiring is an indirect signal and is not evidence of a launch.</p>') + \
    block("Why it surfaced", '<p style="margin:0;font-size:13.5px">Hiring signal in a monitored market · below the High threshold.</p>')

d859 = head("SIG-859", "AX-Scan product page: specifications section changed", "Medium", "Verified",
            dates("5 Oct 2026", "5 Oct 2026, 14:00", '<span title="5 Oct 2026, 14:20">3 days ago</span>')) + \
    block("What changed", '<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px;max-width:66ch">The specifications section of the AX-Scan product page changed. A page comparison is attached as evidence. The change does not mention Germany.</p>') + \
    block("Why it surfaced", '<p style="margin:0;font-size:13.5px">Attribute change on a product matched to ND-200.</p>')

d851 = head("SIG-851", "Apex Diagnostics half-year update mentions European expansion", "Low", "Verified",
            dates("30 Sep 2026", "30 Sep 2026, 07:00", '<span title="1 Oct 2026, 08:00">7 days ago</span>')) + \
    block("Triage", '<p style="margin:0;font-size:13.5px">Monitoring since 1 Oct by Maya Patel · reason: “General statement, no product or market named”.</p>')

details = "".join(f'<sc-if value="{{{{ sel{k} }}}}" hint-placeholder-val="{{{{ {"true" if k == "881" else "false"} }}}}"><div>{v}</div></sc-if>' for k, v in
                  [("881", d881), ("884", d884), ("870", d870), ("866", d866), ("859", d859), ("851", d851)])

PR = "".join(f'<sc-if value="{{{{ s.p{l[0]} }}}}" hint-placeholder-val="{{{{ {"true" if l == "High" else "false"} }}}}">{prio(l)}</sc-if>' for l in ["High", "Medium", "Low"])
EVS = "".join(f'<sc-if value="{{{{ s.e{l[0]} }}}}" hint-placeholder-val="{{{{ {"true" if l == "Partial" else "false"} }}}}">{ev(l)}</sc-if>' for l in ["Verified", "Partial", "Conflicting", "Unverified"])

row = f'''<sc-for list="{{{{ list }}}}" as="s" hint-placeholder-count="5">
<button type="button" class="hr" onClick="{{{{ s.pick }}}}" aria-pressed="{{{{ s.pressed }}}}" style="{{{{ s.rowStyle }}}}">
<span style="display:flex;gap:10px;align-items:flex-start;width:100%">
<span style="flex:1;min-width:0;font-size:13.5px;font-weight:500;line-height:19px;color:$t1">{{{{ s.title }}}}</span>{PR}</span>
<span style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin-top:6px;font-size:12.5px;color:$t2;width:100%">
<span>{{{{ s.market }}}}</span><span style="display:inline-flex;align-items:center;gap:4px">{icon("calendar", 12)}Event {{{{ s.event }}}}</span><span>{{{{ s.sources }}}}</span>{EVS}</span>
<span style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12.5px;color:$t3;width:100%">{icon("target", 12)}<span style="flex:1;min-width:0">{{{{ s.reason }}}}</span>
<sc-if value="{{{{ s.hasTriage }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="font-size:12px;color:$t1;background:$ntb;padding:1px 6px;border-radius:4px;white-space:nowrap">{{{{ s.triage }}}}</span></sc-if></span>
</button></sc-for>'''

chip = 'display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border:1px solid $border;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;background:$surface;cursor:pointer;white-space:nowrap'
filters = f'''<div role="toolbar" aria-label="Filters" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 24px;border-bottom:1px solid $border">
<div role="group" aria-label="Triage state" style="display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas">
<button type="button" onClick="{{{{ showUntriaged }}}}" aria-pressed="{{{{ untriagedOn }}}}" style="{{{{ segU }}}}">Untriaged · {{{{ untriagedCount }}}}</button>
<button type="button" onClick="{{{{ showAllFn }}}}" aria-pressed="{{{{ showAll }}}}" style="{{{{ segA }}}}">All · 6</button></div>
<button type="button" class="bs" style="{chip}"><b style="font-weight:500;color:$t1">Competitor</b> Apex Diagnostics{icon("chevd", 13)}</button>
<button type="button" class="bs" style="{chip}">Event type: All{icon("chevd", 13)}</button>
<button type="button" class="bs" style="{chip}"><b style="font-weight:500;color:$t1">Market</b> Germany, DACH{icon("chevd", 13)}</button>
<button type="button" class="bs" style="{chip}">Verification: Any{icon("chevd", 13)}</button>
<button type="button" class="bs" style="{chip}">Priority: Any{icon("chevd", 13)}</button>
<button type="button" class="bs" style="{chip}">{icon("calendar", 13)}<b style="font-weight:500;color:$t1">Event date</b> last 14 days{icon("chevd", 13)}</button>
<span style="margin-left:auto;font-size:12.5px;color:$t3">Sorted by Event date, newest first</span></div>'''

footer = f'''<div style="position:sticky;bottom:0;background:$surface;border-top:1px solid $border;padding:12px 24px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
<button type="button" class="bp" onClick="{{{{ openCreate }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:6px;border:1px solid $acc;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer">{icon("plus", 15)}Create response case <span style="opacity:.75;font-family:$mono;font-size:11px;border:1px solid rgba(255,255,255,.5);border-radius:3px;padding:0 4px">C</span></button>
<button type="button" class="bs" onClick="{{{{ linkCase }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:6px;border:1px solid $bstrong;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;color:$t1">{icon("link", 15)}Link existing case {kbd("L")}</button>
<button type="button" class="bs" onClick="{{{{ monitor }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:6px;border:1px solid $bstrong;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;color:$t1">{icon("eye", 15)}Monitor {kbd("M")}</button>
<button type="button" class="bg" onClick="{{{{ openDismiss }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border-radius:6px;border:1px solid transparent;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;color:$t2">{icon("archive", 15)}Dismiss {kbd("D")}</button>
<span role="status" aria-live="polite" style="margin-left:auto;font-size:12.5px;color:$t2">{{{{ toast }}}}</span></div>'''

overlay = "position:fixed;inset:0;background:rgba(15,16,18,.4);display:flex;align-items:flex-start;justify-content:center;padding:72px 16px 16px;z-index:50;overflow:auto"
dlg = "width:100%;max-width:560px;background:$surface;border-radius:8px;border:1px solid $border;box-shadow:0 8px 24px rgba(15,16,18,.12)"
inp = "width:100%;box-sizing:border-box;height:36px;padding:0 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13.5px;color:$t1;background:$surface"


def steps(n):
    a = []
    for i, t in enumerate(["Scope and owner", "Confirm"], 1):
        on = i <= n
        a.append(f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:{"$t1" if on else "$t3"};font-weight:{"500" if i == n else "400"}"><span style="width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;{"background:$t1;color:#fff" if on else "border:1px solid $bstrong"}">{i}</span>{t}</span>')
    return '<div style="display:flex;gap:16px;align-items:center">' + '<span style="width:24px;height:1px;background:$bstrong"></span>'.join(a) + "</div>"


modal_create = f'''<sc-if value="{{{{ m1 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="{overlay}"><div role="dialog" aria-modal="true" aria-labelledby="cc-t" style="{dlg}">
<div style="padding:16px 20px;border-bottom:1px solid $border;display:flex;align-items:center;gap:12px"><h2 id="cc-t" style="margin:0;font-size:16px;font-weight:600">Create response case</h2><span style="margin-left:auto">{steps(1)}</span>
<button type="button" class="bg" aria-label="Close" onClick="{{{{ closeModal }}}}" style="width:30px;height:30px;border:0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:$t2;cursor:pointer">{icon("x", 16)}</button></div>
<div style="padding:16px 20px;display:flex;flex-direction:column;gap:14px">
<p style="margin:0;font-size:13px;color:$t2">Fields carry over from {mono("{{ selId }}")}. Edit anything before you confirm.</p>
<div><label for="cc-title" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Case title</label><input id="cc-title" type="text" value="{{{{ title }}}}" onChange="{{{{ setTitle }}}}" style="{inp}"></div>
<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
<div><label for="cc-market" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Market</label><input id="cc-market" type="text" value="{{{{ market }}}}" onChange="{{{{ setMarket }}}}" style="{inp}"></div>
<div><label for="cc-bu" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Business unit</label><input id="cc-bu" type="text" value="{{{{ bu }}}}" onChange="{{{{ setBu }}}}" style="{inp}"></div>
<div><label for="cc-prod" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Our products in scope</label><input id="cc-prod" type="text" value="{{{{ products }}}}" onChange="{{{{ setProducts }}}}" style="{inp}"></div>
<div><label for="cc-owner" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Case owner</label><select id="cc-owner" value="{{{{ owner }}}}" onChange="{{{{ setOwner }}}}" style="{inp}"><option value="Maya Patel">Maya Patel (you)</option><option value="Jonas Weber">Jonas Weber</option><option value="Sofia Klein">Sofia Klein</option></select></div></div>
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px;color:$t2;padding:10px 12px;background:$canvas;border-radius:6px;border:1px solid $border"><span style="display:inline-flex;gap:6px;align-items:center">Priority {prio("High")} <span style="color:$t3">carried over</span></span><span style="display:inline-flex;gap:6px;align-items:center">Evidence {{{{ selEvidence }}}} <span style="color:$t3">· regulatory status stays Unverified</span></span></div>
</div>
<div style="padding:12px 20px;border-top:1px solid $border;display:flex;justify-content:flex-end;gap:8px">{btn("Cancel", "g", handler="closeModal")}{btn("Continue", "p", handler="toConfirm", ic="arrowr")}</div>
</div></div></sc-if>
<sc-if value="{{{{ m2 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="{overlay}"><div role="dialog" aria-modal="true" aria-labelledby="cc-t2" style="{dlg}">
<div style="padding:16px 20px;border-bottom:1px solid $border;display:flex;align-items:center;gap:12px"><h2 id="cc-t2" style="margin:0;font-size:16px;font-weight:600">Create response case</h2><span style="margin-left:auto">{steps(2)}</span></div>
<dl style="margin:0;padding:16px 20px;display:grid;grid-template-columns:140px 1fr;gap:10px 16px;font-size:13.5px">
<dt style="color:$t3">Title</dt><dd style="margin:0;font-weight:500">{{{{ title }}}}</dd>
<dt style="color:$t3">Competitor</dt><dd style="margin:0">Apex Diagnostics · AX-Scan</dd>
<dt style="color:$t3">Scope</dt><dd style="margin:0">{{{{ bu }}}} · {{{{ market }}}} · {{{{ products }}}}</dd>
<dt style="color:$t3">Owner</dt><dd style="margin:0">{{{{ owner }}}}</dd>
<dt style="color:$t3">Linked signals</dt><dd style="margin:0">{mono("{{ selId }}")} plus its source cluster</dd>
<dt style="color:$t3">Starts as</dt><dd style="margin:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap">{life("Draft")}<span style="font-size:12.5px;color:$t2">Analysis starts after creation: checking sources, then preparing the impact assessment.</span></dd></dl>
<div style="padding:12px 20px;border-top:1px solid $border;display:flex;justify-content:flex-end;gap:8px">{btn("Back", "g", handler="toStep1", ic="chevl")}{btn("Create case", "p", handler="confirmCreate", ic="check")}</div>
</div></div></sc-if>
<sc-if value="{{{{ m3 }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="{overlay}"><div role="dialog" aria-modal="true" aria-labelledby="cc-t3" style="{dlg}">
<div style="padding:24px 20px;display:flex;gap:14px;align-items:flex-start"><span style="color:$okf">{icon("checkcircle", 22)}</span><div style="flex:1"><h2 id="cc-t3" style="margin:0;font-size:16px;font-weight:600">CR-1042 created</h2>
<p style="margin:6px 0 0;font-size:13.5px;color:$t2;line-height:20px">{{{{ title }}}} · owner {{{{ owner }}}}. Checking sources has started. You can keep triaging.</p>
<div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">{btn("Open case", "p", href="CaseSummary.dc.html", ic="arrowr")}{btn("Back to inbox", "s", handler="closeModal")}</div></div></div>
</div></div></sc-if>'''

reasons_btn = f'''<sc-for list="{{{{ reasons }}}}" as="r" hint-placeholder-count="5"><button type="button" onClick="{{{{ r.pick }}}}" aria-pressed="{{{{ r.on }}}}" style="{{{{ r.style }}}}">{{{{ r.label }}}}</button></sc-for>'''
modal_dismiss = f'''<sc-if value="{{{{ md }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="{overlay}"><div role="dialog" aria-modal="true" aria-labelledby="dm-t" style="{dlg}">
<div style="padding:16px 20px;border-bottom:1px solid $border"><h2 id="dm-t" style="margin:0;font-size:16px;font-weight:600">Dismiss {mono("{{ selId }}")}</h2><p style="margin:4px 0 0;font-size:13px;color:$t2">A reason is required. Dismissed signals stay in history and can be restored.</p></div>
<div style="padding:16px 20px"><div role="group" aria-label="Reason" style="display:flex;flex-wrap:wrap;gap:8px">{reasons_btn}</div>
<label for="dm-note" style="display:block;font-size:12.5px;font-weight:500;margin:14px 0 6px">Note (optional)</label><textarea id="dm-note" rows="2" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13.5px;resize:vertical"></textarea></div>
<div style="padding:12px 20px;border-top:1px solid $border;display:flex;justify-content:flex-end;gap:8px;align-items:center"><span style="font-size:12.5px;color:$t3;margin-right:auto">{{{{ dismissHint }}}}</span>{btn("Cancel", "g", handler="closeModal")}
<button type="button" onClick="{{{{ confirmDismiss }}}}" disabled="{{{{ dismissDisabled }}}}" style="{{{{ dismissStyle }}}}">Dismiss signal</button></div>
</div></div></sc-if>'''

content = f'''<div style="padding:20px 24px 12px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end;border-bottom:1px solid $border">
<div style="flex:1 1 360px;min-width:0"><h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">Signal Inbox</h1>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Candidate signals from your watchlists. Triage each one: create a case, link it, monitor it, or dismiss it with a reason.</p></div>
<div style="display:flex;gap:10px;align-items:center;font-size:12px;color:$t3;flex-wrap:wrap">{icon("keyboard", 14)}<span style="display:inline-flex;gap:4px;align-items:center">{kbd("J")}{kbd("K")} move</span><span style="display:inline-flex;gap:4px;align-items:center">{kbd("C")} create</span><span style="display:inline-flex;gap:4px;align-items:center">{kbd("X")} select</span><span style="display:inline-flex;gap:4px;align-items:center">{kbd("P")} priority</span><span style="display:inline-flex;gap:4px;align-items:center">{kbd("?")} all shortcuts</span></div></div>
{filters}
<div style="display:flex;flex-wrap:wrap;align-items:stretch">
<div role="list" aria-label="Signals" style="flex:1 1 400px;max-width:100%;border-right:1px solid $border;min-width:0;display:flex;flex-direction:column">
{row}
<div style="padding:14px 16px;font-size:12.5px;color:$t3">{{{{ listFoot }}}}</div></div>
<div aria-label="Signal detail" style="flex:999 1 520px;min-width:0;display:flex;flex-direction:column">
<div style="padding:20px 24px 8px;flex:1">{details}</div>
{footer}
</div></div>
{modal_create}{modal_dismiss}'''

logic = r'''class Component extends DCLogic {
  state = { sel: '881', triage: {}, touched: {}, modal: null, owner: 'Maya Patel', title: 'Apex AX-Scan Germany launch response', market: 'Germany', bu: 'Diagnostics BU', products: 'ND-200', reason: null, showAll: false, dup: false, notDup: false, caseMade: false, toast: '' };
  renderVals() {
    const s = this.state;
    const base = [
      { id: '881', title: 'Apex Diagnostics announces AX-Scan launch in Germany', market: 'Germany', event: '7 Oct 2026', sources: s.dup ? '1 independent · 5 syndicated' : '1 independent · 4 syndicated', p: 'High', e: 'Partial', reason: 'Overlaps ND-200 in Germany · Diagnostics BU' },
      { id: '884', title: 'Trade report says AX-Scan is cleared for sale in Germany', market: 'Germany', event: 'not stated', sources: '1 source · no corroboration', p: 'High', e: 'Unverified', reason: 'Regulatory-status claim for a matched product' },
      { id: '870', title: 'Apex AX-Scan launch notice — German-language reprint', market: 'Germany', event: '7 Oct 2026', sources: 'Likely duplicate of SIG-881', p: 'Medium', e: 'Partial', reason: 'Same text as SIG-881' },
      { id: '859', title: 'AX-Scan product page: specifications section changed', market: 'All markets', event: '5 Oct 2026', sources: '1 independent', p: 'Medium', e: 'Verified', reason: 'Attribute change on a product matched to ND-200' },
      { id: '866', title: 'Apex Diagnostics advertises key account manager roles in Germany', market: 'Germany', event: '18 Sep 2026', sources: '1 independent', p: 'Low', e: 'Unverified', reason: 'Hiring signal in a monitored market' },
      { id: '851', title: 'Apex Diagnostics half-year update mentions European expansion', market: 'Europe', event: '30 Sep 2026', sources: '1 independent', p: 'Low', e: 'Verified', reason: 'General statement, no product named', t0: 'Monitoring' }
    ];
    const tri = (x) => s.triage[x.id] || x.t0 || '';
    const vis = base.filter(x => s.showAll || !tri(x) || s.touched[x.id]);
    const rowBase = 'display:flex;flex-direction:column;align-items:flex-start;text-align:left;width:100%;padding:12px 16px;border:0;border-bottom:1px solid $border;font:inherit;cursor:pointer;transition:background 140ms;';
    const list = vis.map(x => ({ ...x, pH: x.p === 'High', pM: x.p === 'Medium', pL: x.p === 'Low', eV: x.e === 'Verified', eP: x.e === 'Partial', eC: x.e === 'Conflicting', eU: x.e === 'Unverified',
      triage: tri(x), hasTriage: !!tri(x), pressed: s.sel === x.id ? 'true' : 'false',
      rowStyle: rowBase + (s.sel === x.id ? 'background:$accbg;' : 'background:transparent;') + (tri(x) && !s.touched[x.id] ? 'opacity:.7;' : ''),
      pick: () => this.setState({ sel: x.id, toast: '' }) }));
    const cur = base.find(x => x.id === s.sel);
    const setT = (label, toast) => this.setState({ triage: { ...s.triage, [s.sel]: label }, touched: { ...s.touched, [s.sel]: true }, toast, modal: null, reason: null });
    const reasons = ['Not relevant to monitored scope', 'Duplicate of another signal', 'Insufficient evidence', 'Already covered by a case', 'Other'].map(r => ({ label: r, on: s.reason === r ? 'true' : 'false',
      style: 'height:32px;padding:0 12px;border-radius:999px;font:inherit;font-size:13px;cursor:pointer;transition:background 140ms,border-color 140ms;' + (s.reason === r ? 'background:$t1;color:#fff;border:1px solid $t1;' : 'background:$surface;color:$t1;border:1px solid $bstrong;'),
      pick: () => this.setState({ reason: r }) }));
    const seg = (on) => 'height:26px;padding:0 10px;border-radius:4px;border:0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms;' + (on ? 'background:$surface;color:$t1;font-weight:500;box-shadow:0 0 0 1px $border;' : 'background:transparent;color:$t2;');
    const untriagedCount = base.filter(x => !tri(x)).length;
    return {
      list, listFoot: s.showAll ? 'Showing all 6 signals' : 'Triaged signals move out of this view. Switch to All to see them.',
      sel881: s.sel === '881', sel884: s.sel === '884', sel870: s.sel === '870', sel866: s.sel === '866', sel859: s.sel === '859', sel851: s.sel === '851',
      selId: 'SIG-' + s.sel, selTriage: tri(cur), selHasTriage: !!tri(cur), selEvidence: cur.e,
      dup: s.dup, notDup: !s.dup && !s.notDup, copyCount: s.dup ? '5' : '4',
      linkDup: () => this.setState({ dup: true, triage: { ...s.triage, '870': 'Linked as duplicate of SIG-881' }, touched: { ...s.touched, '870': true }, toast: 'SIG-870 linked to SIG-881 as a syndicated copy. Independent source count unchanged.' }),
      notDupFn: () => this.setState({ notDup: true, toast: 'Marked as not a duplicate.' }),
      untriagedCount, showAll: s.showAll ? 'true' : 'false', untriagedOn: s.showAll ? 'false' : 'true', segU: seg(!s.showAll), segA: seg(s.showAll),
      showUntriaged: () => this.setState({ showAll: false }), showAllFn: () => this.setState({ showAll: true }),
      toast: s.toast,
      openCreate: () => this.setState({ modal: 'c1' }), toConfirm: () => this.setState({ modal: 'c2' }), toStep1: () => this.setState({ modal: 'c1' }),
      confirmCreate: () => this.setState({ modal: 'c3', caseMade: true, triage: { ...s.triage, [s.sel]: 'Converted to CR-1042' }, touched: { ...s.touched, [s.sel]: true }, toast: 'CR-1042 created from SIG-' + s.sel + '.' }),
      closeModal: () => this.setState({ modal: null, reason: null }),
      m1: s.modal === 'c1', m2: s.modal === 'c2', m3: s.modal === 'c3', md: s.modal === 'dismiss',
      title: s.title, market: s.market, bu: s.bu, products: s.products, owner: s.owner,
      setTitle: (e) => this.setState({ title: e.target.value }), setMarket: (e) => this.setState({ market: e.target.value }),
      setBu: (e) => this.setState({ bu: e.target.value }), setProducts: (e) => this.setState({ products: e.target.value }), setOwner: (e) => this.setState({ owner: e.target.value }),
      monitor: () => setT('Monitoring · review 15 Oct', 'SIG-' + s.sel + ' moved to Monitoring. Review on 15 Oct.'),
      linkCase: () => s.caseMade ? setT('Linked to CR-1042', 'SIG-' + s.sel + ' linked to CR-1042.') : this.setState({ toast: 'No open case covers this event yet. Create one first.' }),
      openDismiss: () => this.setState({ modal: 'dismiss', reason: null }),
      reasons, dismissDisabled: !s.reason, dismissHint: s.reason ? '' : 'Choose a reason to continue',
      dismissStyle: 'display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (s.reason ? 'background:$t1;color:#fff;border:1px solid $t1;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      confirmDismiss: () => s.reason && setT('Dismissed · ' + s.reason, 'SIG-' + s.sel + ' dismissed. It stays in history.')
    };
  }
}'''

page("SignalInbox.dc.html", "Signal Inbox", shell("Signal Inbox", "Thu 8 Oct 2026, 10:05", content, counts={"Signal Inbox": "5"}), logic, height=1180)
