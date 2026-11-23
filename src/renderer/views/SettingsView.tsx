import { useEffect, useState } from 'react';
import { BookOpen, Brain, CheckCircle2, CircleAlert, CircleDashed, FolderOpen, Gauge, KeyRound, Plug, Plus, RefreshCw, Stethoscope, Trash2 } from 'lucide-react';
import type { Capability, DiagnosticItem, EpisodeSourceInfo, ProviderInfo, Settings } from '@shared/types';
import { api } from '../lib/api';
import { Button, Card, cx, Field, inputCls, SectionTitle, Select, Tag } from '../components/ui';
import { billingTag } from '../steps/PrepStep';

type Tab = 'playbook' | 'brain' | 'providers' | 'queue' | 'diagnostics';

const CAP_LABEL: Record<Capability, string> = { brain: 'Cerebro', image: 'Imágenes', video: 'Videos', voice: 'Voz', music: 'Música' };

export function SettingsView() {
  const [tab, setTab] = useState<Tab>('playbook');
  const [s, setS] = useState<Settings>();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [diag, setDiag] = useState<DiagnosticItem[]>();
  const [sections, setSections] = useState<{ id: string; title: string; found: boolean }[]>([]);
  const [saved, setSaved] = useState(false);
  const [sources, setSources] = useState<EpisodeSourceInfo[]>([]);
  const [cfgOrigin, setCfgOrigin] = useState<{ origin: string; error?: string }>();
  const [teamUrl, setTeamUrl] = useState('');
  const [teamToken, setTeamToken] = useState('');
  const [teamState, setTeamState] = useState<{ busy?: boolean; ok?: string; error?: string }>({});

  useEffect(() => {
    api.getSettings().then((x) => {
      setS(x);
      setTeamUrl(x.team?.url ?? '');
    });
    api.providers().then(setProviders);
    api.secretStatus().then(setSecrets);
    api.secretLabels().then(setLabels);
    api.playbookSections().then(setSections).catch(() => setSections([]));
    api.episodeSources().then(setSources);
    api.playbookConfigOrigin().then(setCfgOrigin);
  }, []);
  useEffect(() => {
    if (tab === 'diagnostics' && !diag) api.diagnostics().then(setDiag);
  }, [tab, diag]);

  if (!s) return null;
  const pb = s.playbooks.find((p) => p.id === s.activePlaybookId) ?? s.playbooks[0];
  const save = async (next: Settings) => {
    setS(next);
    await api.saveSettings(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    if (tab === 'playbook') {
      api.playbookSections().then(setSections).catch(() => setSections([]));
      api.playbookConfigOrigin().then(setCfgOrigin);
    }
  };
  const setPb = (patch: Partial<typeof pb>) => save({ ...s, playbooks: s.playbooks.map((p) => (p.id === pb.id ? { ...p, ...patch } : p)) });

  const tabs: [Tab, string, typeof BookOpen][] = [
    ['playbook', 'Playbook', BookOpen],
    ['brain', 'Cerebro y cuentas', Brain],
    ['providers', 'Proveedores', Plug],
    ['queue', 'Cola y lotes', Gauge],
    ['diagnostics', 'Diagnóstico', Stethoscope],
  ];

  return (
    <div className="mx-auto grid max-w-[1180px] grid-cols-[220px_1fr] gap-8 px-8 py-8">
      <nav className="space-y-1">
        <h1 className="mb-4 text-2xl font-semibold tracking-tight">Ajustes</h1>
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cx('no-drag flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium', tab === id ? 'bg-panel-2 text-ink' : 'text-mute hover:bg-panel hover:text-ink')}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
        {saved && <p className="px-3 pt-3 text-[12px] text-ok">Guardado</p>}
      </nav>

      <div className="space-y-5">
        {tab === 'playbook' && (
          <>
            <Card className="p-5">
              <SectionTitle title="Fuente de episodios" hint="De dónde salen los episodios de la biblioteca y a dónde AdFlow informa el avance." />
              <div className="space-y-2">
                {sources.map((src) => (
                  <label
                    key={src.id}
                    className={cx(
                      'no-drag flex items-start gap-3 rounded-xl border px-4 py-3',
                      s.episodeSource === src.id ? 'border-brand/50 bg-brand/5' : 'border-line bg-panel-2/30',
                      src.implemented ? 'cursor-pointer' : 'opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      className="mt-1 accent-[#7c5cff]"
                      name="episode-source"
                      disabled={!src.implemented}
                      checked={s.episodeSource === src.id}
                      onChange={() => save({ ...s, episodeSource: src.id })}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-semibold">{src.name}</p>
                        <Tag tone={src.shared ? 'cyan' : 'default'}>{src.shared ? 'Compartida con el equipo' : 'Solo esta computadora'}</Tag>
                        {!src.implemented && <Tag>Próximamente</Tag>}
                      </div>
                      <p className="mt-0.5 text-[12px] text-faint">{src.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-line bg-panel-2/30 p-4">
                <p className="text-[13px] font-semibold">Conexión con «Producción de redes»</p>
                <p className="mt-0.5 text-[12px] text-faint">Genera tu token en el admin: Producción de redes → Conectar AdFlow. Se guarda cifrado en esta computadora.</p>
                <div className="mt-3 grid grid-cols-[1fr_1fr_auto] items-end gap-3">
                  <Field label="Dirección del admin">
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
              <SectionTitle title="Playbook activo" hint="AdFlow lee las reglas del playbook desde su propio repositorio; nunca lo copia." />
              <div className="space-y-4">
                <Field label="Nombre">
                  <input className={inputCls} value={pb.name} onChange={(e) => setPb({ name: e.target.value })} />
                </Field>
                <Field label="Carpeta del repositorio" hint="Por ejemplo, tu clon de robles.ai.">
                  <div className="flex gap-2">
                    <input className={inputCls} value={pb.rootDir} onChange={(e) => setPb({ rootDir: e.target.value })} />
                    <Button icon={<FolderOpen className="size-4" />} onClick={async () => { const d = await api.pickFolder(); if (d) setPb({ rootDir: d }); }}>
                      Elegir
                    </Button>
                  </div>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  {(
                    [
                      ['masterPrompt', 'Prompt maestro'],
                      ['casesFile', 'Catálogo de casos'],
                      ['trackingFile', 'Seguimiento'],
                      ['episodesRoot', 'Carpeta de episodios'],
                      ['configFile', 'Configuración de AdFlow'],
                    ] as const
                  ).map(([k, label]) => (
                    <Field key={k} label={label}>
                      <input className={cx(inputCls, 'font-mono text-[12px]')} value={pb[k]} onChange={(e) => setPb({ [k]: e.target.value })} />
                    </Field>
                  ))}
                </div>
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle
                title="Secciones que recibe Claude"
                hint="El prompt maestro se corta por secciones: cada paso recibe solo las suyas más las reglas de siempre."
                right={
                  cfgOrigin && (
                    <Tag tone={cfgOrigin.origin === 'playbook' ? 'ok' : cfgOrigin.origin === 'preset' ? 'warn' : 'bad'}>
                      {cfgOrigin.origin === 'playbook' ? `Desde ${pb.configFile}` : cfgOrigin.origin === 'preset' ? 'Preset de AdFlow' : 'Sin configuración'}
                    </Tag>
                  )
                }
              />
              {cfgOrigin?.origin === 'preset' && (
                <p className="mb-3 text-[11.5px] text-faint">
                  El repo del playbook aún no tiene <span className="font-mono">{pb.configFile}</span>; se usa la copia que trae AdFlow. Al agregarlo al repo, el equipo comparte la misma configuración.
                </p>
              )}
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

        {tab === 'brain' && (
          <Card className="p-5">
            <SectionTitle title="Claude Code" hint="AdFlow usa el Claude Code instalado en esta computadora con tu suscripción. Nunca ve tu contraseña." />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Modelo por defecto">
                <Select value={s.claude.model} onChange={(v) => save({ ...s, claude: { ...s.claude, model: v } })} options={[{ value: 'opus', label: 'Opus' }, { value: 'sonnet', label: 'Sonnet' }]} />
              </Field>
              <Field label="Esfuerzo">
                <Select
                  value={s.claude.effort}
                  onChange={(v) => save({ ...s, claude: { ...s.claude, effort: v as Settings['claude']['effort'] } })}
                  options={[{ value: 'low', label: 'Bajo' }, { value: 'medium', label: 'Medio' }, { value: 'high', label: 'Alto' }]}
                />
              </Field>
            </div>
            <div className="mt-6">
              <p className="mb-2 text-[12px] font-medium text-mute">Cuentas</p>
              <div className="space-y-2">
                {s.claude.accounts.map((a) => (
                  <div key={a.id} className="grid grid-cols-[1fr_1.4fr_auto_auto] items-center gap-3 rounded-xl border border-line bg-panel-2/30 px-3 py-2.5">
                    <input className={inputCls} value={a.label} onChange={(e) => save({ ...s, claude: { ...s.claude, accounts: s.claude.accounts.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)) } })} />
                    <input
                      className={cx(inputCls, 'font-mono text-[12px]')}
                      placeholder="Sesión del sistema (sin carpeta)"
                      value={a.configDir ?? ''}
                      disabled={a.id === 'system'}
                      onChange={(e) => save({ ...s, claude: { ...s.claude, accounts: s.claude.accounts.map((x) => (x.id === a.id ? { ...x, configDir: e.target.value } : x)) } })}
                    />
                    {s.claude.defaultAccount === a.id ? (
                      <Tag tone="ok">Por defecto</Tag>
                    ) : (
                      <Button size="sm" onClick={() => save({ ...s, claude: { ...s.claude, defaultAccount: a.id } })}>
                        Por defecto
                      </Button>
                    )}
                    {a.id !== 'system' ? (
                      <button className="no-drag text-faint hover:text-bad" onClick={() => save({ ...s, claude: { ...s.claude, accounts: s.claude.accounts.filter((x) => x.id !== a.id) } })} aria-label="Quitar">
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
                onClick={() => save({ ...s, claude: { ...s.claude, accounts: [...s.claude.accounts, { id: `acc-${Date.now()}`, label: `Claude ${s.claude.accounts.length + 1}`, configDir: '' }] } })}
              >
                Agregar cuenta
              </Button>
              <p className="mt-3 text-[11.5px] leading-relaxed text-faint">
                Una cuenta administrada usa su propia carpeta de configuración de Claude Code (CLAUDE_CONFIG_DIR). Para iniciar sesión en ella, abre una terminal con esa variable y ejecuta <span className="font-mono">claude</span> una vez.
              </p>
            </div>
          </Card>
        )}

        {tab === 'providers' && (
          <>
            <Card className="p-5">
              <SectionTitle
                title="Proveedores por defecto"
                hint="Cada episodio nuevo empieza con estos. Puedes cambiarlos por episodio en Preparación."
                right={
                  <label className="no-drag flex items-center gap-2 text-[12.5px] text-mute">
                    <input type="checkbox" className="size-4 accent-[#7c5cff]" checked={s.allowPaidProviders} onChange={(e) => save({ ...s, allowPaidProviders: e.target.checked })} />
                    Permitir proveedores con créditos
                  </label>
                }
              />
              <div className="space-y-2">
                {(Object.keys(CAP_LABEL) as Capability[]).map((cap) => (
                  <div key={cap} className="grid grid-cols-[140px_1fr] items-center gap-4">
                    <span className="text-[13px] font-medium">{CAP_LABEL[cap]}</span>
                    <Select
                      value={s.defaults[cap]}
                      onChange={(v) => save({ ...s, defaults: { ...s.defaults, [cap]: v } })}
                      options={providers.filter((p) => p.capability === cap).map((p) => ({ value: p.id, label: `${p.name}${p.implemented ? '' : ' · próximamente'}`, disabled: !p.implemented }))}
                    />
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle title="Catálogo de conexiones" hint="Las que dicen «próximamente» se conectan en las siguientes fases. Ninguna gasta créditos sin tu confirmación." />
              <div className="grid grid-cols-2 gap-2">
                {providers.map((p) => (
                  <div key={p.id} className="rounded-xl border border-line bg-panel-2/30 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold">{p.name}</p>
                      <div className="flex gap-1">
                        <Tag>{CAP_LABEL[p.capability]}</Tag>
                        {billingTag(p, s.allowPaidProviders)}
                      </div>
                    </div>
                    <p className="mt-1 text-[11.5px] text-faint">{p.description}</p>
                    {!p.implemented && <p className="mt-1.5 text-[11px] text-mute">Próximamente</p>}
                  </div>
                ))}
              </div>
            </Card>
            <Card className="p-5">
              <SectionTitle title="Claves de API" hint="Se guardan cifradas con el llavero de tu sistema y nunca salen de esta computadora." />
              <div className="space-y-2">
                {Object.entries(labels).map(([k, label]) => (
                  <SecretRow key={k} name={k} label={label} isSet={!!secrets[k]} onSaved={setSecrets} />
                ))}
              </div>
            </Card>
          </>
        )}

        {tab === 'queue' && (
          <Card className="p-5">
            <SectionTitle title="Trabajo en paralelo" hint="Cuántas tareas corren a la vez. Más sesiones de Claude gastan el límite de la suscripción más rápido." />
            <div className="grid grid-cols-3 gap-4">
              {(
                [
                  ['brain', 'Sesiones de Claude'],
                  ['image', 'Imágenes a la vez'],
                  ['render', 'Voz y render'],
                ] as const
              ).map(([k, label]) => (
                <Field key={k} label={label}>
                  <Select value={String(s.concurrency[k])} onChange={(v) => save({ ...s, concurrency: { ...s.concurrency, [k]: Number(v) } })} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} />
                </Field>
              ))}
            </div>
            <Field label="Tu nombre (para el seguimiento del equipo)">
              <input className={cx(inputCls, 'mt-4')} value={s.userName} onChange={(e) => save({ ...s, userName: e.target.value })} />
            </Field>
          </Card>
        )}

        {tab === 'diagnostics' && (
          <Card className="p-5">
            <SectionTitle
              title="Diagnóstico de esta computadora"
              hint="Qué está instalado y qué falta. No gasta créditos."
              right={
                <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => { setDiag(undefined); api.diagnostics().then(setDiag); }}>
                  Revisar otra vez
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
                      {d.label} {d.required && !d.ok && <span className="text-[11px] font-normal text-bad">· necesario</span>}
                    </p>
                    <p className="selectable truncate text-[12px] text-faint">{d.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
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
