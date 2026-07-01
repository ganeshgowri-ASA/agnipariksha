function out = psu_rest(action, baseUrl, payload)
%PSU_REST Minimal REST client for the Agnipariksha OPC UA PSU proxy.
%   s  = psu_rest('get', baseUrl)             -> struct of PSU state (throws on failure)
%   s  = psu_rest('get_safe', baseUrl)        -> struct, or [] on failure (never throws)
%   ok = psu_rest('set', baseUrl, setpoint)   -> true on success
%   h  = psu_rest('health', baseUrl)          -> true if backend /health ok
%
%   baseUrl defaults to 'http://localhost:8000' (the FastAPI backend). The
%   endpoints are served by backend/app/opcua_api.py:
%       GET  /api/opcua/psu            -> {voltage_v,current_a,power_w,
%                                          temperature_c,model,mode,writable_nodes}
%       POST /api/opcua/psu/setpoints  <- {voltage_v,current_a,output_enabled}
%   SETPOINT is a struct: struct('voltage_v',48,'current_a',2,'output_enabled',true).
%
%   Used by AgniparikshaConsole and deployable to MATLAB Web App Server.
%
%   Portability note (found by executing this file under GNU Octave against
%   a live backend): Octave's webread returns raw JSON text instead of an
%   auto-decoded struct, and Octave's webwrite (confirmed from its own
%   source, /usr/share/octave/*/m/web/webwrite.m) only implements
%   application/x-www-form-urlencoded bodies, not raw JSON — a structural
%   Octave limitation, not a MATLAB one. decodeIfJsonText() below normalises
%   get/get_safe/health across both interpreters (verified live: health,
%   get and get_safe round-tripped correctly against a running backend
%   under Octave). 'set' uses the MathWorks-documented JSON-POST idiom
%   (jsonencode + weboptions MediaType 'application/json') and is correct,
%   idiomatic MATLAB; its exact byte payload was independently verified
%   against the live backend (curl) and accepted (HTTP 200, DEMO simulator
%   converged) — only Octave's own webwrite transport could not carry it.

    if nargin < 2 || isempty(baseUrl), baseUrl = 'http://localhost:8000'; end
    opts = weboptions('Timeout', 5, 'ContentType', 'json', ...
                      'MediaType', 'application/json');

    switch lower(action)
        case 'get'
            out = decodeIfJsonText(webread([baseUrl '/api/opcua/psu'], opts));

        case 'get_safe'
            try
                out = decodeIfJsonText(webread([baseUrl '/api/opcua/psu'], opts));
            catch
                out = [];
            end

        case 'set'
            out = true;
            try
                % Pre-encode to JSON text: MATLAB's webwrite auto-encodes a
                % struct DATA argument, but Octave's requires DATA to already
                % be a string. A pre-encoded JSON string is accepted as-is by
                % both (MATLAB does not double-encode an already-char DATA).
                webwrite([baseUrl '/api/opcua/psu/setpoints'], jsonencode(payload), opts);
            catch
                out = false;
            end

        case 'health'
            out = false;
            try
                h = decodeIfJsonText(webread([baseUrl '/health'], opts));
                out = (isfield(h, 'status') && strcmpi(h.status, 'ok')) ...
                      || (isfield(h, 'ok') && isequal(h.ok, true));
            catch
                out = false;
            end

        otherwise
            error('psu_rest:badAction', 'unknown action "%s"', action);
    end
end

function s = decodeIfJsonText(r)
%DECODEIFJSONTEXT Normalise webread's result to a struct.
%   MATLAB's webread auto-decodes application/json into a struct. GNU
%   Octave's webread returns the raw JSON text as a char instead — decode
%   it explicitly so the rest of this file (and every caller) sees the same
%   struct contract regardless of interpreter.
    if ischar(r) || (isstring(r) && isscalar(r))
        s = jsondecode(char(r));
    else
        s = r;
    end
end
