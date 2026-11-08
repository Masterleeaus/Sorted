// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-modules/workflow-runtime.mjs
const MAX_STEPS = 32;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

function getPath(root, path) {
  const parts=String(path||'').split('.').filter(Boolean);
  let current=root;
  for(const part of parts){
    if(current==null || (typeof current!=='object' && !Array.isArray(current))) return undefined;
    current=current[part];
  }
  return current;
}

function tokenValue(token, state) {
  const [head,...rest]=String(token||'').trim().split('.');
  if(head==='input') return getPath(state.input, rest.join('.'));
  if(head==='vars') return getPath(state.variables, rest.join('.'));
  if(head==='last') return rest.length ? getPath(state.last, rest.join('.')) : state.last;
  return undefined;
}

function resolveTemplate(value, state) {
  if(Array.isArray(value)) return value.map(item=>resolveTemplate(item,state));
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolveTemplate(v,state)]));
  if(typeof value!=='string') return value;
  const exact=value.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
  if(exact) return clone(tokenValue(exact[1],state));
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g,(_m,token)=>{
    const resolved=tokenValue(token,state);
    return resolved==null?'':String(resolved);
  });
}

export async function executeWorkflow({
  moduleId,
  workflow,
  input={},
  context={},
  invokeTool,
  invokeCommand,
  resolveProjection,
  maxSteps=MAX_STEPS,
}={}) {
  if(!workflow || typeof workflow!=='object') throw new Error('Workflow is required');
  const steps=Array.isArray(workflow.steps)?workflow.steps:[];
  const limit=Math.min(Number(maxSteps)||MAX_STEPS,MAX_STEPS);
  if(steps.length>limit) throw new Error(`Workflow exceeds maximum ${limit} steps`);
  const state={input:clone(input),variables:{},last:null,results:[]};
  for(let index=0; index<steps.length; index++){
    const step=steps[index]||{};
    const targetModule=String(step.module_id||moduleId||'').trim();
    let result;
    if(step.type==='set'){
      result=resolveTemplate(step.value,state);
      state.variables[String(step.key)]=clone(result);
    }else if(step.type==='tool'){
      if(typeof invokeTool!=='function') throw new Error('Workflow tool runtime is unavailable');
      const payload='input' in step?resolveTemplate(step.input,state):clone(state.input);
      result=await invokeTool({moduleId:targetModule,id:step.tool,payload,company_id:context.company_id??null,context:clone(context)});
      if(step.assign) state.variables[step.assign]=clone(result);
    }else if(step.type==='command'){
      if(typeof invokeCommand!=='function') throw new Error('Workflow command runtime is unavailable');
      const payload='input' in step?resolveTemplate(step.input,state):clone(state.input);
      result=await invokeCommand({moduleId:targetModule,id:step.command,payload,company_id:context.company_id??null,context:clone(context)});
      if(step.assign) state.variables[step.assign]=clone(result);
    }else if(step.type==='projection'){
      if(typeof resolveProjection!=='function') throw new Error('Workflow projection runtime is unavailable');
      result=await resolveProjection({moduleId:targetModule,id:step.projection,company_id:context.company_id??null,context:clone(context)});
      if(step.assign) state.variables[step.assign]=clone(result);
    }else{
      throw new Error(`Unsupported workflow step type: ${String(step.type||'(empty)')}`);
    }
    state.last=clone(result);
    state.results.push({index,type:step.type,moduleId:targetModule,result:clone(result)});
  }
  return {ok:true,moduleId:String(moduleId||''),workflow:String(workflow.id||''),output:clone(state.last),variables:clone(state.variables),results:clone(state.results)};
}

export {MAX_STEPS as MAX_WORKFLOW_STEPS};
