import re, json, os

OUT = "/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad/canvas/project"

T = {
    "canvas": "#F7F7F5", "surface": "#FFFFFF", "sunken": "#F0F0EC", "border": "#E4E4DF",
    "bstrong": "#D6D6D0", "ctrl": "#84888F", "t1": "#17181B", "t2": "#4B4F57", "t3": "#6A6E76",
    "acc": "#3049C9", "accbg": "#EEF0FB", "accbd": "#C9D0F2",
    "okf": "#1B7046", "okb": "#E6F3EB", "wnf": "#8A5300", "wnb": "#FBF0DA",
    "dgf": "#B3261E", "dgb": "#FCEBEA", "inf": "#2853B8", "inb": "#E9EEFA",
    "ntf": "#4B4F57", "ntb": "#EEEEEB", "aif": "#6A3DB0", "aib": "#F1ECFA",
    "rsf": "#3B4250", "rsb": "#E8EAEE", "inact": "#CFCFCA",
    "ui": "Geist, 'Helvetica Neue', system-ui, sans-serif",
    "serif": "'Source Serif 4', Georgia, 'Times New Roman', serif",
    "mono": "'Geist Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
}

P = {
 "search": '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
 "bell": '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>',
 "dashboard": '<rect width="7" height="9" x="3" y="3" rx="1"></rect><rect width="7" height="5" x="14" y="3" rx="1"></rect><rect width="7" height="9" x="14" y="12" rx="1"></rect><rect width="7" height="5" x="3" y="16" rx="1"></rect>',
 "inbox": '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path>',
 "briefcase": '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path><rect width="20" height="14" x="2" y="6" rx="2"></rect>',
 "checksq": '<path d="m9 11 3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>',
 "target": '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>',
 "eye": '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
 "database": '<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v14a9 3 0 0 0 18 0V5"></path><path d="M3 12a9 3 0 0 0 18 0"></path>',
 "plug": '<path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"></path>',
 "sliders": '<line x1="21" x2="14" y1="4" y2="4"></line><line x1="10" x2="3" y1="4" y2="4"></line><line x1="21" x2="12" y1="12" y2="12"></line><line x1="8" x2="3" y1="12" y2="12"></line><line x1="21" x2="16" y1="20" y2="20"></line><line x1="12" x2="3" y1="20" y2="20"></line><line x1="14" x2="14" y1="2" y2="6"></line><line x1="8" x2="8" y1="10" y2="14"></line><line x1="16" x2="16" y1="18" y2="22"></line>',
 "calendar": '<rect width="18" height="18" x="3" y="4" rx="2"></rect><path d="M16 2v4"></path><path d="M8 2v4"></path><path d="M3 10h18"></path>',
 "file": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
 "arrowin": '<path d="M12 15V3"></path><path d="m7 10 5 5 5-5"></path><path d="M3 15v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"></path>',
 "lock": '<rect width="18" height="11" x="3" y="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
 "cloudoff": '<path d="m2 2 20 20"></path><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.31-.2"></path><path d="M21.53 16.82A4.5 4.5 0 0 0 17.5 10h-1.79A7.01 7.01 0 0 0 10.7 5.24"></path>',
 "dashcircle": '<circle cx="12" cy="12" r="9" stroke-dasharray="3.5 3"></circle>',
 "sparkle": '<path d="M12 3l1.8 5.4L19 10.2l-5.2 1.8L12 17.4l-1.8-5.4L5 10.2l5.2-1.8Z"></path><path d="M19 15.5v4"></path><path d="M17 17.5h4"></path>',
 "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>',
 "checkcircle": '<circle cx="12" cy="12" r="9.5"></circle><path d="m8.5 12 2.5 2.5 4.5-5"></path>',
 "xcircle": '<circle cx="12" cy="12" r="9.5"></circle><path d="m15 9-6 6"></path><path d="m9 9 6 6"></path>',
 "alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path>',
 "pause": '<circle cx="12" cy="12" r="9.5"></circle><line x1="10" x2="10" y1="15" y2="9"></line><line x1="14" x2="14" y1="15" y2="9"></line>',
 "info": '<circle cx="12" cy="12" r="9.5"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path>',
 "progress": '<circle cx="12" cy="12" r="9" opacity=".3"></circle><path d="M12 3a9 9 0 0 1 9 9"></path>',
 "halfcircle": '<circle cx="12" cy="12" r="9"></circle><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor" stroke="none"></path>',
 "circle": '<circle cx="12" cy="12" r="9"></circle>',
 "chevr": '<path d="m9 18 6-6-6-6"></path>', "chevd": '<path d="m6 9 6 6 6-6"></path>', "chevl": '<path d="m15 18-6-6 6-6"></path>',
 "ext": '<path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
 "filter": '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>',
 "clock": '<circle cx="12" cy="12" r="9.5"></circle><polyline points="12 6 12 12 16 14"></polyline>',
 "compare": '<circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><path d="M11 18H8a2 2 0 0 1-2-2V9"></path>',
 "history": '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l4 2"></path>',
 "clip": '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
 "flag": '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" x2="4" y1="22" y2="15"></line>',
 "copy": '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
 "refresh": '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path d="M8 16H3v5"></path>',
 "pencil": '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"></path>',
 "ruler": '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"></path><path d="m14.5 12.5 2-2"></path><path d="m11.5 9.5 2-2"></path><path d="m8.5 6.5 2-2"></path><path d="m17.5 15.5 2-2"></path>',
 "help": '<circle cx="12" cy="12" r="9.5"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path>',
 "plus": '<path d="M5 12h14"></path><path d="M12 5v14"></path>', "minus": '<path d="M5 12h14"></path>',
 "x": '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>', "check": '<path d="M20 6 9 17l-5-5"></path>',
 "arrowr": '<path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>',
 "upload": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" x2="12" y1="3" y2="15"></line>',
 "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
 "message": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>',
 "activity": '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
 "keyboard": '<rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="M6 8h.01"></path><path d="M10 8h.01"></path><path d="M14 8h.01"></path><path d="M18 8h.01"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path><path d="M7 16h10"></path>',
 "layers": '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"></path><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"></path><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"></path>',
 "globe": '<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>',
 "package": '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path>',
 "archive": '<rect width="20" height="5" x="2" y="3" rx="1"></rect><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"></path><path d="M10 12h4"></path>',
 "panel": '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M15 3v18"></path>',
 "more": '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
 "barchart": '<path d="M3 3v18h18"></path><path d="M18 17V9"></path><path d="M13 17V5"></path><path d="M8 17v-3"></path>',
 "sigma": '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"></path>',
 "user": '<circle cx="12" cy="8" r="4"></circle><path d="M20 21a8 8 0 0 0-16 0"></path>',
 "send": '<path d="m22 2-7 20-4-9-9-4Z"></path><path d="M22 2 11 13"></path>',
 "shieldp": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
 "corner": '<polyline points="15 10 20 15 15 20"></polyline><path d="M4 4v7a4 4 0 0 0 4 4h12"></path>',
 "split": '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M12 3v18"></path>',
}
SH = P["shieldp"]
P["shieldcheck"] = SH + '<path d="m9 12 2 2 4-4"></path>'
P["shieldalert"] = SH + '<path d="M12 8v4"></path><path d="M12 16h.01"></path>'
P["shieldhalf"] = SH + '<path d="M12 2.6C10.3 4 7.6 5 5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 8 8.9Z" fill="currentColor" stroke="none" opacity=".45"></path>'
P["shielddash"] = SH.replace('<path ', '<path stroke-dasharray="3 2.6" ')


def icon(name, size=16, color=None, sw=1.6, label=None):
    col = f"color:{color};" if color else ""
    aria = f'role="img" aria-label="{label}"' if label else 'aria-hidden="true"'
    return (f'<svg {aria} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" style="flex:none;display:block;{col}">{P[name]}</svg>')


def prio(level):
    n = {"High": 3, "Medium": 2, "Low": 1}[level]
    bars = ""
    for i, h in enumerate([5, 9, 13]):
        fill = "$t1" if i < n else "$inact"
        bars += f'<rect x="{1 + i * 5}" y="{14 - h}" width="3" height="{h}" rx="0.5" fill="{fill}"></rect>'
    w = "500" if level == "High" else "400"
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:$t1;font-weight:{w};white-space:nowrap">'
            f'<svg aria-hidden="true" width="15" height="14" viewBox="0 0 15 14" style="flex:none">{bars}</svg>{level}</span>')


EV = {"Verified": ("shieldcheck", "okf", "okb"), "Partial": ("shieldhalf", "wnf", "wnb"),
      "Conflicting": ("shieldalert", "dgf", "dgb"), "Unverified": ("shielddash", "ntf", "ntb")}


def ev(state, extra=""):
    ic, f, b = EV[state]
    txt = state + (f' <span style="font-weight:400;opacity:.85">· {extra}</span>' if extra else "")
    return (f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:4px;'
            f'background:${b};color:${f};font-size:12.5px;font-weight:500;white-space:nowrap">{icon(ic, 14)}{txt}</span>')


def life(label):
    if label.startswith("Needs information"):
        f, b, ic, bd = "$wnf", "$wnb", "alert", "$wnb"
    elif label.startswith("Approved"):
        f, b, ic, bd = "$okf", "$okb", "check", "$okb"
    elif label.startswith(("Closed", "Archived", "Draft")):
        f, b, ic, bd = "$ntf", "$ntb", "circle", "$ntb"
    else:
        f, b, ic, bd = "$acc", "$accbg", "circle", "$accbd"
    dot = icon(ic, 12, sw=2.4) if ic != "circle" else '<span style="width:7px;height:7px;border-radius:50%;background:currentColor;flex:none"></span>'
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;'
            f'background:{b};color:{f};border:1px solid {bd};font-size:12.5px;font-weight:500;white-space:nowrap">{dot}{label}</span>')


CT = {"Fact": ("file", "t2"), "Inference · AI": ("sparkle", "aif"), "Assumption": ("ruler", "t2"), "Unknown": ("help", "t2")}


def ct(kind):
    ic, c = CT[kind]
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;'
            f'border:1px solid $bstrong;color:${c};font-size:12px;white-space:nowrap">{icon(ic, 12)}{kind}</span>')


def ai(label="AI draft"):
    dashed = "border:1px dashed $aif;" if label == "AI draft" else "border:1px solid $aib;"
    return (f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;'
            f'background:$aib;color:$aif;{dashed}font-size:12px;font-weight:500;white-space:nowrap">{icon("sparkle", 12)}{label}</span>')


def restr(kind="Restricted"):
    ic = {"Restricted": "lock", "Unavailable": "cloudoff", "Missing": "dashcircle"}[kind]
    return (f'<span style="display:inline-flex;align-items:center;gap:5px;width:104px;height:22px;padding:0 8px;border-radius:4px;'
            f'background:$rsb;color:$rsf;font-size:12.5px;box-sizing:border-box">{icon(ic, 13)}{kind}</span>')


def mono(t, size=12.5, color="$t2"):
    return f'<span style="font-family:$mono;font-size:{size}px;color:{color};letter-spacing:0">{t}</span>'


TASK = {"Not started": ("dashcircle", "ntf"), "In progress": ("halfcircle", "inf"), "Blocked": ("alert", "wnf"),
        "Submitted": ("progress", "inf"), "Accepted": ("checkcircle", "t2"), "Done": ("checkcircle", "okf")}


def task(state):
    ic, c = TASK[state]
    return f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:${c};white-space:nowrap">{icon(ic, 15)}<span style="color:$t1">{state}</span></span>'


SYNC = {"Not sent": ("ntf", "link"), "Sending…": ("inf", "progress"), "Confirmed": ("okf", "link"), "Failed": ("dgf", "xcircle"),
        "Paused": ("wnf", "pause"), "Checking": ("inf", "progress")}


def sync(state, key=""):
    c, ic = SYNC[state]
    k = f' {mono("· " + key, 12, "$t2")}' if key else ""
    return (f'<span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:${c};font-weight:500;white-space:nowrap">'
            f'{icon(ic, 14)}{state}{k}</span>')


def src(state, publisher, date):
    ic, f, b = EV[state]
    return (f'<span style="display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 6px;border-radius:4px;'
            f'border:1px solid $border;background:$surface;font-size:12px;color:$t2;white-space:nowrap;vertical-align:1px">'
            f'<span style="color:${f};display:inline-flex">{icon(ic, 13)}</span>{publisher} · {date}</span>')


def kbd(k):
    return (f'<kbd style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 4px;'
            f'border:1px solid $bstrong;border-bottom-width:2px;border-radius:4px;background:$surface;font-family:$mono;font-size:11px;color:$t2;box-sizing:border-box">{k}</kbd>')


MACROS = {
    "i": lambda a: icon(a[0], int(a[1]) if len(a) > 1 and a[1] else 16, a[2] if len(a) > 2 else None),
    "prio": lambda a: prio(a[0]), "ev": lambda a: ev(a[0], a[1] if len(a) > 1 else ""), "life": lambda a: life(a[0]),
    "ct": lambda a: ct(a[0]), "ai": lambda a: ai(a[0] if a and a[0] else "AI draft"), "restr": lambda a: restr(a[0] if a and a[0] else "Restricted"),
    "mono": lambda a: mono(a[0]), "task": lambda a: task(a[0]), "sync": lambda a: sync(a[0], a[1] if len(a) > 1 else ""),
    "src": lambda a: src(a[0], a[1], a[2]), "kbd": lambda a: kbd(a[0]),
}


def render(s):
    for _ in range(3):
        s = re.sub(r"\[\[(\w+):([^\]]*)\]\]", lambda m: MACROS[m.group(1)](m.group(2).split("|")), s)
    s = re.sub(r"\$([a-zA-Z][a-zA-Z0-9]*)", lambda m: T.get(m.group(1), m.group(0)), s)
    return s


# ---------- Shell ----------
NAV1 = [("Overview", "dashboard", "Main.dc.html"), ("Signal Inbox", "inbox", "SignalInbox.dc.html"),
        ("Cases", "briefcase", "CaseSummary.dc.html"), ("My Actions", "checksq", "MyActions.dc.html"), ("Outcomes", "target", "Outcomes.dc.html")]
NAV2 = [("Watchlists", "eye", "Watchlists.dc.html"), ("Portfolio", "database", "Watchlists.dc.html"),
        ("Integrations", "plug", "Integrations.dc.html"), ("Settings", "sliders", "Integrations.dc.html")]


def navitem(label, ic, href, active, count=None):
    if active:
        st = "background:$surface;color:$t1;border:1px solid $border;box-shadow:0 1px 0 rgba(15,16,18,.03)"
        cur = ' aria-current="page"'
    else:
        st = "color:$t2;border:1px solid transparent"
        cur = ""
    c = (f'<span style="margin-left:auto;font-size:12px;color:$t2;min-width:20px;height:18px;padding:0 6px;border-radius:999px;background:$ntb;'
         f'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box" aria-label="{count} need you">{count}</span>') if count else ""
    return (f'<a href="{href}" class="nv"{cur} style="display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:6px;'
            f'text-decoration:none;font-size:13.5px;font-weight:500;{st}">{icon(ic, 16)}<span>{label}</span>{c}</a>')


def shell(active, moment, content, user=("Maya Patel", "CI Lead · Diagnostics", "MP"), counts=None):
    counts = counts or {}
    nav = "".join(navitem(l, i, h, l == active, counts.get(l)) for l, i, h in NAV1)
    nav2 = "".join(navitem(l, i, h, l == active) for l, i, h in NAV2)
    name, role, ini = user
    return f'''<div style="font-family:$ui;color:$t1;background:$canvas;font-size:14px;line-height:20px;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;min-height:100%">
<div role="note" aria-label="Illustrative data notice" style="min-height:28px;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 14px;padding:4px 16px;box-sizing:border-box;background:$sunken;border-bottom:1px solid $border;color:$t2;font-size:12px;line-height:16px">
<span style="display:inline-flex;align-items:center;gap:6px;font-weight:500;color:$t1">[[i:info|13]]Illustrative data — fictional</span>
<span>Northstar Diagnostics sample workspace · no live systems connected</span>
<span style="display:inline-flex;align-items:center;gap:6px">[[i:clock|13]]Journey moment: {moment} · Times in CET</span>
</div>
<div style="display:flex;flex-wrap:wrap;align-items:stretch">
<nav aria-label="Primary" style="flex:1 1 240px;max-width:100%;padding:12px 10px 20px;box-sizing:border-box;display:flex;flex-direction:column;gap:2px">
<a href="Main.dc.html" style="display:flex;align-items:center;gap:10px;padding:6px 8px 14px;text-decoration:none;color:$t1">
<span aria-hidden="true" style="width:26px;height:26px;border-radius:6px;background:$t1;color:$surface;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex:none">N</span>
<span style="display:flex;flex-direction:column;line-height:16px"><span style="font-size:13.5px;font-weight:600">Northstar Diagnostics</span><span style="font-size:12px;color:$t3">Competitive Response OS</span></span>
</a>
{nav}
<div style="height:1px;background:$border;margin:14px 6px 10px"></div>
<div style="font-size:12px;color:$t3;padding:0 10px 4px;font-weight:500">Workspace</div>
{nav2}
<div style="margin-top:auto;padding:24px 10px 0;font-size:12px;color:$t3;line-height:16px;display:flex;align-items:center;gap:6px">[[kbd:?]] Keyboard shortcuts</div>
</nav>
<div style="flex:999 1 560px;min-width:0;margin:8px 8px 8px 0;background:$surface;border:1px solid $border;border-radius:8px;box-sizing:border-box">
<header style="height:52px;display:flex;align-items:center;gap:12px;padding:0 20px;border-bottom:1px solid $border">
<button type="button" class="bs" aria-label="Search cases, competitors, products and permitted accounts" style="display:flex;align-items:center;gap:8px;height:32px;width:min(420px,100%);padding:0 10px;border:1px solid $border;border-radius:6px;color:$t3;font:inherit;font-size:13px;cursor:pointer;transition:background 140ms">
[[i:search|15]]<span>Search cases, competitors, products, accounts</span><span style="margin-left:auto;display:flex;gap:3px">[[kbd:⌘]][[kbd:K]]</span></button>
<div style="margin-left:auto;display:flex;align-items:center;gap:6px">
<button type="button" class="bg" aria-label="Notifications" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;border-radius:6px;color:$t2;cursor:pointer;transition:background 140ms">[[i:bell|17]]</button>
<div style="display:flex;align-items:center;gap:8px;padding-left:6px">
<span aria-hidden="true" style="width:28px;height:28px;border-radius:50%;background:$ntb;color:$t1;display:flex;align-items:center;justify-content:center;font-size:11.5px;font-weight:600">{ini}</span>
<span style="display:flex;flex-direction:column;line-height:15px"><span style="font-size:13px;font-weight:500">{name}</span><span style="font-size:12px;color:$t3">{role}</span></span>
</div></div>
</header>
<main style="min-width:0">
{content}
</main>
</div>
</div>
</div>'''


# ---------- Case header ----------
TABS = [("Summary", "CaseSummary.dc.html"), ("Evidence", "Evidence.dc.html"), ("Impact", "Impact.dc.html"),
        ("Response Options", "ResponseOptions.dc.html"), ("Decision", "Decision.dc.html"), ("Action Plan", "ActionPlan.dc.html"),
        ("Outcomes", "Outcomes.dc.html"), ("Activity", "CaseSummary.dc.html")]
STAGES = ["Verify", "Assess", "Decide", "Execute", "Monitor", "Close"]


def rail(current, flag=None):
    idx = STAGES.index(current)
    out = []
    for i, s in enumerate(STAGES):
        if i < idx:
            dot = f'<span style="width:16px;height:16px;border-radius:50%;background:$ntb;color:$t2;display:flex;align-items:center;justify-content:center">{icon("check", 11, sw=2.4)}</span>'
            lab = f'<span style="font-size:12.5px;color:$t2">{s}</span>'
        elif i == idx:
            dot = '<span style="width:16px;height:16px;border-radius:50%;background:$acc;box-shadow:0 0 0 3px $accbg;display:flex;align-items:center;justify-content:center"><span style="width:6px;height:6px;border-radius:50%;background:$surface"></span></span>'
            lab = f'<span style="font-size:12.5px;color:$t1;font-weight:600">{s}<span style="position:absolute;left:-9999px">(current stage)</span></span>'
        else:
            dot = '<span style="width:16px;height:16px;border-radius:50%;border:1.5px solid $bstrong;box-sizing:border-box;background:$surface"></span>'
            lab = f'<span style="font-size:12.5px;color:$t3">{s}</span>'
        out.append(f'<li style="display:flex;align-items:center;gap:7px;position:relative">{dot}{lab}</li>')
        if i < len(STAGES) - 1:
            col = "$t3" if i < idx else "$bstrong"
            out.append(f'<li aria-hidden="true" style="flex:1 1 24px;min-width:16px;max-width:72px;height:1px;background:{col}"></li>')
    return f'<ol aria-label="Case lifecycle" style="list-style:none;margin:0;padding:0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">{"".join(out)}</ol>'


def case_header(active_tab, life_label, stage, evidence, updated, next_block, tab_counts=None):
    tab_counts = tab_counts or {}
    tabs = []
    for name, href in TABS:
        cnt = tab_counts.get(name)
        badge = f'<span style="font-size:11.5px;padding:0 6px;height:18px;border-radius:999px;background:$wnb;color:$wnf;display:inline-flex;align-items:center;font-weight:500">{cnt}</span>' if cnt else ""
        if name == active_tab:
            st = "color:$t1;border-bottom:2px solid $t1;font-weight:500"
            cur = ' aria-current="page"'
        else:
            st = "color:$t2;border-bottom:2px solid transparent"
            cur = ""
        tabs.append(f'<a href="{href}" class="tb"{cur} style="display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 2px;margin-bottom:-1px;text-decoration:none;font-size:13.5px;white-space:nowrap;transition:color 140ms;{st}">{name}{badge}</a>')
    return f'''<section aria-label="Case header" style="padding:16px 24px 0;border-bottom:1px solid $border">
<nav aria-label="Breadcrumb" style="font-size:12.5px;color:$t3;display:flex;align-items:center;gap:6px;margin-bottom:10px"><a href="Main.dc.html" class="lk" style="color:$t3;text-decoration:none">Cases</a>[[i:chevr|12]]<span>[[mono:CR-1042]]</span></nav>
<div style="display:flex;flex-wrap:wrap;gap:16px 24px;align-items:flex-start">
<div style="flex:1 1 520px;min-width:0">
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px">
<span style="font-family:$mono;font-size:13px;color:$t2;padding:2px 6px;border:1px solid $border;border-radius:4px">CR-1042</span>
<h1 style="margin:0;font-size:22px;line-height:30px;font-weight:600;letter-spacing:-0.01em;text-wrap:balance">Apex AX-Scan Germany launch response</h1>
</div>
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-top:10px">
{life(life_label)}
<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:$t3">Priority {prio("High")}</span>
<span style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:$t3">Evidence {ev(evidence)}</span>
</div>
<div style="display:flex;flex-wrap:wrap;gap:4px 16px;margin-top:10px;font-size:13px;color:$t2">
<span style="display:inline-flex;align-items:center;gap:6px">[[i:building|14]]Apex Diagnostics</span>
<span style="display:inline-flex;align-items:center;gap:6px">[[i:globe|14]]Germany</span>
<span style="display:inline-flex;align-items:center;gap:6px">[[i:package|14]]Diagnostics BU · ND-200</span>
<span style="display:inline-flex;align-items:center;gap:6px">[[i:user|14]]Owner Maya Patel</span>
<span style="display:inline-flex;align-items:center;gap:6px;color:$t3">[[i:clock|14]]Updated {updated}</span>
</div>
</div>
<div style="flex:0 1 360px;min-width:260px;border:1px solid $border;border-radius:8px;padding:12px 14px;background:$canvas">
<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:6px">Next required action</div>
{next_block}
</div>
</div>
<div style="margin-top:16px">{rail(stage)}</div>
<nav aria-label="Case sections" style="display:flex;gap:22px;margin-top:14px;overflow-x:auto">{"".join(tabs)}</nav>
</section>'''


ICONS_B = {"building": '<rect width="16" height="20" x="4" y="2" rx="2"></rect><path d="M9 22v-4h6v4"></path><path d="M8 6h.01"></path><path d="M16 6h.01"></path><path d="M12 6h.01"></path><path d="M12 10h.01"></path><path d="M12 14h.01"></path><path d="M16 10h.01"></path><path d="M16 14h.01"></path><path d="M8 10h.01"></path><path d="M8 14h.01"></path>'}
P.update(ICONS_B)

HELMET_CSS = """body{margin:0;background:#F7F7F5}
a{color:#3049C9}a:hover{color:#2537A0}
:focus-visible{outline:2px solid #3049C9;outline-offset:2px;border-radius:4px}
.nv{transition:background 140ms,color 140ms}.nv:hover{background:#EDEDE9;color:#17181B}
.bp{background:#3049C9;color:#fff;transition:background 140ms,box-shadow 140ms}.bp:hover{background:#2840B3;color:#fff}
.bs{background:#fff;transition:background 140ms,border-color 140ms}.bs:hover{background:#F4F4F1;border-color:#C9C9C2}
.bg{background:transparent;transition:background 140ms}.bg:hover{background:#F0F0EC}
.hr{transition:background 140ms}.hr:hover{background:#FAFAF8}
.tb:hover{color:#17181B}
.lk{transition:color 140ms}.lk:hover{color:#3049C9}
@media (prefers-reduced-motion: reduce){*{transition:none!important;animation:none!important}}"""

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">\n<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&amp;family=Geist+Mono:wght@400;500&amp;family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&amp;display=swap" rel="stylesheet">'


def page(name, title, body, logic=None, height=1000, extra_css=""):
    logic = logic or "class Component extends DCLogic {\n  renderVals() { return {}; }\n}"
    props = json.dumps({"$preview": {"width": 1440, "height": height}})
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
{extra_css}
</style>
</helmet>
{render(body)}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{props}'>
{render(logic)}
</script>
</body>
</html>
'''
    assert "[[" not in html.split("<script type")[0], "unrendered macro"
    with open(os.path.join(OUT, name), "w") as f:
        f.write(html)
    import subprocess
    js = render(logic).replace("extends DCLogic", "")
    open("/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad/gen/t.js", "w").write(js)
    r = subprocess.run(["node", "--check", "/tmp/claude-0/-home-user-Competitive-Response-OS/cd408d1f-f189-53bc-a33b-3f0ac1a3e72c/scratchpad/gen/t.js"], capture_output=True, text=True)
    left = sorted(set(re.findall(r"\$[a-zA-Z]+", html)) - {"$preview", "$index"})
    print("wrote", name, len(html), "JS OK" if r.returncode == 0 else "JS ERROR " + r.stderr[:400], "tokens:", left)


# Reusable UI snippets
def btn(label, kind="s", href=None, ic=None, handler=None, extra="", aria=None, disabled=False):
    base = "display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 14px;border-radius:6px;font:inherit;font-size:13.5px;font-weight:500;text-decoration:none;white-space:nowrap;cursor:pointer;box-sizing:border-box;"
    if kind == "p":
        cls, st = "bp", "border:1px solid $acc;color:#fff;"
    elif kind == "g":
        cls, st = "bg", "border:1px solid transparent;color:$t2;"
    else:
        cls, st = "bs", "border:1px solid $bstrong;color:$t1;"
    if disabled:
        cls, st = "", "border:1px solid $border;color:$t3;background:$sunken;cursor:not-allowed;"
    i = icon(ic, 15) if ic else ""
    a = f' aria-label="{aria}"' if aria else ""
    if href and not disabled:
        return f'<a href="{href}" class="{cls}"{a} style="{base}{st}{extra}">{i}{label}</a>'
    h = f' onClick="{{{{ {handler} }}}}"' if handler else ""
    d = ' disabled aria-disabled="true"' if disabled else ""
    return f'<button type="button" class="{cls}"{a}{h}{d} style="{base}{st}{extra}">{i}{label}</button>'


def card(inner, extra=""):
    return f'<div style="border:1px solid $border;border-radius:8px;background:$surface;{extra}">{inner}</div>'


def h2(t, sub=None, right=""):
    s = f'<p style="margin:2px 0 0;font-size:13px;color:$t3">{sub}</p>' if sub else ""
    return f'<div style="display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px 16px;margin-bottom:12px"><div style="flex:1 1 auto;min-width:0"><h2 style="margin:0;font-size:16px;line-height:24px;font-weight:600">{t}</h2>{s}</div>{right}</div>'


def banner(kind, title, body="", actions=""):
    m = {"warn": ("alert", "wnf", "wnb"), "danger": ("xcircle", "dgf", "dgb"), "info": ("info", "inf", "inb"),
         "ok": ("checkcircle", "okf", "okb"), "neutral": ("info", "ntf", "ntb")}
    ic, f, b = m[kind]
    bd = f'<div style="color:$t1;margin-top:2px;font-size:13px">{body}</div>' if body else ""
    ac = f'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-left:auto;align-items:center">{actions}</div>' if actions else ""
    return (f'<div role="status" style="display:flex;flex-wrap:wrap;gap:10px 12px;align-items:flex-start;padding:10px 14px;border-radius:8px;'
            f'background:${b};border:1px solid ${b}"><span style="color:${f};margin-top:2px">{icon(ic, 16)}</span>'
            f'<div style="flex:1 1 300px;min-width:0"><div style="font-weight:600;color:${f};font-size:13.5px">{title}</div>{bd}</div>{ac}</div>')


# ---------- Shared components ----------
def measure(label, value, meta, sub="", dashed=False, tag=""):
    bd = "1.5px dashed $ctrl" if dashed else "1px solid $border"
    bg = "$canvas" if dashed else "$surface"
    t = f'<span style="display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 6px;border-radius:4px;border:1px dashed $ctrl;font-size:11.5px;color:$t2;font-weight:500">{icon("ruler", 11)}{tag}</span>' if tag else ""
    s = f'<div style="font-size:12.5px;color:$t2;margin-top:6px;line-height:18px">{sub}</div>' if sub else ""
    return f'''<div style="border:{bd};border-radius:8px;background:{bg};padding:14px 16px;min-width:0;display:flex;flex-direction:column">
<div style="display:flex;align-items:center;gap:8px;justify-content:space-between"><span style="font-size:12.5px;font-weight:500;color:$t2">{label}</span>{t}</div>
<div style="font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.02em;margin-top:6px;font-variant-numeric:tabular-nums">{value}</div>
<div style="font-size:12px;color:$t3;line-height:17px;margin-top:2px">{meta}</div>{s}</div>'''


def group_label(t):
    return f'<div style="font-size:12px;color:$t3;font-weight:500;margin-bottom:8px;display:flex;align-items:center;gap:6px">{t}</div>'


def exposure_compact():
    return f'''<div style="display:flex;flex-direction:column;gap:10px">
{measure("Relevant annual revenue", "€24.0M", "TTM to 30 Sep 2026 · ND-200 · German segment · EUR")}
{measure("Affected existing accounts", "18", "Distinct accounts · confirmed product and segment scope")}
<div role="separator" aria-label="Not recognized revenue" style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:$t3;margin:4px 0"><span style="flex:1;height:1px;background:$bstrong"></span>Not recognized revenue<span style="flex:1;height:1px;background:$bstrong"></span></div>
{measure("Open pipeline", "€6.0M", "Current opportunities · EUR · not added to revenue")}
{measure("Scenario range (assumption)", "€1.2–3.6M", "€24.0M × 5–15% assumed erosion over 12 months · not predicted loss", dashed=True, tag="Assumption")}
<div style="font-size:12px;color:$t3;display:flex;align-items:center;gap:6px">{icon("database", 13)}Snapshot 30 Sep 2026 · CSV import · CRM not connected</div>
</div>'''


def next_waiting(who, since, why_handler=None):
    return f'''<div style="display:flex;align-items:center;gap:10px">
<span aria-hidden="true" style="width:28px;height:28px;border-radius:50%;background:$ntb;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none">EF</span>
<div style="flex:1;min-width:0"><div style="font-size:13.5px;font-weight:500">Waiting on {who}</div><div style="font-size:12.5px;color:$t2">Approve response · {since}</div></div>
</div>'''
