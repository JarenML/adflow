// Publication: the final video, the ad text and link Claude writes, and where it was published.
// Marking it published moves the episode to «Publicado» for the whole team.
import { useEffect, useMemo, useState } from 'react';
import { Check, CloudUpload, Copy, ExternalLink, FolderOpen, Megaphone, RotateCcw, Send, Wand2 } from 'lucide-react';
import type { EpisodeState } from '@shared/types';
import { uploadedAs, type FinalVideoUploads } from '@shared/finalVideo';
import { api, useLive } from '../lib/api';
import { Button, Card, cx, Empty, Field, inputCls, SectionTitle, Select, TeamStatusPill } from '../components/ui';
import { toTeamStatus } from '@shared/progress';

const NETWORKS = ['Meta Ads', 'Instagram', 'Facebook', 'TikTok', 'YouTube Shorts', 'LinkedIn'];

/** Splits anuncio.md into its "# Section" blocks. */
function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  let key = '';
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^#\s+(.+)$/.exec(line);
    if (h) {
      key = h[1].trim().toLowerCase();
      out[key] = '';
    } else if (key) out[key] += `${line}\n`;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

function CopyBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <div className="rounded-xl border border-line bg-panel-2/40 p-3.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</span>
        <button
          className="no-drag flex items-center gap-1 text-[11px] text-mute hover:text-ink"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          }}
        >
          {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {done ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p className={cx('selectable whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink', mono && 'break-all font-mono text-[12px]')}>{value}</p>
    </div>
  );
}

const shortDate = (iso: string) => new Date(iso).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mb = (bytes: number) => `${(bytes / 1024 ** 2).toFixed(1)} MB`;

/**
 * «Subir video final»: sends the newest render to the team admin, which keeps every version. Separate
 * from approving the render. If it fails, the message shows under the button and it can be retried.
 */
function UploadFinalVideo({ episode, video }: { episode: EpisodeState; video: { file: string; size: number } | null | undefined }) {
  const [info, reload] = useLive<FinalVideoUploads>(() => api.finalVideoUploads(episode.id), [episode.id], episode.id);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  useEffect(
    () =>
      api.on('videoUpload', (p) => {
        if (p.episodeId === episode.id) setProgress({ sent: p.sent, total: p.total });
      }),
    [episode.id],
  );

  if (!info?.team) return null;
  const uploading = progress !== null;
  const latest = info.videos.find((v) => v.isCurrent) ?? info.videos[0];
  // The same render (name and size) already went up: say so, but still allow uploading it again.
  const same = video ? uploadedAs(video, info.videos) : null;

  const upload = async () => {
    setError(null);
    setDone(null);
    setProgress({ sent: 0, total: 0 });
    try {
      const v = await api.uploadFinalVideo(episode.id);
      setDone(v.version);
      reload();
    } catch (err) {
      // Electron wraps the message: «Error invoking remote method 'adflow:…': Error: <message>».
      setError(String((err as Error).message ?? err).replace(/^.*?Error: /, ''));
    } finally {
      setProgress(null);
    }
  };

  const pct = progress && progress.total ? Math.round((progress.sent / progress.total) * 100) : 0;
  return (
    <div className="space-y-2 border-t border-line p-3">
      <Button
        size="sm"
        variant="primary"
        className="w-full justify-center"
        icon={<CloudUpload className="size-3.5" />}
        disabled={!video || uploading}
        onClick={() => void upload()}
      >
        {uploading ? `Subiendo… ${pct} %` : 'Subir video final'}
      </Button>
      {uploading && (
        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      )}
      {error && <p className="text-[11.5px] leading-snug text-bad" role="alert">No se pudo subir el video final: {error}</p>}
      {!error && done !== null && <p className="text-[11.5px] text-ok">Video final subido como versión {done}.</p>}
      {!error && done === null && !uploading && (
        <p className="text-[11.5px] leading-snug text-faint">
          {info.error
            ? `No se pudo consultar el panel de administración: ${info.error}`
            : !info.storage
              ? 'El panel de administración todavía no tiene configurado el almacenamiento de videos.'
              : same
                ? `Este render ya se subió como versión ${same.version}.`
                : latest
                  ? `Última versión subida: v${latest.version} · ${shortDate(latest.createdAt)} · ${mb(latest.size)}`
                  : 'Aún no se subió ningún video final de este episodio.'}
        </p>
      )}
    </div>
  );
}

export function PublishStep({ episode }: { episode: EpisodeState }) {
  const [copy] = useLive(() => api.adCopy(episode.id), [episode.id], episode.id);
  const [video] = useLive(() => api.finalVideo(episode.id), [episode.id], episode.id);
  const ad = useMemo(() => sections(copy ?? ''), [copy]);
  const st = episode.steps.publish.status;
  const pub = episode.publication;
  const [network, setNetwork] = useState(NETWORKS[0]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (pub) {
      setNetwork(pub.network);
      setDate(pub.date);
      setUrl(pub.url ?? '');
    }
  }, [pub]);

  const markPublished = () =>
    api.act(episode.id, { step: 'publish', type: 'markPublished', publication: { network, date, url: url.trim() || undefined, utmContent: ad['utm_content'] || undefined } });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-2xl border border-line bg-panel px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="text-[12.5px] text-mute">Estado del equipo</span>
          <TeamStatusPill progress={toTeamStatus(episode)} />
        </div>
        {pub && (
          <span className="text-[12px] text-faint">
            {pub.network} · {pub.date}
            {pub.by ? ` · ${pub.by}` : ''}
          </span>
        )}
      </div>

      <div className="grid grid-cols-[minmax(220px,300px)_minmax(0,1fr)] gap-5">
        <Card className="overflow-hidden">
          <div className="relative aspect-[9/16] bg-[#0a0c11]">
            {video ? (
              <video src={video.url} className="absolute inset-0 size-full object-cover" controls />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center text-[12px] text-faint">
                Aún no hay video final (.mp4) en la carpeta del episodio.
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="truncate text-[11.5px] text-faint">{video?.file ?? 'Sin render'}</span>
            <Button size="sm" variant="ghost" icon={<FolderOpen className="size-3.5" />} onClick={() => api.openPath(episode.dir)}>
              Carpeta
            </Button>
          </div>
          <UploadFinalVideo episode={episode} video={video} />
        </Card>

        <div className="min-w-0 space-y-5">
          {!copy ? (
            st === 'working' ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="shimmer h-20 rounded-xl" />
                ))}
              </div>
            ) : (
              <Empty
                icon={<Megaphone className="size-5" />}
                title="Claude redacta el texto del anuncio y genera el enlace"
                hint="Incluye la frase y las etiquetas del caso, y el enlace con su parámetro de seguimiento."
                action={
                  <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={() => api.act(episode.id, { step: 'publish', type: 'adCopy' })}>
                    Escribir texto del anuncio
                  </Button>
                }
              />
            )
          ) : (
            <Card className="p-5">
              <SectionTitle
                title="Texto del anuncio"
                hint="Solicita cambios en el chat lateral."
                right={
                  <Button size="sm" icon={<RotateCcw className="size-3.5" />} disabled={st === 'working'} onClick={() => api.act(episode.id, { step: 'publish', type: 'adCopy' })}>
                    Otra versión
                  </Button>
                }
              />
              <div className="space-y-2.5">
                <CopyBox label="Texto" value={ad['texto del anuncio'] ?? ''} />
                <CopyBox label="Titular" value={ad['titular'] ?? ''} />
                <CopyBox label="Enlace" value={ad['enlace'] ?? ''} mono />
                <CopyBox label="Hashtags" value={ad['hashtags'] ?? ''} />
              </div>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle title="Dónde se publicó" hint="Al marcarlo, el episodio aparecerá como «Publicado» para todo el equipo." />
            <div className="grid grid-cols-[1fr_160px] gap-4">
              <Field label="Red">
                <Select value={network} onChange={setNetwork} options={NETWORKS.map((n) => ({ value: n, label: n }))} />
              </Field>
              <Field label="Fecha">
                <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Enlace del post o del anuncio (opcional)">
                <input className={inputCls} placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
              </Field>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              {pub?.url && (
                <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openPath(pub.url!)}>
                  Ver publicación
                </Button>
              )}
              {pub ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => api.act(episode.id, { step: 'publish', type: 'unpublish' })}>
                    Quitar publicado
                  </Button>
                  <Button size="sm" icon={<Check className="size-3.5" />} onClick={markPublished}>
                    Guardar cambios
                  </Button>
                </>
              ) : (
                <Button variant="primary" icon={<Send className="size-4" />} disabled={!date} onClick={markPublished}>
                  Marcar como publicado
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
