# Source this (`. ci/useFirebaseDeployCredentials.sh production|staging`) before any
# firebase-tools command in CI. It points firebase-tools at the deploy service account for
# that environment through GOOGLE_APPLICATION_CREDENTIALS and exports
# FIREBASE_DEPLOY_PROJECT, the only project that credential may reach.
#
# WHY (security audit 2026-11, NV-32)
#
# Every Firebase deploy used to authenticate with one `firebase login:ci` token,
# GOOGLE_FIREBASE_DEPLOY_TOKEN: a person's refresh token that could deploy both projects,
# readable by develop and by every feature-branch pipeline (the manual preview, staging-live
# and staging-functions jobs need it, so it could not be protected). Any branch could
# therefore deploy production. Now there are two credentials:
#
#   FIREBASE_DEPLOY_SA_PROD     protected (default-branch pipelines only); a key for a deploy
#                               service account with roles on alldonealeph only
#   FIREBASE_DEPLOY_SA_STAGING  not protected; a key for a deploy service account with roles
#                               on alldonestaging only
#
# Either may be a GitLab "File" variable (the value is a path) or hold the JSON itself.
# There is deliberately no fallback to the old token: a missing variable fails the job
# with the variable's name, rather than deploying with a credential that reaches both
# projects. The checks below are a second line; the real boundary is that the production
# variable is protected and the staging account has no role on production.
#
# POSIX sh (the Firebase images are Alpine). Runs in the job's own shell, so a failure
# here `exit`s the job.

_fdc_env="${1:-}"
case "$_fdc_env" in
    production)
        _fdc_var="FIREBASE_DEPLOY_SA_PROD"
        _fdc_project="alldonealeph"
        ;;
    staging)
        _fdc_var="FIREBASE_DEPLOY_SA_STAGING"
        _fdc_project="alldonestaging"
        ;;
    *)
        echo "useFirebaseDeployCredentials: usage: . ci/useFirebaseDeployCredentials.sh production|staging" >&2
        exit 2
        ;;
esac

_fdc_fail() {
    echo "useFirebaseDeployCredentials [$_fdc_env]: ERROR: $1" >&2
    exit 1
}

if [ "$_fdc_env" = "production" ]; then
    if [ -z "${CI_DEFAULT_BRANCH:-}" ] || [ "${CI_COMMIT_BRANCH:-}" != "$CI_DEFAULT_BRANCH" ] || [ "${CI_COMMIT_REF_PROTECTED:-}" != "true" ]; then
        _fdc_fail "production deploy credentials are only for protected default-branch pipelines (branch '${CI_COMMIT_BRANCH:-}')."
    fi
fi

eval "_fdc_value=\${$_fdc_var:-}"
if [ -z "$_fdc_value" ]; then
    _fdc_fail "$_fdc_var is not set for this pipeline. Create it under Settings > CI/CD > Variables
       (type File; protected for production, unprotected for staging) holding the JSON key of the
       $_fdc_env deploy service account. See 'Firebase deploy credentials' in CLAUDE.md."
fi

if [ -f "$_fdc_value" ]; then
    _fdc_file="$_fdc_value"
else
    # A variable holding the JSON itself: write it outside the checkout, so no packaging or
    # artifact step can pick it up, and readable by this user only.
    _fdc_file="$(umask 077 && mktemp "${TMPDIR:-/tmp}/firebase-deploy-sa.XXXXXX")" || _fdc_fail "cannot create a temporary key file."
    printf '%s\n' "$_fdc_value" >"$_fdc_file"
fi
unset _fdc_value

# Shape and ownership only; nothing derived from the key is printed.
if ! FDC_KEY_FILE="$_fdc_file" FDC_PROJECT="$_fdc_project" node -e '
const fs = require("fs")
let key
try {
    key = JSON.parse(fs.readFileSync(process.env.FDC_KEY_FILE, "utf8"))
} catch (_) {
    console.error("the key is not valid JSON")
    process.exit(1)
}
const project = process.env.FDC_PROJECT
if (!key || key.type !== "service_account") {
    console.error("the key is not a service account key")
    process.exit(1)
}
if (key.project_id !== project || !String(key.client_email || "").endsWith(`@${project}.iam.gserviceaccount.com`)) {
    console.error(`the key belongs to ${key.client_email || "an unknown account"}, not to a service account of ${project}`)
    process.exit(1)
}
'; then
    _fdc_fail "$_fdc_var does not hold a service account key of $_fdc_project (see the line above)."
fi

export GOOGLE_APPLICATION_CREDENTIALS="$_fdc_file"
export FIREBASE_DEPLOY_PROJECT="$_fdc_project"
# firebase-tools prefers a token over ADC. Never let a leftover personal token, from this
# job's environment or an old CI variable, take precedence over the scoped account.
unset FIREBASE_TOKEN GOOGLE_FIREBASE_DEPLOY_TOKEN
echo "useFirebaseDeployCredentials: using the $_fdc_env deploy service account for project $_fdc_project."
unset _fdc_env _fdc_var _fdc_project _fdc_file
