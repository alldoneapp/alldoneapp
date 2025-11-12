#!/bin/bash

# Safe Firestore Indexes Deployment Script - PRODUCTION
echo "🛡️  Safe Firestore Indexes Deployment - PRODUCTION"
echo "=================================================="
echo ""

# Check if firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Please install it first:"
    echo "   npm install -g firebase-tools"
    exit 1
fi

# Get current Firebase project
CURRENT_PROJECT=$(firebase use 2>/dev/null | grep "Active Project:" | cut -d' ' -f3)
echo "📍 Current Firebase project: ${CURRENT_PROJECT:-none}"
echo ""

# Ask user to confirm production project
echo "⚠️  WARNING: This will deploy indexes to PRODUCTION"
read -p "Enter your PRODUCTION project ID (e.g., alldone-production): " PROD_PROJECT
echo ""

if [ -z "$PROD_PROJECT" ]; then
    echo "❌ No project ID provided. Exiting."
    exit 1
fi

# Switch to production project
echo "🔄 Switching to production project: $PROD_PROJECT"
firebase use $PROD_PROJECT

if [ $? -ne 0 ]; then
    echo "❌ Failed to switch to project $PROD_PROJECT"
    echo "   Make sure you have access to this project"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "firestore.indexes.json" ]; then
    echo "❌ firestore.indexes.json not found in current directory"
    echo "   Please run this script from your project root"
    exit 1
fi

echo "📥 Step 1: Backing up current indexes..."
echo ""

# Create backup directory
mkdir -p firestore-backups
BACKUP_FILE="firestore-backups/indexes-backup-$(date +%Y%m%d-%H%M%S).json"

# Export current indexes
firebase firestore:indexes > "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Current indexes backed up to: $BACKUP_FILE"
    echo ""
    echo "📊 Current indexes in your project:"
    grep -c '"collectionGroup"' "$BACKUP_FILE" | xargs echo "   Total indexes:"
    echo ""
else
    echo "⚠️  Could not export current indexes. They might not exist yet."
    echo "   This is normal for new projects."
    echo ""
fi

echo "📋 Step 2: Composite indexes to be deployed:"
echo "  • Tasks Queries - 5 composite indexes for complex filtering"
echo "  • OAuth/MCP Authentication - 2 multi-field indexes"
echo "  • Milestones - 1 composite index for project tracking"
echo ""
echo "Note: Single-field indexes are created automatically by Firestore"
echo ""

read -p "🤔 Continue with deployment? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled."
    exit 1
fi

echo ""
echo "🔧 Step 3: Deploying new indexes..."
firebase deploy --only firestore:indexes

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Indexes deployed successfully to PRODUCTION!"
    echo ""
    echo "📊 What happens next:"
    echo "  1. NEW indexes will build in background"
    echo "  2. EXISTING indexes remain untouched"
    echo "  3. No downtime - all queries continue to work"
    echo ""
    echo "🔍 Monitor progress at:"
    echo "   Firebase Console → Firestore → Indexes (Project: $PROD_PROJECT)"
    echo ""
    echo "⚡ Expected improvements:"
    echo "   • Complex task queries: Faster and more consistent"
    echo "   • OAuth lookups: Optimized for authentication flow"
    echo "   • Note: Chat queries already use automatic indexes"
    echo ""
    echo "💾 Your backup is saved at: $BACKUP_FILE"
else
    echo ""
    echo "❌ Deployment failed. Your indexes remain unchanged."
    echo "   Check your Firebase configuration and try again."
fi

# Ask if user wants to switch back to original project
if [ -n "$CURRENT_PROJECT" ] && [ "$CURRENT_PROJECT" != "$PROD_PROJECT" ]; then
    echo ""
    read -p "🔄 Switch back to $CURRENT_PROJECT? (y/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        firebase use $CURRENT_PROJECT
        echo "✅ Switched back to $CURRENT_PROJECT"
    fi
fi
