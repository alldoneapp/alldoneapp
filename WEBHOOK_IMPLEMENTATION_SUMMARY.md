# Webhook Tasks Implementation Summary

## ✅ What Was Implemented

A complete webhook-based task system for Alldone assistants that allows integration with external services (like video generation APIs) that take 10-30 seconds to complete.

### Architecture: Callback Pattern (Recommended Approach)

Instead of waiting synchronously for external services (which blocks Cloud Functions and costs more), the implementation uses an efficient callback pattern:

1. **Initiate**: Task executor sends request to external webhook
2. **Store**: Pending state saved in Firestore
3. **Return**: Cloud Function returns immediately (minimal execution time)
4. **Callback**: External service calls back when ready
5. **Complete**: Result stored as chat comment and users notified

## 📁 Files Created/Modified

### New Files

1. **`functions/Assistant/webhookCallbackHandler.js`** (380 lines)

    - Processes webhook callbacks from external services
    - Validates correlation IDs
    - Stores results as chat comments
    - Handles errors and timeouts
    - Includes cleanup function for expired webhooks

2. **`functions/Assistant/WEBHOOK_TASKS_README.md`** (Comprehensive documentation)

    - Complete usage guide
    - API specifications
    - Security considerations
    - Testing instructions
    - Troubleshooting guide

3. **`functions/Tests/testWebhookCallback.js`** (Test utility)
    - Simulates external webhook callbacks
    - Supports local, staging, and production environments
    - Can test success and error scenarios

### Modified Files

1. **`functions/Assistant/assistantPreConfigTaskTopic.js`**

    - Added webhook task detection (`taskMetadata.isWebhookTask`)
    - Added `executeWebhookTask()` function
    - Stores pending webhooks in Firestore
    - Calls external services with callback URL

2. **`functions/index.js`**
    - Added `webhookCallbackForAssistantTasks` Cloud Function (HTTP endpoint)
    - Added `cleanupExpiredWebhookTasks` scheduled function (every 10 min)

## 🔧 How to Use

### 1. Configure a Webhook Task

Add this to your assistant task's `taskMetadata`:

```javascript
{
  "isWebhookTask": true,
  "webhookUrl": "https://your-external-service.com/api/generate-video",
  "webhookAuth": "Bearer your-api-key",  // Optional
  "webhookParams": {                      // Optional
    "quality": "high",
    "format": "mp4"
  }
}
```

### 2. External Service Implementation

Your external service needs to:

**A. Accept the webhook request:**

```javascript
POST https://your-external-service.com/api/generate-video
{
  "correlationId": "uuid-string",
  "callbackUrl": "https://europe-west1-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks",
  "prompt": "User's prompt",
  "taskId": "...",
  "userId": "...",
  "projectId": "...",
  // ... custom params
}
```

**B. Return immediate acknowledgment:**

```javascript
{
  "status": "accepted",
  "estimatedCompletion": "20s"
}
```

**C. Process asynchronously and call back when done:**

**Success:**

```javascript
POST {callbackUrl}
{
  "correlationId": "same-uuid",
  "status": "success",
  "resultUrl": "https://cdn.example.com/result.mp4",
  "metadata": {
    "title": "Generated Video",
    "duration": "2m 30s",
    "fileSize": "125 MB"
  }
}
```

**Error:**

```javascript
POST {callbackUrl}
{
  "correlationId": "same-uuid",
  "status": "error",
  "error": "Error description"
}
```

### 3. Testing

**Local testing:**

```bash
# Start emulator
firebase emulators:start --only functions

# Test with utility script
cd functions/Tests
node testWebhookCallback.js <correlationId> success
```

**Production:**

```bash
# Deploy
firebase deploy --only functions:webhookCallbackForAssistantTasks,functions:cleanupExpiredWebhookTasks

# Monitor logs
firebase functions:log --only webhookCallbackForAssistantTasks
```

## 📊 Firestore Schema

### `pendingWebhooks` Collection

Each webhook creates a document for state tracking:

```javascript
{
  correlationId: "uuid-v4",
  userId: "user-id",
  projectId: "project-id",
  objectId: "task-id",
  assistantId: "assistant-id",
  webhookUrl: "https://...",
  status: "pending",  // pending|initiated|completed|failed|expired
  createdAt: Timestamp,
  expiresAt: Number,  // Unix timestamp (5 min timeout)
  resultUrl: "https://...",  // After completion
  error: "...",  // If failed
  metadata: {}  // Additional data
}
```

## 🔐 Security

-   **Correlation ID Validation**: Prevents unauthorized updates
-   **CORS**: Restricted to POST requests only
-   **Timeout**: 5-minute maximum prevents indefinite pending states
-   **Signature Validation**: Placeholder function ready for HMAC-SHA256 implementation

## ⚙️ Cloud Functions

### 1. `webhookCallbackForAssistantTasks` (HTTP)

-   **Endpoint**: `https://europe-west1-{project}.cloudfunctions.net/webhookCallbackForAssistantTasks`
-   **Method**: POST
-   **Timeout**: 60 seconds
-   **Memory**: 512 MiB

### 2. `cleanupExpiredWebhookTasks` (Scheduled)

-   **Schedule**: Every 10 minutes (`*/10 * * * *`)
-   **Purpose**: Mark expired webhooks as failed
-   **Timeout**: 300 seconds
-   **Memory**: 512 MiB

## 🎯 Key Features

✅ **Non-blocking**: Cloud Functions return immediately
✅ **Scalable**: Can handle many concurrent webhook requests
✅ **Reliable**: Automatic timeout and error handling
✅ **Observable**: Comprehensive logging and state tracking
✅ **Secure**: Correlation ID validation with signature validation ready
✅ **Cost-efficient**: Minimal Cloud Function execution time

## 🚀 Deployment

```bash
# Deploy webhook functions
firebase deploy --only functions:webhookCallbackForAssistantTasks,functions:cleanupExpiredWebhookTasks

# Or deploy all functions
firebase deploy --only functions
```

## 📝 Example Use Cases

1. **Video Generation**: Generate videos from text prompts
2. **Image Processing**: Apply filters, resize, or convert images
3. **Document Generation**: Create PDFs from templates
4. **Audio Transcription**: Convert speech to text
5. **AI Model Inference**: Run custom ML models
6. **Data Processing**: ETL operations on large datasets

## 🐛 Troubleshooting

### Webhook not triggered?

-   Check `taskMetadata.isWebhookTask` is `true`
-   Verify `taskMetadata.webhookUrl` is valid HTTPS
-   Check task is actually executing (recurring task logs)

### Callback not received?

-   Verify `correlationId` matches exactly
-   Check external service is using correct `callbackUrl`
-   Ensure callback URL is accessible from external service
-   Check Cloud Function logs for errors

### Webhooks timing out?

-   External service must respond within 5 minutes
-   Check external service is calling back
-   Verify network connectivity

## 📈 Monitoring

Query webhook statistics:

```javascript
// Get success rate
const admin = require('firebase-admin')
const now = Date.now()
const oneDayAgo = now - 24 * 60 * 60 * 1000

const webhooks = await admin.firestore().collection('pendingWebhooks').where('createdAt', '>=', oneDayAgo).get()

const completed = webhooks.docs.filter(d => d.data().status === 'completed')
const successRate = (completed.length / webhooks.size) * 100
console.log(`Success rate: ${successRate}%`)
```

## 🔄 Alternative: Synchronous Approach

If your external service doesn't support callbacks, you can modify `executeWebhookTask()` to wait synchronously:

```javascript
// Instead of callback pattern, just wait for response
const response = await fetch(webhookUrl, {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60000), // 60 second timeout
})

const result = await response.json()
// Store result directly
```

**Note**: This is less efficient and may hit Cloud Function timeout limits (max 9 minutes).

## 📚 Documentation

-   **Full Documentation**: `functions/Assistant/WEBHOOK_TASKS_README.md`
-   **Test Utility**: `functions/Tests/testWebhookCallback.js`
-   **Implementation**: `functions/Assistant/assistantPreConfigTaskTopic.js`
-   **Callback Handler**: `functions/Assistant/webhookCallbackHandler.js`

## 🎉 Next Steps

1. **Test locally** using the test utility
2. **Deploy** to staging environment
3. **Create example** external service
4. **Configure** first webhook task
5. **Monitor** logs and metrics
6. **Implement** signature validation for production (optional but recommended)

## 💡 Questions?

Refer to the comprehensive documentation in `functions/Assistant/WEBHOOK_TASKS_README.md` for detailed information about:

-   API specifications
-   Security implementation
-   Error handling
-   Best practices
-   Example code
-   Troubleshooting guide
