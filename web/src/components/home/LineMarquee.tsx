const ROWS = [
  [
    { lang: "ES", line: "¿Quién te ha contado eso?" },
    { lang: "FR", line: "On ne se reverra plus jamais." },
    { lang: "JA", line: "そんなつもりじゃなかった。" },
    { lang: "DE", line: "Das hättest du mir früher sagen können." },
    { lang: "IT", line: "Non è colpa di nessuno." },
  ],
  [
    { lang: "KO", line: "왜 이제야 말하는 거야?" },
    { lang: "PT", line: "Eu nunca disse isso." },
    { lang: "RU", line: "Ты меня вообще слушаешь?" },
    { lang: "ES", line: "Ya es demasiado tarde para volver atrás." },
    { lang: "FR", line: "Tu aurais pu me le dire." },
  ],
];

/** Example lines drifting past, purely decorative. Each row is doubled so the loop has no seam. */
export function LineMarquee() {
  return (
    <div className="marquee space-y-3 py-6" aria-hidden="true">
      {ROWS.map((row, r) => (
        <div key={r} className={`marquee-track ${r === 1 ? "marquee-reverse" : ""}`}>
          {[...row, ...row, ...row, ...row].map((item, i) => (
            <span key={i} className="glass flex shrink-0 items-center gap-2.5 rounded-full py-2 pr-5 pl-2.5 text-sm font-medium">
              <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-xs text-muted-foreground">{item.lang}</span>
              {item.line}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
