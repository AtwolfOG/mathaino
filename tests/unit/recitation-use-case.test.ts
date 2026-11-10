import { expect, test, vi } from "vitest";
import {
  createRecitationService,
  RecitationValidationError,
  type RecitationAttemptStore,
} from "@/application/recitation";

const authentication = {
  getUserId: async () => "00000000-0000-4000-8000-000000000001",
};
const command = {
  itemId: "20000000-0000-4000-8000-000000000001",
  operationId: "40000000-0000-4000-8000-000000000001",
  text: "For God so loved the world",
};

test.each([
  ["successful", "For God so loved the world", true, 100],
  ["failed", "For God loved the world", false, 83.33],
] as const)(
  "grades and submits a %s typed recitation through the existing engine",
  async (_kind, text, passed, accuracy) => {
    const submit = vi.fn<RecitationAttemptStore["submit"]>(
      async (_authentication, _command, assess) => ({
        status: "recorded",
        evaluation: assess("For God so loved the world"),
        progress: {
          consecutiveDays: passed ? 1 : 0,
          masteryThreshold: 3,
          mastered: false,
          practiceStreak: 1,
        },
      }),
    );
    const result = await createRecitationService({ submit }).submit(
      authentication,
      { ...command, text },
    );

    expect(result.evaluation).toMatchObject({ passed, accuracy });
    expect(submit).toHaveBeenCalledOnce();
  },
);

test.each(["", "  ¶ ...  "])(
  "rejects empty typed input without persistence",
  async (text) => {
    const submit = vi.fn<RecitationAttemptStore["submit"]>();
    await expect(
      createRecitationService({ submit }).submit(authentication, {
        ...command,
        text,
      }),
    ).rejects.toBeInstanceOf(RecitationValidationError);
    expect(submit).not.toHaveBeenCalled();
  },
);

test("bounds Unicode characters and normalized words before grading", async () => {
  const service = createRecitationService({ submit: vi.fn() });
  await expect(
    service.submit(authentication, { ...command, text: "a".repeat(10_001) }),
  ).rejects.toThrow("10,000 characters or fewer");
  await expect(
    service.submit(authentication, {
      ...command,
      text: Array.from({ length: 1_001 }, () => "a").join(" "),
    }),
  ).rejects.toThrow("1,000 words or fewer");
});
