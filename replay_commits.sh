#!/bin/sh
if [ -n "$CUTOFF_COMMIT" ]; then
  echo "Replaying commits after July 18th, 2025 with preserved authorship..."
  for commit in $(git rev-list --reverse $CUTOFF_COMMIT..$ORIGINAL_HEAD); do
    echo "Processing commit: $commit"
    AUTHOR_NAME=$(git show -s --format="%an" $commit)
    AUTHOR_EMAIL=$(git show -s --format="%ae" $commit)
    AUTHOR_DATE=$(git show -s --format="%ad" $commit)
    COMMITTER_NAME=$(git show -s --format="%cn" $commit)
    COMMITTER_EMAIL=$(git show -s --format="%ce" $commit)
    COMMITTER_DATE=$(git show -s --format="%cd" $commit)
    COMMIT_MESSAGE=$(git show -s --format="%B" $commit | tr -d "\r")
    git checkout $commit -- . || true
    git add -A
    GIT_AUTHOR_NAME="$AUTHOR_NAME" GIT_AUTHOR_EMAIL="$AUTHOR_EMAIL" GIT_AUTHOR_DATE="$AUTHOR_DATE" GIT_COMMITTER_NAME="$COMMITTER_NAME" GIT_COMMITTER_EMAIL="$COMMITTER_EMAIL" GIT_COMMITTER_DATE="$COMMITTER_DATE" git commit -m "$COMMIT_MESSAGE" --allow-empty || true
  done
else
  echo "No cutoff commit found, using all history"
  git add -A
  git commit -m "Initial commit from GitLab CI - Production - Pipeline $CI_PIPELINE_ID"
fi
