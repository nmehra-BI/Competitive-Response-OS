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

