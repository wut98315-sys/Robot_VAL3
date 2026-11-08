# 代码评审：主循环与任务框架

- 评审对象：`Controller1/usr/usrapp`（TX2-90L valGI 应用，1184 个文件）
- 评审范围：`appLauncher` 主循环、任务框架、PLC 握手、HMI 命令链路；其它模块只记录牵连问题
- 基线：`main` @ `deabb49`
- 修复分支：`review/task-framework`（改动 6 个文件，见 §7；具体提交见 `git log`）
- 日期：2026-11-08

> 说明：本机只装了 SRS 2019 / 2022，无法编译 `s8.21 Cs9` 工程。本文所有改动都**必须**先在
> SRS 2025 中编译通过、再空跑验证，才允许下发控制器。文中标「已修」的条目已在修复分支里改好，
> 标「待定」的条目需要你确认业务语义后再动。

---

## 0. 结论速览

一句话：`appLauncher` 5.0 是从 `valGI`（OMAC 状态机）改写出来的半成品——**启动/停止/暂停是新的，
状态回显、结束/复位/回原、错误上报还挂在旧状态机上**，于是出现"能跑，但状态显示全错、几个按钮是死的、
错误不上报 PLC"这种组合。

| 编号 | 问题 | 位置 | 严重度 | 状态 |
| --- | --- | --- | --- | --- |
| P0-1 | 退出时 `kill()` 先杀掉自己，后面的断电/停止指令不执行；且漏杀 `cycle`、`supervisorTask` | `appLauncher/kill.pgx` | 安全 | 已修 |
| P0-2 | `bIsError` 每轮被 `_systemStates` 覆盖，IO 通讯故障与"未找到喷涂号"错误不上报 PLC | `appLauncher/_systemStates.pgx:21` | 高 | 待定 |
| P0-3 | 停止后 `bIsPause` 不清零，PLC 报警恢复沿会把"已停止"当成"暂停中"自动重启 | `_tCycleCtrl.pgx`、`plc/receive.pgx:54` | 安全 | 已修 |
| P0-4 | 看门狗"异常 5s 后恢复"的计时器在 else 分支被重置，条件永远不成立 | `appLauncher/_supervisorTasks.pgx:14` | 中 | 已修 |
| P0-5 | `plc:cycle_start/stop` 用无超时 `wait`，启动未被接受时 plc 任务永久阻塞、心跳中断 | `plc/cycle_start.pgx:6` | 高 | 已修 |
| P1-1 | HMI 生产状态永远显示"已停止"（`_nOmacStat` 在 5.0 里没人写），主界面按钮永不锁定 | `HMI_cs9/HMI_cycle/currentState.pgx` | 中 | 待定 |
| P1-2 | "生产结束""路径回原"按钮写的是 `nCycleCmd`，5.0 里无人消费；"复位"按钮整段被注释 | `HMI_cs9/HMI_cycle/click_*.pgx` | 中 | 待定 |
| P1-3 | `Main` 与 `supervisorTask` 各自重载 HMI、各自看门狗，同一件事做两遍 | `appLauncher/Main.pgx:47-74` | 中 | 待定 |
| P1-4 | `_productCycle` 是 `while true`，`endWhile` 之后的"生产结束/getForce 清理"永不可达 | `appLauncher/_productCycle.pgx:34,48-53` | 中 | 待定 |
| P1-5 | `rs:init()` 在 5.0 流程里从未调用，`Init.pgx` 是死代码，上一轮的报警/错误标志可能残留 | `appLauncher/Main.pgx:13-24` | 中 | 待定 |
| P1-6 | 生产任务"异常"被当成"暂停"处理，异常任务仍计入 `bIsCycle`，HMI 显示"运行中" | `appLauncher/_tCycleCtrl.pgx:44` | 中 | 待定 |
| P2-1 | 上电位置日志误用 `pHere1` | `appLauncher/_TolleranceCheck.pgx:19` | 低 | 已修 |
| P2-2 | 6 个 `.pgx` 未编入任何工程；`send1.pgx` 与 `send.pgx` 同名 | 见 §5 | 低 | 待定 |
| P2-3 | `appLauncher` 与 `valGI` 有 10 个文件逐字节相同 | 见 §1 | 低 | 待定 |

---

## 1. 两代入口并存

| 项目 | `valGI` | `appLauncher` |
| --- | --- | --- |
| VAL3 版本 | `s8.15.3Cs9_BS3337` | `s8.21Cs9_BS4703` |
| 状态模型 | OMAC：`rs:_nOmacStat` 1/2/3/…/12 | 三个布尔：`bToStartCycle` / `bToPause` / `bToStopCycle` |
| 命令通道 | `rs:nPLCcmd` 1..7、`rs:nCycleCmd` 1..7 | 上述三个标志 |
| 周期任务 | `taskCreate "productCycle"` + `cycle_Start/Stop/Hold/Unhold/End/Reset/Abort/GoHome/RotGoHome` | 单个 `taskCreate "cycle"`，逻辑内联在 `_productCycle` |
| 入口任务 | `Main` 直接 `do…until` | `start.pgx` → `taskCreate "appMain",100,Main()` |

**现场跑的是 `appLauncher`**：HMI 的启动按钮写 `rs:bToStartCycle=true`（`HMI_cs9/HMI_cycle/click_Start.pgx:11`），
只有 5.0 的 `_tCycleCtrl` 消费这个标志。`valGI` 是上一代，整套 `cycle_*` 任务（9 个程序）仍在仓库里。

问题在于 5.0 只换了一半：

- `HMI_cs9/home/main.pgx:24-46` 仍用 `rs:_nOmacStat` 判断"是否在生产中"来决定主界面按钮锁定；
- `HMI_cs9/HMI_cycle/currentState.pgx` 整页状态文字来自 `_nOmacStat`；
- `HMI_cs9/HMI_cycle/click_End.pgx:11`、`click_RotHome.pgx:15` 仍写 `nCycleCmd`；
- `plc/send1.pgx`（未编入工程）整段基于 `_nOmacStat` 驱动 PLC 状态位。

**结论**：5.0 里 `_nOmacStat` 只在 `rs:init()` 里被置成 9，之后再没人写（全仓库 grep 确认），
所以这些界面/接口永远落在"已停止"分支。见 P1-1。

另外 `appLauncher` 与 `valGI` 有 10 个文件逐字节相同：
`_getForce.pgx`、`.outlining.json`、`initLib.dtx`、`initlib.pgx`、`start.pgx`、`stop.pgx`、
`cycleCtrl.bindings.json`、`cycleCtrl.html`、`StartUp.bindings.json`、`StartUp.html`。
两份 `initLib` 各自绑定同一批 `data/CustomerLib/...`，改一处忘一处就会分叉。

---

## 2. 任务与职责矩阵

| 任务名 | 创建点 | 优先级 | 职责 | 谁监控 | 谁清理 |
| --- | --- | --- | --- | --- | --- |
| `appMain` | `start.pgx:5` → `Main()` | 100 | `_systemStates()` + `_tCycleCtrl()`；**另有一套**plc/lifebit 看门狗与 HMI 重载 | `supervisorTask` | 自己返回 |
| `plc` | `Main.pgx:29` → `plc:main()` | 60 | `lifebit`→`receive`→`send`，PLC 握手与 I/O | `Main` **和** `supervisorTask` | `kill()` |
| `HMI` | `Main.pgx:32` → `home:main()` | 50 | 触摸屏页面循环 | `Main` **和** `supervisorTask` | `kill()` |
| `supervisorTask` | `Main.pgx:35` → `_supervisorTasks()` | 10 | 看门狗 + HMI 重载 | 无人监控 | **`kill()` 漏杀** |
| `cycle` | `_tCycleCtrl.pgx:22` → `_productCycle()` | 100 | 取喷涂号 → 找轨迹 → 执行 → 等下一次 | `_tCycleCtrl`（当作"暂停"） | `_tCycleCtrl` 停止分支 |

三个结构性问题一眼可见：

1. `plc`/`HMI` 都被两个任务同时监控，且都调用阻塞式 `userPageConfirm` → 两个模态框可能叠加；
2. `kill()` 只杀了 `plc`/`HMI`，`cycle` 和 `supervisorTask` 活到应用退出之后；
3. `kill()` 里先 `taskKill("appMain")` —— 而 `kill()` 正是由 `appMain` 调用的。

---

## 3. P0 问题（影响安全或故障可见性）

### P0-1 退出流程先杀自己、漏杀生产任务（已修）

`appLauncher/kill.pgx`（基线 `deabb49`）：

```val3
taskKill("safeCheck")
...
taskKill("appMain")     // ← 第 14 行：kill() 自己就跑在 appMain 里
taskKill("HMI")

rs:bQuitApp=false       // ← 第 18 行起：能不能执行取决于"杀自己"是否立即生效
stopMove()
resetMotion()
disablePower()
```

若 `taskKill` 对自身立即生效，则 `stopMove/resetMotion/disablePower` 全部不执行，
机器人保持上电；同时 `cycle`（优先级 100、可能正在 `waitEndMove()`）与 `supervisorTask` 未被清理，
应用退出后仍可能继续动。若 `taskKill` 对自身无效，则 `appMain` 一直挂在任务表里。
两种语义都不对。

修复（`review/task-framework`）：先停运动 → 再清任务 → 最后复位标志，并补上
`supervisorTask`/`cycle`/`productCycle`/`getForce`/`Hold`… 等运行时任务名，去掉 `taskKill("appMain")`。

### P0-2 `bIsError` 每轮被覆盖（待定）

```val3
// appLauncher/_systemStates.pgx:21
rs:bIsError=(taskStatus("cycle")>1)
```

`plc/send.pgx:26-28` 在 I/O 通讯异常时 `rs:bIsError=true`；`_productCycle.pgx:30` 在"未找到喷涂号"
时也置位。但 `appMain` 每轮先跑 `_systemStates()`，下一轮就把标志改成"cycle 任务是否异常"，
于是这两类错误最多存活一个循环（毫秒级），`dOutError` 实际恒为 false，PLC 看不到故障。

建议改成"只置位不清零，清零交给明确路径"：

```val3
  //程序报错：置位锁存
  if taskStatus("cycle")>1
    rs:bIsError=true
  endIf
  //清除：PLC 复位沿（receive.pgx:61-63 已处理）或页面确认且生产任务已停止
  if rs:bAlarmAck and taskStatus("cycle")<0
    rs:bIsError=false
  endIf
```

需要你确认的是**清除语义**：现场是希望错误一直挂到 PLC 复位，还是允许操作员在页面上确认后清掉？

### P0-3 停止后 `bIsPause` 残留导致自动重启（已修）

`plc/receive.pgx:54-59`：

```val3
elseIf dInPLCError==false and rs:bIsPause
  ...
  call cycle_start()
endIf
```

`bIsPause` 只在 `_tCycleCtrl` 的恢复分支里清零。若"暂停 → 停止/急停"，标志仍是 true，
PLC 报警一恢复就会自动 `cycle_start()`——机器人自行重新生产。

修复：`_tCycleCtrl` 停止分支清零 `bIsPause`，并把"暂停"处理提到"停止"之前，
保证同一轮里同时请求暂停与停止时，停止优先、清标志在后。

### P0-4 看门狗防抖失效（已修）

```val3
// 基线 _supervisorTasks.pgx:14-20
if taskStatus("plc")>1 and (clock()-_nClock[1]>5)
  _nClock[1]=clock()
  taskResume("plc",0)
  rs:bIsError=true
else
  _nClock[1]=clock()      // ← 任务异常但未满 5s 时也会走到这里，计时器被重置
endIf
```

任务一旦异常，每轮都因 `>5` 不成立而进 else，把计时器刷成"现在"，
`clock()-_nClock[1]` 永远小于 5 → **恢复分支永不执行**。`appMain` 那段（`:21-27`）同样。

修复：只在任务正常时刷新计时器（`else` 只挂在"任务正常"上）。`Main.pgx:47-52,69-74` 的同款写法
也一并按 P1-3 收敛。

### P0-5 plc 任务无超时 `wait`（已修）

```val3
// plc/cycle_start.pgx:5-7
rs:bToStartCycle=true
wait(rs:bIsCycle==true)     // 启动没被接受（不在原点、非远程、电池…）就永久阻塞
rs:bToStartCycle=false
```

`cycle_start()` 由 `receive()` 调用，`receive()` 由 `plc:main()` 循环调用 → 整个 plc 任务卡住，
`lifebit` 心跳停止，上位 PLC 判通讯故障，且 `bToStartCycle` 一直为 true。`cycle_stop.pgx:5-8` 同理。

修复：`wait()` 改 `watch(…,5)`，超时只记日志并清零标志：

```val3
  rs:bToStartCycle=true
  l_bResult=watch(rs:bIsCycle==true,5)
  rs:bToStartCycle=false
  if l_bResult
    logMsg("PLC:startcycle")
  else
    logMsg("PLC:startcycle timeout")   // 现场日志里能直接看到"启动未被接受"
  endIf
```

---

## 4. P1 问题（功能缺失与竞态）

### P1-1 状态回显永远"已停止"（待定）

`_nOmacStat` 在 5.0 里没有写入点，`currentState.pgx` 的 `switch` 永远命中 `case 9`；
`home/main.pgx:26` 的 `rs:_nOmacStat<9` 永远为假，主界面按钮永远不会因为"正在生产"而锁定。

最小改动是在 `_systemStates()` 里按现有标志派生一遍（不改 HMI）：

```val3
  if rs:bIsEstop
    rs:_nOmacStat=9
  elseIf rs:bIsCycle and rs:bIsPause
    rs:_nOmacStat=6        //已暂停
  elseIf rs:bIsCycle
    rs:_nOmacStat=3        //运行中
  else
    rs:_nOmacStat=9        //已停止
  endIf
```

更好的做法是见 §6：让状态机重新成为唯一事实来源，5.0 的三个布尔只是它的输入。

### P1-2 三个按钮是死的（待定）

| 按钮 | 文件 | 现在做的 | 5.0 里的结果 |
| --- | --- | --- | --- |
| 生产结束 | `click_End.pgx:11` | `rs:nCycleCmd=5` | 无人消费，什么都不发生 |
| 路径回原 | `click_RotHome.pgx:15` | `rs:nCycleCmd=7` | 无人消费，什么都不发生 |
| 复位 | `click_Reset.pgx` | 整段被注释 | 空函数 |

`click_Reset` 空实现意味着"复位"按钮实际由 `_clickAlarmAck`（清报错）承担，易误解。
"生产结束"应改为 `rs:bToStopCycle=true`（或实现"走完当前轨迹再停"）；"路径回原"应调用
`ar:returnMove(...)`（`autoReturn` 库就在工程里）。

### P1-3 双份 HMI 重载与双份看门狗（待定）

`Main.pgx:47-74` 与 `_supervisorTasks.pgx:14-43` 做的是同一件事：plc 看门狗、lifebit 看门狗、
HMI 异常 → 保存 → `userPageConfirm` → 重建 HMI。两个任务并行跑，`_nClock[1]` 被两边同时当计时器写
（互相踩踏），`userPageConfirm` 可能同时弹出两个模态框，`bTosave` 也可能被两边同时置位。

建议：`Main` 只保留 `_systemStates()` + `_tCycleCtrl()`；看门狗与 HMI 重载只留在 `supervisorTask`。
改动量约 30 行，收益是消除"同一件事两个执行者"。

### P1-4 `_productCycle` 结构（待定）

```val3
while true
  wait(plc:dInExcutePainting==true)
  ...
  delay(0)
endWhile

rs:_sRobotStatus="当前件生产结束"      // ← 永远执行不到
if taskStatus("getForce")!=-1          // ← 永远执行不到
```

`while true` 没有 `break`，退出只能靠 `_tCycleCtrl` 的 `taskKill`。结尾段的
"当前件生产结束"文案与 `getForce` 清理是死代码；而 `getForce` 任务在 5.0 里根本没被创建过
（`_getForce.pgx` 编入了工程，但全仓库没有 `taskCreate "getForce"`）。

建议改成 `do … until rs:bToStopCycle`，并把清理逻辑移到退出路径；顺带决定 `_getForce` 是否还需要。

### P1-5 `rs:init()` 从未执行（待定）

`Init.pgx` 编在工程里，但 5.0 的 `Main` 只注释了 `call cycle_Init()`，没有任何地方 `call Init()`：
`rs:init()`（清报警表、清 `bIsError`/`bIsPause`、`_nOmacStat=9`）整段不生效，
`_bIsScara`/`_bEndCycle`/`_bAtHome` 也停留在 `.dtx` 的值。

后果：控制器重启后，`robotStatus.dtx` 里上一轮残留的 `bIsError`、`sAlarmMes`、`nProgCode` 等会直接带进新会话。

建议在 `Main.pgx` 的 `resetMotion()` 之后加一行 `call Init()`，并确认它是否会覆盖你希望跨次保留的字段
（`nProgCode`、`saveData:nLibIndex` 不在 `rs:init()` 的清理范围内）。

### P1-6 异常被当作暂停（待定）

`_tCycleCtrl.pgx:44` 的 `or taskStatus("cycle")>1` 让生产任务的异常走"暂停"分支：`stopMove()` +
`bIsPause=true`。但任务仍处于 error 态，`rs:bIsCycle`（`taskStatus>-1`）仍为真 → HMI 显示"运行中"，
PLC 的 `dOutCycle` 也是 true，而机器人已经停了。现场看到的是"绿灯、不动"。

建议拆成两个分支：异常 → `bIsError=true` + 保持 `cycle` 任务待处理（等停止或复位）；
暂停 → 只由 `bToPause` 触发。

---

## 5. P2 与一致性问题

| 项 | 证据 | 说明 |
| --- | --- | --- |
| 未编入任何工程的 `.pgx`（6 个） | `HMI_cs9/HMI_setting/applyLib.pgx`、`HMI_cs9/HMI_TRAJ/simulate.pgx`、`source/projectSource/io/UPInOutStatus.pgx`、`source/projectSource/plc/send1.pgx`、`source/projectSource/robotStatus/_clickIoPage.pgx`、`source/projectSource/robotStatus/_clickProductionPage.pgx` | 是死文件还是漏编？建议删除或补进 `.pjx` |
| 同名程序 | `plc/send1.pgx` 里声明的是 `<Program name="send">` | 一旦有人把它加进 `plc.pjx`，与 `send.pgx` 重名，编译直接报错 |
| 冗余 `wait` | `onSave.pgx` 里 `bIsSaving` 是同步置位/清零的，调用返回时已为 false | `Main.pgx:59`、`_supervisorTasks.pgx:34` 的 `wait(rs:bIsSaving==false)` 恒真，删掉或改成真正的异步标志 |
| 同名全局量 | `plc.dtx` 的 `_nClock`（size 1）与 `appLauncher.dtx` 的 `_nClock`（size 10） | 靠作用域规则区分（各自模块内解析），可读性差；建议改名 `_nLifebitClock` / `_nTaskClock[]` |
| 未使用的局部量 | `Main.pgx:5-7`（`l_bStartClock`、`l_nClock`、`l_bResult`）、`_tCycleCtrl.pgx` 里 8 个 `l_b*AckAlarm` 类 | 无害，但说明这些文件是从旧版剪切来的 |
| `taskResume(name,0/1)` | `Main.pgx:48`、`_supervisorTasks.pgx:16,24` | `plc` 创建时优先级 60，恢复时传 0/1 会把它降到最低；需确认 VAL3 里第二参数是否"保持原优先级" |
| 版本跨度 | `SmartTCP_CS9` s8.8.3/s8.10.5，`data/` s8.10.3，`appLauncher/plc/robotStatus` s8.21 | 混版编译是"打开就报错"的常见来源，建议统一基线 |

---

## 6. 建议的目标架构

保持五个任务，但**每个状态只有一个写入者**：

```
                 ┌──────────── supervisorTask (10) ────────────┐
                 │ 看门狗：plc / appMain 异常 → 5s → resume     │
                 │ HMI 异常 → 保存 → 确认 → 重建 HMI            │
                 └───────────────┬─────────────────────────────┘
                                 │ 只读 taskStatus
  appMain (100)  ── _systemStates() → 唯一的 rs:* 状态写入者
                 └── _tCycleCtrl()  → cycle 任务生命周期（唯一的 taskCreate/Kill 入口）
  plc (60)       ── receive()：PLC 命令 → 标志；send()：状态 → PLC
  cycle (100)    ── 只负责"取号 → 执行轨迹"，不写状态
  HMI (50)       ── 只读 rs:*，只写 bTo* 命令与页面请求
```

配套规则：

1. `rs:bIsError` / `rs:bIsPause` / `rs:_nOmacStat` 只由 `_systemStates()` 写；
2. `cycle` 任务的创建与销毁只由 `_tCycleCtrl()` 做；
3. 所有跨任务等待都用 `watch(cond, timeout)`，超时必须写日志；
4. 退出路径固定为：停运动 → 清任务 → 复位标志 → 返回。

迁移步骤（建议按此顺序，每步单独编译 + 空跑）：

1. **合并重复**：删掉 `Main` 里的看门狗与 HMI 重载（P1-3），确认 `supervisorTask` 独自承担；
2. **状态收敛**：`_systemStates` 成为唯一状态写入者，派生 `_nOmacStat`（P1-1），错误锁存（P0-2）；
3. **命令补全**：`click_End`/`click_RotHome`/`click_Reset` 接回真实动作（P1-2），
   `_productCycle` 改成可正常退出（P1-4）；
4. **清理历史**：删除 `valGI`（或整体移到 `legacy/` 目录并移出 `.pjx`）、6 个孤儿文件、`send1.pgx`；
5. **统一版本**：所有子工程重新以同一 SRS 版本保存并编译。

---

## 7. 已落地改动

分支 `review/task-framework`，6 个文件：

| 文件 | 改动 |
| --- | --- |
| `appLauncher/kill.pgx` | 先 `stopMove/resetMotion/disablePower`，再清任务；补 `supervisorTask`/`cycle`/`getForce` 等；去掉 `taskKill("appMain")`；复位 `bIsPause`/`bIsCycle`/`bIsError` |
| `appLauncher/_supervisorTasks.pgx` | 看门狗防抖：`else` 只挂在"任务正常"分支 |
| `appLauncher/_tCycleCtrl.pgx` | 两处 `wait` 改 `watch(…,2)`；停止时清 `bIsPause`；暂停处理提到停止之前 |
| `source/projectSource/plc/cycle_start.pgx` | 无超时 `wait` → `watch(…,5)`，超时记日志 |
| `source/projectSource/plc/cycle_stop.pgx` | 同上 |
| `appLauncher/_TolleranceCheck.pgx` | 上电位置日志 `pHere1` → `pHere2` |

回退与合并：

```powershell
git switch main               # 原始基线
git diff main review/task-framework    # 看全部改动
git switch review/task-framework       # 切到修复版本（SRS 里打开工程编译）
git merge --ff-only review/task-framework   # 验证通过后并入 main
```

本次改动都保持了原有接口和标志语义，只动了"等待方式、清理顺序、计时器刷新条件"这类局部逻辑；
但由于无法在本机编译，**仍需 SRS 编译 + 现场空跑确认**。

---

## 8. 验证清单（建议按此顺序）

1. **编译**：SRS 打开 `appLauncher.pjx` 与 `plc.pjx`，全量编译，确认无 error（warning 也看一下）；
2. **静态**：确认 `kill`、`_tCycleCtrl`、`_supervisorTasks` 三个程序的 Locals 与引用变量都在 `.dtx` 里；
3. **空跑（不上电）**：启动应用 → 退出应用，观察 `plc`/`HMI`/`cycle`/`supervisorTask` 是否都被清理，
   控制器任务表为空；
4. **上电**：手动模式上电 → 回原点 → 切远程自动 → 页面启动 → 暂停 → 恢复 → 停止，
   确认每一步 HMI 状态文字与 PLC 输出位一致；
5. **异常注入**：生产中断开 PROFINET 通讯 → 确认 `dOutError` 置位并保持；恢复后按复位清除；
6. **急停**：生产运行时拍急停 → 确认 `cycle` 被 kill、机器人下电、应用不退出；
7. **暂停后停止**：暂停 → 停止 → 让 PLC 报警恢复，确认**不会**自动重启（P0-3 回归点）；
8. **长时间**：连续运行 2 小时，观察 `logMsg` 有无 `timeout` 记录、内存/CPU 是否稳定。

---

## 9. 待你确认的问题

1. `taskKill` 对调用者自身是否立即生效？（决定 P0-1 的修复方式，现按"会生效"处理）
2. `taskResume(name, priority)` 的第二参数语义：传 0 是"保持原优先级"还是"设为 0"？
3. `bIsError` 期望的清除路径：只能 PLC 复位，还是页面确认也可以？
4. `valGI` 是否还需要保留？如果只是历史版本，建议移到 `legacy/` 并移出所有 `.pjx`。
5. "生产结束"按钮的预期行为：立即停，还是走完当前轨迹再停？
6. `_getForce` 关节力矩记录是否还要用？若要用，5.0 里缺 `taskCreate "getForce"`。
