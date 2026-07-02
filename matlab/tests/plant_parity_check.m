function ok = plant_parity_check()
%PLANT_PARITY_CHECK Execute the DC-PSU plant model and verify it matches the
%   Python-generated matlab/reference_trace.csv to within 1e-3.
%
%   Runs in BOTH MATLAB and GNU Octave (CI executes it headless under
%   octave-cli), so the MATLAB plant code is actually exercised, not just
%   eyeballed. Calls the real psu_plant_defaults / psu_plant_step.

    here = fileparts(mfilename('fullpath'));
    addpath(fullfile(here, '..'));   % psu_plant_defaults.m / psu_plant_step.m

    p = psu_plant_defaults();
    state = struct('v', 0.0, 'i', 0.0, 'temp_c', p.ambient_c);

    N = 60; onTicks = 30;
    results = zeros(N, 5);
    for tick = 0:N-1
        on = tick < onTicks;
        sp = struct('output_enabled', on, 'voltage_v', 48.0*on, 'current_a', 2.0*on);
        [state, r] = psu_plant_step(state, sp, p);
        results(tick+1, :) = [tick, r.voltage_v, r.current_a, r.power_w, r.temperature_c];
    end

    csvPath = fullfile(here, '..', 'reference_trace.csv');
    ref = dlmread(csvPath, ',', 1, 0);          % skip the header row
    maxErr = max(max(abs(results(:, 2:5) - ref(:, 2:5))));

    fprintf('ticks=%d  maxAbsDiff=%.3e\n', N, maxErr);
    ok = maxErr < 1e-3;
    if ok
        disp('PASS: MATLAB/Octave plant matches Python reference_trace.csv');
    else
        error('plant_parity_check:diverged', ...
              'FAIL: plant diverges from reference (%.3e >= 1e-3)', maxErr);
    end
end
