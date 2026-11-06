import { rankMatches } from './matching.js'
let speech, encoder, topics=[], examples=[]
let chain=Promise.resolve()
async function embedding(text) {
  const output=await encoder(text,{pooling:'cls',normalize:true})
  return Array.from(output.data)
}
async function process(request) {
  const {id,type}=request
  try {
    if(type=='prepare') {
      const {pipeline,env}=await import('@huggingface/transformers')
      env.backends.onnx.wasm.numThreads=1
      const progress_callback=progress=>self.postMessage({type:'progress',file:progress.file||'',progress:progress.progress})
      speech ||= await pipeline('automatic-speech-recognition','onnx-community/whisper-tiny',{device:'wasm',dtype:'q8',progress_callback})
      encoder ||= await pipeline('feature-extraction','onnx-community/rubert-tiny-ONNX',{device:'wasm',dtype:'q8',progress_callback})
      topics=request.topics;examples=[]
      for(const topic of topics) {
        for(const phrase of topic.phrases) { examples.push({id:topic.id,vector:await embedding(phrase)}) }
        self.postMessage({type:'progress',file:'Настройка темы: '+topic.title})
      }
      self.postMessage({id,type:'result',data:true});return
    }
    if(!speech || !encoder) { throw new Error('Сначала подготовь модели.') }
    const text=type=='audio'?(await speech(request.audio,{language:'russian',task:'transcribe',max_new_tokens:96})).text.trim():request.text
    if(type=='record') { self.postMessage({id,type:'result',data:(await speech(request.audio,{language:'russian',task:'transcribe',max_new_tokens:96})).text.trim()});return }
    const scores=rankMatches(text,await embedding(text),examples,topics)
    self.postMessage({id,type:'result',data:{text,scores}})
  } catch(error) { self.postMessage({id,type:'error',error:error instanceof Error?error.message:String(error)}) }
}
self.onmessage=event=>{chain=chain.then(()=>process(event.data))}
