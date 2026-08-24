# Changesets

Add a changeset to a pull request when it changes the published package in a way users should see in a release. This includes new behavior, bug fixes, compatibility changes, and dependency updates that affect users.

A changeset is not required for documentation, tests, CI configuration, or internal refactoring that does not change published behavior. Use an empty changeset when a pull request needs to record an intentional no-release decision:

```sh
vp run changeset --empty
```

For a release, choose `patch`, `minor`, or `major` according to SemVer and write a concise user-facing summary. Commit the generated Markdown file with the pull request. After changesets reach `main`, the release workflow creates or updates the release pull request; do not edit `package.json` or `CHANGELOG.md` separately for the same release.
