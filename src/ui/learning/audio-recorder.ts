export type AudioRecorderState = {
  status:
    | "idle"
    | "requesting"
    | "recording"
    | "stopping"
    | "uploading"
    | "ready"
    | "unsupported"
    | "error";
  message: string;
};

export type AudioRecorderEvent =
  | {
      type:
        | "cancel"
        | "request"
        | "start"
        | "stop"
        | "upload"
        | "complete"
        | "retry";
    }
  | { type: "unsupported" | "fail"; message: string };

export const initialAudioRecorderState: AudioRecorderState = {
  status: "idle",
  message: "",
};

export function audioRecorderReducer(
  state: AudioRecorderState,
  event: AudioRecorderEvent,
): AudioRecorderState {
  if (event.type === "unsupported")
    return { status: "unsupported", message: event.message };
  if (event.type === "fail") return { status: "error", message: event.message };
  if (event.type === "cancel") return initialAudioRecorderState;
  if (event.type === "retry") return initialAudioRecorderState;
  if (event.type === "request" && state.status === "idle")
    return { status: "requesting", message: "" };
  if (event.type === "start" && state.status === "requesting")
    return { status: "recording", message: "" };
  if (event.type === "stop" && state.status === "recording")
    return { status: "stopping", message: "" };
  if (event.type === "upload" && state.status === "stopping")
    return { status: "uploading", message: "" };
  if (event.type === "complete" && state.status === "uploading")
    return { status: "ready", message: "" };
  return state;
}
