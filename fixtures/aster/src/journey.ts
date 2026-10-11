/**
 * Journey moments from the prototype (Europe/Berlin). The e2e acceptance script and demo seed
 * use these to place the case at a known point. Times use explicit offsets (CEST until 25 Oct 2026).
 */
export const journeyMoments = {
  mandateDrafted: '2026-10-02T10:00:00+02:00',
  mandateApproved: '2026-10-05T10:12:00+02:00',
  opportunitiesDetected: '2026-10-07T09:20:00+02:00',
  compared: '2026-10-08T10:00:00+02:00',
  sizingCommitted: '2026-10-13T16:30:00+02:00',
  adoptionDisputed: '2026-10-14T10:02:00+02:00',
  g1Approved: '2026-10-16T15:02:00+02:00',
  validationResults: '2026-11-20T17:12:00+01:00',
  specialistSigned: '2026-11-23T11:05:00+01:00',
  g2Submitted: '2026-11-25T16:40:00+01:00',
  g2Approved: '2026-11-27T09:14:00+01:00',
  pilotActivated: '2026-12-01T09:00:00+01:00',
  actualsRecorded: '2027-03-04T16:10:00+01:00',
  decisionRecorded: '2027-03-05T11:20:00+01:00',
  extensionSubmitted: '2027-03-05T14:05:00+01:00',
} as const;

export type JourneyMoment = keyof typeof journeyMoments;
