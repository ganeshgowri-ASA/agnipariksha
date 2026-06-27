function p = psu_plant_defaults()
%PSU_PLANT_DEFAULTS Default first-order DC-PSU plant parameters.
%   These MUST match backend/app/opcua_bridge.py (DemoPsuSource) so the
%   MATLAB/Simulink model and the Python simulator agree tick-for-tick.
%
%   Fields:
%     response     - per-tick fraction the measured value moves toward target (0..1)
%     thermal_gain - junction-temperature rise per watt per tick (degC/W)
%     cooling      - per-tick fraction of (T - ambient) shed each tick
%     ambient_c    - ambient temperature (degC)
    p.response     = 0.35;
    p.thermal_gain = 0.02;
    p.cooling      = 0.05;
    p.ambient_c    = 25.0;
end
