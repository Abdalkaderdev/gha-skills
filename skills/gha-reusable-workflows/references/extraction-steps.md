# Extracting duplicated CI

1. Diff the copies. List what differs between them: versions, paths, commands, secrets, runner labels. Each difference becomes an input or secret. Everything else is fixed in the shared file.
2. Decide the unit per the table in SKILL.md. If the duplication is "checkout, setup, install" at the start of many jobs, it is a composite action. If it is entire jobs with their own matrix or environment, it is a reusable workflow.
3. Write the shared unit with defaults equal to the most common caller, so most call sites pass nothing.
4. Convert one caller. Run it. Compare the job log and timing with the old run.
5. Check required status checks. Reusable workflow jobs report as `<caller job> / <called job>`. Update branch protection or rulesets before merging, or merges block on a check that no longer exists.
6. Convert the remaining callers in one PR per repo.
7. For cross-repo use, tag a release of the shared repo and pin callers to it; let Dependabot (`package-ecosystem: github-actions`) raise bumps, which covers both actions and reusable workflow refs.

## Smells after extraction

- An input named `extra-args` or `script` that callers fill with shell: the abstraction leaks and is an injection risk. Add specific inputs instead.
- More than about eight inputs: the callers are not doing the same thing. Split it.
- `if: inputs.mode == 'a'` branches covering most of the file: two different workflows sharing a file name.
