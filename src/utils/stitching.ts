// Levenshtein-based transcript stitching utility
// Extracted from App.tsx for reuse in multi-file pipeline

const levenshteinDistance = (a: string, b: string): number => {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
};

const similarityScore = (a: string, b: string): number => {
  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
};

const findBestOverlap = (
  prevWords: string[],
  currWords: string[],
  minOverlap: number = 5,
  maxOverlap: number = 20
): { overlapCount: number; score: number } => {
  let bestOverlap = 0;
  let bestScore = 0;
  for (let candidate = minOverlap; candidate <= maxOverlap; candidate++) {
    if (candidate > prevWords.length || candidate > currWords.length) break;
    const prevOverlap = prevWords.slice(-candidate).join(" ");
    const currOverlap = currWords.slice(0, candidate).join(" ");
    const score = similarityScore(prevOverlap.toLowerCase(), currOverlap.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      bestOverlap = candidate;
    }
  }
  return { overlapCount: bestOverlap, score: bestScore };
};

export const stitchTranscriptions = (
  transcripts: string[],
  onLog?: (msg: string, type?: "info" | "error") => void
): string => {
  if (transcripts.length === 0) return "";
  let stitched = transcripts[0].trim();
  for (let i = 1; i < transcripts.length; i++) {
    const prevWords = stitched.split(/\s+/);
    const currWords = transcripts[i].split(/\s+/);
    const prevWindow = prevWords.slice(-10);
    const { overlapCount, score } = findBestOverlap(prevWindow, currWords, 5, 20);
    onLog?.(
      `Between segment ${i} and ${i + 1}: best overlap = ${overlapCount}, score = ${score.toFixed(2)}`,
      "info"
    );
    let currAdjusted = transcripts[i];
    const threshold = 0.8;
    if (score >= threshold && overlapCount > 0) {
      currAdjusted = currWords.slice(overlapCount).join(" ");
      onLog?.(
        `Overlap detected (score ${score.toFixed(2)} >= ${threshold}). Removing ${overlapCount} overlapping words from segment ${i + 1}.`,
        "info"
      );
    }
    stitched = stitched + " " + currAdjusted;
  }
  return stitched.trim();
};
