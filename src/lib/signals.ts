import { AnalysisResult, MultiWindowAnalysis } from './analysis';

export type SignalStatus = 'TRADE NOW' | 'WAIT' | 'NEUTRAL';
export type SignalWindow = '1000' | '120' | '15';
export type SignalType =
  | 'even_odd'
  | 'over_under'
  | 'matches'
  | 'differs'
  | 'rise_fall'
  | 'pro_even_odd'
  | 'pro_over_under'
  | 'pro_differs'
  | 'under_7'
  | 'over_2';

export type Signal = {
  type: SignalType;
  label: string;
  status: SignalStatus;
  probability: number;
  recommendation: string;
  entryCondition: string;
  targetDigit?: number;
  entryDigits?: number[]; // selectable entry digits for Over/Under signals
  tradeDirection?: string;
  window?: SignalWindow;
  windowsAligned?: boolean;
};

// ─── Combined multi-window ranked signals ──────────────────────────────────────

export function generateCombinedRankedSignals(mwa: MultiWindowAnalysis, allowedTypes: SignalType[]): Signal[] {
  const make = (a: AnalysisResult, w: SignalWindow): Signal[] => {
    const std = generateSignals(a).map(s => ({ ...s, window: w }));
    const pro = generateProSignals(a).map(s => ({ ...s, window: w }));
    return [...std, ...pro];
  };

  const all1000 = make(mwa.w1000, '1000');
  const all120 = make(mwa.w120, '120');
  const all15 = make(mwa.w15, '15');

  // For each signal type, check if all 3 windows agree (same direction, non-neutral)
  const merged = new Map<string, Signal>();

  for (const sig of [...all1000, ...all120, ...all15]) {
    if (!allowedTypes.includes(sig.type)) continue;
    const key = `${sig.type}__${sig.tradeDirection ?? ''}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...sig });
    } else {
      // Take highest probability across windows, mark if aligned
      if (sig.probability > existing.probability) {
        merged.set(key, { ...sig, windowsAligned: existing.windowsAligned });
      }
    }
  }

  // Mark signals as aligned if all 3 windows have same type+direction non-neutral
  const signalsByKey = new Map<string, Signal[]>();
  for (const sig of [...all1000, ...all120, ...all15]) {
    if (!allowedTypes.includes(sig.type)) continue;
    const key = `${sig.type}__${sig.tradeDirection ?? ''}`;
    const arr = signalsByKey.get(key) ?? [];
    arr.push(sig);
    signalsByKey.set(key, arr);
  }

  for (const [key, sigs] of signalsByKey.entries()) {
    const nonNeutral = sigs.filter(s => s.status !== 'NEUTRAL');
    const aligned = nonNeutral.length >= 3;
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, windowsAligned: aligned });
    }
  }

  const results = Array.from(merged.values())
    .filter(s => s.status !== 'NEUTRAL')
    .sort((a, b) => {
      // Aligned signals float to top, then by probability
      if (a.windowsAligned && !b.windowsAligned) return -1;
      if (!a.windowsAligned && b.windowsAligned) return 1;
      if (a.status === 'TRADE NOW' && b.status !== 'TRADE NOW') return -1;
      if (a.status !== 'TRADE NOW' && b.status === 'TRADE NOW') return 1;
      return b.probability - a.probability;
    });

  return results;
}

// ─── Standard Signals ─────────────────────────────────────────────────────────

export function generateSignals(a: AnalysisResult): Signal[] {
  return [
    evenOddSignal(a),
    overUnderSignal(a),
    matchesSignal(a),
    differsSignal(a),
    riseFallSignal(a),
  ];
}

function evenOddSignal(a: AnalysisResult): Signal {
  const { evenPercentage, oddPercentage } = a;
  const max = Math.max(evenPercentage, oddPercentage);
  const favored = evenPercentage >= oddPercentage ? 'EVEN' : 'ODD';
  const opposite = favored === 'EVEN' ? 'ODD' : 'EVEN';

  const last = a.last20;
  let consecutive = 0;
  for (let i = last.length - 1; i >= 0; i--) {
    const isOpposite = favored === 'EVEN' ? last[i] % 2 !== 0 : last[i] % 2 === 0;
    if (isOpposite) consecutive++;
    else break;
  }

  if (max >= 55) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'TRADE NOW',
      probability: max,
      recommendation: `Strong ${favored} bias detected (${max.toFixed(1)}%)`,
      entryCondition: `Wait for 2+ consecutive ${opposite} digits, then trade ${favored}`,
      tradeDirection: favored,
    };
  } else if (max >= 52) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'WAIT',
      probability: max,
      recommendation: `Moderate ${favored} bias (${max.toFixed(1)}%)`,
      entryCondition: 'Monitor for stronger signal',
      tradeDirection: favored,
    };
  }
  return {
    type: 'even_odd',
    label: 'Even / Odd',
    status: 'NEUTRAL',
    probability: max,
    recommendation: 'No clear even/odd pattern',
    entryCondition: 'Wait for clearer bias',
  };
}

function overUnderSignal(a: AnalysisResult): Signal {
  const { highPercentage, lowPercentage, powerIndex } = a;
  const max = Math.max(highPercentage, lowPercentage);
  const favored = highPercentage >= lowPercentage ? 'OVER 4.5' : 'UNDER 4.5';

  if (max >= 56 && powerIndex.gap >= 10) {
    return {
      type: 'over_under',
      label: 'Over / Under',
      status: 'TRADE NOW',
      probability: max,
      recommendation: `Strong ${favored} bias (${max.toFixed(1)}%, gap: ${powerIndex.gap.toFixed(1)}%)`,
      entryCondition: `Trade when digit ${powerIndex.strongest} appears`,
      targetDigit: powerIndex.strongest,
      tradeDirection: favored,
    };
  } else if (max >= 53) {
    return {
      type: 'over_under',
      label: 'Over / Under',
      status: 'WAIT',
      probability: max,
      recommendation: `Moderate ${favored} bias (${max.toFixed(1)}%)`,
      entryCondition: 'Wait for power gap to increase',
      tradeDirection: favored,
    };
  }
  return {
    type: 'over_under',
    label: 'Over / Under',
    status: 'NEUTRAL',
    probability: max,
    recommendation: 'No clear high/low pattern',
    entryCondition: 'Insufficient data',
  };
}

function matchesSignal(a: AnalysisResult): Signal {
  const { powerIndex, digitFrequencies } = a;
  const strongest = powerIndex.strongest;
  const strongestPct = digitFrequencies[strongest].percentage;

  if (strongestPct >= 15) {
    return {
      type: 'matches',
      label: 'Matches',
      status: 'TRADE NOW',
      probability: Math.min(strongestPct * 5, 95),
      recommendation: `Digit ${strongest} has strong power at ${strongestPct.toFixed(1)}%`,
      entryCondition: `Trade MATCHES on digit ${strongest} immediately when it appears`,
      targetDigit: strongest,
      tradeDirection: `MATCHES ${strongest}`,
    };
  } else if (strongestPct >= 12) {
    return {
      type: 'matches',
      label: 'Matches',
      status: 'WAIT',
      probability: strongestPct * 5,
      recommendation: `Digit ${strongest} showing moderate frequency (${strongestPct.toFixed(1)}%)`,
      entryCondition: 'Wait for frequency to increase above 15%',
      targetDigit: strongest,
    };
  }
  return {
    type: 'matches',
    label: 'Matches',
    status: 'NEUTRAL',
    probability: strongestPct * 5,
    recommendation: 'No dominant digit pattern',
    entryCondition: 'Insufficient pattern strength',
  };
}

function differsSignal(a: AnalysisResult): Signal {
  const { digitFrequencies } = a;
  const least = digitFrequencies.reduce((prev, cur) => (cur.percentage < prev.percentage ? cur : prev));

  if (least.percentage >= 0 && least.percentage < 9) {
    return {
      type: 'differs',
      label: 'Differs',
      status: 'TRADE NOW',
      probability: 100 - least.percentage,
      recommendation: `Digit ${least.digit} appears only ${least.percentage.toFixed(1)}% — Strong differs signal`,
      entryCondition: `Wait for digit ${least.digit} to appear, then trade DIFFERS`,
      targetDigit: least.digit,
      tradeDirection: `DIFFERS ${least.digit}`,
    };
  }
  return {
    type: 'differs',
    label: 'Differs',
    status: 'NEUTRAL',
    probability: 100 - least.percentage,
    recommendation: 'No rare digit found',
    entryCondition: 'Wait for a digit to drop below 9%',
    targetDigit: least.digit,
  };
}

function riseFallSignal(a: AnalysisResult): Signal {
  const quotes = a.last10quotes;
  if (quotes.length < 2) {
    return { type: 'rise_fall', label: 'Rise / Fall', status: 'NEUTRAL', probability: 0, recommendation: 'Not enough data', entryCondition: 'Wait for more ticks' };
  }
  const trend = quotes[quotes.length - 1] - quotes[0];
  const direction = trend >= 0 ? 'RISE' : 'FALL';
  const confidence = Math.min(60 + Math.abs(trend) * 100, 75);

  if (confidence >= 60) {
    return {
      type: 'rise_fall',
      label: 'Rise / Fall',
      status: 'TRADE NOW',
      probability: confidence,
      recommendation: `${direction} trend detected with ${confidence.toFixed(0)}% confidence`,
      entryCondition: `Trade in ${direction} direction`,
      tradeDirection: direction,
    };
  }
  return {
    type: 'rise_fall',
    label: 'Rise / Fall',
    status: 'NEUTRAL',
    probability: confidence,
    recommendation: 'Insufficient trend strength',
    entryCondition: 'Wait for stronger trend',
  };
}

// ─── Pro Signals ───────────────────────────────────────────────────────────────

export function generateProSignals(a: AnalysisResult): Signal[] {
  return [
    proEvenOddSignal(a),
    proOverUnderSignal(a),
    under7Signal(a),
    over2Signal(a),
  ].filter((s) => s.status !== 'NEUTRAL' || s.probability >= 55);
}

function proEvenOddSignal(a: AnalysisResult): Signal {
  const { evenPercentage, oddPercentage, digitFrequencies, powerIndex, last20 } = a;

  const evenDigitsAbove11 = [0, 2, 4, 6, 8].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const strongestIsEven = powerIndex.strongest % 2 === 0;
  const evenIn20 = last20.filter((d) => d % 2 === 0).length;

  if (evenPercentage >= 52 && evenDigitsAbove11 >= 2 && strongestIsEven && evenIn20 >= 11) {
    let consecutiveOdds = 0;
    for (let i = last20.length - 1; i >= 0; i--) {
      if (last20[i] % 2 !== 0) consecutiveOdds++;
      else break;
    }
    if (consecutiveOdds >= 3) {
      return {
        type: 'pro_even_odd',
        label: 'Pro Even/Odd',
        status: 'TRADE NOW',
        probability: evenPercentage,
        recommendation: `EVEN STRATEGY: ${consecutiveOdds} consecutive odds detected — Enter EVEN now!`,
        entryCondition: 'Enter EVEN immediately after first even digit appears',
        tradeDirection: 'EVEN',
      };
    }
    return {
      type: 'pro_even_odd',
      label: 'Pro Even/Odd',
      status: 'WAIT',
      probability: evenPercentage,
      recommendation: 'EVEN conditions met — Waiting for 3+ consecutive ODD digits',
      entryCondition: 'Wait for 3+ consecutive ODD digits, then enter EVEN',
      tradeDirection: 'EVEN',
    };
  }

  const oddDigitsAbove11 = [1, 3, 5, 7, 9].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const strongestIsOdd = powerIndex.strongest % 2 !== 0;
  const oddIn20 = last20.filter((d) => d % 2 !== 0).length;

  if (oddPercentage >= 60 && oddDigitsAbove11 >= 2 && strongestIsOdd && oddIn20 >= 12) {
    let consecutiveEvens = 0;
    for (let i = last20.length - 1; i >= 0; i--) {
      if (last20[i] % 2 === 0) consecutiveEvens++;
      else break;
    }
    if (consecutiveEvens >= 3) {
      return {
        type: 'pro_even_odd',
        label: 'Pro Even/Odd',
        status: 'TRADE NOW',
        probability: oddPercentage,
        recommendation: `ODD STRATEGY: ${consecutiveEvens} consecutive evens — Enter ODD now!`,
        entryCondition: 'Enter ODD immediately after first odd digit appears',
        tradeDirection: 'ODD',
      };
    }
    return {
      type: 'pro_even_odd',
      label: 'Pro Even/Odd',
      status: 'WAIT',
      probability: oddPercentage,
      recommendation: 'ODD conditions met — Waiting for 3+ consecutive EVEN digits',
      entryCondition: 'Wait for 3+ consecutive EVEN digits, then enter ODD',
      tradeDirection: 'ODD',
    };
  }

  return {
    type: 'pro_even_odd',
    label: 'Pro Even/Odd',
    status: 'NEUTRAL',
    probability: Math.max(evenPercentage, oddPercentage),
    recommendation: 'Pro even/odd conditions not met',
    entryCondition: 'Waiting for conditions',
  };
}

function proOverUnderSignal(a: AnalysisResult): Signal {
  const { digitFrequencies, highPercentage, lowPercentage, powerIndex, last20 } = a;

  const d0pct = digitFrequencies[0].percentage;
  const d1pct = digitFrequencies[1].percentage;
  const above2WithMin11 = [2, 3, 4, 5, 6, 7, 8, 9].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const weakestIs01 = powerIndex.weakest === 0 || powerIndex.weakest === 1;

  if (d0pct < 10 && d1pct < 10 && above2WithMin11 >= 3 && weakestIs01 && highPercentage >= 58) {
    const over1in20 = last20.filter((d) => d > 1).length;
    if (over1in20 >= 18) {
      return {
        type: 'pro_over_under',
        label: 'Pro Over/Under',
        status: 'TRADE NOW',
        probability: highPercentage,
        recommendation: 'OVER 1 STRATEGY: Strong signal — 90%+ win rate detected!',
        entryCondition: 'Wait for 1+ UNDER digits, then enter OVER 1 immediately',
        tradeDirection: 'OVER 1',
      };
    }
  }

  const d8pct = digitFrequencies[8].percentage;
  const d9pct = digitFrequencies[9].percentage;
  const under8WithMin11 = [0, 1, 2, 3, 4, 5, 6, 7].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const weakestIs89 = powerIndex.weakest === 8 || powerIndex.weakest === 9;

  if (d8pct < 10 && d9pct < 10 && under8WithMin11 >= 3 && weakestIs89 && lowPercentage >= 58) {
    const under8in20 = last20.filter((d) => d < 8).length;
    if (under8in20 >= 18) {
      return {
        type: 'pro_over_under',
        label: 'Pro Over/Under',
        status: 'TRADE NOW',
        probability: lowPercentage,
        recommendation: 'UNDER 8 STRATEGY: Strong signal — 90%+ win rate detected!',
        entryCondition: 'Wait for 1+ OVER digits, then enter UNDER 8 immediately',
        tradeDirection: 'UNDER 8',
      };
    }
  }

  return {
    type: 'pro_over_under',
    label: 'Pro Over/Under',
    status: 'NEUTRAL',
    probability: Math.max(highPercentage, lowPercentage),
    recommendation: 'Pro over/under conditions not met',
    entryCondition: 'Waiting for extreme conditions',
  };
}

function under7Signal(a: AnalysisResult): Signal {
  const { digitFrequencies, last20 } = a;
  const d7 = digitFrequencies[7].percentage;
  const d8 = digitFrequencies[8].percentage;
  const d9 = digitFrequencies[9].percentage;

  const highDigitsBelow10 = [d7, d8, d9].filter((p) => p < 10).length;
  const under7in20 = last20.filter((d) => d <= 6).length;

  const entryDigit = [7, 8, 9].reduce((best, d) =>
    digitFrequencies[d].percentage > digitFrequencies[best].percentage ? d : best
  );

  const prob = (under7in20 / Math.max(last20.length, 1)) * 100;

  if (highDigitsBelow10 >= 2 && under7in20 >= 12) {
    return {
      type: 'under_7',
      label: 'Under 7',
      status: 'TRADE NOW',
      probability: prob,
      recommendation: `Under 7: ${under7in20}/20 recent digits are 0-6. Entry on digit ${entryDigit}`,
      entryCondition: `Wait for digit ${entryDigit} to appear as entry trigger, then trade UNDER 7`,
      targetDigit: entryDigit,
      entryDigits: [7, 8, 9],
      tradeDirection: 'UNDER 7',
    };
  } else if (highDigitsBelow10 >= 1 && under7in20 >= 12) {
    return {
      type: 'under_7',
      label: 'Under 7',
      status: 'WAIT',
      probability: prob,
      recommendation: 'Under 7 developing — conditions building',
      entryCondition: `Monitor digit ${entryDigit}, wait for stronger pattern`,
      targetDigit: entryDigit,
    };
  }

  return {
    type: 'under_7',
    label: 'Under 7',
    status: 'NEUTRAL',
    probability: prob,
    recommendation: 'No Under 7 pattern',
    entryCondition: 'Insufficient low-digit dominance',
  };
}

function over2Signal(a: AnalysisResult): Signal {
  const { digitFrequencies, last20 } = a;
  const d0 = digitFrequencies[0].percentage;
  const d1 = digitFrequencies[1].percentage;
  const d2 = digitFrequencies[2].percentage;

  const lowDigitsBelow10 = [d0, d1, d2].filter((p) => p < 10).length;
  const over2in20 = last20.filter((d) => d >= 3).length;

  const entryDigit = [0, 1, 2].reduce((best, d) =>
    digitFrequencies[d].percentage > digitFrequencies[best].percentage ? d : best
  );

  const prob = (over2in20 / Math.max(last20.length, 1)) * 100;

  if (lowDigitsBelow10 >= 2 && over2in20 >= 12) {
    return {
      type: 'over_2',
      label: 'Over 2',
      status: 'TRADE NOW',
      probability: prob,
      recommendation: `Over 2: ${over2in20}/20 recent digits are 3-9. Entry on digit ${entryDigit}`,
      entryCondition: `Wait for digit ${entryDigit} to appear, then trade OVER 2`,
      targetDigit: entryDigit,
      entryDigits: [1, 2, 3, 4],
      tradeDirection: 'OVER 2',
    };
  } else if (lowDigitsBelow10 >= 1 && over2in20 >= 12) {
    return {
      type: 'over_2',
      label: 'Over 2',
      status: 'WAIT',
      probability: prob,
      recommendation: 'Over 2 developing — conditions building',
      entryCondition: `Monitor digit ${entryDigit}`,
      targetDigit: entryDigit,
    };
  }

  return {
    type: 'over_2',
    label: 'Over 2',
    status: 'NEUTRAL',
    probability: prob,
    recommendation: 'No Over 2 pattern',
    entryCondition: 'Insufficient high-digit dominance',
  };
}

// ─── Super Signals (kept for backwards compat) ─────────────────────────────────

export function generateSuperSignals(a: AnalysisResult): Signal[] {
  const all = [...generateSignals(a), ...generateProSignals(a)];
  return all
    .filter((s) => s.probability >= 55 && s.status !== 'NEUTRAL')
    .sort((a, b) => b.probability - a.probability);
}
