// Isolated component harness only. Never performs a request or simulates a successful save.
import type {SubmitFunction} from '@sveltejs/kit';
export function deserialize(){throw new Error('Preview actions are disabled.');}
export async function applyAction(){throw new Error('Preview actions are disabled.');}
export function enhance(form:HTMLFormElement,submit?:SubmitFunction){
 const stop=async(event:SubmitEvent)=>{
  event.preventDefault();
  if(!new URL(location.href).searchParams.has('qa_error')||!submit){alert('Synthetic component preview: saves are disabled.');return;}
  const controller=new AbortController();let cancelled=false;
  const callback=await submit({action:new URL(form.action),formData:new FormData(form),formElement:form,controller,submitter:event.submitter,cancel:()=>{cancelled=true;}});
  if(callback&&!cancelled){(window as any).__qaRejected=true;await callback({action:new URL(form.action),formData:new FormData(form),formElement:form,result:new URL(location.href).searchParams.get('qa_error')==='network'?{type:'error',status:500,error:{message:'Synthetic failure'}}:{type:'success',status:200,data:{error:'Fixture validation error — no save executed.'}},update:async()=>{}});}
 };
 form.addEventListener('submit',stop);return {destroy(){form.removeEventListener('submit',stop);}};
}
