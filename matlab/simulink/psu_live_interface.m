function [voltage_v, current_a, power_w, temperature_c, backend_ok] = psu_live_interface(voltage_sp, current_sp, output_enabled)
%PSU_LIVE_INTERFACE Simulink MATLAB Function block: live PSU bridge.
%   Drop this into a Simulink model as a MATLAB Function block to drive and
%   read the Agnipariksha PSU from a running simulation, through the backend
%   REST proxy (backend/app/opcua_api.py).
%
%   Inputs : voltage_sp (V), current_sp (A), output_enabled (0/1)
%   Outputs: voltage_v, current_a, power_w, temperature_c, backend_ok (0/1)
%
%   The backend Base URL defaults to http://localhost:8000 — a MATLAB
%   Function block can't take a string signal, so change BASE_URL here. REST
%   calls are extrinsic (they run in MATLAB, not generated code): use this
%   block for normal/desktop simulation, not for code generation targets.
%   psu_rest.m (in ../app) must be on the MATLAB path.
%
%   Robustness: uses psu_rest('get_safe', ...), which never throws. If the
%   backend is unreachable the block HOLDS the last known-good readings
%   (persistent across simulation steps) instead of erroring out the whole
%   Simulink run, and backend_ok drops to 0 — the Simulink-console analogue
%   of the App Designer console's HealthLamp.

    coder.extrinsic('psu_rest');
    BASE_URL = 'http://localhost:8000';

    persistent last_v last_i last_p last_t
    if isempty(last_v)
        last_v = 0; last_i = 0; last_p = 0; last_t = 0;
    end

    % Pre-declare outputs — extrinsic results are mxArray until assigned.
    voltage_v = 0; current_a = 0; power_w = 0; temperature_c = 0; backend_ok = 0;

    sp = struct('voltage_v', double(voltage_sp), ...
                'current_a', double(current_sp), ...
                'output_enabled', logical(output_enabled));
    psu_rest('set', BASE_URL, sp);   % psu_rest('set',...) already never throws

    s = [];
    s = psu_rest('get_safe', BASE_URL);
    if isempty(s)
        backend_ok = 0;
        voltage_v = last_v; current_a = last_i;
        power_w = last_p;   temperature_c = last_t;
        return;
    end

    backend_ok    = 1;
    voltage_v     = double(s.voltage_v);
    current_a     = double(s.current_a);
    power_w       = double(s.power_w);
    temperature_c = double(s.temperature_c);
    last_v = voltage_v; last_i = current_a; last_p = power_w; last_t = temperature_c;
end
