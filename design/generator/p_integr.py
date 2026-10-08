from common import *

TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 12px;height:36px;border-bottom:1px solid $border;white-space:nowrap;background:$canvas"
TD = "padding:12px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px"


def stat(kind):
    m = {"Connected": ("checkcircle", "$okf"), "Active": ("checkcircle", "$okf"), "Not connected": ("dashcircle", "$t2"), "Stale": ("clock", "$wnf"), "Limited": ("halfcircle", "$wnf")}
    i, c = m[kind]
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:{c};white-space:nowrap">{icon(i, 15)}{kind}</span>'


jira_status = (f'<sc-if value="{{{{ jIdle }}}}" hint-placeholder-val="{{{{ true }}}}">{stat("Connected")}</sc-if>'
               f'<sc-if value="{{{{ jChecking }}}}" hint-placeholder-val="{{{{ false }}}}">{sync("Checking")}</sc-if>'
               f'<sc-if value="{{{{ jOk }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display:inline-flex;flex-direction:column;gap:2px">{stat("Connected")}<span style="font-size:12px;color:$okf">Access confirmed · just now</span></span></sc-if>')
CONN = [
    ("Jira Cloud", "Task destination", jira_status, "<b style=\"font-weight:500\">Write:</b> create issues in project NSD only<br><b style=\"font-weight:500\">Read:</b> issue status", "15 Oct, 09:06", "NSD · Task",
     f'<button type="button" class="bs" onClick="{{{{ testJira }}}}" style="height:32px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;color:$t1">Test access</button>'),
    ("Portfolio CSV import", "Products and accounts", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{stat("Active")}<span style="font-size:12px;color:$wnf;display:inline-flex;gap:4px;align-items:center">{icon("clock", 12)}Snapshot 16 days old</span></span>', "Read only · values restricted by account scope", "Snapshot 30 Sep 2026 · imported 1 Oct", "—", btn("Import snapshot", "s", href="Watchlists.dc.html", extra="height:32px;font-size:12.5px")),
    ("Curated public sources", "Press, trade media, product pages", stat("Active"), "Read only", "16 Oct, 08:00", "—", btn("Test access", "s", extra="height:32px;font-size:12.5px")),
    ("Licensed market intelligence", "Reports and market context", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{stat("Limited")}<span style="font-size:12px;color:$t2">Title-only citations · no excerpts</span></span>', "Read only · entitlement excludes excerpts", "16 Oct, 06:30", "—", btn("Review entitlement", "s", extra="height:32px;font-size:12.5px")),
    ("CRM", "Opportunities and accounts", stat("Not connected"), "Planned: read only (next release)", "—", "—", '<span style="font-size:12.5px;color:$t3">Exposure uses CSV snapshots</span>'),
    ("Microsoft Teams", "Notifications", stat("Not connected"), "Planned: post to approved channels after plan authorization", "—", "—", '<span style="font-size:12.5px;color:$t3">Next release</span>'),
]
crow = "".join(f'<tr class="hr"><td style="{TD}"><div style="font-weight:500">{a}</div><div style="font-size:12px;color:$t3">{b}</div></td><td style="{TD}">{c}</td><td style="{TD};color:$t2">{d}</td><td style="{TD};white-space:nowrap">{e}</td><td style="{TD};font-family:$mono;font-size:12.5px">{f}</td><td style="{TD}">{g}</td></tr>' for a, b, c, d, e, f, g in CONN)
conns = f'''<section aria-label="Connections">{h2("Connections", "Health, scope and freshness for each data source and destination.")}
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:1000px"><thead><tr><th scope="col" style="{TH}">Integration</th><th scope="col" style="{TH}">Status</th><th scope="col" style="{TH}">Read / write scope</th><th scope="col" style="{TH}">Last successful sync</th><th scope="col" style="{TH}">Authorized destinations</th><th scope="col" style="{TH}"><span style="position:absolute;left:-9999px">Action</span></th></tr></thead><tbody>{crow}</tbody></table></div></section>'''

ok = lambda n: f'<span style="display:inline-flex;align-items:center;gap:5px;color:$okf;font-size:12.5px;font-weight:500">{icon("checkcircle", 13)}<span style="color:$t1;font-weight:400">{n}</span></span>'
esc = f'<span style="display:inline-flex;align-items:center;gap:5px;color:$wnf;font-size:12.5px;font-weight:500">{icon("arrowr", 13)}<span style="color:$t1;font-weight:400">Escalate · [product leadership]</span></span>'
gap = f'<span style="display:inline-flex;align-items:center;gap:5px;color:$dgf;font-size:12.5px;font-weight:600">{icon("alert", 13)}Gap · no approver</span>'
COV = [("Diagnostics · Germany", ok("Elena Fischer"), ok("Elena Fischer"), esc, gap),
       ("Diagnostics · Austria", ok("Elena Fischer"), ok("Elena Fischer"), esc, gap),
       ("Diagnostics · Switzerland", ok("Elena Fischer"), ok("Elena Fischer"), esc, gap)]
cov = "".join(f'<tr><th scope="row" style="{TD};text-align:left;font-weight:500">{a}</th><td style="{TD}">{b}</td><td style="{TD}">{c}</td><td style="{TD}">{d}</td><td style="{TD}">{e}</td></tr>' for a, b, c, d, e in COV)
MEM = [("MP", "Maya Patel", "CI lead", "Diagnostics", "Triage signals · edit analyses · propose responses · authorize plan release"),
       ("EF", "Elena Fischer", "Approver", "Diagnostics · DE, AT, CH", "Approve positioning and account review responses"),
       ("JW", "Jonas Weber", "Task owner", "Diagnostics", "Own assigned deliverables · no approval rights"),
       ("SK", "Sofia Klein", "Task owner · account data", "Germany accounts", "Own assigned deliverables · view Germany account rows"),
       ("PM", "[ND-200 product manager]", "Task owner", "Diagnostics", "Own assigned deliverables"),
       ("WA", "[Workspace admin]", "Administrator", "Workspace", "Configure data, roles and integrations · cannot approve responses")]
mem = "".join(f'<tr class="hr"><td style="{TD}"><div style="display:flex;gap:10px;align-items:center"><span aria-hidden="true" style="width:26px;height:26px;border-radius:50%;background:$ntb;font-size:10.5px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">{i}</span><span style="font-weight:500">{n}</span></div></td><td style="{TD}">{r}</td><td style="{TD}">{sc}</td><td style="{TD};color:$t2">{p}</td></tr>' for i, n, r, sc, p in MEM)
roles = f'''<section aria-label="Roles and approver coverage">{h2("Roles and approver coverage", "Permissions are role assignments scoped by business unit, geography and response type.")}
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:860px"><caption style="text-align:left;padding:12px;font-size:13.5px;font-weight:600;border-bottom:1px solid $border">Approver coverage · response type × scope</caption>
<thead><tr><th scope="col" style="{TH}">Scope</th><th scope="col" style="{TH}">Positioning</th><th scope="col" style="{TH}">Account review</th><th scope="col" style="{TH}">Product assessment</th><th scope="col" style="{TH}">Pricing</th></tr></thead><tbody>{cov}</tbody></table></div>
<p style="margin:8px 0 16px;font-size:12.5px;color:$t2;display:flex;gap:6px;align-items:center">{icon("info", 14)}Pricing responses need a designated commercial authority. Until one is assigned, pricing options can be assessed but not approved.</p>
<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:860px"><thead><tr><th scope="col" style="{TH}">Person</th><th scope="col" style="{TH}">Role</th><th scope="col" style="{TH}">Scope</th><th scope="col" style="{TH}">Can do</th></tr></thead><tbody>{mem}</tbody></table></div></section>'''

audit = f'''<section aria-label="Audit history">{h2("Audit history", "Append-only. Every consequential action with actor, object version and time.", '<div role="group" aria-label="Filter" style="display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas"><sc-for list="{{ filters }}" as="f" hint-placeholder-count="3"><button type="button" onClick="{{ f.pick }}" aria-pressed="{{ f.on }}" style="{{ f.style }}">{{ f.label }}</button></sc-for></div>')}
<div style="border:1px solid $border;border-radius:8px">
<sc-for list="{{{{ events }}}}" as="e" hint-placeholder-count="6"><div class="hr" style="display:flex;flex-wrap:wrap;gap:4px 16px;padding:10px 14px;border-bottom:1px solid $border;font-size:13px;align-items:baseline">
<span style="width:110px;flex:none;color:$t3;font-size:12.5px">{{{{ e.when }}}}</span><span style="width:150px;flex:none;font-weight:500">{{{{ e.actor }}}}</span><span style="flex:1 1 300px;min-width:0">{{{{ e.text }}}}</span><span style="font-family:$mono;font-size:12px;color:$t2">{{{{ e.ref }}}}</span></div></sc-for>
<div style="padding:10px 14px;font-size:12.5px;color:$t3">{{{{ auditFoot }}}}</div></div></section>'''

policy = f'''<section aria-label="Retention and analysis policy">{h2("Retention and analysis policy")}
<ul style="list-style:none;margin:0;padding:0;border:1px solid $border;border-radius:8px;font-size:13px">
{"".join(f'<li style="display:flex;flex-wrap:wrap;gap:4px 16px;padding:12px 14px;border-bottom:1px solid $border"><span style="width:260px;font-weight:500">{a}</span><span style="flex:1 1 300px;color:$t2">{b}</span></li>' for a, b in [
    ("Analysis output", "Drafts only. Every AI draft keeps its provenance label until a person accepts or edits it."),
    ("External writes", "Only after an approved response and an authorized plan version. Checked again at the moment of sending."),
    ("Restricted commercial data", "Never shown in notifications, search or exports outside the viewer’s scope."),
    ("Retention", "[Per pilot contract] · audit history is never edited")])}</ul></section>'''

content = f'''<div style="max-width:1160px;padding:20px 24px 40px;display:flex;flex-direction:column;gap:28px">
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end"><div style="flex:1 1 400px;min-width:0"><h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">Integrations and settings</h1>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Is everything connected safely, and who can do what?</p></div></div>
{banner("neutral", "You can configure approvers and integrations but cannot approve responses.", "Administrator rights don’t include business approval authority.")}
{conns}{roles}{audit}{policy}</div>'''

logic = r'''class Component extends DCLogic {
  state = { j: 'idle', f: 'all' };
  componentWillUnmount() { clearTimeout(this.t); }
  renderVals() {
    const s = this.state;
    const segB = (on) => 'height:26px;padding:0 10px;border-radius:4px;border:0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms;' + (on ? 'background:$surface;color:$t1;font-weight:500;box-shadow:0 0 0 1px $border;' : 'background:transparent;color:$t2;');
    const E = [
      { t: 'write', when: '15 Oct, 09:06', actor: 'Maya Patel', text: 'Retried T-03 · Jira issue confirmed · same request ID reused', ref: 'NSD-414' },
      { t: 'write', when: '15 Oct, 09:01', actor: 'System', text: 'Jira create failed for T-03 (timeout) · no issue created', ref: 'T-03' },
      { t: 'write', when: '15 Oct, 09:00', actor: 'Maya Patel', text: 'Authorized plan v1 under approval v3 · 4 Jira writes requested', ref: 'plan v1' },
      { t: 'appr', when: '14 Oct, 15:10', actor: 'Elena Fischer', text: 'Approved decision package v3 · rationale and constraints recorded', ref: '7c1e·94ab' },
      { t: 'appr', when: '14 Oct, 10:42', actor: 'Maya Patel', text: 'Submitted decision package v3', ref: 'v3' },
      { t: 'appr', when: '13 Oct, 09:30', actor: 'Elena Fischer', text: 'Requested changes on decision package v2', ref: '3b90·1f2d' },
      { t: 'config', when: '1 Oct, 10:20', actor: 'Maya Patel', text: 'Created portfolio snapshot 30 Sep 2026 from CSV', ref: 'snapshot' },
      { t: 'config', when: '1 Oct, 09:30', actor: '[Workspace admin]', text: 'Set Jira write scope to project NSD only', ref: 'jira' }
    ];
    const F = [['all', 'All'], ['appr', 'Decisions'], ['write', 'External writes'], ['config', 'Configuration']];
    const events = E.filter(e => s.f === 'all' || e.t === s.f);
    return {
      jIdle: s.j === 'idle', jChecking: s.j === 'checking', jOk: s.j === 'ok',
      testJira: () => { this.setState({ j: 'checking' }); clearTimeout(this.t); this.t = setTimeout(() => this.setState({ j: 'ok' }), 1100); },
      filters: F.map(([k, l]) => ({ label: l, on: s.f === k ? 'true' : 'false', style: segB(s.f === k), pick: () => this.setState({ f: k }) })),
      events, auditFoot: 'Showing ' + events.length + ' of ' + E.length + ' events for CR-1042 and workspace setup'
    };
  }
}'''

page("Integrations.dc.html", "Integrations", shell("Integrations", "Fri 16 Oct 2026, 10:00", content, user=("[Workspace admin]", "Administrator · no approval rights", "WA")), logic, height=1700)
