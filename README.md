# Robot_VAL3 — TX2-90L valGI 应用程序

史陶比尔（Staubli）CS9 控制器上的 VAL3 应用程序，随单元格工程 `tx2_90l_vaGI_develop` 部署在
`Controller1/usr/usrapp` 目录下。本仓库保存该应用目录的完整源码与数据（程序 `.pgx`、工程 `.pjx`、
数据 `.dtx`、HMI 页面 `.html` 等），用于版本管理、评审与后续优化。

- 机器人：Staubli TX2-90L
- 控制器：CS9（`s8.x Cs9` 系列 VAL3）
- 单元格：`tx2_90l_vaGI_develop`
- 应用根目录：`Controller1/usr/usrapp`（即本仓库根目录）

## 目录结构

| 目录 | 作用 |
| --- | --- |
| `appLauncher/` | 应用入口（`Main.pgx`、`Init.pgx`、`kill.pgx`），创建 `plc` / `HMI` / `supervisorTask` 等任务并进入主循环；`initLib/` 负责按库序号装载客户程序与轨迹库 |
| `valGI/` | 另一套入口（`version:4.11.20251028`），带 `cycle_*` 周期控制、`_tCycleCtrl`、`_productCycle`、`MonitorIO` 及 HMI 接口 |
| `source/` | 公共源码库：`robotStatus`、`plc`、`io`、`program`、`trajectory`、`Action`、`safeCheck`、`goSafeHome`、`saveData`、`template/*`（程序/轨迹/动作模板）、`ioconfigfile`（现场总线与 I/O 配置） |
| `HMI_cs9/` | CS9 触摸屏 HMI：`home`（主界面）、`HMI_TRAJ`、`HMI_prog`、`HMI_progEdit`、`HMI_pointEdit`、`HMI_cycle`、`HMI_IO`、`HMI_setting`、`HMI_safepoint`、`HMI_safezone`、`HMI_message`、`HMI_FrameSet`、`HMI_util`、`simulate` |
| `SmartTCP_CS9/` | SmartTCP 功能（TX2/TS2 两套算法 + 数据库 + 矩阵库 + `userType` 触摸控件） |
| `LibTorque/` | 关节力矩库：`_setMaxJntForce`、`_getSetForce`、`setPageMaxJntForce` 及 `ForceData` |
| `autoReturn/` | 自动回退：`MoveJ/MoveL/MoveC` 封装、`returnMove`、移动栈记录（`logMoveMsg*`） |
| `resizeProg/` | 程序/轨迹复制与缩放工具（`copyPoint3`、`getTrajList`、`getSize`） |
| `safeLogic/` | 安全逻辑：安全区域计算与点/区域检查（`computeArea`、`areaCheck`、`checkPoint`） |
| `data/` | 应用数据：`actionData`（动作库）、`CustomerLib/lib0|default` 下的 `savePROG`、`saveTRAJ`、`safeData` |

## 启动流程（`appLauncher/Main.pgx`）

1. `resetMotion()`，设置版本号；
2. 按 `saveData:nLibIndex` 装载程序库与轨迹库；
3. `taskCreate "plc"`（优先级 60）→ 机器人状态机与 I/O；
4. `taskCreate "HMI"`（50）→ `home:main()` 触摸屏；
5. `taskCreate "supervisorTask"`（10）→ 看门狗；
6. 主循环：`_systemStates()` 刷新状态、`_tCycleCtrl()` 执行生产周期，`rs:bQuitApp` 退出后 `kill()`。

`valGI/Main.pgx` 为带 `cycle_Init` + `safeCheck` 任务的旧版流程，两套入口不要同时运行。

## VAL3 版本

各 `.pjx` 的 `Parameters version` 记录了最后一次编译所用的 VAL3 版本，跨度较大：

- `s8.8.3Cs9_BS1660` / `s8.10.x Cs9` —— `SmartTCP_CS9`、多数 `HMI_cs9` 子工程、`data/`
- `s8.15.x Cs9_BS3337` —— `valGI`、`LibTorque`、`autoReturn`、`trajectory`、`program`
- `s8.21.x Cs9_BS4703/4944` —— `appLauncher`、`plc`、`robotStatus`、`HMI_TRAJ`

改动前请确认目标控制器固件与工程版本匹配；混用版本可能导致控件或库接口不兼容。

## 开发与部署

1. 用 Staubli Robotics Suite（SRS）打开对应的 `.pjx`（`appLauncher` 或 `valGI` 作为入口工程）；
2. 在 SRS 中编译、仿真，确认无编译错误；
3. 通过 SRS 或 FTP 将 `usrapp` 同步到控制器 `usr/usrapp`；
4. 控制器上运行 `appLauncher`（或 `valGI`）的 `Main`。

本仓库根目录即控制器上的 `usrapp` 目录，**不要**在此层再嵌套一层 `usrapp`。

## 约定

- 仓库保存控制器上的原始字节：`.gitattributes` 使用 `* -text`，禁止换行符转换；
- `.dtx` 为二进制/长文本数据（最大约 2.6 MB），修改请通过 SRS 或应用的保存流程，避免手工编辑破坏结构；
- `Thumbs.db`、`desktop.ini`、`*.log` 等不入库。

## 待办 / 优化方向

- [ ] 统一各子工程的 VAL3 版本基线；
- [ ] `appLauncher` 与 `valGI` 两套入口的重复代码合并；
- [ ] 主循环中 `clock()` 看门狗与 `delay(0)` 的 CPU 占用评估；
- [ ] HMI 页面与 VAL3 变量的 `bindings.json` 一致性检查；
- [ ] 数据文件（`saveTRAJ`、`actionData`）体积与加载耗时优化。
