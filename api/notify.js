// 진단폼 제출 처리: Supabase에 저장 + 이메일로 알림 전송 (Resend 사용)
// 필요한 환경변수 (Vercel 프로젝트 설정 > Environment Variables 에 등록):
//   SUPABASE_URL              - Supabase 프로젝트 URL
//   SUPABASE_SERVICE_ROLE_KEY - Supabase service_role(=secret) 키 (절대 클라이언트에 노출 금지)
//   RESEND_API_KEY            - Resend API 키 (이메일 발송용)
//   NOTIFY_EMAIL              - 알림 받을 이메일 주소 (본인 이메일)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { name, phone, email, productType, quantity, budget, notes } = req.body || {};

  if (!name || !phone || !email) {
    res.status(400).json({ error: '필수 항목(성함/연락처/이메일)이 누락되었습니다.' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

  let savedOk = false;

  // 1) Supabase 테이블에 저장
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabaseRes = await fetch(`${SUPABASE_URL}/rest/v1/diagnosis_requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          name,
          phone,
          email,
          product_type: productType || null,
          quantity: quantity || null,
          budget: budget || null,
          notes: notes || null,
        }),
      });
      savedOk = supabaseRes.ok;
      if (!supabaseRes.ok) {
        const errText = await supabaseRes.text();
        console.error('Supabase insert failed:', supabaseRes.status, errText);
      }
    } catch (err) {
      console.error('Supabase insert error:', err);
    }
  } else {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다.');
  }

  // 2) 이메일 알림 (Resend)
  if (RESEND_API_KEY && NOTIFY_EMAIL) {
    try {
      const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: 'NOTE AND 알림 <onboarding@resend.dev>',
          to: [NOTIFY_EMAIL],
          subject: `📋 새 진단폼 제출 - ${name}`,
          text:
            `새 진단폼이 제출되었습니다.\n\n` +
            `이름/브랜드: ${name}\n` +
            `연락처: ${phone}\n` +
            `이메일: ${email}\n` +
            `희망 굿즈: ${productType || '-'}\n` +
            `수량: ${quantity || '-'}\n` +
            `예산: ${budget || '-'}\n` +
            `참고사항: ${notes || '-'}\n` +
            `제출 시각: ${now}`,
        }),
      });
    } catch (err) {
      console.error('Resend email error:', err);
    }
  } else {
    console.error('RESEND_API_KEY / NOTIFY_EMAIL 환경변수가 설정되지 않았습니다.');
  }

  // Supabase 저장이 실패해도 사용자에게는 접수 자체는 실패로 보이지 않게 하되,
  // 운영 확인이 가능하도록 서버 로그에는 남겨둔다.
  res.status(200).json({ ok: true, saved: savedOk });
};
