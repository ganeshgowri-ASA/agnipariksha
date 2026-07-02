// Scilab port of the DC-PSU plant parity check (see plant_parity_check.m).
//
// Third independent implementation of the plant recurrence (Python ->
// MATLAB/Octave -> Scilab), executed under Scilab against the same
// Python-generated reference_trace.csv, so the model math is confirmed
// engine-independent. Run headlessly with:
//   scilab-cli -nb -f matlab/tests/scilab_plant_parity.sce
// Exits 0 on PASS, 1 on divergence.

function y = roundTo(x, n)
    f = 10 ^ n;
    y = round(x * f) / f;
endfunction

// Plant parameters — MUST match psu_plant_defaults.m / DemoPsuSource.
response     = 0.35;
thermal_gain = 0.02;
cooling      = 0.05;
ambient_c    = 25.0;

v = 0.0; i = 0.0; temp_c = ambient_c;
N = 60; onTicks = 30;
results = zeros(N, 5);

for tick = 0:N-1
    on = bool2s(tick < onTicks);
    target_v = 48.0 * on;
    target_i = 2.0 * on;
    v = v + (target_v - v) * response;
    i = i + (target_i - i) * response;
    power = v * i;
    temp_c = temp_c + thermal_gain * power - cooling * (temp_c - ambient_c);
    results(tick+1, :) = [tick, roundTo(v,4), roundTo(i,4), roundTo(power,4), roundTo(temp_c,3)];
end

here = get_absolute_file_path("scilab_plant_parity.sce");
ref = csvRead(here + "../reference_trace.csv", ",", ".", "double", [], [], [], 1);

maxErr = max(abs(results(:, 2:5) - ref(:, 2:5)));
mprintf("scilab plant ticks=%d  maxAbsDiff=%.3e\n", N, maxErr);
if maxErr < 1e-3 then
    mprintf("PASS: Scilab plant matches the Python reference trace.\n");
    exit(0);
else
    mprintf("FAIL: Scilab plant diverges from reference (%.3e >= 1e-3)\n", maxErr);
    exit(1);
end
