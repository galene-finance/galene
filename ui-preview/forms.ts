// Preview submits are deliberately not executed or reported as successful.
export function deserialize(){throw new Error('Preview actions are disabled.');}
export async function applyAction(){throw new Error('Preview actions are disabled.');}
export function enhance(form:HTMLFormElement){const stop=(event:SubmitEvent)=>{event.preventDefault();alert('Synthetic component preview: save actions are disabled. Authenticated app acceptance remains required.');};form.addEventListener('submit',stop);return {destroy(){form.removeEventListener('submit',stop);}};}
