import { useState, useEffect, useRef } from 'react';
import { X, Lock, AlertTriangle, ExternalLink, KeyRound, Check } from 'lucide-react';

type ApiTokenModalProps = {
  open: boolean;
  initialToken: string | null;
  onSave: (token: string) => void;
  onClose: () => void;
};

export default function ApiTokenModal({ open, initialToken, onSave, onClose }: ApiTokenModalProps) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setToken(initialToken ?? '');
      setAgreed(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, initialToken]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-3xl overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(15,10,30,0.98), rgba(10,5,25,0.99))',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 25px 80px rgba(0,0,0,0.6), 0 0 60px rgba(214,26,140,0.15)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="relative px-5 py-4 flex items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, rgba(214,26,140,0.3), rgba(142,68,173,0.2))',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #D61A8C, #8E44AD)' }}
            >
              <KeyRound size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-wide">Deriv API Token</h2>
              <p className="text-[10px] text-white/50">Required for live auto-trading</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Warning banner */}
          <div
            className="rounded-2xl p-3 flex items-start gap-2.5"
            style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
          >
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-amber-300 leading-snug">
                Your API token is a trading credential.
              </p>
              <p className="text-[10px] text-amber-200/70 leading-snug">
                It is stored in memory only and never saved or sent to any server. Use a token with
                <strong className="text-amber-300"> trade scope only</strong> — never include withdrawal scope.
              </p>
            </div>
          </div>

          {/* Token input */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-white/50 uppercase tracking-wider">
              API Token
            </label>
            <div className="relative">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Lock size={14} className="text-white/30" />
              </div>
              <input
                ref={inputRef}
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Deriv API token"
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-xl pl-9 pr-20 py-2.5 text-sm font-mono text-white border transition"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderColor: token ? 'rgba(214,26,140,0.4)' : 'rgba(255,255,255,0.12)',
                }}
              />
              <button
                onClick={() => setShowToken((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-white/40 hover:text-white/70 transition"
              >
                {showToken ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          {/* How to get a token */}
          <a
            href="https://app.deriv.com/account/api-token"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-[11px] font-bold text-sky-400 hover:text-sky-300 transition"
          >
            <ExternalLink size={12} />
            Get your API token from Deriv
          </a>

          {/* Agreement checkbox */}
          <button
            onClick={() => setAgreed((v) => !v)}
            className="w-full flex items-start gap-2.5 text-left"
          >
            <div
              className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5 transition"
              style={{
                background: agreed ? 'linear-gradient(135deg, #D61A8C, #8E44AD)' : 'rgba(255,255,255,0.08)',
                border: agreed ? '1px solid transparent' : '1px solid rgba(255,255,255,0.2)',
              }}
            >
              {agreed && <Check size={12} className="text-white" />}
            </div>
            <span className="text-[11px] text-white/60 leading-snug">
              I understand this will execute <strong className="text-white/80">real-money trades</strong> on my
              Deriv account using the configured stake, martingale, take-profit, and stop-loss settings.
            </span>
          </button>

          {/* Action buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-xs font-black text-white/60 border transition active:scale-95"
              style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)' }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (token.trim() && agreed) onSave(token.trim());
              }}
              disabled={!token.trim() || !agreed}
              className="flex-1 py-2.5 rounded-xl text-xs font-black text-white transition active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background:
                  token.trim() && agreed
                    ? 'linear-gradient(135deg, #D61A8C, #8E44AD)'
                    : 'rgba(255,255,255,0.1)',
              }}
            >
              Save Token
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
