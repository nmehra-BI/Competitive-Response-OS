from common import *

nxt = f'''<div style="font-size:13.5px;font-weight:500">Review 3 claims, then confirm overlap</div>
<div style="font-size:12.5px;color:$t2;margin-top:2px">Conflicting and unverified claims stay disclosed in the package.</div>
<div style="display:flex;gap:8px;margin-top:10px">{btn("Continue to Impact", "p", href="Impact.dc.html", ic="arrowr")}</div>'''
header = case_header("Evidence", "Assessing", "Assess", "Partial", "9 Oct, 10:28", nxt, {"Evidence": "3 to review"})

strip = f'''<div role="status" style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 24px;background:$inb;border-bottom:1px solid $border;font-size:13px">
<span style="color:$wnf;display:inline-flex;align-items:center;gap:6px;font-weight:500">{icon("halfcircle", 14)}Partial results</span>
<span style="color:$t1">Sources checked 8 Oct, 14:31. One licensed report could not be excerpted. Your reviews are saved.</span>
<span style="margin-left:auto;color:$t2;display:inline-flex;gap:6px;align-items:center">{icon("clock", 13)}Updated 8 Oct, 14:31</span></div>'''

P_ = "margin:0;font-family:$serif;font-size:17px;line-height:28px;color:$t1"
MARK = "background:#FFF1B8;color:inherit;padding:1px 2px;border-radius:2px"


def dates3(event, pub, added, retrieved):
    it = lambda ic, l, v: f'<div style="display:flex;gap:6px;align-items:center"><dt style="display:flex;gap:5px;align-items:center;color:$t3">{icon(ic, 13)}{l}</dt><dd style="margin:0;color:$t1">{v}</dd></div>'
    return f'<dl style="display:flex;flex-wrap:wrap;gap:4px 16px;margin:8px 0 0;font-size:12.5px">{it("calendar", "Event date", event)}{it("file", "Published", pub)}{it("arrowin", "Added", added)}{it("refresh", "Retrieved", retrieved)}</dl>'


def source(publisher, kind, d, pre, mark, post, n, lims, entity=""):
    lim = "".join(f"<li>{l}</li>" for l in lims)
    ent = f'<div style="margin-top:14px;padding:10px 12px;border:1px solid $border;border-radius:6px;font-size:13px;display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center">{entity}</div>' if entity else ""
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:16px 18px;margin-top:14px">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center"><span style="font-size:14px;font-weight:600">{publisher}</span><span style="font-size:12px;color:$t2;border:1px solid $bstrong;border-radius:4px;padding:0 6px;height:20px;display:inline-flex;align-items:center">{kind}</span>
<button type="button" class="bg" style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;height:30px;padding:0 8px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$acc;cursor:pointer">{icon("ext", 13)}Open original</button></div>
{d}
<div style="display:flex;align-items:center;gap:8px;margin-top:14px;font-size:12px;color:$t3"><span>Passage {n}</span><span style="margin-left:auto;display:inline-flex;gap:2px"><button type="button" class="bg" aria-label="Previous passage" style="width:26px;height:26px;border:0;border-radius:4px;display:flex;align-items:center;justify-content:center;color:$t2;cursor:pointer">{icon("chevl", 14)}</button><button type="button" class="bg" aria-label="Next passage" style="width:26px;height:26px;border:0;border-radius:4px;display:flex;align-items:center;justify-content:center;color:$t2;cursor:pointer">{icon("chevr", 14)}</button></span></div>
<blockquote style="margin:6px 0 0;padding:14px 16px;background:$canvas;border-radius:6px;max-width:68ch"><p style="{P_}">{pre}<mark style="{MARK}">{mark}</mark>{post}</p></blockquote>
<div style="margin-top:14px"><div style="font-size:12px;color:$t3;font-weight:500">Limitations</div><ul style="margin:4px 0 0;padding-left:18px;font-size:13px;line-height:20px;color:$t1">{lim}</ul></div>{ent}</div>'''


def chead(cid, ctype, evhtml, text, extra=""):
    return f'''<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">{mono(cid)}{ct(ctype)}{evhtml}{extra}</div>
<p style="margin:10px 0 0;font-family:$serif;font-size:20px;line-height:30px;font-weight:600;max-width:60ch">{text}</p>'''


PR = ("Apex Diagnostics · press release", "Primary · manufacturer", dates3("7 Oct 2026", "8 Oct 2026, 09:15", "8 Oct 2026, 09:40", "8 Oct 2026, 09:40"))
MATCH_OK = f'<span style="color:$t3">Entity match</span><span>“AX-Scan” → AX-Scan · Apex Diagnostics</span><span style="color:$okf;display:inline-flex;gap:4px;align-items:center">{icon("checkcircle", 13)}Certain</span>'

D = {}
D["C01"] = chead("C-01", "Fact", ev("Verified"), "Apex Diagnostics announced the launch of AX-Scan in Germany.") + source(
    *PR, "Dated 7 October 2026. Apex Diagnostics today announced ", "the launch of AX-Scan in Germany", ", making the platform available to hospital laboratories across the country. The company said further markets in the region would follow.", "1 of 2",
    ["Manufacturer source: confirms the announcement, not market availability or regulatory status.", "Syndicated copies (5) repeat this text and are not counted as corroboration."], MATCH_OK)
D["C02"] = chead("C-02", "Fact", ev("Verified"), "The launch announcement is dated 7 Oct 2026.") + source(
    *PR, "", "Dated 7 October 2026.", " Apex Diagnostics today announced the launch of AX-Scan in Germany…", "2 of 2", ["Publication followed on 8 Oct, 09:15 CET. Event date and publish date are kept separate."])
D["C03"] = chead("C-03", "Fact", ev("Verified"), "The launch notice targets hospital laboratories in Germany.") + source(
    *PR, "…the launch of AX-Scan in Germany, making the platform ", "available to hospital laboratories across the country", ".", "1 of 2", ["States intended customers; it does not prove units are shipping."])
D["C04"] = chead("C-04", "Inference · AI", ev("Partial"), "AX-Scan addresses the same laboratory use case as ND-200.", ai()) + \
    f'<p style="margin:8px 0 0;font-size:13px;color:$t2">Draft based on 2 sources. Analyst confirmation is required on Impact before exposure is calculated.</p>' + source(
    *PR, "AX-Scan is designed for ", "routine diagnostic testing in hospital laboratories", ", with a workflow the company describes as suited to high-volume sites.", "1 of 2",
    ["Compares stated intended use only. Clinical performance is not assessed.", "ND-200 intended use taken from the Northstar product catalog (internal)."],
    f'<span style="color:$t3">Entity match</span><span>“the platform” → AX-Scan · Apex Diagnostics</span><span style="color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("halfcircle", 13)}Uncertain</span><span style="margin-left:auto;display:flex;gap:6px">{btn("Confirm", "s", extra="height:30px;font-size:12.5px")}{btn("Change", "g", extra="height:30px;font-size:12.5px")}</span>')
D["C05"] = chead("C-05", "Inference · AI", ev("Conflicting"), "AX-Scan’s clinical performance is equivalent to ND-200.", ai()) + \
    f'<div style="margin-top:14px">{banner("danger", "Sources disagree. Equivalence is not established.", "The manufacturer claims comparable performance; an independent abstract reports no comparative data. This claim cannot appear as a fact or in positioning.")}</div>' + \
    f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-top:14px">
<div style="border:1px solid $border;border-radius:8px;padding:14px 16px"><div style="display:flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;color:$t1">Supports · Apex press release</div><div style="font-size:12px;color:$t3;margin-top:2px">Published 8 Oct 2026 · Primary · manufacturer</div>
<blockquote style="margin:10px 0 0;padding:12px 14px;background:$canvas;border-radius:6px"><p style="{P_};font-size:16px;line-height:26px">AX-Scan <mark style="{MARK}">delivers performance comparable to leading laboratory systems</mark>.</p></blockquote></div>
<div style="border:1px solid $border;border-radius:8px;padding:14px 16px"><div style="display:flex;gap:6px;align-items:center;font-size:12.5px;font-weight:600;color:$dgf">{icon("shieldalert", 13)}Contradicts · Congress abstract</div><div style="font-size:12px;color:$t3;margin-top:2px">Published 22 Sep 2026 · Independent · secondary</div>
<blockquote style="margin:10px 0 0;padding:12px 14px;background:$canvas;border-radius:6px"><p style="{P_};font-size:16px;line-height:26px"><mark style="{MARK}">Comparative performance data for AX-Scan were not available</mark> at the time of submission.</p></blockquote></div></div>'''
D["C06"] = chead("C-06", "Fact", ev("Partial", "stale"), "The AX-Scan specification sheet lists its supported sample types.") + \
    f'<div style="margin-top:14px">{banner("warn", "Retrieved 94 days ago", "The product page changed on 5 Oct (SIG-859). Recheck before using this claim.", btn("Recheck source", "s", ic="refresh"))}</div>' + source(
    "Apex Diagnostics · AX-Scan specification sheet", "Primary · manufacturer", dates3("Not stated", "Not stated", "7 Jul 2026, 11:02", "7 Jul 2026, 11:02"),
    "The specification sheet ", "lists the sample types supported by AX-Scan", " and the reagents required for each.", "1 of 1", ["Retrieved before the 5 Oct page change.", "Specification statements are not performance evidence."])
D["C07"] = chead("C-07", "Assumption", '<span style="font-size:12.5px;color:$t2">Assumption · not evidence</span>', "Relevant annual revenue may erode by 5–15% over the next 12 months.", ai()) + \
    f'''<div style="margin-top:14px;border:1.5px dashed $ctrl;border-radius:8px;padding:14px 16px;background:$canvas;font-size:13.5px;line-height:21px">
<div>Proposed 8 Oct, 14:31 as a draft scenario range. It is an input you choose, not a prediction.</div>
<div style="margin-top:8px;font-family:$mono;font-size:13px">€24.0M × 5–15% = €1.2–3.6M</div>
<a href="Impact.dc.html" style="display:inline-flex;gap:4px;align-items:center;margin-top:10px;font-weight:500;text-decoration:none;font-size:13px">Edit on Impact{icon("chevr", 13)}</a></div>'''
D["C08"] = chead("C-08", "Unknown", ev("Unverified", "single source"), "AX-Scan holds the regulatory status required for sale in Germany.") + \
    f'<div style="margin-top:14px">{banner("warn", "Unverified — can’t be presented as a confirmed event", "One trade source citing unnamed people. No registry or authority record checked. A launch notice is not evidence of regulatory status.", btn("Request review", "s", handler="reqReview", ic="users"))}</div>' + source(
    "Trade publication", "Secondary · unnamed sources", dates3("Not stated", "8 Oct 2026, 08:20", "8 Oct 2026, 09:02", "8 Oct 2026, 09:02"),
    "According to people familiar with the matter, ", "AX-Scan has received clearance for the German market", ". Apex Diagnostics did not respond to a request for comment.", "1 of 1",
    ["No corroboration: single source.", "Regulatory status ≠ market availability ≠ reimbursement."])
D["C09"] = chead("C-09", "Unknown", f'<span style="display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:$t2">{icon("dashcircle", 13)}No evidence</span>', "Reimbursement status of AX-Scan in Germany.") + \
    f'''<div style="margin-top:14px;border:1px dashed $bstrong;border-radius:8px;padding:24px;text-align:left">
<div style="display:flex;gap:10px;align-items:flex-start"><span style="color:$t3">{icon("dashcircle", 20)}</span><div><div style="font-weight:600;font-size:14px">Missing evidence</div>
<p style="margin:4px 0 0;font-size:13px;color:$t2;line-height:20px;max-width:56ch">No valid source is attached. This claim stays Unknown and is listed under open questions in the decision package.</p>
<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">{btn("Attach source", "s", ic="clip")}{btn("Request review", "g", handler="reqReview", ic="users")}</div></div></div></div>'''
D["C10"] = chead("C-10", "Fact", f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$ntb;color:$t2;font-size:12.5px">{icon("archive", 13)}Excluded</span>', '<s style="text-decoration-thickness:1.5px">Apex named a German distribution partner for AX-Scan.</s>') + \
    f'<div style="margin-top:14px">{banner("neutral", "Withdrawn 9 Oct, 08:50 by publisher", "The syndicated copy that named a partner was corrected. Excluded — not used in current conclusion. Kept in history.")}</div>'
D["C11"] = chead("C-11", "Fact", restr("Unavailable"), "German laboratory diagnostics segment context.") + \
    f'''<div style="margin-top:14px;border:1px solid $border;border-radius:8px;padding:16px 18px">
<div style="display:flex;gap:8px;align-items:center"><span style="font-size:14px;font-weight:600">Licensed market report</span><span style="font-size:12px;color:$t2;border:1px solid $bstrong;border-radius:4px;padding:0 6px">Licensed</span></div>
{dates3("Not stated", "Jun 2026", "8 Oct 2026, 14:20", "8 Oct 2026, 14:20")}
<div style="margin-top:14px;display:flex;gap:10px;align-items:flex-start;padding:14px;background:$rsb;border-radius:6px;color:$rsf">{icon("cloudoff", 18)}<div style="font-size:13.5px;line-height:20px;color:$t1"><b style="font-weight:600">Licensed content — excerpt not permitted.</b><br>This workspace’s entitlement allows citation by title only. Open it in the licensed tool to read the passage.</div></div>
<div style="margin-top:12px">{btn("Open in licensed tool", "s", ic="ext")}</div></div>'''

details = "".join(f'<sc-if value="{{{{ d{k} }}}}" hint-placeholder-val="{{{{ {"true" if k == "C01" else "false"} }}}}"><div>{v}</div></sc-if>' for k, v in D.items())

actions = f'''<div style="margin-top:16px;padding-top:14px;border-top:1px solid $border">
<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:$t2;margin-bottom:10px">{icon("history", 13)}<span>{{{{ selReview }}}}</span></div>
<div style="display:flex;flex-wrap:wrap;gap:8px">
<button type="button" class="bs" onClick="{{{{ accept }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;color:$t1;cursor:pointer">{icon("check", 15)}Accept {kbd("A")}</button>
<button type="button" class="bs" onClick="{{{{ correct }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;color:$t1;cursor:pointer">{icon("pencil", 15)}Correct {kbd("E")}</button>
<button type="button" class="bs" onClick="{{{{ exclude }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;color:$t1;cursor:pointer">{icon("archive", 15)}Exclude {kbd("X")}</button>
<button type="button" class="bg" onClick="{{{{ reqReview }}}}" style="display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 12px;border:1px solid transparent;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;color:$t2;cursor:pointer">{icon("users", 15)}Request review {kbd("R")}</button></div>
<sc-if value="{{{{ correcting }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-top:12px"><label for="ev-corr" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Corrected statement</label>
<textarea id="ev-corr" rows="2" value="{{{{ corrText }}}}" onChange="{{{{ setCorr }}}}" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:4px;font:inherit;font-size:13.5px"></textarea>
<div style="display:flex;gap:8px;margin-top:8px">{btn("Save correction", "p", handler="saveCorr")}{btn("Cancel", "g", handler="cancel")}</div></div></sc-if>
<sc-if value="{{{{ excluding }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="margin-top:12px"><div style="font-size:12.5px;font-weight:500;margin-bottom:8px">Reason for exclusion (required)</div>
<div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{{{ exReasons }}}}" as="r" hint-placeholder-count="4"><button type="button" onClick="{{{{ r.pick }}}}" style="height:32px;padding:0 12px;border-radius:999px;border:1px solid $bstrong;background:$surface;font:inherit;font-size:13px;color:$t1;cursor:pointer">{{{{ r.label }}}}</button></sc-for>
{btn("Cancel", "g", handler="cancel")}</div></div></sc-if>
</div>'''

EV_IF = "".join(f'<sc-if value="{{{{ c.e{k} }}}}" hint-placeholder-val="{{{{ false }}}}">{h}</sc-if>' for k, h in [
    ("V", ev("Verified")), ("P", ev("Partial")), ("C", ev("Conflicting")), ("U", ev("Unverified")),
    ("A", '<span style="font-size:12px;color:$t2;display:inline-flex;gap:4px;align-items:center">' + icon("ruler", 12) + 'Assumption</span>'),
    ("M", '<span style="font-size:12px;color:$t2;display:inline-flex;gap:4px;align-items:center">' + icon("dashcircle", 12) + 'No evidence</span>'),
    ("X", '<span style="font-size:12px;color:$t2;display:inline-flex;gap:4px;align-items:center">' + icon("archive", 12) + 'Excluded</span>'),
    ("L", restr("Unavailable"))])
CT_IF = "".join(f'<sc-if value="{{{{ c.g{k} }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="display:flex;align-items:center;gap:8px;padding:14px 16px 6px;font-size:12px;font-weight:600;color:$t2">{ct(n)}<span style="font-weight:400;color:$t3">{{{{ c.groupCount }}}}</span></div></sc-if>' for k, n in [
    ("F", "Fact"), ("I", "Inference · AI"), ("A", "Assumption"), ("U", "Unknown")])

rows = f'''<sc-for list="{{{{ claims }}}}" as="c" hint-placeholder-count="6">{CT_IF}
<button type="button" class="hr" onClick="{{{{ c.pick }}}}" aria-pressed="{{{{ c.pressed }}}}" style="{{{{ c.rowStyle }}}}">
<span style="display:flex;gap:8px;align-items:flex-start;width:100%"><span style="font-family:$mono;font-size:12px;color:$t3;padding-top:1px;flex:none">{{{{ c.id }}}}</span><span style="{{{{ c.textStyle }}}}">{{{{ c.text }}}}</span></span>
<span style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;margin:6px 0 0 44px;font-size:12px;color:$t2">{EV_IF}<span>{{{{ c.counts }}}}</span><span style="color:$t3">{{{{ c.date }}}}</span></span>
<span style="display:flex;gap:10px;align-items:center;margin:4px 0 0 44px;font-size:12px;color:$t3"><span>{{{{ c.review }}}}</span><sc-if value="{{{{ c.hasNotes }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display:inline-flex;gap:3px;align-items:center">{icon("message", 12)}{{{{ c.notes }}}}</span></sc-if></span>
</button></sc-for>'''

content = header + strip + f'''<div style="display:flex;flex-wrap:wrap;align-items:stretch">
<div aria-label="Claims" style="flex:1 1 400px;max-width:100%;min-width:0;border-right:1px solid $border">
<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid $border;font-size:12.5px;color:$t2"><span style="font-weight:500;color:$t1">11 claims</span><span>· grouped by claim type</span><span style="margin-left:auto;display:inline-flex;gap:4px;align-items:center">{kbd("J")}{kbd("K")}</span></div>
{rows}</div>
<div aria-label="Source" style="flex:999 1 520px;min-width:0;padding:20px 24px 28px">
<div role="status" aria-live="polite">{details}</div>
{actions}
</div></div>'''

logic = r'''class Component extends DCLogic {
  state = { sel: 'C01', review: {}, mode: null, corr: '' };
  renderVals() {
    const s = this.state;
    const C = [
      { id: 'C01', g: 'F', text: 'Apex Diagnostics announced the launch of AX-Scan in Germany.', e: 'V', counts: '1 supporting · 0 contradicting', date: 'Source 8 Oct', review: 'Accepted by Maya Patel · 9 Oct 09:58', notes: 0 },
      { id: 'C02', g: 'F', text: 'The launch announcement is dated 7 Oct 2026.', e: 'V', counts: '1 supporting', date: 'Source 8 Oct', review: 'Accepted by Maya Patel · 9 Oct 10:01', notes: 0 },
      { id: 'C03', g: 'F', text: 'The launch notice targets hospital laboratories in Germany.', e: 'V', counts: '1 supporting', date: 'Source 8 Oct', review: 'Accepted by Maya Patel · 9 Oct 10:03', notes: 1 },
      { id: 'C06', g: 'F', text: 'The AX-Scan specification sheet lists its supported sample types.', e: 'P', counts: '1 supporting · stale', date: 'Retrieved 7 Jul', review: 'Needs review', notes: 0 },
      { id: 'C11', g: 'F', text: 'German laboratory diagnostics segment context.', e: 'L', counts: 'Licensed · title only', date: 'Report Jun 2026', review: 'Not reviewable · no excerpt', notes: 0 },
      { id: 'C10', g: 'F', text: 'Apex named a German distribution partner for AX-Scan.', e: 'X', counts: 'Withdrawn by publisher', date: '9 Oct', review: 'Excluded · kept in history', notes: 0, strike: true },
      { id: 'C04', g: 'I', text: 'AX-Scan addresses the same laboratory use case as ND-200.', e: 'P', counts: '2 supporting · 0 contradicting', date: 'Drafted 8 Oct', review: 'AI draft · confirm on Impact', notes: 0 },
      { id: 'C05', g: 'I', text: 'AX-Scan’s clinical performance is equivalent to ND-200.', e: 'C', counts: '1 supporting · 1 contradicting', date: 'Drafted 8 Oct', review: 'Needs review', notes: 2 },
      { id: 'C07', g: 'A', text: 'Relevant annual revenue may erode by 5–15% over 12 months.', e: 'A', counts: 'Scenario input', date: 'Proposed 8 Oct', review: 'AI draft · edit on Impact', notes: 0 },
      { id: 'C08', g: 'U', text: 'AX-Scan holds the regulatory status required for sale in Germany.', e: 'U', counts: '1 source · no corroboration', date: 'Source 8 Oct', review: 'Needs review', notes: 1 },
      { id: 'C09', g: 'U', text: 'Reimbursement status of AX-Scan in Germany.', e: 'M', counts: 'No valid evidence', date: '—', review: 'Open question', notes: 0 }
    ];
    const groupCount = { F: '6', I: '2', A: '1', U: '2' };
    const rowBase = 'display:flex;flex-direction:column;align-items:flex-start;text-align:left;width:100%;padding:10px 16px;border:0;border-bottom:1px solid $border;font:inherit;cursor:pointer;transition:background 140ms;';
    let last = '';
    const claims = C.map(c => {
      const first = c.g !== last; last = c.g;
      return { ...c, id: c.id.replace('C', 'C-'), eV: c.e === 'V', eP: c.e === 'P', eC: c.e === 'C', eU: c.e === 'U', eA: c.e === 'A', eM: c.e === 'M', eX: c.e === 'X', eL: c.e === 'L',
        gF: first && c.g === 'F', gI: first && c.g === 'I', gA: first && c.g === 'A', gU: first && c.g === 'U', groupCount: groupCount[c.g],
        review: s.review[c.id] || c.review, hasNotes: c.notes > 0, notes: String(c.notes),
        pressed: s.sel === c.id ? 'true' : 'false',
        rowStyle: rowBase + (s.sel === c.id ? 'background:$accbg;' : 'background:transparent;'),
        textStyle: 'flex:1;min-width:0;font-size:13.5px;line-height:19px;color:' + (c.strike ? '$t3;text-decoration:line-through;' : '$t1;'),
        pick: () => this.setState({ sel: c.id, mode: null }) };
    });
    const cur = C.find(c => c.id === s.sel);
    const set = (txt) => this.setState({ review: { ...s.review, [s.sel]: txt }, mode: null });
    const v = { claims, selReview: s.review[s.sel] || cur.review, correcting: s.mode === 'corr', excluding: s.mode === 'ex', corrText: s.corr,
      accept: () => set('Accepted by Maya Patel · just now'),
      correct: () => this.setState({ mode: 'corr', corr: cur.text }),
      setCorr: (e) => this.setState({ corr: e.target.value }),
      saveCorr: () => set('Corrected by Maya Patel · just now · original kept in history'),
      exclude: () => this.setState({ mode: 'ex' }),
      exReasons: ['Source withdrawn', 'Not relevant to this case', 'Duplicate of another claim', 'Source not reliable'].map(r => ({ label: r, pick: () => set('Excluded by Maya Patel · ' + r + ' · not used in current conclusion') })),
      reqReview: () => set('Review requested from Diagnostics analyst · just now'),
      cancel: () => this.setState({ mode: null }) };
    C.forEach(c => { v['d' + c.id] = s.sel === c.id; });
    return v;
  }
}'''

page("Evidence.dc.html", "Evidence Workspace", shell("Cases", "Fri 9 Oct 2026, 10:30", content), logic, height=1360)
