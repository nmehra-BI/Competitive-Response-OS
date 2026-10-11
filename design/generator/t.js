class Component  {
  state = { j: 'idle', f: 'all' };
  componentWillUnmount() { clearTimeout(this.t); }
  renderVals() {
    const s = this.state;
    const segB = (on) => 'height:26px;padding:0 10px;border-radius:4px;border:0;font:inherit;font-size:12.5px;cursor:pointer;transition:background 140ms;' + (on ? 'background:#FFFFFF;color:#17181B;font-weight:500;box-shadow:0 0 0 1px #E4E4DF;' : 'background:transparent;color:#4B4F57;');
    const E = [
      { t: 'write', when: '15 Oct, 09:06', actor: 'Maya Patel', text: 'Retried T-03 · Jira issue confirmed · same request ID reused', ref: 'NSD-414' },
      { t: 'write', when: '15 Oct, 09:01', actor: 'System', text: 'Jira create failed for T-03 (timeout) · no issue created', ref: 'T-03' },
      { t: 'write', when: '15 Oct, 09:00', actor: 'Maya Patel', text: 'Authorized plan v1 under approval v3 · 4 Jira writes requested', ref: 'plan v1' },
      { t: 'appr', when: '14 Oct, 15:10', actor: 'Elena Fischer', text: 'Approved decision package v3 · rationale and constraints recorded', ref: '7c1e·94ab' },
      { t: 'appr', when: '14 Oct, 10:42', actor: 'Maya Patel', text: 'Submitted decision package v3', ref: 'v3' },
      { t: 'appr', when: '13 Oct, 09:30', actor: 'Elena Fischer', text: 'Requested changes on decision package v2', ref: '3b90·1f2d' },
      { t: 'config', when: '1 Oct, 10:20', actor: 'Maya Patel', text: 'Created portfolio snapshot 30 Sep 2026 from CSV', ref: 'snapshot' },
      { t: 'config', when: '1 Oct, 09:30', actor: '[Workspace admin]', text: 'Set Jira write scope to project NSD only', ref: 'jira' }
    ];
    const F = [['all', 'All'], ['appr', 'Decisions'], ['write', 'External writes'], ['config', 'Configuration']];
    const events = E.filter(e => s.f === 'all' || e.t === s.f);
    return {
      jIdle: s.j === 'idle', jChecking: s.j === 'checking', jOk: s.j === 'ok',
      testJira: () => { this.setState({ j: 'checking' }); clearTimeout(this.t); this.t = setTimeout(() => this.setState({ j: 'ok' }), 1100); },
      filters: F.map(([k, l]) => ({ label: l, on: s.f === k ? 'true' : 'false', style: segB(s.f === k), pick: () => this.setState({ f: k }) })),
      events, auditFoot: 'Showing ' + events.length + ' of ' + E.length + ' events for CR-1042 and workspace setup'
    };
  }
}