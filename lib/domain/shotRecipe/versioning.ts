/**
 * 버전 규칙.
 *
 *   - 본문은 불변이다. 내용을 바꾸려면 새 버전을 만든다.
 *   - 새 버전은 언제나 draft 다.
 *   - 이전 버전의 승인은 승계되지 않는다.
 *   - 링크(관계형 ID)는 복사하되, 승인 이력은 복사하지 않는다.
 */
import type {
  ShotRecipeLinks,
  ShotRecipeVersion,
  ShotRecipeVersionBody,
} from "./types";
import { EMPTY_LINKS, EMPTY_VERSION_BODY } from "./types";

const BODY_KEYS = Object.keys(EMPTY_VERSION_BODY) as Array<keyof ShotRecipeVersionBody>;

/** 버전 본문만 뽑는다 (status·메타 제외). */
export function extractBody(version: ShotRecipeVersion): ShotRecipeVersionBody {
  const out = {} as ShotRecipeVersionBody;
  for (const k of BODY_KEYS) (out as Record<string, unknown>)[k] = version[k];
  return out;
}

/** 두 본문이 실질적으로 같은가. 같으면 새 버전을 만들 이유가 없다. */
export function bodyEquals(a: ShotRecipeVersionBody, b: ShotRecipeVersionBody): boolean {
  return BODY_KEYS.every((k) => {
    const av = a[k];
    const bv = b[k];
    if (Array.isArray(av) && Array.isArray(bv)) {
      return av.length === bv.length && av.every((x, i) => x === bv[i]);
    }
    return av === bv;
  });
}

export type NextVersionInput = {
  previous: ShotRecipeVersion | null;
  /** 바꿀 필드만 준다. 나머지는 이전 버전에서 가져온다. */
  changes?: Partial<ShotRecipeVersionBody>;
  /** 링크를 새로 지정한다. 생략하면 이전 버전 링크를 복사한다. */
  links?: ShotRecipeLinks;
  createdBy: string;
};

export type NextVersionDraft = {
  version: number;
  status: "draft";
  body: ShotRecipeVersionBody;
  links: ShotRecipeLinks;
  createdBy: string;
  /** 승인은 절대 승계하지 않는다. 항상 빈 배열이다. */
  inheritedApprovals: never[];
};

/**
 * 다음 버전 초안을 만든다.
 * previous 가 null 이면 v1 이다.
 */
export function buildNextVersion(input: NextVersionInput): NextVersionDraft {
  const base = input.previous ? extractBody(input.previous) : EMPTY_VERSION_BODY;
  const body: ShotRecipeVersionBody = { ...base, ...(input.changes ?? {}) };

  return {
    version: input.previous ? input.previous.version + 1 : 1,
    status: "draft",
    body,
    links: input.links ?? (input.previous ? input.previous.links : EMPTY_LINKS),
    createdBy: input.createdBy,
    inheritedApprovals: [],
  };
}

/**
 * 새 버전을 만들 수 있는지 판정.
 * 내용이 하나도 안 바뀌었으면 거부한다 — 의미 없는 버전이 쌓이는 것을 막는다.
 */
export function canCreateNextVersion(input: NextVersionInput): { ok: boolean; reason?: string } {
  if (!input.createdBy) return { ok: false, reason: "작성자가 필요합니다." };
  if (!input.previous) return { ok: true };

  const next = buildNextVersion(input);
  const linksChanged = JSON.stringify(next.links) !== JSON.stringify(input.previous.links);
  if (bodyEquals(extractBody(input.previous), next.body) && !linksChanged) {
    return { ok: false, reason: "이전 버전과 내용이 같습니다. 바뀐 것이 있어야 새 버전을 만듭니다." };
  }
  return { ok: true };
}
