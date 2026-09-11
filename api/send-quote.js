// 견적 발송 처리: 관리자(브랜드 계정)만 호출 가능. 진단 신청 건에 견적 금액/메모를 반영하고
// 신청자 이메일로 견적 안내 메일을 보낸 뒤, 상태를 '견적발송'으로 바꿉니다.
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables 에 등록):
//   SUPABASE_URL              - Supabase 프로젝트 URL
//   SUPABASE_SERVICE_ROLE_KEY - Supabase service_role(=secret) 키
//   RESEND_API_KEY            - Resend API 키 (이메일 발송용)

const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PxmipI1KWIgeMuwP-5Ci8Q_RZwtwo2c';
const ADMIN_EMAIL = 'noteand.something@gmail.com';

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
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

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
    if (!row.quote_amount) {
      res.status(400).json({ error: '견적 금액이 입력되지 않았습니다.' });
      return;
    }

    // 3) 이메일 발송 (Resend)
    if (RESEND_API_KEY) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'NOTE AND <onboarding@resend.dev>',
          to: [row.email],
          subject: `[NOTE AND] ${row.name}님, 견적서가 도착했어요`,
          text:
            `안녕하세요, ${row.name}님.\n\n` +
            `요청하신 굿즈 제작 문의에 대한 견적을 안내드립니다.\n\n` +
            `견적 금액: ${row.quote_amount}\n` +
            (row.quote_memo ? `안내 사항: ${row.quote_memo}\n` : '') +
            `\n자세한 내용은 회신 주시면 빠르게 안내드릴게요.\n\nNOTE AND 드림`,
        }),
      });
      if (!emailRes.ok) {
        const errText = await emailRes.text();
        console.error('Resend quote email failed:', emailRes.status, errText);
        res.status(502).json({ error: '이메일 발송에 실패했습니다.' });
        return;
      }
    } else {
      console.error('RESEND_API_KEY 환경변수가 설정되지 않았습니다.');
    }

    // 4) 상태를 '견적발송'으로 업데이트 + 발송 시각 기록
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
