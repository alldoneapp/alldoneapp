#!/bin/bash

# Firestore Indexes Deployment Script - PRODUCTION
echo "🚀 Deploying Firestore indexes to PRODUCTION..."
echo ""

# Check if firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI not found. Please install it first:"
    echo "   npm install -g firebase-tools"
    exit 1
fi

# Production deployment confirmation
echo "⚠️  WARNING: This will deploy to PRODUCTION"
read -p "Enter your PRODUCTION project ID: " PROD_PROJECT

if [ -z "$PROD_PROJECT" ]; then
    echo "❌ No project ID provided. Exiting."
    exit 1
fi

# Deploy with explicit project
echo "🔄 Deploying to project: $PROD_PROJECT"

# Check if we're in the right directory
if [ ! -f "firestore.indexes.json" ]; then
    echo "❌ firestore.indexes.json not found in current directory"
    echo "   Please run this script from your project root"
    exit 1
fi

echo "📋 Composite indexes to be deployed:"
echo "  • Tasks Queries - 5 composite indexes"
echo "  • OAuth/MCP - 2 authentication indexes"
echo "  • Milestones - 1 project tracking index"
echo ""
echo "Note: Single-field indexes are automatic in Firestore"
echo ""

# Deploy indexes to production
echo "🔧 Starting deployment to PRODUCTION..."
firebase deploy --only firestore:indexes --project $PROD_PROJECT

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Indexes deployed successfully to PRODUCTION!"
    echo "   Project: $PROD_PROJECT"
    echo ""
    echo "📊 What happens next:"
    echo "  1. Indexes will build in background (5 mins to 6 hours)"
    echo "  2. No downtime - queries continue to work"
    echo "  3. Performance improves once indexes are ready"
    echo ""
    echo "🔍 Monitor progress at:"
    echo "   Firebase Console → Firestore → Indexes"
    echo "   Project: $PROD_PROJECT"
    echo ""
    echo "⚡ Expected improvements:"
    echo "   • Complex task filtering: More consistent performance"
    echo "   • Authentication flows: Faster OAuth token lookups"
    echo "   • Milestone queries: Optimized project tracking"
else
    echo ""
    echo "❌ Deployment failed to $PROD_PROJECT"
    echo "   Please check your Firebase configuration and permissions."
fi
