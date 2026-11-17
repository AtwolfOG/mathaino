"use client";

import { useState } from "react";
import { TypedRecitation, type TypedRecitationProps } from "./typed-recitation";
import { VoiceRecitation } from "./voice-recitation";
import type { VoiceProviderSet } from "./voice-recitation";

export function RecitationPractice(
  props: TypedRecitationProps & {
    localWhisperEnabled?: boolean;
    createVoiceProviders?: () => VoiceProviderSet;
  },
) {
  const [mode, setMode] = useState<"typing" | "voice">("typing");
  return mode === "typing" ? (
    <div className="recitation-practice">
      <button
        className="recitation-mode-switch"
        type="button"
        onClick={() => setMode("voice")}
      >
        Recite by voice
      </button>
      <TypedRecitation {...props} />
    </div>
  ) : (
    <VoiceRecitation
      {...props}
      createProviders={props.createVoiceProviders}
      onTypeInstead={() => setMode("typing")}
    />
  );
}
