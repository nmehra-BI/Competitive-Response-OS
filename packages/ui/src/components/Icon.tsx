import type { CSSProperties, ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { ICON_PATHS, type IconName } from './icon-paths';

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  /** When set the icon is announced (role="img"); otherwise it is decorative (aria-hidden). */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

/** Lucide-style stroke icon. Paths are static constants ported from the prototype generator. */
export function Icon({ name, size = 16, strokeWidth = 1.6, label, className, style }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  return (
    <svg
      {...a11y}
      className={className ? `gos-icon ${className}` : 'gos-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}

/**
 * Link rendering is injected by the app (react-router `Link` in apps/web) so components in this
 * package never depend on a router. Default: a plain anchor.
 */
export interface UiLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
  'aria-label'?: string;
  'aria-current'?: 'page' | 'true' | undefined;
  style?: CSSProperties;
}
export type UiLinkComponent = (props: UiLinkProps) => ReactNode;

const PlainLink: UiLinkComponent = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

export const UiLinkContext = createContext<UiLinkComponent>(PlainLink);

export function UiLink(props: UiLinkProps) {
  const L = useContext(UiLinkContext);
  return <>{L(props)}</>;
}
