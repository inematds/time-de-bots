import{parentPort,workerData}from'node:worker_threads';
try{
 const {env,pipeline}=await import('@huggingface/transformers');env.allowRemoteModels=false;env.allowLocalModels=true;env.useBrowserCache=false;env.useFSCache=false;
 const encoder=await pipeline('feature-extraction',workerData.modelPath,{dtype:'q8',device:'cpu',session_options:{intraOpNumThreads:2,interOpNumThreads:1}});
 let queue=Promise.resolve(),closing=false;
 parentPort.on('message',message=>{
  if(message.close){closing=true;queue=queue.finally(async()=>{await encoder.dispose();parentPort.close();});return;}
  if(closing)return;
  const{id,text}=message;
  // Native inference finishes before the session is disposed or the worker exits.
  queue=queue.then(async()=>{try{const tensor=await encoder(text,{pooling:'mean',normalize:true});parentPort.postMessage({id,vector:Array.from(tensor.data)});}catch{parentPort.postMessage({id,error:'Meaning search could not process this text.'});}});
 });
 parentPort.postMessage({ready:true});
}catch{parentPort.postMessage({failed:true});parentPort.close();}
