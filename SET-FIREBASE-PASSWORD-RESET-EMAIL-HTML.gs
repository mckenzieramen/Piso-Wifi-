/**
 * PISO WIFI — ENABLE HTML PASSWORD RESET EMAIL
 *
 * Run setupFirebasePasswordResetHtmlEmail() ONCE from the
 * existing PISO WIFI Google Apps Script project.
 *
 * This keeps the current working Firebase sendPasswordResetEmail()
 * flow. It only changes Firebase Authentication's password-reset
 * email template format from plain text to HTML and installs the
 * PISO WIFI HTML template.
 *
 * Requires the Apps Script project to have either:
 *   https://www.googleapis.com/auth/identitytoolkit
 * or
 *   https://www.googleapis.com/auth/cloud-platform
 */

const PISO_WIFI_FIREBASE_PROJECT_ID = 'piso-wifi-f2b5c';

function setupFirebasePasswordResetHtmlEmail() {
  const htmlBody = `<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>PISO WIFI Password Reset Email</title></head>\n<body style=\"margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#17243a;\">\n  <div style=\"max-width:640px;margin:32px auto;background:#fff;border:1px solid #e4eaf2;border-radius:16px;overflow:hidden;\">\n    <div style=\"background:#0b2342;padding:28px 32px;color:#fff;\">\n      <div style=\"font-size:24px;font-weight:800;letter-spacing:.4px;\">PISO WIFI</div>\n      <div style=\"margin-top:5px;font-size:12px;letter-spacing:1.6px;opacity:.82;\">MANAGEMENT SYSTEM</div>\n    </div>\n    <div style=\"padding:36px 32px;\">\n      <div style=\"font-size:12px;font-weight:700;letter-spacing:1.4px;color:#1685f5;\">ACCOUNT SECURITY</div>\n      <h1 style=\"margin:8px 0 18px;font-size:28px;line-height:1.2;color:#10243f;\">Reset your password</h1>\n      <p style=\"font-size:15px;line-height:1.7;margin:0 0 16px;\">Dear Customer,</p>\n      <p style=\"font-size:15px;line-height:1.7;margin:0 0 16px;\">We received a request to reset the password associated with your PISO WIFI Customer Account.</p>\n      <p style=\"font-size:15px;line-height:1.7;margin:0 0 24px;\">To create a new private password, please click the button below.</p>\n      <div style=\"text-align:center;margin:28px 0 30px;\"><a href=\"%LINK%\" style=\"display:inline-block;background:#1685f5;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:9px;\">Reset My Password</a></div>\n      <div style=\"background:#f5f8fc;border:1px solid #e3eaf3;border-radius:10px;padding:16px;font-size:13px;line-height:1.6;color:#5d6b7d;\">For your security, this password-reset link is intended only for the account holder. Please do not share it with anyone.</div>\n      <p style=\"font-size:14px;line-height:1.7;margin:24px 0 0;color:#526174;\">If you did not request this password reset, you may safely ignore this email. Your password will remain unchanged.</p>\n      <p style=\"font-size:15px;line-height:1.7;margin:28px 0 0;\">Sincerely,<br><strong>PISO WIFI Management System</strong><br><span style=\"color:#7a8797;\">Connect \u00b7 Earn \u00b7 Grow Together</span></p>\n    </div>\n    <div style=\"background:#f7f9fc;border-top:1px solid #e6ebf2;padding:20px 32px;text-align:center;font-size:12px;color:#7a8797;\">This is an automated account-security message from PISO WIFI. Please do not reply to this email.</div>\n  </div>\n</body>\n</html>\n`;

  const token = ScriptApp.getOAuthToken();

  const url =
    'https://identitytoolkit.googleapis.com/admin/v2/projects/' +
    encodeURIComponent(PISO_WIFI_FIREBASE_PROJECT_ID) +
    '/config?updateMask=' +
    encodeURIComponent(
      'notification.sendEmail.resetPasswordTemplate.body,' +
      'notification.sendEmail.resetPasswordTemplate.bodyFormat,' +
      'notification.sendEmail.resetPasswordTemplate.subject,' +
      'notification.sendEmail.resetPasswordTemplate.senderDisplayName'
    );

  const payload = {
    name: `projects/${PISO_WIFI_FIREBASE_PROJECT_ID}/config`,
    notification: {
      sendEmail: {
        resetPasswordTemplate: {
          subject: 'Password Reset Request — PISO WIFI Customer Account',
          senderDisplayName: 'PISO WIFI Management System',
          body: htmlBody,
          bodyFormat: 'HTML'
        }
      }
    }
  };

  const response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      'X-Goog-User-Project': PISO_WIFI_FIREBASE_PROJECT_ID
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = response.getResponseCode();
  const body = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Firebase HTML email setup failed (' + code + '): ' + body
    );
  }

  Logger.log('PISO WIFI password-reset email is now configured as HTML.');
  Logger.log(body);
}
