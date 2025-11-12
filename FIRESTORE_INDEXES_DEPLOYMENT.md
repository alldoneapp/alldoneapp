# Firestore Indexes Deployment Guide

## ⚠️ Important: About Existing Indexes

**Good news**: Deploying new indexes does NOT delete your existing ones by default!

-   ✅ New indexes are added
-   ✅ Matching indexes are updated
-   ✅ Unmatched existing indexes remain untouched

## 🚀 Deployment Options

### Option 1: Safe Deploy (Recommended)

Backs up existing indexes first:

```bash
./safe-deploy-indexes.sh
```

### Option 2: Quick Deploy

Adds new indexes without backup:

```bash
firebase deploy --only firestore:indexes
```

### Option 3: Merge with Existing

Preserve ALL current indexes:

```bash
# 1. Export current indexes
firebase firestore:indexes > current-indexes.json

# 2. Merge with new ones
node merge-indexes.js current-indexes.json

# 3. Review and deploy
mv firestore.indexes.merged.json firestore.indexes.json
firebase deploy --only firestore:indexes
```

## 📊 Composite Indexes for Performance

### Important Note:

Single-field indexes (like `orderBy('lastChangeDate')`) are **automatically created** by Firestore. We only need to define composite (multi-field) indexes.

### Key Indexes Being Added:

1. **Tasks Queries** - Multiple composite indexes for complex task filtering
2. **OAuth & MCP** - Multi-field queries for authentication
3. **Milestones** - Composite queries for project milestones

### About Chat Comments Query:

The chat comments query using `.orderBy('lastChangeDate', 'desc')` uses an **automatic single-field index**, so it's not included in our deployment.

## 🛠️ Deployment Steps

### Option 1: Deploy All Indexes (Recommended)

```bash
# From your project root
firebase deploy --only firestore:indexes
```

### Option 2: Deploy via Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to Firestore Database → Indexes
4. Click "Add Index" and manually create each index

### Option 3: Deploy Specific Index Groups

```bash
# Deploy only critical indexes (modify firestore.indexes.json first)
firebase deploy --only firestore:indexes
```

## 📈 Monitor Index Building

1. After deployment, indexes will show as "Building" in Firebase Console
2. Small indexes build in minutes, large ones may take hours
3. Monitor progress at: Firebase Console → Firestore → Indexes

## ⚡ Expected Performance Improvements

The composite indexes will improve:

1. **Complex Task Queries**: More consistent performance for multi-field filters
2. **OAuth Token Lookups**: Faster authentication flows
3. **Milestone Tracking**: Optimized project milestone queries

Note: The chat comments query (your main AI bottleneck) already uses Firestore's automatic single-field index. The real performance gains for AI will come from:

-   ✅ Tiktoken optimization (saves 800ms)
-   ✅ Parallel data fetching (saves 200-500ms)
-   🔍 Check Firestore region alignment with Cloud Functions

## 🔍 Verify Indexes Are Being Used

Check your logs after deployment:

-   Queries using indexes will be faster
-   No more "slow query" warnings in logs
-   Consistent query performance

## ⚠️ Important Notes

1. **Index Building Time**:

    - Small collections: 5-10 minutes
    - Large collections: 1-6 hours
    - Very large collections: Up to 24 hours

2. **Cost Considerations**:

    - Indexes use storage space
    - No additional read costs for indexed queries
    - Actually REDUCES costs by making queries more efficient

3. **No Downtime**:
    - Indexes build in background
    - Queries continue to work during building
    - Performance improves once index is ready

## 🚨 Troubleshooting

If queries are still slow after index deployment:

1. **Check Index Status**: Ensure indexes show "Enabled" not "Building"
2. **Verify Query Match**: Query fields must match index exactly
3. **Check Region**: Ensure Firestore is in same region as Cloud Functions
4. **Review Logs**: Look for "considerAdding" warnings for missing indexes

## 📝 Testing After Deployment

```javascript
// Test a composite index query (tasks example)
const testQuery = async () => {
    const start = Date.now()
    const snapshot = await admin
        .firestore()
        .collection('tasks/[projectId]/items')
        .where('inDone', '==', false)
        .where('isSubtask', '==', false)
        .orderBy('sortIndex', 'desc')
        .limit(10)
        .get()
    console.log(`Composite query took: ${Date.now() - start}ms`)
}
```

## 🎯 Next Steps After Index Deployment

1. **Deploy Updated Functions** with tiktoken optimization
2. **Monitor New Timing Logs** to see improvements
3. **Check Firestore Region** if queries still slow
4. **Consider Regional Replication** for global users
