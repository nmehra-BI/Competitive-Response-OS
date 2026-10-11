from common import *

STATUS_IF = "".join(f'<sc-if value="{{{{ st{k} }}}}" hint-placeholder-val="{{{{ {"true" if k == "Acc" else "false"} }}}}">{h}</sc-if>' for k, h in [
    ("Asg", f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$wnf">{icon("dashcircle", 15)}<span style="color:$t1">Awaiting your acceptance</span></span>'),
    ("Acc", task("Accepted")), ("Ip", task("In progress")), ("Blk", task("Blocked")), ("Sub", task("Submitted"))])
EXT_IF = (f'<sc-if value="{{{{ extNone }}}}" hint-placeholder-val="{{{{ false }}}}">{sync("Not sent")}</sc-if>'
          f'<sc-if value="{{{{ extOk }}}}" hint-placeholder-val="{{{{ true }}}}">{sync("Confirmed", "NSD-412")}</sc-if>')

seg = "display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas"
tabs = f'''<div role="tablist" aria-label="My Actions" style="display:flex;gap:22px;border-bottom:1px solid $border;padding:0 24px">
<sc-for list="{{{{ tabs }}}}" as="t" hint-placeholder-count="3"><button type="button" role="tab" aria-selected="{{{{ t.on }}}}" onClick="{{{{ t.pick }}}}" style="{{{{ t.style }}}}">{{{{ t.label }}}}<span style="{{{{ t.badgeStyle }}}}">{{{{ t.count }}}}</span></button></sc-for></div>'''

listpane = f'''<div style="flex:1 1 340px;max-width:100%;min-width:0;border-right:1px solid $border">
<div style="padding:12px 16px;font-size:12px;color:$t3;font-weight:500;border-bottom:1px solid $border">Sorted by due date, then priority</div>
<button type="button" aria-pressed="true" style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;width:100%;text-align:left;padding:14px 16px;border:0;border-bottom:1px solid $border;background:$accbg;font:inherit;cursor:pointer">
<span style="display:flex;gap:8px;width:100%;align-items:flex-start"><span style="flex:1;font-size:13.5px;font-weight:500;line-height:19px">Update Germany positioning brief</span>{prio("High")}</span>
<span style="font-size:12.5px;color:$t2">{mono("CR-1042")} · Apex AX-Scan launch response</span>
<span style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;font-size:12.5px"><span style="display:inline-flex;gap:5px;align-items:center;color:$t1">{icon("calendar", 13)}Due 20 Oct · Day 5</span>{STATUS_IF}</span>
<sc-if value="{{{{ missingDeliv }}}}" hint-placeholder-val="{{{{ true }}}}"><span style="font-size:12px;color:$t2;display:inline-flex;gap:5px;align-items:center">{icon("clip", 12)}Deliverable missing</span></sc-if></button>
<div style="padding:16px;font-size:12px;color:$t3;font-weight:500">Waiting on others</div>
<div style="padding:0 16px 16px;display:flex;flex-direction:column;gap:8px">
<div style="border:1px solid $border;border-radius:8px;padding:10px 12px;font-size:13px"><div style="display:flex;gap:8px;align-items:center">{task("Done")}<span style="font-family:$mono;font-size:12px;color:$t3">T-01</span></div><div style="margin-top:4px">Validate competitor claims and comparison limits</div><div style="font-size:12px;color:$t2;margin-top:2px">[ND-200 product manager] · done 17 Oct · your task depends on this</div></div></div>
<div style="padding:4px 16px 16px;font-size:12.5px;color:$t3">No other open tasks. Completed tasks move to Done.</div></div>'''

brief = f'''<aside aria-label="Brief for this task" style="flex:1 1 340px;min-width:0;border:1px solid $border;border-radius:8px;padding:16px 18px;align-self:flex-start;background:$canvas">
<h3 style="margin:0;font-size:14px;font-weight:600;display:flex;gap:8px;align-items:center">{icon("file", 15)}Brief for this task</h3>
<div style="margin-top:12px;font-size:12px;color:$t3;font-weight:500">Approved response</div>
<p style="margin:4px 0 0;font-size:13px;line-height:19px">Update positioning for Diagnostics · Germany. Approved by Elena Fischer on 14 Oct (v3 · {mono("7c1e·94ab")}).</p>
<div style="margin-top:14px;font-size:12px;color:$t3;font-weight:500">Verified claims you can use</div>
<ul style="list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:8px">
{"".join(f'<li style="background:$surface;border:1px solid $border;border-radius:6px;padding:10px 12px"><p style="margin:0;font-family:$serif;font-size:15px;line-height:23px">{c}</p><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px">{src("Verified", p, d)}<button type="button" class="bg" onClick="{{{{ {h} }}}}" style="margin-left:auto;height:28px;padding:0 8px;border:0;border-radius:4px;font:inherit;font-size:12px;color:$acc;cursor:pointer;display:inline-flex;gap:4px;align-items:center">{icon("copy", 12)}Copy with citation</button></div></li>' for c, p, d, h in [
    ("Apex Diagnostics announced the launch of AX-Scan in Germany, dated 7 Oct 2026.", "Apex press release", "8 Oct", "copy1"),
    ("AX-Scan overlaps ND-200 in one laboratory use case.", "Analyst review", "9 Oct", "copy2")])}</ul>
<div role="note" style="margin-top:14px;border:1px solid #EBCB8B;background:$wnb;border-radius:8px;padding:10px 12px">
<div style="display:flex;align-items:center;gap:6px;color:$wnf;font-weight:600;font-size:13px">{icon("alert", 14)}Do not claim</div>
<ul style="margin:6px 0 0;padding-left:18px;font-size:13px;line-height:20px"><li>Clinical-performance equivalence or superiority (unresolved)</li><li>AX-Scan’s regulatory status, availability or reimbursement (unverified)</li></ul></div>
<div style="margin-top:14px;font-size:12px;color:$t3;font-weight:500">Deliverable</div>
<p style="margin:4px 0 0;font-size:13px;line-height:19px">Germany positioning brief for sellers, citing verified claims only. Completion evidence: approved document, reviewed by Maya Patel.</p>
<a href="CaseSummary.dc.html" style="display:inline-flex;gap:4px;align-items:center;margin-top:12px;font-size:12.5px;font-weight:500;text-decoration:none">Open full case{icon("chevr", 13)}</a>
</aside>'''

reason_chips = f'<div style="display:flex;flex-wrap:wrap;gap:8px"><sc-for list="{{{{ blockers }}}}" as="r" hint-placeholder-count="3"><button type="button" onClick="{{{{ r.pick }}}}" style="height:32px;padding:0 12px;border-radius:999px;border:1px solid $bstrong;background:$surface;font:inherit;font-size:13px;color:$t1;cursor:pointer">{{{{ r.label }}}}</button></sc-for>{btn("Cancel", "g", handler="cancelBlock")}</div>'

detail = f'''<div style="flex:999 1 560px;min-width:0;padding:20px 24px 28px">
<div style="font-size:12.5px;color:$t3;display:flex;gap:8px;align-items:center;flex-wrap:wrap">{mono("T-02")}{mono("CR-1042")}<span>Apex AX-Scan Germany launch response</span></div>
<h2 style="margin:6px 0 0;font-size:20px;line-height:28px;font-weight:600">Update Germany positioning brief</h2>
<div style="display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:10px;font-size:13px;align-items:center">{STATUS_IF}{EXT_IF}<span style="display:inline-flex;gap:5px;align-items:center">{icon("calendar", 14)}Due 20 Oct 2026 · Day 5</span><span style="color:$t2">Assigned by Maya Patel</span></div>
<div role="status" aria-live="polite" style="margin-top:14px">
<sc-if value="{{{{ stBlk }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("warn", "Blocked · {{ blockReason }}", "Maya Patel has been notified. The due date is unchanged until she reschedules.", btn("Clear blocker", "s", handler="clearBlock"))}</sc-if>
<sc-if value="{{{{ stSub }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("info", "Submitted · awaiting review by Maya Patel", "This task’s policy requires reviewer acceptance before it counts as Done. Submitting does not mark the business outcome as achieved.")}</sc-if>
<sc-if value="{{{{ stAsg }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("neutral", "Maya Patel proposed you as owner", "The plan can’t be released until every owner accepts. Accepting doesn’t grant approval rights.")}</sc-if></div>
<div style="display:flex;flex-wrap:wrap;gap:20px;margin-top:18px;align-items:flex-start">
<div style="flex:999 1 380px;min-width:0;display:flex;flex-direction:column;gap:18px">
<section aria-label="Steps"><h3 style="margin:0 0 10px;font-size:14px;font-weight:600">Your steps</h3>
<ol style="list-style:none;margin:0;padding:0;border:1px solid $border;border-radius:8px">
<li style="display:flex;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid $border"><span style="{{{{ s1 }}}}">1</span><span style="flex:1;font-size:13.5px">Accept the assignment</span>
<sc-if value="{{{{ stAsg }}}}" hint-placeholder-val="{{{{ false }}}}">{btn("Accept assignment", "p", handler="accept", ic="check")}</sc-if><sc-if value="{{{{ done1 }}}}" hint-placeholder-val="{{{{ true }}}}"><span style="font-size:12.5px;color:$okf">Accepted 14 Oct</span></sc-if></li>
<li style="display:flex;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid $border"><span style="{{{{ s2 }}}}">2</span><span style="flex:1;font-size:13.5px">Start the work</span>
<sc-if value="{{{{ stAcc }}}}" hint-placeholder-val="{{{{ true }}}}">{btn("Mark in progress", "p", handler="start")}</sc-if><sc-if value="{{{{ done2 }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="font-size:12.5px;color:$okf">Started 18 Oct</span></sc-if></li>
<li style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px;border-bottom:1px solid $border"><span style="{{{{ s3 }}}}">3</span><span style="flex:1 1 200px;font-size:13.5px">Attach the deliverable</span>
<sc-if value="{{{{ canAttach }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display:flex;gap:8px;flex-wrap:wrap"><label for="ma-file" class="bs" style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 12px;border:1px solid $bstrong;border-radius:6px;font-size:13.5px;font-weight:500;cursor:pointer">{icon("clip", 15)}Choose file<input id="ma-file" type="file" onChange="{{{{ onFile }}}}" style="position:absolute;width:1px;height:1px;opacity:0"></label>{btn("Use sample file", "g", handler="attachSample")}</span></sc-if>
<sc-if value="{{{{ attached }}}}" hint-placeholder-val="{{{{ false }}}}"><span style="display:inline-flex;align-items:center;gap:8px;height:30px;padding:0 10px;border:1px solid $border;border-radius:6px;font-size:13px;background:$canvas">{icon("file", 14)}{{{{ fileName }}}}<sc-if value="{{{{ canRemove }}}}" hint-placeholder-val="{{{{ true }}}}"><button type="button" class="bg" aria-label="Remove attachment" onClick="{{{{ removeFile }}}}" style="width:22px;height:22px;border:0;border-radius:4px;display:flex;align-items:center;justify-content:center;color:$t2;cursor:pointer">{icon("x", 12)}</button></sc-if></span></sc-if></li>
<li style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:12px 14px"><span style="{{{{ s4 }}}}">4</span><span style="flex:1 1 200px;font-size:13.5px">Submit completion for review<span style="display:block;font-size:12px;color:$t3">{{{{ submitHint }}}}</span></span>
<button type="button" onClick="{{{{ submit }}}}" disabled="{{{{ submitDisabled }}}}" style="{{{{ submitStyle }}}}">{icon("send", 15)}Submit completion</button></li></ol></section>
<sc-if value="{{{{ canFlag }}}}" hint-placeholder-val="{{{{ true }}}}"><section aria-label="Blockers"><sc-if value="{{{{ notFlagging }}}}" hint-placeholder-val="{{{{ true }}}}">{btn("Flag blocker", "g", handler="flag", ic="flag")}</sc-if>
<sc-if value="{{{{ flagging }}}}" hint-placeholder-val="{{{{ false }}}}"><div><div style="font-size:12.5px;font-weight:500;margin-bottom:8px">What is blocking you?</div>{reason_chips}</div></sc-if></section></sc-if>
<section aria-label="History"><h3 style="margin:0 0 8px;font-size:14px;font-weight:600">History</h3>
<ol style="list-style:none;margin:0;padding:0;font-size:13px;color:$t2;display:flex;flex-direction:column;gap:6px"><sc-for list="{{{{ history }}}}" as="h" hint-placeholder-count="3"><li style="display:flex;gap:10px"><span style="color:$t3;width:96px;flex:none">{{{{ h.when }}}}</span><span>{{{{ h.text }}}}</span></li></sc-for></ol></section>
</div>{brief}</div></div>'''

empty_appr = f'''<sc-if value="{{{{ tabAppr }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="padding:48px 24px;display:flex;gap:12px;align-items:flex-start;max-width:640px">{icon("dashcircle", 20, "$t3")}<div><div style="font-size:15px;font-weight:600">No approvals for you</div><p style="margin:4px 0 0;font-size:13.5px;color:$t2;line-height:20px">Approvals appear here when you hold approval authority for a business scope. Task ownership doesn’t include approval rights. Elena Fischer approves Diagnostics responses.</p></div></div></sc-if>
<sc-if value="{{{{ tabRev }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="padding:48px 24px;display:flex;gap:12px;align-items:flex-start;max-width:640px">{icon("dashcircle", 20, "$t3")}<div><div style="font-size:15px;font-weight:600">No reviews assigned</div><p style="margin:4px 0 0;font-size:13.5px;color:$t2;line-height:20px">Deliverable and outcome reviews you’re asked to do appear here, with their due dates.</p></div></div></sc-if>'''

content = f'''<div style="padding:20px 24px 14px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end">
<div style="flex:1 1 400px;min-width:0"><h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">My Actions</h1><p style="margin:2px 0 0;font-size:13px;color:$t2">What you owe, with the context to finish it here.</p></div>
<span role="status" aria-live="polite" style="font-size:12.5px;color:$t2">{{{{ toast }}}}</span></div>
{tabs}
<sc-if value="{{{{ tabTasks }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="display:flex;flex-wrap:wrap;align-items:stretch">{listpane}{detail}</div></sc-if>
{empty_appr}'''

logic = r'''class Component extends DCLogic {
  state = { tab: 'tasks', st: 'assigned', file: null, flagging: false, block: '', toast: '', log: [] };
  renderVals() {
    const s = this.state;
    const tabsDef = [['tasks', 'Tasks', '1'], ['appr', 'Approvals', '0'], ['rev', 'Reviews', '0']];
    const tabs = tabsDef.map(([k, l, c]) => ({ label: l, count: c, on: s.tab === k ? 'true' : 'false', pick: () => this.setState({ tab: k }),
      style: 'display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 2px;margin-bottom:-1px;border:0;background:transparent;font:inherit;font-size:13.5px;cursor:pointer;transition:color 140ms;' + (s.tab === k ? 'color:$t1;font-weight:500;border-bottom:2px solid $t1;' : 'color:$t2;border-bottom:2px solid transparent;'),
      badgeStyle: 'font-size:11.5px;min-width:18px;height:18px;padding:0 6px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;' + (c !== '0' ? 'background:$ntb;color:$t1;' : 'background:transparent;color:$t3;') }));
    const add = (text) => s.log.concat([{ when: 'Just now', text }]);
    const st = s.st;
    const order = ['assigned', 'accepted', 'inprogress', 'submitted'];
    const idx = order.indexOf(st === 'blocked' ? 'inprogress' : st);
    const dot = (n, done, cur) => 'width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600;' + (done ? 'background:$okb;color:$okf;' : (cur ? 'background:$t1;color:#fff;' : 'border:1px solid $bstrong;color:$t3;'));
    const attached = !!s.file;
    const canSubmit = st === 'inprogress' && attached;
    const history = [{ when: '14 Oct, 15:40', text: 'Maya Patel proposed you as owner · due 20 Oct' }].concat(
      idx >= 1 ? [{ when: '14 Oct, 16:02', text: 'You accepted the assignment' }, { when: '15 Oct, 09:00', text: 'Plan released · Jira NSD-412 confirmed' }] : [],
      idx >= 2 ? [{ when: '17 Oct, 17:10', text: 'Dependency T-01 done · comparison limits attached' }, { when: '18 Oct, 09:15', text: 'You marked the task in progress' }] : [],
      s.log).reverse();
    return {
      tabs, tabTasks: s.tab === 'tasks', tabAppr: s.tab === 'appr', tabRev: s.tab === 'rev', toast: s.toast,
      stAsg: st === 'assigned', stAcc: st === 'accepted', stIp: st === 'inprogress', stBlk: st === 'blocked', stSub: st === 'submitted',
      extNone: st === 'assigned', extOk: st !== 'assigned',
      done1: idx >= 1, done2: idx >= 2,
      s1: dot(1, idx >= 1, idx === 0), s2: dot(2, idx >= 2, idx === 1), s3: dot(3, attached, idx === 2 && !attached), s4: dot(4, st === 'submitted', canSubmit),
      missingDeliv: !attached,
      accept: () => this.setState({ st: 'accepted', toast: 'Assignment accepted.' }),
      start: () => this.setState({ st: 'inprogress', toast: 'Marked in progress.' }),
      canAttach: (st === 'inprogress' || st === 'blocked') && !attached, attached, fileName: s.file || '', canRemove: st !== 'submitted',
      onFile: (e) => { const f = e.target.files && e.target.files[0]; if (f) this.setState({ file: f.name, log: add('You attached ' + f.name), toast: 'Deliverable attached.' }); },
      attachSample: () => this.setState({ file: 'Germany_positioning_brief_v1.docx', log: add('You attached Germany_positioning_brief_v1.docx'), toast: 'Deliverable attached.' }),
      removeFile: () => this.setState({ file: null, toast: 'Attachment removed.' }),
      submitHint: st === 'submitted' ? 'Submitted · awaiting review by Maya Patel' : (attached ? 'Maya Patel reviews it before it counts as Done' : (st === 'inprogress' || st === 'blocked' ? 'Attach the approved document first' : 'Available after you start the work')),
      submit: () => canSubmit && this.setState({ st: 'submitted', log: add('You submitted completion for review'), toast: 'Submitted for review by Maya Patel.' }),
      submitDisabled: !canSubmit,
      submitStyle: 'display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (canSubmit ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      canFlag: st === 'inprogress' || st === 'accepted', flagging: s.flagging, notFlagging: !s.flagging,
      flag: () => this.setState({ flagging: true }), cancelBlock: () => this.setState({ flagging: false }),
      blockers: ['Waiting on comparison limits from T-01', 'Need legal or regulatory review of wording', 'Missing source for a claim'].map(r => ({ label: r, pick: () => this.setState({ st: 'blocked', block: r, flagging: false, log: add('You flagged a blocker: ' + r), toast: 'Blocker flagged. Maya Patel was notified.' }) })),
      blockReason: s.block, clearBlock: () => this.setState({ st: 'inprogress', log: add('You cleared the blocker'), toast: 'Blocker cleared.' }),
      history,
      copy1: () => { try { navigator.clipboard.writeText('Apex Diagnostics announced the launch of AX-Scan in Germany, dated 7 Oct 2026. [Source: Apex Diagnostics press release, published 8 Oct 2026]').catch(() => {}); } catch (e) {} this.setState({ toast: 'Claim copied with its citation.' }); },
      copy2: () => { try { navigator.clipboard.writeText('AX-Scan overlaps ND-200 in one laboratory use case. [Source: Analyst review, Maya Patel, 9 Oct 2026]').catch(() => {}); } catch (e) {} this.setState({ toast: 'Claim copied with its citation.' }); }
    };
  }
}'''

page("MyActions.dc.html", "My Actions", shell("My Actions", "14–19 Oct 2026 · task flow", content, user=("Jonas Weber", "Product marketing lead", "JW"), counts={"My Actions": "1"}), logic, height=1300)
