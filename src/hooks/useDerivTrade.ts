import { useState, useRef, useCallback, useEffect } from 'react';
import { useDerivWS } from './useDerivWS';
import { supabase, TradeJournalRow } from '../lib/supabase';

export type FallbackStep = {
  contractType: string;
  prediction?: number;
  strategyLabel: string;
};

export type TradeConfig = {
  stake: number;
  martingale: number;
  takeProfit: number;
  stopLoss: number;
  symbol: string;
  contractType: string;
  prediction?: number;
  strategyLabel: string;
  fallbackChain?: FallbackStep[];
  lossThreshold?: number;
};

export type TradeResult = {
  contractId: string;
  profit: number;
  won: boolean;
  entrySpot: string;
  exitSpot: string;
  timestamp: number;
  contractType: string;
  strategyLabel: string;
  prediction: number | undefined;
  recoveryMode: boolean;
  recoveryStep: number;
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
  recoveryMode: boolean;
  recoveryStep: number;
  currentStrategyLabel: string;
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
  recoveryMode: false,
  recoveryStep: 0,
  currentStrategyLabel: '',
};

export function useDerivTrade(ws: ReturnType<typeof useDerivWS>) {
  const [state, setState] = useState<TradeState>(initialState);
  const tokenRef = useRef<string | null>(null);
  const configRef = useRef<TradeConfig | null>(null);
  const runningRef = useRef(false);
  const recoveryStepRef = useRef(0);
  const proposalIdRef = useRef<string | null>(null);
  const contractSubIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef<string>('');
  const lossCountRef = useRef(0);

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

        const unsub = ws.onMessage(key, (data) => {
          if (resolved) return;
          if (predicate(data)) {
            resolved = true;
            unsub();
            if (timeout) clearTimeout(timeout);
            resolve(data);
          }
        });

        timeout = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          unsub();
          resolve(null);
        }, timeoutMs);
      }),
    [ws]
  );

  const logTrade = useCallback(async (result: TradeResult, balanceAfter: number | null) => {
    const row: TradeJournalRow = {
      session_id: sessionIdRef.current,
      symbol: configRef.current?.symbol ?? '',
      contract_type: result.contractType,
      strategy_label: result.strategyLabel,
      prediction: result.prediction ?? null,
      stake: configRef.current?.stake ?? 0,
      payout: result.profit,
      won: result.won,
      entry_spot: result.entrySpot || null,
      exit_spot: result.exitSpot || null,
      recovery_mode: result.recoveryMode,
      recovery_step: result.recoveryStep,
      balance_after: balanceAfter,
    };
    try {
      await supabase.from('trade_journals').insert(row);
    } catch {
      // Journal write failure should not stop trading
    }
  }, []);

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
      const lossThreshold = cfg.lossThreshold ?? 1;
      const fallback = cfg.fallbackChain ?? [];

      // Determine which step we're on
      const step = recoveryStepRef.current;
      let contractType: string;
      let prediction: number | undefined;
      let strategyLabel: string;
      let recoveryMode = false;

      if (step === 0) {
        contractType = cfg.contractType;
        prediction = cfg.prediction;
        strategyLabel = cfg.strategyLabel;
      } else {
        const fb = fallback[Math.min(step - 1, fallback.length - 1)];
        contractType = fb.contractType;
        prediction = fb.prediction;
        strategyLabel = fb.strategyLabel;
        recoveryMode = true;
      }

      setState((s) => ({
        ...s,
        status: 'proposing',
        recoveryMode,
        recoveryStep: step,
        currentStrategyLabel: strategyLabel,
      }));

      // 2. Proposal
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
        (d) => {
          if (d.msg_type === 'proposal_open_contract') {
            const sub = (d as { subscription?: { id: string } }).subscription;
            if (sub?.id) contractSubIdRef.current = sub.id;
            const poc = (d as { proposal_open_contract?: { is_sold: number } }).proposal_open_contract;
            return poc?.is_sold === 1;
          }
          return false;
        },
        60000
      );
      if (contractSubIdRef.current) {
        wsSend({ forget: contractSubIdRef.current });
        contractSubIdRef.current = null;
      }
      if (!settledData) {
        setState((s) => ({ ...s, error: 'Contract monitoring timed out', status: 'stopped' }));
        runningRef.current = false;
        return;
      }
      const contract = (settledData as { proposal_open_contract?: { profit: number; entry_spot: string; exit_spot: string; balance_after: number } }).proposal_open_contract;
      if (!contract) {
        setState((s) => ({ ...s, error: 'No contract data on settlement', status: 'stopped' }));
        runningRef.current = false;
        return;
      }

      const profit = contract.profit;
      const won = profit > 0;
      const balanceAfter = (contract as { balance_after?: number }).balance_after ?? null;
      const result: TradeResult = {
        contractId,
        profit,
        won,
        entrySpot: contract.entry_spot ?? '',
        exitSpot: contract.exit_spot ?? '',
        timestamp: Date.now(),
        contractType,
        strategyLabel,
        prediction,
        recoveryMode,
        recoveryStep: step,
      };

      // Log to Supabase journal (fire-and-forget)
      logTrade(result, balanceAfter);

      // 5. Loop logic
      if (won) {
        recoveryStepRef.current = 0;
        lossCountRef.current = 0;
      } else {
        lossCountRef.current += 1;
        if (lossCountRef.current >= lossThreshold && fallback.length > 0) {
          recoveryStepRef.current = Math.min(step + 1, fallback.length);
        }
      }

      setState((s) => {
        const newTotalProfit = s.totalProfit + profit;
        const newLossCount = won ? 0 : lossCountRef.current;
        const newStake = won ? configRef.current!.stake : s.currentStake * configRef.current!.martingale;
        const newHistory = [result, ...s.tradeHistory].slice(0, 50);

        const newRecoveryStep = won ? 0 : recoveryStepRef.current;
        const newRecoveryMode = newRecoveryStep > 0;

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
            recoveryMode: newRecoveryMode,
            recoveryStep: newRecoveryStep,
            currentStrategyLabel: strategyLabel,
            balance: balanceAfter ?? s.balance,
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
            recoveryMode: newRecoveryMode,
            recoveryStep: newRecoveryStep,
            currentStrategyLabel: strategyLabel,
            balance: balanceAfter ?? s.balance,
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
          recoveryMode: newRecoveryMode,
          recoveryStep: newRecoveryStep,
          currentStrategyLabel: strategyLabel,
          balance: balanceAfter ?? s.balance,
        };
      });

      if (!runningRef.current) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!runningRef.current) {
      setState((s) => (s.status === 'stopped' ? s : { ...s, status: 'stopped' }));
    }
  }, [ws, waitForMessage, logTrade]);

  const startTrade = useCallback(
    (config: TradeConfig, token: string | null) => {
      tokenRef.current = token;
      configRef.current = config;
      recoveryStepRef.current = 0;
      sessionIdRef.current = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      runningRef.current = true;
      setState({
        ...initialState,
        status: 'authorizing',
        currentStake: config.stake,
        currentStrategyLabel: config.strategyLabel,
      });
      runTradeCycle();
    },
    [runTradeCycle]
  );

  const reset = useCallback(() => {
    runningRef.current = false;
    recoveryStepRef.current = 0;
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

  return { state, startTrade, stop, reset, setToken, sessionId: sessionIdRef };
}
