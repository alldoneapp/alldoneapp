# Assistant models, November 2026 (AT-3163)

Every assistant tier now runs on its provider's newest release, and the superseded releases are no
longer offered anywhere. The product keys are unchanged, so assistants, chat overrides, heartbeats,
inbound email, scheduled tasks, Gmail labeling and calendar routing follow the new release without
a Firestore migration.

## In-app assistant menu

| Stored key                | Before                                       | Now                                                  | Tokens/Gold       |
| ------------------------- | -------------------------------------------- | ---------------------------------------------------- | ----------------- |
| `MODEL_GPT6_SOL`          | GPT 6.1 Sol (`gpt-6.1-sol`)                  | **GPT 6.2 Sol** (`gpt-6.2-sol`)                      | 200 (unchanged)   |
| `MODEL_GPT5_6_TERRA`      | GPT 5.6 Terra (`gpt-5.6-terra`)              | **GPT 6.1 Terra** (`gpt-6.1-terra`)                  | **400** (was 200) |
| `MODEL_GPT6_LUNA`         | GPT 6 Luna (`gpt-6-luna`)                    | GPT 6 Luna (still the newest Luna)                   | 1000 (unchanged)  |
| `MODEL_DEEPSEEK_V4_FLASH` | DeepSeek V4 Flash (`deepseek-v4-flash-0731`) | **DeepSeek V4.1 Flash** (`deepseek-v4.1-flash-1017`) | 2000 (unchanged)  |

Keys replaced earlier still normalize as before (`MODEL_GPT5_6_SOL` → Sol, `MODEL_GPT5_6_LUNA` →
Luna). The Gold rates are product decisions taken with the task owner on 2026-11-26: Terra passes
its 50% price drop through 1:1 (it lists at exactly half of Sol); DeepSeek keeps 2000.

Reasoning options are unchanged: 6.2 Sol rejects `none` like 6.1 Sol, so Sol pickers still omit it
and a saved `none` still resolves to `high`; Terra and Luna accept `none` through `max`. Tool search,
prompt caching and the 1,050,000-token window apply to all three OpenAI releases. DeepSeek V4.1 Flash
accepts images, so `assistantModelSupportsImageInput` now answers `true` for it.

## Verified upstream prices (2026-11-26, USD per 1M tokens, Standard, ≤272K input)

| Model                               |  Input | Cached input | Cache write | Output |
| ----------------------------------- | -----: | -----------: | ----------: | -----: |
| `gpt-6.2-astra` (VM only)           |   8.00 |         0.40 |       10.00 |  40.00 |
| `gpt-6.2-sol`                       |   2.00 |         0.10 |        2.50 |  10.00 |
| `gpt-6.1-terra`                     |   1.00 |         0.05 |        1.25 |   5.00 |
| `gpt-6-luna`                        |   0.10 |         0.01 |       0.125 |   0.50 |
| `deepseek/deepseek-v4.1-flash-1017` | 0.30\* |      0.006\* |           – | 1.20\* |

Above 272K input tokens OpenAI doubles input and cache rates and charges 1.5x output for the whole
request (unchanged, `solModelPricing.js`). \*OpenRouter's headline for the 1017 snapshot is DeepSeek's
own peak-hour price (off-peak $0.15 / $0.60). Its endpoints list currently ranges from about
$0.04–0.30 input and $0.10–1.20 output across hosts; the app does not pin a host, so OpenRouter's
default price-weighted routing applies. At DeepSeek's first-party peak price V4.1 Flash costs more per
token than Luna while being billed at twice Luna's tokens per Gold — watch the OpenRouter bill after
rollout. DeepSeek's own pricing page lists V4 Flash as retired (the legacy name is served by
V4.1-Flash-1017); OpenRouter still routes `deepseek-v4-flash-0731` to third-party hosts.

Sources:
[OpenAI models](https://developers.openai.com/api/docs/models),
[gpt-6.2-sol](https://developers.openai.com/api/docs/models/gpt-6.2-sol),
[gpt-6.1-terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra),
[gpt-6-luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[gpt-6.2-astra](https://developers.openai.com/api/docs/models/gpt-6.2-astra),
[reasoning effort](https://developers.openai.com/api/docs/guides/reasoning),
[deprecations](https://developers.openai.com/api/docs/deprecations),
[OpenRouter models API](https://openrouter.ai/api/v1/models),
[OpenRouter V4.1 Flash 1017 endpoints](https://openrouter.ai/api/v1/models/deepseek/deepseek-v4.1-flash-1017/endpoints),
[DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing).

## VM agent (Codex)

- The default Codex model is `gpt-6.2-sol`. Live discovery already picks the newest release per family;
  the static fallback now lists `gpt-6.2-astra`, `gpt-6.2-sol`, `gpt-6.1-terra`, `gpt-6-luna`.
- `codexModelReplacements.js` maps superseded concrete ids to their replacement wherever a saved
  choice is read: user defaults and run overrides (`vmJob.normalizeAgentModel`), the runner
  (`resolveAgentRunDetails`), and cached catalogs (the catalog schema is bumped to 5 so old caches
  refresh immediately). `gpt-6-sol`/`gpt-6.1-sol` → `gpt-6.2-sol`, `gpt-5.6-terra` → `gpt-6.1-terra`,
  `gpt-6-astra` → `gpt-6.2-astra`.
- VM rates derive from the prices above with the unchanged formula: Astra 60 tokens/Gold (6 Astra
  was 40), Sol 240, Terra 480 (5.6 Terra was 190), Luna 4000. A job keeps the rate frozen on its doc.
  The conservative release-day rate for an unpriced OpenAI model follows the cheapest-to-Gold current
  family (now 6.2 Astra, 60).
- Per-request Sol pricing (`isSolPricedModel`) covers both `gpt-6.2-sol` and `gpt-6.1-sol` (identical
  list prices), so a 6.1 job that resumes or settles after the deploy keeps exact cache accounting.

## Verification

```bash
npx jest --config ci/jest.functions.config.js functions
npm test -- i18n components/ChatsView/ChatDV/EditorView/BotOption components/UIComponents \
  components/SettingsView components/AssistantDetailedView utils/backends/Assistants
npm run build-web-webpack
```

No new environment variables, IAM grants, indexes or credentials. The deployment must include web,
Functions and the VM runner image. A live smoke test (one Sol, Terra and DeepSeek chat with a tool
call and an image) remains a rollout check; the suites mock provider requests.
