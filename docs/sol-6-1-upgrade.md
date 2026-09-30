# Sol 6.1 rollout (AT-2664)

The persisted assistant key `MODEL_GPT6_SOL` now resolves to `gpt-6.1-sol` in chat,
heartbeats, scheduled tasks, Gmail/calendar classification, and delegation descriptions.
Older `MODEL_GPT5_6_SOL` choices still normalize to that key. No Firestore bulk migration
is required. Native VM defaults, concrete saved `gpt-6-sol` overrides, resumed jobs, and
cached/discovered Sol 6.0 family entries follow the replacement. The catalog schema is
bumped so old caches refresh immediately, falling back to the updated static catalog
if discovery is unavailable.

Saved Sol reasoning `none` resolves to **high**. Sol pickers offer Model default,
low, medium, high, xhigh, and max; other assistant models retain their existing options.
Model default remains omitted from requests (upstream defaults to medium). Existing
low/medium/high/xhigh/max preferences are preserved. VM `minimal` retains its existing
low compatibility mapping.

## Verified upstream pricing

USD per million tokens, checked on **2026-09-30**:

| Standard                       | Input | Cached input | Cache write | Output |
| ------------------------------ | ----: | -----------: | ----------: | -----: |
| Up to 272,000 input tokens     |  2.00 |         0.10 |        2.50 |  10.00 |
| More than 272,000 input tokens |  4.00 |         0.20 |        5.00 |  15.00 |

The long-context rates apply to the **entire request**. Flex/Batch prices are half
Standard; Fast (`fast` or the legacy `priority` service tier) prices are double.
The upstream response's actual service tier controls metering; requesting `auto`
does not itself imply Fast pricing. Standard cached input is $0.10, not Flex's $0.05.
The app uses the global OpenAI endpoint without a regional-processing premium.

Sources: [pricing](https://developers.openai.com/api/docs/pricing),
[model contract](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
[announcement](https://openai.com/index/introducing-gpt-6-1-sol/),
[cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching),
[Fast mode](https://developers.openai.com/api/docs/guides/fast-mode).

## Gold conversion and usage

The historical Sol 5.6 Gold anchor and observed VM token mix remain fixed. Sol 6.1's
cheaper cache reads change the derived VM estimate from **200 to 240 tokens/Gold**.
The VM picker marks this as approximate: actual Sol usage is now priced per request,
including ordinary input, cache reads, cache writes, output (which already includes
reasoning), long context, and returned service tier. USD cost converts to equivalent
short-context blended tokens at the frozen job divisor, with cumulative whole-Gold
rounding. The proxy records cumulative costs and priced token counts; completion
uses those same counters and subtracts live charges once, including across resumes.
Usage without a price breakdown falls back to the established total-token rate.
Cache reads/writes are subsets of OpenAI input and must never be added to total tokens.

Older Sol 6.0 jobs retain their historical/frozen token billing, even when resumed on
6.1. Other models' absolute Gold rates, VM compute charges, subscriptions and BYOK
exemptions are unchanged; their displayed ratios relative to current Sol update.
Assistant/Gmail/calendar Gold remains the established **200 tokens/Gold** product
tariff: its fixed total-token convention tracks the unchanged headline input/output
prices, rather than the cache-heavy VM blend. Assistant usage logs record the updated
Sol upstream cost separately. Assistant preflight stays below 200K input tokens.

## Verification and rollout

Use Node 22/npm 10 and the existing installed dependencies. Functions need their own
dependency tree. Run the relevant suites with:

```bash
npx jest --config ci/jest.functions.config.js --runInBand --runTestsByPath \
  functions/Assistant/solModelPricing.test.js \
  functions/Assistant/vmTokenPricing.test.js \
  functions/Assistant/vmLlmProxy.test.js \
  functions/Assistant/vmJobRunner.test.js \
  functions/Assistant/assistantHelper.test.js \
  functions/Assistant/vmAgentModelCatalog.test.js \
  functions/Assistant/vmAgentSettings.test.js
npx jest --config ci/jest.web.config.js --runInBand --runTestsByPath \
  components/SettingsView/Integrations/DefaultVmAgentSection.test.js \
  components/AssistantDetailedView/Customizations/Heartbeat/HeartbeatReasoningEffortProperty.test.js
npm run build-web-webpack
```

Review/merge through the normal feature-branch MR. Deployment must include the web
client, Functions, and VM runner image through the existing pipeline. No new environment
variables, IAM grants, indexes, or credentials are required. A live provider smoke test
(including a saved Sol `none` choice and tool calling) remains a rollout check; these
tests mock provider requests and do not spend live API credits.
