import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, CheckCircle2, ChevronDown, CircleAlert, CircleDashed, FolderOpen, Gauge, Info, KeyRound, Plug, Plus, RefreshCw, Stethoscope, Trash2, X } from 'lucide-react';
import { MAX_RENDERS } from '@shared/types';
import type { Capability, DiagnosticItem, PlaybookSyncStatus, ProviderInfo, Settings } from '@shared/types';
import { api } from '../lib/api';
import { Button, Card, cx, Field, inputCls, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag, planTag, providerLabel } from '../steps/PrepStep';
import { AboutTab } from './AboutTab';

type Tab = 'playbook' | 'providers' | 'queue' | 'diagnostics' | 'about';
const TABS: Tab[] = ['playbook', 'providers', 'queue', 'diagnostics', 'about'];

const CAP_LABEL: Record<Capability, string> = { brain: 'Agente', image: 'Imágenes', video: 'Videos', voice: 'Voz', music: 'Música' };

/** What each part does in an episode, shown with the ⓘ next to it. */
const CAP_INFO: Record<Capability, string> = {
  brain:
    'Es el director del episodio: escribe el guion y las escenas, redacta los prompts de imágenes, videos, voz y música, arma el proyecto de Remotion y revisa cada paso antes de pedirte aprobación. Siempre es Claude Code con tu cuenta; aquí eliges el modelo, el esfuerzo y la cuenta.',
  image:
    'Crea un cuadro realista por escena, en vertical, a partir de los prompts del agente. Esas imágenes son el fondo de las escenas y el primer fotograma de los clips de video.',
  video:
    'Convierte en clips cortos las escenas que necesitan movimiento real (el gancho y los diálogos), partiendo de la imagen de la escena. Las demás escenas se animan en Remotion, sin gastar créditos.',
  voice:
    'Graba la narración del guion con el tiempo de cada palabra. Con esos tiempos salen los subtítulos y cada escena dura lo que dura su frase.',
  music:
    'Pone la pista de fondo siguiendo la estructura del video (gancho, cambio en el «después» y cierre). AdFlow la mide y el agente cuadra los cortes y las animaciones con su ritmo.',
};

export function SettingsView() {
  // settings:<tab> in the URL hash opens that tab (used by screenshot checks).
  // The brain (Claude Code) used to have its own tab: "brain" now opens Proveedores, where it lives.
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.match(/^#settings:(\w+)/)?.[1];
    if (h === 'brain') return 'providers';
    return TABS.includes(h as Tab) ? (h as Tab) : 'playbook';
  });
  const [showAvailable, setShowAvailable] = useState(false);
  const [showBrain, setShowBrain] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const [s, setS] = useState<Settings>();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [diag, setDiag] = useState<DiagnosticItem[]>();
  const [sections, setSections] = useState<{ id: string; title: string; found: boolean }[]>([]);
  const [saved, setSaved] = useState(false);
  const [cfgOrigin, setCfgOrigin] = useState<{ origin: string; error?: string }>();
  const [teamUrl, setTeamUrl] = useState('');
  const [teamToken, setTeamToken] = useState('');
  const [teamState, setTeamState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});
  const [pbStatus, setPbStatus] = useState<PlaybookSyncStatus>();
  const [storage, setStorage] = useState('');

  /** Everything the Playbook tab shows that depends on the active playbook. */
  const refreshPlaybook = () => {
    api.playbookSections().then(setSections).catch(() => setSections([]));
    api.playbookConfigOrigin().then(setCfgOrigin);
    api.playbookStatus().then(setPbStatus);
    api.storagePath().then(setStorage);
  };
  const syncPlaybook = async () => {
    setPbStatus((x) => ({ files: 0, ...x, syncing: true, error: undefined }));
    setPbStatus(await api.playbookSync());
    refreshPlaybook();
  };

  useEffect(() => {
    api.getSettings().then((x) => {
      setS(x);
      setTeamUrl(x.team?.url ?? '');
    });
    api.providers().then(setProviders);
    api.secretStatus().then(setSecrets);
    api.secretLabels().then(setLabels);
    refreshPlaybook();
  }, []);
  useEffect(() => {
    if (tab === 'diagnostics' && !diag) api.diagnostics().then(setDiag);
  }, [tab, diag]);

  if (!s) return null;
  const save = async (next: Settings) => {
    setS(next);
    await api.saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    if (tab === 'playbook') refreshPlaybook();
  };

  const tabs: [Tab, string, typeof BookOpen][] = [
    ['playbook', 'Playbook', BookOpen],
    ['providers', 'Proveedores', Plug],
    ['queue', 'Cola y lotes', Gauge],
    ['diagnostics', 'Diagnóstico', Stethoscope],
    ['about', 'Acerca de', Info],
  ];

  return (
    <div className="flex h-[calc(100%-2.5rem)] flex-col">
      <div className="drag mx-auto w-full max-w-[1000px] shrink-0 px-8 pt-3">
      <div className="flex items-end justify-between gap-6 border-b border-line">
        <h1 className="shrink-0 pb-2.5 text-2xl font-semibold tracking-tight">Ajustes</h1>
      <nav className="flex min-w-0 gap-0.5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx(
              'no-drag -mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors',
              tab === id ? 'border-brand text-ink' : 'border-transparent text-mute hover:text-ink',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
      </div>
      </div>

      {/* Floating, so it never pushes the tabs around. */}
      <div
        role="status"
        className={cx(
          'pointer-events-none fixed bottom-5 right-6 z-30 flex items-center gap-2 rounded-lg border border-ok/30 bg-panel-2 px-3.5 py-2 text-[12.5px] font-medium text-ok shadow-lg transition-all duration-200',
          saved ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        )}
      >
        <CheckCircle2 className="size-4" />
        Cambios guardados
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1000px] space-y-5 px-8 pb-8 pt-6">
        {tab === 'playbook' && (
          <>
            <Card className="p-5">
              <SectionTitle title="Conexión con «Producción de redes»" hint="Sincroniza los episodios y el playbook con el panel de administración, y reporta el avance de cada episodio." />
              <div className="rounded-xl border border-line bg-panel-2/30 p-4">
                <p className="text-[12px] text-faint">Genera tu token en el panel de administración, en Producción de redes → Conectar AdFlow. Se almacena cifrado en esta computadora.</p>
                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                  <Field label="Dirección del panel de administración">
                    <input className={inputCls} placeholder="https://robles.ai" value={teamUrl} onChange={(e) => setTeamUrl(e.target.value)} />
                  </Field>
                  <Field label="Token personal">
                    <input className={inputCls} type="password" placeholder={secrets['team-token'] ? '•••••••• (guardado)' : 'adflow_…'} value={teamToken} onChange={(e) => setTeamToken(e.target.value)} />
                  </Field>
                  <Button
                    loading={teamState.busy}
                    disabled={!teamUrl.trim() || (!teamToken.trim() && !secrets['team-token'])}
                    onClick={async () => {
                      setTeamState({ busy: true });
                      try {
                        const me = await api.teamConnect(teamUrl, teamToken || undefined);
                        setTeamToken('');
                        setSecrets(await api.secretStatus());
                        setS(await api.getSettings());
                        setTeamState({ ok: `Conectado como ${me.name}` });
                        void syncPlaybook();
                      } catch (err) {
                        setTeamState({ error: String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
                      }
                    }}
                  >
                    Conectar
                  </Button>
                </div>
                {teamState.ok && <p className="mt-2 text-[12px] text-ok">{teamState.ok}</p>}
                {teamState.error && <p className="mt-2 text-[12px] text-bad">{teamState.error}</p>}
                {!teamState.ok && !teamState.error && s.team?.userName && <p className="mt-2 text-[12px] text-faint">Última conexión como {s.team.userName}.</p>}
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle
                title="Playbook del equipo"
                hint="Prompts maestros, configuración, plantillas y el Robly oficial. Se mantiene en el panel de administración y se sincroniza automáticamente."
                right={
                  <Button size="sm" icon={<RefreshCw className="size-4" />} loading={pbStatus?.syncing} onClick={() => void syncPlaybook()}>
                    Actualizar ahora
                  </Button>
                }
              />
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    ['Versión', pbStatus?.version ?? '—'],
                    ['Archivos', String(pbStatus?.files ?? 0)],
                    ['Actualizado', pbStatus?.syncedAt ? new Date(pbStatus.syncedAt).toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca'],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-line bg-panel-2/40 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-wide text-faint">{label}</p>
                    <p className={cx('mt-1 text-[14px] font-semibold', label === 'Versión' && 'font-mono text-[13px]')}>{value}</p>
                  </div>
                ))}
              </div>
              {pbStatus?.error && <p className="mt-3 text-[12px] text-bad">No se pudo sincronizar: {pbStatus.error}{pbStatus.version ? ' Se está usando la última copia descargada.' : ''}</p>}
              {!pbStatus?.error && pbStatus?.changed ? <p className="mt-3 text-[12px] text-ok">Última sincronización: {pbStatus.changed} archivo(s) actualizados.</p> : null}
            </Card>
            <Card className="p-5">
              <SectionTitle title="Almacenamiento de episodios" hint="Cada episodio se guarda en una carpeta con su guion, imágenes, clips y audio. Puedes ubicarla en otro disco si necesitas más espacio." />
              <div className="flex items-center gap-2">
                <input className={cx(inputCls, 'font-mono text-[12px]')} value={storage} readOnly />
                <Button icon={<FolderOpen className="size-4" />} onClick={() => api.openPath(storage)}>
                  Abrir
                </Button>
                <Button
                  onClick={async () => {
                    const d = await api.pickFolder();
                    if (d) await save({ ...s, storageDir: d });
                    api.storagePath().then(setStorage);
                  }}
                >
                  Cambiar
                </Button>
                {s.storageDir && (
                  <Button variant="ghost" onClick={async () => { await save({ ...s, storageDir: '' }); api.storagePath().then(setStorage); }}>
                    Restablecer ubicación
                  </Button>
                )}
              </div>
              <p className="mt-2 text-[11.5px] text-faint">El cambio solo afecta a los episodios nuevos. El guion aprobado también se guarda en el panel de administración.</p>
            </Card>
            <Card className="p-5">
              <SectionTitle
                title="Secciones del prompt maestro"
                hint="Cada paso recibe solo las secciones que necesita, además de las reglas generales."
                right={
                  cfgOrigin && (
                    <Tag tone={cfgOrigin.origin === 'playbook' ? 'ok' : cfgOrigin.origin === 'preset' ? 'warn' : 'bad'}>
                      {cfgOrigin.origin === 'playbook' ? 'Playbook del equipo' : cfgOrigin.origin === 'preset' ? 'Configuración predeterminada' : 'Sin configuración'}
                    </Tag>
                  )
                }
              />
              {cfgOrigin?.error && <p className="mb-3 text-[11.5px] text-bad">{cfgOrigin.error}</p>}
              <div className="grid grid-cols-3 gap-1.5">
                {sections.map((sec) => (
                  <div key={sec.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/30 px-2.5 py-1.5 text-[12px]">
                    {sec.found ? <CheckCircle2 className="size-3.5 text-ok" /> : <CircleAlert className="size-3.5 text-bad" />}
                    <span className="font-mono text-mute">§{sec.id}</span>
                    <span className="truncate text-faint">{sec.title || (sec.found ? '' : 'no encontrada')}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {tab === 'providers' && (
          <>
            <Card className="p-5">
              <SectionTitle
                title="Proveedores por defecto"
                hint="Se aplican a los episodios nuevos. Puedes cambiarlos en la Preparación de cada episodio."
                right={
                  <label className="no-drag flex items-center gap-2 text-[12.5px] text-mute">
                    <input type="checkbox" className="size-4 accent-[#7c5cff]" checked={s.allowPaidProviders} onChange={(e) => save({ ...s, allowPaidProviders: e.target.checked })} />
                    Permitir proveedores que consumen créditos
                  </label>
                }
              />
              <div className="space-y-2">
                {(Object.keys(CAP_LABEL) as Capability[]).map((cap) => (
                  <div key={cap} className="grid grid-cols-[140px_1fr] items-start gap-4">
                    <div className="flex items-center gap-1.5 pt-2">
                      <span className="group relative no-drag">
                        <Info className="size-3.5 cursor-help text-faint group-hover:text-ink" aria-label={`Para qué sirve: ${CAP_LABEL[cap]}`} tabIndex={0} />
                        <span
                          role="tooltip"
                          className="pointer-events-none invisible absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-line-2 bg-[#0a0c11] px-3 py-2 text-[11.5px] font-normal leading-relaxed text-mute opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
                        >
                          {CAP_INFO[cap]}
                          {(() => {
                            const current = providers.find((p) => p.id === s.defaults[cap]);
                            return current ? (
                              <span className="mt-1.5 block text-faint">
                                <span className="font-medium text-mute">{current.name}:</span> {current.description}
                              </span>
                            ) : null;
                          })()}
                        </span>
                      </span>
                      <span className="text-[13px] font-medium">{CAP_LABEL[cap]}</span>
                    </div>
                    <div>
                      <div className="flex items-stretch gap-2">
                        <div className="min-w-0 flex-1">
                          <Select
                            value={s.defaults[cap]}
                            onChange={(v) => save({ ...s, defaults: { ...s.defaults, [cap]: v } })}
                            options={providers.filter((p) => p.capability === cap).map((p) => ({ value: p.id, label: providerLabel(p), disabled: !p.implemented }))}
                          />
                        </div>
                        {cap === 'brain' && (
                          <button
                            className="no-drag grid w-10 shrink-0 place-items-center rounded-lg border border-line-2 bg-[#0a0c11] text-mute hover:text-ink"
                            onClick={() => setShowBrain((x) => !x)}
                            aria-expanded={showBrain}
                            aria-label={showBrain ? 'Ocultar opciones del agente' : 'Mostrar opciones del agente'}
                            title="Modelo, esfuerzo y cuenta"
                          >
                            <ChevronDown className={cx('size-4 transition-transform', showBrain && 'rotate-180')} />
                          </button>
                        )}
                      </div>
                      {cap === 'brain' && showBrain && (
                        // The brain is Claude Code: its model, effort and account sit right under it.
                        <div className="mt-2 grid grid-cols-[1fr_1fr_1.4fr] items-end gap-3 rounded-xl border border-line bg-panel-2/30 px-3 py-2.5">
                          <Field label="Modelo">
                            <Select value={s.claude.model} onChange={(v) => save({ ...s, claude: { ...s.claude, model: v } })} options={[{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }]} />
                          </Field>
                          <Field label="Esfuerzo">
                            <Select
                              value={s.claude.effort}
                              onChange={(v) => save({ ...s, claude: { ...s.claude, effort: v as Settings['claude']['effort'] } })}
                              options={[{ value: 'low', label: 'Bajo' }, { value: 'medium', label: 'Medio' }, { value: 'high', label: 'Alto' }]}
                            />
                          </Field>
                          <Field label="Cuenta">
                            <div className="flex items-center gap-2">
                              <div className="min-w-0 flex-1">
                                <Select
                                  value={s.claude.defaultAccount}
                                  onChange={(v) => save({ ...s, claude: { ...s.claude, defaultAccount: v } })}
                                  options={s.claude.accounts.map((a) => ({ value: a.id, label: a.label }))}
                                />
                              </div>
                              <Button size="sm" variant="ghost" onClick={() => setShowAccounts(true)}>
                                Gestionar
                              </Button>
                            </div>
                          </Field>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">AdFlow usa Claude Code instalado en esta computadora con tu suscripción. Para mostrar tu uso, consulta a Anthropic con la sesión que Claude Code ya guardó; no la copia ni la envía a otro lugar.</p>
            </Card>
            <Card className="p-5">
              <button className="no-drag flex w-full items-center justify-between gap-3 text-left" onClick={() => setShowAvailable((x) => !x)} aria-expanded={showAvailable}>
                <div>
                  <p className="text-[14px] font-semibold">Proveedores disponibles</p>
                  <p className="mt-0.5 text-[12px] text-faint">{providers.length} proveedores. Ningún proveedor consume créditos sin tu confirmación.</p>
                </div>
                <ChevronDown className={cx('size-4 shrink-0 text-mute transition-transform', showAvailable && 'rotate-180')} />
              </button>
              {showAvailable && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {providers.map((p) => (
                    <div key={p.id} className="rounded-xl border border-line bg-panel-2/30 px-3.5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[13px] font-semibold">{p.name}</p>
                        <div className="flex gap-1">
                          <Tag>{CAP_LABEL[p.capability]}</Tag>
                          {planTag(p)}
                          {billingTag(p, s.allowPaidProviders)}
                        </div>
                      </div>
                      <p className="mt-1 text-[11.5px] text-faint">{p.description}</p>
                      {!p.implemented && <p className="mt-1.5 text-[11px] text-mute">Próximamente</p>}
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card className="p-5">
              <SectionTitle title="Claves de API" hint="Se almacenan cifradas con el almacén de credenciales del sistema." />
              <div className="space-y-2">
                {Object.entries(labels).map(([k, label]) => (
                  <SecretRow key={k} name={k} label={label} isSet={!!secrets[k]} onSaved={setSecrets} />
                ))}
              </div>
            </Card>
            {showAccounts && <AccountsModal s={s} save={save} onClose={() => setShowAccounts(false)} />}
          </>
        )}

        {tab === 'queue' && (
          <Card className="p-5">
            <SectionTitle
              title="Procesamiento simultáneo"
              hint="Cuántos episodios se procesan a la vez y cuántos elementos de cada paso (imágenes, clips o frases de voz) se generan en paralelo dentro de cada episodio."
            />
            <div className="mb-5 max-w-[260px]">
              <Field label="Episodios simultáneos" hint="Los episodios pendientes de aprobación no cuentan.">
                <Select
                  value={String(s.concurrency.episodes)}
                  onChange={(v) => save({ ...s, concurrency: { ...s.concurrency, episodes: Number(v) } })}
                  options={[...[1, 2, 3, 4, 5, 6, 8, 10].map((n) => ({ value: String(n), label: String(n) })), { value: '0', label: 'Sin límite' }]}
                />
              </Field>
            </div>
            <div className="grid grid-cols-5 gap-4">
              <Field label="Guion" hint="1 por episodio">
                <Select value="1" onChange={() => {}} options={[{ value: '1', label: '1' }]} disabled />
              </Field>
              {(
                [
                  ['image', 'Imágenes', 'Por episodio'],
                  ['clip', 'Clips de video', 'Por episodio'],
                  ['voice', 'Voces (frases)', 'Por episodio'],
                ] as const
              ).map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint}>
                  <Select
                    value={String(s.concurrency[k])}
                    onChange={(v) => save({ ...s, concurrency: { ...s.concurrency, [k]: Number(v) } })}
                    options={[...[1, 2, 3, 4, 6, 8, 10].map((n) => ({ value: String(n), label: String(n) })), { value: '0', label: 'Sin límite' }]}
                  />
                </Field>
              ))}
              <Field label="Render" hint="En total, en esta computadora">
                <Select
                  value={String(s.concurrency.render)}
                  onChange={(v) => save({ ...s, concurrency: { ...s.concurrency, render: Number(v) } })}
                  options={Array.from({ length: MAX_RENDERS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                />
              </Field>
            </div>
            <p className="mt-3 text-[12px] text-faint">
              Cada render usa parte de la CPU. Aumentar este valor solo se recomienda con 8 núcleos o más y 32 GB de RAM; en equipos con menos recursos
              no reduce el tiempo total. Con voces de HeyGen, todas las frases del episodio se generan en una sola sesión. Generar más elementos en paralelo
              no aumenta el costo, pero alcanza antes los límites de uso de Codex, ElevenLabs o Claude.
            </p>
            <div className="mt-6 max-w-[420px]">
              <Field label="Tu nombre" hint="Se muestra al equipo en el seguimiento de episodios.">
                <input className={inputCls} value={s.userName} onChange={(e) => save({ ...s, userName: e.target.value })} />
              </Field>
            </div>
          </Card>
        )}

        {tab === 'diagnostics' && (
          <Card className="p-5">
            <SectionTitle
              title="Diagnóstico del sistema"
              hint="Comprueba que las herramientas necesarias estén instaladas. No consume créditos."
              right={
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => { setDiag(undefined); api.diagnostics().then(setDiag); }}>
                  Volver a comprobar
                </Button>
              }
            />
            <div className="space-y-2">
              {!diag && [0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-14 rounded-xl" />)}
              {diag?.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-panel-2/30 px-4 py-3">
                  {d.ok ? <CheckCircle2 className="size-5 text-ok" /> : d.required ? <CircleAlert className="size-5 text-bad" /> : <CircleDashed className="size-5 text-warn" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">
                      {d.label} {d.required && !d.ok && <span className="text-[11px] font-normal text-bad">· requerido</span>}
                    </p>
                    <p className="selectable truncate text-[12px] text-faint">{d.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === 'about' && <AboutTab settings={s} save={save} />}
      </div>
      </div>
    </div>
  );
}

/** Adding, renaming and removing Claude accounts: rarely touched, so it lives behind "Gestionar". */
function AccountsModal({ s, save, onClose }: { s: Settings; save: (next: Settings) => Promise<void>; onClose: () => void }) {
  const setAccounts = (accounts: Settings['claude']['accounts']) => save({ ...s, claude: { ...s.claude, accounts } });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="no-drag fixed inset-0 z-50 grid place-items-center bg-black/70 p-8 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[720px] rounded-2xl border border-line-2 bg-panel p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[15px] font-semibold">Cuentas de Claude</p>
            <p className="mt-0.5 text-[12px] text-faint">La cuenta por defecto se elige en Proveedores → Agente.</p>
          </div>
          <button className="text-faint hover:text-ink" onClick={onClose} aria-label="Cerrar">
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-2">
          {s.claude.accounts.map((a) => (
            <div key={a.id} className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 rounded-xl border border-line bg-panel-2/30 px-3 py-2.5">
              <input className={inputCls} value={a.label} onChange={(e) => setAccounts(s.claude.accounts.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)))} />
              <input
                className={cx(inputCls, 'font-mono text-[12px]')}
                placeholder={a.id === 'system' ? 'Sesión del sistema' : 'C:\\Users\\tu-usuario\\.claude-work'}
                value={a.configDir ?? ''}
                disabled={a.id === 'system'}
                onChange={(e) => setAccounts(s.claude.accounts.map((x) => (x.id === a.id ? { ...x, configDir: e.target.value } : x)))}
              />
              {/* The default account can't be removed: pick another one first. */}
              {a.id !== s.claude.defaultAccount ? (
                <button className="text-faint hover:text-bad" onClick={() => setAccounts(s.claude.accounts.filter((x) => x.id !== a.id))} aria-label="Quitar">
                  <Trash2 className="size-4" />
                </button>
              ) : (
                <span className="w-4" />
              )}
            </div>
          ))}
        </div>
        <Button
          className="mt-3"
          size="sm"
          icon={<Plus className="size-3.5" />}
          onClick={() => setAccounts([...s.claude.accounts, { id: `acc-${Date.now()}`, label: `Claude ${s.claude.accounts.length + 1}`, configDir: '' }])}
        >
          Agregar cuenta
        </Button>
        <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
          Cada cuenta usa su propia carpeta de configuración de Claude Code (CLAUDE_CONFIG_DIR). Para iniciar sesión, define esa variable en una terminal y ejecuta <span className="font-mono">claude</span> una vez. «Claude del sistema» usa la sesión que tenga <span className="font-mono">claude</span> sin esa variable; puedes quitarla si eliges otra cuenta por defecto.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function SecretRow({ name, label, isSet, onSaved }: { name: string; label: string; isSet: boolean; onSaved: (s: Record<string, boolean>) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="grid grid-cols-[200px_1fr_auto] items-center gap-3">
      <span className="flex items-center gap-2 text-[13px]">
        <KeyRound className="size-3.5 text-faint" />
        {label}
      </span>
      <input className={inputCls} type="password" placeholder={isSet ? '•••••••• (guardada)' : 'Pegar clave'} value={value} onChange={(e) => setValue(e.target.value)} />
      <div className="flex gap-1.5">
        <Button size="sm" disabled={!value} onClick={async () => { onSaved(await api.setSecret(name, value)); setValue(''); }}>
          Guardar
        </Button>
        {isSet && (
          <Button size="sm" variant="ghost" onClick={async () => onSaved(await api.setSecret(name, ''))}>
            Quitar
          </Button>
        )}
      </div>
    </div>
  );
}
