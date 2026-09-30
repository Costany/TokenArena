# 与 CC Switch 的用量统计对账

本文记录本次本地采集与五类 token 改造的口径。对照材料是 CC Switch
本地源码 `fdbe3a85`，以及 TokenArena 当前实现；核对日期为 2026-09-21。
CC Switch 的实现用于确认日志字段和已知边界，不作为所有统计数字必须相等的标准。

## 先确认比较的是同一份数据

CC Switch 有三条容易混淆的用量路径：

1. **本地会话导入**：读取 CLI 日志或 SQLite 用量表，写入
   `proxy_request_logs`。当前支持 Claude、Codex、Gemini、OpenCode、
   Grok Build、Pi、MiniMax Code。
2. **代理请求计量**：解析经过 CC Switch 代理的响应 usage，记录状态码、
   延迟、首 token 时间、供应商和费用，也写入 `proxy_request_logs`。
3. **供应商查询**：查询余额、订阅额度、Coding Plan 或执行用量脚本，
   返回套餐的总量、已用量、剩余额度和单位。`UsageCache` 是供托盘等使用的
   进程内快照，不是主使用统计的数据源。

CC Switch 主面板汇总第 1、2 类日志及 `usage_daily_rollups`。
TokenArena 从各工具的本地数据采集，上传当前账户的设备用量；本次没有新增
代理请求拦截、供应商账单查询或读取 CC Switch 数据库的功能。
因此 CC Switch 只有代理记录的调用、供应商控制台中的其他应用调用、
已经从本地删除的历史，都不能凭空出现在 TokenArena 的新扫描结果中。

比较时应固定工具、模型、日期区间、时区及设备，优先比较本地会话来源。
TokenArena 默认可以汇总账户下多台设备；CC Switch 展示的是其当前数据库。
把同一日志复制到不同设备并分别上传，也不等同于单设备内的副本去重。

主要实现入口：
[解析器调度](../cli/src/services/parser-service.ts)、
[同步服务](../cli/src/services/sync-service.ts)、
[Web 查询](../web/lib/usage/queries.ts)。
CC Switch 对照入口为 `src-tauri/src/services/usage_stats.rs`、
`session_usage.rs`、`usage_cache.rs` 和 `commands/provider.rs`。

## 五类 token 的统一含义

TokenArena 存储互不重叠的五类计数：

```text
totalTokens = inputTokens + outputTokens + reasoningTokens
            + cachedTokens + cacheCreationTokens

inputTokens         未命中缓存、也不属于缓存写入的普通输入
outputTokens        已能单独识别推理量时，扣除推理后的普通输出
reasoningTokens     来源明确报告、可以独立拆分的推理量
cachedTokens        缓存读取 / 命中
cacheCreationTokens 缓存创建 / 写入
```

没有单独 reasoning 字段的来源，保留其完整输出，reasoning 记为 0；
不能根据文本长度、模型名称或最终总量臆造推理量。
没有缓存创建字段的旧数据默认写入 0，这表示尚未提供该维度，
不表示模型一定没有产生过缓存写入。

本次将缓存写入贯通解析、半小时桶、会话及模型明细、上传指纹、入库、
排行榜和 Web 估价/展示。总量应始终按五类相加；不能把缓存写入再次并入
普通输入，也不能同时累加缓存写入合计和 TTL 拆分。
实现见 [聚合](../cli/src/domain/aggregator.ts)、
[会话提取](../cli/src/domain/session-extractor.ts)、
[上传协议](../web/lib/usage/contracts.ts) 和
[入库](../web/lib/usage/ingest.ts)。

CC Switch 的 Hero `real_total_tokens` 是
`fresh_input + output + cache_creation + cache_read`，其中 output 通常包含推理。
将 TokenArena 的普通输出和推理合并后，才是对应的四类口径。
CC Switch 当前趋势、模型表和供应商表中的 `total_tokens` 仍只计算
`fresh_input + output`，不含两类缓存，不能拿该列直接对比 TokenArena 总量。

CC Switch 的缓存命中率分母是普通输入、缓存创建、缓存读取之和。
TokenArena 分享卡/部分成就中的缓存占比是缓存读取除以全部 token；
两者也不是同一个百分比。

## 已完成的七类本地采集对齐

- **Claude Code**：按请求身份合并流式 usage 快照，完整响应优先，避免重复累加；
  支持子代理和 workflow 嵌套日志、跨文件副本、多个配置根目录。
  input 已经是普通输入，缓存读取和创建独立统计；创建合计缺失时才使用
  `ephemeral_5m_input_tokens + ephemeral_1h_input_tokens` 回退。
  有实际用量的中断/缺少最终结束标记记录仍保留。
  见 [claude-code.ts](../cli/src/parsers/claude-code.ts)。
- **Codex**：扫描活动和归档 rollout；累计快照、last-only 事件、重置及重放
  按各自语义处理，不把相邻相同调用误当成同一次。
  fork/子线程通过父链和截止时间确认继承前缀，不能确认时告警、暂缓对应分支。
  输入拆出缓存读取，输出拆出已包含的 reasoning；不额外制造缓存写入字段。
  见 [codex.ts](../cli/src/parsers/codex.ts)。
- **Gemini CLI**：`tokens.output` / `candidatesTokenCount` 与 thoughts 是独立值，
  修复原先再次从输出中减去 thoughts 导致的少算。输入仍拆出缓存读取；
  JSON、JSONL 和嵌套会话均可读取，稳定 session/message ID 合并副本，
  优先有效时间较新的用量快照，同时间保留更完整的量，空快照不覆盖已有计费量。
  保留纯缓存记录。见 [gemini-cli.ts](../cli/src/parsers/gemini-cli.ts)。
- **Grok Build**：`turn_completed` usage 是本轮独立总量，不是会话累计值。
  输入含缓存读取、输出含 reasoning，分别拆开后总量不变。
  扫描活动与归档会话，按 prompt 身份合并重放，完整快照更新时替换其模型明细。
  没有 prompt ID 的事件按文件内序号隔离，不能仅因同秒或同用量而合并。
  没有复制 CC Switch 的代理沉降窗。
  见 [grok-build.ts](../cli/src/parsers/grok-build.ts)。
- **OpenCode**：原生 input、output、reasoning、cache.read、cache.write 分别计量。
  JSON 与 SQLite 均补齐缓存写入、纯缓存/纯推理记录，以及有用量但模型缺失的
  `unknown` 回退；只把 assistant 的 usage 计入 token。多根存储副本依据原生
  session/message ID 去重，缺少身份时保守保留，不按相同 token 数值去重。
  见 [opencode.ts](../cli/src/parsers/opencode.ts)。
- **Pi**：补齐 `cacheWrite`，除 assistant 外还读取明确携带 usage 的
  toolResult、compaction 和 branch_summary；采用明确报告的 responseModel。
  去重区分事件种类、稳定 ID 与时间；无 ID 旧格式使用语义指纹，避免分叉副本
  重复，也避免只用裸 ID 误丢真实调用。失败/中断不会抹去已报告的用量。
  见 [pi-coding-agent.ts](../cli/src/parsers/pi-coding-agent.ts)。
- **MiniMax Code（MCode）**：新增原生 `local_runtime_token_usage` 采集，
  读取 `~/.minimax/v2/sqlite/runtime-state.sqlite`；支持原生
  `MINIMAX_DATA_DIR`、`MAVIS_DATA_DIR` 目录覆盖。
  普通输入、普通输出、reasoning、缓存读写分别保留，模型只移除供应商前缀，
  保留后续 `vendor/model` 层级。见 [mcode.ts](../cli/src/parsers/mcode.ts)。

**MiMoCode 与 MCode 是不同工具。** MiMoCode 使用 `mimocode.db`，
来源标识仍为 `mimocode`；本次只补上其已经读取但未计入的 `cache.write`，
没有将它重命名为 MiniMax Code，也没有共用数据目录。
见 [mimocode.ts](../cli/src/parsers/mimocode.ts)。

**Copilot CLI 不属于上述 CC Switch 本地覆盖的七类。** 依据
[ccusage 的公开 Copilot 指南](https://ccusage.com/guide/copilot/)及合成回归样例，
本次将 `session.shutdown` 中含缓存读写的 input 拆为互斥类别，并按会话/模型
累计快照求增量，避免 resume 后多次 shutdown 重复累加历史。
见 [copilot-cli.ts](../cli/src/parsers/copilot-cli.ts)。该修复不表示已对所有
Copilot 版本或实际供应商账单完成验证。

其他工具中能够从现有格式明确确认的缓存写入字段，也接入统一字段。
CC Switch 没有相应本地解析器、或缺少可信字段样本的工具，不据此宣称已完成
一对一对账，更不为凑齐数字推测未知计数语义。

## Snow App（底层独立，展示合并为 Snow）

Web 只读统计将 `snow` 与 `snow-app` 汇总为 **Snow**，工具筛选同时匹配两种来源，
旧的 `source=snow-app` 链接仍有效。相同时间、设备、模型和项目的桶按分项相加，
会话保持独立；公开资料工具排行及成就工具种类按同一口径归一。
采集、上传、数据库唯一键与会话 API 的原始 source 不变，不迁移、重放或删除历史。
现有已颁发成就不会因展示归一而在此处撤销。

- 来源标识为 `snow-app`，默认只读 `~/.snowapp/snowapp.db`，不读取或合并
  Snow CLI 的 `~/.snow/usage`。当前支持该数据库的 `usage_records`、
  `chat_messages`、`chat_conversations` schema，不依赖 `workspace_directories` 表。
  不扫描备份副本或自定义归档库；不能据此认为本地记录是全部历史。
- 只以 `usage_records` 作为 token 账本；包括有用量的 `tool_calls`、失败、
  取消及子代理调用，不把会话和消息中的累计 token 再次相加。
  记录主键用于去重，不按相同时间、token 数值或可能为空的 response ID 去重。
- 按 App 的 `input + output` 总量口径拆分缓存：缓存读取上限为 input，
  缓存写入从剩余 input 中拆出，普通输入为 input 减去两类缓存。
  如缓存写入超出剩余 input，则暂停该来源，避免猜测不兼容版本的计数含义。
  没有独立的 reasoning 字段，故 reasoning 为 0，完整输出保留。
- 项目身份来自账本 `usage_records.directory_id`，而非可变的工作目录登记表。
  只支持空字符串（`unknown`）和 `local:<绝对 POSIX/Windows/UNC 路径>`；
  后者取路径末段，再交由现有隐私设置处理。登记改名、移除或删除登记表不会改变
  历史桶与会话的项目身份。例如 `local:F:\ComputerLanguage\code\Pisces\Pisces`
  仍为原来的 `Pisces`。非 local、相对路径及其它未知身份暂不支持，整来源 defer，
  不回退为 `unknown`，避免产生新的历史键。
- 会话时间和消息数只使用真实 user/assistant 元数据，排除工具消息。
  缺少会话/消息不会丢掉账本用量，也不会伪造提示次数或时长。
  **fork 暂不支持**：真实继承前缀的顺序和计数语义尚未证实，不猜测或过滤前缀。
  单条查询以 `UNION ALL` 独立读取有关 usage 的 conversation 元数据，即使没有
  messages 也检查；`forkedFrom` 不是空字符串或 `forkMessageCount !== 0`
  （含字符串、null、负数和小数）均暂停整个 `snow-app` 来源。无 usage 的会话不参与。
- 无时区的 SQLite 时间按本机本地时间解释，显式时区按其原值解析。
  UTC 时刻范围与 Snow CLI 一致：`[2020-01-01T00:00:00Z, 2080-01-01T00:00:00Z)`，
  含经 offset 换算后跨界的检查。拒绝非法日期、DST 跳时不存在的本地时间和
  回拨重复小时内无 offset 的模糊时间。显式 offset 也须通过安全分桶检查：
  原时刻减去 `roundToHalfHour(date)` 必须在 `[0, 30分钟)` 内，否则整来源 defer。
  这会暂停受共享聚合器 DST 回拨问题影响的时刻；本次不改共享聚合器，避免改变
  其它来源历史桶键。正常显式 offset 仍支持；移动其它时区数据库前须先确认时间口径。
- 单条 SELECT 在一致快照内读取必要字段，包括 WAL 中已提交数据；
  不读取消息正文、提示词、密钥或请求 JSON。Node 先在 `:memory:` 探测是否识别
  `readOnly` 选项，确认支持才以 `{ readOnly: true }` 打开用户库。
  缺少内建 SQLite 或旧 Node 忽略该选项时回退 `sqlite3 -readonly`（可沿用
  `TOKEN_ARENA_SQLITE3`），绝不先用用户库探测或可写打开。
  不使用可能漏掉 WAL 的 immutable 回退；打开和查询失败不会降级为可写连接。
- 数据库锁定、损坏、schema 不兼容、非法身份/fork/计数/时间均暂停整个来源，
  `runAllParsers` 将其列入 `failedSources`，不上传部分结果覆盖完整历史。
  桶和会话的汇总 `totalTokens` 必须是安全整数，会话时长和活跃秒数不得超出
  int32 上限。暂不启用仅依赖主数据库 mtime 的解析缓存。
- 本次安全修复不重传、不迁移、不删除已上传历史，也不提升上传协议或清空设备历史。
  相同 scope、相同桶/会话字段的重复 manifest diff 为 0；测试仅使用合成 SQLite
  和内存 manifest，不作为真实用户数据已重传的声明。实际上传前仍须检查账户、
  设备、隐私及协议 scope 一致；不得通过重建修正计数。

## 仍然存在的产品边界

- **请求数、消息数和会话数**：CC Switch 的请求数实质上是有效日志行数。
  代理按请求记账，会话导入可能按消息、轮次或模型生成行，混合后并非严格的
  HTTP 请求计数。TokenArena 从用户/助手时间事件提取消息和会话；一个用户
  提示可能触发多个模型调用、工具和摘要请求，这些数字不保证一一对应。
- **成功率和延迟**：CC Switch 代理有状态码、首 token 时间和请求耗时。
  本地导入的部分记录统一记为 200、延迟为 0；因此其混合成功率也不等于
  供应商的真实成功率。TokenArena 本次未新增这些代理指标；会话跨度和估算
  活跃时长不能充当网络请求延迟。明确报告的失败/中断 token 仍计入用量。
- **供应商维度**：CC Switch 的 provider 可以代表具体中转配置及其倍率。
  TokenArena 主要维度是设备、工具、模型、项目；模型所属官方定价提供商
  不能替代实际转发该请求的供应商或 API Key 账单。
- **费用**：TokenArena 仪表盘按匹配到的 models.dev 官方价格动态估算，
  价格目录缓存约 12 小时；普通输出与推理分别计价，缺少推理专价时使用输出价，
  缓存写入缺少专价时使用输入价。会话列表费用目前是入库时保存的估价快照，
  不保证随目录变动与仪表盘同步重估。
  CC Switch 代理使用其定价表、请求/响应计价模型与供应商倍率；部分本地工具
  优先使用日志自报成本。其已有正成本通常不会随定价变化重算。
  本次没有复制该供应商计费体系，金额不能作为 token 对齐的唯一依据。
  见 [估价](../web/lib/pricing/resolve.ts) 和
  [价格目录](../web/lib/pricing/catalog.ts)。
- **缺价与缓存 TTL**：未知模型、目录未收录价格、不同中转优惠、5 分钟与
  1 小时缓存创建价格差异，都可能影响费用。TokenArena 目前只有缓存写入总量，
  没有按 TTL 保存完整账单维度；即使 token 相同，也不应宣称金额等于实际账单。

## 时间、归档与刷新

TokenArena 的 `1d` 是账户设置时区的**今日零点至当前时刻**，不是最近 24 小时。
CC Switch 分别提供 `today` 和 `1d`，其中 `1d` 才是滚动 24 小时。
双方 7/30 天通常包含今天在内的日历日；对账最好指定相同起止时间，
并把 TokenArena 账户时区设置成 CC Switch 机器使用的本地时区。
见 [日期范围](../web/lib/usage/date-range.ts)，CC Switch 对照为
`src/lib/usageRange.ts`。

TokenArena 上传半小时 token 桶，Web 按桶时间选取和展示；会话按开始时间筛选。
任意分钟切分的区间、跨日长会话和整点边界，不一定与 CC Switch 的逐请求时间
筛选完全相同。统计查询已改为逐页读取，避免旧的固定行数上限截断汇总；
最近会话列表仍可限制显示条数，不能把可见列表长度当成全部会话数。

无效时间不应统一改成“现在”来追平另一端：Claude/Codex 的无效事件时间会被
跳过或使相关 fork 校验暂缓；Gemini 可使用有效的消息/记录时间，否则跳过；
Grok 使用有效事件时间；Pi 支持秒、毫秒及 ISO 时间，并可回退到 session header
或文件修改时间；MCode 使用原生毫秒时间。CC Switch 的部分导入器会将缺失时间
补为当前时间，这会把旧用量挪到今天。MiMoCode 等未完全重做的既有解析器仍可能
保留各自回退策略，不能宣称所有来源已具有同一种无效时间行为。

CC Switch 通常启动扫描一次、随后每 60 秒扫描（可关闭）；主统计也会在写入事件
后刷新。TokenArena 需要完成本地扫描和上传，daemon 默认约每 30 分钟同步一次，
实际周期可由配置或命令参数覆盖。
刷新间隔、正在写入的尾行、上传未完成，都可能造成短时差异。

CC Switch 将约 30 天前的明细按本地日汇总后删除，历史日汇总仅在查询完整覆盖
该日时纳入，不能还原任意分钟范围。TokenArena 保留已上传桶；本地归档目录中的
日志仍可扫描，但已经删除且从未上传的日志不能恢复。

## 不照搬的 CC Switch 行为

CC Switch 为混合代理和会话数据使用额外跨源去重：同应用、模型、token 指纹和
正负 10 分钟窗口匹配，部分字段可视作未知；它不等价于确定的请求 ID 配对。
Grok 更以附近任意代理活动为守卫，并等待约 10 分钟沉降，源码明确承认并行
官方会话可能被漏记。TokenArena 没有这条代理来源，不引入这些时间窗或延迟。

同样不复制其 Hero 与模型/供应商表 token 合计不一致、缺失时间补“现在”等
行为。对账应定位原始字段和事件身份，而不是删减已确认的真实用量以获得相同截图。

## 升级与历史修复

1. **先部署 Web 和数据库迁移**，添加缓存创建字段并更新服务端协议、查询与展示。
   自托管按既有流程运行 `pnpm migrate`；Docker Compose 会先执行 migrate 服务，
   Web runner 启动时还会再次执行 `prisma migrate deploy`，迁移失败则不会启动应用。
   新数据库列默认 0，只能保留旧记录，不能自动找回漏采量。
2. **再升级 CLI，但先审查同步范围，不要立即同步**。确认解析目录、工具启用范围、
   账户、设备以及上传清单的项目隐私身份和快照协议 scope 均符合预期。
   普通同步并非无条件安全：项目隐私身份或快照协议 scope 变化仍可能触发设备
   快照删除与替换。范围变化或无法确认时应停止，先审查代码路径及历史保留方案。
   本次解析修复和缓存创建字段增加本身没有提升快照协议版本；切换服务器、账户
   或设备也不能理解为自动删除旧端数据。
3. **不要通过清空并重建远端快照修复重复或过期记录**。本地日志可能已被工具清理，
   扫描成功不代表历史完整；替换整个快照会永久丢失仅存于云端的数据。
   应先修复解析器、核对记录身份与分桶键，并增加回归测试；涉及旧键时保留历史，
   单独设计和审查非破坏性修复方案，不自动删除、改名或重传历史记录。
4. 仅在确认上传范围不变、没有删除或快照替换路径后，才执行经过审查的增量上传。
   解析失败或不完整来源应整体跳过，不能以部分结果覆盖完整计数。
   上传中断后先核对服务端回执与本地清单，不盲目重试，更不要以清空远端作为恢复手段。

仅升级代码和迁移不能自动修正所有旧云端记录：同键数据可以被重新计算覆盖，
身份或分桶变化留下的旧键需要有意识地处理。相同上传范围内普通同步保留历史，
是为了避免静默丢失用户仅存于云端的数据；既有隐私身份/协议迁移规则仍适用。

## 验证范围与复现方式

本次为各解析器补充了合成 JSON/JSONL、原生字段样例和合成 SQLite 回归用例，
覆盖推理拆分、缓存读写、纯缓存记录、归档、分叉/快照去重、失败/中断及字段缺失。
Web 用例覆盖缓存创建入库、估价和分页等链路。

本机未安装的工具只通过上述 fixtures 验证，没有声称在这些工具的真实运行环境
或供应商账单中完成对账。没有把用户真实日志、密钥或生产 API 调用作为验证材料。
对应工具未来改变 schema、丢失 usage 或使用未观察到的扩展字段时，需要新的
脱敏样例或明确协议证据；不能用现有测试通过推导所有版本都兼容。

实际对账建议保存同一时段的完整本地日志副本，固定设备/来源/时区，逐步核对
事件身份、五类 token、半小时桶及上传结果，最后再比较费用。完整质量门禁仍按
仓库要求执行 `pnpm check`、`pnpm build` 和相关工作区测试；本文不替代执行结果。
