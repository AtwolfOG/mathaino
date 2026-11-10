import { expect, test } from "vitest";
import {
  evaluateRecitation,
  normalizeRecitationText,
} from "@/domain/recitation-evaluation";

const policy = { passingAccuracy: 90 };

test("an exact recitation passes without word differences", () => {
  expect(
    evaluateRecitation(
      "Thy word is a lamp unto my feet",
      "Thy word is a lamp unto my feet",
      policy,
    ),
  ).toEqual({
    normalizedExpected: "thy word is a lamp unto my feet",
    normalizedSubmitted: "thy word is a lamp unto my feet",
    differences: [],
    accuracy: 100,
    passed: true,
    feedback: "Perfect match: no word differences.",
  });
});

test.each([
  ["capitalisation", "For God So Loved", "for god so loved"],
  [
    "punctuation",
    "¶ For God so loved the world,",
    "For God so loved the world!",
  ],
  ["whitespace", "Thy word\tis a lamp", "  Thy  word\n is a lamp  "],
  ["apostrophes", "the king’s command", "the kings command"],
])("ignores harmless %s differences", (_kind, expected, submitted) => {
  const result = evaluateRecitation(expected, submitted, policy);

  expect(result.normalizedExpected).toBe(result.normalizedSubmitted);
  expect(result).toMatchObject({
    accuracy: 100,
    passed: true,
    differences: [],
  });
});

test("reports an omitted word and deducts one edit", () => {
  expect(
    evaluateRecitation("thy word is a lamp", "thy word a lamp", policy),
  ).toEqual({
    normalizedExpected: "thy word is a lamp",
    normalizedSubmitted: "thy word a lamp",
    differences: [
      {
        type: "omission",
        expected: "is",
        submitted: null,
        expectedIndex: 2,
        submittedIndex: 2,
      },
    ],
    accuracy: 80,
    passed: false,
    feedback: "Failed with 80% accuracy: 1 omitted word.",
  });
});

test("reports an inserted word and deducts one edit", () => {
  expect(
    evaluateRecitation("thy word is a lamp", "thy true word is a lamp", policy),
  ).toMatchObject({
    differences: [
      {
        type: "insertion",
        expected: null,
        submitted: "true",
        expectedIndex: 1,
        submittedIndex: 1,
      },
    ],
    accuracy: 80,
    passed: false,
    feedback: "Failed with 80% accuracy: 1 inserted word.",
  });
});

test("reports a substituted word without accepting it as a synonym", () => {
  expect(
    evaluateRecitation("thy word is a lamp", "thy speech is a lamp", policy),
  ).toMatchObject({
    differences: [
      {
        type: "substitution",
        expected: "word",
        submitted: "speech",
        expectedIndex: 1,
        submittedIndex: 1,
      },
    ],
    accuracy: 80,
    passed: false,
    feedback: "Failed with 80% accuracy: 1 substituted word.",
  });
});

test("aligns repeated words deterministically", () => {
  expect(
    evaluateRecitation(
      "be not overcome of evil",
      "be not not overcome of evil",
      policy,
    ).differences,
  ).toEqual([
    {
      type: "insertion",
      expected: null,
      submitted: "not",
      expectedIndex: 1,
      submittedIndex: 1,
    },
  ]);
});

test("an empty submission reports every expected word as omitted", () => {
  expect(evaluateRecitation("thy word is a lamp", "  ", policy)).toEqual({
    normalizedExpected: "thy word is a lamp",
    normalizedSubmitted: "",
    differences: [
      {
        type: "omission",
        expected: "thy",
        submitted: null,
        expectedIndex: 0,
        submittedIndex: 0,
      },
      {
        type: "omission",
        expected: "word",
        submitted: null,
        expectedIndex: 1,
        submittedIndex: 0,
      },
      {
        type: "omission",
        expected: "is",
        submitted: null,
        expectedIndex: 2,
        submittedIndex: 0,
      },
      {
        type: "omission",
        expected: "a",
        submitted: null,
        expectedIndex: 3,
        submittedIndex: 0,
      },
      {
        type: "omission",
        expected: "lamp",
        submitted: null,
        expectedIndex: 4,
        submittedIndex: 0,
      },
    ],
    accuracy: 0,
    passed: false,
    feedback: "Failed with 0% accuracy: 5 omitted words.",
  });
});

test("aligns a long KJV verse without losing a local omission", () => {
  const expected =
    "Then were the king’s scribes called at that time in the third month, that is, the month Sivan, on the three and twentieth day thereof; and it was written according to all that Mordecai commanded unto the Jews, and to the lieutenants, and the deputies and rulers of the provinces which are from India unto Ethiopia, an hundred twenty and seven provinces, unto every province according to the writing thereof, and unto every people after their language, and to the Jews according to their writing, and according to their language.";
  const submitted = expected.replace(
    "the deputies and rulers",
    "the deputies rulers",
  );
  const result = evaluateRecitation(expected, submitted, policy);

  expect(result.differences).toEqual([
    {
      type: "omission",
      expected: "and",
      submitted: null,
      expectedIndex: 45,
      submittedIndex: 45,
    },
  ]);
  expect(result.accuracy).toBeGreaterThan(98);
  expect(result.passed).toBe(true);
});

test("preserves KJV-specific wording as a meaningful difference", () => {
  const result = evaluateRecitation(
    "but be ye transformed",
    "but be you transformed",
    { passingAccuracy: 100 },
  );

  expect(result.differences).toEqual([
    {
      type: "substitution",
      expected: "ye",
      submitted: "you",
      expectedIndex: 2,
      submittedIndex: 2,
    },
  ]);
  expect(result).toMatchObject({ accuracy: 75, passed: false });
});

test("passes when accuracy equals the configured threshold", () => {
  expect(
    evaluateRecitation(
      "one two three four five six seven eight nine ten",
      "one two three four five six seven eight nine then",
      policy,
    ),
  ).toMatchObject({ accuracy: 90, passed: true });
});

test.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid passing accuracy %s",
  (passingAccuracy) => {
    expect(() =>
      evaluateRecitation("thy word", "thy word", { passingAccuracy }),
    ).toThrow("Passing accuracy must be a finite number from 0 to 100.");
  },
);

test("rejects expected text without a word", () => {
  expect(() => evaluateRecitation("¶ ...", "", policy)).toThrow(
    "Expected verse must contain at least one word.",
  );
});

test("exposes the evaluator's normalization for boundary validation", () => {
  expect(normalizeRecitationText(" ¶ ' ’ ... ")).toBe("");
  expect(normalizeRecitationText("  The king’s word! ")).toBe("the kings word");
});
