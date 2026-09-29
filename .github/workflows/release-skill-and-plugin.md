# Release skill and plugin (`release-skill-and-plugin.yml`)

**What it's for:** publishing a new release of the sharp-pen skill and Claude Code plugin.

**When it runs:** every time a change to the skill (anything under `sharp-pen/`) or to this workflow is merged into `main`. It can also be started by hand from the Actions tab.

**What it does:** it picks the next version number, packs the skill and the plugin into zip files, and publishes them as a GitHub release. Every merge that touches the skill becomes a new release; nobody has to bump a version by hand.

## Steps

1. **Check out the code**, including all existing version tags, so it can see which version came last.
2. **Pick the next version.** It finds the newest `v*` tag (for example `v0.1.7`) and adds one to the last number (`v0.1.8`). If there is no tag yet, it starts at `v0.1.0`.
3. **Check that the two plugin manifests agree.** The plugin is described in two files, one for Claude Code and one for the cross-client plugin standard. Their name, description, license, homepage and repository must match, or the release stops.
4. **Zip the skill.** It copies the skill folder, renames it to `sharp-pen`, and zips it as `sharp-pen-<version>.zip`. It also makes a copy named `sharp-pen-latest.zip`, so a download link to the latest release always works.
5. **Zip the plugin.** It copies the whole plugin, writes the new version number into both manifests (the repository itself keeps no version number), and zips it as `sharp-pen-plugin-<version>.zip`, plus a `-latest` copy.
6. **Create the tag and the GitHub release,** with all four zip files attached and release notes generated from the merged changes.

Only one release runs at a time, so two quick merges can't pick the same version number.
