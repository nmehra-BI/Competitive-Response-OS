from components import *

SER = "margin:0;font-family:$serif;font-size:17px;line-height:28px;color:$t1"
INP = "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"

nxt = next_block("G1 · Approve validation €15k", "Elena Fischer decides · Maya Rao submits · due 16 Oct", "EF",
                 f'<div style="display:flex;gap:6px;align-items:center;margin-top:8px;font-size:12.5px;color:$t2">{diamond("precond", 13)}Preconditions 3 of 4 met · <a href="Feasibility.dc.html" class="lk" style="text-decoration:none">Why?</a></div>')
header = case_header("Thesis", stage("Assessment"), 1, G_ASSESS, nxt, "Evidence checked 2 days ago · 1 source ageing", {"Feasibility": "1 pending", "Validation": "1 disputed"})

strip = f'''<div role="region" aria-label="Analysis status" style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:8px 12px;border:1px solid $border;border-radius:8px;background:$canvas">
{IF("runWorking", run("Working: checking sources…", "· competitor scan · started 10:41 · your edits are saved"), True)}
{IF("runPartial", run("Partial results", "· competition section incomplete · your edits are saved"))}
{IF("runDone", run("Done", "· 14 Oct, 10:52 · competition sources added"))}
<span style="margin-left:auto;display:flex;gap:8px;align-items:center"><span style="font-size:12px;color:$t3">Prototype</span>{seg("runBtns", "Analysis state")}</span></div>'''

hero = f'''<section aria-label="Thesis summary" style="border:1px solid $border;border-radius:8px;padding:20px 22px;background:$surface;display:flex;flex-direction:column;gap:14px">
<div>{eyebrow("Proposition")}<p style="{SER};font-size:19px;line-height:30px">Offer our existing water-monitoring system to German food-processing plants as a monitored service, at about €20k per site per year.</p></div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 20px">
<div>{eyebrow("Intended customer")}<p style="{SER};font-size:15.5px;line-height:24px">Plant and quality managers at food-processing sites with a process-water treatment step.</p></div>
<div>{eyebrow("Why now")}<p style="{SER};font-size:15.5px;line-height:24px">Two 2026 trade sources report rising attention to process-water monitoring in food plants. Our partner already covers part of the segment.</p></div>
<div>{eyebrow("Next decision")}<div style="display:flex;gap:8px;align-items:flex-start">{diamond("precond", 16)}<div style="font-size:13.5px;line-height:20px"><b style="font-weight:600">G1 · Approve validation €15k</b><div style="color:$t2;font-size:12.5px">Elena Fischer · due 16 Oct · 20 sites, 8 interviews, 4 paid commitments</div></div></div></div>
</div></section>'''

claim = f'''<li style="padding:12px 0;border-bottom:1px solid $border;display:flex;flex-direction:column;gap:6px">
<p style="{SER};font-size:16px;line-height:26px">{hv("c.text")}</p>
<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center">
{IF("c.isEv", kind("Evidence", hv("c.kx")))}{IF("c.isAs", kind("Assumption", hv("c.kx")))}{IF("c.isSc", kind("Scenario", hv("c.kx")))}{IF("c.isUnk", kind("Unknown", hv("c.kx")))}{IF("c.isAI", ai())}
{IF("c.hasSrc", f'<a href="Evidence.dc.html" class="chip" style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;border:1px solid $border;font-size:12px;color:$t2;text-decoration:none;white-space:nowrap">{icon("filetext", 12, "$evf")}{hv("c.src")}</a>')}
{IF("c.disputed", f'<a href="Validation.dc.html" style="display:inline-flex;gap:4px;align-items:center;font-size:12px;color:$wnf;font-weight:500;text-decoration:none">{icon("message", 13)}Disputed by Daniel Weber</a>')}
<span style="margin-left:auto;display:flex;gap:6px">
{IF("c.isAI", f'<button type="button" class="bs" onClick="{hv("c.accept")}" style="{BTN}min-height:30px;padding:0 10px;font-size:12.5px;border:1px solid $bstrong;color:$t1">Accept as assumption</button><button type="button" class="bg" onClick="{hv("c.discard")}" style="{BTN}min-height:30px;padding:0 10px;font-size:12.5px;border:1px solid transparent;color:$t2">Discard</button>')}
{IF("c.canChallenge", f'<button type="button" class="bg" onClick="{hv("c.challenge")}" style="{BTN}min-height:30px;padding:0 10px;font-size:12.5px;border:1px solid transparent;color:$t2">{icon("message", 13)}Challenge</button>')}
</span></div>
{IF("c.challenging", f'<div style="display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid $border;border-radius:8px;background:$canvas"><label for="chg" style="font-size:12.5px;font-weight:500">What is wrong or unsupported? (required)</label><textarea id="chg" rows="2" value="{hv("chText")}" onChange="{hv("setCh")}" style="{INP}"></textarea><div style="display:flex;gap:8px"><button type="button" class="bd" onClick="{hv("sendCh")}" disabled="{hv("noCh")}" style="{BTN}border:1px solid $t1;color:#fff">Send challenge to owner</button>{btn("Cancel", "g", handler="cancelCh")}</div></div>')}
{IF("c.challenged", f'<div role="status" style="font-size:12.5px;color:$wnf;display:flex;gap:6px;align-items:center">{icon("message", 13)}<span style="color:$t1">Challenge open · {hv("c.chNote")}</span></div>')}
</li>'''

claims = f'<section aria-labelledby="cl" style="margin-top:8px">{h2("Claims", "Every claim carries its kind. Plain text without a kind is not allowed.", hid="cl")}<ul style="list-style:none;margin:0;padding:0;border-top:1px solid $border">{FOR("claims", "c", claim, 6)}</ul></section>'


def section(title, sub, inner, sid):
    return f'<section aria-labelledby="{sid}" style="margin-top:28px">{h2(title, sub, hid=sid)}{inner}</section>'


reasons = f'''<ul style="margin:0;padding-left:20px;font-family:$serif;font-size:16px;line-height:26px">
<li>The existing product already monitors comparable process-water steps. {review("Pending", "demo with Priya Shah")}</li>
<li>Partner coverage of food plants in Germany. {assumption_chip("Channel reaches 500 sites", "Jonas Klein")}</li>
<li>Installation and support capacity sized for a bounded entry. {assumption_chip("Capacity 120 customers", "[Operations lead]")}</li></ul>'''

alts = table(["Alternative", "What it means", "Status"], [
    ['<b style="font-weight:600">No entry</b>', "Keep focus on current segments. No spend now; we forgo the learning.", '<span style="color:$t2">Considered · kept as fallback</span>'],
    ['<b style="font-weight:600">Partner resale only</b>', "Partner sells; we do not run a pilot. Lower spend, weaker evidence on deployment effort.", '<span style="color:$t2">Considered · not preferred</span>'],
    ['<b style="font-weight:600">Dutch food-processing plants first</b>', "Same segment, other market. Channel access unknown.", '<span style="color:$t2">Not ranked · 1 input missing</span>'],
    ['<b style="font-weight:600">Validate, then request a pilot</b>', "G1 validation €15k now; G2 pilot only if thresholds are met.", '<span style="color:$acc;font-weight:500">Recommended</span>'],
], minw=620)

crit = f'''<div style="display:flex;flex-wrap:wrap;gap:8px">{assumption_chip("20% adoption by year 3", "Maya Rao", True)}{assumption_chip("€20k annual price", "Maya Rao")}{assumption_chip("Channel reaches 500 sites", "Jonas Klein")}{assumption_chip("Specialist requirements can be met", "Lena Hoffmann")}{assumption_chip("Capacity 120 customers", "[Operations lead]")}</div>
<a href="Validation.dc.html" class="lk" style="display:inline-flex;gap:4px;align-items:center;margin-top:8px;font-size:12.5px;font-weight:500;text-decoration:none">Open register · sorted by decision sensitivity{icon("chevr", 13)}</a>'''

blockers = f'''<div style="display:flex;flex-direction:column;gap:8px">
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 12px;border:1px solid $border;border-radius:8px">{review("Blocker")}<span style="flex:1 1 260px;font-size:13px">Specialist review not started. Blocks G2 (pilot), not G1.</span>{person("LH", "due 20 Nov")}</div>
<div style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:10px 12px;border:1px solid $border;border-radius:8px">{review("Pending")}<span style="flex:1 1 260px;font-size:13px">Product-fit demo pending.</span>{person("PS", "due 21 Oct")}</div></div>'''

reco = f'''<div style="border:1px dashed $ctrl;border-radius:8px;padding:14px 16px;background:$canvas">
<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px"><span style="font-size:12px;font-weight:600;color:$t2">RECOMMENDATION · NOT A DECISION</span><span style="font-size:12px;color:$t3">Maya Rao · 14 Oct</span></div>
<p style="{SER};font-size:16px;line-height:26px">Request G1 validation of €15k: approach 20 selected sites through the partner channel and aim for 8 completed interviews and 4 paid pilot commitments before any pilot request.</p></div>'''

submit = f'''<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:16px;padding-top:16px;border-top:1px solid $border">
{IF("notSubmitted", f'<button type="button" class="bp" onClick="{hv("submitG1")}" style="{BTN}border:1px solid $acc;color:#fff">{diamond("ready", 15)}Submit for G1 · validation €15k</button>', True)}
{IF("submitted", gate_chip("awaiting", "G1 submitted · awaiting Elena Fischer"))}
{btn("Edit thesis", "s", ic="pencil")}{btn("Request analysis", "s", ic="sparkle")}{btn("Assign reviewer", "s", ic="users")}
<span style="font-size:12.5px;color:$t2">{hv("submitNote")}</span></div>'''

rail_ = f'''<aside aria-label="Context" style="display:flex;flex-direction:column;gap:14px">
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px">{eyebrow("Market boundary")}
<dl style="margin:0;display:grid;grid-template-columns:96px 1fr;gap:4px 8px;font-size:13px"><dt style="color:$t3">Unit</dt><dd style="margin:0">Annual spend on water monitoring</dd><dt style="color:$t3">Population</dt><dd style="margin:0">Unique sites</dd><dt style="color:$t3">Geography</dt><dd style="margin:0">Germany · food processing</dd><dt style="color:$t3">Currency</dt><dd style="margin:0">EUR · 2026 prices</dd><dt style="color:$t3">Horizon</dt><dd style="margin:0">3 years</dd></dl>
<a href="Sizing.dc.html" class="lk" style="display:inline-flex;gap:4px;align-items:center;margin-top:8px;font-size:12.5px;font-weight:500;text-decoration:none">Open sizing{icon("chevr", 13)}</a></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px">{eyebrow("Reviewers")}
<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px">
<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">{person("DW", "Economics")}{review("Disagreement")}</li>
<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">{person("PS", "Product fit")}{review("Pending")}</li>
<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">{person("LH", "Specialist")}{review("Pending")}</li>
<li style="display:flex;justify-content:space-between;gap:8px;align-items:center">{person("JK", "Commercial access")}{review("In review")}</li></ul></div>
<div style="border:1px solid $border;border-radius:8px;padding:12px 14px">{eyebrow("Activity")}<ul style="list-style:none;margin:0;padding:0">
{activity_item("DW", "Disputed 20% adoption", "Economics v2", "14 Oct, 10:02")}{activity_item("MR", "Sizing snapshot v2", "Overlap −500 confirmed", "13 Oct, 16:30")}{activity_item("EF", "Approved mandate (G0)", "Scope v2", "5 Oct", True)}</ul></div></aside>'''

body = f'''<div style="padding:16px 24px 40px;display:flex;flex-direction:column;gap:16px;max-width:1280px">
{strip}
<div style="display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start">
<div style="flex:999 1 600px;min-width:0;max-width:820px">
{hero}
{claims}
{section("Reasons to win", "Tied to the core product, not to market size", reasons, "rw")}
{section("Alternatives", "Includes no entry", card(alts, "overflow:hidden"), "al")}
{section("Critical assumptions", "Top 5 from the register", crit, "ca")}
{section("Disagreements", "Signed, in the reviewer’s words", dissent("DW", "I do not see comparable evidence for 20% adoption in this segment. Plan on 10% until the pilot shows paid use.", "14 Oct, 10:02", "Scope: adoption assumption · Economics v2"), "dg")}
{section("Blockers", "Open items that stop a gate", blockers, "bl")}
{section("Recommendation", "", reco, "rc")}
{submit}
</div>
<div style="flex:1 1 300px;min-width:0">{rail_}</div></div></div>'''

js = logic(r"""    const s = this.state;
    const base = [
      { id: 'c1', text: '5,000 food-processing sites in Germany operate a process-water treatment step.', k: 'ev', kx: 'Site census 2026', src: 'Site census · 3 Jun 2026' },
      { id: 'c2', text: 'Our partner channel reaches 500 of the eligible sites.', k: 'as', kx: 'Jonas Klein' },
      { id: 'c3', text: 'Sites spend about €20k per year on monitoring of this kind.', k: 'as', kx: 'Maya Rao', src: 'Trade survey · 2026' },
      { id: 'c4', text: 'Base scenario: 100 customers and €2.0m annual revenue at end of year 3, below the 120-customer capacity.', k: 'sc', kx: 'Base · Year 3', disputed: true },
      { id: 'c5', text: s.run === 'done' ? 'Established suppliers serve large plants; smaller plants are fragmented.' : 'Who already serves these plants, and on what terms.', k: s.run === 'done' ? 'ev' : 'unk', kx: s.run === 'done' ? 'Trade survey 2026' : 'competition section incomplete', src: s.run === 'done' ? 'Trade survey · 2026' : '' },
      { id: 'c6', text: 'Smaller plants may prefer a service contract over buying equipment.', k: s.ai === 'accepted' ? 'as' : 'ai', kx: s.ai === 'accepted' ? 'accepted by Maya Rao' : 'not yet accepted' }
    ].filter(c => !(c.id === 'c6' && s.ai === 'discarded'));
    const claims = base.map(c => ({
      text: c.text, kx: c.kx, src: c.src || '', hasSrc: !!c.src,
      isEv: c.k === 'ev', isAs: c.k === 'as' || c.k === 'ai', isSc: c.k === 'sc', isUnk: c.k === 'unk', isAI: c.k === 'ai', disputed: !!c.disputed,
      canChallenge: c.k !== 'ai' && s.ch !== c.id && !s.sent[c.id], challenging: s.ch === c.id, challenged: !!s.sent[c.id], chNote: s.sent[c.id] || '',
      challenge: () => this.setState({ ch: c.id, chText: '' }),
      accept: () => this.setState({ ai: 'accepted' }), discard: () => this.setState({ ai: 'discarded' })
    }));
    return {
      runBtns: this.seg([['working', 'Working'], ['partial', 'Partial'], ['done', 'Done']], 'run'),
      runWorking: s.run === 'working', runPartial: s.run === 'partial', runDone: s.run === 'done',
      claims, chText: s.chText, setCh: (e) => this.setState({ chText: e.target.value }), noCh: !s.chText,
      sendCh: () => { if (s.chText) this.setState({ sent: Object.assign({}, s.sent, { [s.ch]: 'sent to owner · 14 Oct, 11:05' }), ch: null, chText: '' }); },
      cancelCh: () => this.setState({ ch: null, chText: '' }),
      notSubmitted: !s.submitted, submitted: s.submitted, submitG1: () => this.setState({ submitted: true }),
      submitNote: s.submitted ? 'Snapshot v1 sent to Elena Fischer. Editing creates a new version.' : 'Submitting sends a read-only snapshot. Validation spend starts only after approval.'
    };""", "{ run: 'working', ai: 'proposed', ch: null, chText: '', sent: {}, submitted: false }")

page("Thesis.dc.html", "Expansion Thesis", shell("Expansion Cases", "Wed 14 Oct 2026", header + body, user="MR", autosave="Saved · 2 min ago"), js, height=2000)
