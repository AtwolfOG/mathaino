export interface EvaluationPolicy {
  passingAccuracy: number;
}

export type WordDifferenceType = "omission" | "insertion" | "substitution";

export interface WordDifference {
  type: WordDifferenceType;
  expected: string | null;
  submitted: string | null;
  expectedIndex: number;
  submittedIndex: number;
}

export interface RecitationEvaluation {
  normalizedExpected: string;
  normalizedSubmitted: string;
  differences: WordDifference[];
  accuracy: number;
  passed: boolean;
  feedback: string;
}

export function normalizeRecitationText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’\u02bc]/gu, "")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function alignWords(
  expectedWords: string[],
  submittedWords: string[],
): { distance: number; differences: WordDifference[] } {
  const costs = Array.from({ length: expectedWords.length + 1 }, () =>
    Array<number>(submittedWords.length + 1).fill(0),
  );

  for (
    let expectedIndex = 0;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    costs[expectedIndex]![0] = expectedIndex;
  }
  for (
    let submittedIndex = 0;
    submittedIndex <= submittedWords.length;
    submittedIndex += 1
  ) {
    costs[0]![submittedIndex] = submittedIndex;
  }

  for (
    let expectedIndex = 1;
    expectedIndex <= expectedWords.length;
    expectedIndex += 1
  ) {
    for (
      let submittedIndex = 1;
      submittedIndex <= submittedWords.length;
      submittedIndex += 1
    ) {
      const substitutionCost =
        expectedWords[expectedIndex - 1] === submittedWords[submittedIndex - 1]
          ? 0
          : 1;
      costs[expectedIndex]![submittedIndex] = Math.min(
        costs[expectedIndex - 1]![submittedIndex - 1]! + substitutionCost,
        costs[expectedIndex - 1]![submittedIndex]! + 1,
        costs[expectedIndex]![submittedIndex - 1]! + 1,
      );
    }
  }

  const reversedDifferences: WordDifference[] = [];
  let expectedIndex = expectedWords.length;
  let submittedIndex = submittedWords.length;

  while (expectedIndex > 0 || submittedIndex > 0) {
    const currentCost = costs[expectedIndex]![submittedIndex]!;
    if (
      expectedIndex > 0 &&
      submittedIndex > 0 &&
      expectedWords[expectedIndex - 1] === submittedWords[submittedIndex - 1] &&
      currentCost === costs[expectedIndex - 1]![submittedIndex - 1]
    ) {
      expectedIndex -= 1;
      submittedIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      submittedIndex > 0 &&
      currentCost === costs[expectedIndex - 1]![submittedIndex - 1]! + 1
    ) {
      reversedDifferences.push({
        type: "substitution",
        expected: expectedWords[expectedIndex - 1]!,
        submitted: submittedWords[submittedIndex - 1]!,
        expectedIndex: expectedIndex - 1,
        submittedIndex: submittedIndex - 1,
      });
      expectedIndex -= 1;
      submittedIndex -= 1;
      continue;
    }

    if (
      expectedIndex > 0 &&
      currentCost === costs[expectedIndex - 1]![submittedIndex]! + 1
    ) {
      reversedDifferences.push({
        type: "omission",
        expected: expectedWords[expectedIndex - 1]!,
        submitted: null,
        expectedIndex: expectedIndex - 1,
        submittedIndex,
      });
      expectedIndex -= 1;
      continue;
    }

    reversedDifferences.push({
      type: "insertion",
      expected: null,
      submitted: submittedWords[submittedIndex - 1]!,
      expectedIndex,
      submittedIndex: submittedIndex - 1,
    });
    submittedIndex -= 1;
  }

  return {
    distance: costs[expectedWords.length]![submittedWords.length]!,
    differences: reversedDifferences.reverse(),
  };
}

function describeDifferences(differences: WordDifference[]): string {
  const descriptions: string[] = [];
  const labels: Record<WordDifferenceType, string> = {
    omission: "omitted",
    insertion: "inserted",
    substitution: "substituted",
  };

  for (const type of ["omission", "insertion", "substitution"] as const) {
    const count = differences.filter(
      (difference) => difference.type === type,
    ).length;
    if (count > 0) {
      descriptions.push(
        `${count} ${labels[type]} word${count === 1 ? "" : "s"}`,
      );
    }
  }

  return descriptions.join(", ");
}

export function evaluateRecitation(
  expected: string,
  submitted: string,
  policy: EvaluationPolicy,
): RecitationEvaluation {
  if (
    !Number.isFinite(policy.passingAccuracy) ||
    policy.passingAccuracy < 0 ||
    policy.passingAccuracy > 100
  ) {
    throw new RangeError(
      "Passing accuracy must be a finite number from 0 to 100.",
    );
  }

  const normalizedExpected = normalizeRecitationText(expected);
  const normalizedSubmitted = normalizeRecitationText(submitted);
  if (normalizedExpected.length === 0) {
    throw new Error("Expected verse must contain at least one word.");
  }

  const expectedWords = normalizedExpected.split(" ");
  const submittedWords =
    normalizedSubmitted.length === 0 ? [] : normalizedSubmitted.split(" ");
  const { distance, differences } = alignWords(expectedWords, submittedWords);
  const accuracy =
    Math.round(Math.max(0, 1 - distance / expectedWords.length) * 10_000) / 100;
  const passed = accuracy >= policy.passingAccuracy;
  const feedback =
    differences.length === 0
      ? "Perfect match: no word differences."
      : `${passed ? "Passed" : "Failed"} with ${accuracy}% accuracy: ${describeDifferences(differences)}.`;

  return {
    normalizedExpected,
    normalizedSubmitted,
    differences,
    accuracy,
    passed,
    feedback,
  };
}
