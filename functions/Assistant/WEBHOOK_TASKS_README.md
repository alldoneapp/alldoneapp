# Webhook Tasks for Alldone Assistants

## Overview

Webhook tasks allow Alldone assistants to execute external services (like video generation, image processing, etc.) that may take 10-30 seconds or longer to complete. Instead of blocking the Cloud Function, the system uses a callback-based architecture for efficient, scalable execution.

## Architecture

### Flow Diagram

```
1. User triggers recurring task
2. Task executor detects webhook configuration
3. POST request sent to external webhook
4. Pending state stored in Firestore
5. External service processes request (10-30s)
6. External service calls back to Alldone
7. Result stored as chat comment
8. Users notified of completion
```

### Components

1. **Task Executor** (`assistantPreConfigTaskTopic.js`)

    - Detects webhook tasks via `taskMetadata.isWebhookTask`
    - Initiates webhook request
    - Stores pending state in Firestore

2. **Webhook Callback Handler** (`webhookCallbackHandler.js`)

    - Receives callbacks from external services
    - Validates correlation ID
    - Stores results as comments
    - Handles errors and timeouts

3. **Cleanup Scheduler** (Cloud Function)
    - Runs every 10 minutes
    - Marks expired webhooks as failed
    - Creates timeout error comments

## Configuration

### Task Metadata Structure

To configure a webhook task, add the following to your assistant task's `taskMetadata`:

```javascript
{
  "isWebhookTask": true,
  "webhookUrl": "https://external-service.com/api/generate-video",
  "webhookAuth": "Bearer your-api-key-here", // Optional
  "webhookParams": {                          // Optional custom params
    "quality": "high",
    "format": "mp4"
  }
}
```

### Field Descriptions

-   **`isWebhookTask`** (boolean, required): Set to `true` to enable webhook mode
-   **`webhookUrl`** (string, required): The external service endpoint to call
-   **`webhookAuth`** (string, optional): Authorization header value (e.g., `Bearer token123`)
-   **`webhookParams`** (object, optional): Custom parameters to include in webhook payload

## External Service Requirements

Your external webhook service must:

### 1. Accept POST Requests

The webhook will receive a POST request with this payload:

```json
{
    "correlationId": "uuid-v4-string",
    "callbackUrl": "https://region-project.cloudfunctions.net/webhookCallbackForAssistantTasks",
    "prompt": "User's task prompt/description",
    "taskId": "firestore-task-id",
    "userId": "firestore-user-id",
    "projectId": "firestore-project-id"
    // ... any custom params from webhookParams
}
```

### 2. Return Acknowledgment

Immediately return a 200 OK response acknowledging the request:

```json
{
    "status": "accepted",
    "estimatedCompletion": "30s",
    "message": "Processing started"
}
```

### 3. Call Back When Complete

When processing is done, POST to the `callbackUrl` with:

**Success Response:**

```json
{
    "correlationId": "same-uuid-from-request",
    "status": "success",
    "resultUrl": "https://cdn.example.com/generated-video.mp4",
    "metadata": {
        // Optional
        "title": "Generated Video",
        "duration": "5m 30s",
        "fileSize": "125 MB",
        "description": "High quality video"
    }
}
```

**Error Response:**

```json
{
    "correlationId": "same-uuid-from-request",
    "status": "error",
    "error": "Description of what went wrong"
}
```

## Firestore Schema

### `pendingWebhooks` Collection

Each webhook request creates a document in the `pendingWebhooks` collection:

```javascript
{
  correlationId: "uuid-v4",           // Unique ID for this webhook
  userId: "user123",                  // Who initiated the task
  projectId: "project456",            // Project context
  objectId: "task789",                // Task/chat ID
  assistantId: "assistant101",        // Assistant performing the task
  userIdsToNotify: ["user123"],       // Users to notify on completion
  isPublicFor: ["ALL"],               // Visibility settings
  prompt: "Generate video...",        // Task prompt
  webhookUrl: "https://...",          // External service URL
  status: "pending",                  // pending|initiated|completed|failed|expired
  createdAt: Timestamp,               // When webhook was initiated
  expiresAt: Number,                  // Unix timestamp for timeout (5 min)
  initiatedAt: Timestamp,             // When external service acknowledged
  completedAt: Timestamp,             // When callback was received
  resultUrl: "https://...",           // Result from external service
  error: "Error message",             // Error if failed
  metadata: {},                       // Additional data from webhook
}
```

### Status Flow

-   **`pending`**: Initial state after webhook request is sent
-   **`initiated`**: External service acknowledged the request
-   **`completed`**: Successfully received callback with result
-   **`failed`**: Error occurred (either in request or callback)
-   **`expired`**: No callback received within timeout period (5 minutes)

## Security

### Current Implementation

-   Correlation ID validation prevents unauthorized updates
-   CORS configured for POST requests only
-   5-minute timeout prevents indefinite pending states

### Future Enhancements

The `validateWebhookSignature()` function is a placeholder for implementing webhook signature verification:

```javascript
// Example: HMAC SHA256 signature validation
const signature = req.headers['x-webhook-signature']
const body = JSON.stringify(req.body)
const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex')

if (signature !== expectedSignature) {
    throw new Error('Invalid webhook signature')
}
```

To implement:

1. Generate a secret key per webhook task
2. Store in `pendingWebhooks` document
3. Include secret in initial webhook request
4. Validate signature in callback handler

## Error Handling

### Timeout (No Callback)

If no callback is received within 5 minutes:

-   Cleanup scheduler marks webhook as `expired`
-   Error comment added: "⏱️ Webhook task timed out: No response received..."

### External Service Error

If external service returns error in callback:

-   Webhook marked as `failed`
-   Error comment added: "❌ Webhook task failed: [error message]"

### Network/Connection Error

If initial webhook request fails:

-   Webhook marked as `failed` immediately
-   Error comment added with technical details
-   Exception re-thrown for upstream handling

## Testing

### Local Development

1. **Start Firebase Emulator:**

    ```bash
    firebase emulators:start --only functions
    ```

2. **Configure Local Webhook:**

    - Use a tool like [ngrok](https://ngrok.com/) to expose your local service
    - Or use [webhook.site](https://webhook.site) for testing

3. **Create Test Task:**

    ```javascript
    {
      name: "Test Webhook Task",
      prompt: "Generate a test video",
      recurrence: "never",
      taskMetadata: {
        isWebhookTask: true,
        webhookUrl: "https://webhook.site/your-unique-id",
        webhookParams: {
          test: true
        }
      }
    }
    ```

4. **Trigger Task:**

    - Execute the task manually or via recurring task scheduler
    - Check logs in Firebase Emulator
    - Verify webhook request in webhook.site

5. **Test Callback:**
    ```bash
    curl -X POST http://localhost:5001/alldonealeph/europe-west1/webhookCallbackForAssistantTasks \
      -H "Content-Type: application/json" \
      -d '{
        "correlationId": "your-correlation-id",
        "status": "success",
        "resultUrl": "https://example.com/video.mp4"
      }'
    ```

### Production Testing

1. Deploy functions:

    ```bash
    firebase deploy --only functions
    ```

2. Create test task in production environment

3. Monitor Cloud Function logs:
    ```bash
    firebase functions:log --only webhookCallbackForAssistantTasks
    ```

## Monitoring

### Key Metrics to Track

1. **Webhook Success Rate**:

    - Query `pendingWebhooks` for `status: "completed"` vs `status: "failed"`

2. **Average Response Time**:

    - Difference between `createdAt` and `completedAt`

3. **Timeout Rate**:

    - Count of webhooks with `status: "expired"`

4. **Error Patterns**:
    - Group by `error` field to identify common failures

### Example Queries

```javascript
// Get success rate for last 24 hours
const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
const webhooks = await admin.firestore().collection('pendingWebhooks').where('createdAt', '>=', oneDayAgo).get()

const completed = webhooks.docs.filter(d => d.data().status === 'completed').length
const total = webhooks.size
const successRate = (completed / total) * 100
```

## Best Practices

1. **Keep Webhooks Fast**: Aim for < 30 second response times
2. **Use Retries**: Implement retry logic in external service for transient failures
3. **Validate Input**: Check webhook payload in external service before processing
4. **Monitor Costs**: Long-running webhooks can increase Firestore read/write costs
5. **Clean Up**: The scheduler automatically cleans expired webhooks, but consider archiving old completed webhooks periodically
6. **Use HTTPS**: Always use HTTPS for webhook URLs in production
7. **Implement Idempotency**: External service should handle duplicate callbacks gracefully

## Example External Service (Node.js)

```javascript
const express = require('express')
const app = express()

app.post('/api/generate-video', async (req, res) => {
    const { correlationId, callbackUrl, prompt } = req.body

    // Immediately acknowledge the request
    res.json({ status: 'accepted', estimatedCompletion: '20s' })

    // Process asynchronously
    processVideoGeneration(correlationId, callbackUrl, prompt)
})

async function processVideoGeneration(correlationId, callbackUrl, prompt) {
    try {
        // Simulate video generation (10-30 seconds)
        const videoUrl = await generateVideo(prompt)

        // Call back to Alldone
        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correlationId,
                status: 'success',
                resultUrl: videoUrl,
                metadata: {
                    title: 'Generated Video',
                    duration: '5m 30s',
                    fileSize: '125 MB',
                },
            }),
        })
    } catch (error) {
        // Report error via callback
        await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                correlationId,
                status: 'error',
                error: error.message,
            }),
        })
    }
}
```

## Troubleshooting

### Issue: Webhook not triggered

**Check:**

-   `taskMetadata.isWebhookTask` is `true`
-   `taskMetadata.webhookUrl` is a valid HTTPS URL
-   Task is actually being executed (check recurring task logs)

### Issue: Callback not working

**Check:**

-   External service is using correct `callbackUrl` from request
-   `correlationId` matches exactly
-   Callback payload includes required fields: `correlationId`, `status`, `resultUrl`
-   Callback URL is accessible from external service (not blocked by firewall)

### Issue: Webhooks timing out

**Check:**

-   External service response time (should be < 5 minutes)
-   External service is actually calling back
-   Network connectivity between external service and Cloud Functions
-   Check Cloud Function logs for errors

### Issue: Results not appearing

**Check:**

-   Callback was successful (check `pendingWebhooks` status)
-   Chat object exists for the task
-   User has permission to view the chat
-   Comment was created (check `chatComments` collection)

## Changelog

### Version 1.0 (Initial Release)

-   Webhook task execution with callback architecture
-   5-minute timeout with automatic cleanup
-   Error handling and status tracking
-   Firestore state management
-   Comprehensive logging

## Future Enhancements

-   [ ] Webhook signature validation (HMAC-SHA256)
-   [ ] Configurable timeout per task
-   [ ] Retry logic for failed callbacks
-   [ ] Webhook analytics dashboard
-   [ ] Support for multiple callback formats (JSON, XML, form-data)
-   [ ] Webhook testing UI in admin panel
