import { useEffect, useState } from 'react';
import { Pause, Play, SkipForward, Square } from 'lucide-react';
import type { PomodoroAction, PomodoroSession, PomodoroSettings, Settings } from '../../shared/channels';
import { formatClock, OFF, type Phase, phaseLabel, phaseMs, type Pomodoro, progress, remainingMs } from '../../shared/pomodoro';
import { pomodoroStats, type Tally } from '../../shared/pomodoro-stats';
import { cleanIpcError } from '../../shared/format';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from './ConfirmDialog';
import { Row } from './SettingsPage';
import { useToast } from './Toast';

const api = window.dashboardApi;
const TICK_MS = 250;
/** Same colours as the pill's ring and bar. */
const STROKE: Record<Phase, string> = { focus: '#fb7185', break: '#34d399' };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const minutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim());

/** The pill's pomodoro, bigger: control it, see how today is going, and tune its lengths. */
export function PomodoroPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [timer, setTimer] = useState<Pomodoro>(OFF);
  const [now, setNow] = useState(Date.now);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessions, setSessions] = useState<PomodoroSession[]>([]);

  useEffect(() => {
    api.getPomodoro().then(setTimer);
    const loadSettings = () => api.getSettings().then(setSettings);
    const loadSessions = () => api.pomodoroSessions().then(setSessions);
    loadSettings();
    loadSessions();
    const offTimer = api.onPomodoroChanged(setTimer);
    const offSettings = api.onSettingsChanged(loadSettings);
    const offSessions = api.onPomodoroSessionsChanged(loadSessions);
    return () => {
      offTimer();
      offSettings();
      offSessions();
    };
  }, []);

  useEffect(() => {
    setNow(Date.now());
    if (timer.status !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [timer]);

  if (!settings) return null;
  const cfg = settings.pomodoro;
  const update = (patch: Partial<PomodoroSettings>) =>
    api
      .setSettings({ pomodoro: { ...cfg, ...patch } })
      .then(setSettings)
      .catch((e) => toast(cleanIpcError(e)));
  const command = (action: PomodoroAction) => api.pomodoroCommand(action).catch((e) => toast(cleanIpcError(e)));
  const resetStats = async () => {
    if (!(await confirm({ title: 'Reset pomodoro statistics?', description: 'Every completed session on this PC is forgotten.', confirmLabel: 'Reset' })))
      return;
    await api.clearPomodoroSessions().catch((e) => toast(cleanIpcError(e)));
  };

  const stats = pomodoroStats(sessions, now);

  return (
    <div className="mx-auto max-w-3xl px-10 py-9">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pomodoro</h1>
        <p className="mt-1 text-sm text-muted-foreground">Work in focused sessions with short breaks. The same timer runs on the pill: hover the idle bar.</p>
      </header>

      <TimerCard timer={timer} now={now} cfg={cfg} today={stats.today.count} onCommand={command} />

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Today" tally={stats.today} />
        <Tile label="Last 7 days" tally={stats.week} />
        <Tile label="Streak" value={plural(stats.streak, 'day')} sub={stats.streak ? 'in a row' : 'Finish one today'} />
        <Tile label="All time" tally={stats.total} />
      </div>

      <WeekBars days={stats.days} goal={cfg.dailyGoal} />

      <h2 className="mt-9 mb-3 text-sm font-medium text-muted-foreground">Timer settings</h2>
      <div className="divide-y divide-border rounded-2xl border bg-card">
        <Row title="Focus" hint="Length of a work session. Changes apply from the next phase.">
          <NumberField label="Focus length" value={cfg.focusMin} min={1} max={120} unit="min" onChange={(v) => update({ focusMin: v })} />
        </Row>
        <Row title="Short break">
          <NumberField label="Short break length" value={cfg.shortBreakMin} min={1} max={60} unit="min" onChange={(v) => update({ shortBreakMin: v })} />
        </Row>
        <Row title="Long break">
          <NumberField label="Long break length" value={cfg.longBreakMin} min={1} max={60} unit="min" onChange={(v) => update({ longBreakMin: v })} />
        </Row>
        <Row title="Long break after" hint="A long break replaces every this-many-th break.">
          <NumberField label="Sessions before a long break" value={cfg.longBreakEvery} min={2} max={10} unit="sessions" onChange={(v) => update({ longBreakEvery: v })} />
        </Row>
        <Row title="Daily goal" hint="Focus sessions to aim for each day.">
          <NumberField label="Daily goal" value={cfg.dailyGoal} min={1} max={24} unit="sessions" onChange={(v) => update({ dailyGoal: v })} />
        </Row>
        <Row title="Start breaks automatically" hint="Off: when a focus session ends, the break waits for you to start it.">
          <Switch aria-label="Start breaks automatically" checked={cfg.autoStartBreaks} onCheckedChange={(v) => update({ autoStartBreaks: v })} />
        </Row>
        <Row title="Start focus automatically" hint="Off: when a break ends, the next focus session waits for you.">
          <Switch aria-label="Start focus automatically" checked={cfg.autoStartFocus} onCheckedChange={(v) => update({ autoStartFocus: v })} />
        </Row>
        <Row title="Chime" hint="A soft sound when a phase ends. Never while you're recording.">
          <Switch aria-label="Chime" checked={cfg.sound} onCheckedChange={(v) => update({ sound: v })} />
        </Row>
        <Row title="Statistics" hint="Completed sessions are kept on this PC only.">
          <Button variant="outline" size="sm" onClick={resetStats} disabled={sessions.length === 0}>
            Reset
          </Button>
        </Row>
      </div>
    </div>
  );
}

const RING_R = 70;
const RING_C = 2 * Math.PI * RING_R;

function TimerCard({
  timer,
  now,
  cfg,
  today,
  onCommand,
}: {
  timer: Pomodoro;
  now: number;
  cfg: PomodoroSettings;
  today: number;
  onCommand: (a: PomodoroAction) => void;
}) {
  const on = timer.status !== 'off';
  const phase: Phase = on ? timer.phase : 'focus';
  const remaining = on ? remainingMs(timer, now) : phaseMs(cfg, 'focus', false);
  const paused = timer.status === 'paused';
  const waiting = paused && timer.remainingMs === timer.durationMs;
  // Sessions finished in this run, and where the next long break falls.
  const inRound = on ? timer.done % cfg.longBreakEvery : 0;
  const untilLong = cfg.longBreakEvery - inRound;
  const goal = Math.min(1, today / cfg.dailyGoal);

  return (
    <section data-testid="pomodoro-card" className="flex items-center gap-8 rounded-2xl border bg-card p-6 shadow-sm dark:shadow-none">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 160 160" className={`size-40 -rotate-90 ${paused ? 'opacity-60' : ''}`} aria-hidden>
          <circle cx="80" cy="80" r={RING_R} fill="none" className="stroke-muted" strokeWidth="8" />
          <circle
            cx="80"
            cy="80"
            r={RING_R}
            fill="none"
            stroke={STROKE[phase]}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - (on ? progress(timer, now) : 0))}
            className="transition-[stroke-dashoffset] duration-300"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-muted-foreground">{on ? phaseLabel(timer) : 'Ready'}</span>
          <span data-testid="pomodoro-clock" className="font-mono text-3xl font-semibold tabular-nums">
            {formatClock(remaining)}
          </span>
          {paused && <span className="text-xs text-muted-foreground">{waiting ? 'Waiting' : 'Paused'}</span>}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5" aria-label={`${inRound} of ${cfg.longBreakEvery} sessions before a long break`}>
          {Array.from({ length: cfg.longBreakEvery }, (_, i) => (
            <span key={i} className={`size-2.5 rounded-full ${i < inRound ? 'bg-rose-400' : 'bg-muted'}`} />
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {on
            ? `${plural(timer.done, 'session')} this run · long break after ${plural(untilLong, 'more')}`
            : `${cfg.focusMin} min focus · ${cfg.shortBreakMin} min break · ${cfg.longBreakMin} min every ${cfg.longBreakEvery}`}
        </p>

        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground">
            <span>Daily goal</span>
            <span className="tabular-nums">
              {today} / {cfg.dailyGoal}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-rose-400 transition-[width] duration-300" style={{ width: `${goal * 100}%` }} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {!on ? (
            <Button onClick={() => onCommand('start')}>
              <Play /> Start focus
            </Button>
          ) : (
            <>
              {paused ? (
                <Button onClick={() => onCommand('resume')}>
                  <Play /> {waiting ? `Start ${phaseLabel(timer).toLowerCase()}` : 'Resume'}
                </Button>
              ) : (
                <Button variant="outline" onClick={() => onCommand('pause')}>
                  <Pause /> Pause
                </Button>
              )}
              <Button variant="outline" onClick={() => onCommand('skip')}>
                <SkipForward /> {phase === 'focus' ? 'Skip to break' : 'Skip to focus'}
              </Button>
              <Button variant="ghost" onClick={() => onCommand('stop')}>
                <Square /> Stop
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Tile({ label, tally, value, sub }: { label: string; tally?: Tally; value?: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{tally ? tally.count : value}</div>
      <div className="text-xs text-muted-foreground">{tally ? (tally.count ? minutes(tally.minutes) : 'No sessions') : sub}</div>
    </div>
  );
}

/** Sessions per day for the last week; the dashed line is the daily goal. */
function WeekBars({ days, goal }: { days: { start: number; count: number }[]; goal: number }) {
  const top = Math.max(goal, ...days.map((d) => d.count));
  return (
    <div className="mt-3 rounded-2xl border bg-card px-5 pt-4 pb-3">
      <div className="relative flex h-24 items-end gap-3">
        <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border" style={{ bottom: `${(goal / top) * 100}%` }} />
        {days.map((d, i) => (
          <div key={d.start} className="flex h-full flex-1 flex-col justify-end" title={plural(d.count, 'session')}>
            <div
              className={`rounded-t-md ${i === days.length - 1 ? 'bg-rose-400' : 'bg-rose-400/50'} ${d.count ? '' : 'h-0.5 bg-muted'}`}
              style={d.count ? { height: `${(d.count / top) * 100}%` } : undefined}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-3">
        {days.map((d, i) => (
          <span key={d.start} className="flex-1 text-center text-xs text-muted-foreground">
            {i === days.length - 1 ? 'Today' : new Date(d.start).toLocaleDateString([], { weekday: 'short' })}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A small whole-number box, saved on blur or Enter and kept within bounds. */
function NumberField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    const v = Math.min(max, Math.max(min, n));
    setText(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        className="h-8 w-16 rounded-md border border-input bg-transparent px-2 text-right text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
      <span className="w-16 text-sm text-muted-foreground">{unit}</span>
    </div>
  );
}
