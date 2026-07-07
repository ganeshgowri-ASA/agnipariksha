function [state, reading] = psu_plant_step(state, setpoint, p)
%PSU_PLANT_STEP Advance the first-order DC-PSU plant by one tick.
%   [STATE, READING] = PSU_PLANT_STEP(STATE, SETPOINT, P)
%
%   STATE    struct with full-precision fields: v, i, temp_c
%   SETPOINT struct with fields: voltage_v, current_a, output_enabled (logical)
%   P        parameters from PSU_PLANT_DEFAULTS
%
%   READING  struct with v/i/power/temperature rounded to the same decimal
%            places as the Python DemoPsuSource observable output, so a trace
%            of READINGs can be compared against matlab/reference_trace.csv.
%
%   The recurrence mirrors DemoPsuSource.read() exactly:
%       v    <- v + (target_v - v) * response
%       i    <- i + (target_i - i) * response
%       P    =  v * i
%       Tj   <- Tj + thermal_gain*P - cooling*(Tj - ambient)
%   Internal state stays full precision; only the reported READING is rounded.

    if setpoint.output_enabled
        target_v = setpoint.voltage_v;
        target_i = setpoint.current_a;
    else
        target_v = 0.0;
        target_i = 0.0;
    end

    state.v = state.v + (target_v - state.v) * p.response;
    state.i = state.i + (target_i - state.i) * p.response;
    power   = state.v * state.i;
    state.temp_c = state.temp_c + p.thermal_gain * power ...
                   - p.cooling * (state.temp_c - p.ambient_c);

    reading.voltage_v     = roundTo(state.v, 4);
    reading.current_a     = roundTo(state.i, 4);
    reading.power_w       = roundTo(power, 4);
    reading.temperature_c = roundTo(state.temp_c, 3);
end

function y = roundTo(x, n)
%ROUNDTO Round to N decimals. Portable across MATLAB and GNU Octave
%   (Octave's round() takes no second argument), so the cross-language
%   parity check can execute the model in either interpreter.
    f = 10 ^ n;
    y = round(x * f) / f;
end
