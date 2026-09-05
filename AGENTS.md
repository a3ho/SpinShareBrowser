# Project instructions

## Release documentation

- Treat `README.md` and `README.zh-CN.md` as user-facing product documentation.
- Keep `Use` / `使用` concise and task-oriented: explain what the user should do, what they will see, and only safety-critical consequences.
- Do not put implementation details there, including hashing or indexing algorithms, queue and concurrency internals, cache invalidation, rollback mechanics, or process-lifecycle design. Put those details in `CHANGELOG.md`, `PRODUCT.md`, `DESIGN.md`, or build documentation as appropriate.
- For every release, update the English and Chinese README together and review both usage sections against this rule before publishing.
- Before publishing, verify that both README screenshots and demonstrations reflect the current interface and visible user actions. Regenerate stale media from isolated data, and never expose local paths or obsolete UI states.

## Release versioning

- Use Semantic Versioning for every formal release containing program changes: increment PATCH for fixes and other compatible maintenance changes, MINOR for compatible new features, and MAJOR for breaking changes.
- Documentation-only updates do not require a version increment.
- Never overwrite published tags or same-version release artifacts. Publish changed program builds under a new version and tag, and preserve existing release assets.
