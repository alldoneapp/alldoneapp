# AI Assistant Performance Optimization Guide

## Problem Summary

-   **Current latency**: 15-20 seconds for first response, 5-10 seconds for follow-ups
-   **Target latency**: < 3 seconds for first response, < 1 second for follow-ups

## Root Causes Identified

1. **Cold Start Issues (5-10 seconds)**

    - No minimum instances configured
    - Low memory allocation (512MiB)
    - Heavy module imports on each invocation

2. **Sequential Database Operations (3-5 seconds)**

    - User and assistant data fetched sequentially
    - Comments fetched separately
    - Notes context fetched after comments

3. **Inefficient Context Loading (1-2 seconds)**

    - Fetching 50 messages (excessive)
    - Token counting on all messages
    - No caching of encoder

4. **Environment Loading (0.5-1 second)**
    - File system reads on each call
    - No caching of environment variables

## Implemented Optimizations

### 1. Firebase Function Configuration

Updated memory and added minimum instances to keep functions warm:

```javascript
// Before
{
    timeoutSeconds: 540,
    memory: '512MiB',
    region: 'europe-west1',
}

// After
{
    timeoutSeconds: 540,
    memory: '2GiB',
    minInstances: 2,  // For askToBotSecondGen
    maxInstances: 100,
    region: 'europe-west1',
}
```

### 2. Parallel Database Operations

Created optimized functions that fetch data in parallel:

```javascript
// Before - Sequential (3+ seconds)
const user = await getUserData(userId);
const assistant = await getAssistantForChat(assistantId);
const messages = await getContextMessages(...);

// After - Parallel (<1 second)
const [user, assistant] = await Promise.all([
    getUserData(userId),
    getAssistantForChat(assistantId)
]);

const [messages, commonData] = await Promise.all([
    getOptimizedContextMessages(...),
    getCommonDataOptimized(projectId, objectType, objectId)
]);
```

### 3. Connection Pooling & Caching

-   OpenAI client connection pooling
-   Environment variables cached for 5 minutes
-   Tiktoken encoder cached at module level

### 4. Optimized Context Loading

-   Reduced message fetch from 50 to 10
-   Reduced context messages from all to 5 most recent
-   Pre-initialized tiktoken encoder

## Implementation Steps

### Step 1: Deploy Configuration Changes

The changes to `functions/index.js` have already been made. Deploy them:

```bash
firebase deploy --only functions:askToBotSecondGen,functions:generatePreConfigTaskResultSecondGen,functions:generateBotAdvaiceSecondGen
```

### Step 2: Test Optimized Functions

Test the optimized functions in parallel with existing ones:

1. Create a feature flag in your app
2. Route 10% of traffic to optimized functions
3. Monitor performance metrics
4. Gradually increase traffic percentage

### Step 3: Replace Existing Functions

Once validated, update the existing functions to use optimized code:

```javascript
// In functions/Assistant/assistantNormalTalk.js
const { askToOpenAIBot } = require('./assistantNormalTalk_optimized')
module.exports = { askToOpenAIBot }
```

### Step 4: Monitor Performance

Set up monitoring for:

-   Function cold start frequency
-   Average response time
-   Memory usage
-   Error rates

## Additional Recommendations

### 1. Implement Request Warming

Add a scheduled function to keep instances warm:

```javascript
exports.keepAssistantWarm = onSchedule(
    {
        schedule: 'every 5 minutes',
        memory: '256MB',
        region: 'europe-west1',
    },
    async () => {
        // Ping the assistant endpoints
        console.log('Keeping assistant functions warm')
    }
)
```

### 2. Use Firestore Bundle for Common Data

Pre-bundle commonly accessed data:

```javascript
// Create bundles for frequently accessed assistants
const bundle = admin.firestore().bundle('common-assistants')
// Add assistant documents to bundle
```

### 3. Implement Response Caching

Cache common responses for similar queries:

```javascript
const responseCache = new Map()
const cacheKey = `${assistantId}-${messageHash}`
if (responseCache.has(cacheKey)) {
    return responseCache.get(cacheKey)
}
```

### 4. Consider Regional Deployment

Deploy functions in multiple regions close to users:

```javascript
exports.askToBotUS = functions.region('us-central1')...
exports.askToBotEU = functions.region('europe-west1')...
exports.askToBotAsia = functions.region('asia-northeast1')...
```

## Expected Performance Improvements

With all optimizations implemented:

1. **Cold Start Reduction**: 5-10s → 1-2s (80% improvement)
2. **Database Operations**: 3-5s → <1s (75% improvement)
3. **Context Loading**: 1-2s → 0.3-0.5s (70% improvement)
4. **Environment Loading**: 0.5-1s → <0.1s (90% improvement)

**Total Expected Improvement**:

-   First response: 15-20s → 2-4s (75-80% faster)
-   Follow-up responses: 5-10s → 0.5-1.5s (80-90% faster)

## Monitoring Dashboard

Set up these metrics in Firebase Console:

1. **Performance Metrics**

    - P50, P90, P99 response times
    - Cold start frequency
    - Memory usage patterns

2. **Error Tracking**

    - OpenAI API errors
    - Firestore timeout errors
    - Out of memory errors

3. **Cost Optimization**
    - Monitor increased memory costs
    - Track minimum instance costs
    - Calculate cost per conversation

## Rollback Plan

If issues occur:

1. Remove minimum instances configuration
2. Revert to original code using git
3. Redeploy functions
4. Monitor for stability

## Testing Checklist

-   [ ] Test with various message lengths
-   [ ] Test with different assistant configurations
-   [ ] Test with tool-enabled assistants
-   [ ] Test error scenarios
-   [ ] Load test with concurrent users
-   [ ] Monitor memory usage under load
