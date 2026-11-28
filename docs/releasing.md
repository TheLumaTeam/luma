# Releasing

Push a `v*` tag. The release workflow validates the source, builds each
platform bundle, and publishes the release with the notes from the matching
`CHANGELOG.md` section.

## Build provenance

The publish job attests every release file. To check a download:

```sh
gh attestation verify luma-aarch64-apple-darwin.tar.gz \
  --repo TheLumaTeam/luma \
  --signer-workflow TheLumaTeam/luma/.github/workflows/release.yml
```

The installers run this check when the GitHub CLI is installed and signed in.
A failed check is only a warning unless `LUMA_REQUIRE_ATTESTATION=1` is set,
because older releases have no attestation. Someone able to replace release
files could also remove an attestation, so only that setting protects against
it. The install scripts themselves come from the `main` branch and are not
covered by the check.

## Code signing

Luma has no Apple Developer ID and does not sign for Windows. The macOS app is
signed ad hoc when it is packaged, and `install.sh` signs the installed app and
Core ad hoc again on the user's Mac. Ad-hoc signing does not identify a
publisher and is not notarization, so macOS may still block a copy downloaded
with a browser. Windows and Linux files are not signed; use build provenance to
check where a download came from.
