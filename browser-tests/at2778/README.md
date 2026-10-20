# AT-2778 follow-up: audible Assistant Mode call setup

## Root cause and scope of evidence

The merged `ac1f17f11a87b6c2cb6e9dd1dc18ca5063c03b5b` starts feedback in
`useAssistantVoiceCall.startCall`. The Assistant Mode phone button in
`AnnaConversation.toggleVoiceCall` first awaits `resolveConversation()` and
`onBeforeSend()`. Throughout those operations the UI says “connecting”, but
there is **no tone, audio player, microphone or wake lease**. Playback starts
outside the original click. The previous tests exercised the provider directly,
missing this entry path. Other launchers (`AssistantVoiceCallButton`, including
its link variant) already entered the provider synchronously.

The browser runner loads the actual merged versions of those three modules
with `--baseline`, clicks the real Assistant Mode button, holds thread resolution
pending, and records digital silence from the OS output sink. The fixed code
produces a ring immediately in that same interval.

Gesture loss can additionally deny playback on restrictive browsers. We do not
claim to have reproduced a Safari suspension or an iPhone routing failure: the
report did not specify its device/browser. Chromium can retain audio activation
across asynchronous work, so a delayed start is not universally an autoplay
failure. The deterministic defect reproduced here is the silent preparation
interval, plus the original separate-context design's avoidable dependence on
Web Audio activation/routing.

## Change

- Enter the call provider in the phone click, before thread resolution and
  workspace handback. The provider owns audio, cancellation and the wake lease
  throughout preparation, and resolves today's authoritative target before mic
  capture or backend startup. Pending preparation is cancelled on unmount.
- Play an in-memory, valid PCM WAV through the **same media element** used for
  the remote conversation. This unlocks its playback immediately and avoids a
  separate ringback AudioContext. No asset request or dependency is added.
- Encode quietness in the waveform (0.08 peak, roughly -25 dBFS RMS; the former
  Web Audio waveform was 0.04 peak). Speech inherits full element volume and
  the selected speaker/headset route, not an attenuated gain setting.
- Buffer an early remote track until provider readiness and microphone
  preparation. Stop/reset the loop before attaching it and requesting the
  greeting. Cancellation, failure and retry stop the player and release the
  wake lease; generation guards ignore late results.
- Playback rejection exposes “Enable call audio” in the visible connecting
  overlay (the existing toolbar is hidden from accessibility during setup). Its click retries ringback; returning to the page and capture
  routing changes also nudge playback without restarting the ring's clock.

## Tests actually performed (2026-10-20)

Node 22.23.1: **389 tests passed in 13 suites**, covering the call provider,
Assistant Mode conversation/shell, ringback WAV/lifecycle, audio sessions,
background recovery, device selection, page context, provider readiness,
microphone capture, dictation and shared screen wake locks. New cases cover
pending target resolution, cancellation/error/unmount/account changes and an
immediate retry with a stale result.

Real **Chromium 156.0.8078.4** on Linux, default audio methods (no audio mocks,
no `--mute-audio`, no autoplay bypass), real media decoding and output through
PulseAudio into a 48 kHz mono null-sink monitor. Example measured values:

| Output interval                          |      RMS |     Peak | Result                                                     |
| ---------------------------------------- | -------: | -------: | ---------------------------------------------------------- |
| Merged baseline: thread lookup           |        0 |        0 | Silent; no audio element created                           |
| Fixed: thread lookup / ring              |   ~0.056 |   ~0.080 | 425 Hz ring reaches OS output                              |
| Four-second ring gap                     |        0 |        0 | Silence                                                    |
| Ring repeats while lookup pending        |    ~0.05 |   ~0.080 | Repeats on media clock                                     |
| Ready / remote silence                   | ~0.00071 | ~0.00101 | Ring stopped; existing 440 Hz background keepalive remains |
| Cancel / lookup failure / server failure |        0 |        0 | Player removed; no leftover ring                           |
| Retry after each failure/cancel          |  ~0.0566 |   ~0.080 | Ring reaches OS output again                               |

The fixture renders the **real AnnaConversation and real call hook**, with
backend/thread/handback promises controlled and WebRTC signaling faked. Browser
microphone capture uses Chromium's fake input device. This is a browser output
test, not a production OpenAI/Firebase call or a human listening through a
physical speaker. The runner also tests native browser autoplay denial by
starting on page mount (no Playwright evaluate-generated gesture), then records
recovery via the actual audio-enable button. The recorded baseline/fixed run is checked in as `measurements.chromium.json`. Fresh measurement JSON is written to
`.build/audio-measurements.json` and `.build-baseline/audio-measurements.json`.

Still required on physical devices: iPhone Safari/PWA/Capacitor and Android
Chrome/TWA, silent switch, volume, built-in speaker versus Bluetooth, microphone
permission prompt, app switching, and actual screen sleep prevention. Linux
Chromium does not establish those hardware guarantees. A Playwright WebKit
binary was downloaded but not run: its required Linux runtime libraries were
unavailable. No Safari result is claimed.

## Reproduce

Use Node 22 and the existing root and `web-bundler` dependencies. Install
Playwright/Chromium externally if needed and set `PLAYWRIGHT_HOME` to that
package directory and `CHROMIUM_EXECUTABLE_PATH` to the browser executable.

```sh
nvm use
npm test -- --runInBand components/UIComponents/AssistantVoiceCallButton.test.js components/UIComponents/assistantCallConnectingTone.test.js components/Anna/AnnaConversation.test.js utils/screenWakeLock.test.js
node browser-tests/at2778/run.js --baseline
node browser-tests/at2778/run.js
```

For **OS audio assertions**, run a user PulseAudio daemon with these modules
(use an isolated server/socket if another desktop audio session is active):

```text
load-module module-native-protocol-unix socket=/tmp/at2778-pulse.sock auth-anonymous=1
load-module module-null-sink sink_name=ringback rate=48000 channels=1
set-default-sink ringback
set-default-source ringback.monitor
```

Then set `PULSE_SERVER=unix:/tmp/at2778-pulse.sock` and `PAREC` to the absolute
`parec` executable path for **both** commands above. Keep other sound-producing
apps off that sink and run baseline/fixed checks sequentially. Without `PAREC`
the runner explicitly reports that it has not verified OS output. `--skip-build`
reuses the corresponding harness bundle. Application testing:
`nvm use && npm run dev`, open Assistant Mode, click the phone, then connect,
cancel, deny microphone permission and retry. No merge/deployment is part of
this follow-up.
