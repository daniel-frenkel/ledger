/**
 * Minimal UI kit. Plain DOM and one stylesheet — no third-party UI library
 * (ask before adding one). Plain on purpose: this is an index card, not a
 * dashboard. There are no streaks, badges, or progress bars anywhere.
 *
 * Ported one-for-one from apps/client/src/ui/index.tsx. Same component names,
 * same props, same copy; the palette moved to CSS custom properties in
 * styles.css so the theme follows the browser instead of useColorScheme.
 */
import React from 'react';

export function Screen({ children, tabs = false }: { children: React.ReactNode; tabs?: boolean }) {
  return <div className={tabs ? 'screen screen--tabs' : 'screen'}>{children}</div>;
}

export function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="h1">{children}</h1>;
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="h2">{children}</h2>;
}

export function P({
  children,
  muted = false,
  strong = false,
  danger = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
  strong?: boolean;
  danger?: boolean;
}) {
  const cls = ['p', muted && 'p--muted', strong && 'p--strong', danger && 'p--danger'].filter(Boolean).join(' ');
  return <p className={cls}>{children}</p>;
}

export function Small({ children }: { children: React.ReactNode }) {
  return <span className="small">{children}</span>;
}

export function Card({ children, loud = false }: { children: React.ReactNode; loud?: boolean }) {
  return <div className={loud ? 'card card--loud' : 'card'}>{children}</div>;
}

export function Divider() {
  return <hr className="divider" />;
}

type FieldProps = {
  label: string;
  hint?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  type?: string;
  inputMode?: 'text' | 'email' | 'numeric';
  autoComplete?: string;
};

export function Field({ label, hint, value, onChangeText, multiline = false, ...rest }: FieldProps) {
  const id = React.useId();
  const common = {
    id,
    className: 'input',
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChangeText(e.target.value),
    placeholder: rest.placeholder,
    maxLength: rest.maxLength,
  };
  return (
    <div className="field">
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {hint ? <span className="hint">{hint}</span> : null}
      {multiline ? (
        <textarea {...common} />
      ) : (
        <input {...common} type={rest.type ?? 'text'} inputMode={rest.inputMode} autoComplete={rest.autoComplete} />
      )}
    </div>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`btn btn--${kind}`} onClick={onPress} disabled={disabled}>
      {title}
    </button>
  );
}

/** Pick one of a few options. Used for verdict, source, channels, kit. */
export function Choice<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  multi = false,
}: {
  label: string;
  hint?: string;
  options: Array<{ value: T; label: string }>;
  value: T | T[] | null;
  onChange: (v: T) => void;
  multi?: boolean;
}) {
  const selected = (v: T) => (multi ? !!(value as T[] | null)?.includes(v) : value === v);
  return (
    <div className="field">
      {label ? <span className="label">{label}</span> : null}
      {hint ? <span className="hint">{hint}</span> : null}
      <div className="choices">
        {options.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={selected(o.value)} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A number on a scale, chosen by tapping. 0–100 shows steps of 10; 0–10 shows each. */
export function Scale({
  label,
  hint,
  min,
  max,
  step = 1,
  value,
  onChange,
  suffix = '',
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step?: number;
  value: number | null;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  const steps: number[] = [];
  for (let v = min; v <= max; v += step) steps.push(v);
  return (
    <div className="field">
      <span className="label">
        {label}
        {value != null ? <span className="accent">{`  ${value}${suffix}`}</span> : null}
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
      <div className="scale">
        {steps.map((v) => (
          <button key={v} type="button" className="scale-btn" aria-pressed={value === v} onClick={() => onChange(v)}>
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
