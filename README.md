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
npm install
USE_MOCK_DATA=true PORT=8099 npm start
```

Open [http://127.0.0.1:8099/](http://127.0.0.1:8099/).

## Verification

```bash
npm run verify
docker build -t whole-house-status-addon:local .
```

## Home Assistant OS Installation

1. Using Samba or SSH, copy this Add-on directory (the directory that directly contains `config.yaml` and `Dockerfile`) to `/addons/whole_house_status` on Home Assistant OS.
2. Open `Settings > Add-ons > Add-on Store`.
3. From the top-right menu, select **Check for updates**. Refresh the page if necessary.
4. In **Local apps**, install **Whole House Status**.
5. Start the add-on. Ingress is enabled automatically by the Add-on metadata.
6. Open `全屋设备状态` from the sidebar.

## Options

After editing and saving options on the Add-on's **Configuration** page, restart the Add-on so it reads the updated `/data/options.json`.

Override a Home Assistant Area for an entity:

```yaml
rooms:
  overrides:
    - entity_id: switch.men_ting_ding_deng
      room: 门口
```

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
