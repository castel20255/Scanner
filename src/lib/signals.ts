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
  const { last25, evenPercentage, oddPercentage } = a;

  // Determine the dominant parity from the highest-frequency digits in last 25 ticks
  const last25Counts = new Array(10).fill(0);
  for (const d of last25) last25Counts[d]++;
  // Get top 3 most frequent digits in last 25 ticks
  const topDigits25 = last25Counts
    .map((count, digit) => ({ digit, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 3);
  const evenAmongTop = topDigits25.filter(d => d.digit % 2 === 0).length;
  const oddAmongTop = topDigits25.filter(d => d.digit % 2 !== 0).length;

  // The favored parity is whichever is dominant among the top digits in last 25
  const favoredByTop = evenAmongTop > oddAmongTop ? 'EVEN' : 'ODD';
  // Also check overall even/odd percentage alignment
  const favoredOverall = evenPercentage >= oddPercentage ? 'EVEN' : 'ODD';

  // Alignment: the top digits in last 25 must agree with the overall even/odd bias
  const aligned = favoredByTop === favoredOverall;
  const favored = aligned ? favoredByTop : favoredOverall;
  const opposite = favored === 'EVEN' ? 'ODD' : 'EVEN';

  // Check for 2+ consecutive opposite-parity digits followed by one favored-parity digit
  // Look at the last few ticks
  const last = last25;
  if (last.length < 3) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'NEUTRAL',
      probability: Math.max(evenPercentage, oddPercentage),
      recommendation: 'Not enough tick data for even/odd pattern',
      entryCondition: 'Waiting for more tick data',
      tradeDirection: favored,
    };
  }

  // Count consecutive opposite digits at the end of the sequence
  let consecutiveOpposite = 0;
  for (let i = last.length - 1; i >= 0; i--) {
    const isOpposite = favored === 'EVEN' ? last[i] % 2 !== 0 : last[i] % 2 === 0;
    if (isOpposite) consecutiveOpposite++;
    else break;
  }

  // Entry: 2+ consecutive opposite, then one favored digit appears
  // We check if the tick before the consecutive run was a favored digit
  // Or: the last tick is a favored digit and before it were 2+ opposite
  let entryTriggered = false;
  if (consecutiveOpposite >= 2) {
    // We're in a streak of opposite digits — waiting for one favored to appear
    entryTriggered = false;
  } else if (consecutiveOpposite === 0 && last.length >= 3) {
    // Last tick is favored — check if there were 2+ opposite before it
    const lastDigit = last[last.length - 1];
    const isFavored = favored === 'EVEN' ? lastDigit % 2 === 0 : lastDigit % 2 !== 0;
    if (isFavored) {
      let consecBefore = 0;
      for (let i = last.length - 2; i >= 0; i--) {
        const isOpp = favored === 'EVEN' ? last[i] % 2 !== 0 : last[i] % 2 === 0;
        if (isOpp) consecBefore++;
        else break;
      }
      if (consecBefore >= 2) entryTriggered = true;
    }
  }

  const maxPct = Math.max(evenPercentage, oddPercentage);
  const biasStrength = Math.abs(evenPercentage - oddPercentage);

  if (aligned && entryTriggered && maxPct >= 52) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'TRADE NOW',
      probability: maxPct,
      recommendation: `${favored} bias aligned (${maxPct.toFixed(1)}%) — 2+ ${opposite} then ${favored} appeared. Trade ${favored}`,
      entryCondition: `2+ consecutive ${opposite} digits followed by one ${favored} — trade ${favored}`,
      tradeDirection: favored,
    };
  }

  if (aligned && consecutiveOpposite >= 2 && maxPct >= 52) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'WAIT',
      probability: maxPct,
      recommendation: `${favored} bias (${maxPct.toFixed(1)}%) — ${consecutiveOpposite} consecutive ${opposite} detected, waiting for ${favored}`,
      entryCondition: `Waiting for one ${favored} digit after ${consecutiveOpposite} consecutive ${opposite}`,
      tradeDirection: favored,
    };
  }

  if (!aligned) {
    return {
      type: 'even_odd',
      label: 'Even / Odd',
      status: 'NEUTRAL',
      probability: maxPct,
      recommendation: `Top digits in last 25 ticks favor ${favoredByTop} but overall favors ${favoredOverall} — not aligned`,
      entryCondition: 'Waiting for last-25-tick top digits to align with overall even/odd bias',
      tradeDirection: favoredOverall,
    };
  }

  return {
    type: 'even_odd',
    label: 'Even / Odd',
    status: 'WAIT',
    probability: maxPct,
    recommendation: `${favored} bias (${maxPct.toFixed(1)}%) but no entry pattern yet`,
    entryCondition: `Waiting for 2+ consecutive ${opposite} then one ${favored}`,
    tradeDirection: favored,
  };
}

function overUnderSignal(a: AnalysisResult): Signal {
  const { highPercentage, lowPercentage, powerIndex, digitFrequencies, digitTrends } = a;
  const max = Math.max(highPercentage, lowPercentage);
  const favored = highPercentage >= lowPercentage ? 'OVER' : 'UNDER';

  // Allowed predictions: OVER 1,2,3 and UNDER 6,7,8 only
  const strongest = powerIndex.strongest;
  const strongestTrend = digitTrends[strongest];

  const allowedOver = [1, 2, 3];
  const allowedUnder = [6, 7, 8];

  let entryDigit: number;
  if (favored === 'OVER') {
    const overCandidates = digitTrends
      .filter(t => allowedOver.includes(t.digit) && t.trendDirection === 'increasing')
      .sort((x, y) => y.recentPercentage - x.recentPercentage);
    entryDigit = overCandidates[0]?.digit ?? allowedOver[0];
  } else {
    const underCandidates = digitTrends
      .filter(t => allowedUnder.includes(t.digit) && t.trendDirection === 'increasing')
      .sort((x, y) => y.recentPercentage - x.recentPercentage);
    entryDigit = underCandidates[0]?.digit ?? allowedUnder[allowedUnder.length - 1];
  }

  const entryDigits = favored === 'OVER'
    ? allowedOver.filter(d => digitFrequencies[d].percentage >= 8)
    : allowedUnder.filter(d => digitFrequencies[d].percentage >= 8);
  const fallbackDigits = favored === 'OVER' ? allowedOver : allowedUnder;
  const finalEntryDigits = entryDigits.length >= 2 ? entryDigits : fallbackDigits;

  if (max >= 56 && powerIndex.gap >= 10) {
    return {
      type: 'over_under',
      label: 'Over / Under',
      status: 'TRADE NOW',
      probability: max,
      recommendation: `Strong ${favored} bias (${max.toFixed(1)}%, gap: ${powerIndex.gap.toFixed(1)}%) — Entry digit ${entryDigit} (trend: ${strongestTrend.trendDirection})`,
      entryCondition: `Trade ${favored} ${entryDigit} when digit ${entryDigit} appears`,
      targetDigit: entryDigit,
      entryDigits: finalEntryDigits,
      tradeDirection: `${favored} ${entryDigit}`,
    };
  } else if (max >= 53) {
    return {
      type: 'over_under',
      label: 'Over / Under',
      status: 'WAIT',
      probability: max,
      recommendation: `Moderate ${favored} bias (${max.toFixed(1)}%) — Entry digit ${entryDigit}`,
      entryCondition: 'Wait for power gap to increase above 10%',
      targetDigit: entryDigit,
      entryDigits: finalEntryDigits,
      tradeDirection: `${favored} ${entryDigit}`,
    };
  }
  return {
    type: 'over_under',
    label: 'Over / Under',
    status: 'NEUTRAL',
    probability: max,
    recommendation: 'No clear high/low pattern',
    entryCondition: 'Insufficient data',
    targetDigit: entryDigit,
    entryDigits: finalEntryDigits,
    tradeDirection: `${favored} ${entryDigit}`,
  };
}

function matchesSignal(a: AnalysisResult): Signal {
  const { powerIndex, digitFrequencies, digitTrends } = a;
  const strongest = powerIndex.strongest;
  const secondStrongest = powerIndex.secondStrongest;
  const weakest = powerIndex.weakest;

  const strongestPct = digitFrequencies[strongest].percentage;
  const secondPct = digitFrequencies[secondStrongest].percentage;
  const weakestPct = digitFrequencies[weakest].percentage;

  // Priority: highest appearing → 2nd most appearing → least appearing
  // Only trade if the chosen digit is increasing (delta >= 0.3%)
  const candidates = [
    { digit: strongest, pct: strongestPct, trend: digitTrends[strongest] },
    { digit: secondStrongest, pct: secondPct, trend: digitTrends[secondStrongest] },
    { digit: weakest, pct: weakestPct, trend: digitTrends[weakest] },
  ];

  // Find the first candidate that is increasing with 0.3%+
  const tradeCandidate = candidates.find(c => c.trend.delta >= 0.3);

  if (tradeCandidate && tradeCandidate.pct >= 10) {
    const prob = Math.min(tradeCandidate.pct * 5, 95);
    return {
      type: 'matches',
      label: 'Matches',
      status: 'TRADE NOW',
      probability: prob,
      recommendation: `Digit ${tradeCandidate.digit} at ${tradeCandidate.pct.toFixed(1)}% and rising (+${tradeCandidate.trend.delta.toFixed(1)}%) — Trade MATCHES`,
      entryCondition: `Trade MATCHES on digit ${tradeCandidate.digit} when it appears (freq increasing 0.3%+)`,
      targetDigit: tradeCandidate.digit,
      entryDigits: [strongest, secondStrongest, weakest],
      tradeDirection: `MATCHES ${tradeCandidate.digit}`,
    };
  }

  // WAIT if any candidate is strong but not yet increasing enough
  if (strongestPct >= 12) {
    return {
      type: 'matches',
      label: 'Matches',
      status: 'WAIT',
      probability: strongestPct * 5,
      recommendation: `Digit ${strongest} at ${strongestPct.toFixed(1)}% but trend ${digitTrends[strongest].trendDirection} (delta ${digitTrends[strongest].delta.toFixed(1)}%)`,
      entryCondition: 'Wait for digit frequency to increase by 0.3%+ before trading',
      targetDigit: strongest,
      entryDigits: [strongest, secondStrongest, weakest],
    };
  }

  return {
    type: 'matches',
    label: 'Matches',
    status: 'NEUTRAL',
    probability: strongestPct * 5,
    recommendation: 'No dominant digit with rising trend',
    entryCondition: 'Waiting for a digit to increase 0.3%+ in frequency',
    targetDigit: strongest,
    entryDigits: [strongest, secondStrongest, weakest],
  };
}

function differsSignal(a: AnalysisResult): Signal {
  const { powerIndex, digitFrequencies, digitTrends } = a;
  const { strongest, secondStrongest, weakest } = powerIndex;

  // Excluded digits: most, 2nd most, and least appearing
  const excluded = new Set([strongest, secondStrongest, weakest]);

  // Candidate: <10% frequency AND decreasing AND NOT in excluded set
  const candidates = digitTrends.filter(t => {
    const freq = digitFrequencies[t.digit].percentage;
    return !excluded.has(t.digit) && freq < 10 && t.trendDirection === 'decreasing';
  });

  if (candidates.length > 0) {
    const best = candidates.reduce((x, y) => x.recentPercentage < y.recentPercentage ? x : y);
    const prob = Math.min((10 - best.recentPercentage) * 8, 90);

    const lastFew = a.last25.slice(-5);
    const excludedAppearing = lastFew.some(d => excluded.has(d));
    const digitAppearing = lastFew.some(d => d === best.digit);

    if (excludedAppearing && !digitAppearing) {
      return {
        type: 'differs',
        label: 'Differs',
        status: 'TRADE NOW',
        probability: prob,
        recommendation: `Digit ${best.digit} at ${best.recentPercentage.toFixed(1)}% & decreasing — Excluded digits appearing. Trade DIFFERS`,
        entryCondition: `Trade DIFFERS on digit ${best.digit} (excluded digits appearing, target decreasing)`,
        targetDigit: best.digit,
        entryDigits: [best.digit],
        tradeDirection: `DIFFERS ${best.digit}`,
      };
    }

    return {
      type: 'differs',
      label: 'Differs',
      status: 'WAIT',
      probability: prob,
      recommendation: `Digit ${best.digit} at ${best.recentPercentage.toFixed(1)}% & decreasing, but entry conditions not met`,
      entryCondition: 'Wait for excluded digits to appear while target digit stays low/decreasing',
      targetDigit: best.digit,
      entryDigits: [best.digit],
    };
  }

  return {
    type: 'differs',
    label: 'Differs',
    status: 'NEUTRAL',
    probability: 50,
    recommendation: 'No suitable digit for differs (need <10%, decreasing, not top/bottom/2nd)',
    entryCondition: 'Waiting for a low-frequency decreasing digit outside excluded set',
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
  const { evenPercentage, oddPercentage, digitFrequencies, powerIndex, last25 } = a;

  // Check alignment: top digits in last 25 must align with overall even/odd bias
  const last25Counts = new Array(10).fill(0);
  for (const d of last25) last25Counts[d]++;
  const topDigits25 = last25Counts
    .map((count, digit) => ({ digit, count }))
    .sort((x, y) => y.count - x.count)
    .slice(0, 3);
  const evenAmongTop = topDigits25.filter(d => d.digit % 2 === 0).length;
  const oddAmongTop = topDigits25.filter(d => d.digit % 2 !== 0).length;
  const topFavored = evenAmongTop > oddAmongTop ? 'EVEN' : 'ODD';

  const evenDigitsAbove11 = [0, 2, 4, 6, 8].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const strongestIsEven = powerIndex.strongest % 2 === 0;
  const evenIn25 = last25.filter((d) => d % 2 === 0).length;

  if (evenPercentage >= 52 && evenDigitsAbove11 >= 2 && strongestIsEven && evenIn25 >= 13 && topFavored === 'EVEN') {
    let consecutiveOdds = 0;
    for (let i = last25.length - 1; i >= 0; i--) {
      if (last25[i] % 2 !== 0) consecutiveOdds++;
      else break;
    }
    if (consecutiveOdds >= 2) {
      return {
        type: 'pro_even_odd',
        label: 'Pro Even/Odd',
        status: 'TRADE NOW',
        probability: evenPercentage,
        recommendation: `EVEN STRATEGY: ${consecutiveOdds} consecutive odds + aligned top digits — Enter EVEN!`,
        entryCondition: '2+ consecutive ODD digits detected — enter EVEN on next even digit',
        tradeDirection: 'EVEN',
      };
    }
    return {
      type: 'pro_even_odd',
      label: 'Pro Even/Odd',
      status: 'WAIT',
      probability: evenPercentage,
      recommendation: 'EVEN conditions met — Waiting for 2+ consecutive ODD digits',
      entryCondition: 'Wait for 2+ consecutive ODD digits, then enter EVEN',
      tradeDirection: 'EVEN',
    };
  }

  const oddDigitsAbove11 = [1, 3, 5, 7, 9].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const strongestIsOdd = powerIndex.strongest % 2 !== 0;
  const oddIn25 = last25.filter((d) => d % 2 !== 0).length;

  if (oddPercentage >= 52 && oddDigitsAbove11 >= 2 && strongestIsOdd && oddIn25 >= 13 && topFavored === 'ODD') {
    let consecutiveEvens = 0;
    for (let i = last25.length - 1; i >= 0; i--) {
      if (last25[i] % 2 === 0) consecutiveEvens++;
      else break;
    }
    if (consecutiveEvens >= 2) {
      return {
        type: 'pro_even_odd',
        label: 'Pro Even/Odd',
        status: 'TRADE NOW',
        probability: oddPercentage,
        recommendation: `ODD STRATEGY: ${consecutiveEvens} consecutive evens + aligned top digits — Enter ODD!`,
        entryCondition: '2+ consecutive EVEN digits detected — enter ODD on next odd digit',
        tradeDirection: 'ODD',
      };
    }
    return {
      type: 'pro_even_odd',
      label: 'Pro Even/Odd',
      status: 'WAIT',
      probability: oddPercentage,
      recommendation: 'ODD conditions met — Waiting for 2+ consecutive EVEN digits',
      entryCondition: 'Wait for 2+ consecutive EVEN digits, then enter ODD',
      tradeDirection: 'ODD',
    };
  }

  return {
    type: 'pro_even_odd',
    label: 'Pro Even/Odd',
    status: 'NEUTRAL',
    probability: Math.max(evenPercentage, oddPercentage),
    recommendation: 'Pro even/odd conditions not met or top digits not aligned',
    entryCondition: 'Waiting for alignment and 2+ consecutive opposite digits',
  };
}

function proOverUnderSignal(a: AnalysisResult): Signal {
  const { digitFrequencies, highPercentage, lowPercentage, powerIndex, last25, digitTrends } = a;

  const d0pct = digitFrequencies[0].percentage;
  const d1pct = digitFrequencies[1].percentage;
  const above2WithMin11 = [2, 3, 4, 5, 6, 7, 8, 9].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const weakestIs01 = powerIndex.weakest === 0 || powerIndex.weakest === 1;

  if (d0pct < 10 && d1pct < 10 && above2WithMin11 >= 3 && weakestIs01 && highPercentage >= 58) {
    const over1in25 = last25.filter((d) => d > 1).length;
    if (over1in25 >= 22) {
      // Auto-configure entry digit: highest increasing digit >=2
      const highIncreasing = digitTrends
        .filter(t => [1, 2, 3].includes(t.digit) && t.trendDirection === 'increasing')
        .sort((x, y) => y.recentPercentage - x.recentPercentage);
      const entryDigit = highIncreasing[0]?.digit ?? 1;
      return {
        type: 'pro_over_under',
        label: 'Pro Over/Under',
        status: 'TRADE NOW',
        probability: highPercentage,
        recommendation: `OVER 1 STRATEGY: Strong signal — Entry digit ${entryDigit} (trend: ${digitTrends[entryDigit].trendDirection})`,
        entryCondition: `Wait for 1+ UNDER digits, then enter OVER 1 on digit ${entryDigit}`,
        targetDigit: entryDigit,
        entryDigits: [1, 2, 3],
        tradeDirection: 'OVER 1',
      };
    }
  }

  const d8pct = digitFrequencies[8].percentage;
  const d9pct = digitFrequencies[9].percentage;
  const under8WithMin11 = [0, 1, 2, 3, 4, 5, 6, 7].filter((d) => digitFrequencies[d].percentage >= 11).length;
  const weakestIs89 = powerIndex.weakest === 8 || powerIndex.weakest === 9;

  if (d8pct < 10 && d9pct < 10 && under8WithMin11 >= 3 && weakestIs89 && lowPercentage >= 58) {
    const under8in25 = last25.filter((d) => d < 8).length;
    if (under8in25 >= 22) {
      // Auto-configure entry digit: highest increasing digit <8
      const lowIncreasing = digitTrends
        .filter(t => [6, 7, 8].includes(t.digit) && t.trendDirection === 'increasing')
        .sort((x, y) => y.recentPercentage - x.recentPercentage);
      const entryDigit = lowIncreasing[0]?.digit ?? 8;
      return {
        type: 'pro_over_under',
        label: 'Pro Over/Under',
        status: 'TRADE NOW',
        probability: lowPercentage,
        recommendation: `UNDER 8 STRATEGY: Strong signal — Entry digit ${entryDigit} (trend: ${digitTrends[entryDigit].trendDirection})`,
        entryCondition: `Wait for 1+ OVER digits, then enter UNDER 8 on digit ${entryDigit}`,
        targetDigit: entryDigit,
        entryDigits: [6, 7, 8],
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

  const entryDigit = [6, 7, 8].reduce((best, d) =>
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
      entryDigits: [6, 7, 8],
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

  const entryDigit = [1, 2, 3].reduce((best, d) =>
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
      entryDigits: [1, 2, 3],
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
