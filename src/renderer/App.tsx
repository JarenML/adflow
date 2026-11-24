import { useEffect, useState } from 'react';
import { BriefcaseBusiness, Library, Settings as SettingsIcon, WandSparkles } from 'lucide-react';
import type { AppInfo } from '@shared/api';
import type { Settings, StepId } from '@shared/types';
import { api, useClaudeUsage, useQueue } from './lib/api';
import { cx, Logo } from './components/ui';
import { LimitBars } from './components/ClaudeUsage';
import { Dashboard } from './views/Dashboard';
import { CreateView } from './views/CreateView';
import { LibraryView } from './views/Library';
import { EpisodeView } from './views/EpisodeView';
import { SettingsView } from './views/SettingsView';

type Route = { view: 'create'; pick?: string } | { view: 'jobs' } | { view: 'library' } | { view: 'settings' } | { view: 'episode'; id: string; step?: StepId };

/** The initial route can come from the URL hash (used by screenshot checks): episode:<id>[@step]. */
function initialRoute(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('episode:')) {
    const [id, step] = h.slice(8).split('@');
    return { view: 'episode', id, step: step as StepId | undefined };
  }
  if (h.startsWith('create:')) return { view: 'create', pick: h.slice(7) };
  if (h === 'jobs' || h === 'library' || h === 'settings') return { view: h };
  return { view: 'create' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [settings, setSettings] = useState<Settings>();
  const q = useQueue();
  const claudeUsage = useClaudeUsage();
  const running = q ? Object.values(q.lanes).reduce((a, l) => a + l.running, 0) : 0;
  const waiting = q ? Object.values(q.lanes).reduce((a, l) => a + l.waiting, 0) : 0;
  useEffect(() => {
    api.getSettings().then(setSettings);
  }, [route.view]);
  const [appInfo, setAppInfo] = useState<AppInfo>();
  useEffect(() => {
    api.appInfo().then(setAppInfo);
    return api.on('update', (u) => setAppInfo((a) => a && { ...a, ...u }));
  }, []);
  const pb = settings?.playbooks.find((p) => p.id === settings.activePlaybookId);

  const nav = [
    { id: 'create', label: 'Crear', icon: WandSparkles },
    { id: 'jobs', label: 'Jobs', icon: BriefcaseBusiness },
    { id: 'library', label: 'Biblioteca', icon: Library },
    { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
  ] as const;
  const active = route.view === 'episode' ? 'jobs' : route.view;
  const open = (id: string, step?: StepId) => setRoute({ view: 'episode', id, step });

  return (
    <div className="grain flex h-full">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-panel/70">
        <div className="drag flex h-14 items-center gap-2.5 px-5">
          <Logo size={26} />
          <span className="text-[16px] font-semibold tracking-tight">
            Ad<span className="brand-text">Flow</span>
          </span>
          {appInfo && <span className="font-mono text-[11px] text-mute">v{appInfo.version}</span>}
        </div>
        <nav className="flex-1 space-y-1 px-3 pt-2">
          {nav.map((n) => (
            <button
              key={n.id}
              onClick={() => setRoute({ view: n.id })}
              className={cx(
                'no-drag flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors',
                active === n.id ? 'bg-panel-2 text-ink' : 'text-mute hover:bg-panel-2/60 hover:text-ink',
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </button>
          ))}
        </nav>
        {appInfo?.readyVersion && (
          <div className="mx-3 rounded-xl border border-brand/30 bg-brand/10 p-3">
            <p className="text-[12px] font-medium text-ink">v{appInfo.readyVersion} lista</p>
            <p className="mt-0.5 text-[11px] text-mute">
              {running ? 'Se instala al cerrar AdFlow. Para reiniciar ahora, espera a que terminen las tareas.' : 'Se instala al cerrar AdFlow, o ahora:'}
            </p>
            <button
              onClick={() => api.restartToUpdate()}
              disabled={running > 0}
              className="no-drag mt-2 w-full rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reiniciar ahora
            </button>
          </div>
        )}
        <div className="m-3 rounded-xl border border-line bg-panel-2/50 p-3">
          <div className="flex items-center gap-2 text-[12px]">
            <span className={cx('size-2 rounded-full', running ? 'animate-pulse bg-brand-2' : 'bg-faint')} />
            <span className="text-mute">{running ? `${running} en curso` : 'Sin tareas'}</span>
            {waiting > 0 && <span className="text-faint">· {waiting} en cola</span>}
          </div>
          {pb && <p className="mt-2 truncate text-[11px] text-faint" title={pb.rootDir}>{pb.name}</p>}
          {claudeUsage?.fiveHour && (
            <div className="mt-3 border-t border-line pt-3">
              <LimitBars usage={claudeUsage} />
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        {route.view === 'episode' ? (
          <EpisodeView key={`${route.id}@${route.step ?? ''}`} id={route.id} initialStep={route.step} onBack={() => setRoute({ view: 'jobs' })} />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="drag h-10" />
            {route.view === 'create' && <CreateView key={route.pick ?? ''} initialPick={route.pick} onOpen={open} onLibrary={() => setRoute({ view: 'library' })} onSettings={() => setRoute({ view: 'settings' })} />}
            {route.view === 'jobs' && <Dashboard onOpen={(id) => open(id)} onCreate={() => setRoute({ view: 'create' })} />}
            {route.view === 'library' && <LibraryView onOpen={(id) => open(id)} />}
            {route.view === 'settings' && <SettingsView />}
          </div>
        )}
      </main>
    </div>
  );
}
