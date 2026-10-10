from components import *

LBL = "display:block;font-size:13px;font-weight:500;margin-bottom:6px"
INP = "width:100%;box-sizing:border-box;min-height:36px;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"
HELP = "font-size:12px;color:$t3;margin-top:4px;line-height:16px"


def field(label, inner, help_="", err=None):
    e = IF(err, f'<div style="display:flex;gap:6px;align-items:center;margin-top:6px;font-size:12.5px;color:$wnf;font-weight:500">{icon("alert", 14)}<span>{hv(err + "Msg")}</span></div>') if err else ""
    h = f'<div style="{HELP}">{help_}</div>' if help_ else ""
    return f'<div style="display:flex;flex-direction:column">{label}{inner}{h}{e}</div>'


form = f'''<form aria-labelledby="mf" style="display:flex;flex-direction:column;gap:18px" onSubmit="{hv("noop")}">
{IF("hasErrors", f'<div role="alert" style="border:1px solid $wnf;border-radius:8px;padding:10px 14px;background:$wnb"><div style="display:flex;gap:8px;align-items:center;font-weight:600;color:$wnf;font-size:13.5px">{icon("alert", 16)}{hv("errTitle")}</div><ul style="margin:6px 0 0;padding-left:30px;font-size:13px;color:$t1">' + FOR("errors", "e", f'<li>{hv("e.text")}</li>', 3) + '</ul></div>', True)}
{field(f'<label for="m-obj" style="{LBL}">Objective</label>', f'<textarea id="m-obj" rows="2" style="{INP};resize:vertical">Evaluate whether German food-processing plants are a viable new segment for our existing water-monitoring system.</textarea>')}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
{field(f'<label for="m-prod" style="{LBL}">Existing product</label>', f'<input id="m-prod" type="text" value="Water-monitoring system · current catalogue" style="{INP}">')}
{field(f'<label for="m-seg" style="{LBL}">Target segment</label>', f'<input id="m-seg" type="text" value="Food-processing plants" style="{INP}">')}
{field(f'<label for="m-geo" style="{LBL}">Geography</label>', f'<input id="m-geo" type="text" value="Germany" style="{INP}">')}
</div>
{field(f'<label for="m-exc" style="{LBL}">Exclusions</label>', f'<input id="m-exc" type="text" value="{hv("exclusions")}" onChange="{hv("setExc")}" style="{INP}">', "What this mandate may not look for or do.")}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
{field(f'<span id="l-hz" style="{LBL}">Mandate horizon</span>', seg("hzBtns", "Mandate horizon"), "The scenario horizon for SOM and economics.", "errHz")}
{field(f'<span style="{LBL}">Pilot duration</span>', f'<div style="{INP};background:$canvas;display:flex;align-items:center">90 days <span style="color:$t3;margin-left:6px">· fixed by sponsor brief</span></div>')}
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
{field(f'<label for="m-amt" style="{LBL}">Investment constraint · pilot spend ceiling</label>', f'<input id="m-amt" type="text" inputmode="numeric" value="{hv("amount")}" onChange="{hv("setAmt")}" style="{INP};font-family:$mono">', "Up to this amount for a bounded pilot. Scale is a separate later decision.")}
{field(f'<span style="{LBL}">Currency (required)</span>', seg("curBtns", "Currency"), "Currency is never typed as free text.", "errCur")}
</div>
{field(f'<span style="{LBL}">Evidence sources</span>', f'<div style="display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px"><label style="display:inline-flex;gap:8px;align-items:center"><input type="checkbox" checked="checked" style="width:16px;height:16px;accent-color:#3049C9;margin:0">Licensed market data</label><label style="display:inline-flex;gap:8px;align-items:center"><input type="checkbox" checked="checked" style="width:16px;height:16px;accent-color:#3049C9;margin:0">Authorized uploads</label><label style="display:inline-flex;gap:8px;align-items:center;color:$t3"><input type="checkbox" disabled="disabled" style="width:16px;height:16px;margin:0">CRM accounts · not connected</label></div>')}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
{field(f'<span style="{LBL}">Accountable owner (required)</span>', seg("ownBtns", "Accountable owner"), "One named person. The owner cannot approve their own gates.", "errOwn")}
{field(f'<span style="{LBL}">Sponsor · approves G0</span>', f'<div style="{INP};background:$canvas;display:flex;align-items:center;gap:8px">{avatar("EF", 20)}Elena Fischer · BU VP</div>')}
</div>
{field(f'<label for="m-succ" style="{LBL}">Success definition</label>', f'<textarea id="m-succ" rows="2" style="{INP};resize:vertical">A recorded scale, extend or stop decision backed by validated evidence, with the SOM scenario stated for end of year 3.</textarea>')}
</form>'''

preview = f'''<aside aria-label="Scope preview" style="display:flex;flex-direction:column;gap:12px">
<div style="border:1px solid $border;border-radius:8px;padding:16px;background:$canvas">
{eyebrow("Scope preview · updates as you type")}
<p aria-live="polite" style="margin:0;font-family:$serif;font-size:17px;line-height:28px">Evaluate <b style="font-weight:600">German food-processing plants</b> for the existing water-monitoring system over <b style="font-weight:600">{hv("hzText")}</b>, with up to <b style="font-weight:600">{hv("amtText")}</b> pilot spend in a 90-day pilot, owned by <b style="font-weight:600">{hv("ownText")}</b>.</p>
<p style="margin:8px 0 0;font-family:$serif;font-size:15px;line-height:24px;color:$t2">Sponsor Elena Fischer approves this scope at G0. A later scale decision is separate. Excludes: {hv("exclusions")}</p></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px">
<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">{ai("AI draft · not validated")}<span style="font-size:12.5px;color:$t2">Suggested adjacent segments</span></div>
<ul style="margin:0;padding-left:18px;font-size:13px;line-height:21px"><li>Dairy plants within food processing</li><li>Beverage bottling plants</li></ul>
<p style="margin:6px 0 0;font-size:12px;color:$t3">Suggestions are search ideas, not validated opportunities. They are not added to the mandate unless you add them.</p></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;font-size:13px">
{eyebrow("Gate G0 · Scope approved")}
<div style="display:flex;flex-direction:column;gap:6px">
{FOR("checks", "c", f'<div style="display:flex;gap:8px;align-items:center"><span style="{hv("c.st")}">{hv("c.glyph")}</span><span>{hv("c.label")}</span></div>', 5)}
</div></div></aside>'''

returned = banner("warn", "Returned for revision by Elena Fischer · 3 Oct, 09:40",
                  "“Name an accountable owner and state the currency. Add ‘no prospect outreach before G1’ to the exclusions.” Fix the items and resubmit; the comment stays in history.")
submitted_panel = f'''<div style="border:1px solid $border;border-radius:8px;padding:16px;display:flex;flex-direction:column;gap:12px;max-width:760px">
<div style="display:flex;gap:10px;align-items:center">{diamond("awaiting", 20)}<div><div style="font-weight:600">G0 · Awaiting decision · Mandate v2</div><div style="font-size:12.5px;color:$t2">Submitted by Maya Rao · 4 Oct, 14:05 · viewing as Elena Fischer</div></div></div>
{auth_boxes(["Search and assessment within this scope", "Owner Maya Rao · horizon 3 years · EUR"], ["No spend: validation (G1) and pilot (G2) are separate gates", "No prospect outreach"])}
<label for="g0c" style="font-size:13px;font-weight:500">Comment <span style="color:$t3;font-weight:400">(required to return)</span>
<textarea id="g0c" rows="2" value="{hv("gComment")}" onChange="{hv("setG")}" style="{INP};margin-top:6px;resize:vertical"></textarea></label>
<div style="display:flex;gap:8px;flex-wrap:wrap">{approve_btn("Approve mandate (G0)", handler="approveG0", full=False)}<button type="button" class="bs" onClick="{hv("returnG0")}" disabled="{hv("noComment")}" style="{BTN}border:1px solid $bstrong;color:$t1">Return for revision</button></div>
{IF("noComment", f'<div style="font-size:12px;color:$t3">Return for revision needs a comment.</div>', True)}</div>'''
approved_panel = f'<div style="max-width:760px">{banner("ok", "Mandate approved (G0) · 5 Oct 2026, 10:12", "Elena Fischer approved scope v2. Discovery can start. No spend is authorized by G0.", btn("Go to opportunities", "s", href="Opportunities.dc.html", ic="arrowr"))}</div>'

content = f'''{proto_bar([("Step", "stepBtns")])}
<div style="padding:20px 24px 40px;max-width:1240px">
<nav aria-label="Breadcrumb" style="font-size:12.5px;color:$t3;display:flex;align-items:center;gap:6px;margin-bottom:8px"><a href="Main.dc.html" class="lk" style="color:$t3;text-decoration:none">Mandates</a>{icon("chevr", 12)}<span>{mono("MD-21", 12, "$t3")}</span></nav>
<div style="display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;margin-bottom:16px">
<h1 id="mf" style="margin:0;font-size:22px;line-height:30px;font-weight:600">Mandate · German food-processing plants</h1>{IF("isDraft", stage("Draft mandate"), True)}{IF("isReturned", gate_chip("returned", "G0 · Returned for revision"))}{IF("isSubmitted", gate_chip("awaiting", "G0 · Awaiting decision"))}{IF("isApproved", gate_chip("approved", "G0 · Approved"))}
<span style="font-size:12.5px;color:$t2">Version {hv("ver")} · BU Water · Growth 2027</span></div>
{IF("isReturned", '<div style="margin-bottom:16px">' + returned + '</div>')}
{IF("isSubmitted", '<div style="margin-bottom:16px">' + submitted_panel + '</div>')}
{IF("isApproved", '<div style="margin-bottom:16px">' + approved_panel + '</div>')}
<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<div style="flex:1 1 520px;min-width:0">{form}
<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:20px;padding-top:16px;border-top:1px solid $border">
<button type="button" class="bp" onClick="{hv("submit")}" disabled="{hv("cantSubmit")}" style="{BTN}border:1px solid $acc;color:#fff;{hv("submitStyle")}">Submit for G0</button>
{btn("Save draft", "s")}<span style="font-size:12.5px;color:$t2">{hv("submitNote")}</span></div></div>
<div style="flex:1 1 360px;min-width:0">{preview}</div>
</div></div>'''

js = logic(r"""    const s = this.state;
    const errs = [];
    if (!s.own) errs.push({ text: 'Name an accountable owner.' });
    if (!s.cur) errs.push({ text: 'Choose the currency for the spend ceiling.' });
    if (s.hz === '12m') errs.push({ text: 'Success is stated for end of year 3, but the mandate horizon is 12 months. Align them.' });
    const locked = s.step === 'submitted' || s.step === 'approved';
    const ok = (b) => b ? { glyph: '✓', st: 'color:$okf;font-weight:600;display:inline-flex;width:14px', label: '' } : { glyph: '○', st: 'color:$t3;display:inline-flex;width:14px', label: '' };
    const checks = [['Sponsor named', true], ['Objective and scope', true], ['Accountable owner', !!s.own], ['Currency stated', !!s.cur], ['Horizon consistent', s.hz !== '12m']]
      .map(c => Object.assign(ok(c[1]), { label: c[0] + (c[1] ? ' · met' : ' · open') }));
    return {
      noop: (e) => { if (e && e.preventDefault) e.preventDefault(); },
      stepBtns: [['draft', 'Draft · Maya'], ['returned', 'Returned with comment'], ['submitted', 'Submitted · Elena reviews'], ['approved', 'G0 approved']].map(o => ({ label: o[1], on: s.step === o[0] ? 'true' : 'false',
        pick: () => this.setState(o[0] === 'draft' ? { step: 'draft', own: '', cur: '', hz: '12m' } : o[0] === 'returned' ? { step: 'returned', own: '', cur: '', hz: '3y' } : { step: o[0], own: 'Maya Rao', cur: 'EUR', hz: '3y' }),
        style: this.segStyle(s.step === o[0]) })),
      ver: s.step === 'draft' ? '1' : '2',
      isDraft: s.step === 'draft', isReturned: s.step === 'returned', isSubmitted: s.step === 'submitted', isApproved: s.step === 'approved',
      hzBtns: this.seg([['12m', '12 months'], ['3y', '3 years']], 'hz'),
      curBtns: this.seg([['EUR', 'EUR'], ['CHF', 'CHF'], ['USD', 'USD']], 'cur'),
      ownBtns: this.seg([['Maya Rao', 'Maya Rao'], ['Jonas Klein', 'Jonas Klein'], ['Priya Shah', 'Priya Shah']], 'own'),
      errHz: s.hz === '12m', errHzMsg: 'Incompatible horizon: success is stated for end of year 3.',
      errCur: !s.cur, errCurMsg: 'Currency not specified.',
      errOwn: !s.own, errOwnMsg: 'Missing owner.',
      errors: errs, hasErrors: errs.length > 0 && !locked, errTitle: errs.length + (errs.length === 1 ? ' issue blocks' : ' issues block') + ' submission to G0',
      exclusions: s.exc, setExc: (e) => this.setState({ exc: e.target.value }),
      amount: s.amt, setAmt: (e) => this.setState({ amt: e.target.value }),
      hzText: s.hz === '3y' ? '3 years' : '12 months', amtText: s.cur ? (s.cur === 'EUR' ? '€' : s.cur + ' ') + s.amt : s.amt + ' [currency missing]', ownText: s.own || '[owner missing]',
      checks,
      cantSubmit: errs.length > 0 || locked,
      submitStyle: errs.length > 0 || locked ? 'background:$sunken;color:$t3;border-color:$border;cursor:not-allowed;' : '',
      submitNote: locked ? 'Submitted versions are read-only. Changes create v3.' : errs.length ? 'Fix the ' + errs.length + ' highlighted ' + (errs.length === 1 ? 'item' : 'items') + ' to submit.' : 'Routes to Elena Fischer for G0.',
      submit: () => { if (!errs.length) this.setState({ step: 'submitted' }); },
      gComment: s.gComment, setG: (e) => this.setState({ gComment: e.target.value }), noComment: !s.gComment,
      approveG0: () => this.setState({ step: 'approved' }),
      returnG0: () => { if (s.gComment) this.setState({ step: 'returned', own: '', cur: '' }); }
    };""", "{ step: 'draft', own: '', cur: '', hz: '12m', amt: '120,000', exc: 'No acquisitions · no price changes · no prospect outreach before G1', gComment: '' }")

page("Mandate.dc.html", "Mandate", shell("Mandates", "Fri 2 Oct 2026", content, user="MR", autosave="Saved · 2 min ago"), js, height=1500)
