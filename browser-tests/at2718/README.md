# AT-2718 — object mentions in assistant mode

The fixture renders the real Anna composer, shared `CustomTextInput3`, Quill,
autoformat and mention portal. Search results, backend/navigation and visual
embeds are isolated. It never connects to Firebase or spends Gold.

Run with Node 22, the root and `web-bundler` dependencies, the repository's
`replacement_node_modules` overrides, and Playwright Chromium installed:

```sh
node browser-tests/at2718/run.js
```

For a separate Playwright install, set `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_BROWSERS_PATH`. A minimal Linux VM also needs Chromium's shared
libraries and font support. The fixture serves the application's Roboto font.

The runner checks 420px (sidebar), 390px and 320px layouts: native typing;
insertion and serialization of tasks, goals, cross-project notes, chats,
contacts and assistants; references surviving dictation and send; Enter picking
without sending; exactly one newline for Shift+Enter; voice locking the editor
and closing the picker without discarding the draft. The real portal stays in
the conversation while a separate Alldone workspace viewport is published.

Screenshots are written to the ignored `.build/` directory. The deterministic
picker and lightweight embeds do not verify live search, production chip styling
or a real microphone. Those behaviors continue to use the shared chat code.

Offline fixture screenshots: [sidebar](screenshots/sidebar-picker.png),
[phone](screenshots/phone-picker.png).
