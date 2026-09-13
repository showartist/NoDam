/**
 * 세 어댑터가 공통으로 쓰는 실제 호출 경로.
 *
 * 예전 어댑터는 generate() 에서 아무것도 호출하지 않고 준비된 데모 이미지 경로를 돌려줬다
 * (제품 원칙이 금지하는 "가짜 성공"). 이제는 lib/images/openrouterImages 로 실제 생성하고,
 * 받은 바이트를 .data/images/ 에 쓴 경로만 돌려준다. 실패는 ImageGenError 로 올라간다.
 */
import { existsSync, readFileSync } from "node:fs";
import { uid } from "../../../db";
import { ImageGenError } from "../../../images/errors";
import { sniffMediaType, toDataUrl } from "../../../images/imageBytes";
import { generateImage, type ReferenceImageInput } from "../../../images/openrouterImages";
import { resolveStoredPath } from "../../../images/paths";
import { getReference } from "../../../images/references";
import { getImage, writeImageFile } from "../../../images/storage";
import type { GenerationResult, ImageRecipe, ProviderType } from "../types";

function fileAsInput(id: string, storedPath: string, what: string): ReferenceImageInput {
  const abs = resolveStoredPath(storedPath);
  if (!existsSync(abs)) throw new ImageGenError("NOT_FOUND", `${what} 파일이 없습니다: ${storedPath}`);
  const bytes = readFileSync(abs);
  const mediaType = sniffMediaType(bytes);
  if (!mediaType) throw new ImageGenError("INVALID_INPUT", `${what} 파일이 이미지가 아닙니다: ${storedPath}`);
  return { id, dataUrl: toDataUrl(bytes, mediaType) };
}

/** meeting_references 의 id → 첨부 이미지. 모르는 id 는 말없이 빼지 않고 막는다. */
export function referenceInputsFromIds(ids: string[]): ReferenceImageInput[] {
  return ids.map((id) => {
    const ref = getReference(id);
    if (!ref || !ref.filePath) throw new ImageGenError("NOT_FOUND", `레퍼런스 이미지를 찾을 수 없습니다: ${id}`);
    return fileAsInput(id, ref.filePath, `레퍼런스 ${ref.title}`);
  });
}

/** generated_images 의 completed 행 → 첨부 이미지 (FLUX 부분 수정의 원본). */
export function generatedImageInput(imageId: string): ReferenceImageInput {
  const row = getImage(imageId);
  if (!row || row.status !== "completed" || !row.filePath) {
    throw new ImageGenError("NOT_FOUND", `수정할 원본 이미지를 찾을 수 없습니다: ${imageId}`);
  }
  return fileAsInput(imageId, row.filePath, `원본 이미지 ${imageId}`);
}

export function assertNoCharacterVisuals(recipe: ImageRecipe): void {
  if (recipe.characterVisualIds.length) {
    throw new ImageGenError(
      "INVALID_INPUT",
      `캐릭터 비주얼(${recipe.characterVisualIds.join(", ")})을 이미지로 불러오는 경로가 아직 없습니다. 빼고 생성하지 않습니다.`,
    );
  }
}

export async function generateViaOpenRouter(
  adapter: { provider: ProviderType; model: string },
  recipe: ImageRecipe,
  prompt: string,
  resolution: "low" | "high",
  references: ReferenceImageInput[],
): Promise<GenerationResult> {
  const result = await generateImage({
    model: adapter.model,
    prompt,
    resolution: resolution === "high" ? "final" : "draft",
    references,
  });
  const jobId = `job_${adapter.provider}_${uid()}`;
  const saved = writeImageFile(jobId, result.bytes, result.mediaType);
  return {
    jobId,
    recipeId: recipe.id,
    provider: adapter.provider,
    imageUri: saved.storedPath,
    resolution,
    generatedAt: new Date().toISOString(),
    model: result.model,
    prompt,
    costUsd: result.costUsd,
    width: result.width,
    height: result.height,
    referenceIds: result.sent.referenceIds,
  };
}
