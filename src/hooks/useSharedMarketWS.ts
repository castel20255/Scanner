import { useState, useEffect, useRef, useCallback } from 'react';
import { analyzeMultiWindow, MultiWindowAnalysis } from '../lib/analysis';

export type MarketState = {
  symbol: string;
  ticks: number[];
  quotes: number[];
  lastPrice: number | null;
  lastDigit: number | null;
  mwa: MultiWindowAnalysis | null;
};

const APP_ID = '1089';

export function useSharedMarketWS(symbols: string[]) {
  const wsRef = useRef<WebSocket | null>(null);
  const reqId = useRef(1);
  const subIds = useRef<Map<string, string>>(new Map());
  const mountedRef = useRef(true);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const symbolsRef = useRef<string[]>(symbols);

  const [isConnected, setIsConnected] = useState(false);
  const [markets, setMarkets] = useState<Map<string, MarketState>>(() => {
    const m = new Map<string, MarketState>();
    for (const s of symbols)
      m.set(s, { symbol: s, ticks: [], quotes: [], lastPrice: null, lastDigit: null, mwa: null });
    return m;
  });

  useEffect(() => { symbolsRef.current = symbols; }, [symbols.join(',')]);

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
          const ticks = prices.map((p: number) => { const s = p.toString(); return parseInt(s[s.length - 1], 10); });
          const mwa = analyzeMultiWindow(ticks, prices);
          setMarkets(prev => {
            const next = new Map(prev);
            next.set(sym, { symbol: sym, ticks, quotes: prices, mwa,
              lastPrice: prices[prices.length - 1] ?? null, lastDigit: ticks[ticks.length - 1] ?? null });
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
            const newTicks = [...ex.ticks, digit].slice(-1000);
            const newQuotes = [...ex.quotes, quote].slice(-1000);
            const mwa = analyzeMultiWindow(newTicks, newQuotes);
            next.set(sym, { ...ex, ticks: newTicks, quotes: newQuotes, mwa, lastPrice: quote, lastDigit: digit });
            return next;
          });
        }
      } catch { /* ignore */ }
    };
  }, [fetchHistory]);

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
