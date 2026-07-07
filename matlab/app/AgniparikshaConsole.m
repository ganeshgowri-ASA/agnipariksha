classdef AgniparikshaConsole < matlab.apps.AppBase
%AGNIPARIKSHACONSOLE MATLAB App Designer console for the Agnipariksha DC PSU.
%   Reproduces the web console (overview + PSU control) as a MATLAB App
%   Designer app that talks to the FastAPI backend over REST:
%       GET  /api/opcua/psu            (telemetry, polled every second)
%       POST /api/opcua/psu/setpoints  (operator setpoints)
%
%   Run locally:   app = AgniparikshaConsole;   (backend on :8000)
%   Deploy:        package with build_webapp.m for MATLAB Web App Server.
%
%   This is the App-Designer code-behind, hand-authored as a .m classdef so
%   it is source-controllable and reviewable. Open it in App Designer with
%   `appdesigner AgniparikshaConsole.m` or run it directly.
%
%   All non-UI logic (gauge clamping, mode color, setpoint bounds) lives in
%   console_logic.m so it can be exercised headlessly in tests/ (this class
%   itself needs uifigure, i.e. genuine MATLAB). The Write button mirrors
%   the web dashboard's OpcuaPsuPanel: disabled while the setpoint is out of
%   bounds ([0,1000] V, [0,100] A), enabled live as the operator edits.
%
%   SAFETY: the Output switch only writes a setpoint to the backend, which
%   in DEMO mode drives a simulator. LIVE energization stays gated server-
%   side (owner-at-bench + E-stop) — this console never bypasses that.

    properties (Access = public)
        UIFigure        matlab.ui.Figure
        OuterGrid       matlab.ui.container.GridLayout
        HeaderGrid      matlab.ui.container.GridLayout
        TitleLabel      matlab.ui.control.Label
        SubtitleLabel   matlab.ui.control.Label
        BaseUrlField    matlab.ui.control.EditField
        ModeLamp        matlab.ui.control.Lamp
        ModeLabel       matlab.ui.control.Label
        HealthLamp      matlab.ui.control.Lamp
        HealthLabel     matlab.ui.control.Label
        TabGroup        matlab.ui.container.TabGroup
        PsuTab          matlab.ui.container.Tab
        OverviewTab     matlab.ui.container.Tab
        % PSU tab
        VGauge          matlab.ui.control.Gauge
        IGauge          matlab.ui.control.Gauge
        PGauge          matlab.ui.control.Gauge
        TGauge          matlab.ui.control.Gauge
        VSpinner        matlab.ui.control.Spinner
        ISpinner        matlab.ui.control.Spinner
        OutputSwitch    matlab.ui.control.Switch
        WriteButton     matlab.ui.control.Button
        StatusLabel     matlab.ui.control.Label
        % Overview tab
        EquipmentTable  matlab.ui.control.Table
    end

    properties (Access = private)
        PollTimer   % periodic telemetry poll
    end

    % ---- REST helpers (delegate to psu_rest.m so logic is shared) --------
    methods (Access = private)
        function url = baseUrl(app)
            url = strtrim(app.BaseUrlField.Value);
            if isempty(url), url = 'http://localhost:8000'; end
        end

        function pollOnce(app)
            try
                s = psu_rest('get', app.baseUrl());
                app.VGauge.Value = console_logic('clamp', s.voltage_v, app.VGauge.Limits(1), app.VGauge.Limits(2));
                app.IGauge.Value = console_logic('clamp', s.current_a, app.IGauge.Limits(1), app.IGauge.Limits(2));
                app.PGauge.Value = console_logic('clamp', s.power_w,   app.PGauge.Limits(1), app.PGauge.Limits(2));
                app.TGauge.Value = console_logic('clamp', s.temperature_c, app.TGauge.Limits(1), app.TGauge.Limits(2));
                app.ModeLabel.Text = sprintf('%s · %s', char(s.model), char(s.mode));
                app.ModeLamp.Color = console_logic('mode_color', s.mode);
                app.HealthLamp.Color = [0.18 0.80 0.44];
                app.HealthLabel.Text = 'backend: connected';
            catch
                app.HealthLamp.Color = [0.85 0.20 0.25];
                app.HealthLabel.Text = 'backend: unreachable';
            end
        end

        % Live-validates the spinners on every edit — mirrors the web
        % dashboard's OpcuaPsuPanel, which disables Write until valid.
        function onSetpointChanged(app)
            valid = console_logic('is_setpoint_valid', app.VSpinner.Value, app.ISpinner.Value);
            app.WriteButton.Enable = valid;
            if ~valid
                errs = console_logic('validate_setpoint', app.VSpinner.Value, app.ISpinner.Value);
                app.StatusLabel.Text = strjoin(errs, ' ');
                app.StatusLabel.FontColor = [0.85 0.20 0.25];
            else
                app.StatusLabel.Text = 'Ready to write.';
                app.StatusLabel.FontColor = [0.7 0.7 0.75];
            end
        end

        function onWrite(app)
            v = app.VSpinner.Value; i = app.ISpinner.Value;
            if ~console_logic('is_setpoint_valid', v, i)
                app.onSetpointChanged();  % re-assert the guard; button should already be disabled
                return;
            end
            sp = struct('voltage_v', v, 'current_a', i, ...
                        'output_enabled', strcmp(app.OutputSwitch.Value, 'ON'));
            ok = psu_rest('set', app.baseUrl(), sp);
            if ok
                app.StatusLabel.Text = sprintf('Wrote setpoints: %.3g V, %.3g A, output %s', ...
                    sp.voltage_v, sp.current_a, app.OutputSwitch.Value);
                app.StatusLabel.FontColor = [0.18 0.80 0.44];
            else
                app.StatusLabel.Text = 'Write failed — backend unreachable.';
                app.StatusLabel.FontColor = [0.85 0.20 0.25];
            end
        end
    end

    % ---- Component construction -----------------------------------------
    methods (Access = private)
        function createComponents(app)
            app.UIFigure = uifigure('Visible', 'off', 'Name', 'Agnipariksha — DC Power Supply Console');
            app.UIFigure.Position = [100 100 760 560];
            app.UIFigure.Color = [0.07 0.07 0.09];

            app.OuterGrid = uigridlayout(app.UIFigure, [2 1]);
            app.OuterGrid.RowHeight = {70, '1x'};
            app.OuterGrid.BackgroundColor = [0.07 0.07 0.09];

            buildHeader(app);

            app.TabGroup = uitabgroup(app.OuterGrid);
            app.TabGroup.Layout.Row = 2;
            app.PsuTab = uitab(app.TabGroup, 'Title', 'PSU Console');
            app.OverviewTab = uitab(app.TabGroup, 'Title', 'Overview');
            buildPsuTab(app);
            buildOverviewTab(app);

            app.UIFigure.Visible = 'on';
        end

        function buildHeader(app)
            app.HeaderGrid = uigridlayout(app.OuterGrid, [2 4]);
            app.HeaderGrid.Layout.Row = 1;
            app.HeaderGrid.RowHeight = {'1x', '1x'};
            app.HeaderGrid.ColumnWidth = {'1x', 160, 130, 130};
            app.HeaderGrid.BackgroundColor = [0.07 0.07 0.09];

            app.TitleLabel = uilabel(app.HeaderGrid, 'Text', 'Agnipariksha — DC Power Supply Console');
            app.TitleLabel.Layout.Row = 1; app.TitleLabel.Layout.Column = 1;
            app.TitleLabel.FontSize = 16; app.TitleLabel.FontWeight = 'bold';
            app.TitleLabel.FontColor = [0.96 0.78 0.20];

            app.SubtitleLabel = uilabel(app.HeaderGrid, 'Text', 'Shreshtata Power Supplies · ITECH PV6000');
            app.SubtitleLabel.Layout.Row = 2; app.SubtitleLabel.Layout.Column = 1;
            app.SubtitleLabel.FontColor = [0.6 0.6 0.65];

            app.BaseUrlField = uieditfield(app.HeaderGrid, 'text', 'Value', 'http://localhost:8000');
            app.BaseUrlField.Layout.Row = 1; app.BaseUrlField.Layout.Column = 2;

            app.ModeLamp = uilamp(app.HeaderGrid); app.ModeLamp.Layout.Row = 1; app.ModeLamp.Layout.Column = 3;
            app.ModeLamp.Color = [0.4 0.4 0.45];
            app.ModeLabel = uilabel(app.HeaderGrid, 'Text', 'mode —');
            app.ModeLabel.Layout.Row = 2; app.ModeLabel.Layout.Column = 3;
            app.ModeLabel.FontColor = [0.8 0.8 0.85];

            app.HealthLamp = uilamp(app.HeaderGrid); app.HealthLamp.Layout.Row = 1; app.HealthLamp.Layout.Column = 4;
            app.HealthLamp.Color = [0.4 0.4 0.45];
            app.HealthLabel = uilabel(app.HeaderGrid, 'Text', 'backend: —');
            app.HealthLabel.Layout.Row = 2; app.HealthLabel.Layout.Column = 4;
            app.HealthLabel.FontColor = [0.8 0.8 0.85];
        end

        function buildPsuTab(app)
            g = uigridlayout(app.PsuTab, [3 4]);
            g.RowHeight = {'1x', 90, 32};
            g.BackgroundColor = [0.09 0.09 0.11];

            app.VGauge = makeGauge(g, 'Voltage (V)', 0, 100,  1, 1);
            app.IGauge = makeGauge(g, 'Current (A)', 0, 20,   1, 2);
            app.PGauge = makeGauge(g, 'Power (W)',   0, 2000, 1, 3);
            app.TGauge = makeGauge(g, 'Tj (°C)',     0, 150,  1, 4);

            sp = uigridlayout(g, [1 4]); sp.Layout.Row = 2; sp.Layout.Column = [1 4];
            sp.ColumnWidth = {'1x','1x','1x','1x'}; sp.BackgroundColor = [0.09 0.09 0.11];

            app.VSpinner = uispinner(sp, 'Limits', [0 1000], 'Value', 0, 'Step', 0.5, ...
                'ValueChangedFcn', @(~,~) app.onSetpointChanged());
            app.VSpinner.Layout.Column = 1; labelFor(app.VSpinner, 'V setpoint');
            app.ISpinner = uispinner(sp, 'Limits', [0 100], 'Value', 0, 'Step', 0.1, ...
                'ValueChangedFcn', @(~,~) app.onSetpointChanged());
            app.ISpinner.Layout.Column = 2; labelFor(app.ISpinner, 'I setpoint');
            app.OutputSwitch = uiswitch(sp, 'slider', 'Items', {'OFF','ON'}, 'Value', 'OFF');
            app.OutputSwitch.Layout.Column = 3;
            app.WriteButton = uibutton(sp, 'Text', 'Write setpoints', ...
                'ButtonPushedFcn', @(~,~) app.onWrite());
            app.WriteButton.Layout.Column = 4;
            app.WriteButton.BackgroundColor = [0.96 0.78 0.20];

            app.StatusLabel = uilabel(g, 'Text', 'Idle.');
            app.StatusLabel.Layout.Row = 3; app.StatusLabel.Layout.Column = [1 4];
            app.StatusLabel.FontColor = [0.7 0.7 0.75];
        end

        function buildOverviewTab(app)
            g = uigridlayout(app.OverviewTab, [2 1]);
            g.RowHeight = {110, '1x'}; g.BackgroundColor = [0.09 0.09 0.11];

            kpiG = uigridlayout(g, [1 4]); kpiG.Layout.Row = 1;
            kpiG.BackgroundColor = [0.09 0.09 0.11];
            kpiTile(kpiG, 1, 'Tests today', '7');
            kpiTile(kpiG, 2, 'Pass rate', '92%');
            kpiTile(kpiG, 3, 'Mean run time', '184 min');
            kpiTile(kpiG, 4, 'Fleet MTBF', '1,420 h');

            app.EquipmentTable = uitable(g);
            app.EquipmentTable.Layout.Row = 2;
            app.EquipmentTable.ColumnName = {'Equipment','Status','Detail'};
            app.EquipmentTable.Data = {
                'ITECH PV6000 #1','ok','idle, 24.1 °C';
                'ITECH PV6000 #2','warn','fan rpm 2160 (low)';
                'TC Chamber','ok','-40 -> +85 °C, cycle 87';
                'HF Chamber','ok','85% RH stable';
                'Keysight DMM','ok','last cal 12 d ago';
                'Solar Simulator','fault','lamp hours 1980 (>1800)'};
            app.EquipmentTable.ColumnWidth = {160, 70, '1x'};
        end
    end

    % ---- Lifecycle ------------------------------------------------------
    methods (Access = private)
        function startupFcn(app)
            app.pollOnce();
            app.PollTimer = timer('ExecutionMode','fixedSpacing','Period',1, ...
                'TimerFcn', @(~,~) app.pollOnce());
            start(app.PollTimer);
        end
    end

    methods (Access = public)
        function app = AgniparikshaConsole
            createComponents(app);
            registerApp(app, app.UIFigure);
            runStartupFcn(app, @startupFcn);
            if nargout == 0, clear app; end
        end

        function delete(app)
            try
                if ~isempty(app.PollTimer) && isvalid(app.PollTimer)
                    stop(app.PollTimer); delete(app.PollTimer);
                end
            catch
            end
            delete(app.UIFigure);
        end
    end
end

% ---- Local helper functions --------------------------------------------
function gauge = makeGauge(parent, ttl, lo, hi, row, col)
    sub = uigridlayout(parent, [2 1]); sub.Layout.Row = row; sub.Layout.Column = col;
    sub.RowHeight = {'1x', 18}; sub.BackgroundColor = [0.09 0.09 0.11];
    gauge = uigauge(sub, 'circular', 'Limits', [lo hi]); gauge.Layout.Row = 1;
    lbl = uilabel(sub, 'Text', ttl, 'HorizontalAlignment', 'center');
    lbl.Layout.Row = 2; lbl.FontColor = [0.75 0.75 0.8];
end

function labelFor(comp, txt)
    comp.Tooltip = txt;
end

function kpiTile(parent, col, label, value)
    t = uigridlayout(parent, [2 1]); t.Layout.Column = col;
    t.RowHeight = {18, '1x'}; t.BackgroundColor = [0.05 0.05 0.07];
    l1 = uilabel(t, 'Text', upper(label)); l1.Layout.Row = 1;
    l1.FontSize = 9; l1.FontColor = [0.55 0.55 0.6];
    l2 = uilabel(t, 'Text', value); l2.Layout.Row = 2;
    l2.FontSize = 22; l2.FontWeight = 'bold'; l2.FontColor = [1 1 1];
end
