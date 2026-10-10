"""Market Expansion OS prototype generator — shared tokens, shell and components.

Output is static .dc.html markup (x-dc). No UI is built from script at runtime.
"""
import re, json, os, subprocess
from icons import P

ROOT = "/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad"
OUT = ROOT + "/me-canvas/project"

# ---------- Tokens (UX research §10.3, exact) ----------
T = {
    "canvas": "#F7F7F5", "surface": "#FFFFFF", "sunken": "#F0F0EC", "border": "#E4E4DF",
    "bstrong": "#D6D6D0", "ctrl": "#84888F", "t1": "#17181B", "t2": "#4B4F57", "t3": "#6A6E76",
    "acc": "#3049C9", "accbg": "#EEF0FB", "accbd": "#C9D0F2",
    "okf": "#1B7046", "okb": "#E6F3EB", "wnf": "#8A5300", "wnb": "#FBF0DA",
    "dgf": "#B3261E", "dgb": "#FCEBEA", "inf": "#2853B8", "inb": "#E9EEFA",
    "ntf": "#4B4F57", "ntb": "#EEEEEB", "aif": "#6A3DB0", "aib": "#F1ECFA",
    "rsf": "#3B4250", "rsb": "#E8EAEE", "inact": "#CFCFCA",
    # epistemic kinds
    "evf": "#0E6464", "evb": "#E3F1F0", "asf": "#8C2D6B", "asb": "#F8E9F1",
    "scf": "#2F5F78", "scb": "#E6EEF3", "acf": "#17181B", "acb": "#ECECE8",
    # scenario ramp
    "sdn": "#5E8FA8", "sbs": "#2F5F78", "sup": "#163A4D",
    # categorical
    "c1": "#0072B2", "c2": "#B35A00", "c3": "#00866B", "c4": "#A8508A",
    "cap": "#8A5300",
    "ui": "Geist, 'Helvetica Neue', system-ui, sans-serif",
    "serif": "'Source Serif 4', Georgia, 'Times New Roman', serif",
    "mono": "'Geist Mono', ui-monospace, Menlo, monospace",
}

P.update({
    "compass": '<circle cx="12" cy="12" r="10"></circle><path d="m16.24 7.76-1.8 5.4a2 2 0 0 1-1.28 1.28l-5.4 1.8 1.8-5.4a2 2 0 0 1 1.28-1.28z"></path>',
    "shieldhalf2": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M12 22V2"></path>',
    "filetext": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
    "pencilruler": '<path d="M13 7 8.7 2.7a2.41 2.41 0 0 0-3.4 0L2.7 5.3a2.41 2.41 0 0 0 0 3.4L7 13"></path><path d="m8 6 2-2"></path><path d="m18 16 2-2"></path><path d="m17 11 4.3 4.3c.94.94.94 2.46 0 3.4l-2.6 2.6c-.94.94-2.46.94-3.4 0L11 17"></path><path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"></path>',
    "branch": '<line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path>',
    "targetcheck": '<circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="5.5"></circle><path d="m9.5 12 1.8 1.8 3.2-3.4"></path>',
    "targetdash": '<circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="5.5"></circle><path d="M9.5 12h5"></path>',
    "targetq": '<circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="5.5"></circle><path d="M12 13.5v-.2c0-.8 1.5-1 1.5-2.1a1.5 1.5 0 0 0-3 0"></path><path d="M12 15.6h.01"></path>',
    "lockbar": '<rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path><path d="M8 16.5h8"></path>',
    "returnarrow": '<polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>',
    "trash": '<path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>',
    "merge": '<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path>',
    "star": '<path d="M11.5 2.3a.5.5 0 0 1 .9 0l2.3 4.7a2 2 0 0 0 1.6 1.1l5.2.8a.5.5 0 0 1 .3.9l-3.8 3.6a2 2 0 0 0-.6 1.8l.9 5.2a.5.5 0 0 1-.8.6l-4.6-2.5a2 2 0 0 0-1.9 0l-4.6 2.5a.5.5 0 0 1-.8-.6l.9-5.2a2 2 0 0 0-.6-1.8L2.2 9.8a.5.5 0 0 1 .3-.9l5.2-.8a2 2 0 0 0 1.6-1.1z"></path>',
    "fingerprint": '<path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"></path><path d="M14 13.12c0 2.38 0 6.38-1 8.88"></path><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"></path><path d="M2 12a10 10 0 0 1 18-6"></path><path d="M2 16h.01"></path><path d="M21.8 16c.2-2 .131-5.354 0-6"></path><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"></path><path d="M8.65 22c.21-.66.45-1.32.57-2"></path><path d="M9 6.8a6 6 0 0 1 9 5.2v2"></path>',
    "scale": '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"></path><path d="M7 21h10"></path><path d="M12 3v18"></path><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"></path>',
    "mail": '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
    "rocket": '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>',
    "grid": '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path><path d="M9 3v18"></path><path d="M15 3v18"></path>',
    "table": '<path d="M12 3v18"></path><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M3 9h18"></path><path d="M3 15h18"></path>',
    "terminal": '<polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line>',
    "key": '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle>',
    "unplug": '<path d="m19 5 3-3"></path><path d="m2 22 3-3"></path><path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z"></path><path d="M7.5 13.5 10 11"></path><path d="M10.5 16.5 13 14"></path><path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z"></path>',
    "squarestop": '<rect width="18" height="18" x="3" y="3" rx="2"></rect><rect x="9" y="9" width="6" height="6" rx="1"></rect>',
    "mappin": '<path d="M20 10c0 4.99-5.54 10.19-7.4 11.8a1 1 0 0 1-1.2 0C9.54 20.19 4 14.99 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle>',
    "gauge": '<path d="m12 14 4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path>',
    "settings": '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
    "save": '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"></path><path d="M7 3v4a1 1 0 0 0 1 1h7"></path>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line>',
    "dot": '<circle cx="12" cy="12" r="3" fill="currentColor"></circle>',
})


def icon(name, size=16, color=None, sw=1.6, label=None):
    col = f"color:{color};" if color else ""
    aria = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return (f'<svg {aria} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block;{col}">{P[name]}</svg>')


def hv(n):
    """A dc hole."""
    return "{{ " + n + " }}"


def IF(cond, inner, hint=False):
    return f'<sc-if value="{hv(cond)}" hint-placeholder-val="{hv("true" if hint else "false")}">{inner}</sc-if>'


def FOR(lst, alias, inner, n=3):
    return f'<sc-for list="{hv(lst)}" as="{alias}" hint-placeholder-count="{n}">{inner}</sc-for>'


def mono(t, size=12.5, color="$t2"):
    return f'<span style="font-family:$mono;font-size:{size}px;color:{color};letter-spacing:0">{t}</span>'


def kbd(k):
    return (f'<kbd style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;'
            f'border:1px solid $bstrong;border-bottom-width:2px;border-radius:4px;background:$surface;font-family:$mono;font-size:11px;color:$t2;box-sizing:border-box">{k}</kbd>')


# ---------- Epistemic kinds ----------
KIND = {
    "Evidence": ("filetext", "$evf", "$evb", "1px solid $evf"),
    "Assumption": ("pencilruler", "$asf", "$asb", "1px dashed $asf"),
    "Scenario": ("branch", "$scf", "$scb", "1px dotted $scf"),
    "Actual": ("flag", "$acf", "$acb", "1px solid $acf"),
    "Unknown": ("dashcircle", "$t2", "$surface", "1px dashed $ctrl"),
    "Calculated": ("sigma", "$t2", "$surface", "1px solid $bstrong"),
}


def kind(k, extra="", small=False):
    ic, f, b, bd = KIND[k]
    h = 20 if small else 22
    fw = "600" if k == "Actual" else "500"
    ex = f'<span style="font-weight:400">· {extra}</span>' if extra else ""
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;height:{h}px;padding:0 7px 0 5px;border-radius:4px;'
            f'background:{b};color:{f};border:{bd};font-size:12px;font-weight:{fw};white-space:nowrap;box-sizing:border-box;vertical-align:1px">'
            f'{icon(ic, 12)}{k}{ex}</span>')


def ai(label="AI draft"):
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;'
            f'background:$aib;color:$aif;border:1px dashed $aif;font-size:12px;font-weight:500;white-space:nowrap;box-sizing:border-box">{icon("sparkle", 12)}{label}</span>')


def proposed():
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;'
            f'background:$aib;color:$aif;border:1px dashed $aif;font-size:12px;font-weight:500;white-space:nowrap;box-sizing:border-box">{icon("sparkle", 12)}Proposed · AI</span>')


# ---------- Gate diamonds (research §10.4) ----------
DIA = {
    "notstarted": ("$t3", "Not started"), "precond": ("$t2", "Preconditions open"), "ready": ("$acc", "Ready to submit"),
    "awaiting": ("$inf", "Awaiting decision"), "approved": ("$okf", "Approved"), "approvedc": ("$okf", "Approved with conditions"),
    "returned": ("$wnf", "Returned for revision"), "blocked": ("$wnf", "Blocked"), "notapproved": ("$ntf", "Not approved"),
    "invalidated": ("$dgf", "Invalidated"), "superseded": ("$t3", "Superseded"),
}


def diamond(state, size=16, label=None):
    c, name = DIA[state]
    d = "M12 2.5 21.5 12 12 21.5 2.5 12Z"
    inner = ""
    fill = "none"
    op = ""
    if state in ("approved", "approvedc"):
        fill = "currentColor"
        inner = '<path d="m8.3 12 2.6 2.6 4.8-5" stroke="#fff" stroke-width="2"></path>'
        if state == "approvedc":
            inner += '<circle cx="20.2" cy="4" r="3" fill="currentColor" stroke="#fff" stroke-width="1.4"></circle>'
    elif state == "awaiting":
        inner = '<path d="M12 2.5 2.5 12 12 21.5Z" fill="currentColor" stroke="none"></path>'
    elif state == "returned":
        inner = '<path d="M14.5 14.5v-1.5a2 2 0 0 0-2-2H9"></path><path d="m10.5 9-1.8 2 1.8 2"></path>'
    elif state == "blocked":
        inner = '<path d="M8 12h8" stroke-width="2.4"></path>'
    elif state == "notapproved":
        inner = '<path d="m8 16 8-8"></path>'
    elif state == "invalidated":
        inner = '<circle cx="12" cy="12" r="11.2" stroke-width="1.4"></circle>'
    elif state == "superseded":
        op = ' opacity=".55"'
    elif state == "ready":
        inner = '<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"></circle>'
    aria = f'role="img" aria-label="{label or name}"'
    sw = "1.5"
    return (f'<svg {aria} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block;color:{c};overflow:visible"{op}>'
            f'<path d="{d}" fill="{fill}"></path>{inner}</svg>')


def gate_chip(state, text=None):
    c, name = DIA[state]
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:{c};white-space:nowrap">'
            f'{diamond(state, 15)}<span style="color:$t1">{text or name}</span></span>')


# ---------- Status vocabularies ----------
def pill(label, tone="acc", ic=None):
    m = {"acc": ("$acc", "$accbg", "$accbd"), "ok": ("$okf", "$okb", "$okb"), "warn": ("$wnf", "$wnb", "$wnb"),
         "neutral": ("$ntf", "$ntb", "$ntb"), "danger": ("$dgf", "$dgb", "$dgb"), "info": ("$inf", "$inb", "$inb")}
    f, b, bd = m[tone]
    dot = icon(ic, 12, sw=2) if ic else '<span style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></span>'
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;'
            f'background:{b};color:{f};border:1px solid {bd};font-size:12.5px;font-weight:500;white-space:nowrap;box-sizing:border-box">{dot}{label}</span>')


def stage(label):
    if label in ("On hold",):
        return pill(label, "warn", "pause")
    if label in ("Stopped", "Closed"):
        return pill(label, "neutral", "squarestop")
    if label.startswith("Draft"):
        return pill(label, "neutral")
    return pill(label, "acc")


RES = {"Met": ("targetcheck", "$okf"), "Not met": ("targetdash", "$ntf"), "Inconclusive": ("targetq", "$wnf"),
       "Planned": ("dashcircle", "$ntf"), "Running": ("progress", "$inf"), "Too early to read": ("clock", "$ntf"), "Amended": ("history", "$wnf")}


def result(state, extra=""):
    ic, c = RES[state]
    ex = f'<span style="color:$t2;font-weight:400"> · {extra}</span>' if extra else ""
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:{c};white-space:nowrap">{icon(ic, 15)}<span style="color:$t1">{state}</span>{ex}</span>'


AST = {"Untested": "$ntf", "Testing": "$inf", "Supported": "$okf", "Contradicted": "$dgf", "Inconclusive": "$wnf", "Retired": "$t3"}


def astatus(state):
    c = AST[state]
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap">'
            f'<span style="color:$asf;display:inline-flex">{icon("pencilruler", 14)}</span>'
            f'<span style="width:7px;height:7px;border-radius:50%;background:{c};flex:none"></span>{state}</span>')


SYNC = {"Not sent": ("$ntf", "link"), "In preview": ("$inf", "eye"), "Sending…": ("$inf", "progress"), "Confirmed": ("$okf", "link"),
        "Failed": ("$dgf", "xcircle"), "Retry": ("$wnf", "refresh"), "Checking": ("$inf", "progress"), "Paused — approval changed": ("$wnf", "pause")}


def sync(state, key=""):
    c, ic = SYNC[state]
    k = f' {mono("· " + key, 12, "$t2")}' if key else ""
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:{c};font-weight:500;white-space:nowrap">'
            f'{icon(ic, 14)}<span>{state}</span>{k}</span>')


CONN = {"Connected": ("$okf", "plug"), "Expired": ("$wnf", "clock"), "Missing permission": ("$wnf", "lock"), "Unavailable": ("$dgf", "unplug")}


def conn(state):
    c, ic = CONN[state]
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:{c};font-weight:500;white-space:nowrap">{icon(ic, 14)}<span style="color:$t1">{state}</span></span>'


FRESH = {"Current": ("$okf", "clock"), "Ageing": ("$wnf", "clock"), "Stale": ("$wnf", "alert"), "Superseded": ("$t3", "history")}


def fresh(state, extra=""):
    c, ic = FRESH[state]
    ex = f'<span style="color:$t2"> · {extra}</span>' if extra else ""
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:{c};white-space:nowrap">{icon(ic, 14)}<span style="color:$t1">{state}</span>{ex}</span>'


RUN = {"Queued": ("$ntf", "dashcircle"), "Working: checking sources…": ("$inf", "progress"), "Needs your input": ("$wnf", "alert"),
       "Partial results": ("$wnf", "halfcircle"), "Done": ("$okf", "checkcircle"), "Stopped — your work is saved": ("$ntf", "squarestop")}


def run(state, extra=""):
    c, ic = RUN[state]
    ex = f'<span style="color:$t2"> {extra}</span>' if extra else ""
    return f'<span role="status" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:{c};white-space:nowrap">{icon(ic, 14)}<span style="color:$t1">{state}</span>{ex}</span>'


REV = {"Signed": ("$okf", "checkcircle"), "Signed · pilot scope": ("$okf", "checkcircle"), "Pending": ("$ntf", "dashcircle"),
       "In review": ("$inf", "halfcircle"), "Blocker": ("$wnf", "alert"), "Disagreement": ("$wnf", "message")}


def review(state, extra=""):
    c, ic = REV[state]
    ex = f'<span style="color:$t2;font-weight:400"> · {extra}</span>' if extra else ""
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:{c};white-space:nowrap">{icon(ic, 15)}<span style="color:$t1">{state}</span>{ex}</span>'


EVQ = {"Strong": ("shieldcheck", "$okf", "$okb"), "Some": ("shieldhalf", "$wnf", "$wnb"), "Weak": ("shielddash", "$ntf", "$ntb"),
       "None": ("shielddash", "$ntf", "$ntb"), "Conflicting": ("shieldalert", "$dgf", "$dgb")}


def evq(state):
    ic, f, b = EVQ[state]
    return (f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:4px;'
            f'background:{b};color:{f};font-size:12.5px;font-weight:500;white-space:nowrap">{icon(ic, 14)}{state}</span>')


def sens(level):
    n = {"High": 3, "Medium": 2, "Low": 1}[level]
    bars = ""
    for i, h in enumerate([5, 9, 13]):
        fill = "$t1" if i < n else "$inact"
        bars += f'<rect x="{1 + i * 5}" y="{14 - h}" width="3" height="{h}" rx="0.5" fill="{fill}"></rect>'
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$t1;white-space:nowrap">'
            f'<svg aria-hidden="true" width="15" height="14" viewBox="0 0 15 14" style="flex:none">{bars}</svg>{level}</span>')


def opp(state):
    return (f'<span style="display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:4px;border:1px solid $bstrong;'
            f'font-size:12px;font-weight:500;color:$t1;white-space:nowrap;box-sizing:border-box">{state}</span>')


def src(publisher, date, q="Strong"):
    ic, f, b = EVQ[q]
    return (f'<a href="Evidence.dc.html" class="chip" style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:4px;'
            f'border:1px solid $border;background:$surface;font-size:12px;color:$t2;white-space:nowrap;vertical-align:1px;text-decoration:none">'
            f'<span style="color:{f};display:inline-flex">{icon(ic, 13)}</span>{publisher} · {date}</a>')


def sc_mark(s, size=12):
    c = {"Downside": "$sdn", "Base": "$sbs", "Upside": "$sup"}[s]
    shape = {"Downside": '<path d="M2 3h10L7 11Z"></path>', "Base": '<circle cx="7" cy="7" r="4.5"></circle>', "Upside": '<path d="M2 11h10L7 3Z"></path>'}[s]
    return f'<svg aria-hidden="true" width="{size}" height="{size}" viewBox="0 0 14 14" style="flex:none;display:inline-block;vertical-align:-1px"><g fill="{c}">{shape}</g></svg>'


def cat_mark(n, size=10):
    return f'<span aria-hidden="true" style="width:{size}px;height:{size}px;border-radius:2px;background:$c{n};flex:none;display:inline-block"></span>'


def avatar(ini, size=28):
    return (f'<span aria-hidden="true" style="width:{size}px;height:{size}px;border-radius:50%;background:$ntb;color:$t1;font-size:{11 if size > 24 else 10}px;'
            f'font-weight:600;display:inline-flex;align-items:center;justify-content:center;flex:none">{ini}</span>')


PEOPLE = {"EF": ("Elena Fischer", "BU VP · Sponsor"), "MR": ("Maya Rao", "Strategy lead · Case owner"), "DW": ("Daniel Weber", "Finance partner"),
          "JK": ("Jonas Klein", "Regional commercial lead · Pilot owner"), "PS": ("Priya Shah", "Product lead"), "LH": ("Lena Hoffmann", "Legal/regulatory specialist"),
          "TA": ("[Tenant administrator]", "Administrator")}


def person(ini, sub=None):
    n, r = PEOPLE[ini]
    subh = f'<span style="font-size:12px;color:$t3">{sub}</span>' if sub else ""
    return (f'<span style="display:inline-flex;align-items:center;gap:8px;min-width:0">{avatar(ini, 22)}<span style="display:flex;flex-direction:column;line-height:16px;min-width:0">'
            f'<span style="font-size:13px;color:$t1;white-space:nowrap">{n}</span>{subh}</span></span>')


# ---------- Buttons, cards, banners ----------
BTN = "display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;box-sizing:border-box;"


def btn(label, kind="s", href=None, ic=None, handler=None, extra="", aria=None, disabled=False, dis_hole=None):
    if kind == "p":
        cls, st = "bp", "border:1px solid $acc;color:#fff;"
    elif kind == "g":
        cls, st = "bg", "border:1px solid transparent;color:$t2;"
    elif kind == "d":  # dark (decision, non-approve)
        cls, st = "bd", "border:1px solid $t1;color:#fff;"
    else:
        cls, st = "bs", "border:1px solid $bstrong;color:$t1;"
    if disabled:
        cls, st = "", "border:1px solid $border;color:$t3;background:$sunken;cursor:not-allowed;"
    i = icon(ic, 15) if ic else ""
    a = f' aria-label="{aria}"' if aria else ""
    if href and not disabled:
        return f'<a href="{href}" class="{cls}"{a} style="{BTN}{st}{extra}">{i}{label}</a>'
    h = f' onClick="{hv(handler)}"' if handler else ""
    d = ' disabled aria-disabled="true"' if disabled else ""
    if dis_hole:
        d = f' disabled="{hv(dis_hole)}"'
    return f'<button type="button" class="{cls}"{a}{h}{d} style="{BTN}{st}{extra}">{i}{label}</button>'


def ibtn(ic, aria, handler=None, href=None):
    st = "width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:6px;color:$t2;cursor:pointer;box-sizing:border-box;flex:none;"
    if href:
        return f'<a href="{href}" class="bg" aria-label="{aria}" style="{st}">{icon(ic, 16)}</a>'
    h = f' onClick="{hv(handler)}"' if handler else ""
    return f'<button type="button" class="bg" aria-label="{aria}"{h} style="{st}">{icon(ic, 16)}</button>'


def card(inner, extra=""):
    return f'<div style="border:1px solid $border;border-radius:8px;background:$surface;{extra}">{inner}</div>'


def h2(t, sub=None, right="", hid=None):
    s = f'<p style="margin:2px 0 0;font-size:13px;color:$t3">{sub}</p>' if sub else ""
    i = f' id="{hid}"' if hid else ""
    return (f'<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 16px;margin-bottom:12px"><div style="flex:1 1 auto;min-width:0">'
            f'<h2{i} style="margin:0;font-size:16px;line-height:24px;font-weight:600">{t}</h2>{s}</div>{right}</div>')


def eyebrow(t):
    return f'<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">{t}</div>'


def banner(kind_, title, body="", actions="", live=True):
    m = {"warn": ("alert", "$wnf", "$wnb"), "danger": ("xcircle", "$dgf", "$dgb"), "info": ("info", "$inf", "$inb"),
         "ok": ("checkcircle", "$okf", "$okb"), "neutral": ("info", "$ntf", "$ntb"), "lock": ("lock", "$rsf", "$rsb")}
    ic, f, b = m[kind_]
    bd = f'<div style="color:$t1;margin-top:2px;font-size:13px">{body}</div>' if body else ""
    ac = f'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;align-items:center">{actions}</div>' if actions else ""
    role = ' role="status"' if live else ""
    return (f'<div{role} style="display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;padding:10px 14px;border-radius:8px;'
            f'background:{b};border:1px solid {b}"><span style="color:{f};align-self:flex-start;margin-top:2px">{icon(ic, 16)}</span>'
            f'<div style="flex:1 1 300px;min-width:0"><div style="font-weight:600;color:{f};font-size:13.5px">{title}</div>{bd}</div>{ac}</div>')


# table helpers
TH = "padding:8px 12px;border-bottom:1px solid $border;font-size:12px;color:$t3;font-weight:500;text-align:left;white-space:nowrap;background:$canvas"
TD = "padding:10px 12px;border-bottom:1px solid $border;font-size:13px;vertical-align:top"
NUM = "text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap"


def table(headers, rows, minw=640, aria=None):
    hs = ""
    for h in headers:
        st = TH + (";text-align:right" if h.startswith(">") else "")
        hs += f'<th scope="col" style="{st}">{h.lstrip(">")}</th>'
    body = ""
    for r in rows:
        cells = ""
        for i, c in enumerate(r):
            st = TD + (";" + NUM if headers[i].startswith(">") else "")
            cells += f'<td style="{st}">{c}</td>'
        body += f'<tr class="hr">{cells}</tr>'
    a = f' aria-label="{aria}"' if aria else ""
    return (f'<div style="overflow-x:auto"><table{a} style="width:100%;border-collapse:collapse;min-width:{minw}px">'
            f'<thead><tr>{hs}</tr></thead><tbody>{body}</tbody></table></div>')


SEG = "display:inline-flex;border:1px solid $border;border-radius:6px;padding:2px;gap:2px;background:$canvas;flex-wrap:wrap"


def seg(listname, aria):
    return (f'<div role="group" aria-label="{aria}" style="{SEG}">'
            + FOR(listname, "b", f'<button type="button" onClick="{hv("b.pick")}" aria-pressed="{hv("b.on")}" style="{hv("b.style")}">{hv("b.label")}</button>', 3)
            + '</div>')


def proto_bar(groups):
    """groups: list of (label, listname)"""
    inner = "".join(f'<span style="color:$t3">{l}</span>{seg(n, l)}' for l, n in groups)
    return (f'<div role="region" aria-label="Prototype controls" style="display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;padding:8px 24px;'
            f'border-bottom:1px dashed $bstrong;background:$canvas;font-size:12.5px;color:$t2">'
            f'<span style="display:inline-flex;gap:6px;align-items:center;font-weight:500;color:$t1">{icon("sliders", 14)}Prototype states</span>{inner}</div>')


# JS helper methods injected into every logic class
JS_HELPERS = r"""
  seg(opts, key) {
    const s = this.state;
    return opts.map(o => ({ label: o[1], on: s[key] === o[0] ? 'true' : 'false', pick: () => this.setState({ [key]: o[0] }),
      style: this.segStyle(s[key] === o[0]) }));
  }
  segStyle(on) {
    return 'min-height:28px;padding:3px 10px;border-radius:4px;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms,color 140ms;' +
      (on ? 'background:$surface;color:$t1;border:1px solid $border;box-shadow:0 1px 1px rgba(15,16,18,.05);font-weight:500;' : 'background:transparent;color:$t2;border:1px solid transparent;');
  }
  chipStyle(on) {
    return 'min-height:30px;padding:4px 10px;border-radius:999px;font:inherit;font-size:12.5px;cursor:pointer;text-align:left;transition:background 140ms;' +
      (on ? 'background:$t1;color:#fff;border:1px solid $t1;' : 'background:$surface;color:$t1;border:1px solid $bstrong;');
  }
"""


def logic(body, state):
    """body: JS of renderVals contents (returning object). state: JS object literal."""
    return f"class Component extends DCLogic {{\n  state = {state};\n{JS_HELPERS}\n  renderVals() {{\n{body}\n  }}\n}}"


# ---------- Shell ----------
NAV1 = [("Overview", "dashboard", "Main.dc.html"), ("Opportunities", "compass", "Opportunities.dc.html"),
        ("Expansion Cases", "briefcase", "Thesis.dc.html"), ("My Work", "checksq", "MyWork.dc.html"),
        ("Evidence", "filetext", "Evidence.dc.html"), ("Reviews", "scale", "Decisions.dc.html"),
        ("Administration", "settings", "Admin.dc.html")]
NAV2 = [("Mandates", "flag", "Mandate.dc.html"), ("Compare", "compare", "Compare.dc.html"), ("Design foundations", "layers", "DesignSystem.dc.html")]


def navitem(label, ic, href, active, count=None, sub=False):
    if active:
        st = "background:$surface;color:$t1;border:1px solid $border;box-shadow:0 1px 0 rgba(15,16,18,.03)"
        cur = ' aria-current="page"'
    else:
        st = "color:$t2;border:1px solid transparent"
        cur = ""
    c = (f'<span style="margin-left:auto;font-size:12px;color:$t1;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:$ntb;'
         f'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box">{count}<span style="position:absolute;left:-9999px"> waiting on you</span></span>') if count else ""
    return (f'<a href="{href}" class="nv"{cur} style="position:relative;display:flex;align-items:center;gap:10px;min-height:32px;padding:0 10px;border-radius:6px;'
            f'text-decoration:none;font-size:13.5px;font-weight:500;{st}">{icon(ic, 16)}<span>{label}</span>{c}</a>')


def app_switcher():
    return f'''<details class="sw" style="position:relative;margin:0 0 12px">
<summary aria-label="Switch Growth OS app. Current app: Market Expansion" style="list-style:none;display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:8px;cursor:pointer;border:1px solid transparent">
<span aria-hidden="true" style="width:28px;height:28px;border-radius:7px;background:$t1;color:#fff;display:flex;align-items:center;justify-content:center;flex:none">{icon("compass", 16, sw=1.8)}</span>
<span style="display:flex;flex-direction:column;line-height:16px;min-width:0;flex:1"><span style="font-size:12px;color:$t3">Growth OS · Aster Industrial Systems</span><span style="font-size:13.5px;font-weight:600;color:$t1">Market Expansion</span></span>
<span style="color:$t3">{icon("chevd", 14)}</span></summary>
<div role="menu" aria-label="Growth OS apps" style="margin-top:6px;border:1px solid $border;border-radius:8px;background:$surface;box-shadow:0 8px 24px rgba(15,16,18,.08);padding:6px">
<div style="font-size:11.5px;color:$t3;padding:4px 8px 6px;font-weight:500">Growth OS apps</div>
<a role="menuitem" href="Main.dc.html" aria-current="true" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;text-decoration:none;color:$t1;background:$canvas">{icon("compass", 16)}<span style="flex:1;font-size:13px;font-weight:500">Market Expansion</span><span style="color:$okf;display:inline-flex;gap:4px;align-items:center;font-size:12px">{icon("check", 13, sw=2.2)}Current</span></a>
<div role="menuitem" aria-disabled="true" style="display:flex;align-items:flex-start;gap:10px;padding:8px;border-radius:6px;color:$t3">{icon("shieldhalf2", 16)}<span style="flex:1;display:flex;flex-direction:column;line-height:17px"><span style="font-size:13px;color:$t2;font-weight:500">Competitive Response</span><span style="font-size:12px">Not enabled in this workspace</span></span></div>
<div style="height:1px;background:$border;margin:4px 0"></div>
<a role="menuitem" href="Admin.dc.html" style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;text-decoration:none;color:$t2;font-size:13px">{icon("settings", 15)}Growth OS settings</a>
</div></details>'''


USERS = {"EF": ("Elena Fischer", "BU VP · Sponsor"), "MR": ("Maya Rao", "Strategy lead"), "JK": ("Jonas Klein", "Pilot owner"),
         "TA": ("[Tenant administrator]", "Administrator"), "DW": ("Daniel Weber", "Finance partner")}


def shell(active, moment, content, user="MR", counts=None, autosave=None):
    counts = counts or {}
    nav = "".join(navitem(l, i, h, l == active, counts.get(l)) for l, i, h in NAV1)
    nav2 = "".join(navitem(l, i, h, l == active) for l, i, h in NAV2)
    name, role = USERS[user]
    save = ""
    if autosave:
        save = f'<span role="status" style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:$t2;white-space:nowrap">{icon("checkcircle", 14, "$okf")}{autosave}</span>'
    return f'''<div style="font-family:$ui;color:$t1;background:$canvas;font-size:14px;line-height:20px;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;min-height:100%">
<div role="note" aria-label="Illustrative data notice" style="min-height:28px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 14px;padding:4px 16px;box-sizing:border-box;background:$sunken;border-bottom:1px solid $border;color:$t2;font-size:12px;line-height:16px">
<span style="display:inline-flex;align-items:center;gap:6px;font-weight:500;color:$t1">{icon("info", 13)}Illustrative data — synthetic</span>
<span>Aster Industrial Systems sample workspace · fictional people and figures · no live systems connected</span>
<span style="display:inline-flex;align-items:center;gap:6px">{icon("clock", 13)}Journey moment: {moment} · CET</span>
</div>
<div style="display:flex;flex-wrap:wrap;align-items:stretch">
<nav aria-label="Primary" style="flex:0 1 240px;max-width:100%;min-width:200px;padding:12px 10px 20px;box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
{app_switcher()}
{nav}
<div style="height:1px;background:$border;margin:14px 6px 10px"></div>
<div style="font-size:12px;color:$t3;padding:0 10px 4px;font-weight:500">Workspace</div>
{nav2}
<div style="margin-top:auto;padding:24px 10px 0;font-size:12px;color:$t3;line-height:16px;display:flex;align-items:center;gap:6px">{kbd("?")} Keyboard shortcuts</div>
</nav>
<div style="flex:999 1 560px;min-width:0;margin:8px 8px 8px 0;background:$surface;border:1px solid $border;border-radius:8px;box-sizing:border-box">
<header style="min-height:52px;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:8px 20px;box-sizing:border-box;border-bottom:1px solid $border">
<button type="button" class="bs" aria-label="Search cases, opportunities, assumptions, experiments and sources" style="display:flex;align-items:center;gap:8px;height:32px;width:min(420px,100%);padding:0 10px;border:1px solid $border;border-radius:6px;color:$t3;font:inherit;font-size:13px;cursor:pointer">
{icon("search", 15)}<span>Search cases, opportunities, assumptions, sources</span><span style="margin-left:auto;display:flex;gap:3px">{kbd("⌘")}{kbd("K")}</span></button>
<div style="margin-left:auto;display:flex;align-items:center;gap:10px">
{save}
<button type="button" class="bg" aria-label="Notifications" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;color:$t2;cursor:pointer">{icon("bell", 17)}</button>
<div style="display:flex;align-items:center;gap:8px;padding-left:4px">
{avatar(user if user in PEOPLE else "TA")}
<span style="display:flex;flex-direction:column;line-height:15px"><span style="font-size:13px;font-weight:500">{name}</span><span style="font-size:12px;color:$t3">{role}</span></span>
</div></div>
</header>
<main style="min-width:0">
{content}
</main>
</div>
</div>
</div>'''


# ---------- Case header with gate rail ----------
TABS = [("Thesis", "Thesis.dc.html"), ("Sizing", "Sizing.dc.html"), ("Feasibility", "Feasibility.dc.html"), ("Economics", "Economics.dc.html"),
        ("Validation", "Validation.dc.html"), ("Decisions", "Decisions.dc.html"), ("Pilot", "Pilot.dc.html"), ("Outcomes", "Outcomes.dc.html"),
        ("History", "Evidence.dc.html")]
SEGS = ["Mandate", "Discovery · Assessment", "Validation", "Pilot · Review", "Scale"]


def gate_node(g, label, caption):
    """g: state string or dict {holeflag: state}"""
    if isinstance(g, dict):
        dia = "".join(IF(k, diamond(v, 16), hint=(i == 0)) for i, (k, v) in enumerate(g.items()))
        st = "".join(IF(k, f'<span>{DIA[v][1]}</span>', hint=(i == 0)) for i, (k, v) in enumerate(g.items()))
    else:
        dia = diamond(g, 16)
        st = f'<span>{DIA[g][1]}</span>'
    return (f'<li style="display:flex;flex-direction:column;align-items:flex-start;gap:3px;min-width:0;flex:0 1 auto">'
            f'<span style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600">{dia}{label}</span>'
            f'<span style="font-size:11.5px;line-height:15px;color:$t2;white-space:nowrap">{caption}</span>'
            f'<span style="font-size:11.5px;line-height:15px;color:$t3;white-space:nowrap">{st}</span></li>')


def rail(current_seg, gates):
    """gates: list of 4 (state, caption)."""
    out = []
    for i, s in enumerate(SEGS):
        on = i == current_seg
        if on:
            st = "background:$accbg;color:$acc;border:1px solid $accbd;font-weight:600"
        elif i < current_seg:
            st = "background:$canvas;color:$t2;border:1px solid $border"
        else:
            st = "background:transparent;color:$t3;border:1px dashed $bstrong"
        cur = '<span style="position:absolute;left:-9999px"> (current stage)</span>' if on else ""
        out.append(f'<li style="flex:1 1 90px;min-width:0;position:relative"><span style="display:flex;align-items:center;justify-content:center;height:24px;padding:0 8px;border-radius:999px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;{st}">{s}{cur}</span></li>')
        if i < 4:
            g, cap = gates[i]
            out.append(gate_node(g, f"G{i}", cap))
    return f'<ol aria-label="Stage and gate rail" style="list-style:none;margin:0;padding:0;display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap">{"".join(out)}</ol>'


def next_block(title, sub, who="EF", extra=""):
    return (f'<div style="display:flex;align-items:center;gap:10px">{avatar(who)}<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:600">{title}</div>'
            f'<div style="font-size:12.5px;color:$t2">{sub}</div></div></div>{extra}')


def case_header(active_tab, stage_html, seg_idx, gates, nxt, freshness="Evidence checked 2 days ago · 1 source ageing", counts=None):
    counts = counts or {}
    tabs = []
    for n, href in TABS:
        cnt = counts.get(n)
        badge = f'<span style="font-size:11.5px;padding:0 6px;height:18px;border-radius:999px;background:$wnb;color:$wnf;display:inline-flex;align-items:center;font-weight:500">{cnt}</span>' if cnt else ""
        if n == active_tab:
            st, cur = "color:$t1;border-bottom:2px solid $t1;font-weight:500", ' aria-current="page"'
        else:
            st, cur = "color:$t2;border-bottom:2px solid transparent", ""
        tabs.append(f'<a href="{href}" class="tb"{cur} style="display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 2px;margin-bottom:-1px;text-decoration:none;font-size:13.5px;white-space:nowrap;{st}">{n}{badge}</a>')
    return f'''<section aria-label="Case header" style="padding:16px 24px 0;border-bottom:1px solid $border">
<nav aria-label="Breadcrumb" style="font-size:12.5px;color:$t3;display:flex;align-items:center;gap:6px;margin-bottom:10px"><a href="Main.dc.html" class="lk" style="color:$t3;text-decoration:none">Expansion cases</a>{icon("chevr", 12)}<span>{mono("ME-104", 12, "$t3")}</span></nav>
<div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
<div style="flex:1 1 520px;min-width:0">
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px">
<span style="font-family:$mono;font-size:13px;color:$t2;padding:2px 6px;border:1px solid $border;border-radius:4px">ME-104</span>
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.01em;text-wrap:balance">German food-processing plants — monitoring</h1>
</div>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:10px">
<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:$t3">Stage {stage_html}</span>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:$t2;border:1px solid $border;border-radius:999px;height:24px;padding:0 10px;box-sizing:border-box">{icon("flag", 13)}Mandate · BU Water · Growth 2027</span>
</div>
<div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:13px;color:$t2">
<span style="display:inline-flex;align-items:center;gap:6px">{icon("user", 14)}Owner Maya Rao</span>
<span style="display:inline-flex;align-items:center;gap:6px">{icon("users", 14)}Sponsor Elena Fischer</span>
<span style="display:inline-flex;align-items:center;gap:6px">{icon("mappin", 14)}Germany · food processing</span>
<span style="display:inline-flex;align-items:center;gap:6px">{mono("EUR · 2026 prices", 12.5)}</span>
<span style="display:inline-flex;align-items:center;gap:6px">{icon("clock", 14)}{freshness}</span>
</div>
</div>
<div style="flex:0 1 360px;min-width:260px;border:1px solid $border;border-radius:8px;padding:12px 14px;background:$canvas">
<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Next decision</div>
{nxt}
</div>
</div>
<div style="margin-top:16px;padding:12px 14px;border:1px solid $border;border-radius:8px">{rail(seg_idx, gates)}</div>
<nav aria-label="Case sections" style="display:flex;gap:22px;margin-top:10px;overflow-x:auto">{"".join(tabs)}</nav>
</section>'''


# common gate presets
G_ASSESS = [("approved", "Mandate · 5 Oct"), ("precond", "Validation €15k · due 16 Oct"), ("notstarted", "Pilot €120k · 90 days"), ("notstarted", "Scale")]
G_VALID = [("approved", "Mandate · 5 Oct"), ("approved", "Validation €15k · 16 Oct"), ("precond", "Pilot €120k · 90 days"), ("notstarted", "Scale")]
G_PILOT = [("approved", "Mandate · 5 Oct"), ("approved", "Validation €15k · 16 Oct"), ("approvedc", "Pilot €120k · 90 days · 27 Nov"), ("notstarted", "Scale")]
G_REVIEW = [("approved", "Mandate · 5 Oct"), ("approved", "Validation €15k · 16 Oct"), ("approvedc", "Pilot €120k · 90 days · 27 Nov"), ("blocked", "Scale · 2 preconditions unmet")]


# ---------- Page writer ----------
HELMET_CSS = """body{margin:0;background:#F7F7F5}
a{color:#3049C9}a:hover{color:#2537A0}
:focus-visible{outline:2px solid #3049C9;outline-offset:2px;border-radius:4px}
.nv{transition:background 140ms,color 140ms}.nv:hover{background:#EDEDE9;color:#17181B}
.bp{background:#3049C9;color:#fff;transition:background 140ms}.bp:hover{background:#2840B3;color:#fff}
.bd{background:#17181B;color:#fff;transition:background 140ms}.bd:hover{background:#33353A;color:#fff}
.bs{background:#fff;transition:background 140ms,border-color 140ms}.bs:hover{background:#F4F4F1;border-color:#C9C9C2}
.bg{background:transparent;transition:background 140ms}.bg:hover{background:#F0F0EC}
.hr{transition:background 140ms}.hr:hover{background:#FAFAF8}
.tb{transition:color 140ms}.tb:hover{color:#17181B}
.lk{transition:color 140ms}.lk:hover{color:#3049C9}
.chip{transition:border-color 140ms}.chip:hover{border-color:#84888F}
.sw summary::-webkit-details-marker{display:none}.sw summary{transition:background 140ms}.sw summary:hover{background:#EDEDE9}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}"""

FONTS = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">\n'
         '<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500&amp;family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&amp;display=swap" rel="stylesheet">')

BANNED = ["agent", "MCP", "harness", "token", "lorem", "Inter,", "Roboto", "Arial", "border-left:", "gradient"]


def render(s):
    return re.sub(r"\$([a-zA-Z][a-zA-Z0-9]*)", lambda m: T.get(m.group(1), m.group(0)), s)


def page(name, title, body, logic_js=None, height=1000, allow_tech=False):
    logic_js = logic_js or "class Component extends DCLogic {\n  renderVals() { return {}; }\n}"
    props = json.dumps({"$preview": {"width": 1440, "height": height}})
    rb = render(body)
    rl = render(logic_js)
    html = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
{FONTS}
<style>
{HELMET_CSS}
</style>
</helmet>
{rb}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
{rl}
</script>
</body>
</html>
'''
    with open(os.path.join(OUT, name), "w") as f:
        f.write(html)
    # checks
    probs = []
    tmp = ROOT + "/me-gen/_t.js"
    open(tmp, "w").write(rl.replace("extends DCLogic", ""))
    r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
    if r.returncode:
        probs.append("JS ERROR " + r.stderr[:600])
    left = sorted(set(re.findall(r"\$[a-zA-Z]+", rb + rl)) - {"$preview"})
    if left:
        probs.append(f"unresolved tokens {left}")
    holes = re.findall(r"\{\{\s*([^}]*?)\s*\}\}", rb)
    aliases = set(re.findall(r'as="(\w+)"', rb))
    for h in set(holes):
        if h in ("true", "false"):
            continue
        if not re.fullmatch(r"[A-Za-z_][\w]*(\.[\w]+)*", h):
            probs.append("bad hole " + h)
            continue
        top = h.split(".")[0]
        dyn = "_" in top and ("'" + top.split("_")[0] + "_'") in rl
        if top not in aliases and not dyn and not re.search(r"\b" + re.escape(top) + r"\b", rl):
            probs.append("hole not in logic: " + h)
    text = re.sub(r"<[^>]+>", " ", rb)
    for w in BANNED:
        hay = text if w in ("agent", "MCP", "harness", "token", "lorem") else rb
        if w in hay and not allow_tech:
            probs.append("banned: " + w)
    # tag balance (rough)
    for t in ["div", "span", "sc-if", "sc-for", "table", "button", "a", "section", "details", "ul", "ol", "li", "label", "svg"]:
        o = len(re.findall(r"<" + t + r"[\s>]", rb)); c = len(re.findall(r"</" + t + r">", rb))
        if o != c:
            probs.append(f"unbalanced <{t}> {o}/{c}")
    print("wrote", name, len(html), "OK" if not probs else probs)


# ---------- ARIA grid table (safe for sc-for / sc-if rows) ----------
GTH = "padding:8px 12px;font-size:12px;color:$t3;font-weight:500;white-space:nowrap"
GTD = "padding:10px 12px;font-size:13px;min-width:0"


def gtable(cols, headers, body, minw=760, aria="Table"):
    """cols: CSS grid-template-columns; headers: list of labels (prefix '>' = right aligned); body: markup of rows (use grow())."""
    hs = "".join(f'<div role="columnheader" style="{GTH}{";text-align:right" if h.startswith(">") else ""}">{h.lstrip(">")}</div>' for h in headers)
    return (f'<div style="overflow-x:auto"><div role="table" aria-label="{aria}" style="min-width:{minw}px;--cols:{cols}">'
            f'<div role="row" style="display:grid;grid-template-columns:{cols};background:$canvas;border-bottom:1px solid $border">{hs}</div>'
            f'{body}</div></div>')


def grow(cols, cells, style_hole=None, cls="hr"):
    st = f"display:grid;grid-template-columns:{cols};border-bottom:1px solid $border;align-items:start;"
    extra = f' style="{st}{hv(style_hole)}"' if style_hole else f' style="{st}"'
    c = "".join(f'<div role="cell" style="{GTD}{";text-align:right;font-variant-numeric:tabular-nums" if r else ""}">{x}</div>' for x, r in cells)
    return f'<div role="row" class="{cls}"{extra}>{c}</div>'
