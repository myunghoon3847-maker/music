const PRESET_GUIDES={자유:'사용자의 요청에 가장 알맞은 형식으로 완성도 높은 한국어 글을 작성하세요.',블로그:'블로그 게시물 형식으로 작성하세요. 자연스러운 제목과 소제목을 사용하고 읽기 편한 문단으로 구성하세요.',유튜브:'유튜브 영상 대본 또는 영상 설명문에 적합하게 작성하세요. 첫 부분에서 관심을 끌고 전달력이 좋게 구성하세요.',마케팅:'과장된 허위 표현은 피하면서 장점과 행동 유도를 분명하게 전달하는 마케팅 글로 작성하세요.',자기소개서:'지원자의 강점과 경험이 구체적으로 드러나는 자기소개서 문체로 작성하세요. 확인되지 않은 경험은 만들어내지 마세요.',이메일:'받는 사람이 이해하기 쉬운 이메일 형식으로 작성하세요. 상황에 맞는 제목, 인사, 본문, 마무리를 포함하세요.'};
const LENGTH_GUIDES={short:'핵심만 담아 짧고 간결하게 작성하세요.',medium:'충분한 설명을 포함하되 지나치게 길지 않게 작성하세요.',long:'구체적인 설명과 예시를 포함해 충분히 자세하게 작성하세요.'};
const TONE_GUIDES={'자연스럽게':'부자연스러운 번역투 없이 자연스럽게 작성하세요.','친근하게':'부담 없이 읽히는 친근하고 따뜻한 문체로 작성하세요.','전문적으로':'신뢰감 있고 정확한 전문 문체로 작성하세요.','설득력 있게':'핵심 근거와 이점을 분명히 드러내 설득력 있게 작성하세요.','간결하게':'중복을 줄이고 짧고 명확한 문장으로 작성하세요.'};

function extractOutputText(data){
  if(typeof data?.output_text==='string'&&data.output_text.trim())return data.output_text.trim();
  const chunks=[];
  for(const item of data?.output||[])for(const content of item?.content||[])if(content?.type==='output_text'&&content?.text)chunks.push(content.text);
  return chunks.join('\n').trim();
}
function mapError(status,message=''){
  const lower=String(message).toLowerCase();
  if(status===401)return'OpenAI API Key가 올바르지 않습니다. Vercel 환경 변수를 확인해 주세요.';
  if(status===403)return'OpenAI API 사용 권한이 없습니다. 프로젝트 또는 조직 권한을 확인해 주세요.';
  if(status===429)return'OpenAI API 사용 한도 또는 결제 설정을 확인해 주세요.';
  if(status===404&&lower.includes('model'))return'현재 계정에서 사용할 수 없는 AI 모델입니다.';
  if(status>=500)return'AI 서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.';
  return message||'글을 작성하지 못했습니다.';
}
function buildPrompt({mode,preset,tone,length,request,previousText,instruction}){
  if(mode==='revise')return['아래 기존 글을 사용자의 수정 요청에 맞게 고쳐서 완성본만 출력하세요.','원래 글의 핵심 내용은 유지하되 수정 요청을 우선 반영하세요.',TONE_GUIDES[tone]||TONE_GUIDES['자연스럽게'],LENGTH_GUIDES[length]||LENGTH_GUIDES.medium,'','[원래 요청]',request,'','[기존 글]',previousText,'','[수정 요청]',instruction].join('\n');
  return[PRESET_GUIDES[preset]||PRESET_GUIDES.자유,TONE_GUIDES[tone]||TONE_GUIDES['자연스럽게'],LENGTH_GUIDES[length]||LENGTH_GUIDES.medium,'설명이나 작업 과정은 쓰지 말고 사용자가 바로 복사해 사용할 수 있는 완성된 글만 출력하세요.','사용자가 제공하지 않은 사실, 사용 경험, 수치, 인물 정보는 임의로 만들어내지 마세요.','','[사용자 요청]',request].join('\n');
}
async function requestOpenAI({apiKey,model,input}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),50000);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions:'당신은 한국어 글쓰기 전문 AI입니다. 명확하고 자연스러우며 실제 사용 가능한 글을 작성합니다.',input,max_output_tokens:2200}),signal:controller.signal});
    const rawText=await response.text();
    let data={};
    try{data=rawText?JSON.parse(rawText):{}}catch{data={error:{message:rawText.slice(0,300)}}}
    return{response,data};
  }finally{clearTimeout(timeout)}
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:'POST 요청만 지원합니다.',code:'METHOD_NOT_ALLOWED'});
  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey)return res.status(500).json({error:'서버에 OPENAI_API_KEY가 설정되지 않았습니다. Vercel 프로젝트의 환경 변수를 확인해 주세요.',code:'MISSING_API_KEY'});
  try{
    const{mode='generate',preset='자유',tone='자연스럽게',length='medium',request='',previousText='',instruction=''}=req.body||{};
    if(typeof request!=='string'||!request.trim())return res.status(400).json({error:'글쓰기 요청을 입력해 주세요.',code:'EMPTY_REQUEST'});
    if(request.length>2000||String(instruction).length>500)return res.status(400).json({error:'입력 가능한 글자 수를 초과했습니다.',code:'INPUT_TOO_LONG'});
    if(mode==='revise'&&(!String(previousText).trim()||!String(instruction).trim()))return res.status(400).json({error:'수정할 글과 수정 요청이 필요합니다.',code:'INVALID_REVISION'});

    const input=buildPrompt({mode,preset,tone,length,request:request.trim(),previousText:String(previousText),instruction:String(instruction)});
    const configured=process.env.OPENAI_MODEL?.trim();
    const models=[...new Set([configured,'gpt-5-mini','gpt-4.1-mini'].filter(Boolean))];
    let lastFailure=null;

    for(const model of models){
      const{response,data}=await requestOpenAI({apiKey,model,input});
      if(response.ok){
        const text=extractOutputText(data);
        if(!text){lastFailure={status:502,message:'AI 응답에서 작성 결과를 찾지 못했습니다.',model};continue}
        return res.status(200).json({text,model});
      }
      const message=data?.error?.message||'';
      lastFailure={status:response.status,message,model};
      const modelUnavailable=response.status===404&&String(message).toLowerCase().includes('model');
      if(modelUnavailable)continue;
      console.error('OpenAI API error:',response.status,model,message);
      return res.status(response.status).json({error:mapError(response.status,message),code:'OPENAI_ERROR',detail:process.env.NODE_ENV==='development'?message:undefined});
    }

    console.error('All models failed:',lastFailure);
    return res.status(lastFailure?.status||502).json({error:mapError(lastFailure?.status||502,lastFailure?.message||''),code:'MODEL_UNAVAILABLE'});
  }catch(error){
    console.error('Server error:',error);
    if(error?.name==='AbortError')return res.status(504).json({error:'AI 응답 시간이 너무 길어 요청이 중단되었습니다. 다시 시도해 주세요.',code:'TIMEOUT'});
    return res.status(500).json({error:'서버 연결 중 오류가 발생했습니다.',code:'SERVER_ERROR'});
  }
};
