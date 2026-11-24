import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, CircleAlert, Coins, Hash, Loader2, Mic, Pause, Play, RefreshCw, Search, Sparkles, Wand2 } from 'lucide-react';
import type { EpisodeState, ProviderInfo, Settings, VoiceOption } from '@shared/types';
import { DEFAULT_HEYGEN_CREDIT_LIMIT, DEFAULT_VOICE_CREDIT_LIMIT, heygenCredits, heygenMaxCredits, lineCredits, planHeygenRun, planVoiceRun } from '@shared/voiceCredits';
import { languageOptions, matchesVoice, voiceIdFromQuery, type GenderFilter } from '@shared/voiceFilter';
import { api, useLive } from '../lib/api';
import { Button, Card, cx, Empty, Field, inputCls, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag } from './PrepStep';

const cleanError = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const fmt = (n: number) => n.toLocaleString('es-PE');
/** HeyGen premium credits for some characters (1 per 1,000, shared meter), e.g. 0,43. */
const hgCredits = (chars: number) => heygenCredits(chars).toLocaleString('es-PE', { maximumFractionDigits: 2 });

const GENDERS: { id: GenderFilter; label: string }[] = [
  { id: 'all', label: 'Todas' },
  { id: 'female', label: 'Femeninas' },
  { id: 'male', label: 'Masculinas' },
];

/** One group of filter buttons (only one active inside the group). */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11.5px] text-faint">{label}</span>
      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-panel-2/40 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={cx('no-drag rounded-lg px-2.5 py-1 text-[12px] transition-colors', value === o.id ? 'bg-panel text-ink shadow-sm' : 'text-mute hover:text-ink')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function VoiceStep({ episode }: { episode: EpisodeState }) {
  const [lines] = useLive(() => api.narration(episode.id), [episode.id], episode.id);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [voiceError, setVoiceError] = useState('');
  const [query, setQuery] = useState('');
  // Two independent filters that combine: language (all, Spanish, English…) and gender.
  const [lang, setLang] = useState('all');
  const [gender, setGender] = useState<GenderFilter>('all');
  const [sample, setSample] = useState('');
  const [testOpen, setTestOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [playingAll, setPlayingAll] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const providerId = episode.voice?.provider ?? episode.providers.voice;
  const prov = providers.find((p) => p.id === providerId);
  /** Paid voices (ElevenLabs) work only when credits are allowed in Settings. */
  const usable = !!prov?.implemented && (prov.billing !== 'credits' || !!settings?.allowPaidProviders);
  const st = episode.steps.voice.status;
  const list = lines ?? [];

  // ElevenLabs charges per character (eleven_v3): every run is planned against the episode's limit.
  const paid = providerId === 'elevenlabs';
  /** HeyGen goes through its MCP in Claude Code: the catalog is cached and each line costs quota. */
  const heygen = providerId === 'heygen-voice';
  // Each paid provider has its own limit per run, in its own credits: ElevenLabs credits (1 per
  // character) or HeyGen premium credits (1 per 1,000 characters, checked against the worst case).
  const limit = heygen ? (episode.heygenCreditLimit ?? DEFAULT_HEYGEN_CREDIT_LIMIT) : (episode.voiceCreditLimit ?? DEFAULT_VOICE_CREDIT_LIMIT);
  const [limitDraft, setLimitDraft] = useState(String(limit));
  useEffect(() => setLimitDraft(String(limit)), [limit]);
  const missingLines = list.filter((l) => !l.url);
  const generated = list.length - missingLines.length;
  const planAll = planVoiceRun(list.map((l) => l.text), limit);
  const planMissing = planVoiceRun(missingLines.map((l) => l.text), limit);
  const hgPlan = planHeygenRun(list.map((l) => l.text), limit);
  const saveLimit = () => {
    const n = Math.max(0, Math.round(Number(limitDraft.replace(/[^\d]/g, '')) || 0));
    setLimitDraft(String(n));
    if (n !== limit) void api.patchEpisode(episode.id, heygen ? { heygenCreditLimit: n } : { voiceCreditLimit: n });
  };

  useEffect(() => {
    api.providers().then((p) => setProviders(p.filter((x) => x.capability === 'voice')));
    api.getSettings().then(setSettings);
  }, []);
  const loadVoices = (refresh = false) => {
    if (!refresh) setVoices([]);
    setVoiceError('');
    setVoicesLoading(true);
    api
      .voices(providerId, refresh)
      .then(setVoices)
      .catch((e) => setVoiceError(cleanError(e)))
      .finally(() => setVoicesLoading(false));
  };
  useEffect(() => loadVoices(), [providerId]);
  useEffect(() => {
    if (!sample && list[0]) setSample(list[0].text);
  }, [list.length]);

  const languages = useMemo(() => languageOptions(voices), [voices]);
  const filtered = useMemo(() => voices.filter((v) => matchesVoice(v, lang, gender, query)).slice(0, 120), [voices, query, lang, gender]);
  const chosen = voices.find((v) => v.id === episode.voice?.voiceId);

  // A voice ID pasted in the search (copied from the provider's site, where its sample is heard in
  // Spanish): if the list does not have it, AdFlow looks it up (free) and adds it.
  const pastedId = voiceIdFromQuery(query);
  const idInList = !!pastedId && voices.some((v) => v.id === pastedId);
  const canLookup = !!pastedId && !idInList && (heygen || paid);
  const [lookingUp, setLookingUp] = useState(false);
  const lookupById = async () => {
    if (!pastedId) return;
    setLookingUp(true);
    setVoiceError('');
    try {
      const v = await api.voiceById(providerId, pastedId);
      setVoices((prev) => [v, ...prev.filter((x) => x.id !== v.id)]);
      setLang('all');
      setGender('all');
      await choose(v);
    } catch (e) {
      setVoiceError(cleanError(e));
    } finally {
      setLookingUp(false);
    }
  };

  // Free samples: ElevenLabs' own recording of each voice, downloaded once and played locally.
  const sampleAudio = useRef<HTMLAudioElement | null>(null);
  const [samplePlaying, setSamplePlaying] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState<string | null>(null);
  const playSample = async (v: VoiceOption) => {
    sampleAudio.current?.pause();
    if (samplePlaying === v.id) return setSamplePlaying(null);
    setSampleLoading(v.id);
    try {
      const url = await api.voiceSample(v.id, v.previewUrl!);
      const a = new Audio(url);
      sampleAudio.current = a;
      a.onended = () => setSamplePlaying(null);
      setSamplePlaying(v.id);
      await a.play();
    } catch (e) {
      setVoiceError(cleanError(e));
      setSamplePlaying(null);
    } finally {
      setSampleLoading(null);
    }
  };
  useEffect(() => () => sampleAudio.current?.pause(), []);

  const choose = (v: VoiceOption) => api.patchEpisode(episode.id, { voice: { provider: providerId, voiceId: v.id, voiceName: v.name } });

  const preview = async () => {
    setPreviewing(true);
    const r = await api.previewVoice(episode.id, sample);
    setPreviewing(false);
    if (r.url) {
      setPreviewUrl(r.url);
      setTimeout(() => audioRef.current?.play(), 50);
    } else setVoiceError(r.error ?? 'No se pudo generar la muestra');
  };

  // "Escuchar todo": plays every line in order.
  const playAll = (i = 0) => {
    const withAudio = list.filter((l) => l.url);
    if (i >= withAudio.length) return setPlayingAll(null);
    setPlayingAll(i);
    const a = new Audio(withAudio[i].url);
    a.onended = () => playAll(i + 1);
    void a.play();
  };

  if (!list.length) {
    return <Empty icon={<Mic className="size-5" />} title="No hay frases del narrador" hint="Aprueba el guion primero: las frases salen de la locución de cada escena." />;
  }

  const SampleButton = ({ v, size = 'md' }: { v: VoiceOption; size?: 'sm' | 'md' }) =>
    v.previewUrl ? (
      <button
        onClick={(e) => {
          e.stopPropagation();
          void playSample(v);
        }}
        title="Escuchar la muestra que el proveedor ya grabó (gratis, no gasta créditos)"
        className={cx(
          'no-drag grid shrink-0 place-items-center rounded-full border transition-colors',
          size === 'sm' ? 'size-7' : 'size-8',
          samplePlaying === v.id ? 'border-brand/60 bg-brand/15 text-ink' : 'border-line-2 text-mute hover:border-brand/50 hover:text-ink',
        )}
      >
        {samplePlaying === v.id ? <Pause className="size-3.5" /> : sampleLoading === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
      </button>
    ) : null;

  // What the limit card shows, in the provider's credits.
  const hgNeed = heygenMaxCredits(hgPlan.chars);
  const need = heygen ? hgNeed : planAll.total;
  const overLimit = (paid || heygen) && (heygen ? hgPlan.fits < list.length : planAll.total > limit);
  const fitsCount = heygen ? hgPlan.fits : planAll.fits;
  const meterPct = paid || heygen ? Math.min(100, Math.round((need / Math.max(1, limit)) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* ── 1. The voice ───────────────────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <SectionTitle
          title="Voz del narrador"
          hint={
            prov?.implemented && !usable
              ? 'ElevenLabs gasta créditos: actívalo en Ajustes → Proveedores y agrega tu API key.'
              : 'La misma voz en toda la serie. Escucha las muestras (gratis) y elige con un clic.'
          }
          right={prov && billingTag(prov, !!settings?.allowPaidProviders)}
        />

        <div className="mb-4 grid grid-cols-[minmax(200px,260px)_1fr] gap-4">
          <Field label="Proveedor">
            <Select
              value={providerId}
              onChange={(v) => api.patchEpisode(episode.id, { providers: { ...episode.providers, voice: v }, voice: undefined })}
              options={providers.map((p) => ({ value: p.id, label: `${p.name}${p.implemented ? '' : ' · solo catálogo'}` }))}
            />
          </Field>
          <Field label="Voz elegida">
            <div className="flex h-[42px] items-center gap-3 rounded-xl border border-line bg-panel-2/40 px-3">
              {episode.voice ? (
                <>
                  <span className="grid size-6 place-items-center rounded-full bg-ok/15 text-ok">
                    <Check className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{episode.voice.voiceName}</span>
                  {chosen && <SampleButton v={chosen} size="sm" />}
                </>
              ) : (
                <span className="text-[13px] text-faint">Ninguna todavía: elige una en la lista.</span>
              )}
            </div>
          </Field>
        </div>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-2.5 size-4 text-faint" />
          <input className={cx(inputCls, 'pl-9')} placeholder={heygen || paid ? "Buscar por nombre, idioma, estilo o ID de voz" : "Buscar por nombre, idioma o estilo"} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {/* Language and gender combine: e.g. Español + Femeninas. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <Segmented
            label="Idioma"
            value={lang}
            onChange={setLang}
            options={[{ id: 'all', label: 'Todos' }, ...languages.slice(0, 6).map((l) => ({ id: l.code, label: `${l.label} (${l.count})` }))]}
          />
          <Segmented label="Género" value={gender} onChange={setGender} options={GENDERS} />
          <span className="ml-auto flex items-center gap-2 text-[11.5px] text-faint">
            {filtered.length} de {voices.length} voces
            {heygen && (
              <button
                className="no-drag flex items-center gap-1 rounded-md px-1.5 py-0.5 text-mute hover:bg-panel-2 hover:text-ink disabled:opacity-40"
                disabled={voicesLoading}
                title="Volver a leer el catálogo de HeyGen (gratis; tarda alrededor de un minuto)"
                onClick={() => loadVoices(true)}
              >
                <RefreshCw className={cx('size-3', voicesLoading && 'animate-spin')} /> Actualizar
              </button>
            )}
          </span>
        </div>

        {canLookup && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand/30 bg-brand/5 p-3">
            <Hash className="size-4 shrink-0 text-brand-2" />
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] text-ink">Parece un ID de voz y no está en la lista.</p>
              <p className="break-anywhere text-[11.5px] text-faint">
                {pastedId} · AdFlow la busca en {heygen ? 'HeyGen' : 'ElevenLabs'}, la agrega y la elige. No gasta créditos{heygen ? '; tarda unos segundos' : ''}.
              </p>
            </div>
            <Button icon={<Search className="size-4" />} loading={lookingUp} onClick={lookupById}>
              Buscar por ID
            </Button>
          </div>
        )}

        {voiceError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/5 p-3 text-[12.5px] text-warn">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="selectable">{voiceError}</span>
          </div>
        )}

        <div className="grid max-h-[300px] grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2 overflow-y-auto pr-1">
          {filtered.map((v) => {
            const selected = episode.voice?.voiceId === v.id;
            return (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => choose(v)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose(v)}
                className={cx(
                  'no-drag flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
                  selected ? 'border-brand/60 bg-brand/10' : 'border-line bg-panel-2/40 hover:border-line-2 hover:bg-panel-2/70',
                )}
              >
                <SampleButton v={v} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-ink" title={v.name}>
                    {v.name}
                  </p>
                  <p className="truncate text-[11px] text-faint">{[v.language, v.gender].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {selected && <Check className="size-4 shrink-0 text-brand-2" />}
              </div>
            );
          })}
          {!filtered.length && !(voiceError && !voices.length) && (
            <p className="col-span-full py-8 text-center text-[12px] text-faint">
              {voicesLoading
                ? heygen
                  ? 'Claude lee el catálogo de HeyGen con su MCP (gratis). La primera vez tarda alrededor de un minuto; después queda guardado una semana.'
                  : 'Cargando voces…'
                : voices.length ? 'Ninguna voz coincide con la búsqueda.' : voiceError ? '' : 'Este proveedor no tiene voces disponibles.'}
            </p>
          )}
        </div>
        {(paid || heygen) && voices.length > 0 && <p className="mt-2 text-[11.5px] text-faint">▶ reproduce la muestra que {heygen ? 'HeyGen' : 'ElevenLabs'} ya grabó de cada voz: no gasta créditos.</p>}
        {/* Checked Nov 2026: 6 of 13 Spanish HeyGen voices come with a generic English sample. */}
        {heygen && voices.length > 0 && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/5 p-3 text-[12px] text-warn">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              En HeyGen, la muestra ▶ de varias voces está en inglés aunque la voz sea en español: sirve solo para oír el timbre.
              Guíate por la etiqueta de idioma de cada voz (por ejemplo, <b>es</b>). La narración sale en el idioma del guion.
              Para oír de verdad cómo sonará, usa «Probar la voz con una frase del guion».
            </span>
          </div>
        )}

        {/* Hearing a real line of the script costs credits: kept apart and folded. */}
        <div className="mt-4 rounded-xl border border-line">
          <button className="no-drag flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => setTestOpen(!testOpen)}>
            <span className="flex items-center gap-2 text-[13px] text-ink">
              <Sparkles className="size-4 text-brand-2" />
              Probar la voz con una frase del guion
              {(paid || heygen) && <Tag tone="warn">{heygen ? 'gasta cuota de HeyGen' : 'gasta créditos'}</Tag>}
            </span>
            <ChevronDown className={cx('size-4 text-faint transition-transform', testOpen && 'rotate-180')} />
          </button>
          {testOpen && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-3 border-t border-line px-4 py-3">
              <Field label="Frase">
                <Select value={sample} onChange={setSample} options={list.map((l) => ({ value: l.text, label: `${l.id} · ${l.text}` }))} />
              </Field>
              <Button icon={<Play className="size-4" />} loading={previewing} disabled={!episode.voice || !usable} onClick={preview}>
                {paid ? `Probar (≈ ${fmt(lineCredits(sample))} créditos)` : heygen ? `Probar (${fmt(sample.length)} caracteres ≈ ${hgCredits(sample.length)} crédito)` : 'Probar'}
              </Button>
              {previewUrl && <audio ref={audioRef} src={previewUrl} controls className="col-span-2 h-9 w-full" />}
            </div>
          )}
        </div>
      </Card>

      {/* ── 2. Credit limit (ElevenLabs credits or HeyGen premium credits) ─────────────────── */}
      {(paid || heygen) && (
        <Card className="p-5">
          <SectionTitle
            title={heygen ? 'Límite de créditos premium (HeyGen)' : 'Límite de créditos'}
            hint={
              heygen
                ? 'HeyGen cobra 1 crédito premium cada 1,000 caracteres en un medidor acumulado, así que N caracteres pueden descontar hasta N ÷ 1,000 redondeado hacia arriba. AdFlow solo envía las frases que caben en ese peor caso: nunca pasa el límite.'
                : 'AdFlow revisa cada frase antes de enviarla: si pasaría el límite, se detiene y no la envía. Un video completo ≈ 400–600 créditos (1 por carácter).'
            }
          />
          <div className="grid grid-cols-[180px_1fr] items-center gap-5">
            <Field label="Por ejecución">
              <div className="relative">
                <Coins className="absolute left-3 top-2.5 size-4 text-faint" />
                <input
                  className={cx(inputCls, 'pl-9')}
                  inputMode="numeric"
                  value={limitDraft}
                  onChange={(e) => setLimitDraft(e.target.value)}
                  onBlur={saveLimit}
                  onKeyDown={(e) => e.key === 'Enter' && saveLimit()}
                />
              </div>
            </Field>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-[12.5px]">
                <span className="text-mute">
                  {heygen ? (
                    <>
                      Todas las frases: <span className="text-ink">{fmt(hgPlan.chars)} caracteres</span> ≈ {hgCredits(hgPlan.chars)} · como máximo{' '}
                      <span className="text-ink">{hgNeed}</span> crédito{hgNeed === 1 ? '' : 's'}
                    </>
                  ) : (
                    <>
                      Todas las frases: <span className="text-ink">≈ {fmt(planAll.total)}</span> créditos
                    </>
                  )}
                </span>
                <span className={cx(overLimit ? 'text-warn' : 'text-faint')}>{meterPct}% del límite</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                <div className={cx('h-full rounded-full transition-all', overLimit ? 'bg-warn' : 'bg-brand-2')} style={{ width: `${meterPct}%` }} />
              </div>
              <p className={cx('mt-1.5 text-[12px]', overLimit ? 'text-warn' : 'text-faint')}>
                {overLimit
                  ? `No alcanza: se generan ${fitsCount} de ${list.length} frases y se detiene antes de ${list[fitsCount]?.id ?? ''}.`
                  : heygen
                    ? `Alcanza para todas las frases. Margen: ${limit - hgNeed} crédito(s) premium.`
                    : `Alcanza para todas las frases. Quedan ≈ ${fmt(limit - planAll.total)} de margen.`}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── 3. The narration ─────────────────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <SectionTitle
          title="Narración"
          hint={
            paid
              ? 'Una toma por frase. Las que no se generan conservan su audio anterior.'
              : heygen
                ? `Todas las frases: ${fmt(planAll.total)} caracteres ≈ ${hgCredits(planAll.total)} crédito premium (HeyGen cobra 1 crédito cada 1,000 caracteres, en un medidor acumulado). Una sola llamada por frase, nunca repetida.`
                : 'Voz temporal para probar tiempos: las etiquetas de emoción solo las interpreta ElevenLabs.'
          }
          right={
            <>
              <Tag tone={generated === list.length ? 'ok' : 'default'}>
                {generated} de {list.length} frases
              </Tag>
              <Button size="sm" icon={playingAll !== null ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} disabled={!generated} onClick={() => playAll()}>
                Escuchar todo
              </Button>
            </>
          }
        />

        <div className="space-y-1.5">
          {list.map((l) => {
            const playing = playingAll !== null && list.filter((x) => x.url)[playingAll]?.id === l.id;
            return (
              <div
                key={l.id}
                className={cx(
                  'grid grid-cols-[44px_minmax(0,1fr)_minmax(180px,240px)] items-center gap-3 rounded-xl border px-3.5 py-2.5',
                  playing ? 'border-brand/50 bg-brand/5' : 'border-line bg-panel-2/30',
                )}
              >
                <span className="font-mono text-[12px] font-semibold text-mute">{l.id}</span>
                <div className="min-w-0">
                  <p className="selectable text-[13px] leading-relaxed text-ink">{l.text}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                    <span>{l.sceneId}</span>
                    {l.tone && <span className="font-mono text-[#b6a5ff]">{l.tone}</span>}
                    {paid && <span>≈ {fmt(lineCredits(l.text))} créditos</span>}
                    {heygen && <span>{fmt(l.text.length)} caracteres</span>}
                  </p>
                </div>
                {l.url ? <audio src={l.url} controls className="h-8 w-full" /> : <span className="justify-self-start"><Tag>Sin audio</Tag></span>}
              </div>
            );
          })}
        </div>

        {/* Stays at the bottom of the screen while scrolling the lines. */}
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-4 flex flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-panel/95 px-5 py-3.5 backdrop-blur">
          {generated > 0 && missingLines.length > 0 && (
            <Button
              size="sm"
              icon={<Wand2 className="size-3.5" />}
              loading={st === 'working'}
              disabled={!episode.voice || !usable}
              onClick={() => api.act(episode.id, { step: 'voice', type: 'generate', lineIds: missingLines.map((l) => l.id) })}
            >
              Generar las que faltan{paid ? ` (≈ ${fmt(planMissing.total)})` : ''}
            </Button>
          )}
          <Button
            size="sm"
            variant={generated ? 'ghost' : 'primary'}
            icon={<Wand2 className="size-3.5" />}
            loading={st === 'working'}
            disabled={!episode.voice || !usable}
            title={!episode.voice ? 'Elige una voz primero' : ''}
            onClick={() => api.act(episode.id, { step: 'voice', type: 'generate' })}
          >
            {generated ? 'Regenerar todas' : 'Generar la narración'}
            {paid ? ` (≈ ${fmt(planAll.total)})` : heygen ? ` (≈ ${hgCredits(planAll.total)} crédito)` : ''}
          </Button>
          <Button
            size="sm"
            variant={generated === list.length ? 'primary' : 'ghost'}
            icon={<ArrowRight className="size-3.5" />}
            disabled={st === 'working' || st === 'approved' || generated < list.length}
            onClick={() => api.act(episode.id, { step: 'voice', type: 'approve' })}
          >
            {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
