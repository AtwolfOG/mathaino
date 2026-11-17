import { expect, test, vi } from "vitest";
import type { RecitationService } from "@/application/recitation";
import {
  createVoiceRecitationService,
  NoSpeechDetectedError,
  type TranscriptionProvider,
} from "@/application/voice-recitation";

const authentication = {
  getUserId: async () => "00000000-0000-4000-8000-000000000001",
};
const command = {
  itemId: "20000000-0000-4000-8000-000000000001",
  operationId: "40000000-0000-4000-8000-000000000001",
  recording: {
    bytes: new Uint8Array([1, 2, 3]),
    mediaType: "audio/webm",
    durationSeconds: 4.5,
  },
};
const result = {
  status: "recorded" as const,
  evaluation: {
    normalizedExpected: "thy word",
    normalizedSubmitted: "thy word",
    differences: [],
    accuracy: 100,
    passed: true,
    feedback: "Perfect match: no word differences.",
  },
  progress: {
    consecutiveDays: 1,
    masteryThreshold: 3,
    mastered: false,
    practiceStreak: 1,
  },
};

test("grades the final provider transcript through the existing recitation service", async () => {
  const provider: TranscriptionProvider = {
    transcribe: vi.fn().mockResolvedValue("Thy word"),
  };
  const submit = vi.fn<RecitationService["submit"]>().mockResolvedValue(result);

  await expect(
    createVoiceRecitationService(provider, { submit }).submit(
      authentication,
      command,
    ),
  ).resolves.toEqual({ ...result, transcript: "Thy word" });
  expect(provider.transcribe).toHaveBeenCalledWith(command.recording);
  expect(submit).toHaveBeenCalledWith(authentication, {
    itemId: command.itemId,
    operationId: command.operationId,
    text: "Thy word",
    mode: "voice",
  });
});

test.each(["", "   "])(
  "rejects a silent final transcript without grading",
  async (transcript) => {
    const submit = vi.fn<RecitationService["submit"]>();
    const service = createVoiceRecitationService(
      { transcribe: async () => transcript },
      { submit },
    );
    await expect(
      service.submit(authentication, command),
    ).rejects.toBeInstanceOf(NoSpeechDetectedError);
    expect(submit).not.toHaveBeenCalled();
  },
);
