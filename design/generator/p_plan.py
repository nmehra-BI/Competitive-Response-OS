from common import *

nd = f'''<div style="font-size:13.5px;font-weight:500">Authorize and release plan v1</div><div style="font-size:12.5px;color:$t2;margin-top:2px">Owners accepted 4 of 4 · approval v3 by Elena Fischer, 14 Oct</div>'''
nr = f'''<div style="font-size:13.5px;font-weight:500">{{{{ relNext }}}}</div><div style="font-size:12.5px;color:$t2;margin-top:2px">{{{{ relNextSub }}}}</div>'''
headers = (f'<sc-if value="{{{{ isDraft }}}}" hint-placeholder-val="{{{{ true }}}}">{case_header("Action Plan", "Approved", "Execute", "Partial", "15 Oct, 08:55", nd)}</sc-if>'
           f'<sc-if value="{{{{ isReleased }}}}" hint-placeholder-val="{{{{ false }}}}">{case_header("Action Plan", "Executing", "Execute", "Partial", "15 Oct, 09:00", nr)}</sc-if>')

seg = "display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas;flex-wrap:wrap"
proto = f'''<div role="region" aria-label="Prototype controls" style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding:10px 24px;border-bottom:1px dashed $bstrong;background:$canvas;font-size:12.5px;color:$t2">
<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{icon("sliders", 14)}Prototype variant</span>
<div role="group" aria-label="Variant" style="{seg}"><sc-for list="{{{{ varBtns }}}}" as="b" hint-placeholder-count="3"><button type="button" onClick="{{{{ b.pick }}}}" aria-pressed="{{{{ b.on }}}}" style="{{{{ b.style }}}}">{{{{ b.label }}}}</button></sc-for></div>
<button type="button" class="bg" onClick="{{{{ resetAll }}}}" style="height:28px;padding:0 8px;border:0;border-radius:6px;font:inherit;font-size:12.5px;color:$t2;cursor:pointer;display:inline-flex;gap:6px;align-items:center">{icon("history", 13)}Reset to draft</button></div>'''

TH = "text-align:left;font-weight:500;font-size:12.5px;color:$t3;padding:0 12px;height:36px;border-bottom:1px solid $border;white-space:nowrap;background:$canvas"
TD = "padding:12px;border-bottom:1px solid $border;vertical-align:top;font-size:13px;line-height:19px"

def sync_if(t):
    return "".join(f'<sc-if value="{{{{ {t}.x{k} }}}}" hint-placeholder-val="{{{{ false }}}}">{h}</sc-if>' for k, h in [
        ("Ok", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{sync("Confirmed")}<span style="font-family:$mono;font-size:12px;color:$t2">Jira · {{{{ {t}.key }}}}</span></span>'),
        ("Fail", f'<span style="display:inline-flex;flex-direction:column;gap:4px;align-items:flex-start">{sync("Failed")}<span style="font-size:12px;color:$t2">Timeout after 30 s · no issue created</span><button type="button" class="bs" onClick="{{{{ retry }}}}" disabled="{{{{ retryDisabled }}}}" style="height:28px;padding:0 10px;border:1px solid $bstrong;border-radius:6px;font:inherit;font-size:12.5px;font-weight:500;color:$acc;cursor:pointer;display:inline-flex;gap:6px;align-items:center">{icon("refresh", 13)}Retry</button></span>'),
        ("Send", sync("Sending…")),
        ("Check", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{sync("Checking")}<span style="font-size:12px;color:$t2">Checking Jira before retrying</span></span>'),
        ("Pause", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{sync("Paused")}<span style="font-size:12px;color:$t2">{{{{ pauseWhy }}}}</span></span>'),
        ("None", f'<span style="display:inline-flex;flex-direction:column;gap:2px">{sync("Not sent")}<span style="font-size:12px;color:$t3">Sent after release</span></span>'),
    ])


rows = ""
for t in ["t1", "t2", "t3", "t4"]:
    rows += (f'<tr class="hr"><td style="{TD}"><div style="display:flex;gap:8px"><span style="font-family:$mono;font-size:12px;color:$t3;padding-top:1px">{{{{ {t}.id }}}}</span><span style="font-weight:500">{{{{ {t}.title }}}}</span></div></td>'
             f'<td style="{TD}"><div>{{{{ {t}.owner }}}}</div><div style="font-size:12px;color:$okf;display:inline-flex;gap:4px;align-items:center;margin-top:2px">{icon("check", 12)}Accepted {{{{ {t}.acc }}}}</div></td>'
             f'<td style="{TD};color:$t2">{{{{ {t}.deliv }}}}</td>'
             f'<td style="{TD};white-space:nowrap"><div>{{{{ {t}.due }}}}</div><div style="font-size:12px;color:$t3">{{{{ {t}.day }}}}</div></td>'
             f'<td style="{TD};color:$t2;font-family:$mono;font-size:12px">{{{{ {t}.dep }}}}</td>'
             f'<td style="{TD}">{task("Not started")}</td><td style="{TD}">{sync_if(t)}</td></tr>')

HEADS = ["Task", "Owner", "Deliverable · completion evidence", "Due", "Depends on", "Internal status", "External · Jira"]
table = ('<div style="overflow-x:auto;border:1px solid $border;border-radius:8px"><table style="width:100%;border-collapse:collapse;min-width:1080px">'
         '<caption style="position:absolute;left:-9999px">Plan tasks</caption><thead><tr>'
         + "".join(f'<th scope="col" style="{TH}">{h}</th>' for h in HEADS) + f'</tr></thead><tbody>{rows}</tbody></table></div>')

pf_steps = f'''<ol style="list-style:none;margin:0 0 14px;padding:0;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><sc-for list="{{{{ pfSteps }}}}" as="p" hint-placeholder-count="3"><li style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px"><span style="{{{{ p.dot }}}}">{{{{ p.n }}}}</span><span style="{{{{ p.lab }}}}">{{{{ p.label }}}}</span></li></sc-for></ol>'''
RT = "padding:6px 8px;border-bottom:1px solid $border;font-size:12.5px;vertical-align:top"
records = "".join(f'<tr><td style="{RT};font-family:$mono;color:$t3">{i}</td><td style="{RT}">{s}</td><td style="{RT}">{a}</td><td style="{RT};white-space:nowrap">{d}</td></tr>' for i, s, a, d in [
    ("T-01", "[CR-1042] Validate competitor claims and comparison limits", "[ND-200 product manager]", "2026-10-17"),
    ("T-02", "[CR-1042] Update Germany positioning brief", "Jonas Weber", "2026-10-20"),
    ("T-03", "[CR-1042] Review 18 affected accounts", "Sofia Klein", "2026-10-25"),
    ("T-04", "[CR-1042] Review early response outcomes", "Maya Patel", "2026-11-14")])

preflight = f'''<section aria-label="Preflight" style="border:1px solid $border;border-radius:8px;padding:16px 18px">
<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><h2 style="margin:0;font-size:16px;font-weight:600">Authorize and release plan</h2><span style="font-size:12.5px;color:$t3">Preflight</span></div>
{pf_steps}
<sc-if value="{{{{ pf1 }}}}" hint-placeholder-val="{{{{ true }}}}"><div>
<ul style="list-style:none;margin:0;padding:0;font-size:13px">{"".join(f'<li style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid $border"><span style="color:$okf">{icon("checkcircle", 15)}</span>{t}</li>' for t in ["4 tasks with owner, due date and completion evidence", "Owners accepted: 4 of 4", "No dependency cycles (T-02 after T-01; T-04 after T-02, T-03)", "Approved decision: v3 · 7c1e·94ab · Elena Fischer, 14 Oct 15:10"])}</ul>
<div style="display:flex;justify-content:flex-end;margin-top:12px">{btn("Continue to destination", "p", handler="pfNext", ic="arrowr")}</div></div></sc-if>
<sc-if value="{{{{ pf2 }}}}" hint-placeholder-val="{{{{ false }}}}"><div>
<dl style="display:grid;grid-template-columns:130px 1fr;gap:6px 12px;margin:0 0 12px;font-size:13px"><dt style="color:$t3">Destination</dt><dd style="margin:0">Jira Cloud · project <span style="font-family:$mono">NSD</span> · issue type Task</dd>
<dt style="color:$t3">Labels</dt><dd style="margin:0;font-family:$mono;font-size:12.5px">cr-1042, competitive-response</dd><dt style="color:$t3">Link back</dt><dd style="margin:0;font-size:12.5px">Each issue links to its task in CR-1042</dd></dl>
<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:4px">Exact records · 4 issues</div>
<div style="overflow-x:auto;border:1px solid $border;border-radius:6px"><table style="width:100%;border-collapse:collapse;min-width:520px"><thead><tr><th scope="col" style="{RT};text-align:left;color:$t3;font-weight:500">Task</th><th scope="col" style="{RT};text-align:left;color:$t3;font-weight:500">Summary</th><th scope="col" style="{RT};text-align:left;color:$t3;font-weight:500">Assignee</th><th scope="col" style="{RT};text-align:left;color:$t3;font-weight:500">Due</th></tr></thead><tbody>{records}</tbody></table></div>
<div style="margin-top:12px;font-size:13px;display:flex;flex-direction:column;gap:4px"><div style="font-weight:500">Notifications</div><div style="color:$t2">4 owners are notified in the app and by email after release. Microsoft Teams is not connected.</div></div>
<div style="display:flex;justify-content:space-between;margin-top:12px">{btn("Back", "g", handler="pfBack", ic="chevl")}{btn("Continue to confirm", "p", handler="pfNext", ic="arrowr")}</div></div></sc-if>
<sc-if value="{{{{ pf3 }}}}" hint-placeholder-val="{{{{ false }}}}"><div>
<label for="pf-auth" style="display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid $bstrong;border-radius:6px;cursor:pointer;font-size:13.5px;line-height:20px">
<input id="pf-auth" type="checkbox" checked="{{{{ authorized }}}}" onChange="{{{{ toggleAuth }}}}" style="width:18px;height:18px;margin:1px 0 0;accent-color:#3049C9;flex:none">
<span>I authorize <b style="font-weight:600">plan v1</b> under <b style="font-weight:600">approval v3</b> ({mono("7c1e·94ab")}). This creates 4 internal tasks and 4 Jira issues in NSD, and notifies 4 owners.</span></label>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Recorded as Maya Patel · execution authorization. Retries reuse the same request IDs, so a retry can’t create a duplicate issue.</p>
<div style="display:flex;justify-content:space-between;margin-top:12px">{btn("Back", "g", handler="pfBack", ic="chevl")}
<button type="button" onClick="{{{{ release }}}}" disabled="{{{{ releaseDisabled }}}}" style="{{{{ releaseStyle }}}}">{icon("send", 15)}Authorize and release plan</button></div></div></sc-if>
</section>'''

draft = f'''<sc-if value="{{{{ isDraft }}}}" hint-placeholder-val="{{{{ true }}}}"><div style="display:flex;flex-direction:column;gap:16px">
{banner("info", "Draft plan v1 · built from approved decision v3", "Drafts are editable. Nothing reaches owners or Jira until you authorize and release.")}
<div style="display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start"><div style="flex:999 1 620px;min-width:0">{table}</div><div style="flex:1 1 380px;min-width:0">{preflight}</div></div></div></sc-if>'''

released = f'''<sc-if value="{{{{ isReleased }}}}" hint-placeholder-val="{{{{ false }}}}"><div style="display:flex;flex-direction:column;gap:16px">
<sc-if value="{{{{ bSending }}}}" hint-placeholder-val="{{{{ false }}}}"><div role="status" style="display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:8px;background:$inb;color:$inf;font-size:13.5px;font-weight:500">{icon("progress", 16)}Sending 4 tasks to Jira… Internal tasks are already active.</div></sc-if>
<sc-if value="{{{{ bPartial }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("warn", "3 of 4 tasks confirmed in Jira. 1 failed (timeout).", "Confirmed issues keep their references. Retrying sends only the failed task.", '<button type="button" class="bs" onClick="{{ retry }}" disabled="{{ retryDisabled }}" style="display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:6px;border:1px solid $bstrong;font:inherit;font-size:13.5px;font-weight:500;color:$t1;cursor:pointer">' + icon("refresh", 15) + 'Retry 1 failed task</button>')}</sc-if>
<sc-if value="{{{{ bRetrying }}}}" hint-placeholder-val="{{{{ false }}}}"><div role="status" style="display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:8px;background:$inb;color:$inf;font-size:13.5px;font-weight:500">{icon("progress", 16)}{{{{ retryMsg }}}}</div></sc-if>
<sc-if value="{{{{ bAllOk }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("ok", "4 of 4 tasks confirmed in Jira", "T-03 was retried once and confirmed as NSD-414. No duplicates were created.")}</sc-if>
<sc-if value="{{{{ bRevoked }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("warn", "Sending paused — approval invalidated on 16 Oct", "The regulatory-status source changed after approval. Unsent Jira writes are paused; confirmed issues NSD-411, NSD-412 and NSD-413 are kept. Reassessment is required.", btn("Open decision", "s", href="Decision.dc.html"))}</sc-if>
<sc-if value="{{{{ bDisc }}}}" hint-placeholder-val="{{{{ false }}}}">{banner("danger", "Jira disconnected · Internal tasks still active", "The Jira connection stopped responding on 15 Oct, 09:04. Owners can keep working in CR-OS. Unsent issues wait until the connection is restored.", btn("Open Integrations", "s", href="Integrations.dc.html"))}</sc-if>
<div style="display:flex;flex-wrap:wrap;gap:8px 20px;font-size:12.5px;color:$t2;align-items:center"><span>Released by Maya Patel · 15 Oct, 09:00</span><span>Authorization: plan v1 under approval v3 · {mono("7c1e·94ab")}</span><span>Destination: Jira · NSD</span></div>
{table}</div></sc-if>'''

content = headers + proto + f'''<div style="padding:20px 24px 32px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center">
<div role="group" aria-label="Plan version" style="{seg}">
<button type="button" onClick="{{{{ showDraft }}}}" aria-pressed="{{{{ draftOn }}}}" style="{{{{ segDraft }}}}">Draft plan</button>
<button type="button" onClick="{{{{ showRel }}}}" aria-pressed="{{{{ relOn }}}}" disabled="{{{{ relDisabled }}}}" style="{{{{ segRel }}}}">Released plan v1</button></div>
<span style="font-size:12.5px;color:$t3">{{{{ planMeta }}}}</span>
<span role="status" aria-live="polite" style="margin-left:auto;font-size:12.5px;color:$t2">{{{{ live }}}}</span></div>
{draft}{released}</div>'''

logic = r'''class Component extends DCLogic {
  state = { mode: 'draft', released: false, pf: 1, auth: false, phase: 'idle', t3: 'fail', variant: 'none' };
  componentWillUnmount() { (this.timers || []).forEach(clearTimeout); }
  later(fn, ms) { this.timers = this.timers || []; this.timers.push(setTimeout(fn, ms)); }
  renderVals() {
    const s = this.state;
    const segB = (on, dis) => 'height:28px;padding:0 12px;border-radius:4px;border:0;font:inherit;font-size:13px;transition:background 140ms;' + (dis ? 'background:transparent;color:$t3;cursor:not-allowed;opacity:.6;' : (on ? 'background:$surface;color:$t1;font-weight:500;box-shadow:0 0 0 1px $border;cursor:pointer;' : 'background:transparent;color:$t2;cursor:pointer;'));
    const rel = s.mode === 'released';
    const sending = s.phase === 'sending';
    const v = s.variant;
    const ext = (id) => {
      if (!s.released) return 'None';
      if (sending) return 'Send';
      if (id === 'T-03') {
        if (s.t3 === 'ok') return 'Ok';
        if (v === 'revoked' || v === 'disc') return 'Pause';
        return { fail: 'Fail', check: 'Check', send: 'Send' }[s.t3];
      }
      return 'Ok';
    };
    const keys = { 'T-01': 'NSD-411', 'T-02': 'NSD-412', 'T-03': 'NSD-414', 'T-04': 'NSD-413' };
    const base = [
      { id: 'T-01', title: 'Validate competitor claims and comparison limits', owner: '[ND-200 product manager]', acc: '14 Oct', deliv: 'Reviewed comparison with citations', due: '17 Oct', day: 'Day 2', dep: '—' },
      { id: 'T-02', title: 'Update Germany positioning brief', owner: 'Jonas Weber', acc: '14 Oct', deliv: 'Approved document', due: '20 Oct', day: 'Day 5', dep: 'T-01' },
      { id: 'T-03', title: 'Review 18 affected accounts', owner: 'Sofia Klein', acc: '14 Oct', deliv: 'Account review summary with restricted details', due: '25 Oct', day: 'Day 10', dep: '—' },
      { id: 'T-04', title: 'Review early response outcomes', owner: 'Maya Patel', acc: '14 Oct', deliv: 'Baseline comparison and recommendation', due: '14 Nov', day: 'Day 30', dep: 'T-02, T-03' }
    ];
    const tasks = base.map(t => { const x = ext(t.id); return { ...t, key: keys[t.id], xOk: x === 'Ok', xFail: x === 'Fail', xSend: x === 'Send', xCheck: x === 'Check', xPause: x === 'Pause', xNone: x === 'None' }; });
    const retry = () => {
      if (s.t3 !== 'fail' || v !== 'none') return;
      this.setState({ t3: 'check' });
      this.later(() => this.setState({ t3: 'send' }), 900);
      this.later(() => this.setState({ t3: 'ok' }), 1800);
    };
    const release = () => {
      if (!s.auth) return;
      this.setState({ released: true, mode: 'released', phase: 'sending' });
      this.later(() => this.setState({ phase: 'done' }), 1400);
    };
    const pfSteps = ['Review tasks', 'Destination preview', 'Confirm'].map((l, i) => ({ n: String(i + 1), label: l,
      dot: 'width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;' + (i + 1 <= s.pf ? 'background:$t1;color:#fff;' : 'border:1px solid $bstrong;color:$t3;'),
      lab: (i + 1 === s.pf ? 'color:$t1;font-weight:500;' : 'color:$t3;') + (i < 2 ? 'margin-right:8px;' : '') }));
    const vars = [['none', 'None'], ['revoked', 'Approval revoked'], ['disc', 'Jira disconnected']];
    const varBtns = vars.map(([k, l]) => ({ label: l, on: v === k ? 'true' : 'false', style: segB(v === k),
      pick: () => this.setState(k === 'none' ? { variant: k } : { variant: k, released: true, mode: 'released', phase: 'done', t3: s.t3 === 'ok' ? 'ok' : 'fail' }) }));
    const done = s.released && !sending;
    let relNext = 'Track execution', relNextSub = 'Owners are working; due dates start 17 Oct';
    if (sending) relNextSub = 'Sending tasks to Jira';
    else if (v === 'revoked') { relNext = 'Reassess the case'; relNextSub = 'Approval invalidated 16 Oct · unsent writes paused'; }
    else if (v === 'disc') { relNext = 'Reconnect Jira'; relNextSub = 'Internal tasks remain active'; }
    else if (s.t3 === 'fail') { relNext = 'Retry 1 failed task'; relNextSub = 'T-03 did not reach Jira'; }
    return {
      isDraft: !rel, isReleased: rel, t1: tasks[0], t2: tasks[1], t3: tasks[2], t4: tasks[3], pfSteps, varBtns,
      pf1: s.pf === 1, pf2: s.pf === 2, pf3: s.pf === 3,
      pfNext: () => this.setState({ pf: Math.min(3, s.pf + 1) }), pfBack: () => this.setState({ pf: Math.max(1, s.pf - 1) }),
      authorized: s.auth, toggleAuth: () => this.setState({ auth: !s.auth }),
      release, releaseDisabled: !s.auth,
      releaseStyle: 'display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;' + (s.auth ? 'background:$acc;color:#fff;border:1px solid $acc;cursor:pointer;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;'),
      showDraft: () => this.setState({ mode: 'draft' }), showRel: () => s.released && this.setState({ mode: 'released' }),
      draftOn: rel ? 'false' : 'true', relOn: rel ? 'true' : 'false', relDisabled: !s.released, segDraft: segB(!rel), segRel: segB(rel, !s.released),
      planMeta: s.released ? (rel ? 'Released plan v1 is read-only. Amendments go through review.' : 'Draft v1 was released on 15 Oct, 09:00 and is now read-only.') : 'Draft v1 · last edited by Maya Patel, 15 Oct 08:52',
      bSending: rel && sending, bPartial: rel && done && v === 'none' && s.t3 === 'fail', bRetrying: rel && done && (s.t3 === 'check' || s.t3 === 'send'),
      retryMsg: s.t3 === 'check' ? 'Checking Jira for T-03 before retrying…' : 'Sending T-03 to Jira…',
      bAllOk: rel && done && s.t3 === 'ok' && v === 'none', bRevoked: rel && done && v === 'revoked', bDisc: rel && done && v === 'disc',
      retry, retryDisabled: s.t3 !== 'fail' || v !== 'none',
      pauseWhy: v === 'revoked' ? 'Paused — approval changed' : 'Paused — Jira disconnected',
      relNext, relNextSub,
      resetAll: () => this.setState({ mode: 'draft', released: false, pf: 1, auth: false, phase: 'idle', t3: 'fail', variant: 'none' }),
      live: sending ? 'Sending…' : (s.t3 === 'ok' && s.released ? 'T-03 confirmed as NSD-414' : '')
    };
  }
}'''

page("ActionPlan.dc.html", "Action Plan", shell("Cases", "Thu 15 Oct 2026, 09:00", content), logic, height=1560)
