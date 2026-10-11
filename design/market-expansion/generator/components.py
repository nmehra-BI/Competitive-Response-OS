from common import *


def auth_boxes(yes, no, title_yes="What this authorizes", title_no="What this does not authorize"):
    y = "".join(f'<li style="display:flex;gap:8px;align-items:flex-start;padding:3px 0"><span style="color:$okf;margin-top:2px">{icon("check", 14, sw=2.2)}</span><span>{t}</span></li>' for t in yes)
    n = "".join(f'<li style="display:flex;gap:8px;align-items:flex-start;padding:3px 0"><span style="color:$ntf;margin-top:2px">{icon("x", 14, sw=2.2)}</span><span>{t}</span></li>' for t in no)
    return f'''<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">
<div style="border:1px solid $okf;border-radius:8px;padding:10px 12px;background:$surface"><div style="font-size:12px;font-weight:600;color:$okf;margin-bottom:4px">{title_yes}</div><ul style="list-style:none;margin:0;padding:0;font-size:13px;line-height:19px">{y}</ul></div>
<div style="border:1px dashed $ctrl;border-radius:8px;padding:10px 12px;background:$canvas"><div style="font-size:12px;font-weight:600;color:$t2;margin-bottom:4px">{title_no}</div><ul style="list-style:none;margin:0;padding:0;font-size:13px;line-height:19px">{n}</ul></div></div>'''


def condition(cid, text, owner, due, blocking, state="Open"):
    flag = (f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$wnb;color:$wnf;font-size:12px;font-weight:500">{icon("lockbar", 13)}Blocks execution until met</span>'
            if blocking else f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:4px;background:$ntb;color:$ntf;font-size:12px;font-weight:500">{icon("eye", 13)}Monitor only</span>')
    st = {"Open": ("$t2", "dashcircle"), "Met": ("$okf", "checkcircle")}[state]
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;background:$surface">
<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center">{mono(cid, 12, "$t1")}<span style="font-size:13.5px;font-weight:500;flex:1 1 200px">{text}</span>{flag}</div>
<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12.5px;color:$t2"><span>Condition owner {owner}</span><span>Due {due}</span><span style="display:inline-flex;gap:5px;align-items:center;color:{st[0]}">{icon(st[1], 13)}<span style="color:$t1">{state}</span></span></div></div>'''


def dissent(ini, text, when, scope):
    n, r = PEOPLE[ini]
    return f'''<figure style="margin:0;border:1px solid $wnf;border-radius:8px;padding:12px 14px;background:$surface">
<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12.5px">{avatar(ini, 22)}<b style="font-weight:600;font-size:13px">{n}</b><span style="color:$t2">{r}</span>
<span style="display:inline-flex;gap:4px;align-items:center;color:$wnf;font-weight:500">{icon("message", 13)}Dissent · signed</span><span style="margin-left:auto;color:$t3">{when}</span></div>
<blockquote style="margin:8px 0 0;font-family:$serif;font-size:15.5px;line-height:24px;color:$t1">“{text}”</blockquote>
<figcaption style="margin-top:6px;font-size:12px;color:$t2">{scope}</figcaption></figure>'''


def assumption_chip(text, owner, disputed=False, href="Validation.dc.html"):
    d = f'<span style="display:inline-flex;align-items:center;gap:3px;color:$wnf;font-weight:500">{icon("message", 12)}Disputed</span>' if disputed else ""
    return (f'<a href="{href}" class="chip" style="display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:1px 8px 1px 6px;border-radius:4px;'
            f'border:1px dashed $asf;background:$asb;color:$asf;font-size:12.5px;text-decoration:none;white-space:nowrap;box-sizing:border-box">'
            f'{icon("pencilruler", 13)}<span style="color:$t1;font-weight:500">{text}</span><span>· {owner}</span>{d}</a>')


def evidence_item(title, pub, date, excerpt, q="Strong", meta=""):
    return f'''<div style="border:1px solid $evf;border-radius:8px;padding:12px 14px;background:$surface;display:flex;flex-direction:column;gap:6px">
<div style="display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center">{kind("Evidence", small=True)}{evq(q)}<span style="font-size:12.5px;color:$t2">{pub} · published {date}</span></div>
<div style="font-size:13.5px;font-weight:600">{title}</div>
<blockquote style="margin:0;font-family:$serif;font-size:15px;line-height:23px;color:$t1">“{excerpt}”</blockquote>
<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:$t2">{meta}<a href="Evidence.dc.html" class="lk" style="text-decoration:none;font-weight:500">Open source</a></div></div>'''


def activity_item(ini, title, sub, when, key=False):
    k = f'<span style="display:inline-flex;align-items:center;gap:4px;font-size:11.5px;color:$t1;border:1px solid $t1;border-radius:4px;padding:0 5px;font-weight:600">{icon("pin", 11) if "pin" in P else ""}Key decision</span>' if key else ""
    return f'''<li style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid $border">{avatar(ini, 24)}<div style="flex:1;min-width:0;line-height:18px">
<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center"><span style="font-size:13px;font-weight:500">{title}</span>{k}</div><div style="font-size:12.5px;color:$t2">{sub}</div></div><span style="font-size:12px;color:$t3;white-space:nowrap">{when}</span></li>'''


def approve_btn(label, handler=None, href=None, disabled=False, full=True):
    w = "width:100%;" if full else ""
    return btn(label, "p", href=href, handler=handler, disabled=disabled, extra=w + "min-height:40px;", ic=None)


def formula(lhs, expr, result):
    return (f'<div style="font-family:$mono;font-size:13px;line-height:20px;padding:10px 12px;background:$canvas;border:1px solid $border;border-radius:6px;overflow-x:auto">'
            f'<div><span style="color:$t1;font-weight:500">{lhs}</span> <span style="color:$t2">=</span> <span style="color:$t2">{expr}</span></div>'
            f'<div><span style="color:$t2">→</span> <b style="color:$t1;font-weight:600">{result}</b></div></div>')


def ladder_row(name, meaning, sites, money, kinds, link="Sizing.dc.html", unit_note=""):
    return f'''<div style="display:grid;grid-template-columns:minmax(140px,1.1fr) minmax(200px,2fr) minmax(110px,.9fr) minmax(150px,1.2fr) minmax(150px,1.2fr);gap:8px 16px;align-items:center;padding:12px 14px;border:1px solid $border;border-radius:8px;background:$surface">
<div style="font-size:14px;font-weight:600">{name}</div>
<div style="font-size:12.5px;color:$t2;line-height:18px">{meaning}</div>
<div style="font-size:14px;font-weight:600;font-variant-numeric:tabular-nums">{sites}</div>
<div style="font-size:14px;font-variant-numeric:tabular-nums">{money}{unit_note}</div>
<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">{kinds}<a href="{link}" class="lk" style="font-size:12px;text-decoration:none;font-weight:500;margin-left:2px">Lineage</a></div></div>'''


def connector(text):
    return f'<div aria-hidden="true" style="display:flex;align-items:center;gap:8px;padding:2px 0 2px 28px;font-size:12px;color:$t2"><span style="width:1px;height:18px;background:$ctrl"></span>{icon("chevd", 12)}<span>{text}</span></div>'


def owner_picker():
    opts = [("MR", "Maya Rao", "Strategy lead"), ("JK", "Jonas Klein", "Regional commercial lead"), ("PS", "Priya Shah", "Product lead"), ("DW", "Daniel Weber", "Finance partner")]
    li = "".join(f'<li role="option" aria-selected="{"true" if i == "JK" else "false"}" style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;{"background:$accbg;" if i == "JK" else ""}font-size:13px">{avatar(i, 22)}<span style="flex:1">{n} <span style="color:$t3">· {r}</span></span>{icon("check", 14, "$acc", 2.2) if i == "JK" else ""}</li>' for i, n, r in opts)
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:10px;background:$surface;max-width:360px">
<label for="op-q" style="display:block;font-size:12.5px;font-weight:500;margin-bottom:6px">Accountable owner (required)</label>
<div style="display:flex;align-items:center;gap:8px;height:36px;padding:0 10px;border:1px solid $acc;border-radius:6px;box-shadow:0 0 0 3px $accbg">{icon("search", 14, "$t3")}<input id="op-q" type="text" value="Jo" style="border:0;outline:0;font:inherit;font-size:13px;flex:1;min-width:0;background:transparent"></div>
<ul role="listbox" aria-label="People" style="list-style:none;margin:6px 0 0;padding:0">{li}</ul>
<div style="font-size:12px;color:$t3;margin-top:4px">Only people with access to ME-104 are listed. Owner is one person, not a team.</div></div>'''


def review_panel():
    return f'''<div style="border:1px solid $border;border-radius:8px;padding:12px 14px;background:$surface;max-width:420px;display:flex;flex-direction:column;gap:10px">
<div style="display:flex;gap:8px;align-items:center">{avatar("DW", 24)}<div style="line-height:17px"><div style="font-size:13px;font-weight:600">Economics review · requested of Daniel Weber</div><div style="font-size:12px;color:$t2">Due 22 Oct · Economics v2</div></div></div>
<div><div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:4px">Claims to confirm</div><ul style="margin:0;padding-left:18px;font-size:13px;line-height:20px"><li>Margin definition: 60% gross, delivery/COGS deducted</li><li>Opex scope: €600k/year incremental sales and admin</li><li>Currency EUR · 2026 prices</li></ul></div>
<div role="group" aria-label="Your position" style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="bs" style="{BTN}border:1px solid $bstrong;color:$t1">Confirm</button><button type="button" class="bs" style="{BTN}border:1px solid $bstrong;color:$t1">Dispute</button><button type="button" class="bs" style="{BTN}border:1px solid $bstrong;color:$t1">Abstain</button></div>
<label style="font-size:12.5px;font-weight:500" for="rp-r">Reason (required)<textarea id="rp-r" rows="2" style="display:block;margin-top:4px;width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid $ctrl;border-radius:6px;font:inherit;font-size:13px">Checked margin and opex scope. Not checked: ramp, cash timing.</textarea></label></div>'''
