export class VoiceEngine extends EventTarget {
  constructor() {
    super();this.worker=null;this.pending=new Map();this.sequence=0;this.session=0;this.ready=false;this.listening=false;this.processing=false;this.starting=false;this.recording=false;this.stream=null;this.context=null;this.node=null;this.source=null;this.timer=null;this.pre=[];this.frames=[];this.voiced=0;this.silence=0;this.queued=null;this.noiseFloor=.012
  }
  state(message) { this.dispatchEvent(new CustomEvent('state',{detail:{message,ready:this.ready,listening:this.listening,processing:this.processing,starting:this.starting,recording:this.recording}})) }
  clearFrames(){this.pre=[];this.frames=[];this.voiced=0;this.silence=0}
  closeCapture() {
    clearTimeout(this.timer);this.node?.port.close();this.node?.disconnect();this.source?.disconnect();this.stream?.getTracks().forEach(track=>track.stop())
    this.context?.close().catch(error=>console.warn('Audio context cleanup',error))
    this.stream=null;this.context=null;this.source=null;this.node=null;this.listening=false;this.starting=false;this.clearFrames()
  }
  stop() { this.session++;this.queued=null;this.closeCapture();this.state('Микрофон выключен.') }
  release() {
    this.stop();this.worker?.terminate();this.worker=null;this.ready=false;this.processing=false
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Операция отменена.'))}this.pending.clear();this.state('Модели выгружены.')
  }
  fail(error) { this.release();this.dispatchEvent(new CustomEvent('error',{detail:error instanceof Error?error.message:String(error)})) }
  rpc(type,payload={},timeout=60000) {
    return new Promise((resolve,reject)=>{
      const id=++this.sequence
      if(!this.worker){reject(new Error('Модели не подготовлены.'));return}
      const timer=setTimeout(()=>{this.pending.delete(id);this.fail(new Error('Локальное распознавание превысило время ожидания.'));reject(new Error('Истекло время ожидания.'))},timeout)
      this.pending.set(id,{resolve,reject,timer})
      this.worker.postMessage({id,type,...payload},payload.audio?[payload.audio.buffer]:[])
    })
  }
  async prepare(topics) {
    this.stop();this.ready=false;this.state('Подготовка моделей…')
    if(!this.worker) {
      this.worker=new Worker(new URL('./recognizer.worker.js',import.meta.url),{type:'module'})
      this.worker.onerror=()=>this.fail(new Error('Не удалось запустить локальный Worker.'))
      this.worker.onmessage=event=>{
        const data=event.data
        if(data.type=='progress') {this.state((data.file||'Загрузка модели')+(Number.isFinite(data.progress)?' · '+Math.round(data.progress)+'%':''));return}
        const request=this.pending.get(data.id);if(!request){return}clearTimeout(request.timer);this.pending.delete(data.id)
        if(data.type=='error'){request.reject(new Error(data.error))}else{request.resolve(data.data)}
      }
    }
    try { await this.rpc('prepare',{topics},180000);this.ready=true;this.state('Whisper + RuBERT · локально · готовы') }
    catch(error){this.fail(error);throw error}
  }
  async check(text) { if(!this.ready||this.processing){throw new Error('Подготовь модели и дождись распознавания.')}return this.rpc('text',{text}) }
  async infer(audio,session,recording) {
    if(this.processing){this.queued={audio,session,recording};return}
    this.processing=true;this.state('Распознаю на устройстве…')
    try {
      const result=await this.rpc(recording?'record':'audio',{audio})
      if(session==this.session){this.dispatchEvent(new CustomEvent(recording?'recorded':'recognized',{detail:result}))}
    } catch(error){if(session==this.session){this.fail(error)}}
    finally {
      this.processing=false;const next=this.queued;this.queued=null
      this.state(this.listening?'Слушаю…':'Микрофон выключен.')
      if(next&&next.session==this.session&&this.listening){this.infer(next.audio,next.session,next.recording)}
    }
  }
  finish() {
    if(this.voiced>=8){
      const audio=new Float32Array(this.frames.length*512);this.frames.forEach((frame,index)=>audio.set(frame,index*512))
      this.infer(audio,this.session,this.recording)
      if(this.recording){this.closeCapture()}
    }
    this.clearFrames()
  }
  receive(frame) {
    if(!this.listening){return}
    let energy=0;for(const sample of frame){energy+=sample*sample}
    const speaking=Math.sqrt(energy/frame.length)>this.noiseFloor
    if(!this.frames.length){this.pre.push(frame);if(this.pre.length>10){this.pre.shift()}if(!speaking){return}this.frames=this.pre;this.pre=[]}else{this.frames.push(frame)}
    if(speaking){this.voiced++;this.silence=0}else{this.silence++}
    // shortcut: speech windows up to eight seconds; evaluate streaming ASR after a rehearsal.
    if(this.silence>=22||this.frames.length>=250){this.finish()}
  }
  async start(recording=false,noiseFloor=.012) {
    if(!this.ready||this.processing||this.starting){throw new Error('Подготовь модели и дождись завершения текущей операции.')}
    this.stop();const current=this.session;this.recording=recording;this.noiseFloor=noiseFloor;this.starting=true;this.state('Ожидаю микрофон…')
    let stream,context
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,noiseSuppression:true,echoCancellation:true},video:false})
      if(current!=this.session){stream.getTracks().forEach(track=>track.stop());return}
      context=new AudioContext();this.stream=stream;this.context=context
      await context.audioWorklet.addModule(new URL('../capture.js',import.meta.url).href);await context.resume()
      if(current!=this.session){stream.getTracks().forEach(track=>track.stop());await context.close();return}
      this.source=context.createMediaStreamSource(stream);this.node=new AudioWorkletNode(context,'voice-capture')
      this.node.port.onmessage=event=>this.receive(event.data);this.source.connect(this.node);this.node.connect(context.destination)
      stream.getAudioTracks()[0]?.addEventListener('ended',()=>{if(this.stream==stream){this.fail(new Error('Микрофон отключён.'))}},{once:true})
      this.starting=false;this.listening=true;this.state(recording?'Произнеси пример и сделай паузу. До 12 секунд.':'Слушаю…')
      if(recording){this.timer=setTimeout(()=>{this.finish();this.closeCapture();if(!this.processing){this.dispatchEvent(new CustomEvent('error',{detail:'Речь не обнаружена. Повтори пример.'}))}},12000)}
    }catch(error){stream?.getTracks().forEach(track=>track.stop());context?.close().catch(cause=>console.warn('Audio cleanup',cause));if(current==this.session){this.fail(error);throw error}}
  }
}
