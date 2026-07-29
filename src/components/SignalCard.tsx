import { Signal, SignalStatus } from '../lib/signals';
import { Zap, Clock, MinusCircle } from 'lucide-react';

const statusConfig: Record<SignalStatus, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
  'TRADE NOW': {
    color: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.25)',
    icon: <Zap size={10} className="text-green-400" />,
  },
  WAIT: {
    color: '#f59e0b',
    bg: 'rgba(245,158,11,0.06)',
    border: 'rgba(245,158,11,0.2)',
    icon: <Clock size={10} className="text-amber-400" />,
  },
  NEUTRAL: {
    color: '#6b7280',
    bg: 'rgba(107,114,128,0.05)',
    border: 'rgba(107,114,128,0.15)',
    icon: <MinusCircle size={10} className="text-gray-400" />,
  },
};

type Props = {
  signal: Signal;
  compact?: boolean;
};

export function SignalCard({ signal, compact = false }: Props) {
  const cfg = statusConfig[signal.status];
  const barWidth = Math.min(signal.probability, 100);

  return (
    <div className="rounded-lg p-2.5 transition-all duration-300"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
      <div className="flex items-center gap-2">
        {/* Status icon */}
        <div className="shrink-0">{cfg.icon}</div>

        {/* Label + direction */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black text-white/80 uppercase tracking-wider truncate">{signal.label}</span>
            {signal.tradeDirection && (
              <span className="text-[8px] font-black px-1 py-0.5 rounded text-white/60"
                style={{ background: 'rgba(255,255,255,0.08)' }}>
                {signal.tradeDirection}
              </span>
            )}
          </div>
          {!compact && (
            <p className="text-[9px] text-white/40 leading-tight mt-0.5 truncate">{signal.recommendation}</p>
          )}
        </div>

        {/* Probability */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-12 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${barWidth}%`, background: cfg.color }} />
          </div>
          <span className="text-[11px] font-black tabular-nums" style={{ color: cfg.color }}>
            {signal.probability.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
