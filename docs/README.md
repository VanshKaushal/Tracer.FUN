# Documentation

## Start here

| Guide                                     | Contents                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| [Development](DEVELOPMENT.md)             | Windows setup, local development, architecture, commands and troubleshooting. |
| [Releasing and hosting](RELEASING.md)     | Windows packages, installer verification and Cloudflare Pages deployment.     |
| [Validation status](validation.md)        | Verified release checks and remaining hardware acceptance work.               |
| [Release notes](RELEASE_NOTES.md)         | Current public beta and its limitations.                                      |
| [Website search and AI discovery](SEO.md) | SEO/GEO implementation, content maintenance and Search Console setup.         |

## Implementation references

- [Trace Bar](TRACE_BAR_SPEC.md): native windows, docking, live state and focus sessions.
- [IPC protocol](IPC_SPEC.md): communication between the collector and views.
- [Data model](DATA_MODEL.md): SQLite records and retention.
- [Test plan](TEST_PLAN.md): automated checks and physical-device acceptance tests.

## Design and historical records

The original [product requirements](specifications/PRODUCT_REQUIREMENTS.md) and [technical requirements](specifications/TECHNICAL_REQUIREMENTS.md) provide design context. Proposed behavior in those documents is not a claim of current platform support; use the project README and validation status for the shipped release.

The [launch audit](archive/launch-audit.md) and [validation history](archive/validation-history.md) preserve earlier decisions and test evidence. They include superseded build paths, hosting addresses and local development failures.
