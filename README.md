# Whole House Status Add-on

Whole House Status is a Home Assistant OS Add-on for monitoring whole-house device status from the HA sidebar.

## Features

- Ingress sidebar panel.
- Real-time Home Assistant WebSocket state updates.
- HA Area room filters, with Add-on override support.
- Offline and warning devices pinned above normal devices.
- Status colors: Green for on/running; Gray-white for online/idle; Orange for timeout or sustained high power; Red for unavailable, unknown, or fault.
- Monitor-only first version with no device controls.

## Local Development

```bash
cd whole_house_status
npm install
USE_MOCK_DATA=true PORT=8099 npm start
```

Open [http://127.0.0.1:8099/](http://127.0.0.1:8099/).

## Build

```bash
cd whole_house_status
docker build -t whole-house-status-addon:local .
```

## Home Assistant OS Installation

1. Open `Settings > Add-ons > Add-on Store`.
2. From the top-right menu, select **Repositories**.
3. Add `https://github.com/to21github/whole-house-status` as an **Add-on repository**.
4. Install **Whole House Status**.
5. Start the add-on.
6. Configure the add-on.
7. Restart the add-on.
8. Open `全屋设备状态` from the sidebar.

## Options

After editing and saving options on the Add-on's **Configuration** page, restart the Add-on so it reads the updated `/data/options.json`.

### Ignored Entities

Entities hidden in the Home Assistant entity registry are automatically treated as ignored. You can also ignore specific dashboard entities without hiding them globally:

```yaml
entities:
  exclude_entities:
    - switch.example_offline_device
```

Ignored entities are hidden from the dashboard and statistics by default. Enable **显示 > 显示已忽略的** to review them in their Home Assistant Areas.

Override a Home Assistant Area for an entity:

```yaml
rooms:
  overrides:
    - entity_id: switch.men_ting_ding_deng
      room: 门口
```

### Runtime Room Sorting

Select the sort control beside the dashboard room filters, then drag room filters into their new positions. You can make several adjustments in one session; select the sort control again to save the final order to `rooms.order` through Home Assistant, so it remains in effect after a restart. `全部` is fixed as the first filter and `未分组` is fixed as the last filter; neither can be moved.

Set the global on-duration warning threshold for active devices that do not have an explicit `on_duration_rules` entry:

```yaml
alerts:
  default_on_duration_minutes: 480
```

Mark a switch as a warning when its mapped power sensor remains above the threshold:

```yaml
alerts:
  high_power_rules:
    - entity_id: switch.water_heater
      power_sensor: sensor.water_heater_power
      threshold_w: 800
      duration_minutes: 30
```

Mark a switch as a warning after it has remained on for the configured duration:

```yaml
alerts:
  on_duration_rules:
    - entity_id: switch.computer_socket
      duration_minutes: 480
```
