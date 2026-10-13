# 成员资料字段与旧档案规整

## 统一字段

所有新导出的成员 Markdown 均使用 `schemaVersion: 2` 和相同的 frontmatter 字段。可选值使用 `null`、`[]` 或 `{}` 表示为空，不省略字段。

| 字段 | 含义 |
| --- | --- |
| `isTeacher` | 是否为指导老师；指导老师不填写年级、组别、职务或顾问届次 |
| `teamPositions` | 队长、副队长、机电创新学会会长，可多选 |
| `groupPosition` | 组长、成员或 `null`，表单显示“组员” |
| `isAdvisor` | 顾问身份，由非指导老师成员的顾问届次自动推导 |
| `group` | 所属组别 |
| `time` | 参加过的赛季，所有成员必填 |
| `advisor` | 顾问届次，仅普通学生可填写；底层字段名保持兼容 |
| `role`、`type`、`positions` | 兼容旧展示和恢复流程的字段，导入时校验其与结构化身份一致 |

其余 `id`、`name`、`image`、`grade`、`affiliation`、`links`、`sortOrder`、`metadata` 对所有成员都存在。正文继续放在 frontmatter 之后。原有职称描述、成员 ID、路径、链接、正文和扩展元数据不会因字段规整而删除。

历史指导老师档案中的 `advisor` 届次会在新版规整时转入 `time`，使其符合所有人都有参加赛季的规则。顾问身份由普通学生的 `advisor` 届次推导，不再单独选择。已有但不在当前年度选项中的历史届次会继续保留并显示在编辑表单；新增届次必须属于当前可选范围。简介、公开链接、稳定 ID 和高级公开字段仍可编辑。

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
