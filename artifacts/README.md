# 本地发布产物 / Local release artifacts

`artifacts/` 存放本机 `pnpm pack` 生成的 tarball（当前安装到 DSH profile 的就是这里的
文件）。tarball 不进入公共仓库：`.gitignore` 里的 `*.tgz` 已覆盖本目录，只有本
README 会被提交。

- 命名：`dsh-effort-router-<version>.tgz`，版本号与 `package.json` 一致。
- 重新生成：`pnpm pack`（`prepack` 会先重建 `lib/client.js`），产物落在仓库根目录，
  归入本目录即可。
- 安装到 profile 时把依赖写成 `file:<绝对路径>/artifacts/<name>.tgz`；profile 内的
  `node_modules` 是副本，改本目录不会自动同步。
- 回滚：装回上一个版本号的 tarball，并按 `COLLABORATION.md` §5 恢复 profile 备份。
