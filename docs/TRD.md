# TRD — My Tasks 기술 설계 문서

| 항목 | 내용 |
|---|---|
| 문서 | 기술 요구사항·설계 문서 (Technical Requirements Document) |
| 작성일 | 2026-11-11 |
| 관련 문서 | [PRD.md](./PRD.md) (제품 요구사항), [TASK.md](./TASK.md) (작업 목록) |

---

## 1. 기술 스택과 실행 환경

| 항목 | 결정 | 이유 |
|---|---|---|
| 언어 | HTML5, CSS3, JavaScript (ES2021+, 클래식 스크립트) | 빌드 없이 파일을 열면 동작 (NFR-7) |
| 프레임워크·라이브러리 | 없음 | 의존성·설치 과정 제거 |
| 저장소 | `localStorage` | 서버 없는 개인용 앱 |
| 실행 | `index.html`을 브라우저로 직접 열기 (`file://`) 또는 정적 호스팅 | — |
| 대상 브라우저 | 최신 Chrome / Edge / Firefox / Safari | `<dialog>`, Pointer Events, `content-visibility`, `??=` 사용 |

`<dialog>`나 `crypto.randomUUID`가 없는 환경에는 대체 동작을 둔다 (`window.confirm`, 시간+난수 ID).

## 2. 파일 구조

```
todolist/
├── index.html   마크업. 테마 초기화 인라인 스크립트 포함
├── style.css    디자인 토큰, 컴포넌트, 반응형 레이아웃, 애니메이션
├── script.js    앱 로직 전체
└── docs/        PRD / TRD / TASK 문서
```

`script.js`는 모든 요소를 **id로 찾는다**. 마크업 구조를 바꿔도 id는 유지해야 한다.

---

## 3. 데이터 설계

### 3.1 할 일 객체

```js
{ id: string, text: string, completed: boolean, createdAt: string /* ISO 8601 */, category: 'work' | 'personal' | 'study' }
```

`todos` 배열의 순서 = 사용자가 정한 순서(드래그 결과). 화면 표시 순서는 정렬 모드에 따라 이 배열에서 계산한다.

### 3.2 localStorage 키

| 키 | 값 | 설명 |
|---|---|---|
| `todos` | JSON 배열 | 할 일 목록 |
| `todoFilter` | `all` \| `work` \| `personal` \| `study` | 현재 필터 |
| `todoSort` | `status` \| `manual` \| `created` \| `category` | 정렬 방식 |
| `theme` | `light` \| `dark` | 테마. `index.html` `<head>`의 인라인 스크립트와 같은 키 |
| `todoAutoCategory` | `on` \| `off` | 키워드 자동 분류 (없으면 켜짐) |
| `todos_corrupt_backup` | 문자열 | 파싱에 실패한 원본 데이터 보관용 |

저장된 선택값(필터·정렬)은 허용 목록으로 검증한 뒤 사용한다 (`hasOwnProperty` 기반, 프로토타입 키 방지).

### 3.3 데이터 검증 (`sanitizeTodo` / `sanitizeTodos`)

저장소와 가져오기 파일에서 들어온 데이터는 모두 같은 함수로 정제한다.

- `text`가 문자열이 아니거나 공백뿐이면 **버린다**. 앞뒤 공백 제거 후 200자로 자른다.
- `id`가 숫자면 문자열로 바꾸고, 없거나 같은 묶음 안에서 중복이면 새로 만든다.
- `completed`는 `true`일 때만 true.
- `createdAt`이 날짜로 해석되지 않으면 현재 시각.
- `category`가 허용값이 아니면 `personal`.
- 결과로 `{ valid, invalid }`(유효 항목, 버린 개수)를 반환한다.

### 3.4 내보내기 파일 형식

```json
{
  "app": "my-tasks",
  "version": 1,
  "exportedAt": "2026-11-11T05:30:00.000Z",
  "count": 8,
  "todos": [ /* 할 일 객체 */ ]
}
```

가져오기는 위 형식과 할 일 배열 자체를 모두 허용한다. `version`이 현재(1)보다 크면 경고만 하고 진행한다.
파일 앞의 BOM은 제거한다.

---

## 4. 애플리케이션 구조 (`script.js`)

파일은 다음 순서의 섹션으로 나뉜다. 상태 초기화(`loadTodos` 등)에서 바로 쓰이는 `storage` 래퍼는
**상태 선언보다 먼저** 정의해야 한다 (`const`는 선언 전 접근 시 ReferenceError).

| 섹션 | 내용 |
|---|---|
| 1. 상수 / DOM 참조 | 저장소 키, 한도·시간 상수, 카테고리, 정렬 라벨, 단축키 표, 키워드 사전, 격언, DOM 요소, `storage` 래퍼 |
| 2. 상태 | `todos`, `currentFilter`, `currentSort`, `searchQuery`, `editingId`, 자동 분류 상태, `itemCache`, `pendingAnimation`, `pendingFocus`, `busyIds`, `undoStack`, `drag` |
| 3. 유틸 | `debounce`, 날짜·시간, `normalizeText`, 애니메이션 헬퍼, 데이터 검증, 저장 |
| 4. 피드백 | `showToast`, `announce`(스크린 리더 전용), `openDialog`(범용 모달) |
| 5. 상태 변경 | 추가 / 삭제 / 실행 취소 / 완료 / 필터 / 정렬 / 검색 / 자동 분류 / 인라인 편집 / 테마 / 격언 / 내보내기·가져오기 |
| 6. 렌더링 | `renderStats`, `getVisibleTodos`, 요소 생성, 키 기반 재조정 `renderList`, 포커스 복원 |
| 7. 드래그 앤 드롭 | 포인터 드래그, 키보드 이동, 자동 스크롤, DOM 순서 → 데이터 반영 |
| 8. 이벤트 바인딩 | 폼, 필터, 검색, 목록(이벤트 위임), 전역 단축키, storage·pagehide·error 이벤트 |
| 9. 초기화 | 테마·정렬·카테고리 동기화, 첫 렌더링, 시작 경고 표시, 1분 주기 갱신 |

### 4.1 데이터 흐름

```
사용자 동작 → 상태 변경 → saveTodos() (디바운스 300ms)
                       → renderStats() (즉시 — 대시보드는 애니메이션을 기다리지 않음)
                       → (퇴장 애니메이션 대기)
                       → renderList()
```

### 4.2 주요 상수

| 상수 | 값 | 용도 |
|---|---|---|
| `MAX_TEXT_LENGTH` | 200 | 할 일 최대 길이 |
| `MAX_IMPORT_BYTES` | 5MB | 가져오기 파일 최대 크기 |
| `EXPORT_VERSION` | 1 | 내보내기 형식 버전 |
| `SAVE_DEBOUNCE_MS` | 300 | 저장 디바운스 |
| `SEARCH_DEBOUNCE_MS` | 200 | 검색 디바운스 |
| `DUP_HINT_DEBOUNCE_MS` / `AUTO_CATEGORY_DEBOUNCE_MS` | 150 | 중복 경고 / 자동 분류 디바운스 |
| `ANIMATION_MS` | 250 | 항목 애니메이션 길이 (CSS `--anim-duration`과 일치시킬 것) |
| `TOAST_MS` / `UNDO_TOAST_MS` | 2500 / 6000 | 일반 / 실행 취소 토스트 표시 시간 |
| `MAX_TOASTS` | 3 | 동시에 보이는 토스트 수 |
| `UNDO_STACK_LIMIT` | 10 | 실행 취소 가능한 작업 수 |
| `DRAG_THRESHOLD_PX` | 4 | 드래그로 인정하는 최소 이동 |
| `AUTO_SCROLL_EDGE_PX` / `AUTO_SCROLL_MAX_SPEED` | 60 / 20 | 자동 스크롤 영역 / 최대 속도(px/프레임) |

---

## 5. 핵심 설계

### 5.1 렌더링 — 키 기반 DOM 재사용

`itemCache: Map<id, { el, sig }>`에 항목 요소를 보관한다.

- **서명(sig)** = `text`, `completed`, `category`, 편집 중 여부, 검색어를 이어 붙인 문자열.
  서명이 같으면 기존 요소를 재사용하고, 다르면 새로 만들어 같은 자리에서 교체한다.
- 화면 순서와 다를 때만 `insertBefore`로 옮기고, 보이지 않게 된 항목만 제거한다.
- 드래그 핸들 표시 여부는 서명에 넣지 않고 목록의 CSS 클래스(`todo-list--sortable`)로 처리해 정렬 모드 변경 시 재생성을 피한다.
- 화면 밖 항목은 `content-visibility: auto`로 브라우저가 그리기를 건너뛴다.
- 상대 시간·오늘 개수는 1분마다 텍스트만 갱신한다 (탭이 숨겨져 있으면 건너뜀).
- 이벤트는 목록에 위임(delegation)하므로 항목 수와 무관하게 리스너 수가 일정하다.
- 모든 텍스트는 `textContent`·`createElement`로 넣는다. 검색 강조도 `<mark>` 요소를 만들어 붙인다 (`innerHTML` 미사용).

### 5.2 정렬 (`getVisibleTodos`)

필터·검색 적용 후 새 배열을 정렬한다 (원본 보존, 안정 정렬).

| 모드 | 규칙 | 드래그 |
|---|---|---|
| `status` (기본) | 미완료 먼저, 그룹 안은 배열 순서 | 가능 (같은 그룹 안에서만) |
| `manual` | 배열 순서 그대로 | 가능 |
| `created` | `createdAt` 내림차순 (ISO 문자열 비교) | 불가 |
| `category` | 업무 → 개인 → 공부, 그룹 안은 배열 순서 | 불가 |

### 5.3 드래그 앤 드롭

- **Pointer Events** + `setPointerCapture`로 마우스·터치·펜을 한 코드로 처리한다. 핸들에 `touch-action: none`.
- 드래그 중인 항목은 `translateY`로 포인터를 따라가고, 항목 중심이 이웃 항목의 중심을 넘으면 **이웃 요소를 옮겨** 자리를 바꾼다.
  위치 비교는 `offsetTop`(레이아웃 좌표)으로 한다 — `getBoundingClientRect`는 이웃의 이동 애니메이션까지 반영해 자리 교체가 왔다 갔다 반복될 수 있다.
- 이웃 이동은 **FLIP** 애니메이션(150ms)으로 부드럽게 처리한다.
- **자동 스크롤**: `requestAnimationFrame` 루프. 포인터가 멈춰 있어도 가장자리에 있는 동안 계속 스크롤하며, 깊이 들어갈수록 빨라진다.
  위쪽 경계는 **상단 고정 바(데스크톱 검색·정렬 바) 아래**를 기준으로 계산한다 (`getTopInset`). 고정 바가 없는 화면에서는 화면 맨 위가 기준이다.
- **DOM 순서 → 데이터 반영** (`commitDomOrder`): 화면에 보이는 항목들이 차지하던 배열 인덱스("슬롯")를 오름차순으로 모은 뒤, 새 화면 순서대로 그 슬롯을 다시 채운다. 필터·검색으로 숨겨진 항목의 위치는 그대로 유지된다.
- 키보드 이동(↑/↓)은 포커스를 잃지 않도록 **포커스된 항목이 아니라 이웃을 옮긴다.**
- ESC·`pointercancel`·다른 탭 변경 시 드래그를 취소하고 데이터 기준으로 다시 그린다.

### 5.4 실행 취소 스택

```js
{ type: 'delete',   items: [{ todo, index }], dismissToast }  // 삭제: 원래 인덱스 오름차순으로 다시 끼워 넣음
{ type: 'snapshot', todos, label, dismissToast }              // 가져오기: 이전 배열 전체로 복원
```

- 최대 10개 보관. 토스트 버튼과 Ctrl+Z가 같은 항목을 가리킬 수 있으므로 스택에 있을 때만 실행한다.
- 복구 시 이미 같은 ID가 있으면 건너뛴다. 퇴장 애니메이션이 남은 캐시 요소는 버리고 새로 만든다.

### 5.5 키워드 자동 분류 (`classifyText`)

1. 키워드 사전 `CATEGORY_KEYWORDS`: 카테고리별 `strong`(가중치 1)·`weak`(가중치 0.5) 목록. 한국어·영어 약 140개.
2. 입력과 키워드를 **소문자 + 공백 제거**로 정규화한다 ('책 읽기' = '책읽기').
3. 모든 키워드를 **긴 것부터** 매칭하고, 이미 매칭된 글자와 겹치는 짧은 키워드는 세지 않는다.
4. 카테고리 점수 = Σ(키워드 글자 수 × 가중치). 최고 점수를 선택하고, **동점이면 문장 뒤쪽에 나온 키워드**의 카테고리를 택한다 ('점심 미팅' → 업무).
5. 키워드가 없으면 `null` → 기본 카테고리 사용.

사전 규칙: 한 글자 키워드는 넣지 않는다 (예: '책' ⊂ '책상'). 같은 단어를 두 카테고리에 넣지 않는다.

UI 상태: `autoCategoryEnabled`(설정), `baseCategory`(키워드가 없을 때 쓸 값), `categoryLocked`(이번 입력에서 사용자가 직접 고름), `autoApplied`(현재 자동 적용된 결과).

### 5.6 포커스 관리

- `pendingFocus = { id, role }`을 지정하면 다음 `renderList` 끝에서 해당 항목의 `data-role` 요소에 포커스한다. `id`가 `null`이면 새 할 일 입력창.
- 렌더링 중 요소 교체·이동으로 포커스를 잃으면 같은 항목의 같은 컨트롤로 복원한다.
- 편집 중에 다른 이유(필터 단축키 등)로 편집이 끝나 입력창이 사라지면 그 항목의 수정 버튼으로 보낸다.
- 숨겨진 컨트롤(정렬 불가 모드의 핸들)은 체크박스로 대체한다.
- 삭제 시 포커스가 그 항목 안에 있었다면 다음(없으면 이전) 항목의 같은 버튼으로 옮긴다.
- 편집 종료: Enter/저장 버튼이면 수정 버튼으로 포커스를 되돌리고, 다른 곳 클릭(focusout)이면 사용자가 옮긴 포커스를 유지한다.

### 5.7 인라인 편집

- 편집 상태는 `editingId` 하나로 관리하며, 렌더링이 상태를 보고 편집 UI를 그린다.
- `focusout`에서 `relatedTarget`이 편집 영역 밖일 때만 저장한다 (입력창 ↔ 선택 박스 ↔ 버튼 이동은 제외).
- 저장/취소 버튼은 `mousedown`에서 기본 동작을 막아, 누를 때 입력창 포커스가 먼저 빠지며 저장되는 일을 막는다.
- 한글 IME 조합 중의 Enter(`isComposing` 또는 `keyCode 229`)는 무시한다.

### 5.8 피드백 컴포넌트

- **토스트**: `role="status"` 영역. 최대 3개, 마우스 오버·포커스 중 타이머 정지, 선택적 액션 버튼(실행 취소).
- **스크린 리더 안내** (`announce`): 화면에 보이지 않는 `aria-live` 영역. 같은 문장도 다시 읽히도록 비웠다가 다시 설정한다.
- **다이얼로그** (`openDialog`): 하나의 `<dialog>`를 재사용. 제목·메시지·추가 콘텐츠·버튼 목록을 받아 누른 버튼의 `value`로 resolve. 첫 버튼(취소)에 포커스, 배경 클릭·ESC는 취소. 이미 열려 있으면 중첩하지 않는다.

### 5.9 저장과 동기화

- 저장은 디바운스(300ms)하고, `pagehide`·탭 숨김 시 즉시 실행(`flush`)한다. 내보내기·가져오기·스냅샷 복원은 즉시 저장한다.
- 저장 실패 토스트는 성공할 때까지 한 번만 띄운다.
- `storage` 이벤트: 다른 탭의 `todos`·`theme` 변경을 반영한다. 이 탭에 저장 대기 중인 변경이 있으면 무시한다 (곧 이 탭 내용으로 덮어씀).
- 시작 시 저장 데이터 파싱에 실패하면 원본을 `todos_corrupt_backup`에 보관하고 빈 상태로 시작하며 경고를 띄운다.
- 전역 `error`(이 스크립트에서 난 것만)·`unhandledrejection`도 토스트로 알린다.

### 5.10 테마

- `index.html` `<head>`의 인라인 스크립트가 CSS 적용 전에 `data-theme`을 정해 깜빡임을 막는다 (저장값 → 없으면 OS 설정).
- 전환 순간에만 `theme-transition` 클래스를 0.4초 붙여 색 전환 애니메이션을 준다.
- 저장값이 없으면 OS 테마 변경을 따라간다.

---

## 6. 스타일 설계 (`style.css`)

### 6.1 디자인 토큰

- 모든 색은 `:root` 변수로 정의하고 `:root[data-theme="dark"]`에서 재정의한다. `color-scheme`도 함께 바꿔 기본 컨트롤 색을 맞춘다.
- 카테고리 색은 `data-category` 속성으로 `--accent`(채우기)·`--accent-text`(글자)를 지정한다. 다크 모드에서는 글자용 색을 밝게 조정한다.

### 6.2 반응형 기준

| 조건 | 레이아웃 |
|---|---|
| 기본 (≤ 480px 포함) | 카드형 단일 열. 480px 이하에서 44px 터치 영역, 필터 2×2, 입력창 한 줄 전체 |
| 481 ~ 1023px | 카드 최대 760px |
| ≥ 1024px | `.app` 그리드 `320px | 1fr`. 사이드바 `position: sticky; height: 100vh`, 검색·정렬 바 상단 고정, 입력 카드, 항목 한 줄형(텍스트 왼쪽·태그와 시간 오른쪽), 메인 최대 1280px, 토스트 오른쪽 아래 |
| ≥ 1440px | 사이드바 360px, 여백 확대 |
| ≥ 1024px 이고 높이 ≤ 860px | 사이드바 압축(간격·글자 축소, 카테고리 진행률 가로 3칸) |
| ≥ 1024px | 항목에 `scroll-margin-top: 110px` — 스크롤 이동 시 고정 바에 가려지지 않게 |

### 6.3 기타 규칙

- 호버 효과는 `@media (hover: hover)` 안에서만 적용 (터치 기기의 hover 고착 방지). 수정 버튼은 마우스 환경에서 호버·포커스 시에만 보인다.
- `@media (prefers-reduced-motion: reduce)`에서 모든 애니메이션·전환을 끈다. JS의 애니메이션 대기도 같은 조건에서 생략한다.
- 단축키 안내는 `max-width: 480px` 또는 `hover: none`에서 숨긴다.

---

## 7. 접근성 구현

- 모든 버튼·입력에 `aria-label`. 항목 버튼 레이블에 할 일 내용을 포함한다.
- 필터 `aria-pressed`, 테마 토글 `role="switch"` + `aria-checked`, 진행률 `role="progressbar"` + `aria-valuetext`.
- 단축키를 `aria-keyshortcuts`로 노출한다.
- 목록 사용법을 `aria-describedby`로 안내한다 (더블클릭·수정 버튼, 핸들에서 화살표 키).
- 검색 결과 수·순서 변경 위치("N개 중 M번째")를 스크린 리더로 안내한다.
- 체크박스는 `label`로 감싸 터치 영역을 넓힌다.

---

## 8. 검증 방법

이 환경에는 Node.js가 없어 **헤드리스 Edge**로 검증했다.

- 앱 파일을 임시 폴더에 복사하고 `script.js` 뒤에 테스트 스크립트를 붙인 페이지를 `--dump-dom`으로 실행해, 결과를 DOM에 기록하고 읽는다.
- 화면은 `--screenshot --window-size`로 데스크톱·태블릿을 캡처한다. 헤드리스 창은 약 500px보다 좁아지지 않으므로 휴대폰 화면은 390px 폭 `<iframe>`으로 확인한다.
- 헤드리스 모드의 한계:
  - `<dialog>`의 `close` 이벤트가 발생하지 않는다 → 테스트에서 직접 `dispatchEvent`.
  - `requestAnimationFrame`이 거의 실행되지 않는다(0.5초에 약 2회) → 드래그 자동 스크롤 테스트에서는 16ms 타이머로 대체.
  - `animationend`가 오지 않을 수 있다 → 앱 코드는 타임아웃 대비가 있어 영향 없음.
  - 실제 시간이 흐르지 않아 성능 수치는 측정되지 않는다.
- 테스트 스크립트는 저장소에 포함되어 있지 않다 (TASK.md 백로그).

---

## 9. 알려진 이슈와 기술 부채

| 항목 | 내용 |
|---|---|
| 동시 수정 | 두 탭에서 동시에 수정하면 마지막 저장이 이긴다 (병합 없음). |
| `Alt+D` 충돌 | 브라우저 주소창 단축키와 겹친다. |
| 키워드 사전 | 부분 문자열 매칭이라 사전에 없는 맥락에서 오분류할 수 있다. 사전은 코드 상수로만 관리한다. |
| 테스트 | 자동 테스트가 저장소에 없고, 드래그·가져오기·다크 모드 시각은 실제 브라우저 수동 확인이 필요하다. |
| 버전 관리 | git 저장소가 아니다. 통합 전 버전 백업은 바탕화면 `todolist` 폴더에 있다. |
| 단일 파일 | `script.js`가 약 2,200줄이다. 기능이 더 늘면 모듈 분리를 검토한다 (현재는 빌드 없이 열리는 것을 우선). |
