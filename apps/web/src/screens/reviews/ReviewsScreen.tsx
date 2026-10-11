/**
 * Reviews inbox (research §8.1–8.2): gate decisions awaiting the viewer and review requests with
 * a focused panel — what to check, then Confirm / Dispute / Abstain with a reason. A review is
 * never a gate decision; decisions open the decision package (S10) or the mandate (G0).
 *
 * Deep links: tab=awaiting|assigned|economics|done, request=<review request id>.
 */
import { API, type ReviewRequest } from '@growth-os/contracts';
import { GateDiamond, Icon, Mono, ReviewPanelView, UiLink } from '@growth-os/ui';
import { useSearchParams } from 'react-router-dom';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';
import { TabPanel, WorkTabs } from '../my-work/WorkTabs';
import { ErrorPage, fmtDate, LoadingPage, PageHeader, useDocumentTitle } from '../overview/shared';

type Tab = 'awaiting' | 'assigned' | 'economics' | 'done';
const TABS: { key: Tab; label: string }[] = [
  { key: 'awaiting', label: 'Awaiting your decision' },
  { key: 'assigned', label: 'Assigned to you' },
  { key: 'economics', label: 'Economics reviews' },
  { key: 'done', label: 'Done' },
];
const EMPTY: Record<Tab, { title: string; body: string }> = {
  awaiting: {
    title: 'No decisions are waiting for you',
    body: 'Gate decisions routed to you appear here with their scope and due date.',
  },
  assigned: { title: 'No reviews assigned to you', body: 'Review requests from case owners appear here.' },
  economics: {
    title: 'No economics reviews',
    body: 'Finance review requests appear here with what to check.',
  },
  done: { title: 'Nothing responded yet', body: 'Your responses stay here with your reason.' },
};

const AREA_LABEL: Record<ReviewRequest['area'], string> = {
  finance: 'Finance review',
  specialist: 'Specialist review',
  product: 'Product review',
  commercial: 'Commercial review',
  pilot_owner: 'Pilot owner review',
  operations: 'Operations review',
  sponsor: 'Sponsor review',
};

export default function ReviewsScreen() {
  useDocumentTitle('Reviews');
  const [params, setParams] = useSearchParams();
  const inbox = useApiQuery(API.work.reviewsInbox, { query: {} });
  const respond = useCommand(API.work.respondToReview);
  if (inbox.isPending) return <LoadingPage label="Reviews" />;
  if (inbox.error) return <ErrorPage title="Reviews" error={inbox.error} />;

  const { gateDecisions, reviewRequests } = inbox.data;
  const open = reviewRequests.filter((r) => r.status === 'open');
  const lists: Record<Exclude<Tab, 'awaiting'>, ReviewRequest[]> = {
    assigned: open.filter((r) => r.area !== 'finance'),
    economics: open.filter((r) => r.area === 'finance'),
    done: reviewRequests.filter((r) => r.status !== 'open'),
  };
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.key === tabParam)
    ? tabParam!
    : gateDecisions.length
      ? 'awaiting'
      : 'assigned';
  const requests = tab === 'awaiting' ? [] : lists[tab];
  const requestParam = params.get('request');
  // After a response the request moves to Done; keep showing it until the viewer picks another.
  const selected = reviewRequests.find((r) => r.id === requestParam) ?? requests[0] ?? null;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };
  const counts: Record<Tab, number> = {
    awaiting: gateDecisions.length,
    assigned: lists.assigned.length,
    economics: lists.economics.length,
    done: lists.done.length,
  };

  return (
    <div className="app-page dx-page">
      <PageHeader
        title="Reviews"
        subtitle="Decisions and reviews that wait on you. A review is never a gate decision."
      />
      <WorkTabs<Tab>
        label="Reviews"
        idPrefix="rv"
        value={tab}
        onChange={(t) => set({ tab: t, request: null })}
        tabs={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
      />
      <TabPanel idPrefix="rv" value={tab}>
        {tab === 'awaiting' ? (
          <div className="dx-list" style={{ maxWidth: 820 }}>
            {gateDecisions.length ? (
              <ul className="dx-items" aria-label="Gate decisions awaiting you">
                {gateDecisions.map((g) => (
                  <li key={g.gateRequestId}>
                    <UiLink href={g.href} className="dx-item">
                      <span className="dx-item__title dx-inline">
                        <GateDiamond status="awaiting_decision" size={14} />
                        {g.buttonLabel}
                      </span>
                      <span className="dx-item__due">{g.dueText}</span>
                      <span className="dx-item__sub">
                        <Mono size={12}>{g.caseKey}</Mono> · Open the package to read it before deciding
                      </span>
                      <span className="dx-item__status" style={{ color: 'var(--info-fg)' }}>
                        Awaiting your decision
                      </span>
                    </UiLink>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty tab={tab} />
            )}
          </div>
        ) : (
          <div className="dx-split" style={{ gap: 20 }}>
            <div className="dx-split__main dx-list" style={{ flexBasis: 440 }}>
              {requests.length ? (
                <ul className="dx-items" aria-label={TABS.find((t) => t.key === tab)!.label}>
                  {requests.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        className="dx-item"
                        aria-current={r.id === selected?.id ? 'true' : undefined}
                        onClick={() => set({ request: r.id })}
                      >
                        <span className="dx-item__title">{r.question}</span>
                        <span className="dx-item__due">
                          {r.dueOn ? `Due ${fmtDate(r.dueOn)}` : 'No due date'}
                        </span>
                        <span className="dx-item__sub">
                          {r.caseKey} · {AREA_LABEL[r.area]} · requested by {r.requestedBy.displayName}
                        </span>
                        <span
                          className="dx-item__status"
                          style={{ color: r.status === 'open' ? 'var(--info-fg)' : 'var(--success-fg)' }}
                        >
                          {r.status === 'open' ? 'Awaiting your review' : 'Responded'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty tab={tab} />
              )}
            </div>
            <div className="dx-split__side dx-stack" style={{ flexBasis: 380 }}>
              {selected ? (
                <>
                  <ReviewPanelView
                    key={selected.id}
                    title={selected.question}
                    reviewer={selected.reviewer}
                    subtitle={`${selected.caseKey} · ${AREA_LABEL[selected.area]} · requested by ${selected.requestedBy.displayName}${selected.dueOn ? ` · due ${fmtDate(selected.dueOn)}` : ''}`}
                    whatToCheck={selected.whatToCheck}
                    response={selected.response}
                    responseReason={selected.responseReason}
                    busy={respond.isPending}
                    onRespond={(r) =>
                      respond.mutate(
                        { params: { id: selected.id }, body: r },
                        { onSuccess: () => set({ request: selected.id }) },
                      )
                    }
                  />
                  {respond.error ? <ProblemBanner error={respond.error} /> : null}
                  <UiLink
                    href={`/me/cases/${selected.caseKey}`}
                    className="dx-stat__more"
                    style={{ paddingTop: 0 }}
                  >
                    Open case {selected.caseKey}
                    <Icon name="chevr" size={13} />
                  </UiLink>
                </>
              ) : null}
            </div>
          </div>
        )}
      </TabPanel>
    </div>
  );
}

function Empty({ tab }: { tab: Tab }) {
  return (
    <div className="dx-empty-center">
      <span className="dx-muted">
        <Icon name="inbox" size={22} />
      </span>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{EMPTY[tab].title}</h2>
      <p>{EMPTY[tab].body}</p>
    </div>
  );
}
