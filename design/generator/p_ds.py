from common import *

LIGHT = [("bg.canvas", "#F7F7F5"), ("bg.surface", "#FFFFFF"), ("bg.sunken", "#F0F0EC"), ("border.subtle", "#E4E4DF"), ("border.control", "#84888F"),
         ("text.primary", "#17181B"), ("text.secondary", "#4B4F57"), ("text.tertiary", "#6A6E76"), ("accent", "#3049C9")]
SEM_L = [("success", "#1B7046", "#E6F3EB"), ("warning", "#8A5300", "#FBF0DA"), ("danger", "#B3261E", "#FCEBEA"), ("info", "#2853B8", "#E9EEFA"),
         ("neutral", "#4B4F57", "#EEEEEB"), ("ai", "#6A3DB0", "#F1ECFA"), ("restricted", "#3B4250", "#E8EAEE")]
DARK = [("bg.canvas", "#0F1012"), ("bg.surface", "#17191C"), ("bg.raised", "#1E2125"), ("border.subtle", "#2A2E34"), ("border.control", "#6A707A"),
        ("text.primary", "#ECEDEF"), ("text.secondary", "#B3B7BF"), ("text.tertiary", "#8B9099"), ("accent", "#8DA2F7")]
SEM_D = [("success", "#5FCB93", "#12291D"), ("warning", "#E9B651", "#2D2410"), ("danger", "#F48A84", "#331817"), ("info", "#86A9F6", "#152039"),
         ("neutral", "#B3B7BF", "#24272C"), ("ai", "#BBA0F4", "#251D3B"), ("restricted", "#C3C8D1", "#262A31")]


def swatches(base, sem, dark=False):
    tc, t2, bd = ("#ECEDEF", "#B3B7BF", "#2A2E34") if dark else ("$t1", "$t3", "$border")
    out = ""
    for n, h in base:
        out += f'<div style="display:flex;flex-direction:column;gap:6px;min-width:0"><div style="height:44px;border-radius:6px;background:{h};border:1px solid {bd}"></div><div style="font-size:12px;color:{tc};font-weight:500">{n}</div><div style="font-family:$mono;font-size:11.5px;color:{t2}">{h}</div></div>'
    out2 = ""
    for n, f, b in sem:
        out2 += f'<div style="display:flex;flex-direction:column;gap:6px;min-width:0"><div style="height:44px;border-radius:6px;background:{b};border:1px solid {bd};display:flex;align-items:center;padding:0 10px;color:{f};font-size:13px;font-weight:600">Aa · {n}</div><div style="font-family:$mono;font-size:11.5px;color:{t2}">{f} / {b}</div></div>'
    return (f'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:14px">{out}</div>'
            f'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-top:16px">{out2}</div>')


def sec(title, sub, inner, id_=""):
    return f'''<section aria-label="{title}" style="padding:32px 0;border-top:1px solid $border">
<div style="display:flex;flex-wrap:wrap;gap:24px">
<div style="flex:0 1 240px;min-width:200px"><h2 style="margin:0;font-size:18px;line-height:26px;font-weight:600">{title}</h2><p style="margin:6px 0 0;font-size:13px;color:$t2;line-height:19px">{sub}</p></div>
<div style="flex:999 1 560px;min-width:0">{inner}</div></div></section>'''


TYPE = [("Case title", "24/32 · 600", "font-size:24px;line-height:32px;font-weight:600;letter-spacing:-0.01em", "Apex AX-Scan Germany launch response"),
        ("Page title", "20/28 · 600", "font-size:20px;line-height:28px;font-weight:600", "Signal Inbox"),
        ("Section title", "18/26 · 600", "font-size:18px;line-height:26px;font-weight:600", "Exposure"),
        ("Body UI", "14/20 · 400", "font-size:14px;line-height:20px", "Overlap confirmed in one use case. Clinical-performance equivalence unresolved."),
        ("Table / dense", "13/20 · 400", "font-size:13px;line-height:20px", "Review 18 affected accounts · Sofia Klein · Due 25 Oct"),
        ("Caption", "12/16 · 400", "font-size:12px;line-height:16px;color:$t3", "TTM to 30 Sep 2026 · ND-200 · German segment · EUR"),
        ("KPI figure", "30/38 · 600 · tnum", "font-size:30px;line-height:38px;font-weight:600;letter-spacing:-0.02em", "€24.0M  ·  18  ·  €6.0M"),
        ("Reading serif", "Source Serif 4 · 17/28", "font-family:$serif;font-size:17px;line-height:28px", "Apex Diagnostics today announced the launch of AX-Scan in Germany, extending the platform to hospital laboratories in the region."),
        ("Mono", "Geist Mono · 12.5", "font-family:$mono;font-size:13px", "CR-1042 · v3 · 7c1e·94ab · NSD-412")]
type_rows = "".join(f'<div style="display:flex;flex-wrap:wrap;gap:6px 24px;align-items:baseline;padding:12px 0;border-bottom:1px solid $border"><div style="flex:0 0 150px"><div style="font-size:12.5px;font-weight:500">{a}</div><div style="font-size:12px;color:$t3;font-family:$mono">{b}</div></div><div style="flex:1 1 400px;min-width:0;{c}">{d}</div></div>' for a, b, c, d in TYPE)

space = "".join(f'<div style="display:flex;flex-direction:column;align-items:center;gap:6px"><div style="width:{s}px;height:{s}px;background:$accbg;border:1px solid $accbd;border-radius:2px"></div><span style="font-family:$mono;font-size:11.5px;color:$t3">{s}</span></div>' for s in [2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64])
radii = "".join(f'<div style="display:flex;flex-direction:column;gap:6px;align-items:center"><div style="width:64px;height:44px;border:1px solid $bstrong;border-radius:{r}px;background:$surface"></div><span style="font-size:12px;color:$t2">{r} px · {u}</span></div>' for r, u in [(4, "chips, inputs"), (6, "buttons, cards"), (8, "drawers, modals"), (999, "lifecycle pill")])
elev = "".join(f'<div style="flex:1 1 150px;height:72px;border:1px solid $border;border-radius:8px;background:$surface;{s};display:flex;align-items:flex-end;padding:10px;box-sizing:border-box;font-size:12px;color:$t2">{l}</div>' for l, s in [("0 · flat + border (default)", ""), ("1 · popover", "box-shadow:0 4px 12px rgba(15,16,18,.08)"), ("2 · drawer", "box-shadow:0 8px 24px rgba(15,16,18,.12)")])

foundation_misc = f'''<div style="display:flex;flex-direction:column;gap:22px">
<div><div style="font-size:12.5px;font-weight:500;margin-bottom:10px">Spacing · 4 px base</div><div style="display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end">{space}</div></div>
<div><div style="font-size:12.5px;font-weight:500;margin-bottom:10px">Radius</div><div style="display:flex;flex-wrap:wrap;gap:20px">{radii}</div></div>
<div><div style="font-size:12.5px;font-weight:500;margin-bottom:10px">Elevation · borders before shadows</div><div style="display:flex;flex-wrap:wrap;gap:14px">{elev}</div></div>
<div><div style="font-size:12.5px;font-weight:500;margin-bottom:6px">Motion</div><div style="font-size:13px;color:$t2;line-height:20px">120 ms hover and chips · 180 ms popover and tab · 240 ms drawer and modal. Enter <span style="font-family:$mono;font-size:12px">cubic-bezier(0.2, 0, 0, 1)</span>. Reduced motion replaces slides with ≤ 80 ms fades. Only the analysis progress glyph loops.</div></div>
<div><div style="font-size:12.5px;font-weight:500;margin-bottom:6px">Focus</div><div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><span style="display:inline-flex;align-items:center;height:36px;padding:0 14px;border-radius:6px;border:1px solid $bstrong;font-size:13.5px;font-weight:500;outline:2px solid $acc;outline-offset:2px">Focused button</span><span style="font-size:13px;color:$t2">2 px accent outline + 2 px offset on every interactive element.</span></div></div>
</div>'''


def gram(name, q, values, rule):
    return f'''<div style="display:flex;flex-wrap:wrap;gap:10px 24px;padding:16px 0;border-bottom:1px solid $border">
<div style="flex:0 1 220px;min-width:180px"><div style="font-size:13.5px;font-weight:600">{name}</div><div style="font-size:12.5px;color:$t3;margin-top:2px;line-height:18px">{q}</div></div>
<div style="flex:999 1 420px;min-width:0"><div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center">{values}</div><div style="font-size:12.5px;color:$t2;margin-top:10px;line-height:18px">{rule}</div></div></div>'''


analysis = f'''<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;background:$inb;color:$inf;font-size:13px;width:100%;max-width:640px;box-sizing:border-box;flex-wrap:wrap">
{icon("progress", 15)}<span style="font-weight:500">Preparing impact assessment</span><span style="color:$t2">Checking sources ✓ · Matching products … · Calculating exposure</span><span style="margin-left:auto;color:$t2">You can keep working</span></div>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$inf">{icon("progress", 14)}Running</span>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$wnf">{icon("halfcircle", 14)}Partial results</span>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$dgf">{icon("xcircle", 14)}Analysis stopped — your work is saved</span>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$t3">{icon("clock", 14)}Updated 10:42</span>'''

sync_demo = f'''<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border:1px solid $border;border-radius:8px;overflow:hidden;width:100%;max-width:640px">
<div style="padding:8px 12px;background:$canvas;font-size:12px;color:$t3;font-weight:500;border-bottom:1px solid $border">Internal status</div><div style="padding:8px 12px;background:$canvas;font-size:12px;color:$t3;font-weight:500;border-bottom:1px solid $border">External · Jira</div>
<div style="padding:8px 12px;border-bottom:1px solid $border">[[task:Not started]]</div><div style="padding:8px 12px;border-bottom:1px solid $border">[[sync:Not sent]]</div>
<div style="padding:8px 12px;border-bottom:1px solid $border">[[task:In progress]]</div><div style="padding:8px 12px;border-bottom:1px solid $border">[[sync:Confirmed|NSD-412]]</div>
<div style="padding:8px 12px;border-bottom:1px solid $border">[[task:Blocked]]</div><div style="padding:8px 12px;border-bottom:1px solid $border">[[sync:Sending…]]</div>
<div style="padding:8px 12px;border-bottom:1px solid $border">[[task:Submitted]]</div><div style="padding:8px 12px;border-bottom:1px solid $border;display:flex;gap:8px;align-items:center">[[sync:Failed]]<span style="font-size:12.5px;color:$acc;font-weight:500">Retry</span></div>
<div style="padding:8px 12px;border-bottom:1px solid $border">[[task:Accepted]]</div><div style="padding:8px 12px;border-bottom:1px solid $border">[[sync:Paused]] <span style="font-size:12px;color:$t2">approval changed</span></div>
<div style="padding:8px 12px">[[task:Done]]</div><div style="padding:8px 12px">[[sync:Checking]]</div></div>'''

grammars = (
    gram("Priority", "How much attention should this get? Monochrome bars, never hue.",
         '[[prio:High]][[prio:Medium]][[prio:Low]]<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:$t2">[[i:pencil|12]]Overridden</span>',
         "Position: first column after the title, and in the case header. Every level has a one-line definition in its tooltip.")
    + gram("Evidence strength", "How sure are we that it happened? Shield family + semantic hue.",
           "[[ev:Verified]][[ev:Partial]][[ev:Conflicting]][[ev:Unverified]]",
           "Position: next to claims, in citation chips, and once in the case header. The word Verified is reserved for evidence.")
    + gram("Lifecycle state", "Where is the case in the business process? Rail + filled pill.",
           "[[life:Draft]][[life:Assessing]][[life:Needs information]][[life:Ready for decision]][[life:Awaiting approval · v3]][[life:Approved]][[life:Executing]][[life:Monitoring]][[life:Closed]]"
           f'<div style="width:100%;margin-top:6px">{rail("Decide")}</div>',
           "Position: case header only, plus a table column. Off-path states (Needs information, Deferred) flag the current stage instead of adding steps.")
    + gram("Analysis status", "Is the system still working on it? Circular progress in the analysis strip.", analysis,
           "Never in the case header pill row. Completed collapses to a timestamp.")
    + gram("Internal vs external sync", "Is the work recorded here and in Jira? Two columns, never one Synced badge.", sync_demo,
           "Confirmed only after Jira returns a key. Retry affects the failed task only.")
)

claim_types = "[[ct:Fact]][[ct:Inference · AI]][[ct:Assumption]][[ct:Unknown]]"
stamps = "".join(f'<span style="display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 8px;border-radius:4px;border:1px solid {bd};color:{c};font-size:12.5px;font-weight:500">{icon(i, 13)}{t}</span>' for t, i, c, bd in [
    ("Awaiting your decision", "clock", "$t1", "$bstrong"), ("Changes requested", "message", "$wnf", "$wnf"), ("Approved v3 · Elena Fischer · 14 Oct 15:10", "check", "$okf", "$okf"),
    ("Rejected", "xcircle", "$dgf", "$dgf"), ("Deferred until 15 Nov 2026", "pause", "$t2", "$bstrong"), ("Superseded by v3", "history", "$t2", "$bstrong"), ("Invalidated — evidence changed", "alert", "$dgf", "$dgf")])


def comp(title, inner, note=""):
    n = f'<div style="font-size:12px;color:$t3;margin-top:10px;line-height:17px">{note}</div>' if note else ""
    return f'<div style="border:1px solid $border;border-radius:8px;padding:16px;min-width:0;display:flex;flex-direction:column"><div style="font-size:12px;font-weight:500;color:$t3;margin-bottom:12px">{title}</div><div style="flex:1">{inner}</div>{n}</div>'


source_ref = f'''<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px">Apex Diagnostics announced the launch of AX-Scan in Germany. [[src:Verified|Apex press release|8 Oct]]</p>
<div style="margin-top:12px;border:1px solid $border;border-radius:8px;box-shadow:0 4px 12px rgba(15,16,18,.08);padding:12px 14px;max-width:380px;background:$surface">
<div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:500">[[ev:Verified]]Apex Diagnostics · press release</div>
<p style="margin:8px 0 0;font-family:$serif;font-size:14px;line-height:22px;color:$t1">“…announced the launch of <mark style="background:#FFF1B8;color:inherit;padding:0 2px">AX-Scan in Germany</mark>…”</p>
<div style="font-size:12px;color:$t3;margin-top:8px">Retrieved 8 Oct 2026, 09:40 · Passage 1 of 2 · Limitation: manufacturer source</div></div>'''

verif = '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">[[ev:Verified|by Maya Patel · 9 Oct]][[ev:Partial|1 primary source]][[ev:Conflicting|2 sources disagree]][[ev:Unverified|single source]]</div>'

uncert = f'''<div role="note" style="border:1px solid #EBCB8B;background:$wnb;border-radius:8px;padding:12px 14px">
<div style="display:flex;align-items:center;gap:8px;color:$wnf;font-weight:600;font-size:13.5px">{icon("help", 15)}What we don’t know</div>
<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:20px;color:$t1"><li>Whether AX-Scan is clinically equivalent to ND-200</li><li>Precise regulatory status for sale in Germany</li><li>Reimbursement status</li></ul>
<a href="Evidence.dc.html" style="display:inline-block;margin-top:8px;font-size:13px;font-weight:500">Request verification</a></div>'''

expo = f'''<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:stretch">
<div style="flex:2 1 300px;min-width:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">{measure("Relevant annual revenue", "€24.0M", "TTM to 30 Sep 2026 · EUR")}{measure("Affected existing accounts", "18", "Distinct accounts")}</div>
<div role="separator" aria-label="Not recognized revenue" style="flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:$t3;writing-mode:vertical-rl;transform:rotate(180deg)"><span style="flex:1;width:1px;background:$bstrong"></span>Not recognized revenue<span style="flex:1;width:1px;background:$bstrong"></span></div>
<div style="flex:1 1 150px;min-width:0">{measure("Open pipeline", "€6.0M", "Current opportunities")}</div>
<div style="flex:1 1 200px;min-width:0">{measure("Scenario range (assumption)", "€1.2–3.6M", "€24.0M × 5–15% · no midpoint", dashed=True, tag="Assumption")}</div></div>'''

approval = f'''<div style="display:flex;flex-direction:column;gap:10px">
<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-size:13.5px;font-weight:600">Version 3</span>[[mono:7c1e·94ab]]<span style="font-size:12.5px;color:$t3">Submitted 14 Oct, 10:42</span></div>
<div style="font-size:12.5px;color:$t2">Your authority: Diagnostics · Germany · positioning, account review</div>
<div style="font-size:12.5px;color:$t2;display:flex;align-items:center;gap:6px">{icon("users", 13)}Approval chain · 1 of 1 required</div>
<div style="display:flex;flex-wrap:wrap;gap:8px">{btn("Approve response", "p")}{btn("Request changes")}{btn("Reject", "g")}{btn("Defer", "g")}</div></div>'''

version = f'''<div style="display:flex;flex-direction:column;gap:6px;max-width:340px">
<div style="display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font-size:13px"><span style="font-weight:500">v3</span><span style="color:$t2">Submitted 14 Oct 10:42</span><span style="margin-left:auto;font-size:12px;color:$acc;font-weight:500">Current</span>{icon("chevd", 14)}</div>
<div style="border:1px solid $border;border-radius:6px;font-size:13px;box-shadow:0 4px 12px rgba(15,16,18,.08)">
<div style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid $border"><b style="font-weight:500">v3</b><span style="color:$t2">14 Oct 10:42</span><span style="margin-left:auto;color:$acc;font-size:12px">Current</span></div>
<div style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid $border"><b style="font-weight:500">v2</b><span style="color:$t2">12 Oct 16:05</span><span style="margin-left:auto;color:$t3;font-size:12px">Changes requested · Superseded</span></div>
<div style="display:flex;gap:8px;padding:8px 10px"><b style="font-weight:500">v1</b><span style="color:$t2">12 Oct 11:40</span><span style="margin-left:auto;color:$t3;font-size:12px">Draft · not submitted</span></div></div>
<span style="font-size:12.5px;color:$acc;font-weight:500;display:inline-flex;gap:6px;align-items:center">{icon("compare", 14)}Compare with v2</span></div>'''

task_status = f'''<div style="display:flex;flex-direction:column;gap:10px">
<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span style="font-size:13px">Update Germany positioning brief</span><span style="display:flex;gap:14px">[[task:In progress]][[sync:Confirmed|NSD-412]]</span></div>
<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><span style="font-size:13px">Review 18 affected accounts</span><span style="display:flex;gap:14px;align-items:center">[[task:Not started]][[sync:Failed]]<span style="font-size:12.5px;color:$acc;font-weight:500">Retry</span></span></div></div>'''

activity = f'''<div style="display:flex;gap:10px;align-items:flex-start">
<span aria-hidden="true" style="width:24px;height:24px;border-radius:50%;background:$ntb;font-size:10.5px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">EF</span>
<div style="font-size:13px;line-height:19px"><b style="font-weight:500">Elena Fischer</b> <span style="color:$t2">approved</span> [[mono:v3]]<div style="font-size:12px;color:$t3;display:flex;gap:10px;margin-top:2px">14 Oct, 15:10<span style="display:inline-flex;gap:3px;align-items:center">{icon("flag", 11)}Key event</span></div>
<div style="font-size:12.5px;color:$t2;margin-top:4px">Rationale: “Scope is clear; brief must not claim clinical equivalence.”</div></div></div>'''

aiprov = '<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-start">[[ai:AI draft]][[ai:AI draft · edited by Maya Patel]]<span style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:$t2">[[i:sparkle|12|$aif]]Accepted by Maya Patel · 9 Oct</span><span style="font-size:12px;color:$t3">Human-authored: no badge</span></div>'

redact = '<div style="display:flex;flex-direction:column;gap:8px">' + "".join(f'<div style="display:flex;align-items:center;gap:12px">[[restr:{k}]]<span style="font-size:12.5px;color:$t2">{d}</span></div>' for k, d in [
    ("Restricted", "Exists; you lack access. Fixed width, no tooltip value."), ("Unavailable", "Source or licence not accessible."), ("Missing", "Not present in the data.")]) + '<div style="font-size:12.5px;color:$t2;margin-top:4px">Totals reflect your access scope.</div></div>'

nextact = f'''<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;background:$canvas"><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Next required action</div>{next_waiting("Elena Fischer", "since 14 Oct, 10:42")}</div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;background:$canvas;margin-top:10px"><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:8px">Next required action</div>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">{btn("Approve response", "p", disabled=True)}<span style="font-size:12.5px;color:$t2">Elena Fischer approves Diagnostics responses</span></div></div>'''

components = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
{comp("Source reference · citation chip + focus preview", source_ref, "Publisher label, never a bare number. Focus or hover opens the passage; click pins it in the source pane.")}
{comp("Verification tag", verif)}
{comp("Uncertainty notice", uncert, "Full tinted container with icon and heading; no accent side-rule.")}
{comp("Approval control", approval)}
{comp("Version selector", version)}
{comp("Task status · internal + external", task_status)}
{comp("Activity item", activity)}
{comp("AI-draft provenance", aiprov)}
{comp("Redacted value", redact)}
{comp("Next-action block", nextact, "Disabled actions name the reason and who can act.")}
</div>
<div style="margin-top:16px">{comp("Exposure summary · revenue vs pipeline vs assumption range", expo, "Three typed measures in separate groups. Never summed; the scenario is dashed, shows its formula and no midpoint. There is no slot for a total.")}</div>
<div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px">
{comp("Claim type · outlined tags (classification, not status)", f'<div style="display:flex;flex-wrap:wrap;gap:8px">{claim_types}</div>', "A Fact without Verified evidence is downgraded to Inference or Unknown.")}
{comp("Approval stamps", f'<div style="display:flex;flex-wrap:wrap;gap:8px">{stamps}</div>')}
</div>'''

dark_panel = f'<div style="background:#0F1012;border-radius:8px;padding:20px;margin-top:16px"><div style="font-size:12.5px;font-weight:500;color:#ECEDEF;margin-bottom:12px">Dark theme</div>{swatches(DARK, SEM_D, True)}</div>'

content = f'''<div style="font-family:$ui;color:$t1;background:$canvas;font-size:14px;line-height:20px;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;min-height:100%">
<div role="note" style="min-height:28px;display:flex;align-items:center;justify-content:center;gap:6px;padding:4px 16px;box-sizing:border-box;background:$sunken;border-bottom:1px solid $border;color:$t2;font-size:12px">[[i:info|13]]<span style="font-weight:500;color:$t1">Illustrative data — fictional</span> · examples use the CR-1042 fixture</div>
<div style="max-width:1200px;margin:0 auto;padding:40px 24px 64px">
<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;justify-content:space-between;padding-bottom:28px">
<div style="min-width:0;flex:1 1 480px"><div style="font-size:12.5px;color:$t3;font-weight:500">Competitive Response OS · Design foundations</div>
<h1 style="margin:6px 0 0;font-size:30px;line-height:38px;font-weight:600;letter-spacing:-0.02em">Foundations</h1>
<p style="margin:8px 0 0;color:$t2;font-size:14px;max-width:640px;line-height:21px">A calm, document-grade system. One accent for interaction; semantic hues only for status; each status dimension keeps its own icon family, shape and position.</p></div>
{btn("Back to Overview", "s", href="Main.dc.html", ic="chevl")}</div>
{sec("Typography", "Geist for interface text with tabular figures. Source Serif 4 for evidence and the decision brief. Geist Mono for IDs, fingerprints and Jira keys.", type_rows)}
{sec("Color", "Neutral canvas, one accent (#3049C9). Semantic text/background pairs ≥ 5.3:1 in light, ≥ 6.8:1 in dark.", swatches(LIGHT, SEM_L) + dark_panel)}
{sec("Space, radius, elevation, motion", "4 px grid. Borders before shadows. Motion explains where things came from.", foundation_misc)}
{sec("Five status grammars", "Each dimension has its own icon family, shape, vocabulary and fixed position. Labels always render; colour is never the only cue.", grammars)}
{sec("Components", "PRD §20 component set, shown with fixture data.", components)}
</div></div>'''

page("DesignSystem.dc.html", "Foundations", content, height=2700)
