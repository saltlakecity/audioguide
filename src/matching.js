export const defaults = {
  name: 'Мой показ', threshold: .78, margin: .08, forwardOnly: true, currentSlide: 1, noiseFloor: .012,
  topics: [
    { id: 'culture', title: 'Корпоративная культура', action: 'slide', slide: 4, phrases: ['корпоративная культура', 'поговорим о корпоративной культуре', 'культура внутри команды'] },
    { id: 'collaboration', title: 'Взаимодействие команд', action: 'slide', slide: 8, phrases: ['взаимодействие команд', 'сотрудничество между секторами', 'как команды работают вместе'] },
    { id: 'next', title: 'Следующий слайд', action: 'next', slide: 1, phrases: ['следующий слайд', 'перейдем дальше'] },
  ],
}
export function normalize(text) { return text.toLocaleLowerCase('ru').replaceAll('ё','е').replace(/[^а-яa-z0-9]+/g,' ').trim().replace(/ +/g,' ') }
export function validateProfile(value) {
  if (!value || typeof value!='object' || typeof value.name!='string' || value.name.length>80 || !Array.isArray(value.topics) || value.topics.length<1 || value.topics.length>60) { throw new Error('Укажи название и от 1 до 60 тем.') }
  for(const key of ['threshold','margin','noiseFloor']) { if(!Number.isFinite(value[key])) { throw new Error('Некорректные настройки распознавания.') } }
  if(value.threshold<.4||value.threshold>1||value.margin<.01||value.margin>.4||value.noiseFloor<.001||value.noiseFloor>.1||!Number.isInteger(value.currentSlide)||value.currentSlide<1||value.currentSlide>9999||typeof value.forwardOnly!='boolean') { throw new Error('Настройки вне допустимых границ.') }
  const ids=new Set()
  const topics=value.topics.map(topic=>{
    if(!topic||typeof topic.id!='string'||!topic.id||topic.id.length>80||ids.has(topic.id)||typeof topic.title!='string'||!topic.title.trim()||topic.title.length>80||!['slide','next','previous'].includes(topic.action)||!Number.isInteger(topic.slide)||topic.slide<1||topic.slide>9999||!Array.isArray(topic.phrases)||topic.phrases.length<1||topic.phrases.length>8||topic.phrases.some(text=>typeof text!='string'||text.length>180||normalize(text).length<2)) { throw new Error('У каждой темы: название, действие, номер 1–9999 и 1–8 фраз до 180 символов.') }
    ids.add(topic.id)
    return {id:topic.id,title:topic.title.trim(),action:topic.action,slide:topic.slide,phrases:[...new Set(topic.phrases.map(text=>text.trim()))]}
  })
  return {name:value.name.trim(),threshold:value.threshold,margin:value.margin,noiseFloor:value.noiseFloor,currentSlide:value.currentSlide,forwardOnly:value.forwardOnly,topics}
}
export function rankMatches(text, vector, examples, topics) {
  const phrase=' '+normalize(text)+' '
  return topics.map(topic=>{
    let score=-1
    for(const sample of examples.filter(item=>item.id==topic.id)) {
      let dot=0; for(let i=0;i<vector.length;i++){dot+=vector[i]*sample.vector[i]}
      score=Math.max(score,dot)
    }
    if(topic.phrases.some(sample=>phrase.includes(' '+normalize(sample)+' '))) { score=1 }
    return {id:topic.id,score:Math.max(-1,Math.min(1,score))}
  }).sort((a,b)=>b.score-a.score)
}
export function chooseMatch(scores,profile) {
  const ranked=scores.filter(item=>profile.topics.some(topic=>topic.id==item.id))
  const best=ranked[0];const second=ranked[1]
  if(!best||!Number.isFinite(best.score)||best.score<profile.threshold) { return {reason:'Тема не определена уверенно.'} }
  if(second&&best.score-second.score<profile.margin) { return {reason:'Несколько похожих тем — команда пропущена.'} }
  const topic=profile.topics.find(item=>item.id==best.id)
  if(profile.forwardOnly && (topic.action=='previous'||topic.action=='slide'&&topic.slide<=profile.currentSlide)) { return {reason:'Тема уже показана; включён переход только вперёд.'} }
  return {topic,score:best.score}
}
