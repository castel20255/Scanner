import { useEffect, useRef, useCallback, useState } from 'react';

export type TickData = {
  quote: number;
  epoch: number;
  symbol: string;
};

type DerivWSOptions = {
  appId?: string;
};

type SubscriptionState = {
  symbol: string;
  ticks: number[];
  quotes: number[];
};

export function useDerivWS(options: DerivWSOptions = {}) {
  const appId = options.appId || '1089';
  const wsRef = useRef<WebSocket | null>(null);
  const reqId = useRef(1);
  const subIdRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState | null>(null);
  const tickHandlersRef = useRef<((tick: TickData) => void)[]>([]);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const activeSymbolRef = useRef<string | null>(null);

  // Keep activeSymbolRef in sync
  useEffect(() => {
    activeSymbolRef.current = activeSymbol;
  }, [activeSymbol]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${appId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      // Auto-resubscribe if we had an active symbol
      if (activeSymbolRef.current) {
        ws.send(
          JSON.stringify({
            ticks_history: activeSymbolRef.current,
            count: 1000,
            end: 'latest',
            style: 'ticks',
            req_id: reqId.current++,
          })
        );
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      subIdRef.current = null;
      wsRef.current = null;
      // Auto-reconnect after 2 seconds
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, 2000);
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      ws.close();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        if (data.msg_type === 'tick' && data.tick) {
          const tick: TickData = {
            quote: data.tick.quote,
            epoch: data.tick.epoch,
            symbol: data.tick.symbol,
          };
          tickHandlersRef.current.forEach((h) => h(tick));

          // Store subscription ID for later forget
          if (data.subscription) {
            subIdRef.current = data.subscription.id;
          }
        }
        if (data.msg_type === 'history' && data.history) {
          const prices = data.history.prices as number[];
          const currentSymbol = activeSymbolRef.current;
          setSubscriptionState((prev) => ({
            symbol: currentSymbol ?? prev?.symbol ?? '',
            ticks: prices.map((p) => {
              const s = p.toString();
              return parseInt(s[s.length - 1], 10);
            }),
            quotes: prices,
          }));
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && currentSymbol) {
            wsRef.current.send(
              JSON.stringify({
                ticks: currentSymbol,
                subscribe: 1,
                req_id: reqId.current++,
              })
            );
          }
        }
      } catch {
        // ignore parse errors
      }
    };
  }, [appId]);

  const subscribeSymbol = useCallback(
    (symbol: string) => {
      activeSymbolRef.current = symbol;
      setActiveSymbol(symbol);
      setSubscriptionState({ symbol, ticks: [], quotes: [] });

      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        connect();
        return;
      }

      // Unsubscribe previous
      if (subIdRef.current) {
        wsRef.current.send(
          JSON.stringify({
            forget: subIdRef.current,
            req_id: reqId.current++,
          })
        );
        subIdRef.current = null;
      }

      // Get last 1000 ticks history first
      wsRef.current.send(
        JSON.stringify({
          ticks_history: symbol,
          count: 1000,
          end: 'latest',
          style: 'ticks',
          req_id: reqId.current++,
        })
      );
    },
    [connect]
  );

  const onTick = useCallback((handler: (tick: TickData) => void) => {
    tickHandlersRef.current.push(handler);
    return () => {
      tickHandlersRef.current = tickHandlersRef.current.filter((h) => h !== handler);
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Handle incoming live ticks — append digit to subscriptionState
  useEffect(() => {
    const unsub = onTick((tick) => {
      if (tick.symbol !== activeSymbolRef.current) return;
      const s = tick.quote.toString();
      const digit = parseInt(s[s.length - 1], 10);
      setSubscriptionState((prev) => {
        if (!prev) return prev;
        const newTicks = [...prev.ticks, digit].slice(-1000);
        const newQuotes = [...prev.quotes, tick.quote].slice(-1000);
        return { ...prev, ticks: newTicks, quotes: newQuotes };
      });
    });
    return unsub;
  }, [onTick]);

  return {
    isConnected,
    activeSymbol,
    subscriptionState,
    subscribeSymbol,
    onTick,
  };
}

export {};
