from components import *


def sec(title, sub, inner, sid, right=""):
    return f'<section aria-labelledby="{sid}" style="padding:24px 0;border-top:1px solid $border">{h2(title, sub, right, hid=sid)}{inner}</section>'


authority = table(["Gate", "Business unit", "Approver", "Ceiling", "Notes"], [
    [gate_chip("approved", "G0 · Mandate"), "BU Water", person("EF", "BU VP"), "No spend", "Sponsor approves scope"],
    [gate_chip("approved", "G1 · Validation"), "BU Water", person("EF", "BU VP"), mono("up to €[limit]", 12.5, "$t1"), "Case owner cannot self-approve"],
    [gate_chip("approved", "G2 · Pilot"), "BU Water", person("EF", "BU VP"), mono("up to €[limit]", 12.5, "$t1"), "Finance and specialist sign-offs required"],
    [gate_chip("blocked", "G3 · Scale"), "BU Water", '<span style="color:$wnf;display:inline-flex;gap:6px;align-items:center">' + icon("alert", 14) + '<span style="color:$t1">No approver above €[limit]</span></span>', mono("above €[limit]", 12.5, "$t1"), "Authority gap · assign investment committee"],
], minw=820)

roles = table(["Person", "Role", "Can edit", "Can review", "Can approve gates"], [
    [person("MR"), "Case owner", "Cases, sizing, economics", "—", '<span style="color:$t2">No · cannot self-approve</span>'],
    [person("DW"), "Finance reviewer", "Economics drafts", "Economics", '<span style="color:$t2">No</span>'],
    [person("PS"), "Product reviewer", "Feasibility notes", "Product fit", '<span style="color:$t2">No</span>'],
    [person("LH"), "Specialist reviewer", "—", "Legal and regulatory", '<span style="color:$t2">No · blocks readiness</span>'],
    [person("JK"), "Pilot owner", "Pilot tasks, actuals", "Commercial access", '<span style="color:$t2">No</span>'],
    [person("EF"), "Sponsor", "—", "All", '<span style="font-weight:500">G0–G2 within €[limit]</span>'],
    [person("TA"), "Administrator", "Settings", "—", '<span style="color:$t2">No — configures only</span>'],
], minw=820)

policies = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px">
{"".join(f'<div style="border:1px solid $border;border-radius:8px;padding:12px 14px"><div style="display:flex;gap:8px;align-items:center;font-weight:600;font-size:13.5px">{diamond("notstarted", 15)}{g}</div><ul style="margin:8px 0 0;padding-left:18px;font-size:13px;line-height:20px;color:$t2">{"".join(f"<li>{x}</li>" for x in items)}</ul></div>' for g, items in [
    ("G0 · Scope approved", ["Sponsor, objective, constraints", "Accountable owner", "Currency and horizon"]),
    ("G1 · Validate thesis", ["Evidence inventory", "Comparable sizing", "Material unknowns", "Feasibility blockers listed"]),
    ("G2 · Pilot investment", ["Validation results", "Finance review", "Specialist sign-off", "Budget and stop rules", "Accountable pilot owner"]),
    ("G3 · Scale", ["Pilot actuals vs thresholds", "Readiness reassessment", "Updated economics and capacity", "Approved scale budget"])])}</div>
<div style="margin-top:12px;border:1px solid $border;border-radius:8px;padding:12px 14px;font-size:13px;display:flex;flex-direction:column;gap:4px">
<div><b style="font-weight:600">Materiality rule</b> · Changes to geography, product, spend ceiling or a decision-critical assumption invalidate affected approvals and return the case for review. Uncertain cases escalate.</div>
<div><b style="font-weight:600">Approval expiry</b> · 14 days if unused · <b style="font-weight:600">Self-approval</b> · not allowed · <b style="font-weight:600">Retention</b> · approval history kept for [retention period]</div></div>'''

ent = table(["Source", "Licence", "Who sees excerpts", "Others see"], [
    ["Site census · [Publisher]", "Internal use · 2-sentence excerpts", "Maya Rao, Daniel Weber, Elena Fischer", "Aggregates only"],
    ["Vendor market estimate", "Not licensed in this workspace", "Nobody", "Restricted · no excerpt or summary"],
    ["Authorized uploads", "Per upload", "Case members", "Nothing"],
    ["CRM accounts", "Not connected", "—", "—"],
], minw=720)

COLS = "minmax(180px,1.4fr) minmax(150px,1fr) minmax(160px,1.2fr) minmax(150px,1fr) 150px"
cells = [(f'<div style="font-weight:600">{hv("c.name")}</div><div style="font-size:12px;color:$t3">{hv("c.scope")}</div>', False),
         (f'''{IF("c.isOk", conn("Connected"))}{IF("c.isExp", conn("Expired"))}{IF("c.isPerm", conn("Missing permission"))}{IF("c.isUn", conn("Unavailable"))}''', False),
         (f'<span style="font-size:12.5px;color:$t2">{hv("c.last")}</span>', False),
         (f'<span style="font-size:12.5px;color:$t2">{hv("c.used")}</span>', False),
         (f'<button type="button" class="bs" onClick="{hv("c.act")}" style="{BTN}min-height:30px;padding:0 10px;font-size:12.5px;border:1px solid $bstrong;color:$t1">{hv("c.actLabel")}</button>', False)]
conns = gtable(COLS, ["Connection", "Status", "Last success", "Used for", "Action"], FOR("conns", "c", grow(COLS, cells), 5), minw=860, aria="Connections")

budget = f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px"><div style="font-size:12px;color:$t3">Analysis budget per case</div><div style="font-size:18px;font-weight:600;margin-top:2px">[budget] per month</div><div style="font-size:12.5px;color:$t2;margin-top:4px">Used this month · [used]</div></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px"><div style="font-size:12px;color:$t3">When the budget is reached</div><div style="font-size:13.5px;margin-top:4px">Analysis shows “Stopped — your work is saved”. Calculations and approvals keep working.</div></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px"><div style="font-size:12px;color:$t3">Allowed actions for analysis</div><div style="font-size:13.5px;margin-top:4px">Read permitted sources · propose drafts · run deterministic sizing and economics. Never approve, send or spend.</div></div></div>'''

diag = f'''<details style="border:1px solid $border;border-radius:8px;background:$canvas" open="open">
<summary style="padding:12px 14px;cursor:pointer;font-weight:600;font-size:13.5px;display:flex;gap:8px;align-items:center">{icon("terminal", 15)}Diagnostics · technical details for administrators</summary>
<div style="padding:0 14px 14px;display:flex;flex-direction:column;gap:12px;font-size:13px">
<p style="margin:0;color:$t2">This is the only place that uses infrastructure terms. Traces show structured outputs and tool events, not hidden reasoning.</p>
<dl style="margin:0;display:grid;grid-template-columns:200px 1fr;gap:6px 12px;font-family:$mono;font-size:12.5px">
<dt style="color:$t3">Analysis agent</dt><dd style="margin:0">bounded-analysis v0.3 · 1 agent</dd>
<dt style="color:$t3">Harness version</dt><dd style="margin:0">[harness version]</dd>
<dt style="color:$t3">MCP servers</dt><dd style="margin:0">work-connector (Jira) · connected · intelligence gateway · connected</dd>
<dt style="color:$t3">Model tokens · this month</dt><dd style="margin:0">[tokens used] of [token budget]</dd>
<dt style="color:$t3">Last run · ME-104</dt><dd style="margin:0">run-2610-14-0441 · completed · 14 Oct 10:52</dd></dl>
<div style="overflow-x:auto"><table aria-label="Tool events" style="width:100%;border-collapse:collapse;min-width:620px;font-family:$mono;font-size:12px">
<thead><tr><th scope="col" style="{TH}">Time</th><th scope="col" style="{TH}">Tool call</th><th scope="col" style="{TH}">Scope check</th><th scope="col" style="{TH}">Result</th></tr></thead><tbody>
<tr><td style="{TD}">10:41:03</td><td style="{TD}">intelligence.search</td><td style="{TD}">tenant ✓ · entitlement ✓</td><td style="{TD}">3 documents</td></tr>
<tr><td style="{TD}">10:44:19</td><td style="{TD}">evidence.get SRC-030</td><td style="{TD}">entitlement ✕</td><td style="{TD}">denied · not summarised</td></tr>
<tr><td style="{TD}">10:52:40</td><td style="{TD}">sizing.calculate v1.2</td><td style="{TD}">inputs validated</td><td style="{TD}">SAM 40,000,000 · reproducible</td></tr></tbody></table></div></div></details>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1240px">
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">Administration</h1>
<p style="margin:2px 0 14px;font-size:13px;color:$t2">Aster Industrial Systems · Growth OS workspace · Market Expansion</p>
{banner("lock", "Administrators cannot approve gates.", "You configure approvers, policies and connections. Configuring tools never grants business approval authority, and policy cannot be bypassed from here.", live=False)}
<nav aria-label="Sections" style="display:flex;flex-wrap:wrap;gap:6px 16px;margin:16px 0 4px;font-size:13px">{"".join(f'<a href="#{i}" class="lk" style="text-decoration:none;color:$t2">{t}</a>' for i, t in [("ra", "Roles and authority"), ("gp", "Gate policies"), ("se", "Source entitlements"), ("cn", "Connections"), ("rb", "Run budget"), ("dg", "Diagnostics")])}</nav>
{sec("Delegated authority", "Gate × business unit × ceiling. Ceilings are policy placeholders; the PRD sets none.", card(authority, "overflow:hidden"), "ra")}
{sec("Roles", "Hidden navigation for non-admins; nothing is disabled without a reason", card(roles, "overflow:hidden"), "rl")}
{sec("Gate policies", "Preconditions per gate. Completing tasks never passes a gate.", policies, "gp")}
{sec("Source entitlements", "Restricted sources never reach excerpts, search results or generated summaries", card(ent, "overflow:hidden"), "se")}
{sec("Connections", "Status, scope, last success and a test action", f'<div style="border:1px solid $border;border-radius:8px;overflow:hidden">{conns}</div>', "cn")}
{sec("Run budget", "Business limits for the analysis assistant", budget, "rb")}
{sec("Diagnostics", "", diag, "dg")}
</div>'''

js = logic(r"""    const s = this.state;
    const C = [
      { id: 'md', name: 'Market data portal', scope: 'Read · licensed sources', st: 'ok', last: '9 Oct, 08:00', used: 'Evidence, discovery' },
      { id: 'jr', name: 'Jira · projects PIL, ME-VAL', scope: 'Create and assign issues', st: 'ok', last: '9 Oct, 07:45', used: 'Validation and pilot tasks' },
      { id: 'fx', name: 'Finance export', scope: 'Read spend by cost centre', st: 'exp', last: '1 Oct, 06:00', used: 'Spent-to-date figures' },
      { id: 'cr', name: 'CRM accounts', scope: 'Read authorized accounts', st: 'perm', last: 'Never', used: 'Reachable pool checks' },
      { id: 'tr', name: 'Trade registry', scope: 'Read · company and site records', st: 'un', last: '5 Oct, 22:10', used: 'Opportunity discovery' }
    ];
    const conns = C.map(c => {
      const st = s.fixed[c.id] ? 'ok' : c.st;
      const label = { ok: s.tested[c.id] ? 'Tested · OK' : 'Test', exp: 'Reconnect', perm: 'Request permission', un: 'Retry' }[st];
      return { name: c.name, scope: c.scope, isOk: st === 'ok', isExp: st === 'exp', isPerm: st === 'perm', isUn: st === 'un',
        last: s.fixed[c.id] ? 'Just now' : c.last, used: c.used, actLabel: c.st === 'perm' && s.fixed[c.id] ? 'Test' : label,
        act: () => { if (st === 'ok') this.setState({ tested: Object.assign({}, s.tested, { [c.id]: true }) }); else if (c.st === 'exp') this.setState({ fixed: Object.assign({}, s.fixed, { [c.id]: true }) }); } };
    });
    return { conns };""", "{ fixed: {}, tested: {} }")

page("Admin.dc.html", "Administration", shell("Administration", "Fri 9 Oct 2026", body, user="TA"), js, height=2200, allow_tech=True)
