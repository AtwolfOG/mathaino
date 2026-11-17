import type { AuthenticationContext } from "./authentication-context.ts";
import type { RecitationResult, RecitationService } from "./recitation.ts";

export interface AudioRecording {
  bytes: Uint8Array;
  mediaType: string;
  durationSeconds: number;
}

export interface TranscriptionProvider {
  transcribe(recording: AudioRecording): Promise<string>;
}

export interface VoiceRecitationCommand {
  itemId: string;
  operationId: string;
  recording: AudioRecording;
}

export interface VoiceRecitationResult extends RecitationResult {
  transcript: string;
}

export interface VoiceRecitationService {
  submit(
    authentication: AuthenticationContext,
    command: VoiceRecitationCommand,
  ): Promise<VoiceRecitationResult>;
}

export class TranscriptionError extends Error {}
export class TranscriptionTimeoutError extends TranscriptionError {}
export class NoSpeechDetectedError extends TranscriptionError {}

export function createVoiceRecitationService(
  provider: TranscriptionProvider,
  recitation: RecitationService,
): VoiceRecitationService {
  return {
    submit: async (authentication, command) => {
      const transcript = await provider.transcribe(command.recording);
      if (transcript.trim().length === 0)
        throw new NoSpeechDetectedError("No speech was detected. Try again.");
      const result = await recitation.submit(authentication, {
        itemId: command.itemId,
        operationId: command.operationId,
        text: transcript,
        mode: "voice",
      });
      return { ...result, transcript };
    },
  };
}
