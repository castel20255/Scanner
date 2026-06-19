import { Signal, SignalStatus } from '../lib/signals';
import { Zap, Clock, MinusCircle } from 'lucide-react';

const statusConfig: Record<SignalStatus, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  'TRADE NOW': {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    icon: <Zap size={12} className="text-green-600" />,
  },
  WAIT: {
    bg: 'bg-amber-50',
    text: 'text-amber-700',
    border: 'border-amber-200',
    icon: <Clock size={12} className="text-amber-600" />,
  },
  NEUTRAL: {
    bg: 'bg-gray-50',
    text: 'text-gray-500',
    border: 'border-gray-200',
    icon: <MinusCircle size={12} className="text-gray-400" />,
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
    <div className={`rounded-xl border ${cfg.border} ${cfg.bg} p-3 transition-all duration-300`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{signal.label}</span>
            {signal.tradeDirection && (
              <span className="bg-white border border-gray-200 text-[10px] font-black px-1.5 py-0.5 rounded text-gray-700">
                {signal.tradeDirection}
              </span>
            )}
          </div>
          <p className="text-xs font-semibold text-gray-800 leading-snug">{signal.recommendation}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full border ${cfg.border} ${cfg.text} whitespace-nowrap`}
          >
            {cfg.icon}
            {signal.status}
          </span>
          <span className="text-sm font-black text-gray-800">{signal.probability.toFixed(0)}%</span>
        </div>
      </div>

      {/* Probability bar */}
      <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${barWidth}%`,
            background:
              signal.status === 'TRADE NOW'
                ? 'linear-gradient(90deg, #10b981, #059669)'
                : signal.status === 'WAIT'
                ? 'linear-gradient(90deg, #f59e0b, #d97706)'
                : '#9ca3af',
          }}
        />
      </div>

      {!compact && (
        <p className="text-[10px] text-gray-400 leading-snug">
          <span className="font-semibold text-gray-500">Entry:</span> {signal.entryCondition}
        </p>
      )}
    </div>
  );
}
