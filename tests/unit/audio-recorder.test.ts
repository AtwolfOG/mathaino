import { describe, expect, test } from "vitest";
import {
  audioRecorderReducer,
  initialAudioRecorderState,
} from "@/ui/learning/audio-recorder";

describe("audio recording state", () => {
  test("moves from permission request through recording and upload", () => {
    let state = audioRecorderReducer(initialAudioRecorderState, {
      type: "request",
    });
    expect(state.status).toBe("requesting");

    state = audioRecorderReducer(state, { type: "start" });
    expect(state.status).toBe("recording");

    state = audioRecorderReducer(state, { type: "stop" });
    expect(state.status).toBe("stopping");

    state = audioRecorderReducer(state, { type: "upload" });
    expect(state.status).toBe("uploading");
  });

  test("represents unsupported browsers, failures and retry", () => {
    const unsupported = audioRecorderReducer(initialAudioRecorderState, {
      type: "unsupported",
      message: "Voice recording is not supported by this browser.",
    });
    expect(unsupported).toEqual({
      status: "unsupported",
      message: "Voice recording is not supported by this browser.",
    });

    const failed = audioRecorderReducer(
      { status: "recording", message: "" },
      { type: "fail", message: "Microphone access was denied." },
    );
    expect(failed).toEqual({
      status: "error",
      message: "Microphone access was denied.",
    });
    expect(audioRecorderReducer(failed, { type: "retry" })).toEqual(
      initialAudioRecorderState,
    );
  });

  test("ignores invalid late events instead of corrupting state", () => {
    expect(
      audioRecorderReducer(initialAudioRecorderState, { type: "upload" }),
    ).toEqual(initialAudioRecorderState);
  });

  test("cancels an active recording without entering upload", () => {
    expect(
      audioRecorderReducer(
        { status: "recording", message: "" },
        { type: "cancel" },
      ),
    ).toEqual(initialAudioRecorderState);
  });
});
