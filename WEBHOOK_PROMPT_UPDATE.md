# Webhook Task Prompt Update

## ✅ What Was Added

Added the ability to configure a **custom prompt** that will be sent to the webhook URL when the task executes.

## 📝 Changes Made

### Frontend UI

1. **WebhookArea.js** - Added prompt field

    - New multiline text input for webhook prompt
    - Positioned between URL and Auth fields
    - Placeholder: "Enter the prompt to send to the webhook"
    - Larger text area (96-150px height) for longer prompts

2. **TaskModal.js** - Added webhookPrompt props

    - Added `webhookPrompt` and `setWebhookPrompt` parameters
    - Updated validation to require prompt for webhook tasks
    - Passes props to WebhookArea component

3. **PreConfigTaskModal.js** - Added webhookPrompt state
    - Loads from `task.taskMetadata.webhookPrompt` when editing
    - Saves to `taskMetadata.webhookPrompt` when saving
    - Includes in both new task and update task flows

### Backend

4. **assistantPreConfigTaskTopic.js** - Uses webhook prompt in payload
    - Modified webhook payload to use `taskMetadata.webhookPrompt`
    - Falls back to regular `prompt` if webhook prompt not provided
    - Line 305: `prompt: taskMetadata.webhookPrompt || prompt`

### Translations

5. **en.json** - English translations

    - "Webhook": "Webhook"
    - "Webhook URL": "Webhook URL"
    - "Webhook Prompt": "Webhook Prompt"
    - "Enter the prompt to send to the webhook": "Enter the prompt to send to the webhook"
    - "Authorization Header (Optional)": "Authorization Header (Optional)"
    - "The webhook will receive this prompt and call back when complete": "The webhook will receive this prompt and call back when complete"

6. **de.json** - German translations

    - Added all webhook-related translations in German

7. **es.json** - Spanish translations
    - Added all webhook-related translations in Spanish

## 🎯 How It Works

### When Creating/Editing a Webhook Task:

**UI Flow:**

```
1. Select "Webhook" task type
2. Enter Webhook URL (required)
3. Enter Webhook Prompt (required) ← NEW!
4. Enter Authorization Header (optional)
5. Save task
```

**Data Structure:**

```javascript
{
  name: "Task Name",
  type: "webhook",
  taskMetadata: {
    isWebhookTask: true,
    webhookUrl: "https://your-service.com/api/endpoint",
    webhookPrompt: "Generate a video about cats playing piano", // NEW!
    webhookAuth: "Bearer token"
  }
}
```

### When Task Executes:

**Webhook Payload:**

```javascript
{
  correlationId: "uuid",
  callbackUrl: "https://...",
  prompt: "Generate a video about cats playing piano", // From webhookPrompt
  taskId: "...",
  userId: "...",
  projectId: "..."
}
```

## 📋 UI Layout

The WebhookArea now displays fields in this order:

1. **Webhook URL** (single line, required)

    - `https://your-service.com/api/endpoint`

2. **Webhook Prompt** (multiline, required) ← NEW!

    - `Enter the prompt to send to the webhook`
    - Larger text area for detailed prompts

3. **Authorization Header** (single line, optional)

    - `Bearer your-api-key`

4. **Helper Text**
    - "The webhook will receive this prompt and call back when complete"

## ✅ Validation

The save button is now disabled unless:

-   ✅ Task name is not empty
-   ✅ Webhook URL is valid HTTPS
-   ✅ **Webhook prompt is not empty** ← NEW!

## 🧪 Testing

1. **Start app**: `npm start`
2. **Go to assistant settings** → Customizations → Pre-Configured Tasks
3. **Add new task** or edit existing webhook task
4. **Select "Webhook"** type
5. **Fill in all fields** including the new prompt field
6. **Save** - prompt will be stored in `taskMetadata.webhookPrompt`
7. **Execute task** - prompt will be sent in webhook payload

## 📄 Example

**User configures:**

-   **Name**: "Generate Marketing Video"
-   **Type**: Webhook
-   **URL**: `https://video-service.com/api/generate`
-   **Prompt**: "Create a 30-second marketing video showcasing our new product features with upbeat music"
-   **Auth**: `Bearer abc123`

**External service receives:**

```json
{
    "correlationId": "550e8400-e29b-41d4-a716-446655440000",
    "callbackUrl": "https://europe-west1-alldonealeph.cloudfunctions.net/webhookCallbackForAssistantTasks",
    "prompt": "Create a 30-second marketing video showcasing our new product features with upbeat music",
    "taskId": "task-id-here",
    "userId": "user-id-here",
    "projectId": "project-id-here"
}
```

**External service processes the prompt and calls back with the result URL.**

## 🎉 Benefits

1. **Flexibility**: Each webhook task can have a unique prompt
2. **Context**: External services get clear instructions
3. **User-friendly**: Users can describe what they want generated
4. **Reusable**: Same webhook URL with different prompts for different tasks
5. **Powerful**: Enables AI-powered content generation, video creation, etc.

## 📚 Related Files

-   `WebhookArea.js` - UI component
-   `TaskModal.js` - Modal wrapper
-   `PreConfigTaskModal.js` - Parent component with state
-   `assistantPreConfigTaskTopic.js` - Backend executor
-   `en.json`, `de.json`, `es.json` - Translations

All ready to use! 🚀
