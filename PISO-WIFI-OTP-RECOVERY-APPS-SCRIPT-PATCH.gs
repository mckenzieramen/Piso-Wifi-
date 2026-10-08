/*************************************************
 * PISO WIFI — OTP PASSWORD RECOVERY PATCH
 *
 * Keep your existing create-client/admin functions.
 * Replace the OLD handleCustomerPasswordReset_()
 * and sendCustomPasswordResetEmail_() recovery
 * functions with the functions in this file, and
 * update doPost() customer recovery routing to use:
 *   requestOtp
 *   verifyOtp
 *   resetPassword
 *
 * This patch sends a 6-digit OTP (not a reset link),
 * verifies it for 10 minutes, then internally uses
 * Firebase's password-reset OOB code to set the new
 * password. The OOB link is NEVER emailed to the user.
 *************************************************/

function handleCustomerOtpRequest_(payload) {
  const clientId = String(payload.clientId || '').trim().toUpperCase();
  const email = String(payload.email || '').trim().toLowerCase();
  if (!/^CID-\d{3,}$/.test(clientId) || !email.includes('@'))
    return jsonResponse_({ok:false,error:'Invalid Client ID or registered Gmail.'});

  const rows = (Sheets.Spreadsheets.Values.get(SPREADSHEET_ID, `${CLIENTS_SHEET}!A2:J`).values || []);
  let client = null;
  for (const row of rows) {
    const id=String(row[0]||'').trim().toUpperCase();
    const rowEmail=String(row[3]||'').trim().toLowerCase();
    const status=String(row[7]||'').trim().toLowerCase();
    if(id===clientId && rowEmail===email){
      client={clientId:id,firstName:String(row[1]||'Customer').trim()||'Customer',email:rowEmail,status};
      break;
    }
  }
  if(!client) return jsonResponse_({ok:false,error:'The Client ID and registered Gmail do not match.'});
  if(['inactive','disabled','deactivated','closed'].includes(client.status)) return jsonResponse_({ok:false,error:'This customer account is inactive.'});

  const props=PropertiesService.getScriptProperties();
  const key='PISO_WIFI_OTP_'+Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,client.clientId+'|'+client.email)).replace(/=+$/,'');
  const existing=props.getProperty(key);
  if(existing){
    try{const e=JSON.parse(existing);if(e.lastSentAt && Date.now()-e.lastSentAt<60000)return jsonResponse_({ok:false,error:'Please wait 60 seconds before requesting another OTP.'});}catch(_){}}

  const code=String(Math.floor(100000+Math.random()*900000));
  const verificationToken=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  const expiresAt=Date.now()+10*60*1000;
  props.setProperty(key,JSON.stringify({verificationToken,clientId:client.clientId,email:client.email,firstName:client.firstName,code,expiresAt,attempts:0,verified:false,lastSentAt:Date.now()}));
  props.setProperty('PISO_WIFI_OTP_TOKEN_'+verificationToken,key);
  sendCustomerOtpEmail_(client.firstName,client.email,client.clientId,code);
  return jsonResponse_({ok:true,verificationToken,email:maskRecoveryEmail_(client.email),expiresInSeconds:600});
}

function handleCustomerOtpVerify_(payload) {
  const token=String(payload.verificationToken||'').trim();
  const code=String(payload.code||'').replace(/\D/g,'');
  if(!token || !/^\d{6}$/.test(code)) return jsonResponse_({ok:false,error:'Enter the 6-digit OTP.'});
  const props=PropertiesService.getScriptProperties();
  const key=props.getProperty('PISO_WIFI_OTP_TOKEN_'+token);
  if(!key) return jsonResponse_({ok:false,error:'This OTP session is invalid or expired. Please request a new OTP.'});
  const raw=props.getProperty(key); if(!raw)return jsonResponse_({ok:false,error:'This OTP session is invalid or expired. Please request a new OTP.'});
  const data=JSON.parse(raw);
  if(Date.now()>Number(data.expiresAt||0)){props.deleteProperty(key);props.deleteProperty('PISO_WIFI_OTP_TOKEN_'+token);return jsonResponse_({ok:false,error:'This OTP has expired. Please request a new code.'});}
  if(data.verified)return jsonResponse_({ok:true,verified:true});
  data.attempts=Number(data.attempts||0)+1;
  if(code!==String(data.code)){
    props.setProperty(key,JSON.stringify(data));
    const left=Math.max(0,5-data.attempts);
    if(left<=0){props.deleteProperty(key);props.deleteProperty('PISO_WIFI_OTP_TOKEN_'+token);return jsonResponse_({ok:false,error:'Too many incorrect attempts. Please request a new OTP.'});}
    return jsonResponse_({ok:false,error:`Incorrect OTP. ${left} attempt${left===1?'':'s'} remaining.`});
  }
  data.verified=true;data.verifiedAt=Date.now();props.setProperty(key,JSON.stringify(data));
  return jsonResponse_({ok:true,verified:true});
}

function handleCustomerOtpPasswordReset_(payload) {
  const token=String(payload.verificationToken||'').trim();
  const newPassword=String(payload.newPassword||'');
  if(!token || newPassword.length<8)return jsonResponse_({ok:false,error:'Please enter a valid new password of at least 8 characters.'});
  const props=PropertiesService.getScriptProperties();
  const key=props.getProperty('PISO_WIFI_OTP_TOKEN_'+token);if(!key)return jsonResponse_({ok:false,error:'Your verification session is invalid or expired. Please start again.'});
  const raw=props.getProperty(key);if(!raw)return jsonResponse_({ok:false,error:'Your verification session is invalid or expired. Please start again.'});
  const data=JSON.parse(raw);
  if(!data.verified)return jsonResponse_({ok:false,error:'Please verify the OTP first.'});
  if(Date.now()>Number(data.expiresAt||0)){props.deleteProperty(key);props.deleteProperty('PISO_WIFI_OTP_TOKEN_'+token);return jsonResponse_({ok:false,error:'Your verification session has expired. Please request a new OTP.'});}

  const apiKey='AIzaSyAfX3sSDkJwX9u9dxEDbhG8RU3iP_k6EdI';
  const send=UrlFetchApp.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(apiKey)}`,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({requestType:'PASSWORD_RESET',email:data.email,returnOobLink:true})});
  let sendData={};try{sendData=JSON.parse(send.getContentText()||'{}');}catch(_){ }
  let oobCode=String(sendData.oobCode||'');
  if(!oobCode && sendData.oobLink){const m=String(sendData.oobLink).match(/[?&]oobCode=([^&]+)/);if(m)oobCode=decodeURIComponent(m[1]);}
  if(send.getResponseCode()<200||send.getResponseCode()>=300||!oobCode){console.error('[PISO WIFI OTP RESET]',send.getContentText());return jsonResponse_({ok:false,error:'Unable to prepare the password update. Please try again.'});}

  const reset=UrlFetchApp.fetch(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${encodeURIComponent(apiKey)}`,{method:'post',contentType:'application/json',muteHttpExceptions:true,payload:JSON.stringify({oobCode,newPassword})});
  let resetData={};try{resetData=JSON.parse(reset.getContentText()||'{}');}catch(_){ }
  if(reset.getResponseCode()<200||reset.getResponseCode()>=300){console.error('[PISO WIFI OTP RESET APPLY]',reset.getContentText());return jsonResponse_({ok:false,error:'Unable to update your password. Please request a new OTP and try again.'});}
  props.deleteProperty(key);props.deleteProperty('PISO_WIFI_OTP_TOKEN_'+token);
  return jsonResponse_({ok:true,passwordUpdated:true});
}

function sendCustomerOtpEmail_(firstName,email,clientId,code){
  const safeFirst=escapeHtml(firstName),safeId=escapeHtml(clientId),safeCode=escapeHtml(code);
  const subject='Your PISO WIFI verification code';
  const plain=`Dear ${firstName},\n\nYour PISO WIFI verification code is: ${code}\n\nThis code expires in 10 minutes. Do not share it with anyone.\n\nCustomer ID: ${clientId}\n\nPISO WIFI Management System\nConnect · Earn · Grow Together`;
  const html=`<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17243a"><div style="max-width:620px;margin:32px auto;background:#fff;border:1px solid #e3eaf2;border-radius:18px;overflow:hidden"><div style="background:#0a2344;padding:28px;text-align:center;color:#fff"><div style="font-size:26px;font-weight:800">PISO WIFI</div><div style="font-size:12px;color:#b9d7f7;margin-top:6px">CONNECT · EARN · GROW TOGETHER</div></div><div style="padding:34px 30px"><div style="font-size:11px;font-weight:800;color:#0877e8;letter-spacing:1.5px">ACCOUNT VERIFICATION</div><h1 style="color:#102a4c">Your 6-digit verification code</h1><p>Dear <strong>${safeFirst}</strong>,</p><p style="color:#5e7187;line-height:1.7">Use the code below to verify your PISO WIFI Customer Account password-recovery request.</p><div style="text-align:center;background:#f6f9fc;border:1px solid #e4ebf3;border-radius:14px;padding:24px;margin:24px 0"><div style="font-size:12px;color:#7b8999;letter-spacing:1px">VERIFICATION CODE</div><div style="font-size:36px;font-weight:900;letter-spacing:10px;color:#102a4c;margin:10px 0 4px">${safeCode}</div><div style="font-size:12px;color:#7b8999">Expires in 10 minutes</div></div><p style="color:#5e7187;line-height:1.7">Customer ID: <strong>${safeId}</strong></p><div style="background:#fff7ed;border-left:4px solid #f97316;padding:14px 16px;border-radius:8px;color:#7c2d12;font-size:13px;line-height:1.6">Never share this code. PISO WIFI will never ask for your verification code.</div><p style="margin-top:24px">Thank you,<br><strong>PISO WIFI Management System</strong></p></div><div style="background:#f8fafc;border-top:1px solid #e8eef5;padding:16px;text-align:center;color:#8a98a8;font-size:11px">This is an automated account-security email. Please do not reply.</div></div></body></html>`;
  GmailApp.sendEmail(email,subject,plain,{name:'PISO WIFI Management System',replyTo:Session.getEffectiveUser().getEmail(),htmlBody:html});
}
function maskRecoveryEmail_(email){const [u,d]=String(email).split('@');if(!d)return email;const left=u.length<=2?u[0]+'*':u.slice(0,2)+'***';return left+'@'+d;}

/* Add these branches near the top of your existing doPost(), before secret validation:
if (String(payload.action||'').trim()==='requestOtp') return handleCustomerOtpRequest_(payload);
if (String(payload.action||'').trim()==='verifyOtp') return handleCustomerOtpVerify_(payload);
if (String(payload.action||'').trim()==='resetPassword') return handleCustomerOtpPasswordReset_(payload);
*/
