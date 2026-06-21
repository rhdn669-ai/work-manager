const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

const NAVER_USER = defineSecret('NAVER_USER');
const NAVER_PASS = defineSecret('NAVER_PASS');

exports.sendPurchaseOrderEmail = onCall(
  { secrets: [NAVER_USER, NAVER_PASS], region: 'asia-northeast3' },
  async (request) => {
    const { to, subject, html, attachments } = request.data;

    if (!to || !subject) {
      throw new HttpsError('invalid-argument', '수신자와 제목은 필수입니다.');
    }

    const userId = NAVER_USER.value().trim();
    const fromAddr = userId.includes('@') ? userId : `${userId}@naver.com`;

    const transporter = nodemailer.createTransport({
      host: 'smtp.naver.com',
      port: 465,
      secure: true,
      auth: {
        user: userId,
        pass: NAVER_PASS.value().trim(),
      },
    });

    await transporter.sendMail({
      from: `"(주)아이오피엔" <${fromAddr}>`,
      to,
      subject,
      html,
      attachments: attachments || [],
    });

    return { success: true };
  },
);
