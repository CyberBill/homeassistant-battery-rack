class BatteryRackCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
        this._checkOffline = () => {
            if (this.config && this.isOffline() !== this._renderedOffline) {
                this.render();
            }
        };
        this._onVisibilityChange = () => {
            if (!document.hidden) this._checkOffline();
        };
    }

    connectedCallback() {
        this._offlineTimer = window.setInterval(this._checkOffline, 15_000);
        document.addEventListener("visibilitychange", this._onVisibilityChange);
        this._checkOffline();
    }

    disconnectedCallback() {
        window.clearInterval(this._offlineTimer);
        document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }

    isOffline() {
        if (this.config?.empty) return false;

        const state = this._hass?.states[this.config?.last_active_entity]?.state;
        const lastActive = Date.parse(state);

        return !Number.isFinite(lastActive) || Date.now() - lastActive > 120_000;
    }

    setConfig(config) {
        this.config = config;
        this.render();
    }

    set hass(hass) {
        const oldHass = this._hass;
        this._hass = hass;

        // First HA assignment: always render.
        if (!oldHass) {
            this.render();
            return;
        }

        const watchedEntities = [
            this.config?.soc_entity,
            this.config?.voltage_entity,
            this.config?.current_entity,
            this.config?.delta_entity,
            this.config?.last_active_entity,
            "input_text.test_battery_serial",
            "input_select.battery_test_phase",
        ].filter(Boolean);

        const changed = watchedEntities.some(
            (entityId) =>
                oldHass.states[entityId]?.state !==
                hass.states[entityId]?.state
        );

        if (changed || this.isOffline() !== this._renderedOffline) {
            this.render();
        }
    }

    getCardSize() {
        return 2;
    }

    async selectForTesting(event) {
        event.preventDefault();
        event.stopPropagation();

        const testPhase =
            this._hass?.states["input_select.battery_test_phase"]?.state ?? "Idle";

        const testLocked =
            !["Idle", "Complete", "Aborted"].includes(testPhase);

        if (testLocked) {
            return;
        }

        if (
            !this._hass ||
            !this.config?.serial ||
            this.config?.battery_id == null ||
            !this.config?.device_id
        ) {
            return;
        }

        await Promise.all([
            this._hass.callService(
                "input_text",
                "set_value",
                {
                    entity_id: "input_text.test_battery_serial",
                    value: this.config.serial
                }
            ),

            this._hass.callService(
                "input_number",
                "set_value",
                {
                    entity_id: "input_number.test_battery_id",
                    value: this.config.battery_id
                }
            ),

            this._hass.callService(
                "input_text",
                "set_value",
                {
                    entity_id: "input_text.test_battery_device_id",
                    value: this.config.device_id
                }
            )
        ]);

        window.history.pushState(
            null,
            "",
            "/battery-test-stand"
        );

        window.dispatchEvent(
            new CustomEvent("location-changed")
        );
    }

    getValue(entityId, decimals = null) {
        if (!entityId || !this._hass) {
            return {
                value: "—",
                unit: ""
            };
        }

        const state = this._hass.states[entityId];

        if (
            !state ||
            state.state === "unknown" ||
            state.state === "unavailable"
        ) {
            return {
                value: "—",
                unit: state?.attributes?.unit_of_measurement ?? ""
            };
        }

        let value = state.state;

        if (decimals !== null) {
            const number = Number(value);

            if (!Number.isNaN(number)) {
                value = number.toFixed(decimals);
            }
        }

        return {
            value,
            unit: state.attributes.unit_of_measurement ?? ""
        };
    }

    render() {
        if (!this.config) return;

        const config = this.config;
        this._renderedOffline = this.isOffline();
        const selectedSerial =
            this._hass?.states["input_text.test_battery_serial"]?.state;

        const testPhase =
            this._hass?.states["input_select.battery_test_phase"]?.state ?? "Idle";

        const selectedForTest =
            selectedSerial === config.serial;

        const testLocked =
            !["Idle", "Complete", "Aborted"].includes(testPhase);

        // ----------------------------------------------------------
        // EMPTY SLOT
        // ----------------------------------------------------------

        if (config.empty) {
            this.shadowRoot.innerHTML = `
        <style>
          ha-card {
            height: 120px;
            box-sizing: border-box;
            padding: 10px;
            opacity: 0.35;

            display: flex;
            align-items: center;
            justify-content: center;

            text-align: center;
          }

          .position {
            font-size: 12px;
            font-weight: 600;
          }

          .empty {
            margin-top: 6px;
            font-size: 11px;
            opacity: 0.7;
          }
        </style>

        <ha-card>
          <div>
            <div class="position">${config.position}</div>
            <div class="empty">EMPTY</div>
          </div>
        </ha-card>
      `;
            return;
        }

        // ----------------------------------------------------------
        // OFFLINE BATTERY
        // ----------------------------------------------------------

        if (this._renderedOffline) {
            this.shadowRoot.innerHTML = `
        <style>
          a {
            color: inherit;
            text-decoration: none;
            display: block;
          }

          a ha-card {
            cursor: pointer;
          }

          a:hover ha-card {
            background-color: var(--secondary-background-color);
          }

          ha-card {
            height: 120px;
            box-sizing: border-box;
            padding: 10px;

            display: flex;
            flex-direction: column;
            justify-content: space-between;

            border: 2px solid var(--error-color);
          }

          .header {
            font-size: 12px;
            font-weight: 600;
          }

          .offline {
            text-align: center;
            font-weight: 700;
            color: var(--error-color);
          }

          .serial {
            font-size: 10px;
            opacity: 0.7;
            overflow: hidden;
            text-overflow: ellipsis;
          }
        </style>

        ${config.device_id ? `<a href="/config/devices/device/${config.device_id}">` : ""}
        <ha-card>
          <div class="header">${config.position}</div>
          <div class="offline">OFFLINE</div>
          <div class="serial">${config.serial}</div>
        </ha-card>
        ${config.device_id ? "</a>" : ""}
      `;

            return;
        }

        // Need HA state information for a live battery.
        if (!this._hass) return;

        const soc = this.getValue(config.soc_entity, 0);
        const voltage = this.getValue(config.voltage_entity, 2);
        const current = this.getValue(config.current_entity, 1);
        const deltaVolts = this.getValue(config.delta_entity, null);

        let delta = {
            value: "—",
            unit: "mV"
        };

        if (deltaVolts.value !== "—") {
            const value = Number(deltaVolts.value);

            if (!Number.isNaN(value)) {
                delta.value = Math.round(value * 1000);
            }
        }

        const url = `/config/devices/device/${config.device_id}`;

        this.shadowRoot.innerHTML = `
      <style>
        a {
          color: inherit;
          text-decoration: none;
          display: block;
        }

        ha-card {
          height: 120px;
          box-sizing: border-box;
          padding: 9px 10px;

          cursor: pointer;

          overflow: visible;

          display: flex;
          flex-direction: column;
          justify-content: space-between;

          transition:
            transform 0.08s ease,
            background-color 0.08s ease;
        }

        ha-card:hover {
          transform: translateY(-1px);
          background-color:
            var(--secondary-background-color);
        }

        ha-card.test-selected {
            background-color: rgba(255, 193, 7, 0.14);
            box-shadow: inset 0 0 0 2px rgba(255, 193, 7, 0.65);
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;

          font-size: 11px;
          font-weight: 600;
        }

        .board {
          font-size: 13px;
          font-weight: 700;
        }

        .main {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 8px;
        }

        .soc {
          font-size: 24px;
          font-weight: 700;
          line-height: 1;
        }

        .voltage {
          font-size: 13px;
          opacity: 0.8;
        }

        .details {
          display: flex;
          justify-content: space-between;

          font-size: 11px;
        }

        .serial {
          font-size: 9px;
          opacity: 0.55;

          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .test-button {
            --mdc-icon-button-size: 28px;
            --mdc-icon-size: 18px;
            margin: -6px -5px -6px 0;
        }

        .test-button:hover {
            color: var(--primary-color);
        }
        .test-button-disabled {
            opacity: 0.25;
            cursor: not-allowed;
        }

        .test-button-disabled:hover {
            color: inherit;
        }

        .test-button-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }

        .test-tooltip {
            position: absolute;
            z-index: 1000;

            /* Put tooltip below the flask. */
            top: calc(100% + 6px);
            right: 0;

            background: var(--card-background-color, #fff);
            color: var(--primary-text-color, #000);

            border: 1px solid var(--divider-color, #ccc);
            border-radius: 4px;

            padding: 6px 9px;

            font-size: 12px;
            font-weight: normal;
            white-space: nowrap;

            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);

            opacity: 0;
            visibility: hidden;
            pointer-events: none;

            transition: opacity 0.15s ease;
        }

        .test-button-wrapper:hover .test-tooltip {
            opacity: 1;
            visibility: visible;
        }
      </style>

      <a href="${url}">
        <ha-card class="${selectedForTest ? "test-selected" : ""}">

          <div class="header">
            <span>${config.position}</span>

            <div class="header-right">
              <span class="board">
                ${config.battery_id != null ? `#${config.battery_id}` : "#?"}
              </span>

              <div class="test-button-wrapper">
                    <ha-icon-button
                        class="test-button ${testLocked ? "test-button-disabled" : ""}"
                    >
                        <ha-icon icon="mdi:flask"></ha-icon>
                    </ha-icon-button>

                    <div class="test-tooltip">
                        ${
                            testLocked
                                ? `Battery selection locked while test is ${testPhase}`
                                : selectedForTest
                                    ? "This battery is currently on the test stand"
                                    : "Select battery for testing"
                        }
                    </div>
                </div>
            </div>
          </div>

          <div class="main">
            <span class="soc">${soc.value}${soc.unit}</span>
            <span class="voltage">
              ${voltage.value}${voltage.unit}
            </span>
          </div>

          <div class="details">
            <span>
              ${current.value}${current.unit}
            </span>

            <span>
              Δ ${delta.value}${delta.unit}
            </span>
          </div>

          <div class="serial">
            ${config.serial} · Bus ID ${config.board_number}
          </div>

        </ha-card>
      </a>
    `;
        const testButton =
            this.shadowRoot.querySelector(".test-button");

        if (testButton) {
            testButton.addEventListener(
                "click",
                (event) => this.selectForTesting(event)
            );
        }
    }
}

customElements.define(
    "battery-rack-card",
    BatteryRackCard
);

class BatteryCabinetRack extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: "open" });
    }

    setConfig(config) {
        if (!config.cards) {
            throw new Error("BatteryCabinetRack requires cards");
        }

        this.config = config;
        this.render();
    }

    set hass(hass) {
        this._hass = hass;

        // Pass HA state through to every child card.
        this.shadowRoot
            .querySelectorAll("battery-rack-card")
            .forEach((card) => {
                card.hass = hass;
            });
    }

    render() {
        if (!this.config) {
            return;
        }

        this.shadowRoot.innerHTML = `
            <style>
                :host {
                    display: block;
                    width: 100%;
                }

                .rack {
                    display: grid;

                    /*
                     * Five equal-width cabinets with a 3px divider
                     * between each cabinet.
                     */
                    grid-template-columns:
                        minmax(0, 1fr) 3px
                        minmax(0, 1fr) 3px
                        minmax(0, 1fr) 3px
                        minmax(0, 1fr) 3px
                        minmax(0, 1fr);

                    width: 100%;
                }

                .cabinet {
                    display: grid;
                    grid-template-columns:
                        minmax(0, 1fr)
                        minmax(0, 1fr);

                    gap: 8px;
                }

                .divider {
                    background: #000;
                    width: 3px;

                    /*
                     * Leave a little breathing room between the
                     * divider and the cards on either side.
                     */
                    margin: 0 auto;
                }

                /*
                 * Put some space between each cabinet and its
                 * divider without changing divider width.
                 */
                .cabinet:not(:first-child) {
                    padding-left: 8px;
                }

                .cabinet:not(:last-child) {
                    padding-right: 8px;
                }
            </style>

            <div class="rack"></div>
        `;

        const rack = this.shadowRoot.querySelector(".rack");

        /*
         * The incoming cards are ordered:
         *
         * row 3: C1 F,R  C2 F,R ... C5 F,R
         * row 2: C1 F,R  C2 F,R ... C5 F,R
         * row 1: C1 F,R  C2 F,R ... C5 F,R
         *
         * Pull each cabinet's six cards out of that array.
         */
        for (let cabinet = 0; cabinet < 5; cabinet++) {
            const cabinetElement = document.createElement("div");
            cabinetElement.className = "cabinet";

            for (let row = 0; row < 3; row++) {
                for (let depth = 0; depth < 2; depth++) {
                    const index =
                        (row * 10) +
                        (cabinet * 2) +
                        depth;

                    const cardConfig = this.config.cards[index];

                    const card =
                        document.createElement("battery-rack-card");

                    card.setConfig(cardConfig);

                    if (this._hass) {
                        card.hass = this._hass;
                    }

                    cabinetElement.appendChild(card);
                }
            }

            rack.appendChild(cabinetElement);

            if (cabinet < 4) {
                const divider = document.createElement("div");
                divider.className = "divider";
                rack.appendChild(divider);
            }
        }
    }
}

customElements.define(
    "battery-cabinet-rack",
    BatteryCabinetRack
);

class BatterySystemDashboardStrategy extends HTMLElement {
    static async generate(config, hass) {
        const entities = await hass.callWS({
            type: "config/entity_registry/list"
        });

        const findDeviceEntity = (deviceId, suffixes) => {
            return entities.find((entity) =>
                entity.device_id === deviceId &&
                suffixes.some((suffix) =>
                    entity.entity_id.endsWith(suffix)
                )
            )?.entity_id ?? null;
        };

        const getNumberState = (entityId) => {
            if (!entityId) return null;

            const state = hass.states[entityId]?.state;

            if (
                state == null ||
                state === "" ||
                state === "unknown" ||
                state === "unavailable"
            ) {
                return null;
            }

            const value = Number(state);

            return Number.isFinite(value) ? value : null;
        };

        // ------------------------------------------------------------
        // Discover Daly batteries from their serial-number sensors.
        // ------------------------------------------------------------

        const batteries = entities
            .filter((entity) =>
                entity.entity_id.startsWith("sensor.daly_bms_") &&
                entity.entity_id.endsWith("_serial_number"))
            .map((entity) => {
                const state = hass.states[entity.entity_id];

                const boardEntity = entities.find(
                    (candidate) =>
                        candidate.device_id === entity.device_id &&
                        candidate.entity_id.startsWith("sensor.daly_bms_") &&
                        candidate.entity_id.endsWith("_board_number"));

                const boardState = boardEntity ?
                    hass.states[boardEntity.entity_id] :
                    null;

                const idEntity = findDeviceEntity(
                    entity.device_id,
                    ["_id"]
                );

                const cabinetEntity = findDeviceEntity(
                    entity.device_id,
                    ["_cabinet"]
                );

                const rowEntity = findDeviceEntity(
                    entity.device_id,
                    ["_row"]
                );

                const depthEntity = findDeviceEntity(
                    entity.device_id,
                    ["_depth"]
                );

                return {
                    serial: state?.state?.toUpperCase(),
                    device_id: entity.device_id,
                    serial_entity: entity.entity_id,

                    board_number: boardState?.state ?? "?",
                    board_entity: boardEntity?.entity_id ?? null,

                    id: getNumberState(idEntity),
                    cabinet: getNumberState(cabinetEntity),
                    row: getNumberState(rowEntity),
                    depth: getNumberState(depthEntity),

                    id_entity: idEntity,
                    cabinet_entity: cabinetEntity,
                    row_entity: rowEntity,
                    depth_entity: depthEntity,

                    board_number: boardState?.state ?? "?",
                    board_entity: boardEntity?.entity_id ?? null,

                    soc_entity: findDeviceEntity(entity.device_id, [
                        "_soc_soc_percent",
                        "_state_of_charge"
                    ]),

                    voltage_entity: findDeviceEntity(entity.device_id, [
                        "_soc_total_voltage",
                        "_pack_voltage"
                    ]),

                    current_entity: findDeviceEntity(entity.device_id, [
                        "_soc_current",
                        "_current"
                    ]),

                    delta_entity: findDeviceEntity(entity.device_id, [
                        "_cell_voltage_spread"
                    ]),

                    last_active_entity: findDeviceEntity(entity.device_id, [
                        "_last_active_utc"
                    ]),
                };
            })
            .filter((battery) =>
                battery.serial &&
                battery.serial !== "UNKNOWN" &&
                battery.serial !== "UNAVAILABLE");

        // Group batteries as unidentified, positioned, or unassigned.
        // "Unidentified" means the battery has no valid ID.
        const unidentified = batteries.filter(
            (battery) => battery.id == null
        );
        
        // "Positioned" means the battery has a valid ID and is assigned to a valid cabinet, row, and depth.
        const positionedBatteries = batteries.filter(
            (battery) =>
                battery.id != null &&
                battery.cabinet >= 1 &&
                battery.cabinet <= 5 &&
                battery.row >= 1 &&
                battery.row <= 3 &&
                battery.depth >= 1 &&
                battery.depth <= 2
        );

        // "Unassigned" means the battery has a valid ID but is not assigned to a valid cabinet, row, and depth.
        const unassigned = batteries.filter(
            (battery) =>
                battery.id != null &&
                !positionedBatteries.includes(battery)
            )
            .sort((a, b) => (a.id ?? 9999) - (b.id ?? 9999));

        // ------------------------------------------------------------
        // Build the physical 3 x 10 rack.
        //
        // Each cabinet occupies two columns:
        //   depth 1 = front
        //   depth 2 = rear
        //
        // Dashboard rows are displayed:
        //   3 = top
        //   2 = middle
        //   1 = bottom
        // ------------------------------------------------------------

        const rackCards = [];

        for (let row = 3; row >= 1; row--) {
            for (let cabinet = 1; cabinet <= 5; cabinet++) {
                for (let depth = 1; depth <= 2; depth++) {

                    const battery = positionedBatteries.find(
                        (item) =>
                            item.cabinet === cabinet &&
                            item.row === row &&
                            item.depth === depth
                    );

                    const rowName =
                        row === 3 ? "T" :
                        row === 2 ? "M" :
                        "B";

                    const position =
                        `C${cabinet}${rowName} · ${depth === 1 ? "FRONT" : "REAR"}`;

                    if (!battery) {
                        rackCards.push({
                            type: "custom:battery-rack-card",
                            position: position,
                            empty: true,
                        });

                        continue;
                    }

                    rackCards.push({
                        type: "custom:battery-rack-card",

                        position: position,

                        serial: battery.serial,
                        device_id: battery.device_id,
                        last_active_entity: battery.last_active_entity,

                        battery_id: battery.id,
                        board_number: battery.board_number,

                        soc_entity: battery.soc_entity,
                        voltage_entity: battery.voltage_entity,
                        current_entity: battery.current_entity,
                        delta_entity: battery.delta_entity,
                    });
                }
            }
        }

        // ------------------------------------------------------------
        // Find discovered batteries that have no physical assignment.
        // ------------------------------------------------------------

        const unassignedCards = unassigned.map((battery) => ({
            type: "custom:battery-rack-card",

            position: battery.id != null
                ? "UNASSIGNED"
                : "UNIDENTIFIED",

            serial: battery.serial,
            device_id: battery.device_id,

            battery_id: battery.id,
            last_active_entity: battery.last_active_entity,
            board_number: battery.board_number,

            soc_entity: battery.soc_entity,
            voltage_entity: battery.voltage_entity,
            current_entity: battery.current_entity,
            delta_entity: battery.delta_entity,
        }));

        // ------------------------------------------------------------
        // Build dashboard.
        // ------------------------------------------------------------

        const summary = [`**${positionedBatteries.length}** Installed`];

        if (unassigned.length > 0 || unidentified.length > 0) {
            summary.push(`**${batteries.length}** discovered`);
        }

        if (unassigned.length > 0) {
            summary.push(`**${unassigned.length}** unassigned`);
        }

        if (unidentified.length > 0) {
            summary.push(`**${unidentified.length}** unidentified`);
        }

        return {
            title: "Battery System",

            views: [{
                title: "Battery Rack",
                path: "rack",
                icon: "mdi:battery",
                type: "panel",

                cards: [{
                    type: "vertical-stack",

                    cards: [{
                        type: "markdown",
                        content: `# Battery Rack\n\n` + summary.join(" · "),
                    },

                    {
                        type: "custom:battery-cabinet-rack",
                        cards: rackCards,
                    },

                    ...(unassignedCards.length > 0 ? [{
                        type: "markdown",
                        content:
                            `## Unassigned Batteries\n\n` +
                            `${unassigned.length} discovered batteries are not assigned to a rack position.`,
                    },

                    {
                        type: "grid",
                        columns: 6,
                        square: false,
                        cards: unassignedCards,
                    }] : []),
                    ],
                },],
            },],
        };
    }
}

customElements.define(
    "ll-strategy-dashboard-battery-system",
    BatterySystemDashboardStrategy
);

window.customStrategies = window.customStrategies || [];

window.customStrategies.push({
    type: "battery-system",
    strategyType: "dashboard",
    name: "Battery System",
    description: "Dashboard for the 30-position battery rack.",
});
