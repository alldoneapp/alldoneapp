# AT-2927: Assistant Mode queued note

Renders the shipped `AnnaMessageAuthor`, `MessageSendStatus`, React Native Web and the
Anna CSS in real Chromium, with the German strings of the reported screenshot. Only the
avatar and the translation service are stubbed.

Checks at 432px (the chat column of the report) and 320px (narrowest phone):

- nothing inside a message ends past the bubble's right edge, and the chat never scrolls sideways;
- the author name ("Du") keeps its width;
- "Jetzt senden" / "Entfernen" of a queued message are inside the bubble;
- the queued note is not faded with the rest of the queued message.

```sh
node browser-tests/at2927/run.js
```

`PLAYWRIGHT_MODULE` selects an external Playwright install. Against the code before the fix
the same run reports a 290px (432px) / 402px (320px) sideways overflow, a 0px author name
and invisible actions, i.e. the reported screenshot. Screenshots land in `screenshots/`.
jsdom computes no layout, which is why this check needs a browser.
