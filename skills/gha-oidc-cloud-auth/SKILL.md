---
name: gha-oidc-cloud-auth
description: Replaces long-lived cloud keys in GitHub Actions with OIDC federation to AWS, Google Cloud and Azure, with trust conditions that are tight but still match. Covers id-token permission, the exact sub claim formats including the 2026 immutable-ID format, environment and pull_request subjects, reusable workflow identity, and debugging "Not authorized to perform sts:AssumeRoleWithWebIdentity" and similar federation errors. Use when a workflow deploys to or reads from a cloud account, when removing stored cloud credentials from secrets, or when OIDC login fails.
license: MIT
---

# OIDC from GitHub Actions to cloud providers

## Workflow side

```yaml
permissions:
  id-token: write    # mint the OIDC token
  contents: read     # still needed for checkout; listing a scope zeroes the rest
```

Set this on the job that authenticates, not workflow-wide. `pull_request` runs from forks never get `id-token: write`, whatever the workflow requests.

## The `sub` claim decides everything

Cloud trust policies match on `sub`. Its shape depends on the job, and getting it wrong is the cause of nearly every "not authorized" error.

| Job context | Default `sub` |
| - | - |
| job has `environment: prod` | `repo:OWNER/REPO:environment:prod` |
| `pull_request` event | `repo:OWNER/REPO:pull_request` |
| branch push | `repo:OWNER/REPO:ref:refs/heads/main` |
| tag push | `repo:OWNER/REPO:ref:refs/tags/v1.2.0` |

- `environment` wins over branch. Adding `environment:` to a working job breaks a trust policy written for `ref:refs/heads/main`.
- Immutable IDs (github.com): repositories created, renamed or transferred after 2026-07-15, and any repo or org that opted in, get `repo:OWNER@OWNER_ID/REPO@REPO_ID:...`, for example `repo:octo-org@123456/app@456789:environment:prod`. You cannot infer the format from the repo's age. Read the real claim (below) before writing the trust policy.
- A called reusable workflow's token carries the caller's repository in `sub`. To trust only a central deploy workflow, match the `job_workflow_ref` claim (`org/ci/.github/workflows/deploy.yml@refs/heads/main`), via a custom claim template on GitHub's side or an attribute condition on the cloud side.

Print the claims of the actual job (no secret is exposed; the token itself is not printed):

```yaml
- run: |
    curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=debug" \
      | jq -r .value \
      | python3 -c 'import sys,json,base64;p=sys.stdin.read().split(".")[1];print(json.dumps(json.loads(base64.urlsafe_b64decode(p+"="*(-len(p)%4))),indent=2))'
```

Remove it once the policy matches.

## AWS

```yaml
- uses: aws-actions/configure-aws-credentials@v6
  with:
    role-to-assume: arn:aws:iam::123456789012:role/gha-deploy-prod
    aws-region: eu-west-1
```

Trust policy on the role:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:octo-org/app:environment:prod"
    }
  }
}
```

- Use `StringEquals` for an exact subject. `StringLike` with `repo:octo-org/*` lets every repo in the org, including future ones, assume the role.
- IAM rejects new or updated trust policies for this provider that have no `sub` condition.
- One role per environment. A shared role trusted for `pull_request` lets any PR author deploy.
- The OIDC provider needs no thumbprint maintenance for this issuer; AWS validates it against its own trust store.

## Google Cloud

```yaml
- uses: google-github-actions/auth@v3
  with:
    workload_identity_provider: projects/123456789/locations/global/workloadIdentityPools/github/providers/github
    service_account: deployer@my-project.iam.gserviceaccount.com   # omit for direct resource access
```

- Providers for GitHub require an attribute condition. Pin to the immutable repository ID, not the name: `assertion.repository_id == '456789' && assertion.ref == 'refs/heads/main'`.
- Map `attribute.repository_id = assertion.repository_id` and bind IAM roles to `principalSet://iam.googleapis.com/projects/NUM/locations/global/workloadIdentityPools/github/attribute.repository_id/456789`.
- With `service_account`, the principal also needs `roles/iam.workloadIdentityUser` on that service account.

## Azure

```yaml
- uses: azure/login@v3
  with:
    client-id: ${{ vars.AZURE_CLIENT_ID }}
    tenant-id: ${{ vars.AZURE_TENANT_ID }}
    subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
```

- These three IDs are not secrets; store them as variables so they show in logs when debugging.
- The federated credential's subject is an exact string match. Create one credential per subject (`environment:prod`, `ref:refs/heads/main`, `pull_request`). Wildcards are not supported on a plain federated credential.
- Error `AADSTS700213: No matching federated identity record found` prints the presented `sub`; copy it verbatim.

## Debugging checklist

1. Job has `id-token: write`? Error "Unable to get ACTIONS_ID_TOKEN_REQUEST_URL" means no.
2. Print the claims, compare `sub` and `aud` character by character with the trust policy.
3. Did someone add `environment:`, rename the repo, transfer it, or opt into immutable subjects?
4. Is the event `pull_request` while the policy expects a branch ref?
5. AWS: role ARN and provider ARN in the same account; audience is `sts.amazonaws.com`.
