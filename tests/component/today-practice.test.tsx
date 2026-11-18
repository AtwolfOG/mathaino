import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { LearningQueueView } from "@/application/learning-queue";
import {
  TranscriptionProviderError,
  type TranscriptionProvider,
} from "@/application/transcription";
import { TodayPractice } from "@/ui/learning/today-practice";
import type { VoiceProviderSet } from "@/ui/learning/voice-recitation";

const firstId = "20000000-0000-4000-8000-000000000001";
const secondId = "20000000-0000-4000-8000-000000000002";
const queue: LearningQueueView = {
  current: {
    id: firstId,
    translationId: "en-kjv",
    bookId: "john",
    bookName: "John",
    chapter: "3",
    verse: "16",
    text: "For God so loved the world.",
    status: "learning",
  },
  position: 1,
  total: 2,
  remaining: 1,
  version: 0,
  previousId: null,
  nextId: secondId,
};

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

function setMediaDevices(value: MediaDevices | undefined) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value,
  });
}

function fakeProvider(
  id: string,
  options: Partial<TranscriptionProvider> = {},
): TranscriptionProvider {
  return {
    id,
    label:
      id === "moonshine-base"
        ? "Moonshine Base"
        : id === "moonshine-tiny"
          ? "Moonshine Tiny"
          : id,
    requiresOnlineConsent: id === "online-web-speech",
    getCapability: vi.fn().mockResolvedValue({ supported: true }),
    initialize: vi.fn(async (onUpdate) => {
      onUpdate({ status: "ready" });
    }),
    transcribe: vi.fn().mockResolvedValue({
      text: "For God so loved the world",
      provider: { id, label: id },
    }),
    cleanup: vi.fn().mockResolvedValue(undefined),
    ...options,
  };
}

function fakeVoiceProviders(options?: {
  base?: TranscriptionProvider;
  tiny?: TranscriptionProvider;
  online?: TranscriptionProvider;
  nativeAvailability?: "available" | "downloadable" | "unavailable";
  local?: TranscriptionProvider;
}): VoiceProviderSet {
  const native = Object.assign(fakeProvider("native-web-speech"), {
    stop: vi.fn(),
    getEnglishAvailability: vi
      .fn()
      .mockResolvedValue(options?.nativeAvailability ?? "unavailable"),
    installEnglishLanguagePack: vi.fn().mockResolvedValue(true),
  });
  return {
    native,
    providers: [
      options?.base ?? fakeProvider("moonshine-base"),
      options?.tiny ?? fakeProvider("moonshine-tiny"),
      native,
      options?.online ??
        fakeProvider("online-web-speech", {
          getCapability: vi.fn().mockResolvedValue({ supported: false }),
        }),
      ...(options?.local ? [options.local] : []),
    ],
  };
}

test("Today presents one verse with status and queue progress", () => {
  render(<TodayPractice initialQueue={queue} />);
  expect(screen.getByRole("heading", { name: "John 3:16" })).toBeVisible();
  expect(screen.getByText("For God so loved the world.")).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reveal verse" }));
  expect(screen.getByText("For God so loved the world.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Hide verse" }));
  expect(screen.getByText("For God so loved the world.")).not.toBeVisible();
  expect(screen.getByText("Learning")).toBeVisible();
  expect(screen.getByText("1 of 2")).toBeVisible();
  expect(screen.getByText("1 verse remaining")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous verse" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next verse" })).toBeEnabled();
});

test("keyboard submission displays accuracy, differences and pass feedback", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        status: "recorded",
        evaluation: {
          normalizedExpected: "for god so loved the world",
          normalizedSubmitted: "for god loved the world",
          differences: [
            {
              type: "omission",
              expected: "so",
              submitted: null,
              expectedIndex: 2,
              submittedIndex: 2,
            },
          ],
          accuracy: 83.33,
          passed: false,
          feedback: "Failed with 83.33% accuracy: 1 omitted word.",
        },
        progress: {
          consecutiveDays: 0,
          masteryThreshold: 3,
          mastered: false,
          practiceStreak: 1,
        },
      },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  const input = screen.getByLabelText("Type John 3:16");
  fireEvent.change(input, { target: { value: "For God loved the world" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });

  await waitFor(() =>
    expect(screen.getByText("83.33% accuracy")).toBeVisible(),
  );
  expect(
    screen.getByRole("heading", { name: "Keep practising" }),
  ).toBeVisible();
  expect(screen.getByText("Missing “so”")).toBeVisible();
  expect(screen.getByText("Practice streak: 1 day")).toBeVisible();
  expect(fetch).toHaveBeenCalledOnce();
  const options = fetch.mock.calls[0]?.[1] as RequestInit;
  expect(fetch.mock.calls[0]?.[0]).toBe("/api/recitation-attempts");
  expect(JSON.parse(String(options.body))).toMatchObject({
    itemId: firstId,
    text: "For God loved the world",
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});

test("empty input is explained and duplicate pending submissions are prevented", async () => {
  let resolve: ((value: Response) => void) | undefined;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  fireEvent.click(screen.getByRole("button", { name: "Check recitation" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Type your recitation before submitting.",
  );
  fireEvent.change(screen.getByLabelText("Type John 3:16"), {
    target: { value: "For God so loved the world" },
  });
  const submit = screen.getByRole("button", { name: "Check recitation" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(fetch).toHaveBeenCalledOnce();
  expect(submit).toBeDisabled();
  resolve?.(Response.json({ error: "failed" }, { status: 500 }));
});

test("an intentional retry clears feedback and focuses a fresh recitation", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        status: "recorded",
        evaluation: {
          normalizedExpected: "for god so loved the world",
          normalizedSubmitted: "wrong",
          differences: [],
          accuracy: 0,
          passed: false,
          feedback: "Failed.",
        },
        progress: {
          consecutiveDays: 0,
          masteryThreshold: 3,
          mastered: false,
          practiceStreak: 1,
        },
      },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);
  const input = screen.getByLabelText("Type John 3:16");
  fireEvent.change(input, { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Check recitation" }));
  await screen.findByRole("button", { name: "Try again" });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(input).toHaveValue("");
  await waitFor(() => expect(input).toHaveFocus());
  expect(screen.queryByText("0% accuracy")).not.toBeInTheDocument();
});

test("keeps typed recitation available when browser recording is unsupported", async () => {
  setMediaDevices(undefined);
  vi.stubGlobal("MediaRecorder", undefined);
  render(<TodayPractice initialQueue={queue} />);

  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Voice recording is not supported by this browser.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
  expect(screen.getByLabelText("Type John 3:16")).toBeVisible();
});

test("offers an accessible provider selector and safely restores a versioned preference", () => {
  setMediaDevices({ getUserMedia: vi.fn() } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  localStorage.setItem(
    "mathaino:speech-recognition-mode:v1",
    JSON.stringify({ version: 1, mode: "moonshine-tiny" }),
  );
  const providers = fakeVoiceProviders();
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));

  expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
    "moonshine-tiny",
  );
  expect(screen.getByRole("option", { name: "Automatic" })).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Moonshine Base" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Moonshine Tiny" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Type instead" })).toBeVisible();
});

test("falls back to Automatic when a stored mode is unavailable", async () => {
  localStorage.setItem(
    "mathaino:speech-recognition-mode:v1",
    JSON.stringify({ version: 1, mode: "local-whisper" }),
  );
  render(<TodayPractice initialQueue={queue} />);
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));

  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "automatic",
    ),
  );
  expect(
    JSON.parse(
      localStorage.getItem("mathaino:speech-recognition-mode:v1") ?? "{}",
    ),
  ).toEqual({ version: 1, mode: "automatic" });
});

test("explains microphone denial and allows a typed fallback", async () => {
  setMediaDevices({
    getUserMedia: vi
      .fn()
      .mockRejectedValue(new DOMException("denied", "NotAllowedError")),
  } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const providers = fakeVoiceProviders();
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Microphone access was denied.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Type instead" }));
  expect(screen.getByLabelText("Type John 3:16")).toBeVisible();
});

test.each(["constructor", "start"] as const)(
  "releases the microphone when recorder %s fails",
  async (failurePoint) => {
    const stopTrack = vi.fn();
    setMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: stopTrack }],
      }),
    } as unknown as MediaDevices);
    class Recorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      ondataavailable = null;
      onstop = null;
      onerror = null;
      constructor() {
        if (failurePoint === "constructor") throw new Error("Recorder failed.");
      }
      start() {
        if (failurePoint === "start") throw new Error("Recorder failed.");
      }
      stop() {}
    }
    vi.stubGlobal("MediaRecorder", Recorder);
    render(
      <TodayPractice
        initialQueue={queue}
        createVoiceProviders={() => fakeVoiceProviders()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
    fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recorder failed.",
    );
    expect(stopTrack).toHaveBeenCalledOnce();
  },
);

test("records a supported browser format and shows the transcript with grading", async () => {
  const stopTrack = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: stopTrack }],
  });
  setMediaDevices({ getUserMedia } as unknown as MediaDevices);

  class Recorder {
    static isTypeSupported(type: string) {
      return type === "audio/ogg;codecs=opus";
    }
    state = "inactive";
    mimeType = "audio/ogg;codecs=opus";
    ondataavailable: ((event: BlobEvent) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({
        data: new Blob([new Uint8Array([1, 2, 3])], { type: this.mimeType }),
      } as BlobEvent);
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  let now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const fetch = vi.fn().mockResolvedValue(
    Response.json(
      {
        status: "recorded",
        transcript: "For God so loved the world",
        evaluation: {
          normalizedExpected: "for god so loved the world",
          normalizedSubmitted: "for god so loved the world",
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
      },
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetch);
  const providers = fakeVoiceProviders();
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByRole("button", { name: "Stop recording" });
  now = 2_000;
  fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));

  await waitFor(() => expect(screen.getByText("100% accuracy")).toBeVisible());
  expect(screen.getByText("For God so loved the world")).toBeVisible();
  expect(stopTrack).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0]!;
  expect(url).toBe("/api/voice-recitation-attempts");
  expect(options.method).toBe("POST");
  expect(options.headers).toEqual({ "content-type": "application/json" });
  expect(JSON.parse(String(options.body))).toEqual({
    itemId: firstId,
    operationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    text: "For God so loved the world",
  });
  expect(fetch).not.toHaveBeenCalledWith(
    "/api/local-whisper-transcriptions",
    expect.anything(),
  );
});

test("automatic mode falls back from Base initialization to Tiny", async () => {
  setMediaDevices({
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
  } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    ondataavailable = null;
    onstop = null;
    onerror = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const failure = new TranscriptionProviderError({
    code: "model-failed",
    message: "Base model failed.",
    recoverable: true,
    providerId: "moonshine-base",
  });
  const base = fakeProvider("moonshine-base", {
    initialize: vi.fn().mockRejectedValue(failure),
  });
  const tiny = fakeProvider("moonshine-tiny");
  const providers = fakeVoiceProviders({ base, tiny });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  await screen.findByRole("button", { name: "Stop recording" });
  expect(base.initialize).toHaveBeenCalledOnce();
  expect(base.cleanup).toHaveBeenCalledOnce();
  expect(tiny.initialize).toHaveBeenCalledOnce();
  expect(screen.getByText("Active provider: Moonshine Tiny")).toBeVisible();
});

test("a manual provider failure does not silently switch providers", async () => {
  setMediaDevices({ getUserMedia: vi.fn() } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const base = fakeProvider("moonshine-base", {
    initialize: vi.fn().mockRejectedValue(new Error("Base unavailable.")),
  });
  const tiny = fakeProvider("moonshine-tiny");
  const providers = fakeVoiceProviders({ base, tiny });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "moonshine-base" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "moonshine-base",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Base unavailable.",
  );
  expect(base.initialize).toHaveBeenCalledOnce();
  expect(tiny.initialize).not.toHaveBeenCalled();
});

test("online browser speech initializes only after explicit per-selection consent", async () => {
  const online = fakeProvider("online-web-speech");
  const providers = fakeVoiceProviders({ online });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  const select = await screen.findByLabelText("Speech recognition mode");
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Online browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(select, { target: { value: "online-web-speech" } });

  await waitFor(() => expect(select).toHaveValue("online-web-speech"));

  expect(screen.getByText(/browser vendor for processing/i)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Start recording" }),
  ).toBeDisabled();
  expect(online.initialize).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Allow online recognition" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await waitFor(() => expect(online.initialize).toHaveBeenCalledOnce());
});

test("switching to typing aborts transcript submission and ignores its response", async () => {
  const online = fakeProvider("online-web-speech");
  const providers = fakeVoiceProviders({ online });
  let submissionSignal: AbortSignal | undefined;
  const fetch = vi.fn(
    (_url: string, options?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        submissionSignal = options?.signal as AbortSignal;
        submissionSignal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Online browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "online-web-speech" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "online-web-speech",
    ),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Allow online recognition" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());

  fireEvent.click(screen.getByRole("button", { name: "Type instead" }));

  await waitFor(() => expect(submissionSignal?.aborted).toBe(true));
  expect(screen.getByLabelText("Type John 3:16")).toBeVisible();
  expect(screen.queryByText("Transcript")).not.toBeInTheDocument();
});

test("retries an uncertain voice save with the same transcript and operation id", async () => {
  const online = fakeProvider("online-web-speech");
  const providers = fakeVoiceProviders({ online });
  const saved = {
    status: "recorded" as const,
    evaluation: {
      normalizedExpected: "for god so loved the world",
      normalizedSubmitted: "for god so loved the world",
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
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(Response.json(saved, { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Online browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "online-web-speech" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Allow online recognition" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  const retrySave = await screen.findByRole("button", {
    name: "Try saving again",
  });
  const firstBody = JSON.parse(
    String((fetch.mock.calls[0]?.[1] as RequestInit).body),
  );
  fireEvent.click(retrySave);

  await screen.findByText("100% accuracy");
  const secondBody = JSON.parse(
    String((fetch.mock.calls[1]?.[1] as RequestInit).body),
  );
  expect(secondBody).toEqual(firstBody);
  expect(secondBody.text).toBe("For God so loved the world");
  expect(online.transcribe).toHaveBeenCalledOnce();
});

test("keeps an uncertain transcript retryable after a confirmed HTTP failure", async () => {
  const online = fakeProvider("online-web-speech");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError("response lost"))
    .mockResolvedValueOnce(
      Response.json(
        { error: "Saving is temporarily unavailable." },
        { status: 500 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          status: "recorded",
          evaluation: {
            normalizedExpected: "for god so loved the world",
            normalizedSubmitted: "for god so loved the world",
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
        },
        { status: 201 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => fakeVoiceProviders({ online })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "Online browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "online-web-speech" },
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Allow online recognition" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  fireEvent.click(
    await screen.findByRole("button", { name: "Try saving again" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Saving is temporarily unavailable.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try saving again" }));

  await screen.findByText("100% accuracy");
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(online.transcribe).toHaveBeenCalledOnce();
});

test("native downloadable speech exposes an explicit language pack install action", async () => {
  const providers = fakeVoiceProviders({ nativeAvailability: "downloadable" });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "On-device browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "native-web-speech" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "native-web-speech",
    ),
  );
  expect(
    screen.getByRole("button", {
      name: "Install on-device English language pack",
    }),
  ).toBeVisible();
  expect(providers.native.installEnglishLanguagePack).not.toHaveBeenCalled();
});

test("native downloading speech can be checked again explicitly", async () => {
  const providers = fakeVoiceProviders();
  vi.mocked(providers.native.getEnglishAvailability)
    .mockResolvedValueOnce("downloading")
    .mockResolvedValueOnce("available");
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  await waitFor(() =>
    expect(
      screen.getByRole("option", { name: "On-device browser speech" }),
    ).toBeInTheDocument(),
  );
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "native-web-speech" },
  });

  fireEvent.click(
    await screen.findByRole("button", {
      name: "Check on-device English language pack",
    }),
  );

  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Start recording" }),
    ).toBeEnabled(),
  );
  expect(providers.native.installEnglishLanguagePack).not.toHaveBeenCalled();
});

test("mode switching cancels provider initialization and ignores its stale completion", async () => {
  setMediaDevices({ getUserMedia: vi.fn() } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  let rejectInitialization: ((error: unknown) => void) | undefined;
  const cancelled = new TranscriptionProviderError({
    code: "cancelled",
    message: "Cancelled.",
    recoverable: true,
    providerId: "moonshine-base",
  });
  const base = fakeProvider("moonshine-base", {
    initialize: vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInitialization = reject;
        }),
    ),
    cleanup: vi.fn(async () => rejectInitialization?.(cancelled)),
  });
  const providers = fakeVoiceProviders({ base });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "moonshine-base" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "moonshine-base",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));
  await screen.findByText("Preparing speech recognition.");
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "moonshine-tiny" },
  });

  await waitFor(() => expect(base.cleanup).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
    "moonshine-tiny",
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("announces model download progress without claiming readiness", async () => {
  setMediaDevices({ getUserMedia: vi.fn() } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const base = fakeProvider("moonshine-base", {
    initialize: vi.fn(
      (onUpdate) =>
        new Promise<void>(() => {
          onUpdate({
            status: "progress",
            progress: 0.4,
            message: "Downloading model.",
          });
        }),
    ),
  });
  const providers = fakeVoiceProviders({ base });
  render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  fireEvent.change(screen.getByLabelText("Speech recognition mode"), {
    target: { value: "moonshine-base" },
  });
  await waitFor(() =>
    expect(screen.getByLabelText("Speech recognition mode")).toHaveValue(
      "moonshine-base",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Start recording" }));

  expect(await screen.findByText("Downloading model.")).toBeVisible();
  expect(screen.getByText("Active provider: Moonshine Base")).toBeVisible();
  expect(screen.getByLabelText("Model download progress")).toHaveValue(0.4);
  expect(screen.queryByText(/model ready/i)).not.toBeInTheDocument();
});

test("shows Local Whisper only when development mode and its provider are enabled", () => {
  setMediaDevices({ getUserMedia: vi.fn() } as unknown as MediaDevices);
  class Recorder {
    static isTypeSupported() {
      return true;
    }
  }
  vi.stubGlobal("MediaRecorder", Recorder);
  const providers = fakeVoiceProviders();
  const view = render(
    <TodayPractice
      initialQueue={queue}
      createVoiceProviders={() => providers}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  expect(
    screen.queryByRole("option", { name: "Local Whisper (development)" }),
  ).not.toBeInTheDocument();
  view.unmount();

  const enabledWithoutProvider = render(
    <TodayPractice
      initialQueue={queue}
      localWhisperEnabled
      createVoiceProviders={() => fakeVoiceProviders()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  expect(
    screen.queryByRole("option", { name: "Local Whisper (development)" }),
  ).not.toBeInTheDocument();

  enabledWithoutProvider.unmount();
  render(
    <TodayPractice
      initialQueue={queue}
      localWhisperEnabled
      createVoiceProviders={() =>
        fakeVoiceProviders({ local: fakeProvider("local-whisper") })
      }
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Recite by voice" }));
  expect(
    screen.getByRole("option", { name: "Local Whisper (development)" }),
  ).toBeInTheDocument();
});

test("due reviews submit typed recall and reload the authoritative queue", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        {
          status: "recorded",
          evaluation: {
            normalizedExpected: "for god so loved the world",
            normalizedSubmitted: "for god so loved the world",
            differences: [],
            accuracy: 100,
            passed: true,
            feedback: "Perfect match: no word differences.",
          },
          schedule: {
            stage: 1,
            intervalDays: 3,
            nextDueAt: "2026-01-05T12:00:00.000Z",
          },
        },
        { status: 201 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json(
        {
          queue: {
            current: null,
            position: 0,
            total: 0,
            remaining: 0,
            version: 0,
            previousId: null,
            nextId: null,
          },
        },
        { status: 200 },
      ),
    );
  vi.stubGlobal("fetch", fetch);
  render(
    <TodayPractice
      initialQueue={{
        ...queue,
        current: { ...queue.current!, status: "review-due" },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Review John 3:16"), {
    target: { value: "For God so loved the world" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check review" }));

  await waitFor(() =>
    expect(
      screen.getByRole("heading", { name: "Nothing queued today" }),
    ).toBeVisible(),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Review saved. Next review in 3 days.",
  );
  expect(fetch).toHaveBeenNthCalledWith(1, "/api/review-attempts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: expect.stringContaining(`"itemId":"${firstId}"`),
  });
  expect(fetch).toHaveBeenNthCalledWith(2, "/api/learning-queue");
});

test("queue navigation persists before showing the next verse", async () => {
  const next: LearningQueueView = {
    ...queue,
    current: {
      ...queue.current!,
      id: secondId,
      verse: "17",
      text: "The next verse.",
      status: "review-due",
    },
    position: 2,
    remaining: 0,
    version: 1,
    previousId: firstId,
    nextId: null,
  };
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ queue: next }, { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(<TodayPractice initialQueue={queue} />);

  fireEvent.click(screen.getByRole("button", { name: "Next verse" }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: "John 3:17" })).toBeVisible(),
  );
  expect(fetch).toHaveBeenCalledWith("/api/learning-queue", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ itemId: secondId, expectedVersion: 0 }),
  });
  expect(screen.getByText("Review due")).toBeVisible();
  expect(screen.getByText("No verses remaining")).toBeVisible();
});

test("an empty Today queue directs the learner to the Bible", () => {
  render(
    <TodayPractice
      initialQueue={{
        current: null,
        position: 0,
        total: 0,
        remaining: 0,
        version: 0,
        previousId: null,
        nextId: null,
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Nothing queued today" }),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Choose verses" })).toHaveAttribute(
    "href",
    "/bible",
  );
});
