import type { ImageTier, TwoTierImage } from "./types";

export class ExplorationImageTakeForbiddenError extends Error {
  constructor(imageId: string) {
    super(`[보안 정책 위반] 탐색용 이미지(${imageId})는 TAKE 승인할 수 없습니다.`);
    this.name = "ExplorationImageTakeForbiddenError";
  }
}

export class ExplorationShotReferencePromotionForbiddenError extends Error {
  constructor(imageId: string) {
    super(`[보안 정책 위반] 탐색용 이미지(${imageId})는 Shot Reference 승격이 거부됩니다.`);
    this.name = "ExplorationShotReferencePromotionForbiddenError";
  }
}

export class ExplorationDirectProductionCandidateForbiddenError extends Error {
  constructor(imageId: string) {
    super(`[보안 정책 위반] 탐색용 이미지(${imageId})는 Production Candidate 로 직접 변환할 수 없습니다.`);
    this.name = "ExplorationDirectProductionCandidateForbiddenError";
  }
}

export class ExplorationFakeCanBeTakenTamperingError extends Error {
  constructor(imageId: string) {
    super(`[위조 위협 차단] image.canBeTaken 값이 true로 조작되었으나, tier가 exploration이므로 TAKE가 거부됩니다.`);
    this.name = "ExplorationFakeCanBeTakenTamperingError";
  }
}

/**
 * 2-Tier 이미지 안전성 검증 함수
 */
export function validateImageTakePermission(image: TwoTierImage): boolean {
  // 1. canBeTaken 위조 방어 (tier가 exploration이면 canBeTaken=true여도 거부!)
  if (image.tier === "exploration" && (image as any).canBeTaken === true) {
    throw new ExplorationFakeCanBeTakenTamperingError(image.id);
  }

  // 2. Exploration 이미지 TAKE 차단
  if (image.tier === "exploration") {
    throw new ExplorationImageTakeForbiddenError(image.id);
  }

  if (image.tier !== "production_candidate") {
    throw new ExplorationImageTakeForbiddenError((image as any).id);
  }

  return true;
}

/**
 * Shot Reference 승격 차단 검증
 */
export function promoteToShotReference(image: TwoTierImage): void {
  if (image.tier === "exploration") {
    throw new ExplorationShotReferencePromotionForbiddenError(image.id);
  }
}

/**
 * Production Candidate 직접 변환 차단 검증
 */
export function convertToProductionCandidateDirectly(image: TwoTierImage): void {
  if (image.tier === "exploration") {
    throw new ExplorationDirectProductionCandidateForbiddenError(image.id);
  }
}
