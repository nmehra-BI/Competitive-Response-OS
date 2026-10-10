/** The Aster personas offered by the dev login picker (fixtures/aster org.ts), by short name. */
export const PERSONAS = {
  elena: { name: 'Elena Fischer', landing: '/reviews?tab=awaiting' },
  maya: { name: 'Maya Rao', landing: '/me/overview?view=operator' },
  daniel: { name: 'Daniel Weber', landing: '/reviews?tab=economics' },
  jonas: { name: 'Jonas Klein', landing: '/my-work' },
  priya: { name: 'Priya Shah', landing: '/reviews?tab=assigned' },
  lena: { name: 'Lena Hoffmann', landing: '/reviews?tab=assigned' },
  // D-109 §5: synthetic investment committee members (finance and operations seats; no G3 grant).
  katrin: { name: 'Katrin Vogel', landing: '/reviews?tab=awaiting' },
  thomas: { name: 'Thomas Berger', landing: '/reviews?tab=awaiting' },
  admin: { name: '[Tenant administrator]', landing: '/admin/health' },
} as const;

export type PersonaKey = keyof typeof PERSONAS;
