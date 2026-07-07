function data = psu_opcua_bridge(setpoint, opts)
%PSU_OPCUA_BRIDGE Connect MATLAB to the Agnipariksha PSU OPC UA server.
%   DATA = PSU_OPCUA_BRIDGE(SETPOINT, OPTS) connects to the asyncua server
%   from backend/app/opcua_server.py, optionally writes SETPOINT to the
%   Setpoints nodes, then reads back the Readings + Info nodes.
%
%   Requires the Industrial Communication Toolbox (the OPC UA client).
%
%   SETPOINT (optional) struct: voltage_v, current_a, output_enabled.
%            Omit or pass [] to read-only.
%   OPTS     (optional) struct:
%            url       - default 'opc.tcp://localhost:4840/agnipariksha/server'
%            username  - OPC UA username (omit for anonymous / open server)
%            password  - OPC UA password
%
%   DATA struct: voltage_v, current_a, power_w, temperature_c, model, mode.
%
%   Example (drive then read):
%       sp = struct('voltage_v',48,'current_a',2,'output_enabled',true);
%       o  = struct('username','operator','password','pv6000');
%       d  = psu_opcua_bridge(sp, o);

    if nargin < 1, setpoint = []; end
    if nargin < 2, opts = struct(); end
    if ~isfield(opts, 'url')
        opts.url = 'opc.tcp://localhost:4840/agnipariksha/server';
    end

    uaClient = opcua(opts.url);
    if isfield(opts, 'username') && ~isempty(opts.username)
        connect(uaClient, opts.username, opts.password);   % UserName token
    else
        connect(uaClient);                                  % anonymous
    end
    cleanup = onCleanup(@() disconnect(uaClient));

    find1 = @(name) findNodeByName(uaClient.Namespace, name, '-once');

    % --- Optionally command setpoints (only these nodes are writable) -------
    if ~isempty(setpoint)
        writeValue(uaClient, find1('Voltage_Setpoint_V'), double(setpoint.voltage_v));
        writeValue(uaClient, find1('Current_Setpoint_A'), double(setpoint.current_a));
        writeValue(uaClient, find1('Output_Enabled'),     logical(setpoint.output_enabled));
    end

    % --- Read telemetry + identity -----------------------------------------
    data.voltage_v     = readValue(uaClient, find1('Voltage_V'));
    data.current_a     = readValue(uaClient, find1('Current_A'));
    data.power_w       = readValue(uaClient, find1('Power_W'));
    data.temperature_c = readValue(uaClient, find1('Temperature_C'));
    data.model         = readValue(uaClient, find1('Model'));
    data.mode          = readValue(uaClient, find1('Mode'));
end
