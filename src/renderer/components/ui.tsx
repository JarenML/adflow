import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import type { StepStatus, TeamProgress, TeamStatus } from '@shared/types';
import { describeProgress, TEAM_STATUS_LABEL } from '@shared/progress';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode }) {
  const styles: Record<Variant, string> = {
    primary: 'brand-gradient text-white shadow-[0_8px_24px_-8px_rgba(124,92,255,0.7)] hover:brightness-110',
    secondary: 'bg-panel-2 text-ink border border-line-2 hover:border-faint hover:bg-[#171b25]',
    ghost: 'text-mute hover:text-ink hover:bg-panel-2',
    danger: 'bg-bad/10 text-bad border border-bad/30 hover:bg-bad/20',
  };
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-9 px-3.5 text-sm gap-2', lg: 'h-11 px-5 text-sm gap-2' };
  return (
    <button
      className={cx(
        'no-drag inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-lg font-medium transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer',
        styles[variant],
        sizes[size],
        className,
      )}
      {...rest}
      disabled={loading || rest.disabled}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-2xl border border-line bg-panel', className)}>{children}</div>;
}

export function SectionTitle({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    // The title keeps a readable width: when the actions on the right don't fit beside it, they wrap
    // below instead of squeezing the text into a narrow column.
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-[260px] flex-1">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-[13px] leading-relaxed text-mute">{hint}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export const STATUS_LABEL: Record<StepStatus, string> = {
  locked: 'Bloqueado',
  ready: 'Listo para empezar',
  working: 'Trabajando',
  review: 'Esperando por ti',
  approved: 'Aprobado',
  error: 'Necesita atención',
};

const STATUS_STYLE: Record<StepStatus, string> = {
  locked: 'text-faint bg-white/[0.03] border-line',
  ready: 'text-ink bg-white/[0.04] border-line-2',
  working: 'text-brand-2 bg-brand-2/10 border-brand-2/30',
  review: 'text-warn bg-warn/10 border-warn/30',
  approved: 'text-ok bg-ok/10 border-ok/30',
  error: 'text-bad bg-bad/10 border-bad/30',
};

export function StatusPill({ status, label }: { status: StepStatus; label?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium', STATUS_STYLE[status])}>
      <span className={cx('size-1.5 rounded-full bg-current', status === 'working' && 'animate-pulse')} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

export function Tag({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'brand' | 'ok' | 'warn' | 'bad' | 'cyan' }) {
  const tones = {
    default: 'text-mute bg-white/[0.04] border-line-2',
    brand: 'text-[#b6a5ff] bg-brand/10 border-brand/30',
    cyan: 'text-brand-2 bg-brand-2/10 border-brand-2/30',
    ok: 'text-ok bg-ok/10 border-ok/30',
    warn: 'text-warn bg-warn/10 border-warn/30',
    bad: 'text-bad bg-bad/10 border-bad/30',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', tones[tone])}>{children}</span>;
}

export function Empty({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-panel-2 text-mute">{icon}</div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="mt-1 max-w-md text-[13px] text-mute">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-mute">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'no-drag w-full rounded-lg border border-line-2 bg-[#0a0c11] px-3 py-2 text-sm text-ink placeholder:text-faint outline-none focus:border-brand/60 focus:ring-2 focus:ring-brand/20';

export function Select({ value, onChange, options, disabled }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean }) {
  return (
    <select className={cx(inputCls, 'appearance-none pr-8')} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    // Logo «Flujo»: an A crossed by a flowing line (same drawing as build/icon.svg).
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <defs>
        <linearGradient id="adflow-flow" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#7c5cff" />
        </linearGradient>
      </defs>
      <path d="M22 100 L60 20 L98 100" fill="none" stroke="currentColor" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 76 C 40 58, 72 88, 108 62" fill="none" stroke="url(#adflow-flow)" strokeWidth="9" strokeLinecap="round" />
    </svg>
  );
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const TEAM_STYLE: Record<TeamStatus, string> = {
  pendiente: 'text-mute bg-white/[0.04] border-line-2',
  en_produccion: 'text-brand-2 bg-brand-2/10 border-brand-2/30',
  terminado: 'text-[#b6a5ff] bg-brand/10 border-brand/30',
  publicado: 'text-ok bg-ok/10 border-ok/30',
};

/** One of the four team statuses, optionally with the step ("En producción · Imágenes"). */
export function TeamStatusPill({ progress, status, extra }: { progress?: TeamProgress; status?: TeamStatus; extra?: string }) {
  const s = progress?.status ?? status ?? 'pendiente';
  const label = progress ? describeProgress(progress) : TEAM_STATUS_LABEL[s];
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium', TEAM_STYLE[s])}>
      {s === 'publicado' ? <CheckCircle2 className="size-3" /> : s === 'pendiente' ? <Circle className="size-3" /> : <span className={cx('size-1.5 rounded-full bg-current', s === 'en_produccion' && 'animate-pulse')} />}
      {label}
      {extra && <span className="opacity-70">· {extra}</span>}
      {progress?.waitingForYou && <span className="ml-0.5 size-1.5 rounded-full bg-warn" title="Esperando por ti" />}
      {progress?.error && <span className="ml-0.5 size-1.5 rounded-full bg-bad" title="Necesita atención" />}
    </span>
  );
}
