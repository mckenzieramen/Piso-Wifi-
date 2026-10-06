/*************************************************

 * PISO WIFI BACKEND

 * Google Apps Script + Google Sheets API

 *************************************************/



let SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('PISO_WIFI_SPREADSHEET_ID') || '';



const CLIENTS_SHEET = 'Clients';

const MAX_UNITS = 50;



// Replace this later with your actual Client Portal URL

const CLIENT_PORTAL_URL = 'https\://piso-wifi.pages.dev/';
/*************************************************
 * AUTO-CREATE PISO WIFI DATABASE
 *************************************************/
function ensurePisoWifiDatabase_() {
  if (SPREADSHEET_ID) return SPREADSHEET_ID;

  const props = PropertiesService.getScriptProperties();
  const storedId = props.getProperty('PISO_WIFI_SPREADSHEET_ID');
  if (storedId) {
    SPREADSHEET_ID = storedId;
    return SPREADSHEET_ID;
  }

  const ss = SpreadsheetApp.create('PISO WIFI DATABASE');
  const clients = ss.getSheets()[0];
  clients.setName(CLIENTS_SHEET);
  clients.getRange(1, 1, 1, 10).setValues([[
    'Unit ID','First Name','Last Name','Email','Phone',
    'Temporary Password','Password Changed','Account Status',
    'Created At','Last Login'
  ]]);
  clients.setFrozenRows(1);
  clients.autoResizeColumns(1, 10);

  SPREADSHEET_ID = ss.getId();
  props.setProperty('PISO_WIFI_SPREADSHEET_ID', SPREADSHEET_ID);
  Logger.log('PISO WIFI DATABASE: ' + ss.getUrl());
  return SPREADSHEET_ID;
}

function getPisoWifiDatabaseUrl() {
  const id = ensurePisoWifiDatabase_();
  const url = 'https://docs.google.com/spreadsheets/d/' + id + '/edit';
  Logger.log(url);
  return url;
}







/*************************************************

 * 1. TEST SPREADSHEET CONNECTION

 *************************************************/



function testSpreadsheetConnection() {
  ensurePisoWifiDatabase_();

  const spreadsheet = Sheets.Spreadsheets.get(SPREADSHEET_ID);



  Logger.log(spreadsheet.properties.title);

}





/*************************************************

 * 2. TEST CLIENTS SHEET

 *************************************************/



function testClientsSheet() {
  ensurePisoWifiDatabase_();

  const response = Sheets.Spreadsheets.Values.get(

    SPREADSHEET_ID,

    `${CLIENTS_SHEET}!A1:J1`

  );



  if (!response.values || response.values.length === 0) {

    Logger.log('Clients sheet is empty.');

    return;

  }



  Logger.log(response.values[0]);

}





/*************************************************

 * 3. GET NEXT UNIT ID

 *

 * C-001 → C-002 → C-003 ... → C-050

 *************************************************/



function getNextUnitId() {
  ensurePisoWifiDatabase_();



  const response = Sheets.Spreadsheets.Values.get(

    SPREADSHEET_ID,

    `${CLIENTS_SHEET}!A2:A`

  );



  const values = response.values || [];



  let nextNumber = 1;



  if (values.length > 0) {



    const numbers = values

      .map(row => row[0])

      .filter(id => /^C-\d{3}$/.test(id))

      .map(id => Number(id.substring(2)));



    if (numbers.length > 0) {

      nextNumber = Math.max(...numbers) + 1;

    }

  }



  if (nextNumber > MAX_UNITS) {

    throw new Error(

      'All Unit IDs from C-001 to C-050 are already assigned.'

    );

  }



  return `C-${String(nextNumber).padStart(3, '0')}`;

}





/*************************************************

 * 4. TEST NEXT UNIT ID

 *************************************************/



function testNextUnitId() {



  const nextUnitId = getNextUnitId();



  Logger.log(nextUnitId);

}





/*************************************************

 * 5. CREATE CLIENT

 *

 * Creates:

 * - Unit ID

 * - Temporary Password

 * - Client information

 * - Account status

 *

 * Also sends the HTML welcome email.

 *

 * IMPORTANT:

 * Final customer password is NOT stored here.

 *************************************************/



function createClient(firstName, lastName, email, phone) {
  ensurePisoWifiDatabase_();



  if (!firstName || !lastName || !email) {



    throw new Error(

      'First Name, Last Name, and Email are required.'

    );

  }



  const unitId = getNextUnitId();



  // Temporary password

  // Customer must change this after first login.

  const temporaryPassword = unitId;



  const createdAt = new Date().toISOString();



  const row = [

    unitId,

    firstName,

    lastName,

    email,

    phone || '',

    temporaryPassword,

    false,

    'Pending',

    createdAt,

    ''

  ];



  /***********************************************

   * SAVE CLIENT TO GOOGLE SHEETS

   ***********************************************/



  Sheets.Spreadsheets.Values.append(

    {

      values: [row]

    },

    SPREADSHEET_ID,

    `${CLIENTS_SHEET}!A:J`,

    {

      valueInputOption: 'USER_ENTERED'

    }

  );





  /***********************************************

   * SEND HTML WELCOME EMAIL

   ***********************************************/



  sendClientWelcomeEmail(

    firstName,

    email,

    unitId,

    temporaryPassword

  );





  return {



    success: true,



    unitId: unitId,



    temporaryPassword: temporaryPassword,



    status: 'Pending',



    emailSent: true

  };

}





/*************************************************

 * 6. SEND CLIENT HTML WELCOME EMAIL

 *************************************************/



function sendClientWelcomeEmail(

  firstName,

  email,

  unitId,

  temporaryPassword

) {



  const subject =

    'Welcome to Piso WiFi — Your Client Account';





  const htmlBody = `



\<!DOCTYPE html>



\<html>



\<head>



  \<meta charset="UTF-8">



  \<meta

    name="viewport"

    content="width=device-width, initial-scale=1.0"

  >



  \<title>Piso WiFi Account\</title>



\</head>





\<body style="

  margin:0;

  padding:0;

  background:#f4f6f8;

  font-family:Arial,Helvetica,sans-serif;

">





  \<div style="

    max-width:620px;

    margin:30px auto;

    background:#ffffff;

    border-radius:14px;

    overflow:hidden;

    box-shadow:0 4px 18px rgba(0,0,0,0.08);

  ">





    \<!-- HEADER -->



    \<div style="

      background:#111827;

      padding:30px 25px;

      text-align:center;

    ">



      \<div style="

        font-size:28px;

        font-weight:bold;

        color:#ffffff;

        letter-spacing:1px;

      ">



        PISO WiFi



      \</div>





      \<div style="

        margin-top:8px;

        color:#d1d5db;

        font-size:14px;

      ">



        Client Account Portal



      \</div>



    \</div>







    \<!-- CONTENT -->



    \<div style="

      padding:35px 30px;

      color:#1f2937;

    ">





      \<h2 style="

        margin-top:0;

        font-size:24px;

        color:#111827;

      ">



        Welcome, ${escapeHtml(firstName)}! 👋



      \</h2>





      \<p style="

        font-size:15px;

        line-height:1.7;

      ">



        Your Piso WiFi client account has been created

        successfully.



        Below are your temporary login credentials.



      \</p>







      \<!-- ACCOUNT CARD -->



      \<div style="

        margin:25px 0;

        padding:22px;

        background:#f8fafc;

        border:1px solid #e5e7eb;

        border-radius:12px;

      ">





        \<div style="

          font-size:13px;

          color:#6b7280;

          margin-bottom:6px;

        ">



          UNIT ID



        \</div>





        \<div style="

          font-size:24px;

          font-weight:bold;

          color:#111827;

          margin-bottom:20px;

        ">



          ${escapeHtml(unitId)}



        \</div>







        \<div style="

          font-size:13px;

          color:#6b7280;

          margin-bottom:6px;

        ">



          TEMPORARY PASSWORD



        \</div>





        \<div style="

          font-size:24px;

          font-weight:bold;

          color:#111827;

        ">



          ${escapeHtml(temporaryPassword)}



        \</div>



      \</div>







      \<!-- IMPORTANT NOTICE -->



      \<div style="

        background:#fff7ed;

        border-left:4px solid #f97316;

        padding:15px 18px;

        border-radius:6px;

        margin:20px 0;

      ">





        \<strong style="color:#9a3412;">



          Important



        \</strong>





        \<p style="

          margin:7px 0 0;

          font-size:14px;

          line-height:1.6;

          color:#7c2d12;

        ">



          This is a temporary password.



          You will be required to create your own

          password when you log in for the first time.



        \</p>



      \</div>







      \<!-- FIRST LOGIN -->



      \<h3 style="

        font-size:18px;

        color:#111827;

        margin-top:30px;

      ">



        First Login



      \</h3>





      \<ol style="

        padding-left:22px;

        font-size:14px;

        line-height:1.8;

        color:#374151;

      ">



        \<li>

          Open the Piso WiFi Client Portal.

        \</li>



        \<li>

          Enter your Unit ID.

        \</li>



        \<li>

          Enter your temporary password.

        \</li>



        \<li>

          Verify your account information.

        \</li>



        \<li>

          Create your new personal password.

        \</li>



      \</ol>







      \<!-- LOGIN BUTTON -->



      \<div style="

        text-align:center;

        margin:32px 0;

      ">





        \<a

          href="${CLIENT_PORTAL_URL}"

          style="

            display:inline-block;

            padding:14px 28px;

            background:#111827;

            color:#ffffff;

            text-decoration:none;

            border-radius:8px;

            font-size:15px;

            font-weight:bold;

          "

        >



          Open Client Portal



        \</a>





      \</div>







      \<p style="

        font-size:13px;

        line-height:1.6;

        color:#6b7280;

      ">



        If you did not expect this account,

        please contact the Piso WiFi administrator

        immediately.



      \</p>





    \</div>







    \<!-- FOOTER -->



    \<div style="

      background:#f9fafb;

      border-top:1px solid #e5e7eb;

      padding:20px;

      text-align:center;

      color:#9ca3af;

      font-size:12px;

    ">



      © ${new Date().getFullYear()} Piso WiFi



      \<br>



      This is an automated message.

      Please do not reply.



    \</div>





  \</div>





\</body>



\</html>



`;





  /***********************************************

   * PLAIN TEXT FALLBACK

   ***********************************************/



  const plainTextBody =



    `Welcome to Piso WiFi, ${firstName}!\n\n` +



    `Your client account has been created.\n\n` +



    `Unit ID: ${unitId}\n` +



    `Temporary Password: ${temporaryPassword}\n\n` +



    `Please log in to the Client Portal and change ` +

    `your temporary password after your first login.\n\n` +



    `Client Portal:\n${CLIENT_PORTAL_URL}`;







  /***********************************************

   * SEND EMAIL

   ***********************************************/



  MailApp.sendEmail({



    to: email,



    subject: subject,



    body: plainTextBody,



    htmlBody: htmlBody



  });



}





/*************************************************

 * 7. ESCAPE HTML

 *************************************************/



function escapeHtml(value) {



  return String(value)



    .replace(/&/g, '&amp;')



    .replace(/\</g, '&lt;')



    .replace(/>/g, '&gt;')



    .replace(/"/g, '&quot;')



    .replace(/'/g, '&#039;');



}

/*************************************************

 * 9. CUSTOM PASSWORD RECOVERY — 6-DIGIT CODE

 *

 * Flow:

 * 1) Website sends Client ID + registered Gmail.

 * 2) Apps Script verifies the customer in the Clients sheet.

 * 3) A 6-digit one-time code is generated and emailed.

 * 4) Website verifies the code.

 * 5) Apps Script returns a short-lived one-time reset token.

 * 6) Website submits the new password; Apps Script updates

 *    Firebase Authentication through the Identity Platform

 *    admin REST API using the Apps Script OAuth token.

 *

 * The final password is NEVER stored in Google Sheets or

 * Apps Script Properties.

 *************************************************/



const FIREBASE_PROJECT_ID = 'piso-wifi-f2b5c5';

const PASSWORD_CODE_TTL_MS = 10 * 60 * 1000;

const PASSWORD_RESET_TOKEN_TTL_MS = 10 * 60 * 1000;

const PASSWORD_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

const PASSWORD_CODE_MAX_ATTEMPTS = 5;

const PASSWORD_RESET_STORE_PREFIX = 'PISO_WIFI_RESET_V2_';





/*************************************************

 * 10. PASSWORD RECOVERY WEB APP ENDPOINT

 *************************************************/



function doPost(e) {

  try {
    ensurePisoWifiDatabase_();

    const payload = JSON.parse(

      e && e.postData && e.postData.contents

        ? e.postData.contents

        : '{}'

    );



    const action = String(payload.action || '').trim();



    if (action === 'syncClient') {
      return jsonResponse_(syncClientToSheet_(payload));
    }

    if (action === 'requestCode') {

      return jsonResponse_(requestPasswordCode_(payload));

    }



    if (action === 'verifyCode') {

      return jsonResponse_(verifyPasswordCode_(payload));

    }



    if (action === 'resetPassword') {

      return jsonResponse_(resetPassword_(payload));

    }



    return jsonResponse_({

      ok: false,

      error: 'Unsupported password recovery action.'

    });



  } catch (error) {

    console.error(error);

    return jsonResponse_({

      ok: false,

      error: error && error.message

        ? error.message

        : 'Password recovery request failed.'

    });

  }

}





/*************************************************

 * 11. REQUEST 6-DIGIT CODE

 *************************************************/



function requestPasswordCode_(payload) {

  const clientId = String(payload.clientId || '').trim().toUpperCase();

  const email = String(payload.email || '').trim().toLowerCase();



  if (!/^CID-\d{3,}$/.test(clientId)) {

    throw new Error('Enter a valid Client ID.');

  }



  if (!email || !email.includes('@')) {

    throw new Error('Enter a valid registered Gmail address.');

  }



  const client = findClientForPasswordReset_(clientId, email);

  if (!client) {

    throw new Error('The Client ID and registered Gmail do not match our records.');

  }



  const key = passwordResetStoreKey_(clientId, email);

  const properties = PropertiesService.getScriptProperties();

  const existing = readJsonProperty_(properties, key);

  const now = Date.now();



  if (existing && existing.cooldownUntil && Number(existing.cooldownUntil) > now) {

    const seconds = Math.max(1, Math.ceil((Number(existing.cooldownUntil) - now) / 1000));

    throw new Error(`Please wait ${seconds} seconds before requesting another code.`);

  }



  const code = generateSixDigitCode_();

  const record = {

    clientId,

    email,

    codeHash: sha256Hex_(code),

    codeExpiresAt: now + PASSWORD_CODE_TTL_MS,

    cooldownUntil: now + PASSWORD_CODE_RESEND_COOLDOWN_MS,

    attempts: 0,

    verified: false,

    resetTokenHash: '',

    resetTokenExpiresAt: 0,

    createdAt: now

  };



  properties.setProperty(key, JSON.stringify(record));

  sendPasswordVerificationEmail_(client.firstName || 'Customer', email, clientId, code);



  return {

    ok: true,

    emailSent: true,

    expiresInSeconds: Math.floor(PASSWORD_CODE_TTL_MS / 1000)

  };

}





/*************************************************

 * 12. VERIFY 6-DIGIT CODE

 *************************************************/



function verifyPasswordCode_(payload) {

  const clientId = String(payload.clientId || '').trim().toUpperCase();

  const email = String(payload.email || '').trim().toLowerCase();

  const code = String(payload.code || '').trim();



  if (!/^CID-\d{3,}$/.test(clientId) || !email || !/^\d{6}$/.test(code)) {

    throw new Error('Enter the 6-digit verification code.');

  }



  const key = passwordResetStoreKey_(clientId, email);

  const properties = PropertiesService.getScriptProperties();

  const record = readJsonProperty_(properties, key);

  const now = Date.now();



  if (!record) {

    throw new Error('No active verification code was found. Request a new code.');

  }



  if (Number(record.codeExpiresAt) <= now) {

    properties.deleteProperty(key);

    throw new Error('That verification code has expired. Request a new code.');

  }



  if (Number(record.attempts || 0) >= PASSWORD_CODE_MAX_ATTEMPTS) {

    properties.deleteProperty(key);

    throw new Error('Too many incorrect attempts. Request a new code.');

  }



  if (record.codeHash !== sha256Hex_(code)) {

    record.attempts = Number(record.attempts || 0) + 1;

    properties.setProperty(key, JSON.stringify(record));

    const remaining = Math.max(0, PASSWORD_CODE_MAX_ATTEMPTS - record.attempts);

    throw new Error(`Incorrect verification code. ${remaining} attempt(s) remaining.`);

  }



  const resetToken = randomToken_();

  record.verified = true;

  record.resetTokenHash = sha256Hex_(resetToken);

  record.resetTokenExpiresAt = now + PASSWORD_RESET_TOKEN_TTL_MS;

  record.codeHash = '';

  record.codeExpiresAt = 0;

  record.attempts = PASSWORD_CODE_MAX_ATTEMPTS;

  properties.setProperty(key, JSON.stringify(record));



  return {

    ok: true,

    resetToken,

    expiresInSeconds: Math.floor(PASSWORD_RESET_TOKEN_TTL_MS / 1000)

  };

}





/*************************************************

 * 13. RESET FIREBASE PASSWORD

 *************************************************/



function resetPassword_(payload) {

  const clientId = String(payload.clientId || '').trim().toUpperCase();

  const email = String(payload.email || '').trim().toLowerCase();

  const resetToken = String(payload.resetToken || '').trim();

  const newPassword = String(payload.newPassword || '');



  if (!/^CID-\d{3,}$/.test(clientId) || !email || !resetToken) {

    throw new Error('Your password recovery session is invalid. Request a new code.');

  }



  if (newPassword.length < 8) {

    throw new Error('Your new password must be at least 8 characters.');

  }



  const key = passwordResetStoreKey_(clientId, email);

  const properties = PropertiesService.getScriptProperties();

  const lock = LockService.getScriptLock();

  lock.waitLock(10000);



  try {

    const record = readJsonProperty_(properties, key);

    const now = Date.now();



    if (!record || record.verified !== true) {

      throw new Error('Your verification session is invalid. Request a new code.');

    }



    if (Number(record.resetTokenExpiresAt) <= now) {

      properties.deleteProperty(key);

      throw new Error('Your verification session has expired. Request a new code.');

    }



    if (record.resetTokenHash !== sha256Hex_(resetToken)) {

      throw new Error('Your verification session is invalid. Request a new code.');

    }



    const client = findClientForPasswordReset_(clientId, email);

    if (!client) {

      throw new Error('The customer account could not be verified.');

    }



    const firebaseUser = firebaseLookupUserByEmail_(email);

    if (!firebaseUser || !firebaseUser.localId) {

      throw new Error('The Firebase customer account could not be found.');

    }



    firebaseUpdatePassword_(firebaseUser.localId, newPassword);



    // Consume the recovery token immediately after Firebase confirms the update.

    properties.deleteProperty(key);



    return {

      ok: true,

      passwordChanged: true,

      email: email

    };



  } finally {

    lock.releaseLock();

  }

}





/*************************************************

 * 14. CLIENT LOOKUP — GOOGLE SHEETS

 *************************************************/



function findClientForPasswordReset_(clientId, email) {

  const response = Sheets.Spreadsheets.Values.get(

    SPREADSHEET_ID,

    `${CLIENTS_SHEET}!A2:J`

  );



  const rows = response.values || [];

  const targetId = String(clientId).trim().toUpperCase();

  const targetEmail = String(email).trim().toLowerCase();



  for (const row of rows) {

    const unitId = String(row[0] || '').trim().toUpperCase();

    const rowEmail = String(row[3] || '').trim().toLowerCase();



    if (unitId === targetId && rowEmail === targetEmail) {

      return {

        unitId,

        firstName: String(row[1] || '').trim(),

        lastName: String(row[2] || '').trim(),

        email: rowEmail

      };

    }

  }



  return null;

}





/*************************************************

 * 15. FIREBASE AUTH — ADMIN REST API

 *************************************************/



function firebaseLookupUserByEmail_(email) {

  const accessToken = ScriptApp.getOAuthToken();

  const url = `https\://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/accounts:lookup`;



  const response = UrlFetchApp.fetch(url, {

    method: 'post',

    contentType: 'application/json',

    headers: {

      Authorization: `Bearer ${accessToken}`

    },

    payload: JSON.stringify({

      email: [email]

    }),

    muteHttpExceptions: true

  });



  const code = response.getResponseCode();

  const body = response.getContentText();

  let data = {};

  try { data = JSON.parse(body); } catch (_) {}



  if (code < 200 || code >= 300) {

    console.error('[PISO WIFI] Firebase account lookup failed', code, body);

    if (code === 403) {

      throw new Error('Firebase password service is not authorized. The Apps Script project needs Identity Platform user-management permission.');

    }

    throw new Error('Unable to verify the Firebase customer account.');

  }



  const users = Array.isArray(data.users) ? data.users : [];

  return users.find(user => String(user.email || '').trim().toLowerCase() === email) || null;

}



function firebaseUpdatePassword_(localId, newPassword) {

  const accessToken = ScriptApp.getOAuthToken();

  const url = `https\://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}/accounts:update`;



  const response = UrlFetchApp.fetch(url, {

    method: 'post',

    contentType: 'application/json',

    headers: {

      Authorization: `Bearer ${accessToken}`

    },

    payload: JSON.stringify({

      localId,

      password: newPassword

    }),

    muteHttpExceptions: true

  });



  const code = response.getResponseCode();

  const body = response.getContentText();

  let data = {};

  try { data = JSON.parse(body); } catch (_) {}



  if (code < 200 || code >= 300) {

    console.error('[PISO WIFI] Firebase password update failed', code, body);

    if (code === 403) {

      throw new Error('Firebase password service is not authorized. The Apps Script project needs Identity Platform user-management permission.');

    }

    const apiMessage = data && data.error && data.error.message;

    if (apiMessage === 'WEAK_PASSWORD') {

      throw new Error('The new password is too weak. Use at least 8 characters.');

    }

    throw new Error('Firebase could not update the password.');

  }



  return true;

}





/*************************************************

 * 16. SEND 6-DIGIT HTML EMAIL

 *************************************************/



function sendPasswordVerificationEmail_(firstName, email, clientId, code) {

  const safeFirstName = escapeHtml(firstName || 'Customer');

  const safeClientId = escapeHtml(clientId);

  const safeCode = escapeHtml(code);



  const subject = 'Your PISO WIFI verification code';



  const htmlBody = `\<!doctype html>

\<html lang="en">

\<head>

\<meta charset="UTF-8">

\<meta name="viewport" content="width=device-width,initial-scale=1">

\<title>PISO WIFI Verification Code\</title>

\</head>

\<body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#17243a;">

  \<div style="padding:32px 14px;">

    \<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e3eaf2;border-radius:18px;overflow:hidden;">

      \<tr>

        \<td style="background:#0a2344;padding:28px 32px;text-align:center;">

          \<div style="font-size:24px;font-weight:800;letter-spacing:.04em;color:#ffffff;">PISO WIFI\</div>

          \<div style="margin-top:6px;font-size:12px;color:#b9d7f7;letter-spacing:.06em;">CONNECT · EARN · GROW TOGETHER\</div>

        \</td>

      \</tr>

      \<tr>

        \<td style="padding:38px 36px;">

          \<div style="font-size:12px;font-weight:800;color:#0877e8;letter-spacing:.1em;">CUSTOMER ACCOUNT SECURITY\</div>

          \<h1 style="margin:10px 0 16px;font-size:28px;line-height:1.2;color:#102a4c;">Verify your password reset\</h1>

          \<p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Dear \<strong>${safeFirstName}\</strong>,\</p>

          \<p style="font-size:14px;line-height:1.75;color:#5e7187;margin:0 0 20px;">We received a request to reset the password for your PISO WIFI Customer Account.\</p>

          \<div style="background:#f8fafc;border:1px solid #e4ebf3;border-radius:14px;padding:18px;margin:22px 0;text-align:center;">

            \<div style="font-size:11px;font-weight:800;color:#7b8999;letter-spacing:1px;">YOUR 6-DIGIT VERIFICATION CODE\</div>

            \<div style="font-size:34px;font-weight:900;letter-spacing:8px;color:#102a4c;margin-top:10px;">${safeCode}\</div>

            \<div style="font-size:12px;color:#718096;margin-top:10px;">This code expires in 10 minutes.\</div>

          \</div>

          \<div style="background:#f6f9fc;border:1px solid #e4ebf3;border-radius:12px;padding:16px 18px;">

            \<div style="font-size:12px;font-weight:800;color:#33445d;margin-bottom:8px;">For your security\</div>

            \<ul style="margin:0;padding-left:18px;color:#6a7c91;font-size:12px;line-height:1.8;">

              \<li>Never share this code with anyone.\</li>

              \<li>PISO WIFI Admin will never ask for your private password.\</li>

              \<li>If you did not request this, you can safely ignore this email.\</li>

            \</ul>

          \</div>

          \<p style="font-size:12px;color:#8a98a8;margin:22px 0 0;">Customer ID: \<strong>${safeClientId}\</strong>\</p>

          \<p style="font-size:14px;line-height:1.7;margin:24px 0 0;">Thank you,\<br>\<strong>PISO WIFI Management System\</strong>\</p>

        \</td>

      \</tr>

      \<tr>

        \<td style="background:#f8fafc;border-top:1px solid #e8eef5;padding:18px 30px;text-align:center;color:#8a98a8;font-size:11px;line-height:1.6;">This is an automated account-security email. Please do not reply directly to this message.\</td>

      \</tr>

    \</table>

  \</div>

\</body>

\</html>`;



  const plainText =

`Dear ${firstName || 'Customer'},



We received a request to reset the password for your PISO WIFI Customer Account.



Your 6-digit verification code is: ${code}



This code expires in 10 minutes and can only be used once.



Customer ID: ${clientId}



If you did not request this, you can safely ignore this email.



Thank you,

PISO WIFI Management System`;



  MailApp.sendEmail({

    to: email,

    subject,

    body: plainText,

    htmlBody,

    name: 'PISO WIFI Management System'

  });

}





/*************************************************
 * 17. MANUAL CUSTOM EMAIL TEST
 *************************************************/
function testPasswordVerificationEmail() {
  const TEST_RECOVERY_EMAIL = 'YOUR_EMAIL@gmail.com';
  const TEST_CLIENT_ID = 'CID-0019';
  const TEST_FIRST_NAME = 'Test Customer';
  const TEST_CODE = '123456';

  if (!TEST_RECOVERY_EMAIL || TEST_RECOVERY_EMAIL === 'YOUR_EMAIL@gmail.com') {
    throw new Error('Open testPasswordVerificationEmail() and replace TEST_RECOVERY_EMAIL with your Gmail address.');
  }

  sendPasswordVerificationEmail_(
    TEST_FIRST_NAME,
    TEST_RECOVERY_EMAIL,
    TEST_CLIENT_ID,
    TEST_CODE
  );

  Logger.log('Custom PISO WIFI verification email sent to: ' + TEST_RECOVERY_EMAIL);
  return 'Custom PISO WIFI verification email sent to: ' + TEST_RECOVERY_EMAIL;
}


/*************************************************

 * 17. HELPERS

 *************************************************/



function generateSixDigitCode_() {

  return String(Math.floor(100000 + Math.random() * 900000));

}



function randomToken_() {

  const bytes = Utilities.getUuid() + '-' + Utilities.getUuid() + '-' + new Date().getTime();

  return Utilities.base64EncodeWebSafe(

    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes, Utilities.Charset.UTF_8)

  ).replace(/=+$/g, '');

}



function sha256Hex_(value) {

  const digest = Utilities.computeDigest(

    Utilities.DigestAlgorithm.SHA_256,

    String(value),

    Utilities.Charset.UTF_8

  );

  return digest.map(byte => {

    const v = byte < 0 ? byte + 256 : byte;

    return ('0' + v.toString(16)).slice(-2);

  }).join('');

}



function passwordResetStoreKey_(clientId, email) {

  return PASSWORD_RESET_STORE_PREFIX + sha256Hex_(`${clientId}|${email}`).slice(0, 48);

}



function readJsonProperty_(properties, key) {

  const raw = properties.getProperty(key);

  if (!raw) return null;

  try { return JSON.parse(raw); } catch (_) { return null; }

}



function escapeHtml(value) {

  return String(value)

    .replace(/&/g, '&amp;')

    .replace(/\</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;')

    .replace(/'/g, '&#039;');

}



function jsonResponse_(data) {

  return ContentService

    .createTextOutput(JSON.stringify(data))

    .setMimeType(ContentService.MimeType.JSON);

}


/*************************************************
 * CLIENT -> GOOGLE SHEETS SYNC
 *************************************************/

const SHEET_SYNC_FIREBASE_PROJECT_ID = 'piso-wifi-f2b5c5';
const SHEET_SYNC_FIREBASE_WEB_API_KEY = 'AIzaSyAfX3sSDkJwX9u9dxEDbhG8RU3iP_k6EdI';

/**
 * Add this line inside your existing doPost(e), after payload is parsed:
 *
 * if (action === 'syncClient') return jsonResponse_(syncClientToSheet_(payload));
 */

function syncClientToSheet_(payload) {
  ensurePisoWifiDatabase_();
  const idToken = String(payload.idToken || '').trim();
  if (!idToken) {
    return { ok: false, error: 'Missing Firebase admin session.' };
  }

  try {
    assertAdminFirebaseToken_(idToken);

    const clientId = String(payload.clientId || '').trim().toUpperCase();
    const firstName = String(payload.firstName || '').trim();
    const lastName = String(payload.lastName || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const phone = String(payload.phone || '').trim();
    const temporaryPassword = String(payload.temporaryPassword || clientId).trim();
    const passwordChanged = payload.passwordChanged === true;
    const accountStatus = String(payload.accountStatus || 'Active').trim() || 'Active';
    const createdAt = String(payload.createdAt || new Date().toISOString()).trim();
    const lastLogin = String(payload.lastLogin || '').trim();

    if (!/^CID-\d{4,}$/.test(clientId)) {
      return { ok: false, error: 'Invalid Client ID.' };
    }
    if (!firstName || !lastName) {
      return { ok: false, error: 'First Name and Last Name are required.' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Invalid registered Gmail.' };
    }

    const rowsResponse = Sheets.Spreadsheets.Values.get(
      SPREADSHEET_ID,
      `${CLIENTS_SHEET}!A2:J`
    );
    const rows = rowsResponse.values || [];

    let existingRowNumber = 0;
    for (let i = 0; i < rows.length; i++) {
      const rowClientId = String(rows[i][0] || '').trim().toUpperCase();
      if (rowClientId === clientId) {
        existingRowNumber = i + 2;
        break;
      }
    }

    const row = [
      clientId,
      firstName,
      lastName,
      email,
      phone,
      temporaryPassword,
      passwordChanged,
      accountStatus,
      createdAt,
      lastLogin
    ];

    if (existingRowNumber) {
      Sheets.Spreadsheets.Values.update(
        { values: [row] },
        SPREADSHEET_ID,
        `${CLIENTS_SHEET}!A${existingRowNumber}:J${existingRowNumber}`,
        { valueInputOption: 'USER_ENTERED' }
      );

      return {
        ok: true,
        action: 'updated',
        clientId,
        row: existingRowNumber
      };
    }

    Sheets.Spreadsheets.Values.append(
      { values: [row] },
      SPREADSHEET_ID,
      `${CLIENTS_SHEET}!A:J`,
      { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS' }
    );

    return {
      ok: true,
      action: 'created',
      clientId
    };
  } catch (error) {
    console.error('[SHEET SYNC]', error);
    return {
      ok: false,
      error: error && error.message ? error.message : 'Google Sheets sync failed.'
    };
  }
}

function assertAdminFirebaseToken_(idToken) {
  const lookupResponse = UrlFetchApp.fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(SHEET_SYNC_FIREBASE_WEB_API_KEY)}`,
    {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      payload: JSON.stringify({ idToken })
    }
  );

  if (lookupResponse.getResponseCode() < 200 || lookupResponse.getResponseCode() >= 300) {
    throw new Error('Invalid or expired Firebase admin session.');
  }

  const lookup = JSON.parse(lookupResponse.getContentText() || '{}');
  const user = lookup.users && lookup.users[0];
  const uid = user && user.localId;

  if (!uid) throw new Error('Unable to verify Firebase admin session.');

  const docUrl =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(SHEET_SYNC_FIREBASE_PROJECT_ID)}` +
    `/databases/(default)/documents/users/${encodeURIComponent(uid)}`;

  const roleResponse = UrlFetchApp.fetch(docUrl, {
    method: 'get',
    headers: { Authorization: `Bearer ${idToken}` },
    muteHttpExceptions: true
  });

  if (roleResponse.getResponseCode() < 200 || roleResponse.getResponseCode() >= 300) {
    throw new Error('Admin authorization could not be verified.');
  }

  const doc = JSON.parse(roleResponse.getContentText() || '{}');
  const role = doc.fields && doc.fields.role && doc.fields.role.stringValue;

  if (role !== 'admin') {
    throw new Error('Admin authorization required.');
  }

  return true;
}

/**
 * Optional manual test from Apps Script.
 * Replace the values before running if you want to test manually.
 * This does NOT bypass admin authorization.
 */
function testSheetSyncEndpointShape_() {
  Logger.log('syncClientToSheet_ is installed. Use the Admin dashboard to send a real Firebase admin token.');
}
