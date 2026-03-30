# Voice Features — MD Viewer

MD Viewer supports two voice modes: quick mic dictation in the chat panel, and a dedicated **Speak with docs** tab for full voice conversation.

---

## Quick voice input (mic button)

A mic button sits in the chat input row between the textarea and the Send button.

**How it works:**
- Click once → starts recording (button pulses red)
- Speak → live interim transcription appears in the textarea
- Silence or click again → stops recording; text is ready to review and send
- Click again or press Send → submits

**STT engine:** Uses Local Whisper by default (fully offline). Can be switched to Web Speech API in Settings → Voice.

**When to use:** Quick one-off dictation. Works like typing, but hands-free.

---

## Speak with docs (dedicated tab)

Click the **"Speak with docs"** button in the header to open a dedicated Speak tab. This replaces the old fullscreen voice overlay.

**How it works:**
1. The Speak tab opens with an inline voice panel
2. Speak → waveform responds to your voice in real time
3. Pause → your words are transcribed and sent to the AI
4. AI streams its response — text appears as karaoke-style subtitles
5. The assistant reads the reply aloud via system TTS (if enabled)
6. Listening automatically resumes after TTS finishes (turn-taking mode)
7. Switch away from the Speak tab to end the session

**UI elements:**
- **Waveform**: 32-bar frequency visualizer. Reacts to your mic in real time; plays a ripple animation while the AI is thinking
- **Status label**: `Listening...` / `Thinking...` / error states
- **Subtitles**: user speech right-aligned (white), AI response left-aligned (purple), animated in as they arrive
- **Stop button**: interrupts TTS mid-reply immediately
- **Settings shortcut**: quick access to Voice settings from within the panel

**When to use:** Extended hands-free conversations with your docs. The AI is tuned for spoken output — short, plain responses without heavy markdown formatting.

---

## Settings

**Settings → Voice → Speech-to-text engine**
- **System (Web Speech API)** — fast, streaming. Routes through OS/browser speech engine (may require network on some platforms)
- **Local Whisper** — fully offline, private. Downloads ~74 MB model on first use (cached in `{userData}/whisper-models/`)

**Settings → Voice → Speech language**
- `Auto` (default) — uses OS locale
- BCP-47 locale (e.g. `en-US`, `es-ES`, `ru-RU`) — improves STT accuracy when your spoken language differs from OS locale

**Settings → Voice → Text-to-speech (Speak mode)**
- **Read replies aloud** — toggle TTS on/off
- **Turn taking** — `Resume listening after TTS finishes` (default) or `Resume immediately`
- **Speech rate** — 0.75× to 1.5×, persisted across sessions
- **Voice** — pick from available system voices; `System default` falls back to OS default

**Settings → Voice → Whisper model**
- Shows current model name and download status
- Download / re-download the local Whisper model (`Xenova/whisper-base.en`, ~74 MB)
- Progress bar shown during download

All voice settings are persisted in `localStorage`.

| Key | Values |
|-----|--------|
| `voiceSttMode` | `whisper` \| `webspeech` |
| `voiceSpeechLanguage` | `auto` \| BCP-47 locale |
| `voiceTtsEnabled` | `1` \| `0` |
| `voiceTtsTurnTaking` | `resume_after_tts` \| `resume_immediately` |
| `voiceTtsRate` | float 0.75–1.5 |
| `voiceTtsVoiceUri` | SpeechSynthesisVoice URI or empty |

---

## Architecture

### Mic button — quick dictation
- `renderer.js`: `initVoice()`, `startVoice()`, `stopVoice()`, `decodeAndResampleAudio()`
- `navigator.mediaDevices.getUserMedia` → `AudioWorklet` (`voice-capture-worklet.js`) captures 16 kHz mono PCM
- On stop: Float32Array sent to main process via `window.mdviewer.whisperTranscribe()` IPC
- Button states: idle → recording (red pulse) → transcribing (amber pulse) → idle
- Mic stream released after a short idle delay to avoid keeping the mic hot between turns

### Local Whisper STT
- `whisper-worker.js`: dedicated Worker running `@xenova/transformers`
- Model: `Xenova/whisper-base.en` (~74 MB), downloaded once and cached in `{userData}/whisper-models/`
- Main process (`main.js`): `loadWhisperPipeline()` + IPC handlers `whisper-transcribe`, `whisper-get-status`
- Progress events sent back via `whisper-progress` IPC event
- `preload.js` exposes: `whisperTranscribe`, `whisperGetStatus`, `onWhisperProgress`
- Note: Web Speech API (`SpeechRecognition`) is not used in Electron — it routes through Google's cloud and fails in `file://` context with a `network` error

### System TTS (`SystemTtsQueue`)
- Uses `window.speechSynthesis` (Web Speech API TTS — available natively in Electron/Chromium)
- `ttsQueue.appendMarkdownDelta(chunk)` — accumulates streaming text, strips markdown, queues utterances
- `ttsQueue.flushFinal()` — ensures trailing text is spoken
- `ttsQueue.cancel()` — immediate stop (triggered by Stop button or session close)
- `ttsQueue.waitForIdle()` — awaits TTS completion before resuming STT (turn-taking)
- `ttsQueue.onSpeakingChange(cb)` — drives Stop button visibility

### Speak tab / VoiceMode
- `renderer.js`: `VoiceMode` class, `initVoiceMode()`, `openSpeakTab()`
- Speak tab is a virtual tab (`SPEAK_TAB = { type: 'speak', ... }`); switching to it shows the inline `#voice-overlay` panel
- `VoiceMode` manages the full listen → transcribe → send → stream → TTS → listen loop
- Web Audio `AnalyserNode` (`fftSize=64`) drives the waveform animation
- Silence detection: VAD in waveform animation loop; stops `MediaRecorder` after ~1.2s of silence following detected speech
- Multi-turn context: exchanges are pushed live to `chatMessagesData` so each AI turn has full conversation context
- AI output tuned for spoken delivery: `systemPromptSuffix` instructs the model to respond in short, plain sentences without lists or code blocks

---

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| Escape | Stop / close Speak mode (while in Speak tab) |

---

## Browser / platform support

| Feature | macOS | Windows | Linux |
|---------|-------|---------|-------|
| Mic button (Local Whisper) | ✅ | ✅ | ✅ |
| Mic button (Web Speech) | ✅ | ✅ | ⚠️ Chromium only |
| Speak tab (Local Whisper) | ✅ | ✅ | ✅ |
| Speak tab (Web Speech) | ✅ | ✅ | ⚠️ Chromium only |
| System TTS | ✅ | ✅ | ⚠️ Depends on OS voices |

Local Whisper is fully offline on all platforms once the model is downloaded. Web Speech API may route through the OS cloud STT engine on some platforms.
