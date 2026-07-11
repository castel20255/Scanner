import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { X, Wifi, WifiOff, ChevronDown, ChevronUp, Activity, LayoutGrid, Upload } from 'lucide-react';
import { SYMBOLS } from '../lib/symbols';
import { analyzeMultiWindow, MultiWindowAnalysis } from '../lib/analysis';
import { generateCombinedRankedSignals, SignalType } from '../lib/signals';

// ─── Types ────────────────────────────────────────────────────────────────────
type MarketState = {
  symbol: string;
  ticks: number[];
  quotes: number[];
  lastPrice: number | null;
  lastDigit: number | null;
  mwa: MultiWindowAnalysis | null;
};

const APP_ID = '1089';

const STRATEGIES = [
  { id: 'even_odd',   label: 'Even / Odd',  types: ['even_odd', 'pro_even_odd'] as SignalType[] },
  { id: 'over_under', label: 'Over / Under', types: ['over_under', 'pro_over_under', 'under_7', 'over_2'] as SignalType[] },
  { id: 'matches',    label: 'Matches',      types: ['matches'] as SignalType[] },
  { id: 'differs',    label: 'Differs',      types: ['differs'] as SignalType[] },
  { id: 'rise_fall',  label: 'Rise / Fall',  types: ['rise_fall'] as SignalType[] },
];

type StrategyId = typeof STRATEGIES[number]['id'];

// Only symbols that support last-digit analysis
const DIGIT_SYMBOLS = SYMBOLS.filter(s =>
  s.category === 'Volatility' || s.category === 'Jump' || s.category === 'Step'
);

// ─── Shared multi-market WebSocket hook ──────────────────────────────────────
function useSharedMarketWS(symbols: string[]) {
  const wsRef       = useRef<WebSocket | null>(null);
  const reqId       = useRef(1);
  const subIds      = useRef<Map<string, string>>(new Map());
  const mountedRef  = useRef(true);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef  = useRef<string[]>(symbols);

  const [isConnected, setIsConnected] = useState(false);
  const [markets, setMarkets] = useState<Map<string, MarketState>>(() => {
    const m = new Map<string, MarketState>();
    for (const s of symbols)
      m.set(s, { symbol: s, ticks: [], quotes: [], lastPrice: null, lastDigit: null, mwa: null });
    return m;
  });

  // Keep symbolsRef current
  useEffect(() => { symbolsRef.current = symbols; }, [symbols.join(',')]);

  // Sync symbol set
  useEffect(() => {
    setMarkets(prev => {
      const next = new Map(prev);
      for (const s of symbols) {
        if (!next.has(s))
          next.set(s, { symbol: s, ticks: [], quotes: [], lastPrice: null, lastDigit: null, mwa: null });
      }
      for (const k of Array.from(next.keys())) {
        if (!symbols.includes(k)) next.delete(k);
      }
      return next;
    });
  }, [symbols.join(',')]);

  const fetchHistory = useCallback((ws: WebSocket, symbol: string) => {
    ws.send(JSON.stringify({
      ticks_history: symbol,
      count: 1000,
      end: 'latest',
      style: 'ticks',
      req_id: reqId.current++,
    }));
  }, []);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      for (const sym of symbolsRef.current) fetchHistory(ws, sym);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      subIds.current.clear();
      wsRef.current = null;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      reconnectRef.current = setTimeout(() => { if (mountedRef.current) connect(); }, 2500);
    };

    ws.onerror = () => ws.close();

    ws.onmessage = (ev) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(ev.data);

        if (data.msg_type === 'history' && data.history && data.echo_req?.ticks_history) {
          const sym = data.echo_req.ticks_history as string;
          if (!symbolsRef.current.includes(sym)) return;
          const prices = data.history.prices as number[];
          const ticks = prices.map(p => { const s = p.toString(); return parseInt(s[s.length - 1], 10); });
          const mwa = analyzeMultiWindow(ticks, prices);
          setMarkets(prev => {
            const next = new Map(prev);
            next.set(sym, { symbol: sym, ticks, quotes: prices, mwa,
              lastPrice: prices.at(-1) ?? null, lastDigit: ticks.at(-1) ?? null });
            return next;
          });
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ ticks: sym, subscribe: 1, req_id: reqId.current++ }));
        }

        if (data.msg_type === 'tick' && data.tick) {
          const sym = data.tick.symbol as string;
          if (!symbolsRef.current.includes(sym)) return;
          if (data.subscription) subIds.current.set(sym, data.subscription.id);
          const quote = data.tick.quote as number;
          const s = quote.toString();
          const digit = parseInt(s[s.length - 1], 10);
          setMarkets(prev => {
            const next = new Map(prev);
            const ex = next.get(sym);
            if (!ex) return prev;
            const newTicks  = [...ex.ticks,  digit].slice(-1000);
            const newQuotes = [...ex.quotes, quote].slice(-1000);
            const mwa = analyzeMultiWindow(newTicks, newQuotes);
            next.set(sym, { ...ex, ticks: newTicks, quotes: newQuotes, mwa, lastPrice: quote, lastDigit: digit });
            return next;
          });
        }
      } catch { /* ignore */ }
    };
  }, [fetchHistory]);

  // Fetch history for newly added symbols while already connected
  useEffect(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    for (const sym of symbols) {
      const st = markets.get(sym);
      if (!st || st.ticks.length === 0) fetchHistory(wsRef.current, sym);
    }
  }, [symbols.join(','), isConnected]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { isConnected, markets };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EvenOddBar({ evenPct }: { evenPct: number }) {
  const oddPct = 100 - evenPct;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider">
        <span style={{ color: '#3b82f6' }}>EVEN {evenPct.toFixed(1)}%</span>
        <span style={{ color: '#f59e0b' }}>ODD {oddPct.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full transition-all duration-700" style={{ width: `${evenPct}%`, background: 'linear-gradient(90deg,#3b82f6,#60a5fa)' }} />
        <div className="h-full transition-all duration-700" style={{ width: `${oddPct}%`, background: 'linear-gradient(90deg,#f59e0b,#fbbf24)' }} />
      </div>
      <div className="flex justify-between text-[8px] text-white/25">
        <span>{evenPct >= 52 ? '▲ EVEN bias' : evenPct <= 48 ? '▲ ODD bias' : 'Balanced'}</span>
        <span>{Math.abs(evenPct - 50).toFixed(1)}% edge</span>
      </div>
    </div>
  );
}

function OverUnderBar({ highPct, lowPct }: { highPct: number; lowPct: number }) {
  const total = highPct + lowPct;
  const normLow  = total > 0 ? (lowPct  / total) * 100 : 50;
  const normHigh = 100 - normLow;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[9px] font-bold uppercase tracking-wider">
        <span style={{ color: '#10b981' }}>UNDER 0–4 · {lowPct.toFixed(1)}%</span>
        <span style={{ color: '#ef4444' }}>OVER 5–9 · {highPct.toFixed(1)}%</span>
      </div>
      <div className="relative h-2 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full transition-all duration-700" style={{ width: `${normLow}%`, background: 'linear-gradient(90deg,#10b981,#34d399)' }} />
        <div className="h-full transition-all duration-700" style={{ width: `${normHigh}%`, background: 'linear-gradient(90deg,#ef4444,#f87171)' }} />
      </div>
      <div className="flex justify-between text-[8px] text-white/25">
        <span>{lowPct > highPct ? '▲ UNDER bias' : '▲ OVER bias'}</span>
        <span>{Math.abs(highPct - lowPct).toFixed(1)}% gap</span>
      </div>
    </div>
  );
}

function DigitFreqMiniBar({ frequencies }: { frequencies: { digit: number; percentage: number }[] }) {
  const max = Math.max(...frequencies.map(f => f.percentage), 1);
  return (
    <div className="flex items-end gap-px h-10">
      {frequencies.map(f => {
        const heightPct = (f.percentage / max) * 100;
        const isHigh    = f.digit >= 5;
        const isEven    = f.digit % 2 === 0;
        const base      = isHigh ? '#ef4444' : '#10b981';
        const border    = isEven ? '1px solid rgba(59,130,246,0.4)' : 'none';
        return (
          <div key={f.digit} className="flex-1 flex flex-col items-center gap-0.5 relative group">
            <div className="w-full rounded-sm transition-all duration-500"
              style={{ height: `${Math.max(heightPct, 4)}%`, background: base, opacity: 0.7, border }} />
            <span className="text-[7px] text-white/35 leading-none">{f.digit}</span>
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 hidden group-hover:flex text-[7px] bg-black/80 px-1 py-0.5 rounded text-white whitespace-nowrap z-10">
              {f.digit}: {f.percentage.toFixed(1)}%
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DigitDetailGrid({ frequencies, trends }: {
  frequencies: { digit: number; percentage: number }[];
  trends: { digit: number; delta: number; trendDirection: string }[];
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {frequencies.map(df => {
        const trend  = trends[df.digit];
        const isStrong = df.percentage >= 12;
        const isWeak   = df.percentage < 8;
        const color    = isStrong ? '#D61A8C' : isWeak ? '#4b5563' : '#E67E22';
        const arrow    = trend?.trendDirection === 'increasing' ? '▲' : trend?.trendDirection === 'decreasing' ? '▼' : '–';
        const arrowColor = trend?.trendDirection === 'increasing' ? '#10b981' : trend?.trendDirection === 'decreasing' ? '#ef4444' : '#6b7280';
        return (
          <div key={df.digit} className="rounded-lg p-1.5 text-center"
            style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}22` }}>
            <div className="text-xs font-black" style={{ color }}>{df.digit}</div>
            <div className="text-[8px] text-white/40">{df.percentage.toFixed(1)}%</div>
            <div className="text-[7px] font-bold mt-0.5" style={{ color: arrowColor }}>{arrow}</div>
            <div className="mt-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${Math.min(df.percentage * 5.5, 100)}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SignalBadge({ status, probability }: { status: string; probability: number }) {
  const color = status === 'TRADE NOW' ? '#10b981' : status === 'WAIT' ? '#f59e0b' : '#6b7280';
  const bg    = status === 'TRADE NOW' ? 'rgba(16,185,129,0.15)' : status === 'WAIT' ? 'rgba(245,158,11,0.12)' : 'rgba(107,114,128,0.08)';
  return (
    <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full shrink-0"
      style={{ color, background: bg, border: `1px solid ${color}35` }}>
      {status === 'TRADE NOW' ? `TRADE ${probability.toFixed(0)}%` : status === 'WAIT' ? `WAIT` : 'NEUTRAL'}
    </span>
  );
}

// ─── Market row ───────────────────────────────────────────────────────────────
function MarketRow({
  state,
  label,
  short,
  strategyIds,
  onSelectSymbol,
}: {
  state: MarketState | undefined;
  label: string;
  short: string;
  strategyIds: StrategyId[];
  onSelectSymbol: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const allowedTypes = useMemo<SignalType[]>(() => {
    const types: SignalType[] = [];
    for (const sid of strategyIds) {
      const s = STRATEGIES.find(x => x.id === sid);
      if (s) types.push(...s.types);
    }
    return Array.from(new Set(types));
  }, [strategyIds.join(',')]);

  const signals = useMemo(() => {
    if (!state?.mwa) return [];
    return generateCombinedRankedSignals(state.mwa, allowedTypes).slice(0, 4);
  }, [state?.mwa, allowedTypes.join(',')]);

  const a = state?.mwa?.w1000;
  const loading = !state || state.ticks.length === 0;

  const topSignal = signals[0];

  return (
    <div className="rounded-xl border overflow-hidden transition-all"
      style={{ borderColor: expanded ? 'rgba(214,26,140,0.25)' : 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)' }}>

      {/* ── Collapsed row ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}>

        {/* Symbol badge */}
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-[8px] font-black text-white leading-tight text-center"
          style={{ background: 'linear-gradient(135deg,rgba(214,26,140,0.4),rgba(230,126,34,0.4))', border: '1px solid rgba(214,26,140,0.3)' }}>
          {short}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold text-white leading-tight">{label}</span>
            {state?.lastDigit !== null && state?.lastDigit !== undefined && (
              <span className="text-[9px] font-black w-5 h-5 flex items-center justify-center rounded text-white"
                style={{ background: (state.lastDigit ?? 0) >= 5 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)',
                         border: (state.lastDigit ?? 0) % 2 === 0 ? '1px solid rgba(59,130,246,0.5)' : '1px solid rgba(245,158,11,0.4)' }}>
                {state.lastDigit}
              </span>
            )}
          </div>
          <div className="text-[9px] font-mono text-white/35 mt-0.5">
            {loading ? 'Loading…' : state?.lastPrice?.toFixed(4) ?? '—'}
          </div>
        </div>

        {/* Top signal badge */}
        <div className="flex items-center gap-1 shrink-0">
          {topSignal && <SignalBadge status={topSignal.status} probability={topSignal.probability} />}
          {!loading && !topSignal && (
            <span className="text-[8px] text-white/25">No signal</span>
          )}
        </div>

        {/* Scan button */}
        <button
          onClick={e => { e.stopPropagation(); onSelectSymbol(state?.symbol ?? ''); }}
          className="text-[9px] font-black px-2.5 py-1.5 rounded-lg text-white shrink-0 transition active:scale-95 hover:opacity-90"
          style={{ background: 'linear-gradient(135deg,#D61A8C,#E67E22)' }}>
          Scan
        </button>

        {expanded
          ? <ChevronUp size={11} className="text-white/30 shrink-0" />
          : <ChevronDown size={11} className="text-white/30 shrink-0" />}
      </div>

      {/* ── Expanded analysis ── */}
      {expanded && (
        <div className="px-3 pb-4 space-y-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
          {loading ? (
            <div className="py-4 flex items-center justify-center gap-2 text-white/30">
              <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
              <span className="text-[10px]">Fetching market data…</span>
            </div>
          ) : a ? (
            <>
              {/* Market info row */}
              <div className="pt-2 flex items-center gap-3 text-[9px] text-white/40">
                <span>{a.totalTicks} ticks</span>
                <span>Last digit: <b className="text-white/70">{state?.lastDigit}</b></span>
                <span>Entropy: {a.entropy.toFixed(2)}</span>
              </div>

              {/* Digit frequency bar */}
              <DigitFreqMiniBar frequencies={a.digitFrequencies} />

              {/* Strategy-specific stats */}
              {strategyIds.some(s => s === 'even_odd') && (
                <div className="rounded-xl p-2.5 space-y-2" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
                  <div className="text-[9px] font-black text-white/50 uppercase tracking-wider">Even vs Odd</div>
                  <EvenOddBar evenPct={a.evenPercentage} />
                </div>
              )}

              {strategyIds.some(s => s === 'over_under') && (
                <div className="rounded-xl p-2.5 space-y-2" style={{ background: 'rgba(16,185,129,0.04)', border: '1px solid rgba(16,185,129,0.12)' }}>
                  <div className="text-[9px] font-black text-white/50 uppercase tracking-wider">Under 0–4 vs Over 5–9</div>
                  <OverUnderBar highPct={a.highPercentage} lowPct={a.lowPercentage} />
                </div>
              )}

              {strategyIds.some(s => s === 'matches' || s === 'differs') && (
                <div className="rounded-xl p-2.5 space-y-2" style={{ background: 'rgba(214,26,140,0.04)', border: '1px solid rgba(214,26,140,0.12)' }}>
                  <div className="text-[9px] font-black text-white/50 uppercase tracking-wider">Digit Analysis</div>
                  <DigitDetailGrid frequencies={a.digitFrequencies} trends={a.digitTrends} />
                </div>
              )}

              {/* Signals */}
              {signals.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[9px] font-black text-white/30 uppercase tracking-wider">Signals</div>
                  {signals.map((sig, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-lg px-2.5 py-2"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <SignalBadge status={sig.status} probability={sig.probability} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] text-white/60 truncate">{sig.label}</div>
                        <div className="text-[8px] text-white/35 truncate">{sig.recommendation}</div>
                      </div>
                      {sig.tradeDirection && (
                        <span className="text-[8px] font-black text-white/50 shrink-0">{sig.tradeDirection}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Main MarketMonitor panel ─────────────────────────────────────────────────
export default function MarketMonitor({
  onClose,
  onSelectSymbol,
  embedded = false,
}: {
  onClose?: () => void;
  onSelectSymbol: (symbolId: string) => void;
  embedded?: boolean;
}) {
  const [selectedStrategies, setSelectedStrategies] = useState<StrategyId[]>(['even_odd', 'over_under']);
  const [selectedSymbols, setSelectedSymbols]       = useState<string[]>(DIGIT_SYMBOLS.slice(0, 8).map(s => s.id));
  const [showSymbolPicker, setShowSymbolPicker]     = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const { isConnected, markets } = useSharedMarketWS(selectedSymbols);

  const toggleStrategy = (id: StrategyId) => {
    setSelectedStrategies(prev =>
      prev.includes(id)
        ? prev.length > 1 ? prev.filter(s => s !== id) : prev
        : [...prev, id]
    );
  };

  const toggleSymbol = (id: string) => {
    setSelectedSymbols(prev =>
      prev.includes(id)
        ? prev.length > 1 ? prev.filter(s => s !== id) : prev
        : [...prev, id]
    );
  };

  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {/* Status row */}
        <div className="flex items-center gap-2 px-1 py-2">
          {isConnected
            ? <Wifi size={11} className="text-green-400" />
            : <WifiOff size={11} className="text-red-400" />}
          <span className="text-[10px] font-bold" style={{ color: isConnected ? '#4ade80' : '#f87171' }}>
            {isConnected ? `Live · ${selectedSymbols.length} markets` : 'Connecting…'}
          </span>
          <div className="flex-1" />
          <input ref={fileInputRef} type="file" accept=".xml,application/xml" className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (ev) => {
                const text = String(ev.target?.result ?? '');
                try {
                  new DOMParser().parseFromString(text, 'application/xml');
                  alert(`XML loaded: ${file.name}`);
                } catch {
                  alert('Invalid XML file');
                }
              };
              reader.readAsText(file);
              e.target.value = '';
            }}
          />
          <button onClick={() => fileInputRef.current?.click()}
            className="text-[9px] font-black px-2.5 py-1.5 rounded-xl border transition hover:bg-white/8 text-white/60 flex items-center gap-1"
            style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
            <Upload size={10} /> Load XML
          </button>
          <button onClick={() => setShowSymbolPicker(v => !v)}
            className="text-[9px] font-black px-2.5 py-1.5 rounded-xl border transition hover:bg-white/8 text-white/60"
            style={{ borderColor: 'rgba(255,255,255,0.12)', background: showSymbolPicker ? 'rgba(255,255,255,0.07)' : 'transparent' }}>
            Markets ({selectedSymbols.length})
          </button>
        </div>

        {/* Strategy selector */}
        <div className="px-1 pb-2.5">
          <div className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-1.5">Strategies</div>
          <div className="flex flex-wrap gap-1.5">
            {STRATEGIES.map(s => {
              const active = selectedStrategies.includes(s.id as StrategyId);
              return (
                <button key={s.id} onClick={() => toggleStrategy(s.id as StrategyId)}
                  className="text-[9px] font-black px-3 py-1.5 rounded-full transition active:scale-95"
                  style={{
                    background: active ? 'rgba(214,26,140,0.2)' : 'rgba(255,255,255,0.04)',
                    color:      active ? '#fff' : 'rgba(255,255,255,0.35)',
                    border:     active ? '1px solid rgba(214,26,140,0.5)' : '1px solid rgba(255,255,255,0.07)',
                  }}>
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Symbol picker */}
        {showSymbolPicker && (
          <div className="px-1 pb-2.5">
            <div className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-1.5">Select Markets</div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
              {DIGIT_SYMBOLS.map(s => {
                const active = selectedSymbols.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggleSymbol(s.id)}
                    className="text-[9px] font-black px-2 py-1 rounded-lg transition active:scale-95"
                    style={{
                      background: active ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.04)',
                      color:      active ? '#34d399' : 'rgba(255,255,255,0.35)',
                      border:     active ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.07)',
                    }}>
                    {s.short}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Market list */}
        <div className="flex-1 overflow-y-auto px-1 py-2 space-y-2">
          {selectedSymbols.map(symId => {
            const sym = SYMBOLS.find(s => s.id === symId);
            if (!sym) return null;
            return (
              <MarketRow
                key={symId}
                state={markets.get(symId)}
                label={sym.label}
                short={sym.short}
                strategyIds={selectedStrategies}
                onSelectSymbol={onSelectSymbol}
              />
            );
          })}
          {selectedSymbols.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-white/25">
              <Activity size={32} className="mb-3 opacity-30" />
              <p className="text-sm">No markets selected</p>
              <p className="text-xs mt-1">Tap Markets to add symbols</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden" style={{ background: '#07070d' }}>

      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b shrink-0"
        style={{ borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(7,7,13,0.98)' }}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'linear-gradient(135deg,#D61A8C22,#E67E2222)', border: '1px solid rgba(214,26,140,0.3)' }}>
          <LayoutGrid size={14} className="text-[#D61A8C]" />
        </div>
        <div>
          <div className="text-sm font-black text-white tracking-wide">Market Monitor</div>
          <div className="flex items-center gap-1 mt-0.5">
            {isConnected
              ? <Wifi size={9} className="text-green-400" />
              : <WifiOff size={9} className="text-red-400" />}
            <span className="text-[8px]" style={{ color: isConnected ? '#4ade80' : '#f87171' }}>
              {isConnected ? `Live · ${selectedSymbols.length} markets` : 'Connecting…'}
            </span>
          </div>
        </div>
        <div className="flex-1" />
        <input ref={fileInputRef} type="file" accept=".xml,application/xml" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
              const text = String(ev.target?.result ?? '');
              try {
                new DOMParser().parseFromString(text, 'application/xml');
                alert(`XML loaded: ${file.name}`);
              } catch {
                alert('Invalid XML file');
              }
            };
            reader.readAsText(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => fileInputRef.current?.click()}
          className="text-[9px] font-black px-2.5 py-1.5 rounded-xl border transition hover:bg-white/8 text-white/60 flex items-center gap-1"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
          <Upload size={10} /> Load XML
        </button>
        <button onClick={() => setShowSymbolPicker(v => !v)}
          className="text-[9px] font-black px-2.5 py-1.5 rounded-xl border transition hover:bg-white/8 text-white/60"
          style={{ borderColor: 'rgba(255,255,255,0.12)', background: showSymbolPicker ? 'rgba(255,255,255,0.07)' : 'transparent' }}>
          Markets ({selectedSymbols.length})
        </button>
        {onClose && (
          <button onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white/80 transition hover:bg-white/8">
            <X size={14} />
          </button>
        )}
      </div>

      {/* ── Strategy selector ── */}
      <div className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
        <div className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-1.5">Strategies (select one or more)</div>
        <div className="flex flex-wrap gap-1.5">
          {STRATEGIES.map(s => {
            const active = selectedStrategies.includes(s.id as StrategyId);
            return (
              <button key={s.id} onClick={() => toggleStrategy(s.id as StrategyId)}
                className="text-[9px] font-black px-3 py-1.5 rounded-full transition active:scale-95"
                style={{
                  background: active ? 'rgba(214,26,140,0.2)' : 'rgba(255,255,255,0.04)',
                  color:      active ? '#fff' : 'rgba(255,255,255,0.35)',
                  border:     active ? '1px solid rgba(214,26,140,0.5)' : '1px solid rgba(255,255,255,0.07)',
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Symbol picker (collapsible) ── */}
      {showSymbolPicker && (
        <div className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.015)' }}>
          <div className="text-[8px] font-black text-white/25 uppercase tracking-widest mb-1.5">Select Markets</div>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
            {DIGIT_SYMBOLS.map(s => {
              const active = selectedSymbols.includes(s.id);
              return (
                <button key={s.id} onClick={() => toggleSymbol(s.id)}
                  className="text-[9px] font-black px-2 py-1 rounded-lg transition active:scale-95"
                  style={{
                    background: active ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.04)',
                    color:      active ? '#34d399' : 'rgba(255,255,255,0.35)',
                    border:     active ? '1px solid rgba(16,185,129,0.35)' : '1px solid rgba(255,255,255,0.07)',
                  }}>
                  {s.short}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Market list ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {selectedSymbols.map(symId => {
          const sym = SYMBOLS.find(s => s.id === symId);
          if (!sym) return null;
          return (
            <MarketRow
              key={symId}
              state={markets.get(symId)}
              label={sym.label}
              short={sym.short}
              strategyIds={selectedStrategies}
              onSelectSymbol={onSelectSymbol}
            />
          );
        })}
        {selectedSymbols.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-white/25">
            <Activity size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No markets selected</p>
            <p className="text-xs mt-1">Tap Markets to add symbols</p>
          </div>
        )}
      </div>
    </div>
  );
}
