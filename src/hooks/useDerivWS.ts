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

type MessageHandler = (data: Record<string, unknown>) => void;

export function useDerivWS(options: DerivWSOptions = {}) {
  const appId = options.appId || '1089';
  const wsRef = useRef<WebSocket | null>(null);
  const reqId = useRef(1);
  const subIdRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [subscriptionState, setSubscriptionState] = useState<SubscriptionState | null>(null);
  const tickHandlersRef = useRef<((tick: TickData) => void)[]>([]);
  const messageHandlersRef = useRef<Map<string, MessageHandler>>(new Map());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const activeSymbolRef = useRef<string | null>(null);

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
        const data = JSON.parse(event.data) as Record<string, unknown>;
        if (data.msg_type === 'tick' && data.tick) {
          const tick = data.tick as { quote: number; epoch: number; symbol: string };
          const tickData: TickData = {
            quote: tick.quote,
            epoch: tick.epoch,
            symbol: tick.symbol,
          };
          tickHandlersRef.current.forEach((h) => h(tickData));
          if (data.subscription) {
            subIdRef.current = (data.subscription as { id: string }).id;
          }
        }
        if (data.msg_type === 'history' && data.history) {
          const prices = (data.history as { prices: number[] }).prices;
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
        // Dispatch to registered message handlers
        const msgType = data.msg_type as string | undefined;
        if (msgType) {
          messageHandlersRef.current.forEach((h) => h(data));
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

      if (subIdRef.current) {
        wsRef.current.send(
          JSON.stringify({
            forget: subIdRef.current,
            req_id: reqId.current++,
          })
        );
        subIdRef.current = null;
      }

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

  const onMessage = useCallback((key: string, handler: MessageHandler) => {
    messageHandlersRef.current.set(key, handler);
    return () => {
      messageHandlersRef.current.delete(key);
    };
  }, []);

  const send = useCallback((payload: Record<string, unknown>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify({ ...payload, req_id: reqId.current++ }));
    return true;
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
    onMessage,
    send,
  };
}

export {};
