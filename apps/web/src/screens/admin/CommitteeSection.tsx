/**
 * S14 › Investment committee (D-109 §3, D-124): who holds the chair, finance and operations seats of
 * each business unit, from the Finance-signed delegation of authority. Membership is not authority: a
 * member decides only with a grant for the gate ("Committee named · G3 authority not granted").
 * Administrators never seat themselves (the server and the database refuse it).
 */
import {
  API,
  COMMITTEE_SEAT_LABELS,
  CommitteeSeat,
  type CommitteeMember,
  type PersonRef,
} from '@growth-os/contracts';
import { Banner, Button, DataTable, Mono, Person, SectionHeader, Skeleton } from '@growth-os/ui';
import { useId, useState } from 'react';
import { ProblemBanner } from '../../app/shell/ProblemBanner';
import { useApiQuery, useCommand } from '../../lib/query';

export function CommitteeSection() {
  const q = useApiQuery(API.admin.committee);
  const people = useApiQuery(API.directory.people, { query: {} }, { retry: false, staleTime: 600_000 });
  const scope = useApiQuery(API.directory.scopeOptions, { query: {} }, { retry: false, staleTime: 600_000 });
  const set = useCommand(API.admin.setCommitteeMember);
  const bus = new Map((scope.data?.businessUnits ?? []).map((b) => [b.id, b.name]));
  const directory: PersonRef[] = people.data?.items ?? [];
  return (
    <section id="admin-committee" className="ws8d-admin-section" aria-labelledby="admin-committee-h">
      <SectionHeader
        id="admin-committee-h"
        title="Investment committee"
        subtitle="Chair, finance and operations seats per business unit · 2 of 3 on the same snapshot, the finance seat required. Membership is not authority."
      />
      {q.isPending ? (
        <Skeleton height={120} />
      ) : q.error ? (
        <ProblemBanner error={q.error} />
      ) : (
        <>
          {q.data.gaps.map((g) => (
            <Banner
              key={`${g.businessUnitId}-${g.seat ?? 'authority'}`}
              tone="warn"
              live={false}
              title={g.message}
              body={`${bus.get(g.businessUnitId) ?? 'Business unit'} · the authority gap stays until Finance grants G3 authority.`}
            />
          ))}
          <div className="gos-card" style={{ overflow: 'hidden' }}>
            <DataTable<CommitteeMember>
              ariaLabel="Investment committee"
              rowKey={(m) => m.id}
              rows={q.data.items}
              minWidth={760}
              columns={[
                { key: 'seat', header: 'Seat', cell: (m) => COMMITTEE_SEAT_LABELS[m.seat] },
                {
                  key: 'member',
                  header: 'Member',
                  cell: (m) => <Person name={m.person.displayName} initials={m.person.initials} />,
                },
                { key: 'bu', header: 'Business unit', cell: (m) => bus.get(m.businessUnitId) ?? '—' },
                {
                  key: 'doa',
                  header: 'DoA reference',
                  cell: (m) => (m.doaReference ? <Mono size={12}>{m.doaReference}</Mono> : '—'),
                },
                {
                  key: 'state',
                  header: 'Status',
                  cell: (m) =>
                    m.revokedAt ? (
                      'Revoked'
                    ) : (
                      <span className="ws8d-row" style={{ gap: 8 }}>
                        Seated
                        <Button
                          variant="ghost"
                          disabled={set.isPending}
                          disabledReason="Saving…"
                          onClick={() =>
                            set.mutate({
                              params: { id: m.id },
                              body: {
                                userId: m.userId,
                                businessUnitId: m.businessUnitId,
                                seat: m.seat,
                                validFrom: m.validFrom,
                                validTo: m.validTo,
                                doaReference: m.doaReference,
                                revoked: true,
                              },
                            })
                          }
                        >
                          {`Revoke ${COMMITTEE_SEAT_LABELS[m.seat].toLowerCase()}`}
                        </Button>
                      </span>
                    ),
                },
              ]}
            />
          </div>
          <NameSeatForm
            people={directory}
            businessUnits={[...bus.entries()].map(([id, name]) => ({ id, name }))}
            onSubmit={(body) => set.mutate({ params: { id: crypto.randomUUID() }, body })}
            busy={set.isPending}
          />
          {set.error ? <ProblemBanner error={set.error} /> : null}
        </>
      )}
    </section>
  );
}

function NameSeatForm({
  people,
  businessUnits,
  onSubmit,
  busy,
}: {
  people: PersonRef[];
  businessUnits: { id: string; name: string }[];
  onSubmit: (b: {
    userId: string;
    businessUnitId: string;
    seat: CommitteeSeat;
    validFrom: string;
    validTo: null;
    doaReference: string;
    revoked: false;
  }) => void;
  busy: boolean;
}) {
  const id = useId();
  const [seat, setSeat] = useState<CommitteeSeat>('chair');
  const [userId, setUserId] = useState('');
  const [bu, setBu] = useState('');
  const [doa, setDoa] = useState('');
  const [from, setFrom] = useState('');
  const ready = !!userId && !!(bu || businessUnits[0]) && !!doa.trim() && !!from;
  return (
    <form
      aria-label="Name a committee seat holder"
      className="ws8d-form"
      style={{ marginTop: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onSubmit({
          userId,
          businessUnitId: bu || businessUnits[0]!.id,
          seat,
          validFrom: from,
          validTo: null,
          doaReference: doa.trim(),
          revoked: false,
        });
      }}
    >
      <div className="ws8d-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label htmlFor={`${id}-seat`}>
          Seat{' '}
          <select id={`${id}-seat`} value={seat} onChange={(e) => setSeat(e.target.value as CommitteeSeat)}>
            {CommitteeSeat.options.map((s) => (
              <option key={s} value={s}>
                {COMMITTEE_SEAT_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-who`}>
          Member{' '}
          <select id={`${id}-who`} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose…</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-bu`}>
          Business unit{' '}
          <select id={`${id}-bu`} value={bu} onChange={(e) => setBu(e.target.value)}>
            {businessUnits.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-doa`}>
          DoA reference <input id={`${id}-doa`} value={doa} onChange={(e) => setDoa(e.target.value)} />
        </label>
        <label htmlFor={`${id}-from`}>
          Valid from{' '}
          <input id={`${id}-from`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <Button
          variant="secondary"
          type="submit"
          disabled={!ready || busy}
          disabledReason="Choose the member and enter the DoA reference and start date."
        >
          Name seat holder
        </Button>
      </div>
    </form>
  );
}
