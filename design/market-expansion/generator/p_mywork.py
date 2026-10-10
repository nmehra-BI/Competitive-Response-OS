from components import *

tabbtn = f'<button type="button" role="tab" onClick="{hv("t.pick")}" aria-selected="{hv("t.on")}" class="tb" style="background:none;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;height:40px;padding:0 2px;font:inherit;font-size:13.5px;cursor:pointer;display:inline-flex;gap:6px;align-items:center;{hv("t.style")}">{hv("t.label")}<span style="font-size:11.5px;padding:0 6px;height:18px;border-radius:999px;background:$ntb;color:$t1;display:inline-flex;align-items:center">{hv("t.n")}</span></button>'
tabs = f'<div role="tablist" aria-label="My Work" style="display:flex;gap:22px;border-bottom:1px solid $border">{FOR("tabs", "t", tabbtn, 3)}</div>'

item = f'''<li><button type="button" onClick="{hv("i.pick")}" aria-pressed="{hv("i.on")}" class="hr" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid $border;padding:12px 14px;font:inherit;cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:4px 12px;{hv("i.style")}">
<span style="font-size:13.5px;font-weight:500;color:$t1">{hv("i.title")}</span><span style="font-size:12.5px;color:$t2;white-space:nowrap">Due {hv("i.due")}</span>
<span style="font-size:12px;color:$t3">{hv("i.sub")}</span><span style="font-size:12.5px;font-weight:500;white-space:nowrap;{hv("i.stStyle")}">{hv("i.status")}</span></button></li>'''

listing = f'''<div style="border:1px solid $border;border-radius:8px;overflow:hidden;background:$surface">
{IF("hasItems", f'<ul style="list-style:none;margin:0;padding:0">{FOR("items", "i", item, 4)}</ul>', True)}
{IF("noItems", f'<div style="padding:40px 20px;text-align:center;display:flex;flex-direction:column;gap:8px;align-items:center"><span style="color:$t2">{icon("scale", 22)}</span><div style="font-size:15px;font-weight:600">No approvals for you</div><p style="margin:0;font-size:13px;color:$t2;max-width:380px">You approve nothing in this workspace. Gate decisions for BU Water are made by Elena Fischer. Owning tasks does not include approval rights.</p></div>')}</div>'''

brief = f'''<aside aria-label="Brief for this task" style="border:1px solid $border;border-radius:8px;background:$surface">
<div style="padding:14px 16px;border-bottom:1px solid $border"><div style="font-size:12px;color:$t3;font-weight:500">Brief for this task</div>
<h2 style="margin:4px 0 0;font-size:17px;line-height:24px;font-weight:600">{hv("b.title")}</h2>
<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:6px;font-size:12.5px;color:$t2">{mono("ME-104", 12)}<span>{hv("b.gate")}</span><span style="color:$okf;display:inline-flex;gap:4px;align-items:center">{icon("link", 13)}<span style="color:$t1">{hv("b.sync")}</span></span></div></div>
<div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;font-size:13.5px">
<div>{eyebrow("Why this task")}<p style="margin:0;font-family:$serif;font-size:15.5px;line-height:24px">{hv("b.why")}</p></div>
<div>{eyebrow("Done looks like")}<p style="margin:0">{hv("b.done")}</p></div>
<div>{eyebrow("Stay inside")}<ul style="margin:0;padding-left:18px;line-height:20px"><li>Up to 4 sites · Germany · 1 Dec 2026 – 28 Feb 2027</li><li>Budget ceiling €120k (G2 v3)</li><li>Outbound messages stay drafts — not authorized to send</li></ul></div>
<div>{eyebrow("Measured against")}<p style="margin:0;color:$t2">{hv("b.thr")}</p></div>
<div>{eyebrow("Ask")}<div style="display:flex;gap:10px;flex-wrap:wrap">{person("MR", "Case owner")}{person("LH", "Specialist conditions")}</div></div>
<div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:12px;border-top:1px solid $border">
{IF("b.canStart", btn("Mark in progress", "s", handler="b.start"), True)}{IF("b.canDone", btn("Mark done", "p", handler="b.finish", ic="check"))}{btn("Report blocker", "s", ic="alert")}{btn("Open pilot plan", "g", href="Pilot.dc.html")}</div>
<p role="status" style="margin:0;font-size:12px;color:$t3">{hv("b.note")}</p></div></aside>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
<div><h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">My Work</h1><p style="margin:2px 0 0;font-size:13px;color:$t2">Jonas Klein · pilot owner · ME-104 pilot day 2 of 90</p></div>
{tabs}
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
<div style="flex:999 1 480px;min-width:0">{listing}</div>
<div style="flex:1 1 360px;min-width:0">{IF("hasItems", brief, True)}</div></div></div>'''

js = logic(r"""    const s = this.state;
    const DATA = {
      tasks: [
        { id: 'k1', title: 'Confirm 4 pilot sites and contacts', sub: 'ME-104 · M1 Kick-off · Sales', due: '4 Dec', gate: 'G2 · v3', sync: 'Confirmed · PIL-11', why: 'The approved pilot is limited to the 4 sites with paid commitments (condition C1). Confirming them starts installation.', done: 'A signed site list with one contact per site, attached to the case.', thr: 'Feeds the paid-use and continuation threshold: 4 of 4 pilot customers.' },
        { id: 'k2', title: 'Weekly deployment-effort log (C2)', sub: 'ME-104 · M2 Run and measure · Operations', due: '7 Dec · weekly', gate: 'G2 · v3 · condition C2', sync: 'Confirmed · PIL-14', why: 'Deployment effort is a decision-critical assumption. Condition C2 asks for a weekly log per site.', done: 'One entry per site per week with hours and blockers.', thr: 'Deployment effort within the assumed [hours per site].' },
        { id: 'k3', title: 'Customer check-ins and renewal-intent interviews', sub: 'ME-104 · M2 Run and measure · Marketing', due: '12 Feb', gate: 'G2 · v3', sync: 'Confirmed · PIL-15', why: 'Renewal intent and buyer fit are part of the day-90 review.', done: 'Interview notes per site in the case.', thr: 'Buyer fit (qualitative) and continuation.' },
        { id: 'k4', title: 'Brief partner on outreach script', sub: 'ME-104 · Validation · Sales', due: '20 Oct', gate: 'G1 · v1', sync: 'Confirmed · VAL-2', why: 'Validation outreach to 20 sites.', done: 'Partner briefed.', thr: 'Interviews ≥ 8 · commitments ≥ 4.', fixed: 'Done' }
      ],
      reviews: [
        { id: 'r1', title: 'Confirm channel reach for Austrian breweries', sub: 'ME-102 · Commercial access review · requested by Maya Rao', due: '9 Dec', gate: 'Review · not a gate decision', sync: 'Internal only', why: 'Maya Rao needs your view on whether the partner reaches Austrian breweries before G1.', done: 'Confirm, dispute or abstain, with a reason.', thr: 'Feeds the reachable-pool assumption for ME-102.' }
      ],
      approvals: []
    };
    const items0 = DATA[s.tab];
    const st = (it) => it.fixed || s.st[it.id] || (it.id === 'k1' ? 'In progress' : 'Not started');
    const SS = { 'Not started': 'color:$t2', 'In progress': 'color:$inf', 'Done': 'color:$okf' };
    const items = items0.map(it => ({ title: it.title, sub: it.sub, due: it.due, status: s.tab === 'reviews' ? 'Awaiting your review' : st(it), stStyle: s.tab === 'reviews' ? 'color:$inf' : SS[st(it)],
      on: s.sel === it.id ? 'true' : 'false', style: s.sel === it.id ? 'background:$accbg;' : '', pick: () => this.setState({ sel: it.id }) }));
    const cur = items0.find(it => it.id === s.sel) || items0[0];
    let b = null;
    if (cur) {
      const cst = st(cur);
      b = Object.assign({}, cur, { canStart: s.tab === 'tasks' && cst === 'Not started', canDone: s.tab === 'tasks' && cst === 'In progress',
        start: () => this.setState({ st: Object.assign({}, s.st, { [cur.id]: 'In progress' }) }),
        finish: () => this.setState({ st: Object.assign({}, s.st, { [cur.id]: 'Done' }) }),
        note: cst === 'Done' ? 'Done. Completing tasks does not pass a gate.' : 'Status syncs to Jira; the case stays the source of truth.' });
    }
    const counts = { tasks: DATA.tasks.length, reviews: DATA.reviews.length, approvals: 0 };
    return {
      tabs: [['tasks', 'Tasks'], ['reviews', 'Reviews'], ['approvals', 'Approvals']].map(t => ({ label: t[1], n: counts[t[0]], on: s.tab === t[0] ? 'true' : 'false',
        style: s.tab === t[0] ? 'color:$t1;font-weight:500;border-bottom-color:$t1;' : 'color:$t2;',
        pick: () => this.setState({ tab: t[0], sel: t[0] === 'reviews' ? 'r1' : 'k1' }) })),
      items, hasItems: items.length > 0, noItems: items.length === 0, b: b || { title: '', gate: '', sync: '', why: '', done: '', thr: '', note: '', canStart: false, canDone: false }
    };""", "{ tab: 'tasks', sel: 'k1', st: {} }")

page("MyWork.dc.html", "My Work", shell("My Work", "Wed 2 Dec 2026", body, user="JK", counts={"My Work": "4"}), js, height=1400)
