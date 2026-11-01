import { useState } from 'react';
import type { LaterSite } from '../../shared/channels';
import { addSite, isBuiltInSite, siteHost, suggestedPage } from '../../shared/later-routes';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

const INPUT = 'h-8 rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

function SiteRow({ site, onChange, onRemove }: { site: LaterSite; onChange: (s: LaterSite) => void; onRemove: () => void }) {
  const [page, setPage] = useState(site.page);
  const commit = () => {
    const name = page.trim();
    if (name && name !== site.page) onChange({ ...site, page: name });
    else setPage(site.page);
  };
  return (
    <div className="flex items-center gap-3 px-5 py-2.5" data-testid="later-site">
      <Switch aria-label={`Save ${site.hosts[0]} to its own page`} checked={site.enabled} onCheckedChange={(enabled) => onChange({ ...site, enabled })} />
      <input
        aria-label={`Page for ${site.hosts[0]}`}
        className={`${INPUT} w-40`}
        maxLength={80}
        value={page}
        onChange={(e) => setPage(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{site.hosts.join(', ')}</span>
      {!isBuiltInSite(site) && (
        <Button variant="ghost" size="sm" onClick={onRemove}>
          Remove
        </Button>
      )}
    </div>
  );
}

/** Which websites get their own page for things saved for later. Everything else goes to Review later. */
export function LaterSitesCard({ sites, onChange }: { sites: LaterSite[]; onChange: (sites: LaterSite[]) => void }) {
  const [link, setLink] = useState('');
  const [page, setPage] = useState('');
  const host = siteHost(link);
  const taken = !!host && sites.some((s) => s.hosts.includes(host));
  const add = () => {
    const next = addSite(sites, link, page);
    if (!next) return;
    onChange(next);
    setLink('');
    setPage('');
  };
  const problem = taken ? 'That site is already listed.' : link.trim() && !host ? "That doesn't look like a website." : null;
  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-semibold">Save by site</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Links and text you save from these sites go on their own page, made the first time it's needed. Everything else goes to Review later.
      </p>
      <div className="divide-y divide-border rounded-2xl border bg-card">
        {sites.map((site, i) => (
          <SiteRow
            key={site.hosts[0]}
            site={site}
            onChange={(s) => onChange(sites.map((other, j) => (j === i ? s : other)))}
            onRemove={() => onChange(sites.filter((_, j) => j !== i))}
          />
        ))}
        <form
          className="flex flex-wrap items-center gap-2 px-5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input aria-label="Link or site to add" placeholder="Paste a link or site" className={`${INPUT} min-w-0 flex-1`} value={link} onChange={(e) => setLink(e.target.value)} />
          <input
            aria-label="Page name"
            placeholder={host ? suggestedPage(host) : 'Page name'}
            maxLength={80}
            className={`${INPUT} w-40`}
            value={page}
            onChange={(e) => setPage(e.target.value)}
          />
          <Button type="submit" variant="outline" size="sm" disabled={!host || taken}>
            Add
          </Button>
          {problem && <p className="w-full text-xs text-destructive">{problem}</p>}
        </form>
      </div>
    </section>
  );
}
