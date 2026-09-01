#ifndef PayloadDir
  #error PayloadDir must name the PyInstaller onedir folder.
#endif
#ifndef WebView2Bootstrapper
  #error WebView2Bootstrapper must name the Microsoft-signed bootstrapper.
#endif
#ifndef RuntimeLicenseFile
  #error RuntimeLicenseFile must name the bundled component license text.
#endif
#ifndef ProgramFilesInclude
  #error ProgramFilesInclude must name the generated program file list.
#endif
#ifndef AppVersion
  #define AppVersion "2.0.0"
#endif
#ifndef AppId
  #define AppId "SpinShareBrowser"
#endif
#ifndef AppName
  #define AppName "SpinShare Browser"
#endif
#ifndef StateDir
  #define StateDir "{localappdata}\SpinShareBrowser"
#endif
#ifndef InstallDir
  #define InstallDir "{localappdata}\Programs\SpinShareBrowser"
#endif
#ifndef ShortcutGroup
  #define ShortcutGroup AppName
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif
#ifndef SetupBaseName
  #define SetupBaseName "SpinShareBrowser-" + AppVersion + "-windows-x64-setup"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Liu Yishou
DefaultDirName={#InstallDir}
DefaultGroupName={#ShortcutGroup}
PrivilegesRequired=lowest
SetupArchitecture=x64
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
MinVersion=10.0.18362
UsePreviousAppDir=yes
UsePreviousLanguage=yes
UsePreviousTasks=yes
UninstallLogMode=append
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\SpinShareBrowser.exe
CloseApplications=no
RestartApplications=no
DisableProgramGroupPage=yes
AllowRootDirectory=no
AllowNetworkDrive=no
AllowUNCPath=no
SetupIconFile=..\assets\spinshare-browser.ico
LicenseFile={#RuntimeLicenseFile}
OutputDir={#OutputDir}
OutputBaseFilename={#SetupBaseName}
Compression=lzma2
SolidCompression=yes
MergeDuplicateFiles=yes
WizardStyle=modern dark includetitlebar hidebevels
WizardBackColor=#22272a

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "zh_CN"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Messages]
en.ConfirmUninstall={#AppName} and its settings, caches, and other local app data will be deleted. Charts you have downloaded or installed will be kept.
zh_CN.ConfirmUninstall=将删除 {#AppName} 程序及其设置、缓存等本地工具数据。您已下载或安装的谱面将保留。

[CustomMessages]
en.MaintenanceBusy={#AppName} is busy or is still closing. Finish any downloads, close the app from its tray menu, and try again.
zh_CN.MaintenanceBusy={#AppName} 正忙或正在退出。请等待下载完成，从托盘菜单退出工具，然后重试。
en.MaintenanceUnsafe=The app folders contain an unexpected path or file. Resolve the reported folder issue before continuing.
zh_CN.MaintenanceUnsafe=工具目录中存在异常路径或文件。请处理提示中的目录问题后重试。
en.MaintenanceIO=Some app files are in use or cannot be accessed. Close programs using these files and check folder permissions, then try again.
zh_CN.MaintenanceIO=部分工具文件被占用或无法访问。请关闭占用文件的程序，检查目录权限后重试。
en.MaintenanceFailed=The app could not finish preparing its files. Try again, or cancel and run Setup again.
zh_CN.MaintenanceFailed=工具文件准备失败。请重试，或取消后重新运行安装程序。
en.MaintenanceStartFailed=The app maintenance process could not start.
zh_CN.MaintenanceStartFailed=工具维护进程启动失败。
en.MaintenancePolicyBlocked=Windows application control blocked {#AppName} from starting. Share this error code with the developer.
zh_CN.MaintenancePolicyBlocked=Windows 应用控制阻止了 {#AppName} 启动。请向开发者提供此错误代码。
en.WindowsErrorCode=Windows error code: %1
zh_CN.WindowsErrorCode=Windows 错误代码：%1
en.MaintenanceGateBusy=Another setup, uninstall, or app startup is in progress. Wait for it to finish and try again.
zh_CN.MaintenanceGateBusy=其他安装、卸载或工具启动操作正在进行。请等待完成后重试。
en.MaintenanceGateFailed=Setup could not lock the app folders for maintenance.
zh_CN.MaintenanceGateFailed=安装程序无法锁定工具目录以进行维护。
en.PayloadFailed=Setup could not extract its application files. Run Setup again.
zh_CN.PayloadFailed=安装程序无法解压工具文件。请重新运行安装程序。
en.DotNetRequired=Microsoft .NET Framework 4.8 or later is required. Install Windows updates or enable .NET Framework, then run Setup again.
zh_CN.DotNetRequired=需要 Microsoft .NET Framework 4.8 或更高版本。请安装 Windows 更新或启用 .NET Framework，然后重新运行安装程序。
en.WebView2Required=Microsoft Edge WebView2 Runtime 123.0.2420.47 or later is required. Setup could not install or update it. Check your internet connection and try again, or use Microsoft's Evergreen Standalone Installer.
zh_CN.WebView2Required=需要 Microsoft Edge WebView2 Runtime 123.0.2420.47 或更高版本。安装或更新失败，请检查网络连接后重试，或使用微软 Evergreen 独立安装包。
en.PreparingFiles=Preparing app files...
zh_CN.PreparingFiles=正在准备工具文件...
en.InstallingWebView2=Installing or updating Microsoft Edge WebView2 Runtime...
zh_CN.InstallingWebView2=正在安装或更新 Microsoft Edge WebView2 Runtime...

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{tmp}\SpinShareBrowser"; Flags: dontcopy recursesubdirs
Source: "{#WebView2Bootstrapper}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#ShortcutGroup}\{#AppName}"; Filename: "{app}\SpinShareBrowser.exe"; WorkingDir: "{app}"; AppUserModelID: "{#AppId}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\SpinShareBrowser.exe"; WorkingDir: "{app}"; AppUserModelID: "{#AppId}"; Tasks: desktopicon

[Code]
const
  WaitObject = 0;
  WaitAbandoned = $80;
  WaitTimeout = $102;
  LcMapLowercase = $100;
  WebView2Key = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

type
  TProgramHandles = array of THandle;
  TProgramFileInformation = record
    Attributes: DWORD;
    CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh: DWORD;
    VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow: DWORD;
  end;
  TProgramFindData = record
    Attributes: DWORD;
    CreatedLow, CreatedHigh, AccessedLow, AccessedHigh, WrittenLow, WrittenHigh: DWORD;
    SizeHigh, SizeLow, Reserved0, Reserved1: DWORD;
    FileName: array[0..259] of Word;
    AlternateName: array[0..13] of Word;
  end;

var
  MaintenanceGate: THandle;
  GateOwned: Boolean;
  PayloadReady: Boolean;
  ProgramDirectories: TStringList;
  ProgramDirectoryHandles: TProgramHandles;

function CreateMutexW(Attributes: NativeUInt; InitialOwner: BOOL; Name: String): THandle;
  external 'CreateMutexW@kernel32.dll stdcall';
function WaitForSingleObject(Handle: THandle; Milliseconds: DWORD): DWORD;
  external 'WaitForSingleObject@kernel32.dll stdcall';
function ReleaseMutex(Handle: THandle): BOOL;
  external 'ReleaseMutex@kernel32.dll stdcall';
function CloseHandle(Handle: THandle): BOOL;
  external 'CloseHandle@kernel32.dll stdcall';
function LCMapStringEx(LocaleName: String; Flags: DWORD; Source: String;
  SourceLength: Integer; Destination: String; DestinationLength: Integer;
  VersionInformation, Reserved: NativeUInt; SortHandle: LPARAM): Integer;
  external 'LCMapStringEx@kernel32.dll stdcall';
function CreateFileW(Name: String; Access, Share: DWORD; Attributes: NativeUInt;
  Creation, Flags: DWORD; Template: THandle): THandle;
  external 'CreateFileW@kernel32.dll stdcall';
function GetFileInformationByHandle(Handle: THandle; var Information: TProgramFileInformation): BOOL;
  external 'GetFileInformationByHandle@kernel32.dll stdcall';
function FindFirstProgramFile(Name: String; var Data: TProgramFindData): THandle;
  external 'FindFirstFileW@kernel32.dll stdcall';
function FindNextProgramFile(Handle: THandle; var Data: TProgramFindData): BOOL;
  external 'FindNextFileW@kernel32.dll stdcall';
function CloseProgramFind(Handle: THandle): BOOL;
  external 'FindClose@kernel32.dll stdcall';

#include ProgramFilesInclude

procedure ReleaseProgramDirectories;
var
  Index: Integer;
begin
  for Index := GetArrayLength(ProgramDirectoryHandles) - 1 downto 0 do
    CloseHandle(ProgramDirectoryHandles[Index]);
  SetArrayLength(ProgramDirectoryHandles, 0);
  if ProgramDirectories <> nil then
  begin
    ProgramDirectories.Free;
    ProgramDirectories := nil;
  end;
end;

procedure ProgramFileError(const FileName: String; ErrorCode: Integer);
begin
  RaiseException(CustomMessage('MaintenanceIO') + #13#10 + FileName + #13#10 + SysErrorMessage(ErrorCode));
end;

function PinProgramDirectory(const Directory: String): Boolean;
var
  Parent: String;
  Handle: THandle;
  Information: TProgramFileInformation;
  ErrorCode, Count: Integer;
begin
  Result := False;
  if ProgramDirectories.IndexOf(Directory) >= 0 then
  begin
    Result := True;
    Exit;
  end;
  Parent := ExtractFileDir(Directory);
  if (Parent <> '') and (Parent <> Directory) then
    if not PinProgramDirectory(Parent) then
      Exit;
  { FILE_LIST_DIRECTORY enforces sharing; attribute-only handles do not pin paths. }
  Handle := CreateFileW(Directory, $81, 3, 0, 3, $02200000, 0);
  if Handle = THandle(-1) then
  begin
    ErrorCode := DLLGetLastError;
    if (ErrorCode = 2) or (ErrorCode = 3) then
      Exit;
    ProgramFileError(Directory, ErrorCode);
  end;
  try
    if not GetFileInformationByHandle(Handle, Information) then
      ProgramFileError(Directory, DLLGetLastError);
    if (Information.Attributes and $400 <> 0) or (Information.Attributes and $10 = 0) then
      RaiseException(CustomMessage('MaintenanceUnsafe') + #13#10 + Directory);
    Count := GetArrayLength(ProgramDirectoryHandles);
    SetArrayLength(ProgramDirectoryHandles, Count + 1);
    ProgramDirectoryHandles[Count] := Handle;
    Handle := 0;
    ProgramDirectories.Add(Directory);
    Result := True;
  finally
    if Handle <> 0 then
      CloseHandle(Handle);
  end;
end;

procedure ProbeProgramFile(const FileName: String; RequireDeleteAccess: Boolean);
var
  Handle: THandle;
  Information: TProgramFileInformation;
  Access: DWORD;
  ErrorCode: Integer;
begin
  if not PinProgramDirectory(ExtractFileDir(FileName)) then
    Exit;
  Access := $80;
  if RequireDeleteAccess then
    Access := Access or $10000;
  Handle := CreateFileW(FileName, Access, 7, 0, 3, $00200000, 0);
  if Handle = THandle(-1) then
  begin
    ErrorCode := DLLGetLastError;
    if (ErrorCode = 2) or (ErrorCode = 3) then
      Exit;
    ProgramFileError(FileName, ErrorCode);
  end;
  try
    if not GetFileInformationByHandle(Handle, Information) then
      ProgramFileError(FileName, DLLGetLastError);
    if (Information.Attributes and $410 <> 0) or (Information.Links <> 1) then
      RaiseException(CustomMessage('MaintenanceUnsafe') + #13#10 + FileName);
  finally
    { PyInstaller cannot reopen its embedded archive while DELETE handles remain. }
    CloseHandle(Handle);
  end;
end;

procedure PinProgramTree(const Directory: String; Depth: Integer; var Entries: Integer);
var
  FindData: TProgramFindData;
  Handle: THandle;
  Name, FileName: String;
  ErrorCode, Index: Integer;
begin
  if Depth > 256 then
    RaiseException(CustomMessage('MaintenanceUnsafe') + #13#10 + Directory);
  if not PinProgramDirectory(Directory) then
    Exit;
  Handle := FindFirstProgramFile(AddBackslash(Directory) + '*', FindData);
  if Handle = THandle(-1) then
  begin
    ErrorCode := DLLGetLastError;
    if ErrorCode <> 2 then
      ProgramFileError(Directory, ErrorCode);
    Exit;
  end;
  try
    repeat
      Name := '';
      for Index := 0 to 259 do
      begin
        if FindData.FileName[Index] = 0 then
          Break;
        Name := Name + Chr(FindData.FileName[Index]);
      end;
      if (Name <> '.') and (Name <> '..') then
      begin
        Entries := Entries + 1;
        if Entries > 100000 then
          RaiseException(CustomMessage('MaintenanceUnsafe') + #13#10 + Directory);
        FileName := AddBackslash(Directory) + Name;
        if FindData.Attributes and $400 <> 0 then
          RaiseException(CustomMessage('MaintenanceUnsafe') + #13#10 + FileName);
        if FindData.Attributes and $10 <> 0 then
          PinProgramTree(FileName, Depth + 1, Entries)
        else
          ProbeProgramFile(FileName, False);
      end;
    until not FindNextProgramFile(Handle, FindData);
    ErrorCode := DLLGetLastError;
    if ErrorCode <> 18 then
      ProgramFileError(Directory, ErrorCode);
  finally
    CloseProgramFind(Handle);
  end;
end;

function CheckProgramFiles: String;
var
  Files: TArrayOfString;
  Root, FileName: String;
  Index, Entries: Integer;
begin
  Result := '';
  ReleaseProgramDirectories;
  ProgramDirectories := TStringList.Create;
  ProgramDirectories.Sorted := True;
  try
    GetProgramFiles(Files);
    Root := RemoveBackslashUnlessRoot(ExpandFileName(ExpandConstant('{app}')));
    Entries := 0;
    PinProgramTree(Root, 0, Entries);
    Root := AddBackslash(Root);
    for Index := 0 to GetArrayLength(Files) - 1 do
    begin
      FileName := ExpandFileName(Root + Files[Index]);
      if (Length(FileName) <= Length(Root)) or
        (CompareText(Copy(FileName, 1, Length(Root)), Root) <> 0) then
        RaiseException(CustomMessage('MaintenanceUnsafe'));
      ProbeProgramFile(FileName, True);
    end;
  except
    Result := GetExceptionMessage;
    ReleaseProgramDirectories;
  end;
end;

function StateDirectory: String;
begin
  Result := RemoveBackslashUnlessRoot(ExpandFileName(ExpandConstant('{#StateDir}')));
end;

function InvariantLowercase(const Value: String): String;
var
  Count: Integer;
begin
  Count := LCMapStringEx(#0, LcMapLowercase, Value, Length(Value), '', 0, 0, 0, 0);
  if Count = 0 then
    RaiseException(CustomMessage('MaintenanceGateFailed'));
  SetLength(Result, Count);
  if LCMapStringEx(#0, LcMapLowercase, Value, Length(Value), Result, Count, 0, 0, 0) <> Count then
    RaiseException(CustomMessage('MaintenanceGateFailed'));
end;

function SilentOperation: Boolean;
begin
  if IsUninstaller then
    Result := UninstallSilent
  else
    Result := WizardSilent;
end;

function AskRetry(const MessageText: String): Boolean;
begin
  Result := False;
  if not SilentOperation then
    Result := SuppressibleMsgBox(MessageText, mbError, MB_RETRYCANCEL, IDCANCEL) = IDRETRY;
end;

procedure ReleaseMaintenanceGate;
begin
  if MaintenanceGate <> 0 then
  begin
    if GateOwned then
      ReleaseMutex(MaintenanceGate);
    CloseHandle(MaintenanceGate);
    MaintenanceGate := 0;
    GateOwned := False;
  end;
end;

function AcquireMaintenanceGate: Boolean;
var
  GateName, ErrorText: String;
  WaitResult: DWORD;
begin
  Result := False;
  GateName := 'Local\SpinShareBrowserMaintenance-' +
    LowerCase(GetSHA256OfUnicodeString(InvariantLowercase(StateDirectory)));
  repeat
    MaintenanceGate := CreateMutexW(0, False, GateName);
    if MaintenanceGate = 0 then
      ErrorText := CustomMessage('MaintenanceGateFailed')
    else
    begin
      WaitResult := WaitForSingleObject(MaintenanceGate, 0);
      if (WaitResult = WaitObject) or (WaitResult = WaitAbandoned) then
      begin
        GateOwned := True;
        Result := True;
        Exit;
      end;
      if WaitResult = WaitTimeout then
        ErrorText := CustomMessage('MaintenanceGateBusy')
      else
        ErrorText := CustomMessage('MaintenanceGateFailed');
      ReleaseMaintenanceGate;
    end;
  until not AskRetry(ErrorText);
end;

function DotNetAvailable: Boolean;
var
  Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM32,
    'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release);
  if Result then
    Result := Release >= 528040;
end;

function WebView2VersionSupported(const Value: String): Boolean;
var
  Version, Minimum: Int64;
begin
  Result := StrToVersion(Value, Version) and StrToVersion('123.0.2420.47', Minimum);
  if Result then
    Result := ComparePackedVersion(Version, Minimum) >= 0;
end;

function WebView2InRegistry(const Root: HKEY): Boolean;
var
  Value: String;
begin
  Result := RegQueryStringValue(Root, WebView2Key, 'pv', Value);
  if Result then
    Result := WebView2VersionSupported(Value);
end;

function WebView2Available: Boolean;
begin
  Result := WebView2InRegistry(HKLM32) or WebView2InRegistry(HKCU);
end;

function RunChild(const FileName, Parameters, WorkingDirectory: String;
  var ExitCode: Integer): Boolean;
begin
  Result := Exec(FileName, Parameters, WorkingDirectory, SW_HIDE,
    ewWaitUntilTerminated, ExitCode);
end;

function MaintenanceError(const ExitCode: Integer): String;
begin
  case ExitCode of
    10: Result := CustomMessage('MaintenanceBusy');
    11: Result := CustomMessage('MaintenanceUnsafe');
    12: Result := CustomMessage('MaintenanceIO');
  else
    Result := CustomMessage('MaintenanceFailed');
  end;
end;

function MaintenanceStartError(const ErrorCode: Integer): String;
begin
  if ErrorCode = 4551 then
    Result := CustomMessage('MaintenancePolicyBlocked')
  else
    Result := CustomMessage('MaintenanceStartFailed') + #13#10 + SysErrorMessage(ErrorCode);
  Result := Result + #13#10 + FmtMessage(CustomMessage('WindowsErrorCode'), [IntToStr(ErrorCode)]);
end;

function RunMaintenance(const FileName, Mode: String): String;
var
  Parameters, Language: String;
  ExitCode: Integer;
begin
  Language := 'en';
  if ActiveLanguage = 'zh_CN' then
    Language := 'zh-CN';
  Parameters := '--maintenance ' + Mode + ' --state-dir ' + AddQuotes(StateDirectory) +
    ' --install-dir ' + AddQuotes(ExpandConstant('{app}')) + ' --language ' + Language;
  repeat
    if RunChild(FileName, Parameters, ExtractFileDir(FileName), ExitCode) then
    begin
      Log('Maintenance ' + Mode + ' returned ' + IntToStr(ExitCode) + '.');
      if ExitCode = 0 then
      begin
        Result := '';
        Exit;
      end;
      Result := MaintenanceError(ExitCode);
    end
    else
    begin
      Log('Maintenance ' + Mode + ' could not start ' + ExtractFileName(FileName) +
        ' (Windows error ' + IntToStr(ExitCode) + ').');
      Result := MaintenanceStartError(ExitCode);
      Log(Result);
    end;
  until not AskRetry(Result);
end;

function InstallWebView2: String;
var
  ExitCode: Integer;
  Bootstrapper: String;
begin
  Result := '';
  if WebView2Available then
    Exit;
  WizardForm.PreparingLabel.Caption := CustomMessage('InstallingWebView2');
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  Bootstrapper := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
  repeat
    if WebView2Available then
    begin
      Result := '';
      Exit;
    end;
    if RunChild(Bootstrapper, '/silent /install', ExpandConstant('{tmp}'), ExitCode) then
    begin
      Log('WebView2 bootstrapper returned ' + IntToStr(ExitCode) + '.');
      if WebView2Available then
      begin
        Result := '';
        Exit;
      end;
    end;
    Result := CustomMessage('WebView2Required');
  until not AskRetry(Result);
end;

function InitializeSetup: Boolean;
begin
  Result := False;
  if not DotNetAvailable then
  begin
    SuppressibleMsgBox(CustomMessage('DotNetRequired'), mbError, MB_OK, IDOK);
    Exit;
  end;
  try
    Result := AcquireMaintenanceGate;
  except
    ReleaseMaintenanceGate;
    SuppressibleMsgBox(CustomMessage('MaintenanceGateFailed'), mbError, MB_OK, IDOK);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := CustomMessage('MaintenanceGateFailed');
  if not GateOwned then
    Exit;
  WizardForm.PreparingLabel.Caption := CustomMessage('PreparingFiles');
  WizardForm.PreparingLabel.Visible := True;
  try
    if not PayloadReady then
    begin
      ExtractTemporaryFiles('{tmp}\SpinShareBrowser\*');
      PayloadReady := True;
    end;
  except
    Result := CustomMessage('PayloadFailed');
    Exit;
  end;
  try
    Result := RunMaintenance(ExpandConstant('{tmp}\SpinShareBrowser\SpinShareBrowser.exe'), 'prepare');
  except
    Result := CustomMessage('MaintenanceFailed');
  end;
  if Result = '' then
    Result := CheckProgramFiles;
  if Result = '' then
  begin
    try
      Result := InstallWebView2;
    except
      Result := CustomMessage('WebView2Required');
    end;
  end;
end;

procedure DeinitializeSetup;
begin
  ReleaseProgramDirectories;
  ReleaseMaintenanceGate;
end;

function InitializeUninstall: Boolean;
begin
  Result := False;
  try
    Result := AcquireMaintenanceGate;
  except
    ReleaseMaintenanceGate;
    SuppressibleMsgBox(CustomMessage('MaintenanceGateFailed'), mbError, MB_OK, IDOK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ErrorText: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    if not GateOwned then
      Abort;
    try
      ErrorText := RunMaintenance(ExpandConstant('{app}\SpinShareBrowser.exe'), 'prepare-uninstall');
      if ErrorText = '' then
      begin
        repeat
          ErrorText := CheckProgramFiles;
        until (ErrorText = '') or not AskRetry(ErrorText);
        if ErrorText = '' then
          ErrorText := RunMaintenance(ExpandConstant('{app}\SpinShareBrowser.exe'), 'cleanup');
      end;
    except
      ErrorText := CustomMessage('MaintenanceFailed');
      SuppressibleMsgBox(ErrorText, mbError, MB_OK, IDOK);
    end;
    ReleaseProgramDirectories;
    if ErrorText <> '' then
      Abort;
  end;
end;

procedure DeinitializeUninstall;
begin
  ReleaseProgramDirectories;
  ReleaseMaintenanceGate;
end;
