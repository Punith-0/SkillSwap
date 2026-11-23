/* Six-digit email adaptation of the supplied orbit/merge OTP interaction. */
(()=>{
 const records=new WeakMap();
 function attach(input){
  if(records.has(input))return records.get(input);
  const shell=document.createElement('div');shell.className='orbit-code';shell.dataset.state='entry';
  input.before(shell);shell.append(input);input.classList.add('orbit-code-input');
  const wheel=document.createElement('div');wheel.className='digit-wheel';wheel.setAttribute('aria-hidden','true');
  const boxes=Array.from({length:6},(_,i)=>{const box=document.createElement('span');box.className='digit-box';box.style.setProperty('--flat-x',`${(i-2.5)*44}px`);box.style.setProperty('--orbit-x',`${Math.cos(i*Math.PI/3-Math.PI/2)*51}px`);box.style.setProperty('--orbit-y',`${Math.sin(i*Math.PI/3-Math.PI/2)*51}px`);wheel.append(box);return box;});
  shell.append(wheel);const tick=document.createElement('span');tick.className='otp-check';tick.textContent='✓';tick.setAttribute('aria-hidden','true');shell.append(tick);
  const status=document.createElement('p');status.className='otp-state-label';status.setAttribute('role','status');shell.after(status);
  function paint(){const code=input.value.replace(/\D/g,'').slice(0,6);if(input.value!==code)input.value=code;boxes.forEach((b,i)=>{b.textContent=code[i]||'';b.classList.toggle('filled',i<code.length);b.classList.toggle('current',document.activeElement===input&&i===Math.min(input.selectionStart??code.length,5));});}
  for(const event of ['input','focus','blur','keyup','click'])input.addEventListener(event,paint);
  const record={paint,setState(state){shell.dataset.state=state;input.setAttribute('aria-invalid',state==='error'?'true':'false');input.readOnly=state==='checking'||state==='success';status.textContent=state==='checking'?'Verifying securely…':state==='success'?'Verified. You’re in.':state==='error'?'Code not accepted. Check it and try again.':'';paint();}};
  records.set(input,record);paint();return record;
 }
 window.OrbitOTP={attach,setState(input,state){attach(input).setState(state);}};
})();
