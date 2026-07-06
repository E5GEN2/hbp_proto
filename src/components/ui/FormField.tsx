'use client';
import { HelpTip } from './HelpTip';

export function FormField({
  label, required, hint, children, span,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={span ? { gridColumn: `span ${span}` } : undefined}>
      <label className="form-label">
        {label}
        {required && <span style={{ color: 'var(--danger)' }}> *</span>}
        {hint && <HelpTip>{hint}</HelpTip>}
      </label>
      {children}
    </div>
  );
}
