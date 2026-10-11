/** App-wide providers: query client, autosave status channel, router-aware links for @growth-os/ui. */
import { UiLinkContext, type UiLinkComponent } from '@growth-os/ui';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AutosaveProvider } from '../lib/drafts';

/** Internal hrefs navigate client-side; external ones stay plain anchors. */
export const RouterLink: UiLinkComponent = ({ href, children, ...rest }) =>
  href.startsWith('/') ? (
    <Link to={href} {...rest}>
      {children}
    </Link>
  ) : (
    <a href={href} {...rest}>
      {children}
    </a>
  );

export function AppProviders({ client, children }: { client: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <AutosaveProvider>
        <UiLinkContext.Provider value={RouterLink}>{children}</UiLinkContext.Provider>
      </AutosaveProvider>
    </QueryClientProvider>
  );
}
