# Voice Features — MD Viewer

MD Viewer supports two voice input modes, both accessible directly from the chat panel.

---

## Quick voice input (mic button)

A small mic button sits between the textarea and the Send button in the chat input row.

**How it works:**
- Click once → starts recording (button pulses red)
- Speak → live interim transcription appears in the textarea as you talk
- Silence or click again → stops recording, text is ready to review and send
- Uses the **Web Speech API** (your OS/browser speech engine — no download needed)

**When to use:** Quick one-off dictation. Works like typing, but hands-free.

---

## Voice conversation mode (AI Voice overlay)

A **"Voice"** button in the model row (bottom-left of the chat panel) opens a full-screen voice conversation experience.

**How it works:**
1. Click **Voice** → full-screen dark overlay opens
2. Speak your message → waveform responds to your voice in real time
3. Pause → your words are sent to the AI model
4. AI streams back its response — text appears as karaoke-style subtitles
5. Listening automatically resumes after the AI finishes
6. Loop continues until you press **×** or **Escape**
7. On close → the entire conversation is committed to the active chat session

**UI elements:**
- **Waveform** (center): 32-bar frequency visualizer using Web Audio API. Reacts to your mic in real time. During AI thinking it plays a gentle ripple animation.
- **Status label**: LISTENING... / THINKING... / error messages
- **Subtitles** (below waveform): user speech aligned right (white), AI response aligned left (purple). New entries animate in.
- **× button** (top-right) / **Escape**: close and commit to chat

**When to use:** Extended back-and-forth conversations, when you want a hands-free experience, or when you want to see the dialogue play out visually before it lands in the chat.

---

## Architecture

### Phase 1 — MediaRecorder + Whisper (mic button)
- `renderer.js`: `initVoice()`, `startVoice()`, `stopVoice()`, `decodeAndResampleAudio()`
- `navigator.mediaDevices.getUserMedia` → `MediaRecorder` → audio blob
- On stop: `AudioContext.decodeAudioData()` + `OfflineAudioContext` resampling to 16 kHz mono Float32Array
- Sent to main process via `window.mdviewer.whisperTranscribe()` IPC
- Button states: idle → recording (red pulse) → transcribing (amber pulse) → idle
- Note: Web Speech API (`SpeechRecognition`) is not used — it routes through Google's cloud and fails in Electron's `file://` context with a `network` error

### Phase 2 — Local Whisper STT (foundation shipped, UI toggle coming)
- `main.js`: `loadWhisperPipeline()` + IPC handlers `whisper-transcribe`, `whisper-get-status`
- Uses `@xenova/transformers` (already a dep) with model `Xenova/whisper-base.en` (~74 MB)
- Model is downloaded once and cached in `{userData}/whisper-models/`
- Audio capture: `MediaRecorder` → `AudioContext.decodeAudioData()` → resample to 16 kHz Float32Array → IPC → Whisper
- Progress events sent back via `whisper-progress` IPC event
- `preload.js`: `whisperTranscribe`, `whisperGetStatus`, `onWhisperProgress`
- Settings: Voice → Speech-to-text engine → **System** / **Local Whisper** (toggle enables once wired up)

### Phase 3 — VoiceMode overlay (shipped)
- `renderer.js`: `VoiceMode` class, `initVoiceMode()`
- Web Audio API `AnalyserNode` with `fftSize=64` for real-time waveform
- **Silence detection** built into the waveform animation loop: tracks `maxFrequencyValue > threshold` frames; stops `MediaRecorder` after ~1.2s of silence following detected speech
- Audio recorded via `MediaRecorder` on the same mic stream as the waveform analyser
- Transcription: `decodeAndResampleAudio()` → `whisperTranscribe` IPC (same as mic button)
- AI calls reuse existing `chatCompletionStream` / `chatCompletion` IPC with shared `streamChunkHandler`/`streamDoneHandler` globals
- Exchanges pushed live to `chatMessagesData` for correct context window on multi-turn
- On close: calls `renderChatMessages()` + `saveChatMessages()` for persistence

---

## Settings

**Settings → Voice → Speech-to-text engine**
- **System (Web Speech API)** — default. Fast, streaming. Uses OS/browser engine.
- **Local Whisper** *(coming soon)* — fully offline, private. Downloads ~74 MB on first use.

STT mode preference is persisted in `localStorage` under the key `voiceSttMode`.

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Escape | Close voice overlay |

---

## Browser / platform support

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Mic button (Web Speech) | ✅ | ✅ | ⚠️ Chromium only |
| Voice overlay (Web Speech) | ✅ | ✅ | ⚠️ Chromium only |
| Local Whisper | ✅ | ✅ | ✅ (coming soon) |

Web Speech API requires a network connection on some platforms (it may route through the OS cloud STT engine). Whisper is fully local once the model is downloaded.
