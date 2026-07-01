function build_psu_console_model(modelName)
%BUILD_PSU_CONSOLE_MODEL Build a Simulink live console for the DC PSU.
%   Assembles a Simulink model that IS the operator console:
%     setpoint sources (Constants) -> PSU Live Interface (MATLAB Function
%     block calling psu_live_interface, which bridges to the backend REST
%     proxy) -> Scope + Displays for V / I / P / Tj / backend-OK.
%
%   backend-OK mirrors the App Designer console's HealthLamp: it drops to 0
%   (and V/I/P/Tj hold their last known-good values) if the backend REST
%   proxy is unreachable — the simulation keeps running instead of erroring
%   out (see psu_live_interface.m).
%
%   For a polished HMI, swap the Constants for Dashboard **Knob** / **Rocker
%   Switch** blocks and drop Dashboard **Gauge** blocks on the four outputs
%   (Simulink > Dashboard library) — then the model is an interactive PSU
%   console driven entirely from Simulink.
%
%   SCAFFOLD (requires Simulink): authored without MATLAB-in-the-loop, so run
%   once and verify. The MATLAB Function block body is injected via the
%   Stateflow API, which can be release-sensitive. The plant simulation model
%   (../build_psu_plant_model.m) and its math are separately Octave-verified
%   (../tests/simulink_plant_parity.m).

    if nargin < 1 || isempty(modelName), modelName = 'psu_console'; end
    here = fileparts(mfilename('fullpath'));
    addpath(here);                          % psu_live_interface.m
    addpath(fullfile(here, '..', 'app'));   % psu_rest.m

    if bdIsLoaded(modelName), close_system(modelName, 0); end
    new_system(modelName); open_system(modelName);
    add = @(t, n, p, varargin) add_block(t, [modelName '/' n], 'Position', p, varargin{:});

    % --- Setpoint sources (swap for Dashboard Knob / Rocker Switch) -------
    add('simulink/Sources/Constant', 'Vsp',   [20  20  60  50],  'Value', '48');
    add('simulink/Sources/Constant', 'Isp',   [20  90  60 120],  'Value', '2');
    add('simulink/Sources/Constant', 'OutEn', [20 160  60 190],  'Value', '1');

    % --- Live interface (MATLAB Function block -> backend REST) -----------
    add('simulink/User-Defined Functions/MATLAB Function', 'PSU Live Interface', [160 40 340 200]);
    setMatlabFunctionBody(modelName, 'PSU Live Interface', consoleFcnBody());

    % --- Telemetry sinks (drop Dashboard Gauges here for an HMI) ----------
    add('simulink/Sinks/Scope',   'Telemetry', [430 100 470 150]);
    add('simulink/Sinks/Display', 'V',  [430 20  470 40]);
    add('simulink/Sinks/Display', 'I',  [430 160 470 180]);
    add('simulink/Sinks/Display', 'P',  [430 190 470 210]);
    add('simulink/Sinks/Display', 'Tj', [430 220 470 240]);
    add('simulink/Sinks/Display', 'BackendOK', [430 250 470 270]);

    add_line(modelName, 'Vsp/1',   'PSU Live Interface/1', 'autorouting', 'on');
    add_line(modelName, 'Isp/1',   'PSU Live Interface/2', 'autorouting', 'on');
    add_line(modelName, 'OutEn/1', 'PSU Live Interface/3', 'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/1', 'V/1',  'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/2', 'I/1',  'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/3', 'P/1',  'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/4', 'Tj/1', 'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/5', 'BackendOK/1', 'autorouting', 'on');
    add_line(modelName, 'PSU Live Interface/1', 'Telemetry/1', 'autorouting', 'on');

    set_param(modelName, 'Solver', 'FixedStepDiscrete', 'FixedStep', '1', 'StopTime', '60');
    save_system(modelName);
    fprintf('Built %s.slx — start the backend (uvicorn :8000), then run the model.\n', modelName);
end

function setMatlabFunctionBody(model, blockName, body)
%SETMATLABFUNCTIONBODY Inject a MATLAB Function block's code (Stateflow API).
    sf = sfroot;
    chart = sf.find('-isa', 'Stateflow.EMChart', 'Path', [model '/' blockName]);
    chart.Script = body;
end

function s = consoleFcnBody()
    s = sprintf([ ...
        'function [voltage_v, current_a, power_w, temperature_c, backend_ok] = fcn(Vsp, Isp, OutEn)\n' ...
        '%%#codegen\n' ...
        '    [voltage_v, current_a, power_w, temperature_c, backend_ok] = psu_live_interface(Vsp, Isp, OutEn);\n' ...
        'end\n']);
end
