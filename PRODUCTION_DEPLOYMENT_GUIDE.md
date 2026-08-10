# Production Deployment Guide

## 🚨 Deploying Indexes to PRODUCTION

### Option 1: Using Safe Deploy Script (Recommended)

```bash
./safe-deploy-indexes.sh
# Enter your production project ID when prompted
```

### Option 2: Using Quick Deploy Script

```bash
./deploy-indexes.sh
# Enter your production project ID when prompted
```

### Option 3: Direct Firebase Commands

#### Deploy to specific project:

```bash
firebase deploy --only firestore:indexes --project YOUR-PRODUCTION-PROJECT-ID
```

#### Or switch project first:

```bash
# List available projects
firebase projects:list

# Switch to production
firebase use YOUR-PRODUCTION-PROJECT-ID

# Deploy
firebase deploy --only firestore:indexes

# Switch back to staging (optional)
firebase use staging-project-id
```

## 📋 Common Production Project IDs

Add your project IDs here for reference:

- Production: `YOUR-PRODUCTION-PROJECT-ID`
- Staging: `YOUR-STAGING-PROJECT-ID`
- Development: `YOUR-DEV-PROJECT-ID`

## ⚠️ Important Notes

1. **Always verify the project** before deploying
2. **Indexes build in background** - no downtime
3. **Monitor progress** in Firebase Console
4. **Test in staging first** if unsure

## 🔍 Verify Current Project

```bash
# Check which project is currently active
firebase use

# List all available projects
firebase projects:list
```

## 🚀 Deploy Functions to Production

### Quick Deploy Script (Recommended)

```bash
./deploy-functions-production.sh
# Choose 'ai' to deploy only AI functions
# Choose 'all' to deploy all functions
```

### Manual Deployment

```bash
# Deploy all functions to production
firebase deploy --only functions --project YOUR-PRODUCTION-PROJECT-ID

# Deploy only AI assistant functions
firebase deploy --only functions:askToBotSecondGen,functions:generatePreConfigTaskResultSecondGen,functions:generateBotAdvaiceSecondGen --project YOUR-PRODUCTION-PROJECT-ID
```

### What's Included in This Deployment:

- ✅ Tiktoken optimization (800ms faster)
- ✅ Parallel data fetching
- ✅ **Removed getEnvFunctions timing logs**
- ✅ Cached environment variables
- ✅ 2GB memory allocation
- ✅ minInstances: 1 (reduced cold starts)
