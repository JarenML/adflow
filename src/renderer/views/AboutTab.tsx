// Ajustes → Acerca de: which version is running, its updates, and the technical details useful for support.
import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, ExternalLink, FileText, FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import type { AppInfo, UpdateState } from '@shared/api';
import type { Settings } from '@shared/types';
import { api, useQueue } from '../lib/api';
import { Button, Card, cx, formatDate, Logo, SectionTitle, Tag } from '../components/ui';

/** One line on where the updates stand. */
function updateLine(u: UpdateState, auto: boolean): { tone: 'ok' | 'bad' | 'mute' | 'brand'; text: string } {
  switch (u.status) {
    case 'dev':
      return { tone: 'mute', text: 'No disponibles en la versión de desarrollo.' };
    case 'checking':
      return { tone: 'mute', text: 'Buscando actualizaciones…' };
    case 'latest':
      return { tone: 'ok', text: `AdFlow está actualizado.${u.checkedAt ? ` Última comprobación: ${formatDate(u.checkedAt)}` : ''}` };
    case 'available':
      return { tone: 'brand', text: `Versión ${u.newVersion ?? ''} disponible.` };
    case 'downloading':
      return { tone: 'brand', text: `Descargando la versión ${u.newVersion ?? ''}… ${u.progress ?? 0} %` };
    case 'ready':
      return { tone: 'brand', text: `Versión ${u.readyVersion} lista. Se instalará al cerrar AdFlow.` };
    case 'error':
      return { tone: 'bad', text: 'No se pudo comprobar si hay actualizaciones.' };
    default:
      return { tone: 'mute', text: auto ? 'Se comprueban automáticamente.' : 'Las actualizaciones automáticas están desactivadas.' };
  }
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx('no-drag relative h-6 w-11 shrink-0 rounded-full border transition-colors', on ? 'border-brand bg-brand' : 'border-line-2 bg-panel-2')}
    >
      <span className={cx('absolute top-0.5 size-[18px] rounded-full bg-white shadow transition-[left]', on ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

/** settings and save come from SettingsView, so every tab edits the same copy. */
export function AboutTab({ settings, save }: { settings: Settings; save: (s: Settings) => Promise<void> }) {
  const [info, setInfo] = useState<AppInfo>();
  const q = useQueue();
  const running = q ? Object.values(q.lanes).reduce((a, l) => a + l.running, 0) : 0;

  useEffect(() => {
    api.appInfo().then(setInfo);
    return api.on('update', (u) => setInfo((a) => a && { ...a, ...u }));
  }, []);
  if (!info) return null;

  const merge = (u: UpdateState) => setInfo((a) => a && { ...a, ...u });
  const setAuto = (on: boolean) => save({ ...settings, autoUpdate: on });
  const line = updateLine(info, settings.autoUpdate);
  // In dev, package.json only holds major.minor; the patch comes from the release workflow.
  const shown = info.packaged ? info.version : info.version.split('.').slice(0, 2).join('.');
  const sep = info.platform.startsWith('win') ? '\\' : '/';

  return (
    <>
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Logo size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[18px] font-semibold tracking-tight">
                Ad<span className="brand-text">Flow</span>
              </p>
              <span className="text-[13px] text-mute">Versión {shown}</span>
              <Tag tone={info.packaged ? 'ok' : 'warn'}>{info.packaged ? 'Instalada' : 'Desarrollo'}</Tag>
            </div>
            <p className="mt-0.5 text-[12.5px] text-faint">Producción de videos para redes sociales.</p>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-line bg-panel-2/30 p-4">
          <div className="flex items-center gap-3">
            {line.tone === 'ok' && <CheckCircle2 className="size-5 shrink-0 text-ok" />}
            {line.tone === 'bad' && <CircleAlert className="size-5 shrink-0 text-bad" />}
            {line.tone === 'brand' && <Download className="size-5 shrink-0 text-brand-2" />}
            {line.tone === 'mute' && <RefreshCw className={cx('size-5 shrink-0 text-faint', info.status === 'checking' && 'animate-spin')} />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">Actualizaciones</p>
              <p className={cx('truncate text-[12px]', line.tone === 'bad' ? 'text-bad' : 'text-faint')} title={line.text}>
                {line.text}
              </p>
            </div>
            {info.status === 'ready' ? (
              <Button variant="primary" size="sm" icon={<RotateCcw className="size-3.5" />} disabled={running > 0} title={running ? 'Espera a que terminen las tareas en curso' : undefined} onClick={() => api.restartToUpdate()}>
                Reiniciar e instalar
              </Button>
            ) : (
              <div className="flex gap-2">
                {info.status === 'available' && (
                  <Button variant="primary" size="sm" icon={<Download className="size-3.5" />} onClick={async () => merge(await api.downloadUpdate())}>
                    Descargar
                  </Button>
                )}
                <Button
                  size="sm"
                  icon={<RefreshCw className="size-3.5" />}
                  loading={info.status === 'checking'}
                  disabled={!info.packaged || info.status === 'downloading'}
                  title={info.packaged ? undefined : 'Disponible solo en la versión instalada'}
                  onClick={async () => merge(await api.checkForUpdates())}
                >
                  Buscar actualizaciones
                </Button>
              </div>
            )}
          </div>
          {info.status === 'downloading' && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="brand-gradient h-full transition-[width]" style={{ width: `${info.progress ?? 0}%` }} />
            </div>
          )}
          {info.status === 'ready' && running > 0 && <p className="mt-2 text-[11.5px] text-faint">Hay {running} tarea(s) en curso. Podrás instalar la actualización cuando terminen, o se instalará al cerrar AdFlow.</p>}
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Actualizar automáticamente</p>
              <p className="text-[12px] text-faint">
                {settings.autoUpdate
                  ? 'Descarga las actualizaciones en segundo plano y las instala al cerrar AdFlow.'
                  : 'Las actualizaciones se buscan y descargan manualmente.'}
              </p>
            </div>
            <Switch on={settings.autoUpdate} onChange={setAuto} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={<ExternalLink className="size-3.5" />} onClick={() => api.openPath(info.releasesUrl)}>
            Ver todas las versiones
          </Button>
          {info.packaged && (
            <Button size="sm" variant="ghost" icon={<FileText className="size-3.5" />} onClick={() => api.openPath(`${info.dataDir}${sep}updater.log`)}>
              Registro de actualizaciones
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle title="Información del sistema" />
        <div className="grid grid-cols-4 gap-3">
          {(
            [
              ['Electron', info.electron],
              ['Chromium', info.chrome],
              ['Node', info.node],
              ['Sistema', info.platform],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-line bg-panel-2/40 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
              <p className="selectable mt-1 truncate font-mono text-[13px] font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <p className="mb-1.5 mt-5 text-[12px] font-medium text-mute">Carpeta de datos</p>
        <div className="flex items-center gap-2">
          <p className="selectable min-w-0 flex-1 truncate rounded-lg border border-line bg-panel-2/30 px-3 py-2 font-mono text-[12px] text-mute" title={info.dataDir}>
            {info.dataDir}
          </p>
          <Button icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(info.dataDir)}>
            Abrir
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] text-faint">Configuración, registros y archivos temporales de AdFlow.</p>
      </Card>
    </>
  );
}
