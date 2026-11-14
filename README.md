# old-guitar-bye

중고 기타 매물 탐지부터 매입, 재고, 수리, 판매까지 관리하는 소형 기타 리퍼비시 사업 운영 시스템입니다.

- Telegram은 향후 운영 UI로 사용합니다.
- DB가 source of truth입니다.
- 현재 구현은 Inventory/Acquisition state machine과 SQLite 장부입니다.
- Node.js 22, JavaScript, GitHub Actions를 사용합니다.

## Implemented

- Inventory state machine
- Acquisition state machine
- SQLite schema/migrations
- ListingRepository
- AcquisitionRepository

## Telegram bot

읽기 전용 봇은 `TELEGRAM_BOT_TOKEN`, `DATABASE_PATH`, `TELEGRAM_ALLOWED_CHAT_ID=<아버지 chat id>`를 설정한 뒤 `npm run bot`으로 실행합니다. Bot token과 chat ID는 source code에 hard-code하거나 Git에 commit하지 않습니다.




## Daangn collection PoC

당근 공개 웹 검색 결과를 저빈도로 읽어 기존 `ListingRepository`에 저장하는 PoC입니다.
로그인, CAPTCHA 우회, 프록시/anti-bot 회피는 사용하지 않습니다.

환경 변수:
- `DAANGN_SEARCH_KEYWORDS`: 쉼표 구분 검색어. 기본값 `기타,통기타,어쿠스틱 기타`
- `DAANGN_REGION`: 선택 지역명. 설정하면 공개 region resolver로 URL의 `in` 값을 결정
- `DAANGN_RESULTS_PER_KEYWORD`: 검색어별 첫 응답에서 사용할 최대 후보 수. 기본 20
- `DATABASE_PATH`: SQLite 경로

실행: `npm run collect:daangn`

현재 PoC는 검색 결과 첫 HTML 응답만 읽습니다. 접근이 403/429/CAPTCHA로 차단되면 우회하지 않고 실패합니다.

### 번개장터 모델 식별 진단

운영 서버의 저장소 디렉터리에서 Node.js 22로 실행합니다.

```bash
cd /home/ubuntu/old-guitar-bye
DATABASE_PATH=/home/ubuntu/old-guitar-bye/data/guitar.db \
  npm run -s diagnose:identity > /tmp/old-guitar-identity.json
```

SQLite를 읽기 전용으로 열고 현재 DB에 보관된 번개장터 매물의 최신 제목, 설명, 호가를 분석합니다. 마이그레이션이나 외부 조회 없이 실행할 수 있습니다. 최상위 집계는 `lastSeenAt` 기준 최근 30일이며, `allTime`은 현재 보관된 전체 매물입니다. 최근 집계에는 이전에 등록된 후 기간 내 다시 수집된 매물도 포함됩니다.

- `reasonCounts`는 매물마다 대표 실패 원인 하나를 집계합니다. 샘플의 `reasons`에는 식별기가 반환한 전체 근거가 있습니다.
- `failureRelevanceCounts`는 기타 매물로 판정된 `RELEVANT`와 판정이 유보된 `UNCERTAIN`을 구분합니다. `byBrand`의 `evaluatedCount`는 평가기가 관련성 필터를 통과시킨 해당 브랜드 매물 수입니다. 브랜드 미확정 및 충돌은 `brand: null`에 집계합니다.
- 호가 분포는 양의 정수 원화 값의 최소·최대 및 nearest-rank 분위수입니다. 0원과 유효하지 않은 값은 별도로 셉니다.
- `titleModelHints`는 실패 제목에 반복되는 코드·영문 토큰입니다. 모델명이 확인된 값으로 해석하면 시리즈명, 옵션명, 일련번호 등에서 오탐이 생길 수 있습니다.
- `reviewPriorities`는 브랜드·실패 유형별로 `RELEVANT` 건수, 이어서 `UNCERTAIN` 건수가 많은 순입니다. 대표 제목과 URL, 검토 시 유의할 오탐 위험이 포함됩니다. 순위는 실제 매입 기회나 개선 효과를 추정하지 않습니다.
- `IDENTITY_DIAGNOSTIC_LOOKBACK_DAYS`로 최근 기간을, `IDENTITY_DIAGNOSTIC_LIMIT`으로 기간별 샘플·우선 검토 항목 및 브랜드별 패턴 최대 개수를 바꿀 수 있습니다. 기본값은 각각 30입니다.
