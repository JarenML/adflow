import { useEffect, useState } from 'react';
import { LayoutDashboard, Library, Settings as SettingsIcon } from 'lucide-react';
import type { Settings, StepId } from '@shared/types';
import { api, useQueue } from './lib/api';
import { cx, Logo } from './components/ui';
import { Dashboard } from './views/Dashboard';
import { LibraryView } from './views/Library';
import { EpisodeView } from './views/EpisodeView';
import { SettingsView } from './views/SettingsView';

type Route = { view: 'dashboard' } | { view: 'library' } | { view: 'settings' } | { view: 'episode'; id: string; step?: StepId };

/** The initial route can come from the URL hash (used by screenshot checks): episode:<id>[@step]. */
function initialRoute(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (h.startsWith('episode:')) {
    const [id, step] = h.slice(8).split('@');
    return { view: 'episode', id, step: step as StepId | undefined };
  }
  if (h === 'library' || h === 'settings') return { view: h };
  return { view: 'dashboard' };
}

export default function App() {
  const [route, setRoute] = useState<Route>(initialRoute);
  const [settings, setSettings] = useState<Settings>();
  const q = useQueue();
  const running = q ? Object.values(q.lanes).reduce((a, l) => a + l.running, 0) : 0;
  const waiting = q ? Object.values(q.lanes).reduce((a, l) => a + l.waiting, 0) : 0;
  useEffect(() => {
    api.getSettings().then(setSettings);
  }, [route.view]);
  const pb = settings?.playbooks.find((p) => p.id === settings.activePlaybookId);

  const nav = [
    { id: 'dashboard', label: 'Producción', icon: LayoutDashboard },
    { id: 'library', label: 'Biblioteca', icon: Library },
    { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
  ] as const;
  const active = route.view === 'episode' ? 'dashboard' : route.view;

  return (
    <div className="grain flex h-full">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-line bg-panel/70">
        <div className="drag flex h-14 items-center gap-2.5 px-5">
          <Logo size={26} />
          <span className="text-[16px] font-semibold tracking-tight">
            Ad<span className="brand-text">Flow</span>
          </span>
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
        <div className="m-3 rounded-xl border border-line bg-panel-2/50 p-3">
          <div className="flex items-center gap-2 text-[12px]">
            <span className={cx('size-2 rounded-full', running ? 'animate-pulse bg-brand-2' : 'bg-faint')} />
            <span className="text-mute">{running ? `${running} en curso` : 'Sin tareas'}</span>
            {waiting > 0 && <span className="text-faint">· {waiting} en cola</span>}
          </div>
          {pb && <p className="mt-2 truncate text-[11px] text-faint" title={pb.rootDir}>{pb.name}</p>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        {route.view === 'episode' ? (
          <EpisodeView id={route.id} initialStep={route.step} onBack={() => setRoute({ view: 'dashboard' })} />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="drag h-10" />
            {route.view === 'dashboard' && <Dashboard onOpen={(id) => setRoute({ view: 'episode', id })} onLibrary={() => setRoute({ view: 'library' })} />}
            {route.view === 'library' && <LibraryView onOpen={(id) => setRoute({ view: 'episode', id })} />}
            {route.view === 'settings' && <SettingsView />}
          </div>
        )}
      </main>
    </div>
  );
}
