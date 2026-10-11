from components import *

INP = "width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13.5px;background:$surface;color:$t1"

srcitem = f'''<li><button type="button" onClick="{hv("s.pick")}" aria-pressed="{hv("s.on")}" class="hr" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid $border;padding:10px 12px;font:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px;{hv("s.style")}">
<span style="display:flex;gap:6px;align-items:center">{mono(hv("s.id"), 12)}<span style="font-size:12px;{hv("s.stStyle")}">{hv("s.status")}</span></span>
<span style="font-size:13px;font-weight:500;color:$t1;line-height:18px">{hv("s.title")}</span><span style="font-size:12px;color:$t3">{hv("s.meta")}</span></button></li>'''

srclist = f'''<nav aria-label="Sources" style="border:1px solid $border;border-radius:8px;overflow:hidden;background:$surface">
<div style="padding:10px 12px;border-bottom:1px solid $border;background:$canvas;font-size:12.5px;font-weight:600">Sources · ME-104</div>
<ul style="list-style:none;margin:0;padding:0">{FOR("srcs", "s", srcitem, 5)}</ul></nav>'''

meta = f'''<dl style="margin:0;display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:13px">
<dt style="color:$t3">Origin</dt><dd style="margin:0">{hv("d.origin")}</dd>
<dt style="color:$t3">Published</dt><dd style="margin:0">{hv("d.pub")}</dd>
<dt style="color:$t3">Retrieved</dt><dd style="margin:0">{hv("d.ret")}</dd>
<dt style="color:$t3">Licence boundary</dt><dd style="margin:0">{hv("d.lic")}</dd>
<dt style="color:$t3">Status</dt><dd style="margin:0">{hv("d.statusLong")}</dd></dl>'''

viewer = f'''<article aria-label="Source viewer" style="border:1px solid $border;border-radius:8px;background:$surface">
<div style="padding:16px 18px;border-bottom:1px solid $border;display:flex;flex-direction:column;gap:8px">
<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">{mono(hv("d.id"), 12.5, "$t1")}{IF("d.isEv", kind("Evidence", small=True))}<span style="font-size:12.5px;{hv("d.stStyle")}">{hv("d.status")}</span></div>
<h1 style="margin:0;font-size:20px;line-height:28px;font-weight:600">{hv("d.title")}</h1>{meta}</div>
<div style="padding:18px">
{IF("d.hasExcerpt", f'''<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:8px">Permitted excerpt · {hv("d.passage")}</div>
<blockquote style="margin:0;padding:14px 18px;background:$canvas;border:1px solid $border;border-radius:6px;font-family:$serif;font-size:18px;line-height:30px;color:$t1">“{hv("d.excerpt")}”</blockquote>
<p style="margin:8px 0 0;font-size:12px;color:$t3">Shown within the licence: up to 2 sentences per passage. Nothing here is generated.</p>''', True)}
{IF("d.restricted", banner("lock", "Restricted source · no excerpt shown", "Your role does not include this licence. No excerpt, summary or generated paraphrase is shown here or anywhere else in the product.", btn("Open in licensed tool", "s", ic="ext") + btn("Request access", "g"), live=False))}
{IF("d.deleted", banner("neutral", "Source deleted by provider · provenance kept", "Content is no longer available. The record of what it said, who used it and when is retained under the retention policy.", live=False))}
{IF("d.superseded", f'<div style="margin-top:12px">{banner("neutral", "Superseded by SRC-014 (2026 edition) on 8 Oct 2026", "Claims moved to the 2026 edition. This edition stays readable for history.", btn("Open SRC-014", "s", handler="openCur"), live=False)}</div>')}
<div style="margin-top:16px">{eyebrow("Linked claims and inputs")}<ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">{FOR("d.claims", "c", f'<li style="display:flex;gap:8px;align-items:center;font-size:13px;padding:6px 10px;border:1px solid $border;border-radius:6px"><span style="flex:1">{hv("c.t")}</span><a href="{hv("c.href")}" class="lk" style="font-size:12.5px;text-decoration:none;font-weight:500;white-space:nowrap">{hv("c.where")}</a></li>', 3)}</ul></div>
</div></article>'''

side = f'''<aside aria-label="Fact, inference and assumption" style="display:flex;flex-direction:column;gap:12px">
<section style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:12px">
<h2 style="margin:0;font-size:14px;font-weight:600">What this source does and does not say</h2>
<div>{eyebrow("Quoted fact")}<div style="display:flex;flex-direction:column;gap:6px">{kind("Evidence", "quoted", small=True)}<p style="margin:0;font-family:$serif;font-size:15px;line-height:23px">{hv("d.fact")}</p></div></div>
<div>{eyebrow("Inferred claim")}<div style="display:flex;flex-direction:column;gap:6px"><span style="display:flex;gap:6px;flex-wrap:wrap">{ai("AI draft · accepted by Maya Rao")}</span><p style="margin:0;font-family:$serif;font-size:15px;line-height:23px">{hv("d.inf")}</p></div></div>
<div>{eyebrow("Human assumption · not in this source")}<div style="display:flex;flex-direction:column;gap:6px">{kind("Assumption", "Maya Rao", small=True)}<p style="margin:0;font-family:$serif;font-size:15px;line-height:23px">{hv("d.asm")}</p></div></div></section>
<section style="border:1px solid $border;border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;flex-wrap:wrap;gap:8px">{btn("Challenge", "s", handler="openCh", ic="message")}{btn("Mark stale", "s", handler="markStale", ic="clock")}{btn("Replace", "s", handler="openRep", ic="refresh")}{btn("Inspect impacted cases", "s", handler="toggleImp", ic="layers")}</div>
{IF("chOpen", f'<div style="display:flex;flex-direction:column;gap:8px"><label for="ch" style="font-size:12.5px;font-weight:500">What is wrong with this source? (required)</label><textarea id="ch" rows="2" value="{hv("chText")}" onChange="{hv("setCh")}" style="{INP}"></textarea><div style="display:flex;gap:8px"><button type="button" class="bd" onClick="{hv("sendCh")}" disabled="{hv("noCh")}" style="{BTN}border:1px solid $t1;color:#fff">Send challenge</button>{btn("Cancel", "g", handler="closeCh")}</div></div>')}
{IF("repOpen", f'<div style="font-size:13px;display:flex;flex-direction:column;gap:6px"><span style="font-weight:500">Replace with</span><button type="button" class="bs" style="{BTN}border:1px solid $bstrong;color:$t1;justify-content:flex-start">{icon("upload", 15)}Upload a newer edition</button><span style="font-size:12px;color:$t3">Replacing re-links claims in a draft. Approved snapshots keep the original source.</span></div>')}
{IF("note", f'<p role="status" style="margin:0;font-size:12.5px;color:$t1;display:flex;gap:6px;align-items:center">{icon("info", 14, "$inf")}{hv("noteText")}</p>')}
{IF("impOpen", f'<div><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Impacted · cases you can access</div><ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px">{FOR("d.impact", "i", f"<li style=\'font-size:13px;padding:8px 10px;border:1px solid $border;border-radius:6px\'><b style=\'font-weight:600\'>{hv('i.case')}</b> · {hv('i.what')}</li>", 2)}</ul><p style="margin:6px 0 0;font-size:12px;color:$t3">Cases you cannot access are not listed or counted.</p></div>', True)}
</section></aside>'''

body = f'''<div style="padding:20px 24px 40px;max-width:1280px;display:flex;flex-direction:column;gap:16px">
<div><nav aria-label="Breadcrumb" style="font-size:12.5px;color:$t3;display:flex;align-items:center;gap:6px;margin-bottom:4px"><a href="Thesis.dc.html" class="lk" style="color:$t3;text-decoration:none">ME-104</a>{icon("chevr", 12)}<span>Evidence</span></nav>
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600">Evidence and history</h1></div>
<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">
<div style="flex:1 1 240px;min-width:0;max-width:300px">{srclist}</div>
<div style="flex:999 1 480px;min-width:0">{viewer}</div>
<div style="flex:1 1 300px;min-width:0;max-width:380px">{side}</div></div></div>'''

js = logic(r"""    const s = this.state;
    const D = {
      'SRC-014': { title: 'German food-processing site census, 2026 edition', status: s.stale['SRC-014'] ? 'Stale · marked by Maya Rao' : 'Current', origin: 'Licensed · [Publisher] portal · site-census-2026.pdf', pub: '3 Jun 2026', ret: '8 Oct 2026, 10:12', lic: 'Internal use · excerpts up to 2 sentences · no redistribution of site lists', statusLong: 'Current · supersedes SRC-009 (2025 edition)',
        passage: 'passage 1 of 2', excerpt: '5,000 food-processing sites in Germany operate a process-water treatment step. Of these, 1,400 meet the size threshold used in this census.', hasExcerpt: true,
        claims: [{ t: 'TAM site count · 5,000', where: 'Sizing · ledger', href: 'Sizing.dc.html' }, { t: 'Size-qualified cohort · 1,400', where: 'Sizing · cohorts', href: 'Sizing.dc.html' }, { t: 'Thesis claim: 5,000 sites operate a treatment step', where: 'Thesis', href: 'Thesis.dc.html' }],
        fact: '5,000 sites operate a process-water treatment step; 1,400 meet the size threshold.', inf: 'Sites with a treatment step are candidates for continuous monitoring.', asm: 'Each site spends about €20k per year on monitoring of this kind.',
        impact: [{ case: 'ME-104', what: 'TAM, SAM (via size cohort), G2 package v3' }] },
      'SRC-009': { title: 'German food-processing site census, 2025 edition', status: 'Superseded', origin: 'Licensed · [Publisher] portal', pub: '4 Jun 2025', ret: '1 Oct 2026', lic: 'Internal use · excerpts up to 2 sentences', statusLong: 'Superseded by SRC-014 on 8 Oct 2026', superseded: true,
        passage: 'passage 1 of 1', excerpt: 'Food-processing sites with a process-water treatment step are listed by region and size band.', hasExcerpt: true,
        claims: [{ t: 'No current claims · moved to SRC-014', where: 'History', href: 'Sizing.dc.html' }], fact: 'Sites are listed by region and size band.', inf: 'The 2025 counts are no longer used.', asm: 'None from this source.', impact: [{ case: 'ME-104', what: 'Sizing v1 only (superseded)' }] },
      'SRC-021': { title: 'Food and beverage process-water trade survey 2026', status: 'Ageing · 41 days', origin: 'Authorized upload · trade-survey-2026.pdf', pub: '2 Sep 2026', ret: '9 Oct 2026', lic: 'Internal use · quote with attribution', statusLong: 'Current · ageing',
        passage: 'passage 2 of 3', excerpt: 'Around 1,100 German food-processing sites run the water process the survey targets.', hasExcerpt: true,
        claims: [{ t: 'Process-qualified cohort · 1,100', where: 'Sizing · cohorts', href: 'Sizing.dc.html' }], fact: 'About 1,100 sites run the targeted water process.', inf: 'Process-qualified sites overlap with large sites.', asm: 'Overlap is measured by our own dedup, not by this survey.', impact: [{ case: 'ME-104', what: 'SAM via process cohort' }] },
      'SRC-030': { title: 'Vendor market estimate · water monitoring, Europe', status: 'Restricted', origin: 'Licensed · vendor portal', pub: '[date]', ret: '—', lic: 'Not in your entitlements', statusLong: 'Restricted under your access', restricted: true,
        claims: [{ t: 'Top-down cross-check · placeholder range', where: 'Sizing · cross-check', href: 'Sizing.dc.html' }], fact: 'Not shown — restricted.', inf: 'Not shown — restricted.', asm: 'Top-down range in Sizing is an illustrative placeholder.', impact: [{ case: 'ME-104', what: 'Sizing cross-check only' }] },
      'SRC-011': { title: 'Regional registry extract', status: 'Deleted', origin: 'Authorized upload · added by Maya Rao on 1 Oct 2026', pub: '[date]', ret: '1 Oct 2026', lic: 'Internal use', statusLong: 'Deleted by provider on 12 Oct 2026 · fingerprint 91C0·4A7E kept', deleted: true,
        claims: [{ t: 'Process-qualified cohort (Sizing v1) · replaced by SRC-021', where: 'History', href: 'Sizing.dc.html' }], fact: 'Prior provenance only: listed regional site counts.', inf: '—', asm: '—', impact: [{ case: 'ME-104', what: 'Sizing v1 only. No current figure depends on it.' }] }
    };
    const ST = (st) => st.indexOf('Current') === 0 ? 'color:$okf;font-weight:500' : st === 'Superseded' || st === 'Deleted' ? 'color:$t3;font-weight:500' : st === 'Restricted' ? 'color:$rsf;font-weight:500' : 'color:$wnf;font-weight:500';
    const ids = ['SRC-014', 'SRC-021', 'SRC-009', 'SRC-030', 'SRC-011'];
    const srcs = ids.map(id => ({ id, title: D[id].title, status: D[id].status, meta: 'Published ' + D[id].pub, on: s.sel === id ? 'true' : 'false', stStyle: ST(D[id].status),
      style: s.sel === id ? 'background:$accbg;' : '', pick: () => this.setState({ sel: id, ch: false, rep: false, note: '' }) }));
    const d = Object.assign({ id: s.sel, isEv: !D[s.sel].restricted && !D[s.sel].deleted, stStyle: ST(D[s.sel].status), restricted: false, deleted: false, superseded: false, hasExcerpt: false }, D[s.sel]);
    return {
      srcs, d, openCur: () => this.setState({ sel: 'SRC-014' }),
      chOpen: s.ch, openCh: () => this.setState({ ch: true, rep: false }), closeCh: () => this.setState({ ch: false }), chText: s.chText, setCh: (e) => this.setState({ chText: e.target.value }), noCh: !s.chText,
      sendCh: () => { if (s.chText) this.setState({ ch: false, chText: '', note: 'Challenge sent to the source owner · claims stay usable and are flagged.' }); },
      markStale: () => this.setState({ stale: Object.assign({}, s.stale, { [s.sel]: true }), note: 'Marked stale · dependent figures show a freshness warning; G2 approval would be disabled until refreshed.' }),
      repOpen: s.rep, openRep: () => this.setState({ rep: !s.rep, ch: false }),
      impOpen: s.imp, toggleImp: () => this.setState({ imp: !s.imp }),
      note: !!s.note, noteText: s.note
    };""", "{ sel: 'SRC-014', ch: false, chText: '', rep: false, imp: true, stale: {}, note: '' }")

page("Evidence.dc.html", "Evidence Detail", shell("Evidence", "Tue 13 Oct 2026", body, user="MR"), js, height=1700)
