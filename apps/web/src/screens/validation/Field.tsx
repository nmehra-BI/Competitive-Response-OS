/** Labelled single-line input with the shared field styles (gos-field / gos-input). */
import { useId } from 'react';

export function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'text' | 'date' | 'number';
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <label className="gos-field" htmlFor={id}>
      <span>
        {label}
        {required ? <span className="gos-field__hint"> (required)</span> : null}
        {hint ? <span className="gos-field__hint"> ({hint})</span> : null}
      </span>
      <input
        id={id}
        className="gos-input"
        type={type}
        value={value}
        required={required}
        min={type === 'number' ? 0 : undefined}
        onChange={(ev) => onChange(ev.target.value)}
      />
    </label>
  );
}
