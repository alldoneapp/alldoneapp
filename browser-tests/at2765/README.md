# AT-2765: voice connection feedback

Start the app with Node 22 / npm 10 and `npm run dev`. In Assisted Mode, click the phone in the chat composer. The connecting card appears immediately, including while resolving the conversation or requesting microphone permission. Cancel returns to the idle composer; a successful connection replaces the card with the call duration. Errors retain the existing message and allow another attempt. Standard chat uses the same card in its floating call controls.

Focused regression checks:

```bash
npm test -- --runInBand --watch=false --runTestsByPath \
  components/Anna/AnnaConversation.test.js \
  components/UIComponents/AssistantVoiceCallButton.test.js \
  components/UIComponents/VoiceCallConnecting.test.js \
  components/UIComponents/assistantLiveConnection.test.js \
  components/UIComponents/assistantCallBackground.test.js \
  components/UIComponents/Ghosts/ghostAnimation.test.js
```

For the browser check, install the separate `web-bundler` dependencies if missing, and make Playwright and its Chromium browser/system dependencies available. Then run:

```bash
node browser-tests/at2765/run.js
```

This compiles the actual connecting component through the app's webpack configuration and checks rotation, German text, horizontal overflow at 390px/1280px, and switching reduced motion on while connecting. It saves a mobile screenshot to `.build/connecting.png`. It needs no login, microphone, or paid voice session; call lifecycle behavior is covered by the Jest suites. `NODE_PATH` can point at an external Playwright installation.
