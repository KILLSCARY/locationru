# Resilient Taxi Contracts

Public, runtime-validated contracts shared by API and client applications. The
package deliberately exposes only Zod schemas and inferred TypeScript types; it
does not expose Prisma models or API implementation details.

## Versioning

The npm package follows Semantic Versioning. `CONTRACT_VERSION` identifies the
wire-contract line (`v1`). Additive, backwards-compatible changes are released
as minor package versions within `v1`; breaking wire changes require a new major
package version and a new contract version.
