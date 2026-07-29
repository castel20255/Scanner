import { useState, useRef, useCallback, useEffect } from 'react';
import { useDerivWS } from './useDerivWS';

export type TradeConfig = {
  stake: number;
  martingale: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
  contractType: string;
  prediction?: number;
  recovery?: {
    lossThreshold: number;
    altContractType: string;
  };
};

export type TradeResult = {
  contractId: string;
  profit: number;
  won: boolean;
  entrySpot: string;
  exitSpot: string;
  timestamp: number;
};

export type TradeState = {
  status: 'idle' | 'authorizing' | 'proposing' | 'buying' | 'monitoring' | 'settled' | 'stopped';
  contractId: string | null;
  currentStake: number;
  totalProfit: number;
  lossCount: number;
  tradeHistory: TradeResult[];
  error: string | null;
  balance: number | null;
  currency: string | null;
};

const initialState: TradeState = {
  status: 'idle',
  contractId: null,
  currentStake: 0,
  totalProfit: 0,
  lossCount: 0,
  tradeHistory: [],
  error: null,
  balance: null,
  currency: null,
};

export function useDerivTrade(ws: ReturnType<typeof useDerivWS>) {
  const [state, setState] = useState<TradeState>(initialState);
  const tokenRef = useRef<string | null>(null);
  const configRef = useRef<TradeConfig | null>(null);
  const runningRef = useRef(false);
  const recoveryActiveRef = useRef(false);
  const proposalIdRef = useRef<string | null>(null);
  const contractSubIdRef = useRef<string | null>(null);

  const setToken = useCallback((token: string | null) => {
    tokenRef.current = token;
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    if (contractSubIdRef.current && ws.send) {
      ws.send({ forget: contractSubIdRef.current });
    }
    contractSubIdRef.current = null;
    setState((s) => ({ ...s, status: 'stopped' }));
  }, [ws]);

  const waitForMessage = useCallback(
    (predicate: (data: Record<string, unknown>) => boolean, timeoutMs = 15000) =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        let resolved = false;
        const key = `trade_wait_${Math.random()}`;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timeout) clearTimeout(timeout);
          ws.onMessage(key, () => {});
        };

        timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve(null);
        }, timeoutMs);

        ws.onMessage(key, (data) => {
          if (resolved) return;
          if (predicate(data)) {
            resolved = true;
            cleanup();
            resolve(data);
          }
        });
      }),
    [ws]
  );

  const runTradeCycle = useCallback(async () => {
    const config = configRef.current;
    if (!config || !runningRef.current) return;

    const wsSend = ws.send;
    if (!wsSend) {
      setState((s) => ({ ...s, error: 'WebSocket not connected' }));
      return;
    }

    // 1. Authorize
    if (tokenRef.current) {
      setState((s) => ({ ...s, status: 'authorizing', error: null }));
      wsSend({ authorize: tokenRef.current });
      const authData = await waitForMessage((d) => d.msg_type === 'authorize', 10000);
      if (!authData || (authData as { error?: unknown }).error) {
        setState((s) => ({ ...s, error: 'Authorization failed. Check your API token.', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const auth = (authData as { authorize?: { balance: number; currency: string } }).authorize;
      if (auth) {
        setState((s) => ({ ...s, balance: auth.balance, currency: auth.currency }));
      }
    }

    while (runningRef.current && configRef.current) {
      const cfg = configRef.current;
      const useRecovery = recoveryActiveRef.current && cfg.recovery;
      const contractType = useRecovery ? cfg.recovery!.altContractType : cfg.contractType;
      const prediction = useRecovery ? undefined : cfg.prediction;

      // 2. Proposal
      setState((s) => ({ ...s, status: 'proposing' }));
      const proposalReq: Record<string, unknown> = {
        proposal: 1,
        amount: cfg.stake,
        basis: 'stake',
        contract_type: contractType,
        currency: 'USD',
        duration: 1,
        duration_unit: 't',
        symbol: cfg.symbol,
      };
      if (prediction !== undefined) {
        proposalReq.prediction = prediction;
      }
      wsSend(proposalReq);
      const propData = await waitForMessage((d) => d.msg_type === 'proposal');
      if (!propData || (propData as { error?: unknown }).error) {
        setState((s) => ({ ...s, error: 'Failed to get proposal. Check symbol/contract type.', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const proposal = (propData as { proposal?: { id: string; ask_price: number } }).proposal;
      if (!proposal) {
        setState((s) => ({ ...s, error: 'No proposal returned', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      proposalIdRef.current = proposal.id;

      // 3. Buy
      if (!runningRef.current) break;
      setState((s) => ({ ...s, status: 'buying' }));
      wsSend({ buy: proposal.id, price: proposal.ask_price });
      const buyData = await waitForMessage((d) => d.msg_type === 'buy');
      if (!buyData || (buyData as { error?: unknown }).error) {
        setState((s) => ({ ...s, error: 'Buy failed. Insufficient balance or market closed.', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const buy = (buyData as { buy?: { contract_id: string } }).buy;
      if (!buy) {
        setState((s) => ({ ...s, error: 'No contract returned from buy', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const contractId = String(buy.contract_id);
      setState((s) => ({ ...s, status: 'monitoring', contractId }));

      // 4. Monitor
      wsSend({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
      const settledData = await waitForMessage(
        (d) => d.msg_type === 'proposal_open_contract' && (d as { proposal_open_contract?: { is_sold: number } }).proposal_open_contract?.is_sold === 1,
        60000
      );
      if (contractSubIdRef.current && wsSend) {
        wsSend({ forget: contractSubIdRef.current });
        contractSubIdRef.current = null;
      }
      if (!settledData) {
        setState((s) => ({ ...s, error: 'Contract monitoring timed out', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const contract = (settledData as { proposal_open_contract?: { profit: number; entry_spot: string; exit_spot: string } }).proposal_open_contract;
      if (!contract) {
        setState((s) => ({ ...s, error: 'No contract data on settlement', status: 'stopped' }));
        runningRef.current = false;
        return;
      }

      const profit = contract.profit;
      const won = profit > 0;
      const result: TradeResult = {
        contractId,
        profit,
        won,
        entrySpot: contract.entry_spot ?? '',
        exitSpot: contract.exit_spot ?? '',
        timestamp: Date.now(),
      };

      // 5. Loop logic
      setState((s) => {
        const newTotalProfit = s.totalProfit + profit;
        const newLossCount = won ? 0 : s.lossCount + 1;
        const newStake = won ? configRef.current!.stake : s.currentStake * configRef.current!.martingale;
        const newHistory = [result, ...s.tradeHistory].slice(0, 20);

        // Recovery mode check
        if (configRef.current?.recovery && newLossCount >= configRef.current.recovery.lossThreshold) {
          recoveryActiveRef.current = true;
        }
        if (won) recoveryActiveRef.current = false;

        // Stop conditions
        if (newTotalProfit >= configRef.current!.takeProfit) {
          runningRef.current = false;
          return {
            ...s,
            status: 'stopped',
            totalProfit: newTotalProfit,
            lossCount: newLossCount,
            currentStake: newStake,
            tradeHistory: newHistory,
            contractId: null,
          };
        }
        if (newLossCount >= configRef.current!.stopLoss) {
          runningRef.current = false;
          return {
            ...s,
            status: 'stopped',
            totalProfit: newTotalProfit,
            lossCount: newLossCount,
            currentStake: newStake,
            tradeHistory: newHistory,
            contractId: null,
          };
        }

        return {
          ...s,
          status: 'settled',
          totalProfit: newTotalProfit,
          lossCount: newLossCount,
          currentStake: newStake,
          tradeHistory: newHistory,
          contractId: null,
        };
      });

      if (!runningRef.current) break;
      // Brief pause before next trade
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!runningRef.current) {
      setState((s) => (s.status === 'stopped' ? s : { ...s, status: 'stopped' }));
    }
  }, [ws, waitForMessage]);

  const startTrade = useCallback(
    (config: TradeConfig, token: string | null) => {
      tokenRef.current = token;
      configRef.current = config;
      recoveryActiveRef.current = false;
      runningRef.current = true;
      setState({
        ...initialState,
        status: 'authorizing',
        currentStake: config.stake,
      });
      runTradeCycle();
    },
    [runTradeCycle]
  );

  const reset = useCallback(() => {
    runningRef.current = false;
    recoveryActiveRef.current = false;
    configRef.current = null;
    if (contractSubIdRef.current && ws.send) {
      ws.send({ forget: contractSubIdRef.current });
    }
    contractSubIdRef.current = null;
    setState(initialState);
  }, [ws]);

  useEffect(() => {
    return () => {
      runningRef.current = false;
    };
  }, []);

  return { state, startTrade, stop, reset, setToken };
}
