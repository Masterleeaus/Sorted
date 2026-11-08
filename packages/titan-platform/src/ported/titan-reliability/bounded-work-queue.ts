// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/bounded-work-queue.mjs
export class BackpressureError extends Error {
  constructor(message='titan-runtime-backpressure', detail={}) {
    super(message);
    this.name='BackpressureError';
    this.code='TITAN_BACKPRESSURE';
    this.detail=Object.freeze({...detail});
  }
}

export function createBoundedWorkQueue({name='titan-work-queue', concurrency=1, maxPending=256}={}) {
  if(!Number.isInteger(concurrency)||concurrency<1) throw new TypeError('concurrency-must-be-positive-integer');
  if(!Number.isInteger(maxPending)||maxPending<0) throw new TypeError('maxPending-must-be-nonnegative-integer');
  const pending=[];
  let active=0, accepted=0, completed=0, failed=0, rejected=0, highWater=0;

  const depth=()=>active+pending.length;
  const snapshot=()=>Object.freeze({
    name, concurrency, maxPending, active, pending:pending.length, depth:depth(), highWater,
    accepted, completed, failed, rejected, saturated:pending.length>=maxPending && active>=concurrency,
    grants_authority:false, authority_effect:false,
  });

  function drain(){
    while(active<concurrency && pending.length){
      const item=pending.shift(); active+=1;
      Promise.resolve().then(item.work).then(
        value=>{active-=1; completed+=1; item.resolve(value); drain();},
        error=>{active-=1; failed+=1; item.reject(error); drain();},
      );
    }
  }

  function run(work){
    if(typeof work!=='function') return Promise.reject(new TypeError('work-function-required'));
    if(active>=concurrency && pending.length>=maxPending){
      rejected+=1;
      return Promise.reject(new BackpressureError('titan-runtime-backpressure',{
        queue:name, concurrency, maxPending, active, pending:pending.length,
      }));
    }
    accepted+=1;
    return new Promise((resolve,reject)=>{
      pending.push({work,resolve,reject});
      highWater=Math.max(highWater,depth());
      drain();
    });
  }

  return Object.freeze({run,snapshot});
}
