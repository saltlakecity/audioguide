$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class PresenterWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int v);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] struct KEY { public ushort code, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSE { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct DATA { [FieldOffset(0)] public KEY key; [FieldOffset(0)] public MOUSE mouse; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public DATA data; }
  public class Window { public string handle; public uint pid; public string title; }
  public static Window[] List() {
    var windows = new List<Window>();
    EnumWindows((h,p) => { var title=new StringBuilder(512); GetWindowText(h,title,512); uint pid; GetWindowThreadProcessId(h,out pid);
      if(IsWindowVisible(h) && title.Length>0) windows.Add(new Window {handle=h.ToInt64().ToString(),pid=pid,title=title.ToString()}); return true; },IntPtr.Zero);
    return windows.ToArray();
  }
  public static void Check(long handle, uint pid) {
    var h=new IntPtr(handle); uint actual; GetWindowThreadProcessId(h,out actual);
    if(!IsWindow(h) || actual!=pid) throw new Exception("Target window was closed. Select it again.");
    if(GetForegroundWindow()!=h) throw new Exception("Presentation window is not active. Command skipped.");
    foreach(int key in new[]{0x10,0x11,0x12,0x5B,0x5C}) if((GetAsyncKeyState(key)&0x8000)!=0) throw new Exception("Release modifier keys before voice commands.");
  }
  public static void Send(long handle, uint pid, string action, int slide) {
    var keys=new List<ushort>();
    if(action=="slide") { if(slide<1||slide>9999) throw new Exception("Invalid slide number."); foreach(char c in slide.ToString()) keys.Add((ushort)c); keys.Add(0x0D); }
    else if(action=="next") keys.Add(0x27);
    else if(action=="previous") keys.Add(0x25);
    else throw new Exception("Unsupported action.");
    var inputs=new List<INPUT>(); foreach(ushort key in keys) { inputs.Add(new INPUT {type=1,data=new DATA {key=new KEY {code=key}}}); inputs.Add(new INPUT {type=1,data=new DATA {key=new KEY {code=key,flags=2}}}); }
    Check(handle,pid);
    if(SendInput((uint)inputs.Count,inputs.ToArray(),Marshal.SizeOf(typeof(INPUT)))!=(uint)inputs.Count) throw new Exception("Windows blocked keyboard input.");
  }
  public static int InputSize() { return Marshal.SizeOf(typeof(INPUT)); }
}
"@
while ($line = [Console]::ReadLine()) {
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    switch ($request.type) {
      'list' { $data = @([PresenterWindows]::List() | ForEach-Object { $process = Get-Process -Id $_.pid -ErrorAction SilentlyContinue; @{ handle=$_.handle; pid=$_.pid; title=$_.title; process=$process.ProcessName } }) }
      'probe' { [PresenterWindows]::Check([long]$request.handle,[uint32]$request.pid); $data = $true }
      'send' { [PresenterWindows]::Send([long]$request.handle,[uint32]$request.pid,[string]$request.action,[int]$request.slide); $data = $true }
      'check-layout' { $data = [PresenterWindows]::InputSize() }
      default { throw 'Unknown native command.' }
    }
    @{ id=$request.id; ok=$true; data=$data } | ConvertTo-Json -Compress -Depth 5 | ForEach-Object { [Console]::WriteLine($_) }
  } catch { @{ id=$request.id; ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress | ForEach-Object { [Console]::WriteLine($_) } }
}
