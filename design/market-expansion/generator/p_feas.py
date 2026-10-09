from components import *

INP = "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"
nxt = next_block("G1 · Approve validation €15k", "Elena Fischer decides · due 16 Oct", "EF",
                 f'<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:$t2">{diamond("precond", 13)}Feasibility blockers listed · specialist review blocks G2 only</div>')
header = case_header("Feasibility", stage("Assessment"), 1, G_ASSESS, nxt, "Evidence checked 2 days ago · 1 source ageing", {"Feasibility": "1 pending", "Validation": "1 disputed"})

ST = {"Signed": ("$okf", "checkcircle"), "In review": ("$inf", "halfcircle"), "Pending": ("$ntf", "dashcircle"), "Requested": ("$inf", "send")}
status_cell = "".join(IF(f"r.is{k.replace(' ', '')}", f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:{c}">{icon(i, 15)}<span style="color:$t1">{hv("r.stLabel")}</span></span>') for k, (c, i) in ST.items())

COLS = "minmax(150px,1fr) minmax(200px,1.5fr) minmax(150px,1fr) minmax(170px,1.2fr) 80px minmax(170px,1.2fr)"
cells = [
    (f'<div style="font-weight:600">{hv("r.dim")}</div><div style="font-size:12px;color:$t3;margin-top:2px">{hv("r.q")}</div>', False),
    (f'<span style="display:inline-flex;gap:6px;align-items:flex-start">{icon("filetext", 13, "$evf")}<span>{hv("r.ev")}</span></span>', False),
    (f'<span style="display:inline-flex;align-items:center;gap:8px">{avatar(hv("r.ini"), 22)}<span style="line-height:16px">{hv("r.who")}</span></span>', False),
    (f'{status_cell}<div style="font-size:12px;color:$t2;margin-top:3px">{hv("r.scope")}</div>{IF("r.isSpec", f"<div style=\"margin-top:5px\">{ai("AI cannot provide this review")}</div>")}', False),
    (f'<span style="color:$t2">{hv("r.due")}</span>', False),
    (f'''{IF("r.hasBlocker", f'<span style="display:inline-flex;gap:6px;align-items:flex-start;color:$wnf;font-weight:500">{icon("alert", 14)}<span style="color:$t1">{hv("r.blocker")}</span></span>')}{IF("r.noBlocker", '<span style="color:$t3">None</span>')}
{IF("r.hasDis", f'<div style="margin-top:6px;display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:$wnf">{icon("message", 13)}<span style="color:$t1">{hv("r.dis")}</span></div>')}
<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">{IF("r.canRequest", f'<button type="button" class="bg" onClick="{hv("r.request")}" style="{BTN}min-height:28px;padding:0 8px;font-size:12px;border:1px solid $bstrong;color:$t1">Request review</button>')}
<button type="button" class="bg" onClick="{hv("r.disagree")}" style="{BTN}min-height:28px;padding:0 8px;font-size:12px;border:1px solid transparent;color:$t2">Record disagreement</button></div>''', False)]
tbl = gtable(COLS, ["Dimension", "Evidence", "Reviewer", "Status · scope of sign-off", "Due", "Blocker"], FOR("rows", "r", grow(COLS, cells, "r.style"), 7), minw=1000, aria="Readiness checklist")

form = f'''<div role="dialog" aria-labelledby="dg-t" style="border:1px solid $border;border-radius:8px;padding:14px 16px;background:$canvas;display:flex;flex-direction:column;gap:10px">
<div id="dg-t" style="font-size:14px;font-weight:600">Record disagreement · {hv("disDim")}</div>
<div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13px"><span style="color:$t2">Recorded by</span>{person("MR")}<span style="color:$t2">· visible in the G1 and G2 packages as a signed position</span></div>
<label for="dg-x" style="font-size:12.5px;font-weight:500">Your position, in your own words (required)<textarea id="dg-x" rows="2" value="{hv("disText")}" onChange="{hv("setDis")}" style="{INP};margin-top:6px"></textarea></label>
<div style="display:flex;gap:8px"><button type="button" class="bd" onClick="{hv("saveDis")}" disabled="{hv("noDis")}" style="{BTN}border:1px solid $t1;color:#fff">Record disagreement</button>{btn("Cancel", "g", handler="cancelDis")}</div></div>'''

summary = f'''<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;font-size:13px">{review("Signed")}<span style="color:$t2;margin-left:-12px">{hv("nSigned")}</span>
{review("In review")}<span style="color:$t2;margin-left:-12px">{hv("nReview")}</span>{review("Pending")}<span style="color:$t2;margin-left:-12px">{hv("nPending")}</span>
{review("Blocker")}<span style="color:$t2;margin-left:-12px">1</span><span style="margin-left:auto;font-size:12.5px;color:$t3">No readiness score: each dimension stands on its own sign-off.</span></div>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
{h2("Feasibility and ability to win", "Each dimension has a named human reviewer. A missing review shows as pending — never as a green check.")}
{summary}
{IF("showForm", form)}
<div style="border:1px solid $border;border-radius:8px;overflow:hidden">{tbl}</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
<section aria-labelledby="sp" style="border:1px solid $border;border-radius:8px;padding:14px 16px">{h2("Specialist question · Lena Hoffmann", "Drafted with AI assistance, edited by Maya Rao. The answer is human-owned.", hid="sp")}
<p style="margin:0;font-family:$serif;font-size:16px;line-height:26px">“Can Aster run a bounded pilot of the existing monitoring system at up to 4 German food-processing sites for 90 days, and what requirements apply? Please state the scope your answer covers.”</p>
<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;align-items:center">{review("Pending", "human review required · due 20 Nov")}{btn("Resolve blocker", "s", disabled=True)}{btn("Restrict scope", "s", disabled=True)}</div>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Resolve or restrict scope becomes available once Lena Hoffmann records a position. A pilot sign-off will not cover scale.</p></section>
<section aria-labelledby="cp" style="border:1px solid $border;border-radius:8px;padding:14px 16px">{h2("Competition", "Listed with sources; no proprietary scores", hid="cp")}
<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13px">
<li style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Established suppliers at large plants</span>{src("Trade survey", "2026", "Some")}</li>
<li style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>Fragmented service providers at small plants</span>{kind("Unknown", "section incomplete", small=True)}</li></ul></section></div>
</div>'''

js = logic(r"""    const s = this.state;
    const base = [
      { id: 'pf', dim: 'Product fit', q: 'Does the product fit the target workflow?', ev: 'Workflow comparison memo v1 · demo 21 Oct', ini: 'PS', who: 'Priya Shah', st: 'In review', scope: 'Pilot workflow only', due: '21 Oct' },
      { id: 'df', dim: 'Differentiation', q: 'Why would plants choose us?', ev: 'Feature comparison memo v2', ini: 'PS', who: 'Priya Shah', st: 'Signed', scope: 'Signed by Priya Shah · v2 · 12 Oct', due: '12 Oct' },
      { id: 'ca', dim: 'Commercial access', q: 'Can we reach buyers?', ev: 'Partner coverage list · 500 sites', ini: 'JK', who: 'Jonas Klein', st: 'Signed', scope: 'Signed · reach stays an Assumption', due: '12 Oct' },
      { id: 'op', dim: 'Operations', q: 'Can we install and support?', ev: 'Capacity model v1 · 120 customers', ini: 'OL', who: '[Operations lead]', st: 'Pending', scope: 'Not yet reviewed', due: '23 Oct' },
      { id: 'sp', dim: 'Specialist review', q: 'Legal and regulatory requirements', ev: 'Question drafted · bounded pilot scope', ini: 'LH', who: 'Lena Hoffmann', st: 'Pending', scope: 'Pending — human review required', due: '20 Nov', blocker: 'Blocks G2 until signed', spec: true },
      { id: 'ch', dim: 'Channel', q: 'Will the partner sell and install?', ev: 'Partner agreement terms (draft)', ini: 'JK', who: 'Jonas Klein', st: 'In review', scope: 'Terms for pilot sites', due: '19 Oct' },
      { id: 'co', dim: 'Competition', q: 'Who else serves these plants?', ev: 'Competitor scan · partial', ini: 'MR', who: 'Maya Rao', st: 'In review', scope: 'Small-plant segment incomplete', due: '19 Oct' }
    ];
    const rows = base.map(r => {
      const st = s.req[r.id] && r.st === 'Pending' ? 'Requested' : r.st;
      return Object.assign({}, r, {
        isSigned: st === 'Signed', isInreview: st === 'In review', isPending: st === 'Pending', isRequested: st === 'Requested',
        stLabel: st === 'Requested' ? 'Review requested · 14 Oct' : r.spec ? 'Pending' : st,
        isSpec: !!r.spec, hasBlocker: !!r.blocker, noBlocker: !r.blocker,
        hasDis: !!s.dis[r.id], dis: s.dis[r.id] ? 'Disagreement · ' + s.dis[r.id] : '',
        canRequest: st === 'Pending' && !r.spec, request: () => this.setState({ req: Object.assign({}, s.req, { [r.id]: true }) }),
        disagree: () => this.setState({ disId: r.id, disText: '' }),
        style: s.disId === r.id ? 'background:$accbg' : (r.spec ? 'background:$canvas' : '')
      });
    });
    const cur = base.find(r => r.id === s.disId);
    return {
      rows, showForm: !!s.disId, disDim: cur ? cur.dim : '', disText: s.disText, setDis: (e) => this.setState({ disText: e.target.value }), noDis: !s.disText,
      saveDis: () => { if (s.disText) this.setState({ dis: Object.assign({}, s.dis, { [s.disId]: 'Maya Rao · 14 Oct: “' + s.disText + '”' }), disId: null, disText: '' }); },
      cancelDis: () => this.setState({ disId: null, disText: '' }),
      nSigned: '2', nReview: '3', nPending: '2'
    };""", "{ req: {}, dis: { df: 'Jonas Klein · 13 Oct: “Differentiation is overstated for large plants; incumbents already offer this.”' }, disId: null, disText: '' }")

page("Feasibility.dc.html", "Feasibility", shell("Expansion Cases", "Wed 14 Oct 2026", header + body, user="MR", autosave="Saved · just now"), js, height=1500)
