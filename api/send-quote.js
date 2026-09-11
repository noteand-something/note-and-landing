// 견적 발송 처리: 관리자(브랜드 계정)만 호출 가능.
// 신청 건에 저장된 견적 항목(quote_items)으로 정식 견적서 PDF를 만들어 신청자 이메일로 보내고,
// 상태를 '견적발송'으로 바꿉니다.
// 이메일은 Gmail(SMTP)로 직접 보냅니다 — 도메인 인증 없이도 실제 고객 주소로 발송 가능합니다.
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables 에 등록):
//   SUPABASE_URL              - Supabase 프로젝트 URL
//   SUPABASE_SERVICE_ROLE_KEY - Supabase service_role(=secret) 키
//   GMAIL_USER                - 발신용 Gmail 주소 (예: noteand.something@gmail.com)
//   GMAIL_APP_PASSWORD        - 그 Gmail 계정의 앱 비밀번호 (일반 로그인 비밀번호 아님)

const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const nodemailer = require('nodemailer');

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PxmipI1KWIgeMuwP-5Ci8Q_RZwtwo2c';
const ADMIN_EMAIL = 'noteand.something@gmail.com';

// ── 금액 표기 헬퍼 ──────────────────────────────────────────
function fmt(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('ko-KR');
}
function fmtWon(n) {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  return sign + '₩' + fmt(Math.abs(num));
}
function truncate(font, str, size, maxWidth) {
  str = String(str ?? '');
  if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
  let out = str;
  while (out.length > 0 && font.widthOfTextAtSize(out + '…', size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

// ── 견적서 PDF 생성 ─────────────────────────────────────────
async function generateQuotePdf({ recipientName, items, memo, validDays, issueDate }) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'));
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  const PAGE_W = 595.28, PAGE_H = 841.89;
  const marginX = 42;
  const bottomLimit = 70;

  const navy = rgb(0x1d / 255, 0x35 / 255, 0x57 / 255);
  const black = rgb(0.12, 0.12, 0.12);
  const gray = rgb(0.45, 0.45, 0.45);
  const lightBg = rgb(0.93, 0.94, 0.96);
  const zebra = rgb(0.97, 0.97, 0.96);
  const lineColor = rgb(0.85, 0.84, 0.8);
  const white = rgb(1, 1, 1);

  let page, y;
  const tableRight = PAGE_W - marginX;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - 60;
  }
  function text(str, x, yy, size, color = black) {
    page.drawText(String(str ?? ''), { x, y: yy, size, font, color });
  }
  function rightText(str, xRight, yy, size, color = black) {
    const w = font.widthOfTextAtSize(String(str ?? ''), size);
    text(str, xRight - w, yy, size, color);
  }
  function line(x1, y1, x2, y2, color = lineColor, thickness = 1) {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color });
  }
  function rect(x, yy, w, h, color) {
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  }

  newPage();

  text('견 적 서', marginX, y - 6, 24, navy);

  const boxW = 220, boxX = tableRight - boxW, boxH = 76, boxY = y - boxH + 6;
  rect(boxX, boxY, boxW, boxH, lightBg);
  page.drawRectangle({ x: boxX, y: boxY, width: boxW, height: boxH, borderColor: lineColor, borderWidth: 1 });
  const supplierRows = [
    ['상호', 'NOTE AND'],
    ['담당자', '이예지'],
    ['이메일', 'noteand.something@gmail.com'],
    ['발행일', issueDate],
  ];
  let sy = boxY + boxH - 16;
  supplierRows.forEach(([k, v]) => {
    text(k, boxX + 12, sy, 8.5, gray);
    text(v, boxX + 58, sy, 9, black);
    sy -= 16;
  });

  y = boxY - 34;

  text(`${recipientName} 귀하`, marginX, y, 14.5, black);
  y -= 26;

  const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);
  const bannerH = 30;
  rect(marginX, y - bannerH, tableRight - marginX, bannerH, navy);
  text('금액 (VAT 별도 협의)', marginX + 14, y - bannerH + 10, 10.5, white);
  rightText(fmtWon(total), tableRight - 14, y - bannerH + 9, 14, white);
  y -= bannerH + 22;

  const col = {
    name: marginX,
    qty: marginX + 270,
    price: marginX + 350,
    amt: marginX + 445,
  };
  const headerH = 24;
  function drawTableHeader() {
    rect(marginX, y - headerH, tableRight - marginX, headerH, navy);
    text('상품명', col.name + 10, y - headerH + 8, 9.5, white);
    text('수량', col.qty + 10, y - headerH + 8, 9.5, white);
    text('단가', col.price + 10, y - headerH + 8, 9.5, white);
    text('금액', col.amt + 10, y - headerH + 8, 9.5, white);
    y -= headerH;
  }
  drawTableHeader();

  const rowH = 26;
  items.forEach((it, idx) => {
    if (y - rowH < bottomLimit) {
      line(marginX, y, tableRight, y);
      newPage();
      drawTableHeader();
    }
    const rowY = y - rowH;
    if (idx % 2 === 1) rect(marginX, rowY, tableRight - marginX, rowH, zebra);
    const nameMaxW = col.qty - col.name - 16;
    text(truncate(font, it.name, 9.5, nameMaxW), col.name + 10, rowY + 9, 9.5, black);
    rightText(fmt(it.qty), col.price - 12, rowY + 9, 9.5, black);
    rightText(fmtWon(it.price), col.amt - 12, rowY + 9, 9.5, black);
    rightText(fmtWon((Number(it.qty) || 0) * (Number(it.price) || 0)), tableRight - 10, rowY + 9, 9.5, black);
    y = rowY;
  });
  line(marginX, y, tableRight, y);

  const totalRowH = 28;
  if (y - totalRowH < bottomLimit) newPage();
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const totalRowY = y - totalRowH;
  rect(marginX, totalRowY, tableRight - marginX, totalRowH, lightBg);
  text('합계', col.name + 10, totalRowY + 10, 10, navy);
  rightText(fmt(totalQty), col.price - 12, totalRowY + 10, 10, navy);
  rightText(fmtWon(total), tableRight - 10, totalRowY + 10, 11, navy);
  page.drawRectangle({ x: marginX, y: totalRowY, width: tableRight - marginX, height: totalRowH, borderColor: lineColor, borderWidth: 1 });
  y = totalRowY - 30;

  if (memo) {
    text(`비고 : ${memo}`, marginX, y, 9.5, gray);
    y -= 16;
  }
  text(`유효기간 : 발행일로부터 ${validDays || 7}일`, marginX, y, 9.5, gray);

  return pdfDoc.save();
}

// ── 서버리스 핸들러 ─────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const { id } = req.body || {};

  if (!token || !id) {
    res.status(400).json({ error: '인증 토큰 또는 신청 id가 없습니다.' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: '서버 환경변수가 설정되지 않았습니다.' });
    return;
  }

  try {
    // 1) 토큰으로 로그인한 사용자 확인 (관리자 이메일인지 검증)
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: '로그인 정보가 유효하지 않습니다.' });
      return;
    }
    const user = await userRes.json();
    if (!user || user.email !== ADMIN_EMAIL) {
      res.status(403).json({ error: '관리자만 사용할 수 있는 기능입니다.' });
      return;
    }

    // 2) 해당 신청 건 조회 (service_role로 전체 조회)
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/diagnosis_requests?id=eq.${encodeURIComponent(id)}&select=*`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    const rows = await rowRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) {
      res.status(404).json({ error: '신청 내역을 찾을 수 없습니다.' });
      return;
    }
    const items = Array.isArray(row.quote_items) ? row.quote_items : [];
    if (items.length === 0) {
      res.status(400).json({ error: '견적 항목이 입력되지 않았습니다.' });
      return;
    }

    // 3) 견적서 PDF 생성
    const issueDate = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // YYYY-MM-DD
    const pdfBytes = await generateQuotePdf({
      recipientName: row.name,
      items,
      memo: row.quote_memo || '',
      validDays: row.quote_valid_days || 7,
      issueDate,
    });
    const total = items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

    // 4) 이메일 발송 (Gmail SMTP, PDF 첨부) — 도메인 인증 없이 실제 고객 주소로 발송 가능
    const GMAIL_USER = process.env.GMAIL_USER;
    const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

    if (GMAIL_USER && GMAIL_APP_PASSWORD) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });
      try {
        await transporter.sendMail({
          from: `NOTE AND <${GMAIL_USER}>`,
          to: row.email,
          subject: `[NOTE AND] ${row.name}님, 견적서가 도착했어요`,
          text:
            `안녕하세요, ${row.name}님.\n\n` +
            `요청하신 굿즈 제작 문의에 대한 견적서를 첨부해드립니다.\n\n` +
            `견적 금액: ₩${total.toLocaleString('ko-KR')} (VAT 별도 협의)\n` +
            (row.quote_memo ? `안내 사항: ${row.quote_memo}\n` : '') +
            `\n첨부된 PDF 견적서를 확인해주시고, 궁금한 점은 회신 부탁드려요.\n\nNOTE AND 드림`,
          attachments: [
            {
              filename: `노트앤드_견적서_${issueDate}.pdf`,
              content: Buffer.from(pdfBytes),
            },
          ],
        });
      } catch (err) {
        console.error('Gmail quote email failed:', err);
        res.status(502).json({ error: '이메일 발송에 실패했습니다.' });
        return;
      }
    } else {
      console.error('GMAIL_USER / GMAIL_APP_PASSWORD 환경변수가 설정되지 않았습니다.');
      res.status(500).json({ error: '이메일 발송 설정(Gmail)이 되어있지 않습니다.' });
      return;
    }

    // 5) 상태를 '견적발송'으로 업데이트 + 발송 시각 기록
    await fetch(`${SUPABASE_URL}/rest/v1/diagnosis_requests?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: '견적발송', quote_sent_at: new Date().toISOString() }),
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('send-quote error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
};
