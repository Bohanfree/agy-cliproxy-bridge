# Third-party notices

## Vendored AGY ACP bridge

`vendor/agy-bridge/` contains a patched copy of the MIT-licensed
`@magpie-community/opencode-agy-cli-auth` package, version 0.1.3.

- Package repository: https://github.com/magpie-community/plugins/tree/main/packages/agy-cli
- Original bridge: https://github.com/DylanLIiii/opencode-antigravity-bridge
- Intermediate integration: https://github.com/gitxm/yce-magpie-agy
- Copyright: DylanLIiii, gitxm, yce; see the unchanged vendored LICENSE.
- The Windows command escaping adaptation in `platform.mjs` also retains its
  Made With MOXY Ltd MIT copyright and license text inline.

The vendored files are distributed unchanged from the patched baseline used by
this adapter. The detailed patch lineage is retained in
`vendor/agy-bridge/NOTICE.md`; SHA-256 checksums are in `vendor/provenance.json`.
The recorded checksums identify the exact vendored contents, rather than claiming
that the patched files match an unmodified upstream release.

## External runtimes and services

Antigravity CLI, Magpie, CLIProxyAPI and Node.js are external projects. Their
binaries are not included in this repository. Docker templates reference images
distributed under their respective projects' terms. Install AGY and authenticate
with your own account using its official documentation.
