// 업체 답장 받아오기 — 5분마다 네이버 메일함을 살펴 우리가 보낸 메일의 답장만 가져온다.
//
// 보낼 때 심어 둔 번호(Message-ID)가 답장의 In-Reply-To 에 그대로 담겨 온다.
// 그 번호로 mailThreads 를 찾으면 「어느 발주서의 · 어느 업체가」 답한 것인지 나온다.
// 제목을 고쳐 답장해도, 본문을 다 지워도 붙는다 (2026-08-28 대표님).
//
// 지키는 것 세 가지.
//  ① 남의 메일은 안 읽는다 — 우리 번호가 없으면 헤더만 보고 그냥 지나간다.
//  ② 읽음 표시를 건드리지 않는다 — readOnly 로 열어 대표님 메일함이 그대로 남는다.
//  ③ 같은 답장을 두 번 담지 않는다 — 처리한 UID 를 적어 두고 그 뒤부터 본다.
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const NAVER_USER = defineSecret('NAVER_USER');
const NAVER_PASS = defineSecret('NAVER_PASS');

if (!admin.apps.length) admin.initializeApp();

// 시크릿에 섞일 수 있는 BOM·zero-width·공백 제거 (발송 쪽과 같은 규칙)
const clean = (v) =>
  String(v || '')
    .replace(/[﻿​-‍⁠]/g, '')
    .trim();

// 답장 헤더에서 우리 번호만 골라낸다. 우리가 보낸 것이 아니면 빈 값.
// 클라이언트의 threadKeyOf 와 같은 규칙이라야 서로 찾는다.
function threadKeyOf(headerValue) {
  const m = String(headerValue || '').match(/<(wm-[A-Za-z0-9-]+)@/);
  return m ? m[1] : '';
}

// In-Reply-To 가 비어 오는 메일함도 있어 References 까지 훑는다.
// References 에는 스레드의 모든 번호가 담겨 있어 마지막 것이 우리 것일 수 있다.
function findThreadKey(envelopeHeaders) {
  const pick = (name) => {
    const v = envelopeHeaders.get(name);
    return Array.isArray(v) ? v.join(' ') : v || '';
  };
  return threadKeyOf(pick('in-reply-to')) || threadKeyOf(pick('references'));
}

exports.fetchMailReplies = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Seoul',
    secrets: [NAVER_USER, NAVER_PASS],
    region: 'asia-northeast3',
    timeoutSeconds: 180,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const stateRef = db.collection('mailSyncState').doc('naver');
    const state = (await stateRef.get()).data() || {};
    const lastUid = Number(state.lastUid) || 0;

    const userId = clean(NAVER_USER.value());
    const makeClient = () =>
      new ImapFlow({
        host: 'imap.naver.com',
        port: 993,
        secure: true,
        auth: { user: userId.split('@')[0], pass: clean(NAVER_PASS.value()) },
        logger: false,
        // 네이버가 굼뜰 때 기본값(90초)보다 일찍 포기하지 않게 넉넉히 준다
        greetingTimeout: 30000,
        socketTimeout: 120000,
        connectionTimeout: 30000,
      });

    let found = 0;
    let saved = 0;
    let maxUid = lastUid;

    // 한 번 실패하면 잠깐 쉬고 다시. 동시 접속이 잠깐 몰렸을 때 그냥 넘어가면
    // 그 사이 온 답장을 다음 차례까지 못 본다.
    let client = makeClient();
    try {
      await client.connect();
    } catch (first) {
      console.warn(`IMAP 첫 접속 실패 — 다시 시도합니다: ${describeError(first)}`);
      await new Promise((r) => setTimeout(r, 5000));
      client = makeClient();
      try {
        await client.connect();
      } catch (second) {
        // 여기서 멈추면 lastUid 를 그대로 두므로, 다음 차례에 놓친 메일부터 다시 본다
        console.error(`IMAP 접속 실패 — ${describeError(second)}`);
        throw second;
      }
    }
    try {
      // readOnly — 대표님 메일함의 읽음 표시를 건드리지 않는다
      const lock = await client.getMailboxLock('INBOX', { readonly: true });
      try {
        // 처음 도는 날엔 최근 7일치만. 그 뒤로는 지난번에 멈춘 자리부터.
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const range = lastUid > 0 ? `${lastUid + 1}:*` : undefined;
        const searchOpts = lastUid > 0 ? { uid: range } : { since };

        // 먼저 훑기만 한다. IMAP 은 한 번에 한 명령만 받으므로, 이 루프 안에서
        // 본문 받기(download)를 부르면 두 명령이 겹쳐 연결이 끊긴다
        // (2026-09-01 「Connection not available」의 원인이었다).
        const 후보 = [];
        for await (const msg of client.fetch(searchOpts, {
          uid: true,
          envelope: true,
          headers: ['in-reply-to', 'references'],
          // 본문은 아직 안 가져온다 — 우리 것인지부터 가린다
        })) {
          if (msg.uid > maxUid) maxUid = msg.uid;
          found += 1;
          const key = findThreadKey(msg.headers ? parseHeaders(msg.headers) : new Map());
          if (key) 후보.push({ uid: msg.uid, key }); // 우리 것만 담아 둔다
        }

        // 훑기가 끝난 뒤에야 본문을 가져온다
        for (const { uid, key } of 후보) {
          const threadSnap = await db.collection('mailThreads').doc(key).get();
          if (!threadSnap.exists) continue; // 번호는 우리 것인데 기록이 없다(옛 메일 등)
          const thread = threadSnap.data();

          const replyId = `${key}_${uid}`;
          const ref = db.collection('mailReplies').doc(replyId);
          if ((await ref.get()).exists) continue; // 이미 담았다

          const full = await client.download(uid, undefined, { uid: true });
          const parsed = await simpleParser(full.content);

          await ref.set({
            threadKey: key,
            uid,
            kind: thread.kind || '',
            purchaseId: thread.purchaseId || '',
            vendor: thread.vendor || '',
            monthKey: thread.monthKey || '',
            from: parsed.from?.text || '',
            subject: parsed.subject || '',
            text: (parsed.text || '').slice(0, 20000), // 아주 긴 글은 잘라 담는다
            // 첨부는 「무엇이 몇 개 왔는지」만. 파일 자체는 네이버에 있다 (2026-08-28 대표님)
            attachments: (parsed.attachments || []).map((a) => ({
              filename: a.filename || '(이름 없음)',
              size: a.size || 0,
              contentType: a.contentType || '',
            })),
            receivedAt: parsed.date || new Date(),
            createdAt: new Date(),
          });
          saved += 1;
        }
      } finally {
        lock.release();
      }
    } catch (err) {
      // 어디서 끊겼는지 남긴다 — 「Connection not available」 한 줄로는 가릴 수 없다
      console.error(`메일 읽는 중 끊김 (지금까지 ${found}통 확인) — ${describeError(err)}`);
      throw err;
    } finally {
      await client.logout().catch(() => {});
    }

    await stateRef.set(
      { lastUid: maxUid, lastRunAt: new Date(), lastFound: found, lastSaved: saved },
      { merge: true },
    );
    console.log(`메일 확인 ${found}통 · 답장 ${saved}건 저장 (uid ~${maxUid})`);
  },
);

// 오류에서 가려낼 수 있는 것을 전부 적는다 — 인증 실패인지, 연결이 끊긴 것인지,
// 네이버가 거부한 것인지에 따라 손볼 곳이 다르다.
function describeError(err) {
  const bits = [err?.message || String(err)];
  if (err?.code) bits.push(`code=${err.code}`);
  if (err?.authenticationFailed) bits.push('인증실패');
  if (err?.responseText) bits.push(`응답="${err.responseText}"`);
  if (err?.serverResponseCode) bits.push(`서버코드=${err.serverResponseCode}`);
  return bits.join(' · ');
}

// imapflow 가 주는 헤더는 Buffer 라 직접 푼다
function parseHeaders(buf) {
  const out = new Map();
  const text = buf.toString('utf8');
  let lastKey = '';
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s/.test(raw) && lastKey) {
      out.set(lastKey, `${out.get(lastKey)} ${raw.trim()}`); // 접힌 줄 잇기
      continue;
    }
    const i = raw.indexOf(':');
    if (i < 0) continue;
    lastKey = raw.slice(0, i).trim().toLowerCase();
    out.set(lastKey, raw.slice(i + 1).trim());
  }
  return out;
}
