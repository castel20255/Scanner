import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Trash2, TrendingUp, TrendingDown, History } from 'lucide-react';
import { supabase, TradeJournalRow } from '../lib/supabase';

type JournalStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  bestStreak: number;
  worstStreak: number;
  currentStreak: number;
};

function computeStats(rows: TradeJournalRow[]): JournalStats {
  let wins = 0, losses = 0, totalProfit = 0;
  let bestStreak = 0, worstStreak = 0, currentStreak = 0;
  let currentType: 'win' | 'loss' | null = null;

  const sorted = [...rows].sort((a, b) =>
    new Date(a.created_at ?? '').getTime() - new Date(b.created_at ?? '').getTime()
  );

  for (const r of sorted) {
    if (r.won) {
      wins++;
      totalProfit += r.payout;
      if (currentType === 'win') currentStreak++;
      else { currentType = 'win'; currentStreak = 1; }
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      losses++;
      totalProfit += r.payout;
      if (currentType === 'loss') currentStreak++;
      else { currentType = 'loss'; currentStreak = 1; }
      worstStreak = Math.max(worstStreak, currentStreak);
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  // Current streak at the end
  const last = sorted[sorted.length - 1];
  if (last) {
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].won === last.won) streak++;
      else break;
    }
    currentStreak = streak;
  }

  return { totalTrades, wins, losses, winRate, totalProfit, bestStreak, worstStreak, currentStreak };
}

export default function TradeJournal() {
  const [rows, setRows] = useState<TradeJournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'wins' | 'losses' | 'recovery'>('all');

  const fetchJournals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fetchError } = await supabase
        .from('trade_journals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (fetchError) throw fetchError;
      setRows((data ?? []) as TradeJournalRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load journal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJournals(); }, [fetchJournals]);

  const clearAll = useCallback(async () => {
    try {
      const { error: delError } = await supabase.from('trade_journals').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      if (delError) throw delError;
      setRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear journal');
    }
  }, []);

  const stats = computeStats(rows);

  const filtered = rows.filter(r => {
    if (filter === 'wins') return r.won;
    if (filter === 'losses') return !r.won;
    if (filter === 'recovery') return r.recovery_mode;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 py-2">
        <History size={12} className="text-[#D61A8C]" />
        <span className="text-[10px] font-black text-white uppercase tracking-wider">Trade Journal</span>
        <div className="flex-1" />
        <button onClick={fetchJournals}
          className="text-[9px] font-bold px-2 py-1.5 rounded-lg border transition hover:bg-white/8 text-white/50 flex items-center gap-1"
          style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        <button onClick={() => { if (confirm('Clear all journal entries?')) clearAll(); }}
          className="text-[9px] font-bold px-2 py-1.5 rounded-lg border transition hover:bg-red-500/10 text-red-400/70 flex items-center gap-1"
          style={{ borderColor: 'rgba(239,68,68,0.2)' }}>
          <Trash2 size={10} /> Clear
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-1.5 px-1 pb-2">
        <StatCard label="Trades" value={String(stats.totalTrades)} color="#fff" />
        <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? '#10b981' : '#ef4444'} />
        <StatCard label="Profit" value={`$${stats.totalProfit.toFixed(2)}`} color={stats.totalProfit >= 0 ? '#10b981' : '#ef4444'} />
        <StatCard label="Streak" value={`${stats.currentStreak}`} color="#f59e0b" />
      </div>

      {/* Filter buttons */}
      <div className="flex gap-1.5 px-1 pb-2">
        {(['all', 'wins', 'losses', 'recovery'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="text-[8px] font-black px-2.5 py-1 rounded-full transition uppercase tracking-wider"
            style={{
              background: filter === f ? 'rgba(214,26,140,0.2)' : 'rgba(255,255,255,0.04)',
              color: filter === f ? '#fff' : 'rgba(255,255,255,0.35)',
              border: filter === f ? '1px solid rgba(214,26,140,0.5)' : '1px solid rgba(255,255,255,0.07)',
            }}>
            {f === 'recovery' ? 'Recovery' : f}
          </button>
        ))}
      </div>

      {/* Journal entries */}
      <div className="flex-1 overflow-y-auto px-1 space-y-1.5">
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-white/30">
            <div className="w-3 h-3 rounded-full border-2 border-white/20 border-t-white/60 animate-spin" />
            <span className="text-[10px]">Loading journal…</span>
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-red-400/60 text-[10px]">{error}</div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-white/25">
            <History size={28} className="mb-2 opacity-30" />
            <p className="text-[11px]">No trades logged yet</p>
            <p className="text-[9px] mt-1">Trades will appear here after running a bot</p>
          </div>
        )}

        {!loading && !error && filtered.map((r) => (
          <div key={r.id} className="rounded-lg px-2.5 py-2 flex items-center gap-2"
            style={{
              background: r.recovery_mode ? 'rgba(245,158,11,0.06)' : 'rgba(255,255,255,0.025)',
              border: `1px solid ${r.recovery_mode ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)'}`,
            }}>
            {/* Win/Loss icon */}
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: r.won ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                border: `1px solid ${r.won ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              }}>
              {r.won
                ? <TrendingUp size={12} className="text-green-400" />
                : <TrendingDown size={12} className="text-red-400" />}
            </div>

            {/* Details */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-bold text-white">{r.symbol}</span>
                <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: r.recovery_mode ? 'rgba(245,158,11,0.15)' : 'rgba(214,26,140,0.12)',
                    color: r.recovery_mode ? '#f59e0b' : '#D61A8C',
                  }}>
                  {r.recovery_mode ? `REC ${r.recovery_step}` : r.strategy_label}
                </span>
                {r.prediction !== null && (
                  <span className="text-[8px] text-white/40">Digit {r.prediction}</span>
                )}
              </div>
              <div className="text-[8px] text-white/30 mt-0.5">
                {r.contract_type} · {new Date(r.created_at ?? '').toLocaleTimeString()}
              </div>
            </div>

            {/* P&L */}
            <div className="text-right shrink-0">
              <div className="text-[10px] font-black"
                style={{ color: r.won ? '#10b981' : '#ef4444' }}>
                {r.payout >= 0 ? '+' : ''}{r.payout.toFixed(2)}
              </div>
              <div className="text-[7px] text-white/25">${r.stake} stake</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg p-1.5 text-center"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[7px] font-bold text-white/30 uppercase tracking-wider">{label}</div>
      <div className="text-[11px] font-black mt-0.5" style={{ color }}>{value}</div>
    </div>
  );
}
