# PV Module Reliability Test Standards
**Agnipariksha Reference Document**

## IEC 61215-2 MQT 11 — Thermal Cycling
Standard for crystalline silicon PV modules.
- **Purpose**: Verify ability to withstand thermal expansion/contraction stress
- **Cycles**: 200 (qualification), 50 (prequalification)
- **Temperature range**: -40°C to +85°C
- **Ramp rate**: Controlled by thermal chamber
- **Current**: Isc applied at peak temperature
- **Pass criteria**: Pmax degradation < 5%, no visual defects, insulation resistance > 40 MΩ

## IEC 61215-2 MQT 12 — Humidity Freeze
- **Purpose**: Verify resistance to moisture ingress followed by freeze stress
- **Cycles**: 10
- **Profile**: 85°C/85%RH (20h) → transition → -40°C (20h)
- **Pass criteria**: Same as TC

## IEC TS 63342:2022 — LeTID
Light and elevated Temperature Induced Degradation
- **Purpose**: Characterize performance loss under combined light/heat stress
- **Current injection**: Idark = Isc - Imp (dark carrier injection method)
- **Temperature**: 75°C ± 3°C
- **Duration**: 162 hours minimum
- **Measurement interval**: Every 2 hours
- **Pass criteria**: Pmax loss < 2% from initial STC value

## IEC 62979:2017 — Bypass Diode Thermal
- **Purpose**: Verify bypass diode thermal stability under reverse current
- **Test current**: 1.35 × Isc
- **Duration**: 1 hour
- **Monitoring**: Diode forward voltage Vf (< 0.7V indicates safe operation)
- **Pass criteria**: No thermal runaway, Tj < 128°C, structural integrity

## IEC 61730-2 MST 26 — Reverse Current Overload
- **Purpose**: Verify module survives reverse current conditions
- **Current**: Based on maximum overcurrent protection device rating × 1.35
- **Pass criteria**: No fire, no explosion, no sustained arcing

## IEC 61730-2 MST 13 — Ground Continuity
- **Purpose**: Verify effective grounding path between metal frame and earth
- **Test current**: 25A AC (or DC equivalent)
- **Voltage limit**: 2.5V drop maximum
- **Calculated resistance**: R = V/I < 0.1 Ω
- **Pass criteria**: Resistance < 0.1 Ω throughout
