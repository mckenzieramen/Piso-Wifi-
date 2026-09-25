/*************************************************
 * PISO WIFI BACKEND
 * Google Apps Script + Google Sheets API
 *************************************************/

const SPREADSHEET_ID = '1UZjmAonaz_O8Njuy7EV1qMxI8Rddpab6Nj-5t4q50Es';

const CLIENTS_SHEET = 'Clients';
const MAX_UNITS = 50;

// Replace this later with your actual Client Portal URL
const CLIENT_PORTAL_URL = 'https://piso-wifi.pages.dev/';


/*************************************************
 * 1. TEST SPREADSHEET CONNECTION
 *************************************************/

function testSpreadsheetConnection() {
  const spreadsheet = Sheets.Spreadsheets.get(SPREADSHEET_ID);

  Logger.log(spreadsheet.properties.title);
}


/*************************************************
 * 2. TEST CLIENTS SHEET
 *************************************************/

function testClientsSheet() {
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

<!DOCTYPE html>

<html>

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>Piso WiFi Account</title>

</head>


<body style="
  margin:0;
  padding:0;
  background:#f4f6f8;
  font-family:Arial,Helvetica,sans-serif;
">


  <div style="
    max-width:620px;
    margin:30px auto;
    background:#ffffff;
    border-radius:14px;
    overflow:hidden;
    box-shadow:0 4px 18px rgba(0,0,0,0.08);
  ">


    <!-- HEADER -->

    <div style="
      background:#111827;
      padding:30px 25px;
      text-align:center;
    ">

      <div style="
        font-size:28px;
        font-weight:bold;
        color:#ffffff;
        letter-spacing:1px;
      ">

        PISO WiFi

      </div>


      <div style="
        margin-top:8px;
        color:#d1d5db;
        font-size:14px;
      ">

        Client Account Portal

      </div>

    </div>



    <!-- CONTENT -->

    <div style="
      padding:35px 30px;
      color:#1f2937;
    ">


      <h2 style="
        margin-top:0;
        font-size:24px;
        color:#111827;
      ">

        Welcome, ${escapeHtml(firstName)}! 👋

      </h2>


      <p style="
        font-size:15px;
        line-height:1.7;
      ">

        Your Piso WiFi client account has been created
        successfully.

        Below are your temporary login credentials.

      </p>



      <!-- ACCOUNT CARD -->

      <div style="
        margin:25px 0;
        padding:22px;
        background:#f8fafc;
        border:1px solid #e5e7eb;
        border-radius:12px;
      ">


        <div style="
          font-size:13px;
          color:#6b7280;
          margin-bottom:6px;
        ">

          UNIT ID

        </div>


        <div style="
          font-size:24px;
          font-weight:bold;
          color:#111827;
          margin-bottom:20px;
        ">

          ${escapeHtml(unitId)}

        </div>



        <div style="
          font-size:13px;
          color:#6b7280;
          margin-bottom:6px;
        ">

          TEMPORARY PASSWORD

        </div>


        <div style="
          font-size:24px;
          font-weight:bold;
          color:#111827;
        ">

          ${escapeHtml(temporaryPassword)}

        </div>

      </div>



      <!-- IMPORTANT NOTICE -->

      <div style="
        background:#fff7ed;
        border-left:4px solid #f97316;
        padding:15px 18px;
        border-radius:6px;
        margin:20px 0;
      ">


        <strong style="color:#9a3412;">

          Important

        </strong>


        <p style="
          margin:7px 0 0;
          font-size:14px;
          line-height:1.6;
          color:#7c2d12;
        ">

          This is a temporary password.

          You will be required to create your own
          password when you log in for the first time.

        </p>

      </div>



      <!-- FIRST LOGIN -->

      <h3 style="
        font-size:18px;
        color:#111827;
        margin-top:30px;
      ">

        First Login

      </h3>


      <ol style="
        padding-left:22px;
        font-size:14px;
        line-height:1.8;
        color:#374151;
      ">

        <li>
          Open the Piso WiFi Client Portal.
        </li>

        <li>
          Enter your Unit ID.
        </li>

        <li>
          Enter your temporary password.
        </li>

        <li>
          Verify your account information.
        </li>

        <li>
          Create your new personal password.
        </li>

      </ol>



      <!-- LOGIN BUTTON -->

      <div style="
        text-align:center;
        margin:32px 0;
      ">


        <a
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

        </a>


      </div>



      <p style="
        font-size:13px;
        line-height:1.6;
        color:#6b7280;
      ">

        If you did not expect this account,
        please contact the Piso WiFi administrator
        immediately.

      </p>


    </div>



    <!-- FOOTER -->

    <div style="
      background:#f9fafb;
      border-top:1px solid #e5e7eb;
      padding:20px;
      text-align:center;
      color:#9ca3af;
      font-size:12px;
    ">

      © ${new Date().getFullYear()} Piso WiFi

      <br>

      This is an automated message.
      Please do not reply.

    </div>


  </div>


</body>

</html>

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

    .replace(/</g, '&lt;')

    .replace(/>/g, '&gt;')

    .replace(/"/g, '&quot;')

    .replace(/'/g, '&#039;');

}
/*************************************************
 * 9. CUSTOM FIREBASE PASSWORD RESET MAILER
 *
 * This endpoint is called ONLY by the website's
 * server-side password-reset function.
 *
 * IMPORTANT:
 * Keep this Apps Script project private.
 * The shared secret below must match the value in
 * functions/api/password-reset.js.
 *************************************************/

const PASSWORD_RESET_MAILER_SECRET = '-P4NqUwISia-WpONGB2WipjobxXOC0Jnh9bdnyQMF2zNsOrWo-ERoChulEGfY14D';


/*************************************************
 * 10. PASSWORD RESET WEB APP ENDPOINT
 *************************************************/

function doPost(e) {

  try {

    const payload = JSON.parse(
      e && e.postData && e.postData.contents
        ? e.postData.contents
        : '{}'
    );

    const suppliedSecret =
      String(
        (e && e.parameter && e.parameter.secret) ||
        payload.secret ||
        ''
      ).trim();

    if (suppliedSecret !== PASSWORD_RESET_MAILER_SECRET) {
      return jsonResponse_({
        ok: false,
        error: 'Unauthorized request.'
      });
    }

    const email = String(payload.email || '').trim().toLowerCase();
    const clientId = String(payload.clientId || '').trim().toUpperCase();
    const firstName = String(payload.firstName || 'Customer').trim() || 'Customer';
    const resetLink = String(payload.resetLink || '').trim();

    if (!email || !email.includes('@')) {
      return jsonResponse_({
        ok: false,
        error: 'A valid recipient email is required.'
      });
    }

    if (!/^CID-\d{3,}$/.test(clientId)) {
      return jsonResponse_({
        ok: false,
        error: 'Invalid Client ID.'
      });
    }

    if (!/^https:\/\//i.test(resetLink) || resetLink.length < 80) {
      return jsonResponse_({
        ok: false,
        error: 'Invalid password-reset link.'
      });
    }

    sendCustomPasswordResetEmail_(
      firstName,
      email,
      clientId,
      resetLink
    );

    return jsonResponse_({
      ok: true,
      emailSent: true
    });

  } catch (error) {

    console.error(error);

    return jsonResponse_({
      ok: false,
      error: error && error.message
        ? error.message
        : 'Unable to send password-reset email.'
    });
  }
}


/*************************************************
 * 11. SEND CUSTOM PASSWORD RESET EMAIL
 *************************************************/

function sendCustomPasswordResetEmail_(
  firstName,
  email,
  clientId,
  resetLink
) {

  const safeFirstName = escapeHtml(firstName);
  const safeClientId = escapeHtml(clientId);
  const safeResetLink = escapeHtml(resetLink);

  const subject =
    'Reset your password — PISO WIFI Customer Account';

  const plainText =
`Dear ${firstName},

We received a request to reset the password for your PISO WIFI Customer Account.

Please use the link below to securely create a new private password:

${resetLink}

For your security:
- Do not share the reset link or your new password.
- PISO WIFI Admin will never ask for your private password.
- If you did not request this reset, you may safely ignore this email.

Customer ID: ${clientId}

Thank you,
PISO WIFI Management System
Connect · Earn · Grow Together

This is an automated account-security email. Please do not reply directly to this message.`;

  const htmlBody = `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PISO WIFI Password Reset</title>
</head>
<body style="margin:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#17243a;">
  <div style="padding:32px 14px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e3eaf2;border-radius:18px;overflow:hidden;">
      <tr><td style="background:#0a2344;padding:28px 32px;text-align:center;">
        <div style="font-size:24px;font-weight:800;letter-spacing:.04em;color:#ffffff;">PISO WIFI</div>
        <div style="margin-top:6px;font-size:12px;color:#b9d7f7;letter-spacing:.06em;">CONNECT · EARN · GROW TOGETHER</div>
      </td></tr>
      <tr><td style="padding:38px 36px;">
        <div style="font-size:12px;font-weight:800;color:#0877e8;letter-spacing:.1em;">CUSTOMER ACCOUNT SECURITY</div>
        <h1 style="margin:10px 0 16px;font-size:28px;line-height:1.2;color:#102a4c;">Reset your password</h1>
        <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Dear ${safeFirstName},</p>
        <p style="font-size:14px;line-height:1.75;color:#5e7187;margin:0 0 18px;">We received a request to reset the password for your PISO WIFI Customer Account.</p>
        <p style="font-size:14px;line-height:1.75;color:#5e7187;margin:0 0 24px;">Please use the button below to securely create a new private password.</p>
        <div style="text-align:center;margin:28px 0 30px;"><a href="${safeResetLink}" style="display:inline-block;background:#0877e8;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:14px 24px;border-radius:10px;">Reset My Password</a></div>
        <div style="background:#f6f9fc;border:1px solid #e4ebf3;border-radius:12px;padding:16px 18px;">
          <div style="font-size:12px;font-weight:800;color:#33445d;margin-bottom:8px;">For your security</div>
          <ul style="margin:0;padding-left:18px;color:#6a7c91;font-size:12px;line-height:1.8;">
            <li>Do not share the reset link or your new password.</li>
            <li>PISO WIFI Admin will never ask for your private password.</li>
            <li>If you did not request this reset, you may safely ignore this email.</li>
          </ul>
        </div>
        <p style="font-size:13px;line-height:1.7;color:#6a7c91;margin:24px 0 0;">If you have any concerns regarding your account, please contact PISO WIFI Support.</p>
        <p style="font-size:14px;line-height:1.7;margin:24px 0 0;">Thank you,<br><strong>PISO WIFI Management System</strong></p>
      </td></tr>
      <tr><td style="background:#f8fafc;border-top:1px solid #e8eef5;padding:18px 30px;text-align:center;color:#8a98a8;font-size:11px;line-height:1.6;">This is an automated account-security email. Please do not reply directly to this message.</td></tr>
    </table>
  </div>
</body>
</html>`;

  MailApp.sendEmail({
    to: email,
    subject: subject,
    body: plainText,
    htmlBody: htmlBody,
    name: 'PISO WIFI Management System'
  });
}


/*************************************************
 * 12. JSON RESPONSE HELPER
 *************************************************/

function jsonResponse_(data) {

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
