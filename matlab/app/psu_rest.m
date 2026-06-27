function out = psu_rest(action, baseUrl, payload)
%PSU_REST Minimal REST client for the Agnipariksha OPC UA PSU proxy.
%   s  = psu_rest('get', baseUrl)             -> struct of PSU state
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

    if nargin < 2 || isempty(baseUrl), baseUrl = 'http://localhost:8000'; end
    opts = weboptions('Timeout', 5, 'ContentType', 'json', ...
                      'MediaType', 'application/json');

    switch lower(action)
        case 'get'
            out = webread([baseUrl '/api/opcua/psu'], opts);

        case 'set'
            out = true;
            try
                webwrite([baseUrl '/api/opcua/psu/setpoints'], payload, opts);
            catch
                out = false;
            end

        case 'health'
            out = false;
            try
                h = webread([baseUrl '/health'], opts);
                out = (isfield(h, 'status') && strcmpi(h.status, 'ok')) ...
                      || (isfield(h, 'ok') && isequal(h.ok, true));
            catch
                out = false;
            end

        otherwise
            error('psu_rest:badAction', 'unknown action "%s"', action);
    end
end
