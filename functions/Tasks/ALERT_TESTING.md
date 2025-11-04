# Testing Task Alert Notifications

## Overview

This document describes how to test the task alert notification system that generates red/grey feed notifications when task alert times are reached.

**OPTIMIZATIONS:** The system uses a three-stage filtering approach to limit scope:

1. Only checks tasks for users active in the last 30 days
2. Only checks tasks in active (non-archived, non-template) projects
3. Verifies task owner is active before processing

This reduces the scan scope by ~90-95% compared to checking all tasks.

## Prerequisites

1. Firebase emulators running: `firebase emulators:start`
2. Firestore indexes deployed (or running locally)
    - `users.lastLogin` index for active user queries
    - `tasks` composite index for alert queries

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

### Scenario 6: Inactive User (Optimization Test)

**Setup:**

1. Create a user with `lastLogin` older than 30 days
2. Create a task for this user with `alertEnabled: true`, `dueDate` in past, `done: false`

**Expected Result:**

-   Scheduled function should skip this task (user not active)
-   No notification generated
-   Logged as "skippedInactiveUser" in metrics

### Scenario 7: Archived Project (Optimization Test)

**Setup:**

1. Create a project with `active: false` (archived)
2. Create a task in this project with `alertEnabled: true`, `dueDate` in past, `done: false`

**Expected Result:**

-   Scheduled function should skip this entire project
-   No notification generated
-   Project not included in activeProjects count

### Scenario 8: Template Project (Optimization Test)

**Setup:**

1. Create a project with `isTemplate: true`
2. Create a task in this project with `alertEnabled: true`, `dueDate` in past, `done: false`

**Expected Result:**

-   Scheduled function should skip this entire project
-   No notification generated
-   Project not included in activeProjects count

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

Use Firestore console or script to create test data:

```javascript
// 1. Create/update user with recent login (REQUIRED for optimization)
// Collection: users/{userId}
{
  lastLogin: Date.now() - 86400000, // 1 day ago (within 30 days)
  // ... other user fields
}

// 2. Create active project
// Collection: projects/{projectId}
{
  userIds: ["your-user-id"],
  active: true, // or undefined (defaults to active)
  isTemplate: false, // or undefined
  // ... other project fields
}

// 3. Create test task
// Collection: items/{projectId}/tasks/{taskId}
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
📊 Active users loaded: { totalActiveUsers: 150, cutoffDate: '2025-XX-XXTXX:XX:XX.XXXZ' }
📊 Active projects identified: { activeUsers: 150, activeProjects: 45 }
🔍 Checking tasks in 45 active projects...
📊 Task collection phase completed: {
  activeProjects: 45,
  totalTasksChecked: 120,
  tasksToProcess: 5,
  skippedAlreadyTriggered: 100,
  skippedInactiveUser: 15
}
🔔 Processing alert for task: task-id-here in project: project-id-here
   Task name: Test Alert Task
   Alert time: 2025-XX-XXTXX:XX:XX.XXXZ
✅ Task alert check completed: {
  activeUsers: 150,
  activeProjects: 45,
  totalTasksChecked: 120,
  processed: 5,
  skippedAlreadyTriggered: 100,
  skippedInactiveUser: 15,
  timestamp: '2025-XX-XXTXX:XX:XX.XXXZ'
}
```

**Key Metrics:**

-   `activeUsers`: Users who logged in within 30 days
-   `activeProjects`: Non-archived, non-template projects with active users
-   `totalTasksChecked`: Tasks queried in active projects
-   `processed`: Alerts successfully generated
-   `skippedAlreadyTriggered`: Tasks with alerts already triggered
-   `skippedInactiveUser`: Tasks for users not active in 30 days

## Troubleshooting

### No Active Users Found

If logs show `activeUsers: 0`:

-   Verify `users.lastLogin` index is deployed
-   Check that test user has `lastLogin` field set to recent timestamp
-   Ensure `lastLogin >= (now - 30 days)`

### No Active Projects Found

If logs show `activeProjects: 0`:

-   Verify test user is member of at least one project (`userIds` array)
-   Check that project is not archived (`active !== false`)
-   Ensure project is not a template (`isTemplate !== true`)
-   Verify project doesn't have `parentTemplateId` set

### No Tasks Found

If logs show `totalTasksChecked: 0`:

-   Verify task exists in active project
-   Check that tasks meet all criteria (alertEnabled, dueDate in past, not done, not triggered)
-   Ensure task owner (userId/creatorId) is in active users map
-   Verify Firestore index is created for tasks collection

### Tasks Skipped (Inactive User)

If logs show high `skippedInactiveUser`:

-   This is expected behavior - task owners haven't logged in within 30 days
-   To test, ensure test user has recent `lastLogin` timestamp
-   Verify `userId` or `creatorId` matches an active user

### Notifications Not Appearing

-   Check that user follows the task (in `/followers/{projectId}/tasks/{taskId}`)
-   Verify feed was created in `feedsCount` collection
-   Check that `needGenerateNotification` is `true` in the code
-   Verify Redux state is updated in the UI

### Function Timeout

-   Increase timeout in index.js (currently 300 seconds)
-   Should be rare with optimizations (only checks active projects)

## Production Deployment Checklist

-   [ ] Firestore indexes deployed (both `users.lastLogin` and `tasks` composite index)
-   [ ] Function deployed and scheduled (every 5 minutes)
-   [ ] Tested with sample data including:
    -   Active users with recent lastLogin
    -   Active projects (non-archived, non-template)
    -   Tasks with alerts in past
-   [ ] Verified notifications appear in UI
-   [ ] Checked that `alertTriggered` flag prevents duplicates
-   [ ] Monitored logs for optimization metrics:
    -   `activeUsers` count is reasonable
    -   `activeProjects` count excludes archived/template projects
    -   `totalTasksChecked` is significantly reduced vs all tasks
-   [ ] Verified red/grey bubble logic works based on followers
-   [ ] Confirmed inactive user tasks are skipped (check `skippedInactiveUser` metric)
