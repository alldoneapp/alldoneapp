# UI Webhook Task Configuration Guide

## ✅ Implementation Complete!

You can now configure webhook tasks directly in the Alldone UI when adding or editing pre-configured tasks for assistants.

## 📍 Where to Find It

### When Adding/Editing a Pre-Configured Task:

1. **Open Assistant Settings**

    - Go to any assistant's detailed view
    - Navigate to "Customizations" section

2. **Add/Edit Pre-Configured Task**

    - Click "Add new task" or click on an existing task
    - Modal will open: `PreConfigTaskModal`

3. **Select Task Type**

    - In the "Task type" dropdown, you'll now see:
        - ✅ **Prompt** - AI-generated response
        - ✅ **External link** - Opens a URL
        - ✅ **Webhook** - Calls external service ← **NEW!**

4. **Configure Webhook** (when "Webhook" is selected):

    - **Webhook URL** (required) - The HTTPS endpoint to call

        - Must start with `https://`
        - Example: `https://your-service.com/api/generate-video`

    - **Authorization Header** (optional) - Auth token for the webhook

        - Example: `Bearer your-api-key-12345`

    - Helper text explains: "The webhook will receive the task prompt and call back when complete"

## 🔧 Files Modified

### Frontend UI Components

1. **`TaskModal.js`** - Main modal for task configuration

    - Added `TASK_TYPE_WEBHOOK` constant
    - Added webhook to dropdown options
    - Added webhook props handling
    - Added webhook URL validation
    - Renders `WebhookArea` when webhook type selected

2. **`WebhookArea.js`** - NEW component for webhook configuration

    - Text input for webhook URL
    - Text input for authorization header
    - Validation and helper text

3. **`PreConfigTaskModal.js`** - Parent component
    - Added `webhookUrl` and `webhookAuth` state
    - Loads from `task.taskMetadata` if editing
    - Saves to `taskMetadata` structure
    - Passes props to TaskModal

## 📋 Data Structure

When you save a webhook task, it's stored as:

```javascript
{
  name: "Task Name",
  type: "webhook",
  prompt: "",
  variables: [],
  link: "",
  recurrence: "daily",  // or other recurrence value
  sendWhatsApp: false,
  taskMetadata: {
    isWebhookTask: true,
    webhookUrl: "https://your-service.com/api/endpoint",
    webhookAuth: "Bearer your-token"  // optional, omitted if empty
  }
}
```

## 🎯 Usage Flow

1. **User creates webhook task via UI** ✅ (implemented)

    - Selects "Webhook" type
    - Enters webhook URL (validated as HTTPS)
    - Optionally enters auth header
    - Sets recurrence (daily, weekly, etc.)
    - Saves task

2. **Task gets executed** (recurring/manual)

    - `assistantRecurringTasks.js` calls `generatePreConfigTaskResult()`
    - Task executor detects `taskMetadata.isWebhookTask`
    - Calls `executeWebhookTask()` instead of AI

3. **Webhook called**

    - POST to external service with task data
    - Stores pending state in Firestore
    - Returns immediately

4. **External service processes** (10-30 seconds)

    - Generates video/content
    - Calls back to Alldone

5. **Result displayed**
    - Webhook callback handler receives result
    - Stores as chat comment
    - Users see the result URL

## 🧪 Testing

1. **Test UI**:

    - Open any assistant settings
    - Add new pre-configured task
    - Select "Webhook" from dropdown
    - Enter a test URL: `https://webhook.site/unique-id`
    - Enter optional auth: `Bearer test-token`
    - Save task

2. **Test Execution**:

    - Set recurrence to trigger soon (or manually execute)
    - Check Firestore `pendingWebhooks` collection
    - Check webhook.site for received request

3. **Test Callback**:
    ```bash
    cd functions/Tests
    node testWebhookCallback.js <correlationId> success
    ```

## 🎨 UI Screenshot Flow

**Step 1: Task Type Dropdown**

```
Task type
┌─────────────────────────┐
│ ○ Prompt               │
│ ○ External link        │
│ ● Webhook          NEW! │
└─────────────────────────┘
```

**Step 2: Webhook Configuration (when Webhook selected)**

```
Webhook URL
┌────────────────────────────────────────┐
│ https://your-service.com/api/endpoint  │
└────────────────────────────────────────┘

Authorization Header (Optional)
┌────────────────────────────────────────┐
│ Bearer your-api-key                    │
└────────────────────────────────────────┘

ℹ️ The webhook will receive the task prompt
   and call back when complete
```

## 🔐 Validation

The UI validates:

-   ✅ Task name is not empty
-   ✅ Webhook URL is valid HTTPS URL
-   ✅ Webhook URL starts with `https://`
-   ✅ No spaces in URL

Save button is disabled until all requirements are met.

## 📚 Related Documentation

-   **Backend Implementation**: `WEBHOOK_IMPLEMENTATION_SUMMARY.md`
-   **Detailed Guide**: `functions/Assistant/WEBHOOK_TASKS_README.md`
-   **Test Utility**: `functions/Tests/testWebhookCallback.js`

## 🚀 Next Steps

1. **Start your app**: `npm start`
2. **Go to any assistant**: Open assistant settings
3. **Add webhook task**: Select "Webhook" type
4. **Configure**: Enter webhook URL and optional auth
5. **Test**: Set recurrence and watch it execute

Everything is ready to use! 🎉
