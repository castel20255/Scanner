export type DigitFrequency = {
  digit: number;
  count: number;
  percentage: number;
};

export type DigitTrend = {
  digit: number;
  recentPercentage: number; // last 25 ticks
  overallPercentage: number; // full window
  delta: number; // recentPercentage - overallPercentage (positive = increasing)
  trendDirection: 'increasing' | 'decreasing' | 'stable';
};

export type AnalysisResult = {
  digitFrequencies: DigitFrequency[];
  evenCount: number;
  oddCount: number;
  evenPercentage: number;
  oddPercentage: number;
  highCount: number;
  lowCount: number;
  highPercentage: number;
  lowPercentage: number;
  entropy: number;
  powerIndex: {
    strongest: number;
    secondStrongest: number;
    weakest: number;
    secondWeakest: number;
    gap: number;
  };
  digitTrends: DigitTrend[];
  missingDigits: number[];
  streaks: { digit: number; count: number }[];
  totalTicks: number;
  last20: number[];
  last25: number[];
  last10quotes: number[];
};

export type MultiWindowAnalysis = {
  w1000: AnalysisResult;
  w120: AnalysisResult;
  w15: AnalysisResult;
  aligned: boolean;
  alignmentScore: number; // 0-100, how aligned the 3 windows are
  lastDigit: number | null;
};

export function analyzeDigits(ticks: number[], quotes: number[]): AnalysisResult {
  const total = ticks.length;
  if (total === 0) return emptyResult();

  const counts = new Array(10).fill(0);
  for (const d of ticks) counts[d]++;

  const digitFrequencies: DigitFrequency[] = counts.map((c, i) => ({
    digit: i,
    count: c,
    percentage: total > 0 ? (c / total) * 100 : 0,
  }));

  const evenCount = [0, 2, 4, 6, 8].reduce((s, d) => s + counts[d], 0);
  const oddCount = [1, 3, 5, 7, 9].reduce((s, d) => s + counts[d], 0);
  const highCount = [5, 6, 7, 8, 9].reduce((s, d) => s + counts[d], 0);
  const lowCount = [0, 1, 2, 3, 4].reduce((s, d) => s + counts[d], 0);

  const evenPercentage = (evenCount / total) * 100;
  const oddPercentage = (oddCount / total) * 100;
  const highPercentage = (highCount / total) * 100;
  const lowPercentage = (lowCount / total) * 100;

  let entropy = 0;
  for (const df of digitFrequencies) {
    if (df.percentage > 0) {
      const p = df.percentage / 100;
      entropy -= p * Math.log2(p);
    }
  }

  const sorted = [...digitFrequencies].sort((a, b) => b.percentage - a.percentage);
  const strongest = sorted[0].digit;
  const secondStrongest = sorted[1].digit;
  const weakest = sorted[sorted.length - 1].digit;
  const secondWeakest = sorted[sorted.length - 2].digit;
  const gap = digitFrequencies[strongest].percentage - digitFrequencies[weakest].percentage;

  // Digit trends: compare last-25-tick frequency vs overall frequency
  const last25 = ticks.slice(-25);
  const recentCounts = new Array(10).fill(0);
  for (const d of last25) recentCounts[d]++;
  const digitTrends: DigitTrend[] = counts.map((c, i) => {
    const overallPercentage = total > 0 ? (c / total) * 100 : 0;
    const recentPercentage = last25.length > 0 ? (recentCounts[i] / last25.length) * 100 : 0;
    const delta = recentPercentage - overallPercentage;
    const trendDirection: DigitTrend['trendDirection'] =
      delta > 0.3 ? 'increasing' : delta < -0.3 ? 'decreasing' : 'stable';
    return { digit: i, recentPercentage, overallPercentage, delta, trendDirection };
  });

  const missingDigits = digitFrequencies.filter((d) => d.count === 0).map((d) => d.digit);

  const streaks: { digit: number; count: number }[] = [];
  if (ticks.length > 0) {
    let cur = ticks[ticks.length - 1];
    let cnt = 1;
    for (let i = ticks.length - 2; i >= 0; i--) {
      if (ticks[i] === cur) cnt++;
      else break;
    }
    if (cnt >= 2) streaks.push({ digit: cur, count: cnt });
  }

  return {
    digitFrequencies,
    evenCount,
    oddCount,
    evenPercentage,
    oddPercentage,
    highCount,
    lowCount,
    highPercentage,
    lowPercentage,
    entropy,
    powerIndex: { strongest, secondStrongest, weakest, secondWeakest, gap },
    digitTrends,
    missingDigits,
    streaks,
    totalTicks: total,
    last20: ticks.slice(-20),
    last25,
    last10quotes: quotes.slice(-10),
  };
}

export function analyzeMultiWindow(ticks: number[], quotes: number[]): MultiWindowAnalysis {
  const w1000 = analyzeDigits(ticks.slice(-1000), quotes.slice(-1000));
  const w120 = analyzeDigits(ticks.slice(-120), quotes.slice(-120));
  const w15 = analyzeDigits(ticks.slice(-15), quotes.slice(-15));

  const lastDigit = ticks.length > 0 ? ticks[ticks.length - 1] : null;

  // Alignment: do all 3 windows agree on even/odd bias and over/under bias?
  const evenBias = (r: AnalysisResult) => r.evenPercentage >= 50 ? 'EVEN' : 'ODD';
  const ouBias = (r: AnalysisResult) => r.highPercentage >= 50 ? 'OVER' : 'UNDER';

  const evenMatch = evenBias(w1000) === evenBias(w120) && evenBias(w120) === evenBias(w15);
  const ouMatch = ouBias(w1000) === ouBias(w120) && ouBias(w120) === ouBias(w15);

  // Strongest digit consistency across windows
  const strongestMatch = w1000.powerIndex.strongest === w120.powerIndex.strongest;
  const weakestMatch = w1000.powerIndex.weakest === w120.powerIndex.weakest;

  let alignmentScore = 0;
  if (evenMatch) alignmentScore += 30;
  if (ouMatch) alignmentScore += 30;
  if (strongestMatch) alignmentScore += 25;
  if (weakestMatch) alignmentScore += 15;

  const aligned = alignmentScore >= 60;

  return { w1000, w120, w15, aligned, alignmentScore, lastDigit };
}

function emptyResult(): AnalysisResult {
  return {
    digitFrequencies: Array.from({ length: 10 }, (_, i) => ({ digit: i, count: 0, percentage: 0 })),
    evenCount: 0,
    oddCount: 0,
    evenPercentage: 0,
    oddPercentage: 0,
    highCount: 0,
    lowCount: 0,
    highPercentage: 0,
    lowPercentage: 0,
    entropy: 0,
    powerIndex: { strongest: 0, secondStrongest: 1, weakest: 0, secondWeakest: 1, gap: 0 },
    digitTrends: Array.from({ length: 10 }, (_, i) => ({ digit: i, recentPercentage: 0, overallPercentage: 0, delta: 0, trendDirection: 'stable' as const })),
    missingDigits: [],
    streaks: [],
    totalTicks: 0,
    last20: [],
    last25: [],
    last10quotes: [],
  };
}
