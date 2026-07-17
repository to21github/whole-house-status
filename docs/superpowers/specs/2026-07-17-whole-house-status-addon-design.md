# 全屋设备状态监控 HA Add-on 设计文档

## 目标

构建一个入门级 Home Assistant 自研 Add-on，用于在 HA 侧边栏中常驻展示全屋设备状态。第一版只做监控，不控制设备，重点覆盖开关、灯具、空调、二元传感器、功率传感器等实体，适配小米中枢网关、米家、小燕、Aqara、中弘空调米家版等设备接入 HA 后形成的实体。

## 已确认决策

- 运行环境：Home Assistant OS，通过 Supervisor 安装和运行 Add-on。
- 技术路线：Node.js 后端 + 静态前端 + HA Add-on Ingress 展示。
- 控制范围：第一版只监控，不提供设备控制。
- 房间分组：混合模式，优先读取 HA Area，允许 Add-on 配置覆盖或补充。
- 告警规则：混合模式，有功率传感器时按高功率持续时间判断，没有功率传感器时按开启持续时间判断。
- 界面方向：回到用户确认的第一版深色卡片墙，颜色以参考图为准，UI 结构借鉴 HA 官方深色界面。

## 官方能力依据

- Ingress：Home Assistant 官方文档要求在 `config.yaml` 中设置 `ingress: true`；默认 Web 服务可监听 8099，若使用其它端口则设置 `ingress_port`。Ingress 由 HA 处理用户认证，适合把 Add-on 页面无缝放进 HA UI。
- Add-on 与 HA Core 通信：官方文档说明 Add-on 可通过 `http://supervisor/core/api/` 访问 Core API，并在 `config.yaml` 中开启 `homeassistant_api: true` 后使用 `SUPERVISOR_TOKEN`。
- WebSocket API：官方 WebSocket API 支持 `get_states` 获取初始状态，并通过 `subscribe_events` 订阅 `state_changed` 事件实现实时状态更新。

参考链接：

- https://developers.home-assistant.io/docs/apps/presentation/
- https://developers.home-assistant.io/docs/apps/communication/
- https://developers.home-assistant.io/docs/api/websocket/
- https://developers.home-assistant.io/docs/apps/configuration

## 系统架构

Add-on 容器内运行一个 Node.js 服务，监听 Ingress 端口。该服务同时承担静态文件服务、前端 WebSocket 服务、HA Core WebSocket 客户端和状态聚合器角色。

前端不会直接连接 Home Assistant WebSocket。前端只连接本 Add-on 暴露的 `/ws`，接收已经归一化后的设备列表、统计数据、房间列表、异常列表和连接状态。这样可以避免在浏览器中处理 HA Token、Ingress 路径和 Core API 细节。

核心模块边界：

- Add-on 配置：读取 Supervisor 注入的 `/data/options.json`，解析实体过滤、房间覆盖、告警规则和显示设置。
- HA 客户端：使用 `SUPERVISOR_TOKEN` 连接 `ws://supervisor/core/websocket` 或对应内部 API WebSocket，完成认证、`get_states`、`subscribe_events` 和断线重连。
- 状态仓库：保存最新实体状态，过滤目标 domain，生成设备视图模型。
- 房间解析器：优先使用 HA Area 或 entity/device/area registry 信息；配置覆盖优先级高于自动识别。
- 告警引擎：基于设备状态、功率传感器状态、开启时长和规则阈值计算橙色告警。
- 前端服务：提供静态 HTML/CSS/JS 和面向浏览器的 WebSocket。

## 数据流

启动流程：

1. Node.js 服务读取 `/data/options.json`。
2. 服务连接 HA Core WebSocket，并用 `SUPERVISOR_TOKEN` 鉴权。
3. 服务调用 `get_states` 拉取当前所有实体状态。
4. 服务过滤并归一化 `switch`、`light`、`climate`、`binary_sensor` 和配置中关联的 `sensor`。
5. 服务订阅 `state_changed` 事件。
6. 前端通过 Ingress 打开页面并连接 Add-on `/ws`。
7. 后端推送完整快照；后续状态变化推送增量或快照。

运行时更新：

- HA 实体状态变化时，后端更新状态仓库。
- 告警引擎重新计算相关设备状态。
- 后端重新生成统计、异常置顶列表和当前房间列表。
- 前端收到 payload 后重新渲染卡片，不刷新页面。

## 配置设计

第一版配置使用 Add-on options，提供稳定但不复杂的 YAML/JSON 结构。默认配置应能开箱即用；只在需要修正房间或绑定功率传感器时才需要编辑。

建议 options 示例：

```yaml
display:
  title: "全屋设备状态"
  default_room: "全部"
  show_entity_id: true

entities:
  include_domains:
    - switch
    - light
    - climate
    - binary_sensor
  exclude_entities: []

rooms:
  overrides:
    switch.men_ting_ding_deng: "门口"
    climate.qdhkl_cn_proxy_621130311_0101_ac: "门口"
  order:
    - 全部
    - 门口
    - 客厅
    - 主卧
    - 次卧
    - 厨房
    - 阳台
    - 儿童房
    - 设备间

alerts:
  default_on_duration_minutes: 480
  high_power_rules:
    - entity_id: switch.water_heater
      power_sensor: sensor.water_heater_power
      threshold_w: 800
      duration_minutes: 30
    - entity_id: switch.ev_charger
      power_sensor: sensor.ev_charger_power
      threshold_w: 1200
      duration_minutes: 60
  on_duration_rules:
    - entity_id: switch.computer_socket
      duration_minutes: 480
```

## 状态归一化

设备状态分为四类，并映射到固定颜色：

- `on`：设备在线且处于开启、运行、制冷、制热、打开等状态，显示绿色。
- `idle`：设备在线但关闭、空闲、未触发或仅作为传感器在线展示，显示灰白。
- `warning`：设备满足超时或高功率持续运行规则，显示橙色。
- `error`：设备状态为 `unavailable`、`unknown` 或被识别为故障，显示红色。

优先级从高到低：

1. 离线/故障红色。
2. 超时/高功率橙色。
3. 开启/运行绿色。
4. 在线/关闭灰白。

这保证离线和超时不会被普通在线状态覆盖。

## 告警规则

高功率规则：

- 规则绑定一个受控设备和一个功率传感器。
- 当设备处于开启状态，且功率传感器数值持续高于 `threshold_w` 达到 `duration_minutes`，设备进入 `warning`。
- 如果功率低于阈值或设备关闭，计时重置。

开启超时规则：

- 当设备处于开启状态持续超过配置时长，设备进入 `warning`。
- 如果设备关闭，计时重置。

离线规则：

- 实体状态为 `unavailable` 或 `unknown` 时进入 `error`。
- `error` 设备置顶显示，并计入离线/故障统计。

## 房间分组

房间解析优先级：

1. `rooms.overrides` 中显式配置的实体房间。
2. HA Area registry 解析出的实体所属区域。
3. entity/device registry 能关联出的设备区域。
4. 无法识别时归入“未分组”。

房间按钮按 `rooms.order` 展示。配置中不存在但自动识别到的房间追加在后面。“全部”始终排在第一位。

## 前端设计

布局使用用户确认的第一版：

- 背景：接近参考图的黑色 `#101010`。
- 卡片：深灰 `#191919`，边框 `#343434`，圆角约 10px。
- 标题：顶部居中显示“全屋设备状态”。
- 统计区：四个统计卡，依次为在线、开启、超时/高功率、离线/故障。
- 房间筛选：横向按钮，当前房间使用浅灰底和深色文字。
- 异常置顶：离线和超时设备先显示在分隔线下方。
- 普通设备：卡片网格显示设备名称、状态文字、entity_id。
- 响应式：宽屏多列卡片；窄屏统计区两列，设备卡片单列。

状态颜色：

- 开启：亮绿色。
- 在线/关闭：灰白。
- 超时/高功率：橙色。
- 离线/故障：红色。

交互：

- 点击房间按钮只筛选设备，不控制设备。
- 第一版不提供开关、空调、灯光控制按钮。
- 后端断线或 HA WebSocket 断线时，前端显示连接状态提示，并保留最后一次快照。

## Add-on 结构

仓库根目录就是 HA Add-on 目录，计划项目结构：

```text
config.yaml
Dockerfile
package.json
src/
  server.js
  haClient.js
  options.js
  stateStore.js
  roomResolver.js
  alertEngine.js
  viewModel.js
public/
  index.html
  app.js
  styles.css
test/
  alertEngine.test.js
  roomResolver.test.js
  viewModel.test.js
```

第一版不引入前端构建工具，静态 HTML/CSS/JS 足够。后端使用 Node.js 原生 HTTP 服务配合 `ws` 包处理 WebSocket；这样依赖少、容器体积小、维护路径清楚。

## 错误处理

- HA WebSocket 连接失败：指数退避重连，并向前端推送 `ha_connected: false`。
- `SUPERVISOR_TOKEN` 缺失：服务启动失败并输出明确日志。
- 配置解析失败：使用安全默认配置，同时在日志和前端状态中提示配置错误。
- 功率传感器缺失或数值不可解析：对应高功率规则暂不触发，设备仍可按开启超时规则告警。
- 前端 WebSocket 断开：自动重连。

## 测试计划

后端单元测试：

- 状态归一化：`on`、`off`、`unavailable`、`unknown`、`climate` 运行状态的颜色和标签。
- 告警引擎：高功率持续时间、开启超时、设备关闭重置计时、离线优先级。
- 房间解析：配置覆盖优先，HA Area 其次，未知实体进入未分组。
- 视图模型：统计数字、异常置顶、房间筛选和排序。

前端验证：

- Playwright 打开静态页面，确认页面非空。
- 桌面和移动视口截图，确认标题、统计卡、房间按钮、异常卡片和设备网格不重叠。
- 模拟 WebSocket payload，确认颜色映射正确。

Add-on 验证：

- 本地 Node 测试通过。
- Docker 镜像可构建。
- HA OS Add-on 安装后侧边栏可打开 Ingress 页面。
- 修改 Add-on options 后重启可生效。

## 非目标

第一版不做以下内容：

- 设备控制。
- 用户账号体系。
- 历史曲线和数据库持久化。
- 手机推送通知。
- 自动发现每个品牌私有能力。
- 自定义 Lovelace 卡片。

## 后续扩展

- 第二版可增加轻控制：开关和灯具点按控制，空调仍只展示。
- 增加设备搜索、收藏、隐藏实体。
- 增加历史告警记录。
- 增加 HA persistent notification 或移动端通知。
- 增加多主题支持，但默认仍保持第一版深色样式。
