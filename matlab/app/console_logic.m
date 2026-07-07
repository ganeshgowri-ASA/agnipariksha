function varargout = console_logic(fn, varargin)
%CONSOLE_LOGIC Pure (no-UI) logic behind AgniparikshaConsole, dispatched by name.
%   Kept UI-free — like frontend/features/opcua/psuClient.ts on the web side —
%   so it can be exercised headlessly (MATLAB or GNU Octave), without a
%   uifigure. AgniparikshaConsole.m calls these instead of duplicating logic
%   inline; this file is the single source of truth for console math/rules.
%
%   console_logic('clamp', x, lo, hi)              -> clamped double
%   console_logic('mode_color', mode)               -> 1x3 RGB
%   console_logic('validate_setpoint', v, i)        -> cellstr of errors ({} = valid)
%   console_logic('is_setpoint_valid', v, i)        -> logical
%
%   Setpoint bounds mirror backend/app/opcua_api.py::SetpointsIn and
%   frontend/features/opcua/psuClient.ts::SETPOINT_LIMITS exactly:
%     voltage_v in [0, 1000],  current_a in [0, 100]

    switch fn
        case 'clamp'
            varargout{1} = clampToRange(varargin{1}, varargin{2}, varargin{3});
        case 'mode_color'
            varargout{1} = modeColor(varargin{1});
        case 'validate_setpoint'
            varargout{1} = validateSetpoint(varargin{1}, varargin{2});
        case 'is_setpoint_valid'
            varargout{1} = isempty(validateSetpoint(varargin{1}, varargin{2}));
        otherwise
            error('console_logic:badFn', 'unknown function "%s"', fn);
    end
end

function v = clampToRange(x, lo, hi)
    if isnan(x) || isempty(x)
        v = lo;
        return;
    end
    v = min(max(x, lo), hi);
end

function c = modeColor(mode)
    % char() (not string()) for MATLAB/Octave portability.
    if strcmpi(char(mode), 'LIVE')
        c = [0.85 0.20 0.25];
    else
        c = [0.18 0.80 0.44];
    end
end

function errs = validateSetpoint(voltage_v, current_a)
    errs = {};
    if ~(isnumeric(voltage_v) && isscalar(voltage_v) && isfinite(voltage_v) ...
            && voltage_v >= 0 && voltage_v <= 1000)
        errs{end+1} = 'Voltage setpoint must be 0-1000 V.';
    end
    if ~(isnumeric(current_a) && isscalar(current_a) && isfinite(current_a) ...
            && current_a >= 0 && current_a <= 100)
        errs{end+1} = 'Current setpoint must be 0-100 A.';
    end
end
