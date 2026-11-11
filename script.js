'use strict';

/* =========================================================
 * My Tasks — 할 일 관리 앱
 *
 * 구조
 *   1. 상수 / DOM 참조
 *   2. 상태 (todos, 필터, 정렬, 편집, 드래그, 실행 취소 스택 ...)
 *   3. 유틸 (디바운스, 날짜, 저장소 래퍼, 데이터 검증)
 *   4. 피드백 (토스트, 스크린 리더 안내, 다이얼로그)
 *   5. 상태 변경 함수 (추가/삭제/토글/편집/정렬/가져오기 ...)
 *   6. 렌더링 (키 기반 DOM 재사용)
 *   7. 드래그 앤 드롭 (포인터 + 키보드)
 *   8. 이벤트 바인딩
 *   9. 초기화
 *
 * 데이터 흐름 원칙
 *   데이터 변경 → saveTodos()(디바운스 저장) → renderStats()(즉시) → (애니메이션) → renderList()
 *
 * 각 할 일의 구조: { id, text, completed, createdAt(ISO 문자열), category }
 * ========================================================= */

// =========================================================
// 1. 상수 / DOM 참조
// =========================================================

const STORAGE_KEY = 'todos';
const FILTER_KEY = 'todoFilter';
const SORT_KEY = 'todoSort';
const THEME_KEY = 'theme'; // index.html <head>의 인라인 스크립트와 같은 키
const AUTO_CATEGORY_KEY = 'todoAutoCategory'; // 'on' | 'off'
const CORRUPT_BACKUP_KEY = 'todos_corrupt_backup'; // 손상된 원본 데이터 보관용

const MAX_TEXT_LENGTH = 200;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 가져오기 파일 최대 5MB
const EXPORT_VERSION = 1;

const ANIMATION_MS = 250; // style.css의 --anim-duration과 맞출 것
const TOAST_MS = 2500;
const UNDO_TOAST_MS = 6000; // 실행 취소 버튼이 있는 토스트는 더 오래 표시
const MAX_TOASTS = 3;
const UNDO_STACK_LIMIT = 10;
const SAVE_DEBOUNCE_MS = 300;
const SEARCH_DEBOUNCE_MS = 200;
const DUP_HINT_DEBOUNCE_MS = 150;
const AUTO_CATEGORY_DEBOUNCE_MS = 150;
const DRAG_THRESHOLD_PX = 4; // 이만큼 움직여야 드래그로 간주 (클릭과 구분)
const AUTO_SCROLL_EDGE_PX = 60; // 화면 가장자리(상단 고정 바 아래 기준)에서 이 거리 안이면 자동 스크롤
const AUTO_SCROLL_MAX_SPEED = 20; // 자동 스크롤 최대 속도 (px/프레임)

const CATEGORIES = {
  work: '업무',
  personal: '개인',
  study: '공부',
};
const CATEGORY_KEYS = Object.keys(CATEGORIES);
const CATEGORY_RANK = Object.fromEntries(CATEGORY_KEYS.map((key, i) => [key, i]));
const DEFAULT_CATEGORY = 'personal';
const FILTER_LABELS = { all: '전체', ...CATEGORIES };

const SORT_LABELS = {
  status: '완료 상태순', // 기본: 미완료 위, 완료 아래 (그룹 안에서는 직접 정한 순서)
  manual: '직접 정렬', // 드래그로 정한 순서 그대로
  created: '생성일순 (최신)',
  category: '카테고리순',
};
const DEFAULT_SORT = 'status';
/** 드래그로 순서를 바꿀 수 있는 정렬 모드 (화면 순서 = 배열 순서가 유지되는 모드만) */
const SORTABLE_MODES = new Set(['status', 'manual']);

// Alt+숫자 → 필터. e.code를 쓰므로 한글 입력 상태에서도 동작
const FILTER_SHORTCUTS = {
  Digit1: 'all',
  Digit2: 'work',
  Digit3: 'personal',
  Digit4: 'study',
};

/**
 * 키워드 기반 자동 분류 사전.
 *  - strong: 그 카테고리를 강하게 암시하는 단어 (점수 = 글자 수)
 *  - weak:   여러 맥락에서 쓰이는 단어 (점수 = 글자 수 × 0.5)
 * 비교는 소문자 + 공백 제거 후 부분 문자열로 하므로 '책 읽기'는 '책읽기'에도 매칭됨.
 * 한 글자 키워드는 오분류가 잦아(예: '책' ⊂ '책상') 넣지 않는다.
 * 같은 단어를 두 카테고리에 중복해서 넣지 말 것.
 */
const CATEGORY_KEYWORDS = {
  work: {
    strong: [
      '회의', '회의록', '미팅', '보고서', '업무', '출근', '퇴근', '야근', '회사', '프로젝트',
      '기획서', '기획안', '제안서', '발표 자료', '프레젠테이션', '결재', '계약서', '거래처',
      '클라이언트', '출장', '팀장', '부장', '상사', '동료', '면접', '채용', '견적', '정산',
      '매출', '예산', '협업', '코드 리뷰', '배포', '슬랙', '엑셀', '인수인계', '워크숍',
      'meeting', 'report', 'client', 'project', 'deploy', 'presentation', 'invoice',
    ],
    weak: ['마감', '메일', '이메일', '일정', '고객', '자료', '발표', 'email', 'deadline'],
  },
  personal: {
    strong: [
      '운동', '헬스', '요가', '필라테스', '산책', '조깅', '러닝', '등산', '장보기', '마트',
      '쇼핑', '청소', '빨래', '설거지', '분리수거', '집안일', '요리', '병원', '치과', '약국',
      '친구', '가족', '부모님', '엄마', '아빠', '생일', '선물', '여행', '미용실', '은행',
      '공과금', '월세', '관리비', '택배', '반려', '강아지', '고양이', '영화', '데이트',
      '다이어트', '세차', '이사', '결혼식',
      'gym', 'workout', 'grocery', 'birthday', 'dinner', 'laundry',
    ],
    weak: ['약속', '예약', '저녁', '점심', '아침', '휴가', '주말'],
  },
  study: {
    strong: [
      '공부', '복습', '예습', '숙제', '과제', '시험', '중간고사', '기말고사', '수업', '강의',
      '인강', '독서', '책 읽기', '영어', '단어', '토익', '토플', '오픽', '자격증', '수학',
      '문제집', '문제 풀이', '논문', '레포트', '스터디', '학원', '코딩 테스트', '알고리즘',
      '강좌', '튜토리얼', '필기', '암기', '외우기', '학습', '회화', '독후감', '모의고사',
      'study', 'homework', 'exam', 'lecture', 'course', 'tutorial', 'quiz',
    ],
    weak: ['읽기', '정리 노트', '연습', '공부법'],
  },
};

// 오늘의 격언. 일부는 해당 인물의 말로 '알려진' 문구임
const QUOTES = [
  { text: '천 리 길도 한 걸음부터.', author: '속담' },
  { text: '시작이 반이다.', author: '속담' },
  { text: '티끌 모아 태산.', author: '속담' },
  { text: '늦었다고 생각할 때가 가장 빠를 때다.', author: '속담' },
  { text: '오늘 할 수 있는 일을 내일로 미루지 마라.', author: '벤저민 프랭클린' },
  { text: '성공은 매일 반복한 작은 노력들의 합이다.', author: '로버트 콜리어' },
  { text: '우리가 반복적으로 하는 행동이 바로 우리 자신이다.', author: '윌 듀런트' },
  { text: '앞서 나가는 비결은 시작하는 것이다.', author: '마크 트웨인' },
  { text: '어떤 일이든 끝내기 전까지는 항상 불가능해 보인다.', author: '넬슨 만델라' },
  { text: '미래를 예측하는 가장 좋은 방법은 미래를 발명하는 것이다.', author: '앨런 케이' },
  { text: '행동은 모든 성공의 기본 열쇠다.', author: '파블로 피카소' },
  { text: '작은 기회로부터 종종 위대한 업적이 시작된다.', author: '데모스테네스' },
  { text: '완벽함보다 완료가 낫다.', author: '실리콘밸리 격언' },
];

const $ = (id) => document.getElementById(id);
const root = document.documentElement;

const form = $('todo-form');
const input = $('todo-input');
const categorySelect = $('todo-category');
const dupHint = $('dup-hint');
const autoCategoryToggle = $('auto-category');
const categoryHint = $('category-hint');
const filters = $('filters');
const filterButtons = [...filters.querySelectorAll('.filter-btn')];
const list = $('todo-list');
const emptyState = $('todo-empty');
const emptyIcon = $('todo-empty-icon');
const emptyText = $('todo-empty-text');
const statsSummary = $('stats-summary');
const statsProgress = $('stats-progress');
const statsBar = $('stats-bar');
const statsCheer = $('stats-cheer');
const statsToday = $('stats-today');
const remainingBadge = $('remaining-badge');
const themeToggle = $('theme-toggle');
const searchInput = $('search-input');
const sortSelect = $('sort-select');
const clearCompletedBtn = $('clear-completed');
const exportBtn = $('export-btn');
const importBtn = $('import-btn');
const importFile = $('import-file');
const quoteSection = document.querySelector('.quote');
const quoteText = $('quote-text');
const quoteAuthor = $('quote-author');
const quoteRefresh = $('quote-refresh');
const dialogEl = $('app-dialog');
const dialogTitle = $('dialog-title');
const dialogMessage = $('dialog-message');
const dialogExtra = $('dialog-extra');
const dialogActions = $('dialog-actions');
const toastContainer = $('toasts');
const announcer = $('sr-announcer');

/** 카테고리별 미니 진행률 요소를 미리 찾아둠 (매 렌더마다 querySelector 하지 않도록) */
const statCategoryEls = [...document.querySelectorAll('.stat-cat')].map((el) => ({
  category: el.dataset.category,
  count: el.querySelector('.stat-cat__count'),
  bar: el.querySelector('.progress__bar'),
}));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * localStorage 래퍼: 사생활 보호 모드·용량 초과 등으로 예외가 나도 앱이 멈추지 않게.
 * 아래 상태 초기화(loadTodos 등)에서 바로 쓰이므로 반드시 상태 선언보다 먼저 정의해야 함
 * (const는 선언 전에 접근하면 ReferenceError).
 */
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn(`저장소 읽기 실패 (${key}):`, err);
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.error(`저장소 쓰기 실패 (${key}):`, err);
      return false;
    }
  },
};

// =========================================================
// 2. 상태
// =========================================================

/** 초기 로딩 중 발생한 경고. 토스트 시스템이 준비된 뒤 한꺼번에 표시 */
const startupWarnings = [];

/** @type {{ id: string, text: string, completed: boolean, createdAt: string, category: string }[]} */
let todos = loadTodos();
let currentFilter = loadChoice(FILTER_KEY, FILTER_LABELS, 'all');
let currentSort = loadChoice(SORT_KEY, SORT_LABELS, DEFAULT_SORT);
let searchQuery = '';
let editingId = null;

// ---------- 자동 분류 상태 ----------
let autoCategoryEnabled = storage.get(AUTO_CATEGORY_KEY) !== 'off'; // 기본값: 켜짐
/** 키워드가 없을 때 돌아갈 카테고리 (사용자가 마지막으로 고른 값 또는 필터에 맞춘 값) */
let baseCategory = DEFAULT_CATEGORY; // 초기화 단계에서 드롭다운 값으로 다시 설정
/** 이번 입력에서 사용자가 드롭다운을 직접 바꿨는지. true면 자동 분류가 덮어쓰지 않음 */
let categoryLocked = false;
/** 현재 드롭다운에 자동으로 적용된 분류 결과 (없으면 null) */
let autoApplied = null; // { category, keywords }

/** id → { el, sig }. 내용이 바뀌지 않은 항목은 DOM 요소를 재사용 (성능 핵심) */
const itemCache = new Map();

/** 다음 renderList에서 특정 항목에 재생할 진입 애니메이션 */
let pendingAnimation = null; // { id, className }
/** 다음 renderList 후 포커스를 줄 위치. id가 null이면 새 할 일 입력창 */
let pendingFocus = null; // { id, role }
/** 애니메이션 진행 중인 항목 (중복 클릭 방지) */
const busyIds = new Set();

/**
 * 실행 취소 스택 (최근 것이 마지막)
 *  - { type: 'delete', items: [{ todo, index }], dismissToast }
 *  - { type: 'snapshot', todos, label, dismissToast }  ← 가져오기 되돌리기용
 */
const undoStack = [];

/** 진행 중인 포인터 드래그 정보 */
let drag = null;

let lastRemaining = null; // 배지 애니메이션 판단용
let themeTimer = null;
let saveErrorShown = false; // 저장 실패 토스트를 반복해서 띄우지 않도록
let quoteIndex = getDailyQuoteIndex();

// =========================================================
// 3. 유틸
// =========================================================

/**
 * 디바운스: 마지막 호출 후 wait(ms) 동안 추가 호출이 없을 때 한 번만 실행.
 * flush()로 대기 중인 호출을 즉시 실행, cancel()로 취소, pending()으로 대기 여부 확인.
 */
function debounce(fn, wait) {
  let timer = null;
  let lastArgs = [];
  const run = () => {
    timer = null;
    fn(...lastArgs);
  };
  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(run, wait);
  };
  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      run();
    }
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  debounced.pending = () => timer !== null;
  return debounced;
}

function hasOwn(obj, key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
}

function isCategory(value) {
  return hasOwn(CATEGORIES, value);
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // randomUUID를 지원하지 않는 환경(구형 브라우저, 비보안 컨텍스트) 대비
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 중복 비교용 정규화: 앞뒤 공백 제거, 연속 공백 하나로, 대소문자 무시 */
function normalizeText(text) {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function truncate(text, max = 20) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatRelativeTime(isoString) {
  const diffSec = Math.floor((Date.now() - Date.parse(isoString)) / 1000);
  if (Number.isNaN(diffSec)) return '';
  if (diffSec < 60) return '방금 전'; // 시계가 어긋나 음수인 경우도 포함

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}주 전`;
  if (diffDay < 365) return `${Math.floor(diffDay / 30)}개월 전`;
  return `${Math.floor(diffDay / 365)}년 전`;
}

/** 오늘 0시 ~ 내일 0시 범위(ms). 통계 계산 시 항목마다 Date를 만들지 않도록 한 번만 계산 */
function getTodayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

/** 파일명용 날짜 문자열 (로컬 시간 기준): 2026-11-11_1430 */
function fileTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function percent(done, total) {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

function isTextField(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(el.type);
  }
  return false;
}

/** CSS 애니메이션을 처음부터 다시 재생 */
function restartAnimation(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth; // 리플로우를 강제해야 같은 애니메이션이 다시 재생됨
  el.classList.add(className);
  el.addEventListener('animationend', () => el.classList.remove(className), { once: true });
}

/** 항목에 퇴장 애니메이션 클래스를 붙이고 끝날 때까지 기다림 */
function animateOut(id, className) {
  const el = itemCache.get(id)?.el;
  if (!el || !el.isConnected || reduceMotion.matches) return Promise.resolve();

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    el.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, ANIMATION_MS + 100); // animationend가 오지 않는 경우 대비
    el.classList.add(className);
  });
}

/**
 * FLIP 애니메이션: 요소의 DOM 위치가 바뀐 뒤, 이전 위치에서 새 위치로 부드럽게 이동.
 * prevTop은 이동 전 offsetTop.
 */
function animateShift(el, prevTop) {
  if (reduceMotion.matches) return;
  const delta = prevTop - el.offsetTop;
  if (!delta) return;
  el.style.transition = 'none';
  el.style.transform = `translateY(${delta}px)`;
  void el.offsetWidth;
  el.style.transition = 'transform 150ms ease';
  el.style.transform = '';
  el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
}

// ---------- 데이터 검증 ----------

/**
 * 외부(저장소, 가져오기 파일)에서 들어온 객체 하나를 안전한 할 일 객체로 변환.
 * 필수값(text)이 없으면 null. 나머지 필드는 가능한 한 복구한다.
 * @param {unknown} raw
 * @param {Set<string>} usedIds 같은 묶음 안에서 id 중복을 막기 위한 집합
 */
function sanitizeTodo(raw, usedIds) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.text !== 'string') return null;

  const text = raw.text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!text) return null;

  let id = typeof raw.id === 'number' ? String(raw.id) : raw.id;
  if (typeof id !== 'string' || !id || usedIds.has(id)) id = generateId();
  usedIds.add(id);

  const createdMs = Date.parse(raw.createdAt);

  return {
    id,
    text,
    completed: raw.completed === true,
    createdAt: Number.isNaN(createdMs) ? new Date().toISOString() : new Date(createdMs).toISOString(),
    category: isCategory(raw.category) ? raw.category : DEFAULT_CATEGORY,
  };
}

/** 배열 전체 검증. 유효한 항목과 버려진 개수를 함께 반환 */
function sanitizeTodos(rawList) {
  const usedIds = new Set();
  const valid = [];
  let invalid = 0;
  for (const raw of rawList) {
    const todo = sanitizeTodo(raw, usedIds);
    if (todo) valid.push(todo);
    else invalid++;
  }
  return { valid, invalid };
}

/** 저장소 문자열 → 할 일 배열. 형식이 잘못되면 예외 발생 */
function parseStoredTodos(raw) {
  if (raw === null) return { todos: [], invalid: 0 };
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new TypeError('저장된 데이터가 배열이 아닙니다');
  const { valid, invalid } = sanitizeTodos(data);
  return { todos: valid, invalid };
}

// ---------- 저장소 ----------

function loadTodos() {
  const raw = storage.get(STORAGE_KEY);
  try {
    const { todos: loaded, invalid } = parseStoredTodos(raw);
    if (invalid > 0) startupWarnings.push(`형식이 잘못된 할 일 ${invalid}개를 건너뛰었습니다.`);
    return loaded;
  } catch (err) {
    // 손상된 원본을 별도 키에 보관해 두고 빈 상태로 시작 (데이터를 조용히 날리지 않음)
    console.error('저장된 데이터를 읽지 못했습니다:', err);
    storage.set(CORRUPT_BACKUP_KEY, raw);
    startupWarnings.push(`저장된 데이터가 손상되어 새로 시작합니다. 원본은 '${CORRUPT_BACKUP_KEY}' 키에 보관했습니다.`);
    return [];
  }
}

function writeTodos() {
  const ok = storage.set(STORAGE_KEY, JSON.stringify(todos));
  if (ok) {
    saveErrorShown = false;
  } else if (!saveErrorShown) {
    saveErrorShown = true;
    showToast('저장에 실패했습니다. 저장 공간이 부족하거나 브라우저가 저장을 막고 있습니다.', 'error', {
      duration: UNDO_TOAST_MS,
    });
  }
}

/** 디바운스 저장: 빠르게 연속 변경해도 마지막 한 번만 기록 */
const scheduleSave = debounce(writeTodos, SAVE_DEBOUNCE_MS);

function saveTodos() {
  scheduleSave();
}

/** 즉시 저장 (내보내기, 페이지 이탈 직전 등) */
function saveNow() {
  scheduleSave.cancel();
  writeTodos();
}

/** 저장된 선택값(필터, 정렬)을 허용 목록으로 검증해서 불러옴 */
function loadChoice(key, allowed, fallback) {
  const saved = storage.get(key);
  return hasOwn(allowed, saved) ? saved : fallback;
}

function loadSavedTheme() {
  const saved = storage.get(THEME_KEY);
  return saved === 'dark' || saved === 'light' ? saved : null;
}

// =========================================================
// 4. 피드백: 토스트 / 스크린 리더 안내 / 다이얼로그
// =========================================================

/**
 * 토스트 알림 표시.
 * @param {string} message
 * @param {'info'|'success'|'error'|'warning'} type
 * @param {{ action?: { label: string, onClick: () => void, shortcut?: string }, duration?: number }} options
 * @returns {() => void} 토스트를 즉시 닫는 함수
 */
function showToast(message, type = 'info', { action = null, duration = TOAST_MS } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;

  const text = document.createElement('span');
  text.textContent = message;
  toast.append(text);

  let timer = null;
  const dismiss = () => {
    if (!toast.isConnected || toast.classList.contains('toast--leaving')) return;
    clearTimeout(timer);
    toast.classList.add('toast--leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400); // 애니메이션이 꺼진 환경 대비
  };

  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast__action';
    btn.textContent = action.label;
    if (action.shortcut) btn.setAttribute('aria-keyshortcuts', action.shortcut);
    btn.addEventListener('click', () => {
      dismiss();
      action.onClick();
    });
    toast.append(btn);
  }

  toastContainer.append(toast);
  // 너무 많이 쌓이지 않도록 오래된 것부터 제거
  while (toastContainer.children.length > MAX_TOASTS) toastContainer.firstElementChild.remove();

  const startTimer = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(dismiss, ms);
  };
  startTimer(duration);
  // 마우스를 올리거나 버튼에 포커스가 있는 동안은 닫히지 않음 (읽고 누를 시간 확보)
  toast.addEventListener('mouseenter', () => clearTimeout(timer));
  toast.addEventListener('mouseleave', () => startTimer(1500));
  toast.addEventListener('focusin', () => clearTimeout(timer));
  toast.addEventListener('focusout', () => startTimer(1500));

  return dismiss;
}

/** 화면에는 표시하지 않고 스크린 리더에만 읽어줄 안내 */
function announce(message) {
  // 같은 문장을 연속으로 넣어도 다시 읽히도록 비웠다가 다음 틱에 설정
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = message; }, 50);
}

/**
 * 범용 모달 다이얼로그.
 * actions의 첫 번째 버튼에 포커스가 가므로 '취소'처럼 안전한 동작을 첫 번째로 둘 것.
 * ESC나 배경 클릭으로 닫으면 'cancel'로 resolve.
 * @param {{ title: string, message: string, extra?: Node|null,
 *           actions: { value: string, label: string, variant?: 'ghost'|'primary'|'danger' }[] }} options
 * @returns {Promise<string>} 누른 버튼의 value
 */
function openDialog({ title, message, extra = null, actions }) {
  // <dialog> 미지원 브라우저: 기본 confirm으로 대체 (마지막 버튼 = 확인 동작)
  if (typeof dialogEl.showModal !== 'function') {
    const ok = window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(ok ? actions[actions.length - 1].value : 'cancel');
  }
  // 이미 열려 있으면 (예: 다이얼로그 위에서 단축키) 중첩하지 않음
  if (dialogEl.open) return Promise.resolve('cancel');

  dialogTitle.textContent = title;
  dialogMessage.textContent = message;
  dialogExtra.replaceChildren(...(extra ? [extra] : []));
  dialogExtra.hidden = !extra;
  dialogActions.replaceChildren(
    ...actions.map(({ value, label, variant = 'ghost' }) => {
      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.value = value;
      btn.className = `btn btn--${variant}`;
      btn.textContent = label;
      return btn;
    })
  );

  dialogEl.returnValue = '';
  try {
    dialogEl.showModal();
  } catch (err) {
    console.error('다이얼로그를 열지 못했습니다:', err);
    return Promise.resolve('cancel');
  }
  dialogActions.firstElementChild?.focus();

  return new Promise((resolve) => {
    dialogEl.addEventListener('close', () => resolve(dialogEl.returnValue || 'cancel'), { once: true });
  });
}

// =========================================================
// 5. 상태 변경
// =========================================================

/** 같은 내용의 할 일 찾기 (excludeId: 편집 중인 자기 자신 제외) */
function findDuplicate(text, excludeId = null) {
  const target = normalizeText(text);
  if (!target) return null;
  return todos.find((t) => t.id !== excludeId && normalizeText(t.text) === target) ?? null;
}

function describeTodo(todo) {
  return `${CATEGORIES[todo.category]} · ${todo.completed ? '완료' : '미완료'}`;
}

/** 특정 항목으로 스크롤하고 잠깐 강조 (중복 항목 위치 안내 등) */
function flashItem(id) {
  const el = itemCache.get(id)?.el;
  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  restartAnimation(el, 'todo-item--flash');
}

/**
 * 할 일 추가. 같은 내용이 이미 있으면 확인 다이얼로그를 띄움.
 * @returns {Promise<boolean>} 실제로 추가되었는지
 */
async function addTodo(text, category, { autoClassified = false } = {}) {
  const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
  if (!trimmed) return false;

  const duplicate = findDuplicate(trimmed);
  if (duplicate) {
    flashItem(duplicate.id);
    const choice = await openDialog({
      title: '중복된 할 일',
      message: `"${truncate(duplicate.text, 40)}" 할 일이 이미 있습니다. (${describeTodo(duplicate)})\n그래도 추가할까요?`,
      actions: [
        { value: 'cancel', label: '취소' },
        { value: 'add', label: '그래도 추가', variant: 'primary' },
      ],
    });
    if (choice !== 'add') return false;
  }

  const todo = {
    id: generateId(),
    text: trimmed,
    completed: false,
    createdAt: new Date().toISOString(),
    category: isCategory(category) ? category : DEFAULT_CATEGORY,
  };
  todos.push(todo);
  saveTodos();
  pendingAnimation = { id: todo.id, className: 'todo-item--enter' };
  render();

  const hidden = !isVisible(todo);
  const autoNote = autoClassified ? ` · 자동 분류: ${CATEGORIES[todo.category]}` : '';
  showToast(
    hidden
      ? `추가되었습니다${autoNote} (현재 필터/검색 조건에 맞지 않아 목록에 보이지 않습니다)`
      : `할 일이 추가되었습니다${autoNote}`,
    'success'
  );
  // 정렬에 따라 화면 밖에 추가될 수 있으므로 보이는 위치로 스크롤
  if (!hidden) itemCache.get(todo.id)?.el.scrollIntoView({ block: 'nearest' });
  return true;
}

function pushUndo(entry) {
  undoStack.push(entry);
  // 오래된 항목은 버림 (메모리 무한 증가 방지)
  while (undoStack.length > UNDO_STACK_LIMIT) undoStack.shift();
}

/**
 * 여러 항목을 한 번에 삭제 (단일 삭제와 일괄 삭제 공통).
 * 삭제 전 위치를 기억해 두었다가 실행 취소 시 같은 자리로 복구한다.
 */
async function removeTodos(ids, { toastMessage }) {
  const idSet = new Set(ids);
  const items = [];
  todos.forEach((todo, index) => {
    if (idSet.has(todo.id)) items.push({ todo, index });
  });
  if (items.length === 0) return;

  // 삭제할 항목 안에 포커스가 있었다면, 삭제 후 이웃 항목으로 포커스를 옮김
  const focusTarget = findFocusTargetAfterRemoval(idSet);

  items.forEach(({ todo }) => busyIds.add(todo.id));
  todos = todos.filter((t) => !idSet.has(t.id));
  if (idSet.has(editingId)) editingId = null;
  saveTodos();
  renderStats();

  const entry = { type: 'delete', items, dismissToast: null };
  pushUndo(entry);

  await Promise.all(items.map(({ todo }) => animateOut(todo.id, 'todo-item--leave')));
  items.forEach(({ todo }) => busyIds.delete(todo.id));

  if (focusTarget) pendingFocus = focusTarget;
  renderList();

  entry.dismissToast = showToast(toastMessage, 'info', {
    duration: UNDO_TOAST_MS,
    action: { label: '실행 취소', shortcut: 'Control+Z', onClick: () => undo(entry) },
  });
}

/** 삭제될 항목에 포커스가 있었다면, 다음(없으면 이전) 남은 항목의 같은 버튼을 반환 */
function findFocusTargetAfterRemoval(idSet) {
  const active = document.activeElement;
  const activeItem = active?.closest?.('.todo-item');
  if (!activeItem || !idSet.has(activeItem.dataset.id)) return null;

  const role = active.dataset.role || 'check';
  const siblings = [...list.children];
  const index = siblings.indexOf(activeItem);
  const after = siblings.slice(index + 1).find((el) => !idSet.has(el.dataset.id));
  const before = siblings.slice(0, index).reverse().find((el) => !idSet.has(el.dataset.id));
  const target = after ?? before;
  return target ? { id: target.dataset.id, role } : { id: null, role: null };
}

function deleteTodo(id) {
  if (busyIds.has(id)) return;
  const todo = todos.find((t) => t.id === id);
  if (!todo) return;
  removeTodos([id], { toastMessage: `"${truncate(todo.text)}" 삭제됨` });
}

async function clearCompleted() {
  const completedIds = todos.filter((t) => t.completed).map((t) => t.id);
  if (completedIds.length === 0) {
    showToast('완료된 할 일이 없습니다');
    return;
  }

  const choice = await openDialog({
    title: '완료된 항목 삭제',
    message: `완료된 할 일 ${completedIds.length}개를 모두 삭제할까요?\n삭제 직후에는 '실행 취소'로 되돌릴 수 있습니다.`,
    actions: [
      { value: 'cancel', label: '취소' },
      { value: 'confirm', label: '삭제', variant: 'danger' },
    ],
  });
  if (choice !== 'confirm') return;

  await removeTodos(completedIds, { toastMessage: `완료된 할 일 ${completedIds.length}개를 삭제했습니다` });
}

/**
 * 실행 취소. entry를 지정하지 않으면 가장 최근 작업을 되돌림.
 * 토스트 버튼과 Ctrl+Z가 같은 entry를 가리킬 수 있으므로 스택에서 찾은 경우에만 실행.
 */
function undo(entry = undoStack[undoStack.length - 1]) {
  if (!entry) {
    showToast('되돌릴 작업이 없습니다');
    return;
  }
  const stackIndex = undoStack.indexOf(entry);
  if (stackIndex === -1) {
    showToast('이미 되돌렸거나 만료된 작업입니다');
    return;
  }
  undoStack.splice(stackIndex, 1);
  entry.dismissToast?.();

  if (entry.type === 'delete') {
    // 그 사이 다른 경로(다른 탭, 가져오기)로 같은 id가 생겼다면 건너뜀
    const existing = new Set(todos.map((t) => t.id));
    const restore = entry.items
      .filter(({ todo }) => !existing.has(todo.id))
      .sort((a, b) => a.index - b.index);

    if (restore.length === 0) {
      showToast('복구할 항목이 이미 존재합니다');
      return;
    }
    // 원래 인덱스 오름차순으로 끼워 넣으면 원래 배열 순서가 재현됨
    for (const { todo, index } of restore) {
      todos.splice(Math.min(index, todos.length), 0, todo);
      dropCache(todo.id); // 퇴장 애니메이션이 남은 요소를 재사용하지 않도록
    }
    const first = restore[0].todo;
    pendingAnimation = { id: first.id, className: 'todo-item--enter' };
    pendingFocus = { id: first.id, role: 'check' };
    saveTodos();
    render();

    const hiddenCount = restore.filter(({ todo }) => !isVisible(todo)).length;
    showToast(
      `${restore.length}개 항목을 복구했습니다${hiddenCount ? ` (${hiddenCount}개는 현재 필터/검색으로 숨겨짐)` : ''}`,
      'success'
    );
  } else if (entry.type === 'snapshot') {
    todos = entry.todos;
    editingId = null;
    dropAllCache();
    saveNow();
    render();
    showToast(`${entry.label}을(를) 되돌렸습니다`, 'success');
  }
}

async function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id);
  if (!todo || busyIds.has(id)) return;
  busyIds.add(id);

  todo.completed = !todo.completed;
  saveTodos();
  renderStats(); // 대시보드는 애니메이션을 기다리지 않고 즉시 반영

  if (todo.completed && todos.every((t) => t.completed)) {
    showToast('🎉 모든 할 일을 완료했습니다!', 'success');
  } else {
    showToast(todo.completed ? '✓ 완료했습니다' : '미완료로 되돌렸습니다');
  }

  // '완료 상태순'에서만 위치가 바뀌므로 그때만 슬라이드 (나머지는 제자리에서 스타일만 변경)
  if (currentSort === 'status') {
    await animateOut(id, 'todo-item--slide-out');
    pendingAnimation = { id, className: 'todo-item--slide-in' };
  }
  busyIds.delete(id);
  renderList();
}

function setFilter(filter) {
  if (!hasOwn(FILTER_LABELS, filter)) return;
  if (editingId !== null) commitEdit(); // 단축키로 바꿀 때 편집 중인 내용 보존
  currentFilter = filter;
  storage.set(FILTER_KEY, currentFilter);
  // 특정 카테고리를 보고 있으면 새 할 일의 기본 카테고리도 그것으로.
  // 입력 중인 내용에 키워드가 있으면 자동 분류 결과가 우선한다.
  if (isCategory(filter)) {
    baseCategory = filter;
    applyAutoCategory();
  }
  render();
}

function setSort(sort) {
  if (!hasOwn(SORT_LABELS, sort)) return;
  if (editingId !== null) commitEdit();
  currentSort = sort;
  storage.set(SORT_KEY, currentSort);
  sortSelect.value = sort;
  renderList();
  const hint = SORTABLE_MODES.has(sort) ? ' · ⋮⋮ 핸들로 순서 변경 가능' : '';
  showToast(`정렬: ${SORT_LABELS[sort]}${hint}`);
}

function setSearch(query) {
  const next = query.trim();
  if (next === searchQuery) return;
  searchQuery = next;
  renderList();
  if (searchQuery) announce(`검색 결과 ${list.children.length}개`);
}

// ---------- 키워드 자동 분류 ----------

/** 비교용 정규화: 소문자 + 모든 공백 제거 ('책 읽기' = '책읽기') */
function compactText(text) {
  return text.toLowerCase().replace(/\s+/g, '');
}

/**
 * 모든 키워드를 하나의 목록으로 펼치고 '긴 키워드부터' 정렬해 둔 색인.
 * 긴 키워드를 먼저 매칭해야 '산책'(개인)이 그 안의 짧은 키워드보다 우선한다.
 */
const KEYWORD_INDEX = Object.entries(CATEGORY_KEYWORDS)
  .flatMap(([category, { strong = [], weak = [] }]) => [
    ...strong.map((word) => ({ category, word, weight: 1 })),
    ...weak.map((word) => ({ category, word, weight: 0.5 })),
  ])
  .map((entry) => ({ ...entry, key: compactText(entry.word) }))
  .filter(({ key }) => key.length > 0)
  .sort((a, b) => b.key.length - a.key.length);

/**
 * 텍스트를 키워드로 분류.
 *  1) 긴 키워드부터 찾고, 이미 다른 키워드가 차지한 글자와 겹치면 건너뜀
 *  2) 카테고리별 점수 = Σ(키워드 글자 수 × 가중치)
 *  3) 최고 점수 카테고리 선택. 동점이면 문장 뒤쪽에 나온 키워드의 카테고리
 *     (한국어는 핵심 명사가 뒤에 오는 경우가 많음: '점심 미팅' → 업무)
 * @param {string} text
 * @returns {{ category: string, keywords: string[] } | null} 키워드가 없으면 null
 */
function classifyText(text) {
  const target = compactText(text);
  if (!target) return null;

  const taken = new Array(target.length).fill(false);
  const stats = {}; // category → { score, lastPos, keywords }

  for (const { category, word, weight, key } of KEYWORD_INDEX) {
    let from = 0;
    let index;
    while ((index = target.indexOf(key, from)) !== -1) {
      const end = index + key.length;
      let free = true;
      for (let i = index; i < end; i++) {
        if (taken[i]) {
          free = false;
          break;
        }
      }
      if (free) {
        taken.fill(true, index, end);
        const s = (stats[category] ??= { score: 0, lastPos: -1, keywords: [] });
        s.score += key.length * weight;
        s.lastPos = Math.max(s.lastPos, index);
        if (!s.keywords.includes(word)) s.keywords.push(word);
      }
      from = index + 1;
    }
  }

  let best = null;
  for (const category of CATEGORY_KEYS) {
    const s = stats[category];
    if (!s) continue;
    if (!best || s.score > best.score || (s.score === best.score && s.lastPos > best.lastPos)) {
      best = { category, ...s };
    }
  }
  return best ? { category: best.category, keywords: best.keywords } : null;
}

/** 드롭다운 값 변경 + 카테고리 색 표시용 data 속성 동기화 */
function setCategorySelect(value) {
  categorySelect.value = value;
  categorySelect.dataset.category = value;
}

/**
 * 입력창 내용을 분류해서 드롭다운에 반영.
 *  - 자동 분류가 꺼져 있거나 사용자가 직접 고른 경우(categoryLocked)에는 드롭다운을 바꾸지 않음
 *  - 키워드가 없으면 기본 카테고리(baseCategory)로 되돌림
 */
function applyAutoCategory() {
  const result = input.value.trim() ? classifyText(input.value) : null;

  if (!autoCategoryEnabled || categoryLocked) {
    autoApplied = null;
    if (!categoryLocked) setCategorySelect(baseCategory);
    renderCategoryHint(categoryLocked ? result : null);
    return;
  }

  const next = result?.category ?? baseCategory;
  if (categorySelect.value !== next) {
    setCategorySelect(next);
    if (result) restartAnimation(categorySelect, 'auto-picked');
  }
  autoApplied = result;
  renderCategoryHint(result);
}

const scheduleAutoCategory = debounce(applyAutoCategory, AUTO_CATEGORY_DEBOUNCE_MS);

/**
 * 분류 안내 표시.
 *  - 자동 적용됨: "자동 분류: 업무 · '회의'"
 *  - 직접 고른 값과 추천이 다름: "추천: 업무 · '회의'  [적용]"
 */
function renderCategoryHint(result) {
  categoryHint.replaceChildren();
  const showSuggestion = categoryLocked && result && result.category !== categorySelect.value;

  if (!autoCategoryEnabled || !result || (categoryLocked && !showSuggestion)) {
    categoryHint.hidden = true;
    delete categoryHint.dataset.category;
    return;
  }

  const label = CATEGORIES[result.category];
  const keywords = result.keywords.slice(0, 2).map((k) => `'${k}'`).join(', ');
  categoryHint.dataset.category = result.category;

  if (showSuggestion) {
    categoryHint.append(`🏷️ 추천: ${label} · ${keywords}`);
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'category-hint__apply';
    apply.textContent = '적용';
    apply.setAttribute('aria-label', `추천 카테고리 ${label} 적용`);
    apply.addEventListener('click', () => {
      categoryLocked = false;
      applyAutoCategory();
      input.focus();
    });
    categoryHint.append(apply);
  } else {
    categoryHint.append(`🏷️ 자동 분류: ${label} · ${keywords}`);
  }
  categoryHint.hidden = false;
}

/** 할 일을 추가했거나 입력창을 비웠을 때 자동 분류 상태 초기화 */
function resetAutoCategory() {
  scheduleAutoCategory.cancel();
  categoryLocked = false;
  autoApplied = null;
  setCategorySelect(baseCategory);
  renderCategoryHint(null);
}

// ---------- 인라인 편집 ----------

function startEdit(id) {
  if (busyIds.has(id) || drag) return;
  if (editingId !== null && editingId !== id) commitEdit();
  editingId = id;
  pendingFocus = { id, role: 'edit-input' };
  renderList();
}

/**
 * 편집 취소.
 * @param {{ restoreFocus?: boolean }} options 키보드(ESC)로 취소했을 때만 포커스를 되돌림
 */
function cancelEdit({ restoreFocus = false } = {}) {
  if (editingId === null) return;
  const id = editingId;
  editingId = null;
  if (restoreFocus) pendingFocus = { id, role: 'edit' };
  renderList();
  showToast('수정을 취소했습니다');
}

/**
 * 편집 내용 저장.
 * @param {{ restoreFocus?: boolean }} options Enter/저장 버튼일 때 true.
 *   다른 곳을 클릭해서 저장된 경우(focusout)에는 사용자가 옮긴 포커스를 빼앗지 않음.
 */
function commitEdit({ restoreFocus = false } = {}) {
  if (editingId === null) return;
  const id = editingId;
  const el = itemCache.get(id)?.el;
  const todo = todos.find((t) => t.id === id);
  editingId = null; // 먼저 비워서 blur 등으로 인한 중복 호출 방지

  if (el && todo) {
    const newText = el.querySelector('[data-role="edit-input"]').value.trim().slice(0, MAX_TEXT_LENGTH);
    const newCategory = el.querySelector('[data-role="edit-select"]').value;

    if (!newText) {
      showToast('내용이 비어 있어 원래 내용을 유지합니다', 'warning');
    } else if (newText !== todo.text || newCategory !== todo.category) {
      todo.text = newText;
      if (isCategory(newCategory)) todo.category = newCategory;
      saveTodos();

      const duplicate = findDuplicate(newText, id);
      if (duplicate) {
        showToast(`수정됨 · 같은 내용의 할 일이 이미 있습니다 (${describeTodo(duplicate)})`, 'warning');
      } else {
        showToast('수정되었습니다', 'success');
      }
    }
  }
  if (restoreFocus) pendingFocus = { id, role: 'edit' };
  render();
}

// ---------- 테마 ----------

function applyTheme(theme, { animate = false } = {}) {
  if (animate && !reduceMotion.matches) {
    root.classList.add('theme-transition');
    clearTimeout(themeTimer);
    themeTimer = setTimeout(() => root.classList.remove('theme-transition'), 400);
  }
  root.dataset.theme = theme;
  themeToggle.setAttribute('aria-checked', String(theme === 'dark'));
}

function toggleTheme() {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next, { animate: true });
  storage.set(THEME_KEY, next);
  showToast(next === 'dark' ? '🌙 다크 모드' : '☀️ 라이트 모드');
}

// ---------- 격언 ----------

/** 날짜를 시드로 써서 하루 동안은 같은 격언이 나오도록 */
function getDailyQuoteIndex() {
  const d = new Date();
  const seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  return seed % QUOTES.length;
}

function renderQuote({ animate = false } = {}) {
  const quote = QUOTES[quoteIndex];
  quoteText.textContent = quote.text;
  quoteAuthor.textContent = quote.author;
  if (animate) restartAnimation(quoteSection, 'quote--fade');
}

function nextQuote() {
  if (QUOTES.length < 2) return;
  let next;
  do {
    next = Math.floor(Math.random() * QUOTES.length);
  } while (next === quoteIndex); // 같은 격언이 연속으로 나오지 않게
  quoteIndex = next;
  renderQuote({ animate: true });
}

// ---------- 내보내기 / 가져오기 ----------

/**
 * 현재 데이터를 JSON 파일로 다운로드.
 * @param {{ backup?: boolean }} options 가져오기 전 백업이면 파일명에 backup 표시
 * @returns {boolean} 성공 여부
 */
function exportData({ backup = false } = {}) {
  if (!backup && todos.length === 0) {
    showToast('내보낼 할 일이 없습니다', 'warning');
    return false;
  }
  try {
    saveNow(); // 디바운스 대기 중인 변경까지 확정
    const payload = {
      app: 'my-tasks',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: todos.length,
      todos,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `my-tasks${backup ? '-backup' : ''}_${fileTimestamp()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    // 다운로드가 시작될 시간을 준 뒤 메모리 해제
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    showToast(backup ? `현재 할 일 ${todos.length}개를 백업했습니다` : `할 일 ${todos.length}개를 내보냈습니다`, 'success');
    return true;
  } catch (err) {
    console.error('내보내기 실패:', err);
    showToast('파일을 만드는 중 오류가 발생했습니다', 'error');
    return false;
  }
}

/** 가져오기 방식 선택(합치기/바꾸기) 라디오 그룹 생성 */
function createImportModeField() {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'dialog__fieldset';

  const legend = document.createElement('legend');
  legend.textContent = '가져오기 방식';
  fieldset.append(legend);

  const options = [
    ['merge', '기존 할 일에 합치기 (이미 있는 항목은 건너뜀)'],
    ['replace', '기존 할 일을 모두 바꾸기'],
  ];
  options.forEach(([value, label], i) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'dialog__option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'import-mode';
    radio.value = value;
    radio.checked = i === 0;
    wrapper.append(radio, document.createTextNode(label));
    fieldset.append(wrapper);
  });
  return fieldset;
}

/** 파일을 읽고 검증한 뒤, 사용자 확인(백업 여부 포함)을 거쳐 데이터에 반영 */
async function importFromFile(file) {
  if (!file) return;

  // 1) 파일 기본 검사
  const looksLikeJson = /\.json$/i.test(file.name) || file.type === 'application/json';
  if (!looksLikeJson) {
    showToast('JSON 파일(.json)만 가져올 수 있습니다', 'error');
    return;
  }
  if (file.size === 0) {
    showToast('빈 파일입니다', 'error');
    return;
  }
  if (file.size > MAX_IMPORT_BYTES) {
    showToast(`파일이 너무 큽니다 (최대 ${MAX_IMPORT_BYTES / 1024 / 1024}MB)`, 'error');
    return;
  }

  // 2) 읽기 + JSON 파싱
  let data;
  try {
    const text = await file.text();
    data = JSON.parse(text.replace(/^﻿/, '')); // 일부 편집기가 붙이는 BOM 제거
  } catch (err) {
    console.error('가져오기 파일 읽기 실패:', err);
    showToast('파일을 읽을 수 없습니다. 올바른 JSON 형식인지 확인해주세요.', 'error');
    return;
  }

  // 3) 형식 확인: 이 앱의 내보내기 형식({ todos: [...] }) 또는 할 일 배열 자체를 허용
  const rawList = Array.isArray(data) ? data : Array.isArray(data?.todos) ? data.todos : null;
  if (!rawList) {
    showToast('할 일 데이터를 찾을 수 없는 파일입니다', 'error');
    return;
  }
  if (typeof data?.version === 'number' && data.version > EXPORT_VERSION) {
    showToast('더 새로운 버전에서 만든 파일입니다. 일부 정보가 누락될 수 있습니다.', 'warning');
  }

  const { valid, invalid } = sanitizeTodos(rawList);
  if (valid.length === 0) {
    showToast('가져올 수 있는 할 일이 없습니다 (형식이 잘못된 항목뿐입니다)', 'error');
    return;
  }

  // 4) 사용자 확인 — 현재 데이터가 있으면 백업 여부와 합치기/바꾸기를 선택
  const invalidNote = invalid > 0 ? ` (형식이 잘못된 ${invalid}개 제외)` : '';
  let mode = 'replace';
  let choice;

  if (todos.length > 0) {
    const modeField = createImportModeField();
    choice = await openDialog({
      title: '데이터 가져오기',
      message:
        `파일에서 할 일 ${valid.length}개를 찾았습니다${invalidNote}.\n` +
        `현재 할 일 ${todos.length}개가 있습니다. 가져오기 전에 현재 데이터를 백업할까요?`,
      extra: modeField,
      actions: [
        { value: 'cancel', label: '취소' },
        { value: 'import', label: '백업 없이 가져오기' },
        { value: 'backup-import', label: '백업 후 가져오기', variant: 'primary' },
      ],
    });
    mode = modeField.querySelector('input:checked')?.value ?? 'merge';
  } else {
    choice = await openDialog({
      title: '데이터 가져오기',
      message: `파일에서 할 일 ${valid.length}개를 찾았습니다${invalidNote}. 가져올까요?`,
      actions: [
        { value: 'cancel', label: '취소' },
        { value: 'import', label: '가져오기', variant: 'primary' },
      ],
    });
  }

  if (choice === 'cancel') return;
  if (choice === 'backup-import' && !exportData({ backup: true })) {
    showToast('백업에 실패해 가져오기를 중단했습니다', 'error');
    return;
  }

  // 5) 반영 — 이전 상태를 스냅샷으로 남겨 실행 취소 가능하게
  const snapshot = todos.map((t) => ({ ...t }));
  let added = valid.length;
  let skipped = 0;

  if (mode === 'replace') {
    todos = valid;
  } else {
    const existingIds = new Set(todos.map((t) => t.id));
    const fresh = valid.filter((t) => !existingIds.has(t.id));
    added = fresh.length;
    skipped = valid.length - fresh.length;
    todos = todos.concat(fresh);
  }

  editingId = null;
  dropAllCache();
  saveNow();
  render();

  const entry = { type: 'snapshot', todos: snapshot, label: '가져오기', dismissToast: null };
  pushUndo(entry);
  const summary =
    mode === 'replace'
      ? `할 일 ${added}개로 바꿨습니다`
      : `${added}개를 가져왔습니다${skipped ? ` (이미 있는 ${skipped}개 건너뜀)` : ''}`;
  entry.dismissToast = showToast(summary, 'success', {
    duration: UNDO_TOAST_MS,
    action: { label: '실행 취소', shortcut: 'Control+Z', onClick: () => undo(entry) },
  });
}

// =========================================================
// 6. 렌더링
// =========================================================

/** 응원 메시지 (완료율 기준) */
function getCheerMessage(done, total) {
  if (total === 0) return '✨ 첫 할 일을 추가해보세요!';
  const pct = (done / total) * 100;
  if (pct === 0) return '💪 시작이 반이에요. 하나씩 해볼까요?';
  if (pct < 30) return '🌱 좋은 출발이에요!';
  if (pct < 60) return '🚶 꾸준히 잘하고 있어요!';
  if (pct < 90) return '🔥 거의 다 왔어요! 조금만 더!';
  if (pct < 100) return '🏁 마지막 스퍼트!';
  return '🎉 모두 완료! 오늘 정말 멋져요!';
}

/** 대시보드·배지·일괄 삭제 버튼 갱신. 항목을 한 번만 순회 */
function renderStats() {
  const { start, end } = getTodayRange();
  const byCategory = Object.fromEntries(CATEGORY_KEYS.map((key) => [key, { total: 0, done: 0 }]));
  let done = 0;
  let today = 0;

  for (const todo of todos) {
    const cat = byCategory[todo.category];
    cat.total++;
    if (todo.completed) {
      done++;
      cat.done++;
    }
    const created = Date.parse(todo.createdAt);
    if (created >= start && created < end) today++;
  }

  const total = todos.length;
  const remaining = total - done;
  const pct = percent(done, total);

  statsSummary.textContent = `${done}/${total} 완료 (${pct}%)`;
  statsBar.style.width = `${pct}%`;
  statsProgress.setAttribute('aria-valuenow', String(pct));
  statsProgress.setAttribute('aria-valuetext', `${total}개 중 ${done}개 완료, ${pct}%`);
  statsCheer.textContent = getCheerMessage(done, total);

  for (const { category, count, bar } of statCategoryEls) {
    const cat = byCategory[category];
    count.textContent = `${cat.done}/${cat.total}`;
    bar.style.width = `${percent(cat.done, cat.total)}%`;
  }

  statsToday.textContent = String(today);

  // 남은 할 일 배지: 값이 바뀔 때마다 튀는 애니메이션
  remainingBadge.textContent = String(remaining);
  remainingBadge.classList.toggle('badge--zero', remaining === 0);
  if (lastRemaining !== null && lastRemaining !== remaining) {
    restartAnimation(remainingBadge, 'badge--bump');
  }
  lastRemaining = remaining;

  clearCompletedBtn.disabled = done === 0;
  clearCompletedBtn.textContent = done > 0 ? `완료 항목 삭제 (${done})` : '완료 항목 삭제';
}

function isVisible(todo) {
  if (currentFilter !== 'all' && todo.category !== currentFilter) return false;
  return !searchQuery || todo.text.toLowerCase().includes(searchQuery.toLowerCase());
}

/** 필터·검색·정렬을 적용한 화면 표시 순서 */
function getVisibleTodos() {
  const visible = todos.filter(isVisible); // filter가 새 배열을 반환하므로 sort해도 원본 안전
  switch (currentSort) {
    case 'status':
      // 미완료 먼저. Array.prototype.sort는 안정 정렬이라 그룹 안에서는 배열(직접 정한) 순서 유지
      return visible.sort((a, b) => Number(a.completed) - Number(b.completed));
    case 'created':
      // ISO 8601 문자열은 사전순 비교 = 시간순 비교
      return visible.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    case 'category':
      return visible.sort((a, b) => CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category]);
    case 'manual':
    default:
      return visible;
  }
}

/** 검색어와 일치하는 부분을 <mark>로 감싸서 parent에 추가 (innerHTML 미사용 → XSS 안전) */
function appendHighlighted(parent, text, query) {
  if (!query) {
    parent.textContent = text;
    return;
  }
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let index = 0;
  let match;
  while ((match = lowerText.indexOf(lowerQuery, index)) !== -1) {
    if (match > index) parent.append(text.slice(index, match));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(match, match + query.length);
    parent.append(mark);
    index = match + query.length;
  }
  if (index < text.length) parent.append(text.slice(index));
}

function createButton({ className, role, label, text, title }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.dataset.role = role;
  btn.textContent = text;
  btn.setAttribute('aria-label', label);
  if (title) btn.title = title;
  return btn;
}

function createCategorySelect(selected) {
  const select = document.createElement('select');
  select.className = 'todo-item__edit-select';
  select.dataset.role = 'edit-select';
  select.setAttribute('aria-label', '카테고리');
  for (const [value, label] of Object.entries(CATEGORIES)) {
    select.add(new Option(label, value, false, value === selected));
  }
  return select;
}

function createViewBody(todo) {
  const body = document.createElement('div');
  body.className = 'todo-item__body';

  const text = document.createElement('span');
  text.className = 'todo-item__text';
  text.dataset.role = 'text';
  appendHighlighted(text, todo.text, searchQuery);
  text.title = '더블클릭하여 수정';

  const meta = document.createElement('div');
  meta.className = 'todo-item__meta';

  const tag = document.createElement('span');
  tag.className = 'todo-item__tag';
  tag.textContent = CATEGORIES[todo.category];

  const time = document.createElement('time');
  time.className = 'todo-item__time';
  time.dateTime = todo.createdAt;
  time.title = new Date(todo.createdAt).toLocaleString('ko-KR');
  time.textContent = formatRelativeTime(todo.createdAt);

  meta.append(tag, time);
  body.append(text, meta);
  return body;
}

function createEditBody(todo) {
  const wrapper = document.createElement('div');
  wrapper.className = 'todo-item__edit';

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'todo-item__edit-input';
  editInput.dataset.role = 'edit-input';
  editInput.value = todo.text;
  editInput.maxLength = MAX_TEXT_LENGTH;
  editInput.setAttribute('aria-label', '할 일 수정 (Enter 저장, Esc 취소)');

  // 터치 기기에는 Enter/Esc가 없으므로 저장·취소 버튼 제공
  const actions = document.createElement('div');
  actions.className = 'todo-item__edit-actions';
  actions.append(
    createButton({ className: 'icon-btn todo-item__save', role: 'save', label: '수정 저장', text: '✓', title: '저장 (Enter)' }),
    createButton({ className: 'icon-btn todo-item__cancel', role: 'cancel', label: '수정 취소', text: '✕', title: '취소 (Esc)' })
  );

  wrapper.append(editInput, createCategorySelect(todo.category), actions);
  return wrapper;
}

function createTodoElement(todo) {
  const isEditing = todo.id === editingId;

  const li = document.createElement('li');
  li.className = 'todo-item';
  li.classList.toggle('completed', todo.completed);
  li.classList.toggle('editing', isEditing);
  li.dataset.id = todo.id;
  li.dataset.category = todo.category;

  const handle = createButton({
    className: 'icon-btn todo-item__handle',
    role: 'handle',
    label: `"${todo.text}" 순서 변경. 위아래 화살표 키로 이동`,
    text: '⋮⋮',
    title: '드래그하거나 화살표 키로 순서 변경',
  });

  const check = document.createElement('label');
  check.className = 'todo-item__check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-item__checkbox';
  checkbox.dataset.role = 'check';
  checkbox.checked = todo.completed;
  checkbox.setAttribute('aria-label', `"${todo.text}" 완료 표시 (${CATEGORIES[todo.category]})`);
  check.append(checkbox);

  const editBtn = createButton({
    className: 'icon-btn todo-item__edit-btn',
    role: 'edit',
    label: `"${todo.text}" 수정`,
    text: '✎',
    title: '수정',
  });
  const deleteBtn = createButton({
    className: 'icon-btn todo-item__delete',
    role: 'delete',
    label: `"${todo.text}" 삭제`,
    text: '×',
    title: '삭제',
  });

  li.append(handle, check, isEditing ? createEditBody(todo) : createViewBody(todo), editBtn, deleteBtn);
  return li;
}

/** 항목 요소를 다시 만들어야 하는지 판단하는 서명. 화면에 영향을 주는 값만 포함 */
function signatureOf(todo) {
  return [todo.text, todo.completed, todo.category, todo.id === editingId, searchQuery].join('\u0000');
}

/** 캐시된 요소를 재사용하거나, 내용이 바뀌었으면 새로 만들어 같은 자리에 교체 */
function getOrCreateElement(todo) {
  const sig = signatureOf(todo);
  const cached = itemCache.get(todo.id);
  if (cached && cached.sig === sig) return cached.el;

  const el = createTodoElement(todo);
  if (cached?.el.isConnected) cached.el.replaceWith(el);
  itemCache.set(todo.id, { el, sig });
  return el;
}

function dropCache(id) {
  const cached = itemCache.get(id);
  if (cached) {
    cached.el.remove();
    itemCache.delete(id);
  }
}

function dropAllCache() {
  itemCache.clear();
  list.replaceChildren();
}

function renderEmptyState(isEmpty) {
  emptyState.hidden = !isEmpty;
  if (!isEmpty) return;

  if (searchQuery) {
    emptyIcon.textContent = '🔍';
    emptyText.textContent = `'${searchQuery}'에 대한 검색 결과가 없습니다.`;
  } else if (currentFilter !== 'all' && todos.length > 0) {
    emptyIcon.textContent = '📂';
    emptyText.textContent = `'${CATEGORIES[currentFilter]}' 카테고리에 할 일이 없습니다.`;
  } else {
    emptyIcon.textContent = '📝';
    emptyText.textContent = '할 일이 없습니다. 추가해보세요!';
  }
}

/**
 * 목록 렌더링 (키 기반 재조정).
 *  - 바뀌지 않은 항목은 기존 요소를 그대로 두고, 순서가 다를 때만 insertBefore로 이동
 *  - 사라진 항목만 제거
 * → 수백 개 항목에서도 변경된 부분만 DOM을 건드림
 */
function renderList() {
  // 요소 교체/이동으로 포커스를 잃을 수 있으므로 현재 포커스 위치를 기억
  const active = document.activeElement;
  const activeItem = active?.closest?.('.todo-item');
  const activeInfo = activeItem && list.contains(activeItem)
    ? { id: activeItem.dataset.id, role: active.dataset.role }
    : null;

  const visible = getVisibleTodos();
  const visibleIds = new Set();
  let prev = null;

  for (const todo of visible) {
    visibleIds.add(todo.id);
    const el = getOrCreateElement(todo);
    const expected = prev ? prev.nextSibling : list.firstChild;
    if (el !== expected) list.insertBefore(el, expected);
    prev = el;
  }

  // 더 이상 보이지 않는 항목 제거
  for (const [id, { el }] of itemCache) {
    if (!visibleIds.has(id)) {
      el.remove();
      itemCache.delete(id);
    }
  }

  list.classList.toggle('todo-list--sortable', SORTABLE_MODES.has(currentSort));
  renderEmptyState(visible.length === 0);

  if (pendingAnimation) {
    restartAnimation(itemCache.get(pendingAnimation.id)?.el, pendingAnimation.className);
    pendingAnimation = null;
  }

  // 편집 중인 항목이 필터/검색으로 가려졌다면 편집 상태 해제
  if (editingId !== null && !visibleIds.has(editingId)) editingId = null;

  if (pendingFocus) {
    applyFocus(pendingFocus);
    pendingFocus = null;
  } else if (activeInfo && (!document.activeElement || document.activeElement === document.body)) {
    // 렌더링 때문에 포커스를 잃었다면 같은 항목의 같은 컨트롤로 복원
    applyFocus(activeInfo);
  }
}

/** { id, role } 위치로 포커스. 대상이 없으면 새 할 일 입력창으로 */
function applyFocus({ id, role }) {
  const el = id ? itemCache.get(id)?.el : null;
  let target = el?.querySelector(`[data-role="${role}"]`);
  // 편집 중에 다른 이유(필터 단축키 등)로 편집이 끝나 입력창이 사라졌다면 그 항목의 수정 버튼으로
  if (!target && el && (role === 'edit-input' || role === 'edit-select')) {
    target = el.querySelector('[data-role="edit"]');
  }
  // 숨겨진 컨트롤(예: 정렬 불가 모드의 핸들)은 포커스할 수 없으므로 체크박스로 대체
  if (target && target.offsetParent === null) target = el.querySelector('[data-role="check"]');
  if (!target) target = el ? el.querySelector('[data-role="check"]') : input;
  target?.focus({ preventScroll: false });

  // 커서를 끝으로: 실제로 포커스한 요소가 편집 입력창일 때만 (체크박스 등에는 setSelectionRange가 없음)
  if (target?.dataset.role === 'edit-input') {
    target.setSelectionRange(target.value.length, target.value.length);
  }
}

function renderFilters() {
  for (const btn of filterButtons) {
    const isActive = btn.dataset.filter === currentFilter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

function render() {
  renderStats();
  renderFilters();
  renderList();
}

/** 상대 시간과 '오늘 추가' 개수만 주기적으로 갱신 (목록 재렌더링 없이) */
function refreshTimes() {
  if (document.hidden) return; // 보이지 않는 탭에서는 건너뜀
  for (const el of list.querySelectorAll('.todo-item__time')) {
    el.textContent = formatRelativeTime(el.dateTime);
  }
  renderStats();
}

/** 새 할 일 입력 중 중복 여부를 실시간으로 안내 */
const updateDupHint = debounce(() => {
  const duplicate = findDuplicate(input.value);
  if (duplicate) {
    dupHint.textContent = `⚠️ 이미 같은 할 일이 있습니다 (${describeTodo(duplicate)})`;
    dupHint.hidden = false;
  } else {
    dupHint.hidden = true;
    dupHint.textContent = '';
  }
}, DUP_HINT_DEBOUNCE_MS);

// =========================================================
// 7. 드래그 앤 드롭 (포인터: 마우스·터치·펜 공통 / 키보드: 화살표)
// =========================================================

/** '완료 상태순'에서는 같은 그룹(미완료끼리, 완료끼리) 안에서만 순서를 바꿀 수 있음 */
function canSwap(a, b) {
  if (currentSort !== 'status') return true;
  return a.classList.contains('completed') === b.classList.contains('completed');
}

/**
 * 현재 DOM 순서를 데이터 순서에 반영.
 * 화면에 보이는 항목들이 차지하던 배열 '자리'에 새 순서대로 다시 채워 넣으므로,
 * 필터/검색으로 숨겨진 항목의 위치는 그대로 유지된다.
 * @returns {boolean} 순서가 실제로 바뀌었는지
 */
function commitDomOrder() {
  const indexById = new Map(todos.map((t, i) => [t.id, i]));
  const domIds = [...list.children].map((el) => el.dataset.id).filter((id) => indexById.has(id));
  const slots = domIds.map((id) => indexById.get(id)).sort((a, b) => a - b);

  const next = todos.slice();
  domIds.forEach((id, k) => {
    next[slots[k]] = todos[indexById.get(id)];
  });

  const changed = next.some((todo, i) => todo !== todos[i]);
  if (changed) {
    todos = next;
    saveTodos();
  }
  return changed;
}

function announcePosition(id) {
  const el = itemCache.get(id)?.el;
  const todo = todos.find((t) => t.id === id);
  if (!el || !todo) return;
  const position = [...list.children].indexOf(el) + 1;
  announce(`"${truncate(todo.text)}" ${list.children.length}개 중 ${position}번째로 이동했습니다`);
}

/** 키보드로 한 칸 이동. 포커스를 유지하려고 '이웃 요소'를 옮김 (포커스된 요소는 그대로) */
function moveByKeyboard(id, direction) {
  const el = itemCache.get(id)?.el;
  if (!el) return;
  const sibling = direction < 0 ? el.previousElementSibling : el.nextElementSibling;
  if (!sibling || !canSwap(el, sibling)) {
    announce(direction < 0 ? '더 위로 이동할 수 없습니다' : '더 아래로 이동할 수 없습니다');
    return;
  }
  const prevTop = sibling.offsetTop;
  if (direction < 0) el.after(sibling);
  else el.before(sibling);
  animateShift(sibling, prevTop);

  commitDomOrder();
  renderList();
  announcePosition(id);
}

function startDrag(e, handle) {
  const li = handle.closest('.todo-item');
  if (!li || editingId !== null || busyIds.has(li.dataset.id)) return;

  e.preventDefault(); // 텍스트 선택·스크롤 방지
  try {
    handle.setPointerCapture(e.pointerId); // 포인터가 핸들 밖으로 나가도 이벤트 수신
  } catch { /* 일부 환경에서 실패해도 드래그는 동작 */ }

  drag = {
    li,
    id: li.dataset.id,
    pointerId: e.pointerId,
    startY: e.clientY + window.scrollY, // 페이지 좌표 (자동 스크롤 보정용)
    lastClientY: e.clientY, // 마지막 포인터 위치 (포인터가 멈춰 있어도 자동 스크롤에 사용)
    scrollRaf: null, // 자동 스크롤 requestAnimationFrame id
    moved: false,
  };
}

function onDragMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.lastClientY = e.clientY;
  updateDragPosition(e.clientY);

  // 가장자리에 들어오면 자동 스크롤 루프 시작 (루프는 가장자리를 벗어나면 스스로 멈춤)
  if (drag?.moved && drag.scrollRaf === null && getAutoScrollSpeed(e.clientY) !== 0) {
    drag.scrollRaf = requestAnimationFrame(autoScrollLoop);
  }
}

/** 데스크톱의 상단 고정 바(검색·정렬)는 화면 위쪽을 가림. 그 아래 경계(px)를 반환, 고정이 아니면 0 */
const stickyToolbar = document.querySelector('.toolbar');
function getTopInset() {
  if (!stickyToolbar || getComputedStyle(stickyToolbar).position !== 'sticky') return 0;
  return Math.max(0, stickyToolbar.getBoundingClientRect().bottom);
}

/**
 * 포인터 위치에 따른 자동 스크롤 속도 (음수 = 위로).
 * 위쪽 경계는 화면 맨 위가 아니라 상단 고정 바 아래 기준 → 항목이 바 밑으로 숨기 전에 스크롤 시작.
 * 가장자리에 깊이 들어갈수록 빨라짐.
 */
function getAutoScrollSpeed(clientY) {
  const topEdge = getTopInset() + AUTO_SCROLL_EDGE_PX;
  const bottomEdge = window.innerHeight - AUTO_SCROLL_EDGE_PX;
  if (clientY < topEdge) return -Math.min(AUTO_SCROLL_MAX_SPEED, Math.ceil((topEdge - clientY) / 3));
  if (clientY > bottomEdge) return Math.min(AUTO_SCROLL_MAX_SPEED, Math.ceil((clientY - bottomEdge) / 3));
  return 0;
}

/** 포인터가 멈춰 있어도 가장자리에 있는 동안 매 프레임 스크롤하고, 항목 위치·자리 교체를 갱신 */
function autoScrollLoop() {
  if (!drag) return;
  drag.scrollRaf = null;
  const speed = getAutoScrollSpeed(drag.lastClientY);
  if (speed === 0) return;

  const before = window.scrollY;
  window.scrollBy(0, speed);
  if (window.scrollY === before) return; // 문서 끝에 도달 → 더 스크롤할 곳 없음

  updateDragPosition(drag.lastClientY); // 스크롤된 만큼 항목이 포인터를 따라가도록
  drag.scrollRaf = requestAnimationFrame(autoScrollLoop);
}

/** 드래그 중인 항목을 포인터 위치(clientY)에 맞춰 이동하고, 필요하면 이웃과 자리 교체 */
function updateDragPosition(clientY) {
  const pageY = clientY + window.scrollY;
  let dy = pageY - drag.startY;

  if (!drag.moved) {
    if (Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    drag.li.classList.add('dragging');
    list.classList.add('is-dragging');
  }

  drag.li.style.transform = `translateY(${dy}px)`;

  // 드래그 중인 항목의 중심이 이웃 항목의 중심을 넘으면 자리 교체 (빠르게 움직이면 여러 칸)
  const swap = (sibling, placeAfter) => {
    const liTop = drag.li.offsetTop;
    const siblingTop = sibling.offsetTop;
    if (placeAfter) drag.li.after(sibling);
    else drag.li.before(sibling);
    animateShift(sibling, siblingTop);
    // 항목의 레이아웃 위치가 바뀐 만큼 시작점을 보정해야 포인터 아래에 계속 머묾
    drag.startY += drag.li.offsetTop - liTop;
    dy = pageY - drag.startY;
    drag.li.style.transform = `translateY(${dy}px)`;
  };

  // 위치 비교는 레이아웃 좌표(offsetTop)로 함. getBoundingClientRect는 이웃 항목의
  // FLIP 이동 애니메이션(transform)까지 반영돼서 자리 교체가 왔다 갔다 반복될 수 있음
  const middle = (el) => el.offsetTop + el.offsetHeight / 2;
  for (;;) {
    const center = drag.li.offsetTop + dy + drag.li.offsetHeight / 2;
    const next = drag.li.nextElementSibling;
    const prev = drag.li.previousElementSibling;

    if (next && canSwap(drag.li, next) && center > middle(next)) {
      swap(next, false); // 다음 항목을 내 앞으로
    } else if (prev && canSwap(drag.li, prev) && center < middle(prev)) {
      swap(prev, true); // 이전 항목을 내 뒤로
    } else {
      break;
    }
  }
}

function resetDragStyles() {
  if (!drag) return;
  if (drag.scrollRaf !== null) cancelAnimationFrame(drag.scrollRaf);
  drag.scrollRaf = null;
  drag.li.classList.remove('dragging');
  drag.li.style.transform = '';
  list.classList.remove('is-dragging');
}

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { id, moved } = drag;
  resetDragStyles();
  drag = null;
  if (!moved) return;

  if (e.type === 'pointercancel') {
    renderList(); // 데이터는 그대로이므로 원래 순서로 되돌아감
    return;
  }
  if (commitDomOrder()) {
    renderList();
    announcePosition(id);
    showToast('순서를 변경했습니다');
  }
}

/** ESC 또는 외부 변경(다른 탭)으로 드래그 취소 */
function cancelDrag() {
  if (!drag) return;
  resetDragStyles();
  drag = null;
  renderList();
  announce('순서 변경을 취소했습니다');
}

// =========================================================
// 8. 이벤트 바인딩
// =========================================================

// ---------- 입력 폼 ----------

let submitting = false; // 중복 확인 다이얼로그가 떠 있는 동안 재제출 방지

// 버튼 클릭과 Enter 키 모두 form submit으로 처리됨
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (submitting) return;

  if (!input.value.trim()) {
    restartAnimation(input, 'invalid');
    showToast('할 일을 입력해주세요', 'error');
    input.focus();
    return;
  }

  submitting = true;
  try {
    scheduleAutoCategory.flush(); // 타이핑 직후 바로 Enter를 눌러도 분류 결과가 반영되도록
    const autoClassified = autoApplied !== null && autoApplied.category === categorySelect.value;
    if (await addTodo(input.value, categorySelect.value, { autoClassified })) {
      input.value = '';
      updateDupHint.cancel();
      dupHint.hidden = true;
      resetAutoCategory();
    }
  } catch (err) {
    console.error('할 일 추가 실패:', err);
    showToast('할 일을 추가하지 못했습니다', 'error');
  } finally {
    submitting = false;
    input.focus();
  }
});

input.addEventListener('input', () => {
  input.classList.remove('invalid'); // 다시 입력하면 오류 표시 제거
  updateDupHint();
  // 입력창을 비우면 직접 선택 잠금도 풀고 기본 카테고리로 복귀
  if (input.value.trim()) scheduleAutoCategory();
  else resetAutoCategory();
});

// 사용자가 드롭다운을 직접 바꾸면 그 값이 새 기본값이 되고,
// 입력 중인 내용이 있으면 이번 항목에 대해서는 자동 분류가 덮어쓰지 않음
categorySelect.addEventListener('change', () => {
  baseCategory = categorySelect.value;
  categorySelect.dataset.category = categorySelect.value;
  categoryLocked = input.value.trim() !== '';
  scheduleAutoCategory.cancel();
  applyAutoCategory();
});

autoCategoryToggle.addEventListener('change', () => {
  autoCategoryEnabled = autoCategoryToggle.checked;
  storage.set(AUTO_CATEGORY_KEY, autoCategoryEnabled ? 'on' : 'off');
  categoryLocked = false;
  applyAutoCategory();
  showToast(autoCategoryEnabled ? '🏷️ 키워드 자동 분류를 켰습니다' : '키워드 자동 분류를 껐습니다');
});

// ---------- 필터 / 검색 / 정렬 / 일괄 삭제 ----------

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('.filter-btn');
  if (btn) setFilter(btn.dataset.filter);
});

/** 검색은 디바운스: 타이핑이 멈춘 뒤 한 번만 렌더링 */
const debouncedSearch = debounce(setSearch, SEARCH_DEBOUNCE_MS);
searchInput.addEventListener('input', () => debouncedSearch(searchInput.value));

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && searchInput.value) {
    e.preventDefault();
    searchInput.value = '';
    debouncedSearch.cancel();
    setSearch('');
  } else if (e.key === 'Enter') {
    debouncedSearch.flush(); // Enter는 기다리지 않고 바로 검색
  }
});

sortSelect.addEventListener('change', () => setSort(sortSelect.value));
clearCompletedBtn.addEventListener('click', clearCompleted);
themeToggle.addEventListener('click', toggleTheme);
quoteRefresh.addEventListener('click', nextQuote);

// ---------- 내보내기 / 가져오기 ----------

exportBtn.addEventListener('click', () => exportData());
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  importFile.value = ''; // 같은 파일을 다시 선택해도 change가 발생하도록 초기화
  try {
    await importFromFile(file);
  } catch (err) {
    console.error('가져오기 중 예기치 못한 오류:', err);
    showToast('가져오기 중 오류가 발생했습니다', 'error');
  }
});

// ---------- 다이얼로그 ----------

// 배경(다이얼로그 바깥) 클릭 시 취소
dialogEl.addEventListener('click', (e) => {
  if (e.target === dialogEl) dialogEl.close('cancel');
});

// ---------- 목록 (이벤트 위임: 항목이 몇 개든 리스너는 목록에 하나씩) ----------

list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-role]');
  const item = btn?.closest('.todo-item');
  if (!item) return;
  const id = item.dataset.id;

  switch (btn.dataset.role) {
    case 'delete':
      deleteTodo(id);
      break;
    case 'edit':
      startEdit(id);
      break;
    case 'save':
      commitEdit({ restoreFocus: true });
      break;
    case 'cancel':
      cancelEdit({ restoreFocus: true });
      break;
    default:
      break;
  }
});

list.addEventListener('change', (e) => {
  if (e.target.dataset.role !== 'check') return;
  const item = e.target.closest('.todo-item');
  if (item) toggleTodo(item.dataset.id);
});

list.addEventListener('dblclick', (e) => {
  const text = e.target.closest('[data-role="text"]');
  const item = text?.closest('.todo-item');
  if (item) startEdit(item.dataset.id);
});

// 저장/취소 버튼을 눌러도 편집 입력창의 포커스가 빠지지 않게 (focusout 저장과 충돌 방지)
list.addEventListener('mousedown', (e) => {
  if (e.target.closest('.todo-item__edit-actions button')) e.preventDefault();
});

list.addEventListener('keydown', (e) => {
  // 편집 모드: Enter 저장 / Esc 취소
  if (e.target.closest('.todo-item__edit')) {
    // 한글 IME 조합 중의 Enter는 무시 (조합 확정용 Enter)
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
      e.preventDefault();
      commitEdit({ restoreFocus: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit({ restoreFocus: true });
    }
    return;
  }

  // 드래그 핸들: 위/아래 화살표로 순서 변경
  if (e.target.dataset.role === 'handle' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const item = e.target.closest('.todo-item');
    if (item && SORTABLE_MODES.has(currentSort)) moveByKeyboard(item.dataset.id, e.key === 'ArrowUp' ? -1 : 1);
  }
});

// 편집 영역 밖으로 포커스가 나가면 저장 (input ↔ select ↔ 버튼 이동은 제외)
list.addEventListener('focusout', (e) => {
  const editArea = e.target.closest('.todo-item__edit');
  if (!editArea || editArea.contains(e.relatedTarget)) return;
  commitEdit();
});

// 드래그 (포인터 캡처 덕분에 move/up 이벤트는 핸들에서 발생해 목록까지 버블링됨)
list.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !SORTABLE_MODES.has(currentSort)) return;
  const handle = e.target.closest('[data-role="handle"]');
  if (handle) startDrag(e, handle);
});
list.addEventListener('pointermove', onDragMove);
list.addEventListener('pointerup', endDrag);
list.addEventListener('pointercancel', endDrag);

// ---------- 전역 키보드 단축키 ----------

document.addEventListener('keydown', (e) => {
  if (drag && e.key === 'Escape') {
    e.preventDefault();
    cancelDrag();
    return;
  }
  if (dialogEl.open) return; // 다이얼로그가 떠 있으면 단축키 비활성화

  // Ctrl/Cmd+Z: 삭제·가져오기 실행 취소 (입력창 안에서는 브라우저 기본 실행 취소 유지)
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyZ') {
    if (isTextField(document.activeElement)) return;
    e.preventDefault();
    undo();
    return;
  }

  // '/' : 검색창 포커스
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextField(document.activeElement)) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
    return;
  }

  // Alt 조합 (Ctrl+Alt = AltGr인 키보드 배열이 있으므로 Ctrl이 눌렸으면 제외)
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;

  if (e.code === 'KeyN') {
    input.focus();
    input.select();
  } else if (hasOwn(FILTER_SHORTCUTS, e.code)) {
    const filter = FILTER_SHORTCUTS[e.code];
    setFilter(filter);
    showToast(`필터: ${FILTER_LABELS[filter]}`);
  } else if (e.code === 'KeyD') {
    toggleTheme();
  } else {
    return;
  }
  e.preventDefault();
});

// ---------- 시스템 / 다른 탭 / 페이지 이탈 ----------

// 사용자가 테마를 직접 고른 적이 없으면 OS 설정 변경을 따라감
systemDark.addEventListener('change', (e) => {
  if (!loadSavedTheme()) applyTheme(e.matches ? 'dark' : 'light', { animate: true });
});

// 다른 탭에서 데이터나 테마를 바꾸면 이 탭에도 반영
window.addEventListener('storage', (e) => {
  if (e.key === THEME_KEY) {
    if (e.newValue === 'dark' || e.newValue === 'light') applyTheme(e.newValue, { animate: true });
    return;
  }
  if (e.key !== STORAGE_KEY && e.key !== null) return; // null = 다른 탭에서 전체 삭제(clear)

  // 이 탭에 저장 대기 중인 변경이 있으면 곧 그 내용으로 덮어쓰므로 무시
  if (scheduleSave.pending()) return;

  try {
    const { todos: next } = parseStoredTodos(e.key === null ? null : e.newValue);
    cancelDrag();
    todos = next;
    if (editingId !== null && !todos.some((t) => t.id === editingId)) editingId = null;
    render();
    showToast('다른 탭에서 변경된 내용을 반영했습니다');
  } catch (err) {
    console.warn('다른 탭의 변경 내용을 읽지 못했습니다:', err);
  }
});

// 페이지를 떠나거나 탭이 숨겨질 때 디바운스 대기 중인 저장을 즉시 실행 (데이터 유실 방지)
window.addEventListener('pagehide', () => scheduleSave.flush());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) scheduleSave.flush();
  else refreshTimes(); // 다시 보일 때 시간 표시 즉시 갱신
});

// 예상치 못한 오류도 사용자에게 알림 (콘솔에만 남고 조용히 멈추지 않도록)
window.addEventListener('error', (e) => {
  // 브라우저 확장 프로그램 등 다른 스크립트의 오류는 무시
  if (e.filename && !e.filename.endsWith('script.js')) return;
  console.error('예기치 못한 오류:', e.error ?? e.message);
  showToast('예기치 못한 오류가 발생했습니다. 새로고침해 주세요.', 'error');
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('처리되지 않은 Promise 오류:', e.reason);
  showToast('작업 중 오류가 발생했습니다', 'error');
});

// =========================================================
// 9. 초기화
// =========================================================

applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
sortSelect.value = currentSort;
if (isCategory(currentFilter)) categorySelect.value = currentFilter;
baseCategory = categorySelect.value;
setCategorySelect(baseCategory);
autoCategoryToggle.checked = autoCategoryEnabled;
renderQuote();
render();
startupWarnings.forEach((message) => showToast(message, 'warning', { duration: UNDO_TOAST_MS }));
setInterval(refreshTimes, 60 * 1000);
