function package_app(outDir)
%PACKAGE_APP Package AgniparikshaConsole as a standalone desktop app.
%   Produces an .mlappinstall — MATLAB's installable desktop app format —
%   so the console can be shared and installed into another user's Apps
%   gallery (Apps tab > Install App) without opening the source directly.
%   Complements build_webapp.m, which instead targets browser-hosted MATLAB
%   Web App Server.
%
%   SCAFFOLD, unverified: matlab.apputil is a MATLAB-only namespace with no
%   GNU Octave equivalent (confirmed: exist('matlab.apputil.create') == 0
%   in Octave), so — unlike this repo's other MATLAB sources — this script
%   could not be executed anywhere in this environment, not even partially.
%   The AppinfoClass property names below (AppName/Summary/Description/
%   AdditionalFiles) match the documented matlab.apputil.create workflow,
%   but property names have shifted across MATLAB releases; run this once
%   and cross-check against `doc matlab.apputil.AppinfoClass` for your
%   release before relying on it.
%
%   package_app()         -> writes to ./app_build
%   package_app(outDir)   -> writes to outDir

    if nargin < 1 || isempty(outDir), outDir = fullfile(pwd, 'app_build'); end
    here = fileparts(mfilename('fullpath'));
    if ~isfolder(outDir), mkdir(outDir); end

    info = matlab.apputil.create('AgniparikshaConsole');
    info.MainFileName = fullfile(here, 'AgniparikshaConsole.m');
    info.AppName = 'AgniparikshaConsole';
    info.Summary = 'Agnipariksha DC Power Supply Console';
    info.Description = ['Live App Designer console for the Agnipariksha ' ...
        'DC power-supply app, talking to the FastAPI/OPC UA backend over REST.'];
    info.AdditionalFiles = {fullfile(here, 'psu_rest.m'), fullfile(here, 'console_logic.m')};

    matlab.apputil.package(info, 'OutputDir', outDir);
    fprintf('Packaged AgniparikshaConsole.mlappinstall to %s\n', outDir);
    fprintf('Install: double-click the .mlappinstall, or in MATLAB: matlab.apputil.install(...)\n');
end
