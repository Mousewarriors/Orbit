import type { ReactNode } from 'react';

/** A titled settings section with an optional descriptive blurb. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <h2>{title}</h2>
        {description && <p className="settings-section-desc">{description}</p>}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

/** A labelled field grouping a control with an optional hint line. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="settings-field">
      <div className="settings-field-label">{label}</div>
      <div className="settings-field-control">{children}</div>
      {hint && <p className="settings-field-hint">{hint}</p>}
    </div>
  );
}

/** A horizontal row, used for inline toggles. */
export function Row({ children }: { children: ReactNode }): JSX.Element {
  return <div className="settings-row">{children}</div>;
}

/** An accessible on/off switch. */
export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <label className={`settings-toggle${disabled ? ' is-disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`settings-switch${checked ? ' is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="settings-switch-knob" />
      </button>
      <span className="settings-toggle-label">{label}</span>
    </label>
  );
}
