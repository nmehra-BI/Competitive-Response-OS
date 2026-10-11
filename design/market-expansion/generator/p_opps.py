from components import *

INP = "width:100%;box-sizing:border-box;min-height:36px;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"

COLS = "minmax(220px,1.5fr) minmax(200px,1.5fr) 132px 126px"
cells = [
 (f'''<button type="button" onClick="{hv("o.pick")}" aria-pressed="{hv("o.sel")}" style="background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:3px;line-height:18px">
<span style="font-weight:600;font-size:13.5px">{hv("o.name")}</span>
<span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">{mono(hv("o.id"), 12)}{IF("o.isAI", proposed())}{IF("o.isManual", '<span style="font-size:12px;color:$t2">Added manually</span>')}</span>
<span style="font-size:12.5px;color:$t2"><span style="color:$t3">Trigger</span> {hv("o.trigger")}</span></button>''', False),
 (hv("o.rationale"), False),
 (f'<span style="{hv("o.evStyle")}">{hv("o.evq")}</span><div style="font-size:12px;color:$t2;margin-top:3px">{hv("o.sources")}</div><div style="font-size:12px;color:$t2;margin-top:3px;display:flex;gap:4px;align-items:center">{icon("dashcircle", 12)}{hv("o.unknowns")}</div>', False),
 (f'<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:12px;font-weight:500;white-space:nowrap;box-sizing:border-box;{hv("o.stStyle")}">{hv("o.status")}</span><div style="font-size:12px;color:$t3;margin-top:4px">Checked {hv("o.checked")}</div>', False)]
tbl = gtable(COLS, ["Market · trigger", "Fit rationale", "Evidence · unknowns", "Status"], FOR("rows", "o", grow(COLS, cells, "o.rowStyle"), 5), minw=700, aria="Opportunity candidates")

detail = f'''<aside aria-label="Candidate detail" style="border:1px solid $border;border-radius:8px;background:$surface;padding:16px;display:flex;flex-direction:column;gap:14px">
<div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">{mono(hv("d.id"), 12)}{IF("d.isAI", proposed())}<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;font-size:12px;font-weight:500;box-sizing:border-box;{hv("d.stStyle")}">{hv("d.status")}</span></div>
<h2 style="margin:6px 0 0;font-size:18px;line-height:26px;font-weight:600">{hv("d.name")}</h2>
<p style="margin:4px 0 0;font-size:13px;color:$t2">{hv("d.rationale")}</p></div>
{IF("d.isDup", f'<div role="status" style="display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:8px;background:$wnb;font-size:13px">{icon("merge", 15, "$wnf")}<span><b style="font-weight:600;color:$wnf">Likely duplicate of OPP-07</b> · most of its sites already sit in German food-processing plants. Merging keeps both records and links them.</span></div>')}
<div>{eyebrow("Fit to mandate criteria")}<ul style="list-style:none;margin:0;padding:0;font-size:13px;display:flex;flex-direction:column;gap:5px">
{FOR("d.fit", "f", f'<li style="display:flex;gap:8px;align-items:flex-start"><span style="{hv("f.st")}">{hv("f.g")}</span><span>{hv("f.t")}</span></li>', 4)}</ul></div>
<div>{eyebrow("Evidence")}<div style="display:flex;flex-wrap:wrap;gap:6px">{FOR("d.ev", "e", f'<a href="Evidence.dc.html" class="chip" style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;border:1px solid $border;font-size:12px;color:$t2;text-decoration:none;white-space:nowrap">{icon("filetext", 12, "$evf")}{hv("e")}</a>', 3)}</div></div>
<div>{eyebrow("Unknowns")}<ul style="margin:0;padding-left:18px;font-size:13px;line-height:20px">{FOR("d.unk", "u", f'<li>{hv("u")}</li>', 2)}</ul></div>
{IF("dismissing", f'''<fieldset style="border:1px solid $border;border-radius:8px;margin:0;padding:12px"><legend style="font-size:13px;font-weight:600;padding:0 4px">Dismiss with a reason (required)</legend>
<div style="display:flex;flex-wrap:wrap;gap:6px">{FOR("reasons", "r", f'<button type="button" onClick="{hv("r.pick")}" aria-pressed="{hv("r.on")}" style="{hv("r.style")}">{hv("r.label")}</button>', 4)}</div>
<div style="display:flex;gap:8px;margin-top:10px"><button type="button" onClick="{hv("confirmDismiss")}" disabled="{hv("noReason")}" style="{BTN}{hv("dismissStyle")}">Dismiss candidate</button>{btn("Cancel", "g", handler="cancelDismiss")}</div>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Dismissed candidates stay visible under the Dismissed filter with your reason.</p></fieldset>''')}
{IF("showActions", f'''<div style="display:flex;flex-wrap:wrap;gap:8px;border-top:1px solid $border;padding-top:12px">
{IF("canShortlist", f'<button type="button" class="bp" onClick="{hv("shortlist")}" style="{BTN}border:1px solid $acc;color:#fff">{icon("star", 15)}Shortlist {kbd("S")}</button>', True)}
{IF("canConvert", f'<button type="button" class="bp" onClick="{hv("convert")}" style="{BTN}border:1px solid $acc;color:#fff">{icon("briefcase", 15)}Convert to case</button>')}
{IF("d.isDup", f'<button type="button" class="bs" onClick="{hv("merge")}" style="{BTN}border:1px solid $bstrong;color:$t1">{icon("merge", 15)}Merge into OPP-07 {kbd("M")}</button>')}
<button type="button" class="bs" onClick="{hv("startDismiss")}" style="{BTN}border:1px solid $bstrong;color:$t1">{icon("x", 15)}Dismiss {kbd("D")}</button></div>''', True)}
{IF("isConverted", banner("ok", "Converted to case ME-104", "Owner Maya Rao · stage Discovery. The candidate keeps its evidence and origin.", btn("Open case", "s", href="Thesis.dc.html", ic="arrowr")))}
{IF("isFinal", f'<p style="margin:0;font-size:12.5px;color:$t2">{hv("finalNote")}</p>')}
</aside>'''

add_form = f'''<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;background:$canvas">
<label for="nm" style="flex:1 1 280px;font-size:13px;font-weight:500">Market name<input id="nm" type="text" value="{hv("newName")}" onChange="{hv("setNew")}" placeholder="e.g. Swiss food-processing plants" style="{INP};margin-top:6px"></label>
<button type="button" class="bp" onClick="{hv("addManual")}" disabled="{hv("noNew")}" style="{BTN}border:1px solid $acc;color:#fff">Add candidate</button>{btn("Cancel", "g", handler="closeAdd")}
<p style="flex-basis:100%;margin:0;font-size:12px;color:$t3">Manual candidates start as Detected with no evidence. Attach sources before shortlisting.</p></div>'''

content = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
<div style="flex:1 1 360px;min-width:0"><h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">Opportunities</h1>
<p style="margin:2px 0 0;font-size:13px;color:$t2">Mandate {mono("MD-21", 12)} · German food processing and adjacent segments · approved 5 Oct</p></div>
{btn("Add manually", "s", handler="openAdd", ic="plus")}{btn("Compare selected", "s", href="Compare.dc.html", ic="compare")}</div>
{banner("warn", "Discovery partial — 1 source unavailable", "Trade registry connection is unavailable since 6 Oct. Results are not exhaustive. Candidates from the other 2 sources are shown.", btn("Upload a file instead", "s", ic="upload") + btn("Connection status", "g", href="Admin.dc.html"))}
{IF("adding", add_form)}
<div style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center">{seg("filterBtns", "Status filter")}
<span style="font-size:12.5px;color:$t3">Filters: Product · water monitoring · Geography · DACH + Benelux · Segment · food and beverages</span>
<span role="status" style="margin-left:auto;font-size:12.5px;color:$t2">{hv("countText")}</span></div>
<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
<div style="flex:999 1 600px;min-width:0;border:1px solid $border;border-radius:8px;overflow:hidden">{tbl}</div>
<div style="flex:1 1 320px;min-width:0">{detail}</div></div>
</div>'''

js = logic(r"""    const s = this.state;
    const ST = { Detected: 'border:1px solid $bstrong;color:$t1;', Shortlisted: 'border:1px solid $acc;color:$acc;background:$accbg;', Converted: 'border:1px solid $okf;color:$okf;background:$okb;',
      Dismissed: 'border:1px dashed $ctrl;color:$t2;', Duplicate: 'border:1px dashed $ctrl;color:$t2;' };
    const EVS = { Some: 'color:$wnf;font-weight:500', Weak: 'color:$t2;font-weight:500', None: 'color:$t2;font-weight:500' };
    const all = s.items.map(o => Object.assign({}, o, { status: s.st[o.id] || o.status }));
    const vis = all.filter(o => s.filter === 'all' ? (o.status !== 'Dismissed' && o.status !== 'Duplicate') : s.filter === 'Dismissed' ? (o.status === 'Dismissed' || o.status === 'Duplicate') : o.status === s.filter);
    const rows = vis.map(o => Object.assign({}, o, {
      sel: s.sel === o.id ? 'true' : 'false', pick: () => this.setState({ sel: o.id, dismissing: false, reason: null }),
      rowStyle: s.sel === o.id ? 'background:$accbg' : '', stStyle: ST[o.status] || '', evStyle: EVS[o.evq] || '',
      status: o.status === 'Shortlisted' && o.ai ? 'Shortlisted' : o.status, isAI: o.ai && o.status === 'Detected', isManual: !!o.manual
    }));
    const d0 = all.find(o => o.id === s.sel) || all[0];
    const ok = (b, t) => ({ g: b === true ? '✓' : b === false ? '✕' : '?', st: 'display:inline-flex;width:14px;font-weight:600;color:' + (b === true ? '$okf' : b === false ? '$t2' : '$wnf'), t: t + (b === true ? ' · yes' : b === false ? ' · no' : ' · unknown') });
    const d = Object.assign({}, d0, { stStyle: ST[d0.status], isAI: d0.ai && d0.status === 'Detected', isDup: d0.dup && d0.status !== 'Duplicate',
      fit: d0.fit.map(f => ok(f[1], f[0])) });
    const reasons = ['Outside mandate scope', 'Outside channel coverage', 'Insufficient evidence', 'Not a priority this cycle'].map(r => ({ label: r, on: s.reason === r ? 'true' : 'false', pick: () => this.setState({ reason: r }), style: this.chipStyle(s.reason === r) }));
    const setSt = (id, v, extra) => this.setState(Object.assign({ st: Object.assign({}, s.st, { [id]: v }), dismissing: false, reason: null }, extra || {}));
    const final = d.status === 'Dismissed' || d.status === 'Duplicate';
    const finalNote = d.status === 'Duplicate' ? 'Merged into OPP-07 by Maya Rao · 7 Oct. Both records are kept and linked.' : d.status === 'Dismissed' ? 'Dismissed · reason: ' + (s.dreason[d.id] || d.reason || 'Outside channel coverage') + '. Kept for audit.' : '';
    return {
      filterBtns: this.seg([['all', 'Active'], ['Detected', 'Detected'], ['Shortlisted', 'Shortlisted'], ['Dismissed', 'Dismissed · Duplicate']], 'filter'),
      rows, countText: vis.length + ' of ' + all.length + ' candidates · not an exhaustive search', d,
      dismissing: s.dismissing && !final, reasons, noReason: !s.reason,
      dismissStyle: s.reason ? 'background:$t1;color:#fff;border:1px solid $t1;' : 'background:$sunken;color:$t3;border:1px solid $border;cursor:not-allowed;',
      startDismiss: () => this.setState({ dismissing: true, reason: null }), cancelDismiss: () => this.setState({ dismissing: false, reason: null }),
      confirmDismiss: () => { if (s.reason) setSt(d.id, 'Dismissed', { dreason: Object.assign({}, s.dreason, { [d.id]: s.reason }) }); },
      showActions: !final && d.status !== 'Converted' && !s.dismissing,
      canShortlist: d.status === 'Detected', canConvert: d.status === 'Shortlisted',
      shortlist: () => setSt(d.id, 'Shortlisted'), convert: () => setSt(d.id, 'Converted'), merge: () => setSt(d.id, 'Duplicate'),
      isConverted: d.status === 'Converted', isFinal: final, finalNote,
      adding: s.adding, openAdd: () => this.setState({ adding: true }), closeAdd: () => this.setState({ adding: false, newName: '' }),
      newName: s.newName, setNew: (e) => this.setState({ newName: e.target.value }), noNew: !s.newName,
      addManual: () => { if (!s.newName) return; const id = 'OPP-' + (15 + s.items.length - 5); this.setState({ items: s.items.concat([{ id, name: s.newName, manual: true, trigger: 'Added by Maya Rao · 7 Oct', rationale: 'No rationale yet. Attach evidence and describe fit to the mandate.', evq: 'None', sources: '0 sources', unknowns: 'Not assessed', checked: 'Not checked', status: 'Detected', fit: [['Inside mandate geography', null], ['Product fit', null], ['Channel coverage', null]], ev: [], unk: ['Everything until evidence is attached'] }]), sel: id, adding: false, newName: '' }); }
    };""", r"""{ sel: 'OPP-07', filter: 'all', st: {}, dreason: {}, dismissing: false, reason: null, adding: false, newName: '',
    items: [
      { id: 'OPP-07', name: 'German food-processing plants', ai: true, trigger: 'Process-water monitoring cited in 2 trade sources (2026)', rationale: 'Existing product monitors process water; segment and geography inside the mandate; partner channel covers German food plants.', evq: 'Some', sources: '3 sources', unknowns: '2 unknowns', checked: '7 Oct, 09:20', status: 'Detected',
        fit: [['Inside mandate geography and segment', true], ['Existing product fits target workflow', null], ['Channel reaches the segment', true], ['No excluded activity needed', true]], ev: ['Site census 2026', 'Trade survey 2026', 'Partner coverage list'], unk: ['Adoption rate by year 3', 'Specialist requirements for food plants'] },
      { id: 'OPP-12', name: 'German dairy plants', ai: true, dup: true, trigger: 'Dairy hygiene programmes in 1 trade source', rationale: 'Subset of food processing with similar water processes.', evq: 'Weak', sources: '1 source', unknowns: '3 unknowns', checked: '7 Oct, 09:20', status: 'Detected',
        fit: [['Inside mandate geography and segment', true], ['Existing product fits target workflow', null], ['Channel reaches the segment', true]], ev: ['Trade survey 2026'], unk: ['Overlap with OPP-07', 'Buyer process', 'Adoption'] },
      { id: 'OPP-09', name: 'Austrian breweries', ai: true, trigger: 'Brewery modernisation news, 1 source', rationale: 'Adjacent geography; process water central to brewing.', evq: 'Weak', sources: '1 source', unknowns: '4 unknowns', checked: '6 Oct, 17:45', status: 'Detected',
        fit: [['Inside mandate geography', false], ['Existing product fits target workflow', null], ['Channel reaches the segment', false]], ev: ['Trade news 2026'], unk: ['Channel', 'Site count', 'Price', 'Adoption'] },
      { id: 'OPP-14', name: 'Dutch food-processing plants', manual: true, trigger: 'Raised by Jonas Klein in GTM review', rationale: 'Same segment, neighbouring market; partner coverage unclear.', evq: 'Some', sources: '2 sources', unknowns: '3 unknowns', checked: '7 Oct, 08:55', status: 'Detected',
        fit: [['Inside mandate segment', true], ['Inside mandate geography', false], ['Channel reaches the segment', null]], ev: ['Site census NL 2025', 'Partner note'], unk: ['Channel', 'Price', 'Specialist requirements'] },
      { id: 'OPP-03', name: 'Polish beverage bottlers', ai: true, trigger: 'Bottling capacity news, 1 source', rationale: 'Outside current channel and service coverage.', evq: 'Weak', sources: '1 source', unknowns: '4 unknowns', checked: '2 Oct, 11:10', status: 'Dismissed', reason: 'Outside channel coverage',
        fit: [['Inside mandate geography', false], ['Channel reaches the segment', false]], ev: ['Trade news 2026'], unk: ['Channel', 'Site count'] }
    ] }""")

page("Opportunities.dc.html", "Opportunities", shell("Opportunities", "Wed 7 Oct 2026", content, user="MR"), js, height=1500)
