import { app, BrowserWindow, ipcMain, protocol, net, globalShortcut, session } from 'electron'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const directory=path.dirname(fileURLToPath(import.meta.url))
protocol.registerSchemesAsPrivileged([{scheme:'presenter',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}])
let window, helper, target, captureAllowed=false, generation=0, sending=false, sequence=0
const pending=new Map()
function native(type, payload={}) {
  return new Promise((resolve,reject)=>{
    if(!helper || helper.killed) { reject(new Error('Windows bridge is unavailable. Restart the app.')); return }
    const id=++sequence
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Windows bridge timed out.'))},10000)
    pending.set(id,{resolve,reject,timer})
    helper.stdin.write(JSON.stringify({id,type,...payload})+'\n',error=>{ if(error) { clearTimeout(timer);pending.delete(id);reject(error) } })
  })
}
function stop() { target=undefined; generation++; captureAllowed=false }
function rejectPending(error) { for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error)} pending.clear();stop();window?.webContents.send('emergency-stop') }
function trusted(event) { if(event.sender!=window?.webContents || !event.senderFrame?.url.startsWith('presenter://app/')) { throw new Error('Untrusted caller.') } }
app.whenReady().then(async()=>{
  const root=path.resolve(directory,'../dist')
  protocol.handle('presenter',request=>{
    const url=new URL(request.url)
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname))
    if(url.host!='app' || !file.startsWith(root+path.sep)) { return new Response('Forbidden',{status:403}) }
    return net.fetch(pathToFileURL(file).toString())
  })
  session.defaultSession.setPermissionCheckHandler((contents,permission)=>contents==window?.webContents && permission=='media' && captureAllowed)
  session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(contents==window?.webContents && permission=='media' && captureAllowed && details.mediaTypes?.every(type=>type=='audio')))
  helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',readFileSync(path.join(directory,'windows.ps1'),'utf8')],{windowsHide:true,stdio:['pipe','pipe','pipe']})
  createInterface({input:helper.stdout}).on('line',line=>{
    try { const reply=JSON.parse(line);const entry=pending.get(reply.id);if(!entry)return;pending.delete(reply.id);clearTimeout(entry.timer);reply.ok?entry.resolve(reply.data):entry.reject(new Error(reply.error)) }
    catch(error){ console.warn('Invalid native response',error) }
  })
  helper.on('error',error=>rejectPending(error));helper.on('exit',()=>rejectPending(new Error('Windows bridge closed. Restart the app.')))
  helper.stderr.on('data',data=>console.warn(String(data)))
  window=new BrowserWindow({width:1180,height:860,minWidth:850,minHeight:640,backgroundColor:'#0b0d14',title:'Voice Presenter',autoHideMenuBar:true,webPreferences:{preload:path.join(directory,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}})
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}))
  window.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('presenter://app/'))event.preventDefault()})
  window.webContents.on('render-process-gone',()=>stop())
  ipcMain.handle('windows',event=>{trusted(event);return native('list')})
  ipcMain.handle('arm',async(event,selection)=>{
    trusted(event);stop();const ownGeneration=generation
    if(!selection || !/^\d+$/.test(selection.handle) || !Number.isSafeInteger(selection.pid) || selection.pid<1)throw new Error('Select a presentation window.')
    const windows=await native('list')
    if(ownGeneration!=generation)throw new Error('Activation cancelled.')
    const found=windows.find(item=>item.handle==selection.handle && item.pid==selection.pid && item.pid!=process.pid)
    if(!found)throw new Error('Selected window no longer exists.')
    target={handle:found.handle,pid:found.pid};return true
  })
  ipcMain.handle('capture',(event,allowed)=>{trusted(event);captureAllowed=allowed===true;return true})
  ipcMain.handle('stop',event=>{trusted(event);stop();return true})
  ipcMain.handle('probe',event=>{trusted(event);if(!target)throw new Error('Control is not armed.');return native('probe',target)})
  ipcMain.handle('send',async(event,command)=>{
    trusted(event)
    if(!target || sending)throw new Error('Control is stopped or busy.')
    if(!['slide','next','previous'].includes(command?.action) || (command.action=='slide'&&(!Number.isInteger(command.slide)||command.slide<1||command.slide>9999)))throw new Error('Invalid command.')
    const current=generation;const selected=target;sending=true
    try { await native('probe',selected);if(current!=generation)throw new Error('Control was stopped.');return await native('send',{...selected,action:command.action,slide:command.slide||1}) }
    finally {sending=false}
  })
  const shortcut=globalShortcut.register('Control+Alt+Space',()=>{stop();window?.webContents.send('emergency-stop')})
  if(!shortcut)console.warn('Emergency shortcut could not be registered.')
  await window.loadURL('presenter://app/index.html')
  if(!shortcut)window.webContents.executeJavaScript("document.querySelector('#notice').textContent='Горячая клавиша занята другим приложением. Останавливай запись кнопкой.'")
})
app.on('window-all-closed',()=>app.quit())
app.on('will-quit',()=>{stop();globalShortcut.unregisterAll();helper?.kill();rejectPending(new Error('App closed.'))})
