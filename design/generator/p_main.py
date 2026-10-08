from common import *


def att(title, ic, count, rows, link, linktxt):
    return f'''<section aria-label="{title}" style="border:1px solid $border;border-radius:8px;background:$surface;display:flex;flex-direction:column;min-width:0">
<header style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid $border">
<span style="color:$t2">{icon(ic, 16)}</span><h2 style="margin:0;font-size:13.5px;font-weight:600">{title}</h2>
<span style="margin-left:auto;font-size:12.5px;color:$t2;font-weight:500">{count}</span></header>
<div style="flex:1;display:flex;flex-direction:column">{rows}</div>
<a href="{link}" class="lk" style="display:flex;align-items:center;gap:4px;padding:10px 14px;border-top:1px solid $border;font-size:12.5px;color:$t2;text-decoration:none">{linktxt}{icon("chevr", 13)}</a>
</section>'''


def arow(href, top, bottom, right=""):
    return f'''<a href="{href}" class="hr" style="display:flex;gap:10px;align-items:flex-start;padding:12px 14px;text-decoration:none;color:$t1;border-bottom:1px solid $border">
<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500;line-height:19px">{top}</div><div style="font-size:12.5px;color:$t2;margin-top:4px;line-height:18px">{bottom}</div></div>{right}</a>'''


def empty(text, sub):
    return f'''<div style="padding:18px 14px;display:flex;gap:10px;align-items:flex-start;color:$t2">
<span style="color:$t3;margin-top:1px">{icon("dashcircle", 16)}</span><div><div style="font-size:13px;color:$t1;font-weight:500">{text}</div><div style="font-size:12.5px;margin-top:3px;line-height:18px">{sub}</div></div></div>'''


lists = "".join([
    att("Awaiting decisions", "briefcase", "1",
        arow("Decision.dc.html", "[[mono:CR-1042]] Apex AX-Scan Germany launch response",
             "Approve response · v3 submitted 14 Oct, 10:42<br>Waiting on Elena Fischer · Diagnostics BU Head", ""),
        "Decision.dc.html", "Open pending decision"),
    att("High-priority untriaged signals", "inbox", "1",
        arow("SignalInbox.dc.html", "Apex Diagnostics announces AX-Scan distribution partner for Austria",
             '<span style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:2px">[[prio:High]] [[ev:Unverified]] <span>Added 2 h ago</span></span>'),
        "SignalInbox.dc.html", "Review signals"),
    att("Overdue actions", "clock", "0",
        empty("No overdue actions", "Tasks appear here after a plan is released. CR-1042 has no released plan yet."),
        "MyActions.dc.html", "View my actions"),
    att("Outcome reviews due", "target", "0",
        empty("No reviews due in the next 30 days", "CR-1042 review is scheduled 30 days after its plan is released."),
        "Outcomes.dc.html", "View outcomes"),
])

TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 12px;height:36px;border-bottom:1px solid $border;white-space:nowrap"
TD = "padding:12px;border-bottom:1px solid $border;vertical-align:top;font-size:13px"

table = f'''<div style="overflow-x:auto;border:1px solid $border;border-radius:8px">
<table style="width:100%;border-collapse:collapse;min-width:980px">
<caption style="position:absolute;left:-9999px">Active response cases in your scope</caption>
<thead><tr style="background:$canvas">
<th scope="col" style="{TH}">Case</th><th scope="col" style="{TH}">Competitor · event</th><th scope="col" style="{TH}">Business scope</th>
<th scope="col" style="{TH}">Owner</th><th scope="col" style="{TH}">Priority</th><th scope="col" style="{TH}">Lifecycle</th>
<th scope="col" style="{TH}">Next step</th><th scope="col" style="{TH};text-align:right">Age</th></tr></thead>
<tbody>
<tr class="hr">
<td style="{TD}"><a href="CaseSummary.dc.html" style="text-decoration:none;color:$t1;display:flex;flex-direction:column;gap:3px">[[mono:CR-1042]]<span style="font-weight:500;font-size:13.5px">Apex AX-Scan Germany launch response</span></a></td>
<td style="{TD}"><div>Apex Diagnostics</div><div style="color:$t2;font-size:12.5px;margin-top:2px">AX-Scan launch · Event date 7 Oct 2026</div></td>
<td style="{TD}"><div>Diagnostics BU · Germany</div><div style="color:$t2;font-size:12.5px;margin-top:2px">ND-200 · 1 confirmed use case</div></td>
<td style="{TD}">Maya Patel</td>
<td style="{TD}">[[prio:High]]</td>
<td style="{TD}">[[life:Awaiting approval · v3]]</td>
<td style="{TD}"><div style="font-weight:500">Approve response</div><div style="color:$t2;font-size:12.5px;margin-top:2px">Waiting on Elena Fischer · since 14 Oct, 10:42</div></td>
<td style="{TD};text-align:right;color:$t2;white-space:nowrap">6 days</td>
</tr>
<tr><td colspan="8" style="padding:14px 12px;font-size:12.5px;color:$t3">No other active cases in your scope. Cases appear here when a signal is turned into a response case.</td></tr>
</tbody></table></div>'''

ACT = [
    ("MP", "Maya Patel", "submitted decision package", "v3", "14 Oct, 10:42", True),
    ("EF", "Elena Fischer", "requested changes on", "v2", "13 Oct, 09:30", True),
    ("MP", "Maya Patel", "submitted decision package", "v2", "12 Oct, 16:05", False),
    ("MP", "Maya Patel", "confirmed product overlap · 1 use case", "", "9 Oct, 15:20", False),
    ("MP", "Maya Patel", "created CR-1042 from", "SIG-881", "8 Oct, 14:20", True),
]
acts = ""
for ini, who, verb, obj, when, pin in ACT:
    o = f" {mono(obj)}" if obj else ""
    p = f'<span style="font-size:11.5px;color:$t3;display:inline-flex;align-items:center;gap:3px">{icon("flag", 11)}Key event</span>' if pin else ""
    acts += f'''<li style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid $border">
<span aria-hidden="true" style="width:24px;height:24px;border-radius:50%;background:$ntb;font-size:10.5px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">{ini}</span>
<div style="flex:1;min-width:0;font-size:13px;line-height:19px"><span style="font-weight:500">{who}</span> <span style="color:$t2">{verb}</span>{o}
<div style="display:flex;gap:10px;align-items:center;margin-top:2px"><span style="font-size:12px;color:$t3">{when}</span>{p}</div></div></li>'''

content = f'''<div style="max-width:1160px;margin:0 auto;padding:24px 24px 40px;display:flex;flex-direction:column;gap:24px">
<div style="display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end">
<div style="flex:1 1 360px;min-width:0">
<h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-0.01em">Good morning, Maya</h1>
<p style="margin:4px 0 0;color:$t2;font-size:13.5px">One decision is waiting and one new high-priority signal needs triage.</p>
<div style="display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:12.5px;color:$t3">
<span style="display:inline-flex;align-items:center;gap:5px">[[i:filter|13]]Showing Diagnostics BU only</span>
<span style="display:inline-flex;align-items:center;gap:5px">[[i:refresh|13]]Signals refreshed 10:55</span></div>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
{btn("View my actions", "g", href="MyActions.dc.html")}
{btn("Review signals", "s", href="SignalInbox.dc.html", ic="inbox")}
{btn("Open pending decision", "p", href="Decision.dc.html")}
</div></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">{lists}</div>
<section aria-label="Active cases">
{h2("Active cases", "1 case · Diagnostics BU · sorted by next-step due date", btn("All cases", "g", href="CaseSummary.dc.html", ic="briefcase"))}
{table}
</section>
<div style="display:flex;flex-wrap:wrap;gap:24px">
<section aria-label="Recent key activity" style="flex:1 1 420px;min-width:0">
{h2("Recent key activity", "Decisions, submissions and case creation across your cases")}
<ol style="list-style:none;margin:0;padding:0;border-top:1px solid $border">{acts}</ol>
</section>
<section aria-label="Sample case" style="flex:1 1 320px;min-width:0">
{h2("Follow the CR-1042 journey")}
<div style="border:1px solid $border;border-radius:8px;padding:4px 0">
{"".join(f'<a href="{h}" class="hr" style="display:flex;align-items:center;gap:10px;padding:9px 14px;text-decoration:none;color:$t1;font-size:13px"><span style="width:20px;color:$t3;font-size:12px">{n}</span><span style="flex:1">{t}</span><span style="color:$t3;font-size:12px">{w}</span>{icon("chevr", 13, "$t3")}</a>' for n, t, w, h in [
    ("1", "Triage the Apex launch signal", "Maya", "SignalInbox.dc.html"),
    ("2", "Verify claims and sources", "Maya", "Evidence.dc.html"),
    ("3", "Confirm overlap and exposure", "Maya", "Impact.dc.html"),
    ("4", "Compare response options", "Maya", "ResponseOptions.dc.html"),
    ("5", "Review and approve v3", "Elena", "Decision.dc.html"),
    ("6", "Authorize plan, recover failed sync", "Maya", "ActionPlan.dc.html"),
    ("7", "Complete the positioning brief", "Jonas", "MyActions.dc.html"),
    ("8", "Day-30 outcome review", "Maya", "Outcomes.dc.html")])}
</div></section></div>
</div>'''

body = shell("Overview", "Wed 14 Oct 2026, 11:00", content, counts={"My Actions": None, "Signal Inbox": "1"})
page("Main.dc.html", "Overview", body, height=1180)
