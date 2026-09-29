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
