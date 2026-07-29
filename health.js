module.exports=function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  return res.status(200).json({ok:true,apiKeyConfigured:Boolean(process.env.OPENAI_API_KEY),model:process.env.OPENAI_MODEL||'automatic'});
};
