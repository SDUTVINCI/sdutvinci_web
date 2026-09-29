# 成员资料字段与旧档案规整

## 统一字段

所有新导出的成员 Markdown 均使用 `schemaVersion: 2` 和相同的 frontmatter 字段。可选值使用 `null`、`[]` 或 `{}` 表示为空，不省略字段。

| 字段 | 含义 |
| --- | --- |
| `isTeacher` | 是否为指导老师，与指导届次分别保存 |
| `teamPositions` | 队长、副队长、机电创新学会会长，可多选 |
| `groupPosition` | 组长、成员或 `null`，表单显示“组员” |
| `isAdvisor` | 顾问身份 |
| `group` | 所属组别 |
| `time` | 参与赛季 |
| `advisor` | 指导届次；非指导老师也可填写 |
| `role`、`type`、`positions` | 兼容旧展示和恢复流程的字段，导入时校验其与结构化身份一致 |

其余 `id`、`name`、`image`、`grade`、`affiliation`、`links`、`sortOrder`、`metadata` 对所有成员都存在。正文继续放在 frontmatter 之后。原有职称描述、成员 ID、路径、链接、正文和扩展元数据不会因字段规整而删除。

旧版指导老师若没有年级、`advisor` 为空且 `time` 有值，导入和线上规整会把 `time` 解释为指导届次。已保存但不在当前年度选项中的历史届次会继续保留并显示在编辑表单；新增届次必须属于当前可选范围。

## 线上规整

PostgreSQL 的当前成员版本是权威数据。规整会为每份发生变化的档案创建新不可变 Revision 和内容导出任务，不覆写旧 Revision，也不直接编辑独立内容仓库。执行前先备份并检查 dry-run；若有基于当前版本的待审成员提案，执行会整体停止。此前已经指向旧版本的提案会保留，审核时按字段尝试合并；冲突会阻止通过。

```bash
./vinci backup --verify
docker compose --profile tools run --rm --no-deps migrate \
  npm exec -- tsx scripts/normalize-member-frontmatter.ts --dry-run
docker compose --profile tools run --rm --no-deps migrate \
  npm exec -- tsx scripts/normalize-member-frontmatter.ts \
  --apply --confirm=NORMALIZE_MEMBER_FRONTMATTER
./vinci doctor
```

规整脚本可重入：再次 dry-run 应报告 `changes: 0`。内容导出 Worker 随后将这些 Revision 的 Markdown 写入独立内容仓库。
