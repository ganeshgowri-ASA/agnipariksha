function build_psu_plant_model(modelName)
%BUILD_PSU_PLANT_MODEL Programmatically build the Simulink DC-PSU plant model.
%   BUILD_PSU_PLANT_MODEL() creates 'psu_plant_model.slx' realizing the same
%   discrete first-order plant as psu_plant_step.m / the Python DemoPsuSource:
%
%       v[k]    = v[k-1]    + response * (Vsp*OutEn - v[k-1])
%       i[k]    = i[k-1]    + response * (Isp*OutEn - i[k-1])
%       P[k]    = v[k] * i[k]
%       Tj[k]   = Tj[k-1]   + thermal_gain*P[k] - cooling*(Tj[k-1] - ambient)
%
%   Inports : Vsp, Isp, OutEn (0/1)   Outports: V, I, Power, Tj
%
%   NOTE (source-only scaffold): authored without a MATLAB-in-the-loop, so
%   run it once and verify against run_psu_step_response.m; minor block/port
%   tweaks may be needed for your Simulink release. The .m plant functions
%   are the cross-checked reference; this script ports them into Simulink.

    if nargin < 1, modelName = 'psu_plant_model'; end
    p = psu_plant_defaults();

    if bdIsLoaded(modelName), close_system(modelName, 0); end
    new_system(modelName); open_system(modelName);
    add = @(type, name, pos, varargin) add_block(type, [modelName '/' name], ...
        'Position', pos, varargin{:});

    % --- Inputs ---
    add('simulink/Sources/In1',  'Vsp',   [20  20  50  34]);
    add('simulink/Sources/In1',  'Isp',   [20  90  50 104]);
    add('simulink/Sources/In1',  'OutEn', [20 160  50 174]);

    % --- First-order channel helper realised inline for V and I ---
    chan = @(tag, top) buildFirstOrder(modelName, tag, top, p.response);
    chan('V', 20);   % gateV, errV, gainV, sumV, udV  -> node <V>
    chan('I', 90);

    add('simulink/Math Operations/Product', 'PowerMul', [360 55 390 95]);
    add('simulink/Sinks/Out1', 'Power', [620 70 650 84]);
    add('simulink/Sinks/Out1', 'V',     [620 18 650 32]);
    add('simulink/Sinks/Out1', 'I',     [620 118 650 132]);

    % --- Temperature channel ---
    add('simulink/Math Operations/Gain',     'GainTG',   [430  60 470  90], 'Gain', num2str(p.thermal_gain));
    add('simulink/Sources/Constant',         'Ambient',  [430 200 470 220], 'Value', num2str(p.ambient_c));
    add('simulink/Math Operations/Sum',      'TempErr',  [500 150 520 200], 'Inputs', '+-');
    add('simulink/Math Operations/Gain',     'GainCool', [540 155 580 185], 'Gain', num2str(p.cooling));
    add('simulink/Math Operations/Sum',      'TempSum',  [600 120 620 180], 'Inputs', '++-');
    add('simulink/Discrete/Unit Delay',      'udT',      [600 230 630 260], 'InitialCondition', num2str(p.ambient_c));
    add('simulink/Sinks/Out1', 'Tj', [700 140 730 154]);

    % --- Wiring: inputs into the channel gates ---
    add_line(modelName, 'Vsp/1',   'gateV/1', 'autorouting', 'on');
    add_line(modelName, 'OutEn/1', 'gateV/2', 'autorouting', 'on');
    add_line(modelName, 'Isp/1',   'gateI/1', 'autorouting', 'on');
    add_line(modelName, 'OutEn/1', 'gateI/2', 'autorouting', 'on');

    % --- Power = V * I (new values are the channel sum outputs) ---
    add_line(modelName, 'sumV/1', 'PowerMul/1', 'autorouting', 'on');
    add_line(modelName, 'sumI/1', 'PowerMul/2', 'autorouting', 'on');
    add_line(modelName, 'sumV/1', 'V/1', 'autorouting', 'on');
    add_line(modelName, 'sumI/1', 'I/1', 'autorouting', 'on');
    add_line(modelName, 'PowerMul/1', 'Power/1', 'autorouting', 'on');

    % --- Temperature recurrence ---
    add_line(modelName, 'PowerMul/1', 'GainTG/1',  'autorouting', 'on');
    add_line(modelName, 'udT/1',      'TempErr/1', 'autorouting', 'on');
    add_line(modelName, 'Ambient/1',  'TempErr/2', 'autorouting', 'on');
    add_line(modelName, 'TempErr/1',  'GainCool/1','autorouting', 'on');
    add_line(modelName, 'udT/1',      'TempSum/1', 'autorouting', 'on');
    add_line(modelName, 'GainTG/1',   'TempSum/2', 'autorouting', 'on');
    add_line(modelName, 'GainCool/1', 'TempSum/3', 'autorouting', 'on');
    add_line(modelName, 'TempSum/1',  'udT/1',     'autorouting', 'on');
    add_line(modelName, 'TempSum/1',  'Tj/1',      'autorouting', 'on');

    % --- Discrete fixed-step solver, 1 tick per step, 60-tick run ---
    set_param(modelName, 'Solver', 'FixedStepDiscrete', 'FixedStep', '1', ...
        'StartTime', '0', 'StopTime', '59');
    save_system(modelName);
    fprintf('Built %s.slx\n', modelName);
end

function buildFirstOrder(modelName, tag, top, response)
%BUILDFIRSTORDER Add gate<tag>, err<tag>, gain<tag>, sum<tag>, ud<tag>.
%   Realises x[k] = x[k-1] + response*(gatedTarget - x[k-1]).
    add = @(type, name, pos, varargin) add_block(type, [modelName '/' name], ...
        'Position', pos, varargin{:});
    add('simulink/Math Operations/Product', ['gate' tag], [90  top    120 top+30]);
    add('simulink/Math Operations/Sum',     ['err'  tag], [160 top    180 top+40], 'Inputs', '+-');
    add('simulink/Math Operations/Gain',    ['gain' tag], [210 top    250 top+30], 'Gain', num2str(response));
    add('simulink/Math Operations/Sum',     ['sum'  tag], [290 top    310 top+40], 'Inputs', '++');
    add('simulink/Discrete/Unit Delay',     ['ud'   tag], [290 top+60 320 top+90], 'InitialCondition', '0');

    add_line(modelName, ['gate' tag '/1'], ['err' tag '/1'], 'autorouting', 'on');
    add_line(modelName, ['ud'   tag '/1'], ['err' tag '/2'], 'autorouting', 'on');
    add_line(modelName, ['err'  tag '/1'], ['gain' tag '/1'], 'autorouting', 'on');
    add_line(modelName, ['ud'   tag '/1'], ['sum' tag '/1'], 'autorouting', 'on');
    add_line(modelName, ['gain' tag '/1'], ['sum' tag '/2'], 'autorouting', 'on');
    add_line(modelName, ['sum'  tag '/1'], ['ud'  tag '/1'], 'autorouting', 'on');
end
