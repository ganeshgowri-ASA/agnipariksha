function [voltage_v, current_a, power_w, temperature_c] = psu_live_interface(voltage_sp, current_sp, output_enabled)
%PSU_LIVE_INTERFACE Simulink MATLAB Function block: live PSU bridge.
%   Drop this into a Simulink model as a MATLAB Function block to drive and
%   read the Agnipariksha PSU from a running simulation, through the backend
%   REST proxy (backend/app/opcua_api.py).
%
%   Inputs : voltage_sp (V), current_sp (A), output_enabled (0/1)
%   Outputs: voltage_v, current_a, power_w, temperature_c
%
%   The backend Base URL defaults to http://localhost:8000 — a MATLAB
%   Function block can't take a string signal, so change BASE_URL here. REST
%   calls are extrinsic (they run in MATLAB, not generated code): use this
%   block for normal/desktop simulation, not for code generation targets.
%   psu_rest.m (in ../app) must be on the MATLAB path.

    coder.extrinsic('psu_rest');
    BASE_URL = 'http://localhost:8000';

    % Pre-declare outputs — extrinsic results are mxArray until assigned.
    voltage_v = 0; current_a = 0; power_w = 0; temperature_c = 0;

    sp = struct('voltage_v', double(voltage_sp), ...
                'current_a', double(current_sp), ...
                'output_enabled', logical(output_enabled));
    psu_rest('set', BASE_URL, sp);

    s = struct('voltage_v', 0, 'current_a', 0, 'power_w', 0, 'temperature_c', 0);
    s = psu_rest('get', BASE_URL);
    voltage_v     = double(s.voltage_v);
    current_a     = double(s.current_a);
    power_w       = double(s.power_w);
    temperature_c = double(s.temperature_c);
end
