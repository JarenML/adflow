import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CircleAlert, Mic, Pause, Play, Search, Wand2 } from 'lucide-react';
import type { EpisodeState, ProviderInfo, Settings, VoiceOption } from '@shared/types';
import { api, useLive } from '../lib/api';
import { Button, Card, cx, Empty, Field, inputCls, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag } from './PrepStep';

export function VoiceStep({ episode }: { episode: EpisodeState }) {
  const [lines] = useLive(() => api.narration(episode.id), [episode.id], episode.id);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [settings, setSettings] = useState<Settings>();
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceError, setVoiceError] = useState('');
  const [query, setQuery] = useState('');
  const [sample, setSample] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [estimate, setEstimate] = useState('');
  const [playingAll, setPlayingAll] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const providerId = episode.voice?.provider ?? episode.providers.voice;
  const prov = providers.find((p) => p.id === providerId);
  const st = episode.steps.voice.status;
  const list = lines ?? [];

  useEffect(() => {
    api.providers().then((p) => setProviders(p.filter((x) => x.capability === 'voice')));
    api.getSettings().then(setSettings);
  }, []);
  useEffect(() => {
    setVoices([]);
    setVoiceError('');
    api.voices(providerId).then(setVoices).catch((e) => setVoiceError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  }, [providerId]);
  useEffect(() => {
    if (!sample && list[0]) setSample(list[0].text);
    api.estimate(providerId, list.length).then(setEstimate);
  }, [list.length, providerId]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return voices.filter((v) => !q || `${v.name} ${v.language} ${v.gender ?? ''}`.toLowerCase().includes(q)).slice(0, 80);
  }, [voices, query]);

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

  const generated = list.filter((l) => l.url).length;
  return (
    <div className="space-y-5">
      <Card className="p-5">
        <SectionTitle title="Voz del narrador" hint="La misma voz en toda la serie. Prueba con una frase real del guion antes de generar." right={prov && billingTag(prov, !!settings?.allowPaidProviders)} />
        <div className="grid grid-cols-[260px_1fr] gap-5">
          <div className="space-y-4">
            <Field label="Proveedor">
              <Select
                value={providerId}
                onChange={(v) => api.patchEpisode(episode.id, { providers: { ...episode.providers, voice: v }, voice: undefined })}
                options={providers.map((p) => ({ value: p.id, label: `${p.name}${p.implemented ? '' : ' · solo catálogo'}` }))}
              />
            </Field>
            <Field label="Frase de prueba">
              <Select value={sample} onChange={setSample} options={list.map((l) => ({ value: l.text, label: `${l.id} · ${l.text.slice(0, 48)}…` }))} />
            </Field>
            <Button className="w-full" icon={<Play className="size-4" />} loading={previewing} disabled={!episode.voice || !prov?.implemented} onClick={preview}>
              Probar la voz
            </Button>
            {previewUrl && <audio ref={audioRef} src={previewUrl} controls className="h-9 w-full" />}
            {episode.voice && (
              <p className="text-[12px] text-mute">
                Elegida: <span className="text-ink">{episode.voice.voiceName}</span>
              </p>
            )}
          </div>
          <div>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-2.5 size-4 text-faint" />
              <input className={cx(inputCls, 'pl-9')} placeholder="Buscar voz, idioma o género" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {voiceError ? (
              <div className="flex items-start gap-2 rounded-xl border border-warn/25 bg-warn/5 p-3 text-[12.5px] text-warn">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {voiceError}
              </div>
            ) : (
              <div className="grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
                {filtered.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => choose(v)}
                    className={cx(
                      'no-drag rounded-lg border px-3 py-2 text-left transition-colors',
                      episode.voice?.voiceId === v.id ? 'border-brand/60 bg-brand/10' : 'border-line bg-panel-2/40 hover:border-line-2',
                    )}
                  >
                    <p className="text-[12.5px] font-medium">{v.name}</p>
                    <p className="text-[11px] text-faint">
                      {[v.language, v.gender].filter(Boolean).join(' · ')}
                    </p>
                  </button>
                ))}
                {!filtered.length && <p className="col-span-2 py-6 text-center text-[12px] text-faint">Cargando voces…</p>}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle
          title={`Narración · ${generated} de ${list.length} frases`}
          hint={`Estimado: ${estimate}. Las etiquetas de emoción solo las interpreta ElevenLabs o HeyGen; las voces gratuitas sirven como voz temporal.`}
          right={
            <div className="flex gap-2">
              <Button size="sm" icon={playingAll !== null ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} disabled={!generated} onClick={() => playAll()}>
                Escuchar todo
              </Button>
              <Button size="sm" icon={<Wand2 className="size-3.5" />} loading={st === 'working'} disabled={!episode.voice || !prov?.implemented} onClick={() => api.act(episode.id, { step: 'voice', type: 'generate' })}>
                Generar voz del narrador
              </Button>
              <Button size="sm" variant="primary" icon={<ArrowRight className="size-3.5" />} disabled={st === 'working' || st === 'approved' || generated < list.length} onClick={() => api.act(episode.id, { step: 'voice', type: 'approve' })}>
                {st === 'approved' ? 'Aprobado' : 'Aprobar y seguir'}
              </Button>
            </div>
          }
        />
        <div className="space-y-1.5">
          {list.map((l, i) => (
            <div key={l.id} className={cx('grid grid-cols-[52px_1fr_240px] items-center gap-3 rounded-xl border px-3.5 py-2.5', playingAll === i ? 'border-brand/50 bg-brand/5' : 'border-line bg-panel-2/30')}>
              <span className="font-mono text-[12px] font-semibold text-mute">{l.id}</span>
              <p className="selectable text-[13px]">
                {l.tone && <span className="mr-1.5 font-mono text-[11px] text-[#b6a5ff]">{l.tone}</span>}
                {l.text}
                <span className="ml-2 text-[11px] text-faint">{l.sceneId}</span>
              </p>
              {l.url ? <audio src={l.url} controls className="h-8 w-full" /> : <Tag>Sin audio</Tag>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
