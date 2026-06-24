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

    // 시크릿에 섞일 수 있는 BOM·zero-width·공백 제거 (PowerShell 등으로 설정 시 혼입 가능)
    const clean = (v) => String(v || '').replace(/[﻿​-‍⁠]/g, '').trim();
    const userId = clean(NAVER_USER.value());
    const fromAddr = userId.includes('@') ? userId : `${userId}@naver.com`;

    const transporter = nodemailer.createTransport({
      host: 'smtp.naver.com',
      port: 465,
      secure: true,
      auth: {
        user: userId,
        pass: clean(NAVER_PASS.value()),
      },
    });

    try {
      await transporter.verify();
    } catch (e) {
      // 인증/연결 실패를 client에 명확히 전달 (INTERNAL 대신 실제 사유)
      throw new HttpsError('unauthenticated', `네이버 SMTP 로그인 실패: ${e.response || e.message}`);
    }

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
