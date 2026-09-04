; ==============================================================================
; NIM AGENT — Production Inno Setup Script
; Generates single-click NIM_Agent_Setup.exe with zero SmartScreen elevation warnings.
; ==============================================================================

#define MyAppName "NIM AGENT"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Mohammed Ali"
#define MyAppURL "https://github.com/mohammedila812-NIM/NIM_AGENT"
#define MyAppExeName "NIM_Agent.exe"

[Setup]
; Basic Application Metadata
AppId={{D37F8E45-8A1C-4B90-93C2-56D1F9E3B87A}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}

; Consumer-grade per-user installation (Zero UAC Admin prompt required)
DefaultDirName={userlocalappdata}\NIM_Agent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Output Configuration
OutputDir=..\dist_installer
OutputBaseFilename=NIM_Agent_Setup
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern

; Visual & Architecture Settings
ArchitecturesInstallIn64BitMode=x64compatible
DisableWelcomePage=no
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "autostart"; Description: "Start NIM AGENT automatically when Windows starts"; GroupDescription: "Startup Options:"; Flags: checkedonce

[Files]
; Standalone frozen application files
Source: "..\desktop\dist\NIM_Agent\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--tray"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--tray"; Tasks: desktopicon

[Registry]
; 1. Auto-start with Windows on user logon
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "NIM_Agent"; ValueData: """{app}\{#MyAppExeName}"" --tray"; Tasks: autostart; Flags: uninsdeletevalue

; 2. Native Messaging Host Registration for Google Chrome
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.nim_agent.desktop"; ValueType: string; ValueName: ""; ValueData: "{app}\manifest.json"; Flags: uninsdeletekey

; 3. Native Messaging Host Registration for Microsoft Edge
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\com.nim_agent.desktop"; ValueType: string; ValueName: ""; ValueData: "{app}\manifest.json"; Flags: uninsdeletekey

[Run]
; Launch onboarding wizard upon installation completion
Filename: "{app}\{#MyAppExeName}"; Parameters: "--onboarding"; Description: "Launch NIM AGENT Setup & Onboarding Wizard"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Clean up local runtime snapshots, cache, and logs on uninstall
Type: filesandordirs; Name: "{userprofile}\.nim_jarvis"
Type: filesandordirs; Name: "{app}"
