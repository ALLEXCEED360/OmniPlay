'use client';

import { setCursorStyle, setMotion, usePreferences } from '@/lib/preferences';

/**
 * Interface preferences: animation, and whose cursor you see.
 *
 * Per device rather than per account (see lib/preferences.ts), and the
 * panel says so — a setting that silently failed to follow someone to
 * their laptop would read as a bug.
 *
 * Both take effect on the press, with no save button: there is nothing to
 * validate and nothing to send, and the proof that it worked is the
 * interface itself behaving differently a moment later.
 */
export function InterfaceSettings() {
  const { motion, cursor } = usePreferences();

  return (
    <div className="card hud-corners divide-y divide-ink-850">
      <Row
        label="Animation"
        description="Page transitions, the curtain between screens, and panels arriving. Off leaves everything in place the moment it loads."
        options={[
          { id: 'on', label: 'On' },
          { id: 'off', label: 'Off' },
        ]}
        value={motion ? 'on' : 'off'}
        onChange={(next) => setMotion(next === 'on')}
      />
      <Row
        label="Cursor"
        description="The gold arrowhead, or your system's own pointer. Touch screens always use their own."
        options={[
          { id: 'custom', label: 'OMNIPLAY' },
          { id: 'system', label: 'System' },
        ]}
        value={cursor}
        onChange={(next) => setCursorStyle(next === 'system' ? 'system' : 'custom')}
      />
      <p className="px-5 py-3 text-[11px] leading-snug text-ink-500">
        Saved on this device. If your system asks for reduced motion, that wins whatever is set
        here.
      </p>
    </div>
  );
}

/** One preference: a label, what it does, and a pair of slanted choices. */
function Row({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description: string;
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
      <div className="min-w-0 max-w-md">
        <div className="display text-lg text-ink-100">{label}</div>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">{description}</p>
      </div>

      <div className="flex shrink-0" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(option.id)}
              className={`-skew-x-[14deg] px-5 py-2 font-display text-sm font-bold uppercase tracking-wider transition-colors duration-150 ${
                active
                  ? 'bg-accent text-ink-950'
                  : 'text-ink-400 shadow-[inset_0_0_0_1.5px_var(--color-ink-700)] hover:text-ink-100'
              }`}
            >
              <span className="inline-block skew-x-[14deg]">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
