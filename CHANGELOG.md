# Changelog

## [0.17.0](https://github.com/GuJi08233/TokenArena/compare/v0.16.6...v0.17.0) (2026-09-28)


### Features

* **cli:** extract Snow sessions and cache creation tokens ([1129cb5](https://github.com/GuJi08233/TokenArena/commit/1129cb58b2874134c2cb75578666a5d0e0792925))
* **cli:** extract Snow sessions and cache creation tokens ([544d1e2](https://github.com/GuJi08233/TokenArena/commit/544d1e26d036d2e23181ef71da77476e85866d8f))


### Bug Fixes

* **cli:** count branched, duplicated and compacted Snow sessions once ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))
* **cli:** ignore implausible Snow timestamps that make uploads fail ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))
* **cli:** keep damaged Snow transcripts from blocking uploads ([#44](https://github.com/GuJi08233/TokenArena/issues/44)) ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))
* **cli:** keep Snow buckets on a stable project key ([34f6ed7](https://github.com/GuJi08233/TokenArena/commit/34f6ed72f3061e3b29ace03265b1d7632f3b5dd7))
* **cli:** preserve Snow snapshots on incomplete scans ([b968fda](https://github.com/GuJi08233/TokenArena/commit/b968fda829a5e0a37d2d76d4b730a6b0d9f55f8b))
* **cli:** stop counting Snow cache reads twice for OpenAI-format usage ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))
* **cli:** tolerate a plain ~/.snow file on Linux and macOS ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))
* **web:** handle DST ranges, profile privacy and initial preferences ([#42](https://github.com/GuJi08233/TokenArena/issues/42)) ([2d6b9ea](https://github.com/GuJi08233/TokenArena/commit/2d6b9ea3ba30107a74ef878cf28aa644fff1cd43))
* **web:** keep repeated and off-grid DST hours apart in hourly trends ([2d6b9ea](https://github.com/GuJi08233/TokenArena/commit/2d6b9ea3ba30107a74ef878cf28aa644fff1cd43))
* **web:** keep today in 7d and 30d trends in zones that skip midnight ([2d6b9ea](https://github.com/GuJi08233/TokenArena/commit/2d6b9ea3ba30107a74ef878cf28aa644fff1cd43))
* **web:** let a concurrent first preference update succeed ([2d6b9ea](https://github.com/GuJi08233/TokenArena/commit/2d6b9ea3ba30107a74ef878cf28aa644fff1cd43))
* **web:** recheck profile visibility when writing leaderboard snapshots ([2d6b9ea](https://github.com/GuJi08233/TokenArena/commit/2d6b9ea3ba30107a74ef878cf28aa644fff1cd43))


### Performance Improvements

* **cli:** attribute Snow usage in one time-ordered sweep ([95a31a4](https://github.com/GuJi08233/TokenArena/commit/95a31a42e9fc95b15f6996e18b80a8b2695e555a))

## [0.16.6](https://github.com/GuJi08233/TokenArena/compare/v0.16.5...v0.16.6) (2026-09-24)


### Bug Fixes

* **web:** let the username hook run during OAuth sign-up ([e189710](https://github.com/GuJi08233/TokenArena/commit/e18971006fa0cac11029b0c7ad76bb90301cf72e))
* **web:** let the username hook run during OAuth sign-up ([38e3193](https://github.com/GuJi08233/TokenArena/commit/38e3193eff4d5d7d18beec8d143fb1bfb7874a65))

## [0.16.5](https://github.com/GuJi08233/TokenArena/compare/v0.16.4...v0.16.5) (2026-09-23)


### Bug Fixes

* harden SVG responses and correct a CodeQL suppression ([#37](https://github.com/GuJi08233/TokenArena/issues/37)) ([55cd764](https://github.com/GuJi08233/TokenArena/commit/55cd76436ef7ab8377ab7ae55d17d8e124f676fd))

## [0.16.4](https://github.com/GuJi08233/TokenArena/compare/v0.16.3...v0.16.4) (2026-09-23)


### Bug Fixes

* address recent CLI and web review regressions ([26d1b4b](https://github.com/GuJi08233/TokenArena/commit/26d1b4b7feed54b1b93324e59a9ec8f37285ca6c))
* **web:** upgrade next to 16.3.6 and better-auth to 1.6.33 ([13aee9b](https://github.com/GuJi08233/TokenArena/commit/13aee9beb0a921c05b677db5f14b5e5be6d51639))


### Performance Improvements

* reduce sync and profile processing costs ([38b29b1](https://github.com/GuJi08233/TokenArena/commit/38b29b1ac812bb3f99e051e7229cd3b517d28c56))
* **web:** confirm listed heatmap day starts before searching ([25faa75](https://github.com/GuJi08233/TokenArena/commit/25faa75e830d46db770d3513b98246ce5a1f6061))

## [0.16.3](https://github.com/GuJi08233/TokenArena/compare/v0.16.2...v0.16.3) (2026-09-22)


### Performance Improvements

* 消除热路径上的全量扫描 ([#33](https://github.com/GuJi08233/TokenArena/issues/33)) ([5eac195](https://github.com/GuJi08233/TokenArena/commit/5eac195be7ee2c11e51229416013f8a3b1fead98))

## [0.16.2](https://github.com/GuJi08233/TokenArena/compare/v0.16.1...v0.16.2) (2026-09-20)


### Bug Fixes

* **cli:** verify codex fork coverage by parent line count ([#31](https://github.com/GuJi08233/TokenArena/issues/31)) ([0ee12a3](https://github.com/GuJi08233/TokenArena/commit/0ee12a39d7324eb4d50c1fe7d181418d8ecd0a75))

## [0.16.1](https://github.com/GuJi08233/TokenArena/compare/v0.16.0...v0.16.1) (2026-09-20)


### Bug Fixes

* **docker:** run database migrations before web startup ([30a9c4d](https://github.com/GuJi08233/TokenArena/commit/30a9c4d1ea1a9a418b0922ad06687a397664a17f))

## [0.16.0](https://github.com/GuJi08233/TokenArena/compare/v0.15.0...v0.16.0) (2026-09-20)


### Features

* 对齐多工具用量统计并补齐缓存写入 ([#28](https://github.com/GuJi08233/TokenArena/issues/28)) ([e8f12e8](https://github.com/GuJi08233/TokenArena/commit/e8f12e838b72e9002c553a11fc30040e87225c94))


### Bug Fixes

* **cli:** clear 20 latent type errors and gate typechecking in CI ([976455f](https://github.com/GuJi08233/TokenArena/commit/976455f89ea592e11b8921463f2e06963d005319))
* **cli:** report an honest version and fail loudly on unbundled entry points ([ba68d8e](https://github.com/GuJi08233/TokenArena/commit/ba68d8e0d5abb4f792ccc57a95c4ca235929cf82))
* **cli:** run entry point and resolve version when sources are unbundled ([98a4b21](https://github.com/GuJi08233/TokenArena/commit/98a4b21266cd389ebd4e4637a2cc37760187a58e))

## [0.15.0](https://github.com/GuJi08233/TokenArena/compare/v0.14.2...v0.15.0) (2026-09-12)


### Features

* **web:** add time range filter to public profiles ([ac9f318](https://github.com/GuJi08233/TokenArena/commit/ac9f318bee3987c09767b7420f3c16dc17d82e33))

## [0.14.2](https://github.com/GuJi08233/TokenArena/compare/v0.14.1...v0.14.2) (2026-09-09)


### Bug Fixes

* **cli:** resolve kimi-code model name from llm.request when aliased ([1ff260f](https://github.com/GuJi08233/TokenArena/commit/1ff260f0f74bdc34de2752907cc33f0902b8aea2))
* **cli:** resolve type error in kimi-code model placeholder ([c7c0f38](https://github.com/GuJi08233/TokenArena/commit/c7c0f388f57ce5611420c9215bee071a76ce58f9))

## [0.14.1](https://github.com/GuJi08233/TokenArena/compare/v0.14.0...v0.14.1) (2026-09-08)


### Bug Fixes

* **cli:** make the sqlite fallback test cross-platform ([21a1eb4](https://github.com/GuJi08233/TokenArena/commit/21a1eb48a5565b18033d42be84f7b5b105d047e2))
* **cli:** warn when the sqlite immutable fallback skips WAL data ([0455930](https://github.com/GuJi08233/TokenArena/commit/045593057eae0083c0e5b653e579fe185c70bc06))

## [0.14.0](https://github.com/GuJi08233/TokenArena/compare/v0.13.0...v0.14.0) (2026-09-07)


### Features

* **cli:** add Cherry Studio usage parser ([b3df593](https://github.com/GuJi08233/TokenArena/commit/b3df593d95f9289eed762124744fda980d8a180e))


### Bug Fixes

* **cli:** make cherry-studio path assertions cross-platform ([f723985](https://github.com/GuJi08233/TokenArena/commit/f7239853243ee4e687d3a1f686cfb986b61df8f0))

## [0.13.0](https://github.com/GuJi08233/TokenArena/compare/v0.12.1...v0.13.0) (2026-09-07)


### Features

* **cli:** add mirasim GUI sub-agent usage parser ([e939614](https://github.com/GuJi08233/TokenArena/commit/e939614e4add3f2db08ed4b67ebc2cc7bb3a1668))

## [0.12.1](https://github.com/GuJi08233/TokenArena/compare/v0.12.0...v0.12.1) (2026-08-25)


### Bug Fixes

* **cli:** clamp zcode activeSeconds to session duration ([24a440a](https://github.com/GuJi08233/TokenArena/commit/24a440a2566a293f80a66498b08096a31d7b9604))
* **cli:** deduplicate codex token_count events across rollout files ([628a5a4](https://github.com/GuJi08233/TokenArena/commit/628a5a41dd13f05824a9cfbed6811ec73876e858))

## [0.12.0](https://github.com/GuJi08233/TokenArena/compare/v0.11.0...v0.12.0) (2026-08-23)


### Features

* **cli:** add DeepSeek Harness (dsh) session parser ([e4d3352](https://github.com/GuJi08233/TokenArena/commit/e4d335212a51bf368f9d24e6c40229e604dc249f))


### Bug Fixes

* **cli:** correct dsh parser token and prompt accounting ([ef59553](https://github.com/GuJi08233/TokenArena/commit/ef595535045dcb993cf009b27e9dbdb6e84f0889))

## [0.11.0](https://github.com/GuJi08233/TokenArena/compare/v0.10.0...v0.11.0) (2026-08-03)


### Features

* **cli:** add AtomCode usage parser ([d7b7364](https://github.com/GuJi08233/TokenArena/commit/d7b7364451bf7cb1f5b6eca1f1fe517490a07838))


### Bug Fixes

* **cli:** make atomcode parser test path assertion cross-platform ([be0c83b](https://github.com/GuJi08233/TokenArena/commit/be0c83b8dccf7f4827a33ef310833852c2def81b))

## [0.10.0](https://github.com/GuJi08233/TokenArena/compare/v0.9.0...v0.10.0) (2026-07-31)


### Features

* **cli:** add qodercli credit and Grok Build usage parsers ([23ebaac](https://github.com/GuJi08233/TokenArena/commit/23ebaac0d647387602d9d8e7c1bb60888a8b9806))


### Bug Fixes

* **cli:** normalize paths in extractQoderProject for Windows CI ([0390075](https://github.com/GuJi08233/TokenArena/commit/03900753bf080d005958491e43563c5eff8c5290))

## [0.9.0](https://github.com/GuJi08233/TokenArena/compare/v0.8.8...v0.9.0) (2026-07-23)


### Features

* **cli:** add LetCode usage parser ([14b8c37](https://github.com/GuJi08233/TokenArena/commit/14b8c37450a5478b842ac14bedc09278fd9fb86c))
* **cli:** add LetCode usage parser ([df48990](https://github.com/GuJi08233/TokenArena/commit/df48990dc861337a45b04df21721343635b8bea7))

## [0.8.8](https://github.com/GuJi08233/TokenArena/compare/v0.8.7...v0.8.8) (2026-07-21)


### Bug Fixes

* **ci:** allow Trivy scan to pass with upstream CVEs and add security-events permission ([ca328a1](https://github.com/GuJi08233/TokenArena/commit/ca328a188b7e54db4010113650af31907467155b))


### Performance Improvements

* reduce runtime memory pressure ([ed24276](https://github.com/GuJi08233/TokenArena/commit/ed24276081846f30c19346d4544fb82464d34690))
* **web:** use webpack for production build to reduce runtime memory ([1e3f769](https://github.com/GuJi08233/TokenArena/commit/1e3f769eb04b11d3366734e86be6fc22dc7725d2))

## [0.8.7](https://github.com/GuJi08233/TokenArena/compare/v0.8.6...v0.8.7) (2026-07-20)


### Performance Improvements

* **web:** reduce Docker image size and runtime memory usage ([7d14d7a](https://github.com/GuJi08233/TokenArena/commit/7d14d7a4c2e56a76e0dcb9c43e03cbf030d212fa))

## [0.8.6](https://github.com/GuJi08233/TokenArena/compare/v0.8.5...v0.8.6) (2026-07-16)


### Bug Fixes

* **cli:** add name field to projects type in KimiCodeParser ([fc524ef](https://github.com/GuJi08233/TokenArena/commit/fc524ef440643aa78e26bfa4c7d5423e8ee649f5))
* **cli:** update Kimi Code parser for new directory structure ([9bb68a2](https://github.com/GuJi08233/TokenArena/commit/9bb68a28ac6f7ca2b5b6ecea965c8f01659bf222))

## [0.8.5](https://github.com/GuJi08233/TokenArena/compare/v0.8.4...v0.8.5) (2026-07-12)


### Bug Fixes

* **ci:** change Trivy exit-code to 0 to allow publishing with upstream CVEs ([d3d098b](https://github.com/GuJi08233/TokenArena/commit/d3d098b2fbea3c81b20015fcd91c008c0d54e589))

## [0.8.4](https://github.com/GuJi08233/TokenArena/compare/v0.8.3...v0.8.4) (2026-07-12)


### Bug Fixes

* **cli:** add timeout to isCommandAvailable to fix Windows CI timeout ([817d109](https://github.com/GuJi08233/TokenArena/commit/817d1096899aee310a6daa00098cdcb06234ba86))

## [0.8.3](https://github.com/GuJi08233/TokenArena/compare/v0.8.2...v0.8.3) (2026-07-12)


### Bug Fixes

* **docker:** revert to node:22-alpine and add .trivyignore for upstream CVEs ([6888bd1](https://github.com/GuJi08233/TokenArena/commit/6888bd139327a01c42bb3f27956866d75503d9e4))

## [0.8.2](https://github.com/GuJi08233/TokenArena/compare/v0.8.1...v0.8.2) (2026-07-12)


### Bug Fixes

* **docker:** use node:22-alpine3.21 to fix Trivy CRITICAL vulnerabilities ([63c9a69](https://github.com/GuJi08233/TokenArena/commit/63c9a69314fe9fc2559fd129c0bef4eed63fe722))

## [0.8.1](https://github.com/GuJi08233/TokenArena/compare/v0.8.0...v0.8.1) (2026-07-12)


### Bug Fixes

* **docker:** update node:22-alpine to 22.17 to fix Trivy CRITICAL vulnerabilities ([1302274](https://github.com/GuJi08233/TokenArena/commit/13022744a97f1b1d17cff79f6a06dae7a44b63e5))

## [0.8.0](https://github.com/GuJi08233/TokenArena/compare/v0.7.1...v0.8.0) (2026-07-12)


### Features

* **cli:** add MiMoCode parser for token usage tracking ([df8cdba](https://github.com/GuJi08233/TokenArena/commit/df8cdba983fa941f7a4f3414a50c0e9774d058d0))
* **cli:** add Snow CLI usage parser ([14ea9cc](https://github.com/GuJi08233/TokenArena/commit/14ea9cc7f5944cad3e56dd68994355caf484a647))
* **cli:** support zcode usage parsing ([36e7339](https://github.com/GuJi08233/TokenArena/commit/36e733957a7b761a161736b86968d7533087ae34))


### Bug Fixes

* **ci:** correct trivy-action version and fix docker-build digest reference ([a1f01e7](https://github.com/GuJi08233/TokenArena/commit/a1f01e7df59a4e1162be8f19b22778c1e5076a62))
* **ci:** only block on CRITICAL vulnerabilities in Trivy scan ([f1ed41b](https://github.com/GuJi08233/TokenArena/commit/f1ed41beba5c8213dd06423c13a78719e5b878ee))
* **ci:** repair release workflow and deduplicate Docker builds ([3cd6c08](https://github.com/GuJi08233/TokenArena/commit/3cd6c08ad8c9365054495aa94ca7361e8462d942))
* **cli:** use 'node' command in test to fix Windows CI timeout ([c03edd1](https://github.com/GuJi08233/TokenArena/commit/c03edd1bd890b9113388a5063fa7db8e96af88af))

## [0.7.1](https://github.com/GuJi08233/TokenArena/compare/v0.7.0...v0.7.1) (2026-06-30)


### Bug Fixes

* **ci:** correct trivy-action version and fix docker-build digest reference ([a1f01e7](https://github.com/GuJi08233/TokenArena/commit/a1f01e7df59a4e1162be8f19b22778c1e5076a62))

## [0.7.0](https://github.com/GuJi08233/TokenArena/compare/v0.6.2...v0.7.0) (2026-06-30)


### Features

* add AGENTS.md with repository guidelines and pnpm-lock.yaml ([8979daa](https://github.com/GuJi08233/TokenArena/commit/8979daa0f0209ab4c7552fb6fcfb3c317ac4c5ca))
* add initial configuration and assets for web project ([d1b2071](https://github.com/GuJi08233/TokenArena/commit/d1b2071fd5975645ae84f8e429e69080a7227c13))
* add parsers for Copilot CLI, Gemini CLI, OpenClaw, and OpenCode ([ae9e6ff](https://github.com/GuJi08233/TokenArena/commit/ae9e6ff6a509db8cde0d00beba8d3f32aa60f26f))
* add Prisma setup with PostgreSQL support ([22faafc](https://github.com/GuJi08233/TokenArena/commit/22faafc2965a29181fcd46620fcae75a9295a7c0))
* add TRANSACTION_TIMEOUT env var for configurable transaction timeout ([e01432d](https://github.com/GuJi08233/TokenArena/commit/e01432df87b83b8d013bdeebeb6a00900a758149))
* add usage filter functionality and settings management ([020073c](https://github.com/GuJi08233/TokenArena/commit/020073cf20263b30645b10658ee8286b9d231b32))
* **auth:** add CC98 OAuth provider support and update environment configuration ([7e5a2a7](https://github.com/GuJi08233/TokenArena/commit/7e5a2a7367aea37a1caff91e550b3d0063489f29))
* **auth:** add Discord OAuth2 support and update documentation ([4f2f432](https://github.com/GuJi08233/TokenArena/commit/4f2f4325f70b801af83ec3759e03258b053f3fc6))
* **auth:** add generic GitLab OAuth2 support with self-hosted compatibility ([4230517](https://github.com/GuJi08233/TokenArena/commit/4230517669c688629dded3b6b64056b6be1352a5))
* **auth:** add generic GitLab OAuth2 support with self-hosted compatibility ([626a120](https://github.com/GuJi08233/TokenArena/commit/626a120b8e3c7bddc765d1d0a6f2a09ac4eed161))
* **auth:** add hints for name and username fields in registration form ([415b6ae](https://github.com/GuJi08233/TokenArena/commit/415b6ae5cfc60a5cae5d39698dd1ffcf3c34d977))
* **auth:** add username support in registration and account management ([841523b](https://github.com/GuJi08233/TokenArena/commit/841523b0ed0cf7d5954299130c97b8ae235b762f))
* **ci:** add Claude Code workflow for issue and PR comment handling ([87130bd](https://github.com/GuJi08233/TokenArena/commit/87130bde914b4c754a6ba778e1e64174e9ef69cc))
* **ci:** add Claude settings for environment configuration ([c0b9ef9](https://github.com/GuJi08233/TokenArena/commit/c0b9ef9fb8f16afdb32c35c22c83db0fe86e89d1))
* **ci:** add feishu-bot workflow for event handling and notifications ([f99eee2](https://github.com/GuJi08233/TokenArena/commit/f99eee26b12bde78ca54d48198ecf38c0cf6241d))
* **ci:** enhance Docker workflow with QEMU setup and multi-platform support ([b1a0b35](https://github.com/GuJi08233/TokenArena/commit/b1a0b359240c323301ac1119bd03fff1bf619164))
* **cli/parsers:** add Cline session parser ([e21862a](https://github.com/GuJi08233/TokenArena/commit/e21862a610e915f53e2d413ac0fec59cd8613d2f))
* **cli/parsers:** add Cursor usage CSV parser and tests ([51eb3c6](https://github.com/GuJi08233/TokenArena/commit/51eb3c61b4b9e2f3b9d93ef5bae54a0f507339ac))
* **cli/parsers:** add Kiro agent parser ([11a001a](https://github.com/GuJi08233/TokenArena/commit/11a001a7e9a22ffc803ce6dceceed297ee2f069d))
* **cli/parsers:** add QwenPaw parser and corresponding tests ([b3b67b2](https://github.com/GuJi08233/TokenArena/commit/b3b67b2795299da2e4185202666ff83268729900))
* **cli/parsers:** add Roo Code session parser ([04ab4d3](https://github.com/GuJi08233/TokenArena/commit/04ab4d305d4aabcc0ca5c87caee24aa724104a9a))
* **cli/parsers:** introduced GSD-2 and Oh My Pi JSONL session parsers ([d3d8aff](https://github.com/GuJi08233/TokenArena/commit/d3d8aff739becb4ad83029fac4db077014c9a0ba))
* **cli/status:** include CLI version in status output ([d37981b](https://github.com/GuJi08233/TokenArena/commit/d37981b0b2cc01b8e685f2c659923f3b675102c9))
* **cli:** add device-aware hashed uploads ([478389d](https://github.com/GuJi08233/TokenArena/commit/478389dcf7a2dbf8ec068e46aabc6489212323c5))
* **cli:** add dynamic version detection and main module helpers ([3e6cfa1](https://github.com/GuJi08233/TokenArena/commit/3e6cfa13de9f8dcbd2c3adab773ce2d5eefeda5a))
* **cli:** add getIngestPayloadSize function and improve upload progress reporting ([656ef66](https://github.com/GuJi08233/TokenArena/commit/656ef66e2465871e4bb0574a352bc15784b22e6e))
* **cli:** add Hermes parser and refactor OpenClaw parser ([556471a](https://github.com/GuJi08233/TokenArena/commit/556471a7142bfa824643859bea822df7f038bcd3))
* **cli:** add install-service command for systemd daemon management ([7641195](https://github.com/GuJi08233/TokenArena/commit/76411959c451edf63d443d4edc74d37ee7279a92))
* **cli:** add isCommandAvailable utility using command -v ([4029dfe](https://github.com/GuJi08233/TokenArena/commit/4029dfee824df3e4603c298e03bf5e86ce4e586e))
* **cli:** add local usage dashboard tui ([f2fa18e](https://github.com/GuJi08233/TokenArena/commit/f2fa18e3624face20989ff90d77dc145d231eea6))
* **cli:** add local usage summary ([d5b912d](https://github.com/GuJi08233/TokenArena/commit/d5b912d25c019942fcae83078166786e11355aa5))
* **cli:** add macOS launchd service support ([8fb8689](https://github.com/GuJi08233/TokenArena/commit/8fb868971ad1bbc192f0a5be269c8083c1b2df76))
* **cli:** add parsers for qwen-code, kimi-code, droid, pi-coding-agent ([6056182](https://github.com/GuJi08233/TokenArena/commit/605618276e97b3b3e45929a410ae3e4a7072eaca)), closes [#11](https://github.com/GuJi08233/TokenArena/issues/11)
* **cli:** add service daemon support and improve sync reliability ([825d3eb](https://github.com/GuJi08233/TokenArena/commit/825d3ebf475a752398b4e098a7fcb48a245998c0))
* **cli:** add session-level token usage tracking with per-model breakdown ([7c3f4fc](https://github.com/GuJi08233/TokenArena/commit/7c3f4fc62366b1e64b3007641bd89c7a91c37a12))
* **cli:** add shell alias setup in init command ([17e4791](https://github.com/GuJi08233/TokenArena/commit/17e47910882d05d985cda2936ad63c1cece3c774))
* **cli:** add snapshot_protocol scope change to upload manifest ([180f740](https://github.com/GuJi08233/TokenArena/commit/180f7409c442d05bb2298df0675bd519ac54e505))
* **cli:** add uninstall command to remove local configuration and data ([fd673a8](https://github.com/GuJi08233/TokenArena/commit/fd673a8acb0729a11a07dc351ec55b51023a8fb3))
* **cli:** add upload manifest domain logic ([6ae5199](https://github.com/GuJi08233/TokenArena/commit/6ae519916ef9b686e7b2f58b73bf97f392d6d7fa))
* **cli:** adopt XDG Base Directory specification for config, state, and runtime paths ([e12576c](https://github.com/GuJi08233/TokenArena/commit/e12576c86df2df2ce0821cfd4f9597def10120cd))
* **cli:** change default API URL to token.poco-ai.com ([2380a9b](https://github.com/GuJi08233/TokenArena/commit/2380a9b82bebc0db976f99cedd8ffda0d649ba37))
* **cli:** enhance CLI with interactive home command and configuration management ([d221c7c](https://github.com/GuJi08233/TokenArena/commit/d221c7cb99ecfc2678e9ded411074a15d1adb475))
* **cli:** export CodexParser class and improve token calculation ([28b165e](https://github.com/GuJi08233/TokenArena/commit/28b165e7f3a74d19b4eebf7c4e029abe622788ab))
* **cli:** implement snapshot reset on scope change ([e99e724](https://github.com/GuJi08233/TokenArena/commit/e99e724f7c685989ad2a5a313f7bc3846c7decb1))
* **cli:** improve Windows compatibility and tool detection ([666cc5e](https://github.com/GuJi08233/TokenArena/commit/666cc5e2f593793754a66849f580d9b64c9c0216))
* **cli:** integrate upload manifest into sync service ([076ac38](https://github.com/GuJi08233/TokenArena/commit/076ac38d0e1108cfbb3e9ef4079b7a03211230d1))
* **cli:** normalize token and session metrics ([2266eff](https://github.com/GuJi08233/TokenArena/commit/2266eff78a15445c283a4a3a0782e3068cd769f0))
* **cli:** preserve reasoning token metrics ([6cfc11d](https://github.com/GuJi08233/TokenArena/commit/6cfc11d14a17a739dbeaa0884933e119f06ae9f4))
* **cli:** register Cursor, Cline, Kiro, Roo Code parsers and change default sync interval to 30 min ([560c0a8](https://github.com/GuJi08233/TokenArena/commit/560c0a85eeb259fc2e88b48038b0b855a706de2e))
* **cli:** support .jsonl format and nested subagent sessions for Gemini CLI ([cf08120](https://github.com/GuJi08233/TokenArena/commit/cf081201f9e5ca8cf53a6fd4194890356f27b7be))
* **cli:** support custom Claude config directory via CLAUDE_CONFIG_DIR env var ([eb2b9a6](https://github.com/GuJi08233/TokenArena/commit/eb2b9a6000b0f1a2995f98d1065d37ba2bf89d8f))
* **cli:** support zcode usage parsing ([36e7339](https://github.com/GuJi08233/TokenArena/commit/36e733957a7b761a161736b86968d7533087ae34))
* **cli:** wire status show dashboard ([9a7ef3b](https://github.com/GuJi08233/TokenArena/commit/9a7ef3bf0edf011f6f383810d1de37a995cba0d7))
* **cli:** 新增 GSD-2 与 Oh My Pi JSONL 对话解析器 ([1f91bc6](https://github.com/GuJi08233/TokenArena/commit/1f91bc64686d631292a2f342d55ee264465dfc8b))
* **db:** convert UsageBucket token columns to BIGINT for overflow handling ([81fd733](https://github.com/GuJi08233/TokenArena/commit/81fd7335da4f9b2cb00f5582761840668fade091))
* **db:** update leaderboard user day token columns to BIGINT for overflow handling ([a82f9da](https://github.com/GuJi08233/TokenArena/commit/a82f9da17259efd0f7f5c03ef4e510f4e6b4af3e))
* **docker:** add Discord OAuth2 environment variables to docker-compose ([ca14993](https://github.com/GuJi08233/TokenArena/commit/ca149935e8e8c0264d4802fdcabbe884e6f78d39))
* **docker:** add Docker configuration and startup script for easy deployment ([cf62e92](https://github.com/GuJi08233/TokenArena/commit/cf62e92a1df487b77595bd1cf511111b7371b1cf))
* **docker:** add entrypoint script for Prisma migrations and update Dockerfile ([a9d2b88](https://github.com/GuJi08233/TokenArena/commit/a9d2b88ac464eeab5299a3c28c22b6c887fe0e6e))
* Enhance achievements system with UI, API, and localization updates ([9966609](https://github.com/GuJi08233/TokenArena/commit/996660919f2bd4380098b480872e5ef9cc79692d))
* enhance styling and components with Tailwind CSS and Shadcn integration ([85e4525](https://github.com/GuJi08233/TokenArena/commit/85e4525459b78e145f9bf2d51ee889a62687e731))
* integrate better-auth with PostgreSQL and update Prisma setup ([4df3997](https://github.com/GuJi08233/TokenArena/commit/4df3997184563b34ea6576985ecf9b25f4f2ff5d))
* set up monorepo with CLI tool for token usage tracking ([de7a6b4](https://github.com/GuJi08233/TokenArena/commit/de7a6b404b1ac523904c21cd001c53f2a1000692))
* **web:** achievement badge, card, and notification UI ([3e56ac1](https://github.com/GuJi08233/TokenArena/commit/3e56ac134536f5d0d9b69250db49e628f0091443))
* **web:** achievements — tiers, spend category, leaderboard ranks ([ab80110](https://github.com/GuJi08233/TokenArena/commit/ab8011087d8ac267dfbdf0e7270cf905122e850f))
* **web:** add account identity and connected accounts setup functionality ([2b25934](https://github.com/GuJi08233/TokenArena/commit/2b259340a5197092ae12ab7393fbf6d49879f43e))
* **web:** add achievements domain library ([c06610b](https://github.com/GuJi08233/TokenArena/commit/c06610b8701284bcce7cebb87f2362755100dd4e))
* **web:** add achievements page, summary API, and shell entry ([0c4bccb](https://github.com/GuJi08233/TokenArena/commit/0c4bccbc0fa15a56a6d082ea42ba5a4390f44be1))
* **web:** add AppFooter to app and auth shells, update layout for better structure ([d8fd371](https://github.com/GuJi08233/TokenArena/commit/d8fd3714464d0f6788c18f9ca9cec0e12d58fe67))
* **web:** add arena level bar and two-column public profile layout ([151298c](https://github.com/GuJi08233/TokenArena/commit/151298c14bf23b1f26e02fc3fe1e26dddfad119d))
* **web:** add better-auth session foundation ([e851a94](https://github.com/GuJi08233/TokenArena/commit/e851a940175db9e04190f6cde79b908d956f7c29))
* **web:** add build-time placeholders for authentication configuration ([cc8f965](https://github.com/GuJi08233/TokenArena/commit/cc8f965061b02838a84969b4eca8204d487877ab))
* **web:** add compact variant for language and theme switchers ([003173d](https://github.com/GuJi08233/TokenArena/commit/003173d681c8fb2a59b9b9a9e9e063392af227c4))
* **web:** add cost estimation columns to UsageBucket and UsageSession ([b4789a8](https://github.com/GuJi08233/TokenArena/commit/b4789a8f986167e2cd59f8abf4762966c8b92ac3))
* **web:** add dedicated settings page and shared SettingsBody ([467e4b8](https://github.com/GuJi08233/TokenArena/commit/467e4b8667c89066a2aa404a095b38aab292183c))
* **web:** add delete account dialog to account identity card ([78c80e5](https://github.com/GuJi08233/TokenArena/commit/78c80e5df170de685179835eb7992eca154fc7b2))
* **web:** add DELETE endpoint for device snapshot deletion ([1f7496e](https://github.com/GuJi08233/TokenArena/commit/1f7496ea9d18bbf91776d5b2cf3fcf5bde6e0224))
* **web:** add deleteUsageDeviceSnapshot function ([d9e8f3d](https://github.com/GuJi08233/TokenArena/commit/d9e8f3d2d77bdec79de62355e79ba7d4532eab2e))
* **web:** add Docker configuration and .dockerignore for containerization ([4ba36ab](https://github.com/GuJi08233/TokenArena/commit/4ba36ab81c4ba538b15b03e1b05fbee00886c47e))
* **web:** add email password auth pages ([28152e6](https://github.com/GuJi08233/TokenArena/commit/28152e6e36ea6072640c1e56c56f6e15cc3fba9b))
* **web:** add empty state message for API keys in key manager ([c46dffe](https://github.com/GuJi08233/TokenArena/commit/c46dffeee6eacc073bbbdfffc36e3cfc454c6e31))
* **web:** add follow tags to social relationships ([4376803](https://github.com/GuJi08233/TokenArena/commit/43768035db44fff28f6558682d69096b2a90e276))
* **web:** add FollowTag enum and database migration ([115ceca](https://github.com/GuJi08233/TokenArena/commit/115ceca0de849b79966212ccdab7200ed5bb4811))
* **web:** add header navigation component and refactor app shell ([cf62ead](https://github.com/GuJi08233/TokenArena/commit/cf62ead9f722aa9c6a280dd639b9f8a5fe407244))
* **web:** add hourly activity heatmap to usage dashboard ([fb3fbde](https://github.com/GuJi08233/TokenArena/commit/fb3fbde37ca0836d1acc293e9cbeec7e147bd0c8))
* **web:** add i18n and theme switching ([5fd00d2](https://github.com/GuJi08233/TokenArena/commit/5fd00d2214f04a193a7d7ada4e2035fd14ed655a))
* **web:** add i18n strings for session metrics and pagination ([c27a30c](https://github.com/GuJi08233/TokenArena/commit/c27a30ceeec82e576e8c0f75b7ef62e275b3ea5b))
* **web:** add initial dimensions for responsive charts in usage components ([58d9028](https://github.com/GuJi08233/TokenArena/commit/58d9028e1d26d5c350c7d1a3a0c9e659223562bb))
* **web:** add justSaved state to AccountIdentityCard for improved save feedback ([190321c](https://github.com/GuJi08233/TokenArena/commit/190321c2ecbd04760eab6cf0e85b30499758f1b5))
* **web:** add leaderboard aggregation and query logic ([d4217a6](https://github.com/GuJi08233/TokenArena/commit/d4217a61a7b27da1bd7c9bdafd1586d3ff677bc4))
* **web:** add leaderboard database schema and migration ([e59edb1](https://github.com/GuJi08233/TokenArena/commit/e59edb1f48969ee9e29406c98ffc2c97489d1593))
* **web:** add leaderboard page, components, and i18n ([0dcae44](https://github.com/GuJi08233/TokenArena/commit/0dcae44089181bc62a54d165d07c11aa2984b6ee))
* **web:** add OAuth authentication support and dual auth modes ([44d3106](https://github.com/GuJi08233/TokenArena/commit/44d3106302dd3183dcbe538102bc4a7f35a8413a))
* **web:** add offset support for searching public profiles and implement count function ([b3bfdd7](https://github.com/GuJi08233/TokenArena/commit/b3bfdd719c2857aa5c78c9fa473f8b7237078e49))
* **web:** add pagination and token metrics to sessions section ([af3adf6](https://github.com/GuJi08233/TokenArena/commit/af3adf657a968dffb5a5211f2d7780c371220125))
* **web:** add pagination and tooltip UI components ([d60b6fa](https://github.com/GuJi08233/TokenArena/commit/d60b6fa8dd432704ef51c78bdd540e47d8208c8b))
* **web:** add pagination labels for public profiles ([c5620e1](https://github.com/GuJi08233/TokenArena/commit/c5620e1d3ac7d2b38e3b201fd5936e2e4a444bbc))
* **web:** add pagination support for public profiles and enhance UI text ([f62e1f7](https://github.com/GuJi08233/TokenArena/commit/f62e1f76aa00823550edf636d7c35318392c233f))
* **web:** add pagination to people page and simplify leaderboard table ([6832738](https://github.com/GuJi08233/TokenArena/commit/683273833a1600e184d9dd135272d367e4050519))
* **web:** add pricing catalog and cost-aware usage queries ([926f03f](https://github.com/GuJi08233/TokenArena/commit/926f03fc6a41e9f43e2e3445ad0ed532e42e8afc))
* **web:** add pricing-related i18n strings and update README ([5cd3a3c](https://github.com/GuJi08233/TokenArena/commit/5cd3a3ca84811dd9fd4816888919c3474bd58a85))
* **web:** add profile achievement wall query and compact badge grid ([a2103c2](https://github.com/GuJi08233/TokenArena/commit/a2103c22e92f71b465db99f6f7edca236e12a6df))
* **web:** add public profiles and follow system ([9466f59](https://github.com/GuJi08233/TokenArena/commit/9466f590198c9b3c66e5ebc6ad6f267335e77b72))
* **web:** add responsive logo support in AppShell and new logo assets ([5db14de](https://github.com/GuJi08233/TokenArena/commit/5db14de8b93846a10dd589d78a984dce11e7c55f))
* **web:** add route loading and error boundaries ([1e2f2cd](https://github.com/GuJi08233/TokenArena/commit/1e2f2cd7ff6b56b1c79206dfbf3242daa92e18f7))
* **web:** add settings page header with viewer and nav actions ([a2b35ec](https://github.com/GuJi08233/TokenArena/commit/a2b35ec04b06e23646e6bb61ed09380ec36fcf80))
* **web:** add settings section routes and URL-driven navigation ([f6dc4db](https://github.com/GuJi08233/TokenArena/commit/f6dc4db5cb901541d87ea9dea50e3fcc26cc6e85))
* **web:** add settings view helper functions ([ed39d80](https://github.com/GuJi08233/TokenArena/commit/ed39d804bc0a8765eccbf5e003b4f4edb9f6915a))
* **web:** add share card for usage dashboard ([270713e](https://github.com/GuJi08233/TokenArena/commit/270713e9346eaa6eb6e27e3663b9b1fd3373d8a7))
* **web:** add Suspense wrapper around KeyManager for improved loading handling ([fa68503](https://github.com/GuJi08233/TokenArena/commit/fa68503c8ed509d8e21a530a8d89d9d3be00b2d6))
* **web:** add usage dashboard pages ([32b5528](https://github.com/GuJi08233/TokenArena/commit/32b5528223ce44d3b892e5bc3447114469cf0240))
* **web:** add usage ingest pipeline ([61edcc5](https://github.com/GuJi08233/TokenArena/commit/61edcc5d9dd9eec8e509414ae925192117d9d35f))
* **web:** add usage persistence schema ([c660782](https://github.com/GuJi08233/TokenArena/commit/c660782522ecc7a12e1e7282e303edf1ff3486ca))
* **web:** add usage receipt sharing ([b828fb3](https://github.com/GuJi08233/TokenArena/commit/b828fb3ac99cf7a0012f227ce9382a67f2a82751))
* **web:** add usage settings and api key management ([393c31d](https://github.com/GuJi08233/TokenArena/commit/393c31d7b52618fbd3069220c63a8eaf0f372142))
* **web:** add user avatar and name display to account menu ([db3087c](https://github.com/GuJi08233/TokenArena/commit/db3087cb30abb4af11268eccacc8298c2f6ffeac))
* **web:** add viewer rank summary i18n strings for leaderboard ([8415121](https://github.com/GuJi08233/TokenArena/commit/8415121b30dac8e43043a8f8ca10a4fff648bb7b))
* **web:** badge sharing on usage dashboard ([c011562](https://github.com/GuJi08233/TokenArena/commit/c011562cc44e15b67c5c8b97f82d1c70d128ed8b))
* **web:** combine usage charts into one card ([1e29ba4](https://github.com/GuJi08233/TokenArena/commit/1e29ba43414254f571c6e1139bc1cf0d1b8048c1))
* **web:** compute viewer rank summary with gap metrics on leaderboard page ([fe6967b](https://github.com/GuJi08233/TokenArena/commit/fe6967bd889a334b9b280aa22607bc5905e1d3e1))
* **web:** consolidate followers and following into people page tabs ([207338a](https://github.com/GuJi08233/TokenArena/commit/207338a6d107832d1949c920246a83e35481373d))
* **web:** countup animation; integrate animated KPI components and enhance metrics formatting ([62692ed](https://github.com/GuJi08233/TokenArena/commit/62692ed4aa77200f97034f213d68223d9e91d195))
* **web:** dither login background, auth hero layout, footer icon controls ([9c2b1d2](https://github.com/GuJi08233/TokenArena/commit/9c2b1d2fcf4b2a36f5a8ba199d9e6abff27974ad))
* **web:** enable deleteUser plugin and add delete account i18n strings ([fb738e8](https://github.com/GuJi08233/TokenArena/commit/fb738e8e4d5a9e51151f1c5ce38a2500e2583b5d))
* **web:** enhance badge sharing with style selection ([a94b79d](https://github.com/GuJi08233/TokenArena/commit/a94b79def0ae2e6e476d8025e366355ee2d434c9))
* **web:** enhance KpiGrid component with delta badges and compact duration formatting ([3f13ebf](https://github.com/GuJi08233/TokenArena/commit/3f13ebfbd2e82f95e879e07f7891be2f9f0cf29a))
* **web:** enhance leaderboard functionality with new window badge and achievement synchronization ([c8ddad0](https://github.com/GuJi08233/TokenArena/commit/c8ddad0a8e2ac2eed33ffba90930e341c8d59ad9))
* **web:** enhance leaderboard table with rank highlighting and medal display ([9dea146](https://github.com/GuJi08233/TokenArena/commit/9dea146c95f71386f547b19830588b671510fbee))
* **web:** enhance people page search functionality with icon button ([7fa5932](https://github.com/GuJi08233/TokenArena/commit/7fa59326d75126f410132ea66fda1f7e77dc1884))
* **web:** enhance setup guide with dynamic API URL ([bfec734](https://github.com/GuJi08233/TokenArena/commit/bfec734e4173545788ba2f19e5cfc7a0fbf8c2ba))
* **web:** enhance usage components with preference management ([4c0b684](https://github.com/GuJi08233/TokenArena/commit/4c0b684bbeee5d1f7873b33d6f3f733681689e0b))
* **web:** enhance usage dashboard components with cost metrics ([6ed4830](https://github.com/GuJi08233/TokenArena/commit/6ed48307dbf6b65c8bf5c28c191b72410850edcb))
* **web:** enhance user viewer data and add settings dialog component ([f112d3b](https://github.com/GuJi08233/TokenArena/commit/f112d3bb897cb9c3be8ccacc04702c125919834a))
* **web:** expand exploration achievements ([c4b2ba9](https://github.com/GuJi08233/TokenArena/commit/c4b2ba9162d0e4e5f40bfc7b195d10200d67c70c))
* **web:** expand usage breakdown and sessions by default ([d4b1848](https://github.com/GuJi08233/TokenArena/commit/d4b184869ed1b3cf9cc8e62a6d33ae593145daf9))
* **web:** extend leaderboard and social queries with cost data ([143be29](https://github.com/GuJi08233/TokenArena/commit/143be296a5a4eb7657f70ba1bcbfbe0f7f904cc9))
* **web:** extend usage session data with token metrics and cost estimation ([27e75ca](https://github.com/GuJi08233/TokenArena/commit/27e75cacb3ec651df8b0fba421eed003ec60e4b3))
* **web:** extract useSocialFollow hook for follow API ([561ab33](https://github.com/GuJi08233/TokenArena/commit/561ab33cbbeb17ecc519fe621b1f8931388e14e6))
* **web:** implement plain header for usage overview and add corresponding tests ([8f5a5fe](https://github.com/GuJi08233/TokenArena/commit/8f5a5fe5ed2bf48f93106686e4268c8bd189b25f))
* **web:** improve connected accounts card with provider ordering and last-provider guard ([611cf1d](https://github.com/GuJi08233/TokenArena/commit/611cf1d9ee79f0bbed0518d0159e64993b577746))
* **web:** improve profile heatmap with CSS module and trailing padding ([c1f3220](https://github.com/GuJi08233/TokenArena/commit/c1f32203a6175acc98b135e0a174237b01532e3c))
* **web:** improve social profile components with enhanced styling ([463735a](https://github.com/GuJi08233/TokenArena/commit/463735a6cbf11090768bb00e207e5be76a2df5c9))
* **web:** improve usage dashboard metric cards ([89ebb00](https://github.com/GuJi08233/TokenArena/commit/89ebb001cbe7c760b7f917216fffef3fce98f883))
* **web:** improve usage dashboard UX ([0e6fffa](https://github.com/GuJi08233/TokenArena/commit/0e6fffa26ced699fbfdc5e02498c9726d513a613))
* **web:** improve usage empty state with copyable CLI steps ([364df05](https://github.com/GuJi08233/TokenArena/commit/364df05baf97cbc35999d0c32418adfa7044c5fc))
* **web:** integrate Google Analytics 4 support with GA_SECRET configuration ([67d99f7](https://github.com/GuJi08233/TokenArena/commit/67d99f77c32c5f6380d123dcaa929c401e35bc36))
* **web:** integrate leaderboard recomputation into ingest and preferences ([ae1d5fc](https://github.com/GuJi08233/TokenArena/commit/ae1d5fcdc590816289a435e8dd209c6555e63273))
* **web:** integrate Microsoft Clarity for enhanced user analytics ([2a900c2](https://github.com/GuJi08233/TokenArena/commit/2a900c2ed138c1c4f8001f0c109449351bcd9926))
* **web:** integrate ProfileHeatmap into UsagePage for enhanced activity visualization ([a4aa112](https://github.com/GuJi08233/TokenArena/commit/a4aa11256f831ad4d98366bdfc68a912c151c550))
* **web:** link public profile to OAuth provider home ([5d9b771](https://github.com/GuJi08233/TokenArena/commit/5d9b771271396553c768d1207632d4f8416c3104))
* **web:** move locale/theme controls into header actions ([09c16ac](https://github.com/GuJi08233/TokenArena/commit/09c16ac5bf008ae7319d6a26fdfc29bb3a227380))
* **web:** PC WeChat profile sharing ([785ba89](https://github.com/GuJi08233/TokenArena/commit/785ba89670b8c0f60ecd34d82cead51c2c496be7))
* **web:** rebalance arena level progression ([3c4de33](https://github.com/GuJi08233/TokenArena/commit/3c4de33d8786dc66c09aab4beaa8d09dd327e5b5))
* **web:** redesign account menu with icons and settings link ([9b4cb80](https://github.com/GuJi08233/TokenArena/commit/9b4cb80ae60e5f1b3a514cbe848d7b8da47f40f6))
* **web:** redesign settings layout, account cards, and key manager ([7db285c](https://github.com/GuJi08233/TokenArena/commit/7db285c8a9ce2b70e5c90a10fcceeb027a487fa5))
* **web:** refresh public profile layout, follow action, and i18n ([e54ac5b](https://github.com/GuJi08233/TokenArena/commit/e54ac5b539edb3475a574c8dbfc83d5d7f0364ed))
* **web:** render viewer rank summary card with jump-to-self in leaderboard table ([2135da0](https://github.com/GuJi08233/TokenArena/commit/2135da0ff44b6368b179b8d7068c736feffe6b8c))
* **web:** set user profile public by default ([d439843](https://github.com/GuJi08233/TokenArena/commit/d4398434fdf95ed568f84e548eca815c241689c3))
* **web:** shareable activity heatmap SVG and Markdown ([dca74b6](https://github.com/GuJi08233/TokenArena/commit/dca74b67bcf43c8034a5405a5bc3065b441f03c6))
* **web:** show app version in footer ([31c5473](https://github.com/GuJi08233/TokenArena/commit/31c5473bb86bd5626786abf4b43d6dd199a0072a))
* **web:** show one-time toast for auto-adjusted usernames ([4731a44](https://github.com/GuJi08233/TokenArena/commit/4731a44ef00aed21e9867deab461734bff50292b))
* **web:** support tag filtering on the following leaderboard ([372cf19](https://github.com/GuJi08233/TokenArena/commit/372cf194ccf382dec7cd064364f8cca684eb10bf))
* **web:** unify dashboard with shared app header ([15f55b6](https://github.com/GuJi08233/TokenArena/commit/15f55b62e55faeb7e5f9879d7f7a8f5dee092ca8))
* **web:** update achievement page metadata and improve UI styling ([247dabc](https://github.com/GuJi08233/TokenArena/commit/247dabcc43b9a46b3aa1f05fa785c7f2f314410f))
* **web:** update achievement titles and descriptions for English and Chinese ([7929e05](https://github.com/GuJi08233/TokenArena/commit/7929e051bfbf8987b538814ef094ace7690805db))
* **web:** update achievements page title and refactor translations ([ecf8a2b](https://github.com/GuJi08233/TokenArena/commit/ecf8a2baeee0fe09ddb49682eefcea173265b6c9))
* **web:** update layout metadata for Token Arena ([b1de218](https://github.com/GuJi08233/TokenArena/commit/b1de21848247b5e791b12f133eddd455ed8f1f86))
* **web:** update leaderboard token metrics to use BigInt for improved accuracy ([a64d23a](https://github.com/GuJi08233/TokenArena/commit/a64d23a3d0529453ae2baa55fecf09f9391bd300))
* **web:** update pages and add i18n messages for social features ([23d45db](https://github.com/GuJi08233/TokenArena/commit/23d45db10c7f11a5b87287ef26277f0bec179ba9))
* **web:** update settings dialog and usage flow for API key management ([9b54f81](https://github.com/GuJi08233/TokenArena/commit/9b54f8127e7582e96d9bfaa71d025049c0ffde04))
* **web:** use all-time totals on public profile ([50b707d](https://github.com/GuJi08233/TokenArena/commit/50b707dd7b81497a0471a2ef5aa3bf31d4b49f4b))
* **web:** use card for new CLI key with copy in header ([3032e28](https://github.com/GuJi08233/TokenArena/commit/3032e2827f4b905c9355fbaf554bdfbd84a1c51f))
* **web:** 更新排行榜页面以显示用户私密资料按钮和相关提示 ([1139d1c](https://github.com/GuJi08233/TokenArena/commit/1139d1c3c8508405024aafdd60cad6c6433dc279))
* **web:** 添加分页功能的相关文本到公开主页搜索结果 ([47b9acf](https://github.com/GuJi08233/TokenArena/commit/47b9acf5d043554f185d5e1bd662a28be930dd3b))
* **web:** 添加排行榜摘要排名和用户视图功能 ([cd02fe1](https://github.com/GuJi08233/TokenArena/commit/cd02fe15192591cbea37613e27d9159093c11146))
* **web:** 添加查看者全局条目到排行榜页面数据类型 ([bf63a7b](https://github.com/GuJi08233/TokenArena/commit/bf63a7bac2d6ff5c0df24053488a5dbdf3f7b3b6))
* **web:** 添加查看者条目到排行榜页面 ([73b0085](https://github.com/GuJi08233/TokenArena/commit/73b0085ad8756ef88fac431b3bba0a758299f73c))
* **web:** 添加用户视图行并优化排行榜表格渲染逻辑 ([bc6ecfa](https://github.com/GuJi08233/TokenArena/commit/bc6ecfaf25fcd932c49b7a361f3dcc46051515a0))
* **web:** 添加私密主页无法排名的提示信息 ([fcf218b](https://github.com/GuJi08233/TokenArena/commit/fcf218b67b28b0fb2fe0d2eabd34b143b72ea6b5))
* **web:** 添加私密用户通知功能到排行榜组件 ([5b292eb](https://github.com/GuJi08233/TokenArena/commit/5b292eb5956401bb294e111b1ddcedb3b2b7555c))
* 添加 systemd 服务管理命令 ([589b34a](https://github.com/GuJi08233/TokenArena/commit/589b34ab30ee780b0be83f72ca0371de7bded013))


### Bug Fixes

* add .env.example template and update gitignore ([1339c6e](https://github.com/GuJi08233/TokenArena/commit/1339c6ec09eda5e7e06df7b290aa8a695811cdba))
* add Windows startup scripts and align Docker DB defaults ([1edb35a](https://github.com/GuJi08233/TokenArena/commit/1edb35a7a8a513a1b9a352728512df68d20a6199))
* **ci:** lowercase IMAGE_NAME for registry cache ref ([b2a302a](https://github.com/GuJi08233/TokenArena/commit/b2a302a471cb51edff86aa38d4f6cf71088b187e))
* **ci:** repair release workflow and deduplicate Docker builds ([3cd6c08](https://github.com/GuJi08233/TokenArena/commit/3cd6c08ad8c9365054495aa94ca7361e8462d942))
* **ci:** switch Docker build cache from GHA to registry type ([7e83b8e](https://github.com/GuJi08233/TokenArena/commit/7e83b8ed448f0e7666db502a83713a9bdfb41c75))
* **ci:** update Claude Code workflow to use OAuth token ([72d15a1](https://github.com/GuJi08233/TokenArena/commit/72d15a197923f0531f9a605fd37762877eaa0d10))
* **ci:** update Docker metadata extraction to use tags instead of branches ([8d59ae0](https://github.com/GuJi08233/TokenArena/commit/8d59ae07d75aa7bea4f6113e3dd7361c9851c01c))
* **cli:** fix systemd service configuration issues ([07a6704](https://github.com/GuJi08233/TokenArena/commit/07a67048a568f3bce3e6fdf736d112209a4bc31c))
* **cli:** fix Windows compatibility in xdg tests and command detection ([39685e5](https://github.com/GuJi08233/TokenArena/commit/39685e5068fa0c66725c6fa3141cd4a56e0e8357))
* **cli:** normalize parser path handling on Windows ([1498bf2](https://github.com/GuJi08233/TokenArena/commit/1498bf2c8cc3d6154e14853c3fa24f65ebad8ed2))
* **cli:** preserve deviceId when re-running init with a new API key ([bdb8a2c](https://github.com/GuJi08233/TokenArena/commit/bdb8a2cba05bcfd01f991b492665f312a63eae61))
* **cli:** reload config on each daemon sync cycle ([de404e8](https://github.com/GuJi08233/TokenArena/commit/de404e834dd9493bb9a76944e6ce5dc169e2a21c))
* **cli:** reload config on each daemon sync cycle ([5e1aef6](https://github.com/GuJi08233/TokenArena/commit/5e1aef66c271acbfdb880c8a30312c5d08c6cb20))
* **cli:** remove useless escape in xdg runtime dir test regex ([33d1eb6](https://github.com/GuJi08233/TokenArena/commit/33d1eb644f7e4b49e9e9b1f60346f20b2ac0ebd0))
* **cli:** skip malformed negative token usage ([00ba469](https://github.com/GuJi08233/TokenArena/commit/00ba469f48e207c16d86748fee83c09cb1f6ef9c))
* **cli:** update CLI API key creation URL to point to settings page ([2c71de7](https://github.com/GuJi08233/TokenArena/commit/2c71de72b828d1577c5d90d26be594dc46eb97cf))
* **cli:** update default API URL to use secure endpoint ([9bfae21](https://github.com/GuJi08233/TokenArena/commit/9bfae21f215b87d63227434e535e5aaf8d96dbba))
* **cli:** use platform-specific shell config paths ([d53980e](https://github.com/GuJi08233/TokenArena/commit/d53980e6f02c02d6866b9aa3a9ba60a6d5c93188))
* **cli:** use platform-specific shell config paths ([e416d93](https://github.com/GuJi08233/TokenArena/commit/e416d937fa63a62a9ad992ff0989ebd6523e209b))
* **cli:** 跳过 OpenCode 异常负 token 记录，避免同步 400 ([724ad0b](https://github.com/GuJi08233/TokenArena/commit/724ad0b403d46aeacbfe1c7942ab9b5b908cc327))
* **config:** update default API URL to localhost for development ([7ddf49f](https://github.com/GuJi08233/TokenArena/commit/7ddf49fdff2454572e0f98434e1c19c9a77ce994))
* **deps:** upgrade vite, postcss, @hono/node-server to fix Dependabot alerts ([096b34e](https://github.com/GuJi08233/TokenArena/commit/096b34ebcd670922e7478eced49a7cbd11907500))
* **Dockerfile:** add public directory copy to Dockerfile for static assets ([a343f64](https://github.com/GuJi08233/TokenArena/commit/a343f642e9592eb67621241cc21a153f528f5467))
* **Dockerfile:** correct filter path for pnpm install command ([2aca33e](https://github.com/GuJi08233/TokenArena/commit/2aca33ebf8b0730a27b36d288bce2beb522a1b76))
* **docker:** improve comments and correct static assets copy path in Dockerfile ([e9b4c6c](https://github.com/GuJi08233/TokenArena/commit/e9b4c6c379377759fde78758ac0869ad5f498769))
* **docker:** update DATABASE_URL to use 'db' hostname and improve start.sh instructions ([b3c94a6](https://github.com/GuJi08233/TokenArena/commit/b3c94a65ab0ba21f1a503bd5c70633fe10e73497))
* **docs:** update README with correct CLI commands and initialization instructions ([924f48f](https://github.com/GuJi08233/TokenArena/commit/924f48fd052ebdd09dae74fbb2ef339e51039a4b))
* resolve TypeScript 6 and react-day-picker 10 compatibility ([fc635f2](https://github.com/GuJi08233/TokenArena/commit/fc635f22c0d0da7b3f8e81eb730a83eb4cd34986))
* **security:** resolve 3 CodeQL alerts (ReDoS, XSS, password hash) ([1b0568b](https://github.com/GuJi08233/TokenArena/commit/1b0568b01b28a49e28bf00e559f9ebc36105e9cb))
* **tests:** update regex for badge cost formatting in social badges tests ([60b7f5c](https://github.com/GuJi08233/TokenArena/commit/60b7f5cf6c235d1b0ebc90fdd01881ed3621e7f1))
* **test:** update CLI test to verify both daemon and service commands are registered ([4e3050a](https://github.com/GuJi08233/TokenArena/commit/4e3050ada7407ae23bb3cac0c5325c3339e6d74b))
* update DATABASE_URL in docker-compose.yml for token_arena service ([61be4b7](https://github.com/GuJi08233/TokenArena/commit/61be4b7af7e634aa2d723cca2db1f9e0e34f2712))
* update datasource URL syntax in Prisma config ([4ce6103](https://github.com/GuJi08233/TokenArena/commit/4ce6103a51e4d65dc851752f033501f5de753f06))
* update GitHub Actions coverage workflow permissions ([2f866e4](https://github.com/GuJi08233/TokenArena/commit/2f866e425029d1dbf30618b377fbef9696787d2c))
* **web:** add LeaderboardPrivateNotice component for public profile management ([64ab3c4](https://github.com/GuJi08233/TokenArena/commit/64ab3c4cabbead0cdfd5187fa1930ac5e195f0d4))
* **web:** add min-h-screen-ios for Safari viewport height ([4e76e2f](https://github.com/GuJi08233/TokenArena/commit/4e76e2ff04905b3cb26ad6f4b1a66b7c330581a7))
* **web:** adjust AccountMenu button and avatar sizes for consistency ([1bf27c5](https://github.com/GuJi08233/TokenArena/commit/1bf27c50ca954903c1a9817877418fc686cb6dbd))
* **web:** align auth validators with spec ([1523488](https://github.com/GuJi08233/TokenArena/commit/152348803a1cd67e5beabf7a798ee82d567540b4))
* **web:** approve build scripts for native dependencies in Docker ([fbac58f](https://github.com/GuJi08233/TokenArena/commit/fbac58f34055fdc860156a18f3758f1822e4f187))
* **web:** avoid usage preference creation race ([6ddc65f](https://github.com/GuJi08233/TokenArena/commit/6ddc65ff71e911661779c49465913d9a5aaada02))
* **web:** center-align table headers in sessions section for improved readability ([98fbfcf](https://github.com/GuJi08233/TokenArena/commit/98fbfcf20cda1841ae3665e00560498dea4e23fc))
* **web:** configure Turbopack root for monorepo support ([858a68c](https://github.com/GuJi08233/TokenArena/commit/858a68c0a0355d66da71ad0fe75c5d1c93b9d1aa))
* **web:** confirm key deletion ([3ca4e7a](https://github.com/GuJi08233/TokenArena/commit/3ca4e7ac42fe6fd763b82e4b98df49685db6d506))
* **web:** correct Dockerfile standalone output paths for monorepo ([5bb2ee0](https://github.com/GuJi08233/TokenArena/commit/5bb2ee044686c8dc448a38e28a7302de072ee1f5))
* **web:** downgrade Node base image from 26-alpine to 22-alpine ([5ff6587](https://github.com/GuJi08233/TokenArena/commit/5ff658754e21a1583eaf9719855109a92b1bfe59))
* **web:** handle empty filter badge slots ([eb008d7](https://github.com/GuJi08233/TokenArena/commit/eb008d761baac806c0aab88ae7f7a36df36a6129))
* **web:** harden server data boundaries ([80e193d](https://github.com/GuJi08233/TokenArena/commit/80e193d83005108541f01ce47057b64ea7126b0e))
* **web:** hide one-time achievement count badges ([27733c6](https://github.com/GuJi08233/TokenArena/commit/27733c6e7d041e2cd65aa236c29dc8a857ac2be2))
* **web:** improve follow button layout to single row with tag selector ([1e64d17](https://github.com/GuJi08233/TokenArena/commit/1e64d17c6a9a27f3f330b625609396c6f98717c0))
* **web:** improve theme and dialog markup ([b6015ca](https://github.com/GuJi08233/TokenArena/commit/b6015caa252bdd1ef78c1b4af34630c2efb3bf4c))
* **web:** include locale and theme in settings change detection ([93521f5](https://github.com/GuJi08233/TokenArena/commit/93521f5b3da5f98db02bd2dfb1b6a93975babafc))
* **web:** keep login redirect locale consistent ([c4cc2b4](https://github.com/GuJi08233/TokenArena/commit/c4cc2b40683c77786161309988eaa2460c682bcf))
* **web:** make session datetime rendering hydration-safe ([6bd73b0](https://github.com/GuJi08233/TokenArena/commit/6bd73b098204b61554f53a26b91b52e42b15c8d5))
* **web:** pin pnpm version and use .npmrc for build script approval in Docker ([ceefb21](https://github.com/GuJi08233/TokenArena/commit/ceefb210ff635e390e044e446b6cdf80bf2d393d))
* **web:** profile heatmap scrollbars and SSR class names ([9e94fae](https://github.com/GuJi08233/TokenArena/commit/9e94fae79574f555352a31c877ae9970ff688f41))
* **web:** remove dead code, fix state patterns, and parallelize async ops ([62526b7](https://github.com/GuJi08233/TokenArena/commit/62526b71517bd68e077613a3b4ff45039552cb29))
* **web:** remove theme switcher icon to prevent text truncation ([304b78b](https://github.com/GuJi08233/TokenArena/commit/304b78b3a4fa07c9fa66c91030a6ea17cac05a43))
* **web:** remove Turbopack root configuration for Next.js setup ([49b2f20](https://github.com/GuJi08233/TokenArena/commit/49b2f201a31cd1fd8c50c9d4407e7608ee101b92))
* **web:** remove unnecessary `new` from Intl constructor calls ([594626f](https://github.com/GuJi08233/TokenArena/commit/594626fa3c13ebca71dab4f20bed7bdf48a2bd95))
* **web:** remove unused themeIcons constant and Monitor import ([66b61d7](https://github.com/GuJi08233/TokenArena/commit/66b61d781a3746fd97af9122fc7e1c697a246168))
* **web:** remove unused viewProfile label from leaderboard table ([3023fe5](https://github.com/GuJi08233/TokenArena/commit/3023fe50fc09bacac26fc824c05326310f95f375))
* **web:** resolve linuxdo profile summary links ([b5148e8](https://github.com/GuJi08233/TokenArena/commit/b5148e827dad7c6350a710310d104f745d95e5d7))
* **web:** resolve login username conflicts with toast notice ([f57138b](https://github.com/GuJi08233/TokenArena/commit/f57138b5d7bf67ff259680ded13cf055a613651b))
* **web:** simplify barcode key in share card preview ([880a3f9](https://github.com/GuJi08233/TokenArena/commit/880a3f92991de74e4d9545fcf858bd07c02485f1))
* **web:** stabilize breakdown chart category axis and bar background ([c38dc77](https://github.com/GuJi08233/TokenArena/commit/c38dc77cca7ffc4ab7cd7da67c17eb526c006913))
* **web:** suppress correctness lint warnings for Three.js R3F and barcode ([0eb9f45](https://github.com/GuJi08233/TokenArena/commit/0eb9f45ae8ec464ec8be0721f597addbed150176))
* **web:** suppress Three.js unknown-property lint warnings in Dither ([ef105a2](https://github.com/GuJi08233/TokenArena/commit/ef105a2d090a1401699f5785d899b6ea6397d4f6))
* **web:** sync internal state in ThemeProvider on prop change ([b502efe](https://github.com/GuJi08233/TokenArena/commit/b502efef00f754efc42b10ed31a2e6ab6a5edd39))
* **web:** update achievement thresholds and descriptions for tokens and cache metrics ([74785a8](https://github.com/GuJi08233/TokenArena/commit/74785a861e9ebed6b16e0bae38ea878b91da10f4))
* **web:** update callback URLs in connected accounts card for authentication flow ([8b79688](https://github.com/GuJi08233/TokenArena/commit/8b7968889db62732a7260f65b36730f2ea127176))
* **web:** update footer text colors for improved accessibility ([1716f66](https://github.com/GuJi08233/TokenArena/commit/1716f6638691f9af4167483245f590cc0ebbfadc))
* **web:** update OAuth login description in Chinese translation ([8566570](https://github.com/GuJi08233/TokenArena/commit/856657005399c85a5d16d9e29b21e63b971468ca))
* **web:** use descriptive key instead of array index in barcode ([4e081b8](https://github.com/GuJi08233/TokenArena/commit/4e081b82d9f442adcad3336eed7b6af63d2985da))
* **web:** use ref instead of state for image error tracking ([28ce7b5](https://github.com/GuJi08233/TokenArena/commit/28ce7b575fa6c9a07a214744afad65eb17040243))
* **web:** wrap useSearchParams components in Suspense boundary ([4639d1f](https://github.com/GuJi08233/TokenArena/commit/4639d1fdc40b9f20216430c6c3e615c2f345ee06))


### Performance Improvements

* **web:** code-split recharts in profile-top-list with dynamic import ([5a82103](https://github.com/GuJi08233/TokenArena/commit/5a821035f3a3004bfb9bd73e59f8876e140ed668))
* **web:** lazy load heavy usage visuals ([0906584](https://github.com/GuJi08233/TokenArena/commit/0906584639fbfe011e79ceac8c9b9117f25f17f0))
* **web:** parallelize async operations in page components ([2b3361e](https://github.com/GuJi08233/TokenArena/commit/2b3361e8e23088f670d336747ab6b2205b7361bc))
* **web:** use Set for O(1) variant dedup in buildModelLookupCandidates ([07202d3](https://github.com/GuJi08233/TokenArena/commit/07202d3db92e9fa45c18eb55db80173ea02ec66b))

## [0.6.2](https://github.com/poco-ai/TokenArena/compare/v0.6.1...v0.6.2) (2026-06-08)


### Bug Fixes

* **web:** downgrade Node base image from 26-alpine to 22-alpine ([5ff6587](https://github.com/poco-ai/TokenArena/commit/5ff658754e21a1583eaf9719855109a92b1bfe59))

## [0.6.1](https://github.com/poco-ai/TokenArena/compare/v0.6.0...v0.6.1) (2026-06-08)


### Bug Fixes

* **ci:** lowercase IMAGE_NAME for registry cache ref ([b2a302a](https://github.com/poco-ai/TokenArena/commit/b2a302a471cb51edff86aa38d4f6cf71088b187e))

## [0.6.0](https://github.com/poco-ai/TokenArena/compare/v0.5.0...v0.6.0) (2026-06-08)


### Features

* **web:** add delete account dialog to account identity card ([78c80e5](https://github.com/poco-ai/TokenArena/commit/78c80e5df170de685179835eb7992eca154fc7b2))
* **web:** enable deleteUser plugin and add delete account i18n strings ([fb738e8](https://github.com/poco-ai/TokenArena/commit/fb738e8e4d5a9e51151f1c5ce38a2500e2583b5d))
* **web:** improve connected accounts card with provider ordering and last-provider guard ([611cf1d](https://github.com/poco-ai/TokenArena/commit/611cf1d9ee79f0bbed0518d0159e64993b577746))


### Bug Fixes

* **ci:** switch Docker build cache from GHA to registry type ([7e83b8e](https://github.com/poco-ai/TokenArena/commit/7e83b8ed448f0e7666db502a83713a9bdfb41c75))

## [0.5.0](https://github.com/poco-ai/TokenArena/compare/v0.4.3...v0.5.0) (2026-05-25)


### Features

* **cli:** support .jsonl format and nested subagent sessions for Gemini CLI ([cf08120](https://github.com/poco-ai/TokenArena/commit/cf081201f9e5ca8cf53a6fd4194890356f27b7be))
* **cli:** support custom Claude config directory via CLAUDE_CONFIG_DIR env var ([eb2b9a6](https://github.com/poco-ai/TokenArena/commit/eb2b9a6000b0f1a2995f98d1065d37ba2bf89d8f))

## [0.4.3](https://github.com/poco-ai/TokenArena/compare/v0.4.2...v0.4.3) (2026-05-16)


### Bug Fixes

* update DATABASE_URL in docker-compose.yml for token_arena service ([61be4b7](https://github.com/poco-ai/TokenArena/commit/61be4b7af7e634aa2d723cca2db1f9e0e34f2712))

## [0.4.2](https://github.com/poco-ai/TokenArena/compare/v0.4.1...v0.4.2) (2026-05-16)


### Bug Fixes

* update GitHub Actions coverage workflow permissions ([2f866e4](https://github.com/poco-ai/TokenArena/commit/2f866e425029d1dbf30618b377fbef9696787d2c))

## [0.4.1](https://github.com/poco-ai/TokenArena/compare/v0.4.0...v0.4.1) (2026-05-16)


### Bug Fixes

* **cli:** reload config on each daemon sync cycle ([de404e8](https://github.com/poco-ai/TokenArena/commit/de404e834dd9493bb9a76944e6ce5dc169e2a21c))
* **cli:** reload config on each daemon sync cycle ([5e1aef6](https://github.com/poco-ai/TokenArena/commit/5e1aef66c271acbfdb880c8a30312c5d08c6cb20))
