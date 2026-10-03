/**
 * PISO WIFI — 6-DIGIT PASSWORD RECOVERY
 *
 * Add this block to the existing PISO WIFI Apps Script project.
 * It uses the existing MailApp/Gmail delivery capability.
 * The 6-digit code is one-time use and expires after 10 minutes.
 * After verification, the code itself becomes the customer's temporary
 * Firebase password. The existing first-login password-change flow remains
 * responsible for creating the customer's private password.
 */

const PISO_PASSWORD_RESET_BRIDGE_URL = 'https://piso-wifi.pages.dev/api/password-reset-code';
const PISO_PASSWORD_RESET_BRIDGE_SECRET = '-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D';
const PISO_PASSWORD_RESET_TTL_MS = 10 * 60 * 1000;
const PISO_PASSWORD_RESET_MAX_ATTEMPTS = 5;

function doPost(e) {
  try {
    const payload = JSON.parse(e?.postData?.contents || '{}');
    const action = String(payload.action || '').trim();

    if (action === 'requestCode') return passwordResetRequestCode_(payload);
    if (action === 'verifyCode') return passwordResetVerifyCode_(payload);

    return passwordResetJson_({ ok: false, error: 'Invalid password recovery action.' });
  } catch (error) {
    console.error(error);
    return passwordResetJson_({ ok: false, error: 'Unable to process the password recovery request.' });
  }
}

function passwordResetRequestCode_(payload) {
  const clientId = String(payload.clientId || '').trim().toUpperCase();
  const email = String(payload.email || '').trim().toLowerCase();

  if (!/^CID-\d{3,}$/.test(clientId) || !/^\S+@\S+\.\S+$/.test(email)) {
    return passwordResetJson_({ ok: false, error: 'Enter a valid Client ID and registered Gmail.' });
  }

  // The website never learns whether a customer exists from Firebase directly.
  // Apps Script asks the trusted server to verify the Client ID + Gmail pair.
  const accountCheck = passwordResetBridge_({
    action: 'verifyAccount',
    clientId,
    email
  });

  if (!accountCheck.ok) {
    return passwordResetJson_({ ok: false, error: accountCheck.error || 'The Client ID and registered Gmail do not match.' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const now = Date.now();
  const key = passwordResetKey_(clientId, email);

  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    codeHash: passwordResetHash_(code),
    clientId,
    email,
    createdAt: now,
    expiresAt: now + PISO_PASSWORD_RESET_TTL_MS,
    attempts: 0
  }));

  const subject = 'Your PISO WIFI verification code';
  const plainText = [
    'Hello,',
    '',
    'We received a request to reset the password for your PISO WIFI Customer Account.',
    '',
    'Your 6-digit verification code is:',
    '',
    code,
    '',
    'This code expires in 10 minutes and can only be used once.',
    'After verification, this code will become your temporary password. You will then be required to create a new private password when you log in.',
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    'Thank you,',
    'PISO WIFI Management System'
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:Arial,sans-serif;color:#17243a"><div style="max-width:560px;margin:30px auto;background:#fff;border:1px solid #e3eaf2;border-radius:18px;overflow:hidden"><div style="background:#0a2344;color:#fff;padding:28px;text-align:center"><div style="font-size:25px;font-weight:800">PISO WIFI</div><div style="font-size:11px;color:#b9d7f7;margin-top:6px;letter-spacing:.08em">CUSTOMER ACCOUNT SECURITY</div></div><div style="padding:32px"><p>Hello,</p><p>We received a request to reset the password for your PISO WIFI Customer Account.</p><p style="margin-top:26px;text-align:center;color:#64748b;font-size:12px;font-weight:700;letter-spacing:.08em">YOUR 6-DIGIT VERIFICATION CODE</p><div style="text-align:center;font-size:34px;font-weight:800;letter-spacing:8px;color:#0877e8;margin:10px 0 24px">${code}</div><div style="background:#f6f9fc;border:1px solid #e4ebf3;border-radius:12px;padding:15px;font-size:13px;line-height:1.7;color:#5e7187">This code expires in <strong>10 minutes</strong> and can only be used once. After verification, this code becomes your temporary password. You will then be required to create a new private password when you log in.</div><p style="font-size:13px;color:#6b7c90;line-height:1.7;margin-top:22px">If you did not request this, you can safely ignore this email.</p><p style="margin-top:24px">Thank you,<br><strong>PISO WIFI Management System</strong></p></div></div></body></html>`;

  MailApp.sendEmail({
    to: email,
    subject,
    body: plainText,
    htmlBody: html,
    name: 'PISO WIFI Management System'
  });

  return passwordResetJson_({ ok: true, codeSent: true });
}

function passwordResetVerifyCode_(payload) {
  const clientId = String(payload.clientId || '').trim().toUpperCase();
  const email = String(payload.email || '').trim().toLowerCase();
  const code = String(payload.code || '').trim();

  if (!/^CID-\d{3,}$/.test(clientId) || !/^\S+@\S+\.\S+$/.test(email) || !/^\d{6}$/.test(code)) {
    return passwordResetJson_({ ok: false, error: 'Enter the 6-digit verification code.' });
  }

  const key = passwordResetKey_(clientId, email);
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  if (!raw) return passwordResetJson_({ ok: false, error: 'The verification code is invalid or expired. Request a new code.' });

  const record = JSON.parse(raw);
  if (Date.now() > Number(record.expiresAt || 0)) {
    props.deleteProperty(key);
    return passwordResetJson_({ ok: false, error: 'The verification code has expired. Request a new code.' });
  }

  const attempts = Number(record.attempts || 0);
  if (attempts >= PISO_PASSWORD_RESET_MAX_ATTEMPTS) {
    props.deleteProperty(key);
    return passwordResetJson_({ ok: false, error: 'Too many incorrect attempts. Request a new code.' });
  }

  if (passwordResetHash_(code) !== String(record.codeHash || '')) {
    record.attempts = attempts + 1;
    props.setProperty(key, JSON.stringify(record));
    return passwordResetJson_({ ok: false, error: 'Incorrect verification code.' });
  }

  // The 6-digit code becomes the temporary Firebase password.
  const result = passwordResetBridge_({
    action: 'resetPassword',
    clientId,
    email,
    newPassword: code
  });

  if (!result.ok) {
    return passwordResetJson_({ ok: false, error: result.error || 'Unable to reset the customer password.' });
  }

  // One-time use: remove the code only after Firebase confirms the password reset.
  props.deleteProperty(key);

  return passwordResetJson_({ ok: true, passwordReset: true, temporaryPasswordSet: true });
}

function passwordResetBridge_(payload) {
  const body = Object.assign({}, payload, {
    bridgeSecret: PISO_PASSWORD_RESET_BRIDGE_SECRET
  });

  const response = UrlFetchApp.fetch(PISO_PASSWORD_RESET_BRIDGE_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
    followRedirects: true
  });

  let data = {};
  try {
    data = JSON.parse(response.getContentText() || '{}');
  } catch (error) {
    return { ok: false, error: 'Password recovery server returned an invalid response.' };
  }

  return response.getResponseCode() >= 200 && response.getResponseCode() < 300
    ? data
    : { ok: false, error: data.error || 'Password recovery server rejected the request.' };
}

function passwordResetHash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    const v = byte < 0 ? byte + 256 : byte;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function passwordResetKey_(clientId, email) {
  return 'PISO_RESET_CODE_' + passwordResetHash_(String(clientId).toUpperCase() + '|' + String(email).toLowerCase());
}

function passwordResetJson_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
