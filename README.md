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

Next: implement minimal InventoryRepository. InventoryItem should only be created after Acquisition reaches RECEIVED.
