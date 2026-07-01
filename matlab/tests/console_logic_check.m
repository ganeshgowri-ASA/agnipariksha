function ok = console_logic_check()
%CONSOLE_LOGIC_CHECK Execute console_logic.m assertions headlessly.
%   Runs in MATLAB and GNU Octave — no uifigure/App Designer needed, since
%   console_logic.m is UI-free by design. Mirrors the bounds asserted by
%   frontend/features/opcua/psuClient.test.ts on the web side.

    here = fileparts(mfilename('fullpath'));
    addpath(fullfile(here, '..', 'app'));

    n = 0;
    n = n + check(console_logic('clamp', 50, 0, 100) == 50,      'clamp: in-range passthrough');
    n = n + check(console_logic('clamp', -5, 0, 100) == 0,       'clamp: below lo clamps to lo');
    n = n + check(console_logic('clamp', 500, 0, 100) == 100,    'clamp: above hi clamps to hi');
    n = n + check(console_logic('clamp', NaN, 0, 100) == 0,      'clamp: NaN falls back to lo');

    n = n + check(isequal(console_logic('mode_color', 'DEMO'), [0.18 0.80 0.44]), 'mode_color: DEMO is green');
    n = n + check(isequal(console_logic('mode_color', 'LIVE'), [0.85 0.20 0.25]), 'mode_color: LIVE is red');
    n = n + check(isequal(console_logic('mode_color', 'live'), [0.85 0.20 0.25]), 'mode_color: case-insensitive');

    n = n + check(console_logic('is_setpoint_valid', 48, 2) == true,     'setpoint: 48V/2A valid');
    n = n + check(console_logic('is_setpoint_valid', 0, 0) == true,      'setpoint: 0/0 boundary valid');
    n = n + check(console_logic('is_setpoint_valid', 1000, 100) == true, 'setpoint: max boundary valid');
    n = n + check(console_logic('is_setpoint_valid', -1, 2) == false,    'setpoint: negative voltage invalid');
    n = n + check(console_logic('is_setpoint_valid', 48, 101) == false,  'setpoint: current over 100A invalid');
    n = n + check(numel(console_logic('validate_setpoint', -1, 101)) == 2, 'setpoint: both errors reported together');

    total = 13;
    fprintf('console_logic_check: %d/%d assertions passed\n', n, total);
    ok = (n == total);
    if ok
        disp('PASS: console_logic matches the documented contract.');
    else
        error('console_logic_check:failed', 'FAIL: %d/%d assertions passed', n, total);
    end
end

function r = check(cond, label)
    r = double(logical(cond));
    if ~r
        fprintf('  FAIL: %s\n', label);
    end
end
