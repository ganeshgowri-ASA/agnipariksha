function RUN_ME()
%RUN_ME Agnipariksha DC Power Supply — MATLAB / Simulink app entry point.
%   One place that wires the path and launches any surface of the MATLAB
%   app. Start the backend first (DEMO mode, no hardware):
%
%       uvicorn backend.main:app --port 8000
%
%   Surfaces:
%     1  App Designer console   app/AgniparikshaConsole.m   (live GUI)
%     2  Simulink live console  simulink/build_psu_console_model.m  (HMI)
%     3  Simulink plant model   build_psu_plant_model.m      (simulation)
%
%   Backend interfaces:  app/psu_rest.m (REST),  psu_opcua_bridge.m (OPC UA),
%                        simulink/psu_live_interface.m (Simulink block).
%
%   Verify the model math WITHOUT a MATLAB license (also runs in GNU Octave):
%       run('tests/plant_parity_check.m')      % plant step model
%       run('tests/simulink_plant_parity.m')   % Simulink block design

    here = fileparts(mfilename('fullpath'));
    addpath(genpath(here));

    fprintf('\nAgnipariksha — DC Power Supply (MATLAB / Simulink)\n');
    fprintf('  1) App Designer console  (live GUI)\n');
    fprintf('  2) Simulink live console (HMI; backend must be up)\n');
    fprintf('  3) Simulink plant model  (offline simulation)\n');
    choice = input('Select [1-3], Enter = 1: ', 's');

    switch strtrim(choice)
        case {'', '1'}
            AgniparikshaConsole;
        case '2'
            build_psu_console_model;
        case '3'
            build_psu_plant_model;
        otherwise
            disp('Nothing launched.');
    end
end
