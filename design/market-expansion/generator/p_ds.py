from components import *


def sec(title, sub, inner, sid):
    return f'<section aria-labelledby="{sid}" style="padding:28px 0;border-top:1px solid $border">{h2(title, sub, hid=sid)}{inner}</section>'


def sw(name, light, dark, note=""):
    return f'''<div style="display:flex;gap:10px;align-items:center;min-width:0">
<span aria-hidden="true" style="display:flex;flex:none;border:1px solid $border;border-radius:6px;overflow:hidden"><span style="width:28px;height:28px;background:{light}"></span><span style="width:28px;height:28px;background:{dark}"></span></span>
<span style="display:flex;flex-direction:column;line-height:16px;min-width:0"><span style="font-size:12.5px;font-weight:500">{name}</span><span style="font-family:$mono;font-size:11.5px;color:$t2">{light} · {dark}</span>{f'<span style="font-size:11.5px;color:$t3">{note}</span>' if note else ""}</span></div>'''


BASE = [("bg.canvas", "#F7F7F5", "#0F1012"), ("bg.surface", "#FFFFFF", "#17191C"), ("bg.sunken", "#F0F0EC", "#1E2125"), ("border.subtle", "#E4E4DF", "#2A2E34"),
        ("border.control", "#84888F", "#6A707A"), ("text.primary", "#17181B", "#ECEDEF"), ("text.secondary", "#4B4F57", "#B3B7BF"), ("text.tertiary", "#6A6E76", "#8B9099"),
        ("accent", "#3049C9", "#8DA2F7"), ("success.fg", "#1B7046", "#5FCB93"), ("success.bg", "#E6F3EB", "#12291D"), ("warning.fg", "#8A5300", "#E9B651"), ("warning.bg", "#FBF0DA", "#2D2410"),
        ("danger.fg", "#B3261E", "#F48A84"), ("danger.bg", "#FCEBEA", "#331817"), ("info.fg", "#2853B8", "#86A9F6"), ("info.bg", "#E9EEFA", "#152039"),
        ("neutral.fg", "#4B4F57", "#B3B7BF"), ("neutral.bg", "#EEEEEB", "#24272C"), ("ai.fg", "#6A3DB0", "#BBA0F4"), ("ai.bg", "#F1ECFA", "#251D3B"),
        ("restricted.fg", "#3B4250", "#C3C8D1"), ("restricted.bg", "#E8EAEE", "#262A31")]
EPI = [("kind.evidence fg", "#0E6464", "#6CCFCB", "5.98:1 on bg"), ("kind.evidence bg", "#E3F1F0", "#10292A"), ("kind.assumption fg", "#8C2D6B", "#E79BC9", "6.63:1 on bg"), ("kind.assumption bg", "#F8E9F1", "#2E1726"),
       ("kind.scenario fg", "#2F5F78", "#8FC0DA", "5.91:1 on bg"), ("kind.scenario bg", "#E6EEF3", "#14232C"), ("kind.actual fg", "#17181B", "#ECEDEF", "14.99:1 on bg"), ("kind.actual bg", "#ECECE8", "#24272C")]
RAMP = [("scenario.downside ▼", "#5E8FA8", "#6E9DB5"), ("scenario.base ●", "#2F5F78", "#9CC4D9"), ("scenario.upside ▲", "#163A4D", "#D3E8F3")]
CAT = [("cat.1", "#0072B2", "#56B4E9"), ("cat.2", "#B35A00", "#E69F00"), ("cat.3", "#00866B", "#3CC49E"), ("cat.4", "#A8508A", "#D98BB8")]
CHART = [("chart.actual", "#17191B", "#ECEDEF", "solid · ■"), ("chart.threshold", "#4B4F57", "#B3B7BF", "dashed 4-2"), ("chart.baseline", "#6A6E76", "#8B9099", "dotted"),
         ("chart.cap", "#8A5300", "#E9B651", "2 px + lock-bar"), ("chart.topdown", "#6A6E76", "#8B9099", "hatched range"), ("chart.bottomup", "#2F5F78", "#9CC4D9", "marker")]


def grid(items, minw=220):
    return f'<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax({minw}px,1fr));gap:12px 20px">{items}</div>'


def sub(t):
    return f'<h3 style="margin:18px 0 10px;font-size:13px;font-weight:600;color:$t2">{t}</h3>'


type_ = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">
<div style="border:1px solid $border;border-radius:8px;padding:16px">{eyebrow("UI sans · Geist · 400/500/600")}
<div style="font-size:30px;line-height:38px;font-weight:600;letter-spacing:-0.02em">Portfolio overview</div>
<div style="font-size:20px;line-height:28px;font-weight:600">Approve pilot €120k · 90 days</div>
<div style="font-size:16px;line-height:24px;font-weight:600">Measure ladder</div>
<div style="font-size:14px;line-height:20px">Interface text and tables, 14/20. Tabular figures: 5,000 · 2,000 · 500</div>
<div style="font-size:13px;line-height:20px;color:$t2">Secondary 13/20 · labels and meta</div>
<div style="font-size:12px;line-height:16px;color:$t3">Caption 12/16 · timestamps</div></div>
<div style="border:1px solid $border;border-radius:8px;padding:16px">{eyebrow("Reading serif · Source Serif 4 · 17/28")}
<p style="margin:0;font-family:$serif;font-size:17px;line-height:28px">Aster should run a bounded, paid pilot with four German food-processing sites before any decision on market entry. The adoption assumption is disputed and stays visible.</p>
<p style="margin:8px 0 0;font-size:12.5px;color:$t2">Decision package, thesis prose, evidence excerpts, exports.</p></div>
<div style="border:1px solid $border;border-radius:8px;padding:16px">{eyebrow("Mono · Geist Mono · 13/20")}
<div style="font-family:$mono;font-size:13px;line-height:22px">ME-104 · v3 · 7F3A·19C2 · PIL-12<br>SAM = (1,400 + 1,100 − 500) × €20,000<br>&#160;&#160;&#160;&#160;= €40,000,000/year</div>
<p style="margin:8px 0 0;font-size:12.5px;color:$t2">IDs, versions, fingerprints, task keys, formula rows, ledger values.</p></div></div>
<div style="margin-top:12px;font-size:12.5px;color:$t2">Scale 12/16 · 13/20 · 14/20 · 16/24 (serif 17/28) · 18/26 · 20/28 · 24/32 · 30/38..</div>'''

palette = (sub("Base · light | dark") + grid("".join(sw(*b) for b in BASE), 200)
           + sub("Epistemic kinds") + grid("".join(sw(*b) for b in EPI), 200)
           + sub("Scenario ramp (ordinal, no good/bad hue)") + grid("".join(sw(*b) for b in RAMP), 200)
           + sub("Categorical · up to 4 candidates or cohorts · never status") + grid("".join(sw(*b) for b in CAT), 200)
           + sub("Chart reference lines") + grid("".join(sw(*b) for b in CHART), 200))

spacing = f'''<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-end">{"".join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:4px"><span aria-hidden="true" style="width:{v}px;height:{v}px;background:$accbg;border:1px solid $accbd"></span><span style="font-family:$mono;font-size:11.5px;color:$t2">{v}</span></div>' for v in [2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:16px;font-size:13px">
<div style="border:1px solid $border;border-radius:8px;padding:12px">{eyebrow("Radius")}4 · 6 · 8 px<div style="display:flex;gap:8px;margin-top:8px">{"".join(f'<span aria-hidden="true" style="width:32px;height:24px;border:1px solid $ctrl;border-radius:{r}px"></span>' for r in [4, 6, 8])}</div></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px">{eyebrow("Layout")}Sidebar 240 · content max 1160–1240 · right panel 360 · rows 36 compact / 44 comfortable</div>
<div style="border:1px solid $border;border-radius:8px;padding:12px">{eyebrow("Motion")}120 ms hover · 180 ms panels · 240 ms drawers · reduced-motion turns all off</div>
<div style="border:1px solid $border;border-radius:8px;padding:12px">{eyebrow("Focus")}<button type="button" style="{BTN}border:1px solid $bstrong;background:$surface;outline:2px solid $acc;outline-offset:2px">Focus-visible ring</button></div></div>'''

kinds = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px">
{"".join(f'<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px">{k}<div style="font-size:20px;font-weight:{w}">{v}</div><div style="font-size:12.5px;color:$t2;line-height:18px">{d}</div></div>' for k, v, w, d in [
    (kind("Evidence", "Census 2026"), "5,000 sites", 500, "Sourced fact from a permitted source. Solid 1 px border · document glyph."),
    (kind("Assumption", "Maya Rao"), "20% adoption", 500, "Human-owned belief used as input. Dashed 1 px border · ruler-pencil glyph."),
    (kind("Scenario", "Base · Year 3"), "€2.0m annual revenue", 500, "Output under named assumptions for a horizon. Dotted border · branch glyph. Never “forecast”."),
    (kind("Actual", "1 Dec–28 Feb"), "3 of 4 met", 700, "Measured observation with period and source. Flag glyph · solid ink border · bold figures. (Replaces the research’s 2 px left rule, which this canvas does not allow.)"),
    (kind("Unknown"), "Unknown", 500, "Required but not available. Never shown as 0."),
    (ai() + " " + kind("Assumption", small=True), "Price €20k/year", 500, "AI provenance is a separate badge beside the kind until a person accepts it."),
])}</div>'''

ramp = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
<figure style="margin:0;border:1px solid $border;border-radius:8px;padding:14px">
<figcaption style="font-size:12.5px;color:$t2;margin-bottom:8px">Customers at end of year 3 · count · capacity cap 120</figcaption>
<svg role="img" aria-label="Downside 50, Base 100, Upside 120 customers; capacity 120" viewBox="0 0 400 90" style="width:100%;height:auto;display:block;font-family:Geist,sans-serif">
<line x1="20" y1="50" x2="380" y2="50" stroke="#D6D6D0"></line>
<line x1="320" y1="14" x2="320" y2="70" stroke="#8A5300" stroke-width="2"></line><text x="324" y="22" font-size="11" fill="#8A5300">Capacity 120</text>
<path d="M164 42h12l-6 10Z" fill="#5E8FA8"></path><text x="170" y="72" font-size="11" fill="#4B4F57" text-anchor="middle">▼ Downside 50</text>
<circle cx="245" cy="47" r="6" fill="#2F5F78"></circle><text x="245" y="72" font-size="11" fill="#4B4F57" text-anchor="middle">● Base 100</text>
<path d="M314 52h12l-6-10Z" fill="#163A4D"></path><text x="320" y="86" font-size="11" fill="#4B4F57" text-anchor="middle">▲ Upside 120 · capped</text>
<text x="20" y="66" font-size="10" fill="#6A6E76">0</text></svg></figure>
<div style="border:1px solid $border;border-radius:8px;padding:14px;font-size:13px;line-height:20px">
<div style="display:flex;gap:14px;flex-wrap:wrap">{"".join(f'<span style="display:inline-flex;gap:6px;align-items:center">{sc_mark(s, 13)}{s}</span>' for s in ["Downside", "Base", "Upside"])}</div>
<ul style="margin:8px 0 0;padding-left:18px;color:$t2"><li>Fixed order Downside · Base · Upside, equal column widths.</li><li>Shape and direct label carry identity; colour is the third cue.</li><li>Never “likely”, “expected” or percentages next to scenario names.</li><li>Base means reference assumptions, not the expected outcome.</li></ul></div></div>'''

DSTATES = ["notstarted", "precond", "ready", "awaiting", "approved", "approvedc", "returned", "blocked", "notapproved", "invalidated", "superseded"]
gates = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 16px">{"".join(f'<div style="display:flex;gap:10px;align-items:center;padding:8px 10px;border:1px solid $border;border-radius:6px">{diamond(s, 20)}<span style="font-size:13px">{DIA[s][1]}{" (2 of 5)" if s == "precond" else ""}</span></div>' for s in DSTATES)}</div>
<div style="margin-top:16px;border:1px solid $border;border-radius:8px;padding:12px 14px">{rail(4, G_REVIEW)}</div>
<p style="margin:8px 0 0;font-size:12.5px;color:$t2">Gate rail: stage segments with a diamond per gate, scope and date under each. G2 approval never moves the case past G3.</p>'''


def vocab(title, items):
    return f'<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;min-width:0"><div style="font-size:12.5px;font-weight:600;margin-bottom:8px">{title}</div><div style="display:flex;flex-wrap:wrap;gap:8px 14px">{items}</div></div>'


vocabs = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:12px">
{vocab("Case stage", "".join(stage(s) for s in ["Draft mandate", "Discovery", "Assessment", "Validation", "Pilot approval pending", "Pilot approved", "Pilot running", "Review due", "Scale approval pending", "Scaling", "Closed", "On hold", "Stopped"]))}
{vocab("Gate status", "".join(gate_chip(s) for s in ["notstarted", "precond", "ready", "awaiting", "approved", "approvedc", "returned", "notapproved", "blocked", "invalidated", "superseded"]))}
{vocab("Experiment result", "".join(result(s) for s in ["Planned", "Running", "Too early to read", "Met", "Not met", "Inconclusive", "Amended"]))}
{vocab("Assumption status", "".join(astatus(s) for s in ["Untested", "Testing", "Supported", "Contradicted", "Inconclusive", "Retired"]))}
{vocab("Run status · analysis strip only", "".join(run(s) for s in ["Queued", "Working: checking sources…", "Needs your input", "Partial results", "Done", "Stopped — your work is saved"]))}
{vocab("External sync", "".join(sync(s, "PIL-12" if s == "Confirmed" else "") for s in ["Not sent", "In preview", "Sending…", "Confirmed", "Failed", "Retry", "Checking", "Paused — approval changed"]))}
{vocab("Connector", "".join(conn(s) for s in ["Connected", "Expired", "Missing permission", "Unavailable"]))}
{vocab("Evidence freshness", "".join(fresh(s, x) for s, x in [("Current", ""), ("Ageing", "34 days"), ("Stale", ""), ("Superseded", "")]))}
{vocab("Evidence quality · sensitivity", "".join(evq(s) for s in ["Strong", "Some", "Weak", "None", "Conflicting"]) + "".join(sens(s) for s in ["High", "Medium", "Low"]))}
{vocab("Opportunity status · reviews", "".join(opp(s) for s in ["Detected", "Shortlisted", "Converted", "Dismissed", "Duplicate"]) + proposed() + "".join(review(s) for s in ["Signed", "Pending", "In review", "Blocker"]))}
</div>
<p style="margin:10px 0 0;font-size:12.5px;color:$t2">Reserved words: “Approved” only for gates · “Met” only for thresholds · “Supported” only for assumptions · “Confirmed” only for external sync · “Verified” only for evidence strength · “Done” only for tasks. Red is reserved for system failures, contradictions and invalidated approvals.</p>'''

numbers = table(["Rule", "Example"], [
    ["Market sizes: lowercase m, unit after slash", "€100m/year · €40m/year"],
    ["One format per row in comparison sets; no more precision than the fixture", "€1.0m · €2.0m · €2.4m · €0.60m · €1.20m · €1.44m"],
    ["Thousands: k, no decimals", "€120k · €15k · €600k"],
    ["Scenario money names scenario and horizon", "€2.0m annual revenue · Base · end of year 3"],
    ["One-time money says so", "€400k one-time"],
    ["Ranges: en dash, unit once", "8–12 interviews"],
    ["Counts with thousands separator", "5,000 sites · 2,000 unique sites"],
    ["Signed adjustments use a true minus", "−500"],
    ["Whole-number percentages for assumptions", "20% adoption · 60% margin"],
    ["Threshold ratios as x of y", "3 of 4 pilot customers met threshold"],
    ["True zero vs missing", "€0k (break-even) · Not available — needs ramp inputs"],
    ["Exact value on demand (ledger only)", mono("€40,000,000", 13, "$t1")],
    ["Currency and year once per view header", "EUR · 2026 prices"],
    ["Placeholders are bracketed, never invented", "€[cap] · €[limit]"],
], minw=520)

ledger = table(["Input", ">Value", "Kind", "Basis", "Quality", "Version", "Used by"], [
    ["Annual spend per site", mono("€20,000/year", 13, "$t1"), kind("Assumption", small=True), "Maya Rao · paid pilot offer", evq("Weak"), mono("v2"), "TAM · SAM · SOM · Economics"]], minw=760)

ladder = ladder_row("SAM", "Sites we could serve after eligibility and product-fit filters.", "2,000 unique sites", "€40m/year", kind("Evidence", small=True) + kind("Assumption", small=True))

approvals = f'''<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
{approve_btn("Approve validation €15k", full=False)}{approve_btn("Approve pilot €120k · 90 days", full=False)}{approve_btn("Approve extension €[cap]", full=False)}{approve_btn("Authorize scale", disabled=True, full=False)}
{btn("Return for revision", "s")}{btn("Not approved", "s")}{btn("Abstain", "g")}</div>
<p style="margin:8px 0 0;font-size:12.5px;color:$t2">A bare “Approve” never appears. Disabled buttons always sit next to their reason.</p>'''

comps = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(440px,1fr));gap:16px">
<div>{sub("Evidence drawer item")}{evidence_item("German food-processing site census, 2026 edition", "[Publisher]", "3 Jun 2026", "5,000 food-processing sites in Germany operate a process-water treatment step.", "Strong", "<span>Retrieved 8 Oct 2026</span><span>Licence: internal use, 2-sentence excerpts</span>")}</div>
<div>{sub("Assumption chip")}<div style="display:flex;flex-wrap:wrap;gap:8px">{assumption_chip("20% adoption", "Maya Rao", True)}{assumption_chip("€20k annual price", "Maya Rao")}{assumption_chip("Capacity 120 customers", "[Operations lead]")}</div>
{sub("Owner picker")}{owner_picker()}</div>
<div style="grid-column:1/-1">{sub("Formula ledger row")}{formula("SAM", "(Size-qualified 1,400 + Process-qualified 1,100 − Overlap 500) × Annual spend per site €20,000", "€40m/year · Calculated · depends on 1 assumption")}<div style="margin-top:8px">{card(ledger, "overflow:hidden")}</div></div>
<div style="grid-column:1/-1">{sub("Measure-ladder row")}{ladder}</div>
<div>{sub("Review panel")}{review_panel()}</div>
<div>{sub("Activity item")}<ul style="list-style:none;margin:0;padding:0;border-top:1px solid $border">{activity_item("EF", "Elena Fischer approved pilot €120k · 90 days (G2) with 3 conditions", "Snapshot v3 · 7F3A·19C2", "27 Nov, 09:14", True)}{activity_item("MR", "Maya Rao amended the validation window", "Amendment 1 · original kept", "2 Nov, 15:20")}</ul></div>
<div style="grid-column:1/-1">{sub("Approval buttons")}{approvals}</div>
<div style="grid-column:1/-1">{sub("Authorizes / Does not authorize")}{auth_boxes(["Pilot at up to 4 German food-processing sites", "Up to €120k · 90 days (1 Dec 2026 – 28 Feb 2027)", "Creating the approved pilot tasks"], ["Not market entry", "Not scale", "Not prospect outreach", "Not spend above €120k"])}</div>
<div>{sub("Dissent object")}{dissent("DW", "I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use.", "14 Oct, 10:02", "Scope: adoption assumption · carried into package v3")}</div>
<div>{sub("Condition objects")}<div style="display:flex;flex-direction:column;gap:8px">{condition("C1", "Pilot limited to 4 sites as signed by the specialist", "Jonas Klein", "1 Dec", True, "Met")}{condition("C2", "Log deployment effort per site every week", "Jonas Klein", "Weekly", False)}</div></div>
</div>'''

content = f'''<div style="padding:24px 28px 40px;max-width:1240px">
<h1 style="margin:0;font-size:24px;line-height:32px;font-weight:600">Design foundations</h1>
<p style="margin:4px 0 8px;font-size:13.5px;color:$t2;max-width:760px">One Growth OS family with Competitive Response: warm neutral canvas, one indigo accent, semantic hues for status only, violet for AI. Market Expansion adds epistemic kinds, an ordinal scenario ramp, gate diamonds and number rules.</p>
{sec("Typography", "Geist for interface, Source Serif 4 for reading, Geist Mono for IDs and ledger figures", type_, "s-type")}
{sec("Palette", "Each swatch shows light | dark. Text pairs meet 4.5:1; marks meet 3:1.", palette, "s-pal")}
{sec("Spacing, radius, motion", "4 px base grid", spacing, "s-sp")}
{sec("Epistemic kinds", "Every number shows what kind of claim it is, by line style, glyph and label — never by colour alone", kinds, "s-kind")}
{sec("Scenario ramp", "Downside ▼ · Base ● · Upside ▲ — conditional cases, not probabilities", ramp, "s-ramp")}
{sec("Gate diamonds", "One glyph family for gate status", gates, "s-gate")}
{sec("Status vocabularies", "One grammar per dimension, icon + text + colour, fixed position", vocabs, "s-voc")}
{sec("Number formatting", "Round to what the evidence supports; exact values live in the ledger", numbers, "s-num")}
{sec("Components", "Shared across screens", comps, "s-comp")}
</div>'''

page("DesignSystem.dc.html", "Design Foundations", shell("Design foundations", "Reference", content, user="MR"), height=3400)
