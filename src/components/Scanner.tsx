import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  ChevronDown,
  RefreshCw,
  Zap,
  TrendingUp,
  TrendingDown,
  Download,
  Play,
  X,
  Check,
  AlertTriangle,
  Layers,
  Target,
  Minimize2,
  Maximize2,
  GripVertical,
  Orbit,
  Sparkles,
  BarChart2,
} from 'lucide-react';
import MarketMonitor from './MarketMonitor';
import { useDerivWS } from '../hooks/useDerivWS';
import { analyzeMultiWindow, MultiWindowAnalysis } from '../lib/analysis';
import { generateCombinedRankedSignals, Signal, SignalType } from '../lib/signals';
import { SYMBOLS } from '../lib/symbols';

type Step = 'orb' | 'open' | 'scanning';
type PanelTab = 'scanner' | 'monitor';

const TRADE_TYPES = [
  { id: 'over_under', label: 'Over / Under', types: ['over_under', 'pro_over_under', 'under_7', 'over_2'] as SignalType[] },
  { id: 'even_odd', label: 'Even / Odd', types: ['even_odd', 'pro_even_odd'] as SignalType[] },
  { id: 'matches', label: 'Matches', types: ['matches'] as SignalType[] },
  { id: 'differs', label: 'Differs', types: ['differs'] as SignalType[] },
  { id: 'rise_fall', label: 'Rise / Fall', types: ['rise_fall'] as SignalType[] },
  { id: 'pro_over_under', label: 'Pro Over / Under', types: ['pro_over_under', 'under_7', 'over_2'] as SignalType[] },
  { id: 'pro_even_odd', label: 'Pro Even / Odd', types: ['pro_even_odd'] as SignalType[] },
  { id: 'all', label: 'All Strategies', types: ['over_under', 'even_odd', 'matches', 'differs', 'rise_fall', 'pro_over_under', 'pro_even_odd', 'under_7', 'over_2'] as SignalType[] },
];

// ─── Draggable Orb Hook ───────────────────────────────────────────────────────
function useDraggableOrb() {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const pos = useRef({ x: 0, y: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const lastTime = useRef(0);
  const raf = useRef(0);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    dragging.current = true;
    setIsDragging(true);
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    offset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastTime.current = performance.now();
    velocity.current = { x: 0, y: 0 };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const now = performance.now();
    const dt = Math.max(now - lastTime.current, 1);
    const newX = e.clientX - offset.current.x;
    const newY = e.clientY - offset.current.y;
    velocity.current = {
      x: ((newX - pos.current.x) / dt) * 16,
      y: ((newY - pos.current.y) / dt) * 16,
    };
    pos.current = { x: newX, y: newY };
    lastTime.current = now;
    setPosition({ x: newX, y: newY });
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    setIsDragging(false);

    // Spring physics
    let vx = velocity.current.x;
    let vy = velocity.current.y;
    let px = pos.current.x;
    let py = pos.current.y;
    const decay = 0.92;

    const animate = () => {
      if (dragging.current) return;
      vx *= decay;
      vy *= decay;
      px += vx;
      py += vy;

      // Boundary bounce
      const w = window.innerWidth;
      const h = window.innerHeight;
      const size = 72;
      if (px < 0) { px = 0; vx = Math.abs(vx) * 0.5; }
      if (px > w - size) { px = w - size; vx = -Math.abs(vx) * 0.5; }
      if (py < 0) { py = 0; vy = Math.abs(vy) * 0.5; }
      if (py > h - size) { py = h - size; vy = -Math.abs(vy) * 0.5; }

      pos.current = { x: px, y: py };
      setPosition({ x: px, y: py });

      if (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1) {
        raf.current = requestAnimationFrame(animate);
      }
    };
    raf.current = requestAnimationFrame(animate);
  }, []);

  useEffect(() => {
    // Center the orb initially
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = w / 2 - 36;
    const y = h / 2 - 36;
    pos.current = { x, y };
    setPosition({ x, y });
  }, []);

  useEffect(() => {
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return { ref, position, isDragging, onPointerDown, onPointerMove, onPointerUp };
}

// ─── StatBar Component ────────────────────────────────────────────────────────
function StatBar({
  label, leftLabel, rightLabel, leftValue, leftColor, rightColor,
}: {
  label: string; leftLabel: string; rightLabel: string;
  leftValue: number; leftColor: string; rightColor: string;
}) {
  const rightValue = 100 - leftValue;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-white/40">{leftValue.toFixed(1)}% / {rightValue.toFixed(1)}%</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-black w-10 text-right" style={{ color: leftColor }}>{leftLabel}</span>
        <div className="flex-1 h-3 rounded-full overflow-hidden relative" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-700" style={{ width: `${leftValue}%`, background: leftColor }} />
          <div className="absolute right-0 top-0 h-full rounded-full transition-all duration-700" style={{ width: `${rightValue}%`, background: rightColor }} />
        </div>
        <span className="text-xs font-black w-10" style={{ color: rightColor }}>{rightLabel}</span>
      </div>
    </div>
  );
}

function DigitStat({ label, digit, percentage, color, badge }: { label: string; digit: number; percentage: number; color: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-black text-base shadow-lg shrink-0"
        style={{ background: color, boxShadow: `0 0 12px ${color}66` }}>
        {digit}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">{label}</span>
          {badge && (
            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full text-white" style={{ background: color }}>
              {badge}
            </span>
          )}
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(percentage, 100)}%`, background: color }} />
        </div>
      </div>
      <span className="text-sm font-black text-white/80 shrink-0">{percentage.toFixed(1)}%</span>
    </div>
  );
}

// ─── StatsCard ────────────────────────────────────────────────────────────────
function StatsCard({ mwa, tradeTypeId }: { mwa: MultiWindowAnalysis; tradeTypeId: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const a = mwa.w1000;
  const a120 = mwa.w120;
  const a15 = mwa.w15;

  const alignColor = mwa.alignmentScore >= 80 ? '#10b981' : mwa.alignmentScore >= 60 ? '#f59e0b' : '#ef4444';
  const alignLabel = mwa.alignmentScore >= 80 ? 'Strong' : mwa.alignmentScore >= 60 ? 'Moderate' : 'Weak';

  return (
    <div className="rounded-2xl overflow-hidden border border-white/10"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))', backdropFilter: 'blur(12px)' }}>
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full px-4 py-2.5 flex items-center justify-between select-none"
        style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))' }}
      >
        <div className="flex items-center gap-2">
          <Layers size={13} style={{ color: alignColor }} />
          <span className="text-xs font-bold text-white/70">Window Alignment</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(['1000', '120', '15'] as const).map((w) => {
              const aw = w === '1000' ? a : w === '120' ? a120 : a15;
              const active = aw.totalTicks >= parseInt(w) * 0.5;
              return (
                <span key={w} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${active ? 'text-white' : 'bg-white/5 text-white/30'}`}
                  style={active ? { background: alignColor } : {}}>
                  {w}T
                </span>
              );
            })}
          </div>
          <span className="text-xs font-black" style={{ color: alignColor }}>{mwa.alignmentScore}%</span>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: alignColor }}>{alignLabel}</span>
          <ChevronDown size={12} className={`text-white/40 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </div>
      </button>

      <div className="h-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <div className="h-full transition-all duration-700" style={{ width: `${mwa.alignmentScore}%`, background: `linear-gradient(90deg, ${alignColor}, ${alignColor}cc)` }} />
      </div>

      {!collapsed && (
        <>
          <div className="p-4 space-y-4">
            {tradeTypeId === 'even_odd' && (
              <StatBar label="Even / Odd Split" leftLabel="EVEN" rightLabel="ODD" leftValue={a.evenPercentage} leftColor="#6366f1" rightColor="#ec4899" />
            )}
            {tradeTypeId === 'over_under' && (
              <StatBar label="Over / Under 4.5" leftLabel="OVER" rightLabel="UNDR" leftValue={a.highPercentage} leftColor="#0ea5e9" rightColor="#f97316" />
            )}
            {tradeTypeId === 'matches' && (
              <DigitStat label="Strongest Digit" digit={a.powerIndex.strongest} percentage={a.digitFrequencies[a.powerIndex.strongest]?.percentage ?? 0} color="#D61A8C" badge="MATCHES" />
            )}
            {tradeTypeId === 'differs' && (
              <DigitStat label="Weakest Digit" digit={a.powerIndex.weakest} percentage={a.digitFrequencies[a.powerIndex.weakest]?.percentage ?? 0} color="#64748b" badge="DIFFERS" />
            )}
            {tradeTypeId === 'rise_fall' && (() => {
              const q = a.last10quotes;
              const rising = q.length >= 2 && q[q.length - 1] >= q[0];
              return (
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Trend Direction</span>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl" style={{ background: rising ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)' }}>
                    {rising ? <TrendingUp size={14} className="text-green-400" /> : <TrendingDown size={14} className="text-red-400" />}
                    <span className="text-xs font-black" style={{ color: rising ? '#10b981' : '#ef4444' }}>{rising ? 'RISING' : 'FALLING'}</span>
                  </div>
                </div>
              );
            })()}

            {mwa.lastDigit !== null && (
              <div className="flex items-center justify-between pt-1 border-t border-white/10">
                <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Last Digit</span>
                <div className="flex items-center gap-1.5">
                  <Target size={12} className="text-white/40" />
                  <span className="text-base font-black text-white/80">{mwa.lastDigit}</span>
                  <span className="text-[9px] font-bold text-white/40">({mwa.lastDigit % 2 === 0 ? 'EVEN' : 'ODD'} · {mwa.lastDigit >= 5 ? 'HIGH' : 'LOW'})</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-1.5 pt-0.5">
              {([
                { label: '1000T', a: a, color: '#6366f1' },
                { label: '120T', a: a120, color: '#0ea5e9' },
                { label: '15T', a: a15, color: '#D61A8C' },
              ] as const).map(({ label, a: wa, color }) => {
                const val = tradeTypeId === 'even_odd' ? wa.evenPercentage
                  : tradeTypeId === 'over_under' ? wa.highPercentage
                  : tradeTypeId === 'matches' ? ((wa.digitFrequencies[wa.powerIndex.strongest]?.percentage ?? 0) * 5) || 0
                  : tradeTypeId === 'differs' ? 100 - wa.digitFrequencies[wa.powerIndex.weakest]?.percentage
                  : 50;
                return (
                  <div key={label} className="rounded-xl p-2 text-center" style={{ background: `${color}10`, border: `1px solid ${color}30` }}>
                    <div className="text-[9px] font-bold text-white/40 mb-0.5">{label}</div>
                    <div className="text-sm font-black" style={{ color }}>{val.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────
function UnifiedSignalCard({ signal, rank, selected, lastDigit, isTop, marketLabel }: {
  signal: Signal; rank: number; selected?: boolean; lastDigit: number | null; isTop?: boolean; marketLabel?: string;
}) {
  const isTradeNow = signal.status === 'TRADE NOW';
  const isWait = signal.status === 'WAIT';
  const entryMatch = signal.targetDigit !== undefined && lastDigit !== null && signal.targetDigit === lastDigit;
  const statusColor = isTradeNow ? '#10b981' : isWait ? '#f59e0b' : 'rgba(255,255,255,0.4)';
  const statusBg = isTradeNow ? 'rgba(16,185,129,0.15)' : isWait ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.06)';
  const statusBorder = isTradeNow ? 'rgba(16,185,129,0.3)' : isWait ? 'rgba(245,158,11,0.3)' : 'rgba(255,255,255,0.1)';

  const rankBg = rank === 1 ? 'linear-gradient(135deg, #D61A8C, #8E44AD)'
    : rank === 2 ? 'linear-gradient(135deg, #0ea5e9, #6366f1)'
    : rank === 3 ? 'linear-gradient(135deg, #f59e0b, #ef4444)'
    : 'rgba(148,163,184,0.4)';

  return (
    <div
      className="rounded-2xl border transition-all duration-200 cursor-pointer"
      style={{
        borderColor: selected ? '#D61A8C' : (isTop && signal.windowsAligned) ? 'rgba(16,185,129,0.3)' : statusBorder,
        background: selected ? 'rgba(214,26,140,0.08)' : 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(8px)',
        boxShadow: selected ? '0 0 0 2px rgba(214,26,140,0.3)' : undefined,
      }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2 mb-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5"
            style={{ background: rankBg }}>
            {rank}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-black text-white/50 uppercase tracking-wider">{signal.label}</span>
              {marketLabel && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/20">{marketLabel}</span>
              )}
              {signal.tradeDirection && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full text-white"
                  style={{ background: isTradeNow ? '#10b981' : '#f59e0b' }}>
                  {signal.tradeDirection}
                </span>
              )}
              {/* Windows-aligned badge only on best (rank 1) signal */}
              {isTop && signal.windowsAligned && (
                <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 flex items-center gap-0.5">
                  <Check size={8} /> ALIGNED
                </span>
              )}
              {signal.window && (
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{signal.window}T</span>
              )}
            </div>
            <p className="text-xs font-semibold text-white/70 mt-0.5 leading-snug">{signal.recommendation}</p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <span className="text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}>
              {isTradeNow ? <Zap size={8} /> : null}
              {signal.status}
            </span>
            <span className="text-sm font-black" style={{ color: statusColor }}>{signal.probability.toFixed(0)}%</span>
          </div>
        </div>

        <div className="w-full h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.min(signal.probability, 100)}%`,
              background: isTradeNow ? 'linear-gradient(90deg, #10b981, #059669)' : isWait ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'rgba(255,255,255,0.2)',
            }} />
        </div>

        <div className="flex items-start gap-1.5">
          <Target size={10} className="text-white/40 mt-0.5 shrink-0" />
          <p className="text-[10px] text-white/40 leading-snug flex-1">
            <span className="font-bold text-white/60">Entry: </span>{signal.entryCondition}
          </p>
        </div>

        {signal.targetDigit !== undefined && (
          <div className={`mt-2 flex items-center gap-1.5 rounded-xl px-3 py-1.5 border ${entryMatch ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
            <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-black text-white ${entryMatch ? 'bg-green-500' : 'bg-white/20'}`}>
              {signal.targetDigit}
            </div>
            <span className={`text-[10px] font-bold ${entryMatch ? 'text-green-400' : 'text-white/40'}`}>
              {entryMatch ? 'Entry digit matches last tick — TRADE NOW!' : `Waiting for digit ${signal.targetDigit}`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Scanner ─────────────────────────────────────────────────────────────
export default function Scanner() {
  const [step, setStep] = useState<Step>('orb');
  const [selectedSymbol, setSelectedSymbol] = useState('1HZ100V');
  const [selectedTradeType, setSelectedTradeType] = useState('over_under');
  const [stake, setStake] = useState('1');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  const [martingale, setMartingale] = useState('2');
  const [multiMarket, setMultiMarket] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTarget, setScanTarget] = useState(1);
  const [mwa, setMwa] = useState<MultiWindowAnalysis | null>(null);
  const [combinedSignals, setCombinedSignals] = useState<Signal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);
  const [showSymbolPicker, setShowSymbolPicker] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [predictionChoice, setPredictionChoice] = useState<number | null>(null);
  const [autoScan, setAutoScan] = useState(false);
  const [lastAutoScan, setLastAutoScan] = useState<number | null>(null);
  const [signalShift, setSignalShift] = useState(false);
  const [signalUpdated, setSignalUpdated] = useState(false);
  const signalUpdatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTradeTypePicker, setShowTradeTypePicker] = useState(false);
  const [activeTab, setActiveTab] = useState<PanelTab>('scanner');
  // Bulk trade
  const [bulkCount, setBulkCount] = useState('3');
  const [showBulkPanel, setShowBulkPanel] = useState(false);
  // Recovery mode
  const [recMode, setRecMode] = useState(false);
  const [recLossThreshold, setRecLossThreshold] = useState('3');
  const [recAltType, setRecAltType] = useState('over_under');
  const [showRecTypePicker, setShowRecTypePicker] = useState(false);
  const recTypePickerRef = useRef<HTMLDivElement>(null);
  const tradeTypePickerRef = useRef<HTMLDivElement>(null);
  const symbolPickerRef = useRef<HTMLDivElement>(null);
  const prevSignalKeyRef = useRef<string>('');
  const shiftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoScanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { isConnected, subscriptionState, subscribeSymbol } = useDerivWS();
  const orb = useDraggableOrb();

  const allowedTypes = useMemo(() => {
    const tt = TRADE_TYPES.find((t) => t.id === selectedTradeType);
    return tt?.types ?? [];
  }, [selectedTradeType]);

  useEffect(() => {
    if (!subscriptionState || subscriptionState.ticks.length < 20) return;
    const result = analyzeMultiWindow(subscriptionState.ticks, subscriptionState.quotes);
    setMwa(result);
    const allSignals = generateCombinedRankedSignals(result, allowedTypes);
    // Only keep actionable signals (exclude WAIT / MONITOR status)
    const newSignals = allSignals.filter(s => s.status === 'TRADE NOW');
    setCombinedSignals(newSignals);

    // If currently selected signal no longer exists in the new list, clear it
    setSelectedSignal(prev => {
      if (!prev) return null;
      const still = newSignals.find(s => s.type === prev.type && s.tradeDirection === prev.tradeDirection);
      return still ?? null;
    });

    // Signal shift detection
    const topSignal = newSignals[0];
    const currentKey = topSignal
      ? `${topSignal.type}__${topSignal.tradeDirection ?? ''}__${topSignal.status}`
      : '';
    if (prevSignalKeyRef.current && prevSignalKeyRef.current !== currentKey) {
      setSignalShift(true);
      if (shiftTimeoutRef.current) clearTimeout(shiftTimeoutRef.current);
      shiftTimeoutRef.current = setTimeout(() => setSignalShift(false), 5000);
    }
    prevSignalKeyRef.current = currentKey;

    // Flash "UPDATED" badge
    if (signalUpdatedTimer.current) clearTimeout(signalUpdatedTimer.current);
    setSignalUpdated(true);
    signalUpdatedTimer.current = setTimeout(() => setSignalUpdated(false), 2000);
  }, [subscriptionState?.ticks.length, allowedTypes]);

  const startScan = useCallback(() => {
    setStep('scanning');
    setScanProgress(0);
    const targets = multiMarket ? SYMBOLS.length : 1;
    setScanTarget(targets);
    let i = 0;
    scanIntervalRef.current = setInterval(() => {
      i++;
      setScanProgress(i);
      if (multiMarket) {
        const sym = SYMBOLS[i - 1];
        if (sym) subscribeSymbol(sym.id);
      } else {
        subscribeSymbol(selectedSymbol);
      }
      if (i >= targets) {
        clearInterval(scanIntervalRef.current!);
        setTimeout(() => { setStep('open'); }, 600);
      }
    }, 400);
  }, [multiMarket, selectedSymbol, subscribeSymbol]);

  const runScanOnce = useCallback(() => {
    if (!isConnected) return;
    startScan();
  }, [isConnected, startScan]);

  // Continuous automatic scanner — runs every 60 seconds when enabled
  useEffect(() => {
    if (!autoScan) return;
    runScanOnce();
    if (autoScanRef.current) clearInterval(autoScanRef.current);
    autoScanRef.current = setInterval(runScanOnce, 60000);
    return () => { if (autoScanRef.current) clearInterval(autoScanRef.current); };
  }, [autoScan, runScanOnce]);

  // Close rec type dropdown on outside click
  useEffect(() => {
    if (!showRecTypePicker) return;
    const handler = (e: MouseEvent) => {
      if (recTypePickerRef.current && !recTypePickerRef.current.contains(e.target as Node)) {
        setShowRecTypePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showRecTypePicker]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showTradeTypePicker) return;
    const handler = (e: MouseEvent) => {
      if (tradeTypePickerRef.current && !tradeTypePickerRef.current.contains(e.target as Node)) {
        setShowTradeTypePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTradeTypePicker]);

  // Close symbol dropdown on outside click
  useEffect(() => {
    if (!showSymbolPicker) return;
    const handler = (e: MouseEvent) => {
      if (symbolPickerRef.current && !symbolPickerRef.current.contains(e.target as Node)) {
        setShowSymbolPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSymbolPicker]);

  // Auto-advance from orb → config once connected & ticks flow in
  useEffect(() => {
    if (step === 'orb' && isConnected && subscriptionState && subscriptionState.ticks.length >= 20) {
      setStep('open');
    }
  }, [step, isConnected, subscriptionState?.ticks.length]);

  const resetScan = useCallback(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    if (shiftTimeoutRef.current) clearTimeout(shiftTimeoutRef.current);
    setSignalShift(false);
    setStep('open');
    setActiveTab('scanner');
    setScanProgress(0);
    setMwa(null);
    setSelectedSignal(null);
    setPredictionChoice(null);
  }, []);

  const handleLoadBot = useCallback(() => {
    const signalToUse = selectedSignal || combinedSignals[0] || null;
    const entryDigit = predictionChoice ?? signalToUse?.entryDigits?.[0] ?? signalToUse?.targetDigit ?? undefined;
    const tradeTypeLabel = TRADE_TYPES.find(t => t.id === selectedTradeType)?.label ?? selectedTradeType;
    const recovery = recMode
      ? { lossThreshold: parseInt(recLossThreshold, 10) || 3, altTradeTypeId: recAltType }
      : undefined;
    const xml = generateBotXML({
      stake, takeProfit, stopLoss, martingale,
      symbol: selectedSymbol, tradeTypeLabel, bestSignal: signalToUse, entryDigit,
      recovery,
    });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tradeLabel = TRADE_TYPES.find(t => t.id === selectedTradeType)?.label?.replace(/[\s/]/g, '_') ?? selectedTradeType;
    a.download = `proai_${tradeLabel}_${selectedSymbol}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stake, takeProfit, stopLoss, martingale, selectedSymbol, selectedSignal, combinedSignals, predictionChoice, recMode, recLossThreshold, recAltType]);

  const selectedSymbolInfo = SYMBOLS.find((s) => s.id === selectedSymbol);
  const lastDigit = mwa?.lastDigit ?? null;

  // Clicking orb toggles the panel
  const handleOrbClick = useCallback(() => {
    if (orb.isDragging) return;
    if (step === 'orb') setStep('open');
    // Do NOT close on orb click — only Cancel button closes
  }, [orb.isDragging, step]);

  // Panel never closes on outside click — only the Cancel/X button closes it
  // (orb click opens it, Cancel closes it)

  // ── Floating AI Scanner Orb ──
  const isActive = step !== 'orb';
  const hasScanResults = mwa !== null || combinedSignals.length > 0;
  const orbEl = (
    <div
      ref={orb.ref}
      onPointerDown={orb.onPointerDown}
      onPointerMove={orb.onPointerMove}
      onPointerUp={orb.onPointerUp}
      onClick={handleOrbClick}
      className="fixed z-[60] cursor-grab active:cursor-grabbing select-none"
      style={{
        transform: `translate(${orb.position.x}px, ${orb.position.y}px)`,
        touchAction: 'none',
      }}
    >
      {/* Signal ripple rings (active only) */}
      {isActive && (
        <>
          <div className="absolute inset-0 m-auto rounded-full pointer-events-none"
            style={{ width: 72, height: 72, animation: 'signal-ripple 2s ease-out infinite', background: 'transparent', border: '1.5px solid rgba(56,189,248,0.6)' }} />
          <div className="absolute inset-0 m-auto rounded-full pointer-events-none"
            style={{ width: 72, height: 72, animation: 'signal-ripple 2s ease-out 0.7s infinite', background: 'transparent', border: '1.5px solid rgba(0,93,255,0.4)' }} />
        </>
      )}

      {/* Outer ambient glow */}
      <div className="absolute pointer-events-none"
        style={{
          width: 96, height: 96, top: -12, left: -12,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56,189,248,0.22) 0%, rgba(0,93,255,0.1) 55%, transparent 75%)',
          animation: 'orb-pulse 3s ease-in-out infinite',
        }} />

      {/* Loader orb */}
      <div className="relative" style={{ width: 72, height: 72 }}>

        {/* Core orb — uiverse loader (joao-canais) */}
        <div className="loader-wrapper">
          <div className="loader-circle" />
          {/* Inner content */}
          <div className="relative z-10 flex flex-col items-center leading-none">
            {step === 'orb' ? (
              <>
                <span className="text-[7px] font-black text-white tracking-widest">PRO AI</span>
              </>
            ) : step === 'scanning' ? (
              <div className="flex items-end gap-[2px] h-4">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="w-[3px] rounded-full bg-sky-300"
                    style={{ height: 14, animation: `dot-bounce 1s ease-in-out ${i * 0.12}s infinite`, boxShadow: '0 0 4px rgba(56,189,248,0.9)' }} />
                ))}
              </div>
            ) : (
              <>
                <Sparkles size={18} className="text-sky-200" style={{ filter: 'drop-shadow(0 0 4px rgba(56,189,248,0.9))' }} />
                <span className="text-[7px] font-black text-sky-100 mt-0.5 tracking-widest">LIVE</span>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );

  // ── Scanner Panel (floating card) ──
  const panel = step !== 'orb' && (
    <div
      ref={panelRef}
      className="fixed z-[55] rounded-3xl"
      style={{
        top: '50%',
        left: '50%',
        transform: minimized ? 'translate(-50%, -50%) scale(0.95)' : 'translate(-50%, -50%) scale(1)',
        width: minimized ? '320px' : 'min(480px, 92vw)',
        maxHeight: minimized ? 'auto' : '85vh',
        overflowY: minimized ? 'hidden' : 'auto',
        background: 'linear-gradient(135deg, rgba(15,10,30,0.95), rgba(10,5,25,0.97))',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        boxShadow: '0 25px 80px rgba(0,0,0,0.6), 0 0 60px rgba(214,26,140,0.15)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
    >
      {/* Header bar */}
      <div className="relative px-5 py-4 flex items-center justify-between select-none"
        style={{
          background: 'linear-gradient(135deg, rgba(214,26,140,0.3), rgba(142,68,173,0.2))',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <GripVertical size={14} className="text-white/30" />
            <span className="text-[10px] font-black tracking-wide text-white/90">
              Pro <span className="text-[#E67E22]">AI</span>
            </span>
          </div>
          <span className="text-[10px] text-white/40">{isConnected ? 'Connected' : 'Connecting...'}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMinimized((v) => !v)} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition text-white/50 hover:text-white/80">
            {minimized ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
          </button>
          <button onClick={() => setStep('orb')} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 transition text-white/50 hover:text-white/80">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      {!minimized && (
        <div className="flex border-b shrink-0" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          {([
            { id: 'scanner', label: 'Scanner' },
            { id: 'monitor', label: 'Market Monitor' },
          ] as { id: PanelTab; label: string }[]).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex-1 py-2.5 text-[11px] font-black tracking-wide transition relative"
              style={{ color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.35)' }}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-1/4 right-1/4 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(90deg,#D61A8C,#E67E22)' }} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {!minimized && (
        <>
          {/* ── SCANNER TAB ── */}
          {activeTab === 'scanner' && (
            <div className="p-5 space-y-4" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.02))' }}>
              {/* Symbol selector */}
              <div>
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-wider block mb-1">Market</label>
                <div className="relative" ref={symbolPickerRef}>
                  <button
                    onClick={() => setShowSymbolPicker((v) => !v)}
                    className="w-full flex items-center justify-between border rounded-xl px-4 py-2.5 transition"
                    style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}
                  >
                    <span className="font-bold text-white/80 text-sm">{selectedSymbolInfo?.label ?? selectedSymbol}</span>
                    <ChevronDown size={14} className={`text-white/40 transition-transform ${showSymbolPicker ? 'rotate-180' : ''}`} />
                  </button>
                  {showSymbolPicker && (
                    <div className="absolute z-[60] top-full left-0 right-0 mt-1 rounded-xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
                      style={{ background: 'rgba(15,10,30,0.98)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(20px)' }}>
                      {['Volatility', 'Crash/Boom', 'Jump', 'Bear/Bull', 'Range', 'Step'].map((cat) => (
                        <div key={cat}>
                          <div className="px-4 py-1.5 text-[10px] font-bold text-white/40 uppercase tracking-wider sticky top-0" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            {cat}
                          </div>
                          {SYMBOLS.filter((s) => s.category === cat).map((s) => (
                            <button
                              key={s.id}
                              onClick={() => { setSelectedSymbol(s.id); setShowSymbolPicker(false); }}
                              className={`w-full text-left px-4 py-2 text-sm font-medium transition ${selectedSymbol === s.id ? 'text-[#D61A8C] font-bold' : 'text-white/70 hover:bg-white/5'}`}
                              style={selectedSymbol === s.id ? { background: 'rgba(214,26,140,0.12)' } : {}}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Trade type */}
              <div>
                <label className="text-[10px] font-bold text-white/50 uppercase tracking-wider block mb-2">Trade Type</label>
                <div className="relative" ref={tradeTypePickerRef}>
                  <button
                    onClick={() => setShowTradeTypePicker(v => !v)}
                    className="w-full border rounded-xl p-2.5 text-xs font-bold text-left flex items-center justify-between transition"
                    style={{ borderColor: '#D61A8C', color: '#D61A8C', background: 'rgba(214,26,140,0.12)' }}
                  >
                    <span>{TRADE_TYPES.find(t => t.id === selectedTradeType)?.label ?? 'Select'}</span>
                    <ChevronDown size={14} className={showTradeTypePicker ? 'rotate-180 transition-transform' : 'transition-transform'} />
                  </button>
                  {showTradeTypePicker && (
                    <div className="absolute z-50 mt-1 w-full rounded-xl border border-white/10 bg-[#1a0a14] shadow-2xl overflow-hidden max-h-72 overflow-y-auto">
                      {TRADE_TYPES.map(t => (
                        <button
                          key={t.id}
                          onClick={() => { setSelectedTradeType(t.id); setSelectedSignal(null); setShowTradeTypePicker(false); }}
                          className="w-full px-3 py-2 text-xs font-bold text-left transition flex items-center justify-between hover:bg-white/5"
                          style={selectedTradeType === t.id ? { color: '#D61A8C', background: 'rgba(214,26,140,0.12)' } : { color: 'rgba(255,255,255,0.6)' }}
                        >
                          <span>{t.label}</span>
                          {selectedTradeType === t.id && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Parameters */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Stake ($)', value: stake, setter: setStake },
                  { label: 'Martingale x', value: martingale, setter: setMartingale },
                  { label: 'Take Profit ($)', value: takeProfit, setter: setTakeProfit },
                  { label: 'Stop Loss (losses)', value: stopLoss, setter: setStopLoss },
                ].map(({ label, value, setter }) => (
                  <div key={label}>
                    <label className="text-[9px] font-bold text-white/50 uppercase tracking-wider block mb-1">{label}</label>
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className="w-full border rounded-xl px-3 py-2 text-white/80 font-bold text-sm focus:outline-none transition"
                      style={{ borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}
                    />
                  </div>
                ))}
              </div>

              {/* Multi-market */}
              <div className="rounded-xl p-3 flex items-center justify-between"
                style={{ border: '1px solid rgba(230,126,34,0.2)', background: 'rgba(230,126,34,0.06)' }}>
                <div>
                  <h4 className="text-[#E67E22] font-bold text-xs">Multi-Market Scan</h4>
                  <p className="text-[10px] text-white/40">Scan all synthetic markets</p>
                </div>
                <button
                  onClick={() => setMultiMarket((v) => !v)}
                  className={`w-11 h-6 flex items-center rounded-full p-0.5 transition-colors duration-300 ${multiMarket ? 'bg-[#D61A8C]' : 'bg-white/20'}`}
                >
                  <div className={`bg-white w-5 h-5 rounded-full shadow transform transition-transform duration-300 ${multiMarket ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Scanning progress */}
              {step === 'scanning' && (
                <div className="space-y-3">
                  <div className="rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex justify-between text-xs font-bold text-white/70 mb-2">
                      <span>Synthetic Indices</span>
                      <span>{scanProgress}/{scanTarget}</span>
                    </div>
                    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="h-full transition-all duration-300 rounded-full"
                        style={{ width: `${(scanProgress / scanTarget) * 100}%`, background: 'linear-gradient(90deg, #D61A8C, #E67E22)' }} />
                    </div>
                  </div>
                  <div className="w-full text-white font-bold text-center py-3 rounded-xl text-xs flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(90deg, #E67E22, #D61A8C, #8E44AD)' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    Collecting 1000 ticks across 3 windows...
                  </div>
                </div>
              )}

              {/* Actions */}
              {step !== 'scanning' && (
                <div className="space-y-3 pt-1">
                  <button
                    onClick={() => setAutoScan(a => !a)}
                    className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 border transition active:scale-95"
                    style={{
                      borderColor: autoScan ? 'rgba(214,26,140,0.5)' : 'rgba(255,255,255,0.15)',
                      background: autoScan ? 'rgba(214,26,140,0.12)' : 'rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <RefreshCw size={13} className={autoScan ? 'animate-spin text-[#D61A8C]' : 'text-white/40'} />
                      <span className="text-xs font-bold text-white/80">Continuous scan (60s)</span>
                    </div>
                    <span className="text-[9px] font-black px-2 py-0.5 rounded-full"
                      style={{ background: autoScan ? '#D61A8C' : 'rgba(255,255,255,0.15)', color: '#fff' }}>
                      {autoScan ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={resetScan}
                      className="border-2 rounded-xl font-bold py-3 transition active:scale-95 text-sm"
                      style={{ borderColor: 'rgba(142,68,173,0.5)', color: 'rgba(255,255,255,0.6)', background: 'transparent' }}
                    >
                      Reset
                    </button>
                    <button
                      onClick={startScan}
                      disabled={!isConnected}
                      className="text-white font-bold py-3 rounded-xl shadow-lg transition active:scale-95 text-sm disabled:opacity-50"
                      style={{ background: 'linear-gradient(135deg, #E67E22, #D61A8C)' }}
                    >
                      {isConnected ? 'Scan' : 'Connecting...'}
                    </button>
                  </div>
                </div>
              )}

              {/* ── Signals (inline in Scanner tab) ── */}
              {hasScanResults && (
                <>
                  <div className="pt-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">
                        Signals · {combinedSignals.length} active
                      </span>
                      {signalUpdated && (
                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 flex items-center gap-1">
                          <Zap size={7} /> LIVE
                        </span>
                      )}
                      {signalShift && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 flex items-center gap-1 animate-pulse">
                          <AlertTriangle size={8} /> Shift
                        </span>
                      )}
                      {combinedSignals[0]?.windowsAligned && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 flex items-center gap-1">
                          <Zap size={8} /> Aligned
                        </span>
                      )}
                    </div>
                  </div>

                  {mwa && <StatsCard mwa={mwa} tradeTypeId={selectedTradeType} />}

                  {selectedSignal && (
                    <div className="rounded-2xl p-3 flex items-center justify-between gap-3"
                      style={{ background: 'linear-gradient(135deg, rgba(214,26,140,0.12), rgba(142,68,173,0.08))', border: '1.5px solid rgba(214,26,140,0.3)' }}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <Check size={12} className="text-green-400" />
                          <span className="text-xs font-black text-[#D61A8C]">Selected Signal</span>
                        </div>
                        <p className="text-xs font-bold text-white/70 truncate">{selectedSignal.recommendation}</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-black px-2.5 py-1 rounded-xl text-white"
                        style={{ background: 'linear-gradient(135deg, #D61A8C, #8E44AD)' }}>
                        {selectedSignal.tradeDirection ?? selectedSignal.label}
                      </span>
                    </div>
                  )}

                  {/* Bulk Trade */}
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                    <button onClick={() => setShowBulkPanel(v => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-white/70 hover:text-white transition">
                      <span className="flex items-center gap-2">
                        <BarChart2 size={12} className="text-sky-400" />
                        Bulk Trade
                        {showBulkPanel && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300">{bulkCount}x</span>}
                      </span>
                      <ChevronDown size={12} className={showBulkPanel ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </button>
                    {showBulkPanel && (
                      <div className="px-3 pb-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-white/50 w-24 shrink-0">No. of trades</label>
                          <input type="number" min={1} max={20} value={bulkCount} onChange={e => setBulkCount(e.target.value)}
                            className="flex-1 rounded-lg px-2 py-1 text-xs font-bold text-white text-center border"
                            style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' }} />
                        </div>
                        <button className="w-full py-2 rounded-xl text-xs font-black text-white transition active:scale-95"
                          style={{ background: 'linear-gradient(135deg, #0ea5e9, #6366f1)' }}
                          onClick={() => { setBulkCount(String(Math.max(1, Math.min(20, parseInt(bulkCount) || 3)))); setShowBulkPanel(false); }}>
                          Queue {bulkCount} Trades
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Recovery Mode */}
                  <div className="rounded-xl border overflow-hidden" style={{ borderColor: recMode ? 'rgba(245,158,11,0.35)' : 'rgba(255,255,255,0.08)', background: recMode ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.03)' }}>
                    <button onClick={() => setRecMode(v => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold transition"
                      style={{ color: recMode ? '#f59e0b' : 'rgba(255,255,255,0.7)' }}>
                      <span className="flex items-center gap-2">
                        <RefreshCw size={12} style={{ color: recMode ? '#f59e0b' : 'rgba(255,255,255,0.5)' }} />
                        Recovery Mode
                        {recMode && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300">ON</span>}
                      </span>
                      <ChevronDown size={12} className={recMode ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </button>
                    {recMode && (
                      <div className="px-3 pb-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-white/50 w-24 shrink-0">Loss threshold</label>
                          <input type="number" min={1} max={10} value={recLossThreshold} onChange={e => setRecLossThreshold(e.target.value)}
                            className="flex-1 rounded-lg px-2 py-1 text-xs font-bold text-white text-center border"
                            style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.12)' }} />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] text-white/50 w-24 shrink-0">Alt trade type</label>
                          <div className="flex-1 relative" ref={recTypePickerRef}>
                            <button onClick={() => setShowRecTypePicker(v => !v)}
                              className="w-full rounded-lg px-2 py-1 text-xs font-bold text-left flex items-center justify-between border"
                              style={{ background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b' }}>
                              <span>{TRADE_TYPES.find(t => t.id === recAltType)?.label ?? recAltType}</span>
                              <ChevronDown size={10} />
                            </button>
                            {showRecTypePicker && (
                              <div className="absolute z-50 mt-1 w-full rounded-xl border border-white/10 bg-[#1a1200] shadow-2xl overflow-hidden">
                                {TRADE_TYPES.map(t => (
                                  <button key={t.id} onClick={() => { setRecAltType(t.id); setShowRecTypePicker(false); }}
                                    className="w-full px-3 py-2 text-xs font-bold text-left transition hover:bg-white/5 flex items-center justify-between"
                                    style={recAltType === t.id ? { color: '#f59e0b' } : { color: 'rgba(255,255,255,0.5)' }}>
                                    {t.label} {recAltType === t.id && <Check size={10} />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            const suggested = suggestAltTradeType(selectedTradeType, combinedSignals);
                            setRecAltType(suggested);
                          }}
                          className="w-full rounded-lg px-2 py-1.5 text-[10px] font-black flex items-center justify-center gap-1.5 border transition active:scale-95"
                          style={{ background: 'rgba(56,189,248,0.08)', borderColor: 'rgba(56,189,248,0.3)', color: '#38bdf8' }}>
                          <Sparkles size={11} />
                          Auto-Suggest Best Alt Strategy
                        </button>
                        {(() => {
                          const suggested = suggestAltTradeType(selectedTradeType, combinedSignals);
                          const suggestedLabel = TRADE_TYPES.find(t => t.id === suggested)?.label ?? suggested;
                          if (suggested === recAltType) return null;
                          return (
                            <p className="text-[9px] text-sky-400/70 leading-snug">
                              Based on current signals, <strong className="text-sky-300">{suggestedLabel}</strong> has the strongest alignment. Tap to apply.
                            </p>
                          );
                        })()}
                        <p className="text-[9px] text-white/30 leading-snug">
                          {TRADE_TYPES.find(t => t.id === selectedTradeType)?.label} → <strong className="text-amber-300">{TRADE_TYPES.find(t => t.id === recAltType)?.label}</strong> after {recLossThreshold} losses
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Prediction picker */}
                  {selectedSignal && selectedSignal.entryDigits && selectedSignal.entryDigits.length > 0
                    && (selectedSignal.type === 'over_under' || selectedSignal.type === 'pro_over_under' || selectedSignal.type === 'under_7' || selectedSignal.type === 'over_2')
                    && (() => {
                      const digits = selectedSignal.entryDigits!;
                      const dir = (selectedSignal.tradeDirection ?? '').toUpperCase();
                      const lbl = dir.startsWith('OVER') ? 'OVER' : dir.startsWith('UNDER') ? 'UNDER' : dir;
                      return (
                        <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(214,26,140,0.35)', background: 'rgba(214,26,140,0.06)' }}>
                          <div className="flex items-center gap-1.5 mb-2">
                            <TrendingUp size={11} className="text-[#D61A8C]" />
                            <span className="text-[10px] font-black text-white/80 uppercase tracking-wide">Set Prediction</span>
                            <span className="text-[9px] text-white/40 ml-auto">
                              {predictionChoice !== null ? `Digit ${predictionChoice}` : `Auto: ${selectedSignal.targetDigit ?? digits[0]}`}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-2">
                            {digits.map((d) => (
                              <button key={d} onClick={() => setPredictionChoice(predictionChoice === d ? null : d)}
                                className="rounded-lg py-2 text-center font-black transition active:scale-95"
                                style={{
                                  background: predictionChoice === d ? 'linear-gradient(135deg,#E67E22,#D61A8C)' : selectedSignal.targetDigit === d && predictionChoice === null ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.05)',
                                  color: predictionChoice === d ? '#fff' : selectedSignal.targetDigit === d && predictionChoice === null ? '#10b981' : 'rgba(255,255,255,0.6)',
                                  border: predictionChoice === d ? '1px solid #D61A8C' : selectedSignal.targetDigit === d && predictionChoice === null ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(255,255,255,0.1)',
                                }}>
                                <span className="block text-[10px] leading-none font-bold">{lbl}</span>
                                <span className="block text-base mt-0.5">{d}</span>
                                {selectedSignal.targetDigit === d && predictionChoice === null && (
                                  <span className="block text-[8px] text-green-400 mt-0.5">AI</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                  {/* Signal list */}
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
                    {combinedSignals.length > 0
                      ? combinedSignals.map((s, i) => (
                          <button key={`${s.type}-${s.tradeDirection}-${i}`} onClick={() => setSelectedSignal(s)} className="w-full text-left">
                            <UnifiedSignalCard signal={s} rank={i + 1} selected={selectedSignal === s} lastDigit={lastDigit} isTop={i === 0} marketLabel={selectedSymbol} />
                          </button>
                        ))
                      : (
                          <div className="rounded-2xl border p-6 text-center" style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                            <AlertTriangle size={20} className="text-white/20 mx-auto mb-2" />
                            <p className="text-sm font-bold text-white/50">No signals detected</p>
                            <p className="text-[10px] text-white/30 mt-1">Collecting ticks...</p>
                          </div>
                        )}
                  </div>

                  {/* Bot action buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={resetScan} className="border rounded-xl text-white/60 text-xs font-black py-3 transition active:scale-95"
                      style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)' }}>
                      New Scan
                    </button>
                    <button onClick={handleLoadBot} className="bg-green-500 hover:bg-green-600 text-white text-xs font-black py-3 rounded-xl transition active:scale-95 flex items-center justify-center gap-1">
                      <Download size={12} />
                      Load Bot
                    </button>
                    <button onClick={handleLoadBot} className="text-white text-xs font-black py-3 rounded-xl transition active:scale-95 flex items-center justify-center gap-1"
                      style={{ background: 'linear-gradient(135deg, #E67E22, #8E44AD)' }}>
                      <Play size={12} />
                      Load & Run
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── MARKET MONITOR TAB ── */}
          {activeTab === 'monitor' && (
            <div className="p-3 flex-1 flex flex-col min-h-0">
              <MarketMonitor
                embedded
                onSelectSymbol={(symId) => {
                  setSelectedSymbol(symId);
                  setActiveTab('scanner');
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <>
      {step === 'orb' && orbEl}
      {panel}
    </>
  );
}

// ─── XML Bot Generator ─────────────────────────────────────────────────────────

function mapAltTradeType(tradeTypeId: string): {
  purchaseType: string; entryOp: string; entryThreshold: number;
  prediction: number; tradeTypeCat: string; tradeType: string; hasPrediction: boolean;
} {
  switch (tradeTypeId) {
    case 'even_odd':
      return { purchaseType: 'DIGITEVEN', entryOp: 'EQ', entryThreshold: 1, prediction: 0, tradeTypeCat: 'digits', tradeType: 'evenodd', hasPrediction: false };
    case 'over_under':
      return { purchaseType: 'DIGITOVER', entryOp: 'LTE', entryThreshold: 2, prediction: 2, tradeTypeCat: 'digits', tradeType: 'overunder', hasPrediction: true };
    case 'matches':
      return { purchaseType: 'DIGITMATCH', entryOp: 'EQ', entryThreshold: 5, prediction: 5, tradeTypeCat: 'digits', tradeType: 'matchesdiffers', hasPrediction: true };
    case 'differs':
      return { purchaseType: 'DIGITDIFF', entryOp: 'NEQ', entryThreshold: 5, prediction: 5, tradeTypeCat: 'digits', tradeType: 'matchesdiffers', hasPrediction: true };
    case 'rise_fall':
      return { purchaseType: 'CALL', entryOp: 'GTE', entryThreshold: 5, prediction: 0, tradeTypeCat: 'callput', tradeType: 'risefall', hasPrediction: false };
    default:
      return { purchaseType: 'DIGITEVEN', entryOp: 'EQ', entryThreshold: 1, prediction: 0, tradeTypeCat: 'digits', tradeType: 'evenodd', hasPrediction: false };
  }
}

function suggestAltTradeType(currentTypeId: string, signals: Signal[]): string {
  const hasStrong = (types: string[]) => signals.some(s =>
    types.includes(s.type) && s.status === 'TRADE NOW' && s.probability >= 55
  );
  const suggestions: Record<string, string> = {
    over_under: 'even_odd',
    even_odd: 'over_under',
    matches: 'differs',
    differs: 'matches',
    rise_fall: 'even_odd',
    pro_over_under: 'pro_even_odd',
    pro_even_odd: 'pro_over_under',
  };
  const suggested = suggestions[currentTypeId] ?? 'even_odd';
  const altTradeTypeMap: Record<string, string[]> = {
    even_odd: ['even_odd', 'pro_even_odd'],
    over_under: ['over_under', 'pro_over_under', 'under_7', 'over_2'],
    matches: ['matches'],
    differs: ['differs'],
    rise_fall: ['rise_fall'],
  };
  if (hasStrong(altTradeTypeMap[suggested] ?? ['even_odd'])) return suggested;
  for (const alt of ['even_odd', 'over_under', 'matches', 'differs', 'rise_fall']) {
    if (alt === currentTypeId) continue;
    if (hasStrong(altTradeTypeMap[alt] ?? [])) return alt;
  }
  return suggested;
}

function generateBotXML(opts: {
  stake: string;
  takeProfit: string;
  stopLoss: string;
  martingale: string;
  symbol: string;
  tradeTypeLabel: string;
  bestSignal: Signal | null;
  entryDigit?: number;
  recovery?: { lossThreshold: number; altTradeTypeId: string };
}): string {
  const { stake, takeProfit, stopLoss, martingale, symbol, tradeTypeLabel, bestSignal, entryDigit, recovery } = opts;

  let tradeTypeCat = 'digits';
  let tradeType = 'overunder';
  let predictionNum = 7;  // unused but kept for fallback
  let underDigitNum = 7;
  let overDigitNum = 2;
  let singleMode = false;
  let singlePurchaseType = 'DIGITUNDER';
  let singleEntryOp = 'GTE';
  let singleEntryThreshold = 6;
  let singlePrediction = 7;

  if (bestSignal) {
    const dir = (bestSignal.tradeDirection ?? '').toUpperCase();
    const td = bestSignal.targetDigit;

    // Parse OVER X / UNDER X dynamically
    const overMatch = dir.match(/^OVER\s+(\d+)$/);
    const underMatch = dir.match(/^UNDER\s+(\d+)$/);
    const matchesMatch = dir.match(/^MATCHES\s+(\d+)$/);
    const differsMatch = dir.match(/^DIFFERS\s+(\d+)$/);

    if (underMatch) {
      const underDigit = parseInt(underMatch[1], 10);
      tradeTypeCat = 'digits'; tradeType = 'overunder';
      // Single mode: fixed UNDER prediction from analysis — no alternating
      singleMode = true; singlePurchaseType = 'DIGITUNDER';
      singlePrediction = underDigit;
      // Entry: wait for a digit >= underDigit (at or above the barrier) to trigger entry
      singleEntryOp = 'GTE'; singleEntryThreshold = underDigit;
    } else if (overMatch) {
      const overDigit = parseInt(overMatch[1], 10);
      tradeTypeCat = 'digits'; tradeType = 'overunder';
      // Single mode: fixed OVER prediction from analysis — no alternating
      singleMode = true; singlePurchaseType = 'DIGITOVER';
      singlePrediction = overDigit;
      // Entry: wait for a digit <= overDigit (at or below the barrier) to trigger entry
      singleEntryOp = 'LTE'; singleEntryThreshold = overDigit;
    } else if (dir === 'EVEN') {
      tradeTypeCat = 'digits'; tradeType = 'evenodd';
      singleMode = true; singlePurchaseType = 'DIGITEVEN';
      // Entry: last digit must be ODD (1,3,5,7,9) → remainder when divided by 2 equals 1
      singlePrediction = 0; singleEntryOp = 'EQ'; singleEntryThreshold = 1;
    } else if (dir === 'ODD') {
      tradeTypeCat = 'digits'; tradeType = 'evenodd';
      singleMode = true; singlePurchaseType = 'DIGITODD';
      // Entry: last digit must be EVEN (0,2,4,6,8) → remainder when divided by 2 equals 0
      singlePrediction = 0; singleEntryOp = 'EQ'; singleEntryThreshold = 0;
    } else if (matchesMatch) {
      const matchDigit = parseInt(matchesMatch[1], 10);
      tradeTypeCat = 'digits'; tradeType = 'matchesdiffers';
      singleMode = true; singlePurchaseType = 'DIGITMATCH';
      // Entry: wait for the match digit to appear (confirming it's active/trending)
      singlePrediction = matchDigit; singleEntryOp = 'EQ'; singleEntryThreshold = matchDigit;
    } else if (differsMatch) {
      const differDigit = parseInt(differsMatch[1], 10);
      tradeTypeCat = 'digits'; tradeType = 'matchesdiffers';
      singleMode = true; singlePurchaseType = 'DIGITDIFF';
      // Entry: wait for a dominant digit (NOT the differ digit) to appear — that's the signal to buy differs
      singlePrediction = differDigit; singleEntryOp = 'NEQ'; singleEntryThreshold = differDigit;
    } else if (dir === 'RISE') {
      tradeTypeCat = 'callput'; tradeType = 'risefall';
      singleMode = true; singlePurchaseType = 'CALL';
      singlePrediction = 0; singleEntryOp = 'GTE'; singleEntryThreshold = 5;
    } else if (dir === 'FALL') {
      tradeTypeCat = 'callput'; tradeType = 'risefall';
      singleMode = true; singlePurchaseType = 'PUT';
      singlePrediction = 0; singleEntryOp = 'LTE'; singleEntryThreshold = 4;
    }

    // User-selected entry digit overrides the derived prediction/barrier
    if (entryDigit !== undefined) {
      if (overMatch || underMatch) {
        singlePrediction = entryDigit;
        if (overMatch) { singleEntryOp = 'LTE'; singleEntryThreshold = entryDigit; }
        else { singleEntryOp = 'GTE'; singleEntryThreshold = entryDigit; }
      } else if (matchesMatch || differsMatch) {
        singlePrediction = entryDigit;
        singleEntryThreshold = entryDigit;
      }
    }
  }

  const noPredictionTypes = ['CALL', 'PUT', 'DIGITEVEN', 'DIGITODD'];
  const hasPrediction = singleMode ? !noPredictionTypes.includes(singlePurchaseType) : true;
  const predVal = singleMode ? singlePrediction : predictionNum;

  // Even/Odd: entry check is parity (last_digit % 2 == expectedRemainder)
  // EVEN trade → wait for ODD last digit (remainder 1), ODD trade → wait for EVEN last digit (remainder 0)
  const isEvenOddParity = singlePurchaseType === 'DIGITEVEN' || singlePurchaseType === 'DIGITODD';
  const parityRemainder = singlePurchaseType === 'DIGITEVEN' ? 1 : 0; // EVEN waits for odd entry digit

  const altMap = recovery ? mapAltTradeType(recovery.altTradeTypeId) : null;

  const altPurchaseXml = recovery && altMap ? `
      <block type="controls_if" id="bp_rec_if">
        <value name="IF0">
          <block type="variables_get" id="bp_rec_get">
            <field name="VAR" id="v_rec_mode">Recovery Mode</field>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="bp_rec_pur">
            <field name="PURCHASE_LIST">${altMap.purchaseType}</field>
          </block>
        </statement>
        <statement name="ELSE">
          <block type="controls_if" id="bp_if1">
            <value name="IF0">
              <block type="logic_compare" id="bp_cmp1">
                <field name="OP">${isEvenOddParity ? 'EQ' : singleEntryOp}</field>
                <value name="A">
                  ${isEvenOddParity ? `<block type="math_arithmetic" id="bp_mod_arith">
                    <field name="OP">MODULO</field>
                    <value name="A">
                      <shadow type="math_number" id="bp_mod_a_sh"><field name="NUM">0</field></shadow>
                      <block type="last_digit" id="bp_ld1"></block>
                    </value>
                    <value name="B">
                      <shadow type="math_number" id="bp_mod_b_sh"><field name="NUM">2</field></shadow>
                      <block type="math_number" id="bp_mod_b"><field name="NUM">2</field></block>
                    </value>
                  </block>` : `<block type="last_digit" id="bp_ld1"></block>`}
                </value>
                <value name="B">
                  <block type="math_number" id="bp_mn1">
                    <field name="NUM">${isEvenOddParity ? parityRemainder : singleEntryThreshold}</field>
                  </block>
                </value>
              </block>
            </value>
            <statement name="DO0">
              <block type="purchase" id="bp_pur1">
                <field name="PURCHASE_LIST">${singlePurchaseType}</field>
              </block>
            </statement>
          </block>
        </statement>
      </block>` : '';

  const beforePurchaseStack = recovery
    ? altPurchaseXml
    : singleMode
      ? isEvenOddParity
        ? `
      <block type="controls_if" id="bp_if1">
        <value name="IF0">
          <block type="logic_compare" id="bp_cmp1">
            <field name="OP">EQ</field>
            <value name="A">
              <block type="math_arithmetic" id="bp_mod_arith">
                <field name="OP">MODULO</field>
                <value name="A">
                  <shadow type="math_number" id="bp_mod_a_sh"><field name="NUM">0</field></shadow>
                  <block type="last_digit" id="bp_ld1"></block>
                </value>
                <value name="B">
                  <shadow type="math_number" id="bp_mod_b_sh"><field name="NUM">2</field></shadow>
                  <block type="math_number" id="bp_mod_b"><field name="NUM">2</field></block>
                </value>
              </block>
            </value>
            <value name="B">
              <block type="math_number" id="bp_mn1">
                <field name="NUM">${parityRemainder}</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="bp_pur1">
            <field name="PURCHASE_LIST">${singlePurchaseType}</field>
          </block>
        </statement>
      </block>`
        : `
      <block type="controls_if" id="bp_if1">
        <value name="IF0">
          <block type="logic_compare" id="bp_cmp1">
            <field name="OP">${singleEntryOp}</field>
            <value name="A">
              <block type="last_digit" id="bp_ld1"></block>
            </value>
            <value name="B">
              <block type="math_number" id="bp_mn1">
                <field name="NUM">${singleEntryThreshold}</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="bp_pur1">
            <field name="PURCHASE_LIST">${singlePurchaseType}</field>
          </block>
        </statement>
      </block>`
      : `
      <block type="controls_if" id="bp_if1">
        <value name="IF0">
          <block type="logic_compare" id="bp_cmp1">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="last_digit" id="bp_ld1"></block>
            </value>
            <value name="B">
              <block type="math_number" id="bp_mn1">
                <field name="NUM">0</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="purchase" id="bp_pur1">
            <field name="PURCHASE_LIST">DIGITOVER</field>
          </block>
        </statement>
      </block>`;

  const recLossThreshold = recovery?.lossThreshold ?? 3;

  const winRecResetXml = recovery ? `
                        <next>
                          <block type="variables_set" id="ap_win_rec_rst">
                            <field name="VAR" id="v_rec_mode">Recovery Mode</field>
                            <value name="VALUE">
                              <block type="logic_boolean" id="lb_win_rec">
                                <field name="BOOL">FALSE</field>
                              </block>
                            </value>` : '';

  const winRecCloseXml = recovery ? `
                          </block>
                        </next>` : '';

  const lossRecCheckXml = recovery ? `
                        <next>
                          <block type="controls_if" id="ap_loss_rec_chk">
                            <value name="IF0">
                              <block type="logic_compare" id="ap_loss_rec_cmp">
                                <field name="OP">GTE</field>
                                <value name="A">
                                  <block type="variables_get" id="ap_loss_lc_get">
                                    <field name="VAR" id="v_loss_cnt">Loss Count</field>
                                  </block>
                                </value>
                                <value name="B">
                                  <block type="math_number" id="ap_loss_thresh">
                                    <field name="NUM">${recLossThreshold}</field>
                                  </block>
                                </value>
                              </block>
                            </value>
                            <statement name="DO0">
                              <block type="variables_set" id="ap_loss_rec_set">
                                <field name="VAR" id="v_rec_mode">Recovery Mode</field>
                                <value name="VALUE">
                                  <block type="logic_boolean" id="lb_loss_rec">
                                    <field name="BOOL">TRUE</field>
                                  </block>
                                </value>
                              </block>
                            </statement>` : '';

  const lossRecCloseXml = recovery ? `
                          </block>
                        </next>` : '';

  const afterPurchaseWinLoss = singleMode
    ? `
              <block type="controls_if" id="ap_wl">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="contract_check_result" id="ap_win_chk">
                    <field name="CHECK_RESULT">win</field>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="variables_set" id="ap_win_rs">
                    <field name="VAR" id="v_stake">Stake</field>
                    <value name="VALUE">
                      <block type="variables_get" id="ap_win_init">
                        <field name="VAR" id="v_init_stake">Initial Stake</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="ap_win_lc">
                        <field name="VAR" id="v_loss_cnt">Loss Count</field>
                        <value name="VALUE">
                          <block type="math_number" id="ap_win_lc_zero">
                            <field name="NUM">0</field>
                          </block>
                        </value>${winRecResetXml}
                        <next>
                          <block type="trade_again" id="ap_win_ta"></block>
                        </next>
                      </block>${winRecCloseXml}
                    </next>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="variables_set" id="ap_loss_mg">
                    <field name="VAR" id="v_stake">Stake</field>
                    <value name="VALUE">
                      <block type="math_arithmetic" id="ap_mg_arith">
                        <field name="OP">MULTIPLY</field>
                        <value name="A">
                          <shadow type="math_number" id="ap_mg_a_sh">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="variables_get" id="ap_mg_stake_get">
                            <field name="VAR" id="v_stake">Stake</field>
                          </block>
                        </value>
                        <value name="B">
                          <shadow type="math_number" id="ap_mg_b_sh">
                            <field name="NUM">2</field>
                          </shadow>
                          <block type="variables_get" id="ap_mg_get">
                            <field name="VAR" id="v_mg">Martingale</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <next>
                      <block type="math_change" id="ap_loss_lc_inc">
                        <field name="VAR" id="v_loss_cnt">Loss Count</field>
                        <value name="DELTA">
                          <shadow type="math_number" id="ap_lc_delta">
                            <field name="NUM">1</field>
                          </shadow>
                        </value>${lossRecCheckXml}
                        <next>
                          <block type="trade_again" id="ap_loss_ta"></block>
                        </next>
                      </block>${lossRecCloseXml}
                    </next>
                  </block>
                </statement>
              </block>`
    : `
              <block type="controls_if" id="ap_wl">
                <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
                <value name="IF0">
                  <block type="contract_check_result" id="ap_win_chk">
                    <field name="CHECK_RESULT">win</field>
                  </block>
                </value>
                <statement name="DO0">
                  <block type="variables_set" id="ap_win_rs">
                    <field name="VAR" id="v_stake">Stake</field>
                    <value name="VALUE">
                      <block type="variables_get" id="ap_win_init">
                        <field name="VAR" id="v_init_stake">Initial Stake</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="ap_win_lc">
                        <field name="VAR" id="v_loss_cnt">Loss Count</field>
                        <value name="VALUE">
                          <block type="math_number" id="ap_win_lc_zero">
                            <field name="NUM">0</field>
                          </block>
                        </value>${winRecResetXml}
                        <next>
                          <block type="trade_again" id="ap_win_ta"></block>
                        </next>
                      </block>${winRecCloseXml}
                    </next>
                  </block>
                </statement>
                <statement name="ELSE">
                  <block type="variables_set" id="ap_loss_mg">
                    <field name="VAR" id="v_stake">Stake</field>
                    <value name="VALUE">
                      <block type="math_arithmetic" id="ap_mg_arith">
                        <field name="OP">MULTIPLY</field>
                        <value name="A">
                          <shadow type="math_number" id="ap_mg_a_sh">
                            <field name="NUM">1</field>
                          </shadow>
                          <block type="variables_get" id="ap_mg_stake_get">
                            <field name="VAR" id="v_stake">Stake</field>
                          </block>
                        </value>
                        <value name="B">
                          <shadow type="math_number" id="ap_mg_b_sh">
                            <field name="NUM">2</field>
                          </shadow>
                          <block type="variables_get" id="ap_mg_get">
                            <field name="VAR" id="v_mg">Martingale</field>
                          </block>
                        </value>
                      </block>
                    </value>
                    <next>
                      <block type="math_change" id="ap_loss_lc_inc">
                        <field name="VAR" id="v_loss_cnt">Loss Count</field>
                        <value name="DELTA">
                          <shadow type="math_number" id="ap_lc_delta">
                            <field name="NUM">1</field>
                          </shadow>
                        </value>${lossRecCheckXml}
                        <next>
                          <block type="trade_again" id="ap_loss_ta"></block>
                        </next>
                      </block>${lossRecCloseXml}
                    </next>
                  </block>
                </statement>
              </block>`;

  const extraVars = singleMode
    ? ''
    : `
    <variable id="v_pred">Prediction</variable>
    <variable id="v_under_digit">Under Digit</variable>
    <variable id="v_over_digit">Over Digit</variable>`;

  const recoveryInitXml = recovery ? `
                                <next>
                                  <block type="variables_set" id="vs_rec_mode">
                                    <field name="VAR" id="v_rec_mode">Recovery Mode</field>
                                    <value name="VALUE">
                                      <block type="logic_boolean" id="lb_rec_mode">
                                        <field name="BOOL">FALSE</field>
                                      </block>
                                    </value>
                                  </block>
                                </next>` : '';

  const extraInit = singleMode
    ? recovery ? `
                        <next>
                          <block type="variables_set" id="vs_rec_mode">
                            <field name="VAR" id="v_rec_mode">Recovery Mode</field>
                            <value name="VALUE">
                              <block type="logic_boolean" id="lb_rec_mode">
                                <field name="BOOL">FALSE</field>
                              </block>
                            </value>
                          </block>
                        </next>` : ''
    : `
                        <next>
                          <block type="variables_set" id="vs_under">
                            <field name="VAR" id="v_under_digit">Under Digit</field>
                            <value name="VALUE">
                              <block type="math_number" id="mn_under">
                                <field name="NUM">${underDigitNum}</field>
                              </block>
                            </value>
                            <next>
                              <block type="variables_set" id="vs_over">
                                <field name="VAR" id="v_over_digit">Over Digit</field>
                                <value name="VALUE">
                                  <block type="math_number" id="mn_over">
                                    <field name="NUM">${overDigitNum}</field>
                                  </block>
                                </value>
                                <next>
                                  <block type="variables_set" id="vs_pred">
                                    <field name="VAR" id="v_pred">Prediction</field>
                                    <value name="VALUE">
                                      <block type="variables_get" id="vg_under_init">
                                        <field name="VAR" id="v_under_digit">Under Digit</field>
                                      </block>
                                    </value>${recoveryInitXml}
                                  </block>
                                </next>
                              </block>
                            </next>
                          </block>
                        </next>`;

  const predictionBlock = hasPrediction
    ? `
        <value name="PREDICTION">
          <block type="math_number_positive" id="pred_block">
            <field name="NUM">${predVal}</field>
          </block>
        </value>`
    : '';

  return `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
  <variables>
    <variable id="v_stake">Stake</variable>
    <variable id="v_init_stake">Initial Stake</variable>
    <variable id="v_tp">Take Profit</variable>
    <variable id="v_sl">Stop Loss</variable>
    <variable id="v_mg">Martingale</variable>
    <variable id="v_loss_cnt">Loss Count</variable>
    <variable id="v_rec_mode">Recovery Mode</variable>${extraVars}
  </variables>

  <block type="trade_definition" id="td_main" deletable="false" x="0" y="60">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" id="tdm1" deletable="false" movable="false">
        <field name="MARKET_LIST">synthetic_index</field>
        <field name="SUBMARKET_LIST">random_index</field>
        <field name="SYMBOL_LIST">${symbol}</field>
        <next>
          <block type="trade_definition_tradetype" id="tdt1" deletable="false" movable="false">
            <field name="TRADETYPECAT_LIST">${tradeTypeCat}</field>
            <field name="TRADETYPE_LIST">${tradeType}</field>
            <next>
              <block type="trade_definition_contracttype" id="tdct1" deletable="false" movable="false">
                <field name="TYPE_LIST">${singlePurchaseType === 'DIGITMATCH' ? 'DIGITMATCH' : singlePurchaseType === 'DIGITDIFF' ? 'DIGITDIFF' : 'both'}</field>
                <next>
                  <block type="trade_definition_candleinterval" id="tdci1" deletable="false" movable="false">
                    <field name="CANDLEINTERVAL_LIST">60</field>
                    <next>
                      <block type="trade_definition_restartbuysell" id="tdrbs1" deletable="false" movable="false">
                        <field name="TIME_MACHINE_ENABLED">FALSE</field>
                        <next>
                          <block type="trade_definition_restartonerror" id="tdroe1" deletable="false" movable="false">
                            <field name="RESTARTONERROR">TRUE</field>
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>

    <statement name="INITIALIZATION">
      <block type="variables_set" id="vs_stake">
        <field name="VAR" id="v_stake">Stake</field>
        <value name="VALUE">
          <block type="math_number" id="mn_stake">
            <field name="NUM">${stake}</field>
          </block>
        </value>
        <next>
          <block type="variables_set" id="vs_init_stake">
            <field name="VAR" id="v_init_stake">Initial Stake</field>
            <value name="VALUE">
              <block type="math_number" id="mn_init">
                <field name="NUM">${stake}</field>
              </block>
            </value>
            <next>
              <block type="variables_set" id="vs_tp">
                <field name="VAR" id="v_tp">Take Profit</field>
                <value name="VALUE">
                  <block type="math_number" id="mn_tp">
                    <field name="NUM">${takeProfit}</field>
                  </block>
                </value>
                <next>
                  <block type="variables_set" id="vs_sl">
                    <field name="VAR" id="v_sl">Stop Loss</field>
                    <value name="VALUE">
                      <block type="math_number" id="mn_sl">
                        <field name="NUM">${stopLoss}</field>
                      </block>
                    </value>
                    <next>
                      <block type="variables_set" id="vs_mg">
                        <field name="VAR" id="v_mg">Martingale</field>
                        <value name="VALUE">
                          <block type="math_number" id="mn_mg">
                            <field name="NUM">${martingale}</field>
                          </block>
                        </value>
                        <next>
                          <block type="variables_set" id="vs_loss_cnt">
                            <field name="VAR" id="v_loss_cnt">Loss Count</field>
                            <value name="VALUE">
                              <block type="math_number" id="mn_lc">
                                <field name="NUM">0</field>
                              </block>
                            </value>${extraInit}
                          </block>
                        </next>
                      </block>
                    </next>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>

    <statement name="SUBMARKET">
      <block type="trade_definition_tradeoptions" id="tdto1">
        <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="${hasPrediction}"></mutation>
        <field name="DURATIONTYPE_LIST">t</field>
        <value name="DURATION">
          <shadow type="math_number_positive" id="dur1">
            <field name="NUM">1</field>
          </shadow>
        </value>
        <value name="AMOUNT">
          <shadow type="math_number_positive" id="amt1">
            <field name="NUM">${stake}</field>
          </shadow>
          <block type="variables_get" id="vg_stake_sub">
            <field name="VAR" id="v_stake">Stake</field>
          </block>
        </value>${predictionBlock}
      </block>
    </statement>
  </block>

  <block type="before_purchase" id="bp1" deletable="false" x="0" y="900">
    <statement name="BEFOREPURCHASE_STACK">
      ${beforePurchaseStack}
    </statement>
  </block>

  <block type="after_purchase" id="ap1" collapsed="true" x="900" y="60">
    <statement name="AFTERPURCHASE_STACK">
      <block type="controls_if" id="ap_if_tp_sl">
        <mutation xmlns="http://www.w3.org/1999/xhtml" elseif="1" else="1"></mutation>

        <value name="IF0">
          <block type="logic_compare" id="ap_cmp_tp">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="total_profit" id="ap_tp_val"></block>
            </value>
            <value name="B">
              <block type="variables_get" id="ap_vg_tp">
                <field name="VAR" id="v_tp">Take Profit</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="text_print" id="ap_tp_msg">
            <value name="TEXT">
              <shadow type="text" id="ap_tp_shadow">
                <field name="TEXT">Pro AI ${tradeTypeLabel}: Take Profit Hit!</field>
              </shadow>
            </value>
          </block>
        </statement>

        <value name="IF1">
          <block type="logic_compare" id="ap_cmp_sl">
            <field name="OP">GTE</field>
            <value name="A">
              <block type="variables_get" id="ap_vg_lc">
                <field name="VAR" id="v_loss_cnt">Loss Count</field>
              </block>
            </value>
            <value name="B">
              <block type="variables_get" id="ap_vg_sl">
                <field name="VAR" id="v_sl">Stop Loss</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO1">
          <block type="text_print" id="ap_sl_msg">
            <value name="TEXT">
              <shadow type="text" id="ap_sl_shadow">
                <field name="TEXT">Pro AI ${tradeTypeLabel}: Stop Loss Reached.</field>
              </shadow>
            </value>
          </block>
        </statement>

        <statement name="ELSE">
          ${afterPurchaseWinLoss}
        </statement>
      </block>
    </statement>
  </block>

</xml>`;
}
