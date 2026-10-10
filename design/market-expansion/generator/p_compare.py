from components import *

UNK = kind("Unknown", small=True)
C = [("German food-processing plants", "OPP-07"), ("Dutch food-processing plants", "OPP-14"), ("Austrian breweries", "OPP-09"), ("Swiss food-processing plants", "OPP-16")]


def rating(level, note="", k="Assumption"):
    n = {"High": 3, "Medium": 2, "Low": 1}[level]
    return f'<div style="display:flex;flex-direction:column;gap:3px"><span style="display:inline-flex;gap:6px;align-items:center;font-weight:500">{sens(level)}<span style="font-size:12px;color:$t3;font-family:$mono">{n}/3</span></span>{f"<span style=\'font-size:12px;color:$t2\'>{note}</span>" if note else ""}</div>'


ROWS = [
    ("Market boundary", [
        "Annual spend · unique sites · Germany · EUR · 2026",
        "Annual spend · unique sites · Netherlands · EUR · 2026",
        f'<span style="display:flex;gap:6px;align-items:flex-start;color:$wnf">{icon("alert", 14)}<span style="color:$t1">Annual spend · <b style="font-weight:600">companies, not sites</b> · Austria · EUR · <b style="font-weight:600">2024 prices</b></span></span>',
        "Annual spend · unique sites · Switzerland · EUR · 2026"]),
    ("TAM · annual market spend", [f'<b style="font-weight:600">€100m/year</b><div style="font-size:12px;color:$t2">5,000 sites × €20k</div>{kind("Evidence", small=True)} {kind("Assumption", "price", small=True)}', UNK + '<div style="font-size:12px;color:$t2;margin-top:3px">Not sized</div>', '<span style="color:$t2">Not comparable until normalized</span>', UNK + '<div style="font-size:12px;color:$t2;margin-top:3px">Not sized</div>']),
    ("SAM · annual market spend", [f'<b style="font-weight:600">€40m/year</b><div style="font-size:12px;color:$t2">2,000 unique sites</div>', UNK, '<span style="color:$t2">Not comparable</span>', UNK]),
    ("Growth evidence", [f'{evq("Some")}<div style="font-size:12px;color:$t2;margin-top:3px">2 trade sources · 2026</div>', f'{evq("Weak")}<div style="font-size:12px;color:$t2;margin-top:3px">1 source · 2025</div>', f'{evq("Weak")}<div style="font-size:12px;color:$t2;margin-top:3px">1 news item</div>', f'{evq("Weak")}<div style="font-size:12px;color:$t2;margin-top:3px">1 source · 2026</div>']),
    ("Product fit", [rating("High", "Demo pending · Priya Shah"), rating("High", "Same workflow as Germany"), rating("Medium", "Brewing adaptations likely"), rating("Medium", "Same workflow; language variants")]),
    ("Channel access", [rating("High", "Partner covers 500 sites · Assumption"), UNK + '<div style="font-size:12px;color:$t2;margin-top:3px">Partner coverage unclear</div>', rating("Low", "No partner today"), rating("Medium", "Partner covers part of the market")]),
    ("Evidence coverage", [rating("Medium", "3 sources"), rating("Low", "2 sources"), rating("Low", "1 source"), rating("Low", "1 source")]),
    ("Investment need", ["Validation €15k, then pilot up to €120k · 90 days", UNK, UNK, UNK]),
    ("Readiness blockers", [f'{review("Pending", "specialist review")}', "Partner coverage unclear", "No channel", "Specialist requirements unknown"]),
    ("Unknowns", ["Adoption rate · specialist requirements", "Site count · price · channel", "Site count · price · adoption · channel", "Site count · price · adoption"]),
]


def th_c(i, name, oid):
    return (f'<th scope="col" style="{TH};min-width:200px;white-space:normal;vertical-align:bottom"><span style="display:flex;gap:8px;align-items:center;color:$t1;font-size:13.5px;font-weight:600">{cat_mark(i + 1, 12)}{name}</span>'
            f'<span style="display:block;margin-top:2px">{mono(oid, 12)}</span></th>')


head = f'<tr><th scope="col" style="{TH};width:170px">Attribute</th>{"".join(th_c(i, n, o) for i, (n, o) in enumerate(C))}</tr>'
body = "".join(f'<tr class="hr"><th scope="row" style="{TD};text-align:left;font-weight:500;color:$t2;font-size:12.5px">{r}</th>{"".join(f"<td style=\"{TD}\">{c}</td>" for c in cells)}</tr>' for r, cells in ROWS)
rank_cells = "".join(f'<td style="{TD};background:$canvas">{IF(f"rk{i}.ranked", f"<span style=\"display:flex;flex-direction:column;gap:2px\"><b style=\"font-weight:600;font-size:14px\">{hv(f'rk{i}.label')}</b><span style=\"font-family:$mono;font-size:12px;color:$t2\">{hv(f'rk{i}.score')}</span></span>", True)}{IF(f"rk{i}.notRanked", f"<span style=\"display:flex;gap:6px;align-items:flex-start;font-size:12.5px;color:$t2\">{icon('dashcircle', 13)}<span>{hv(f'rk{i}.reason')}</span></span>")}</td>' for i in range(4))
sel_cells = "".join(f'<td style="{TD}">{btn("Select for assessment", "s", href="Thesis.dc.html") if i == 0 else btn("Select for assessment", "s", disabled=True) if i == 2 else btn("Select for assessment", "s", href="Opportunities.dc.html")}</td>' for i in range(4))
grid_table = f'''<div style="overflow-x:auto"><table aria-label="Candidate comparison" style="width:100%;border-collapse:collapse;min-width:980px">
<thead>{head}</thead><tbody>{body}
<tr><th scope="row" style="{TD};text-align:left;font-weight:600;font-size:12.5px;background:$canvas">Weighted ranking<div style="font-weight:400;color:$t3;font-size:12px">{hv("wLabel")}</div></th>{rank_cells}</tr>
<tr><th scope="row" style="{TD};text-align:left;font-weight:500;color:$t2;font-size:12.5px">Action</th>{sel_cells}</tr></tbody></table></div>'''


def stepper(key, label):
    return f'''<div style="display:flex;flex-direction:column;gap:4px;min-width:150px"><span style="font-size:12.5px;font-weight:500">{label}</span>
<div style="display:flex;align-items:center;gap:6px"><button type="button" class="bs" aria-label="Decrease {label} weight" onClick="{hv(key + "Dn")}" style="width:32px;height:32px;border:1px solid $bstrong;border-radius:6px;font:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center">{icon("minus", 14)}</button>
<output aria-live="polite" style="min-width:48px;text-align:center;font-family:$mono;font-size:14px;font-weight:500">{hv(key)}%</output>
<button type="button" class="bs" aria-label="Increase {label} weight" onClick="{hv(key + "Up")}" style="width:32px;height:32px;border:1px solid $bstrong;border-radius:6px;font:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center">{icon("plus", 14)}</button></div></div>'''


weights = f'''<section aria-labelledby="wt" style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">
<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline"><h2 id="wt" style="margin:0;font-size:14px;font-weight:600">Optional weighted ranking</h2>
<span style="font-size:12.5px;color:$t2">Applied: weights {hv("appliedVer")} · {hv("appliedText")}</span></div>
<div style="font-family:$mono;font-size:12.5px;padding:8px 10px;background:$canvas;border:1px solid $border;border-radius:6px;overflow-x:auto">Score = Product fit × w₁ + Channel access × w₂ + Evidence coverage × w₃ · ratings 1–3 · any Unknown input → not ranked · size not used (only 1 of 4 candidates is sized)</div>
<div style="display:flex;flex-wrap:wrap;gap:16px 28px;align-items:flex-end">{stepper("wF", "Product fit")}{stepper("wA", "Channel access")}{stepper("wE", "Evidence coverage")}
<div style="display:flex;flex-direction:column;gap:6px"><span role="status" style="font-size:12.5px;{hv("totalStyle")}">{hv("totalText")}</span>
<div style="display:flex;gap:8px"><button type="button" class="bp" onClick="{hv("apply")}" disabled="{hv("cantApply")}" style="{BTN}{hv("applyStyle")}">Apply weights</button>{btn("Reset", "g", handler="reset")}</div></div></div>
{IF("previewing", f'<div style="font-size:12.5px;color:$inf;display:flex;gap:6px;align-items:center">{icon("eye", 14)}<span style="color:$t1">Previewing unapplied weights in the ranking row. Applying creates weights {hv("nextVer")}; earlier versions are kept.</span></div>')}
</section>'''

block = f'''{IF("blocked", banner("warn", "Aggregate ranking blocked — incomparable market boundary", "Austrian breweries uses company counts and 2024 prices. Other candidates use unique sites and 2026 prices. Normalize it, or exclude it until normalized.", btn("Exclude until normalized", "s", handler="exclude") + btn("Request normalization", "g")), True)}
{IF("excluded", banner("neutral", "Austrian breweries excluded from ranking until normalized", "It stays in the comparison. Ranking covers the remaining candidates with complete inputs.", btn("Include again", "g", handler="include")))}'''

content = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
<div style="flex:1 1 400px;min-width:0"><nav aria-label="Breadcrumb" style="font-size:12.5px;color:$t3;display:flex;align-items:center;gap:6px;margin-bottom:4px"><a href="Opportunities.dc.html" class="lk" style="color:$t3;text-decoration:none">Opportunities</a>{icon("chevr", 12)}<span>Compare</span></nav>
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">Compare 4 candidates</h1>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Common unit: annual spend on water monitoring · unique sites · EUR · 2026 prices · horizon 3 years. Missing values show as Unknown, never 0.</p></div>
<span style="font-size:12.5px;color:$t2">Up to 4 candidates</span></div>
{block}
{weights}
<div style="border:1px solid $border;border-radius:8px;overflow:hidden">{grid_table}</div>
<p style="margin:0;font-size:12.5px;color:$t3">Ratings are assessments by the named reviewers, not computed confidence. Selecting a candidate opens assessment; it does not approve spend.</p>
</div>'''

js = logic(r"""    const s = this.state;
    const R = [{ f: 3, a: 3, e: 2 }, { f: 3, a: null, e: 1 }, { f: 2, a: 1, e: 1 }, { f: 2, a: 2, e: 1 }];
    const W = s.prev || s.applied;
    const total = W.f + W.a + W.e;
    const blocked = !s.exclude;
    const score = (r) => (r.f * W.f + r.a * W.a + r.e * W.e) / 100;
    const ranked = R.map((r, i) => ({ i, r })).filter(x => x.r.a !== null && x.i !== 2);
    const order = ranked.slice().sort((a, b) => score(b.r) - score(a.r)).map(x => x.i);
    const rk = R.map((r, i) => {
      if (blocked) return { ranked: false, notRanked: true, reason: 'Not ranked — boundary conflict in set' };
      if (i === 2) return { ranked: false, notRanked: true, reason: 'Excluded until normalized' };
      if (r.a === null) return { ranked: false, notRanked: true, reason: 'Not ranked — 1 input missing (channel access)' };
      if (total !== 100) return { ranked: false, notRanked: true, reason: 'Weights must total 100%' };
      return { ranked: true, notRanked: false, label: 'Rank ' + (order.indexOf(i) + 1) + ' of ' + order.length, score: score(r).toFixed(1) + ' of 3' };
    });
    const step = (k, d) => () => { const w = Object.assign({}, s.prev || s.applied); w[k] = Math.max(0, Math.min(100, w[k] + d)); this.setState({ prev: w }); };
    const fmt = (w) => 'Fit ' + w.f + '% · Access ' + w.a + '% · Evidence ' + w.e + '%';
    const canApply = !!s.prev && total === 100;
    return {
      rk0: rk[0], rk1: rk[1], rk2: rk[2], rk3: rk[3],
      wF: W.f, wA: W.a, wE: W.e,
      wFUp: step('f', 10), wFDn: step('f', -10), wAUp: step('a', 10), wADn: step('a', -10), wEUp: step('e', 10), wEDn: step('e', -10),
      wLabel: (s.prev ? 'Preview · ' : '') + fmt(W),
      totalText: 'Total ' + total + '%' + (total === 100 ? '' : ' — must be 100%'), totalStyle: total === 100 ? 'color:$t2' : 'color:$wnf;font-weight:600',
      appliedVer: 'v' + s.ver, appliedText: fmt(s.applied) + ' · Maya Rao · 8 Oct', nextVer: 'v' + (s.ver + 1),
      previewing: !!s.prev, cantApply: !canApply,
      applyStyle: canApply ? 'background:$acc;color:#fff;border:1px solid $acc;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;',
      apply: () => { if (canApply) this.setState({ applied: s.prev, prev: null, ver: s.ver + 1 }); },
      reset: () => this.setState({ prev: null }),
      blocked, excluded: !blocked, exclude: () => this.setState({ exclude: true }), include: () => this.setState({ exclude: false })
    };""", "{ applied: { f: 40, a: 30, e: 30 }, prev: null, ver: 1, exclude: false }")

page("Compare.dc.html", "Compare Opportunities", shell("Compare", "Thu 8 Oct 2026", content, user="MR"), js, height=1500)
