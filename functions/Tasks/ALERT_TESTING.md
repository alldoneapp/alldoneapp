# Testing Task Alert Notifications

## Overview

This document describes how to test the task alert notification system that generates red/grey feed notifications when task alert times are reached.

## Prerequisites

1. Firebase emulators running: `firebase emulators:start`
2. Firestore indexes deployed (or running locally)

## Test Scenarios

### Scenario 1: Basic Alert Trigger

**Setup:**

1. Create a task with `alertEnabled: true`
2. Set `dueDate` to a timestamp in the past (e.g., 5 minutes ago)
3. Ensure `done: false`
4. Ensure `alertTriggered` is not set or is `false`

**Expected Result:**

-   Scheduled function should find the task
-   Generate a feed notification with type `FEED_TASK_ALERT_CHANGED` (579)
-   Mark task as `alertTriggered: true`
-   Red notification bubble appears if user follows the task
-   Grey notification bubble appears if user doesn't follow the task

### Scenario 2: Already Triggered Alert

**Setup:**

1. Create a task with `alertEnabled: true`, `dueDate` in past, and `alertTriggered: true`

**Expected Result:**

-   Scheduled function should skip this task
-   No new notification generated

### Scenario 3: Completed Task with Alert

**Setup:**

1. Create a task with `alertEnabled: true`, `dueDate` in past, and `done: true`

**Expected Result:**

-   Scheduled function should skip this task
-   No notification generated

### Scenario 4: Future Alert

**Setup:**

1. Create a task with `alertEnabled: true` and `dueDate` in the future

**Expected Result:**

-   Scheduled function should skip this task
-   No notification generated (yet)

### Scenario 5: Alert Disabled

**Setup:**

1. Create a task with `alertEnabled: false` and `dueDate` in past

**Expected Result:**

-   Scheduled function should skip this task
-   No notification generated

## Manual Testing Steps

### 1. Deploy Firestore Indexes

```bash
firebase deploy --only firestore:indexes
```

### 2. Deploy Functions (or test locally)

```bash
# For production deployment
firebase deploy --only functions:checkTaskAlertsSecondGen

# For local testing with emulator
firebase emulators:start --only functions,firestore
```

### 3. Create Test Data

Use Firestore console or script to create test tasks:

```javascript
// Example test task
{
  name: "Test Alert Task",
  alertEnabled: true,
  dueDate: Date.now() - 300000, // 5 minutes ago
  done: false,
  userId: "your-user-id",
  creatorId: "your-user-id",
  isPublicFor: ["your-user-id"]
}
```

### 4. Manually Trigger Function (for testing)

```bash
# Using Firebase CLI
firebase functions:shell
> checkAndTriggerTaskAlerts()
```

### 5. Verify Results

Check Firestore collections:

-   `feedsCount/{projectId}/{userId}/followed` or `all` - should have new entry
-   Task document should have `alertTriggered: true`
-   Check console logs for execution details

## Checking Logs

### View Function Logs

```bash
# For deployed functions
firebase functions:log --only checkTaskAlertsSecondGen

# For emulator
# Logs appear in emulator console
```

### Expected Log Output

```
🔔 Starting task alert check at: 2025-XX-XXTXX:XX:XX.XXXZ
📋 Found X tasks with alerts to process
🔔 Processing alert for task: task-id-here in project: project-id-here
   Task name: Test Alert Task
   Alert time: 2025-XX-XXTXX:XX:XX.XXXZ
✅ Task alert check completed: { total: X, processed: X, skipped: 0, timestamp: ... }
```

## Troubleshooting

### No Tasks Found

-   Verify Firestore index is created (check Firebase Console > Firestore > Indexes)
-   Check that tasks meet all criteria (alertEnabled, dueDate in past, not done, not triggered)
-   Verify `collectionGroup` query works for your Firestore structure

### Notifications Not Appearing

-   Check that user follows the task (in `/followers/{projectId}/tasks/{taskId}`)
-   Verify feed was created in `feedsCount` collection
-   Check that `needGenerateNotification` is `true` in the code
-   Verify Redux state is updated in the UI

### Function Timeout

-   Increase timeout in index.js (currently 300 seconds)
-   Optimize batch size if processing many tasks

## Production Deployment Checklist

-   [ ] Firestore indexes deployed
-   [ ] Function deployed and scheduled (every 5 minutes)
-   [ ] Tested with sample data
-   [ ] Verified notifications appear in UI
-   [ ] Checked that `alertTriggered` flag prevents duplicates
-   [ ] Monitored logs for errors
-   [ ] Verified red/grey bubble logic works
