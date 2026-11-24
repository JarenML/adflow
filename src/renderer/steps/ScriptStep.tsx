import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, CircleAlert, CircleCheck, Clapperboard, Clock, FileText, Mic, RefreshCw, Sparkles, Type, Wand2 } from 'lucide-react';
import type { EpisodeState } from '@shared/types';
import { isClipScene, sceneDuration, sceneKind, sceneNarration, screenTexts, type Scene, type SceneKind } from '@shared/schemas';
import { api, useLive } from '../lib/api';
import { Button, Card, cx, Empty, SectionTitle, Tag } from '../components/ui';

export const KIND_STYLE: Record<SceneKind, { label: string; bar: string; tag: 'cyan' | 'brand' | 'warn' | 'ok' | 'default' }> = {
  real: { label: 'Real', bar: 'bg-brand-2', tag: 'cyan' },
  '2d': { label: '2D', bar: 'bg-brand', tag: 'brand' },
  logo: { label: 'Logo', bar: 'bg-warn', tag: 'warn' },
  final: { label: 'Final', bar: 'bg-ok', tag: 'ok' },
  other: { label: 'Otro', bar: 'bg-faint', tag: 'default' },
};

function fmt(s?: number) {
  return typeof s === 'number' ? `${s.toFixed(1)} s` : '';
}

function DurationBar({ scenes }: { scenes: Scene[] }) {
  const total = scenes.reduce((a, s) => a + sceneDuration(s), 0);
  const max = Math.max(52, total);
  return (
    <div>
      <div className="relative h-9 overflow-hidden rounded-lg border border-line bg-[#0a0c11]">
        <div className="absolute inset-y-0 bg-ok/5" style={{ left: `${(40 / max) * 100}%`, width: `${(10 / max) * 100}%` }} />
        <div className="relative flex h-full">
          {scenes.map((s, i) => {
            const k = sceneKind(s.tipo);
            return (
              <motion.div
                key={s.id}
                title={`${s.id} · ${fmt(sceneDuration(s))}`}
                className={cx('group relative h-full border-r border-bg/80', KIND_STYLE[k].bar)}
                style={{ width: `${(sceneDuration(s) / max) * 100}%`, opacity: 0.85 }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: i * 0.04, duration: 0.35 }}
              >
                <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold text-bg/90">{sceneDuration(s) > 2 ? s.id : ''}</span>
              </motion.div>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>0 s</span>
        <span className={cx(total >= 40 && total <= 50 ? 'text-ok' : 'text-warn')}>
          {total.toFixed(1)} s · meta 40–50 s
        </span>
        <span>{max.toFixed(0)} s</span>
      </div>
    </div>
  );
}

function SceneCard({ s, i }: { s: Scene; i: number }) {
  const k = sceneKind(s.tipo);
  const n = sceneNarration(s);
  const texts = screenTexts(s);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i * 0.04, 0.4) }}
      className="relative grid grid-cols-[84px_1fr] gap-4 rounded-xl border border-line bg-panel-2/40 p-4"
    >
      <div className="flex flex-col items-start gap-2">
        <span className="font-mono text-[13px] font-semibold text-ink">{s.id}</span>
        <Tag tone={KIND_STYLE[k].tag}>{KIND_STYLE[k].label}</Tag>
        {/* Decided here, in the script: Videos generates exactly these scenes. */}
        {isClipScene(s) && (
          <span title="Escena con clip de video de IA (se genera en el paso Videos)">
            <Tag tone="warn">
              <Clapperboard className="size-3" /> Clip
            </Tag>
          </span>
        )}
        <span className="flex items-center gap-1 font-mono text-[11px] text-faint">
          <Clock className="size-3" />
          {typeof s.inicio === 'number' ? `${s.inicio.toFixed(1)}–${(s.fin ?? 0).toFixed(1)}` : fmt(sceneDuration(s))}
        </span>
      </div>
      <div className="min-w-0 space-y-2.5">
        {s.descripcion && <p className="selectable text-[13px] leading-relaxed text-ink">{s.descripcion}</p>}
        {n && (
          <div className="flex gap-2.5 rounded-lg bg-[#0a0c11] px-3 py-2.5">
            <Mic className="mt-0.5 size-3.5 shrink-0 text-brand-2" />
            <div className="selectable text-[13px] leading-relaxed">
              <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-mute">{n.who}</span>
              {n.tone && <span className="mr-1.5 font-mono text-[11px] text-[#b6a5ff]">{n.tone}</span>}
              <span className="text-ink">{n.text}</span>
            </div>
          </div>
        )}
        {texts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {texts.map((t) => (
              <span key={t} className="selectable inline-flex items-center gap-1 rounded-md border border-line-2 bg-panel px-2 py-0.5 text-[11.5px] text-mute">
                <Type className="size-3" />
                {t}
              </span>
            ))}
          </div>
        )}
        {(s.transicion_salida || s.motor) && (
          <div className="grid gap-1 text-[11.5px] text-faint">
            {s.transicion_salida && (
              <p>
                <span className="text-mute">Transición →</span> {s.transicion_salida}
              </p>
            )}
            {s.motor && (
              <p>
                <span className="text-mute">Motor:</span> {s.motor}
                {s.motivo ? ` · ${s.motivo}` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ScriptStep({ episode }: { episode: EpisodeState }) {
  const [data] = useLive(() => api.script(episode.id), [episode.id, episode.updatedAt], episode.id);
  const [tab, setTab] = useState<'scenes' | 'md'>('scenes');
  const st = episode.steps.script.status;
  const script = data?.script;

  if (!script && st === 'working') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl border border-brand-2/20 bg-brand-2/5 px-4 py-3 text-[13px] text-brand-2">
          <Sparkles className="size-4 animate-pulse" /> Claude está escribiendo el guion y las escenas siguiendo el playbook…
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="shimmer h-28 rounded-xl" />
        ))}
      </div>
    );
  }
  if (!script) {
    return (
      <Empty
        icon={<FileText className="size-5" />}
        title={st === 'error' ? 'El guion no se pudo generar' : 'Todavía no hay guion'}
        hint={episode.steps.script.error ?? data?.error ?? 'Claude escribirá guion.md y escenas.json con el formato del playbook.'}
        action={
          <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => api.act(episode.id, { step: 'script', type: 'generate' })}>
            Generar guion
          </Button>
        }
      />
    );
  }

  const pend = (script.pendientes ?? []) as string[];
  const checks = data?.checks ?? [];
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-faint">{String(script.serie ?? episode.serie)}</p>
            <h2 className="mt-0.5 text-lg font-semibold">{String(script.titulo ?? episode.title)}</h2>
            {typeof (script as Record<string, unknown>).frase === 'string' && (
              <p className="mt-1 text-[13px] italic text-mute">«{String((script as Record<string, unknown>).frase)}»</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<RefreshCw className="size-3.5" />} disabled={st === 'working'} onClick={() => api.act(episode.id, { step: 'script', type: 'regenerate' })}>
              Otra versión
            </Button>
            <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved'} onClick={() => api.act(episode.id, { step: 'script', type: 'approve' })}>
              {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
            </Button>
          </div>
        </div>
        <DurationBar scenes={script.escenas} />
        {(() => {
          // The clips are decided here: Videos generates exactly these scenes.
          const clipIds = script.escenas.filter(isClipScene).map((s) => s.id);
          return (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-mute">
              <Clapperboard className="size-3.5 text-warn" />
              {clipIds.length
                ? `Clips de video: ${clipIds.join(', ')} (${clipIds.length} · ≈ ${(clipIds.length * 3640).toLocaleString('es-PE')} créditos de ElevenLabs a 4 s). El resto de escenas reales van como imagen con movimiento.`
                : 'Sin clips de video: todas las escenas reales van como imagen con movimiento.'}
            </p>
          );
        })()}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {checks.map((c) => (
            <span
              key={c.id}
              title={c.detail}
              className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px]', c.ok ? 'border-ok/25 bg-ok/5 text-ok' : 'border-warn/30 bg-warn/5 text-warn')}
            >
              {c.ok ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
              {c.label}
              {!c.ok && <span className="text-[10.5px] opacity-80">· {c.detail}</span>}
            </span>
          ))}
        </div>
        {pend.length > 0 && (
          <div className="mt-4 rounded-xl border border-warn/25 bg-warn/5 px-4 py-3">
            <p className="text-[12px] font-semibold text-warn">Claude propuso estos datos: confírmalos o corrígelos en el chat</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px] text-mute">
              {pend.map((p) => (
                <li key={p} className="selectable">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <div className="flex gap-1 rounded-lg border border-line bg-panel p-1 text-[12.5px] w-fit">
        {(
          [
            ['scenes', `Escenas (${script.escenas.length})`],
            ['md', 'guion.md'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={cx('no-drag rounded-md px-3 py-1.5 font-medium', tab === id ? 'bg-panel-2 text-ink' : 'text-mute hover:text-ink')} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'scenes' ? (
        <div className="space-y-2.5">
          {script.escenas.map((s, i) => (
            <SceneCard key={s.id} s={s} i={i} />
          ))}
        </div>
      ) : (
        <Card className="p-5">
          <SectionTitle title="guion.md" hint="Tabla segundo a segundo, voces, transiciones y plan de música" />
          <pre className="selectable max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-mute">{data?.guion ?? 'Sin guion.md'}</pre>
        </Card>
      )}
    </div>
  );
}
