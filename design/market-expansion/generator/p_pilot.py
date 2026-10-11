from components import *

hdr = lambda st, title, sub: case_header("Pilot", stage(st), 3, G_PILOT, next_block(title, sub, "JK"), "Evidence checked 3 days ago · current")
headers = IF("hReady", hdr("Pilot approved", "Activate approved pilot plan", "Jonas Klein · today, 1 Dec"), True) + IF("hRun", hdr("Pilot running", "Day-90 pilot review", "Elena Fischer decides · due 3 Mar 2027"))

baseline = f'''<section aria-labelledby="bl" style="border:1px solid $t1;border-radius:8px;padding:14px 16px;background:$surface">
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center">{icon("lock", 15)}<h2 id="bl" style="margin:0;font-size:14px;font-weight:600">Approved baseline · pinned</h2>{gate_chip("approvedc", "G2 · Approved with conditions · 27 Nov")}<span style="font-size:12.5px;color:$t2">Snapshot v3 · {mono("7F3A·19C2", 12)}</span></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 18px;margin-top:12px;font-size:13px">
<div><div style="color:$t3;font-size:12px">Budget ceiling</div><b style="font-weight:600;font-size:16px">€120k</b></div>
<div><div style="color:$t3;font-size:12px">Window</div><b style="font-weight:600">90 days</b> · 1 Dec 2026 – 28 Feb 2027</div>
<div><div style="color:$t3;font-size:12px">Scope</div>Up to 4 sites · Germany · food processing</div>
<div><div style="color:$t3;font-size:12px">Thresholds (pre-registered)</div>Paid use and continuation: 4 of 4 · Deployment effort within [hours per site]</div></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px;margin-top:12px">{condition("C1", "Pilot limited to 4 sites as signed by the specialist", "Jonas Klein", "1 Dec", True, "Met")}{condition("C2", "Log deployment effort per site every week", "Jonas Klein", "Weekly", False)}</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">{btn("Request scope change", "s", ic="pencil")}{btn("Report blocker", "s", ic="alert")}<span style="font-size:12px;color:$t3;align-self:center">Changing budget, sites or dates needs a new authorization.</span></div></section>'''

budget = f'''<section aria-labelledby="bg" style="border:1px solid $border;border-radius:8px;padding:14px 16px">
<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline"><h2 id="bg" style="margin:0;font-size:14px;font-weight:600">Budget · G2 · v3</h2><span style="font-size:12px;color:$t3">As of 1 Dec 2026 · EUR</span></div>
<div role="img" aria-label="Approved 120k, committed 0k, spent 0k, remaining 120k" style="display:flex;height:10px;border-radius:5px;overflow:hidden;background:$sunken;margin:12px 0 10px;border:1px solid $border"><span style="width:0%;background:$t1"></span><span style="width:0%;background:$ctrl"></span></div>
<dl style="margin:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;font-size:13px">
<div><dt style="color:$t3;font-size:12px">Approved</dt><dd style="margin:0;font-weight:600;font-size:16px">€120k</dd></div>
<div><dt style="color:$t3;font-size:12px">Committed</dt><dd style="margin:0;font-weight:600;font-size:16px">€0k</dd></div>
<div><dt style="color:$t3;font-size:12px">Spent</dt><dd style="margin:0;font-weight:600;font-size:16px">€0k</dd></div>
<div><dt style="color:$t3;font-size:12px">Remaining</dt><dd style="margin:0;font-weight:600;font-size:16px">€120k</dd></div></dl>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Day 0. Spend above €120k is blocked without a scope-change request.</p></section>'''

COLS = "minmax(220px,2fr) 100px minmax(140px,1.1fr) 90px 80px minmax(130px,1fr) minmax(170px,1.3fr)"
cells = [
    (f'<div style="font-weight:500">{hv("t.name")}</div><div style="font-size:12px;color:$t3;margin-top:2px">{hv("t.ms")}</div>', False),
    (f'<span style="font-size:12.5px;color:$t2">{hv("t.fn")}</span>', False),
    (f'<span style="font-size:13px;{hv("t.ownerSt")}">{hv("t.owner")}</span>', False),
    (f'<span style="font-size:12.5px;color:$t2">{hv("t.dep")}</span>', False),
    (f'<span style="font-size:12.5px;color:$t2">{hv("t.due")}</span>', False),
    (f'<span style="font-size:12.5px">{hv("t.del")}</span>', False),
    (f'''<span style="display:inline-flex;gap:6px;align-items:center;font-size:13px;font-weight:500;{hv("t.syncSt")}">{IF("t.ok", icon("link", 14))}{IF("t.fail", icon("xcircle", 14))}{IF("t.wait", icon("dashcircle", 14))}<span>{hv("t.sync")}</span></span>{IF("t.fail", f'<div style="font-size:12px;color:$t2;margin-top:2px">{hv("t.err")}</div>')}''', False)]
tasks = gtable(COLS, ["Task · milestone", "Function", "Owner", "Depends on", "Due", "Deliverable", "External sync"], FOR("tasks", "t", grow(COLS, cells, "t.rowSt"), 6), minw=1040, aria="Pilot tasks")

preview = f'''<section aria-labelledby="pv" style="border:1px solid $inf;border-radius:8px;padding:14px 16px;background:$surface;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;gap:8px;align-items:center">{icon("eye", 16, "$inf")}<h2 id="pv" style="margin:0;font-size:14px;font-weight:600">Preview · nothing has been sent</h2></div>
<dl style="margin:0;display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px">
<dt style="color:$t3">Destination</dt><dd style="margin:0">Jira · project {mono("PIL", 12.5, "$t1")} · Aster Pilots</dd>
<dt style="color:$t3">Will create</dt><dd style="margin:0">6 issues, each linked to ME-104 · G2 v3</dd>
<dt style="color:$t3">Assignees</dt><dd style="margin:0">Matched by directory: Jonas Klein, Priya Shah, Maya Rao, [Operations lead]</dd>
<dt style="color:$t3">Permissions</dt><dd style="margin:0">Create and assign issues · as Jonas Klein</dd>
<dt style="color:$t3">Repeats</dt><dd style="margin:0">Each task has a fixed reference; retrying never duplicates</dd></dl>
<div style="display:flex;gap:8px;flex-wrap:wrap">{btn("Create 6 tasks in Jira", "p", handler="create", ic="send")}{btn("Back", "g", handler="back")}</div></section>'''

drafts = f'''<section aria-labelledby="om" style="border:1px solid $border;border-radius:8px;padding:14px 16px">
<h2 id="om" style="margin:0 0 8px;font-size:14px;font-weight:600">Outbound messages</h2>
<div style="border:1px dashed $ctrl;border-radius:8px;padding:12px 14px;background:$canvas">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">{icon("mail", 15, "$t2")}<b style="font-weight:600;font-size:13.5px">Welcome note to the 4 pilot site contacts</b><span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$wnb;color:$wnf;font-size:12px;font-weight:600">{icon("lock", 12)}Draft — not authorized to send</span>{ai("AI draft")}</div>
<p style="margin:8px 0 0;font-family:$serif;font-size:15px;line-height:24px;color:$t2">“Thank you for joining the 90-day monitoring pilot. Your site lead will contact you to schedule installation…”</p>
<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">{btn("Edit draft", "s", ic="pencil")}{btn("Send", "s", disabled=True)}<span style="font-size:12px;color:$t3;align-self:center">Task authorization does not authorize sending prospect communications.</span></div></div></section>'''

actions = f'''<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
{IF("canActivate", btn("Activate approved plan", "p", handler="activate", ic="rocket"), True)}
{IF("activateBlocked", btn("Activate approved plan", "p", disabled=True))}
{IF("canPreview", btn("Preview tasks", "p", handler="preview", ic="eye"))}
{IF("canRetry", f'<button type="button" class="bp" onClick="{hv("retry")}" style="{BTN}border:1px solid $acc;color:#fff">{icon("refresh", 15)}Retry 1 failed task</button>')}
{IF("expired", btn("Export CSV instead", "s", ic="download"))}
<span role="status" aria-live="polite" style="font-size:13px;color:$t2">{hv("actionNote")}</span></div>'''

body = f'''{proto_bar([("Variant", "varBtns")])}
<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
{IF("expired", banner("warn", "Jira connection expired · 30 Nov", "Internal tasks stay active and tracked here. Ask your administrator to reconnect, or export CSV.", btn("Connection status", "s", href="Admin.dc.html")))}
{IF("noOwner", banner("warn", "Missing owner blocks activation", "“Install monitoring at 4 sites” has no accountable owner. Assign one to activate the plan."))}
{IF("isPartial", banner("danger", "5 of 6 tasks confirmed in Jira · 1 failed", "“Install monitoring at 4 sites”: assignee [Operations lead] is not a member of project PIL. Nothing was duplicated. Retry only the failed task after the permission is fixed.", btn("Retry 1 failed task", "s", handler="retry")))}
{IF("isDone", banner("ok", "6 of 6 tasks confirmed in Jira", "Each issue links back to ME-104 · G2 v3. Task completion does not pass any gate."))}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px">{baseline}{budget}</div>
{actions}
{IF("isPreview", preview)}
{h2("Milestones and tasks", "Product · sales · marketing · operations · review. Internal status is separate from external sync.")}
<div style="border:1px solid $border;border-radius:8px;overflow:hidden">{tasks}</div>
{drafts}
</div>'''

js = logic(r"""    const s = this.state;
    const T = [
      ['Confirm 4 pilot sites and contacts', 'M1 · Kick-off · weeks 1–2', 'Sales', 'Jonas Klein', '—', '4 Dec', 'Signed site list'],
      ['Install monitoring at 4 sites', 'M1 · Kick-off · weeks 1–2', 'Operations', s.v === 'noowner' ? 'Unassigned' : '[Operations lead]', 'Task 1', '18 Dec', 'Install reports'],
      ['Adapt dashboards for food-processing workflow', 'M1 · Kick-off · weeks 1–2', 'Product', 'Priya Shah', '—', '11 Dec', 'Adaptation list v1'],
      ['Weekly deployment-effort log (C2)', 'M2 · Run and measure · weeks 3–12', 'Operations', 'Jonas Klein', 'Task 2', 'Weekly', 'Effort log per site'],
      ['Customer check-ins and renewal-intent interviews', 'M2 · Run and measure · weeks 3–12', 'Marketing', 'Jonas Klein', 'Task 2', '12 Feb', 'Interview notes'],
      ['Day-90 review pack against thresholds', 'M3 · Review · week 13', 'Strategy', 'Maya Rao', 'Tasks 4, 5', '3 Mar 2027', 'Review pack']
    ];
    const ph = s.phase, v = s.v;
    const tasks = T.map((t, i) => {
      let sync = 'Not sent', ok = false, fail = false, err = '';
      if (ph === 'preview') sync = 'In preview';
      if (ph === 'partial') { if (i === 1) { sync = 'Failed'; fail = true; err = 'Permission: assignee not in project'; } else { sync = 'Confirmed · PIL-' + (11 + i); ok = true; } }
      if (ph === 'done') { sync = 'Confirmed · PIL-' + (11 + i); ok = true; }
      if (v === 'expired' && ph !== 'partial' && ph !== 'done') sync = 'Not sent · connection expired';
      return { name: t[0], ms: t[1], fn: t[2], owner: t[3], dep: t[4], due: t[5], del: t[6], sync, ok, fail, wait: !ok && !fail,
        ownerSt: t[3] === 'Unassigned' ? 'color:$wnf;font-weight:600' : '',
        syncSt: ok ? 'color:$okf' : fail ? 'color:$dgf' : ph === 'preview' ? 'color:$inf' : 'color:$t2',
        rowSt: fail ? 'background:$dgb' : (t[3] === 'Unassigned' ? 'background:$wnb' : '') };
    });
    const active = ph !== 'ready';
    const notes = { ready: v === 'noowner' ? 'Assign an owner to every task to activate.' : 'Activation starts the pilot window. It does not create external tasks.',
      active: v === 'expired' ? 'Plan active. External task creation is unavailable until Jira is reconnected.' : 'Plan active · 1 Dec, 09:30. Preview before writing to Jira.',
      preview: 'Review destination, assignees and permissions.', partial: '5 confirmed · 1 failed · retry affects only the failed task.', done: 'All tasks confirmed · 1 Dec, 09:41.' };
    return {
      varBtns: this.seg([['normal', 'Normal'], ['expired', 'Expired connector'], ['noowner', 'Missing owner']], 'v').map(b => Object.assign(b, { pick: () => this.setState({ v: b.label === 'Normal' ? 'normal' : b.label === 'Expired connector' ? 'expired' : 'noowner', phase: 'ready' }) })),
      hReady: !active, hRun: active, tasks,
      canActivate: ph === 'ready' && v !== 'noowner', activateBlocked: ph === 'ready' && v === 'noowner',
      canPreview: ph === 'active' && v !== 'expired', canRetry: ph === 'partial', isPreview: ph === 'preview', isPartial: ph === 'partial', isDone: ph === 'done',
      expired: v === 'expired', noOwner: v === 'noowner',
      activate: () => this.setState({ phase: 'active' }), preview: () => this.setState({ phase: 'preview' }), back: () => this.setState({ phase: 'active' }),
      create: () => this.setState({ phase: 'partial' }), retry: () => this.setState({ phase: 'done' }),
      actionNote: notes[ph]
    };""", "{ phase: 'ready', v: 'normal' }")

page("Pilot.dc.html", "Pilot Execution", shell("Expansion Cases", "Tue 1 Dec 2026", headers + body, user="JK", counts={"My Work": "4"}, autosave="Saved · just now"), js, height=2000)
