import { useState } from 'react';
import { NotesPage } from './NotesPage';
import { SettingsPage } from './SettingsPage';

type Page = 'notes' | 'settings';

const NAV: { id: Page; label: string; icon: string }[] = [
  { id: 'notes', label: 'Notes', icon: 'M4 6h16M4 12h16M4 18h10' },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  },
];

export function App() {
  const [page, setPage] = useState<Page>('notes');

  return (
    <div className="flex h-screen bg-stone-50 text-stone-900 antialiased">
      <aside className="flex w-56 shrink-0 flex-col border-r border-stone-200 bg-stone-100/70 px-3 py-5">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-stone-900">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Voice Notes</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                page === item.id ? 'bg-white font-medium shadow-sm ring-1 ring-stone-200' : 'text-stone-600 hover:bg-stone-200/60'
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d={item.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="flex-1 overflow-y-auto">{page === 'notes' ? <NotesPage /> : <SettingsPage />}</main>
    </div>
  );
}
