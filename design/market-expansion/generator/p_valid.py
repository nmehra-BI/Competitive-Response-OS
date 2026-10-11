from components import *

INP = "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"
nxt = next_block(hv("nextTitle"), hv("nextSub"), "MR")
header = case_header("Validation", stage("Validation"), 2, G_VALID, nxt, "Evidence checked today · 1 source ageing", {"Validation": "1 disputed", "Feasibility": "1 pending"})

REG = [
    ("Test first", "High sensitivity, weak or no evidence", [
        ("a1", "Adoption 20% by year 3", "MR", "High", "Weak", "Paid commitments, then pilot", "EXP-03", "20 Nov", "st_a1", True, "SOM and economics fall to Downside or below"),
        ("a2", "Customers pay €20k annually", "MR", "High", "Weak", "Paid pilot offer · interviews", "EXP-03", "20 Nov", "st_a2", False, "Revise pricing and contribution model"),
        ("a4", "Specialist requirements can be met", "LH", "High", "None", "Qualified legal/regulatory review", "—", "20 Nov", "st_a4", False, "Block pilot or constrain scope")]),
    ("Test next", "Evidence exists but is partial", [
        ("a5", "Existing product fits target workflow", "PS", "High", "Some", "Demos · deployment trial", "EXP-04", "21 Oct", "st_a5", False, "Add adaptation cost or stop"),
        ("a3", "Channel reaches 500 unique sites", "JK", "Medium", "Some", "Partner list verification", "—", "30 Oct", "st_a3", False, "Reduce reachable pool and SOM")]),
    ("Monitor", "Lower sensitivity", [
        ("a6", "Capacity 120 customers", "OL", "Medium", "Some", "Operations capacity model", "—", "23 Oct", "st_a6", False, "Cap SOM and scale budget")]),
]
COLS = "minmax(190px,1.6fr) minmax(120px,1fr) 92px 104px minmax(140px,1.2fr) 80px 120px"
reg = ""
for g, gsub, items in REG:
    reg += f'<div role="row" style="display:flex;gap:8px;align-items:baseline;padding:8px 12px;background:$canvas;border-bottom:1px solid $border"><span role="rowheader" style="font-size:12.5px;font-weight:600">{g}</span><span style="font-size:12px;color:$t3">{gsub}</span></div>'
    for k, name, owner, sens_, q, method, exp, due, st, disputed, cons in items:
        who = PEOPLE.get(owner, ("[Operations lead]", ""))[0]
        dis = f'<button type="button" onClick="{hv("openDispute")}" style="background:none;border:0;padding:0;margin-top:4px;font:inherit;font-size:12px;color:$wnf;font-weight:500;cursor:pointer;display:inline-flex;gap:4px;align-items:center">{icon("message", 12)}Disputed by Daniel Weber</button>' if disputed else ""
        cells = [(f'<div style="display:flex;gap:6px;align-items:flex-start"><span style="color:$asf;margin-top:2px">{icon("pencilruler", 14)}</span><div><div style="font-weight:600">{name}</div><div style="font-size:12px;color:$t3">If false: {cons}</div>{dis}</div></div>', False),
                 (f'<span style="font-size:12.5px">{who}</span>', False), (sens(sens_), False), (evq(q), False),
                 (f'<span style="font-size:12.5px;color:$t2">{method}</span>', False),
                 (mono(exp, 12, "$t1") if exp != "—" else '<span style="color:$t3">—</span>', False),
                 (f'<div style="font-size:12.5px">{hv(st)}</div><div style="font-size:12px;color:$t3">Due {due}</div>', False)]
        reg += grow(COLS, cells, "rs_" + k)
register = gtable(COLS, ["Assumption", "Owner", "Sensitivity", "Evidence", "Validation method", "Experiment", "Status"], reg, minw=900, aria="Assumption register")

two = f'''<div style="display:grid;grid-template-columns:28px 1fr 1fr;grid-template-rows:auto auto 24px;gap:6px">
<div style="grid-row:1/3;writing-mode:vertical-rl;transform:rotate(180deg);font-size:12px;color:$t3;text-align:center">Decision sensitivity →</div>
<div style="border:1px solid $border;border-radius:6px;padding:10px;min-height:110px;background:$wnb"><div style="font-size:12px;font-weight:600;color:$wnf;margin-bottom:6px">Test first · high, weak evidence</div><div style="display:flex;flex-wrap:wrap;gap:6px">{assumption_chip("Adoption 20%", "Maya Rao", True)}{assumption_chip("€20k price", "Maya Rao")}{assumption_chip("Specialist reqs", "Lena Hoffmann")}</div></div>
<div style="border:1px solid $border;border-radius:6px;padding:10px;min-height:110px"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:6px">Test next · high, some evidence</div><div style="display:flex;flex-wrap:wrap;gap:6px">{assumption_chip("Product fit", "Priya Shah")}</div></div>
<div style="border:1px solid $border;border-radius:6px;padding:10px;min-height:80px"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:6px">Watch · lower, weak evidence</div></div>
<div style="border:1px solid $border;border-radius:6px;padding:10px;min-height:80px"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:6px">Monitor · lower, some evidence</div><div style="display:flex;flex-wrap:wrap;gap:6px">{assumption_chip("Channel 500", "Jonas Klein")}{assumption_chip("Capacity 120", "[Operations lead]")}</div></div>
<div></div><div style="grid-column:2/4;font-size:12px;color:$t3;text-align:center">Evidence quality: weak → strong</div></div>'''

dispute = f'''<section aria-labelledby="dp" style="border:1px solid $wnf;border-radius:8px;background:$surface">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid $border">{icon("message", 16, "$wnf")}<h2 id="dp" style="margin:0;font-size:14px;font-weight:600">Dispute · Adoption 20% by year 3</h2><span style="font-size:12.5px;color:$t2">Open · stays until resolved with a reason</span>
<button type="button" class="bg" aria-label="Close dispute" onClick="{hv("closeDispute")}" style="margin-left:auto;width:32px;height:32px;border:0;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:$t2">{icon("x", 16)}</button></div>
<div style="padding:14px;display:flex;flex-direction:column;gap:12px">
{dissent("DW", "I do not see comparable evidence for 20% adoption in this segment. Our installed base shows lower uptake in new segments. Plan on 10% until the pilot shows paid use.", "14 Oct, 10:02", "Proposes Downside adoption 10% · affects SOM, Economics, G2 package")}
<div style="display:flex;gap:10px">{avatar("MR", 24)}<div style="font-size:13.5px;line-height:20px"><b style="font-weight:600">Maya Rao</b> <span style="color:$t3;font-size:12px">14 Oct, 11:30</span><p style="margin:2px 0 0">Keeping 20% as Base and adding your 10% as Downside. EXP-03 and the pilot test it; the dissent goes into every package.</p></div></div>
{FOR("replies", "r", f'<div style="display:flex;gap:10px">{avatar("MR", 24)}<div style="font-size:13.5px;line-height:20px"><b style="font-weight:600">Maya Rao</b> <span style="color:$t3;font-size:12px">{hv("r.when")}</span><p style="margin:2px 0 0">{hv("r.text")}</p></div></div>', 1)}
<label for="rp" style="font-size:12.5px;font-weight:500">Reply<textarea id="rp" rows="2" value="{hv("reply")}" onChange="{hv("setReply")}" style="{INP};margin-top:6px"></textarea></label>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="bd" onClick="{hv("sendReply")}" disabled="{hv("noReply")}" style="{BTN}border:1px solid $t1;color:#fff">Reply</button>{btn("Resolve with reason", "s", disabled=True)}<span style="font-size:12px;color:$t3;align-self:center">Only Daniel Weber or the sponsor can resolve this dispute.</span></div></div></section>'''

tasks_preview = f'''<div style="border:1px solid $border;border-radius:8px;overflow:hidden">
<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:10px 14px;background:$canvas;border-bottom:1px solid $border;font-size:12.5px"><b style="font-weight:600;font-size:13px">{hv("taskTitle")}</b><span style="color:$t2">Destination Jira · project ME-VAL · assignees mapped by email · permission: create issues</span></div>
<ul style="list-style:none;margin:0;padding:0">{FOR("tasks", "t", f'<li style="display:grid;grid-template-columns:minmax(200px,2fr) minmax(110px,1fr) 70px 170px;gap:8px;padding:9px 14px;border-bottom:1px solid $border;font-size:13px;align-items:center"><span>{hv("t.name")}</span><span style="color:$t2">{hv("t.owner")}</span><span style="color:$t2">{hv("t.due")}</span><span style="display:inline-flex;gap:6px;align-items:center;font-weight:500;{hv("t.st")}">{hv("t.sync")}</span></li>', 5)}</ul>
<div style="display:flex;gap:8px;flex-wrap:wrap;padding:10px 14px;align-items:center">{IF("canPreview", btn("Preview tasks", "p", handler="preview", ic="eye"), True)}{IF("canCreate", btn("Create 5 tasks in Jira", "p", handler="create", ic="send") + btn("Cancel", "g", handler="cancelPrev"))}
<span role="status" style="font-size:12.5px;color:$t2">{hv("taskNote")}</span></div></div>'''

plan_rows = table(["Metric", ">Threshold (pre-registered)", ">Observed", "Result"], [
    ["Completed discovery interviews", "≥ 8", hv("obsI"), IF("hasResult", result("Met", "9 of 8")) + IF("noResult", result("Running"), True)],
    ["Paid pilot commitments", "≥ 4", hv("obsC"), IF("hasResult", result("Met", "4 of 4")) + IF("noResult", result("Running"), True)]], minw=460)

exp = f'''<section aria-labelledby="ex" style="border:1px solid $border;border-radius:8px;background:$surface">
<div style="padding:14px 16px;border-bottom:1px solid $border;display:flex;flex-wrap:wrap;gap:8px;align-items:center">{mono("EXP-03", 12.5, "$t1")}<h2 id="ex" style="margin:0;font-size:15px;font-weight:600">Validation outreach · 20 sites</h2>
<span style="margin-left:auto;display:inline-flex;gap:6px;align-items:center;font-size:12.5px;color:$t2">{icon("lock", 13)}Plan locked at G1 · 16 Oct</span></div>
<div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;font-size:13.5px">
<div>{eyebrow("Plan")}<p style="margin:0;font-family:$serif;font-size:16px;line-height:25px">We believe that at least 4 of 20 selected sites will sign a paid pilot commitment, and that at least 8 will complete a discovery interview.</p></div>
<dl style="margin:0;display:grid;grid-template-columns:130px 1fr;gap:6px 12px;font-size:13px">
<dt style="color:$t3">Linked assumptions</dt><dd style="margin:0">Adoption 20% · Customers pay €20k annually</dd>
<dt style="color:$t3">Method</dt><dd style="margin:0">Partner-led outreach and discovery interviews</dd>
<dt style="color:$t3">Sample</dt><dd style="margin:0">20 sites from the 500-site reachable pool, selected by size and process, via the approved partner channel</dd>
<dt style="color:$t3">Nonresponse</dt><dd style="margin:0">Declines are recorded. Results describe responders only.</dd>
<dt style="color:$t3">Window</dt><dd style="margin:0"><del style="color:$t3">19 Oct – 13 Nov</del> <span style="font-size:11.5px;color:$t3">Original (pre-registered)</span> → 19 Oct – 20 Nov <span style="font-size:11.5px;color:$wnf;font-weight:500">Amendment 1</span></dd>
<dt style="color:$t3">Budget</dt><dd style="margin:0">€15k · approved at G1 (validation only)</dd>
<dt style="color:$t3">Owner · due</dt><dd style="margin:0">Maya Rao · fieldwork Jonas Klein · due 20 Nov</dd></dl>
<div>{eyebrow("Decision rule (pre-registered)")}<ul style="margin:0;padding-left:18px;font-size:13px;line-height:20px"><li>≥ 4 commitments → prepare G2 pilot request</li><li>2–3 commitments → revise thesis and offer</li><li>&lt; 2 commitments → stop or redesign</li></ul></div>
<div>{eyebrow("Result")}{plan_rows}
{IF("hasResult", f'''<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;font-size:13px">
<div><span style="color:$t3">Measured</span> {kind("Actual", "19 Oct–20 Nov · partner log and signed commitments", small=True)}</div>
<div><span style="color:$t3">Interpretation</span> Thresholds met. Supports a bounded pilot request; does not establish 20% adoption.</div>
<div><span style="color:$t3">Limitations</span> Interviews do not validate conversion or full-market demand. 20 selected sites are not a random sample.</div>
<div><span style="color:$t3">Decision taken</span> Prepare G2 pilot request · Maya Rao · 20 Nov</div></div>''')}
{IF("noResult", f'<div style="margin-top:8px">{result("Too early to read", "window closes 20 Nov")}</div>', True)}</div>
<div>{eyebrow("Amendments")}<ol style="margin:0;padding-left:18px;font-size:13px;line-height:20px"><li><b style="font-weight:600">Amendment 1</b> · 2 Nov · Maya Rao · Window extended by 7 days: two sites rescheduled. Thresholds unchanged. Original kept.</li></ol></div>
</div></section>'''

body = f'''{proto_bar([("Journey step", "stepBtns")])}
<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center">{h2("Assumptions and validation", "Sorted by decision sensitivity, then evidence quality. No combined score.")}<span style="margin-left:auto">{seg("viewBtns", "Register view")}</span></div>
{IF("showDispute", dispute)}
{IF("viewTable", f'<div style="border:1px solid $border;border-radius:8px;overflow:hidden">{register}</div>', True)}
{IF("view2x2", two)}
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start">
<div style="flex:1 1 520px;min-width:0">{exp}</div>
<div style="flex:1 1 420px;min-width:0;display:flex;flex-direction:column;gap:12px">
{h2("Validation tasks", "Preview before anything is written to another tool")}
{tasks_preview}
{IF("hasResult", f'<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px"><div style="font-size:13.5px;font-weight:600">Next: G2 pilot request</div><p style="margin:0;font-size:13px;color:$t2">Thresholds met. Specialist pilot review is still pending (Lena Hoffmann, due 20 Nov).</p>{btn("Prepare pilot package", "p", href="Decisions.dc.html", ic="arrowr", extra="align-self:flex-start")}</div>')}
</div></div></div>'''

js = logic(r"""    const s = this.state;
    const res = s.step === 'results';
    const TASKS = [['Select 20 sites from the reachable pool', 'Maya Rao', '19 Oct'], ['Brief partner on outreach script', 'Jonas Klein', '20 Oct'], ['Run discovery interviews (target 8)', 'Jonas Klein', '13 Nov'], ['Collect paid pilot commitments (target 4)', 'Jonas Klein', '13 Nov'], ['Record results and nonresponse', 'Maya Rao', '13 Nov']];
    const ts = res ? 'done' : s.tasks;
    const tasks = TASKS.map((t, i) => ({ name: t[0], owner: t[1], due: t[2],
      sync: ts === 'none' ? 'Not sent' : ts === 'preview' ? 'In preview' : 'Confirmed · VAL-' + (i + 1),
      st: ts === 'done' ? 'color:$okf' : ts === 'preview' ? 'color:$inf' : 'color:$t2' }));
    const ST = { a1: res ? 'Testing · pilot next' : (ts === 'done' ? 'Testing' : 'Untested'), a2: res ? 'Supported · 4 paid commitments' : (ts === 'done' ? 'Testing' : 'Untested'),
      a4: 'Testing · review due 20 Nov', a5: res ? 'Supported · demo 21 Oct' : 'Testing', a3: res ? 'Supported · partner list' : 'Testing', a6: 'Untested' };
    const out = {};
    Object.keys(ST).forEach(k => { out['st_' + k] = ST[k]; out['rs_' + k] = (k === 'a1' && s.dispute) ? 'background:$wnb' : ''; });
    return Object.assign(out, {
      stepBtns: this.seg([['g1', '16 Oct · G1 approved — create tasks'], ['results', '20 Nov · results recorded']], 'step'),
      viewBtns: this.seg([['table', 'Table'], ['2x2', '2×2']], 'view'), viewTable: s.view === 'table', view2x2: s.view === '2x2',
      nextTitle: res ? 'G2 · Prepare pilot request €120k · 90 days' : 'Run validation · EXP-03',
      nextSub: res ? 'Maya Rao submits · Elena Fischer decides' : 'Maya Rao · window closes 20 Nov',
      showDispute: s.dispute, openDispute: () => this.setState({ dispute: true }), closeDispute: () => this.setState({ dispute: false }),
      replies: s.replies, reply: s.reply, setReply: (e) => this.setState({ reply: e.target.value }), noReply: !s.reply,
      sendReply: () => { if (s.reply) this.setState({ replies: s.replies.concat([{ when: 'just now', text: s.reply }]), reply: '' }); },
      tasks, taskTitle: ts === 'done' ? '5 of 5 confirmed in Jira' : ts === 'preview' ? 'Preview · nothing sent yet' : '5 validation tasks · not sent',
      canPreview: ts === 'none', canCreate: ts === 'preview',
      preview: () => this.setState({ tasks: 'preview' }), cancelPrev: () => this.setState({ tasks: 'none' }), create: () => this.setState({ tasks: 'done' }),
      taskNote: ts === 'done' ? 'Created 16 Oct, 14:20 by Maya Rao under G1 approval.' : ts === 'preview' ? 'Check owners and dates. Creating writes 5 issues once; retries never duplicate.' : 'Authorized by G1 · validation €15k.',
      hasResult: res, noResult: !res,
      obsI: res ? '9' : '—', obsC: res ? '4' : '—'
    });""", "{ step: 'g1', view: 'table', dispute: true, replies: [], reply: '', tasks: 'none' }")

page("Validation.dc.html", "Assumptions and Validation", shell("Expansion Cases", "Fri 16 Oct → Fri 20 Nov 2026", header + body, user="MR", autosave="Saved · just now"), js, height=2100)
