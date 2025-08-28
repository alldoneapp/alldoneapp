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
git push --force-with-lease origin_github HEAD:master || true

# Push with history after July 18th, 2025 to alldoneapp_github (preserving authorship)
git fetch alldoneapp_github master || true

# Store original HEAD before we lose it
ORIGINAL_HEAD=$(git rev-parse HEAD)
echo "Original HEAD: $ORIGINAL_HEAD"

# Find the first commit after July 18th, 2025
CUTOFF_COMMIT=$(git rev-list --max-count=1 --before="2025-07-18" HEAD)
echo "Cutoff commit (last commit before July 18th, 2025): $CUTOFF_COMMIT"

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

echo "GitHub push process completed"