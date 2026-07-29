import { useEffect, useCallback, useRef } from 'react';

export type BotConfig = {
  stake: number;
  martingale: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
  contractType: string;
  prediction?: number;
  strategyLabel: string;
  fallbackChain?: { contractType: string; prediction?: number; strategyLabel: string }[];
  lossThreshold?: number;
};

export type IframeStatus = {
  status: string;
  totalProfit: number;
  lossCount: number;
  tradeCount: number;
  balance: number | null;
  currency: string | null;
  error: string | null;
  loadedBot: string | null;
  message?: string;
};

export type IframeInbound =
  | { type: 'setToken'; token: string }
  | { type: 'loadBot'; xml?: string; config?: Partial<BotConfig> }
  | { type: 'runBot' }
  | { type: 'stopBot' }
  | { type: 'getStatus' };

export type IframeOutbound =
  | { type: 'status'; status: IframeStatus }
  | { type: 'loaded'; botName: string }
  | { type: 'started' }
  | { type: 'stopped' }
  | { type: 'error'; message: string }
  | { type: 'tradeComplete'; result: { won: boolean; profit: number } };

type Handlers = {
  onSetToken: (token: string) => void;
  onLoadBot: (xml?: string, config?: Partial<BotConfig>) => void;
  onRunBot: () => void;
  onStopBot: () => void;
  getStatus: () => IframeStatus;
};

function postToParent(msg: IframeOutbound) {
  try {
    window.parent.postMessage(msg, '*');
  } catch {
    // Cross-origin blocked — ignore
  }
}

export function useIframeBridge(handlers: Handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const sendStatus = useCallback(() => {
    postToParent({ type: 'status', status: handlersRef.current.getStatus() });
  }, []);

  useEffect(() => {
    // Parse URL params for token (e.g. ?token=xxx)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      handlersRef.current.onSetToken(urlToken);
    }

    const onMessage = (e: MessageEvent) => {
      const data = e.data as IframeInbound;
      if (!data || typeof data !== 'object' || !('type' in data)) return;
      const h = handlersRef.current;
      switch (data.type) {
        case 'setToken':
          if (data.token) h.onSetToken(data.token);
          break;
        case 'loadBot':
          h.onLoadBot(data.xml, data.config);
          break;
        case 'runBot':
          h.onRunBot();
          break;
        case 'stopBot':
          h.onStopBot();
          break;
        case 'getStatus':
          sendStatus();
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [sendStatus]);

  return { sendStatus, postToParent };
}

// Parse a Deriv bot XML to extract config
export function parseBotXML(xml: string): Partial<BotConfig> & { botName?: string } {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const config: Partial<BotConfig> & { botName?: string } = {};

    // Extract symbol from TRADE_OPTIONS > trade_definition_market > SYMBOL_LIST
    const symbolEl = doc.querySelector('field[name="SYMBOL_LIST"]');
    if (symbolEl?.textContent) config.symbol = symbolEl.textContent;

    // Extract trade type from TRADETYPE_LIST
    const tradeTypeEl = doc.querySelector('field[name="TRADETYPE_LIST"]');
    const tradeTypeCatEl = doc.querySelector('field[name="TRADETYPECAT_LIST"]');
    if (tradeTypeEl?.textContent) {
      const tt = tradeTypeEl.textContent;
      const cat = tradeTypeCatEl?.textContent ?? 'digits';
      if (tt === 'evenodd') config.contractType = 'DIGITEVEN';
      else if (tt === 'overunder') config.contractType = 'DIGITOVER';
      else if (tt === 'matchesdiffers') config.contractType = 'DIGITMATCH';
      else if (tt === 'risefall' && cat === 'callput') config.contractType = 'CALL';
    }

    // Extract stake, take profit, stop loss, martingale from variables
    const variables = doc.querySelectorAll('variable');
    const varMap: Record<string, string> = {};
    variables.forEach(v => {
      const id = v.getAttribute('id') ?? '';
      const text = v.textContent ?? '';
      varMap[id] = text;
    });

    // Look for math_number blocks that set initial values
    const numBlocks = doc.querySelectorAll('block[type="math_number"]');
    const numValues: number[] = [];
    numBlocks.forEach(b => {
      const field = b.querySelector('field[name="NUM"]');
      if (field?.textContent) numValues.push(parseFloat(field.textContent));
    });

    // Try to map based on variable IDs
    if (varMap['v_init_stake'] || varMap['v_stake']) {
      // Find the first math_number that sets stake
      if (numValues[0] !== undefined) config.stake = numValues[0];
    }
    if (numValues.length >= 2) config.martingale = numValues[1] ?? 2;
    if (numValues.length >= 3) config.takeProfit = numValues[2] ?? 10;
    if (numValues.length >= 4) config.stopLoss = numValues[3] ?? 5;

    config.botName = `Imported Bot ${new Date().toLocaleTimeString()}`;
    return config;
  } catch {
    return { botName: 'Invalid XML' };
  }
}
