const CLIENT_PORTAL_URL = 'https://piso-wifi.pages.dev/';
const PASSWORD_RESET_MAILER_SECRET = '-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D';

function doPost(e) {
  try {
    const body = JSON.parse(e?.postData?.contents || '{}');
    if (body.secret !== PASSWORD_RESET_MAILER_SECRET) return json_({ok:false,error:'Unauthorized'});

    const email = String(body.email || '').trim().toLowerCase();
    const clientId = String(body.clientId || '').trim().toUpperCase();
    const firstName = String(body.firstName || 'Customer').trim() || 'Customer';
    const resetLink = String(body.resetLink || '').trim();

    if (!email || !/^CID-\d{3,}$/.test(clientId) || !/^https:\/\//i.test(resetLink)) {
      return json_({ok:false,error:'Invalid request'});
    }

    sendCustomPasswordResetEmail_(email, clientId, firstName, resetLink);
    return json_({ok:true,emailSent:true});
  } catch (err) {
    console.error(err);
    return json_({ok:false,error:String(err && err.message || err)});
  }
}

function sendCustomPasswordResetEmail_(email, clientId, firstName, resetLink) {
  const subject = 'PISO WIFI — Reset Your Customer Account Password';
  const safeName = escapeHtml_(firstName);
  const safeClientId = escapeHtml_(clientId);
  const safeLink = escapeHtml_(resetLink);

  const htmlBody = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PISO WIFI Password Reset</title></head>
<body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#17243a;">
  <div style="max-width:640px;margin:32px auto;background:#fff;border:1px solid #e4eaf2;border-radius:16px;overflow:hidden;">
    <div style="background:#0b2342;padding:28px 32px;color:#fff;">
      <div style="font-size:24px;font-weight:800;letter-spacing:.4px;">PISO WIFI</div>
      <div style="margin-top:5px;font-size:12px;letter-spacing:1.6px;opacity:.82;">CONNECT · EARN · GROW TOGETHER</div>
    </div>
    <div style="padding:36px 32px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:1.4px;color:#1685f5;">CUSTOMER ACCOUNT SECURITY</div>
      <h1 style="margin:8px 0 18px;font-size:28px;line-height:1.2;color:#10243f;">Reset your password</h1>
      <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Dear ${safeName},</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">We received a request to reset the password associated with your PISO WIFI Customer Account.</p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 8px;">Customer ID: <strong>${safeClientId}</strong></p>
      <p style="font-size:15px;line-height:1.7;margin:0 0 24px;">To create a new private password, please click the button below.</p>
      <div style="text-align:center;margin:28px 0 30px;"><a href="${safeLink}" style="display:inline-block;background:#1685f5;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:9px;">Reset My Password</a></div>
      <div style="background:#f5f8fc;border:1px solid #e3eaf3;border-radius:10px;padding:16px;font-size:13px;line-height:1.6;color:#5d6b7d;">
        <strong>For your security:</strong><br>
        • This reset link is intended only for the account holder.<br>
        • Never share your reset link or new password with anyone.<br>
        • Your password is private and is not displayed to Admin.
      </div>
      <p style="font-size:14px;line-height:1.7;margin:24px 0 0;color:#526174;">If you did not request this password reset, you may safely ignore this email. Your password will remain unchanged.</p>
      <p style="font-size:15px;line-height:1.7;margin:28px 0 0;">Sincerely,<br><strong>PISO WIFI Management System</strong><br><span style="color:#7a8797;">Connect · Earn · Grow Together</span></p>
    </div>
    <div style="background:#f7f9fc;border-top:1px solid #e6ebf2;padding:20px 32px;text-align:center;font-size:12px;color:#7a8797;">This is an automated account-security message from PISO WIFI. Please do not reply to this email.</div>
  </div>
</body>
</html>`;

  const plainBody = `PISO WIFI\n\nDear ${firstName},\n\nWe received a request to reset the password associated with your PISO WIFI Customer Account (${clientId}).\n\nReset your password here:\n${resetLink}\n\nIf you did not request this password reset, you may safely ignore this email.`;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: 'PISO WIFI Management System'
  });
}

function escapeHtml_(value) {
  return String(value || '').replace(/[&<>"']/g, function(ch) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
  });
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
