// Narrow re-exports for tests in this package.
export { ENDPOINTS } from './api';
export { AnalyticsEventName, AnalyticsProps } from './events';
export { Money, toFingerprint } from './primitives';

/** PRD §17 lists exactly 20 analytics events. Changing this number needs a change request. */
export const ANALYTICS_EVENT_COUNT_GUARD = 20;
