/**
 * Teaching empty state (ONBOARDING.md §4.4): what this place is for, and the person's real next step with one
 * link. Screens may render it in their empty states; the guide uses it when every step is complete.
 */
import { Link } from 'react-router-dom';

export function GuideEmptyState({
  title,
  body,
  next,
}: {
  title: string;
  body: string;
  next: { label: string; href: string } | null;
}) {
  return (
    <section className="onb-empty" aria-label={title}>
      <h3 className="onb-empty__title">{title}</h3>
      <p className="onb-empty__body">{body}</p>
      {next ? (
        <p className="onb-empty__next">
          What to do next: <Link to={next.href}>{next.label}</Link>
        </p>
      ) : null}
    </section>
  );
}
