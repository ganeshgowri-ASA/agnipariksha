function build_webapp(outDir)
%BUILD_WEBAPP Package AgniparikshaConsole for MATLAB Web App Server.
%   Produces a Web App archive (.ctf) you can host on MATLAB Web App
%   Server so the console runs in a browser. Requires MATLAB Compiler.
%
%   build_webapp()         -> writes to ./webapp_build
%   build_webapp(outDir)   -> writes to outDir
%
%   Deploy: copy the generated AgniparikshaConsole.ctf into the Web App
%   Server apps directory (e.g. C:\MATLAB\webapps\apps) or upload it from
%   the Web App Server home page. The app's REST calls (psu_rest.m) reach
%   the FastAPI backend at the Base URL field — point it at the host running
%   uvicorn :8000 (reachable from the Web App Server machine).

    if nargin < 1 || isempty(outDir), outDir = fullfile(pwd, 'webapp_build'); end
    here = fileparts(mfilename('fullpath'));

    results = compiler.build.webAppArchive( ...
        fullfile(here, 'AgniparikshaConsole.m'), ...
        'ArchiveName', 'AgniparikshaConsole', ...
        'OutputDir', outDir, ...
        'AdditionalFiles', {fullfile(here, 'psu_rest.m')});

    disp(results);
    fprintf('Web App archive written to %s\n', outDir);
end
