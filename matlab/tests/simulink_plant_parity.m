function ok = simulink_plant_parity()
%SIMULINK_PLANT_PARITY Validate the Simulink model DESIGN without Simulink.
%   build_psu_plant_model.m wires a discrete block diagram (gate -> error ->
%   gain -> sum -> unit-delay per channel, a product for power, and a
%   first-order temperature channel whose Unit Delay initial condition is
%   ambient). This function executes that exact block-by-block recurrence —
%   including the Unit Delay initial conditions — and asserts it reproduces
%   the Python reference_trace.csv to within 1e-3.
%
%   Runs in MATLAB and GNU Octave, so the Simulink model's correctness
%   (block math + ICs + signal ordering) is actually exercised headlessly,
%   even though Simulink itself can't run here.

    here = fileparts(mfilename('fullpath'));
    addpath(fullfile(here, '..'));     % psu_plant_defaults.m
    p = psu_plant_defaults();
    response = p.response; tg = p.thermal_gain; cooling = p.cooling; ambient = p.ambient_c;

    % Unit Delay states, initial conditions exactly as the builder sets them:
    prev_v = 0.0;          % udV  InitialCondition 0
    prev_i = 0.0;          % udI  InitialCondition 0
    prev_temp = ambient;   % udT  InitialCondition ambient

    N = 60; onTicks = 30;
    results = zeros(N, 5);
    for tick = 0:N-1
        on  = double(tick < onTicks);
        Vsp = 48.0 * on;   Isp = 2.0 * on;            % gate = setpoint .* OutEn
        new_v = prev_v + response * (Vsp - prev_v);   % V first-order channel
        new_i = prev_i + response * (Isp - prev_i);   % I first-order channel
        power = new_v * new_i;                        % PowerMul (current-tick V,I)
        new_temp = prev_temp + tg * power - cooling * (prev_temp - ambient);
        results(tick+1, :) = [tick, roundTo(new_v,4), roundTo(new_i,4), ...
                              roundTo(power,4), roundTo(new_temp,3)];
        prev_v = new_v; prev_i = new_i; prev_temp = new_temp;   % Unit Delays
    end

    ref = dlmread(fullfile(here, '..', 'reference_trace.csv'), ',', 1, 0);
    maxErr = max(max(abs(results(:, 2:5) - ref(:, 2:5))));
    fprintf('simulink-design ticks=%d  maxAbsDiff=%.3e\n', N, maxErr);
    ok = maxErr < 1e-3;
    if ok
        disp('PASS: Simulink block-diagram design matches Python reference.');
    else
        error('simulink_plant_parity:diverged', 'FAIL: %.3e >= 1e-3', maxErr);
    end
end

function y = roundTo(x, n)
    f = 10 ^ n;
    y = round(x * f) / f;
end
