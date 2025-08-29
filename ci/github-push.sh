#!/bin/sh
set -e

echo "Starting GitHub push process..."

# Configure git
git config --global user.email "karsten@alldone.app"
git config --global user.name "Alldone CI"

# Add remotes
git remote add origin_github "https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/kwkrass/alldone.git" || true
git remote add alldoneapp_github "https://${GITHUB_USER_ALLDONEAPP}:${GITHUB_TOKEN_ALLDONEAPP}@github.com/alldoneapp/alldoneapp.git" || true

# Push with history to origin_github (safer force that checks remote state)
git fetch origin_github master || true

# Ensure full history available relative to origin_github
git fetch origin_github --prune --tags --unshallow || git fetch origin_github --deepen=100000 || true

# Clean and repack local repository to avoid pack/unpack issues
echo "Running git gc and repack before pushing to origin_github..."
git gc --prune=now || true
git repack -adf || true

# Push with retries and exponential backoff
MAX_ATTEMPTS=3
DELAY=5
ATTEMPT=1
PUSH_SUCCESS=0
while [ "$ATTEMPT" -le "$MAX_ATTEMPTS" ]; do
  echo "Pushing to origin_github (attempt $ATTEMPT/$MAX_ATTEMPTS)..."
  if [ "$ATTEMPT" -eq 2 ]; then
    echo "Enabling verbose git trace for diagnostics on attempt $ATTEMPT"
    GIT_TRACE=1 GIT_CURL_VERBOSE=1 git push --force-with-lease origin_github HEAD:master && PUSH_SUCCESS=1 && break || true
  else
    git push --force-with-lease origin_github HEAD:master && PUSH_SUCCESS=1 && break || true
  fi
  echo "Push attempt $ATTEMPT failed, retrying in ${DELAY}s..."
  sleep "$DELAY"
  ATTEMPT=$((ATTEMPT+1))
  DELAY=$((DELAY*2))
done
if [ "$PUSH_SUCCESS" -ne 1 ]; then
  echo "WARNING: Failed to push to origin_github after $MAX_ATTEMPTS attempts. Continuing pipeline."
fi

# Push with history after July 18th, 2025 to alldoneapp_github (preserving authorship)
git fetch alldoneapp_github master || true

# Ensure full history available from origin
git fetch --prune --tags --unshallow || git fetch --deepen=100000 || true
git fetch origin master || true

# Store original HEAD before we lose it
ORIGINAL_HEAD=$(git rev-parse HEAD)
echo "Original HEAD: $ORIGINAL_HEAD"

# Find the last commit before July 18th, 2025 UTC on origin/master
CUTOFF_COMMIT=$(git rev-list --max-count=1 --before="2025-07-18T00:00:00Z" origin/master)
echo "Cutoff commit (last commit before July 18th, 2025 UTC): $CUTOFF_COMMIT"

# Copy CI scripts to temp location before we remove everything
mkdir -p /tmp/ci-backup
cp -r ci/ /tmp/ci-backup/ || true

# Create orphan branch but replay commits after cutoff date to preserve authorship
git checkout --orphan temp-branch
git rm -rf . || true

# Create a script to replay commits with preserved authorship
cat > replay_commits.sh << 'EOF'
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
EOF

chmod +x replay_commits.sh
CUTOFF_COMMIT="$CUTOFF_COMMIT" ORIGINAL_HEAD="$ORIGINAL_HEAD" sh replay_commits.sh
git push --force alldoneapp_github temp-branch:master || true

# Restore CI scripts for the next step
cp -r /tmp/ci-backup/ci/ . || true

# Restore the original working tree for subsequent build steps
echo "Restoring original working tree..."
git checkout -f "$ORIGINAL_HEAD" || (echo "Failed to checkout original HEAD, attempting hard reset"; git reset --hard "$ORIGINAL_HEAD")

echo "GitHub push process completed"