# Project instructions

## Release documentation

- Treat `README.md` and `README.zh-CN.md` as user-facing product documentation.
- Keep `Use` / `使用` concise and task-oriented: explain what the user should do, what they will see, and only safety-critical consequences.
- Do not put implementation details there, including hashing or indexing algorithms, queue and concurrency internals, cache invalidation, rollback mechanics, or process-lifecycle design. Put those details in `CHANGELOG.md`, `PRODUCT.md`, `DESIGN.md`, or build documentation as appropriate.
- For every release, update the English and Chinese README together and review both usage sections against this rule before publishing.
