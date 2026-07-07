const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const nodemailer = require('nodemailer');

const NAVER_USER = defineSecret('NAVER_USER');
const NAVER_PASS = defineSecret('NAVER_PASS');

exports.sendPurchaseOrderEmail = onCall(
  { secrets: [NAVER_USER, NAVER_PASS], region: 'asia-northeast3' },
  async (request) => {
    const { to, subject, html, attachments } = request.data;

    // (2026-07-06) 공유 토큰 검증 제거 — 옛 캐시 클라이언트에서 토큰 미전송으로 발송이
    // 전면 차단되는 운영 사고 발생. 외부 남용 방지는 추후 App Check 강제 등 캐시에
    // 영향 없는 방식으로 재도입 예정. (앱은 여전히 token을 함께 보내지만 무시됨)

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

    // 첨부는 앱이 base64 content로만 전송 — path/href/raw 등 서버 파일 읽기·SSRF 유발 필드는 제거.
    // filename/content(base64)/contentType + 인라인 이미지용 cid·contentDisposition(inline)만 허용(화이트리스트).
    const safeAttachments = (Array.isArray(attachments) ? attachments : [])
      .map((a) => {
        const out = {
          filename: String((a && a.filename) || 'attachment'),
          content: a && a.content,
          encoding: 'base64',
        };
        if (a && a.contentType) out.contentType = String(a.contentType);
        if (a && a.cid) out.cid = String(a.cid); // 인라인 이미지(명함 cid:bizcard) 참조 — 안전한 식별자
        if (a && a.contentDisposition === 'inline') out.contentDisposition = 'inline';
        return out;
      })
      .filter((a) => typeof a.content === 'string' && a.content.length > 0);

    await transporter.sendMail({
      from: `"(주)아이오피엔" <${fromAddr}>`,
      to,
      subject,
      html,
      attachments: safeAttachments,
    });

    return { success: true };
  },
);
