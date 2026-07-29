# Lumen AI v1.6.1 — API Stability Fix

## 수정 내용
- `/api/write`가 없거나 HTML 오류 페이지를 반환할 때 원인을 정확히 안내
- `OPENAI_API_KEY` 누락, 인증, 사용 한도, 모델 오류, 시간 초과 메시지 구분
- 기본 모델 실패 시 호환 모델로 자동 재시도
- `/api/health` 배포 상태 확인 엔드포인트 추가
- API 응답 캐시 방지
- PWA 캐시 버전 갱신

## Vercel 환경 변수
- 필수: `OPENAI_API_KEY`
- 선택: `OPENAI_MODEL`

환경 변수를 추가하거나 수정한 뒤에는 반드시 Redeploy 하세요.

## 확인 주소
배포 주소 뒤에 `/api/health`를 붙여 열었을 때 아래와 비슷한 JSON이 나오면 API 배포가 정상입니다.

```json
{"ok":true,"apiKeyConfigured":true,"model":"automatic"}
```


## v1.6.2 deployment fix
- Replaced individual function patterns with `api/*.js` to prevent Vercel UNMATCHED_FUNCTION_PATTERN build failures.
- Both `/api/write` and `/api/health` are automatically detected from the root `api` directory.
