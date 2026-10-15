/* PISO WIFI premium branded dialogs. Loaded before Cashier modules. */
(function(){
  if (window.__pisoBrandedDialogsLoaded) return;
  window.__pisoBrandedDialogsLoaded = true;
  const style = document.createElement('style');
  style.textContent = `
  .piso-dialog-backdrop{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(3,10,20,.68);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px);}
  .piso-dialog{width:min(100%,440px);background:#fff;color:#122033;border:1px solid rgba(255,255,255,.35);border-radius:22px;box-shadow:0 28px 90px rgba(0,0,0,.34);overflow:hidden;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;animation:pisoDialogIn .18s ease-out;}
  @keyframes pisoDialogIn{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}
  .piso-dialog-top{height:6px;background:linear-gradient(90deg,#16a34a,#22c55e,#86efac)}
  .piso-dialog-content{padding:26px 26px 22px;text-align:center}
  .piso-dialog-mark{width:54px;height:54px;border-radius:17px;margin:0 auto 15px;display:grid;place-items:center;background:#dcfce7;color:#15803d;font-size:25px;font-weight:800}
  .piso-dialog-mark.warning{background:#fff7ed;color:#c2410c}.piso-dialog-mark.error{background:#fef2f2;color:#b91c1c}.piso-dialog-mark.info{background:#eff6ff;color:#1d4ed8}
  .piso-dialog-brand{font-size:11px;letter-spacing:.16em;font-weight:800;color:#16803d;text-transform:uppercase;margin-bottom:7px}
  .piso-dialog-title{font-size:21px;line-height:1.25;font-weight:800;letter-spacing:-.025em;margin:0 0 10px;color:#102033}
  .piso-dialog-message{font-size:14px;line-height:1.65;color:#526174;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
  .piso-dialog-actions{display:flex;justify-content:center;gap:10px;padding:0 26px 24px}
  .piso-dialog-btn{border:0;border-radius:12px;padding:12px 23px;font-size:14px;font-weight:750;cursor:pointer;min-width:112px;transition:transform .12s,filter .12s}
  .piso-dialog-btn:hover{filter:brightness(.97);transform:translateY(-1px)}.piso-dialog-primary{background:#15803d;color:#fff;box-shadow:0 5px 14px rgba(21,128,61,.2)}.piso-dialog-secondary{background:#eef2f7;color:#334155}
  @media(max-width:480px){.piso-dialog-content{padding:23px 20px 18px}.piso-dialog-actions{padding:0 20px 20px}.piso-dialog-title{font-size:19px}}
  `;
  document.head.appendChild(style);
  function classify(message){const m=String(message||'').toLowerCase();if(/not confirmed|not sent|failed|error|denied|could not|unable|invalid|rejected|was not/.test(m))return {kind:'error',icon:'×',title:/email|receipt/.test(m)?'Receipt Update':/payment|sale/.test(m)?'Payment Needs Attention':'Something Needs Attention'};if(/select |required|warning|already|cannot|please|must /.test(m))return {kind:'warning',icon:'!',title:'Please Check'};if(/saved|success|sent|confirmed|completed|updated|submitted|requested|transferred|uploaded|created/.test(m))return {kind:'success',icon:'✓',title:/sale/.test(m)?'Sale Saved':/payment/.test(m)?'Payment Confirmed':/email|receipt/.test(m)?'Receipt Update':'Successfully Completed'};return {kind:'info',icon:'i',title:'PISO WIFI Notice'};}
  function show(message, options={}){return new Promise(resolve=>{
    const details=classify(message);const back=document.createElement('div');back.className='piso-dialog-backdrop';back.setAttribute('role','presentation');
    const dialog=document.createElement('section');dialog.className='piso-dialog';dialog.setAttribute('role',options.confirm?'alertdialog':'alertdialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-labelledby','piso-dialog-title');
    const top=document.createElement('div');top.className='piso-dialog-top';
    const content=document.createElement('div');content.className='piso-dialog-content';
    const mark=document.createElement('div');mark.className='piso-dialog-mark '+details.kind;mark.textContent=details.icon;
    const brand=document.createElement('div');brand.className='piso-dialog-brand';brand.textContent='PISO WIFI';
    const title=document.createElement('h2');title.className='piso-dialog-title';title.id='piso-dialog-title';title.textContent=options.title||details.title;
    const msg=document.createElement('p');msg.className='piso-dialog-message';msg.textContent=String(message??'');
    content.append(mark,brand,title,msg);dialog.append(top,content);
    const actions=document.createElement('div');actions.className='piso-dialog-actions';
    function finish(value){document.removeEventListener('keydown',key);back.remove();resolve(value)}
    function key(e){if(e.key==='Escape'){e.preventDefault();finish(options.confirm?false:true)}if(e.key==='Enter'){e.preventDefault();finish(options.confirm?true:true)}}
    document.addEventListener('keydown',key);
    if(options.confirm){const cancel=document.createElement('button');cancel.className='piso-dialog-btn piso-dialog-secondary';cancel.textContent=options.cancelText||'Cancel';cancel.onclick=()=>finish(false);actions.appendChild(cancel)}
    const ok=document.createElement('button');ok.className='piso-dialog-btn piso-dialog-primary';ok.textContent=options.confirm?(options.confirmText||'Confirm'):'Got it';ok.onclick=()=>finish(options.confirm?true:true);actions.appendChild(ok);dialog.appendChild(actions);back.appendChild(dialog);
    back.addEventListener('click',e=>{if(e.target===back)finish(options.confirm?false:true)});document.body.appendChild(back);ok.focus();
  })}
  window.pisoNotify = (message, options={})=>show(message,options);
  window.pisoConfirm = (message, options={})=>show(message,{...options,confirm:true});
  window.alert = function(message){ show(message); };
})();
